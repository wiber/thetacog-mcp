#!/usr/bin/env node
/**
 * messages-db — ONE spine for every conversation: WhatsApp, iMessage, email.
 *
 * WHY A SPINE AND NOT THREE MIRRORS: follow-up is a question ACROSS channels, not inside one.
 * "Jamie last spoke on the 11th and we never came back" is true whether the 11th was a WhatsApp
 * message, a green bubble, or a reply to an outreach send. Three separate mirrors can each
 * answer "did they speak in MY channel" and none of them can answer the actual question. The
 * ranker downstream reads THIS table and nothing else.
 *
 * ZERO LLM, BY CONSTRUCTION. Every column here is a fact about a tape — who, when, which way,
 * what bytes. Nothing in this file infers, classifies, or scores. That is the same split the
 * receipt rule draws (see CLAUDE.md, THE RECEIPT IS LLM-FREE): the FIRING is arithmetic and
 * re-runnable; the JUDGEMENT is a separate, later, human-or-model pass that never writes here.
 *
 * IDEMPOTENT MERGE IS THE WHOLE TRICK. Every row's id is sha1(channel|thread|ts|dir|body), so
 * re-importing an overlapping window is a no-op. Importers are therefore free to re-read more
 * history than they need — duplicates are free, gaps are the only thing that costs. That is
 * what makes a 30-minute cron safe: it can always over-read.
 *
 * AN ABSENCE IN A STALE MIRROR IS A CUTOFF, NOT SILENCE. Every import writes a `syncs` row
 * carrying its cutoff_ts and ok flag, and every reader can (and must) ask `cutoffs()` before
 * concluding that nobody said anything. A frozen mirror read as silence is how you conclude
 * "they never replied" about someone who replied an hour ago. See sync-whatsapp.sh for the
 * incident that made this a rule.
 *
 *   node scripts/chat/messages-db.mjs --stats
 *   node scripts/chat/messages-db.mjs --cutoffs
 *   node scripts/chat/messages-db.mjs --threads 20
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openSqlite } from '../lib/sqlite-lazy.mjs';

export const DEFAULT_DB = path.join(process.cwd(), 'data/messages/messages.sqlite');

/** The only channels this spine knows. An importer for anything else adds itself here first. */
export const CHANNELS = ['whatsapp', 'imessage', 'email'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,   -- sha1(channel|thread_id|ts|direction|body) — the idempotence key
  channel    TEXT NOT NULL,      -- whatsapp | imessage | email
  thread_id  TEXT NOT NULL,      -- chat guid / room name / email thread
  ts         INTEGER NOT NULL,   -- unix seconds
  direction  TEXT NOT NULL,      -- in | out   (out = we sent it)
  handle     TEXT,               -- counterparty address: phone, email, jid
  sender     TEXT,               -- display name as the source recorded it
  body       TEXT NOT NULL,
  is_group   INTEGER NOT NULL DEFAULT 0,
  auto       INTEGER NOT NULL DEFAULT 0,  -- machine broadcast, NOT a turn in a conversation
  source     TEXT NOT NULL,      -- which importer wrote this row
  synced_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_m_thread_ts ON messages(thread_id, ts);
CREATE INDEX IF NOT EXISTS idx_m_channel_ts ON messages(channel, ts);
CREATE INDEX IF NOT EXISTS idx_m_handle ON messages(handle);

CREATE TABLE IF NOT EXISTS threads (
  id         TEXT PRIMARY KEY,
  channel    TEXT NOT NULL,
  name       TEXT,
  handle     TEXT,
  is_group   INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER, last_seen INTEGER,
  last_in_ts INTEGER, last_out_ts INTEGER,
  n_in INTEGER NOT NULL DEFAULT 0, n_out INTEGER NOT NULL DEFAULT 0,
  n_out_auto INTEGER NOT NULL DEFAULT 0   -- blasts: counted, never treated as a reply
);
CREATE INDEX IF NOT EXISTS idx_t_channel ON threads(channel);

-- One row per importer run. cutoff_ts is HOW FAR THIS SOURCE CAN SEE, which is not the same
-- as how far back it read: a frozen mirror has a recent read window and an old cutoff.
CREATE TABLE IF NOT EXISTS syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, channel TEXT NOT NULL,
  seen INTEGER NOT NULL, inserted INTEGER NOT NULL,
  cutoff_ts INTEGER, ok INTEGER NOT NULL, note TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_s_source_at ON syncs(source, at);
`;

export function openDb(file = DEFAULT_DB) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqlite(file);
  db.pragma('journal_mode = WAL');
  // CREATE TABLE IF NOT EXISTS never adds a column, so migrate BEFORE the schema runs or every
  // query naming `auto` throws against a db created before it existed.
  const had = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages'").get();
  if (had) {
    const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
    if (!cols.includes('auto')) db.exec('ALTER TABLE messages ADD COLUMN auto INTEGER NOT NULL DEFAULT 0');
    const tcols = db.prepare('PRAGMA table_info(threads)').all().map((c) => c.name);
    if (tcols.length && !tcols.includes('n_out_auto')) {
      db.exec('ALTER TABLE threads ADD COLUMN n_out_auto INTEGER NOT NULL DEFAULT 0');
    }
  }
  db.exec(SCHEMA);
  return db;
}

/** sha1 over the five fields that make a message THAT message. Re-import is a no-op. */
export function msgId({ channel, thread_id, ts, direction, body }) {
  return crypto.createHash('sha1')
    .update(`${channel}|${thread_id}|${ts}|${direction}|${body}`)
    .digest('hex');
}

export function threadId(channel, key) {
  return crypto.createHash('sha1').update(`${channel}|${key}`).digest('hex').slice(0, 16);
}

/**
 * Merge a batch. Every row must already be normalised — this function does no parsing, so any
 * channel-specific quirk (media placeholders, attributedBody blobs, address canonicalisation)
 * is the importer's job and stays out of the spine.
 *
 * @param rows  [{channel, thread_id, thread_name?, ts, direction, handle?, sender?, body, is_group?}]
 */
export function ingest(db, rows, { source, channel, cutoffTs = null, ok = true, note = null }) {
  const now = Math.floor(Date.now() / 1000);
  const ins = db.prepare(`INSERT OR IGNORE INTO messages
    (id,channel,thread_id,ts,direction,handle,sender,body,is_group,auto,source,synced_at)
    VALUES (@id,@channel,@thread_id,@ts,@direction,@handle,@sender,@body,@is_group,@auto,@source,@synced_at)`);
  const upThread = db.prepare(`INSERT INTO threads(id,channel,name,handle,is_group)
    VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=COALESCE(excluded.name, threads.name),
      handle=COALESCE(excluded.handle, threads.handle),
      is_group=MAX(threads.is_group, excluded.is_group)`);

  let inserted = 0;
  const touched = new Set();
  db.transaction(() => {
    for (const r of rows) {
      if (!CHANNELS.includes(r.channel)) throw new Error(`unknown channel: ${r.channel}`);
      if (!r.body || !r.ts || !r.thread_id) continue;
      const row = {
        id: msgId(r), channel: r.channel, thread_id: r.thread_id, ts: r.ts,
        direction: r.direction === 'out' ? 'out' : 'in',
        handle: r.handle ?? null, sender: r.sender ?? null, body: r.body,
        is_group: r.is_group ? 1 : 0, auto: r.auto ? 1 : 0, source, synced_at: now,
      };
      inserted += ins.run(row).changes;
      upThread.run(r.thread_id, r.channel, r.thread_name ?? null, r.handle ?? null, r.is_group ? 1 : 0);
      touched.add(r.thread_id);
    }
    for (const tid of touched) rollupThread(db, tid);
    db.prepare(`INSERT INTO syncs(source,channel,seen,inserted,cutoff_ts,ok,note,at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(source, channel, rows.length, inserted, cutoffTs, ok ? 1 : 0, note, now);
  })();
  return { seen: rows.length, inserted };
}

/**
 * Recompute a thread's in/out watermarks. This is what "who is owed a reply" reads.
 *
 * A MACHINE BROADCAST IS NOT A TURN, and this is the line where that has to be enforced.
 * 36,401 of 44,061 sends on this repo's tape are automated — bookclub-daily alone is 27,392.
 * Let one set last_out_ts and every owed thread reads as answered: the blast becomes a fake
 * reply. Let one count toward n_out and the 3-attempt node budget is spent on mail nobody
 * received as outreach. So the watermarks that decide who is owed see auto=0 rows only. The
 * blasts are still counted — separately, and shown — because "we have hit them 22 times with
 * automation and never once by hand" is itself a finding.
 */
export function rollupThread(db, tid) {
  const a = db.prepare(`SELECT
      MIN(ts) first_seen, MAX(ts) last_seen,
      MAX(CASE WHEN direction='in'  THEN ts END) last_in_ts,
      MAX(CASE WHEN direction='out' AND auto=0 THEN ts END) last_out_ts,
      SUM(direction='in') n_in,
      SUM(direction='out' AND auto=0) n_out,
      SUM(direction='out' AND auto=1) n_out_auto
    FROM messages WHERE thread_id=?`).get(tid);
  db.prepare(`UPDATE threads SET first_seen=?,last_seen=?,last_in_ts=?,last_out_ts=?,
      n_in=?,n_out=?,n_out_auto=? WHERE id=?`).run(a.first_seen, a.last_seen, a.last_in_ts,
      a.last_out_ts, a.n_in || 0, a.n_out || 0, a.n_out_auto || 0, tid);
}

/**
 * The freshness contract. Returns the newest sync per source with its cutoff and staleness.
 * A reader that concludes "nobody replied" without consulting this is reading a cutoff as
 * silence — the exact failure this table exists to make impossible to commit by accident.
 */
export function cutoffs(db) {
  return db.prepare(`SELECT s.* FROM syncs s
    JOIN (SELECT source, MAX(at) at FROM syncs GROUP BY source) m
      ON m.source=s.source AND m.at=s.at
    ORDER BY s.source`).all().map((r) => ({
      ...r,
      ok: !!r.ok,
      ageMin: Math.round((Date.now() / 1000 - r.at) / 60),
      cutoffAgeMin: r.cutoff_ts ? Math.round((Date.now() / 1000 - r.cutoff_ts) / 60) : null,
    }));
}

export function stats(db) {
  return {
    total: db.prepare('SELECT COUNT(*) c FROM messages').get().c,
    byChannel: db.prepare(`SELECT channel, COUNT(*) n,
        SUM(direction='in') n_in, SUM(direction='out') n_out,
        MAX(ts) last_ts FROM messages GROUP BY channel ORDER BY n DESC`).all(),
    threads: db.prepare('SELECT COUNT(*) c FROM threads').get().c,
  };
}

const iso = (t) => (t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) : '—');

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  const argv = process.argv.slice(2);
  if (argv.includes('--cutoffs')) {
    console.log('source            channel    ok  ran        cutoff             stale');
    for (const c of cutoffs(db)) {
      console.log(`${c.source.padEnd(17)} ${c.channel.padEnd(10)} ${c.ok ? '✓ ' : '✗ '} ${String(c.ageMin + 'm').padEnd(10)} ${iso(c.cutoff_ts).padEnd(18)} ${c.cutoffAgeMin ?? '?'}m${c.note ? '  ' + c.note : ''}`);
    }
  } else if (argv.includes('--threads')) {
    const n = Number(argv[argv.indexOf('--threads') + 1]) || 20;
    for (const t of db.prepare(`SELECT * FROM threads ORDER BY last_seen DESC LIMIT ?`).all(n)) {
      console.log(`${t.channel.padEnd(9)} ${String(t.name || t.handle || t.id).slice(0, 34).padEnd(35)} in ${iso(t.last_in_ts)}  out ${iso(t.last_out_ts)}  ${t.n_in}/${t.n_out}`);
    }
  } else {
    const s = stats(db);
    console.log(`spine: ${s.total} messages · ${s.threads} threads`);
    for (const c of s.byChannel) {
      console.log(`  ${c.channel.padEnd(10)} ${String(c.n).padStart(6)}  in ${c.n_in} / out ${c.n_out}  last ${iso(c.last_ts)}`);
    }
    const stale = cutoffs(db).filter((c) => !c.ok);
    if (stale.length) console.log(`⚠️  ${stale.length} source(s) not ok — run --cutoffs`);
  }
  db.close();
}
