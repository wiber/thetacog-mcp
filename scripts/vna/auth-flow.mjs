#!/usr/bin/env node
// scripts/vna/auth-flow.mjs — C75 DEVICE AUTHORIZATION AND LICENCE ACTIVATION (goal 4 unit 3, 2026-09-18).
// The client half of an OAuth 2.0 DEVICE FLOW (RFC 8628) between the extension and the site. The device key IS the room
// identity the flight tape already signs with (mesh-keys roomIdentity → sig_pubkey on every row) — never a second keypair;
// the fingerprint is C44's fingerprintOf(pubkey), the same 16 hex the notary indexes accounts by.
//   1. POST <base>/device   { pubkey, pubkey_fingerprint, client }        → device_code · user_code · verification_uri_complete
//   2. open the browser at verification_uri_complete — LOGIN, PAYMENT AND THE LICENCE HAPPEN ON THE SITE, never here
//   3. POST <base>/token    { grant_type: device_code, device_code }      → authorization_pending · slow_down · access_denied ·
//                                                                          expired_token · { entitlement: <JWT> }
//   4. GET  <base>/keys     → the site's EdDSA public key, from the SAME ORIGIN the device code came from (TLS is the root)
//   5. verify the JWT (EdDSA · exp · pubkey_fingerprint is THIS device's) → { account_id, pubkey_fingerprint, credits, exp }
// This module has NO fs import: the network and stdout are its only doors. Where the entitlement is kept is the host's
// decision (auth-manager.ts → context.secrets); the CLI prints it once, to stdout, for the host that spawned it.
//   node scripts/vna/auth-flow.mjs whoami [--room R] [--json]
//   node scripts/vna/auth-flow.mjs connect [--base URL] [--room R] [--no-open] [--json]   (prints the URL, then the entitlement)
//   node scripts/vna/auth-flow.mjs notarise [--h N] [--base URL] [--room R] [--no-open] [--json]   (C102a: the 💳 — /notarise?fp&h&code, then the entitlement)
//   node scripts/vna/auth-flow.mjs label  --claims '<json>'                                 (the RUN row's one rule)
// C83b — THE RETURN DOOR: a licence can also come back by URI (`vscode://…/auth?entitlement=<jwt>`) or by hand (pasted
// into an input box), never through the device-flow poll above. Both paths verify with the SAME site key this module
// fetches for `connect`, over stdin only — the token never rides argv:
//   node scripts/vna/auth-flow.mjs verify --jwt -|TOKEN [--base URL] [--server-pubkey HEX (test-only)] [--json]
// C90 — SIGNED UNDER LICENCE, LOCALLY, BEFORE ANY NOTARY. The two doors the MCP server's `thetacog-sign` and
// `thetacog-verify-licence` open. The licence's PUBLIC claims ride VNA_ENTITLEMENT_CLAIMS (never the bearer — this module
// never reads NOTARY_BEARER) and are stamped INSIDE the signed row at proofs.licence by flight-tape.mjs; the four verdicts
// here are all local node crypto: signature · fingerprint · claims · exp. Bytes and rows ride stdin, never argv.
//   node scripts/vna/auth-flow.mjs sign --sha <sha|authored> | --bytes - [--room R] [--json]
//   node scripts/vna/auth-flow.mjs verify-licence --row - [--json]
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { signerFor } from '../mesh/mesh-keys.mjs';   // C156: the ONE key resolver the tape signs with (C97e) — a room's key, else the local host key; never a refusal
import { roomFromTerminal, ROOM_KEYS } from '../../src/lib/pmu/room-key.mjs';
import { machineStore, resolveDeviceKey, resolveEntitlement, storeEntitlement, clearEntitlement, seedOf, snapshotClaims } from './machine-store.mjs';   // C173d: the device is the machine — one keychain item, never the IDE's room
import { fingerprintOf } from '../../src/lib/notary/gateway.mjs';
import { lastRow, canonical, deviceFingerprint, licenceOf, licenceClaimsFromEnv, signCommit, signBytes, carOf, LICENCE_STAMP_KEYS, REPO as TAPE_REPO } from './flight-tape.mjs';
import { resolveCommitArg } from './authored-commit.mjs';   // C309b: `--sha authored` = the last commit that is not the hook's chore(commit-page)
import { NOTARISE_HREF } from './public-surface-register.mjs';   // C102a: the 💳 opens /notarise — the ONE href, written once (C97f)

export const EXIT = { OK: 0, USAGE: 1, TRANSPORT: 2, DENIED: 3, EXPIRED: 4, UNVERIFIED: 5 };
export const DEFAULT_BASE = process.env.VNA_AUTH_BASE || 'https://thetadriven.com/api/auth';
export const CLIENT = 'thetacog-mcp-vscode';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');   // raw 32-byte ed25519 → SPKI DER (RFC 8410)
const b64u = (b) => Buffer.from(b).toString('base64url');
const fail = (code, exit, msg) => Object.assign(new Error(msg || code), { code, exit });

// the room whose key signs: the terminal's room, else the room of the last signed tape row — the identity already in use
export function whichRoom(room) {
  if (room) return room;
  const t = roomFromTerminal(); if (t) return t;
  const last = lastRow(); return last && last.room || null;
}

// C156 (operator 2026-09-21, the 💳 toast on a fresh window: "Steer notarise: auth-flow: no_room — no room — no identity to regi…"; "lets fix the fund
// action"): the identity the licence binds to is THE KEY THE TAPE SIGNS WITH — signerFor(room), the room's derived key when a room is
// known, else the LOCAL host key (C97e: no row is unsigned, so no window is without an identity). A stranger's first click, with no
// THETACOG_ROOM and no tape row, registers the host key; the same key signs the rows the licence will stamp. The refusal is gone.
//
// C173d (operator 2026-09-22: "still flickering - and it should not be there .. these are two bought"): THE DEVICE IS THE MACHINE,
// NOT THE APP. Resolving the key from the room made VS Code (architect → 19d66dc55db220b8, the key the licence is signed to) and
// Cursor (laboratory → a29564ae013d1f27) two devices on one Mac. The device key now lives in ONE per-machine store
// (machine-store.mjs: the keychain item service=thetacog, a declared 0600 file off darwin); the room only decides which key is
// MIGRATED on the first call when the store is empty — the key the held licence is bound to, else the key this room presented
// before — copied byte-for-byte so a paid binding survives. The tape's per-room row signatures are unchanged.
// store / claims: injected by the guard (a fake keychain, a fixture licence); callers pass neither.
export async function deviceIdentity({ room, resolve = whichRoom, store, claims } = {}) {   // resolve: the room resolver (injected by the guard to walk the no-room path on a host that always has one)
  const r = resolve(room);
  let key; try { key = resolveDeviceKey({ store: store || machineStore(), legacy: () => legacyDeviceSeed({ room: r, claims, store }) }); }
  catch (e) { throw fail('no_key', EXIT.USAGE, `no device key could be loaded or stored (${String(e.message || e).slice(0, 80)}) — check the keychain item service=thetacog (or ~/.thetacog/machine off macOS) and the host key under ~/.thetacog/pmu/keys`); }
  return { room: r || null, signed_as: 'device', source: key.source, pubkey: key.pubkey_hex, fingerprint: await fingerprintOf(key.pubkey_hex) };
}

// the licence this machine already holds, for the migration only: the env the host set, the C173c snapshot, the machine store
function heldClaims(store) {
  const env = licenceClaimsFromEnv(); if (env) return env;
  const snap = snapshotClaims(); if (snap) return snap;
  try { return resolveEntitlement({ store: store || machineStore(), log: () => {} }).claims; } catch { return null; }
}
// THE KEY THIS MACHINE PRESENTED BEFORE C173d: the one (host or a room's derived key) whose fingerprint the held licence names —
// so the paid binding survives whichever IDE opens first — else the key this room would have registered.
export function legacyDeviceSeed({ room = null, claims, store } = {}) {
  const fp = (claims || heldClaims(store))?.pubkey_fingerprint;
  if (fp) for (const cand of [null, ...ROOM_KEYS]) { const id = signerFor(cand); if (id.fingerprint === fp) return seedOf(id.privateKey); }
  return seedOf(signerFor(room).privateKey);
}

async function post(fetch, url, body) {
  let res; try { res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { throw fail('transport', EXIT.TRANSPORT, `POST ${url}: ${e.message}`); }
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

export async function requestDeviceCode({ base = DEFAULT_BASE, pubkey, fingerprint, fetch = globalThis.fetch }) {
  const { status, json } = await post(fetch, `${base}/device`, { pubkey, pubkey_fingerprint: fingerprint, client: CLIENT });
  // C113h — the site's own why leads the message (the toast shows ~60 chars: `no site signing key (AUTH_ED25519_SEED…)` is
  // actionable, `device-code request answered 503: {"error"…` is not); the status and the raw body follow for the log
  if (status !== 200 || !json || !json.device_code || !json.user_code) throw fail('device_code_refused', EXIT.TRANSPORT, `${json && json.why ? `the site refused: ${json.why} · ` : ''}device-code request answered ${status}: ${JSON.stringify(json)}`);
  return json;
}

// RFC 8628 §3.5: poll at `interval`; slow_down adds 5 s; pending keeps going until the code expires
export async function pollToken({ base = DEFAULT_BASE, device_code, interval = 5, expires_in = 600, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  const deadline = now() + expires_in * 1000; let wait = Math.max(0, Number(interval) || 0) * 1000;
  for (;;) {
    if (now() > deadline) throw fail('expired_token', EXIT.EXPIRED, 'the device code expired before the site approved it — run Connect again');
    const { status, json } = await post(fetch, `${base}/token`, { grant_type: GRANT, device_code });
    if (status === 200 && json && json.entitlement) return json;
    const err = json && json.error || `http_${status}`;
    if (err === 'authorization_pending') { await sleep(wait); continue; }
    if (err === 'slow_down') { wait += 5000; await sleep(wait); continue; }
    if (err === 'access_denied') throw fail('access_denied', EXIT.DENIED, 'the site declined this device');
    if (err === 'expired_token') throw fail('expired_token', EXIT.EXPIRED, 'the device code expired before the site approved it — run Connect again');
    throw fail(err, EXIT.TRANSPORT, `token endpoint answered ${status}: ${JSON.stringify(json)}`);
  }
}

export async function fetchServerKey({ base = DEFAULT_BASE, fetch = globalThis.fetch }) {
  let res; try { res = await fetch(`${base}/keys`); } catch (e) { throw fail('transport', EXIT.TRANSPORT, `GET ${base}/keys: ${e.message}`); }
  const json = res.status === 200 ? await res.json().catch(() => null) : null;
  if (!json || !/^[0-9a-f]{64}$/.test(String(json.pubkey || ''))) throw fail('no_server_key', EXIT.UNVERIFIED, `the site published no EdDSA key at ${base}/keys (${res.status})`);
  return json.pubkey;
}

export function decodeClaims(jwt) {
  try { const [, p] = String(jwt).split('.'); return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
}

// EdDSA JWT over base64url(header).base64url(payload); alg pinned, exp checked — verified is a boolean, never a throw
export function verifyEntitlement(jwt, serverPubkeyHex, { now = () => Date.now() } = {}) {
  const parts = String(jwt).split('.'); if (parts.length !== 3) return { verified: false, why: 'not a JWT', claims: null };
  let header; try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { verified: false, why: 'bad header', claims: null }; }
  if (header.alg !== 'EdDSA') return { verified: false, why: `alg ${header.alg} — only EdDSA`, claims: null };
  const claims = decodeClaims(jwt); if (!claims) return { verified: false, why: 'bad payload', claims: null };
  let ok = false;
  try { ok = edVerify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(serverPubkeyHex, 'hex')]), format: 'der', type: 'spki' }), Buffer.from(parts[2], 'base64url')); } catch { ok = false; }
  if (!ok) return { verified: false, why: 'signature does not verify against the site key', claims };
  if (!(Number(claims.exp) * 1000 > now())) return { verified: false, why: 'expired', claims };
  for (const k of ['account_id', 'pubkey_fingerprint', 'credits', 'exp']) if (claims[k] === undefined) return { verified: false, why: `claim ${k} missing`, claims };
  return { verified: true, why: null, claims };
}

// C90 — THE FOUR VERDICTS, all local, all node crypto (no WebCrypto, no network): (1) signature — the row's ed25519 signature
// verifies over canonical(row) under the pubkey on the row (the device key); (2) fingerprint — that key's fingerprint is the
// stamp's pubkey_fingerprint; (3) claims — the stamp equals the entitlement's public claims (LICENCE_STAMP_KEYS), the
// entitlement being the decoded claims (VNA_ENTITLEMENT_CLAIMS) or a JWT whose payload is decoded here and never echoed;
// (4) exp — the stamp's exp was still in the future at row.ts. A row whose proofs.licence is null or absent is UNLICENSED:
// the signature verdict is still answered, the other three are null (a check that was not run is not a check that failed).
// LICENSED when all four hold, REFUSED when a run check fails. verifyEntitlement above does not change; a row without a stamp still verifies.
export function verifyLicenceStamp({ row, entitlement } = {}) {
  const verdicts = { signature: null, fingerprint: null, claims: null, exp: null };
  if (!row || typeof row !== 'object') return { status: 'UNLICENSED', why: 'no row', verdicts, stamp: null };
  try { verdicts.signature = !!(row.sig && row.sig_pubkey) && edVerify(null, Buffer.from(canonical(row)), createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(row.sig_pubkey, 'hex')]), format: 'der', type: 'spki' }), Buffer.from(row.sig, 'hex')); } catch { verdicts.signature = false; }
  const lic = licenceOf(row);
  if (lic.status !== 'LICENSED') return { status: 'UNLICENSED', why: lic.why, verdicts, stamp: null };
  const stamp = lic.stamp;
  verdicts.fingerprint = !!row.sig_pubkey && deviceFingerprint(row.sig_pubkey) === stamp.pubkey_fingerprint;
  const ent = typeof entitlement === 'string' ? decodeClaims(entitlement) : entitlement && typeof entitlement === 'object' ? entitlement : null;
  verdicts.claims = !!ent && LICENCE_STAMP_KEYS.every((k) => (stamp[k] ?? null) === (ent[k] ?? null));
  const at = Date.parse(row.ts); verdicts.exp = Number.isFinite(at) && Number(stamp.exp) * 1000 > at;
  const failed = Object.keys(verdicts).filter((k) => verdicts[k] !== true);
  return { status: failed.length ? 'REFUSED' : 'LICENSED', why: failed.length ? `failed: ${failed.join(', ')}` : null, verdicts, stamp };
}

// C90 — card 3's line, a pure function of the rows and the entitlement (the dispatcher wires it into steer-ui.mjs). With an
// entitlement: the rows stamped under ITS fingerprint; without: the rows carrying no stamp. "signed under licence", never
// "signed by the licence" — a stamp is a claim the device key signs.
export function licenceStampLine({ rows = [], entitlement = null } = {}) {
  const ent = typeof entitlement === 'string' ? decodeClaims(entitlement) : entitlement;
  const fp = ent && ent.pubkey_fingerprint ? String(ent.pubkey_fingerprint) : null;
  const list = Array.isArray(rows) ? rows : [];
  if (fp) return `signed under licence ${fp.slice(0, 8)} · ${list.filter((r) => licenceOf(r).status === 'LICENSED' && r.proofs.licence.pubkey_fingerprint === fp).length} rows`;
  return `unlicensed rows: ${list.filter((r) => licenceOf(r).status !== 'LICENSED').length}`;
}

// the shape both CLI doors print (and the MCP tools return): the signed row, its CAR, the stamp, the four verdicts, the line
function signedReport(row, { claims }) {
  const v = verifyLicenceStamp({ row, entitlement: claims });
  const car = carOf(row);
  const line = licenceStampLine({ rows: [row], entitlement: claims });
  return { status: v.status, why: v.why, verdicts: v.verdicts, stamp: v.stamp, row, car, line };
}

// C83b — THE RETURN DOOR: a licence comes back by URI (`/auth?entitlement=<jwt>`) or by hand (a pasted string), never
// through the device-flow poll above. Both paths hand this one function a JWT and get back the same shape `connect`
// verifies internally: fetch the site's key from the SAME ORIGIN `connect` fetches it from (never a hand-typed key —
// `serverPubkeyHex` below is a TEST-ONLY escape hatch, exactly like `auth-flow.test.mjs` injects one into
// `verifyEntitlement` directly), then verify. Never stores anything — the host (auth-manager.ts) decides that.
// C161 — a CLAIM TOKEN (typ 'claim', from the purchase email of an unclaimed licence) is not a licence: pasted into the same box, it is
// posted with this device's own key to /claim; the site binds the account's unclaimed rows to this fingerprint, mints the entitlement and
// returns it. The result carries `entitlement` (the key to store) beside the verified claims — the host stores THAT, never the pasted token.
export function isClaimToken(jwt) { const c = decodeClaims(jwt); return !!(c && c.typ === 'claim' && c.account_id); }
export async function claimCommand({ token, base = DEFAULT_BASE, room, fetch = globalThis.fetch, now = () => Date.now(), serverPubkeyHex } = {}) {
  const id = await deviceIdentity({ room });
  const { status, json } = await post(fetch, `${base}/claim`, { claim_token: token, pubkey: id.pubkey, pubkey_fingerprint: id.fingerprint });
  if (status !== 200 || !json) return { verified: false, why: `claim answered ${status}: ${json && json.why ? json.why : JSON.stringify(json)}` };
  if (!json.minted || !json.entitlement) return { verified: false, why: json.why || 'the claim minted nothing' };
  const key = serverPubkeyHex || await fetchServerKey({ base, fetch });
  const v = await verifyEntitlement(json.entitlement, key, { now });
  return v.verified ? { ...v, entitlement: json.entitlement, claimed: true, moved: json.moved } : v;
}
export async function verifyCommand({ jwt, base = DEFAULT_BASE, serverPubkeyHex, fetch = globalThis.fetch, now = () => Date.now(), room } = {}) {
  if (isClaimToken(jwt)) return claimCommand({ token: jwt, base, room, fetch, now, serverPubkeyHex });
  const key = serverPubkeyHex || await fetchServerKey({ base, fetch });
  return verifyEntitlement(jwt, key, { now });
}

// the whole door: identity → device code → browser → poll → key → verify. Returns the JWT (for the host's secret store)
// and its claims (for the RUN row). Throws with .code and .exit; never stores anything.
export async function connect({ base = DEFAULT_BASE, room, open, hrefFor = null, fetch = globalThis.fetch, sleep, now = () => Date.now() } = {}) {
  const id = await deviceIdentity({ room });
  const dc = await requestDeviceCode({ base, pubkey: id.pubkey, fingerprint: id.fingerprint, fetch });
  // hrefFor (C102a): the page the browser opens while the IDE polls — /device by default, /notarise for the 💳 (notarise below)
  const url = hrefFor ? hrefFor(dc, id) : (dc.verification_uri_complete || `${dc.verification_uri}?user_code=${encodeURIComponent(dc.user_code)}`);
  if (open) await open(url, dc);
  const tok = await pollToken({ base, device_code: dc.device_code, interval: dc.interval, expires_in: dc.expires_in, fetch, sleep, now });
  const serverKey = await fetchServerKey({ base, fetch });
  const v = verifyEntitlement(tok.entitlement, serverKey, { now });
  if (!v.verified) throw fail('entitlement_unverified', EXIT.UNVERIFIED, `the entitlement does not verify: ${v.why}`);
  if (v.claims.pubkey_fingerprint !== id.fingerprint) throw fail('fingerprint_mismatch', EXIT.UNVERIFIED, `the entitlement names ${v.claims.pubkey_fingerprint}, this device is ${id.fingerprint}`);
  return { entitlement: tok.entitlement, claims: v.claims, verified: true, identity: id, url };
}

// C102a THE KEYS LAND IN THE EXTENSION, NEVER PASTED (operator 2026-09-20: "when you hit notarise this tape you have to be able
// to buy keys and the keys need to go straight into your repo through the extension to your account"). The 💳 is THIS door:
// the same device flow as connect — the extension holds the device_code and polls /token — but the browser opens
// /notarise?fp=<fp>&h=<h>&code=<user_code> (C97f's page, which sells the stamp for THIS tape and whose checkout binds the
// waiting device row by fingerprint, store.byFingerprint), so the entitlement the webhook mints (C84c) arrives by the poll
// with no user action after paying. The host stores what this returns in SecretStorage; nothing is pasted anywhere.
export function notariseHref(fp, h, user_code) {
  const uc = String(user_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${NOTARISE_HREF(fp, h)}${uc ? `&code=${uc}` : ''}`;
}
// the tape's height for the href: the last row's seq (flight-tape.mjs), 0 when there is no tape yet
export function tapeHeight(path) { const last = path ? lastRow(path) : lastRow(); const n = last && Number(last.seq); return Number.isFinite(n) && n >= 0 ? n : 0; }
export async function notarise({ base = DEFAULT_BASE, room, height, open, fetch = globalThis.fetch, sleep, now = () => Date.now() } = {}) {
  const h = height == null ? tapeHeight() : height;
  return connect({ base, room, open, fetch, sleep, now, hrefFor: (dc, id) => notariseHref(id.fingerprint, h, dc.user_code) });
}

// THE RUN ROW's one rule — steer-ui.mjs paints exactly this string. C82b: FUNDED / UNFUNDED is read from the decoded claims
// (credits > 0) and from nothing else — never from the wire, which may not have answered; not connected says neither.
export function runRowLabel(claims, fingerprint = null) {
  if (claims && claims.pubkey_fingerprint !== undefined && claims.credits !== undefined) return `🔑 ${claims.pubkey_fingerprint} · ${claims.credits} credits · ${Number(claims.credits) > 0 ? 'FUNDED' : 'UNFUNDED'}`;
  return `🔑 ${fingerprint || '—'} · not connected`;
}

// stdin only — used by `verify --jwt -` so the token NEVER rides argv (visible to every process on the host, and to
// `ps`/shell history); the CLI's one caller (auth-manager.ts's ingestEntitlement) always passes `-` and writes the
// token to this child's stdin.
async function readStdin() {
  const chunks = []; for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const a = process.argv.slice(2); const flag = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const asJson = a.includes('--json'); const cmd = a[0];
  const say = (o) => process.stdout.write(asJson ? JSON.stringify(o) + '\n' : `${o.line}\n`);
  const keep = (jwt) => { try { storeEntitlement(jwt); } catch (e) { process.stderr.write(`auth-flow: the machine store refused the entitlement (${e.message}) — the host keeps its own copy\n`); } };   // C173d
  try {
    if (cmd === 'entitlement') {
      // C173d — THE ONE LICENCE FOR THIS MACHINE, the door every IDE host spawns on load: `--legacy -` hands this app's
      // SecretStorage copy on stdin (the read-only migration source); the machine store wins. `--clear` removes it (disconnect).
      if (a.includes('--clear')) { clearEntitlement(); say({ cleared: true, line: 'entitlement removed from the machine store' }); process.exit(EXIT.OK); }
      const legacyJwt = flag('--legacy') === '-' ? await readStdin() : null;
      const r = resolveEntitlement({ legacyJwt });
      say({ ...r, line: r.claims ? runRowLabel(r.claims) : runRowLabel(null) }); process.exit(EXIT.OK);
    }
    if (cmd === 'whoami') { const id = await deviceIdentity({ room: flag('--room') }); say({ ...id, line: `${id.room} · 🔑 ${id.fingerprint} · ${id.pubkey}` }); process.exit(EXIT.OK); }
    if (cmd === 'label') { const claims = JSON.parse(flag('--claims') || 'null'); say({ label: runRowLabel(claims, flag('--fingerprint')), line: runRowLabel(claims, flag('--fingerprint')) }); process.exit(EXIT.OK); }
    if (cmd === 'connect') {
      const base = flag('--base') || DEFAULT_BASE; const noOpen = a.includes('--no-open');
      const r = await connect({ base, room: flag('--room'), open: async (url) => { process.stdout.write((asJson ? JSON.stringify({ open: url }) : `open ${url}`) + '\n'); if (!noOpen) { const { spawn } = await import('node:child_process'); spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); } } });
      keep(r.entitlement);
      say({ entitlement: r.entitlement, claims: r.claims, identity: r.identity, line: runRowLabel(r.claims) }); process.exit(EXIT.OK);
    }
    if (cmd === 'notarise' || cmd === 'notarize') {
      // C102a — the 💳: the same two lines connect prints ({ open } first, the entitlement last); --h overrides the tape's height
      const base = flag('--base') || DEFAULT_BASE; const noOpen = a.includes('--no-open'); const hFlag = flag('--h');
      const r = await notarise({ base, room: flag('--room'), height: hFlag == null ? undefined : Number(hFlag), open: async (url) => { process.stdout.write((asJson ? JSON.stringify({ open: url }) : `open ${url}`) + '\n'); if (!noOpen) { const { spawn } = await import('node:child_process'); spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); } } });
      keep(r.entitlement);
      say({ entitlement: r.entitlement, claims: r.claims, identity: r.identity, line: runRowLabel(r.claims) }); process.exit(EXIT.OK);
    }
    if (cmd === 'verify') {
      // C83b — the return door. `--jwt -` reads the token from stdin (the only sanctioned form for a real caller);
      // `--jwt <literal>` is left in for scripting convenience but the token then rides this process's OWN argv, so
      // the host (auth-manager.ts) must never call it that way. `--server-pubkey <hex>` is TEST-ONLY (documented in
      // verifyCommand above) — it skips the network fetch of the site's key.
      const base = flag('--base') || DEFAULT_BASE;
      const jwtFlag = flag('--jwt'); if (jwtFlag === null) { process.stderr.write('auth-flow verify: --jwt - (stdin) or --jwt <token> required\n'); process.exit(EXIT.USAGE); }
      const jwt = jwtFlag === '-' ? await readStdin() : jwtFlag;
      const v = await verifyCommand({ jwt, base, serverPubkeyHex: flag('--server-pubkey') || undefined });
      if (v.verified) { keep(v.entitlement || jwt); say({ verified: true, claims: v.claims, entitlement: v.entitlement || undefined, claimed: !!v.claimed, line: `🔑 ${v.claims.pubkey_fingerprint} · ${v.claims.credits} credits — ${v.claimed ? 'claimed to this device' : 'verified'}` }); process.exit(EXIT.OK); }
      say({ verified: false, reason: v.why, line: `refused — ${v.why}` }); process.exit(EXIT.UNVERIFIED);
    }
    if (cmd === 'sign') {
      // C90 — one row, signed with the device key, stamped with the licence's public claims from VNA_ENTITLEMENT_CLAIMS (never
      // the bearer). `--sha` tapes a commit; `--bytes -` tapes stdin content-addressed. A foreign fingerprint throws before append.
      const claims = licenceClaimsFromEnv(); const room = whichRoom(flag('--room'));
      const sha = flag('--sha') ? resolveCommitArg(flag('--sha'), TAPE_REPO) : flag('--sha'); const bytesFlag = flag('--bytes');
      if (!sha && bytesFlag === null) { process.stderr.write('auth-flow sign: --sha <sha> or --bytes - (stdin) required\n'); process.exit(EXIT.USAGE); }
      const row = sha ? signCommit({ sha, room, claims }) : signBytes({ bytes: bytesFlag === '-' ? await readStdin() : bytesFlag, room, claims });
      const r = signedReport(row, { claims });
      if (!claims) r.why = 'no VNA_ENTITLEMENT_CLAIMS in the environment — signed UNLICENSED (the row is signed by the device key; it carries no licence stamp)';
      say({ ...r, line: r.line }); process.exit(EXIT.OK);
    }
    if (cmd === 'verify-licence') {
      // C90 — a row on stdin (`--row -`), the four verdicts out; UNLICENSED when the stamp is null or the row predates the field
      const rowFlag = flag('--row'); if (rowFlag === null) { process.stderr.write('auth-flow verify-licence: --row - (stdin) required\n'); process.exit(EXIT.USAGE); }
      let row; try { row = JSON.parse(rowFlag === '-' ? await readStdin() : rowFlag); } catch { process.stderr.write('auth-flow verify-licence: the row is not JSON\n'); process.exit(EXIT.USAGE); }
      const claims = licenceClaimsFromEnv(); const v = verifyLicenceStamp({ row, entitlement: claims });
      say({ ...v, line: v.status === 'LICENSED' ? licenceStampLine({ rows: [row], entitlement: claims }) : `${v.status.toLowerCase()}${v.why ? ' — ' + v.why : ''}` }); process.exit(v.status === 'REFUSED' ? EXIT.UNVERIFIED : EXIT.OK);
    }
    process.stdout.write('node scripts/vna/auth-flow.mjs whoami|connect|notarise|verify|label|sign|verify-licence [--base URL] [--room R] [--jwt -|TOKEN] [--server-pubkey HEX] [--claims JSON] [--no-open] [--json]\n'); process.exit(EXIT.USAGE);
  } catch (e) { process.stderr.write(`auth-flow: ${e.code || 'error'} — ${e.message}\n`); process.exit(e.exit || EXIT.TRANSPORT); }
}
