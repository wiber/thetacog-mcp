// .thetacog/pmu/src/gate.rs
//
// THE BALLISTIC GATE — XOR + popcount, on the metal.
//
// This is the whole point of the port. In JS the XOR-popcount was a
// BigInt loop; here `^` is one instruction and `count_ones()` lowers to
// the hardware popcount (CNT on aarch64, POPCNT on x86) — combinational,
// no loop, no second fetch. signature.mjs's `hamming()` IS this, and on
// the chip it stays this: two K-bit signatures in, one distance out.

use std::time::Instant;

/// The ballistic gate: two 64-bit signatures in, one Hamming distance
/// out. On the chip a 64-bit lane is one XOR + one popcount tree.
#[inline(always)]
pub fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Widen to K = 256: four 64-bit lanes, the popcounts summed. The chip
/// scales the same way — print more lanes, not more logic.
#[inline(always)]
pub fn hamming256(a: &[u64; 4], b: &[u64; 4]) -> u32 {
    let mut d = 0u32;
    for i in 0..4 {
        d += (a[i] ^ b[i]).count_ones();
    }
    d
}

/// Benchmark the ballistic comparison. The driver is a 1-cycle rotate
/// so the figure is close to the gate proper — but it still includes
/// the driver and the loop; the gate itself (XOR + count_ones) is one
/// to a few cycles. Returns ns per driven comparison.
pub fn bench_gate(reps: u64) -> f64 {
    let b = 0xDEAD_BEEF_CAFE_F00Du64;
    let mut a = 0x0123_4567_89AB_CDEFu64;
    let mut acc = 0u64;
    let t = Instant::now();
    for _ in 0..reps {
        a = a.rotate_left(1); // 1-cycle driver — keeps each gate distinct
        acc = acc.wrapping_add(hamming(a, b) as u64);
    }
    let elapsed = t.elapsed();
    std::hint::black_box(acc);
    elapsed.as_nanos() as f64 / reps as f64
}

// ── tests ────────────────────────────────────────────────────────────
//
// The dossier claim (docs/pmu-hackathon-demo-2026-06-06.html §1) is that
// the gate is XOR + hardware popcount, measured live at ~0.5377 ns per
// driven comparison. The PERF number is environment-dependent and is NOT
// asserted here (perf assertions in tests are flaky lies). What IS
// asserted: the gate's arithmetic correctness on known inputs, and that
// the timing harness measures what it claims structurally (positive,
// finite, per-rep normalized).
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hamming_known_inputs() {
        assert_eq!(hamming(0, 0), 0);
        assert_eq!(hamming(u64::MAX, u64::MAX), 0);
        assert_eq!(hamming(0, u64::MAX), 64);
        assert_eq!(hamming(0b1010, 0b0110), 2);
        // symmetry: d(a,b) == d(b,a)
        let (a, b) = (0xDEAD_BEEF_CAFE_F00Du64, 0x0123_4567_89AB_CDEFu64);
        assert_eq!(hamming(a, b), hamming(b, a));
        // identity of indiscernibles: d(a,a) == 0
        assert_eq!(hamming(a, a), 0);
    }

    #[test]
    fn hamming256_is_the_sum_of_four_lanes() {
        let a = [0u64, u64::MAX, 0b1010, 0xFFFF_0000_FFFF_0000];
        let b = [0u64, 0, 0b0110, 0x0000_FFFF_0000_FFFF];
        let expected: u32 = (0..4).map(|i| hamming(a[i], b[i])).sum();
        assert_eq!(hamming256(&a, &b), expected);
        assert_eq!(hamming256(&a, &b), 0 + 64 + 2 + 64);
        // all-equal lanes → 0; all-complement lanes → 256
        assert_eq!(hamming256(&a, &a), 0);
        let na = [!a[0], !a[1], !a[2], !a[3]];
        assert_eq!(hamming256(&a, &na), 256);
    }

    #[test]
    fn bench_gate_measures_per_rep_time() {
        // Structure test, NOT a perf assertion: the harness must return a
        // positive, finite ns/rep figure. 100k reps keeps this < 1 ms.
        let ns = bench_gate(100_000);
        assert!(ns.is_finite() && ns > 0.0, "bench_gate returned {}", ns);
        // sanity ceiling: even an unoptimized debug gate is far below 10 µs/rep
        assert!(ns < 10_000.0, "bench_gate {} ns/rep — the harness is not normalizing per rep", ns);
    }
}
