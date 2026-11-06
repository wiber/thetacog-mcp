#!/usr/bin/env node
// scripts/pmu/ratchet-replay.mjs — THE RATCHET REPLAY: the one instrument that decides a ratchet knob (rust-pipeline-flowchart §15).
//
// Every admissibility number the spec has quoted (12.6% → 36.3% → 37.3% → 78.2% → 1.4%) was produced by a script in a session's
// scratchpad — gone with the session, so "recompute, do not trust" had nothing to recompute with. This file is that script, in the
// repo, reading a FROZEN corpus (data/pmu/ratchet-corpus.json: real prompts from five sessions in order, their session threads, and a
// fixed set of nonsense lines) through the one door (walk-door.lensWalk → pmu-onchip --lens), one arm per knob setting, and appending
// one row per arm to data/pmu/ratchet-replay.ndjson stamped with the binary's sha256 and HEAD. `--series` prints that ledger as the
// grip-coherence series: the admissible fraction of REAL lines under the fair instrument, beside the nonsense count that must stay 0.
//
//   node scripts/pmu/ratchet-replay.mjs --freeze            # build the corpus once from .thetacog/lens-receipts (never re-run casually)
//   node scripts/pmu/ratchet-replay.mjs --perm 0,8,16       # replay every arm; append rows (add --dry to print only)
//   node scripts/pmu/ratchet-replay.mjs --series            # the ledger, newest last
//   node scripts/pmu/ratchet-replay.mjs --perm 64 --worms 2 --orthogonal   # C676.4: the COMMIT arm (walk-knobs COMMIT_APERTURE), ≈ 8 min
//   node scripts/pmu/ratchet-replay.mjs --perm 8 --worms 4 --thread   # Task 27: also the CONTEXT question on threaded rows (perm_thread)
//
// LLM-free end to end. The corpus is the fixed test set; the thread priors are materialised from the corpus itself into a temp
// receipts dir, so the replay never reads the live receipts and two runs of one binary on one corpus read byte-identical rows.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { lensWalk, laneMass } from '../../src/lib/pmu/walk-door.mjs';
import { pickPosterTiles } from './grip-poster.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CORPUS = resolve(REPO, 'data/pmu/ratchet-corpus.json');
export const LEDGER = resolve(REPO, 'data/pmu/ratchet-replay.ndjson');
const RECEIPTS = resolve(REPO, '.thetacog/lens-receipts');
// The five sessions the §12–§17 numbers were read on (ab-null.mjs, 2026-09-14) — frozen here so the corpus is the same test set.
const SESSIONS = ['7c8728fe-ecd4-4bf7-8745-e2ccd071a9db', '2934add3-e605-4db0-8c26-4f4f12616e4e', 'a5401c10-aca4-44b0-92dc-4fc063e3130e', '3d45d372-18ab-4d1a-b498-e70fdaaffaf4', 'caef88f8-ea65-4e1d-b830-e0326e94ecab'];
// THE NONSENSE FALSIFIER: lines that carry no order information about any lane. The fair instrument must refuse every one of them at
// every knob setting; the count on the ledger row must be 0. (v17 measured "nonsense inadmissible" on three lines in a scratchpad;
// one of these read ADMISSIBLE under the shipped Bonferroni latch on 2026-09-14 — the permutation refused it.)
// C676 item 3 (docs/research/2026-10-08-cog-measurement-vetting.md §3, 2026-10-08): TWELVE LINES GAVE THE FALSIFIER ≈ 35% POWER against
// a 3.6% false-admission rate; one hundred give ≈ 97%. The twelve hand-written lines stay first, so every old ledger row's nonsense_n
// reads against the same head of the list; the rest are drawn LLM-FREE from a fixed word bank by a seeded LCG — same seed, same
// bytes on every host (tests/pmu-simulator/nonsense-corpus-100.test.mjs). No line names a lane, a path, a room or a verb of the work.
export const NONSENSE_SEED_LINES = [
  'zxq blorf tangential marmalade quixotic pivot lorem sideways nine',
  'purple staple kettle drift orbit fence velvet gravel',
  'quorf blint sazzle mope trundle vex ipsum dolor sit amet',
  'the the of of and and to to a a in in is is it it',
  'seventeen umbrellas negotiate a saxophone under the fridge',
  'blue blue blue green green yellow yellow red red red red',
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do',
  'wibble wobble wubble flim flam floom zib zab zob',
  'monkey tractor cathedral spoon lightning envelope biscuit harbour',
  'asdf qwer zxcv tyui ghjk bnm, poiu lkjh mnbv',
  'north south east west up down left right in out',
  'apple banana cherry date elder fig grape honeydew kiwi lemon',
];
const NONSENSE_BANK = ['zxq', 'blorf', 'marmalade', 'quixotic', 'staple', 'kettle', 'velvet', 'gravel', 'quorf', 'blint', 'sazzle', 'mope', 'trundle', 'vex', 'umbrella', 'saxophone', 'fridge', 'wibble', 'wobble', 'flim', 'flam', 'floom', 'zib', 'zab', 'monkey', 'tractor', 'cathedral', 'spoon', 'lightning', 'envelope', 'biscuit', 'harbour', 'apple', 'banana', 'cherry', 'elder', 'fig', 'grape', 'honeydew', 'kiwi', 'lemon', 'purple', 'orange', 'crimson', 'teal', 'ochre', 'pebble', 'lantern', 'ribbon', 'walrus', 'teacup', 'meadow', 'anvil', 'pillow', 'comet', 'trombone', 'cactus', 'igloo', 'noodle', 'turnip', 'wombat', 'yodel', 'zephyr', 'glint', 'thimble', 'parsnip', 'otter', 'bugle', 'hammock', 'sprocket', 'quill', 'nutmeg', 'gondola', 'tulip', 'pretzel', 'falcon', 'mitten', 'bramble', 'sorbet', 'gazebo', 'plinth', 'rhubarb', 'marble', 'flannel', 'juniper', 'toffee', 'skillet', 'oboe', 'doily', 'grommet', 'kumquat', 'yarrow', 'bobbin', 'dormouse', 'paprika', 'sundial', 'treacle', 'mallet', 'lute'];
export const NONSENSE_SEED = 676;
// nonsenseCorpus(seed, n) → the twelve hand-written lines, then LCG-drawn lines of 7–10 bank words until the list holds n distinct lines.
export function nonsenseCorpus(seed = NONSENSE_SEED, n = 100) {
  const out = [...NONSENSE_SEED_LINES]; const seen = new Set(out);
  let s = (seed >>> 0) || 1; const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
  while (out.length < n) {
    const words = 7 + (next() % 4); const line = [];
    for (let i = 0; i < words; i++) line.push(NONSENSE_BANK[next() % NONSENSE_BANK.length]);
    const l = line.join(' '); if (!seen.has(l)) { seen.add(l); out.push(l); }
  }
  return out;
}
export const NONSENSE = nonsenseCorpus(NONSENSE_SEED);

const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
const ncd = (a, b) => { const ga = gz(a), gb = gz(b), gab = gz(a + '\n' + b); const mx = Math.max(ga, gb); return mx ? (gab - Math.min(ga, gb)) / mx : 1; };
const med = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? true) : dflt; };
const has = (name) => process.argv.includes(name);

export function freezeCorpus() {
  const names = readdirSync(RECEIPTS).filter((f) => /^lens-[0-9a-z]+\.json$/.test(f)).sort().reverse().slice(0, 1500);
  const rows = []; const seen = new Set();
  for (const f of names) { let r; try { r = JSON.parse(readFileSync(resolve(RECEIPTS, f), 'utf8')); } catch { continue; } if (!r.session || !r.prompt || !SESSIONS.includes(r.session)) continue; const p = String(r.prompt).trim(); if (!p || seen.has(r.session + '|' + p)) continue; seen.add(r.session + '|' + p); rows.push({ session: r.session, ts: r.ts, prompt: p, domain: r.domain && r.domain !== 'other' ? r.domain : null }); }
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const corpus = { frozen: new Date().toISOString(), sessions: SESSIONS, n: rows.length, nonsense: NONSENSE, rows };
  writeFileSync(CORPUS, JSON.stringify(corpus, null, 1) + '\n');
  return corpus;
}

export function loadCorpus() { if (!existsSync(CORPUS)) throw new Error(`no corpus at ${CORPUS} — run --freeze once`); return JSON.parse(readFileSync(CORPUS, 'utf8')); }

// The thread priors, from the corpus: an index.ndjson the binary reads first (session_prior_prompts), one line per real prompt.
export function materialiseReceipts(corpus) {
  const dir = resolve(tmpdir(), `ratchet-replay-${sha(JSON.stringify(corpus.rows)).slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.ndjson'), corpus.rows.map((r) => JSON.stringify({ session: r.session, ts: r.ts, prompt: r.prompt })).join('\n') + '\n');
  return dir;
}

export function runArm(corpus, ap, { n = null, receiptsDir = null, onRow = null } = {}) {
  receiptsDir = receiptsDir || materialiseReceipts(corpus);
  const rows = n ? corpus.rows.slice(0, n) : corpus.rows;
  const acc = { n: 0, admissible: 0, raw: 0, won_by_guided: 0, ms: [], rel: [], moved: 0, rungs: [], perm_z: [], bin_sha: null, bin: null, threaded: 0, thread_admissible: 0 };
  for (const r of rows) {
    const bulk = r.domain ? laneMass(r.domain) : null;
    const row = lensWalk(r.prompt, { source: 'lens-cli', bulk, lane: r.domain, session: r.session, before: r.ts, receiptsDir, seedAperture: ap, tape: '/dev/null' }).row;
    acc.n++; if (row.admissible) acc.admissible++; if (row.ratchet && row.ratchet.raw_admissible) acc.raw++;
    if (row.admissible && /^guided/.test(row.ratchet?.winner || '')) acc.won_by_guided++;
    acc.ms.push(row.ms); acc.rungs.push((row.attempts || []).length); acc.bin_sha = row.bin_sha || acc.bin_sha; acc.bin = row.bin || acc.bin;
    if (row.ratchet && row.ratchet.perm && Number.isFinite(row.ratchet.perm.z)) acc.perm_z.push(row.ratchet.perm.z);
    if (row.intentSpan && row.intentSpan.thread) acc.threaded++; if (row.ratchet && row.ratchet.thread_admissible) acc.thread_admissible++;   // Task 27: the CONTEXT question, never pooled with the line's
    if (row.admissible && row.pixel) { const { picked } = pickPosterTiles(row.pixel, { promptText: r.prompt, cap: 10 }); acc.rel.push(picked.length ? 1 - picked.reduce((s, t) => s + ncd(r.prompt, t.text), 0) / picked.length : null); const tr = (row.trajectory || []).filter(Boolean); if (tr.length > 1 && tr[0] !== tr[tr.length - 1]) acc.moved++; }
    if (onRow) onRow(row, r);
  }
  const non = { n: 0, admissible: 0, raw: 0 };
  for (const line of corpus.nonsense) {
    const row = lensWalk(line, { source: 'lens-cli', bulk: laneMass('pmu-reef'), lane: 'pmu-reef', seedAperture: ap, tape: '/dev/null' }).row;
    non.n++; if (row.admissible) non.admissible++; if (row.ratchet && row.ratchet.raw_admissible) non.raw++;
  }
  return {
    n: acc.n, admissible: acc.admissible, pct: +(100 * acc.admissible / Math.max(1, acc.n)).toFixed(1), raw_admissible: acc.raw, raw_pct: +(100 * acc.raw / Math.max(1, acc.n)).toFixed(1),
    won_by_guided: acc.won_by_guided, rungs_med: med(acc.rungs), ms_med: med(acc.ms) == null ? null : +med(acc.ms).toFixed(1), relevance_admitted_med: med(acc.rel) == null ? null : +med(acc.rel).toFixed(4), pixel_moved: acc.moved,
    perm_z_med: med(acc.perm_z) == null ? null : +med(acc.perm_z).toFixed(2), threaded: acc.threaded, thread_admissible: ap.permThread ? acc.thread_admissible : null, nonsense_n: non.n, nonsense_admissible: non.admissible, nonsense_raw: non.raw, bin_sha: acc.bin_sha, bin: acc.bin,
  };
}

export function armName(ap) { return `cut${ap.matchedCut === false ? 0 : 1}·g${ap.guidedPasses ?? 2}·w${ap.worms || 0}·p${ap.perm || 0}${ap.firstLatch ? '·first' : ''}${ap.permThread ? '·t' : ''}`; }

export function readLedger() { if (!existsSync(LEDGER)) return []; return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

export function seriesTable(rows = readLedger()) {
  const head = ['ts', 'head', 'bin', 'arm', 'n', 'adm%', 'raw%', 'rel', 'thread', 'ms', 'nonsense'];
  const lines = rows.map((r) => [r.ts.slice(0, 16), r.head, (r.bin_sha || '').slice(0, 8), r.arm, r.n, r.pct, r.raw_pct, r.relevance_admitted_med ?? '—', r.thread_admissible == null ? '—' : `${r.thread_admissible}/${r.threaded}`, r.ms_med, `${r.nonsense_admissible}/${r.nonsense_n}`]);
  const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  return [head, ...lines].map((l) => l.map((c, i) => String(c).padEnd(w[i])).join('  ')).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (has('--freeze')) { const c = freezeCorpus(); console.log(`frozen ${c.n} real prompts from ${c.sessions.length} sessions + ${c.nonsense.length} nonsense lines → ${CORPUS}`); process.exit(0); }
  if (has('--series')) { console.log(seriesTable()); process.exit(0); }
  const corpus = loadCorpus();
  const perms = String(arg('--perm', '0,8,16')).split(',').map(Number);
  const worms = String(arg('--worms', '0')).split(',').map(Number);
  const n = arg('--n') ? Number(arg('--n')) : null;
  const permThread = has('--thread');
  const orthogonal = has('--orthogonal');   // C676.4: the home's worms are orthogonal (SEED_APERTURE.wormsOrthogonal); the row must say so or the pin guard cannot match it   // Task 27: also read the CONTEXT question on threaded rows (≈ 2.6× the ms; the replay's arm, never the live default)
  const head = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const receiptsDir = materialiseReceipts(corpus);
  const corpus_sha = sha(JSON.stringify(corpus.rows) + JSON.stringify(corpus.nonsense));
  for (const w of worms) for (const p of perms) {
    const ap = { matchedCut: true, guidedPasses: 2, worms: w, ...(orthogonal && w ? { wormsOrthogonal: true } : {}), perm: p, ...(permThread ? { permThread: true } : {}) };
    const t0 = Date.now();
    const m = runArm(corpus, ap, { n, receiptsDir });
    const row = { ts: new Date().toISOString(), head, corpus_sha, corpus_frozen: corpus.frozen, arm: armName(ap), ap, ...m, wall_s: +((Date.now() - t0) / 1000).toFixed(1) };
    console.log(armName(ap).padEnd(18), JSON.stringify(m));
    if (!has('--dry') && !n) appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  }
  if (!has('--dry') && !n) console.log('\n' + seriesTable());
}
