// src/lib/notary/credits-ledger.mjs — C84c THE CREDITS LEDGER (goal 11 unit 4, 2026-09-18).
// Credits are LEDGER ROWS THE WEBHOOK WRITES — never a client claim, never an env JSON (C84 invariant 3; NOTARY_ACCOUNTS_JSON
// is retired by this file). A row is { account_id, pubkey_fingerprint, pubkey?, delta, ref, kind, stripe_session?, at };
// the balance is a SUM over rows, never an updated column (AXIOM 1: evict or retain — a purchase is retained, a witness
// is a −1 row beside it, and nothing is ever rewritten). `ref` is the idempotency key: `stripe:<session>` for a purchase,
// `car:<car_sha>` for a witness — a replayed webhook or a re-sent CAR appends nothing.
// C84f (2026-09-20) ONE WAY TO PAY, AND IT MINTS: a licence bought on the website with no device waiting (claim: email on the
// session, no fingerprint) lands as an UNCLAIMED row — kind 'unclaimed', pubkey_fingerprint null, the account the only handle.
// The claim is a PAIR appended beside it when /device approves a key for that account: −N under the account (fingerprint
// null) and +N under the key, both kind 'claim', refs claim:<ref>:out / claim:<ref>:in — the purchase row is retained, never
// rewritten, and a second claim moves nothing (the :out ref is already on the record). The account balance is unchanged by
// the move; the key's balance is what the notary (C84d) and the JWT read.
// WebCrypto-free and fs-free: edge-safe. The STORE is the adapter — memory (the guard's), a temp-file double (node only,
// injected by the test), Supabase (prod; the table is supabase/migrations/20260918_credits_ledger.sql, never run from here — the same
// `credits_ledger` C84a's device store sums by account_id, so one table answers both readers).

const ROW_KEYS = ['account_id', 'pubkey_fingerprint', 'pubkey', 'delta', 'ref', 'kind', 'stripe_session', 'at'];
const isFp = (s) => typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);
export const KINDS = Object.freeze(['purchase', 'witness', 'grant', 'unclaimed', 'claim', 'refusal', 'revoke']);
// C173e — a 'refusal' row moves nothing (delta 0, the only kind that may): it records that a licence bound to one device was
// asked to sign another, under the REFUSED fingerprint, so the ledger holds the attempt and never the balance change
// C180 — a 'revoke' row ALSO moves nothing (delta 0): it is the explicit MOVE act, under the OLD pubkey_fingerprint,
// authorised by that device's own signature (or, the machine gone, a magic-link token to the account email — the SEND leg
// is not built, see device-flow.mjs mintRevokeToken). The credit-following-the-account leg (zeroing the old fp, returning
// the balance to the account's unclaimed pool for the new device's ordinary claim) is two FURTHER rows this same call
// appends under existing kinds ('claim' delta<0 under the old fp, 'unclaimed' delta>0 with no fp) — see ledger.revoke below.
const ZERO_DELTA_KINDS = new Set(['refusal', 'revoke']);   // the only kinds whose row may (must) carry delta 0
const UNBOUND = new Set(['unclaimed', 'claim']);   // the only kinds a row may carry with no fingerprint — and then the account is required

export function normalizeRow(r) {
  if (!r || typeof r !== 'object') throw new Error('credits row must be an object');
  const delta = Number(r.delta); const zeroKind = ZERO_DELTA_KINDS.has(r.kind);
  if (!Number.isInteger(delta) || (zeroKind ? delta !== 0 : delta === 0)) throw new Error(zeroKind ? `a ${r.kind} row moves nothing — delta must be 0` : 'credits row delta must be a non-zero integer');
  const kind = r.kind || (delta > 0 ? 'purchase' : 'witness');
  if (!KINDS.includes(kind)) throw new Error(`credits row kind must be one of ${KINDS.join(' | ')}`);
  const unbound = r.pubkey_fingerprint == null || r.pubkey_fingerprint === '';
  if (unbound && !UNBOUND.has(kind)) throw new Error('credits row needs pubkey_fingerprint (16 hex)');
  if (unbound && (r.account_id == null || String(r.account_id).trim() === '')) throw new Error(`an ${kind} row with no fingerprint needs account_id — the one handle that can claim it`);
  if (!unbound && !isFp(r.pubkey_fingerprint)) throw new Error('credits row needs pubkey_fingerprint (16 hex)');
  const ref = r.ref || (r.stripe_session ? `stripe:${r.stripe_session}` : null);
  if (!ref) throw new Error('credits row needs ref (or stripe_session) — the idempotency key');
  // account_id is NOT NULL in the table: a row with no account is the device's own (the fingerprint)
  const row = { account_id: r.account_id == null ? r.pubkey_fingerprint : String(r.account_id), pubkey_fingerprint: unbound ? null : r.pubkey_fingerprint, pubkey: r.pubkey || null, delta, ref, kind, stripe_session: r.stripe_session || null, at: r.at || new Date().toISOString() };
  return Object.fromEntries(ROW_KEYS.map((k) => [k, row[k]]));
}

// ── stores: { async all(fp) → rows in append order · async has(ref) → bool · async append(row) → row } ─────────────────
export function memoryCreditsStore() {
  const rows = []; const refs = new Set();
  return { kind: 'memory', async all(fp) { return rows.filter((r) => fp == null || r.pubkey_fingerprint === fp); }, async byAccount(a) { return rows.filter((r) => r.account_id === a); }, async has(ref) { return refs.has(ref); }, async append(row) { refs.add(row.ref); rows.push(row); return row; } };
}

// the temp-file double: node only — the test INJECTS node:fs (no node import here, so the edge bundle never sees one);
// a "cold start" is a second fileCreditsStore on the same path
export function fileCreditsStore(path, fs) {
  if (!fs || typeof fs.appendFileSync !== 'function') throw new Error('fileCreditsStore needs an injected fs (node only)');
  const load = () => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    kind: 'file', path,
    async all(fp) { return load().filter((r) => fp == null || r.pubkey_fingerprint === fp); },
    async byAccount(a) { return load().filter((r) => r.account_id === a); },
    async has(ref) { return load().some((r) => r.ref === ref); },
    async append(row) { fs.appendFileSync(path, JSON.stringify(row) + '\n'); return row; },
  };
}

// prod: a supabase-js client (service role — the webhook and the notary route are server-side only); table credits_ledger,
// the columns C84a's migration + 20260918_credits_ledger.sql give it
export function supabaseCreditsStore(client, table = 'credits_ledger') {
  const q = () => client.from(table);
  return {
    kind: 'supabase', table,
    async all(fp) { let s = q().select(ROW_KEYS.join(',')).order('id', { ascending: true }); if (fp != null) s = s.eq('pubkey_fingerprint', fp); const { data, error } = await s; if (error) throw new Error(`credits_ledger read: ${error.message}`); return data || []; },
    async byAccount(a) { const { data, error } = await q().select(ROW_KEYS.join(',')).eq('account_id', a).order('id', { ascending: true }); if (error) throw new Error(`credits_ledger read: ${error.message}`); return data || []; },
    async has(ref) { const { data, error } = await q().select('ref').eq('ref', ref).limit(1); if (error) throw new Error(`credits_ledger read: ${error.message}`); return !!(data && data.length); },
    async append(row) { const { error } = await q().insert(row); if (error) { if (error.code === '23505' || /duplicate key|unique/i.test(error.message || '')) return null; throw new Error(`credits_ledger insert: ${error.message}`); } return row; },
  };
}

// ── the ledger ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function createCreditsLedger(store) {
  return {
    kind: store.kind, store,
    // append-only + idempotent on ref: { appended: false, row: existing } when the ref is already on the record
    async append(r) {
      const row = normalizeRow(r);
      if (await store.has(row.ref)) return { appended: false, row: (await store.all(row.pubkey_fingerprint)).find((x) => x.ref === row.ref) || row };
      const stored = await store.append(row);
      if (!stored) return { appended: false, row };   // the store's unique index won the race — someone else appended the same ref
      return { appended: true, row: stored };
    },
    async rows(fp) { return store.all(fp); },
    async balance(fp) { return (await store.all(fp)).reduce((s, r) => s + Number(r.delta || 0), 0); },
    // C84f — the account's view: every row under it (unclaimed, claimed, bound), the same SUM supabaseDeviceStore.creditsOf reads
    async balanceOf(account_id) { return (await store.byAccount(account_id)).reduce((s, r) => s + Number(r.delta || 0), 0); },
    // the unclaimed rows still unbound: kind 'unclaimed' with no claim:<ref>:out row beside them
    async unclaimedOf(account_id) { const rows = await store.byAccount(account_id); const out = new Set(rows.filter((r) => r.kind === 'claim' && r.delta < 0).map((r) => r.ref)); return rows.filter((r) => r.kind === 'unclaimed' && !out.has(`claim:${r.ref}:out`)); },
    // the claim: for each unclaimed row, −N under the account and +N under the key — appended, idempotent on the :out ref
    async claim({ account_id, pubkey_fingerprint, pubkey = null, at = new Date().toISOString() }) {
      if (!isFp(pubkey_fingerprint)) throw new Error('claim needs the 16-hex fingerprint of the key the credits bind to');
      let moved = 0, credits = 0;
      for (const u of await this.unclaimedOf(account_id)) {
        const out = await this.append({ account_id, pubkey_fingerprint: null, delta: -u.delta, ref: `claim:${u.ref}:out`, kind: 'claim', at });
        if (!out.appended) continue;   // someone else claimed it between the read and the write — the :out ref won
        await this.append({ account_id, pubkey_fingerprint, pubkey, delta: u.delta, ref: `claim:${u.ref}:in`, kind: 'claim', at });
        moved += 1; credits += u.delta;
      }
      return { moved, credits, balance: await this.balance(pubkey_fingerprint) };
    },
    // C173e — the device this account's licence is bound to: the newest CREDIT-CARRYING fingerprint row under the account
    // (a claim :in, a purchase minted onto a waiting device, a grant) — null = not yet bound. C180 — a 'revoke' row is a
    // STOP: scanning newest-first, hitting one before any qualifying row means "nothing is bound right now" (a move is
    // mid-flight), even though an older claim :in for the revoked fp is still further back in the same account's history.
    // A refusal never counts (skip and keep scanning); revoke's own delta<0 zero-out leg (kind 'claim') never qualifies
    // either (delta<=0), so it cannot be mistaken for a fresh binding on the account it just unbound.
    async boundTo(account_id) {
      const rows = await store.byAccount(account_id);
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.kind === 'refusal') continue;
        if (r.kind === 'revoke') return null;
        if (r.pubkey_fingerprint && r.delta > 0) return r.pubkey_fingerprint;
      }
      return null;
    },
    async refuse({ account_id, pubkey_fingerprint, at = new Date().toISOString() }) {
      return this.append({ account_id, pubkey_fingerprint, delta: 0, ref: `refusal:${account_id}:${pubkey_fingerprint}:${at}`, kind: 'refusal', at });
    },
    // C180 — THE MOVE'S SECOND HALF (the first is the caller's own authorisation check — device-flow.mjs `revoke` verifies
    // the old device's signature, or a revoke-link token, BEFORE calling this). Refuses unless the account is currently
    // bound to exactly this fp (a stale or already-moved revoke is a no-op, never a second unbind). Appends: (1) the
    // required delta-0 'revoke' marker — the audit row the spec names, authorised, retained forever; (2) IF the fp carried
    // a balance, a delta<0 'claim' row that zeroes it (balance(old fp) reads 0 after) and a delta>0 'unclaimed' row with no
    // fingerprint that returns the same credits to the account's pool — reclaimable by the ORDINARY claim() a new device's
    // approve/claim already calls, so "credits follow the account" needs no new claiming code, only this returned row.
    async revoke({ account_id, pubkey_fingerprint, at = new Date().toISOString() }) {
      if (!isFp(pubkey_fingerprint)) throw new Error('revoke needs the 16-hex fingerprint of the device being moved off');
      const bound = await this.boundTo(account_id);
      if (bound !== pubkey_fingerprint) return { revoked: false, why: bound ? `bound to a different device (${bound.slice(0, 8)}), not ${pubkey_fingerprint.slice(0, 8)}` : 'that account is not bound to any device' };
      const marker = await this.append({ account_id, pubkey_fingerprint, delta: 0, ref: `revoke:${account_id}:${pubkey_fingerprint}:${at}`, kind: 'revoke', at });
      const n = await this.balance(pubkey_fingerprint);
      let returned = 0;
      if (n > 0) {
        const zero = await this.append({ account_id, pubkey_fingerprint, delta: -n, ref: `revoke:${account_id}:${pubkey_fingerprint}:${at}:zero`, kind: 'claim', at });
        if (zero.appended) { await this.append({ account_id, pubkey_fingerprint: null, delta: n, ref: `revoke:${account_id}:${pubkey_fingerprint}:${at}:pool`, kind: 'unclaimed', at }); returned = n; }
      }
      return { revoked: true, marker: marker.row, pubkey_fingerprint, returned };
    },
    // the pubkey this fingerprint is bound to: the newest row that carries one (the webhook copies it off the device row)
    async pubkeyOf(fp) { const rows = await store.all(fp); for (let i = rows.length - 1; i >= 0; i--) if (rows[i].pubkey) return rows[i].pubkey; return null; },
    async accountOf(fp) { const rows = await store.all(fp); for (let i = rows.length - 1; i >= 0; i--) if (rows[i].account_id) return rows[i].account_id; return null; },
  };
}

// the price of a witness, as the 402 body carries it — credits, never a currency (rule 7: no dollar sign anywhere a person reads)
export const WITNESS_PRICE = Object.freeze({ credits_per_witness: 1, unit: 'credit', buy: 'https://thetadriven.com/device', note: 'the measurement is free; the underwriting is paid' });

// ── the gateway's `accounts` adapter over the credits ledger (replaces memoryAccounts + NOTARY_ACCOUNTS_JSON in prod) ──
// Every call is async; the gateway awaits its adapters (C84d). `pubkeyOf` may be injected (the device store knows the key
// for a fingerprint before any purchase row does) — the ledger's own rows are the fallback.
export function creditsAccounts(ledger, { pubkeyOf = null, now = () => new Date().toISOString() } = {}) {
  const keyFor = async (fp) => (pubkeyOf && (await pubkeyOf(fp))) || (await ledger.pubkeyOf(fp));
  return {
    kind: `credits:${ledger.kind}`,
    async get(fp) { const pubkey = await keyFor(fp); if (!pubkey) return null; return { pubkey, credits: await ledger.balance(fp) }; },
    async credits(fp) { return ledger.balance(fp); },
    // a witness is a −1 row keyed by car_sha; the ledger refuses (appends nothing) when the same CAR is charged twice
    async debit(fp, n = 1, { car_sha = null, ref = null } = {}) {
      const have = await ledger.balance(fp); if (have < n) throw new Error(`insufficient credits: ${have} < ${n}`);
      const key = ref || (car_sha ? `car:${car_sha}` : `debit:${fp}:${now()}:${Math.random().toString(36).slice(2, 8)}`);
      for (let i = 0; i < n; i++) await ledger.append({ account_id: await ledger.accountOf(fp), pubkey_fingerprint: fp, delta: -1, ref: n === 1 ? key : `${key}#${i}`, kind: 'witness', at: now() });
      return ledger.balance(fp);
    },
    price: () => ({ ...WITNESS_PRICE }),
    // C44's memoryAccounts.register kept for the route's one-off registrations (a key with 0 credits is a bound device, not a funded one)
    async register(pubkey, credits = 0, { fingerprintOf } = {}) { if (!fingerprintOf) throw new Error('register needs fingerprintOf'); const fp = await fingerprintOf(pubkey); if (credits > 0) await ledger.append({ account_id: null, pubkey_fingerprint: fp, pubkey, delta: credits, ref: `grant:${fp}:${now()}`, kind: 'grant', at: now() }); return fp; },
  };
}
