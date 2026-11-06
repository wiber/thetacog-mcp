// src/odometer_probe.rs — THE TIER 2 CALIBRATION OF THE ODOMETER: APPARATUS SCOPE, NEVER THE SHIPPED DEFAULT (C830).
//
// Operator (2026-10-14): "confirm that L1 misses spike cleanly by 1 cache line per boundary crossing, proving that
// logical lane drift corresponds to physical silicon displacement."
//
// WHAT THIS IS. odometer.rs ships Tier 1: the 144 anchors as 64-byte-aligned `LatticeCell`s, a followed step cur → j a
// line crossing iff cur != j, k_E charged on the integer count c. That receipt reads no counter (AXIOM 0 rung 1, address
// arithmetic). This file is Tier 2, AXIOM 0 rung 4: the SAME aligned cells walked under perf_event_open(2) counting L1D
// read misses and retired instructions, so a PMC can be seen to fill one line per step the odometer counted. It is
// privileged (CAP_PERFMON or kernel.perf_event_paranoid <= 2 with exclude_kernel, and a PMU the hypervisor passes
// through), platform-gated (Linux), and reported as APPARATUS SCOPE on every receipt line it prints. Nothing in the
// shipped receipt calls into this module; `pmu-onchip --odometer-probe` is the only door.
//
// THE TWO WALKS. Same loop, same step count, same rule, one variable — the edge list:
//   IN-LANE      every step is (0 → 0): the walk stays on one line; the odometer reads line_crossings = 0, c = 0.
//   OUT-OF-LANE  every step moves to the next anchor of a seeded permutation, and the lane mask marks the even anchors,
//                so each step is one line crossing AND one fence crossing: c = line_crossings = steps.
// THE RULE: a line the walk LEAVES is released (clflush on x86_64, dc civac on aarch64) — the grip holds one line. In-lane
// leaves no line, so it releases nothing and its read stays resident: the CONTROL, expected ~0 misses per step. Out-of-
// lane releases every line it leaves, so the next visit fills it: expected ~1 miss per crossing. The release is the same
// instruction on both walks; only the odometer's count differs, and the counter is asked whether it saw the same count.
//
// WHAT IS PRINTED. Medians with [min, max] over --runs N, never a lone point value (CLAUDE.md rung 3). The control band is
// in-lane misses per step <= CONTROL_MISSES_PER_STEP_MAX; when it fails the receipt prints NOT ADMISSIBLE (the machine was
// not quiet: interrupts, a migration, a neighbour's working set). When perf_event_open refuses, the receipt prints
// UNMEASURED with the errno and the sysctl line, and never a number. This box (a VM, paranoid 2) takes that path.
//
// k_E IS NEVER A RATE. `misses_per_crossing` and `misses_per_kinst` (misses per thousand retired instructions) are
// READOUTS; `kE_milli_per_crossing: 3` is the GAUGE, restated from odometer.rs / CLAUDE.md and never derived from a
// counter. The receipt line stays `c=N · kE=0.NNN` (the-ratchet-invariants rule 20); this probe only says whether the
// chip filled one line per N.
//
// SUFFICIENT FOR: whether, on this host, under this counter, one L1D fill accompanies each line crossing the odometer
// counted. NOT SUFFICIENT FOR: the odometer's own count (Tier 1 holds without this), whether the work was good (Rice).
// Guard: tests/vna/c830-build-the-hardware-boundary-validation-as.test.mjs (+ tests/pmu-simulator/odometer-probe.test.mjs).

use crate::ballistic::GRID;
use crate::boundary_probe::{host_facts, HostFacts};
use crate::odometer::{lattice_cells, read, LatticeCell, K_E_MILLI};
use serde::Serialize;

/// Steps per walk per run when the caller names none: 100 cycles of the 144 anchors.
pub const DEFAULT_STEPS: usize = 144 * 100;
/// Runs when the caller names none.
pub const DEFAULT_RUNS: usize = 5;
/// The control band: an in-lane step leaves no line and should fill none. 0.05 admits an interrupt now and then and
/// rejects a machine whose L1 is being shared out from under the walk.
pub const CONTROL_MISSES_PER_STEP_MAX: f64 = 0.05;

// ── perf_event_open(2) over the raw syscall — std links libc on Linux, so no new crate ───────────────────────────────
#[cfg(target_os = "linux")]
mod perf {
    #[cfg(target_arch = "x86_64")]
    pub const SYS_PERF_EVENT_OPEN: i64 = 298;
    #[cfg(target_arch = "aarch64")]
    pub const SYS_PERF_EVENT_OPEN: i64 = 241;
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    pub const SYS_PERF_EVENT_OPEN: i64 = -1;

    pub const PERF_TYPE_HARDWARE: u32 = 0;
    pub const PERF_TYPE_HW_CACHE: u32 = 3;
    pub const PERF_COUNT_HW_INSTRUCTIONS: u64 = 1;
    /// PERF_COUNT_HW_CACHE_L1D | (OP_READ << 8) | (RESULT_MISS << 16)
    pub const PERF_COUNT_HW_CACHE_L1D_READ_MISS: u64 = 0 | (0 << 8) | (1 << 16);
    /// attr.flags bits: disabled (0), exclude_kernel (5), exclude_hv (6) — user-space counts only, what paranoid 2 allows.
    pub const FLAGS_DISABLED_USER_ONLY: u64 = (1 << 0) | (1 << 5) | (1 << 6);
    pub const PERF_EVENT_IOC_ENABLE: u64 = 0x2400;
    pub const PERF_EVENT_IOC_DISABLE: u64 = 0x2401;
    pub const PERF_EVENT_IOC_RESET: u64 = 0x2403;
    pub const ATTR_SIZE: u32 = 128; // PERF_ATTR_SIZE_VER7; an older kernel accepts a larger zeroed tail

    /// struct perf_event_attr as the kernel lays it out (include/uapi/linux/perf_event.h), 128 bytes.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Attr {
        pub type_: u32,
        pub size: u32,
        pub config: u64,
        pub sample_period: u64,
        pub sample_type: u64,
        pub read_format: u64,
        pub flags: u64,
        pub wakeup_events: u32,
        pub bp_type: u32,
        pub config1: u64,
        pub config2: u64,
        pub branch_sample_type: u64,
        pub sample_regs_user: u64,
        pub sample_stack_user: u32,
        pub clockid: i32,
        pub sample_regs_intr: u64,
        pub aux_watermark: u32,
        pub sample_max_stack: u16,
        pub reserved_2: u16,
        pub aux_sample_size: u32,
        pub reserved_3: u32,
        pub sig_data: u64,
    }
    const _: () = assert!(std::mem::size_of::<Attr>() == ATTR_SIZE as usize, "perf_event_attr must be 128 bytes");

    extern "C" {
        fn syscall(num: i64, ...) -> i64;
        fn ioctl(fd: i32, req: u64, ...) -> i32;
        fn read(fd: i32, buf: *mut u8, n: usize) -> isize;
        fn close(fd: i32) -> i32;
    }

    pub struct Counter(pub i32);
    impl Drop for Counter {
        fn drop(&mut self) { unsafe { close(self.0); } }
    }

    /// Opens one counter on the calling thread, any CPU, disabled. Err = raw errno.
    pub fn open(type_: u32, config: u64) -> Result<Counter, i32> {
        if SYS_PERF_EVENT_OPEN < 0 { return Err(38); } // ENOSYS: no syscall number for this arch
        let attr = Attr {
            type_, size: ATTR_SIZE, config, sample_period: 0, sample_type: 0, read_format: 0,
            flags: FLAGS_DISABLED_USER_ONLY, wakeup_events: 0, bp_type: 0, config1: 0, config2: 0,
            branch_sample_type: 0, sample_regs_user: 0, sample_stack_user: 0, clockid: 0, sample_regs_intr: 0,
            aux_watermark: 0, sample_max_stack: 0, reserved_2: 0, aux_sample_size: 0, reserved_3: 0, sig_data: 0,
        };
        // perf_event_open(attr, pid = 0 (this thread), cpu = -1 (any), group_fd = -1, flags = 0)
        let fd = unsafe { syscall(SYS_PERF_EVENT_OPEN, &attr as *const Attr, 0i32, -1i32, -1i32, 0u64) };
        if fd < 0 { Err(std::io::Error::last_os_error().raw_os_error().unwrap_or(-1)) } else { Ok(Counter(fd as i32)) }
    }
    pub fn reset(c: &Counter) { unsafe { ioctl(c.0, PERF_EVENT_IOC_RESET, 0i32); } }
    pub fn enable(c: &Counter) { unsafe { ioctl(c.0, PERF_EVENT_IOC_ENABLE, 0i32); } }
    pub fn disable(c: &Counter) { unsafe { ioctl(c.0, PERF_EVENT_IOC_DISABLE, 0i32); } }
    pub fn value(c: &Counter) -> u64 {
        let mut buf = [0u8; 8];
        let n = unsafe { read(c.0, buf.as_mut_ptr(), 8) };
        if n == 8 { u64::from_le_bytes(buf) } else { 0 }
    }
}

/// The errno's name, so the receipt reads EACCES and not 13.
pub fn errno_name(e: i32) -> &'static str {
    match e {
        1 => "EPERM", 2 => "ENOENT", 13 => "EACCES", 19 => "ENODEV", 22 => "EINVAL", 24 => "EMFILE",
        38 => "ENOSYS", 95 => "EOPNOTSUPP", _ => "E?",
    }
}

/// `kernel.perf_event_paranoid = N`, read off /proc so the receipt names the gate the kernel applied.
pub fn paranoid_sysctl_line() -> String {
    match std::fs::read_to_string("/proc/sys/kernel/perf_event_paranoid") {
        Ok(s) => format!("kernel.perf_event_paranoid = {}", s.trim()),
        Err(_) => "kernel.perf_event_paranoid = (unreadable: not linux, or /proc absent)".to_string(),
    }
}

// ── the line release — the one instruction both walks share ──────────────────────────────────────────────────────────
#[inline]
fn release_line(cell: &LatticeCell) {
    let p = cell as *const LatticeCell as *const u8;
    #[cfg(target_arch = "x86_64")]
    unsafe { core::arch::x86_64::_mm_clflush(p); }
    #[cfg(target_arch = "aarch64")]
    unsafe { core::arch::asm!("dc civac, {0}", in(reg) p, options(nostack, preserves_flags)); }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    { std::hint::black_box(p); }
}

/// Whether this arch has a user-space line release; without one no walk can evict and nothing is measured.
pub const fn arch_can_release_lines() -> bool {
    cfg!(any(target_arch = "x86_64", target_arch = "aarch64"))
}

/// The seeded permutation of the 144 anchors the out-of-lane walk follows (xorshift, same seed every call, like
/// boundary_probe::line_permutation) — visits alternate parity so every step also crosses the even-anchor fence.
pub fn out_of_lane_order() -> [usize; GRID] {
    let mut evens: Vec<usize> = (0..GRID).filter(|i| i % 2 == 0).collect();
    let mut odds: Vec<usize> = (0..GRID).filter(|i| i % 2 == 1).collect();
    let mut s: u64 = 0x9E37_79B9_7F4A_7C15 ^ (GRID as u64);
    for v in [&mut evens, &mut odds] {
        for i in (1..v.len()).rev() {
            s ^= s << 13; s ^= s >> 7; s ^= s << 17;
            let j = (s as usize) % (i + 1);
            v.swap(i, j);
        }
    }
    let mut order = [0usize; GRID];
    for k in 0..GRID / 2 { order[2 * k] = evens[k]; order[2 * k + 1] = odds[k]; }
    order
}

/// The edge lists the two walks follow, `steps` edges each. These are what odometer::read counts and what the loop walks.
pub fn edges(steps: usize) -> (Vec<(usize, usize)>, Vec<(usize, usize)>) {
    let order = out_of_lane_order();
    let in_lane: Vec<(usize, usize)> = (0..steps).map(|_| (0usize, 0usize)).collect();
    let out_of_lane: Vec<(usize, usize)> = (0..steps).map(|k| (order[k % GRID], order[(k + 1) % GRID])).collect();
    (in_lane, out_of_lane)
}

/// The lane mask: even anchors inside the fence, so the permutation's parity alternation crosses it every step.
pub fn lane_mask() -> [bool; GRID] { let mut m = [false; GRID]; for i in 0..GRID { m[i] = i % 2 == 0; } m }

fn blocks() -> [(u8, u8); GRID] { let mut b = [(0u8, 0u8); GRID]; for i in 0..GRID { b[i] = ((i / 12) as u8, (i % 12) as u8); } b }

/// The walk the counters watch: a dependent load of the lane bit at each destination, the line left released.
/// Returns the sum of lane bits read (so the loads cannot be elided) — the loop is identical for both walks.
#[inline(never)]
pub fn walk(cells: &[LatticeCell; GRID], edges: &[(usize, usize)]) -> u64 {
    let mut acc = 0u64;
    for &(a, b) in edges {
        let (ca, cb) = (&cells[a], &cells[b]);
        acc += std::hint::black_box(cb.in_lane) as u64;
        if a != b { release_line(ca); }
    }
    acc
}

// ── the reading ─────────────────────────────────────────────────────────────────────────────────────────────────────
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Spread { pub median: f64, pub min: f64, pub max: f64 }

fn spread(mut v: Vec<f64>) -> Spread {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    let median = if n == 0 { 0.0 } else if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 };
    Spread { median, min: v.first().copied().unwrap_or(0.0), max: v.last().copied().unwrap_or(0.0) }
}

/// One run of one walk: the raw counts beside the odometer's own count of the same edges.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct WalkSample {
    pub steps: u32,
    pub line_crossings: u32,
    pub c: u32,
    pub l1d_read_misses: u64,
    pub instructions: u64,
}

/// A walk over N runs, reduced: misses per logical crossing (per step for the in-lane walk, whose crossings are 0),
/// and misses per thousand retired instructions — both READOUTS.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct WalkStats {
    pub walk: &'static str,
    pub runs: usize,
    pub steps: u32,
    pub line_crossings: u32,
    pub c: u32,
    pub misses_per_crossing: Spread,
    pub misses_per_step: Spread,
    pub misses_per_kinst: Spread,
    pub samples: Vec<WalkSample>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct CounterStatus {
    pub available: bool,
    pub errno: Option<i32>,
    pub errno_name: Option<&'static str>,
    pub sysctl: String,
    pub events: [&'static str; 2],
    pub why: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ControlVerdict {
    pub admissible: bool,
    pub control_walk: &'static str,
    pub misses_per_step_median: f64,
    pub band: [f64; 2],
    pub reason: String,
}

/// The gauge, restated — never read off a counter, never a rate.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[allow(non_snake_case)]
pub struct Gauge {
    pub kE_milli_per_crossing: u32,
    pub k_e: &'static str,
    pub unit: &'static str,
}

#[derive(Serialize, Clone)]
pub struct ProbeReport {
    pub door: &'static str,
    pub scope: &'static str,
    pub shipped_default: bool,
    pub status: &'static str,
    pub runs: usize,
    pub steps: usize,
    pub release: &'static str,
    pub counter: CounterStatus,
    pub in_lane: Option<WalkStats>,
    pub out_of_lane: Option<WalkStats>,
    pub control: Option<ControlVerdict>,
    pub readouts: [&'static str; 2],
    pub gauge: Gauge,
    pub host: HostFacts,
}

pub const EVENTS: [&str; 2] = ["PERF_COUNT_HW_CACHE_L1D:READ:MISS", "PERF_COUNT_HW_INSTRUCTIONS"];
pub const READOUTS: [&str; 2] = ["misses_per_crossing", "misses_per_kinst"];

pub fn gauge() -> Gauge {
    Gauge {
        kE_milli_per_crossing: K_E_MILLI,
        k_e: "0.003",
        unit: "k_E is charged by odometer.rs on the integer crossing count c (3·c milli-units); this probe's misses are readouts beside it, never its value",
    }
}

#[cfg(target_arch = "x86_64")]
const RELEASE: &str = "clflush of the line left, x86_64";
#[cfg(target_arch = "aarch64")]
const RELEASE: &str = "dc civac of the line left, aarch64";
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
const RELEASE: &str = "none on this arch";

/// The control verdict over the in-lane walk: it leaves no line, so it should fill none.
pub fn control_verdict(in_lane: &WalkStats, max_misses_per_step: f64) -> ControlVerdict {
    let m = in_lane.misses_per_step.median;
    let admissible = m.is_finite() && m >= 0.0 && m <= max_misses_per_step;
    let reason = if admissible {
        format!("in-lane control fills {:.4} lines per step (median of {} runs), within [0, {}] — the walk held its line, the out-of-lane row is admissible",
            m, in_lane.runs, max_misses_per_step)
    } else {
        format!("in-lane control fills {:.4} lines per step (median of {} runs), outside [0, {}] — a walk that never left its line was evicted from it, so the machine was not quiet enough; the out-of-lane row is NOT evidence of one fill per crossing",
            m, in_lane.runs, max_misses_per_step)
    };
    ControlVerdict { admissible, control_walk: "in_lane", misses_per_step_median: m, band: [0.0, max_misses_per_step], reason }
}

fn reduce(walk: &'static str, samples: Vec<WalkSample>) -> WalkStats {
    let first = samples.first().cloned().unwrap_or(WalkSample { steps: 0, line_crossings: 0, c: 0, l1d_read_misses: 0, instructions: 0 });
    let per = |s: &WalkSample, den: u32| if den == 0 { 0.0 } else { s.l1d_read_misses as f64 / den as f64 };
    WalkStats {
        walk,
        runs: samples.len(),
        steps: first.steps,
        line_crossings: first.line_crossings,
        c: first.c,
        misses_per_crossing: spread(samples.iter().map(|s| per(s, s.line_crossings)).collect()),
        misses_per_step: spread(samples.iter().map(|s| per(s, s.steps)).collect()),
        misses_per_kinst: spread(samples.iter().map(|s| if s.instructions == 0 { 0.0 } else { s.l1d_read_misses as f64 * 1000.0 / s.instructions as f64 }).collect()),
        samples,
    }
}

fn unmeasured(runs: usize, steps: usize, errno: Option<i32>, why: String) -> ProbeReport {
    ProbeReport {
        door: "odometer-probe", scope: "apparatus (AXIOM 0 rung 4)", shipped_default: false, status: "UNMEASURED",
        runs, steps, release: RELEASE,
        counter: CounterStatus { available: false, errno, errno_name: errno.map(errno_name), sysctl: paranoid_sysctl_line(), events: EVENTS, why },
        in_lane: None, out_of_lane: None, control: None, readouts: READOUTS, gauge: gauge(), host: host_facts(),
    }
}

/// The door. `runs` 0 → 1, `steps` 0 → DEFAULT_STEPS. Never panics on a refused counter: that is the UNMEASURED receipt.
pub fn report(runs: usize, steps: usize) -> ProbeReport {
    let runs = runs.max(1);
    let steps = if steps == 0 { DEFAULT_STEPS } else { steps };
    if !arch_can_release_lines() {
        return unmeasured(runs, steps, None, format!("no user-space line release on {}: the walk cannot evict, so no fill can be attributed to a crossing", std::env::consts::ARCH));
    }
    #[cfg(not(target_os = "linux"))]
    {
        return unmeasured(runs, steps, None, format!("perf_event_open(2) is Linux only; on {} the counters sit behind a private framework (counter.rs)", std::env::consts::OS));
    }
    #[cfg(target_os = "linux")]
    {
        let misses = match perf::open(perf::PERF_TYPE_HW_CACHE, perf::PERF_COUNT_HW_CACHE_L1D_READ_MISS) {
            Ok(c) => c,
            Err(e) => return unmeasured(runs, steps, Some(e), format!("perf_event_open(L1D read misses) refused: {} (errno {}) — {}; a VM without a passed-through PMU reads ENOENT/EOPNOTSUPP, paranoid > 2 reads EACCES", errno_name(e), e, paranoid_sysctl_line())),
        };
        let instr = match perf::open(perf::PERF_TYPE_HARDWARE, perf::PERF_COUNT_HW_INSTRUCTIONS) {
            Ok(c) => c,
            Err(e) => return unmeasured(runs, steps, Some(e), format!("perf_event_open(instructions) refused: {} (errno {}) — {}", errno_name(e), e, paranoid_sysctl_line())),
        };
        let cells = lattice_cells(&lane_mask(), &blocks());
        let (e_in, e_out) = edges(steps);
        let o_in = read(&cells, &e_in);
        let o_out = read(&cells, &e_out);
        let mut s_in = Vec::with_capacity(runs);
        let mut s_out = Vec::with_capacity(runs);
        let sample = |edge_list: &[(usize, usize)], o: &crate::odometer::Odometer| -> WalkSample {
            std::hint::black_box(walk(&cells, edge_list)); // warm: the loop and the lines, once
            perf::reset(&misses); perf::reset(&instr);
            perf::enable(&misses); perf::enable(&instr);
            let acc = walk(&cells, edge_list);
            perf::disable(&misses); perf::disable(&instr);
            std::hint::black_box(acc);
            WalkSample { steps: o.steps, line_crossings: o.line_crossings, c: o.c, l1d_read_misses: perf::value(&misses), instructions: perf::value(&instr) }
        };
        for _ in 0..runs {
            s_in.push(sample(&e_in, &o_in));
            s_out.push(sample(&e_out, &o_out));
        }
        let in_lane = reduce("in_lane", s_in);
        let out_of_lane = reduce("out_of_lane", s_out);
        let control = control_verdict(&in_lane, CONTROL_MISSES_PER_STEP_MAX);
        let status = if control.admissible { "MEASURED" } else { "NOT ADMISSIBLE" };
        ProbeReport {
            door: "odometer-probe", scope: "apparatus (AXIOM 0 rung 4)", shipped_default: false, status,
            runs, steps, release: RELEASE,
            counter: CounterStatus { available: true, errno: None, errno_name: None, sysctl: paranoid_sysctl_line(), events: EVENTS, why: "both counters opened on this thread, user-space only".to_string() },
            in_lane: Some(in_lane), out_of_lane: Some(out_of_lane), control: Some(control), readouts: READOUTS, gauge: gauge(), host: host_facts(),
        }
    }
}

/// The one JSON line the door prints.
pub fn report_json(r: &ProbeReport) -> String { serde_json::to_string(r).expect("serialize odometer probe report") }

/// The human lines above the JSON: the receipt a reader skims. Every branch names the scope.
pub fn report_text(r: &ProbeReport) -> String {
    let mut out = String::new();
    out.push_str("odometer probe — APPARATUS SCOPE (AXIOM 0 rung 4), never the shipped default; odometer::read counts addresses and reads no counter\n");
    out.push_str(&format!("the two walks over the 64-byte-aligned LatticeCell array: in-lane (one line, no crossing) vs out-of-lane (one line crossing and one fence crossing per step); release = {}\n", r.release));
    out.push_str(&format!("{} run(s) × {} steps — medians with the observed [min, max] beside them\n", r.runs, r.steps));
    match (&r.in_lane, &r.out_of_lane, &r.control) {
        (Some(i), Some(o), Some(v)) => {
            let line = |w: &WalkStats| format!(
                "  {:<12} crossings={:<6} c={:<6} misses/crossing={:.3} [{:.3}, {:.3}]  misses/step={:.4} [{:.4}, {:.4}]  misses/kinst={:.3} [{:.3}, {:.3}]\n",
                w.walk, w.line_crossings, w.c, w.misses_per_crossing.median, w.misses_per_crossing.min, w.misses_per_crossing.max,
                w.misses_per_step.median, w.misses_per_step.min, w.misses_per_step.max,
                w.misses_per_kinst.median, w.misses_per_kinst.min, w.misses_per_kinst.max);
            out.push_str(&line(i));
            out.push_str(&line(o));
            if v.admissible { out.push_str(&format!("ADMISSIBLE — {}\n", v.reason)); } else { out.push_str(&format!("NOT ADMISSIBLE — {}\n", v.reason)); }
        }
        _ => {
            out.push_str(&format!("UNMEASURED — {}", r.counter.why));
            if let (Some(e), Some(n)) = (r.counter.errno, r.counter.errno_name) { out.push_str(&format!(" [{} errno {}]", n, e)); }
            out.push_str(&format!("\n  {}\n", r.counter.sysctl));
        }
    }
    out.push_str(&format!("gauge: kE_milli_per_crossing={} (k_E = {} per crossing; a count, never a rate — the readouts above are misses, not k_E)\n", r.gauge.kE_milli_per_crossing, r.gauge.k_e));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(walk: &'static str, misses_per_step: &[f64]) -> WalkStats {
        let samples: Vec<WalkSample> = misses_per_step.iter().map(|m| WalkSample { steps: 1000, line_crossings: if walk == "in_lane" { 0 } else { 1000 }, c: if walk == "in_lane" { 0 } else { 1000 }, l1d_read_misses: (m * 1000.0) as u64, instructions: 5000 }).collect();
        reduce(walk, samples)
    }

    #[test]
    fn the_two_edge_lists_read_zero_and_all_crossings_on_the_odometer() {
        let cells = lattice_cells(&lane_mask(), &blocks());
        let (e_in, e_out) = edges(1440);
        let (i, o) = (read(&cells, &e_in), read(&cells, &e_out));
        assert_eq!((i.steps, i.line_crossings, i.c), (1440, 0, 0));
        assert_eq!((o.steps, o.line_crossings, o.c), (1440, 1440, 1440), "every out-of-lane step is one line crossing and one fence crossing");
        let order = out_of_lane_order();
        let mut seen = [false; GRID]; for &k in &order { seen[k] = true; }
        assert!(seen.iter().all(|&s| s), "the permutation visits every anchor");
        assert_eq!(order, out_of_lane_order(), "seeded: same order every call");
    }

    #[test]
    fn control_verdict_admits_a_held_line_and_refuses_an_evicted_one() {
        let ok = control_verdict(&stats("in_lane", &[0.0, 0.001, 0.0]), CONTROL_MISSES_PER_STEP_MAX);
        assert!(ok.admissible); assert!(ok.reason.contains("within"));
        let bad = control_verdict(&stats("in_lane", &[0.4, 0.5, 0.6]), CONTROL_MISSES_PER_STEP_MAX);
        assert!(!bad.admissible); assert!(bad.reason.contains("NOT evidence"));
    }

    #[test]
    fn reduce_reports_a_median_with_min_and_max_and_the_readouts_never_touch_the_gauge() {
        let s = stats("out_of_lane", &[1.1, 0.9, 1.0]);
        assert_eq!(s.misses_per_crossing, Spread { median: 1.0, min: 0.9, max: 1.1 });
        assert_eq!(s.misses_per_kinst.median, 200.0);
        assert_eq!(gauge().kE_milli_per_crossing, 3);
        assert_eq!(READOUTS, ["misses_per_crossing", "misses_per_kinst"]);
    }

    #[test]
    fn the_door_on_this_host_is_measured_with_both_walks_or_unmeasured_with_an_errno() {
        let r = report(2, 288);
        assert_eq!(r.scope, "apparatus (AXIOM 0 rung 4)"); assert!(!r.shipped_default);
        assert_eq!(r.gauge.kE_milli_per_crossing, 3);
        let text = report_text(&r);
        let json = report_json(&r);
        assert!(json.contains("\"kE_milli_per_crossing\":3"));
        if r.counter.available {
            let (i, o, v) = (r.in_lane.as_ref().unwrap(), r.out_of_lane.as_ref().unwrap(), r.control.as_ref().unwrap());
            assert_eq!((i.line_crossings, o.line_crossings), (0, 288));
            assert!(o.misses_per_crossing.min <= o.misses_per_crossing.median && o.misses_per_crossing.median <= o.misses_per_crossing.max);
            assert_eq!(r.status, if v.admissible { "MEASURED" } else { "NOT ADMISSIBLE" });
            assert!(text.contains("ADMISSIBLE"));
        } else {
            assert_eq!(r.status, "UNMEASURED");
            assert!(r.in_lane.is_none() && r.out_of_lane.is_none() && r.control.is_none());
            assert!(text.contains("UNMEASURED") && text.contains("perf_event_paranoid"));
            if cfg!(target_os = "linux") && arch_can_release_lines() { assert!(r.counter.errno.is_some(), "a refused syscall names its errno"); }
        }
    }
}
