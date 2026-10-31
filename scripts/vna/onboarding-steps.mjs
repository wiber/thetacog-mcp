#!/usr/bin/env node
// C108 — THE ONBOARDING STEPS ARE ROWS THE OPERATOR TUNES. One parser over `docs/specs/vna/ONBOARDING-STEPS.md` (hand-edited,
// never generated), the shapes steer-ui's NEXT → consumes, and the per-machine reading.
//
// The three layers (docs/architecture/claude-rules/the-ratchet-invariants.md):
//   the CRYSTAL — parseOnboardingSteps: every step carries exactly the six fields (screen · click · receipt · null · predict ·
//                 measure) or the file is refused BY THE STEP'S NAME; a prediction carries a number; a measure names a door
//                 `measure-*.mjs` or says `unmeasured — no door named`
//   the SHAPE   — the file itself: no step travels without its receipt and its null
//   the READING — readOnboarding: each step's door runs in flow order on THIS machine; the walk stops at the first NOT HELD (that
//                 step is next) or at the first missing / UNMEASURED door (the reading is UNMEASURED at that step — never a
//                 fallback to a regex, a file glance, or a guess)
// LLM-free.   node scripts/vna/onboarding-steps.mjs [--file <path>] [--json]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STEPS_FILE = process.env.VNA_ONBOARDING_STEPS || resolve(REPO, 'docs/specs/vna/ONBOARDING-STEPS.md');
export const FIELDS = Object.freeze(['screen', 'click', 'receipt', 'null', 'predict', 'measure']);
export const NO_DOOR = 'unmeasured — no door named';
/** the sidebar card a step's control lives on, by its emoji — the card is a property of the control, never typed per step */
export const CARD_OF_EMOJI = Object.freeze({ '🚶': 'walk', '📄': 'contract', '⚡': 'runner', '🔍': 'runner', '💳': 'attest', '🔗': 'attest', '🔑': 'attest', '🪙': 'cog', '⤵': 'bridge' });
const HEAD_RE = /^## (\d+)\. (\S+) · (\S+) · (C\d+[a-z]?)(?: · (branch))?\s*$/u;
const FIELD_RE = /^([a-z]+):\s*(.*)$/;

export function parseOnboardingSteps(text, { repo = REPO } = {}) {
  const lines = String(text).split('\n');
  const blocks = []; let cur = null;
  for (const raw of lines) {
    const h = HEAD_RE.exec(raw);
    if (h) { cur = { n: Number(h[1]), key: h[2], emoji: h[3], row: h[4], branch: h[5] === 'branch', fields: {}, order: [] }; blocks.push(cur); continue; }
    if (!cur) continue;
    if (/^## /.test(raw)) { cur = null; continue; }   // a heading that is not a step ends the block
    const f = FIELD_RE.exec(raw); if (!f) continue;
    if (cur.fields[f[1]] !== undefined) throw new Error(`onboarding-steps: step ${cur.n} ${cur.key} carries \`${f[1]}:\` twice`);
    cur.fields[f[1]] = f[2].trim(); cur.order.push(f[1]);
  }
  if (!blocks.length) throw new Error('onboarding-steps: no steps — a step is `## <n>. <key> · <emoji> · <row>` followed by its six fields');
  const seen = new Set();
  return blocks.map((b) => {
    const name = `step ${b.n} ${b.key}`;
    if (seen.has(b.key)) throw new Error(`onboarding-steps: ${name} repeats the key \`${b.key}\``); seen.add(b.key);
    for (const f of FIELDS) if (!b.fields[f]) throw new Error(`onboarding-steps: ${name} is missing \`${f}:\` — every step carries exactly ${FIELDS.join(' · ')}`);
    const extra = b.order.find((f) => !FIELDS.includes(f));
    if (extra) throw new Error(`onboarding-steps: ${name} carries a seventh field \`${extra}:\` — exactly six: ${FIELDS.join(' · ')}`);
    const q = /"([^"]+)"/.exec(b.fields.screen);
    if (!q) throw new Error(`onboarding-steps: ${name} screen: carries no "quoted" line — the words on the card, verbatim`);
    if (!/\d/.test(b.fields.predict)) throw new Error(`onboarding-steps: ${name} predict: carries no number — a prediction is a number the operator edits (C93f)`);
    const m = b.fields.measure;
    if (m !== NO_DOOR && !/^measure-[\w.-]+\.mjs$/.test(basename(m))) throw new Error(`onboarding-steps: ${name} measure: must name a door under scripts/vna/measure-*.mjs or say \`${NO_DOOR}\` — got \`${m}\``);
    if (/^0\b|\b0$/.test(b.fields.null.trim())) throw new Error(`onboarding-steps: ${name} null: reads a zero — an absence is UNMEASURED or not run with the command, never 0`);
    const click = b.fields.click; const beside = /· (.+?) beside it$/.exec(click);
    const button = /^none\b/i.test(click) ? null : click.split(' · ')[0].trim();
    const sec = /(\d+(?:\.\d+)?)\s*s\b/.exec(b.fields.predict); const drop = /drop-off\s*(\d+(?:\.\d+)?)\s*%/.exec(b.fields.predict);
    return {
      index: b.n, key: b.key, emoji: b.emoji, row: b.row, branch: b.branch, fields: b.fields,
      line: q[1], button, beside: beside ? beside[1].trim() : null, card: CARD_OF_EMOJI[b.emoji] || 'attest',
      predict: { seconds: sec ? Number(sec[1]) : null, dropoff: drop ? Number(drop[1]) : null, text: b.fields.predict },
      measure: m === NO_DOOR ? null : m, measurePath: m === NO_DOOR ? null : (isAbsolute(m) ? m : resolve(repo, m)),
    };
  });
}

// C94b.5: an absent steps file is a reading, never a throw — the page prints `not run — <path> absent` for the NEXT line and renders the rest
export function loadSteps(file = STEPS_FILE, opts = {}) { if (!existsSync(file)) return Object.assign([], { missing: `not run — ${file} absent` }); return parseOnboardingSteps(readFileSync(file, 'utf8'), opts); }
let cache = null;
function cached() { if (!cache) cache = loadSteps(); return cache; }
/** the shape steer-ui's nextStep consumes: key → { emoji, line, button, beside?, card, row } — the words are the file's */
export function onboardSteps(steps = cached()) {
  return Object.freeze(Object.fromEntries(steps.map((s) => [s.key, Object.freeze({ emoji: s.emoji, line: s.line, button: s.button, ...(s.beside ? { beside: s.beside } : {}), card: s.card, row: s.row })])));
}
/** the checklist order: the file's non-branch steps */
export function onboardSequence(steps = cached()) { return Object.freeze(steps.filter((s) => !s.branch).map((s) => s.key)); }

/** run one step's door: { status, why?, evidence?, null? } — UNMEASURED with why when the door is missing, fails, or answers nonsense */
export function runDoor(step, { env = process.env, timeout = 15000 } = {}) {
  if (!step.measurePath) return { status: 'UNMEASURED', why: 'no door named' };
  const o = spawnSync(process.execPath, [step.measurePath, '--json'], { encoding: 'utf8', env: { ...process.env, ...env }, timeout });
  if (o.error) return { status: 'UNMEASURED', why: `the door ${step.measure} did not run — ${o.error.message}` };
  if (o.status !== 0) return { status: 'UNMEASURED', why: `the door ${step.measure} exited ${o.status} — ${String(o.stderr || '').trim().slice(0, 120)}` };
  let j; try { j = JSON.parse(String(o.stdout).trim().split('\n').pop()); } catch { return { status: 'UNMEASURED', why: `the door ${step.measure} printed no JSON` }; }
  if (!['HELD', 'NOT HELD', 'UNMEASURED'].includes(j.status)) return { status: 'UNMEASURED', why: `the door ${step.measure} answered \`${j.status}\` — not HELD / NOT HELD / UNMEASURED` };
  return j;
}

/** the reading on THIS machine: doors in flow order; stop at the first NOT HELD (next) or the first UNMEASURED (the reading is) */
export function readOnboarding(steps, { env = process.env, run = runDoor } = {}) {
  const readings = [];
  for (const s of steps) {
    const r = run(s, { env }); readings.push({ index: s.index, key: s.key, branch: s.branch, status: r.status, why: r.why || null, evidence: r.evidence || null });
    if (r.status === 'UNMEASURED') return { status: 'UNMEASURED', at: s, why: r.why || 'the door answered UNMEASURED', next: null, readings };
    if (r.status === 'NOT HELD' && !s.branch) return { status: 'MEASURED', next: s, at: null, why: null, readings };
    if (r.status === 'HELD' && s.branch) return { status: 'MEASURED', next: s, at: null, why: null, readings };   // an open branch is what is next
  }
  return { status: 'MEASURED', next: null, at: null, why: null, readings };   // every step HELD, no branch open — the loop is theirs
}

export function onboardingLine(steps, reading) {
  const doors = steps.filter((s) => s.measure).length;
  const head = `onboarding: ${steps.length} steps · ${doors} with a receipt door · ${steps.length - doors} unmeasured · next for THIS machine: `;
  if (reading.status === 'UNMEASURED') return head + `UNMEASURED at step ${reading.at.index} ${reading.at.key} — ${reading.why}`;
  if (!reading.next) return head + 'none — every step HELD, the loop is yours';
  return head + `step ${reading.next.index} ${reading.next.key}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2); const fi = a.indexOf('--file'); const file = fi >= 0 ? resolve(a[fi + 1]) : STEPS_FILE;
  let steps; try { steps = loadSteps(file); } catch (e) { process.stderr.write(String(e.message || e) + '\n'); process.exit(2); }
  const reading = readOnboarding(steps);
  const line = onboardingLine(steps, reading);
  if (a.includes('--json')) process.stdout.write(JSON.stringify({ file, line, status: reading.status, next: reading.next ? { index: reading.next.index, key: reading.next.key, line: reading.next.line, button: reading.next.button, row: reading.next.row } : null, at: reading.at ? { index: reading.at.index, key: reading.at.key } : null, why: reading.why, readings: reading.readings, steps: steps.map((s) => ({ index: s.index, key: s.key, emoji: s.emoji, row: s.row, branch: s.branch, line: s.line, button: s.button, receipt: s.fields.receipt, null: s.fields.null, predict: s.predict, measure: s.measure || NO_DOOR })) }) + '\n');
  else {
    process.stdout.write(line + '\n');
    for (const s of steps) { const r = reading.readings.find((x) => x.key === s.key); process.stdout.write(`  ${s.index} · ${s.emoji} ${s.key}${s.branch ? ' (branch)' : ''} · ${s.row} · receipt: ${s.fields.receipt.slice(0, 90)}${s.fields.receipt.length > 90 ? '…' : ''} · measure: ${s.measure || NO_DOOR}${r ? ` · ${r.status}${r.why ? ` — ${r.why}` : ''}` : ' · not read (the walk stopped before it)'}\n`); }
  }
}
