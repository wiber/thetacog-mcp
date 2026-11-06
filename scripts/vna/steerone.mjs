#!/usr/bin/env node
// C596 /STEERONE — GRIP ONE ROW, ANSWER FOR A WALK. LLM-free. Composes what already runs; rebuilds nothing:
//   the walk        lensWalk()            src/lib/pmu/walk-door.mjs   (the one Rust walk, its null test on the row)
//   the name        fullName()            scripts/vna/mesh.mjs        (the full ShortLex name of a coordinate)
//   the hat         hatName()             scripts/pmu/shortlex-names.mjs (e.g. Tactician×Gridkeeper)
//   the rows        classifySpec()        scripts/vna/spec-clarity.mjs (CLEAR / NEEDS-OPERATOR / YOUR-ACT / WAITING)
//   the nearness    orderByWalk()         scripts/vna/spec-clarity.mjs (Chebyshev on the block grid — the runner's own order,
//                                         here with the FOCUS as the origin instead of the last commit)
//   the snowball    seedSpecFirst()       scripts/vna/spec-tree.mjs   (the basin nearest the focus in its slot)
//                   retroGrow()/retroLiveFlag() scripts/vna/retro-snowball.mjs (only while the bench flag reads on)
//   the regressed   regressedTicks()      scripts/vna/steer-until.mjs (the asked-vs-built --run receipt; ticked rows whose guard was red)
//   the last dictation  `${SNOWBALL_SIDECAR}.prompt.txt` — the file the steer hook writes every operator prompt into
//                   (hook-doors.mjs dispatchSnowballRefresh). Canonical: it is the hook's own copy of the last prompt ≥12 chars.
//
// THE ORDER (what this adds to orderByWalk). NO FOCUS WORDS: regressed ticks first, globally (a red guard under a tick is a
// correction, never a new build), then CLEAR rows by nearness to the dictation's placement, then snowball, then recency of
// the operator span; rows that need the operator rank after every CLEAR row. WITH FOCUS WORDS (C596b): nearness to the focus
// comes first — the rows within STALE_D of the admitted walk, or, when the walk does not admit it, the rows whose own text
// matches the focus (verbatim under NCD_MIN_CHARS, NCD under τ_attach above) — and regressed rows lead only INSIDE that
// neighbourhood. A focus that reaches no row is NO ROW + EVIDENCE, never an unrelated regressed row. With no focus and no
// admitted walk, the order is the labelled FALLBACK (regressed first, then span recency) and the landing reads UNMEASURED.
//
// SUFFICIENT FOR: which open row sits nearest the focus on the lattice, by the walk the runner already trusts.
// NOT SUFFICIENT FOR: whether that row is the right thing to build (undecidable) — the skill's answer and the operator's
// spoken reply decide that, and the reply goes through /steer.
//
// SEAMS (for the hermetic guard): VNA_SPEC_MD · VNA_SPEC_TREE · VNA_ASKED_VS_BUILT · VNA_SNOWBALL_SIDECAR (read by the
// imported modules) · VNA_STEERONE_WALK=<json file> stands in for the walk row · VNA_STEERONE_NO_RETRO=1 skips the grow ·
// VNA_STEERONE_TRANSCRIPTS=<dir of session .jsonl> stands in for ~/.claude/projects/<slug> (C596c) ·
// VNA_STEERONE_GOALS_DIR / VNA_STEERONE_WORK feed the C596a evidence (transcript lines · placed commits) ·
// VNA_ISO_RECEIPT stands in for C226's receipt (C604, scripts/vna/iso-reading.mjs).
//
// C596d THE CRUX RANK (leads every order above, LLM-free): score = REACH × LEGIBILITY. REACH = the OTHER open or regressed
// rows whose text cites the candidate — row ids parsed out of each row's text and matched EXACTLY (C31 inside C317 is not
// C317, C317a is not C317), the row's own id excluded, ticked rows never counted — or that name its guard path verbatim.
// LEGIBILITY = 1 when a deciding reading runs now (a guard read red/green by asked-vs-built --run, or a known reading
// script's receipt: READERS), 0.5 when only a guard sits on disk unread, 0.25 when nothing reads it (UNMEASURED). Rows of
// equal score keep the order below (so with nothing cited anywhere, regressed-first still holds). Measured 2026-10-03: plain
// regressed-first picked C590 (a caption, cited by 0 open rows) over C317 (cited by 10 of 166).
//
// MAXIMISE RUST: this DECIDES (a pick), so its port row is C596r — the ranking moves into the crate once it is in use.
import { readFileSync, existsSync, readdirSync, statSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySpec, parseRows, orderByWalk, headlineOf, namedPaths, guardOf, SPEC_MD, CLEAR, NEEDS, ACT, WAITING } from './spec-clarity.mjs';
import { blockOf, cheb, loadTree, worked } from './envelope.mjs';
import { TREE, seedSpecFirst, ncd, NCD_MIN_CHARS, thresholds } from './spec-tree.mjs';
import { retroGrow, retroLiveFlag } from './retro-snowball.mjs';
import { regressedTicks, ASKED_VS_BUILT } from './steer-until.mjs';
import { SNOWBALL_SIDECAR } from './hook-doors.mjs';
import { fullName } from './mesh.mjs';
import { cleanAsk, projectDir, newestSession } from './transcript-asks.mjs';
import { hatName } from '../pmu/shortlex-names.mjs';
import { webPath, spokenName } from './row-web.mjs';   // C1011a: every id printed gets its spoken name on the names line · C1011: the pick's web file
import { readingLines } from './iso-reading.mjs';
import { SERIES as LICENCE_SERIES, NPM_LABEL, MARKET_DOWNLOADS_LABEL } from './licence-funnel.mjs';   // C596d: the funnel's daily series is C317's reading, read off its receipt   // C604/C618: the C609a bits reading FIRST, the C226 reading second, each off its own receipt

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROMPT_FILE = `${SNOWBALL_SIDECAR}.prompt.txt`;
// C596a: an open row further than this many blocks (Chebyshev, the same grid orderByWalk sorts on) from the focus is a WEAK
// pick — the number is the snowball's own reach (seedSpecFirst reach = 1: the focus's block and its eight neighbours).
export const STALE_D = 1;
export const WALK_TIMEOUT_MS = Number(process.env.VNA_STEERONE_TIMEOUT_MS) || 2000;

// C596c THE LAST DICTATION IS THE OPERATOR'S. The hook's prompt file holds whatever arrived last — measured 2026-10-02 it held a
// <task-notification>, so the no-focus walk ran on text the operator never said. A prompt counts only when transcript-asks.mjs
// cleanAsk() (the C187 filter: task notifications, slash-command stdout, caveats, pastes) keeps it AND it is not one of the
// harness envelopes cleanAsk does not name (cross-session messages, stop-hook feedback, system reminders). The writer is left
// alone (snowball-refresh.mjs reads that file too, and keeps one prompt); the skip is on READ, with two fallbacks.
// C596f narrows it to a POSITIVE test: the file is read only when it equals the transcript's newest operator turn:
//   1. the newest Claude Code session transcript (transcript-asks projectDir/newestSession), read as a bounded TAIL, last ask kept;
//   2. the newest /steer goal txt's last prose line.
export const HARNESS_ENVELOPE = /^\s*(?:<(?:task-notification|cross-session-message|system-reminder)\b|Stop hook feedback\b|\[SYSTEM NOTIFICATION)/i;
export const operatorText = (raw) => { if (HARNESS_ENVELOPE.test(String(raw || ''))) return null; const c = cleanAsk(raw); return c ? c.text : null; };
export const TRANSCRIPT_TAIL_BYTES = 4 * 1024 * 1024;
export function lastOperatorAsk(dir = process.env.VNA_STEERONE_TRANSCRIPTS || projectDir(REPO)) {
  let f = null; try { f = newestSession(dir); } catch { return null; }
  if (!f) return null;
  let buf; try { const fd = openSync(f, 'r'); const size = fstatSync(fd).size; const n = Math.min(size, TRANSCRIPT_TAIL_BYTES); buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n); closeSync(fd); } catch { return null; }
  let last = null;
  for (const line of buf.toString('utf8').split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }   // the first line of a tail is usually cut — it fails to parse and is skipped
    const raw = r.type === 'user' && typeof r.message?.content === 'string' && !r.isMeta ? r.message.content
      : r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string' ? r.content : null;
    const t = raw == null ? null : operatorText(raw); if (t) last = { text: t, path: f };
  }
  return last;
}
export function goalTail(dir = GOALS_DIR) {
  try {
    const f = readdirSync(dir).filter((x) => x.endsWith('.txt')).map((x) => resolve(dir, x)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    const lines = f ? readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length >= EVIDENCE_MIN && isProse(l)) : [];
    return lines.length ? { text: lines[lines.length - 1], path: f } : null;
  } catch { return null; }
}
const normPrompt = (x) => String(x || '').replace(/\s+/g, ' ').trim();
// the focus: the words after /steerone, or the last thing the OPERATOR said (never a harness envelope) — and never text no transcript records as the newest operator turn (C596f)
export function focusText(words, { promptFile = PROMPT_FILE } = {}) {
  const w = (words || []).join(' ').trim();
  if (w) return { text: w, source: 'focus words' };
  const rel = (p) => String(p).replace(REPO + '/', '').replace(/^.*\/\.claude\/projects\/[^/]+\//, '~/.claude/projects/…/');
  let raw = ''; try { raw = readFileSync(promptFile, 'utf8').trim(); } catch {}
  const t = raw ? operatorText(raw) : null;
  // C596f: the prompt file counts only when a transcript records the same text as the NEWEST operator turn — measured
  // 2026-10-03 it held a hook's grading prompt ("You grade a rule-retrieval system…"), no envelope, so C596c let it through.
  // Anything else (a model prompt, a stale prompt the hook's backoff left behind) falls through to that newest turn.
  const a = lastOperatorAsk();
  if (t && a && normPrompt(t) === normPrompt(a.text)) return { text: t, source: `last dictation (${rel(promptFile)})` };
  const skipped = !raw ? '' : t ? ' — the hook\'s prompt file held text no transcript records as the newest operator turn, skipped'
    : ' — the hook\'s prompt file held a harness envelope, skipped';
  if (a) return { text: a.text, source: `last operator prompt (${rel(a.path)})${skipped}` };
  const g = goalTail(); if (g) return { text: g.text, source: `goal txt tail (${rel(g.path)})${skipped}` };
  return { text: '', source: `none — no focus words and no operator prompt on disk${skipped}` };
}

// the newest YYYY-MM-DD on the row (the operator span's date) — recency, never guessed
export const spanDate = (text) => { const d = String(text || '').match(/\b20\d\d-\d\d-\d\d\b/g); return d ? d.sort().pop() : ''; };

// ── C596d THE CRUX: reach × legibility ────────────────────────────────────────────────────────────────────────────────
export const ROW_ID = /\bC\d+[a-z]?\d*\b/g;   // the id shape parseRows reads; \b on both sides, so C31 is never read out of C317
// rows: [{id, text, guard?}] — the rows that CAN untie (open + regressed). Returns Map id → [ids of the other rows citing it].
export function reachOf(rows) {
  const ids = new Set(rows.map((r) => r.id)); const out = new Map();
  const add = (to, from) => { if (to === from || !ids.has(to)) return; const l = out.get(to) || []; if (!l.includes(from)) l.push(from); out.set(to, l); };
  const guards = rows.filter((r) => r.guard).map((r) => [r.id, r.guard]);
  for (const r of rows) {
    const t = String(r.text || '');
    for (const id of new Set(t.match(ROW_ID) || [])) add(id, r.id);
    for (const [gid, g] of guards) if (gid !== r.id && t.includes(g)) add(gid, r.id);
  }
  return out;
}
// KNOWN READING SCRIPTS: a row whose guard stem (tests/…/c317-licence-funnel.test.mjs → licence-funnel) or a cited script
// basename equals a key reads that script's own receipt — never runs it (no network, no keys, no side effect here). A
// receipt that is absent or holds a null is UNMEASURED, never a zero.
const ageOf = (at, now = Date.now()) => { const h = (now - Date.parse(at)) / 3600e3; return !Number.isFinite(h) ? 'age unknown' : h < 48 ? `${h.toFixed(1)} h old` : `${Math.round(h / 24)} d old`; };
const lastNdjson = (p) => { try { const l = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean); return l.length ? JSON.parse(l[l.length - 1]) : null; } catch { return null; } };
const num = (v) => (v == null ? 'UNMEASURED' : String(v));
export const READERS = {
  'licence-funnel': {
    cmd: 'set -a; . ./.env.local; set +a; node scripts/vna/licence-funnel.mjs --series',
    read() {
      const r = lastNdjson(process.env.VNA_LICENCE_SERIES || resolve(REPO, LICENCE_SERIES));
      if (!r) return null;
      // C596g: the npm label rides on the receipt (npm_label, C635c) — registry fetches, never people; a row without one
      // takes the label licence-funnel.mjs exports, never a wording re-typed here
      // C635i: a row from licence-funnel after C635i carries market_downloads, and its installs is the gallery's install
      // statistic; the downloadCount rides beside it under its own label, never under the word installs
      const md = 'market_downloads' in r ? ` · ${MARKET_DOWNLOADS_LABEL} ${num(r.market_downloads)}` : '';
      return `installs ${num(r.installs)}${md} · ${r.npm_label || NPM_LABEL} ${num(r.npm_week)} · licences bought ${num(r.bought)} · by someone not us ${num(r.not_ours)} · series ${r.day || '—'}, ${r.at ? ageOf(r.at) : 'age unknown'}`;
    },
  },
};
const stemOfGuard = (g) => String(g || '').split('/').pop().replace(/\.test\.m?js$/, '').replace(/^c\d+[a-z]?\d*-/i, '');
const stemOfPath = (p) => String(p).split('/').pop().replace(/\.m?js$/, '');
export function readerFor(row) {
  const stems = [stemOfGuard(row.guard), ...namedPaths(row.text || '').filter((p) => /\.m?js$/.test(p)).map(stemOfPath)];
  const k = stems.find((x) => Object.prototype.hasOwnProperty.call(READERS, x));
  return k ? { key: k, ...READERS[k] } : null;
}
// asked-vs-built --run's per-row guard reading (built / CONTRADICTED / open "guard green|red"), keyed by id
export function guardReadings(file = ASKED_VS_BUILT) {
  const m = new Map(); let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { return m; }
  if (j.mode && j.mode !== 'run') return m;
  const age = j.at ? ageOf(j.at) : 'age unknown';
  for (const a of j.asks || []) {
    const colour = a.state === 'CONTRADICTED' || /guard (?:is )?red/.test(a.evidence || '') ? 'RED' : a.state === 'built' || /guard green/.test(a.evidence || '') ? 'GREEN' : null;
    if (colour) m.set(a.id, `guard ${colour} (asked-vs-built, ${age})`);
  }
  return m;
}
// legibility of one row: {L, line} — a reading that runs now, a guard on disk unread, or UNMEASURED
export function legibilityOf(r, { readings = new Map(), exists = (p) => existsSync(resolve(REPO, p)) } = {}) {
  const rd = readerFor(r); const live = rd ? rd.read() : null;
  if (live) return { L: 1, line: live };
  if (r.regressed) return { L: 1, line: readings.get(r.id) || 'guard RED (asked-vs-built)' };
  if (readings.has(r.id)) return { L: 1, line: readings.get(r.id) };
  if (rd) return { L: 0.25, line: `UNMEASURED — no receipt from ${rd.cmd}` };
  if (r.guard && exists(r.guard)) return { L: 0.5, line: `guard ${r.guard} on disk, not run here` };
  return { L: 0.25, line: 'UNMEASURED — no guard on disk and no reading script' };
}
const crux = (a, b) => b.score - a.score;

// ── C596h THE CRUX IS THE UPSTREAM GOAL ───────────────────────────────────────────────────────────────────────────────
// Operator 2026-10-18: a question about the row ("should C317 be the rule?") carries too little to be legible; the question
// is the goal upstream of the row — the most explainable, legible thing, and still not easy to reason about. Upstream is read
// off the record, never phrased here: the pick's root row (C305a → C305, the id prefix the spec nests by), its headline label
// (the words before the first colon) and the operator's own verbatim span, with the want-clause ("we want to sell licenses…")
// lifted out byte-for-byte when the span holds one. The skill turns that into the CRUX question; the script never paraphrases.
export const parentId = (id) => { const m = String(id || '').match(/^(C\d+)[a-z]/); return m ? m[1] : null; };
export function upstreamOf(id, byId) { const p = parentId(id); return p && byId.has(p) ? p : id; }
export const SPAN = /\(operator (20\d\d-\d\d-\d\d)[^*]*?verbatim:\s*\*"([\s\S]*?)"\*/;
export const WANT = /\b(?:we|i)\s+(?:want|need|have)\s+to\b[^.?!…]*/i;
export function goalOf(row) {
  const t = String(row && row.text || '').replace(/^\(guard:[^)]*\)\s*/, '');
  const head = t.split(/[:.]/)[0].trim();
  const label = head && head.length <= 60 ? head : null;
  const m = t.match(SPAN); const span = m ? m[2].replace(/\s+/g, ' ').trim() : null;
  const w = span && span.match(WANT);
  return { id: row && row.id, label, date: m ? m[1] : null, span, want: w ? w[0].trim() : null };
}
// C596i SELF-CONTAINED FIRST (operator 2026-10-18: "it has to be self-contained … pick one that we can reason about without
// getting lost in the weeds"). A goal is self-contained when the operator stated what he wants in his own words (a want-clause)
// AND the row names it in a short label: 1. A span with no want-clause is 0.5 (reason about it only by reading the row). No
// span is 0.25. The crux score is reach × legibility × this, so a weedy row with wide reach never outranks a stated goal.
export const clarityOf = (g) => (g && g.want && g.label ? 1 : g && g.span ? 0.5 : 0.25);

const tierOf = (r) => (r.regressed ? 0 : r.class === CLEAR ? 1 : r.class === NEEDS || r.class === WAITING ? 2 : 3);
const label = (r) => (r.regressed ? 'regressed' : r.class === CLEAR ? 'clear' : 'needs-you');

// THE PICK. md: the spec markdown · tree: the spec tree (pixels) · regressed: [{id, guard}] · walkRow: the walk door's row
// (pixel, admissible, err, fit…) · snowball: Set of row ids the seed/retro named. Pure — the guard drives it with fixtures.
export function pickOne({ md, tree, regressed = [], walkRow = null, snowball = new Set(), focusWords = '', readings = new Map() }) {
  const all = parseRows(md); const byId = new Map(all.map((r) => [r.id, r]));
  const c = classifySpec(md, { exists: (p) => existsSync(resolve(REPO, p)) });
  const regIds = new Set(regressed.map((r) => r.id));
  const reg = regressed.filter((r) => byId.has(r.id)).map((r) => ({ id: r.id, class: 'REGRESSED', regressed: true, guard: r.guard || null, missing: [] }));
  const open = c.rows.filter((r) => !regIds.has(r.id));
  const rows0 = [...reg, ...open].map((r) => ({ ...r, guard: r.guard || guardOf(byId.get(r.id).text), text: byId.get(r.id).text, date: spanDate(byId.get(r.id).text), line: byId.get(r.id).line }));
  // C596d: reach over the rows that can untie (open + regressed), legibility per row, score = |reach| × L
  const reach = reachOf(rows0);
  const goalFor = (r) => { const rid = upstreamOf(r.id, byId); return goalOf(rid === r.id ? r : { id: rid, text: byId.get(rid).text }); };   // C596h/C596i
  const rows = rows0.map((r) => { const u = reach.get(r.id) || []; const g = legibilityOf(r, { readings }); const cl = clarityOf(goalFor(r)); return { ...r, unties: u, legible: g.L, reading: g.line, clarity: cl, score: u.length * g.L * cl }; });
  const placed = !!(walkRow && walkRow.admissible && walkRow.pixel && blockOf(walkRow.pixel));
  const recency = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.line - a.line);
  const q = String(focusWords || '').trim();
  let ordered, reason, focusState, match = null, nearestOpen = null;
  if (q && placed) {
    // C596b WITH FOCUS WORDS, WALK ADMITTED: the neighbourhood is every row within STALE_D of the focus; regressed rows lead
    // only INSIDE it. Outside it, the nearest OPEN row is a WEAK pick (C596a) — never an unrelated regressed row.
    const ow = orderByWalk(rows, { tree, from: { sha: 'focus', coord: walkRow.pixel, block: blockOf(walkRow.pixel) } });
    const inN = (r) => r.d != null && r.d <= STALE_D;
    const near = ow.rows.filter(inN).sort((a, b) => crux(a, b) || tierOf(a) - tierOf(b) || a.d - b.d || (snowball.has(b.id) - snowball.has(a.id)) || recency(a, b));
    const farOpen = ow.rows.filter((r) => !inN(r) && !r.regressed && r.d != null).sort((a, b) => a.d - b.d || tierOf(a) - tierOf(b) || recency(a, b));
    ordered = near.length ? near : farOpen;
    focusState = near.length ? 'near' : farOpen.length ? 'weak' : 'none';
    reason = `focus first: rows within cheb ${STALE_D} of ${walkRow.pixel}, crux first inside it (C596d), then regressed, then clear by nearness, snowball, span recency`;
  } else if (q) {
    // C596b WITH FOCUS WORDS, WALK NOT ADMITTED: the focus is matched against the rows' own text (headline + operator span) —
    // the phrase verbatim under NCD_MIN_CHARS (NCD is length noise there), gzip-NCD under τ_attach above it. Regressed rows
    // lead only among the matches; no match is NO ROW + EVIDENCE.
    const ql = q.toLowerCase();
    let hits;
    if (q.length < NCD_MIN_CHARS) { hits = rows.filter((r) => r.text.toLowerCase().includes(ql)).map((r) => ({ ...r, m: headlineOf(r.text).toLowerCase().includes(ql) ? 0 : 1, n: r.text.toLowerCase().split(ql).length - 1 })); match = 'verbatim'; }   // a headline hit (the row is ABOUT it) before a body hit (the row mentions it), then more mentions first
    else { const tau = thresholds().tau_attach; hits = rows.map((r) => ({ ...r, m: +ncd(ql, r.text.toLowerCase()).toFixed(3) })).filter((r) => r.m < tau); match = `ncd < τ_attach ${tau}`; }
    ordered = hits.sort((a, b) => crux(a, b) || tierOf(a) - tierOf(b) || a.m - b.m || (b.n || 0) - (a.n || 0) || recency(a, b));
    focusState = ordered.length ? 'matched' : 'none';
    reason = `focus first: rows whose text matches "${q.slice(0, 40)}" (${match}${match === 'verbatim' ? ', headline before body' : ''}), crux first among them (C596d), then regressed, then span recency — the walk did not admit the focus, so no placement`;
  } else if (placed) {
    const ow = orderByWalk(rows, { tree, from: { sha: 'focus', coord: walkRow.pixel, block: blockOf(walkRow.pixel) } });
    ordered = ow.rows.sort((a, b) => crux(a, b) || tierOf(a) - tierOf(b) || (a.d == null) - (b.d == null) || (a.d ?? 0) - (b.d ?? 0)
      || (snowball.has(b.id) - snowball.has(a.id)) || recency(a, b));
    reason = `no focus words: crux first (rows it unties × legibility, C596d), then regressed (global), then clear by Chebyshev nearness to ${walkRow.pixel}, then snowball, then span recency`;
    // WEAK still means "no open row sits AT the focus" — read off the nearest open row, not the crux pick
    const ob = ordered.filter((r) => !r.regressed && r.d != null).sort((a, b) => a.d - b.d)[0] || ordered.find((r) => !r.regressed) || null;
    nearestOpen = ob;
    focusState = !ob || ob.d == null ? 'none' : ob.d > STALE_D ? 'weak' : 'near';
  } else {
    ordered = rows.slice().sort((a, b) => crux(a, b) || tierOf(a) - tierOf(b) || recency(a, b));
    reason = 'FALLBACK (no focus words, the walk did not admit the dictation): regressed first, then span recency — beneath the crux rank (rows it unties × legibility, C596d), which orders first';
    focusState = 'unmeasured';
  }
  // C596a: focusState near · matched (a row sits at the focus) · weak (the nearest open row is far) · none (NO ROW) · unmeasured
  const openBest = nearestOpen || ordered.find((r) => !r.regressed) || null;
  // C596h: the goal upstream of the pick — its root row's label and the operator's want-clause, with the root's reading when one runs
  const pk = ordered[0] || null; let goal = null;
  if (pk) { const rid = upstreamOf(pk.id, byId); const root = rid === pk.id ? pk : { id: rid, text: byId.get(rid).text, guard: guardOf(byId.get(rid).text) };
    const g = goalOf(root); const rl = rid === pk.id ? { L: pk.legible, line: pk.reading } : legibilityOf(root, { readings });
    goal = { ...g, reading: rl.L === 1 ? rl.line : pk.reading || rl.line }; }
  const names = new Map(all.map((r) => [r.id, spokenName(r.text)]));   // C1011a: off each row's own text — hermetic, never the cache
  return { pick: pk, runnersUp: ordered.slice(1, 4), placed, reason, counts: c.counts, regressed: reg.length, openBest, focusState, match, goal, names };
}

const guardState = (r, avbAge) => {
  if (!r.guard) return 'none named';
  if (r.regressed) return `RED (asked-vs-built${avbAge ? `, ${avbAge}` : ''})`;
  return existsSync(resolve(REPO, r.guard)) ? 'on disk, not run here' : 'not on disk yet';
};
const untiesOf = (r) => { const u = r.unties || []; return `unties ${u.length} row${u.length === 1 ? '' : 's'}${u.length ? `: ${u.slice(0, 12).join(' ')}${u.length > 12 ? ` +${u.length - 12}` : ''}` : ''}`; };
const why = (r) => `${r.regressed ? 'regressed' : `${label(r)}${r.d != null ? ` d${r.d}` : ''}${r.date ? ` ${r.date}` : ''}`}${r.unties && r.unties.length ? ` unties ${r.unties.length}` : ''}`;

// ── C596a THE EVIDENCE: when no open row sits at the focus, the answer is built from the record, never invented ──────────
// TRANSCRIPT: the operator's dictations as the /steer goal files hold them (docs/specs/vna/goals/*.txt, newest first) plus
// the hook's copy of the last prompt — ranked by the same gzip-NCD the snowball orders with (spec-tree ncd). Each line keeps
// its path and line number, so the skill quotes it verbatim as a new row's operator span.
export const GOALS_DIR = process.env.VNA_STEERONE_GOALS_DIR || resolve(REPO, 'docs/specs/vna/goals');
export const EVIDENCE_FILES = 40, EVIDENCE_N = 4, EVIDENCE_MIN = 40, EVIDENCE_MAX = 600;
// prose: mostly letters and at least six words — a box-drawing rule or a ???? mojibake run compresses to nothing and would
// otherwise win every NCD race on length alone
export const isProse = (t) => (t.match(/\p{L}/gu) || []).length >= 0.6 * t.length && t.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length >= 6;
export function transcriptEvidence(focus, { dir = GOALS_DIR, promptFile = PROMPT_FILE, n = EVIDENCE_N } = {}) {
  const files = [];
  try { for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) { const p = resolve(dir, f); files.push({ p, m: statSync(p).mtimeMs }); } } catch {}
  files.sort((a, b) => b.m - a.m);
  // the prompt file rides only when the focus is not itself that prompt (a line never evidences itself)
  let self = ''; try { self = readFileSync(promptFile, 'utf8').trim(); } catch {}
  const paths = [...(self && self !== String(focus || '').trim() ? [promptFile] : []), ...files.slice(0, EVIDENCE_FILES).map((f) => f.p)];
  const q = String(focus || '').toLowerCase(); const cand = []; const seen = new Set();
  for (const p of paths) {
    let lines = []; try { lines = readFileSync(p, 'utf8').split('\n'); } catch { continue; }
    lines.forEach((l, i) => { const t = l.trim(); if (t.length < EVIDENCE_MIN || seen.has(t) || !isProse(t)) return; seen.add(t); cand.push({ path: p.replace(REPO + '/', ''), line: i + 1, text: t.slice(0, EVIDENCE_MAX) }); });
  }
  // under NCD_MIN_CHARS gzip's header dominates and NCD is length noise (spec-tree.mjs) — a short focus matches by BYTE
  // IDENTITY instead (the phrase verbatim, case folded), newest file first; a long focus ranks by NCD over lines ≥ the same floor
  if (q.trim().length < NCD_MIN_CHARS) {
    return cand.filter((c) => c.text.toLowerCase().includes(q.trim())).slice(0, n).map((c) => ({ ...c, d: null, by: 'verbatim' }));
  }
  return cand.filter((c) => c.text.length >= NCD_MIN_CHARS).map((c) => ({ ...c, d: +ncd(q, c.text.toLowerCase()).toFixed(3), by: 'ncd' })).sort((a, b) => a.d - b.d).slice(0, n);
}
// COMMITS: the recent commits whose PLACED coordinate (commit-greeks-index, the receipt the post-commit hook writes) sits within
// STALE_D of the focus — sha · coordinate · subject. Seam: VNA_STEERONE_WORK=<json [{sha, coord, subject}]>.
export function commitEvidence(coord, { n = EVIDENCE_N, work = null } = {}) {
  const fb = blockOf(coord); if (!fb) return [];
  let rows = work;
  if (!rows && process.env.VNA_STEERONE_WORK) { try { rows = JSON.parse(readFileSync(process.env.VNA_STEERONE_WORK, 'utf8')); } catch { rows = []; } }
  if (!rows) rows = worked({ limit: 200 });
  const near = rows.filter((w) => blockOf(w.coord) && cheb(fb, blockOf(w.coord)) <= STALE_D).slice(0, n);
  const need = near.filter((w) => !w.subject).map((w) => w.sha);
  if (need.length) {
    try {
      const out = execFileSync('git', ['show', '-s', '--format=%h %s', ...need], { cwd: REPO, encoding: 'utf8', timeout: 3000 }).split('\n');
      for (const w of near) if (!w.subject) { const l = out.find((x) => x.startsWith(String(w.sha).slice(0, 7))); w.subject = l ? l.slice(l.indexOf(' ') + 1) : '—'; }
    } catch { for (const w of near) w.subject = w.subject || '—'; }
  }
  return near.map((w) => ({ sha: String(w.sha).slice(0, 10), coord: w.coord, d: cheb(fb, blockOf(w.coord)), subject: String(w.subject || '—').slice(0, 100) }));
}

export function render({ focus, walkRow, res, snowLine, avbAge, evidence = null, predicts = null }) {
  const L = [];
  // C596e: the CRUX leads — the row, the rows its answer unties, its live reading — so the answer opens on a decision. A pick
  // that unties nothing is no crux (a local fix), so it gets no line and the PREDICTS readings stay first.
  const c0 = res.pick;
  // C596h: the GOAL leads — the CRUX question is built from it, never from the row id
  const g = res.goal;
  if (g) L.push(`GOAL · ${g.id}${g.label ? ` · ${g.label}` : ''} · ${g.span ? `operator ${g.date}, verbatim: "${(g.want || g.span).slice(0, 240)}${!g.want && g.span.length > 240 ? '…' : ''}"` : 'operator span — none on the row'} · reading: ${g.reading || 'UNMEASURED'}`);
  if (c0 && c0.unties && c0.unties.length) L.push(`CRUX · ${c0.id} · ${untiesOf(c0)} · reading: ${c0.reading || 'UNMEASURED'}`);
  if (predicts) L.push(...[].concat(predicts));   // C618: the bits (C609a) first, C604's compression→placement second, before PICK / WEAK / NO ROW (after CRUX, C596e)
  const p = res.pick;
  const landed = res.placed
    ? `landed ${walkRow.pixel} ${fullName(walkRow.pixel)} · hat ${hatName(walkRow.pixel)}`
    : `landed UNMEASURED — ${walkRow && walkRow.pixel ? `the walk did not admit the focus (unadmitted reading ${walkRow.pixel}, not a placement)` : `the walk wrote no pixel${walkRow && walkRow.err ? ` (${walkRow.err})` : ''}`}`;
  const noRow = res.focusState === 'none' ? `NO ROW — ${res.match ? `no open or regressed row matches the focus (${res.match})` : res.placed ? `no open row the tree has placed near ${walkRow.pixel}` : 'no open row in the spec'} · ${landed}` : null;
  const weak = res.focusState === 'weak' ? `WEAK — the nearest open row ${res.openBest.id} sits cheb ${res.openBest.d} from ${walkRow.pixel}, over STALE_D ${STALE_D}` : null;
  if (p && (p.regressed || res.focusState !== 'none')) {
    const dist = res.placed && p.d != null ? ` · cheb ${p.d} from focus` : res.match && p.m != null ? ` · matched the focus (${res.match === 'verbatim' ? `verbatim, ${p.m === 0 ? 'headline' : 'body'}` : `ncd ${p.m}`})` : '';
    L.push(`PICK ${p.id} · ${label(p)}${weak && !p.regressed ? ' · WEAK' : ''} · guard ${p.guard || '—'} ${guardState(p, avbAge)} · ${landed}${dist} · ${untiesOf(p)}`);
    L.push(String(p.text || '').replace(/\s+/g, ' ').slice(0, 200));
    { const wp = webPath(p.id, process.env.VNA_ROW_WEB_DIR || undefined); L.push(`web: ${wp ? wp.replace(REPO + '/', '') : `UNMEASURED — no row-web file for ${p.id} (node scripts/vna/row-web.mjs --build)`}`); }   // C1011: read this instead of the repo
    L.push(`runners-up: ${res.runnersUp.map((r) => `${r.id} (${why(r)})`).join(' · ') || 'none'}`);
    L.push(`order: ${res.reason}`);
    // C1011a: every id this output names, with its spoken name — the answer says "C317, sell licences", never a bare id
    if (res.names) { const ids = [...new Set([p.id, ...(p.unties || []), ...res.runnersUp.map((r) => r.id)])]; L.push(`names: ${ids.map((id) => `${id} ${res.names.get(id) || '—'}`).join(' · ')}`); }
  }
  if (noRow) L.push(noRow);
  if (weak) L.push(weak);
  if (!p && !noRow) L.push(`NO ROW — no open row and no regressed tick · ${landed}`);
  const f = walkRow && walkRow.fit;
  L.push(`walk: ${walkRow && walkRow.admissible ? 'ADMISSIBLE' : 'NOT ADMITTED'} · sensor ${walkRow ? walkRow.sensor || '—' : '—'} · gain ${f ? f.gain ?? '—' : '—'} · z ${f ? f.z ?? '—' : '—'} · aperture ${walkRow && walkRow.aperture_id || '—'} · ${walkRow && walkRow.ms != null ? `${walkRow.ms} ms` : '—'}`);
  if (snowLine) L.push(snowLine);
  if (evidence) {
    L.push('EVIDENCE (the record nearest the focus — evidence, never a row):');
    for (const e of evidence.transcript) L.push(`  said ${e.path}:${e.line} (${e.by === 'verbatim' ? 'verbatim' : `ncd ${e.d}`}) "${e.text.slice(0, 160)}${e.text.length > 160 ? '…' : ''}"`);
    if (!evidence.transcript.length) L.push(`  said — no line holds the focus${focus.text.trim().length < NCD_MIN_CHARS ? ' verbatim (under ' + NCD_MIN_CHARS + ' chars NCD is length noise, so only byte identity counts)' : ''}`);
    if (evidence.commits == null) L.push('  commits UNMEASURED — no placement to sit near');
    else if (!evidence.commits.length) L.push(`  commits — none placed within cheb ${STALE_D} of ${walkRow.pixel}`);
    else for (const c of evidence.commits) L.push(`  commit ${c.sha} ${c.coord} (cheb ${c.d}) ${c.subject}`);
  }
  L.push(`focus: ${focus.source} · "${focus.text.replace(/\s+/g, ' ').slice(0, 80)}${focus.text.length > 80 ? '…' : ''}"`);
  return L;
}

async function walkOf(text) {
  if (process.env.VNA_STEERONE_WALK) {
    try { return JSON.parse(readFileSync(process.env.VNA_STEERONE_WALK, 'utf8')); } catch (e) { return { pixel: null, admissible: false, err: `fixture walk unreadable: ${e.message}` }; }
  }
  const { lensWalk } = await import('../../src/lib/pmu/walk-door.mjs');
  return lensWalk(text, { source: 'lens-cli', timeoutMs: WALK_TIMEOUT_MS }).row;   // lens-cli: a CLI read, never an actuarial tape row
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json');
  const focus = focusText(argv.filter((a) => !a.startsWith('--')));
  const md = readFileSync(process.env.VNA_SPEC_MD || SPEC_MD, 'utf8');
  const tree = loadTree(process.env.VNA_SPEC_TREE || TREE);
  const reg = regressedTicks({ file: process.env.VNA_ASKED_VS_BUILT || ASKED_VS_BUILT, md });
  const avbAge = reg.at ? `${((Date.now() - Date.parse(reg.at)) / 3600e3).toFixed(1)} h old` : null;
  const walkRow = focus.text ? await walkOf(focus.text) : { pixel: null, admissible: false, err: 'no focus text' };
  const snowball = new Set(); const snow = [];
  if (walkRow && walkRow.admissible && walkRow.pixel && tree && tree.nodes) {
    try { const s = seedSpecFirst(tree, focus.text, walkRow); const l = s.leaf || s.best; if (l && l.label) { snowball.add(l.label); snow.push(`seed ${l.label}${s.abstained ? ' (abstained)' : ''}`); } } catch (e) { snow.push(`seed error ${String(e.message).slice(0, 60)}`); }
    const flag = retroLiveFlag();
    if (flag.on && !process.env.VNA_STEERONE_NO_RETRO && !process.env.VNA_STEERONE_WALK) {
      const { lensWalk } = await import('../../src/lib/pmu/walk-door.mjs');
      const walk = (t, o = {}) => { const r = lensWalk(t, { source: 'lens-cli', timeoutMs: WALK_TIMEOUT_MS, maxChars: o.maxChars || null }).row; return { pixel: r.pixel, cells: r.cells, err: r.err }; };
      try { const g = await retroGrow(tree, focus.text, { walk, askCells: walkRow.cells || [], maxSteps: 3, tau: flag.tau }); for (const id of g.set || []) snowball.add(id); snow.push(`retro ${g.set && g.set.length ? g.set.join(',') : 'none'} (stop ${g.stop ? g.stop.why : '—'})`); } catch (e) { snow.push(`retro error ${String(e.message).slice(0, 60)}`); }
    } else snow.push(`retro off — ${flag.on ? 'skipped by seam' : flag.why}`);
  }
  const words = argv.filter((a) => !a.startsWith('--')).join(' ').trim();
  const res = pickOne({ md, tree, regressed: reg.rows, walkRow, snowball, focusWords: words, readings: guardReadings(process.env.VNA_ASKED_VS_BUILT || ASKED_VS_BUILT) });
  // the evidence rides whenever no open row is AT the focus: none · weak · unmeasured (distance undefined)
  const evidence = res.focusState === 'near' || res.focusState === 'matched' || !focus.text ? null
    : { transcript: transcriptEvidence(focus.text), commits: res.placed ? commitEvidence(walkRow.pixel) : null };
  if (asJson) { console.log(JSON.stringify({ focus, walk: walkRow && { pixel: walkRow.pixel, admissible: !!walkRow.admissible, err: walkRow.err || null, fit: walkRow.fit || null }, ...res, snowball: [...snowball], evidence })); process.exit(0); }
  for (const l of render({ focus, walkRow, res, snowLine: snow.length ? `snowball: ${snow.join(' · ')}` : null, avbAge, evidence, predicts: readingLines() })) console.log(l);
}
