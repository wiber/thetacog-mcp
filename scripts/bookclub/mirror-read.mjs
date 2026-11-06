#!/usr/bin/env node
// scripts/bookclub/mirror-read.mjs — READ THE RANKING INPUTS FROM LOCAL SQLITE, NOT SUPABASE.
//
// Operator 2026-08-29: "all supabase should be in the local sqlite, for cached speed on this so we
// can test things."
//
// WHY IT MATTERS BEYOND SPEED. Every threshold in the ranking pipeline — the machine cut, the
// outage floor, the board sizes — is a judgement call, and the only way to know whether 8 is the
// right number is to try 6 and look at who moves. That was never done because each attempt cost a
// full remote page-through of tens of thousands of rows: minutes per turn. The literals calcified
// because asking was expensive. Reading the same rows off local disk makes the question cost
// milliseconds, which is the actual unlock.
//
// The mirror is filled by scripts/central/mirror-sync.mjs (incremental by created_at). This module
// only READS it, and it is deliberately honest about staleness rather than silently serving old
// rows as if they were current: every result carries the mirror's own watermark so a caller can
// print how far behind it is. An absence is a cutoff, never a silence.
//
//   node scripts/bookclub/mirror-read.mjs --status
//
// Guard: tests/bookclub/mirror-read.test.mjs.
import { openSqlite } from '../lib/sqlite-lazy.mjs';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIRROR = process.env.CENTRAL_MIRROR_DB
  ? resolve(process.env.CENTRAL_MIRROR_DB)
  : resolve(REPO, 'data/central-mirror.db');

export function openMirror(path = MIRROR) {
  if (!existsSync(path)) return null;
  const db = openSqlite(path, { readonly: true });
  // A mirror that exists but has never synced this table is NOT the same as an empty result set.
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_activity_logs'").get();
  if (!t) { db.close(); return null; }
  return db;
}

/** how fresh the mirror is for a table — the caller decides what to do about it, but must be told. */
export function watermark(db, table = 'user_activity_logs') {
  const s = db.prepare('SELECT last_synced_at, last_cursor, rows FROM sync_state WHERE table_name = ?').get(table) || {};
  const ageH = s.last_synced_at ? (Date.now() - Date.parse(s.last_synced_at)) / 3_600_000 : null;
  return { ...s, ageHours: ageH == null ? null : +ageH.toFixed(1) };
}

/**
 * T3 render events, the shape every ranker already consumes: {recipient, ts, path, ip}.
 * Returns null when the mirror cannot answer, so the caller can fall back to Supabase rather
 * than silently ranking an empty corpus — an empty ranking and a failed read look identical
 * from the outside, and this repo has paid for collapsing those before.
 */
export function renderEvents({ since, db = null, path = MIRROR } = {}) {
  const own = !db;
  const d = db || openMirror(path);
  if (!d) return null;
  try {
    const rows = d.prepare(
      `SELECT recipient_email AS recipient, created_at AS ts, page_url AS path, ip_address AS ip
         FROM user_activity_logs
        WHERE recipient_email IS NOT NULL AND created_at >= ?
        ORDER BY created_at ASC`).all(since);
    if (!rows.length) return null;              // nothing held for this window → let the caller pull
    return { events: rows, mirror: watermark(d) };
  } finally {
    if (own) d.close();
  }
}

/** the geo cache — the slowest step in a fresh pull, and an IP's answer does not change. */
export function cachedGeo(ips, { path = MIRROR } = {}) {
  const d = openMirror(path);
  if (!d) return new Map();
  try {
    const has = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ip_geo'").get();
    if (!has) return new Map();
    const out = new Map();
    const q = d.prepare('SELECT geo FROM ip_geo WHERE ip = ?');
    for (const ip of new Set(ips.filter(Boolean))) {
      const r = q.get(ip);
      if (r?.geo) { try { out.set(ip, JSON.parse(r.geo)); } catch { /* skip a corrupt row */ } }
    }
    return out;
  } finally { d.close(); }
}

/** persist newly-resolved geo so the next run does not pay ip-api's 15/min again. */
export function saveGeo(map, { path = MIRROR } = {}) {
  if (!existsSync(path) || !map?.size) return 0;
  const d = openSqlite(path);
  try {
    d.exec('CREATE TABLE IF NOT EXISTS ip_geo (ip TEXT PRIMARY KEY, geo TEXT, fetched_at TEXT)');
    const up = d.prepare('INSERT INTO ip_geo (ip, geo, fetched_at) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET geo=excluded.geo, fetched_at=excluded.fetched_at');
    const now = new Date().toISOString();
    const tx = d.transaction((m) => { for (const [ip, g] of m) up.run(ip, JSON.stringify(g), now); });
    tx(map);
    return map.size;
  } finally { d.close(); }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const d = openMirror();
  if (!d) { process.stderr.write(`no mirror at ${MIRROR} — run scripts/central/mirror-sync.mjs\n`); process.exit(2); }
  const w = watermark(d);
  const geo = d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='ip_geo'").get().c
    ? d.prepare('SELECT COUNT(*) c FROM ip_geo').get().c : 0;
  process.stdout.write(`mirror ${MIRROR}\n  renders ${w.rows ?? 0} · last sync ${w.last_synced_at || 'never'}`
    + `${w.ageHours == null ? '' : ` (${w.ageHours}h ago)`}\n  geo cached ${geo} ips\n`);
  d.close();
}
