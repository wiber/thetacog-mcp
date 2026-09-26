#!/usr/bin/env node
// scripts/vna/peg.mjs — C93c THE PEG: the price of a cog is the cheapest measured route that produced that class of work
// on the record, and it only falls (operator 2026-09-19: "peg the no-arbitrage token to complexity of work based on
// measurements"). Per cog BAND (declared in cog-weights.json by cog, never by tokens) the peg is the fewest tokens-per-cog
// seen on a MINTED row (C93a: red witness + a live basin) with a MEASURED spend (C93b: usage, never bytes). A new row
// moves the peg only downward and the move is a row on data/vna/cog-peg.ndjson { at, band, from, to, sha, route }; a row
// that is unminted, UNMEASURED, or above the peg leaves it untouched and is scored effectiveness = peg / actual (≤ 1).
// No arbitrage: you cannot mint without the witness, and you cannot be paid more per cog than the cheapest route on
// record. Never a dollar until a price is pinned (KR40). LLM-free.
//   node scripts/vna/peg.mjs [--transcript <jsonl>] [--json]     walk data/vna/cog.ndjson × spend → data/vna/cog-peg.json
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWeights, COG_NDJSON } from './cog.mjs';
import { spendOf, spendOfCommit, total } from './spend.mjs';
import { hoursOf, skillOf } from './labour.mjs';   // C93j: measured hours and the basin's skill ride every score

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const PEG = process.env.VNA_COG_PEG || resolve(REPO, 'data/vna/cog-peg.json');
export const PEG_NDJSON = process.env.VNA_COG_PEG_NDJSON || resolve(REPO, 'data/vna/cog-peg.ndjson');
export const SPEND_NDJSON = process.env.VNA_COG_SPEND || resolve(REPO, 'data/vna/cog-spend.ndjson');
/** C93h: the spend of record — the session that CARRIED the sha (mint-history.mjs) — wins over a live-transcript guess */
export function spendLedger(path = SPEND_NDJSON) { const m = new Map(); for (const r of ndRows(path)) if (r.sha && r.status !== 'UNMEASURED') m.set(r.sha, { ...r, source: 'cog-spend.ndjson (the session that carried the sha)' }); return m; }
const ndRows = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

export function emptyPeg(weights = readWeights()) { return { v: 1, weights_v: weights.v, unit: weights.unit, bands: Object.fromEntries(weights.bands.map((b) => [b.name, { peg: null, sha: null, route: null, at: null }])), cites: { peg: 'the fewest tokens per cog on a minted row with a measured spend — data/vna/cog-peg.ndjson holds every move', mint: 'scripts/vna/cog.mjs (C93a)', spend: 'scripts/vna/spend.mjs (C93b)' } }; }

/** score one (cog, spend) pair against the peg; returns the new peg (same object if untouched) and the move, if any */
export function pegUpdate({ cogRow, spendRow, peg, at = new Date().toISOString() }) {
  const band = peg.bands[cogRow.band] || (peg.bands[cogRow.band] = { peg: null, sha: null, route: null, at: null });
  const measured = spendRow && spendRow.status !== 'UNMEASURED' && Number.isFinite(spendRow.total) && spendRow.total > 0;
  if (!cogRow.minted) return { peg, move: null, score: { sha: cogRow.sha, band: cogRow.band, status: 'unminted', why: cogRow.why, effectiveness: null } };
  if (cogRow.partial) return { peg, move: null, score: { sha: cogRow.sha, band: cogRow.band, status: 'PARTIAL', why: 'the tesseract walk has not landed for this sha — minted for the graph, not for the peg', effectiveness: null } };
  if (!measured) return { peg, move: null, score: { sha: cogRow.sha, band: cogRow.band, status: 'UNMEASURED', why: (spendRow && spendRow.why) || 'no spend row', effectiveness: null } };
  const perCog = spendRow.total / cogRow.cog;
  if (band.peg == null || perCog < band.peg) {
    const move = { at, band: cogRow.band, from: band.peg, to: perCog, sha: cogRow.sha, route: spendRow.route };
    peg.bands[cogRow.band] = { peg: perCog, sha: cogRow.sha, route: spendRow.route, at };
    return { peg, move, score: { sha: cogRow.sha, band: cogRow.band, status: 'peg', perCog, effectiveness: 1 } };
  }
  return { peg, move: null, score: { sha: cogRow.sha, band: cogRow.band, status: 'scored', perCog, effectiveness: band.peg / perCog } };
}

/** walk every cog row against its spend; write the peg file and append the moves */
export function pegWalk({ cogRows = ndRows(COG_NDJSON), turns = [], runnerRows, peg = existsSync(PEG) ? JSON.parse(readFileSync(PEG, 'utf8')) : emptyPeg(), pegPath = PEG, ndjsonPath = PEG_NDJSON, write = true, repo = REPO, tree = null } = {}) {
  const rr = runnerRows === undefined ? ndRows(resolve(REPO, '.thetacog/runner.ndjson')) : runnerRows;
  const scores = [], moves = []; const seen = new Set(ndRows(ndjsonPath).map((m) => `${m.sha}:${m.to}`));
  const newest = new Map(); for (const c of cogRows) newest.set(c.sha, c);   // a re-minted sha (the walk landed) supersedes its partial row
  const ledger = spendLedger();
  for (const c of newest.values()) {
    const s = ledger.get(c.sha) || spendOfCommit({ sha: c.sha, repo, turns, runnerRows, at: c.at });
    const r = pegUpdate({ cogRow: c, spendRow: s, peg }); peg = r.peg;
    const runnerRow = rr.filter((x) => x.kind === 'verdict' && x.work && String(c.sha).startsWith(String(x.work).slice(0, 10))).pop() || null;
    const hours = hoursOf({ spend: s, turns, runnerRow }); const skill = tree ? skillOf(c.rows_ticked.length ? c.rows_ticked : c.labels_named, tree) : null;
    scores.push({ ...r.score, spend: s.status === 'UNMEASURED' ? null : { route: s.route, calls: s.calls, total: s.total, cache_read: s.cache_read, output: s.output }, hours, skill });
    if (r.move && !seen.has(`${r.move.sha}:${r.move.to}`)) moves.push(r.move);
  }
  // C93l — a band whose peg was set by a row minted BEFORE the lattice input (no `inputs.lattice` on its cog row) is LEGACY: the value
  // stays (a peg never rises) but the flag says it is not comparable to a landed row, so the card and the market never read it as a price
  for (const [b, v] of Object.entries(peg.bands)) { if (v.peg == null) continue; const c = newest.get(v.sha); const legacy = !!c && !(c.inputs && c.inputs.lattice); v.legacy = legacy; v.legacy_why = legacy ? 'set by a row minted before the lattice input (C93a) — not comparable to a row whose walk landed' : null; }
  if (write) { mkdirSync(dirname(pegPath), { recursive: true }); writeFileSync(pegPath, JSON.stringify({ ...peg, at: new Date().toISOString(), rows: cogRows.length, minted: cogRows.filter((c) => c.minted).length }, null, 1) + '\n'); for (const m of moves) appendFileSync(ndjsonPath, JSON.stringify(m) + '\n'); }
  return { peg, scores, moves };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const tp = arg('--transcript'); const turns = tp ? spendOf(tp).turns : [];
  const out = pegWalk({ turns });
  if (argv.includes('--json')) console.log(JSON.stringify(out)); else { console.log(`peg → ${PEG} · ${out.scores.length} rows · ${out.moves.length} move${out.moves.length === 1 ? '' : 's'}`); for (const [b, v] of Object.entries(out.peg.bands)) console.log(`  band ${b} · peg ${v.peg == null ? '—' : Math.round(v.peg).toLocaleString()} tokens/cog${v.sha ? ` · ${String(v.sha).slice(0, 10)} (${v.route})` : ''}`); for (const s of out.scores.slice(-6)) console.log(`  ${s.sha.slice(0, 10)} ${s.band} ${s.status}${s.effectiveness != null ? ` · effectiveness ${s.effectiveness.toFixed(2)}` : ''}${s.why ? ` — ${s.why}` : ''}`); }
}
