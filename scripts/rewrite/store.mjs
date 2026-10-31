// scripts/rewrite/store.mjs
// ════════════════════════════════════════════════════════════════════════════
// SESSION STATE + THE LEDGER.
//
// Two kinds of state, deliberately kept apart:
//
//   SESSION  (.thetacog/cache/rewrite/session-<slug>.json) — resumable working
//     state: which paragraphs have been scanned by which engine, the live card
//     queue, the aperture. Disposable; delete it and you just rescan.
//
//   LEDGER   (.thetacog/cache/rewrite/ledger.ndjson) — append-only, one line per
//     accepted edit. THIS IS THE EXPERIMENT'S RESULT. It records which track won,
//     the drift verdict, the reader monologue that triggered the card, and the
//     commit sha. Never rewritten, never compacted — the A/B is only as
//     trustworthy as this file's append-only discipline.
//
// The session is also written through on every mutation so a Next.js dev-server
// hot reload (which throws away module state) cannot lose the queue.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = process.env.REWRITE_CACHE_DIR
  || path.join(process.cwd(), '.thetacog', 'cache', 'rewrite');
const LEDGER = path.join(CACHE_DIR, 'ledger.ndjson');

function ensureDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function slugForFile(file) {
  return String(file).replace(/^.*\/(?=[^/]+$)/, '').replace(/[^\w.-]+/g, '-').replace(/\.md x?$/, '') || 'session';
}

function sessionPath(slug) {
  return path.join(CACHE_DIR, `session-${slug}.json`);
}

/** ── SESSION ─────────────────────────────────────────────────────────────── */

export function newSession({ file, slug, totalParagraphs, totalLines, aperture = 0, tracks = ['A', 'B', 'C', 'D'], persona = '' }) {
  return {
    version: 2,
    file,
    slug,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aperture,                  // paragraph index the writer started at
    cursor: aperture,          // next paragraph the scanner will diagnose
    totalParagraphs,
    totalLines,
    tracks,                    // enabled track ids (the "allowed modes" checkboxes)
    persona,
    cards: [],                 // the live queue (>= BUFFER_TARGET ahead of the writer)
    done: [],                  // resolved card ids, so we never re-serve one
    scanned: {},               // paragraphIndex -> {local:bool, cloud:bool, startLine, endLine, minScore}
    edits: [],                 // {line, count} density, derived but cached for the margin
    stats: { served: 0, accepted: 0, skipped: 0, manual: 0, byTrack: {} },
    paused: false,
  };
}

export function loadSession(slug) {
  ensureDir();
  const p = sessionPath(slug);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

export function saveSession(session) {
  ensureDir();
  session.updatedAt = new Date().toISOString();
  const p = sessionPath(session.slug);
  // Atomic write — a torn session file loses the queue mid-edit.
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, p);
  return session;
}

export function listSessions() {
  ensureDir();
  return fs.readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith('session-') && f.endsWith('.json'))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
        return { slug: s.slug, file: s.file, updatedAt: s.updatedAt, cards: s.cards?.length || 0, accepted: s.stats?.accepted || 0 };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function deleteSession(slug) {
  const p = sessionPath(slug);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** ── LEDGER ──────────────────────────────────────────────────────────────── */

export function appendLedger(entry) {
  ensureDir();
  const row = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  return row;
}

export function readLedger({ limit = 1000, file = null } = {}) {
  ensureDir();
  if (!fs.existsSync(LEDGER)) return [];
  const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
    try {
      const r = JSON.parse(lines[i]);
      if (!file || r.file === file) rows.push(r);
    } catch {}
  }
  return rows;
}

/**
 * The A/B result: win-rate per track.
 * `offered` counts how often a track's candidate was ON THE CARD; `won` counts
 * selections. Rate is won/offered — raw win counts alone would just reward
 * whichever track produces the most candidates, which is not the question.
 */
export function winRates({ file = null } = {}) {
  const rows = readLedger({ limit: 100000, file });
  const tally = {};
  const bump = (id, k, n = 1) => {
    tally[id] = tally[id] || { offered: 0, won: 0, ruptures: 0, inLane: 0, totalCoverage: 0, coverageN: 0 };
    tally[id][k] += n;
  };

  let manual = 0, kept = 0, total = 0;
  for (const r of rows) {
    if (r.kind !== 'accept') continue;
    total++;
    for (const id of r.offeredTracks || []) bump(id, 'offered');
    if (r.winner === 'MANUAL') { manual++; continue; }
    if (r.winner === 'ORIGINAL') { kept++; continue; }
    if (r.winner) {
      bump(r.winner, 'won');
      if (r.drift?.verdict === 'RUPTURE') bump(r.winner, 'ruptures');
      if (r.drift?.verdict === 'IN-LANE') bump(r.winner, 'inLane');
      if (typeof r.drift?.coverage === 'number') {
        bump(r.winner, 'totalCoverage', r.drift.coverage);
        bump(r.winner, 'coverageN');
      }
    }
  }

  const out = {};
  for (const [id, t] of Object.entries(tally)) {
    out[id] = {
      ...t,
      winRate: t.offered ? +(t.won / t.offered * 100).toFixed(1) : null,
      avgCoverage: t.coverageN ? +(t.totalCoverage / t.coverageN).toFixed(1) : null,
    };
  }
  return { tracks: out, manual, keptOriginal: kept, totalDecisions: total };
}

export { CACHE_DIR, LEDGER };
