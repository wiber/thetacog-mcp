// src/hud.rs — C748 THE STREAMING HUD SERVER: `pmu-onchip --hud-serve [--config <hud-config.json>] [--repo <dir>]`.
//
// One resident process, shaped like door.rs run_door_serve. STDIN is a stream of NDJSON events:
//   {op:'text', text|append, source}  {op:'select', n, by}  {op:'defend', n, sentence}  {op:'freeze', by}
//   {op:'health'}  {op:'config'}  {op:'shutdown'}
//   {op:'context', text, sources}  the context pool (operator 2026-10-15: "make sure this runs on all context we have available,
//                                  transcripts too"): every record the host composes (scripts/vna/hud-context.mjs), capped at
//                                  context_chars; the cells draw their words from the window AND the pool (hud::fold_ctx), the walk
//                                  stays the window's, and every reading names the pool it read by sha, size and sources.
// STDOUT is one JSON line per thing that lands, flushed: {kind:'reading'} {kind:'grid'} {kind:'frozen'} {kind:'health'}
// {kind:'config'} {kind:'refused'} {kind:'error'}.
//
// WHAT LIVES HERE (and nowhere else):
//  * the rolling window (window_words from the config, then max_chars), the debounce and the mute-on-listen rule: the walk
//    fires from the loop's timer wait only when new text sat for debounce_ms with the window changed since the last walk,
//    never out of silence and never twice for one window sha;
//  * the walk itself is lens::read_text, the same per-text composition `--lens` runs (source 'hud'), so there is no second walk;
//  * the fold of the 144 heat onto the FIXED COMPASS (C778): nine cells placed by child axis A1..C3 (lattice::AXES[3..12]), row = tier,
//    column = child, a cell's heat the share of the field on its axis; an empty axis is a dark cell and clears its grid slot;
//  * the grid (hud_grid.rs) and THE ASYMMETRIC GATE: a freeze needs a key or a click; a voice-shaped origin never freezes or
//    dispatches. The gate is decided here, in the process that holds the grid, and not in the page.
// THE WALK TAPE: this server emits everything the tape row needs on the reading (text_sha, pixel, ms, result) and leaves the row
// to node's walk-door.mjs writer, which signs it with the room identity. C749 wires `recordWalk` to the reading line.
// A placement is re-runnable from the commit: same window, same bytes, same heat hash (Grip).
#![allow(dead_code)]

use crate::hud_config::{self, HudConfigFile};
use crate::hud_grid::{self, Grid};
use crate::lens;
use intentguard::lattice;
use serde_json::{json, Value};
// C752: the window, the walk options, the fold and the colours live in the intentguard library (src/hud.rs), the one home the
// napi addon's hudReading also calls; re-exported here so the server, its tests and every caller of hud::fold reach that copy.
#[allow(unused_imports)]
pub use intentguard::hud::{band_of, colour_of, fold, fold_ctx, iso, lens_opts, sha12, window};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The clock seam: the loop never reads time directly, so a cargo test drives the debounce with a fake clock and no sleeping.
pub trait Clock {
    fn now_ms(&self) -> u64;
}
pub struct SystemClock(Instant);
impl SystemClock {
    pub fn new() -> SystemClock { SystemClock(Instant::now()) }
}
impl Clock for SystemClock {
    fn now_ms(&self) -> u64 { self.0.elapsed().as_millis() as u64 }
}

/// `pmu-onchip --axes --json`: the one axis table, as the crate holds it.
pub fn axes_json() -> Value {
    json!({ "axes": lattice::AXES, "lanes": lattice::LANES.iter().map(|(a, n)| (a.to_string(), json!(n))).collect::<serde_json::Map<String, Value>>() })
}

fn unmeasured(why: &str) -> Vec<Value> {
    vec![json!({ "slot": Value::Null, "strategy": Value::Null, "tactics": Value::Null, "operations": Value::Null, "colour": "UNMEASURED", "ncd": Value::Null, "lane": Value::Null, "why": why })]
}


// ── the server ───────────────────────────────────────────────────────────────────────────────────────────────────────
pub type Walker = Box<dyn FnMut(&str) -> Result<Value, String>>;

pub struct Server {
    pub cfg: HudConfigFile,
    pub cfg_path: String,
    pub loaded: bool,
    pub why: String,
    pub repo: PathBuf,
    pub grid: Grid,
    /// C759 H13: where the walk's worms last landed, per tier cell, and when — the fade is time since a worm last confirmed the cell
    pub worms: hud_grid::WormGrid,
    pub window: String,
    pub source: String,
    dirty: bool,
    last_text_at: u64,
    last_walk_sha: Option<String>,
    pub last_walk: Value,
    /// C751: the walk's own time budget (--budget-ms) when the operator set one; None = the walk knobs' home default. Named in the UNMEASURED why.
    pub budget_ms: Option<u64>,
    /// 2026-10-13: when the grid still holds queued, pending or fading cells after an event, the time its next tick is due. A reading
    /// queues nine cells and the rate gate lets transitions_per_s enter per second; without this the rest waited for the NEXT input line
    /// (the operator's HUD showed 2 of 9 cells filled and asked "did we get stuck again?"). Never a walk: a grid tick only moves cells.
    pub grid_next: Option<u64>,
    /// 2026-10-13: the snowball's processes as ticker rows (hud_grid TickerBoard), one per live process, painted under the grid
    pub tickers: hud_grid::TickerBoard,
    /// C751: set when the last text event was longer than max_chars and was cut; the next reading carries it, then it is cleared.
    capped: Option<Value>,
    /// 2026-10-15: the context pool the cell words are drawn from beside the window, and what it was built from (sha, chars, sources)
    pub context: String,
    pub context_meta: Value,
    walker: Walker,
    epoch_ms: u64,
}

impl Server {
    pub fn new(cfg: HudConfigFile, cfg_path: String, loaded: bool, why: String, repo: PathBuf, walker: Walker, epoch_ms: u64) -> Server {
        let grid = hud_grid::create_grid(&cfg.grid());
        Server { cfg, cfg_path, loaded, why, repo, grid, worms: hud_grid::create_worm_grid(), window: String::new(), source: String::new(), dirty: false, last_text_at: 0, last_walk_sha: None, last_walk: Value::Null, budget_ms: None, grid_next: None, tickers: hud_grid::TickerBoard::default(), capped: None, context: String::new(), context_meta: Value::Null, walker, epoch_ms }
    }

    fn at(&self, now: u64) -> String { iso(self.epoch_ms + now) }

    /// The deadline at which the debounced walk is due, or None while nothing is waiting (silence never walks).
    pub fn due_at(&self) -> Option<u64> {
        let walk = if self.dirty { Some(self.last_text_at + self.cfg.debounce_ms) } else { None };
        match (walk, self.grid_next) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) }
    }
    /// the grid still has a cell to move: a queued entry, a pending replacement, or a cell fading out
    fn grid_busy(&self) -> bool {
        !self.grid.queue.is_empty() || !self.grid.pending.is_empty() || self.grid.slots.iter().flatten().any(|c| c.retire_at.is_some())
    }

    /// Trim to window_words words from the end, joined by single spaces, then cut to max_chars from the head (the walk door's own cap).
    /// C751: returns the window and, when the cut dropped characters, how many the window held before the cut (the reading says so).
    fn windowed(&self, text: &str) -> (String, Option<usize>) {
        window(text, self.cfg.window_words, self.cfg.max_chars)
    }

    fn grid_event(&mut self, now: u64, extra: Option<Value>) -> Value {
        hud_grid::tick(&self.cfg.grid(), &mut self.grid, now);
        // the next tick at the gate's own interval while cells wait; none once the grid is still
        let step = 1000 / (self.cfg.grid().transitions_per_s.max(1) as u64);
        self.grid_next = if self.grid_busy() { Some(now + step) } else { None };
        let mut g = hud_grid::state_json(&self.grid);
        g["kind"] = json!("grid");
        g["at"] = json!(self.at(now));
        g["archetype"] = serde_json::to_value(hud_grid::archetype(&self.grid)).unwrap_or(Value::Null);
        g["ask_line"] = json!(hud_grid::ask_line(&self.grid));
        g["draft"] = json!(hud_grid::draft_steer(&self.grid));
        g["tickers"] = serde_json::to_value(&self.tickers.rows).unwrap_or(Value::Null);   // one row per live snowball process, newest landing last
        g["rows"] = json!(hud_grid::row_counts(&self.grid));   // [green, amber, red] per tier row, for the readout under the grid
        let live = self.worms.cells.iter().flatten().filter(|c| hud_grid::worm_opacity(Some(c), now, self.cfg.worm_decay_ms, self.cfg.worm_floor) > 0.0).count();
        g["readout"] = json!(hud_grid::readout_lines(&self.last_walk, &self.grid, live, self.cfg.worm_max_live));   // the lines under the grid, composed here, painted by the page   // 2026-10-13: the next /steer, composed live off the window and the grid, copied by the operator
        // C759 H13: each slot's fade, read off the worm grid: 1 just confirmed, falling to worm_floor, 0 never landed
        g["worm"] = json!((0..9).map(|i| { let c = self.worms.cells.get(i).and_then(|c| c.as_ref()); json!({ "opacity": (hud_grid::worm_opacity(c, now, self.cfg.worm_decay_ms, self.cfg.worm_floor) * 1000.0).round() / 1000.0, "confirmed_at": c.map(|c| self.at(c.confirmed_at)) }) }).collect::<Vec<_>>());
        if let Some(e) = extra { g["result"] = e; }
        g
    }

    /// One input line at time `now`: the lines to print, and whether the loop ends.
    pub fn on_line(&mut self, line: &str, now: u64) -> (Vec<Value>, bool) {
        let req: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => return (vec![json!({ "kind": "error", "why": format!("bad json: {}", e) })], false),
        };
        let op = req.get("op").and_then(Value::as_str).unwrap_or("");
        let by = req.get("by").and_then(Value::as_str).unwrap_or("");
        let mut out = vec![];
        match op {
            "text" => {
                let next = if let Some(t) = req.get("text").and_then(Value::as_str) { t.to_string() }
                    else if let Some(a) = req.get("append").and_then(Value::as_str) { format!("{} {}", self.window, a) }
                    else { return (vec![json!({ "kind": "error", "why": "text event needs text or append" })], false); };
                let (w, held) = self.windowed(&next);
                self.window = w;
                self.capped = held.map(|h| json!({ "from_chars": h, "to_chars": self.cfg.max_chars, "why": format!("the text event held {} chars; the window is capped at max_chars {} (the walk door's head cap)", h, self.cfg.max_chars) }));
                if let Some(s) = req.get("source").and_then(Value::as_str) { self.source = s.to_string(); }
                self.dirty = self.last_walk_sha.as_deref() != Some(&sha12(&self.window)) && !self.window.is_empty();
                self.last_text_at = now;   // new text restarts the debounce: the walk waits for the speaker to pause
                hud_grid::set_window_text(&mut self.grid, &self.window);
            }
            "context" => {
                let Some(t) = req.get("text").and_then(Value::as_str) else { return (vec![json!({ "kind": "error", "why": "context event needs text" })], false); };
                // the pool keeps its newest bytes: the host composes it oldest to newest, so the head is what a cap drops
                let cap = self.cfg.context_chars;
                let held = t.chars().count();
                let kept: String = if held > cap { t.chars().skip(held - cap).collect() } else { t.to_string() };
                let changed = sha12(&kept) != sha12(&self.context);
                self.context_meta = json!({ "sha": sha12(&kept), "chars": kept.chars().count(), "held_chars": held, "cap": cap,
                    "words_scored": self.cfg.context_words, "sources": req.get("sources").cloned().unwrap_or(Value::Null) });
                self.context = kept;
                // a new pool re-reads the window it already holds: the words change, the walk's sha guard is cleared for it
                if changed && !self.window.trim().is_empty() { self.dirty = true; self.last_walk_sha = None; self.last_text_at = now; }
                out.push(json!({ "kind": "context", "context": self.context_meta.clone() }));
            }
            "select" => {
                let n = req.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
                let r = hud_grid::select(&self.cfg.grid(), &mut self.grid, n, now);
                out.push(self.grid_event(now, Some(r)));
            }
            "defend" => {
                let n = req.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
                let s = req.get("sentence").and_then(Value::as_str).unwrap_or("");
                let r = hud_grid::defend(&self.cfg.grid(), &mut self.grid, n, s, now);
                out.push(self.grid_event(now, Some(r)));
            }
            "freeze" => {
                if by != "key" && by != "click" {
                    out.push(json!({ "kind": "refused", "why": "the asymmetric gate: a voice-shaped origin never freezes" }));
                } else if self.window.trim().is_empty() {
                    out.push(json!({ "kind": "refused", "why": "the window is empty: there is nothing to freeze" }));
                } else {
                    match hud_grid::freeze_text(&self.grid) {
                        None => out.push(json!({ "kind": "refused", "why": "the archetype holds the freeze: a red cell is undefended" })),
                        Some(text) => {
                            let a = hud_grid::archetype(&self.grid);
                            let locked: Vec<String> = self.grid.slots.iter().flatten().filter(|c| c.locked).map(|c| format!("{} · {} · {}", c.strategy, c.tactics, c.operations)).collect();
                            let defences: Vec<String> = self.grid.defences.values().map(|d| d.sentence.clone()).collect();
                            out.push(json!({ "kind": "frozen", "text": text, "row": {
                                "at": self.at(now), "window_sha": sha12(&self.window), "archetype": a.name, "locked": locked, "defences": defences, "text_sha": sha12(&text) } }));
                        }
                    }
                }
            }
            // the composed lines for the strip, and the same inputs as numbers (data) so the page draws them without parsing a line (2026-10-13)
            "health" => { let h = self.health(); out.push(json!({ "kind": "health", "lines": hud_grid::health_lines(&h), "data": h })) }
            "config" => {
                let mut c = self.cfg.to_json();
                c["kind"] = json!("config"); c["config_path"] = json!(self.cfg_path); c["loaded"] = json!(self.loaded); c["why"] = json!(self.why);
                out.push(c);
            }
            "shutdown" => return (out, true),
            other => out.push(json!({ "kind": "error", "why": format!("unknown op '{}'", other) })),
        }
        (out, false)
    }

    /// C751: after a panic inside a walk the window is dropped, so the same text is not walked into the same panic on the next tick.
    pub fn reset_after_panic(&mut self) { self.dirty = false; self.window.clear(); }

    /// The timer: walk only when the window changed and debounce_ms of quiet followed the last text event.
    pub fn on_tick(&mut self, now: u64) -> Vec<Value> {
        // a due grid tick with no walk due moves the waiting cells and emits the grid alone
        let walk_due = self.dirty && now >= self.last_text_at + self.cfg.debounce_ms;
        if !walk_due {
            if matches!(self.grid_next, Some(g) if now >= g) { return vec![self.grid_event(now, None)]; }
            return vec![];
        }
        self.dirty = false;
        if self.window.trim().is_empty() { return vec![]; }   // C751: an empty window is never walked
        let window = self.window.clone();
        let sha = sha12(&window);
        if self.last_walk_sha.as_deref() == Some(&sha) { return vec![]; }   // never twice for one window sha
        self.last_walk_sha = Some(sha.clone());
        let words = window.split_whitespace().count();
        let t0 = Instant::now();
        let walked = (self.walker)(&window);
        let ms = (t0.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0;
        let tripped = walked.as_ref().ok().and_then(|r| r.get("time_budget_tripped")).and_then(Value::as_bool).unwrap_or(false);
        let (cells, mut walk, result, heat_hash) = match &walked {
            Ok(res) if tripped => {
                let why = format!("UNMEASURED: the walk tripped its time budget ({}), so its heat is a partial walk and is not painted", self.budget_ms.map(|b| format!("budget_ms {}", b)).unwrap_or_else(|| "the walk knobs' budgetMs".to_string()));
                (unmeasured(&why), json!({ "ok": false, "ms": ms, "pixel": res.get("pixel").cloned().unwrap_or(Value::Null), "why": why }), res.clone(), String::new())
            }
            Ok(res) => match fold_ctx(res.get("heat").unwrap_or(&Value::Null), res, self.cfg.grid().ncd_green, &window, &self.context, self.cfg.context_words,
                lens::load_library(&self.repo.join("data/pmu/snippet-library-144.json")).ok().as_ref()) {
                Some(cells) => {
                    let hh = sha12(&res["heat"].to_string());
                    let w = json!({ "ok": true, "ms": ms, "pixel": res.get("pixel").cloned().unwrap_or(Value::Null), "why": Value::Null });
                    (cells, w, res.clone(), hh)
                }
                None => {
                    let why = "walk returned no 144-cell heat field";
                    (unmeasured(why), json!({ "ok": false, "ms": ms, "pixel": res.get("pixel").cloned().unwrap_or(Value::Null), "why": why }), res.clone(), String::new())
                }
            },
            Err(e) => (unmeasured(e), json!({ "ok": false, "ms": ms, "pixel": Value::Null, "why": e }), Value::Null, String::new()),
        };
        walk["budget_tripped"] = json!(tripped);
        // H10 (C758): the ballistic snowball's traces — the winning rung (a worm ring or a guided pass), the worm count, the guided passes,
        // the admissible rungs out of all — ride the telemetry shelf, never a cell (the cells hold three heard words only)
        let rt = result.get("ratchet").cloned().unwrap_or(Value::Null);
        let traces = if rt.is_null() { Value::Null } else { json!({ "winner": rt.get("winner"), "worms": rt.pointer("/worms/n"), "guided_passes": rt.get("guided_passes"), "rungs": rt.get("rungs"), "admissible_rungs": rt.get("admissible_rungs") }) };
        self.last_walk = json!({ "sensor": if walk["ok"] == json!(true) { "metal" } else { "unmeasured" }, "pixel": walk["pixel"], "ms": ms, "err": walk["why"], "traces": traces, "sigma": result.get("sigma").cloned().unwrap_or(Value::Null), "seed_fit": result.get("seed_fit").cloned().unwrap_or(Value::Null) });
        let reading = json!({ "kind": "reading", "at": self.at(now), "window_sha": sha, "words": words, "text_sha": sha12(&window),
            "source": self.cfg.walk_source, "heard_from": self.source, "cells": cells, "walk": walk, "heat_hash": heat_hash, "result": result,
            "capped": self.capped.take().unwrap_or(Value::Null), "context": self.context_meta.clone() });
        hud_grid::apply_reading(&self.cfg.grid(), &mut self.grid, &cells, now);
        // C759 H13: the walk's own landing and each worm ring's seed are the processes that ran; at most worm_max_live of them land,
        // each confirming the tier cell its coordinate falls in, with that cell's three heard words
        let mut landed: Vec<String> = vec![]; if let Some(p) = result.get("pixel").and_then(Value::as_str) { landed.push(p.to_string()); }
        if let Some(seeds) = result.pointer("/ratchet/worms/seeds").and_then(Value::as_array) { for s in seeds { if let Some(p) = s.as_str() { landed.push(p.to_string()); } } }
        let readings: Vec<hud_grid::WormReading> = landed.iter().enumerate().filter_map(|(k, p)| {
            let i = hud_grid::worm_cell_index(p)?; let c = cells.iter().find(|c| c["slot"] == json!(i))?;
            let w = |key: &str| c[key].as_str().unwrap_or("UNMEASURED").to_string();
            Some(hud_grid::WormReading { id: k, pixel: p.clone(), strategy: w("strategy"), tactics: w("tactics"), operations: w("operations") })
        }).collect();
        hud_grid::apply_worms(&mut self.worms, &readings, self.cfg.worm_max_live, now);
        let hms = self.at(now).get(11..19).unwrap_or("").to_string();
        hud_grid::ticker_push(&mut self.tickers, &readings, self.cfg.worm_max_live, &hms, 6);
        vec![reading, self.grid_event(now, None)]
    }

    /// The health strip's inputs, read from the paths the config names relative to --repo (a port of vna-hud.ts readHealth).
    pub fn health(&self) -> Value {
        let tape: PathBuf = std::env::var("PMU_WALK_TAPE").ok().filter(|p| !p.is_empty()).map(PathBuf::from).unwrap_or_else(|| self.repo.join(".thetacog/walk-tape.ndjson"));
        let rows = |p: &Path| -> Vec<Value> {
            std::fs::read_to_string(p).map(|t| t.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect()).unwrap_or_default()
        };
        let mut walk = Value::Null;
        if let Some(w) = last_row_with_source(&tape, "hud", HEALTH_TAPE_CAP) {
            walk = json!({ "bin_sha": w.get("bin_sha"), "reef_sha": w.get("reef_sha"), "aperture_id": w.get("aperture_id"), "pixel": w.get("pixel"), "ms": w.get("ms"), "sensor": w.get("sensor"), "err": w.get("err") });
        } else if !self.last_walk.is_null() {
            walk = self.last_walk.clone();
        }
        let mut boundary = Value::Null;
        if let Ok(rd) = std::fs::read_dir(self.repo.join("data/pmu")) {
            let mut names: Vec<(std::time::SystemTime, PathBuf)> = rd.filter_map(|e| e.ok()).filter(|e| { let n = e.file_name().to_string_lossy().to_string(); n.starts_with("boundary-receipt-") && n.ends_with(".json") })
                .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
            names.sort_by(|a, b| b.0.cmp(&a.0));
            if let Some((_, p)) = names.first() {
                if let Some(d) = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                    let r = d.get("reads").and_then(Value::as_array).and_then(|a| a.last().cloned()).unwrap_or(Value::Null);
                    let machine = r.get("host").map(|h| [h.get("cpu_model"), h.get("region")].iter().flatten().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" · "));
                    boundary = json!({ "control_ratio": r.pointer("/control/ratio_median"), "crossing_ratio": r.pointer("/sizes/kib1024_ratio_median"),
                        "admissible": r.pointer("/control/admissible"), "date": r.get("measured_at"), "machine": machine });
                }
            }
        }
        let snow = rows(&self.repo.join(&self.cfg.hud_snowballs)).into_iter().map(|r| {
            let label = r.get("archetype").or_else(|| r.get("text_sha")).cloned().unwrap_or(json!(""));
            let chars = r.get("chars").or_else(|| r.get("text_chars")).filter(|v| v.is_number()).cloned().unwrap_or(Value::Null);
            json!({ "at": r.get("at"), "label": label, "chars": chars })
        }).collect::<Vec<_>>();
        // 2026-10-13 (operator, on the health card: "optimisation target matter here"): the census of every floor and ratchet
        // (data/vna/ratchet-census.json, C238a) and the hook latency against its floor (data/vna/hook-latency*.json, C321a) replace the
        // canonical-constants line; the receipts are read raw here and the verdict (over its floor or not) is taken in hud_grid::health_lines
        let rd = |rel: &str| std::fs::read_to_string(self.repo.join(rel)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null);
        let (census, lat, floor) = (rd("data/vna/ratchet-census.json"), rd("data/vna/hook-latency.json"), rd("data/vna/hook-latency-floor.json"));
        let hooks = lat.get("hooks").and_then(Value::as_object).map(|m| m.iter().map(|(k, v)| json!({ "name": k, "p50": v.get("p50"), "n": v.get("n"),
            "floor": floor.pointer(&format!("/hooks/{}/p50", k)) })).collect::<Vec<_>>());
        let opt = if census.is_null() && hooks.is_none() { Value::Null } else {
            json!({ "count": census.get("count"), "unmeasured": census.get("unmeasured"), "worse": census.get("trending_worse"), "hooks": hooks, "at": census.get("at") }) };
        json!({ "walk": walk, "boundary": boundary, "snowballs": { "rows": snow }, "opt": opt, "traces": self.last_walk.get("traces").cloned().unwrap_or(Value::Null) })
    }
}

/// The server's loop over a channel of input lines (None = stdin closed). The recv_timeout IS the timer: it wakes at the debounce
/// deadline and not before, so the walk never fires out of silence. Returns the process exit code.
/// The tape is append-only and grows without bound (1.6 GB on the operator's Mac, 2026-10-12); reading it whole made
/// {op:'health'} miss every deadline. The health strip needs only the NEWEST walk row from `want`, so this reads backwards
/// in 1 MiB chunks and never past `cap` bytes from the end; a row older than the cap reads as no row (the caller falls back
/// to the server's own last walk). The `"want"` substring is only a prefilter: the parse decides.
pub const HEALTH_TAPE_CAP: u64 = 64 << 20;
/// A tape row is a walk receipt, kilobytes long. A run of bytes with no newline past this is not a row: it is dropped, never carried,
/// so the read stays linear in the cap. Measured 2026-10-12: carrying it made a 4 GB sparse tape (no newline) copy ~2 GB in 1 MiB
/// steps and answer in 4.6 s against 40 ms on an empty tape.
pub const HEALTH_LINE_MAX: usize = 4 << 20;
pub fn last_row_with_source(p: &Path, want: &str, cap: u64) -> Option<Value> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(p).ok()?;
    let len = f.metadata().ok()?.len();
    let floor = len.saturating_sub(cap);
    let needle = format!("\"{}\"", want);
    let (mut end, mut carry) = (len, Vec::<u8>::new());
    while end > floor {
        let start = end.saturating_sub(1 << 20).max(floor);
        let mut buf = vec![0u8; (end - start) as usize];
        f.seek(SeekFrom::Start(start)).ok()?;
        f.read_exact(&mut buf).ok()?;
        buf.extend_from_slice(&carry);
        let mut parts: Vec<&[u8]> = buf.split(|b| *b == b'\n').collect();
        let head = if start > 0 { parts.remove(0).to_vec() } else { Vec::new() };   // a line cut by the chunk edge waits for the next chunk
        for l in parts.iter().rev() {
            if l.is_empty() || !l.windows(needle.len()).any(|w| w == needle.as_bytes()) { continue; }
            if let Ok(v) = serde_json::from_slice::<Value>(l) {
                if v.get("source").and_then(Value::as_str) == Some(want) { return Some(v); }
            }
        }
        carry = if head.len() > HEALTH_LINE_MAX { Vec::new() } else { head };
        end = start;
    }
    None
}

pub fn serve(rx: mpsc::Receiver<Option<String>>, out: &mut dyn Write, clock: &dyn Clock, server: &mut Server) -> i32 {
    let emit = |out: &mut dyn Write, lines: Vec<Value>| { for l in lines { let _ = writeln!(out, "{}", l); } let _ = out.flush(); };
    loop {
        let now = clock.now_ms();
        let got = match server.due_at() {
            Some(d) => rx.recv_timeout(Duration::from_millis(d.saturating_sub(now))),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match got {
            Ok(Some(line)) => {
                if line.trim().is_empty() { continue; }
                // C751: a panic inside a line or a walk is an error event and the loop goes on (UNMEASURED beats a dead server)
                let now = clock.now_ms();
                let (lines, stop) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| server.on_line(&line, now)))
                    .unwrap_or_else(|_| (vec![json!({ "kind": "error", "why": "UNMEASURED: the server panicked on this line and went on" })], false));
                emit(out, lines);
                if stop { return 0; }
            }
            Ok(None) | Err(RecvTimeoutError::Disconnected) => return 0,
            Err(RecvTimeoutError::Timeout) => {
                let now = clock.now_ms();
                let l = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| server.on_tick(now)))
                    .unwrap_or_else(|_| { server.reset_after_panic(); vec![json!({ "kind": "error", "why": "UNMEASURED: the walk panicked; the window is dropped and the server went on" })] });
                emit(out, l);
            }
        }
    }
}

/// `pmu-onchip --hud-serve [--config <file>] [--repo <dir>]`
pub fn run_hud_serve(args: &[String]) -> i32 {
    let flag = |f: &str| args.iter().position(|a| a == f).and_then(|i| args.get(i + 1)).cloned();
    let repo = flag("--repo").map(PathBuf::from).unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let cfg_path = hud_config::resolve_path(flag("--config").as_deref());
    let (cfg, loaded, why) = hud_config::load(&cfg_path);
    // The walk knobs are the one home's (walk-knobs.mjs): the full walk (the binary's own defaults) plus the seed aperture the
    // walk door passes for every non-commit source. The fold's top_k is the config's and never the walk's --top-k.
    // C751: --budget-ms N bounds every walk (the walk's own --budget-ms); a bad value refuses to start with its why.
    let budget_ms: Option<u64> = match flag("--budget-ms") {
        None => None,
        Some(v) => match v.parse::<u64>() { Ok(n) if n > 0 => Some(n), _ => { eprintln!("hud-serve: --budget-ms needs a positive whole number of milliseconds, got '{}'", v); return 2; } },
    };
    let opts = lens_opts(&repo, budget_ms);
    let r2 = repo.clone();
    let walker: Walker = Box::new(move |text: &str| lens::read_text(text, &opts, &r2));
    let epoch = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let clock = SystemClock::new();
    let mut server = Server::new(cfg, cfg_path.to_string_lossy().to_string(), loaded, why, repo, walker, epoch);
    server.budget_ms = budget_ms;
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        // C751: bytes, not lines(): a line that is not UTF-8 reads lossily (and then fails as bad json) instead of ending the server
        let mut r = std::io::stdin().lock();
        let mut buf: Vec<u8> = vec![];
        loop {
            buf.clear();
            match r.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => { let l = String::from_utf8_lossy(&buf).trim_end_matches(&['\n', '\r'][..]).to_string(); if tx.send(Some(l)).is_err() { return; } }
            }
        }
        let _ = tx.send(None);
    });
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    serve(rx, &mut out, &clock, &mut server)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell as StdCell;
    use std::rc::Rc;

    #[test]
    fn the_grid_queue_drains_on_its_own_timer_after_one_reading() {
        // 2026-10-13: one reading queues nine cells; the rate gate admits transitions_per_s per second. With no further input line,
        // the server's own timer must keep ticking the grid until all nine are in, and then stop (a still grid arms no timer).
        let calls = Rc::new(StdCell::new(0));
        let mut s = server(calls.clone());
        s.on_line(r#"{"op":"text","text":"alpha beta gamma"}"#, 0);
        let first = s.on_tick(400);
        assert_eq!(first[0]["kind"], "reading");
        let mut now = 400;
        for _ in 0..40 { match s.due_at() { Some(d) => { now = d.max(now); let _ = s.on_tick(now); } None => break } }
        let filled = s.grid.slots.iter().filter(|c| c.is_some()).count();
        assert_eq!(filled, 9, "the timer filled all nine without another input line (filled {})", filled);
        assert!(s.due_at().is_none(), "a still grid arms no timer");
        assert_eq!(calls.get(), 1, "the grid ticks never walked");
    }

    #[test]
    fn health_tape_read_is_the_newest_hud_row_bounded_by_the_cap() {
        let dir = std::env::temp_dir().join(format!("hud-tape-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("tape.ndjson");
        let mut t = String::new();
        t.push_str("{\"source\":\"hud\",\"pixel\":\"OLD\"}\n");
        let filler = format!("{{\"source\":\"lens\",\"pad\":\"{}\"}}\n", "x".repeat(4000));
        for _ in 0..600 { t.push_str(&filler); }   // ~2.4 MB: the newest hud row sits across several 1 MiB chunk edges
        t.push_str("{\"source\":\"hud\",\"pixel\":\"NEW\"}\n");
        for _ in 0..300 { t.push_str(&filler); }
        t.push_str("{\"source\":\"lens\",\"note\":\"\\\"hud\\\" in a value is not the source\"}\n");
        std::fs::write(&p, &t).unwrap();
        let got = last_row_with_source(&p, "hud", HEALTH_TAPE_CAP).unwrap();
        assert_eq!(got["pixel"], json!("NEW"));
        // a cap that stops short of every hud row reads as none, never as a stale row past the cap
        assert!(last_row_with_source(&p, "hud", 100_000).is_none());
        assert!(last_row_with_source(&dir.join("absent"), "hud", HEALTH_TAPE_CAP).is_none());
        // a run past HEALTH_LINE_MAX with no newline is dropped, not carried: the read stays linear and a row after it still reads
        let q = dir.join("giant.ndjson");
        let mut g = vec![b'x'; 20 << 20]; g.extend_from_slice(b"\n{\"source\":\"hud\",\"pixel\":\"AFTER\"}\n");
        std::fs::write(&q, &g).unwrap();
        let t0 = std::time::Instant::now();
        assert_eq!(last_row_with_source(&q, "hud", HEALTH_TAPE_CAP).unwrap()["pixel"], json!("AFTER"));
        let z = dir.join("zeros.ndjson"); std::fs::write(&z, vec![0u8; 48 << 20]).unwrap();
        assert!(last_row_with_source(&z, "hud", HEALTH_TAPE_CAP).is_none());
        assert!(t0.elapsed().as_millis() < 3_000, "the bounded read is not linear: {:?}", t0.elapsed());
        let _ = std::fs::remove_dir_all(&dir);
    }

    struct Fake(Rc<StdCell<u64>>);
    impl Clock for Fake { fn now_ms(&self) -> u64 { self.0.get() } }

    fn fixture_heat() -> Value {
        let mut h = vec![0.0f64; 144];
        h[0] = 1.0; h[13] = 0.8; h[26] = 0.5; h[40] = 0.2; h[100] = 0.1;
        json!(h)
    }
    fn server(calls: Rc<StdCell<u32>>) -> Server {
        let mut cfg = HudConfigFile::default();
        cfg.debounce_ms = 400; cfg.top_k = 3;
        let walker: Walker = Box::new(move |_t: &str| { calls.set(calls.get() + 1); Ok(json!({ "heat": fixture_heat(), "pixel": "A,B", "seed_fit": { "better_than_random": true, "gain": 0.4 } })) });
        Server::new(cfg, "x".into(), true, "t".into(), PathBuf::from("."), walker, 0)
    }

    #[test]
    fn the_shortlex_table_is_the_axis_table() {
        for i in 0..144 { assert_eq!(lattice::index_coord(i), crate::ballistic::SHORTLEX[i], "cell {}", i); }
    }

    #[test]
    fn fold_fills_the_nine_tier_intersections_with_heard_words() {
        // H2/H1: nine slots, slot = row tier × 3 + column tier, heat summed by tier pair; each slot's three words are heard in the
        // window (never a lane name), used once per slot; with no library they read UNMEASURED.
        let coords: Vec<String> = (0..144).map(lattice::index_coord).collect();
        let mut targets = vec![String::new(); 144];
        targets[0] = "strategy direction posture capital durable bearing".into();
        targets[13] = "tactics leverage sequence beat speed commitment".into();
        targets[26] = "operations pipeline file code artifact allocation".into();
        let lib = lens::Library { coords, targets };
        let win = "keep the durable posture, pull the leverage this week, and touch crates/io_stream.rs";
        let r = json!({ "seed_fit": { "better_than_random": true, "gain": 0.4 } });
        let cells = fold(&fixture_heat(), &r, 0.25, win, Some(&lib)).unwrap();
        assert_eq!(cells.len(), 9, "all nine tier intersections, every reading");
        for (n, c) in cells.iter().enumerate() {
            assert_eq!(c["slot"], json!(n));
            assert_eq!(c["coord"], json!(lattice::index_coord((n / 3) * 12 + n % 3)), "slot {} is its tier pair", n);
            let w: Vec<&str> = ["strategy", "tactics", "operations"].iter().map(|k| c[*k].as_str().unwrap()).collect();
            for x in &w { assert!(win.contains(x), "{} is not a word of the window", x); assert!(!["Strategy", "Tactics", "Operations"].contains(x)); }
            assert!(w[0] != w[1] && w[1] != w[2] && w[0] != w[2], "a word is used once per cell: {:?}", w);
        }
        // 2026-10-13 the words are ranked by signal: the centre word is the one NCD points at THIS intersection more than the other eight,
        // so the Strategy×Strategy cell (snippet A,A) leads with a strategy word and Tactics×Tactics (B,B) with the tactics word
        // a 12-word window against three 6-word snippets is under the instrument floor for WHICH word (gzip moves a byte); what holds
        // at any size is the shape: three distinct heard words, ranked best first. The content claim is the library test word_signals.
        for c in &cells { let s: Vec<f64> = c["words"].as_array().unwrap().iter().map(|w| w["signal"].as_f64().unwrap()).collect();
            assert_eq!(s.len(), 3); assert!(s.windows(2).all(|p| p[0] >= p[1]) || false, "ranked best first: {:?}", s); }
        let first: Vec<&Value> = ["strategy", "tactics"].iter().map(|k| &cells[0][*k]).collect();
        assert!(!first.contains(&&cells[1]["strategy"]) || !first.contains(&&cells[1]["tactics"]), "slot 2 takes fresh words while the window has them");
        // fixture heat: A,A 1.0 + A1,A2 0.2 → Strategy×Strategy 1.2 (hot) · B,B 0.8 · C,C 0.5 · B3,A2 0.1 → Tactics×Strategy
        assert_eq!(cells[0]["colour"], "green"); assert_eq!(cells[0]["band"], "hot"); assert_eq!(cells[8]["band"], "warm");
        assert!(fold(&json!([1, 2]), &json!({}), 0.25, win, Some(&lib)).is_none());
        let bare = fold(&fixture_heat(), &json!({ "ratchet": { "winner": "lane:law" } }), 0.25, win, None).unwrap();
        assert_eq!(bare.len(), 9); assert_eq!(bare[0]["strategy"], "UNMEASURED"); assert_eq!(bare[0]["lane"], "lane:law"); assert_eq!(bare[0]["colour"], "amber");
    }

    #[test]
    fn the_debounce_walks_on_the_fake_clock_never_out_of_silence() {
        let calls = Rc::new(StdCell::new(0));
        let mut s = server(calls.clone());
        assert!(s.on_tick(10_000).is_empty(), "silence never walks");
        s.on_line(r#"{"op":"text","text":"alpha beta"}"#, 0);
        assert!(s.on_tick(399).is_empty(), "no reading before the debounce");
        s.on_line(r#"{"op":"text","append":"gamma"}"#, 300);   // new text restarts the wait
        assert!(s.on_tick(699).is_empty());
        assert_eq!(calls.get(), 0);
        let out = s.on_tick(700);
        assert_eq!(out.len(), 2); assert_eq!(out[0]["kind"], "reading"); assert_eq!(out[1]["kind"], "grid");
        assert_eq!(out[0]["words"], 3); assert_eq!(out[0]["cells"].as_array().unwrap().len(), 9);   // H2: all nine tier intersections
        // a later tick may move waiting grid cells (2026-10-13: the grid drains on its own timer) but never walks a quiet window twice
        assert!(s.on_tick(5_000).iter().all(|e| e["kind"] == "grid"), "a quiet window is not walked twice"); assert_eq!(calls.get(), 1);
        while let Some(d) = s.due_at() { if d > 5_900 { break; } let _ = s.on_tick(d); }
        s.on_line(r#"{"op":"text","text":"alpha beta gamma"}"#, 6_000);
        let again = s.on_tick(9_000); assert!(again.iter().all(|e| e["kind"] != "reading"), "the same window sha is not walked again: {:?}", again.iter().map(|e| e["kind"].clone()).collect::<Vec<_>>()); assert_eq!(calls.get(), 1);
    }

    #[test]
    fn the_asymmetric_gate_lives_here() {
        let mut s = server(Rc::new(StdCell::new(0)));
        s.on_line(r#"{"op":"text","text":"one two three"}"#, 0);
        s.on_tick(400);
        let v = s.on_line(r#"{"op":"freeze","by":"voice"}"#, 500).0;
        assert_eq!(v[0]["kind"], "refused"); assert!(v[0]["why"].as_str().unwrap().contains("voice-shaped"));
        assert_eq!(s.on_line(r#"{"op":"freeze"}"#, 500).0[0]["kind"], "refused");
        let k = s.on_line(r#"{"op":"freeze","by":"key"}"#, 500).0;
        assert!(k[0]["kind"] == "frozen" || k[0]["kind"] == "refused");
    }

    #[test]
    fn a_bad_line_errors_and_the_loop_goes_on_then_shutdown_ends_it() {
        let calls = Rc::new(StdCell::new(0));
        let mut s = server(calls);
        let now = Rc::new(StdCell::new(0));
        let (tx, rx) = mpsc::channel();
        tx.send(Some("{nope".to_string())).unwrap();
        tx.send(Some(r#"{"op":"config"}"#.to_string())).unwrap();
        tx.send(Some(r#"{"op":"shutdown"}"#.to_string())).unwrap();
        let mut buf: Vec<u8> = vec![];
        let code = serve(rx, &mut buf, &Fake(now), &mut s);
        let lines: Vec<Value> = String::from_utf8(buf).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(code, 0); assert_eq!(lines[0]["kind"], "error"); assert_eq!(lines[1]["kind"], "config"); assert_eq!(lines[1]["debounce_ms"], 400);
    }

    fn run(lines: &[&str], mut s: Server) -> (i32, Vec<Value>) {
        let (tx, rx) = mpsc::channel();
        for l in lines { tx.send(Some(l.to_string())).unwrap(); }
        drop(tx);
        let mut buf: Vec<u8> = vec![];
        let code = serve(rx, &mut buf, &Fake(Rc::new(StdCell::new(0))), &mut s);
        (code, String::from_utf8(buf).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect())
    }

    #[test]
    fn c751_a_bad_line_of_every_shape_is_an_error_event_and_the_next_line_is_served() {
        let bad = ["{nope", "", "   ", "[1,2]", "42", "null", "\"text\"", "{\"op\":7}", "{\"op\":\"nope\"}", "{\"op\":\"text\"}", "{\"op\":\"text\",\"text\":5}", "{\"op\":\"select\",\"n\":\"x\"}", "{\"op\":\"defend\"}"];
        for b in bad {
            let (code, out) = run(&[b, r#"{"op":"config"}"#], server(Rc::new(StdCell::new(0))));
            assert_eq!(code, 0, "{}", b);
            assert_eq!(out.last().unwrap()["kind"], "config", "still serving after {:?}", b);
            assert!(out.iter().filter(|o| o["kind"] == "error").all(|o| o["why"].as_str().map_or(false, |w| !w.is_empty())), "{:?}", b);
        }
        let (_, out) = run(&["{nope"], server(Rc::new(StdCell::new(0))));
        assert_eq!(out[0]["kind"], "error"); assert!(out[0]["why"].as_str().unwrap().starts_with("bad json"));
    }

    #[test]
    fn c751_a_text_event_over_max_chars_is_capped_and_the_reading_says_so() {
        let calls = Rc::new(StdCell::new(0));
        let mut s = server(calls);
        s.cfg.max_chars = 40; s.cfg.window_words = 1000;
        let long = vec!["word"; 100].join(" ");   // 499 chars, over 3 x 40
        s.on_line(&format!(r#"{{"op":"text","text":"{}"}}"#, long), 0);
        assert!(s.window.chars().count() <= 40, "the window is cut to max_chars");
        let out = s.on_tick(400);
        assert_eq!(out[0]["kind"], "reading");
        assert_eq!(out[0]["capped"]["from_chars"], 499); assert_eq!(out[0]["capped"]["to_chars"], 40);
        assert!(out[0]["capped"]["why"].as_str().unwrap().contains("max_chars"));
        s.on_line(r#"{"op":"text","text":"short one"}"#, 500);
        let again = s.on_tick(900);
        assert!(again[0]["capped"].is_null(), "a text event inside the cap says nothing was cut");
    }

    #[test]
    fn c751_a_tripped_walk_budget_is_unmeasured_and_says_which() {
        let mut cfg = HudConfigFile::default(); cfg.debounce_ms = 100;
        let walker: Walker = Box::new(|_t: &str| Ok(json!({ "heat": fixture_heat(), "pixel": "A,B", "time_budget_tripped": true, "seed_fit": { "better_than_random": true, "gain": 0.4 } })));
        let mut s = Server::new(cfg, "x".into(), true, "t".into(), PathBuf::from("."), walker, 0);
        s.budget_ms = Some(250);
        s.on_line(r#"{"op":"text","text":"alpha beta"}"#, 0);
        let out = s.on_tick(100);
        assert_eq!(out[0]["walk"]["ok"], false); assert_eq!(out[0]["walk"]["budget_tripped"], true);
        assert!(out[0]["walk"]["why"].as_str().unwrap().contains("budget_ms 250"));
        assert_eq!(out[0]["cells"][0]["colour"], "UNMEASURED");
        assert_eq!(s.last_walk["sensor"], "unmeasured");
    }

    #[test]
    fn c751_stdin_close_exits_clean_with_and_without_a_pending_window() {
        let (code, out) = run(&[], server(Rc::new(StdCell::new(0))));
        assert_eq!(code, 0); assert!(out.is_empty());
        let (code, out) = run(&[r#"{"op":"text","text":"pending words"}"#], server(Rc::new(StdCell::new(0))));
        assert_eq!(code, 0); assert!(out.is_empty(), "closing stdin never walks the pending window");
        let (tx, rx) = mpsc::channel(); tx.send(None).unwrap();
        let mut s = server(Rc::new(StdCell::new(0))); let mut buf: Vec<u8> = vec![];
        assert_eq!(serve(rx, &mut buf, &Fake(Rc::new(StdCell::new(0))), &mut s), 0);
    }

    #[test]
    fn c751_an_empty_window_never_panics_and_a_freeze_on_it_is_refused_with_its_why() {
        let calls = Rc::new(StdCell::new(0));
        let mut s = server(calls.clone());
        for l in [r#"{"op":"text","text":""}"#, r#"{"op":"text","text":"   \n\t "}"#, r#"{"op":"text","append":""}"#] { s.on_line(l, 0); }
        assert!(s.on_tick(10_000).is_empty()); assert_eq!(calls.get(), 0, "an empty window is never walked");
        let f = s.on_line(r#"{"op":"freeze","by":"key"}"#, 5).0;
        assert_eq!(f[0]["kind"], "refused"); assert!(f[0]["why"].as_str().unwrap().contains("empty"));
        for l in [r#"{"op":"select","n":0,"by":"key"}"#, r#"{"op":"select","n":18446744073709551615,"by":"key"}"#, r#"{"op":"defend","n":3,"sentence":"x"}"#, r#"{"op":"health"}"#] { let _ = s.on_line(l, 6); }
        let mut z = server(calls.clone()); z.cfg.window_words = 0; z.cfg.max_chars = 0; z.cfg.top_k = 0;
        z.on_line(r#"{"op":"text","text":"one two"}"#, 0); assert!(z.on_tick(10_000).is_empty());
    }

    #[test]
    fn c751_a_panic_in_the_walk_is_an_error_event_and_the_server_goes_on() {
        let mut cfg = HudConfigFile::default(); cfg.debounce_ms = 0;
        let walker: Walker = Box::new(|_t: &str| -> Result<Value, String> { panic!("walker blew up") });
        let s = Server::new(cfg, "x".into(), true, "t".into(), PathBuf::from("."), walker, 0);
        let (code, out) = run(&[r#"{"op":"text","text":"alpha"}"#, r#"{"op":"config"}"#], s);
        assert_eq!(code, 0);
        assert!(out.iter().any(|o| o["kind"] == "config"));
    }

    #[test]
    fn iso_is_the_utc_instant() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_760_000_000_123), "2025-10-09T08:53:20.123Z");
    }
}
