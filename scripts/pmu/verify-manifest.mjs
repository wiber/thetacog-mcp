#!/usr/bin/env node
// scripts/pmu/verify-manifest.mjs — C565j `npx thetacog-mcp verify <64-hex manifest>`: THE RECOMPUTE LINE WE PRINT RUNS.
// Every page and email names a backup by its manifest — the sha256 of the archive's own bytes — and tells the reader to
// verify it. Before this the CLI read that argument as a row.json path and failed. Now a 64-hex argument:
//   1. fetches the stored bytes through the public archive door (<origin>/api/backup/archive/<sha>, the same door
//      src/lib/backup/recompute-line.mjs prints for curl; origin THETACOG_BACKUP_ORIGIN or --origin, default thetadriven.com);
//   2. recomputes their sha256 and prints `MATCH` or `MISMATCH` with BOTH hashes — the archive is named by its bytes, so equal
//      is the whole check, and a single changed byte is MISMATCH (exit 1);
//   3. on MATCH reads the tape rows the same way the page does — src/lib/backup/receive.mjs tapesFromArchive, the one untar the
//      /backup/adherence page reads through — and prints the counts per tape and the newest coding row's three-word reading.
// A door that does not answer prints `UNMEASURED — GET <url>: <failure>` and never a verdict (exit 2). Recomputable — same bytes,
// same hash; whether the work was good is undecidable (Rice, 1953) and nothing here claims it. `fetch` is injected for the guard.
// Port row: none — one hash over bytes and the page's own untar; no placement is decided here.
// @guard tests/vna/c565j-the-recompute-line-runs.test.mjs
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { tapesFromArchive } from '../../src/lib/backup/receive.mjs';
import { readingOf } from '../../src/lib/vna/row-canonical.mjs';

export const DEFAULT_ORIGIN = 'https://thetadriven.com';
export const isManifest = (s) => /^[0-9a-f]{64}$/i.test(String(s || ''));

/** → { verdict: 'MATCH'|'MISMATCH'|'UNMEASURED', manifest, sha?, why?, tapes?, lines: string[] } */
export async function verifyManifest({ manifest, origin = DEFAULT_ORIGIN, fetch = globalThis.fetch }) {
  const m = String(manifest || '').toLowerCase();
  const url = `${String(origin).replace(/\/+$/, '')}/api/backup/archive/${m}`;
  if (!isManifest(m)) return { verdict: 'UNMEASURED', manifest: m, why: 'the manifest is the sha256 (64 hex) the archive is named by', lines: [`UNMEASURED — ${m || '(none)'} is not a 64-hex manifest`] };
  let res; try { res = await fetch(url); } catch (e) { return { verdict: 'UNMEASURED', manifest: m, why: String(e && e.message || e), lines: [`UNMEASURED — GET ${url}: ${e && e.message || e}`] }; }
  if (!res || !res.ok) {
    let why = ''; try { why = (await res.json()).why || ''; } catch { /* body is not JSON */ }
    return { verdict: 'UNMEASURED', manifest: m, why: `${res ? res.status : 'no response'}${why ? ` ${why}` : ''}`, lines: [`UNMEASURED — GET ${url}: ${res ? res.status : 'no response'}${why ? ` — ${why}` : ''}`] };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');
  const head = [`manifest  ${m}`, `recomputed ${sha}  (${bytes.byteLength} bytes from ${url})`];
  if (sha !== m) return { verdict: 'MISMATCH', manifest: m, sha, lines: [`MISMATCH — the bytes served are not the manifest`, ...head] };
  const lines = [`MATCH — the bytes served are the manifest`, ...head];
  let tapes = null;
  try { tapes = await tapesFromArchive(bytes, m); } catch (e) { lines.push(`tape rows: UNMEASURED — ${e.message}`); return { verdict: 'MATCH', manifest: m, sha, tapes: null, lines }; }
  const newest = tapes.coding.length ? tapes.coding[tapes.coding.length - 1] : null;
  lines.push(`tape rows, read as the page reads them: CODING ${tapes.coding.length} · DEPLOYED ${tapes.deployed.length} · ticks ${tapes.ticks ? tapes.ticks.length : 'UNMEASURED — the archive carries no tick record'}`);
  lines.push(newest ? `newest coding row: ${readingOf(newest)}${newest.row_sha ? ` · row ${String(newest.row_sha).slice(0, 12)}…` : ''}` : 'newest coding row: UNMEASURED — the archive carries no flight-tape rows');
  lines.push('What this answers: these are the bytes the manifest names, and the rows inside them. What it does not: whether the work was good (Rice, 1953).');
  return { verdict: 'MATCH', manifest: m, sha, tapes: { coding: tapes.coding.length, deployed: tapes.deployed.length }, lines };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--origin');
  const origin = oi >= 0 ? args[oi + 1] : (process.env.THETACOG_BACKUP_ORIGIN || DEFAULT_ORIGIN);
  const manifest = args.find((a, i) => isManifest(a) && args[i - 1] !== '--origin');
  const r = await verifyManifest({ manifest, origin });
  for (const l of r.lines) console.log(l);
  process.exit(r.verdict === 'MATCH' ? 0 : r.verdict === 'MISMATCH' ? 1 : 2);
}
