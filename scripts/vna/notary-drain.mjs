// scripts/vna/notary-drain.mjs — C97f THE UPLOAD IS PROGRAMMATIC (2026-09-19). Operator: "upload tape … must be initiated
// programmatically for credits later". The 💳 buys credits on /notarise (never an upload); this module spends them: while
// `entitlement.credits > 0`, one queued CAR (C85c's append-only queue) is uploaded per credit, in seq order, and the drain
// STOPS — at zero credits, at the first upload that does not land, at a 402 (a price is not a partition). PURE: the queue and
// the upload are adapters handed in, so the extension can hold its queue in memory and the guard can drive it with a temp file
// and no network. backupReading() is the 🔗 control's READING — the sentence that replaces the human upload button.
// @guard tests/vna/c97f-notarise-this-tape.test.mjs
// C102b (2026-09-20): the hosted notary is OFF by default. `data/vna/notarize-setting.json` { mode: 'local' | 'hosted' } — the
// straight path stamps rows locally at append time (flight-tape.mjs, the C90 stamp paid from the local ledger); this drain and
// the audit link (C99b) run only when the mode is 'hosted'. `drainIfHosted` is the one door that reads the setting; `drainForCredits`
// stays pure and unchanged beneath it. @guard tests/vna/c102b-local-stamp-right-away.test.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUEUE_FILE, queueState, markAttempt, markDrained } from './notary-queue.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NOTARIZE_SETTING = process.env.VNA_NOTARIZE_SETTING || resolve(REPO, 'data/vna/notarize-setting.json');
export const NOTARIZE_MODES = ['local', 'hosted'];
// the setting as written; absent, malformed or unknown → 'local' (the default is the straight path, never the hosted notary)
export function notarizeMode(path = NOTARIZE_SETTING) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return j && NOTARIZE_MODES.includes(j.mode) ? j.mode : 'local'; } catch { return 'local'; }
}
// the fence: hosted off → the drain is never called, and the reading says which mode held; hosted on → drainForCredits, as C97f built it
export async function drainIfHosted({ mode = notarizeMode(), drain = drainForCredits, ...args } = {}) {
  if (mode !== 'hosted') return { ran: false, mode, uploaded: 0, creditsLeft: null, queued: null, why: `notarize: ${mode} — the hosted notary is off; new rows are countersigned locally at append time (C102b)`, price: null };
  return { ran: true, mode, ...(await drain(args)) };
}

// the file-backed queue adapter over C85c's one door: pending() in seq order, drained rows appended, attempts appended
export function fileQueue(file = QUEUE_FILE) {
  return {
    file,
    pending: () => queueState(file).pending,
    drainedCount: () => queueState(file).drained,
    markDrained: (rows, receipts, now) => markDrained(file, rows, receipts, now),
    markAttempt: (rows, why, now) => markAttempt(file, rows, why, now),
  };
}

const creditsOf = (entitlement) => { const n = entitlement && Number(entitlement.credits); return Number.isFinite(n) ? n : 0; };

// drainForCredits: upload one queued CAR per credit while credits > 0; stop and say why. `upload(row)` resolves to
// { ok: true, receipt } or { ok: false, status?, why, price? }; a throw is a failed upload with its message.
export async function drainForCredits({ entitlement = null, queue, upload, now = () => new Date().toISOString() } = {}) {
  if (!queue || typeof queue.pending !== 'function') throw new Error('drainForCredits: a queue adapter with pending() is required');
  if (typeof upload !== 'function') throw new Error('drainForCredits: an upload adapter is required');
  const out = { uploaded: 0, creditsLeft: creditsOf(entitlement), queued: 0, why: null, price: null };
  const pending = [...queue.pending()].sort((a, b) => (a.seq - b.seq));
  out.queued = pending.length;
  if (!entitlement) { out.why = 'no entitlement — nothing uploaded; drains when credits > 0'; return out; }
  if (out.creditsLeft <= 0) { out.why = `0 credits — nothing uploaded; drains when credits > 0`; return out; }
  if (!pending.length) { out.why = 'queue empty — nothing left to upload'; return out; }
  for (const row of pending) {
    if (out.creditsLeft <= 0) { out.why = `credits spent — ${out.uploaded} uploaded, ${pending.length - out.uploaded} still queued; drains when credits > 0`; out.queued = pending.length - out.uploaded; return out; }
    let r;
    try { r = await upload(row); } catch (e) { r = { ok: false, why: String(e && e.message || e) }; }
    if (!r || !r.ok) {
      const why = r && r.status === 402 ? `payment required — ${r.why || ''}`.trim() : String((r && r.why) || 'upload did not land');
      if (r && r.status === 402) out.price = r.price || null;
      if (typeof queue.markAttempt === 'function') queue.markAttempt([row], why, now);
      out.why = `stopped at seq ${row.seq}: ${why}`; out.queued = pending.length - out.uploaded; return out;
    }
    if (typeof queue.markDrained === 'function') queue.markDrained([row], [r.receipt || {}], now);
    out.uploaded++; out.creditsLeft--;
  }
  out.queued = 0; out.why = `queue empty — ${out.uploaded} uploaded, nothing left; ${out.creditsLeft} credits left`;
  return out;
}

// the 🔗 control's READING (C97f): never a human upload button. Without credits the queue is named and what unlocks it;
// with credits, what has landed and what is left to spend. Counts are numbers, never blank (an absent queue reads 0).
export function backupReading({ queue, entitlement = null } = {}) {
  const pending = queue && typeof queue.pending === 'function' ? queue.pending().length : 0;
  const drained = queue && typeof queue.drainedCount === 'function' ? queue.drainedCount() : 0;
  const credits = creditsOf(entitlement);
  return credits > 0 ? `${drained} uploaded · ${credits} credits left` : `${pending} actions queued · drains when credits > 0`;
}

// C99b — THE AUDIT LINK IS ONE CLICK (declared 2026-09-19, dormant behind notarize: hosted, the same fence as backupReading
// above): once a CAR has been uploaded and its receipt carries the manifest URL — backup.mjs's `.thetacog/backup/<sha>.upload.json`,
// `{ sha, url }`, C84b/C71's `/backup?manifest=<sha>` — the 📋 Copy Audit Link control reads that URL straight off the receipt,
// never re-derived, never a second sha; the page it points at (C97c's `verify <url>`) recomputes the chain and prints the
// countersignature count on its own — this line never re-states that count. Before any upload the control names the queue
// instead, so it is never a dead link: `no audit link yet — <n> queued`. `receipt` is injected — this module never reads
// the upload file (the same PURE, adapters-in idiom as drainForCredits/backupReading above).
export const AUDIT_LINK_CMD = 'vna.copyAuditLink';
export function auditLinkLine({ queue, receipt = null } = {}) {
  if (receipt && receipt.url) return String(receipt.url);
  const pending = queue && typeof queue.pending === 'function' ? queue.pending().length : 0;
  return `no audit link yet — ${pending} queued`;
}

// the CLI face (C99b): `node scripts/vna/notary-drain.mjs --audit-link` prints the SAME line the 📋 Copy Audit Link control
// shows — the extension's vna.copyAuditLink command runs this and copies exactly what it printed, never re-deriving the
// reading in TypeScript (the same shape as run-summary.mjs / copyRunSummary). Reads the live queue and the newest backup
// upload receipt (backup.mjs's own directory, `.thetacog/backup/<sha>.upload.json`) — its own local scan, kept out of the
// exported functions above (which stay PURE, adapters-in) so this file never imports steer-ui.mjs back (that module already
// imports fileQueue/auditLinkLine/AUDIT_LINK_CMD from here — a reverse import would cycle).
function newestUploadReceiptCli(repo = REPO) {
  const dir = resolve(repo, '.thetacog/backup'); if (!existsSync(dir)) return null;
  let newest = null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.upload.json'))) { let u = null; try { u = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; } if (!u || !u.url) continue; if (!newest || String(u.at || '').localeCompare(String(newest.at || '')) > 0) newest = u; }
  return newest;
}
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--audit-link')) {
  process.stdout.write(auditLinkLine({ queue: fileQueue(), receipt: newestUploadReceiptCli() }) + '\n');
}
