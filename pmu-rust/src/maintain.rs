// maintain.rs — THE MAINTENANCE SWEEP, ON THE METAL.
//
// Phase A of the maintenance ratchet is a pure function of two things: the tape, and the panels
// we shipped. Both were being read in JavaScript — a 6.5 MB line scan and a PNG decode through an
// out-of-tree image library. Neither has any business being there. The tape scan is an integer
// aggregation over millions of bytes, and the panel check is a decode of a file THIS CRATE WROTE.
//
// THE SYMMETRY THAT MATTERS: png.rs encodes; nothing decoded. So the one component that paints a
// panel could not read one back, and "did the panel render" had to be answered by a different
// engine than the one that rendered it. That is the same-pipeline defect in miniature — an answer
// produced by a second implementation is an answer about the second implementation. A decoder
// here closes it: the thing that paints is the thing that checks, on the same bytes, in the same
// binary, with the same zlib.
//
// Rayon parallelises both sweeps across cores — the same work-stealing pool the walkers use.
//
// UNSUPPORTED IS NOT DARK. A PNG variant this decoder does not handle returns UNREADABLE with the
// reason, never a darkness verdict. Guessing would manufacture exactly the false defect the panel
// audit exists to catch.
//
//   pmu-onchip --maintain-tape   --path .thetacog/walk-tape.ndjson [--days 21] [--hours 48]
//   pmu-onchip --maintain-panels --dir public/commit --dir public/blog/post-panels [--limit 12]
use rayon::prelude::*;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(|s| s.as_str())
}
fn flags<'a>(args: &'a [String], name: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    for (i, a) in args.iter().enumerate() { if a == name { if let Some(v) = args.get(i + 1) { out.push(v.as_str()); } } }
    out
}
fn num(args: &[String], name: &str, d: usize) -> usize { flag(args, name).and_then(|s| s.parse().ok()).unwrap_or(d) }

// ── field reads that do not build a JSON tree ───────────────────────────────────────────────────
// The tape is 5,852 rows and growing; parsing each into a map to read three fields is the kind of
// cost that makes a sweep "too slow to run every ten prompts", which is how a maintenance loop
// dies. These are byte scans over the raw line.
fn str_field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{}\":\"", key);
    let i = line.find(&pat)? + pat.len();
    let rest = &line[i..];
    let j = rest.find('"')?;
    Some(&rest[..j])
}
fn bool_true(line: &str, key: &str) -> bool {
    let pat = format!("\"{}\":true", key);
    line.contains(&pat)
}

#[derive(Default, Clone, Copy)]
struct Bucket { turns: u64, adm: u64 }

pub fn run_tape(args: &[String]) {
    let path = match flag(args, "--path") { Some(p) => p, None => { eprintln!("--maintain-tape requires --path"); std::process::exit(2); } };
    let days_keep = num(args, "--days", 21);
    let hours_keep = num(args, "--hours", 48);
    let body = match fs::read_to_string(path) { Ok(b) => b, Err(e) => { println!("{{\"error\":\"{}\"}}", e); return; } };
    let lines: Vec<&str> = body.lines().filter(|l| !l.is_empty()).collect();

    // Map phase in parallel, reduce into ordered maps. A row whose source is a commit projection is
    // not a turn and never counts toward grip — that distinction is the whole meaning of the rate.
    let partial: Vec<(String, String, bool, bool)> = lines.par_iter().map(|l| {
        let src = str_field(l, "source").unwrap_or("");
        let is_commit = src == "commit-reality" || src == "commit-intent" || src == "commit-null";
        let ts = str_field(l, "ts").unwrap_or("");
        (ts.to_string(), src.to_string(), is_commit, bool_true(l, "admissible"))
    }).collect();

    let mut by_day: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut by_hour: BTreeMap<String, Bucket> = BTreeMap::new();
    let (mut rows, mut turns, mut admissible) = (0u64, 0u64, 0u64);
    for (ts, _src, is_commit, adm) in &partial {
        rows += 1;
        if *is_commit { continue; }
        turns += 1;
        if *adm { admissible += 1; }
        if ts.len() >= 13 {
            let d = by_day.entry(ts[..10].to_string()).or_default();
            d.turns += 1; if *adm { d.adm += 1; }
            let h = by_hour.entry(ts[..13].to_string()).or_default();
            h.turns += 1; if *adm { h.adm += 1; }
        }
    }
    let rate = |b: &Bucket| if b.turns > 0 { b.adm as f64 / b.turns as f64 } else { 0.0 };
    let days: Vec<(String, Bucket)> = by_day.into_iter().collect();
    let days = &days[days.len().saturating_sub(days_keep)..];
    let hours: Vec<(String, Bucket)> = by_hour.into_iter().collect();
    let hours = &hours[hours.len().saturating_sub(hours_keep)..];

    // ── THE DERIVED MEASURES, all on the metal beside the counts they come from ──────────────────
    // AREA UNDER THE CURVE, trapezoid, in rate-days. Not a peak and not a mean: the integral is
    // the only summary that answers "how much grip did we actually hold across the window".
    let mut auc = 0.0f64;
    for i in 1..days.len() { auc += (rate(&days[i].1) + rate(&days[i - 1].1)) / 2.0; }
    // The same integral over the trailing week only — a long window hides a recent turn, and the
    // operator asked for cumulative AND relative. This is the relative one, in the same units.
    let w0 = days.len().saturating_sub(7);
    let mut auc7 = 0.0f64;
    for i in (w0 + 1)..days.len() { auc7 += (rate(&days[i].1) + rate(&days[i - 1].1)) / 2.0; }

    // VELOCITY: ordinary least-squares slope of the daily rate over the trailing window, in
    // rate-per-day. A rate that is high because of one good day and a rate that is climbing are
    // different facts, and only the slope separates them. Reported with its n so a 2-point slope
    // can never be read as a trend.
    let vwin: Vec<f64> = days[days.len().saturating_sub(7)..].iter().map(|(_, b)| rate(b)).collect();
    let vn = vwin.len();
    let velocity = if vn >= 2 {
        let mx = (vn as f64 - 1.0) / 2.0;
        let my = vwin.iter().sum::<f64>() / vn as f64;
        let (mut num, mut den) = (0.0f64, 0.0f64);
        for (i, y) in vwin.iter().enumerate() { let dx = i as f64 - mx; num += dx * (y - my); den += dx * dx; }
        if den > 0.0 { num / den } else { 0.0 }
    } else { 0.0 };

    // RELATIVE RETURN: the most recent day against the mean of the days before it. Above 1.0 the
    // instrument is holding more grip than its own recent history, which is the ratchet's whole
    // question asked at one-day resolution. UNDEFINED (-1) with fewer than two days, never 0.
    let relative = if days.len() >= 2 {
        let last = rate(&days[days.len() - 1].1);
        let prior: f64 = days[..days.len() - 1].iter().map(|(_, b)| rate(b)).sum::<f64>() / (days.len() - 1) as f64;
        if prior > 0.0 { last / prior } else { -1.0 }
    } else { -1.0 };

    // The last day is often a partial day with few turns; a 70% rate on 11 turns is not a 70% day.
    // Carrying n beside every rate is what stops the graph from lying by omission.
    let last_n = days.last().map(|(_, b)| b.turns).unwrap_or(0);

    let j_days: Vec<String> = days.iter().map(|(d, b)| format!("{{\"day\":\"{}\",\"turns\":{},\"adm\":{},\"rate\":{:.4}}}", d, b.turns, b.adm, rate(b))).collect();
    let j_hours: Vec<String> = hours.iter().map(|(h, b)| format!("{{\"hour\":\"{}\",\"turns\":{},\"adm\":{},\"rate\":{:.4}}}", h, b.turns, b.adm, rate(b))).collect();
    println!(
        "{{\"engine\":\"rust\",\"rows\":{},\"turns\":{},\"admissible\":{},\"overall_rate\":{:.4},\"auc_rate_days\":{:.4},\"auc_7d\":{:.4},\"velocity_per_day\":{:.5},\"velocity_n\":{},\"relative_last_vs_prior\":{:.4},\"last_day_turns\":{},\"days\":[{}],\"hours\":[{}]}}",
        rows, turns, admissible,
        if turns > 0 { admissible as f64 / turns as f64 } else { 0.0 },
        auc, auc7, velocity, vn, relative, last_n, j_days.join(","), j_hours.join(",")
    );
}

// ── the decoder png.rs never had ────────────────────────────────────────────────────────────────
struct Decoded { w: usize, h: usize, rgba: Vec<u8> }

fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut d = flate2::read::ZlibDecoder::new(data);
    d.read_to_end(&mut out).ok()?;
    Some(out)
}

fn paeth(a: i32, b: i32, c: i32) -> i32 {
    let p = a + b - c;
    let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
    if pa <= pb && pa <= pc { a } else if pb <= pc { b } else { c }
}

fn decode_png(bytes: &[u8]) -> Result<Decoded, String> {
    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" { return Err("not a png".into()); }
    let (mut i, mut w, mut h, mut depth, mut color, mut interlace) = (8usize, 0usize, 0usize, 0u8, 0u8, 0u8);
    let mut idat: Vec<u8> = Vec::new();
    while i + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
        let typ = &bytes[i + 4..i + 8];
        let data_start = i + 8;
        let data_end = data_start.checked_add(len).ok_or("bad chunk length")?;
        if data_end > bytes.len() { return Err("truncated chunk".into()); }
        match typ {
            b"IHDR" => {
                if len < 13 { return Err("short IHDR".into()); }
                let d = &bytes[data_start..data_end];
                w = u32::from_be_bytes([d[0], d[1], d[2], d[3]]) as usize;
                h = u32::from_be_bytes([d[4], d[5], d[6], d[7]]) as usize;
                depth = d[8]; color = d[9]; interlace = d[12];
            }
            b"IDAT" => idat.extend_from_slice(&bytes[data_start..data_end]),
            b"IEND" => break,
            _ => {}
        }
        i = data_end + 4; // + CRC
    }
    if w == 0 || h == 0 { return Err("no IHDR".into()); }
    if depth != 8 { return Err(format!("unsupported bit depth {}", depth)); }
    if interlace != 0 { return Err("interlaced png unsupported".into()); }
    let ch: usize = match color { 2 => 3, 6 => 4, 0 => 1, 4 => 2, _ => return Err(format!("unsupported colour type {}", color)) };
    let raw = inflate(&idat).ok_or("inflate failed")?;
    let stride = w * ch;
    if raw.len() < (stride + 1) * h { return Err("short idat".into()); }
    let mut prev = vec![0u8; stride];
    let mut cur = vec![0u8; stride];
    let mut rgba = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        let off = y * (stride + 1);
        let ft = raw[off];
        cur.copy_from_slice(&raw[off + 1..off + 1 + stride]);
        for x in 0..stride {
            let a = if x >= ch { cur[x - ch] as i32 } else { 0 };
            let b = prev[x] as i32;
            let c = if x >= ch { prev[x - ch] as i32 } else { 0 };
            let v = cur[x] as i32;
            cur[x] = (match ft { 0 => v, 1 => v + a, 2 => v + b, 3 => v + (a + b) / 2, 4 => v + paeth(a, b, c), _ => v } & 0xff) as u8;
        }
        for x in 0..w {
            let p = x * ch;
            let (r, g, bb, aa) = match ch {
                4 => (cur[p], cur[p + 1], cur[p + 2], cur[p + 3]),
                3 => (cur[p], cur[p + 1], cur[p + 2], 255),
                2 => (cur[p], cur[p], cur[p], cur[p + 1]),
                _ => (cur[p], cur[p], cur[p], 255),
            };
            rgba.extend_from_slice(&[r, g, bb, aa]);
        }
        prev.copy_from_slice(&cur);
    }
    Ok(Decoded { w, h, rgba })
}

fn newest_pngs(dir: &Path, limit: usize) -> Vec<PathBuf> {
    let mut kids: Vec<(std::time::SystemTime, PathBuf)> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).filter(|e| e.path().is_dir())
            .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| (t, e.path()))).collect(),
        Err(_) => return Vec::new(),
    };
    kids.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = Vec::new();
    for (_, k) in kids.into_iter().take(limit) {
        if let Ok(rd) = fs::read_dir(&k) {
            for e in rd.filter_map(|e| e.ok()) {
                let p = e.path();
                if p.extension().map(|x| x == "png").unwrap_or(false) { out.push(p); }
                if out.len() > limit * 2 { break; }
            }
        }
    }
    out
}

pub fn run_panels(args: &[String]) {
    let dirs = flags(args, "--dir");
    let limit = num(args, "--limit", 12);
    // The floor is a measured property of a real panel, not a taste: an encircled panel that
    // rendered has rings, a grid and text on it. Below 2% lit it is not a sparse panel, it is a
    // refusal that was saved as an image.
    let dark_floor: f64 = flag(args, "--dark-floor").and_then(|s| s.parse().ok()).unwrap_or(0.02);
    let mut files: Vec<PathBuf> = Vec::new();
    for d in &dirs { files.extend(newest_pngs(Path::new(d), limit)); }

    let results: Vec<String> = files.par_iter().map(|p| {
        let path = p.to_string_lossy().to_string();
        let bytes = match fs::read(p) { Ok(b) => b, Err(e) => return format!("{{\"panel\":\"{}\",\"verdict\":\"UNREADABLE\",\"why\":\"{}\"}}", path, e) };
        if bytes.len() < 2000 {
            return format!("{{\"panel\":\"{}\",\"verdict\":\"TRUNCATED\",\"why\":\"{} bytes\",\"bytes\":{}}}", path, bytes.len(), bytes.len());
        }
        match decode_png(&bytes) {
            Err(e) => format!("{{\"panel\":\"{}\",\"verdict\":\"UNREADABLE\",\"why\":\"{}\",\"bytes\":{}}}", path, e, bytes.len()),
            Ok(d) => {
                let px = d.w * d.h;
                let lit = d.rgba.chunks_exact(4).filter(|c| (c[0] as u32 + c[1] as u32 + c[2] as u32) > 96 && c[3] > 16).count();
                let frac = if px > 0 { lit as f64 / px as f64 } else { 0.0 };
                let verdict = if frac < dark_floor { "DARK" } else { "LIT" };
                format!("{{\"panel\":\"{}\",\"verdict\":\"{}\",\"why\":\"lit fraction {:.4}\",\"lit_fraction\":{:.4},\"w\":{},\"h\":{},\"bytes\":{}}}", path, verdict, frac, frac, d.w, d.h, bytes.len())
            }
        }
    }).collect();
    println!("{{\"engine\":\"rust\",\"checked\":{},\"dark_floor\":{:.4},\"panels\":[{}]}}", results.len(), dark_floor, results.join(","));
}

// ── THE P1 MOMENT DETECTOR ───────────────────────────────────────────────────────────────────────
// Operator, 2026-09-16: "when the worm hypothesis starts eating through the problem space and
// sequentially backwards in time through the context … that's what we call a P equals one moment —
// we know where the local maximum is, and if it exceeds the threshold that's actually grounded
// reality. We need a way to know if that's happening."
//
// IT IS NOT A CLAIM OF CERTAINTY, AND THE NAME MUST NOT BECOME ONE. The operator's own prior
// correction stands, verbatim, in WormWalk.txt: "it does not get to p=1 necessarily". A P1 MOMENT
// is an EVENT with two decidable halves, not a probability:
//   (1) THE WALK SETTLED — the trajectory's last `tail` rungs all land on one pixel after having
//       moved earlier in the run. The backward sniff stopped finding better ground: a local
//       maximum, found by search rather than by starting there.
//   (2) IT CLEARED THE THRESHOLD — the row is admissible, i.e. the winner beat its own permutation
//       null. That is the "grounded reality" half, and it is the half that already exists.
//
// A row that settles WITHOUT admitting is a FALSE SUMMIT: the walk converged on ground that cannot
// beat a shuffle. Counting those separately is the whole value of the detector — a convergence rate
// reported without its false-summit rate is a walk congratulating itself.
//
// Read off rows the tape already carries (`trajectory`, `admissible`, `ratchet.worms.rings`). No new
// instrument, no new door: if this needed a new measurement it would be a new claim.
pub fn run_p1(args: &[String]) {
    let path = match flag(args, "--path") { Some(p) => p, None => { eprintln!("--maintain-p1 requires --path"); std::process::exit(2); } };
    let tail = num(args, "--tail", 3);
    let body = match fs::read_to_string(path) { Ok(b) => b, Err(e) => { println!("{{\"error\":\"{}\"}}", e); return; } };
    let lines: Vec<&str> = body.lines().filter(|l| l.contains("\"trajectory\"")).collect();

    #[derive(Default)]
    struct Acc { rows: u64, searched: u64, settled: u64, p1: u64, false_summit: u64, admitted_unsettled: u64, moves: u64 }
    let parts: Vec<(bool, bool, bool, u64)> = lines.par_iter().filter_map(|l| {
        // the trajectory is a flat array of pixel strings, one per rung
        let i = l.find("\"trajectory\":[")? + "\"trajectory\":[".len();
        let rest = &l[i..];
        let j = rest.find(']')?;
        let inner = &rest[..j];
        if inner.trim().is_empty() { return None; }
        let traj: Vec<&str> = inner.split(',').map(|s| s.trim().trim_matches('"')).filter(|s| !s.is_empty()).collect();
        if traj.len() < tail + 1 { return None; }
        let adm = bool_true(l, "admissible");
        // moved at all? a walk that never left its first cell did not SEARCH, and a fixed point it
        // never travelled to is not a maximum it found.
        let moves = traj.windows(2).filter(|w| w[0] != w[1]).count() as u64;
        let searched = moves > 0;
        // settled: the last `tail` rungs agree
        let last = traj[traj.len() - 1];
        let settled = traj[traj.len() - tail..].iter().all(|p| *p == last);
        Some((searched, settled, adm, moves))
    }).collect();

    let mut a = Acc::default();
    for (searched, settled, adm, moves) in &parts {
        a.rows += 1; a.moves += moves;
        if *searched { a.searched += 1; }
        if *searched && *settled {
            a.settled += 1;
            if *adm { a.p1 += 1; } else { a.false_summit += 1; }
        } else if *adm { a.admitted_unsettled += 1; }
    }
    let r = |x: u64, d: u64| if d > 0 { x as f64 / d as f64 } else { 0.0 };
    println!(
        "{{\"engine\":\"rust\",\"tail\":{},\"rows\":{},\"searched\":{},\"settled\":{},\"p1_moments\":{},\"false_summits\":{},\"admitted_unsettled\":{},\
\"settle_rate_of_searched\":{:.4},\"p1_rate_of_settled\":{:.4},\"p1_rate_of_searched\":{:.4},\"false_summit_rate\":{:.4},\"mean_moves_per_walk\":{:.3}}}",
        tail, a.rows, a.searched, a.settled, a.p1, a.false_summit, a.admitted_unsettled,
        r(a.settled, a.searched), r(a.p1, a.settled), r(a.p1, a.searched), r(a.false_summit, a.settled),
        if a.rows > 0 { a.moves as f64 / a.rows as f64 } else { 0.0 }
    );
}

// ── THE RING-LATCH CONSTRUCT — the P1 question asked of the thing it is actually about ──────────
// §5.12 reported 0 P1 moments off a PROXY (the per-rung winning pixel stopped changing) and said
// the construct was UNMEASURED because the rung sequence mixes stage rungs with worm rings. The
// construct data turned out to be on the tape already: every rung in `attempts[]` carries its own
// `grip`, `ok` and `pixel`, and worm rings are labelled `wormK@CELL:rN`. No new field was needed.
//
// THE RING LATCH, as the running code defines it (lens.rs): a walker stops when a ring latches AND
// the wider ring does not raise grip. So the construct is "grip rose across rings, then stopped" —
// an interior maximum in the RING dimension, which is what "we know where the local maximum is"
// means when the worm eats backwards through the context.
//
// WHAT THIS MEASURES THAT THE PROXY COULD NOT: whether grip varies across rings AT ALL. If grip is
// flat in the ring dimension, the stopping criterion is blind by construction and no amount of
// searching can produce an interior maximum — the zero would be a property of the objective, not of
// the walks. That is a question about the SEARCH, and it is the one the proxy could never ask.
pub fn run_ringlatch(args: &[String]) {
    let path = match flag(args, "--path") { Some(p) => p, None => { eprintln!("--maintain-ringlatch requires --path"); std::process::exit(2); } };
    let body = match fs::read_to_string(path) { Ok(b) => b, Err(e) => { println!("{{\"error\":\"{}\"}}", e); return; } };
    let lines: Vec<&str> = body.lines().filter(|l| l.contains("worm")).collect();

    // one row → (walkers, flat, varying, moved, interior_max, row_admissible, row_has_interior_max)
    let per: Vec<(u64, u64, u64, u64, u64, bool, bool)> = lines.par_iter().map(|l| {
        let adm = bool_true(l, "admissible");
        // Walk the attempts array as text: each entry is a flat object, so the fields between one
        // "label":"wormK@...:rN" and the next closing brace belong to that ring.
        let mut rings: Vec<(String, u32, f64, bool, String)> = Vec::new();
        let mut cur = 0usize;
        while let Some(i) = l[cur..].find("\"label\": \"worm").or_else(|| l[cur..].find("\"label\":\"worm")) {
            let label_at = cur + i;
            // THE OBJECT, NOT THE TAIL OF IT. Row JSON is emitted with keys in ALPHABETICAL order,
            // so `grip` sits BEFORE `label` inside the same object. Slicing forward from the label
            // silently missed every grip value and the detector returned a confident zero — the
            // exact token-for-construct failure this file exists to catch, committed inside the
            // detector built to catch it. Walk back to the object's own `{` first.
            let start = l[..label_at].rfind('{').unwrap_or(label_at);
            let end = l[label_at..].find('}').map(|e| label_at + e).unwrap_or(l.len());
            let seg = &l[start..end];
            let label = str_field(seg, "label").unwrap_or("").to_string();
            // wormK@CELL:rN → walker key is everything before ":r"
            let (walker, r) = match label.rfind(":r") {
                Some(p) => (label[..p].to_string(), label[p + 2..].parse::<u32>().unwrap_or(0)),
                None => { cur = end + 1; continue; }
            };
            // grip is a bare number; find it in this segment
            let grip = seg.find("\"grip\":").and_then(|gi| {
                let rest = &seg[gi + 7..];
                let t: String = rest.chars().skip_while(|c| c.is_whitespace()).take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == 'e').collect();
                t.parse::<f64>().ok()
            });
            let ok = seg.contains("\"ok\": true") || seg.contains("\"ok\":true");
            let pixel = str_field(seg, "pixel").unwrap_or("").to_string();
            if let Some(g) = grip { rings.push((walker, r, g, ok, pixel)); }
            cur = end + 1;
        }
        if rings.is_empty() { return (0, 0, 0, 0, 0, adm, false); }
        // group by walker
        let mut keys: Vec<String> = rings.iter().map(|x| x.0.clone()).collect();
        keys.sort(); keys.dedup();
        let (mut flat, mut varying, mut moved, mut interior) = (0u64, 0u64, 0u64, 0u64);
        for k in &keys {
            let mut v: Vec<&(String, u32, f64, bool, String)> = rings.iter().filter(|x| &x.0 == k).collect();
            v.sort_by_key(|x| x.1);
            if v.len() < 2 { continue; }
            let gs: Vec<f64> = v.iter().map(|x| x.2).collect();
            let (mn, mx) = gs.iter().fold((f64::MAX, f64::MIN), |(a, b), g| (a.min(*g), b.max(*g)));
            if mx - mn < 1e-9 { flat += 1; } else { varying += 1; }
            let mut px: Vec<&str> = v.iter().map(|x| x.4.as_str()).collect();
            px.sort(); px.dedup();
            if px.len() > 1 { moved += 1; }
            // interior maximum: grip strictly rose, then did not continue rising
            let rose = gs.windows(2).any(|w| w[1] > w[0] + 1e-12);
            let stopped = gs.windows(2).any(|w| w[1] <= w[0] + 1e-12);
            if rose && stopped { interior += 1; }
        }
        (keys.len() as u64, flat, varying, moved, interior, adm, interior > 0)
    }).collect();

    let (mut rows, mut walkers, mut flat, mut varying, mut moved, mut interior, mut p1, mut interior_rows) = (0u64, 0u64, 0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
    for (w, f, v, m, i, adm, has) in &per {
        if *w == 0 { continue; }
        rows += 1; walkers += w; flat += f; varying += v; moved += m; interior += i;
        if *has { interior_rows += 1; if *adm { p1 += 1; } }
    }
    let r = |x: u64, d: u64| if d > 0 { x as f64 / d as f64 } else { 0.0 };
    println!(
        "{{\"engine\":\"rust\",\"rows\":{},\"walkers\":{},\"flat_grip_walkers\":{},\"varying_grip_walkers\":{},\
\"walkers_whose_pixel_moved\":{},\"interior_max_walkers\":{},\"rows_with_interior_max\":{},\"p1_moments\":{},\
\"flat_rate\":{:.4},\"varying_equals_moved\":{},\"interior_max_rate\":{:.4},\"p1_rate_of_interior_rows\":{:.4}}}",
        rows, walkers, flat, varying, moved, interior, interior_rows, p1,
        r(flat, walkers), varying == moved, r(interior, walkers), r(p1, interior_rows)
    );
}
