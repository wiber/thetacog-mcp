// src/job_units_read.rs — KR42's JOB-IN-COMMIT-UNITS ARITHMETIC, IN THE CRATE (whitespace ledger B4, house rule 11:
// "a reading is the crate's; the JS is a driver and says js-fallback when it answers alone"). Named here per
// docs/architecture/fable-maintenance-ratchet.md §8.63's own closing paragraph, which left this port for the next
// session.
//
// THE DEFINITION (scripts/pmu/kr42-job-units.mjs, unchanged). A JOB is one mesh transaction: the window runs from
// its ASK event's ts to its CLOSED event's ts, or — since this record carries zero CLOSED events end to end — to
// the last event on record, marked 'open'. COMMIT UNITS are kr40's own persisted commit-unit rows whose room
// matches the job's room and whose ts falls inside [ask_ts, window_end], both ends inclusive. NO DOUBLE-COUNTING: a
// commit belongs to AT MOST ONE job; when a commit's ts sits inside more than one candidate window for its room,
// the EARLIER ASK wins and the collision is counted (overlap_commits), never split or duplicated (JU-R1).
// DELIVERED_UNITS are units whose covenant_commit === 1 — the STRICT per-commit form, never the per-turn form.
// TIME_ON_TARGET_MINUTES is read off a job's own room's walk-tape turn rows inside [ask_ts, window_end]: the
// segment from one turn row to the next (the final segment closing at window_end) is attributed to that row's
// off_pct <= tau; a job with ZERO turn rows in its window reads null, NEVER 0 (JU-R2) — an absence of record is not
// evidence of drift. PN3 (>= 20 distinct jobs, by tx_id) gates every per-lane and per-room cell.
//
// THE JS DRIVER ASSEMBLES THE ROWS — replaying the mesh ledger into job windows (jobWindows, from raw ASK/CLOSED
// events), reading kr40's persisted commit-unit rows, and mapping sessions to rooms via lens-receipts to pull the
// walk tape's own turn rows per job's room — and hands this crate flat job and commit-unit rows as JSON. This file
// NEVER touches the mesh ledger, kr40's file, lens-receipts or the walk tape directly, and never re-derives a
// room/lane assignment — exactly as aperture_read.rs never re-implements KR39's scoredRows exclusion and
// steering_read.rs never re-walks git.
//
// A job's `ask_ts`/`window_end` and a commit's `ts` arrive as UTC ISO-8601 strings in the exact `Date.toISOString()`
// shape every producer in this repo already emits (`YYYY-MM-DDTHH:MM:SS.sssZ`) — parsed here by an integer
// days-from-civil calendar (Howard Hinnant's public-domain algorithm), never a floating clock read and never a
// crate dependency, so two runs print byte-identical JSON. Turn rows arrive pre-resolved to epoch milliseconds
// (`t`, already a JS `Date.parse` result on the JS side) — there are thousands of them per room and no calendar
// arithmetic is owed on a value already an integer.
//
// LLM-free. No clock read at runtime (every timestamp is DATA, parsed once). Two runs print byte-identical JSON.
//   pmu-onchip --job-units-read [--path doc.json | < doc.json] [--tau 25] [--min-distinct-jobs 20]
//   doc.json: { "jobs": [ { "tx_id": "tx1", "room": "builder"|null, "lane": "builder"|null,
//                           "ask_ts": "2026-09-01T00:00:00.000Z", "window_end": "2026-09-01T02:00:00.000Z"|null,
//                           "turn_rows": [ { "t": 1788220800000, "off": 12.0 }, ... ] }, ... ],
//               "commits": [ { "ref": "abc1234", "room": "builder"|null, "ts": "2026-09-01T01:00:00.000Z",
//                              "covenant_commit": 1|0|null, "tokens_in": 100, "tokens_out": 200,
//                              "wall_minutes": 3.0 }, ... ] }
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const DEFAULT_TAU_PCT: f64 = 25.0;
pub const DEFAULT_MIN_DISTINCT_JOBS: usize = 20;

fn r3(x: f64) -> f64 { (x * 1000.0).round() / 1000.0 }
fn fin(x: f64) -> Option<f64> { if x.is_finite() { Some(x) } else { None } }

// ── a minimal, dependency-free UTC ISO-8601 parser for the exact `Date.toISOString()` shape ───────────────────────
/// days since the Unix epoch for a proleptic-Gregorian (y, m, d) — Howard Hinnant's public-domain `days_from_civil`,
/// the same algorithm `Date.UTC` implementations use for this calendar range.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 }; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

/// `"YYYY-MM-DDTHH:MM:SS.sssZ"` (fractional seconds optional, 1-9 digits, truncated/zero-padded to milliseconds) ->
/// epoch milliseconds. `None` on anything that does not match this exact shape — a malformed timestamp is refused,
/// never guessed at.
pub fn parse_iso_ms(s: &str) -> Option<i64> {
    if s.len() < 20 || !s.ends_with('Z') { return None; }
    let b = s.as_bytes();
    let dig = |lo: usize, hi: usize| -> Option<i64> { s.get(lo..hi)?.parse().ok() };
    if b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') || b.get(10) != Some(&b'T') { return None; }
    if b.get(13) != Some(&b':') || b.get(16) != Some(&b':') { return None; }
    let year = dig(0, 4)?; let month = dig(5, 7)?; let day = dig(8, 10)?;
    let hour = dig(11, 13)?; let min = dig(14, 16)?; let sec = dig(17, 19)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || !(0..=23).contains(&hour) || !(0..=59).contains(&min) || !(0..=60).contains(&sec) { return None; }
    let ms: i64 = match b.get(19) {
        Some(b'.') => {
            let frac = s.get(20..s.len() - 1)?;
            if frac.is_empty() || frac.len() > 9 || !frac.bytes().all(|c| c.is_ascii_digit()) { return None; }
            let mut frac3 = frac.to_string();
            while frac3.len() < 3 { frac3.push('0'); }
            frac3[..3].parse().ok()?
        }
        Some(b'Z') => 0,
        _ => return None,
    };
    let days = days_from_civil(year, month, day);
    Some(days * 86_400_000 + hour * 3_600_000 + min * 60_000 + sec * 1000 + ms)
}

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────
#[derive(Clone, Debug)]
pub struct TurnRow { pub t_ms: i64, pub off: f64 }

#[derive(Clone, Debug)]
pub struct JobRow {
    pub tx_id: String,
    pub room: Option<String>,
    pub lane: Option<String>,
    pub ask_ms: i64,
    /// the resolved close (CLOSED ts, or the last-event ts for an open job) — `None` when the JS driver could not
    /// resolve one; such a job is counted but assigned no commits and reads no time_on_target, rather than being
    /// guessed an unbounded window.
    pub window_end_ms: Option<i64>,
    pub turn_rows: Vec<TurnRow>,
}

#[derive(Clone, Debug)]
pub struct CommitRow {
    pub reff: String,
    pub room: Option<String>,
    pub ts_ms: i64,
    pub covenant_commit: Option<i64>,
    pub tokens_in: f64,
    pub tokens_out: f64,
    pub wall_minutes: f64,
}

// ── JU-R1 · assignment: no commit belongs to two jobs, earlier ASK wins an overlap ─────────────────────────────────
#[derive(Default, Clone, Debug)]
pub struct AssignTally { pub matched: usize, pub unmatched_no_room: usize, pub unmatched_no_window: usize, pub overlap_commits: usize }

/// assign each commit to AT MOST ONE job (by index into `commits`): room must match and ts must sit inside
/// [ask_ms, window_end_ms], both ends inclusive. A job with no resolved window_end_ms never receives a commit. When
/// a commit's ts sits inside more than one candidate window for its room, the EARLIER ASK wins (ties broken by the
/// job's own position in `jobs`, matching a stable sort on ask_ms) and the collision is counted in
/// `overlap_commits`, never split or duplicated. Mirrors kr42-job-units.mjs's assignUnits exactly.
pub fn assign_units(jobs: &[JobRow], commits: &[CommitRow]) -> (Vec<Vec<usize>>, AssignTally) {
    let mut units: Vec<Vec<usize>> = vec![Vec::new(); jobs.len()];
    let mut by_room: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (ji, j) in jobs.iter().enumerate() {
        if let (Some(room), Some(_)) = (j.room.as_deref(), j.window_end_ms) {
            by_room.entry(room).or_default().push(ji);
        }
    }
    for list in by_room.values_mut() { list.sort_by_key(|&ji| jobs[ji].ask_ms); } // stable — ties keep source order
    let mut tally = AssignTally::default();
    for (ci, c) in commits.iter().enumerate() {
        let room = match c.room.as_deref() { Some(r) => r, None => { tally.unmatched_no_room += 1; continue; } };
        let list = match by_room.get(room) { Some(l) if !l.is_empty() => l, _ => { tally.unmatched_no_room += 1; continue; } };
        let candidates: Vec<usize> = list.iter().copied().filter(|&ji| {
            let j = &jobs[ji];
            j.window_end_ms.map_or(false, |we| c.ts_ms >= j.ask_ms && c.ts_ms <= we)
        }).collect();
        if candidates.is_empty() { tally.unmatched_no_window += 1; continue; }
        if candidates.len() > 1 { tally.overlap_commits += 1; }
        let winner = *candidates.iter().min_by_key(|&&ji| jobs[ji].ask_ms).unwrap(); // the EARLIER ask wins
        units[winner].push(ci);
        tally.matched += 1;
    }
    (units, tally)
}

// ── per-job cost-and-yield aggregates over its own matched commit-unit rows ─────────────────────────────────────
#[derive(Clone, Debug)]
pub struct JobAgg {
    pub units: usize, pub units_decidable: usize, pub delivered_units: usize,
    pub yield_job: Option<f64>, pub yield_job_decidable: Option<f64>,
    pub tokens_in: f64, pub tokens_out: f64, pub tokens: f64, pub wall_minutes: f64,
}

/// mirrors kr42-job-units.mjs's jobAggregates: yield_job over ALL matched units, yield_job_decidable (the
/// kr40-consistent variant) over only the units whose covenant_commit is not null. DELIVERED_UNITS is the STRICT
/// per-commit covenant_commit === 1 form, never a per-turn form (kr40's own beatable-by-splitting reason).
pub fn job_aggregates(rows: &[&CommitRow]) -> JobAgg {
    let decidable: Vec<&&CommitRow> = rows.iter().filter(|r| r.covenant_commit.is_some()).collect();
    let delivered = decidable.iter().filter(|r| r.covenant_commit == Some(1)).count();
    let units = rows.len();
    let tokens_in: f64 = rows.iter().map(|r| r.tokens_in).sum();
    let tokens_out: f64 = rows.iter().map(|r| r.tokens_out).sum();
    let wall_minutes = r3(rows.iter().map(|r| r.wall_minutes).sum());
    JobAgg {
        units, units_decidable: decidable.len(), delivered_units: delivered,
        yield_job: if units > 0 { Some(r3(delivered as f64 / units as f64)) } else { None },
        yield_job_decidable: if !decidable.is_empty() { Some(r3(delivered as f64 / decidable.len() as f64)) } else { None },
        tokens_in, tokens_out, tokens: tokens_in + tokens_out, wall_minutes,
    }
}

// ── JU-R2 · time on target: null-vs-zero, never conflated ──────────────────────────────────────────────────────
#[derive(Clone, Debug)]
pub struct TimeOnTarget { pub minutes: Option<f64>, pub covered_minutes: f64, pub rows: usize }

/// mirrors kr42-job-units.mjs's timeOnTarget exactly: the segment between one turn row and the next (the final
/// segment closing at end_ms) is attributed to that row's off <= tau; a job with ZERO turn rows inside
/// [start_ms, end_ms] reads `minutes: None` — NEVER `Some(0.0)` — per PN4's witness discipline: an absence of
/// record is not evidence of drift.
pub fn time_on_target(turn_rows: &[TurnRow], start_ms: i64, end_ms: i64, tau: f64) -> TimeOnTarget {
    let mut rows: Vec<&TurnRow> = turn_rows.iter().filter(|r| r.t_ms >= start_ms && r.t_ms <= end_ms).collect();
    if rows.is_empty() { return TimeOnTarget { minutes: None, covered_minutes: 0.0, rows: 0 }; }
    rows.sort_by_key(|r| r.t_ms);
    let mut minutes = 0.0; let mut covered = 0.0;
    for i in 0..rows.len() {
        let seg_start = rows[i].t_ms;
        let seg_end = if i + 1 < rows.len() { rows[i + 1].t_ms } else { end_ms };
        let dur = (seg_end - seg_start).max(0) as f64 / 60000.0;
        covered += dur;
        if rows[i].off <= tau { minutes += dur; }
    }
    TimeOnTarget { minutes: Some(r3(minutes)), covered_minutes: r3(covered), rows: rows.len() }
}

// ── distributions and PN3-gated cells ───────────────────────────────────────────────────────────────────────────
fn median(xs: &[f64]) -> Option<f64> {
    if xs.is_empty() { return None; }
    let mut s = xs.to_vec(); s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let m = s.len() / 2;
    Some(if s.len() % 2 == 1 { s[m] } else { (s[m - 1] + s[m]) / 2.0 })
}
fn p90(xs: &[f64]) -> Option<f64> {
    if xs.is_empty() { return None; }
    let mut s = xs.to_vec(); s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((0.9 * s.len() as f64).ceil() as usize).saturating_sub(1).min(s.len() - 1);
    Some(s[idx])
}
pub fn distribution(xs: &[f64]) -> Value {
    let vals: Vec<f64> = xs.iter().copied().filter(|v| v.is_finite()).collect();
    let n = vals.len();
    let max = if n > 0 { vals.iter().copied().fold(f64::NEG_INFINITY, f64::max) } else { f64::NAN };
    json!({ "n": n, "median": median(&vals).and_then(fin).map(r3), "p90": p90(&vals).and_then(fin).map(r3),
            "max": if n > 0 { fin(max).map(r3) } else { None } })
}

#[derive(Clone, Debug)]
pub struct JobOut {
    pub tx_id: String, pub room: Option<String>, pub lane: Option<String>,
    pub units: usize, pub delivered_units: usize, pub tokens: f64, pub wall_minutes: f64,
    pub time_on_target_share: Option<f64>,
}

/// one lane/room cell: counts, PN3-gated distributions, over distinct jobs (tx_id) — mirrors kr42's cellFor exactly.
pub fn cell_for(jobs_subset: &[&JobOut], min_distinct_jobs: usize) -> Value {
    let distinct = jobs_subset.len(); // each tx_id appears at most once per subset by construction (grouped by lane/room)
    let with_units: Vec<&&JobOut> = jobs_subset.iter().filter(|j| j.units > 0).collect();
    let measured = distinct >= min_distinct_jobs;
    let why = if measured { None } else { Some(format!("{} distinct jobs < {} (PN3) — the cell is printed, the reading is UNMEASURED", distinct, min_distinct_jobs)) };
    json!({
        "jobs": jobs_subset.len(), "jobs_with_units": with_units.len(), "distinct_jobs": distinct, "measured": measured, "why": why,
        "units_per_job": distribution(&jobs_subset.iter().map(|j| j.units as f64).collect::<Vec<_>>()),
        "delivered_per_job": distribution(&with_units.iter().map(|j| j.delivered_units as f64).collect::<Vec<_>>()),
        "tokens_per_job": distribution(&with_units.iter().map(|j| j.tokens).collect::<Vec<_>>()),
        "minutes_per_job": distribution(&with_units.iter().map(|j| j.wall_minutes).collect::<Vec<_>>()),
        "time_on_target_share": distribution(&with_units.iter().filter_map(|j| j.time_on_target_share).collect::<Vec<_>>()),
    })
}

// ── the whole document ───────────────────────────────────────────────────────────────────────────────────────────
pub fn read_doc(jobs: &[JobRow], commits: &[CommitRow], tau: f64, min_distinct_jobs: usize) -> Value {
    let (units, tally) = assign_units(jobs, commits);
    let mut outs: Vec<JobOut> = Vec::with_capacity(jobs.len());
    for (ji, j) in jobs.iter().enumerate() {
        let rows: Vec<&CommitRow> = units[ji].iter().map(|&ci| &commits[ci]).collect();
        let agg = job_aggregates(&rows);
        let (tot_minutes, tot_share) = match j.window_end_ms {
            Some(we) => {
                let window_minutes = (we - j.ask_ms) as f64 / 60000.0;
                let t = time_on_target(&j.turn_rows, j.ask_ms, we, tau);
                let share = match t.minutes { Some(m) if window_minutes > 0.0 => Some(r3(m / window_minutes)), _ => None };
                (t.minutes, share)
            }
            None => (None, None),
        };
        outs.push(JobOut { tx_id: j.tx_id.clone(), room: j.room.clone(), lane: j.lane.clone(),
            units: agg.units, delivered_units: agg.delivered_units, tokens: agg.tokens, wall_minutes: agg.wall_minutes,
            time_on_target_share: tot_share });
        let _ = tot_minutes; // carried per-job below via the detailed listing
    }

    let mut lane_names: Vec<String> = outs.iter().filter_map(|j| j.lane.clone()).collect();
    lane_names.sort(); lane_names.dedup();
    let mut room_names: Vec<String> = outs.iter().filter_map(|j| j.room.clone()).collect();
    room_names.sort(); room_names.dedup();

    let mut by_lane = serde_json::Map::new();
    for lane in &lane_names {
        let subset: Vec<&JobOut> = outs.iter().filter(|j| j.lane.as_deref() == Some(lane.as_str())).collect();
        by_lane.insert(lane.clone(), cell_for(&subset, min_distinct_jobs));
    }
    let mut by_room = serde_json::Map::new();
    for room in &room_names {
        let subset: Vec<&JobOut> = outs.iter().filter(|j| j.room.as_deref() == Some(room.as_str())).collect();
        by_room.insert(room.clone(), cell_for(&subset, min_distinct_jobs));
    }

    let with_units: Vec<&JobOut> = outs.iter().filter(|j| j.units > 0).collect();
    let jobs_out: Vec<Value> = outs.iter().enumerate().map(|(ji, j)| {
        let src = &jobs[ji];
        json!({ "tx_id": j.tx_id, "room": j.room, "lane": j.lane, "units": j.units, "delivered_units": j.delivered_units,
                "tokens": fin(j.tokens).map(r3), "wall_minutes": j.wall_minutes,
                "time_on_target_share": j.time_on_target_share,
                "window_minutes": src.window_end_ms.map(|we| r3((we - src.ask_ms) as f64 / 60000.0)) })
    }).collect();

    json!({
        "engine": "rust-job-units-read", "tau_pct": tau, "min_distinct_jobs": min_distinct_jobs,
        "counts": { "jobs": jobs.len(), "commits": commits.len(), "matched": tally.matched,
                    "unmatched_no_room": tally.unmatched_no_room, "unmatched_no_window": tally.unmatched_no_window,
                    "overlap_commits": tally.overlap_commits, "jobs_with_units": with_units.len() },
        "units_per_job": distribution(&outs.iter().map(|j| j.units as f64).collect::<Vec<_>>()),
        "delivered_per_job": distribution(&with_units.iter().map(|j| j.delivered_units as f64).collect::<Vec<_>>()),
        "tokens_per_job": distribution(&with_units.iter().map(|j| j.tokens).collect::<Vec<_>>()),
        "minutes_per_job": distribution(&with_units.iter().map(|j| j.wall_minutes).collect::<Vec<_>>()),
        "time_on_target_share": distribution(&with_units.iter().filter_map(|j| j.time_on_target_share).collect::<Vec<_>>()),
        "by_lane": by_lane, "by_room": by_room,
        "jobs_out": jobs_out,
    })
}

// ── CLI + parsing ────────────────────────────────────────────────────────────────────────────────────────────────
fn parse_turn_rows(v: &Value) -> Vec<TurnRow> {
    v.as_array().map(|a| a.iter().filter_map(|r| {
        let t_ms = r["t"].as_i64().or_else(|| r["t"].as_f64().map(|f| f as i64))?;
        let off = r["off"].as_f64()?;
        Some(TurnRow { t_ms, off })
    }).collect()).unwrap_or_default()
}

fn parse_jobs(v: &Value) -> Vec<JobRow> {
    let mut out = Vec::new();
    for r in v.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let tx_id = match r["tx_id"].as_str() { Some(s) if !s.is_empty() => s.to_string(), _ => continue };
        let ask_ms = match r["ask_ts"].as_str().and_then(parse_iso_ms) { Some(t) => t, None => continue };
        let window_end_ms = r["window_end"].as_str().and_then(parse_iso_ms);
        let room = r["room"].as_str().map(|s| s.to_string());
        let lane = r["lane"].as_str().map(|s| s.to_string());
        let turn_rows = parse_turn_rows(&r["turn_rows"]);
        out.push(JobRow { tx_id, room, lane, ask_ms, window_end_ms, turn_rows });
    }
    out
}

fn parse_commits(v: &Value) -> Vec<CommitRow> {
    let mut out = Vec::new();
    for r in v.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let reff = match r["ref"].as_str() { Some(s) if !s.is_empty() => s.to_string(), _ => continue };
        let ts_ms = match r["ts"].as_str().and_then(parse_iso_ms) { Some(t) => t, None => continue };
        let room = r["room"].as_str().map(|s| s.to_string());
        let covenant_commit = r["covenant_commit"].as_i64().or_else(|| r["covenant_commit"].as_bool().map(|b| if b { 1 } else { 0 }));
        let tokens_in = r["tokens_in"].as_f64().unwrap_or(0.0);
        let tokens_out = r["tokens_out"].as_f64().unwrap_or(0.0);
        let wall_minutes = r["wall_minutes"].as_f64().unwrap_or(0.0);
        out.push(CommitRow { reff, room, ts_ms, covenant_commit, tokens_in, tokens_out, wall_minutes });
    }
    out
}

pub fn run(args: &[String]) {
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let tau: f64 = arg("--tau").and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_TAU_PCT);
    let min_distinct_jobs: usize = arg("--min-distinct-jobs").and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_MIN_DISTINCT_JOBS);
    let text = match arg("--path") {
        Some(path) => match std::fs::read_to_string(&path) { Ok(t) => t, Err(e) => { eprintln!("cannot read {}: {}", path, e); std::process::exit(2); } },
        None => { let mut s = String::new(); if std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).is_err() { eprintln!("--job-units-read: could not read stdin"); std::process::exit(2); } s }
    };
    let doc: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(e) => { eprintln!("bad JSON: {}", e); std::process::exit(2); } };
    let jobs = parse_jobs(&doc["jobs"]);
    let commits = parse_commits(&doc["commits"]);
    let out = read_doc(&jobs, &commits, tau, min_distinct_jobs);
    println!("{}", serde_json::to_string(&out).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_iso_ms_matches_known_epoch_values() {
        // ground truth from `node -e "console.log(Date.parse(...))"`, 2026-09-17
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-09-01T00:00:00.000Z"), Some(1788220800000));
        assert_eq!(parse_iso_ms("2026-09-01T02:00:00.000Z"), Some(1788228000000));
        assert_eq!(parse_iso_ms("2026-09-17T12:34:56.789Z"), Some(1789648496789));
        assert_eq!(parse_iso_ms("2000-02-29T00:00:00.000Z"), Some(951782400000));
        assert_eq!(parse_iso_ms("2026-01-01T00:00:00.000Z"), Some(1767225600000));
        assert_eq!(parse_iso_ms("not-a-date"), None);
        assert_eq!(parse_iso_ms("2026-09-01T00:00:00.000"), None); // missing Z
    }

    fn job(tx: &str, room: &str, ask: &str, end: Option<&str>) -> JobRow {
        JobRow { tx_id: tx.into(), room: Some(room.into()), lane: Some(room.into()), ask_ms: parse_iso_ms(ask).unwrap(),
                 window_end_ms: end.map(|e| parse_iso_ms(e).unwrap()), turn_rows: vec![] }
    }
    fn commit(r: &str, room: &str, ts: &str, cc: Option<i64>) -> CommitRow {
        CommitRow { reff: r.into(), room: Some(room.into()), ts_ms: parse_iso_ms(ts).unwrap(), covenant_commit: cc,
                    tokens_in: 100.0, tokens_out: 200.0, wall_minutes: 3.0 }
    }

    #[test]
    fn ju1_no_double_counting_and_earlier_ask_wins() {
        let jobs = vec![
            job("txA", "builder", "2026-09-01T00:00:00.000Z", Some("2026-09-01T05:00:00.000Z")),
            job("txB", "builder", "2026-09-01T01:00:00.000Z", Some("2026-09-01T05:00:00.000Z")),
        ];
        let commits = vec![commit("c1", "builder", "2026-09-01T02:00:00.000Z", Some(1))];
        let (units, tally) = assign_units(&jobs, &commits);
        assert_eq!(tally.overlap_commits, 1);
        assert_eq!(tally.matched, 1);
        assert_eq!(units[0], vec![0], "the EARLIER ask (txA) wins the overlapping commit");
        assert_eq!(units[1], Vec::<usize>::new(), "the later ask (txB) does not also get the commit");
    }

    #[test]
    fn ju2_null_vs_zero_time_on_target() {
        let empty = time_on_target(&[], 0, 3_600_000, 25.0);
        assert_eq!(empty.minutes, None, "zero turn rows in the window must read null, never 0");
        let rows = vec![TurnRow { t_ms: 0, off: 10.0 }, TurnRow { t_ms: 1_200_000, off: 90.0 }];
        let t = time_on_target(&rows, 0, 3_600_000, 25.0);
        assert_eq!(t.covered_minutes, 60.0);
        assert_eq!(t.minutes, Some(20.0));
    }
}
