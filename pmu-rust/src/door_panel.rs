// .thetacog/pmu/src/door_panel.rs — C612r THE DOOR'S LAST NODE HALF IN THE CRATE (declared from door.rs; mirrored byte-identical
// in packages/thetacog-mcp/pmu-rust/src/door_panel.rs).
//
// `{"op":"panel", …}` on `pmu-onchip --door-serve` composes the encircled panel in ONE process. C612b2 (a404e855a4) measured the door
// stage at a median 954 ms and named what still ran in node; every one of those now runs here:
//   · the pipeline (scripts/pmu/pipeline.mjs runPipeline): the two --sense spawns, --project-xor, the two --walk spawns, computeWalk,
//     σ and binarize — in-process calls of the same intentguard functions those spawns ran; the run receipt, the vectors cache and
//     the sealed post to the claud bridge (CLAUDBRIDGE_URL /epoch) leave on a background thread, so the record is kept and the panel
//     never waits on it;
//   · the claim extraction and hashing (scripts/pmu/corpus-ingest.mjs claimify · salienceRank, signature.mjs simhash with word
//     shingles) — every regex hand-matched with JS's ASCII \w / \b, its \s set and UTF-16 lengths;
//   · the competence pixel (start-pixel.mjs pickStartPixel), the seeded impostor shuffles, the ten walks (lens.rs, as C612b);
//   · the tolerance decode (triptych-render.mjs decodeDeltaThreeColourEdges) and the region detect (intentguard regions.rs, the chip
//     --regions ran — now no spawn);
//   · the ring drawing (annotate-regions.mjs encircleRegionsRgba) and the PNG (png.rs, as C612b2);
//   · the message clauses' placements (C612b2's place, folded into the same request).
// Node keeps only orchestration and the light text tail: messageClauses, the region labels (regionShortLex · coordGist · the reef
// name) and the slice of clauses into rings. PMU_DOOR_CRATE=0 is the full node path, the reference the guard holds this to.
// Sufficient for: the same panel (meta, regions, lit grids, walk matrices, png bytes) in one crate process. Not for: whether it is right.
// @guard tests/vna/c612r-the-door-node-half-in-the-crate.test.mjs
use super::{gzip_len_level, pack_bits, place_pixel, Door};
use crate::ballistic::{self, CELLS};
use base64::Engine;
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
const N: usize = 144;

// ── JS value semantics ───────────────────────────────────────────────────────────────────────────────────────────────
/// JS \s (WhiteSpace + LineTerminator): Rust's is_whitespace adds U+0085 and lacks U+FEFF.
pub fn js_ws(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}
fn js_trim(s: &str) -> &str { s.trim_matches(js_ws) }
/// s.replace(/\s+/g, ' ')
fn collapse(s: &str) -> String {
    let mut o = String::with_capacity(s.len()); let mut in_ws = false;
    for c in s.chars() { if js_ws(c) { if !in_ws { o.push(' '); in_ws = true; } } else { o.push(c); in_ws = false; } }
    o
}
fn u16len(s: &str) -> usize { s.chars().map(|c| c.len_utf16()).sum() }
#[inline] fn wc(c: char) -> bool { c.is_ascii_alphanumeric() || c == '_' }
/// Math.round — the nearest integer, ties toward +∞
pub fn js_round(x: f64) -> f64 { let f = x.floor(); if x - f >= 0.5 { f + 1.0 } else { f } }
/// pipeline.mjs round(n, d)
fn round_to(n: f64, d: i32) -> f64 { let p = 10f64.powi(d); js_round(n * p) / p }
/// +x.toFixed(d) — round half up on the exact decimal expansion (Rust's {:.d} breaks exact ties to even)
pub fn to_fixed(x: f64, d: usize) -> f64 {
    if !x.is_finite() { return x; }
    let exact = format!("{:.*}", d + 80, x.abs());
    let dot = exact.find('.').unwrap_or(exact.len());
    let tail = &exact[dot + 1 + d..];
    let tie = tail.as_bytes().first() == Some(&b'5') && tail[1..].bytes().all(|b| b == b'0');
    let mut v: f64 = format!("{:.*}", d, x.abs()).parse().unwrap_or(0.0);
    if tie { let lo: f64 = exact[..dot + 1 + d].parse().unwrap_or(0.0); let step = 10f64.powi(-(d as i32)); let up: f64 = format!("{:.*}", d, lo + step).parse().unwrap_or(v); v = up; }
    if x < 0.0 { -v } else { v }
}
/// the f64 node reads back when an f32 is serialised by serde (the shortest f32 digits, parsed as a double)
fn js_f32(x: f32) -> f64 { if !x.is_finite() { return x as f64; } serde_json::to_string(&x).ok().and_then(|s| s.parse().ok()).unwrap_or(x as f64) }
/// Number#toString
pub fn js_num(x: f64) -> String {
    if x.is_nan() { return "NaN".into(); }
    if x.is_infinite() { return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() }; }
    if x == 0.0 { return "0".into(); }
    let a = x.abs();
    if a >= 1e21 || a < 1e-6 {
        let s = format!("{:e}", x);
        if let Some(i) = s.find('e') { let (m, e) = s.split_at(i); let e = &e[1..]; return if e.starts_with('-') { format!("{}e{}", m, e) } else { format!("{}e+{}", m, e) }; }
        return s;
    }
    if x.fract() == 0.0 && a < 9.0e15 { return format!("{}", x as i64); }
    format!("{}", x)
}

// ── an ordered JSON value (the receipt keeps node's key order; serde_json's Map sorts) ────────────────────────────────
#[derive(Clone)]
pub enum J { N(f64), S(String), B(bool), Null, A(Vec<J>), O(Vec<(String, J)>) }
fn jo(v: Vec<(&str, J)>) -> J { J::O(v.into_iter().map(|(k, x)| (k.to_string(), x)).collect()) }
impl J {
    pub fn to_value(&self) -> Value {
        match self {
            J::N(x) => num_value(*x), J::S(s) => Value::String(s.clone()), J::B(b) => Value::Bool(*b), J::Null => Value::Null,
            J::A(a) => Value::Array(a.iter().map(|x| x.to_value()).collect()),
            J::O(o) => { let mut m = serde_json::Map::new(); for (k, x) in o { m.insert(k.clone(), x.to_value()); } Value::Object(m) }
        }
    }
    fn get(&self, k: &str) -> Option<&J> { if let J::O(o) = self { o.iter().find(|(kk, _)| kk == k).map(|(_, v)| v) } else { None } }
    /// JSON.stringify(x) (indent None) / JSON.stringify(x, null, 2)
    pub fn write(&self, out: &mut String, indent: Option<usize>, level: usize) {
        let nl = |out: &mut String, l: usize| { if let Some(w) = indent { out.push('\n'); for _ in 0..w * l { out.push(' '); } } };
        match self {
            J::N(x) => out.push_str(&if x.is_finite() { js_num(*x) } else { "null".into() }),
            J::S(s) => out.push_str(&serde_json::to_string(s).unwrap()),
            J::B(b) => out.push_str(if *b { "true" } else { "false" }), J::Null => out.push_str("null"),
            J::A(a) => { if a.is_empty() { out.push_str("[]"); return; } out.push('['); for (i, x) in a.iter().enumerate() { if i > 0 { out.push(','); } nl(out, level + 1); x.write(out, indent, level + 1); } nl(out, level); out.push(']'); }
            J::O(o) => { if o.is_empty() { out.push_str("{}"); return; } out.push('{'); for (i, (k, x)) in o.iter().enumerate() { if i > 0 { out.push(','); } nl(out, level + 1); out.push_str(&serde_json::to_string(k).unwrap()); out.push(':'); if indent.is_some() { out.push(' '); } x.write(out, indent, level + 1); } nl(out, level); out.push('}'); }
        }
    }
    fn from_value(v: &Value) -> J {
        match v { Value::Null => J::Null, Value::Bool(b) => J::B(*b), Value::Number(n) => J::N(n.as_f64().unwrap_or(0.0)), Value::String(s) => J::S(s.clone()),
            Value::Array(a) => J::A(a.iter().map(J::from_value).collect()), Value::Object(m) => J::O(m.iter().map(|(k, x)| (k.clone(), J::from_value(x))).collect()) }
    }
    pub fn stringify(&self, indent: Option<usize>) -> String { let mut s = String::new(); self.write(&mut s, indent, 0); s }
}
fn num_value(x: f64) -> Value { if x.is_finite() && x.fract() == 0.0 && x.abs() < 9.0e15 { Value::from(x as i64) } else { serde_json::Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null) } }
fn ja_usize(v: &[usize]) -> J { J::A(v.iter().map(|&x| J::N(x as f64)).collect()) }
fn ja_f64(v: &[f64]) -> J { J::A(v.iter().map(|&x| J::N(x)).collect()) }

// ── claims: corpus-ingest.mjs claimSegments · isSemantic · classifyClaim · looksLikeCodeSyntax · claimify · salienceRank ────────────
const MIN_CLAIM: usize = 20;
const MAX_CLAIM: usize = 400;
const BOXART: &str = "│┌┐└┘├┤┬┴┼─═╔╗╚╝╠╣╦╩╬╤╧╪▀▄█▌▐░▒▓╭╮╯╰▔▕▏◀▶➤";
const FUNCTION_WORDS: &str = "the a an is are was were be been being to of in on for with that this it as by from must not no every each who which what when where why how and or but if so because we you they he she i our your their its has have had do does did can could will would at into onto than then there here more most less least only just over under between";
const CSS_UTIL: &[&str] = &["text", "bg", "flex", "grid", "gap", "mb", "mt", "mx", "my", "ml", "mr", "px", "py", "pt", "pb", "pl", "pr", "p", "m", "w", "h", "items", "justify", "self", "font", "rounded", "border", "shadow", "space", "leading", "tracking", "max", "min", "top", "left", "right", "bottom", "z", "opacity", "hover", "sm", "md", "lg", "xl"];
const FW_MAX: f64 = 0.85;

/// text.split(/\n\s*\n/)
fn split_blank(text: &str) -> Vec<String> {
    let cs: Vec<char> = text.chars().collect(); let mut out = Vec::new(); let (mut start, mut i) = (0usize, 0usize);
    while i < cs.len() {
        if cs[i] == '\n' {
            let mut j = i + 1; let mut last = None;
            while j < cs.len() && js_ws(cs[j]) { if cs[j] == '\n' { last = Some(j); } j += 1; }
            if let Some(l) = last { out.push(cs[start..i].iter().collect()); start = l + 1; i = l + 1; continue; }
        }
        i += 1;
    }
    out.push(cs[start..].iter().collect());
    out
}
fn starts_kw(cs: &[char], q: usize, kws: &[&str]) -> bool {
    kws.iter().any(|k| { let kc: Vec<char> = k.chars().collect(); q + kc.len() <= cs.len() && cs[q..q + kc.len()] == kc[..] && (q + kc.len() == cs.len() || !wc(cs[q + kc.len()])) })
}
/// /[{};=]|=>|^\s{2,}\S|^\s*(function|const|let|fn|impl|pub|class|import|export)\b/m
fn looks_code_block(b: &str) -> bool {
    if b.chars().any(|c| matches!(c, '{' | '}' | ';' | '=')) { return true; }
    let cs: Vec<char> = b.chars().collect();
    let mut starts = vec![0usize];
    for (i, &c) in cs.iter().enumerate() { if matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}') { starts.push(i + 1); } }
    for p in starts {
        if p > cs.len() { continue; }
        let mut q = p; while q < cs.len() && js_ws(cs[q]) { q += 1; }
        if q - p >= 2 && q < cs.len() { return true; }
        if starts_kw(&cs, q, &["function", "const", "let", "fn", "impl", "pub", "class", "import", "export"]) { return true; }
    }
    false
}
/// s.replace(/\s+/g,' ').split(/(?<=[.!?])\s+(?=[A-Z(`"#-])/)
fn by_sentence(s: &str) -> Vec<String> {
    let t: Vec<char> = collapse(s).chars().collect(); let mut out = Vec::new(); let mut start = 0;
    for i in 0..t.len() {
        if t[i] == ' ' && i > 0 && matches!(t[i - 1], '.' | '!' | '?') && i + 1 < t.len() && (t[i + 1].is_ascii_uppercase() || matches!(t[i + 1], '(' | '`' | '"' | '#' | '-')) {
            out.push(t[start..i].iter().collect()); start = i + 1;
        }
    }
    out.push(t[start..].iter().collect());
    out
}
pub fn claim_segments(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for block in split_blank(text) {
        let b = js_trim(&block); if b.is_empty() { continue; }
        let code = looks_code_block(b);
        let parts: Vec<String> = if code { b.split('\n').map(String::from).collect() } else { by_sentence(b) };
        for part in parts {
            let c = js_trim(&collapse(&part)).to_string(); if c.is_empty() { continue; }
            if code && u16len(&c) > MAX_CLAIM { for s in by_sentence(&c) { let t = js_trim(&s); if !t.is_empty() { out.push(t.to_string()); } } continue; }
            out.push(c);
        }
    }
    out
}
/// c.replace(/<[^>]+>/g, ' ')
fn strip_tags(c: &str) -> String {
    let cs: Vec<char> = c.chars().collect(); let mut o = String::with_capacity(c.len()); let mut i = 0;
    while i < cs.len() {
        if cs[i] == '<' { if let Some(off) = cs[i + 1..].iter().position(|&x| x == '>') { if off >= 1 { o.push(' '); i = i + 1 + off + 1; continue; } } }
        o.push(cs[i]); i += 1;
    }
    o
}
pub fn is_semantic(c: &str) -> bool {
    if c.is_empty() { return false; }
    if c.chars().any(|x| BOXART.contains(x)) { return false; }
    let cs: Vec<char> = c.chars().collect();
    for i in 0..cs.len() {
        let at = |s: &str| { let sc: Vec<char> = s.chars().collect(); i + sc.len() <= cs.len() && cs[i..i + sc.len()] == sc[..] };
        if at("<path") && cs.get(i + 5).map(|&x| js_ws(x) || x == '>').unwrap_or(false) { return false; }
        if at("<svg") { return false; }
        if at("d=\"M") && (i == 0 || !wc(cs[i - 1])) && cs.get(i + 4).map(|&x| x.is_ascii_digit() || x == '.' || x == '-' || x == ' ').unwrap_or(false) { return false; }
    }
    let t = js_trim(&collapse(&strip_tags(c))).to_string();
    if t.is_empty() { return false; }
    let letters = t.chars().filter(|x| x.is_ascii_alphabetic()).count();
    if (letters as f64) / (u16len(&t) as f64) < 0.45 { return false; }
    let tc: Vec<char> = t.chars().collect(); let (mut i, mut words) = (0usize, 0usize);
    while i < tc.len() {
        if tc[i].is_ascii_alphabetic() { let mut j = i + 1; while j < tc.len() && (tc[j].is_ascii_alphabetic() || tc[j] == '\'' || tc[j] == '-') { j += 1; } if j - i - 1 >= 2 { words += 1; i = j; continue; } }
        i += 1;
    }
    words >= 4
}
fn is_camel(w: &[char]) -> bool {
    let mut i = 0; while i < w.len() && w[i].is_ascii_lowercase() { i += 1; } if i == 0 { return false; }
    let mut groups = 0;
    while i < w.len() { if !w[i].is_ascii_uppercase() { return false; } i += 1; let s = i; while i < w.len() && (w[i].is_ascii_lowercase() || w[i].is_ascii_digit()) { i += 1; } if i == s { return false; } groups += 1; }
    groups >= 1
}
fn is_kebab(w: &str) -> bool { let parts: Vec<&str> = w.split('-').collect(); parts.len() >= 2 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())) }
fn css_util(lw: &str) -> bool { CSS_UTIL.iter().any(|p| lw.len() > p.len() && lw.starts_with(p) && lw.as_bytes()[p.len()] == b'-') }
pub fn classify_meaning(c: &str) -> bool {
    let low: Vec<char> = c.to_lowercase().chars().collect(); let mut toks: Vec<String> = Vec::new(); let mut i = 0;
    while i < low.len() {
        if low[i].is_ascii_lowercase() {
            let mut j = i + 1; let mut last = None;
            while j < low.len() && (low[j].is_ascii_lowercase() || low[j] == '\'' || low[j] == '-') { if low[j].is_ascii_lowercase() { last = Some(j); } j += 1; }
            let end = last.unwrap_or(i); toks.push(low[i..=end].iter().collect()); i = end + 1; continue;
        }
        i += 1;
    }
    if toks.is_empty() { return false; }
    let fws: HashSet<&str> = FUNCTION_WORDS.split(' ').collect();
    let fw = toks.iter().filter(|t| fws.contains(t.as_str())).count() as f64 / toks.len() as f64;
    let cs: Vec<char> = c.chars().collect(); let mut raw: Vec<Vec<char>> = Vec::new(); let mut i = 0;
    while i < cs.len() {
        if cs[i].is_ascii_alphabetic() { let mut j = i + 1; while j < cs.len() && (cs[j].is_ascii_alphanumeric() || cs[j] == '\'' || cs[j] == '-') { j += 1; } if j - i - 1 >= 1 { raw.push(cs[i..j].to_vec()); i = j; continue; } }
        i += 1;
    }
    let soup = if raw.is_empty() { 1.0 } else { raw.iter().filter(|w| { let s: String = w.iter().collect(); is_camel(w) || is_kebab(&s) || css_util(&s.to_lowercase()) }).count() as f64 / raw.len() as f64 };
    fw >= 0.12 && fw <= FW_MAX && soup < 0.5
}
pub fn looks_like_code(c: &str) -> bool {
    let s = js_trim(c); if s.is_empty() { return false; }
    let cs: Vec<char> = s.chars().collect(); let n = cs.len();
    let decl = ["const", "let", "var", "function", "fn", "impl", "struct", "enum", "trait", "class", "def", "func", "interface", "type", "import", "require", "package", "module", "namespace"];
    if starts_kw(&cs, 0, &decl) { return true; }
    for m in ["export", "public", "private", "protected", "async", "pub", "static"] {
        let mc: Vec<char> = m.chars().collect();
        if n > mc.len() && cs[..mc.len()] == mc[..] && js_ws(cs[mc.len()]) { let mut q = mc.len(); while q < n && js_ws(cs[q]) { q += 1; } if starts_kw(&cs, q, &decl) { return true; } }
    }
    let ctrl = ["if", "for", "while", "switch", "catch", "elif", "fi", "then", "do", "done", "esac", "case", "else"];
    for k in ctrl { let kc: Vec<char> = k.chars().collect(); if n >= kc.len() && cs[..kc.len()] == kc[..] && (kc.len() == n || !wc(cs[kc.len()])) { let mut q = kc.len(); while q < n && js_ws(cs[q]) { q += 1; } if q < n && matches!(cs[q], '(' | '{' | '[') { return true; } } }
    if starts_kw(&cs, 0, &["elif", "fi", "then", "done", "esac"]) { return true; }
    if starts_kw(&cs, 0, &["echo", "printf", "cat", "grep", "sed", "awk", "chmod", "mkdir", "jq", "curl", "node", "npm", "npx", "git"]) { return true; }
    // CODE_SIGNALS
    for t in ["=>", "===", "!==", "&&", "||", "${", "$(", ">&", "::", "2>&1"] { if s.contains(t) { return true; } }
    let last = cs[n - 1];
    if matches!(last, ';' | '{' | '}' | ',' | ':') { return true; }
    if matches!(cs[0], '}' | ']' | ')') { return true; }
    let bnd = |i: usize| i == 0 || !wc(cs[i - 1]);
    let at = |i: usize, w: &str| { let wc_: Vec<char> = w.chars().collect(); i + wc_.len() <= n && cs[i..i + wc_.len()] == wc_[..] };
    for i in 0..n {
        let c = cs[i];
        if c == '$' && cs.get(i + 1).map(|&x| x.is_ascii_alphabetic() || x == '_').unwrap_or(false) { return true; }
        if at(i, "exit") && bnd(i) { let mut q = i + 4; while q < n && js_ws(cs[q]) { q += 1; } if q > i + 4 && q < n && cs[q].is_ascii_digit() { return true; } }
        if at(i, "process.env") && bnd(i) && (i + 11 == n || !wc(cs[i + 11])) { return true; }
        if c == ')' { let mut q = i + 1; while q < n && js_ws(cs[q]) { q += 1; } if q < n && cs[q] == '{' { return true; } }
        if wc(c) && bnd(i) {
            let mut j = i; while j < n && wc(cs[j]) { j += 1; }
            let mut q = j; while q < n && js_ws(cs[q]) { q += 1; }
            if q < n && cs[q] == '=' { let mut r = q + 1; let s0 = r; while r < n && js_ws(cs[r]) { r += 1; } if r - s0 >= 1 || (r < n && cs[r] != '=') { return true; } }
        }
        if c == '\'' || c == '"' {
            let mut j = i + 1; let mut units = 0usize;
            while j < n && cs[j] != '\'' && cs[j] != '"' { units += cs[j].len_utf16(); j += 1; }
            if j < n && units <= 40 && cs[j] == c { let mut q = j + 1; while q < n && js_ws(cs[q]) { q += 1; } if q < n && cs[q] == ',' { return true; } }
        }
        if at(i, "console.") && bnd(i) { for w in ["log", "error", "warn"] { let e = i + 8 + w.len(); if at(i + 8, w) && (e == n || !wc(cs[e])) { return true; } } }
        if bnd(i) { for w in ["readFileSync", "writeFileSync", "readdirSync", "querySelector", "addEventListener"] { let e = i + w.len(); if at(i, w) && (e == n || !wc(cs[e])) { return true; } } }
    }
    let punct = cs.iter().filter(|&&x| "(){}[];=<>|&/\\".contains(x)).count();
    (punct as f64) / (u16len(s) as f64) > 0.10
}
pub fn claimify(text: &str) -> Vec<String> {
    claim_segments(text).into_iter().filter(|c| { let l = u16len(c); l >= MIN_CLAIM && l <= MAX_CLAIM && is_semantic(c) && !looks_like_code(c) }).collect()
}

// ── C1270: the diff-kind reality path ─────────────────────────────────────────────────────────────────────────────────────
// claimify keeps prose: a segment that looks like code, or runs past MAX_CLAIM, is dropped. A unified diff is almost nothing but
// those, so a diff handed in as reality collapsed to one claim and the reality grid was built from almost nothing (04 §R4: one
// fragment on 27 of 27 diffs; an appended hunk moved no cell). When the request says `reality_kind:"diff"`, the reality side reads
// HUNK-LEVEL claims instead: each run of consecutive added (or removed) lines in one hunk becomes claims of the form
// "added in <path words> <hunk context words>: <the run's words>", where every identifier is split into its words (camelCase,
// snake_case, kebab-case) and punctuation is dropped. Pure, deterministic, LLM-free; the prose path (no kind, or "prose") is
// byte-for-byte what it was. Sufficient for: the shape-match side reads what a diff changed and where. Not for: whether the change
// was good (Rice), nor which statistic gates.
// @guard tests/vna/c1270-the-cole-walk-reads-the-appended-hunk.test.mjs
/// split code into lower-case words: identifiers at camelCase / snake_case / kebab / digit boundaries; tokens under 2 letters dropped
pub fn code_words(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let cs: Vec<char> = line.chars().collect(); let mut i = 0;
    while i < cs.len() {
        if !cs[i].is_ascii_alphabetic() { i += 1; continue; }
        // an apostrophe stays only inside a word (don't), never as a quote around one ('alerts')
        let mut j = i; while j < cs.len() && (cs[j].is_ascii_alphanumeric() || cs[j] == '_' || (cs[j] == '\'' && cs[j - 1].is_ascii_alphabetic() && cs.get(j + 1).map(|x| x.is_ascii_alphabetic()).unwrap_or(false))) { j += 1; }
        // split the token [i, j) at '_', digits and case boundaries
        let tok = &cs[i..j]; let mut w = String::new();
        let push = |w: &mut String, out: &mut Vec<String>| { if w.chars().filter(|c| c.is_ascii_alphabetic()).count() >= 2 { out.push(w.to_ascii_lowercase()); } w.clear(); };
        for k in 0..tok.len() {
            let c = tok[k];
            if !c.is_ascii_alphabetic() && c != '\'' { push(&mut w, &mut out); continue; }
            if c.is_ascii_uppercase() && !w.is_empty() {
                let prev = tok[k - 1]; let next_lower = tok.get(k + 1).map(|x| x.is_ascii_lowercase()).unwrap_or(false);
                if prev.is_ascii_lowercase() || (prev.is_ascii_uppercase() && next_lower) { push(&mut w, &mut out); }
            }
            w.push(c);
        }
        push(&mut w, &mut out);
        i = j;
    }
    out
}
fn path_words(p: &str) -> String {
    let base = p.rsplit_once('.').filter(|(a, b)| !a.is_empty() && !b.contains('/') && b.len() <= 5).map(|(a, _)| a).unwrap_or(p);
    code_words(base).join(" ")
}
/// the hunk-level claims of a unified diff (`git show --format= --unified=N`), in diff order, each 20..=400 UTF-16 units; any text
/// that is not diff structure (a message, a paragraph of prose between or after the hunks) is read by claimify, as the prose path reads it
pub fn diff_claims(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new(); let mut prose = String::new();
    let (mut path, mut ctx) = (String::new(), String::new());
    let mut run: Vec<String> = Vec::new(); let mut sign = ' ';
    let flush = |run: &mut Vec<String>, sign: char, path: &str, ctx: &str, out: &mut Vec<String>| {
        if run.is_empty() { return; }
        let verb = if sign == '+' { "added in" } else { "removed from" };
        let head = { let mut h = [verb, path, ctx].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<&str>>().join(" "); h.push(':'); h };
        let mut cur = head.clone();
        for w in run.iter().flat_map(|l| l.split(' ')) {
            if w.is_empty() { continue; }
            if u16len(&cur) + 1 + u16len(w) > MAX_CLAIM && cur != head { out.push(std::mem::replace(&mut cur, head.clone())); }
            cur.push(' '); cur.push_str(w);
        }
        if cur != head && u16len(&cur) >= MIN_CLAIM { out.push(cur); }
        run.clear();
    };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            flush(&mut run, sign, &path, &ctx, &mut out);
            let b = rest.rsplit(" b/").next().unwrap_or(rest);
            path = path_words(b); ctx.clear(); continue;
        }
        if line.starts_with("+++ ") || line.starts_with("--- ") || line.starts_with("index ") || line.starts_with("new file mode") || line.starts_with("deleted file mode")
            || line.starts_with("old mode") || line.starts_with("new mode") || line.starts_with("similarity index") || line.starts_with("rename ") || line.starts_with("Binary files") || line.starts_with("\\ No newline") {
            flush(&mut run, sign, &path, &ctx, &mut out); continue;
        }
        if line.starts_with("@@") {
            flush(&mut run, sign, &path, &ctx, &mut out);
            ctx = line.splitn(3, "@@").nth(2).map(|t| code_words(t).join(" ")).unwrap_or_default(); continue;
        }
        let s = match line.chars().next() {
            Some(c @ ('+' | '-')) => c,
            Some(' ') if !path.is_empty() => { flush(&mut run, sign, &path, &ctx, &mut out); continue; }   // a context line: unchanged
            _ => { flush(&mut run, sign, &path, &ctx, &mut out); prose.push_str(line); prose.push('\n'); continue; }
        };
        if s != sign { flush(&mut run, sign, &path, &ctx, &mut out); sign = s; }
        let words = code_words(&line[1..]);
        if !words.is_empty() { run.push(words.join(" ")); }
    }
    flush(&mut run, sign, &path, &ctx, &mut out);
    out.extend(claimify(&prose));
    out
}
/// the diff side's 160 kept: the hunk claims de-duplicated and SORTED, so the kept set does not depend on the order the hunks arrive in
/// (an appended hunk and the same hunk prepended read the same), then ranked as salienceRank ranks (rank_ncd) straight to 160, so a
/// large diff keeps its most distinct claims rather than its first; the prose filters are skipped (they exist to drop code)
pub fn diff_ranked(text: &str) -> Vec<String> {
    let mut uniq: Vec<String> = diff_claims(text).into_iter().collect::<HashSet<String>>().into_iter().collect();
    uniq.sort();
    rank_ncd(uniq, 160)
}
/// cell-compress.mjs ncd (gzipSync at node's default level); C(b) is the fixed reference sample's, computed once by the caller
fn ncd_node(a: &str, b: &str, cb: f64) -> f64 {
    let ca = gzip_len_level(a.as_bytes(), -1) as f64;
    let mut ab = String::with_capacity(a.len() + b.len() + 1); ab.push_str(a); ab.push('\n'); ab.push_str(b);
    let cab = gzip_len_level(ab.as_bytes(), -1) as f64;
    let mx = ca.max(cb); if mx == 0.0 { return 0.0; } let d = (cab - ca.min(cb)) / mx; if d < 0.0 { 0.0 } else { d }
}
pub fn salience_rank(claims: Vec<String>, limit: usize) -> Vec<String> {
    let mut seen = HashSet::new(); let mut uniq = Vec::new();
    for c in claims.into_iter().filter(|c| is_semantic(c) && classify_meaning(c)) { if seen.insert(c.clone()) { uniq.push(c); } }
    rank_ncd(uniq, limit)
}
/// salienceRank's ranking half, on claims already kept and de-duplicated: under the limit they pass in order; over it the ones
/// farthest (gzip NCD) from the first ten's sample are kept
fn rank_ncd(uniq: Vec<String>, limit: usize) -> Vec<String> {
    if uniq.len() <= limit { return uniq; }
    const HARD_CAP: usize = 6000;
    let pool: Vec<String> = if uniq.len() > HARD_CAP { let stride = uniq.len() as f64 / HARD_CAP as f64; (0..HARD_CAP).map(|i| uniq[(i as f64 * stride).floor() as usize].clone()).collect() } else { uniq };
    let sample = pool.iter().take(10).cloned().collect::<Vec<_>>().join(" ");
    let cb = gzip_len_level(sample.as_bytes(), -1) as f64;
    let mut scored: Vec<(usize, f64)> = pool.par_iter().enumerate().map(|(i, c)| (i, if sample.is_empty() { 1.0 } else { ncd_node(c, &sample, cb) })).collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().take(limit).map(|(i, _)| pool[i].clone()).collect()
}
/// triptych-build.mjs: fewer than 8 unique [a-z0-9] tokens is degenerate text
fn degenerate(text: &str) -> bool {
    let low = text.to_lowercase(); let set: HashSet<&str> = low.split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit())).filter(|w| !w.is_empty()).collect();
    set.len() < 8
}

// ── the held library (the 144 anchors, their gzip lengths, the pair signatures, the directed connectivity) ─────────────────
pub struct Lib {
    sorted: Vec<(String, String, String)>,   // (coord, row, snippet) in pipeline.mjs getSortedAnchors order
    target_lens: Vec<usize>,
    raw_aligned: bool, missing: Option<String>,
    coords: Vec<String>,                      // definer-walk-144.mjs COORDS
    node_text: Vec<String>,
    pair_cells: Vec<(String, String)>,        // region-message.mjs loadPairLib
}
const RANKS: [&str; 12] = ["A", "B", "C", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
fn load_lib(p: &Path) -> Result<Lib, String> {
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(p).map_err(|e| format!("panel lib {}: {}", p.display(), e))?).map_err(|e| format!("panel lib json: {}", e))?;
    let arr: Vec<Value> = raw.as_array().cloned().or_else(|| raw.get("anchors").or_else(|| raw.get("nodes")).and_then(|v| v.as_array()).cloned()).unwrap_or_default();
    let s = |a: &Value, k: &str| a.get(k).and_then(|v| v.as_str()).map(String::from);
    let mut sorted = Vec::new(); let (mut raw_aligned, mut missing) = (true, None);
    for r1 in RANKS { for r2 in RANKS {
        match arr.iter().find(|a| a.get("row").and_then(|v| v.as_str()) == Some(r1) && a.get("col").and_then(|v| v.as_str()) == Some(r2)) {
            Some(a) => sorted.push((s(a, "coord").unwrap_or_default(), r1.to_string(), match a.get("snippet") { Some(Value::String(x)) => x.clone(), Some(Value::Null) | None => String::new(), Some(o) => o.to_string() })),
            None => { if raw_aligned { raw_aligned = false; missing = Some(format!("{},{}", r1, r2)); } }
        }
    } }
    let target_lens = sorted.iter().map(|(_, _, sn)| gzip_len_level(sn.as_bytes(), -1)).collect();
    let coords = crate::lens::library_coords(p)?;
    let node_text = coords.iter().map(|c| arr.iter().find(|t| t.get("coord").and_then(|v| v.as_str()) == Some(c.as_str())).and_then(|t| t.get("snippet")).map(|v| match v { Value::String(x) => x.clone(), Value::Null => String::new(), o => o.to_string() }).unwrap_or_default()).collect();
    let pair_cells = arr.iter().filter_map(|c| { let co = c.get("coord").and_then(|v| v.as_str())?; let sn = c.get("snippet").and_then(|v| v.as_str())?; if co.is_empty() || sn.is_empty() { return None; } Some((js_trim(co).to_string(), sn.to_string())) }).collect();
    Ok(Lib { sorted, target_lens, raw_aligned, missing, coords, node_text, pair_cells })
}
#[derive(Default)]
pub struct Held { libs: HashMap<String, Arc<Lib>>, conn: HashMap<String, Arc<Vec<f64>>>, pending: Vec<std::thread::JoinHandle<()>> }
impl Held {
    /// the background record threads (receipt, vectors, bridge post) — the one-shot door waits for them before it exits
    pub fn join_pending(&mut self) { for h in self.pending.drain(..) { let _ = h.join(); } }
}

// ── the pipeline (pipeline.mjs runPipeline, the commit-scoped path) ──────────────────────────────────────────────────────
struct State { threshold: Value, sigma_floor: f64, primary_lens: Option<String>, walk_mode: String }
fn load_state(p: &Path) -> Result<State, String> {
    let s: Value = match std::fs::read_to_string(p) { Ok(t) => serde_json::from_str(&t).map_err(|e| format!("state json: {}", e))?, Err(_) => json!({}) };
    Ok(State {
        threshold: match s.get("threshold") { None => json!("1σ"), Some(v) => v.clone() },
        sigma_floor: s.get("sigma_floor").and_then(|v| v.as_f64()).unwrap_or(3.4),
        primary_lens: s.get("primary_lens").and_then(|v| v.as_str()).filter(|x| !x.is_empty()).map(String::from),
        walk_mode: s.get("walk_mode").and_then(|v| v.as_str()).filter(|x| !x.is_empty()).unwrap_or("traversal").to_string(),
    })
}
struct Bin { bits: Vec<u8>, method: String, cutoff: f64, mean: f64, std: f64 }
fn parse_float_prefix(s: &str) -> f64 {
    let mut end = 0; let mut dot = false; let b = s.as_bytes();
    while end < b.len() { if b[end].is_ascii_digit() { end += 1; } else if b[end] == b'.' && !dot { dot = true; end += 1; } else { break; } }
    let t = &s[..end]; if t == "." || t.is_empty() { return f64::NAN; } t.parse().unwrap_or(f64::NAN)
}
/// pipeline.mjs binarizeByThreshold
fn binarize(scores: &[f64], threshold: &Value) -> Bin {
    let n = scores.len(); let mean = scores.iter().fold(0.0, |a, b| a + b) / (if n == 0 { 1.0 } else { n as f64 });
    let std = (scores.iter().fold(0.0, |a, b| a + (b - mean).powi(2)) / (if n == 0 { 1.0 } else { n as f64 })).sqrt();
    let mut bits = vec![0u8; n];
    let raw = match threshold { Value::Null => "auto".to_string(), Value::String(s) => s.clone(), Value::Number(x) => js_num(x.as_f64().unwrap_or(0.0)), Value::Bool(b) => b.to_string(), o => o.to_string() };
    let s = js_trim(&raw).to_lowercase();
    let (method, cutoff);
    let top = s.strip_prefix("top").map(|r| r.strip_prefix('-').unwrap_or(r)).filter(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_digit()));
    let sig = { let mut it = s.char_indices(); let mut e = 0; while let Some((i, c)) = it.next() { if c.is_ascii_digit() || c == '.' { e = i + c.len_utf8(); } else { break; } }
        if e == 0 { None } else { let rest = s[e..].trim_start_matches(js_ws); if rest == "σ" || rest == "s" || rest == "sigma" { Some(&s[..e]) } else { None } } };
    let flo = { let ok = (|| { let b = s.as_bytes(); if b.is_empty() { return false; }
        // ^(0?\.\d+|[01](?:\.\d+)?)$
        let alt1 = { let r = s.strip_prefix('0').unwrap_or(&s); r.len() >= 2 && r.starts_with('.') && r[1..].bytes().all(|c| c.is_ascii_digit()) } || { s.len() >= 2 && s.starts_with('.') && s[1..].bytes().all(|c| c.is_ascii_digit()) };
        let alt2 = (b[0] == b'0' || b[0] == b'1') && (b.len() == 1 || (b.len() >= 3 && b[1] == b'.' && s[2..].bytes().all(|c| c.is_ascii_digit())));
        alt1 || alt2 })(); if ok { Some(s.clone()) } else { None } };
    if let Some(k) = top {
        let k = (k.parse::<usize>().unwrap_or(0)).min(n);
        let mut ranked: Vec<(f64, usize)> = scores.iter().enumerate().map(|(i, &v)| (v, i)).collect();
        ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)); ranked.truncate(k);
        for r in &ranked { bits[r.1] = 1; }
        cutoff = ranked.last().map(|r| r.0).unwrap_or(1.0); method = format!("top-{}", k);
    } else if let Some(m) = sig {
        let nsig = parse_float_prefix(m); cutoff = mean + nsig * std;
        for i in 0..n { if scores[i] >= cutoff { bits[i] = 1; } } method = format!("{}σ", js_num(nsig));
    } else if let Some(f) = flo {
        cutoff = parse_float_prefix(&f); for i in 0..n { if scores[i] >= cutoff { bits[i] = 1; } } method = format!("floor {}", js_num(cutoff));
    } else {
        cutoff = mean + std; for i in 0..n { if scores[i] >= cutoff { bits[i] = 1; } } method = "1σ (auto)".into();
    }
    Bin { bits, method, cutoff, mean, std }
}
fn lit_indices(bits: &[u8]) -> Vec<usize> { bits.iter().enumerate().filter(|(_, &b)| b != 0).map(|(i, _)| i).collect() }
struct SenseSide { scores: Vec<f64>, claim_map: J, bin: Bin, agree: usize, distinct: usize }
fn sense_side(claims: &[String], lib: &Lib, lens_gzip: bool) -> SenseSide {
    let targets: Vec<String> = lib.sorted.iter().map(|x| x.2.clone()).collect();
    let out = crate::sense::sense_lattice(claims, &targets, &lib.target_lens, false, crate::signature::ShingleMode::Char);
    let scores: Vec<f64> = out.rows.iter().map(|r| js_f32(r.score)).collect();
    let ncd: Vec<f64> = out.rows.iter().map(|r| js_f32(r.ncd)).collect();
    let primary = if lens_gzip && ncd.len() == scores.len() { ncd.clone() } else { scores.clone() };
    struct Cm { claim: String, frag: f64, ncd: f64, agree: bool, assigned: bool, sim: Option<f64> }
    let mut cm: Vec<Cm> = lib.sorted.iter().enumerate().map(|(i, _)| Cm { claim: "(no distinctive match)".into(), frag: scores.get(i).copied().unwrap_or(0.0), ncd: ncd.get(i).copied().unwrap_or(0.0), agree: out.rows.get(i).map(|r| r.agreement).unwrap_or(false), assigned: false, sim: None }).collect();
    // a claim map is keyed by coord: a repeated coord keeps the LAST anchor's entry object (anchors.forEach overwrites), and claims vote into it
    let mut slot_of: HashMap<String, usize> = HashMap::new(); for (i, a) in lib.sorted.iter().enumerate() { slot_of.insert(a.0.clone(), i); }
    for (j, &ai) in out.claim_best_anchor.iter().enumerate() {
        let Some(a) = lib.sorted.get(ai) else { continue }; let k = slot_of[&a.0];
        let s = out.claim_best_score.get(j).map(|&x| js_f32(x)).unwrap_or(0.0);
        let cur = &mut cm[k];
        if !cur.assigned || s > cur.sim.unwrap_or(f64::NAN) { cur.claim = claims.get(j).cloned().unwrap_or_else(|| "(no match)".into()); cur.sim = Some(s); cur.assigned = true; }
    }
    let mut order: Vec<String> = Vec::new(); let mut seen = HashSet::new(); for a in &lib.sorted { if seen.insert(a.0.clone()) { order.push(a.0.clone()); } }
    let claim_map = J::O(order.iter().map(|co| { let c = &cm[slot_of[co]]; let mut o = vec![("claim", J::S(c.claim.clone())), ("frag_sim", J::N(c.frag)), ("ncd", J::N(c.ncd)), ("witness_agree", J::B(c.agree)), ("assigned", J::B(c.assigned))]; if let Some(s) = c.sim { o.push(("assign_sim", J::N(s))); } (co.clone(), jo(o)) }).collect());
    let distinct = { let mut s = HashSet::new(); for co in &order { let c = &cm[slot_of[co]]; if c.assigned { s.insert(c.claim.clone()); } } s.len() };
    let bin = binarize(&primary, &Value::Null); // placeholder, replaced by the caller's threshold
    SenseSide { scores: primary, claim_map, bin, agree: out.rows.iter().filter(|r| r.agreement).count(), distinct }
}
/// main.rs run_walk, in-process: the ballistic walk of one packed grid → the f32 heat
fn hardware_walk(grid: &[u8], decay: f64, depth: usize, mode: &str) -> Vec<f32> {
    let mut g = [0u8; CELLS]; g.copy_from_slice(&grid[..CELLS]);
    let mut opts = ballistic::WalkOpts::default(); opts.decay_factor = decay; opts.max_depth = depth;
    let frames = ballistic::ballistic_walk_all(&g, &opts);
    let mut heat = vec![0.0f32; CELLS];
    for frame in frames { for (&idx, &w) in frame.visits.iter() { heat[idx] += w as f32; } }
    if mode == "diffusion" { crate::diffuse(&mut heat, 144, depth.max(1), (decay as f32) * 0.3); } else if mode == "converged" { crate::converge(&mut heat, 144, (decay as f32) * 0.3); }
    heat
}
fn f32_b64(v: &[f32]) -> String { let mut b = Vec::with_capacity(v.len() * 4); for x in v { b.extend_from_slice(&x.to_le_bytes()); } B64.encode(b) }
fn iso_now() -> (String, u128) {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default(); let ms = d.as_millis();
    let secs = (ms / 1000) as i64; let days = secs.div_euclid(86400); let sod = secs.rem_euclid(86400);
    let z = days + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097; let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153; let dd = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", if m <= 2 { y + 1 } else { y }, m, dd, sod / 3600, (sod / 60) % 60, sod % 60, ms % 1000), ms)
}
fn rand_hex8() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher(); h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)); h.write_u32(std::process::id());
    format!("{:08x}", h.finish() as u32)
}
pub struct Pipe { pub stages: Vec<(String, J)>, pub walk: J, pub xor: J, pub sense: J, pub intent_heat: Vec<f32>, run_id: String, started: String, vectors: J, seal: J }

#[allow(clippy::too_many_arguments)]
fn run_pipeline(lib: &Lib, st: &State, intent: &str, reality: &str, labels: (&str, &str), mass_floor: Option<f64>, lens_env: Option<&str>, unplaced: f64) -> Result<Pipe, String> {
    let t0 = std::time::Instant::now();
    let el = || js_round(t0.elapsed().as_secs_f64() * 1000.0 * 100.0) / 100.0;
    let (started, _) = iso_now();
    let run_id = format!("run-{}-{}", started.replace([':', '.'], "-"), rand_hex8());
    let mut stages: Vec<(String, J)> = Vec::new();
    let rec = |stages: &mut Vec<(String, J)>, name: &str, ms: f64, body: Vec<(&str, J)>| { let mut o = vec![("ok", J::B(true)), ("elapsed_ms", J::N(ms))]; o.extend(body); stages.push((name.to_string(), jo(o))); };
    rec(&mut stages, "resolve", el(), vec![("intent", jo(vec![("kind", J::S("commit".into())), ("value", J::S(labels.0.into())), ("len", J::N(u16len(intent) as f64))])), ("reality", jo(vec![("kind", J::S("commit".into())), ("value", J::S(labels.1.into())), ("len", J::N(u16len(reality) as f64))])), ("warm", J::B(false)), ("scoped", J::B(true))]);
    // INVARIANTS — the admissibility mass is the intent corpus gzipped at node's default level, the same bytes pipeline.mjs gz() counts (C612s: it read 0 until both sides were fixed together)
    let mut checks = vec![
        jo(vec![("name", J::S("144 anchors ShortLex-aligned".into())), ("ok", J::B(lib.raw_aligned)), ("detail", J::S(if lib.raw_aligned { "A,B,C,A1…C3,C3".into() } else { format!("missing {}", lib.missing.clone().unwrap_or_default()) }))]),
        jo(vec![("name", J::S("anchor count = 144".into())), ("ok", J::B(lib.sorted.len() == 144)), ("detail", J::S(format!("{}", lib.sorted.len())))]),
        jo(vec![("name", J::S("intent corpus non-empty".into())), ("ok", J::B(!intent.is_empty())), ("detail", J::S(format!("{} chars", u16len(intent))))]),
    ];
    let intent_mass = gzip_len_level(intent.as_bytes(), -1) as f64;
    let admissible = mass_floor.map(|f| intent_mass >= f);
    checks.push(jo(vec![("name", J::S("intent corpus clears the mass floor".into())), ("ok", J::B(admissible == Some(true))), ("detail", J::S(match mass_floor { None => "UNMEASURED — canonical floor unresolved (packages/thetacog-mcp/scripts/tape/physics.mjs)".into(), Some(f) => format!("{} gzip bytes vs floor {}{}", js_num(intent_mass), js_num(f), if admissible == Some(true) { "" } else { " — READING IS LENGTH-DOMINATED, not drift" }) }))]));
    rec(&mut stages, "admissibility", el(), vec![("intent_gzip_bytes", J::N(intent_mass)), ("mass_floor", mass_floor.map(J::N).unwrap_or(J::Null)), ("admissible", admissible.map(J::B).unwrap_or(J::Null))]);
    checks.push(jo(vec![("name", J::S("reality corpus non-empty".into())), ("ok", J::B(!reality.is_empty())), ("detail", J::S(format!("{} chars", u16len(reality))))]));
    let okc = checks.iter().filter(|c| matches!(c.get("ok"), Some(J::B(true)))).count();
    let nck = checks.len();
    rec(&mut stages, "invariants", el(), vec![("checks", J::A(checks)), ("ok_count", J::N(okc as f64)), ("total", J::N(nck as f64))]);
    // SENSE (both sides at once — the two --sense spawns)
    let lens = lens_env.map(String::from).or_else(|| st.primary_lens.clone()).unwrap_or_else(|| "gzip".into());
    let split = |t: &str| -> Vec<String> { t.split("\n\n").filter(|s| u16len(js_trim(s)) > 20).map(String::from).collect() };
    let (ci, cr) = (split(intent), split(reality));
    let (mut si, mut sr) = rayon::join(|| sense_side(&ci, lib, lens == "gzip"), || sense_side(&cr, lib, lens == "gzip"));
    si.bin = binarize(&si.scores, &st.threshold); sr.bin = binarize(&sr.scores, &st.threshold);
    let (ib, rb) = (si.bin.bits.clone(), sr.bin.bits.clone());
    let mut top5: Vec<(String, f64)> = sr.scores.iter().enumerate().map(|(i, &s)| (lib.sorted[i].0.clone(), s)).collect();
    top5.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)); top5.truncate(5);
    let avg = |v: &[f64]| if v.is_empty() { 0.0 } else { round_to(v.iter().fold(0.0, |a, b| a + b) / v.len() as f64, 4) };
    let st_lens = st.primary_lens.clone().unwrap_or_else(|| "gzip".into());
    rec(&mut stages, "sense", el(), vec![
        ("nodes", J::N(lib.sorted.len() as f64)), ("engine", J::S("rust-onchip".into())),
        ("primary_witness", J::S(if st_lens == "gzip" { "gzip-ncd" } else { "simhash" }.into())), ("secondary_witness", J::S(if st_lens == "gzip" { "simhash" } else { "gzip-ncd" }.into())),
        ("intent_diag_lit", J::N(ib.iter().map(|&b| b as f64).sum())), ("reality_diag_lit", J::N(rb.iter().map(|&b| b as f64).sum())),
        ("intent_witness_agree", J::N(si.agree as f64)), ("reality_witness_agree", J::N(sr.agree as f64)),
        ("intent_distinct_fragments", J::N(si.distinct as f64)), ("reality_distinct_fragments", J::N(sr.distinct as f64)),
        ("top5", J::A(top5.iter().map(|(c, s)| jo(vec![("coord", J::S(c.clone())), ("sim", J::N(*s))])).collect())), ("mean", J::N(avg(&sr.scores))),
        ("intent_lit_indices", ja_usize(&lit_indices(&ib))), ("reality_lit_indices", ja_usize(&lit_indices(&rb))),
        ("intent_claim_map", si.claim_map.clone()), ("reality_claim_map", sr.claim_map.clone()),
    ]);
    // SIGMA
    let mut sorted = sr.scores.clone(); sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let top = sorted.first().copied().unwrap_or(f64::NAN); let rest = &sorted[sorted.len().min(1)..];
    let rl = if rest.is_empty() { 1.0 } else { rest.len() as f64 };
    let mean = rest.iter().fold(0.0, |a, b| a + b) / rl; let var = rest.iter().fold(0.0, |a, b| a + (b - mean).powi(2)) / rl; let std = var.sqrt();
    let unpl = !(std > 0.0); let sigma = if std > 0.0 { (top - mean) / std } else { unplaced };
    let band = if unpl { "unplaced" } else if sigma >= st.sigma_floor { "gold" } else { "noise" };
    rec(&mut stages, "sigma", el(), vec![("sigma", J::N(round_to(sigma, 4))), ("top", J::N(round_to(top, 4))), ("mean", J::N(round_to(mean, 4))), ("std", J::N(round_to(std, 4))), ("unplaced", J::B(unpl)), ("band", J::S(band.into()))]);
    let thr = match &st.threshold { Value::Null => J::S("auto".into()), v => J::from_value(v) };
    rec(&mut stages, "binarize", el(), vec![("bits_lit", J::N(rb.iter().map(|&b| b as f64).sum())), ("bits_total", J::N(lib.sorted.len() as f64)), ("threshold", thr.clone()), ("method", J::S(sr.bin.method.clone())), ("cutoff", J::N(round_to(sr.bin.cutoff, 4))), ("score_mean", J::N(round_to(sr.bin.mean, 4))), ("score_std", J::N(round_to(sr.bin.std, 4)))]);
    // PROJECT + XOR (main.rs run_project_xor)
    let n = ib.len(); let (mut il, mut rl2, mut fl) = (vec![0u8; n * n], vec![0u8; n * n], vec![0u8; n * n]); let mut friction = 0usize;
    for i in 0..n { for j in 0..n { let k = i * n + j; if ib[i] == 1 && ib[j] == 1 { il[k] = 1; } if rb[i] == 1 && rb[j] == 1 { rl2[k] = 1; } if il[k] != rl2[k] { fl[k] = 1; friction += 1; } } }
    let (ib64, rb64, fb64) = (crate::pack_bitmap_b64(&il), crate::pack_bitmap_b64(&rl2), crate::pack_bitmap_b64(&fl));
    rec(&mut stages, "project", el(), vec![("grid_size", J::S("144x144".into())), ("pixels_lit", J::N(if rb64.is_empty() { 0.0 } else { 9.0 })), ("grid_bitmap_b64", J::S(rb64.clone())), ("lit_axis_indices", ja_usize(&lit_indices(&rb))), ("engine", J::S("rust-hardware-logic".into()))]);
    rec(&mut stages, "xor", el(), vec![("friction_nodes", J::N(friction as f64)), ("drift_pct", J::N(round_to((friction as f64 / 20736.0) * 100.0, 3))), ("intent_bitmap_b64", J::S(ib64.clone())), ("reality_bitmap_b64", J::S(rb64.clone())), ("friction_bitmap_b64", J::S(fb64.clone())), ("grid_size", J::N(144.0)), ("intent_lit_indices", ja_usize(&lit_indices(&ib)))]);
    // WALK (computeWalk: the reality walk, then the intent walk)
    if il.len() < CELLS || rl2.len() < CELLS { return Err("panel: the projected lattice is not 144×144 (anchor count)".into()); }
    let (hr, hi) = rayon::join(|| hardware_walk(&rl2, 0.6, 5, &st.walk_mode), || hardware_walk(&il, 0.6, 5, &st.walk_mode));
    let (mut dot, mut nr, mut ni, mut maxw, mut dig) = (0.0f64, 0.0f64, 0.0f64, -1.0f64, -1i64);
    for i in 0..CELLS { let (r, a) = (hr[i] as f64, hi[i] as f64); dot += r * a; nr += r * r; ni += a * a; if r > maxw { maxw = r; dig = i as i64; } }
    let agreement = if nr > 0.0 && ni > 0.0 { dot / (nr.sqrt() * ni.sqrt()) } else { 0.0 };
    let mut delta = vec![0f32; CELLS]; let (mut de, mut dpk, mut didx) = (0.0f64, 0.0f64, -1i64);
    for i in 0..CELLS { let d = (hi[i] as f64 - hr[i] as f64).abs(); delta[i] = d as f32; de += d; if d > dpk { dpk = d; didx = i as i64; } }
    let te = nr.sqrt() + ni.sqrt();
    let coord_of = |idx: i64| if idx >= 0 { let (r, c) = ((idx as usize) / 144, (idx as usize) % 144); format!("{} ⊕ {}", lib.sorted.get(r).map(|a| a.0.as_str()).unwrap_or("undefined"), lib.sorted.get(c).map(|a| a.0.as_str()).unwrap_or("undefined")) } else { "none".into() };
    let dig_row = if dig >= 0 { lib.sorted.get(dig as usize / 144).map(|a| a.1.clone()).filter(|s| !s.is_empty()) } else { None };
    let lit_r = hr.iter().filter(|&&v| v > 0.0).count(); let lit_i = hi.iter().filter(|&&v| v > 0.0).count();
    rec(&mut stages, "walk", el(), vec![
        ("reality_heatmap_b64", J::S(f32_b64(&hr))), ("intent_heatmap_b64", J::S(f32_b64(&hi))), ("delta_heatmap_b64", J::S(f32_b64(&delta))),
        ("reality_lit_nodes", J::N(lit_r as f64)), ("intent_lit_nodes", J::N(lit_i as f64)),
        ("agreement_pct", J::N(round_to(agreement * 100.0, 2))), ("divergence_pct", J::N(if te > 0.0 { round_to((de / (te * 144.0)) * 100.0, 2) } else { 0.0 })),
        ("divergence_pixel", J::S(coord_of(didx))), ("dignity_pixel", J::S(coord_of(dig))), ("dignity_row", dig_row.map(J::S).unwrap_or(J::Null)),
        ("engine", J::S("rust-ballistic-walk".into())), ("walk_mode", J::S(st.walk_mode.clone())),
    ]);
    let get = |k: &str| stages.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or(J::Null);
    let (walk, xor, sense) = (get("walk"), get("xor"), get("sense"));
    let vectors = jo(vec![("run_id", J::S(run_id.clone())), ("threshold", thr), ("scores", jo(vec![("intent", ja_f64(&si.scores)), ("reality", ja_f64(&sr.scores))])),
        ("claim_maps", jo(vec![("intent", si.claim_map.clone()), ("reality", sr.claim_map.clone())])), ("bits", jo(vec![("intent", J::A(ib.iter().map(|&b| J::N(b as f64)).collect())), ("reality", J::A(rb.iter().map(|&b| J::N(b as f64)).collect()))])),
        ("bitmaps", jo(vec![("intent_b64", J::S(ib64)), ("reality_b64", J::S(rb64)), ("friction_b64", J::S(fb64))])), ("friction_nodes", J::N(friction as f64))]);
    let sha = |t: &str| hex(&Sha256::digest(t.as_bytes()));
    let mut seal = vec![("run_id", J::S(run_id.clone())), ("sigma", J::N(round_to(sigma, 4))), ("friction_nodes", J::N(friction as f64)), ("band", J::S(band.into()))];
    seal.push(("agreement", J::N(round_to(agreement * 100.0, 2))));
    seal.push(("dignity_pixel", J::S(coord_of(dig))));
    seal.push(("intent", jo(vec![("kind", J::S("sha256".into())), ("value", J::S(sha(intent)))])));
    seal.push(("reality", jo(vec![("kind", J::S("sha256".into())), ("value", J::S(sha(reality)))])));
    seal.push(("at", J::S(started.clone())));
    Ok(Pipe { stages, walk, xor, sense, intent_heat: hi, run_id, started, vectors, seal: jo(seal) })
}
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }

// ── the record leg: vectors cache, the sealed bridge post, the run receipt (pipeline.mjs saveVectors · sealReceipt · writeRunReceipt) ──
pub struct RecordPaths { pub stage_dir: PathBuf, pub state: PathBuf, pub vectors: PathBuf, pub key_dir: PathBuf, pub bridge: String }
fn host_key(dir: &Path) -> Option<(ed25519_dalek::SigningKey, String)> {
    let pem = std::fs::read_to_string(dir.join("host.priv.pem")).ok().or_else(|| {
        let mut seed = [0u8; 32]; let h = Sha256::digest(format!("{}-{}-{}", rand_hex8(), rand_hex8(), std::process::id()).as_bytes()); seed.copy_from_slice(&h);
        let sk = ed25519_dalek::SigningKey::from_bytes(&seed);
        let mut der = hex_dec("302e020100300506032b657004220420"); der.extend_from_slice(&seed);
        let mut pd = hex_dec("302a300506032b6570032100"); pd.extend_from_slice(sk.verifying_key().as_bytes());
        let wrap = |tag: &str, b: &[u8]| { let e = B64.encode(b); let mut s = format!("-----BEGIN {}-----\n", tag); for ch in e.as_bytes().chunks(64) { s.push_str(std::str::from_utf8(ch).unwrap()); s.push('\n'); } s.push_str(&format!("-----END {}-----\n", tag)); s };
        let _ = std::fs::create_dir_all(dir);
        let priv_pem = wrap("PRIVATE KEY", &der);
        let _ = std::fs::write(dir.join("host.priv.pem"), &priv_pem);
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(dir.join("host.priv.pem"), std::fs::Permissions::from_mode(0o600)); }
        let _ = std::fs::write(dir.join("host.pub.pem"), wrap("PUBLIC KEY", &pd));
        Some(priv_pem)
    })?;
    let body: String = pem.lines().filter(|l| !l.starts_with("-----")).collect();
    let der = B64.decode(body.trim()).ok()?; if der.len() < 32 { return None; }
    let mut seed = [0u8; 32]; seed.copy_from_slice(&der[der.len() - 32..]);
    let sk = ed25519_dalek::SigningKey::from_bytes(&seed); let pk = hex(sk.verifying_key().as_bytes());
    Some((sk, pk))
}
fn hex_dec(s: &str) -> Vec<u8> { (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect() }
/// POST <url>/epoch — the status, 0 when nothing answered (node's fetch catch)
fn post_epoch(url: &str, body: &str) -> u16 {
    use std::io::{Read, Write};
    let Some(rest) = url.strip_prefix("http://") else { return 0 };
    let hostport = rest.split('/').next().unwrap_or(""); let base = rest[hostport.len()..].trim_end_matches('/');
    let addr = if hostport.contains(':') { hostport.to_string() } else { format!("{}:80", hostport) };
    let Ok(mut it) = std::net::ToSocketAddrs::to_socket_addrs(&addr) else { return 0 }; let Some(sa) = it.next() else { return 0 };
    let Ok(mut s) = std::net::TcpStream::connect_timeout(&sa, std::time::Duration::from_secs(3)) else { return 0 };
    let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(10))); let _ = s.set_write_timeout(Some(std::time::Duration::from_secs(10)));
    let req = format!("POST {}/epoch HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", base, hostport, body.len(), body);
    if s.write_all(req.as_bytes()).is_err() { return 0; }
    let mut buf = Vec::new(); let _ = s.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0)
}
/// replace (or add) one top-level key of a JSON.stringify(x, null, 2) document, every other byte kept
fn splice_top_level(doc: &str, key: &str, value: &str) -> Option<String> {
    let b = doc.as_bytes(); let mut i = doc.find('{')? + 1; let mut depth = 0i32; let (mut in_str, mut esc) = (false, false); let mut key_at: Option<(usize, usize)> = None;
    let mut cur_key_start: Option<usize> = None; let mut last_close = None;
    while i < b.len() {
        let c = b[i];
        if in_str { if esc { esc = false; } else if c == b'\\' { esc = true; } else if c == b'"' { in_str = false;
                if depth == 0 { if let Some(ks) = cur_key_start.take() { let k = &doc[ks + 1..i]; let mut j = i + 1; while j < b.len() && (b[j] as char).is_ascii_whitespace() { j += 1; } if b.get(j) == Some(&b':') && k == key { let mut v = j + 1; while v < b.len() && (b[v] as char).is_ascii_whitespace() { v += 1; } key_at = Some((v, 0)); } } } }
            i += 1; continue; }
        match c {
            b'"' => { in_str = true; if depth == 0 && key_at.map(|k| k.1 == 0 && i != k.0).unwrap_or(true) { cur_key_start = Some(i); } }
            b'{' | b'[' => depth += 1,
            b'}' | b']' => { if depth == 0 { last_close = Some(i); break; } depth -= 1; }
            b',' if depth == 0 => { if let Some((v, 0)) = key_at { key_at = Some((v, i)); } }
            _ => {}
        }
        i += 1;
    }
    let close = last_close?;
    let mut ind = String::new(); for (k, l) in value.lines().enumerate() { if k > 0 { ind.push_str("\n  "); } ind.push_str(l); }
    match key_at {
        Some((v, end)) => { let e = if end == 0 { let mut e = close; while e > v && (b[e - 1] as char).is_ascii_whitespace() { e -= 1; } e } else { end }; Some(format!("{}{}{}", &doc[..v], ind, &doc[e..])) }
        None => { let mut e = close; while e > 0 && (b[e - 1] as char).is_ascii_whitespace() { e -= 1; } Some(format!("{},\n  {}: {}\n{}", &doc[..e], serde_json::to_string(key).ok()?, ind, &doc[close..])) }
    }
}
fn records(p: Pipe, paths: RecordPaths) {
    use ed25519_dalek::Signer;
    let Pipe { mut stages, run_id, started, vectors, seal, .. } = p;
    // saveVectors — atomic (temp + rename)
    if let Some(d) = paths.vectors.parent() { let _ = std::fs::create_dir_all(d); }
    let tmp = paths.vectors.with_extension(format!("json.{}.{}.tmp", std::process::id(), iso_now().1));
    if std::fs::write(&tmp, vectors.stringify(None)).is_ok() { let _ = std::fs::rename(&tmp, &paths.vectors); }
    // sealReceipt + the post (node: record('claudbridge') or fail('claudbridge'))
    let t_b = std::time::Instant::now();
    let cb = match host_key(&paths.key_dir) {
        Some((sk, pk)) => {
            let body = seal.stringify(None); let sha = hex(&Sha256::digest(body.as_bytes())); let sig = hex(&sk.sign(body.as_bytes()).to_bytes());
            let mut sealed = match seal { J::O(o) => o, _ => vec![] };
            sealed.push(("pubkey_hex".into(), J::S(pk))); sealed.push(("sig_hex".into(), J::S(sig))); sealed.push(("sha256".into(), J::S(sha.clone())));
            let status = post_epoch(&paths.bridge, &J::O(sealed).stringify(None));
            let prev = stages.iter().find(|(n, _)| n == "walk").and_then(|(_, w)| if let Some(J::N(x)) = w.get("elapsed_ms") { Some(*x) } else { None }).unwrap_or(0.0);
            jo(vec![("ok", J::B(true)), ("elapsed_ms", J::N(js_round((prev + t_b.elapsed().as_secs_f64() * 1000.0) * 100.0) / 100.0)), ("url", J::S(paths.bridge.clone())), ("status", J::N(status as f64)), ("payload_sha", J::S(sha))])
        }
        None => jo(vec![("ok", J::B(false)), ("error", J::S("host key unavailable".into()))]),
    };
    stages.push(("claudbridge".into(), cb));
    let order = ["resolve", "invariants", "sense", "sigma", "binarize", "project", "xor", "walk", "claudbridge"];
    let all_ok = order.iter().all(|s| stages.iter().find(|(n, _)| n == s).map(|(_, v)| !matches!(v.get("ok"), Some(J::B(false)))).unwrap_or(true));
    let receipt = jo(vec![("run_id", J::S(run_id.clone())), ("started_at", J::S(started)), ("ended_at", J::S(iso_now().0)), ("ok", J::B(all_ok)), ("stages", J::O(stages))]);
    let pretty = receipt.stringify(Some(2));
    let _ = std::fs::create_dir_all(&paths.stage_dir);
    let _ = std::fs::write(paths.stage_dir.join(format!("{}.json", run_id)), &pretty);
    // state.last_run = receipt (writeRunReceipt → saveState: same-directory temp, rename)
    if let Ok(doc) = std::fs::read_to_string(&paths.state) {
        if let Some(next) = splice_top_level(&doc, "last_run", &pretty) {
            let tmp = paths.state.with_file_name(format!("{}.tmp-{}-{}-{}", paths.state.file_name().and_then(|s| s.to_str()).unwrap_or("state.json"), std::process::id(), iso_now().1, &rand_hex8()[..6]));
            if std::fs::write(&tmp, next).is_ok() { if std::fs::rename(&tmp, &paths.state).is_err() { let _ = std::fs::remove_file(&tmp); } }
        }
    }
}

// ── the competence pixel (start-pixel.mjs pickStartPixel) ───────────────────────────────────────────────────────────────
fn steady_state(a: &[f64], mass: &[f64], iters: usize, damping: f64) -> Vec<f64> {
    let mut out_deg = vec![0.0f64; N];
    for i in 0..N { let mut d = 0.0; for j in 0..N { d += a[i * N + j]; } out_deg[i] = if d == 0.0 || d.is_nan() { 1.0 } else { d }; }
    let s = mass.iter().fold(0.0, |x, y| x + y); let seed_sum = if s == 0.0 || s.is_nan() { 1.0 } else { s };
    let tele: Vec<f64> = mass.iter().map(|x| x / seed_sum).collect(); let mut x = tele.clone();
    for _ in 0..iters {
        let mut nx = vec![0.0f64; N];
        for i in 0..N { if x[i] == 0.0 { continue; } let share = (damping * x[i]) / out_deg[i]; for j in 0..N { let v = a[i * N + j]; if v != 0.0 && !v.is_nan() { nx[j] += share; } } }
        for j in 0..N { nx[j] += (1.0 - damping) * tele[j]; }
        x = nx;
    }
    x
}
fn pick_start(a: &[f64], coords: &[String], lit_in: &[usize], mass_of: &dyn Fn(usize) -> f64) -> usize {
    let mut seen = HashSet::new(); let lit: Vec<usize> = lit_in.iter().copied().filter(|&i| i < N && !coords[i].is_empty() && seen.insert(i)).collect();
    if lit.is_empty() { return 0; }
    let mut mass = vec![0.0f64; N]; for &i in &lit { let m = mass_of(i); mass[i] = if m.is_nan() { 0.0 } else { m.max(0.0) }; }
    if mass.iter().fold(0.0, |x, y| x + y) == 0.0 { for &i in &lit { mass[i] = 1.0; } }
    let ss = steady_state(a, &mass, 50, 0.85);
    let norm = |v: Vec<f64>| { let mx = v.iter().fold(1e-12f64, |m, &x| if x > m { x } else { m }); v.into_iter().map(|x| x / mx).collect::<Vec<f64>>() };
    let mn = norm(lit.iter().map(|&i| mass[i]).collect()); let fl = norm(lit.iter().map(|&i| ss[i]).collect());
    let mut ranked: Vec<(usize, f64)> = lit.iter().enumerate().map(|(k, &i)| (i, mn[k] + 0.15 * fl[k])).collect();
    ranked.sort_by(|x, y| y.1.partial_cmp(&x.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked[0].0
}

// ── the tolerance decode (triptych-render.mjs decodeDeltaThreeColourEdges) ─────────────────────────────────────────────
pub const LIT_MASS_FLOOR: usize = 24;
const GREEN: [f64; 3] = [30.0, 145.0, 80.0];
const AMBER: [f64; 3] = [255.0, 176.0, 0.0];
const RED: [f64; 3] = [255.0, 59.0, 59.0];
fn significant(m: &[f64]) -> Vec<u8> {
    let mut sig = vec![0u8; CELLS];
    for i in 0..N {
        let (mut s, mut s2, mut n) = (0.0f64, 0.0f64, 0usize);
        for j in 0..N { let w = m[i * N + j]; if w > 0.0 { s += w; s2 += w * w; n += 1; } }
        if n == 0 { continue; }
        let mu = s / n as f64; let sd = (0f64).max(s2 / n as f64 - mu * mu).sqrt();
        let thr = if n >= 3 { mu + 1.0 * sd } else { 0.0 };
        for j in 0..N { let w = m[i * N + j]; if w > 0.0 && w >= thr { sig[i * N + j] = 1; } }
    }
    sig
}
pub struct Tol { pub rgba: Vec<u8>, pub green: usize, pub amber: usize, pub red: usize, pub too_many: bool, pub off_pct: Option<f64>, pub region: Option<J>, pub refused: bool, pub refusal: Option<String>, pub lit_mass: Option<J> }
fn or_js(a: f64, b: f64) -> f64 { if a != 0.0 && !a.is_nan() { a } else { b } }
pub fn decode_edges(im: &[f64], rm: &[f64], kill: f64) -> Tol {
    let mut rgba = vec![0u8; CELLS * 4]; for i in 0..CELLS { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
    let is = significant(im); let rs = significant(rm);
    let blk = |i: usize| ((i / N) / 12, (i % N) / 12);
    let mut bm = vec![0.0f64; 144];
    for i in 0..CELLS { if is[i] != 0 { let (br, bc) = blk(i); bm[br * 12 + bc] += or_js(im[i], 1.0); } }
    let mut bmx = 0.0f64; for &x in &bm { if x > bmx { bmx = x; } }
    let mut dom: Vec<(i64, i64)> = Vec::new(); for b in 0..144 { if bmx > 0.0 && bm[b] >= 0.10 * bmx { dom.push(((b / 12) as i64, (b % 12) as i64)); } }
    if dom.is_empty() { dom.push((0, 0)); }
    let (mut is_m, mut rs_m) = (0usize, 0usize); for i in 0..CELLS { if is[i] != 0 { is_m += 1; } if rs[i] != 0 { rs_m += 1; } }
    if is_m < LIT_MASS_FLOOR || rs_m < LIT_MASS_FLOOR {
        return Tol { rgba, green: 0, amber: 0, red: 0, too_many: false, off_pct: None, region: None, refused: true,
            refusal: Some(format!("LIT-MASS FLOOR — intent {} / reality {} significant cells (floor {}); too thin to grade. UNMEASURED, never a pass.", is_m, rs_m, LIT_MASS_FLOOR)),
            lit_mass: Some(jo(vec![("intent", J::N(is_m as f64)), ("reality", J::N(rs_m as f64)), ("floor", J::N(LIT_MASS_FLOOR as f64))])) };
    }
    let mut rmx = 1.0f64; for i in 0..CELLS { if rs[i] != 0 && rm[i] > rmx { rmx = rm[i]; } }
    let mut cls = vec![0u8; CELLS]; let (mut inl, mut adj, mut orth) = (0usize, 0usize, 0usize);
    for i in 0..CELLS {
        if is[i] != 0 && rs[i] != 0 { cls[i] = 1; inl += 1; continue; }
        if rs[i] == 0 { continue; }
        let (br, bc) = blk(i); let d = dom.iter().map(|&(dr, dc)| (br as i64 - dr).abs().max((bc as i64 - dc).abs())).min().unwrap_or(i64::MAX);
        if d <= 0 { cls[i] = 1; inl += 1; } else if d == 1 { cls[i] = 2; adj += 1; } else { cls[i] = 3; orth += 1; }
    }
    let total = { let t = inl + adj + orth; if t == 0 { 1 } else { t } } as f64;
    let off_pct = js_round(100.0 * orth as f64 / total); let too_many = off_pct > kill;
    let (mut green, mut amber, mut red) = (0usize, 0usize, 0usize);
    for i in 0..CELLS {
        let v = 0.45 + 0.55 * (1.0 + 9.0 * or_js(rm[i], or_js(im[i], 0.0)) / rmx).ln() / std::f64::consts::LN_10;
        let col = match cls[i] { 1 => { green += 1; Some(GREEN) } 2 => { amber += 1; Some(AMBER) } 3 => { if too_many { red += 1; Some(RED) } else { amber += 1; Some(AMBER) } } _ => None };
        if let Some(c) = col { let o = i * 4; for k in 0..3 { rgba[o + k] = (c[k] * v).floor() as u8; } }
    }
    // the region classifier (the red line's invariant)
    let mut red_by = vec![0.0f64; 144];
    for i in 0..CELLS { if cls[i] == 3 && too_many { let (br, bc) = blk(i); red_by[br * 12 + bc] += rm[i] / rmx; } }
    let mut rb: Vec<(i64, i64, f64)> = Vec::new(); for b in 0..144 { if red_by[b] > 0.0 { rb.push(((b / 12) as i64, (b % 12) as i64, js_round(red_by[b] * 100.0) / 100.0)); } }
    rb.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let macro_rank = |idx: i64| if idx < 3 { idx } else { (idx - 3) / 3 };
    let prefix_len = |idx: i64| if idx < 3 { 1 } else { 2 };
    // node's key order: the default object's (every later assignment overwrites a key it already has)
    let st = |x: &str| J::S(x.to_string());
    let mut region = jo(vec![("tier", st("INSURABLE")), ("motif", st("none")), ("invariant", J::Null), ("offset", J::N(0.0)), ("spread", J::N(0.0)), ("blastRadius", st("none")), ("direction", st("self")), ("macroDist", J::N(0.0)), ("severity", st("none")), ("ruling", J::Null)]);
    if !rb.is_empty() {
        // Maps in insertion order, argmax by a stable sort on mass
        let add = |m: &mut Vec<(i64, f64)>, k: i64, w: f64| { if let Some(e) = m.iter_mut().find(|e| e.0 == k) { e.1 += w; } else { m.push((k, w)); } };
        let (mut by_row, mut by_col, mut by_off) = (Vec::new(), Vec::new(), Vec::new());
        for &(br, bc, w) in &rb { add(&mut by_row, br, w); add(&mut by_col, bc, w); add(&mut by_off, br - bc, w); }
        let argmax = |m: &Vec<(i64, f64)>| { let mut v = m.clone(); v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)); v[0] };
        let (rk, rmass) = argmax(&by_row); let (ck, cmass) = argmax(&by_col); let (ok, omass) = argmax(&by_off);
        let mut cand = vec![(if ok == 0 { "diagonal" } else { "off-diagonal" }, omass, ok, "offset"), ("horizontal", rmass, rk, "row"), ("vertical", cmass, ck, "col")];
        cand.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let win = cand[0];
        let on_line: Vec<(i64, i64, f64)> = rb.iter().copied().filter(|b| match win.3 { "row" => b.0 == win.2, "col" => b.1 == win.2, _ => b.0 - b.1 == win.2 }).collect();
        let spread = on_line.len();
        let blast = if spread >= 6 { "systemic" } else if spread >= 2 { "bounded" } else { "point" };
        let invariant = match win.3 { "row" => jo(vec![("axis", st("actor")), ("lane", J::N(win.2 as f64))]), "col" => jo(vec![("axis", st("patient")), ("lane", J::N(win.2 as f64))]), _ => jo(vec![("axis", st("offset")), ("k", J::N(win.2 as f64))]) };
        let mut ol = on_line.clone();
        ol.sort_by(|a, b| { let ga = (macro_rank(a.0) - macro_rank(a.1)).abs(); let gb = (macro_rank(b.0) - macro_rank(b.1)).abs(); let d = (gb - ga) as f64; let d = if d != 0.0 { d } else { b.2 - a.2 }; d.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal) });
        let r = ol[0]; let md = (macro_rank(r.0) - macro_rank(r.1)).abs();
        let dir = if r.0 > r.1 { "bottom-up" } else if r.0 < r.1 { "top-down" } else { "self" };
        // C1446: the tier reads off_pct's own severity (too_many, md, blast) alone — dir is reported beside it,
        // never inside it, so a fix that turns "bottom-up" into "top-down" can never pull the tier down.
        let tier = if too_many && (md >= 1 || blast == "systemic") { "UNINSURABLE" } else if too_many { "PRICEABLE" } else { "INSURABLE" };
        let n = |x: i64| J::N(x as f64);
        region = jo(vec![("tier", st(tier)), ("motif", st(win.0)), ("invariant", invariant), ("offset", n(win.2)), ("spread", J::N(spread as f64)), ("blastRadius", st(blast)), ("direction", st(dir)), ("macroDist", n(md)),
            ("severity", st(if md >= 2 { "severe" } else if md == 1 { "moderate" } else { "minor" })),
            ("ruling", jo(vec![("br", n(r.0)), ("bc", n(r.1)), ("prefixActor", n(prefix_len(r.0))), ("prefixPatient", n(prefix_len(r.1))), ("actorMacro", n(macro_rank(r.0))), ("patientMacro", n(macro_rank(r.1)))]))]);
    }
    Tol { rgba, green, amber, red, too_many, off_pct: Some(off_pct), region: Some(region), refused: false, refusal: None, lit_mass: None }
}

// ── THE SPILL STATISTIC (C1271 + C1276/C1304) ───────────────────────────────────────────────────────────────────────────────────
// "The call" (the intent, the commit message) names a footprint; "reality" (the diff) either stays inside it or spills. The ratio
// is the plain cell-count sibling to off_pct's heat-weighted, dominant-block read: reality cells outside the call's cells, over
// reality cells — base vs x read cell-for-cell on one panel's two matrices, never two sequential walks. The private research
// layer that prototyped this ratio in node names its own home for the port row; this file never names it (C1296).
pub const MIN_INTENT_CHARS: usize = 59;   // below this a call is too short to place — UNMEASURED, never a guess (the gate fold's own floor)
pub const KILL_PCT: f64 = 25.0;           // the gate fold's own threshold, never the req's kill (decode_edges' off_pct uses the req's)

/// the heat path: the lit set is every cell where the matrix reads raw `> 0`, never the `significant()` threshold decode_edges
/// uses for off_pct — so this reads the two cole matrices directly, cell for cell, with no second pass over the walk.
pub fn spill_cells(call: &[f64], reality: &[f64]) -> Option<f64> {
    let rs_m = reality.iter().filter(|&&v| v > 0.0).count();
    if rs_m == 0 { return None; }
    let outside = reality.iter().zip(call.iter()).filter(|&(&r, &c)| r > 0.0 && c <= 0.0).count();
    Some(outside as f64 / rs_m as f64)
}

/// the claim path (reality_kind "diff"): the same ratio read off the sense layer's lit ShortLex-anchor indexes — the 144-entry
/// `intent_lit_indices` / `reality_lit_indices` the "sense" stage already records (a hunk in words the 144 library holds no
/// cell for still moves these — found 2026-10-24: a monitor-removal hunk lit 0 new mask cells, 2 new anchor indexes).
pub fn spill_blocks(call: &[usize], reality: &[usize]) -> Option<f64> {
    if reality.is_empty() { return None; }
    let set: std::collections::HashSet<usize> = call.iter().copied().collect();
    let outside = reality.iter().filter(|b| !set.contains(b)).count();
    Some(outside as f64 / reality.len() as f64)
}

/// tightness: cells either side lit, over cells both sides lit, read off the same two cole matrices spill_cells reads
/// (operator 2026-10-24: "its not just a semantic reward - we have to capitalise on the shape match").
pub fn jaccard_cells(a: &[f64], b: &[f64]) -> f64 {
    let (mut inter, mut uni) = (0usize, 0usize);
    for i in 0..a.len().min(b.len()) { let (x, y) = (a[i], b[i]); if x > 0.0 || y > 0.0 { uni += 1; if x > 0.0 && y > 0.0 { inter += 1; } } }
    if uni == 0 { 0.0 } else { inter as f64 / uni as f64 }
}

/// triptych-render.mjs markPixel — the competence-pixel crosshair, drawn on the tolerance panel renderTriptych returns
fn mark_pixel(rgba: &mut [u8], cell: usize) {
    let (py, px) = (cell / N, cell % N);
    for t in 0..N {
        let (o1, o2) = ((py * N + t) * 4, (t * N + px) * 4);
        for o in [o1, o1 + 2, o2, o2 + 2] { rgba[o] = (rgba[o] as u16 + 38).min(255) as u8; }
    }
    for dy in -2i64..=2 { for dx in -2i64..=2 {
        if dy.abs().max(dx.abs()) != 2 { continue; }
        let (y, x) = (py as i64 + dy, px as i64 + dx); if y < 0 || y >= N as i64 || x < 0 || x >= N as i64 { continue; }
        let o = (y as usize * N + x as usize) * 4; rgba[o] = 255; rgba[o + 1] = 80; rgba[o + 2] = 200;
    } }
}
/// triptych-render.mjs greyZones → shortlexZoneOverlay(rgba, loadRegistry(), { gain: 3 }): the ShortLex zone seams, from the registry
fn zone_lines(registry: &Value) -> Option<Vec<(usize, u16)>> {
    let e = registry.get("entries")?.as_array()?;
    let depth = |x: &Value| x.get("depth").and_then(|v| v.as_f64());
    let first = |d: f64| e.iter().position(|x| depth(x) == Some(d)).map(|i| i as i64).unwrap_or(-1);
    let major = [first(2.0), first(3.0)];
    let mut child = Vec::new(); let mut prev: Option<Value> = None;
    for x in e { if depth(x) != Some(3.0) { continue; } let par = x.get("parent").cloned().unwrap_or(Value::Null); if prev.as_ref() != Some(&par) { child.push(x.get("index").and_then(|v| v.as_i64())?); prev = Some(par); } }
    let mut lines: Vec<(i64, u16)> = major.iter().map(|&k| (k, 90)).collect();
    for k in child { if !major.contains(&k) { lines.push((k, 48)); } }
    if lines.iter().any(|(k, _)| *k < 0 || *k >= N as i64) { return None; }   // node would index outside the panel: decline
    Some(lines.into_iter().map(|(k, a)| (k as usize, a)).collect())
}
fn grey_zones(rgba: &mut [u8], lines: &[(usize, u16)]) {
    for &(k, a) in lines { for t in 0..N { for o in [(k * N + t) * 4, (t * N + k) * 4] { for c in 0..3 { rgba[o + c] = (rgba[o + c] as u16 + a).min(255) as u8; } } } }
}

// ── the region detect (regions-chip.mjs rgbaToCls → the chip's --regions, in-process) and the rings (annotate-regions.mjs) ──────────
const TOL_HUE: [[f64; 3]; 3] = [[30.0, 145.0, 80.0], [255.0, 176.0, 0.0], [255.0, 59.0, 59.0]];
fn chroma(r: f64, g: f64, b: f64) -> [f64; 3] { let m = r.max(g).max(b); let m = if m == 0.0 { 1.0 } else { m }; [r / m, g / m, b / m] }
fn classify_px(r: u8, g: u8, b: u8) -> u8 {
    let (r, g, b) = (r as f64, g as f64, b as f64);
    if r.max(g).max(b) < 14.0 { return 0; }
    let c = chroma(r, g, b); let (mut best, mut bd) = (0u8, f64::INFINITY);
    for (k, h) in TOL_HUE.iter().enumerate() { let a = chroma(h[0], h[1], h[2]); let d = (c[0] - a[0]).powi(2) + (c[1] - a[1]).powi(2) + (c[2] - a[2]).powi(2); if d < bd { bd = d; best = (k + 1) as u8; } }
    if bd <= 0.15 { best } else { 0 }
}
const KIND_DRAW: [[u8; 3]; 3] = [[70, 211, 105], [255, 176, 0], [255, 80, 80]];
const FONT3X5: [[u8; 5]; 10] = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1], [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 2, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];
pub fn encircle(src: &[u8], regions: &[(u8, f64, f64, f64, f64, usize)], sc: usize) -> (Vec<u8>, usize, usize) {
    let (w, h) = (N * sc, N * sc); let mut out = vec![0u8; w * h * 4];
    for y in 0..h { for x in 0..w { let so = ((y / sc) * N + x / sc) * 4; let o = (y * w + x) * 4; for k in 0..3 { out[o + k] = (src[so + k] as f64 * 0.62).floor() as u8; } out[o + 3] = 255; } }
    let plot = |out: &mut Vec<u8>, x: f64, y: f64, col: [u8; 3]| { let (x, y) = (js_round(x), js_round(y)); if x < 0.0 || y < 0.0 || x >= w as f64 || y >= h as f64 { return; } let o = (y as usize * w + x as usize) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255; };
    for &(kind, ecx, ecy, erx, ery, n) in regions {
        let col = KIND_DRAW[(kind.clamp(1, 3) - 1) as usize]; let s = sc as f64;
        let (cx, cy, rx, ry) = (ecx * s, ecy * s, erx * s, ery * s);
        let steps = (120f64).max((2.0 * std::f64::consts::PI * rx.max(ry)).floor()) as usize;
        for st in 0..steps { let th = 2.0 * std::f64::consts::PI * st as f64 / steps as f64; let (px, py) = (cx + rx * th.cos(), cy + ry * th.sin()); for t in -1i32..=1 { for u in -1i32..=1 { plot(&mut out, px + t as f64, py + u as f64, col); } } }
        let (mx, my) = (cx, cy - ry);
        for dy in -8i32..=8 { for dx in -8i32..=8 { if dx * dx + dy * dy <= 64 { plot(&mut out, mx + dx as f64, my + dy as f64, col); } } }
        // drawText(…, Math.round(mx) - 3, Math.round(my) - 5, String(n), [8,10,16], 2)
        let (mut tx, ty) = (js_round(mx) as i64 - 3, js_round(my) as i64 - 5); let tsc = 2i64;
        for ch in n.to_string().chars() {
            let g = FONT3X5[ch.to_digit(10).unwrap_or(0) as usize];
            for ry_ in 0..5i64 { for rx_ in 0..3i64 { if (g[ry_ as usize] >> (2 - rx_)) & 1 == 1 { for ddy in 0..tsc { for ddx in 0..tsc {
                let (px, py) = (tx + rx_ * tsc + ddx, ty + ry_ * tsc + ddy);
                if px >= 0 && py >= 0 && (px as usize) < w && (py as usize) < h { let o = (py as usize * w + px as usize) * 4; out[o] = 8; out[o + 1] = 10; out[o + 2] = 16; out[o + 3] = 255; }
            } } } } }
            tx += 4 * tsc;
        }
    }
    (out, w, h)
}

// ── the impostor null's seeded shuffle (triptych-build.mjs) ─────────────────────────────────────────────────────────────
struct Mulberry(i32);
impl Mulberry {
    fn next(&mut self) -> f64 {
        let s = self.0.wrapping_add(0x6D2B79F5u32 as i32); self.0 = s;
        let mut t = (s ^ ((s as u32) >> 15) as i32).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ ((t as u32) >> 7) as i32).wrapping_mul(61 | t)) ^ t;
        ((t ^ ((t as u32) >> 14) as i32) as u32) as f64 / 4294967296.0
    }
}

impl Door {
    /// `{"op":"panel"}` — the encircled panel composed in one process (see the header). A request the crate does not serve (the ncd
    /// sensor arm, an axes override, the coverage clusterer, a degenerate intent) answers `fallback` and node runs its own path.
    pub fn panel(&mut self, req: &Value) -> Result<Value, String> {
        let t_all = std::time::Instant::now();
        let s = |k: &str| req.get(k).and_then(|v| v.as_str()).map(String::from);
        let f = |k: &str, d: f64| req.get(k).and_then(|v| v.as_f64()).unwrap_or(d);
        let intent = s("intent").unwrap_or_default(); let reality = s("reality").unwrap_or_default();
        let lib_p = s("lib").ok_or("panel: lib path required")?;
        let lib = match self.panel_held.libs.get(&lib_p) { Some(l) => l.clone(), None => { let l = Arc::new(load_lib(Path::new(&lib_p))?); self.panel_held.libs.insert(lib_p.clone(), l.clone()); l } };
        let st = load_state(Path::new(&s("state").ok_or("panel: state path required")?))?;
        if degenerate(&intent) { return Ok(json!({ "fallback": "degenerate intent (fewer than 8 unique tokens) — the node path's coarse decoder" })); }
        // 1. the pipeline
        let t_p = std::time::Instant::now();
        let pipe = run_pipeline(&lib, &st, &intent, &reality, (s("intent_label").as_deref().unwrap_or("intent"), s("reality_label").as_deref().unwrap_or("reality")),
            req.get("mass_floor").and_then(|v| v.as_f64()), s("primary_lens").as_deref().filter(|x| !x.is_empty()), f("unplaced_sigma", 99.0))?;
        let pipeline_ms = t_p.elapsed().as_secs_f64() * 1000.0;
        // domBlocks (top-4 intent block mass)
        let blk = |i: usize| (i / 12) / 3 * 4 + (i % 12) / 3;
        let mut bm = [0.0f64; 16]; for i in 0..CELLS { bm[blk((i % 144) % 144)] += pipe.intent_heat[i] as f64; }
        let mut db: Vec<usize> = (0..16).filter(|&b| bm[b] > 0.0).collect(); db.sort_by(|a, b| bm[*b].partial_cmp(&bm[*a]).unwrap_or(std::cmp::Ordering::Equal)); db.truncate(4);
        // 2. the claims, their signatures and the sense grids
        let t_s = std::time::Instant::now();
        let node_join = lib.node_text.join(" "); let lib_sha = &hex(&Sha256::digest(node_join.as_bytes()))[..12];
        let pair_path = PathBuf::from(s("pairs_dir").ok_or("panel: pairs_dir required")?).join(format!("pair-sigs-144-{}.json", lib_sha));
        if !pair_path.exists() {
            // C1256: the pair texts are signed through the sense module (sense::sigs_of), the one SimHash site of this path
            let pair_text: Vec<String> = (0..CELLS).map(|k| format!("{} {}", lib.node_text[k / 144], lib.node_text[k % 144])).collect();
            let sigs: Vec<String> = crate::sense::sigs_of(&pair_text, crate::signature::ShingleMode::Word).iter().map(|v| v.to_string()).collect();
            let _ = std::fs::write(&pair_path, serde_json::to_string(&sigs).unwrap_or_default());
        }
        let pairs = self.pairs(&pair_path.display().to_string())?;
        // C1270: `reality_kind:"diff"` reads the reality as a unified diff (diff_ranked); absent or "prose", the claim chain as before
        let reality_kind = match s("reality_kind").as_deref() { None | Some("") | Some("prose") => "prose", Some("diff") => "diff", Some(k) => return Err(format!("panel: reality_kind {:?} is not prose or diff", k)) };
        let side = |text: &str, diff: bool| -> (bool, Vec<u64>, usize) {
            if degenerate(text) { return (true, vec![], 0); }
            let claims: Vec<String> = if diff { diff_ranked(text) } else { salience_rank(claimify(text), 240).into_iter().take(160).collect() };
            (false, crate::sense::sigs_of(&claims, crate::signature::ShingleMode::Word), claims.len())
        };
        let ((_, sig_i, n_i), (deg_r, sig_r, n_r)) = rayon::join(|| side(&intent, false), || side(&reality, reality_kind == "diff"));
        let (sc_i, sc_r) = rayon::join(|| super::sense_scores(&sig_i, &pairs), || if deg_r { vec![0f32; CELLS] } else { super::sense_scores(&sig_r, &pairs) });
        let (th_i, g_i, lit_i) = super::sense_grid(&sc_i, 900, 0.56);
        let (th_r, g_r, lit_r) = if deg_r { (f64::NAN, vec![0u8; CELLS], 0) } else { super::sense_grid(&sc_r, 900, 0.56) };
        let sense_ms = t_s.elapsed().as_secs_f64() * 1000.0;
        // 3. the competence pixel
        let conn_p = s("conn").ok_or("panel: conn path required")?;
        let conn = match self.panel_held.conn.get(&conn_p) { Some(c) => c.clone(), None => {
            let c: Vec<f64> = match std::fs::read_to_string(&conn_p).ok().and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok()) {
                Some(v) => v.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect(),
                None => { let ax: Vec<(String, String)> = lib.coords.iter().map(|c| { let c = if c.is_empty() { "A,A" } else { c.as_str() }; let mut p = c.split(','); (p.next().unwrap_or("").to_string(), p.next().unwrap_or("").to_string()) }).collect();
                    let mut g = vec![0.0f64; CELLS]; for i in 0..N { g[i * N + i] = 1.0; for j in i + 1..N { if ax[i].0 == ax[j].0 || ax[i].1 == ax[j].1 { g[i * N + j] = 1.0; } } } g }
            };
            let c = Arc::new(c); self.panel_held.conn.insert(conn_p.clone(), c.clone()); c } };
        let score_i: Vec<f64> = sc_i.iter().map(|&x| x as f64).collect();
        let mut idx: Vec<usize> = (0..CELLS).collect(); idx.sort_by(|a, b| score_i[*b].partial_cmp(&score_i[*a]).unwrap_or(std::cmp::Ordering::Equal));
        let mut actor: Vec<(usize, f64)> = Vec::new();
        for &c in idx.iter().take(8) { let a = c / 144; match actor.iter_mut().find(|e| e.0 == a) { Some(e) => e.1 += score_i[c], None => actor.push((a, score_i[c])) } }
        let lit: Vec<usize> = actor.iter().map(|e| e.0).collect();
        let start = pick_start(&conn, &lib.coords, &lit, &|a| actor.iter().find(|e| e.0 == a).map(|e| e.1).unwrap_or(0.0));
        let (mut patient, mut grip) = (0usize, -1.0f64);
        for j in 0..N { let v = score_i[start * N + j]; if v > grip { grip = v; patient = j; } }
        // 4. the impostor shuffles and the ten walks
        let mut seed: u32 = 2166136261; for &b in &g_r { seed ^= b as u32; seed = seed.wrapping_mul(16777619); }
        let mut rng = Mulberry(seed as i32);
        let impostors = (f("impostors", 8.0) as usize).max(8);
        let shuffles: Vec<Vec<u8>> = (0..impostors).map(|_| { let mut a = g_r.clone(); for i in (1..a.len()).rev() { let j = (rng.next() * (i as f64 + 1.0)).floor() as usize; a.swap(i, j); } a }).collect();
        let k = req.get("knobs").cloned().unwrap_or(Value::Null); let kn = |n: &str, d: f64| k.get(n).and_then(|v| v.as_f64()).unwrap_or(d);
        let (md, tk, bu, bms, de) = (kn("maxDepth", 8.0) as usize, kn("topK", 2.0) as usize, kn("budget", 220.0) as usize, kn("budgetMs", 600000.0) as u128, kn("decay", 0.5));
        let coords = self.coords(&lib_p)?;
        let mut seen = HashSet::new(); let seeds: Vec<usize> = [start, patient].into_iter().filter(|&x| x < 144 && !coords[x].is_empty() && seen.insert(x)).collect();
        let t_w = std::time::Instant::now();
        let mut grids: Vec<&Vec<u8>> = vec![&g_i, &g_r]; grids.extend(shuffles.iter());
        let walks: Vec<Value> = grids.par_iter().map(|g| { let mut b = [0u8; CELLS]; b.copy_from_slice(&g[..CELLS]); crate::lens::definer_walk_value(&b, &coords, &seeds, md, tk, bu, bms, de) }).collect();
        let walk_ms = t_w.elapsed().as_secs_f64() * 1000.0;
        let mat = |w: &Value| -> Vec<f64> { w.get("matrix").and_then(|m| m.as_array()).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect()).unwrap_or_default() };
        let mats: Vec<Vec<f64>> = walks.iter().map(mat).collect();
        let cosine = |a: &[f64], b: &[f64]| { let (mut d, mut na, mut nb) = (0.0f64, 0.0f64, 0.0f64); for i in 0..a.len() { let bi = b.get(i).copied().unwrap_or(f64::NAN); d += a[i] * bi; na += a[i] * a[i]; nb += bi * bi; } if na != 0.0 && nb != 0.0 && !na.is_nan() && !nb.is_nan() { d / (na * nb).sqrt() } else { 0.0 } };
        let actual = cosine(&mats[0], &mats[1]);
        let imps: Vec<f64> = mats[2..].iter().map(|m| cosine(&mats[0], m)).collect();
        let mu = imps.iter().fold(0.0, |a, b| a + b) / imps.len() as f64;
        let sd = (imps.iter().fold(0.0, |a, b| a + (b - mu).powi(2)) / imps.len() as f64).sqrt();
        let match_sigma = if sd != 0.0 && !sd.is_nan() { (actual - mu) / sd } else { 0.0 };
        let cells_of = |m: &[f64]| m.iter().filter(|&&v| v > 0.0).count();
        let num = |w: &Value, k: &str| w.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
        // 5. the tolerance decode, the regions, the rings, the png
        let t_t = std::time::Instant::now();
        let mut tol = decode_edges(&mats[0], &mats[1], f("kill", 25.0));
        // renderTriptych hands back tol.rgba after greyZones(markPixel(tol.rgba, pixelCell)) — the crosshair and the zone seams ride on the panel
        let reg: Value = std::fs::read_to_string(s("registry").ok_or("panel: registry path required")?).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        let Some(lines) = zone_lines(&reg) else { return Ok(json!({ "fallback": "the ShortLex registry is missing or unreadable — the node path builds it" })) };
        mark_pixel(&mut tol.rgba, start * 144 + patient);
        grey_zones(&mut tol.rgba, &lines);
        let tol_ms = t_t.elapsed().as_secs_f64() * 1000.0;
        let t_r = std::time::Instant::now();
        let cls: Vec<u8> = (0..CELLS).map(|i| classify_px(tol.rgba[i * 4], tol.rgba[i * 4 + 1], tol.rgba[i * 4 + 2])).collect();
        let regions_text = crate::regions::regions_json(&cls);   // the chip's own bytes (its key order), as --regions printed them
        let raw: Value = serde_json::from_str(&regions_text).map_err(|e| format!("regions: {}", e))?;
        let raw_regions = raw.get("regions").cloned().unwrap_or(json!([]));
        let mut ordered: Vec<&Value> = raw_regions.as_array().map(|a| a.iter().collect()).unwrap_or_default();
        ordered.sort_by(|a, b| num(b, "blocks").partial_cmp(&num(a, "blocks")).unwrap_or(std::cmp::Ordering::Equal));
        let rings: Vec<(u8, f64, f64, f64, f64, usize)> = ordered.iter().enumerate().map(|(i, r)| {
            let bb = r.get("blockBox").cloned().unwrap_or(Value::Null); let g = |k: &str| bb.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let (r0, r1, c0, c1) = (g("r0"), g("r1"), g("c0"), g("c1"));
            (num(r, "kind") as u8, ((c0 + c1 + 1.0) / 2.0) * 12.0, ((r0 + r1 + 1.0) / 2.0) * 12.0, ((c1 - c0 + 1.0) * 12.0) / 2.0 + 3.0, ((r1 - r0 + 1.0) * 12.0) / 2.0 + 3.0, i + 1)
        }).collect();
        let regions_ms = t_r.elapsed().as_secs_f64() * 1000.0;
        let t_g = std::time::Instant::now();
        let scale = f("scale", 4.0).max(1.0) as usize;
        let (big, w, h) = encircle(&tol.rgba, &rings, scale);
        let png = crate::png::png_from_rgba(&big, w, h);
        let rings_ms = t_g.elapsed().as_secs_f64() * 1000.0;
        // 6. the message clauses' placements (C612b2 place)
        let t_c = std::time::Instant::now();
        let clauses: Vec<String> = req.get("clauses").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let placements: Vec<Value> = if clauses.is_empty() || lib.pair_cells.is_empty() { vec![] } else {
            let head = s("head").ok_or("panel: head required to place clauses")?; let dir = PathBuf::from(s("anchor_dir").ok_or("panel: anchor_dir required")?);
            let list: Vec<(String, String)> = lib.pair_cells.iter().map(|(c, t)| (format!("snip:{}", c), t.clone())).collect();
            self.ensure_anchors(&head, -1, &dir, &list)?;
            let held = self.anchors.get(&(head.clone(), -1)).ok_or("place: anchors not held")?;
            let snip_z: Vec<usize> = list.iter().map(|(id, _)| held.get(id).map(|a| a.clen).unwrap_or(0)).collect();
            clauses.par_iter().map(|d| place_pixel(d, &lib.pair_cells, &snip_z)).collect()
        };
        let place_ms = t_c.elapsed().as_secs_f64() * 1000.0;
        // the record leg leaves on its own thread
        let rp = RecordPaths { stage_dir: PathBuf::from(s("stage_dir").ok_or("panel: stage_dir required")?), state: PathBuf::from(s("state").unwrap_or_default()), vectors: PathBuf::from(s("vectors").ok_or("panel: vectors path required")?), key_dir: PathBuf::from(s("key_dir").ok_or("panel: key_dir required")?), bridge: s("bridge").unwrap_or_else(|| "http://localhost:7777".into()) };
        // C612s: the admissibility record rides out beside the stages node reads, so node and crate can be held to one mass
        let adm = pipe.stages.iter().find(|(n, _)| n == "admissibility").map(|(_, j)| j.clone()).unwrap_or(J::Null);
        let stages_json = jo(vec![("walk", pipe.walk.clone()), ("xor", pipe.xor.clone()), ("sense", pipe.sense.clone()), ("admissibility", adm)]).stringify(None);
        self.panel_held.pending.retain(|h| !h.is_finished());
        if req.get("records").and_then(|v| v.as_bool()) != Some(false) { self.panel_held.pending.push(std::thread::spawn(move || records(pipe, rp))); }
        let walk_out = |w: &Value| json!({ "heat": w.get("heat"), "ply": w.get("ply"), "hops": w.get("hops"), "max_ply": w.get("max_ply"), "matrix": w.get("matrix"), "m_ply": w.get("m_ply"), "time_budget_tripped": w.get("time_budget_tripped"), "hop_log": w.get("hop_log") });
        let (it, rt) = (&walks[0], &walks[1]);
        let cole = json!({ "intent": walk_out(it), "reality": walk_out(rt), "startPixel": start, "startRow": start / 12, "pixelCell": start * 144 + patient,
            "hops": num(it, "hops") + num(rt, "hops"), "maxPly": num(it, "max_ply").max(num(rt, "max_ply")),
            "matchSigma": to_fixed(match_sigma, 2), "actualMatch": to_fixed(actual, 4), "impMean": to_fixed(mu, 3), "intentCells": cells_of(&mats[0]), "realityCells": cells_of(&mats[1]) });
        Ok(json!({
            "rgba_b64": B64.encode(&tol.rgba), "png_b64": B64.encode(&png),
            "tol": { "green": tol.green, "amber": tol.amber, "red": tol.red, "offPct": tol.off_pct, "tooMany": tol.too_many, "refused": tol.refused, "refusal": tol.refusal },
            "region_json": tol.region.as_ref().map(|r| r.stringify(None)), "lit_mass_json": tol.lit_mass.as_ref().map(|r| r.stringify(None)),
            "domBlocks": db, "reality_kind": reality_kind, "regions_json": regions_text, "placements": placements, "cole": cole,
            "grids": { "intent_b64": pack_bits(&g_i), "reality_b64": pack_bits(&g_r) },
            "sense_meta": { "intent": { "lit": lit_i, "theta": th_i, "claims": n_i }, "reality": { "lit": lit_r, "theta": if th_r.is_nan() { Value::Null } else { json!(th_r) }, "claims": if deg_r { Value::Null } else { json!(n_r) } } },
            "walk_ms": walk_ms, "pipeline_ms": pipeline_ms,
            "stages_json": stages_json,
            "timing": { "pipeline": pipeline_ms, "claims_sense": sense_ms, "walks": walk_ms, "tol": tol_ms, "regions": regions_ms, "rings_png": rings_ms, "place": place_ms, "total": t_all.elapsed().as_secs_f64() * 1000.0 },
            "answered": if placements.is_empty() { json!(["panel", "pipeline", "sense", "walks", "tol", "regions", "png"]) } else { json!(["panel", "pipeline", "sense", "walks", "tol", "regions", "png", "place"]) },
            "engine": "pmu-onchip --door-serve panel (C612r)"
        }))
    }

    /// `{"op":"reward"}` (C1271 + C1276/C1304): the gate fold (off-lane over the kill, UNMEASURED before a real reading) plus
    /// the spill statistic and its Jaccard tightness sibling, read off the SAME `panel` answer — never a second walk. Needs the paths
    /// `panel` needs (lib, state, registry, …); a caller that cannot supply them (scripts/vna/door-crate.mjs's rewardCrate today
    /// sends only intent/reality/reality_kind/kill/min_intent_chars) gets this op's own "required" error, caught by `rewardCrate`
    /// as a decline like any other door-serve op (MAXIMISE RUST; wiring those paths into rewardCrate's payload is a later row).
    pub fn reward(&mut self, req: &Value) -> Result<Value, String> {
        let intent_text = req.get("intent").and_then(|v| v.as_str()).unwrap_or("");
        let min_chars = req.get("min_intent_chars").and_then(|v| v.as_u64()).unwrap_or(MIN_INTENT_CHARS as u64) as usize;
        if intent_text.trim().chars().count() < min_chars {
            return Ok(json!({ "gate": "UNMEASURED", "why": format!("call under {} chars", min_chars) }));
        }
        let panel = self.panel(req)?;
        if panel.get("fallback").is_some() { return Ok(panel); }   // the node path's coarse decoder runs instead — never beside it
        let tol = panel.get("tol").ok_or("reward: panel carried no tol")?;
        let refused = tol.get("refused").and_then(|v| v.as_bool()).unwrap_or(false);
        let refusal = tol.get("refusal").and_then(|v| v.as_str());
        let off_pct = tol.get("offPct").and_then(|v| v.as_f64());
        let green = tol.get("green").and_then(|v| v.as_u64()).unwrap_or(0);
        let cole = panel.get("cole").ok_or("reward: panel carried no cole")?;
        let sigma = cole.get("matchSigma").and_then(|v| v.as_f64());
        let actual_match = cole.get("actualMatch").and_then(|v| v.as_f64());
        let farr = |j: &Value| -> Vec<f64> { j.as_array().map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect()).unwrap_or_default() };
        let call_mat = cole.get("intent").and_then(|w| w.get("matrix")).map(farr).unwrap_or_default();
        let reality_mat = cole.get("reality").and_then(|w| w.get("matrix")).map(farr).unwrap_or_default();
        let (gate, why): (&str, String) = if refused {
            ("UNMEASURED", refusal.unwrap_or("panel refused").to_string())
        } else if off_pct.is_none() {
            ("UNMEASURED", "no off-lane count".to_string())
        } else if green == 0 && off_pct.unwrap() >= 90.0 {
            ("UNMEASURED", "intent did not ground".to_string())
        } else if off_pct.unwrap() > KILL_PCT {
            ("BREACH", format!("off-lane {}% over the {}% kill", js_num(off_pct.unwrap()), js_num(KILL_PCT)))
        } else {
            ("GREEN", format!("off-lane {}% within the kill", js_num(off_pct.unwrap())))
        };
        let uarr = |j: Option<&Value>| -> Vec<usize> { j.and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_u64().map(|n| n as usize)).collect()).unwrap_or_default() };
        let sense: Value = panel.get("stages_json").and_then(|v| v.as_str()).and_then(|s| serde_json::from_str(s).ok()).unwrap_or(Value::Null);
        let sense = sense.get("sense").cloned().unwrap_or(Value::Null);
        let intent_blocks = uarr(sense.get("intent_lit_indices"));
        let reality_blocks = uarr(sense.get("reality_lit_indices"));
        Ok(json!({
            "gate": gate, "why": why, "sigma": sigma, "offPct": off_pct, "actualMatch": actual_match,
            "spill": { "heat": spill_cells(&call_mat, &reality_mat), "claim": spill_blocks(&intent_blocks, &reality_blocks) },
            "jaccard": jaccard_cells(&call_mat, &reality_mat),
            "engine": "pmu-onchip --door-serve reward (C1271+C1276/C1304)",
        }))
    }
}

/// `{"op":"claims","texts":[…]}` — the claim chain per text (segments → claimify → salienceRank → the 160 kept → their word simhash),
/// so a guard can hold every link of it to corpus-ingest.mjs on any corpus
pub fn claims_op(req: &Value) -> Result<Value, String> {
    let texts: Vec<String> = req.get("texts").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).ok_or("claims: texts required")?;
    let out: Vec<Value> = texts.par_iter().map(|t| {
        let seg = claim_segments(t); let cl = claimify(t); let ranked: Vec<String> = salience_rank(cl.clone(), 240).into_iter().take(160).collect();
        let sigs: Vec<String> = crate::sense::sigs_of(&ranked, crate::signature::ShingleMode::Word).iter().map(|v| v.to_string()).collect();
        json!({ "segments": seg, "claimify": cl, "ranked": ranked, "sigs": sigs, "degenerate": degenerate(t) })
    }).collect();
    Ok(json!({ "out": out }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn js_number_semantics() {
        assert_eq!(js_round(2.5), 3.0); assert_eq!(js_round(-2.5), -2.0); assert_eq!(js_round(0.49999999999999994), 0.0);
        assert_eq!(to_fixed(0.125, 2), 0.13); assert_eq!(to_fixed(1.005, 2), 1.0); assert_eq!(to_fixed(-0.125, 2), -0.13);
        assert_eq!(js_num(99.0), "99"); assert_eq!(js_num(0.1), "0.1"); assert_eq!(js_num(1e-7), "1e-7");
    }
    #[test]
    fn splits_like_js() {
        assert_eq!(split_blank("a\n \n\tb\n\nc"), vec!["a", "\tb", "c"]);
        assert_eq!(by_sentence("One two. Three four? (five) six"), vec!["One two.", "Three four?", "(five) six"]);
        assert!(looks_like_code("const x = 1")); assert!(looks_like_code("if (a) b")); assert!(!looks_like_code("If the walk lands here, the panel says so"));
        assert!(classify_meaning("the walk is held in the crate and the panel is composed once"));
    }
    #[test]
    fn c1270_a_diff_reads_as_hunk_claims() {
        assert_eq!(code_words("if (!monitor.enabled) throw new HTTPError(no_notify, 'alertsSent');"), vec!["if", "monitor", "enabled", "throw", "new", "http", "error", "no", "notify", "alerts", "sent"]);
        assert_eq!(code_words("// don't send 'it'"), vec!["don't", "send", "it"]);
        let d = "diff --git a/src/security/monitor-integration.ts b/src/security/monitor-integration.ts\n@@ -40,3 +40,1 @@ export async function attachMonitor()\n-  if (!monitor.enabled) throw new Error('monitor required');\n-  await monitor.attach(pipeline);\n+  const no_notify = true;\n";
        // the diff path reads both runs, under the file's words and the hunk's context
        let c = diff_claims(d);
        assert_eq!(c.len(), 2, "{:?}", c);
        assert!(c[0].starts_with("removed from src security monitor integration export async function attach monitor: if monitor enabled"), "{}", c[0]);
        assert!(c[1].starts_with("added in src security monitor integration"), "{}", c[1]);
        assert!(c.iter().all(|x| u16len(x) >= MIN_CLAIM && u16len(x) <= MAX_CLAIM));
        // a long run is cut at MAX_CLAIM, each piece keeping its head
        let long = format!("diff --git a/ledger.rs b/ledger.rs\n@@ -1 +1 @@\n{}", (0..200).map(|i| format!("+let value{} = compute_total(item);\n", i)).collect::<String>());
        let lc = diff_claims(&long); assert!(lc.len() > 1 && lc.iter().all(|x| x.starts_with("added in ledger:") && u16len(x) <= MAX_CLAIM));
        // re-walk exact
        assert_eq!(diff_ranked(d), diff_ranked(d));
        // prose outside the diff structure is read as the prose path reads it
        let p = "The monitor integration was removed from the security module to match the reference implementation.";
        assert!(diff_claims(&format!("{}\n\n{}", d, p)).iter().any(|c| c == p));
        // the kept set does not depend on hunk order
        let h2 = "diff --git a/b.rs b/b.rs\n@@ -1 +1 @@\n+let billing_total = invoice.amount;\n";
        assert_eq!(diff_ranked(&format!("{}{}", d, h2)), diff_ranked(&format!("{}{}", h2, d)));
    }
    #[test]
    fn splice_keeps_order() {
        let doc = "{\n  \"a\": 1,\n  \"last_run\": {\n    \"x\": 1\n  },\n  \"z\": [\n    1\n  ]\n}";
        let out = splice_top_level(doc, "last_run", "{\n  \"y\": 2\n}").unwrap();
        assert_eq!(out, "{\n  \"a\": 1,\n  \"last_run\": {\n    \"y\": 2\n  },\n  \"z\": [\n    1\n  ]\n}");
        let out2 = splice_top_level("{\n  \"a\": 1\n}", "last_run", "{}").unwrap();
        assert_eq!(out2, "{\n  \"a\": 1,\n  \"last_run\": {}\n}");
    }
    #[test]
    fn c1304_spill_and_jaccard_match_the_node_prototype() {
        // the exact fixture tests/vna/c1304-c1271-c1276-build-the-spill-statistic.test.mjs computes in JS off the same numbers
        let call = [1.0, 0.0, 2.0, 0.0, 0.0, 3.0];
        let reality = [1.0, 1.0, 0.0, 2.0, 0.0, 0.0];
        assert_eq!(spill_cells(&call, &reality), Some(2.0 / 3.0), "spill(base,x) = |x \\ base| / |x|, base = call, x = reality");
        assert_eq!(jaccard_cells(&call, &reality), 1.0 / 5.0, "jaccard: intersection over union of the two lit sets");
        // rewalk exact: the same pair reads the same ratio twice (THE RECEIPT IS LLM-FREE; no non-determinism to drift)
        assert_eq!(spill_cells(&call, &reality), spill_cells(&call, &reality));
        // reality with nothing lit: no denominator, UNMEASURED never a guessed zero
        assert_eq!(spill_cells(&call, &[0.0; 6]), None);
        // a reality identical to the call spills nothing — the zero-variance rewalk control (H1, C1308)
        assert_eq!(spill_cells(&call, &call), Some(0.0));
        assert_eq!(jaccard_cells(&call, &call), 1.0);
        let call_blocks = [2usize, 5, 7];
        let reality_blocks = [2usize, 7, 9, 11];
        assert_eq!(spill_blocks(&call_blocks, &reality_blocks), Some(0.5), "the claim-path ratio on the 144 ShortLex-anchor indexes");
        assert_eq!(spill_blocks(&call_blocks, &[]), None);
    }
}
