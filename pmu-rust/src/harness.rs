// src/harness.rs — THE HARNESS PROPERTIES, CHECKED BY THE SAME BINARY THAT BUILDS THE PANELS.
//
// Spec: docs/architecture/fable-maintenance-ratchet.md §7 (THE CRYSTAL). Ledger: data/formal/harness-properties.json.
// Guard: tests/formal/harness-properties.test.mjs, which runs `pmu-onchip --maintain-harness` through the one resolver
// and cross-checks every PROVED row against what this file reports.
//
// WHY THIS LIVES IN THE CRATE AND NOT IN A MODEL BESIDE IT (operator, 2026-09-16: "this is what the rust pipeline is
// made for, so we're not creating a separate parallel implementation, we're applying it to the way we build the panels
// already"). A model checker that re-implements the ring latch in a second language checks the re-implementation. Every
// check below drives the SAME function the live walk calls — lens::ring_latch_fires, lens::ring_prev_after,
// lens::stage_after_latch, lens::z_required, aperture::pick_window, aperture::match_aperture — over an exhaustively
// enumerated finite domain. On that domain the result is a proof; outside it, it is nothing, and the domain is printed
// beside every verdict so nobody reads it wider.
//
// WHAT A VERDICT MEANS. `holds: true` — every element of the stated domain satisfied the property. `holds: false` —
// at least one did not, and the shortest counterexample is printed: the property is REFUTED on the running code, which
// is a defect with a trace, not a gap. A property that nobody can make fail proves the test compiles: the ledger names
// the one-token mutation each PROVED row was seen red under, and that is the guard's business, not this file's.
//
// LLM-free. No clock. The only generator is the crate's own LCG, seeded by constant. Two runs print byte-identical JSON.

use crate::aperture::{self, Doc};
use crate::lens;
use crate::action;
use crate::volatility;
use crate::envelope::{self, Unit, PriceTable, Yield, Dated, Usd};
use crate::aperture_read::{self, DEFAULT_BETAS};
use crate::steering_read;
use crate::job_units_read;
use serde_json::{json, Value};

struct Check { id: &'static str, name: &'static str, domain: String, checked: u64, holds: bool, counterexample: Value, note: String }

impl Check {
    fn to_json(&self) -> Value {
        json!({ "id": self.id, "name": self.name, "domain": self.domain, "checked": self.checked, "holds": self.holds,
                "counterexample": self.counterexample, "note": self.note })
    }
}

/// The crate's LCG idiom (the same constants the permutation null uses elsewhere), yielding ASCII so byte and char
/// lengths agree and a length can be cut without a boundary question.
fn lcg_text(seed: u64, n: usize) -> String {
    let mut s = seed; let mut out = String::with_capacity(n + 1);
    while out.len() < n {
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let b = (s >> 33) as u8;
        out.push(match b % 40 { 0..=25 => (b'a' + b % 26) as char, 26..=35 => (b'0' + b % 10) as char, 36..=38 => ' ', _ => '\n' });
    }
    out.truncate(n); out
}
fn low_text(n: usize) -> String { "the same sentence again and again. ".repeat(n / 35 + 1).chars().take(n).collect() }

// ── W1 / W2 · the worm ring loop, every path ───────────────────────────────────────────────────────────────────────
// State per walker: (prev_ok, prev_grip). Inputs per ring: ok ∈ {false, true}, grip ∈ {None, lo, hi} — the three values
// that matter to `<=`: absent, a value, a strictly higher value. Three rings → 6³ = 216 input sequences, all of them.
// The abstraction assumes every ring has parts (the live loop `continue`s on an empty ring, which only shortens a path).
// Both arms run on the same 216 sequences: the SHIPPED rule (ring_latch_fires, F18: a GripRise witness is required) and the
// pre-F18 rule retained as the falsifier arm (ring_latch_fires_v0). W2's verdict is the shipped rule's; the v0 result rides
// beside it so the fix is a delta on one domain and the model's power to find the false latch is demonstrated every run.
fn ring_arm(v0: bool) -> (u64, u64, Vec<(usize, Value)>) {
    let grips: [Option<f64>; 3] = [None, Some(0.1), Some(0.2)];
    let mut checked = 0u64; let mut latched = 0u64; let mut violations: Vec<(usize, Value)> = Vec::new();
    for seq in 0..216usize {
        let mut x = seq; let mut inputs: Vec<(bool, Option<f64>)> = Vec::new();
        for _ in 0..3 { let ok = x % 2 == 1; x /= 2; let g = grips[x % 3]; x /= 3; inputs.push((ok, g)); }
        let mut prev_ok = false; let mut prev_grip: Option<f64> = None; let mut rise: Option<lens::GripRise> = None;
        let mut rose = false; let mut stop_at: Option<usize> = None;
        for (r, (ok, g)) in inputs.iter().enumerate() {
            let fires = if v0 { lens::ring_latch_fires_v0(*ok, prev_ok, *g, prev_grip) } else { lens::ring_latch_fires(*ok, prev_ok, rise.as_ref(), *g, prev_grip) };
            if fires { stop_at = Some(r + 1); break; }
            // the harness's OWN reading of "rose", independent of the witness the rule consumes — so the two can disagree
            if *ok { if let (Some(a), Some(b)) = (g, prev_grip) { if a > &b { rose = true; } } }
            let (po, pg, nr) = lens::ring_prev_after(*ok, *g, prev_ok, prev_grip, rise); prev_ok = po; prev_grip = pg; rise = nr;
        }
        checked += 1;
        if let Some(r) = stop_at {
            latched += 1;
            if !rose {
                let trace: Vec<Value> = inputs.iter().take(r).map(|(ok, g)| json!({ "ok": ok, "grip": g })).collect();
                violations.push((r, json!({ "stopped_at_ring": r, "rings": trace, "grip_rose_before_stop": false })));
            }
        }
    }
    violations.sort_by_key(|(r, _)| *r);
    (checked, latched, violations)
}
fn check_ring_loop() -> Check {
    // W1 (rings-terminate) is NOT checked here on purpose: the bound is lens.rs's own `for r in 1..=3`, which this
    // enumeration does not run — a verdict from here would be the harness proving its own loop. W1 stays BY-CONSTRUCTION.
    let (checked, latched, violations) = ring_arm(false);
    let (_c0, latched0, violations0) = ring_arm(true);
    let mut w2 = Check { id: "W2", name: "latch-is-interior-maximum", domain: "all 216 (ok × grip∈{none,lo,hi})³ ring sequences".into(), checked,
        holds: violations.is_empty(),
        counterexample: violations.first().map(|(_, v)| v.clone()).unwrap_or(Value::Null),
        note: format!("shipped rule: {} sequences latched, {} without grip ever rising · v0 (pre-F18) arm: {} latched, {} false", latched, violations.len(), latched0, violations0.len()) };
    // the falsifier arm rides on the same row, never pooled with the verdict
    w2.counterexample = json!({ "shipped": w2.counterexample, "v0": { "latched": latched0, "false_latches": violations0.len(), "shortest": violations0.first().map(|(_, v)| v.clone()).unwrap_or(Value::Null) } });
    w2
}

// ── L1 · the thread ladder is directional ──────────────────────────────────────────────────────────────────────────
// State: prev_latched_grip ∈ {None, lo, hi} (always None at stage 1). Inputs per stage: latched ∈ {false,true},
// stage_grip ∈ {lo, hi}. Four stages → 4⁴ = 256 sequences. Property: the travel continues past a LATCHED stage only if
// that stage strictly raised prev_latched_grip — a ranking function over stages, so the ladder cannot stall green.
fn check_stage_ladder() -> Check {
    let vals = [0.1f64, 0.2f64];
    let mut checked = 0u64; let mut continued_after_latch = 0u64; let mut violations: Vec<Value> = Vec::new();
    for seq in 0..256usize {
        let mut x = seq; let mut inputs: Vec<(bool, f64)> = Vec::new();
        for _ in 0..4 { let l = x % 2 == 1; x /= 2; let g = vals[x % 2]; x /= 2; inputs.push((l, g)); }
        let mut prev: Option<f64> = None; let mut trace: Vec<Value> = Vec::new();
        for (latched, sg) in inputs.iter() {
            let before = prev;
            let (stop, after) = lens::stage_after_latch(*latched, *sg, prev);
            trace.push(json!({ "latched": latched, "stage_grip": sg, "prev_before": before, "stop": stop, "prev_after": after }));
            if stop { break; }
            if *latched {
                continued_after_latch += 1;
                let strictly_rose = match (before, after) { (None, Some(_)) => true, (Some(b), Some(a)) => a > b, _ => false };
                if !strictly_rose { violations.push(json!({ "stages": trace.clone() })); break; }
            }
            prev = after;
        }
        checked += 1;
    }
    Check { id: "L1", name: "thread-ladder-directional", domain: "all 256 (latched × grip∈{lo,hi})⁴ stage sequences".into(), checked,
        holds: violations.is_empty(), counterexample: violations.first().cloned().unwrap_or(Value::Null),
        note: if violations.is_empty() { format!("{} continuations past a latched stage, every one strictly raised the latched grip", continued_after_latch) } else { format!("{} continuations past a latched stage, {} continued WITHOUT strictly raising the latched grip", continued_after_latch, violations.len()) } }
}

// ── S2 / S3 · the family-wise latch ────────────────────────────────────────────────────────────────────────────────
fn check_z_required() -> (Check, Check) {
    let n_max = 10_000usize; let mut prev = f64::NEG_INFINITY; let mut bad: Option<Value> = None;
    for n in 1..=n_max { let z = lens::z_required(n); if z < prev { bad = Some(json!({ "n": n, "z": z, "z_prev": prev })); break; } prev = z; }
    let s2 = Check { id: "S2", name: "z-required-monotone", domain: format!("n in 1..={}", n_max), checked: n_max as u64, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        note: format!("z_required(1) = {:.4}, z_required({}) = {:.4}", lens::z_required(1), n_max, lens::z_required(n_max)) };
    let z1 = lens::z_required(1);
    let s3 = Check { id: "S3", name: "z-required-anchors", domain: "n = 1 against the rung floor 2.0, tolerance 0.01".into(), checked: 1, holds: (z1 - 2.0).abs() <= 0.01,
        counterexample: if (z1 - 2.0).abs() <= 0.01 { Value::Null } else { json!({ "z_required_1": z1 }) }, note: format!("z_required(1) = {:.4}", z1) };
    (s2, s3)
}

// ── P3 · exceedance is monotone in K ───────────────────────────────────────────────────────────────────────────────
// The real winner w_real ∈ {lo, mid, hi}; the null draws are every sequence over {lo, mid, hi} of length 1..=4 (120 sequences),
// read as growing prefixes K = 1..len. Property: exceed(prefix K) is non-decreasing in K — adding a draw can only add an
// exceedance — so exceed(K') = 0 ⇒ exceed(K) = 0 for K ≤ K'. z is NOT monotone in K and is not claimed; the note counts how
// often ok flips as K grows, which is why both halves ride on the row and neither alone decides.
fn check_perm_monotone() -> Check {
    let vals = [0.01f64, 0.02, 0.03];
    let mut checked = 0u64; let mut bad: Option<Value> = None; let mut ok_flips = 0u64;
    for &w_real in &vals {
        for len in 1..=4usize {
            let total = 3usize.pow(len as u32);
            for seq in 0..total {
                let mut x = seq; let mut draws: Vec<f64> = Vec::new();
                for _ in 0..len { draws.push(vals[x % 3]); x /= 3; }
                let mut prev_exceed = 0usize; let mut prev_ok: Option<bool> = None;
                for k in 1..=len {
                    let v = lens::perm_verdict(w_real, &draws[..k]);
                    if v.exceed < prev_exceed && bad.is_none() { bad = Some(json!({ "w_real": w_real, "draws": &draws[..k], "k": k, "exceed": v.exceed, "exceed_prev": prev_exceed })); }
                    if let Some(po) = prev_ok { if po != v.ok { ok_flips += 1; } }
                    prev_exceed = v.exceed; prev_ok = Some(v.ok);
                }
                checked += 1;
            }
        }
    }
    Check { id: "P3", name: "exceedance-monotone-in-K", domain: "w_real ∈ {lo,mid,hi} × every null sequence over {lo,mid,hi} of length 1..=4, read as growing prefixes".into(), checked,
        holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null), note: format!("exceed never fell as K grew; ok flipped {} times across prefixes (z is not monotone and is not claimed)", ok_flips) }
}

// ── N1 / N2 · THE NULL GENERATOR (the paste's second place formal methods protect SNR: "if your null distribution is
// flawed, your z-score is meaningless"). shuffle_words_seeded is the only randomness under every admissibility verdict.
// N1: for every word count 0..=64 and every seed the pipeline uses (7 + 97k, k = 1..=16), the shuffle preserves the word
//     MULTISET and the word count — the null moves order and nothing else. Words are made distinct so a multiset check is
//     exact; the permutation itself depends only on (n, seed), never on the words, so the domain is complete for the rule.
// N2: for word counts >= 4, no seed in the shipped K = 8 draws returns the IDENTITY permutation. An identity draw scores the
//     real line as one of its own nulls (w_null = w_real ⇒ exceed ≥ 1), which can only reject a real line — a bias in the
//     conservative direction, but a bias, and one the tape would never show. Reported per (n, k) if found.
fn check_null_shuffle() -> (Check, Check) {
    let mut checked = 0u64; let mut n1_bad: Option<Value> = None; let mut identity: Vec<Value> = Vec::new();
    for n in 0..=64usize {
        let words: Vec<String> = (0..n).map(|i| format!("w{}", i)).collect();
        let line = words.join(" ");
        for k in 1..=16u64 {
            let seed = 7u64 + 97u64 * k;
            let out = lens::shuffle_words_seeded(&line, seed);
            checked += 1;
            let mut a: Vec<&str> = line.split_whitespace().collect(); let mut b: Vec<&str> = out.split_whitespace().collect();
            let same_len = a.len() == b.len();
            a.sort(); b.sort();
            if !(same_len && a == b) && n1_bad.is_none() { n1_bad = Some(json!({ "n": n, "k": k, "seed": seed, "in_words": a.len(), "out_words": b.len() })); }
            if n >= 4 && k <= 8 && out == line { identity.push(json!({ "n": n, "k": k, "seed": seed })); }
        }
    }
    let n1 = Check { id: "N1", name: "null-preserves-the-multiset", domain: "word count 0..=64 × seeds 7+97k, k=1..=16 (1,040 shuffles)".into(), checked, holds: n1_bad.is_none(), counterexample: n1_bad.unwrap_or(Value::Null), note: "every shuffle kept the word count and the word multiset".into() };
    let n2 = Check { id: "N2", name: "null-is-never-identity-at-k8", domain: "word count 4..=64 × the shipped K=8 seeds".into(), checked: 61 * 8, holds: identity.is_empty(),
        counterexample: identity.first().cloned().unwrap_or(Value::Null), note: format!("{} identity draws among the shipped seeds for lines of 4+ words", identity.len()) };
    (n1, n2)
}

// ── PN2 / PN3 / N3 · the action read (spec §8.31) ────────────────────────────────────────────────────────────────
// PN2: constant targets ⇒ the permuted null equals the rate exactly and its sd is 0 — over row counts 20..=100 step 8,
// four hit fractions and three target cells. PN3: 400 rows spread over d distinct target cells, d = 1..=40 — measured
// iff d ≥ MIN_DISTINCT_TARGETS, whatever the z (the placements are the targets, so z is as large as it gets). N3: every
// draw the action null makes is a permutation — the sorted multiset is unchanged — over sizes 1..=64 × 16 seeds.
fn check_action_read() -> (Check, Check, Check) {
    let mut checked = 0u64; let mut pn2_bad: Option<Value> = None;
    for n in (20..=100usize).step_by(8) { for (fi, frac) in [0usize, 1, 2, 3].iter().enumerate() { for cell in [[0i64, 0i64], [5, 5], [11, 3]] {
        let rows: Vec<action::Row> = (0..n).map(|i| action::Row { i: i * 2, fin: if (i % 4) < *frac { cell } else { [(cell[0] + 6) % 12, (cell[1] + 6) % 12] }, target: cell }).collect();
        let (a, _) = action::action_read(&rows, 30, 41 + fi as u32, 2); checked += 1;
        if !(a.rate == a.null_mean && a.null_sd == Some(0.0) && a.z == Some(0.0)) && pn2_bad.is_none() { pn2_bad = Some(json!({ "n": n, "frac": frac, "cell": cell, "rate": a.rate, "null_mean": a.null_mean, "null_sd": a.null_sd, "z": a.z })); }
    } } }
    let pn2 = Check { id: "PN2", name: "action-null-is-an-exact-permutation", domain: "rows 20..=100 step 8 × 4 hit fractions × 3 target cells, all targets identical (132 reads)".into(), checked, holds: pn2_bad.is_none(), counterexample: pn2_bad.unwrap_or(Value::Null), note: "constant targets: null mean == rate, sd 0, z 0 — the null is a permutation of the targets, never an estimate".into() };
    let mut checked3 = 0u64; let mut pn3_bad: Option<Value> = None;
    for d in 1..=40usize {
        let rows: Vec<action::Row> = (0..400).map(|i| { let t = [((i % d) % 12) as i64, ((i % d) / 12) as i64]; action::Row { i: i * 2, fin: t, target: t } }).collect();
        let (a, _) = action::action_read(&rows, 20, 41, 2); checked3 += 1;
        let should = d >= 20;   // the SPEC's number (§8.30, KR23), written here and not read from the crate — a check that reads the constant it guards cannot go red when the constant moves (seen 2026-09-16: M1 stayed green)
        if a.measured != should || a.distinct_targets != d { if pn3_bad.is_none() { pn3_bad = Some(json!({ "d": d, "measured": a.measured, "distinct": a.distinct_targets, "z": a.z })); } }
    }
    let pn3 = Check { id: "PN3", name: "unmeasured-below-20-distinct-targets", domain: "400 rows over d = 1..=40 distinct target cells, placements == targets (z maximal)".into(), checked: checked3, holds: pn3_bad.is_none(), counterexample: pn3_bad.unwrap_or(Value::Null), note: format!("measured iff distinct ≥ {} — KR23: six commits wore the n of 1,752 rows", action::MIN_DISTINCT_TARGETS) };
    let mut checked_n3 = 0u64; let mut n3_bad: Option<Value> = None;
    for n in 1..=64usize { for k in 1..=16u32 {
        let mut v: Vec<i64> = (0..n as i64).collect(); let before = v.clone(); let mut rng = action::Lcg32(7 + 97 * k);
        action::shuffle_in_place(&mut v, &mut rng); checked_n3 += 1;
        let mut s = v.clone(); s.sort(); if s != before && n3_bad.is_none() { n3_bad = Some(json!({ "n": n, "k": k })); }
    } }
    let n3 = Check { id: "N3", name: "action-null-draw-is-a-permutation", domain: "sizes 1..=64 × 16 seeds (1,024 shuffles of the action null)".into(), checked: checked_n3, holds: n3_bad.is_none(), counterexample: n3_bad.unwrap_or(Value::Null), note: "every draw keeps the target multiset".into() };
    (pn2, pn3, n3)
}

// ── A5 / A6 · the window ───────────────────────────────────────────────────────────────────────────────────────────
// A fixed text with 1-, 2-, 3- and 4-byte characters, every budget from 0 to len+8. `pick_window` slides six candidate
// windows and keeps the densest, so every start offset the code can pick is exercised for every budget.
fn check_window() -> (Check, Check) {
    let text = "abc é 日本語 🙂 the quick brown fox jumps over the lazy dog — ünïcödé ends 日 here 🙂!";
    let mut checked = 0u64; let mut panics: Option<Value> = None; let mut over: Option<Value> = None;
    for budget in 0..=(text.len() + 8) {
        let r = std::panic::catch_unwind(|| aperture::pick_window(text, budget));
        checked += 1;
        match r {
            Err(_) => { if panics.is_none() { panics = Some(json!({ "budget": budget })); } }
            Ok(w) => {
                let sub = text.contains(w.as_str());
                let within = text.len() <= budget || w.len() <= budget;
                if !(sub && within) && over.is_none() { over = Some(json!({ "budget": budget, "window_len": w.len(), "is_substring": sub })); }
            }
        }
    }
    let dom = format!("one {}-byte text with 1/2/3/4-byte chars × every budget 0..={}", text.len(), text.len() + 8);
    let a5 = Check { id: "A5", name: "window-never-panics", domain: dom.clone(), checked, holds: panics.is_none(), counterexample: panics.unwrap_or(Value::Null), note: "every call returned".into() };
    let a6 = Check { id: "A6", name: "window-within-budget", domain: dom, checked, holds: over.is_none(), counterexample: over.unwrap_or(Value::Null),
        note: "result is a substring and, when the text exceeds the budget, no longer than it".into() };
    (a5, a6)
}

// ── A1–A4 · the aperture, over a grid of single-doc sides ──────────────────────────────────────────────────────────
fn check_aperture() -> (Check, Check, Check, Check) {
    let lens_: [usize; 6] = [0, 50, 200, 300, 1000, 5000];
    let kinds = ["low", "high"];
    let tol = 1.25f64;
    let mut checked = 0u64;
    let (mut a1_bad, mut a2_bad, mut a3_bad) = (None::<Value>, None::<Value>, None::<Value>);
    let (mut w_matched_not_adm, mut w_adm_not_matched) = (0u64, 0u64);
    let mut first_witness: Option<Value> = None;
    for (ki, ik) in kinds.iter().enumerate() { for (kr, rk) in kinds.iter().enumerate() { for &il in &lens_ { for &rl in &lens_ {
        let it = if *ik == "low" { low_text(il) } else { lcg_text(11 + ki as u64, il) };
        let rt = if *rk == "low" { low_text(rl) } else { lcg_text(97 + kr as u64, rl) };
        let intent = vec![Doc { path: "intent.txt".into(), text: it.clone() }];
        let reality = vec![Doc { path: "reality.txt".into(), text: rt.clone() }];
        let out = aperture::match_aperture(&intent, &reality, tol);
        checked += 1;
        let case = json!({ "intent": { "kind": ik, "bytes": il }, "reality": { "kind": rk, "bytes": rl } });
        // A1: cut, never grow — every row used ≤ raw, and the used text is a substring of its source
        let grew = out.rows.iter().any(|r| r.used_bytes > r.raw_bytes) || !it.contains(out.intent.as_str()) || !rt.contains(out.reality.as_str());
        if grew && a1_bad.is_none() { a1_bad = Some(json!({ "case": case, "rows": out.rows.iter().map(|r| json!({ "side": r.side, "raw": r.raw_bytes, "used": r.used_bytes })).collect::<Vec<_>>() })); }
        // A2: matched ⇒ usedRatio ≤ tol × 1.6
        if out.matched && !(out.used_ratio <= tol * 1.6) && a2_bad.is_none() { a2_bad = Some(json!({ "case": case, "usedRatio": out.used_ratio })); }
        // A3: admissible ⇒ both gzip ≥ floor
        if out.admissible && !(out.intent_gzip >= aperture::MIN_GZIP_BYTES && out.reality_gzip >= aperture::MIN_GZIP_BYTES) && a3_bad.is_none() { a3_bad = Some(json!({ "case": case, "intentGzip": out.intent_gzip, "realityGzip": out.reality_gzip })); }
        // A4: the two verdicts are independent — count both directions
        if out.matched && !out.admissible { w_matched_not_adm += 1; if first_witness.is_none() { first_witness = Some(json!({ "case": case, "matched": true, "admissible": false, "gz": [out.intent_gzip, out.reality_gzip] })); } }
        if out.admissible && !out.matched { w_adm_not_matched += 1; }
    } } } }
    let dom = format!("single-doc sides · bytes ∈ {:?} × kind ∈ {{low-entropy, LCG}} per side · tolerance {} → {} pairs", lens_, tol, checked);
    let a1 = Check { id: "A1", name: "cut-never-grow", domain: dom.clone(), checked, holds: a1_bad.is_none(), counterexample: a1_bad.unwrap_or(Value::Null), note: "used ≤ raw on every row and the used text is a substring of its source".into() };
    let a2 = Check { id: "A2", name: "matched-means-ratio", domain: dom.clone(), checked, holds: a2_bad.is_none(), counterexample: a2_bad.unwrap_or(Value::Null), note: format!("matched ⇒ usedRatio ≤ {}", tol * 1.6) };
    let a3 = Check { id: "A3", name: "admissible-means-floor", domain: dom.clone(), checked, holds: a3_bad.is_none(), counterexample: a3_bad.unwrap_or(Value::Null), note: format!("admissible ⇒ both gzip ≥ {}", aperture::MIN_GZIP_BYTES) };
    // A4 is a reachability claim in two directions; it HOLDS only if both directions have a witness on the domain.
    // If one direction has none, the counterexample says which — a claim of independence that only ever runs one way
    // is half a claim, and the ledger must say so.
    let a4 = Check { id: "A4", name: "two-verdicts-independent", domain: dom, checked, holds: w_matched_not_adm > 0 && w_adm_not_matched > 0,
        counterexample: if w_matched_not_adm > 0 && w_adm_not_matched > 0 { Value::Null } else { json!({ "witnesses_matched_not_admissible": w_matched_not_adm, "witnesses_admissible_not_matched": w_adm_not_matched, "first_witness": first_witness }) },
        note: format!("witnesses: matched∧¬admissible {} · admissible∧¬matched {}", w_matched_not_adm, w_adm_not_matched) };
    (a1, a2, a3, a4)
}

// ── V1–V4 · THE VOLATILITY READ (KR34, spec §8.32) ─────────────────────────────────────────────────────────────────
// "Black-Scholes for competence": a contract on a room's work priced from the DISPERSION of its placements against the
// declared lane, without knowing whether the work was good. The pricing claim has a machine half and a measured half;
// this is the machine half, and it is exactly the Black-Scholes SHAPE — the estimator's value must not depend on the
// LEVEL (V1), must be a function of the window's multiset and not its arrival order (V2), its null must be an exact
// permutation of the dispersion labels (V3), and a tertile cell thin in distinct commits must refuse to be read (V4).
// Every check drives volatility::window_vol / null_draw / effect_read — the functions the live read runs, never a copy.

/// the fixture windows. TWO FAMILIES, kept apart on purpose. Q is the quarter grid, where x, c, x + c and
/// (x + c) − (x₀ + c) are all exactly representable, so a shift cancels with no rounding at all — that is where the
/// bit-for-bit claim is made. R is the tape's own two-decimal σ range, where 1.74 is already a rounded binary
/// fraction and a large shift can move the last ulp; R rides beside the verdict as a reported arm, never pooled into
/// it, so the exact boundary of the claim is printed every run instead of being quietly assumed away.
fn kr34_windows(quarter: bool) -> Vec<Vec<f64>> {
    let mut out: Vec<Vec<f64>> = Vec::new();
    let mut s: u64 = if quarter { 12345 } else { 67890 };
    let mut nxt = || { s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (s >> 33) as u32 };
    for n in 4..=8usize { for _ in 0..4 {
        let w: Vec<f64> = (0..n).map(|_| if quarter { (1 + (nxt() % 32)) as f64 * 0.25 } else { ((100 + nxt() % 200) as f64) / 100.0 }).collect();
        out.push(w);
    } }
    out
}

/// how many ulps apart two f64 of the same sign are — the reported arm's unit
fn ulps(a: f64, b: f64) -> u64 { let (x, y) = (a.to_bits(), b.to_bits()); if x > y { x - y } else { y - x } }

// V1 · the estimator prices the SPREAD, never the LEVEL. σ(x + c) is the same f64 as σ(x) for every window on the
// quarter grid and every shift on the grid — bit-for-bit, not "to rounding". This is the sentence "the drift drops
// out of the price", written so it can go red: the one-token mutation `+ c` → `* c` scales instead of shifting and
// the check refutes. WHAT IT IS NOT: a claim about arbitrary f64. On the two-decimal arm the inputs are already
// rounded binary fractions and a shift of 8 can move the last ulp; that arm's worst case is printed beside the
// verdict, because a property whose domain is left vague is the projection failure it exists to prevent.
fn check_level_invariance() -> Check {
    let cs: [f64; 13] = [-8.0, -4.0, -2.0, -1.0, -0.5, -0.25, 0.0, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
    let arm = |ws: &Vec<Vec<f64>>| {
        let mut checked = 0u64; let mut bad: Option<Value> = None; let mut worst = 0u64; let mut inexact = 0u64;
        for w in ws {
            let v0 = volatility::window_vol(w);
            for &c in &cs {
                let shifted: Vec<f64> = w.iter().map(|x| x + c).collect();
                let v1 = volatility::window_vol(&shifted);
                checked += 1;
                if v1.to_bits() != v0.to_bits() {
                    inexact += 1; worst = worst.max(ulps(v0, v1));
                    if bad.is_none() { bad = Some(json!({ "window": w, "c": c, "vol": v0, "vol_shifted": v1, "ulps": ulps(v0, v1) })); }
                }
            }
        }
        (checked, bad, worst, inexact)
    };
    let q = kr34_windows(true); let r = kr34_windows(false);
    let (checked, bad, _wq, _iq) = arm(&q);
    let (checked_r, bad_r, worst_r, inexact_r) = arm(&r);
    Check { id: "V1", name: "vol-is-level-invariant", checked, holds: bad.is_none(),
        counterexample: json!({ "quarter_grid": bad.clone().unwrap_or(Value::Null),
                                "two_decimal_arm": { "checked": checked_r, "inexact": inexact_r, "worst_ulps": worst_r, "first": bad_r.unwrap_or(Value::Null) } }),
        domain: format!("{} quarter-grid windows (lengths 4..=8) × {} shifts {:?}, compared bit-for-bit", q.len(), cs.len(), cs),
        note: format!("σ(x + c) is the same f64 as σ(x) on the exact grid — the Black-Scholes shape: the level drops out of the price. Reported arm: {} two-decimal windows × the same shifts, {} of {} moved at all, worst {} ulp", r.len(), inexact_r, checked_r, worst_r) }
}

fn perm_of_5(r: usize) -> [usize; 5] {
    let facts = [24usize, 6, 2, 1, 1];
    let mut avail: Vec<usize> = (0..5).collect();
    let mut x = r; let mut out = [0usize; 5];
    for k in 0..5 { let f = facts[k]; let j = (x / f).min(avail.len() - 1); x %= f; out[k] = avail.remove(j); }
    out
}

// V2 · the estimator is a function of the window's MULTISET. All 120 permutations of each 5-element base window give
// the identical f64 — because window_vol canonicalises (sorts) before it sums. A float sum in arrival order would be
// permutation-invariant only to rounding, and "only to rounding" is the crack a ratchet falls through. Mutation:
// volatility::window_vol's `canon(xs)` → `xs.to_vec()` drops the canonical order and the check refutes.
fn check_perm_invariance() -> Check {
    let bases: Vec<Vec<f64>> = vec![
        vec![0.25, 1.5, 2.75, 0.5, 3.0],
        vec![1.73, 1.63, 1.2, 2.41, 0.97],
        vec![1.0, 1.0, 1.0, 1.0, 1.0],
        vec![0.01, 12.5, 0.3, 7.125, 0.0625],
        vec![2.0, 2.0, 2.0000000001, 1.9999999999, 2.0],
        vec![1.11, 2.22, 3.33, 4.44, 5.55],
    ];
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for base in &bases {
        let v0 = volatility::window_vol(base);
        for r in 0..120usize {
            let p = perm_of_5(r);
            let w: Vec<f64> = p.iter().map(|&j| base[j]).collect();
            let v = volatility::window_vol(&w);
            checked += 1;
            if v.to_bits() != v0.to_bits() && bad.is_none() { bad = Some(json!({ "base": base, "perm": p, "vol": v0, "vol_permuted": v })); }
        }
    }
    Check { id: "V2", name: "vol-is-permutation-invariant", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: format!("{} five-element base windows × all 120 permutations each, compared bit-for-bit", bases.len()),
        note: "the window's arrival order cannot move the number: the estimator reads the multiset".into() }
}

// V3 · the null is an EXACT PERMUTATION of the dispersion labels, like N3 for the action read. Every draw keeps the
// sorted σ multiset, so the null asks "this dispersion, attached to a different commit" and never invents a value.
// Mutation: `null_draw(&base, …)` → `null_draw(&base[1..], …)` drops one label and the check refutes.
fn check_vol_null_is_a_permutation() -> Check {
    let mut checked = 0u64; let mut bad: Option<Value> = None; let mut moved = 0u64;
    for n in 1..=64usize {
        let base: Vec<f64> = (0..n).map(|i| 1.0 + i as f64 * 0.01).collect();
        let before = volatility::canon(&base);
        for k in 1..=16u32 {
            let mut rng = action::Lcg32(7 + 97 * k);
            let draw = volatility::null_draw(&base, &mut rng);
            checked += 1;
            if draw != base { moved += 1; }
            if volatility::canon(&draw) != before && bad.is_none() { bad = Some(json!({ "n": n, "k": k, "in": before.len(), "out": draw.len() })); }
        }
    }
    Check { id: "V3", name: "vol-null-draw-is-a-permutation", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "σ-label vectors of size 1..=64 × 16 seeds (1,024 null draws of the volatility read)".into(),
        note: format!("every draw kept the σ multiset; {} of {} draws actually moved a label", moved, checked) }
}

// V4 · THE HURDLE. A tertile cell holding fewer than MIN_DISTINCT_COMMITS distinct commits is UNMEASURED however large
// its z — PN3 carried across from the action read (KR23: six commits wore the n of 1,752 rows). The top tertile is n/3,
// so n = 57..59 puts 19 distinct commits in it and n = 60 puts 20: the hurdle is crossed inside the domain, not near it.
// The 20 is the SPEC's number, written here and NOT read from the crate — a check that reads the constant it guards
// cannot go red when the constant moves. Mutation: the first `>= 20` → `>= 19` and the check refutes at n = 57.
fn check_distinct_commit_hurdle() -> Check {
    let mut checked = 0u64; let mut bad: Option<Value> = None; let mut crossings = 0u64; let mut prev: Option<bool> = None;
    for n in 30..=90usize {
        let rows: Vec<volatility::Row> = (0..n).map(|i| volatility::Row {
            i, reff: format!("c{:04}", i), room: "architect".into(), mu: ((i % 7) as f64) * 0.1, vol: ((i * 37) % n) as f64 * 0.01, y: ((i % 5) == 0) as u8 as f64 }).collect();
        let mut rng = action::Lcg32(41);
        let c = volatility::effect_read(&rows, volatility::Key::Vol, 10, volatility::Split::Tertile, &mut rng);
        let top = n / 3; let rest = n - top;
        let should = top >= 20 && rest >= 20;
        checked += 1;
        if let Some(p) = prev { if p != should { crossings += 1; } }
        prev = Some(should);
        if (c.measured != should || c.n_top != top || c.distinct_commits_top != top || c.distinct_commits_rest != rest) && bad.is_none() {
            bad = Some(json!({ "n": n, "measured": c.measured, "expected": should, "n_top": c.n_top, "top": top, "distinct_top": c.distinct_commits_top, "distinct_rest": c.distinct_commits_rest }));
        }
    }
    Check { id: "V4", name: "unmeasured-below-20-distinct-commits", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "n = 30..=90 commits, every ref distinct, top tertile = n/3 (19 distinct at n = 57..59, 20 at n = 60)".into(),
        note: format!("measured iff both cells hold ≥ {} distinct commits; the hurdle is crossed {} time(s) inside the domain", volatility::MIN_DISTINCT_COMMITS, crossings) }
}

// V5 · THE WITHIN-ROOM NULL KEEPS EVERY ROOM'S LABELS. Rooms are a confound — architect, laboratory and voice
// contribute different volumes AND differ in both μ and their fix rate — so a permutation across ALL commits can spend
// a between-room difference as a σ or μ effect. The within-room null permutes labels only inside a room (rooms under
// MIN_ROOM_ROWS pooled into one "other" stratum), and the property is that every stratum's sorted label multiset comes
// back unchanged from every draw. Mutation: `null_draw_within_room(&vals, &groups, …)` → `null_draw(&vals, …)` and the
// check refutes the moment two strata hold distinguishable labels.
fn check_within_room_null() -> Check {
    let mut checked = 0u64; let mut bad: Option<Value> = None; let mut moved = 0u64; let mut strata_seen = 0u64;
    for rooms_n in 1..=4usize {
        for n in 2..=12usize {
            let rooms: Vec<String> = (0..n).map(|i| format!("room{}", i % rooms_n)).collect();
            let refs: Vec<&str> = rooms.iter().map(|s| s.as_str()).collect();
            // labels are tagged by room, so a label that crosses a stratum boundary is visible in the multiset
            let vals: Vec<f64> = (0..n).map(|i| ((i % rooms_n) + 1) as f64 * 100.0 + i as f64).collect();
            for &min_room in &[1usize, volatility::MIN_ROOM_ROWS] {
                let (groups, _pooled) = volatility::room_groups(&refs, min_room);
                strata_seen += groups.len() as u64;
                for k in 1..=16u32 {
                    let mut rng = action::Lcg32(7 + 97 * k);
                    let draw = volatility::null_draw_within_room(&vals, &groups, &mut rng);
                    checked += 1;
                    if draw != vals { moved += 1; }
                    for g in &groups {
                        let before = volatility::canon(&g.iter().map(|&i| vals[i]).collect::<Vec<f64>>());
                        let after = volatility::canon(&g.iter().map(|&i| draw[i]).collect::<Vec<f64>>());
                        if before != after && bad.is_none() {
                            bad = Some(json!({ "rooms": rooms_n, "n": n, "min_room": min_room, "k": k, "stratum": g, "before": before, "after": after }));
                        }
                    }
                }
            }
        }
    }
    Check { id: "V5", name: "within-room-null-preserves-room-multisets", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: format!("{} draws: 1..=4 rooms × n = 2..=12 rows round-robin × min_room ∈ {{1, {}}} × 16 seeds, labels tagged by room", checked, volatility::MIN_ROOM_ROWS),
        note: format!("every stratum came back with its own label multiset; {} of {} draws moved a label at all, {} strata enumerated", moved, checked, strata_seen) }
}

// ── E1-E5 · KR40/KR43 ARITHMETIC IN THE CRATE (spec §8.58 stub) ────────────────────────────────────────────────────
// The port of scripts/pmu/units.mjs's registry and scripts/pmu/kr40-cost-envelope.mjs / kr43-no-arbitrage.mjs's
// replication / fair-price / no-arbitrage arithmetic into envelope.rs, driven by --envelope-read. E1/E2 are
// properties of the arithmetic itself; E3-E5 are properties of the lane read built on it, mirroring
// kr43-no-arbitrage.test.mjs's NA-4/NA-5 and kr40-cost-envelope.test.mjs's U-7 fixture exactly, so a fixture that
// already caught one real defect (U-7: the lane total divided by Y alone, reported as "per commit") keeps
// catching it here. E6 (PARITY on the real files) is a JS-side MEASURED reading, not proved in this file.

// values compared here are already rounded to 6 decimals (r6), so an absolute bound can sit exactly on the
// rounding boundary — `rel` compares RELATIVELY (mirrors kr43-no-arbitrage.test.mjs's `near`); `abs` is for
// quantities that are not pre-rounded (e.g. a B that must not move with Y at all).
fn close_opt(a: Option<f64>, b: Option<f64>, eps: f64) -> bool {
    match (a, b) { (Some(x), Some(y)) => (x - y).abs() <= eps, (None, None) => true, _ => false }
}
fn near_opt(a: Option<f64>, b: Option<f64>, rel: f64) -> bool {
    match (a, b) { (Some(x), Some(y)) => (x - y).abs() <= rel * y.abs().max(1.0), (None, None) => true, _ => false }
}

// E1 · the mul/div/add registry, mirrored from scripts/pmu/units.mjs MUL_RULES / DIV_RULES INDEPENDENTLY of
// envelope.rs's own match arms (so this check cannot pass by comparing the implementation to itself) — every pair
// of the 8 named units, for each of the three operators, must agree with the table below or refuse. Mutation:
// envelope::div's `(Usd, Usd) => Dimensionless` arm removed — the check refutes at (usd, usd) (2026-09-17).
fn check_unit_registry() -> Check {
    let units = Unit::all();
    let mul_ok: [(Unit, Unit, Unit); 11] = [
        (Unit::Tokens, Unit::UsdPerToken, Unit::Usd), (Unit::UsdPerToken, Unit::Tokens, Unit::Usd),
        (Unit::Minutes, Unit::UsdPerMinute, Unit::Usd), (Unit::UsdPerMinute, Unit::Minutes, Unit::Usd),
        (Unit::Usd, Unit::Dimensionless, Unit::Usd), (Unit::Dimensionless, Unit::Usd, Unit::Usd),
        (Unit::Tokens, Unit::Dimensionless, Unit::Tokens), (Unit::Dimensionless, Unit::Tokens, Unit::Tokens),
        (Unit::Minutes, Unit::Dimensionless, Unit::Minutes), (Unit::Dimensionless, Unit::Minutes, Unit::Minutes),
        (Unit::Dimensionless, Unit::Dimensionless, Unit::Dimensionless),
    ];
    let div_ok: [(Unit, Unit, Unit); 10] = [
        (Unit::Usd, Unit::UsdPerMinute, Unit::Minutes), (Unit::Usd, Unit::Minutes, Unit::UsdPerMinute),
        (Unit::UsdPerHour, Unit::Dimensionless, Unit::UsdPerMinute),
        (Unit::Tokens, Unit::Dimensionless, Unit::Tokens), (Unit::Minutes, Unit::Dimensionless, Unit::Minutes),
        (Unit::Usd, Unit::Dimensionless, Unit::Usd), (Unit::Calls, Unit::Dimensionless, Unit::Calls),
        (Unit::UsdPerHour, Unit::UsdPerHour, Unit::Dimensionless), (Unit::Usd, Unit::Usd, Unit::Dimensionless),
        (Unit::Tokens, Unit::Tokens, Unit::Dimensionless),
    ];
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for &a in &units { for &b in &units {
        checked += 1;
        let expect_mul = mul_ok.iter().find(|(x, y, _)| *x == a && *y == b).map(|(_, _, u)| *u);
        let got = envelope::mul(envelope::tag(2.0, a), envelope::tag(3.0, b)).ok().map(|q| q.unit);
        if got != expect_mul && bad.is_none() { bad = Some(json!({ "op": "mul", "a": a.name(), "b": b.name(), "expected": expect_mul.map(|u| u.name()), "got": got.map(|u| u.name()) })); }
        checked += 1;
        let expect_div = div_ok.iter().find(|(x, y, _)| *x == a && *y == b).map(|(_, _, u)| *u);
        let got_div = envelope::div(envelope::tag(6.0, a), envelope::tag(2.0, b)).ok().map(|q| q.unit);
        if got_div != expect_div && bad.is_none() { bad = Some(json!({ "op": "div", "a": a.name(), "b": b.name(), "expected": expect_div.map(|u| u.name()), "got": got_div.map(|u| u.name()) })); }
        checked += 1;
        let expect_add = if a == b { Some(a) } else { None };
        let got_add = envelope::add(envelope::tag(2.0, a), envelope::tag(3.0, b)).ok().map(|q| q.unit);
        if got_add != expect_add && bad.is_none() { bad = Some(json!({ "op": "add", "a": a.name(), "b": b.name(), "expected": expect_add.map(|u| u.name()), "got": got_add.map(|u| u.name()) })); }
    } }
    Check { id: "E1", name: "unit-registry-matches-units-mjs", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: format!("{} units × {} units × {{mul, div, add}} = {} pairs, checked against a table mirrored from units.mjs MUL_RULES/DIV_RULES", units.len(), units.len(), checked),
        note: "tokens + minutes has no rule and refuses on every op; usd/usd → dimensionless is the one KR43 needs for R and B".into() }
}

// E2 · NO DOLLAR WITHOUT A DATE — mirrors units.mjs's U-2 test fixtures (a dollar with no date; null-but-present
// as_of/source; dated and clean; nested two levels down; a field with no dollar-shaped name at all). Mutation:
// is_dollar_key's `wage_minutes` substring check removed — the check refutes on fixture 2 (2026-09-17).
fn check_no_dollar_without_date() -> Check {
    let cases: [(&str, Value, bool); 6] = [
        ("bare dollar, no date", json!({ "lane": { "dollars_per_pass": 1.23 } }), false),
        ("wage_minutes, as_of/source present but null", json!({ "conversion": { "wage_minutes_per_pass": 4.5, "as_of": null, "source": null } }), false),
        ("dated and sourced, clean", json!({ "conversion": { "dollars_per_pass": 1.23, "wage_minutes_per_pass": 4.5, "as_of": "2026-09-17", "source": "x" } }), true),
        ("nested two levels down, no date at its own level", json!({ "overall": { "by_lane": { "blog": { "usd_per_hour_equivalent": 9.9 } } } }), false),
        ("usd_per_commit, dated", json!({ "x": { "usd_per_commit": 1.0, "as_of": "2026-09-17", "source": "y" } }), true),
        ("no dollar-shaped key at all", json!({ "x": { "count_of_things": 1.0 } }), true),
    ];
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for (label, fixture, should_be_clean) in &cases {
        checked += 1;
        let violations = envelope::assert_no_dollar_without_date(fixture);
        let is_clean = violations.is_empty();
        if is_clean != *should_be_clean && bad.is_none() { bad = Some(json!({ "case": label, "expected_clean": should_be_clean, "violations": violations })); }
    }
    Check { id: "E2", name: "no-dollar-without-a-date", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: format!("{} written-json fixtures (dated/undated, null-but-present, nested, dollars-shaped and not)", cases.len()),
        note: "a dollar/wage_minutes-shaped number is flagged unless a non-null as_of AND source sit in the SAME object".into() }
}

/// the NA-4/NA-5 fixture, verbatim from kr43-no-arbitrage.test.mjs: 10 commits, 1.1M tokens at $(1,10)/M × k,
/// 6 minutes at $60/h × k, a $100-400 × k × market_k market price, n = 3 units per task.
fn envelope_fixture_env() -> Value { json!({ "commits": 10, "tokens_by_model": { "m": { "in": 1e6, "out": 1e5, "cache_read": 0 } }, "minutes_per_commit": { "median": 6 } }) }
fn envelope_fixture_table(k: f64, market_k: f64) -> Value {
    json!({ "as_of": "2026-09-17", "source": "fixture",
        "token_prices_per_million": { "m": { "input": 1.0 * k, "output": 10.0 * k, "cache_read": null } },
        "wage": { "per_hour": 60.0 * k, "source": "fixture-wage" },
        "market_prices": { "blog-post": { "usd_min": 100.0 * k * market_k, "usd_max": 400.0 * k * market_k, "unit": "usd_per_task", "source": "fixture-market", "source_date": "2026-09-01", "provenance": "secondary" } },
        "lane_task_class": { "blog-content": "blog-post" },
        "units_per_task": { "blog-post": { "n": 3, "source": "fixture" } } })
}

// E3 · HOMOGENEITY (mirrors NA-4). Every dated price × k leaves R and B unchanged; the market price ALONE × k
// divides R by k and multiplies B by k. Mutation: lane_read stops re-deriving F from the scaled C (uses the base
// C) — the "all prices × k" arm refutes at k = 2 (2026-09-17).
fn check_envelope_homogeneity() -> Check {
    let y_row = json!({ "Y": 0.5, "measured": true });
    let base = envelope::lane_read("blog-content", &envelope_fixture_env(), &y_row, &envelope_fixture_table(1.0, 1.0));
    let base_na = &base["no_arbitrage"];
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for &k in &[0.5f64, 2.0, 5.0, 10.0] {
        checked += 1;
        let all = envelope::lane_read("blog-content", &envelope_fixture_env(), &y_row, &envelope_fixture_table(k, 1.0));
        let ok = near_opt(base_na["R_at_min"].as_f64(), all["no_arbitrage"]["R_at_min"].as_f64(), 1e-5)
            && near_opt(base_na["B_at_max"].as_f64(), all["no_arbitrage"]["B_at_max"].as_f64(), 1e-5);
        if !ok && bad.is_none() { bad = Some(json!({ "k": k, "arm": "all_prices_scaled", "base": base_na, "scaled": all["no_arbitrage"] })); }
        checked += 1;
        let mk = envelope::lane_read("blog-content", &envelope_fixture_env(), &y_row, &envelope_fixture_table(1.0, k));
        let expect_r = base_na["R_at_min"].as_f64().map(|v| v / k);
        let expect_b = base_na["B_at_min"].as_f64().map(|v| v * k);
        let ok2 = near_opt(expect_r, mk["no_arbitrage"]["R_at_min"].as_f64(), 1e-5) && near_opt(expect_b, mk["no_arbitrage"]["B_at_min"].as_f64(), 1e-5);
        if !ok2 && bad.is_none() { bad = Some(json!({ "k": k, "arm": "market_alone_scaled", "expected_R": expect_r, "expected_B": expect_b, "got": mk["no_arbitrage"] })); }
    }
    Check { id: "E3", name: "envelope-homogeneity", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "4 scale factors (0.5, 2, 5, 10) × 2 arms (every dated price × k; market price alone × k) on the NA-4 fixture".into(),
        note: "scaling every dated price by k leaves R and B unchanged; scaling the market alone divides R by k and multiplies B by k".into() }
}

// E4 · MONOTONE IN Y (mirrors NA-5). Halving Y doubles R; B does not move (it needs no Y); Y = 0 reads UNMEASURED
// with a why, never Infinity or NaN. Mutation: fair_price_per_delivered's `v == 0.0` guard removed — Y = 0 divides
// by zero and the check refutes on the "never Infinity/NaN" leg (2026-09-17).
fn check_envelope_monotone_in_y() -> Check {
    let table = envelope_fixture_table(1.0, 1.0);
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for &y in &[0.05f64, 0.1, 0.2, 0.5] {
        checked += 1;
        let full = envelope::lane_read("blog-content", &envelope_fixture_env(), &json!({ "Y": y, "measured": true }), &table);
        let half = envelope::lane_read("blog-content", &envelope_fixture_env(), &json!({ "Y": y / 2.0, "measured": true }), &table);
        let r_ok = near_opt(half["no_arbitrage"]["R_at_max"].as_f64(), full["no_arbitrage"]["R_at_max"].as_f64().map(|v| v * 2.0), 1e-5);
        let b_ok = close_opt(half["no_arbitrage"]["B_at_max"].as_f64(), full["no_arbitrage"]["B_at_max"].as_f64(), 1e-9);
        if !(r_ok && b_ok) && bad.is_none() { bad = Some(json!({ "y": y, "full": full["no_arbitrage"], "half_y": half["no_arbitrage"] })); }
    }
    checked += 1;
    let zero = envelope::lane_read("blog-content", &envelope_fixture_env(), &json!({ "Y": 0.0, "measured": true }), &table);
    let text = serde_json::to_string(&zero).unwrap();
    let clean = zero["fair_price_per_delivered"]["unmeasured"] == json!(true) && zero["no_arbitrage"]["R_at_min"] == Value::Null
        && zero["no_arbitrage"]["B_at_min"].as_f64().map(|v| v.is_finite()).unwrap_or(false)
        && !text.contains("Infinity") && !text.contains("NaN");
    if !clean { bad = Some(json!({ "y": 0, "zero_read": zero })); }
    Check { id: "E4", name: "envelope-monotone-in-y", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "Y ∈ {0.05, 0.1, 0.2, 0.5} each halved, plus Y = 0, on the NA-4/5 fixture".into(),
        note: "halving Y doubles R; B does not move (it needs no Y); Y = 0 reads UNMEASURED with a why, never Infinity/NaN".into() }
}

// E5 · PER COMMIT BEFORE PER PASS (mirrors kr40's U-7 defect fixture exactly: 4 commits × 1,000 tokens at $1/M,
// Y 0.5 → $0.002 per pass, never $0.008). lane_dollars_per_commit divides by commits BEFORE per_pass_floor divides
// by Y — one door, never two ways to reach the same number. Mutation: `div(total, dimensionless(commits as f64))`
// → `Ok(total)` (skip the ÷ commits step) — the check refutes at every commits value except 1 (2026-09-17).
fn check_per_commit_before_per_pass() -> Check {
    let table = json!({ "as_of": "2026-09-17", "source": "fixture", "token_prices_per_million": { "m": { "input": 1.0, "output": 1.0, "cache_read": null } } });
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for &commits in &[1i64, 2, 4, 8] {
        let total_tokens = commits as f64 * 3000.0;
        let tbm = json!({ "m": { "in": total_tokens * 0.75, "out": total_tokens * 0.25, "cache_read": 0 } });
        let c = envelope::lane_dollars_per_commit(&tbm, commits, &table).unwrap();
        let expect_commit = (total_tokens / 1e6) / commits as f64;
        checked += 1;
        if (c.v - expect_commit).abs() > 1e-9 && bad.is_none() { bad = Some(json!({ "commits": commits, "expected_per_commit": expect_commit, "got": c.v })); }
        let f = envelope::per_pass_floor(c, 0.5).unwrap();
        let expect_pass = expect_commit / 0.5;
        checked += 1;
        if (f.v - expect_pass).abs() > 1e-9 && bad.is_none() { bad = Some(json!({ "commits": commits, "expected_per_pass": expect_pass, "got": f.v })); }
    }
    // the exact U-7 numbers, named
    let tbm = json!({ "m": { "in": 3000.0, "out": 1000.0, "cache_read": 0 } });
    let c = envelope::lane_dollars_per_commit(&tbm, 4, &table).unwrap();
    let f = envelope::per_pass_floor(c, 0.5).unwrap();
    checked += 1;
    if (c.v - 0.001).abs() > 1e-9 || (f.v - 0.002).abs() > 1e-9 { bad = Some(json!({ "u7_fixture": true, "dollars_per_commit": c.v, "dollars_per_pass": f.v, "expected": [0.001, 0.002], "was": 0.008 })); }
    Check { id: "E5", name: "per-commit-before-per-pass", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "commits ∈ {1,2,4,8} generalising the U-7 fixture, plus U-7 itself (4 commits × 1,000 tokens at $1/M, Y 0.5)".into(),
        note: "dollars_per_commit = lane total ÷ commits, computed before anything divides by Y; the historical defect (U-7) divided the lane total by Y alone and reported it as per-commit ($0.008 instead of $0.002)".into() }
}

// ── E7 · TYPE-STATE MONEY (spec §8.58 stub) ────────────────────────────────────────────────────
// E2 (above) is a runtime walk over the EMITTED json. E7 drives the TYPE-LEVEL guarantee's runtime
// half: envelope::PriceTable::parse must classify every table shape correctly (Unpinned iff
// as_of/source missing or null — never Pinned on an undated table, which is the half a JSON walk
// cannot see because there is no JSON to walk once the value never got made), and envelope::Yield
// must never let fair_price divide except under Positive, on a domain of yield values including
// zero, negative, NaN and infinite. The OTHER half of E7 (PriceTable::Unpinned has no `price`
// method — a compile error, not a runtime refusal) is not enumerable here; it is pinned by
// envelope.rs's doc comments and the compile-fail stub beside E8, named in this check's note.
fn check_type_state_money() -> Check {
    let tables: [(&str, Value, bool); 6] = [
        ("null", Value::Null, false),
        ("empty object", json!({}), false),
        ("as_of only", json!({ "as_of": "2026-09-17" }), false),
        ("source only", json!({ "source": "x" }), false),
        ("both null", json!({ "as_of": null, "source": null }), false),
        ("dated and sourced", json!({ "as_of": "2026-09-17", "source": "fixture", "token_prices_per_million": { "m": { "input": 1.0, "output": 10.0 } }, "wage": { "per_hour": 60.0 } }), true),
    ];
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for (label, t, should_pin) in &tables {
        checked += 1;
        let is_pinned = matches!(PriceTable::parse(t), PriceTable::Pinned(_));
        if is_pinned != *should_pin && bad.is_none() { bad = Some(json!({ "leg": "parse", "case": label, "expected_pinned": should_pin, "got_pinned": is_pinned })); }
    }
    // Yield classification + fair_price never divides except under Positive; never NaN/Infinity.
    let good = json!({ "as_of": "2026-09-17", "source": "fixture" });
    let pt = match PriceTable::parse(&good) { PriceTable::Pinned(pt) => pt, PriceTable::Unpinned { why } => { bad = Some(json!({ "leg": "setup", "why": why })); return Check { id: "E7", name: "type-state-money", checked, holds: false, counterexample: bad.unwrap(), domain: "setup".into(), note: "setup table failed to pin".into() }; } };
    let c = Dated { v: Usd(6.2), as_of: "2026-09-17".into(), source: "fixture".into() };
    for &yv in &[Some(0.5), Some(2.0), Some(0.0), None, Some(-1.0), Some(f64::NAN), Some(f64::INFINITY), Some(f64::NEG_INFINITY)] {
        checked += 1;
        let y = Yield::from_option(yv);
        let should_divide = matches!(y, Yield::Positive(_));
        let expected_positive = matches!(yv, Some(v) if v.is_finite() && v > 0.0);
        if should_divide != expected_positive && bad.is_none() { bad = Some(json!({ "leg": "classify", "y": format!("{:?}", yv), "expected_positive": expected_positive, "got_positive": should_divide })); }
        let r = pt.fair_price(&c, y);
        checked += 1;
        match (expected_positive, &r) {
            (true, Ok(d)) => { if !d.v.0.is_finite() && bad.is_none() { bad = Some(json!({ "leg": "finite", "y": format!("{:?}", yv), "result": d.v.0 })); } }
            (true, Err(e)) => { if bad.is_none() { bad = Some(json!({ "leg": "should-have-priced", "y": format!("{:?}", yv), "err": e.why })); } }
            (false, Ok(d)) => { if bad.is_none() { bad = Some(json!({ "leg": "should-have-refused", "y": format!("{:?}", yv), "got": d.v.0 })); } }
            (false, Err(_)) => {}
        }
    }
    Check { id: "E7", name: "type-state-money", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: format!("{} table shapes (parse classification) + 8 yield values {{0.5, 2.0, 0.0, None, -1.0, NaN, +Inf, -Inf}} (classification + fair_price)", tables.len()),
        note: "runtime half: parse never pins an undated table, fair_price never divides except under Yield::Positive and never returns NaN/Infinity. Type half (PriceTable::Unpinned has no price/fair_price/replication_cost_dated method — E0599 at compile time) is not enumerable here; see envelope.rs's PinnedTable doc comment and the e8_compile_fail_evidence_not_built stub".into() }
}

// ── E8 · THE UNIT REGISTRY IS EXHAUSTIVE OVER THE ENUM (spec §8.58 stub, extends E1) ───────────
// E1 (above) already enumerates all 8×8×3 = 192 pairs and shows mul/div/add agree with a table
// mirrored independently from units.mjs — that is "a test enumerating every pair", asked for
// verbatim, and E8 does not duplicate it. What E8 adds: `mul`/`div` in envelope.rs are now written
// as EXHAUSTIVE matches with NO wildcard `_` arm (every one of the 64 pairs named once, 11/10 in Ok
// arms and the rest grouped into one Err arm by an OR-pattern that still names each pair). That is a
// COMPILE-TIME property — rustc's own exhaustiveness checker refuses to build this crate at all if a
// 9th `Unit` variant is ever added without extending both matches, which is a stronger guarantee
// than any enumeration this check could run (an enumeration only samples the CURRENT domain; the
// exhaustiveness check re-verifies EVERY future domain on every build). This check does two things
// a runtime check legitimately can: (1) confirms `mul`/`div` still return Ok/Err for the full 64-pair
// domain (never panic — a total function, which is required for exhaustiveness to have been possible
// at all), and (2) inspects envelope.rs's OWN SOURCE (via `include_str!`, the same file this binary
// was built from) to confirm the `mul`/`div` function bodies carry no bare `_ =>` catch-all arm —
// the textual fact whose absence is what makes rustc's check meaningful rather than vacuous. If a
// wildcard is reintroduced, this check goes red immediately, without waiting for a 9th unit to exist.
fn check_unit_registry_is_exhaustive() -> Check {
    let units = Unit::all();
    let mut checked = 0u64; let mut bad: Option<Value> = None; let mut panics = 0u64;
    for &a in &units { for &b in &units {
        checked += 1;
        // totality: every pair returns (never panics) for both operators — a prerequisite for
        // "exhaustive" to mean anything (a partial function cannot be exhaustive over its domain).
        let rm = std::panic::catch_unwind(|| envelope::mul(envelope::tag(2.0, a), envelope::tag(3.0, b)));
        let rd = std::panic::catch_unwind(|| envelope::div(envelope::tag(6.0, a), envelope::tag(2.0, b)));
        if rm.is_err() { panics += 1; if bad.is_none() { bad = Some(json!({ "leg": "panic", "op": "mul", "a": a.name(), "b": b.name() })); } }
        if rd.is_err() { panics += 1; if bad.is_none() { bad = Some(json!({ "leg": "panic", "op": "div", "a": a.name(), "b": b.name() })); } }
    } }
    // source inspection: no wildcard arm inside `pub fn mul` / `pub fn div`'s bodies specifically
    // (not the whole file — `add`'s early-return guard and other functions are out of scope).
    let src = include_str!("envelope.rs");
    let slice_fn = |name: &str| -> Option<&str> {
        let start = src.find(&format!("pub fn {}(", name))?;
        let rest = &src[start..];
        let body_start = rest.find('{')?;
        let mut depth = 0i32; let mut end = None;
        for (i, ch) in rest[body_start..].char_indices() {
            match ch { '{' => depth += 1, '}' => { depth -= 1; if depth == 0 { end = Some(body_start + i + 1); break; } }, _ => {} }
        }
        end.map(|e| &rest[..e])
    };
    let mul_body = slice_fn("mul");
    let div_body = slice_fn("div");
    let no_wildcard = |body: Option<&str>| -> bool { match body { Some(b) => !b.contains("_ =>") && !b.contains("_=>"), None => false } };
    let mul_clean = no_wildcard(mul_body);
    let div_clean = no_wildcard(div_body);
    if !(mul_clean && div_clean) {
        bad = Some(json!({ "leg": "source-has-no-wildcard", "mul_body_found": mul_body.is_some(), "mul_no_wildcard": mul_clean, "div_body_found": div_body.is_some(), "div_no_wildcard": div_clean }));
    }
    // count the OR-grouped Err arm's pair mentions textually, as a sanity cross-check that the
    // exhaustive arm really does name all the pairs the loop above exercised (64 each) rather than
    // fewer pairs sitting behind a narrower-than-claimed OR-pattern.
    let count_pairs = |body: &str| -> usize { body.matches('(').count() };
    if let (Some(mb), Some(db)) = (mul_body, div_body) {
        let mul_pairs = count_pairs(mb); let div_pairs = count_pairs(db);
        // every arm line opens with one '(' for the tuple pattern (Ok arms) or more for grouped
        // Err arms sharing a line via '|' — a loose lower bound (64) rather than an exact count,
        // since some Ok arms also contain a nested tag(...) call adding its own '('.
        if mul_pairs < 64 || div_pairs < 64 { if bad.is_none() { bad = Some(json!({ "leg": "pair-count-lower-bound", "mul_open_parens": mul_pairs, "div_open_parens": div_pairs, "need_at_least": 64 })); } }
    }
    Check { id: "E8", name: "unit-registry-is-exhaustive-over-the-enum", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: format!("{} units × {} units = {} pairs (mul/div totality, runtime) + envelope.rs's own mul/div source bodies (no wildcard arm, textual)", units.len(), units.len(), checked),
        note: format!("{} panics over {} pair-calls (mul+div totality); extends E1's enumeration (already 192 pairs). E8's own claim is compile-time — mul/div carry no `_` arm, so cargo build refuses the crate outright if Unit gains a 9th variant without extending both matches. Seen to fail: a `_ => Err(...)` arm added back to mul → this check refutes on source-has-no-wildcard (2026-09-17)", panics, checked) }
}

// ── AP-R1/AP-R2 · KR39's APERTURE ARITHMETIC IN THE CRATE (whitespace ledger B4 stub) ──────────────────────────────
// The port of scripts/pmu/kr39-aperture.mjs's apertureCore arithmetic into aperture_read.rs, driven by
// --aperture-read. AP-R3 (PARITY on a fixture) is a JS-side MEASURED reading (tests/formal/kr39-aperture.test.mjs
// AP-R3), not proved in this file.

// AP-R1 · THE NULL IS A PERMUTATION OF THE LANE->PATHS ASSIGNMENT ONLY. The row's OWN pass (P_lane, computed via
// own[j] — the row's real declared-set index, never the permuted one) must be IDENTICAL whatever seed drives the
// null draws: only alpha (the null mean over the shuffled assignment) may move with the seed. touched, off_ok and
// calls_ok are read ONCE, outside the seed-dependent draw loop, and never touched again — this enumerates that
// invariant directly rather than trusting the source layout. Mutation: swapping which index (`own[j]` vs a shuffled
// one) `real_of`/`real_all_of` read from would make P_lane itself move with the seed, and this check refutes.
fn check_aperture_read_null_is_map_permutation_only() -> Check {
    let mut rows: Vec<aperture_read::Row> = Vec::new();
    for i in 0..40usize { rows.push(aperture_read::Row { i, session: format!("s{}", i), domain: "A".into(), delivered: vec!["x".into()], touched: vec![if i % 4 == 0 { "y/off".to_string() } else { format!("x/f{}", i) }], off_ok: true, calls_ok: true }); }
    for i in 0..40usize { rows.push(aperture_read::Row { i: 40 + i, session: format!("t{}", i), domain: "B".into(), delivered: vec!["y".into()], touched: vec![if i % 6 == 0 { "x/off".to_string() } else { format!("y/g{}", i) }], off_ok: true, calls_ok: true }); }
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    let mut base: Option<(f64, f64)> = None;   // (P_lane A, P_lane B) at the first seed
    for &seed in &[1u32, 2, 3, 5, 41, 300, 9999] {
        let core = aperture_read::aperture_core(&rows, 40, seed, &DEFAULT_BETAS);
        let pa = core["by_lane"]["A"]["betas"]["0"]["covenant"]["rate"].as_f64().unwrap();
        let pb = core["by_lane"]["B"]["betas"]["0"]["covenant"]["rate"].as_f64().unwrap();
        checked += 1;
        match base {
            None => base = Some((pa, pb)),
            Some((p0a, p0b)) => if (pa - p0a).abs() > 1e-12 || (pb - p0b).abs() > 1e-12 {
                if bad.is_none() { bad = Some(json!({ "seed": seed, "P_A": pa, "expected_P_A": p0a, "P_B": pb, "expected_P_B": p0b })); }
            }
        }
    }
    Check { id: "AP-R1", name: "aperture-null-is-a-permutation-of-the-map-only", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "80 rows (2 lanes x 40, mismatched touch patterns) x 7 seeds — P_lane read at beta 0".into(),
        note: "P_lane (the row's own-lane pass) never moved across 7 seeds that each drive a DIFFERENT null permutation — the touched/off_ok/calls_ok feeding the true read are consumed once, outside the seed-dependent draw loop, and only the null's shuffled assignment depends on the seed".into() }
}

// AP-R2 · A PINNED IDENTITY (2026-09-17 coordinator finding, kept as a proof rather than re-fought): fed rows whose
// touched set is EMPTY, breach_share returns 0 unconditionally against ANY candidate declared set, so passCovenant
// stops depending on which lane's paths were assigned at all — alpha_lane == P_lane EXACTLY, on every lane, every
// seed, every size. This is the crate's own arithmetic exhibiting the defect the JS driver's scoredRows exclusion
// (never re-implemented here) exists to prevent. Mutation: `breach_share` returning `Some(1.0)` instead of
// `Some(0.0)` on an empty touched set flips this identity and the check refutes.
fn check_aperture_read_all_touch_nothing_pins_alpha_equal_p() -> Check {
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for &n_per_lane in &[10usize, 20, 37] {
        for &seed in &[1u32, 41, 300] {
            let mut rows: Vec<aperture_read::Row> = Vec::new();
            for i in 0..n_per_lane { rows.push(aperture_read::Row { i, session: format!("s{}", i), domain: "L".into(), delivered: vec!["x".into()], touched: vec![], off_ok: true, calls_ok: true }); }
            for i in 0..n_per_lane { rows.push(aperture_read::Row { i: n_per_lane + i, session: format!("t{}", i), domain: "M".into(), delivered: vec!["y".into()], touched: vec![], off_ok: true, calls_ok: true }); }
            let core = aperture_read::aperture_core(&rows, 30, seed, &DEFAULT_BETAS);
            for lane in ["L", "M"] {
                checked += 1;
                let cell = &core["by_lane"][lane]["betas"]["0"]["covenant"];
                let rate = cell["rate"].as_f64(); let alpha = cell["alpha"].as_f64();
                if rate != alpha && bad.is_none() { bad = Some(json!({ "n_per_lane": n_per_lane, "seed": seed, "lane": lane, "rate": rate, "alpha": alpha })); }
            }
        }
    }
    Check { id: "AP-R2", name: "aperture-no-touch-pins-alpha-equal-p", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "2 lanes x {10,20,37} rows-per-lane x 3 seeds, every row's touched set empty".into(),
        note: "alpha == P exactly on every one of 18 (size, seed) combinations x 2 lanes — the exact defect the coordinator found on the pre-correction live record".into() }
}

// ── SW-R1/SW-R2 · KR41's STEERING-WORK ARITHMETIC IN THE CRATE (whitespace ledger B4 stub) ─────────────────────────
// The port of scripts/pmu/kr41-steering-work.mjs's laneRead arithmetic into steering_read.rs, driven by
// --steering-read. SW-R3 (PARITY on a fixture) is a JS-side MEASURED reading (tests/formal/kr41-steering-work.test.mjs
// SW-R3), not proved in this file.

// SW-R1 · KL >= 0 ALWAYS, AND (NUMERICALLY) 0 IFF THE TWO DISTRIBUTIONS ARE IDENTICAL — Gibbs' inequality on two
// Laplace-smoothed, strictly positive distributions. Mutation: `p[i] * (p[i]/q[i]).ln()` -> `p[i] - q[i]` produces a
// signed quantity that goes negative on several fixture pairs, and this check refutes.
fn check_steering_kl_nonneg_and_zero_iff_identical() -> Check {
    let fixtures: [&[(usize, usize)]; 5] = [&[(0, 0), (1, 1)], &[(3, 4), (3, 4), (5, 5)], &[(11, 11)], &[(0, 0), (0, 1), (1, 0), (1, 1)], &[(2, 2), (2, 2), (2, 2)]];
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for f1 in &fixtures { for f2 in &fixtures {
        let p = steering_read::smoothed_dist(&steering_read::histogram(f1), steering_read::DEFAULT_PSEUDO);
        let q = steering_read::smoothed_dist(&steering_read::histogram(f2), steering_read::DEFAULT_PSEUDO);
        let kl = steering_read::kl_divergence(&p, &q);
        checked += 1;
        if kl < -1e-9 && bad.is_none() { bad = Some(json!({ "f1": format!("{:?}", f1), "f2": format!("{:?}", f2), "kl": kl, "violation": "negative" })); }
        if std::ptr::eq(f1, f2) && kl.abs() > 1e-9 && bad.is_none() { bad = Some(json!({ "f1": format!("{:?}", f1), "kl": kl, "violation": "not zero on self" })); }
    } }
    Check { id: "SW-R1", name: "steering-kl-nonnegative-and-zero-iff-identical", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: format!("{} fixture cell-lists x {} = {} smoothed-distribution pairs", fixtures.len(), fixtures.len(), fixtures.len() * fixtures.len()),
        note: "every pair read KL >= 0 (Gibbs' inequality on two strictly-positive, Laplace-smoothed distributions); every distribution against itself read (numerically) zero".into() }
}

// SW-R2 · THE PAIRING-PERMUTATION NULL LEAVES BOTH MARGINALS INVARIANT — a permutation of pairing never changes the
// multiset of walk cells or of inertia cells, so for a purely marginal statistic (KL/JS) null_mean == rate EXACTLY
// and null_sd == 0, on every measured half, pooled and within-room, whatever the seed. Mutation: `shuffle_in_place`
// replaced with a fresh random resample (with replacement) in the pooled null's draw loop would let a draw's
// histogram differ from the real one even in total mass, and this check refutes.
fn check_steering_pairing_null_degenerate_by_identity() -> Check {
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for &seed in &[1u32, 41, 99] {
        for &n in &[20usize, 25, 40] {
            let rows: Vec<steering_read::Row> = (0..n).map(|i| steering_read::Row { reff: format!("c{}", i), room: if i % 2 == 0 { "architect".into() } else { "voice".into() }, walk: (i % steering_read::GRID, (i * 3) % steering_read::GRID), inertia: ((i + 5) % steering_read::GRID, (i * 7) % steering_read::GRID) }).collect();
            let out = steering_read::lane_read(&rows, 40, seed, steering_read::DEFAULT_PSEUDO, steering_read::DEFAULT_MIN_DISTINCT);
            checked += 1;
            if out["measured"] != Value::Bool(true) { if bad.is_none() { bad = Some(json!({ "seed": seed, "n": n, "violation": "expected measured (n >= MIN_DISTINCT)" })); } continue; }
            for path in [["kl", "pooled"], ["kl", "null_within_room"], ["js", "pooled"], ["js", "null_within_room"]] {
                let cell = &out[path[0]][path[1]];
                let rate = cell["rate"].clone(); let nm = cell["null_mean"].clone(); let nsd = cell["null_sd"].as_f64();
                checked += 1;
                if rate != nm && bad.is_none() { bad = Some(json!({ "seed": seed, "n": n, "path": path, "rate": rate, "null_mean": nm })); }
                if nsd != Some(0.0) && bad.is_none() { bad = Some(json!({ "seed": seed, "n": n, "path": path, "null_sd": nsd })); }
            }
        }
    }
    Check { id: "SW-R2", name: "steering-pairing-null-degenerate-by-identity", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "3 seeds x 3 sizes {20,25,40}, 4 cells each (kl/js x pooled/within-room)".into(),
        note: "null_mean == rate exactly and null_sd == 0 on every one of 36 cells, confirming the degeneracy is an identity of the statistic (a permutation of pairing cannot move a marginal divergence), not an artifact of one fixture".into() }
}

// ── JU-R1/JU-R2 · KR42's JOB-IN-COMMIT-UNITS ARITHMETIC IN THE CRATE (whitespace ledger B4 stub) ───────────────────
// The port of scripts/pmu/kr42-job-units.mjs's assignUnits/timeOnTarget arithmetic into job_units_read.rs, driven by
// --job-units-read. JU-R3 (PARITY on a fixture) is a JS-side MEASURED reading (tests/formal/kr42-job-units.test.mjs
// JU-R3), not proved in this file.

// JU-R1 · NO COMMIT BELONGS TO TWO JOBS; THE EARLIER ASK WINS AN OVERLAP, DETERMINISTICALLY. Enumerated over three
// job-counts and three ask-spacings (9 geometries), each with jobs sharing one room and deliberately overlapping
// windows, and a dense sweep of commit timestamps across the whole span. Three sub-properties per geometry: (1) no
// commit index appears in more than one job's assigned list; (2) the sum of every job's assigned-commit count equals
// the tally's own `matched` count exactly (no silent drop or double count); (3) every commit's independently
// re-derived candidate set, when non-empty, is won by the job with the SMALLEST ask_ms among the candidates — the
// same winner assign_units actually picked. Mutation: sorting candidates by ask_ms DESCENDING (or picking `.last()`
// instead of the min) flips which job wins every multi-candidate commit, and this check refutes.
fn check_job_units_read_no_double_counting() -> Check {
    use job_units_read::{assign_units, CommitRow, JobRow, TurnRow};
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    for &n_jobs in &[2usize, 3, 4] {
        for &spacing_ms in &[500_000i64, 1_800_000, 3_600_000] {
            let jobs: Vec<JobRow> = (0..n_jobs).map(|k| JobRow {
                tx_id: format!("tx{}", k), room: Some("R".into()), lane: None,
                ask_ms: (k as i64) * spacing_ms,
                window_end_ms: Some((k as i64) * spacing_ms + spacing_ms * (n_jobs as i64)),
                turn_rows: Vec::<TurnRow>::new(),
            }).collect();
            let span_end = (n_jobs as i64) * spacing_ms + spacing_ms * (n_jobs as i64);
            let mut commits: Vec<CommitRow> = Vec::new();
            let mut t = 0i64;
            while t < span_end {
                commits.push(CommitRow { reff: format!("c{}", t), room: Some("R".into()), ts_ms: t,
                    covenant_commit: Some(1), tokens_in: 1.0, tokens_out: 1.0, wall_minutes: 1.0 });
                t += (spacing_ms / 3).max(1);
            }
            let (units, tally) = assign_units(&jobs, &commits);
            checked += 1;

            let mut seen = vec![0u32; commits.len()];
            for u in &units { for &ci in u { seen[ci] += 1; } }
            if seen.iter().any(|&c| c > 1) && bad.is_none() {
                bad = Some(json!({ "n_jobs": n_jobs, "spacing_ms": spacing_ms, "violation": "a commit index was assigned to more than one job" }));
            }
            let total: usize = units.iter().map(|u| u.len()).sum();
            if total != tally.matched && bad.is_none() {
                bad = Some(json!({ "n_jobs": n_jobs, "spacing_ms": spacing_ms, "total": total, "matched": tally.matched, "violation": "sum of per-job units != matched tally" }));
            }
            for (ci, c) in commits.iter().enumerate() {
                let candidates: Vec<usize> = jobs.iter().enumerate().filter_map(|(ji, j)| {
                    if j.room.as_deref() != c.room.as_deref() { return None; }
                    let we = j.window_end_ms?;
                    if c.ts_ms >= j.ask_ms && c.ts_ms <= we { Some(ji) } else { None }
                }).collect();
                if candidates.is_empty() { continue; }
                let expected = *candidates.iter().min_by_key(|&&ji| jobs[ji].ask_ms).unwrap();
                let actual = units.iter().position(|u| u.contains(&ci));
                checked += 1;
                if actual != Some(expected) && bad.is_none() {
                    bad = Some(json!({ "n_jobs": n_jobs, "spacing_ms": spacing_ms, "commit": c.reff, "expected_winner": expected, "actual_winner": actual, "violation": "the earlier ASK did not win an overlap" }));
                }
            }
        }
    }
    Check { id: "JU-R1", name: "job-units-no-double-counting-earlier-ask-wins", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "9 geometries (3 job-counts x 3 ask-spacings), one shared room, deliberately overlapping windows, a dense commit sweep across the whole span".into(),
        note: "on every geometry: no commit index was assigned twice, the per-job assignment counts summed to the tally's own matched count, and every multi-candidate commit was won by the job with the smallest ask_ms among its candidates".into() }
}

// JU-R2 · A JOB WITH ZERO TURN ROWS IN ITS WINDOW READS time_on_target_minutes = null, NEVER 0 — the null-vs-zero
// discipline PN4 requires (an absence of record is not evidence of drift). Enumerated over 5 hand-built cases (empty,
// a single off-lane row spanning the window, a single on-lane row, a two-row split, a row entirely before the
// window) plus a further 5 sizes x 4 tau sweep (20 more cases) checking the pure existence claim: minutes is None iff
// zero turn rows fall inside [start, end]. Mutation: the empty-input early return changed from `None` to `Some(0.0)`
// makes every empty-window case read Some(0.0) instead of None, and this check refutes.
fn check_job_units_read_null_vs_zero_time_on_target() -> Check {
    use job_units_read::{time_on_target, TurnRow};
    let mut checked = 0u64; let mut bad: Option<Value> = None;
    let hand_cases: [(Vec<(i64, f64)>, i64, i64, f64, Option<f64>); 5] = [
        (vec![], 0, 3_600_000, 25.0, None),
        (vec![(0, 90.0)], 0, 3_600_000, 25.0, Some(0.0)),
        (vec![(0, 10.0)], 0, 3_600_000, 25.0, Some(60.0)),
        (vec![(0, 10.0), (1_200_000, 90.0)], 0, 3_600_000, 25.0, Some(20.0)),
        (vec![(-1_000_000, 5.0)], 0, 3_600_000, 25.0, None),   // the only row on record sits before the window — filtered out
    ];
    for (rows, start, end, tau, expect) in &hand_cases {
        let turn_rows: Vec<TurnRow> = rows.iter().map(|&(t, off)| TurnRow { t_ms: t, off }).collect();
        let t = time_on_target(&turn_rows, *start, *end, *tau);
        checked += 1;
        if t.minutes != *expect && bad.is_none() {
            bad = Some(json!({ "rows": format!("{:?}", rows), "start": start, "end": end, "tau": tau, "got": t.minutes, "expected": expect }));
        }
    }
    for &n in &[0usize, 1, 2, 5, 9] {
        for &tau in &[0.0f64, 25.0, 50.0, 100.0] {
            let turn_rows: Vec<TurnRow> = (0..n).map(|i| TurnRow { t_ms: (i as i64) * 100_000, off: ((i * 17) % 101) as f64 }).collect();
            let t = time_on_target(&turn_rows, 0, 1_000_000, tau);
            checked += 1;
            let ok = if n == 0 { t.minutes.is_none() } else { t.minutes.is_some() };
            if !ok && bad.is_none() {
                bad = Some(json!({ "n": n, "tau": tau, "minutes": t.minutes, "violation": "minutes must be None iff there are zero rows in the window" }));
            }
        }
    }
    Check { id: "JU-R2", name: "job-units-null-vs-zero-time-on-target", checked, holds: bad.is_none(), counterexample: bad.unwrap_or(Value::Null),
        domain: "5 hand-built cases (empty, off-lane spanning, on-lane spanning, split, row-before-window) + 5 sizes x 4 tau values (20 more) over synthetic turn-row fixtures".into(),
        note: "zero turn rows inside the window read minutes: null on every case, never 0; a nonzero row count always reads Some(_), matching a hand-computed value on the 5 explicit cases".into() }
}

pub fn run(_args: &[String]) {
    let w2 = check_ring_loop();
    let l1 = check_stage_ladder();
    let (s2, s3) = check_z_required();
    let (a5, a6) = check_window();
    let (a1, a2, a3, a4) = check_aperture();
    let p3 = check_perm_monotone();
    let (n1, n2) = check_null_shuffle();
    let (pn2, pn3, n3) = check_action_read();
    let (v1, v2, v3, v4) = (check_level_invariance(), check_perm_invariance(), check_vol_null_is_a_permutation(), check_distinct_commit_hurdle());
    let v5 = check_within_room_null();
    let (e1, e2, e3, e4, e5) = (check_unit_registry(), check_no_dollar_without_date(), check_envelope_homogeneity(), check_envelope_monotone_in_y(), check_per_commit_before_per_pass());
    let (e7, e8) = (check_type_state_money(), check_unit_registry_is_exhaustive());
    let ap_r1 = check_aperture_read_null_is_map_permutation_only();
    let ap_r2 = check_aperture_read_all_touch_nothing_pins_alpha_equal_p();
    let sw_r1 = check_steering_kl_nonneg_and_zero_iff_identical();
    let sw_r2 = check_steering_pairing_null_degenerate_by_identity();
    let ju_r1 = check_job_units_read_no_double_counting();
    let ju_r2 = check_job_units_read_null_vs_zero_time_on_target();
    let all = [a1, a2, a3, a4, a5, a6, s2, s3, p3, n1, n2, n3, pn2, pn3, w2, l1, v1, v2, v3, v4, v5, e1, e2, e3, e4, e5, e7, e8, ap_r1, ap_r2, sw_r1, sw_r2, ju_r1, ju_r2];
    let holds = all.iter().filter(|c| c.holds).count();
    let out = json!({
        "engine": "rust-harness",
        "spec": "docs/architecture/fable-maintenance-ratchet.md §7",
        "properties": all.iter().map(|c| c.to_json()).collect::<Vec<_>>(),
        "summary": { "checked_properties": all.len(), "holds": holds, "refuted": all.len() - holds,
                     "refuted_ids": all.iter().filter(|c| !c.holds).map(|c| c.id).collect::<Vec<_>>() }
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn w2_is_refuted_on_the_running_code_with_a_flat_grip_trace() {
        // F14's falsifier: the model must FIND the flat-grip false latch. A model that finds none while the tape shows
        // 82% flat walkers is the wrong model.
        let w2 = check_ring_loop();
        assert!(w2.holds, "W2 refuted on the shipped rule — the GripRise witness is no longer required: {}", w2.counterexample);
        // F14's falsifier survives F18: the pre-F18 arm must still exhibit the flat-grip false latch on the same domain
        let v0 = &w2.counterexample["v0"];
        assert_eq!(v0["shortest"]["stopped_at_ring"], 2, "the v0 arm no longer finds the two-ring false latch: {}", v0);
        assert!(v0["false_latches"].as_u64().unwrap_or(0) >= 70, "the v0 arm found too few false latches: {}", v0);
    }
    #[test]
    fn l1_s2_s3_a5_a6_hold_on_their_domains() {
        assert!(check_stage_ladder().holds);
        let (s2, s3) = check_z_required(); assert!(s2.holds, "{}", s2.counterexample); assert!(s3.holds, "{}", s3.note);
        let (a5, a6) = check_window(); assert!(a5.holds, "{}", a5.counterexample); assert!(a6.holds, "{}", a6.counterexample);
        let p3 = check_perm_monotone(); assert!(p3.holds, "{}", p3.counterexample);
    }
    #[test]
    fn two_runs_print_byte_identical_json() {
        let a = serde_json::to_string(&check_aperture().3.to_json()).unwrap();
        let b = serde_json::to_string(&check_aperture().3.to_json()).unwrap();
        assert_eq!(a, b);
    }
}
