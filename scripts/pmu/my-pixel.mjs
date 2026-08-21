#!/usr/bin/env node
// scripts/pmu/my-pixel.mjs — THE DIGNITY PIXEL: the corner of the competence map this
// project demonstrably occupies, computed from its own PUBLIC text, recomputable by any
// stranger from the same files. Nobody grants it, so nobody can revoke it — they can only
// recompute it. It is also a ROUTING KEY: triggered work-orders route by lattice coordinate,
// so the pixel you master is the corner whose paid remediation reaches you first.
//
//   npx thetacog-mcp my-pixel [--file README.md --file docs/x.md ...]
//
// Default corpus (public by construction, so a stranger recomputes): README.md of the cwd
// repo. Output: the actor×patient pixel + grip + full ShortLex name, printed AND written to
// tape/dignity-pixel.json (sign-ready; the map crawler reads it from your public fork).
// Offline, deterministic, LLM-free. FAIL-CLOSED: no readable corpus -> UNMEASURED, exit 1.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { placePixel, compress } = await import(resolve(PKG, 'src/lib/pmu/compress.mjs'));

const files = [];
for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--file') files.push(process.argv[++i]);
if (!files.length) files.push('README.md');

let corpus = '', used = [];
for (const f of files) {
  const p = resolve(process.cwd(), f);
  if (existsSync(p)) { corpus += '\n' + readFileSync(p, 'utf8'); used.push(f); }
}
if (!corpus.trim() || corpus.trim().length < 200) {
  console.error('UNMEASURED — no readable corpus (need >=200 chars from public files; got ' + corpus.trim().length + ').');
  console.error('The dignity pixel is computed from PUBLIC text so a stranger can recompute it. Point --file at your README/docs.');
  process.exit(1);
}

let pairLib = [];
try { pairLib = JSON.parse(readFileSync(resolve(PKG, 'data/pmu/snippet-library-144.json'), 'utf8')); if (!Array.isArray(pairLib)) pairLib = pairLib.anchors || pairLib.nodes || []; } catch { /* */ }
const axisLib = JSON.parse(readFileSync(resolve(PKG, 'docs/architecture/axis-library-v1.json'), 'utf8'));

const px = placePixel(corpus, pairLib);
const lane = compress(corpus, axisLib);
const AXNAME = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund', B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
const full = (coord) => { const [r, c] = String(coord || '').split(','); return r && c ? `${r},${c} (${AXNAME[r] || r} × ${AXNAME[c] || c})` : String(coord); };

let origin = null; try { origin = execSync('git remote get-url origin', { cwd: process.cwd() }).toString().trim().replace(/\.git$/, ''); } catch { /* */ }

const entry = {
  dignity_pixel: px.pixel, pixel_full_name: full(px.pixel), grip_sigma: Number((px.sigma || 0).toFixed(4)),
  witness_agreement: px.agreement,
  lane: lane.witnesses ? lane.witnesses.gzipNCD.cell : null,
  corpus_files: used, corpus_sha256: createHash('sha256').update(corpus).digest('hex'),
  surface_url: origin, status: 'self-reported — a stranger recomputes this from the same public files',
  recompute: 'npx thetacog-mcp my-pixel' + used.map((f) => ' --file ' + f).join(''),
  routing_note: 'the pixel is a routing key: triggered work-orders in this corner route here first (L4 gates: accreditation + wording in force)',
};
mkdirSync(resolve(process.cwd(), 'tape'), { recursive: true });
writeFileSync(resolve(process.cwd(), 'tape/dignity-pixel.json'), JSON.stringify(entry, null, 2));

console.log('◎ THE DIGNITY PIXEL — the corner this project demonstrably occupies');
console.log('  pixel: ' + entry.pixel_full_name + ' · grip σ ' + entry.grip_sigma + ' · witnesses agree: ' + entry.witness_agreement);
console.log('  lane (primary witness): ' + entry.lane + ' · corpus: ' + used.join(', ') + ' (' + corpus.trim().length + ' chars, sha ' + entry.corpus_sha256.slice(0, 12) + '…)');
console.log('  → tape/dignity-pixel.json (commit it — the map crawler reads it from your public fork)');
console.log('  Nobody granted this; nobody can revoke it. They can only recompute it: ' + entry.recompute);
