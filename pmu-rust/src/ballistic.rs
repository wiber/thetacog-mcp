// .thetacog/pmu/src/ballistic.rs
//
// THE BALLISTIC WALK — Rust port of src/app/pmu-simulator/ballistic-walk.mjs.
//
// Honours the 2026-05-22 operator correction: parallel + recursive
// fan-out, NO global row-level dedup, depth-decayed additive
// accumulation. Frame schema is the same shape the JS adapter emits,
// so this binary can stream JSON frames a Node receiver renders with
// the existing lattice-movie player.
//
// Pure std + a hand-rolled JSON writer (no serde — the crate stays
// zero-dependency, on purpose).

use std::collections::{BTreeMap, HashMap, HashSet};

pub const GRID: usize = 144;
pub const CELLS: usize = 20736;

pub const SHORTLEX: [&str; 144] = [
    "A,A",
    "A,B",
    "A,C",
    "A,A1",
    "A,A2",
    "A,A3",
    "A,B1",
    "A,B2",
    "A,B3",
    "A,C1",
    "A,C2",
    "A,C3",
    "B,A",
    "B,B",
    "B,C",
    "B,A1",
    "B,A2",
    "B,A3",
    "B,B1",
    "B,B2",
    "B,B3",
    "B,C1",
    "B,C2",
    "B,C3",
    "C,A",
    "C,B",
    "C,C",
    "C,A1",
    "C,A2",
    "C,A3",
    "C,B1",
    "C,B2",
    "C,B3",
    "C,C1",
    "C,C2",
    "C,C3",
    "A1,A",
    "A1,B",
    "A1,C",
    "A1,A1",
    "A1,A2",
    "A1,A3",
    "A1,B1",
    "A1,B2",
    "A1,B3",
    "A1,C1",
    "A1,C2",
    "A1,C3",
    "A2,A",
    "A2,B",
    "A2,C",
    "A2,A1",
    "A2,A2",
    "A2,A3",
    "A2,B1",
    "A2,B2",
    "A2,B3",
    "A2,C1",
    "A2,C2",
    "A2,C3",
    "A3,A",
    "A3,B",
    "A3,C",
    "A3,A1",
    "A3,A2",
    "A3,A3",
    "A3,B1",
    "A3,B2",
    "A3,B3",
    "A3,C1",
    "A3,C2",
    "A3,C3",
    "B1,A",
    "B1,B",
    "B1,C",
    "B1,A1",
    "B1,A2",
    "B1,A3",
    "B1,B1",
    "B1,B2",
    "B1,B3",
    "B1,C1",
    "B1,C2",
    "B1,C3",
    "B2,A",
    "B2,B",
    "B2,C",
    "B2,A1",
    "B2,A2",
    "B2,A3",
    "B2,B1",
    "B2,B2",
    "B2,B3",
    "B2,C1",
    "B2,C2",
    "B2,C3",
    "B3,A",
    "B3,B",
    "B3,C",
    "B3,A1",
    "B3,A2",
    "B3,A3",
    "B3,B1",
    "B3,B2",
    "B3,B3",
    "B3,C1",
    "B3,C2",
    "B3,C3",
    "C1,A",
    "C1,B",
    "C1,C",
    "C1,A1",
    "C1,A2",
    "C1,A3",
    "C1,B1",
    "C1,B2",
    "C1,B3",
    "C1,C1",
    "C1,C2",
    "C1,C3",
    "C2,A",
    "C2,B",
    "C2,C",
    "C2,A1",
    "C2,A2",
    "C2,A3",
    "C2,B1",
    "C2,B2",
    "C2,B3",
    "C2,C1",
    "C2,C2",
    "C2,C3",
    "C3,A",
    "C3,B",
    "C3,C",
    "C3,A1",
    "C3,A2",
    "C3,A3",
    "C3,B1",
    "C3,B2",
    "C3,B3",
    "C3,C1",
    "C3,C2",
    "C3,C3"
];

pub fn axis_label(i: usize) -> &'static str { SHORTLEX[i] }

#[allow(dead_code)]
pub fn gestalt_block(i: usize) -> usize {
    if i < 3 { 0 } else { (i - 3) / 3 + 1 }
}

#[derive(Clone)]
pub struct WalkOpts {
    pub max_depth: usize,
    pub max_frames: usize,
    pub decay_factor: f64,
    pub weight_floor: f64,
    // budget_ms — the IN-BINARY time bound (the standing operator TODO:
    // "the on-chip part must be TIME-BOUNDED — assert"). None = unbounded
    // (the historical behavior; every existing caller is unchanged).
    // Some(ms) = elapsed wall time is checked BEFORE each fan-out ply;
    // when spent, the walk stops cleanly and emits one terminal frame
    // carrying everything painted so far with `budget_exhausted: true`.
    // Granularity is per-PLY (a ply in flight completes) — the bound is
    // a hard cutoff on starting new work, not a thread kill.
    pub budget_ms: Option<u64>,
}

impl Default for WalkOpts {
    fn default() -> Self {
        Self { max_depth: 5, max_frames: usize::MAX, decay_factor: 0.5, weight_floor: 0.001, budget_ms: None }
    }
}

#[derive(Clone)]
pub struct Frame {
    pub kind: &'static str,
    pub ply: usize,
    pub start: usize,
    pub start_label: String,
    pub visits: BTreeMap<usize, f64>,        // cell_index → accumulated weight
    pub first_depth: BTreeMap<usize, usize>, // cell_index → ply at first activation
    pub active_rows: Vec<usize>,
    pub spawned_rows: Vec<usize>,
    pub new_cells: Vec<usize>,
    pub stacked_cells: Vec<usize>,
    pub reached_rows_count: usize,
    pub caption: String,
    // true ONLY on the terminal frame of a budget-cut walk (WalkOpts::budget_ms).
    // Serialized as "budgetExhausted":true on that frame alone, so the JSON of
    // every non-exhausted frame stays byte-identical to the pre-budget binary.
    pub budget_exhausted: bool,
}

// ── ballistic_walk — emit one frame per ply ──────────────────────────
//
// The core is callback-driven (`ballistic_walk_with`) so frames can leave
// the process AS EACH PLY COMPLETES (--stream NDJSON in main.rs) instead
// of only as one buffered array at exit. `ballistic_walk` keeps the
// original Vec contract for the buffered callers.
pub fn ballistic_walk(grid: &[u8; CELLS], start: usize, opts: &WalkOpts) -> Vec<Frame> {
    let mut frames: Vec<Frame> = Vec::new();
    ballistic_walk_with(grid, start, opts, &mut |f| frames.push(f.clone()));
    frames
}

pub fn ballistic_walk_with(
    grid: &[u8; CELLS],
    start: usize,
    opts: &WalkOpts,
    on_frame: &mut dyn FnMut(&Frame),
) {
    assert!(start < GRID, "start coord out of range");
    let started = std::time::Instant::now();
    let budget_spent = |started: &std::time::Instant| -> bool {
        opts.budget_ms.map_or(false, |ms| started.elapsed().as_millis() as u64 >= ms)
    };
    let mut visits: HashMap<usize, f64> = HashMap::new();
    let mut first_depth: HashMap<usize, usize> = HashMap::new();
    let mut reached_rows: HashSet<usize> = HashSet::new();
    let mut emitted: usize = 0;

    let anchor_cell = start * GRID + start;
    bump_weight(&mut visits, &mut first_depth, anchor_cell, 0, 1.0);
    reached_rows.insert(start);

    // ── ply 0 — anchor lit with weight 1.0 ──
    on_frame(&Frame {
        kind: "ballistic",
        ply: 0,
        start,
        start_label: axis_label(start).to_string(),
        visits: visits.iter().map(|(k, v)| (*k, *v)).collect(),
        first_depth: first_depth.iter().map(|(k, v)| (*k, *v)).collect(),
        active_rows: vec![start],
        spawned_rows: vec![],
        new_cells: vec![anchor_cell],
        stacked_cells: vec![],
        reached_rows_count: 1,
        caption: format!(
            "ply 0 — project anchored at {0}. Weight 1.0 lit at ({0},{0}). \
             Each subprocess we spawn next ply will inherit weight × {1} — \
             the closer to {0}, the more weight a hit holds.",
            axis_label(start), opts.decay_factor
        ),
        budget_exhausted: false,
    });
    emitted += 1;

    // ── plies 1..maxDepth — parallel fan-out with depth-decayed weight ──
    let mut active_weighted: HashMap<usize, f64> = HashMap::new();
    active_weighted.insert(start, 1.0);

    for ply in 1..=opts.max_depth {
        if emitted >= opts.max_frames { break; }

        // ── the IN-BINARY time bound — checked BEFORE starting each ply ──
        // When the wall budget is spent, stop cleanly: emit ONE terminal
        // frame carrying everything painted so far, flagged budget_exhausted,
        // and return. Determinism holds whenever the budget is NOT exhausted
        // (the cut is the only time-dependent branch).
        if budget_spent(&started) {
            let would_walk: Vec<usize> = {
                let mut r: Vec<usize> = active_weighted.keys().cloned().collect();
                r.sort();
                r
            };
            on_frame(&Frame {
                kind: "ballistic",
                ply,
                start,
                start_label: axis_label(start).to_string(),
                visits: visits.iter().map(|(k, v)| (*k, *v)).collect(),
                first_depth: first_depth.iter().map(|(k, v)| (*k, *v)).collect(),
                active_rows: would_walk,
                spawned_rows: vec![],
                new_cells: vec![],
                stacked_cells: vec![],
                reached_rows_count: reached_rows.len(),
                caption: format!(
                    "ply {} — TIME BUDGET EXHAUSTED ({} ms): walk cut before this ply. \
                     Emitting everything painted so far; the frontier above was never walked.",
                    ply, opts.budget_ms.unwrap_or(0)
                ),
                budget_exhausted: true,
            });
            return;
        }

        let mut new_cells: Vec<usize> = Vec::new();
        let mut spawned_weights: HashMap<usize, f64> = HashMap::new();

        // walk each active row; accumulate per-cell weight and per-column spawn
        let mut active_sorted: Vec<(usize, f64)> = active_weighted
            .iter().map(|(k, v)| (*k, *v)).collect();
        active_sorted.sort_by_key(|(r, _)| *r);

        for (r_idx, weight) in &active_sorted {
            for j in 0..GRID {
                if grid[r_idx * GRID + j] == 0 { continue; }
                let grid_cell = r_idx * GRID + j;
                let contribution = weight * opts.decay_factor;
                bump_weight(&mut visits, &mut first_depth, grid_cell, ply, contribution);
                new_cells.push(grid_cell);
                *spawned_weights.entry(j).or_insert(0.0) += contribution;
            }
        }

        // prune below the weight floor — geometric decay extinguishes deep branches
        let mut next_active: BTreeMap<usize, f64> = BTreeMap::new();
        for (j, w) in &spawned_weights {
            if *w >= opts.weight_floor {
                next_active.insert(*j, *w);
                reached_rows.insert(*j);
            }
        }

        // convergence narration — cells whose accumulated weight pushed past
        // the single-branch contribution at this ply
        let single_branch = opts.decay_factor.powi(ply as i32);
        let mut stacked_unique: Vec<usize> = new_cells.iter()
            .filter(|c| *visits.get(*c).unwrap_or(&0.0) > single_branch * 1.01)
            .cloned()
            .collect();
        stacked_unique.sort();
        stacked_unique.dedup();

        let active_rows: Vec<usize> = active_sorted.iter().map(|(r, _)| *r).collect();
        let spawned_rows: Vec<usize> = next_active.keys().cloned().collect();

        let caption = build_caption(ply, &active_rows, &new_cells, &stacked_unique, single_branch, start);

        on_frame(&Frame {
            kind: "ballistic",
            ply,
            start,
            start_label: axis_label(start).to_string(),
            visits: visits.iter().map(|(k, v)| (*k, *v)).collect(),
            first_depth: first_depth.iter().map(|(k, v)| (*k, *v)).collect(),
            active_rows,
            spawned_rows,
            new_cells,
            stacked_cells: stacked_unique,
            reached_rows_count: reached_rows.len(),
            caption,
            budget_exhausted: false,
        });
        emitted += 1;

        if next_active.is_empty() { break; }
        active_weighted = next_active.into_iter().collect();
    }
}

fn bump_weight(
    visits: &mut HashMap<usize, f64>,
    first_depth: &mut HashMap<usize, usize>,
    cell: usize,
    ply: usize,
    w: f64,
) {
    if w <= 0.0 { return; }
    *visits.entry(cell).or_insert(0.0) += w;
    first_depth.entry(cell).or_insert(ply);
}

fn build_caption(
    ply: usize,
    active_rows: &[usize],
    new_cells: &[usize],
    stacked: &[usize],
    single_branch: f64,
    start: usize,
) -> String {
    let n = active_rows.len();
    let rows_pl = if n == 1 { "" } else { "s" };
    let fan_pl = if n == 1 { "s" } else { "" };
    let names: Vec<&str> = active_rows.iter().map(|&r| axis_label(r)).collect();
    let head = format!(
        "ply {} — {} row{} fan{} out ballistically: {}. \
         each hit contributes weight {:.4} (closer to {} → heavier). ",
        ply, n, rows_pl, fan_pl, names.join(", "), single_branch, axis_label(start)
    );
    let tail = if new_cells.is_empty() {
        "no significant cells found — wavefront stops.".to_string()
    } else {
        let touches = format!(
            "{} sig touch{}",
            new_cells.len(),
            if new_cells.len() == 1 { "" } else { "es" }
        );
        let convergence = if stacked.is_empty() { String::new() } else {
            format!(
                " · {} cell{} stacked above the per-hit baseline (incoming finders converged)",
                stacked.len(),
                if stacked.len() == 1 { "" } else { "s" }
            )
        };
        format!("{}{}.", touches, convergence)
    };
    format!("{}{}", head, tail)
}

// ── ballistic_walk_all — every occupied axis walked ──────────────────
pub fn ballistic_walk_all(grid: &[u8; CELLS], opts: &WalkOpts) -> Vec<Frame> {
    let mut out = Vec::new();
    ballistic_walk_all_with(grid, opts, &mut |f| out.push(f.clone()));
    out
}

pub fn ballistic_walk_all_with(grid: &[u8; CELLS], opts: &WalkOpts, on_frame: &mut dyn FnMut(&Frame)) {
    for i in 0..GRID {
        let mut has = false;
        for j in 0..GRID { if grid[i * GRID + j] != 0 { has = true; break; } }
        if !has { continue; }
        ballistic_walk_with(grid, i, opts, on_frame);
    }
}

// ── JSON emit — hand-rolled, no serde dependency ────────────────────
pub fn frame_to_json(f: &Frame) -> String {
    let mut s = String::with_capacity(512);
    s.push('{');
    s.push_str(&format!("\"kind\":\"{}\",", f.kind));
    s.push_str(&format!("\"ply\":{},", f.ply));
    s.push_str(&format!("\"start\":{},", f.start));
    s.push_str(&format!("\"startLabel\":\"{}\",", f.start_label));
    s.push_str("\"visits\":");
    push_map_f64(&mut s, &f.visits);
    s.push(',');
    s.push_str("\"firstDepth\":");
    push_map_usize(&mut s, &f.first_depth);
    s.push(',');
    s.push_str(&format!("\"activeRows\":{},", json_arr(&f.active_rows)));
    s.push_str(&format!("\"spawnedRows\":{},", json_arr(&f.spawned_rows)));
    s.push_str(&format!("\"newCells\":{},", json_arr(&f.new_cells)));
    s.push_str(&format!("\"stackedCells\":{},", json_arr(&f.stacked_cells)));
    s.push_str(&format!("\"reachedRowsCount\":{},", f.reached_rows_count));
    s.push_str(&format!("\"caption\":\"{}\"", escape(&f.caption)));
    // Emitted ONLY on the budget-cut terminal frame, so every other frame's
    // JSON is byte-identical to the pre---budget-ms binary (no caller changes).
    if f.budget_exhausted {
        s.push_str(",\"budgetExhausted\":true");
    }
    s.push('}');
    s
}

pub fn frames_to_json(frames: &[Frame]) -> String {
    let mut s = String::from("[");
    for (i, f) in frames.iter().enumerate() {
        if i > 0 { s.push(','); }
        s.push_str(&frame_to_json(f));
    }
    s.push(']');
    s
}

fn push_map_f64(s: &mut String, m: &BTreeMap<usize, f64>) {
    s.push('{');
    let mut first = true;
    for (k, v) in m {
        if !first { s.push(','); } first = false;
        s.push_str(&format!("\"{}\":{}", k, fmt_f64(*v)));
    }
    s.push('}');
}
fn push_map_usize(s: &mut String, m: &BTreeMap<usize, usize>) {
    s.push('{');
    let mut first = true;
    for (k, v) in m {
        if !first { s.push(','); } first = false;
        s.push_str(&format!("\"{}\":{}", k, v));
    }
    s.push('}');
}
fn json_arr(v: &[usize]) -> String {
    let mut s = String::from("[");
    for (i, x) in v.iter().enumerate() {
        if i > 0 { s.push(','); }
        s.push_str(&x.to_string());
    }
    s.push(']');
    s
}
fn fmt_f64(v: f64) -> String {
    // Match JS JSON.stringify for round numbers (1, 0.5 → "1", "0.5")
    if v.fract() == 0.0 && v.is_finite() && v.abs() < 1e16 {
        format!("{}", v as i64)
    } else {
        // 6-digit precision is plenty for visit weights (decayFactor^5 = 0.03125)
        let s = format!("{:.6}", v);
        // strip trailing zeros (0.500000 → 0.5)
        let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
        if s.is_empty() { "0".to_string() } else { s }
    }
}
fn escape(s: &str) -> String {
    s.chars().map(|c| match c {
        '"'  => "\\\"".to_string(),
        '\\' => "\\\\".to_string(),
        '\n' => "\\n".to_string(),
        '\r' => "\\r".to_string(),
        '\t' => "\\t".to_string(),
        c if (c as u32) < 0x20 => format!("\\u{:04x}", c as u32),
        c => c.to_string(),
    }).collect()
}

// ── fixture grid — the scattered demo grid (matches lattice-movie's PRNG) ─
// Used by the CLI's default run so the Rust output is reproducible without
// taking grid input. Same seed/algorithm as lattice-movie.mjs → identical
// significance pattern; the Rust ballistic walk over THIS grid should
// produce the same per-cell visit weights as the JS walk over the same grid.
pub fn demo_grid() -> [u8; CELLS] {
    let mut g = [0u8; CELLS];
    let mut seed: u32 = 0x9e37_79b9;
    let mut rnd = || -> f64 {
        seed = seed.wrapping_add(0x6d2b_79f5);
        let mut t = seed;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    };
    for i in 0..GRID {
        let mut cols = HashSet::new();
        while cols.len() < 3 { cols.insert((rnd() * 12.0) as usize); }
        for c in cols { g[i * GRID + c] = 1; }
    }
    g
}

// ── tests ────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ply_0_lights_anchor_with_weight_1() {
        let g = demo_grid();
        let frames = ballistic_walk(&g, 0, &WalkOpts::default());
        assert!(!frames.is_empty());
        let f0 = &frames[0];
        assert_eq!(f0.ply, 0);
        assert_eq!(f0.start, 0);
        assert_eq!(f0.new_cells, vec![0]);            // anchor (0,0)
        assert_eq!(*f0.visits.get(&0).unwrap(), 1.0); // weight 1.0
        assert_eq!(*f0.first_depth.get(&0).unwrap(), 0);
    }

    #[test]
    fn no_global_dedup_visits_accumulate() {
        // Build a grid where two branches converge on row C2 and the
        // accumulated weight at one of C2's sig cells exceeds the single-
        // branch contribution at that ply.
        let g = demo_grid();
        let frames = ballistic_walk(&g, 0, &WalkOpts::default());
        // Some cell at ply >= 2 should be in stacked_cells across all frames
        let any_stacked = frames.iter().any(|f| !f.stacked_cells.is_empty());
        assert!(any_stacked, "expected at least one stacked cell across the run");
    }

    #[test]
    fn weight_decays_geometrically() {
        // ply k contributes decayFactor^k per branch; with default 0.5,
        // total visits at depth ≥1 must be < 1.0 (the anchor's weight).
        let g = demo_grid();
        let frames = ballistic_walk(&g, 0, &WalkOpts::default());
        let last = frames.last().unwrap();
        let anchor = last.visits.get(&0).copied().unwrap_or(0.0);
        assert!((anchor - 1.0).abs() < 1e-9, "anchor weight stays 1.0 across the run");
    }

    // ── AR-semantics pins (2026-06-11) — the contracts the JS side guards
    // (anti-rules-ledger.md AR-1/2/3/11, pmu-ideal-case-spec.md B2), now
    // pinned on the Rust core the JS drives through pmu-onchip --ballistic.

    /// Helper: a hand-built grid where edges are explicit, so the
    /// transpose/decay/extinction semantics are checkable cell by cell.
    fn edge_grid(edges: &[(usize, usize)]) -> [u8; CELLS] {
        let mut g = [0u8; CELLS];
        for &(i, j) in edges { g[i * GRID + j] = 1; }
        g
    }

    #[test]
    fn transpose_spawn_column_becomes_next_ply_active_row() {
        // row 0 → col 5; row 5 → col 7. The lit COLUMN j at ply k must be
        // the ACTIVE ROW at ply k+1 — the definer-of-definer transpose.
        let g = edge_grid(&[(0, 5), (5, 7)]);
        let frames = ballistic_walk(&g, 0, &WalkOpts::default());
        let f1 = &frames[1];
        assert_eq!(f1.active_rows, vec![0]);
        assert_eq!(f1.new_cells, vec![0 * GRID + 5]);
        assert_eq!(f1.spawned_rows, vec![5], "lit column 5 must spawn row 5 for the next ply");
        let f2 = &frames[2];
        assert_eq!(f2.active_rows, vec![5], "ply-2 walks the TRANSPOSED row");
        assert!(f2.visits.contains_key(&(5 * GRID + 7)), "the transposed row's hit (5,7) must be lit");
    }

    #[test]
    fn decay_per_ply_is_geometric() {
        // (0,5) hit at ply 1 → decay^1 = 0.5; (5,7) hit at ply 2 → 0.25.
        let g = edge_grid(&[(0, 5), (5, 7)]);
        let frames = ballistic_walk(&g, 0, &WalkOpts::default());
        let last = frames.last().unwrap();
        assert!((last.visits[&(0 * GRID + 5)] - 0.5).abs() < 1e-12);
        assert!((last.visits[&(5 * GRID + 7)] - 0.25).abs() < 1e-12);
        assert_eq!(last.first_depth[&(0 * GRID + 5)], 1);
        assert_eq!(last.first_depth[&(5 * GRID + 7)], 2);
    }

    #[test]
    fn weight_floor_extinguishes_deep_branches() {
        // chain 0→5→7→9. With floor 0.3, the ply-2 spawn (weight 0.25)
        // dies: row 7 never activates, (7,9) never lights.
        let g = edge_grid(&[(0, 5), (5, 7), (7, 9)]);
        let mut opts = WalkOpts::default();
        opts.weight_floor = 0.3;
        let frames = ballistic_walk(&g, 0, &opts);
        let last = frames.last().unwrap();
        assert!(!last.visits.contains_key(&(7 * GRID + 9)),
            "branch below the weight floor must be extinct");
        assert!(last.spawned_rows.is_empty(), "ply-2 spawn weight 0.25 < floor 0.3 — nothing spawns");
        // lower the floor and the same chain walks through
        opts.weight_floor = 0.001;
        let frames2 = ballistic_walk(&g, 0, &opts);
        let last2 = frames2.last().unwrap();
        assert!(last2.visits.contains_key(&(7 * GRID + 9)),
            "with the floor lowered the branch must survive to ply 3");
    }

    #[test]
    fn no_row_dedup_revisited_rows_walk_again_and_weights_accumulate() {
        // 2026-05-22 operator correction: NO global row-level dedup. The
        // cycle 0→1, 1→0 re-activates row 0 at ply 2; its cell (0,1) must
        // accumulate ply-1 (0.5) + ply-3 (0.125) = 0.625 at depth 4. A
        // deduped walk would stop at 0.5.
        let g = edge_grid(&[(0, 1), (1, 0)]);
        let opts = WalkOpts { max_depth: 4, ..WalkOpts::default() };
        let frames = ballistic_walk(&g, 0, &opts);
        let last = frames.last().unwrap();
        let w01 = last.visits[&(0 * GRID + 1)];
        assert!((w01 - 0.625).abs() < 1e-12,
            "cell (0,1) must accumulate 0.5 + 0.125 = 0.625 (no dedup), got {}", w01);
        assert_eq!(last.first_depth[&(0 * GRID + 1)], 1, "first_depth stays the FIRST activation ply");
    }

    #[test]
    fn walk_is_deterministic_same_grid_same_start_identical_visits() {
        let g = demo_grid();
        let a = ballistic_walk(&g, 7, &WalkOpts::default());
        let b = ballistic_walk(&g, 7, &WalkOpts::default());
        assert_eq!(a.len(), b.len());
        for (fa, fb) in a.iter().zip(b.iter()) {
            assert_eq!(fa.visits, fb.visits, "visits map must be bit-identical across runs");
            assert_eq!(fa.first_depth, fb.first_depth);
            assert_eq!(fa.active_rows, fb.active_rows);
            assert_eq!(fa.spawned_rows, fb.spawned_rows);
        }
    }

    // ── the in-binary time bound (2026-06-11) — the standing operator TODO
    // "the on-chip part must be TIME-BOUNDED — assert", now asserted IN cargo.

    #[test]
    fn budget_zero_terminates_immediately_with_flag_set() {
        let g = demo_grid();
        let opts = WalkOpts { budget_ms: Some(0), ..WalkOpts::default() };
        let frames = ballistic_walk(&g, 0, &opts);
        // ply-0 anchor frame + the terminal budget frame; NO fan-out ply ran.
        assert_eq!(frames.len(), 2, "budget 0ms must cut before the first fan-out ply");
        let last = frames.last().unwrap();
        assert!(last.budget_exhausted, "the terminal frame must carry the flag");
        assert!(last.new_cells.is_empty(), "nothing was walked at the cut ply");
        assert_eq!(last.visits.len(), 1, "only the anchor was painted");
        assert_eq!(*last.visits.get(&0).unwrap(), 1.0, "the painted-so-far state is emitted intact");
        assert!(frame_to_json(last).contains("\"budgetExhausted\":true"));
        assert!(!frame_to_json(&frames[0]).contains("budgetExhausted"),
            "non-exhausted frames must stay byte-identical (no budgetExhausted key)");
    }

    #[test]
    fn generous_budget_completes_identical_to_unbounded() {
        // Determinism is preserved when the budget is NOT exhausted: a walk
        // under a generous bound must be bit-identical to the unbounded walk,
        // frame for frame, including the serialized JSON bytes.
        let g = demo_grid();
        let unbounded = ballistic_walk(&g, 7, &WalkOpts::default());
        let opts = WalkOpts { budget_ms: Some(60_000), ..WalkOpts::default() };
        let bounded = ballistic_walk(&g, 7, &opts);
        assert_eq!(unbounded.len(), bounded.len());
        for (a, b) in unbounded.iter().zip(bounded.iter()) {
            assert!(!b.budget_exhausted, "a generous budget must never trip");
            assert_eq!(a.visits, b.visits);
            assert_eq!(a.first_depth, b.first_depth);
            assert_eq!(frame_to_json(a), frame_to_json(b),
                "JSON must be byte-identical when the budget is not exhausted");
        }
    }

    #[test]
    fn json_round_trips_into_well_formed_shape() {
        let g = demo_grid();
        let frames = ballistic_walk(&g, 0, &WalkOpts::default());
        let json = frames_to_json(&frames);
        assert!(json.starts_with('['));
        assert!(json.ends_with(']'));
        assert!(json.contains("\"kind\":\"ballistic\""));
        assert!(json.contains("\"ply\":0"));
        assert!(json.contains("\"startLabel\":\"A,A\"")); // SHORTLEX[0] is the pair "A,A"
    }
}
