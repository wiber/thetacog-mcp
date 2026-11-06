#!/usr/bin/env node
/**
 * claim-links — the ADMIN-ONLY page of every claim link we minted, latest at the top, with each link's LIVE status read
 * from the credits ledger (Supabase). Local by construction: the tokens are $-bearing bearer secrets, so the store and the
 * page both live in gitignored .thetacog/ and are never deployed. Only /claim/<token> (one per person) is public.
 *
 * WHY (operator 2026-09-27): "prep the claim [of] the 5 license as a landing page just for them … they log in with
 * whatever email they want (google) … personalise each landing link … a local html with the latest we mint at the top …
 * we need to maintain the magic links". Before this, grant.mjs link printed the token ONCE and stored nothing, so a
 * minted link could not be re-sent; 30 of 33 were recoverable only by grepping old session transcripts.
 *
 * STATUS, AND WHAT IT IS SUFFICIENT FOR: each link is read through grant-link.mjs linkStatus (the same function the
 * /claim page uses) — open · claimed → <email> · revoked. "claimed" is split by whether the moved grant is still
 * unclaimed under that email (signed in on the page, not yet on a device) or gone from it (bound to a device key).
 * It is NOT sufficient for "did they run anything": receipts spent is a different read.
 *
 *   node scripts/comms/claim-links.mjs                 # read the ledger, write .thetacog/claim-links.html, open it
 *   node scripts/comms/claim-links.mjs --no-open       # write + print only
 *   node scripts/comms/claim-links.mjs backfill <file> # merge "<link_id> <token>" lines into the store (hash-checked)
 *
 * Guard: tests/comms/claim-links.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkUrl, linkStatus } from '../../src/lib/notary/grant-link.mjs';
import { STORE, readNd, keepToken } from './claim-link-store.mjs';
export { STORE, keepToken };

// C2305: the caller's repo when run as `npx thetacog-mcp claim-links` (VNA_REPO = its cwd), never the npx cache the code sits in
const REPO = process.env.VNA_REPO ? path.resolve(process.env.VNA_REPO) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PAGE = path.join(REPO, '.thetacog/claim-links.html');
const ACTIONS = path.join(REPO, 'data/meetings/grant-actions.ndjson');
const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=thetadriven.thetacog-mcp';
const VSX = 'https://thetadriven.com/vsx';


/** Every minted link from the committed action ledger, joined to its kept token, latest first. */
export function links(actions = readNd(ACTIONS), store = readNd(STORE)) {
  const tok = new Map(store.map((r) => [r.link_id, r.token]));
  return actions.filter((a) => a.action === 'link' && a.link_id)
    .map((a) => ({ at: a.at, who: a.who, usd: a.usd, link_id: a.link_id, token: tok.get(a.link_id) || null }))
    .sort((x, y) => (x.at < y.at ? 1 : -1));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const BADGE = { open: ['#b7791f', 'open — not claimed'], signed: ['#2b6cb0', 'claimed — on their email, not yet on a device'],
  bound: ['#2f855a', 'claimed — bound to a device'], revoked: ['#718096', 'revoked'], unknown: ['#c53030', 'not on the ledger'] };

export function renderPage(rows, generatedAt = new Date().toISOString()) {
  const card = (r) => {
    const [color, label] = BADGE[r.state] || BADGE.unknown;
    const url = r.token ? linkUrl(r.token) : null;
    return `<article><header><strong>${esc(r.who)}</strong> · $${esc(r.usd)} · minted ${esc(r.at.slice(0, 16).replace('T', ' '))} UTC
      <span class="b" style="background:${color}">${esc(label)}${r.to ? ` → ${esc(r.to)}` : ''}</span></header>
      ${url ? `<p><a href="${esc(url)}">${esc(url)}</a> <button onclick="navigator.clipboard.writeText('${esc(url)}')">copy</button></p>`
        : '<p class="m">token not kept (minted before the store existed, not recovered) — revoke and re-mint to send it</p>'}
      <p class="m">link ${esc(r.link_id)}</p></article>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claim Links</title><style>
:root{--bg:#fff;--fg:#1a202c;--m:#718096;--card:#f7fafc}
@media (prefers-color-scheme:dark){:root{--bg:#1a202c;--fg:#edf2f7;--m:#a0aec0;--card:#2d3748}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:820px;margin:0 auto;padding:16px}
article{background:var(--card);border-radius:8px;padding:12px 14px;margin:10px 0;overflow-wrap:anywhere}
.b{color:#fff;border-radius:4px;padding:1px 7px;font-size:13px;margin-left:6px}.m{color:var(--m);font-size:13px}
a{color:inherit}button{font-size:12px;margin-left:6px}ol{padding-left:20px}</style></head><body>
<h1>Claim links</h1><p class="m">Admin only — local file, never deployed. Status read from the credits ledger at ${esc(generatedAt.slice(0, 16).replace('T', ' '))} UTC. Latest mint first.</p>
<details><summary>What the person sees after the link</summary><ol>
<li>The link opens their own page: $100 · 50,000 signed receipts. They sign in with Google, any address they like.</li>
<li>"Put it on &lt;email&gt;" — the grant moves to that address. The link works once.</li>
<li>Install: VS Code Marketplace <a href="${MARKETPLACE}">thetadriven.thetacog-mcp</a> · Cursor <a href="${VSX}">thetadriven.com/vsx</a>.</li>
<li>In the extension, Connect (💳) opens /device: sign in with the same email and the licences bind to that machine's key.</li>
<li>Then in Claude Code: <code>/steer one CSS class on the pricing card</code> — any one-line statement of what the work should touch.</li></ol></details>
${rows.map(card).join('\n')}
</body></html>
`;
}

async function stateOf(L, r) {
  if (!r.token) return { state: 'unknown' };
  const st = await linkStatus(L, r.token);
  if (st.status === 'open' || st.status === 'revoked') return { state: st.status };
  if (st.status !== 'claimed') return { state: 'unknown' };
  const still = (await L.unclaimedOf(st.to)).some((g) => String(g.ref).includes(st.ref));
  return { state: still ? 'signed' : 'bound', to: st.to };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'backfill') {
    const byId = new Map(links().map((r) => [r.link_id, r]));
    let n = 0;
    for (const line of fs.readFileSync(arg, 'utf8').split('\n')) {
      const [id, token] = line.trim().split(/\s+/); const r = byId.get(id);
      if (r && token && keepToken({ who: r.who, usd: r.usd, token, link_id: id })) n++;
    }
    console.log(`kept ${n} token(s) → ${path.relative(REPO, STORE)}`);
  } else {
    const { supabaseLedger } = await import('../meetings/grant.mjs');
    const L = await supabaseLedger();
    const rows = [];
    for (const r of links()) rows.push({ ...r, ...(await stateOf(L, r)) });
    fs.writeFileSync(PAGE, renderPage(rows), { mode: 0o600 });
    for (const r of rows) console.log(`${r.at.slice(0, 16)}  ${String(r.who).padEnd(22)} $${String(r.usd).padEnd(4)} ${r.state.padEnd(8)} ${r.to || ''}${r.token ? '' : '  (no token kept)'}`);
    console.log(`\nwrote ${path.relative(REPO, PAGE)}`);
    if (!process.argv.includes('--no-open')) {
      try { execFileSync('open', [PAGE]); } catch (e) { console.log(`  (open failed: ${e.message}) — the page is still at ${path.relative(REPO, PAGE)}`); }
    }
  }
}
