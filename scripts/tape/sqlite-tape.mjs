// packages/thetacog-mcp/scripts/tape/sqlite-tape.mjs — THE LEDGER OF TRUTH.
//
// The schema is the operator's, verbatim, from the end of GDDadwill.txt (lines 1405-1409):
//   "Your SQLite database isn't just storing app data; it is acting as the hard drive for the
//    contradiction engine. Every row is a dispatched decision.
//    Columns: Decision_ID, Raw_Transcript_Snippet, Extracted_Rule, Target_Surface (the file being
//    edited), and Shape_Match_Hash."
//   "The SvelteKit UI renders this table as the master checklist. You click any rule, and the UI
//    instantly populates the rest of the dashboard with the exact context of that specific moment
//    in time."
//
// ── WHY SQLITE AND NOT THE NDJSON WE ALREADY HAVE ─────────────────────────────────────────────
// From the same passage: "SQLite isn't a cloud service that can silently mutate; it is a literal,
// physical file on your local disk. It is the perfect medium for an immutable semantic tape."
// The ndjson ledgers stay — they are the append-only write path and they are what the CLI reads.
// This table is the INDEX the dashboard clicks: five columns, one row per dispatched decision, built
// FROM those ledgers. It is DERIVED, and that is deliberate — see the hard rule below.
//
// ⚠ DERIVED, THEREFORE NEVER THE PLACE STATE IS AUTHORED. This repo has an incident for exactly this
// (CLAUDE.md · NEVER WRITE STATE INTO A GENERATED FILE): seven live person pages were written into a
// file a generator owns, and the next regeneration deleted them with no diff explaining it. And it
// nearly happened again today — lens_rules looked like the place to seat coordinates until reading
// prompt-lens.mjs showed seedRules() does DELETE FROM lens_rules on every reseed. So: this table is
// rebuilt from the ndjson ledgers, an edit belongs in the ledger, and rebuild() is idempotent.
//
// ── THE SHAPE_MATCH_HASH IS THE POINT ─────────────────────────────────────────────────────────
// The source's closing argument: "if the shape match deviates from the SQLite ledger by even a single
// pixel or logic gate, the UI throws a hard red visual flag indicating exactly where the semantic
// drift occurred." So Shape_Match_Hash is a sha256 of the RENDERED PANEL BYTES — not of the text, not
// of the metadata. Two runs that produce the same panel produce the same hash; a single changed pixel
// changes it. That is what makes the contradiction flag decidable rather than a judgement call.
// When no panel has been rendered for a decision the hash is NULL and reads UNMEASURED — never a
// hash of nothing, which would silently compare equal to another decision that also has no panel.
//
//   node packages/thetacog-mcp/scripts/tape/sqlite-tape.mjs rebuild [--slug s]
//   node packages/thetacog-mcp/scripts/tape/sqlite-tape.mjs rows    [--slug s] [--json]

import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

export const DB_PATH = (slug) => resolve(SESSIONS, slug, 'tape.db');

// The five columns, named exactly as the operator wrote them. The extra columns after them are
// PROVENANCE, not new state — every one is recomputable from the ndjson and each earns its place by
// answering "how do I check this row" rather than by being convenient.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS tape (
  Decision_ID            TEXT PRIMARY KEY,
  Raw_Transcript_Snippet TEXT,
  Extracted_Rule         TEXT NOT NULL,
  Target_Surface         TEXT,
  Shape_Match_Hash       TEXT,
  -- provenance: how to re-derive this row, never a second source of truth
  coord                  TEXT,
  sigma                  REAL,
  sensor                 TEXT,
  panel_png              TEXT,
  commit_sha             TEXT,
  enforcement_off_pct    REAL,
  status                 TEXT,
  ts                     TEXT,
  unmeasured             TEXT
);
CREATE INDEX IF NOT EXISTS tape_coord ON tape(coord);
`;

const nd = (slug, f) => {
  const p = resolve(SESSIONS, slug, f);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

const sqlite = (db, sql) => execFileSync('sqlite3', [db], { input: sql, encoding: 'utf8', maxBuffer: 5e7 });
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (Number.isFinite(v) ? String(v) : 'NULL');

/** sha256 of the RENDERED PANEL BYTES — a single changed pixel changes it. Null when unrendered. */
export function shapeMatchHash(pngPath) {
  if (!pngPath || !existsSync(pngPath)) return null;
  try { return createHash('sha256').update(readFileSync(pngPath)).digest('hex'); } catch { return null; }
}

/** Rebuild the index from the append-only ledgers. Idempotent — the ledgers are the truth. */
export function rebuild(slug) {
  const dir = resolve(SESSIONS, slug);
  if (!existsSync(dir)) return { ok: false, reason: `no session '${slug}'` };
  mkdirSync(dir, { recursive: true });
  const db = DB_PATH(slug);

  // live coordinates: last row per id wins (same resolver as everywhere else)
  const order = [], latest = new Map();
  for (const c of nd(slug, 'coordinates.ndjson')) {
    if (!c?.id) continue;
    if (!latest.has(c.id)) order.push(c.id);
    latest.set(c.id, c);
  }
  const coords = order.map((id) => latest.get(id)).filter((c) => c.status !== 'retired');

  // last dispatch per coordinate — that is the decision's execution record
  const dispatchFor = new Map();
  for (const d of nd(slug, 'dispatches.ndjson')) {
    const id = d.coordinateId || d.atomId;
    if (id) dispatchFor.set(id, d);
  }

  const rows = coords.map((c) => {
    const d = dispatchFor.get(c.id) || null;
    const enf = Array.isArray(d?.enforcement) ? d.enforcement[d.enforcement.length - 1] : null;
    // A decision panel (INTENT = the rule, REALITY = the surface it claims) is rendered per
    // coordinate by coordinate-panels; the enforcement receipt (a dispatched commit) takes precedence
    // when one exists, because that is the stronger pair — independent authorship on both sides.
    const decisionPng = resolve(dir, "html", "receipts", `${c.id}.png`);
    const png = enf?.receiptPng || d?.receiptPng || (existsSync(decisionPng) ? decisionPng : null);
    const hash = shapeMatchHash(png);
    const surface = c.target_surface
      || (c.owns || []).find((o) => o.kind === 'code')?.file
      || null;
    const missing = [];
    if (!c.quote && !c.steer) missing.push('Raw_Transcript_Snippet — this coordinate was locked without a recorded steer or quote');
    if (!surface) missing.push('Target_Surface — no code file was named or discovered for this rule');
    if (!hash) missing.push('Shape_Match_Hash — no panel rendered for this decision yet');
    return {
      Decision_ID: c.id,
      Raw_Transcript_Snippet: c.quote || c.steer || null,
      Extracted_Rule: c.rule,
      Target_Surface: surface,
      Shape_Match_Hash: hash,
      coord: c.coord || null,
      sigma: Number.isFinite(c.sigma) ? c.sigma : null,
      sensor: c.sensor || null,
      panel_png: png,
      commit_sha: (d?.commits || [])[0] || null,
      enforcement_off_pct: Number.isFinite(enf?.offPct) ? enf.offPct : null,
      status: d?.status || c.status || 'locked',
      ts: c.ts || null,
      unmeasured: missing.length ? missing.join(' · ') : null,
    };
  });

  const inserts = rows.map((r) => `INSERT OR REPLACE INTO tape VALUES (${[
    q(r.Decision_ID), q(r.Raw_Transcript_Snippet), q(r.Extracted_Rule), q(r.Target_Surface), q(r.Shape_Match_Hash),
    q(r.coord), n(r.sigma), q(r.sensor), q(r.panel_png), q(r.commit_sha), n(r.enforcement_off_pct),
    q(r.status), q(r.ts), q(r.unmeasured),
  ].join(',')});`).join('\n');

  try {
    sqlite(db, `${SCHEMA}\nDELETE FROM tape;\n${inserts}\n`);
  } catch (e) {
    return { ok: false, reason: `sqlite3 failed: ${String(e.message).slice(0, 200)}` };
  }
  return { ok: true, db, rows: rows.length, withHash: rows.filter((r) => r.Shape_Match_Hash).length, withSurface: rows.filter((r) => r.Target_Surface).length };
}

export function readRows(slug) {
  const db = DB_PATH(slug);
  if (!existsSync(db)) return [];
  try {
    const out = sqlite(db, `.mode json\nSELECT * FROM tape ORDER BY ts;\n`);
    return JSON.parse(out.trim() || '[]');
  } catch { return []; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // ── STDOUT MUST BE BLOCKING BEFORE ANY process.exit() ───────────────────────────────────────
  // MEASURED twice, by two agents, on two different files: a JSON payload piped through execFile()
  // is silently CUT at ~8,188 bytes when the process exits right after logging it. exit() tears the
  // process down before the pipe drains, so the reader gets a PREFIX — and a prefix of valid JSON is
  // invalid JSON, surfacing in the caller as "Unterminated string in JSON at position 8180" with no
  // hint that truncation happened. It is invisible under 8KB, so it ships green and only bites once a
  // session grows.
  //
  // Making stdout blocking is the fix that preserves control flow. Dropping the exit() instead lets
  // the CLI fall through and print its human output after the JSON, which corrupts the payload a
  // different way — tried that first, and the parser said so immediately.
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const cmd = process.argv[2];

  if (cmd === 'rebuild') {
    const r = rebuild(slug);
    if (!r.ok) { console.error('✗ ' + r.reason); process.exit(2); }
    console.log(`\n  THE LEDGER OF TRUTH · ${slug}`);
    console.log(`  ${r.rows} decision rows → ${r.db.replace(REPO + '/', '')}  (${statSync(r.db).size} bytes)`);
    console.log(`  ${r.withSurface}/${r.rows} name a Target_Surface · ${r.withHash}/${r.rows} carry a Shape_Match_Hash\n`);
    process.exit(0);
  }

  const rows = readRows(slug);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  if (!rows.length) { console.log(`\n  no rows — run: sqlite-tape.mjs rebuild --slug ${slug}\n`); process.exit(0); }
  console.log(`\n  THE LEDGER OF TRUTH · ${slug} — click any row in the dashboard to populate the rest\n`);
  for (const r of rows) {
    console.log(`  ${String(r.Decision_ID).padEnd(12)} ${String(r.coord || '—').padEnd(6)} ${String(r.Extracted_Rule).slice(0, 62)}`);
    console.log(`     surface: ${r.Target_Surface || 'UNMEASURED'}`);
    console.log(`     shape  : ${r.Shape_Match_Hash ? r.Shape_Match_Hash.slice(0, 16) + '…' : 'UNMEASURED — no panel rendered for this decision'}`);
    if (r.unmeasured) console.log(`     ⚠ ${r.unmeasured}`);
  }
  console.log('');
}
