// src/path_predict.rs — C612c THE PATH-PREDICTION READ, IN THE CRATE (MAXIMISE RUST: the scorer decides a verdict).
//
// THE SCORE (revised 2026-10-03, efea97971e: file recall alone is a file pre-fetcher, not a conscience). Per (note, ticking commit):
//   PRIMARY   invariant-collision recall := |flagged ∩ exercised| / |exercised|, precision := |flagged ∩ exercised| / |flagged| beside it —
//             exercised = the guards, byte ceilings and rules the commit EXERCISED (rules-for over the touched paths + the tests whose
//             files or imported modules the diff touched + any guard red at the parent or the commit), read by the node shuttle
//             at the immutable commit (W3); flagged = the invariants the note retrieved and flagged before work.
//   SECONDARY file p@k := |top-k(named) ∩ touched| / min(k, |named|), file recall := |named ∩ touched| / |touched| — never the verdict.
// THE NULL. A shuffled-row null: another pair's note from the same size band (±band of the note's bytes: named files + flagged invariants), K draws,
// seeded per label (FNV-1a 32 over "seed:label" → the crate's LCG), each draw scored against THIS pair's exercised and touched sets. Draws are
// interleaved: draw j stands in for every pair's own note at once, so the half statistic's null mean and sd come from the
// same K draws the pairs were scored against (C609a's construction, verbatim).
// HALVES by session: sessions in sorted order, each to the half currently smaller by pair count (C609a's rule, re-runnable).
// BAR: n ≥ bar.n per half AND z ≥ bar.z per half on the PRIMARY (invariant recall), else UNMEASURED with the count. A null whose sd is 0 gives no z
// (reported as such, never a large number). An arm without a finite ms is UNMEASURED — "no ms" (PN1's sibling: a cost-free
// arm cannot be compared per millisecond).
//
// Sufficient for: which walk version names where the work goes, per millisecond. Not for: whether the work was good (Rice).
// LLM-free. No clock. Two runs print byte-identical JSON.
//   pmu-onchip --path-predict [--path doc.json | < doc.json]
//   doc.json: { "k": 5, "draws": 50, "seed": "C612c", "band": 0.25, "bar": {"z": 2, "n": 20},
//               "arms": [ { "name": "ensemble", "ms": 12.3, "lit": 24.0, "heat": 4.0, "pairs": [ { "label", "session", "named": [..], "touched": [..], "flagged": [..], "exercised": [..] } ] } ] }
use crate::action::Lcg32;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashSet};

pub const DEFAULT_K: usize = 5;
pub const DEFAULT_DRAWS: usize = 50;
pub const DEFAULT_BAND: f64 = 0.25;

fn fnv32(s: &str) -> u32 { let mut h: u32 = 2166136261; for ch in s.chars() { h ^= ch as u32; h = h.wrapping_mul(16777619); } h }
fn mean(xs: &[f64]) -> f64 { if xs.is_empty() { 0.0 } else { xs.iter().sum::<f64>() / xs.len() as f64 } }
fn sd(xs: &[f64]) -> f64 { if xs.len() < 2 { return 0.0; } let m = mean(xs); (xs.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (xs.len() - 1) as f64).sqrt() }
fn r4(x: f64) -> f64 { (x * 10000.0).round() / 10000.0 }
fn f3(x: Option<f64>) -> String { match x { Some(v) if v.is_finite() => format!("{:.3}", v), _ => "—".into() } }
fn f1(x: Option<f64>) -> String { match x { Some(v) if v.is_finite() => format!("{:.1}", v), _ => "—".into() } }
fn f2(x: Option<f64>) -> String { match x { Some(v) if v.is_finite() => format!("{:.2}", v), _ => "—".into() } }

#[derive(Clone, Debug)]
pub struct Pair { pub label: String, pub session: String, pub named: Vec<String>, pub touched: Vec<String>, pub flagged: Vec<String>, pub exercised: Vec<String> }

/// (p@k, recall) of a named list against a touched set.
pub fn score(named: &[String], touched: &HashSet<String>, k: usize) -> (f64, f64) {
    if named.is_empty() || touched.is_empty() { return (0.0, 0.0); }
    let kk = k.min(named.len()).max(1);
    let top = named.iter().take(kk).filter(|n| touched.contains(*n)).count();
    let uniq: BTreeSet<&String> = named.iter().collect();
    let all = uniq.iter().filter(|n| touched.contains(**n)).count();
    (top as f64 / kk as f64, all as f64 / touched.len() as f64)
}
/// (recall, precision) of the invariants a note FLAGGED against the invariants the commit EXERCISED. A note that flags
/// nothing has recall 0 and precision 0 (a miss, never skipped).
pub fn inv_score(flagged: &[String], exercised: &HashSet<String>) -> (f64, f64) {
    if exercised.is_empty() { return (0.0, 0.0); }
    let uniq: BTreeSet<&String> = flagged.iter().collect();
    if uniq.is_empty() { return (0.0, 0.0); }
    let hit = uniq.iter().filter(|n| exercised.contains(**n)).count() as f64;
    (hit / exercised.len() as f64, hit / uniq.len() as f64)
}
fn size_of(p: &Pair) -> usize { p.named.join("\n").len() + p.flagged.join("\n").len() }
/// the four metrics, in order: invariant recall (PRIMARY), invariant precision, file p@k, file recall (SECONDARY)
fn metrics(note: &Pair, against: &Pair, k: usize) -> [f64; 4] {
    let ex: HashSet<String> = against.exercised.iter().cloned().collect();
    let t: HashSet<String> = against.touched.iter().cloned().collect();
    let (ir, ip) = inv_score(&note.flagged, &ex); let (fp, fr) = score(&note.named, &t, k);
    [ir, ip, fp, fr]
}
pub const METRICS: [&str; 4] = ["invariant_recall", "invariant_precision", "file_p_at_k", "file_recall"];

struct Row { session: String, obs: [f64; 4], null: Vec<[f64; 4]> }
fn stat(rs: &[&Row], m: usize, draws: usize) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    if rs.is_empty() { return (None, None, None, None); }
    let obs = mean(&rs.iter().map(|r| r.obs[m]).collect::<Vec<_>>());
    let nullg: Vec<f64> = (0..draws).map(|j| mean(&rs.iter().map(|r| r.null[j][m]).collect::<Vec<_>>())).collect();
    let (mu, s) = (mean(&nullg), sd(&nullg));
    (Some(obs), Some(mu), Some(s), if s > 0.0 { Some((obs - mu) / s) } else { None })
}
fn reading(rs: &[&Row], m: usize, draws: usize) -> Value {
    let (o, mu, s, z) = stat(rs, m, draws);
    json!({ "rate": o.map(r4), "null_mean": mu.map(r4), "null_sd": s.map(r4), "z": z.map(r4) })
}

/// C612h: lit = mean lit cells the arm's walk reached, heat = mean distinct heat values among them — stated beside the reading
/// (C612c's cached grid gave every ingress the same 24 lit cells at 4 heat values, so five arms were one walk); "—" when absent.
pub fn read_arm(name: &str, ms: Option<f64>, lit: Option<f64>, heat: Option<f64>, pairs: &[Pair], k: usize, draws: usize, seed: &str, band: f64, bar_z: f64, bar_n: usize) -> Value {
    let mut no_note = 0usize; let mut no_exercised = 0usize;
    let ok: Vec<&Pair> = pairs.iter().filter(|p| {
        if p.named.is_empty() && p.flagged.is_empty() { no_note += 1; return false; }
        if p.exercised.is_empty() { no_exercised += 1; return false; }
        true
    }).collect();
    let mut rows: Vec<Row> = Vec::new(); let mut no_null = 0usize;
    for p in &ok {
        let sz = size_of(p) as f64; let (lo, hi) = (sz * (1.0 - band), sz * (1.0 + band));
        let bandv: Vec<&&Pair> = ok.iter().filter(|q| q.label != p.label && (size_of(q) as f64) >= lo && (size_of(q) as f64) <= hi).collect();
        if bandv.len() < 2 { no_null += 1; continue; }
        let mut rng = Lcg32(fnv32(&format!("{}:{}", seed, p.label)));
        let null: Vec<[f64; 4]> = (0..draws).map(|_| { let q = bandv[((rng.next() * bandv.len() as f64).floor() as usize).min(bandv.len() - 1)]; metrics(q, p, k) }).collect();
        rows.push(Row { session: p.session.clone(), obs: metrics(p, p, k), null });
    }
    let sessions: BTreeSet<String> = rows.iter().map(|r| r.session.clone()).collect();
    let mut half_of = std::collections::HashMap::new(); let mut cnt = [0usize; 2];
    for s in &sessions { let n = rows.iter().filter(|r| &r.session == s).count(); let h = if cnt[0] <= cnt[1] { 0 } else { 1 }; half_of.insert(s.clone(), h); cnt[h] += n; }
    let mut halves = Vec::new(); let mut why: Vec<String> = Vec::new();
    for h in 0..2usize {
        let rs: Vec<&Row> = rows.iter().filter(|r| half_of.get(&r.session) == Some(&h)).collect();
        let tag = if h == 0 { "a" } else { "b" };
        let (_, _, _, pz) = stat(&rs, 0, draws);
        if rs.len() < bar_n { why.push(format!("n {} < {} in half {}", rs.len(), bar_n, tag)); }
        else if pz.is_none() { why.push(format!("null sd 0 in half {} — no z", tag)); }
        else if pz.unwrap() < bar_z { why.push(format!("z {:.2} < {} in half {}", pz.unwrap(), bar_z, tag)); }
        let ss: Vec<String> = sessions.iter().filter(|s| half_of.get(*s) == Some(&h)).cloned().collect();
        let mut hv = json!({ "half": tag, "n": rs.len(), "sessions": ss.len(), "session_ids": ss });
        for (m, key) in METRICS.iter().enumerate() { hv[*key] = reading(&rs, m, draws); }
        halves.push(hv);
    }
    let ms_ok = matches!(ms, Some(v) if v.is_finite() && v >= 0.0);
    if !ms_ok { why.insert(0, "arm carries no ms".into()); }
    let all: Vec<&Row> = rows.iter().collect();
    let g = |m: usize| stat(&all, m, draws);
    let (ir, irm, irs, _) = g(0); let (ip, ipm, ips, _) = g(1); let (fp, fpm, fps, _) = g(2); let (fr, frm, frs, _) = g(3);
    let z = |m: &str, h: usize| halves[h][m]["z"].as_f64();
    let na = halves[0]["n"].as_u64().unwrap_or(0); let nb = halves[1]["n"].as_u64().unwrap_or(0);
    let verdict = if why.is_empty() { "MEASURED" } else { "UNMEASURED" };
    let ms_s = if ms_ok { format!("{:.1}", ms.unwrap()) } else { "—".into() };
    let body = format!("invariant recall {} {} vs null {} (sd {}) · precision {} vs null {} (sd {}) · lit {} · heat {} · z {}|{} · n {}|{} · ms {} {} · {}",
        name, f3(ir), f3(irm), f3(irs), f3(ip), f3(ipm), f3(ips), f1(lit), f1(heat), f2(z("invariant_recall", 0)), f2(z("invariant_recall", 1)), na, nb, name, ms_s,
        if why.is_empty() { "MEASURED".to_string() } else { format!("UNMEASURED — {}", why.join("; ")) });
    let body2 = format!("files p@{} {} {} vs null {} (sd {}) · recall {} vs null {} (sd {}) · z {}|{} · n {}|{} · ms {} {} · secondary, never the verdict",
        k, name, f3(fp), f3(fpm), f3(fps), f3(fr), f3(frm), f3(frs), f2(z("file_p_at_k", 0)), f2(z("file_p_at_k", 1)), na, nb, name, ms_s);
    let mut out = json!({ "arm": name, "ms": if ms_ok { json!(r4(ms.unwrap())) } else { Value::Null }, "lit": lit.filter(|v| v.is_finite()).map(r4), "heat": heat.filter(|v| v.is_finite()).map(r4), "verdict": verdict, "why": why,
        "halves": halves, "scored": rows.len(), "no_note": no_note, "no_exercised": no_exercised, "no_null": no_null,
        "body": body, "body2": body2,
        "min_half_z": match (z("invariant_recall", 0), z("invariant_recall", 1)) { (Some(a), Some(b)) => json!(r4(a.min(b))), _ => Value::Null } });
    let tri = |o: Option<f64>, m: Option<f64>, s: Option<f64>| json!({ "rate": o.map(r4), "null_mean": m.map(r4), "null_sd": s.map(r4) });
    out["invariant_recall"] = tri(ir, irm, irs); out["invariant_precision"] = tri(ip, ipm, ips);
    out["file_p_at_k"] = tri(fp, fpm, fps); out["file_recall"] = tri(fr, frm, frs);
    out
}

pub fn read_doc(doc: &Value) -> Value {
    let k = doc["k"].as_u64().map(|x| x as usize).unwrap_or(DEFAULT_K).max(1);
    let draws = doc["draws"].as_u64().map(|x| x as usize).unwrap_or(DEFAULT_DRAWS).max(2);
    let seed = doc["seed"].as_str().unwrap_or("C612c").to_string();
    let band = doc["band"].as_f64().unwrap_or(DEFAULT_BAND);
    let bar_z = doc["bar"]["z"].as_f64().unwrap_or(2.0);
    let bar_n = doc["bar"]["n"].as_u64().map(|x| x as usize).unwrap_or(20);
    let strs = |v: &Value| -> Vec<String> { v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default() };
    let mut arms = Vec::new();
    for a in doc["arms"].as_array().cloned().unwrap_or_default() {
        let name = a["name"].as_str().unwrap_or("?").to_string();
        let pairs: Vec<Pair> = a["pairs"].as_array().cloned().unwrap_or_default().iter().map(|p| Pair {
            label: p["label"].as_str().unwrap_or("").to_string(),
            session: p["session"].as_str().map(String::from).unwrap_or_else(|| p["label"].as_str().unwrap_or("").to_string()),
            named: strs(&p["named"]), touched: strs(&p["touched"]), flagged: strs(&p["flagged"]), exercised: strs(&p["exercised"]) }).collect();
        arms.push(read_arm(&name, a["ms"].as_f64(), a["lit"].as_f64(), a["heat"].as_f64(), &pairs, k, draws, &seed, band, bar_z, bar_n));
    }
    // line 1: a MEASURED arm first, else the highest min-half z, ties by name — never a naked z (every body carries rate · null · sd · n · ms)
    let mut order: Vec<usize> = (0..arms.len()).collect();
    order.sort_by(|&i, &j| {
        let m = |x: &Value| (x["verdict"] == "MEASURED") as i32;
        let z = |x: &Value| x["min_half_z"].as_f64().unwrap_or(f64::NEG_INFINITY);
        m(&arms[j]).cmp(&m(&arms[i])).then(z(&arms[j]).partial_cmp(&z(&arms[i])).unwrap_or(std::cmp::Ordering::Equal)).then(arms[i]["arm"].as_str().cmp(&arms[j]["arm"].as_str()))
    });
    let lines: Vec<String> = arms.iter().map(|a| format!("C612c {}: {}", a["arm"].as_str().unwrap_or("?"), a["body"].as_str().unwrap_or(""))).collect();
    let line2 = match order.first() { Some(&i) => format!("C612c {}", arms[i]["body2"].as_str().unwrap_or("")), None => "C612c files: UNMEASURED — no arm".into() };
    let line = match order.first() { Some(&i) => format!("C612c: {}", arms[i]["body"].as_str().unwrap_or("")), None => "C612c: UNMEASURED — no arm was handed to the scorer".into() };
    json!({ "row": "C612c", "engine": "pmu-onchip --path-predict", "llm": false, "k": k, "draws": draws, "seed": seed, "band": band,
        "bar": { "z": bar_z, "n": bar_n }, "primary": "invariant_recall", "secondary": "file_p_at_k + file_recall", "line": line, "line2": line2, "lines": lines, "arms": arms })
}

pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let text = match arg("--path") {
        Some(path) => match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } },
        None => { let mut s = String::new(); if std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).is_err() { eprintln!("--path-predict: could not read stdin"); std::process::exit(2); } s }
    };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON: {}", e); std::process::exit(2); } };
    println!("{}", serde_json::to_string(&read_doc(&doc)).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_naming_scores_one() {
        let t: HashSet<String> = ["a".to_string(), "b".to_string()].into_iter().collect();
        assert_eq!(score(&["a".into(), "b".into()], &t, 5), (1.0, 1.0));
        assert_eq!(score(&["x".into()], &t, 5), (0.0, 0.0));
    }
}

// ── C612p: THE BINDING, THE WEIGHTS AND THE RATCHET VECTOR, IN THE CRATE (MAXIMISE RUST — port rows C612h · C612m · C612o-vector) ──
// The deciders that scripts/vna/path-prediction.mjs and scripts/pmu/lens-aperture-ratchet.mjs proved, moved beside the scorer:
//   bound_invariants   C612h — an invariant counts only when BOUND to a path, read at the immutable commit (W3): a test at <at> that
//                      imports the path (a relative specifier resolving to it) or names its exact path · a CLAUDE.md / claude-rules
//                      section (heading → next heading) naming the exact path (the _CLAUDE.md.full-* archive excluded) · a size
//                      ceiling (a size-reading test that names it, or the file's own first 40 lines declaring a KB/MB/bytes limit).
//   weighted_invariants + flag_top   C612m — each bound id weighted by specificity (1 / the non-test files present at <at> its
//                      binder imports or names, summed over the note's paths it binds), the note's top FLAG_K = 12, ties by id.
//   vector_verdict     C612o-vector — every measure vs its floor within min(EPS, the floor reading's null sd); a window measure past
//                      its floor rolls back, a file-scope one holds; promote only when none fell and one rose; old-walk never floors.
// Blobs are read through ONE `git cat-file --batch` per process at <rev>:<path>; the three greps over tests/ and the ls-tree run as
// concurrent git children. The mjs keeps only the spawn and the file shuttle; its old path stays behind C612P_ENGINE=mjs as the
// reference, and the JS regexes are reproduced here by hand (lookbehind, \b, \s and backtracking order included) so the two agree
// byte for byte — proven by tests/vna/c612p-the-binding-and-the-vector-in-the-crate.test.mjs.
//   pmu-onchip --path-bind < { repo, queries: [{ at, paths, weigh?, k? }], flag?: [{ weighted: [{id, weight}], k }], probe?: {...} }
//   pmu-onchip --aperture-verdict < { floor, vec, min_turns, walk_epoch, eps }   (or { cases: [ ... ] })
// Sufficient for: which invariants a path is bound to at a commit, how specifically, and the ratchet's action. Not for: whether
// the work was good (Rice). LLM-free. No clock.
pub mod bind {
    use serde_json::{json, Value};
    use std::cmp::Ordering;
    use std::collections::{HashMap, HashSet};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
    use std::sync::Arc;
    use rayon::prelude::*;

    pub const FLAG_K: usize = 12;
    pub const EPS: f64 = 0.02;
    pub const MEASURES: [&str; 5] = ["E", "recall", "invariant_recall", "repo_as_spec_gain", "token_savings"];
    const RULE_DIR: &str = "docs/architecture/claude-rules/";
    #[allow(dead_code)] // C625: the patterns size_read / size_limit match by hand (they were the two git grep -E)
    const SIZE_READ: &str = r"statSync\([^)]*\)\.size|byteLength";
    #[allow(dead_code)]
    const SIZE_LIMIT: &str = r"(size|bytes|Bytes|byteLength\([^)]*\))[[:space:]]*<=?[[:space:]]*[A-Z0-9_]|[Cc]eiling|CEILING|MAX_BYTES";

    // ── the JS semantics this port must keep ──────────────────────────────────────────────────────────────────────────────
    /// JS \s: WhiteSpace + LineTerminator.
    pub fn js_ws(c: u32) -> bool { matches!(c, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff) }
    /// JS string order (UTF-16 code units), the order Array.prototype.sort and < use.
    pub fn js_cmp(a: &str, b: &str) -> Ordering { a.encode_utf16().cmp(b.encode_utf16()) }
    fn is_w(b: u8) -> bool { b.is_ascii_alphanumeric() || b == b'_' }
    fn is_c(b: u8) -> bool { is_w(b) || b == b'.' || b == b'-' }
    fn js_trim(s: &str) -> &str { s.trim_matches(|c: char| js_ws(c as u32)) }

    /// isTest: /(^|\/)tests?\//.test(p) && /\.test\.m?[jt]s$/.test(p)
    pub fn is_test(p: &str) -> bool {
        (p.starts_with("test/") || p.starts_with("tests/") || p.contains("/test/") || p.contains("/tests/"))
            && [".test.js", ".test.ts", ".test.mjs", ".test.mts"].iter().any(|s| p.ends_with(s))
    }
    /// node:path posix.normalize
    pub fn posix_normalize(path: &str) -> String {
        if path.is_empty() { return ".".into(); }
        let abs = path.starts_with('/');
        let trail = path.ends_with('/');
        let mut st: Vec<&str> = Vec::new();
        for seg in path.split('/') {
            if seg.is_empty() || seg == "." { continue; }
            if seg == ".." {
                if !st.is_empty() && *st.last().unwrap() != ".." { st.pop(); } else if !abs { st.push(".."); }
            } else { st.push(seg); }
        }
        let mut s = st.join("/");
        if s.is_empty() {
            if abs { return "/".into(); }
            return if trail { "./".into() } else { ".".into() };
        }
        if trail { s.push('/'); }
        if abs { format!("/{}", s) } else { s }
    }
    /// node:path posix.join(a, b)
    pub fn posix_join(a: &str, b: &str) -> String {
        let j: Vec<&str> = [a, b].into_iter().filter(|x| !x.is_empty()).collect();
        if j.is_empty() { return ".".into(); }
        posix_normalize(&j.join("/"))
    }
    /// node:path posix.dirname
    pub fn posix_dirname(p: &str) -> String {
        let b = p.as_bytes();
        if b.is_empty() { return ".".into(); }
        let root = b[0] == b'/';
        let mut end: isize = -1;
        let mut matched = true;
        let mut i = b.len() as isize - 1;
        while i >= 1 {
            if b[i as usize] == b'/' { if !matched { end = i; break; } } else { matched = false; }
            i -= 1;
        }
        if end == -1 { return if root { "/".into() } else { ".".into() }; }
        if root && end == 1 { return "//".into(); }
        p[..end as usize].to_string()
    }
    /// node:path posix.basename (no ext)
    pub fn posix_basename(p: &str) -> String {
        let b = p.as_bytes();
        let (mut start, mut end): (usize, isize) = (0, -1);
        let mut matched = true;
        let mut i = b.len() as isize - 1;
        while i >= 0 {
            if b[i as usize] == b'/' { if !matched { start = i as usize + 1; break; } } else if end == -1 { matched = false; end = i + 1; }
            i -= 1;
        }
        if end == -1 { return String::new(); }
        p[start..end as usize].to_string()
    }
    fn find_from(t: &[u8], pat: &[u8], from: usize) -> Option<usize> {
        if from > t.len() { return None; }
        if pat.is_empty() { return Some(from); }
        if pat.len() > t.len() - from { return None; }
        let first = pat[0];
        let last = t.len() - pat.len();
        let mut i = from;
        while i <= last {
            if t[i] == first && &t[i..i + pat.len()] == pat { return Some(i); }
            i += 1;
        }
        None
    }
    /// namesExactPath: (?<![A-Za-z0-9_./-])<p>(?![A-Za-z0-9_/-]|\.[A-Za-z0-9]) anywhere in text.
    pub fn names_exact_path(text: &str, p: &str) -> bool {
        let t = text.as_bytes();
        let pb = p.as_bytes();
        let mut from = 0;
        while let Some(i) = find_from(t, pb, from) {
            let e = i + pb.len();
            let pre = i == 0 || !(is_c(t[i - 1]) || t[i - 1] == b'/');
            let post = e >= t.len() || {
                let c = t[e];
                !(is_w(c) || c == b'/' || c == b'-') && !(c == b'.' && e + 1 < t.len() && t[e + 1].is_ascii_alphanumeric())
            };
            if pre && post { return true; }
            from = i + 1;
        }
        false
    }
    fn lit(cs: &[char], i: usize, s: &str) -> Option<usize> {
        let mut j = i;
        for ch in s.chars() { if cs.get(j) != Some(&ch) { return None; } j += 1; }
        Some(j)
    }
    fn ws_star(cs: &[char], mut i: usize) -> usize { while i < cs.len() && js_ws(cs[i] as u32) { i += 1; } i }
    fn spec_at(cs: &[char], i: usize) -> Option<(usize, String)> {
        let wordc = |c: char| c.is_ascii_alphanumeric() || c == '_';
        if i > 0 && wordc(cs[i - 1]) { return None; }   // \b before a word-char literal
        let j = if let Some(k) = lit(cs, i, "from") { ws_star(cs, k) }
        else if let Some(k) = lit(cs, i, "import") { let k = ws_star(cs, k); if cs.get(k) != Some(&'(') { return None; } ws_star(cs, k + 1) }
        else if let Some(k) = lit(cs, i, "require") { let k = ws_star(cs, k); if cs.get(k) != Some(&'(') { return None; } ws_star(cs, k + 1) }
        else if let Some(k) = lit(cs, i, "new") {
            let k2 = ws_star(cs, k); if k2 == k { return None; }
            let k3 = lit(cs, k2, "URL")?; let k4 = ws_star(cs, k3); if cs.get(k4) != Some(&'(') { return None; } ws_star(cs, k4 + 1)
        } else { return None; };
        if !matches!(cs.get(j), Some('\'') | Some('"')) { return None; }
        let s = j + 1;
        let mut e = s;
        while e < cs.len() && cs[e] != '\'' && cs[e] != '"' { e += 1; }
        if e == s || e >= cs.len() { return None; }
        Some((e + 1, cs[s..e].iter().collect()))
    }
    /// SPEC_RE's captures, matchAll order: (?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*)['"]([^'"]+)['"]
    pub fn specifiers(text: &str) -> Vec<String> {
        let cs: Vec<char> = text.chars().collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < cs.len() { if let Some((e, cap)) = spec_at(&cs, i) { out.push(cap); i = e; } else { i += 1; } }
        out
    }
    /// importsPath(line, testFile, p)
    pub fn imports_path(line: &str, test_file: &str, p: &str) -> bool {
        let dir = posix_dirname(test_file);
        specifiers(line).iter().any(|s| s.starts_with('.') && posix_join(&dir, s) == p)
    }
    fn wb(t: &[u8], x: usize) -> bool { (x > 0 && is_w(t[x - 1])) != (x < t.len() && is_w(t[x])) }
    fn path_at(t: &[u8], i: usize) -> Option<usize> {
        if !wb(t, i) { return None; }
        let mut ends = Vec::new();
        let mut q = i;
        loop {
            let mut e = q;
            while e < t.len() && is_c(t[e]) { e += 1; }
            if e == q || e >= t.len() || t[e] != b'/' { break; }
            q = e + 1;
            ends.push(q);
        }
        for &q in ends.iter().rev() {
            let mut r = q;
            while r < t.len() && is_c(t[r]) { r += 1; }
            let mut e = r;
            while e > q {
                if e < t.len() && t[e] == b'.' && e + 1 < t.len() && t[e + 1].is_ascii_alphabetic() {
                    let s = e + 2;
                    let mut a = s;
                    while a < t.len() && a - s < 5 && t[a].is_ascii_alphanumeric() { a += 1; }
                    let mut x = a;
                    loop { if wb(t, x) { return Some(x); } if x == s { break; } x -= 1; }
                }
                e -= 1;
            }
        }
        None
    }
    /// pathsIn: the distinct matches of /\b(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/g, first-seen order.
    pub fn paths_in(text: &str) -> Vec<String> {
        let t = text.as_bytes();
        let mut out: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut i = 0;
        while i < t.len() {
            if let Some(x) = path_at(t, i) {
                let m = text[i..x].to_string();
                if seen.insert(m.clone()) { out.push(m); }
                i = x;
            } else { i += 1; }
        }
        out
    }
    /// candidatesOf(text, file): the relative specifiers resolved against the binder's directory, then every path string.
    pub fn candidates_of(text: &str, file: &str) -> Vec<String> {
        let dir = posix_dirname(file);
        let mut out: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut add = |s: String, out: &mut Vec<String>| { if seen.insert(s.clone()) { out.push(s); } };
        for s in specifiers(text) { if s.starts_with('.') { add(posix_join(&dir, &s), &mut out); } }
        for p in paths_in(text) { if p.starts_with('.') { add(posix_join(&dir, &p), &mut out); } else { add(p, &mut out); } }
        out
    }
    /// SELF_CEILING.test(head): (?:\bunder\b|\bat most\b|\bno more than\b|\bceiling\b|≤)[^\n]{0,40}?\d[\d,_.]*\s?(?:KB|kB|MB|KiB|MiB|bytes)\b
    pub fn self_ceiling(head: &str) -> bool {
        let t: Vec<u16> = head.encode_utf16().collect();
        let w = |x: u16| x < 128 && is_w(x as u8);
        let b = |x: usize| (x > 0 && w(t[x - 1])) != (x < t.len() && w(t[x]));
        let lit16 = |i: usize, s: &str| -> Option<usize> { let mut j = i; for u in s.encode_utf16() { if t.get(j) != Some(&u) { return None; } j += 1; } Some(j) };
        let dig = |x: u16| (b'0' as u16..=b'9' as u16).contains(&x);
        for i in 0..t.len() {
            let mut starts = Vec::new();
            for word in ["under", "at most", "no more than", "ceiling"] { if b(i) { if let Some(e) = lit16(i, word) { if b(e) { starts.push(e); } } } }
            if t[i] == 0x2264 { starts.push(i + 1); }
            for g0 in starts {
                for g in 0..=40usize {
                    let d = g0 + g;
                    if g > 0 && (d - 1 >= t.len() || t[d - 1] == b'\n' as u16) { break; }
                    if d >= t.len() { break; }
                    if !dig(t[d]) { continue; }
                    let mut emax = d + 1;
                    while emax < t.len() && (dig(t[emax]) || t[emax] == b',' as u16 || t[emax] == b'_' as u16 || t[emax] == b'.' as u16) { emax += 1; }
                    for e in d + 1..=emax {
                        let mut us = vec![e];
                        if e < t.len() && js_ws(t[e] as u32) { us.push(e + 1); }
                        for u in us { for unit in ["KB", "kB", "MB", "KiB", "MiB", "bytes"] { if let Some(z) = lit16(u, unit) { if b(z) { return true; } } } }
                    }
                }
            }
        }
        false
    }
    /// the section heading: /^#{1,6}\s+(.*?)\s*$/ (no m flag; `.` stops at \r    )
    pub fn heading_of(line: &str) -> Option<String> {
        let cs: Vec<char> = line.chars().collect();
        let mut k = 0;
        while k < cs.len() && cs[k] == '#' { k += 1; }
        if k == 0 || k > 6 || k >= cs.len() || !js_ws(cs[k] as u32) { return None; }
        let rest: String = cs[k..].iter().collect();
        let mid = js_trim(&rest);
        if mid.contains(|c: char| c == '\r' || c == '\n' || c == '\u{2028}' || c == '\u{2029}') { return None; }
        Some(mid.to_string())
    }

    // ── git at the immutable commit: one cat-file --batch for blobs, concurrent children for the greps ─────────────────────
    pub struct Git { pub dir: String, cat: Option<(Child, ChildStdin, BufReader<ChildStdout>)> }
    impl Git {
        pub fn new(dir: &str) -> Self { Git { dir: dir.to_string(), cat: None } }
        fn cmd(&self, args: &[&str]) -> Command { let mut c = Command::new("git"); c.args(args).current_dir(&self.dir).stdin(Stdio::null()).stderr(Stdio::null()); c }
        pub fn out(&self, args: &[&str]) -> String {
            match self.cmd(args).output() { Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(), _ => String::new() }
        }
        #[allow(dead_code)]
        pub fn spawn(&self, args: &[&str]) -> Option<Child> { self.cmd(args).stdout(Stdio::piped()).spawn().ok() }
        #[allow(dead_code)]
        pub fn collect(c: Option<Child>) -> String {
            match c.and_then(|c| c.wait_with_output().ok()) { Some(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(), _ => String::new() }
        }
        fn drop_cat(&mut self) { if let Some((mut ch, _, _)) = self.cat.take() { let _ = ch.kill(); let _ = ch.wait(); } }
        /// C625: one object through the batch reader — None when the reader broke, Some(None) when the object is missing,
        /// else (kind, bytes)
        fn raw(&mut self, rev: &str) -> Option<Option<(String, Vec<u8>)>> {
            if self.cat.is_none() {
                let mut c = Command::new("git");
                c.args(["cat-file", "--batch"]).current_dir(&self.dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
                let mut ch = c.spawn().ok()?;
                let i = ch.stdin.take()?; let o = BufReader::new(ch.stdout.take()?); self.cat = Some((ch, i, o));
            }
            let r = (|| -> Option<Option<(String, Vec<u8>)>> {
                let (_, inp, outp) = self.cat.as_mut()?;
                if writeln!(inp, "{}", rev).is_err() || inp.flush().is_err() { return None; }
                let mut header = String::new();
                if outp.read_line(&mut header).ok()? == 0 { return None; }
                let h = header.trim_end_matches('\n');
                if h.ends_with(" missing") || h.ends_with(" ambiguous") { return Some(None); }
                let mut it = h.rsplitn(3, ' ');
                let size: usize = it.next()?.parse().ok()?;
                let kind = it.next()?.to_string();
                let mut buf = vec![0u8; size + 1];
                outp.read_exact(&mut buf).ok()?;
                buf.pop();
                Some(Some((kind, buf)))
            })();
            if r.is_none() { self.drop_cat(); }
            r
        }
        /// C625: a blob's bytes by object id (the test corpus), None when it is not a readable blob
        pub fn blob(&mut self, oid: &str) -> Option<Vec<u8>> {
            match self.raw(oid) { Some(Some((k, b))) if k == "blob" => Some(b), _ => None }
        }
        /// what `git show <rev>` prints for a blob, '' when the object is missing (the mjs gitAt), through the batch reader
        pub fn show(&mut self, rev: &str) -> String {
            if rev.contains('\n') { return self.out(&["show", rev]); }
            if self.cat.is_none() {
                let mut c = Command::new("git");
                c.args(["cat-file", "--batch"]).current_dir(&self.dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
                match c.spawn() {
                    Ok(mut ch) => { let i = ch.stdin.take().unwrap(); let o = BufReader::new(ch.stdout.take().unwrap()); self.cat = Some((ch, i, o)); }
                    Err(_) => return self.out(&["show", rev]),
                }
            }
            let r = (|| -> Option<Result<String, ()>> {
                let (_, inp, outp) = self.cat.as_mut()?;
                if writeln!(inp, "{}", rev).is_err() || inp.flush().is_err() { return None; }
                let mut header = String::new();
                if outp.read_line(&mut header).ok()? == 0 { return None; }
                let h = header.trim_end_matches('\n');
                if h.ends_with(" missing") || h.ends_with(" ambiguous") { return Some(Ok(String::new())); }
                let mut it = h.rsplitn(3, ' ');
                let size: usize = it.next()?.parse().ok()?;
                let kind = it.next()?.to_string();
                let mut buf = vec![0u8; size + 1];
                outp.read_exact(&mut buf).ok()?;
                buf.pop();
                if kind == "blob" { Some(Ok(String::from_utf8_lossy(&buf).into_owned())) } else { Some(Err(())) }
            })();
            match r {
                Some(Ok(s)) => s,
                Some(Err(())) => self.out(&["show", rev]),
                None => { self.drop_cat(); self.out(&["show", rev]) }
            }
        }
    }
    impl Drop for Git { fn drop(&mut self) { self.drop_cat(); } }

    #[derive(Clone)]
    pub struct Section { pub file: String, pub heading: String, pub text: String }
    pub struct AtData { pub sections: Vec<Section> }
    #[derive(Clone, Debug, PartialEq)]
    pub struct Bound { pub id: String, pub binding: &'static str, pub path: String }
    #[derive(Clone, Debug)]
    pub struct Weighted { pub b: Bound, pub weight: f64, pub n: usize, pub bound_paths: Vec<String> }

    fn dedupe(paths: &[String]) -> Vec<String> {
        let mut seen = HashSet::new();
        paths.iter().filter(|p| !p.is_empty() && seen.insert((*p).clone())).cloned().collect()
    }

    // ── C625: THE TEST CORPUS IN MEMORY, KEYED BY BLOB ─────────────────────────────────────────────────────────────────────
    // The first-seen bind paid one `git grep -n -I -F` over tests/ per new path set (~77 ms of the ~102 ms median C620 measured),
    // plus two `git grep -l -E` for the size reads. The Binder now holds every regular file under tests/ by object id (read once
    // through the cat-file batch; a new <at> re-reads only the blobs that changed) and answers both greps from memory, in
    // parallel across files: the -F grep's lines are the lines holding a basename in a non-binary file (git's -I: a NUL in the
    // first 8000 bytes), in tree order; the -E size reads are the two patterns matched per line by hand (size_read · size_limit).
    // The answers per (at, paths) are cached too, so a path set seen before costs a lookup.
    pub struct TBlob { pub text: String, pub binary: bool }
    pub const CORPUS_MAX_BYTES: usize = 256 << 20;
    pub const ANSWER_CACHE_MAX: usize = 4096;
    pub struct TestsAt { pub files: Vec<(String, String)>, pub oid: HashMap<String, String> }
    fn space(b: u8) -> bool { matches!(b, b' ' | b'\t' | b'\n' | 0x0b | 0x0c | b'\r') }
    /// /statSync\([^)]*\)\.size|byteLength/ on one line (git grep -E, POSIX ERE)
    pub fn size_read(line: &str) -> bool {
        if line.contains("byteLength") { return true; }
        let t = line.as_bytes(); let mut i = 0;
        while let Some(k) = find_from(t, b"statSync(", i) {
            let after = k + 9;
            if let Some(c) = t[after..].iter().position(|&b| b == b')') { if t[after + c..].starts_with(b").size") { return true; } }
            i = k + 1;
        }
        false
    }
    /// /(size|bytes|Bytes|byteLength\([^)]*\))[[:space:]]*<=?[[:space:]]*[A-Z0-9_]|[Cc]eiling|CEILING|MAX_BYTES/ on one line
    pub fn size_limit(line: &str) -> bool {
        if line.contains("Ceiling") || line.contains("ceiling") || line.contains("CEILING") || line.contains("MAX_BYTES") { return true; }
        let t = line.as_bytes();
        let tail = |mut j: usize| -> bool {
            while j < t.len() && space(t[j]) { j += 1; }
            if j >= t.len() || t[j] != b'<' { return false; }
            j += 1; if j < t.len() && t[j] == b'=' { j += 1; }
            while j < t.len() && space(t[j]) { j += 1; }
            j < t.len() && (t[j].is_ascii_uppercase() || t[j].is_ascii_digit() || t[j] == b'_')
        };
        for i in 0..t.len() {
            for w in [&b"size"[..], b"bytes", b"Bytes"] { if t[i..].starts_with(w) && tail(i + w.len()) { return true; } }
            if t[i..].starts_with(b"byteLength(") {
                let a = i + 11;
                if let Some(c) = t[a..].iter().position(|&b| b == b')') { if tail(a + c + 1) { return true; } }
            }
        }
        false
    }

    // ── C625: THE ROW PICK (path-prediction.mjs namedOf, ported) ───────────────────────────────────────────────────────────
    /// the ≤ PICK_MAX_ROWS spec rows holding the most of a walk cut's heat → the files they name. Each row is scored by the heat
    /// it holds ÷ its cell count (Σ in cell order from 0, as the mjs reduce), rows with score > 0 kept, sorted by score
    /// descending then id (JS string order), the first PICK_MAX_ROWS taken; named = their `named` (else pathsIn(text)), first
    /// seen order, deduped. A cut entry is [coord, heat] or a bare coord (heat 1); a later duplicate coord overrides (a JS Map).
    pub const PICK_MAX_ROWS: usize = 4;
    #[derive(Clone, Debug)]
    pub struct PickRow { pub id: String, pub cells: Vec<Value>, pub named: Option<Vec<String>>, pub text: Option<String> }
    fn js_key(v: &Value) -> String { match v { Value::String(s) => format!("s{}", s), Value::Number(n) => format!("n{}", n.as_f64().map(js_num_str).unwrap_or_default()), Value::Bool(b) => format!("b{}", b), Value::Null => "null".into(), other => format!("o{}", other) } }
    /// `H.get(c) || 0` added to a number: a finite or infinite number stays, true is 1, everything else 0
    fn js_heat(v: &Value) -> f64 { match v { Value::Number(n) => n.as_f64().filter(|x| !x.is_nan()).unwrap_or(0.0), Value::Bool(true) => 1.0, _ => 0.0 } }
    pub fn pick_rows(rows: &Value) -> Vec<PickRow> {
        rows.as_array().map(|a| a.iter().map(|r| PickRow {
            id: r["id"].as_str().map(String::from).unwrap_or_else(|| tostr(r.get("id"))),
            cells: r["cells"].as_array().cloned().unwrap_or_default(),
            named: r["named"].as_array().map(|n| n.iter().filter_map(|x| x.as_str().map(String::from)).collect()),
            text: r.get("text").map(|t| tostr(Some(t))),
        }).collect()).unwrap_or_default()
    }
    pub fn named_of(cut: &Value, rows: &[PickRow]) -> (Vec<String>, Vec<String>) {
        let mut h: HashMap<String, f64> = HashMap::new();
        for x in cut.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            match x { Value::Array(p) => { h.insert(js_key(p.first().unwrap_or(&Value::Null)), js_heat(p.get(1).unwrap_or(&Value::Null))); } other => { h.insert(js_key(other), 1.0); } }
        }
        let mut hit: Vec<(f64, &PickRow)> = rows.iter().map(|r| {
            let s = r.cells.iter().fold(0.0f64, |t, c| t + h.get(&js_key(c)).copied().unwrap_or(0.0)) / (r.cells.len().max(1) as f64);
            (s, r)
        }).filter(|(s, _)| *s > 0.0).collect();
        hit.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal).then_with(|| js_cmp(&a.1.id, &b.1.id)));
        hit.truncate(PICK_MAX_ROWS);
        let mut named: Vec<String> = Vec::new(); let mut seen: HashSet<String> = HashSet::new();
        for (_, r) in &hit {
            let ps = match &r.named { Some(n) => n.clone(), None => paths_in(r.text.as_deref().unwrap_or("undefined")) };
            for p in ps { if seen.insert(p.clone()) { named.push(p); } }
        }
        (hit.iter().map(|(_, r)| r.id.clone()).collect(), named)
    }

    pub struct Binder { pub git: Git, sized: HashMap<String, bool>, at: HashMap<String, std::rc::Rc<AtData>>, tree: HashMap<String, std::rc::Rc<HashMap<String, String>>>, cand: HashMap<String, std::rc::Rc<Vec<String>>>,
        tests: HashMap<String, std::rc::Rc<TestsAt>>, blobs: HashMap<String, Arc<TBlob>>, blob_bytes: usize, sizeq: HashMap<String, bool>,
        bcache: HashMap<String, Vec<Bound>>, wcache: HashMap<String, Vec<Weighted>>, index: HashMap<String, (String, std::rc::Rc<Vec<PickRow>>)> }
    impl Binder {
        pub fn new(repo: &str) -> Self { Binder { git: Git::new(repo), sized: HashMap::new(), at: HashMap::new(), tree: HashMap::new(), cand: HashMap::new(),
            tests: HashMap::new(), blobs: HashMap::new(), blob_bytes: 0, sizeq: HashMap::new(), bcache: HashMap::new(), wcache: HashMap::new(), index: HashMap::new() } }
        /// the regular files under tests/ at <at> (git ls-tree -r -z; symlinks and submodules are not grepped by git either),
        /// path order, cached per <at>
        pub fn tests_at(&mut self, at: &str) -> std::rc::Rc<TestsAt> {
            if let Some(v) = self.tests.get(at) { return v.clone(); }
            let mut files: Vec<(String, String)> = Vec::new();
            for e in self.git.out(&["ls-tree", "-r", "-z", at, "--", "tests/"]).split('\0') {
                let Some(t) = e.find('\t') else { continue };
                let meta: Vec<&str> = e[..t].split(' ').collect();
                if meta.get(1) == Some(&"blob") && matches!(meta.first(), Some(&"100644") | Some(&"100755")) { files.push((e[t + 1..].to_string(), meta.get(2).unwrap_or(&"").to_string())); }
            }
            files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
            let oid = files.iter().cloned().collect();
            let v = std::rc::Rc::new(TestsAt { files, oid });
            if self.tests.len() > 8 { self.tests.clear(); }
            self.tests.insert(at.to_string(), v.clone());
            v
        }
        fn blob_of(&mut self, oid: &str) -> Arc<TBlob> {
            if let Some(b) = self.blobs.get(oid) { return b.clone(); }
            let bytes = self.git.blob(oid).unwrap_or_default();
            let binary = bytes[..bytes.len().min(8000)].contains(&0);
            let b = Arc::new(TBlob { text: String::from_utf8_lossy(&bytes).into_owned(), binary });
            if self.blob_bytes > CORPUS_MAX_BYTES { self.blobs.clear(); self.blob_bytes = 0; }
            self.blob_bytes += b.text.len();
            self.blobs.insert(oid.to_string(), b.clone());
            b
        }
        /// what `git grep -n -I -F -e <base>… <at> -- tests/` finds, as (file, line text) in git's order, from the held corpus
        pub fn grep_tests(&mut self, at: &str, bases: &[String]) -> Vec<(String, String)> {
            let ta = self.tests_at(at);
            let held: Vec<(&str, Arc<TBlob>)> = ta.files.iter().map(|(p, o)| (p.as_str(), self.blob_of(o))).collect();
            held.par_iter().map(|(p, b)| {
                if b.binary || !bases.iter().any(|x| b.text.contains(x.as_str())) { return Vec::new(); }
                b.text.split('\n').filter(|l| bases.iter().any(|x| l.contains(x.as_str()))).map(|l| (p.to_string(), l.to_string())).collect::<Vec<_>>()
            }).collect::<Vec<_>>().into_iter().flatten().collect()
        }
        /// C625: the index the row pick reads (rows.json: { rows: [{ id, cells, named }] }), cached per (path, size, mtime)
        fn index_rows(&mut self, path: &str) -> Result<std::rc::Rc<Vec<PickRow>>, String> {
            let m = std::fs::metadata(path).map_err(|e| format!("pick: index {}: {}", path, e))?;
            let key = format!("{}:{:?}", m.len(), m.modified().ok());
            if let Some((k, v)) = self.index.get(path) { if *k == key { return Ok(v.clone()); } }
            let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| format!("pick: index {}: {}", path, e))?).map_err(|e| format!("pick: index {}: {}", path, e))?;
            let v = std::rc::Rc::new(pick_rows(&doc["rows"]));
            if self.index.len() > 8 { self.index.clear(); }
            self.index.insert(path.to_string(), (key, v.clone()));
            Ok(v)
        }
        /// the doc's pick: { cells, index: <rows.json path> } or { cells, rows: [...] } → (row ids, named files)
        pub fn pick(&mut self, p: &Value) -> Result<(Vec<String>, Vec<String>), String> {
            let cut = p.get("cells").cloned().unwrap_or(Value::Array(vec![]));
            if let Some(rows) = p.get("rows").filter(|r| r.is_array()) { return Ok(named_of(&cut, &pick_rows(rows))); }
            let path = p["index"].as_str().ok_or("pick: no index (a rows.json path) and no rows")?.to_string();
            let rows = self.index_rows(&path)?;
            Ok(named_of(&cut, &rows))
        }
        /// the size-reading tests among <files> at <at>: the mjs atCommit's sizeTests (both patterns, git grep -l -E over tests/)
        /// asked only for the test files that name a path — the same set restricted to the files the ceiling leg reads, each
        /// pathspec :(literal) so a file name is never a glob. Cached per (at, file).
        pub fn size_tests(&mut self, at: &str, files: &[String]) -> HashSet<String> {
            let todo: Vec<String> = files.iter().filter(|f| !self.sized.contains_key(&format!("{}\0{}", at, f))).cloned().collect();
            if !todo.is_empty() {
                // C625: the two `git grep -l -E` (SIZE_READ, SIZE_LIMIT) answered from the held corpus, per blob
                let ta = self.tests_at(at);
                for f in &todo {
                    let v = match ta.oid.get(f) {
                        None => false,
                        Some(o) => match self.sizeq.get(o) { Some(v) => *v, None => {
                            let b = self.blob_of(o);
                            let v = b.text.split('\n').any(size_read) && b.text.split('\n').any(size_limit);
                            self.sizeq.insert(o.clone(), v); v
                        } },
                    };
                    self.sized.insert(format!("{}\0{}", at, f), v);
                }
            }
            files.iter().filter(|f| self.sized.get(&format!("{}\0{}", at, f)) == Some(&true)).cloned().collect()
        }
        /// atCommit: the rule sections at <at>, cached per <at> (immutable)
        pub fn at_commit(&mut self, at: &str) -> std::rc::Rc<AtData> {
            if let Some(v) = self.at.get(at) { return v.clone(); }
            let ls = self.git.out(&["ls-tree", "-r", "--name-only", at, "--", RULE_DIR]);
            let mut files = vec!["CLAUDE.md".to_string()];
            files.extend(ls.split('\n').filter(|f| f.ends_with(".md") && !posix_basename(f).starts_with("_CLAUDE.md.full")).map(String::from));
            let mut sections = Vec::new();
            for f in &files {
                let text = self.git.show(&format!("{}:{}", at, f));
                if text.is_empty() { continue; }
                let mut head: Option<String> = None;
                let mut body: Vec<&str> = Vec::new();
                for l in text.split('\n') {
                    if let Some(h) = heading_of(l) {
                        if let Some(hd) = head.take() { sections.push(Section { file: f.clone(), heading: hd, text: body.join("\n") }); }
                        head = Some(h); body.clear();
                    } else { body.push(l); }
                }
                if let Some(hd) = head.take() { sections.push(Section { file: f.clone(), heading: hd, text: body.join("\n") }); }
            }
            let v = std::rc::Rc::new(AtData { sections });
            if self.at.len() > 64 { self.at.clear(); }
            self.at.insert(at.to_string(), v.clone());
            v
        }
        pub fn tree_at(&mut self, at: &str) -> std::rc::Rc<HashMap<String, String>> {
            if let Some(v) = self.tree.get(at) { return v.clone(); }
            let mut m = HashMap::new();
            for l in self.git.out(&["ls-tree", "-r", "--full-tree", at]).split('\n') {
                let Some(t) = l.find('\t') else { continue };
                let meta: Vec<&str> = l[..t].split(' ').collect();
                if meta.get(1) == Some(&"blob") { m.insert(l[t + 1..].to_string(), meta.get(2).unwrap_or(&"").to_string()); }
            }
            let v = std::rc::Rc::new(m);
            if self.tree.len() > 8 { self.tree.clear(); }
            self.tree.insert(at.to_string(), v.clone());
            v
        }
        /// C612h boundInvariants(paths, at): [{ id, binding, path }] sorted by id, one per id (first path wins)
        pub fn bound(&mut self, paths: &[String], at: &str) -> Vec<Bound> {
            let p = dedupe(paths);
            if p.is_empty() { return vec![]; }
            let ck = format!("{}\0{}", at, p.join("\n"));
            if let Some(v) = self.bcache.get(&ck) { return v.clone(); }
            let v = self.bound_fresh(&p, at);
            if self.bcache.len() > ANSWER_CACHE_MAX { self.bcache.clear(); }
            self.bcache.insert(ck, v.clone());
            v
        }
        fn bound_fresh(&mut self, p: &[String], at: &str) -> Vec<Bound> {
            let p = p.to_vec();
            let mut bases: Vec<String> = Vec::new();
            for x in &p { let b = posix_basename(x); if !bases.contains(&b) { bases.push(b); } }
            let lines = if bases.is_empty() { Vec::new() } else { self.grep_tests(at, &bases) };
            let atd = self.at_commit(at);
            let mut out: Vec<Bound> = Vec::new();
            let mut ids: HashSet<String> = HashSet::new();
            let mut add = |id: String, binding: &'static str, path: &str, out: &mut Vec<Bound>| { if ids.insert(id.clone()) { out.push(Bound { id, binding, path: path.to_string() }); } };
            for x in &p { if is_test(x) { add(format!("guard:{}", x), "guard", x, &mut out); } }
            let mut hit_order: Vec<String> = Vec::new();
            let mut hits: HashMap<String, Vec<String>> = HashMap::new();
            let mut named_order: Vec<String> = Vec::new();
            let mut named: HashMap<String, Vec<String>> = HashMap::new();
            for (file, text) in &lines {
                let (file, text) = (file.as_str(), text.as_str());
                if file.contains(':') { continue; }   // git grep's "<at>:<file>:<n>:" line could not be split on such a path either
                if text.contains(|c: char| c == '\r' || c == '\u{2028}' || c == '\u{2029}') { continue; }
                if !is_test(file) { continue; }
                for x in &p {
                    if x == file || !text.contains(&posix_basename(x)) { continue; }
                    let nm = names_exact_path(text, x);
                    if nm || imports_path(text, file, x) {
                        let e = hits.entry(file.to_string()).or_insert_with(|| { hit_order.push(file.to_string()); Vec::new() });
                        if !e.contains(x) { e.push(x.clone()); }
                    }
                    if nm {
                        let e = named.entry(file.to_string()).or_insert_with(|| { named_order.push(file.to_string()); Vec::new() });
                        if !e.contains(x) { e.push(x.clone()); }
                    }
                }
            }
            for f in &hit_order {
                let ps = &hits[f];
                let first = ps.iter().min_by(|a, b| js_cmp(a, b)).unwrap();
                add(format!("guard:{}", f), "guard", first, &mut out);
            }
            for s in atd.sections.iter() {
                for x in &p { if s.text.contains(x.as_str()) && names_exact_path(&s.text, x) { add(format!("rule:{}#{}", s.file, s.heading), "rule", x, &mut out); break; } }
            }
            let sized = if named_order.is_empty() { HashSet::new() } else { self.size_tests(at, &named_order) };
            for f in &named_order { if sized.contains(f) { for x in &named[f] { add(format!("ceiling:{}", x), "ceiling", x, &mut out); } } }
            for x in &p {
                let blob = self.git.show(&format!("{}:{}", at, x));
                let head = blob.split('\n').take(40).collect::<Vec<_>>().join("\n");
                if !head.is_empty() && self_ceiling(&head) { add(format!("ceiling:{}", x), "ceiling", x, &mut out); }
            }
            out.sort_by(|a, b| js_cmp(&a.id, &b.id));
            out
        }
        fn specificity_n(cands: &[String], tree: &HashMap<String, String>, bound: &[String]) -> usize {
            let mut s: HashSet<&str> = cands.iter().filter(|p| tree.contains_key(p.as_str()) && !is_test(p)).map(|p| p.as_str()).collect();
            for p in bound { if !is_test(p) { s.insert(p.as_str()); } }
            s.len().max(1)
        }
        /// C612m weightedInvariants(paths, at): bound() with a specificity weight per id
        pub fn weighted(&mut self, paths: &[String], at: &str) -> Vec<Weighted> {
            let p = dedupe(paths);
            let ck = format!("{}\0{}", at, p.join("\n"));
            if let Some(v) = self.wcache.get(&ck) { return v.clone(); }
            let v = self.weighted_fresh(&p, at);
            if self.wcache.len() > ANSWER_CACHE_MAX { self.wcache.clear(); }
            self.wcache.insert(ck, v.clone());
            v
        }
        fn weighted_fresh(&mut self, p: &[String], at: &str) -> Vec<Weighted> {
            let p = p.to_vec();
            let b = self.bound(&p, at);
            if b.is_empty() { return vec![]; }
            let tree = self.tree_at(at);
            let atd = self.at_commit(at);
            let mut out = Vec::new();
            for x in b {
                if x.binding == "ceiling" { let bp = vec![x.path.clone()]; out.push(Weighted { b: x, weight: 1.0, n: 1, bound_paths: bp }); continue; }
                if x.binding == "rule" {
                    let rest = &x.id["rule:".len()..];
                    let (file, heading) = match rest.split_once('#') { Some((f, h)) => (f, h), None => (rest, "") };
                    let text = atd.sections.iter().find(|y| y.file == file && y.heading == heading).map(|y| y.text.as_str()).unwrap_or("");
                    let bp: Vec<String> = p.iter().filter(|q| text.contains(q.as_str()) && names_exact_path(text, q)).cloned().collect();
                    let n = Self::specificity_n(&paths_in(text), &tree, &bp);
                    let nt = bp.iter().filter(|q| !is_test(q)).count().max(1);
                    out.push(Weighted { b: x, weight: nt as f64 / n as f64, n, bound_paths: bp });
                    continue;
                }
                let file = x.id["guard:".len()..].to_string();
                let ck = tree.get(&file).cloned().unwrap_or_else(|| format!("{}:{}", at, file));
                let cands = match self.cand.get(&ck) {
                    Some(c) => c.clone(),
                    None => {
                        let c = std::rc::Rc::new(candidates_of(&self.git.show(&format!("{}:{}", at, file)), &file));
                        if self.cand.len() > 20000 { self.cand.clear(); }
                        self.cand.insert(ck, c.clone());
                        c
                    }
                };
                let cs: HashSet<&str> = cands.iter().map(|s| s.as_str()).collect();
                let mut bp: Vec<String> = p.iter().filter(|q| **q != file && !is_test(q) && cs.contains(q.as_str())).cloned().collect();
                if bp.is_empty() && x.path != file { bp.push(x.path.clone()); }
                let n = Self::specificity_n(&cands, &tree, &bp);
                let selfb = p.contains(&file);
                let weight = (if selfb { 1.0 } else { 0.0 }) + bp.len() as f64 / n as f64;
                let bound_paths = if selfb { let mut v = vec![file.clone()]; v.extend(bp); v } else { bp };
                out.push(Weighted { b: x, weight, n, bound_paths });
            }
            out
        }
    }
    /// C612m flagTop(weighted, k): the top k by weight, ties by id
    pub fn flag_top(w: &[(String, f64)], k: usize) -> Vec<String> {
        let mut v: Vec<&(String, f64)> = w.iter().collect();
        v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal).then_with(|| js_cmp(&a.0, &b.0)));
        v.into_iter().take(k).map(|x| x.0.clone()).collect()
    }
    fn bound_json(b: &Bound) -> Value { json!({ "id": b.id, "binding": b.binding, "path": b.path }) }
    fn weighted_json(w: &Weighted) -> Value { json!({ "id": w.b.id, "binding": w.b.binding, "path": w.b.path, "weight": w.weight, "n": w.n, "bound_paths": w.bound_paths }) }
    fn strs(v: &Value) -> Vec<String> { v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default() }

    // ── the JS value semantics the vector verdict's strings and comparisons carry ──────────────────────────────────────────
    /// Number.prototype.toString()
    pub fn js_num_str(x: f64) -> String {
        if x.is_nan() { return "NaN".into(); }
        if x.is_infinite() { return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() }; }
        if x == 0.0 { return "0".into(); }
        let s = format!("{:e}", x.abs());
        let (mant, exp) = s.split_once('e').unwrap();
        let exp: i32 = exp.parse().unwrap();
        let digits: String = mant.chars().filter(|c| *c != '.').collect();
        let k = digits.len() as i32;
        let n = exp + 1;
        let body = if k <= n && n <= 21 { format!("{}{}", digits, "0".repeat((n - k) as usize)) }
            else if 0 < n && n <= 21 { format!("{}.{}", &digits[..n as usize], &digits[n as usize..]) }
            else if -6 < n && n <= 0 { format!("0.{}{}", "0".repeat((-n) as usize), digits) }
            else { let e = n - 1; let es = if e >= 0 { format!("+{}", e) } else { e.to_string() }; if k == 1 { format!("{}e{}", digits, es) } else { format!("{}.{}e{}", &digits[..1], &digits[1..], es) } };
        if x < 0.0 { format!("-{}", body) } else { body }
    }
    fn truthy(v: Option<&Value>) -> bool {
        match v { None | Some(Value::Null) => false, Some(Value::Bool(b)) => *b, Some(Value::Number(n)) => { let f = n.as_f64().unwrap_or(0.0); f != 0.0 && !f.is_nan() } Some(Value::String(s)) => !s.is_empty(), _ => true }
    }
    fn tonum(v: Option<&Value>) -> f64 {
        match v {
            None => f64::NAN, Some(Value::Null) => 0.0, Some(Value::Bool(b)) => if *b { 1.0 } else { 0.0 },
            Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
            Some(Value::String(s)) => { let t = js_trim(s); if t.is_empty() { 0.0 } else { t.parse().unwrap_or(f64::NAN) } }
            Some(Value::Array(a)) if a.is_empty() => 0.0,
            _ => f64::NAN,
        }
    }
    fn tostr(v: Option<&Value>) -> String {
        match v {
            None => "undefined".into(), Some(Value::Null) => "null".into(), Some(Value::Bool(b)) => b.to_string(),
            Some(Value::Number(n)) => js_num_str(n.as_f64().unwrap_or(f64::NAN)), Some(Value::String(s)) => s.clone(),
            Some(Value::Array(a)) => a.iter().map(|x| if x.is_null() { String::new() } else { tostr(Some(x)) }).collect::<Vec<_>>().join(","),
            Some(Value::Object(_)) => "[object Object]".into(),
        }
    }
    fn finite_num(v: Option<&Value>) -> Option<f64> { match v { Some(Value::Number(n)) => n.as_f64().filter(|f| f.is_finite()), _ => None } }
    fn js_round(x: f64) -> f64 { let f = x.floor(); if x - f >= 0.5 { f + 1.0 } else { f } }
    /// tolerance(f): EPS, never wider than one null sd of the floor's own reading
    pub fn tolerance(f: Option<&Value>, eps: f64) -> f64 {
        match finite_num(f.and_then(|f| f.get("null_sd"))) { Some(sd) if sd > 0.0 => eps.min(sd), _ => eps }
    }
    /// C612o-vector: THE VECTOR VERDICT — pure over (floor, vector). Returns (action, why).
    pub fn vector_verdict(floor: Option<&Value>, vec: &Value, min_turns: f64, walk_epoch: &str, eps: f64) -> (String, String) {
        let ms = vec.get("measures");
        for k in MEASURES {
            let m = ms.and_then(|m| m.get(k));
            if !truthy(m) || finite_num(m.and_then(|m| m.get("n"))).is_none() { return ("hold".into(), format!("measure {} lacks n — refused", k)); }
        }
        if tonum(vec.get("n")) < min_turns {
            let lineage = match vec.get("versions") { Some(Value::Array(a)) if a.len() > 1 => format!(" (lineage of {})", a.len()), _ => String::new() };
            return ("hold".into(), format!("unproven: {}/{} committed turns under {}{}", tostr(vec.get("n")), js_num_str(min_turns), tostr(vec.get("version")), lineage));
        }
        let ms = ms.unwrap();
        if ms["E"].get("epoch").and_then(|e| e.as_str()) != Some("current") {
            let ep: String = walk_epoch.encode_utf16().take(16).collect::<Vec<u16>>().iter().map(|&u| char::from_u32(u as u32).unwrap_or('\u{fffd}')).collect();
            return ("hold".into(), format!("old-walk window: turns predate the walk epoch {}Z (C612n) — never a floor", ep));
        }
        let fm = match floor {
            Some(f) if truthy(f.get("measures")) && (!truthy(f.get("epoch")) || f.get("epoch").and_then(|e| e.as_str()) == Some("current")) => f.get("measures"),
            _ => None,
        };
        let Some(fm) = fm else { return ("promote".into(), "first proven version of this walk epoch becomes the floor".into()) };
        let (mut below, mut unproven, mut rose): (Vec<String>, Vec<&str>, Vec<&str>) = (vec![], vec![], vec![]);
        for k in MEASURES {
            let f = fm.get(k);
            let c = ms.get(k);
            if !truthy(f.and_then(|f| f.get("measured"))) { continue; }
            if !truthy(c.and_then(|c| c.get("measured"))) { unproven.push(k); continue; }
            let d = tonum(c.and_then(|c| c.get("rate"))) - tonum(f.and_then(|f| f.get("rate")));
            let tol = tolerance(f, eps);
            if d < -tol {
                below.push(format!("{} {}→{} (tol {}, {})", k, tostr(f.and_then(|f| f.get("rate"))), tostr(c.and_then(|c| c.get("rate"))), js_num_str(js_round(tol * 10000.0) / 10000.0), tostr(c.and_then(|c| c.get("scope")))));
            } else if d > 0.0 { rose.push(k); }
        }
        if below.iter().any(|b| b.ends_with("window)")) { return ("rollback".into(), format!("regressed past the floor: {}", below.join(" · "))); }
        if !below.is_empty() { return ("hold".into(), format!("a measure fell past its floor: {} — nothing is bought at another's expense", below.join(" · "))); }
        if !unproven.is_empty() { return ("hold".into(), format!("unmeasured against a measured floor: {}", unproven.join(", "))); }
        if !rose.is_empty() { ("promote".into(), format!("no measure below its floor; rose: {}", rose.join(", "))) } else { ("hold".into(), "every measure within tolerance of its floor; none rose".into()) }
    }

    fn read_doc(args: &[String], who: &str) -> Value {
        let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
        let text = match arg("--path") {
            Some(p) => match std::fs::read_to_string(&p) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", p, e); std::process::exit(2); } },
            None => { let mut s = String::new(); if std::io::stdin().read_to_string(&mut s).is_err() { eprintln!("{}: could not read stdin", who); std::process::exit(2); } s }
        };
        match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("{}: bad JSON: {}", who, e); std::process::exit(2); } }
    }
    fn probe(p: &Value) -> Value {
        let pairs = |k: &str| p[k].as_array().cloned().unwrap_or_default();
        json!({
            "names": pairs("names").iter().map(|x| names_exact_path(x[0].as_str().unwrap_or(""), x[1].as_str().unwrap_or(""))).collect::<Vec<_>>(),
            "imports": pairs("imports").iter().map(|x| imports_path(x[0].as_str().unwrap_or(""), x[1].as_str().unwrap_or(""), x[2].as_str().unwrap_or(""))).collect::<Vec<_>>(),
            "paths_in": pairs("paths_in").iter().map(|x| paths_in(x.as_str().unwrap_or(""))).collect::<Vec<_>>(),
            "candidates": pairs("candidates").iter().map(|x| candidates_of(x[0].as_str().unwrap_or(""), x[1].as_str().unwrap_or(""))).collect::<Vec<_>>(),
            "self_ceiling": pairs("self_ceiling").iter().map(|x| self_ceiling(x.as_str().unwrap_or(""))).collect::<Vec<_>>(),
            "heading": pairs("heading").iter().map(|x| heading_of(x.as_str().unwrap_or(""))).collect::<Vec<_>>(),
            "is_test": pairs("is_test").iter().map(|x| is_test(x.as_str().unwrap_or(""))).collect::<Vec<_>>(),
        })
    }
    /// pmu-onchip --path-bind
    pub fn run(args: &[String]) {
        let doc = read_doc(args, "--path-bind");
        let mut b = Binder::new(doc["repo"].as_str().unwrap_or("."));
        println!("{}", serde_json::to_string(&answer(&doc, &mut b)).unwrap());
    }
    /// C620: the --path-bind answer for one doc over a Binder the caller holds — the one-shot spawn above and the daemon's
    /// {"op":"bind"} (door.rs) both answer through here, so the two routes cannot drift; the daemon keeps its Binder (the
    /// sections, trees and size reads at an immutable sha) across requests, which is what the first-seen pixel stops paying for.
    /// C625: a doc may carry `pick: { cells, index | rows }` — the row pick (named_of) runs first, its answer rides out as
    /// `pick: { rows, named }`, and a query with no `paths` binds the picked files: the lens's whole bound-guard step, one request.
    pub fn answer(doc: &Value, b: &mut Binder) -> Value {
        let mut results = Vec::new();
        let picked = doc.get("pick").filter(|p| p.is_object()).map(|p| b.pick(p));
        let pick_named: Option<Vec<String>> = match &picked { Some(Ok((_, n))) => Some(n.clone()), _ => None };
        for q in doc["queries"].as_array().cloned().unwrap_or_default() {
            let at = q["at"].as_str().unwrap_or("HEAD").to_string();
            let paths = match (&pick_named, q.get("paths")) { (Some(n), None) => n.clone(), _ => strs(&q["paths"]) };
            if q["weigh"].as_bool().unwrap_or(false) {
                let w = b.weighted(&paths, &at);
                let mut r = json!({ "at": at, "weighted": w.iter().map(weighted_json).collect::<Vec<_>>() });
                if !q["k"].is_null() {
                    let k = q["k"].as_u64().map(|k| k as usize).unwrap_or(FLAG_K);
                    r["flagged"] = json!(flag_top(&w.iter().map(|x| (x.b.id.clone(), x.weight)).collect::<Vec<_>>(), k));
                }
                results.push(r);
            } else {
                results.push(json!({ "at": at, "bound": b.bound(&paths, &at).iter().map(bound_json).collect::<Vec<_>>() }));
            }
        }
        let flags: Vec<Value> = doc["flag"].as_array().cloned().unwrap_or_default().iter().map(|f| {
            let w: Vec<(String, f64)> = f["weighted"].as_array().cloned().unwrap_or_default().iter().map(|x| (x["id"].as_str().unwrap_or("").to_string(), x["weight"].as_f64().unwrap_or(f64::NAN))).collect();
            json!(flag_top(&w, f["k"].as_u64().map(|k| k as usize).unwrap_or(FLAG_K)))
        }).collect();
        let mut out = json!({ "row": "C612p", "engine": "pmu-onchip --path-bind", "llm": false, "flag_k": FLAG_K, "results": results, "flags": flags });
        if doc.get("probe").is_some() { out["probe"] = probe(&doc["probe"]); }
        match picked { Some(Ok((rows, named))) => { out["pick"] = json!({ "rows": rows, "named": named, "max_rows": PICK_MAX_ROWS }); } Some(Err(e)) => { out["pick"] = json!({ "error": e }); } None => {} }
        out
    }
    /// pmu-onchip --aperture-verdict
    pub fn run_verdict(args: &[String]) {
        let doc = read_doc(args, "--aperture-verdict");
        let one = |d: &Value| -> Value {
            let floor = d.get("floor").filter(|f| !f.is_null());
            let min_turns = d.get("min_turns").and_then(|x| x.as_f64()).unwrap_or(20.0);
            let eps = d.get("eps").and_then(|x| x.as_f64()).unwrap_or(EPS);
            let (action, why) = vector_verdict(floor, d.get("vec").unwrap_or(&Value::Null), min_turns, d["walk_epoch"].as_str().unwrap_or(""), eps);
            json!({ "action": action, "why": why })
        };
        let out = match doc.get("cases").and_then(|c| c.as_array()) {
            Some(cs) => json!({ "row": "C612p", "engine": "pmu-onchip --aperture-verdict", "results": cs.iter().map(one).collect::<Vec<_>>() }),
            None => { let mut v = one(&doc); v["engine"] = json!("pmu-onchip --aperture-verdict"); v }
        };
        println!("{}", serde_json::to_string(&out).unwrap());
    }


    // ── C612t: THE RATCHET'S LOADERS BESIDE THE VECTOR VERDICT (port of lens-aperture-ratchet.mjs shouldOfCommit · servedIds ·
    // measureVector, its permutation null and seeded rng included). The mjs bodies stay the reference behind C612P_ENGINE=mjs.
    //   pmu-onchip --aperture-load < { repo, should: [{ sha, touched? }], served: [{ rules, sha }],
    //                                  vectors: [{ rows, version, versions?, files: { pathPrediction, repoGain }, allSavings, walk_epoch }] }
    // Sufficient for: what the ratchet's five measures read on the committed turns. Not for: whether a served rule helped (Rice).
    pub const NULL_DRAWS: usize = 50;
    pub const SEED: &str = "C612o";
    fn js_string(v: &Value) -> String { match v { Value::String(s) => s.clone(), Value::Null => "null".into(), Value::Bool(b) => b.to_string(), Value::Number(n) => n.as_f64().map(js_num_str).unwrap_or_default(), other => other.to_string() } }
    fn js_truthy(v: &Value) -> bool { match v { Value::Null => false, Value::Bool(b) => *b, Value::Number(n) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true), Value::String(s) => !s.is_empty(), _ => true } }
    /// letters and digits only — norm() in the mjs: toLowerCase, every run of [^a-z0-9] → one space, trimmed
    pub fn norm(s: &str) -> String {
        let mut o = String::with_capacity(s.len()); let mut gap = false;
        for c in s.to_lowercase().chars() { if c.is_ascii_lowercase() || c.is_ascii_digit() { if gap && !o.is_empty() { o.push(' '); } gap = false; o.push(c); } else { gap = true; } }
        o
    }
    /// the rule sections at a commit: CLAUDE.md + claude-rules/*.md (the _CLAUDE.md.full-* archive excluded), heading → next heading
    pub fn sections_at(b: &mut Binder, sha: &str) -> Vec<(String, String, String)> {
        let mut files = vec!["CLAUDE.md".to_string()];
        for f in b.git.out(&["ls-tree", "-r", "--name-only", sha, "--", RULE_DIR]).split('\n') { if f.ends_with(".md") && !posix_basename(f).starts_with("_CLAUDE.md.full") { files.push(f.to_string()); } }
        let mut out = Vec::new();
        for f in files {
            let text = b.git.show(&format!("{}:{}", sha, f)); if text.is_empty() { continue; }
            let mut head: Option<String> = None; let mut body: Vec<&str> = Vec::new();
            for l in text.split('\n') {
                if let Some(h) = heading_of(l) { if let Some(hd) = head.take() { out.push((f.clone(), hd, norm(&body.join("\n")))); } head = Some(h); body = vec![l]; } else { body.push(l); }
            }
            if let Some(hd) = head { out.push((f.clone(), hd, norm(&body.join("\n")))); }
        }
        out
    }
    /// shouldOfCommit: C612h's exercised set at the commit ∪ the files it touched, sorted
    pub fn should_of_commit(b: &mut Binder, sha: &str, touched: Option<Vec<String>>) -> Value {
        let t: Vec<String> = touched.unwrap_or_else(|| b.git.out(&["show", "--no-renames", "--name-only", "--format=", sha]).split('\n').filter(|s| !s.is_empty()).map(String::from).collect());
        let mut seen = HashSet::new(); let p: Vec<String> = t.iter().filter(|x| !x.is_empty() && seen.insert((*x).clone())).cloned().collect();
        let ex: Vec<String> = if p.is_empty() { Vec::new() } else { b.bound(&p, sha).into_iter().map(|x| x.id).collect() };
        let mut should: Vec<String> = ex.iter().chain(t.iter()).cloned().collect::<HashSet<_>>().into_iter().collect();
        should.sort_by(|a, c| js_cmp(a, c));
        json!({ "sha": sha, "touched": t, "exercised": ex, "should": should })
    }
    /// servedIds: the lens's served rules projected into the invariant namespace at the commit
    pub fn served_ids(b: &mut Binder, secs: &mut HashMap<String, std::rc::Rc<Vec<(String, String, String)>>>, rules: &[Value], sha: &str) -> Vec<String> {
        let s = match secs.get(sha) { Some(s) => s.clone(), None => { let v = std::rc::Rc::new(sections_at(b, sha)); if secs.len() > 32 { secs.clear(); } secs.insert(sha.to_string(), v.clone()); v } };
        let mut out: HashSet<String> = HashSet::new(); let mut paths: Vec<String> = Vec::new(); let mut pseen: HashSet<String> = HashSet::new();
        for r in rules {
            let whole = js_string(r);
            let first_src = if js_truthy(r) { whole.clone() } else { String::new() };
            let first = first_src.split('\n').next().unwrap_or("").trim_end_matches(|c: char| c == '\u{2026}' || c == '.');
            let mut key: String = norm(first).chars().take(32).collect();
            if let Some(i) = key.rfind(' ') { key.truncate(i); }
            if key.len() < 12 { continue; }
            for (file, heading, nm) in s.iter() { if nm.contains(&key) { out.insert(format!("rule:{}#{}", file, heading)); } }
            for p in paths_in(&whole) { if pseen.insert(p.clone()) { paths.push(p); } }
        }
        for p in &paths { out.insert(p.clone()); }
        if !paths.is_empty() { for x in b.bound(&paths, sha) { out.insert(x.id); } }
        let mut v: Vec<String> = out.into_iter().collect(); v.sort_by(|a, c| js_cmp(a, c)); v
    }
    // ── measureVector, with the JS number semantics it carries ──
    // js_round: the one above (Math.round)
    fn r4(x: Option<f64>) -> Value { match x { Some(v) if v.is_finite() => num(js_round(v * 10000.0) / 10000.0), _ => Value::Null } }
    fn num(x: f64) -> Value { if x.is_finite() && x.fract() == 0.0 && x.abs() < 9e15 { json!(x as i64) } else { json!(x) } }
    /// the mjs rng(seed): FNV-1a over the UTF-16 units, then mulberry32 — h grows as a JS double (never wrapped), read mod 2^32
    pub struct Rng { h: i64 }
    impl Rng {
        pub fn new(seed: &str) -> Self {
            let mut h: i64 = 2166136261;
            for c in seed.chars() { let mut u = [0u16; 2]; let cu = c.encode_utf16(&mut u)[0] as i32; h = (((h as u32) as i32) ^ cu).wrapping_mul(16777619) as i64; }
            Rng { h }
        }
        pub fn next(&mut self) -> f64 {
            self.h += 0x6D2B79F5;
            let tu = self.h as u32; let ti = tu as i32;
            let t = (ti ^ ((tu >> 15) as i32)).wrapping_mul(ti | 1);
            let c = (t ^ (((t as u32) >> 7) as i32)).wrapping_mul(t | 61);
            let t = t ^ ((t as i64 + c as i64) as u32 as i32);
            ((t ^ (((t as u32) >> 14) as i32)) as u32) as f64 / 4294967296.0
        }
    }
    fn mean_of(a: &[f64]) -> Option<f64> { if a.is_empty() { None } else { Some(a.iter().fold(0.0, |p, q| p + q) / a.len() as f64) } }
    fn sd_of(a: &[f64]) -> Option<f64> { let m = mean_of(a)?; if a.len() > 1 { Some((a.iter().fold(0.0, |p, q| p + (q - m).powf(2.0)) / (a.len() - 1) as f64).sqrt()) } else { None } }
    #[derive(Clone)]
    struct Turn { served: Vec<String>, should: Vec<String>, current: bool, savings: Option<f64> }
    fn equivalence(served: &[String], should: &[String]) -> Option<f64> {
        let s: HashSet<&String> = served.iter().collect(); let n: HashSet<&String> = should.iter().collect();
        let u = s.union(&n).count(); if u == 0 { return None; }
        Some(s.iter().filter(|x| n.contains(*x)).count() as f64 / u as f64)
    }
    fn recall_of(served: &[String], should: &[String]) -> Option<f64> {
        let n: HashSet<&String> = should.iter().collect(); if n.is_empty() { return None; }
        Some(served.iter().filter(|x| n.contains(x)).count() as f64 / n.len() as f64)
    }
    fn permutation_null(g: &[Turn], f: fn(&[String], &[String]) -> Option<f64>, seed: &str) -> (Option<f64>, Option<f64>) {
        if g.len() < 2 { return (None, None); }
        let mut rand = Rng::new(seed); let mut ms = Vec::new();
        for _ in 0..NULL_DRAWS {
            let mut s: Vec<&Vec<String>> = g.iter().map(|r| &r.served).collect();
            for i in (1..s.len()).rev() { let j = (rand.next() * (i + 1) as f64).floor() as usize; s.swap(i, j); }
            let v: Vec<f64> = g.iter().enumerate().filter_map(|(i, r)| f(s[i], &r.should)).collect();
            if let Some(m) = mean_of(&v) { ms.push(m); }
        }
        (mean_of(&ms), sd_of(&ms))
    }
    fn measure(rate: Option<f64>, nm: Option<f64>, nsd: Option<f64>, n: f64, scope: &str, source: &str, epoch: &str, rest: &[(&str, Value)]) -> Value {
        let mut m = json!({ "rate": r4(rate), "null_mean": r4(nm), "null_sd": r4(nsd), "n": num(n), "scope": scope, "source": source, "epoch": epoch,
            "measured": n > 0.0 && rate.map(|r| r.is_finite()).unwrap_or(false) && epoch == "current" });
        for (k, v) in rest { m[*k] = v.clone(); }
        m
    }
    fn epoch_of(ts: Option<&Value>, epoch: &str) -> &'static str { match ts { Some(t) if js_truthy(t) && js_cmp(&js_string(t), epoch) != Ordering::Less => "current", _ => "old-walk" } }
    fn pool(halves: Option<&Value>, k: Option<&str>) -> (f64, Option<f64>, Option<f64>) {
        let hs: Vec<&Value> = halves.and_then(|h| h.as_array()).map(|a| a.iter().filter(|h| h.get("n").and_then(|n| n.as_f64()).map(|n| n > 0.0).unwrap_or(false)).collect()).unwrap_or_default();
        let n = hs.iter().fold(0.0, |a, h| a + h["n"].as_f64().unwrap());
        if n == 0.0 { return (0.0, None, None); }
        let get = |h: &Value, f: &str| -> f64 { (match k { Some(k) => h.get(k).and_then(|x| x.get(f)), None => h.get(f) }).and_then(|x| x.as_f64()).unwrap_or(0.0) };
        (n, Some(hs.iter().fold(0.0, |a, h| a + h["n"].as_f64().unwrap() * get(h, "null_mean")) / n), Some((hs.iter().fold(0.0, |a, h| a + h["n"].as_f64().unwrap() * get(h, "null_sd").powf(2.0)) / n).sqrt()))
    }
    fn or_null(v: Option<&Value>) -> Value { match v { Some(x) if js_truthy(x) => x.clone(), _ => Value::Null } }
    /// measureVector(rows, version, { files, allSavings, versions }) — every measure, n on each
    pub fn measure_vector(rows: &[Value], version: &Value, versions: &[Value], files: &Value, all_savings: &[f64], walk_epoch: &str) -> Value {
        let g: Vec<Turn> = rows.iter().filter(|r| r.get("should").and_then(|s| s.as_array()).map(|a| !a.is_empty()).unwrap_or(false)).map(|r| Turn {
            served: strs(&r["served"]), should: strs(&r["should"]),
            current: match r.get("epoch") { Some(e) if js_truthy(e) => js_string(e) == "current", _ => epoch_of(r.get("ts"), walk_epoch) == "current" },
            savings: r.get("savings").and_then(|x| x.as_f64()),
        }).collect();
        let epoch = if g.is_empty() || g.iter().all(|r| r.current) { "current" } else { "old-walk" };
        let e: Vec<f64> = g.iter().filter_map(|r| equivalence(&r.served, &r.should)).collect();
        let rc: Vec<f64> = g.iter().filter_map(|r| recall_of(&r.served, &r.should)).collect();
        let sv: Vec<f64> = g.iter().filter_map(|r| r.savings).collect();
        let (mut tm, mut tsd) = (None, None);
        if !sv.is_empty() && all_savings.len() > 1 {
            let mut rand = Rng::new(&format!("{}:savings", SEED)); let mut ms = Vec::new();
            for _ in 0..NULL_DRAWS { let s: Vec<f64> = (0..sv.len()).map(|_| all_savings[(rand.next() * all_savings.len() as f64).floor() as usize]).collect(); ms.push(mean_of(&s).unwrap()); }
            tm = mean_of(&ms); tsd = sd_of(&ms);
        }
        let win = "committed turns: served vs exercised \u{222a} touched";
        let (en, esd) = permutation_null(&g, equivalence, SEED); let (rn, rsd) = permutation_null(&g, recall_of, SEED);
        let m_e = measure(mean_of(&e), en, esd, e.len() as f64, "window", win, epoch, &[]);
        let m_r = measure(mean_of(&rc), rn, rsd, rc.len() as f64, "window", win, epoch, &[]);
        let m_t = measure(mean_of(&sv), tm, tsd, sv.len() as f64, "window", "data/vna/token-savings.json ticks (C519 savings(tick))", epoch, &[]);
        let pp = &files["pathPrediction"]; let a = pp.get("arms").and_then(|x| x.as_array()).and_then(|arms| arms.iter().find(|x| x.get("arm").and_then(|y| y.as_str()) == Some("lens_d2")));
        let ir = a.and_then(|a| a.get("invariant_recall"));
        let (pn, pm, psd) = pool(a.and_then(|a| a.get("halves")), Some("invariant_recall"));
        let fnum = |o: Option<&Value>, f: &str| o.and_then(|x| x.get(f)).and_then(|x| x.as_f64());
        let nn = |o: Option<&Value>, f: &str, d: Option<f64>| match o.and_then(|x| x.get(f)) { Some(Value::Null) | None => d, Some(x) => x.as_f64() };
        let m_i = measure(fnum(ir, "rate"), nn(ir, "null_mean", pm), nn(ir, "null_sd", psd), pn, "file", "data/vna/path-prediction.json arm lens_d2", epoch_of(pp.get("at"), walk_epoch), &[("at", or_null(pp.get("at"))), ("aperture", or_null(pp.get("aperture")))]);
        let rg = &files["repoGain"]; let gg = rg.get("readings").and_then(|x| x.get("snowball-greedy"));
        let (gn, gm, gsd) = pool(gg.and_then(|g| g.get("halves")), None);
        let kind = match gg.and_then(|g| g.get("null_kind")) { Some(k) if js_truthy(k) => js_string(k), _ => "composition-matched".into() };
        let m_g = measure(fnum(gg, "rate"), gm, gsd, fnum(gg, "n").filter(|x| x.is_finite()).unwrap_or(gn), "file", &format!("data/vna/repo-as-spec-gain.json arm snowball-greedy ({} null)", kind), epoch_of(rg.get("at"), walk_epoch), &[("at", or_null(rg.get("at"))), ("aperture", or_null(rg.get("aperture")))]);
        let (er, rr) = (m_e["rate"].clone(), m_r["rate"].clone());
        json!({ "version": version, "versions": versions, "n": g.len(), "n_current": g.iter().filter(|r| r.current).count(), "E": er, "recall": rr,
            "measures": { "E": m_e, "recall": m_r, "invariant_recall": m_i, "repo_as_spec_gain": m_g, "token_savings": m_t } })
    }
    /// pmu-onchip --aperture-load
    pub fn run_load(args: &[String]) {
        let t0 = std::time::Instant::now();
        let doc = read_doc(args, "--aperture-load");
        let mut b = Binder::new(doc["repo"].as_str().unwrap_or("."));
        let should: Vec<Value> = doc["should"].as_array().cloned().unwrap_or_default().iter().map(|q| {
            let touched = q.get("touched").filter(|t| t.is_array()).map(strs);
            should_of_commit(&mut b, q["sha"].as_str().unwrap_or("HEAD"), touched)
        }).collect();
        let mut secs = HashMap::new();
        let served: Vec<Value> = doc["served"].as_array().cloned().unwrap_or_default().iter().map(|q| {
            json!(served_ids(&mut b, &mut secs, q["rules"].as_array().map(|a| a.as_slice()).unwrap_or(&[]), q["sha"].as_str().unwrap_or("HEAD")))
        }).collect();
        let vectors: Vec<Value> = doc["vectors"].as_array().cloned().unwrap_or_default().iter().map(|q| {
            let versions = q.get("versions").and_then(|v| v.as_array()).cloned().unwrap_or_else(|| vec![q["version"].clone()]);
            let sav: Vec<f64> = q["allSavings"].as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect()).unwrap_or_default();
            measure_vector(q["rows"].as_array().map(|a| a.as_slice()).unwrap_or(&[]), &q["version"], &versions, &q["files"], &sav, q["walk_epoch"].as_str().unwrap_or(""))
        }).collect();
        let out = json!({ "row": "C612t", "engine": "pmu-onchip --aperture-load", "llm": false, "should": should, "served": served, "vectors": vectors, "compute_ms": t0.elapsed().as_secs_f64() * 1000.0 });
        println!("{}", serde_json::to_string(&out).unwrap());
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn exact_path_and_imports() {
            assert!(names_exact_path("see src/a.mjs.", "src/a.mjs"));
            assert!(!names_exact_path("see xsrc/a.mjs", "src/a.mjs"));
            assert!(!names_exact_path("see src/a.mjs.x", "src/a.mjs"));
            assert!(imports_path("import { a } from '../src/a.mjs';", "tests/one.test.mjs", "src/a.mjs"));
            assert_eq!(paths_in("a scripts/vna/x.mjs and ./b/c.json."), vec!["scripts/vna/x.mjs".to_string(), "b/c.json".to_string()]);
            assert!(self_ceiling("// kept under 50 KB"));
            assert_eq!(heading_of("## A rule  "), Some("A rule".into()));
            assert_eq!(js_num_str(0.1), "0.1"); assert_eq!(js_num_str(1e-7), "1e-7"); assert_eq!(js_num_str(20.0), "20");
        }
        #[test]
        fn flag_top_ties_by_id() {
            let w = vec![("b".to_string(), 1.0), ("a".to_string(), 1.0), ("c".to_string(), 0.5)];
            assert_eq!(flag_top(&w, 2), vec!["a".to_string(), "b".to_string()]);
        }
    }
}
