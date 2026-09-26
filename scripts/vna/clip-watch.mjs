#!/usr/bin/env node
// scripts/vna/clip-watch.mjs — THE CLIPBOARD INTERCEPTOR (C35): system clipboard → an append to the steer file.
//
// The operator's ask, verbatim: "the ability to append all copied text without pasting (copy auto
// pastes with the daemon)". Everything downstream of an append already exists — txt-tail-watch.mjs
// --follow turns it into an amendments.ndjson row, steer-hook.mjs surfaces it into the next Claude
// turn — so this script does ONE thing: when armed, a new clipboard text lands at the tail of the
// file the pointer names. It reads the pointer (.thetacog/vna-steer-file.json, written only by
// steer-file.mjs); it never decides which file is the steer file.
//
// AN APPEND IS A SPEC AMENDMENT, NEVER A COMMAND (txt-tail-watch.mjs). The clip lands VERBATIM
// under a marker line, so the amendments ledger and a human can both see it came from the
// clipboard. Nothing here parses, summarises or acts on the text.
//
// LLM-FREE: a model in this path would paraphrase the amendment — the 2026-07-04 incident with a
// clipboard on it.
//
// ONE PURE DECISION — shouldAppend() — and a thin shell around it (poll, lock, receipt). The
// decision is table-driven by tests/vna/clip-watch.test.mjs; the shell is exercised with --once
// against a temp dir (VNA_STEER_FILE, VNA_CLIP_STATE_DIR, VNA_CLIP_CMD).
//
//   arm | disarm | status   manage .thetacog/vna-clip.armed and print state
//   --once                  poll a single time (tests, hooks)
//   --daemon                loop every VNA_CLIP_MS (default 1000) under a pid lock; launchd starts
//                           it at login (config/launchd/com.thetacog.clip-watch.plist), it loops itself
//
// Receipt: .thetacog/vna-clip.ndjson — a row per append AND per refusal, EXCEPT a secret, where the
// row is {at, why:'secret', bytes} and nothing else: never the sha of a secret.
// @guard tests/vna/clip-watch.test.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import * as fsSync from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere

// THE POINTER — the same env override the other two readers honour (steer-file.mjs writes it,
// txt-tail-watch.mjs and steer-hook.mjs read it). The source inside it is repo-relative; resolve()
// passes an absolute path through unchanged, which is the door the guard's temp dir uses.
const POINTER = process.env.VNA_STEER_FILE || resolve(REPO, '.thetacog/vna-steer-file.json');
// STATE — armed flag, pid lock, receipt. Overridable so the guard never touches the real .thetacog.
const STATE_DIR = process.env.VNA_CLIP_STATE_DIR || resolve(REPO, '.thetacog');
const ARMED = resolve(STATE_DIR, 'vna-clip.armed');
const PID = resolve(STATE_DIR, 'vna-clip.pid');
const RECEIPTS = resolve(STATE_DIR, 'vna-clip.ndjson');
// OUTBOUND — the sha of everything the instrument itself put ON the clipboard (the panel's Export for
// chat, the envelope card, any script's pbcopy). Measured 2026-09-17 (row 15): "📋 Export for chat"
// put 30 KB of cockpit output on the clipboard and the daemon appended it to the steer file, and the
// tree folded 136 nodes of our own read-out as if the operator had said it. Our exports never come
// back in. Writers: the extension host (copyOut) and `clip-watch.mjs note-outbound < text`.
const OUTBOUND = resolve(STATE_DIR, 'vna-clip-outbound.ndjson');
// THE STAMP (operator, 2026-09-17: "a regex at the start saying it came from the app, dont add it to
// the auto paste"). Every export the host copies out begins with this line; the daemon refuses it on
// sight, before any sha lookup. The known heads catch the same artifacts copied by hand off disk
// (COCKPIT-PAYLOAD.txt, the envelope card, the page) — exports that predate the stamp.
export const EXPORT_STAMP = (at = new Date().toISOString()) => `<!-- thetacog:export · ${at} · a read-out of the record, not mass — the clipboard daemon never appends this -->`;
export const EXPORT_STAMP_RE = /^\s*(<!--\s*)?thetacog[: ]export\b/i;
export const KNOWN_EXPORT_HEADS = [/^\s*# VNA COCKPIT\b/, /^\s*VNA ENVELOPE\b/, /^\s*VNA STEER\b/, /^\s*═+\s*VNA\b/, /^\s*Run ▶ Steer\b/ /* the 0.3.1 panel's own text, rows 16 + 20 */, /^\s*SPEC AMENDMENT — /, /^\s*# SPEC — VNA SEMANTIC COCKPIT\b/ /* the ≤0.3.7 tail document and the spec file itself, rows 33 + 35 */];
export const looksLikeExport = (t) => EXPORT_STAMP_RE.test(t) || KNOWN_EXPORT_HEADS.some((re) => re.test(t));
export function outboundShas() {
  try { return new Set(readFileSync(OUTBOUND, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).sha256; } catch { return null; } }).filter(Boolean)); }
  catch { return new Set(); }
}
export function noteOutbound(text, by = 'cli') {
  const row = { at: new Date().toISOString(), sha256: sha256(String(text ?? '')), bytes: Buffer.byteLength(String(text ?? '')), by };
  mkdirSync(STATE_DIR, { recursive: true }); appendFileSync(OUTBOUND, JSON.stringify(row) + '\n'); return row;
}

export const POLL_MS = Number(process.env.VNA_CLIP_MS) || 1000;
export const MIN_CHARS = Number(process.env.VNA_CLIP_MIN) || 24;
// The clipboard reader. pbpaste is macOS; the override is a command line (split on spaces) so a
// test can point it at `cat <file>` and drive the clipboard from disk.
const CLIP_CMD = (process.env.VNA_CLIP_CMD || 'pbpaste').split(/\s+/).filter(Boolean);

// ── C107a RTF NEVER REACHES THE FOLD (operator 2026-09-20: "if pastes dont work right that would explain this"). Measured: tape
// rows 393 and 674 are `{\rtf1\ansi\ansicpg1252\cocoartf2870 …` — a Notes copy landed as RTF, the fold chunked its control words, and
// PENDING listed `\f0\fs34 \cf2 That` as an ask. The conversion happens at the ONE door (landClip) and in the one clipboard reader
// (readClip), so the sha on the tape row is of the plain text and the dedupe reads plain text. macOS: `textutil -stdin -stdout
// -convert txt`; elsewhere, or when textutil is absent, a pure-node walk that drops the header groups (fonttbl, colortbl, \*),
// decodes \'hh (cp1252) and \uN escapes, turns \par and \line into newlines and strips every other control word. The two rows
// already on the tape STAY as they are (AXIOM 1 — the tape is never rewritten); they are named on the C107a row as retained.
export const RTF_RE = /^\s*\{\\rtf1\b/;
export const isRtf = (text) => RTF_RE.test(String(text || ''));
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const SKIP_GROUPS = /^\\(?:(?:fonttbl|colortbl|stylesheet|info|pict|themedata|listtable|listoverridetable|expandedcolortbl|generator)\b|\*)/;
export function rtfToTextNode(rtf) {
  const s = String(rtf); let out = ''; let i = 0; const stack = []; let skip = 0; let uskip = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '{') { stack.push(skip); if (SKIP_GROUPS.test(s.slice(i + 1, i + 40))) skip++; i++; continue; }
    if (c === '}') { skip = stack.length ? stack.pop() : 0; i++; continue; }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === "'") { const hex = s.slice(i + 2, i + 4); const code = parseInt(hex, 16); if (!skip && Number.isFinite(code)) out += CP1252[code] || String.fromCharCode(code); i += 4; continue; }
      if (n === '\\' || n === '{' || n === '}') { if (!skip) out += n; i += 2; continue; }
      if (n === '\n' || n === '\r') { if (!skip) out += '\n'; i += 2; continue; }
      if (n === '~') { if (!skip) out += '\u00a0'; i += 2; continue; }
      if (n === '-' || n === '_' || n === ':' || n === '|') { i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i));
      if (m) {
        const w = m[1], v = m[2] == null ? null : Number(m[2]);
        if (!skip) {
          if (w === 'par' || w === 'line') out += '\n';
          else if (w === 'tab') out += '\t';
          else if (w === 'uc' && v != null) uskip = v;
          else if (w === 'u' && v != null) { out += String.fromCodePoint(v < 0 ? v + 65536 : v); i += m[0].length; let k = uskip; while (k-- > 0 && i < s.length) { if (s[i] === '\\' && s[i + 1] === "'") i += 4; else i++; } continue; }
          else if (w === 'emdash') out += '—'; else if (w === 'endash') out += '–'; else if (w === 'lquote') out += '‘'; else if (w === 'rquote') out += '’'; else if (w === 'ldblquote') out += '“'; else if (w === 'rdblquote') out += '”'; else if (w === 'bullet') out += '•';
        }
        i += m[0].length; continue;
      }
      i += 2; continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }   // raw line breaks in RTF are not text; \par is
    if (!skip) out += c; i++;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
export function rtfToText(rtf) {
  if (!isRtf(rtf)) return { text: String(rtf), rtf: false, via: null };
  if (process.platform === 'darwin' && !process.env.VNA_NO_TEXTUTIL) {
    try {
      const t = execFileSync('textutil', ['-stdin', '-stdout', '-format', 'rtf', '-convert', 'txt', '-encoding', 'UTF-8'], { input: String(rtf), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1 << 26, timeout: 20000 });
      if (t && t.trim()) return { text: t.replace(/\r\n?/g, '\n'), rtf: true, via: 'textutil' };
    } catch {}
  }
  return { text: rtfToTextNode(rtf), rtf: true, via: 'node' };
}

// The marker: a comment line the amendments ledger keeps with the row and a human can grep.
export const MARKER_RE = /<!-- clip · [^>]* -->/g;
const marker = (ts, sha8) => `<!-- clip · ${ts} · ${sha8} -->`;

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const localDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

// SECRET FAMILIES: API keys (sk-…), GitHub tokens (ghp_…), Slack tokens (xoxb-/xoxp-), AWS access
// keys (AKIA…), and PEM private keys. The prefix must be followed by 16+ token characters so the
// prefix alone ("skill", "ghp") cannot fire — the CLAUDE.md "kill inside skill" class. A word
// boundary before the prefix keeps it out of the middle of ordinary words.
const SECRET_RE = /\b(sk|ghp|xox[bp]|AKIA)[-_A-Za-z0-9]{16,}|BEGIN [A-Z ]*PRIVATE KEY/;
export function isSecret(text) { return SECRET_RE.test(text); }

// C173d — A LICENCE JWT IS MASKED AT INGEST, NEVER REFUSED AND NEVER WRITTEN VERBATIM. On 2026-09-22 the operator copied his
// licence key and this daemon appended it to steer.txt (tracked) — SECRET_RE has no JWT family — and it was masked by hand
// (signature → X, same length). A JWT-shaped span is three base64url segments joined by dots whose header starts eyJ (base64 of
// '{"'); the header and payload stay (they are the claims, readable on purpose, the thing the paste was about) and the SIGNATURE —
// the part that makes it a bearer credential — becomes X of the same length. Idempotent: a masked span masks to itself. Every
// door that decides on or writes a clip reads the masked text (shouldAppend, the poll's sha, landClip), so the verbatim token
// never reaches the steer file, the receipt's sha, or the tree.
const JWT_RE = /(?<![A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g;
export function maskJwts(text) { return String(text ?? '').replace(JWT_RE, (_m, h, p, sig) => `${h}.${p}.${'X'.repeat(sig.length)}`); }

// ── THE DECISION ────────────────────────────────────────────────────────────
// Pure: nothing here reads a file or the clock. Each refusal names its reason, because the receipt
// row carries it and "why did that not land" is the question the operator will ask the ndjson.
// The instrument's own page, as text: tags stripped, whitespace folded. A clip that is a substring
// of it (≥ 200 chars, so a common phrase cannot match) was copied OFF the panel or the browser page —
// a read-out, never mass. Read per decision, never cached: the page re-renders on every append.
export const PAGE_HTML = process.env.VNA_PAGE_HTML || resolve(REPO, 'docs/specs/vna/steer/latest.html');
const fold = (t) => String(t ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function pageText() { try { return fold(readFileSync(PAGE_HTML, 'utf8')); } catch { return ''; } }
// THE REPO'S OWN RECORD IS NOT MASS EITHER (2026-09-17, row 33: the whole SPEC-VNA-COCKPIT.md, 112 KB,
// copied and appended as if dictated). The declaration, the tree's own outline and the cockpit payload
// are read-outs of the record; a clip that is a substring of any of them (≥ PAGE_MATCH_MIN) is refused.
export const OWN_RECORD = (process.env.VNA_OWN_RECORD ? process.env.VNA_OWN_RECORD.split(':') : [
  'docs/specs/vna/SPEC-VNA-COCKPIT.md', 'data/vna/spec-tree.txt', 'docs/specs/vna/COCKPIT-PAYLOAD.txt',
]).map((p) => resolve(REPO, p));
export function ownRecordText() { return OWN_RECORD.map((p) => { try { return fold(readFileSync(p, 'utf8')); } catch { return ''; } }); }
export const PAGE_MATCH_MIN = 200;
export function shouldAppend({ text, lastSha, fileText, minChars = MIN_CHARS, armed, outbound = null, page = null, record = null }) {
  const t = maskJwts(text);   // C173d: every decision is about the text that would land
  const trimmed = t.trim();
  // 1. SECRET — checked FIRST, before any branch whose receipt row would carry the sha. A key on the
  //    clipboard is the commonest thing a developer copies, and the steer file is committed text that
  //    is surfaced into a model's context; neither may ever hold it. The sha of a secret is a stable
  //    fingerprint of it, so the row for this branch must not carry one either — and that is only
  //    guaranteed if this branch wins over 'same clip' and 'disarmed', both of which would log a sha.
  if (isSecret(t)) return { append: false, why: 'looks like a secret — never appended, never logged' };
  // 2. DISARMED — the flag file is the operator's consent, per session. A daemon that appended while
  //    disarmed would be a keylogger for the clipboard; the flag is the only thing between the two.
  if (!armed) return { append: false, why: 'disarmed' };
  // 3. SAME CLIP — the clipboard holds its last value indefinitely, so a poll that sees the same
  //    sha is seeing the SAME copy, not a new one. Without this every tick would re-append the clip.
  if (lastSha && sha256(t) === lastSha) return { append: false, why: 'same clip' };
  // 3b. OUR OWN EXPORT — the panel (or a script) put this on the clipboard for the operator to paste
  //     into a chat. It is a read-out of the record, not new mass; appending it would make the tree
  //     ingest its own output, and every re-render would grow the spec. The outbound ledger is the
  //     receipt of what we copied OUT; a sha on it never comes back IN.
  if (looksLikeExport(t)) return { append: false, why: 'stamped as our export — the first line says it came from the app' };
  if (outbound && outbound.has(sha256(t))) return { append: false, why: 'our own export — copied out by the instrument, never back in' };
  if (page && trimmed.length >= PAGE_MATCH_MIN && page.includes(fold(trimmed))) return { append: false, why: 'copied off the instrument\'s own page — a read-out, not mass' };
  if (record && trimmed.length >= PAGE_MATCH_MIN) {
    // whole-clip containment, then SAMPLES: a clip that wraps the record in a header (row 35: the old tail
    // document around the whole spec) is not a substring of it — but three 200-char windows of the clip are.
    const f = fold(trimmed);
    const hit = (s) => record.some((r) => r && r.includes(s));
    if (hit(f)) return { append: false, why: 'copied out of the repo\'s own record (the spec / the tree / the payload) — a declaration, not mass' };
    if (f.length >= 3 * PAGE_MATCH_MIN) {
      const w = [f.slice(200, 400), f.slice(Math.floor(f.length / 2) - 100, Math.floor(f.length / 2) + 100), f.slice(f.length - 400, f.length - 200)];
      if (w.filter(hit).length >= 2) return { append: false, why: 'mostly the repo\'s own record (2 of 3 samples inside it) — a declaration wrapped in a header, not mass' };
    }
  }
  // 4. FLOOR — a copied filename, a variable name, a word to search for: those are clipboard use,
  //    not a paste into the steer file. 24 chars is below the shortest sentence and above any token.
  if (trimmed.length < minChars) return { append: false, why: 'below floor — a filename or a word is not a paste' };
  // 4b. AN ADDRESS IS NOT MASS — a copied path or URL (one token, no whitespace, a separator in it)
  //     clears the floor by length alone. Measured 2026-09-17: the first minute armed appended
  //     "/Users/…/SPEC-VNA-COCKPIT.md" (131 B) as if it were a paste. A path names a thing; the
  //     paste IS the thing. One token with '/' or '\\' or '://' and no whitespace is never appended.
  if (!/\s/.test(trimmed) && /[\/\\]|:\/\//.test(trimmed)) return { append: false, why: 'an address, not a paste — a path or URL is never appended' };
  // 5. ALREADY IN THE FILE — copying a line OUT of the steer file (to paste into chat, which is the
  //    other imperative level) must not echo it back in. Trimmed containment, so surrounding
  //    whitespace from the selection does not defeat the check.
  if (trimmed && String(fileText ?? '').includes(trimmed)) return { append: false, why: 'already in the file' };
  return { append: true, why: 'append' };
}

// ── STATE ───────────────────────────────────────────────────────────────────
function readRows() {
  try { return readFileSync(RECEIPTS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function receipt(row) { mkdirSync(STATE_DIR, { recursive: true }); appendFileSync(RECEIPTS, JSON.stringify(row) + '\n'); }
function lastShaFromReceipts() { const r = readRows().filter((x) => x.sha256).pop(); return r ? r.sha256 : null; }
function armed() { return existsSync(ARMED); }
function livePid(pid) { if (!pid || pid === process.pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function daemonPid() { try { const p = Number(readFileSync(PID, 'utf8').trim()); return livePid(p) ? p : null; } catch { return null; } }

// ONE place computes the three states the sidebar and `status` both print. steer-ui.mjs imports
// this rather than re-reading the flag and the ndjson, so the two doors cannot disagree.
export function clipState(now = new Date()) {
  const rows = readRows();
  const day = localDay(now);
  const appendedToday = rows.filter((r) => r.why === 'clip' && localDay(r.at) === day).length;
  const ran = existsSync(RECEIPTS) || existsSync(ARMED);
  const state = armed() ? 'armed' : ran ? 'disarmed' : 'not run';
  const line = state === 'armed' ? `clipboard: armed · ${appendedToday} appended today`
    : state === 'disarmed' ? 'clipboard: disarmed'
      : 'clipboard: not run — node scripts/vna/clip-watch.mjs arm';
  return { state, armed: state === 'armed', appendedToday, rows: rows.length, daemon: daemonPid(), line, receipts: RECEIPTS };
}

function steerFile() {
  let p = null;
  try { p = JSON.parse(readFileSync(POINTER, 'utf8')); } catch {}
  if (!p || !p.source) return null;
  return resolve(REPO, p.source);
}

function readClip() {
  let raw = null; try { raw = execFileSync(CLIP_CMD[0], CLIP_CMD.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }); } catch { return null; }
  if (raw == null) return null;
  const conv = rtfToText(raw); readClip.lastRtf = conv.rtf ? conv.via : null;   // C107a: the reader hands back plain text, so every check downstream reads plain text; the door stamps the receipt
  return conv.text;
}

// ── ONE APPEND, ONE PLACE (C98e) ────────────────────────────────────────────
// The daemon's poll and the one-shot door (clip-ingest.mjs) land a clip through this function, so the marker line and the
// receipt row cannot drift between the two doors. `by` names the door on the receipt; the daemon's rows stay as they were.
export function landClip(text, { file = steerFile(), at = new Date().toISOString(), by = null, rtf = null } = {}) {
  if (!file) throw new Error('no steer file — the pointer is absent or empty');
  const conv = rtfToText(text); text = maskJwts(conv.text);   // C173d: the signature of a JWT never reaches the file
  // C196 (2026-09-23): this restore ran as a `//` comment — `if (!conv.rtf && rtf) {...}` sat on the same source line AFTER
  // the C173d comment above, so it was dead text, never code. rtfToText(text) here re-checks the ALREADY-plain text (the
  // reader converted it upstream), so conv.rtf reads false and the receipt silently dropped its `rtf` field — the caller's
  // `rtf` param (the reader's own via, C107a) is what should have restored it. Split onto its own line so it runs.
  if (!conv.rtf && rtf) { conv.rtf = true; conv.via = rtf; }   // rtf: the reader already converted and says how — C107a: RTF never reaches the fold — the sha below is of the plain text
  const sha = sha256(text); const sha8 = sha.slice(0, 8); const bytes = Buffer.byteLength(text);
  appendFileSync(file, `\n\n${marker(at, sha8)}\n${text}\n`);
  receipt({ at, sha256: sha, bytes, source: file, why: 'clip', ...(by ? { by } : {}), ...(conv.rtf ? { rtf: conv.via } : {}) });
  return { file, sha, sha8, bytes, at, ...(conv.rtf ? { rtf: conv.via } : {}) };
}
export { steerFile, readClip };

// ── ONE POLL ────────────────────────────────────────────────────────────────
// Returns the decision so the daemon can carry lastSha in memory. `silentSame`: in the daemon an
// unchanged clipboard is the steady state, not an event — writing 'same clip' once a second would be
// logging the clock, and a receipt nobody can read is no receipt. --once writes it, so a caller
// sees why nothing landed.
function poll({ lastSha, silentSame }) {
  const file = steerFile();
  if (!file) { console.error(`NOT ADMISSIBLE: no steer file — the pointer at ${POINTER} is absent or empty; open a .txt in the IDE or \`node scripts/vna/steer-file.mjs set <path>\``); return { exit: 2 }; }
  if (!existsSync(file)) { console.error(`NOT ADMISSIBLE: the steer file ${file} does not exist — an absent file is not an empty one`); return { exit: 2 }; }
  const isArmed = armed();
  // Disarmed: do not even read the clipboard. The flag is consent; reading without it is the thing
  // the flag exists to prevent, and the daemon idles here cheaply all day.
  if (!isArmed) { if (!silentSame) receipt({ at: new Date().toISOString(), source: file, why: 'disarmed' }); return { exit: 0, lastSha }; }
  const text = readClip();
  if (text == null) return { exit: 0, lastSha }; // non-text clipboard (an image) or pbpaste unavailable — nothing to place
  const sha = sha256(maskJwts(text));   // C173d: the clip's identity is its masked form — never the sha of a verbatim token
  if (silentSame && sha === lastSha) return { exit: 0, lastSha };
  const fileText = readFileSync(file, 'utf8');
  const d = shouldAppend({ text, lastSha, fileText, minChars: MIN_CHARS, armed: isArmed , outbound: outboundShas(), page: pageText(), record: ownRecordText() });
  const at = new Date().toISOString();
  const bytes = Buffer.byteLength(text);
  if (!d.append) {
    if (isSecret(text)) receipt({ at, why: 'secret', bytes });
    else receipt({ at, sha256: sha, bytes, source: file, why: d.why });
    return { exit: 0, lastSha: isSecret(text) ? lastSha : sha };
  }
  const { sha8 } = landClip(text, { file, at, rtf: readClip.lastRtf });   // C98e: the one append · C107a: RTF converted at the reader, stamped here
  console.log(`clip → ${file} +${bytes}B sha ${sha8}`);
  return { exit: 0, lastSha: sha };
}

// ── THE LOCK ────────────────────────────────────────────────────────────────
// A live pid holding the file means another daemon is polling: exit 0 quietly (launchd + a manual
// start must not fight over the clipboard and double-append). A dead pid is stale and reclaimed —
// liveness, not trust, same as wip.mjs.
function lock() {
  const held = daemonPid();
  if (held) { console.log(`clip-watch already running (pid ${held}) — exit 0`); return false; }
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(PID, String(process.pid));
  const drop = () => { try { if (Number(readFileSync(PID, 'utf8').trim()) === process.pid) unlinkSync(PID); } catch {} };
  process.on('exit', drop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { drop(); process.exit(0); });
  return true;
}

// C126b — one detached child of this same script; the pid lock inside daemon() is the only guard against two, so a live pid here
// means "already running" and nothing is spawned. The log is launchd's (config/launchd/com.thetacog.clip-watch.plist) so the two
// doors write one file.
function startDaemon() {
  const held = daemonPid();
  if (held) return { started: false, pid: held };
  if (process.env.VNA_CLIP_NO_SPAWN) return { started: false, pid: null };   // the --once sandbox tests: the flag alone, no poller racing the test's own poll
  const logDir = resolve(STATE_DIR, 'logs'); mkdirSync(logDir, { recursive: true });
  const { openSync } = fsSync;
  const out = openSync(resolve(logDir, 'clip-watch.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--daemon'], { detached: true, stdio: ['ignore', out, out], env: process.env, cwd: REPO });
  child.unref();
  return { started: true, pid: child.pid };
}

async function daemon() {
  if (!lock()) return 0;
  if (!steerFile()) { console.error(`NOT ADMISSIBLE: no steer file at ${POINTER} — refusing to start`); return 2; }
  let lastSha = lastShaFromReceipts();
  console.log(`clip-watch daemon pid ${process.pid} · every ${POLL_MS}ms · ${clipState().line}`);
  for (;;) {
    const r = poll({ lastSha, silentSame: true });
    if (r.exit === 2) { await new Promise((ok) => setTimeout(ok, POLL_MS * 10)); continue; } // pointer cleared mid-run: wait, do not die
    lastSha = r.lastSha;
    await new Promise((ok) => setTimeout(ok, POLL_MS));
  }
}

function main() {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'arm') {
    mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(ARMED, new Date().toISOString() + '\n');
    // C126b (operator 2026-09-21, "🟢 auto-paste ❌ CLIP DEAD — armed, no daemon": "this isnt good"): arm used to write the flag and
    // PRINT "daemon not running" — on a machine without the launchd agent the tick armed a clipboard nobody read. A door named is a
    // door opened (C105c): no live pid → start --daemon detached, its own lock, stdout to the same log launchd uses. Guard: C126b.
    const d = startDaemon();
    console.log(`clip-watch armed — ${clipState().line} · daemon ${d.started ? `started pid ${d.pid}` : d.pid ? `running pid ${d.pid}` : 'not started (VNA_CLIP_NO_SPAWN)'}`); return 0;
  }
  if (cmd === 'disarm') { try { unlinkSync(ARMED); } catch {} console.log(`clip-watch disarmed — ${clipState().line}`); return 0; }
  if (cmd === 'status') {
    const s = clipState(); const f = steerFile();
    console.log(`${s.line}\nsteer file: ${f || 'NONE — pointer absent'}\ndaemon: ${s.daemon ? `running pid ${s.daemon}` : 'not running'}\nreceipts: ${s.rows} rows at ${s.receipts}`);
    return 0;
  }
  if (cmd === '--once') return poll({ lastSha: lastShaFromReceipts(), silentSame: false }).exit;
  if (cmd === '--daemon') return daemon();
  console.error('usage: clip-watch.mjs arm|disarm|status|--once|--daemon'); return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) Promise.resolve(main()).then((c) => process.exit(c));
