// src/verify.rs — B13/B19 THE VERIFIER, IN THE CRATE (VB-1..VB-5, spec §8.58 stub).
//
// Ports scripts/pmu/verify-row.mjs's verifyBundle (the B19 attestation-bundle path) into the crate
// as ONE flag, --verify-bundle, following exactly how --envelope-read and --vol-read were done: the
// crate verifies, the JS driver (verify-row.mjs) calls it first and stamps `engine: rust-verify` in
// the reason, falling back to `engine: js-fallback` and naming why when the binary is absent or the
// crate disagrees with itself.
//
//   pmu-onchip --verify-bundle <bundle.json> [--text-dir <dir>] [--repo <path>] [--json]
//
// Three primitives, each already load-bearing elsewhere in this crate and reused rather than
// reimplemented: ed25519 verify and sha256 are attest.rs's own dependencies (ed25519-dalek, sha2);
// base64 is envelope's neighbour attest.rs's too. ONE primitive is new: git's own blob id,
// sha1("blob <len>\0<bytes>") — this crate carries no `sha1` crate (none is vendored under
// ~/.cargo/registry and this box has no network to fetch one; checked before writing this), so
// `sha1_digest` below is a compact from-spec SHA-1 (FIPS 180-4), used ONLY for this
// non-cryptographic content-addressing check (git's own choice of hash for object ids, not a
// security primitive here — the signature is what carries the security property).
//
// THE WALK. `verify-row.mjs`'s defaultWalk spawns the compiled binary with `--lens` and a fixed set
// of flags (seed matched, guided-passes 2, matched-cut, worms 2 orthogonal, perm 8, the row's own
// maxDepth/topK/budget/decay). This module does the SAME THING from inside the already-running
// binary: `run_lens_walk` below re-invokes `std::env::current_exe()` with `--lens` and the identical
// flag set, over temp files holding the bundle's own packed reef/axes bytes. This is a subprocess
// call rather than a true in-process function call because `lens::run` (src/lens.rs, ~570 lines)
// is a print-only CLI entry point with no return-value API — extracting one would touch the single
// most heavily-guarded, highest-traffic code path in this crate (the live commit-gate walk) for a
// verifier that is not itself hot-path, which was judged the wrong trade for this task. The
// guarantee that matters — the SAME code computes the placement, not a second implementation of the
// walk — still holds exactly: it is the same binary, the same `--lens` branch, the same functions.
// Refactoring lens::run to a return-value API is named as a follow-up, not attempted here.
//
// LLM-free. No clock in any verdict (only the CLI's own stderr/exit code path touches wall time).

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

// ── hashing primitives ──────────────────────────────────────────────────────────────────────────
fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes { s.push_str(&format!("{:02x}", b)); }
    s
}
fn sha256_bytes(bytes: &[u8]) -> [u8; 32] { Sha256::digest(bytes).into() }
fn sha256_hex(bytes: &[u8]) -> String { hex(&sha256_bytes(bytes)) }
/// walk-door.mjs's sha12: the first 12 hex chars of sha256 — what every row's `text_sha` actually is.
fn sha12(bytes: &[u8]) -> String { sha256_hex(bytes)[..12].to_string() }
/// walk-door.mjs's sha256Hex16: the first 16 hex chars of sha256 — `bin_sha`/`reef_sha`/`axes_sha`.
fn sha256_hex16(bytes: &[u8]) -> String { sha256_hex(bytes)[..16].to_string() }

/// A from-spec SHA-1 (FIPS 180-4). Used ONLY by `git_blob_id` below — git's own content-addressing
/// choice, reproduced here because no sha1 crate is vendored offline. Not used for any signature.
fn sha1_digest(input: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let ml: u64 = (input.len() as u64) * 8;
    let mut msg = input.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 { msg.push(0); }
    msg.extend_from_slice(&ml.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 { w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]); }
        for i in 16..80 { w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1); }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = if i < 20 { ((b & c) | ((!b) & d), 0x5A827999u32) }
                else if i < 40 { (b ^ c ^ d, 0x6ED9EBA1u32) }
                else if i < 60 { ((b & c) | (b & d) | (c & d), 0x8F1BBCDCu32) }
                else { (b ^ c ^ d, 0xCA62C1D6u32) };
            let temp = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(wi);
            e = d; d = c; c = b.rotate_left(30); b = a; a = temp;
        }
        h[0] = h[0].wrapping_add(a); h[1] = h[1].wrapping_add(b); h[2] = h[2].wrapping_add(c); h[3] = h[3].wrapping_add(d); h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for i in 0..5 { out[i * 4..i * 4 + 4].copy_from_slice(&h[i].to_be_bytes()); }
    out
}
/// git's own blob object id: sha1("blob <len>\0<bytes>"). Pure content addressing, zero git calls —
/// so AB-1/VB-5 (git absent) holds by construction here, the same way B19's JS `gitBlobIdJs` does.
pub fn git_blob_id(bytes: &[u8]) -> String {
    let mut full = format!("blob {}\0", bytes.len()).into_bytes();
    full.extend_from_slice(bytes);
    hex(&sha1_digest(&full))
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 { return Err(format!("odd-length hex string ({} chars)", s.len())); }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string())).collect()
}
fn pubkey_from_hex(h: &str) -> Result<VerifyingKey, String> {
    let bytes = hex_decode(h)?;
    let arr: [u8; 32] = bytes.try_into().map_err(|v: Vec<u8>| format!("expected 32-byte pubkey, got {}", v.len()))?;
    VerifyingKey::from_bytes(&arr).map_err(|e| e.to_string())
}
fn sig_from_hex(h: &str) -> Result<Signature, String> {
    let bytes = hex_decode(h)?;
    if bytes.len() != 64 { return Err(format!("expected 64 bytes, got {}", bytes.len())); }
    Ok(Signature::from_slice(&bytes).expect("64-byte slice always parses as an ed25519 signature"))
}

// ── THE CANONICAL TUPLE — mirrors scripts/pmu/verify-row.mjs's SIG_FIELDS/canonicalTuple verbatim ─
pub const SIG_FIELDS: [&str; 7] = ["ts", "source", "text_sha", "pixel", "reef_sha", "axes_sha", "bin_sha"];
fn json_scalar(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap(),
        other => serde_json::to_string(other).unwrap(),   // not expected for these 7 fields; refuse nothing, just serialize
    }
}
/// `JSON.stringify(Object.fromEntries(SIG_FIELDS.map(k => [k, row[k] ?? null])))` — byte-identical
/// as long as every field is a string/number/bool/null (true for every row this repo has ever
/// signed). Built by hand, field order fixed, rather than via a serde_json::Map — a BTreeMap-backed
/// Map would re-sort these 7 keys alphabetically, which is NOT what JS's insertion-order object
/// literal produces, so relying on Map ordering here would silently sign/verify a different string.
pub fn canonical_tuple(row: &Value) -> String {
    let mut out = String::from("{");
    for (i, k) in SIG_FIELDS.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push('"'); out.push_str(k); out.push_str("\":");
        out.push_str(&json_scalar(row.get(*k).unwrap_or(&Value::Null)));
    }
    out.push('}');
    out
}

/// canonicalStringify, ported: JS sorts object keys alphabetically at EVERY nesting level before
/// stringifying. serde_json::Value::Object is backed by a BTreeMap (sorted key iteration) unless
/// the crate's `preserve_order` feature is enabled — checked before writing this: no `indexmap` is
/// anywhere in this crate's Cargo.lock, so the feature is off, and a plain `serde_json::to_string`
/// on a parsed Value ALREADY emits keys in sorted order at every level. No manual re-sort is needed
/// (or possible to get more "canonical" than what the parser already gives us).
pub fn canonical_stringify(v: &Value) -> String { serde_json::to_string(v).unwrap() }

// ── SIGNATURE CHECK — one row's own ed25519 sig over its canonical tuple ──────────────────────────
pub struct SigCheck { pub ok: bool, pub reason: String }
pub fn check_row_signature(row: &Value) -> SigCheck {
    if !row.is_object() { return SigCheck { ok: false, reason: "signature: row is not a JSON object".into() }; }
    for f in SIG_FIELDS { if row.get(f).is_none() { return SigCheck { ok: false, reason: format!("signature: row is missing field '{}'", f) }; } }
    let sig_hex = match row.get("sig").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s,
        _ => {
            let why = row.get("sig_why").and_then(|v| v.as_str()).unwrap_or("missing sig");
            return SigCheck { ok: false, reason: format!("signature: {}", why) };
        }
    };
    let pubkey_hex = match row.get("sig_pubkey").and_then(|v| v.as_str()) {
        Some(s) => s, None => return SigCheck { ok: false, reason: "signature: missing sig_pubkey".into() },
    };
    let pk = match pubkey_from_hex(pubkey_hex) { Ok(p) => p, Err(e) => return SigCheck { ok: false, reason: format!("signature: malformed sig_pubkey ({})", e) } };
    let sig = match sig_from_hex(sig_hex) { Ok(s) => s, Err(e) => return SigCheck { ok: false, reason: format!("signature: malformed sig ({})", e) } };
    let msg = canonical_tuple(row);
    match pk.verify(msg.as_bytes(), &sig) {
        Ok(()) => SigCheck { ok: true, reason: String::new() },
        Err(_) => SigCheck { ok: false, reason: format!("signature: invalid over {}", SIG_FIELDS.join("\u{b7}")) },
    }
}

// ── THE COMMIT-UNIT COVENANT — recomputeCommitUnit / turnPass / breachShareUnion, ported verbatim ─
fn under_prefix(p: &str, g: &str) -> bool {
    let norm = |s: &str| s.trim_start_matches("./").trim_end_matches('/').to_string();
    let (p, g) = (norm(p), norm(g));
    !g.is_empty() && (p == g || p.starts_with(&format!("{}/", g)))
}
fn under_any(p: &str, prefixes: &[String]) -> bool { prefixes.iter().any(|g| under_prefix(p, g)) }
/// breachShareUnion — copied from scripts/pmu/kr37-covenant.mjs (breachShare), reproduced here so
/// this file imports nothing from the private repo's kr-scripts. A null `delivered` set (no turn
/// declared what it delivered) returns None — excluded, never scored as a breach.
pub fn breach_share_union(touched: &[String], delivered: &[String]) -> Option<f64> {
    let d: BTreeSet<&String> = delivered.iter().collect();
    if d.is_empty() { return None; }
    let distinct: Vec<&String> = { let s: BTreeSet<&String> = touched.iter().collect(); s.into_iter().collect() };
    if distinct.is_empty() { return Some(0.0); }
    let mut out = 0usize;
    let d_owned: Vec<String> = d.into_iter().cloned().collect();
    for p in &distinct { if !under_any(p, &d_owned) { out += 1; } }
    Some((out as f64 / distinct.len() as f64 * 1000.0).round() / 1000.0)
}
pub struct TurnPass { pub off_lane_ok: Option<bool>, pub breach_ok: Option<bool>, pub calls_ok: Option<bool>, pub pass: Option<bool> }
/// B21: `breach_max` is the collar's third bound, pinned in the bundle's `gate.collar.breach_max` —
/// this function must NEVER hardcode it (the pre-B21 code did, at 0.0), or a bundle pinned looser
/// than this verifier's default would recompute against the WRONG bound (AB-8).
pub fn turn_pass(t: &Value, tau: f64, k: f64, breach_max: f64) -> TurnPass {
    let off_lane_ok = t.get("off_lane").and_then(|v| v.as_f64()).map(|v| v <= tau);
    let breach_ok = t.get("breach").and_then(|v| v.as_f64()).map(|v| v <= breach_max);
    let calls_ok = t.get("calls").and_then(|v| v.as_f64()).map(|v| v <= k);
    let any_null = off_lane_ok.is_none() || breach_ok.is_none() || calls_ok.is_none();
    let pass = if any_null { None } else { Some(off_lane_ok.unwrap() && breach_ok.unwrap() && calls_ok.unwrap()) };
    TurnPass { off_lane_ok, breach_ok, calls_ok, pass }
}
#[derive(Clone)]
pub struct CommitUnit {
    pub turns: i64, pub calls: i64, pub distinct_paths: i64, pub breach: Option<f64>, pub off_lane_mean: Option<f64>,
    pub pass_per_turn_all: Option<bool>, pub pass_per_commit: Option<bool>, pub tau_pct: f64, pub k_calls: f64, pub breach_max: f64,
}
/// recomputeCommitUnit — THE ONE AGGREGATION, shared verbatim (in spirit) with verify-row.mjs's own
/// copy: `calls` is a SUM across turns (the Goodhart guard — splitting one big turn into many small
/// ones cannot buy a pass by resetting a per-turn cap). `breach_max` (B21): NEVER hardcoded here —
/// always the bundle's own `gate.collar.breach_max`, passed in by the caller.
pub fn recompute_commit_unit(per_turn: &[Value], tau: f64, k: f64, breach_max: f64) -> CommitUnit {
    let turns = per_turn.len() as i64;
    let calls: i64 = per_turn.iter().map(|t| t.get("calls").and_then(|v| v.as_i64()).unwrap_or(0)).sum();
    let off_vals: Vec<f64> = per_turn.iter().filter_map(|t| t.get("off_lane").and_then(|v| v.as_f64())).collect();
    let off_lane_mean = if off_vals.is_empty() { None } else { Some((off_vals.iter().sum::<f64>() / off_vals.len() as f64 * 1000.0).round() / 1000.0) };
    let mut touched_union: BTreeSet<String> = BTreeSet::new();
    let mut delivered_union: BTreeSet<String> = BTreeSet::new();
    for t in per_turn {
        if let Some(arr) = t.get("touched_paths").and_then(|v| v.as_array()) { for x in arr { if let Some(s) = x.as_str() { touched_union.insert(s.to_string()); } } }
        if let Some(arr) = t.get("delivered").and_then(|v| v.as_array()) { for x in arr { if let Some(s) = x.as_str() { delivered_union.insert(s.to_string()); } } }
    }
    let distinct_paths = touched_union.len() as i64;
    let touched_vec: Vec<String> = touched_union.into_iter().collect();
    let delivered_vec: Vec<String> = delivered_union.into_iter().collect();
    let breach = breach_share_union(&touched_vec, &delivered_vec);
    let per_turn_passes: Vec<TurnPass> = per_turn.iter().map(|t| turn_pass(t, tau, k, breach_max)).collect();
    let decidable: Vec<&TurnPass> = per_turn_passes.iter().filter(|p| p.pass.is_some()).collect();
    let pass_per_turn_all = if decidable.is_empty() { None } else { Some(decidable.iter().all(|p| p.pass == Some(true))) };
    let off_ok = off_lane_mean.map(|v| v <= tau);
    let breach_ok = breach.map(|v| v <= breach_max);
    let calls_ok = (calls as f64) <= k;
    let any_null = off_ok.is_none() || breach_ok.is_none();
    let pass_per_commit = if any_null { None } else { Some(off_ok.unwrap() && breach_ok.unwrap() && calls_ok) };
    CommitUnit { turns, calls, distinct_paths, breach, off_lane_mean, pass_per_turn_all, pass_per_commit, tau_pct: tau, k_calls: k, breach_max }
}
pub const DEFAULT_TAU_PCT: f64 = 25.0;
pub const DEFAULT_K_CALLS: f64 = 20.0;
pub const DEFAULT_BREACH_MAX: f64 = 0.0;

// ── B21 · THE GATE (spec §8.51/§8.60, KR38) — the covenant's own definition, pinned in the bundle ─
/// pathTokenPure, ported verbatim: the reef-bytes-only, filesystem-free half of lane-paths.mjs's
/// pathsFromTools token cleanup (no existsSync check — a stranger verifying has no filesystem).
fn path_token_pure(tok: &str) -> Option<String> {
    if tok == "blog" || tok == "blog:" { return Some("src/content/blog".to_string()); }
    if tok.starts_with('~') || tok.starts_with('/') || tok.starts_with('-') { return None; }
    if !tok.contains('/') && !tok.contains('.') { return None; }
    let mut chars: Vec<char> = tok.chars().collect();
    if chars.len() >= 2 && chars[0] == '.' && chars[1] == '/' { chars.drain(0..2); }
    // strip a trailing run of one-or-more '*' plus one preceding '/' if present (JS: /\/?\*+$/)
    let mut end = chars.len();
    while end > 0 && chars[end - 1] == '*' { end -= 1; }
    if end < chars.len() {
        chars.truncate(end);
        if chars.last() == Some(&'/') { chars.pop(); }
    }
    // strip a trailing run of ) , ; : (JS: /[),;:]+$/)
    while matches!(chars.last(), Some(')') | Some(',') | Some(';') | Some(':')) { chars.pop(); }
    let out: String = chars.into_iter().collect();
    if out.is_empty() { None } else { Some(out) }
}
/// lanePathsFromReefBytes, ported verbatim: per-domain sorted, deduped path lists from ONLY the
/// bundle's own packed reef bytes — no filesystem, no git, so gate.lane_paths_sha is reproducible
/// by a stranger with nothing but the bundle.
pub fn lane_paths_from_reef_bytes(reef_bytes: &[u8]) -> Result<Value, String> {
    let reef: Value = serde_json::from_slice(reef_bytes).map_err(|e| format!("reef bytes do not parse as JSON ({})", e))?;
    let domains = reef.get("domains").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut out = serde_json::Map::new();
    for d in &domains {
        let domain_name = match d.get("domain").and_then(|v| v.as_str()) { Some(s) if !s.is_empty() => s, _ => continue };
        let tools = d.get("tools").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mut set: BTreeSet<String> = BTreeSet::new();
        for tok in tools.split(|c: char| c == ',' || c.is_whitespace()) {
            if tok.is_empty() { continue; }
            if let Some(p) = path_token_pure(tok) { set.insert(p); }
        }
        out.insert(domain_name.to_string(), json!(set.into_iter().collect::<Vec<_>>()));
    }
    Ok(Value::Object(out))
}
/// The gate's structural check: every field present and correctly typed. A bundle with no gate at
/// all is pre-B21 and reads UNVERIFIABLE ("no gate pinned") rather than falling back to this
/// verifier's own defaults — the retroactive strike-move KR38 forbids.
fn gate_is_well_formed(gate: &Value) -> bool {
    let collar = gate.get("collar");
    let has_collar = collar.map(|c| c.get("tau_pct").and_then(|v| v.as_f64()).is_some()
        && c.get("k_calls").and_then(|v| v.as_f64()).is_some()
        && c.get("breach_max").and_then(|v| v.as_f64()).is_some()).unwrap_or(false);
    let has_blob = gate.get("covenant_module_blob").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let has_sha = gate.get("lane_paths_sha").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    has_collar && has_blob && has_sha
}
fn bool_as_json(v: Option<bool>) -> Value { v.map(|b| json!(if b { 1 } else { 0 })).unwrap_or(Value::Null) }
fn cu_field(c: &CommitUnit, f: &str) -> Value {
    match f {
        "turns" => json!(c.turns), "calls" => json!(c.calls), "distinct_paths" => json!(c.distinct_paths),
        "breach" => c.breach.map(|v| json!(v)).unwrap_or(Value::Null),
        "off_lane_mean" => c.off_lane_mean.map(|v| json!(v)).unwrap_or(Value::Null),
        "pass_per_turn_all" => bool_as_json(c.pass_per_turn_all),
        "pass_per_commit" => bool_as_json(c.pass_per_commit),
        _ => Value::Null,
    }
}
const COMMIT_UNIT_FIELDS: [&str; 7] = ["turns", "calls", "distinct_paths", "breach", "off_lane_mean", "pass_per_turn_all", "pass_per_commit"];
/// JSON-value equality that treats a serde_json Number stored as an integer (e.g. a bare `0` parsed
/// from a hand-written fixture or from JS's `JSON.stringify`, which never distinguishes int/float)
/// as equal to the SAME value stored as a float (e.g. `0.0`, what this module's own `f64` math
/// produces via `json!(v)`). serde_json's derived `PartialEq` on `Number` does NOT do this — two
/// internally-different-variant Numbers with the same numeric value compare unequal by default,
/// which would make every honestly-agreeing whole-number field (breach 0, off_lane_mean 81) read as
/// a spurious MISMATCH. Everything else (null, bool, string) still compares by strict equality.
fn json_number_aware_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}
pub fn diff_commit_unit(claimed: Option<&Value>, recomputed: &CommitUnit) -> Vec<String> {
    let mut diffs = Vec::new();
    for f in COMMIT_UNIT_FIELDS {
        let a = claimed.and_then(|c| c.get(f)).cloned().unwrap_or(Value::Null);
        let b = cu_field(recomputed, f);
        if !json_number_aware_eq(&a, &b) { diffs.push(format!("commit_unit.{} claimed {}, recomputed {}", f, a, b)); }
    }
    diffs
}

// ── THE APERTURE — applyAperture's 'head' mode only (the default, and the only mode the demo
// fixture's commit rows use). 'strided'/'prose' are JS-only digests this port does not attempt —
// a row carrying one reads UNVERIFIABLE with the reason named, never a silently wrong recompute.
fn apply_aperture(text: &str, aperture: Option<&Value>) -> Result<String, String> {
    let mode = aperture.and_then(|a| a.get("digest")).and_then(|v| v.as_str()).unwrap_or("head");
    if mode != "head" {
        return Err(format!("aperture digest '{}' is JS-only and not ported to the crate — refusing rather than approximating", mode));
    }
    // JS caps by STRING LENGTH (UTF-16 code units); this counts Unicode scalar values instead — the
    // two agree for ASCII/typical commit prose and diverge only on text wide enough in non-BMP
    // characters to matter, which no fixture in this repo carries. Named, not silently assumed.
    let cap = aperture.and_then(|a| a.get("cap")).and_then(|v| v.as_u64()).map(|v| v as usize).unwrap_or_else(|| text.chars().count());
    Ok(text.chars().take(cap).collect())
}

// ── THE WALK — self-exec the running binary's own --lens path (see the module doc comment) ───────
fn unique_tmp_dir(prefix: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("{}-{}-{}", prefix, std::process::id(), nanos))
}
fn run_lens_walk(used_text: &str, reef_bytes: &[u8], axes_bytes: &[u8], repo: &Path, bin: &Path, knobs: Option<&Value>) -> Result<String, String> {
    let dir = unique_tmp_dir("pmu-verify-bundle");
    std::fs::create_dir_all(&dir).map_err(|e| format!("temp dir: {}", e))?;
    let reef_file = dir.join("reef.json");
    let axes_file = dir.join("axes.json");
    std::fs::write(&reef_file, reef_bytes).map_err(|e| format!("temp reef: {}", e))?;
    std::fs::write(&axes_file, axes_bytes).map_err(|e| format!("temp axes: {}", e))?;
    let gi = |key: &str, default: i64| -> String { knobs.and_then(|k| k.get(key)).and_then(|v| v.as_i64()).unwrap_or(default).to_string() };
    let decay = knobs.and_then(|k| k.get("decay")).and_then(|v| v.as_f64()).unwrap_or(0.5).to_string();
    let args: Vec<String> = vec![
        "--lens".into(), "--seed".into(), "matched".into(), "--text".into(), used_text.into(),
        "--repo".into(), repo.to_string_lossy().into_owned(),
        "--reef".into(), reef_file.to_string_lossy().into_owned(),
        "--targets".into(), axes_file.to_string_lossy().into_owned(),
        "--guided-passes".into(), "2".into(),
        "--max-depth".into(), gi("maxDepth", 8),
        "--top-k".into(), gi("topK", 2),
        "--budget".into(), gi("budget", 220),
        "--budget-ms".into(), "600000".into(),
        "--decay".into(), decay,
        "--matched-cut".into(), "--worms".into(), "2".into(), "--worms-orthogonal".into(), "--perm".into(), "8".into(),
    ];
    let out = std::process::Command::new(bin).args(&args).output().map_err(|e| format!("spawn {} failed: {}", bin.display(), e));
    let _ = std::fs::remove_dir_all(&dir);
    let out = out?;
    if !out.status.success() {
        return Err(format!("walk exited {}: {}", out.status, String::from_utf8_lossy(&out.stderr).chars().take(400).collect::<String>()));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: Value = serde_json::from_str(stdout.trim()).map_err(|e| format!("bad walk json: {}", e))?;
    v.get("pixel").and_then(|p| p.as_str()).map(|s| s.to_string()).ok_or_else(|| "binary returned no pixel".to_string())
}

// ── ONE ROW, inside a bundle: signature → text hash → aperture → walk → MATCH/MISMATCH/UNVERIFIABLE
pub struct RowOutcome { pub status: &'static str, pub reason: String }
fn verify_bundle_row(row: &Value, text: &[u8], reef_bytes: &[u8], axes_bytes: &[u8], repo: &Path, bin: &Path) -> RowOutcome {
    let sig = check_row_signature(row);
    if !sig.ok { return RowOutcome { status: "unverifiable", reason: sig.reason }; }
    let row_text_sha = row.get("text_sha").and_then(|v| v.as_str()).unwrap_or("");
    let recomputed_sha = sha12(text);
    if recomputed_sha != row_text_sha {
        return RowOutcome { status: "unverifiable", reason: format!("text: recomputed sha {} does not match text_sha {}", recomputed_sha, row_text_sha) };
    }
    let text_str = String::from_utf8_lossy(text).into_owned();
    let used = match apply_aperture(&text_str, row.get("aperture")) { Ok(u) => u, Err(e) => return RowOutcome { status: "unverifiable", reason: format!("placement: {}", e) } };
    let pixel = match run_lens_walk(&used, reef_bytes, axes_bytes, repo, bin, row.get("knobs")) {
        Ok(p) => p, Err(e) => return RowOutcome { status: "unverifiable", reason: format!("placement: walk failed ({})", e) },
    };
    let row_pixel = row.get("pixel").and_then(|v| v.as_str()).unwrap_or("");
    let same = pixel == row_pixel;
    let mut reason = format!("placement: row {} recomputed {}", row_pixel, pixel);
    // a differing binary is named in the reason as a tripwire, never trusted silently (mirrors
    // verify-row.mjs's own bin_sha check) — never changes the verdict on its own.
    if let (Some(row_bin_sha), Ok(bin_bytes)) = (row.get("bin_sha").and_then(|v| v.as_str()), std::fs::read(bin)) {
        let here = sha256_hex16(&bin_bytes);
        if here != row_bin_sha { reason += &format!("; binary differs from the row's ({} vs {})", row_bin_sha, here); }
    }
    RowOutcome { status: if same { "match" } else { "mismatch" }, reason }
}

pub const BUNDLE_SCHEMA: &str = "thetacog-attestation-bundle/1";

/// verify_bundle(bundle, repo, bin, text_dir) → (verdict, reason, detail-json). Mirrors
/// scripts/pmu/verify-row.mjs's verifyBundle field-for-field where it matters for VB-4 parity
/// (verdict, reason SHAPE, counts, covenant diffs) — see the module doc comment for what is NOT
/// ported (non-head aperture digests) and why (JS-only, refused rather than approximated).
pub fn verify_bundle(bundle: &Value, repo: &Path, bin: &Path, text_dir: Option<&Path>) -> (&'static str, String, Value) {
    if !bundle.is_object() || bundle.get("schema").and_then(|v| v.as_str()) != Some(BUNDLE_SCHEMA) {
        return ("UNVERIFIABLE", format!("schema: not a '{}' object", BUNDLE_SCHEMA), json!({}));
    }
    let env = bundle.get("envelope").cloned().unwrap_or(json!({}));
    let (env_sig_hex, env_pub_hex) = match (env.get("sig").and_then(|v| v.as_str()), env.get("sig_pubkey").and_then(|v| v.as_str())) {
        (Some(s), Some(p)) => (s, p),
        _ => return ("UNVERIFIABLE", "envelope: missing sig or sig_pubkey".into(), json!({})),
    };
    let mut payload = bundle.clone();
    if let Value::Object(m) = &mut payload { m.remove("envelope"); }
    let canon = canonical_stringify(&payload);
    let digest = sha256_bytes(canon.as_bytes());
    let digest_hex = hex(&digest);
    let env_valid: Result<bool, String> = (|| {
        let pk = pubkey_from_hex(env_pub_hex)?;
        let sig = sig_from_hex(env_sig_hex)?;
        Ok(pk.verify(&digest, &sig).is_ok())
    })();
    let env_valid = match env_valid { Ok(v) => v, Err(e) => return ("UNVERIFIABLE", format!("envelope: signature check threw ({})", e), json!({})) };
    if !env_valid {
        return ("UNVERIFIABLE", "envelope: signature invalid over the canonical JSON of the bundle (schema/commit/rows/texts/reef/axes/covenant/bin_sha/aperture)".into(),
            json!({ "envelope": { "sig_valid": false, "digest": digest_hex } }));
    }

    // reef/axes bytes must hash to the blob id the bundle DECLARES for them — pure Rust, no git.
    let reef_b64 = bundle.get("reef").and_then(|r| r.get("bytes_b64")).and_then(|v| v.as_str());
    let reef_blob_declared = bundle.get("reef").and_then(|r| r.get("blob")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let reef_bytes: Option<Vec<u8>> = reef_b64.and_then(|b| general_purpose::STANDARD.decode(b).ok());
    if let (Some(bytes), Some(blob)) = (&reef_bytes, &reef_blob_declared) {
        if &git_blob_id(bytes) != blob { return ("UNVERIFIABLE", format!("reef: packed bytes do not hash to the declared blob {}", blob), json!({})); }
    }
    let axes_b64 = bundle.get("axes").and_then(|r| r.get("bytes_b64")).and_then(|v| v.as_str());
    let axes_blob_declared = bundle.get("axes").and_then(|r| r.get("blob")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let axes_bytes: Option<Vec<u8>> = axes_b64.and_then(|b| general_purpose::STANDARD.decode(b).ok());
    if let (Some(bytes), Some(blob)) = (&axes_bytes, &axes_blob_declared) {
        if &git_blob_id(bytes) != blob { return ("UNVERIFIABLE", format!("axes: packed bytes do not hash to the declared blob {}", blob), json!({})); }
    }

    // ── B21 THE GATE ──────────────────────────────────────────────────────────────────────────
    // `gate` sits inside the same signed tuple checked above — tampering any one of its three
    // fields already broke the envelope signature and this function never reached here
    // (UNVERIFIABLE, never a silent MISMATCH — AB-7). A bundle with no gate at all is pre-B21.
    let gate = match bundle.get("gate") { Some(g) if gate_is_well_formed(g) => g.clone(), _ => return ("UNVERIFIABLE", "gate: no gate pinned (pre-B21 bundle)".into(), json!({})) };
    let collar = gate.get("collar").cloned().unwrap_or(json!({}));
    let gate_tau = collar.get("tau_pct").and_then(|v| v.as_f64()).unwrap();
    let gate_k = collar.get("k_calls").and_then(|v| v.as_f64()).unwrap();
    let gate_breach_max = collar.get("breach_max").and_then(|v| v.as_f64()).unwrap();
    let gate_lane_paths_sha = gate.get("lane_paths_sha").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let gate_module_blob = gate.get("covenant_module_blob").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let gate_note: String;
    if let Some(bytes) = &reef_bytes {
        let recomputed_sha = match lane_paths_from_reef_bytes(bytes) { Ok(v) => sha256_hex(canonical_stringify(&v).as_bytes()), Err(e) => return ("UNVERIFIABLE", format!("gate: lane_paths_sha could not be recomputed ({})", e), json!({})) };
        if recomputed_sha != gate_lane_paths_sha {
            let detail = json!({ "gate": { "pinned": true, "match": false, "collar": collar, "covenant_module_blob": gate_module_blob, "lane_paths_sha": gate_lane_paths_sha, "lane_paths_sha_recomputed": recomputed_sha } });
            return ("MISMATCH", format!("gate drift: lane_paths_sha \u{2014} the bundle's gate names {}, recomputed from its own packed reef {}", gate_lane_paths_sha, recomputed_sha), detail);
        }
    }
    let mut drift_notes: Vec<String> = Vec::new();
    if (gate_tau - DEFAULT_TAU_PCT).abs() > 1e-9 { drift_notes.push(format!("collar tau {} vs this verifier's {}", gate_tau, DEFAULT_TAU_PCT)); }
    if (gate_k - DEFAULT_K_CALLS).abs() > 1e-9 { drift_notes.push(format!("collar k {} vs this verifier's {}", gate_k, DEFAULT_K_CALLS)); }
    if (gate_breach_max - DEFAULT_BREACH_MAX).abs() > 1e-9 { drift_notes.push(format!("collar breach_max {} vs this verifier's {}", gate_breach_max, DEFAULT_BREACH_MAX)); }
    gate_note = if drift_notes.is_empty() { "gate: MATCH".to_string() } else { format!("gate drift: the bundle's {}", drift_notes.join("; ")) };
    let gate_detail = json!({ "pinned": true, "match": true, "collar": collar, "covenant_module_blob": gate_module_blob, "lane_paths_sha": gate_lane_paths_sha });

    let rows = bundle.get("rows").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let texts = bundle.get("texts").cloned().unwrap_or(json!({}));
    let (mut sig_invalid, mut commit_total, mut commit_matched, mut commit_mismatched, mut commit_unverifiable) = (0u64, 0u64, 0u64, 0u64, 0u64);
    let (mut prompt_total, mut prompt_committed, mut prompt_recomputed, mut prompt_mismatched, mut prompt_unverifiable) = (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut row_results: Vec<Value> = Vec::new();
    let reef_for_walk = reef_bytes.clone().unwrap_or_default();
    let axes_for_walk = axes_bytes.clone().unwrap_or_default();

    for row in &rows {
        let sig = check_row_signature(row);
        if !sig.ok {
            sig_invalid += 1;
            row_results.push(json!({ "ref": row.get("ref").cloned().unwrap_or(Value::Null), "source": row.get("source").cloned().unwrap_or(Value::Null), "status": "unverifiable", "reason": sig.reason }));
            continue;
        }
        let source = row.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let is_commit = source.starts_with("commit");
        let row_ref = row.get("ref").cloned().unwrap_or(Value::Null);

        if is_commit {
            commit_total += 1;
            if let (Some(rb), Some(bb)) = (row.get("reef_blob").and_then(|v| v.as_str()), &reef_blob_declared) {
                if rb != bb { commit_unverifiable += 1; row_results.push(json!({ "ref": row_ref, "source": source, "status": "unverifiable", "reason": format!("reef_blob {} differs from the bundle's packed reef {}", rb, bb) })); continue; }
            }
            if let (Some(ab), Some(bb)) = (row.get("axes_blob").and_then(|v| v.as_str()), &axes_blob_declared) {
                if ab != bb { commit_unverifiable += 1; row_results.push(json!({ "ref": row_ref, "source": source, "status": "unverifiable", "reason": format!("axes_blob {} differs from the bundle's packed axes {}", ab, bb) })); continue; }
            }
            let row_text_sha = row.get("text_sha").and_then(|v| v.as_str()).unwrap_or("");
            let bundled_text = texts.get(row_text_sha).and_then(|v| v.as_str());
            let text_bytes = match bundled_text {
                Some(t) => t.as_bytes().to_vec(),
                None => { commit_unverifiable += 1; row_results.push(json!({ "ref": row_ref, "source": source, "status": "unverifiable", "reason": format!("no bundled text for text_sha {}", row_text_sha) })); continue; }
            };
            let outcome = verify_bundle_row(row, &text_bytes, &reef_for_walk, &axes_for_walk, repo, bin);
            match outcome.status { "match" => commit_matched += 1, "mismatch" => commit_mismatched += 1, _ => commit_unverifiable += 1 }
            row_results.push(json!({ "ref": row_ref, "source": source, "status": outcome.status, "reason": outcome.reason }));
        } else {
            prompt_total += 1;
            let row_text_sha = row.get("text_sha").and_then(|v| v.as_str()).unwrap_or("");
            let text_file = text_dir.map(|d| d.join(format!("{}.txt", row_text_sha)));
            if let Some(tf) = &text_file {
                if tf.exists() {
                    let text_bytes = std::fs::read(tf).unwrap_or_default();
                    let outcome = verify_bundle_row(row, &text_bytes, &reef_for_walk, &axes_for_walk, repo, bin);
                    prompt_recomputed += 1;
                    if outcome.status == "mismatch" { prompt_mismatched += 1; } else if outcome.status == "unverifiable" { prompt_unverifiable += 1; }
                    row_results.push(json!({ "ref": row_ref, "source": source, "status": outcome.status, "level": 2, "reason": outcome.reason }));
                    continue;
                }
            }
            prompt_committed += 1;
            row_results.push(json!({ "ref": row_ref, "source": source, "status": "committed", "level": 1,
                "reason": format!("signature valid; text_sha {} committed, not recomputed (supply --text-dir to recompute)", row_text_sha) }));
        }
    }

    let covenant = bundle.get("covenant").cloned().unwrap_or(json!({}));
    let per_turn: Vec<Value> = covenant.get("per_turn").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let claimed = covenant.get("commit_unit").cloned();
    // B21: the bundle's OWN gate.collar decides tau/k/breach_max — NEVER this verifier's defaults
    // and NEVER the claimed commit_unit's own tau_pct/k_calls (AB-8: a bundle pinned looser must
    // recompute against ITS bound, not ours).
    let (tau, k, breach_max) = (gate_tau, gate_k, gate_breach_max);
    let recomputed = recompute_commit_unit(&per_turn, tau, k, breach_max);
    let diffs = if claimed.is_some() { diff_commit_unit(claimed.as_ref(), &recomputed) } else { vec!["covenant.commit_unit is absent from the bundle".to_string()] };

    let any_unverifiable = sig_invalid > 0 || commit_unverifiable > 0 || prompt_unverifiable > 0;
    let any_mismatch = commit_mismatched > 0 || prompt_mismatched > 0 || !diffs.is_empty();
    let verdict: &'static str = if any_unverifiable { "UNVERIFIABLE" } else if any_mismatch { "MISMATCH" } else { "MATCH" };
    let reason = format!(
        "rows {} \u{b7} commit rows {} ({} matched / {} mismatched{}) \u{b7} prompt rows {} committed ({}) / recomputed ({}{}) \u{b7} covenant claim recomputed: {} \u{b7} envelope sig valid{} \u{b7} {}",
        rows.len(), commit_total, commit_matched, commit_mismatched,
        if commit_unverifiable > 0 { format!(" / {} unverifiable", commit_unverifiable) } else { String::new() },
        prompt_total, prompt_committed, prompt_recomputed,
        if prompt_mismatched > 0 || prompt_unverifiable > 0 { format!(", {} mismatched, {} unverifiable", prompt_mismatched, prompt_unverifiable) } else { String::new() },
        if diffs.is_empty() { "yes".to_string() } else { format!("no \u{2014} {}", diffs.join("; ")) },
        if sig_invalid > 0 { format!(" \u{b7} {} row(s) failed signature verification", sig_invalid) } else { String::new() },
        gate_note,
    );
    let detail = json!({
        "verdict": verdict, "reason": reason,
        "envelope": { "sig_valid": true, "digest": digest_hex },
        "gate": gate_detail,
        "rows": row_results,
        "covenant": { "claimed": claimed, "recomputed": {
            "turns": recomputed.turns, "calls": recomputed.calls, "distinct_paths": recomputed.distinct_paths,
            "breach": recomputed.breach, "off_lane_mean": recomputed.off_lane_mean,
            "pass_per_turn_all": bool_as_json(recomputed.pass_per_turn_all), "pass_per_commit": bool_as_json(recomputed.pass_per_commit),
            "tau_pct": tau, "k_calls": k, "breach_max": breach_max }, "diffs": diffs },
        "counts": { "rows": rows.len(), "sig_invalid": sig_invalid, "commit_rows": commit_total, "commit_matched": commit_matched,
            "commit_mismatched": commit_mismatched, "commit_unverifiable": commit_unverifiable, "prompt_rows": prompt_total,
            "prompt_committed": prompt_committed, "prompt_recomputed": prompt_recomputed, "prompt_mismatched": prompt_mismatched,
            "prompt_unverifiable": prompt_unverifiable },
    });
    (verdict, reason, detail)
}

pub const EXIT_CODE_MATCH: i32 = 0;
pub const EXIT_CODE_MISMATCH: i32 = 1;
pub const EXIT_CODE_UNVERIFIABLE: i32 = 2;

/// pmu-onchip --verify-bundle <bundle.json> [--text-dir <dir>] [--repo <path>] [--json]
pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let bundle_path = match arg("--verify-bundle") {
        Some(p) => p,
        None => { println!("UNVERIFIABLE"); println!("reason: usage: pmu-onchip --verify-bundle <bundle.json> [--text-dir <dir>] [--repo <path>] [--json]"); std::process::exit(EXIT_CODE_UNVERIFIABLE); }
    };
    let text_dir = arg("--text-dir").map(PathBuf::from);
    let repo = arg("--repo").map(PathBuf::from).unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let want_json = args.iter().any(|a| a == "--json");

    let bytes = match std::fs::read(&bundle_path) {
        Ok(b) => b,
        Err(e) => { println!("UNVERIFIABLE"); println!("reason: signature: could not read {} ({})", bundle_path, e); std::process::exit(EXIT_CODE_UNVERIFIABLE); }
    };
    let bundle: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => { println!("UNVERIFIABLE"); println!("reason: signature: could not parse {} ({})", bundle_path, e); std::process::exit(EXIT_CODE_UNVERIFIABLE); }
    };
    let bin = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("pmu-onchip"));

    let (verdict, reason, detail) = verify_bundle(&bundle, &repo, &bin, text_dir.as_deref());
    if want_json {
        // early-exit branches inside verify_bundle (schema/envelope failures) hand back a partial
        // or empty `detail` — verdict/reason are ALWAYS layered on top here so `--json` output
        // never omits them, whichever branch produced the tuple.
        let mut out = detail;
        if !out.is_object() { out = json!({}); }
        if let Value::Object(m) = &mut out {
            m.insert("verdict".into(), json!(verdict));
            m.insert("reason".into(), json!(reason));
        }
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else { println!("{}", verdict); println!("reason: {}", reason); }
    std::process::exit(match verdict { "MATCH" => EXIT_CODE_MATCH, "MISMATCH" => EXIT_CODE_MISMATCH, _ => EXIT_CODE_UNVERIFIABLE });
}

// ── VB-1..VB-5 (spec §8.58 stub) ───────────────────────────────────────────────────────────────
// A throwaway ed25519 identity, deterministic (SigningKey::from_bytes over a fixed seed rather than
// SigningKey::generate — no `rand` crate is a dependency here, only `rand_core`/`getrandom` pulled
// in transitively, and a fixed seed is exactly as "throwaway" as a freshly generated one for a test
// that never leaves this process). NEVER the room's real host-derived identity (attest.rs's key).
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn test_key() -> SigningKey { SigningKey::from_bytes(&[7u8; 32]) }
    fn sign_row(mut row: Value, key: &SigningKey) -> Value {
        let sig = key.sign(canonical_tuple(&row).as_bytes());
        let pk_hex = hex(&key.verifying_key().to_bytes());
        if let Value::Object(m) = &mut row { m.insert("sig".into(), json!(hex(&sig.to_bytes()))); m.insert("sig_pubkey".into(), json!(pk_hex)); }
        row
    }
    fn base_row(text_sha: &str, pixel: &str) -> Value {
        json!({ "ts": "2026-09-17T00:00:00.000Z", "source": "turn", "text_sha": text_sha, "pixel": pixel,
            "reef_sha": "aaaaaaaaaaaaaaaa", "axes_sha": "bbbbbbbbbbbbbbbb", "bin_sha": "cccccccccccccccc" })
    }
    fn sign_envelope(payload: &Value, key: &SigningKey) -> Value {
        let canon = canonical_stringify(payload);
        let digest = sha256_bytes(canon.as_bytes());
        let sig = key.sign(&digest);
        json!({ "sig": hex(&sig.to_bytes()), "sig_pubkey": hex(&key.verifying_key().to_bytes()), "sig_over": "sha256 of the canonical JSON of everything above" })
    }
    /// A minimal but complete bundle: one PROMPT row (source "turn", no walk needed — the whole
    /// point of VB-2/VB-3 is to exercise the envelope-signature and covenant-diff logic without
    /// depending on the compiled binary being present or on git, so `cargo test` runs these with
    /// no external process at all), signed with the throwaway key end to end.
    fn minimal_bundle(commit_unit: Value, key: &SigningKey) -> Value {
        let row = sign_row(base_row("d1a42d2c78da", "A1,A"), key);
        let mut payload = json!({
            "schema": BUNDLE_SCHEMA, "commit": "0000000000", "rows": [row], "texts": {},
            "reef": Value::Null, "axes": Value::Null, "bin_sha": "cccccccccccccccc", "aperture": Value::Null,
            "covenant": { "per_turn": [ { "ts": "2026-09-17T00:00:00.000Z", "session": "s", "domain": "blog-content", "off_lane": 81, "calls": 1, "touched_paths": [], "delivered": ["a", "b"], "breach": 0 } ],
                          "commit_unit": commit_unit },
            "gate": { "collar": { "tau_pct": 25, "k_calls": 20, "breach_max": 0 }, "covenant_module_blob": "0000000000000000000000000000000000000a", "lane_paths_sha": "0000000000000000000000000000000000000000000000000000000000ab" },
        });
        let envelope = sign_envelope(&payload, key);
        if let Value::Object(m) = &mut payload { m.insert("envelope".into(), envelope); }
        payload
    }
    fn correct_commit_unit() -> Value { json!({ "turns": 1, "calls": 1, "distinct_paths": 0, "breach": 0, "off_lane_mean": 81, "pass_per_turn_all": 0, "pass_per_commit": 0, "tau_pct": 25, "k_calls": 20 }) }

    // VB-1: the shipped demo fixture verifies MATCH, exit 0, first line the bare token. This one
    // NEEDS the real compiled binary + git-free packed bytes; it is exercised as a shell command
    // against the release build in the session report (cargo test cannot assume a release binary
    // exists at a fixed path), not as a #[cfg(test)] here — see the report for the exact command
    // and output. The remaining four properties below do not need the binary at all.
    #[test]
    fn vb2_every_one_byte_tamper_of_a_signed_field_reads_unverifiable() {
        let key = test_key();
        let clean = minimal_bundle(correct_commit_unit(), &key);
        // clean bundle must itself be UNVERIFIABLE only for the reason "no binary" NEVER for a bad
        // signature — prove the baseline is genuinely well-signed first (envelope check alone, by
        // calling verify_bundle with a bin path that does not exist; the row is a prompt row with no
        // --text-dir, so it never reaches the walk and reads "committed", not unverifiable).
        let (v, r, _) = verify_bundle(&clean, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
        assert_eq!(v, "MATCH", "clean bundle must verify MATCH with no walk needed (prompt row, no --text-dir): {}", r);

        // tamper each row-level signed field
        for field in SIG_FIELDS {
            let mut tampered = clean.clone();
            if let Some(row) = tampered.get_mut("rows").and_then(|r| r.as_array_mut()).and_then(|a| a.get_mut(0)) {
                let cur = row.get(field).cloned().unwrap_or(Value::Null);
                let new_val = match cur { Value::String(s) => json!(format!("{}x", s)), _ => json!("x") };
                row.as_object_mut().unwrap().insert(field.to_string(), new_val);
            }
            let (v, r, _) = verify_bundle(&tampered, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
            assert_eq!(v, "UNVERIFIABLE", "tampering row field '{}' must read UNVERIFIABLE, got {} ({})", field, v, r);
        }
        // tamper bundle-level fields covered by the envelope signature but outside any row
        for path in ["bin_sha", "commit"] {
            let mut tampered = clean.clone();
            if let Value::Object(m) = &mut tampered { m.insert(path.to_string(), json!("TAMPERED")); }
            let (v, _, _) = verify_bundle(&tampered, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
            assert_eq!(v, "UNVERIFIABLE", "tampering bundle field '{}' must read UNVERIFIABLE (breaks the envelope signature)", path);
        }
        // B21/AB-7: tampering the gate (post-signature, inside the same signed tuple) must also
        // break the envelope signature — UNVERIFIABLE, never a silent MISMATCH.
        {
            let mut tampered = clean.clone();
            if let Some(gate) = tampered.get_mut("gate") { gate.as_object_mut().unwrap().insert("covenant_module_blob".into(), json!("tampered-blob-id")); }
            let (v, r, _) = verify_bundle(&tampered, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
            assert_eq!(v, "UNVERIFIABLE", "tampering gate.covenant_module_blob post-signature must read UNVERIFIABLE, got {} ({})", v, r);
        }
        // and the envelope's own sig/sig_pubkey, tampered directly
        for field in ["sig", "sig_pubkey"] {
            let mut tampered = clean.clone();
            if let Some(env) = tampered.get_mut("envelope") { env.as_object_mut().unwrap().insert(field.to_string(), json!("00")); }
            let (v, _, _) = verify_bundle(&tampered, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
            assert_eq!(v, "UNVERIFIABLE", "tampering envelope.{} must read UNVERIFIABLE", field);
        }
    }
    #[test]
    fn vb3_a_disagreeing_covenant_claim_reads_mismatch_with_both_values_in_the_reason() {
        let key = test_key();
        let mut wrong = correct_commit_unit();
        wrong.as_object_mut().unwrap().insert("off_lane_mean".into(), json!(999));   // honestly signed, wrong number
        let bundle = minimal_bundle(wrong, &key);
        let (v, r, detail) = verify_bundle(&bundle, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
        assert_eq!(v, "MISMATCH", "a wrong (but honestly signed) covenant claim must read MISMATCH, got {} ({})", v, r);
        assert!(r.contains("999") && r.contains("81"), "the reason must carry both the claimed (999) and recomputed (81) values: {}", r);
        let diffs = detail["covenant"]["diffs"].as_array().unwrap();
        assert!(diffs.iter().any(|d| d.as_str().unwrap().contains("off_lane_mean")), "the diff list must name the disagreeing field: {:?}", diffs);
    }
    #[test]
    fn vb2_clean_bundle_with_correct_covenant_matches() {
        let key = test_key();
        let bundle = minimal_bundle(correct_commit_unit(), &key);
        let (v, _, detail) = verify_bundle(&bundle, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
        assert_eq!(v, "MATCH");
        assert_eq!(detail["covenant"]["diffs"].as_array().unwrap().len(), 0);
    }
    #[test]
    fn b21_a_bundle_with_no_gate_reads_unverifiable_pre_b21() {
        let key = test_key();
        let mut bundle = minimal_bundle(correct_commit_unit(), &key);
        // strip the gate WITHOUT re-signing (simulates a genuine pre-B21 bundle: the envelope was
        // signed over a payload that never had a `gate` key, so removing it here and re-signing
        // over the gate-free payload is the honest reproduction, not a tamper).
        if let Value::Object(m) = &mut bundle { m.remove("gate"); }
        let mut payload = bundle.clone();
        if let Value::Object(m) = &mut payload { m.remove("envelope"); }
        let envelope = sign_envelope(&payload, &key);
        if let Value::Object(m) = &mut bundle { m.insert("envelope".into(), envelope); }
        let (v, r, _) = verify_bundle(&bundle, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
        assert_eq!(v, "UNVERIFIABLE");
        assert!(r.contains("no gate pinned"), "reason must name the missing gate: {}", r);
    }
    #[test]
    fn b21_ab8_the_bundles_own_breach_max_governs_the_recompute_never_this_verifiers_default() {
        // one turn touching 4 paths, 2 delivered — breach_share_union lands at exactly 0.5 (half
        // the distinct touched paths lie outside the delivered set). off_lane 10 clears tau=25;
        // calls 1 clears k=20 — breach_max is the ONLY collar leg this test isolates.
        let per_turn = json!([ { "ts": "2026-09-17T00:00:00.000Z", "session": "s", "domain": "blog-content", "off_lane": 10, "calls": 1, "touched_paths": ["x", "y", "z", "w"], "delivered": ["x", "y"] } ]);
        let loose = recompute_commit_unit(per_turn.as_array().unwrap(), 25.0, 20.0, 0.5);   // a bundle pinned at breach_max 0.5
        let strict = recompute_commit_unit(per_turn.as_array().unwrap(), 25.0, 20.0, DEFAULT_BREACH_MAX);   // this verifier's own default (0.0)
        assert_eq!(loose.breach, Some(0.5), "setup: breach must land at exactly 0.5 for this test to isolate the collar");
        assert_eq!(loose.pass_per_commit, Some(true), "a bundle's own breach_max 0.5 must PASS a breach of 0.5 (AB-8)");
        assert_eq!(strict.pass_per_commit, Some(false), "this verifier's own default breach_max 0.0 must FAIL the same 0.5 breach if it were (wrongly) used instead");
    }
    #[test]
    fn b21_ab9_a_lane_paths_sha_disagreeing_with_the_packed_reef_reads_mismatch() {
        let key = test_key();
        let reef = json!({ "domains": [ { "domain": "blog-content", "tools": "src/content/blog, scripts/validate-mdx.sh" } ] });
        let reef_bytes = serde_json::to_vec(&reef).unwrap();
        let reef_blob = git_blob_id(&reef_bytes);
        let row = sign_row(base_row("d1a42d2c78da", "A1,A"), &key);
        let mut payload = json!({
            "schema": BUNDLE_SCHEMA, "commit": "0000000000", "rows": [row], "texts": {},
            "reef": { "blob": reef_blob, "bytes_b64": general_purpose::STANDARD.encode(&reef_bytes) },
            "axes": Value::Null, "bin_sha": "cccccccccccccccc", "aperture": Value::Null,
            "covenant": { "per_turn": [], "commit_unit": correct_commit_unit() },
            "gate": { "collar": { "tau_pct": 25, "k_calls": 20, "breach_max": 0 }, "covenant_module_blob": "0000000000000000000000000000000000000a", "lane_paths_sha": "0000000000000000000000000000000000000000000000000000000000ab" },
        });
        let envelope = sign_envelope(&payload, &key);
        if let Value::Object(m) = &mut payload { m.insert("envelope".into(), envelope); }
        let (v, r, _) = verify_bundle(&payload, Path::new("."), Path::new("/nonexistent-binary-for-test"), None);
        assert_eq!(v, "MISMATCH", "a gate.lane_paths_sha that does not match the packed reef must read MISMATCH, got {} ({})", v, r);
        assert!(r.contains("lane_paths_sha"), "{}", r);
    }
    #[test]
    fn lane_paths_from_reef_bytes_matches_expected_cleanup_and_sha_is_reproducible() {
        let reef = json!({ "domains": [ { "domain": "blog-content", "tools": "src/content/blog/*, scripts/validate-mdx.sh, blog, ~ignored, bareword" } ] });
        let bytes = serde_json::to_vec(&reef).unwrap();
        let a = lane_paths_from_reef_bytes(&bytes).unwrap();
        let b = lane_paths_from_reef_bytes(&bytes).unwrap();
        assert_eq!(canonical_stringify(&a), canonical_stringify(&b), "the same reef bytes must reproduce byte-identically");
        let paths = a["blog-content"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>();
        assert!(paths.contains(&"src/content/blog"), "the '/*' suffix must be stripped: {:?}", paths);
        assert!(paths.contains(&"scripts/validate-mdx.sh"), "{:?}", paths);
        assert!(paths.contains(&"src/content/blog"), "the bare 'blog' token must map to src/content/blog: {:?}", paths);
        assert!(!paths.iter().any(|p| p.contains("ignored")), "a token starting with '~' must be dropped: {:?}", paths);
        assert!(!paths.contains(&"bareword"), "a token with neither '/' nor '.' must be dropped: {:?}", paths);
    }
    #[test]
    fn git_blob_id_matches_known_git_values() {
        // git hash-object for an empty file is the well-known constant e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
        assert_eq!(git_blob_id(b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
        // git hash-object for a file containing "hello\n" is the well-known constant below
        assert_eq!(git_blob_id(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
    }
    #[test]
    fn canonical_tuple_matches_the_js_shape_field_order_and_escaping() {
        let row = json!({ "ts": "t", "source": "s", "text_sha": "x", "pixel": "A,A", "reef_sha": "r", "axes_sha": "a", "bin_sha": "b", "extra": "ignored" });
        assert_eq!(canonical_tuple(&row), r#"{"ts":"t","source":"s","text_sha":"x","pixel":"A,A","reef_sha":"r","axes_sha":"a","bin_sha":"b"}"#);
        let missing = json!({ "ts": "t" });
        assert_eq!(canonical_tuple(&missing), r#"{"ts":"t","source":null,"text_sha":null,"pixel":null,"reef_sha":null,"axes_sha":null,"bin_sha":null}"#);
    }
}
