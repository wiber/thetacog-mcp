#!/usr/bin/env node
// scripts/vna/loss-run.mjs — THE LOSS RUN ON YOUR OWN TRANSCRIPTS (C638, operator 2026-10-04: "find the strongest measures
// we can present" · "its a fat tail distribution and he would understand the difference"). token-tail.mjs reads OUR ticks;
// this reads a STRANGER's, on their own machine, over their own ~/.claude/projects transcripts, sending nothing:
//   npx thetacog-mcp loss-run [--root <dir>] [--svg <file>|-] [--json]
// It prints one text line — ticks, total, worst tick, the share of all tokens the worst 5 % carry, the CV — and writes the
// survival curve P(tick > x), log-log, as SVG through token-tail.mjs's own survivalSvg (the same bytes, never a second painter).
// THE TICK: one session — one transcript file, its subagent transcripts (<session>/subagents/*.jsonl) folded into it. C510's
// commit-closed unit needs the caller's git to resolve receipts; a session needs nothing but the file, so it is the unit a
// stranger's machine always supports. Tokens per tick = tickActual (input + cache_create + cache_read), the same quantity
// token-tail.mjs reads. ONE CALL PER message.id: usageOf + callKeyOf from steer-ab-rules.mjs (C519's reader), imported, the
// dedupe set spanning every file so a message.id is counted once whatever file repeats it.
// Below n 20 ticks every number prints as UNMEASURED. No network: this module imports fs, path, os, readline and two
// readers that import no transport; the guard runs it with every socket door stubbed to throw.
// Not sufficient for: whether the work in any tick was good (Rice), or why a tick was big (a session mixes many asks).
// Port row: none — a reader that decides nothing and holds no mass (it streams, never holds a transcript whole).
// @guard tests/vna/c638-loss-run-on-your-own-transcripts.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { usageOf, callKeyOf, tickActual, promptTextOf, labelOf, STEER, USAGE_SOURCE } from './steer-ab-rules.mjs';
import { survivalSvg, cv, share5 } from '../../src/lib/backup/token-tail.mjs';   // C647c: the one home of the tail math (scripts/vna/token-tail.mjs re-exports it)

export const MIN_TICKS = 20;
export const TICK_UNIT = 'one session (a transcript file, its subagents folded in)';

/** every *.jsonl under root, recursively */
export function transcriptFiles(root) {
  const out = []; const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p); } };
  walk(root); return out.sort();
}

/** the session a file belongs to: <project>/<session>.jsonl → <project>/<session>; <project>/<session>/subagents/x.jsonl → the same */
export function sessionOf(root, file) {
  const parts = path.relative(root, file).split(path.sep);
  if (parts.length >= 2) return `${parts[0]}/${parts[1].replace(/\.jsonl$/, '')}`;
  return parts[0].replace(/\.jsonl$/, '');
}

/** fold parsed rows into ticks. `seen` spans every file: one call per message.id. Returns Map session → tick */
export function foldRows(rows, session, ticks = new Map(), seen = new Set()) {
  for (const row of rows) {
    let t = ticks.get(session); if (!t) { t = { session, label: null, calls: 0, input: 0, cache_create: 0, cache_read: 0, output: 0 }; ticks.set(session, t); }
    if (t.label == null && row && row.isSidechain !== true) { const text = promptTextOf(row); if (text != null) t.label = labelOf(text); }
    const u = usageOf(row); if (!u) continue;
    const key = callKeyOf(row); if (key) { if (seen.has(key)) continue; seen.add(key); }
    t.calls += 1; for (const k of ['input', 'cache_create', 'cache_read', 'output']) t[k] += u[k];
  }
  return ticks;
}

async function readRows(file, onRow) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) { if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; } onRow(r); }
}

/** read every transcript under root into ticks (streamed, one file at a time) */
export async function ticksOf(root) {
  const ticks = new Map(), seen = new Set(); const files = transcriptFiles(root);
  for (const f of files) { const s = sessionOf(root, f); const buf = []; await readRows(f, (r) => { buf.push(r); if (buf.length >= 2000) foldRows(buf.splice(0), s, ticks, seen); }); foldRows(buf, s, ticks, seen); }
  return { files: files.length, calls: seen.size, ticks: [...ticks.values()].filter((t) => t.calls > 0).map((t) => ({ ...t, label: t.label || 'PLAIN', actual: tickActual(t) })) };
}

/** the loss-run reading over ticks — UNMEASURED below MIN_TICKS, every number withheld */
export function lossReading(ticks) {
  const a = ticks.map((t) => t.actual).filter((v) => Number.isFinite(v) && v > 0);
  if (a.length < MIN_TICKS) return { status: 'UNMEASURED', unit: TICK_UNIT, n: a.length, reason: `n ${a.length} ticks (need ${MIN_TICKS})` };
  const sorted = [...a].sort((x, y) => x - y); const tot = a.reduce((x, y) => x + y, 0);
  const st = ticks.filter((t) => t.label === STEER && t.actual > 0).map((t) => t.actual).sort((x, y) => x - y);
  const pl = ticks.filter((t) => t.label !== STEER && t.actual > 0).map((t) => t.actual).sort((x, y) => x - y);
  return {
    status: 'MEASURED', unit: TICK_UNIT, usage_source: USAGE_SOURCE, n: a.length, total: tot,
    median: sorted[Math.floor((sorted.length - 1) / 2)], worst: sorted[sorted.length - 1], worst5_share: share5(a), cv: cv(a),
    survival: { plain: pl, steer: st },
    not_sufficient_for: 'whether the work in any tick was good (Rice); why a tick was big (a session mixes many asks)',
  };
}

/** the curve: token-tail.mjs's survivalSvg over the reading, the plain line = sessions not opened by /steer */
export function lossSvg(R) {
  const mx = (s) => (s.length ? s[s.length - 1] : 0);
  return survivalSvg({ survival: R.survival, n: { plain: R.survival.plain.length, steer: R.survival.steer.length }, max: { plain: mx(R.survival.plain), steer: mx(R.survival.steer) } });
}

const f = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'k');
export function lossLine(R) {
  if (R.status !== 'MEASURED') return `loss run · tick = ${R.unit} · UNMEASURED — ${R.reason}`;
  return `loss run · tick = ${R.unit} · n ${R.n} ticks · total ${f(R.total)} · median ${f(R.median)} · worst tick ${f(R.worst)} · worst 5% carry ${(R.worst5_share * 100).toFixed(0)}% of all tokens · CV ${R.cv.toFixed(2)} · read locally, nothing sent`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const root = opt('--root') || process.env.LOSS_RUN_ROOT || path.join(os.homedir(), '.claude', 'projects');
  const { files, calls, ticks } = await ticksOf(root);
  const R = lossReading(ticks);
  const svgAt = opt('--svg') || path.join(os.tmpdir(), 'thetacog-loss-run.svg');
  if (args.includes('--json')) { const { survival, ...rest } = R; console.log(JSON.stringify({ root, files, calls, ...rest }, null, 1)); }
  else if (svgAt === '-' && R.status === 'MEASURED') { process.stdout.write(lossSvg(R) + '\n'); }
  else {
    console.log(lossLine(R));
    if (R.status === 'MEASURED') { fs.writeFileSync(svgAt, lossSvg(R)); console.log(`survival curve P(tick > x), log-log → ${svgAt}`); }
    console.log(`read ${files} transcript files under ${root} · ${calls} calls, one per message.id`);
  }
}
