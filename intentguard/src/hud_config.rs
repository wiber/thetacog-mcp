// src/hud_config.rs — C746 THE ONE HUD CONFIG: data/vna/hud-config.json is the single place every HUD variable lives.
//
// Each key in the file is {value, source}; the source names the measurement that set the number, or says UNMEASURED.
// This loader fills `HudConfig` (the grid struct of hud_grid.rs, via `grid()`) plus the server fields (window, debounce, caps,
// walk source, sources, snowball ledger). Defaults are the same numbers the js carried; a missing or unreadable file reads
// the defaults and says so in `why`. Parsing goes through serde_json::Value by hand so a bare number or {value,source} both read.
// C769: moved to the shared library crate. The defaults and `from_value` are portable (no fs); the file read, the path
// search and the `--hud-config` printer need an fs and a cwd, so they sit behind cfg(not(portable_walker)).
// Grip prose: a value is a placement in the file, re-runnable from the commit.
#![allow(dead_code)]

use crate::hud_grid;
use serde_json::{json, Value};
#[cfg(not(portable_walker))]
use std::path::{Path, PathBuf};

pub const CONFIG_REL: &str = "data/vna/hud-config.json";

#[derive(Clone, Debug, PartialEq)]
pub struct Source {
    pub name: String,
    pub device: Option<String>,
    pub mark: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HudConfigFile {
    pub grid: hud_grid::HudConfig,
    pub window_words: usize,
    pub debounce_ms: u64,
    pub max_chars: usize,
    pub top_k: usize,
    pub walk_source: String,
    pub hud_snowballs: String,
    pub sources: Vec<Source>,
    /// C759 H13 (operator 2026-10-12): "there's never more than four of them at once" · "they should fade away slowly"
    pub worm_max_live: usize,
    pub worm_decay_ms: u64,
    pub worm_floor: f64,
    /// operator 2026-10-15 ("make sure this runs on all context we have available, transcripts too"): the context pool the cell words
    /// are drawn from beside the window, its byte cap and the distinct pool words scored per reading
    pub context_chars: usize,
    pub context_words: usize,
}

impl Default for HudConfigFile {
    fn default() -> Self {
        HudConfigFile {
            grid: hud_grid::HudConfig::default(),
            window_words: 60,
            debounce_ms: 400,
            max_chars: 800,
            top_k: 9,
            walk_source: "hud".into(),
            hud_snowballs: ".thetacog/hud-snowballs.ndjson".into(),
            worm_max_live: 4,
            worm_decay_ms: 60_000,
            worm_floor: 0.25,
            context_chars: 24_000,
            context_words: 400,
            sources: vec![
                Source { name: "external".into(), device: Some(":default".into()), mark: "🎙️".into() },
                Source { name: "internal".into(), device: None, mark: "🔈".into() },
            ],
        }
    }
}

impl HudConfigFile {
    /// The grid struct hud_grid.rs consumes.
    pub fn grid(&self) -> hud_grid::HudConfig {
        self.grid.clone()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "dwell_ms": self.grid.dwell_ms, "transitions_per_s": self.grid.transitions_per_s,
            "fade_in_ms": self.grid.fade_in_ms, "fade_out_ms": self.grid.fade_out_ms,
            "pill_words": self.grid.pill_words, "pill_chars": self.grid.pill_chars,
            "ncd_green": self.grid.ncd_green, "tie_band": self.grid.tie_band, "slots": self.grid.slots,
            "window_words": self.window_words, "debounce_ms": self.debounce_ms, "max_chars": self.max_chars,
            "top_k": self.top_k, "walk_source": self.walk_source, "hud_snowballs": self.hud_snowballs,
            "worm_max_live": self.worm_max_live, "worm_decay_ms": self.worm_decay_ms, "worm_floor": self.worm_floor, "context_chars": self.context_chars, "context_words": self.context_words,
            "sources": self.sources.iter().map(|s| json!({"name": s.name, "device": s.device, "mark": s.mark})).collect::<Vec<_>>(),
        })
    }
}

/// `{value, source}` or a bare value: both read.
fn val<'a>(root: &'a Value, key: &str) -> Option<&'a Value> {
    let v = root.get(key)?;
    match v.get("value") {
        Some(inner) if v.is_object() => Some(inner),
        _ => Some(v),
    }
}

/// Fill a config from a parsed document; a key that is absent keeps its default.
pub fn from_value(root: &Value) -> HudConfigFile {
    let mut c = HudConfigFile::default();
    let u = |k: &str| val(root, k).and_then(|v| v.as_u64());
    if let Some(x) = u("dwell_ms") { c.grid.dwell_ms = x; }
    if let Some(x) = u("transitions_per_s") { c.grid.transitions_per_s = x as u32; }
    if let Some(x) = u("fade_in_ms") { c.grid.fade_in_ms = x; }
    if let Some(x) = u("fade_out_ms") { c.grid.fade_out_ms = x; }
    if let Some(x) = u("pill_words") { c.grid.pill_words = x as usize; }
    if let Some(x) = u("pill_chars") { c.grid.pill_chars = x as usize; }
    if let Some(x) = u("slots") { c.grid.slots = x as usize; }
    if let Some(x) = val(root, "ncd_green").and_then(|v| v.as_f64()) { c.grid.ncd_green = x; }
    if let Some(x) = val(root, "tie_band").and_then(|v| v.as_f64()) { c.grid.tie_band = x; }
    if let Some(x) = u("window_words") { c.window_words = x as usize; }
    if let Some(x) = u("debounce_ms") { c.debounce_ms = x; }
    if let Some(x) = u("max_chars") { c.max_chars = x as usize; }
    if let Some(x) = u("top_k") { c.top_k = x as usize; }
    if let Some(x) = u("worm_max_live") { c.worm_max_live = x as usize; }
    if let Some(x) = u("worm_decay_ms") { c.worm_decay_ms = x; }
    if let Some(x) = val(root, "worm_floor").and_then(|v| v.as_f64()) { c.worm_floor = x; }
    if let Some(x) = u("context_chars") { c.context_chars = x as usize; }
    if let Some(x) = u("context_words") { c.context_words = x as usize; }
    if let Some(x) = val(root, "walk_source").and_then(|v| v.as_str()) { c.walk_source = x.to_string(); }
    if let Some(x) = val(root, "hud_snowballs").and_then(|v| v.as_str()) { c.hud_snowballs = x.to_string(); }
    if let Some(arr) = val(root, "sources").and_then(|v| v.as_array()) {
        c.sources = arr.iter().filter_map(|s| {
            Some(Source {
                name: s.get("name")?.as_str()?.to_string(),
                device: s.get("device").and_then(|d| d.as_str()).map(|d| d.to_string()),
                mark: s.get("mark").and_then(|m| m.as_str()).unwrap_or("").to_string(),
            })
        }).collect();
    }
    c
}

#[cfg(not(portable_walker))]
/// Where the file is looked for: explicit path, else HUD_CONFIG_PATH, else data/vna/hud-config.json up from the cwd.
pub fn resolve_path(explicit: Option<&str>) -> PathBuf {
    if let Some(p) = explicit { return PathBuf::from(p); }
    if let Ok(p) = std::env::var("HUD_CONFIG_PATH") { if !p.is_empty() { return PathBuf::from(p); } }
    let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    loop {
        let cand = dir.join(CONFIG_REL);
        if cand.exists() { return cand; }
        if !dir.pop() { break; }
    }
    PathBuf::from(CONFIG_REL)
}

#[cfg(not(portable_walker))]
/// Returns (config, loaded, why). A missing file reads the defaults and says so.
pub fn load(path: &Path) -> (HudConfigFile, bool, String) {
    match std::fs::read_to_string(path) {
        Err(e) => (HudConfigFile::default(), false, format!("no config file ({}): reading the defaults", e)),
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Err(e) => (HudConfigFile::default(), false, format!("config file does not parse ({}): reading the defaults", e)),
            Ok(v) => (from_value(&v), true, "read from file".to_string()),
        },
    }
}

#[cfg(not(portable_walker))]
/// `pmu-onchip --hud-config [--json] [--path <file>]`
pub fn run(args: &[String]) {
    let explicit = args.iter().position(|a| a == "--path").and_then(|i| args.get(i + 1)).map(|s| s.as_str());
    let path = resolve_path(explicit);
    let (cfg, loaded, why) = load(&path);
    let mut out = cfg.to_json();
    out["config_path"] = json!(path.to_string_lossy());
    out["loaded"] = json!(loaded);
    out["why"] = json!(why);
    if args.iter().any(|a| a == "--json") {
        println!("{}", out);
    } else {
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hud_config_defaults_are_the_grid_defaults() {
        let c = HudConfigFile::default();
        assert_eq!(c.grid(), hud_grid::HudConfig::default());
        assert_eq!((c.window_words, c.debounce_ms, c.top_k), (60, 400, 9));
    }

    #[test]
    fn hud_config_reads_value_source_and_bare() {
        let c = from_value(&json!({"dwell_ms": {"value": 1234, "source": "x"}, "fade_in_ms": 7, "sources": {"value": [{"name": "a", "device": null, "mark": "m"}]}}));
        assert_eq!(c.grid.dwell_ms, 1234);
        assert_eq!(c.grid.fade_in_ms, 7);
        assert_eq!(c.sources.len(), 1);
        assert_eq!(c.grid.fade_out_ms, 500);
    }

    #[cfg(not(portable_walker))]
    #[test]
    fn hud_config_missing_file_says_so() {
        let (c, loaded, why) = load(Path::new("/nonexistent/hud-config.json"));
        assert!(!loaded);
        assert!(why.contains("defaults"));
        assert_eq!(c, HudConfigFile::default());
    }
}
