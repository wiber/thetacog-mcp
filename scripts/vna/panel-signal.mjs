#!/usr/bin/env node
// scripts/vna/panel-signal.mjs — THE PANEL'S COPY IS MAXIMAL COMMS (C106, operator 2026-09-20: "nothing computed here? that is
// a zero signal to noise - all parts of this has to be maximal comms" · "I meant the copy in left oanel").
//
// The left panel is docs/specs/vna/steer/latest.html as steer-ui.mjs wrote it. This door reads that page's VISIBLE text —
// <style>, <script> and comments dropped, tags stripped, entities decoded, one trimmed line per block, duplicates folded —
// and sorts every line into two bins: a line CARRIES A VALUE when it holds a digit, UNMEASURED, `not <word>` (not run · not
// connected · not synced — a stated absence is a reading), a sha (7+ hex), σ, Δ or %; every other line is COPY — a tagline, a legend, section prose that names no reading and no command. The ask
// is that copy either carries the reading or moves under ▸ more; the door counts, it never edits.
//
//   panel: <n> lines · <v> carry a value · <c> copy (<pct>%)[ · OVER FLOOR <floor>]
//
// THE FLOOR ONLY FALLS. data/vna/panel-signal-floor.json holds the lowest copy count a run has measured; a run below it
// lowers it, a run above it says OVER FLOOR on the line (DETECTED, never gated — the render is never stopped). The seed is
// the door's own first measurement, never a typed number — of the page as the HOOK renders it: a `VNA_NO_FLIGHT_TAPE=1`
// render omits the onboard rows and reads low (130 vs 136 on 2026-09-20), and a floor seeded from it is a false floor.
//
//   node scripts/vna/panel-signal.mjs             the line; lowers the floor when the page beat it
//   node scripts/vna/panel-signal.mjs --list      the copy lines, one per line, after the summary
//   node scripts/vna/panel-signal.mjs --json      the reading as JSON
//   node scripts/vna/panel-signal.mjs --no-floor  read only — never touch the floor file (tests)
//
// @guard tests/vna/c106-asked-vs-built.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const PAGE = process.env.VNA_STEER_PAGE || resolve(REPO, 'docs/specs/vna/steer/latest.html');
export const FLOOR_FILE = process.env.VNA_PANEL_SIGNAL_FLOOR || resolve(REPO, 'data/vna/panel-signal-floor.json');
export const CMD = 'node scripts/vna/panel-signal.mjs';
export const NOT_RUN = `panel: not run — ${CMD}`;
/** a line carries a value when it holds one of these — the operator's complaint is the line that holds none */
export const VALUE_RE = /\d|UNMEASURED|\bnot \w+|[0-9a-f]{7,}|σ|Δ|%/;   // `not run` · `not connected` · `not synced` — a stated absence is a reading (2026-09-20: `🔑 — · not connected` read as copy under one renderer and as a fingerprint under the hook's, and the floor flapped by one)

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** the page's visible lines, in order, trimmed, deduplicated — the same page steer-ui wrote, read as a reader sees it */
export function visibleLines(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(br|hr)\b[^>]*\/?>/gi, '\n');
  s = s.replace(/<\/?(div|p|h[1-6]|li|ul|ol|tr|td|th|section|article|header|footer|details|summary|pre|blockquote|dl|dt|dd|table|thead|tbody|nav|aside|main|form|fieldset|legend|button|option|select|textarea|label|figure|figcaption)\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  const seen = new Set(); const out = [];
  for (const raw of s.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || seen.has(line)) continue;
    seen.add(line); out.push(line);
  }
  return out;
}

/** the reading: every visible line binned — pure over the html */
export function panelSignal(html) {
  const lines = visibleLines(html);
  const copy = lines.filter((l) => !VALUE_RE.test(l));
  const value = lines.length - copy.length;
  const pct = lines.length ? Math.round((copy.length / lines.length) * 100) : 0;
  return { lines: lines.length, value, copy: copy.length, pct, copyLines: copy };
}

export function readFloor(file = FLOOR_FILE) {
  try { const j = JSON.parse(readFileSync(file, 'utf8')); return Number.isFinite(j.copy) ? j : null; } catch { return null; }
}
/** the floor only falls: a lower count replaces it, a higher one is reported, a first run seeds it from the measurement */
export function ratchetFloor(reading, { file = FLOOR_FILE, write = true, at = new Date().toISOString() } = {}) {
  const prev = readFloor(file);
  if (!prev || reading.copy < prev.copy) {
    const next = { copy: reading.copy, lines: reading.lines, at, seeded: !prev, from: prev ? prev.copy : null };
    if (write) { try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(next, null, 2) + '\n'); } catch {} }
    return { floor: next.copy, over: false, moved: true, seeded: !prev };
  }
  return { floor: prev.copy, over: reading.copy > prev.copy, moved: false, seeded: false };
}

export function panelLine(reading, floor = null) {
  let line = `panel: ${reading.lines} lines · ${reading.value} carry a value · ${reading.copy} copy (${reading.pct}%)`;
  if (floor && floor.over) line += ` · OVER FLOOR ${floor.floor}`;
  return line;
}

/** the strip's read — the page it is about to be part of is not on disk yet, so the strip hands in the html it rendered so far, or reads the last page */
export function stripLine({ html = null, page = PAGE, floorFile = FLOOR_FILE } = {}) {
  let text = html;
  if (text == null) { try { text = readFileSync(page, 'utf8'); } catch { return NOT_RUN; } }
  const r = panelSignal(text);
  const f = readFloor(floorFile);
  return panelLine(r, f ? { floor: f.copy, over: r.copy > f.copy } : null);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });   // `| head` closes the pipe; that is not an error of the door
  const a = process.argv.slice(2);
  if (!existsSync(PAGE)) { process.stdout.write(NOT_RUN + '\n'); process.exit(0); }
  const r = panelSignal(readFileSync(PAGE, 'utf8'));
  const f = ratchetFloor(r, { write: !a.includes('--no-floor') });
  const line = panelLine(r, f);
  if (a.includes('--json')) process.stdout.write(JSON.stringify({ at: new Date().toISOString(), line, ...r, floor: f }, null, 2) + '\n');
  else {
    process.stdout.write(line + (f.moved && !a.includes('--no-floor') ? ` · floor ${f.seeded ? 'seeded' : 'lowered'} to ${f.floor}` : '') + '\n');
    if (a.includes('--list')) for (const l of r.copyLines) process.stdout.write(`  copy · ${l}\n`);
  }
}
