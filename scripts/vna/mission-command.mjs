// scripts/vna/mission-command.mjs — C2341: MISSION COMMAND FOR STEER WORKERS (chair decomposition of C2330). EVERY WORKER
// STATES ITS INTENT FIRST IN THREE LINES (INTENT, FILES, DONE-WHEN) — the backbrief — AND ENDS WITH A WRITTEN DEBRIEF
// (UNDERSTOOD, FOUND, DID, LEFT OPEN), BOTH PARSED OFF THE WORKER'S OWN OUTPUT STREAM ONTO ITS RUNNER LEDGER ROW, SO A BAD
// ROW IS DIAGNOSED FROM THE RECORD ALONE.
//
// The block is ONE constant (MISSION_BLOCK), appended by dispatchBrief, so the -p door and the chat door (briefFor) carry
// the same words. The parser reads the stream-json the worker printed (assistant text blocks, in order, plus the final
// result text) — never the shared per-label log file, which is opened in append mode and holds earlier runs.
//
// DETECTED · PLACED, never gated: a missing block records `no backbrief` / `no debrief` on the row; it never fails the
// run, never halts, never retries. Sufficient for: "did this worker say what it meant to do, before it edited, and what
// it left open". NOT sufficient for: whether the intent was right or the debrief true — the verify door's guard re-run is
// that check.
//
// Transport/parsing only, no decision taken here (MAXIMISE RUST: what stays node — the verdicts stay in the runner's gates).
// @guard tests/vna/c2341-chair-decomposition-of-the-operator-s.test.mjs

export const INTENT_OPEN = '=== INTENT ===';
export const INTENT_CLOSE = '=== END INTENT ===';
export const DEBRIEF_OPEN = '=== DEBRIEF ===';
export const DEBRIEF_CLOSE = '=== END DEBRIEF ===';

export const MISSION_BLOCK = [
  'MISSION COMMAND (C2341) — two short blocks the runner parses onto your ledger row; plain text in your reply, never in a file:',
  `1. BACKBRIEF, before your first Edit or Write — three lines, exactly these keys:`,
  INTENT_OPEN,
  'intent: <one sentence: what this row needs, in your words>',
  'files: <comma-separated paths you expect to touch>',
  'done-when: <the check that proves it — usually the guard going green>',
  INTENT_CLOSE,
  '2. DEBRIEF, as the last thing you write — four lines, exactly these keys:',
  DEBRIEF_OPEN,
  'understood: <what you took the row to mean>',
  'found: <what was already there, or surprised you>',
  'did: <what you changed, with commit shas>',
  'left open: <what is not done, and why — "nothing" if nothing>',
  DEBRIEF_CLOSE,
].join('\n');

const BACKBRIEF_KEYS = [['intent', 'intent'], ['files', 'files'], ['done-when', 'done_when']];
const DEBRIEF_KEYS = [['understood', 'understood'], ['found', 'found'], ['did', 'did'], ['left open', 'left_open']];

/** every JSON line of a stream-json stdout, in order; a line that is not JSON is skipped, never a throw */
export function streamEvents(stdout) {
  const out = [];
  for (const l of String(stdout || '').split('\n')) { const s = l.trim(); if (!s || s[0] !== '{') continue; try { out.push(JSON.parse(s)); } catch { /* skipped */ } }
  return out;
}

/** the worker's words in stream order: [{ text, beforeFirstEdit }] — assistant text blocks, then the final result text */
export function workerTexts(stdout) {
  const texts = []; let edited = false;
  for (const ev of streamEvents(stdout)) {
    const content = ev && ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content) ? ev.message.content : null;
    if (content) {
      for (const c of content) {
        if (c && c.type === 'text' && c.text) texts.push({ text: String(c.text), beforeFirstEdit: !edited });
        if (c && c.type === 'tool_use' && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(String(c.name || ''))) edited = true;
      }
    } else if (ev && ev.type === 'result' && typeof ev.result === 'string' && ev.result) texts.push({ text: ev.result, beforeFirstEdit: !edited });
  }
  return texts;
}

function blockBody(text, open, close) {
  const s = String(text || ''); const i = s.lastIndexOf(open); if (i < 0) return null;
  const j = s.indexOf(close, i + open.length); return s.slice(i + open.length, j < 0 ? undefined : j);
}
function readKeys(body, keys) {
  const got = {};
  for (const raw of body.split('\n')) {
    const m = raw.trim().replace(/^[-*]\s*/, '').match(/^([a-z][a-z -]*?)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); const hit = keys.find(([w]) => w === k || w.replace('-', ' ') === k);
    if (hit && m[2].trim() && got[hit[1]] == null) got[hit[1]] = m[2].trim();
  }
  return got;
}
function shaped(got, keys, presentWord, noneWord) {
  const missing = keys.map(([, f]) => f).filter((f) => got[f] == null);
  const state = missing.length === keys.length ? noneWord : missing.length ? 'partial' : presentWord;
  return { state, ...Object.fromEntries(keys.map(([, f]) => [f, got[f] ?? null])), missing };
}

/** the backbrief out of one text — `no backbrief` when the markers are absent */
export function parseBackbrief(text) {
  const body = blockBody(text, INTENT_OPEN, INTENT_CLOSE);
  if (body == null) return { state: 'no backbrief', intent: null, files: null, done_when: null, missing: BACKBRIEF_KEYS.map(([, f]) => f) };
  const got = readKeys(body, BACKBRIEF_KEYS);
  if (got.files != null) got.files = got.files.split(/[,\s]+/).map((x) => x.replace(/^`|`$/g, '').trim()).filter(Boolean);
  return shaped(got, BACKBRIEF_KEYS, 'present', 'no backbrief');
}

/** the debrief out of one text — `no debrief` when the markers are absent */
export function parseDebrief(text) {
  const body = blockBody(text, DEBRIEF_OPEN, DEBRIEF_CLOSE);
  if (body == null) return { state: 'no debrief', understood: null, found: null, did: null, left_open: null, missing: DEBRIEF_KEYS.map(([, f]) => f) };
  return shaped(readKeys(body, DEBRIEF_KEYS), DEBRIEF_KEYS, 'present', 'no debrief');
}

/** the ledger fields for one worker's stdout: { backbrief, debrief } — the FIRST backbrief the worker wrote, the LAST debrief */
export function missionFields(stdout) {
  const texts = workerTexts(stdout);
  let backbrief = parseBackbrief('');
  for (const t of texts) { const b = parseBackbrief(t.text); if (b.state !== 'no backbrief') { backbrief = { ...b, before_first_edit: t.beforeFirstEdit }; break; } }
  let debrief = parseDebrief('');
  for (let i = texts.length - 1; i >= 0; i--) { const d = parseDebrief(texts[i].text); if (d.state !== 'no debrief') { debrief = d; break; } }
  return { backbrief, debrief };
}
