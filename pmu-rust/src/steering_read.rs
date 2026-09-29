// src/steering_read.rs — KR41's STEERING-WORK ARITHMETIC, IN THE CRATE (whitespace ledger B4, house rule 11).
//
// THE DEFINITION (scripts/pmu/kr41-steering-work.mjs). Over the silent rows the lens placed in a lane:
//   P_walk(lane)    := the distribution of the walk's own final placement cell (144 cells, 12x12).
//   P_inertia(lane) := the distribution of the cell the room's PREVIOUS same-room commit's diff aggregates to.
//   W_KL(lane)  := KL(P_walk || P_inertia), Laplace pseudo-count 0.5 per cell (finite even at zero mass).
//   W_JS(lane)  := the symmetric Jensen-Shannon divergence beside it.
// THE NULL permutes which row's inertia cell pairs with which row's walk cell WITHIN the lane (pooled), and again
// within lane x room (PN4, "null_within_room"), K draws, seeded. A PERMUTATION OF THE PAIRING NEVER CHANGES EITHER
// MARGINAL (the multiset of walk cells and of inertia cells are each held fixed; only who-goes-with-whom moves), so
// for a purely marginal divergence BOTH nulls are DEGENERATE BY CONSTRUCTION: null_mean == the real value and
// null_sd == 0, EXACTLY, on every measured half, every run. SW-R2 pins this identity as PROVED, not asserted in prose.
//
// THE JS DRIVER GATHERS THE ROWS (git, the lens-receipts index, the aggregate-target cache, escape-velocity's own
// stratification) and hands this crate two JSON shapes per lane: the A half and the B half, each a plain list of
// {ref, room, walk:[r,c], inertia:[r,c]} — this file never re-derives a lane assignment or reads git; it computes the
// divergence, the two nulls, and PN3 (a half under MIN_DISTINCT distinct next-commit targets is UNMEASURED).
//
// A NOTE ON SEEDING, PRESERVED EXACTLY FROM THE JS (kr41-steering-work.mjs's own laneRead default, called with NO
// override for either half): unlike KR39/KR34's A/B split, KR41's A and B halves are read with the SAME seed — the
// pooled null uses `seed`, the within-room null uses `seed + 7`, for BOTH halves. There is no seed+1 for B here.
//
// LLM-free. No clock. The only randomness is the crate's own LCG (action::Lcg32). Two runs print byte-identical JSON.
//   pmu-onchip --steering-read [--path doc.json | < doc.json]
//   doc.json: { "k": 300, "seed": 41, "pseudo": 0.5, "min_distinct": 20,
//               "lanes": { "<lane>": { "A": [rows], "B": [rows] }, … },
//               "overall": { "A": [rows], "B": [rows] } }
//   row: { "ref": "abc1234", "room": "architect"|null, "walk": [r, c], "inertia": [r, c] }
use crate::action::{shuffle_in_place, Lcg32};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};

pub const GRID: usize = 12;
pub const CELLS: usize = GRID * GRID;
pub const DEFAULT_PSEUDO: f64 = 0.5;
pub const DEFAULT_MIN_DISTINCT: usize = 20;
pub const DEFAULT_K: usize = 300;
pub const DEFAULT_SEED: u32 = 41;

fn r4(x: f64) -> f64 { (x * 10000.0).round() / 10000.0 }
fn r2(x: f64) -> f64 { (x * 100.0).round() / 100.0 }

#[derive(Clone, Debug)]
pub struct Row { pub reff: String, pub room: String, pub walk: (usize, usize), pub inertia: (usize, usize) }

pub fn cell_index(c: (usize, usize)) -> usize { c.0 * GRID + c.1 }

/// raw counts over the 144 cells — mirrors kr41's histogram exactly (a cell outside the grid is dropped, never panics)
pub fn histogram(cells: &[(usize, usize)]) -> Vec<f64> {
    let mut counts = vec![0.0f64; CELLS];
    for &c in cells { let idx = cell_index(c); if idx < CELLS { counts[idx] += 1.0; } }
    counts
}
/// raw counts -> a probability distribution with a Laplace pseudo-count per cell (finite even at zero raw mass)
pub fn smoothed_dist(counts: &[f64], pseudo: f64) -> Vec<f64> {
    let n: f64 = counts.iter().sum();
    let total = n + CELLS as f64 * pseudo;
    counts.iter().map(|c| (c + pseudo) / total).collect()
}
/// KL(p || q) — SW-R1: non-negative, and (numerically) zero iff p == q, by Gibbs' inequality on two positive
/// distributions (every entry is strictly positive after Laplace smoothing, so no term is undefined).
pub fn kl_divergence(p: &[f64], q: &[f64]) -> f64 {
    let mut s = 0.0;
    for i in 0..p.len() { if p[i] > 0.0 { s += p[i] * (p[i] / q[i]).ln(); } }
    s
}
/// the symmetric Jensen-Shannon divergence
pub fn js_divergence(p: &[f64], q: &[f64]) -> f64 {
    let m: Vec<f64> = p.iter().zip(q.iter()).map(|(a, b)| (a + b) / 2.0).collect();
    0.5 * kl_divergence(p, &m) + 0.5 * kl_divergence(q, &m)
}

/// values[] permuted only within the groups group_key_of[] names, in FIRST-OCCURRENCE order (mirrors JS's
/// Object-key insertion order for `byGroup`, which decides the sequence the shared rng is consumed in) — the
/// multiset of each group is preserved exactly (SW-R2's within-room half).
pub fn shuffle_within_groups(values: &[(usize, usize)], group_key_of: &[String], rng: &mut Lcg32) -> Vec<(usize, usize)> {
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut first_seen: HashMap<String, usize> = HashMap::new();
    for (idx, key) in group_key_of.iter().enumerate() {
        let gi = *first_seen.entry(key.clone()).or_insert_with(|| { groups.push(Vec::new()); groups.len() - 1 });
        groups[gi].push(idx);
    }
    let mut out = values.to_vec();
    for g in &groups {
        let mut sub: Vec<(usize, usize)> = g.iter().map(|&i| values[i]).collect();
        shuffle_in_place(&mut sub, rng);
        for (k, &i) in g.iter().enumerate() { out[i] = sub[k]; }
    }
    out
}

fn stat_of(real: f64, draws: &[f64], n: usize) -> Value {
    let m = draws.iter().sum::<f64>() / draws.len() as f64;
    let sd = (draws.iter().map(|d| (d - m) * (d - m)).sum::<f64>() / draws.len() as f64).sqrt();
    let z = if sd > 1e-9 { r2((real - m) / sd) } else { 0.0 };
    json!({ "rate": r4(real), "null_mean": r4(m), "null_sd": r4(sd), "z": z, "n": n })
}

/// ONE LANE HALF READ. PN3: fewer than `min_distinct` distinct `ref` values -> UNMEASURED, why. Otherwise the pooled
/// and within-room readings, each carrying rate/null_mean/null_sd/z/n (PN1).
pub fn lane_read(rows: &[Row], k: usize, seed: u32, pseudo: f64, min_distinct: usize) -> Value {
    let mut per: BTreeMap<&str, usize> = BTreeMap::new();
    for r in rows { *per.entry(r.reff.as_str()).or_insert(0) += 1; }
    let distinct = per.len();
    if distinct < min_distinct {
        return json!({ "n": rows.len(), "distinct_targets": distinct, "measured": false,
                        "why": format!("{} distinct next-commit targets < {} (PN3)", distinct, min_distinct) });
    }
    let walk_cells: Vec<(usize, usize)> = rows.iter().map(|r| r.walk).collect();
    let p = smoothed_dist(&histogram(&walk_cells), pseudo);
    let real_inertia: Vec<(usize, usize)> = rows.iter().map(|r| r.inertia).collect();
    let q_real = smoothed_dist(&histogram(&real_inertia), pseudo);
    let kl_real = kl_divergence(&p, &q_real);
    let js_real = js_divergence(&p, &q_real);

    // pooled null: permute pairing across every row in this half
    let mut rng = Lcg32(seed);
    let mut kl_draws = Vec::with_capacity(k); let mut js_draws = Vec::with_capacity(k);
    for _ in 0..k {
        let mut shuffled = real_inertia.clone();
        shuffle_in_place(&mut shuffled, &mut rng);
        let qn = smoothed_dist(&histogram(&shuffled), pseudo);
        kl_draws.push(kl_divergence(&p, &qn)); js_draws.push(js_divergence(&p, &qn));
    }
    let pooled_kl = stat_of(kl_real, &kl_draws, rows.len());
    let pooled_js = stat_of(js_real, &js_draws, rows.len());

    // within-room null: permute pairing only inside each room (PN4) — a room-under-1 group can only return itself
    let rooms: Vec<String> = rows.iter().map(|r| if r.room.is_empty() { "\u{2205}".to_string() } else { r.room.clone() }).collect();
    let mut rng2 = Lcg32(seed.wrapping_add(7));
    let mut kl_draws_r = Vec::with_capacity(k); let mut js_draws_r = Vec::with_capacity(k);
    for _ in 0..k {
        let shuffled = shuffle_within_groups(&real_inertia, &rooms, &mut rng2);
        let qn = smoothed_dist(&histogram(&shuffled), pseudo);
        kl_draws_r.push(kl_divergence(&p, &qn)); js_draws_r.push(js_divergence(&p, &qn));
    }
    let within_kl = stat_of(kl_real, &kl_draws_r, rows.len());
    let within_js = stat_of(js_real, &js_draws_r, rows.len());

    let mut distinct_rooms: Vec<&str> = rooms.iter().map(|s| s.as_str()).collect();
    distinct_rooms.sort_unstable(); distinct_rooms.dedup();

    json!({ "n": rows.len(), "distinct_targets": distinct, "rooms": distinct_rooms.len(), "measured": true,
            "kl": { "pooled": pooled_kl, "null_within_room": within_kl },
            "js": { "pooled": pooled_js, "null_within_room": within_js } })
}

fn parse_cell(v: &Value) -> Option<(usize, usize)> { let a = v.as_array()?; if a.len() != 2 { return None; } Some((a[0].as_u64()? as usize, a[1].as_u64()? as usize)) }

fn parse_rows(v: &Value) -> Vec<Row> {
    let mut out = Vec::new();
    for r in v.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let reff = match r["ref"].as_str() { Some(s) if !s.is_empty() => s.to_string(), _ => continue };
        let room = r["room"].as_str().unwrap_or("").to_string();
        let walk = match parse_cell(&r["walk"]) { Some(c) => c, None => continue };
        let inertia = match parse_cell(&r["inertia"]) { Some(c) => c, None => continue };
        out.push(Row { reff, room, walk, inertia });
    }
    out
}

/// the whole document — mirrors kr41's main() shape: per-lane {n_total, A, B} plus one overall {A, B}.
pub fn read_doc(doc: &Value) -> Value {
    let k = doc["k"].as_u64().unwrap_or(DEFAULT_K as u64) as usize;
    let seed = doc["seed"].as_u64().unwrap_or(DEFAULT_SEED as u64) as u32;
    let pseudo = doc["pseudo"].as_f64().unwrap_or(DEFAULT_PSEUDO);
    let min_distinct = doc["min_distinct"].as_u64().unwrap_or(DEFAULT_MIN_DISTINCT as u64) as usize;

    let mut lanes_obj = Map::new();
    if let Some(lanes) = doc["lanes"].as_object() {
        let mut names: Vec<&String> = lanes.keys().collect();
        names.sort();
        for name in names {
            let entry = &lanes[name];
            let a = parse_rows(&entry["A"]);
            let b = parse_rows(&entry["B"]);
            let n_total = a.len() + b.len();
            // SAME seed for A and B — the JS calls laneRead with no override on either half (kr41's own default)
            let ra = lane_read(&a, k, seed, pseudo, min_distinct);
            let rb = lane_read(&b, k, seed, pseudo, min_distinct);
            lanes_obj.insert(name.clone(), json!({ "n_total": n_total, "A": ra, "B": rb }));
        }
    }
    let overall_a = parse_rows(&doc["overall"]["A"]);
    let overall_b = parse_rows(&doc["overall"]["B"]);
    let overall = json!({ "A": lane_read(&overall_a, k, seed, pseudo, min_distinct), "B": lane_read(&overall_b, k, seed, pseudo, min_distinct) });

    json!({ "engine": "rust-steering-read", "k": k, "seed": seed, "pseudo": pseudo, "min_distinct": min_distinct,
            "lanes": lanes_obj, "overall": overall })
}

pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let text = match arg("--path") {
        Some(path) => match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } },
        None => { let mut s = String::new(); if std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).is_err() { eprintln!("--steering-read: could not read stdin"); std::process::exit(2); } s }
    };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON: {}", e); std::process::exit(2); } };
    let out = read_doc(&doc);
    println!("{}", serde_json::to_string(&out).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(reff: &str, room: &str, walk: (usize, usize), inertia: (usize, usize)) -> Row { Row { reff: reff.into(), room: room.into(), walk, inertia } }

    #[test]
    fn kl_is_nonnegative_and_zero_iff_identical() {
        let a = smoothed_dist(&histogram(&[(0, 0), (0, 0), (1, 1), (2, 2)]), DEFAULT_PSEUDO);
        assert!(kl_divergence(&a, &a).abs() < 1e-9, "KL of a distribution against itself must be (numerically) zero");
        let b = smoothed_dist(&histogram(&[(9, 9), (9, 9), (9, 9), (9, 9)]), DEFAULT_PSEUDO);
        assert!(kl_divergence(&a, &b) > 0.0, "different distributions must give a strictly positive KL");
        // enumerate several fixture pairs — KL must never go negative
        let fixtures: [&[(usize, usize)]; 4] = [&[(0, 0), (1, 1)], &[(3, 4), (3, 4), (5, 5)], &[(11, 11)], &[(0, 0), (0, 1), (1, 0), (1, 1)]];
        for f1 in &fixtures { for f2 in &fixtures {
            let p1 = smoothed_dist(&histogram(f1), DEFAULT_PSEUDO); let p2 = smoothed_dist(&histogram(f2), DEFAULT_PSEUDO);
            assert!(kl_divergence(&p1, &p2) >= -1e-12, "KL went negative for {:?} vs {:?}", f1, f2);
        } }
    }

    #[test]
    fn sw_r2_the_pairing_null_is_degenerate_by_identity_on_any_fixture() {
        // 25 distinct targets clears PN3 (min_distinct 20); walk and inertia deliberately DIFFER so kl_real > 0 —
        // the degeneracy claim is about the NULL, not about the statistic being trivially zero.
        let rows: Vec<Row> = (0..25).map(|i| row(&format!("c{}", i), if i % 2 == 0 { "architect" } else { "voice" }, (i % GRID, (i * 3) % GRID), ((i + 5) % GRID, (i * 7) % GRID))).collect();
        let out = lane_read(&rows, 60, 41, DEFAULT_PSEUDO, DEFAULT_MIN_DISTINCT);
        assert_eq!(out["measured"], true);
        for path in [["kl", "pooled"], ["kl", "null_within_room"], ["js", "pooled"], ["js", "null_within_room"]] {
            let cell = &out[path[0]][path[1]];
            assert_eq!(cell["null_mean"], cell["rate"], "a pairing permutation cannot move a marginal divergence: {:?}", path);
            assert_eq!(cell["null_sd"], 0.0, "{:?}", path);
            assert_eq!(cell["z"], 0.0, "{:?}", path);
        }
        assert!(out["kl"]["pooled"]["rate"].as_f64().unwrap() > 0.0, "the fixture must carry a real, nonzero divergence for the degeneracy to be a finding and not a triviality");
    }

    #[test]
    fn shuffle_within_groups_preserves_each_groups_multiset() {
        let values: Vec<(usize, usize)> = (0..20).map(|i| (i % GRID, (i * 5) % GRID)).collect();
        let rooms: Vec<String> = (0..20).map(|i| if i % 3 == 0 { "architect".to_string() } else { "voice".to_string() }).collect();
        let mut rng = Lcg32(7);
        let shuffled = shuffle_within_groups(&values, &rooms, &mut rng);
        for room in ["architect", "voice"] {
            let mut before: Vec<(usize, usize)> = values.iter().zip(rooms.iter()).filter(|(_, r)| *r == room).map(|(v, _)| *v).collect();
            let mut after: Vec<(usize, usize)> = shuffled.iter().zip(rooms.iter()).filter(|(_, r)| *r == room).map(|(v, _)| *v).collect();
            before.sort(); after.sort();
            assert_eq!(before, after, "room {} multiset must survive the within-group shuffle", room);
        }
    }

    #[test]
    fn two_runs_print_byte_identical_json() {
        let rows: Vec<Row> = (0..25).map(|i| row(&format!("c{}", i), "architect", (i % GRID, i % GRID), ((i + 1) % GRID, i % GRID))).collect();
        let a = serde_json::to_string(&lane_read(&rows, 50, 41, DEFAULT_PSEUDO, DEFAULT_MIN_DISTINCT)).unwrap();
        let b = serde_json::to_string(&lane_read(&rows, 50, 41, DEFAULT_PSEUDO, DEFAULT_MIN_DISTINCT)).unwrap();
        assert_eq!(a, b);
    }
}
