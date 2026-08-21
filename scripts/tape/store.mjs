// packages/thetacog-mcp/scripts/tape/store.mjs
// ════════════════════════════════════════════════════════════════════════════
// SESSION STATE ON DISK — the foundation every other /tape module reads and
// writes through. Forks the discipline of scripts/rewrite/store.mjs:
//
//   - ATOMIC WRITES: every JSON write is tmp-file + renameSync, never a direct
//     overwrite — a torn session.json loses the whole console mid-render.
//   - APPEND-ONLY NDJSON LEDGERS: specs/decisions/dispatches/vega are never
//     rewritten in place. An "edit" to a spec atom appends a NEW row carrying
//     parent_id (fork-forward) — the old row is superseded, never mutated.
//   - EVERY MUTATION IS WRITTEN THROUGH IMMEDIATELY. Next.js hot-reload
//     discards module state on every edit; there is no in-memory cache here
//     that a dev-server reload could lose.
//   - EVERY READ OF A MISSING FILE RETURNS AN HONEST EMPTY ([] / null), never
//     throws, never fabricates a session that doesn't exist.
//
// Session dir: <REPO_ROOT>/.thetacog/tape-sessions/<slug>/ — REPO_ROOT is
// resolved by walking up from process.cwd() to the nearest ancestor
// containing .git (NOT this package's own directory, since Next/CLI/serve.mjs
// can all be invoked from different cwds). Override with env
// TAPE_SESSIONS_DIR to pin an exact sessions root (tests use this to avoid
// touching the real repo tree).
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

// ── REPO ROOT RESOLUTION ────────────────────────────────────────────────────
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir; // fallback: cwd itself, honest degradation rather than a throw
}

export function sessionsDir() {
  if (process.env.TAPE_SESSIONS_DIR) return process.env.TAPE_SESSIONS_DIR;
  const root = findRepoRoot(process.cwd());
  return path.join(root, '.thetacog', 'tape-sessions');
}

/**
 * SOURCES ARE ALWAYS STORED ABSOLUTE (TAPE-CONTRACT.md pins "/abs/path/..."), and this is the
 * ONE place that is enforced. Both API doors answer `doc` by resolving the requested source to
 * an absolute path and checking it against session.sources; a session opened with a RELATIVE
 * path therefore never matches, and the console's tape view fails permanently with "source is
 * not part of this session" — observed live on a session opened as
 * 'docs/05-content/blog/scratchpad/GDDadwill.txt'. Normalising at the door beats teaching every
 * comparison site to be lenient.
 */
export function absSource(s) {
  const str = String(s || '');
  if (!str) return str;
  return path.isAbsolute(str) ? path.normalize(str) : path.resolve(findRepoRoot(process.cwd()), str);
}

export function sessionPath(slug) {
  return path.join(sessionsDir(), slug);
}

function ensureSessionDir(slug) {
  const dir = sessionPath(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'html'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'mailbox'), { recursive: true });
  return dir;
}

function ledgerPath(slug, name) {
  return path.join(sessionPath(slug), name);
}

// ── SLUGIFY ──────────────────────────────────────────────────────────────
/** Basename without extension, lowercased, non-word runs collapsed to a dash. */
export function slugify(sourcePath) {
  const base = String(sourcePath).replace(/^.*\/(?=[^/]+$)/, '').replace(/\.[^.]+$/, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'session';
}

// ── ATOMIC JSON WRITE ────────────────────────────────────────────────────
function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function readJsonHonest(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

// ── SESSION.JSON (v1, per TAPE-CONTRACT.md) ─────────────────────────────
export function loadSession(slug) {
  const p = path.join(sessionPath(slug), 'session.json');
  const s = readJsonHonest(p);
  // THE DIRECTORY IS THE SLUG. Every ledger path is keyed on the directory name, so a
  // `slug` field inside the file that disagrees with it is a stale copy, not a second
  // opinion — and a console that trusts it addresses the wrong session's mailbox.
  // (Observed live: .thetacog/tape-sessions/billem/session.json carried slug "gddadwill".)
  if (s && typeof s === 'object') s.slug = slug;
  return s;
}

export function saveSession(slug, obj) {
  ensureSessionDir(slug);
  obj.updatedAt = new Date().toISOString();
  writeJsonAtomic(path.join(sessionPath(slug), 'session.json'), obj);
  return obj;
}

/**
 * createSession({slug, sources}) -> session object, written through.
 * If a session already exists at that slug, it is returned unchanged (never
 * silently reset — re-opening the same source resumes, it doesn't restart).
 */
export function createSession({ slug, sources = [] } = {}) {
  const resolvedSlug = slug || (sources[0] ? slugify(sources[0]) : 'session');
  const abs = sources.map(absSource);
  const existing = loadSession(resolvedSlug);
  if (existing) {
    // Self-heal, idempotent: an older session may hold relative sources written before this
    // rule existed. Re-opening repairs them in place rather than leaving the tape view dead.
    const fixed = (existing.sources || []).map(absSource);
    if (JSON.stringify(fixed) !== JSON.stringify(existing.sources || [])) {
      existing.sources = fixed;
      saveSession(resolvedSlug, existing);
    }
    return existing;
  }

  ensureSessionDir(resolvedSlug);
  const now = new Date().toISOString();
  const session = {
    version: 1,
    slug: resolvedSlug,
    sources: abs,
    createdAt: now,
    updatedAt: now,
    cursor: 0,
    totalTurns: 0,
    totalLines: 0,
    home: { coord: null, decidedFrom: 0 },
    stats: { atoms: 0, picked: 0, dropped: 0, reintroduced: 0, decided: 0, dispatched: 0, done: 0, contradictions: 0 },
    paused: false,
    steering: [],
  };
  writeJsonAtomic(path.join(sessionPath(resolvedSlug), 'session.json'), session);
  return session;
}

export function listSessions() {
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadSession(d.name))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// ── GENERIC NDJSON LEDGER (append-only) ─────────────────────────────────
function appendNdjson(slug, filename, row) {
  ensureSessionDir(slug);
  const p = ledgerPath(slug, filename);
  fs.appendFileSync(p, JSON.stringify(row) + '\n');
  return row;
}

function readNdjson(slug, filename) {
  const p = ledgerPath(slug, filename);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch { /* skip a corrupt line, never throw */ }
  }
  return rows;
}

// ── specs.ndjson — THE ATOM LEDGER ──────────────────────────────────────
/** appendAtom(slug, atom) — raw append, no id/lineage logic; callers (the
 * engine's atomizer) build the atom object per TAPE-CONTRACT.md's schema. */
export function appendAtom(slug, atom) {
  const row = { ts: new Date().toISOString(), ...atom };
  return appendNdjson(slug, 'specs.ndjson', row);
}

export function readAtoms(slug) {
  return readNdjson(slug, 'specs.ndjson');
}

/**
 * resolveAtoms(slug) — fork-forward resolution.
 * specs.ndjson is append-only: an edit appends a NEW row sharing the same
 * `id`, with `parent_id` pointing at the row it supersedes. This returns ONE
 * live row per id, in original first-appearance order, keeping whichever row
 * is LATEST for that id (by ledger position — the file is the timeline, no
 * timestamp comparison needed since appends are strictly ordered).
 */
export function resolveAtoms(slug) {
  const rows = readAtoms(slug);
  const order = [];       // id -> first-seen index, to preserve original ordering
  const latestById = new Map();
  for (const row of rows) {
    if (!latestById.has(row.id)) order.push(row.id);
    latestById.set(row.id, row); // last write wins — ledger order IS recency
  }
  return order.map((id) => latestById.get(id)).filter(Boolean);
}

/**
 * editAtom(slug, id, patch) — appends a NEW row with parent_id set to the
 * CURRENT live row's own identity marker (we reuse `id` as the shared key and
 * point parent_id at the id being superseded; since ids are stable across
 * forks, parent_id equals the same id — this is what "forks forward" means:
 * the row's OWN id is unchanged, but a fresh row with a fresh `ts` and the
 * patch applied is appended, so the OLD physical row is what parent_id
 * documents as superseded).
 * NEVER mutates the prior row in place.
 */
export function editAtom(slug, id, patch = {}) {
  const live = resolveAtoms(slug).find((a) => a.id === id);
  if (!live) return null;
  const next = { ...live, ...patch, id, parent_id: id, ts: new Date().toISOString() };
  return appendAtom(slug, next);
}

/** setAtomStatus(slug, id, status, picked_by) — a narrow, common editAtom call. */
export function setAtomStatus(slug, id, status, picked_by = null) {
  const patch = { status };
  if (picked_by) patch.picked_by = picked_by;
  return editAtom(slug, id, patch);
}

// ── decisions.ndjson ─────────────────────────────────────────────────────
export function appendDecision(slug, decision) {
  const row = { ts: new Date().toISOString(), ...decision };
  return appendNdjson(slug, 'decisions.ndjson', row);
}
export function readDecisions(slug) {
  return readNdjson(slug, 'decisions.ndjson');
}

// ── dispatches.ndjson ────────────────────────────────────────────────────
export function appendDispatch(slug, dispatch) {
  const row = { ts: new Date().toISOString(), ...dispatch };
  return appendNdjson(slug, 'dispatches.ndjson', row);
}
export function readDispatches(slug) {
  return readNdjson(slug, 'dispatches.ndjson');
}
/**
 * updateDispatch(slug, atomId, patch) — dispatches.ndjson is also append-only;
 * "updating" a dispatch (queued -> running -> done) appends a fresh row for
 * that atomId carrying the patched fields merged over the prior live row.
 * readDispatches() returns the full history; callers wanting the CURRENT
 * status per atom should take the last row per atomId (mirrors resolveAtoms'
 * last-write-wins discipline, kept separate since dispatches key on atomId,
 * not their own row id).
 */
export function updateDispatch(slug, atomId, patch = {}) {
  const rows = readDispatches(slug).filter((r) => r.atomId === atomId);
  const prior = rows[rows.length - 1] || { atomId };
  const next = { ...prior, ...patch, atomId, ts: new Date().toISOString() };
  return appendNdjson(slug, 'dispatches.ndjson', next);
}

// ── vega-series.ndjson ───────────────────────────────────────────────────
export function appendVega(slug, row) {
  const out = { ts: new Date().toISOString(), ...row };
  return appendNdjson(slug, 'vega-series.ndjson', out);
}
export function readVega(slug) {
  return readNdjson(slug, 'vega-series.ndjson');
}

// ── steering (session.steering[], per TAPE-CONTRACT.md) ─────────────────
/** appendSteer(slug, row) — pushes a {ts,kind,value,appliedAt} row onto the
 * loaded session's `steering[]` array and saves the session through. */
export function appendSteer(slug, row) {
  const session = loadSession(slug) || createSession({ slug });
  const entry = { ts: new Date().toISOString(), appliedAt: null, ...row };
  session.steering = Array.isArray(session.steering) ? session.steering : [];
  session.steering.push(entry);
  saveSession(slug, session);
  return entry;
}

// ── stats() — recompute session.stats from the ledgers ──────────────────
/**
 * stats(slug) — recomputes the session.stats counters from specs.ndjson /
 * decisions.ndjson / dispatches.ndjson (the ledgers are the source of truth;
 * session.json's cached `stats` block is a derived read-model, never edited
 * by hand elsewhere). Does NOT write the session — callers decide when to
 * persist (typically after calling this + merging into the loaded session).
 */
export function stats(slug) {
  const atoms = resolveAtoms(slug);
  const decisions = readDecisions(slug);
  const dispatchRows = readDispatches(slug);
  const dispatchedAtomIds = new Set(dispatchRows.map((r) => r.atomId));

  const out = { atoms: atoms.length, picked: 0, dropped: 0, reintroduced: 0, decided: 0, dispatched: 0, done: 0, contradictions: 0 };
  for (const a of atoms) {
    if (a.status === 'picked') out.picked++;
    if (a.status === 'dropped') out.dropped++;
    if (a.status === 'reintroduced') out.reintroduced++;
    if (a.status === 'decided') out.decided++;
    if (a.status === 'dispatched') out.dispatched++;
    if (a.status === 'done') out.done++;
    if (Array.isArray(a.contradicts) && a.contradicts.length) out.contradictions++;
  }
  // decisions.ndjson itself is not double-counted into `decided` — atom.status === 'decided' is
  // the single source of truth for that counter; decisions rows are the audit trail behind it.
  void decisions;
  out.dispatched = Math.max(out.dispatched, dispatchedAtomIds.size);
  return out;
}

export { sessionsDir as SESSIONS_DIR_FN };
