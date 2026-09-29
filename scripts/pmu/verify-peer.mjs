#!/usr/bin/env node
// scripts/pmu/verify-peer.mjs — FORKS MAP EACH OTHER. You vouch for a peer surface by
// RECOMPUTATION, never by opinion: fetch the public corpus their dignity pixel names,
// recompute the pixel locally with the same shipped function, compare, and append the
// attestation to YOUR tape/peers.json. Inbound peer-recomputations are what promote a
// map row from [self-reported] to [peer-recomputed] — a web of verification where every
// edge is a redone computation, and the map crawler renders the graph.
//
//   npx thetacog-mcp verify-peer --peer https://github.com/them/their-fork
//
//   [requires: network] — fetches ONLY public raw files from the peer's repo.
// FAIL-CLOSED: no pixel published, corpus unreachable, or sha mismatch -> attestation
// records the failure honestly (a failed recomputation is itself signal), exit 2.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { placePixel } = await import(resolve(PKG, 'src/lib/pmu/compress.mjs'));

const i = process.argv.indexOf('--peer');
const peerUrl = i > -1 ? String(process.argv[i + 1] || '').replace(/\.git$/, '').replace(/\/$/, '') : null;
const m = peerUrl && peerUrl.match(/github\.com\/([^/]+\/[^/]+)/);
if (!m) { console.error('usage: npx thetacog-mcp verify-peer --peer https://github.com/<owner>/<fork>'); process.exit(1); }
const repo = m[1];
const raw = async (file) => { const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${file}`); return r.ok ? r.text() : null; };

let myOrigin = null; try { myOrigin = execSync('git remote get-url origin').toString().trim().replace(/\.git$/, ''); } catch { /* */ }
const record = (att) => {
  const p = resolve(process.cwd(), 'tape/peers.json');
  mkdirSync(dirname(p), { recursive: true });
  let peers = [];
  if (existsSync(p)) { try { peers = JSON.parse(readFileSync(p, 'utf8')); } catch { peers = []; } }
  peers = peers.filter((x) => x.peer !== att.peer); // one row per peer, latest recomputation wins
  peers.push(att);
  writeFileSync(p, JSON.stringify(peers, null, 2));
  console.log('→ tape/peers.json updated (commit it — the map crawler reads attestation edges from public forks)');
};

const pj = await raw('tape/dignity-pixel.json');
if (!pj) {
  record({ peer: peerUrl, attested_by: myOrigin, method: 'recomputation', result: 'NO-PIXEL-PUBLISHED', sig: 'UNSIGNED (mesh-sign lands with federation)' });
  console.error('✗ peer has no tape/dignity-pixel.json — recorded honestly; nothing to recompute.'); process.exit(2);
}
const theirs = JSON.parse(pj);
let corpus = '';
for (const f of theirs.corpus_files || []) { const t = await raw(f); if (t != null) corpus += '\n' + t; }
const sha = createHash('sha256').update(corpus).digest('hex');
const shaMatch = sha === theirs.corpus_sha256;

let pixelMatch = null, recomputed = null;
if (shaMatch) {
  let pairLib = [];
  try { pairLib = JSON.parse(readFileSync(resolve(PKG, 'data/pmu/snippet-library-144.json'), 'utf8')); if (!Array.isArray(pairLib)) pairLib = pairLib.anchors || pairLib.nodes || []; } catch { /* */ }
  const px = placePixel(corpus, pairLib);
  recomputed = px.pixel;
  pixelMatch = px.pixel === theirs.dignity_pixel;
}
const att = {
  peer: peerUrl, their_pixel: theirs.dignity_pixel, their_corpus_sha256: theirs.corpus_sha256,
  fetched_corpus_sha256: sha, corpus_sha_match: shaMatch, recomputed_pixel: recomputed, pixel_match: pixelMatch,
  attested_by: myOrigin, method: 'recomputation (same shipped placePixel, their public corpus)',
  result: !shaMatch ? 'CORPUS-DRIFTED (their files moved since they computed — not fraud, staleness; they should re-run my-pixel)' : (pixelMatch ? 'RECOMPUTED-AND-MATCHED' : 'RECOMPUTED-MISMATCH (versions may differ; compare instrument semver)'),
  sig: 'UNSIGNED (mesh-sign lands with federation)',
};
record(att);
console.log('◎ PEER ATTESTATION — ' + att.result);
console.log('  ' + peerUrl + ' · their pixel ' + theirs.dignity_pixel + ' · recomputed ' + (recomputed ?? '—') + ' · corpus sha ' + (shaMatch ? 'match' : 'MISMATCH'));
process.exit(att.result === 'RECOMPUTED-AND-MATCHED' ? 0 : 2);
