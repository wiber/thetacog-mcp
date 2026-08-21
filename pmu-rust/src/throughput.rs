// .thetacog/pmu/src/throughput.rs
//
// PRO-G — THE BALLISTIC RUNNER (throughput mode).
//
// The frame-emitting --ballistic mode in ballistic.rs is the demo path:
// each anchor produces one JSON frame stream the cloud bridge renders.
// This module is the OTHER path: no frames, no JSON in the hot loop —
// just walks, timed, aggregated. The product question this answers is
// "at this width W, how many walks/sec can one Mac saturate, and is the
// hot data still L1-resident?"
//
// Hot-loop design:
//   • flat Vec<f64> visits buffer of W*W cells, one per walker thread
//   • flat Vec<f64> active/next row-weight buffers of W cells each
//   • inner: for each active row r, for j in 0..W, if grid[r*W+j]!=0,
//     bump visits[r*W+j] + next[j] by w*decay^ply
//   • no HashMap allocations, no JSON, no atomic operations
//   • Rayon scatters arcs across cores; each arc lives entirely in
//     thread-local memory until the final reduce
//
// L1-residency math:
//   W=12  → visits 144*8 = 1.1 KiB, grid 144 B, active/next 96 B each
//          = ~1.5 KiB  → trivially L1
//   W=144 → visits 20,736*8 = 165 KiB  (DOES NOT fit M5 L1D ~128 KiB)
//          → f32 visits 20,736*4 = 81 KiB  (fits) — note variant below
//   The default impl uses f64. For W=144 L1 push, use the f32 variant.

use std::time::Instant;
use rayon::prelude::*;

#[derive(Clone, Debug)]
pub struct ThroughputStats {
    pub width: usize,
    pub depth: usize,
    pub anchors: usize,
    pub arcs_per_anchor: usize,
    pub total_walks: u64,
    pub elapsed_ns: u128,
    pub avg_ns_per_walk: f64,   // aggregate: elapsed_ns / total_walks
    pub walks_per_sec: f64,
    // Single-walk wall-clock stats. mean_walk_ns is the per-walk
    // average MEASURED from the times vector; std_dev_ns is the
    // population stdev across the sample_n per-walk timings. The
    // confidence-interval claim ("verify with X-σ certainty in N ms")
    // pulls from these, not from the aggregate avg_ns_per_walk.
    pub sample_n: usize,
    pub mean_walk_ns: f64,
    pub std_dev_ns: f64,
    pub p50_ns_per_walk: f64,
    pub p99_ns_per_walk: f64,
    pub min_ns_per_walk: u64,
    pub max_ns_per_walk: u64,
    pub cells_lit: usize,
    pub visits_bytes: usize,
    pub fits_l1d_128kib: bool,
    pub threads_used: usize,
    pub precision: &'static str,  // "f64" or "f32"
}

impl ThroughputStats {
    pub fn to_json(&self) -> String {
        format!(
            "{{\"width\":{},\"depth\":{},\"anchors\":{},\"arcs_per_anchor\":{},\
             \"total_walks\":{},\"elapsed_ns\":{},\"avg_ns_per_walk\":{:.3},\
             \"walks_per_sec\":{:.1},\"sample_n\":{},\"mean_walk_ns\":{:.3},\
             \"std_dev_ns\":{:.3},\"p50_ns_per_walk\":{:.3},\"p99_ns_per_walk\":{:.3},\
             \"min_ns_per_walk\":{},\"max_ns_per_walk\":{},\"cells_lit\":{},\
             \"visits_bytes\":{},\"fits_l1d_128kib\":{},\"threads_used\":{},\
             \"precision\":\"{}\"}}",
            self.width, self.depth, self.anchors, self.arcs_per_anchor,
            self.total_walks, self.elapsed_ns, self.avg_ns_per_walk,
            self.walks_per_sec, self.sample_n, self.mean_walk_ns, self.std_dev_ns,
            self.p50_ns_per_walk, self.p99_ns_per_walk,
            self.min_ns_per_walk, self.max_ns_per_walk, self.cells_lit,
            self.visits_bytes, self.fits_l1d_128kib, self.threads_used,
            self.precision,
        )
    }
}

/// Compute (mean, population_stdev) over a slice of u64 ns timings.
/// Population formula: σ² = Σ(x − μ)² / n. For n in the millions this
/// matches the sample stdev to far more decimal places than the noise
/// floor; sample stdev (÷ n−1) would be appropriate for inferential
/// claims on small N (we report n alongside so the consumer can pick).
fn mean_and_stdev(times: &[u64]) -> (f64, f64) {
    if times.is_empty() { return (0.0, 0.0); }
    let n = times.len() as f64;
    let mean: f64 = times.iter().map(|&t| t as f64).sum::<f64>() / n;
    let variance: f64 = times.iter()
        .map(|&t| { let d = t as f64 - mean; d * d })
        .sum::<f64>() / n;
    (mean, variance.sqrt())
}

/// Deterministic grid: every row has `density` cells set, picked by a
/// simple LCG so the same (W, seed) always produces the same lattice.
/// Density 3 matches the demo_grid() in ballistic.rs at W=12.
pub fn make_grid(width: usize, density: usize, seed: u64) -> Vec<u8> {
    let mut g = vec![0u8; width * width];
    let mut s = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let mut rnd = || -> u64 {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    let d = density.min(width).max(1);
    for r in 0..width {
        let mut placed = 0;
        let mut seen = vec![false; width];
        while placed < d {
            let c = (rnd() as usize) % width;
            if !seen[c] { seen[c] = true; g[r * width + c] = 1; placed += 1; }
        }
    }
    g
}

/// One walk: anchor at (start_row, start_row), fan out for `depth`
/// plies with geometric decay 0.5. Visits accumulate into the shared
/// flat buffer; row-weight scratch buffers are reused across plies.
/// Returns the wall-clock nanoseconds the walk took (per-walk timing
/// is the operator-requested sub-ns measurement).
#[inline(always)]
fn walk_one(
    grid: &[u8],
    width: usize,
    start_row: usize,
    depth: usize,
    visits: &mut Vec<f64>,
    active: &mut Vec<f64>,
    next: &mut Vec<f64>,
) -> u64 {
    let t0 = Instant::now();

    // Reset scratch buffers — visits stays accumulated across arcs.
    for v in active.iter_mut() { *v = 0.0; }
    for v in next.iter_mut() { *v = 0.0; }

    let anchor_row = start_row.min(width - 1);
    let anchor_cell = anchor_row * width + anchor_row;
    visits[anchor_cell] += 1.0;
    active[anchor_row] = 1.0;

    let decay = 0.5_f64;

    for _ply in 1..=depth {
        for v in next.iter_mut() { *v = 0.0; }
        let mut any = false;

        for r in 0..width {
            let w = active[r];
            if w == 0.0 { continue; }
            let contrib = w * decay;
            let row_off = r * width;
            for j in 0..width {
                if grid[row_off + j] != 0 {
                    visits[row_off + j] += contrib;
                    next[j] += contrib;
                    any = true;
                }
            }
        }

        if !any { break; }
        std::mem::swap(active, next);
    }

    t0.elapsed().as_nanos() as u64
}

/// Per-thread scratch — held across the fold so we allocate ONCE per
/// worker thread, not once per walk. This is the load-bearing detail
/// that lets the hot loop run at L1 speed: the visit/active/next
/// buffers are reused; only the walk's reads + writes touch memory.
struct ThreadScratch {
    visits: Vec<f64>,
    active: Vec<f64>,
    next:   Vec<f64>,
    times:  Vec<u64>,
}

/// Run `anchors * arcs_per_anchor` walks across all Rayon threads.
/// Each thread accumulates into a thread-local visits buffer; merged
/// once at the end. Per-walk ns timings are collected for p50/p99.
pub fn throughput_run(
    width: usize,
    depth: usize,
    anchors: usize,
    arcs_per_anchor: usize,
    density: usize,
    seed: u64,
) -> (ThroughputStats, Vec<f64>) {
    let grid = make_grid(width, density, seed);
    let total_walks = (anchors as u64) * (arcs_per_anchor as u64);
    let cells = width * width;
    let threads = rayon::current_num_threads();

    let start = Instant::now();

    // Rayon fold accumulates per-thread; reduce merges across threads.
    // The fold identity creates the thread-local scratch on first use;
    // subsequent walks on the same thread reuse it.
    let merged: ThreadScratch = (0..total_walks)
        .into_par_iter()
        .fold(
            || ThreadScratch {
                visits: vec![0.0f64; cells],
                active: vec![0.0f64; width],
                next:   vec![0.0f64; width],
                times:  Vec::with_capacity((arcs_per_anchor as usize)
                                            * anchors / threads.max(1) + 16),
            },
            |mut s, i| {
                let anchor = (i as usize) % anchors.max(1);
                let start_row = anchor % width;
                let ns = walk_one(&grid, width, start_row, depth,
                    &mut s.visits, &mut s.active, &mut s.next);
                s.times.push(ns);
                s
            },
        )
        .reduce(
            || ThreadScratch {
                visits: vec![0.0f64; cells],
                active: vec![0.0f64; width],
                next:   vec![0.0f64; width],
                times:  Vec::new(),
            },
            |mut a, b| {
                for (x, y) in a.visits.iter_mut().zip(b.visits.iter()) { *x += y; }
                a.times.extend(b.times);
                a
            },
        );

    let elapsed = start.elapsed();
    let elapsed_ns = elapsed.as_nanos();

    let cells_lit = merged.visits.iter().filter(|x| **x > 0.0).count();
    let walks_per_sec = (total_walks as f64) / elapsed.as_secs_f64().max(1e-12);
    let avg_ns = (elapsed_ns as f64) / (total_walks as f64);
    let visits_bytes = cells * 8;
    let fits_l1d = visits_bytes + width * 8 * 2 + width * width <= 128 * 1024;

    // mean + stdev from REAL per-walk timings (computed before sort).
    let times = merged.times;
    let (mean_walk_ns, std_dev_ns) = mean_and_stdev(&times);
    let sample_n = times.len();

    // Percentiles + min/max (sort needed for percentiles only).
    let mut times_sorted = times;
    times_sorted.sort_unstable();
    let n = times_sorted.len().max(1);
    let p50 = times_sorted[n / 2] as f64;
    let p99_idx = ((n as f64) * 0.99) as usize;
    let p99 = times_sorted[p99_idx.min(n - 1)] as f64;
    let min_ns = *times_sorted.first().unwrap_or(&0);
    let max_ns = *times_sorted.last().unwrap_or(&0);

    let stats = ThroughputStats {
        width, depth, anchors, arcs_per_anchor,
        total_walks,
        elapsed_ns,
        avg_ns_per_walk: avg_ns,
        walks_per_sec,
        sample_n,
        mean_walk_ns,
        std_dev_ns,
        p50_ns_per_walk: p50,
        p99_ns_per_walk: p99,
        min_ns_per_walk: min_ns,
        max_ns_per_walk: max_ns,
        cells_lit,
        visits_bytes,
        fits_l1d_128kib: fits_l1d,
        threads_used: threads,
        precision: "f64",
    };

    (stats, merged.visits)
}

// ── f32 L1-resident variant ───────────────────────────────────────────
//
// At W=144 the f64 visits buffer is 165 KiB — exceeds the M5's ~128 KiB
// L1D cap. The f32 buffer is half: 81 KiB at W=144, fits L1D. Walk math
// still uses geometric decay 0.5^ply; f32's 23-bit mantissa is far
// more than the ~depth bits the walk actually consumes (depth 5 = 5
// bits of precision used). f32's smaller width is a hot-path lift on
// SIMD-eligible cores and shrinks the whole buffer below L1D.

struct ThreadScratchF32 {
    visits: Vec<f32>,
    active: Vec<f32>,
    next:   Vec<f32>,
    times:  Vec<u64>,
}

#[inline(always)]
fn walk_one_f32(
    grid: &[u8],
    width: usize,
    start_row: usize,
    depth: usize,
    visits: &mut Vec<f32>,
    active: &mut Vec<f32>,
    next: &mut Vec<f32>,
) -> u64 {
    let t0 = Instant::now();
    for v in active.iter_mut() { *v = 0.0; }
    for v in next.iter_mut() { *v = 0.0; }

    let anchor_row = start_row.min(width - 1);
    let anchor_cell = anchor_row * width + anchor_row;
    visits[anchor_cell] += 1.0;
    active[anchor_row] = 1.0;

    let decay = 0.5_f32;

    for _ply in 1..=depth {
        for v in next.iter_mut() { *v = 0.0; }
        let mut any = false;

        for r in 0..width {
            let w = active[r];
            if w == 0.0 { continue; }
            let contrib = w * decay;
            let row_off = r * width;
            for j in 0..width {
                if grid[row_off + j] != 0 {
                    visits[row_off + j] += contrib;
                    next[j] += contrib;
                    any = true;
                }
            }
        }

        if !any { break; }
        std::mem::swap(active, next);
    }

    t0.elapsed().as_nanos() as u64
}

pub fn throughput_run_f32(
    width: usize,
    depth: usize,
    anchors: usize,
    arcs_per_anchor: usize,
    density: usize,
    seed: u64,
) -> (ThroughputStats, Vec<f32>) {
    let grid = make_grid(width, density, seed);
    let total_walks = (anchors as u64) * (arcs_per_anchor as u64);
    let cells = width * width;
    let threads = rayon::current_num_threads();

    let start = Instant::now();

    let merged: ThreadScratchF32 = (0..total_walks)
        .into_par_iter()
        .fold(
            || ThreadScratchF32 {
                visits: vec![0.0f32; cells],
                active: vec![0.0f32; width],
                next:   vec![0.0f32; width],
                times:  Vec::with_capacity((arcs_per_anchor as usize)
                                            * anchors / threads.max(1) + 16),
            },
            |mut s, i| {
                let anchor = (i as usize) % anchors.max(1);
                let start_row = anchor % width;
                let ns = walk_one_f32(&grid, width, start_row, depth,
                    &mut s.visits, &mut s.active, &mut s.next);
                s.times.push(ns);
                s
            },
        )
        .reduce(
            || ThreadScratchF32 {
                visits: vec![0.0f32; cells],
                active: vec![0.0f32; width],
                next:   vec![0.0f32; width],
                times:  Vec::new(),
            },
            |mut a, b| {
                for (x, y) in a.visits.iter_mut().zip(b.visits.iter()) { *x += y; }
                a.times.extend(b.times);
                a
            },
        );

    let elapsed = start.elapsed();
    let elapsed_ns = elapsed.as_nanos();

    let cells_lit = merged.visits.iter().filter(|x| **x > 0.0).count();
    let walks_per_sec = (total_walks as f64) / elapsed.as_secs_f64().max(1e-12);
    let avg_ns = (elapsed_ns as f64) / (total_walks as f64);
    let visits_bytes = cells * 4; // f32
    let fits_l1d = visits_bytes + width * 4 * 2 + width * width <= 128 * 1024;

    let times = merged.times;
    let (mean_walk_ns, std_dev_ns) = mean_and_stdev(&times);
    let sample_n = times.len();

    let mut times_sorted = times;
    times_sorted.sort_unstable();
    let n = times_sorted.len().max(1);
    let p50 = times_sorted[n / 2] as f64;
    let p99_idx = ((n as f64) * 0.99) as usize;
    let p99 = times_sorted[p99_idx.min(n - 1)] as f64;
    let min_ns = *times_sorted.first().unwrap_or(&0);
    let max_ns = *times_sorted.last().unwrap_or(&0);

    let stats = ThroughputStats {
        width, depth, anchors, arcs_per_anchor,
        total_walks,
        elapsed_ns,
        avg_ns_per_walk: avg_ns,
        walks_per_sec,
        sample_n,
        mean_walk_ns,
        std_dev_ns,
        p50_ns_per_walk: p50,
        p99_ns_per_walk: p99,
        min_ns_per_walk: min_ns,
        max_ns_per_walk: max_ns,
        cells_lit,
        visits_bytes,
        fits_l1d_128kib: fits_l1d,
        threads_used: threads,
        precision: "f32",
    };

    (stats, merged.visits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_grid_is_deterministic() {
        let a = make_grid(12, 3, 42);
        let b = make_grid(12, 3, 42);
        assert_eq!(a, b);
    }

    #[test]
    fn walk_one_anchor_gets_weight_one() {
        let grid = make_grid(12, 3, 42);
        let mut visits = vec![0.0f64; 144];
        let mut active = vec![0.0f64; 12];
        let mut next = vec![0.0f64; 12];
        let _ = walk_one(&grid, 12, 0, 1, &mut visits, &mut active, &mut next);
        // The anchor is SEEDED with 1.0; the ply-1 fan-out can re-accumulate on
        // (0,0) when grid[0][0] is lit, so the invariant is "holds at least the
        // seed", not "exactly 1.0".
        assert!(visits[0] >= 1.0 - 1e-9, "anchor cell holds at least its seed weight 1.0");
    }

    #[test]
    fn throughput_run_completes_at_w12() {
        let (stats, merged) = throughput_run(12, 3, 12, 10, 3, 42);
        assert_eq!(stats.total_walks, 120);
        assert!(stats.cells_lit > 0);
        assert!(stats.walks_per_sec > 0.0);
        assert!(merged.iter().sum::<f64>() > 0.0);
        assert!(stats.fits_l1d_128kib, "W=12 must fit L1");
    }

    #[test]
    fn throughput_run_completes_at_w144() {
        let (stats, _merged) = throughput_run(144, 2, 12, 4, 3, 42);
        assert_eq!(stats.total_walks, 48);
        assert!(stats.walks_per_sec > 0.0);
    }
}
