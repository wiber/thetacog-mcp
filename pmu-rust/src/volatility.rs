// src/volatility.rs — THE VOLATILITY READ, IN THE CRATE (KR34: "Black-Scholes for competence", spec §8.32).
//
// THE CLAIM BEING TESTED. Black–Scholes prices a contingent claim from the underlying's VOLATILITY alone; the DRIFT μ
// — the expected return, the thing everyone argues about — drops out of the equation. The analogue the operator wants
// tested is that a contract on a room's work can be priced from the measured DISPERSION of its placements against the
// declared lane, without knowing whether the work was any good (undecidable, Rice 1953). For that to be more than a
// slogan, two separable things must hold, and this file is the first of them:
//
//   (A) MACHINE — the estimator has the Black–Scholes SHAPE: its value does not depend on the level. Proved by
//       enumeration in harness.rs (V1 level-invariance, V2 permutation-invariance, V3 the null is an exact
//       permutation, V4 the distinct-commit hurdle), never asserted here.
//   (B) MEASURED — the σ series actually predicts a priced downstream event above an exact null, and does so GIVEN μ.
//       If μ predicts and σ does not, the framing fails and the read must say so. That is what vol_read computes.
//
// THE ESTIMATOR IS CANONICALISED BEFORE IT IS COMPUTED. window_vol sorts its window, pivots on the smallest element,
// and sums in that one order. Two consequences, both load-bearing and both enumerated:
//   · it is a function of the window's MULTISET, bit-for-bit — reordering the eight tape rows cannot move the number
//     (V2). A float sum that ran in arrival order would be permutation-invariant only to rounding, and "only to
//     rounding" is exactly the crack a ratchet falls through.
//   · the pivot makes it a function of the DIFFERENCES. On a grid where x + c and (x+c) − (x₀+c) are exact, the shift
//     cancels bit-for-bit (V1). That is the Black–Scholes shape, stated as something that can go red.
//
// WHAT THIS IS SUFFICIENT FOR (W6): whether the DISPERSION of a room's recent in-lane placements separates commits
// that were later reworked from commits that were not, above a null that permutes the dispersion labels across
// commits. WHAT IT IS NOT SUFFICIENT FOR: whether any individual commit was good, whether the rework was warranted,
// or any causal claim — the tertile split is an ordering of the same rooms' own history, not an intervention.
//
// LLM-free. No clock. The only randomness is the crate's own LCG, the same one action.rs uses, so the JS oracle in
// scripts/pmu/kr34-volatility.mjs reproduces every draw. Two runs print byte-identical JSON.
// TWO NULLS, NEVER ONE (2026-09-17). Rooms are a confound: architect, laboratory and voice contribute different
// numbers of commits AND differ in both their μ and their fix rate, so a label permutation across ALL commits can
// read a room difference as a μ or σ effect. Every cell therefore carries a second null, `null_within_room`, whose
// draws permute the labels ONLY among commits of the same room (rooms under MIN_ROOM_ROWS pooled into one "other"
// stratum, counted on the row). A result that survives only the pooled null is a room artefact with a z.
//   pmu-onchip --vol-read --path rows.json [--k 300] [--seed 41] [--y-field rework24] [--split tertile|median]
//   rows.json: { "rows": [ { "i": 0, "ref": "abc1234", "sigmas": [ … ], "mu": …, "vol": …, "rework24": 0|1 }, … ] }
//   `sigmas` (the window itself) wins when present: the crate then computes μ and σ with its OWN estimator, so the
//   properties V1/V2 are about the function the read actually ran and not a second copy of it in the driver.
use crate::action::{shuffle_in_place, Lcg32};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

/// PN3, carried over from the action read (KR23: six commits wore the n of 1,752 rows). A tertile cell holding fewer
/// than this many DISTINCT commits is UNMEASURED however large its z — the z is printed, the reading is not claimed.
pub const MIN_DISTINCT_COMMITS: usize = 20;

#[derive(Clone, Debug)]
pub struct Row { pub i: usize, pub reff: String, pub room: String, pub mu: f64, pub vol: f64, pub y: f64 }

/// a room contributing fewer than this many commits is pooled into one "other" stratum for the within-room shuffle —
/// a stratum of one can only ever return itself, which would quietly turn a permutation null into no null at all.
pub const MIN_ROOM_ROWS: usize = 4;

fn r3(x: f64) -> f64 { (x * 1000.0).round() / 1000.0 }
fn r2(x: f64) -> f64 { (x * 100.0).round() / 100.0 }
fn o3(x: Option<f64>) -> Option<f64> { x.map(r3) }

/// the window's canonical order — ascending. The estimator is a function of the MULTISET (V2), never of arrival order.
pub fn canon(xs: &[f64]) -> Vec<f64> {
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    v
}

/// μ — the DRIFT of the window. Pivoted on the smallest element and summed in canonical order.
pub fn window_mu(xs: &[f64]) -> f64 {
    if xs.is_empty() { return f64::NAN; }
    let c = canon(xs); let p = c[0];
    let s: f64 = c.iter().map(|v| v - p).sum();
    p + s / c.len() as f64
}

/// σ — the VOLATILITY of the window: the population standard deviation, pivoted on the window's smallest element so
/// the LEVEL cancels before anything is squared. This is the Black–Scholes shape, and V1 is the statement of it.
pub fn window_vol(xs: &[f64]) -> f64 {
    let n = xs.len();
    if n == 0 { return f64::NAN; }
    let c = canon(xs); let p = c[0];
    let d: Vec<f64> = c.iter().map(|v| v - p).collect();
    let m: f64 = d.iter().sum::<f64>() / n as f64;
    (d.iter().map(|v| { let e = v - m; e * e }).sum::<f64>() / n as f64).sqrt()
}

/// ONE POOLED NULL DRAW: the key labels permuted across ALL commits. A permutation, so the sorted multiset is
/// unchanged (V3) — the null asks "would a commit with THIS dispersion, attached to a different commit, look the same?".
pub fn null_draw(base: &[f64], rng: &mut Lcg32) -> Vec<f64> {
    let mut v = base.to_vec();
    shuffle_in_place(&mut v, rng);
    v
}

/// the strata for the within-room null: one group of row indices per room that contributes at least `min_room` rows,
/// plus one pooled "other" group for the rest. Deterministic (BTreeMap order); returns the pooled count beside them.
pub fn room_groups(rooms: &[&str], min_room: usize) -> (Vec<Vec<usize>>, usize) {
    let mut by: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, r) in rooms.iter().enumerate() { by.entry(r).or_default().push(i); }
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut other: Vec<usize> = Vec::new();
    for (_, v) in by { if v.len() >= min_room { groups.push(v); } else { other.extend(v); } }
    let pooled = other.len();
    if !other.is_empty() { other.sort_unstable(); groups.push(other); }
    (groups, pooled)
}

/// ONE WITHIN-ROOM NULL DRAW: the labels permuted only INSIDE each stratum, so every room keeps its own label multiset
/// exactly (V5) and a between-room difference in μ, σ or fix rate cannot be spent as an effect.
pub fn null_draw_within_room(vals: &[f64], groups: &[Vec<usize>], rng: &mut Lcg32) -> Vec<f64> {
    let mut out = vals.to_vec();
    for g in groups {
        let mut sub: Vec<f64> = g.iter().map(|&i| vals[i]).collect();
        shuffle_in_place(&mut sub, rng);
        for (k, &i) in g.iter().enumerate() { out[i] = sub[k]; }
    }
    out
}

/// HOW THE TOP CELL IS CUT. Tertile is the pre-registered split; Median is the robustness arm the sweep also runs.
/// Neither is searched over for a headline — the sweep says whether the pre-registered cell is typical, nothing more.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Split { Tertile, Median }
impl Split {
    pub fn parse(s: &str) -> Split { if s.eq_ignore_ascii_case("median") { Split::Median } else { Split::Tertile } }
    pub fn name(&self) -> &'static str { match self { Split::Tertile => "tertile", Split::Median => "median" } }
    /// how many rows the TOP cell takes out of n
    pub fn take(&self, n: usize) -> usize { match self { Split::Tertile => n / 3, Split::Median => n / 2 } }
    /// how many μ strata the "given μ" column has
    pub fn strata(&self) -> usize { match self { Split::Tertile => 3, Split::Median => 2 } }
}

/// the TOP cell by value: the highest `split.take(n)` rows, ties broken by row order so the split is a deterministic
/// function of (values, order) and the same split is recomputed inside every null draw.
pub fn top_mask(vals: &[f64], split: Split) -> Vec<bool> {
    let n = vals.len();
    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| vals[a].partial_cmp(&vals[b]).unwrap_or(Ordering::Equal).then(a.cmp(&b)));
    let take = split.take(n);
    let mut mask = vec![false; n];
    for &j in idx.iter().skip(n - take) { mask[j] = true; }
    mask
}

/// the statistic: rework rate in the top cell minus the rate in the rest. None when either cell is empty.
fn effect_of(mask: &[bool], y: &[f64]) -> Option<(f64, f64, f64, usize, usize)> {
    let (mut st, mut nt, mut sr, mut nr) = (0.0f64, 0usize, 0.0f64, 0usize);
    for (k, &m) in mask.iter().enumerate() { if m { st += y[k]; nt += 1; } else { sr += y[k]; nr += 1; } }
    if nt == 0 || nr == 0 { return None; }
    let rt = st / nt as f64; let rr = sr / nr as f64;
    Some((rt - rr, rt, rr, nt, nr))
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Key { Vol, Mu }
impl Key { fn of(&self, r: &Row) -> f64 { match self { Key::Vol => r.vol, Key::Mu => r.mu } } fn name(&self) -> &'static str { match self { Key::Vol => "vol", Key::Mu => "mu" } } }

/// PN1 SHAPE: `rate` (the effect), `n`, `null_mean`, `null_sd`, `z` ride together on every object that carries a z —
/// the pooled cell and the within-room cell alike. A z alone is a p-value with its context amputated.
#[derive(Clone, Debug)]
pub struct CellRead {
    pub key: &'static str, pub n: usize, pub n_top: usize, pub n_rest: usize,
    pub rate_top: Option<f64>, pub rate_rest: Option<f64>, pub base_rate: Option<f64>,
    pub rate: Option<f64>, pub null_mean: Option<f64>, pub null_sd: Option<f64>, pub z: Option<f64>,
    pub wr_null_mean: Option<f64>, pub wr_null_sd: Option<f64>, pub wr_z: Option<f64>, pub wr_groups: usize, pub wr_pooled_other: usize,
    pub distinct_commits: usize, pub distinct_commits_top: usize, pub distinct_commits_rest: usize,
    pub k: usize, pub split: &'static str, pub measured: bool, pub why: Option<String>,
}

impl CellRead {
    pub fn to_json(&self) -> Value {
        json!({ "key": self.key, "n": self.n, "n_top": self.n_top, "n_rest": self.n_rest,
                "rate_top": self.rate_top, "rate_rest": self.rate_rest, "base_rate": self.base_rate,
                "rate": self.rate, "null_mean": self.null_mean, "null_sd": self.null_sd, "z": self.z,
                "null_within_room": { "rate": self.rate, "n": self.n, "null_mean": self.wr_null_mean, "null_sd": self.wr_null_sd,
                                      "z": self.wr_z, "k": self.k, "room_strata": self.wr_groups, "pooled_into_other": self.wr_pooled_other,
                                      "measured": self.measured },
                "distinct_commits": self.distinct_commits, "distinct_commits_top": self.distinct_commits_top,
                "distinct_commits_rest": self.distinct_commits_rest, "k": self.k, "split": self.split,
                "measured": self.measured, "why": self.why })
    }
}

fn empty_cell(key: &'static str, n: usize, k: usize, split: Split, why: &str) -> CellRead {
    CellRead { key, n, n_top: 0, n_rest: 0, rate_top: None, rate_rest: None, base_rate: None, rate: None, null_mean: None,
               null_sd: None, z: None, wr_null_mean: None, wr_null_sd: None, wr_z: None, wr_groups: 0, wr_pooled_other: 0,
               distinct_commits: 0, distinct_commits_top: 0, distinct_commits_rest: 0, k, split: split.name(), measured: false, why: Some(why.into()) }
}

/// the moments of a draw set, and the z of `eff` against them. A degenerate null reads 0, never ±1 from float dust.
fn moments(eff: f64, draws: &[f64]) -> (Option<f64>, Option<f64>, Option<f64>) {
    if draws.is_empty() { return (None, None, None); }
    let m = draws.iter().sum::<f64>() / draws.len() as f64;
    let sd = (draws.iter().map(|d| (d - m) * (d - m)).sum::<f64>() / draws.len() as f64).sqrt();
    (Some(r3(m)), Some(r3(sd)), Some(if sd > 1e-9 { r2((eff - m) / sd) } else { 0.0 }))
}

/// ONE READ: the top cell on `by`, effect = top minus rest, then TWO nulls from the shared rng — K pooled draws, then
/// K within-room draws. One deterministic stream, exactly as action_read is.
pub fn effect_read(rows: &[Row], by: Key, k: usize, split: Split, rng: &mut Lcg32) -> CellRead {
    let n = rows.len();
    let name = by.name();
    if n < 3 { return empty_cell(name, n, k, split, "fewer than 3 commits — no split"); }
    let vals: Vec<f64> = rows.iter().map(|r| by.of(r)).collect();
    let y: Vec<f64> = rows.iter().map(|r| r.y).collect();
    let mask = top_mask(&vals, split);
    let (eff, rt, rr, nt, nr) = match effect_of(&mask, &y) { Some(x) => x, None => return empty_cell(name, n, k, split, "a cell is empty") };
    let dt: BTreeSet<&str> = rows.iter().zip(mask.iter()).filter(|(_, &m)| m).map(|(r, _)| r.reff.as_str()).collect();
    let dr: BTreeSet<&str> = rows.iter().zip(mask.iter()).filter(|(_, &m)| !m).map(|(r, _)| r.reff.as_str()).collect();
    let dall: BTreeSet<&str> = rows.iter().map(|r| r.reff.as_str()).collect();
    let base = y.iter().sum::<f64>() / n as f64;
    let mut pooled: Vec<f64> = Vec::with_capacity(k);
    for _ in 0..k {
        let p = null_draw(&vals, rng);
        if let Some((e, _, _, _, _)) = effect_of(&top_mask(&p, split), &y) { pooled.push(e); }
    }
    let rooms: Vec<&str> = rows.iter().map(|r| r.room.as_str()).collect();
    let (groups, pooled_other) = room_groups(&rooms, MIN_ROOM_ROWS);
    let mut within: Vec<f64> = Vec::with_capacity(k);
    for _ in 0..k {
        let p = null_draw_within_room(&vals, &groups, rng);
        if let Some((e, _, _, _, _)) = effect_of(&top_mask(&p, split), &y) { within.push(e); }
    }
    let (nm, nsd, z) = moments(eff, &pooled);
    let (wm, wsd, wz) = moments(eff, &within);
    let measured = dt.len() >= MIN_DISTINCT_COMMITS && dr.len() >= MIN_DISTINCT_COMMITS;
    CellRead { key: name, n, n_top: nt, n_rest: nr, rate_top: Some(r3(rt)), rate_rest: Some(r3(rr)), base_rate: Some(r3(base)),
               rate: Some(r3(eff)), null_mean: nm, null_sd: nsd, z,
               wr_null_mean: wm, wr_null_sd: wsd, wr_z: wz, wr_groups: groups.len(), wr_pooled_other: pooled_other,
               distinct_commits: dall.len(), distinct_commits_top: dt.len(), distinct_commits_rest: dr.len(), k, split: split.name(), measured,
               why: if measured { None } else { Some(format!("{} distinct commits in the top cell / {} in the rest < {} (PN3) — the z is printed, the reading is UNMEASURED", dt.len(), dr.len(), MIN_DISTINCT_COMMITS)) } }
}

/// the μ strata: three groups (tertile) or two (median), split on μ by the (μ, row-order) sort.
pub fn mu_groups(rows: &[Row], split: Split) -> Vec<Vec<Row>> {
    let n = rows.len();
    let g = split.strata();
    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| rows[a].mu.partial_cmp(&rows[b].mu).unwrap_or(Ordering::Equal).then(a.cmp(&b)));
    let mut out: Vec<Vec<Row>> = (0..g).map(|_| Vec::new()).collect();
    for (rank, &j) in idx.iter().enumerate() {
        let mut band = g - 1;
        for b in 0..g { if rank < (b + 1) * n / g { band = b; break; } }
        out[band].push(rows[j].clone());
    }
    out
}

/// THE READING. One rng, one fixed order — vol · mu · vol halves · mu halves · then each μ stratum pooled, A, B — so
/// the whole document is a pure function of (rows, k, seed, split). HALVES EVERYWHERE: a cell without its two
/// interleaved halves is one number that cannot be contradicted by its own data.
pub fn vol_read(rows: &[Row], k: usize, seed: u32, split: Split) -> Value {
    let mut rng = Lcg32(seed);
    let a: Vec<Row> = rows.iter().filter(|r| r.i % 2 == 0).cloned().collect();
    let b: Vec<Row> = rows.iter().filter(|r| r.i % 2 == 1).cloned().collect();
    let vol = effect_read(rows, Key::Vol, k, split, &mut rng);
    let mu = effect_read(rows, Key::Mu, k, split, &mut rng);
    let vol_a = effect_read(&a, Key::Vol, k, split, &mut rng);
    let vol_b = effect_read(&b, Key::Vol, k, split, &mut rng);
    let mu_a = effect_read(&a, Key::Mu, k, split, &mut rng);
    let mu_b = effect_read(&b, Key::Mu, k, split, &mut rng);
    let groups = mu_groups(rows, split);
    let given: Vec<Value> = groups.iter().enumerate().map(|(gi, g)| {
        let c = effect_read(g, Key::Vol, k, split, &mut rng);
        let ga: Vec<Row> = g.iter().filter(|r| r.i % 2 == 0).cloned().collect();
        let gb: Vec<Row> = g.iter().filter(|r| r.i % 2 == 1).cloned().collect();
        let ca = effect_read(&ga, Key::Vol, k, split, &mut rng);
        let cb = effect_read(&gb, Key::Vol, k, split, &mut rng);
        let lo = g.iter().map(|r| r.mu).fold(f64::INFINITY, f64::min);
        let hi = g.iter().map(|r| r.mu).fold(f64::NEG_INFINITY, f64::max);
        let mut j = c.to_json();
        j["mu_group"] = json!(gi);
        j["mu_groups"] = json!(groups.len());
        j["mu_min"] = json!(if lo.is_finite() { Some(r3(lo)) } else { None });
        j["mu_max"] = json!(if hi.is_finite() { Some(r3(hi)) } else { None });
        j["halves"] = json!({ "A": ca.to_json(), "B": cb.to_json() });
        j
    }).collect();
    let n = rows.len();
    let base = if n == 0 { None } else { Some(r3(rows.iter().map(|r| r.y).sum::<f64>() / n as f64)) };
    let distinct: BTreeSet<&str> = rows.iter().map(|r| r.reff.as_str()).collect();
    let rooms: Vec<&str> = rows.iter().map(|r| r.room.as_str()).collect();
    let (rg, rpooled) = room_groups(&rooms, MIN_ROOM_ROWS);
    let mut mu_json = mu.to_json();
    mu_json["halves"] = json!({ "A": mu_a.to_json(), "B": mu_b.to_json() });
    json!({
        "engine": "rust-vol", "k": k, "seed": seed, "split": split.name(), "rows": n, "distinct_commits": distinct.len(),
        "min_distinct_commits": MIN_DISTINCT_COMMITS, "min_room_rows": MIN_ROOM_ROWS,
        "room_strata": rg.len(), "pooled_into_other": rpooled, "base_rate": base,
        "vol": vol.to_json(), "mu": mu_json,
        "halves": { "A": vol_a.to_json(), "B": vol_b.to_json() },
        "vol_given_mu": given
    })
}

fn f(v: &Value) -> Option<f64> { v.as_f64() }

pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let path = match arg("--path") { Some(p) => p, None => { eprintln!("--vol-read needs --path rows.json"); std::process::exit(2); } };
    let k: usize = arg("--k").and_then(|s| s.parse().ok()).unwrap_or(300);
    let seed: u32 = arg("--seed").and_then(|s| s.parse().ok()).unwrap_or(41);
    let yf = arg("--y-field").unwrap_or_else(|| "rework24".into());
    let split = Split::parse(&arg("--split").unwrap_or_else(|| "tertile".into()));
    let text = match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON in {}: {}", path, e); std::process::exit(2); } };
    let mut rows: Vec<Row> = Vec::new(); let mut skipped = 0usize; let mut from_window = 0usize;
    for r in doc["rows"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let i = match r["i"].as_u64() { Some(i) => i as usize, None => { skipped += 1; continue; } };
        let reff = r["ref"].as_str().unwrap_or("").to_string();
        let room = r["room"].as_str().unwrap_or("").to_string();
        let y = match f(&r[yf.as_str()]) { Some(y) => y, None => { skipped += 1; continue; } };
        // THE WINDOW WINS: when the row carries its σ window, μ and σ are computed HERE, by the estimator the
        // properties are about — never taken on trust from the driver.
        let win: Option<Vec<f64>> = r["sigmas"].as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect());
        let (mu, vol) = match &win {
            Some(w) if !w.is_empty() => { from_window += 1; (window_mu(w), window_vol(w)) }
            _ => match (f(&r["mu"]), f(&r["vol"])) { (Some(m), Some(v)) => (m, v), _ => { skipped += 1; continue; } },
        };
        if reff.is_empty() { skipped += 1; continue; }
        rows.push(Row { i, reff, room, mu, vol, y });
    }
    let mut out = vol_read(&rows, k, seed, split);
    out["y_field"] = json!(yf);
    out["skipped"] = json!(skipped);
    out["mu_vol_from_window"] = json!(from_window);
    println!("{}", serde_json::to_string(&out).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_estimator_ignores_the_level_and_the_order() {
        let w = [0.25f64, 1.5, 2.75, 0.5, 3.0];
        let shifted: Vec<f64> = w.iter().map(|x| x + 4.0).collect();
        assert_eq!(window_vol(&w), window_vol(&shifted));
        let mut perm = w.to_vec(); perm.reverse();
        assert_eq!(window_vol(&w), window_vol(&perm));
        assert_eq!(window_mu(&shifted), window_mu(&w) + 4.0);
    }
    #[test]
    fn a_constant_key_gives_a_degenerate_null_and_too_few_commits_are_unmeasured() {
        let rows: Vec<Row> = (0..60).map(|i| Row { i, reff: format!("c{}", i), room: "architect".into(), mu: 1.0, vol: 1.0, y: (i % 3 == 0) as u8 as f64 }).collect();
        let mut rng = Lcg32(41);
        let c = effect_read(&rows, Key::Vol, 30, Split::Tertile, &mut rng);
        assert_eq!(c.null_sd, Some(0.0)); assert_eq!(c.z, Some(0.0));
        assert_eq!(c.wr_null_sd, Some(0.0)); assert_eq!(c.wr_z, Some(0.0));
        let few: Vec<Row> = (0..60).map(|i| Row { i, reff: format!("c{}", i % 4), room: "architect".into(), mu: i as f64, vol: i as f64, y: 0.0 }).collect();
        let mut rng2 = Lcg32(41);
        assert!(!effect_read(&few, Key::Vol, 5, Split::Tertile, &mut rng2).measured);
        // the within-room null cannot move a label out of its room
        let mixed: Vec<Row> = (0..24).map(|i| Row { i, reff: format!("c{}", i), room: if i % 2 == 0 { "architect".into() } else { "voice".into() }, mu: i as f64, vol: i as f64, y: 0.0 }).collect();
        let rooms: Vec<&str> = mixed.iter().map(|r| r.room.as_str()).collect();
        let (g, pooled) = room_groups(&rooms, MIN_ROOM_ROWS);
        assert_eq!(g.len(), 2); assert_eq!(pooled, 0);
        let vals: Vec<f64> = mixed.iter().map(|r| r.vol).collect();
        let mut rng3 = Lcg32(7);
        let d = null_draw_within_room(&vals, &g, &mut rng3);
        for grp in &g { let mut x: Vec<f64> = grp.iter().map(|&i| vals[i]).collect(); let mut z: Vec<f64> = grp.iter().map(|&i| d[i]).collect(); x.sort_by(|a, b| a.partial_cmp(b).unwrap()); z.sort_by(|a, b| a.partial_cmp(b).unwrap()); assert_eq!(x, z); }
    }
}
