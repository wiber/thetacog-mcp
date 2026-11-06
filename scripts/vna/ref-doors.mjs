// scripts/vna/ref-doors.mjs — C109e EVERY REFERENCE AND METRIC OPENS THE RELATED DOC (operator, verbatim: "I asked for all
// references and metrics to open the related doc" — asked before C106n turned the four FEED chips into doors; this is the
// ask for the REST of the page).
//
// ONE PASS AT THE WRITE BOUNDARY, beside awayCommands (C94b): the page steer-ui.mjs composed goes through here once, and
// three kinds of thing in its visible text become doors —
//   · a ROW ID (`C102a`, `C99c`) in a text node becomes <a class="bd ref" onclick="go('vna.viewUnit','C102a')"> — the spec
//     opens at that row's line (viewUnit takes the label; without one it opens the /goal's current unit, as before);
//   · a RECEIPT PATH (data/vna/* · docs/specs/vna/* · .thetacog/*) in a text node becomes <a class="bd ref" onclick=
//     "go('vna.openFile','<path>')"> — one new command, path-guarded to the repo (open-doc.ts insideRepo);
//   · a METRIC (<span class="measure">, C150d: the metric beside its button) carries data-doc="<receipt>" and opens it on
//     click — the receipt is the file the button's reading was composed from (RECEIPT_OF, keyed by the button's command,
//     the DOCS table first) or, for a face with no button (NEXT →), the face's own (FACE_RECEIPT).
//
// WHY AN INLINE <a> AND NOT A <button>: panel-signal.mjs reads <button> as a block (visibleLines splits the line there), so a
// button around every reference would turn "Signed · fp8 · 3 countersigned" into three lines and lift the copy count over
// C106b's floor; and controls.mjs counts every <button> as a control, so 700 citations would drown the manifest the README
// and the rounds email are rendered from. The construct the ask names is "a click target that opens the doc"; the bd class
// is what marks a door on this page (C106n: a chip is a bd button, never a dead span), and a.bd.ref is that door inline.
//
// WHAT IS NOT WRAPPED: text already inside an <a> or a <button> (it is a door already — the button opens what it names);
// script · style · svg · textarea · select · title (not visible text); a coordinate half (`C1` in `B,C1`, `C1,C`) — the
// lattice cell, not row C1 — recognised by its comma neighbour; a token that is not a row in the spec (the guard counts
// only tokens that name a row; a stray "C7" in prose that is no row is not a reference).
//
// GUARD: tests/vna/c109e-every-reference-opens-its-doc.test.mjs — over the page at HEAD, undoored() is empty: no row
// reference and no receipt path in a text node outside a door, no measure span without its data-doc; and the extension's
// insideRepo refuses a path outside the repo. Rust port row: none — this is transport at the write boundary (a string
// pass), not a decision; engine-map.mjs keeps the authority column where it is.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS } from './door-cmd.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SPEC_MD = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');

/** the receipt behind each button's metric — the file the reading beside it was composed from; DOCS first (C103f), then the
 *  readers steer-ui.mjs names for the rest (cockpit.json for the walk line, envelope.json for the arms, runner.ndjson for the
 *  runner's four doors, the flight tape for the 💳's Signed line, the claims file for the licence, the ingest receipt for ⤵) */
export const RECEIPT_OF = Object.freeze({
  ...Object.fromEntries(Object.values(DOCS).map((d) => [d.cmd, d.paths[0]])),
  'vna.steer': 'data/vna/cockpit.json',
  'vna.preview': 'data/vna/cockpit-preview.json',
  'vna.cycle': 'data/vna/envelope.json',
  'vna.viewAperture': 'data/vna/aperture-receipt.json',
  'vna.runGoal': '.thetacog/runner.ndjson',
  'vna.abortGoal': '.thetacog/runner.ndjson',
  'vna.inspectHalt': '.thetacog/runner.ndjson',
  'vna.copyRunSummary': '.thetacog/runner.ndjson',
  'vna.notariseTape': 'data/vna/flight-tape.ndjson',
  'vna.signTape': 'data/vna/flight-tape.ndjson',
  'vna.backupTape': 'data/vna/flight-tape.ndjson',
  'vna.syncTape': 'data/vna/flight-tape.ndjson',
  'vna.openEnginesConfig': '.thetacog/entitlement-claims.json',
  'vna.cogProof': 'data/vna/cog.ndjson',
  'vna.clipIngest': '.thetacog/vna-clip-ingest.ndjson',
  'vna.clipArm': '.thetacog/vna-clip-ingest.ndjson',
  'vna.refreshPage': 'docs/specs/vna/steer/latest.html',
  'vna.pasteToTree': 'data/vna/spec-tree.json',
  'vna.ingestGoal': 'data/vna/goal.json',
  'vna.copyGoal': 'data/vna/goal.json',
});
/** a face with no button of its own (NEXT →, C141 folds it under a pill) reads the goal */
export const FACE_RECEIPT = Object.freeze({ next: 'data/vna/goal.json' });

export const ROW_RE = /\bC\d+[a-z]?\b/g;
export const PATH_RE = /(?:data\/vna|docs\/specs\/vna|\.thetacog)\/[A-Za-z0-9_][A-Za-z0-9_./-]*[A-Za-z0-9_]/g;
const COORD_BEFORE = /[ABC][123]?,$/;          // `B,` before `C1` → the lattice cell B,C1
const COORD_AFTER = /^,[ABC][123]?\b/;          // `,C` after `C1` → the lattice cell C1,C

export const REF_CSS = 'a.bd.ref{border:0;border-radius:0;padding:0;background:none;color:inherit;border-bottom:1px dotted var(--acc,#4ec9b0);cursor:pointer}a.bd.ref:hover{color:var(--acc,#4ec9b0)}span.measure[data-doc]{cursor:pointer}span.measure[data-doc]:hover{text-decoration:underline dotted}';

let ROWS = null;
/** the row labels the spec declares — a token is a reference only if it names one of these */
export function specRowSet(md = null) {
  if (md == null && ROWS) return ROWS;
  const text = md != null ? md : (() => { try { return readFileSync(SPEC_MD, 'utf8'); } catch { return ''; } })();
  const set = new Set();
  for (const m of text.matchAll(/^\s*- \[[ x]\] (C\d+[a-z]?)\b/gm)) set.add(m[1]);
  if (md == null) ROWS = set;
  return set;
}

const isCoordinate = (text, start, end) => COORD_BEFORE.test(text.slice(Math.max(0, start - 3), start)) || COORD_AFTER.test(text.slice(end, end + 4));

/** the tokenizer both doors share: text nodes and tags in order, with the door depth (inside <a>/<button>), the last
 *  go('cmd') seen in the current face and the face's class carried along */
function walk(html, { onText, onTag }) {
  const re = /<!--[\s\S]*?-->|<(script|style|svg|textarea|select|title)\b[^>]*>[\s\S]*?<\/\1>|<[^>]+>/gi;
  const s = String(html || ''); const out = []; let last = 0, m;
  const st = { depth: 0, cmd: null, face: null };
  while ((m = re.exec(s))) {
    const text = s.slice(last, m.index); if (text) out.push(onText(text, st));
    const tag = m[0];
    if (tag.startsWith('<!--') || /^<(script|style|svg|textarea|select|title)\b/i.test(tag)) { out.push(tag); last = re.lastIndex; continue; }
    const close = /^<\/([a-zA-Z0-9]+)/.exec(tag); const open = close ? null : /^<([a-zA-Z0-9]+)/.exec(tag);
    const name = ((close || open) || [])[1]?.toLowerCase();
    if (close && (name === 'a' || name === 'button')) st.depth = Math.max(0, st.depth - 1);
    let emitted = tag;
    if (open) {
      if (name === 'div' && /class="c3l face/.test(tag)) { st.cmd = null; st.face = (/class="c3l face ([a-z-]+)/.exec(tag) || [])[1] || null; }
      if (name === 'a' || name === 'button') { const g = /onclick="go\('([^']+)'/.exec(tag); if (g) st.cmd = g[1]; }
      emitted = onTag(tag, name, st);
      if (name === 'a' || name === 'button') st.depth++;
    }
    out.push(emitted); last = re.lastIndex;
  }
  const tail = s.slice(last); if (tail) out.push(onText(tail, st));
  return out.join('');
}

const receiptFor = (st, receiptOf, faceReceipt) => (st.cmd && receiptOf[st.cmd]) || (st.face && faceReceipt[st.face]) || null;
const isMeasure = (tag) => /^<span\b[^>]*\bclass="measure"/.test(tag);

/** the pass: every reference and metric in the page's text becomes a door; idempotent (text inside a door is left alone) */
export function refDoors(html, { rows = specRowSet(), receiptOf = RECEIPT_OF, faceReceipt = FACE_RECEIPT, css = true } = {}) {
  const doorText = (text, st) => {
    if (st.depth > 0) return text;
    let t = text.replace(PATH_RE, (p) => `<a class="bd ref" onclick="event.preventDefault();event.stopPropagation();go('vna.openFile','${p}')" title="open ${p} in the editor (vna.openFile)">${p}</a>`);
    // row ids second, and never inside the anchor just painted (a path carries no C-token, but the attribute text is text now)
    const parts = t.split(/(<a class="bd ref"[^>]*>[^<]*<\/a>)/);
    return parts.map((part, i) => i % 2 ? part : part.replace(ROW_RE, (id, off, whole) => (rows.has(id) && !isCoordinate(whole, off, off + id.length))
      ? `<a class="bd ref" onclick="event.preventDefault();event.stopPropagation();go('vna.viewUnit','${id}')" title="open the spec at row ${id} (vna.viewUnit)">${id}</a>` : id)).join('');
  };
  const doorTag = (tag, name, st) => {
    if (name !== 'span' || !isMeasure(tag) || /\bdata-doc=/.test(tag)) return tag;
    const doc = receiptFor(st, receiptOf, faceReceipt); if (!doc) return tag;
    return tag.replace(/^<span\b/, `<span data-doc="${doc}" onclick="event.preventDefault();event.stopPropagation();go('vna.openFile',this.dataset.doc)"`);
  };
  let out = walk(html, { onText: doorText, onTag: doorTag });
  if (css && !out.includes('a.bd.ref{')) out = out.includes('</style>') ? out.replace('</style>', `${REF_CSS}</style>`) : `<style>${REF_CSS}</style>${out}`;
  return out;
}

/** the reading the guard takes: what is still outside a door — row references and receipt paths in text nodes outside any
 *  <a>/<button>, and measure spans with no data-doc (each with the command or face it sits under, so the table can be extended) */
export function undoored(html, { rows = specRowSet() } = {}) {
  const refs = [], paths = [], measures = [];
  walk(html, {
    onText: (text, st) => {
      if (st.depth > 0) return text;
      for (const m of text.matchAll(PATH_RE)) paths.push(m[0]);
      for (const m of text.matchAll(ROW_RE)) if (rows.has(m[0]) && !isCoordinate(text, m.index, m.index + m[0].length)) refs.push(m[0]);
      return text;
    },
    onTag: (tag, name, st) => { if (name === 'span' && isMeasure(tag) && !/\bdata-doc=/.test(tag)) measures.push({ cmd: st.cmd, face: st.face }); return tag; },
  });
  return { refs, paths, measures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {   // node scripts/vna/ref-doors.mjs [page] — the reading over a page
  const file = process.argv[2] || resolve(REPO, 'docs/specs/vna/steer/latest.html');
  const u = undoored(readFileSync(file, 'utf8'));
  console.log(`ref-doors: ${file}\n  row references outside a door: ${u.refs.length}${u.refs.length ? ` (${[...new Set(u.refs)].slice(0, 12).join(' ')})` : ''}\n  receipt paths outside a door: ${u.paths.length}${u.paths.length ? ` (${[...new Set(u.paths)].slice(0, 6).join(' ')})` : ''}\n  measures without data-doc: ${u.measures.length}${u.measures.length ? ` (${u.measures.map((m) => m.cmd || `face:${m.face}`).join(' ')})` : ''}`);
  process.exit(u.refs.length || u.paths.length || u.measures.length ? 1 : 0);
}
