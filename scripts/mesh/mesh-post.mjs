#!/usr/bin/env node
// scripts/mesh/mesh-post.mjs — Phase 2 / Step 1: append a signed event to the mesh ledger.
// ─────────────────────────────────────────────────────────────────────────────
// The local rooms-mesh ledger is APPEND-ONLY: one immutable, ed25519-signed file
// per event (never a mutable shared record). Writes are atomic — temp file then
// rename() on the same volume — so N rooms can write concurrently with zero lock
// contention and zero dropped writes. State is NEVER stored; it is a projection
// derived by replaying the events (see mesh-replay.mjs).
//
// Event types (the lifecycle):
//   ASK → CLAIM → HEARTBEAT* → VERIFY_PAYLOAD → VERDICT → CLOSED
//                                            (or REOPENED / ESCALATED)
//
// Reuses receipt-crypto.mjs (sealReceipt = host key for Step 1; Step 2 swaps in
// sealReceiptAs + a per-room derived identity).
//
//   node scripts/mesh/mesh-post.mjs --type ASK  --node voice --agent voice_agent \
//        --task "Build spec reef lattice for the options-insurance flags" --lane builder
//   node scripts/mesh/mesh-post.mjs --type CLAIM --node builder --agent itermbuilder --tx <tx_id>
//   node scripts/mesh/mesh-post.mjs --type VERDICT --tx <tx_id> --node operator --ok true --body '{"monologue":"..."}'
//
// Importable:  import { postEvent } from './mesh-post.mjs'
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, renameSync, mkdirSync, readdirSync, existsSync, readFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sealReceiptAs } from '../pmu/receipt-crypto.mjs';
import { roomIdentity, loadRegistry } from './mesh-keys.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const LEDGER_DIR = process.env.MESH_LEDGER_DIR || join(REPO, '.thetacog', 'mesh', 'ledger');

// THE SEALED LOG — one tracked file, not 4,651 tracked files.
//
// The spool (LEDGER_DIR) keeps the per-event temp+rename write, because THAT is the
// atomicity guarantee three concurrent OS writers depend on and it is what
// mesh-ledger-concurrency.test.mjs actually pins. What changes is only where sealed
// history LIVES: rolled events move, in canonical order, into ledger.ndjson — appended,
// never rewritten — and the spool file is unlinked.
//
// Measured 2026-08-23: 4,651 event files holding 4.07 MB of JSON occupied 18 MB on disk
// (4x block overhead) and made every git op — and postEvent's own tx_id dedupe scan —
// walk 4,651 directory entries. As one .ndjson it is 4 MB, one path, and a diff that
// appends lines instead of adding files.
//
// Crash-safety: seal APPENDS before it unlinks, so a crash mid-seal leaves a duplicate,
// never a hole. Readers dedupe on sha256, which the signature already makes unforgeable.
//
// THE LOG FOLLOWS THE SPOOL. The two stores are ONE ledger, so redirecting half of it is
// not a sandbox — it is a splice. `<spool>.ndjson` reproduces the repo default byte-for-byte
// (.thetacog/mesh/ledger → .thetacog/mesh/ledger.ndjson) and makes an injected
// MESH_LEDGER_DIR self-contained, which is what every test and sandbox already assumed.
//
// Measured 2026-09-09, before this line existed: `MESH_LEDGER_DIR=<tmp> mesh-post --stress 210`
// sealed 181 sandbox events into the log the sandbox never named. The roll guard below reads
// `dir === LEDGER_DIR` intending "only ever roll the REPO ledger" — but LEDGER_DIR is itself
// env-overridable, so injecting a spool makes that test TRUE and fires the roll into the
// production log. An env-gated guard, inverted by its own override.
export const LEDGER_LOG = process.env.MESH_LEDGER_LOG || `${LEDGER_DIR}.ndjson`;
export const SEAL_SPOOL_MAX = 200;   // roll once the spool passes this many loose files

// Read the sealed log. `txFilter` does a raw-substring prescan so a per-tx lookup does
// not JSON.parse the whole log.
export function readSealed(logPath = LEDGER_LOG, { txFilter = null } = {}) {
  if (!existsSync(logPath)) return [];
  const out = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line) continue;
    if (txFilter && !line.includes(`"${txFilter}"`)) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is dropped, never fatal */ }
  }
  return out;
}

// Roll the spool into the sealed log. Only ever called for the REPO ledger — an injected
// MESH_LEDGER_DIR (every test, every sandbox) is a protocol concern and is left alone.
export function sealLedger({ dir = LEDGER_DIR, logPath = LEDGER_LOG, keep = 0 } = {}) {
  if (!existsSync(dir)) return { sealed: 0, kept: 0 };
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.tmp-')).sort();
  const roll = keep > 0 ? files.slice(0, Math.max(0, files.length - keep)) : files;
  if (!roll.length) return { sealed: 0, kept: files.length };
  const seen = new Set(readSealed(logPath).map(e => e.sha256));
  const lines = [], done = [];
  for (const f of roll) {
    let ev; try { ev = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    done.push(f);
    if (!ev.sha256 || seen.has(ev.sha256)) continue;   // already sealed — unlink, do not double-append
    seen.add(ev.sha256);
    lines.push(JSON.stringify(ev));
  }
  mkdirSync(dirname(logPath), { recursive: true });
  if (lines.length) appendFileSync(logPath, lines.join('\n') + '\n');   // APPEND FIRST
  for (const f of done) { try { unlinkSync(join(dir, f)); } catch { /* another room got it */ } }
  return { sealed: lines.length, kept: files.length - done.length };
}

const TYPES = ['ASK', 'CLAIM', 'HEARTBEAT', 'VERIFY_PAYLOAD', 'VERDICT', 'CLOSED', 'REOPENED', 'ESCALATED'];

// Atomic append: write a sealed event as its own file via temp + rename (atomic on
// the same filesystem). Returns { file, event }. Never mutates an existing file.
export function postEvent(ev, { dir = LEDGER_DIR } = {}) {
  if (!ev.type || !TYPES.includes(ev.type)) throw new Error(`bad event type: ${ev.type}`);
  if (!ev.tx_id) throw new Error('event needs a tx_id');
  const node = ev.node || 'unknown';

  // SUBDIVIDE THE ROOM BEFORE YOU APPEND AS IT. roomIdentity() will derive a key for ANY
  // string, so an append from a room that was never added to data/rooms.json signs fine,
  // writes fine, and exits 0 — and then mesh-replay drops it as a cross-room forgery,
  // because the registry it pins against has no such room. The writer is told it landed;
  // the reader never sees it. Refuse at the door instead: a write that cannot be read back
  // is not a write. (Measured 2026-09-09: all 9,880 events in the repo ledger are already
  // registered rooms, so this refuses nothing that has ever legitimately been posted.)
  //
  // The same check catches a STALE registry file — .thetacog/mesh/room-registry.json is a
  // derived artifact, and once written it outranks data/rooms.json in loadRegistry(). A room
  // whose recorded key no longer matches its derived one is caught here rather than going
  // quietly invalid on every future replay.
  const registry = loadRegistry();
  if (registry[node] !== roomIdentity(node).pubkey_hex) {
    throw new Error(
      `unregistered mesh node: "${node}" — replay would drop every event it signs as a cross-room forgery. ` +
      (registry[node]
        ? `The registry records a different key for "${node}"; it is stale — re-run: node scripts/mesh/mesh-keys.mjs --write`
        : `Subdivide the room first: add "${node}" to data/rooms.json (valid today: ${Object.keys(registry).join(', ')}).`));
  }

  mkdirSync(dir, { recursive: true });

  // Read this tx's existing events (in canonical order) to derive:
  //  • seq        — per-tx monotonic index (keeps causally-ordered same-tx events
  //                 correct under ts collision; concurrent events share a seq and
  //                 fall through to the sha256 tiebreak in replay)
  //  • parent_hash— the sha256 of the current leaf (tip) of this tx's chain. This is
  //                 what turns the append-only log into a per-tx hash-chained DAG:
  //                 deleting or reordering a middle event dangles a child's parent.
  const txFiles = existsSync(dir)
    ? readdirSync(dir).filter(f => f.includes(`__${ev.tx_id}__`) && f.endsWith('.json') && !f.startsWith('.tmp-'))
    : [];
  // Prior events span BOTH stores: a transaction whose ASK was sealed and whose CLAIM is
  // still in the spool must still see its parent, or seq restarts at 0 and parent_hash
  // reverts to 'genesis' — a silent chain rupture that replay would report as tampering.
  const sealedPrior = dir === LEDGER_DIR ? readSealed(LEDGER_LOG, { txFilter: ev.tx_id }).filter(e => e.tx_id === ev.tx_id) : [];
  const prior = [...sealedPrior, ...txFiles.map(f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } })].filter(Boolean)
    .sort((a, b) => (Date.parse(a.ts || 0) - Date.parse(b.ts || 0)) || ((a.seq || 0) - (b.seq || 0)) || ((a.sha256 || '') < (b.sha256 || '') ? -1 : 1));
  const seq = ev.seq != null ? ev.seq : prior.length;
  const parent_hash = ev.parent_hash != null ? ev.parent_hash : (prior.length ? prior[prior.length - 1].sha256 : 'genesis');

  // Signed AS the room's host-derived identity → the signature carries spatial authority.
  const event = sealReceiptAs({
    tx_id: ev.tx_id,
    type: ev.type,
    seq,
    parent_hash,
    ts: ev.ts || new Date().toISOString(),
    node,
    agent: ev.agent || node,
    lane: ev.lane || '',
    target_node: ev.target_node || '',
    region_constraint: ev.region_constraint || null,  // 144×144 coords for the native shape-match verify
    metrics: ev.metrics || null,                       // priceable insure/option-on-competence metrics
    body: ev.body || {},
  }, roomIdentity(node));
  const tsSafe = event.ts.replace(/[:.]/g, '-');
  const name = `${tsSafe}__${event.tx_id}__${event.type}__${randomUUID().slice(0, 8)}.json`;
  const final = join(dir, name);
  const tmp = join(dir, `.tmp-${randomUUID()}.json`);
  writeFileSync(tmp, JSON.stringify(event) + '\n');
  renameSync(tmp, final);            // ATOMIC — the whole reliability guarantee
  // Lazy roll: the spool never grows into a pile again, and nobody has to remember to seal.
  // Repo ledger only — an injected dir belongs to a test or a sandbox and is never rolled.
  if (dir === LEDGER_DIR && readdirSync(dir).filter(f => f.endsWith('.json')).length > SEAL_SPOOL_MAX) {
    try { sealLedger({ dir, keep: 20 }); } catch { /* a roll may lose a race; the next post retries */ }
  }
  return { file: final, event };
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

  // --seal [--keep N]: roll the loose spool into ledger.ndjson. Idempotent (sha256 dedupe),
  // safe to run at any time, and what the one-time 4,651-file migration ran through.
  if (process.argv.includes('--seal')) {
    const keep = parseInt(arg('--keep', '20'), 10);
    const before = existsSync(LEDGER_DIR) ? readdirSync(LEDGER_DIR).filter(f => f.endsWith('.json')).length : 0;
    const r = sealLedger({ keep });
    console.log(`sealed ${r.sealed} events → ${LEDGER_LOG}  (spool ${before} → ${r.kept})`);
    process.exit(0);
  }

  // --stress <n> <tag>: post n distinct ASK events fast (for the concurrency test)
  const stress = process.argv.indexOf('--stress');
  if (stress >= 0) {
    const n = parseInt(process.argv[stress + 1] || '50', 10);
    const tag = process.argv[stress + 2] || 'w';
    for (let i = 0; i < n; i++) {
      postEvent({ tx_id: `stress-${tag}-${i}`, type: 'ASK', node: 'voice', agent: `stress-${tag}`,
        body: { task: `stress ${tag} #${i}` } });
    }
    console.log(`posted ${n} events (tag=${tag}) → ${LEDGER_DIR}`);
    process.exit(0);
  }

  const type = arg('--type');
  if (!type) { console.error('❌ need --type ' + TYPES.join('|')); process.exit(1); }
  let tx = arg('--tx');
  if (type === 'ASK' && !tx) tx = `mesh_${randomUUID().slice(0, 12)}`;
  if (!tx) { console.error('❌ need --tx <tx_id> for a non-ASK event'); process.exit(1); }

  // body assembly: --task, --ok, or raw --body '<json>'
  let body = {};
  const rawBody = arg('--body');
  if (rawBody) { try { body = JSON.parse(rawBody); } catch { console.error('❌ --body must be JSON'); process.exit(1); } }
  if (arg('--task')) body.task = arg('--task');
  const okFlag = arg('--ok');
  if (okFlag != null) body.ok = (okFlag === 'true' || okFlag === '1');

  const parseJson = (flag) => { const r = arg(flag); if (!r) return undefined; try { return JSON.parse(r); } catch { console.error(`❌ ${flag} must be JSON`); process.exit(1); } };
  const { file, event } = postEvent({
    tx_id: tx, type, node: arg('--node'), agent: arg('--agent'),
    lane: arg('--lane'), target_node: arg('--target'), body,
    region_constraint: parseJson('--region'), metrics: parseJson('--metrics'),
  });
  console.log(JSON.stringify({ tx_id: event.tx_id, type: event.type, node: event.node,
    pubkey_hex: event.pubkey_hex.slice(0, 16) + '…', file }, null, 2));
}
