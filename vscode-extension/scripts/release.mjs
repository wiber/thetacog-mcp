#!/usr/bin/env node
// packages/thetacog-mcp-vscode/scripts/release.mjs — C244 THE RELEASE REACHES EVERY EDITOR
// (operator 2026-09-24, verbatim: "make sure the sh updates the site /vsx as well and that cursor et al users update as well").
//
// One run, one version, three places, read back after:
//   (a) package ONCE (vsce package → <pkg>/<name>-<version>.vsix)
//   (b) publish to the VS Code Marketplace (vsce publish -i) AND to Open VSX (ovsx publish) — the registry Cursor, Windsurf and
//       VSCodium install from; it answered 404 for thetadriven.thetacog-mcp until this door existed, so those users never updated
//   (c) update the site's /vsx: data/vsx/release.json is the STATE (version · file · bytes · sha256 · date); public/vsx/index.html
//       and public/vsx/release.json are GENERATED from it, the vsix is copied beside them as <name>-<version>.vsix and
//       <name>-latest.vsix, and older downloads are retired — one version on the page, one file behind it
//   (d) read all three back (the Marketplace gallery API · open-vsx.org/api · thetadriven.com/vsx/release.json) and print ONE line:
//         marketplace <v> · open-vsx <v|404> · /vsx <v> · MATCH|MISMATCH
//
// THE PUBLISHES LEAVE THE MACHINE, SO THEY ARE THE OPERATOR'S ACT: the default is a DRY RUN that does (a), (c) and (d) and prints
// the two publish commands without running them. `--publish` runs them. Tokens: VSCE_PAT and OVSX_PAT from the environment or the
// monorepo's .env.local — read, never printed; a missing one is reported by NAME and that registry is skipped, never a crash.
// Open VSX needs the `thetadriven` namespace once (`npx ovsx create-namespace thetadriven -p $OVSX_PAT`); --publish tries it and
// tolerates "already exists".
//   node scripts/release.mjs              dry run (package · /vsx · read-back; publishes printed)
//   node scripts/release.mjs --publish    the release: both registries, then /vsx, then the read-back
//   node scripts/release.mjs --read-back  only (d)
//   node scripts/release.mjs --no-package reuse the vsix already built for package.json's version (package dir or ~/Desktop)
// Guard: tests/vna/c244-the-release-reaches-every-editor.test.mjs.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DEFAULT = resolve(HERE, '../..');
export const VSX_DATA = 'data/vsx/release.json';
export const VSX_DIR = 'public/vsx';
export const NAMESPACE = 'thetadriven';
export const MARKETPLACE_ITEM = `https://marketplace.visualstudio.com/items?itemName=${NAMESPACE}.thetacog-mcp`;
export const GALLERY_API = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
export const OPENVSX_API = `https://open-vsx.org/api/${NAMESPACE}/thetacog-mcp`;
export const SITE = 'https://thetadriven.com';

// ── tokens: env first, then the monorepo's .env.local; the VALUE never reaches a log line ─────────────────────────────────────────
export function tokenFor(name, { env = process.env, repoRoot = REPO_DEFAULT } = {}) {
  if (env[name]) return env[name];
  const f = join(repoRoot, '.env.local');
  if (!existsSync(f)) return null;
  const m = readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  const v = m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  return v || null;
}

const sh = (cmd, args, { cwd, env } = {}) => spawnSync(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });

// ── (a) package once ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function packageOnce({ pkgDir, name, version, log = console.log, reuse = false }) {
  const out = join(pkgDir, `${name}-${version}.vsix`);
  if (reuse) {
    const found = [out, join(homedir(), 'Desktop', `${name}-${version}.vsix`)].find((p) => existsSync(p));
    if (found) { log(`· reusing ${found}`); return found; }
    log(`· no ${name}-${version}.vsix to reuse — packaging`);
  }
  const r = sh('npx', ['@vscode/vsce', 'package', '--no-git-tag-version'], { cwd: pkgDir });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`vsce package failed (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(-600)}`);
  log(`✓ packaged ${basename(out)} (${statSync(out).size} bytes)`);
  return out;
}

// ── (b) the two registries — each returns { ran, cmd, why? }; dryRun prints, a missing token is named, never printed ───────────────
export const publishers = {
  async marketplace({ vsix, version, dryRun, token, log = console.log, run = sh, cwd }) {
    const cmd = `npx @vscode/vsce publish -i ${vsix}`;
    if (dryRun) { log(`· dry run — Marketplace: ${cmd}  (VSCE_PAT ${token ? 'present' : 'MISSING'})`); return { ran: false, cmd, version }; }
    if (!token) { log('✗ Marketplace: VSCE_PAT is missing (env or .env.local) — not published'); return { ran: false, cmd, why: 'VSCE_PAT missing' }; }
    const r = run('npx', ['@vscode/vsce', 'publish', '-i', vsix], { cwd, env: { VSCE_PAT: token } });
    const ok = r.status === 0;
    log(ok ? `✓ Marketplace: published ${version}` : `✗ Marketplace: vsce publish exit ${r.status}: ${String(r.stderr || r.stdout || '').slice(-400)}`);
    return { ran: ok, cmd, why: ok ? null : `exit ${r.status}` };
  },
  async openvsx({ vsix, version, dryRun, token, log = console.log, run = sh, cwd, namespace = NAMESPACE }) {
    const cmd = `npx ovsx publish ${vsix}`;
    if (dryRun) { log(`· dry run — Open VSX: npx ovsx create-namespace ${namespace} (once) · ${cmd}  (OVSX_PAT ${token ? 'present' : 'MISSING'})`); return { ran: false, cmd, version }; }
    if (!token) { log('✗ Open VSX: OVSX_PAT is missing (env or .env.local) — not published; create the namespace + token at open-vsx.org'); return { ran: false, cmd, why: 'OVSX_PAT missing' }; }
    const ns = run('npx', ['ovsx', 'create-namespace', namespace, '-p', token], { cwd });
    if (ns.status !== 0 && !/already exists|exists/i.test(String(ns.stderr || ns.stdout || ''))) log(`· Open VSX: create-namespace ${namespace} answered exit ${ns.status} (continuing): ${String(ns.stderr || ns.stdout || '').slice(-200)}`);
    const r = run('npx', ['ovsx', 'publish', vsix, '-p', token], { cwd });
    const ok = r.status === 0;
    log(ok ? `✓ Open VSX: published ${version}` : `✗ Open VSX: ovsx publish exit ${r.status}: ${String(r.stderr || r.stdout || '').slice(-400)}`);
    return { ran: ok, cmd, why: ok ? null : `exit ${r.status}` };
  },
};

// ── (c) /vsx — the data file is the state; the page and release.json are rendered from it ──────────────────────────────────────────
const kb = (n) => `${Math.round(n / 1024)} KB`;
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** the /vsx page, a pure function of data/vsx/release.json — refuses on no data (an empty page is a different claim) */
export function renderVsxPage(rel) {
  if (!rel || !rel.version || !rel.file || !rel.sha256) throw new Error(`renderVsxPage: refusing to render /vsx without a release (version · file · sha256) — write ${VSX_DATA} first`);
  const v = escHtml(rel.version), file = escHtml(rel.file), sha = escHtml(rel.sha256);
  return `<!doctype html>
<!-- GENERATED by packages/thetacog-mcp-vscode/scripts/release.mjs from data/vsx/release.json — never edit by hand (C244). The version, the download and the hash are the release's. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ThetaCog Steer · install in Cursor</title>
<meta name="description" content="ThetaCog Steer for Cursor, VSCodium and Windsurf — the same .vsix the VS Code Marketplace serves, installed from a file or from Open VSX.">
<style>
:root{--bg:#0b120b;--card:#141c14;--line:#2a3a2a;--fg:#d8e6da;--dim:#9db89f;--acc:#8fd19e}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0 0 4px}.k{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);font-weight:800}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:16px 0}
code,pre{font-family:ui-monospace,Menlo,monospace;font-size:14px}pre{background:var(--bg);padding:10px 14px;border-radius:8px;overflow:auto;color:var(--acc)}
a{color:var(--acc)}.dim{color:var(--dim);font-size:13px}img{max-width:100%;border-radius:8px;border:1px solid var(--line)}
.btn{display:inline-block;background:#1e8e3e;color:#fff;font-weight:700;padding:10px 18px;border-radius:8px;text-decoration:none}
</style></head><body><main>
<img src="/bookclub/thetacog-steer-logo-256.png" alt="" width="64" height="64" style="border:0;border-radius:12px">
<div class="k">ThetaCog Steer · Double-Entry Bookkeeping for Autonomy</div>
<h1>Install in Cursor, VSCodium or Windsurf</h1>
<p class="dim">Those editors read Open VSX, not Microsoft's marketplace. Search their extensions panel for exactly <b>ThetaCog Steer</b> (<a href="https://open-vsx.org/extension/${NAMESPACE}/thetacog-mcp">the Open VSX listing</a>), or install the same package, byte for byte, from the file below. Version <b>${v}</b>.</p>

<div class="card">
<div class="k">1 · Download</div>
<p><a class="btn" href="/vsx/${file}" download>${file}</a> <span class="dim">${kb(rel.bytes || 0)} · MIT · ${escHtml((rel.releasedAt || '').slice(0, 10))}</span></p>
<p class="dim">sha256 <code>${sha}</code> — the file you get should hash to this; if it does not, do not install it. Machine-readable: <a href="/vsx/release.json">/vsx/release.json</a>.</p>
</div>

<div class="card">
<div class="k">2 · Install — either way</div>
<p><b>In the editor:</b> Extensions (⇧⌘X / Ctrl+Shift+X) → the <b>⋯</b> menu at the top of the panel → <b>Install from VSIX…</b> → pick the file.</p>
<p><b>From a terminal:</b></p>
<pre>curl -fsSLO ${SITE}/vsx/thetacog-mcp-latest.vsix
shasum -a 256 thetacog-mcp-latest.vsix     # compare with the hash above
cursor --install-extension thetacog-mcp-latest.vsix</pre>
<p class="dim">(<code>codium</code> / <code>windsurf</code> in place of <code>cursor</code>.) Then reload the window; the ThetaCog sidebar appears in the activity bar.</p>
</div>

<div class="card">
<div class="k">Using VS Code?</div>
<p>Search the Marketplace for exactly <b>ThetaCog Steer</b>, or open <a href="${MARKETPLACE_ITEM}">the listing</a>. Same package, same version.
</div>

<p class="dim">The measurement is free (MIT); the countersignature is what you pay for. Ten seconds in any terminal, no install: <code>npx thetacog-mcp attest-demo</code>. Source: <a href="https://github.com/wiber/thetacog-mcp">github.com/wiber/thetacog-mcp</a>.</p>
</main></body></html>
`;
}

export function updateVsx({ repoRoot, vsix, name, version, log = console.log, now = () => new Date() }) {
  const bytes = readFileSync(vsix);
  const rel = { name, version, file: `${name}-${version}.vsix`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), releasedAt: now().toISOString(), marketplace: MARKETPLACE_ITEM, openvsx: `https://open-vsx.org/extension/${NAMESPACE}/thetacog-mcp` };
  const dataPath = join(repoRoot, VSX_DATA); mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, JSON.stringify(rel, null, 2) + '\n');
  const dir = join(repoRoot, VSX_DIR); mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.startsWith(`${name}-`) && f.endsWith('.vsix') && f !== rel.file && f !== `${name}-latest.vsix`) { unlinkSync(join(dir, f)); log(`· retired ${VSX_DIR}/${f}`); }
  copyFileSync(vsix, join(dir, rel.file)); copyFileSync(vsix, join(dir, `${name}-latest.vsix`));
  writeFileSync(join(dir, 'index.html'), renderVsxPage(rel));
  writeFileSync(join(dir, 'release.json'), JSON.stringify(rel, null, 2) + '\n');
  log(`✓ /vsx → ${version} (${VSX_DATA} · ${VSX_DIR}/index.html · ${rel.file} · ${name}-latest.vsix · release.json) — commit and push to serve it`);
  return rel;
}

// ── (d) read all three back ────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function readBack({ version, fetch = globalThis.fetch, site = SITE }) {
  const safe = async (fn) => { try { return await fn(); } catch (e) { return `ERR ${String(e.message || e).slice(0, 40)}`; } };
  const marketplace = await safe(async () => {
    const r = await fetch(GALLERY_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' }, body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: `${NAMESPACE}.thetacog-mcp` }] }], flags: 513 }) });
    if (!r.ok) return String(r.status);
    const j = await r.json(); const v = j?.results?.[0]?.extensions?.[0]?.versions?.[0]?.version; return v || '404';
  });
  const openvsx = await safe(async () => { const r = await fetch(OPENVSX_API); if (!r.ok) return String(r.status); const j = await r.json(); return j?.version || '404'; });
  const vsx = await safe(async () => {
    const r = await fetch(`${site}/vsx/release.json`);
    if (r.ok) { const j = await r.json(); if (j?.version) return j.version; }
    const p = await fetch(`${site}/vsx`); if (!p.ok) return String(p.status);   // the pre-C244 page: read the version off the download link
    const m = (await p.text()).match(/href="\/vsx\/thetacog-mcp-(\d+\.\d+\.\d+)\.vsix"/); return m ? m[1] : 'UNMEASURED';
  });
  const match = [marketplace, openvsx, vsx].every((v) => v === version);
  return { marketplace, openvsx, vsx, version, match, line: `marketplace ${marketplace} · open-vsx ${openvsx} · /vsx ${vsx} · ${match ? 'MATCH' : 'MISMATCH'}` };
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// after a fresh package: the vsix goes to ~/Desktop and into every editor on this machine (vsix-to-desktop.mjs, C209) — the local
// editors update the same way the remote ones do; a reused build was already moved
export const toDesktop = ({ pkgDir, log = console.log }) => { const r = sh('node', ['scripts/vsix-to-desktop.mjs'], { cwd: pkgDir }); log((r.stdout || '').trim() || `· vsix-to-desktop exit ${r.status}`); return r.status === 0; };

export async function release({ repoRoot = REPO_DEFAULT, pkgDir = HERE, publish = false, reuse = false, log = console.log, packager = packageOnce, publishers: pubs = publishers, fetch = globalThis.fetch, env = process.env, afterPackage = toDesktop } = {}) {
  const { name, version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const dryRun = !publish;
  log(`${dryRun ? 'DRY RUN' : 'RELEASE'} — ${name} ${version}`);
  const vsix = await packager({ pkgDir, name, version, log, reuse });
  const tokens = { VSCE_PAT: tokenFor('VSCE_PAT', { env, repoRoot }), OVSX_PAT: tokenFor('OVSX_PAT', { env, repoRoot }) };
  const marketplace = await pubs.marketplace({ vsix, version, dryRun, token: tokens.VSCE_PAT, log, cwd: pkgDir });
  const openvsx = await pubs.openvsx({ vsix, version, dryRun, token: tokens.OVSX_PAT, log, cwd: pkgDir });
  const vsxRel = updateVsx({ repoRoot, vsix, name, version, log });
  if (!reuse) afterPackage({ pkgDir, log });
  const rb = await readBack({ version, fetch });
  log(rb.line + (rb.match ? '' : ` (released ${version} — /vsx serves the new version once this commit is pushed and deployed)`));
  return { name, version, vsix, dryRun, published: { marketplace, openvsx }, vsx: vsxRel, readback: rb, tokens: { VSCE_PAT: !!tokens.VSCE_PAT, OVSX_PAT: !!tokens.OVSX_PAT } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.includes('--read-back')) {
    const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
    readBack({ version }).then((r) => { console.log(r.line + (r.match ? '' : ` (local package.json ${version})`)); process.exit(0); });
  } else {
    release({ publish: a.includes('--publish'), reuse: a.includes('--no-package') })
      .then((r) => { if (!r.dryRun && (!r.published.marketplace.ran || !r.published.openvsx.ran)) process.exit(2); })
      .catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
  }
}
