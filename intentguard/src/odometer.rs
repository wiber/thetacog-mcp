// src/odometer.rs — THE BOUNDARY ODOMETER: k_E pinned to a COUNT, the count pinned to the 64-byte line.
//
// Operator (2026-10-14): "we gotta be able to actually count to get boundary cost crossings to create a ratio to
// create formal methods on this particular measure … pin the meter to an exact measurement because right now it's
// pinned to a spec."
//
// WHAT THIS REPLACES ON THE RECEIPT. σ (walk_lens::z_margin) is a second-moment summary of the walk heat: a float,
// Gaussian by construction, rounded to two places in two engines. A receipt line "σ=0.00" reports a statistical blur.
// The odometer reports an integer: how many times the definer walk STEPPED ACROSS THE DECLARED LANE'S WALL, and the
// canonical k_E = 0.003 (CLAUDE.md, CANONICAL NUMBERS — restated here, never re-derived) applied to that count as an
// exact fixed-point tally: c crossings × 3 milli-units. "c=4 · kE=0.012" is the same bytes in Rust and in JS because
// nothing in it is a float.
//
// HOW THE METER IS PINNED (the SI move: a discrete physical event counted as an integer, the scalar fixed by definition).
//   · Tier 1, shipped, unprivileged, cross-engine: the 144 lattice anchors live in a `LatticeCell` array whose element
//     is `#[repr(C, align(64))]` and exactly 64 bytes — one anchor, one cache line. A followed step cur → j in the walk
//     moves the read pointer from &cells[cur] to &cells[j]; the line index is the address shifted right by six, and it
//     changes iff cur != j. The lane bit of each anchor is read FROM THE CELL AT THAT ADDRESS, so a lane crossing is a
//     line crossing between a line whose bit is set and one whose bit is clear. `read` counts both: `line_crossings`
//     (every distinct-anchor step) and `c` (the subset whose lane bit flipped). The count is address arithmetic over
//     the walk's own edge list — AXIOM 0 rung 1 (positions are addresses), with no clock and no counter read.
//   · Tier 2, apparatus scope: on a bare-metal node a PMC harness watching L1D fills sees one line fill per step this
//     odometer counted. That calibration stays in boundary_probe.rs / counter.rs (rungs 3 and 4) and is never claimed
//     as the shipped default. This file ships the geometry that makes the two tiers count the same event.
//
// SUFFICIENT FOR: how many followed steps of THIS walk left or re-entered THIS fence, exactly, re-runnable from the commit
// bytes on any machine. NOT SUFFICIENT FOR: whether the work was good (Rice), or whether a crossing was warranted.
//
// FORBIDDEN here: a float anywhere in the tally · a per-day reading of k_E (it is per crossing; guard:
// tests/voice/k-e-is-per-crossing-never-per-day.test.mjs) · reading the lane bit from anything but the aligned cell.
// Guards: tests/pmu-simulator/boundary-odometer.test.mjs (the cross-engine integer parity and the receipt line);
// harness.rs OD1, OD2, OD3, OD4 (the crystal: enumerated over the crate's own domain, in the ledger with seen_to_fail).
// POINT OF VIEW: docs/architecture/claude-rules/measurement-inversion.md — the inversion, the four arbitrages and refusals, Tier 1 vs Tier 2, σ retired, k_E a gauge pinned to one crossing (C835).

use crate::ballistic::GRID;
use serde::Serialize;

/// One cache line per anchor. 64 bytes on every CPU this ships to (x86_64, aarch64, Apple silicon's L1D line).
pub const LINE_BYTES: usize = 64;
/// k_E = 0.003 per boundary crossing, carried as 3 milli-units so the tally is integer arithmetic.
pub const K_E_MILLI: u32 = 3;
/// ln(2)/k_E ≈ 231 crossings — restated from CLAUDE.md, never re-derived.
pub const HALF_LIFE_CROSSINGS: u32 = 231;

/// The anchor as the chip holds it: one 64-byte line. The lane bit is the ONLY field the odometer reads; the rest is the
/// address book (index, 12×12 block) so a stranger can check the line's identity from its own bytes.
#[repr(C, align(64))]
#[derive(Copy, Clone, Debug)]
pub struct LatticeCell {
    pub index: u16,
    pub block_row: u8,
    pub block_col: u8,
    pub in_lane: u8,
    _pad: [u8; 59],
}

const _: () = assert!(std::mem::size_of::<LatticeCell>() == LINE_BYTES, "a LatticeCell must be exactly one cache line");
const _: () = assert!(std::mem::align_of::<LatticeCell>() == LINE_BYTES, "a LatticeCell must start on a cache line");

/// The 144 lines, built once per read from the lane mask (true = inside the declared fence) and each anchor's block.
pub fn lattice_cells(lane_mask: &[bool; GRID], blocks: &[(u8, u8); GRID]) -> Box<[LatticeCell; GRID]> {
    let mut cells = Box::new([LatticeCell { index: 0, block_row: 0, block_col: 0, in_lane: 0, _pad: [0; 59] }; GRID]);
    for i in 0..GRID {
        cells[i] = LatticeCell { index: i as u16, block_row: blocks[i].0, block_col: blocks[i].1, in_lane: lane_mask[i] as u8, _pad: [0; 59] };
    }
    cells
}

/// The address of a cell, shifted to its line index. Two anchors share a line iff their indices are equal.
#[inline]
pub fn line_of(cell: &LatticeCell) -> usize { (cell as *const LatticeCell as usize) >> 6 }

/// The reading. Every field is an integer; `k_e_tally` is the fixed-point string "0.012" built from `k_e_milli`.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Odometer {
    /// followed steps of the walk (edges), the denominator of the ratio
    pub steps: u32,
    /// steps whose line index changed — every step between distinct anchors
    pub line_crossings: u32,
    /// steps from a lane line to a non-lane line
    pub exits: u32,
    /// steps from a non-lane line back to a lane line
    pub entries: u32,
    /// c = exits + entries: the boundary crossings k_E is charged on
    pub c: u32,
    /// 3 × c, in milli-units
    pub k_e_milli: u32,
    /// the same number printed as the receipt prints it
    pub k_e_tally: String,
    /// the drift ratio as an exact rational: crossings per followed step
    pub ratio: Ratio,
    /// restated constants, so the receipt carries its own unit
    pub k_e: &'static str,
    pub half_life_crossings: u32,
    pub cell_bytes: usize,
    pub unit: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Ratio { pub num: u32, pub den: u32 }

/// "0.012" from 12 milli-units: integer division and a zero-padded remainder, no float.
pub fn tally_string(milli: u32) -> String { format!("{}.{:03}", milli / 1000, milli % 1000) }

/// The read: walk the edge list over the aligned cells, reading the lane bit AT each address.
/// An edge naming an anchor outside 0..144 is skipped (it has no line), never clamped.
pub fn read(cells: &[LatticeCell; GRID], edges: &[(usize, usize)]) -> Odometer {
    let (mut steps, mut line_crossings, mut exits, mut entries) = (0u32, 0u32, 0u32, 0u32);
    for &(a, b) in edges {
        if a >= GRID || b >= GRID { continue; }
        steps += 1;
        let (ca, cb) = (&cells[a], &cells[b]);
        if line_of(ca) != line_of(cb) { line_crossings += 1; }
        match (ca.in_lane, cb.in_lane) {
            (1, 0) => exits += 1,
            (0, 1) => entries += 1,
            _ => {}
        }
    }
    let c = exits + entries;
    let k_e_milli = K_E_MILLI * c;
    Odometer {
        steps, line_crossings, exits, entries, c, k_e_milli,
        k_e_tally: tally_string(k_e_milli),
        ratio: Ratio { num: c, den: steps },
        k_e: "0.003",
        half_life_crossings: HALF_LIFE_CROSSINGS,
        cell_bytes: LINE_BYTES,
        unit: "boundary crossings of the declared lane by the definer walk; each followed step is one 64-byte line crossing; integers only, re-runnable from the commit",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocks() -> [(u8, u8); GRID] { let mut b = [(0u8, 0u8); GRID]; for i in 0..GRID { b[i] = ((i / 12) as u8, (i % 12) as u8); } b }

    #[test]
    fn every_distinct_anchor_pair_sits_on_a_different_line() {
        let cells = lattice_cells(&[true; GRID], &blocks());
        for i in 0..GRID { for j in 0..GRID {
            assert_eq!(line_of(&cells[i]) == line_of(&cells[j]), i == j, "line identity must be anchor identity ({}, {})", i, j);
        } }
    }

    #[test]
    fn five_wall_crossings_read_as_c_five_and_k_e_fifteen_milli() {
        let mut mask = [false; GRID]; for i in 0..12 { mask[i] = true; }   // lane = block row 0
        let cells = lattice_cells(&mask, &blocks());
        // in→in, in→out, out→out, out→in, in→out, out→in, in→out
        let edges = [(0, 1), (1, 20), (20, 30), (30, 2), (2, 50), (50, 3), (3, 99)];
        let o = read(&cells, &edges);
        assert_eq!((o.steps, o.line_crossings, o.exits, o.entries, o.c), (7, 7, 3, 2, 5));
        assert_eq!(o.k_e_milli, 15);
        assert_eq!(o.k_e_tally, "0.015");
        assert_eq!(tally_string(12), "0.012");
        assert_eq!(tally_string(3000), "3.000");
    }

    #[test]
    fn a_walk_that_never_leaves_the_lane_reads_zero_and_a_self_step_crosses_no_line() {
        let cells = lattice_cells(&[true; GRID], &blocks());
        let o = read(&cells, &[(0, 1), (1, 2), (2, 2), (2, 143)]);
        assert_eq!((o.c, o.k_e_milli, o.line_crossings, o.steps), (0, 0, 3, 4));
        assert_eq!(o.k_e_tally, "0.000");
        let out_of_range = read(&cells, &[(0, 144), (200, 1)]);
        assert_eq!(out_of_range.steps, 0);
    }
}
