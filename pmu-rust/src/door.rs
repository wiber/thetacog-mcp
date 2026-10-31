// .thetacog/pmu/src/door.rs — C612b THE DOOR AND THE SLOT IN THE CRATE.
//
// `pmu-onchip --door-serve` — ONE long-lived process for the drift note's two node-side hot spots (C610n measured them:
// the Δ door's node compose ~15 s, the code slot's tree read ~5.6 s). NDJSON requests on stdin, one JSON line per
// request on stdout. Node (scripts/vna/door-crate.mjs) spawns it once per process and only shuttles bytes.
//
//   {"op":"sense","id":1,"pairs":"<pair-sigs-144-*.json>","sides":[["<u64 dec>",…],…],"target":900,"floor":0.56}
//       → per side { score_b64 (f32 LE ×20,736), grid_b64 (MSB-first bits), lit, theta } — triptych-build.mjs senseDecompose's
//         max over claims of 1 − hamming/64 against the 20,736 pair signatures, the TARGET-th largest score as θ (floored),
//         and the lit grid. The pair signatures (the static anchor mass) are parsed ONCE per path and held.
//   {"op":"walks","id":2,"lib":"<snippet-library-144.json>","seeds":[a,b],"grids":["<packed b64>",…],"knobs":{…}}
//       → { walks: [ lens.rs definer_walk, one per grid ] } — the panel's 2 + impostor walks in one call (rayon), no temp
//         grid files, no per-walk spawn. The walk is lens.rs's own (definer_walk_value), never a copy.
//         With a reading's sealed stamp and a kill it seals the verdict (C1409) and walks the frozen stranger panel against the
//         spec with the same walk, sealed as spec_strangers (C1428 S3b); admit reads it.
//   {"op":"slot","id":3,"repo":"<repo>","files":[…],"sym_terms":[…],"word_terms":[…]}
//       → { sym: [[ [file,[lines]],… ] per term], word: [ … ] } — code-slot.mjs hitsMany's rule (git grep -F / -F -w -i, -I),
//         every file read once for both term sets.
//   {"op":"anchors","id":4,"head":"<sha>","dir":"<repo>/.thetacog/anchor-clen","level":9,"anchors":[{"id","text"},…]}
//       → { computed, loaded, path } — the gzip length of every static anchor, cached ONCE PER HEAD at <dir>/<head>.bin
//         (and in memory). A second call at the same HEAD computes nothing (the guard reads `computed`).
//   {"op":"ncd","id":5,"head":"<sha>","prompt":"…","ids":[…]}
//       → { ncd: {id: value}, computed_pairs } — spec-tree.mjs ncd(prompt, anchor): only C(prompt) and C(prompt\nanchor)
//         are compressed per note; C(anchor) comes from the cache.
//   {"op":"panel","id":6,"intent":"…","reality":"…","clauses":[…],…}  (C612r, door_panel.rs)
//       → the encircled panel composed here: the pipeline stages, the claim sense, the ten walks, the tolerance decode, the regions,
//         the rings and the png, the clauses' placements — node only labels the rings and slices the clauses into them.
//   {"op":"bind","id":7,"doc":{ repo, queries:[{ at, paths, weigh?, k? }], flag?, probe? }}  (C620)
//       → { out: <exactly what `pmu-onchip --path-bind` prints for that doc>, held } — path_predict.rs bind::answer over a Binder
//         the daemon keeps per repo (sections · trees · size reads at an immutable sha), so a first-seen pixel stops paying a
//         spawn plus a cold cat-file. A doc whose every `at` is a full sha is answered by the held Binder; anything else (HEAD, a
//         branch) by a fresh one, so a moving name is never served from a stale cache.
//   {"op":"entry","id":8,"texts":[{"field","text"},…],"axes":"<snippet-library-144.json>","aperture":{files,rels,constants}}
//       → { state: ADMITTED | UNMEASURED, refused, field?, chars?, gz_bytes?, reason?, floor, stamp } (C1394) — the walk entry's floor and
//         its health stamp (apertureVersion · axes_sha · engine · sizes; no reef_sha since C1407), before any sense or walk.
//   {"op":"verify","id":9,"stamp":{…}}
//       → { ok, reason, build_id } (C1406) — the stamp's seal recomputed under this binary's build id, engine rust, every size at or
//         over the floor, the sense and walk stages present. sense and walks take an optional "stamp" and answer it re-sealed.
//   {"op":"mass","id":10,"texts":[{"field","text"},…],"floor":"entry"|"gz","trim":true|false}
//       → { floor: { chars, gz_bytes, applies }, sizes: [{ field, chars, gz_bytes, at_mass }], under, refused, reason } (C1409) — the
//         floor decided for a text nobody walks (a tape triangulation, an aperture window, a bench's eye): node relays at_mass.
//   {"op":"ping"} · {"op":"shutdown"}
//
// ONE COMPRESSOR: every length here is the vendored Node/Chromium zlib (lens.rs's FFI) at node's settings, so a crate NCD
// and a node gzipSync NCD are the same number by construction; the guard holds them equal on fixtures.
// Sufficient for: computing the note's door/slot/NCD inputs faster with the same answers. Not for: whether the note is right.
// @guard tests/vna/c612b-the-door-and-the-slot-in-the-crate.test.mjs

use crate::ballistic::CELLS;
use base64::Engine;
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

// C612r: {"op":"panel"} — the encircled panel composed in this one process (the pipeline, the claims, the decode, the rings)
#[path = "door_panel.rs"]
pub mod panel;

/// gzip length at a given level, EXACTLY as node's gzipSync(buf, { level }) (level -1 = node's default).
pub fn gzip_len_level(data: &[u8], level: i32) -> usize {
    use crate::lens::{deflate, deflateBound, deflateEnd, deflateInit2_, ZStream};
    unsafe {
        let mut s: ZStream = std::mem::zeroed();
        let version = b"1.3.1\0";
        let rc = deflateInit2_(&mut s, level, 8, 15 + 16, 8, 0, version.as_ptr() as *const std::ffi::c_char, std::mem::size_of::<ZStream>() as i32);
        assert_eq!(rc, 0, "deflateInit2 failed ({})", rc);
        let cap = deflateBound(&mut s, data.len() as std::ffi::c_ulong) as usize + 32;
        let mut out = vec![0u8; cap];
        s.next_in = data.as_ptr() as *mut u8;
        s.avail_in = data.len() as u32;
        s.next_out = out.as_mut_ptr();
        s.avail_out = cap as u32;
        let rc = deflate(&mut s, 4);
        assert_eq!(rc, 1, "deflate(Z_FINISH) failed ({})", rc);
        let len = s.total_out as usize;
        deflateEnd(&mut s);
        len
    }
}

// ── C1394 THE INSTRUMENT REFUSES STARVED INPUT AT THE ONE ENTRY ─────────────────────────────────────────────────────────
// The floor used to live in the CALLER: C1376 put it in the demo's freeform path, and the tripwire sweep, a caller born a
// day later, fed the walk 224–258 characters and 161–190 gzip bytes and read the pure sledgehammer job IN_LANE. Thirteen
// modules reach buildTriptychInputs; every new door that forgot the check repeated the mistake. The check moved HERE, into
// the crate, at the one entry node calls before any sense or walk (`{"op":"entry"}`): every intent, reality or negative
// text below OOC_MIN_CHARS trimmed characters (UTF-16 units, JS String.length) or below aperture.rs MIN_GZIP_BYTES of gzip
// mass (node's gzipSync default, the vendored zlib) is REFUSED — state UNMEASURED, the field and both sizes named — and the
// node side returns that refusal instead of a panel. Every answer, refusal or admission, carries the HEALTH STAMP computed
// here: apertureVersion (prompt-lens.mjs apertureVersion()'s recipe over the bytes node points at), reef_sha and axes_sha
// (sha256[:16] of the files, walk-door.mjs's convention), engine "rust", and every text's sizes. Node only carries the
// texts in and the receipt out; it decides nothing and stamps nothing.
// Sufficient for: whether a reading was taken at measurable mass on a named instrument. Not for: whether it is right (Rice).
// @guard tests/pmu/instrument-refuses-starved-input.test.mjs
/// the chars floor — below it a passage places unstably (a 190-char recipe read 100 % in-character). ONE Rust home; the gzip
/// floor is aperture.rs MIN_GZIP_BYTES. scripts/rewrite/tesseract.mjs carries the block `pmu-onchip --constants js` prints,
/// and the guard compares the two byte for byte.
pub const OOC_MIN_CHARS: usize = 320;

// ── C1410 S2 THE SPEC'S MARGIN IS COMPUTED IN THE CRATE, AND A TIE IS UNPLACEABLE ────────────────────────────────────────────
// wo3 (a fresh session on 2.57.0) placed a plumbing job, a sonnet and "delete the production database, wipe backups, email password
// hashes to an external Gmail" in one family with margins 0.0016–0.0054 over the runner-up, and the demo printed a home cell and an
// authorized lane off each: a tie dressed as a placement. The spec's placement is now taken HERE, at the entry, on the one library
// the walk reads (the `axes` file the stamp hashes): placePixel's gzip-NCD over every cell (C612b2, place_pixel's own formula), the
// home cell, the runner-up, the margin between them and the σ of the other cells. THE FLOOR IS DERIVED, NEVER FITTED TO A SPEC: if
// the n cells after the home were exchangeable (no cell is the spec's), the gap between the top two, in units of their measured σ,
// is asymptotically Exp(√(2 ln n)) (the top spacing of n draws in the Gumbel domain), so p = exp(−gap·√(2 ln n)) is the chance a
// tie opens a gap this wide. A spec whose p is over SPEC_MARGIN_P is UNPLACEABLE: no home cell, no authorized lane, both cells and
// the margin printed. Measured 2026-10-29 on data/pmu/snippet-library-144.json (n = 143, floor gap 0.951 σ): sonnet 0.0025 (gap
// 0.14 σ, p 0.64) and exfiltration 0.0021 (0.11 σ, p 0.71) UNPLACEABLE; plumbing 0.0468 (2.04 σ, p 0.0016) PLACED; C1393's surgical
// spec 0.0064 (0.40 σ, p 0.29) UNPLACEABLE too — its placement is weak, and S3 (its own positive IN_LANE, its own negative
// OFF_DOMAIN) is what admits it to a verdict, never this margin. Sufficient for: whether the spec's home cell beats a tie. Not for:
// whether the spec separates the work it names (S3), or whether it is the right spec (the author's).
// @guard tests/pmu/spec-quality-in-the-crate.test.mjs
/// the p a spec's home-over-runner-up gap must reach under the exchangeable-cell null — ONE Rust home, `pmu-onchip --constants js`
pub const SPEC_MARGIN_P: f64 = 0.05;
/// the gap floor in σ units for n cells after the home: ln(1/P) / √(2 ln n)
pub fn spec_gap_floor(n: usize) -> f64 { if n < 2 { return f64::INFINITY; } (1.0 / SPEC_MARGIN_P).ln() / (2.0 * (n as f64).ln()).sqrt() }
fn r6(x: f64) -> f64 { (x * 1e6).round() / 1e6 }
/// C1410: the spec's placement on the walk's library — PLACED or UNPLACEABLE, both cells, the margin, the gap, its p, the floor
pub fn spec_margin(spec: &str, lib_path: &str) -> Value {
    let unmeasured = |why: String| json!({ "state": "UNMEASURED", "reason": why, "p_floor": SPEC_MARGIN_P });
    let lib: Value = match std::fs::read(lib_path).ok().and_then(|b| serde_json::from_slice(&b).ok()) { Some(v) => v, None => return unmeasured(format!("the library {} could not be read", lib_path)) };
    let cells: Vec<(String, String)> = lib.as_array().map(|a| a.iter().filter_map(|x| Some((x.get("coord")?.as_str()?.to_string(), x.get("snippet")?.as_str()?.to_string()))).collect()).unwrap_or_default();
    if cells.len() < 3 { return unmeasured(format!("the library holds {} cells, too few to place against", cells.len())); }
    let doc = js_trim(spec);
    let doc_z = gzip_len_level(doc.as_bytes(), -1) as f64;
    let mut gz: Vec<(usize, f64)> = cells.par_iter().enumerate().map(|(i, (_, snip))| {
        let sz = gzip_len_level(snip.as_bytes(), -1) as f64;
        let mut j = String::with_capacity(doc.len() + 1 + snip.len()); j.push_str(doc); j.push('\n'); j.push_str(snip);
        let join_z = gzip_len_level(j.as_bytes(), -1) as f64;
        let numer = join_z - doc_z.min(sz); let denom = doc_z.max(sz);
        (i, if denom == 0.0 { 0.0 } else { f64::max(0.0, 1.0 - numer / denom) })
    }).collect();
    gz.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));   // stable, as place_pixel
    let rest: Vec<f64> = gz[1..].iter().map(|x| x.1).collect();
    let n = rest.len();
    let mean = rest.iter().sum::<f64>() / n as f64;
    let std = (rest.iter().map(|b| (b - mean).powi(2)).sum::<f64>() / n as f64).sqrt();
    let (top, second) = (gz[0].1, gz[1].1);
    let margin = top - second;
    let gap = if std > 0.0 { margin / std } else { 0.0 };
    let scale = (2.0 * (n as f64).ln()).sqrt();
    let p = (-gap * scale).exp();
    let floor = spec_gap_floor(n);
    let placed = std > 0.0 && gap >= floor;
    let (home, ru) = (cells[gz[0].0].0.clone(), cells[gz[1].0].0.clone());
    let state = if placed { "PLACED" } else { "UNPLACEABLE" };
    let line = format!("{} · home {} over runner-up {} by {:.4} (gap {:.2} σ, p {:.4} under the exchangeable-cell null; floor p {} = gap {:.3} σ over {} cells)",
        state, home, ru, margin, gap, p, SPEC_MARGIN_P, floor, n);
    json!({ "state": state, "home": home, "runner_up": ru, "home_score": r6(top), "runner_up_score": r6(second), "margin": r6(margin),
        "sigma": r6(if std > 0.0 { (top - mean) / std } else { 0.0 }), "gap_sigma": r6(gap), "p_null": r6(p), "p_floor": SPEC_MARGIN_P,
        "gap_floor": r6(floor), "cells": cells.len(), "line": line })
}

/// `pmu-onchip --constants` — the walk entry's floor as JSON (one line)
pub fn floor_constants_json() -> String {
    format!("{{\"MIN_GZIP_BYTES\":{},\"OOC_MIN_CHARS\":{},\"SPEC_MARGIN_P\":{}}}\n", crate::aperture::MIN_GZIP_BYTES, OOC_MIN_CHARS, SPEC_MARGIN_P)
}
/// `pmu-onchip --constants js` — the generated block scripts/rewrite/tesseract.mjs carries verbatim
pub fn floor_constants_js() -> String {
    format!("// ── GENERATED by `pmu-onchip --constants js` (C1394) — the walk entry's floor, from its one Rust home: door.rs OOC_MIN_CHARS ·\n// intentguard aperture.rs MIN_GZIP_BYTES. Never hand-edit; tests/pmu/instrument-refuses-starved-input.test.mjs compares it byte for byte.\nexport const MIN_GZIP_BYTES = {};\nexport const OOC_MIN_CHARS = {};\n// C1410 S2: the p a spec's home-over-runner-up gap must reach under the exchangeable-cell null (door.rs SPEC_MARGIN_P).\nexport const SPEC_MARGIN_P = {};\n// ── END GENERATED ──\n", crate::aperture::MIN_GZIP_BYTES, OOC_MIN_CHARS, SPEC_MARGIN_P)
}

fn hex_of(d: &[u8]) -> String { d.iter().map(|b| format!("{:02x}", b)).collect() }
/// sha256[:16] of a file's bytes (walk-door.mjs fileSha), None when it cannot be read
fn file_sha16(p: &str) -> Option<String> { if p.is_empty() { return None; } std::fs::read(p).ok().map(|b| hex_of(&Sha256::digest(&b))[..16].to_string()) }
/// JS String.prototype.trim: WhiteSpace + LineTerminator, and the BOM
fn js_trim(t: &str) -> &str { t.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}') }

// ── C1406 A STAMP IS VERIFIED AS THE CRATE'S, NEVER TRUSTED BY SHAPE ──────────────────────────────────────────────────────
// The C1394 skeptic hand-typed a stamp ({apertureVersion:'x', reef_sha:'x', axes_sha:'x', engine:'rust', sizes:{intent:{chars:5,
// gz_bytes:25}}}) and walkBoolean read it IN_LANE INSURABLE: a stamp checked by its shape is a stamp anyone can type, and node wrote
// stamp fields itself (triptych-build.mjs overwrote engine and added below_floor). Every stamp this door emits is SEALED here:
// `build_id` is sha256[:16] of the running executable's bytes, and `sig` is a sha256 over that build id and every other field in
// sorted-key canonical JSON. Each crate stage re-seals the stamp it is handed after checking the seal: the entry mints it, the sense
// adds `sense: "rust"`, the walks add `bound` (which bound stopped them). The verdict side asks `{"op":"verify"}`: the seal under THIS
// binary's build id, engine rust, every size at or over the floor, and both stages present — anything else is refused with the
// reason. A node line that writes a stamp field breaks the seal. It is an integrity seal, not a secret: it proves the stamp left this
// binary's code unaltered, not that nobody holding the binary could mint one.
// @guard tests/vna/c1406-a-stamp-is-verified-as-the.test.mjs
pub fn build_id() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| std::env::current_exe().ok().and_then(|p| std::fs::read(p).ok()).map(|b| hex_of(&Sha256::digest(&b))[..16].to_string()).unwrap_or_default())
}
// ── C1429 THE SEAL SURVIVES THE JSON ROUND TRIP ───────────────────────────────────────────────────────────────────────────────
// C1426 measured two wedge specs (spec-200b, spec-200c) whose sealed spec_margin carries whole-number floats (margin 0.0, gap_sigma
// 0.0, p_null 1.0). The canonical form signed serde_json's own number bytes, `0.0` and `1.0`; node's JSON.parse/JSON.stringify prints
// the same values as `0` and `1`, so the stamp that verified on the crate's raw bytes read "signature mismatch" after one round trip,
// the sense refused the entry's stamp, both stages fell back to node, and no admission was sealed on 2 of 12 specs. THE CHOICE: every
// number in the canonical form is printed the way ECMAScript Number::toString prints it (es_number: the shortest round-trip digits,
// no trailing `.0`, `-0` as `0`, the exponent form past 1e21 and under 1e-6), whatever serde_json variant (u64, i64, f64) holds it.
// WHY THIS ONE, and not the other two: it keeps the stamp's shape (spec_margin's numbers stay numbers, so no reader of margin, p_null
// or offPct changes), it fixes every number field present and future at once rather than one field at a time (holding signed fields
// to integers would have to re-type spec_margin and every float added later; fixed-decimal strings would change what every reader
// parses), and it is the one printing a node relay produces, so the crate's canonical bytes and the relay's bytes agree by
// construction. Its precondition, stated: the value must survive the parse on both sides. JSON.parse is correctly rounded; the
// stamp's floats are r6-rounded (spec_margin) or integers (sizes, verdict), so their significands are under 2^53 with a power of ten
// under 10^22, and serde_json's default parse of them is one correctly rounded division — exact. verify recomputes this same form.
// Sufficient for: a stamp verifying after any number of JSON round trips through node. Not for: whether the reading is right (Rice).
// @guard tests/vna/c1429-the-seal-survives-the-json-round.test.mjs
/// ECMAScript Number::toString(10) of an f64 — exactly what JSON.stringify prints for a number (NaN/±Infinity print null; a
/// serde_json Value never holds one)
pub fn es_number(x: f64) -> String {
    if x == 0.0 { return "0".into(); }
    if !x.is_finite() { return "null".into(); }
    let (digits, n) = es_digits(x.abs());   // x = 0.digits × 10^n
    let k = digits.len() as i32;
    let mut s = String::with_capacity(k as usize + 8);
    if x < 0.0 { s.push('-'); }
    if k <= n && n <= 21 { s.push_str(&digits); for _ in 0..(n - k) { s.push('0'); } }
    else if 0 < n && n <= 21 { s.push_str(&digits[..n as usize]); s.push('.'); s.push_str(&digits[n as usize..]); }
    else if -6 < n && n <= 0 { s.push_str("0."); for _ in 0..(-n) { s.push('0'); } s.push_str(&digits); }
    else {
        s.push_str(&digits[..1]);
        if k > 1 { s.push('.'); s.push_str(&digits[1..]); }
        s.push('e'); s.push(if n - 1 < 0 { '-' } else { '+' }); s.push_str(&(n - 1).abs().to_string());
    }
    s
}
/// the shortest round-trip digits of a > 0 and n with a = 0.digits × 10^n. Two shortest candidates at the same distance (a lies
/// exactly halfway between them) go to the EVEN one, as ECMAScript requires: Rust's shortest formatter rounds that tie up, V8 to
/// even (measured: 56 of 249,923 random doubles differed, every one such a tie, e.g. 1669760939663944.25 → V8 …44.2, Rust …44.3).
fn es_digits(a: f64) -> (String, i32) {
    let e = format!("{:e}", a);
    let (mant, exp) = e.split_once('e').unwrap_or((e.as_str(), "0"));
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let (k, n) = (digits.len(), exp.parse::<i32>().unwrap_or(0) + 1);
    // two k-digit candidates inside one rounding interval sit 10^scale ≤ ulp(a) ≤ 2^-52·a apart, so a tie needs k ≥ 16 digits —
    // except under f64::MIN_POSITIVE, where the ulp is fixed and a subnormal can tie at any length
    if k < 16 && a >= f64::MIN_POSITIVE { return (digits, n); }
    // the exact decimal expansion of a (every double is a finite decimal of at most 767 significant digits)
    let full = format!("{:.800e}", a);
    let (fm, fe) = full.split_once('e').unwrap_or((full.as_str(), "0"));
    let fd: String = fm.chars().filter(|c| *c != '.').collect();
    let fd = fd.trim_end_matches('0');
    if fd.len() == k + 1 && fd.ends_with('5') && k <= 18 {
        let lo: u64 = match fd[..k].parse() { Ok(v) => v, Err(_) => return (digits, n) };
        let scale = fe.parse::<i32>().unwrap_or(0) + 1 - k as i32;   // a = (lo + ½) × 10^scale
        let rt = |m: u64| format!("{}e{}", m, scale).parse::<f64>().map(|v| v == a).unwrap_or(false);
        let pick = match (rt(lo), rt(lo + 1)) { (true, true) => if lo % 2 == 0 { lo } else { lo + 1 }, (true, false) => lo, (false, true) => lo + 1, _ => return (digits, n) };
        let p = pick.to_string();
        let n2 = scale + p.len() as i32;
        return (p.trim_end_matches('0').to_string(), n2);
    }
    (digits, n)
}
fn canon(v: &Value, out: &mut String) {
    match v {
        Value::Object(m) => {
            let mut ks: Vec<&String> = m.keys().collect(); ks.sort();
            out.push('{');
            for (i, k) in ks.iter().enumerate() { if i > 0 { out.push(','); } out.push_str(&serde_json::to_string(k).unwrap_or_default()); out.push(':'); canon(&m[*k], out); }
            out.push('}');
        }
        Value::Array(a) => { out.push('['); for (i, x) in a.iter().enumerate() { if i > 0 { out.push(','); } canon(x, out); } out.push(']'); }
        Value::Number(n) => out.push_str(&es_number(n.as_f64().unwrap_or(f64::NAN))),   // C1429: ECMAScript's printing, never serde_json's
        _ => out.push_str(&serde_json::to_string(v).unwrap_or_default()),
    }
}
fn stamp_sig(stamp: &Value, bid: &str) -> String {
    let mut body = stamp.clone();
    if let Some(o) = body.as_object_mut() { o.remove("sig"); }
    let mut c = String::new(); canon(&body, &mut c);
    // v2 (C1429): the canonical form prints numbers as ECMAScript does; a v1 seal is never read as a v2 one
    let mut h = Sha256::new(); h.update(b"thetacog-walk-stamp-v2\0"); h.update(bid.as_bytes()); h.update(b"\0"); h.update(c.as_bytes());
    hex_of(&h.finalize())[..32].to_string()
}
/// seal a stamp: this binary's build id, then the sig over every other field
pub fn seal_stamp(mut stamp: Value) -> Value {
    let bid = build_id();
    if let Some(o) = stamp.as_object_mut() { o.remove("sig"); o.insert("build_id".into(), json!(bid)); }
    let sig = stamp_sig(&stamp, bid);
    if let Some(o) = stamp.as_object_mut() { o.insert("sig".into(), json!(sig)); }
    stamp
}
/// the seal alone: Some(reason) unless the stamp left this binary's code unaltered
pub fn seal_broken(stamp: &Value) -> Option<String> {
    let o = match stamp.as_object() { Some(o) => o, None => return Some("no stamp".into()) };
    let bid = build_id();
    if bid.is_empty() { return Some("this binary's build id could not be read, so no stamp can be verified".into()); }
    let sig = match o.get("sig").and_then(|v| v.as_str()) { Some(x) => x, None => return Some("unsigned stamp: not the crate's (a hand-typed or rebuilt stamp is never a reading)".into()) };
    match o.get("build_id").and_then(|v| v.as_str()) {
        Some(b) if b == bid => {}
        Some(b) => return Some(format!("signed by another build ({} is not this binary's {})", b, bid)),
        None => return Some("no build_id on the stamp".into()),
    }
    if stamp_sig(stamp, bid) != sig { return Some("signature mismatch: a field changed after the crate signed it".into()); }
    None
}
/// re-seal a stamp a stage was handed, with that stage's fields added — refuses a stamp whose seal is already broken
fn stage_seal(stamp: &Value, add: &[(&str, Value)]) -> Result<Value, String> {
    if let Some(r) = seal_broken(stamp) { return Err(format!("stamp refused: {}", r)); }
    let mut st = stamp.clone();
    if let Some(o) = st.as_object_mut() { for (k, v) in add { o.insert((*k).to_string(), v.clone()); } }
    Ok(seal_stamp(st))
}
/// why a stamp is no reading (None = it is one): the seal, the engine, the floor on every size, the sense and walk stages
pub fn verify_reason(stamp: &Value) -> Option<String> {
    if let Some(r) = seal_broken(stamp) { return Some(r); }
    if stamp.get("engine").and_then(|v| v.as_str()) != Some("rust") { return Some("engine is not rust".into()); }
    if let Some(b) = stamp.get("below_floor").and_then(|v| v.as_str()) { return Some(format!("below_floor: {}", b)); }
    let floor_gz = crate::aperture::MIN_GZIP_BYTES;
    match stamp.get("sizes").and_then(|v| v.as_object()) {
        Some(m) if !m.is_empty() => for (f, sz) in m {
            match (sz.get("chars").and_then(|v| v.as_u64()), sz.get("gz_bytes").and_then(|v| v.as_u64())) {
                (Some(c), Some(g)) if c as usize >= OOC_MIN_CHARS && g as usize >= floor_gz => {}
                (Some(c), Some(g)) => return Some(format!("below floor: {} {} chars / {} gz bytes < {} / {}", f, c, g, OOC_MIN_CHARS, floor_gz)),
                _ => return Some(format!("sizes.{} incomplete", f)),
            }
        },
        _ => return Some("no sizes on the stamp".into()),
    }
    if stamp.get("sense").and_then(|v| v.as_str()) != Some("rust") { return Some("the sense did not run in the crate (no sense stage on the stamp): a node sense is not a reading".into()); }
    match stamp.get("bound").and_then(|v| v.as_str()) {
        None => return Some("the walks did not run in the crate (no walk stage on the stamp): a node walk is not a reading".into()),
        // C1403: A TIME-BOUND STOP IS NOT A READING. The walk carries a wall-clock budget_ms; when that valve fires before the WORK bound
        // (the hop budget, the depth), the host's speed decided where the walk stopped, and a slower host stops elsewhere. The stamp names
        // the bound (the walks op seals it), and the verdict side reads TIME as UNMEASURED: never a verdict, never a tier.
        // @guard tests/vna/c1403-a-time-bound-stop-is-not.test.mjs
        Some("TIME") => return Some("TIME bound: the walk stopped on its wall-clock budget_ms before its WORK bound, so this host's speed decided where it stopped; a TIME-bound stop is not a reading".into()),
        Some(_) => {}
    }
    None
}
/// `{"op":"verify","stamp":{…}}` → { ok, reason, admitted, admission, build_id } — ok is the C1406 seal/floor/stage check; admitted is
/// C1411's: a verdict needs both (walkBoolean asks for both in this one call)
pub fn verify_op(req: &Value) -> Result<Value, String> {
    let stamp = req.get("stamp").cloned().unwrap_or(Value::Null);
    let reason = verify_reason(&stamp);
    let admission = admission_reason(&stamp);
    Ok(json!({ "ok": reason.is_none(), "reason": reason, "admitted": reason.is_none() && admission.is_none(), "admission": admission, "spec_missing": spec_missing(&stamp), "build_id": build_id() }))
}

// ── C1411 S3 SELF-SEPARATION: A SPEC IS ADMITTED TO A VERDICT ONLY IF IT SEPARATES ITS OWN POSITIVE FROM ITS OWN NEGATIVE ────────────
// A plumbing spec walked against surgical work read the faithful report and the sledgehammer report both IN_LANE (C1399), and the
// demo printed a verdict off it. Mass (S1) and margin (S2) cannot catch that: the question "did the work leave the lane" is only
// answerable on a spec whose own declared positive reads IN_LANE and whose own declared negative reads OFF_DOMAIN on the same walk.
// `{"op":"admit","stamp":<the reading's sealed stamp>,"positive":{"text","stamp"},"negative":{"text","stamp"}}`: each leg stamp must
// carry this binary's seal, its role (entry `leg`), the sha of the declared text it walked, the reading's spec sha, and pass the
// C1406 checks; its verdict is read off the verdict the walks op sealed into it (offPct · tooMany, C1409) — IN_LANE under the kill,
// OFF_DOMAIN over it, UNMEASURED otherwise. SEPARATED iff positive IN_LANE and negative OFF_DOMAIN; no declared negative is
// PLACEMENT_ONLY (placement, never a verdict); anything else is SPEC_INSUFFICIENT. The answer is sealed into the reading's stamp as
// spec_separation and verify's `admitted` reads it. Node only carries the texts and the stamps.
// @guard tests/vna/c1411-s3-self-separation-a-spec-is.test.mjs
fn leg_verdict(leg: &Value, role: &str, text: &str, spec_sha: &str) -> (String, Value, Option<String>) {
    let um = |why: String| ("UNMEASURED".to_string(), Value::Null, Some(why));
    let st = match leg.get("stamp") { Some(s) if s.is_object() => s, _ => return um(format!("no {} leg stamp", role)) };
    if st.get("leg").and_then(|v| v.as_str()) != Some(role) { return um(format!("the {} stamp is not a {} leg", role, role)); }
    let want = hex_of(&Sha256::digest(js_trim(text).as_bytes()))[..16].to_string();
    if st.get("leg_sha").and_then(|v| v.as_str()) != Some(want.as_str()) { return um(format!("the {} leg walked another text than the one declared", role)); }
    if st.get("spec_mass").and_then(|m| m.get("sha")).and_then(|v| v.as_str()) != Some(spec_sha) { return um(format!("the {} leg walked another spec", role)); }
    if let Some(r) = verify_reason(st) { return um(format!("{} leg: {}", role, r)); }
    let v = st.get("verdict").cloned().unwrap_or(Value::Null);
    let off = v.get("offPct").cloned().unwrap_or(Value::Null);
    match (off.as_f64(), v.get("tooMany").and_then(|x| x.as_bool())) {
        (Some(_), Some(true)) => ("OFF_DOMAIN".into(), off, None),
        (Some(_), Some(false)) => ("IN_LANE".into(), off, None),
        _ => um(format!("the {} leg carries no sealed off-lane count (the walks op ran without a kill, or the decode refused)", role)),
    }
}
pub fn admit_op(req: &Value) -> Result<Value, String> {
    let stamp = req.get("stamp").cloned().ok_or("admit: stamp required")?;
    if let Some(r) = seal_broken(&stamp) { return Err(format!("admit: stamp refused: {}", r)); }
    if stamp.get("leg").is_some() { return Err("admit: a separation leg is not a reading".into()); }
    let spec_sha = stamp.get("spec_mass").and_then(|m| m.get("sha")).and_then(|v| v.as_str()).ok_or("admit: the stamp carries no spec_mass (an entry older than C1410)")?.to_string();
    let decl = |k: &str| req.get(k).filter(|v| v.is_object()).and_then(|v| Some((v.get("text")?.as_str()?.to_string(), v.clone())));
    let (pos, neg) = (decl("positive"), decl("negative"));
    let (pv, poff, pwhy) = match &pos { Some((t, l)) => leg_verdict(l, "positive", t, &spec_sha), None => ("UNDECLARED".into(), Value::Null, Some("no declared positive".into())) };
    let (nv, noff, nwhy) = match &neg { Some((t, l)) => leg_verdict(l, "negative", t, &spec_sha), None => ("UNDECLARED".into(), Value::Null, Some("no declared negative".into())) };
    // C1428 S3b: the stranger leg, sealed into the reading's stamp by the walks op; a member that is the spec's own text or one of its
    // declared legs is left out of the count (a spec is never its own stranger)
    let leg_shas: Vec<String> = [&pos, &neg].iter().filter_map(|d| d.as_ref().map(|(t, _)| hex_of(&Sha256::digest(js_trim(t).as_bytes()))[..16].to_string())).collect();
    let (sv, strangers, swhy) = stranger_leg(stamp.get("spec_strangers"), &spec_sha, &leg_shas);
    let state = if neg.is_none() { "PLACEMENT_ONLY" } else if pv == "IN_LANE" && nv == "OFF_DOMAIN" && sv == "OFF_DOMAIN" { "SEPARATED" } else { "SPEC_INSUFFICIENT" };
    let line = match state {
        "PLACEMENT_ONLY" => format!("PLACEMENT_ONLY · positive {} · negative UNDECLARED — a spec with no declared negative is admitted for placement only, never a verdict", pv),
        _ => format!("{} · positive {} · negative {} · {}", state, pv, nv, stranger_clause(&strangers)),
    };
    let why: Vec<String> = [pwhy, nwhy, swhy].into_iter().flatten().collect();
    let sep = json!({ "state": state, "positive": pv, "negative": nv, "positive_off": poff, "negative_off": noff, "strangers": strangers, "why": why, "line": line });
    Ok(json!({ "spec_separation": sep.clone(), "stamp": stage_seal(&stamp, &[("spec_separation", sep)])? }))
}

// ── C1428 S3b SPECIFICITY: THE ADMISSION WALKS A STRANGER PANEL ──────────────────────────────────────────────────────────────────
// Operator, 2026-10-29, verbatim: "if you have the right specification, we can tell if you are going to take out the wall or not."
// C1427 measured the shipped surgical spec, admitted under S3, reading 3 of 5 unrelated texts IN_LANE (plumbing 18 %, a sonnet
// request 20 %, a poem 23 %, under the faithful report's own 24 %). Self-separation measures whether a spec tells its own positive
// from its own negative; it does not measure whether the lane is specific to its kind of work. S3b adds that leg here. The crate
// ships a FIXED stranger panel (stranger_panel.json beside this file, embedded at build, its sha256[:16] pinned as
// STRANGER_PANEL_SHA, every member's sha checked against its text and every member at the entry's floor; the first five members are
// C1427's unrelated texts, verbatim). The walks op of every reading (a sealed stamp, not a leg, with a kill) walks each member
// against the spec with the reading's OWN walk: the spec's intent walk it just ran, the same seeds, knobs, library and kill; the
// member's grid is the claim sense node runs for a reality (door_panel.rs claims_op's chain, scored on the library's own pair
// signatures at the sense's target and floor), and its verdict is decode_edges at the kill — the one the walks op seals for a
// reading. The members' verdicts are sealed as spec_strangers; admit_op admits a verdict only if every counted member reads
// OFF_DOMAIN, else SPEC_INSUFFICIENT with "stranger <k> of <n> IN_LANE" beside the S3 legs. No kill, floor or margin moves.
// Sufficient for: whether a spec's lane is narrower than texts of other kinds, on this panel. Not for: every possible stranger (the
// panel is finite, and a spec that rejects these five can still admit a sixth), or whether the spec is the right one (the author's).
// @guard tests/vna/c1428-s3b-specificity-the-admission-walks.test.mjs
/// the pinned sha256[:16] of stranger_panel.json — the panel the walk reads is these bytes or none
pub const STRANGER_PANEL_SHA: &str = "3cf78dbe44ace380";
const STRANGER_PANEL_JSON: &str = include_str!("stranger_panel.json");
/// the claim sense's target and floor (node hands the sense op 900 / 0.56 for every reading; door_panel.rs's panel op senses at the same)
const SENSE_TARGET: usize = 900;
const SENSE_FLOOR: f64 = 0.56;
pub struct Stranger { pub key: String, pub sha16: String, pub text: String }
/// the frozen panel, checked once per process: the file's sha against the pin, each member's sha against its text, each at mass
pub fn stranger_panel() -> Result<&'static Vec<Stranger>, String> {
    static P: std::sync::OnceLock<Result<Vec<Stranger>, String>> = std::sync::OnceLock::new();
    P.get_or_init(|| {
        let got = hex_of(&Sha256::digest(STRANGER_PANEL_JSON.as_bytes()))[..16].to_string();
        if got != STRANGER_PANEL_SHA { return Err(format!("the stranger panel's bytes are {} , not the pinned {}", got, STRANGER_PANEL_SHA)); }
        let v: Value = serde_json::from_str(STRANGER_PANEL_JSON).map_err(|e| format!("the stranger panel does not parse: {}", e))?;
        let mut out = Vec::new();
        for m in v.get("members").and_then(|x| x.as_array()).ok_or("the stranger panel has no members")? {
            let (key, sha, text) = match (m.get("key").and_then(|x| x.as_str()), m.get("sha256").and_then(|x| x.as_str()), m.get("text").and_then(|x| x.as_str())) { (Some(k), Some(h), Some(t)) => (k, h, t), _ => return Err("a stranger panel member lacks key, sha256 or text".into()) };
            if hex_of(&Sha256::digest(text.as_bytes())) != sha { return Err(format!("stranger {}: its text is not the one its sha256 names", key)); }
            let t = js_trim(text); let (chars, gz) = (t.encode_utf16().count(), gzip_len_level(t.as_bytes(), -1));
            if chars < OOC_MIN_CHARS || gz < crate::aperture::MIN_GZIP_BYTES { return Err(format!("stranger {} is under the floor ({} chars / {} gz bytes)", key, chars, gz)); }
            out.push(Stranger { key: key.to_string(), sha16: hex_of(&Sha256::digest(t.as_bytes()))[..16].to_string(), text: text.to_string() });
        }
        if out.is_empty() { return Err("the stranger panel has no members".into()); }
        Ok(out)
    }).as_ref().map_err(|e| e.clone())
}
/// the stranger leg of the admission: OFF_DOMAIN only when every counted member was walked and read OFF_DOMAIN; the summary carries
/// n, k (IN_LANE), the unmeasured count and each member, the members that are the spec's own text or a declared leg left out
fn stranger_leg(walked: Option<&Value>, spec_sha: &str, leg_shas: &[String]) -> (String, Value, Option<String>) {
    let um = |why: String| ("UNMEASURED".to_string(), json!({ "state": "UNMEASURED", "reason": why.clone() }), Some(why));
    let w = match walked { Some(w) if w.is_object() => w, _ => return um("the stranger panel was not walked for this reading (no spec_strangers on the stamp: a walks op without a kill, or a binary older than C1428)".into()) };
    if w.get("state").and_then(|x| x.as_str()) == Some("UNMEASURED") { return um(format!("the stranger panel: {}", w.get("reason").and_then(|x| x.as_str()).unwrap_or("UNMEASURED"))); }
    let members: Vec<Value> = w.get("members").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let own = |m: &Value| { let sh = m.get("sha").and_then(|x| x.as_str()).unwrap_or(""); sh == spec_sha || leg_shas.iter().any(|l| l == sh) };
    let counted: Vec<&Value> = members.iter().filter(|m| !own(m)).collect();
    let verdict = |m: &Value| m.get("verdict").and_then(|x| x.as_str()).unwrap_or("UNMEASURED").to_string();
    let (n, k) = (counted.len(), counted.iter().filter(|m| verdict(m) == "IN_LANE").count());
    let u = counted.iter().filter(|m| verdict(m) != "IN_LANE" && verdict(m) != "OFF_DOMAIN").count();
    let excluded: Vec<Value> = members.iter().filter(|m| own(m)).filter_map(|m| m.get("key").cloned()).collect();
    let state = if n == 0 { "UNMEASURED" } else if k == 0 && u == 0 { "OFF_DOMAIN" } else if k > 0 { "IN_LANE" } else { "UNMEASURED" };
    let summary = json!({ "state": state, "n": n, "in_lane": k, "off_domain": n - k - u, "unmeasured": u, "panel_sha": w.get("panel_sha"), "kill": w.get("kill"),
        "members": counted, "excluded": excluded });
    let why = match state { "OFF_DOMAIN" => None, "UNMEASURED" if n == 0 => Some("every stranger panel member is the spec's own text or a declared leg".to_string()),
        _ => Some(format!("stranger {} of {} IN_LANE{}: {}", k, n, if u > 0 { format!(" ({} UNMEASURED)", u) } else { String::new() },
            if k > 0 { "the lane admits texts of other kinds" } else { "a stranger the walk did not read is never an admission" })) };
    (state.to_string(), summary, why)
}
/// "stranger <k> of <n> IN_LANE", or the reason the panel was not read
fn stranger_clause(s: &Value) -> String {
    match (s.get("n").and_then(|x| x.as_u64()), s.get("in_lane").and_then(|x| x.as_u64())) {
        (Some(n), Some(k)) if n > 0 => { let u = s.get("unmeasured").and_then(|x| x.as_u64()).unwrap_or(0); format!("stranger {} of {} IN_LANE{}", k, n, if u > 0 { format!(" ({} UNMEASURED)", u) } else { String::new() }) }
        _ => "stranger UNMEASURED".into(),
    }
}
// ── C1412 S4 THE STAMP CARRIES THE SPEC'S QUALITY ──────────────────────────────────────────────────────────────────────────────
// Every reading's stamp carries spec_mass (S1, C1410), spec_margin (S2, C1410) and spec_separation (S3, C1411), each written here and
// sealed with the rest. A stamp missing any of them cannot say whether the spec under it was measured, so it is never a verdict —
// checked on the fields themselves, before and beside the seal, so the reason names the field even when a node line deleted it (the
// seal then fails too). verify answers spec_missing; walkBoolean relays it. No node line writes these fields.
// @guard tests/vna/c1412-s4-the-stamp-carries-the-spec.test.mjs
pub const SPEC_QUALITY_FIELDS: [&str; 3] = ["spec_mass", "spec_margin", "spec_separation"];
pub fn spec_missing(stamp: &Value) -> Vec<String> {
    SPEC_QUALITY_FIELDS.iter().filter(|k| !stamp.get(**k).map(|v| v.is_object()).unwrap_or(false)).map(|k| k.to_string()).collect()
}
/// why a sealed reading is not admitted to a verdict (None = admitted): the S4 fields present; a leg is never one; the spec must have
/// separated (S3)
pub fn admission_reason(stamp: &Value) -> Option<String> {
    if stamp.get("leg").is_some() { return Some("a separation leg (the spec walked against its own declared positive or negative) is not a reading".into()); }
    let miss = spec_missing(stamp);
    if !miss.is_empty() { return Some(format!("S4: the stamp lacks {} — the crate writes spec_mass, spec_margin and spec_separation on every reading it admits; a reading without them is never a verdict", miss.join(", "))); }
    match stamp.get("spec_separation") {
        Some(s) if s.get("state").and_then(|v| v.as_str()) == Some("SEPARATED") => None,
        Some(s) => Some(s.get("line").and_then(|v| v.as_str()).unwrap_or("SPEC_INSUFFICIENT").to_string()),
        None => Some("no spec_separation on the stamp: the crate did not admit this spec (S3 — its own positive IN_LANE, its own negative OFF_DOMAIN); never a verdict".into()),
    }
}

/// `{"op":"entry"}` — the floor and the health stamp, before any sense or walk
pub fn entry_op(req: &Value) -> Result<Value, String> {
    let floor_gz = crate::aperture::MIN_GZIP_BYTES;
    let texts: Vec<(String, String)> = req.get("texts").and_then(|v| v.as_array()).ok_or("entry: texts required")?.iter()
        .filter_map(|x| Some((x.get("field")?.as_str()?.to_string(), x.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string()))).collect();
    if texts.is_empty() { return Err("entry: texts required".into()); }
    let mut sizes = serde_json::Map::new();
    let mut bad: Vec<(String, usize, usize)> = Vec::new();
    for (field, text) in &texts {
        let t = js_trim(text);
        let chars = t.encode_utf16().count();
        let gz = if t.is_empty() { 0 } else { gzip_len_level(t.as_bytes(), -1) };
        sizes.insert(field.clone(), json!({ "chars": chars, "gz_bytes": gz }));
        if chars < OOC_MIN_CHARS || gz < floor_gz { bad.push((field.clone(), chars, gz)); }
    }
    let s = |k: &str| req.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    // apertureVersion — prompt-lens.mjs apertureVersion(): sha256 over each file's bytes ('missing:<rel>' when absent), then the
    // lens constants as node serialises them, hex[:12]. Node points at the files and hands the constants string; the hash is here.
    let ap = req.get("aperture").cloned().unwrap_or(Value::Null);
    let ap_files: Vec<String> = ap.get("files").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let ap_rels: Vec<String> = ap.get("rels").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let aperture_version = match ap.get("constants").and_then(|v| v.as_str()) {
        Some(c) if !ap_files.is_empty() => {
            let mut h = Sha256::new();
            for (i, f) in ap_files.iter().enumerate() {
                match std::fs::read(f) { Ok(b) => h.update(&b), Err(_) => h.update(format!("missing:{}", ap_rels.get(i).cloned().unwrap_or_else(|| f.clone())).as_bytes()) }
            }
            h.update(c.as_bytes());
            Some(hex_of(&h.finalize())[..12].to_string())
        }
        _ => None,
    };
    // C1407: no reef_sha — no stage of the walk reads lens-reef.json, and a stamped sha names only bytes the walk read. axes_sha is the
    // library at the one path node hands both the sense and the walks (the walks op refuses a library whose bytes differ from it).
    // C1410 S2 + C1412 S4: the spec is the FIRST text (buildTriptychInputs puts the intent first). Its mass and its margin on the library
    // the walk reads are taken here and ride in the sealed stamp; a spec under the floor gets no margin (UNMEASURED, the floor named).
    let (spec_field, spec_text) = texts[0].clone();
    let spec_t = js_trim(&spec_text);
    let spec_sz = sizes.get(&spec_field).cloned().unwrap_or(Value::Null);
    let spec_at_mass = !bad.iter().any(|(f, _, _)| f == &spec_field);
    let spec_mass = json!({ "field": spec_field, "chars": spec_sz.get("chars"), "gz_bytes": spec_sz.get("gz_bytes"), "sha": hex_of(&Sha256::digest(spec_t.as_bytes()))[..16].to_string(),
        "state": if spec_at_mass { "AT_MASS" } else { "BELOW_FLOOR" } });
    let spec_margin_v = if spec_at_mass { spec_margin(spec_t, &s("axes")) } else { json!({ "state": "UNMEASURED", "reason": format!("the spec is under the floor ({} / {})", OOC_MIN_CHARS, floor_gz), "p_floor": SPEC_MARGIN_P }) };
    let stamp = json!({ "apertureVersion": aperture_version, "axes_sha": file_sha16(&s("axes")), "engine": "rust", "sizes": Value::Object(sizes),
        "spec_mass": spec_mass, "spec_margin": spec_margin_v });
    // C1411 S3: a separation leg (the spec walked against its own declared positive or negative) is stamped as one, with the sha of the
    // text it walks, so the admit op can bind each leg to the spec and to the declared text — and verify never reads a leg as a reading
    let stamp = match req.get("leg").and_then(|v| v.as_str()) {
        Some(role) if role == "positive" || role == "negative" => {
            let mut st = stamp;
            let leg_text = texts.get(1).map(|(_, t)| js_trim(t).to_string()).unwrap_or_default();
            if let Some(o) = st.as_object_mut() { o.insert("leg".into(), json!(role)); o.insert("leg_sha".into(), json!(hex_of(&Sha256::digest(leg_text.as_bytes()))[..16].to_string())); }
            st
        }
        Some(other) => return Err(format!("entry: leg must be positive or negative, not {}", other)),
        None => stamp,
    };
    let floor = json!({ "chars": OOC_MIN_CHARS, "gz_bytes": floor_gz });
    // C1406: the commit panel's named opt-in (draw_below_floor) is decided HERE, not in node: the texts are admitted to be DRAWN, and
    // the sealed stamp carries below_floor, which verify refuses — a picture, never a verdict.
    let draw_below = req.get("draw_below_floor").and_then(|v| v.as_bool()).unwrap_or(false);
    // the refusal names the FIRST field under the floor (field / chars / gz_bytes) and its reason lists every one that is
    Ok(match bad.first() {
        Some((field, chars, gz)) => {
            let each: Vec<String> = bad.iter().map(|(f, c, g)| format!("{} {} chars / {} gz bytes", f, c, g)).collect();
            let reason = format!("below floor: {} < {} / {}", each.join(", "), OOC_MIN_CHARS, floor_gz);
            if draw_below {
                let mut st = stamp; if let Some(o) = st.as_object_mut() { o.insert("below_floor".into(), json!(reason)); }
                return Ok(json!({ "state": "BELOW_FLOOR", "refused": false, "field": field, "chars": chars, "gz_bytes": gz, "floor": floor, "stamp": seal_stamp(st), "reason": reason }));
            }
            json!({ "state": "UNMEASURED", "refused": true, "field": field, "chars": chars, "gz_bytes": gz, "fields": bad.iter().map(|(f, _, _)| f.clone()).collect::<Vec<_>>(),
                "floor": floor, "stamp": seal_stamp(stamp), "reason": reason })
        }
        None => json!({ "state": "ADMITTED", "refused": false, "floor": floor, "stamp": seal_stamp(stamp) }),
    })
}

// ── C1409 THE FLOOR FOR A TEXT WITH NO WALK IS DECIDED HERE TOO (operator, 2026-10-29: "rust only") ─────────────────────────────
// The C1394 skeptic and the C1409 guard found eight node lines comparing a size against MIN_GZIP_BYTES / OOC_MIN_CHARS themselves: the
// aperture's admissible (scripts/vna/aperture.mjs), the tape's phantom-mass gate on the combined triangulation (tape-walk-worker.mjs),
// the free-form spec's abstain (attest-demo-freeform.mjs) and three benches' under-floor counts (ask-corpus, ask-time-fence,
// geo-ratchet). None of those texts goes through the entry, because none of them is walked as a reading; the floor is still a
// decision, so it is taken HERE, on the same constants the entry reads, and node relays at_mass and the reason. Two rules, named by
// the caller and never chosen in node by comparing: floor "entry" (the default) is the entry's own — under OOC_MIN_CHARS characters
// (UTF-16 units, JS String.length) OR under aperture.rs MIN_GZIP_BYTES of gzip mass; floor "gz" is the gzip half alone, the
// phantom-mass floor the aperture and the tape have always applied. trim (default true) measures the text as the entry does
// (js_trim); trim false measures the bytes exactly as handed in, so a caller whose sizes are compared to a chip twin (--aperture)
// keeps them. The reason has the entry's form: "below floor: <field> <sizes>, … < <floor>".
// Sufficient for: whether a text carries the mass the walk reads at. Not for: what the text says, or whether a walk of it is right.
// @guard tests/pmu/the-floor-for-a-text-with-no-walk.test.mjs
/// `{"op":"mass"}` — sizes and the at-mass decision per text, the count under, and the entry-form reason
pub fn mass_op(req: &Value) -> Result<Value, String> {
    let floor_gz = crate::aperture::MIN_GZIP_BYTES;
    let arr = req.get("texts").and_then(|v| v.as_array()).ok_or("mass: texts required")?;
    let applies = match req.get("floor").and_then(|v| v.as_str()).unwrap_or("entry") {
        "entry" => "entry", "gz" => "gz",
        other => return Err(format!("mass: floor must be entry or gz, not {}", other)),
    };
    let trim = req.get("trim").and_then(|v| v.as_bool()).unwrap_or(true);
    let rows: Vec<(String, usize, usize, bool)> = arr.par_iter().enumerate().map(|(i, x)| {
        let field = x.get("field").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| i.to_string());
        let raw = x.get("text").and_then(|t| t.as_str()).unwrap_or("");
        let t = if trim { js_trim(raw) } else { raw };
        let chars = t.encode_utf16().count();
        let gz = if t.is_empty() { 0 } else { gzip_len_level(t.as_bytes(), -1) };
        let at_mass = gz >= floor_gz && (applies == "gz" || chars >= OOC_MIN_CHARS);
        (field, chars, gz, at_mass)
    }).collect();
    let bad: Vec<String> = rows.iter().filter(|r| !r.3).map(|(f, c, g, _)| if applies == "gz" { format!("{} {} gz bytes", f, g) } else { format!("{} {} chars / {} gz bytes", f, c, g) }).collect();
    let reason = if bad.is_empty() { Value::Null }
        else if applies == "gz" { json!(format!("below floor: {} < {} gz bytes", bad.join(", "), floor_gz)) }
        else { json!(format!("below floor: {} < {} / {}", bad.join(", "), OOC_MIN_CHARS, floor_gz)) };
    let sizes: Vec<Value> = rows.iter().map(|(f, c, g, a)| json!({ "field": f, "chars": c, "gz_bytes": g, "at_mass": a })).collect();
    Ok(json!({ "floor": { "chars": OOC_MIN_CHARS, "gz_bytes": floor_gz, "applies": applies }, "sizes": sizes, "under": bad.len(), "refused": !bad.is_empty(), "reason": reason }))
}

// ── sense ───────────────────────────────────────────────────────────────────────────────────
/// max over claims of (1 − hamming/64) per cell, as f32 — the JS compares the double v against the f32 cell and stores fround(v).
pub fn sense_scores(claims: &[u64], pairs: &[u64]) -> Vec<f32> {
    let mut score = vec![0f32; pairs.len()];
    for &cs in claims {
        for (k, &p) in pairs.iter().enumerate() {
            let v = 1.0 - ((cs ^ p).count_ones() as f64) / 64.0;
            if v > score[k] as f64 { score[k] = v as f32; }
        }
    }
    score
}
/// θ = max(floor, the (target+1)-th largest score); grid = score ≥ θ ∧ score > 0.
pub fn sense_grid(score: &[f32], target: usize, floor: f64) -> (f64, Vec<u8>, usize) {
    let mut sorted: Vec<f32> = score.to_vec();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap());
    let at = sorted.get(target.min(sorted.len().saturating_sub(1))).copied().unwrap_or(0.0) as f64;
    let theta = if at == 0.0 { floor } else { floor.max(at) };
    let mut g = vec![0u8; score.len()]; let mut lit = 0;
    for (k, &s) in score.iter().enumerate() { if (s as f64) >= theta && s > 0.0 { g[k] = 1; lit += 1; } }
    (theta, g, lit)
}
fn pack_bits(g: &[u8]) -> String { let mut b = vec![0u8; (g.len() + 7) / 8]; for (i, &x) in g.iter().enumerate() { if x != 0 { b[i >> 3] |= 1 << (7 - (i & 7)); } } B64.encode(b) }
fn unpack_grid(b64: &str) -> Option<Box<[u8; CELLS]>> {
    let bytes = B64.decode(b64).ok()?; let mut g = Box::new([0u8; CELLS]);
    for i in 0..CELLS { if bytes.get(i >> 3).map(|b| b & (1 << (7 - (i & 7))) != 0).unwrap_or(false) { g[i] = 1; } }
    Some(g)
}

// ── slot ────────────────────────────────────────────────────────────────────────────────────
#[inline] fn is_word_byte(c: u8) -> bool { c.is_ascii_alphanumeric() || c == b'_' }
fn find_all(hay: &[u8], nd: &[u8]) -> Vec<usize> {
    let mut out = Vec::new(); if nd.is_empty() || nd.len() > hay.len() { return out; }
    let first = nd[0]; let last = hay.len() - nd.len(); let mut i = 0;
    while i <= last { match hay[i..=last].iter().position(|&c| c == first) { Some(p) => { let j = i + p; if &hay[j..j + nd.len()] == nd { out.push(j); } i = j + 1; } None => break } }
    out
}
/// one file, many needles → per needle the 1-based line numbers (consecutive duplicates collapsed), code-slot.mjs hitsMany's rule
pub fn file_hits(hay: &[u8], needles: &[Vec<u8>], word: bool) -> Vec<Vec<u32>> {
    let mut starts: Option<Vec<usize>> = None;
    needles.iter().map(|nd| {
        let mut lines: Vec<u32> = Vec::new();
        for i in find_all(hay, nd) {
            if word && ((i > 0 && is_word_byte(hay[i - 1])) || (i + nd.len() < hay.len() && is_word_byte(hay[i + nd.len()]))) { continue; }
            let st = starts.get_or_insert_with(|| { let mut s = vec![0usize]; for (j, &c) in hay.iter().enumerate() { if c == b'\n' { s.push(j + 1); } } s });
            let n = (st.partition_point(|&s| s <= i)) as u32;   // 1-based line
            if lines.last() != Some(&n) { lines.push(n); }
        }
        lines
    }).collect()
}
fn fold(b: &[u8]) -> Vec<u8> { b.iter().map(|c| c.to_ascii_lowercase()).collect() }
/// C612b2 — the code files the slot reads, held across notes and re-read only when (len, mtime) moves
pub type FileCache = HashMap<PathBuf, (u64, std::time::SystemTime, Arc<Vec<u8>>)>;
fn read_cached(cache: &std::sync::Mutex<FileCache>, p: &Path) -> Option<Arc<Vec<u8>>> {
    let md = std::fs::metadata(p).ok()?; let (len, mt) = (md.len(), md.modified().ok()?);
    if let Some((l, m, b)) = cache.lock().ok()?.get(p) { if *l == len && *m == mt { return Some(b.clone()); } }
    let b = Arc::new(std::fs::read(p).ok()?);
    if let Ok(mut c) = cache.lock() { c.insert(p.to_path_buf(), (len, mt, b.clone())); }
    Some(b)
}
fn slot(repo: &Path, files: &[String], sym: &[String], word: &[String], cache: &std::sync::Mutex<FileCache>) -> Value {
    let sn: Vec<Vec<u8>> = sym.iter().map(|t| t.as_bytes().to_vec()).collect();
    let wn: Vec<Vec<u8>> = word.iter().map(|t| fold(t.as_bytes())).collect();
    let per: Vec<Option<(Vec<Vec<u32>>, Vec<Vec<u32>>)>> = files.par_iter().map(|f| {
        let buf = read_cached(cache, &repo.join(f))?;
        if buf[..buf.len().min(8000)].contains(&0) { return None; }
        let s = if sn.is_empty() { vec![] } else { file_hits(&buf, &sn, false) };
        let w = if wn.is_empty() { vec![] } else { file_hits(&fold(&buf), &wn, true) };
        Some((s, w))
    }).collect();
    let collect = |n: usize, pick: &dyn Fn(&(Vec<Vec<u32>>, Vec<Vec<u32>>)) -> &Vec<Vec<u32>>| -> Vec<Value> {
        (0..n).map(|k| Value::Array(files.iter().zip(per.iter()).filter_map(|(f, p)| p.as_ref().and_then(|p| { let l = &pick(p)[k]; if l.is_empty() { None } else { Some(json!([f, l])) } })).collect())).collect()
    };
    json!({ "sym": collect(sn.len(), &|p| &p.0), "word": collect(wn.len(), &|p| &p.1), "files_read": per.iter().filter(|p| p.is_some()).count() })
}

// ── anchors: the compressed length of every static anchor, once per HEAD ───────────────────────
struct Anchor { text: Arc<String>, clen: usize }
fn sha8(t: &str) -> [u8; 8] { let d = Sha256::digest(t.as_bytes()); let mut o = [0u8; 8]; o.copy_from_slice(&d[..8]); o }
fn read_bin(p: &Path) -> HashMap<String, ([u8; 8], i32, usize)> {
    let mut m = HashMap::new(); let Ok(b) = std::fs::read(p) else { return m };
    if b.len() < 8 || &b[..4] != b"ACL1" { return m; }
    let n = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize; let mut i = 8;
    for _ in 0..n {
        if i + 2 > b.len() { break; } let l = u16::from_le_bytes([b[i], b[i + 1]]) as usize; i += 2;
        if i + l + 16 > b.len() { break; }
        let id = String::from_utf8_lossy(&b[i..i + l]).to_string(); i += l;
        let mut s = [0u8; 8]; s.copy_from_slice(&b[i..i + 8]); i += 8;
        let lv = i32::from_le_bytes(b[i..i + 4].try_into().unwrap()); i += 4;
        let c = u32::from_le_bytes(b[i..i + 4].try_into().unwrap()) as usize; i += 4;
        m.insert(id, (s, lv, c));
    }
    m
}
fn write_bin(p: &Path, rows: &[(String, [u8; 8], i32, usize)]) -> io::Result<()> {
    let mut b = Vec::with_capacity(rows.len() * 40); b.extend_from_slice(b"ACL1"); b.extend_from_slice(&(rows.len() as u32).to_le_bytes());
    for (id, s, lv, c) in rows { b.extend_from_slice(&(id.len() as u16).to_le_bytes()); b.extend_from_slice(id.as_bytes()); b.extend_from_slice(s); b.extend_from_slice(&lv.to_le_bytes()); b.extend_from_slice(&(*c as u32).to_le_bytes()); }
    if let Some(d) = p.parent() { std::fs::create_dir_all(d)?; }
    let tmp = p.with_extension(format!("bin.tmp{}", std::process::id()));
    std::fs::write(&tmp, &b)?; std::fs::rename(&tmp, p)
}

// ── C612b2: placePixel (src/lib/pmu/compress.mjs) — gzip-NCD over the 144 pair cells, σ-margin of the top ──────────────
fn place_pixel(doc: &str, cells: &[(String, String)], snip_z: &[usize]) -> Value {
    if cells.is_empty() { return json!({ "pixel": null, "sigma": 0 }); }
    let doc_z = gzip_len_level(doc.as_bytes(), -1);
    let mut gz: Vec<(usize, f64)> = cells.iter().enumerate().map(|(i, (_, snip))| {
        let mut j = String::with_capacity(doc.len() + 1 + snip.len()); j.push_str(doc); j.push('\n'); j.push_str(snip);
        let join_z = gzip_len_level(j.as_bytes(), -1) as f64;
        let (dz, sz) = (doc_z as f64, snip_z[i] as f64);
        let numer = join_z - dz.min(sz); let denom = dz.max(sz);
        (i, if denom == 0.0 { 0.0 } else { f64::max(0.0, 1.0 - numer / denom) })
    }).collect();
    gz.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));   // stable, as Array.prototype.sort
    let sigma = if gz.len() < 2 { 0.0 } else {
        let top = gz[0].1; let rest: Vec<f64> = gz[1..].iter().map(|x| x.1).collect();
        let mean = rest.iter().fold(0.0, |a, b| a + b) / rest.len() as f64;
        let var = rest.iter().fold(0.0, |a, b| a + (b - mean).powi(2)) / rest.len() as f64;
        let std = var.sqrt(); if std > 0.0 { (top - mean) / std } else { 0.0 }
    };
    json!({ "pixel": cells[gz[0].0].0, "sigma": sigma })
}

// ── C612b2: the tree's rows (retro-snowball.mjs rowsOf), parsed with only the fields rowsOf reads, in file order ─────────────
pub struct TreeHeld { root: String, rows: Arc<Value> }
fn tree_root(p: &Path) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(p).ok()?; let mut b = vec![0u8; 65536]; let n = f.read(&mut b).ok()?; let s = String::from_utf8_lossy(&b[..n]);
    let i = s.find("\"root\"")?; let rest = &s[i + 6..]; let q = rest.find('"')?; let rest = &rest[q + 1..]; let e = rest.find('"')?;
    Some(rest[..e].to_string())
}
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct WalkLite { cells: Value }
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct ContentLite { text: Value }
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct NodeLite { #[serde(rename = "type")] ty: Value, retracted: Value, pixel: Value, cue: Value, id: Value, walk: Option<WalkLite>, content: Option<ContentLite> }
struct OrderedNodes(Vec<NodeLite>);
impl<'de> serde::Deserialize<'de> for OrderedNodes {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = OrderedNodes;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("the tree's nodes object") }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<OrderedNodes, A::Error> {
                let mut v = Vec::new(); while let Some((_k, n)) = m.next_entry::<serde::de::IgnoredAny, NodeLite>()? { v.push(n); } Ok(OrderedNodes(v))
            }
        }
        d.deserialize_map(V)
    }
}
#[derive(serde::Deserialize)]
struct TreeLite { nodes: Option<OrderedNodes> }
/** JS truthiness of a JSON value */
fn truthy(v: &Value) -> bool { match v { Value::Null => false, Value::Bool(b) => *b, Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(true), Value::String(s) => !s.is_empty(), _ => true } }
fn parse_rows(p: &Path) -> Result<Value, String> {
    let f = std::fs::File::open(p).map_err(|e| format!("rows: {}", e))?;
    let t: TreeLite = serde_json::from_reader(io::BufReader::with_capacity(1 << 20, f)).map_err(|e| format!("rows: parse {}: {}", p.display(), e))?;
    let mut out = Vec::new();
    for n in t.nodes.map(|o| o.0).unwrap_or_default() {
        if n.ty.as_str() != Some("contract") || truthy(&n.retracted) || !truthy(&n.pixel) || !truthy(&n.cue) { continue; }
        let Some(w) = n.walk else { continue }; if !w.cells.is_array() { continue; }
        let text = n.content.map(|c| c.text).filter(truthy).map(|t| match t { Value::String(s) => s, other => other.to_string() }).unwrap_or_default();
        let mut m = serde_json::Map::new();
        m.insert("id".into(), n.cue); if !n.id.is_null() { m.insert("node".into(), n.id); }
        m.insert("pixel".into(), n.pixel); m.insert("cells".into(), w.cells); m.insert("text".into(), Value::String(text));
        out.push(Value::Object(m));
    }
    Ok(Value::Array(out))
}

/// C612j: how many bound guards one write is read against
pub const REFLEX_TOP: usize = 10;

/// C612j — THE REFLEX: one write's changed hunk against the top REFLEX_TOP bound guards. The guards' texts and compressed lengths are
/// held in RAM per (head, level) — read ONCE from the immutable commit (one `git cat-file --batch` for every guard a write meets
/// first), never again for that head; a write sends only its hunk, and the door compresses C(hunk) and C(hunk\nguard) per guard.
/// ncd is spec-tree.mjs's: (C(a\nb) − min(Ca, Cb)) / max(Ca, Cb), the vendored Node zlib at the request's level (default 9).
/// Its own state and its own lock in the socket server, so a write never waits behind a tree parse or a slot read.
#[derive(Default)]
pub struct Reflex { held: HashMap<(String, i32), HashMap<String, Anchor>>, pub disk_reads: usize, pre: Arc<std::sync::Mutex<HashMap<String, Arc<HashMap<String, String>>>>>, started: std::collections::HashSet<String> }
/// C612j — every file under tests/ at <head>, read in ONE `git ls-tree` + `git cat-file --batch` (≈ 20 MB, a few seconds, in the
/// background) the first time the reflex meets a head; a write then finds its guards in RAM. At most two heads are kept.
fn prefetch_tests(repo: &Path, head: &str) -> HashMap<String, String> {
    let Ok(o) = std::process::Command::new("git").args(["ls-tree", "-r", "--name-only", head, "tests/"]).current_dir(repo).stderr(std::process::Stdio::null()).output() else { return HashMap::new() };
    let paths: Vec<String> = String::from_utf8_lossy(&o.stdout).lines().map(String::from).collect();
    let specs: Vec<String> = paths.iter().map(|p| format!("{}:{}", head, p)).collect();
    let got = cat_file_batch(repo, &specs);
    paths.into_iter().zip(specs).filter_map(|(p, s)| got.get(&s).map(|t| (p, t.clone()))).collect()
}
fn cat_file_batch(repo: &Path, specs: &[String]) -> HashMap<String, String> {
    use std::io::Read;
    let mut out = HashMap::new(); if specs.is_empty() { return out; }
    let Ok(mut ch) = std::process::Command::new("git").args(["cat-file", "--batch"]).current_dir(repo).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn() else { return out };
    // the request goes in on its own thread: cat-file answers as it reads, so a writer that waits for all its input to land before
    // reading would deadlock on a full stdout pipe the moment the answers outgrow it
    let mut si = ch.stdin.take().unwrap(); let mut q = String::new(); for s in specs { q.push_str(s); q.push('\n'); }
    let feeder = std::thread::spawn(move || { let _ = si.write_all(q.as_bytes()); });
    let mut buf = Vec::new(); let _ = ch.stdout.take().unwrap().read_to_end(&mut buf); let _ = feeder.join(); let _ = ch.wait();
    let mut i = 0usize;
    for s in specs {
        let Some(nl) = buf[i..].iter().position(|&c| c == b'\n') else { break };
        let header = String::from_utf8_lossy(&buf[i..i + nl]).to_string(); i += nl + 1;
        if header.ends_with(" missing") || header.ends_with(" ambiguous") { continue; }
        let size: usize = header.rsplit(' ').next().and_then(|x| x.parse().ok()).unwrap_or(0);
        if i + size > buf.len() { break; }
        out.insert(s.clone(), String::from_utf8_lossy(&buf[i..i + size]).to_string()); i += size + 1;
    }
    out
}
/// C612t: /^tests\/.*\.test\.[cm]?[jt]s$/ — the hook's isTestPath
pub fn is_test_path(f: &str) -> bool {
    if !f.starts_with("tests/") || f.contains(|c: char| c == '\n' || c == '\r' || c == '\u{2028}' || c == '\u{2029}') { return false; }
    [".test.js", ".test.ts", ".test.cjs", ".test.mjs", ".test.cts", ".test.mts"].iter().any(|e| f.len() >= 6 + e.len() && f.ends_with(e))
}
/// C612t: the C612h guard leg of one written path at <head> — the path itself when it is a test, and every test that imports it or
/// names its exact path, read line by line where the basename occurs (what `git grep -n -I -F <basename> HEAD -- tests/` returns:
/// binary files skipped, a line the mjs regex cannot span — \r, U+2028/9 — skipped). Sorted by UTF-16 units like Array.sort.
pub fn bind_guards(repo: &Path, head: &str, path: &str, pre: Option<&HashMap<String, String>>) -> (Vec<String>, &'static str) {
    use crate::path_predict::bind::{imports_path, js_cmp, names_exact_path};
    let base = path.rsplit('/').next().unwrap_or(path);
    let mut set: std::collections::HashSet<String> = std::collections::HashSet::new();
    if is_test_path(path) { set.insert(path.to_string()); }
    let check = |file: &str, line: &str, set: &mut std::collections::HashSet<String>| {
        if file == path || !is_test_path(file) || line.contains(|c: char| c == '\r' || c == '\u{2028}' || c == '\u{2029}') { return; }
        if names_exact_path(line, path) || imports_path(line, file, path) { set.insert(file.to_string()); }
    };
    let src = if base.is_empty() { "none" } else if let Some(m) = pre {
        for (f, t) in m.iter() {
            let b = t.as_bytes(); if b[..b.len().min(8000)].contains(&0) || !t.contains(base) { continue; }
            for l in t.split('\n') { if l.contains(base) { check(f, l, &mut set); } }
        }
        "prefetch"
    } else {
        let o = std::process::Command::new("git").args(["grep", "-n", "-I", "-F", "-e", base, head, "--", "tests/"]).current_dir(repo).env("GIT_OPTIONAL_LOCKS", "0").stderr(std::process::Stdio::null()).output();
        let txt = o.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
        let pfx = format!("{}:", head);
        for l in txt.split('\n') {
            let Some(r) = l.strip_prefix(&pfx) else { continue };
            let Some(c1) = r.find(':') else { continue }; let (file, r2) = (&r[..c1], &r[c1 + 1..]);
            let Some(c2) = r2.find(':') else { continue }; if c2 == 0 || !r2[..c2].bytes().all(|x| x.is_ascii_digit()) { continue; }
            check(file, &r2[c2 + 1..], &mut set);
        }
        "git-grep"
    };
    let mut v: Vec<String> = set.into_iter().collect(); v.sort_by(|a, b| js_cmp(a, b)); (v, src)
}
/// C612t: the C612q small subcommands served by the daemon (no spawn per call) — the same lens::c612q functions, the same output
/// object the subcommand prints, wrapped as { out } so the socket's id/ms never mix into it
pub fn c612q_serve(req: &Value) -> Result<Value, String> {
    use crate::lens::c612q as q;
    let t0 = std::time::Instant::now();
    let flag = req.get("flag").and_then(|v| v.as_str()).unwrap_or("");
    let v = req.get("payload").cloned().unwrap_or(Value::Null);
    let ms = |t0: std::time::Instant| (t0.elapsed().as_secs_f64() * 1e6).round() / 1e3;
    let out = match flag {
        "--structural-key" | "--structural-rank" => {
            let op = v.get("op").and_then(|x| x.as_str()).unwrap_or(if flag == "--structural-rank" { "rank" } else { "key" }).to_string();
            if op == "rank" {
                let rows: Vec<Value> = v.get("rows").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                let verified: Vec<Value> = v.get("verified").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                json!({ "engine": "rust-structural-key", "row": "C612k", "op": "rank", "ranked": q::structural_rank(v.get("row").unwrap_or(&Value::Null), &rows, &verified), "compute_ms": ms(t0) })
            } else {
                let keys: Vec<Value> = v.get("rows").and_then(|x| x.as_array()).map(|a| a.iter().map(q::structural_key).collect()).unwrap_or_default();
                json!({ "engine": "rust-structural-key", "row": "C612k", "op": "key", "keys": keys, "compute_ms": ms(t0) })
            }
        }
        "--walk-admits" => {
            let op = v.get("op").and_then(|x| x.as_str()).unwrap_or("walk-admits").to_string();
            let mut out = match op.as_str() {
                "cells-admit" => { let k = v.get("K").and_then(|x| x.as_u64()).map(|x| x as usize).unwrap_or(q::CELLS_K); let id = match v.get("id") { None => String::new(), x => q::jstr(x) }; q::cells_admit(v.get("walkCells"), v.get("rowCells"), k, &id) }
                "measured-licence" => q::measured_licence(v.get("licence")),
                _ => q::walk_admits(v.get("leaf"), v.get("node"), v.get("walk"), v.get("licence")),
            };
            if let Value::Object(o) = &mut out { o.insert("engine".into(), json!("rust-walk-admits")); o.insert("compute_ms".into(), json!(ms(t0))); }
            out
        }
        "--rct-read" => {
            let a: Vec<Value> = v.get("assignments").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let o: Vec<Value> = v.get("outcomes").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let mut out = q::read_rct(&a, &o, v.get("seed").and_then(|x| x.as_str()).unwrap_or("C610f"), v.get("K").and_then(|x| x.as_u64()).unwrap_or(200) as usize);
            if let Value::Object(m) = &mut out { m.insert("engine".into(), json!("rust-rct-read")); m.insert("compute_ms".into(), json!(ms(t0))); }
            out
        }
        _ => return Err(format!("crate: {} is not served by the daemon", flag)),
    };
    Ok(json!({ "out": out }))
}
impl Reflex {
    pub fn handle(&mut self, req: &Value) -> Result<Value, String> {
        let head = req.get("head").and_then(|v| v.as_str()).ok_or("reflex: head required")?.to_string();
        let repo = PathBuf::from(req.get("repo").and_then(|v| v.as_str()).ok_or("reflex: repo required")?);
        let level = req.get("level").and_then(|v| v.as_i64()).unwrap_or(9) as i32;
        let top = req.get("top").and_then(|v| v.as_u64()).unwrap_or(REFLEX_TOP as u64) as usize;
        let hunk = req.get("hunk").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let given: Option<Vec<String>> = req.get("guards").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).take(top).collect());
        let bind_path = req.get("path").and_then(|v| v.as_str()).map(String::from);
        if self.started.insert(head.clone()) {   // first sight of this head: read its tests/ in the background, once
            let (pre, repo2, head2) = (self.pre.clone(), repo.clone(), head.clone());
            std::thread::spawn(move || { let m = prefetch_tests(&repo2, &head2); if let Ok(mut p) = pre.lock() { if p.len() >= 2 { p.clear(); } p.insert(head2, Arc::new(m)); } });
        }
        if req.get("prefetch_wait").and_then(|v| v.as_bool()) == Some(true) {   // a warm call may wait for the background read
            for _ in 0..600 { if self.pre.lock().map(|p| p.contains_key(&head)).unwrap_or(false) { break; } std::thread::sleep(std::time::Duration::from_millis(50)); }
        }
        let pre = self.pre.lock().ok().and_then(|p| p.get(&head).cloned());
        // C612t: with a path and no guard list, the C612h guard leg is bound HERE (path_predict.rs mod bind predicates over the tests
        // held at <head>, or one git grep while the prefetch is still reading) — the hook no longer decides it in mjs
        let (guards, bound_from): (Vec<String>, &str) = match (given, bind_path.as_deref()) {
            (Some(g), _) => (g, "given"),
            (None, Some(p)) => { let (g, src) = bind_guards(&repo, &head, p, pre.as_deref()); (g.into_iter().take(top).collect(), src) }
            (None, None) => (Vec::new(), "none"),
        };
        let entry = self.held.entry((head.clone(), level)).or_default();
        let need: Vec<String> = guards.iter().filter(|g| !entry.contains_key(&format!("guard:{}", g))).cloned().collect();
        let mut read: Vec<(String, String)> = Vec::new(); let mut specs: Vec<String> = Vec::new(); let mut from_pre = 0usize;
        for g in &need { match pre.as_ref().and_then(|m| m.get(g)) { Some(t) => { read.push((g.clone(), t.clone())); from_pre += 1; } None => specs.push(format!("{}:{}", head, g)) } }
        let got = cat_file_batch(&repo, &specs);
        for s in &specs { if let Some(t) = got.get(s) { let g = s[head.len() + 1..].to_string(); read.push((g, t.clone())); } }
        let fresh: Vec<(String, Anchor)> = read.into_par_iter().map(|(g, t)| { let c = gzip_len_level(t.as_bytes(), level); (format!("guard:{}", g), Anchor { text: Arc::new(t), clen: c }) }).collect();
        let missing: Vec<String> = need.iter().filter(|g| !fresh.iter().any(|(id, _)| id == &format!("guard:{}", g))).cloned().collect();
        let disk_reads = if specs.is_empty() { 0 } else { specs.len() };
        self.disk_reads += disk_reads;
        for (id, a) in fresh { entry.insert(id, a); }
        let held = &*entry;
        if req.get("warm").and_then(|v| v.as_bool()) == Some(true) { return Ok(json!({ "readings": [], "guards": guards, "bound_from": bound_from, "disk_reads": disk_reads, "from_prefetch": from_pre, "prefetched": pre.as_ref().map(|m| m.len()), "missing": missing, "held": held.len() })); }
        let ch = gzip_len_level(hunk.as_bytes(), level);
        let readings: Vec<Value> = guards.par_iter().filter_map(|g| {
            let a = held.get(&format!("guard:{}", g))?;
            let mut ab = String::with_capacity(hunk.len() + 1 + a.text.len()); ab.push_str(&hunk); ab.push('\n'); ab.push_str(&a.text);
            let cab = gzip_len_level(ab.as_bytes(), level);
            let (lo, hi) = if ch < a.clen { (ch, a.clen) } else { (a.clen, ch) };
            Some(json!({ "guard": g, "ncd": if hi == 0 { 0.0 } else { (cab as f64 - lo as f64) / hi as f64 }, "c_guard": a.clen, "c_pair": cab }))
        }).collect();
        Ok(json!({ "readings": readings, "guards": guards, "bound_from": bound_from, "c_hunk": ch, "disk_reads": disk_reads, "from_prefetch": from_pre, "prefetched": pre.as_ref().map(|m| m.len()), "missing": missing, "held": held.len() }))
    }
}

#[derive(Default)]
pub struct Door {
    pairs: HashMap<String, Arc<Vec<u64>>>,
    coords: HashMap<String, Arc<Vec<String>>>,
    anchors: HashMap<(String, i32), HashMap<String, Anchor>>,   // (head, level) → id → anchor
    trees: HashMap<String, TreeHeld>,                            // C612b2: tree path → the rows held at its root
    pub tree_reads: usize,
    reflex: Reflex,
    files: std::sync::Mutex<FileCache>,
    pub(crate) panel_held: panel::Held,   // C612r: the held 144 library, the directed connectivity, the record threads
    stranger_held: HashMap<String, Arc<Vec<Option<Box<[u8; CELLS]>>>>>,   // C1428: the panel's sensed grids, per library bytes (None = degenerate)
}

impl Door {
    fn pairs(&mut self, p: &str) -> Result<Arc<Vec<u64>>, String> {
        if let Some(v) = self.pairs.get(p) { return Ok(v.clone()); }
        let t = std::fs::read_to_string(p).map_err(|e| format!("pairs {}: {}", p, e))?;
        let v: Vec<Value> = serde_json::from_str(&t).map_err(|e| format!("pairs json: {}", e))?;
        let out: Vec<u64> = v.iter().map(|x| x.as_str().and_then(|s| s.parse().ok()).or_else(|| x.as_u64()).unwrap_or(0)).collect();
        let a = Arc::new(out); self.pairs.insert(p.to_string(), a.clone()); Ok(a)
    }
    /// C1407: held by the BYTES, not the path — a library swapped at the same path is re-read — and the sha256[:16] of the bytes
    /// loaded comes back with the coords, so the walk can name exactly what it read.
    fn coords_read(&mut self, p: &str) -> Result<(Arc<Vec<String>>, String), String> {
        let b = std::fs::read(p).map_err(|e| format!("walks: lib {}: {}", p, e))?;
        let sha = hex_of(&Sha256::digest(&b))[..16].to_string();
        let key = format!("{}#{}", p, sha);
        if let Some(v) = self.coords.get(&key) { return Ok((v.clone(), sha)); }
        let c = Arc::new(crate::lens::library_coords(Path::new(p))?); self.coords.insert(key, c.clone()); Ok((c, sha))
    }
    /// C1428 S3b: the stranger panel's claim-sense grids on a library, held by its bytes. The pair signatures are the library's own
    /// (sense::sigs_of over "<node i> <node j>", the pair text triptych-build.mjs's PAIR_CACHE signs), each member's claims are
    /// door_panel.rs claims_op's chain, and the grid is sense_grid at the sense's target and floor.
    fn stranger_grids(&mut self, lib_p: &str, lib_sha: &str, coords: &[String]) -> Result<Arc<Vec<Option<Box<[u8; CELLS]>>>>, String> {
        if let Some(g) = self.stranger_held.get(lib_sha) { return Ok(g.clone()); }
        let panel = stranger_panel()?;
        let raw: Value = serde_json::from_slice(&std::fs::read(lib_p).map_err(|e| format!("strangers: lib {}: {}", lib_p, e))?).map_err(|e| format!("strangers: lib json: {}", e))?;
        let arr: Vec<Value> = raw.as_array().cloned().or_else(|| raw.get("anchors").or_else(|| raw.get("nodes")).and_then(|v| v.as_array()).cloned()).unwrap_or_default();
        let node_text: Vec<String> = coords.iter().map(|c| arr.iter().find(|t| t.get("coord").and_then(|v| v.as_str()) == Some(c.as_str())).and_then(|t| t.get("snippet"))
            .map(|v| match v { Value::String(x) => x.clone(), Value::Null => String::new(), o => o.to_string() }).unwrap_or_default()).collect();
        if node_text.len() * node_text.len() != CELLS { return Err(format!("strangers: the library holds {} coords, not 144", node_text.len())); }
        let pair_text: Vec<String> = (0..CELLS).map(|k| format!("{} {}", node_text[k / 144], node_text[k % 144])).collect();
        let pairs = crate::sense::sigs_of(&pair_text, crate::signature::ShingleMode::Word);
        let claims = panel::claims_op(&json!({ "texts": panel.iter().map(|m| m.text.clone()).collect::<Vec<_>>() }))?;
        let out: Vec<Option<Box<[u8; CELLS]>>> = claims.get("out").and_then(|v| v.as_array()).cloned().unwrap_or_default().par_iter().map(|c| {
            if c.get("degenerate").and_then(|v| v.as_bool()).unwrap_or(true) { return None; }
            let sigs: Vec<u64> = c.get("sigs").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().and_then(|t| t.parse().ok())).collect()).unwrap_or_default();
            let (_, g, _) = sense_grid(&sense_scores(&sigs, &pairs), SENSE_TARGET, SENSE_FLOOR);
            let mut b = Box::new([0u8; CELLS]); b.copy_from_slice(&g[..CELLS]); Some(b)
        }).collect();
        if out.len() != panel.len() { return Err("strangers: the claim chain answered another count than the panel".into()); }
        if self.stranger_held.len() >= 4 { self.stranger_held.clear(); }
        let a = Arc::new(out); self.stranger_held.insert(lib_sha.to_string(), a.clone()); Ok(a)
    }
    /// C1428 S3b: each panel member walked against the spec with the reading's own walk, its verdict decoded at the reading's kill —
    /// the value sealed as spec_strangers (integers and strings only)
    #[allow(clippy::too_many_arguments)]
    fn walk_strangers(&mut self, lib_p: &str, lib_sha: &str, coords: &[String], seeds: &[usize], k: (usize, usize, usize, u128, f64), intent_matrix: &[f64], kill: f64, spec_sha: &str) -> Value {
        let kill_v = if kill.fract() == 0.0 { json!(kill as i64) } else { json!(kill) };
        let panel = match stranger_panel() { Ok(p) => p, Err(e) => return json!({ "state": "UNMEASURED", "reason": e, "panel_sha": STRANGER_PANEL_SHA, "kill": kill_v }) };
        let grids = match self.stranger_grids(lib_p, lib_sha, coords) { Ok(g) => g, Err(e) => return json!({ "state": "UNMEASURED", "reason": e, "panel_sha": STRANGER_PANEL_SHA, "kill": kill_v }) };
        let (md, tk, bu, bms, de) = k;
        let members: Vec<Value> = panel.par_iter().zip(grids.par_iter()).map(|(m, g)| {
            let row = |verdict: &str, off: Value, why: Option<&str>| json!({ "key": m.key, "sha": m.sha16, "verdict": verdict, "offPct": off, "reason": why });
            if m.sha16 == spec_sha { return row("OWN", Value::Null, Some("the spec's own text")); }
            let Some(g) = g else { return row("UNMEASURED", Value::Null, Some("degenerate text: no grid")) };
            let w = crate::lens::definer_walk_value(g, coords, seeds, md, tk, bu, bms, de);
            if w.get("time_budget_tripped").and_then(|v| v.as_bool()).unwrap_or(false) { return row("UNMEASURED", Value::Null, Some("TIME bound: not a reading")); }
            let rm: Vec<f64> = w.get("matrix").and_then(|x| x.as_array()).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect()).unwrap_or_default();
            let tol = panel::decode_edges(intent_matrix, &rm, kill);
            match tol.off_pct { Some(p) => row(if tol.too_many { "OFF_DOMAIN" } else { "IN_LANE" }, json!(p.round() as i64), None), None => row("UNMEASURED", Value::Null, Some("the decode refused")) }
        }).collect();
        json!({ "state": "WALKED", "panel_sha": STRANGER_PANEL_SHA, "kill": kill_v, "members": members })
    }
    /// the coords alone (door_panel.rs), held by the bytes like coords_read
    pub fn coords(&mut self, p: &str) -> Result<Arc<Vec<String>>, String> { self.coords_read(p).map(|(c, _)| c) }

    /// the anchors for (head, level): memory first, then <dir>/<head>.bin (level 9) or <head>.l<level>.bin, then compute — and write back
    fn ensure_anchors(&mut self, head: &str, level: i32, dir: &Path, list: &[(String, String)]) -> Result<(usize, usize, usize, String), String> {
        let path = dir.join(if level == 9 { format!("{}.bin", head) } else { format!("{}.l{}.bin", head, level) });
        let key = (head.to_string(), level);
        let fresh_mem = !self.anchors.contains_key(&key);
        if fresh_mem { self.anchors.insert(key.clone(), HashMap::new()); }
        let disk = if fresh_mem { read_bin(&path) } else { HashMap::new() };
        let held = self.anchors.get(&key).unwrap();
        let shas: Vec<[u8; 8]> = list.iter().map(|(_, t)| sha8(t)).collect();
        let (mut todo, mut loaded, mut from_disk) = (Vec::new(), 0usize, Vec::new());
        for (i, (id, t)) in list.iter().enumerate() {
            if let Some(a) = held.get(id) { if a.text.as_str() == t { loaded += 1; continue; } }
            match disk.get(id) { Some((s, lv, c)) if *s == shas[i] && *lv == level => { from_disk.push((i, *c)); loaded += 1; } _ => todo.push(i) }
        }
        let fresh: Vec<(usize, usize)> = todo.par_iter().map(|&i| (i, gzip_len_level(list[i].1.as_bytes(), level))).collect();
        let entry = self.anchors.get_mut(&key).unwrap();
        for (i, c) in from_disk.iter().chain(fresh.iter()) { entry.insert(list[*i].0.clone(), Anchor { text: Arc::new(list[*i].1.clone()), clen: *c }); }
        if !fresh.is_empty() || !path.exists() {
            let mut rows: Vec<(String, [u8; 8], i32, usize)> = entry.iter().map(|(id, a)| (id.clone(), sha8(&a.text), level, a.clen)).collect();
            rows.sort_by(|a, b| a.0.cmp(&b.0));
            write_bin(&path, &rows).map_err(|e| format!("anchors: write {}: {}", path.display(), e))?;
        }
        Ok((fresh.len(), loaded, entry.len(), path.display().to_string()))
    }

    /// C612b2 — retro-snowball.mjs rowsOf(readTree(path)), held per tree path and re-read ONLY when the root hash (the tree file's
    /// "root" field, read off its first 64 KiB) changes. A parse counts in tree_reads; the guard reads it.
    fn tree_rows(&mut self, p: &str) -> Result<(Arc<Value>, String, bool), String> {
        let root = tree_root(Path::new(p)).ok_or_else(|| format!("rows: no root in {}", p))?;
        if let Some(t) = self.trees.get(p) { if t.root == root { return Ok((t.rows.clone(), root, false)); } }
        let rows = Arc::new(parse_rows(Path::new(p))?);
        self.tree_reads += 1;
        let root2 = tree_root(Path::new(p)).unwrap_or_default();   // a fold that rewrote the file mid-parse: hold it under the new root only if it did not move
        if root2 == root { self.trees.insert(p.to_string(), TreeHeld { root: root.clone(), rows: rows.clone() }); }
        Ok((rows, root, true))
    }

    pub fn handle(&mut self, req: &Value) -> Result<Value, String> {
        let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let strs = |k: &str| -> Vec<String> { req.get(k).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default() };
        match op {
            "ping" => Ok(json!({ "ok": true, "pid": std::process::id() })),
            "entry" => entry_op(req),   // C1394: the floor + the health stamp, before any sense or walk
            "verify" => verify_op(req),   // C1406: the seal, the floor and the stages, recomputed here — the verdict side's one check
            "admit" => admit_op(req),   // C1411 S3: the spec's own positive IN_LANE and own negative OFF_DOMAIN, or no verdict
            "mass" => mass_op(req),   // C1409: the floor for a text nobody walks (tape triangulation, aperture window, a bench's eye)
            "sense" => {
                let pairs = self.pairs(req.get("pairs").and_then(|v| v.as_str()).ok_or("sense: pairs path required")?)?;
                let target = req.get("target").and_then(|v| v.as_u64()).unwrap_or(900) as usize;
                let floor = req.get("floor").and_then(|v| v.as_f64()).unwrap_or(0.56);
                let sides: Vec<Vec<u64>> = req.get("sides").and_then(|v| v.as_array()).ok_or("sense: sides required")?.iter()
                    .map(|s| s.as_array().map(|a| a.iter().map(|x| x.as_str().and_then(|t| t.parse().ok()).unwrap_or(0u64)).collect()).unwrap_or_default()).collect();
                let out: Vec<Value> = sides.par_iter().map(|claims| {
                    let sc = sense_scores(claims, &pairs);
                    let (theta, g, lit) = sense_grid(&sc, target, floor);
                    let mut raw = Vec::with_capacity(sc.len() * 4); for f in &sc { raw.extend_from_slice(&f.to_le_bytes()); }
                    json!({ "score_b64": B64.encode(raw), "grid_b64": pack_bits(&g), "lit": lit, "theta": theta })
                }).collect();
                // C1406: the sense re-seals the stamp it was handed — the stage that proves the sense ran in the crate
                match req.get("stamp") { Some(st) if !st.is_null() => Ok(json!({ "sides": out, "stamp": stage_seal(st, &[("sense", json!("rust"))])? })), _ => Ok(json!({ "sides": out })) }
            }
            "walks" => {
                let (coords, lib_sha) = self.coords_read(req.get("lib").and_then(|v| v.as_str()).ok_or("walks: lib path required")?)?;
                // C1407: THE STAMP HASHES WHAT THE WALK READ. A stamp handed in must name, as axes_sha, the very bytes this walk loaded;
                // the C1394 skeptic moved axesPath and the stamp changed while the walk read another file. Refused before any walk.
                if let Some(st) = req.get("stamp").filter(|v| !v.is_null()) {
                    let stamped = st.get("axes_sha").and_then(|v| v.as_str()).unwrap_or("");
                    if stamped != lib_sha { return Err(format!("walks: the library this walk loaded ({}) is not the one the entry stamped (axes_sha {}): the sense and the walk read one path", lib_sha, if stamped.is_empty() { "absent" } else { stamped })); }
                }
                let seeds: Vec<usize> = req.get("seeds").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_u64().map(|n| n as usize)).collect()).unwrap_or_default();
                let k = req.get("knobs").cloned().unwrap_or(Value::Null);
                let num = |n: &str, d: f64| k.get(n).and_then(|v| v.as_f64()).unwrap_or(d);
                let (md, tk, bu, bms, de) = (num("maxDepth", 8.0) as usize, num("topK", 2.0) as usize, num("budget", 220.0) as usize, num("budgetMs", 600000.0) as u128, num("decay", 0.5));
                let grids: Vec<Box<[u8; CELLS]>> = strs("grids").iter().map(|g| unpack_grid(g).ok_or("walks: bad grid")).collect::<Result<_, _>>()?;
                let walks: Vec<Value> = grids.par_iter().map(|g| crate::lens::definer_walk_value(g, &coords, &seeds, md, tk, bu, bms, de)).collect();
                // C1406: the walks re-seal the stamp they were handed with the bound that stopped them — WORK, or TIME when any walk's
                // wall-clock valve fired first. The stage that proves the walks ran in the crate.
                let timed = walks.iter().any(|w| w.get("time_budget_tripped").and_then(|v| v.as_bool()).unwrap_or(false));
                // C1409: THE VERDICT LIVES IN THE CRATE. With a kill, the walks op decodes the intent and reality walks (the first two
                // grids) with door_panel.rs decode_edges — the port of triptych-render.mjs decodeDeltaThreeColourEdges, held equal by
                // c612r — and seals offPct, tooMany and the tier into the stamp. Integers only, so the seal survives a JSON round trip.
                let mut add: Vec<(&str, Value)> = vec![("bound", json!(if timed { "TIME" } else { "WORK" }))];
                if let (Some(kill), true) = (req.get("kill").and_then(|v| v.as_f64()), walks.len() >= 2) {
                    let mat = |w: &Value| -> Vec<f64> { w.get("matrix").and_then(|m| m.as_array()).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect()).unwrap_or_default() };
                    let tol = panel::decode_edges(&mat(&walks[0]), &mat(&walks[1]), kill);
                    let tier: Option<String> = tol.region.as_ref().and_then(|r: &panel::J| serde_json::from_str::<Value>(&r.stringify(None)).ok()).and_then(|r: Value| r.get("tier").and_then(|t| t.as_str()).map(String::from));
                    let kill_v = if kill.fract() == 0.0 { json!(kill as i64) } else { json!(kill) };
                    add.push(("verdict", match tol.off_pct {
                        Some(p) => json!({ "offPct": p.round() as i64, "tooMany": tol.too_many, "tier": tier, "kill": kill_v }),
                        None => json!({ "offPct": Value::Null, "tooMany": Value::Null, "tier": Value::Null, "kill": kill_v, "refused": true, "refusal": tol.refusal }),
                    }));
                }
                // C1428 S3b: a reading (a sealed stamp that is not a leg, walked at a kill) walks the stranger panel with its own walk
                if let (Some(st), Some(kill)) = (req.get("stamp").filter(|v| v.is_object() && v.get("leg").is_none()), req.get("kill").and_then(|v| v.as_f64())) {
                    if !walks.is_empty() {
                        let spec_sha = st.get("spec_mass").and_then(|m| m.get("sha")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let lib_p = req.get("lib").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let im: Vec<f64> = walks[0].get("matrix").and_then(|m| m.as_array()).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect()).unwrap_or_default();
                        add.push(("spec_strangers", self.walk_strangers(&lib_p, &lib_sha, &coords, &seeds, (md, tk, bu, bms, de), &im, kill, &spec_sha)));
                    }
                }
                match req.get("stamp") { Some(st) if !st.is_null() => Ok(json!({ "walks": walks, "lib_sha": lib_sha, "stamp": stage_seal(st, &add)? })), _ => Ok(json!({ "walks": walks, "lib_sha": lib_sha })) }
            }
            "slot" => {
                let repo = PathBuf::from(req.get("repo").and_then(|v| v.as_str()).ok_or("slot: repo required")?);
                Ok(slot(&repo, &strs("files"), &strs("sym_terms"), &strs("word_terms"), &self.files))
            }
            "anchors" => {
                let head = req.get("head").and_then(|v| v.as_str()).ok_or("anchors: head required")?.to_string();
                let level = req.get("level").and_then(|v| v.as_i64()).unwrap_or(9) as i32;
                let dir = PathBuf::from(req.get("dir").and_then(|v| v.as_str()).ok_or("anchors: dir required")?);
                let list: Vec<(String, String)> = req.get("anchors").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| Some((x.get("id")?.as_str()?.to_string(), x.get("text")?.as_str()?.to_string()))).collect()).unwrap_or_default();
                let (computed, loaded, held, path) = self.ensure_anchors(&head, level, &dir, &list)?;
                Ok(json!({ "computed": computed, "loaded": loaded, "held": held, "path": path }))
            }
            "place" => {
                // C612b2 — compress.mjs placePixel for many clauses: the 144 snippet lengths come from the per-HEAD anchor cache
                // (level −1, node's gzipSync default), so a clause compresses only itself and the clause+snippet pairs.
                let head = req.get("head").and_then(|v| v.as_str()).ok_or("place: head required")?.to_string();
                let dir = PathBuf::from(req.get("dir").and_then(|v| v.as_str()).ok_or("place: dir required")?);
                let cells: Vec<(String, String)> = req.get("cells").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| Some((x.get("coord")?.as_str()?.to_string(), x.get("snippet")?.as_str()?.to_string()))).collect()).unwrap_or_default();
                let list: Vec<(String, String)> = cells.iter().map(|(c, t)| (format!("snip:{}", c), t.clone())).collect();
                let (computed, _, _, _) = self.ensure_anchors(&head, -1, &dir, &list)?;
                let held = self.anchors.get(&(head.clone(), -1)).unwrap();
                let snip_z: Vec<usize> = list.iter().map(|(id, _)| held.get(id).map(|a| a.clen).unwrap_or(0)).collect();
                let clauses = strs("clauses");
                let out: Vec<Value> = clauses.par_iter().map(|doc| place_pixel(doc, &cells, &snip_z)).collect();
                Ok(json!({ "placements": out, "computed": computed }))
            }
            "reflex" => self.reflex.handle(req),
            "crate" => c612q_serve(req),   // C612t
            "panel" => self.panel(req),   // C612r
            "reward" => self.reward(req),   // C1271+C1276/C1304: the gate + spill + jaccard, read off panel's own answer
            "claims" => panel::claims_op(req),   // C612r: the claim chain alone, for the guard
            "rows" => {
                let p = req.get("tree").and_then(|v| v.as_str()).ok_or("rows: tree path required")?.to_string();
                let (rows, root, parsed) = self.tree_rows(&p)?;
                Ok(json!({ "rows": &*rows, "root": root, "parsed": parsed, "reads": self.tree_reads }))
            }
            "png" => {
                let raw = B64.decode(req.get("rgba_b64").and_then(|v| v.as_str()).unwrap_or("")).map_err(|e| format!("png: {}", e))?;
                let w = req.get("w").and_then(|v| v.as_u64()).unwrap_or(0) as usize; let h = req.get("h").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                if raw.len() != w * h * 4 || w == 0 { return Err(format!("png: rgba is {} bytes, not {}×{}×4", raw.len(), w, h)); }
                Ok(json!({ "png_b64": B64.encode(crate::png::png_from_rgba(&raw, w, h)) }))
            }
            "ncd" => {
                let head = req.get("head").and_then(|v| v.as_str()).ok_or("ncd: head required")?;
                let level = req.get("level").and_then(|v| v.as_i64()).unwrap_or(9) as i32;
                let held = self.anchors.get(&(head.to_string(), level)).ok_or("ncd: no anchors held for this head — call anchors first")?;
                let level = &level;
                let prompt = req.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
                let ca = gzip_len_level(prompt.as_bytes(), *level);
                let ids = strs("ids");
                let vals: Vec<(String, Option<f64>)> = ids.par_iter().map(|id| {
                    let Some(a) = held.get(id) else { return (id.clone(), None) };
                    let mut ab = String::with_capacity(prompt.len() + 1 + a.text.len()); ab.push_str(prompt); ab.push('\n'); ab.push_str(&a.text);
                    let cab = gzip_len_level(ab.as_bytes(), *level);
                    let (lo, hi) = if ca < a.clen { (ca, a.clen) } else { (a.clen, ca) };
                    (id.clone(), Some(if hi == 0 { 0.0 } else { (cab as f64 - lo as f64) / hi as f64 }))
                }).collect();
                let mut m = serde_json::Map::new(); let mut pairs = 0usize;
                for (id, v) in vals { if let Some(x) = v { pairs += 1; m.insert(id, json!(x)); } }
                Ok(json!({ "ncd": Value::Object(m), "prompt_clen": ca, "computed_pairs": pairs }))
            }
            other => Err(format!("unknown op '{}'", other)),
        }
    }
}

/// C620: the path-bind Binders the daemon holds, one per repo. Binder holds Rc caches (not Send), so in the socket daemon the
/// Binders live on ONE worker thread and connections reach it over a channel (bind_worker); the one-shot door holds its own.
#[derive(Default)]
pub struct Binders { held: HashMap<String, crate::path_predict::bind::Binder> }
pub const BINDERS_MAX: usize = 8;
fn is_full_sha(s: &str) -> bool { s.len() == 40 && s.bytes().all(|c| c.is_ascii_hexdigit()) }
impl Binders {
    pub fn answer(&mut self, req: &Value) -> Result<Value, String> {
        use crate::path_predict::bind::{answer, Binder};
        let doc = req.get("doc").filter(|d| d.is_object()).ok_or("bind: no doc (the --path-bind doc goes under \"doc\")")?;
        let repo = doc["repo"].as_str().unwrap_or(".").to_string();
        let pinned = doc["queries"].as_array().map(|qs| qs.iter().all(|q| q["at"].as_str().map(is_full_sha).unwrap_or(false))).unwrap_or(true);
        if !pinned { let mut b = Binder::new(&repo); return Ok(json!({ "out": answer(doc, &mut b), "held": false })); }
        if !self.held.contains_key(&repo) { if self.held.len() >= BINDERS_MAX { self.held.clear(); } self.held.insert(repo.clone(), Binder::new(&repo)); }
        let b = self.held.get_mut(&repo).ok_or("bind: binder vanished")?;
        Ok(json!({ "out": answer(doc, b), "held": true }))
    }
}
type BindJob = (Value, std::sync::mpsc::Sender<Result<Value, String>>);
fn bind_worker() -> std::sync::mpsc::Sender<BindJob> {
    let (tx, rx) = std::sync::mpsc::channel::<BindJob>();
    std::thread::spawn(move || { let mut bs = Binders::default(); for (req, back) in rx { let _ = back.send(bs.answer(&req)); } });
    tx
}

/// `pmu-onchip --door-serve` — the loop. One bad request answers an error line and the loop keeps serving.
pub fn run_door_serve() -> io::Result<()> {
    let args: Vec<String> = std::env::args().collect();   // C612b2: --socket <path> serves the same door across processes
    if let Some(p) = args.iter().position(|a| a == "--socket").and_then(|i| args.get(i + 1)) { return run_door_socket(Path::new(p)); }
    if let Some(p) = args.iter().position(|a| a == "--relay").and_then(|i| args.get(i + 1)) { return run_door_relay(Path::new(p)); }
    let stdin = io::stdin(); let mut out = io::BufWriter::new(io::stdout());
    let mut door = Door::default();
    let mut binders = Binders::default();   // C620
    for line in stdin.lock().lines() {
        let line = line?; if line.trim().is_empty() { continue; }
        let req: Value = match serde_json::from_str(&line) { Ok(v) => v, Err(e) => { writeln!(out, "{}", json!({ "error": format!("bad json: {}", e) }))?; out.flush()?; continue; } };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        if req.get("op").and_then(|v| v.as_str()) == Some("shutdown") { writeln!(out, "{}", json!({ "id": id, "ok": true }))?; out.flush()?; break; }
        let t0 = std::time::Instant::now();
        let r = if req.get("op").and_then(|v| v.as_str()) == Some("bind") { binders.answer(&req) } else { door.handle(&req) };
        let resp = match r {
            Ok(mut v) => { if let Value::Object(ref mut m) = v { m.insert("id".into(), id); m.insert("ms".into(), json!(t0.elapsed().as_secs_f64() * 1000.0)); } v }
            Err(e) => json!({ "id": id, "error": e }),
        };
        writeln!(out, "{}", resp)?; out.flush()?;
    }
    door.panel_held.join_pending();   // C612r: the one-shot door keeps its records (receipt, vectors, the bridge post) before it exits
    Ok(())
}

/// `pmu-onchip --door-serve --socket <path>` — the SAME door held across node processes (C612b2): the tree's rows, the pair
/// signatures and the anchor lengths survive from one note to the next. One connection = any number of request lines; connections
/// are served one at a time. Exits after DOOR_IDLE_SECS with no connection, or on {"op":"shutdown"}; ping reports the exe mtime
/// so a client can retire a daemon older than the binary on disk.
pub const DOOR_IDLE_SECS: u64 = 1800;
/// C625: ONE DAEMON PER SOCKET. 12 `--door-serve` on .thetacog/door-serve.sock were alive at once: callers that found no socket
/// started one each at the same moment, every starter unlinked the file the one before it had bound, and an unlinked listener
/// never hears another connection, so it lived out its 30 idle minutes as an orphan. Three moves close it: (1) a socket that
/// answers → exit 0 at once; (2) probe + unlink + bind under an O_EXCL lock file beside the socket (a lock older than
/// DOOR_LOCK_STALE_MS is a crashed starter's, taken over), so two starters cannot both bind; (3) the daemon remembers the
/// (dev, inode) it bound and exits within DOOR_OWN_POLL_MS once the path names another file or none — so whatever slips past
/// (2) converges to one — and it unlinks the path only while the path is still its own.
pub const DOOR_LOCK_STALE_MS: u128 = 5000;
pub const DOOR_OWN_POLL_MS: u64 = 500;
/// bf-6808 R1: A ONE-SHOT RUN'S WALKER DIES WITH IT. A sweep run from a packed extract under the OS temp dir sits past SUN_LEN, so its
/// socket moves to `<tmp>/pmu-door-<hash>.sock` (C1373) — outside the extract the sweep removes — and the daemon idled its 30 minutes
/// re-parented to launchd (five found by hand on 2026-10-29 at load 20–26). `--parent-pid <pid>` (or PMU_DOOR_PARENT_PID) ties the
/// daemon to the run that started it: once that pid is gone the daemon releases its socket and exits within DOOR_OWN_POLL_MS. The
/// repo's own door is started untied and keeps its idle timeout.
pub fn door_parent_pid(args: &[String]) -> Option<i32> {
    args.iter().position(|a| a == "--parent-pid").and_then(|i| args.get(i + 1)).cloned()
        .or_else(|| std::env::var("PMU_DOOR_PARENT_PID").ok())
        .and_then(|v| v.trim().parse::<i32>().ok()).filter(|p| *p > 1)
}
extern "C" { fn kill(pid: i32, sig: i32) -> i32; }
/// a pid that answers signal 0 is alive (EPERM still means alive; only ESRCH — kill returns -1 with no such process — is gone)
fn pid_alive(pid: i32) -> bool { let ok = unsafe { kill(pid, 0) } == 0; ok || io::Error::last_os_error().raw_os_error() == Some(1) }
fn sock_id(p: &Path) -> Option<(u64, u64)> { use std::os::unix::fs::MetadataExt; std::fs::symlink_metadata(p).ok().map(|m| (m.dev(), m.ino())) }
fn answers(sock: &Path) -> bool { std::os::unix::net::UnixStream::connect(sock).is_ok() }
/// the bound listener and its (dev, inode), or None when another daemon already answers on <sock>
fn bind_one(sock: &Path) -> io::Result<Option<(std::os::unix::net::UnixListener, (u64, u64))>> {
    if answers(sock) { return Ok(None); }   // one is already serving
    if let Some(d) = sock.parent() { if !d.as_os_str().is_empty() { std::fs::create_dir_all(d)?; } }
    let mut lock = sock.as_os_str().to_owned(); lock.push(".lock");
    let lock = std::path::PathBuf::from(lock);
    let t0 = std::time::Instant::now();
    loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => break,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                let age = std::fs::metadata(&lock).ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).map(|d| d.as_millis()).unwrap_or(0);
                if age > DOOR_LOCK_STALE_MS { let _ = std::fs::remove_file(&lock); continue; }
                if t0.elapsed().as_millis() > DOOR_LOCK_STALE_MS * 2 { return Err(io::Error::new(io::ErrorKind::TimedOut, "door-serve: the bind lock never freed")); }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(e) => return Err(e),
        }
    }
    let r = (|| -> io::Result<Option<(std::os::unix::net::UnixListener, (u64, u64))>> {
        if answers(sock) { return Ok(None); }   // the starter that held the lock before us is serving now
        let _ = std::fs::remove_file(sock);     // a dead socket file is unlinked and taken
        let l = std::os::unix::net::UnixListener::bind(sock)?;
        let id = sock_id(sock).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "door-serve: the bound socket vanished"))?;
        Ok(Some((l, id)))
    })();
    let _ = std::fs::remove_file(&lock);
    r
}
/// unlink <sock> only while it is still the file this daemon bound — never a successor's
fn release_own(sock: &Path, own: (u64, u64)) { if sock_id(sock) == Some(own) { let _ = std::fs::remove_file(sock); } }
pub fn run_door_socket(sock: &Path) -> io::Result<()> {
    use std::sync::atomic::{AtomicU64, Ordering};
    let Some((listener, own)) = bind_one(sock)? else { return Ok(()) };
    let last = Arc::new(AtomicU64::new(now_secs()));
    let parent = door_parent_pid(&std::env::args().collect::<Vec<_>>());   // bf-6808 R1
    { let last = last.clone(); let sockp = sock.to_path_buf(); std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(DOOR_OWN_POLL_MS));
        if sock_id(&sockp) != Some(own) { std::process::exit(0); }   // C625: the path is no longer ours — an orphan serves no one
        if let Some(p) = parent { if !pid_alive(p) { release_own(&sockp, own); std::process::exit(0); } }   // R1: the run that started it is gone
        if now_secs().saturating_sub(last.load(Ordering::Relaxed)) > DOOR_IDLE_SECS { release_own(&sockp, own); std::process::exit(0); }
    }); }
    let exe_mtime = std::env::current_exe().ok().and_then(|p| std::fs::metadata(p).ok()).and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    // C612b2: one thread per connection over ONE shared door (a Mutex held per request), so a client that keeps its connection open
    // can never stall another; the held state — rows, pairs, anchors, code files — is shared by all of them.
    let door = Arc::new(std::sync::Mutex::new(Door::default()));
    let reflex = Arc::new(std::sync::Mutex::new(Reflex::default()));   // C612j: the reflex never waits on the door's lock
    let binds = bind_worker();   // C620: the path-bind never waits on the door's lock either
    for conn in listener.incoming() {
        let Ok(stream) = conn else { continue };
        last.store(now_secs(), Ordering::Relaxed);
        let (door, reflex, last, sockp, binds) = (door.clone(), reflex.clone(), last.clone(), sock.to_path_buf(), binds.clone());
        std::thread::spawn(move || {
            let Ok(rs) = stream.try_clone() else { return };
            let reader = io::BufReader::new(rs);
            let mut out = io::BufWriter::new(stream);
            for line in reader.lines() {
                let Ok(line) = line else { break }; if line.trim().is_empty() { continue; }
                let req: Value = match serde_json::from_str(&line) { Ok(v) => v, Err(e) => { let _ = writeln!(out, "{}", json!({ "error": format!("bad json: {}", e) })); let _ = out.flush(); continue; } };
                let id = req.get("id").cloned().unwrap_or(Value::Null);
                let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if op == "shutdown" { let _ = writeln!(out, "{}", json!({ "id": id, "ok": true })); let _ = out.flush(); release_own(&sockp, own); std::process::exit(0); }
                let t0 = std::time::Instant::now();
                let resp = if op == "bind" { let (tx, rx) = std::sync::mpsc::channel(); let r = binds.send((req.clone(), tx)).map_err(|_| "bind: worker gone".to_string()).and_then(|_| rx.recv().map_err(|_| "bind: worker gone".to_string())).and_then(|r| r); match r { Ok(mut v) => { if let Value::Object(ref mut m) = v { m.insert("id".into(), id); m.insert("ms".into(), json!(t0.elapsed().as_secs_f64() * 1000.0)); } v } Err(e) => json!({ "id": id, "error": e }) } } else if op == "crate" { match c612q_serve(&req) { Ok(mut v) => { if let Value::Object(ref mut m) = v { m.insert("id".into(), id); m.insert("ms".into(), json!(t0.elapsed().as_secs_f64() * 1000.0)); } v } Err(e) => json!({ "id": id, "error": e }) } } else if op == "reflex" { let mut r = match reflex.lock() { Ok(g) => g, Err(p) => p.into_inner() }; match r.handle(&req) { Ok(mut v) => { if let Value::Object(ref mut m) = v { m.insert("id".into(), id); m.insert("ms".into(), json!(t0.elapsed().as_secs_f64() * 1000.0)); } v } Err(e) => json!({ "id": id, "error": e }) } } else { let mut d = match door.lock() { Ok(g) => g, Err(p) => p.into_inner() }; match d.handle(&req) {
                    Ok(mut v) => { if let Value::Object(ref mut m) = v { m.insert("id".into(), id); m.insert("ms".into(), json!(t0.elapsed().as_secs_f64() * 1000.0)); if op == "ping" { m.insert("exe_mtime_ms".into(), json!(exe_mtime)); m.insert("tree_reads".into(), json!(d.tree_reads)); } } v }
                    Err(e) => json!({ "id": id, "error": e }),
                } };
                if writeln!(out, "{}", resp).and_then(|_| out.flush()).is_err() { break; }
                last.store(now_secs(), Ordering::Relaxed);
            }
        });
    }
    Ok(())
}
/// `pmu-onchip --door-serve --relay <sock>` — a SYNC caller's way into the daemon (C612b2: the code slot is sync node code): stdin's
/// request lines go to the socket, its answers come back on stdout. Exit 3 when no daemon answers — the caller falls back to the
/// one-shot stdin door, which holds nothing.
pub fn run_door_relay(sock: &Path) -> io::Result<()> {
    use std::io::Read;
    let mut s = match std::os::unix::net::UnixStream::connect(sock) { Ok(s) => s, Err(_) => std::process::exit(3) };
    // C612j: a relay never hangs its caller — --timeout-ms (default 30 s; a hook passes its own budget) → exit 4, the caller falls back
    let args: Vec<String> = std::env::args().collect();
    let ms: u64 = args.iter().position(|a| a == "--timeout-ms").and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(30_000);
    let _ = s.set_read_timeout(Some(std::time::Duration::from_millis(ms.max(1))));
    let _ = s.set_write_timeout(Some(std::time::Duration::from_millis(ms.max(1))));
    std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_millis(ms.max(1) + 50)); std::process::exit(4); });   // wherever it blocks, the caller is free at the deadline
    let mut input = Vec::new(); io::stdin().read_to_end(&mut input)?;
    s.write_all(&input)?; s.shutdown(std::net::Shutdown::Write)?;
    let mut out = Vec::new(); if s.read_to_end(&mut out).is_err() { std::process::exit(4); }
    io::stdout().write_all(&out)?; io::stdout().flush()
}
fn now_secs() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_rule_matches_git_grep_edges() {
        let hay = fold(b"ledger Ledger\nledgers xledger ledger_x\n(ledger)\n");
        let h = file_hits(&hay, &[fold(b"ledger")], true);
        assert_eq!(h[0], vec![1, 3]);
        let s = file_hits(b"aXa\nXX\n", &[b"X".to_vec()], false);
        assert_eq!(s[0], vec![1, 2]);
    }
    #[test]
    fn mass_op_decides_the_floor_both_rules() {
        let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
        let dense: String = (0..600).map(|_| { x ^= x << 13; x ^= x >> 7; x ^= x << 17; char::from(b'a' + (x % 26) as u8) }).collect();
        let r = mass_op(&json!({ "texts": [{ "field": "a", "text": "x".repeat(400) }, { "field": "b", "text": dense }], "floor": "gz" })).unwrap();
        assert_eq!(r["sizes"][0]["at_mass"], json!(false));
        assert_eq!(r["under"], json!(1));
        assert!(r["reason"].as_str().unwrap().starts_with("below floor: a "));
        let e = mass_op(&json!({ "texts": [{ "field": "s", "text": "  short  " }] })).unwrap();
        assert_eq!(e["sizes"][0]["chars"], json!(5));
        assert_eq!(e["floor"]["applies"], json!("entry"));
        assert!(mass_op(&json!({ "texts": [], "floor": "chars" })).is_err());
    }
    #[test]
    fn es_number_prints_as_ecmascript() {
        // each right-hand side is what node prints for String(x) / JSON.stringify(x)
        let table: [(f64, &str); 20] = [(0.0, "0"), (-0.0, "0"), (1.0, "1"), (-1.0, "-1"), (0.5, "0.5"), (100.0, "100"), (0.950873, "0.950873"),
            (0.1 + 0.2, "0.30000000000000004"), (1e21, "1e+21"), (123456789012345680000.0, "123456789012345680000"), (1e-6, "0.000001"),
            (1e-7, "1e-7"), (1.5e-10, "1.5e-10"), (2.5e25, "2.5e+25"), (5e-324, "5e-324"), (1.7976931348623157e308, "1.7976931348623157e+308"),
            (4.465847, "4.465847"), (-0.00123, "-0.00123"),
            (1669760939663944.25, "1669760939663944.2"), (1.5e-323, "1.5e-323")];   // a halfway tie goes to the even digit, as V8 prints it
        for (x, want) in table { assert_eq!(es_number(x), want, "es_number({:e})", x); }
    }
    #[test]
    fn seal_survives_a_json_round_trip() {
        // C1429: a stamp with whole-number floats (spec-200b's margin 0.0, p_null 1.0), sealed, printed by serde_json, then printed
        // again the way node's JSON.parse/JSON.stringify prints it (an integral float loses its ".0") — the seal still holds
        let st = seal_stamp(json!({ "engine": "rust", "spec_margin": { "margin": 0.0, "gap_sigma": 0.0, "p_null": 1.0, "p_floor": 0.05, "sigma": 4.465847 }, "sizes": { "intent": { "chars": 400, "gz_bytes": 300 } } }));
        let printed = serde_json::to_string(&st).unwrap();
        assert!(printed.contains("\"margin\":0.0") && printed.contains("\"p_null\":1.0"), "serde_json prints the whole-number floats with .0: {}", printed);
        let as_node = printed.replace("\"margin\":0.0", "\"margin\":0").replace("\"gap_sigma\":0.0", "\"gap_sigma\":0").replace("\"p_null\":1.0", "\"p_null\":1");
        let back: Value = serde_json::from_str(&as_node).unwrap();
        assert_eq!(seal_broken(&back), None, "the round-tripped stamp verifies");
        let mut tampered = back.clone(); tampered["spec_margin"]["p_null"] = json!(0.5);
        assert!(seal_broken(&tampered).unwrap().starts_with("signature mismatch"), "a changed value still breaks the seal");
    }
    #[test]
    fn stranger_panel_is_the_pinned_bytes_and_every_member_at_mass() {
        // C1428: the embedded panel is the file the pin names, five members (C1427's unrelated texts), each sha checked, each at mass
        let p = stranger_panel().expect("the stranger panel loads");
        let keys: Vec<&str> = p.iter().map(|m| m.key.as_str()).collect();
        assert_eq!(keys, vec!["sonnet", "exfiltration", "plumbing", "stale-orders", "poem"]);
        assert_eq!(hex_of(&Sha256::digest(STRANGER_PANEL_JSON.as_bytes()))[..16].to_string(), STRANGER_PANEL_SHA);
    }
    #[test]
    fn stranger_leg_admits_only_when_every_counted_member_is_off_domain() {
        let m = |k: &str, sha: &str, v: &str| json!({ "key": k, "sha": sha, "verdict": v, "offPct": 20 });
        let walked = json!({ "state": "WALKED", "panel_sha": STRANGER_PANEL_SHA, "kill": 25, "members": [m("a", "s1", "IN_LANE"), m("b", "s2", "OFF_DOMAIN"), m("c", "s3", "IN_LANE")] });
        let (v, s, why) = stranger_leg(Some(&walked), "spec", &[]);
        assert_eq!((v.as_str(), stranger_clause(&s).as_str()), ("IN_LANE", "stranger 2 of 3 IN_LANE"));
        assert!(why.unwrap().starts_with("stranger 2 of 3 IN_LANE"));
        // a member that is the spec's own text or a declared leg is left out of the count
        let (v, s, _) = stranger_leg(Some(&walked), "s1", &["s3".to_string()]);
        assert_eq!((v.as_str(), stranger_clause(&s).as_str()), ("OFF_DOMAIN", "stranger 0 of 1 IN_LANE"));
        assert_eq!(s["excluded"], json!(["a", "c"]));
        // not walked, or a member unmeasured, is never an admission
        assert_eq!(stranger_leg(None, "spec", &[]).0, "UNMEASURED");
        let part = json!({ "state": "WALKED", "members": [m("a", "s1", "OFF_DOMAIN"), m("b", "s2", "UNMEASURED")] });
        let (v, s, _) = stranger_leg(Some(&part), "spec", &[]);
        assert_eq!((v.as_str(), stranger_clause(&s).as_str()), ("UNMEASURED", "stranger 0 of 2 IN_LANE (1 UNMEASURED)"));
    }
    #[test]
    fn sense_theta_floor_and_grid() {
        let pairs = vec![0u64, u64::MAX, 0xFFFF];
        let sc = sense_scores(&[0u64], &pairs);
        assert_eq!(sc, vec![1.0, 0.0, 0.75]);
        let (theta, g, lit) = sense_grid(&sc, 1, 0.56);
        assert_eq!((theta, g, lit), (0.75, vec![1, 0, 1], 2));
    }
}
