// .thetacog/pmu/src/resident.rs
//
// G2 — THE RESIDENT LOOP. One long-lived attested process: NDJSON requests over
// stdin, one tagged JSON response per request over stdout. The chip is loaded
// once and served many times — G7 measured ~2x vs one-shot spawns.
//
// Ops: ingest (M1 streaming read), sense (on-chip localization — same
// sense::sense_lattice as --sense), ping, shutdown.
//   {"op":"ingest","id":1,"path":"…jsonl","offset":0}
//   {"op":"sense","id":2,"claims":[…],"targets":[…],"target_lens":[…],"shingle_mode":"word"}
//   {"op":"ping","id":3}   {"op":"shutdown","id":4}
//
// --sign (V5, the resident's OATH · Δ7): ed25519 over sha256 of EXACTLY the bytes
// emitted this session; a single attestation line is appended at drain. Node
// CHECKS it (daemon-verify.mjs), never produces it. The key is the instrument;
// the oath — "these bytes ran on this host" — is the artifact.
//
// Reliability: one bad request answers with an error line and the loop keeps
// serving. EOF or shutdown drains cleanly (and signs, if asked).

use crate::{attest, sense, signature, transcript};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{self, BufRead, Write};

pub fn run_resident_loop(sign: bool) -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut hasher = Sha256::new();

    // emit: hash (when signing) the EXACT bytes written, then write+flush them.
    macro_rules! emit {
        ($val:expr) => {{
            let line = $val.to_string();
            if sign {
                hasher.update(line.as_bytes());
                hasher.update(b"\n");
            }
            writeln!(out, "{}", line)?;
            out.flush()?;
        }};
    }

    for line in stdin.lock().lines() {
        let line = line?;
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(t) {
            Ok(v) => v,
            Err(e) => {
                emit!(json!({"error": format!("bad json: {e}")}));
                continue;
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("");

        match op {
            "shutdown" => {
                emit!(json!({"id": id, "ok": true, "bye": true}));
                break;
            }
            "ping" => {
                emit!(json!({"id": id, "ok": true}));
            }
            "ingest" => {
                let path = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let offset = req.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
                match transcript::read_new_lines(path, offset) {
                    Ok(r) => {
                        let first = transcript::first_user_prompt(path).unwrap_or_default();
                        let thinking = transcript::thinking_text(&r.lines);
                        let reality = transcript::assistant_text(&r.lines);
                        emit!(json!({
                            "id": id, "op": "ingest", "path": path,
                            "newOffset": r.new_offset, "lineCount": r.lines.len(),
                            "firstUserPrompt": first,
                            "intentThinking": thinking,
                            "reality": reality,
                        }));
                    }
                    Err(e) => emit!(json!({"id": id, "error": format!("read: {e}")})),
                }
            }
            "sense" => {
                // on-chip sense IN the resident loop (Δ3): the same
                // sense::sense_lattice the one-shot --sense uses, no extra spawn.
                let claims: Vec<String> = req.get("claims").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
                let targets: Vec<String> = req.get("targets").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
                let target_lens: Vec<usize> = req.get("target_lens")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_else(|| vec![1; targets.len()]);
                let simhash_only = req.get("simhash_only").and_then(|v| v.as_bool()).unwrap_or(false);
                let mode = match req.get("shingle_mode").and_then(|v| v.as_str()).unwrap_or("") {
                    "" | "char" => signature::ShingleMode::Char,
                    "word" => signature::ShingleMode::Word,
                    other => {
                        emit!(json!({"id": id, "error": format!("unknown shingle_mode: {other}")}));
                        continue;
                    }
                };
                let res = sense::sense_lattice(&claims, &targets, &target_lens, simhash_only, mode);
                emit!(json!({
                    "id": id, "op": "sense",
                    "scores": res.rows.iter().map(|r| r.score).collect::<Vec<_>>(),
                    "ncd_scores": res.rows.iter().map(|r| r.ncd).collect::<Vec<_>>(),
                    "best_idx": res.rows.iter().map(|r| r.best_idx).collect::<Vec<_>>(),
                    "agreement": res.rows.iter().map(|r| r.agreement).collect::<Vec<_>>(),
                    "claim_best_anchor": res.claim_best_anchor,
                    "claim_best_score": res.claim_best_score,
                }));
            }
            other => emit!(json!({"id": id, "error": format!("unknown op: {other}")})),
        }
    }

    // the resident's OATH (V5 · Δ7): ed25519 over sha256 of EXACTLY the emitted
    // bytes. daemon-verify.mjs splits at this trailing line and re-checks.
    if sign {
        match attest::host_signing_key() {
            Ok(key) => {
                let fin = hasher.finalize();
                let mut digest = [0u8; 32];
                digest.copy_from_slice(&fin);
                writeln!(out, "{}", attest::attestation_line_for_digest(&digest, &key, &crate::chrono_like_ts()))?;
                out.flush()?;
            }
            Err(e) => {
                eprintln!("pmu-onchip --resident --sign: {e}");
                std::process::exit(2);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    // The loop reads stdin, so it's exercised by an integration smoke test
    // (echo NDJSON | pmu-onchip --resident [--sign] | daemon-verify) rather than
    // a unit test; per-op logic delegates to transcript:: / sense:: which are
    // unit-tested in their own modules.
    #[test]
    fn module_compiles() {
        assert!(true);
    }
}
