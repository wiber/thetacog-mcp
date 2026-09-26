// src/lib/auth/notary-seat-checkout.mjs — C84b BUY LICENCES: the Stripe Checkout session for a NOTARY SEAT, as a pure
// builder (goal 11 unit 3, 2026-09-18). One price (STRIPE_PRICE_NOTARY_SEAT); the mode follows the price's type (one_time →
// payment, recurring → subscription — the $20/agent-year price the site already sells is yearly; C102a chain walk 2026-09-20). C84 invariant 4: the device is bound by the pubkey the tape signs with — its fingerprint and the device_code
// ride the session METADATA, which only the webhook reads (C84c), and NEVER a URL a person copies: success_url and cancel_url
// carry the user code only, so /licences can read the row back from the store.
// The metadata `tier: 'notary_seat'` keeps the existing webhook's CRM branch (tier unset or 'crm') from firing on it.
// C97f (2026-09-19): the SAME session is built for /notarise?fp&h — `returnTo: 'notarise'` returns the person to the page that
// names THIS tape (the fp and the height are that page's own address, the one the extension wrote; the webhook still reads only
// metadata), and `tape_height` rides metadata beside the fingerprint so the credits row can say which tape height was bought for.
// C99c (2026-09-19) THE COUNT IS READ OFF THE PRICE: how many countersignatures one unit of the price buys is ONE number, the
// Stripe price object's `metadata.credits_per_unit`, retrieved at checkout time (`prices.retrieve(STRIPE_PRICE_NOTARY_SEAT)`
// through the injected client) and carried on the session metadata as `credits` = units × credits_per_unit; C84c reads its
// `delta` off that metadata and nothing else. No count is typed here, on the page, or in the webhook — a price whose
// metadata carries no count builds no session and the surfaces print `UNMEASURED — price not configured`. The line-item
// quantity is UNITS (licences), never credits: the /licences form and /notarise both post units (default 1; C102a chain walk 2026-09-20 — buy as many as you want, bounded by MAX_UNITS).
// C102f (2026-09-20) THE CHECKOUT SAYS WHY YOU PAY, NOT WHY YOU DOWNLOADED: WHY_YOU_PAY, the three sentences /notarise prints
// between the tape's name and the button (and the card's + tier under the 💳, C103d) — written ONCE here, where the page can
// import it; the public-surface register re-exports it. C103c (2026-09-20) THE CHECKOUT OPENS AT ONCE: the page never waits
// on Stripe to paint — its price read is served from the COMMITTED receipt data/vna/notary-price.json (priceReceipt ·
// notaryPriceFromReceipt, synchronous), written by scripts/vna/notary-price-receipt.mjs --write from a real read and refused
// when the read is dark; Stripe is consulted at checkout time only (the route's retrievePrice). notaryPriceFromEnv stays for
// /licences and the generator.
// C84f (2026-09-20) ONE WAY TO PAY, AND IT MINTS (operator: "It's only one way to pay and it's for licenses. You buy many of
// them as you want. They're on the checkout pages on IMF."): /iamfim#checkout builds its session HERE too — the third door
// on the same builder (returnTo 'iamfim'). A buyer from the website has no device waiting, so the session carries
// `claim: 'email'` and an EMPTY fingerprint; the webhook (C84c) records the credits UNCLAIMED under the account and /device
// approve binds them onto the key that shows up. A session with neither a fingerprint nor a claim is refused here. The one
// `checkout.sessions.create` the site makes for a licence is `stripeCheckout()` below — both routes import it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const MAX_UNITS = 999_999;   // licences per checkout — Stripe's own line-item ceiling, the only bound ("buy as many as you want"); never the count a licence carries

// C154 (2026-09-21, operator: "make sure the checkout licenses are on all the pages, and licenses saved to login") — the
// checkout door's URL MOVED HERE from scripts/vna/public-surface-register.mjs, which re-exports it byte-identical below.
// The extension side (scripts/vna) can import src/lib freely — that direction was already established (creditsPerUnit,
// countLine, WHY_YOU_PAY all live here and are re-exported there) — but the reverse is refused on this file's own earlier
// note: "a Next page cannot import scripts/". LedgerDoor.tsx, the site's global checkout+login bar (C154), is mounted in
// the ROOT LAYOUT, so a scripts/vna import there would drag next.config.js's BLOG_FN_EXCLUDES exclusion of ./scripts/**
// onto every route's serverless function trace, not one page — the same 2.57 GB / 250 MB failure mode that exclusion was
// added to prevent, this time site-wide instead of on one blog route. One string, sourced where a Next page can reach it.
export const NOTARISE_BASE = 'https://thetadriven.com/notarise';
export const CHECKOUT_URL = NOTARISE_BASE;

// 2026-09-24 (operator, /steer: "the fund the ledger / stripe page link on iamfim.com obviously needs to link to the market
// page") — the marketplace listing MOVED HERE from scripts/vna/public-surface-register.mjs (re-exported there byte-identical),
// for the same reason CHECKOUT_URL did: LedgerDoor.tsx mounts in the root layout and cannot import scripts/. On iamfim.com the
// reader has not installed anything yet, so the ledger door opens the listing (install, then fund inside the sidebar), never a
// Stripe form for a ledger they do not have. publisher.name from packages/thetacog-mcp-vscode/package.json.
// The constants themselves live in src/lib/marketplace.mjs (no node: imports, so the client iamfim page can use them too).
export { MARKETPLACE_ID, MARKETPLACE_URL } from '../marketplace.mjs';

// C84g (2026-09-20, operator over the /iamfim form: "email is enough, we can guess the company") — the licence record's
// company is DERIVED from the email, never asked: the part after @, lower-cased; a consumer mail provider reads as 'personal'.
// The `company` metadata key the ledger and the webhook read is unchanged; a company a caller still posts wins over the guess.
const PERSONAL_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'aol.com', 'fastmail.com', 'hey.com', 'gmx.com', 'gmx.de', 'mail.com', 'zoho.com', 'yandex.com', 'qq.com', '163.com']);
export function companyFromEmail(email) {
  const at = String(email || '').trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return '';
  const domain = String(email).trim().toLowerCase().slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return '';
  return PERSONAL_MAIL.has(domain) ? 'personal' : domain;
}

// the one reader of the count: a positive integer in the price object's metadata, else null (a price without it is UNMEASURED)
export function creditsPerUnit(price) {
  const raw = price && price.metadata ? price.metadata.credits_per_unit : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim(); if (!/^\d+$/.test(s)) return null;
  const n = Number(s); return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// the one line the three surfaces print (/notarise, the README boundary, the card): money from unit_amount, the count from
// credits_per_unit — or UNMEASURED. Re-exported by scripts/vna/public-surface-register.mjs; the page imports it from here.
export const COUNT_UNMEASURED = 'UNMEASURED — price not configured';
export function countLine({ price } = {}) {
  const n = creditsPerUnit(price); if (!n) return COUNT_UNMEASURED;
  const amount = Number(price.unit_amount); if (!Number.isFinite(amount) || amount <= 0) return COUNT_UNMEASURED;
  const cur = String(price.currency || 'usd').toLowerCase();
  const major = amount / 100; const shown = Number.isInteger(major) ? String(major) : major.toFixed(2);
  const money = cur === 'usd' ? '$' + shown : `${shown} ${cur.toUpperCase()}`;
  return `${money} · ${n.toLocaleString('en-US')} countersignatures`;
}

// C102f — SUPPORT · LOCAL · LATER, this order, verbatim from the row (docs/specs/vna/SPEC-VNA-COCKPIT.md C102f). The third
// names the reader's counterparties because the operator said to write it on the site — the checkout is the one surface where
// the buyer is already in the room; the README and the listing keep the camouflage rule. Never safe / prove / guarantee, never
// a typed count (the count line is C99c's, beside it).
export const WHY_YOU_PAY = Object.freeze([
  'The measurement is free. This is how you support the extension — and it is the one thing the free tool cannot do for you.',
  'Your key signs each receipt as it is executed, so a later check matches the exact bytes that ran — on your disk, right away, no upload.',
  'The same credits back those receipts up to the third-party ledger when you choose to, which makes them easy to hand to whoever asks — an insurer, a client, an auditor.',
]);

// C103c — the committed receipt of the price: the four fields countLine needs and nothing Stripe-private, dated, declaring
// what it is sufficient for. A dark price makes no receipt (the generator refuses; a misleading empty artifact is never emitted).
export const NOTARY_PRICE_RECEIPT = 'data/vna/notary-price.json';
const RERUN = 'run node scripts/vna/notary-price-receipt.mjs --write with STRIPE_SECRET_KEY + STRIPE_PRICE_NOTARY_SEAT set, and commit the receipt';
export function priceReceipt(price, { at = new Date().toISOString() } = {}) {
  const n = creditsPerUnit(price);
  if (!n) throw new Error('price not configured: no credits_per_unit on the price metadata — no receipt for a dark price');
  const amount = Number(price.unit_amount); if (!Number.isFinite(amount) || amount <= 0) throw new Error('price not configured: unit_amount is not a positive number');
  return {
    at,
    price: { id: String(price.id), unit_amount: amount, currency: String(price.currency || 'usd').toLowerCase(), metadata: { credits_per_unit: String(n) } },
    sufficientFor: 'the money and the count /notarise prints before the button, read from Stripe at `at` and never typed — never the checkout\'s own price, which the route re-reads from Stripe when the button is pressed (C99c)',
  };
}
// the page's reader — SYNCHRONOUS on purpose: a function that returns a value cannot await a network call, so the page paints
// without Stripe. { price, why, at }: the receipt's price when it names the env's price id and carries the count; else dark,
// the why naming what to run. Never throws.
// C159 (operator 2026-09-21: "where is the checkout form for licenses? not on /notarise — it must be super easy to buy the licenses"): the
// live page rendered no form because STRIPE_PRICE_NOTARY_SEAT was never set on Vercel, and every reader refused on the env alone —
// while the committed receipt (data/vna/notary-price.json, read off Stripe, dated) already names the price and its count. ONE resolver:
// the env when set, else the receipt's own id. The env, when present, still has to AGREE with the receipt (a mismatch stays dark).
export function notaryPriceId({ env = process.env, file = join(process.cwd(), NOTARY_PRICE_RECEIPT), read = (f) => readFileSync(f, 'utf8') } = {}) {
  if (env.STRIPE_PRICE_NOTARY_SEAT) return { id: String(env.STRIPE_PRICE_NOTARY_SEAT), source: 'env' };
  try { const j = JSON.parse(read(file)); if (j && j.price && j.price.id) return { id: String(j.price.id), source: 'receipt' }; } catch {}
  return { id: null, source: null };
}
export function notaryPriceFromReceipt({ env = process.env, file = join(process.cwd(), NOTARY_PRICE_RECEIPT), read = (f) => readFileSync(f, 'utf8') } = {}) {
  const priceId = notaryPriceId({ env, file, read }).id;
  if (!priceId) return { price: null, why: `price not configured: STRIPE_PRICE_NOTARY_SEAT is not set and ${NOTARY_PRICE_RECEIPT} names no price — ${RERUN}`, at: null };
  let raw;
  try { raw = read(file); } catch (e) { return { price: null, why: `price not read: no receipt at ${NOTARY_PRICE_RECEIPT} (${e && e.code ? e.code : 'unreadable'}) — ${RERUN}`, at: null }; }
  let j;
  try { j = JSON.parse(raw); } catch { return { price: null, why: `price not readable: ${NOTARY_PRICE_RECEIPT} is malformed — ${RERUN}`, at: null }; }
  const price = j && j.price && typeof j.price === 'object' ? j.price : null;
  if (!price) return { price: null, why: `price not readable: ${NOTARY_PRICE_RECEIPT} carries no price — ${RERUN}`, at: j && j.at ? j.at : null };
  if (String(price.id) !== String(priceId)) return { price: null, why: `price not configured: the receipt is for ${price.id} and STRIPE_PRICE_NOTARY_SEAT is ${priceId} — ${RERUN}`, at: j.at || null };
  if (!creditsPerUnit(price)) return { price: null, why: `price not configured: no credits_per_unit on the receipt's price metadata — ${RERUN}`, at: j.at || null };
  return { price, why: null, at: j.at || null };
}

// the price, read through the injected Stripe client — { price, why }; never throws (a dark read is a reading, not a crash)
export async function readNotaryPrice({ stripe, priceId }) {
  if (!priceId) return { price: null, why: 'price not configured: STRIPE_PRICE_NOTARY_SEAT is not set' };
  if (!stripe || !stripe.prices || typeof stripe.prices.retrieve !== 'function') return { price: null, why: 'price not readable: no Stripe client' };
  try {
    const price = await stripe.prices.retrieve(priceId);
    return { price, why: creditsPerUnit(price) ? null : 'price not configured: no credits_per_unit on the price metadata' };
  } catch (e) { return { price: null, why: `price not readable: ${e && e.message ? e.message : String(e)}` }; }
}

// the environment wiring for the server components (/notarise, /licences): both env names set → a real read; else dark
export async function notaryPriceFromEnv({ env = process.env } = {}) {
  const priceId = notaryPriceId({ env }).id; const key = env.STRIPE_SECRET_KEY;   // C159: the receipt's id when the env is unset
  if (!priceId) return { price: null, why: 'price not configured: STRIPE_PRICE_NOTARY_SEAT is not set and the receipt names no price' };
  if (!key) return { price: null, why: 'price not readable: STRIPE_SECRET_KEY is not set' };
  const { default: Stripe } = await import('stripe');
  return readNotaryPrice({ stripe: new Stripe(key), priceId });
}

export function notarySeatSession({ account_id, pubkey_fingerprint, device_code, user_code = '', units = 1, priceObject, price, appUrl, tape_height = /** @type {string | number | null} */ (null), returnTo = 'licences', claim = /** @type {'email' | null} */ (null), company = '', mail_keys = true }) {   // C157: mail_keys — the buyer's pre-checked box; false → the webhook sends no email and the paid page shows the key
  if (!price) throw new Error('STRIPE_PRICE_NOTARY_SEAT is not set — no price, no session');
  if (!account_id) throw new Error('account_id is required');
  const fp = String(pubkey_fingerprint || '');
  const unbound = fp === '';
  if (unbound && claim !== 'email') throw new Error('pubkey_fingerprint must be the 16-hex fingerprint of the device key — or the session must say claim: email (a website buyer with no device waiting; the webhook records the credits unclaimed under the account)');
  if (!unbound && !/^[0-9a-f]{16}$/.test(fp)) throw new Error('pubkey_fingerprint must be the 16-hex fingerprint of the device key');
  const cpu = creditsPerUnit(priceObject);
  if (!cpu) throw new Error('price not configured: no credits_per_unit on the price metadata — the count is read off the price, never typed');
  if (priceObject.id && priceObject.id !== price) throw new Error(`price object ${priceObject.id} is not ${price}`);
  const n = Number(units);
  if (!Number.isInteger(n) || n < 1 || n > MAX_UNITS) throw new Error(`units must be an integer between 1 and ${MAX_UNITS} (licences per checkout)`);
  const base = String(appUrl || 'https://thetadriven.com').replace(/\/+$/, '');
  const uc = String(user_code || '').replace(/[^A-Z0-9]/g, '');
  const h = Number.isFinite(Number(tape_height)) && tape_height !== null && tape_height !== '' ? String(Math.max(0, Math.floor(Number(tape_height)))) : null;
  const back = returnTo === 'notarise' ? `${base}/notarise?fp=${fp}&h=${h || 0}` : returnTo === 'iamfim' ? `${base}/iamfim` : `${base}/licences?user_code=${uc}`;
  // C102a chain walk 2026-09-20 — ONE WAY TO PAY: the mode follows the price object's type. The licence price the site already
  // sells on /iamfim#checkout and /pricing ($20 per agent-year) is RECURRING, and Stripe refuses a recurring price in payment
  // mode — so STRIPE_PRICE_NOTARY_SEAT may name that one price (once credits_per_unit is on its metadata) and one price sits
  // behind both doors. A one_time price stays a payment. The metadata and the webhook (C84c) are the same either way.
  const mode = priceObject.type === 'recurring' || (priceObject.recurring && typeof priceObject.recurring === 'object') ? 'subscription' : 'payment';
  return {
    mode,
    payment_method_types: ['card'],
    line_items: [{ price, quantity: n }],
    customer_email: account_id,
    metadata: { tier: 'notary_seat', product_type: 'notary_seat', account_id, pubkey_fingerprint: fp, device_code: String(device_code || ''), units: String(n), credits_per_unit: String(cpu), credits: String(n * cpu), price_id: price, mail_keys: mail_keys ? '1' : '0', ...(h !== null ? { tape_height: h } : {}), ...(unbound ? { claim: 'email' } : {}), ...(company ? { company: String(company).slice(0, 200) } : {}) },
    // the website door returns to its own success page (agents = units, for the copy there); the other two carry the user code / the tape's address
    success_url: returnTo === 'iamfim' ? `${back}/license/success?session_id={CHECKOUT_SESSION_ID}&agents=${n}` : `${back}&paid=1&mail=${mail_keys ? 1 : 0}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnTo === 'iamfim' ? `${back}?canceled=true` : `${back}&cancelled=1`,
  };
}

// C84f — THE ONE STRIPE CALL for a licence: the client, the price read and the session create, wired once from the
// environment and imported by both routes (/api/create-checkout-session/notary-seat and /api/iamfim/license-checkout).
// Never called by a page (C103c: pages read the committed receipt); never called by a guard (guards inject `create`).
export async function stripeCheckout({ env = process.env } = {}) {
  const client = async () => {
    const { default: Stripe } = await import('stripe');
    const key = env.STRIPE_SECRET_KEY; if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    return new Stripe(key);   // the library's pinned API version — a typed literal here drifts every stripe upgrade
  };
  return {
    retrievePrice: async (priceId) => {
      try { return await readNotaryPrice({ stripe: await client(), priceId }); }
      catch (e) { return { price: null, why: `price not readable: ${e && e.message ? e.message : String(e)}` }; }
    },
    create: async (params) => {
      const stripe = await client();
      const s = await stripe.checkout.sessions.create(params);
      return { id: s.id, url: s.url };
    },
  };
}
