#!/usr/bin/env node
// scripts/vna/impasse-ledger.mjs — C315 GEMMA MUTATES THROUGH THE IMPASSE, AND THE LEDGER SAYS WHETHER IT HELPED.
// C278 already lets gemma propose the C276 retry dial from a fixed enum; C315 is the READ-ONLY instrument that answers
// the long-running question from the CLI, never estimated: does a retry that moved one dial (C276) land more often when
// GEMMA chose it than when the fixed rotation (steer-rules.mjs retryDial) did? Zero model calls, zero writes — it only
// counts what steer-until.mjs and steer-runner.mjs already put on .thetacog/runner.ndjson:
//   'halt'       {label, reason, ...}                     an impasse — the row named at least one attempt that failed
//   'retry-dial' {label, dial, dial_by, before_sha, ...}   the ONE dial the next attempt changed, and who chose it —
//                dial_by is 'gemma' | 'rotation' | 'none' ('none' = a row from before this field existed, or a caller
//                that never said; never fabricated as either real answer)
//   'verdict'    {label, ticked: 1, ...}                   the row landed — a tick, not the word "verdict" in a log
// "Landed" is read as the CONSTRUCT — the runner's OWN 'verdict' row with ticked:1 (set only once the six gates and the
// red witness passed, C176VerdictFields) recorded AFTER the retry that produced it — never a token match on the log, and
// deliberately not a second re-parse of the spec checkbox: the runner's verdict IS the tick, written by the same pipeline
// that decided it, so reading it here is reading the record an actor did not author over itself (AXIOM 1's W3), not
// re-deriving a second opinion from the spec file. A halted retry can be followed by another halt before any tick ever
// lands, and a label can retry more than once — both are folded correctly below.
//   node scripts/vna/impasse-ledger.mjs [--json]
// @guard tests/vna/c315-the-impasse-ledger.test.mjs
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIALS } from './steer-rules.mjs';   // the one fixed set (C276) — never a second copy

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const RUNNER = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const MIN_N = 10;   // a rate under this many known-outcome retries is UNMEASURED, never printed as a number
export const DIAL_BY = Object.freeze(['gemma', 'rotation', 'none']);

/** every row of runner.ndjson, parsed ONE LINE AT A TIME — never a single JSON.parse over the whole file (the tape can
 *  outgrow node's string ceiling: 2026-09-21, .thetacog/walk-tape.ndjson at 547 MB). A torn or unparsable line is
 *  dropped, never thrown; a missing file reads as no rows, never an error. */
export async function readRows(path = RUNNER) {
  const rows = [];
  if (!existsSync(path)) return rows;
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  try { for await (const line of rl) { if (!line) continue; try { rows.push(JSON.parse(line)); } catch {} } }
  catch { /* a read error mid-stream returns whatever was already parsed — never throws past the CLI */ }
  return rows;
}

// decides a verdict — Rust port pending (C315)
/** the pure fold over rows already in file-append order (chronological): one entry per label that halted at least
 *  once, its attempt count, and each retry's dial + who chose it + whether a tick landed after it. A dial outside the
 *  fixed set (C276) is refused — named on the row, never counted toward a retry or a rate. */
export function foldImpasses(rows) {
  const byLabel = new Map(); const order = [];
  const touch = (label) => { if (!byLabel.has(label)) { byLabel.set(label, { label, attempts: 0, retries: [], landed: false, refused: [], _pending: null }); order.push(label); } return byLabel.get(label); };
  const closePending = (row, landed) => { if (row._pending) { row.retries.push({ ...row._pending, landed }); row._pending = null; } };
  for (const r of rows) {
    if (!r || !r.label) continue;
    if (r.kind === 'halt') { const row = touch(r.label); row.attempts += 1; closePending(row, false); }
    else if (r.kind === 'retry-dial') {
      const row = touch(r.label);
      closePending(row, false);   // a second retry fired before the first ever resolved — the first never landed
      if (!DIALS.includes(r.dial)) { row.refused.push(r.dial); continue; }   // outside the fixed set: refused, never counted
      row._pending = { dial: r.dial, dial_by: DIAL_BY.includes(r.dial_by) ? r.dial_by : 'none' };
    } else if (r.kind === 'verdict' && r.ticked === 1 && byLabel.has(r.label)) {
      const row = byLabel.get(r.label); row.landed = true; closePending(row, true);
    }
  }
  const out = [];
  for (const label of order) {
    const row = byLabel.get(label);
    if (row.attempts < 1) continue;   // "halted at least once"
    if (row._pending) { row.retries.push({ ...row._pending, landed: null }); row._pending = null; }   // still open — no outcome on the record yet
    delete row._pending;
    out.push(row);
  }
  return out;
}

/** the land-after-retry rate, per who chose the dial. n counts only retries with a KNOWN outcome (landed !== null,
 *  i.e. not still pending) — under MIN_N the category is UNMEASURED, never a fabricated rate. */
export function rateByDialBy(rows) {
  const buckets = { gemma: [], rotation: [], none: [] };
  for (const row of rows) for (const rt of row.retries) if (rt.landed !== null) buckets[rt.dial_by].push(rt.landed);
  const out = {};
  for (const who of DIAL_BY) {
    const arr = buckets[who]; const n = arr.length; const landed = arr.filter(Boolean).length;
    out[who] = n < MIN_N
      ? { n, landed, rate: null, why: `UNMEASURED — only ${n} ${who} retr${n === 1 ? 'y' : 'ies'} with a landed outcome on the record, need ${MIN_N}` }
      : { n, landed, rate: Math.round((landed / n) * 1000) / 1000, why: null };
  }
  return out;
}

const dialLine = (rt) => `${rt.dial}(${rt.dial_by})→${rt.landed === true ? 'landed' : rt.landed === false ? 'did not land' : 'pending'}`;
export function rowLine(row) {
  const retries = row.retries.length ? ` · retries: ${row.retries.map(dialLine).join(' | ')}` : ' · retries: none';
  const refused = row.refused.length ? ` · refused: ${row.refused.join(',')}` : '';
  return `${row.label} · attempts ${row.attempts}${retries}${refused} · landed ${row.landed ? 'YES' : 'NO'}`;
}
export function rateLine(rates) {
  return DIAL_BY.map((who) => { const r = rates[who]; return r.rate == null ? `${who} n=${r.n} ${r.why}` : `${who} n=${r.n} land-after-retry ${Math.round(r.rate * 100)}%`; }).join(' · ');
}

export async function impasseLedger({ runner = RUNNER } = {}) {
  const rows = await readRows(runner);
  const impasses = foldImpasses(rows);
  const rates = rateByDialBy(impasses);
  return { impasses, rates, lines: impasses.map(rowLine), rateLine: rateLine(rates) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const json = process.argv.includes('--json');
  const out = await impasseLedger();
  if (json) console.log(JSON.stringify(out));
  else {
    for (const l of out.lines) console.log(l);
    console.log(out.impasses.length ? `— ${out.impasses.length} row${out.impasses.length === 1 ? '' : 's'} halted at least once` : 'no row has halted yet on the record');
    console.log(out.rateLine);
  }
}
