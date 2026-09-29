// scripts/vna/licence-history.mjs — C182: MANY LICENCES LOCK TO ONE MACHINE, read side.
//
// A pure mirror of packages/thetacog-mcp-vscode/src/licence-list.ts's ClaimRecord/summarizeClaims — steer-ui.mjs is a plain
// mjs render module and cannot import a .ts file from the extension package (a separate compiled unit, C166's own note).
// The ROW SHAPE is the contract, not the code: { at, fp, account_id, credits }, one row per successful claim, written by
// auth-manager.ts's appendClaimHistory on every verified licence (single paste or one of a pasted list alike) to
// .thetacog/claimed-licences.ndjson — non-secret (the same class as .thetacog/entitlement-claims.json), never the JWT.
// LLM-FREE: nothing here calls a model.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const CLAIM_HISTORY_FILE = () => process.env.VNA_CLAIM_HISTORY || resolve(REPO, '.thetacog', 'claimed-licences.ndjson');

/** every row on the file, oldest first — [] on an absent or unreadable file, never a throw (a read process, not a writer). */
export function readClaimHistory(file = CLAIM_HISTORY_FILE()) {
  try { return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

/** k = distinct accounts claimed under this fp, sum = their credits, one row per account counted (the newest wins) — the
 * exact rule licence-list.ts's summarizeClaims states; kept in step by hand since the two files cannot share one module. */
export function summarizeClaims(records, fp) {
  const byAccount = new Map();
  for (const r of records || []) { if (r && r.fp === fp) { byAccount.set(r.account_id, r); } }
  let sum = 0; for (const r of byAccount.values()) { sum += Number(r.credits) || 0; }
  return { k: byAccount.size, sum };
}
