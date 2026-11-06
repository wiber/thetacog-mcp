// scripts/vna/panel-coverage.mjs — C649a MORE SIGNED PANELS: COVERAGE IS A FLOOR THAT ONLY RISES (operator 2026-10-05,
// verbatim: "mkake sure we have more signed panels..").
//
// THE READING, per tape: distinct commits · with a published panel (a PNG for the commit in a tracked panel tree at HEAD —
// panel-carry.mjs PANEL_TREES, the same trees the backup carries from) · with a SIGNED panel · carried in the backup (C647b).
// The commits, published and carried counts are panel-carry.mjs carryPanels()'s own — the manifest's `panels.of` is that
// same function, so the reading and the manifest can never be two counts of one thing.
//
// SIGNED, measured 2026-10-05 before this file: NO flight-tape row bound a panel. The commit row signs the sha, the proofs
// and the drift delta; the PNG the post-commit render publishes afterwards (a separate `chore(commit-page)` commit) was named
// by nothing signed. 0 of 2,136 distinct commits. A panel is now SIGNED when a `panel` row on the tape (flight-tape.mjs
// append, the one door, ed25519 under the host/room key) carries { path, sha256, bytes, retro } for the commit, the row's
// signature verifies, and the sha256 equals the blob at that path in the tree at HEAD (W3: the committed bytes, never the
// working tree). A row whose bytes no longer match the tree is not counted.
//
// CONTEMPORANEOUS vs RETRO (AXIOM 1 W4): publish-commit-page.mjs signs the panel it just committed (retro: false). A panel
// published before C649a, or rendered later for a past commit, is signed ONLY as `retro: true` and counted apart —
// signed.live never includes it, and the floors ratchet the live and retro shares separately.
//
// WHY COMMITS HAD NO PANEL (measured 2026-10-05, 518 of 2,136 tape commits with no panel in any tracked tree):
//   · 401 — the render reached the prior-declaration gate (its trip row exists) and published nothing; all 2026-09-20..24,
//           the llm-pause window, whose render log (.thetacog/punch-list-logs/triptych-<sha8>.log) no longer exists — the
//           exit point is UNMEASURED, not guessed
//   · 101 — encircled-nonempty: an all-dark tolerance shape, suppressed on purpose (direction-only receipt; an honest refusal)
//   ·  13 — rendered to public/commit/<sha>/ on disk, never committed: publish-commit-page.mjs skipped the commit whenever
//           HEAD was ANOTHER render's `chore(commit-page)` commit (a recursion guard reading HEAD instead of the commit it
//           renders) — fixed in the same commit as this file
//   ·   2 — no trace · 1 — a `chore(commit-page)` publish commit itself (skipped by design)
//
// SUFFICIENT FOR: which tape commits have a published, signed, carried panel, and whether that share fell. NOT SUFFICIENT
// FOR: whether any of that work was good (Rice — undecidable), or what an unrendered panel would have shown.
// Port row: C649a-port — the reading decides a coverage share and a floor (engine-map authority column): moves to the crate
// once the panel row has a season of use.
// @guard tests/vna/c649a-signed-panel-coverage-ratchet.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { carryPanels, panelFilesAtHead, blobsAtHead, isPng } from './panel-carry.mjs';
import { append, verifyRow } from './flight-tape.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const FLOORS_FILE = 'data/vna/panel-coverage-floors.json';
export const RETRO_CAP = 200;   // a back-sign run signs at most this many past panels (bounded; never in the hook path)

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const tapeOf = (repo, tape) => tape || resolve(repo, 'data/vna/flight-tape.ndjson');
const share = (n, d) => (d > 0 ? Math.round((n / d) * 1e6) / 1e6 : 0);

/** the row fields a panel binding appends — the commit sha, and the PNG's path, sha256 and size inside the signed proofs */
export function panelRowFields({ sha, path, buf, retro, room = null, why = null }) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha || ''))) throw new Error('panelRowFields: sha must be a commit sha');
  if (!isPng(buf)) throw new Error('panelRowFields: the panel bytes are not a PNG');
  if (typeof retro !== 'boolean') throw new Error('panelRowFields: retro must be said, true or false (W4)');
  return { kind: 'panel', sha: String(sha).toLowerCase(), room, proofs: { panel: { path, sha256: sha256(buf), bytes: buf.length, retro, ...(why ? { why } : {}) } }, delta: null };
}

/** sign one panel onto the tape through the one append door; unstamped (a binding, never a licence spend) */
export function signPanel({ sha, path, buf, retro, room = null, why = null, tape }) {
  return append(panelRowFields({ sha, path, buf, retro, room, why }), tape, { claims: null });
}

/** commit sha (lowercase) → { live, retro } for every panel row that verifies AND whose sha256 is the blob at HEAD */
export function signedPanels({ repo = REPO, tape } = {}) {
  const rows = nd(tapeOf(repo, tape)).filter((r) => r.kind === 'panel' && r.sha && r.proofs && r.proofs.panel);
  const good = rows.filter((r) => { const v = verifyRow(r); return v.ok && v.signed; });
  const blobs = blobsAtHead(repo, [...new Set(good.map((r) => r.proofs.panel.path))]);
  const out = new Map();
  for (const r of good) {
    const b = blobs.get(r.proofs.panel.path); if (!b || sha256(b) !== r.proofs.panel.sha256) continue;
    const k = String(r.sha).toLowerCase(); const e = out.get(k) || { live: false, retro: false };
    if (r.proofs.panel.retro === false) e.live = true; else e.retro = true;
    out.set(k, e);
  }
  return out;
}

/**
 * THE READING. → { commits, published, signed: { live, retro, total }, carried, share: { published, signed, signed_live, signed_retro } }
 * commits/published/carried are carryPanels().of (the manifest's own counts); signed counts only tape commits.
 */
export function panelCoverage({ repo = REPO, tape, budget, max } = {}) {
  const t = tapeOf(repo, tape);
  const c = carryPanels({ repo, tape: t, budget, max });
  const commitShas = new Set(nd(t).filter((r) => r.kind === 'commit' && typeof r.sha === 'string' && /^[0-9a-f]{10,40}$/i.test(r.sha)).map((r) => r.sha.toLowerCase()));
  const signed = { live: 0, retro: 0, total: 0 };
  for (const [k, e] of signedPanels({ repo, tape: t })) {
    if (!commitShas.has(k)) continue;
    if (e.live) signed.live++; else if (e.retro) signed.retro++;   // a commit with a live row is live; retro only when no live row exists
    signed.total++;
  }
  const commits = c.of.commits, published = c.of.in_repo ?? 0;
  return { commits, published, signed, carried: c.of.carried, share: { published: share(published, commits), signed: share(signed.total, commits), signed_live: share(signed.live, commits), signed_retro: share(signed.retro, commits) }, ...(c.why ? { why: c.why } : {}) };
}

/** the reading's counts against a backup manifest's `panels.of` — [] when they agree; a manifest without `of` is UNMEASURED */
export function differsFromManifest(reading, manifest) {
  const of = manifest && manifest.panels && manifest.panels.of;
  if (!of) return ['UNMEASURED — the manifest carries no panels.of (written before C647b)'];
  const out = [];
  if (of.commits !== reading.commits) out.push(`commits ${reading.commits} ≠ manifest ${of.commits}`);
  if (of.in_repo !== reading.published) out.push(`published ${reading.published} ≠ manifest in_repo ${of.in_repo}`);
  if (of.carried !== reading.carried) out.push(`carried ${reading.carried} ≠ manifest ${of.carried}`);
  return out;
}

/** sign published-but-unsigned panels for past commits as retro: true, newest first, at most `cap` */
export function signRetro({ repo = REPO, tape, cap = RETRO_CAP } = {}) {
  const t = tapeOf(repo, tape);
  const files = panelFilesAtHead(repo); if (!files) return { signed: 0, cap, why: 'no HEAD tree' };
  const done = signedPanels({ repo, tape: t });
  const shas = [...new Set(nd(t).filter((r) => r.kind === 'commit' && typeof r.sha === 'string' && /^[0-9a-f]{10,40}$/i.test(r.sha)).map((r) => r.sha.toLowerCase()))].reverse();
  const todo = [];
  for (const full of shas) {
    if (todo.length >= cap) break; if (done.has(full)) continue;
    let name = null; for (let n = Math.min(40, full.length); n >= 7 && !name; n--) if (files.has(full.slice(0, n))) name = full.slice(0, n);
    if (!name) continue;
    const pick = files.get(name).filter((f) => f.bytes > 0).sort((a, b) => a.bytes - b.bytes)[0]; if (pick) todo.push({ sha: full, path: pick.path });
  }
  const blobs = blobsAtHead(repo, todo.map((x) => x.path)); let signed = 0;
  for (const x of todo) { const b = blobs.get(x.path); if (!isPng(b)) continue; signPanel({ sha: x.sha, path: x.path, buf: b, retro: true, why: 'signed after the fact (C649a back-sign) — the panel was published before its commit had a panel row', tape: t }); signed++; }
  return { signed, cap, candidates: todo.length };
}

/** floors only rise: each share is max(committed floor, reading) */
export function ratchetFloors(reading, prior = null) {
  const p = (prior && prior.floors) || {};
  const floors = {}; for (const k of ['published', 'signed', 'signed_live', 'signed_retro']) floors[k] = Math.max(Number(p[k]) || 0, reading.share[k]);
  return { v: 1, floors, reading: { commits: reading.commits, published: reading.published, signed: reading.signed, carried: reading.carried }, note: 'C649a — shares of distinct tape commits; a floor only rises; signed_live never counts a retro row (AXIOM 1 W4)' };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const out = {};
  if (a.includes('--sign-retro')) out.retro = signRetro({ cap: Number(arg('--sign-retro')) || RETRO_CAP });
  const r = panelCoverage(); out.reading = r;
  const m = arg('--manifest'); if (m) out.manifest_diff = differsFromManifest(r, JSON.parse(readFileSync(m, 'utf8')));
  if (a.includes('--ratchet')) {
    const f = resolve(REPO, FLOORS_FILE); let prior = null; try { prior = JSON.parse(readFileSync(f, 'utf8')); } catch {}
    const next = ratchetFloors(r, prior); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(next, null, 2) + '\n'); out.floors = next.floors;
  }
  if (a.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`panels: ${r.commits} distinct commits · ${r.published} published (${(r.share.published * 100).toFixed(1)}%) · ${r.signed.total} signed (${r.signed.live} live · ${r.signed.retro} retro, counted apart) · ${r.carried} carried in the backup`);
    if (out.retro) console.log(`back-signed ${out.retro.signed} past panels as retro (cap ${out.retro.cap})`);
    if (out.manifest_diff) console.log(out.manifest_diff.length ? `differs from manifest: ${out.manifest_diff.join(' · ')}` : 'matches the manifest');
  }
}
