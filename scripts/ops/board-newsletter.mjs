// scripts/ops/board-newsletter.mjs — C1020j (upload half): the board's Newsletter tab, one row per book-club edition.
// Operator 2026-10-19, verbatim: "can we use data source gscript to pull in email stats / page stats from supabase? graph them in
// real time is more fun than building local htmls". Dispatched by wo1 as bf-6362 (vault → builder).
//
// COMPOSES, NEVER RE-DERIVES: every send figure is a field of scripts/comms/send-compare.mjs --json (the /sendperf reader: it
// syncs Supabase email_events + Resend into data/thetacoach.db, then classifies HUMAN / SCANNER / AMBIGUOUS with
// scripts/bookclub/human-report.mjs). Unsubscribes come from data/central-mirror.db `subscribers.unsubscribed_at` (filled from
// Supabase by scripts/central/mirror-sync.mjs), each counted against the newest edition sent before it.
// LLM-FREE: no model anywhere in the number path. A reading that is missing prints UNMEASURED, never a zero.
//
// REFRESH: the board run calls refreshSendReport(), which re-runs send-compare (with its Supabase sync) when its JSON is older than
// MAX_AGE_H; the tab then carries the report's own timestamp. The live half — an Apps Script data source on a timer — waits on a
// Sheets credential (C1020a).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const NEWSLETTER_TAB = 'Newsletter';
export const SEND_REPORT = '/tmp/send-compare.json';
export const MIRROR_DB = resolve(REPO, 'data/central-mirror.db');
const MAX_AGE_H = 6;

export const HEADER = ['EDITION', 'SUBJECT', 'SENT (UTC)', 'AGE h', 'DELIVERED', 'BOUNCED', 'COMPLAINED',
  'HUMAN', 'SCANNER', 'AMBIGUOUS', 'UNVERIFIED', 'RENDERS', 'HUMAN RENDERS', 'CLICKERS', 'HUMAN CLICK EVENTS',
  'RENDER %', 'HUMAN / 1000', 'UNSUBSCRIBES', 'EDITION LINK', 'NOTE (fill)'];

// the renders block repeats each edition, so its note column is not a (fill) cell: one typed note per edition id, in the date table
export const RANKED_HEADER = [...HEADER.slice(0, -1), 'NOTE — type it in the date table above'];

// Re-run the /sendperf reader when its JSON is stale or absent. Returns why it did or did not.
export function refreshSendReport({ path = SEND_REPORT, maxAgeH = MAX_AGE_H, run = spawnSync } = {}) {
  const age = existsSync(path) ? (Date.now() - statSync(path).mtimeMs) / 3.6e6 : Infinity;
  if (age < maxAgeH) return { ran: false, why: `report ${age.toFixed(1)}h old` };
  const r = run(process.execPath, [resolve(REPO, 'scripts/comms/send-compare.mjs'), '--no-open', '--json', '--out', path.replace(/\.json$/, '.html')],
    { cwd: REPO, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'ignore', 'pipe'] });
  return { ran: true, why: r.status === 0 ? 'refreshed' : `send-compare exited ${r.status}: ${String(r.stderr || '').slice(-160)}` };
}

export function readSendReport(path = SEND_REPORT) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return Array.isArray(j.report) ? { ...j, at: statSync(path).mtime.toISOString() } : null; }
  catch { return null; }
}

// Unsubscribe timestamps from the local mirror; null when the mirror is absent (UNMEASURED, never zero).
export function unsubscribeTimes(db = MIRROR_DB) {
  if (!existsSync(db)) return null;
  try {
    const out = execFileSync('sqlite3', [db, "SELECT unsubscribed_at FROM subscribers WHERE unsubscribed_at IS NOT NULL AND unsubscribed_at <> ''"], { encoding: 'utf8' });
    return out.split('\n').map((s) => Date.parse(s.trim())).filter(Number.isFinite);
  } catch { return null; }
}

// Each unsubscribe belongs to the newest edition sent at or before it.
export function unsubsByEdition(report, times) {
  if (!times) return null;
  const sends = report.map((r) => ({ day: r.day, t: Date.parse(r.t0 || r.sentAt) })).filter((s) => Number.isFinite(s.t)).sort((a, b) => a.t - b.t);
  const out = new Map(sends.map((s) => [s.day, 0]));
  for (const t of times) {
    let owner = null;
    for (const s of sends) { if (s.t <= t) owner = s.day; else break; }
    if (owner) out.set(owner, out.get(owner) + 1);
  }
  return out;
}

// HUMAN / 1000 to one decimal (2026-10-24): 14.397905759162303 went to the sheet whole; Sheets showed 14.39790576 in its export and
// the next pass read our own value as an edit. A person reads 14.4.
export const perK = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? num(x) : Math.round(Number(x) * 10) / 10);
const pct = (x) => (x == null || !Number.isFinite(x) ? 'UNMEASURED' : Math.round(x * 1000) / 10);
const num = (x) => (x == null || !Number.isFinite(Number(x)) ? 'UNMEASURED' : Number(x));

export function newsletterRows({ report = readSendReport(), times = unsubscribeTimes() } = {}) {
  if (!report) return [[`UNMEASURED — no ${SEND_REPORT}; run node scripts/comms/send-compare.mjs --no-open --json`]];
  const unsubs = unsubsByEdition(report.report, times);
  const row = (r) => [
    r.day, r.subject || '', String(r.sentAt || '').slice(0, 16).replace('T', ' '), num(r.ageH),
    num(r.delivered), num(r.bounced), num(r.complained),
    num(r.human), num(r.scanner), num(r.ambiguous), num(r.unverified),
    num(r.openers), num(r.humanRenders), num(r.clickers), num(r.humanClicks),
    pct(r.renderRate), perK(r.humanPerK),
    unsubs ? unsubs.get(r.day) ?? 0 : 'UNMEASURED',
    r.emailUrl ? `=HYPERLINK("${r.emailUrl}","edition ${r.day}")` : '', '',
  ];
  const byDate = (a, b) => String(b.day).localeCompare(String(a.day));
  const rows = [...report.report].sort(byDate).map(row);
  // Operator 2026-10-19: "sort by date and renders". The same editions ranked by HUMAN renders: scanner and gateway renders are most
  // of the raw count (2026-10-18: 436 gateway against 5 person), so a raw sort ranks bots. Total renders break a tie, then newest
  // first; an unmeasured edition sorts last, never as zero.
  const hr = (r) => (r.humanRenders == null || !Number.isFinite(Number(r.humanRenders)) ? -1 : Number(r.humanRenders));
  const byRenders = [...report.report].sort((a, b) => hr(b) - hr(a) || (Number(b.openers) || 0) - (Number(a.openers) || 0) || byDate(a, b)).map(row);
  const ranked = [[], ['BY HUMAN RENDERS — the same editions, most human renders first (scanner and gateway renders excluded; total renders in RENDERS breaks a tie)'], RANKED_HEADER, ...byRenders];
  const foot = [[], [`Source: scripts/comms/send-compare.mjs --json (the /sendperf reader), report at ${report.at}, matched window T+${report.windowH}h. ` +
    `Unsubscribes: data/central-mirror.db subscribers.unsubscribed_at, each against the newest edition before it${unsubs ? '' : ' — mirror absent, UNMEASURED'}. No model in this path.`]];
  return [HEADER, ...rows, ...ranked, ...foot];
}
