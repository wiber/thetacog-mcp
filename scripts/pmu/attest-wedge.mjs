#!/usr/bin/env node
// scripts/pmu/attest-wedge.mjs — C1420 (W5): THE WEDGE IS THE STRANGER'S FIRST PROMPT.
//
// Operator 2026-10-29, verbatim: "if we can do that, we should be able to show the difference and I might be the strongest at a
// station demo customer verification … if you point the initial prompt to it, it would just get instantly."
//
//   npx thetacog-mcp attest-wedge                         writes the frozen slice into ./wedge/ (spec-5.txt, spec-80.txt,
//                                                         items/item-1.txt … item-6.txt), walks every item through the one
//                                                         Rust walk, and prints the instrument's verdict per item beside an
//                                                         empty judge column
//   npx thetacog-mcp attest-wedge --score <answers>       scores both columns against the slice's key: the reader's agent is
//                                                         the judge, its answers are an input file, no model runs here
//
// The slice is W1's (C1416): N in {5, 80}, the rule broken first and last, one faithful log per spec, opaque item names. It is
// regenerated in memory by wedge-generate.mjs, the same function the C1416 guard proves equal to the committed bytes, so the
// package carries the generator rather than a second copy of its output. The instrument leg is walkReading (tape-blend-sweep.mjs):
// buildTriptychInputs → renderTriptych lean → walkBoolean, the spec as intent, the item as reality, kill 25. The walk does not name
// rules, so its column is scored on the verdict alone. This door never imports wedge-run.mjs (the batch that spawns a judge).
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWedge, sha256, SLICE } from './wedge-generate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = resolve(HERE, '..', '..');
export const KILL = 25;
export const SUFFICIENCY = "THIS RUN IS SUFFICIENT FOR: how the one Rust walk reads each frozen item against its spec, re-runnable from these bytes, beside your own agent's answers. IT IS NOT SUFFICIENT FOR: which rule an item breaks (the walk does not name rules), any job's real specification, or whether the work was good (undecidable, Rice).";

export function slice() {
  const { files, manifest } = generateWedge();
  const specs = Object.fromEntries(SLICE.ns.map((n) => [`spec-${n}.txt`, files[`slice/spec-${n}.txt`]]));
  const items = manifest.slice.items.map((it) => ({ ...it, text: files[`slice/items/${it.name}`] }));
  // the declared positive and negative of each slice spec, for the self-separation reading (never written to ./wedge/)
  const probes = Object.fromEntries(SLICE.ns.map((n) => [`spec-${n}.txt`, { faithful: files[`items/spec-${n}${SLICE.seed}-faithful.txt`], negative: files[`items/spec-${n}${SLICE.seed}-negative.txt`] }]));
  const digest = sha256(JSON.stringify([specs, items.map((i) => [i.name, i.sha256])]));
  return { specs, items, probes, digest };
}

export function writeSlice(dir, s = slice()) {
  mkdirSync(join(dir, 'items'), { recursive: true });
  for (const [name, text] of Object.entries(s.specs)) writeFileSync(join(dir, name), text);
  for (const it of s.items) writeFileSync(join(dir, 'items', it.name), it.text);
}

async function walk(intent, reality, label) {
  const { walkReading } = await import('./tape-blend-sweep.mjs');
  try { return await walkReading({ intent, reality, repoRoot: DATA_ROOT, kill: KILL, label }); }
  catch (e) { return { state: 'UNMEASURED', reason: `the walk threw: ${String(e?.message || e).slice(0, 140)}` }; }
}

export async function instrumentColumn(s = slice()) {
  const rows = await Promise.all(s.items.map(async (it) => ({ name: it.name, spec: it.spec, ...pick(await walk(s.specs[it.spec], it.text, it.name)) })));
  const separation = {};
  for (const [spec, p] of Object.entries(s.probes)) {
    const [f, n] = await Promise.all([walk(s.specs[spec], p.faithful, `${spec}-faithful`), walk(s.specs[spec], p.negative, `${spec}-negative`)]);
    separation[spec] = { faithful: f.state, negative: n.state, separates: f.state === 'IN_LANE' && n.state === 'OFF_DOMAIN' };
  }
  return { rows, separation };
}
const pick = (w) => ({ state: w.state, offPct: w.offPct ?? null, reason: w.reason || null, engine: w.stamp?.engine ?? null });

/** the reader's answers: lines "item-1: R17" / "item-1: 17" / "item-1: none", or JSON { "item-1": 17 | null } */
export function parseAnswers(text) {
  const out = {};
  const t = String(text || '').trim();
  if (t.startsWith('{')) { const j = JSON.parse(t); for (const [k, v] of Object.entries(j)) out[k.replace(/\.txt$/, '')] = v == null || /^none$/i.test(String(v)) ? null : Number(String(v).replace(/^R/i, '')); return out; }
  for (const line of t.split('\n')) {
    const m = line.match(/(item-\d+)(?:\.txt)?\s*[:=-]\s*(?:R(?:ule)?\s*)?(\d+|none|no violation|faithful)/i);
    if (m) out[m[1]] = /^\d+$/.test(m[2]) ? Number(m[2]) : null;
  }
  return out;
}

const posOf = (it) => (it.kind === 'faithful' ? 'faithful' : it.kind);
export function score(s, inst, answers) {
  const rows = s.items.map((it) => {
    const has = Object.prototype.hasOwnProperty.call(answers, it.name.replace(/\.txt$/, ''));
    const said = has ? answers[it.name.replace(/\.txt$/, '')] : undefined;
    const judge = !has ? 'unanswered' : it.kind === 'faithful' ? (said == null ? 'clear' : 'false alarm') : (said === it.rule ? 'hit' : 'miss');
    const w = inst.rows.find((r) => r.name === it.name) || {};
    const instrument = w.state === 'UNMEASURED' ? 'refused' : it.kind === 'faithful' ? (w.state === 'OFF_DOMAIN' ? 'false alarm' : 'clear') : (w.state === 'OFF_DOMAIN' ? 'hit' : 'miss');
    return { name: it.name, spec: it.spec, n: it.n, kind: it.kind, rule: it.rule, said, judge, walk: w.state, instrument };
  });
  const count = (col, pos, v) => rows.filter((r) => r.kind === pos && r[col] === v).length;
  const of = (pos) => rows.filter((r) => r.kind === pos).length;
  const judgePos = { first: count('judge', 'first', 'miss'), last: count('judge', 'last', 'miss') };
  const instPos = { first: count('instrument', 'first', 'miss'), last: count('instrument', 'last', 'miss') };
  const reading = [];
  reading.push(judgePos.first > judgePos.last ? 'Your agent missed by position: it lost a rule read early in the spec more often than the last one.'
    : judgePos.first === judgePos.last ? 'Your agent\'s misses do not depend on position on this slice, so this door claims no position effect for it.'
      : 'Your agent missed the last rule more often than the first on this slice: no first-rule loss here.');
  reading.push(instPos.first === instPos.last ? 'The instrument\'s misses do not depend on position: the walk reads the spec and the work as wholes, not as a sequence.' : 'The instrument\'s misses differ by position on this slice; read the rows above.');
  const flat = Object.entries(inst.separation).filter(([, v]) => !v.separates).map(([k]) => k);
  if (flat.length) reading.push(`The walk read the faithful log and the every-rule-broken log of ${flat.join(' and ')} the same way, so its verdict there follows the spec, not the broken rule: that is a specification the self-separation gate (S3, row C1411) refuses as SPEC_INSUFFICIENT, never a pass.`);
  return { rows, judgePos, instPos, of: { first: of('first'), last: of('last'), faithful: of('faithful') }, falseAlarms: { judge: count('judge', 'faithful', 'false alarm'), instrument: count('instrument', 'faithful', 'false alarm') }, unanswered: rows.filter((r) => r.judge === 'unanswered').length, reading };
}

const pad = (x, n) => String(x).padEnd(n);
export function renderColumns(s, inst, sc = null) {
  const L = [];
  L.push(sc ? `  ${pad('item', 12)}${pad('spec', 14)}${pad('broken rule', 16)}${pad('judge (your agent)', 24)}instrument (the one Rust walk)` : `  ${pad('item', 12)}${pad('spec', 14)}${pad('instrument (the one Rust walk)', 36)}judge (your agent)`);
  for (const it of s.items) {
    const w = inst.rows.find((r) => r.name === it.name) || {};
    const wtxt = `${w.state}${w.offPct != null ? ` off ${w.offPct} %` : ''}`;
    if (!sc) { L.push(`  ${pad(it.name.replace(/\.txt$/, ''), 12)}${pad(it.spec, 14)}${pad(wtxt, 36)}______`); continue; }
    const r = sc.rows.find((x) => x.name === it.name);
    const truth = it.kind === 'faithful' ? 'none (faithful)' : `R${it.rule} (${it.kind})`;
    const said = r.said === undefined ? '—' : r.said == null ? 'none' : `R${r.said}`;
    L.push(`  ${pad(it.name.replace(/\.txt$/, ''), 12)}${pad(it.spec, 14)}${pad(truth, 16)}${pad(`${said} · ${r.judge}`, 24)}${wtxt} · ${r.instrument}`);
  }
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = console.log } = {}) {
  const s = slice();
  const dir = resolve(cwd, 'wedge');
  const si = argv.indexOf('--score');
  log('THE WEDGE: how a long context fails beside how the instrument fails, on one frozen slice (C1420)');
  log(SUFFICIENCY);
  log('');
  if (si < 0) {
    writeSlice(dir, s);
    log(`wrote ${dir}/: spec-5.txt, spec-80.txt, items/item-1.txt … item-${s.items.length}.txt · slice sha256 ${s.digest.slice(0, 16)}`);
    const inst = await instrumentColumn(s);
    log('');
    log(renderColumns(s, inst));
    log('');
    log('YOUR AGENT IS THE JUDGE. Read wedge/spec-80.txt and wedge/spec-5.txt, then each wedge/items/item-N.txt (its first line names its spec).');
    log('For each item write one line to wedge/answers.txt: "item-1: R17" for the one rule it breaks, or "item-1: none". Then run:');
    log('  npx thetacog-mcp attest-wedge --score wedge/answers.txt');
    log('No model runs in this door: the walk is the crate\'s, and your agent\'s answers are an input file.');
    return { slice: s, inst };
  }
  const file = argv[si + 1];
  if (!file || !existsSync(resolve(cwd, file))) { log(`UNMEASURED: --score needs your answers file (${file || 'none given'} not found). Write wedge/answers.txt as the first run printed, then run --score wedge/answers.txt.`); return { exit: 2 }; }
  const answers = parseAnswers(readFileSync(resolve(cwd, file), 'utf8'));
  const inst = await instrumentColumn(s);
  const sc = score(s, inst, answers);
  log(renderColumns(s, inst, sc));
  log('');
  log(`JUDGE (your agent): misses at the first rule ${sc.judgePos.first} of ${sc.of.first} · at the last rule ${sc.judgePos.last} of ${sc.of.last} · false alarms on a faithful log ${sc.falseAlarms.judge} of ${sc.of.faithful}${sc.unanswered ? ` · unanswered ${sc.unanswered}` : ''}`);
  log(`INSTRUMENT (the one Rust walk, kill ${KILL} %): misses at the first rule ${sc.instPos.first} of ${sc.of.first} · at the last rule ${sc.instPos.last} of ${sc.of.last} · false alarms on a faithful log ${sc.falseAlarms.instrument} of ${sc.of.faithful}`);
  for (const [spec, v] of Object.entries(inst.separation)) log(`SELF-SEPARATION ${spec}: faithful log ${v.faithful} · every-rule-broken log ${v.negative} · ${v.separates ? 'separates' : 'does not separate'}`);
  log('');
  for (const line of sc.reading) log(`READING: ${line}`);
  return { slice: s, inst, score: sc };
}

// main when run as a file — compared by realpath: a tmpdir extract runs as /var/… while import.meta.url resolves /private/var/…
const isMain = (() => { try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const r = await main();
  process.exit(r && r.exit ? r.exit : 0);
}
