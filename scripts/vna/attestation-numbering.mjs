// scripts/vna/attestation-numbering.mjs — C182b EVERY ATTESTATION IS ENUMERATED AGAINST THE LICENCE THAT PAID FOR IT
// (2026-09-29). Pure recompute over the credits_ledger's own row shape (src/lib/notary/credits-ledger.mjs: account_id ·
// pubkey_fingerprint · delta · ref · kind · at — a witness is kind 'witness', delta -1, ref `car:<car_sha>` or
// `car:<car_sha>#<i>`, debit()'s own idempotency key). Never a second ledger, never a write to the live one — this is the
// SUFFICIENCY layer (AXIOM 1 W6): the question it answers is "which licence paid for this attestation, and where does it
// sit in that licence's own count", never "is the ledger correct" (that is credits-ledger.mjs's own job).
//
// Each witness row carries `licence: <account>` (literally the paying account_id — named, never re-derived under a new
// word) and `n: "<k> of <credits bought>"`, so a 10,000-credit licence counts DOWN what is left to spend by counting UP
// what has already been spent: 1 of 10000 … 10000 of 10000. A GAP IN THAT SEQUENCE IS A COUNTABLE DISPLACEMENT (AXIOM 1
// W5) — two witness rows racing onto the same k leave a hole on the other end of the count, and a row appended with no n
// at all is a displacement too. `findGaps` names the exact missing numbers, never "something is wrong".

const isPosNum = (n) => Number.isFinite(n) && n > 0;

// the licence that paid for a credits_ledger row — its own account_id, read under the row's vocabulary ("licence:
// <account>") rather than invented under a second name.
export function licenceOf(row) {
  return row && typeof row === 'object' && row.account_id != null ? String(row.account_id) : null;
}

// credits bought for one licence: the sum of only the rows that MINTED credits onto this account — kind 'purchase' or
// 'grant'. C180's revoke→claim move (credits following the account to a new device) appends TWO further positive-delta
// rows under the same account_id for the SAME credits — kind 'unclaimed' (the pool leg a revoke returns) and kind
// 'claim' (the :in leg a claim binds to the new fingerprint) — and a naive "every positive row" sum counted those as
// NEW purchases: a 10-credit licence read as 30 after one revoke→claim move (10 purchase + 10 unclaimed-pool + 10
// claim:in), inflating every later `n: "<k> of <total>"` stamp. Neither kind mints anything — they relocate credits a
// purchase or grant already minted — so they never count here, however many times a licence moves devices. Read off
// the ledger's own retained rows (AXIOM 1: evict or retain, never rewrite) — never a second total kept anywhere else.
export function creditsBoughtFor(rows, account_id) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.account_id === account_id && (r.kind === 'purchase' || r.kind === 'grant') && Number(r.delta) > 0).reduce((s, r) => s + Number(r.delta), 0);
}

// every witness row under one licence, IN LEDGER ORDER (append order — the order debit() wrote them, never re-sorted),
// each carrying licence + n: "<k> of <creditsBought>". A read-time projection over rows that do not yet carry n
// themselves (e.g. a pre-C182b row) — for rows written by `witnessRow` below, n already rides on the row and this
// merely confirms it.
export function enumerateWitnesses(rows, account_id, { creditsBought } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const total = Number.isFinite(creditsBought) ? creditsBought : creditsBoughtFor(all, account_id);
  const mine = all.filter((r) => r && r.kind === 'witness' && r.account_id === account_id);
  return mine.map((r, i) => ({ ...r, licence: account_id, n: `${i + 1} of ${total}` }));
}

// the row's own n, wherever it landed: FLAT (r.n — witnessRow's own return shape, and every fixture in this file's own
// guard) or NESTED under r.meta.n (credits-ledger.mjs's jsonb column, supabase/migrations/20260929_c182b_witness_
// numbering.sql — one jsonb column holds { licence, n } together, so the live write path never widens the table by two
// flat columns for one fact). Never a third shape; a row carrying neither reads null, the same as a pre-C182b row.
export function nOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.n === 'string') return row.n;
  if (row.meta && typeof row.meta === 'object' && typeof row.meta.n === 'string') return row.meta.n;
  return null;
}

// the row debit() would append, WITH licence + n baked in at write time — never derived later from array position
// alone, so the record itself carries what it needs (AXIOM 1: what a process displaced is what its own account must
// carry). car_sha rides in ref (`car:<car_sha>`, credits-ledger.mjs's own idempotency key) — never a second field for
// the same fact.
export function witnessRow({ account_id, pubkey_fingerprint = null, car_sha, priorCount, creditsBought, at = new Date().toISOString() } = {}) {
  if (!account_id) throw new Error('witnessRow needs account_id — the licence that pays');
  if (!car_sha) throw new Error('witnessRow needs car_sha');
  if (!Number.isFinite(priorCount) || priorCount < 0) throw new Error('witnessRow needs priorCount — how many this licence already spent');
  if (!isPosNum(creditsBought)) throw new Error("witnessRow needs creditsBought — the licence's own total, never re-derived here");
  const n = priorCount + 1;
  return { account_id, pubkey_fingerprint, delta: -1, ref: `car:${car_sha}`, kind: 'witness', at, licence: account_id, n: `${n} of ${creditsBought}` };
}

// parse "<k> of <total>" back to { k, total } — null on anything else (absent, malformed, or a row from before this
// unit that carries no n at all).
export function parseN(n) {
  const m = typeof n === 'string' ? /^(\d+) of (\d+)$/.exec(n) : null;
  return m ? { k: Number(m[1]), total: Number(m[2]) } : null;
}

// AXIOM 1 W5 — A GAP IN A MONOTONIC SEQUENCE IS ITSELF A COUNTABLE DISPLACEMENT. Every witness row for a licence should
// carry a DISTINCT k covering 1..k_max with no hole. Returns the exact missing numbers and any k two rows share —
// `clean` is true only when neither happens and every witness row carries an n at all.
export function findGaps(rows, account_id) {
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => r && r.kind === 'witness' && r.account_id === account_id);
  const parsed = mine.map((r) => parseN(nOf(r)));
  const ks = parsed.filter(Boolean).map((p) => p.k);
  const unnumbered = parsed.length - ks.length;
  if (!ks.length) return { clean: unnumbered === 0, missing: [], duplicated: [], unnumbered };
  const seen = new Map(); for (const k of ks) seen.set(k, (seen.get(k) || 0) + 1);
  const max = Math.max(...ks);
  const missing = []; for (let i = 1; i <= max; i++) if (!seen.has(i)) missing.push(i);
  const duplicated = [...seen.entries()].filter(([, c]) => c > 1).map(([k]) => k);
  return { clean: missing.length === 0 && duplicated.length === 0 && unnumbered === 0, missing, duplicated, unnumbered };
}

// the sub-pill's face: used/total for one licence. `used` is the count of witness rows actually on the ledger (never
// max(k) — a duplicate or a gap still reads the true count of rows on disk); `total` is the licence's own creditsBought.
export function subPillFace(rows, account_id, { creditsBought } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const total = Number.isFinite(creditsBought) ? creditsBought : creditsBoughtFor(all, account_id);
  const used = all.filter((r) => r && r.kind === 'witness' && r.account_id === account_id).length;
  return `${account_id} · ${used} of ${total} cr`;
}

// C360 (operator 2026-09-27, verbatim: "when a license is started on a machine, the 10k attestations should only be
// signable on that cpu - that tape … when a license key breaks on a machine we should be able to count each signed -
// the rest can be moved by logging in? only if unclaimed first by the machine theyre on"). THOUGHT WE HAD A CREDIT
// LEDGER — we did: credits-ledger.mjs already binds a witness row's spend to the fp that signed it (balance(fp) is
// fp-scoped, so a machine with no balance cannot witness — "signable only on that CPU" needs no new code), and
// ledger.revoke()+ledger.claim() (C180) already move "the rest" — the UNSPENT remainder — to a new fp only after
// revoke returns it to the account's unclaimed pool. What was missing was the READ this row asks for: when a
// machine's key breaks, count exactly how many of the licence's attestations THAT machine signed — a fact that must
// survive the move untouched, because a witness row is never rewritten (AXIOM 1), only ever appended.

// the fp that actually signed a witness row — the CPU/tape it landed on, read off the row's own field, never re-derived
export function machineOf(row) {
  return row && typeof row === 'object' && row.pubkey_fingerprint ? String(row.pubkey_fingerprint) : null;
}

// how many of this licence's witness rows one specific machine (pubkey_fingerprint) actually signed — "when a licence
// key breaks on a machine we should be able to count each signed". Reads the retained rows directly, so a revoke or a
// later claim onto a different fp (which only APPENDS further rows) can never change what an earlier machine signed.
export function signedByMachine(rows, account_id, pubkey_fingerprint) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.kind === 'witness' && r.account_id === account_id && machineOf(r) === pubkey_fingerprint).length;
}

// every machine that has ever signed for this licence, each with its own signed count — "count each signed" as a full
// breakdown across a licence that has moved machines, never collapsed to the licence-wide total alone. Sorted by
// signed count descending (the current/heaviest machine first); a machine that signed nothing is never listed —
// absence is not a zero-count row (AXIOM 1's sufficiency corollary: an unmeasured machine reads as unmeasured, not 0).
export function machinesSigned(rows, account_id) {
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => r && r.kind === 'witness' && r.account_id === account_id);
  const byFp = new Map();
  for (const r of mine) { const fp = machineOf(r); if (!fp) continue; byFp.set(fp, (byFp.get(fp) || 0) + 1); }
  return [...byFp.entries()].map(([pubkey_fingerprint, signed]) => ({ pubkey_fingerprint, signed })).sort((a, b) => b.signed - a.signed);
}
