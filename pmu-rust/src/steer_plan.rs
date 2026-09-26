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
}
