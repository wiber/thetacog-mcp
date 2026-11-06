// .thetacog/pmu/src/steer_plan.rs — C188: /steer ORTHOGONALISES AND PARALLELISES IN THE CRATE.
//
// Operator 2026-09-23, verbatim: "do it, orthogonalise and parallelise should be built in rust for /steer".
//
// `pmu-onchip --steer-plan [--slots k] [--path file]` reads the CLEAR rows as JSON (stdin, or --path):
//     {"rows":[{"id":"C101","paths":["a.mjs","b.rs"],"pixel":"A1,B2"|null}, ...], "last_pixel":"A,B3"|null}
// and prints the BATCH that may run at once plus the queue behind it:
//     {"engine":"rust-steer-plan","metric":"l1_block","slots":k,"last_pixel":..,
//      "batch":[{"id","claim":[paths],"l1":n|null,"pixel":..}], "queue":[ids in order], "why":{id: reason not batched}}
//
// THE RULES (each one is a cargo test below):
//   (1) DISJOINT — the batch's claim sets are pairwise disjoint: two workers never touch one path.
//   (2) ONE CELL — no two batched rows share a basin cell (the 12×12 block the pixel names).
//   (3) NEAREST FIRST — placed rows are ordered by L1 walk distance on the 12×12 block grid from last_pixel
//       (ties → spec order); rows with no pixel (or an unparseable one) go last, in spec order. The crate has no
//       shared distance helper (grip-meter.mjs's house metric is Chebyshev); the spec row names L1, so the metric
//       is L1 and the output names it (`metric: "l1_block"`). With no last_pixel every row keeps spec order, l1 null.
//   (4) SLOT CAP — at most `slots` rows (≥1) in the batch; the caller reads slots from free memory, never a constant.
//   (5) A row naming NO paths cannot be proved disjoint from anything, so it runs ALONE: it is batched only into an
//       empty batch, and then the batch closes.
//   (6) PURE — identical input → identical bytes (sorted claims, BTreeMap `why`, no clock, no RNG).
//
// It DECIDES (which rows run together, in what order), so per MAXIMISE RUST it lives here; node only spawns
// (scripts/vna/steer-plan.mjs). Pixel addresses reuse lens.rs's ShortLex axis parse (shortlex_to_block).

use crate::lens::shortlex_to_block;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const METRIC: &str = "l1_block";

#[derive(Clone, Debug)]
pub struct Row {
    pub id: String,
    pub paths: Vec<String>,          // normalised, sorted, deduplicated
    pub pixel: Option<String>,       // as given
    pub cell: Option<(i64, i64)>,    // block address, None when absent or unparseable
}

/// "A1,B2" → (row block, col block) on the 12×12 grid; None unless both axes resolve.
pub fn parse_cell(pixel: &str) -> Option<(i64, i64)> {
    if !pixel.contains(',') { return None; }
    let (r, c) = shortlex_to_block(pixel);
    if r < 0 || c < 0 { None } else { Some((r, c)) }
}

pub fn l1(a: (i64, i64), b: (i64, i64)) -> i64 { (a.0 - b.0).abs() + (a.1 - b.1).abs() }

fn norm_path(p: &str) -> String {
    let t = p.trim();
    t.strip_prefix("./").unwrap_or(t).to_string()
}

pub fn parse_rows(doc: &Value) -> Vec<Row> {
    let arr = doc.get("rows").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for r in arr {
        let id = match r.get("id") {
            Some(Value::String(s)) => s.clone(),
            Some(v) if !v.is_null() => v.to_string(),
            _ => continue,
        };
        if !seen.insert(id.clone()) { continue; }   // a repeated id is one row: the first declaration wins
        let set: BTreeSet<String> = r.get("paths").and_then(|v| v.as_array()).map(|a| {
            a.iter().filter_map(|p| p.as_str()).map(norm_path).filter(|p| !p.is_empty()).collect()
        }).unwrap_or_default();
        let pixel = r.get("pixel").and_then(|v| v.as_str()).map(|s| s.to_string());
        let cell = pixel.as_deref().and_then(parse_cell);
        out.push(Row { id, paths: set.into_iter().collect(), pixel, cell });
    }
    out
}

pub fn plan(rows: &[Row], last_pixel: Option<&str>, slots: usize) -> Value {
    let slots = slots.max(1);
    let origin = last_pixel.and_then(parse_cell);
    // order: placed rows nearest-first (ties → spec index), then unplaced rows in spec order
    let mut order: Vec<(usize, Option<i64>)> = rows.iter().enumerate().map(|(i, r)| {
        let d = match (origin, r.cell) { (Some(o), Some(c)) => Some(l1(o, c)), _ => None };
        (i, d)
    }).collect();
    order.sort_by(|a, b| {
        let ka = (rows[a.0].cell.is_none() || origin.is_none(), a.1.unwrap_or(0), a.0);
        let kb = (rows[b.0].cell.is_none() || origin.is_none(), b.1.unwrap_or(0), b.0);
        ka.cmp(&kb)
    });

    let mut batch: Vec<Value> = Vec::new();
    let mut queue: Vec<Value> = Vec::new();
    let mut why: BTreeMap<String, String> = BTreeMap::new();
    let mut claimed: BTreeMap<&str, &str> = BTreeMap::new();          // path → id holding it
    let mut cells: BTreeMap<(i64, i64), &str> = BTreeMap::new();      // cell → id holding it
    let mut closed_by: Option<&str> = None;                           // a no-path row runs alone

    for (i, d) in order {
        let r = &rows[i];
        let reason: Option<String> = if let Some(holder) = closed_by {
            Some(format!("batch holds {}, which names no paths and runs alone", holder))
        } else if batch.len() >= slots {
            Some(format!("slot cap: {} of {} slots full", batch.len(), slots))
        } else if r.paths.is_empty() && !batch.is_empty() {
            Some("names no paths, so it cannot be proved disjoint; it runs alone".to_string())
        } else if let Some((p, h)) = r.paths.iter().find_map(|p| claimed.get(p.as_str()).map(|h| (p, *h))) {
            Some(format!("path overlap with {}: {}", h, p))
        } else if let Some(h) = r.cell.and_then(|c| cells.get(&c).copied()) {
            Some(format!("shares basin cell {} with {}", r.pixel.as_deref().unwrap_or(""), h))
        } else { None };

        match reason {
            Some(w) => { queue.push(json!(r.id)); why.insert(r.id.clone(), w); }
            None => {
                for p in &r.paths { claimed.insert(p.as_str(), r.id.as_str()); }
                if let Some(c) = r.cell { cells.insert(c, r.id.as_str()); }
                if r.paths.is_empty() { closed_by = Some(r.id.as_str()); }
                batch.push(json!({ "id": r.id, "claim": r.paths, "l1": d, "pixel": r.pixel }));
            }
        }
    }
    let mut why_obj = Map::new();
    for (k, v) in why { why_obj.insert(k, json!(v)); }
    json!({
        "engine": "rust-steer-plan", "metric": METRIC, "slots": slots,
        "last_pixel": last_pixel, "batch": batch, "queue": queue, "why": Value::Object(why_obj),
    })
}

pub fn plan_doc(doc: &Value, slots: usize) -> Value {
    let rows = parse_rows(doc);
    let last = doc.get("last_pixel").and_then(|v| v.as_str());
    plan(&rows, last, slots)
}

pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let slots = match arg("--slots") {
        None => 1,
        Some(s) => match s.parse::<usize>() { Ok(n) if n >= 1 => n, _ => { eprintln!("--steer-plan: --slots must be an integer ≥ 1 (got {})", s); std::process::exit(2); } },
    };
    let text = match arg("--path") {
        Some(path) => match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } },
        None => { let mut s = String::new(); if std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).is_err() { eprintln!("--steer-plan: could not read stdin"); std::process::exit(2); } s }
    };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON: {}", e); std::process::exit(2); } };
    println!("{}", serde_json::to_string(&plan_doc(&doc, slots)).unwrap());
}

// C2394: AFTER A WAVE RUNS, SCORE IT — Jaccard between each row's predicted claim and the paths its commits
// actually touched (beside the called-shot Brier, scored separately on the node side per C2347/C2373), and
// report the parallelism the wave achieved: how many of its rows verified, next to `rows_per_wall_s` (rows
// verified ÷ wall seconds — a wave-local throughput, never named `sweep_rate`: that name is already C2342's,
// the rate a verdict touches a file another LIVE worker held, and reusing it here would make two different
// quantities answer to one word). Every decision lives here; node only spawns (scripts/vna/wave-report.mjs)
// and raises rows_verified_per_wave as a floor in data/vna/mission-floors.json, displayed beside the
// already-floored sweep_rate reading, through mission-measures.mjs's existing raise-only machinery (a
// higher-better floor only rises) rather than a second copy of it.
//
// `pmu-onchip --wave-report [--path file]` reads a wave as JSON (stdin, or --path):
//     {"rows":[{"id":"C101","claim":["a.mjs"],"touched":["a.mjs","b.mjs"]|null,"landed":true}, ...], "wall_s":12.4|null}
// and prints:
//     {"engine":"rust-steer-plan","report":"wave","rows":[{"id","jaccard":f64|null}],
//      "rows_total":n,"rows_verified":n,"rows_verified_per_wave":n,"wall_s":x|null,"rows_per_wall_s":f64|null}
// `touched: null` (the commit range was never read) scores that row's jaccard null, never zero — a row that
// landed with no recorded touch is UNMEASURED for the comparison, not a miss. `wall_s` absent or ≤0 leaves
// rows_per_wall_s null: a rate needs a denominator, never a guessed one.

pub struct WaveRow {
    pub id: String,
    pub claim: BTreeSet<String>,
    pub touched: Option<BTreeSet<String>>,
    pub landed: bool,
}

pub fn jaccard(a: &BTreeSet<String>, b: &BTreeSet<String>) -> Option<f64> {
    if a.is_empty() && b.is_empty() { return None; }
    let inter = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 { None } else { Some(inter as f64 / union as f64) }
}

pub fn parse_wave_rows(doc: &Value) -> Vec<WaveRow> {
    let arr = doc.get("rows").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for r in arr {
        let id = match r.get("id") {
            Some(Value::String(s)) => s.clone(),
            Some(v) if !v.is_null() => v.to_string(),
            _ => continue,
        };
        let set_of = |k: &str| -> BTreeSet<String> {
            r.get(k).and_then(|v| v.as_array()).map(|a| {
                a.iter().filter_map(|p| p.as_str()).map(norm_path).filter(|p| !p.is_empty()).collect()
            }).unwrap_or_default()
        };
        let claim = set_of("claim");
        let touched = if r.get("touched").map(|v| v.is_null()).unwrap_or(true) { None } else { Some(set_of("touched")) };
        let landed = r.get("landed").and_then(|v| v.as_bool()).unwrap_or(false);
        out.push(WaveRow { id, claim, touched, landed });
    }
    out
}

pub fn score_wave(rows: &[WaveRow], wall_s: Option<f64>) -> Value {
    let mut out_rows: Vec<Value> = Vec::new();
    let mut verified = 0usize;
    for r in rows {
        let j = r.touched.as_ref().and_then(|t| jaccard(&r.claim, t));
        out_rows.push(json!({ "id": r.id, "jaccard": j }));
        if r.landed { verified += 1; }
    }
    let rows_total = rows.len();
    let rows_per_wall_s = match wall_s {
        Some(s) if s > 0.0 => Some(verified as f64 / s),
        _ => None,
    };
    json!({
        "engine": "rust-steer-plan", "report": "wave",
        "rows": out_rows, "rows_total": rows_total, "rows_verified": verified,
        "rows_verified_per_wave": verified, "wall_s": wall_s, "rows_per_wall_s": rows_per_wall_s,
    })
}

pub fn score_wave_doc(doc: &Value) -> Value {
    let rows = parse_wave_rows(doc);
    let wall_s = doc.get("wall_s").and_then(|v| v.as_f64());
    score_wave(&rows, wall_s)
}

pub fn run_wave_report(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let text = match arg("--path") {
        Some(path) => match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } },
        None => { let mut s = String::new(); if std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).is_err() { eprintln!("--wave-report: could not read stdin"); std::process::exit(2); } s }
    };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON: {}", e); std::process::exit(2); } };
    println!("{}", serde_json::to_string(&score_wave_doc(&doc)).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        json!({ "last_pixel": "A,A", "rows": [
            { "id": "far",    "paths": ["x.rs"],            "pixel": "C3,C3" },
            { "id": "near",   "paths": ["a.mjs", "./b.rs"], "pixel": "A,B" },
            { "id": "clash",  "paths": ["b.rs"],            "pixel": "C,C" },
            { "id": "twin",   "paths": ["t.mjs"],           "pixel": "A,B" },
            { "id": "mid",    "paths": ["m.mjs"],           "pixel": "B,B" },
            { "id": "nopix",  "paths": ["n.mjs"],           "pixel": null }
        ]})
    }
    fn ids(v: &Value, k: &str) -> Vec<String> {
        v[k].as_array().unwrap().iter().map(|e| e.get("id").unwrap_or(e).as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn batch_claims_are_pairwise_disjoint() {
        let out = plan_doc(&fixture(), 10);
        let mut seen = BTreeSet::new();
        for e in out["batch"].as_array().unwrap() {
            for p in e["claim"].as_array().unwrap() { assert!(seen.insert(p.as_str().unwrap().to_string()), "path {} claimed twice", p); }
        }
        assert!(ids(&out, "queue").contains(&"clash".to_string()));
        assert!(out["why"]["clash"].as_str().unwrap().contains("path overlap with near: b.rs"));
    }

    #[test]
    fn shared_cell_splits_the_pair() {
        let out = plan_doc(&fixture(), 10);
        assert!(ids(&out, "batch").contains(&"near".to_string()));
        assert!(!ids(&out, "batch").contains(&"twin".to_string()));
        assert!(out["why"]["twin"].as_str().unwrap().contains("shares basin cell A,B with near"));
    }

    #[test]
    fn nearest_first_by_l1_then_unplaced_last() {
        let out = plan_doc(&fixture(), 10);
        // A,A=(0,0); A,B=(0,1) l1 1; B,B=(1,1) l1 2; C,C=(2,2) l1 4; C3,C3=(11,11) l1 22
        assert_eq!(ids(&out, "batch"), vec!["near", "mid", "far", "nopix"]);
        assert_eq!(ids(&out, "queue"), vec!["twin", "clash"]);
        let l1s: Vec<Value> = out["batch"].as_array().unwrap().iter().map(|e| e["l1"].clone()).collect();
        assert_eq!(l1s, vec![json!(1), json!(2), json!(22), Value::Null]);
        assert_eq!(out["metric"], json!("l1_block"));
    }

    #[test]
    fn slot_cap_holds() {
        let out = plan_doc(&fixture(), 2);
        assert_eq!(ids(&out, "batch"), vec!["near", "mid"]);
        assert_eq!(ids(&out, "queue"), vec!["twin", "clash", "far", "nopix"]);
        assert!(out["why"]["far"].as_str().unwrap().starts_with("slot cap"));
        assert_eq!(plan_doc(&fixture(), 0)["slots"], json!(1));
    }

    #[test]
    fn a_pathless_row_runs_alone() {
        let doc = json!({ "last_pixel": null, "rows": [
            { "id": "blind", "paths": [], "pixel": null },
            { "id": "ok",    "paths": ["o.rs"], "pixel": null } ]});
        let out = plan_doc(&doc, 3);
        assert_eq!(ids(&out, "batch"), vec!["blind"]);
        assert_eq!(ids(&out, "queue"), vec!["ok"]);
    }

    #[test]
    fn identical_input_prints_identical_bytes() {
        let a = serde_json::to_string(&plan_doc(&fixture(), 3)).unwrap();
        let b = serde_json::to_string(&plan_doc(&fixture(), 3)).unwrap();
        assert_eq!(a, b);
    }

    fn wave_fixture() -> Value {
        json!({ "wall_s": 10.0, "rows": [
            { "id": "half",  "claim": ["a.mjs", "b.mjs"], "touched": ["a.mjs", "c.mjs"], "landed": true },
            { "id": "exact", "claim": ["x.rs"],           "touched": ["x.rs"],            "landed": true },
            { "id": "blind", "claim": ["n.mjs"],          "touched": null,                "landed": false },
        ]})
    }

    #[test]
    fn jaccard_is_the_textbook_value() {
        let a: BTreeSet<String> = ["a.mjs", "b.mjs"].iter().map(|s| s.to_string()).collect();
        let b: BTreeSet<String> = ["a.mjs", "c.mjs"].iter().map(|s| s.to_string()).collect();
        assert!((jaccard(&a, &b).unwrap() - 1.0 / 3.0).abs() < 1e-12);
        let same: BTreeSet<String> = ["x.rs"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard(&same, &same), Some(1.0));
        assert_eq!(jaccard(&BTreeSet::new(), &BTreeSet::new()), None);
    }

    #[test]
    fn a_null_touched_scores_null_never_zero() {
        let out = score_wave_doc(&wave_fixture());
        let rows = out["rows"].as_array().unwrap();
        let by_id = |id: &str| rows.iter().find(|r| r["id"] == id).unwrap().clone();
        assert!((by_id("half")["jaccard"].as_f64().unwrap() - 1.0 / 3.0).abs() < 1e-12);
        assert_eq!(by_id("exact")["jaccard"], json!(1.0));
        assert_eq!(by_id("blind")["jaccard"], Value::Null);
    }

    #[test]
    fn rows_verified_and_rows_per_wall_s_divide_by_wall_s() {
        let out = score_wave_doc(&wave_fixture());
        assert_eq!(out["rows_total"], json!(3));
        assert_eq!(out["rows_verified"], json!(2));
        assert_eq!(out["rows_verified_per_wave"], json!(2));
        assert_eq!(out["rows_per_wall_s"], json!(0.2)); // 2 verified / 10.0 s
    }

    #[test]
    fn missing_or_zero_wall_s_leaves_rows_per_wall_s_null() {
        let mut doc = wave_fixture();
        doc["wall_s"] = Value::Null;
        assert_eq!(score_wave_doc(&doc)["rows_per_wall_s"], Value::Null);
        doc["wall_s"] = json!(0.0);
        assert_eq!(score_wave_doc(&doc)["rows_per_wall_s"], Value::Null);
    }

    #[test]
    fn wave_report_is_pure() {
        let a = serde_json::to_string(&score_wave_doc(&wave_fixture())).unwrap();
        let b = serde_json::to_string(&score_wave_doc(&wave_fixture())).unwrap();
        assert_eq!(a, b);
    }
}
