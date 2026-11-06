// src/ledger_shas.rs — C171a: THE AMENDMENTS LEDGER'S SHA SET, STREAMED, WITH AN INCREMENTAL INDEX.
//
// WHY (operator 2026-09-23, verbatim: "maximise the to rust translateion and mem use"). engine-map.mjs's HOLDS-MASS pass
// ranked scripts/vna/transcript-rows.mjs first: its ledgerShas() read the whole docs/specs/vna/amendments.ndjson
// (415 MB) into one string, split it, and JSON.parse'd every line on every call — 1803 MB peak RSS, ~2 s, fired up to
// once per 5 s from the PostToolUse hook (~380/h). The answer it wants is small: the sha256 of every row whose
// via === 'transcript'. So this mode never holds the file: it line-streams from a byte offset, and keeps the answer in a
// SIDECAR INDEX updated incrementally by that offset — the first call reads the ledger once, every later call reads only
// the bytes appended since.
//
// THE SEMANTICS ARE THE NODE PATH'S, EXACTLY (the guard compares the two sets on fixtures and on the real record):
//   · a line is the bytes between '\n's; an empty line is skipped; the last line counts even without a '\n';
//   · a line that is not valid JSON is skipped (node: JSON.parse throws, caught); invalid UTF-8 is decoded lossily, as
//     node's utf8 decode does, BEFORE the parse;
//   · a row counts when it is a JSON object, its `via` is the string "transcript" and its `sha256` is a non-empty string.
//   A cheap byte prefilter (the line contains `transcript`) skips the parse of every other line; JSON.stringify never
//   escapes ASCII letters, and the real-record leg of the guard is what holds that assumption to account.
//
// THE INDEX. Line 1 is a header {"v":1,"ledger":<abs path>,"offset":N,"tail":<hex of the ≤64 bytes before N>}; every
// further line is one sha. It is trusted only when the ledger is the same path, at least N bytes long, and still carries
// the same tail bytes before N — a truncated or rewritten ledger rebuilds from 0 (rebuilt:true), never serves a stale
// set. Only COMPLETE lines advance the offset; a trailing partial line is read for this answer and read again next time.
// Written atomically (tmp + rename), so two concurrent callers leave one valid index, never a torn one.
//
//   pmu-onchip --ledger-shas --ledger <amendments.ndjson> [--index <sidecar>]
//   stdout: `rust-ledger-shas\t<count>` then one sha per line (first-seen order, deduplicated)
//   stderr: one JSON summary {engine, from, to, size, scanned, shas, rebuilt, index}
// LLM-free, no clock read; two runs over the same ledger print byte-identical stdout.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;

const TAIL: u64 = 64;
const NEEDLE: &[u8] = b"transcript";

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(|s| s.as_str())
}

fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    if hay.len() < needle.len() { return false; }
    let first = needle[0];
    let mut i = 0;
    let last = hay.len() - needle.len();
    while i <= last {
        match hay[i..=last].iter().position(|&c| c == first) {
            None => return false,
            Some(p) => { i += p; if &hay[i..i + needle.len()] == needle { return true; } i += 1; }
        }
    }
    false
}

/// The node path's per-line predicate: Some(sha) when the line is an object with via === "transcript" and a non-empty
/// string sha256.
pub fn sha_of_line(line: &[u8]) -> Option<String> {
    if line.is_empty() || !contains(line, NEEDLE) { return None; }
    let text = String::from_utf8_lossy(line);
    let v: Value = serde_json::from_str(&text).ok()?;
    let o = v.as_object()?;
    if o.get("via").and_then(|x| x.as_str()) != Some("transcript") { return None; }
    match o.get("sha256").and_then(|x| x.as_str()) { Some(s) if !s.is_empty() => Some(s.to_string()), _ => None }
}

fn read_tail(f: &mut File, offset: u64) -> std::io::Result<Vec<u8>> {
    let n = offset.min(TAIL);
    let mut buf = vec![0u8; n as usize];
    if n > 0 { f.seek(SeekFrom::Start(offset - n))?; f.read_exact(&mut buf)?; }
    Ok(buf)
}

/// Load a trusted index: (offset, shas) — or None when it is absent, malformed, for another ledger, or stale.
fn load_index(index: &Path, ledger_abs: &str, f: &mut File, size: u64) -> Option<(u64, Vec<String>)> {
    let raw = fs::read_to_string(index).ok()?;
    let mut lines = raw.split('\n');
    let head: Value = serde_json::from_str(lines.next()?).ok()?;
    if head.get("v").and_then(|x| x.as_u64()) != Some(1) { return None; }
    if head.get("ledger").and_then(|x| x.as_str()) != Some(ledger_abs) { return None; }
    let offset = head.get("offset").and_then(|x| x.as_u64())?;
    if offset > size { return None; }
    let tail = head.get("tail").and_then(|x| x.as_str())?;
    if hex(&read_tail(f, offset).ok()?) != tail { return None; }
    Some((offset, lines.filter(|l| !l.is_empty()).map(|l| l.to_string()).collect()))
}

pub struct Scan { pub shas: Vec<String>, pub offset: u64, pub from: u64, pub size: u64, pub scanned: u64, pub rebuilt: bool, pub index_written: bool }

/// Stream `ledger` from the index's offset (or 0), returning every transcript sha and the new complete-line offset.
pub fn scan(ledger: &Path, index: Option<&Path>) -> std::io::Result<Scan> {
    let ledger_abs = fs::canonicalize(ledger).map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| ledger.to_string_lossy().to_string());
    let mut f = match File::open(ledger) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Scan { shas: vec![], offset: 0, from: 0, size: 0, scanned: 0, rebuilt: false, index_written: false }),
        Err(e) => return Err(e),
    };
    let size = f.metadata()?.len();
    let prior = index.and_then(|ix| load_index(ix, &ledger_abs, &mut f, size));
    let rebuilt = index.is_some() && prior.is_none();
    let (from, mut shas) = prior.unwrap_or((0, vec![]));
    let mut seen: HashSet<String> = shas.iter().cloned().collect();
    f.seek(SeekFrom::Start(from))?;
    let mut r = BufReader::with_capacity(1 << 20, f.try_clone()?);
    let mut line: Vec<u8> = Vec::with_capacity(1 << 16);
    let mut offset = from;
    let mut scanned = 0u64;
    let mut partial: Option<String> = None;
    loop {
        line.clear();
        let n = r.read_until(b'\n', &mut line)? as u64;
        if n == 0 { break; }
        scanned += n;
        let complete = line.last() == Some(&b'\n');
        let body: &[u8] = if complete { &line[..line.len() - 1] } else { &line[..] };
        let hit = sha_of_line(body);
        if complete {
            offset += n;
            if let Some(s) = hit { if seen.insert(s.clone()) { shas.push(s); } }
        } else {
            partial = hit;   // the answer includes it; the index does not, until its '\n' lands
        }
    }
    let mut index_written = false;
    if let Some(ix) = index {
        if offset != from || rebuilt {
            let tail = hex(&read_tail(&mut f, offset)?);
            let mut out = String::with_capacity(96 + shas.len() * 65);
            out.push_str(&json!({ "v": 1, "ledger": ledger_abs, "offset": offset, "tail": tail }).to_string());
            out.push('\n');
            for s in &shas { out.push_str(s); out.push('\n'); }
            if let Some(dir) = ix.parent() { let _ = fs::create_dir_all(dir); }
            let tmp = ix.with_extension(format!("tmp{}", std::process::id()));
            fs::write(&tmp, out)?;
            fs::rename(&tmp, ix)?;
            index_written = true;
        }
    }
    if let Some(s) = partial { if !seen.contains(&s) { shas.push(s); } }
    Ok(Scan { shas, offset, from, size, scanned, rebuilt, index_written })
}

pub fn run(args: &[String]) {
    let ledger = match flag(args, "--ledger") { Some(p) => p, None => { eprintln!("pmu-onchip --ledger-shas: --ledger <path> is required"); std::process::exit(2); } };
    let index = flag(args, "--index").map(Path::new);
    match scan(Path::new(ledger), index) {
        Ok(s) => {
            let stdout = std::io::stdout();
            let mut w = std::io::BufWriter::new(stdout.lock());
            let _ = writeln!(w, "rust-ledger-shas\t{}", s.shas.len());
            for x in &s.shas { let _ = writeln!(w, "{}", x); }
            let _ = w.flush();
            eprintln!("{}", json!({ "engine": "rust-ledger-shas", "from": s.from, "to": s.offset, "size": s.size, "scanned": s.scanned, "shas": s.shas.len(), "rebuilt": s.rebuilt, "index": s.index_written }));
        }
        Err(e) => { eprintln!("pmu-onchip --ledger-shas: {}", e); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn predicate_matches_the_node_path() {
        assert_eq!(sha_of_line(br#"{"via":"transcript","sha256":"ab"}"#), Some("ab".into()));
        assert_eq!(sha_of_line(br#"{"via":"transcript","sha256":""}"#), None);
        assert_eq!(sha_of_line(br#"{"via":"clip","sha256":"ab","text":"transcript"}"#), None);
        assert_eq!(sha_of_line(br#"["transcript","ab"]"#), None);
        assert_eq!(sha_of_line(br#"{"via":"transcript","sha256":"ab""#), None);
        assert_eq!(sha_of_line(b"{\"via\":\"transcript\",\"sha256\":\"ab\"}\r"), Some("ab".into()));
    }
}
