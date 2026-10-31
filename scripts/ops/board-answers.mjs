#!/usr/bin/env node
// scripts/ops/board-answers.mjs — C1020e: AN ANSWER TYPED INTO A BOARD CELL IS PICKED UP ON THE NEXT TICK AND LANDS ON ITS ROW AS
// AN ANSWER, NEVER AS A PROMPT. Operator 2026-10-19 (relayed by wo1), verbatim: "The spreadsheet is supposed to be an asynchronous in
// context editing scheme ... I can say on my computer look in one action point that needs a decision answer it in context hit enter
// and instead of treating that as a prompt it picked up by [the loop] later if it fits the rest of the architecture ... instead of
// having a sequential row by row chat actually respond in context."
//
// The record (AXIOM 1, append-only, never rewritten):
//   data/vna/board-answers.ndjson           every filled (fill) cell ever pulled, one row each, keyed by a hash of tab·id·field·value
//   data/vna/board-answers-consumed.ndjson  one row per answer that was ACTED on: the hash, when, which spec row, what was done
// An answer is consumed exactly once: route() skips every hash already in the consumed ledger.
//
// What route() does with a Questions ANSWER whose id is a spec row id: it appends the operator's own words to that row as a verbatim
// span — ` (operator <date> via the board, verbatim: *"<answer>"*)` — which is the very thing spec-clarity reads for an operator span,
// so a NEEDS-OPERATOR row whose only gap was the span becomes CLEAR and the next /steer cycle dispatches it to the room that owns it.
// A YOUR-ACT row gets the same span, which records that the act was answered; the row stays the operator's until its guard passes.
// Every other filled cell (GRADE · COMMENT · EDIT · PRIORITY · INSTRUCTION · STATE · NEXT STEP …) is not a row answer: it stays on the
// ledger, unconsumed, and `pending [--room R]` lists it for the room whose surface it names. LLM-FREE. Nothing here sends anything.
//
//   node scripts/ops/board-answers.mjs pull-csv <file.csv> --tab <name>   append a sheet's filled cells (a Drive text/csv export)
//   node scripts/ops/board-answers.mjs route [--dry]                     land every unconsumed Questions ANSWER on its spec row
//   node scripts/ops/board-answers.mjs pending                            the filled cells still waiting for a room
//   node scripts/ops/board-answers.mjs tick                               the controller stage: pull (when a Drive remote exists) + route
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER = 'data/vna/board-answers.ndjson';
export const CONSUMED = 'data/vna/board-answers-consumed.ndjson';
export const SPECS = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'];
export const DECISIONS = 'data/vna/board-decisions.json';
export const DECISION_ANSWERS = 'data/vna/board-decision-answers.ndjson';

export const answerHash = (c) => createHash('sha1').update(`${c.tab}\u0000${c.id}\u0000${c.field}\u0000${c.value}`).digest('hex').slice(0, 16);
const readNd = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

// RFC-4180 CSV, enough for a Sheets export: quoted cells, doubled quotes, newlines inside quotes.
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// The filled (fill) cells of one tab, the same reading board.mjs --pull makes of an xlsx.
export function filledFromRows(tab, rows) {
  const hi = rows.findIndex((r) => (r || []).some((v) => /\(fill\)$/.test(String(v || ''))));
  if (hi < 0) return [];
  const header = rows[hi]; const out = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r || !r[0]) continue;
    header.forEach((h, ci) => { if (/\(fill\)$/.test(String(h || '')) && String(r[ci] ?? '').trim()) out.push({ tab, id: String(r[0]).trim(), field: String(h).replace(/ \(fill\)$/, ''), value: String(r[ci]).trim() }); });
  }
  return out;
}

// Append cells to the ledger, skipping any hash already there (a re-pull of an unchanged sheet adds nothing).
export function appendCells(cells, { ledger = resolve(REPO, LEDGER), at = new Date().toISOString() } = {}) {
  const seen = new Set(readNd(ledger).map((r) => r.hash));
  const fresh = cells.map((c) => ({ ...c, hash: answerHash(c) })).filter((c) => !seen.has(c.hash));
  if (fresh.length) appendFileSync(ledger, fresh.map((c) => JSON.stringify({ at, ...c })).join('\n') + '\n');
  return fresh;
}

const spanOf = (value, date) => ` (operator ${date} via the board, verbatim: *"${String(value).replace(/\s+/g, ' ').replace(/"/g, "'")}"*)`;

// Land every unconsumed Questions ANSWER on its spec row, exactly once.
// A decision (data/vna/board-decisions.json) that is not a spec row has no line to append to: its answer goes to the decision answers
// ledger with the owner room on it, which is where that room reads it.
export function route({ ledger = resolve(REPO, LEDGER), consumed = resolve(REPO, CONSUMED), specs = SPECS.map((s) => resolve(REPO, s)), decisions = resolve(REPO, DECISIONS), decisionAnswers = resolve(REPO, DECISION_ANSWERS), dry = false, at = new Date().toISOString() } = {}) {
  const decs = existsSync(decisions) ? (JSON.parse(readFileSync(decisions, 'utf8')).decisions || []) : [];
  const done = new Set(readNd(consumed).map((r) => r.hash));
  const todo = readNd(ledger).filter((c) => c.tab && /^(Questions|Decisions|TOP|Mailbox)/.test(c.tab) && /^(YOUR )?ANSWER$/.test(c.field) && !done.has(c.hash));   // C1042: the Mailbox's YOUR ANSWER lands like any answer
  const files = specs.filter((f) => existsSync(f)).map((f) => ({ f, lines: readFileSync(f, 'utf8').split('\n'), dirty: false }));
  const acted = []; const unmatched = [];
  for (const c of todo) {
    const re = new RegExp(`^(\\s*- \\[[ x]\\] ${c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(\\s|$)`);
    let hit = null;
    for (const s of files) { const i = s.lines.findIndex((l) => re.test(l)); if (i >= 0) { hit = { s, i }; break; } }
    if (!hit) {
      const d = decs.find((x) => x.id === c.id);
      if (!d) { unmatched.push(c); continue; }
      if (!dry) appendFileSync(decisionAnswers, JSON.stringify({ at, id: d.id, owner: d.owner, ask: d.ask, answer: c.value, hash: c.hash }) + '\n');
      acted.push({ hash: c.hash, at, id: c.id, spec: DECISION_ANSWERS, line: 0, action: `decision answered — for ${d.owner}` });
      continue;
    }
    if (!dry) { hit.s.lines[hit.i] += spanOf(c.value, at.slice(0, 10)); hit.s.dirty = true; }
    acted.push({ hash: c.hash, at, id: c.id, spec: hit.s.f.slice(REPO.length + 1), line: hit.i + 1, action: 'answer appended as the operator span' });
  }
  if (!dry) {
    for (const s of files) if (s.dirty) writeFileSync(s.f, s.lines.join('\n'));
    if (acted.length) appendFileSync(consumed, acted.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return { acted, unmatched };
}

export function pending({ ledger = resolve(REPO, LEDGER), consumed = resolve(REPO, CONSUMED) } = {}) {
  const done = new Set(readNd(consumed).map((r) => r.hash));
  return readNd(ledger).filter((c) => !done.has(c.hash) && !(/^Questions/.test(c.tab) && c.field === 'ANSWER'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2); const arg = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  if (cmd === 'pull-csv') {
    const file = a[0]; const tab = arg('--tab');
    if (!file || !tab) { console.error('usage: board-answers.mjs pull-csv <file.csv> --tab <name>'); process.exit(2); }
    const fresh = appendCells(filledFromRows(tab, parseCsv(readFileSync(resolve(file), 'utf8'))));
    console.log(`pulled ${fresh.length} new filled cell(s) from ${tab} → ${LEDGER}`);
  } else if (cmd === 'route') {
    const r = route({ dry: a.includes('--dry') });
    console.log(`${a.includes('--dry') ? 'would land' : 'landed'} ${r.acted.length} answer(s) on their rows${r.unmatched.length ? ` · ${r.unmatched.length} answer(s) name no spec row: ${r.unmatched.map((c) => c.id).join(', ')}` : ''}`);
    for (const x of r.acted) console.log(`  ${x.id} · ${x.spec}:${x.line}`);
  } else if (cmd === 'pending') {
    const p = pending();
    console.log(`${p.length} filled cell(s) waiting for a room`);
    for (const c of p.slice(0, 40)) console.log(`  ${c.tab} · ${c.id} · ${c.field}: ${String(c.value).slice(0, 100)}`);
  } else if (cmd === 'tick') {
    // The controller stage. A pull needs a Drive remote; without one the stage says why and still routes what is already pulled.
    const r = spawnSync(process.execPath, [resolve(REPO, 'scripts/ops/board.mjs'), '--pull-drive'], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    const pulled = r.status === 0 ? (r.stdout.trim().split('\n')[0] || 'pulled') : `UNMEASURED — ${((r.stderr || '').trim().split('\n').pop() || `pull exit ${r.status}`).replace(/^UNMEASURED — /, '')}`;
    const rt = route();
    // C1020o: his comments, read live with the same sign-in, author-gated and executed once.
    const cm = spawnSync(process.execPath, [resolve(REPO, 'scripts/ops/board-comments.mjs'), 'pull'], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    console.log(`board tick · pull: ${pulled} · route: ${rt.acted.length} landed · ${rt.unmatched.length} unmatched · ${(cm.stdout || '').trim().split('\n').pop() || `comments exit ${cm.status}`}`);
  } else { console.error('usage: board-answers.mjs pull-csv <file> --tab <name> | route [--dry] | pending | tick'); process.exit(2); }
}
