#!/usr/bin/env node
// scripts/mesh/mesh-up.mjs — bring the WHOLE local mesh up: one node per room, one command.
//
// The question this answers: "can we run one node per room locally with the same ease as
// between computers?" YES. Each room is already a node (its own ed25519 key via mesh-keys.mjs,
// its own reef, its own daemon in mesh-node.mjs). This just spins all of them at once against
// the shared append-only ledger. The mechanism is IDENTICAL to the cross-computer case — a node
// only ever needs the signed, hash-chained ledger to act and to verify ("reach is verify"). The
// ONLY difference between "9 rooms on this laptop" and "9 machines on the internet" is WHERE the
// ledger lives; the node code does not change. So proving the local mesh proves the internet mesh
// at any size — that is the whole point of using the rooms as the local proving ground.
//
// DECIDABLE DIRECTION PRESERVED: every action is a signed event a stranger recomputes from the
// ledger; nothing here introduces a non-recomputable step. mesh-up is pure orchestration over
// mesh-node — it adds NO new trust, NO new state, NO LLM on the path.
//
// Usage:
//   node scripts/mesh/mesh-up.mjs                       # one tick per room (testable, bounded)
//   node scripts/mesh/mesh-up.mjs --watch [--interval 6]# the live mesh: a daemon per room (Ctrl-C tears all down)
//   node scripts/mesh/mesh-up.mjs --rooms builder,voice # a subset
//   node scripts/mesh/mesh-up.mjs --worker scripts/mesh/mesh-worker.sh   # give every node a worker
// Pure Node built-ins; deterministic over the ledger; no network, no new deps.

import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const NODE_SCRIPT = path.join(HERE, 'mesh-node.mjs');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const WATCH = process.argv.includes('--watch');
const INTERVAL = arg('--interval', '6');
const WORKER = arg('--worker', null);

// canonical room keys (data/rooms.json .rooms — object or array)
function roomKeys() {
  const r = JSON.parse(readFileSync(path.join(REPO, 'data/rooms.json'), 'utf8'));
  const rooms = r.rooms ?? r;
  const keys = Array.isArray(rooms) ? rooms.map(x => x.key || x.id || x.room) : Object.keys(rooms);
  return keys.filter(Boolean);
}
const subset = arg('--rooms', null);
const ROOMS = (subset ? subset.split(',').map(s => s.trim()) : roomKeys()).filter(Boolean);

// each room's node identity (pubkey) — proves these are distinct nodes, not threads of one
async function roster() {
  const { roomIdentity } = await import('./mesh-keys.mjs');
  return ROOMS.map(room => {
    let pub = '(key error)';
    try { pub = roomIdentity(room).pubkey_hex.slice(0, 16) + '…'; } catch { /* */ }
    return { room, pub };
  });
}

const line = () => console.log('  ' + '─'.repeat(74));

if (!WATCH) {
  // ── ONE TICK PER ROOM (bounded, testable) ──────────────────────────────────
  console.log('\n  MESH UP — one node per room, one tick each (the whole local mesh)');
  line();
  const r = await roster();
  for (const { room, pub } of r) console.log(`  ● ${room.padEnd(12)} node ${pub}`);
  line();
  let totalActs = 0;
  for (const room of ROOMS) {
    const a = [NODE_SCRIPT, room, '--once'];
    if (WORKER) a.push('--worker', WORKER);
    const res = spawnSync('node', a, { cwd: REPO, encoding: 'utf8' });
    const out = (res.stdout || '').trim();
    const acted = (out.match(/CLAIMed|WORKED|HEARTBEAT/g) || []).length;
    totalActs += acted;
    const summary = out.split('\n').filter(Boolean).map(l => l.replace(/^\s*\[[^\]]*\]\s*/, '')).join(' · ') || 'no output';
    console.log(`  ${acted ? '✔' : '·'} ${room.padEnd(12)} ${summary.slice(0, 90)}`);
  }
  line();
  console.log(`  ${ROOMS.length} nodes ticked · ${totalActs} mesh action(s). Verify any of it from the ledger:`);
  console.log('     node scripts/mesh/mesh-replay.mjs        ·        node scripts/mesh/mesh-prove.mjs\n');
  process.exit(0);
}

// ── WATCH: a live daemon per room (Ctrl-C tears all down) ─────────────────────
console.log(`\n  MESH UP (watch) — spawning ${ROOMS.length} room-nodes, interval ${INTERVAL}s. Ctrl-C to stop.`);
const r = await roster();
for (const { room, pub } of r) console.log(`  ● ${room.padEnd(12)} node ${pub}`);
line();
const children = [];
for (const room of ROOMS) {
  const a = [NODE_SCRIPT, room, '--watch', '--interval', INTERVAL];
  if (WORKER) a.push('--worker', WORKER);
  const child = spawn('node', a, { cwd: REPO, stdio: 'inherit' });
  children.push(child);
}
function teardown() {
  console.log('\n  tearing down the mesh…');
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* */ } }
  process.exit(0);
}
process.on('SIGINT', teardown);
process.on('SIGTERM', teardown);
