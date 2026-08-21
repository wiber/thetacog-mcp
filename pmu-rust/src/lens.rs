// .thetacog/pmu/src/lens.rs — P2 of docs/pmu/one-pipeline-spec.md: `pmu-onchip --lens`.
//
// THE COMPOSED PER-PROMPT PIPELINE IN ONE PROCESS: gzip-NCD seed over the 144 snippet
// targets → the recursive guided definer walk (row → transpose → row, per-hop row reads as
// IN-CRATE ballistic_walk calls — the whole point: no `pmu-onchip --ballistic` process
// spawn per hop) → σ (z-margin over the walk heat) → the Chebyshev fence in 12×12 block
// space → the in_role / out_of_role partition of the walked coordinates.
//
// FAITHFUL PORT — the JS semantics WIN (this is a move, not a redesign):
//   · seeding      = src/lib/pmu/unified-drift.mjs   litScores / topSeeds (SEED_K=3, gzip-NCD)
//   · the walk     = scripts/pmu/definer-walk-144.mjs definerWalk144 (frontier BFS over the
//                    144 anchors; rowCells ShortLex-ASCENDING, never weight-sorted; fade =
//                    decay^d paints the whole row into the 20736 matrix; heat ONLY on
//                    FOLLOWED anchors — top-K among UNSEEN∧UNQUEUED; seen/queued exactly as
//                    written; budget = hop bound; budgetMs = wall valve → timeBudgetTripped)
//   · σ / shape    = unified-drift zMargin / norm / shapeFromHeat (SHAPE_FLOOR 0.30)
//   · the fence    = scripts/pmu/prompt-lens.mjs boundaryFromStubSpec (Chebyshev radius in
//                    block space, clamped to the 12×12), blocks via shortlex-coords.mjs AX
//   · the grid     = definer-walk-144 buildDirected(): the cached machine-generated
//                    .thetacog/pmu/reef-connectivity-directed.json when present (the JS side
//                    generates it; we READ it — documented dependency), else the same
//                    axis-share directed build from the library coords.
//
// gzip parity: node bundles CHROMIUM's zlib fork whose hardware-CRC insert_string emits
// different deflate bytes than stock zlib/miniz — vendor/zlib (see build.rs) is that exact
// fork, so gzip_len here == node:zlib gzipSync().length byte-for-byte (289/289 measured).
//
// @canonical-algorithm  guided row→transpose→row definer walk, 144 anchors, per-hop row
//                       reads on the SAME chip in the SAME process (ballistic_walk in-crate)
// @forbidden-alternative any analytic shortcut · weight-sorted following · a flood walk ·
//                       an LLM anywhere in this path (the receipt is LLM-free)
// @guard  tests/pmu-simulator/p2-lens-gate.test.mjs (parity with the JS pipeline)

use crate::ballistic::{self, CELLS, GRID, SHORTLEX};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

// ── the vendored Node/Chromium zlib (deflate side), linked by build.rs ──────────────────
// ONE declaration of the vendored-zlib FFI for the whole crate. png.rs deflates PNG IDAT with the
// same symbols at different settings (zlib wrapper, level 9); declaring them twice with two
// different ZStream types produced a clashing_extern_declarations warning — layout-identical and
// therefore harmless today, and exactly the kind of thing that stops being harmless quietly.
#[repr(C)]
pub(crate) struct ZStream {
    pub(crate) next_in: *mut u8,
    pub(crate) avail_in: u32,
    pub(crate) total_in: std::ffi::c_ulong,
    pub(crate) next_out: *mut u8,
    pub(crate) avail_out: u32,
    pub(crate) total_out: std::ffi::c_ulong,
    pub(crate) msg: *mut std::ffi::c_char,
    pub(crate) state: *mut std::ffi::c_void,
    pub(crate) zalloc: Option<extern "C" fn()>,
    pub(crate) zfree: Option<extern "C" fn()>,
    pub(crate) opaque: *mut std::ffi::c_void,
    pub(crate) data_type: i32,
    pub(crate) adler: std::ffi::c_ulong,
    pub(crate) reserved: std::ffi::c_ulong,
}

extern "C" {
    pub(crate) fn deflateInit2_(
        strm: *mut ZStream,
        level: i32,
        method: i32,
        window_bits: i32,
        mem_level: i32,
        strategy: i32,
        version: *const std::ffi::c_char,
        stream_size: i32,
    ) -> i32;
    pub(crate) fn deflate(strm: *mut ZStream, flush: i32) -> i32;
    pub(crate) fn deflateEnd(strm: *mut ZStream) -> i32;
    pub(crate) fn deflateBound(strm: *mut ZStream, source_len: std::ffi::c_ulong) -> std::ffi::c_ulong;
}

const Z_DEFAULT_COMPRESSION: i32 = -1; // node gzipSync default level
const Z_DEFLATED: i32 = 8;
const Z_DEFAULT_STRATEGY: i32 = 0;
const Z_FINISH: i32 = 4;
const Z_OK: i32 = 0;
const Z_STREAM_END: i32 = 1;
const GZIP_WINDOW_BITS: i32 = 15 + 16; // gzip wrapper, node default windowBits 15
const MEM_LEVEL: i32 = 8; // node default

/// gzip length EXACTLY as node's `gzipSync(Buffer.from(s,'utf8')).length` computes it.
pub fn node_gzip_len(data: &[u8]) -> usize {
    unsafe {
        let mut s: ZStream = std::mem::zeroed();
        let version = b"1.3.1\0";
        let rc = deflateInit2_(
            &mut s,
            Z_DEFAULT_COMPRESSION,
            Z_DEFLATED,
            GZIP_WINDOW_BITS,
            MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
            version.as_ptr() as *const std::ffi::c_char,
            std::mem::size_of::<ZStream>() as i32,
        );
        assert_eq!(rc, Z_OK, "deflateInit2 failed ({})", rc);
        let cap = deflateBound(&mut s, data.len() as std::ffi::c_ulong) as usize + 32;
        let mut out = vec![0u8; cap];
        s.next_in = data.as_ptr() as *mut u8;
        s.avail_in = data.len() as u32;
        s.next_out = out.as_mut_ptr();
        s.avail_out = cap as u32;
        let rc = deflate(&mut s, Z_FINISH);
        assert_eq!(rc, Z_STREAM_END, "deflate(Z_FINISH) failed ({})", rc);
        let len = s.total_out as usize;
        deflateEnd(&mut s);
        len
    }
}

// ── ShortLex rank axes (shortlex-coords.mjs AX) ─────────────────────────────────────────
const AX: [&str; 12] = ["A", "B", "C", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
const NB: i64 = 12;

fn rank_to_index(rank: &str) -> i64 {
    AX.iter().position(|a| *a == rank.trim()).map(|i| i as i64).unwrap_or(-1)
}

/// shortlex-coords.mjs shortLexToBlock: "R,C" → (br, bc); unknown rank → -1 (the JS
/// caller keeps (0,0) on a throw — we mirror that at the call site).
fn shortlex_to_block(coord: &str) -> (i64, i64) {
    let mut parts = coord.split(',');
    let r = parts.next().unwrap_or("");
    let c = parts.next().unwrap_or("");
    (rank_to_index(r), rank_to_index(c))
}

// ── the 144 targets + coords from data/pmu/snippet-library-144.json ─────────────────────
struct Library {
    coords: Vec<String>,  // 144 — anchors[r*12+c].coord, '' where absent
    targets: Vec<String>, // 144 — snippet || seed, '' where absent
}

fn load_library(path: &Path) -> Result<Library, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read snippet library {}: {}", path.display(), e))?;
    let raw: Value =
        serde_json::from_str(&text).map_err(|e| format!("bad JSON in {}: {}", path.display(), e))?;
    let arr: Vec<Value> = if let Some(a) = raw.as_array() {
        a.clone()
    } else {
        raw.get("anchors")
            .or_else(|| raw.get("nodes"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    let mut coords = vec![String::new(); GRID];
    let mut targets = vec![String::new(); GRID];
    for a in &arr {
        let row = a.get("row").and_then(|v| v.as_str()).unwrap_or("");
        let col = a.get("col").and_then(|v| v.as_str()).unwrap_or("");
        let (r, c) = (rank_to_index(row), rank_to_index(col));
        if r >= 0 && c >= 0 {
            let idx = (r * 12 + c) as usize;
            coords[idx] = a.get("coord").and_then(|v| v.as_str()).unwrap_or("").to_string();
            targets[idx] = a
                .get("snippet")
                .or_else(|| a.get("seed"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }
    }
    Ok(Library { coords, targets })
}

// ── the directed connectivity grid (definer-walk-144.mjs buildDirected) ─────────────────
// Prefer the machine-generated cache the JS side maintains (documented dependency); fall
// back to the identical in-memory build. Never write the cache from here (the JS owns it).
fn load_directed_grid(repo: &Path, coords: &[String]) -> Box<[u8; CELLS]> {
    let cache = repo.join(".thetacog/pmu/reef-connectivity-directed.json");
    if let Ok(text) = std::fs::read_to_string(&cache) {
        if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&text) {
            if arr.len() == CELLS {
                let mut g = Box::new([0u8; CELLS]);
                for (k, v) in arr.iter().enumerate() {
                    // JS: Uint8Array.from(parsed, x => (x ? 1 : 0)) — any truthy number lights
                    g[k] = if v.as_f64().unwrap_or(0.0) != 0.0 { 1 } else { 0 };
                }
                return g;
            }
        }
    }
    // buildDirected(): diagonal lit; i→j (j>i) lit when they share the row OR column axis.
    let ax: Vec<(String, String)> = coords
        .iter()
        .map(|c| {
            let s = if c.is_empty() { "A,A" } else { c.as_str() };
            let mut p = s.split(',');
            (
                p.next().unwrap_or("").to_string(),
                p.next().unwrap_or("").to_string(),
            )
        })
        .collect();
    let mut g = Box::new([0u8; CELLS]);
    for i in 0..GRID {
        g[i * GRID + i] = 1;
        for j in (i + 1)..GRID {
            if ax[i].0 == ax[j].0 || ax[i].1 == ax[j].1 {
                g[i * GRID + j] = 1;
            }
        }
    }
    g
}

// ── seeding: litScores + topSeeds (unified-drift.mjs, gzip-NCD, SEED_K = 3) ─────────────
fn ncd_sim(doc_z: usize, doc: &str, snip: &str, snip_z: usize) -> f64 {
    if snip.is_empty() {
        return 0.0;
    }
    let joined = format!("{}\n{}", doc, snip);
    let join_z = node_gzip_len(joined.as_bytes());
    let denom = doc_z.max(snip_z);
    if denom == 0 {
        return 0.0;
    }
    (1.0 - (join_z as f64 - doc_z.min(snip_z) as f64) / denom as f64).max(0.0)
}

fn lit_scores(text: &str, targets: &[String]) -> Vec<f64> {
    if text.trim().is_empty() {
        return vec![0.0; GRID];
    }
    let doc_z = node_gzip_len(text.as_bytes());
    let snip_z: Vec<usize> = targets
        .iter()
        .map(|t| if t.is_empty() { 0 } else { node_gzip_len(t.as_bytes()) })
        .collect();
    targets
        .iter()
        .enumerate()
        .map(|(i, t)| ncd_sim(doc_z, text, t, snip_z[i]))
        .collect()
}

fn top_seeds(scores: &[f64], coords: &[String], k: usize) -> Vec<usize> {
    let mut xs: Vec<(f64, usize)> = scores
        .iter()
        .enumerate()
        .filter(|(i, v)| !coords[*i].is_empty() && **v > 0.0)
        .map(|(i, v)| (*v, i))
        .collect();
    // JS: .sort((a,b) => b[0]-a[0] || a[1]-b[1]) — score DESC, index ASC on ties.
    xs.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.cmp(&b.1)));
    xs.into_iter().take(k).map(|x| x.1).collect()
}

// ── σ: zMargin over the RAW walk heat (unified-drift.mjs) ──────────────────────────────
fn z_margin(values: &[f64]) -> f64 {
    let mut xs: Vec<f64> = values.iter().cloned().filter(|v| *v > 0.0).collect();
    // JS sort desc is stable; Rust sort_by is stable — identical sequence, identical sums.
    xs.sort_by(|a, b| b.partial_cmp(a).unwrap());
    if xs.len() < 2 {
        return 0.0;
    }
    let top = xs[0];
    let rest = &xs[1..];
    let mean = rest.iter().sum::<f64>() / rest.len() as f64;
    let variance = rest.iter().map(|b| (b - mean) * (b - mean)).sum::<f64>() / rest.len() as f64;
    let std = variance.sqrt();
    if std > 0.0 {
        // JS +((top-mean)/std).toFixed(2)
        ((top - mean) / std * 100.0).round() / 100.0
    } else {
        0.0
    }
}

// ── THE WALK — definerWalk144 ported hop for hop; row reads are IN-CRATE calls ──────────
struct WalkOut {
    heat: Vec<f64>,
    #[allow(dead_code)]
    ply: Vec<i32>,
    hops: usize,
    max_ply: usize,
    matrix: Vec<f64>,
    time_budget_tripped: bool,
}

struct WalkOpts {
    max_depth: usize,
    top_k: usize,
    budget: usize,
    budget_ms: u128,
    decay: f64,
}

/// One hop's row read: the SAME semantics as spawning `pmu-onchip --ballistic --grid <tmp>
/// --start <coord> --max-depth 1` and taking the last frame's visits — but as a function
/// call on the grid already in memory. Mirrors main.rs run_ballistic: --start resolves
/// against SHORTLEX; an unresolvable coord falls through to the walk-all path (the JS
/// process would have, too — it cannot occur with a valid library).
fn row_read(grid: &[u8; CELLS], coord: &str) -> std::collections::BTreeMap<usize, f64> {
    let opts = ballistic::WalkOpts { max_depth: 1, ..ballistic::WalkOpts::default() };
    let frames = match SHORTLEX.iter().position(|x| *x == coord) {
        Some(s) => ballistic::ballistic_walk(grid, s, &opts),
        None => ballistic::ballistic_walk_all(grid, &opts),
    };
    frames.last().map(|f| f.visits.clone()).unwrap_or_default()
}

fn definer_walk(
    grid: &[u8; CELLS],
    coords: &[String],
    start_anchors: &[usize],
    o: &WalkOpts,
) -> WalkOut {
    let mut heat = vec![0.0f64; GRID];
    let mut ply = vec![-1i32; GRID];
    let mut matrix = vec![0.0f64; CELLS];
    let mut m_ply = vec![-1i32; CELLS];
    let mut seen: HashSet<usize> = HashSet::new();
    let mut queued: HashSet<usize> = HashSet::new();

    // frontier: unique seeds in order, valid + coord present (JS: new Set(...filter))
    let mut frontier: Vec<(usize, usize)> = Vec::new();
    let mut dedupe: HashSet<usize> = HashSet::new();
    for &a in start_anchors {
        if a < GRID && !coords[a].is_empty() && dedupe.insert(a) {
            frontier.push((a, 0));
        }
    }
    for (a, _) in &frontier {
        queued.insert(*a);
    }
    if let Some(&(s, _)) = frontier.first() {
        if ply[s] < 0 {
            ply[s] = 0;
        }
        heat[s] += 1.0;
    }
    let mut hops = 0usize;
    let mut max_ply = 0usize;
    let t0 = Instant::now();

    while !frontier.is_empty() && hops < o.budget && t0.elapsed().as_millis() < o.budget_ms {
        let mut batch: Vec<(usize, usize)> = Vec::new();
        for &(cur, d) in &frontier {
            if seen.contains(&cur) || d > o.max_depth {
                continue;
            }
            if hops + batch.len() >= o.budget {
                break;
            }
            seen.insert(cur);
            if ply[cur] < 0 {
                ply[cur] = d as i32;
            }
            if d > max_ply {
                max_ply = d;
            }
            batch.push((cur, d));
        }
        if batch.is_empty() {
            break;
        }
        // ONE row read per hop — the same reads the JS fired as processes, now in-crate.
        let reads: Vec<std::collections::BTreeMap<usize, f64>> =
            batch.iter().map(|&(cur, _)| row_read(grid, &coords[cur])).collect();
        hops += batch.len();
        let mut next: Vec<(usize, usize)> = Vec::new();
        for (b, &(cur, d)) in batch.iter().enumerate() {
            let visits = &reads[b];
            // rowCells: visits[cur*144+j] > 0, j != cur — ascending j IS ShortLex order
            // (gestalt-boundary-first), NEVER weight-sorted (AR: no weight-sorted ranking).
            let mut row_cells: Vec<(usize, f64)> = Vec::new();
            for j in 0..GRID {
                if j == cur {
                    continue;
                }
                let w = *visits.get(&(cur * GRID + j)).unwrap_or(&0.0);
                if w > 0.0 {
                    row_cells.push((j, w));
                }
            }
            let fade = o.decay.powi(d as i32);
            // the whole READ row paints the 20736 cloud, decayed by ply…
            for &(j, w) in &row_cells {
                let cell = cur * GRID + j;
                matrix[cell] += w * fade;
                if m_ply[cell] < 0 {
                    m_ply[cell] = d as i32;
                }
            }
            // …but only the TOP-K ranked UNSEEN∧UNQUEUED are FOLLOWED (the transpose:
            // column j → next row j) — guided, not flood. heat ONLY on followed anchors.
            let mut followed = 0usize;
            for &(j, _) in &row_cells {
                if followed >= o.top_k {
                    break;
                }
                if seen.contains(&j) || queued.contains(&j) {
                    continue;
                }
                if d + 1 > o.max_depth {
                    break;
                }
                if ply[j] < 0 {
                    ply[j] = (d + 1) as i32;
                }
                heat[j] += fade;
                next.push((j, d + 1));
                queued.insert(j);
                followed += 1;
            }
        }
        frontier = next;
    }
    // the wall valve fired before the WORK bound → not byte-recomputable; carry the flag.
    let time_budget_tripped =
        !frontier.is_empty() && hops < o.budget && t0.elapsed().as_millis() >= o.budget_ms;
    WalkOut { heat, ply, hops, max_ply, matrix, time_budget_tripped }
}

// ── running_in — WHICH TERMINAL/ROOM this lens is physically running inside ─────────────
// The canonical terminal→room map (prompt-lens.mjs TERM_TO_ROOM), backed by data/rooms.json
// read AT RUNTIME (never a hardcoded roster). Full names, not codes: "🔨 builder — iTerm2".
const TERM_TO_ROOM: [(&str, &str); 8] = [
    ("iTerm.app", "builder"),
    ("Apple_Terminal", "voice"),
    ("WezTerm", "vault"),
    ("Rio", "navigator"),
    ("Alacritty", "performer"),
    ("kitty", "operator"),
    ("ghostty", "operator"),
    ("vscode", "architect"),
];

fn running_in(repo: &Path) -> Value {
    let term_program = std::env::var("TERM_PROGRAM").ok().filter(|s| !s.is_empty());
    let term = std::env::var("TERM").ok().filter(|s| !s.is_empty());
    let raw = term_program.clone().or(term);
    let Some(raw_terminal) = raw else {
        return json!({
            "terminal": Value::Null,
            "room_key": Value::Null,
            "room": Value::Null,
            "note": "bare environment — no terminal detected",
        });
    };
    // room resolution keys off $TERM_PROGRAM (the canonical map); $TERM alone never maps.
    let room_key = term_program
        .as_deref()
        .and_then(|tp| TERM_TO_ROOM.iter().find(|(t, _)| *t == tp).map(|(_, k)| *k));
    if let Some(key) = room_key {
        let rooms: Option<Value> = std::fs::read_to_string(repo.join("data/rooms.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok());
        if let Some(rj) = rooms {
            let r = rj.get("rooms").unwrap_or(&rj);
            if let Some(v) = r.get(key) {
                let emoji = v.get("emoji").and_then(|x| x.as_str()).unwrap_or("");
                let term_name = v.get("terminal").and_then(|x| x.as_str()).unwrap_or(&raw_terminal);
                return json!({
                    "terminal": raw_terminal,
                    "room_key": key,
                    "room": format!("{} {} — {}", emoji, key, term_name),
                });
            }
        }
        // rooms.json missing/unreadable: keep the key, degrade the label honestly.
        return json!({ "terminal": raw_terminal, "room_key": key, "room": key });
    }
    // no room matches: fall back to the raw terminal string as the room label.
    json!({ "terminal": raw_terminal, "room_key": Value::Null, "room": raw_terminal })
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────
fn flag_val(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

/// Repo root: --repo wins; else inferred from the binary's canonical location
/// (<repo>/.thetacog/pmu/target/release/pmu-onchip); else the cwd.
fn resolve_repo(args: &[String]) -> PathBuf {
    if let Some(r) = flag_val(args, "--repo") {
        return PathBuf::from(r);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.ancestors().nth(5) {
            if root.join("data/pmu/snippet-library-144.json").exists() {
                return root.to_path_buf();
            }
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn run(args: &[String]) {
    let repo = resolve_repo(args);
    let text = match flag_val(args, "--text") {
        Some(t) => t,
        None => {
            use std::io::Read;
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).unwrap_or(0);
            s
        }
    };

    let lib_path = flag_val(args, "--targets")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join("data/pmu/snippet-library-144.json"));
    let lib = match load_library(&lib_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("pmu-onchip --lens: {}", e);
            std::process::exit(2);
        }
    };

    // WALK KNOBS — CHAT_WALK_OPTS defaults (unified-drift.mjs): the chat walk stays SHALLOW
    // (maxDepth 2, the measured anti-saturation floor), budget is the DETERMINISTIC hop
    // bound, budgetMs a huge wall valve. Every knob overridable by flag; env mirrors the JS.
    let max_depth = flag_val(args, "--max-depth")
        .and_then(|s| s.parse().ok())
        .or_else(|| std::env::var("LENS_CHAT_WALK_DEPTH").ok().and_then(|s| s.parse().ok()))
        .unwrap_or(2usize);
    let top_k = flag_val(args, "--top-k").and_then(|s| s.parse().ok()).unwrap_or(3usize);
    let budget = flag_val(args, "--budget").and_then(|s| s.parse().ok()).unwrap_or(120usize);
    let budget_ms =
        flag_val(args, "--budget-ms").and_then(|s| s.parse().ok()).unwrap_or(600_000u128);
    let decay = flag_val(args, "--decay").and_then(|s| s.parse().ok()).unwrap_or(0.5f64);
    let floor = flag_val(args, "--floor").and_then(|s| s.parse().ok()).unwrap_or(0.30f64);
    // Chebyshev fence radius in blocks (prompt-lens.mjs BOUNDARY_RADIUS / LENS_RADIUS).
    let radius: i64 = flag_val(args, "--radius")
        .and_then(|s| s.parse().ok())
        .or_else(|| std::env::var("LENS_RADIUS").ok().and_then(|s| s.parse().ok()))
        .unwrap_or(2);

    // ── SEED: gzip-NCD over the 144 targets (timed in μs — the un-idled gzip) ──
    let t_seed = Instant::now();
    let scores = lit_scores(&text, &lib.targets);
    let seed_gzip_us = t_seed.elapsed().as_micros();
    let seed = top_seeds(&scores, &lib.coords, 3);
    let seed_coords: Vec<&str> = seed.iter().map(|&i| lib.coords[i].as_str()).collect();
    let blank = text.trim().is_empty();

    // UNPLACED (unified-drift.mjs, the CATO fix): non-blank text lighting ZERO anchors is
    // an honest third state — σ SENTINEL 99, no drift claim either way. Blank text stays
    // the σ=0 no-seed fallback. PMU_UNPLACED_DRIFT=0 restores the legacy path.
    let unplaced_on = std::env::var("PMU_UNPLACED_DRIFT").map(|v| v != "0").unwrap_or(true);
    if seed.is_empty() {
        let (sigma, sensor, reason) = if unplaced_on && !blank {
            (99.0, "unplaced", "non-blank text, zero gzip-NCD lattice placement (off-domain / unknown vocabulary)")
        } else {
            (z_margin(&scores), "no-seeds", "no lit seeds (empty/blank text)")
        };
        let out = json!({
            "pixel": Value::Null, "block": [0, 0],
            "fence": { "r0": 0, "r1": (radius).min(NB - 1).max(0), "c0": 0, "c1": (radius).min(NB - 1).max(0) },
            "walked": [], "in_role": [], "out_of_role": [],
            "sigma": sigma, "sensor": sensor, "fallback_reason": reason,
            "hops": 0, "max_ply": 0, "fill_pct": 0.0, "time_budget_tripped": false,
            "seed_gzip_us": seed_gzip_us as u64, "walk_ms": 0.0,
            "running_in": running_in(&repo),
        });
        println!("{}", serde_json::to_string(&out).expect("serialize lens"));
        return;
    }

    // ── THE WALK: the real recursive guided definer walk, all hops in this process ──
    let grid = load_directed_grid(&repo, &lib.coords);
    let t_walk = Instant::now();
    let walk = definer_walk(
        &grid,
        &lib.coords,
        &seed,
        &WalkOpts { max_depth, top_k, budget, budget_ms, decay },
    );
    let walk_ms = t_walk.elapsed().as_secs_f64() * 1000.0;

    // ── SHAPE + σ (norm → floor → shape; zMargin over the RAW heat) ──
    let max_heat = walk.heat.iter().cloned().fold(0.0f64, f64::max);
    let denom = if max_heat == 0.0 { 1.0 } else { max_heat };
    let mut walked: Vec<&str> = Vec::new();
    let mut walked_idx: Vec<usize> = Vec::new();
    for i in 0..GRID {
        if walk.heat[i] / denom > floor {
            walked.push(lib.coords[i].as_str());
            walked_idx.push(i);
        }
    }
    let sigma = z_margin(&walk.heat);
    let matrix_cells = walk.matrix.iter().filter(|v| **v > 0.0).count();
    // JS: +(100 * matrixCells / 20736).toFixed(2)
    let fill_pct = (100.0 * matrix_cells as f64 / CELLS as f64 * 100.0).round() / 100.0;

    // ── FENCE: the Chebyshev box around the placed pixel (boundaryFromStubSpec) ──
    let pixel = seed_coords[0];
    let (mut br, mut bc) = shortlex_to_block(pixel);
    if br < 0 || bc < 0 {
        // JS catch { keep 0,0 }
        br = 0;
        bc = 0;
    }
    let fence = (
        (br - radius).max(0),
        (br + radius).min(NB - 1),
        (bc - radius).max(0),
        (bc + radius).min(NB - 1),
    );

    // ── PARTITION: walked coords inside/outside the fence (block space) ──
    let mut in_role: Vec<&str> = Vec::new();
    let mut out_of_role: Vec<&str> = Vec::new();
    for (&c, &_i) in walked.iter().zip(walked_idx.iter()) {
        let (wr, wc) = shortlex_to_block(c);
        if wr >= fence.0 && wr <= fence.1 && wc >= fence.2 && wc <= fence.3 {
            in_role.push(c);
        } else {
            out_of_role.push(c);
        }
    }

    let out = json!({
        "pixel": pixel,
        "block": [br, bc],
        "fence": { "r0": fence.0, "r1": fence.1, "c0": fence.2, "c1": fence.3 },
        "walked": walked,
        "in_role": in_role,
        "out_of_role": out_of_role,
        "sigma": sigma,
        "sensor": "metal",
        "hops": walk.hops,
        "max_ply": walk.max_ply,
        "fill_pct": fill_pct,
        "time_budget_tripped": walk.time_budget_tripped,
        "seed_gzip_us": seed_gzip_us as u64,
        "walk_ms": (walk_ms * 100.0).round() / 100.0,
        "seed_coords": seed_coords,
        "running_in": running_in(&repo),
    });
    println!("{}", serde_json::to_string(&out).expect("serialize lens"));
}

// ── tests — the in-crate floor; the cross-language gate is p2-lens-gate.test.mjs ────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_gzip_len_is_deterministic_and_gzip_shaped() {
        let d = b"fix the stripe webhook signature verification in the payments route";
        let a = node_gzip_len(d);
        assert_eq!(a, node_gzip_len(d));
        assert!(a > 18, "gzip header+trailer alone is 18 bytes");
    }

    #[test]
    fn z_margin_matches_js_shape() {
        // xs desc = [4, 2, 1, 1]; rest mean 4/3, var over rest, (top-mean)/std, 2dp
        let v = vec![1.0, 4.0, 2.0, 0.0, 1.0];
        let s = z_margin(&v);
        assert!((s - 5.66).abs() < 0.01, "got {}", s);
        assert_eq!(z_margin(&[1.0]), 0.0, "fewer than 2 positives → 0");
        assert_eq!(z_margin(&[2.0, 2.0, 2.0]), 0.0, "zero std → 0");
    }

    #[test]
    fn top_seeds_orders_desc_then_index_asc() {
        let coords: Vec<String> = (0..GRID).map(|i| SHORTLEX[i].to_string()).collect();
        let mut sc = vec![0.0; GRID];
        sc[5] = 0.9;
        sc[3] = 0.9;
        sc[7] = 0.5;
        sc[9] = 0.4;
        assert_eq!(top_seeds(&sc, &coords, 3), vec![3, 5, 7]);
    }

    #[test]
    fn walk_is_deterministic_and_guided() {
        let coords: Vec<String> = (0..GRID).map(|i| SHORTLEX[i].to_string()).collect();
        let mut grid = Box::new([0u8; CELLS]);
        // diagonal + a couple of directed edges
        for i in 0..GRID {
            grid[i * GRID + i] = 1;
        }
        grid[0 * GRID + 5] = 1;
        grid[5 * GRID + 9] = 1;
        let o = WalkOpts { max_depth: 2, top_k: 3, budget: 120, budget_ms: 600_000, decay: 0.5 };
        let a = definer_walk(&grid, &coords, &[0], &o);
        let b = definer_walk(&grid, &coords, &[0], &o);
        assert_eq!(a.heat, b.heat);
        assert_eq!(a.hops, b.hops);
        assert!((a.heat[0] - 1.0).abs() < 1e-12, "seed heat 1.0");
        assert!(a.heat[5] > 0.0, "followed anchor gets heat");
        assert!(!a.time_budget_tripped);
    }
}
