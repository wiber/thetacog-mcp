// .thetacog/pmu/src/counter.rs
//
// RAW PMU COUNTERS — the next gate, honestly reported.
//
// The pointer-chase measures cache latency WITHOUT counters — the
// latency curve is the hierarchy. Reading the hardware event registers
// directly (cache-miss counts, retired cycles, the §10i drift signal)
// needs privileged access, and it differs by platform. v0 reports the
// capability status truthfully rather than faking a number.
//
//   Linux  — perf_event_open(2); needs CAP_PERFMON or
//            /proc/sys/kernel/perf_event_paranoid <= 1.
//   macOS  — the counters are real but behind kperf, a private
//            framework; unprivileged code cannot read them. The
//            pointer-chase is the unprivileged measurement here.

pub struct CounterStatus {
    pub platform: &'static str,
    pub available: bool,
    pub note: &'static str,
}

/// Report what raw-counter access requires on this host. v0 does not
/// attempt the privileged read — it states the gate so the operator
/// knows exactly what enabling it costs.
pub fn status() -> CounterStatus {
    #[cfg(target_os = "linux")]
    {
        CounterStatus {
            platform: "linux",
            available: false,
            note: "perf_event_open(2) is the path — enable with CAP_PERFMON \
                   or perf_event_paranoid <= 1, then wire the raw counter read",
        }
    }
    #[cfg(target_os = "macos")]
    {
        CounterStatus {
            platform: "macos",
            available: false,
            note: "raw counters are behind kperf (private framework); \
                   pointer-chase is the unprivileged on-chip measurement",
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        CounterStatus {
            platform: "other",
            available: false,
            note: "raw PMU counter access not specced for this platform",
        }
    }
}

// ── tests ────────────────────────────────────────────────────────────
// v0's contract is HONESTY: it must report the gate, never fake a number.
// available must be false until a privileged counter read is actually
// wired — if someone flips it without wiring the read, this fires.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v0_reports_the_gate_truthfully() {
        let s = status();
        assert!(["linux", "macos", "other"].contains(&s.platform));
        assert!(!s.available, "v0 must not claim raw counters until the privileged read is wired");
        assert!(!s.note.is_empty(), "the note must state what enabling costs");
    }
}
