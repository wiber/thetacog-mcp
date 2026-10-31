#!/usr/bin/env node
// scripts/mesh/mesh-node.mjs — Step 5 (m2): the per-room daemon. The loop turns itself.
// ─────────────────────────────────────────────────────────────────────────────
// Run one per room terminal. Each tick it replays the ledger and:
//   • CLAIMs any OPEN ASK targeted at this room (signed with the room's key)
//   • holds the lease on its in-progress claims by emitting HEARTBEATs
//   • (opt-in) dispatches a WORKER to do the work, then posts the VERIFY_PAYLOAD
//
// Safe by default: with no --worker it only claims + heartbeats + surfaces the work
// (it never auto-executes an LLM). Pass --worker '<cmd>' to actually run the task —
// the command gets MESH_TASK/MESH_TX in its env and its stdout becomes the artifact
// the verifier re-senses on the chip.
//
//   node scripts/mesh/mesh-node.mjs builder --once                 # one tick (testable)
//   node scripts/mesh/mesh-node.mjs builder --watch --interval 6   # the daemon loop
//   node scripts/mesh/mesh-node.mjs builder --watch --worker 'scripts/worker.sh'
//
// Bootstrap: prep is genesis. The daemon idles gracefully if there are no ASKs.
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postEvent } from './mesh-post.mjs';
import { replay } from './mesh-replay.mjs';
import { roomIdentity } from './mesh-keys.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const room = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : arg('--room');
if (!room) { console.error('usage: mesh-node.mjs <room> [--once|--watch] [--worker <cmd>] [--interval 6]'); process.exit(1); }

const me = roomIdentity(room).pubkey_hex;
const worker = arg('--worker');
const log = (s) => console.log(`  [${new Date().toISOString().slice(11, 19)}] ${room} · ${s}`);

// run the opt-in worker → its stdout is the delivered artifact (what the verifier re-senses)
function runWorker(tx, task) {
  try {
    const out = execSync(worker, { env: { ...process.env, MESH_TX: tx, MESH_TASK: task || '' }, encoding: 'utf8', maxBuffer: 2e8, timeout: 10 * 60 * 1000 });
    return String(out || '').trim() || `(worker produced no output for ${tx})`;
  } catch (e) { return null; }   // worker failed → leave the claim; heartbeat keeps the lease
}

function tick() {
  const { byTx } = replay(undefined, { now: Date.now() });
  let acted = 0;
  for (const p of byTx.values()) {
    const ask = p.ask;
    // 1. claim OPEN asks aimed at this room (by explicit target or matched lane)
    if (p.state === 'OPEN' && ask && (ask.target_node === room || ask.lane === room)) {
      postEvent({ tx_id: p.tx_id, type: 'CLAIM', node: room, agent: `${room}_daemon` });
      log(`CLAIMed ${p.tx_id} — ${(ask.body?.task || '').slice(0, 50)}`); acted++;
      continue;
    }
    // 2. our in-progress claims: work them (if a worker is set) or heartbeat to hold the lease
    if (p.state === 'CLAIMED' && p.claim?.node === room) {
      if (worker) {
        const artifact = runWorker(p.tx_id, ask?.body?.task);
        if (artifact != null) {
          postEvent({ tx_id: p.tx_id, type: 'VERIFY_PAYLOAD', node: room, agent: `${room}_daemon`, body: { artifact } });
          log(`WORKED ${p.tx_id} → posted VERIFY_PAYLOAD (${artifact.length}b)`); acted++;
        } else { postEvent({ tx_id: p.tx_id, type: 'HEARTBEAT', node: room, agent: `${room}_daemon` }); log(`worker failed on ${p.tx_id} — HEARTBEAT (hold lease)`); acted++; }
      } else {
        postEvent({ tx_id: p.tx_id, type: 'HEARTBEAT', node: room, agent: `${room}_daemon` });
        log(`HEARTBEAT ${p.tx_id} (claimed, awaiting a worker — run with --worker to execute)`); acted++;
      }
    }
  }
  if (!acted) log('idle — no ASKs for this room');
  return acted;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  log(`daemon up · key ${me.slice(0, 12)}… · worker ${worker ? `'${worker}'` : 'none (claim+heartbeat only)'}`);
  if (process.argv.includes('--watch')) {
    const interval = Number(arg('--interval', 6)) * 1000;
    const loop = () => { try { tick(); } catch (e) { log(`tick error: ${e.message}`); } setTimeout(loop, interval); };
    loop();
  } else {
    tick();   // --once / default single tick
  }
}
export { tick };
