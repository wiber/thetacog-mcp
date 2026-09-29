// .thetacog/pmu/src/matrix.rs
//
// THE MATRIX MULTIPLE — the canonical benchmark.
//
// One leaf-walk row reads ~`density` significant cells, each one XOR.
// The walk recurses to `depth`, and `processes` perspectives run
// concurrently (the metavector walk is one; the root walk another).
// The per-process count is floored at 20736 — the 144x144 lattice CELL
// count — because a walk cannot touch more cells than the lattice has.
// The directive: the daemon prints this on every run.

/// CELLS — the 144x144 lattice cell count (144 × 144 = 20736), the
/// per-process ceiling.
pub const CELLS: u64 = 20736;

pub struct MatrixMultiple {
    pub density: f64,
    pub depth: u32,
    pub processes: u32,
    pub per_process: u64,
    pub xor_cycles: u64,
}

/// cycles = (density x depth) per process, floored at CELLS (20736), x processes.
pub fn matrix_multiple(density: f64, depth: u32, processes: u32) -> MatrixMultiple {
    let raw = (density * depth as f64).round() as u64;
    let per_process = raw.min(CELLS);
    MatrixMultiple {
        density,
        depth,
        processes,
        per_process,
        xor_cycles: per_process * processes as u64,
    }
}

// ── tests ────────────────────────────────────────────────────────────
// NOTE (gap ledger): the "floored at 144" / "12x12 lattice" mislabels are
// FIXED (2026-06-11) — doc comment and daemon print now state the true
// floor: 20736, the 144×144 lattice cell count. The tests pin the
// arithmetic, which never changed.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_run_density3_depth8_processes12() {
        // The daemon's every-run print: 3.0 × 8 = 24 per process, ×12 = 288.
        let mm = matrix_multiple(3.0, 8, 12);
        assert_eq!(mm.per_process, 24);
        assert_eq!(mm.xor_cycles, 288);
    }

    #[test]
    fn per_process_is_capped_at_the_lattice() {
        let mm = matrix_multiple(1e6, 100, 2);
        assert_eq!(mm.per_process, CELLS, "a walk cannot touch more cells than the lattice has");
        assert_eq!(mm.xor_cycles, CELLS * 2);
    }
}
