#!/usr/bin/env node
// ── C166d 1500 IS THE DEFAULT, NEVER THE ANSWER. The snowball cap is chosen by cogs/sec with token econ, read off the runner's own
// dispatch receipts (.thetacog/runner.ndjson): every verdict/worker row is one sample at the cap it ran under. Per cap:
//   n · ticked · cogs_per_sec (ticked ÷ Σ wall seconds) · tokens_per_cog (Σ in+out ÷ ticked) · usd_per_cog (Σ worker cost ÷ ticked).
// THE FRONTIER: among caps with n ≥ MIN_N (3) and at least one tick, keep those whose tokens/cog is within ACCEPT_BAND × the
// cheapest, then take the max cogs/sec (tie → fewer tokens/cog). Fewer than two measured caps is no comparison — the choice
// reads UNMEASURED and DEFAULT_CAP (the spec-tree constant) stands. The chosen cap is written WITH its measurement beside it to
// data/vna/cap-sweep.json; the runner reads its default from there (chosenCap) and never from a hand-typed number.
// Receipts from before C166d carry no cap field: every runner dispatch since 2026-09-18 ran under BUNDLE_TOKEN_CAP = 1500
// (fixed at b181bd1871, 2026-09-17), so they count at the constant and are flagged legacy.
// Decides a number (C170 port row): prototype here, port to the crate with the rest of the runner's arithmetic once it holds.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_TOKEN_CAP } from './spec-tree.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_CAP = BUNDLE_TOKEN_CAP;
export const MIN_N = 3;
export const ACCEPT_BAND = 1.5;   // "acceptable tokens/cog": within 1.5× the cheapest measured cap
export const SWEEP_PATH = process.env.VNA_CAP_SWEEP || resolve(REPO, 'data/vna/cap-sweep.json');
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const SWEEP_CAPS = [1500, 3000, 6000, 12000];

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const usageIn = (u) => (u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : null);

// one sample per terminal dispatch row (a verdict ticked it; a worker row is a dispatch that did not tick). Triage is not a cog.
export function samplesOf(rows) {
  const out = [];
  for (const r of rows) {
    if (!r || (r.kind !== 'verdict' && r.kind !== 'worker')) continue;
    if (String(r.label || '').endsWith('-triage')) continue;
    const wall_s = num(r.wall_s) ?? (num(r.ms) != null ? r.ms / 1000 : null);
    if (wall_s == null || wall_s <= 0) continue;
    const legacy = num(r.cap) == null;
    out.push({
      label: r.label || null, at: r.at || null, cap: legacy ? DEFAULT_CAP : r.cap, legacy, wall_s,
      tokens_in: num(r.tokens_in) ?? usageIn(r.usage), tokens_out: num(r.tokens_out) ?? (r.usage ? num(r.usage.output_tokens) : null),
      usd: num(r.cost_usd), ticked: num(r.ticked) ?? (r.kind === 'verdict' && r.ok === true ? 1 : 0),
    });
  }
  return out;
}

export function sweep(samples) {
  const by = new Map();
  for (const s of samples) { if (!by.has(s.cap)) by.set(s.cap, []); by.get(s.cap).push(s); }
  const caps = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([cap, ss]) => {
    const ticked = ss.reduce((a, s) => a + s.ticked, 0);
    const wall = ss.reduce((a, s) => a + s.wall_s, 0);
    const tok = ss.filter((s) => s.tokens_in != null && s.tokens_out != null);
    const paid = ss.filter((s) => s.usd != null);
    const tokSum = tok.reduce((a, s) => a + s.tokens_in + s.tokens_out, 0);
    const usdSum = paid.reduce((a, s) => a + s.usd, 0);
    return {
      cap, n: ss.length, ticked, legacy: ss.filter((s) => s.legacy).length, wall_s: +wall.toFixed(1),
      cogs_per_sec: ticked / wall, cogs_per_hour: +((ticked / wall) * 3600).toFixed(3),
      tokens_per_cog: ticked && tok.length ? tokSum / ticked : null, tokens_n: tok.length,
      usd_per_cog: ticked && paid.length ? usdSum / ticked : null, usd_n: paid.length,
      state: ss.length >= MIN_N ? 'MEASURED' : 'UNMEASURED',
    };
  });
  return { caps, samples: samples.length };
}

export function choose(sw, { band = ACCEPT_BAND } = {}) {
  const measured = sw.caps.filter((c) => c.state === 'MEASURED' && c.ticked > 0 && c.tokens_per_cog != null);
  if (measured.length < 2) {
    const why = measured.length ? `only cap ${measured[0].cap} has n ≥ ${MIN_N} — one cap is no sweep; ${DEFAULT_CAP} stands as the default` : `no cap has n ≥ ${MIN_N} ticked receipts; ${DEFAULT_CAP} stands as the default`;
    return { state: 'UNMEASURED', cap: DEFAULT_CAP, why, measurement: null };
  }
  const floor = Math.min(...measured.map((c) => c.tokens_per_cog));
  const ok = measured.filter((c) => c.tokens_per_cog <= band * floor);
  const best = ok.sort((a, b) => b.cogs_per_sec - a.cogs_per_sec || a.tokens_per_cog - b.tokens_per_cog)[0];
  return {
    state: 'MEASURED', cap: best.cap, band, token_floor: floor,
    why: `max cogs/sec among ${ok.length} of ${measured.length} measured caps within ${band}× the cheapest tokens/cog (${Math.round(floor)})`,
    measurement: { n: best.n, ticked: best.ticked, cogs_per_sec: best.cogs_per_sec, cogs_per_hour: best.cogs_per_hour, tokens_per_cog: best.tokens_per_cog, usd_per_cog: best.usd_per_cog },
  };
}

export function writeSweep(sw, path = SWEEP_PATH, { source = null } = {}) {
  const doc = { version: 1, at: new Date().toISOString(), source, min_n: MIN_N, default_cap: DEFAULT_CAP, choice: choose(sw), caps: sw.caps, samples: sw.samples };
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

// the runner's default: the sweep's MEASURED choice, else the constant. A missing or unreadable file is the constant, said so.
export function chosenCap({ path = SWEEP_PATH } = {}) {
  if (!existsSync(path)) return { cap: DEFAULT_CAP, source: 'default', why: 'no cap-sweep.json' };
  try {
    const d = JSON.parse(readFileSync(path, 'utf8')); const c = d && d.choice;
    if (c && c.state === 'MEASURED' && Number.isInteger(c.cap) && c.cap >= 500 && c.cap <= 16000) return { cap: c.cap, source: 'sweep', why: c.why };
    return { cap: DEFAULT_CAP, source: 'default', why: (c && c.why) || 'sweep UNMEASURED' };
  } catch (e) { return { cap: DEFAULT_CAP, source: 'default', why: `cap-sweep.json unreadable: ${String(e.message).slice(0, 80)}` }; }
}

export function readRows(path = RUNNER_NDJSON) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export const sweepCommand = (units = 12, caps = SWEEP_CAPS) => `node scripts/vna/steer-runner.mjs --max-units ${units} --cap-rotate ${caps.join(',')} && node scripts/vna/cap-sweep.mjs`;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--command')) { console.log(sweepCommand(Number(arg('--units') || 12))); process.exit(0); }
  const src = arg('--ndjson') || RUNNER_NDJSON; const out = arg('--out') || SWEEP_PATH;
  const sw = sweep(samplesOf(readRows(src)));
  const doc = argv.includes('--dry-run') ? { choice: choose(sw), caps: sw.caps } : writeSweep(sw, out, { source: src.replace(REPO + '/', '') });
  if (argv.includes('--json')) { console.log(JSON.stringify(doc)); process.exit(0); }
  for (const c of doc.caps) console.log(`cap ${c.cap} · n ${c.n} (${c.legacy} legacy) · ticked ${c.ticked} · ${c.cogs_per_hour} cogs/h · ${c.tokens_per_cog != null ? Math.round(c.tokens_per_cog).toLocaleString('en-US') : '—'} tokens/cog · ${c.usd_per_cog != null ? '$' + c.usd_per_cog.toFixed(2) : '—'}/cog · ${c.state}`);
  console.log(`choice: cap ${doc.choice.cap} · ${doc.choice.state} — ${doc.choice.why}`);
  if (doc.choice.state !== 'MEASURED') console.log(`to measure: ${sweepCommand()}`);
}
