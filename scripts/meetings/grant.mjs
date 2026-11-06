#!/usr/bin/env node
// scripts/meetings/grant.mjs — the /grant door: after a meeting, (1) mint licence credits to an account,
// (2) enroll every meeting attendee in the book club. The run-it-yourself email is composed per person
// through the comms door (.claude/skills/grant/SKILL.md), never from here.
//
//   node scripts/meetings/grant.mjs status
//   node scripts/meetings/grant.mjs mint --account redacted@example.com --usd 10000 [--live]
//   node scripts/meetings/grant.mjs mint --street --account redacted@example.com [--live]   (C485: ONE licence for a reply to the street email — one per address, capped in all)
//   node scripts/meetings/grant.mjs link --who "<name>" [--usd 100] [--token <t>] [--live]   (a claim link: binds to whatever email signs in)
//   node scripts/meetings/grant.mjs move --from redacted@example.com --to redacted@example.com [--ref <grant ref>] [--live]
//   node scripts/meetings/grant.mjs revoke --account redacted@example.com [--ref <grant ref>] [--live]
//   node scripts/meetings/grant.mjs note --to redacted@example.com --subject "<thread subject>" --note "…" [--live]   (send in-thread)
//   node scripts/meetings/grant.mjs sent --to redacted@example.com --id <gmail message id> --what "…"   (backfill a connector send)
//   node scripts/meetings/grant.mjs enroll [--live]
//
// MINT writes ONE 'unclaimed' row to credits_ledger (the only kind an email-held, deviceless balance can
// take). It binds to a key when that email signs in on /device, the same path a website purchase takes.
// The ref is grant:… and stripe_session is null, so a comp is never mistaken for a sale. The ref is the
// idempotency key: re-running the same grant appends nothing. Dry-run unless --live.
//
// ENROLL reads data/pitch-meetings.ndjson (hand-kept, one row per held meeting) and runs
// scripts/bookclub/enroll-one.mjs for every attendee with an address. A row with no address is
// REPORTED, never skipped silently. The address is an operator fact (calendar invite) and has to be added.
//
// Guard: tests/meetings/grant.test.mjs · tests/meetings/grant-claim-link.test.mjs (link)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keepToken } from '../comms/claim-link-store.mjs';
import { moveRows, newToken, isToken, tokenHash, linkId, placeholderFor, linkUrl, linkAlreadyMinted } from '../../src/lib/notary/grant-link.mjs';

// C2305 (npx thetacog-mcp grant): the CODE is where this file sits (the monorepo, or the bundled package); the RECORD is the caller's
// repo. server.js runs every door with cwd = the caller's folder and VNA_REPO = that folder, so the action ledger, the meetings file,
// .env.local and the per-action commit land in the operator's checkout, never inside an npx cache. Unset (node scripts/meetings/grant.mjs
// at home) the two are the same directory, exactly as before.
const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = process.env.VNA_REPO ? path.resolve(process.env.VNA_REPO) : CODE;
export const MEETINGS = path.join(REPO, 'data', 'pitch-meetings.ndjson');
// EVERY ACTION GETS ITS OWN RECEIPT (operator 2026-09-23, after two Gmail replies and a move shared one commit and the
// replies left no send row at all): one append-only row per act — mint, move, revoke, or a message sent outside the
// Resend door (the Gmail connector) — and ONE COMMIT PER ROW, so each act gets its own commit and its own panel.
export const ACTIONS = path.join(REPO, 'data', 'meetings', 'grant-actions.ndjson');
export function recordAction(act, file = ACTIONS, { commit = null } = {}) {
  if (!act || !act.action || !act.who) throw new Error('an action receipt needs action + who');
  const row = { at: new Date().toISOString(), ...act };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  if (commit) row.commit = commit(row, file);   // ONE action → ONE commit, made here, never left for a later sweep
  return row;
}

export function commitMessage(row) {
  const what = row.what || (row.action === 'move' ? `${row.from} → ${row.to}` : row.ref || (row.grants || []).join(', ') || '');
  return `chore(grant): ${row.action} · ${row.who}${what ? ` — ${what}` : ''}`.slice(0, 180);
}

// commit ONLY the action ledger (git commit --only semantics: other rooms' staged work is untouched), hooks ON, so the
// post-commit hook renders this action's own panel. Never --no-verify (CLAUDE.md). Returns the short sha.
export function gitCommitAction(row, file) {
  const rel = path.relative(REPO, file);
  const body = `${commitMessage(row)}\n\nOriginating-Terminal: ☕ Network\nRelevant-Rooms: network, operator, laboratory\nStory: /grant writes one receipt per action and commits it alone, so every act (mint, move, revoke, note) gets its own commit and its own panel.\n`;
  execFileSync('git', ['add', '--', rel], { cwd: REPO });
  execFileSync('git', ['commit', '-q', '-m', body, '--', rel], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
}
const LIVE = { commit: gitCommitAction };
// append rows to the ledger AND write the one action receipt for them — the only live write path mint/move/revoke use
export async function applyLive(ledger, rows, act, file = ACTIONS, opts = {}) {
  const results = [];
  for (const r of rows) results.push({ ref: r.ref, delta: r.delta, account_id: r.account_id, appended: (await ledger.append(r)).appended });
  const receipt = recordAction({ ...act, rows: results, appended: results.filter((x) => x.appended).length }, file, opts);
  return { results, receipt };
}
export const USD_PER_LICENCE = 20;
export const CREDITS_PER_LICENCE = 10000;
// The default grant is $100 = 5 licences = 50,000 signed receipts (operator 2026-09-27: "make it 100 usd and make the
// skill default to it"). Applies to link and mint when --usd is omitted; an explicit --usd still wins.
export const DEFAULT_USD = 100;

// $20 = one licence = 10,000 credits (the price's credits_per_unit). Refuse anything that is not whole licences.
export function creditsForUsd(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0 || n % USD_PER_LICENCE !== 0) throw new Error(`--usd must be a positive multiple of ${USD_PER_LICENCE} (got ${usd})`);
  return { licences: n / USD_PER_LICENCE, credits: (n / USD_PER_LICENCE) * CREDITS_PER_LICENCE };
}

export function grantRow({ account, usd, date = new Date().toISOString().slice(0, 10) }) {
  const acct = String(account || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(acct)) throw new Error(`--account must be an email (got ${account})`);
  const { licences, credits } = creditsForUsd(usd);
  return { account_id: acct, pubkey_fingerprint: null, delta: credits, kind: 'unclaimed', stripe_session: null,
    ref: `grant:operator:${date}:usd${usd}:${licences}x${CREDITS_PER_LICENCE}:${acct}` };
}

// MOVE an UNCLAIMED grant to another address — moveRows lives in src/lib/notary/grant-link.mjs (the /claim route is its
// second caller) and is re-exported here unchanged. A grant already claimed (bound to a device) is NOT moved — that is
// ledger.revoke(), which needs the device's key.
export { moveRows };

// LINK — a comp for someone we know only by NAME (a WhatsApp group hides numbers and addresses). The grant is minted under a
// placeholder account derived from sha256(token) (src/lib/notary/grant-link.mjs), so the committed receipt carries the hash,
// never the token; the token is printed ONCE, inside the URL. /claim/<token> moves it to whatever email signs in (single-use).
// A link that already carries a grant is a no-op on re-run (the ref carries the date, so the ref alone would not stop a
// second mint on another day). Pure over the ledger — main() hands the row to applyLive.
// The URL is printed BEFORE the grant is written and committed. 2026-09-27: two of fifteen live mints hit another
// room's index.lock — the prod row landed, the commit threw, and the token (shown only after the commit) was lost with
// it, stranding an unclaimable grant that had to be revoked. A failure after the print leaves a link that still works
// and a line saying the receipt did not land. Guard: tests/meetings/grant-claim-link.test.mjs (runLink).
export async function runLink(plan, { who, usd, apply, log = console.log }) {
  keepToken({ who, usd, token: plan.token, link_id: plan.act.link_id });
  log(`\n  ${plan.url}\n\n  ↑ the token is kept in .thetacog/claim-links.local.ndjson (gitignored, 0600) — the committed receipt keeps its sha256 only.`);
  log(`  placeholder ${plan.account}\n  revoke: node scripts/meetings/grant.mjs revoke --account ${plan.account} --live   (after a claim: --account <their email>)`);
  try {
    const { results, receipt } = await apply();
    log(`LINK · ${who} · ${plan.row.delta.toLocaleString()} credits ($${usd}) · ${results[0].appended ? 'appended' : 'already on record'} · receipt ${receipt.commit}`);
    return { ok: true };
  } catch (e) {
    log(`LINK · ${who} · RECEIPT NOT COMMITTED (${String(e.message || e).split('\n').pop()}) — the URL above is still the only copy of the token; check the ledger for ${plan.account} before re-minting`);
    return { ok: false, error: e };
  }
}

export async function linkPlan(ledger, { who, usd, token = newToken(), date } = {}) {
  const name = String(who || '').trim();
  if (!name) throw new Error('--who "<name>" is required (the only handle we have on them)');
  if (!isToken(token)) throw new Error('--token must be 20–64 url-safe characters');
  const account = placeholderFor(token);
  const row = grantRow({ account, usd, ...(date ? { date } : {}) });
  const already = await linkAlreadyMinted(ledger, token);
  return { token, url: linkUrl(token), account, row: already ? null : row, already,
    act: { action: 'link', who: name, link_id: linkId(token), token_hash: tokenHash(token), account, usd: Number(usd), credits: row.delta, ref: row.ref, what: `claim link for ${name}` } };
}

// find the one unclaimed grant on an account to move; refuse on zero or on more than one (name it with --ref)
export async function pickGrant(ledger, account, ref = null) {
  const open = (await ledger.unclaimedOf(String(account).trim().toLowerCase())).filter((r) => String(r.ref).startsWith('grant:') && (!ref || r.ref === ref));
  if (open.length === 0) throw new Error(`no unclaimed grant on ${account}${ref ? ` with ref ${ref}` : ''} (already claimed or moved?)`);
  if (open.length > 1) throw new Error(`${open.length} unclaimed grants on ${account} — name one with --ref:\n  ${open.map((r) => r.ref).join('\n  ')}`);
  return open[0];
}

// REVOKE — the operator takes a grant back. Only grant: (or moved move:grant:) refs are ever touched; a purchase never is.
//   • still UNCLAIMED on the account → 'claim' −N, ref claim:<g>:out (the pool's own consumed-marker: the address can
//     never claim it afterwards, exactly as after a move).
//   • already CLAIMED onto a device (claim:<g>:in under a fingerprint) → 'claim' −take under that fingerprint, ref
//     ungrant:<g>:clawback, take = min(grant, what the key still holds). Never below zero, never more than the grant, so
//     receipts already signed with it stay paid for and a purchase beside it is not taken. NOT a 'revoke' kind row: that
//     kind is the device-MOVE marker and would unbind the key from the account (boundTo returns null past it).
// Fixed refs → a re-run appends nothing.
const isGrantRef = (r) => /^(grant:|move:grant:)/.test(String(r));
export async function revokePlan(ledger, account, ref = null) {
  const acct = String(account || '').trim().toLowerCase();
  const want = (g) => isGrantRef(g) && (!ref || g === ref);
  const plan = [];
  for (const u of await ledger.unclaimedOf(acct)) if (want(u.ref)) {
    plan.push({ state: 'unclaimed', grant: u.ref, row: { account_id: acct, pubkey_fingerprint: null, delta: -u.delta, kind: 'claim', stripe_session: null, ref: `claim:${u.ref}:out` } });
  }
  const left = new Map();   // running balance per key, so two grants on one key cannot claw back the same credits twice
  for (const r of await ledger.store.byAccount(acct)) {
    const m = r.kind === 'claim' && r.delta > 0 && r.pubkey_fingerprint && /^claim:(.+):in$/.exec(r.ref);
    if (!m || !want(m[1])) continue;
    const fp = r.pubkey_fingerprint;
    if (!left.has(fp)) left.set(fp, await ledger.balance(fp));
    if (await ledger.store.has(`ungrant:${m[1]}:clawback`)) { plan.push({ state: 'claimed', grant: m[1], fp, take: 0, done: true }); continue; }
    const take = Math.min(r.delta, left.get(fp));
    left.set(fp, left.get(fp) - take);
    plan.push({ state: 'claimed', grant: m[1], fp, take, spent: r.delta - take,
      row: take > 0 ? { account_id: acct, pubkey_fingerprint: fp, delta: -take, kind: 'claim', stripe_session: null, ref: `ungrant:${m[1]}:clawback` } : null });
  }
  if (!plan.length) throw new Error(`no grant on ${acct}${ref ? ` with ref ${ref}` : ''} to revoke`);
  return plan;
}

export function readMeetings(file = MEETINGS) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// who can be enrolled, and who cannot yet (and why). Never drops a row.
export function enrollPlan(rows) {
  return rows.map((m) => ({ who: m.who, email: m.email || null, org: m.org, date: m.date,
    action: m.email ? 'enroll' : 'MISSING EMAIL — add "email" to this row (it is on the calendar invite)' }));
}

function arg(a, f) { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; }

export async function supabaseLedger() {
  // .env.local in the caller's repo, then the environment (the npx door hands .env.local through as env); a missing pair is ONE line
  const file = path.join(REPO, '.env.local');
  const env = { ...process.env, ...(fs.existsSync(file) ? Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; })) : {}) };
  if (!(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL) || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('grant: needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local or the environment) — operator-only');
  const { createClient } = await import('@supabase/supabase-js');
  const { createCreditsLedger, supabaseCreditsStore } = await import('../../src/lib/notary/credits-ledger.mjs');
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return createCreditsLedger(supabaseCreditsStore(c));
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  const live = a.includes('--live');
  if (cmd === 'mint' && a.includes('--street')) {
    // C485 THE STREET LICENCE — one per reply to the iamfim box's email, run by hand per reply (src/lib/notary/street-grant.mjs):
    // $20 = one licence, no date in the ref so one per address, refused past STREET_GRANT_CAP with the reason.
    const { streetGrantPlan } = await import('../../src/lib/notary/street-grant.mjs');
    const { STREET_GRANT } = await import('../../src/lib/street-offer.mjs');
    const usd = arg(a, '--usd');
    if (usd && Number(usd) !== STREET_GRANT.usd) throw new Error(`--street mints exactly one licence (${STREET_GRANT.usd}); drop --usd ${usd} or mint without --street`);
    const L = await supabaseLedger();
    const plan = await streetGrantPlan(L, arg(a, '--account'));
    if (!plan.row) { console.log(`REFUSED (${plan.refused}) — ${plan.why}`); process.exitCode = 3; return; }
    const row = plan.row;
    console.log(`${live ? 'MINT' : 'DRY-RUN (add --live)'} · street licence ${plan.n} of ${plan.cap} · ${row.delta.toLocaleString()} credits (1 licence, ${STREET_GRANT.usd}) → ${row.account_id}\n  ref ${row.ref}`);
    if (!live) return;
    const { results } = await applyLive(L, [row], { action: 'mint', who: row.account_id, credits: row.delta, ref: row.ref, what: `street licence ${plan.n} of ${plan.cap} — for a reply` }, ACTIONS, LIVE);
    console.log(`  ${results[0].appended ? 'appended' : 'ALREADY ON RECORD (same ref) — nothing appended'} · balance ${await L.balanceOf(row.account_id)}`);
  } else if (cmd === 'mint') {
    const row = grantRow({ account: arg(a, '--account'), usd: arg(a, '--usd') || DEFAULT_USD });
    console.log(`${live ? 'MINT' : 'DRY-RUN (add --live)'} · ${row.delta.toLocaleString()} credits (${row.delta / CREDITS_PER_LICENCE} licences) → ${row.account_id}\n  ref ${row.ref}`);
    if (!live) return;
    const L = await supabaseLedger();
    const before = await L.balanceOf(row.account_id);
    const { results } = await applyLive(L, [row], { action: 'mint', who: row.account_id, credits: row.delta, ref: row.ref }, ACTIONS, LIVE);
    console.log(`  ${results[0].appended ? 'appended' : 'ALREADY ON RECORD (same ref) — nothing appended'} · balance ${before} → ${await L.balanceOf(row.account_id)}`);
  } else if (cmd === 'link') {
    const who = arg(a, '--who'); const usd = arg(a, '--usd') || DEFAULT_USD; const given = arg(a, '--token');
    if (!who) throw new Error('usage: grant.mjs link --who "<name>" [--usd 100] [--token <t>] [--live]');
    const { credits } = creditsForUsd(usd);
    if (!live) { console.log(`DRY-RUN (add --live) · claim link for ${who} · ${credits.toLocaleString()} credits ($${usd}) under claim+<sha256(token)>@claim.thetadriven.com — the token is issued only with --live`); return; }
    const L = await supabaseLedger();
    const plan = await linkPlan(L, { who, usd, ...(given ? { token: given } : {}) });
    if (plan.already) { console.log(`ALREADY MINTED — link ${plan.act.link_id} (${plan.account}) already carries a grant; nothing appended`); return; }
    const apply = () => applyLive(L, [plan.row], plan.act, ACTIONS, LIVE);
    await runLink(plan, { who, usd, apply });
  } else if (cmd === 'move') {
    const from = arg(a, '--from'); const to = arg(a, '--to');
    if (!from || !to) throw new Error('usage: grant.mjs move --from <email> --to <email> [--ref <grant ref>] [--live]');
    const L = await supabaseLedger();
    const grant = await pickGrant(L, from, arg(a, '--ref'));
    const rows = moveRows({ grant, to });
    console.log(`${live ? 'MOVE' : 'DRY-RUN (add --live)'} · ${grant.delta.toLocaleString()} credits (${grant.delta / CREDITS_PER_LICENCE} licences) ${grant.account_id} → ${rows[1].account_id}\n  from ref ${grant.ref}`);
    if (!live) return;
    const { results } = await applyLive(L, rows, { action: 'move', who: rows[1].account_id, from: grant.account_id, to: rows[1].account_id, credits: grant.delta, ref: grant.ref }, ACTIONS, LIVE);
    for (const r of results) console.log(`  ${r.appended ? 'appended' : 'already on record'} · ${r.delta > 0 ? '+' : ''}${r.delta} · ${r.account_id}`);
    console.log(`  balance ${grant.account_id} = ${await L.balanceOf(grant.account_id)} · ${rows[1].account_id} = ${await L.balanceOf(rows[1].account_id)}`);
  } else if (cmd === 'revoke') {
    const acct = arg(a, '--account');
    if (!acct) throw new Error('usage: grant.mjs revoke --account <email> [--ref <grant ref>] [--live]');
    const L = await supabaseLedger();
    const plan = await revokePlan(L, acct, arg(a, '--ref'));
    console.log(`${live ? 'REVOKE' : 'DRY-RUN (add --live)'} · ${acct}`);
    for (const p of plan) console.log(p.state === 'unclaimed'
      ? `  unclaimed ${-p.row.delta} credits · ${p.grant} → pulled from the pool`
      : p.done ? `  claimed on key ${p.fp.slice(0, 8)} · ${p.grant} → already revoked`
      : `  claimed on key ${p.fp.slice(0, 8)} · ${p.grant} → claw back ${p.take}${p.spent ? ` (${p.spent} already spent, stays spent)` : ''}`);
    if (!live) return;
    const { results } = await applyLive(L, plan.filter((p) => p.row).map((p) => p.row), { action: 'revoke', who: acct, grants: plan.map((p) => p.grant) }, ACTIONS, LIVE);
    for (const r of results) console.log(`  ${r.appended ? 'appended' : 'already on record'} · ${r.ref}`);
    console.log(`  balance ${acct} = ${await L.balanceOf(acct)}`);
  } else if (cmd === 'note') {   // a 1:1 in-thread note, through the personal-followup pipeline (Resend, Re: <subject>), never the Gmail connector
    const to = arg(a, '--to'); const subject = arg(a, '--subject'); const note = arg(a, '--note');
    if (!to || !subject || !note) throw new Error('usage: grant.mjs note --to <email> --subject "<the thread\'s subject, no Re:>" --note "…" [--free-form] [--live]');
    const args = ['scripts/bookclub/personal-followup.sh', to, '--note', note, '--subject', subject.replace(/^(re:\s*)+/i, ''), '--campaign', 'grant', ...(a.includes('--free-form') ? ['--free-form'] : []), ...(live ? [] : ['--dry-run'])];
    const out = execFileSync('bash', args, { cwd: REPO, encoding: 'utf8' });
    process.stdout.write(out);
    if (!live) { console.log('DRY-RUN — add --live to send, receipt and commit'); return; }
    const id = (/\bid (\S+)/.exec(out) || [])[1];
    if (!/✅/.test(out) || !id) throw new Error('personal-followup did not report a sent id — no receipt written, nothing claimed as sent');
    const r = recordAction({ action: 'note', who: to, channel: 'resend', resend_id: id, subject: `Re: ${subject}`, what: note.slice(0, 120) }, ACTIONS, LIVE);
    console.log(`receipt + commit ${r.commit} · note ${id} → ${to}`);
  } else if (cmd === 'sent') {   // BACKFILL ONLY: a message that already went out via the Gmail connector gets its receipt + commit late
    const who = arg(a, '--to'); const id = arg(a, '--id'); const what = arg(a, '--what');
    if (!who || !id || !what) throw new Error('usage: grant.mjs sent --to <email> --id <gmail message id> --what "<one line>" [--thread <id>]');
    const r = recordAction({ action: 'sent', who, channel: 'gmail-connector', message_id: id, thread_id: arg(a, '--thread'), from: 'elias@thetadriven.com', what, backfill: true }, ACTIONS, LIVE);
    console.log(`receipt + commit ${r.commit} · sent ${id} → ${who}`);
  } else if (cmd === 'enroll') {
    const plan = enrollPlan(readMeetings());
    let missing = 0;
    for (const p of plan) {
      if (p.action !== 'enroll') { missing++; console.log(`  ✗ ${p.who} (${p.org}) — ${p.action}`); continue; }
      let out; let ok = true;
      try {
        out = execFileSync('node', ['scripts/bookclub/enroll-one.mjs', '--email', p.email, '--name', p.who, '--seat', 'meeting',
          '--note', `held meeting ${p.date} (data/pitch-meetings.ndjson)`, ...(live ? ['--live'] : [])], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; ok = /already enrolled/i.test(out); }   // enroll-one refuses loudly; "already enrolled" is done
      console.log(`  ${ok ? '✓' : '✗'} ${p.who} <${p.email}>\n    ${out.trim().split('\n').slice(-2).join('\n    ')}`);
      if (!ok) process.exitCode = 1;
    }
    if (missing) { console.log(`${missing} attendee(s) not enrolled — no address on the row.`); process.exitCode = 3; }
  } else if (cmd === 'status' || !cmd) {
    for (const p of enrollPlan(readMeetings())) console.log(`${p.date} · ${p.who} · ${p.email || '(no email)'} · ${p.action}`);
  } else { console.error('usage: grant.mjs status | link --who "<name>" [--usd 100] [--live] | mint --account <email> --usd <N> [--live] | mint --street --account <email> [--live] | move --from <email> --to <email> [--ref <r>] [--live] | revoke --account <email> [--ref <r>] [--live] | note --to <email> --subject "…" --note "…" [--live] | sent --to <email> --id <msg id> --what "…" (backfill) | enroll [--live]'); process.exit(2); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e.message); process.exit(1); });
