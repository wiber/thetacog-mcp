#!/usr/bin/env node
// C604 COMPRESSION PREDICTS PLACEMENT, SIGNALLED FIRST — the C226 reading as one line, read off C226's own receipt.
//
// The question the reading answers: do the rows ranked for an ask BEFORE the run agree with where its work commit is
// placed AFTER it, above a shuffled-ask null, n ≥ MIN_N and z ≥ Z_BAR in BOTH halves, family-wise bar beside? The
// receipt is data/vna/geo-ratchet.json, written by scripts/vna/geo-ratchet.mjs (C176g, the arm C226 names). This
// module never recomputes it: it reads the receipt, states its age, and prints UNMEASURED with the admitted ask count
// while the best arm sits under the bar. Compression picks the neighbourhood; the walk turns it into an address; C226
// checks the predicted address against where the commit lands. The compared bytes are text (the ask, the spec rows,
// the commit bytes); no performance-counter read is compressed (rung 4 is apparatus scope).
// A reading taken mid-run is a preview; the receipt reads the frozen commit.
//
// One home, two readers: scripts/vna/steerone.mjs prints readingLines() (C618: bitsLine() first, readingLine() second); scripts/vna/steer.mjs closeLine() carries shortBits() then
// shortReading() (as `C226 …`) in its `predicts` field.
//
// SUFFICIENT FOR: whether the retrieval/placement agreement has cleared its stated bar on the latest receipt, and how old
// that receipt is. NOT SUFFICIENT FOR: whether any single pick or placement is right (undecidable), nor for a reading
// newer than the receipt.
//
// C607 THE FRESHEST RECEIPT: two writers now leave a receipt in this shape — geo-ratchet.mjs (C176g) and ask-corpus.mjs
// --arms (C605, data/vna/ask-corpus-c605.json, and any later ask-corpus run). The reader takes whichever carries the newest
// written `at` (file mtime only when a receipt carries no `at`), names it in the line, and, when the receipt carries
// pairs per half (the ask-corpus shape), prints them beside n with p_row. A file without best/kept is not a receipt.
//
// SEAMS (hermetic guard): VNA_ISO_RECEIPT=<json file> pins one receipt (overrides the newest pick) ·
// VNA_ISO_DIR=<dir> stands in for data/vna when collecting the candidates.
// C618 THE PREDICTS LINE READS THE BITS: line 1 is now C609a's receipt (data/vna/brief-predicts-commit.json, "the brief
// predicts the commit, in bits"), parsed by the gains report's own C609a reader (gains-report.mjs READINGS, C612e), never
// a second parser: rate in bits per diff byte (raw and masked), z per half, n per half, session days per half, and the
// verdict with the conditions still missing, each taken from the receipt's own verdict reason and the parsed
// assumptions, never typed here. The C226 reading stays as line 2. C609 (9ded5f16b1) names admission as a function of
// mass, so the bits are the headline. No number is printed without its n on the same line.
// Seam: VNA_BITS_RECEIPT=<json file> (else <VNA_ISO_DIR or data/vna>/brief-predicts-commit.json).
// Port: a reading over a receipt already on disk (decides nothing new) — stays node.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_JSON, MIN_N, Z_BAR } from './geo-ratchet.mjs';
import { READINGS } from './gains-report.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RECEIPT = OUT_JSON;
export const WRITER_CMD = 'node scripts/vna/geo-ratchet.mjs';
export const isoDir = () => process.env.VNA_ISO_DIR || dirname(RECEIPT);

/** Every candidate receipt: geo-ratchet.json + ask-corpus*.json in the receipt directory. */
export function candidateReceipts(dir = isoDir()) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((f) => f === basename(RECEIPT) || /^ask-corpus.*\.json$/.test(f)).map((f) => join(dir, f));
}

function load(file) {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    if (!d || (!d.best && !d.kept)) return null;
    let t = Date.parse(d.at || '');
    if (!Number.isFinite(t)) { try { t = statSync(file).mtimeMs; } catch { t = -Infinity; } }
    return { file, d, t };
  } catch { return null; }
}

/** The newest receipt among the candidates, by its own written `at` → { file, d, t } | null. */
export function newestReceipt(files = candidateReceipts()) {
  let best = null;
  for (const f of files) { const r = load(f); if (r && (!best || r.t > best.t)) best = r; }
  return best;
}

/** The receipt the reading uses: VNA_ISO_RECEIPT when set, else the newest candidate, else geo-ratchet.json (reads missing). */
export const receiptPath = () => process.env.VNA_ISO_RECEIPT || newestReceipt()?.file || RECEIPT;

export function ageOf(at, now = Date.now()) {
  const t = Date.parse(at || '');
  if (!Number.isFinite(t)) return 'age unknown';
  const h = (now - t) / 3600e3;
  return h < 48 ? `${h.toFixed(1)} h old` : `${Math.floor(h / 24)} d old`;
}

/** Read C226's receipt → { state: 'missing'|'unmeasured'|'measured', ... }. Never throws. */
export function readIsoReading({ file = receiptPath(), now = Date.now() } = {}) {
  let d;
  try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { d = null; }
  const rel = relative(REPO, file) || file;
  if (!d || (!d.best && !d.kept)) return { state: 'missing', file: rel, cmd: WRITER_CMD };
  const name = basename(file);
  const head = d.kept || d.best;
  const arm = (Array.isArray(d.leaderboard) && d.leaderboard.find((a) => a.name === head.name)) || head;
  const halves = Object.entries(arm.halves || {}).map(([h, v]) => ({ h, ...v }));
  const n = head.min_n ?? (halves.length ? Math.min(...halves.map((v) => v.n)) : null);
  const z = head.min_z ?? (halves.length ? Math.min(...halves.map((v) => v.z)) : null);
  const meta = d.meta || {};
  const nAsks = meta.n_asks ?? arm.asks_n ?? null;
  const admKey = arm.config && arm.window ? `${arm.config}/${arm.window}` : null;
  const admitted = admKey && meta.admissible_ask_walks ? meta.admissible_ask_walks[admKey] ?? null : null;
  const cleared = n != null && z != null && n >= MIN_N && z >= Z_BAR && halves.every((v) => v.n >= MIN_N && v.z >= Z_BAR);
  const weak = halves.length ? halves.reduce((a, b) => (b.z < a.z ? b : a)) : null;
  // C607: the ask-corpus shape carries pairs per half (its halves' n are joint pairs) and p_row; geo-ratchet's does not
  const pph = d.reading && d.reading.pairs_per_half ? d.reading.pairs_per_half : null;
  const pairs = pph ? Object.values(pph) : null;
  return {
    state: cleared ? 'measured' : 'unmeasured',
    file: rel, name, at: d.at || null, age: ageOf(d.at, now),
    pairs, nPairs: pph ? d.N ?? nAsks : null, pRow: typeof d.p_row === 'number' ? d.p_row : null,
    arm: head.name, n, z, zs: halves.map((v) => v.z), admitted, nAsks,
    rate: weak ? weak.mean ?? weak.median ?? null : null, nul: weak ? weak.null_mean ?? null : null,
    bar: { n: d.min_n ?? MIN_N, z: Z_BAR, familywise: meta.z_required_familywise ?? null },
  };
}

const zPair = (r) => (r.zs.length ? r.zs.join('/') : String(r.z));

/** The FIRST line /steerone prints. */
export function readingLine(r = readIsoReading()) {
  const P = 'PREDICTS · compression→placement:';
  if (r.state === 'missing') return `${P} UNMEASURED — no C226 receipt (${r.cmd})`;
  const fw = r.bar.familywise != null ? `, family-wise z ${r.bar.familywise}` : '';
  const src = r.name ? `${r.name} receipt` : 'receipt';
  if (r.state === 'unmeasured' && r.pairs) {
    const pr = r.pRow != null ? ` · p_row ${Math.round(r.pRow * 100)} %` : '';
    return `${P} UNMEASURED — ${r.pairs.join('|')} pairs of ${r.bar.n}/half${pr} · n ${r.nPairs} · ${src} ${r.age}`;
  }
  if (r.state === 'unmeasured') {
    const adm = r.admitted != null ? `${r.admitted} of ${r.nAsks ?? '?'} asks admitted` : 'admitted count not on the receipt';
    return `${P} UNMEASURED — ${adm} · n ${r.n} · z ${zPair(r)} (bar n≥${r.bar.n}, z≥${r.bar.z} both halves${fw}) · ${src} ${r.age}`;
  }
  return `${P} agree rank ${r.rate} vs null ${r.nul} · z ${zPair(r)} · n ${r.n} (bar n≥${r.bar.n}, z≥${r.bar.z}${fw}) · ${src} ${r.age}`;
}

/** The `predicts` field on the /steer close line. */
export function shortReading(r = readIsoReading()) {
  if (r.state === 'missing') return 'UNMEASURED (no C226 receipt)';
  if (r.state === 'unmeasured' && r.pairs) return `UNMEASURED ${r.pairs.join('|')} pairs of ${r.bar.n}/half · n ${r.nPairs} · ${r.name} ${r.age}`;
  if (r.state === 'unmeasured') return `UNMEASURED ${r.admitted ?? '?'}/${r.nAsks ?? '?'} admitted · n ${r.n} · ${r.age}`;
  return `rank ${r.rate} vs null ${r.nul} · z ${zPair(r)} · n ${r.n} · ${r.age}`;
}

// ── C618: the bits reading (C609a), read through the gains report's one C609a parser ─────────────────────────────────────
const C609A = READINGS.find((r) => r.row === 'C609a');
export const bitsReceiptPath = () => process.env.VNA_BITS_RECEIPT || join(isoDir(), C609A.file);
const r1 = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) : '—');
const r3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');

/** Read C609a's receipt → { state: 'missing'|'unmeasured'|'measured', rate, masked, zs, ns, sess, unit, missing[], verdict, age }. Never throws. */
export function readBitsReading({ file = bitsReceiptPath(), now = Date.now() } = {}) {
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { j = null; }
  const rel = relative(REPO, file) || file;
  if (!j || !Array.isArray(j.halves)) return { state: 'missing', file: rel, cmd: C609A.command, title: C609A.title };
  const g = C609A.read(j);
  const raw = g.series[0] || { rate: null, halves: [] }, masked = g.series.find((s) => s.label === 'masked') || null;
  const hs = raw.halves;
  const unit = (hs.find((h) => h.sessions) || {}).sessionUnit || 'session days';
  const missing = [];
  // the receipt's own verdict reason: its why[], else the reason its line carries after the verdict
  const reasons = (g.why || []).length ? g.why : (String(j.line || '').match(/UNMEASURED — ([^·]+)/) || [])[1]?.trim().split(/;\s*/) || [];
  // the parsed assumptions: the one naming non-independent pairs becomes the plain-words condition, with its unit counts
  const indep = (g.assumptions || []).find((a) => /not independent/.test(a));
  if (indep && hs.every((h) => h.sessions)) missing.push(`but only ${hs.map((h) => h.sessions.length).join('|')} ${unit} — independent ${unit} are what's missing`);
  // a reason that prints a z on its own ("z 1.4 < 2 in half b") is restated beside that half's n, so no number stands without its n
  const halfN = (h) => hs['ab'.indexOf(h)]?.n ?? '—';
  missing.push(...reasons.filter(Boolean).map((w) => String(w).trim().replace(/\bz\s+[-−]?[\d.]+\s*<\s*([\d.]+)\s+in half (\w+)/g, (_m, bar, h) => `half ${h} under the bar z ≥ ${bar} on n ${halfN(h)}`)));
  const verdict = g.verdict || 'UNMEASURED';
  return {
    state: verdict === 'MEASURED' ? 'measured' : 'unmeasured', file: rel, title: C609A.title, at: j.at || null, age: ageOf(j.at, now),
    rate: raw.rate, masked: masked ? masked.rate : null, zs: hs.map((h) => h.z), ns: hs.map((h) => h.n),
    sess: hs.map((h) => (h.sessions ? h.sessions.length : null)), unit, missing, verdict,
  };
}

/** Line 1 /steerone prints (C618): the bits, z, n and session days per half, the missing condition, the verdict. */
export function bitsLine(b = readBitsReading()) {
  const P = `PREDICTS · ${b.title}:`;
  if (b.state === 'missing') return `${P} UNMEASURED — no C609a receipt (${b.cmd})`;
  const m = b.masked != null ? ` (masked ${r3(b.masked)})` : '';
  const miss = b.missing.length ? ` · ${b.missing.join(' · ')}` : '';
  return `${P} ${r3(b.rate)} bits/byte${m} · z ${b.zs.map(r1).join('|')} · n ${b.ns.join('|')}${miss} · ${b.verdict} · receipt ${b.age}`;
}

/** The short bits form the /steer close line carries as its `predicts` field. */
export function shortBits(b = readBitsReading()) {
  if (b.state === 'missing') return 'UNMEASURED (no C609a receipt)';
  const s = b.sess.every((x) => x != null) ? ` · ${b.sess.join('|')} ${b.unit}` : '';
  return `${r3(b.rate)} bits/byte (masked ${r3(b.masked)}) · z ${b.zs.map(r1).join('|')} · n ${b.ns.join('|')}${s} · ${b.verdict}`;
}

/** Both lines, in order: the bits first, the C226 reading second. */
export const readingLines = () => [bitsLine(), readingLine()];

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) console.log(process.argv.includes('--json') ? JSON.stringify({ bits: readBitsReading(), iso: readIsoReading() }) : readingLines().join('\n'));
