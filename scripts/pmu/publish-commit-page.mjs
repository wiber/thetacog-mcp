#!/usr/bin/env node
// scripts/pmu/publish-commit-page.mjs
//
// Publish a commit's drift-receipt TRIPTYCH as a PUBLIC, SEO-indexable page under
// public/commit/<shaShort>/ — the same artifact the on-commit email ships, but on the web. The email
// then LINKS this predicted URL, so the email's claim is verifiable on the public web (it cannot be
// spoofed) and every commit receipt becomes an indexable page. Operator, 2026-06-28: "all triptychs
// must be public … publish it on the web under /commit/<hash> … the email is validated on web."
//
// Writes:
//   public/commit/<shaShort>/index.html   — self-contained SEO page (OG tags + the receipt body)
//   public/commit/<shaShort>/<panel>.png  — the panel PNGs (also the og:image source)
// Returns: { url, dir, ogImage }  (url is the site-relative path, e.g. /commit/427ef7e8b/)
//
// Pure function — no commit, no email. The caller (commit-triptych.mjs) writes the files; they deploy
// with the next commit (the email carries the PREDICTED url, which the operator confirmed is fine).

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { recordTrip } from './pipeline-gates.mjs';
import { signPanelPng } from '../lib/panel-provenance.mjs';   // C339 — the panel names the hardware it ran on
import { convergeHero } from './converge-hero.mjs';
import { signPanel } from '../vna/panel-coverage.mjs';   // C649a — the published panel is bound to its commit on the signed tape

const SITE = process.env.NEXT_PUBLIC_APP_URL || 'https://thetadriven.com';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {object} o
 * @param {string} o.repoRoot          absolute repo root
 * @param {string} o.shaShort          short sha (the URL segment)
 * @param {string} o.sha               full sha (for the GitHub link)
 * @param {Array<{name:string,buf:Buffer}>} o.pngs   panel buffers (names match cid: refs)
 * @param {string} o.bodyHtmlCid       the email body HTML, using cid:<name> image refs
 * @param {string} o.subject          page <title> / og:title
 * @param {string} o.description      meta description / og:description (the verdict, plain text)
 * @param {boolean} [o.tolEmpty]      true when the commit's tolerance panel is 0g/0a/0r (data-only /
 *                                    no-code commit) — the panel is HONESTLY near-blank, but a blank
 *                                    square is still the wrong thing to hand a social-card crawler as
 *                                    the "og:image" (incident 2026-07-02, user report: og.png shipped
 *                                    blank for delegate-mesh commits). SEND-GATE (same discipline as
 *                                    AR-15's encircled-nonempty): a degenerate panel never becomes the
 *                                    public thumbnail — it falls back to the site default, same as the
 *                                    no-panel-at-all case below.
 * @returns {{url:string, dir:string, ogImage:string}}
 */
/** archivePanelsToPublish(repoRoot) — the native panels (docs/pmu/commit-panels/*.png) on disk and not yet tracked. The backup
 *  carries panels read from the git tree at HEAD (panel-carry.mjs), and this publish committed only public/commit/<sha>/, so the
 *  archive copy sat untracked until a sweep: 29 panels by 2026-10-14, each a "no panel" tile on /backup/adherence. Every publish
 *  now carries them, so a panel the post-commit wrote late rides the next publish. */
export function archivePanelsToPublish(repoRoot) {
  try {
    return execSync('git ls-files --others --exclude-standard -- docs/pmu/commit-panels/', { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').filter((p) => p.endsWith('.png'));
  } catch { return []; }
}

export function publishCommitPage({ repoRoot, shaShort, sha, pngs = [], bodyHtmlCid = '', subject = '', description = '', tolEmpty = false, walkEngine = null }) {
  if (!shaShort) throw new Error('publishCommitPage: shaShort required');
  const rel = `/commit/${shaShort}/`;
  const dir = path.join(repoRoot, 'public', 'commit', shaShort);
  mkdirSync(dir, { recursive: true });

  // The page body is fully self-contained (every panel inlined as base64 below), so the OTHER panel
  // PNGs are NOT written — that pile of timestamp-suffixed files was pure bloat AND the source of the
  // partial-tracking bug (33 on disk, ~11 committed, referenced ones missing). The ONE file we still
  // write is the og:image, because social-card crawlers need a real URL (data: URIs don't preview).
  // Use a STABLE name (og.png) so it never drifts out of sync with the HTML and is trivially tracked.
  const tol = tolEmpty ? null : (pngs.find((p) => /tolerance/i.test(p.name)) || pngs.find((p) => /encircled/i.test(p.name)) || pngs[0]);
  if (tolEmpty) recordTrip({ gate: 'og-image-nonblank', sha: shaShort, context: { pngs: pngs.length }, action: 'og.png fallback: tolEmpty commit — degenerate panel never becomes the public thumbnail' });
  let ogImage = `${SITE}/blog/triptych-tolerance-default.png`;
  if (tol) { try { writeFileSync(path.join(dir, 'og.png'), tol.buf); ogImage = `${SITE}${rel}og.png`; } catch { /* fall back to default */ } }

  // Also write the ENCIRCLED tolerance panel as a stable trip-encircled-<sha>.png (2026-07-08). The
  // /commit gallery + the /iamfim proof art prefer this file — green in-lane rings · amber bleed ·
  // red drift, the budget-writer's anchor — and fall back to og.png only when it is absent. Without
  // this, every NEW commit's gallery card regressed to the sparse lattice and the encircled backfill
  // (scripts/blog/backfill-encircled-receipts.mjs) had to be re-run by hand. Prefer the panel actually
  // named "encircled"; else the tol panel; else the largest buffer (the encircled render is biggest).
  if (!tolEmpty && pngs.length) {
    const enc = pngs.find((p) => /encircled/i.test(p.name))
      || tol
      || pngs.reduce((a, b) => (b.buf.length > a.buf.length ? b : a), pngs[0]);
    if (enc?.buf?.length) {
      // SIGNED AT PRODUCTION (C339, operator 2026-09-26: "sign them by metadata … what is Hardware testing
      // and what is not"). One iTXt chunk — the pixels are untouched — carrying this machine, the walk
      // binary's sha256, the engine the pipeline reported, and the tested / not-tested lists, sealed with
      // the host key. Signing never blocks publishing: an unsigned panel is written rather than none.
      let buf = enc.buf;
      try { buf = signPanelPng(enc.buf, { subject: sha || shaShort, walkEngine }); } catch { /* unsigned beats absent */ }
      try { writeFileSync(path.join(dir, `trip-encircled-${shaShort}.png`), buf); } catch { /* best-effort; the backfill is the safety net */ }
    }
  }

  // The email body references images as cid:<name>. DON'T rewrite those to relative file URLs — a
  // referenced PNG can be missing on disk, untracked, or unpushed, so the page renders with broken
  // images (exactly the inconsistency the operator hit). Instead INLINE every image as a base64 data
  // URI from the SAME buffers the email embeds: the page becomes fully self-contained, so it can never
  // have a missing image and never depends on a separate file deploying. cid:<name> with no matching
  // buffer falls back to the bare name (a relative URL) so nothing breaks if a buffer is absent.
  const cidMap = new Map(pngs.map((p) => [p.name, `data:image/png;base64,${p.buf.toString('base64')}`]));
  let webBody = String(bodyHtmlCid).replace(/cid:([A-Za-z0-9._-]+)/g, (_m, name) => cidMap.get(name) || name);

  // CONVERGENCE (incident 2026-07-06): a thin/data commit that nonetheless has a lit `tol` panel would
  // ship a lit og.png next to an EMPTY direction-only hero — the same commit described two ways, and the
  // recipient of a lit email panel lands on a blank hero. Whenever a lit panel exists, the in-page hero
  // becomes THAT panel (convergeHero no-ops on substantive pages — it only touches the exact blank-hero
  // caption). The pure-tolEmpty case (no panel at all) stays honestly direction-only here and is handled
  // by the standalone backfill (which renders a lens panel). Guard: tests/commit-page/hero-not-blank.test.js.
  if (tol) {
    const r = convergeHero(webBody, tol.buf.toString('base64'));
    if (r.changed) { webBody = r.html; try { recordTrip({ gate: 'hero-not-blank', sha: shaShort, context: { notes: r.notes }, action: 'hero converged to lit panel (thin commit had a lit tol panel but a blank hero)' }); } catch { /* trip ledger best-effort */ } }
  }

  const title = `${subject || `Commit ${shaShort}`} · drift receipt`;
  const desc = (description || 'A recomputable on-chip drift receipt: green in-lane · amber bleed · red drift. Byte-identical on recompute.').slice(0, 300);
  const canonical = `${SITE}${rel}`;
  const ghUrl = `https://github.com/wiber/thetadrivencoach/commit/${sha || shaShort}`;

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="576"><meta property="og:image:height" content="576">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(ogImage)}">
</head>
<body style="background:#05070d;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif;margin:0;padding:18px">
${webBody}
<div style="max-width:700px;margin:18px auto 0;padding-top:12px;border-top:1px solid #1c2533;font:12px/1.6 ui-monospace,monospace;color:#5f6b78">
  This is the on-chip drift receipt for commit <a href="${esc(ghUrl)}" style="color:#66a3ff">${esc(shaShort)}</a>,
  the same artifact emailed on commit — published so the claim is verifiable on the open web.
  Recompute it yourself: <span style="color:#9aa6b2">npx thetacog-mcp attest-demo</span>.
</div>
</body></html>`;

  writeFileSync(path.join(dir, 'index.html'), html);
  // COMMIT the page (index.html + PNGs) AFTERWARD so it actually deploys — index + images TOGETHER,
  // so the live page never renders a broken panel. WHY a follow-up commit: git is sequential — this
  // runs in POST-COMMIT, after the triggering commit already closed, so the page can NEVER be in that
  // commit; the only fix is to commit it afterward. The post-commit RECURSION GUARD skips
  // "chore(commit-page):" commits, so this does not loop. Guard here too (belt + suspenders) + retry
  // index.lock (concurrent automation commits). Best-effort: a miss is swept by the next commit.
  try {
    // C649a: the recursion guard reads the subject of the commit BEING RENDERED, never the subject at HEAD. Reading HEAD
    // skipped the commit whenever another render's `chore(commit-page)` commit had landed first — 13 panels sat rendered on
    // disk and never committed (measured 2026-10-05). Only a render OF a chore(commit-page) commit is the recursion.
    const headMsg = execSync(`git log -1 --format=%s ${JSON.stringify(sha || 'HEAD')}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (!/^chore\(commit-page\):/.test(headMsg)) {
      const q = [dir, ...archivePanelsToPublish(repoRoot)].map((p) => JSON.stringify(p)).join(' ');
      // C654: through the commit lane's queueing door — --no-verify skips pre-commit, so without the door this
      // commit would write .git/COMMIT_EDITMSG beside a private-index commit and trade messages with it. The env
      // drops MAILBOX_HELD: a render detached from a door's commit inherits it after the door has let go.
      // A repo without the lane (a test's scratch repo) commits bare — the lane is the repo's, never borrowed.
      const laneSh = path.join(repoRoot, 'scripts/ops/mailbox.sh');
      const door = existsSync(laneSh) ? `bash ${JSON.stringify(laneSh)} commit -- ` : '';
      const { MAILBOX_HELD: _held, ...laneEnv } = process.env;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          execSync(`git add ${q}`, { cwd: repoRoot, stdio: 'ignore' });
          execSync(`${door}git commit --no-verify --only ${q} -m ${JSON.stringify('chore(commit-page): publish ' + shaShort)}`, { cwd: repoRoot, stdio: 'ignore', env: laneEnv });
          break;
        } catch (e) {
          if (!/index\.lock/.test(String(e.stderr || e.message || ''))) break;   // a real error (e.g. nothing to commit) → stop
          execSync('sleep 1', { cwd: repoRoot });   // lock contention → back off + retry
        }
      }
      // 2026-10-18 (CLAUDE.md GOAL): "the next commit sweeps it" below was exactly the leak — eleven
      // commit-panel PNGs sat staged in the shared index this way on 2026-10-18 (see scripts/ops/commit-own.sh).
      // If the loop above did not land (broke on a real error, or exhausted its retries), `q` is still staged
      // with a diff against the new HEAD; take it back here so an unrelated later commit never inherits it.
      try {
        const stillStaged = execSync(`git diff --cached --name-only -- ${q}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
        if (stillStaged) execSync(`git reset -- ${q}`, { cwd: repoRoot, stdio: 'ignore' });
      } catch { /* best-effort; a miss here is still swept by the next publish's own check */ }
    }
  } catch { /* not a git repo / nothing to commit */ }
  // C649a SIGN THE PANEL IT JUST PUBLISHED: a `panel` row on the flight tape binds the committed PNG (path · sha256 · bytes ·
  // retro: false) to the commit under the host/room key — the bytes read back from the tree at HEAD (W3), never the buffer
  // we hoped landed. A panel that did not land is not signed. Best-effort: signing never blocks publishing.
  try {
    const encPath = `public/commit/${shaShort}/trip-encircled-${shaShort}.png`;
    const committed = execSync(`git cat-file blob ${JSON.stringify('HEAD:' + encPath)}`, { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    if (sha && committed && committed.length) signPanel({ sha, path: encPath, buf: committed, retro: process.env.VNA_PANEL_RETRO === '1', tape: process.env.VNA_FLIGHT_TAPE || path.join(repoRoot, 'data/vna/flight-tape.ndjson') });
  } catch { /* not committed, or no key — the coverage reading counts it unsigned */ }
  return { url: rel, dir, ogImage };
}
