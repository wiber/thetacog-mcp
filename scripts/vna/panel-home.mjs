// scripts/vna/panel-home.mjs — C506 THE PANELS LIVE WHERE THE HOLDER PUBLISHES THEM (operator 2026-09-30, verbatim: "the upload
// needs to be configurable to where the git storage of the panels are expected (file names on the tape?) so you can see the tape
// of the panels next to the graphs) .. guess the vsx needs to know if you have a fork of thetacog where you publish your panels").
//
// A licence holder's encircled panels are committed in THEIR repository (the hook writes public/commit/<sha10>/trip-encircled-
// <sha10>.png and git IS the publication) — never on our site. This is the ONE resolver of where they are served from:
//   1. `.thetacog/panel-home.json` (or an explicit override: the extension's `thetacog.panelHome` setting) → { base, pattern, tree? }
//   2. else DERIVED from `git remote get-url origin`: a GitHub remote → https://raw.githubusercontent.com/<owner>/<repo>/<branch>/
//      + the pattern this repo's hook writes (the served path and the tree path are then the same string)
//   3. else UNMEASURED with the reason — never a guess at our domain for someone else's repository.
// `pattern` is the path under `base` a browser fetches; `tree` is the path in the git tree at HEAD (they differ only when a
// site serves public/ at its root, as thetadriven.com does for ours). Both carry `{sha10}`, the placeholder panelSrc fills
// (src/lib/backup/deployed-tapes.mjs).
//
// panelsManifest() is what backup.mjs writes as `panels: { base, pattern, source, present }`: `present` is the commit rows on the
// tape whose panel file EXISTS in the git tree at HEAD (`git ls-tree`), so the page never probes a URL that was never published.
// LLM-free, and no network EXCEPT the one C647n visibility check `repo` mode runs (checkRepoVisibility, an anonymous ls-remote);
// everything else is a pure function of the working copy's git config and HEAD tree.
//
//   node scripts/vna/panel-home.mjs [--json]     print the resolved home for this repository
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const PANEL_HOME_FILE = '.thetacog/panel-home.json';
export const SHA_SLOT = '{sha10}';
// the path the post-commit hook writes each encircled panel to (tracked on purpose — tests/ops/commit-panels-are-published)
export const HOOK_PATTERN = `public/commit/${SHA_SLOT}/trip-encircled-${SHA_SLOT}.png`;
export const UPSTREAM_OWNER = 'wiber';

const git = (repo, args) => { try { return execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).toString().trim(); } catch { return null; } };

/** A GitHub remote (https or ssh) → { host, owner, repo }; anything else → null. */
export function parseGithubRemote(url) {
  const s = String(url || '').trim();
  const m = s.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? { host: 'github.com', owner: m[1], repo: m[2] } : null;
}

/** Read off the remote: a repository named for thetacog, owned by someone other than the upstream owner, is a fork of thetacog. */
export function isThetacogFork(gh) {
  return !!(gh && /thetacog/i.test(gh.repo) && gh.owner.toLowerCase() !== UPSTREAM_OWNER);
}

const validBase = (b) => typeof b === 'string' && /^https:\/\/[^\s"'<>]+\/$/.test(b);
const validPattern = (p) => typeof p === 'string' && p.includes(SHA_SLOT) && !/\.\.|^\/|:|[\s"'<>]/.test(p);

/** Normalise an override: a JSON object { base, pattern?, tree? } or a bare base URL string. Returns { home } or { why }. */
export function normaliseOverride(o) {
  let v = o;
  if (typeof v === 'string') { const t = v.trim(); if (!t) return null; if (t.startsWith('{')) { try { v = JSON.parse(t); } catch { return { why: 'the panel home override is not valid JSON' }; } } else v = { base: t }; }
  if (!v || typeof v !== 'object') return null;
  const base = typeof v.base === 'string' && v.base && !v.base.endsWith('/') ? `${v.base}/` : v.base;
  const pattern = v.pattern || HOOK_PATTERN; const tree = v.tree || pattern;
  if (!validBase(base)) return { why: `the panel home override's base is not an https URL: ${JSON.stringify(v.base)}` };
  if (!validPattern(pattern) || !validPattern(tree)) return { why: `the panel home override's pattern must be a relative path carrying ${SHA_SLOT}` };
  return { home: { base, pattern, tree } };
}

/**
 * The panel home for a repository: { status:'MEASURED', base, pattern, tree, source, remote, fork } or
 * { status:'UNMEASURED', why, base:null, pattern:null, tree:null, source:null, remote, fork }.
 * `override` (the extension setting) wins over the json file; the json file wins over the remote.
 */
export function resolvePanelHome({ repo = REPO, override = process.env.VNA_PANEL_HOME } = {}) {   // VNA_PANEL_HOME: the extension's thetacog.panelHome setting, carried on every spawn
  const remote = git(repo, ['remote', 'get-url', 'origin']);
  const gh = parseGithubRemote(remote);
  const fork = isThetacogFork(gh);
  const out = (h, source) => ({ status: 'MEASURED', base: h.base, pattern: h.pattern, tree: h.tree, source, remote, fork });
  const none = (why) => ({ status: 'UNMEASURED', why, base: null, pattern: null, tree: null, source: null, remote, fork });
  if (override !== undefined && override !== null && override !== '') {
    const n = normaliseOverride(override); if (n && n.home) return out(n.home, 'setting'); if (n && n.why) return none(n.why);
  }
  const file = resolve(repo, PANEL_HOME_FILE);
  if (existsSync(file)) {
    let j = null; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { return none(`${PANEL_HOME_FILE} is not valid JSON`); }
    const n = normaliseOverride(j); if (n && n.home) return out(n.home, PANEL_HOME_FILE); return none(n && n.why ? n.why : `${PANEL_HOME_FILE} names no base`);
  }
  if (!remote) return none(`no origin remote and no ${PANEL_HOME_FILE} — the panels have no place to be served from`);
  if (!gh) return none(`origin ${remote} is not a GitHub remote and no ${PANEL_HOME_FILE} names where its panels are served — set { "base": "https://…/" } there`);
  const d = originRawHome(repo, gh); if (d.why) return none(d.why);
  return out(d.home, 'origin');
}

/** The holder's own GitHub raw address, derived from the origin remote + the branch HEAD is on: { home } or { why }. */
export function originRawHome(repo, gh) {
  const branch = git(repo, ['symbolic-ref', '--short', 'HEAD']);
  if (!branch) return { why: 'HEAD is detached — no branch names where the panels are pushed; set a base in ' + PANEL_HOME_FILE };
  return { home: { base: `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${branch}/`, pattern: HOOK_PATTERN, tree: HOOK_PATTERN } };
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The sha names whose panel file is in the git tree at HEAD, read with one `git ls-tree` under the pattern's fixed prefix. */
export function panelNamesInTree({ repo = REPO, tree = HOOK_PATTERN } = {}) {
  const prefix = tree.slice(0, tree.indexOf(SHA_SLOT)); const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/') + 1) : '';
  const listing = git(repo, ['ls-tree', '-r', '--name-only', 'HEAD', ...(dir ? ['--', dir] : [])]);
  if (listing == null) return null;   // no HEAD / not a repo → unmeasured, never an empty set
  const [a, ...rest] = tree.split(SHA_SLOT);
  const re = new RegExp(`^${reEscape(a)}([0-9a-f]{7,40})${rest.map((r) => `${reEscape(r)}`).join('\\1')}$`);
  const names = new Set(); for (const line of listing.split('\n')) { const m = line.match(re); if (m) names.add(m[1]); }
  return names;
}

/** Which commit shas (tape order) have a published panel: the name as it sits in the tree (a legacy dir may be 9 hex). */
export function presentShas(shas, names) {
  const out = []; const seen = new Set();
  for (const s of shas || []) {
    const full = String(s || '').toLowerCase(); if (!/^[0-9a-f]{7,40}$/.test(full)) continue;
    let hit = null; for (let n = 10; n >= 7 && !hit; n--) if (names.has(full.slice(0, n))) hit = full.slice(0, n);
    if (hit && !seen.has(hit)) { seen.add(hit); out.push(hit); }
  }
  return out;
}

const commitShas = (tapePath) => { try { return readFileSync(tapePath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.kind === 'commit' && typeof r.sha === 'string').map((r) => r.sha); } catch { return []; } };

// ── C647n THE `thetacog.panels.home` SETTING (operator 2026-10-05, verbatim: "do we need to have a setting in the vsx for the
// opensource repo ? and store the encircled panel there?"). Three values, one rule each:
//   backup (default) — what C647b built: the archive carries the PNGs, the store serves them; the configured base (setting /
//                      .thetacog/panel-home.json / origin) stays the optional second source, unchanged.
//   repo             — backup, PLUS the holder's own GitHub raw URL as the second address — ONLY when checkRepoVisibility()
//                      says that repository is public. A private repo's raw URL loads for nobody else, so it is never named;
//                      a check that cannot answer is UNMEASURED and names nothing. Visibility is never read off a file, a
//                      field, an env var or a guess — only off the check, run at backup time.
//   off              — carries nothing and names no address; the slider says the holder turned panels off.
// The extension contributes the setting (packages/thetacog-mcp-vscode/package.json); it reaches this module as VNA_PANELS_HOME
// on the spawn, or from the workspace's .vscode/settings.json when backup.mjs is run by hand.
// @guard tests/vna/c647n-panels-home-setting.test.mjs
export const PANELS_HOME_SETTING = 'thetacog.panels.home';
export const PANELS_HOME_MODES = Object.freeze(['backup', 'repo', 'off']);
export const PANELS_HOME_DEFAULT = 'backup';
export const PANELS_OFF_WHY = `panels off — ${PANELS_HOME_SETTING} is "off": this backup carries no panel and names no address`;

const workspaceSetting = (repo) => {
  try {
    const raw = readFileSync(resolve(repo, '.vscode/settings.json'), 'utf8')
      .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str || '')   // JSONC: comments out, strings kept
      .replace(/,(\s*[}\]])/g, '$1');
    const v = JSON.parse(raw)[PANELS_HOME_SETTING]; return typeof v === 'string' ? v : undefined;
  } catch { return undefined; }
};

/** The mode in force: { mode, source, why? } — env (the extension's spawn) → workspace settings → the default. Unknown → default, said. */
export function panelsHomeMode({ repo = REPO, mode = process.env.VNA_PANELS_HOME } = {}) {
  let v = typeof mode === 'string' && mode.trim() ? mode.trim().toLowerCase() : undefined; let source = v ? 'setting' : null;
  if (!v) { const w = workspaceSetting(repo); if (typeof w === 'string' && w.trim()) { v = w.trim().toLowerCase(); source = '.vscode/settings.json'; } }
  if (!v) return { mode: PANELS_HOME_DEFAULT, source: 'default' };
  if (!PANELS_HOME_MODES.includes(v)) return { mode: PANELS_HOME_DEFAULT, source: 'default', why: `${PANELS_HOME_SETTING} ${JSON.stringify(v)} is not one of ${PANELS_HOME_MODES.join(' · ')} — read as ${PANELS_HOME_DEFAULT}` };
  return { mode: v, source };
}

const PRIVATE_SIGNS = /repository not found|could not read username|terminal prompts disabled|authentication failed|access denied/i;
/**
 * THE visibility check: an anonymous `git ls-remote` of the repository — exactly what a stranger's browser can read. Global and
 * system git config are switched off (no credential helper, no insteadOf rewrite to ssh, no keychain), prompts disabled.
 * → { visibility: 'public' | 'private' | 'UNMEASURED', checked: 'anonymous git ls-remote <url>', why? }
 * `url` exists so a test can point the same check at a scratch repository; production passes the GitHub https URL.
 */
export function checkRepoVisibility(gh, { url, timeoutMs = 10_000 } = {}) {
  const target = url || (gh && gh.owner && gh.repo ? `https://github.com/${gh.owner}/${gh.repo}.git` : null);
  if (!target) return { visibility: 'UNMEASURED', checked: null, why: 'no repository to check' };
  const checked = `anonymous git ls-remote ${target}`;
  try {
    execFileSync('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', target], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GCM_INTERACTIVE: 'never' },
    });
    return { visibility: 'public', checked };
  } catch (e) {
    const err = String((e && e.stderr) || (e && e.message) || e);
    if (PRIVATE_SIGNS.test(err)) return { visibility: 'private', checked, why: err.trim().split('\n').pop() };
    return { visibility: 'UNMEASURED', checked, why: `the check could not answer: ${err.trim().split('\n').pop() || 'no output'}` };
  }
}

const RAW_GH = /^https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\//;

/**
 * The manifest's `panels` field: { base, pattern, source, present: [sha10…] } — or, when the home is unmeasured,
 * { base:null, pattern:null, source:null, present:[], why } so the page says why instead of guessing.
 * C647n: + home (the mode in force); in `repo` mode + visibility (the check's verdict, never anything else); `off` names nothing.
 * `visibility` is the check — injectable so a test can run it without the network; it is ONLY ever called, never bypassed.
 */
export function panelsManifest({ repo = REPO, tape = resolve(repo, 'data/vna/flight-tape.ndjson'), override = process.env.VNA_PANEL_HOME, mode, visibility = checkRepoVisibility } = {}) {
  const m = panelsHomeMode({ repo, mode });
  const said = m.why ? { mode_why: m.why } : {};
  if (m.mode === 'off') return { home: 'off', base: null, pattern: null, source: null, present: [], why: PANELS_OFF_WHY, ...said };
  if (m.mode === 'repo') return { home: 'repo', ...repoManifest({ repo, tape, visibility }), ...said };
  return { home: 'backup', ...homeManifest({ repo, tape, override }), ...said };
}

/** `repo` mode: the holder's GitHub raw address from the origin remote, named ONLY when the visibility check says public. */
function repoManifest({ repo, tape, visibility }) {
  const remote = git(repo, ['remote', 'get-url', 'origin']); const gh = parseGithubRemote(remote);
  const none = (why, v = null) => ({ base: null, pattern: null, source: null, present: [], visibility: v, why });
  if (!gh) return none(`${PANELS_HOME_SETTING} is "repo", but origin ${remote ? 'is not a GitHub remote' : 'is not set'} — no repository raw address to check, so none is named; the panels ride in the backup`);
  const d = originRawHome(repo, gh); if (d.why) return none(d.why);
  const raw = d.home.base.match(RAW_GH);
  let v; try { v = typeof visibility === 'function' ? visibility({ owner: raw[1], repo: raw[2] }) : null; } catch (e) { v = { visibility: 'UNMEASURED', why: String((e && e.message) || e) }; }
  const verdict = v && ['public', 'private', 'UNMEASURED'].includes(v.visibility) ? v.visibility : 'UNMEASURED';
  const checked = v && typeof v.checked === 'string' ? { visibility_checked: v.checked } : {};
  if (verdict !== 'public') {
    const word = verdict === 'private' ? 'private' : 'UNMEASURED (the visibility check did not answer)';
    return { ...none(`${PANELS_HOME_SETTING} is "repo", but ${raw[1]}/${raw[2]} is ${word} — its raw URL would load for nobody else, so none is named; the panels ride in the backup`, verdict), ...checked };
  }
  const names = panelNamesInTree({ repo, tree: d.home.tree });
  if (names == null) return { base: d.home.base, pattern: d.home.pattern, source: 'origin', present: [], visibility: 'public', ...checked, why: 'no HEAD tree to read the published panels from' };
  return { base: d.home.base, pattern: d.home.pattern, source: 'origin', present: presentShas(commitShas(tape), names), visibility: 'public', ...checked };
}

/** `backup` mode's optional second address — C506/C647b unchanged. */
function homeManifest({ repo, tape, override }) {
  const home = resolvePanelHome({ repo, override });
  if (home.status !== 'MEASURED') return { base: null, pattern: null, source: null, present: [], why: home.why };
  const names = panelNamesInTree({ repo, tree: home.tree });
  if (names == null) return { base: home.base, pattern: home.pattern, source: home.source, present: [], why: 'no HEAD tree to read the published panels from' };
  return { base: home.base, pattern: home.pattern, source: home.source, present: presentShas(commitShas(tape), names) };
}

/** One line for the extension tooltip: where the panels are served from, and whether this is a fork of thetacog. */
export function panelHomeLine(home) {
  const forkWord = home.fork ? 'a fork of thetacog' : 'not a fork of thetacog';
  // the remote URL itself stays off the line (it lands in the README's controls section — C163: no private repo path there);
  // the fork verdict is what was read off it, and a derived base already names the holder's owner/repo
  return home.status === 'MEASURED'
    ? `panels served from ${home.base}${home.pattern} (${home.source === 'origin' ? 'derived from your git origin' : home.source}) · ${forkWord} (read off the origin remote)`
    : `panel home UNMEASURED — ${home.why} · ${forkWord}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = resolvePanelHome();
  console.log(process.argv.includes('--json') ? JSON.stringify(home) : panelHomeLine(home));
}
