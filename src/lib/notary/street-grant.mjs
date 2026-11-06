// src/lib/notary/street-grant.mjs — C485 THE STREET LICENCE: one licence per address, for a reply, capped in all.
//
// The iamfim box (src/lib/street-offer.mjs) sends ONE email asking for one sentence back; the operator reads the reply in
// his own inbox and runs ONE command per reply — the /grant door's mint, street form:
//     node scripts/meetings/grant.mjs mint --street --account <their email> --live
// which lands here. No new schema and no second ledger: the row is an ordinary `unclaimed` grant: row on credits_ledger —
// the same kind grant.mjs mint writes, bound on /device by the same claim() a bought licence takes, revocable by grant.mjs
// revoke (its isGrantRef reads grant:). Two things differ from an operator mint, both decided by the ref:
//   • ONE PER ADDRESS — the ref carries no date (grant:street:usd20:1x10000:<email>), so the ledger's idempotency on ref IS
//     the one-per-address latch; a second reply from the same address appends nothing and says so.
//   • CAPPED IN ALL — every street row shares the prefix grant:street:, so the count is a prefix read, and the mint past
//     STREET_GRANT_CAP is refused with the reason. A revoked street licence still counts: it was given.
// Pure over an injected ledger (credits-ledger.mjs createCreditsLedger) — no env, no network, no fs.
// Guard: tests/site/c485-street-sells-two-doors.test.mjs
import { STREET_GRANT, STREET_GRANT_CAP } from '../street-offer.mjs';

export const STREET_REF_PREFIX = 'grant:street:';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const streetRef = (email) => `${STREET_REF_PREFIX}usd${STREET_GRANT.usd}:${STREET_GRANT.licences}x${STREET_GRANT.credits}:${String(email).trim().toLowerCase()}`;

/** the one row a street licence is: an unclaimed grant on the address, the same shape grant.mjs grantRow writes */
export function streetGrantRow(email) {
  const acct = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(acct)) throw new Error(`--account must be an email (got ${email})`);
  return { account_id: acct, pubkey_fingerprint: null, delta: STREET_GRANT.credits, kind: 'unclaimed', stripe_session: null, ref: streetRef(acct) };
}

/** how many street licences are out: every positive unclaimed row under the street prefix (a revoked one still counts) */
export async function streetCount(ledger) {
  const s = ledger.store;
  const rows = typeof s.byRefPrefix === 'function' ? await s.byRefPrefix(STREET_REF_PREFIX) : (await s.all(null)).filter((r) => String(r.ref).startsWith(STREET_REF_PREFIX));
  return rows.filter((r) => r.kind === 'unclaimed' && Number(r.delta) > 0).length;
}

/**
 * READ-ONLY: what one reply would mint. { row, n, cap } when it may; { row: null, refused: 'already' | 'cap', why } when not.
 * The refusal carries its reason in words — the operator reads it at the terminal and answers that reply by hand.
 */
export async function streetGrantPlan(ledger, email, { cap = STREET_GRANT_CAP } = {}) {
  const row = streetGrantRow(email);
  if (await ledger.store.has(row.ref)) return { row: null, refused: 'already', why: `${row.account_id} already holds its street licence — one per address, nothing appended` };
  const out = await streetCount(ledger);
  if (out >= cap) return { row: null, refused: 'cap', why: `the street licence is capped at ${cap} in all and ${out} are out — licence ${out + 1} is refused; answer this reply by hand` };
  return { row, n: out + 1, cap };
}

/** plan + append. { minted: true, row, n, cap } or the plan's refusal with minted: false */
export async function streetGrant(ledger, email, opts = {}) {
  const plan = await streetGrantPlan(ledger, email, opts);
  if (!plan.row) return { minted: false, ...plan };
  const r = await ledger.append(plan.row);
  if (!r.appended) return { minted: false, row: null, refused: 'already', why: `${plan.row.account_id} already holds its street licence — the same ref landed first` };
  return { minted: true, ...plan };
}
