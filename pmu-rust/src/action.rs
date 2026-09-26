// src/action.rs — THE ACTION READ, IN THE CRATE (spec §8.31; operator 2026-09-16: "refine the rust as well — migrate to rust").
//
// The knob ratchet's objective, the maintenance meter and every KR reading since KR14 scored placements against the action
// with a JavaScript function: hit := placement within `tol` blocks of the target; null := the targets permuted across rows,
// K draws; z := (rate − null mean) / null sd, per interleaved half. That function now lives here, driven by the same LCG
// idiom the JS used (32-bit Numerical Recipes: s ← 1664525·s + 1013904223, u = s / 2³²) and the same Fisher–Yates order,
// so the two engines agree to rounding on identical input (the parity guard says how closely), and the harness can
// enumerate the properties the JS could only test: PN2 the null is an exact permutation (constant targets ⇒ null mean ==
// rate, sd 0) · PN3 a half whose rows share fewer than MIN_DISTINCT_TARGETS distinct target cells is UNMEASURED however
// large its z (KR23: six commits wore the n of 1,752 rows) · N3 every draw keeps the target multiset.
//
// LLM-free. No clock. Two runs print byte-identical JSON.
//   pmu-onchip --action-read --path rows.json [--k 300] [--seed 41] [--tol 2]
//   rows.json: { "rows": [ { "i": 0, "final": [r, c], "target": [r, c] }, … ] }   (rows without a final or target are skipped)
use serde_json::{json, Value};

pub const MIN_DISTINCT_TARGETS: usize = 20;

pub struct Row { pub i: usize, pub fin: [i64; 2], pub target: [i64; 2] }

/// the JS engines' LCG, bit for bit: Math.imul(s, 1664525) + 1013904223 >>> 0, then s / 4294967296
pub struct Lcg32(pub u32);
impl Lcg32 {
    pub fn next(&mut self) -> f64 { self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223); self.0 as f64 / 4294967296.0 }
}
/// Fisher–Yates from the end, w = floor(u · (j+1)) — the JS order, so the draws coincide
pub fn shuffle_in_place<T>(v: &mut [T], rng: &mut Lcg32) {
    if v.len() < 2 { return; }
    let mut j = v.len() - 1;
    while j > 0 { let w = (rng.next() * ((j + 1) as f64)).floor() as usize; v.swap(j, w); j -= 1; }
}
fn cheb(a: &[i64; 2], b: &[i64; 2]) -> i64 { (a[0] - b[0]).abs().max((a[1] - b[1]).abs()) }
fn r3(x: f64) -> f64 { (x * 1000.0).round() / 1000.0 }
fn r2(x: f64) -> f64 { (x * 100.0).round() / 100.0 }

#[derive(Clone, Debug)]
pub struct HalfRead { pub n: usize, pub hits: usize, pub rate: Option<f64>, pub null_mean: Option<f64>, pub null_sd: Option<f64>, pub z: Option<f64>, pub distinct_targets: usize, pub max_rows_one_target: usize, pub measured: bool, pub why: Option<String> }

impl HalfRead {
    pub fn to_json(&self) -> Value {
        json!({ "n": self.n, "hits": self.hits, "rate": self.rate, "null_mean": self.null_mean, "null_sd": self.null_sd, "z": self.z,
                "distinct_targets": self.distinct_targets, "max_rows_one_target": self.max_rows_one_target, "measured": self.measured, "why": self.why })
    }
}

/// one half: the rows given (already filtered to the half), K draws from the shared rng
pub fn half_read(rows: &[Row], k: usize, tol: i64, rng: &mut Lcg32) -> HalfRead {
    let mut per: std::collections::BTreeMap<(i64, i64), usize> = std::collections::BTreeMap::new();
    for r in rows { *per.entry((r.target[0], r.target[1])).or_insert(0) += 1; }
    let distinct = per.len(); let max_one = per.values().copied().max().unwrap_or(0);
    if rows.len() < 20 {
        return HalfRead { n: rows.len(), hits: 0, rate: None, null_mean: None, null_sd: None, z: None, distinct_targets: distinct, max_rows_one_target: max_one, measured: false, why: Some("fewer than 20 scorable rows".into()) };
    }
    let hit_rate = |ts: &[[i64; 2]]| rows.iter().zip(ts.iter()).filter(|(r, t)| cheb(&r.fin, t) <= tol).count() as f64 / rows.len() as f64;
    let base: Vec<[i64; 2]> = rows.iter().map(|r| r.target).collect();
    let real = hit_rate(&base);
    let mut draws = Vec::with_capacity(k);
    for _ in 0..k { let mut ts = base.clone(); shuffle_in_place(&mut ts, rng); draws.push(hit_rate(&ts)); }
    let m = draws.iter().sum::<f64>() / draws.len() as f64;
    let sd = (draws.iter().map(|d| (d - m) * (d - m)).sum::<f64>() / draws.len() as f64).sqrt();
    let z = if sd > 1e-9 { r2((real - m) / sd) } else { 0.0 };   // a degenerate null reads 0, never ±1 from float dust (KR19-3)
    let measured = distinct >= MIN_DISTINCT_TARGETS;
    HalfRead { n: rows.len(), hits: (real * rows.len() as f64).round() as usize, rate: Some(r3(real)), null_mean: Some(r3(m)), null_sd: Some(r3(sd)), z: Some(z), distinct_targets: distinct, max_rows_one_target: max_one, measured,
        why: if measured { None } else { Some(format!("{} distinct target cells < {} (PN3/KR23) — the z is printed, the reading is UNMEASURED", distinct, MIN_DISTINCT_TARGETS)) } }
}

/// the read: half A = even row index, half B = odd; ONE rng, A drawn before B (the JS order)
pub fn action_read(rows: &[Row], k: usize, seed: u32, tol: i64) -> (HalfRead, HalfRead) {
    let mut rng = Lcg32(seed);
    let a: Vec<Row> = rows.iter().filter(|r| r.i % 2 == 0).map(|r| Row { i: r.i, fin: r.fin, target: r.target }).collect();
    let b: Vec<Row> = rows.iter().filter(|r| r.i % 2 == 1).map(|r| Row { i: r.i, fin: r.fin, target: r.target }).collect();
    let ra = half_read(&a, k, tol, &mut rng); let rb = half_read(&b, k, tol, &mut rng);
    (ra, rb)
}

fn cell(v: &Value) -> Option<[i64; 2]> { let a = v.as_array()?; if a.len() != 2 { return None; } Some([a[0].as_i64()?, a[1].as_i64()?]) }

pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let path = match arg("--path") { Some(p) => p, None => { eprintln!("--action-read needs --path rows.json"); std::process::exit(2); } };
    let k: usize = arg("--k").and_then(|s| s.parse().ok()).unwrap_or(300);
    let seed: u32 = arg("--seed").and_then(|s| s.parse().ok()).unwrap_or(41);
    let tol: i64 = arg("--tol").and_then(|s| s.parse().ok()).unwrap_or(2);
    let text = match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON in {}: {}", path, e); std::process::exit(2); } };
    let mut rows: Vec<Row> = Vec::new(); let mut skipped = 0usize;
    for r in doc["rows"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        match (r["i"].as_u64(), cell(&r["final"]), cell(&r["target"])) { (Some(i), Some(f), Some(t)) => rows.push(Row { i: i as usize, fin: f, target: t }), _ => skipped += 1 }
    }
    let (a, b) = action_read(&rows, k, seed, tol);
    let gap = |h: &HalfRead| match (h.rate, h.null_mean) { (Some(r), Some(m)) => Some(((r - m) * 10000.0).round() / 10000.0), _ => None };
    let out = json!({ "engine": "rust-action", "k": k, "seed": seed, "tol": tol, "rows": rows.len(), "skipped": skipped, "min_distinct_targets": MIN_DISTINCT_TARGETS,
                      "A": a.to_json(), "B": b.to_json(), "gap": { "A": gap(&a), "B": gap(&b) } });
    println!("{}", serde_json::to_string(&out).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn constant_targets_give_an_exact_null_and_three_targets_are_unmeasured() {
        let rows: Vec<Row> = (0..80).map(|i| Row { i, fin: if i % 4 == 0 { [0, 0] } else { [5, 5] }, target: [5, 5] }).collect();
        let (a, _) = action_read(&rows, 50, 41, 2);
        assert_eq!(a.rate, a.null_mean); assert_eq!(a.null_sd, Some(0.0)); assert_eq!(a.z, Some(0.0)); assert!(!a.measured);
    }
}
