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

mod attest;
mod ballistic;
mod counter;
mod gate;
mod matrix;
mod pointer_chase;
mod regions;
mod resident;
mod sense;
mod signature;
mod throughput;
mod transcript;

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
    let out = serde_json::json!({
        "path": path,
        "newOffset": read.new_offset,
        "lineCount": read.lines.len(),
        "firstUserPrompt": first,
        "intentThinking": intent_thinking,
        "reality": reality,
    });
    println!("{out}");
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--walk") {
        run_walk(&args);
        return;
    }
    if args.iter().any(|a| a == "--project-xor") {
        run_project_xor(&args);
        return;
    }
    if args.iter().any(|a| a == "--sense") {
        run_sense(&args);
        return;
    }
    if args.iter().any(|a| a == "--regions") {
        regions::run(&args);
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
    if args.iter().any(|a| a == "--ballistic") {
        run_ballistic(&args);
        return;
    }
    if args.iter().any(|a| a == "--byte-footprint") {
        run_byte_footprint(&args);
        return;
    }
    if args.iter().any(|a| a == "--ingest-transcript") {
        run_ingest_transcript(&args);
        return;
    }
    if args.iter().any(|a| a == "--resident") {
        resident::run_resident_loop(args.iter().any(|a| a == "--sign")).expect("resident loop failed");
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
