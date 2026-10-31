// src/lib.rs — the monorepo `intentguard` crate (C490a): the ten modules pmu-onchip and IntentGuard share, and the
// vendored Node/Chromium zlib they link (build.rs, vendor/zlib).
//
// This is the only copy of their source. pmu-onchip (.thetacog/pmu and packages/thetacog-mcp/pmu-rust) depends on it
// by path; scripts/intentguard/carve.mjs copies it into IntentGuard byte for byte, where IntentGuard's own lib.rs
// (packages/intentguard/own/src/lib.rs) adds the lens, the card, the ops and the Node addon's doors on top. It sits
// inside the thetacog-mcp package so the npm tarball and the public mirror carry it (npm packs no symlinks), and a
// stranger's build resolves the path dep with nothing outside the package; IntentGuard itself is `publish = false`.
//
// What this crate is sufficient for: the same input bytes reach the same walk, placement arithmetic, signature and
// PNG bytes in both binaries. NOT sufficient for: whether either binary's output is right (Rice).

pub mod aperture;
pub mod attest;
pub mod ballistic;
// C79 — boundary_probe and pointer_chase READ this machine (Instant, cache-line latency, cpu count): rungs 2/3 of
// AXIOM 0. build.rs sets `portable_walker` on wasm32-unknown-unknown and under `--features wasm`; there they are
// gated out, never deleted — the portable walker places, it does not probe. Guard: tests/ops/wasm-walker-builds.test.mjs
#[cfg(not(portable_walker))]
pub mod boundary_probe;
pub mod lattice;
// The boundary odometer (2026-10-14): k_E charged on an integer crossing count read off 64-byte-aligned anchors. No clock,
// no fs, no counter read — it places, so it rides the portable walker too.
pub mod odometer;
// C830 — the Tier 2 calibration of the odometer: the same aligned cells walked under perf_event_open (Linux, a raw
// syscall, no new crate). APPARATUS SCOPE (AXIOM 0 rung 4), never the shipped default; it reads a counter and /proc, so it
// sits behind the same gate as the machine probes above. Guard: tests/vna/c830-build-the-hardware-boundary-validation-as.test.mjs
#[cfg(not(portable_walker))]
pub mod odometer_probe;
// C832 — the fleet scaling bench: N seeded-LCG agents on one 144-grid, cohort A by messages, cohort B by rank reads; integers
// only, no clock, no fs, so it rides the portable walker too.
pub mod fleet_bench;
// C831 — the fleet receipt: the rooms' commit-reality rows since a sha folded to `fleet=N · unison=U · drift_events=Σc ·
// kE_total · root_hash`, integers and exact rationals only. The fold is portable; the tape read and the CLI arm sit behind
// the crate's non-portable cfg inside the module (fs, git).
pub mod fleet;
pub mod png;
#[cfg(not(portable_walker))]
pub mod pointer_chase;
pub mod regions;
pub mod sense;
pub mod signature;
// C79 — the libc vendor/zlib links on wasm32-unknown-unknown (malloc/calloc/free) and the C-ABI door a host calls.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub mod wasm_libc;

// aperture.rs and png.rs reach the vendored zlib as `crate::lens::…`, which in IntentGuard is the lens module.
#[path = "zlib.rs"]
mod lens;

// C753: the walk itself (lens.rs, 1934 lines — read_text, the definer walk, the thread composition) plus the two
// files it carries data for (hud_grid.rs, hud_config.rs) moved here from the two pmu-onchip bin crates, where they
// were a HAND-KEPT byte-identical pair (tests/pmu-simulator/rust-crate-mirror.test.mjs). Named `walk_lens`, never
// `lens` — that name is already the zlib FFI module four lines up (C490a's existing alias, aperture.rs/png.rs's
// door to the vendored deflate). The two symbols coexist the way IntentGuard's own carved crate already proves safe:
// its lens.rs embeds the SAME zlib extern block this file's does, and ships. Every item the walk needed `pub(crate)`
// visibility for inside a bin crate is now `pub` — the only textual change the move made to the walk itself.
// It calls std::fs, std::process and std::env (reading snippet libraries, exiting on a bad CLI arg, reading the
// session's TERM), so it sits behind the same `portable_walker` cfg the machine probes above use: the portable
// walker places, it does not read a filesystem. hud_grid.rs carries no such call outside `#[cfg(test)]` and stays
// unconditional so a wasm host can still render a grid from a heat field it was handed.
#[cfg(not(portable_walker))]
pub mod walk_lens;
pub mod hud_grid;
#[cfg(not(portable_walker))]
pub mod hud_config;
// The single-shot composition (window → walk_lens::read_text → fold) pmu-onchip's own hud.rs runs per text event
// inside its streaming server (C748) — reachable here for a caller that never opens that server (the NAPI addon,
// C753's second ask; a script). Needs the same fs/env the walk needs, so the same gate.
#[cfg(not(portable_walker))]
pub mod hud;

/// C769 — THE NAPI-BINDABLE SURFACE. Replays an event array through the HUD grid with EXPLICIT `now` values (no clock is
/// read) and returns ONE json object: `{ "results": [per-step result], "grid", "archetype", "freezeText", "askLine" }`.
/// `events_json` is an array of steps in the shape of tests/fixtures/hud-grid/*.json (`op` = apply | tick | select | defend |
/// window | seed, with `now`, `cells`, `n`, `sentence`, `text`); `config_json` is a hud-config document (`{value, source}` or
/// bare keys; "" or "{}" reads the defaults). A bad document returns `{"error": ...}`, never a panic. The walk
/// (lens::read_text) is NOT here: it stays in the pmu-onchip binary (docs/specs/vna/HUD-NAPI-CONTRACT.md).
/// Sufficient for: the grid a stream of events places. NOT sufficient for: whether the readings in the events are right.
#[cfg(not(portable_walker))]
pub fn hud_grid_json(events_json: &str, config_json: &str) -> String {
    grid_json(events_json, config_json)
}

#[cfg(not(portable_walker))]
use serde_json::{json, Value};

/// Replays an event array through the HUD grid with explicit `now` values; see `hud_grid_json` in lib.rs for the shape.
#[cfg(not(portable_walker))]
fn grid_json(events_json: &str, config_json: &str) -> String {
    let err = |m: String| json!({ "error": m }).to_string();
    let cfg_doc: Value = if config_json.trim().is_empty() {
        json!({})
    } else {
        match serde_json::from_str(config_json) {
            Ok(v) => v,
            Err(e) => return err(format!("config does not parse: {e}")),
        }
    };
    let events: Vec<Value> = match serde_json::from_str::<Value>(events_json) {
        Ok(Value::Array(a)) => a,
        Ok(Value::Object(o)) => match o.get("steps").and_then(|s| s.as_array()) {
            Some(a) => a.clone(),
            None => return err("events must be an array (or an object with a steps array)".into()),
        },
        Ok(_) => return err("events must be an array".into()),
        Err(e) => return err(format!("events do not parse: {e}")),
    };
    let cfg = crate::hud_config::from_value(&cfg_doc).grid();
    let mut g = crate::hud_grid::create_grid(&cfg);
    let mut results = Vec::new();
    for ev in &events {
        let now = ev.get("now").and_then(|v| v.as_u64()).unwrap_or(0);
        let n = ev.get("n").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let op = ev.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let r = match op {
            "apply" => {
                let cells = ev.get("cells").and_then(|c| c.as_array()).cloned().unwrap_or_default();
                crate::hud_grid::apply_reading(&cfg, &mut g, &cells, now);
                Value::Null
            }
            "tick" => {
                crate::hud_grid::tick(&cfg, &mut g, now);
                Value::Null
            }
            "select" => crate::hud_grid::select(&cfg, &mut g, n, now),
            "defend" => crate::hud_grid::defend(&cfg, &mut g, n, ev.get("sentence").and_then(|v| v.as_str()).unwrap_or(""), now),
            "window" => {
                crate::hud_grid::set_window_text(&mut g, ev.get("text").and_then(|v| v.as_str()).unwrap_or(""));
                Value::Null
            }
            "opacity" => json!(crate::hud_grid::opacity(&cfg, g.slots.get(n).and_then(|c| c.as_ref()), now)),
            "seed" => {
                crate::hud_grid::seed(&mut g, ev.get("cells").and_then(|c| c.as_array()).map(|a| a.as_slice()).unwrap_or(&[]));
                Value::Null
            }
            other => return err(format!("unknown op: {other:?}")),
        };
        results.push(r);
    }
    json!({
        "results": results,
        "grid": crate::hud_grid::state_json(&g),
        "archetype": crate::hud_grid::archetype(&g),
        "freezeText": crate::hud_grid::freeze_text(&g),
        "askLine": crate::hud_grid::ask_line(&g),
    })
    .to_string()
}
