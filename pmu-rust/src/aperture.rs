// src/aperture.rs — THE APERTURE, ON THE CHIP.
//
// THIS IS THE HIGHEST-RISK DECISION IN THE WHOLE PIPELINE AND IT WAS IN NODE. Everything downstream
// — sigma, binarize, xor, the walk, every ring on every panel — is computed from the two corpora
// this step produces. sense() can only measure what it is handed: if the two sides arrive at 80:1,
// gzip-NCD measures LENGTH and the chip faithfully returns a placement of noise. A defect here does
// not surface as an error anywhere downstream; it surfaces as a confident picture of nothing.
//
// It also runs BEFORE sense, which is why the pipeline's own stage map never listed it: the map
// covered runPipeline's stages, and the corpus was built upstream of all of them.
//
// TWO DECISIONS LIVE HERE, and they are separate on purpose:
//   MATCHED     — are the two sides the same size-order (a ratio; cure by cutting the larger side)
//   ADMISSIBLE  — does each side clear the 220-byte phantom-mass floor (an entropy floor; no cure)
// A pair can be perfectly matched and still be two tiny strings, which is matched noise. Merging the
// two verdicts would let that pass as a measurement.
//
// CUT, NEVER GROW. Settled the expensive way in thetacog-mcp's physics module (2026-08-20): growing
// the short side by repeating its own text does not add gzip mass, because gzip dedupes the
// repetition. Repetition adds LENGTH, not ENTROPY.
//
// AND THE WINDOW IS CHOSEN, NOT DEFAULTED. Every source file in this repo opens with a long comment
// block in the same register, so a head-slice of fourteen files is fourteen near-identical headers —
// one repeated document to gzip. Measured: the reality side came back with ZERO significant cells.
// So candidate windows are slid across each document and the one with the highest entropy DENSITY
// (gzip bytes per raw byte) is kept — the same instrument the placement uses, so the selection and
// the measurement agree about what information is.
//
// BYTE PARITY WITH NODE IS THE POINT OF DOING IT HERE AT ALL: gzip lengths come from
// lens::node_gzip_len, the vendored Chromium zlib fork, so a mass computed on the chip equals the
// mass node computed byte-for-byte. Without that this would be a second opinion, not a migration.
use serde::{Deserialize, Serialize};
use crate::lens;

pub const MIN_GZIP_BYTES: usize = 220;
const MIN_DOC_BYTES: usize = 200;
const CANDIDATES: usize = 6;

#[derive(Deserialize)]
pub struct Doc { pub path: String, pub text: String }

#[derive(Deserialize)]
struct In {
    intent: Vec<Doc>,
    reality: Vec<Doc>,
    #[serde(default = "default_tolerance")]
    tolerance: f64,
}
fn default_tolerance() -> f64 { 1.25 }

#[derive(Serialize)]
pub struct Row {
    pub side: String,
    pub path: String,
    #[serde(rename = "rawBytes")] pub raw_bytes: usize,
    #[serde(rename = "usedBytes")] pub used_bytes: usize,
    #[serde(rename = "sharePct")] pub share_pct: f64,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct Out {
    pub intent: String,
    pub reality: String,
    pub rows: Vec<Row>,
    #[serde(rename = "rawRatio")] pub raw_ratio: f64,
    #[serde(rename = "usedRatio")] pub used_ratio: f64,
    pub matched: bool,
    pub admissible: bool,
    #[serde(rename = "intentBytes")] pub intent_bytes: usize,
    #[serde(rename = "realityBytes")] pub reality_bytes: usize,
    #[serde(rename = "intentGzip")] pub intent_gzip: usize,
    #[serde(rename = "realityGzip")] pub reality_gzip: usize,
    pub floor: usize,
    pub tolerance: f64,
    pub reason: Option<String>,
    pub engine: String,
}

// A window of `budget` BYTES, trimmed to the nearest char boundary so the slice is valid UTF-8.
// Byte-oriented on both sides of the port: JS slicing by UTF-16 code units and Rust slicing by bytes
// disagree the moment an em-dash appears, and this repo is full of them.
fn window(text: &str, at: usize, budget: usize) -> &str {
    let b = text.as_bytes();
    let mut start = at.min(b.len());
    while start > 0 && !text.is_char_boundary(start) { start -= 1; }
    let mut end = (start + budget).min(b.len());
    while end > start && !text.is_char_boundary(end) { end -= 1; }
    &text[start..end]
}

/// THE MATCHED CUT, reused by the seed (lens.rs matched_seed_with): the other side's byte length × the default
/// tolerance, floored at MIN_DOC_BYTES so a document is never cut to nothing, chosen by entropy density — the same
/// rule match_aperture applies to a corpus pair, applied to one target snippet against the intent. One rule, one place.
pub fn matched_budget(other_bytes: usize) -> usize { std::cmp::max(MIN_DOC_BYTES, (other_bytes as f64 * default_tolerance()) as usize) }
pub fn matched_cut(text: &str, other_bytes: usize) -> String { pick_window(text, matched_budget(other_bytes)) }

pub(crate) fn pick_window(text: &str, budget: usize) -> String {
    if text.len() <= budget { return text.to_string(); }
    let span = text.len() - budget;
    let step = std::cmp::max(1, span / (CANDIDATES - 1));
    let mut best = String::new();
    let mut best_density = -1.0f64;
    for i in 0..CANDIDATES {
        let at = std::cmp::min(span, i * step);
        let w = window(text, at, budget);
        if w.is_empty() { continue; }
        let d = lens::node_gzip_len(w.as_bytes()) as f64 / w.len().max(1) as f64;
        if d > best_density { best_density = d; best = w.to_string(); }
    }
    if best.is_empty() { window(text, 0, budget).to_string() } else { best }
}

pub fn match_aperture(intent: &[Doc], reality: &[Doc], tolerance: f64) -> Out {
    let sum = |d: &[Doc]| -> usize { d.iter().map(|x| x.text.len()).sum() };
    let i_raw = sum(intent);
    let r_raw = sum(reality);
    let mut rows: Vec<Row> = Vec::new();
    let target = (std::cmp::max(1, std::cmp::min(i_raw, r_raw)) as f64) * tolerance;

    let mut cut = |docs: &[Doc], side: &str, raw: usize, rows: &mut Vec<Row>| -> String {
        let mut parts: Vec<String> = Vec::new();
        for d in docs {
            let len = d.text.len();
            let share = if raw > 0 { len as f64 / raw as f64 } else { 0.0 };
            // Floored so a small document is never cut to nothing: a document reduced to zero bytes
            // is a document silently excluded from the reading.
            let budget = if (raw as f64) <= target { len } else { std::cmp::max(MIN_DOC_BYTES, (target * share) as usize) };
            let used = pick_window(&d.text, budget);
            rows.push(Row { side: side.to_string(), path: d.path.clone(), raw_bytes: len,
                used_bytes: used.len(), share_pct: (share * 1000.0).round() / 10.0,
                truncated: used.len() < len });
            parts.push(used);
        }
        parts.join("\n")
    };

    let i_text = cut(intent, "intent", i_raw, &mut rows);
    let r_text = cut(reality, "reality", r_raw, &mut rows);
    let i_gz = lens::node_gzip_len(if i_text.is_empty() { b" " } else { i_text.as_bytes() });
    let r_gz = lens::node_gzip_len(if r_text.is_empty() { b" " } else { r_text.as_bytes() });
    let ratio = |a: usize, b: usize| -> f64 {
        ((100 * std::cmp::max(a, b)) as f64 / std::cmp::max(1, std::cmp::min(a, b)) as f64).round() / 100.0
    };
    let used_ratio = ratio(i_text.len(), r_text.len());
    let matched = used_ratio <= tolerance * 1.6;
    let admissible = i_gz >= MIN_GZIP_BYTES && r_gz >= MIN_GZIP_BYTES;
    let reason = if !admissible {
        Some(format!("below the phantom-mass floor after matching (gzip {}/{} < {}) — matched, and still too thin to read", i_gz, r_gz, MIN_GZIP_BYTES))
    } else if !matched {
        Some(format!("sides still differ by {}× after cutting — the reading is length-dominated", used_ratio))
    } else { None };

    Out {
        intent_bytes: i_text.len(), reality_bytes: r_text.len(),
        intent: i_text, reality: r_text, rows,
        raw_ratio: ratio(i_raw, r_raw), used_ratio, matched, admissible,
        intent_gzip: i_gz, reality_gzip: r_gz, floor: MIN_GZIP_BYTES, tolerance,
        reason, engine: "rust-aperture".to_string(),
    }
}

pub fn run(_args: &[String]) {
    let mut buf = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut buf).is_err() {
        eprintln!("--aperture: could not read stdin");
        std::process::exit(2);
    }
    let input: In = match serde_json::from_str(&buf) {
        Ok(v) => v,
        // A door that cannot open reports that it could not open. It never returns a pass.
        Err(e) => { eprintln!("--aperture: stdin is not the expected object ({e})"); std::process::exit(2); }
    };
    let out = match_aperture(&input.intent, &input.reality, input.tolerance);
    println!("{}", serde_json::to_string(&out).unwrap());
}
