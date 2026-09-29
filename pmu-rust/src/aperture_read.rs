// src/aperture_read.rs — KR39's APERTURE ARITHMETIC, IN THE CRATE (whitespace ledger B4, house rule 11: "a reading
// is the crate's; the JS is a driver and says js-fallback when it answers alone").
//
// NAMED aperture_read.rs, NOT aperture.rs — aperture.rs already exists (the window picker match_aperture drives
// --aperture, an unrelated reading). This file is KR39's alpha-per-lane arithmetic alone.
//
// AP-R1: the null is a permutation of the lane->paths ASSIGNMENT ONLY — the touched-path set, off_ok and calls_ok
// feeding the TRUE read are consumed once, before the seed-dependent draw loop, and never revisited; only the
// shuffled `assign` used by the null moves with the seed. Proved by enumeration in harness.rs (P_lane read at 7
// different seeds must be bit-identical).
//
// THE CLAIM. KR37's covenant (off_lane <= tau AND breach <= beta AND calls <= K) is a promise a lane can pass; ALPHA
// is the width that promise is made of, read off the record rather than guessed from the prefix list: for each scored
// row (a lensed prompt with a non-empty declared lane, a known off_lane, a call count, and at least one touched path —
// scoredRows() upstream already excludes a no-path lane and a no-touch turn, never scored here, never re-excluded
// here), hold the row's own touched paths, off_lane and calls FIXED and ask what the covenant would have said under a
// DIFFERENT lane's declared paths. Doing this for every lane in the record at once, K times, with the lane->paths
// ASSIGNMENT permuted across rows (own[] shuffled, the SAME row-to-lane technique KR33's specificityRead uses),
// gives alpha_lane := the mean pass rate a random lane's covenant would grant this lane's own rows; P_lane the real
// rate under its own lane; P/alpha the lift over width.
//
// off_lane and calls do NOT depend on which lane's paths are named — only breach does — so a BREACH-ONLY bound
// (breach == 0 under the permuted paths) rides beside the full covenant, isolating the width effect from the two
// lane-independent bounds.
//
// AP-R2, A PINNED IDENTITY (not a bug here — the JS driver's exclusion, scoredRows, is what prevents it on the real
// record). This crate's own arithmetic never re-implements the no-touch exclusion: fed a fixture where every row's
// touched set is EMPTY, breachShare returns 0 unconditionally against ANY candidate set (there is no path outside the
// empty set to miss), so passCovenant/passBreach stop depending on which lane's paths were assigned at all — the real
// pass and every permuted pass read identically, and alpha_lane == P_lane EXACTLY. This is the coordinator's
// 2026-09-17 finding (every measured lane on the pre-correction record showed alpha == P for exactly this reason),
// kept here as the enumerated proof of the defect the JS driver's precondition exists to prevent, not re-fought.
//
// LLM-free. No clock. The only randomness is the crate's own LCG (action::Lcg32, the same one volatility.rs's null
// draws use), so the JS oracle in scripts/pmu/kr39-aperture.mjs reproduces every draw. Two runs print byte-identical
// JSON.
//   pmu-onchip --aperture-read [--path rows.json | < rows.json] [--k 300] [--seed 39] [--betas 0,0.5]
//   rows.json: { "rows": [ { "i": 0, "session": "s1", "domain": "lane", "delivered": ["x"], "touched": ["x/f.mjs"],
//                            "off_ok": 1, "calls_ok": 1 }, … ] }
//   — one call computes the SAME three-way read scripts/pmu/kr39-aperture.mjs's apertureRead does: A (even i), B (odd
//   i), all — A and all share a seed (the CLI's --seed, default 39), B uses seed + 1, exactly the JS's own ordering.
use crate::action::{shuffle_in_place, Lcg32};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// PN3 for a lane's alpha read: fewer than this many DISTINCT SESSIONS and the reading is UNMEASURED however large z.
pub const MIN_DISTINCT_SESSIONS: usize = 20;
pub const DEFAULT_BETAS: [f64; 2] = [0.0, 0.5];
pub const DEFAULT_SEED: u32 = 39;
pub const DEFAULT_K: usize = 300;

#[derive(Clone, Debug)]
pub struct Row {
    pub i: usize,
    pub session: String,
    pub domain: String,
    pub delivered: Vec<String>,
    pub touched: Vec<String>,
    pub off_ok: bool,
    pub calls_ok: bool,
}

fn r3(x: f64) -> f64 { (x * 1000.0).round() / 1000.0 }
fn r2(x: f64) -> f64 { (x * 100.0).round() / 100.0 }
fn fin(x: f64) -> Option<f64> { if x.is_finite() { Some(x) } else { None } }

/// does a repo-relative path fall under a declared prefix? BY PATH COMPONENT, mirroring transcript-paths.mjs's
/// underPrefix exactly — `scripts/pmu` never matches `scripts/pmu-old`.
fn under_prefix(path: &str, prefix: &str) -> bool {
    let p = path.trim_end_matches('/');
    let g = prefix.trim_end_matches('/');
    !g.is_empty() && (p == g || p.starts_with(&format!("{}/", g)))
}
fn under_any(path: &str, prefixes: &[String]) -> bool { prefixes.iter().any(|g| under_prefix(path, g)) }

/// the share of DISTINCT touched paths falling under NO declared prefix — None when `delivered` is empty (a lane
/// declaring no path; never reached on this crate's own input, since scoredRows excludes it upstream, but a
/// defensive None rather than a silent 0 keeps a malformed candidate set from ever reading as a free pass). Mirrors
/// kr37-covenant.mjs's breachShare exactly, including the AP-R2 identity: an empty touched set returns 0
/// UNCONDITIONALLY, regardless of which candidate set is asked — a no-op turn passes breach under every lane at once.
pub fn breach_share(touched: &[String], delivered: &[String]) -> Option<f64> {
    if delivered.is_empty() { return None; }
    let mut distinct: Vec<&str> = touched.iter().map(|s| s.as_str()).collect();
    distinct.sort_unstable(); distinct.dedup();
    if distinct.is_empty() { return Some(0.0); }
    let miss = distinct.iter().filter(|p| !under_any(p, delivered)).count();
    Some(miss as f64 / distinct.len() as f64)
}

/// PN1's four fields (rate, null_mean, null_sd, n) ride with every z, plus alpha (== null_mean, named for the reader)
/// and the lift p_over_alpha. Mirrors kr39-aperture.mjs's boundCell exactly, decimals included (rate/alpha to 3, z to 2).
#[derive(Clone, Debug)]
pub struct BoundCell {
    pub rate: Option<f64>, pub n: usize, pub null_mean: Option<f64>, pub null_sd: Option<f64>, pub z: f64,
    pub alpha: Option<f64>, pub p_over_alpha: Option<f64>, pub measured: bool, pub why: Option<String>,
}
impl BoundCell {
    pub fn to_json(&self) -> Value {
        json!({ "rate": self.rate, "n": self.n, "null_mean": self.null_mean, "null_sd": self.null_sd, "z": self.z,
                "alpha": self.alpha, "p_over_alpha": self.p_over_alpha, "measured": self.measured, "why": self.why })
    }
}
pub fn bound_cell(real_rate: f64, draws: &[f64], n: usize, measured: bool, why: Option<String>) -> BoundCell {
    let m = if draws.is_empty() { None } else { fin(draws.iter().sum::<f64>() / draws.len() as f64) };
    let sd = m.map(|mm| (draws.iter().map(|d| (d - mm) * (d - mm)).sum::<f64>() / draws.len() as f64).sqrt());
    let z = match sd { Some(s) if s.is_finite() && s > 1e-9 => r2((real_rate - m.unwrap()) / s), _ => 0.0 };
    let alpha = m.map(r3);
    let p_over_alpha = match m { Some(mm) if mm > 1e-9 => fin(real_rate / mm).map(r3), _ => None };
    BoundCell { rate: fin(real_rate).map(r3), n, null_mean: m.map(r3), null_sd: sd.map(r3), z, alpha, p_over_alpha, measured, why }
}

/// a beta value as a JSON object key, matching JS's Number-as-object-key stringification (0 -> "0", 0.5 -> "0.5").
fn beta_key(b: f64) -> String { format!("{}", b) }

/// ONE CORE READ over one set of rows (a half, or all of them) — mirrors apertureCore(rows, {k, seed, betas}) field
/// for field, including the LCG consumption order: one shuffle of `own` per draw q, then EVERY beta in the same q
/// reuses that one draw's assignment (never a fresh shuffle per beta).
pub fn aperture_core(rows: &[Row], k: usize, seed: u32, betas: &[f64]) -> Value {
    let n_rows = rows.len();
    let mut domains: Vec<String> = rows.iter().map(|r| r.domain.clone()).collect();
    domains.sort(); domains.dedup();

    let keys: Vec<String> = rows.iter().map(|r| r.delivered.join("|")).collect();
    let mut set_ids: Vec<String> = Vec::new();
    let mut id_of: BTreeMap<String, usize> = BTreeMap::new();
    for key in &keys { if !id_of.contains_key(key) { id_of.insert(key.clone(), set_ids.len()); set_ids.push(key.clone()); } }
    let sets: Vec<Vec<String>> = set_ids.iter().map(|s| if s.is_empty() { Vec::new() } else { s.split('|').map(|x| x.to_string()).collect() }).collect();
    let own: Vec<usize> = keys.iter().map(|k| *id_of.get(k).unwrap()).collect();
    let n_sets = sets.len();

    // precompute, per row, the breach share against EVERY distinct declared set seen in this population
    let breach_table: Vec<Vec<f64>> = rows.iter().map(|r| sets.iter().map(|s| breach_share(&r.touched, s).unwrap_or(1.0)).collect()).collect();

    let mut idx_by_domain: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for d in &domains { idx_by_domain.insert(d.clone(), Vec::new()); }
    for (j, r) in rows.iter().enumerate() { idx_by_domain.get_mut(&r.domain).unwrap().push(j); }
    let mut sessions_by_domain: BTreeMap<String, usize> = BTreeMap::new();
    for d in &domains {
        let mut s: Vec<&str> = idx_by_domain[d].iter().map(|&j| rows[j].session.as_str()).collect();
        s.sort_unstable(); s.dedup();
        sessions_by_domain.insert(d.clone(), s.len());
    }

    let pass_breach: Vec<Vec<Vec<u8>>> = betas.iter().map(|&beta| rows.iter().enumerate().map(|(j, _)| (0..n_sets).map(|s| if breach_table[j][s] <= beta { 1u8 } else { 0u8 }).collect()).collect()).collect();
    let pass_covenant: Vec<Vec<Vec<u8>>> = betas.iter().map(|&beta| rows.iter().enumerate().map(|(j, r)| (0..n_sets).map(|s| if r.off_ok && r.calls_ok && breach_table[j][s] <= beta { 1u8 } else { 0u8 }).collect()).collect()).collect();

    let mut rng = Lcg32(seed);
    let mut draws_cov: Vec<BTreeMap<String, Vec<f64>>> = betas.iter().map(|_| { let mut m = BTreeMap::new(); for d in &domains { m.insert(d.clone(), Vec::new()); } m }).collect();
    let mut draws_br: Vec<BTreeMap<String, Vec<f64>>> = betas.iter().map(|_| { let mut m = BTreeMap::new(); for d in &domains { m.insert(d.clone(), Vec::new()); } m }).collect();
    let mut draws_cov_all: Vec<Vec<f64>> = betas.iter().map(|_| Vec::with_capacity(k)).collect();
    let mut draws_br_all: Vec<Vec<f64>> = betas.iter().map(|_| Vec::with_capacity(k)).collect();

    for _ in 0..k {
        let mut assign = own.clone();
        shuffle_in_place(&mut assign, &mut rng);   // ONE shuffle per draw q — every beta below reuses it
        for (bi, _beta) in betas.iter().enumerate() {
            let mut acc_cov: BTreeMap<String, f64> = domains.iter().map(|d| (d.clone(), 0.0)).collect();
            let mut acc_br: BTreeMap<String, f64> = domains.iter().map(|d| (d.clone(), 0.0)).collect();
            let mut all_cov = 0.0; let mut all_br = 0.0;
            for j in 0..n_rows {
                let a = assign[j];
                let pc = pass_covenant[bi][j][a] as f64; let pb = pass_breach[bi][j][a] as f64;
                *acc_cov.get_mut(&rows[j].domain).unwrap() += pc; *acc_br.get_mut(&rows[j].domain).unwrap() += pb;
                all_cov += pc; all_br += pb;
            }
            for d in &domains {
                let cnt = idx_by_domain[d].len() as f64;
                draws_cov[bi].get_mut(d).unwrap().push(acc_cov[d] / cnt);
                draws_br[bi].get_mut(d).unwrap().push(acc_br[d] / cnt);
            }
            let denom = n_rows as f64;
            draws_cov_all[bi].push(all_cov / denom);
            draws_br_all[bi].push(all_br / denom);
        }
    }

    let real_of = |mask: &[Vec<u8>]| -> BTreeMap<String, f64> {
        domains.iter().map(|d| {
            let idxs = &idx_by_domain[d];
            let v = if idxs.is_empty() { f64::NAN } else { idxs.iter().map(|&j| mask[j][own[j]] as f64).sum::<f64>() / idxs.len() as f64 };
            (d.clone(), v)
        }).collect()
    };
    let real_all_of = |mask: &[Vec<u8>]| -> f64 { if n_rows == 0 { f64::NAN } else { mask.iter().enumerate().map(|(j, row)| row[own[j]] as f64).sum::<f64>() / n_rows as f64 } };

    let mut by_lane = Map::new();
    for d in &domains {
        let n = idx_by_domain[d].len();
        let sessions = sessions_by_domain[d];
        let measured = sessions >= MIN_DISTINCT_SESSIONS;
        let why = if measured { None } else { Some(format!("{} distinct sessions < {} (PN3) — alpha_lane is printed, the reading is UNMEASURED", sessions, MIN_DISTINCT_SESSIONS)) };
        let mut betas_obj = Map::new();
        for (bi, &beta) in betas.iter().enumerate() {
            let real_cov = real_of(&pass_covenant[bi])[d];
            let real_br = real_of(&pass_breach[bi])[d];
            let cov_cell = bound_cell(real_cov, &draws_cov[bi][d], n, measured, why.clone());
            let br_cell = bound_cell(real_br, &draws_br[bi][d], n, measured, why.clone());
            betas_obj.insert(beta_key(beta), json!({ "covenant": cov_cell.to_json(), "breach_only": br_cell.to_json() }));
        }
        by_lane.insert(d.clone(), json!({ "n": n, "distinct_sessions": sessions, "measured": measured, "why": why, "betas": betas_obj }));
    }

    let overall_sessions = { let mut s: Vec<&str> = rows.iter().map(|r| r.session.as_str()).collect(); s.sort_unstable(); s.dedup(); s.len() };
    let overall_measured = overall_sessions >= MIN_DISTINCT_SESSIONS;
    let overall_why = if overall_measured { None } else { Some(format!("{} distinct sessions < {} (PN3) — overall alpha is printed, the reading is UNMEASURED", overall_sessions, MIN_DISTINCT_SESSIONS)) };
    let mut overall_betas = Map::new();
    for (bi, &beta) in betas.iter().enumerate() {
        let real_cov_all = real_all_of(&pass_covenant[bi]);
        let real_br_all = real_all_of(&pass_breach[bi]);
        let cov_cell = bound_cell(real_cov_all, &draws_cov_all[bi], n_rows, overall_measured, overall_why.clone());
        let br_cell = bound_cell(real_br_all, &draws_br_all[bi], n_rows, overall_measured, overall_why.clone());
        overall_betas.insert(beta_key(beta), json!({ "covenant": cov_cell.to_json(), "breach_only": br_cell.to_json() }));
    }
    let overall = json!({ "n": n_rows, "distinct_sessions": overall_sessions, "distinct_lane_sets": set_ids.len(), "measured": overall_measured, "why": overall_why, "betas": overall_betas });

    json!({ "k": k, "seed": seed, "betas": betas, "by_lane": by_lane, "overall": overall })
}

/// halves by row parity, A/B/all — mirrors kr39-aperture.mjs's apertureRead exactly: A and all share the base seed,
/// B is base seed + 1.
pub fn aperture_read(rows: &[Row], k: usize, seed_base: u32, betas: &[f64]) -> Value {
    let a: Vec<Row> = rows.iter().filter(|r| r.i % 2 == 0).cloned().collect();
    let b: Vec<Row> = rows.iter().filter(|r| r.i % 2 == 1).cloned().collect();
    let ra = aperture_core(&a, k, seed_base, betas);
    let rb = aperture_core(&b, k, seed_base.wrapping_add(1), betas);
    let rall = aperture_core(rows, k, seed_base, betas);
    json!({ "engine": "rust-aperture-read", "k": k, "seed": seed_base, "betas": betas, "A": ra, "B": rb, "all": rall })
}

fn parse_betas(s: &str) -> Vec<f64> { let v: Vec<f64> = s.split(',').filter_map(|x| x.trim().parse::<f64>().ok()).collect(); if v.is_empty() { DEFAULT_BETAS.to_vec() } else { v } }

fn parse_rows(doc: &Value) -> Vec<Row> {
    let mut out = Vec::new();
    for r in doc["rows"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let i = match r["i"].as_u64() { Some(x) => x as usize, None => continue };
        let session = r["session"].as_str().unwrap_or("").to_string();
        let domain = r["domain"].as_str().unwrap_or("").to_string();
        if domain.is_empty() { continue; }
        let delivered: Vec<String> = r["delivered"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
        let touched: Vec<String> = r["touched"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
        let off_ok = r["off_ok"].as_i64().map(|x| x != 0).or_else(|| r["off_ok"].as_bool()).unwrap_or(false);
        let calls_ok = r["calls_ok"].as_i64().map(|x| x != 0).or_else(|| r["calls_ok"].as_bool()).unwrap_or(false);
        out.push(Row { i, session, domain, delivered, touched, off_ok, calls_ok });
    }
    out
}

pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let k: usize = arg("--k").and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_K);
    let seed: u32 = arg("--seed").and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_SEED);
    let betas = arg("--betas").map(|s| parse_betas(&s)).unwrap_or_else(|| DEFAULT_BETAS.to_vec());
    let text = match arg("--path") {
        Some(path) => match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } },
        None => { let mut s = String::new(); if std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).is_err() { eprintln!("--aperture-read: could not read stdin"); std::process::exit(2); } s }
    };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON: {}", e); std::process::exit(2); } };
    let rows = parse_rows(&doc);
    let out = aperture_read(&rows, k, seed, &betas);
    println!("{}", serde_json::to_string(&out).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(i: usize, session: &str, domain: &str, delivered: &[&str], touched: &[&str]) -> Row {
        Row { i, session: session.into(), domain: domain.into(), delivered: delivered.iter().map(|s| s.to_string()).collect(), touched: touched.iter().map(|s| s.to_string()).collect(), off_ok: true, calls_ok: true }
    }
    #[test]
    fn identical_declared_sets_give_alpha_equal_p_exactly() {
        let mut rows = Vec::new();
        for i in 0..30 { rows.push(row(i, &format!("s{}", i), "A", &["x"], if i % 3 != 0 { &["x/a"][..] } else { &["y/off"][..] })); }
        for i in 0..30 { rows.push(row(30 + i, &format!("t{}", i), "B", &["x"], if i % 5 != 0 { &["x/b"][..] } else { &["y/off"][..] })); }
        let core = aperture_core(&rows, 60, 1, &DEFAULT_BETAS);
        for lane in ["A", "B"] {
            let c = &core["by_lane"][lane];
            assert_eq!(c["measured"], true);
            for beta in ["0", "0.5"] {
                let b = &c["betas"][beta]["covenant"];
                assert_eq!(b["null_mean"], b["rate"]);
                assert_eq!(b["null_sd"], 0.0);
                assert_eq!(b["z"], 0.0);
            }
        }
    }
    #[test]
    fn all_touch_nothing_pins_alpha_equal_p() {
        // AP-R2: every row's touched set is EMPTY — breach_share returns 0 against ANY candidate set, so the real and
        // every permuted draw read identically regardless of the shuffled assignment.
        let mut rows = Vec::new();
        for i in 0..40 { rows.push(row(i, &format!("s{}", i), "L", &["x"], &[])); }
        for i in 0..20 { rows.push(row(40 + i, &format!("t{}", i), "M", &["y"], &[])); }
        let core = aperture_core(&rows, 80, 71, &DEFAULT_BETAS);
        for lane in ["L", "M"] {
            let c = &core["by_lane"][lane]["betas"]["0"]["covenant"];
            assert_eq!(c["rate"], c["alpha"], "alpha must equal P exactly when every row touches nothing");
            assert_eq!(c["null_sd"], 0.0);
        }
    }
    #[test]
    fn two_runs_print_byte_identical_json() {
        let mut rows = Vec::new();
        for i in 0..24 { rows.push(row(i, &format!("s{}", i % 21), if i % 2 == 0 { "A" } else { "B" }, &["x"], &["x/f"])); }
        let a = serde_json::to_string(&aperture_read(&rows, 40, 5, &DEFAULT_BETAS)).unwrap();
        let b = serde_json::to_string(&aperture_read(&rows, 40, 5, &DEFAULT_BETAS)).unwrap();
        assert_eq!(a, b);
    }
}
