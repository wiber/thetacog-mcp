// .thetacog/pmu/src/lens.rs — P2 of docs/pmu/one-pipeline-spec.md: `pmu-onchip --lens`.
//
// THE COMPOSED PER-PROMPT PIPELINE IN ONE PROCESS: gzip-NCD seed over the 144 snippet
// targets → the recursive guided definer walk (row → transpose → row, per-hop row reads as
// IN-CRATE ballistic_walk calls — the whole point: no `pmu-onchip --ballistic` process
// spawn per hop) → σ (z-margin over the walk heat) → the Chebyshev fence in 12×12 block
// space → the in_role / out_of_role partition of the walked coordinates.
//
// FAITHFUL PORT — the JS semantics WIN (this is a move, not a redesign):
//   · seeding      = src/lib/pmu/unified-drift.mjs   litScores / topSeeds (SEED_K=3, gzip-NCD)
//   · the walk     = scripts/pmu/definer-walk-144.mjs definerWalk144 (frontier BFS over the
//                    144 anchors; rowCells ShortLex-ASCENDING, never weight-sorted; fade =
//                    decay^d paints the whole row into the 20736 matrix; heat ONLY on
//                    FOLLOWED anchors — top-K among UNSEEN∧UNQUEUED; seen/queued exactly as
//                    written; budget = hop bound; budgetMs = wall valve → timeBudgetTripped)
//   · σ / shape    = unified-drift zMargin / norm / shapeFromHeat (SHAPE_FLOOR 0.30)
//   · the fence    = scripts/pmu/prompt-lens.mjs boundaryFromStubSpec (Chebyshev radius in
//                    block space, clamped to the 12×12), blocks via shortlex-coords.mjs AX
//   · the grid     = definer-walk-144 buildDirected(): the cached machine-generated
//                    .thetacog/pmu/reef-connectivity-directed.json when present (the JS side
//                    generates it; we READ it — documented dependency), else the same
//                    axis-share directed build from the library coords.
//
// gzip parity: node bundles CHROMIUM's zlib fork whose hardware-CRC insert_string emits
// different deflate bytes than stock zlib/miniz — vendor/zlib (see build.rs) is that exact
// fork, so gzip_len here == node:zlib gzipSync().length byte-for-byte (289/289 measured).
//
// @canonical-algorithm  guided row→transpose→row definer walk, 144 anchors, per-hop row
//                       reads on the SAME chip in the SAME process (ballistic_walk in-crate)
// @forbidden-alternative any analytic shortcut · weight-sorted following · a flood walk ·
//                       an LLM anywhere in this path (the receipt is LLM-free)
// @guard  tests/pmu-simulator/p2-lens-gate.test.mjs (parity with the JS pipeline)

use crate::ballistic::{self, CELLS, GRID, SHORTLEX};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

// ── the vendored Node/Chromium zlib (deflate side), linked by build.rs ──────────────────
// ONE declaration of the vendored-zlib FFI for the whole crate. png.rs deflates PNG IDAT with the
// same symbols at different settings (zlib wrapper, level 9); declaring them twice with two
// different ZStream types produced a clashing_extern_declarations warning — layout-identical and
// therefore harmless today, and exactly the kind of thing that stops being harmless quietly.
#[repr(C)]
pub(crate) struct ZStream {
    pub(crate) next_in: *mut u8,
    pub(crate) avail_in: u32,
    pub(crate) total_in: std::ffi::c_ulong,
    pub(crate) next_out: *mut u8,
    pub(crate) avail_out: u32,
    pub(crate) total_out: std::ffi::c_ulong,
    pub(crate) msg: *mut std::ffi::c_char,
    pub(crate) state: *mut std::ffi::c_void,
    pub(crate) zalloc: Option<extern "C" fn()>,
    pub(crate) zfree: Option<extern "C" fn()>,
    pub(crate) opaque: *mut std::ffi::c_void,
    pub(crate) data_type: i32,
    pub(crate) adler: std::ffi::c_ulong,
    pub(crate) reserved: std::ffi::c_ulong,
}

extern "C" {
    pub(crate) fn deflateInit2_(
        strm: *mut ZStream,
        level: i32,
        method: i32,
        window_bits: i32,
        mem_level: i32,
        strategy: i32,
        version: *const std::ffi::c_char,
        stream_size: i32,
    ) -> i32;
    pub(crate) fn deflate(strm: *mut ZStream, flush: i32) -> i32;
    pub(crate) fn deflateEnd(strm: *mut ZStream) -> i32;
    pub(crate) fn deflateBound(strm: *mut ZStream, source_len: std::ffi::c_ulong) -> std::ffi::c_ulong;
}

const Z_DEFAULT_COMPRESSION: i32 = -1; // node gzipSync default level
const Z_DEFLATED: i32 = 8;
const Z_DEFAULT_STRATEGY: i32 = 0;
const Z_FINISH: i32 = 4;
const Z_OK: i32 = 0;
const Z_STREAM_END: i32 = 1;
const GZIP_WINDOW_BITS: i32 = 15 + 16; // gzip wrapper, node default windowBits 15
const MEM_LEVEL: i32 = 8; // node default

/// gzip length EXACTLY as node's `gzipSync(Buffer.from(s,'utf8')).length` computes it.
pub fn node_gzip_len(data: &[u8]) -> usize {
    unsafe {
        let mut s: ZStream = std::mem::zeroed();
        let version = b"1.3.1\0";
        let rc = deflateInit2_(
            &mut s,
            Z_DEFAULT_COMPRESSION,
            Z_DEFLATED,
            GZIP_WINDOW_BITS,
            MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
            version.as_ptr() as *const std::ffi::c_char,
            std::mem::size_of::<ZStream>() as i32,
        );
        assert_eq!(rc, Z_OK, "deflateInit2 failed ({})", rc);
        let cap = deflateBound(&mut s, data.len() as std::ffi::c_ulong) as usize + 32;
        let mut out = vec![0u8; cap];
        s.next_in = data.as_ptr() as *mut u8;
        s.avail_in = data.len() as u32;
        s.next_out = out.as_mut_ptr();
        s.avail_out = cap as u32;
        let rc = deflate(&mut s, Z_FINISH);
        assert_eq!(rc, Z_STREAM_END, "deflate(Z_FINISH) failed ({})", rc);
        let len = s.total_out as usize;
        deflateEnd(&mut s);
        len
    }
}

// ── ShortLex rank axes (shortlex-coords.mjs AX) ─────────────────────────────────────────
const AX: [&str; 12] = ["A", "B", "C", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
const NB: i64 = 12;

fn rank_to_index(rank: &str) -> i64 {
    AX.iter().position(|a| *a == rank.trim()).map(|i| i as i64).unwrap_or(-1)
}

/// shortlex-coords.mjs shortLexToBlock: "R,C" → (br, bc); unknown rank → -1 (the JS
/// caller keeps (0,0) on a throw — we mirror that at the call site).
pub(crate) fn shortlex_to_block(coord: &str) -> (i64, i64) {
    let mut parts = coord.split(',');
    let r = parts.next().unwrap_or("");
    let c = parts.next().unwrap_or("");
    (rank_to_index(r), rank_to_index(c))
}

// ── the 144 targets + coords from data/pmu/snippet-library-144.json ─────────────────────
struct Library {
    coords: Vec<String>,  // 144 — anchors[r*12+c].coord, '' where absent
    targets: Vec<String>, // 144 — snippet || seed, '' where absent
}

fn load_library(path: &Path) -> Result<Library, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read snippet library {}: {}", path.display(), e))?;
    let raw: Value =
        serde_json::from_str(&text).map_err(|e| format!("bad JSON in {}: {}", path.display(), e))?;
    let arr: Vec<Value> = if let Some(a) = raw.as_array() {
        a.clone()
    } else {
        raw.get("anchors")
            .or_else(|| raw.get("nodes"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    let mut coords = vec![String::new(); GRID];
    let mut targets = vec![String::new(); GRID];
    for a in &arr {
        let row = a.get("row").and_then(|v| v.as_str()).unwrap_or("");
        let col = a.get("col").and_then(|v| v.as_str()).unwrap_or("");
        let (r, c) = (rank_to_index(row), rank_to_index(col));
        if r >= 0 && c >= 0 {
            let idx = (r * 12 + c) as usize;
            coords[idx] = a.get("coord").and_then(|v| v.as_str()).unwrap_or("").to_string();
            targets[idx] = a
                .get("snippet")
                .or_else(|| a.get("seed"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }
    }
    Ok(Library { coords, targets })
}

// ── the directed connectivity grid (definer-walk-144.mjs buildDirected) ─────────────────
// Prefer the machine-generated cache the JS side maintains (documented dependency); fall
// back to the identical in-memory build. Never write the cache from here (the JS owns it).
fn load_directed_grid(repo: &Path, coords: &[String]) -> Box<[u8; CELLS]> {
    let cache = repo.join(".thetacog/pmu/reef-connectivity-directed.json");
    if let Ok(text) = std::fs::read_to_string(&cache) {
        if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&text) {
            if arr.len() == CELLS {
                let mut g = Box::new([0u8; CELLS]);
                for (k, v) in arr.iter().enumerate() {
                    // JS: Uint8Array.from(parsed, x => (x ? 1 : 0)) — any truthy number lights
                    g[k] = if v.as_f64().unwrap_or(0.0) != 0.0 { 1 } else { 0 };
                }
                return g;
            }
        }
    }
    // buildDirected(): diagonal lit; i→j (j>i) lit when they share the row OR column axis.
    let ax: Vec<(String, String)> = coords
        .iter()
        .map(|c| {
            let s = if c.is_empty() { "A,A" } else { c.as_str() };
            let mut p = s.split(',');
            (
                p.next().unwrap_or("").to_string(),
                p.next().unwrap_or("").to_string(),
            )
        })
        .collect();
    let mut g = Box::new([0u8; CELLS]);
    for i in 0..GRID {
        g[i * GRID + i] = 1;
        for j in (i + 1)..GRID {
            if ax[i].0 == ax[j].0 || ax[i].1 == ax[j].1 {
                g[i * GRID + j] = 1;
            }
        }
    }
    g
}

// ── seeding: litScores + topSeeds (unified-drift.mjs, gzip-NCD, SEED_K = 3) ─────────────
fn ncd_sim(doc_z: usize, doc: &str, snip: &str, snip_z: usize) -> f64 {
    if snip.is_empty() {
        return 0.0;
    }
    let joined = format!("{}\n{}", doc, snip);
    let join_z = node_gzip_len(joined.as_bytes());
    let denom = doc_z.max(snip_z);
    if denom == 0 {
        return 0.0;
    }
    (1.0 - (join_z as f64 - doc_z.min(snip_z) as f64) / denom as f64).max(0.0)
}

fn lit_scores(text: &str, targets: &[String]) -> Vec<f64> {
    if text.trim().is_empty() {
        return vec![0.0; GRID];
    }
    let doc_z = node_gzip_len(text.as_bytes());
    let snip_z: Vec<usize> = targets
        .iter()
        .map(|t| if t.is_empty() { 0 } else { node_gzip_len(t.as_bytes()) })
        .collect();
    targets
        .iter()
        .enumerate()
        .map(|(i, t)| ncd_sim(doc_z, text, t, snip_z[i]))
        .collect()
}

fn top_seeds(scores: &[f64], coords: &[String], k: usize) -> Vec<usize> {
    let mut xs: Vec<(f64, usize)> = scores
        .iter()
        .enumerate()
        .filter(|(i, v)| !coords[*i].is_empty() && **v > 0.0)
        .map(|(i, v)| (*v, i))
        .collect();
    // JS: .sort((a,b) => b[0]-a[0] || a[1]-b[1]) — score DESC, index ASC on ties.
    xs.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.cmp(&b.1)));
    xs.into_iter().take(k).map(|x| x.1).collect()
}

// ── THE MATCHED SEED (2026-09-12) — META-BULK applied to the seed itself ───────────────────
// Operator: "you can't compare an NCD compression distance for a very small seed with a very large
// cell … build up the mass, see what fits at a similarly small aperture, then expand the aperture."
// Measured: cell snippets 671–1,899 chars, prompts median 111; lit_scores on a 25–123 char prompt
// returned the diagonal magnets (C,C · C2,C2 · A,A) with top-5 spreads < 0.002 — length noise.
// Faithful port of src/lib/pmu/compress.mjs placePixelBulked (JS wins on semantics; parity guard):
//   1. bulk the prompt with the lane's mass, capped at BULK_MAX_RATIO × the prompt
//   2. COARSE eye (BULK_EYE_COARSE) on both sides over all 144 → top-K region
//   3. FINE eye (BULK_EYE_FINE) over the region, CALIBRATED: score minus the same cell's score for
//      a same-mass NULL (the intent's words shuffled by the same LCG as the JS) — meaning, not mass
//   4. fit: gain, margin, z over the region, better_than_random (gain ≥ FIT_MIN_GAIN and z ≥ 2)
// Returns a 144-vector (non-region cells = 0, so top_seeds picks inside the region) + the fit.
pub const BULK_EYE_COARSE: usize = 320;
pub const BULK_EYE_FINE: usize = 900;
pub const BULK_TOP_K: usize = 12;
pub const BULK_MAX_RATIO: usize = 2;
pub const FIT_MIN_GAIN: f64 = 0.015;
/// z required for ONE rung to be admissible (the historical z ≥ 2, one-sided p = 0.02275) when n rungs were drawn:
/// the family-wise threshold Φ⁻¹(1 − 0.02275 / n) (Bonferroni; Abramowitz–Stegun 26.2.23 for the inverse normal).
/// Every rung is another draw against a noisy null; without this, more walkers meant more false latches.
// ── THE LATCH RULES, NAMED (spec §7, 2026-09-16). These three functions ARE the stopping rules the live walk runs — the
// ring loop and the thread ladder call them, and harness.rs enumerates every input of the same functions over a finite
// domain. That is the whole point: a property checked on a re-implementation is a property of the re-implementation.
// The bodies are the exact expressions that lived inline in the loops; nothing about the walk changed when they moved.
/// F18 (spec §7.11/§7.13, 2026-09-16) — THE RISE IS A WITNESS, NOT A BOOL. A walker may only latch on a ring if grip has
/// strictly risen at some earlier admissible ring, and the only way to hold that fact is to hold a GripRise, which the one
/// constructor below refuses to build unless to > from. A "latched without ever rising" state is therefore not a case the
/// stop rule can be written for: the compiler wants the witness, and harness.rs enumerates every input to check the value.
#[derive(Clone, Copy, Debug)]
pub struct GripRise { pub from: f64, pub to: f64 }
impl GripRise {
    pub fn witness(prev: Option<f64>, this: Option<f64>) -> Option<GripRise> {
        match (prev, this) { (Some(a), Some(b)) if b > a => Some(GripRise { from: a, to: b }), _ => None }
    }
}
/// The ring latch (shipped): latched on this ring and the previous one, grip has RISEN at some earlier ring (the witness), and
/// this wider ring did not raise it further — an interior maximum. Without a witness the walker widens to the bound; exhausting
/// the rings is not a latch and is never reported as one.
pub fn ring_latch_fires(ok: bool, prev_ok: bool, rise: Option<&GripRise>, g: Option<f64>, prev_grip: Option<f64>) -> bool {
    ok && prev_ok && rise.is_some() && g.unwrap_or(-1.0) <= prev_grip.unwrap_or(-1.0)
}
/// The pre-F18 rule, RETAINED AS THE FALSIFIER ARM (not called by the walk): latched twice and the wider ring did not raise grip
/// — with no rise required, so two admissible rings with flat or absent grip "latched". harness.rs enumerates it beside the
/// shipped rule on the same domain every run, so the fix is a measured delta and the model's power to find the false latch
/// is demonstrated rather than remembered (77 of 80 latches false on 2026-09-16).
pub fn ring_latch_fires_v0(ok: bool, prev_ok: bool, g: Option<f64>, prev_grip: Option<f64>) -> bool {
    ok && prev_ok && g.unwrap_or(-1.0) <= prev_grip.unwrap_or(-1.0)
}
/// The walker's running state after a ring that did not latch: an admissible ring marks prev_ok, takes the rise witness if this
/// ring's grip beat the running grip (the witness is sticky — once grip has risen, a later non-rise is a maximum), and folds its
/// grip in by max.
pub fn ring_prev_after(ok: bool, g: Option<f64>, prev_ok: bool, prev_grip: Option<f64>, rise: Option<GripRise>) -> (bool, Option<f64>, Option<GripRise>) {
    if !ok { return (prev_ok, prev_grip, rise); }
    let rise = rise.or_else(|| GripRise::witness(prev_grip, g));
    (true, match (g, prev_grip) { (Some(a), Some(b)) => Some(a.max(b)), (Some(a), None) => Some(a), (None, b) => b }, rise)
}
/// The thread ladder's grip latch: returns (stop the travel, the next prev_latched_grip). A latched stage that failed to
/// beat the previous latched grip ends the travel; a latched stage that beat it raises the bar; an unlatched stage after
/// a latch ends the travel; an unlatched stage before any latch continues.
pub fn stage_after_latch(latched: bool, stage_grip: f64, prev_latched_grip: Option<f64>) -> (bool, Option<f64>) {
    match (latched, prev_latched_grip) {
        (true, Some(pg)) if stage_grip <= pg => (true, prev_latched_grip),
        (true, _) => (false, Some(stage_grip.max(prev_latched_grip.unwrap_or(f64::NEG_INFINITY)))),
        (false, Some(_)) => (true, prev_latched_grip),
        (false, None) => (false, prev_latched_grip),
    }
}

/// THE PERMUTATION VERDICT, NAMED. w_real is the real ratchet's best gain; w_null the K shuffled winners. Admissible iff the
/// real winner beats every draw (exceed = 0) and stands two null standard deviations above their mean. This was written
/// inline twice (the line null and the thread null); one rule lives in one place, and harness.rs enumerates it (P3).
pub struct PermVerdict { pub n: usize, pub mean: f64, pub std: f64, pub w_max: f64, pub exceed: usize, pub z: f64, pub p: f64, pub ok: bool }
pub fn perm_verdict(w_real: f64, w_null: &[f64]) -> PermVerdict {
    let n = w_null.len() as f64;
    let mean = w_null.iter().sum::<f64>() / n;
    let std = (w_null.iter().map(|w| (w - mean) * (w - mean)).sum::<f64>() / n).sqrt().max(1e-9);
    let w_max = w_null.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let exceed = w_null.iter().filter(|w| **w >= w_real).count();
    let z = (w_real - mean) / std;
    let p = (1.0 + exceed as f64) / (n + 1.0);
    PermVerdict { n: w_null.len(), mean, std, w_max, exceed, z, p, ok: exceed == 0 && z >= 2.0 }
}

pub fn z_required(n: usize) -> f64 {
    let p = 0.02275f64 / (n.max(1) as f64);
    let t = (-2.0 * p.ln()).sqrt();
    t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t)
}

fn cut(s: &str, n: usize) -> &str { match s.char_indices().nth(n) { Some((i, _)) => &s[..i], None => s } }

pub fn shuffle_words(s: &str) -> String { shuffle_words_seeded(s, 7) }
/// The same LCG as the JS, seeded. Seed 7 is THE calibrating null (the parity fixture pins it); the permutation ratchet
/// draws its K further shuffles from other seeds — the same deterministic generator, so a row is re-runnable byte for byte.
pub fn shuffle_words_seeded(s: &str, seed0: u64) -> String {
    let mut w: Vec<&str> = s.split_whitespace().collect();
    let mut seed: u64 = seed0 % 233280;
    if w.len() > 1 { for i in (1..w.len()).rev() { seed = (seed * 9301 + 49297) % 233280; let j = (seed % (i as u64 + 1)) as usize; w.swap(i, j); } }
    w.join(" ")
}
/// THE NULL IS THE LINE'S, inside a thread: a thread text is the line followed by the session's prior prompts
/// (thread_intent_n joins them line-first). The priors are the declared context (W6) and are part of what the question
/// is about — they are never shuffled. Only the line's words are; the rest of the text is kept byte for byte. With no
/// thread (line == text) this is shuffle_words_seeded, so the seed-parity fixture is unchanged.
pub fn shuffle_line_in(text: &str, line: &str, seed: u64) -> String {
    if !line.is_empty() && line != text && text.starts_with(line) { format!("{}{}", shuffle_words_seeded(line, seed), &text[line.len()..]) } else { shuffle_words_seeded(text, seed) }
}

pub struct SeedFit { pub gain: f64, pub margin: f64, pub z_fine: f64, pub better_than_random: bool, pub region: Vec<usize>, pub mass_prompt: usize, pub mass_bulk: usize, pub mass_intent: usize, pub matched_cut: bool, pub coarse_cut: usize, pub fine_cut: usize }

// ── THE TWO-SIDED APERTURE (operator 2026-09-14: "ratchet aperture should mean it branches out wider on
// the side that is too slim until perfect fit"). Measured before this: turn prompts median 160 chars (p10 26),
// bulk capped at 2× the prompt, targets cut at 320/900 — a 26-char line met 320-char snippets, 4× slimmer;
// gzip-NCD at that mismatch is length noise. Two knobs, each a flag so the A/B decides the default:
//   matched_cut — cut the TARGET side down to the intent's own length at both eyes (equal chars = fit)
// Stamped on seed_fit.aperture so a row says which aperture read it.
// ONE aperture rule in the crate: aperture.rs (MATCHED = cut the larger side, ADMISSIBLE = the 220 floor, CUT NEVER
// GROW). matched_cut here means "cut each target snippet with aperture::matched_cut against the intent" — no second
// window function, no second floor constant, and no grow knob (a bulk-fill was measured 2026-09-14 at 29.0% vs 31.7%
// admissible for 3× the ms, and aperture.rs already settled that growing the short side is not the cure).
pub struct SeedAperture { pub matched_cut: bool }
impl Default for SeedAperture { fn default() -> Self { SeedAperture { matched_cut: true } } }   // decided by the replay (rust-pipeline-flowchart §14): 32.3% vs 21.2% admissible
pub fn matched_seed(text: &str, bulk: &str, targets: &[String]) -> (Vec<f64>, SeedFit) { matched_seed_with(text, bulk, targets, &SeedAperture::default()) }
pub fn matched_seed_with(text: &str, bulk: &str, targets: &[String], ap: &SeedAperture) -> (Vec<f64>, SeedFit) {
    matched_seed_parts(text, &[(None, bulk.to_string())], targets, ap)
}

/// THE PARTS-AWARE SEED (operator 2026-09-14: "traverse backwards to find the rules and hats to beef up the …").
/// The mass is a list of parts; a part tagged with a target index is that target's own HAT (its snippet from the
/// 144 library). When target i is scored, the part tagged i is LEFT OUT of the intent — a hat can widen the aperture
/// for every other cell and can never score its own cell. This is the fence against the leak the JS prototype had
/// (76% false green from feeding the evaluator's own targets back as intent); the in-crate test below pins it.
pub fn matched_seed_parts(text: &str, parts: &[(Option<usize>, String)], targets: &[String], ap: &SeedAperture) -> (Vec<f64>, SeedFit) { matched_seed_parts_line(text, text, parts, targets, ap, 7) }
/// The seed with the LINE named: `text` may be a thread (line + priors); the null shuffles only `line` inside it
/// (shuffle_line_in) with `null_seed` (7 = the calibrating null). Every ratchet rung goes through here.
pub fn matched_seed_parts_line(text: &str, line: &str, parts: &[(Option<usize>, String)], targets: &[String], ap: &SeedAperture, null_seed: u64) -> (Vec<f64>, SeedFit) {
    let prompt = text;
    let pchars = prompt.chars().count();
    let allow = pchars * BULK_MAX_RATIO;
    // the intent for target i: prompt + every part except the one tagged i, cut at the bulk allowance and the fine eye
    let build = |skip: Option<usize>| -> (String, String, usize) {
        let mut b = String::new();
        for (tag, p) in parts { if tag.is_some() && *tag == skip { continue; } if p.trim().is_empty() { continue; } if !b.is_empty() { b.push('\n'); } b.push_str(p); }
        let bulk_cut = cut(&b, allow).to_string();
        let intent_full = if bulk_cut.is_empty() { prompt.to_string() } else { format!("{}\n{}", prompt, bulk_cut) };
        let intent = cut(&intent_full, BULK_EYE_FINE).to_string();
        let bulk_chars = bulk_cut.chars().count();
        (intent, bulk_cut, bulk_chars)
    };
    let (intent, bulk_cut, _) = build(None);
    let tagged: HashSet<usize> = parts.iter().filter_map(|(t, _)| *t).collect();
    // per-target intent variants exist only for tagged targets (a handful); everyone else shares the full intent
    let variant = |i: usize| -> Option<String> { if tagged.contains(&i) { Some(build(Some(i)).0) } else { None } };
    let d_c = cut(&intent, BULK_EYE_COARSE).to_string();
    let d_cz = node_gzip_len(d_c.as_bytes());
    let coarse_cut = if ap.matched_cut { crate::aperture::matched_budget(d_c.len()).min(BULK_EYE_COARSE * 4) } else { BULK_EYE_COARSE };
    let fine_cut = if ap.matched_cut { crate::aperture::matched_budget(intent.len()).min(BULK_EYE_FINE * 4) } else { BULK_EYE_FINE };
    let target_cut = |t: &str, eye: usize, budget: usize| -> String { if ap.matched_cut { crate::aperture::matched_cut(cut(t, eye), budget) } else { cut(t, eye).to_string() } };
    let mut coarse: Vec<(f64, usize)> = targets.iter().enumerate().map(|(i, t)| {
        let (dc, dcz) = match variant(i) { Some(v) => { let c = cut(&v, BULK_EYE_COARSE).to_string(); let z = node_gzip_len(c.as_bytes()); (c, z) } None => (d_c.clone(), d_cz) };
        let sn = target_cut(t, BULK_EYE_COARSE, dc.len());
        (ncd_sim(dcz, &dc, &sn, if sn.is_empty() { 0 } else { node_gzip_len(sn.as_bytes()) }), i)
    }).collect();
    coarse.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.cmp(&b.1)));
    let region: Vec<usize> = coarse.iter().take(BULK_TOP_K).map(|x| x.1).collect();
    let d_fz = node_gzip_len(intent.as_bytes());
    // THE NULL IS THE LINE'S (2026-09-14): shuffle ONLY the prompt's words and keep the mass intact. Shuffling the whole
    // intent let the MASS's word order carry the score — three nonsense lines read admissible once a lane's rules rode
    // along, and every added rung was another draw. Now the calibrated gain is what the ordered LINE adds over its own
    // shuffle against the same mass: a meaningless line adds nothing and reads gain ≈ 0 whatever mass surrounds it.
    let null_of = |full_intent: &str, skip: Option<usize>| -> String { let shuffled = shuffle_line_in(prompt, line, null_seed); let (_, b, _) = build(skip); let n = if b.is_empty() { shuffled } else { format!("{}
{}", shuffled, b) }; let _ = full_intent; cut(&n, BULK_EYE_FINE).to_string() };
    let null_doc = null_of(&intent, None);
    let null_z = node_gzip_len(null_doc.as_bytes());
    let mut fine: Vec<(f64, usize)> = region.iter().map(|&i| {
        let (di, diz, nd, nz) = match variant(i) { Some(v) => { let z = node_gzip_len(v.as_bytes()); let n = null_of(&v, Some(i)); let nz = node_gzip_len(n.as_bytes()); (v, z, n, nz) } None => (intent.clone(), d_fz, null_doc.clone(), null_z) };
        let sn = target_cut(&targets[i], BULK_EYE_FINE, di.len());
        let sz = if sn.is_empty() { 0 } else { node_gzip_len(sn.as_bytes()) };
        (ncd_sim(diz, &di, &sn, sz) - ncd_sim(nz, &nd, &sn, sz), i)
    }).collect();
    fine.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.cmp(&b.1)));
    let gains: Vec<f64> = fine.iter().map(|x| x.0).collect();
    let n = gains.len().max(1) as f64;
    let mean = gains.iter().sum::<f64>() / n;
    let std = (gains.iter().map(|g| (g - mean) * (g - mean)).sum::<f64>() / n).sqrt().max(1e-9);
    let top = fine.first().map(|x| x.0).unwrap_or(0.0);
    let second = fine.get(1).map(|x| x.0).unwrap_or(top);
    let z = (top - mean) / std;
    let mut scores = vec![0.0; targets.len()];
    for (g, i) in &fine { scores[*i] = g.max(0.0) + 1e-6; }   // > 0 so top_seeds admits region cells; order = calibrated gain
    (scores, SeedFit { gain: top, margin: top - second, z_fine: z, better_than_random: top >= FIT_MIN_GAIN && z >= 2.0, region, mass_prompt: prompt.chars().count(), mass_bulk: bulk_cut.chars().count(), mass_intent: intent.chars().count(), matched_cut: ap.matched_cut, coarse_cut, fine_cut })
}

/// the 144-byte CellState array for this walk — the same classifier as --lattice, in the same call
fn lattice_cells(_coords: &[String], pixel: Option<&str>, fence: &Option<(i64, i64, i64, i64)>, walked: &[String]) -> Value {
    let px = pixel.and_then(crate::lattice::coord_rc);
    let fb = fence.map(|(r0, r1, c0, c1)| crate::lattice::FenceBox { r0: r0.max(0) as usize, r1: r1.max(0) as usize, c0: c0.max(0) as usize, c1: c1.max(0) as usize });
    let w: Vec<(usize, usize)> = walked.iter().filter_map(|c| crate::lattice::coord_rc(c)).collect();
    let l = crate::lattice::classify(px, fb, &w);
    json!({ "cells": l.cells.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(""), "counts": { "green": l.green, "amber": l.amber, "red": l.red }, "pull_label": l.pull_target.map(|(r, c)| crate::ballistic::SHORTLEX[r * 12 + c]) })
}

// ── σ: zMargin over the RAW walk heat (unified-drift.mjs) ──────────────────────────────
fn z_margin(values: &[f64]) -> f64 {
    let mut xs: Vec<f64> = values.iter().cloned().filter(|v| *v > 0.0).collect();
    // JS sort desc is stable; Rust sort_by is stable — identical sequence, identical sums.
    xs.sort_by(|a, b| b.partial_cmp(a).unwrap());
    if xs.len() < 2 {
        return 0.0;
    }
    let top = xs[0];
    let rest = &xs[1..];
    let mean = rest.iter().sum::<f64>() / rest.len() as f64;
    let variance = rest.iter().map(|b| (b - mean) * (b - mean)).sum::<f64>() / rest.len() as f64;
    let std = variance.sqrt();
    if std > 0.0 {
        // JS +((top-mean)/std).toFixed(2)
        ((top - mean) / std * 100.0).round() / 100.0
    } else {
        0.0
    }
}

// ── THE WALK — definerWalk144 ported hop for hop; row reads are IN-CRATE calls ──────────
struct WalkOut {
    heat: Vec<f64>,
    ply: Vec<i32>,
    hops: usize,
    max_ply: usize,
    matrix: Vec<f64>,
    m_ply: Vec<i32>,
    time_budget_tripped: bool,
    hop_log: Vec<Value>,
}

struct WalkOpts {
    max_depth: usize,
    top_k: usize,
    budget: usize,
    budget_ms: u128,
    decay: f64,
}

/// One hop's row read: the SAME semantics as spawning `pmu-onchip --ballistic --grid <tmp>
/// --start <coord> --max-depth 1` and taking the last frame's visits — but as a function
/// call on the grid already in memory. Mirrors main.rs run_ballistic: --start resolves
/// against SHORTLEX; an unresolvable coord falls through to the walk-all path (the JS
/// process would have, too — it cannot occur with a valid library).
fn row_read(grid: &[u8; CELLS], coord: &str) -> std::collections::BTreeMap<usize, f64> {
    let opts = ballistic::WalkOpts { max_depth: 1, ..ballistic::WalkOpts::default() };
    let frames = match SHORTLEX.iter().position(|x| *x == coord) {
        Some(s) => ballistic::ballistic_walk(grid, s, &opts),
        None => ballistic::ballistic_walk_all(grid, &opts),
    };
    frames.last().map(|f| f.visits.clone()).unwrap_or_default()
}

fn definer_walk(
    grid: &[u8; CELLS],
    coords: &[String],
    start_anchors: &[usize],
    o: &WalkOpts,
) -> WalkOut {
    let mut heat = vec![0.0f64; GRID];
    let mut ply = vec![-1i32; GRID];
    let mut matrix = vec![0.0f64; CELLS];
    let mut m_ply = vec![-1i32; CELLS];
    let mut hop_log: Vec<Value> = Vec::new();
    let mut seen: HashSet<usize> = HashSet::new();
    let mut queued: HashSet<usize> = HashSet::new();

    // frontier: unique seeds in order, valid + coord present (JS: new Set(...filter))
    let mut frontier: Vec<(usize, usize)> = Vec::new();
    let mut dedupe: HashSet<usize> = HashSet::new();
    for &a in start_anchors {
        if a < GRID && !coords[a].is_empty() && dedupe.insert(a) {
            frontier.push((a, 0));
        }
    }
    for (a, _) in &frontier {
        queued.insert(*a);
    }
    if let Some(&(s, _)) = frontier.first() {
        if ply[s] < 0 {
            ply[s] = 0;
        }
        heat[s] += 1.0;
    }
    let mut hops = 0usize;
    let mut max_ply = 0usize;
    let t0 = Instant::now();

    while !frontier.is_empty() && hops < o.budget && t0.elapsed().as_millis() < o.budget_ms {
        let mut batch: Vec<(usize, usize)> = Vec::new();
        for &(cur, d) in &frontier {
            if seen.contains(&cur) || d > o.max_depth {
                continue;
            }
            if hops + batch.len() >= o.budget {
                break;
            }
            seen.insert(cur);
            if ply[cur] < 0 {
                ply[cur] = d as i32;
            }
            if d > max_ply {
                max_ply = d;
            }
            batch.push((cur, d));
        }
        if batch.is_empty() {
            break;
        }
        // ONE row read per hop — the same reads the JS fired as processes, now in-crate.
        let reads: Vec<std::collections::BTreeMap<usize, f64>> =
            batch.iter().map(|&(cur, _)| row_read(grid, &coords[cur])).collect();
        hops += batch.len();
        let mut next: Vec<(usize, usize)> = Vec::new();
        for (b, &(cur, d)) in batch.iter().enumerate() {
            let visits = &reads[b];
            // rowCells: visits[cur*144+j] > 0, j != cur — ascending j IS ShortLex order
            // (gestalt-boundary-first), NEVER weight-sorted (AR: no weight-sorted ranking).
            let mut row_cells: Vec<(usize, f64)> = Vec::new();
            for j in 0..GRID {
                if j == cur {
                    continue;
                }
                let w = *visits.get(&(cur * GRID + j)).unwrap_or(&0.0);
                if w > 0.0 {
                    row_cells.push((j, w));
                }
            }
            let fade = o.decay.powi(d as i32);
            // the whole READ row paints the 20736 cloud, decayed by ply…
            for &(j, w) in &row_cells {
                let cell = cur * GRID + j;
                matrix[cell] += w * fade;
                if m_ply[cell] < 0 {
                    m_ply[cell] = d as i32;
                }
            }
            // …but only the TOP-K ranked UNSEEN∧UNQUEUED are FOLLOWED (the transpose:
            // column j → next row j) — guided, not flood. heat ONLY on followed anchors.
            let mut followed = 0usize;
            for &(j, _) in &row_cells {
                if followed >= o.top_k {
                    break;
                }
                if seen.contains(&j) || queued.contains(&j) {
                    continue;
                }
                if d + 1 > o.max_depth {
                    break;
                }
                if ply[j] < 0 {
                    ply[j] = (d + 1) as i32;
                }
                heat[j] += fade;
                next.push((j, d + 1));
                queued.insert(j);
                followed += 1;
            }
            hop_log.push(json!({ "hop": hops - batch.len() + b + 1, "anchor": coords[cur].clone(), "ply": d, "row_cells": row_cells.len(), "followed": row_cells.iter().take(o.top_k).map(|&(j, _)| coords[j].clone()).collect::<Vec<_>>(), "elapsed_ms": t0.elapsed().as_millis() as u64 }));
        }
        frontier = next;
    }
    // the wall valve fired before the WORK bound → not byte-recomputable; carry the flag.
    let time_budget_tripped =
        !frontier.is_empty() && hops < o.budget && t0.elapsed().as_millis() >= o.budget_ms;
    WalkOut { heat, ply, hops, max_ply, matrix, m_ply, time_budget_tripped, hop_log }
}

// ── running_in — WHICH TERMINAL/ROOM this lens is physically running inside ─────────────
// The canonical terminal→room map (prompt-lens.mjs TERM_TO_ROOM), backed by data/rooms.json
// read AT RUNTIME (never a hardcoded roster). Full names, not codes: "🔨 builder — iTerm2".
const TERM_TO_ROOM: [(&str, &str); 8] = [
    ("iTerm.app", "builder"),
    ("Apple_Terminal", "voice"),
    ("WezTerm", "vault"),
    ("Rio", "navigator"),
    ("Alacritty", "performer"),
    ("kitty", "operator"),
    ("ghostty", "operator"),
    ("vscode", "architect"),
];

fn running_in(repo: &Path) -> Value {
    let term_program = std::env::var("TERM_PROGRAM").ok().filter(|s| !s.is_empty());
    let term = std::env::var("TERM").ok().filter(|s| !s.is_empty());
    let raw = term_program.clone().or(term);
    let Some(raw_terminal) = raw else {
        return json!({
            "terminal": Value::Null,
            "room_key": Value::Null,
            "room": Value::Null,
            "note": "bare environment — no terminal detected",
        });
    };
    // room resolution keys off $TERM_PROGRAM (the canonical map); $TERM alone never maps.
    let room_key = term_program
        .as_deref()
        .and_then(|tp| TERM_TO_ROOM.iter().find(|(t, _)| *t == tp).map(|(_, k)| *k));
    if let Some(key) = room_key {
        let rooms: Option<Value> = std::fs::read_to_string(repo.join("data/rooms.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok());
        if let Some(rj) = rooms {
            let r = rj.get("rooms").unwrap_or(&rj);
            if let Some(v) = r.get(key) {
                let emoji = v.get("emoji").and_then(|x| x.as_str()).unwrap_or("");
                let term_name = v.get("terminal").and_then(|x| x.as_str()).unwrap_or(&raw_terminal);
                return json!({
                    "terminal": raw_terminal,
                    "room_key": key,
                    "room": format!("{} {} — {}", emoji, key, term_name),
                });
            }
        }
        // rooms.json missing/unreadable: keep the key, degrade the label honestly.
        return json!({ "terminal": raw_terminal, "room_key": key, "room": key });
    }
    // no room matches: fall back to the raw terminal string as the room label.
    json!({ "terminal": raw_terminal, "room_key": Value::Null, "room": raw_terminal })
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────
fn flag_val(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

/// Repo root: --repo wins; else inferred from the binary's canonical location
/// (<repo>/.thetacog/pmu/target/release/pmu-onchip); else the cwd.
fn resolve_repo(args: &[String]) -> PathBuf {
    if let Some(r) = flag_val(args, "--repo") {
        return PathBuf::from(r);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.ancestors().nth(5) {
            if root.join("data/pmu/snippet-library-144.json").exists() {
                return root.to_path_buf();
            }
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn run(args: &[String]) {
    let repo = resolve_repo(args);
    let text = match flag_val(args, "--text") {
        Some(t) => t,
        None => {
            use std::io::Read;
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).unwrap_or(0);
            s
        }
    };

    let lib_path = flag_val(args, "--targets")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join("data/pmu/snippet-library-144.json"));
    let lib = match load_library(&lib_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("pmu-onchip --lens: {}", e);
            std::process::exit(2);
        }
    };

    // WALK KNOBS — THE DEFAULT IS THE FULL WALK (operator 2026-09-14: "the full is the minimum …
    // or default the config at worst"). These defaults MIRROR src/lib/pmu/walk-knobs.mjs, the one
    // home (maxDepth 8 · topK 2 · budget 220 · budgetMs 600000 · decay 0.5); the JS door passes every
    // knob as a flag anyway, so a default only decides a bare CLI call — and a bare call now walks the
    // same walk the panel walks. The old defaults (2 · 3 · 120, plus a LENS_CHAT_WALK_DEPTH env valve)
    // decided 4,667 tape rows while the receipts walked deep (io1b, 2026-09-14). No env knob here:
    // an env override is a second home. Guard: tests/pmu-simulator/walk-knobs-floor.test.mjs runs the
    // binary bare and flagged on one text and requires the same hops, ply and mask.
    let max_depth = flag_val(args, "--max-depth").and_then(|s| s.parse().ok()).unwrap_or(8usize);
    let top_k = flag_val(args, "--top-k").and_then(|s| s.parse().ok()).unwrap_or(2usize);
    let budget = flag_val(args, "--budget").and_then(|s| s.parse().ok()).unwrap_or(220usize);
    let budget_ms =
        flag_val(args, "--budget-ms").and_then(|s| s.parse().ok()).unwrap_or(600_000u128);
    let decay = flag_val(args, "--decay").and_then(|s| s.parse().ok()).unwrap_or(0.5f64);
    let floor = flag_val(args, "--floor").and_then(|s| s.parse().ok()).unwrap_or(0.30f64);
    // Chebyshev fence radius in blocks (prompt-lens.mjs BOUNDARY_RADIUS / LENS_RADIUS).
    let radius: i64 = flag_val(args, "--radius")
        .and_then(|s| s.parse().ok())
        .or_else(|| std::env::var("LENS_RADIUS").ok().and_then(|s| s.parse().ok()))
        .unwrap_or(2);

    // ── SEED: gzip-NCD over the 144 targets (timed in μs — the un-idled gzip) ──
    let t_seed = Instant::now();
    // --seed matched (default when --bulk is given, or --seed matched) · naked = the original lit_scores
    let seed_mode = flag_val(args, "--seed").unwrap_or_else(|| if flag_val(args, "--bulk").is_some() { "matched".into() } else { "naked".into() });
    let bulk = flag_val(args, "--bulk").unwrap_or_default();
    let ap = SeedAperture { matched_cut: !args.iter().any(|a| a == "--no-matched-cut") && (args.iter().any(|a| a == "--matched-cut") || SeedAperture::default().matched_cut) };
    // THE INTENT LATCHES FIRST — the thread is built HERE (operator: "only the one same rust for all"): a line under
    // the mass floor becomes this prompt + the session's prior prompts (newest first) until the floor clears. The JS
    // door passes --session / --receipts-dir / --before and nothing else; the floor is aperture.rs's. Frozen before any mass moves.
    let line = text.clone();
    let mass_floor: usize = crate::aperture::MIN_GZIP_BYTES;   // ONE floor: aperture.rs (the JS side mirrors it in physics.mjs; the guard pins the two equal)
    let receipts_dir = flag_val(args, "--receipts-dir").map(PathBuf::from).unwrap_or_else(|| repo.join(".thetacog/lens-receipts"));
    let before = flag_val(args, "--before");
    let session_id = flag_val(args, "--session");
    let (text, span) = thread_intent(&line, session_id.as_deref(), &receipts_dir, mass_floor, before.as_deref());
    let intent_span = json!({ "prompts": span.prompts, "chars": span.chars, "gzip": span.gzip, "floor": span.floor, "session": session_id, "thread": span.thread });
    // THE LADDER AND THE GUIDED LANES — from the reef file, HERE. --lane names the routed lane; --reef overrides the file.
    let reef = load_reef(&flag_val(args, "--reef").map(PathBuf::from).unwrap_or_else(|| repo.join("data/pmu/lens-reef.json")));
    let lane_name = flag_val(args, "--lane");
    let thin_line = line.chars().count() < BULK_EYE_COARSE;
    let guided_max_flag: usize = flag_val(args, "--guided-passes").and_then(|s| s.parse().ok()).unwrap_or(2usize);
    // --no-ladder: a CONFIG for the parity fixture (placePixelBulked at bulk '' is the seed math as ported; it never
    // climbed a ladder). Production never passes it — the door's ratchet is the ladder + the guided rung + the cut.
    let no_ladder = args.iter().any(|a| a == "--no-ladder");
    // §8.36 THE COVERAGE VALVE: the reef ladder ran only on THIN lines (< BULK_EYE_COARSE chars), which is why the walk named a path
    // on 37 % of silent rows and why prompt length was a proxy for coverage (Cramér's V 0.88). --ladder-always runs the ladder on
    // every line; the escape-velocity round reads whether coverage rises without the conditional margin falling.
    let ladder_always = args.iter().any(|a| a == "--ladder-always");
    let ladder_ok = thin_line || ladder_always;
    // --no-thread (spec §8.18, 2026-09-16): THE ABLATION ARM. Stage 0 only — no backward snowball through the session — so the
    // snowball's contribution to predicting the action is measured against its absence on one corpus, never inferred.
    // Production never passes it; the ratchet's rank runs it as an arm.
    let no_thread = args.iter().any(|a| a == "--no-snowball" || a == "--no-thread");   // --no-snowball is the name; --no-thread the deprecated alias
    // ── THE APERTURE RATCHET, IN ONE PROCESS (operator 2026-09-14: "never duplicate that again — there is one way
    // to run it, with configs, in rust"). The JS door used to loop over a ladder of masses, spawning this binary per
    // rung; the loop now lives HERE. --ratchet-file <json> = { ladder: [{label, mass}], guided: { max_passes, lanes:
    // [{label, coord, mass}] } }. Rungs in order; the first reading the null test admits wins; otherwise the best z.
    // THE WALK GUIDES THE MASS (guided passes): when no rung admits, the definer walk runs from the best seed and the
    // lanes whose centre lies within two blocks of a walked cell supply the next mass — TEMPLATE + RULES text, never
    // the 144 target snippets (feeding the evaluator's own targets back as intent is the leak that painted 76% green
    // in the JS prototype). The intent is FROZEN across rungs (the thread is built before this call); only the mass
    // moves. Every rung lands on `attempts`; the search cost is on the row.
    let grid = load_directed_grid(&repo, &lib.coords);
    let mut attempts: Vec<Value> = Vec::new();
    let mut ratchet_json = Value::Null;
    // ── THE RETROACTIVE APERTURE (operator 2026-09-14: "instead of just cutting, beef up retroactive aperture —
    // thats what streaming by the sensor is meant to do … traverse backwards to find the rules and hats"). Stage 0:
    // the floor-thread; ladder (given → lane → reef); guided passes where the mass is the RULES of the lanes near the
    // walked cells PLUS the HATS seated at the walked cells (each hat tagged with its target and left out when that
    // target is scored). If nothing latches, stage k traverses further back through the session (3 → 5 → 9 prompts)
    // and the mass side widens again. It stops at the first admissible reading, or when the thread cannot grow.
    let mut text = text;
    let mut intent_span = intent_span;
    let (scores, seed_fit) = if seed_mode != "matched" { (lit_scores(&text, &lib.targets), None) } else {
        let guided_max: usize = guided_max_flag;
        let lanes: Vec<(String, (i64, i64), String)> = reef.iter().filter(|d| !d.coord.is_empty() && !d.mass.is_empty()).map(|d| (format!("lane:{}", d.domain), shortlex_to_block(&d.coord), d.mass.clone())).collect();
        let mut best: Option<(Vec<f64>, SeedFit, String, String, Value)> = None;   // scores, fit, label, the intent text that produced it, its span
        let coords_ref = &lib.coords;
        // GRIP per rung (operator 2026-09-14: "ratchet the better nav and resulting grip"): how on-topic the rules seated
        // around the rung's pixel are for THE LINE — 1 − mean gzip-NCD(line, lane mass) over the lanes within two blocks.
        // Read on the line, never on the widened intent, so mass cannot buy grip. The winner is the ADMISSIBLE rung with
        // the best grip (ties by z); with no admissible rung, the best z. The first latch no longer ends the search —
        // every rung is scored and the row carries grip per rung.
        let line_z = node_gzip_len(line.as_bytes());
        let grip_at = |pixel: &str| -> Option<f64> {
            let (pr, pc) = shortlex_to_block(pixel);
            let near: Vec<&String> = lanes.iter().filter(|(_, (lr, lc), _)| (lr - pr).abs() <= 2 && (lc - pc).abs() <= 2).map(|(_, _, m)| m).collect();
            if near.is_empty() { return None; }
            // ncd_sim IS a similarity (1 − NCD); grip is its mean over the nearby lane masses — the same construct grip-ratchet.mjs reads as rule_relevance
            let mean = near.iter().map(|m| { let mc = cut(m, 1200); let mz = node_gzip_len(mc.as_bytes()); ncd_sim(line_z, &line, mc, mz) }).sum::<f64>() / near.len() as f64;
            Some((mean * 1e4).round() / 1e4)
        };
        let mut grips: Vec<(String, f64)> = Vec::new();
        // F18: `stamp` is the grip that actually drove a rung's own stop rule (a worm ring's RING-scored grip); it is what the
        // attempt carries on the tape so --maintain-ringlatch reads the construct the walker used. The winner selection between
        // rungs (`take`, below) still compares the pixel-neighbourhood grip, unchanged — F18 changes the walker's stop, not the placement.
        // KR13 (spec §8.13, 2026-09-16): --line-first. Read on the frozen corpus against a stable target, the LINE ALONE leaned
        // 1.1–1.9 everywhere and the winner the ladder and the worms chose sat at the null everywhere — the search was
        // overwriting the line's placement with a bundle's that carried less. Under --line-first a BUNDLE rung (a thread stage
        // "tK:…" or a worm ring "wormN@…") may replace the best only if its calibrated gain strictly exceeds the best gain any
        // stage-0 rung reached. Default off; the reading decides (falsifier: final-winner z must rise to the line's on both halves
        // without the admissible count falling).
        let line_first = args.iter().any(|a| a == "--line-first");
        let mut line_best_gain: f64 = f64::NEG_INFINITY;
        // SOURCES (operator 2026-09-16: "there should be source paths in the tape — the messages, the rules and hats, whatever we
        // need to regain the context"). Every rung names what its mass was built from: ladder:<label>, thread:<n>prompts,
        // lane:<label>, hat:<coord> — capped at 24 names so a row stays a row. The winner's sources are the association path
        // the placement took; a reader can walk it back without re-running anything.
        let mut record = |label: &str, mass_chars: usize, hats: usize, s: Vec<f64>, f: SeedFit, txt: &str, span: &Value, stamp: Option<f64>, sources: Vec<String>, best: &mut Option<(Vec<f64>, SeedFit, String, String, Value)>| -> (bool, Option<f64>) {
            let top = top_seeds(&s, coords_ref, 1).first().map(|&i| coords_ref[i].clone());
            let grip = top.as_deref().and_then(|p| grip_at(p));
            if let Some(g) = grip { grips.push((label.to_string(), g)); }
            let grip_on_tape = stamp.or(grip);
            let is_bundle = label.starts_with("worm") || (label.starts_with('t') && label[1..].chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && label.contains(':'));
            if !is_bundle && f.gain > line_best_gain { line_best_gain = f.gain; }
            let line_first_blocks = line_first && is_bundle && !(f.gain > line_best_gain);
            let src: Vec<String> = sources.into_iter().take(24).collect();
            attempts.push(json!({ "label": label, "mass": mass_chars, "hats": hats, "thread_prompts": span.get("prompts").cloned().unwrap_or(Value::Null), "gain": (f.gain * 1e4).round() / 1e4, "z": (f.z_fine * 100.0).round() / 100.0, "ok": f.better_than_random, "grip": grip_on_tape, "pixel": top, "sources": src }));
            let ok = f.better_than_random;
            let take = match best {
                None => true,
                Some((_, bf, bl, _, _)) => {
                    if ok && bf.better_than_random {
                        let bg = grips.iter().find(|(l, _)| l == bl).map(|(_, g)| *g).unwrap_or(-1.0);
                        grip.unwrap_or(-1.0) > bg || (grip.unwrap_or(-1.0) == bg && f.z_fine > bf.z_fine)
                    } else if ok { true } else if bf.better_than_random { false } else { f.z_fine > bf.z_fine }
                }
            };
            if take && !line_first_blocks { *best = Some((s, f, label.to_string(), txt.to_string(), span.clone())); }
            (ok, grip)
        };
        let mut steps = 0usize; let mut guided_passes = 0usize; let mut stages = 0usize;
        // THE RUNG LOG (Task 26): every rung's (stage text, mass parts) so the permutation can re-draw the SAME rungs with a shuffled line
        let mut rung_log: Vec<(String, Vec<(Option<usize>, String)>)> = Vec::new();
        let mut last_prompts = 0usize;
        let mut prev_latched_grip: Option<f64> = None;
        let mut worms_json = Value::Null;
        let first_latch = args.iter().any(|a| a == "--first-latch");
        'stages: for k in 0..4usize {
            let (stage_text, sp) = if k == 0 { (text.clone(), span_of(&intent_span)) } else {
                if no_thread || session_id.is_none() || last_prompts >= THREAD_MAX_PROMPTS { break; }
                let min_p = (last_prompts * 2).max(last_prompts + 2).min(THREAD_MAX_PROMPTS);   // traverse further back: roughly doubling from what the last stage reached
                let (t, sp) = thread_intent_n(&line, session_id.as_deref(), &receipts_dir, mass_floor, before.as_deref(), min_p);
                if sp.prompts <= last_prompts { break; }   // the thread cannot grow further backwards
                (t, sp)
            };
            last_prompts = sp.prompts; stages = k + 1;
            let span_json = json!({ "prompts": sp.prompts, "chars": sp.chars, "gzip": sp.gzip, "floor": sp.floor, "session": session_id, "thread": sp.thread });
            let pre = if k == 0 { String::new() } else { format!("t{}:", sp.prompts) };
            let mut ladder: Vec<(String, String)> = if ladder_ok && !no_ladder && k == 0 { bulk_ladder(&stage_text, &bulk, lane_name.as_deref(), &reef) } else if k > 0 && ladder_ok && !no_ladder { bulk_ladder(&stage_text, &bulk, lane_name.as_deref(), &reef).into_iter().take(2).collect() } else { Vec::new() };
            if ladder.is_empty() { ladder.push((if bulk.is_empty() { "none".to_string() } else { "given".to_string() }, bulk.clone())); }
            let mut latched = false; let mut stage_grip = f64::NEG_INFINITY;
            for (label, mass) in &ladder { steps += 1; let parts_l: Vec<(Option<usize>, String)> = vec![(None, mass.clone())]; let (s, f) = matched_seed_parts_line(&stage_text, &line, &parts_l, &lib.targets, &ap, 7); rung_log.push((stage_text.clone(), parts_l)); let src_l: Vec<String> = { let mut v = vec![format!("ladder:{}", label)]; if k > 0 { v.push(format!("thread:{}prompts", sp.prompts)); } v }; let (ok, g) = record(&format!("{}{}", pre, label), mass.chars().count(), 0, s, f, &stage_text, &span_json, None, src_l, &mut best); if ok { latched = true; if let Some(g) = g { stage_grip = stage_grip.max(g); } } }
            let mut passes_here = 0usize; let mut last_key = String::new();
            while passes_here < guided_max && !lanes.is_empty() {
                let seeds = { let (bs, _, _, _, _) = best.as_ref().unwrap(); top_seeds(bs, &lib.coords, 3) };
                if seeds.is_empty() { break; }
                let w = definer_walk(&grid, &lib.coords, &seeds, &WalkOpts { max_depth, top_k, budget, budget_ms, decay });
                let mx = w.heat.iter().cloned().fold(0.0f64, f64::max).max(1e-12);
                let walked_idx: Vec<usize> = (0..GRID).filter(|&i| w.heat[i] / mx > floor).collect();
                let walked: Vec<(i64, i64)> = walked_idx.iter().map(|&i| shortlex_to_block(&lib.coords[i])).collect();
                // RULES: the lanes whose centre lies within two blocks of a walked cell
                let mut parts: Vec<(Option<usize>, String)> = Vec::new(); let mut seen = HashSet::new();
                let mut src_g: Vec<String> = if k > 0 { vec![format!("thread:{}prompts", sp.prompts)] } else { Vec::new() };
                for (label, (lr, lc), mass) in &lanes { if walked.iter().any(|(r, c)| (r - lr).abs() <= 2 && (c - lc).abs() <= 2) && seen.insert(label.clone()) { parts.push((None, mass.clone())); src_g.push((if label.starts_with("lane:") { label.clone() } else { format!("lane:{}", label) })); } }
                // HATS: the snippets seated at the walked cells, each tagged with its target (left out when that target is scored)
                let mut hats = 0usize;
                for &i in &walked_idx { let h = cut(&lib.targets[i], 600).to_string(); if !h.trim().is_empty() { parts.push((Some(i), h)); hats += 1; src_g.push(format!("hat:{}", lib.coords[i])); } }
                let key: String = walked_idx.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
                if parts.is_empty() || key == last_key { break; }
                last_key = key;
                passes_here += 1; guided_passes += 1;
                let mass_chars: usize = parts.iter().map(|(_, p)| p.chars().count()).sum();
                let (s, f) = matched_seed_parts_line(&stage_text, &line, &parts, &lib.targets, &ap, 7);
                rung_log.push((stage_text.clone(), parts.clone()));
                let (ok, g) = record(&format!("{}guided:{}", pre, passes_here), mass_chars, hats, s, f, &stage_text, &span_json, None, src_g.clone(), &mut best); if ok { latched = true; if let Some(g) = g { stage_grip = stage_grip.max(g); } }
            }
            // STREAM UNTIL GRIP LATCH (operator 2026-09-14: "retro traverse should stream until grip latch"): a latched stage does
            // not end the travel by itself — the next stage runs if it could still raise the best admissible grip; the travel
            // stops when a latched stage failed to beat the previous latched stage's grip (the latch), or at the bounds.
            // THE GRIP LATCH: once a stage has latched, the travel continues only while the NEXT stage latches with a better
            // grip; a stage that fails to latch, or latches without beating the grip, ends it. Bounded by the four stages.
            if latched && first_latch { break 'stages; }   // --first-latch: the stage that latches ends the travel (the A/B arm for "stream until grip latch")
            let (stop_travel, next_prev) = stage_after_latch(latched, stage_grip, prev_latched_grip);   // the one rule, also enumerated by harness.rs (L1)
            prev_latched_grip = next_prev;
            if stop_travel { break 'stages; }
        }
        // ── PARALLEL WORMS (operator 2026-09-14: "stream concentric circles with the ncd compression sensor based on the reef
        // tesseract … parallel worms … in rust"). The top seeds of the best reading so far each become a walker. A walker
        // widens in concentric Chebyshev rings around its cell (r = 1, 2, 3): ring r's mass is the RULES of every lane whose
        // centre lies within r blocks plus the HATS seated at every cell within r blocks (tagged; left out when its own
        // target is scored). The sensor is the same matched seed; the walker stops when a ring latches and the next ring
        // does not raise its grip, or at the last ring. Walkers run in parallel (rayon) and race; the admissible ring with
        // the best grip wins the same way any rung does. Every ring is a rung on the row: the search cost (rings traversed
        // per walker) is on the tape. --worms N (0 = off) — the default is decided by the replay, never by taste.
        // VOCABULARY (spec §8.17/§8.21, 2026-09-16): the spatial walkers are RING WALKERS; "worms"/"snowball" mean the backward
        // ladder. --ring-walkers N is the name; --worms N stays as the deprecated alias so no caller breaks.
        let worms_n: usize = flag_val(args, "--ring-walkers").or_else(|| flag_val(args, "--worms")).and_then(|s| s.parse().ok()).unwrap_or(0);
        let worm_hats = !args.iter().any(|a| a == "--no-worm-hats");   // the falsifier arm: rings of RULES only — if admissibility holds without hats, the hats are not a template leak
        if worms_n > 0 {
            use rayon::prelude::*;
            // KR6 (operator 2026-09-16: "if the snowballs bunch up we get no coverage; orthogonalised they might do far better"):
            // --worms-orthogonal seeds each walker on a cell that shares NEITHER block-row NOR block-column with the walkers already
            // seated (the ballistic walk's connectivity rule, inverted), taken greedily down the score ranking, so the snowballs
            // cannot gather each other's mass. Default off; the knob ratchet decides on held-out halves, never taste.
            let worms_orthogonal = args.iter().any(|a| a == "--worms-orthogonal");
            let seeds: Vec<usize> = {
                let (bs, _, _, _, _) = best.as_ref().unwrap();
                if !worms_orthogonal { top_seeds(bs, &lib.coords, worms_n) } else {
                    let ranked = top_seeds(bs, &lib.coords, lib.coords.len());
                    let mut out: Vec<usize> = Vec::new(); let mut rows_used: HashSet<i64> = HashSet::new(); let mut cols_used: HashSet<i64> = HashSet::new();
                    for i in ranked { if out.len() >= worms_n { break; } let (r, c) = shortlex_to_block(&lib.coords[i]); if rows_used.contains(&r) || cols_used.contains(&c) { continue; } rows_used.insert(r); cols_used.insert(c); out.push(i); }
                    if out.is_empty() { top_seeds(bs, &lib.coords, worms_n) } else { out }
                }
            };
            let stage_text_w = best.as_ref().map(|b| b.3.clone()).unwrap_or_else(|| text.clone());
            let span_w = best.as_ref().map(|b| b.4.clone()).unwrap_or(Value::Null);
            let blocks: Vec<(i64, i64)> = lib.coords.iter().map(|c| shortlex_to_block(c)).collect();
            let targets_ref = &lib.targets; let coords_w = &lib.coords; let lanes_w = &lanes; let ap_w = &ap; let text_w = &stage_text_w; let line_w = &line;
            let line_zw = node_gzip_len(line.as_bytes());
            let grip_w = |pixel: &str| -> Option<f64> {
                let (pr, pc) = shortlex_to_block(pixel);
                let near: Vec<&String> = lanes_w.iter().filter(|(_, (lr, lc), _)| (lr - pr).abs() <= 2 && (lc - pc).abs() <= 2).map(|(_, _, m)| m).collect();
                if near.is_empty() { return None; }
                let mean = near.iter().map(|m| { let mc = cut(m, 1200); let mz = node_gzip_len(mc.as_bytes()); ncd_sim(line_zw, line_w, mc, mz) }).sum::<f64>() / near.len() as f64;
                Some((mean * 1e4).round() / 1e4)
            };
            let ring_grip = |parts: &[(Option<usize>, String)]| -> Option<f64> {
                let ms: Vec<f64> = parts.iter().filter(|(_, p)| !p.trim().is_empty()).map(|(_, p)| { let pc = cut(p, 1200); let pz = node_gzip_len(pc.as_bytes()); ncd_sim(line_zw, line_w, pc, pz) }).collect();
                if ms.is_empty() { return None; }
                Some(((ms.iter().sum::<f64>() / ms.len() as f64) * 1e4).round() / 1e4)
            };
            // each walker returns its rings: (label, mass_chars, hats, scores, fit, grip, pixel)
            let results: Vec<Vec<(String, usize, usize, Vec<f64>, SeedFit, Option<f64>, Option<String>, Vec<(Option<usize>, String)>, Vec<String>)>> = seeds.par_iter().enumerate().map(|(k, &seed)| {
                let (sr, sc) = blocks[seed];
                let mut rings = Vec::new(); let mut prev_grip: Option<f64> = None; let mut prev_ok = false; let mut rise: Option<GripRise> = None;
                for r in 1..=3i64 {
                    let mut parts: Vec<(Option<usize>, String)> = Vec::new(); let mut seen = HashSet::new();
                    let mut src_r: Vec<String> = vec![format!("ring:{}@{}:r{}", k + 1, coords_w[seed], r)];
                    for (label, (lr, lc), mass) in lanes_w.iter() { if (lr - sr).abs() <= r && (lc - sc).abs() <= r && seen.insert(label.clone()) { parts.push((None, mass.clone())); src_r.push((if label.starts_with("lane:") { label.clone() } else { format!("lane:{}", label) })); } }
                    let mut hats = 0usize;
                    if worm_hats { for (i, &(br, bc)) in blocks.iter().enumerate() { if (br - sr).abs() <= r && (bc - sc).abs() <= r { let h = cut(&targets_ref[i], 600).to_string(); if !h.trim().is_empty() { parts.push((Some(i), h)); hats += 1; src_r.push(format!("hat:{}", coords_w[i])); } } } }
                    if parts.is_empty() { continue; }   // an empty ring widens; only the bounds or the latch stop a walker
                    let mass_chars: usize = parts.iter().map(|(_, p)| p.chars().count()).sum();
                    let (s, f) = matched_seed_parts_line(text_w, line_w, &parts, targets_ref, ap_w, 7);
                    let top = top_seeds(&s, coords_w, 1).first().map(|&i| coords_w[i].clone());
                    // F12 (§5.13 → §7.13): the ring is scored by the mass IT admitted — the same matched gzip-NCD sensor, read against
                    // this ring's own parts — not by the neighbourhood of whichever pixel happened to win. grip_w (the winner's
                    // neighbourhood) was a function of the pixel, so 82% of walkers widened against an objective that could not move;
                    // ring_grip is a function of the ring. grip_w stays in use for the between-rung winner selection in `record`.
                    let g = ring_grip(&parts);
                    let _ = &grip_w;
                    let ok = f.better_than_random;
                    rings.push((format!("worm{}@{}:r{}", k + 1, coords_w[seed], r), mass_chars, hats, s, f, g, top, parts.clone(), src_r));
                    if ring_latch_fires(ok, prev_ok, rise.as_ref(), g, prev_grip) { break; }   // the ring latch: latched, grip has risen (the witness), and the wider ring did not raise it — the one rule, also enumerated by harness.rs (W2)
                    let (po, pg, nr) = ring_prev_after(ok, g, prev_ok, prev_grip, rise); prev_ok = po; prev_grip = pg; rise = nr;
                }
                rings
            }).collect();
            let mut worm_rings = 0usize;
            for rings in results { for (label, mass_chars, hats, s, f, g, _top, parts, src_r) in rings { worm_rings += 1; rung_log.push((stage_text_w.clone(), parts)); let _ = record(&label, mass_chars, hats, s, f, &stage_text_w, &span_w, g, src_r, &mut best); } }
            worms_json = json!({ "n": seeds.len(), "rings": worm_rings, "orthogonal": worms_orthogonal, "seeds": seeds.iter().map(|&i| lib.coords[i].clone()).collect::<Vec<_>>() });
        }
        let (bs, mut bf, winner, wtext, wspan) = best.expect("at least one rung");
        let z_req = z_required(attempts.len());
        let raw_ok = bf.better_than_random;
        // ── THE PERMUTATION RATCHET (Task 26, 2026-09-14). Bonferroni (z_required) is conservative for correlated rungs; the
        // exact control is a paired permutation of the WHOLE ratchet: the same rungs (same stage texts, same mass parts) are
        // re-drawn K times with only the LINE's words shuffled (the priors and the mass are kept), and each draw's winner
        // is its best gain over those rungs. The real winner is admissible iff it beats every shuffled winner (exceed = 0),
        // stands two null standard deviations above their mean, and clears the floor over that mean. Runs only when a rung
        // already latched raw (an UNMEASURED row costs nothing). --perm K (0 = off → the Bonferroni latch); the default is
        // decided by the replay (scripts/pmu/ratchet-replay.mjs), never by taste. Deterministic: seeds 7 + 97k.
        let perm_k: usize = flag_val(args, "--perm").and_then(|s| s.parse().ok()).unwrap_or(0);
        let mut perm_json = Value::Null;
        let mut perm_ok: Option<bool> = None;
        if perm_k > 0 && raw_ok && !rung_log.is_empty() {
            use rayon::prelude::*;
            let w_real = attempts.iter().filter_map(|a| a.get("gain").and_then(|g| g.as_f64())).fold(f64::NEG_INFINITY, f64::max);
            let targets_p = &lib.targets; let ap_p = &ap; let line_p: &str = &line; let log_p = &rung_log;
            let w_null: Vec<f64> = (1..=perm_k).into_par_iter().map(|k| {
                let seed = 7u64 + 97u64 * (k as u64);
                let sline = shuffle_words_seeded(line_p, seed);
                log_p.iter().map(|(stage_text, parts)| {
                    let stext = if !line_p.is_empty() && stage_text.starts_with(line_p) { format!("{}{}", sline, &stage_text[line_p.len()..]) } else { sline.clone() };
                    let (_, f) = matched_seed_parts_line(&stext, &sline, parts, targets_p, ap_p, 7);
                    f.gain
                }).fold(f64::NEG_INFINITY, f64::max)
            }).collect();
            let PermVerdict { n: _, mean, std, w_max, exceed, z: z_perm, p, ok } = perm_verdict(w_real, &w_null);   // the one verdict, also enumerated by harness.rs (P3)
            // The floor is NOT re-applied over the null mean: raw_ok already required the calibrated gain ≥ FIT_MIN_GAIN, and the
            // shuffled winners' mean is positive by construction (a max over rungs of noise) — the permutation's job is the
            // multiplicity, so the latch is exceedance (beats every draw) plus two null standard deviations. Smoke 2026-09-14:
            // a real line read z 4.13 / exceed 0 at K=8 while a nonsense line the Bonferroni latch had ADMITTED read z 0.74 / exceed 2.
            perm_ok = Some(ok);
            let r4 = |x: f64| (x * 1e4).round() / 1e4;
            perm_json = json!({ "k": perm_k, "rungs": rung_log.len(), "w_real": r4(w_real), "w_null_max": r4(w_max), "w_null_mean": r4(mean), "w_null_std": r4(std), "exceed": exceed, "p": r4(p), "z": (z_perm * 100.0).round() / 100.0, "ok": ok, "null": "line" });
        } else if perm_k > 0 {
            perm_json = json!({ "k": perm_k, "rungs": rung_log.len(), "skipped": if raw_ok { "no-rungs" } else { "no-raw-latch" }, "null": "line" });
        }
        bf.better_than_random = match perm_ok { Some(ok) => raw_ok && ok, None => raw_ok && bf.z_fine >= z_req };   // perm on: the exact control decides; perm off: the family-wise latch (Bonferroni z_required(n))
        // ── THE THREAD QUESTION (Task 27, 2026-09-15). A threaded row answers TWO declared questions (W6), never pooled:
        // "does the LINE place?" (above — the priors are context, only the line is shuffled) and "does the CONTEXT place?" —
        // the same rungs scored with the WHOLE thread text as the line: calibrated against its own whole-text shuffle (seed 7,
        // the v17 instrument) and permuted K times the same way. This is where v16's 37 % lived; it is on the row as
        // ratchet.perm_thread with null: "thread", and it never decides `admissible`. Runs only when a thread was used AND
        // --perm-thread is passed: measured 2026-09-15 on 60 corpus rows it took the door from 117 to 307 ms median (one
        // re-score pass over every rung plus the K draws), so it is the REPLAY's arm, never the live turn's default.
        let mut perm_thread_json = Value::Null;
        let thread_used = wspan.get("thread").and_then(|t| t.as_bool()).unwrap_or(false);
        let perm_thread_on = args.iter().any(|a| a == "--perm-thread");
        if perm_k > 0 && perm_thread_on && thread_used && !rung_log.is_empty() {
            use rayon::prelude::*;
            let targets_p = &lib.targets; let ap_p = &ap; let log_p = &rung_log;
            let real_t: Vec<SeedFit> = log_p.iter().map(|(st, parts)| matched_seed_parts_line(st, st, parts, targets_p, ap_p, 7).1).collect();
            let raw_t = real_t.iter().any(|f| f.better_than_random);
            let w_real = real_t.iter().map(|f| f.gain).fold(f64::NEG_INFINITY, f64::max);
            if raw_t {
                let w_null: Vec<f64> = (1..=perm_k).into_par_iter().map(|k| {
                    let seed = 7u64 + 97u64 * (k as u64);
                    log_p.iter().map(|(st, parts)| { let sh = shuffle_words_seeded(st, seed); matched_seed_parts_line(&sh, &sh, parts, targets_p, ap_p, 7).1.gain }).fold(f64::NEG_INFINITY, f64::max)
                }).collect();
                let PermVerdict { n: _, mean, std, w_max, exceed, z: z_perm, p, ok } = perm_verdict(w_real, &w_null);   // the same one verdict as the line null — this was a second inline copy until 2026-09-16
                let r4 = |x: f64| (x * 1e4).round() / 1e4;
                perm_thread_json = json!({ "k": perm_k, "rungs": log_p.len(), "w_real": r4(w_real), "w_null_max": r4(w_max), "w_null_mean": r4(mean), "w_null_std": r4(std), "exceed": exceed, "p": r4(p), "z": (z_perm * 100.0).round() / 100.0, "ok": ok, "raw": true, "null": "thread" });
            } else {
                perm_thread_json = json!({ "k": perm_k, "rungs": log_p.len(), "ok": false, "raw": false, "skipped": "no-raw-latch", "null": "thread" });
            }
        }
        text = wtext; intent_span = wspan;
        let wgrip = grips.iter().find(|(l, _)| *l == winner).map(|(_, g)| *g);
        ratchet_json = json!({ "steps": steps, "guided_passes": guided_passes, "thread_stages": stages, "worms": worms_json, "winner": winner, "admissible": bf.better_than_random, "raw_admissible": raw_ok, "z_required": (z_req * 100.0).round() / 100.0, "rungs": attempts.len(), "perm": perm_json, "perm_thread": perm_thread_json, "thread_admissible": perm_thread_json.get("ok").and_then(|o| o.as_bool()).unwrap_or(false), "null": "line", "grip": wgrip, "admissible_rungs": attempts.iter().filter(|a| a.get("ok").and_then(|o| o.as_bool()).unwrap_or(false)).count() });
        (bs, Some(bf))
    };
    let seed_gzip_us = t_seed.elapsed().as_micros();
    let seed = top_seeds(&scores, &lib.coords, 3);
    let seed_coords: Vec<&str> = seed.iter().map(|&i| lib.coords[i].as_str()).collect();
    let blank = text.trim().is_empty();

    // UNPLACED (unified-drift.mjs, the CATO fix): non-blank text lighting ZERO anchors is
    // an honest third state — σ SENTINEL 99, no drift claim either way. Blank text stays
    // the σ=0 no-seed fallback. PMU_UNPLACED_DRIFT=0 restores the legacy path.
    let unplaced_on = std::env::var("PMU_UNPLACED_DRIFT").map(|v| v != "0").unwrap_or(true);
    if seed.is_empty() {
        let (sigma, sensor, reason) = if unplaced_on && !blank {
            (99.0, "unplaced", "non-blank text, zero gzip-NCD lattice placement (off-domain / unknown vocabulary)")
        } else {
            (z_margin(&scores), "no-seeds", "no lit seeds (empty/blank text)")
        };
        let out = json!({
            "pixel": Value::Null, "block": [0, 0],
            "fence": { "r0": 0, "r1": (radius).min(NB - 1).max(0), "c0": 0, "c1": (radius).min(NB - 1).max(0) },
            "walked": [], "in_role": [], "out_of_role": [],
            "sigma": sigma, "sensor": sensor, "fallback_reason": reason,
            "hops": 0, "max_ply": 0, "fill_pct": 0.0, "time_budget_tripped": false,
            "seed_gzip_us": seed_gzip_us as u64, "walk_ms": 0.0, "attempts": attempts, "ratchet": ratchet_json, "intent_span": intent_span,
            "running_in": running_in(&repo),
        });
        println!("{}", serde_json::to_string(&out).expect("serialize lens"));
        return;
    }

    // ── THE WALK: the real recursive guided definer walk, all hops in this process ──
    let t_walk = Instant::now();
    let walk = definer_walk(
        &grid,
        &lib.coords,
        &seed,
        &WalkOpts { max_depth, top_k, budget, budget_ms, decay },
    );
    let walk_ms = t_walk.elapsed().as_secs_f64() * 1000.0;

    // ── SHAPE + σ (norm → floor → shape; zMargin over the RAW heat) ──
    let max_heat = walk.heat.iter().cloned().fold(0.0f64, f64::max);
    let denom = if max_heat == 0.0 { 1.0 } else { max_heat };
    let mut walked: Vec<&str> = Vec::new();
    let mut walked_idx: Vec<usize> = Vec::new();
    for i in 0..GRID {
        if walk.heat[i] / denom > floor {
            walked.push(lib.coords[i].as_str());
            walked_idx.push(i);
        }
    }
    let sigma = z_margin(&walk.heat);
    let matrix_cells = walk.matrix.iter().filter(|v| **v > 0.0).count();
    // JS: +(100 * matrixCells / 20736).toFixed(2)
    let fill_pct = (100.0 * matrix_cells as f64 / CELLS as f64 * 100.0).round() / 100.0;

    // ── FENCE: the Chebyshev box around the placed pixel (boundaryFromStubSpec) ──
    let pixel = seed_coords[0];
    let (mut br, mut bc) = shortlex_to_block(pixel);
    if br < 0 || bc < 0 {
        // JS catch { keep 0,0 }
        br = 0;
        bc = 0;
    }
    let fence = (
        (br - radius).max(0),
        (br + radius).min(NB - 1),
        (bc - radius).max(0),
        (bc + radius).min(NB - 1),
    );

    // ── PARTITION: walked coords inside/outside the fence (block space) ──
    let mut in_role: Vec<&str> = Vec::new();
    let mut out_of_role: Vec<&str> = Vec::new();
    for (&c, &_i) in walked.iter().zip(walked_idx.iter()) {
        let (wr, wc) = shortlex_to_block(c);
        if wr >= fence.0 && wr <= fence.1 && wc >= fence.2 && wc <= fence.3 {
            in_role.push(c);
        } else {
            out_of_role.push(c);
        }
    }

    let walked_owned: Vec<String> = walked.iter().map(|c| c.to_string()).collect();
    let out = json!({
        "pixel": pixel,
        "block": [br, bc],
        "fence": { "r0": fence.0, "r1": fence.1, "c0": fence.2, "c1": fence.3 },
        "walked": walked,
        "in_role": in_role,
        "out_of_role": out_of_role,
        "sigma": sigma,
        "sensor": "metal",
        "hops": walk.hops,
        "max_ply": walk.max_ply,
        "fill_pct": fill_pct,
        "time_budget_tripped": walk.time_budget_tripped,
        "seed_gzip_us": seed_gzip_us as u64,
        "walk_ms": (walk_ms * 100.0).round() / 100.0,
        "seed_coords": seed_coords,
        "seed_mode": seed_mode,
        "attempts": attempts,
        "ratchet": ratchet_json,
        "intent_span": intent_span,
        "seed_fit": seed_fit.as_ref().map(|f| json!({ "gain": (f.gain * 1e4).round() / 1e4, "margin": (f.margin * 1e4).round() / 1e4, "z_fine": (f.z_fine * 100.0).round() / 100.0, "better_than_random": f.better_than_random, "region": f.region.iter().map(|&i| lib.coords[i].clone()).collect::<Vec<_>>(), "mass": { "prompt": f.mass_prompt, "bulk": f.mass_bulk, "intent": f.mass_intent }, "aperture": { "matched_cut": f.matched_cut, "coarse_cut": f.coarse_cut, "fine_cut": f.fine_cut, "rule": "aperture.rs" } })).unwrap_or(Value::Null),
        "cells": lattice_cells(&lib.coords, Some(pixel), &Some((fence.0 as i64, fence.1 as i64, fence.2 as i64, fence.3 as i64)), &walked_owned),
        "running_in": running_in(&repo),
    });
    println!("{}", serde_json::to_string(&out).expect("serialize lens"));
}

// ── tests — the in-crate floor; the cross-language gate is p2-lens-gate.test.mjs
#[cfg(test)]
mod hat_tests {
    use super::*;
    #[test]
    fn a_hat_never_scores_its_own_target() {
        // three targets; target 1's hat rides in the mass, tagged 1. Target 1's score must equal its score when the hat is absent.
        let targets = vec!["payments webhook signature verification for the stripe route and the raw event store".to_string(), "the ballistic walk on the lattice reads each row and follows the significant column by transpose".to_string(), "book chapter on the mailbox and the displacement receipt of the anvil".to_string()];
        let prompt = "verify the stripe webhook signature and keep the raw event";
        let ap = SeedAperture { matched_cut: true };
        let without = matched_seed_parts(prompt, &[(None, String::new())], &targets, &ap).0;
        let with_hat = matched_seed_parts(prompt, &[(Some(1), targets[1].clone())], &targets, &ap).0;
        assert!((without[1] - with_hat[1]).abs() < 1e-12, "target 1 scored with its own hat in the mass: {} vs {}", with_hat[1], without[1]);
        // Since the null shuffles only the LINE and holds the mass fixed (2026-09-14), an untagged hat no longer buys its own
        // target a calibrated gain either — the null cancels it. The tag stays as the second fence; this pins that an
        // untagged hat cannot inflate its own target by more than gzip granularity under the line-null.
        let leaky = matched_seed_parts(prompt, &[(None, targets[1].clone())], &targets, &ap).0;
        assert!(leaky[1] <= without[1] + 0.02, "an UNTAGGED hat inflated its own target under the line-null: {} vs {}", leaky[1], without[1]);
    }
    #[test]
    fn the_null_shuffles_only_the_line_inside_a_thread() {
        let line = "verify the stripe webhook signature and keep the raw event";
        let priors = "\n\nmake the panel read the immutable commit\n\nemail me the versioned spec";
        let thread = format!("{}{}", line, priors);
        let n = shuffle_line_in(&thread, line, 7);
        assert!(n.ends_with(priors), "the priors must be kept byte for byte: {}", n);
        assert_ne!(&n[..line.len()], line, "the line must be shuffled");
        let mut a: Vec<&str> = n[..line.len()].split_whitespace().collect(); a.sort(); let mut b: Vec<&str> = line.split_whitespace().collect(); b.sort();
        assert_eq!(a, b, "a shuffle keeps the words");
        assert_eq!(shuffle_line_in(line, line, 7), shuffle_words(line), "no thread → the seed-7 whole-text shuffle (parity fixture)");
        assert_ne!(shuffle_words_seeded(line, 7), shuffle_words_seeded(line, 7 + 97), "different seeds draw different nulls");
        assert_eq!(shuffle_words_seeded(line, 104), shuffle_words_seeded(line, 104), "a seed is deterministic");
    }
}

// ── in-crate tests ───────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_gzip_len_is_deterministic_and_gzip_shaped() {
        let d = b"fix the stripe webhook signature verification in the payments route";
        let a = node_gzip_len(d);
        assert_eq!(a, node_gzip_len(d));
        assert!(a > 18, "gzip header+trailer alone is 18 bytes");
    }

    #[test]
    fn z_margin_matches_js_shape() {
        // xs desc = [4, 2, 1, 1]; rest mean 4/3, var over rest, (top-mean)/std, 2dp
        let v = vec![1.0, 4.0, 2.0, 0.0, 1.0];
        let s = z_margin(&v);
        assert!((s - 5.66).abs() < 0.01, "got {}", s);
        assert_eq!(z_margin(&[1.0]), 0.0, "fewer than 2 positives → 0");
        assert_eq!(z_margin(&[2.0, 2.0, 2.0]), 0.0, "zero std → 0");
    }

    #[test]
    fn top_seeds_orders_desc_then_index_asc() {
        let coords: Vec<String> = (0..GRID).map(|i| SHORTLEX[i].to_string()).collect();
        let mut sc = vec![0.0; GRID];
        sc[5] = 0.9;
        sc[3] = 0.9;
        sc[7] = 0.5;
        sc[9] = 0.4;
        assert_eq!(top_seeds(&sc, &coords, 3), vec![3, 5, 7]);
    }

    #[test]
    fn walk_is_deterministic_and_guided() {
        let coords: Vec<String> = (0..GRID).map(|i| SHORTLEX[i].to_string()).collect();
        let mut grid = Box::new([0u8; CELLS]);
        // diagonal + a couple of directed edges
        for i in 0..GRID {
            grid[i * GRID + i] = 1;
        }
        grid[0 * GRID + 5] = 1;
        grid[5 * GRID + 9] = 1;
        let o = WalkOpts { max_depth: 2, top_k: 3, budget: 120, budget_ms: 600_000, decay: 0.5 };
        let a = definer_walk(&grid, &coords, &[0], &o);
        let b = definer_walk(&grid, &coords, &[0], &o);
        assert_eq!(a.heat, b.heat);
        assert_eq!(a.hops, b.hops);
        assert!((a.heat[0] - 1.0).abs() < 1e-12, "seed heat 1.0");
        assert!(a.heat[5] > 0.0, "followed anchor gets heat");
        assert!(!a.time_budget_tripped);
    }
}

// ── ONLY THE ONE RUST (operator 2026-09-14: "write it in rust and insist on only using the one same rust for
// all"). Everything the per-turn door and the panel walk used to compute in JS beside this binary — the session
// THREAD (prior prompts appended until the mass floor clears), the MASS LADDER (given → lane → reef lanes by
// vocabulary overlap), the walk-guided rung, and the definer walk itself for the panel — is computed HERE and
// only here. The JS modules are thin callers that spawn this binary once and read the answer. ───────────────

pub const THREAD_MAX_PROMPTS: usize = 12;
pub const THREAD_MAX_CHARS: usize = 8000;
pub const THREAD_RECEIPT_SCAN: usize = 600;
pub const LADDER_MAX_ATTEMPTS: usize = 4;

/// The session's prior prompts, newest first, from the receipt ledger the hook writes. `before` excludes any
/// receipt at or after that ISO timestamp — a replay never reads the future. Port of thread-aperture.mjs.
pub fn session_prior_prompts(session: &str, receipts_dir: &Path, exclude: &str, before: Option<&str>) -> Vec<String> {
    // THE INDEX FIRST (2026-09-14): .thetacog/lens-receipts/index.ndjson is one append-only line per receipt, written beside
    // the receipt by prompt-lens.writeReceipt. Newest last, so it is read from the tail; a session with no index entry falls
    // back to the directory scan below (receipts written before the index existed). Measured: the directory held 17,405 files.
    if let Ok(text) = std::fs::read_to_string(receipts_dir.join("index.ndjson")) {
        let mut out = Vec::new(); let mut seen: HashSet<String> = HashSet::new(); seen.insert(exclude.trim().to_string());
        for line in text.lines().rev().take(THREAD_RECEIPT_SCAN * 4) {
            let v: Value = match serde_json::from_str(line) { Ok(v) => v, Err(_) => continue };
            if v.get("session").and_then(|s| s.as_str()) != Some(session) { continue; }
            if let (Some(b), Some(ts)) = (before, v.get("ts").and_then(|t| t.as_str())) { if ts >= b { continue; } }
            let p = match v.get("prompt").and_then(|p| p.as_str()) { Some(p) => p.trim().to_string(), None => continue };
            if p.is_empty() || !seen.insert(p.clone()) { continue; }
            out.push(p);
            if out.len() >= THREAD_MAX_PROMPTS * 2 { break; }
        }
        if !out.is_empty() { return out; }
    }
    let mut names: Vec<String> = match std::fs::read_dir(receipts_dir) { Ok(rd) => rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.starts_with("lens-") && n.ends_with(".json") && n[5..n.len() - 5].chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())).collect(), Err(_) => return Vec::new() };
    names.sort(); names.reverse(); names.truncate(THREAD_RECEIPT_SCAN);
    let mut out = Vec::new(); let mut seen: HashSet<String> = HashSet::new(); seen.insert(exclude.trim().to_string());
    for n in names {
        let v: Value = match std::fs::read_to_string(receipts_dir.join(&n)).ok().and_then(|t| serde_json::from_str(&t).ok()) { Some(v) => v, None => continue };
        if v.get("session").and_then(|s| s.as_str()) != Some(session) { continue; }
        let p = match v.get("prompt").and_then(|p| p.as_str()) { Some(p) => p.trim().to_string(), None => continue };
        if let (Some(b), Some(ts)) = (before, v.get("ts").and_then(|t| t.as_str())) { if ts >= b { continue; } }
        if p.is_empty() || !seen.insert(p.clone()) { continue; }
        out.push(p);
    }
    out
}

pub struct ThreadSpan { pub prompts: usize, pub chars: usize, pub gzip: usize, pub floor: usize, pub thread: bool }
fn span_of(v: &Value) -> ThreadSpan { ThreadSpan { prompts: v.get("prompts").and_then(|x| x.as_u64()).unwrap_or(1) as usize, chars: v.get("chars").and_then(|x| x.as_u64()).unwrap_or(0) as usize, gzip: v.get("gzip").and_then(|x| x.as_u64()).unwrap_or(0) as usize, floor: v.get("floor").and_then(|x| x.as_u64()).unwrap_or(0) as usize, thread: v.get("thread").and_then(|x| x.as_bool()).unwrap_or(false) } }
/// The thread: the prompt alone if it clears the floor; else prior prompts appended newest-first until it does.
pub fn thread_intent(prompt: &str, session: Option<&str>, receipts_dir: &Path, floor: usize, before: Option<&str>) -> (String, ThreadSpan) { thread_intent_n(prompt, session, receipts_dir, floor, before, 1) }
/// The thread with a MINIMUM prompt count — the retroactive stages: when the floor-thread does not latch, the intent
/// traverses further back (3, then 5, then 9 prompts) before the mass side is widened again.
pub fn thread_intent_n(prompt: &str, session: Option<&str>, receipts_dir: &Path, floor: usize, before: Option<&str>, min_prompts: usize) -> (String, ThreadSpan) {
    let mut parts: Vec<String> = vec![prompt.to_string()];
    let mut text = prompt.to_string();
    let mut mass = node_gzip_len(text.as_bytes());
    if let Some(s) = session { if mass < floor || parts.len() < min_prompts {
        for prior in session_prior_prompts(s, receipts_dir, prompt, before) {
            if parts.len() >= THREAD_MAX_PROMPTS || text.chars().count() + 2 + prior.chars().count() > THREAD_MAX_CHARS { break; }
            parts.push(prior); text = parts.join("\n\n"); mass = node_gzip_len(text.as_bytes());
            if mass >= floor && parts.len() >= min_prompts { break; }
        }
    } }
    let n = parts.len();
    (text.clone(), ThreadSpan { prompts: n, chars: text.chars().count(), gzip: mass, floor, thread: n > 1 })
}

pub struct ReefLane { pub domain: String, pub coord: String, pub vocab: Vec<String>, pub mass: String }
pub fn load_reef(path: &Path) -> Vec<ReefLane> {
    let v: Value = match std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()) { Some(v) => v, None => return Vec::new() };
    v.get("domains").and_then(|d| d.as_array()).map(|a| a.iter().filter_map(|d| {
        let domain = d.get("domain")?.as_str()?.to_string();
        let coord = d.get("coord").and_then(|c| c.as_str()).unwrap_or("").to_string();
        let vocab: Vec<String> = d.get("vocab").and_then(|x| x.as_str()).unwrap_or("").to_lowercase().split_whitespace().map(|s| s.to_string()).collect();
        let mut m: Vec<String> = vec![d.get("template").and_then(|x| x.as_str()).unwrap_or("").to_string()];
        if let Some(rs) = d.get("rules").and_then(|r| r.as_array()) { for r in rs { if let Some(s) = r.as_str() { m.push(s.to_string()); } } }
        let mass = m.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
        Some(ReefLane { domain, coord, vocab, mass })
    }).collect()).unwrap_or_default()
}

/// The mass ladder: given → lane:<lane> → reef:<domain> ranked by vocabulary overlap with the text, deduped by
/// mass, at most LADDER_MAX_ATTEMPTS. Port of walk-door.mjs bulkLadder (now retired there).
pub fn bulk_ladder(text: &str, bulk: &str, lane: Option<&str>, reef: &[ReefLane]) -> Vec<(String, String)> {
    let mut ladder: Vec<(String, String)> = Vec::new(); let mut seen: HashSet<String> = HashSet::new();
    let mut push = |label: String, mass: &str, ladder: &mut Vec<(String, String)>| { let m = mass.trim(); if m.is_empty() || !seen.insert(m.to_string()) { return; } ladder.push((label, m.to_string())); };
    push("given".to_string(), bulk, &mut ladder);
    if let Some(l) = lane { if let Some(d) = reef.iter().find(|d| d.domain == l) { push(format!("lane:{}", l), &d.mass, &mut ladder); } }
    let toks: HashSet<String> = text.to_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|t| t.len() > 3).map(|t| t.to_string()).collect();
    let mut ranked: Vec<(usize, &ReefLane)> = reef.iter().map(|d| (d.vocab.iter().filter(|v| toks.contains(*v)).count(), d)).filter(|(h, _)| *h > 0).collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));   // stable: ties keep reef order, as the JS sort did
    for (_, d) in ranked { push(format!("reef:{}", d.domain), &d.mass, &mut ladder); }
    ladder.truncate(LADDER_MAX_ATTEMPTS);
    ladder
}

/// `pmu-onchip --thread --prompt <p> --session <id> [--receipts-dir d] [--before ts]` — the floor is aperture.rs's
pub fn run_thread(args: &[String]) {
    let repo = resolve_repo(args);
    let prompt = flag_val(args, "--prompt").unwrap_or_default();
    let session = flag_val(args, "--session");
    let dir = flag_val(args, "--receipts-dir").map(PathBuf::from).unwrap_or_else(|| repo.join(".thetacog/lens-receipts"));
    let before = flag_val(args, "--before");
    let (text, sp) = thread_intent(&prompt, session.as_deref(), &dir, crate::aperture::MIN_GZIP_BYTES, before.as_deref());
    println!("{}", serde_json::to_string(&json!({ "text": text, "span": { "prompts": sp.prompts, "chars": sp.chars, "gzip": sp.gzip, "floor": sp.floor, "session": session, "thread": sp.thread } })).expect("serialize thread"));
}

/// `pmu-onchip --definer-walk --seeds 3,17 [--grid path.json] [walk knobs]` — THE PANEL WALK, in-process.
/// definerWalk144 (JS) is a thin caller of this; the per-hop --ballistic spawns are gone. Output carries heat, ply,
/// hops, max_ply, matrix, m_ply, time_budget_tripped, elapsed_ms and a hop log for callers that watched hops.
pub fn run_definer_walk(args: &[String]) {
    let repo = resolve_repo(args);
    let lib_path = flag_val(args, "--targets").map(PathBuf::from).unwrap_or_else(|| repo.join("data/pmu/snippet-library-144.json"));
    let lib = match load_library(&lib_path) { Ok(l) => l, Err(e) => { eprintln!("pmu-onchip --definer-walk: {}", e); std::process::exit(2); } };
    let grid: Box<[u8; CELLS]> = match flag_val(args, "--grid") {
        Some(p) => { let v: Value = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null); let mut g = Box::new([0u8; CELLS]); if let Value::Array(arr) = v { if arr.len() == CELLS { for (k, x) in arr.iter().enumerate() { g[k] = if x.as_f64().unwrap_or(0.0) != 0.0 { 1 } else { 0 }; } } } g }
        None => load_directed_grid(&repo, &lib.coords),
    };
    let seeds: Vec<usize> = flag_val(args, "--seeds").unwrap_or_default().split(',').filter_map(|s| s.trim().parse().ok()).collect();
    let o = WalkOpts {
        max_depth: flag_val(args, "--max-depth").and_then(|s| s.parse().ok()).unwrap_or(8usize),
        top_k: flag_val(args, "--top-k").and_then(|s| s.parse().ok()).unwrap_or(2usize),
        budget: flag_val(args, "--budget").and_then(|s| s.parse().ok()).unwrap_or(220usize),
        budget_ms: flag_val(args, "--budget-ms").and_then(|s| s.parse().ok()).unwrap_or(600_000u128),
        decay: flag_val(args, "--decay").and_then(|s| s.parse().ok()).unwrap_or(0.5f64),
    };
    let t0 = Instant::now();
    let w = definer_walk(&grid, &lib.coords, &seeds, &o);
    println!("{}", serde_json::to_string(&json!({ "heat": w.heat, "ply": w.ply, "hops": w.hops, "max_ply": w.max_ply, "matrix": w.matrix, "m_ply": w.m_ply, "time_budget_tripped": w.time_budget_tripped, "elapsed_ms": t0.elapsed().as_millis() as u64, "hop_log": w.hop_log, "knobs": { "maxDepth": o.max_depth, "topK": o.top_k, "budget": o.budget, "budgetMs": o.budget_ms as u64, "decay": o.decay } })).expect("serialize walk"));
}
