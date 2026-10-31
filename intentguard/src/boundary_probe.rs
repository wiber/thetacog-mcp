// src/boundary_probe.rs
//
// THE BOUNDARY-CROSSING PROBE — the "by extension" rung, measured.
//
// The patent claim (provisional 2026-03-02, ll.186-210): semantic categories
// packed into contiguous cache lines make a semantic boundary crossing a
// PHYSICAL cache-line crossing — a hardware cache miss — so the miss channel
// is a physical sensor for semantic topology. Reading the MSR miss counter
// is privileged (counter.rs reports that honestly). This probe measures the
// same physical fact WITHOUT privilege, the pointer_chase way: dependent
// loads whose latency IS the read-out.
//
// Two chases. SAME number of loads, SAME bytes touched, SAME seeded
// permutation of cache lines. The ONLY variable is whether consecutive steps
// stay inside a 64-byte line or cross a line boundary:
//   PACKED   — visit all 8 slots of a line, then jump to the next line
//              (~1 boundary crossing per 8 loads)
//   CROSSING — visit one slot per line (every load crosses a boundary)
// The ns/access ratio is the physical cost of the boundary crossing, read
// off the metal from userspace. Seeded xorshift permutation — same
// machine, same numbers.

use serde::Serialize;
use std::time::Instant;

const ACCESSES: usize = 10_000_000;
const SLOTS_PER_LINE: usize = 8; // 64B line / 8B slot

#[derive(Serialize)]
pub struct BoundaryReport {
    pub kib: usize,
    pub lines: usize,
    pub packed_ns: f64,
    pub crossing_ns: f64,
    pub ratio: f64,
}

fn line_permutation(lines: usize) -> Vec<usize> {
    let mut perm: Vec<usize> = (0..lines).collect();
    let mut s: u64 = 0x9E37_79B9_7F4A_7C15 ^ (lines as u64);
    for i in (1..lines).rev() {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        let j = (s as usize) % (i + 1);
        perm.swap(i, j);
    }
    perm
}

fn chase(seq: &[usize], slots: usize) -> f64 {
    let mut buf = vec![0usize; slots];
    for k in 0..seq.len() {
        buf[seq[k]] = seq[(k + 1) % seq.len()];
    }
    // warm: one full cycle
    let mut idx = seq[0];
    for _ in 0..seq.len() {
        idx = buf[idx];
    }
    std::hint::black_box(idx);

    let t = Instant::now();
    let mut p = seq[0];
    for _ in 0..ACCESSES {
        p = buf[p];
    }
    let elapsed = t.elapsed();
    std::hint::black_box(p);
    elapsed.as_nanos() as f64 / ACCESSES as f64
}

pub fn probe(kib: usize) -> BoundaryReport {
    let slots = ((kib * 1024) / std::mem::size_of::<usize>()).max(SLOTS_PER_LINE * 2);
    let lines = slots / SLOTS_PER_LINE;
    let perm = line_permutation(lines);

    // PACKED: all 8 slots of each line consecutively, lines in permuted order
    let mut packed_seq = Vec::with_capacity(lines * SLOTS_PER_LINE);
    for &l in &perm {
        for s in 0..SLOTS_PER_LINE {
            packed_seq.push(l * SLOTS_PER_LINE + s);
        }
    }

    // CROSSING: one slot per line, same permuted line order — every hop
    // crosses a line boundary; same lines touched, 1/8 the chain length,
    // so the chain is cycled 8x as often over the SAME distinct lines.
    let crossing_seq: Vec<usize> = perm.iter().map(|&l| l * SLOTS_PER_LINE).collect();

    let packed_ns = chase(&packed_seq, slots);
    let crossing_ns = chase(&crossing_seq, slots);

    BoundaryReport {
        kib,
        lines,
        packed_ns,
        crossing_ns,
        ratio: if packed_ns > 0.0 { crossing_ns / packed_ns } else { 0.0 },
    }
}

// --- MEASUREMENT PROTOCOL (added 2026-08-19) --------------------------------
//
// A single `probe()` call is not a receipt — it is one sample from a process
// that shares this machine with the scheduler, thermal throttling, and (on
// this repo's Mac) other agents' concurrent Rust/cargo/node work. Measured
// this session: one quiet run reproduced the axiom's own numbers almost
// exactly (control 1.002x, 8MB 4.310x); three runs taken while other agents
// were active on the same machine gave an in-cache CONTROL ranging from
// 0.723x to 1.320x — noise large enough to make a single busy-machine sample
// either "prove" or "disprove" the claim depending on luck. The fix is not to
// soften the claim (the quiet-machine run reproduces it exactly) — it is to
// take the repetition and report the spread instead of a lone point value.
//
// probe_runs() repeats the SAME probe() N times (nothing about what is
// measured changes — same permutation, same bytes, same loads) and reports
// the median plus the observed min/max, so a reader gets the central
// tendency AND the noise floor in one call, instead of a number that looks
// exact but was one roll of a noisy machine.

#[derive(Serialize, Clone)]
pub struct BoundaryRunStats {
    pub kib: usize,
    pub lines: usize,
    pub runs: usize,
    pub packed_ns_median: f64,
    pub packed_ns_min: f64,
    pub packed_ns_max: f64,
    pub crossing_ns_median: f64,
    pub crossing_ns_min: f64,
    pub crossing_ns_max: f64,
    pub ratio_median: f64,
    pub ratio_min: f64,
    pub ratio_max: f64,
}

fn median(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    }
}

/// Runs `probe(kib)` `runs` times (minimum 1) and reduces to median + spread.
/// The individual `probe()` calls are byte-identical to the single-run path —
/// this function only repeats and reports, it never changes what is measured.
pub fn probe_runs(kib: usize, runs: usize) -> BoundaryRunStats {
    let runs = runs.max(1);
    let reports: Vec<BoundaryReport> = (0..runs).map(|_| probe(kib)).collect();

    let mut packed: Vec<f64> = reports.iter().map(|r| r.packed_ns).collect();
    let mut crossing: Vec<f64> = reports.iter().map(|r| r.crossing_ns).collect();
    let mut ratio: Vec<f64> = reports.iter().map(|r| r.ratio).collect();
    packed.sort_by(|a, b| a.partial_cmp(b).unwrap());
    crossing.sort_by(|a, b| a.partial_cmp(b).unwrap());
    ratio.sort_by(|a, b| a.partial_cmp(b).unwrap());

    BoundaryRunStats {
        kib,
        lines: reports[0].lines,
        runs,
        packed_ns_median: median(&packed),
        packed_ns_min: packed[0],
        packed_ns_max: packed[packed.len() - 1],
        crossing_ns_median: median(&crossing),
        crossing_ns_min: crossing[0],
        crossing_ns_max: crossing[crossing.len() - 1],
        ratio_median: median(&ratio),
        ratio_min: ratio[0],
        ratio_max: ratio[ratio.len() - 1],
    }
}

// --- CONTROL BAND -----------------------------------------------------------
//
// The smallest size (default 16 KiB, well inside L1/L2) is a CONTROL: with
// everything resident, crossing a "line boundary" costs nothing physically —
// the whole array is already close in cache regardless of layout — so the
// control's ratio should sit at 1.0. That is not a tuned expectation, it is
// the physical prediction the rest of the ladder depends on: if the control
// itself drifts, the machine was not quiet enough for the 8MB/128MB numbers
// to be trusted either.
//
// Tolerance is ±0.15 (a [0.85, 1.15] band around 1.0). Chosen because it is
// roughly an order of magnitude tighter than the smallest EFFECT this probe
// exists to detect (the 8MB row measures ~3-5x, 128MB ~6-8x on this machine
// when quiet) — so ±15% comfortably admits ordinary scheduler/thermal jitter
// on a control that has no boundary-crossing effect to detect, while still
// catching genuine contamination. Measured this session: a machine busy with
// concurrent agent work pushed the control as low as 0.723x and as high as
// 1.320x (23-32% off 1.0) — outside this band, correctly, because a control
// that far from 1.0 means the 8MB/128MB numbers taken alongside it are not
// admissible as evidence of the boundary-crossing cost either.
pub const CONTROL_TOLERANCE: f64 = 0.15;

#[derive(Serialize, Clone)]
pub struct ControlVerdict {
    pub control_kib: usize,
    pub ratio_median: f64,
    pub tolerance: f64,
    pub admissible: bool,
    pub reason: String,
}

/// Admissibility does not gate the process exit code (see main.rs comment at
/// the --boundary-probe call site) — it travels as data in the printed
/// output and the --json payload, so a noisy run is reported as noisy rather
/// than silently exiting non-zero and getting piped through `|| true`.
pub fn control_verdict(control: &BoundaryRunStats, tolerance: f64) -> ControlVerdict {
    let lower = 1.0 - tolerance;
    let upper = 1.0 + tolerance;
    let admissible = control.ratio_median >= lower && control.ratio_median <= upper;
    let reason = if admissible {
        format!(
            "control ratio {:.3}x (median of {} runs) is within +/-{:.0}% of the physical expectation \
             (1.0 — no boundary cost when resident)",
            control.ratio_median, control.runs, tolerance * 100.0
        )
    } else {
        format!(
            "control ratio {:.3}x (median of {} runs) is outside +/-{:.0}% of the physical expectation \
             (1.0) — the machine was not quiet enough for this run; treat the 8MB/128MB rows below as \
             LOW CONFIDENCE, not evidence of the boundary-crossing effect",
            control.ratio_median, control.runs, tolerance * 100.0
        )
    };
    ControlVerdict {
        control_kib: control.kib,
        ratio_median: control.ratio_median,
        tolerance,
        admissible,
        reason,
    }
}

// --- THE ONE REPORT (C606a, 2026-10-02) ---------------------------------------
//
// Every door that takes this reading — the pmu-onchip CLI, the intentguard CLI, the napi addon (and through it a
// Vercel function) — serializes THIS struct, built by THIS function. The field names are the same by construction,
// not by three hand-kept json!{} literals. The host facts say which machine the numbers came from (os, arch, logical
// cpu count from std); nothing here reads a privileged counter — rung 4 stays apparatus scope.

/// The sizes the axiom's own reproduction names: an in-cache CONTROL, 8 MiB, 128 MiB.
pub const DEFAULT_KIB: [usize; 3] = [16, 8 * 1024, 128 * 1024];
/// Runs per size when the caller names none.
pub const DEFAULT_RUNS: usize = 5;

#[derive(Serialize, Clone)]
pub struct HostFacts {
    pub os: String,
    pub arch: String,
    pub cpus: usize,
}

pub fn host_facts() -> HostFacts {
    HostFacts {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpus: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
    }
}

#[derive(Serialize, Clone)]
pub struct ProbeReport {
    pub runs: usize,
    pub sizes: Vec<usize>,
    pub results: Vec<BoundaryRunStats>,
    pub control: ControlVerdict,
    pub host: HostFacts,
}

/// probe_runs over every size, then the control verdict. The control is whichever charted size equals control_kib
/// (default: the first size); when none does it is measured separately, so the verdict never silently falls back
/// to an uncontrolled size. Empty sizes → DEFAULT_KIB; runs 0 → 1 (probe_runs' own floor).
pub fn report(sizes: &[usize], runs: usize, control_kib: Option<usize>) -> ProbeReport {
    let sizes: Vec<usize> = if sizes.is_empty() { DEFAULT_KIB.to_vec() } else { sizes.to_vec() };
    let runs = runs.max(1);
    let control_kib = control_kib.unwrap_or(sizes[0]);
    let results: Vec<BoundaryRunStats> = sizes.iter().map(|&kib| probe_runs(kib, runs)).collect();
    let control_stats = results
        .iter()
        .find(|s| s.kib == control_kib)
        .cloned()
        .unwrap_or_else(|| probe_runs(control_kib, runs));
    let control = control_verdict(&control_stats, CONTROL_TOLERANCE);
    ProbeReport { runs, sizes, results, control, host: host_facts() }
}

/// The one JSON line every door prints / returns.
pub fn report_json(r: &ProbeReport) -> String {
    serde_json::to_string(r).expect("serialize boundary probe report")
}

// Fixture unit tests for control_verdict — fixed fixtures, no probing (probe() itself
// is a physical measurement and is not what's under test here). Proves BOTH branches
// of the admissibility decision execute, so the guard has more than a regex to point
// at: `cargo test control_verdict_flags`.
#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(ratio_median: f64) -> BoundaryRunStats {
        BoundaryRunStats {
            kib: 16,
            lines: 256,
            runs: 9,
            packed_ns_median: 2.0,
            packed_ns_min: 1.9,
            packed_ns_max: 2.1,
            crossing_ns_median: 2.0 * ratio_median,
            crossing_ns_min: 1.9 * ratio_median,
            crossing_ns_max: 2.1 * ratio_median,
            ratio_median,
            ratio_min: ratio_median * 0.9,
            ratio_max: ratio_median * 1.1,
        }
    }

    #[test]
    fn control_verdict_flags_admissible_when_control_is_near_one() {
        let v = control_verdict(&fixture(1.05), CONTROL_TOLERANCE);
        assert!(v.admissible, "1.05x is inside the +/-15% band around 1.0");
        assert!(v.reason.contains("within"));
    }

    #[test]
    fn control_verdict_flags_not_admissible_when_control_drifts() {
        let v = control_verdict(&fixture(1.85), CONTROL_TOLERANCE);
        assert!(!v.admissible, "1.85x is well outside the +/-15% band around 1.0");
        assert!(v.reason.contains("LOW CONFIDENCE") || v.reason.contains("outside"));
    }

    #[test]
    fn probe_runs_reduces_to_median_and_spread_over_n_samples() {
        // probe() at a tiny in-cache size is fast and fixed in geometry
        // (same seed every call); this only checks the reduction shape, not a
        // specific physical ratio (that varies with machine load by design).
        let stats = probe_runs(16, 3);
        assert_eq!(stats.runs, 3);
        assert!(stats.ratio_min <= stats.ratio_median);
        assert!(stats.ratio_median <= stats.ratio_max);
        assert!(stats.packed_ns_min <= stats.packed_ns_median && stats.packed_ns_median <= stats.packed_ns_max);
        assert!(stats.crossing_ns_min <= stats.crossing_ns_median && stats.crossing_ns_median <= stats.crossing_ns_max);
    }

    #[test]
    fn report_measures_a_named_control_that_is_not_charted() {
        let r = report(&[64], 1, Some(16));
        assert_eq!(r.sizes, vec![64]);
        assert_eq!(r.control.control_kib, 16);
        assert!(!r.host.os.is_empty() && !r.host.arch.is_empty());
    }
}
