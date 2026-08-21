#!/usr/bin/env node
// scripts/pmu/interleave-reef.mjs — build the EFFECTIVE reef a room walks against (R5).
// =============================================================================
// "each room has a reef, and the job has a reef" — and the reef built from the spec is built
// ON TOP OF the room reef (operator). The effective reef = the room's competence anchors
// (the substrate — what it's good at) ⊕ the job's requirement anchors (the specific ask),
// so a single walk verdict means "in-lane AND on-spec" at once: a delivery that lands on the
// job anchors AND near the room's competence is coherent; one that lands off both has drifted.
//
// Job anchors lead (the ask is what's being graded); room anchors ground (the lane). Coords are
// namespaced (job: R1.. · room: <room>~0..) so the walk can attribute where mass landed. Sealed
// AS the room — the patient that will deliver. Same byte-stable sensors; recompute-safe.
//
//   node scripts/pmu/interleave-reef.mjs --room builder --spec data/pmu/reef/spec-reef-<id>.json
//   node scripts/pmu/interleave-reef.mjs --room builder --reef <job-reef.json> [--out <path>]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealReceiptAs, actorIdentity, sha256Hex } from './receipt-crypto.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const ROOM_REEFS = resolve(REPO, '.thetacog/mesh/room-reefs.json');

function roomAnchors(roomKey) {
  if (!existsSync(ROOM_REEFS)) throw new Error(`no room reefs — run: node scripts/mesh/build-room-reefs.mjs`);
  const all = JSON.parse(readFileSync(ROOM_REEFS, 'utf8'));
  const frags = ((all.rooms || {})[roomKey] || {}).fragments || [];
  return frags.map((f, i) => ({ coord: `${roomKey}~${i}`, title: String(f).slice(0, 48), snippet: String(f), layer: 'competence' }));
}

function jobAnchors(reefPath, specPath) {
  let reef;
  if (reefPath && existsSync(reefPath)) reef = JSON.parse(readFileSync(reefPath, 'utf8'));
  else if (specPath && existsSync(specPath)) reef = JSON.parse(readFileSync(specPath, 'utf8'));
  else throw new Error('need --reef <job-reef.json> or --spec <spec-reef.json>');
  return { reef, anchors: (reef.anchors || []).map(a => ({ ...a, layer: 'job' })) };
}

function main() {
  const room = arg('--room', 'builder');
  const { reef: job, anchors: jobs } = jobAnchors(arg('--reef', null), arg('--spec', null));
  const comp = roomAnchors(room);
  if (jobs.length < 1 || comp.length < 1) throw new Error(`need ≥1 job anchor (${jobs.length}) and ≥1 room anchor (${comp.length})`);

  // job anchors lead (graded), room anchors ground (the lane). Both carry a layer tag so the
  // walk's landing can be attributed: on-spec mass (job) vs in-competence mass (room).
  const anchors = [...jobs, ...comp];
  const body = {
    artifact: 'interleaved-reef',
    spec_id: `${room}+${job.spec_id || 'job'}`,
    base_room: room,
    job_spec_id: job.spec_id || null,
    built_from: 'job-reef ⊕ room-competence-reef (job leads, room grounds)',
    composition: { job_anchors: jobs.length, room_anchors: comp.length },
    job_reef_sha: job.sha256 || null,
    anchors,
  };
  const sealed = sealReceiptAs(body, actorIdentity(room));
  const out = resolve(arg('--out', resolve(REPO, `data/pmu/reef/interleaved-${room}-${job.spec_id || 'job'}.json`)));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(sealed, null, 2));

  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(sealed, null, 2) + '\n'); return; }
  const B='\x1b[1m', D='\x1b[2m', C='\x1b[36m', G='\x1b[32m', X='\x1b[0m';
  process.stderr.write(`${B}⬡ INTERLEAVED REEF${X} ${D}— ${room} ⊕ ${job.spec_id || 'job'}${X}\n`);
  process.stderr.write(`  ${C}${jobs.length} job anchors${X} (graded) ⊕ ${C}${comp.length} room anchors${X} (lane) → ${anchors.length} total, sealed AS ${G}${room}${X}\n`);
  process.stderr.write(`  ${D}a walk verdict now means in-lane AND on-spec · → ${out.replace(REPO + '/', '')}${X}\n`);
}

export { roomAnchors, jobAnchors };
if (import.meta.url === `file://${process.argv[1]}`) main();
