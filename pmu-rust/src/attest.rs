// attest.rs — IN-BINARY signed receipts (gap G1, the last open Rust gap).
//
// Closes the verification-gaps ledger's Attestation item: the daemon used to
// emit UNSIGNED JSON and the signature was applied AFTER the fact by Node
// (`scripts/pmu/hw-sign-fallback.mjs`) over artifacts Node chose to sign — so
// the signed surface started at the script, not the measurement. With `--sign`
// the binary itself signs SHA-256 of the EXACT bytes it emitted, and Node is
// demoted to VERIFIER (`pmu-rust-verification-gaps.md`, closure spec;
// `pmu-resident-onchip-spec.md` §(b).4 — the resident reuses this code path).
//
// The chain: hw root → binary sha → receipt signature.
//   · hw root — IOPlatformUUID + IOPlatformSerialNumber via `ioreg` (no
//     entitlement), HKDF-SHA256 under the daemon's OWN salt
//     `com.thetacog.pmu.hostkey.daemon.v1` (deliberately distinct from the
//     Node fallback's `…fallback.v1` — two signers, two keys, no blur) →
//     a 32-byte ed25519 seed. HONESTY (same note as hw-sign-fallback.mjs):
//     this key is hardware-DERIVED, reproducible by anyone who can read this
//     box's identifiers — it binds the signature to *knowledge of this
//     machine's hardware id*, NOT to unextractable silicon. The Secure
//     Enclave path (G5) upgrades the root without changing the chain shape.
//   · binary sha — sha256 of the running executable's bytes, hashed ONCE at
//     first use (what booted is what runs — open question Q10, decided here).
//   · receipt signature — sig = ed25519_sign(seed_key, sha256(payload_bytes))
//     where payload_bytes are EXACTLY the bytes written to stdout for the
//     measurement (frames JSON + '\n', the NDJSON stream lines including
//     each '\n', or the throughput receipt file bytes). Signing the 32-byte
//     digest (not the raw stream) keeps stream verification one-pass: the
//     verifier re-hashes the captured bytes and verifies over the digest.
//
// Verification needs ONLY the emitted bytes + the attestation line: the raw
// 32-byte pubkey rides in `pubkey_b64` (SPKI-wrap it with the standard
// ed25519 DER prefix 302a300506032b6570032100 for node:crypto). Forge
// vector: any one-byte mutation of the payload changes the digest and MUST
// fail verification — pinned in cargo below and proven from the OUTSIDE by
// `tests/pmu-simulator/daemon-signed-receipts.test.mjs` (the
// forge-test.test.mjs pattern pointed at the binary).

use ed25519_dalek::{Signer, SigningKey};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};

/// The daemon key-derivation salt. Distinct from the Node fallback signer's
/// `com.thetacog.pmu.hostkey.fallback.v1` so the two signing identities can
/// never be confused for one another.
pub const KDF_SALT: &str = "com.thetacog.pmu.hostkey.daemon.v1";
const KDF_INFO: &[u8] = b"ed25519-seed-0";

/// Read the board-bound identifiers (no entitlement required) — the same
/// `ioreg -d2 -c IOPlatformExpertDevice` read hw-sign-fallback.mjs performs,
/// so both signers agree on what "this host" means. Errors are returned, not
/// panicked: `--sign` exits 2 with the message (an unsigned run is still
/// available by simply not passing the flag — never a silent fallback).
pub fn hw_identifier() -> Result<String, String> {
    let out = std::process::Command::new("ioreg")
        .args(["-d2", "-c", "IOPlatformExpertDevice"])
        .output()
        .map_err(|e| format!("ioreg unavailable: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let uuid = extract_quoted(&text, "IOPlatformUUID").unwrap_or_default();
    let serial = extract_quoted(&text, "IOPlatformSerialNumber").unwrap_or_default();
    if uuid.is_empty() && serial.is_empty() {
        return Err("could not read hardware identifier (IOPlatformUUID/SerialNumber)".into());
    }
    Ok(format!("{uuid}:{serial}"))
}

/// Pull the quoted value of `"key" = "value"` from ioreg's plist-ish text.
/// String-scan, zero regex deps; returns None when the key is absent.
fn extract_quoted(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let at = text.find(&needle)?;
    let rest = &text[at + needle.len()..];
    let eq = rest.find('=')?;
    let rest = &rest[eq + 1..];
    let q1 = rest.find('"')?;
    let rest = &rest[q1 + 1..];
    let q2 = rest.find('"')?;
    Some(rest[..q2].to_string())
}

/// HKDF-SHA256(ikm, salt=KDF_SALT, info=KDF_INFO) → 32-byte ed25519 seed.
/// Unlike the P-256 fallback there is NO rejection loop: every 32-byte string
/// is a valid ed25519 seed, so derivation is a total function of the ikm.
pub fn derive_signing_key_from_ikm(ikm: &[u8]) -> SigningKey {
    let hk = Hkdf::<Sha256>::new(Some(KDF_SALT.as_bytes()), ikm);
    let mut seed = [0u8; 32];
    hk.expand(KDF_INFO, &mut seed)
        .expect("hkdf-sha256 expand to 32 bytes cannot fail");
    SigningKey::from_bytes(&seed)
}

/// The host signing key: hw identifier → HKDF → ed25519. Deterministic on a
/// given host (pinned by `host_key_is_stable_on_this_host`).
pub fn host_signing_key() -> Result<SigningKey, String> {
    Ok(derive_signing_key_from_ikm(hw_identifier()?.as_bytes()))
}

/// sha256 of the running executable, hex — hashed once, cached (Q10: what
/// booted is what runs; a binary replaced on disk mid-session is NOT what
/// this process is executing, so per-attestation re-hashing would be the lie).
pub fn binary_sha256() -> &'static str {
    static SHA: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SHA.get_or_init(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| std::fs::read(p).ok())
            .map(|bytes| hex(&Sha256::digest(&bytes)))
            .unwrap_or_else(|| "unreadable".to_string())
    })
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Build the trailing attestation line for an already-finalized payload
/// digest. Used directly by the `--stream` path, which hashes each NDJSON
/// line (including its '\n') as it is written.
pub fn attestation_line_for_digest(digest: &[u8; 32], key: &SigningKey, ts: &str) -> String {
    use base64::{engine::general_purpose, Engine as _};
    let sig = key.sign(digest);
    let obj = serde_json::json!({
        "attestation": {
            "alg": "ed25519-over-sha256",
            "payload_sha256": hex(digest),
            "sig_b64": general_purpose::STANDARD.encode(sig.to_bytes()),
            "pubkey_b64": general_purpose::STANDARD.encode(key.verifying_key().to_bytes()),
            "hw": "hw-derived-platform-uuid",
            "kdf": format!("hkdf-sha256/{}", KDF_SALT),
            "binary_sha256": binary_sha256(),
            "ts": ts,
            "note": "key is hardware-DERIVED (ioreg platform id), weaker than Secure Enclave; proves which bits ran on this host, never what they meant",
        }
    });
    serde_json::to_string(&obj).expect("attestation serializes")
}

/// Convenience for buffered emitters: hash the exact payload bytes, sign.
pub fn attestation_line(payload: &[u8], key: &SigningKey, ts: &str) -> String {
    let digest: [u8; 32] = Sha256::digest(payload).into();
    attestation_line_for_digest(&digest, key, ts)
}

// ── tests — the closure's cargo-side pins ────────────────────────────
// The OUTSIDE proof (capture the binary's raw emitted bytes, recompute the
// digest, verify, forge) lives in tests/pmu-simulator/daemon-signed-
// receipts.test.mjs; these pin the primitives it composes.
#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    #[test]
    fn key_derivation_is_deterministic_and_ikm_sensitive() {
        let a = derive_signing_key_from_ikm(b"fixed-test-ikm");
        let b = derive_signing_key_from_ikm(b"fixed-test-ikm");
        assert_eq!(
            a.verifying_key().to_bytes(),
            b.verifying_key().to_bytes(),
            "same ikm must derive the same key (the host identity is a pure function)"
        );
        let c = derive_signing_key_from_ikm(b"other-ikm");
        assert_ne!(
            a.verifying_key().to_bytes(),
            c.verifying_key().to_bytes(),
            "different ikm must derive a different key"
        );
    }

    #[test]
    fn sign_verify_roundtrip_and_one_byte_forge_fails() {
        let key = derive_signing_key_from_ikm(b"fixed-test-ikm");
        let payload = b"[{\"kind\":\"anchor\",\"ply\":0}]\n";
        let line = attestation_line(payload, &key, "2026-06-12T00-00-00");
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        let att = &v["attestation"];

        // the digest in the line IS sha256 of the exact payload bytes
        let digest: [u8; 32] = Sha256::digest(payload).into();
        assert_eq!(att["payload_sha256"].as_str().unwrap(), hex(&digest));

        // the signature verifies over that digest with the embedded pubkey
        let pk_bytes: [u8; 32] = general_purpose::STANDARD
            .decode(att["pubkey_b64"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let pk = VerifyingKey::from_bytes(&pk_bytes).unwrap();
        let sig_bytes = general_purpose::STANDARD
            .decode(att["sig_b64"].as_str().unwrap())
            .unwrap();
        let sig = Signature::from_slice(&sig_bytes).unwrap();
        pk.verify(&digest, &sig).expect("genuine payload must verify");

        // FORGE VECTOR: one flipped byte in the payload must fail verification
        let mut forged = payload.to_vec();
        forged[0] ^= 0x01;
        let forged_digest: [u8; 32] = Sha256::digest(&forged).into();
        assert!(
            pk.verify(&forged_digest, &sig).is_err(),
            "a one-byte mutation of the payload MUST fail verification"
        );
    }

    #[test]
    fn attestation_carries_the_required_chain_fields() {
        let key = derive_signing_key_from_ikm(b"fixed-test-ikm");
        let line = attestation_line(b"x", &key, "2026-06-12T00-00-00");
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        let att = &v["attestation"];
        assert_eq!(att["alg"], "ed25519-over-sha256");
        assert_eq!(att["payload_sha256"].as_str().unwrap().len(), 64);
        assert_eq!(att["kdf"], format!("hkdf-sha256/{}", KDF_SALT));
        assert_eq!(att["hw"], "hw-derived-platform-uuid");
        assert_eq!(att["ts"], "2026-06-12T00-00-00");
        // binary sha is hex-64 or the honest "unreadable" — never absent
        let bs = att["binary_sha256"].as_str().unwrap();
        assert!(bs.len() == 64 || bs == "unreadable");
        // the note keeps the honesty bound attached to every receipt
        assert!(att["note"].as_str().unwrap().contains("weaker than Secure Enclave"));
    }

    #[test]
    fn streamed_incremental_digest_equals_buffered_digest() {
        // the --stream path hashes line+'\n' incrementally; it must equal the
        // buffered hash of the concatenated bytes, or the two emitters would
        // sign different things for the same walk.
        let lines = ["{\"a\":1}", "{\"b\":2}", "{\"c\":3}"];
        let mut h = Sha256::new();
        for l in &lines {
            h.update(l.as_bytes());
            h.update(b"\n");
        }
        let inc: [u8; 32] = h.finalize().into();
        let buffered: [u8; 32] = Sha256::digest(lines.map(|l| format!("{l}\n")).concat().as_bytes()).into();
        assert_eq!(inc, buffered);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn host_key_is_stable_on_this_host() {
        // Skip honestly (vacuous pass) if ioreg is unreadable in this
        // environment — the pure-derivation tests above still hold the law.
        if let (Ok(k1), Ok(k2)) = (host_signing_key(), host_signing_key()) {
            assert_eq!(
                k1.verifying_key().to_bytes(),
                k2.verifying_key().to_bytes(),
                "two reads of this host's identifiers must derive one identity"
            );
        }
    }
}
