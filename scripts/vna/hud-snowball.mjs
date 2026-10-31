#!/usr/bin/env node
// scripts/vna/hud-snowball.mjs — C743 (ledger half): the realtime snowball ledger the 🎯 STEER HUD writes and the health strip (C739) counts.
//   freeze   [--json]  stdin = the frozen /steer text (+ --window-sha --archetype --locked <json> --defences <json>), or ONE JSON object
//                      {text, window_sha, archetype, locked, defences}; appends ONE row to .thetacog/hud-snowballs.ndjson and prints it.
//                      C749: stdin {row, text} is the `frozen` event of `pmu-onchip --hud-serve` passed through unchanged: the server's row is
//                      appended AS IT IS (its archetype, locked and defences are the server's), with text, dispatched:false, dispatch_id:null, by.
//   freeze-worm [--json]  stdin = ONE JSON object {cell, words, sentence, contextSha} (H13, docs/specs/vna/asks/2026-10-12-hud-ux-card.txt):
//                      a click plus a spoken sentence on one of the HUD's nine tier-intersection cells. Appends ONE row naming the cell, its
//                      three words, the sentence and the context sha — never the full retrieved context (the receipt path stays LLM-free; the
//                      context itself reaches the LLM only through `dispatch`'s steer -p door, gated the same as every other row).
//   dispatch <text_sha> --by key|click [--json]   spawns the existing door `node scripts/vna/steer.mjs "<text>" --driver claude` DETACHED
//                      (the C444 -p door, never the native subagent). A voice-shaped origin (--by voice, or no --by) is refused: the asymmetric gate.
//   sync     [--json]  marks rows whose text_sha appears on a {kind:'dispatch'} runner row as dispatched:true + dispatch_id; atomic rewrite.
//   list     [--json]  rows newest last (what C739's strip reads: count + timeline).
// Env seams: VNA_HUD_SNOWBALLS (ledger) · VNA_RUNNER_NDJSON (runner log) · VNA_STEER_CLI (script spawned instead of steer.mjs, for the guard).
// C743 follow-up: sync reads the per-row log (VNA_HUD_SNOWBALLS_DIR), stores row_id, and matches runner `label` === row_id, so dispatched is measured.
// (Older note) MATCH FIELD (sync): a runner dispatch row today carries `snowball.path` and `snowball_sha256`/`snowball_sha` = the hash of the runner's
// OWN brief file, not of the HUD text, so those never equal text_sha. The fields matched are `text_sha`, then `snowball.text_sha`, then
// `snowball_sha256`/`snowball_sha` (matches only if a future runner hashes the frozen text itself). A live row that matches none stays
// dispatched:false: UNMEASURED, because the runner does not yet echo the text hash. Reading a ledger, never a promise about the worker.
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// C1389: the repo being read — the caller's, when `npx thetacog-mcp hud-snowball` runs elsewhere (C94b's own convention)
const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
const ledgerPath = () => process.env.VNA_HUD_SNOWBALLS || resolve(REPO, '.thetacog/hud-snowballs.ndjson');
const logDir = () => process.env.VNA_HUD_SNOWBALLS_DIR || resolve(REPO, '.thetacog/hud-snowballs');
const runnerPath = () => process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

// C749 the server's frozen row, as is: only the ledger's own fields are added
export function rowFromServer(j = {}) {
  const text = String(j.text ?? (j.row && j.row.text) ?? '');
  return { ...j.row, text, text_chars: text.length, dispatched: false, dispatch_id: null, by: 'ide:hud' };
}
export const allowsDispatch = (by) => by === 'key' || by === 'click';

// H13 (C759): one worm-cell freeze — a click plus a spoken sentence on a tier-intersection cell. `cell` is 0..8 (the
// nine fixed tier intersections), `words` are the cell's own three held words (never re-derived here — this is the
// ledger, not the walk), `sentence` is what the operator said, `contextSha` names the Rust walk's retrieved context
// without carrying it (AXIOM 1: the ledger stays small; the context itself travels only through `dispatch`).
export function freezeWormCell(input = {}) {
  const n = Number(input.cell);
  if (!Number.isInteger(n) || n < 0 || n > 8) return { ok: false, reason: 'bad cell', why: `cell must be an integer 0..8, got ${JSON.stringify(input.cell)}` };
  const words = Array.isArray(input.words) ? input.words.map((w) => String(w)) : [];
  if (words.length !== 3) return { ok: false, reason: 'bad words', why: `words must be exactly 3 strings, got ${words.length}` };
  const sentence = String(input.sentence || '').split(/\s+/).filter(Boolean).join(' ');
  if (!sentence) return { ok: false, reason: 'needs-sentence', why: 'a worm-cell freeze needs a spoken sentence' };
  const contextSha = String(input.contextSha || '');
  const text = `${words.join(' ')} — ${sentence}`;
  const row = { at: new Date().toISOString(), kind: 'worm-cell', cell: n, words, sentence, context_sha: contextSha,
    text, text_sha: sha(text), text_chars: text.length, dispatched: false, dispatch_id: null, by: 'ide:hud' };
  mkdirSync(dirname(ledgerPath()), { recursive: true });
  appendFileSync(ledgerPath(), JSON.stringify(row) + '\n');
  return row;
}

const arr = (v) => Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
export function rowFor(input = {}) {
  const text = String(input.text ?? '');
  return { at: input.at || new Date().toISOString(), window_sha: input.window_sha ?? null, archetype: input.archetype ?? null,
    locked: arr(input.locked), defences: arr(input.defences), text_sha: sha(text), text_chars: text.length,
    dispatched: false, dispatch_id: null, by: 'ide:hud', text };
}

const rm = (v) => (v == null ? null : String(v));
const ID_RE = /\b(?:declared \d+ rows?: |bound to )(C\d+[a-z]?)/;
// (a) row_id from the per-row steer log (the id steer.mjs prints when it declares the frozen text), (b) dispatched when a runner dispatch row
// matches by text_sha first, else by label === row_id.
export function markDispatched(rows, runnerRows, readLog = () => '') {
  const hits = new Map(); const byLabel = new Map();
  for (const r of runnerRows || []) {
    if (!r || r.kind !== 'dispatch') continue;
    const k = r.text_sha || (r.snowball && r.snowball.text_sha) || r.snowball_sha256 || r.snowball_sha;
    if (k && !hits.has(k)) hits.set(k, rm(r.dispatch_id));
    if (r.label && !byLabel.has(r.label)) byLabel.set(r.label, rm(r.dispatch_id));
  }
  return rows.map((row) => {
    if (row.dispatched) return row;
    let n = { ...row };
    if (!n.row_id) { const m = ID_RE.exec(String(readLog(row.text_sha) || '')); n.row_id = m ? m[1] : null; }
    if (hits.has(n.text_sha)) return { ...n, dispatched: true, dispatch_id: hits.get(n.text_sha), sync_why: null };
    if (n.row_id && byLabel.has(n.row_id)) return { ...n, dispatched: true, dispatch_id: byLabel.get(n.row_id), sync_why: null };
    n.sync_why = n.row_id ? 'no runner dispatch row for ' + n.row_id + ' yet' : 'no row id declared yet';
    return n;
  });
}

export function readRows(p = ledgerPath()) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function writeRows(rows, p = ledgerPath()) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  renameSync(tmp, p);
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a.startsWith('--')) o[a.slice(2).replace(/-/g, '_')] = argv[++i];
    else o._.push(a);
  }
  return o;
}
const jarr = (v) => { if (v == null) return []; try { return arr(JSON.parse(v)); } catch { return arr(v); } };
const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };

function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  const out = (x) => console.log(JSON.stringify(x));
  if (cmd === 'freeze') {
    let raw = readStdin(); let input = { text: raw };
    let served = null;
    if (raw.trim().startsWith('{')) { try { const j = JSON.parse(raw); if (j && j.row && typeof j.row === 'object') served = j; else if (j && typeof j.text === 'string') input = j; } catch {} }
    if (served) {
      const row = rowFromServer(served);
      if (!row.text.trim()) { out({ ok: false, reason: 'empty text', why: 'empty text: nothing to freeze' }); process.exit(2); }
      mkdirSync(dirname(ledgerPath()), { recursive: true });
      appendFileSync(ledgerPath(), JSON.stringify(row) + '\n');
      out(row); return;
    }
    if (o.window_sha) input.window_sha = o.window_sha; if (o.archetype) input.archetype = o.archetype;
    if (o.locked) input.locked = jarr(o.locked); if (o.defences) input.defences = jarr(o.defences);
    if (!String(input.text || '').trim()) { out({ ok: false, reason: 'empty text', why: 'empty text: nothing to freeze' }); process.exit(2); }
    const row = rowFor(input);
    mkdirSync(dirname(ledgerPath()), { recursive: true });
    appendFileSync(ledgerPath(), JSON.stringify(row) + '\n');
    out(row); return;
  }
  if (cmd === 'freeze-worm') {
    let input = {};
    try { input = JSON.parse(readStdin()); } catch { input = {}; }
    const row = freezeWormCell(input);
    if (row.ok === false) { out(row); process.exit(2); }
    out(row); return;
  }
  if (cmd === 'dispatch') {
    if (!allowsDispatch(o.by)) { out({ ok: false, reason: `REFUSED: origin "${o.by || 'none'}" is not key|click — a voice-shaped message never dispatches` }); process.exit(3); }
    const rows = readRows(); const row = rows.slice().reverse().find((r) => r.text_sha === o._[1]);
    if (!row) { out({ ok: false, reason: 'no such text_sha', why: `no snowball row has text_sha '${String(o._[1] || '')}'` }); process.exit(2); }
    const cli = process.env.VNA_STEER_CLI || resolve(HERE, 'steer.mjs');
    mkdirSync(logDir(), { recursive: true });
    const fd = openSync(resolve(logDir(), row.text_sha + '.log'), 'a');
    const child = spawn(process.execPath, [cli, row.text, '--driver', 'claude'], { detached: true, stdio: ['ignore', fd, fd], cwd: REPO });
    closeSync(fd);
    child.unref();
    out({ ...row, spawned: true }); return;
  }
  if (cmd === 'sync') {
    const rows = readRows(); const rr = existsSync(runnerPath()) ? readFileSync(runnerPath(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
    const next = markDispatched(rows, rr, (h) => { try { return readFileSync(resolve(logDir(), h + '.log'), 'utf8'); } catch { return ''; } });
    if (rows.length) writeRows(next);
    out({ ok: true, rows: next.length, dispatched: next.filter((r) => r.dispatched).length }); return;
  }
  if (cmd === 'list') { const rows = readRows(); out({ count: rows.length, rows }); return; }
  const why = cmd ? `unknown command '${String(cmd).slice(0, 40)}'` : 'no command given';
  out({ ok: false, reason: `${why}: usage is hud-snowball.mjs freeze|freeze-worm|dispatch <text_sha> --by key|click|sync|list [--json]`, why }); process.exit(2);
}
// C751 an unreadable or unwritable ledger, a corrupt flag, anything thrown: exit 2 with {ok:false, reason, why} and no stack trace
// C1389: realpath both sides — argv[1] under a symlinked tmpdir (macOS /var/folders → /private/var) is not import.meta.url's
// canonical path, and a door that silently does nothing and exits 0 is the one output an npx door may never produce.
const isMainModule = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMainModule) {
  try { main(); } catch (e) {
    const why = `UNMEASURED: ${e && e.code ? e.code + ' ' : ''}${String(e && e.message || e).split('\n')[0].slice(0, 160)}`;
    console.log(JSON.stringify({ ok: false, reason: why, why })); process.exit(2);
  }
}
