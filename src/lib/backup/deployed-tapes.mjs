// src/lib/backup/deployed-tapes.mjs — C503 THE TWO TAPES AND THE SLIDER (operator 2026-09-30, verbatim: "seeing both your llm
// wrapper workloads visualised as tapes (and slidable scrolling through the panels to see the drift) for example - you know
// where your money went - that is what it is" · "we need tables and tapes" · "just make sure the payoff is correct").
//
// The data half of /backup/adherence's tapes. Two workloads, read off ONE backup archive (receive.mjs tapesFromArchive):
//   CODING   — the flight tape's commit/turn rows, through drift-reading.mjs's receiptOnly (the C456 allowlist).
//   DEPLOYED — every .thetacog/fleet-tape/<job>.ndjson row (the C496 robot fleet, the C504 LLM tape), through
//              deployedReceiptOnly below — an ALLOWLIST: the job, seq, ts, spec hash, the witnessed flag, what the card the
//              walk wrote says about WHERE it landed (its pixel address, the seed's null-test verdict, the COUNT of cells in
//              and out of the declared lane, σ), and the LLM metadata C504 puts on the tape row (model, cost_usd,
//              cost_source, label). The row's `action` text, the card's `cells` string and everything else stay home.
//
// THE LANE WORD of a deployed row (the three words, the same ones the CODING row reads):
//   UNMEASURED — no card, or the card's seed did not pass its null test (seed_fit.better_than_random !== true): a placement
//                the null does not admit is not a reading (walk-door.mjs: sensor 'metal' only when admissible).
//   off lane   — admissible, and the walk put MORE cells outside the declared lane than inside (out_of_role > in_role).
//   in lane    — admissible otherwise. The off-lane % shown beside it is the exact share, out / (in + out).
// Drift % is a CODING measure (the flight tape's landed delta); a fleet card carries no drift Δ, so it reads UNMEASURED.
//
// WHERE THE MONEY WENT: spend is summed ONLY over rows that carry a numeric cost_usd; a row with none is counted as
// UNMEASURED, never as $0. A total with no priced row behind it is UNMEASURED, never $0.00 (AXIOM 1).
//
// THE PANEL is the one Rust pipeline's published PNG — never a grid redrawn from a receipt's cells
// (tests/ops/no-lattice-proxy.test.mjs). A licence holder's panels live in THEIR repository, not on thetadriven.com
// (operator correction, C506): the backup names its panel home as `panels = { base, pattern, source, present: [sha10…] }`
// and panelSrc() below is the one rule that turns a commit into a src — base + pattern with {sha10} filled, ONLY for a sha
// listed in present. A sha not in present reads "no panel published at <base>"; no panels object at all reads UNMEASURED
// ("the backup names no panel home"). There is no fallback to our domain.
// C647b: a backup now CARRIES its panels (panels.carried, the PNGs inside the archive, stored beside it at upload) and panelSrc
// serves those from the backup store first (/api/backup/panel/<manifest>/<sha10>); a frame with no panel in a C647b archive
// names "panels k of n" and the command that publishes it (missingPanelWhy). @guard tests/vna/c647b-the-panel-travels-with-the-backup.test.mjs
//
// SUFFICIENT FOR: where each backed-up action landed, in time order across both workloads, and what the priced ones cost.
// NOT SUFFICIENT FOR: whether any action was good (Rice — undecidable, and not claimed here), or any spend the tape did not
// record. Port row: none — a projection and two folds over fields other modules decided (the card is the crate's output).
// C546 THE GAP IS LABELLED, NEVER LEFT TO WONDER (operator 2026-10-01: "An underwriter or client looking at that timeline
// ribbon shouldn't have to wonder: \"Did their recording server crash for 4 days?\""). MEASURED BEFORE THIS CHANGE: the
// slider's x was the merged ROW INDEX (TapeSlider xAt = i / (n − 1) over the time-sorted points) — a SEQUENCE axis, so four
// silent days drew as one tick step and nothing on the page said the time was missing. gapsOf() below finds every pause
// between consecutive merged rows longer than GAP_HOURS, labels it "no rows · <hours> h · <from> → <to>", and reports its
// cause as DATA: a dated commit log beside the tape (opts.commits, [{ sha, ts }]) is counted inside the window, and the
// commits the tape lacks read "<n> commits not on the tape"; with no dated log the cause is UNMEASURED with its reason (and
// the backup's panel home is counted for commits it lists that the tape lacks — undated, so never placed in a window).
// twoTapes() hangs each gap on the row it follows (point.gapAfter), so the slider reads it with no second fold.
// C560d WITNESS LAG, MEASURED BEFORE BATCHING (operator 2026-10-02: "Eliminate residual witness lag on asynchronous fleet jobs
// through optimized receipt batching."). witnessLagOf() below reads, per DEPLOYED row, received_at (the notary's stamp — a
// fleet row carries it only once a witness receipt is folded onto it; pg-ledger.mjs CHAIN_COLUMNS) minus the job's closed_at
// (the row's own closed_at when present, else its ts — the stamp the job writes as it closes and appends the row), and
// reports median with [min,max] in seconds. A row with no received_at is UNMEASURED, never a 0 lag; a received_at before its
// closed_at is clock skew, counted apart. Batching is a later row only if this measured lag earns it; nothing here claims
// the lag removed. SUFFICIENT FOR: how long the backed-up rows waited for their witness. NOT SUFFICIENT FOR: rows the tape
// never recorded, or whether any witnessed action was good (Rice).
// @guard tests/vna/c560d-witness-lag-measured.test.mjs
// @guard tests/site/c503-two-tapes-and-the-slider.test.mjs
// @guard tests/vna/c546-an-underwriter-or-client-looking-at.test.mjs
import { receiptOnly, wordOf, PIXEL, foldDeltas } from './drift-reading.mjs';

const UNMEASURED = 'UNMEASURED';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const JOB = /^[A-Za-z0-9._-]{1,64}$/;
const LABEL = /^[A-Za-z0-9._:-]{1,64}$/;
const MODEL = /^[A-Za-z0-9._:/@-]{1,80}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const shortStr = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
const TIME = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})$/;
const timeOf = (v) => (typeof v === 'string' && TIME.test(v) && Number.isFinite(Date.parse(v)) ? v : null);

// the card is the first line of the receipt string (the attestation rides on the next line — fleet-reading.mjs cardOf)
export const cardOf = (receipt) => { try { const c = JSON.parse(String(receipt).split('\n')[0]); return c && typeof c === 'object' ? c : null; } catch { return null; } };

/** the receipt fields of one deployed-tape row, tagged with its job — and nothing else */
export function deployedReceiptOnly(row, job) {
  const r = row && typeof row === 'object' ? row : {};
  const out = { job: shortStr(job, JOB) || shortStr(r.job, JOB) };
  if (num(r.seq) !== null) out.seq = r.seq;
  if (typeof r.ts === 'string') out.ts = r.ts;
  if (typeof r.spec_sha256 === 'string' && SHA256.test(r.spec_sha256)) out.spec_sha256 = r.spec_sha256;
  if (typeof r.witnessed === 'boolean') out.witnessed = r.witnessed;
  // C560d: the two times the witness lag is read from — the notary's received_at (on the row, or on a folded witness object) and an explicit closed_at
  const ra = timeOf(r.received_at) || (r.witness && typeof r.witness === 'object' ? timeOf(r.witness.received_at) : null); if (ra) out.received_at = ra;
  const ca = timeOf(r.closed_at); if (ca) out.closed_at = ca;
  // C521: the commit the wrapper ran at (llm-tape.mjs stamps job.commit) — its sha10 is the key to that call's encircled Δ panel
  const jc = r.job && typeof r.job === 'object' ? r.job.commit : r.commit;
  if (typeof jc === 'string' && /^[0-9a-f]{7,40}$/i.test(jc)) out.commit = jc.toLowerCase().slice(0, 10);
  const card = typeof r.receipt === 'string' && r.receipt ? cardOf(r.receipt) : null;
  out.receipted = !!card;
  if (card) {
    if (typeof card.pixel === 'string' && PIXEL.test(card.pixel)) out.pixel = card.pixel;
    const bt = card.seed_fit && typeof card.seed_fit.better_than_random === 'boolean' ? card.seed_fit.better_than_random : null;
    if (bt !== null) out.admissible = bt;
    if (Array.isArray(card.in_role)) out.in_n = card.in_role.length;
    if (Array.isArray(card.out_of_role)) out.out_n = card.out_of_role.length;
    if (num(card.sigma) !== null) out.sigma = card.sigma;
    // C521: the three numbers the wrapper ladder reads — the spec context carried (chars) and the corpus it stands in for (bytes); never the text
    if (card.intent_span && num(card.intent_span.chars) !== null) out.spec_chars = card.intent_span.chars;
    if (Array.isArray(card.attempts) && card.attempts[0] && num(card.attempts[0].mass) !== null) out.corpus_bytes = card.attempts[0].mass;
  }
  // C521: the input the wrapper actually sent, as a count — the prompt text itself never leaves
  if (typeof r.action === 'string') { const i = r.action.indexOf('--- prompt\n'); if (i >= 0) { const e = r.action.indexOf('\n--- completion', i); out.prompt_chars = (e < 0 ? r.action.length : e) - (i + '--- prompt\n'.length); } }
  // C504: on the LLM tape `job` is an OBJECT { name, kind, label, model, cost_usd, cost_source } — the metadata rides there;
  // on the fleet tapes `job` is a string and any metadata sits on the row. Read the object first, the row second.
  const j = r.job && typeof r.job === 'object' ? r.job : {};
  const pickOf = (k) => (j[k] !== undefined ? j[k] : r[k]);
  if (!out.job) out.job = shortStr(j.name, JOB);
  if (num(pickOf('cost_usd')) !== null) out.cost_usd = pickOf('cost_usd');
  const cs = shortStr(pickOf('cost_source'), LABEL); if (cs) out.cost_source = cs;
  const m = shortStr(pickOf('model'), MODEL); if (m) out.model = m;
  const l = shortStr(pickOf('label'), LABEL); if (l) out.label = l;
  const k = shortStr(j.kind, JOB); if (k) out.call_kind = k;
  return out;
}

/** a deployed row's three-word reading and its exact off-lane share (null when unmeasured) */
export function deployedWord(d) {
  if (!d || !d.receipted || d.admissible !== true) return { word: UNMEASURED, off: null };
  const inN = d.in_n ?? 0, outN = d.out_n ?? 0;
  if (inN + outN === 0) return { word: UNMEASURED, off: null };
  return { word: outN > inN ? 'off lane' : 'in lane', off: Math.round((1000 * outN) / (inN + outN)) / 10 };
}

/**
 * The one panel rule (C503/C506). panels = { base, pattern, source, present } from the backup manifest/receipt.
 * Returns { src, why }: src is base + pattern with {sha10} filled when the sha is in present; otherwise src is null and why
 * says which absence it is. base must be an https URL; pattern a relative path with no '..' — anything else is refused.
 */
export function panelSrc(sha, panels) {
  const sha10 = String(sha || '').toLowerCase().slice(0, 10);
  if (!panels || typeof panels !== 'object') return { src: null, why: 'UNMEASURED — the backup names no panel home' };
  // C647n: thetacog.panels.home = off — the holder turned panels off; the archive carries none and names no address, and the frame says so
  if (panels.home === 'off') return { src: null, why: typeof panels.why === 'string' && panels.why ? panels.why : 'panels off — thetacog.panels.home is "off"' };
  // C647b: a panel CARRIED inside the archive is served from the backup store, before any configured base is consulted
  const carried = Array.isArray(panels.carried) ? panels.carried.map((x) => String(x).toLowerCase()) : [];
  const manifest = typeof panels.manifest === 'string' && /^[0-9a-f]{64}$/.test(panels.manifest) ? panels.manifest : null;
  if (manifest && /^[0-9a-f]{10}$/.test(sha10) && carried.includes(sha10)) return { src: carriedPanelSrc(manifest, sha10), why: null };
  const counted = !!(panels.of && typeof panels.of === 'object');   // a C647b archive: a missing frame names k of n and the command
  // C647n: in `repo` mode the raw URL is an address ONLY when the visibility CHECK said public — a private repo's raw URL loads for nobody else
  if (panels.home === 'repo' && panels.visibility !== 'public') { const w = typeof panels.why === 'string' && panels.why ? panels.why : 'thetacog.panels.home is "repo", but the repository was not checked public — no raw URL is named'; return { src: null, why: counted ? `${missingPanelWhy(sha10, panels, null)} · ${w}` : w }; }
  const base = typeof panels.base === 'string' ? panels.base : '';
  const pattern = typeof panels.pattern === 'string' ? panels.pattern : '';
  if (!/^https:\/\/[^\s"'<>]+$/.test(base)) return { src: null, why: counted ? missingPanelWhy(sha10, panels, null) : 'UNMEASURED — the backup\'s panel home is not an https URL' };
  if (!pattern.includes('{sha10}') || /\.\.|^\/|:|[\s"'<>]/.test(pattern)) return { src: null, why: counted ? missingPanelWhy(sha10, panels, null) : 'UNMEASURED — the backup\'s panel pattern is not a relative path with {sha10}' };
  if (!/^[0-9a-f]{7,10}$/.test(sha10)) return { src: null, why: counted ? missingPanelWhy(sha10, panels, base) : `no panel published at ${base}` };
  const present = Array.isArray(panels.present) ? panels.present.map((x) => String(x).toLowerCase()) : [];
  // a legacy 9-hex panel dir names the same commit as its 10-hex sha — match either way, fill with the name that is present
  const hit = present.find((x) => /^[0-9a-f]{7,10}$/.test(x) && (x === sha10 || sha10.startsWith(x) || x.startsWith(sha10)));
  if (!hit) return { src: null, why: counted ? missingPanelWhy(sha10, panels, base) : `no panel published at ${base}` };
  return { src: base + pattern.split('{sha10}').join(hit), why: null };
}

/** C647b: the store route a carried panel is served from — relative, on the backup's own door, never a third party's host */
export const carriedPanelSrc = (manifest, sha10) => `/api/backup/panel/${manifest}/${sha10}`;
/** C647b: the command that publishes a missing commit's panel, then carries it in the next backup */
export const PUBLISH_PANEL = 'node scripts/pmu/commit-triptych.mjs --commit {sha10} --no-open --no-qwen, commit public/commit/{sha10}/, then node scripts/vna/backup.mjs --upload --tapes';
/**
 * C647b: what a frame with no panel says — how many of the tape's commits this backup shows a panel for (carried ∪ served at
 * the base), how many the repository holds, the carry cap, and the command that publishes this one. The base keeps its old
 * words ("no panel published at <base>") so a reader still sees where it looked; with no base, the backup is the only home.
 */
export function missingPanelWhy(sha10, panels, base) {
  const of = panels.of || {};
  const carried = Array.isArray(panels.carried) ? panels.carried : [];
  const present = Array.isArray(panels.present) ? panels.present : [];
  const shown = new Set([...carried, ...(base ? present.map((x) => String(x).slice(0, 10)) : [])]).size;
  const n = Number.isFinite(of.commits) ? of.commits : null;
  const k = n === null ? shown : Math.min(shown, n);
  const where = base ? `no panel published at ${base}, and none carried in this backup` : 'no panel carried in this backup';
  const repo = Number.isFinite(of.in_repo) ? ` · ${of.in_repo} in the repository` : '';
  const cap = Number.isFinite(of.cap_count) ? ` · the backup carries the newest ${of.carried ?? carried.length} (cap ${of.cap_count} panels / ${Math.round((of.cap_bytes || 0) / 1000)} KB)` : '';
  return `${where} for ${sha10 || 'this commit'} — panels ${k} of ${n ?? 'UNMEASURED'} tape commits${repo}${cap} · publish it: ${PUBLISH_PANEL.split('{sha10}').join(sha10 || '<sha10>')}`;
}
const wordWord = (w) => (w === 'in lane' || w === 'off lane' ? w : UNMEASURED);

/** C546: a pause between two consecutive merged rows longer than this is drawn as a labelled band, never as one tick step */
export const GAP_HOURS = 6;
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
const sha10Of = (s) => (typeof s === 'string' && /^[0-9a-f]{7,40}$/i.test(s) ? s.toLowerCase().slice(0, 10) : null);

/**
 * C546 THE GAPS. Every pause between consecutive time-ordered rows (both workloads merged) longer than `hours`.
 * Each gap: { from_i, to_i, from, to, hours, rows_in_window: 0, label, cause }. The cause is data, never a guess:
 *   commits = a dated commit log the backup carries beside the tape ([{ sha, ts }]) → MEASURED: the commits dated inside the
 *             window and how many of them no tape row carries ("<n> commits not on the tape"), or that the log is quiet too.
 *   no log  → UNMEASURED with its reason; when the backup's panel home lists commits the tape lacks, that count is named,
 *             undated, so it is never placed in this window.
 * @param {{ ts: string | null, sha10?: string | null }[]} points — time-ordered (twoTapes order)
 * @param {{ hours?: number, commits?: { sha?: string, ts?: string }[] | null, panels?: { present?: string[] } | null }} [opts]
 */
export function gapsOf(points, { hours = GAP_HOURS, commits = null, panels = null } = {}) {
  const pts = Array.isArray(points) ? points : [];
  const onTape = new Set(pts.map((p) => sha10Of(p && p.sha10)).filter(Boolean));
  const hasLog = Array.isArray(commits);
  const log = hasLog ? commits.map((c) => ({ sha10: sha10Of(c && c.sha), t: c && typeof c.ts === 'string' ? Date.parse(c.ts) : NaN })).filter((c) => c.sha10 && Number.isFinite(c.t)) : [];
  const present = panels && Array.isArray(panels.present) ? [...new Set(panels.present.map(sha10Of).filter(Boolean))] : null;
  const panelsOff = present ? present.filter((s) => ![...onTape].some((t) => t.startsWith(s) || s.startsWith(t))).length : null;
  const out = [];
  let prev = -1, prevT = NaN;
  pts.forEach((p, i) => {
    const t = p && typeof p.ts === 'string' ? Date.parse(p.ts) : NaN;
    if (!Number.isFinite(t)) return;
    if (prev >= 0 && t - prevT > hours * 3.6e6) {
      const h = Math.round(((t - prevT) / 3.6e6) * 10) / 10;
      const from = stamp(prevT), to = stamp(t);
      let cause;
      if (hasLog) {
        const inWin = log.filter((c) => c.t > prevT && c.t < t);
        const notOn = inWin.filter((c) => !onTape.has(c.sha10)).length;
        cause = { status: 'MEASURED', commits_in_window: inWin.length, not_on_tape: notOn,
          text: notOn ? `${notOn} commit${notOn === 1 ? '' : 's'} not on the tape`
            : inWin.length ? `${inWin.length} commit${inWin.length === 1 ? '' : 's'} in the window, every one on the tape`
            : 'the backup\'s commit log is quiet in this window too — 0 commits, 0 tape rows' };
      } else {
        cause = { status: UNMEASURED, commits_in_window: null, not_on_tape: null,
          text: `UNMEASURED — the backup carries no dated commit log beside the tape, so whether commits landed in this window is not read here${panelsOff ? `; its panel home lists ${panelsOff} published commit${panelsOff === 1 ? '' : 's'} not on the tape, undated, so not placed in this window` : ''}` };
      }
      out.push({ from_i: prev, to_i: i, from, to, hours: h, rows_in_window: 0, label: `no rows · ${h} h · ${from} → ${to}`, cause });
    }
    prev = i; prevT = t;
  });
  return out;
}

/** C560d: seconds, in words — "5 s", "4.2 min", "1.5 h" */
export const lagWords = (s) => (s === null || s === undefined ? UNMEASURED : Math.abs(s) < 120 ? `${Math.round(s * 10) / 10} s` : Math.abs(s) < 7200 ? `${Math.round(s / 6) / 10} min` : `${Math.round(s / 360) / 10} h`);
/**
 * C560d THE WITNESS LAG of the DEPLOYED rows: per row received_at − closed_at (closed_at, else ts), in seconds.
 * → { status, rows, lagged, unmeasured, skewed, median_s, min_s, max_s, label, why, per_row: [{ job, seq, lag_s }] }
 * MEASURED needs at least one row carrying both times with received_at ≥ closed_at; otherwise UNMEASURED with why, every number null.
 * @param {unknown[]} deployed — raw fleet/LLM rows or deployedReceiptOnly projections
 */
export function witnessLagOf(deployed) {
  const rows = (Array.isArray(deployed) ? deployed : []).map((raw) => (raw && typeof raw === 'object' && 'receipted' in raw ? raw : deployedReceiptOnly(raw, raw && raw.job)));
  const per_row = []; const lags = []; let skewed = 0, noClose = 0, noRecv = 0, witnessedFlag = 0;
  for (const d of rows) {
    if (d.witnessed === true) witnessedFlag++;
    const closed = d.closed_at || d.ts || null;
    const recv = d.received_at || null;
    let lag = null;
    if (!recv) noRecv++;
    else if (!closed || !Number.isFinite(Date.parse(closed))) noClose++;
    else {
      const s = (Date.parse(recv) - Date.parse(closed)) / 1000;
      if (s < 0) skewed++; else { lag = s; lags.push(s); }
    }
    per_row.push({ job: d.job || null, seq: d.seq ?? null, lag_s: lag });
  }
  const n = rows.length;
  const base = { rows: n, lagged: lags.length, unmeasured: n - lags.length, skewed, per_row, closed_source: 'the row\'s closed_at, else its ts (stamped as the job closes and appends the row)' };
  if (!lags.length) {
    const why = !n ? 'no deployed row on the tape — nothing waited for a witness'
      : `0 of ${n} deployed rows carry a received_at at or after their closed_at (${noRecv} carry no received_at, ${witnessedFlag} flagged witnessed${skewed ? `, ${skewed} received before closed (clock skew)` : ''}${noClose ? `, ${noClose} with no closed time` : ''}) — the notary's received_at lives on the witness ledger until a witness receipt is folded onto the row`;
    return { status: UNMEASURED, ...base, median_s: null, min_s: null, max_s: null, label: `witness lag UNMEASURED — ${why}`, why };
  }
  const v = [...lags].sort((a, b) => a - b); const m = v.length;
  const median = m % 2 ? v[(m - 1) / 2] : (v[m / 2 - 1] + v[m / 2]) / 2;
  const r = (x) => Math.round(x * 1000) / 1000;
  const label = `witness lag median ${lagWords(median)} [${lagWords(v[0])}, ${lagWords(v[m - 1])}] over ${m} of ${n} deployed rows${skewed ? ` · ${skewed} received before closed (clock skew), not counted` : ''}${n - m - skewed ? ` · ${n - m - skewed} UNMEASURED (no received_at)` : ''}`;
  return { status: 'MEASURED', ...base, median_s: r(median), min_s: r(v[0]), max_s: r(v[m - 1]), label, why: null };
}

/**
 * Both workloads as one time-ordered timeline, with one lane for CODING and one lane per deployed job.
 * `panels` is the backup's panel home ({ base, pattern, source, present }); see panelSrc.
 * @param {{ coding?: unknown[], deployed?: unknown[], panels?: { base: string, pattern: string, source?: string, present: string[] } | null, commits?: { sha?: string, ts?: string }[] | null, gapHours?: number }} [opts]
 */
export function twoTapes({ coding = [], deployed = [], panels = null, commits = null, gapHours = GAP_HOURS } = {}) {
  const pts = [];
  // C516: fold the newest `delta` row for a sha onto its commit row BEFORE projecting any one row — a delta row
  // itself carries no reading and never becomes a point on the slider.
  for (const raw of foldDeltas(coding)) {
    const r = receiptOnly(raw);
    const landed = r.delta && r.delta.status === 'landed';
    const sha10 = typeof r.sha === 'string' && /^[0-9a-f]{10,40}$/.test(r.sha) ? r.sha.slice(0, 10) : null;
    const isCommit = r.kind === 'commit' && sha10;
    const ps = isCommit ? panelSrc(sha10, panels) : null;
    const panel = ps ? ps.src : null;
    pts.push({
      domain: 'CODING', lane: 'CODING', seq: r.seq ?? null, ts: r.ts ?? null, kind: r.kind ?? null, sha10,
      word: wordWord(wordOf(r)),
      address: (r.placements && r.placements.find((p) => p.pixel) || {}).pixel || null,
      leaf: (r.placements && r.placements.find((p) => p.leaf) || {}).leaf || null,
      drift: landed ? num(r.delta.driftPct) : null,
      off: landed ? num(r.delta.offPct) : null,
      panel,
      panelWhy: panel ? null : isCommit ? ps.why : 'a turn row is placed by its walk, not a commit — no panel; the address below is the one the walk wrote',
      // C909: a commit whose attestation found no matching spec row (proofs.items empty) is UNMEASURED for a KNOWN cause —
      // the word stays UNMEASURED, but the one row carrying this flag reads UNPLACED — NO SPEC ROW DECLARED (tape-window.mjs rowWord)
      noSpecRow: !(r.proofs && Array.isArray(r.proofs.items) && r.proofs.items.length > 0),
      model: null, cost: null, costSource: null,
    });
  }
  for (const raw of Array.isArray(deployed) ? deployed : []) {
    const d = raw && typeof raw === 'object' && 'receipted' in raw ? raw : deployedReceiptOnly(raw, raw && raw.job);
    const w = deployedWord(d);
    pts.push({
      domain: 'DEPLOYED', lane: d.job || 'unnamed-job', seq: d.seq ?? null, ts: d.ts ?? null, kind: d.model || d.cost_usd !== undefined ? 'llm' : 'robot', sha10: null,
      word: w.word, address: d.pixel || null, leaf: d.label || null,
      drift: null, off: w.off,
      panel: null,
      panelWhy: d.receipted ? 'a deployed action is placed by its card, not a commit — no panel; the address below is the one the walk wrote' : 'this action has no receipt on the tape — nothing was placed',
      model: d.model || null, cost: num(d.cost_usd), costSource: d.cost_source || null,
      witnessLag: witnessLagOf([d]).median_s,   // C560d: this row's own lag (null = UNMEASURED)
    });
  }
  // time order across both workloads; a row with no timestamp goes last, ties by domain then seq
  pts.sort((a, b) => ((a.ts === null) - (b.ts === null)) || String(a.ts || '').localeCompare(String(b.ts || '')) || a.domain.localeCompare(b.domain) || a.lane.localeCompare(b.lane) || (a.seq ?? 0) - (b.seq ?? 0));
  let usd = 0, priced = 0;
  pts.forEach((p, i) => {
    p.i = i;
    if (p.cost !== null) { usd += p.cost; priced++; }
    p.spendToHere = priced ? Math.round(usd * 1e6) / 1e6 : null;
    p.pricedToHere = priced;
  });
  const lanes = [{ name: 'CODING', domain: 'CODING', idx: [] }];
  const byJob = new Map();
  for (const p of pts) {
    if (p.domain === 'CODING') lanes[0].idx.push(p.i);
    else { if (!byJob.has(p.lane)) byJob.set(p.lane, { name: p.lane, domain: 'DEPLOYED', idx: [] }); byJob.get(p.lane).idx.push(p.i); }
  }
  lanes.push(...[...byJob.values()].sort((a, b) => a.name.localeCompare(b.name)));
  const byLane = lanes.map((l) => {
    const priced = l.idx.map((i) => pts[i]).filter((p) => p.cost !== null);
    return { lane: l.name, domain: l.domain, rows: l.idx.length, priced: priced.length, usd: priced.length ? Math.round(priced.reduce((s, p) => s + p.cost, 0) * 1e6) / 1e6 : null };
  });
  const spend = { usd: priced ? Math.round(usd * 1e6) / 1e6 : null, priced, unpriced: pts.length - priced, byLane };
  // C546: every pause longer than gapHours, hung on the row it follows — the slider draws the band and its cause from it
  const gaps = gapsOf(pts, { hours: gapHours, commits, panels });
  for (const p of pts) p.gapAfter = null;
  for (const g of gaps) pts[g.from_i].gapAfter = g;
  // C560d: the witness lag over the DEPLOYED rows, median with [min,max] — the tape strip prints it
  const witnessLag = witnessLagOf(Array.isArray(deployed) ? deployed : []);
  return { status: pts.length ? 'read' : UNMEASURED, n: pts.length, points: pts, lanes, spend, gaps, witnessLag };
}

/**
 * The DEPLOYED half of the adherence table when no notary query key is presented: per spec_sha256, off the holder's OWN
 * backed-up deployed tape — labelled as such (source 'holder-tape', not witnessed). Same field shape as
 * adherence-by-domain.mjs's deployedForSpec; every empty field UNMEASURED with its reason, never 0.
 */
/** @param {unknown[]} deployed */
export function deployedBySpecFromTape(deployed) {
  const un = (why) => ({ status: UNMEASURED, value: null, why });
  const ok = (value, extra = {}) => ({ status: 'MEASURED', value, ...extra });
  const bySpec = new Map();
  for (const raw of Array.isArray(deployed) ? deployed : []) {
    const d = raw && 'receipted' in raw ? raw : deployedReceiptOnly(raw, raw && raw.job);
    if (!d.spec_sha256) continue;
    if (!bySpec.has(d.spec_sha256)) bySpec.set(d.spec_sha256, []);
    bySpec.get(d.spec_sha256).push(d);
  }
  const out = new Map();
  for (const [hash, rows] of bySpec) {
    const judged = rows.filter((d) => d.receipted && typeof d.admissible === 'boolean');
    const admitted = judged.filter((d) => d.admissible);
    let inN = 0, outN = 0; for (const d of admitted) { inN += d.in_n ?? 0; outN += d.out_n ?? 0; }
    // W5: a missing seq in a job's monotonic sequence is itself a countable displacement
    let gaps = 0; const byJob = new Map();
    for (const d of rows) if (num(d.seq) !== null) { if (!byJob.has(d.job)) byJob.set(d.job, new Set()); byJob.get(d.job).add(d.seq); }
    for (const seqs of byJob.values()) { const s = [...seqs]; gaps += Math.max(...s) - Math.min(...s) + 1 - s.length; }
    let last = null; for (const d of rows) if (d.ts && (last === null || d.ts > last)) last = d.ts;
    const jobs = [...new Set(rows.map((d) => d.job).filter(Boolean))].sort();
    out.set(hash, {
      hash, label: jobs.join(' · ') || null, source: 'holder-tape',
      actions: ok(rows.length),
      admissible: judged.length ? ok(admitted.length / judged.length, { admitted: admitted.length, of: judged.length }) : un('no receipted card under this spec carries the seed\'s null-test verdict'),
      off_lane: !admitted.length ? un('no admissible action to place against the lane') : inN + outN === 0 ? un('the admissible cards walked no cells') : ok(outN / (inN + outN), { out_of_role: outN, walked: inN + outN }),
      gaps: byJob.size ? ok(gaps) : un('no row under this spec carries a seq'),
      broken: un('a link check needs the IntentGuard chain() over the receipts — read on the notary ledger (C495a), not on this page'),
      witness_lag: un('your own tape is not witnessed — witness lag is read on the notary ledger'),
      last_seen: last ? ok(last) : un('no row under this spec carries a timestamp'),
    });
  }
  return out;
}

export const HOLDER_TAPE_LABEL = 'DEPLOYED · your own tape, not witnessed';
