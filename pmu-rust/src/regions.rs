// src/regions.rs — DRIFT-REGION DETECTION on the metal (the "encircled colored regions" decode).
//
// This is the Rust port of the JS scripts/pmu/annotate-regions.mjs detectColorRegions, moved onto
// the chip so the email + panel call ONE pipeline functionally (operator: "one single rust pipeline
// we call functionally was the plan"). It is LLM-FREE and deterministic — a pure function of the
// tolerance panel, exactly like the on-commit receipt.
//
// INPUT  (stdin): the 144×144 per-CELL tolerance CLASS bitmap, one byte per cell, row-major:
//                 0 = background (unlit) · 1 = green (in-lane) · 2 = amber (adjacent bleed) · 3 = red
//                 (orthogonal drift). Classification of RGBA→class stays in the caller (trivial); the
//                 compute-heavy clustering — the reason to be in Rust — is HERE.
// OUTPUT (stdout): JSON { "regions": [ {n,kind,blocks,blockBox{r0,r1,c0,c1},coord,center,line} ] }
//                  coord/center are ballistic::SHORTLEX pair labels — the SAME canonical 144 the walk
//                  uses, so JS can never drift from the chip's ordering.
//
// SCALE-INVARIANT by construction (operator: "ideally scale invariant") — the JS detector used
// ABSOLUTE thresholds (DRIFT_ABS=6, gap=2, minLit) so a DENSE panel exploded into giant overlapping
// ovals (the demo bug). Here every gate is a FRACTION of the local lit mass, and clustering is plain
// 8-connected components with a TIGHT bounding box — so the same shapes emerge whether the panel is
// sparse (a real commit) or saturated (the synthetic demo), and no ellipse can exceed its patch.
// LEVEL-INVARIANT coord labeling is deferred (operator: "level invariant (later)").

use crate::ballistic::SHORTLEX;
use serde::Serialize;
use std::io::Read;

const N: usize = 144; // cells per side
const B: usize = 12; // cells per block
const NB: usize = N / B; // 12 blocks per side

// scale-invariant tunables — all RELATIVE (fractions), never absolute cell counts.
const DRIFT_FRAC: f64 = 0.25; // a block is drift if a non-dominant colour is ≥ this fraction of its lit cells
const DOM_FRAC: f64 = 0.55; // a block is the carpet if the dominant colour is ≥ this fraction of lit
const LINE_SPAN_FRAC: f64 = 0.50; // an INVARIANT line spans most of its axis (one actor across ~all
                                  // patients). At 0.33 a single-blob column (~1/3 fill) masqueraded as a
                                  // line and swallowed the real solid streak; the real line spans ~0.8+.
const LINE_FILL_FRAC: f64 = 0.40; // ...and be CONTIGUOUSLY filled along the span. This is the real
                                  // line/blob discriminator: an invariant streak is a filled row/col
                                  // (~0.9), while a blob column stretched by an outlier crossing is
                                  // gappy (~0.2). 0.40 keeps solid+lightly-dotted lines, drops blobs.
const LINE_ASPECT: usize = 3; // ...and be ≥ this many× longer than thick (else it's a blob)
const CARPET_FRAC: f64 = 0.40; // a DOMINANT (in-lane) component covering ≥ this fraction of blocks IS
                               // the carpet/background — never drawn as one panel-spanning oval (the
                               // giant-green-blob bug). Drift is never subject to this: every drift
                               // patch is kept, however large. scale-invariant (a fraction of blocks).

#[derive(Serialize)]
pub struct BlockBox {
    pub r0: usize,
    pub r1: usize,
    pub c0: usize,
    pub c1: usize,
}

#[derive(Serialize)]
pub struct Line {
    pub orient: &'static str, // "horizontal" | "vertical"
    pub axis: &'static str,   // "actor" (row held) | "patient" (col held)
}

#[derive(Serialize)]
pub struct Region {
    pub n: usize,
    pub kind: u8, // 1 green · 2 amber · 3 red
    pub blocks: usize,
    #[serde(rename = "blockBox")]
    pub block_box: BlockBox,
    pub coord: String,  // "A,A" or "A,A1 ▸ B1,C2"
    pub center: String, // the SHORTLEX label of the box centre block
    pub line: Option<Line>,
}

#[derive(Serialize)]
struct Out {
    regions: Vec<Region>,
}

fn block_label(br: usize, bc: usize) -> &'static str {
    SHORTLEX[br * NB + bc]
}

fn span_label(bb: &BlockBox) -> String {
    let tl = block_label(bb.r0, bb.c0);
    if bb.r0 == bb.r1 && bb.c0 == bb.c1 {
        return tl.to_string();
    }
    let br = block_label(bb.r1, bb.c1);
    format!("{tl} ▸ {br}")
}

fn center_label(bb: &BlockBox) -> String {
    let cr = (bb.r0 + bb.r1) / 2;
    let cc = (bb.c0 + bb.c1) / 2;
    block_label(cr, cc).to_string()
}

// LINE PASS (cell resolution). A thin drift streak is the canonical lattice INVARIANT — one actor-row
// fired across every patient-column, or one patient-column hit from every actor-row. It would die at
// block-majority (a 1-cell line is a minority in a 12-cell block), so we claim it FIRST. Returns the
// line regions + the set of claimed cell indices (so the block pass neither swallows nor recircles them).
fn detect_lines(cls: &[u8], k: u8, claimed: &mut Vec<bool>) -> Vec<Region> {
    let span_min = (N as f64 * LINE_SPAN_FRAC) as usize;
    let mut out = Vec::new();

    // 'h' = a row scanned across columns; 'v' = a column scanned down rows.
    for orient in ["h", "v"] {
        // qualifying lines: (a, lo, hi) where a is the fixed row(h)/col(v).
        let mut lines: Vec<(usize, usize, usize)> = Vec::new();
        for a in 0..N {
            let mut lo = usize::MAX;
            let mut hi = 0usize;
            let mut cnt = 0usize;
            for b in 0..N {
                let idx = if orient == "h" { a * N + b } else { b * N + a };
                if cls[idx] == k {
                    if b < lo {
                        lo = b;
                    }
                    if b > hi {
                        hi = b;
                    }
                    cnt += 1;
                }
            }
            if cnt == 0 {
                continue;
            }
            let span = hi - lo + 1;
            let fill_min = (span as f64 * LINE_FILL_FRAC).max(8.0) as usize;
            if span >= span_min && cnt >= fill_min {
                lines.push((a, lo, hi));
            }
        }
        if lines.is_empty() {
            continue;
        }
        // merge adjacent qualifying rows/cols (gap ≤ 2) into ONE band.
        lines.sort_by_key(|x| x.0);
        let mut bands: Vec<(usize, usize, usize, usize)> = Vec::new(); // (a_lo, a_hi, lo, hi)
        let mut cur = (lines[0].0, lines[0].0, lines[0].1, lines[0].2);
        for &(a, lo, hi) in lines.iter().skip(1) {
            if a <= cur.1 + 2 {
                cur.1 = a;
                cur.2 = cur.2.min(lo);
                cur.3 = cur.3.max(hi);
            } else {
                bands.push(cur);
                cur = (a, a, lo, hi);
            }
        }
        bands.push(cur);

        for (a_lo, a_hi, lo, hi) in bands {
            let thick = a_hi - a_lo + 1;
            let long = hi - lo + 1;
            // THIN gate: a real line is ≥ ASPECT× longer than thick (a square blob falls through to
            // the blob clusterer). scale-invariant (a ratio).
            if long < thick * LINE_ASPECT {
                continue;
            }
            // MAX-THICKNESS gate (the traced fusion bug): a real invariant line is ONE lattice lane
            // thick (~1 block). Without this, the two red blobs stack to span the full height and a
            // 3-block-wide column masquerades as a "line", swallowing both blobs. A lane is B cells by
            // the 12×12 lattice definition, so ≤ 1.5 lanes is lattice-relative, NOT pixel-scale.
            if thick > B + B / 2 {
                continue;
            }
            let (r0, r1, c0, c1) = if orient == "h" {
                (a_lo / B, a_hi / B, lo / B, hi / B)
            } else {
                (lo / B, hi / B, a_lo / B, a_hi / B)
            };
            // claim the streak's lit cells so the blob pass skips them.
            let mut touched: std::collections::HashSet<usize> = std::collections::HashSet::new();
            for a in a_lo..=a_hi {
                for b in lo..=hi {
                    let idx = if orient == "h" { a * N + b } else { b * N + a };
                    if cls[idx] == k {
                        claimed[idx] = true;
                        touched.insert((idx / N / B) * NB + (idx % N) / B);
                    }
                }
            }
            let bb = BlockBox { r0, r1, c0, c1 };
            out.push(Region {
                n: 0,
                kind: k,
                blocks: touched.len(),
                coord: span_label(&bb),
                center: center_label(&bb),
                line: Some(if orient == "h" {
                    Line { orient: "horizontal", axis: "actor" }
                } else {
                    Line { orient: "vertical", axis: "patient" }
                }),
                block_box: bb,
            });
        }
    }
    out
}

// 8-connected components over the block grid for colour k → one region per component, TIGHT box.
fn components(block_kind: &[u8], k: u8) -> Vec<Vec<(usize, usize)>> {
    let mut seen = vec![false; NB * NB];
    let mut groups = Vec::new();
    for br in 0..NB {
        for bc in 0..NB {
            if block_kind[br * NB + bc] != k || seen[br * NB + bc] {
                continue;
            }
            // flood fill (8-connectivity)
            let mut stack = vec![(br, bc)];
            let mut group = Vec::new();
            seen[br * NB + bc] = true;
            while let Some((r, c)) = stack.pop() {
                group.push((r, c));
                for dr in -1i32..=1 {
                    for dc in -1i32..=1 {
                        if dr == 0 && dc == 0 {
                            continue;
                        }
                        let nr = r as i32 + dr;
                        let nc = c as i32 + dc;
                        if nr < 0 || nc < 0 || nr as usize >= NB || nc as usize >= NB {
                            continue;
                        }
                        let (nr, nc) = (nr as usize, nc as usize);
                        if block_kind[nr * NB + nc] == k && !seen[nr * NB + nc] {
                            seen[nr * NB + nc] = true;
                            stack.push((nr, nc));
                        }
                    }
                }
            }
            groups.push(group);
        }
    }
    groups
}

pub fn detect(cls: &[u8]) -> Vec<Region> {
    // 0. panel dominant colour (the carpet) — argmax over lit-cell counts.
    let mut cell_count = [0usize; 4];
    for &v in cls.iter() {
        cell_count[v as usize] += 1;
    }
    let dominant = (1u8..=3).max_by_key(|&k| cell_count[k as usize]).unwrap();

    // A. LINE PASS — drift colours only (red first so a red∩amber crossing reads as drift).
    let mut claimed = vec![false; N * N];
    let mut regions: Vec<Region> = Vec::new();
    for &k in &[3u8, 2u8] {
        if k == dominant {
            continue;
        }
        regions.extend(detect_lines(cls, k, &mut claimed));
    }

    // B. BLOCK CLASSIFICATION — SCALE-INVARIANT: fractions of the block's own lit mass, not absolute
    //    counts. A non-dominant (drift) colour claims the block on DRIFT_FRAC; the dominant colour on
    //    DOM_FRAC. Line-claimed cells are excluded.
    let mut block_kind = vec![0u8; NB * NB];
    for br in 0..NB {
        for bc in 0..NB {
            let mut cnt = [0usize; 4];
            for r in br * B..br * B + B {
                for c in bc * B..bc * B + B {
                    let idx = r * N + c;
                    if claimed[idx] {
                        continue;
                    }
                    cnt[cls[idx] as usize] += 1;
                }
            }
            let lit = cnt[1] + cnt[2] + cnt[3];
            if lit == 0 {
                continue;
            }
            let litf = lit as f64;
            let mut k = 0u8;
            // drift override (red, then amber) — relative gate
            for dc in [3u8, 2u8] {
                if dc != dominant && (cnt[dc as usize] as f64) / litf >= DRIFT_FRAC {
                    k = dc;
                    break;
                }
            }
            if k == 0 {
                // dominant carpet — relative majority
                let kk = if cnt[1] >= cnt[2] && cnt[1] >= cnt[3] {
                    1
                } else if cnt[2] >= cnt[3] {
                    2
                } else {
                    3
                };
                if (cnt[kk as usize] as f64) / litf >= DOM_FRAC {
                    k = kk;
                }
            }
            block_kind[br * NB + bc] = k;
        }
    }

    // C. CONNECTED COMPONENTS per colour → TIGHT box (scale-invariant; no absolute density gap).
    let carpet_cap = (CARPET_FRAC * (NB * NB) as f64) as usize;
    for k in [3u8, 2u8, 1u8] {
        for g in components(&block_kind, k) {
            // the dominant carpet, if it sprawls across the panel, is BACKGROUND — not an oval.
            // (drift colours are never skipped, however large.)
            if k == dominant && g.len() >= carpet_cap {
                continue;
            }
            let r0 = g.iter().map(|x| x.0).min().unwrap();
            let r1 = g.iter().map(|x| x.0).max().unwrap();
            let c0 = g.iter().map(|x| x.1).min().unwrap();
            let c1 = g.iter().map(|x| x.1).max().unwrap();
            let bb = BlockBox { r0, r1, c0, c1 };
            regions.push(Region {
                n: 0,
                kind: k,
                blocks: g.len(),
                coord: span_label(&bb),
                center: center_label(&bb),
                line: None,
                block_box: bb,
            });
        }
    }

    // sort by block-mass (headline invariant lines sort high), number 1..n.
    regions.sort_by(|a, b| b.blocks.cmp(&a.blocks));
    for (i, r) in regions.iter_mut().enumerate() {
        r.n = i + 1;
    }
    regions
}

pub fn run(_args: &[String]) {
    let mut buf = Vec::new();
    std::io::stdin()
        .read_to_end(&mut buf)
        .expect("read cls bitmap from stdin");
    assert_eq!(
        buf.len(),
        N * N,
        "expected {} cls bytes (144×144), got {}",
        N * N,
        buf.len()
    );
    let regions = detect(&buf);
    let out = Out { regions };
    println!("{}", serde_json::to_string(&out).expect("serialize regions"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_panel_yields_no_regions() {
        let cls = vec![0u8; N * N];
        assert_eq!(detect(&cls).len(), 0);
    }

    #[test]
    fn tight_box_never_exceeds_panel() {
        // one solid red block at (8,8) — box must be exactly that block, never spill.
        let mut cls = vec![0u8; N * N];
        for r in 8 * B..9 * B {
            for c in 8 * B..9 * B {
                cls[r * N + c] = 3;
            }
        }
        let regs = detect(&cls);
        assert!(!regs.is_empty());
        for r in &regs {
            assert!(r.block_box.r1 < NB && r.block_box.c1 < NB, "box within panel");
        }
    }
}
