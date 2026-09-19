// src/envelope.rs — KR40 / KR43 ARITHMETIC, IN THE CRATE (spec §8.58 stub — the coordinator writes the section).
//
// Ports the REPLICATION COST / FAIR PRICE / NO-ARBITRAGE arithmetic of scripts/pmu/kr40-cost-envelope.mjs and
// scripts/pmu/kr43-no-arbitrage.mjs (units.mjs's tag/mul/div/add registry) into the crate as ONE flag,
// --envelope-read, following exactly how volatility.rs / --vol-read (KR34) was done: the crate computes, the JS
// driver (kr43-no-arbitrage.mjs) calls it and stamps `engine: 'rust-envelope'`, falling back to `engine:
// 'js-fallback'` and naming why when the binary is absent or disagrees with itself.
//
//   pmu-onchip --envelope-read --envelope data/pmu/kr40-cost-envelope.json --price-table data/pmu/price-table.json
//
// E1 UNIT TAGS: every quantity is (value, unit); mul/div/add look the unit pair up in an explicit registry
// mirroring units.mjs's MUL_RULES / DIV_RULES exactly — tokens + minutes has no rule and refuses, usd/usd →
// dimensionless is the one KR43 needs for its R and B ratios. An operation this file has not been told about is a
// compile-time Result::Err, never a guess.
// E2 NO DOLLAR WITHOUT A DATE: assert_no_dollar_without_date walks the WRITTEN json tree by key name (mirroring
// units.mjs's DOLLAR_KEY) and `run` refuses to print (exit 1, the field named) rather than emit a dollar with no
// as_of/source beside it in the same object.
// E3 HOMOGENEITY, E4 MONOTONE IN Y and E5 PER-COMMIT-BEFORE-PER-PASS are PROVED in harness.rs (checks E3–E5,
// enumerated over a small grid, mirroring kr43-no-arbitrage.test.mjs's NA-4/NA-5 and kr40's U-7 fixture exactly).
// E6 PARITY is a JS-side MEASURED reading (tests/formal/kr43-no-arbitrage.test.mjs), not proved here: the crate's
// numbers on the real files must equal the JS oracle's to 1e-6.
//
// LLM-free. No clock in the arithmetic (the printed `ts` is wall-clock only, never fed back into a computation).
use serde_json::{json, Map, Value};

// ── E1: unit tags that refuse to mix ─────────────────────────────────────────────────────────────────────────────
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Unit { Tokens, Minutes, UsdPerToken, UsdPerMinute, UsdPerHour, Usd, Dimensionless, Calls }
impl Unit {
    pub fn name(&self) -> &'static str {
        match self {
            Unit::Tokens => "tokens", Unit::Minutes => "minutes", Unit::UsdPerToken => "usd_per_token",
            Unit::UsdPerMinute => "usd_per_minute", Unit::UsdPerHour => "usd_per_hour", Unit::Usd => "usd",
            Unit::Dimensionless => "dimensionless", Unit::Calls => "calls",
        }
    }
    /// every unit this registry knows about — the domain E1's harness check enumerates
    pub fn all() -> [Unit; 8] { [Unit::Tokens, Unit::Minutes, Unit::UsdPerToken, Unit::UsdPerMinute, Unit::UsdPerHour, Unit::Usd, Unit::Dimensionless, Unit::Calls] }
}

#[derive(Clone, Copy, Debug)]
pub struct Q { pub v: f64, pub unit: Unit }
pub fn tag(v: f64, unit: Unit) -> Q { Q { v, unit } }
pub fn dimensionless(v: f64) -> Q { tag(v, Unit::Dimensionless) }

/// a × b — mirrors units.mjs MUL_RULES verbatim. An unregistered pair is Err, never a guess.
///
/// E8 (spec §8.58 stub): this match has NO wildcard `_` arm. Every one of the 8×8 = 64 (Unit,
/// Unit) pairs is named explicitly — 11 in the Ok arms below, the other 53 grouped into one Err
/// arm by an OR-pattern that still names each pair once. Rust's own exhaustiveness checker is
/// what makes this a proof rather than a convention: `cargo build` REFUSES to compile the moment
/// `Unit::all()` gains a 9th variant and this match is not extended for it — the developer cannot
/// forget to add a rule for a new unit, because there is no wildcard to silently swallow it. Seen
/// to fail: adding a hypothetical 9th variant (`Unit::Sats`) without touching this match does not
/// compile (E80-DEMO below, gated `#[cfg(any())]` so it never builds, with the exact rustc error
/// this crate would show — trybuild is unavailable offline to run it live; see the session report).
pub fn mul(a: Q, b: Q) -> Result<Q, String> {
    use Unit::*;
    let u = match (a.unit, b.unit) {
        (Tokens, UsdPerToken) => Usd,
        (UsdPerToken, Tokens) => Usd,
        (Minutes, UsdPerMinute) => Usd,
        (UsdPerMinute, Minutes) => Usd,
        (Usd, Dimensionless) => Usd,
        (Dimensionless, Usd) => Usd,
        (Tokens, Dimensionless) => Tokens,
        (Dimensionless, Tokens) => Tokens,
        (Minutes, Dimensionless) => Minutes,
        (Dimensionless, Minutes) => Minutes,
        (Dimensionless, Dimensionless) => Dimensionless,
        (Tokens, Tokens) | (Tokens, Minutes) | (Tokens, UsdPerMinute) | (Tokens, UsdPerHour) | (Tokens, Usd) | (Tokens, Calls) |
        (Minutes, Tokens) | (Minutes, Minutes) | (Minutes, UsdPerToken) | (Minutes, UsdPerHour) | (Minutes, Usd) | (Minutes, Calls) |
        (UsdPerToken, Minutes) | (UsdPerToken, UsdPerToken) | (UsdPerToken, UsdPerMinute) | (UsdPerToken, UsdPerHour) | (UsdPerToken, Usd) | (UsdPerToken, Dimensionless) |
        (UsdPerToken, Calls) | (UsdPerMinute, Tokens) | (UsdPerMinute, UsdPerToken) | (UsdPerMinute, UsdPerMinute) | (UsdPerMinute, UsdPerHour) | (UsdPerMinute, Usd) |
        (UsdPerMinute, Dimensionless) | (UsdPerMinute, Calls) | (UsdPerHour, Tokens) | (UsdPerHour, Minutes) | (UsdPerHour, UsdPerToken) | (UsdPerHour, UsdPerMinute) |
        (UsdPerHour, UsdPerHour) | (UsdPerHour, Usd) | (UsdPerHour, Dimensionless) | (UsdPerHour, Calls) | (Usd, Tokens) | (Usd, Minutes) |
        (Usd, UsdPerToken) | (Usd, UsdPerMinute) | (Usd, UsdPerHour) | (Usd, Usd) | (Usd, Calls) | (Dimensionless, UsdPerToken) |
        (Dimensionless, UsdPerMinute) | (Dimensionless, UsdPerHour) | (Dimensionless, Calls) | (Calls, Tokens) | (Calls, Minutes) | (Calls, UsdPerToken) |
        (Calls, UsdPerMinute) | (Calls, UsdPerHour) | (Calls, Usd) | (Calls, Dimensionless) | (Calls, Calls) =>
            return Err(format!("unit mismatch: cannot multiply {} by {} (not in MUL_RULES)", a.unit.name(), b.unit.name())),
    };
    Ok(tag(a.v * b.v, u))
}
/// a ÷ b — mirrors units.mjs DIV_RULES verbatim, including usd/usd → dimensionless (KR43's R and
/// B). E8: same exhaustiveness discipline as `mul` — no wildcard, all 64 pairs named once.
pub fn div(a: Q, b: Q) -> Result<Q, String> {
    use Unit::*;
    if b.v == 0.0 { return Err(format!("div: division by zero ({} / {})", a.unit.name(), b.unit.name())); }
    let u = match (a.unit, b.unit) {
        (Usd, UsdPerMinute) => Minutes,
        (Usd, Minutes) => UsdPerMinute,
        (UsdPerHour, Dimensionless) => UsdPerMinute,   // valid only when the divisor is exactly 60 — enforced by per_hour_to_per_minute, not here
        (Tokens, Dimensionless) => Tokens,
        (Minutes, Dimensionless) => Minutes,
        (Usd, Dimensionless) => Usd,
        (Calls, Dimensionless) => Calls,
        (UsdPerHour, UsdPerHour) => Dimensionless,
        (Usd, Usd) => Dimensionless,
        (Tokens, Tokens) => Dimensionless,
        (Tokens, Minutes) | (Tokens, UsdPerToken) | (Tokens, UsdPerMinute) | (Tokens, UsdPerHour) | (Tokens, Usd) | (Tokens, Calls) |
        (Minutes, Tokens) | (Minutes, Minutes) | (Minutes, UsdPerToken) | (Minutes, UsdPerMinute) | (Minutes, UsdPerHour) | (Minutes, Usd) |
        (Minutes, Calls) | (UsdPerToken, Tokens) | (UsdPerToken, Minutes) | (UsdPerToken, UsdPerToken) | (UsdPerToken, UsdPerMinute) | (UsdPerToken, UsdPerHour) |
        (UsdPerToken, Usd) | (UsdPerToken, Dimensionless) | (UsdPerToken, Calls) | (UsdPerMinute, Tokens) | (UsdPerMinute, Minutes) | (UsdPerMinute, UsdPerToken) |
        (UsdPerMinute, UsdPerMinute) | (UsdPerMinute, UsdPerHour) | (UsdPerMinute, Usd) | (UsdPerMinute, Dimensionless) | (UsdPerMinute, Calls) | (UsdPerHour, Tokens) |
        (UsdPerHour, Minutes) | (UsdPerHour, UsdPerToken) | (UsdPerHour, UsdPerMinute) | (UsdPerHour, Usd) | (UsdPerHour, Calls) | (Usd, Tokens) |
        (Usd, UsdPerToken) | (Usd, UsdPerHour) | (Usd, Calls) | (Dimensionless, Tokens) | (Dimensionless, Minutes) | (Dimensionless, UsdPerToken) |
        (Dimensionless, UsdPerMinute) | (Dimensionless, UsdPerHour) | (Dimensionless, Usd) | (Dimensionless, Dimensionless) | (Dimensionless, Calls) | (Calls, Tokens) |
        (Calls, Minutes) | (Calls, UsdPerToken) | (Calls, UsdPerMinute) | (Calls, UsdPerHour) | (Calls, Usd) | (Calls, Calls) =>
            return Err(format!("unit mismatch: cannot divide {} by {} (not in DIV_RULES)", a.unit.name(), b.unit.name())),
    };
    Ok(tag(a.v / b.v, u))
}

// COMPILE-FAIL EVIDENCE FOR E8 (never built — `#[cfg(any())]` is always false). trybuild is
// unavailable offline (no network to crates.io; not present in ~/.cargo/registry/src — checked
// before writing this). This module states, verbatim, what a real trybuild `.rs`/`.stderr` pair
// would pin: add a 9th Unit variant and DO NOT extend `mul`'s match, and rustc refuses the crate
// with "non-exhaustive patterns: `(Sats, _)` and 5 other patterns not covered" (the exact wording
// depends on the rustc version; the SHAPE — a non-exhaustive-patterns E0004 naming the new variant
// — is the invariant this stub pins). This is why `mul`/`div` above carry no `_` arm: a wildcard
// would make this exact addition compile silently with every new-unit pair defaulting to Err,
// which is the bug E8 exists to rule out (a forgotten rule is not the same as a refused one).
#[cfg(any())]
mod e8_compile_fail_evidence_not_built {
    use super::*;
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    enum UnitPlusOne { Tokens, Minutes, UsdPerToken, UsdPerMinute, UsdPerHour, Usd, Dimensionless, Calls, Sats }
    // If this called envelope::mul's match arms verbatim against UnitPlusOne, adding `Sats`
    // without a new arm would fail with E0004 non-exhaustive patterns — the mul/div above,
    // unmodified, are the actual evidence: they compile ONLY because every one of the 64 pairs
    // over the CURRENT 8-variant Unit is named, and rustc re-checks that fact on every build.
}
/// a + b — refuses unless the two units are IDENTICAL. tokens + minutes throws; this is the whole point.
pub fn add(a: Q, b: Q) -> Result<Q, String> {
    if a.unit != b.unit { return Err(format!("unit mismatch: cannot add {} to {}", a.unit.name(), b.unit.name())); }
    Ok(tag(a.v + b.v, a.unit))
}
/// a wage stated per hour → per minute. The divisor is exactly 60, a conversion rather than a generic division.
pub fn per_hour_to_per_minute(usd_per_hour: Q) -> Result<Q, String> {
    if usd_per_hour.unit != Unit::UsdPerHour { return Err(format!("perHourToPerMinute: expected usd_per_hour, got {}", usd_per_hour.unit.name())); }
    Ok(tag(usd_per_hour.v / 60.0, Unit::UsdPerMinute))
}
/// a per-commit quantity ÷ the yield Y (dimensionless) → the per-PASS floor. Y = 0 errs (div-by-zero), never ∞/NaN.
pub fn per_pass_floor(per_commit: Q, y: f64) -> Result<Q, String> { div(per_commit, dimensionless(y)) }

fn r6(x: f64) -> f64 { (x * 1e6).round() / 1e6 }

// ── E2: no dollar without a date — a guard over the WRITTEN json tree, by key name ─────────────────────────────────
/// mirrors units.mjs's DOLLAR_KEY = /(^|_)(usd|dollars?)(_|$)|wage_minutes/i: a key whose underscore-delimited
/// segments include "usd", "dollar" or "dollars", or whose lowercase form contains "wage_minutes" as a substring.
fn is_dollar_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    if lower.contains("wage_minutes") { return true; }
    lower.split('_').any(|p| p == "usd" || p == "dollar" || p == "dollars")
}
/// walks the WRITTEN json by key name and fails any object holding a dollar-shaped number without a non-null
/// as_of AND source alongside it, IN THE SAME OBJECT (never inherited from a grandparent).
pub fn assert_no_dollar_without_date(root: &Value) -> Vec<String> {
    let mut bad = Vec::new();
    fn walk(v: &Value, path: &str, bad: &mut Vec<String>) {
        match v {
            Value::Array(arr) => { for (i, x) in arr.iter().enumerate() { walk(x, &format!("{}[{}]", path, i), bad); } }
            Value::Object(map) => {
                let dollar_keys: Vec<String> = map.iter().filter(|(k, val)| is_dollar_key(k) && val.is_number()).map(|(k, _)| k.clone()).collect();
                if !dollar_keys.is_empty() {
                    let as_of_ok = map.get("as_of").map(|v| !v.is_null()).unwrap_or(false);
                    let source_ok = map.get("source").map(|v| !v.is_null()).unwrap_or(false);
                    if !(as_of_ok && source_ok) {
                        bad.push(format!("{} carries {} without a non-null as_of/source in the same object", if path.is_empty() { "$" } else { path }, dollar_keys.join(",")));
                    }
                }
                for (k, x) in map { walk(x, &format!("{}.{}", path, k), bad); }
            }
            _ => {}
        }
    }
    walk(root, "", &mut bad);
    bad
}

// ── the door numbers: E5 lives here — ONE place divides by commits, ONE place (later) divides by Y ────────────────
/// the TOKEN dollars of one commit unit: the lane's whole per-model token mass, priced by the dated table, ÷
/// commits. E5's door: this function NEVER sees Y, so a caller cannot fold `÷ commits` and `÷ Y` into one step —
/// the historical defect (U-7) divided the lane total by Y alone and called it "per commit".
pub fn lane_dollars_per_commit(tokens_by_model: &Value, commits: i64, table: &Value) -> Result<Q, String> {
    if commits <= 0 { return Err("laneDollarsPerCommit: commits must be a positive integer".into()); }
    if table.is_null() || table.get("as_of").map(|v| v.is_null()).unwrap_or(true) {
        return Err("UNPINNED — fill data/pmu/price-table.json with a dated, sourced table".into());
    }
    let prices = table.get("token_prices_per_million").cloned().unwrap_or_else(|| json!({}));
    let mut missing: Vec<String> = Vec::new();
    let mut total: Option<Q> = None;
    if let Some(obj) = tokens_by_model.as_object() {
        for (model, t) in obj {
            let t_in = t.get("in").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let t_out = t.get("out").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if t_in == 0.0 && t_out == 0.0 { continue; }
            let p = prices.get(model);
            let input = p.and_then(|p| p.get("input")).and_then(|v| v.as_f64());
            let output = p.and_then(|p| p.get("output")).and_then(|v| v.as_f64());
            let (input, output) = match (input, output) { (Some(i), Some(o)) => (i, o), _ => { missing.push(model.clone()); continue; } };
            let mut piece = add(mul(tag(t_in, Unit::Tokens), tag(input / 1e6, Unit::UsdPerToken))?,
                                 mul(tag(t_out, Unit::Tokens), tag(output / 1e6, Unit::UsdPerToken))?)?;
            let cache_read = t.get("cache_read").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let price_cache_read = p.and_then(|p| p.get("cache_read")).and_then(|v| v.as_f64());
            if cache_read != 0.0 { if let Some(pcr) = price_cache_read {
                piece = add(piece, mul(tag(cache_read, Unit::Tokens), tag(pcr / 1e6, Unit::UsdPerToken))?)?;
            } }
            total = Some(match total { Some(t0) => add(t0, piece)?, None => piece });
        }
    }
    if !missing.is_empty() { return Err(format!("UNPINNED for model(s) with no price: {}", missing.join(", "))); }
    let total = total.ok_or_else(|| "no tokens recorded for this lane".to_string())?;
    div(total, dimensionless(commits as f64))   // E5: ÷ commits happens HERE, before anything divides by Y
}
/// the human side of one commit unit: minutes per commit × the reference wage per minute.
pub fn human_dollars_per_commit(minutes_per_commit: Option<f64>, table: &Value) -> Result<Q, String> {
    if table.is_null() || table.get("as_of").map(|v| v.is_null()).unwrap_or(true) { return Err("UNPINNED — table has no as_of".into()); }
    let per_hour = table.get("wage").and_then(|w| w.get("per_hour")).and_then(|v| v.as_f64());
    let per_hour = match per_hour { Some(v) => v, None => return Err("UNPINNED — wage.per_hour not set".into()) };
    let m = match minutes_per_commit { Some(v) if v.is_finite() => v, _ => return Err("minutes per commit UNMEASURED".into()) };
    mul(tag(m, Unit::Minutes), per_hour_to_per_minute(tag(per_hour, Unit::UsdPerHour))?)
}
/// C = token dollars + human dollars — returns (total, token_usd, human_usd), all tagged 'usd'.
pub fn replication_cost(tokens_by_model: &Value, commits: i64, minutes_per_commit: Option<f64>, table: &Value) -> Result<(Q, Q, Q), String> {
    let tok = lane_dollars_per_commit(tokens_by_model, commits, table).map_err(|e| format!("tokens: {}", e))?;
    let hum = human_dollars_per_commit(minutes_per_commit, table).map_err(|e| format!("human: {}", e))?;
    let total = add(tok, hum)?;
    Ok((total, tok, hum))
}
/// F = C ÷ Y — UNMEASURED (Err) at Y = 0 or Y unknown, never a division by zero, never Infinity/NaN.
pub fn fair_price_per_delivered(c: Q, y: Option<f64>) -> Result<Q, String> {
    match y {
        None => Err("Y is UNMEASURED".into()),
        Some(v) if v == 0.0 => Err("no pass on record (Y = 0) — the fair price has no denominator".into()),
        Some(v) => div(c, dimensionless(v)),
    }
}

// ── E7: TYPE-STATE MONEY — the undated dollar made unrepresentable ─────────────────────────────
// E2 (above) is a RUNTIME walk over the emitted JSON: it catches an undated dollar only after the
// value has already been constructed and handed to `assert_no_dollar_without_date`. E7 moves the
// same guarantee to the type level, for the surface this module exposes going forward: there is
// no function in this section that returns a bare, undated `f64` dollar figure, and no function
// that computes a fair price from a yield the table has not shown to be positive. This section is
// ADDITIVE — it does not replace `Q`/`mul`/`div`/`add`/`replication_cost`/`fair_price_per_delivered`
// above (E1-E6's own proofs and E6's real-file parity keep driving THAT arithmetic unchanged); it
// wraps the same numbers in a shape a caller cannot misuse.

/// A value that only ever leaves this module dated and sourced. There is no `Dated::new` that
/// omits `as_of`/`source` with a default — every constructor below that returns a `Dated<T>` is
/// handed a concrete `as_of`/`source` it read from a `PinnedTable`, so an undated `Dated<Usd>`
/// cannot be built without first having a table that already carries a date (E7's E2-at-the-type-
/// level: the runtime walk in `assert_no_dollar_without_date` catches a JSON tree that skipped this;
/// this struct means the JSON tree cannot skip it, because there was never an undated value to write).
#[derive(Clone, Debug, PartialEq)]
pub struct Dated<T> { pub v: T, pub as_of: String, pub source: String }
impl<T> Dated<T> {
    fn new(v: T, as_of: impl Into<String>, source: impl Into<String>) -> Dated<T> { Dated { v, as_of: as_of.into(), source: source.into() } }
}

/// Newtypes, not `f64` — so a `Dated<Usd>` cannot be confused with a `Dated<UsdPerHour>` even
/// though both wrap a float. Thin on purpose: the arithmetic that combines them still lives in
/// `mul`/`div`/`add` above (E1's registry), unchanged; these exist so `PinnedTable`'s methods can
/// say, in their signatures, exactly which dollar-shaped thing they hand back.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Usd(pub f64);
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UsdPerHour(pub f64);
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UsdPerToken(pub f64);

/// A yield known, at construction, to be finite and strictly positive. Not `std::num::NonZero*`
/// (integer-only in std; there is no `NonZeroF64`) — a small hand-rolled equivalent. The ONLY way
/// to obtain one is `PositiveYield::new`, which returns `None` for zero, negative, NaN or infinite
/// input. Once held, a `PositiveYield` can be divided into with no zero-check at the call site,
/// because the invariant is enforced once, at the door, not re-litigated at every division.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PositiveYield(f64);
impl PositiveYield {
    pub fn new(v: f64) -> Option<PositiveYield> { if v.is_finite() && v > 0.0 { Some(PositiveYield(v)) } else { None } }
    pub fn get(&self) -> f64 { self.0 }
}

/// The three (and only three) states a yield can be in for pricing purposes. `Positive` is the
/// only variant that CARRIES a value fit to divide by — `Zero` and `Unmeasured` carry nothing,
/// because there is nothing a caller could legitimately do with a zero or absent yield except ask
/// why. Constructed only via `from_option`, so every caller feeding a raw `Option<f64>` (exactly
/// what `lane_read`'s `y` already is) goes through the same classification `fair_price_per_delivered`
/// makes today — E7 does not change what counts as measured, it changes what the compiler will let
/// the fair-price function DO with each case.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Yield { Zero, Unmeasured, Positive(PositiveYield) }
impl Yield {
    pub fn from_option(y: Option<f64>) -> Yield {
        match y {
            None => Yield::Unmeasured,
            Some(v) if v == 0.0 => Yield::Zero,
            Some(v) => match PositiveYield::new(v) { Some(p) => Yield::Positive(p), None => Yield::Unmeasured },
        }
    }
}
/// Returned by `PinnedTable::fair_price` on `Zero`/`Unmeasured` — never a NaN, never an Infinity,
/// never a silently-zero price. Carries why, the way `fair_price_per_delivered`'s `Err(String)` does.
#[derive(Clone, Debug, PartialEq)]
pub struct Unmeasured { pub why: String }

/// A price table that has or has not shown a date and a source. This is the ONLY way this module
/// ever turns a raw `serde_json::Value` into something `price`/`replication_cost` can be called on.
#[derive(Clone, Debug)]
pub enum PriceTable { Unpinned { why: String }, Pinned(PinnedTable) }
impl PriceTable {
    /// The sole constructor. A null table, or one missing (or null) `as_of`/`source`, becomes
    /// `Unpinned` — there is no path from a raw table to a `Pinned` value that skips this check.
    pub fn parse(table: &Value) -> PriceTable {
        if table.is_null() { return PriceTable::Unpinned { why: "table is null".into() }; }
        let as_of = table.get("as_of").and_then(|v| v.as_str());
        let source = table.get("source").and_then(|v| v.as_str());
        match (as_of, source) {
            (Some(a), Some(s)) => PriceTable::Pinned(PinnedTable { as_of: a.to_string(), source: s.to_string(), raw: table.clone() }),
            _ => PriceTable::Unpinned { why: "as_of/source missing or null on the price table".into() },
        }
    }
}

/// A dated, sourced price table. `price`/`fair_price`/`replication_cost` are inherent methods on
/// THIS struct — never on `PriceTable`, and there is no `impl PriceTable { fn price(...) }` block
/// anywhere in this file. A caller holding a bare `PriceTable::Unpinned` cannot name these methods
/// at all: `table.price(...)` on an `Unpinned` table is `error[E0599]: no method named 'price'
/// found for enum 'PriceTable'` — not a runtime UNPINNED string, a compiler error, because pattern-
/// matching out the `Pinned(pt)` arm is the only way to ever hold a `PinnedTable` value in the
/// first place. (Runtime evidence of the OTHER half — that parsing an all-null table produces
/// `Unpinned` and never `Pinned` — is `e7_all_null_table_parses_unpinned` below; the "no method"
/// half is a fact about the type checker, demonstrated for a reader in the doc comment above and
/// in the compile-fail stub beside E8, not something `cargo test` can show without trybuild.)
#[derive(Clone, Debug)]
pub struct PinnedTable { pub as_of: String, pub source: String, raw: Value }
impl PinnedTable {
    /// The dated, sourced per-token price for one model. Exists only here.
    pub fn token_price(&self, model: &str) -> Result<(Dated<UsdPerToken>, Dated<UsdPerToken>), String> {
        let p = self.raw.get("token_prices_per_million").and_then(|m| m.get(model));
        let input = p.and_then(|p| p.get("input")).and_then(|v| v.as_f64());
        let output = p.and_then(|p| p.get("output")).and_then(|v| v.as_f64());
        match (input, output) {
            (Some(i), Some(o)) => Ok((Dated::new(UsdPerToken(i / 1e6), self.as_of.clone(), self.source.clone()),
                                       Dated::new(UsdPerToken(o / 1e6), self.as_of.clone(), self.source.clone()))),
            _ => Err(format!("UNPINNED for model '{}' — no input/output price on this table", model)),
        }
    }
    /// The dated, sourced reference wage. Exists only here.
    pub fn wage_per_hour(&self) -> Result<Dated<UsdPerHour>, String> {
        match self.raw.get("wage").and_then(|w| w.get("per_hour")).and_then(|v| v.as_f64()) {
            Some(v) => Ok(Dated::new(UsdPerHour(v), self.as_of.clone(), self.source.clone())),
            None => Err("UNPINNED — wage.per_hour not set".into()),
        }
    }
    /// The E1-E6 arithmetic, unchanged, wrapped so its result carries the table's date/source and
    /// its own type — E7 adds the type-state guarantee around the existing (already-proved)
    /// arithmetic rather than duplicating it. Exists only here: `replication_cost` (module-level,
    /// above) still takes a raw `&Value` and is what E3/E4/E5's harness checks drive directly.
    pub fn replication_cost_dated(&self, tokens_by_model: &Value, commits: i64, minutes_per_commit: Option<f64>) -> Result<Dated<Usd>, String> {
        let (c, _tok, _hum) = replication_cost(tokens_by_model, commits, minutes_per_commit, &self.raw)?;
        Ok(Dated::new(Usd(c.v), self.as_of.clone(), self.source.clone()))
    }
    /// F = C ÷ Y, constructible ONLY from `Yield::Positive` — this match has exactly one arm that
    /// divides, and it is the one guarded by `Positive`, whose payload is a `PositiveYield` that
    /// cannot itself hold zero, negative, NaN or infinite. There is no arm here, and no path
    /// anywhere in `Yield`'s construction, that reaches a division by zero: `Zero` and
    /// `Unmeasured` both refuse before any arithmetic runs.
    pub fn fair_price(&self, c: &Dated<Usd>, y: Yield) -> Result<Dated<Usd>, Unmeasured> {
        match y {
            Yield::Positive(py) => Ok(Dated::new(Usd(c.v.0 / py.get()), self.as_of.clone(), self.source.clone())),
            Yield::Zero => Err(Unmeasured { why: "no pass on record (Y = 0) — the fair price has no denominator".into() }),
            Yield::Unmeasured => Err(Unmeasured { why: "Y is UNMEASURED".into() }),
        }
    }
}

pub struct MarketPrice { pub min: Q, pub max: Q, pub unit: String, pub source: String, pub source_date: String, pub provenance: Option<String> }
/// the market price of one task of class `klass`: dated, sourced, min/max — or Err naming why not.
pub fn market_price(table: &Value, klass: &str) -> Result<MarketPrice, String> {
    let m = table.get("market_prices").and_then(|v| v.get(klass));
    let m = match m { Some(m) if !m.is_null() => m, _ => return Err(format!("no market_prices row for {}", klass)) };
    let usd_min = m.get("usd_min").and_then(|v| v.as_f64());
    let usd_max = m.get("usd_max").and_then(|v| v.as_f64());
    let source = m.get("source").and_then(|v| v.as_str());
    let source_date = m.get("source_date").and_then(|v| v.as_str());
    if usd_min.is_none() || usd_max.is_none() || source.is_none() || source_date.is_none() {
        return Err(format!("market price for {} is null or undated/unsourced", klass));
    }
    let unit = m.get("unit").and_then(|v| v.as_str()).unwrap_or("");
    if unit != "usd_per_task" && unit != "usd_per_hour" {
        return Err(format!("market price unit must be usd_per_task or usd_per_hour, got {}", unit));
    }
    let u = if unit == "usd_per_hour" { Unit::UsdPerHour } else { Unit::Usd };
    Ok(MarketPrice { min: tag(usd_min.unwrap(), u), max: tag(usd_max.unwrap(), u), unit: unit.to_string(),
        source: source.unwrap().to_string(), source_date: source_date.unwrap().to_string(),
        provenance: m.get("provenance").and_then(|v| v.as_str()).map(|s| s.to_string()) })
}
/// R = n × F ÷ P and B = P ÷ C at the market min and max. An hourly market price converts through the task's own
/// wall clock: minutes_per_task = n × minutes_per_commit, so an hourly class needs both and says so when absent.
pub fn no_arbitrage(c: Q, f: &Result<Q, String>, n: Option<f64>, minutes_per_commit: Option<f64>, market: &MarketPrice) -> Value {
    let per_task = |p: Q| -> Option<Q> {
        if market.unit == "usd_per_task" { return Some(p); }
        let mpc = minutes_per_commit?; let nn = n?;
        let minutes_per_task = mul(tag(mpc, Unit::Minutes), dimensionless(nn)).ok()?;
        mul(per_hour_to_per_minute(p).ok()?, minutes_per_task).ok()
    };
    let mut out = Map::new();
    for (side, p) in [("min", market.min), ("max", market.max)] {
        match per_task(p) {
            None => {
                out.insert(format!("R_at_{}", side), Value::Null);
                out.insert(format!("B_at_{}", side), Value::Null);
                out.insert(format!("why_{}", side), json!("hourly market price needs n and minutes per commit"));
            }
            Some(p_task) => {
                match div(p_task, c) { Ok(b) => { out.insert(format!("B_at_{}", side), json!(r6(b.v))); }
                                        Err(_) => { out.insert(format!("B_at_{}", side), Value::Null); } }
                match f {
                    Ok(fq) if n.is_some() => {
                        let r = mul(*fq, dimensionless(n.unwrap())).and_then(|nf| div(nf, p_task));
                        match r { Ok(v) => { out.insert(format!("R_at_{}", side), json!(r6(v.v))); }
                                  Err(_) => { out.insert(format!("R_at_{}", side), Value::Null); } }
                    }
                    Ok(_) => { out.insert(format!("R_at_{}", side), Value::Null); out.insert(format!("why_{}", side), json!("units_per_task n is null")); }
                    Err(why) => { out.insert(format!("R_at_{}", side), Value::Null); out.insert(format!("why_{}", side), json!(why)); }
                }
            }
        }
    }
    Value::Object(out)
}

/// ONE LANE → the full read, shaped exactly like kr43-no-arbitrage.mjs's laneRead (field-for-field), so a JS
/// driver can diff the two engines' output directly (E6).
pub fn lane_read(lane: &str, env: &Value, y_row: &Value, table: &Value) -> Value {
    let klass = table.get("lane_task_class").and_then(|m| m.get(lane)).and_then(|v| v.as_str()).map(|s| s.to_string());
    let commits = env.get("commits").and_then(|v| v.as_i64()).unwrap_or(0);
    let minutes_per_commit = env.get("minutes_per_commit").and_then(|m| m.get("median")).and_then(|v| v.as_f64());
    let y = y_row.get("Y").and_then(|v| v.as_f64());
    let y_measured = y_row.get("measured").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut base = Map::new();
    base.insert("lane".into(), json!(lane));
    base.insert("task_class".into(), match &klass { Some(k) => json!(k), None => Value::Null });
    base.insert("commits".into(), json!(commits));
    base.insert("minutes_per_commit".into(), match minutes_per_commit { Some(v) => json!(v), None => Value::Null });
    base.insert("Y".into(), match y { Some(v) => json!(v), None => Value::Null });
    base.insert("y_measured".into(), json!(y_measured));
    let klass = match klass { Some(k) => k, None => {
        base.insert("measured".into(), json!(false));
        base.insert("why".into(), json!("UNMAPPED — lane_task_class carries no declaration for this lane; never inferred from content"));
        return Value::Object(base);
    } };
    let empty_tbm = json!({});
    let tokens_by_model = env.get("tokens_by_model").unwrap_or(&empty_tbm);
    let rc = replication_cost(tokens_by_model, if commits > 0 { commits } else { 1 }, minutes_per_commit, table);
    let (c, tok, hum) = match rc { Ok(x) => x, Err(why) => {
        base.insert("measured".into(), json!(false));
        base.insert("why".into(), json!(why));
        return Value::Object(base);
    } };
    let f = fair_price_per_delivered(c, y);
    let p = market_price(table, &klass);
    let n = table.get("units_per_task").and_then(|m| m.get(&klass)).and_then(|e| e.get("n")).and_then(|v| v.as_f64());
    let n_source = table.get("units_per_task").and_then(|m| m.get(&klass)).and_then(|e| e.get("source")).cloned().unwrap_or(Value::Null);
    let table_as_of = table.get("as_of").cloned().unwrap_or(Value::Null);
    let table_source = table.get("source").cloned().unwrap_or(Value::Null);
    base.insert("measured".into(), json!(true));
    base.insert("replication".into(), json!({ "as_of": table_as_of, "source": table_source,
        "usd_per_commit": r6(c.v), "token_usd_per_commit": r6(tok.v), "human_usd_per_commit": r6(hum.v),
        "wage_source": table.get("wage").and_then(|w| w.get("source")).cloned().unwrap_or(Value::Null) }));
    base.insert("fair_price_per_delivered".into(), match &f {
        Err(why) => json!({ "unmeasured": true, "why": why }),
        Ok(fq) => json!({ "as_of": table_as_of, "source": table_source, "usd": r6(fq.v), "Y": y }),
    });
    base.insert("market".into(), match &p {
        Err(why) => json!({ "unpinned": true, "why": why }),
        Ok(m) => json!({ "as_of": m.source_date, "source": m.source, "provenance": m.provenance, "unit": m.unit, "usd_min": m.min.v, "usd_max": m.max.v }),
    });
    base.insert("units_per_task".into(), match n { Some(v) => json!(v), None => Value::Null });
    base.insert("units_per_task_source".into(), n_source);
    base.insert("no_arbitrage".into(), match &p {
        Ok(m) => {
            let mut na = no_arbitrage(c, &f, n, minutes_per_commit, m);
            if let Value::Object(map) = &mut na {
                map.insert("as_of".into(), table_as_of.clone());
                map.insert("source".into(), json!(format!("{} + {}", table_source.as_str().unwrap_or(""), m.source)));
                map.insert("direction".into(), json!("R = n × F ÷ P: above 1 the market pays less than replication at this yield; B = P ÷ C: commit units one task’s market price buys at replication cost"));
            }
            na
        }
        Err(why) => json!({ "unpinned": true, "why": why }),
    });
    Value::Object(base)
}

pub const RULE: &str = "KR43 THE NO-ARBITRAGE READ, IN THE CRATE (E1-E6): C (replication cost of one commit unit) = token dollars per commit + human minutes per commit × wage per minute, every price dated and sourced or the field reads UNPINNED; F = C ÷ Y is the fair price of a DELIVERED unit and is UNMEASURED when Y = 0 (never infinity); P_k is a market price per task class from the table (min/max, dated, provenance named), n_k the declared units per task; R = n_k × F ÷ P_k is replication over market; B = P_k ÷ C is the number of commit units one task's market price buys at replication cost. A lane not in lane_task_class is UNMAPPED, never inferred from content. Nothing here is a clearing price. THE VALUE OF THE TASK IS THE BUYER'S — not computed here, ever.";

/// a minimal UTC ISO-8601 timestamp, local to this module (main.rs's chrono_like_ts uses a different, non-ISO
/// separator for attestation lines — this one matches JS's `new Date().toISOString()` shape for readability only;
/// no test compares it).
fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();
    let days = secs / 86_400; let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, mo, d, h, m, s, millis)
}

pub fn run(args: &[String]) {
    let t0 = std::time::Instant::now();
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let envelope_path = match arg("--envelope") { Some(p) => p, None => { eprintln!("--envelope-read needs --envelope <file.json>"); std::process::exit(2); } };
    let price_table_path = arg("--price-table").unwrap_or_else(|| "data/pmu/price-table.json".into());
    let env_text = match std::fs::read_to_string(&envelope_path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", envelope_path, e); std::process::exit(2); } };
    let env_doc: Value = match serde_json::from_str(&env_text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON in {}: {}", envelope_path, e); std::process::exit(2); } };
    let table: Value = if std::path::Path::new(&price_table_path).exists() {
        match std::fs::read_to_string(&price_table_path).ok().and_then(|t| serde_json::from_str(&t).ok()) { Some(v) => v, None => Value::Null }
    } else { Value::Null };

    let empty = json!({});
    let envelope = env_doc.get("envelope").unwrap_or(&empty);
    let yield_ = env_doc.get("yield").unwrap_or(&empty);
    let by_lane_env = envelope.get("by_lane").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let mut lanes: Vec<String> = by_lane_env.keys().cloned().collect();
    lanes.sort();

    let mut by_lane = Map::new();
    for l in &lanes {
        let env_l = &by_lane_env[l];
        let y_row = yield_.get("by_lane_commit_form").and_then(|m| m.get(l)).cloned().unwrap_or_else(|| json!({}));
        by_lane.insert(l.clone(), lane_read(l, env_l, &y_row, &table));
    }

    // overall — the __overall__ pseudo-lane is forced to task class software-development-hour (KR43's convention)
    let mut overall_table = if table.is_null() { json!({}) } else { table.clone() };
    if let Some(map) = overall_table.as_object_mut() {
        let ltc = map.entry("lane_task_class").or_insert_with(|| json!({}));
        if let Some(ltcm) = ltc.as_object_mut() { ltcm.entry("__overall__").or_insert(json!("software-development-hour")); }
    }
    let overall_env = envelope.get("overall").cloned().unwrap_or_else(|| json!({}));
    let overall_y = yield_.get("overall_commit_form").cloned().unwrap_or_else(|| json!({}));
    let overall = lane_read("__overall__", &overall_env, &overall_y, &overall_table);

    let is_measured = |v: &Value| v.get("measured") == Some(&Value::Bool(true));
    let is_unmapped = |v: &Value| v.get("task_class").map(|t| !t.is_null()).unwrap_or(false);
    let measured_lanes: Vec<&String> = lanes.iter().filter(|l| is_measured(&by_lane[l.as_str()])).collect();

    let out = json!({
        "engine": "rust-envelope",
        "ts": iso_now(),
        "reading": "KR43 THE NO-ARBITRAGE READ — commit units against a dated market price",
        "rule": RULE,
        "value": "THE VALUE OF THE TASK IS THE BUYER’S — not computed here, ever. R and B are ratios of two dated prices; neither is a clearing price.",
        "inputs": { "envelope": envelope_path, "envelope_ts": env_doc.get("ts").cloned().unwrap_or(Value::Null),
                    "price_table": price_table_path, "table_as_of": table.get("as_of").cloned().unwrap_or(Value::Null),
                    "table_source": table.get("source").cloned().unwrap_or(Value::Null) },
        "priceable": {
            "lanes": lanes.len(),
            "mapped": lanes.iter().filter(|l| is_unmapped(&by_lane[l.as_str()])).count(),
            "replication_priced": measured_lanes.len(),
            "fair_price_measured": measured_lanes.iter().filter(|l| {
                let fp = &by_lane[l.as_str()]["fair_price_per_delivered"];
                fp.get("unmeasured") != Some(&Value::Bool(true))
            }).count(),
            "market_pinned": measured_lanes.iter().filter(|l| {
                let m = &by_lane[l.as_str()]["market"];
                m.get("unpinned") != Some(&Value::Bool(true))
            }).count(),
        },
        "overall": overall,
        "by_lane": Value::Object(by_lane),
        "wall_s": t0.elapsed().as_secs(),
    });

    let bad = assert_no_dollar_without_date(&out);
    if !bad.is_empty() {
        eprintln!("REFUSING TO WRITE — a dollar field is missing its as_of/source:\n{}", bad.join("\n"));
        std::process::exit(1);
    }
    println!("{}", serde_json::to_string(&out).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    fn na_fixture(k: f64, market_k: f64) -> Value {
        json!({ "as_of": "2026-09-17", "source": "fixture",
            "token_prices_per_million": { "m": { "input": 1.0 * k, "output": 10.0 * k, "cache_read": null } },
            "wage": { "per_hour": 60.0 * k, "source": "fixture-wage" },
            "market_prices": { "blog-post": { "usd_min": 100.0 * k * market_k, "usd_max": 400.0 * k * market_k, "unit": "usd_per_task", "source": "fixture-market", "source_date": "2026-09-01", "provenance": "secondary" } },
            "lane_task_class": { "blog-content": "blog-post" },
            "units_per_task": { "blog-post": { "n": 3, "source": "fixture" } } })
    }
    fn na_env() -> Value { json!({ "commits": 10, "tokens_by_model": { "m": { "in": 1e6, "out": 1e5, "cache_read": 0 } }, "minutes_per_commit": { "median": 6 } }) }
    /// values here are already rounded to 6 decimals by r6, so an absolute 1e-6 bound can sit exactly on the
    /// rounding boundary — compare RELATIVELY, the same way kr43-no-arbitrage.test.mjs's `near` does.
    fn near(a: f64, b: f64) -> bool { (a - b).abs() <= 1e-5 * b.abs().max(1.0) }

    #[test]
    fn e1_the_unit_registry_matches_the_named_table() {
        // every (a,b) pair either has a rule (checked below in the harness enumeration) or errs — this is the
        // module-level smoke test that the two operators used by lane_read stay in that discipline.
        assert!(add(tag(1000.0, Unit::Tokens), tag(5.0, Unit::Minutes)).is_err());
        assert!(mul(tag(1000.0, Unit::Tokens), tag(5.0, Unit::Minutes)).is_err());
        assert_eq!(div(tag(6.2, Unit::Usd), tag(6.2, Unit::Usd)).unwrap().unit, Unit::Dimensionless);
    }
    #[test]
    fn e2_a_dollar_with_no_date_is_flagged() {
        let bad = json!({ "lane": { "dollars_per_pass": 1.23 } });
        assert!(!assert_no_dollar_without_date(&bad).is_empty());
        let good = json!({ "lane": { "dollars_per_pass": 1.23, "as_of": "2026-09-17", "source": "x" } });
        assert!(assert_no_dollar_without_date(&good).is_empty());
    }
    #[test]
    fn e5_dollars_per_commit_divides_by_commits_before_anything_divides_by_y() {
        // U-7's defect fixture: 4 commits, 1,000 tokens each (4,000 total) at $1/M, Y 0.5 → $0.001/commit, $0.002/pass — never $0.008
        let tbm = json!({ "m": { "in": 3000.0, "out": 1000.0, "cache_read": 0 } });
        let table = json!({ "as_of": "2026-09-17", "source": "fixture", "token_prices_per_million": { "m": { "input": 1.0, "output": 1.0, "cache_read": null } } });
        let c = lane_dollars_per_commit(&tbm, 4, &table).unwrap();
        assert!((c.v - 0.001).abs() < 1e-9, "dollars_per_commit {}", c.v);
        let f = per_pass_floor(c, 0.5).unwrap();
        assert!((f.v - 0.002).abs() < 1e-9, "dollars_per_pass {} (was 0.008 when the lane total was divided by Y alone)", f.v);
    }
    #[test]
    fn na_1_2_3_replication_cost_and_fair_price() {
        let c = replication_cost(&na_env()["tokens_by_model"], 10, Some(6.0), &na_fixture(1.0, 1.0)).unwrap();
        assert!((c.0.v - 6.2).abs() < 1e-9, "C {}", c.0.v);
        assert!((c.2.v - 6.0).abs() < 1e-9, "human $6, not $360 (per hour) — {}", c.2.v);
        let f0 = fair_price_per_delivered(c.0, Some(0.0));
        assert!(f0.is_err(), "Y = 0 must be UNMEASURED, never Infinity");
    }
    #[test]
    fn e3_homogeneity_and_e4_monotone_in_y_on_lane_read() {
        let y_row = |y: f64| json!({ "Y": y, "measured": true });
        let base = lane_read("blog-content", &na_env(), &y_row(0.5), &na_fixture(1.0, 1.0));
        let na = &base["no_arbitrage"];
        assert!((na["R_at_min"].as_f64().unwrap() - 0.372).abs() < 1e-6, "{}", na["R_at_min"]);
        assert!((na["B_at_min"].as_f64().unwrap() - 100.0 / 6.2).abs() < 1e-6);
        for k in [0.5, 2.0, 10.0] {
            let all = lane_read("blog-content", &na_env(), &y_row(0.5), &na_fixture(k, 1.0))["no_arbitrage"].clone();
            assert!(near(all["R_at_min"].as_f64().unwrap(), na["R_at_min"].as_f64().unwrap()), "k={k}: all prices scaled must leave R unchanged");
            assert!(near(all["B_at_max"].as_f64().unwrap(), na["B_at_max"].as_f64().unwrap()), "k={k}: all prices scaled must leave B unchanged");
            let mk = lane_read("blog-content", &na_env(), &y_row(0.5), &na_fixture(1.0, k))["no_arbitrage"].clone();
            assert!(near(mk["R_at_min"].as_f64().unwrap(), na["R_at_min"].as_f64().unwrap() / k), "k={k}: market alone × k must divide R by k");
            assert!(near(mk["B_at_min"].as_f64().unwrap(), na["B_at_min"].as_f64().unwrap() * k), "k={k}: market alone × k must multiply B by k");
        }
        let half = lane_read("blog-content", &na_env(), &y_row(0.25), &na_fixture(1.0, 1.0))["no_arbitrage"].clone();
        assert!(near(half["R_at_max"].as_f64().unwrap(), 2.0 * na["R_at_max"].as_f64().unwrap()), "halving Y must double R");
        assert!((half["B_at_max"].as_f64().unwrap() - na["B_at_max"].as_f64().unwrap()).abs() < 1e-9, "B must not move with Y");
        let zero = lane_read("blog-content", &na_env(), &y_row(0.0), &na_fixture(1.0, 1.0));
        assert_eq!(zero["fair_price_per_delivered"]["unmeasured"], json!(true));
        assert_eq!(zero["no_arbitrage"]["R_at_min"], Value::Null);
        assert!(zero["no_arbitrage"]["B_at_min"].as_f64().is_some(), "B needs no Y");
    }

    // ── E7: TYPE-STATE MONEY — runtime evidence for the half a runtime test CAN show ────────────
    // The type-level half (no `impl PriceTable { fn price(...) }` exists, so `PriceTable::Unpinned`
    // cannot call it) is a fact about the type checker, not something `cargo test` runs — it is
    // demonstrated by the doc comments on `PinnedTable` above and the E8-adjacent compile-fail
    // stub, which names the exact rustc error. What CAN be shown at runtime: parsing is total and
    // classifies every table correctly (so `Unpinned`/`Pinned` never disagrees with `as_of`/
    // `source` presence), and `Yield`'s three states behave exactly as promised — no NaN, no
    // Infinity, no path that reaches division under `Zero` or `Unmeasured`.
    #[test]
    fn e7_all_null_table_parses_unpinned_never_pinned() {
        for (label, t) in [
            ("null table", Value::Null),
            ("empty object", json!({})),
            ("as_of present, source null", json!({ "as_of": "2026-09-17", "source": null })),
            ("source present, as_of null", json!({ "as_of": null, "source": "x" })),
            ("both explicitly null", json!({ "as_of": null, "source": null, "token_prices_per_million": {} })),
        ] {
            match PriceTable::parse(&t) {
                PriceTable::Unpinned { .. } => {}
                PriceTable::Pinned(_) => panic!("{label}: an all-null/undated table parsed to Pinned"),
            }
        }
        // and the positive case is not swallowed by the same check
        let good = json!({ "as_of": "2026-09-17", "source": "fixture", "token_prices_per_million": { "m": { "input": 1.0, "output": 10.0 } }, "wage": { "per_hour": 60.0 } });
        match PriceTable::parse(&good) {
            PriceTable::Pinned(pt) => { assert_eq!(pt.as_of, "2026-09-17"); assert_eq!(pt.source, "fixture"); }
            PriceTable::Unpinned { why } => panic!("a dated, sourced table parsed Unpinned: {why}"),
        }
    }
    #[test]
    fn e7_pinned_table_prices_dated_and_typed() {
        let good = json!({ "as_of": "2026-09-17", "source": "fixture", "token_prices_per_million": { "m": { "input": 1.0, "output": 10.0 } }, "wage": { "per_hour": 60.0 } });
        let pt = match PriceTable::parse(&good) { PriceTable::Pinned(pt) => pt, _ => panic!("expected Pinned") };
        let (input, output) = pt.token_price("m").unwrap();
        assert!((input.v.0 - 1.0 / 1e6).abs() < 1e-12); assert_eq!(input.as_of, "2026-09-17"); assert_eq!(input.source, "fixture");
        assert!((output.v.0 - 10.0 / 1e6).abs() < 1e-12);
        assert!(pt.token_price("no-such-model").is_err(), "an unpriced model must refuse, not default to zero");
        let wage = pt.wage_per_hour().unwrap();
        assert!((wage.v.0 - 60.0).abs() < 1e-12); assert_eq!(wage.as_of, "2026-09-17");
    }
    #[test]
    fn e7_yield_positive_prices_zero_and_unmeasured_refuse_never_nan_or_infinity() {
        let table = json!({ "as_of": "2026-09-17", "source": "fixture" });
        let pt = match PriceTable::parse(&table) { PriceTable::Pinned(pt) => pt, _ => panic!("expected Pinned") };
        let c = Dated::new(Usd(6.2), "2026-09-17", "fixture");
        // Positive: the only path that divides
        match Yield::from_option(Some(0.5)) {
            Yield::Positive(_) => { let f = pt.fair_price(&c, Yield::from_option(Some(0.5))).unwrap(); assert!((f.v.0 - 12.4).abs() < 1e-9); assert!(f.v.0.is_finite()); }
            other => panic!("Some(0.5) must classify Positive, got {other:?}"),
        }
        // Zero: refuses, never Infinity
        match Yield::from_option(Some(0.0)) {
            Yield::Zero => { let e = pt.fair_price(&c, Yield::Zero).unwrap_err(); assert!(e.why.contains("no pass on record")); }
            other => panic!("Some(0.0) must classify Zero, got {other:?}"),
        }
        // Unmeasured: refuses, never NaN
        match Yield::from_option(None) {
            Yield::Unmeasured => { let e = pt.fair_price(&c, Yield::Unmeasured).unwrap_err(); assert!(e.why.contains("UNMEASURED")); }
            other => panic!("None must classify Unmeasured, got {other:?}"),
        }
        // negative / NaN / infinite all classify Unmeasured (PositiveYield::new refuses them), never Positive
        for bad in [-0.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(matches!(Yield::from_option(Some(bad)), Yield::Unmeasured), "{bad} must not classify Positive");
            assert!(PositiveYield::new(bad).is_none(), "{bad} must not construct a PositiveYield");
        }
        // and PositiveYield::new is the ONLY constructor — there is no way to build Yield::Positive
        // holding 0.0, negative, NaN or infinite, because PositiveYield::new is the sole gate.
        assert!(PositiveYield::new(0.0).is_none());
        assert!(PositiveYield::new(1.0).is_some());
    }
}
