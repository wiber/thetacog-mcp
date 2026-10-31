// src/hud.rs — the HUD reading's one home (C752): the window cut, the walk options, the fold, the colours, and the
// single-shot `reading` that composes them.
//
// pmu-onchip's own hud.rs (the bin crate, C748) runs the streaming server for `--hud-serve`: the debounce timer, the
// grid, the freeze gate, the restart caps. Those are a process, so they stay there. Everything that decides WHAT a
// reading says lives here, and the server imports it (`pub use intentguard::hud::{…}`), so `--hud-serve` and the napi
// addon's `hudReading` reach one window, one walk, one fold. A second copy of any of these would let the two doors print
// different heat hashes for the same text, which is the exact failure the contract's same-hash rule exists to catch
// (docs/specs/vna/HUD-NAPI-CONTRACT.md).
//
// Sufficient for: one window of text reaches the same walk and fold as one event of `--hud-serve` on that window.
// NOT sufficient for: the server's debounce decision (whether THIS window would have been walked at all), or whether
// either placement is right (Rice).

use crate::hud_config::{self, HudConfigFile};
use crate::lattice;
use crate::walk_lens::{self, LensOpts};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

pub fn sha12(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    let d = h.finalize();
    d.iter().take(6).map(|b| format!("{:02x}", b)).collect()
}

/// The walk options every HUD reading runs: the full walk (the binary's own defaults) plus the seed aperture the walk door
/// passes for every non-commit source, source "hud". `budget_ms` bounds the walk (C751); the fold reads the config and
/// never the walk's --top-k.
pub fn lens_opts(repo: &Path, budget_ms: Option<u64>) -> LensOpts {
    let mut walk_args: Vec<String> = ["--lens", "--seed", "matched", "--guided-passes", "2", "--matched-cut", "--worms", "2", "--worms-orthogonal", "--perm", "8"].iter().map(|s| s.to_string()).collect();
    if let Some(b) = budget_ms { walk_args.push("--budget-ms".into()); walk_args.push(b.to_string()); }
    LensOpts { args: [walk_args, vec!["--repo".to_string(), repo.to_string_lossy().to_string()]].concat(), source: "hud".into() }
}

/// Trim to window_words words from the end, joined by single spaces, then cut to max_chars from the head (the walk door's own cap).
/// Returns the window and, when the cut dropped characters, how many the window held before the cut (the reading says so, C751).
pub fn window(text: &str, window_words: usize, max_chars: usize) -> (String, Option<usize>) {
    let words: Vec<&str> = text.split_whitespace().collect();
    let from = words.len().saturating_sub(window_words);
    let joined = words[from..].join(" ");
    let held = joined.chars().count();
    if held > max_chars { (joined.chars().take(max_chars).collect(), Some(held)) } else { (joined, None) }
}

/// The js band rule, ported exactly from scripts/vna/hud-read.mjs colourOf: share of the max heat above 0.66 is hot, above 0.33 warm, else cool; no max is cold.
pub fn band_of(v: f64, max: f64) -> &'static str {
    if max == 0.0 { "cold" } else if v / max > 0.66 { "hot" } else if v / max > 0.33 { "warm" } else { "cool" }
}

/// The grid colour: the 2x2 of (seed admissible) x (heat share above ncd_green). Admissible and above is green, neither is red,
/// either one alone is amber. The band (hot/warm/cool/cold, the js rule) rides on the cell beside it.
pub fn colour_of(admissible: bool, share: f64, ncd_green: f64) -> &'static str {
    match (admissible, share > ncd_green) { (true, true) => "green", (false, false) => "red", _ => "amber" }
}

// ── the three words of a cell (C754, re-cut 2026-10-13) ──────────────────────────────────────────────────────────────
// Every cell shows three WORDS heard in the window, never a lane name: the tier pair is the legend's, outside the grid. The words are
// the three the canonical sensor, gzip-NCD (walk_lens::node_gzip_len), says point at this tier intersection more than at the other
// eight (cell_words). LLM-free, a pure function of (window, library, slot), so the receipt stays re-runnable.

const STOP: &[&str] = &["the", "and", "that", "this", "with", "from", "into", "have", "has", "had", "was", "were", "are", "for",
    "not", "but", "you", "your", "they", "them", "their", "what", "when", "where", "which", "who", "will", "would", "could",
    "should", "there", "here", "then", "than", "just", "like", "also", "only", "very", "some", "more", "most", "such", "each",
    "about", "over", "under", "been", "being", "does", "did", "doing", "can", "its", "it's", "our", "out", "all", "any", "one",
    "two", "how", "why", "because", "while", "these", "those", "make", "made", "get", "got", "let", "lets", "need", "want"];

/// The window's distinct candidate words, in order of first appearance: surrounding punctuation trimmed (inner . / _ : - kept,
/// so a path or a trait survives), at least three alphanumerics, no stopword.
pub fn tokens(window: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for raw in window.split_whitespace() {
        let t = raw.trim_matches(|c: char| !(c.is_alphanumeric() || c == '/' || c == '_'));
        if t.chars().filter(|c| c.is_alphanumeric()).count() < 3 { continue; }
        let key = t.to_lowercase();
        // a path is an address, not a word (operator 2026-10-13: "it's unlikely to see path names … it usually just one word with the color and
        // size on each line"): a token carrying a / never reaches a cell
        if t.contains('/') { continue; }
        // a sha, a timestamp or a count is an address, not a word: at least half its characters are letters
        if t.chars().filter(|c| c.is_ascii_digit()).count() * 2 >= t.chars().count() { continue; }
        if STOP.contains(&key.as_str()) || !seen.insert(key) { continue; }
        out.push(t.to_string());
    }
    out
}

/// An artifact token names code: a path, a module path, a snake_case or CamelCase identifier, or a file with an extension.
pub fn is_artifact(t: &str) -> bool {
    let inner_dot = t.char_indices().any(|(i, c)| c == '.' && i > 0 && t[i + 1..].chars().next().map_or(false, |n| n.is_alphanumeric()));
    let camel = t.chars().zip(t.chars().skip(1)).any(|(a, b)| a.is_lowercase() && b.is_uppercase());
    t.contains('/') || t.contains("::") || t.contains('_') || inner_dot || camel
}

fn gz(s: &str) -> f64 { walk_lens::node_gzip_len(s.as_bytes()) as f64 }
fn ncd(a: &str, ga: f64, b: &str, gb: f64) -> f64 {
    let gab = gz(&format!("{} {}", a, b));
    (gab - ga.min(gb)) / ga.max(gb).max(1.0)
}

/// Unix milliseconds as an ISO-8601 UTC string (the server's `at` and the single-shot reading's, one home since 2026-10-13).
pub fn iso(ms: u64) -> String {
    let (days, rem) = (ms / 86_400_000, ms % 86_400_000);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, m, d, rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000)
}

/// Each candidate word's signal for each of the nine intersections (operator 2026-10-13: *"the 3 words are now mixxed - they should
/// probably be just the 3 most meaningful words the ncd / l1 can point at in that strat / tac for example intersection"* · *"max
/// signal"*). For snippet j, d_j(t) = ncd(t, snippet_j) is z-normalised over the window's words (the off-diagonal snippets are about
/// twice the diagonal ones' length, and raw NCD rewards the short ones, measured 2026-10-13 on the live window), then
/// signal(t, k) = mean_{j≠k} z_j(t) − z_k(t): how much nearer t sits to THIS intersection than to the others, in that column's own
/// spread. A word every snippet is equally near scores 0, so a word heard everywhere cannot win a cell it does not point at. Only the
/// snippets the library holds are compared. Sufficient for: which heard words this intersection's snippet points at more than the rest.
/// Not sufficient for: whether they are the right words (Rice), nor much at all on a window of a few words — gzip at word scale moves
/// a byte or two, so the ranking is coarse and is shown with its number.
pub fn word_signals(toks: &[String], snippets: &[String; 9]) -> Vec<[f64; 9]> {
    let have: Vec<bool> = snippets.iter().map(|x| !x.trim().is_empty()).collect();
    let gs: Vec<f64> = snippets.iter().map(|x| gz(x)).collect();
    let d: Vec<[f64; 9]> = toks.iter().map(|t| { let g = gz(t); std::array::from_fn(|j| if have[j] { ncd(t, g, &snippets[j], gs[j]) } else { 0.0 }) }).collect();
    let n = d.len().max(1) as f64;
    let z: Vec<[f64; 9]> = {
        let mu: [f64; 9] = std::array::from_fn(|j| d.iter().map(|r| r[j]).sum::<f64>() / n);
        let sd: [f64; 9] = std::array::from_fn(|j| { let v = (d.iter().map(|r| (r[j] - mu[j]).powi(2)).sum::<f64>() / n).sqrt(); if v > 0.0 { v } else { 1.0 } });
        d.iter().map(|r| std::array::from_fn(|j| (r[j] - mu[j]) / sd[j])).collect()
    };
    z.iter().map(|r| std::array::from_fn(|k| {
        if !have[k] { return 0.0; }
        let others: Vec<f64> = (0..9).filter(|&j| j != k && have[j]).map(|j| r[j]).collect();
        let rest = if others.is_empty() { 0.0 } else { others.iter().sum::<f64>() / others.len() as f64 };
        ((rest - r[k]) * 1e4).round() / 1e4
    })).collect()
}

/// The cell's three words: the top three by signal for slot k, best first. A word already shown in another slot is the last choice
/// (fresh first, then any, so slots differ where the window allows).
pub fn cell_words(toks: &[String], sig: &[[f64; 9]], k: usize, shown: &[String]) -> [Option<(String, f64)>; 3] {
    cell_words_by(toks, sig, &vec![0.0; toks.len()], k, shown)
}

/// How much each heard word SURPRISES the window it was heard in (operator 2026-10-13: *"max signal (max surprise while listening?)"*):
/// surprise(t) = gz(window + t) − gz(window), the bytes t adds to what was already heard. A word the window already carries (repeated,
/// or built of its common parts) adds little; a fresh one adds more. It never outranks signal: it breaks a tie in signal, which gzip at
/// word scale makes common (three words read 0.1462 on the live window, 2026-10-13). Sufficient for: which of two equally pointed words
/// the window predicted less. Not sufficient for: whether a listener was surprised (UNMEASURED: no reading of the listener).
pub fn word_surprise(toks: &[String], window: &str) -> Vec<f64> {
    let base = gz(window);
    toks.iter().map(|t| gz(&format!("{} {}", window, t)) - base).collect()
}

/// cell_words with the tie broken by surprise: signal first, then the more surprising word, then the word itself (re-runnable).
pub fn cell_words_by(toks: &[String], sig: &[[f64; 9]], surprise: &[f64], k: usize, shown: &[String]) -> [Option<(String, f64)>; 3] {
    let sur = |t: &str| toks.iter().position(|x| x == t).and_then(|i| surprise.get(i)).copied().unwrap_or(0.0);
    let order = |a: &(String, f64), b: &(String, f64)| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
        .then(sur(&b.0).partial_cmp(&sur(&a.0)).unwrap_or(std::cmp::Ordering::Equal)).then(a.0.cmp(&b.0));
    let mut scored: Vec<(String, f64)> = toks.iter().zip(sig).map(|(t, s)| (t.clone(), s[k])).collect();
    scored.sort_by(|a, b| order(a, b));
    let mut out: [Option<(String, f64)>; 3] = [None, None, None];
    let mut n = 0;
    for pass in [true, false] {
        for (t, v) in &scored {
            if n == 3 { break; }
            if out.iter().flatten().any(|(u, _)| u == t) || (pass && shown.contains(t)) { continue; }
            out[n] = Some((t.clone(), *v)); n += 1;
        }
    }
    // the fresh-first pass picks which three; the cell then shows them best first, so the centre line is always the strongest
    // (caught by c783 on a live window: a reused word with the top signal had landed on the bottom line)
    out.sort_by(|a, b| match (a, b) { (Some(x), Some(y)) => order(x, y), (Some(_), None) => std::cmp::Ordering::Less, (None, Some(_)) => std::cmp::Ordering::Greater, _ => std::cmp::Ordering::Equal });
    out
}

/// The tier of an axis label: A, A1, A2, A3 → 0 (Strategy) · B… → 1 (Tactics) · C… → 2 (Operations).
pub fn tier_of(axis: &str) -> usize { match axis.as_bytes().first() { Some(b'A') => 0, Some(b'B') => 1, _ => 2 } }
/// The three tier names, in slot order; the page paints them as the axis header outside the grid (H2).
pub const TIERS: [&str; 3] = ["Strategy", "Tactics", "Operations"];

/// Fold the 144 heat to the NINE tier intersections (H2, operator 2026-10-12: "the 3x3 are the intersections of strategy tactics
/// operations"): slot = row tier × 3 + column tier, always all nine, at fixed positions. A slot's heat is the sum of the 144 heat over
/// every cell whose row axis and column axis fall in that tier pair. Its three words are heard in `window` (cell_words, scored against
/// the tier-pair cell's own snippet, A,A … C,C); a word already shown in another slot is the last choice, so slots differ where the
/// window allows. Colour: seed admissible × the slot's share of the hottest slot above ncd_green. No library, or no word left, reads
/// UNMEASURED — never a lane name. The landed lane rides on the cell as `lane`. Returns None when the heat is not a 144-field.
pub fn fold(heat: &Value, result: &Value, ncd_green: f64, window: &str, lib: Option<&walk_lens::Library>) -> Option<Vec<Value>> {
    fold_ctx(heat, result, ncd_green, window, "", 0, lib)
}

/// The candidate words of a reading (operator 2026-10-15: *"make sure this runs on all context we have available, transcripts too"*):
/// the window's own words first, then up to `context_words` distinct words of the context pool — one pool line per source, the sources
/// taking turns, each newest first — a word the window already holds counted once. Returns the words and,
/// per word, whether it came from the window. Sufficient for: which words the cells may show. Not sufficient for: the placement, which
/// stays the window's walk (the walk door caps a walk at max_chars, so the pool feeds the words and never the heat).
pub fn candidates(window: &str, context: &str, context_words: usize) -> (Vec<String>, Vec<bool>) {
    let mut toks = tokens(window);
    let mut seen: std::collections::HashSet<String> = toks.iter().map(|t| t.to_lowercase()).collect();
    let mut from_window = vec![true; toks.len()];
    if context_words > 0 && !context.trim().is_empty() {
        // one line of the pool is one source (hud-context.mjs joins its sources with a newline); each is read backwards, so a word heard
        // early and again late ranks by its LAST appearance, and the sources take turns, so a long live source cannot crowd the
        // transcripts out of the words scored
        let mut lanes: Vec<std::vec::IntoIter<String>> = context.lines().filter(|l| !l.trim().is_empty())
            .map(|l| tokens(&l.split_whitespace().rev().collect::<Vec<_>>().join(" ")).into_iter()).collect();
        let mut n = 0;
        while n < context_words && !lanes.is_empty() {
            lanes.retain(|l| l.len() > 0);
            for lane in lanes.iter_mut() {
                if n >= context_words { break; }
                while let Some(t) = lane.next() { if seen.insert(t.to_lowercase()) { toks.push(t); from_window.push(false); n += 1; break; } }
            }
        }
    }
    (toks, from_window)
}

/// fold, with the cell words drawn from the window AND the context pool (`candidates`); the heat, the colour and the band are the
/// window's walk alone. Each ranked word carries `from`: "window" or "context". An empty pool picks the same words as the old fold.
pub fn fold_ctx(heat: &Value, result: &Value, ncd_green: f64, window: &str, context: &str, context_words: usize, lib: Option<&walk_lens::Library>) -> Option<Vec<Value>> {
    let arr = heat.as_array()?;
    if arr.len() != lattice::CELLS { return None; }
    let h: Vec<f64> = arr.iter().map(|x| x.as_f64().unwrap_or(0.0).abs()).collect();
    let mut pair = [0.0f64; 9];
    for (i, v) in h.iter().enumerate() {
        let (r, c) = (tier_of(lattice::AXES[i / lattice::SIDE]), tier_of(lattice::AXES[i % lattice::SIDE]));
        pair[r * 3 + c] += v;
    }
    let max = pair.iter().cloned().fold(0.0f64, f64::max);
    let lane: Option<String> = result.get("lane").and_then(Value::as_str).map(String::from)
        .or_else(|| result.get("ratchet").and_then(|r| r.get("winner")).and_then(Value::as_str).filter(|w| *w != "none").map(String::from));
    let ncd = result.get("ncd").and_then(Value::as_f64).or_else(|| result.get("seed_fit").and_then(|f| f.get("gain")).and_then(Value::as_f64));
    let admissible = result.get("seed_fit").and_then(|f| f.get("better_than_random")).and_then(Value::as_bool).unwrap_or(false);
    let (toks, from_window) = candidates(window, context, context_words);
    let mut shown: Vec<String> = vec![];
    // the nine intersection snippets the words are scored against: the tier-pair cells A,A · A,B · … · C,C of the one library
    let snippets: [String; 9] = std::array::from_fn(|q| lib.and_then(|l| l.targets.get((q / 3) * lattice::SIDE + q % 3)).cloned().unwrap_or_default());
    let sig = if lib.is_some() { word_signals(&toks, &snippets) } else { vec![] };
    let surprise = word_surprise(&toks, window);
    let mut cells: Vec<Value> = (0..9).map(|slot| {
        let (r, c) = (slot / 3, slot % 3);
        let cell = r * lattice::SIDE + c;   // the tier-pair cell itself: A,A · A,B · … · C,C
        let words = match lib { Some(_) => cell_words_by(&toks, &sig, &surprise, slot, &shown), None => [None, None, None] };
        for (w, _) in words.iter().flatten() { shown.push(w.clone()); }
        let word = |w: &Option<(String, f64)>| w.as_ref().map(|x| x.0.clone()).unwrap_or_else(|| "UNMEASURED".to_string());
        let ranked: Vec<Value> = words.iter().flatten().map(|(w, v)| { let i = toks.iter().position(|x| x == w); json!({ "word": w, "signal": v, "surprise": i.and_then(|i| surprise.get(i)).copied(), "from": if i.and_then(|i| from_window.get(i)).copied().unwrap_or(true) { "window" } else { "context" } }) }).collect();
        let share = if max > 0.0 { pair[slot] / max } else { 0.0 };
        json!({
            "slot": slot, "cell": cell, "coord": lattice::index_coord(cell), "tiers": [TIERS[r], TIERS[c]],
            // the page's three lines: the strongest word in the centre (tactics, 14pt), the second on top, the third at the bottom;
            // the keys keep their names so every reader of a cell still finds them, and "words" carries the ranked list with its signal
            "tactics": word(&words[0]), "strategy": word(&words[1]), "operations": word(&words[2]), "words": ranked,
            "colour": colour_of(admissible, share, ncd_green), "band": band_of(pair[slot], max),
            "heat": (pair[slot] * 1e6).round() / 1e6, "ncd": ncd, "lane": lane,
            "why": format!("{} × {} · heat {:.3}{}", TIERS[r], TIERS[c], pair[slot], if admissible { "" } else { " · not admissible" }),
        })
    }).collect();
    // 2026-10-13 (operator: "sizes of the letters in the cells can be relevant to ncd confidence of the triad - add colors and whatever increases
    // sensemaking"): each ranked word's weight is its signal against the strongest word on the whole grid, clamped to [0, 1] — the page sizes and
    // tints the word by it and decides nothing. A grid with no positive signal weighs every word 0.
    let top = cells.iter().flat_map(|c| c["words"].as_array().cloned().unwrap_or_default()).filter_map(|w| w["signal"].as_f64()).fold(0.0f64, f64::max);
    for c in cells.iter_mut() {
        if let Some(ws) = c["words"].as_array_mut() {
            for w in ws.iter_mut() { let v = w["signal"].as_f64().unwrap_or(0.0); w["weight"] = json!(if top > 0.0 { ((v / top).max(0.0).min(1.0) * 1000.0).round() / 1000.0 } else { 0.0 }); }
        }
    }
    Some(cells)
}

/// One axis's heat: the sum of the field over its row and its column (the diagonal cell counted once) and the index of the
/// hottest cell inside that row+column (ties to the lower index, so the reading is re-runnable). None when the axis is empty.
pub fn axis_heat(h: &[f64], axis_i: usize) -> (f64, Option<usize>) {
    let n = lattice::SIDE;
    let mut sum = 0.0;
    let mut best: Option<usize> = None;
    let mut see = |i: usize| { sum += h[i]; if h[i] > 0.0 && best.map_or(true, |b| h[i] > h[b]) { best = Some(i); } };
    for j in 0..n { see(axis_i * n + j); }
    for i in 0..n { if i != axis_i { see(i * n + axis_i); } }
    (sum, best)
}

/// `hud::reading(text, config_json, repo)` — one text, one placement, no process: the config's window over `text`, the walk
/// `lens_opts` names, the fold onto the nine fixed child-axis cells (C778; the config's ncd_green colours them, its top_k no longer places). `config_json` is the text of data/vna/hud-config.json; an empty
/// string reads the crate defaults and the reading says so (`walk.config_loaded: false`). `heat_hash` is sha12 of the 144 heat as
/// `--hud-serve` prints it, so the two doors compare by one field.
pub fn reading(text: &str, config_json: &str, repo: &Path) -> Value {
    let (cfg, loaded): (HudConfigFile, bool) = if config_json.trim().is_empty() {
        (HudConfigFile::default(), false)
    } else {
        match serde_json::from_str::<Value>(config_json) {
            Ok(v) => (hud_config::from_value(&v), true),
            Err(e) => return json!({ "kind": "reading", "walk": { "ok": false, "why": format!("config is not JSON: {}", e) }, "cells": [] }),
        }
    };
    let (w, cut_from) = window(text, cfg.window_words, cfg.max_chars);
    if w.trim().is_empty() {
        return json!({ "kind": "reading", "walk": { "ok": false, "why": "empty window: nothing to walk" }, "cells": [], "config_loaded": loaded });
    }
    let t0 = std::time::Instant::now();
    match walk_lens::read_text(&w, &lens_opts(repo, None), repo) {
        Ok(result) => {
            let ms = t0.elapsed().as_secs_f64() * 1000.0;
            let heat = result.get("heat").cloned().unwrap_or(Value::Null);
            let lib = walk_lens::load_library(&repo.join("data/pmu/snippet-library-144.json")).ok();
            match fold(&heat, &result, cfg.grid().ncd_green, &w, lib.as_ref()) {
                // the server's reading-event key set, so the napi door and the node door are one shape (C774, kept at the merge):
                // at · source · heard_from · capped as --hud-serve prints them; config_loaded rides inside walk
                Some(cells) => json!({
                    "kind": "reading", "at": iso(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)),
                    "window_sha": sha12(&w), "text_sha": sha12(&w), "words": w.split_whitespace().count(),
                    "source": cfg.walk_source, "heard_from": "napi", "cells": cells,
                    "walk": { "ok": true, "why": Value::Null, "ms": ms, "pixel": result.get("pixel").cloned().unwrap_or(Value::Null), "config_loaded": loaded },
                    "heat_hash": sha12(&heat.to_string()), "result": result,
                    // 2026-10-15: the napi door reads one text and holds no context pool, so its reading names none (the server's key, null)
                    "context": Value::Null,
                    "capped": cut_from.map(|h| json!({ "from_chars": h, "to_chars": cfg.max_chars, "why": format!("the text event held {} chars; the window is capped at max_chars {} (the walk door's head cap)", h, cfg.max_chars) })).unwrap_or(Value::Null),
                }),
                None => json!({ "kind": "reading", "walk": { "ok": false, "why": "walk returned no 144-cell heat field", "ms": ms }, "cells": [], "result": result }),
            }
        }
        Err(e) => json!({ "kind": "reading", "walk": { "ok": false, "why": e }, "cells": [] }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pool_feeds_words_from_every_source_in_turn() {
        // operator 2026-10-15 ("make sure this runs on all context we have available, transcripts too"): the window's words first, then
        // the pool's sources take turns, each newest first, so a long live source cannot crowd the transcripts out of the words scored
        let pool = "transcript alpha transcript bravo transcript charlie\nspeech delta speech echo speech foxtrot speech golf speech hotel";
        let (toks, from) = candidates("window kilo", pool, 4);
        assert_eq!(toks, vec!["window", "kilo", "charlie", "hotel", "transcript", "speech"], "turns across the two sources, each newest first");
        assert_eq!(from, vec![true, true, false, false, false, false]);
        let (t0, _) = candidates("window kilo", "", 400);
        assert_eq!(t0, tokens("window kilo"), "an empty pool is the window's own words");
        let (t1, f1) = candidates("Window kilo", "window lima", 9);
        assert_eq!(t1, vec!["Window", "kilo", "lima"], "a word the window holds is counted once, case aside");
        assert_eq!(f1, vec![true, true, false]);
    }

    #[test]
    fn the_window_keeps_the_last_words_then_cuts_chars() {
        assert_eq!(window("a b c d", 2, 800), ("c d".to_string(), None));
        assert_eq!(window("abcdef", 60, 4), ("abcd".to_string(), Some(6)));
    }

    #[test]
    fn an_empty_window_and_bad_config_refuse_with_a_why() {
        let repo = std::env::current_dir().unwrap();
        assert_eq!(reading("   ", "", &repo)["walk"]["why"], json!("empty window: nothing to walk"));
        assert!(reading("text", "{nope", &repo)["walk"]["why"].as_str().unwrap().starts_with("config is not JSON"));
    }

    #[test]
    fn the_words_are_ranked_by_how_much_more_they_point_at_this_intersection() {
        // 2026-10-13 ("the 3 most meaningful words the ncd / l1 can point at in that intersection"): each slot's snippet is one word
        // family; the window's word from that family is the slot's best word, a word every snippet shares cannot outrank it
        let mut snippets: [String; 9] = std::array::from_fn(|_| String::new());
        for (k, fam) in ["capital charter mandate", "leverage gambit wedge", "pipeline artifact crate", "doctrine ledger covenant", "tempo cadence beat",
                         "throughput buffer queue", "horizon compass bearing", "signal probe sensor", "kernel module binary"].iter().enumerate() { snippets[k] = fam.to_string(); }
        let toks = tokens("the charter and the wedge feed a crate while the tempo holds, the sensor reads the binary and everything moves everything");
        let sig = word_signals(&toks, &snippets);
        for (k, want) in [(0, "charter"), (1, "wedge"), (2, "crate"), (4, "tempo"), (7, "sensor"), (8, "binary")] {
            let w = cell_words(&toks, &sig, k, &[]);
            assert_eq!(w[0].as_ref().unwrap().0, want, "slot {} leads with its own word: {:?}", k, w);
            let s: Vec<f64> = w.iter().flatten().map(|x| x.1).collect();
            assert!(s.windows(2).all(|p| p[0] >= p[1]), "best first: {:?}", s);
        }
        assert_eq!(word_signals(&toks, &snippets), sig, "a pure function of the bytes");
        assert!(!tokens("sha 9a52f96e at 2026-10-13T01:17:01Z and the sensor").iter().any(|t| t.starts_with("9a5") || t.starts_with("2026")), "addresses are not words");
        assert!(!tokens("git commit --amend -F '/Users/thetacoach/x/trailer-message-9a8b24ea.txt' and crates/io/sink.rs").iter().any(|t| t.contains('/')), "a path is not a word");
        // the weight: the strongest word on the grid weighs 1, every other its signal's share of it, never outside [0, 1]
        let heat: Vec<f64> = (0..144).map(|i| if i % 13 == 0 { 1.0 } else { 0.0 }).collect();
        let lib = walk_lens::Library { coords: (0..144).map(lattice::index_coord).collect(), targets: (0..144).map(|i| if (i / 12) < 3 && (i % 12) < 3 { snippets[(i / 12) * 3 + i % 12].clone() } else { String::new() }).collect() };
        let folded = fold(&json!(heat), &json!({ "seed_fit": { "better_than_random": true, "gain": 0.4 } }), 0.25, "the charter and the wedge feed a crate while the tempo holds, the sensor reads the binary", Some(&lib)).unwrap();
        let ws: Vec<f64> = folded.iter().flat_map(|c| c["words"].as_array().cloned().unwrap_or_default()).map(|w| w["weight"].as_f64().unwrap()).collect();
        assert!(ws.iter().all(|w| (0.0..=1.0).contains(w)), "weights in [0, 1]: {:?}", ws);
        assert!(ws.iter().any(|w| *w == 1.0), "the strongest word weighs 1");
        // surprise breaks a tie in signal and never outranks it: two words at one signal order by the bytes each adds to the window
        let tie: [[f64; 9]; 2] = [[0.5; 9], [0.5; 9]];
        let tt = vec!["tempo".to_string(), "xylophone".to_string()];
        let su = word_surprise(&tt, "tempo tempo tempo the tempo holds");
        assert!(su[1] > su[0], "a word the window already carries adds fewer bytes: {:?}", su);
        assert_eq!(cell_words_by(&tt, &tie, &su, 0, &[])[0].as_ref().unwrap().0, "xylophone", "the tie goes to the more surprising word");
        let lead: [[f64; 9]; 2] = [[0.9; 9], [0.5; 9]];
        assert_eq!(cell_words_by(&tt, &lead, &su, 0, &[])[0].as_ref().unwrap().0, "tempo", "surprise never outranks signal");
        // a word shown in another slot is the last choice while a fresh one remains
        let shown = vec!["charter".to_string()];
        assert_ne!(cell_words(&toks, &sig, 0, &shown)[0].as_ref().unwrap().0, "charter");
    }

    // I7 THE TIER FOLD (docs/specs/vna/HUD-FORMAL-METHODS.md, re-cut 2026-10-13 for the design main kept): for EVERY 144-field, the fold
    // returns nine cells, slot k is the tier pair (k / 3, k % 3) and its coordinate the tier-pair cell; the nine heats conserve the
    // field's total heat; and the fold is a function of the bytes.
    mod tier_fold_prop {
        use super::*;
        use proptest::prelude::*;
        fn field() -> impl Strategy<Value = Vec<f64>> {
            proptest::collection::vec(prop_oneof![8 => Just(0.0f64), 2 => (0.0f64..10.0)], lattice::CELLS)
        }
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]
            #[test]
            fn i7_the_tier_fold_holds_for_every_field(h in field()) {
                let cells = fold(&json!(h), &json!({}), 0.25, "", None).unwrap();
                prop_assert_eq!(cells.len(), 9);
                let mut sum = 0.0;
                for (k, c) in cells.iter().enumerate() {
                    prop_assert_eq!(c["slot"].as_u64().unwrap() as usize, k);
                    prop_assert_eq!(c["coord"].as_str().unwrap(), lattice::index_coord((k / 3) * lattice::SIDE + k % 3));
                    sum += c["heat"].as_f64().unwrap();
                }
                let total: f64 = h.iter().sum();
                prop_assert!((sum - total).abs() <= 1e-4 * (1.0 + total), "heat conserved: {} vs {}", sum, total);
                prop_assert_eq!(fold(&json!(h), &json!({}), 0.25, "", None), fold(&json!(h.clone()), &json!({}), 0.25, "", None));
            }
        }
    }


    #[test]
    fn c762_axis_heat_sums_the_row_and_the_column_with_the_diagonal_once() {
        let mut h = vec![0.0f64; 144];
        h[3 * 12 + 3] = 2.0; h[3 * 12 + 7] = 1.0; h[5 * 12 + 3] = 4.0;
        let (sum, best) = axis_heat(&h, 3);
        assert_eq!(sum, 7.0); assert_eq!(best, Some(5 * 12 + 3));
        assert_eq!(axis_heat(&h, 4), (0.0, None));
    }
}
