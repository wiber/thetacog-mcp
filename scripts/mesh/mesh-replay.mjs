#!/usr/bin/env node
// scripts/mesh/mesh-replay.mjs — Phase 2 / Step 1: derive mesh state by replaying the ledger.
// ─────────────────────────────────────────────────────────────────────────────
// State is a PROJECTION, never a stored field:  State = fold(replay(events)).
// Reads every signed event file, verifies each signature, sorts deterministically
// by (ts, sha256) — so concurrent writers always reduce to the SAME projection —
// then folds per tx_id through the lifecycle state machine.
//
// Deterministic rules (the 6 amendments):
//   • CLAIM race: while a tx is OPEN, the (ts, sha256)-earliest CLAIM wins. Because
//     events are processed in that exact order, the winner is computed identically
//     by every reader, with no coordinator.
//   • Lease/TTL: a CLAIM holds the task for MESH_CLAIM_TTL_MS. If the gap to the
//     next HEARTBEAT (or, for the tail, to `now`) exceeds the TTL with no
//     VERIFY_PAYLOAD yet, the task deterministically REOPENS for re-claim.
//   • Verdict: VERDICT.ok=true → VERIFIED→CLOSED. ok=false → rework; 3 consecutive
//     FALSE → ESCALATED (handed to the operator), never an infinite loop.
//
//   node scripts/mesh/mesh-replay.mjs              # summary of all transactions
//   node scripts/mesh/mesh-replay.mjs --tx <id>    # one transaction's projection
//   node scripts/mesh/mesh-replay.mjs --json       # machine output
//
// Importable:  import { replay } from './mesh-replay.mjs'
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, canonicalBody, verifyReceipt } from '../pmu/receipt-crypto.mjs';
import { LEDGER_DIR, LEDGER_LOG, readSealed } from './mesh-post.mjs';
import { loadRegistry } from './mesh-keys.mjs';

const TTL_MS = parseInt(process.env.MESH_CLAIM_TTL_MS || `${5 * 60 * 1000}`, 10);
const ms = (ts) => Date.parse(ts) || 0;

// Load + verify + deterministically order every event in the ledger directory.
export function loadEvents(dir = LEDGER_DIR, { trustedPubkeys, pinRooms = true } = {}) {
  // Two stores, one ledger: the sealed ndjson (history) plus the spool (events not yet
  // rolled). A crash mid-seal can leave the same event in both, so sha256 dedupes — the
  // signature makes that hash the event's identity, so this cannot merge two real events.
  const sealed = dir === LEDGER_DIR ? readSealed(LEDGER_LOG) : [];
  if (!existsSync(dir) && !sealed.length) return { events: [], invalid: [] };
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.tmp-')) : [];
  const registry = pinRooms ? loadRegistry() : null;   // room → pubkey (the spatial-authority pin)
  const events = [], invalid = [], seenSha = new Set();
  const sources = [...sealed.map(e => ({ f: 'ledger.ndjson', pre: e })), ...files.map(f => ({ f, pre: null }))];
  for (const { f, pre } of sources) {
    let ev = pre;
    if (!ev) {
      try { ev = JSON.parse(readFileSync(join(dir, f), 'utf8')); }
      catch (e) { invalid.push({ f, reason: `parse: ${e.message}` }); continue; }
    }
    if (ev.sha256 && seenSha.has(ev.sha256)) continue;   // already taken from the sealed log
    if (ev.sha256) seenSha.add(ev.sha256);
    const v = verifyReceipt(ev, trustedPubkeys ? { trustedPubkeys } : {});
    if (!v.ok) { invalid.push({ f, reason: v.reason }); continue; }
    // SPATIAL AUTHORITY: the signer's key must be the registered key for the room it
    // claims to be (ev.node). A builder-claimed event signed by any other room's key —
    // or an unknown room — is a cross-room forgery, rejected here before the fold.
    if (registry && registry[ev.node] !== ev.pubkey_hex) {
      invalid.push({ f, reason: `cross-room forgery: ${ev.node} signature not the registered ${ev.node} key` });
      continue;
    }
    ev._sig256 = sha256Hex(ev.sig_hex);   // deterministic tiebreak key
    events.push(ev);
  }
  // canonical total order: earliest ts wins; then per-tx sequence (keeps causally
  // ordered same-tx events correct under ts collision); then lowest sha256 of the
  // signature (deterministic tiebreak for genuinely-concurrent events, e.g. claims)
  events.sort((a, b) => (ms(a.ts) - ms(b.ts)) || ((a.seq || 0) - (b.seq || 0))
    || (a._sig256 < b._sig256 ? -1 : a._sig256 > b._sig256 ? 1 : 0));
  return { events, invalid };
}

// Fold the ordered events into one projection per tx_id.
export function replay(dir = LEDGER_DIR, { now = Date.now(), ttlMs = TTL_MS, trustedPubkeys } = {}) {
  const { events, invalid } = loadEvents(dir, { trustedPubkeys });
  const byTx = new Map();
  const get = (id) => {
    if (!byTx.has(id)) byTx.set(id, { tx_id: id, state: 'NONE', ask: null, claim: null,
      claimants: [], last_hb: null, payload: null, verdicts: [], false_streak: 0, n: 0, log: [],
      chain_ok: true, _seen: new Set() });
    return byTx.get(id);
  };

  for (const ev of events) {
    const p = get(ev.tx_id); p.n++;
    const t = ms(ev.ts);
    // CHAIN INTEGRITY: every non-genesis event must reference a parent we've already
    // seen in this tx. A dangling parent_hash means an intermediate event was deleted
    // or reordered — the timeline is ruptured (e.g. someone tried to drop a FALSE verdict).
    if (ev.parent_hash && ev.parent_hash !== 'genesis' && !p._seen.has(ev.parent_hash)) p.chain_ok = false;
    p._seen.add(ev.sha256);
    // a CLAIMED task whose lease lapsed (no heartbeat within TTL, no payload) reopens
    // BEFORE we process this event — so a later CLAIM can deterministically re-win.
    if (p.state === 'CLAIMED' && !p.payload && p.last_hb != null && (t - p.last_hb) > ttlMs) {
      p.state = 'OPEN'; p.claim = null; p.log.push('LEASE_EXPIRED');
    }
    switch (ev.type) {
      case 'ASK':
        if (!p.ask) { p.ask = ev; p.state = 'OPEN'; }
        break;
      case 'CLAIM':
        if (p.state === 'OPEN') { p.claim = ev; p.last_hb = t; p.state = 'CLAIMED'; p.claimants.push(ev.pubkey_hex); }
        else p.claimants.push(ev.pubkey_hex + ' (late)');
        break;
      case 'HEARTBEAT':
        if (p.state === 'CLAIMED' && p.claim && ev.pubkey_hex === p.claim.pubkey_hex) p.last_hb = t;
        break;
      case 'VERIFY_PAYLOAD':
        if (p.state === 'CLAIMED' && p.claim && ev.pubkey_hex === p.claim.pubkey_hex) { p.payload = ev; p.state = 'PENDING_VERIFY'; }
        break;
      case 'VERDICT':
        if (p.state === 'PENDING_VERIFY') {
          const ok = ev.body && ev.body.ok === true;
          p.verdicts.push({ ok, ts: ev.ts });
          if (ok) { p.state = 'VERIFIED'; p.false_streak = 0; }
          else { p.false_streak++; p.state = p.false_streak >= 3 ? 'ESCALATED' : 'CLAIMED'; if (p.state === 'CLAIMED') p.last_hb = t; }
        }
        break;
      case 'CLOSED':
        if (p.state === 'VERIFIED') p.state = 'CLOSED';
        break;
      case 'REOPENED': p.state = 'OPEN'; p.claim = null; break;
      case 'ESCALATED': p.state = 'ESCALATED'; break;
    }
    p.log.push(ev.type);
  }

  // tail lease check: a still-CLAIMED task with no recent heartbeat is re-claimable NOW
  for (const p of byTx.values()) {
    if (p.state === 'CLAIMED' && !p.payload && p.last_hb != null && (now - p.last_hb) > ttlMs) {
      p.state = 'OPEN'; p.claim = null; p.lease_expired = true;
    }
  }
  return { byTx, order: events.map(e => ({ tx_id: e.tx_id, type: e.type, ts: e.ts })), count: events.length, invalid };
}

// stable serialization of a projection (for determinism checks + display)
export function projectionOf(p) {
  return { tx_id: p.tx_id, state: p.state, claim_winner: p.claim?.node || p.claim?.pubkey_hex || null,
    // a delegation ASK carries body.spec + body.context (bifurcate); a competence ASK carries body.task.
    claimants: p.claimants, task: p.ask?.body?.task || p.ask?.body?.spec || null,
    context: p.ask?.body?.context || '', from: p.ask?.node || null, target: p.ask?.lane || p.ask?.target_node || null,
    region_constraint: p.ask?.region_constraint || null, metrics: p.payload?.metrics || p.ask?.metrics || null,
    verdicts: p.verdicts, false_streak: p.false_streak, lease_expired: !!p.lease_expired,
    chain_ok: p.chain_ok, events: p.n, log: p.log };
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  const { byTx, count, invalid } = replay();
  const projections = [...byTx.values()].map(projectionOf).sort((a, b) => a.tx_id < b.tx_id ? -1 : 1);
  const one = arg('--tx');
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(one ? projections.find(p => p.tx_id === one) || null : { count, invalid: invalid.length, transactions: projections }, null, 2));
  } else if (one) {
    const p = projections.find(x => x.tx_id === one);
    if (!p) { console.log(`no such tx: ${one}`); process.exit(0); }
    console.log(`\n  ${one}  →  ${p.state}`);
    console.log(`  task:     ${p.task || '(n/a)'}`);
    console.log(`  target:   ${p.target || '(n/a)'}`);
    console.log(`  winner:   ${p.claim_winner ? p.claim_winner.slice(0, 16) + '…' : '(unclaimed)'}`);
    console.log(`  claimants:${p.claimants.length}   verdicts:${JSON.stringify(p.verdicts)}   lease_expired:${p.lease_expired}`);
    console.log(`  lifecycle: ${p.log.join(' → ')}\n`);
  } else {
    console.log(`\n  MESH LEDGER — ${count} signed events · ${byTx.size} transactions · ${invalid.length} invalid\n`);
    for (const p of projections) {
      console.log(`  ${p.state.padEnd(14)} ${p.tx_id}${p.task ? '  — ' + p.task.slice(0, 50) : ''}`);
    }
    if (invalid.length) console.log(`\n  ⚠️  ${invalid.length} invalid events skipped (signature/parse): ${invalid.slice(0, 3).map(i => i.reason).join('; ')}`);
    console.log('');
  }
}
