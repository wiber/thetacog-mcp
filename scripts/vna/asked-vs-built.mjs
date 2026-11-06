#!/usr/bin/env node
// scripts/vna/asked-vs-built.mjs — ASKED VS BUILT IS A DOOR, NOT A FEELING (C106, operator 2026-09-20: "fix the many things
// still wrong with the presentation in the left panel, and the extension page, most of them has been asked for already and
// should be in the spec - thats an example of drift we should be able to detect, that we cant is a big issue").
//
// The drift he names is between what was ASKED of two surfaces — the VS Code sidebar (the page steer-ui.mjs paints and
// vna-view.ts embeds) and the extension page (the marketplace listing, the extension README, HOWTO-IDE) — and what is BUILT.
// A row on the spec is the ask; the guard named on the row is the only thing that can say built. This door reads both,
// LLM-free, and prints one line per ask:
//
//   asked <id> · <headline> · built|open|UNMEASURED|CONTRADICTED · <evidence>
//
//   built         the row is ticked AND its named guard is on disk AND `node --test <guard>` is green
//   open          the row is unticked — whatever its guard says (a green guard under an open row is evidence to tick, not a tick)
//   UNMEASURED    the row names no guard, or names one that is not on disk, or one that is all test.todo (exits 0 having asserted
//                 nothing — spec-check would tick on it; this door does not) — never a zero, never a feeling, never built
//   CONTRADICTED  the row is ticked while its named guard is red — a tick the guard does not back
//
// plus every PENDING ask of SPEC-FROM-TREE.md (a released clip snippet that is not yet a row — C98g): `open · pending — not a
// row (no guard named)`. The summary line for the heartbeat strip:
//
//   asked-vs-built: <n> asked · <b> built · <o> open · <u> UNMEASURED[ · <c> CONTRADICTED][ · <p> pending]
//
// Which rows are asks about these surfaces: a row whose `paths:` globs (C92c — rowPaths, the one parser) cover a SURFACE_FILE,
// or whose text names one (the file's path or basename — a row that names `steer-ui.mjs` is a row about the panel; naming IS
// the construct here, there is no deeper thing to compute), or a row of the C106 family. A row about anything else is not an ask
// of this door and never counted.
//
// The strip reads this door's RECEIPT (.thetacog/vna-asked-vs-built.json, written by the CLI) and never recomputes: running
// every guard takes minutes and belongs to the door, not to a repaint. Absent or torn → `not run — <command>`.
//
//   node scripts/vna/asked-vs-built.mjs            FAST: every ask read off the tick and whether its guard is on disk — no guard
//                                                  runs, under a second; a ticked row whose guard was not run reads UNMEASURED; writes no receipt
//   node scripts/vna/asked-vs-built.mjs --run      FULL: every distinct guard run once (four at a time, minutes) — the only mode
//                                                  that can say built; writes the receipt the strip reads
//                                                  C287: takes .thetacog/heavy.lock first — never beside a model bench (heavy-lock.mjs)
//   node scripts/vna/asked-vs-built.mjs --json     the same as JSON (either mode)
//   node scripts/vna/asked-vs-built.mjs --no-pending   rows only (the pending list is long and mostly not the operator's)
//
// @guard tests/vna/c106-asked-vs-built.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specRows, pendingAsks, LEDGER, TREE } from './spec-tree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SPEC = process.env.VNA_SPEC || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const RECEIPT = process.env.VNA_ASKED_VS_BUILT || resolve(REPO, '.thetacog/vna-asked-vs-built.json');
export const CMD = 'node scripts/vna/asked-vs-built.mjs';
export const NOT_RUN = `asked-vs-built: not run — ${CMD}`;

/** the two surfaces, by file: the sidebar (what steer-ui paints, what the extension embeds and commands) and the extension page */
export const SURFACE_FILES = Object.freeze([
  'scripts/vna/steer-ui.mjs',
  'docs/specs/vna/steer/latest.html',
  'packages/thetacog-mcp-vscode/src/vna-view.ts',
  'packages/thetacog-mcp-vscode/src/vna-cockpit.ts',
  'packages/thetacog-mcp-vscode/src/vna-steer.ts',
  'packages/thetacog-mcp-vscode/src/vna-tail.ts',
  'packages/thetacog-mcp-vscode/src/commands.ts',
  'packages/thetacog-mcp-vscode/package.json',
  'packages/thetacog-mcp-vscode/README.md',
  'docs/specs/vna/HOWTO-IDE.html',
]);
// the words a row uses for the surfaces when it names no file — the panel and the listing by their names
const SURFACE_WORDS = Object.freeze(['left panel', 'sidebar', 'side panel', 'marketplace', 'the listing', 'extension page', 'extension README', 'the README recipe', 'THE SECOND READER', 'heartbeat strip']);

/** why a row is an ask about the surfaces — the file or word it names — or null when it is not */
export function surfaceOf(row) {
  if (/^C106[a-z]?$/.test(row.label || row.id || '')) return 'C106 family';
  const text = String(row.text || '');
  for (const f of SURFACE_FILES) {
    const b = basename(f);
    if ((row.paths || []).some((g) => globHit(f, g))) return `paths: ${f}`;
    if (text.includes(f)) return f;
    // a bare basename only when it is unambiguous for these surfaces (README.md and package.json name many packages)
    if (!/^(README\.md|package\.json|latest\.html)$/.test(b) && text.includes(b)) return f;
  }
  const lc = text.toLowerCase();
  for (const w of SURFACE_WORDS) if (lc.includes(w.toLowerCase())) return `names "${w}"`;
  return null;
}
// the same small glob declared-reading.mjs reads (`**` any depth, `*` one segment) — inlined so this door has one import
function globHit(path, glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { const slash = glob[i + 2] === '/'; re += slash ? '(?:.*/)?' : '.*'; i += slash ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(path);
}

const GUARD_RE = /\bguard[:s]?\s*`([^`]+)`/i;   // the same shape spec-check.mjs ticks by
/** the headline of a row: its text after the label and the parenthesised stamps, cut at the first sentence break, ≤ 90 chars */
export function headlineOf(text) {
  let s = String(text || '').replace(/^(C\d+[a-z]?|T\d+|P\d+\.\d+)\s+/, '');
  // leading (guard: …) (declared …) (built …: … (16 files) …) stamps — balanced groups at any depth, scanned, not regexed
  for (;;) {
    if (s[0] !== '(') break;
    let d = 0, i = 0; for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) break; }
    if (d !== 0) break;
    s = s.slice(i + 1).trimStart();
  }
  s = s.replace(/\s+/g, ' ').trim();
  const cut = s.search(/[:—]\s|\.\s|\s\(/);   // a sentence break, or the first parenthesis (operator stamps, guards named inline)
  if (cut > 12) s = s.slice(0, cut);
  return s.length > 90 ? s.slice(0, 87).trimEnd() + '…' : s;
}

/** the asks: every spec row about a surface, in spec order, plus the C106 family — { id, done, guard, headline, why, text } */
export function asksOf(md) {
  const out = [];
  for (const r of specRows(md)) {
    const why = surfaceOf(r); if (!why) continue;
    const g = GUARD_RE.exec(r.text);
    out.push({ id: r.label, done: !!r.done, guard: g ? g[1].trim() : null, headline: headlineOf(r.text), why, text: r.text });
  }
  return out;
}

// A GREEN VERDICT MUST NOT DEPEND ON WHO IS ASKING (spec-check.mjs): node --test exits 0 on a failing file under
// NODE_TEST_CONTEXT, so the child gets a scrubbed env.
const CLEAN_ENV = (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; })();
/** node --test's own tally → the verdict; a file whose every test is todo exits 0 and asserted nothing — that is not green */
export function verdictOf(rel, text, failed) {
  const n = (k) => Number((text.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
  const pass = n('pass'), todo = n('todo');
  if (failed) { const failing = [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]); return { state: 'red', detail: failing.length ? `not ok: ${failing.slice(0, 3).join(' · ')}${failing.length > 3 ? ` (+${failing.length - 3})` : ''}` : `${rel} failed` }; }
  if (pass === 0 && todo > 0) return { state: 'todo', detail: `${rel} is all todo (${todo}) — no assertion ran` };
  return { state: 'green', detail: `${rel} green${todo > 0 ? ` (${todo} todo)` : ''}` };
}
export function runGuardLive(rel) {
  if (!existsSync(resolve(REPO, rel))) return { state: 'absent', detail: `${rel} does not exist` };
  try {
    return verdictOf(rel, execFileSync('node', ['--test', rel], { cwd: REPO, stdio: 'pipe', timeout: 300000, env: CLEAN_ENV }).toString(), false);
  } catch (e) {
    return verdictOf(rel, (e.stdout?.toString() || '') + (e.stderr?.toString() || ''), true);
  }
}

/** every distinct guard once, `pool` at a time — the CLI's speed; the reading itself stays the pure sync function */
export function runGuardsPooled(rels, pool = 4) {
  const out = new Map(); const queue = [...rels];
  // each lane gets its own scratch dir: the VNA guards pin their fixtures to fixed names under TMPDIR / CLAUDE_SCRATCHPAD_DIR
  // (_hermetic.mjs), so two guards in one dir race each other and the verdict depends on the schedule (measured 2026-09-20: 7 red
  // sequential, 4 different red pooled) — isolation makes the pooled verdict the sequential verdict
  const laneEnv = (i) => { const dir = resolve(process.env.CLAUDE_SCRATCHPAD_DIR || process.env.TMPDIR || '/tmp', `avb-lane-${process.pid}-${i}`); mkdirSync(dir, { recursive: true }); return { ...CLEAN_ENV, TMPDIR: dir, CLAUDE_SCRATCHPAD_DIR: dir }; };
  const one = (rel, env) => new Promise((done) => {
    if (!existsSync(resolve(REPO, rel))) { out.set(rel, { state: 'absent', detail: `${rel} does not exist` }); return done(); }
    execFile('node', ['--test', rel], { cwd: REPO, timeout: 300000, env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      out.set(rel, verdictOf(rel, String(stdout || '') + String(stderr || ''), !!err));
      done();
    });
  });
  const worker = async (i) => { const env = laneEnv(i); while (queue.length) await one(queue.shift(), env); };
  return Promise.all(Array.from({ length: Math.max(1, pool) }, (_, i) => worker(i))).then(() => out);
}

/** FAST: the guard's presence on disk, never its verdict — the strip's sub-second reading; a present guard is 'notrun' */
export function runGuardFast(rel) { return existsSync(resolve(REPO, rel)) ? { state: 'notrun', detail: `${rel} on disk, not run — ${CMD} --run` } : { state: 'absent', detail: `${rel} does not exist` }; }

/** the state of one ask, read off its tick and its guard's result — pure over the runner it is handed */
export function stateOf(ask, { runGuard = runGuardLive } = {}) {
  if (ask.pending) return { ...ask, state: 'open', evidence: `pending — not a row (no guard named) · basin ${ask.basin || '?'}` };
  if (!ask.guard) return { ...ask, state: 'UNMEASURED', evidence: 'no guard named' };
  const r = runGuard(ask.guard);
  if (r.state === 'absent') return { ...ask, state: ask.done ? 'UNMEASURED' : 'open', evidence: `${ask.done ? 'ticked but ' : 'unticked · '}guard absent on disk: ${ask.guard}` };
  if (r.state === 'todo') return { ...ask, state: ask.done ? 'UNMEASURED' : 'open', evidence: `${ask.done ? 'ticked but ' : 'unticked · '}${r.detail}` };
  if (r.state === 'notrun') return { ...ask, state: ask.done ? 'UNMEASURED' : 'open', evidence: `${ask.done ? 'ticked · ' : 'unticked · '}${r.detail}` };
  if (!ask.done) return { ...ask, state: 'open', evidence: `unticked · guard ${r.state}: ${r.detail}` };
  if (r.state === 'green') return { ...ask, state: 'built', evidence: r.detail };
  return { ...ask, state: 'CONTRADICTED', evidence: `ticked while its guard is red: ${r.detail}` };
}

/** the whole reading: rows + pending, each guard run once, the summary counted over exclusive classes */
export function askedVsBuilt({ md, pending = [], runGuard = runGuardLive, mode = 'run' } = {}) {
  const cache = new Map();
  const once = (rel) => { if (!cache.has(rel)) cache.set(rel, runGuard(rel)); return cache.get(rel); };
  const asks = asksOf(md).map((a) => stateOf(a, { runGuard: once }));
  for (const p of pending) asks.push(stateOf({ id: p.id, pending: true, basin: p.basin, headline: headlineOf(p.text), text: p.text, guard: null, done: false }, { runGuard: once }));
  const n = (s) => asks.filter((a) => a.state === s && !a.pending).length;
  const summary = { asked: asks.length, built: n('built'), open: n('open'), unmeasured: n('UNMEASURED'), contradicted: n('CONTRADICTED'), pending: asks.filter((a) => a.pending).length };
  return { at: new Date().toISOString(), mode, asks, summary };
}

export function askedVsBuiltLine(r) {
  const s = r.summary;
  let line = `asked-vs-built: ${s.asked} asked · ${s.built} built · ${s.open} open · ${s.unmeasured} UNMEASURED`;
  if (s.contradicted) line += ` · ${s.contradicted} CONTRADICTED`;
  if (s.pending) line += ` · ${s.pending} pending`;
  if (r.mode === 'fast') line += ` · fast — guards not run: ${CMD} --run`;
  return line;
}
export function askLine(a) { return `asked ${a.id} · ${a.headline} · ${a.state} · ${a.evidence}`; }

/** the strip's read: the receipt's own line, or not run — never a recomputation, never a crash */
export function readAskedVsBuiltLine(file = RECEIPT) {
  try { const j = JSON.parse(readFileSync(file, 'utf8')); return typeof j.line === 'string' && j.line.startsWith('asked-vs-built:') ? j.line : NOT_RUN; } catch { return NOT_RUN; }
}
/** the strip's line: the full run's receipt when one exists, else the fast glance (sub-second, guards not run) — one door, two speeds */
export function stripLine({ file = RECEIPT, md = null } = {}) {
  const fromReceipt = readAskedVsBuiltLine(file);
  if (fromReceipt !== NOT_RUN) return fromReceipt;
  const text = md ?? (() => { try { return readFileSync(SPEC, 'utf8'); } catch { return null; } })();
  if (text == null) return NOT_RUN;
  return askedVsBuiltLine(askedVsBuilt({ md: text, pending: [], runGuard: runGuardFast, mode: 'fast' }));
}
export function readAskedVsBuilt(file = RECEIPT) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }

function livePending() {
  try {
    const tree = JSON.parse(readFileSync(TREE, 'utf8'));
    return pendingAsks(tree, { ledger: LEDGER, specMd: readFileSync(SPEC, 'utf8') }).pending.map((p) => ({ id: p.id, text: p.text, basin: p.basin }));
  } catch { return []; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const md = readFileSync(SPEC, 'utf8');
  const full = a.includes('--run');
  const pending = a.includes('--no-pending') ? [] : livePending();
  let r;
  if (full) {
    // C287: the full run is a HEAVY job — it never runs beside a model bench; held → a bounded wait, then exit 0 naming the holder
    await (await import('./heavy-lock.mjs')).holdOrExit('asked-vs-built --run');
    const guards = [...new Set(asksOf(md).map((x) => x.guard).filter(Boolean))];
    const results = await runGuardsPooled(guards, Number(process.env.VNA_AVB_POOL) || 4);
    r = askedVsBuilt({ md, pending, runGuard: (rel) => results.get(rel) || runGuardLive(rel), mode: 'run' });
  } else r = askedVsBuilt({ md, pending, runGuard: runGuardFast, mode: 'fast' });
  const line = askedVsBuiltLine(r);
  const receipt = { at: r.at, mode: r.mode, line, summary: r.summary, asks: r.asks.map(({ text, ...rest }) => rest) };
  if (full) { try { mkdirSync(dirname(RECEIPT), { recursive: true }); writeFileSync(RECEIPT, JSON.stringify(receipt, null, 1)); } catch {} }   // only a full run is a receipt; fast is a glance
  if (a.includes('--json')) process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  else { for (const x of r.asks) process.stdout.write(askLine(x) + '\n'); process.stdout.write(line + '\n'); }
}
