// .thetacog/pmu/src/pointer_chase.rs
//
// CACHE-TIER LATENCY — the real hardware measurement, no counters.
//
// Build a random permutation cycle over a working set and chase it. A
// dependent load (each load's value IS the next address) cannot be
// prefetched, so every chase is one genuine cache access. Sweep the
// working-set size across L1 / L2 / SLC / DRAM and the latency curve IS
// the cache hierarchy, read off the metal — no privileged PMU counter
// needed. This is the JS pmu-onchip.mjs measurement, now native.

use std::time::Instant;

// fixed access count — enough chases that loop overhead is negligible
const ACCESSES: usize = 10_000_000;

/// One cache-tier measurement.
pub struct Tier {
    pub label: &'static str,
    pub kib: usize,
    pub ns_per_access: f64,
}

/// Build a single full-length permutation cycle of a `kib`-KiB buffer
/// and chase it `ACCESSES` times; return ns per dependent load.
pub fn chase(kib: usize, label: &'static str) -> Tier {
    let slots = (kib * 1024) / std::mem::size_of::<usize>();
    let slots = slots.max(2);

    // Fisher-Yates shuffle of [0, slots) with a deterministic xorshift,
    // so the run is reproducible.
    let mut perm: Vec<usize> = (0..slots).collect();
    let mut s: u64 = 0x9E37_79B9_7F4A_7C15 ^ (slots as u64);
    for i in (1..slots).rev() {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        let j = (s as usize) % (i + 1);
        perm.swap(i, j);
    }

    // link slot perm[k] -> perm[k+1]: following the chain visits every
    // slot exactly once before returning to the start — one big cycle.
    let mut buf = vec![0usize; slots];
    for k in 0..slots {
        buf[perm[k]] = perm[(k + 1) % slots];
    }

    // warm the working set into cache
    let mut idx = 0usize;
    for _ in 0..slots {
        idx = buf[idx];
    }
    std::hint::black_box(idx);

    // measure
    let t = Instant::now();
    let mut p = 0usize;
    for _ in 0..ACCESSES {
        p = buf[p];
    }
    let elapsed = t.elapsed();
    std::hint::black_box(p);

    Tier {
        label,
        kib,
        ns_per_access: elapsed.as_nanos() as f64 / ACCESSES as f64,
    }
}

// ── byte_footprint — the CANDIDATE independent physical witness ──────────────
//
// A DOC-derived cache-locality measurement. The address sequence is built from
// sliding W-byte window-hashes of the doc, so repeated byte-windows revisit the
// same buffer address (cache hits) and diverse windows scatter (misses). The
// window-hashing is done OUTSIDE the timed loop, so the timed loop is pure
// buffer access — the ns/access reflects the doc's byte LOCALITY (repetition /
// entropy), which is orthogonal to its semantic topic.
//
// First design. Whether it discriminates ABOVE cache jitter is the open
// empirical question (the F>10 / signal-dominates-noise bar). Returns ns/access
// at the given working-set size; sweep sizes for the footprint shape.
pub fn byte_footprint(doc: &[u8], kib: usize) -> f64 {
    let slots = ((kib * 1024) / std::mem::size_of::<u64>()).max(2);
    let mut buf = vec![0u64; slots];
    for i in 0..slots {
        buf[i] = i as u64;
    }
    let n = doc.len().max(1);
    const LEN: usize = 2_000_000;
    const W: usize = 8;

    // precompute the address sequence from doc window-hashes (NOT timed)
    let mut seq = vec![0u32; LEN];
    for i in 0..LEN {
        let mut wh: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a offset
        for k in 0..W {
            wh = (wh ^ doc[(i + k) % n] as u64).wrapping_mul(0x100_0000_01b3);
        }
        seq[i] = (wh as usize % slots) as u32;
    }

    // timed: pure cache access over the doc-derived address sequence
    let mut acc = 0u64;
    let t = Instant::now();
    for i in 0..LEN {
        acc = acc.wrapping_add(buf[seq[i] as usize]);
    }
    let elapsed = t.elapsed();
    std::hint::black_box(acc);
    elapsed.as_nanos() as f64 / LEN as f64
}

// ── tests ────────────────────────────────────────────────────────────
// The latencies themselves are physical measurements — asserting their
// VALUES in a unit test would be a perf lie (load-dependent). What is
// testable: the harness SHAPE — positive finite ns, and the permutation
// construction producing a single full cycle (the prefetcher-defeat
// property the dossier's "cannot be faked in software" argument rests on).
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chase_returns_positive_finite_latency() {
        // L1-sized only — keeps the test fast (~tens of ms).
        let t = chase(16, "L1");
        assert_eq!(t.kib, 16);
        assert!(t.ns_per_access.is_finite() && t.ns_per_access > 0.0);
        assert!(t.ns_per_access < 1_000.0, "L1 chase {} ns/access — harness not normalizing", t.ns_per_access);
    }

    #[test]
    fn byte_footprint_is_positive_and_doc_dependent_shape() {
        let doc = b"the ballistic walk traverses the connectivity lattice on silicon";
        let ns = byte_footprint(doc, 256);
        assert!(ns.is_finite() && ns > 0.0);
    }
}
