// src/fleet_bench.rs — THE FLEET SCALING BENCH: two coordination protocols for N agents mutating one lattice, counted.
//
// Operator (2026-10-14, the measurement inversion): "Run an automated simulation comparing two multi-agent cohorts
// performing concurrent file mutations." C832 builds that simulation as a MODEL in the crate, driven by
// `pmu-onchip --fleet-bench --n 10,100,1000 --seed S`.
//
// THE MODEL. N agents, each with its own seeded LCG (no rand crate: the crate carries none, and the bytes must be the same
// on every machine). Every step each agent picks a target cell of the 144-cell ShortLex grid (crate::ballistic::GRID) and
// tries to write it. A CONTENTION is two or more agents on one cell in one step (k = the contenders on that cell).
//   · COHORT A (communication): every contender tells every other contender, so a contention costs k·(k−1) messages.
//     They then resolve by message order. A DEADLOCK is a contention whose messages cross inside one tick; the model's
//     rule, stated on the receipt: every contention with k ≥ 3 deadlocks under A (three or more agents each see the other
//     k−1 messages in a different order, and no order is shared). A deadlocked contention has no winner, so every
//     contender writes: k−1 COLLISIONS (an agent writing a cell another holds), each a boundary crossing (c += k−1).
//   · COHORT B (coordination): every agent reads the target cell's rank table before writing (reads += k, the lone
//     agent included: k = 1 is one read). The contender holding the LOWEST ShortLex index holds right of way and
//     advances; the rest YIELD to their next cell. A yield is in-lane, so c stays 0; a collision is an agent writing a
//     cell another holds, which B never does, by construction.
// UNISON is the odometer's ratio over the agent-steps: (agent_steps − c) / agent_steps, printed as a fixed-point
// three-place string by odometer::tally_string (integers only; "1.000" is zero crossings). k_E is charged on c exactly
// as the odometer charges it: K_E_MILLI × c.
//
// WHY THESE TWO SHAPES. The communication cost of A is a count of ordered pairs per contention, Σ k(k−1), which is
// quadratic in N over a fixed grid; the coordination cost of B is one read per agent per step, N·steps, linear by
// construction. The bench exists to show the two scaling shapes side by side with their counts, not to judge an agent.
//
// SUFFICIENT FOR: the scaling shape of the two protocols (messages vs reads as N grows, the collision and deadlock
// counts each protocol produces on the same targets, the same seed yielding the same bytes). NOT SUFFICIENT FOR: any
// model's behaviour — no LLM, no file, no clock is in this path; the agents are LCGs picking cells.
//
// Guards: tests/vna/c832-build-the-fleet-scaling-bench-as.test.mjs (tests/pmu-simulator/fleet-bench.test.mjs re-exports
// it); the unit tests below.

use crate::ballistic::GRID;
use crate::odometer::{tally_string, Ratio, K_E_MILLI};
use serde::Serialize;
use std::cmp::Ordering;

/// The default step count when `--steps` is absent: enough contentions at N=10 to count, bounded well under a second at N=1000.
pub const DEFAULT_STEPS: u32 = 100;

/// A 64-bit linear congruential generator (Knuth's MMIX constants). One per agent, seeded from (seed, agent index).
#[derive(Clone, Debug)]
pub struct Lcg(pub u64);

impl Lcg {
    pub fn seeded(seed: u64, agent: u64) -> Lcg {
        // splitmix64 over the pair so neighbouring agents do not share a low-bit phase
        let mut z = seed.wrapping_add(agent.wrapping_mul(0x9E37_79B9_7F4A_7C15)).wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        Lcg(z ^ (z >> 31))
    }
    pub fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) as u32
    }
    /// A cell of the 144-grid.
    pub fn next_cell(&mut self) -> usize { (self.next_u32() as usize) % GRID }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Cohort { A, B }

/// Right of way between two held ShortLex ranks: the LOWER index holds it. C831 owns the shared rule as
/// `lattice::arbitrate_collision(rank_a, rank_b) -> Ordering`; this private copy carries the same rule so the bench
/// builds while C831 lands, and it is the one place in this module the rule is stated. When C831 has landed, this
/// function is the one to retire for `crate::lattice::arbitrate_collision`.
fn right_of_way(rank_a: usize, rank_b: usize) -> Ordering { rank_a.cmp(&rank_b) }

/// One cohort's reading at one N. Every field is an integer except the two printed tallies, which are built from integers.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Reading {
    pub n: usize,
    pub cohort: Cohort,
    pub steps: u32,
    /// n × steps: the writes attempted, the denominator of unison
    pub agent_steps: u64,
    /// cells with k ≥ 2 contenders, summed over steps
    pub contentions: u64,
    /// A: Σ k(k−1) over contentions. B: 0 — nobody tells anybody.
    pub messages: u64,
    /// B: one rank-table read per agent per step. A: 0 — nobody reads a table.
    pub reads: u64,
    /// agents writing a cell another holds in the same step
    pub collisions: u64,
    /// A: contentions with k ≥ 3 (messages crossing in one tick). B: 0.
    pub deadlocks: u64,
    /// boundary crossings: every collision is one
    pub c: u64,
    pub k_e_milli: u64,
    pub k_e_tally: String,
    /// (agent_steps − c) / agent_steps as the odometer's exact rational
    pub unison_ratio: Ratio,
    /// the same ratio printed to three places, "1.000" when c = 0
    pub unison: String,
}

/// Run one cohort for `n` agents over `steps` steps from `seed`. Both cohorts draw the SAME target sequence per agent
/// (the LCG is seeded from (seed, agent) alone), so the contentions each protocol faces are identical.
pub fn run(n: usize, steps: u32, seed: u64, cohort: Cohort) -> Reading {
    let mut rngs: Vec<Lcg> = (0..n as u64).map(|a| Lcg::seeded(seed, a)).collect();
    // the cell each agent holds (last wrote, or its seat before the first step); B arbitrates on its ShortLex index
    let mut held: Vec<usize> = (0..n).map(|a| a % GRID).collect();
    let (mut contentions, mut messages, mut reads, mut collisions, mut deadlocks) = (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut targets = vec![0usize; n];
    let mut by_cell: Vec<Vec<usize>> = vec![Vec::new(); GRID];
    for _ in 0..steps {
        for cell in by_cell.iter_mut() { cell.clear(); }
        for a in 0..n {
            let t = rngs[a].next_cell();
            targets[a] = t;
            by_cell[t].push(a);
        }
        for (cell, contenders) in by_cell.iter().enumerate() {
            let k = contenders.len() as u64;
            if k == 0 { continue; }
            match cohort {
                Cohort::A => {
                    if k >= 2 {
                        contentions += 1;
                        messages += k * (k - 1);
                        if k >= 3 {
                            // messages cross in one tick: no shared order, every contender writes
                            deadlocks += 1;
                            collisions += k - 1;
                            for &a in contenders { held[a] = cell; }
                        } else {
                            // two contenders: the message order decides; the earlier message (lower held rank, then
                            // lower index — a fixed order, never a draw) writes, the other waits a tick
                            let w = winner(contenders, &held);
                            held[w] = cell;
                        }
                    } else {
                        held[contenders[0]] = cell;
                    }
                }
                Cohort::B => {
                    reads += k;
                    if k >= 2 { contentions += 1; }
                    let w = winner(contenders, &held);
                    held[w] = cell;   // the rest yield: in-lane, nothing written, c unchanged
                }
            }
        }
    }
    let agent_steps = n as u64 * steps as u64;
    let c = collisions;
    let k_e_milli = K_E_MILLI as u64 * c;
    let in_unison = agent_steps - c;
    let unison_milli = if agent_steps == 0 { 1000 } else { in_unison * 1000 / agent_steps };
    Reading {
        n, cohort, steps, agent_steps, contentions, messages, reads, collisions, deadlocks, c, k_e_milli,
        k_e_tally: tally_string(k_e_milli as u32),
        unison_ratio: Ratio { num: in_unison as u32, den: agent_steps as u32 },
        unison: tally_string(unison_milli as u32),
    }
}

/// The contender with right of way: the lowest held ShortLex index; equal indices fall to the lower agent number.
fn winner(contenders: &[usize], held: &[usize]) -> usize {
    let mut w = contenders[0];
    for &a in &contenders[1..] {
        match right_of_way(held[a], held[w]) {
            Ordering::Less => w = a,
            Ordering::Equal if a < w => w = a,
            _ => {}
        }
    }
    w
}

/// The summary row: the ratios the guard reads, the two model rules, and the sufficiency statement.
#[derive(Serialize, Clone, Debug)]
pub struct Summary {
    pub kind: &'static str,
    pub seed: u64,
    pub steps: u32,
    pub ns: Vec<usize>,
    /// messages(n_last)/messages(n_prev) for A and reads(n_last)/reads(n_prev) for B, as exact rationals (num/den)
    pub a_messages_growth: Ratio,
    pub b_reads_growth: Ratio,
    pub a_collisions: u64,
    pub b_collisions: u64,
    pub a_deadlocks: u64,
    pub b_deadlocks: u64,
    pub rules: Rules,
    pub sufficient_for: &'static str,
    pub not_sufficient_for: &'static str,
}

#[derive(Serialize, Clone, Debug)]
pub struct Rules {
    pub contention: &'static str,
    pub a_messages: &'static str,
    pub a_deadlock: &'static str,
    pub b_reads: &'static str,
    pub b_yield: &'static str,
    pub collision: &'static str,
    pub unison: &'static str,
}

pub const RULES: Rules = Rules {
    contention: "two or more agents targeting one cell of the 144-grid in one step (k contenders)",
    a_messages: "A: every contender tells every other, messages += k*(k-1) per contention, resolved by message order",
    a_deadlock: "A: messages cross in one tick — every contention with k >= 3 deadlocks; no shared order, every contender writes, collisions += k-1",
    b_reads: "B: every agent reads the target cell's rank table before writing, reads += k (k = 1 is one read); the lowest held ShortLex index holds right of way",
    b_yield: "B: the rest yield to their next cell — in-lane, c stays 0",
    collision: "an agent writing a cell another holds in the same step; each is one boundary crossing (c), charged k_E = 0.003 per crossing",
    unison: "(agent_steps - c) / agent_steps, odometer::Ratio, printed to three places from integers",
};

pub const SUFFICIENT_FOR: &str = "the scaling shape of the two protocols: how messages (A) and reads (B) grow with N over one 144-cell grid for the same seeded targets, and the collisions and deadlocks each produces; the same seed gives the same bytes";
pub const NOT_SUFFICIENT_FOR: &str = "any model's behaviour: no LLM, file, clock or network is in this path — the agents are seeded LCGs picking cells, and whether a real agent would contend, yield or deadlock is not measured here";

/// The whole bench: per-N readings for both cohorts as JSON lines, one summary JSON line, one human line.
pub fn bench(ns: &[usize], steps: u32, seed: u64) -> String {
    let mut out = String::new();
    let mut a_rows = Vec::new();
    let mut b_rows = Vec::new();
    for &n in ns {
        let a = run(n, steps, seed, Cohort::A);
        let b = run(n, steps, seed, Cohort::B);
        out.push_str(&serde_json::to_string(&a).expect("serialize reading"));
        out.push('\n');
        out.push_str(&serde_json::to_string(&b).expect("serialize reading"));
        out.push('\n');
        a_rows.push(a);
        b_rows.push(b);
    }
    let growth = |rows: &[Reading], f: fn(&Reading) -> u64| -> Ratio {
        let len = rows.len();
        if len < 2 { return Ratio { num: 0, den: 0 }; }
        Ratio { num: f(&rows[len - 1]) as u32, den: f(&rows[len - 2]) as u32 }
    };
    let s = Summary {
        kind: "fleet-bench",
        seed,
        steps,
        ns: ns.to_vec(),
        a_messages_growth: growth(&a_rows, |r| r.messages),
        b_reads_growth: growth(&b_rows, |r| r.reads),
        a_collisions: a_rows.iter().map(|r| r.collisions).sum(),
        b_collisions: b_rows.iter().map(|r| r.collisions).sum(),
        a_deadlocks: a_rows.iter().map(|r| r.deadlocks).sum(),
        b_deadlocks: b_rows.iter().map(|r| r.deadlocks).sum(),
        rules: RULES,
        sufficient_for: SUFFICIENT_FOR,
        not_sufficient_for: NOT_SUFFICIENT_FOR,
    };
    out.push_str(&serde_json::to_string(&s).expect("serialize summary"));
    out.push('\n');
    out.push_str(&one_line(&a_rows, &b_rows, seed, steps));
    out.push('\n');
    out
}

fn one_line(a: &[Reading], b: &[Reading], seed: u64, steps: u32) -> String {
    let mut parts = vec![format!("fleet-bench seed={seed} steps={steps}")];
    for (ra, rb) in a.iter().zip(b) {
        parts.push(format!(
            "n={} · A msgs={} coll={} dead={} unison={} · B reads={} coll={} dead={} unison={}",
            ra.n, ra.messages, ra.collisions, ra.deadlocks, ra.unison, rb.reads, rb.collisions, rb.deadlocks, rb.unison
        ));
    }
    parts.push("sufficient for the scaling shape of the two protocols, not for any model's behaviour".into());
    parts.join(" · ")
}

/// Parse `--n 10,100,1000 --seed S [--steps T]` and print the bench. Bad numbers fall to the defaults named here.
pub fn run_cli(args: &[String]) -> String {
    let after = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
    let ns: Vec<usize> = after("--n")
        .map(|s| s.split(',').filter_map(|x| x.trim().parse::<usize>().ok()).filter(|&x| x > 0).collect())
        .filter(|v: &Vec<usize>| !v.is_empty())
        .unwrap_or_else(|| vec![10, 100, 1000]);
    let seed: u64 = after("--seed").and_then(|s| s.parse().ok()).unwrap_or(1);
    let steps: u32 = after("--steps").and_then(|s| s.parse().ok()).filter(|&s| s > 0).unwrap_or(DEFAULT_STEPS);
    bench(&ns, steps, seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b_reads_are_exactly_n_times_steps_with_zero_collisions_and_unison_one() {
        for &n in &[10usize, 100, 1000] {
            let b = run(n, 50, 7, Cohort::B);
            assert_eq!(b.reads, n as u64 * 50);
            assert_eq!((b.collisions, b.deadlocks, b.c, b.messages), (0, 0, 0, 0));
            assert_eq!(b.unison, "1.000");
            assert_eq!(b.unison_ratio, Ratio { num: n as u32 * 50, den: n as u32 * 50 });
        }
    }

    #[test]
    fn a_messages_grow_faster_than_linearly_and_every_deadlock_collides() {
        let a100 = run(100, 50, 7, Cohort::A);
        let a1000 = run(1000, 50, 7, Cohort::A);
        assert!(a1000.messages > 12 * a100.messages, "{} vs {}", a1000.messages, a100.messages);
        assert!(a1000.deadlocks > 0);
        assert_eq!(a1000.c, a1000.collisions);
        assert_eq!(a1000.k_e_milli, 3 * a1000.c);
        assert!(a1000.collisions >= 2 * a1000.deadlocks, "k >= 3 means at least two extra writers per deadlock");
        assert_ne!(a1000.unison, "1.000");
    }

    #[test]
    fn the_same_seed_gives_the_same_bytes_and_a_different_seed_does_not() {
        let x = bench(&[10, 100], 20, 42);
        let y = bench(&[10, 100], 20, 42);
        assert_eq!(x, y);
        assert_ne!(x, bench(&[10, 100], 20, 43));
        assert!(x.contains("\"sufficient_for\"") && x.contains("\"not_sufficient_for\""));
        assert!(x.lines().last().unwrap().starts_with("fleet-bench seed=42 steps=20"));
    }

    #[test]
    fn right_of_way_is_the_lower_shortlex_index() {
        assert_eq!(right_of_way(3, 9), Ordering::Less);
        assert_eq!(right_of_way(9, 3), Ordering::Greater);
        assert_eq!(right_of_way(5, 5), Ordering::Equal);
        assert_eq!(winner(&[4, 2, 7], &[0, 0, 10, 0, 10, 0, 0, 3]), 7);
        assert_eq!(winner(&[4, 2], &[0, 0, 10, 0, 10]), 2);
    }
}
