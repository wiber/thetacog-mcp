#!/usr/bin/env node
// scripts/pmu/spec-drift.mjs — TRACK B: how much the SPEC (the intent) itself moved (R2).
// =============================================================================
// The commit-drift receipt has always measured ONE drift: delivered work vs the spec (Track A,
// REALITY — "did the room build it"). But a low coverage can be the SPEC's fault, not the room's:
// if the ask moved between delegation and delivery, the room was aiming at a shifting target.
// Track B measures that — the INTENT drift: this spec version vs its previous git-committed
// version, gzip-NCD over the requirement prose. Together the two tracks let us ATTRIBUTE the
// cause: room_drift (A high, B low) · spec_churn (B high) · both · none. That attribution is the
// insurance-relevant split — a moving spec is the insured's risk, not the room's.
//
//   node scripts/pmu/spec-drift.mjs --spec docs/specs/drafts/<file>.md [--json]
//   import { specDrift } from './spec-drift.mjs'  → { spec_drift_pct, intent_stability, ... }

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
function ncdDist(a, b) { if (!a || !b) return a === b ? 0 : 1; const za = gz(a), zb = gz(b), zab = gz(`${a}\n${b}`); const d = Math.max(za, zb); return d ? Math.max(0, Math.min(1, (zab - Math.min(za, zb)) / d)) : 0; }

// the requirement prose is the intent — drift in boilerplate (frontmatter, headings) is noise.
const reqProse = (src) => (src.match(/^[-*]\s+\*\*R\d+[\s\S]*?$/gm) || []).join('\n') || src;

function gitVersions(specPath) {
  const rel = specPath.replace(REPO + '/', '');
  let shas = [];
  try { shas = execSync(`git -C ${JSON.stringify(REPO)} log --format=%H -- ${JSON.stringify(rel)}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { /* */ }
  return { rel, shas };
}

export function specDrift(specPath) {
  const abs = resolve(specPath);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  const { rel, shas } = gitVersions(abs);
  const version = shas.length;
  // previous committed version (the one before the latest commit that touched the file)
  let prev = '';
  const prevSha = shas[1] || shas[0] || null;       // shas[0]=latest; shas[1]=prior
  if (prevSha && shas.length >= 2) {
    try { prev = execSync(`git -C ${JSON.stringify(REPO)} show ${shas[1]}:${JSON.stringify(rel)}`, { encoding: 'utf8' }); } catch { prev = ''; }
  }
  const drift = prev ? ncdDist(reqProse(current), reqProse(prev)) : 0;
  const spec_drift_pct = +(drift * 100).toFixed(1);
  return {
    track: 'B/INTENT',
    spec_path: rel,
    spec_version: version,                          // # of commits that have touched the spec
    prev_sha: shas.length >= 2 ? shas[1].slice(0, 9) : null,
    spec_drift_pct,                                 // gzip-NCD between this version's reqs and the prior
    intent_stability: +(1 - drift).toFixed(3),      // 1.0 = the ask never moved
    note: version < 2 ? 'first version — no prior to drift against (stable by definition)'
      : spec_drift_pct < 10 ? 'the ask held steady between versions'
      : 'the ask moved materially between versions — weigh against the work-drift before blaming the room',
  };
}

// combine the two tracks into a cause attribution (R2)
export function attributeCause({ workOffShapePct, workTolerancePct, specDriftPct, specTolerancePct = 15 }) {
  const roomDrift = workOffShapePct > workTolerancePct;
  const specChurn = specDriftPct > specTolerancePct;
  return roomDrift && specChurn ? 'both'
    : roomDrift ? 'room_drift'
    : specChurn ? 'spec_churn'
    : 'none';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const spec = arg('--spec', null);
  if (!spec) { console.error('usage: spec-drift.mjs --spec <path.md> [--json]'); process.exit(2); }
  const d = specDrift(spec);
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(d, null, 2) + '\n'); }
  else { const B='\x1b[1m',D='\x1b[2m',C='\x1b[36m',X='\x1b[0m';
    process.stderr.write(`${B}⬡ SPEC DRIFT (Track B / INTENT)${X} ${D}— ${d.spec_path}${X}\n  ${C}v${d.spec_version}${X} · drift ${B}${d.spec_drift_pct}%${X} vs v${d.spec_version-1} · intent-stability ${d.intent_stability}\n  ${D}${d.note}${X}\n`); }
}
