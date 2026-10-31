#!/usr/bin/env node
// scripts/pmu/knock-on-auto.mjs — THE STOP-HOOK WORKER (STREAMING-SPEC §9c, explicit operator
// go 2026-07-22). Fired DETACHED by scripts/cog/knock-on-stop-hook.sh when a turn completes:
// read the transcript, take the last user prompt (P) and the turn's answer (the payload T),
// and IF the existing topology misses P, run the knock-on loop so the grid learns the prompt
// that just beat it. Zero human intervention — the demo climax is watching this fire live.
//
// FIRE DISCIPLINE (no runaway fracturing — every skip logged, never silent):
//   MISS-GATE   fire only when the existing top catch scores <= MISS_MAX_SCORE stemmed hits
//   DEDUPE      born_of prompt-hash — the same prompt never seats twice
//   DAILY CAP   at most MAX_AUTO_PER_DAY auto shelves per UTC day
//   SIZE GATE   prompt must be >= MIN_PROMPT_CHARS (tiny prompts carry no vocabulary)
//
// ROLLBACK GUARD: every seat logs the exact amputation command to .thetacog/knock-on-live.log
// so the operator can tombstone a misbehaving shelf mid-demo without skipping a beat.
// LLM-FREE: no model call anywhere; the payload is whatever the turn already produced.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runKnockOn, rankTemplates, REEF_PATH, HISTORY_PATH, MISS_MAX_SCORE } from './knock-on.mjs';
import { resolveLattice } from './lattice-resolve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const LIVE_LOG = resolve(REPO, '.thetacog/knock-on-live.log');

// MISS_MAX_SCORE now lives in knock-on.mjs (single source of truth): the lock's class-closure
// floor and this gate MUST be the same number, or a seat can fail to retire its firing condition.
export { MISS_MAX_SCORE };
export const MAX_AUTO_PER_DAY = 12;  // auto-shelf ceiling per UTC day (anti context-bloat, §4 paging)
export const MIN_PROMPT_CHARS = 120; // below this a prompt has no vocabulary worth seating

const sha12 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

function log(line) {
  const msg = `${new Date().toISOString()} ${line}`;
  console.log(msg);
  try { mkdirSync(dirname(LIVE_LOG), { recursive: true }); appendFileSync(LIVE_LOG, msg + '\n'); } catch { /* best-effort */ }
}

// Claude Code transcript JSONL → { prompt, answer } (last user text, last assistant text)
export function extractTurn(transcriptPath) {
  const text = readFileSync(transcriptPath, 'utf8');
  let prompt = null, answer = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const m = j.message || j;
    const role = m.role || j.type;
    const content = m.content;
    let t = '';
    if (typeof content === 'string') t = content;
    else if (Array.isArray(content)) t = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (!t.trim()) continue;
    if (role === 'user' && !/^<[a-z-]+>/.test(t.trim())) prompt = t;       // skip tool-result/system-shaped turns
    if (role === 'assistant') answer = t;
  }
  return { prompt, answer };
}

// strip the echoed lens receipt block from the answer — the payload is the substance, not the frame
export function stripReceiptBlock(answer) {
  return String(answer || '')
    .split('\n')
    .filter((l) => !/^─── /.test(l) && !/^────/.test(l) && !/^[🪸🖥️⏱️🧭🌀🛰️📜📄📈📐◎✅]/u.test(l))
    .join('\n').trim();
}

export function shouldFire({ prompt, reefPath = REEF_PATH, historyPath = HISTORY_PATH } = {}) {
  if (!prompt || prompt.length < MIN_PROMPT_CHARS) return { fire: false, why: `prompt too small (<${MIN_PROMPT_CHARS} chars)` };
  const reef = JSON.parse(readFileSync(reefPath, 'utf8'));
  const templates = reef.templates || [];
  const born = sha12(prompt);
  if (templates.some((t) => t.born_of === born)) return { fire: false, why: `dedupe: born_of ${born} already seated` };
  const top = rankTemplates(prompt, templates)[0];
  if ((top?.n || 0) > MISS_MAX_SCORE) return { fire: false, why: `no miss: top catch ${top.name} scores ${top.n} > ${MISS_MAX_SCORE}` };
  let today = 0;
  try {
    const day = new Date().toISOString().slice(0, 10);
    today = readFileSync(historyPath, 'utf8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.applied && String(r.child_name || '').startsWith('auto-') && String(r.ts || '').startsWith(day)).length;
  } catch { /* no history yet */ }
  if (today >= MAX_AUTO_PER_DAY) return { fire: false, why: `daily cap: ${today}/${MAX_AUTO_PER_DAY} auto shelves today` };
  return { fire: true, why: `miss: top catch scores ${top?.n || 0} <= ${MISS_MAX_SCORE}`, born };
}

// "B,C1" → ['B','C1'] — the ranks whose full self-definitions the auto-tick must have in play
export function ranksOfCoord(coord) {
  return String(coord || '').split(',').map((s) => s.trim()).filter((s) => /^[ABC][1-3]?$/.test(s));
}

// FULL-DUMP CONTEXT for the auto-tick (operator 2026-07-22): place the prompt via the lens
// (fresh process, deterministic), then resolve the placed coord's ranks into their complete
// addressed self-definitions. Returns { context, cells, coord } — context '' when placement
// fails (recorded honestly, never faked).
export function resolveAutoContext(prompt) {
  let coord = null;
  try {
    const out = execFileSync('node', [resolve(HERE, 'prompt-lens.mjs'), '--prompt', String(prompt).slice(0, 2000), '--json'],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
    const j = JSON.parse(out.slice(out.indexOf('{')));
    coord = j?.boundary?.center || j?.boundary?.coord || null;
  } catch { /* placement unavailable — context stays empty, receipted as such */ }
  const ranks = ranksOfCoord(coord);
  if (!ranks.length) return { context: '', cells: 0, coord };
  // mode:'full' — the knock-on injector WANTS the whole coordinate mass as spawning context for a
  // child shelf; it is not a verdict comparison, so the size-band law that governs the intent path
  // (tests/pmu-simulator/intent-size-band.test.mjs) does not bind here. Stated explicitly so the
  // default flip to axis-descriptors (2026-07-22) cannot silently starve this caller.
  const r = resolveLattice('', { authorized: ranks, mode: 'full' });
  return { context: r.corpus, cells: r.cells.reduce((a, c) => a + (c.bytes > 0 ? 1 : 0), 0), coord, cellList: r.cells };
}

// The stays-confirmed line for the demo page: green ONLY when the latest applied auto seat's
// receipt proves the full dump was in play at measurement time. Reads receipts, never prose.
export function autoContextStatus({ historyPath = HISTORY_PATH } = {}) {
  try {
    const rows = readFileSync(historyPath, 'utf8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.applied && String(r.child_name || '').startsWith('auto-'));
    const last = rows[rows.length - 1];
    if (!last) return { green: false, note: 'auto knock-on: no auto seat receipted yet' };
    if ((last.context_bytes || 0) > 10000 && (last.context_cells || 0) > 0) {
      return { green: true, note: `auto knock-on: full-dump context ✓ — last seat ${last.child_name} measured with ${last.context_bytes.toLocaleString('en-US')}B across ${last.context_cells} rank-corpora (context-ncd ${last.context_ncd})` };
    }
    return { green: false, note: `auto knock-on: last seat ${last.child_name} carried ${(last.context_bytes || 0).toLocaleString('en-US')}B of context — full dump not yet in play` };
  } catch { return { green: false, note: 'auto knock-on: no auto receipts yet' }; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
  const transcript = arg('--transcript');
  if (!transcript || !existsSync(transcript)) { log(`knock-on-auto: no transcript (${transcript}) — exit`); process.exit(0); }
  const { prompt, answer } = extractTurn(transcript);
  const payload = stripReceiptBlock(answer);
  const gate = shouldFire({ prompt });
  if (!gate.fire) { log(`knock-on-auto SKIP — ${gate.why}`); process.exit(0); }
  if (!payload || payload.length < 80) { log('knock-on-auto SKIP — turn produced no substantial payload'); process.exit(0); }
  const name = `auto-${gate.born}`;
  try {
    const ctx = resolveAutoContext(prompt);
    if (ctx.cells) log(`knock-on-auto CONTEXT — placed ${ctx.coord} · ${ctx.cells} rank-corpora · ${Buffer.byteLength(ctx.context, 'utf8').toLocaleString('en-US')}B of addressed self-definitions in play`);
    else log(`knock-on-auto CONTEXT — none resolved (coord ${ctx.coord || 'unplaced'}) — recorded honestly`);
    const row = runKnockOn({ prompt, payload, name, apply: true, context: ctx.context || null, contextCells: ctx.cells });
    if (row.applied) {
      const dep = row.deposit ? `deposit ${row.deposit.intent_coord || '?'}→${row.deposit.payload_coord || '?'}${row.deposit.hit ? ' HIT' : ''}${row.deposit.dsigma != null ? ` Δσ ${row.deposit.dsigma}` : ''}` : 'deposit —';
      log(`knock-on-auto SEATED ${name} · LOCK in ${row.iterations} iters · NCD ${row.coherence_delta[0]} → ${row.coherence_delta[row.coherence_delta.length - 1]} · ${dep} · context ${row.context_bytes.toLocaleString('en-US')}B/${row.context_cells ?? 0} cells (ncd ${row.context_ncd ?? '—'}) · fresh-lens ${JSON.stringify(row.verify)} · AMPUTATE: node scripts/pmu/knock-on.mjs --revert ${name}`);
    } else {
      log(`knock-on-auto ORPHANED ${name} — ${row.stop_reason} (payload quarantined, nothing lost)`);
    }
  } catch (e) { log(`knock-on-auto ERROR — ${String(e).slice(0, 200)}`); }
}
