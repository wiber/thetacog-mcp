// .thetacog/pmu/src/main.rs
//
// ON-CHIP PMU v0 — the Rust daemon. The ballistic walk on the metal.
//
// This is the metal port of src/app/pmu-simulator/pmu-onchip.mjs. It is
// NOT a simulation: the pointer-chase measures real cache-tier latency
// on this silicon, the gate IS the hardware XOR + popcount instruction,
// and every run prints the canonical matrix multiple.
//
// It lives in .thetacog/pmu/ so the commit hook can drive it: a commit
// changes the reality map, the hook re-fires the walk, the daemon
// renders whether we did it.
//
// Build:  cargo build --release --manifest-path .thetacog/pmu/Cargo.toml
// Run:    .thetacog/pmu/target/release/pmu-onchip

// C490a: the ten modules pmu-onchip shares with IntentGuard live in the `intentguard` crate (packages/thetacog-mcp/intentguard,
// see Cargo.toml). Imported at the root so every `crate::ballistic::…` path in this crate resolves as it did when they were
// declared here. C753: lens.rs, hud_grid.rs and hud_config.rs moved into that same crate (as walk_lens, never `lens` — that
// name there is already the zlib FFI alias) for the same reason the first ten did: one source, not a hand-kept pair with
// packages/thetacog-mcp/pmu-rust (tests/pmu-simulator/rust-crate-mirror.test.mjs). `walk_lens as lens` keeps every
// `crate::lens::…` path in this crate resolving exactly as it did when `mod lens;` declared it here.
use intentguard::{aperture, attest, ballistic, boundary_probe, hud_config, hud_grid, lattice, png, pointer_chase, regions, sense, signature, walk_lens as lens};
mod action;
mod counter;
mod gate;
mod gemini;
mod matrix;
mod resident;
mod throughput;
mod transcript;
mod maintain;
mod harness;
mod volatility;
mod envelope;
mod verify;
mod aperture_read;
mod steering_read;
mod job_units_read;
mod steer_plan;
mod ledger_shas;
mod path_predict;
mod hud;   // C748: --hud-serve, the streaming HUD server (stdin NDJSON events in, JSON lines out)
mod door;   // C612b: --door-serve, the drift note's door + slot + anchor NCD in one long-lived process

use pointer_chase::chase;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct SenseInput {
    claims: Vec<String>,
    targets: Vec<String>,
    target_lens: Vec<usize>,
    // SimHash-only (skip gzip-NCD) — set for 20,736-cell resolution where the
    // ~5M NCD pairs would cost ~60s; the 144-node canonical case leaves it false.
    #[serde(default)]
    simhash_only: bool,
    // Shingler for the SimHash witness. ABSENT/"" /"char" = the historical
    // char-4-gram path — the EXPLICIT default so every existing caller
    // (commit-triptych ingest et al.) stays bit-identical. "word" = the
    // wordShingles port (the JS production-ingest path: word unigrams +
    // bigrams, STOPWORDS stripped) — opt-in, bit-exact with
    // simhash(text, 64, wordShingles) in signature.mjs.
    #[serde(default)]
    shingle_mode: String,
}

// On-chip sense output. `scores` is the PRIMARY witness (SimHash); `ncd_scores`
// the cheap secondary; `best_idx` the claim fragment each anchor matched (feeds
// the hover payload); `agreement` the scale-free dual-witness hallucination flag
// (both witnesses agreeing on the same fragment).
#[derive(Serialize)]
struct SenseOutput {
    scores: Vec<f32>,
    ncd_scores: Vec<f32>,
    best_idx: Vec<usize>,
    agreement: Vec<bool>,
    // Competitive inversion (per claim): the anchor it matches best + that score.
    // JS inverts this to assign each anchor a DISTINCT fragment for the hover.
    claim_best_anchor: Vec<usize>,
    claim_best_score: Vec<f32>,
}

#[derive(Deserialize)]
struct ByteFootprintInput {
    doc: String,
}

#[derive(Serialize)]
struct ByteFootprintOut {
    doc_len: usize,
    ns_l2: f64,
    ns_slc: f64,
    ns_dram: f64,
    method: &'static str,
}

// run_byte_footprint — the candidate independent physical witness. Reads {doc}
// from stdin, measures byte-locality cache timing at L2/SLC/DRAM working-set
// sizes (see pointer_chase::byte_footprint), emits the footprint as JSON.
fn run_byte_footprint(_args: &[String]) {
    use std::io::Read;
    let mut buffer = String::new();
    std::io::stdin()
        .read_to_string(&mut buffer)
        .expect("Failed to read from stdin");
    let input: ByteFootprintInput = serde_json::from_str(&buffer).expect("Failed to parse JSON");
    let bytes = input.doc.as_bytes();
    let out = ByteFootprintOut {
        doc_len: bytes.len(),
        ns_l2: pointer_chase::byte_footprint(bytes, 256),
        ns_slc: pointer_chase::byte_footprint(bytes, 8 * 1024),
        ns_dram: pointer_chase::byte_footprint(bytes, 64 * 1024),
        method: "byte-window-hash locality walk (untimed hash, timed access)",
    };
    println!("{}", serde_json::to_string(&out).expect("serialize"));
}

// run_boundary_probe — rung 3 of the AXIOM 0 extension ladder (CLAUDE.md). Chases the
// SAME number of loads over the SAME bytes in the SAME deterministic permuted line
// order, varying only whether consecutive steps stay inside a 64-byte line (PACKED)
// or cross one (CROSSING). The ns/access ratio is the physical cost of a cache-line
// boundary crossing, read off the metal from userspace — no privileged counter needed.
// Default sizes name the axiom's own reproduction: an in-cache CONTROL (well inside
// L1/L2 — expect ratio ~1.000, no boundary cost when resident), 8MiB, 128MiB.
//
// MEASUREMENT PROTOCOL (added 2026-08-19, see boundary_probe.rs): one probe() call is
// one sample from a machine that is not always quiet, so this runner repeats the sweep
// --runs times (default 5) and reports median + spread per size, then checks the
// CONTROL size's median against a physical-expectation band (see CONTROL_TOLERANCE) —
// if the control itself drifted, the machine wasn't quiet enough to trust the other
// rows either, and that verdict is printed and carried in --json rather than hidden.
//
// Exit code is ALWAYS 0 for a normal run, admissible or not — a measurement tool that
// exits non-zero on a noisy machine invites `|| true` somewhere downstream and then
// nobody ever reads it again. The admissibility verdict travels in the output, not the
// exit status: read the LOW CONFIDENCE marker, don't rely on $?.
fn run_boundary_probe(args: &[String]) {
    fn get_sizes(args: &[String], name: &str, default: &[usize]) -> Vec<usize> {
        args.iter().position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .map(|s| s.split(',').filter_map(|p| p.trim().parse().ok()).collect())
            .unwrap_or_else(|| default.to_vec())
    }
    fn get_usize(args: &[String], name: &str, default: usize) -> usize {
        args.iter().position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(default)
    }

    let sizes = get_sizes(args, "--kib", &boundary_probe::DEFAULT_KIB);
    let runs = get_usize(args, "--runs", boundary_probe::DEFAULT_RUNS);
    let control_kib = get_usize(args, "--control-kib", sizes.first().copied().unwrap_or(16));
    let emit_json = args.iter().any(|a| a == "--json");

    let report = boundary_probe::report(&sizes, runs, Some(control_kib));
    let (runs, stats, verdict) = (report.runs, &report.results, &report.control);

    println!("boundary-crossing probe — same loads · same bytes · same permuted line order;");
    println!("only variable: PACKED (8 slots/line, sequential) vs CROSSING (1 slot/line, every hop crosses a 64B boundary)");
    println!("{runs} run(s) per size — reporting median, with the observed [min, max] spread beside it");
    for s in stats {
        println!(
            "  {:>7} KiB  ({:>7} lines)  n={:<3} packed={:>9.3} ns  crossing={:>9.3} ns  ratio(median)={:.3}x  [{:.3}x, {:.3}x]",
            s.kib, s.lines, s.runs, s.packed_ns_median, s.crossing_ns_median, s.ratio_median, s.ratio_min, s.ratio_max
        );
    }
    println!();
    if verdict.admissible {
        println!("ADMISSIBLE — {}", verdict.reason);
    } else {
        println!("LOW CONFIDENCE / NOT ADMISSIBLE — {}", verdict.reason);
    }

    if emit_json {
        println!("{}", boundary_probe::report_json(&report));
    }
}

// run_ingest_transcript — M1 CLI. Reads ONE complete-line batch from a
// transcript .jsonl at --path (from --offset, default 0) and emits a single
// frame-shaped JSON line: the advanced cursor + the intent (first user prompt +
// thinking) and reality (assistant text) claims for that frame. The downstream
// resident loop (G2) calls transcript::* directly; this CLI exists so the M1
// gate — bit-identity with scripts/pmu/resident-watch.mjs — is checkable.
fn run_ingest_transcript(args: &[String]) {
    let tx_flag = |flag: &str| -> Option<String> {
        args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
    };
    let path = match tx_flag("--path") {
        Some(p) => p,
        None => {
            eprintln!("--ingest-transcript requires --path <file.jsonl>");
            std::process::exit(2);
        }
    };
    let offset: u64 = tx_flag("--offset").and_then(|s| s.parse().ok()).unwrap_or(0);
    let read = match transcript::read_new_lines(&path, offset) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("read failed: {e}");
            std::process::exit(2);
        }
    };
    let first = transcript::first_user_prompt(&path).unwrap_or_default();
    let intent_thinking = transcript::thinking_text(&read.lines);
    let reality = transcript::assistant_text(&read.lines);
    // ADDITIVE (2026-08-20): the operator's own prompts ARE the intent side, and firstUserPrompt
    // exposes only one per file. userPrompts carries ALL of them (same filter, same order) so the
    // intent corpus is no longer starved. firstUserPrompt/intentThinking/reality/lineCount/newOffset
    // keep their exact prior shape and values — nothing here changes what already existed.
    let user_prompts = transcript::all_user_prompts(&path).unwrap_or_default();
    let out = serde_json::json!({
        "path": path,
        "newOffset": read.new_offset,
        "lineCount": read.lines.len(),
        "firstUserPrompt": first,
        "intentThinking": intent_thinking,
        "reality": reality,
        "userPrompts": user_prompts,
    });
    println!("{out}");
}

// C1402: wo3's cold read ran --help and --version on the shipped arm64 binary and each one
// fell through every op check below to the default cache-latency + ballistic-gate +
// matrix-multiple benchmark — a CLI that cannot say what it is answers every question with
// a benchmark. These two must out-rank every op check, so they sit first in main(), before
// the gemini-web door and everything after it.
//
// One line per op this binary serves (kept here, not generated, so a new `if args.iter()...`
// branch in main() is a reminder to add its line — nothing enumerates main()'s branches for us).
const OPS: &[&str] = &[
    "--read-gemini-web --path <f>   read a gemini-web export (the one dialect door; JS shells out, never parses it itself)",
    "--thread                       the thread read (lens::run_thread)",
    "--hud-config                   print the effective HUD config",
    "--hud-grid-json <ev> [cfg]     the HUD grid JSON from an events/config pair",
    "--hud-fold <result> [cfg]      the nine tier-intersection cells folded from a walk result, no walk",
    "--odometer-probe [--runs N] [--steps N] [--json]   Tier-2 odometer calibration — apparatus scope, never the shipped default",
    "--axes                         the one axis table",
    "--hud-serve                    the streaming HUD server",
    "--constants [js]                the walk entry's floor constants (json, or the js block tesseract.mjs carries)",
    "--door-serve                   the door server",
    "--definer-walk                 the recursive definer walk alone",
    "--lens                         the full per-prompt pipeline: gzip-NCD seed -> definer walk -> sigma -> Chebyshev fence",
    "--walk                         the ballistic walk",
    "--project-xor                  the projected XOR walk",
    "--aperture                     the aperture read",
    "--sense                        the NCD sense read",
    "--encode-png                   encode a tolerance-panel PNG",
    "--action-read                  the action read (shuffled-pairing null, PN3 refusal)",
    "--vol-read                     the volatility read (does placement sigma predict rework given mu)",
    "--envelope-read                the cost-envelope / no-arbitrage arithmetic",
    "--maintain-harness              the harness properties, enumerated",
    "--verify-bundle                 bundle verification VB-1..VB-5",
    "--aperture-read                 aperture-read stub AP-R1..AP-R3",
    "--steering-read                 steering-read stub SW-R1..SW-R3",
    "--path-predict                  the path-prediction read (p@k + recall, shuffled-row null)",
    "--path-bind                     the path-prediction bindings + weights/top-12 at an immutable commit",
    "--aperture-verdict              the ratchet vector verdict (promote/hold/rollback)",
    "--aperture-load                 the ratchet loaders (shouldOfCommit / servedIds / measureVector)",
    "--cond-bits-batch               conditional code length of every (anchor, diff) pair in a batch",
    "--structural-key|--structural-rank   the structural key and the structural-precedent ranking",
    "--walk-admits                   walkAdmits / cellsAdmit / measuredLicence",
    "--rct-read                      the randomised-trial read (ledger + outcomes)",
    "--ledger-shas                   the amendments ledger's transcript sha set",
    "--steer-plan                    /steer's own orthogonalised, parallelised claim plan",
    "--job-units-read                job-units-read stub JU-R1..JU-R3",
    "--fleet                         the fleet receipt (rooms' commit-reality since a sha, folded)",
    "--maintain-tape                 maintain the walk tape",
    "--maintain-ringlatch            maintain the ring-latch",
    "--maintain-p1                   maintain P1",
    "--maintain-panels               maintain the commit panels",
    "--regions                       the region table",
    "--shortlex                      the canonical 144 ShortLex pair labels",
    "--throughput                    the throughput runner",
    "--verify-grid                   verify the grid",
    "--lattice                       the lattice JSON",
    "--ballistic                     ballistic-walk frames (Cloud Bridge JSON)",
    "--byte-footprint                the byte-footprint read",
    "--fleet-bench                   N-agent fleet scaling bench (messages vs rank reads; shape only, never a model's behaviour)",
    "--boundary-probe                the boundary-crossing probe",
    "--ingest-transcript             ingest a transcript file",
    "--resident [--socket <p>] [--tree <t>] [--sign]   the resident loop, or served over a unix socket",
    "(no op)                         the default benchmark: cache hierarchy, ballistic gate, matrix multiple, raw PMU counters",
];

fn print_help() {
    println!("pmu-onchip {} — ON-CHIP PMU v0, the ballistic walk on the metal (Rust daemon)", env!("CARGO_PKG_VERSION"));
    println!("usage: pmu-onchip [OP] [ARGS...]");
    println!();
    println!("ops:");
    for line in OPS {
        println!("  {line}");
    }
}

fn print_version() {
    // the build's git sha: run from CARGO_MANIFEST_DIR (this crate's own directory, baked in
    // at compile time) so it resolves against the repo whichever of the two mirrored copies
    // was built, never the caller's cwd. UNMEASURED reads as "unknown", never a build failure.
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("pmu-onchip {} ({sha})", env!("CARGO_PKG_VERSION"));
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // C1402: --help and --version answer before any other op or the default benchmark reads
    // args — out-rank every check below, including the gemini-web door right after this one.
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_help();
        return;
    }
    if args.iter().any(|a| a == "--version" || a == "-V") {
        print_version();
        return;
    }
    // THE ONE DOOR to the gemini-web dialect. JS shells out here; it does not parse the
    // shape itself. Exits non-zero with the refusal on stderr, so a caller that ignores the
    // exit code still cannot mistake a dialect change for an empty conversation.
    if args.iter().any(|a| a == "--read-gemini-web") {
        let path = args
            .iter()
            .position(|a| a == "--path")
            .and_then(|i| args.get(i + 1))
            .cloned()
            .unwrap_or_else(|| {
                eprintln!("--read-gemini-web requires --path <file.jsonl>");
                std::process::exit(2);
            });
        match gemini::read_gemini_web(&path) {
            Ok(g) => {
                println!("{}", gemini::to_json(&g));
                return;
            }
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(3);
            }
        }
    }

    if args.iter().any(|a| a == "--thread") {
        lens::run_thread(&args);
        return;
    }
    if args.iter().any(|a| a == "--hud-config") {   // C746: print the effective HUD config
        hud_config::run(&args);
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--hud-grid-json") {   // C769: the door onto intentguard::hud_grid_json
        // `--hud-grid-json <events> [<config>]`: each is a file path, else inline JSON; no config reads the defaults.
        let arg = |k: usize| args.get(i + k).map(|a| std::fs::read_to_string(a).unwrap_or_else(|_| a.clone())).unwrap_or_default();
        println!("{}", intentguard::hud_grid_json(&arg(1), &arg(2)));
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--hud-fold") {   // C778: the fold alone, on a walk result, no walk
        // `--hud-fold <result> [<config>]`: the result is a file path or inline JSON carrying a 144 `heat` (and seed_fit / lane as
        // --lens prints them, and an optional "window" string); the config as --hud-grid-json takes it. Prints the nine tier-intersection
        // cells with their three words, so a guard reads the fold off a chosen field without steering a real walk onto it. LLM-free, re-runnable.
        let arg = |k: usize| args.get(i + k).map(|a| std::fs::read_to_string(a).unwrap_or_else(|_| a.clone())).unwrap_or_default();
        let result: serde_json::Value = match serde_json::from_str(&arg(1)) { Ok(v) => v, Err(e) => { println!("{}", serde_json::json!({ "ok": false, "why": format!("result is not JSON: {}", e) })); return; } };
        let cfg = if arg(2).trim().is_empty() { hud_config::HudConfigFile::default() } else { match serde_json::from_str::<serde_json::Value>(&arg(2)) { Ok(v) => hud_config::from_value(&v), Err(_) => hud_config::HudConfigFile::default() } };
        let lib = intentguard::walk_lens::load_library(&std::path::Path::new("data/pmu/snippet-library-144.json")).ok();
        let window = result.get("window").and_then(serde_json::Value::as_str).unwrap_or("");
        match hud::fold(result.get("heat").unwrap_or(&serde_json::Value::Null), &result, cfg.grid().ncd_green, window, lib.as_ref()) {
            Some(cells) => println!("{}", serde_json::json!({ "ok": true, "cells": cells })),
            None => println!("{}", serde_json::json!({ "ok": false, "why": "result carries no 144-cell heat field", "cells": [] })),
        }
        return;
    }
    if args.iter().any(|a| a == "--odometer-probe") {   // C830: the Tier 2 calibration of odometer.rs — APPARATUS SCOPE (AXIOM 0 rung 4), never the shipped default
        // `--odometer-probe [--runs N] [--steps N] [--json]`: the in-lane and out-of-lane walks over the aligned LatticeCell array under
        // perf_event_open, medians with [min, max] over N runs, the in-lane control band (NOT ADMISSIBLE when it fails), UNMEASURED with
        // the errno and the sysctl line when the counter is refused. k_E is never printed as a rate. Never gates the exit code.
        let num = |flag: &str, d: usize| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).and_then(|s| s.trim().parse().ok()).unwrap_or(d);
        let r = intentguard::odometer_probe::report(num("--runs", intentguard::odometer_probe::DEFAULT_RUNS), num("--steps", 0));
        print!("{}", intentguard::odometer_probe::report_text(&r));
        if args.iter().any(|a| a == "--json") { println!("{}", intentguard::odometer_probe::report_json(&r)); }
        return;
    }
    if args.iter().any(|a| a == "--axes") {   // C748: the one axis table, printed
        println!("{}", hud::axes_json());
        return;
    }
    if args.iter().any(|a| a == "--hud-serve") {   // C748: the streaming HUD server
        std::process::exit(hud::run_hud_serve(&args));
    }
    if args.iter().any(|a| a == "--constants") {   // C1394: the walk entry's floor from its one Rust home (`--constants js` = the block tesseract.mjs carries)
        let js = args.iter().position(|a| a == "--constants").and_then(|i| args.get(i + 1)).map(|s| s == "js").unwrap_or(false);
        print!("{}", if js { door::floor_constants_js() } else { door::floor_constants_json() });
        return;
    }
    if args.iter().any(|a| a == "--door-serve") {   // C612b
        door::run_door_serve().expect("door-serve failed");
        return;
    }
    if args.iter().any(|a| a == "--definer-walk") {
        lens::run_definer_walk(&args);
        return;
    }
    if args.iter().any(|a| a == "--lens") {
        // P2 (one-pipeline-spec): the ENTIRE composed per-prompt pipeline — gzip-NCD seed →
        // recursive definer walk (per-hop row reads in-crate, no process per hop) → σ →
        // Chebyshev fence → in/out partition — in THIS one process. LLM-free, deterministic.
        lens::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--walk") {
        run_walk(&args);
        return;
    }
    if args.iter().any(|a| a == "--project-xor") {
        run_project_xor(&args);
        return;
    }
    if args.iter().any(|a| a == "--aperture") {
        run_aperture();
        return;
    }
    if args.iter().any(|a| a == "--sense") {
        run_sense(&args);
        return;
    }
    if args.iter().any(|a| a == "--encode-png") {
        run_encode_png(&args);
        return;
    }
    if args.iter().any(|a| a == "--action-read") {   // spec §8.31: the action read (shuffled-pairing null, PN3 refusal) in the crate — the JS engines drive this
        action::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--vol-read") {   // KR34 §8.32: the volatility read — does the placement's σ predict rework given μ (the Black-Scholes shape, measured)
        volatility::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--envelope-read") {   // KR40/KR43 §8.58: the cost-envelope / no-arbitrage arithmetic (E1-E6) — the JS drivers call this
        envelope::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--maintain-harness") {   // spec §7: the harness properties, enumerated by the binary that builds the panels
        harness::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--verify-bundle") {   // B13/B19 §8.58 stub: VB-1..VB-5, engine rust-verify — the JS driver (verify-row.mjs) calls this first
        verify::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--aperture-read") {   // KR39 §8.6x stub: AP-R1..AP-R3, engine rust-aperture-read — the JS driver (kr39-aperture.mjs) calls this first
        aperture_read::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--steering-read") {   // KR41 §8.6x stub: SW-R1..SW-R3, engine rust-steering-read — the JS driver (kr41-steering-work.mjs) calls this first
        steering_read::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--path-predict") {   // C612c: the path-prediction read — p@k + recall of the note-named files vs the commit-touched files, shuffled-row null, halves by session; scripts/vna/path-prediction.mjs shuttles the pairs
        path_predict::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--path-bind") {   // C612p: the C612h bindings + C612m weights/top-12 at the immutable commit (git cat-file --batch) — scripts/vna/path-prediction.mjs boundInvariants/weightedInvariants/flagTop spawn this
        path_predict::bind::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--aperture-verdict") {   // C612p: the C612o vector verdict (promote/hold/rollback) — scripts/pmu/lens-aperture-ratchet.mjs vectorVerdict spawns this
        path_predict::bind::run_verdict(&args);
        return;
    }
    if args.iter().any(|a| a == "--aperture-load") {   // C612t: the ratchet loaders (shouldOfCommit · servedIds · measureVector, its permutation null included) beside the vector verdict — scripts/pmu/lens-aperture-ratchet.mjs shuttles the rows
        path_predict::bind::run_load(&args);
        return;
    }
    if args.iter().any(|a| a == "--cond-bits-batch") {   // C612q (port row C612d): every (anchor, diff) conditional code length of a run in one call — scripts/vna/repo-as-spec-gain.mjs condBitsBatch shuttles the batch
        lens::c612q::run_cond_bits_batch(&args);
        return;
    }
    if args.iter().any(|a| a == "--structural-key" || a == "--structural-rank") {   // C612q (port row C612k): the structural key and the structural-precedent ranking — repo-as-spec-gain.mjs structuralKey / retrieve shuttle
        lens::c612q::run_structural_key(&args);
        return;
    }
    if args.iter().any(|a| a == "--walk-admits") {   // C612q (port row C582a): walkAdmits / cellsAdmit / measuredLicence — scripts/vna/read-set.mjs shuttles the walk, the row and the licence file
        lens::c612q::run_walk_admits(&args);
        return;
    }
    if args.iter().any(|a| a == "--rct-read") {   // C612q (port row C610f-port): the randomised read — scripts/vna/forecast-rct.mjs readRct shuttles the ledger and the outcomes
        lens::c612q::run_rct_read(&args);
        return;
    }
    if args.iter().any(|a| a == "--ledger-shas") {   // C171a: the amendments ledger's transcript sha set, line-streamed with an incremental byte-offset index — scripts/vna/transcript-rows.mjs ledgerShas() calls this
        ledger_shas::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--steer-plan") {   // C188: /steer orthogonalises + parallelises in the crate — disjoint claim sets, one basin cell each, nearest-first by L1; scripts/vna/steer-plan.mjs spawns this
        steer_plan::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--job-units-read") {   // KR42 §8.6x stub: JU-R1..JU-R3, engine rust-job-units-read — the JS driver (kr42-job-units.mjs) calls this first
        job_units_read::run(&args);
        return;
    }
    if args.iter().any(|a| a == "--fleet") {   // C831: the fleet receipt — the rooms' commit-reality rows since a sha, folded to fleet · unison · drift_events · kE_total · root_hash (intentguard::fleet)
        println!("{}", intentguard::fleet::run_cli(&args));
        return;
    }
    if args.iter().any(|a| a == "--maintain-tape") {
        maintain::run_tape(&args);
        return;
    }
    if args.iter().any(|a| a == "--maintain-ringlatch") {
        maintain::run_ringlatch(&args);
        return;
    }
    if args.iter().any(|a| a == "--maintain-p1") {
        maintain::run_p1(&args);
        return;
    }
    if args.iter().any(|a| a == "--maintain-panels") {
        maintain::run_panels(&args);
        return;
    }
    if args.iter().any(|a| a == "--regions") {
        run_regions();
        return;
    }
    if args.iter().any(|a| a == "--shortlex") {
        // the canonical 144 ShortLex pair labels, emitted functionally so JS callers
        // (shortlex-coords.mjs, the lens, the region pipeline) can read the ONE ordering
        // from the chip instead of hand-maintaining a copy that can drift. LLM-free.
        println!("{}", serde_json::to_string(&ballistic::SHORTLEX[..]).expect("serialize shortlex"));
        return;
    }
    if args.iter().any(|a| a == "--throughput") {
        run_throughput(&args);
        return;
    }
    if args.iter().any(|a| a == "--verify-grid") {
        run_verify_grid(&args);
        return;
    }
    if args.iter().any(|a| a == "--lattice") {
        println!("{}", lattice::lattice_json_from_args(&args));
        return;
    }
    if args.iter().any(|a| a == "--ballistic") {
        run_ballistic(&args);
        return;
    }
    if args.iter().any(|a| a == "--byte-footprint") {
        run_byte_footprint(&args);
        return;
    }
    if args.iter().any(|a| a == "--fleet-bench") {   // C832: N agents mutating one lattice, cohort A by messages vs cohort B by rank reads — intentguard::fleet_bench; sufficient for the scaling shape, never for a model's behaviour
        print!("{}", intentguard::fleet_bench::run_cli(&args));
        return;
    }
    if args.iter().any(|a| a == "--boundary-probe") {
        run_boundary_probe(&args);
        return;
    }
    if args.iter().any(|a| a == "--ingest-transcript") {
        run_ingest_transcript(&args);
        return;
    }
    if args.iter().any(|a| a == "--resident") {
        // C184a: `--socket <path>` serves the same ops over a unix socket (the per-tool-call hook's
        // door); `--tree <spec-tree.json>` names the tree the resident holds. Without --socket the
        // stdin/stdout loop runs as before (resident-watch.mjs, daemon-verify.mjs).
        let arg_after = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).map(std::path::PathBuf::from);
        let tree = arg_after("--tree");
        if let Some(sock) = arg_after("--socket") {
            resident::run_resident_socket(&sock, tree).expect("resident socket failed");
        } else {
            resident::run_resident_loop_with(args.iter().any(|a| a == "--sign"), tree).expect("resident loop failed");
        }
        return;
    }

    println!("on-chip PMU v0 — Rust daemon · the ballistic walk on the metal");
    println!("================================================================\n");

    // ── cache hierarchy — the real hardware measurement ──────────────
    println!("cache hierarchy (pointer-chase · dependent loads · unprefetchable):");
    let tiers = [
        chase(16, "L1"),
        chase(256, "L2"),
        chase(8 * 1024, "SLC"),
        chase(128 * 1024, "DRAM"),
    ];
    for t in &tiers {
        println!(
            "  {:<5} {:>9} KiB    {:>7.2} ns / access",
            t.label, t.kib, t.ns_per_access
        );
    }
    let l1 = tiers[0].ns_per_access.max(1e-9);
    let dram = tiers[3].ns_per_access;
    println!("  miss penalty: {:.1}x   (DRAM / L1)\n", dram / l1);

    // ── the ballistic gate — XOR + hardware popcount ─────────────────
    let gate_ns = gate::bench_gate(200_000_000);
    println!("ballistic gate (XOR + hardware popcount · combinational · no loop):");
    println!("  64-bit lane:  {:.4} ns / driven comparison", gate_ns);
    println!("  (incl. a 1-cycle driver; the gate proper — count_ones — is ~1 cycle)");
    // a K=256 comparison is four lanes — show it scales by replication
    let a = [0x1111_1111_1111_1111u64, 0x2222, 0xFFFF_0000_FFFF_0000, 0xABCD];
    let b = [0x1111_1111_0000_0000u64, 0x2200, 0x0000_FFFF_0000_FFFF, 0x0BCD];
    println!(
        "  K=256 (4 lanes) sample Hamming distance: {} bits\n",
        gate::hamming256(&a, &b)
    );

    // ── the matrix multiple — the canonical benchmark ────────────────
    let mm = matrix::matrix_multiple(3.0, 8, 12);
    println!("matrix multiple — cycles = density x depth x processes:");
    println!(
        "  density {:.1}  x  depth {}  x  processes {}",
        mm.density, mm.depth, mm.processes
    );
    println!(
        "  per process: {} XOR cycles (floored at {} = the 144x144 lattice cell count)",
        mm.per_process,
        matrix::CELLS
    );
    println!("  total: {} XOR cycles", mm.xor_cycles);
    println!(
        "  walk time at the measured gate rate: {:.1} ns  ({} x {:.4} ns)\n",
        mm.xor_cycles as f64 * gate_ns,
        mm.xor_cycles,
        gate_ns
    );

    // ── raw PMU counters — the next gate ─────────────────────────────
    let cs = counter::status();
    println!("raw PMU counters [{}]: {}", cs.platform, if cs.available { "available" } else { "not yet wired" });
    println!("  {}", cs.note);
}

// ── run_ballistic — emit JSON frames suitable for the Cloud Bridge ────
//
// Reads the grid from --grid (path or "-" for stdin) when supplied so the
// chip ↔ cloud rails walk THE SAME lattice — the same 144-int array the
// JS side emitted. Falls back to the deterministic demo_grid() when no
// --grid is given, so the binary is still self-runnable for benches.
fn run_ballistic(args: &[String]) {
    let (grid, _len) = grid_from_args(args).unwrap_or_else(|| (ballistic::demo_grid(), 20736));
    let mut opts = ballistic::WalkOpts::default();
    // --decay tunes the per-ply geometric decay (default 0.5). Lowering
    // it (e.g. 0.25, 0.15) makes the walk die out faster — only the
    // first few plies contribute meaningful weight. Used in the doc-
    // heatmap experiment to test whether structured (semantically
    // adjacent) grids produce more localized heat clouds than random.
    if let Some(i) = args.iter().position(|a| a == "--decay") {
        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()) {
            opts.decay_factor = v;
        }
    }
    if let Some(i) = args.iter().position(|a| a == "--max-depth") {
        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) {
            opts.max_depth = v;
        }
    }
    // --budget-ms <N> — the IN-BINARY time bound (the standing operator TODO:
    // "the on-chip part must be TIME-BOUNDED — assert"). Hard-bounds each
    // walk's wall time inside the binary: elapsed is checked before every
    // fan-out ply; when spent, the walk emits ONE terminal frame with the
    // painted-so-far state and "budgetExhausted":true, then stops. Absent =
    // unbounded (the historical behavior — no caller changes). Without
    // --start, ballistic_walk_all runs each occupied anchor with its OWN
    // budget (the bound is per-walk, not per-process).
    if let Some(i) = args.iter().position(|a| a == "--budget-ms") {
        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<u64>().ok()) {
            opts.budget_ms = Some(v);
        }
    }
    let start_idx = args.iter().position(|a| a == "--start").and_then(|i| {
        args.get(i + 1).and_then(|s| ballistic::SHORTLEX.iter().position(|x| *x == s.as_str()))
    });
    // --sign — G1 (the formerly-last-open Rust gap): the binary signs SHA-256
    // of the EXACT bytes it emits (frames JSON + '\n', or every NDJSON line
    // including its '\n') with the hw-derived daemon key, and appends ONE
    // trailing attestation line. Opt-in: without the flag the output is
    // byte-identical to the pre-G1 binary (pinned by the JS proving test).
    // Key derivation failure is a HARD exit 2, never a silent unsigned run.
    let sign_key = if args.iter().any(|a| a == "--sign") {
        match attest::host_signing_key() {
            Ok(k) => Some(k),
            Err(e) => {
                eprintln!("pmu-onchip --sign: {}", e);
                std::process::exit(2);
            }
        }
    } else {
        None
    };
    // --stream: NDJSON — one frame per line, flushed as each ply completes,
    // so a receiver renders the walk LIVE instead of waiting for exit.
    // Default (no flag) stays the single buffered JSON array for existing
    // execSync callers (definer-walk-144.mjs et al).
    if args.iter().any(|a| a == "--stream") {
        use sha2::Digest;
        use std::io::Write;
        let stdout = std::io::stdout();
        let mut lock = stdout.lock();
        // Incremental digest over exactly the bytes written (line + '\n' per
        // frame) — equals the buffered hash of the concatenation (pinned by
        // attest::streamed_incremental_digest_equals_buffered_digest).
        let mut hasher: Option<sha2::Sha256> = sign_key.as_ref().map(|_| sha2::Sha256::new());
        let mut emit = |f: &ballistic::Frame| {
            let line = ballistic::frame_to_json(f);
            writeln!(lock, "{}", line).expect("write frame");
            lock.flush().expect("flush frame");
            if let Some(h) = hasher.as_mut() {
                h.update(line.as_bytes());
                h.update(b"\n");
            }
        };
        match start_idx {
            Some(s) => ballistic::ballistic_walk_with(&grid, s, &opts, &mut emit),
            None    => ballistic::ballistic_walk_all_with(&grid, &opts, &mut emit),
        }
        if let (Some(key), Some(h)) = (sign_key.as_ref(), hasher) {
            let digest: [u8; 32] = h.finalize().into();
            writeln!(lock, "{}", attest::attestation_line_for_digest(&digest, key, &chrono_like_ts()))
                .expect("write attestation");
            lock.flush().expect("flush attestation");
        }
        return;
    }
    let frames = match start_idx {
        Some(s) => ballistic::ballistic_walk(&grid, s, &opts),
        None    => ballistic::ballistic_walk_all(&grid, &opts),
    };
    let body = ballistic::frames_to_json(&frames);
    println!("{}", body);
    if let Some(key) = sign_key.as_ref() {
        // payload = exactly what println! wrote: the body plus its '\n'.
        let mut payload = body.into_bytes();
        payload.push(b'\n');
        println!("{}", attest::attestation_line(&payload, key, &chrono_like_ts()));
    }
}

// ── the print wrappers (C462a): aperture/regions/png/lattice return values; this binary does the IO ──────────────

// `--aperture`: stdin {intent,reality,tolerance?} → one JSON line. A door that cannot open reports that it could not
// open (stderr, exit 2). It never returns a pass.
fn run_aperture() {
    let mut buf = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut buf).is_err() {
        eprintln!("--aperture: could not read stdin");
        std::process::exit(2);
    }
    match aperture::aperture_json(&buf) {
        Ok(line) => println!("{}", line),
        Err(e) => { eprintln!("{}", e); std::process::exit(2); }
    }
}

// `--regions`: stdin = the 144×144 per-cell class bytes, row-major → the regions JSON.
fn run_regions() {
    use std::io::Read;
    let mut buf = Vec::new();
    std::io::stdin().read_to_end(&mut buf).expect("read cls bitmap from stdin");
    assert_eq!(buf.len(), 144 * 144, "expected {} cls bytes (144×144), got {}", 144 * 144, buf.len());
    println!("{}", regions::regions_json(&buf));
}

// ── CLI · the differential seam ───────────────────────────────────────────────────────────────
// `pmu-onchip --encode-png --rgba <raw> --width W --height H --out <png>`
// Exists so the byte-identity guard can drive BOTH encoders over the same buffer and diff the
// output. It is deliberately dumb: raw RGBA in, PNG out, no walk, no rendering, no interpretation.
// Until the raster is ported this is the only Rust-produced half of the panel, and the guard is
// what earns it the right to become the whole thing.
fn run_encode_png(args: &[String]) {
    let flag = |name: &str| -> Option<String> {
        args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
    };
    let rgba_path = match flag("--rgba") { Some(p) => p, None => { eprintln!("--encode-png requires --rgba <path>"); std::process::exit(2); } };
    let out_path = match flag("--out") { Some(p) => p, None => { eprintln!("--encode-png requires --out <path>"); std::process::exit(2); } };
    let w: usize = flag("--width").and_then(|s| s.parse().ok()).unwrap_or(0);
    let h: usize = flag("--height").and_then(|s| s.parse().ok()).unwrap_or(0);
    if w == 0 || h == 0 { eprintln!("--encode-png requires --width and --height"); std::process::exit(2); }

    let rgba = match std::fs::read(&rgba_path) { Ok(b) => b, Err(e) => { eprintln!("cannot read {}: {}", rgba_path, e); std::process::exit(2); } };
    if rgba.len() != w * h * 4 {
        eprintln!("rgba is {} bytes, expected {} for {}x{}", rgba.len(), w * h * 4, w, h);
        std::process::exit(2);
    }
    let png = png::png_from_rgba(&rgba, w, h);
    if let Err(e) = std::fs::write(&out_path, &png) { eprintln!("cannot write {}: {}", out_path, e); std::process::exit(2); }
    println!("{{\"ok\":true,\"bytes\":{},\"width\":{},\"height\":{},\"out\":{:?}}}", png.len(), w, h, out_path);
}

fn run_verify_grid(args: &[String]) {
    let (grid, original_len) = grid_from_args(args).unwrap_or_else(|| {
        eprintln!("pmu-onchip --verify-grid: missing or invalid --grid");
        std::process::exit(2);
    });
    // Print the grid as a flat JSON array to stdout
    print!("[");
    if original_len == 144 {
        for i in 0..144 {
            if i > 0 { print!(","); }
            print!("{}", grid[i * 144 + i]);
        }
    } else {
        for (i, v) in grid.iter().enumerate() {
            if i > 0 { print!(","); }
            print!("{}", v);
        }
    }
    println!("]");
}

// Reads a JSON array from --grid <path|->.
// If length is 144, it expands to diagonal hits on the 144x144 grid.
// If length is 20736, it's used directly.
fn grid_from_args(args: &[String]) -> Option<([u8; 20736], usize)> {
    let i = args.iter().position(|a| a == "--grid")?;
    let path = args.get(i + 1)?;
    let text = if path == "-" {
        use std::io::Read;
        let mut s = String::new();
        std::io::stdin().read_to_string(&mut s).ok()?;
        s
    } else {
        std::fs::read_to_string(path).ok()?
    };
    let arr = parse_int_array(&text).unwrap_or_else(|e| {
        eprintln!("pmu-onchip --grid: {}", e);
        std::process::exit(2);
    });
    let mut g = [0u8; 20736];
    let len = arr.len();
    if len == 144 {
        // Expand 144-bit vector to diagonal hits on the 144x144 grid
        for (i, v) in arr.iter().enumerate() {
            if *v != 0 { g[i * 144 + i] = 1; }
        }
    } else if len == 20736 {
        for (k, v) in arr.iter().enumerate() {
            g[k] = if *v != 0 { 1 } else { 0 };
        }
    } else {
        eprintln!("pmu-onchip --grid: expected 144 or 20736 ints, got {}", len);
        std::process::exit(2);
    }
    Some((g, len))
}

// ── run_throughput — PRO-G high-throughput, frame-less ballistic runner.
//
// Flags:
//   --width W       lattice side (default 12)
//   --depth D       fan-out plies (default 5)
//   --anchors N     starting rows (default = width)
//   --arcs M        arcs per anchor (default 1000)
//   --density K     significant cells per row (default 3)
//   --seed S        grid seed (default 42)
//   --json          also write a JSON receipt + print path
//   --json-path P   override receipt path
//
// Prints a human-readable report to stdout. The receipt path (when
// --json is on) lands in .thetacog/pmu/throughput/<utc>.json.
#[derive(Deserialize)]
struct ProjectXorInput {
    intent_bits: Vec<u8>,
    reality_bits: Vec<u8>,
}

#[derive(Serialize)]
struct ProjectXorOutput {
    intent_bitmap_b64: String,
    reality_bitmap_b64: String,
    friction_bitmap_b64: String,
    friction_nodes: usize,
}

#[derive(Deserialize)]
struct WalkInput {
    grid_b64: String, // Packed bitmap (2592 bytes)
    decay: f64,
    depth: usize,
    // "" / "traversal" = the lit-graph ballistic walk (support = lit cells,
    // intensity = path-convergence weight). "diffusion" = additionally spread
    // weight to ShortLex-adjacent UNLIT neighbours, so the cloud smooths beyond
    // the binaries (decorrelates from the XOR). See pmu-pipeline-flow.md.
    #[serde(default)]
    mode: String,
}

// diffuse — donate a fraction of each cell's weight to its 4 grid neighbours
// (grid adjacency IS ShortLex adjacency, since cells are ShortLex-ordered).
// Repeated `iters` times, this spreads the lit-cell mass into the surrounding
// region — the "true diffusion" cloud, distinct from the lit-graph traversal.
fn diffuse(heatmap: &mut [f32], n: usize, iters: usize, rate: f32) {
    for _ in 0..iters {
        let src = heatmap.to_vec();
        for i in 0..n {
            for j in 0..n {
                let w = src[i * n + j];
                if w <= 0.0 { continue; }
                let share = w * rate;
                if i > 0 { heatmap[(i - 1) * n + j] += share; }
                if i + 1 < n { heatmap[(i + 1) * n + j] += share; }
                if j > 0 { heatmap[i * n + (j - 1)] += share; }
                if j + 1 < n { heatmap[i * n + (j + 1)] += share; }
            }
        }
    }
}

// converge — the INFINITE-reach fixed point. A decaying frontier propagates to
// neighbours, accumulating into the heatmap, until the frontier mass is
// negligible. With 4·rate < 1 the geometric series Σ (decay·M)^k converges:
// the result is the resolvent (I − decay·M)⁻¹ applied to the seed — the heat
// kernel where EVERY cell is defined by every other (weight = decay^distance to
// the lit set). Each step propagates less; reach is effectively infinite.
// Returns the number of plies it took to converge. rate must be < 0.25.
fn converge(heatmap: &mut [f32], n: usize, rate: f32) -> usize {
    let len = heatmap.len();
    let mut frontier = heatmap.to_vec();
    let mut plies = 0;
    for _ in 0..512 {
        let mut next = vec![0.0f32; len];
        for i in 0..n {
            for j in 0..n {
                let w = frontier[i * n + j];
                if w <= 0.0 { continue; }
                let share = w * rate;
                if i > 0 { next[(i - 1) * n + j] += share; }
                if i + 1 < n { next[(i + 1) * n + j] += share; }
                if j > 0 { next[i * n + (j - 1)] += share; }
                if j + 1 < n { next[i * n + (j + 1)] += share; }
            }
        }
        let mass: f32 = next.iter().sum();
        for k in 0..len { heatmap[k] += next[k]; }
        frontier = next;
        plies += 1;
        if mass < 1e-3 { break; } // frontier negligible → fixed point reached
    }
    plies
}

#[derive(Serialize)]
struct WalkOutput {
    heatmap_b64: String, // Packed f32 array
    lit_nodes: usize,
}

// [INTENT: C3.Operations.Flow] Generate a high-speed topological "fuzziness" to reveal strategic adjacency.
// [REALITY: --walk] Multi-core ballistic walk using Rayon to saturate M-series silicon.
fn run_walk(_args: &[String]) {
    use std::io::Read;
    use base64::{engine::general_purpose, Engine as _};
    
    let mut buffer = String::new();
    std::io::stdin().read_to_string(&mut buffer).expect("Failed to read from stdin");
    let input: WalkInput = serde_json::from_str(&buffer).expect("Failed to parse JSON");

    let bytes = general_purpose::STANDARD.decode(&input.grid_b64).expect("Failed to decode base64 grid");
    let mut grid = [0u8; 20736];
    for i in 0..20736 {
        if (bytes[i >> 3] & (1 << (7 - (i & 7)))) != 0 {
            grid[i] = 1;
        }
    }

    let mut opts = ballistic::WalkOpts::default();
    opts.decay_factor = input.decay;
    opts.max_depth = input.depth;

    let frames = ballistic::ballistic_walk_all(&grid, &opts);

    // Aggregate visits across all plies into a float heatmap
    let mut heatmap = vec![0.0f32; 20736];
    for frame in frames {
        for (&idx, &weight) in frame.visits.iter() {
            heatmap[idx] += weight as f32;
        }
    }

    // Diffusion mode: spread the lit-graph weight into ShortLex-adjacent unlit
    // neighbours so the cloud smooths BEYOND the binaries (the traversal alone
    // only re-weights lit cells). iters = depth, rate scaled from decay.
    if input.mode == "diffusion" {
        diffuse(&mut heatmap, 144, input.depth.max(1), (input.decay as f32) * 0.3);
    } else if input.mode == "converged" {
        // Infinite-reach fixed point: iterate the decaying frontier to
        // convergence so every cell is defined by every other (decay^distance).
        converge(&mut heatmap, 144, (input.decay as f32) * 0.3);
    }

    let output = WalkOutput {
        heatmap_b64: pack_f32_b64(&heatmap),
        lit_nodes: heatmap.iter().filter(|&&v| v > 0.0).count(),
    };
    println!("{}", serde_json::to_string(&output).unwrap());
}

fn pack_f32_b64(data: &[f32]) -> String {
    use base64::{engine::general_purpose, Engine as _};
    let bytes: &[u8] = unsafe {
        std::slice::from_raw_parts(data.as_ptr() as *const u8, data.len() * 4)
    };
    general_purpose::STANDARD.encode(bytes)
}

// [INTENT: B2.Tactics.Deal] Establish a bit-level standard for underwriting strategic agreement.
// [REALITY: --project-xor] Direct memory XOR between two 20,736-bit lattices. Zero Turing overhead.
fn run_project_xor(_args: &[String]) {
    use std::io::Read;
    let mut buffer = String::new();
    std::io::stdin().read_to_string(&mut buffer).unwrap();
    let input: ProjectXorInput = serde_json::from_str(&buffer).unwrap();

    let n = input.intent_bits.len();
    let mut intent_lattice = vec![0u8; n * n];
    let mut reality_lattice = vec![0u8; n * n];
    let mut friction_lattice = vec![0u8; n * n];
    let mut friction_nodes = 0;

    for i in 0..n {
        for j in 0..n {
            let idx = i * n + j;
            // Logical expansion: interference i,j is 1 if both anchors are 1
            if input.intent_bits[i] == 1 && input.intent_bits[j] == 1 {
                intent_lattice[idx] = 1;
            }
            if input.reality_bits[i] == 1 && input.reality_bits[j] == 1 {
                reality_lattice[idx] = 1;
            }
            // XOR on the metal
            if intent_lattice[idx] != reality_lattice[idx] {
                friction_lattice[idx] = 1;
                friction_nodes += 1;
            }
        }
    }

    let output = ProjectXorOutput {
        intent_bitmap_b64: pack_bitmap_b64(&intent_lattice),
        reality_bitmap_b64: pack_bitmap_b64(&reality_lattice),
        friction_bitmap_b64: pack_bitmap_b64(&friction_lattice),
        friction_nodes,
    };
    println!("{}", serde_json::to_string(&output).unwrap());
}

fn pack_bitmap_b64(bits: &[u8]) -> String {
    use base64::{engine::general_purpose, Engine as _};
    let mut bytes = vec![0u8; (bits.len() + 7) / 8];
    for (i, &bit) in bits.iter().enumerate() {
        if bit != 0 {
            bytes[i >> 3] |= 1 << (7 - (i & 7));
        }
    }
    general_purpose::STANDARD.encode(bytes)
}

fn run_sense(_args: &[String]) {
    use std::io::Read;
    let mut buffer = String::new();
    std::io::stdin().read_to_string(&mut buffer).expect("Failed to read from stdin");
    let input: SenseInput = serde_json::from_str(&buffer).expect("Failed to parse JSON");

    // Map the stdin field to the featurizer. Unknown values are a hard error
    // (exit 2) rather than a silent fallback — two sensors must never blur.
    let mode = match input.shingle_mode.as_str() {
        "" | "char" => signature::ShingleMode::Char,
        "word" => signature::ShingleMode::Word,
        other => {
            eprintln!("pmu-onchip --sense: unknown shingle_mode {:?} (use \"char\" or \"word\")", other);
            std::process::exit(2);
        }
    };
    let res = sense::sense_lattice(&input.claims, &input.targets, &input.target_lens, input.simhash_only, mode);
    let output = SenseOutput {
        scores:     res.rows.iter().map(|r| r.score).collect(),
        ncd_scores: res.rows.iter().map(|r| r.ncd).collect(),
        best_idx:   res.rows.iter().map(|r| r.best_idx).collect(),
        agreement:  res.rows.iter().map(|r| r.agreement).collect(),
        claim_best_anchor: res.claim_best_anchor,
        claim_best_score:  res.claim_best_score,
    };
    println!("{}", serde_json::to_string(&output).unwrap());
}

fn run_throughput(args: &[String]) {
    fn get_usize(args: &[String], name: &str, default: usize) -> usize {
        args.iter().position(|a| a == name)
            .and_then(|i| args.get(i + 1).and_then(|s| s.parse().ok()))
            .unwrap_or(default)
    }
    fn get_u64(args: &[String], name: &str, default: u64) -> u64 {
        args.iter().position(|a| a == name)
            .and_then(|i| args.get(i + 1).and_then(|s| s.parse().ok()))
            .unwrap_or(default)
    }

    let width    = get_usize(args, "--width", 12);
    let depth    = get_usize(args, "--depth", 5);
    let anchors  = get_usize(args, "--anchors", width);
    let arcs_per = get_usize(args, "--arcs", 1000);
    let density  = get_usize(args, "--density", 3);
    let seed     = get_u64(args, "--seed", 42);
    let emit_json = args.iter().any(|a| a == "--json");
    let use_f32  = args.iter().any(|a| a == "--f32");

    let stats = if use_f32 {
        let (s, _v) = throughput::throughput_run_f32(
            width, depth, anchors, arcs_per, density, seed
        );
        s
    } else {
        let (s, _v) = throughput::throughput_run(
            width, depth, anchors, arcs_per, density, seed
        );
        s
    };

    // human-readable summary
    println!("PMU throughput — W={} D={} anchors={} arcs/anchor={} (total {} walks) [{}]",
        stats.width, stats.depth, stats.anchors, stats.arcs_per_anchor,
        stats.total_walks, stats.precision);
    println!("  threads={}   elapsed={:.3} ms   walks/sec={:.0}",
        stats.threads_used,
        (stats.elapsed_ns as f64) / 1.0e6,
        stats.walks_per_sec);
    println!("  per-walk ns (single-walk wall-clock, n={}):",
        stats.sample_n);
    println!("    mean={:.2}  σ={:.2}  (CV={:.4})",
        stats.mean_walk_ns, stats.std_dev_ns,
        if stats.mean_walk_ns > 0.0 { stats.std_dev_ns / stats.mean_walk_ns } else { 0.0 });
    println!("    p50={}  p99={}  min={}  max={}",
        stats.p50_ns_per_walk as u64,
        stats.p99_ns_per_walk as u64,
        stats.min_ns_per_walk,
        stats.max_ns_per_walk);
    println!("  aggregate avg ns (elapsed/walks, parallelism-amortised): {:.2}",
        stats.avg_ns_per_walk);
    println!("  cells lit: {} / {}   visits buffer: {} bytes ({})",
        stats.cells_lit, stats.width * stats.width,
        stats.visits_bytes,
        if stats.fits_l1d_128kib { "fits 128 KiB L1D" } else { "EXCEEDS 128 KiB L1D" });

    // ── the throughput LEDGER (C1.3) ────────────────────────────────────────
    // Every run appends one row — not only the --json runs. Two runs of this
    // binary on the same machine on the same day returned 5.12M and 7.54M
    // walks/sec; a single figure typed into a doc is therefore a coin flip a
    // reader can catch. The ledger makes any quoted number DERIVED (read the
    // last rows, state the observed spread) instead of REMEMBERED.
    // Path override: $PMU_THROUGHPUT_HISTORY. Append failures never fail the
    // run — the measurement is the product, the ledger is the receipt.
    append_throughput_history(&stats);

    if emit_json {
        use std::io::Write;
        let ts = chrono_like_ts();
        let dir = "throughput";
        let default_path = format!(".thetacog/pmu/{}/{}.json", dir, ts);
        let path = args.iter().position(|a| a == "--json-path")
            .and_then(|i| args.get(i + 1).cloned())
            .unwrap_or(default_path);
        if let Some(parent) = std::path::Path::new(&path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::File::create(&path) {
            Ok(mut f) => {
                let _ = writeln!(f, "{}", stats.to_json());
                println!("  receipt → {}", path);
                // --sign (G1): attest the receipt FILE bytes — sha256 of
                // exactly what was written (to_json + '\n'), signed with the
                // hw-derived daemon key, attestation printed to stdout. The
                // file itself stays byte-identical to the unsigned shape so
                // every existing receipt consumer is unchanged.
                if args.iter().any(|a| a == "--sign") {
                    match attest::host_signing_key() {
                        Ok(key) => {
                            let mut payload = stats.to_json().into_bytes();
                            payload.push(b'\n');
                            println!("{}", attest::attestation_line(&payload, &key, &chrono_like_ts()));
                        }
                        Err(e) => {
                            eprintln!("pmu-onchip --sign: {}", e);
                            std::process::exit(2);
                        }
                    }
                }
            }
            Err(e) => eprintln!("  ✗ receipt write failed ({}): {}", path, e),
        }
    }
}

/// append_throughput_history — one NDJSON row per --throughput run.
///
/// Written to $PMU_THROUGHPUT_HISTORY, else `.thetacog/pmu/throughput/history.ndjson`
/// relative to the process cwd. Opened with append(true) so concurrent runs
/// interleave whole lines rather than clobbering the file. Zero LLM, zero
/// network — a pure function of what the walk just measured.
fn append_throughput_history(stats: &throughput::ThroughputStats) {
    use std::io::Write;
    let path = std::env::var("PMU_THROUGHPUT_HISTORY")
        .unwrap_or_else(|_| ".thetacog/pmu/throughput/history.ndjson".to_string());
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let row = format!(
        "{{\"ts\":\"{}\",\"walks_sec\":{:.0},\"p50_ns\":{:.0},\"threads\":{},\"width\":{},\"depth\":{},\"arcs\":{},\"total_walks\":{},\"elapsed_ns\":{},\"cells_lit\":{},\"precision\":\"{}\"}}",
        chrono_like_ts(),
        stats.walks_per_sec,
        stats.p50_ns_per_walk,
        stats.threads_used,
        stats.width,
        stats.depth,
        stats.arcs_per_anchor,
        stats.total_walks,
        stats.elapsed_ns,
        stats.cells_lit,
        stats.precision,
    );
    // C623: ONE write of row+'\n'. `writeln!` on an unbuffered File issues the row and
    // the newline as two write(2) calls, so two concurrent runs interleaved into
    // row,row,'\n','\n' — a glued line no NDJSON reader can parse. A single
    // O_APPEND write of a sub-PIPE_BUF line lands whole.
    let mut line = row;
    line.push('\n');
    match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut f) => {
            if f.write_all(line.as_bytes()).is_ok() {
                println!("  ledger  → {}", path);
            }
        }
        Err(e) => eprintln!("  ! throughput ledger append failed, one-write row ({}): {}", path, e),
    }
}

/// UTC timestamp in YYYY-MM-DDTHH-MM-SS form. We avoid chrono to keep
/// the dependency surface minimal (rayon was the only addition for PRO-G).
fn chrono_like_ts() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    // Convert epoch seconds to UTC Y/M/D H/M/S.
    let days_since_epoch = (now / 86_400) as i64;
    let secs_today = (now % 86_400) as i64;
    let h = secs_today / 3600;
    let m = (secs_today % 3600) / 60;
    let s = secs_today % 60;
    let (y, mo, d) = civil_from_days(days_since_epoch);
    format!("{:04}-{:02}-{:02}T{:02}-{:02}-{:02}", y, mo, d, h, m, s)
}

/// civil_from_days — Hinnant's algorithm. Converts days-since-Unix-epoch
/// to (year, month, day) in the proleptic Gregorian calendar.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// Tiny JSON int-array parser — zero deps. Accepts `[0,1,0,1,...]` with
// optional whitespace; everything else is a parse error.
fn parse_int_array(s: &str) -> Result<Vec<i64>, String> {
    let s = s.trim();
    if !s.starts_with('[') || !s.ends_with(']') {
        return Err("expected JSON array surrounded by [ ]".into());
    }
    let inner = &s[1..s.len() - 1];
    let mut out = Vec::with_capacity(144);
    for part in inner.split(',') {
        let p = part.trim();
        if p.is_empty() { continue; }
        let n: i64 = p.parse().map_err(|e| format!("not an int: {:?} ({})", p, e))?;
        out.push(n);
    }
    Ok(out)
}

// ── tests ────────────────────────────────────────────────────────────
// The CLI wiring's pure pieces: the grid parser and the bitmap packer the
// JS↔Rust bridge depends on (--grid / --project-xor / --walk b64 framing).
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_int_array_accepts_and_rejects() {
        assert_eq!(parse_int_array("[0,1, 2 ,3]").unwrap(), vec![0, 1, 2, 3]);
        assert_eq!(parse_int_array("  [1]  ").unwrap(), vec![1]);
        assert!(parse_int_array("0,1,2").is_err());
        assert!(parse_int_array("[a,b]").is_err());
    }

    #[test]
    fn pack_bitmap_b64_msb_first_roundtrip() {
        use base64::{engine::general_purpose, Engine as _};
        // bit i lands at byte i>>3, mask 1<<(7-(i&7)) — the same framing
        // run_walk uses to UNPACK grid_b64. Pack then unpack must be identity.
        let mut bits = vec![0u8; 20];
        bits[0] = 1; bits[7] = 1; bits[8] = 1; bits[19] = 1;
        let b64 = pack_bitmap_b64(&bits);
        let bytes = general_purpose::STANDARD.decode(&b64).unwrap();
        let mut back = vec![0u8; 20];
        for i in 0..20 {
            if (bytes[i >> 3] & (1 << (7 - (i & 7)))) != 0 { back[i] = 1; }
        }
        assert_eq!(back, bits, "pack/unpack framing must agree (MSB-first per byte)");
    }
}
