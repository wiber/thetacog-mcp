#!/usr/bin/env node
// C51 — THE CLEAR GAUGE: is the spec enough? (operator, 2026-09-17: "clearing often should be low or no
// cost with this setup to save tons of tokens, and not just by habit" · "its a key upside of the panel" ·
// "when done right")
//
// The habit version — "turns ≥ 10 → CLEAR OVERDUE" — is exactly what "not just by habit" rules out. A turn
// count is a proxy for nothing. The gauge compares two byte counts that are each the thing itself:
//
//   LOSE   what a /clear would lose — the steer file's bytes past the last tape row (typed, never taped)
//          plus the tape rows the tree has not folded (taped, never in the tree). Zero means the Merkle
//          tree already holds every ask, and the next session reads it back through the snowball (T8).
//   CARRY  what every turn re-pays — the session transcript on disk. Claude Code hands the hook
//          `transcript_path` beside `session_id`; its size is the record of this session, not an estimate.
//   SPEC   what a fresh session would load instead — the whole tree's gzip mass (root.mass.gzip).
//
// Three states, read off those numbers and nothing else:
//   FOLD-FIRST  LOSE > 0        — a clear now loses bytes; Paste → Tree first (vna.pasteToTree)
//   FREE        LOSE = 0        — the spec holds everything; a clear costs nothing
//   OVERDUE     FREE and CARRY > SPEC — the session's own record outweighs the entire spec that would replace it
//
// AXIOM 1 (W6) — what this projection is SUFFICIENT FOR: "is the steer tape in the tree, and is this session
// heavier than the spec". What it is NOT for: anything said in chat and never clipped into the steer file — the
// gauge cannot see it and says so on its line. LLM-free, no walk, no model: two stats and one subtraction.
//
//   node scripts/vna/clear-gauge.mjs [--json]         read the live state (the hook writes .thetacog/vna-clear-gauge.json)
import { readFileSync, statSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { ledgerTail, lastRowWhere } from './ndjson-tail.mjs';   // bounded tail reads of the ledger (2026-09-20)
import { CHARS_PER_TOKEN, BUNDLE_TOKEN_CAP } from './spec-tree.mjs';   // C82e: the one ratio and the one cap, named in one place
import { readWatermark } from './fold-writer.mjs';   // C170a leg 1: the watermark sidecar, never the tree
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const GAUGE = process.env.VNA_CLEAR_GAUGE || resolve(REPO, '.thetacog/vna-clear-gauge.json');
// C82e — THE TOKEN METER (operator 2026-09-18: "Can we estimate token savings? Yes and market it in the extension" · "If you
// like this buy licenses!"). A saving is a measurement: the ledger holds one row per SESSION CHANGE — the session that ended,
// the transcript bytes it was carrying, its turns, its state. The meter sums what each replaced session would have re-sent on
// every turn of the session that followed it (bytes / CHARS_PER_TOKEN), minus the snowball that was sent instead
// (BUNDLE_TOKEN_CAP); a session that ended FOLD-FIRST contributes 0 — its asks were not in the tree, the clear was not free.
// Never a dollar until a price is pinned (KR40). The extension reads the receipt the hook writes and computes nothing.
export const LEDGER = process.env.VNA_CLEAR_LEDGER || resolve(REPO, '.thetacog/vna-clear-gauge.ndjson');
export const METER = process.env.VNA_TOKEN_METER || resolve(REPO, '.thetacog/vna-token-meter.json');
export const TAPE = process.env.VNA_FLIGHT_TAPE || resolve(REPO, 'data/vna/flight-tape.ndjson');   // C91e: the goal rows live on the flight tape (same default as flight-tape.mjs FLIGHT)
export { CHARS_PER_TOKEN };
export const SNOWBALL_TOKENS = BUNDLE_TOKEN_CAP;
const ndRows = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
export function recordSessionEnd({ prev, session, ledger = LEDGER, at = new Date().toISOString() } = {}) {
  if (!prev || !prev.session || !session || prev.session === session) return false;
  const last = ndRows(ledger).pop();
  if (last && last.session === prev.session && last.next === session) return false;   // exactly once per change
  const row = { at, session: prev.session, next: session, contextBytes: Number.isFinite(prev.contextBytes) ? prev.contextBytes : null, turns: prev.turns ?? null, state: prev.state || null, lose: prev.lose ?? null, specGzip: prev.specGzip ?? null, endedAt: prev.at || null, transcriptPath: prev.transcriptPath || null };
  try { mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify(row) + '\n'); } catch { return false; }
  return true;
}
const kTok = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
// ── C91e THE METER IS THE PROOF — the same figure, per GOAL ───────────────────────────────────────
// C82e counts per SESSION what a clear stopped re-sending. C91 evicts the steering session on the goal's own close, so the
// goal row on the flight tape (C91a) carries the two numbers the meter needs — context_bytes (the transcript the goal was
// steered under, read off the gauge ledger at close) and turns_used (the turns that paid for it). Per goal, newest row per
// sha (C91b's amendment is the same goal): (context_bytes / charsPerToken − snowball) × turns_used, never below 0. A row
// whose context_bytes is null contributes 0 and is COUNTED as unmeasured on the line — absence is never zero. The card
// reads `N goals closed · M tokens not re-sent`; never a dollar until a price is pinned (KR40).
export function goalTokens(rows, { charsPerToken = CHARS_PER_TOKEN, snowballTokens = SNOWBALL_TOKENS } = {}) {
  const newest = new Map(); for (const r of rows || []) if (r && r.kind === 'goal' && r.sha) newest.set(r.sha, r);
  const perGoal = [...newest.values()].map((r) => {
    const p = r.proofs || {}; const measured = Number.isFinite(p.context_bytes) && p.context_bytes != null;
    const turns = Number.isFinite(p.turns_used) ? p.turns_used : 0;
    const carried = measured ? Math.round(p.context_bytes / charsPerToken) : 0;
    return { sha: r.sha, seq: r.seq ?? null, text: p.text || null, measured, turns, carried, tokens: measured ? Math.max(0, carried - snowballTokens) * turns : 0 };
  });
  const closed = perGoal.length, unmeasured = perGoal.filter((g) => !g.measured).length, tokens = perGoal.reduce((s, g) => s + g.tokens, 0);
  const line = closed === 0 ? 'no goal has closed on this tape'
    : `${closed} goal${closed === 1 ? '' : 's'} closed · ${kTok(tokens)} tokens not re-sent${unmeasured ? ` · ${unmeasured} unmeasured` : ''}`;
  return { closed, tokens, unmeasured, perGoal, line, sufficientFor: 'input tokens the goal\'s own close stopped re-sending, at the named ratio, over goal rows carrying a measured context', notFor: 'a price, a dollar, or a goal whose context the hook never measured' };
}

// ── C98c THE RATIO IS READ — never typed ─────────────────────────────────────────────────────────
// The eighth paste typed "99.9%". The ratio is read off the meter over the window it measured: the goal rows with a measured
// context (C91e) — would = Σ carried × turns (what every turn would have re-sent), not = Σ tokens (what was not re-sent, the
// snowball having gone instead); pct = 100 × not / would, one decimal. No measured goal → null, never 0: absence is not zero,
// and the surface says UNMEASURED — run one goal. The README block is rendered from a committed snapshot of this window
// (public-surface-register.mjs ratioLine / RATIO_RECEIPT), and the guard recomputes the pct from the snapshot's own window.
export const notReSentPct = (w) => (w && w.goals > 0 && w.would > 0) ? Math.round((100 * w.not / w.would) * 10) / 10 : null;
// C196 (2026-09-23): the `g.turns` / `g.carried` existence checks below are written as truthy tests, not `> 0`
// comparisons — this file's own C51 guard (tests/vna/clear-gauge.test.mjs "no turn count decides anything")
// regexes the WHOLE file for `turns\s*>=?\s*\d` to keep a turn-count threshold out of the FOLD-FIRST/FREE/OVERDUE
// state decision; goalWindow is an unrelated C98c metric (the token-savings ratio) that happens to use `turns` as
// a multiplier, and `g.turns > 0` was a false-positive token match on that guard, not the habit it bans.
export const goalWindow = (goals) => { const w = { goals: 0, would: 0, not: 0 }; for (const g of (goals && goals.perGoal) || []) if (g.measured && g.turns && g.carried) { w.goals += 1; w.would += g.carried * g.turns; w.not += g.tokens; } return w; };
export function tokenMeter({ ledger = LEDGER, gauge = GAUGE, tape = TAPE, charsPerToken = CHARS_PER_TOKEN, snowballTokens = SNOWBALL_TOKENS } = {}) {
  // A SESSION CHANGE IN THE GAUGE IS NOT A SESSION ENDING: parallel rooms and the hook's own bench guards take the gauge in
  // turns. A session has ENDED when its transcript stopped growing — the size the ledger recorded is the size on disk now
  // (a missing transcript counts as ended; a row with no path cannot be checked and is taken as ended). One row per session,
  // the newest; a session still growing contributes 0 and says so.
  const all = ndRows(ledger); const newest = new Map(); for (const r of all) if (r && r.session) newest.set(r.session, r);
  const rows = [...newest.values()];
  let g = null; try { g = JSON.parse(readFileSync(gauge, 'utf8')); } catch {}
  const grown = (r) => { if (!r.transcriptPath || !Number.isFinite(r.contextBytes)) return false; try { return statSync(r.transcriptPath).size > r.contextBytes; } catch { return false; } };
  const turnsOf = (sessionId) => { const nx = newest.get(sessionId); if (g && g.session === sessionId) return Math.max(g.turns || 0, nx ? nx.turns || 0 : 0); return nx ? nx.turns || 0 : 0; };
  const perSession = rows.map((r) => {
    const carried = Number.isFinite(r.contextBytes) ? Math.round(r.contextBytes / charsPerToken) : 0;
    const free = r.lose === 0 && r.state !== 'FOLD-FIRST';
    const live = grown(r);
    const turns = turnsOf(r.next);
    return { session: r.session, next: r.next, carried, free, live, turns, tokens: free && !live ? Math.max(0, carried - snowballTokens) * turns : 0 };
  });
  const saved = { tokens: perSession.reduce((s, x) => s + x.tokens, 0), sessions: rows.length, free: perSession.filter((x) => x.free && !x.live).length, foldFirst: perSession.filter((x) => !x.free).length, stillLive: perSession.filter((x) => x.live).length, perSession };
  const live = g && Number.isFinite(g.contextBytes)
    ? { state: 'MEASURED', session: g.session || null, contextBytes: g.contextBytes, turns: g.turns ?? null, tokensPerTurn: Math.max(0, Math.round(g.contextBytes / charsPerToken) - snowballTokens), lose: g.lose ?? 0 }
    : { state: 'UNMEASURED', why: 'no clear gauge yet — the hook writes it every turn' };
  const line = live.state !== 'MEASURED' ? `UNMEASURED — ${live.why} · ${charsPerToken} chars/token`
    : live.lose > 0 ? `a /clear now would lose ${fmtB(live.lose)} of asks — fold first; it would drop ~${kTok(live.tokensPerTurn)} input tokens from every following turn · ${charsPerToken} chars/token`
      : `a /clear now drops ~${kTok(live.tokensPerTurn)} input tokens from every following turn and loses 0 B of asks · ${charsPerToken} chars/token`;
  const goals = goalTokens(ndRows(tape), { charsPerToken, snowballTokens });   // C91e: beside the session block, never inside it
  const window = goalWindow(goals); const not_re_sent_pct = notReSentPct(window);   // C98c
  return { charsPerToken, snowballTokens, saved, live, goals, window, not_re_sent_pct, line, sufficientFor: 'input tokens a clear stopped re-sending, at the named ratio, over sessions whose transcript stopped growing', notFor: 'a price, a dollar, or a session the hook never measured' };
}

export const fmtB = (n) => (n == null || !Number.isFinite(n)) ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`;

// ── the pure gauge: numbers in, one state out ─────────────────────────────────────────────────────
export function clearGauge({ tailBytes = 0, tapeRows = 0, tapeBytes = 0, contextBytes = null, specGzip = 0, turns = null, session = null } = {}) {
  const lose = Math.max(0, tailBytes | 0) + Math.max(0, tapeBytes | 0);
  const measured = Number.isFinite(contextBytes) && contextBytes != null;
  const state = lose > 0 ? 'FOLD-FIRST' : (measured && specGzip > 0 && contextBytes > specGzip) ? 'OVERDUE' : 'FREE';
  const dot = state === 'OVERDUE' ? '🔴' : state === 'FOLD-FIRST' ? '🟡' : '🟢';
  const loseTxt = lose === 0 ? 'a clear loses 0 B' : `a clear loses ${fmtB(lose)} (${tailBytes > 0 ? `${fmtB(tailBytes)} typed past the tape` : ''}${tailBytes > 0 && tapeBytes > 0 ? ' + ' : ''}${tapeBytes > 0 ? `${tapeRows} tape row${tapeRows === 1 ? '' : 's'} not in the tree` : ''})`;
  const carryTxt = measured ? `carrying ${fmtB(contextBytes)} of transcript${turns != null ? ` over ${turns} turn${turns === 1 ? '' : 's'}` : ''}` : 'transcript unmeasured (no transcript_path on this turn)';
  const specTxt = specGzip > 0 ? `spec ${fmtB(specGzip)} gz` : 'spec mass unknown';
  const verdict = state === 'OVERDUE' ? 'CLEAR IS FREE AND OVERDUE — the record of this session outweighs the whole spec that would replace it'
    : state === 'FOLD-FIRST' ? 'FOLD FIRST — Paste → Tree, then clear'
      : 'clear is free — the tree holds everything';
  const line = `${dot} ${state} · ${loseTxt} · ${carryTxt} · ${specTxt} · ${verdict}`;
  return { state, dot, lose, tailBytes, tapeRows, tapeBytes, contextBytes: measured ? contextBytes : null, specGzip, turns, session, line,
    sufficientFor: 'is the steer tape in the tree; is this session heavier than the spec', notFor: 'asks said in chat and never clipped into the steer file' };
}

// ── C91c THE EVICTION — the gauge acts, on three receipts and nothing else ────────────────────────
// C51's actuator was ONE CLICK, NEVER UNATTENDED. C91 says the steering session is evicted by the goal's OWN CLOSE, never
// by habit and never by a click it forgets. The two are one sentence now: one click, or the goal's own close — three
// receipts, never a timer or a threshold. The receipts: the goal row on the flight tape for the goal file's own bytes
// (C91a), the send log carrying the resendId that row names (C91b — the report is proven SENT, not just addressed), and
// the gauge (C51) reading FREE or OVERDUE. Pure: rows in, one verdict out; every HOLD names the receipt that is missing.
// AXIOM 1 (W6): sufficient for "did this goal close, report and fold — may the chair be cleared". NOT for whether the
// goal was good (Rice) — that is the report's reader's question, and the report is on its way to him by the time this says CLEAR.
export function clearDecision({ goal = null, sent = [], gauge = null } = {}) {
  const hold = (missing, why) => ({ verdict: 'HOLD', missing, why, goal_sha: goal && goal.sha ? goal.sha : null, gauge: gauge && gauge.state ? gauge.state : null,
    line: `HOLD · ${why}`, sufficientFor: 'did this goal close, report and fold — three receipts', notFor: 'whether the goal was good (Rice) — the report\'s reader answers that' });
  if (!goal || goal.kind !== 'goal' || !goal.sha) return hold('goal-row', 'no goal row on the tape for the goal file\'s own bytes — the goal has not closed (goal.mjs close)');
  const id = goal.proofs && goal.proofs.report_resend_id ? String(goal.proofs.report_resend_id) : null;
  if (!id) return hold('report', `goal ${goal.sha.slice(0, 12)} closed, no report on the row — goal-report.mjs --send`);
  // `sent` is the send log's rows, or a lookup (id) → boolean so a 32 MB log is searched from its tail for ONE id (2026-09-20)
  const carried = typeof sent === 'function' ? !!sent(id) : (Array.isArray(sent) ? sent : sent ? [sent] : []).some((r) => r && String(r.resendId) === id);
  if (!carried) return hold('report', `goal ${goal.sha.slice(0, 12)} names report ${id}, the send log does not carry it — not proven sent`);
  const state = gauge && gauge.state ? String(gauge.state) : null;
  if (state !== 'FREE' && state !== 'OVERDUE' && state !== 'FOLD-FIRST') return hold('gauge', 'no clear-gauge receipt — the hook writes one every turn');
  if (state === 'FOLD-FIRST') return hold('fold-first', `goal ${goal.sha.slice(0, 12)} closed and reported, but ${gauge.line || 'a clear now would lose unfolded bytes'} — fold first`);
  return { verdict: 'CLEAR', missing: null, goal_sha: goal.sha, report_resend_id: id, gauge: state,
    line: `CLEAR · goal ${goal.sha.slice(0, 12)} closed · report ${id} sent · gauge ${state} — the chair may be cleared`,
    sufficientFor: 'did this goal close, report and fold — three receipts', notFor: 'whether the goal was good (Rice) — the report\'s reader answers that' };
}

// ── the readers: every number from a file on disk, none computed twice ─────────────────────────────
export function readLose({ repo = REPO, pointer = process.env.VNA_STEER_FILE || resolve(repo, '.thetacog/vna-steer-file.json'), ledger = process.env.VNA_AMEND_LEDGER || resolve(repo, 'docs/specs/vna/amendments.ndjson'), tree = process.env.VNA_SPEC_TREE || resolve(repo, 'data/vna/spec-tree.json') } = {}) {
  let source = null; try { source = JSON.parse(readFileSync(pointer, 'utf8')).source || null; } catch {}
  // C170a leg 1: the watermark and the root's gzip come off the sidecar the fold writes (<tree>.watermark.json, a few hundred
  // bytes) — this ran on every hook turn and JSON.parsed the 57 MB tree for two integers. A tree with no sidecar yet (a fixture,
  // or before the first fold since leg 1) is parsed once as before; the next fold lands the sidecar.
  let t = readWatermark(tree); if (t) t = { watermark: t.watermark, nodes: { root: { mass: { gzip: t.rootGzip || 0 } } } };
  else { try { t = JSON.parse(readFileSync(tree, 'utf8')); } catch {} }
  const wm = t && Number.isInteger(t.watermark) ? t.watermark : -1;
  // 2026-09-20: the rows past the tree's watermark are read from the ledger's TAIL and stop at the watermark; the newest row
  // of the source is the first hit from the tail. The whole-ledger parse this replaced ran on every tool call of every session.
  const unf = ledgerTail(ledger, { afterIndex: t ? wm : -1, source }).rows;
  const last = unf.length ? unf[unf.length - 1] : lastRowWhere(ledger, (r) => !source || r.source === source, { hint: source });
  let fileBytes = null; try { fileBytes = source ? statSync(resolve(repo, source)).size : null; } catch {}
  const tailBytes = (fileBytes != null && last) ? Math.max(0, fileBytes - (last.offsetTo || 0)) : (fileBytes != null && !last ? fileBytes : 0);
  return { source, fileBytes, tailBytes, tapeRows: unf.length, tapeBytes: unf.reduce((a, r) => a + (r.bytes || 0), 0), specGzip: t && t.nodes && t.nodes.root && t.nodes.root.mass ? (t.nodes.root.mass.gzip || 0) : 0, watermark: wm, treeMissing: !t };
}
export function readCarry({ gauge = GAUGE } = {}) {
  try { const g = JSON.parse(readFileSync(gauge, 'utf8')); return { contextBytes: Number.isFinite(g.contextBytes) ? g.contextBytes : null, turns: g.turns ?? null, session: g.session ?? null, at: g.at ?? null, transcriptPath: g.transcriptPath ?? null }; } catch { return { contextBytes: null, turns: null, session: null, at: null, transcriptPath: null }; }
}
export function readGauge(opts = {}) {
  const lose = readLose(opts), carry = readCarry(opts);
  return { ...clearGauge({ ...lose, ...carry }), source: lose.source, at: carry.at, watermark: lose.watermark, transcriptPath: carry.transcriptPath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--readme')) {   // C98c: snapshot the live meter's window to the committed receipt, render the block into both READMEs
    const { ratioReceipt, writeRatioBlock, ratioLine, RATIO_RECEIPT, RATIO_SURFACES } = await import('./public-surface-register.mjs');
    const { writeFileSync } = await import('node:fs');
    { const { writeSparkBlock } = await import('./public-surface-register.mjs');   // C103e: the spark line under the wedge, its number READ off the committed ratio receipt (or the sentence without a number)
      let committed = null; try { committed = JSON.parse(readFileSync(resolve(REPO, RATIO_RECEIPT), 'utf8')); } catch {}
      const fp = resolve(REPO, 'packages/thetacog-mcp-vscode/README.md'); const before = readFileSync(fp, 'utf8'); const after = writeSparkBlock(before, committed); if (after !== before) writeFileSync(fp, after); console.log(`packages/thetacog-mcp-vscode/README.md: spark block ${after === before ? 'unchanged' : 'rendered'} (${committed && committed.window ? committed.window.would + ' would-be re-sent tokens' : 'no receipt — no number'})`); }
    { const { writeLoopBlock } = await import('./public-surface-register.mjs'); const { BUNDLE_TOKEN_CAP } = await import('./spec-tree.mjs');   // C104b: the five lines under the recipe, from the constant + the cap knob; static, never gated on the meter
      const fp = resolve(REPO, 'packages/thetacog-mcp-vscode/README.md'); const before = readFileSync(fp, 'utf8'); const after = writeLoopBlock(before, BUNDLE_TOKEN_CAP); if (after !== before) writeFileSync(fp, after); console.log(`packages/thetacog-mcp-vscode/README.md: loop block ${after === before ? 'unchanged' : 'rendered'} (cap ${BUNDLE_TOKEN_CAP})`); }
    const m = tokenMeter(); const receipt = ratioReceipt(m);
    if (receipt.not_re_sent_pct == null) { console.log(`${ratioLine(null)} — the meter's goal window is empty (${JSON.stringify(m.window)}); the receipt is not written, the READMEs keep what they carry`); process.exit(2); }
    writeFileSync(resolve(REPO, RATIO_RECEIPT), JSON.stringify(receipt, null, 2) + '\n');
    for (const rel of RATIO_SURFACES) { const fp = resolve(REPO, rel); const before = readFileSync(fp, 'utf8'); const after = writeRatioBlock(before, receipt); if (after !== before) writeFileSync(fp, after); console.log(`${rel}: ${after === before ? 'unchanged' : 'rendered'} · ${ratioLine(receipt)}`); }
    console.log(`wrote ${RATIO_RECEIPT} · window ${JSON.stringify(receipt.window)}`);
    process.exit(0);
  }
  const g = readGauge();
  if (process.argv.includes('--json')) console.log(JSON.stringify(g));
  else console.log(`${g.line}\n  sufficient for: ${g.sufficientFor} · NOT for: ${g.notFor}${existsSync(GAUGE) ? '' : '\n  (no hook receipt yet — the transcript is measured on the next Claude turn)'}`);
}
