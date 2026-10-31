// src/fleet.rs — THE FLEET RECEIPT (C831): many rooms, one tape, one line.
//
// Operator (2026-10-14, the measurement inversion): "fleet=1000 · unison=1.000 · drift_events=0 · kE_total=0.000 ·
// root_hash=9b4f2a17". The rooms that landed commits since a sha are read as a FLEET: each room is an agent, each
// commit-reality row on the walk tape is one step of that agent, and c_i is the boundary-crossing count the odometer
// (odometer.rs) landed with on that row's walk. Nothing here walks, places or talks to a model: it READS the record the
// rooms did not write for this purpose (AXIOM 1 W3 — the tape), and folds integers.
//
// THE LINE.  fleet=<N> · unison=<U> · drift_events=<Σc> · kE_total=<tally> · root_hash=<sha8> · coherence=<A>/<A+Σc>=<r>
//            · steps=<M> · T=<T> · unmeasured=<k>/<M>
//   N  distinct rooms in the window (an agent each; a row with no room is the agent "none")
//   T  the longest agent's step count
//   U  = 1 − Σc/(N·T), an EXACT rational (odometer::Ratio) rendered to three places by integer division — floor, as
//      fleet_bench.rs floors its unison, so the two never disagree in the third place
//   Σc the drift events: the crossing counts summed over the measured rows; kE_total = 3·Σc milli-units (odometer::tally_string)
//   A  aligned: Σ(steps_i − c_i), the followed steps that crossed nothing; coherence = A/(A+Σc) is the fleet-wide form of
//      rule 20's ratio c/steps (the-ratchet-invariants.md), exact, rendered to three places
//   root_hash sha256 over the rows' refs in tape order, first eight hex digits
// A row that carries no `crossings` is UNMEASURED. When any row in the window is, unison / drift_events / kE_total /
// coherence print UNMEASURED and `unmeasured=k/M` says how many: a number folded over part of the fleet and labelled
// unison would be the misleading empty artifact CLAUDE.md forbids a generator to emit. The partial sums stay in the JSON.
//
// THE WINDOW.  `--since <sha>` is a commit. By default the window is the TAPE'S OWN ORDER: every commit-reality row newer
// than the newest row whose ref names <sha> (git's `since..HEAD` exclusion). With `--repo <dir>` the window is GIT'S:
// `git rev-list <sha>..HEAD`, rows selected by ref ∈ that set, and `gap` counts the commits in the set that have no row
// (a hole in a monotonic sequence is itself countable, AXIOM 1 W5). A non-hex <sha> (HEAD~5) is resolved by git in
// `--repo` or the cwd. Either way the tape is read FROM ITS END, in 1 MiB chunks, never past FLEET_TAPE_CAP bytes
// (hud.rs's HEALTH_TAPE_CAP idiom — the operator's tape is 1.6 GB, fc1283a76e), and stops at the since row.
//
// SUFFICIENT FOR: how many rooms landed how many steps since <sha>, and how often their walks crossed their declared
// fences, exactly, from the rows as written. NOT SUFFICIENT FOR: whether any of those commits was good (Rice), or whether
// the rooms agreed about anything beyond their fences.
//
// Guards: tests/vna/c831-build-the-fleet-receipt-in-the.test.mjs (tests/pmu-simulator/fleet-receipt.test.mjs re-exports it):
// the exact line on tests/fixtures/fleet/walk-tape.ndjson, the UNMEASURED shape, and the live tape's shape.

use crate::odometer::{tally_string, Ratio, K_E_MILLI};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Never read past this many bytes from the tape's end (hud.rs HEALTH_TAPE_CAP, restated so the two caps agree).
pub const FLEET_TAPE_CAP: u64 = 64 << 20;
/// A run of bytes with no newline past this is not a row; dropping it keeps the read linear in the cap (hud.rs HEALTH_LINE_MAX).
pub const FLEET_LINE_MAX: usize = 4 << 20;
/// The tape row source the fleet reads: the walk over the commit's body, never the intent row.
pub const SOURCE: &str = "commit-reality";

/// One step of one agent: a commit-reality row. `c`/`steps` are the odometer's integers; `None` is UNMEASURED.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Step {
    pub sha: String,
    pub room: String,
    pub c: Option<u32>,
    pub steps: Option<u32>,
}

/// One agent: a room and how many steps it landed in the window.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Agent { pub room: String, pub steps: u32 }

/// The receipt. Every number is an integer or an exact rational; the three-place strings are built by integer division.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Fleet {
    pub since: String,
    /// "tape" (rows newer than the since row) or "git" (rows whose ref is in rev-list since..HEAD)
    pub window: &'static str,
    /// N: distinct rooms
    pub fleet: usize,
    /// M: steps (rows) in the window
    pub rows: usize,
    /// T: the longest agent's step count
    pub t: u32,
    pub measured: usize,
    pub unmeasured: usize,
    /// git window only: commits in since..HEAD with no commit-reality row on the tape
    pub gap: Option<usize>,
    /// Σc over the measured rows
    pub drift_events: u32,
    /// Σ(steps_i − c_i) over the measured rows
    pub aligned: u32,
    pub k_e_milli: u32,
    pub k_e_total: String,
    /// |N·T − Σc| / (N·T); `unison_negative` carries the sign when Σc > N·T (a walk can cross more than once per step)
    pub unison: Ratio,
    pub unison_negative: bool,
    pub unison_3: String,
    /// A / (A + Σc)
    pub coherence: Ratio,
    pub coherence_3: String,
    pub root_hash: String,
    pub agents: Vec<Agent>,
    pub steps_detail: Vec<Step>,
    pub line: String,
    pub why: Option<String>,
}

/// num/den to three places by integer division (floor), "-" prefixed when `neg`. den = 0 reads UNMEASURED.
pub fn three_places(num: u64, den: u64, neg: bool) -> String {
    if den == 0 { return "UNMEASURED".into(); }
    let milli = num * 1000 / den;
    format!("{}{}.{:03}", if neg && milli > 0 { "-" } else { "" }, milli / 1000, milli % 1000)
}

/// sha256 over the refs joined by '\n', first eight hex digits.
pub fn root_hash(shas: &[String]) -> String {
    let mut h = Sha256::new();
    h.update(shas.join("\n").as_bytes());
    let d = h.finalize();
    d.iter().take(4).map(|b| format!("{:02x}", b)).collect()
}

fn ratio(num: u64, den: u64) -> Ratio { Ratio { num: num.min(u32::MAX as u64) as u32, den: den.min(u32::MAX as u64) as u32 } }

/// Fold the steps into the receipt. Pure: no IO, so a fixture and the live tape reach the same arithmetic.
pub fn receipt(since: &str, window: &'static str, steps: Vec<Step>, gap: Option<usize>, why: Option<String>) -> Fleet {
    let mut per_room: BTreeMap<String, u32> = BTreeMap::new();
    for s in &steps { *per_room.entry(s.room.clone()).or_insert(0) += 1; }
    let agents: Vec<Agent> = per_room.iter().map(|(room, n)| Agent { room: room.clone(), steps: *n }).collect();
    let fleet = agents.len();
    let t = agents.iter().map(|a| a.steps).max().unwrap_or(0);
    let rows = steps.len();
    let measured = steps.iter().filter(|s| s.c.is_some() && s.steps.is_some()).count();
    let unmeasured = rows - measured;
    let drift_events: u32 = steps.iter().filter_map(|s| s.c).sum();
    let aligned: u32 = steps.iter().filter_map(|s| match (s.steps, s.c) { (Some(st), Some(c)) => Some(st.saturating_sub(c)), _ => None }).sum();
    let k_e_milli = K_E_MILLI * drift_events;
    let nt = fleet as u64 * t as u64;
    let (unison_negative, unum) = if (drift_events as u64) > nt { (true, drift_events as u64 - nt) } else { (false, nt - drift_events as u64) };
    let unison = ratio(unum, nt);
    let coherence = ratio(aligned as u64, aligned as u64 + drift_events as u64);
    let shas: Vec<String> = steps.iter().map(|s| s.sha.clone()).collect();
    let root = if rows == 0 { "UNMEASURED".to_string() } else { root_hash(&shas) };
    let all_measured = rows > 0 && unmeasured == 0;
    let unison_3 = three_places(unum, nt, unison_negative);
    let coherence_3 = three_places(aligned as u64, aligned as u64 + drift_events as u64, false);
    let line = if all_measured {
        format!("fleet={} · unison={} · drift_events={} · kE_total={} · root_hash={} · coherence={}/{}={} · steps={} · T={} · unmeasured=0/{}",
            fleet, unison_3, drift_events, tally_string(k_e_milli), root, aligned, aligned as u64 + drift_events as u64, coherence_3, rows, t, rows)
    } else {
        let mut l = format!("fleet={} · unison=UNMEASURED · drift_events=UNMEASURED · kE_total=UNMEASURED · root_hash={} · coherence=UNMEASURED · steps={} · T={} · unmeasured={}/{}",
            fleet, root, rows, t, unmeasured, rows);
        if let Some(g) = gap { l.push_str(&format!(" · gap={}", g)); }
        if let Some(w) = &why { l.push_str(&format!(" · why={}", w)); }
        else if rows > 0 { l.push_str(" · why=rows carrying no crossings (walked before the odometer, or by a binary without it)"); }
        l
    };
    let line = if all_measured { match gap { Some(g) if g > 0 => format!("{} · gap={}", line, g), _ => line } } else { line };
    Fleet {
        since: since.to_string(), window, fleet, rows, t, measured, unmeasured, gap, drift_events, aligned, k_e_milli,
        k_e_total: tally_string(k_e_milli), unison, unison_negative, unison_3, coherence, coherence_3, root_hash: root,
        agents, steps_detail: steps, line, why,
    }
}

/// The shorter of two shas is a prefix of the longer, and at least seven characters long.
pub fn same_commit(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim().to_ascii_lowercase(), b.trim().to_ascii_lowercase());
    let n = a.len().min(b.len());
    n >= 7 && a[..n] == b[..n]
}

/// A commit-reality row → a Step, or None when the row is not one (a stranger's line, another source, no ref).
pub fn step_of_row(v: &serde_json::Value) -> Option<Step> {
    if v.get("source").and_then(|s| s.as_str()) != Some(SOURCE) { return None; }
    let sha = v.get("ref").and_then(|r| r.as_str())?.to_string();
    let room = v.get("room").and_then(|r| r.as_str()).map(|s| s.to_string()).unwrap_or_else(|| "none".to_string());
    let cr = v.get("crossings");
    let c = cr.and_then(|c| c.get("c")).and_then(|c| c.as_u64()).map(|c| c.min(u32::MAX as u64) as u32);
    let steps = cr.and_then(|c| c.get("steps")).and_then(|c| c.as_u64()).map(|c| c.min(u32::MAX as u64) as u32);
    Some(Step { sha, room, c, steps })
}

#[cfg(not(portable_walker))]
pub use read::{read_tape, run_cli, window_steps};

/// The fs/process side: the bounded tail read and the CLI arm. Gated like walk_lens — the portable walker places, it
/// does not read a filesystem or spawn git.
#[cfg(not(portable_walker))]
mod read {
    use super::*;
    use std::collections::HashSet;
    use std::io::{Read, Seek, SeekFrom};
    use std::path::{Path, PathBuf};

    /// Every commit-reality row within `cap` bytes of the tape's end, NEWEST FIRST, read backwards in 1 MiB chunks and
    /// stopping at the first row that names `since` (that row is returned last, flagged by the bool). Rows older than the
    /// cap are not rows: the caller sees `anchor = false` and reads UNMEASURED rather than a silent partial.
    pub fn read_tape(p: &Path, since: &str, cap: u64) -> (Vec<Step>, bool) {
        let mut out = Vec::new();
        let mut f = match std::fs::File::open(p) { Ok(f) => f, Err(_) => return (out, false) };
        let len = match f.metadata() { Ok(m) => m.len(), Err(_) => return (out, false) };
        let floor = len.saturating_sub(cap);
        let needle = format!("\"{}\"", SOURCE);
        let (mut end, mut carry) = (len, Vec::<u8>::new());
        while end > floor {
            let start = end.saturating_sub(1 << 20).max(floor);
            let mut buf = vec![0u8; (end - start) as usize];
            if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() { return (out, false); }
            buf.extend_from_slice(&carry);
            let mut parts: Vec<&[u8]> = buf.split(|b| *b == b'\n').collect();
            let head = if start > 0 { parts.remove(0).to_vec() } else { Vec::new() };   // a line cut by the chunk edge waits for the next chunk
            for l in parts.iter().rev() {
                if l.is_empty() || !l.windows(needle.len()).any(|w| w == needle.as_bytes()) { continue; }
                let v = match serde_json::from_slice::<serde_json::Value>(l) { Ok(v) => v, Err(_) => continue };
                if let Some(s) = step_of_row(&v) {
                    let anchor = same_commit(&s.sha, since);
                    out.push(s);
                    if anchor { return (out, true); }
                }
            }
            carry = if head.len() > FLEET_LINE_MAX { Vec::new() } else { head };
            end = start;
        }
        (out, false)
    }

    /// The window's steps in TAPE ORDER (oldest first), one per commit (a re-walk's newer row replaces the older one).
    /// `commits = None` → the tape's order: rows newer than the since row. `Some(set)` → rows whose ref is in the set.
    pub fn window_steps(newest_first: Vec<Step>, anchored: bool, since: &str, commits: Option<&HashSet<String>>) -> Vec<Step> {
        let mut seen: Vec<String> = Vec::new();
        let mut picked: Vec<Step> = Vec::new();
        for s in newest_first {
            if same_commit(&s.sha, since) { continue; }
            if seen.iter().any(|x| same_commit(x, &s.sha)) { continue; }
            let keep = match commits { Some(set) => set.iter().any(|c| same_commit(c, &s.sha)), None => anchored };
            seen.push(s.sha.clone());
            if keep { picked.push(s); }
        }
        picked.reverse();
        picked
    }

    fn git(repo: &Path, args: &[&str]) -> Option<String> {
        let o = std::process::Command::new("git").arg("-C").arg(repo).args(args).output().ok()?;
        if !o.status.success() { return None; }
        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
    }

    fn is_hex_sha(s: &str) -> bool { s.len() >= 7 && s.chars().all(|c| c.is_ascii_hexdigit()) }

    /// `--fleet --since <sha> [--tape <path>] [--repo <dir>] [--json]` → the line, or the receipt as JSON.
    pub fn run_cli(args: &[String]) -> String {
        let val = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
        let json = args.iter().any(|a| a == "--json");
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let repo = val("--repo").map(PathBuf::from);
        let git_dir = repo.clone().unwrap_or_else(|| cwd.clone());
        let tape: PathBuf = val("--tape").map(PathBuf::from)
            .or_else(|| std::env::var("PMU_WALK_TAPE").ok().filter(|p| !p.is_empty()).map(PathBuf::from))
            .unwrap_or_else(|| git_dir.join(".thetacog/walk-tape.ndjson"));
        let since_arg = match val("--since") { Some(s) => s, None => {
            let f = receipt("", "tape", Vec::new(), None, Some("--fleet requires --since <sha>".into()));
            return if json { serde_json::to_string(&f).unwrap_or_default() } else { f.line };
        } };
        let since = if is_hex_sha(&since_arg) { Some(since_arg.to_ascii_lowercase()) } else { git(&git_dir, &["rev-parse", "--short=10", &since_arg]) };
        let since = match since { Some(s) => s, None => {
            let f = receipt(&since_arg, "tape", Vec::new(), None, Some(format!("since {:?} is not a sha and git in {} did not resolve it", since_arg, git_dir.display())));
            return if json { serde_json::to_string(&f).unwrap_or_default() } else { f.line };
        } };
        // first-parent: the fleet is the rooms on THIS tree; a merge brings another tree's steps in as one commit, never as that
        // fleet's rows (2026-10-14: a merge of main made HEAD~5..HEAD forty commits and the gap read 40)
        let commits: Option<HashSet<String>> = repo.as_ref().and_then(|r| git(r, &["rev-list", "--first-parent", "--abbrev-commit", "--abbrev=10", &format!("{}..HEAD", since)]))
            .map(|o| o.lines().map(|l| l.trim().to_ascii_lowercase()).filter(|l| !l.is_empty()).collect());
        let window: &'static str = if commits.is_some() { "git" } else { "tape" };
        let (newest_first, anchored) = read_tape(&tape, &since, FLEET_TAPE_CAP);
        let steps = window_steps(newest_first, anchored, &since, commits.as_ref());
        let gap = commits.as_ref().map(|set| set.iter().filter(|c| !steps.iter().any(|s| same_commit(&s.sha, c))).count());
        let why = if steps.is_empty() {
            Some(match (anchored, window) {
                (false, "tape") => format!("no {} row names since {} within the last {} MiB of {}", SOURCE, since, FLEET_TAPE_CAP >> 20, tape.display()),
                (_, "git") => format!("none of the {} commits in {}..HEAD has a {} row within the last {} MiB of {}", gap.unwrap_or(0), since, SOURCE, FLEET_TAPE_CAP >> 20, tape.display()),
                _ => format!("no {} row newer than since {} on {}", SOURCE, since, tape.display()),
            })
        } else { None };
        let f = receipt(&since, window, steps, gap, why);
        if json { serde_json::to_string(&f).unwrap_or_default() } else { f.line }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(sha: &str, room: &str, c: Option<u32>, steps: Option<u32>) -> Step { Step { sha: sha.into(), room: room.into(), c, steps } }

    #[test]
    fn the_operators_line_reads_unison_one_when_nothing_crossed() {
        let steps: Vec<Step> = (0..6).map(|i| s(&format!("{:010x}", 0xa0 + i), ["architect", "voice", "laboratory"][i % 3], Some(0), Some(10))).collect();
        let f = receipt("deadbeef00", "tape", steps, None, None);
        assert_eq!((f.fleet, f.t, f.rows, f.drift_events), (3, 2, 6, 0));
        assert_eq!(f.unison, Ratio { num: 6, den: 6 });
        assert_eq!(f.unison_3, "1.000");
        assert_eq!(f.k_e_total, "0.000");
        assert_eq!(f.coherence, Ratio { num: 60, den: 60 });
        assert!(f.line.starts_with("fleet=3 · unison=1.000 · drift_events=0 · kE_total=0.000 · root_hash="), "{}", f.line);
        assert!(f.line.contains(" · coherence=60/60=1.000 · steps=6 · T=2 · unmeasured=0/6"), "{}", f.line);
        assert_eq!(f.root_hash.len(), 8);
    }

    #[test]
    fn unison_is_the_exact_rational_floored_and_coherence_is_rule_twenty_fleet_wide() {
        // architect 3 steps, voice 2, laboratory 1 → N=3, T=3, N·T=9; c = 0,1,0 · 0,2 · 0 → Σc=3 → U = 6/9 → 0.666 (floor)
        let steps = vec![
            s("1111111111", "architect", Some(0), Some(10)), s("2222222222", "voice", Some(0), Some(10)),
            s("3333333333", "architect", Some(1), Some(10)), s("4444444444", "voice", Some(2), Some(10)),
            s("5555555555", "architect", Some(0), Some(10)), s("6666666666", "laboratory", Some(0), Some(10)),
        ];
        let f = receipt("0000000000", "tape", steps, None, None);
        assert_eq!(f.unison, Ratio { num: 6, den: 9 });
        assert_eq!(f.unison_3, "0.666");
        assert_eq!((f.drift_events, f.k_e_milli, f.k_e_total.as_str()), (3, 9, "0.009"));
        assert_eq!(f.coherence, Ratio { num: 57, den: 60 });
        assert_eq!(f.coherence_3, "0.950");
        assert_eq!(f.agents, vec![Agent { room: "architect".into(), steps: 3 }, Agent { room: "laboratory".into(), steps: 1 }, Agent { room: "voice".into(), steps: 2 }]);
        assert_eq!(three_places(1, 3, false), "0.333");
        assert_eq!(three_places(2, 3, false), "0.666");
        assert_eq!(three_places(0, 0, false), "UNMEASURED");
        assert_eq!(three_places(1, 2, true), "-0.500");
    }

    #[test]
    fn one_unmeasured_row_makes_the_line_say_so_and_the_partial_sums_stay_in_the_json() {
        let steps = vec![s("1111111111", "architect", Some(2), Some(10)), s("2222222222", "voice", None, None)];
        let f = receipt("0000000000", "tape", steps, Some(1), None);
        assert_eq!((f.measured, f.unmeasured, f.drift_events), (1, 1, 2));
        assert!(f.line.starts_with("fleet=2 · unison=UNMEASURED · drift_events=UNMEASURED · kE_total=UNMEASURED · root_hash="), "{}", f.line);
        assert!(f.line.contains("unmeasured=1/2 · gap=1 · why=rows carrying no crossings"), "{}", f.line);
        let empty = receipt("0000000000", "git", Vec::new(), Some(5), Some("none".into()));
        assert_eq!(empty.line, "fleet=0 · unison=UNMEASURED · drift_events=UNMEASURED · kE_total=UNMEASURED · root_hash=UNMEASURED · coherence=UNMEASURED · steps=0 · T=0 · unmeasured=0/0 · gap=5 · why=none");
    }

    #[test]
    fn a_walk_crossing_more_than_once_per_step_drives_unison_below_zero_and_the_sign_is_kept() {
        let f = receipt("0000000000", "tape", vec![s("1111111111", "a", Some(5), Some(8))], None, None);
        assert!(f.unison_negative);
        assert_eq!(f.unison, Ratio { num: 4, den: 1 });
        assert_eq!(f.unison_3, "-4.000");
        assert_eq!(f.coherence, Ratio { num: 3, den: 8 });
    }

    #[test]
    fn a_row_is_a_step_only_when_it_is_a_commit_reality_row_with_a_ref() {
        let row = serde_json::json!({ "source": "commit-reality", "ref": "abcdef1234", "room": "voice", "crossings": { "c": 2, "steps": 9 } });
        assert_eq!(step_of_row(&row), Some(s("abcdef1234", "voice", Some(2), Some(9))));
        let no_room = serde_json::json!({ "source": "commit-reality", "ref": "abcdef1234" });
        assert_eq!(step_of_row(&no_room), Some(s("abcdef1234", "none", None, None)));
        assert_eq!(step_of_row(&serde_json::json!({ "source": "commit-intent", "ref": "abcdef1234" })), None);
        assert_eq!(step_of_row(&serde_json::json!({ "source": "commit-reality" })), None);
        assert!(same_commit("abcdef1234", "abcdef1"));
        assert!(!same_commit("abcdef", "abcdef"));   // six characters is not a sha
        assert!(!same_commit("abcdef1234", "abcdef1235"));
        assert_eq!(root_hash(&["a".into(), "b".into()]), root_hash(&["a".into(), "b".into()]));
        assert_ne!(root_hash(&["a".into(), "b".into()]), root_hash(&["b".into(), "a".into()]), "order is part of the hash");
    }

    #[cfg(not(portable_walker))]
    #[test]
    fn the_tape_is_read_from_its_end_bounded_and_stops_at_the_since_row() {
        let dir = std::env::temp_dir().join(format!("fleet-tape-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("tape.ndjson");
        let row = |sha: &str, room: &str, c: u32| format!("{{\"source\":\"commit-reality\",\"ref\":\"{}\",\"room\":\"{}\",\"crossings\":{{\"c\":{},\"steps\":10}}}}", sha, room, c);
        let mut lines = vec![
            row("0000000000", "architect", 7),                           // older than since: excluded
            row("aaaaaaaa00", "architect", 0),                           // the since row itself: excluded
            "{\"source\":\"commit-intent\",\"ref\":\"1111111111\",\"room\":\"architect\"}".to_string(),   // the intent row: never a step
            row("1111111111", "architect", 0),
            "not json at all".to_string(),
            row("2222222222", "voice", 1),
            row("1111111111", "architect", 0),                           // a re-walk of the same commit: one step, the newer row
        ];
        std::fs::write(&p, lines.join("\n") + "\n").unwrap();
        let (newest_first, anchored) = read_tape(&p, "aaaaaaaa", FLEET_TAPE_CAP);
        assert!(anchored);
        assert_eq!(newest_first.len(), 4, "the read stops at the since row and never sees 0000000000");
        let steps = window_steps(newest_first, anchored, "aaaaaaaa00", None);
        assert_eq!(steps.iter().map(|s| s.sha.as_str()).collect::<Vec<_>>(), vec!["2222222222", "1111111111"]);
        // a since row past the cap is UNMEASURED, never a partial: cap the read to the last two rows' bytes
        let tail_bytes = (lines[5].len() + lines[6].len() + 2) as u64;
        let (rows, anchored) = read_tape(&p, "aaaaaaaa", tail_bytes);
        assert!(!anchored);
        assert_eq!(window_steps(rows, anchored, "aaaaaaaa", None).len(), 0);
        // the git window selects by ref and ignores the anchor
        let set: std::collections::HashSet<String> = ["2222222222".to_string()].into_iter().collect();
        let (rows, anchored) = read_tape(&p, "aaaaaaaa", FLEET_TAPE_CAP);
        let steps = window_steps(rows, anchored, "aaaaaaaa", Some(&set));
        assert_eq!(steps.iter().map(|s| s.sha.as_str()).collect::<Vec<_>>(), vec!["2222222222"]);
        // an absent tape reads nothing, not a panic
        assert_eq!(read_tape(&dir.join("absent"), "aaaaaaaa", FLEET_TAPE_CAP), (Vec::new(), false));
        lines.clear();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
