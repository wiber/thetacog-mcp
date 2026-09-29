// packages/thetacog-mcp/scripts/tape/last-action-panel.mjs — WHICH PANEL IS THE OPERATOR'S LAST ACT.
//
// ── THE BUG THIS REPLACES (operator, 2026-08-20) ──────────────────────────────────────────────
// "the canonical panel is hilariously stuck on one single png instead of the encircled for the
// last action (lol not funny), mixing new and old components on the page."
//
// The cockpit's top slot was canonicalPanel() — THE NEWEST PUBLISHED COMMIT PANEL REPO-WIDE. With
// nine rooms committing on one tree, that slot showed whatever lane last published (ffd7829ae, a
// pmu-lens commit with nothing to do with the tape) and never the operator's own act. A repo-wide
// newest is a fine CONTROL (it proves the display path) and a terrible MIRROR (it reflects someone
// else's work). This module is the mirror; canonicalPanel stays as the labelled control.
//
// ── RESOLUTION ORDER — the last act, and nothing that is not the last act ─────────────────────
//   a. the commit a dispatched agent produced for the MOST RECENT locked coordinate — its published
//      public/commit/<sha>/trip-encircled-<sha>.png. The true intent→reality delta of the loop, and
//      DENSE, because a real commit has a real diff.
//   b. else the decision receipt for that coordinate
//      (.thetacog/tape-sessions/<slug>/html/receipts/<id>.png), carrying the admissibility flag the
//      lock recorded — a flagged panel is shown AS flagged, never as proof.
//   c. else ok:false naming exactly what was searched.
//   NEVER "newest panel repo-wide" — that is the bug, and the guard's negative control seeds a
//   newer unrelated panel and asserts this module ignores it.
//
// ── WHY THE COMMIT SHAs ARE VERIFIED, NOT TRUSTED ─────────────────────────────────────────────
// The dispatch→commit link is a regex over agent stdout (/[0-9a-f]{7,40}/ in api/lock). MEASURED
// false positive on this session's own tape: cli-events.ndjson records commits
// ["84c0fa22","196486d89f86","41644499999999995"] for COORD-012 — the third is a decimal number
// from the agent's prose that happens to be hex-alphabet. So a candidate sha counts only if
// (1) its published panel actually exists on disk, and (2) git can verify it as a commit when git
// is available (git unavailable → the panel file's existence is the evidence, and origin says so).
//
//   node packages/thetacog-mcp/scripts/tape/last-action-panel.mjs [--slug s] [--json] [--no-data-uri]
//
// @guard tests/tape/panel-shows-the-last-action.test.mjs

import { existsSync, readFileSync, statSync } from 'node:fs';
// git via the resolver — a bare 'git' is Apple's licence-gated xcrun stub and dies silently
// in any process without DEVELOPER_DIR (see git-bin.mjs; it cost 17 of 26 coordinates their owns[]).
import { git } from './git-bin.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { liveCoordinates } from './coordinates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(HERE, '..', '..', '..', '..');

function readEvents(sessions, slug) {
  const p = resolve(sessions, slug, 'cli-events.ndjson');
  if (!existsSync(p)) return { events: [], path: p };
  const events = String(readFileSync(p, 'utf8')).split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { events, path: p };
}

/** null = git unavailable / not a repo (cannot say) · true/false = verified answer. */
function gitVerifiesCommit(repo, sha) {
  try {
    const v = git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] });
    // THREE-VALUED, and it must stay that way: true = git confirms · false = git looked and denies
    // (exit 1) · null = git never looked. Collapsing the last two into null would let a regex
    // false-positive sha through as merely "unverified" instead of rejected.
    if (v.ok) return true;
    return v.status === 1 ? false : null;
    return true;
  } catch (e) {
    // exit 1 = git ran and said "not a commit"; anything else (exit 69 licence, ENOENT, not a repo)
    // = git could not answer, which is not the same thing and must not veto a real panel.
    return e?.status === 1 ? false : null;
  }
}

function panelFor(repo, sha) {
  for (const [rel, origin] of [
    [`public/commit/${sha}/trip-encircled-${sha}.png`, 'public/commit (web-servable)'],
    [`docs/pmu/commit-panels/${sha}-encircled.png`, 'docs/pmu/commit-panels (archive)'],
  ]) {
    const p = resolve(repo, rel);
    if (existsSync(p)) return { path: p, rel, origin };
  }
  return null;
}

function withImage(base, path, { dataUri = true } = {}) {
  const buf = readFileSync(path);
  return {
    ...base, bytes: buf.length, mtimeMs: statSync(path).mtimeMs,
    dataUri: dataUri ? `data:image/png;base64,${buf.toString('base64')}` : null,
  };
}

/**
 * Resolve the panel for the operator's last act. Pure function of the session ledger + disk —
 * no LLM, no repo-wide scan, deterministic for a given tape state.
 */
export function resolveLastActionPanel({
  slug = 'gddadwill',
  repo = DEFAULT_REPO,
  sessions = process.env.TAPE_SESSIONS_DIR || resolve(DEFAULT_REPO, '.thetacog/tape-sessions'),
  dataUri = true,
} = {}) {
  const searched = [];
  const { events, path: eventsPath } = readEvents(sessions, slug);
  searched.push(eventsPath.replace(repo + '/', ''));
  if (!events.length) {
    return { ok: false, slug, searched, unmeasured: `no cli-events.ndjson for "${slug}" — no act has been announced on this tape yet` };
  }

  // ── THE NEWEST LOCK THAT IS STILL A LIVE COORDINATE ─────────────────────────────────────────
  // "Most recent lock event" is not the same as "the operator's last decision", and the difference
  // is not hypothetical. cli-events.ndjson is an announcement log: a lock event is written once and
  // never revised, so a coordinate that has since been RETIRED still has its lock sitting at the
  // top of this file forever. The action slot served exactly that — a retired coordinate's receipt,
  // presented as the last act — until the operator said the panel was wrong.
  //
  // api/question already carries this scar in its own comment ("conflating them served a corpse for
  // two hours") and was fixed to skip retired asks. This reader never got the same fix. That makes
  // three separate readers of one truth diverging in this repo in a single day, which is the
  // argument for the shared-resolver rule rather than another local patch: the ledger, not the
  // announcement log, is what says whether a coordinate is still real.
  let live = null;
  // An empty or unreadable ledger means liveness is UNKNOWN, not that every coordinate is retired.
  // Fixtures and fresh sessions have no coordinates.ndjson at all; treating that as "all retired"
  // made the slot report nothing for a tape that plainly has acts on it.
  try { const ids = liveCoordinates(slug).map((c) => c.id); live = ids.length ? new Set(ids) : null; }
  catch { live = null; }
  const locks = [...events].reverse().filter((e) => e.kind === 'lock' && e.id);
  // A null `live` means the ledger was unreadable — fall back to the newest lock rather than
  // rendering nothing, because an unreadable ledger is a different failure from a retired decision.
  const lock = (live ? locks.find((e) => live.has(e.id)) : null) || (live ? null : locks[0]);
  if (!lock) {
    return {
      ok: false, slug, searched,
      unmeasured: locks.length
        ? `${locks.length} lock event(s) on this tape but none names a coordinate that is still live — every one has been retired or superseded`
        : `cli-events.ndjson has ${events.length} event(s) but none is a lock carrying a coordinate id`,
    };
  }

  // ── a · the dispatched agent's commit for that coordinate ──────────────────────────────────
  // Newest dispatch-done first, its commits in reported order; a sha counts only with its panel
  // on disk and git not actively denying it.
  const dones = events.filter((e) => e.kind === 'dispatch-done' && e.id === lock.id && Array.isArray(e.commits) && e.commits.length).reverse();
  const rejected = [];
  for (const d of dones) {
    for (const sha of d.commits) {
      if (!/^[0-9a-f]{7,40}$/.test(String(sha))) { rejected.push(`${sha} (not a sha)`); continue; }
      const hit = panelFor(repo, sha);
      if (!hit) { rejected.push(`${sha} (no published panel — publish-commit-page.mjs lags the tape)`); continue; }
      const verified = gitVerifiesCommit(repo, sha);
      if (verified === false) { rejected.push(`${sha} (panel on disk but git says it is not a commit — a regex false positive)`); continue; }
      let subject = null;
      { const s2 = git(['log', '-1', '--format=%s', sha], { cwd: repo }); subject = s2.ok ? s2.out.trim() : null; }
      return withImage({
        ok: true, slug, kind: 'dispatched-commit', id: lock.id, coord: lock.coord ?? null, sha, subject,
        file: hit.rel,
        origin: `${hit.origin} — the commit the dispatched agent produced for ${lock.id}${verified === null ? ' (git could not verify the sha; the published panel on disk is the evidence)' : ''}`,
        admissible: true, notAdmissible: null,
      }, hit.path, { dataUri });
    }
  }
  searched.push(`public/commit/<sha>/trip-encircled-<sha>.png + docs/pmu/commit-panels/<sha>-encircled.png for dispatch-done commits of ${lock.id}${rejected.length ? ` — rejected: ${rejected.join(' · ')}` : dones.length ? '' : ' — no dispatch-done event carries commits for it'}`);

  // ── b · the coordinate's own decision receipt ──────────────────────────────────────────────
  const receiptRel = `${sessions.replace(repo + '/', '')}/${slug}/html/receipts/${lock.id}.png`;
  const receipt = resolve(sessions, slug, 'html', 'receipts', `${lock.id}.png`);
  searched.push(receiptRel);
  if (existsSync(receipt)) {
    return withImage({
      ok: true, slug, kind: 'decision', id: lock.id, coord: lock.coord ?? null, sha: null,
      subject: lock.line || null, file: receiptRel, origin: `the decision receipt the lock rendered for ${lock.id}`,
      // The flag the lock recorded rides along — a below-floor panel is shown AS flagged, never as proof.
      admissible: lock.admissible ?? null,
      notAdmissible: lock.notAdmissible ?? (lock.admissible === false ? 'the lock recorded admissible:false without a reason (older event format)' : null),
    }, receipt, { dataUri });
  }

  // ── c · nothing, with the search named ─────────────────────────────────────────────────────
  return {
    ok: false, slug, kind: null, id: lock.id, coord: lock.coord ?? null, searched,
    admissible: lock.admissible ?? null, notAdmissible: lock.notAdmissible ?? null,
    unmeasured: `${lock.id} is the last locked coordinate but no panel exists for it: no dispatched commit has a published panel and no decision receipt was rendered${lock.admissible === false ? ` — the lock refused to render (${lock.notAdmissible || 'inadmissible pair'})` : ''}. Searched: ${searched.join(' · ')}`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // A --json CLI must not let exit() truncate the pipe at ~8188 bytes (measured; see lock-and-attest.mjs).
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const res = resolveLastActionPanel({ slug: arg('--slug', 'gddadwill'), dataUri: !process.argv.includes('--no-data-uri') });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(res)); process.exit(res.ok ? 0 : 1); }
  if (res.ok) {
    console.log(`\n  LAST ACTION · ${res.kind} · ${res.id}${res.sha ? ` · commit ${res.sha}` : ''}`);
    console.log(`  ${res.file} (${res.bytes} bytes) · admissible ${res.admissible}${res.notAdmissible ? ` — ${res.notAdmissible.slice(0, 140)}` : ''}\n`);
  } else {
    console.log(`\n  NO LAST-ACTION PANEL — ${res.unmeasured}\n`);
  }
  process.exit(res.ok ? 0 : 1);
}
