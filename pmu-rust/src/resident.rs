// .thetacog/pmu/src/resident.rs
//
// G2 — THE RESIDENT LOOP. One long-lived attested process: NDJSON requests over
// stdin, one tagged JSON response per request over stdout. The chip is loaded
// once and served many times — G7 measured ~2x vs one-shot spawns.
//
// Ops: ingest (M1 streaming read), sense (on-chip localization — same
// sense::sense_lattice as --sense), tree-nodes (C184a), drift (C318g), ping, shutdown.
//   {"op":"ingest","id":1,"path":"…jsonl","offset":0}
//   {"op":"sense","id":2,"claims":[…],"targets":[…],"target_lens":[…],"shingle_mode":"word"}
//   {"op":"tree-nodes","id":5,"rowSha":"<sha256 of a ledger row>"}
//   {"op":"drift","id":6,"leaf":"n_spec_C226d"}   → {"total":N,"hash8":[…]} (spec-tree.mjs's
//     ungraded(tree,{leaf}), driftLine()'s hash8/total — pending and the snowball seed are the
//     other two legs the C318g row names; not ported yet, named in data/vna/rust-punch-list.json)
//   {"op":"ping","id":3}   {"op":"shutdown","id":4}
//
// --sign (V5, the resident's OATH · Δ7): ed25519 over sha256 of EXACTLY the bytes
// emitted this session; a single attestation line is appended at drain. Node
// CHECKS it (daemon-verify.mjs), never produces it. The key is the instrument;
// the oath — "these bytes ran on this host" — is the artifact.
//
// C184a — THE HOOK ASKS A RESIDENT INSTEAD OF STARTING NODE (SPEC-VNA-COCKPIT.md).
// `--resident --socket <path> --tree <spec-tree.json>` serves the SAME ops over a
// unix socket: one connection = one request line + one response line. The spec
// tree (52 MB on 2026-09-23) is parsed ONCE into a lean index (only the fields
// steer-hook.mjs's treeViewOfRow reads) keyed by meta.rowSha and by every
// revision's meta.rowSha, and re-read only when the file's (len, mtime) moves —
// the fold rewrites it whole (tmp→rename), so there is nothing to read
// incrementally on the tree; the ledger (append-only) is the incremental case
// and is NOT held here yet (its tail is already bounded on the node side).
// The socket mode does not sign (the oath covers the stdin session's bytes).
//
// Reliability: one bad request answers with an error line and the loop keeps
// serving. EOF or shutdown drains cleanly (and signs, if asked).

use crate::{attest, sense, signature, transcript};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Instant, SystemTime};

// ── the lean tree: exactly what treeViewOfRow(nodes, row) reads, nothing else ──────────────────
// Every field is read LENIENTLY: the live tree carries `basin: false`, `pixel: null`, revisions with
// nulls — a field whose shape is not the one expected is None, never a parse failure of the whole tree
// (measured 2026-09-23: a strict Basin struct refused the real tree at line 43337).
fn lenient<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where D: serde::Deserializer<'de>, T: serde::de::DeserializeOwned {
    let v = Value::deserialize(d)?;
    Ok(serde_json::from_value::<T>(v).ok())
}
#[derive(Deserialize, Default, Clone)]
struct Mass {
    #[serde(default, deserialize_with = "lenient")]
    chars: Option<Value>,
    #[serde(default, deserialize_with = "lenient")]
    gzip: Option<Value>,
}
#[derive(Deserialize, Default, Clone)]
struct Meta {
    #[serde(default, rename = "rowSha", deserialize_with = "lenient")]
    row_sha: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    via: Option<String>,
}
#[derive(Deserialize, Default, Clone)]
struct Content {
    #[serde(default, deserialize_with = "lenient")]
    headline: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    text: Option<String>,
}
#[derive(Default, Clone)]
struct Revision {
    row_sha: Option<String>,
    released: Value,
    present: bool,   // false = a null slot in the revisions array (kept so counts match the hook's)
}
#[derive(Deserialize, Default, Clone)]
struct Basin {
    #[serde(default, deserialize_with = "lenient")]
    label: Option<String>,
}
#[derive(Deserialize, Default, Clone)]
struct NodeLite {
    #[serde(default, deserialize_with = "lenient")]
    id: Option<String>,
    #[serde(default, rename = "type", deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pixel: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    mass: Option<Mass>,
    #[serde(default, deserialize_with = "lenient")]
    meta: Option<Meta>,
    #[serde(default, deserialize_with = "lenient")]
    content: Option<Content>,
    #[serde(default, deserialize_with = "lenient")]
    revisions: Option<Vec<Value>>,
    #[serde(default, deserialize_with = "lenient")]
    basin: Option<Basin>,
    #[serde(default, deserialize_with = "lenient")]
    children: Option<Vec<Value>>,
    #[serde(skip)]
    revs: Vec<Revision>,
}
#[derive(Deserialize, Default)]
struct TreeLite {
    #[serde(default, deserialize_with = "lenient")]
    watermark: Option<i64>,
    #[serde(default, deserialize_with = "nodes_in_order")]
    nodes: Vec<NodeLite>,
}
// FILE ORDER, never map order: the hook prints `mine.slice(0, 8)` in Object.values() order, which
// is the order the fold wrote the nodes — a HashMap would hand a different first eight per process.
fn nodes_in_order<'de, D>(d: D) -> Result<Vec<NodeLite>, D::Error>
where D: serde::Deserializer<'de> {
    struct V;
    impl<'de> serde::de::Visitor<'de> for V {
        type Value = Vec<NodeLite>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("a map of nodes") }
        fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Vec<NodeLite>, A::Error> {
            let mut out = Vec::new();
            while let Some((_k, v)) = m.next_entry::<String, NodeLite>()? { out.push(v); }
            Ok(out)
        }
    }
    d.deserialize_map(V)
}

// raw text is inlined by the hook ONLY for decision/question nodes, capped at 240 chars after a
// whitespace collapse — RAW_TEXT_KEEP bounds what the index retains per node; other types drop it.
const RAW_TEXT_KEEP: usize = 8192;

pub struct TreeIndex {
    path: PathBuf,
    len: u64,
    mtime_ms: u128,
    loaded_ms: u128,
    watermark: Option<i64>,
    nodes: Vec<NodeLite>,
    by_row: HashMap<String, Vec<usize>>,
    by_rev_row: HashMap<String, Vec<usize>>,
    // C318g: one leaf's ungraded-direction count + hash8 list, computed once at load from the RAW
    // revisions (before the lean NodeLite.revs conversion below drops the fields this needs) —
    // never re-walked per request.
    ungraded_by_leaf: HashMap<String, (usize, Vec<String>)>,
}

/// The fold's excerpts are `.slice(0, N)` cuts of JS strings, so the tree carries LONE SURROGATES
/// (`\ud83d"` — an emoji cut in half; 3 on 2026-09-23). JSON.parse keeps them; serde_json refuses them
/// into a String. Node writing a lone surrogate to stdout emits U+FFFD, so replacing the escape with
/// `\uFFFD` here (same byte length, in place) is byte-identical at the hook's stdout, which is the
/// contract. Only escapes inside strings are touched; backslash parity is honoured by the walk.
fn sanitize_lone_surrogates(b: &mut [u8]) -> usize {
    let hex = |c: u8| (c as char).to_digit(16);
    let unit_at = |b: &[u8], i: usize| -> Option<u32> {
        if i + 6 <= b.len() && b[i] == b'\\' && b[i + 1] == b'u' { let mut v = 0u32; for k in 0..4 { v = v * 16 + hex(b[i + 2 + k])?; } Some(v) } else { None }
    };
    let (mut i, mut in_str, mut fixed) = (0usize, false, 0usize);
    while i < b.len() {
        let c = b[i];
        if !in_str { if c == b'"' { in_str = true; } i += 1; continue; }
        match c {
            b'"' => { in_str = false; i += 1; }
            b'\\' => {
                if let Some(u) = unit_at(b, i) {
                    let lone = if (0xD800..=0xDBFF).contains(&u) { !matches!(unit_at(b, i + 6), Some(l) if (0xDC00..=0xDFFF).contains(&l)) } else { (0xDC00..=0xDFFF).contains(&u) };
                    if lone { b[i + 2..i + 6].copy_from_slice(b"FFFD"); fixed += 1; i += 6; }
                    else if (0xD800..=0xDBFF).contains(&u) { i += 12; } else { i += 6; }
                } else { i += 2; }
            }
            _ => i += 1,
        }
    }
    fixed
}

fn file_stamp(p: &Path) -> io::Result<(u64, u128)> {
    let md = std::fs::metadata(p)?;
    let mt = md.modified()?.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    Ok((md.len(), mt))
}

// ── C318g: THE DRIFT READER — ungraded()/directions() from scripts/vna/spec-tree.mjs, ported to run
// off the tree this resident already holds. isDirection only ever needs to know whether a text falls
// to typeOf's DEFAULT branch ('intent'); a text ending in '?' (typeOf's own trim, so trailing
// whitespace after the '?' is fine) or matching one of the CUES word lists never does. The `cue`
// typeOf also returns is dead here — directions()/ungraded() never read it, only `.type`.
fn value_to_hash_string(v: &Value) -> String {
    match v { Value::String(s) => s.clone(), other => other.to_string() }
}
fn hash8_of_str(s: &str) -> String {
    let mut cut = 8usize.min(s.len());
    while cut > 0 && !s.is_char_boundary(cut) { cut -= 1; }
    s[..cut].to_string()
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}
// case-insensitive "\b<phrase>\b" approximation: a non-alphanumeric (or string edge) on both sides
fn word_boundary_ok(s: &str, start: usize, end: usize) -> bool {
    let before_ok = s[..start].chars().next_back().map(|c| !c.is_alphanumeric()).unwrap_or(true);
    let after_ok = s[end..].chars().next().map(|c| !c.is_alphanumeric()).unwrap_or(true);
    before_ok && after_ok
}
fn contains_phrase(text_lower: &str, phrase: &str) -> bool {
    let mut start = 0usize;
    while start < text_lower.len() {
        match text_lower[start..].find(phrase) {
            Some(pos) => {
                let abs = start + pos;
                let end = abs + phrase.len();
                if word_boundary_ok(text_lower, abs, end) { return true; }
                start = abs + 1;
                while start < text_lower.len() && !text_lower.is_char_boundary(start) { start += 1; }
            }
            None => break,
        }
    }
    false
}
// verbatim from spec-tree.mjs's CUES, category order preserved — the FIRST category any phrase in it
// matches (anywhere) wins; typeOf falls to 'intent' only when NONE of them, and the text is not a
// question, matches.
const CUE_CATEGORIES: &[&[&str]] = &[
    &["must not", "must", "never", "always", "cannot"],
    &["limit", "limits", "bound", "bounded", "bounds", "cap", "capped", "only", "within"],
    &["api", "apis", "schema", "json", "endpoint", "endpoints", "command", "commands", "field", "fields"],
    &["we will", "committed", "decided", "instead of"],
];
fn is_default_intent(text: &str) -> bool {
    let t = text.trim();
    if t.ends_with('?') { return false; }
    let lower = t.to_lowercase();
    !CUE_CATEGORIES.iter().any(|cat| cat.iter().any(|p| contains_phrase(&lower, p)))
}
/// isDirection, mapped straight to the hash it would grade against — None when the revision is not
/// a direction at all. `r.text` (never `?? r.excerpt`, matching isDirection's own call to typeOf)
/// missing becomes the literal "undefined" (`String(undefined)`), exactly what the JS coerces to.
fn direction_hash(r: &Value) -> Option<String> {
    if r.get("kind").and_then(|v| v.as_str()) != Some("snippet") { return None; }
    if r.get("retracted").map(truthy).unwrap_or(false) { return None; }
    let is_direction = match r.get("type").and_then(|v| v.as_str()) {
        Some("intent") | Some("decision") => true,
        Some(_) => false,
        None => {
            let decision_flag = r.get("decision").map(truthy).unwrap_or(false);
            decision_flag || is_default_intent(&r.get("text").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_else(|| "undefined".to_string()))
        }
    };
    if !is_direction { return None; }
    Some(r.get("hash").map(value_to_hash_string).unwrap_or_else(|| "undefined".to_string()))
}
/// ungraded(tree, { leaf }): every direction on this basin whose hash no revision with kind:"grade"
/// names, oldest `at` first — the exact set driftLine() prints hash8es from.
fn ungraded_directions(raw_revisions: &[Value]) -> (usize, Vec<String>) {
    let mut graded: std::collections::HashSet<String> = std::collections::HashSet::new();
    for r in raw_revisions {
        if r.get("kind").and_then(|v| v.as_str()) == Some("grade") {
            if let Some(h) = r.get("hash") { graded.insert(value_to_hash_string(h)); }
        }
    }
    let mut dirs: Vec<(String, String)> = Vec::new();
    for r in raw_revisions {
        if let Some(hash) = direction_hash(r) {
            if !graded.contains(&hash) {
                let at = r.get("at").and_then(|v| v.as_str()).unwrap_or("").to_string();
                dirs.push((hash, at));
            }
        }
    }
    dirs.sort_by(|a, b| a.1.cmp(&b.1));
    let hash8s: Vec<String> = dirs.iter().map(|(h, _)| hash8_of_str(h)).collect();
    (dirs.len(), hash8s)
}

impl TreeIndex {
    pub fn load(path: &Path) -> io::Result<TreeIndex> {
        let t0 = Instant::now();
        let (len, mtime_ms) = file_stamp(path)?;
        let mut bytes = std::fs::read(path)?;
        sanitize_lone_surrogates(&mut bytes);
        let tree: TreeLite = serde_json::from_slice(&bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("{}: {e}", path.display())))?;
        drop(bytes);
        let mut nodes: Vec<NodeLite> = Vec::with_capacity(tree.nodes.len());
        let mut by_row: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_rev_row: HashMap<String, Vec<usize>> = HashMap::new();
        let mut ungraded_by_leaf: HashMap<String, (usize, Vec<String>)> = HashMap::new();
        for mut n in tree.nodes {
            let kind = n.kind.clone().unwrap_or_default();
            // C318g: read BEFORE .take() below drops everything but row_sha/released/present per revision
            if n.basin.is_some() {
                if let Some(id) = n.id.clone() {
                    let raw: &[Value] = n.revisions.as_deref().unwrap_or(&[]);
                    ungraded_by_leaf.insert(id, ungraded_directions(raw));
                }
            }
            n.revs = n.revisions.take().unwrap_or_default().into_iter().map(|r| match r {
                Value::Object(o) => Revision { row_sha: o.get("meta").and_then(|m| m.get("rowSha")).and_then(|v| v.as_str()).map(|s| s.to_string()), released: o.get("released").cloned().unwrap_or(Value::Null), present: true },
                _ => Revision { row_sha: None, released: Value::Null, present: false },
            }).collect();
            // keep raw text only where the hook can print it
            if kind != "decision" && kind != "question" {
                if let Some(c) = n.content.as_mut() { c.text = None; }
            } else if let Some(c) = n.content.as_mut() {
                if let Some(t) = c.text.as_mut() { if t.len() > RAW_TEXT_KEEP { let mut cut = RAW_TEXT_KEEP; while !t.is_char_boundary(cut) { cut -= 1; } t.truncate(cut); } }
            }
            let i = nodes.len();
            if let Some(sha) = n.meta.as_ref().and_then(|m| m.row_sha.clone()) { by_row.entry(sha).or_default().push(i); }
            for r in n.revs.iter() {
                if let Some(sha) = r.row_sha.clone() {
                    let v = by_rev_row.entry(sha).or_default();
                    if v.last() != Some(&i) { v.push(i); }
                }
            }
            nodes.push(n);
        }
        Ok(TreeIndex { path: path.to_path_buf(), len, mtime_ms, loaded_ms: t0.elapsed().as_millis(), watermark: tree.watermark, nodes, by_row, by_rev_row, ungraded_by_leaf })
    }

    /// true when the file on disk is no longer the one this index was read from
    pub fn stale(&self) -> bool {
        match file_stamp(&self.path) { Ok((l, m)) => l != self.len || m != self.mtime_ms, Err(_) => true }
    }

    fn node_json(&self, i: usize) -> Value {
        let n = &self.nodes[i];
        let revs: Vec<Value> = n.revs.iter().map(|r| if r.present { json!({ "meta": { "rowSha": r.row_sha }, "released": r.released }) } else { Value::Null }).collect();
        json!({
            "id": n.id,
            "type": n.kind,
            "pixel": n.pixel,
            "mass": n.mass.as_ref().map(|m| json!({ "chars": m.chars.clone().unwrap_or(Value::Null), "gzip": m.gzip.clone().unwrap_or(Value::Null) })),
            "meta": { "rowSha": n.meta.as_ref().and_then(|m| m.row_sha.clone()), "via": n.meta.as_ref().and_then(|m| m.via.clone()) },
            "content": { "headline": n.content.as_ref().and_then(|c| c.headline.clone()), "text": n.content.as_ref().and_then(|c| c.text.clone()) },
            "revisions": revs,
            "basin": n.basin.as_ref().map(|b| json!({ "label": b.label })),
            "children": n.children.clone().unwrap_or_default(),
        })
    }

    /// the nodes treeViewOfRow would select for this row: `nodes` = meta.rowSha matches, not a section,
    /// no children; `inBasins` = any revision's meta.rowSha matches (the hook only uses it when `nodes` is empty)
    pub fn for_row(&self, sha: &str) -> (Vec<Value>, Vec<Value>) {
        let mine: Vec<Value> = self.by_row.get(sha).map(|v| v.iter().copied()
            .filter(|&i| { let n = &self.nodes[i]; n.kind.as_deref() != Some("section") && n.children.as_ref().map(|c| c.is_empty()).unwrap_or(true) })
            .map(|i| self.node_json(i)).collect()).unwrap_or_default();
        let in_basins: Vec<Value> = if mine.is_empty() { self.by_rev_row.get(sha).map(|v| v.iter().map(|&i| self.node_json(i)).collect()).unwrap_or_default() } else { Vec::new() };
        (mine, in_basins)
    }

    /// C318g: ungraded()'s single-leaf answer — (total, hash8 list oldest-first), `(0, [])` for a
    /// basin with nothing ungraded or an id this tree does not carry (never an error: an inactive or
    /// stale leaf id is a normal turn, not a fault).
    pub fn drift_for_leaf(&self, leaf: &str) -> (usize, Vec<String>) {
        self.ungraded_by_leaf.get(leaf).cloned().unwrap_or((0, Vec::new()))
    }

    pub fn status(&self) -> Value {
        json!({ "path": self.path.display().to_string(), "size": self.len, "mtimeMs": self.mtime_ms, "nodes": self.nodes.len(), "watermark": self.watermark, "loadedMs": self.loaded_ms })
    }
}

/// the state a resident holds across requests — the chip's own tables are static; the tree is the mass
pub struct Resident {
    tree_path: Option<PathBuf>,
    tree: Option<Arc<TreeIndex>>,
    /// DOUBLE-BUFFERED RELOAD: the fold rewrites the tree every few minutes while dictation runs, and a reload
    /// is 300–600 ms on the live 52 MB tree — longer than the hook's 50 ms door. So a stale index keeps being
    /// SERVED while the next one loads on a thread; the swap happens on the first request after it finishes.
    /// (measured 2026-09-23: a synchronous reload made every hook call inside that window time out to cache)
    loading: Option<(PathBuf, JoinHandle<io::Result<TreeIndex>>)>,
}

impl Resident {
    pub fn new(tree_path: Option<PathBuf>) -> Resident { Resident { tree_path, tree: None, loading: None } }

    fn take_finished_loader(&mut self) {
        if self.loading.as_ref().map(|(_, h)| h.is_finished()).unwrap_or(false) {
            if let Some((p, h)) = self.loading.take() {
                match h.join() { Ok(Ok(t)) => self.tree = Some(Arc::new(t)), Ok(Err(e)) => eprintln!("pmu-onchip --resident: reload of {} failed — {e}", p.display()), Err(_) => eprintln!("pmu-onchip --resident: reload thread panicked") }
            }
        }
    }

    fn tree_for(&mut self, requested: Option<&str>) -> Result<Arc<TreeIndex>, String> {
        let path: PathBuf = match requested.map(PathBuf::from).or_else(|| self.tree_path.clone()) { Some(p) => p, None => return Err("no tree: start with --tree <spec-tree.json> or pass \"path\"".into()) };
        self.take_finished_loader();
        if let Some(t) = self.tree.clone().filter(|t| t.path == path) {
            if t.stale() && self.loading.is_none() {
                let p = path.clone();
                self.loading = Some((path, std::thread::spawn(move || TreeIndex::load(&p))));
            }
            return Ok(t);   // the previous index, served while the next one loads
        }
        // no index for this path yet: the first request pays the load (or waits for a loader already on it)
        if let Some((p, h)) = self.loading.take() {
            if p == path { let t = h.join().map_err(|_| "tree: load thread panicked".to_string())?.map_err(|e| format!("tree: {e}"))?; let t = Arc::new(t); self.tree = Some(t.clone()); return Ok(t); }
        }
        let t = Arc::new(TreeIndex::load(&path).map_err(|e| format!("tree: {e}"))?);
        self.tree = Some(t.clone());
        Ok(t)
    }

    fn reloading(&self) -> bool { self.loading.is_some() }

    /// one request → one response; the bool says the caller should stop serving (shutdown)
    pub fn handle(&mut self, req: &Value) -> (Value, bool) {
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("");
        match op {
            "shutdown" => (json!({"id": id, "ok": true, "bye": true}), true),
            "ping" => { self.take_finished_loader(); (json!({"id": id, "ok": true, "pid": std::process::id(), "tree": self.tree.as_ref().map(|t| t.status()), "reloading": self.reloading()}), false) }
            "ingest" => {
                let path = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let offset = req.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
                match transcript::read_new_lines(path, offset) {
                    Ok(r) => {
                        let first = transcript::first_user_prompt(path).unwrap_or_default();
                        let thinking = transcript::thinking_text(&r.lines);
                        let reality = transcript::assistant_text(&r.lines);
                        (json!({
                            "id": id, "op": "ingest", "path": path,
                            "newOffset": r.new_offset, "lineCount": r.lines.len(),
                            "firstUserPrompt": first,
                            "intentThinking": thinking,
                            "reality": reality,
                        }), false)
                    }
                    Err(e) => (json!({"id": id, "error": format!("read: {e}")}), false),
                }
            }
            "sense" => {
                // on-chip sense IN the resident loop (Δ3): the same
                // sense::sense_lattice the one-shot --sense uses, no extra spawn.
                let claims: Vec<String> = req.get("claims").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
                let targets: Vec<String> = req.get("targets").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
                let target_lens: Vec<usize> = req.get("target_lens")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_else(|| vec![1; targets.len()]);
                let simhash_only = req.get("simhash_only").and_then(|v| v.as_bool()).unwrap_or(false);
                let mode = match req.get("shingle_mode").and_then(|v| v.as_str()).unwrap_or("") {
                    "" | "char" => signature::ShingleMode::Char,
                    "word" => signature::ShingleMode::Word,
                    other => return (json!({"id": id, "error": format!("unknown shingle_mode: {other}")}), false),
                };
                let res = sense::sense_lattice(&claims, &targets, &target_lens, simhash_only, mode);
                (json!({
                    "id": id, "op": "sense",
                    "scores": res.rows.iter().map(|r| r.score).collect::<Vec<_>>(),
                    "ncd_scores": res.rows.iter().map(|r| r.ncd).collect::<Vec<_>>(),
                    "best_idx": res.rows.iter().map(|r| r.best_idx).collect::<Vec<_>>(),
                    "agreement": res.rows.iter().map(|r| r.agreement).collect::<Vec<_>>(),
                    "claim_best_anchor": res.claim_best_anchor,
                    "claim_best_score": res.claim_best_score,
                }), false)
            }
            "tree-nodes" => {
                // C184a: the tree's view of one ledger row, from the index held in memory
                let sha = req.get("rowSha").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let requested = req.get("path").and_then(|v| v.as_str()).map(|s| s.to_string());
                if sha.is_empty() { return (json!({"id": id, "error": "tree-nodes: rowSha required"}), false); }
                match self.tree_for(requested.as_deref()) {
                    Ok(t) => {
                        let (nodes, in_basins) = t.for_row(&sha);
                        (json!({"id": id, "op": "tree-nodes", "rowSha": sha, "nodes": nodes, "inBasins": in_basins, "tree": t.status(), "reloading": self.reloading()}), false)
                    }
                    Err(e) => (json!({"id": id, "error": e}), false),
                }
            }
            "drift" => {
                // C318g: ungraded(tree, {leaf}) — driftLine()'s hash8/total, off the index already in memory
                let leaf = req.get("leaf").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let requested = req.get("path").and_then(|v| v.as_str()).map(|s| s.to_string());
                if leaf.is_empty() { return (json!({"id": id, "error": "drift: leaf required"}), false); }
                match self.tree_for(requested.as_deref()) {
                    Ok(t) => {
                        let (total, hash8) = t.drift_for_leaf(&leaf);
                        (json!({"id": id, "op": "drift", "leaf": leaf, "total": total, "hash8": hash8, "tree": t.status(), "reloading": self.reloading()}), false)
                    }
                    Err(e) => (json!({"id": id, "error": e}), false),
                }
            }
            other => (json!({"id": id, "error": format!("unknown op: {other}")}), false),
        }
    }
}

pub fn run_resident_loop_with(sign: bool, tree_path: Option<PathBuf>) -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut hasher = Sha256::new();
    let mut res = Resident::new(tree_path);

    // emit: hash (when signing) the EXACT bytes written, then write+flush them.
    macro_rules! emit {
        ($val:expr) => {{
            let line = $val.to_string();
            if sign {
                hasher.update(line.as_bytes());
                hasher.update(b"\n");
            }
            writeln!(out, "{}", line)?;
            out.flush()?;
        }};
    }

    for line in stdin.lock().lines() {
        let line = line?;
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(t) {
            Ok(v) => v,
            Err(e) => {
                emit!(json!({"error": format!("bad json: {e}")}));
                continue;
            }
        };
        let (reply, stop) = res.handle(&req);
        emit!(reply);
        if stop { break; }
    }

    // the resident's OATH (V5 · Δ7): ed25519 over sha256 of EXACTLY the emitted
    // bytes. daemon-verify.mjs splits at this trailing line and re-checks.
    if sign {
        match attest::host_signing_key() {
            Ok(key) => {
                let fin = hasher.finalize();
                let mut digest = [0u8; 32];
                digest.copy_from_slice(&fin);
                writeln!(out, "{}", attest::attestation_line_for_digest(&digest, &key, &crate::chrono_like_ts()))?;
                out.flush()?;
            }
            Err(e) => {
                eprintln!("pmu-onchip --resident --sign: {e}");
                std::process::exit(2);
            }
        }
    }
    Ok(())
}

/// C184a — serve the same ops over a unix socket. One connection carries one request line and gets
/// one response line; the listener's pid is written beside the socket (`<sock>.pid`) so a client can
/// tell a dead socket file from a live resident without connecting. A stale socket file whose owner
/// is gone is unlinked and re-bound. Requests are served one at a time (each is milliseconds).
pub fn run_resident_socket(sock: &Path, tree_path: Option<PathBuf>) -> io::Result<()> {
    if sock.exists() {
        match std::os::unix::net::UnixStream::connect(sock) {
            Ok(_) => return Err(io::Error::new(io::ErrorKind::AddrInUse, format!("a resident already answers on {}", sock.display()))),
            Err(_) => { let _ = std::fs::remove_file(sock); }
        }
    }
    if let Some(dir) = sock.parent() { let _ = std::fs::create_dir_all(dir); }
    let listener = UnixListener::bind(sock)?;
    let pid_path = PathBuf::from(format!("{}.pid", sock.display()));
    let _ = std::fs::write(&pid_path, format!("{}\n", std::process::id()));
    let mut res = Resident::new(tree_path.clone());
    // warm the tree before the first request so the first hook call is served, not paid for
    if tree_path.is_some() { let _ = res.tree_for(None); }
    eprintln!("pmu-onchip --resident --socket {} (pid {}, tree {})", sock.display(), std::process::id(), res.tree.as_ref().map(|t| format!("{} nodes in {} ms", t.nodes.len(), t.loaded_ms)).unwrap_or_else(|| "none".into()));
    for stream in listener.incoming() {
        let mut stream = match stream { Ok(s) => s, Err(_) => continue };
        let mut line = String::new();
        {
            let mut rd = BufReader::new(&stream);
            if rd.read_line(&mut line).is_err() { continue; }
        }
        let t = line.trim();
        if t.is_empty() { continue; }
        let (reply, stop) = match serde_json::from_str::<Value>(t) {
            Ok(req) => res.handle(&req),
            Err(e) => (json!({"error": format!("bad json: {e}")}), false),
        };
        let _ = writeln!(stream, "{}", reply);
        let _ = stream.flush();
        drop(stream);
        if stop { break; }
    }
    let _ = std::fs::remove_file(sock);
    let _ = std::fs::remove_file(&pid_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The stdin loop is exercised by an integration smoke test (echo NDJSON | pmu-onchip --resident
    // [--sign] | daemon-verify); per-op logic delegates to transcript:: / sense:: which are unit-tested
    // in their own modules. The tree index is unit-tested here on a fixture tree.
    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pmu-resident-tree-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join(format!("{name}.json"));
        std::fs::write(&p, r#"{"watermark":3,"nodes":{
          "n_sec":{"id":"n_sec","type":"section","meta":{"rowSha":"S1"},"children":["n_dec"]},
          "n_dec":{"id":"n_dec","type":"decision","pixel":"C1,B3","mass":{"chars":10,"gzip":5},"meta":{"rowSha":"S1","via":"typed"},"content":{"headline":"h","text":"the   text"},"revisions":[],"children":[]},
          "n_int":{"id":"n_int","type":"intent","meta":{"rowSha":"S1"},"content":{"headline":"i","text":"dropped"},"children":[]},
          "n_bas":{"id":"n_bas","type":"contract","basin":{"label":"B"},"content":{"headline":"b"},"revisions":[null,{"meta":{"rowSha":"S2"},"released":true}],"children":[]}
        }}"#).unwrap();
        p
    }

    #[test]
    fn lone_surrogates_become_fffd_in_place() {
        let mut b = br#"{"a":"x\ud83d","b":"\ud83d\ude00 ok","c":"\\ud83d","d":"\udc00"}"#.to_vec();
        let n = sanitize_lone_surrogates(&mut b);
        assert_eq!(n, 2, "{}", String::from_utf8_lossy(&b));
        let v: Value = serde_json::from_slice(&b).unwrap();
        assert_eq!(v["a"], "x\u{FFFD}");
        assert_eq!(v["b"], "\u{1F600} ok");
        assert_eq!(v["c"], "\\ud83d");
        assert_eq!(v["d"], "\u{FFFD}");
    }

    // C318g fixture: n_leaf carries 5 candidate revisions — a graded decision (dropped), an ungraded
    // decision (typed explicitly), an ungraded intent falling to typeOf's default branch, a snippet
    // whose text hits the CUES 'invariant' category ("must never" — not a direction), and a question
    // (also not a direction). n_other is a second basin with nothing ungraded (all graded).
    fn drift_fixture() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pmu-resident-drift-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("drift.json");
        std::fs::write(&p, r#"{"watermark":1,"nodes":{
          "n_leaf":{"id":"n_leaf","type":"contract","basin":{"label":"L"},"content":{"headline":"leaf"},"children":[],"revisions":[
            {"kind":"snippet","type":"decision","hash":"aaaa1111graded","at":"2026-09-20T00:00:00.000Z","text":"kept this"},
            {"kind":"grade","hash":"aaaa1111graded","grade":"KEPT","at":"2026-09-21T00:00:00.000Z","why":"fine"},
            {"kind":"snippet","type":"decision","hash":"bbbb2222ungrade","at":"2026-09-22T00:00:00.000Z","text":"do it this way"},
            {"kind":"snippet","hash":"cccc3333ungrade","at":"2026-09-19T00:00:00.000Z","text":"ship the thing tomorrow"},
            {"kind":"snippet","hash":"dddd4444invariant","at":"2026-09-23T00:00:00.000Z","text":"this must never regress"},
            {"kind":"snippet","hash":"eeee5555question","at":"2026-09-23T00:00:00.000Z","text":"is this right?"},
            {"kind":"snippet","type":"decision","retracted":true,"hash":"ffff6666retract","at":"2026-09-23T00:00:00.000Z","text":"withdrawn"},
            {"kind":"revision","hash":"not-a-snippet","at":"2026-09-23T00:00:00.000Z","text":"a spec version, not a direction"}
          ]},
          "n_other":{"id":"n_other","type":"contract","basin":{"label":"O"},"content":{"headline":"other"},"children":[],"revisions":[
            {"kind":"snippet","type":"intent","hash":"ffff9999graded","at":"2026-09-20T00:00:00.000Z","text":"noted"},
            {"kind":"grade","hash":"ffff9999graded","grade":"CORRECTED","at":"2026-09-21T00:00:00.000Z","why":"ok"}
          ]}
        }}"#).unwrap();
        p
    }

    #[test]
    fn drift_for_leaf_matches_ungraded_directions() {
        let t = TreeIndex::load(&drift_fixture()).unwrap();
        let (total, hash8) = t.drift_for_leaf("n_leaf");
        // bbbb2222… (explicit decision) and cccc3333… (default-intent) are ungraded; the graded
        // decision, the CUES-invariant snippet, the question, the retracted row and the non-snippet
        // revision are all excluded. Oldest `at` first: cccc (09-19) before bbbb (09-22).
        assert_eq!(total, 2, "{hash8:?}");
        assert_eq!(hash8, vec!["cccc3333".to_string(), "bbbb2222".to_string()]);
        let (total_other, hash8_other) = t.drift_for_leaf("n_other");
        assert_eq!((total_other, hash8_other), (0, Vec::<String>::new()));
        assert_eq!(t.drift_for_leaf("no-such-leaf"), (0, Vec::new()));
    }

    #[test]
    fn drift_op_answers_over_handle() {
        let mut r = Resident::new(Some(drift_fixture()));
        let (v, stop) = r.handle(&json!({"op": "drift", "id": 1, "leaf": "n_leaf"}));
        assert!(!stop);
        assert_eq!(v["total"], 2);
        assert_eq!(v["hash8"].as_array().unwrap().len(), 2);
        let (e, _) = r.handle(&json!({"op": "drift", "id": 2}));
        assert!(e["error"].as_str().unwrap().contains("leaf required"), "{e}");
    }

    #[test]
    fn tree_nodes_selects_what_the_hook_would() {
        let p = fixture("select");
        let t = TreeIndex::load(&p).unwrap();
        let (mine, basins) = t.for_row("S1");
        let ids: Vec<&str> = mine.iter().map(|n| n["id"].as_str().unwrap()).collect();
        assert!(ids.contains(&"n_dec") && ids.contains(&"n_int") && !ids.contains(&"n_sec"), "{ids:?}");
        assert!(basins.is_empty());
        let dec = mine.iter().find(|n| n["id"] == "n_dec").unwrap();
        assert_eq!(dec["content"]["text"], "the   text");
        let int = mine.iter().find(|n| n["id"] == "n_int").unwrap();
        assert!(int["content"]["text"].is_null(), "intent text is not retained");
        let (mine2, basins2) = t.for_row("S2");
        assert!(mine2.is_empty());
        assert_eq!(basins2.len(), 1);
        assert_eq!(basins2[0]["basin"]["label"], "B");
        assert_eq!(basins2[0]["revisions"][1]["released"], true);
        assert!(t.for_row("nope").0.is_empty());
        assert!(!t.stale());
    }

    #[test]
    fn handle_reloads_only_when_the_file_moves() {
        let p = fixture("reload");
        let mut r = Resident::new(Some(p.clone()));
        let (v, stop) = r.handle(&json!({"op":"tree-nodes","id":1,"rowSha":"S1"}));
        assert!(!stop);
        assert_eq!(v["nodes"].as_array().unwrap().len(), 2);
        let (v2, _) = r.handle(&json!({"op":"ping","id":2}));
        assert_eq!(v2["tree"]["nodes"], 4);
        let (e, _) = r.handle(&json!({"op":"tree-nodes","id":3}));
        assert!(e["error"].as_str().unwrap().contains("rowSha"));
        let (u, _) = r.handle(&json!({"op":"nope","id":4}));
        assert!(u["error"].as_str().unwrap().contains("unknown op"));
        // the file moves → the OLD index is served at once and a loader starts; once it finishes the swap lands
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&p, r#"{"watermark":9,"nodes":{"n_new":{"id":"n_new","type":"intent","meta":{"rowSha":"S9"},"children":[]}}}"#).unwrap();
        let (v3, _) = r.handle(&json!({"op":"tree-nodes","id":5,"rowSha":"S1"}));
        assert!(v3["nodes"].as_array().unwrap().len() == 2 || v3["nodes"].as_array().unwrap().is_empty(), "old index or the new one, never an error: {v3}");
        for _ in 0..200 { let (pv, _) = r.handle(&json!({"op":"ping","id":6})); if pv["tree"]["nodes"] == 1 { break; } std::thread::sleep(std::time::Duration::from_millis(5)); }
        let (v4, _) = r.handle(&json!({"op":"tree-nodes","id":7,"rowSha":"S9"}));
        assert_eq!(v4["nodes"].as_array().unwrap().len(), 1, "{v4}");
        assert_eq!(v4["reloading"], false);
    }
}
