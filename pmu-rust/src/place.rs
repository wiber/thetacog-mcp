// .thetacog/pmu/src/place.rs — C2409 THE PLACE OPERATION · C2410 THE CONTENT-ADDRESSED PLACEMENT CACHE (SPEC-VNA-COCKPIT.md).
//
// THE DIAGNOSIS (measured 2026-11-05): the walk runs at ~460 ns, the binary starts in < 10 ms, yet 38 script files started a
// fresh `pmu-onchip --lens` per text, paid the ~200 ms gzip-NCD seed every time, and threw the answer away. Nothing kept a
// placement by its bytes, so the same function body placed a thousand times paid a thousand seeds. This module is the fix:
//
//   place_spans(spans, args, repo, max_chars, cache)
//     spans  = [{ id, bytes } | { id, path, start?, end? } | { id, blob }]   (blob = a git blob sha, read by ONE cat-file --batch)
//     → one placement per span, in input order: { id, sha, aperture, cell, placement }
//
// THE ONE PLACER: every miss is `walk_lens::read_text` — the SAME per-text composition `--lens` and `--hud-serve` call (seed,
// ratchet, definer walk, σ, fence, partition). There is no second placer here; this file only resolves bytes, keys them, and
// projects the answer onto its deterministic fields (timings and the terminal it ran in are dropped — they are not a property
// of the bytes). IDENTICAL BYTES → IDENTICAL BYTES OUT: a span's output carries no hit/miss flag and no clock; the counts ride
// on the response, never on the placement.
//
// THE KEY is sha256(bytes placed) + the APERTURE HASH: sha256 over this binary's build id, the bytes of every file read_text
// reads for the config (the 144-target library, the reef, the directed grid cache, the rule-trigger anchors), the two env knobs
// read_text consults (LENS_RADIUS, PMU_UNPLACED_DRIFT) and the flag vector. Any one of them moving is a different aperture,
// so a cached placement is never served under a config it was not computed under. --session/--receipts-dir/--before are
// STRIPPED from the flag vector: they make read_text read the session's prior prompts, which is a property of the clock, not of
// the bytes. A caller that wants the session thread names it as the request's own "session" (+ "receipts_dir", "before"): those
// spans are walked through read_text WITH the thread, exactly as `--lens --session` walks them, and NEVER cached (the answer
// depends on receipts written after the key was taken). That path saves the spawn only; the cache is for session-free bytes.
//
// THE CACHE IS APPEND-ONLY (AXIOM 1: retain, never free): <repo>/.thetacog/cache/pmu-place-cache.ndjson, one {"k","p"} line per
// computed placement, read whole at start, so a restart keeps every placement it ever made. A torn or foreign line is
// skipped, never fatal. Sufficient for: serving a placement already computed for these bytes under this aperture without
// walking again. Not for: whether the placement is right (Rice) — it is exactly as right as the walk that made it.
// @guard tests/vna/c2409-chair-decomposition-of-c2402-operator-2026.test.mjs · tests/vna/c2410-chair-decomposition-of-c2402-operator-2026.test.mjs

use crate::lens;
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

/// the fields of read_text's answer that are NOT a function of the bytes and the aperture: the two clocks and the terminal
/// the binary ran in. Everything else is kept, so a placement is a drop-in for what `--lens` prints (the walk tape's reader
/// re-adds running_in from its own environment when it wants it).
const DROP: &[&str] = &["walk_ms", "seed_gzip_us", "running_in"];
/// flags that make read_text read something other than the bytes (the session thread) or that only steer this door
const STRIP_WITH_VALUE: &[&str] = &["--text", "--session", "--receipts-dir", "--before", "--repo", "--cache", "--source"];
const STRIP_BARE: &[&str] = &["--lens", "--place-batch", "--no-cache"];

fn hex(d: &[u8]) -> String { d.iter().map(|b| format!("{:02x}", b)).collect() }
pub fn sha256_hex(b: &[u8]) -> String { hex(&Sha256::digest(b)) }

/// the repo root: --repo / PMU_REPO, else the binary's canonical location (<repo>/.thetacog/pmu/target/release/pmu-onchip),
/// else the cwd — the same inference walk_lens's own CLI makes
pub fn repo_root(flag: Option<&str>) -> PathBuf {
    if let Some(r) = flag.map(String::from).or_else(|| std::env::var("PMU_REPO").ok().filter(|s| !s.is_empty())) { return PathBuf::from(r); }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.ancestors().nth(5) { if root.join("data/pmu/snippet-library-144.json").exists() { return root.to_path_buf(); } }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn default_cache_path(repo: &Path) -> PathBuf {
    std::env::var("PMU_PLACE_CACHE").ok().filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| repo.join(".thetacog/cache/pmu-place-cache.ndjson"))
}

/// the flag vector read_text sees: the caller's knobs minus the door's own flags and the session-thread flags
pub fn clean_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if STRIP_WITH_VALUE.contains(&a.as_str()) { i += 2; continue; }
        if STRIP_BARE.contains(&a.as_str()) { i += 1; continue; }
        out.push(a.clone());
        i += 1;
    }
    out
}

fn flag_val(args: &[String], f: &str) -> Option<String> { args.iter().position(|a| a == f).and_then(|i| args.get(i + 1)).cloned() }

/// THE APERTURE HASH — everything read_text reads besides the text, so a key never crosses a config change
pub fn aperture_hash(repo: &Path, args: &[String]) -> String {
    let mut h = Sha256::new();
    h.update(b"place-v1\0");
    h.update(crate::door::build_id().as_bytes());
    h.update(b"\0");
    let files: Vec<(String, PathBuf)> = vec![
        ("targets".into(), flag_val(args, "--targets").map(PathBuf::from).unwrap_or_else(|| repo.join("data/pmu/snippet-library-144.json"))),
        ("reef".into(), flag_val(args, "--reef").map(PathBuf::from).unwrap_or_else(|| repo.join("data/pmu/lens-reef.json"))),
        ("grid".into(), repo.join(".thetacog/pmu/reef-connectivity-directed.json")),
        ("anchors".into(), repo.join("data/pmu/rule-trigger-anchors.json")),
    ];
    for (name, p) in &files {
        h.update(name.as_bytes()); h.update(b"=");
        match std::fs::read(p) { Ok(b) => h.update(&Sha256::digest(&b)), Err(_) => h.update(b"missing") }
        h.update(b"\0");
    }
    for k in ["LENS_RADIUS", "PMU_UNPLACED_DRIFT"] { h.update(k.as_bytes()); h.update(b"="); h.update(std::env::var(k).unwrap_or_default().as_bytes()); h.update(b"\0"); }
    for a in args { h.update(a.as_bytes()); h.update(b"\x1f"); }
    hex(&h.finalize())[..16].to_string()
}

/// project read_text's answer onto its deterministic fields (serde_json's Map is ordered, so the bytes are stable)
pub fn project(full: &Value) -> Value {
    match full {
        Value::Object(o) => Value::Object(o.iter().filter(|(k, _)| !DROP.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()),
        other => other.clone(),
    }
}

// ── the cache ────────────────────────────────────────────────────────────────────────────────────────────────────────────
pub struct PlaceCache {
    pub path: Option<PathBuf>,
    map: HashMap<String, String>,   // key → the placement's serialized bytes (a String, not a Value: ~1x the file in memory, not ~5x)
    pub hits: u64,
    pub misses: u64,
    pub loaded: usize,
    pub skipped: usize,
    pub load_ms: u128,
}

impl PlaceCache {
    pub fn memory() -> PlaceCache { PlaceCache { path: None, map: HashMap::new(), hits: 0, misses: 0, loaded: 0, skipped: 0, load_ms: 0 } }
    /// read the append-log whole; a line that does not parse (a torn write, a foreign line) is counted and skipped
    pub fn open(path: &Path) -> PlaceCache { PlaceCache::open_filtered(path, None) }
    /// the one-shot's read: only the lines whose key is wanted are parsed (a prefix test per line), so a big log costs a
    /// scan, never a parse of every placement in it
    pub fn open_filtered(path: &Path, wanted: Option<&std::collections::HashSet<String>>) -> PlaceCache {
        let t0 = Instant::now();
        let mut c = PlaceCache::memory();
        c.path = Some(path.to_path_buf());
        if let Ok(f) = std::fs::File::open(path) {
            for line in std::io::BufReader::new(f).lines() {
                let Ok(line) = line else { c.skipped += 1; continue };
                if line.trim().is_empty() { continue; }
                if let Some(w) = wanted {
                    // {"k":"<sha>:<aperture>",… — serde_json writes "k" before "p" (an ordered map)
                    let key = line.strip_prefix("{\"k\":\"").and_then(|r| r.split('"').next()).unwrap_or("");
                    if !w.contains(key) { continue; }
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(v) => match (v.get("k").and_then(|k| k.as_str()), v.get("p")) {
                        (Some(k), Some(p)) => { c.map.insert(k.to_string(), p.to_string()); c.loaded += 1; }
                        _ => c.skipped += 1,
                    },
                    Err(_) => c.skipped += 1,
                }
            }
        }
        c.load_ms = t0.elapsed().as_millis();
        c
    }
    pub fn len(&self) -> usize { self.map.len() }
    pub fn get(&self, k: &str) -> Option<Value> { self.map.get(k).and_then(|s| serde_json::from_str(s).ok()) }
    /// insert and append — one write_all per batch on an O_APPEND handle, so concurrent writers interleave by whole batches
    pub fn insert_many(&mut self, rows: Vec<(String, Value)>) {
        if rows.is_empty() { return; }
        let mut buf = String::new();
        for (k, p) in &rows { buf.push_str(&json!({ "k": k, "p": p }).to_string()); buf.push('\n'); }
        for (k, p) in rows { self.map.insert(k, p.to_string()); }
        if let Some(path) = &self.path {
            if let Some(d) = path.parent() { let _ = std::fs::create_dir_all(d); }
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) { let _ = f.write_all(buf.as_bytes()); }
        }
    }
    pub fn status(&self) -> Value {
        let asked = self.hits + self.misses;
        json!({ "path": self.path.as_ref().map(|p| p.display().to_string()), "entries": self.map.len(), "loaded": self.loaded, "skipped": self.skipped,
                "loadMs": self.load_ms as u64, "hits": self.hits, "misses": self.misses,
                "hitRate": if asked == 0 { Value::Null } else { json!(((self.hits as f64 / asked as f64) * 1e4).round() / 1e4) } })
    }
}

// ── resolving a span to its bytes ────────────────────────────────────────────────────────────────────────────────────────
/// every blob sha in one `git cat-file --batch` process (never one spawn per blob)
fn read_blobs(repo: &Path, shas: &[String]) -> HashMap<String, Result<Vec<u8>, String>> {
    let mut out = HashMap::new();
    if shas.is_empty() { return out; }
    let child = std::process::Command::new("git").arg("-C").arg(repo).args(["cat-file", "--batch"])
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn();
    let mut child = match child { Ok(c) => c, Err(e) => { for s in shas { out.insert(s.clone(), Err(format!("git cat-file: {e}"))); } return out; } };
    {
        let mut stdin = child.stdin.take().unwrap();
        let input: String = shas.iter().map(|s| format!("{s}\n")).collect();
        std::thread::spawn(move || { let _ = stdin.write_all(input.as_bytes()); });
    }
    let mut rd = std::io::BufReader::new(child.stdout.take().unwrap());
    for s in shas {
        let mut header = String::new();
        if rd.read_line(&mut header).unwrap_or(0) == 0 { out.insert(s.clone(), Err("git cat-file: closed".into())); continue; }
        let parts: Vec<&str> = header.trim_end().split(' ').collect();
        if parts.len() == 3 && parts[1] == "blob" {
            let n: usize = parts[2].parse().unwrap_or(0);
            let mut body = vec![0u8; n + 1];   // the content, then the trailing LF
            if std::io::Read::read_exact(&mut rd, &mut body).is_ok() { body.truncate(n); out.insert(s.clone(), Ok(body)); }
            else { out.insert(s.clone(), Err("git cat-file: short read".into())); }
        } else if parts.len() == 3 {
            let n: usize = parts[2].parse().unwrap_or(0);
            let mut skip = vec![0u8; n + 1]; let _ = std::io::Read::read_exact(&mut rd, &mut skip);
            out.insert(s.clone(), Err(format!("not a blob: {}", parts[1])));
        } else {
            out.insert(s.clone(), Err(format!("blob {s}: missing")));
        }
    }
    let _ = child.wait();
    out
}

fn span_bytes(span: &Value, repo: &Path, blobs: &HashMap<String, Result<Vec<u8>, String>>) -> Result<Vec<u8>, String> {
    if let Some(b) = span.get("bytes").and_then(|v| v.as_str()) { return Ok(b.as_bytes().to_vec()); }
    if let Some(sha) = span.get("blob").and_then(|v| v.as_str()) { return blobs.get(sha).cloned().unwrap_or_else(|| Err("blob not read".into())); }
    if let Some(p) = span.get("path").and_then(|v| v.as_str()) {
        let pb = if Path::new(p).is_absolute() { PathBuf::from(p) } else { repo.join(p) };
        let all = std::fs::read(&pb).map_err(|e| format!("{p}: {e}"))?;
        let start = span.get("start").and_then(|v| v.as_u64()).map(|v| v as usize).unwrap_or(0).min(all.len());
        let end = span.get("end").and_then(|v| v.as_u64()).map(|v| v as usize).unwrap_or(all.len()).min(all.len()).max(start);
        return Ok(all[start..end].to_vec());
    }
    Err("span needs bytes, path or blob".into())
}

/// lensWalk's own cut: the first `max` UTF-16-ish characters (chars here), never bytes split mid-codepoint
fn cut_chars(t: String, max: Option<usize>) -> String {
    match max { Some(m) if t.chars().count() > m => t.chars().take(m).collect(), _ => t }
}

pub struct Stats { pub hits: usize, pub misses: usize, pub computed: usize, pub errors: usize, pub ms: u128 }

/// THE PLACE OPERATION: one placement per span, input order, misses walked in parallel through read_text, hits served from
/// the cache. A span that cannot be read answers { id, error } and never sinks the batch.
pub fn place_spans(spans: &[Value], args: &[String], repo: &Path, max_chars: Option<usize>, cache: Option<&Mutex<PlaceCache>>) -> (Vec<Value>, Stats, String) {
    place_spans_threaded(spans, args, repo, max_chars, cache, &[])
}
/// as place_spans; a non-empty `thread` (["--session", s, "--receipts-dir", d?, "--before", b?]) walks every span WITH the session
/// thread and bypasses the cache entirely (read and write)
pub fn place_spans_threaded(spans: &[Value], args: &[String], repo: &Path, max_chars: Option<usize>, cache: Option<&Mutex<PlaceCache>>, thread: &[String]) -> (Vec<Value>, Stats, String) {
    let t0 = Instant::now();
    let args = clean_args(args);
    let cache = if thread.is_empty() { cache } else { None };
    let aperture = aperture_hash(repo, &args);
    let blob_shas: Vec<String> = { let mut v: Vec<String> = spans.iter().filter(|s| s.get("bytes").is_none()).filter_map(|s| s.get("blob").and_then(|b| b.as_str()).map(String::from)).collect(); v.sort(); v.dedup(); v };
    let blobs = read_blobs(repo, &blob_shas);
    // resolve every span to (id, text, key) or an error
    let resolved: Vec<(Value, Result<(String, String), String>)> = spans.iter().map(|s| {
        let id = s.get("id").cloned().unwrap_or(Value::Null);
        let r = span_bytes(s, repo, &blobs).map(|b| { let t = cut_chars(String::from_utf8_lossy(&b).into_owned(), max_chars); let sha = sha256_hex(t.as_bytes()); (t, sha) });
        (id, r)
    }).collect();
    // hits under the lock; the distinct misses computed with the lock released
    let mut found: HashMap<String, Value> = HashMap::new();
    let mut todo: Vec<(String, String)> = Vec::new();   // (sha, text), distinct
    {
        let guard = cache.map(|c| c.lock().unwrap());
        let mut seen = std::collections::HashSet::new();
        for (_, r) in &resolved {
            if let Ok((t, sha)) = r {
                let key = format!("{sha}:{aperture}");
                if found.contains_key(&key) || !seen.insert(key.clone()) { continue; }
                match guard.as_ref().and_then(|g| g.get(&key)) { Some(p) => { found.insert(key, p); } None => todo.push((sha.clone(), t.clone())) }
            }
        }
    }
    let opts = lens::LensOpts { args: args.iter().chain(thread.iter()).cloned().collect(), source: "place".into() };
    let computed: Vec<(String, Result<Value, String>)> = todo.par_iter().map(|(sha, t)| (format!("{sha}:{aperture}"), lens::read_text(t, &opts, repo).map(|v| project(&v)))).collect();
    let mut fresh: Vec<(String, Value)> = Vec::new();
    let mut walk_err: HashMap<String, String> = HashMap::new();
    for (k, r) in computed { match r { Ok(p) => { found.insert(k.clone(), p.clone()); fresh.push((k, p)); } Err(e) => { walk_err.insert(k, e); } } }
    let n_computed = fresh.len();
    // count per span (a duplicate span of a miss computed in this batch is a hit: it walked once)
    let mut hits = 0usize; let mut misses = 0usize; let mut errors = 0usize;
    let mut first_seen = std::collections::HashSet::new();
    let fresh_keys: std::collections::HashSet<String> = fresh.iter().map(|(k, _)| k.clone()).collect();
    let out: Vec<Value> = resolved.into_iter().map(|(id, r)| match r {
        Err(e) => { errors += 1; json!({ "id": id, "error": e }) }
        Ok((_, sha)) => {
            let key = format!("{sha}:{aperture}");
            match found.get(&key) {
                Some(p) => {
                    if fresh_keys.contains(&key) && first_seen.insert(key.clone()) { misses += 1; } else { hits += 1; }
                    json!({ "id": id, "sha": sha, "aperture": aperture, "cell": p.get("pixel").cloned().unwrap_or(Value::Null), "placement": p })
                }
                None => { errors += 1; json!({ "id": id, "sha": sha, "aperture": aperture, "error": walk_err.get(&key).cloned().unwrap_or_else(|| "walk failed".into()) }) }
            }
        }
    }).collect();
    if let Some(c) = cache { let mut g = c.lock().unwrap(); g.hits += hits as u64; g.misses += misses as u64; g.insert_many(fresh); }
    (out, Stats { hits, misses, computed: n_computed, errors, ms: t0.elapsed().as_millis() }, aperture)
}

/// the resident's `place` op: { op:"place", id, spans:[…], args?:[…], max_chars?, repo? }
pub fn handle_op(req: &Value, cache: &Mutex<PlaceCache>, default_repo: &Path) -> Value {
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let spans: Vec<Value> = match req.get("spans").and_then(|v| v.as_array()) { Some(a) => a.clone(), None => return json!({ "id": id, "error": "place: spans required" }) };
    let args: Vec<String> = req.get("args").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    let max_chars = req.get("max_chars").and_then(|v| v.as_u64()).map(|v| v as usize);
    let repo = req.get("repo").and_then(|v| v.as_str()).map(PathBuf::from).unwrap_or_else(|| default_repo.to_path_buf());
    let mut thread: Vec<String> = Vec::new();
    if let Some(sess) = req.get("session").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        thread.extend(["--session".to_string(), sess.to_string()]);
        if let Some(d) = req.get("receipts_dir").and_then(|v| v.as_str()) { thread.extend(["--receipts-dir".to_string(), d.to_string()]); }
        if let Some(b) = req.get("before").and_then(|v| v.as_str()) { thread.extend(["--before".to_string(), b.to_string()]); }
    }
    let (placements, st, aperture) = place_spans_threaded(&spans, &args, &repo, max_chars, Some(cache), &thread);
    let status = cache.lock().unwrap().status();
    json!({ "id": id, "op": "place", "aperture": aperture, "n": placements.len(), "hits": st.hits, "misses": st.misses, "computed": st.computed, "errors": st.errors, "ms": st.ms as u64, "cached": thread.is_empty(), "build_id": crate::door::build_id(), "cache": status, "placements": placements })
}

/// `pmu-onchip --place-batch [knob flags…] [--max-chars N] [--repo R] [--cache P | --no-cache]` — the one-shot twin for when
/// the resident is down: NDJSON spans on stdin, one placement line per span on stdout (the same bytes the resident's
/// `placements` array carries), the counts on stderr. Same place_spans, same cache file by default.
pub fn run_place_batch(args: &[String]) {
    let repo = repo_root(flag_val(args, "--repo").as_deref());
    let mut buf = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut buf).is_err() { eprintln!("--place-batch: could not read stdin"); std::process::exit(2); }
    let spans: Vec<Value> = buf.lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str::<Value>(l).unwrap_or_else(|e| json!({ "error_line": format!("bad json: {e}") }))).collect();
    let max_chars = flag_val(args, "--max-chars").and_then(|s| s.parse().ok());
    let knobs: Vec<String> = { let mut v = Vec::new(); let mut i = 0; while i < args.len() { if args[i] == "--max-chars" { i += 2; continue; } if i == 0 && !args[i].starts_with("--") { i += 1; continue; } v.push(args[i].clone()); i += 1; } v };
    let cache = if args.iter().any(|a| a == "--no-cache") { None } else {
        // read only the keys this batch can hit: the spans' own sha under this aperture (blobs are keyed after they are read,
        // so a blob span is a scan miss here and a walk; the resident, which holds the whole log, serves those warm)
        let ap = aperture_hash(&repo, &clean_args(&knobs));
        let wanted: std::collections::HashSet<String> = spans.iter().filter_map(|s| {
            let b = if let Some(t) = s.get("bytes").and_then(|v| v.as_str()) { Some(t.as_bytes().to_vec()) } else if s.get("path").is_some() { span_bytes(s, &repo, &HashMap::new()).ok() } else { None }?;
            Some(format!("{}:{}", sha256_hex(cut_chars(String::from_utf8_lossy(&b).into_owned(), max_chars).as_bytes()), ap))
        }).collect();
        Some(Mutex::new(PlaceCache::open_filtered(&flag_val(args, "--cache").map(PathBuf::from).unwrap_or_else(|| default_cache_path(&repo)), Some(&wanted))))
    };
    let (out, st, aperture) = place_spans(&spans, &knobs, &repo, max_chars, cache.as_ref());
    let stdout = std::io::stdout(); let mut w = stdout.lock();
    for v in &out { let _ = writeln!(w, "{}", v); }
    let _ = w.flush();
    eprintln!("pmu-onchip --place-batch: {} spans · {} hits · {} misses · {} errors · aperture {} · {} ms", out.len(), st.hits, st.misses, st.errors, aperture, st.ms);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repo() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap() }
    const T1: &str = "The resident keeps a content-addressed placement cache keyed by blob sha and aperture hash, persisted so a restart keeps it, and reports its hit rate. Identical bytes give identical bytes out, and a placement already computed is never walked again.";

    #[test]
    fn clean_args_strips_the_session_thread_and_the_door() {
        let a: Vec<String> = ["--lens", "--seed", "matched", "--session", "s1", "--text", "x", "--guided-passes", "2", "--no-cache"].iter().map(|s| s.to_string()).collect();
        assert_eq!(clean_args(&a), vec!["--seed", "matched", "--guided-passes", "2"]);
    }

    #[test]
    fn identical_bytes_give_identical_bytes_and_the_second_ask_is_a_hit() {
        let r = repo();
        if !r.join("data/pmu/snippet-library-144.json").exists() { return; }
        let dir = std::env::temp_dir().join(format!("pmu-place-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let cp = dir.join("cache.ndjson"); let _ = std::fs::remove_file(&cp);
        let args: Vec<String> = ["--seed", "matched", "--guided-passes", "2"].iter().map(|s| s.to_string()).collect();
        let spans = vec![json!({ "id": "a", "bytes": T1 }), json!({ "id": "b", "bytes": T1 }), json!({ "id": "c", "path": "/no/such/file" })];
        let c = Mutex::new(PlaceCache::open(&cp));
        let (o1, s1, ap1) = place_spans(&spans, &args, &r, Some(800), Some(&c));
        assert_eq!((s1.misses, s1.hits, s1.errors, s1.computed), (1, 1, 1, 1), "a duplicate span inside one batch walks once");
        assert_eq!(o1[0]["placement"], o1[1]["placement"]);
        assert!(o1[0]["cell"].is_string() || o1[0]["cell"].is_null());
        assert!(o1[2]["error"].is_string());
        // a restart: a fresh cache read from the same file serves it without walking, byte for byte
        let c2 = Mutex::new(PlaceCache::open(&cp));
        assert_eq!(c2.lock().unwrap().len(), 1);
        let (o2, s2, ap2) = place_spans(&spans[..1], &args, &r, Some(800), Some(&c2));
        assert_eq!(ap1, ap2);
        assert_eq!((s2.hits, s2.misses, s2.computed), (1, 0, 0));
        assert_eq!(o1[0].to_string(), o2[0].to_string(), "identical bytes in, identical bytes out — cold or warm");
        // no cache at all: the same bytes still
        let (o3, s3, _) = place_spans(&spans[..1], &args, &r, Some(800), None);
        assert_eq!(s3.computed, 1);
        assert_eq!(o1[0].to_string(), o3[0].to_string());
        // a different flag vector is a different aperture, never a hit
        let args2: Vec<String> = ["--seed", "matched", "--guided-passes", "1"].iter().map(|s| s.to_string()).collect();
        assert_ne!(aperture_hash(&r, &clean_args(&args2)), ap1);
        let st = c2.lock().unwrap().status();
        assert_eq!(st["hitRate"], 1.0);
    }

    #[test]
    fn the_placement_is_the_lens_placement() {
        let r = repo();
        if !r.join("data/pmu/snippet-library-144.json").exists() { return; }
        let args: Vec<String> = ["--seed", "matched", "--guided-passes", "2"].iter().map(|s| s.to_string()).collect();
        let full = lens::read_text(T1, &lens::LensOpts { args: args.clone(), source: "lens".into() }, &r).unwrap();
        let (o, _, _) = place_spans(&[json!({ "id": 1, "bytes": T1 })], &args, &r, None, None);
        assert_eq!(o[0]["placement"], project(&full), "one placer: place is read_text, projected");
        assert_eq!(o[0]["cell"], full["pixel"]);
    }

    #[test]
    fn a_session_thread_is_walked_with_the_thread_and_never_cached() {
        let r = repo();
        if !r.join("data/pmu/snippet-library-144.json").exists() { return; }
        let dir = std::env::temp_dir().join(format!("pmu-place-thread-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let cp = dir.join("c.ndjson"); let _ = std::fs::remove_file(&cp);
        let c = Mutex::new(PlaceCache::open(&cp));
        let args: Vec<String> = ["--seed", "matched", "--guided-passes", "2"].iter().map(|s| s.to_string()).collect();
        let thread: Vec<String> = ["--session", "no-such-session", "--receipts-dir", dir.to_str().unwrap()].iter().map(|s| s.to_string()).collect();
        let (o, st, _) = place_spans_threaded(&[json!({ "id": 1, "bytes": "short" })], &args, &r, None, Some(&c), &thread);
        assert_eq!(st.computed, 1);
        assert_eq!(c.lock().unwrap().len(), 0, "a threaded walk is never written to the cache");
        let mut full_args = args.clone(); full_args.extend(thread.clone());
        let full = lens::read_text("short", &lens::LensOpts { args: full_args, source: "lens".into() }, &r).unwrap();
        assert_eq!(o[0]["placement"], project(&full));
    }

    #[test]
    fn a_torn_line_is_skipped_never_fatal() {
        let dir = std::env::temp_dir().join(format!("pmu-place-torn-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("c.ndjson");
        std::fs::write(&p, "{\"k\":\"x:y\",\"p\":{\"pixel\":\"A,A\"}}\n{\"k\":\"tor\n\n").unwrap();
        let c = PlaceCache::open(&p);
        assert_eq!((c.len(), c.skipped), (1, 1));
    }
}
