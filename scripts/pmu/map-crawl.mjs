#!/usr/bin/env node
// scripts/pmu/map-crawl.mjs — render THE BIG MAP as a VIEW. Zero databases, per doctrine:
// GitHub's fork graph IS the index, the registry is a billboard, and this script crawls the
// public surfaces (anonymously — be the stranger) into tape/map.json, a flat regenerable
// view committed ON the record. If it's on the web, the mesh can find it.
//
//   npx thetacog-mcp map-crawl        [requires: network — labeled, never assumed]
//
// For each fork of wiber/thetacog-mcp (+ the upstream itself): does tape/MANIFEST.md exist?
// does tape/dignity-pixel.json exist? If so, read the pixel. Emit one row per surface.
// Rows are [self-reported] until a stranger recomputes the pixel from the named corpus.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const gh = async (path) => {
  const r = await fetch('https://api.github.com' + path, { headers: { accept: 'application/vnd.github+json' } });
  if (!r.ok) return null;
  return r.json();
};
const raw = async (repo, file) => {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${file}`);
  return r.ok ? r.text() : null;
};

const UPSTREAM = 'wiber/thetacog-mcp';
const surfaces = [UPSTREAM];
// SUBSCRIPTIONS: tape/subscriptions.json lists surfaces you follow that are NOT forks —
// cross-network tesseracts. Subscribing is how the big map grows past the fork graph.
try { const subs = JSON.parse((await import('node:fs')).readFileSync('tape/subscriptions.json', 'utf8')); for (const s of subs) { const mm = String(s.surface || s).match(/github\.com\/([^/]+\/[^/]+)/); if (mm) surfaces.push(mm[1]); } } catch { /* none */ }
const forks = await gh(`/repos/${UPSTREAM}/forks?per_page=100`);
if (Array.isArray(forks)) for (const f of forks) surfaces.push(f.full_name);

const rows = [];
for (const repo of surfaces) {
  const manifest = await raw(repo, 'tape/MANIFEST.md');
  if (!manifest) continue; // no tape = not a receipts surface (yet)
  let pixel = null, peers = [];
  const pj = await raw(repo, 'tape/dignity-pixel.json');
  if (pj) { try { pixel = JSON.parse(pj); } catch { /* malformed = absent */ } }
  const prs = await raw(repo, 'tape/peers.json');
  if (prs) { try { peers = JSON.parse(prs); } catch { /* */ } }
  rows.push({
    surface: `https://github.com/${repo}`,
    is_fork0: repo === UPSTREAM,
    tape: true,
    dignity_pixel: pixel ? pixel.dignity_pixel : null,
    pixel_full_name: pixel ? pixel.pixel_full_name : null,
    grip_sigma: pixel ? pixel.grip_sigma : null,
    attests: peers.filter((x) => x.result === 'RECOMPUTED-AND-MATCHED').map((x) => x.peer),
    status: pixel ? 'self-reported (recompute: ' + (pixel.recompute || 'npx thetacog-mcp my-pixel') + ')' : 'tape-only (no pixel published)',
  });
}

// PROMOTION: a surface with >=1 inbound RECOMPUTED-AND-MATCHED attestation from another
// surface is [peer-recomputed] — every edge on this map is a redone computation.
for (const r of rows) {
  const inbound = rows.filter((o) => o.surface !== r.surface && (o.attests || []).includes(r.surface)).length;
  r.inbound_attestations = inbound;
  if (r.dignity_pixel && inbound > 0) r.status = 'peer-recomputed (' + inbound + ' inbound recomputation edge(s))';
}
const map = {
  _view: 'THE BIG MAP v0 — a regenerable VIEW on public surfaces; zero databases; the record decides',
  _regenerate: 'npx thetacog-mcp map-crawl   [requires: network]',
  _index: 'the GitHub fork graph of ' + UPSTREAM + ' — the web is the database',
  surfaces: rows,
};
mkdirSync(resolve(process.cwd(), 'tape'), { recursive: true });
writeFileSync(resolve(process.cwd(), 'tape/map.json'), JSON.stringify(map, null, 2));
console.log('◎ THE BIG MAP (view) — ' + rows.length + ' receipts surface(s) found via the fork graph');
for (const r of rows) console.log('  ' + (r.is_fork0 ? '#0 ' : '   ') + r.surface + '  pixel=' + (r.pixel_full_name || '—') + '  ' + (r.grip_sigma != null ? 'σ ' + r.grip_sigma : ''));
console.log('  → tape/map.json (a view — commit it or regenerate it; disputes resolve by recomputation)');
