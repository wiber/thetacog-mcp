#!/usr/bin/env node
// scripts/vna/aim.mjs — THE TAPE AND THE AIM: the operator's own messages (loadTape, C331) and the from: pointer every chair row
// carries back to the tape line it was cut from (C780). Lifted out of steer.mjs so steer-follow-through.mjs can read the aim without
// importing steer.mjs (steer.mjs imports the follow-through at its CLI door: a static import back would deadlock its top-level await).
// steer.mjs re-exports every name here, so its callers and guards read them where they always did.
//
// C780 AIM THE SNOWBALL AT THE ROW'S ORIGIN LINE (operator 2026-10-12, verbatim: *"the snowballs are supposed to follow the spec
// onto the file that generated to the specific line where it came from and then back into the repository … the snowball needs to
// be aimed"*). Every chair row carries `from: tape:<sha12>#L<first>-<last> (span sha <sha8>)`: the tape row (sha256 of its text, the
// id that survives a re-read — a seq index moves as sessions roll) and the 1-based lines inside it the row decomposes, with the
// sha8 of those lines verbatim. resolveFrom re-reads the lines off the tape and compares them to the recorded span: equal → AIMED;
// anything else → UNAIMED with why. The stamp's `not on the tape` span (C331) is the chair's text; the from: pointer is where it came from.
// Decides (a verbatim match) → port row: engine-map.mjs lists it with the steer door (MAXIMISE RUST: prototype here, port once proved).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { projectDir } from './transcript-asks.mjs';   // C331: the tape's transcripts live where the asks audit reads them

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const TAPE_SESSIONS = 2;
export const CHAT_LOG = process.env.VNA_CHAT_LOG || resolve(REPO, '.thetacog/chat/session.ndjson');
const TAPE_MAX_BYTES = 128 * 1024 * 1024;
export const tapeKey = (s) => String(s || '').replace(/\s*·\s*/g, ' ').toLowerCase().replace(/[*_`"“”'’\\]/g, '').replace(/\s+/g, ' ').trim();
/** the operator's own messages, newest last — [] when no transcript or chat log can be read (then nothing is verbatim) */
// 2026-10-13 THE TAPE IS THE OPERATOR'S, NOT THE MACHINE'S. The tape took the TAPE_SESSIONS newest session files whatever they were;
// a headless `claude -p` bench writes a session per call (29 of the newest 40 were headless, measured), so while one ran the "operator's
// words" a chair row quoted were a grader prompt ("You grade a rule-retrieval system…", stamped on C752's basin) or a task-notification
// the harness enqueued ("a697664cc2005003e toolu_… .output c", stamped on C775 and C776). A session is headless when its user records
// carry entrypoint sdk-cli; the newest TAPE_SESSIONS INTERACTIVE sessions are read, and an enqueued <task-notification> is the harness's.
export function headlessSession(lines) { return lines.some((r) => r && r.type === 'user' && r.entrypoint === 'sdk-cli'); }
// C780d (2026-10-15): the compaction summary ("This session is being continued from a previous conversation…") is the HARNESS
// retelling the operator, not the operator. It quotes the dictation, so a quoted-span aim found it first (newest row) and C862–C864
// were stamped off the retelling instead of the dictation. A retelling is never a tape row.
export const harnessNotice = (text) => /^\s*<(task-notification|system-reminder)\b|^\s*This session is being continued from a previous conversation/.test(String(text || ''));
export function loadTape({ repo = REPO, chatLog = CHAT_LOG, tapeFile = process.env.VNA_TAPE_FILE, dir: dirIn = null, goalsDir = undefined } = {}) {
  // VNA_TAPE_FILE: a fixture tape (one {text} JSON per line) standing in for the transcripts — a test writes the dictation it
  // types onto it, exactly as a typed prompt lands on the real one; it never bypasses the check
  if (tapeFile) { try { return readFileSync(tapeFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).text; } catch { return null; } }).filter(Boolean); } catch { return []; } }
  const out = [];
  try {
    const dir = dirIn || projectDir(repo);
    const all = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs, n: statSync(join(dir, f)).size }))
      .sort((a, b) => b.t - a.t).filter((x) => x.n <= TAPE_MAX_BYTES);
    const picked = [];
    for (const x of all) {
      if (picked.length >= TAPE_SESSIONS) break;
      const rows = readFileSync(x.f, 'utf8').split('\n').map((l) => { if (!l) return null; try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (!headlessSession(rows)) picked.push(rows);
    }
    for (const rows of picked.reverse()) for (const r of rows) {
      if (r.type === 'user' && typeof r.message?.content === 'string' && !r.isMeta && !harnessNotice(r.message.content)) out.push({ at: r.timestamp || '', text: r.message.content });
      else if (r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string' && !harnessNotice(r.content)) out.push({ at: r.timestamp || '', text: r.content });
    }
  } catch {}
  // C780c (2026-10-15): a dictation the operator COMMITS as a goal file (docs/specs/vna/goals/*.txt, "one line is one row") is a tape
  // row too — the strongest record a dictation can have is a commit; its mtime orders it among the transcript rows.
  // C780d: a fixture transcript dir with the default repo reads NO goal files — the real repo's goals leaked into c784's fixture tape
  // and its newest row became whichever goal file main wrote last. A caller that wants both passes repo (C780c) or goalsDir.
  const gd = goalsDir !== undefined ? goalsDir : (dirIn && repo === REPO) ? null : join(repo, 'docs/specs/vna/goals');
  if (gd) try { for (const f of readdirSync(gd).filter((f) => f.endsWith('.txt'))) { const fp = join(gd, f); out.push({ at: new Date(statSync(fp).mtimeMs).toISOString(), text: readFileSync(fp, 'utf8') }); } } catch {}
  try { for (const l of readFileSync(chatLog, 'utf8').split('\n')) { try { const j = JSON.parse(l); if (j.role === 'user' && typeof j.content === 'string') out.push({ at: j.at || '', text: j.content }); } catch {} } } catch {}
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((x) => x.text);
}
export const onTape = (ask, tape = []) => { const k = tapeKey(ask); return !!k && tape.some((p) => tapeKey(p).includes(k)); };

export const FROM_RE = /\bfrom: (tape:[0-9a-f]{12})#L(\d+)-(\d+) \(span sha ([0-9a-f]{8})\)/;
const sha12 = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 12);
const sha8 = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 8);
export const tapeRowId = (text) => `tape:${sha12(text)}`;
/** locate a dictation slice on the tape: { pointer, id, first, last, span } or null — exact substring first (newest row first), else
 * the normalised line match (tapeKey) so a harness-wrapped or re-quoted line still finds its row; the span is always the tape's own lines */
export function fromPointer(slice, tape = []) {
  const sl = String(slice || '').trim(); if (!sl) return null;
  const build = (row, first, last) => { const L = String(row).split('\n'); const span = L.slice(first - 1, last).join('\n'); return { pointer: `${tapeRowId(row)}#L${first}-${last} (span sha ${sha8(span)})`, id: tapeRowId(row), first, last, span }; };
  for (let i = tape.length - 1; i >= 0; i--) {
    const row = String(tape[i]); if (harnessNotice(row)) continue;   // C780d: a retelling never vouches for a span
    const at = row.indexOf(sl);
    if (at < 0) continue;
    const first = row.slice(0, at).split('\n').length; const last = first + sl.split('\n').length - 1;
    return build(row, first, last);
  }
  const want = sl.split(/\r?\n/).map(tapeKey).filter(Boolean); if (!want.length) return null;
  for (let i = tape.length - 1; i >= 0; i--) {
    if (harnessNotice(tape[i])) continue;   // C780d
    const L = String(tape[i]).split('\n');
    for (let j = 0; j < L.length; j++) {
      if (!tapeKey(L[j]).includes(want[0])) continue;
      const last = j + want.length;   // 1-based
      if (tapeKey(L.slice(j, last).join(' ')).includes(tapeKey(sl))) return build(tape[i], j + 1, last);
    }
  }
  // C764b (2026-10-14): a CHAIR row is a paraphrase that QUOTES the dictation it decomposes (*"…"*, "…", “…”). The quoted span,
  // not the paraphrase, is what the tape can vouch for: the longest quoted span found verbatim on the tape aims the row. A row
  // whose quotes are all unfound stays UNAIMED, so a paraphrase with no verbatim words still reads as one.
  const quoted = [...sl.matchAll(/\*"([^"]{24,})"\*|"([^"]{24,})"|“([^”]{24,})”/g)].map((m) => (m[1] || m[2] || m[3] || '').trim()).filter(Boolean).sort((x, y) => y.length - x.length);
  for (const q of quoted) { const hit = fromPointer(q, tape); if (hit) return hit; }
  return null;
}
export function parseFrom(line) { const m = FROM_RE.exec(String(line || '')); return m ? { pointer: m[0].slice(6), id: m[1], first: Number(m[2]), last: Number(m[3]), spanSha: m[4] } : null; }
/** re-read the pointer's lines off the tape — { ok, id, first, last, span } or { ok:false, why } (a mismatch is UNAIMED, never a paraphrase) */
export function resolveFrom(from, tape = []) {
  const f = typeof from === 'string' ? parseFrom(from.startsWith('from:') ? from : `from: ${from}`) : from;
  if (!f) return { ok: false, why: 'row carries no dictation span' };
  const row = tape.find((t) => tapeRowId(t) === f.id);
  if (row == null) return { ok: false, why: `tape row ${f.id} is not on the tape (${tape.length} rows read)` };
  const L = String(row).split('\n');
  if (f.first < 1 || f.last < f.first || f.last > L.length) return { ok: false, why: `lines L${f.first}-${f.last} are outside tape row ${f.id} (${L.length} lines)` };
  const span = L.slice(f.first - 1, f.last).join('\n');
  if (sha8(span) !== f.spanSha) return { ok: false, why: `tape row ${f.id} L${f.first}-${f.last} no longer read as the recorded span (sha ${sha8(span)} ≠ ${f.spanSha})` };
  return { ok: true, id: f.id, first: f.first, last: f.last, span };
}
export const rowLineOf = (specPath, label) => { try { return readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ xX]\\] ${label}\\b`).test(l)) || null; } catch { return null; } };
/** the aim of a row: { aimed:true, id, first, last, span } or { aimed:false, why } — the ONE reading the brief, verify and record-chat share */
export function aimOf({ label, specPath = SPEC_MD, tape = loadTape(), line = null } = {}) {
  const l = line ?? rowLineOf(specPath, label);
  if (!l) return { aimed: false, why: `no row ${label} in ${specPath}` };
  const f = parseFrom(l); if (!f) return { aimed: false, why: 'row carries no dictation span' };
  const r = resolveFrom(f, tape); return r.ok ? { aimed: true, ...r } : { aimed: false, why: r.why, from: f };
}
