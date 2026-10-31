#!/usr/bin/env node
// scripts/rewrite/worker.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE MAILBOX WORKER — the engine, detached from the web server.
//
// WHY THIS EXISTS. The first cut ran the engine inside the Next dev server as a
// module singleton. Three things broke it, all of them fatal to "keep 10 cards
// ahead of the writer":
//   1. A diagnose costs 30-120s. Anything sharing that process waits on it.
//   2. Next's hot reload discards module state, silently orphaning the engine.
//   3. Editing any engine file cache-busted the import and stopped the run.
//
// So the engine moved out here, into a detached long-lived process, and the two
// sides talk through a directory — the mailbox pattern this repo already uses for
// the mesh and the outreach outbox:
//
//   mailbox/<slug>/
//     worker.json      heartbeat + pid          (worker writes, API reads)
//     cmd-*.json       commands                 (API writes, worker consumes)
//     res-<id>.json    command results          (worker writes, API reads)
//   session-<slug>.json  full state             (worker writes, API reads)
//
// The API never blocks on an LLM again: it reads a file for state and drops a
// file to command. The worker survives dev-server restarts, HMR, and edits to the
// page. Kill the server and the stack keeps filling.
//
//   node scripts/rewrite/worker.mjs --file <abs path> [--aperture N] [--tracks A,B,C,D]
//        [--threshold 80] [--once]
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { RewriteEngine } from './engine.mjs';
import { CACHE_DIR, slugForFile, saveSession } from './store.mjs';
import { drain as drainCommits } from './commit-queue.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

const FILE = arg('--file');
if (!FILE || !fs.existsSync(FILE)) { console.error('✗ worker: need --file <existing path>'); process.exit(1); }

const REPO = arg('--repo', process.cwd());
const SLUG = slugForFile(FILE);
const BOX = path.join(CACHE_DIR, 'mailbox', SLUG);
fs.mkdirSync(BOX, { recursive: true });

const WORKER_JSON = path.join(BOX, 'worker.json');

// ── single-writer lock ──────────────────────────────────────────────────────
// Two workers on one file would both splice edits and both write the session;
// the loser's edits would vanish. A stale heartbeat (>90s) is treated as dead.
function existingWorker() {
  try {
    const w = JSON.parse(fs.readFileSync(WORKER_JSON, 'utf8'));
    if (!w?.pid) return null;
    const fresh = Date.now() - new Date(w.heartbeat || 0).getTime() < 90_000;
    if (!fresh) return null;
    try { process.kill(w.pid, 0); } catch { return null; } // not running
    return w;
  } catch { return null; }
}

const prior = existingWorker();
if (prior && prior.pid !== process.pid) {
  console.log(JSON.stringify({ ok: true, alreadyRunning: true, pid: prior.pid }));
  process.exit(0);
}

const engine = new RewriteEngine({
  repoRoot: REPO,
  file: path.resolve(FILE),
  aperture: parseInt(arg('--aperture', '0'), 10) || 0,
  tracks: arg('--tracks', 'A,B,C,D').split(',').map((s) => s.trim()).filter(Boolean),
  threshold: parseInt(arg('--threshold', '80'), 10),
});

function heartbeat(extra = {}) {
  const st = engine.state();
  fs.writeFileSync(WORKER_JSON, JSON.stringify({
    pid: process.pid,
    file: path.resolve(FILE),
    slug: SLUG,
    heartbeat: new Date().toISOString(),
    startedAt: START,
    cards: st.cards.length,
    cursor: st.cursor,
    totalParagraphs: st.totalParagraphs,
    buffer: st.buffer,
    lastError: st.lastError,
    ...extra,
  }, null, 2));
}

const START = new Date().toISOString();
engine.start();
heartbeat();
console.log(JSON.stringify({ ok: true, pid: process.pid, slug: SLUG, mailbox: BOX }));

// ── command loop ────────────────────────────────────────────────────────────
let stopping = false;
async function drainCommands() {
  let files;
  try { files = fs.readdirSync(BOX).filter((f) => f.startsWith('cmd-') && f.endsWith('.json')); }
  catch { return; }
  files.sort();

  for (const f of files) {
    const p = path.join(BOX, f);
    let cmd;
    try { cmd = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { try { fs.unlinkSync(p); } catch {} continue; }
    // Consume before executing: a command that throws must not be retried forever.
    try { fs.unlinkSync(p); } catch {}

    const id = cmd.id || f.replace(/^cmd-|\.json$/g, '');
    let result;
    try {
      switch (cmd.action) {
        case 'accept':
          result = await engine.accept({
            cardId: cmd.cardId, text: cmd.text, winner: cmd.winner,
            commit: cmd.commit !== false,
            monologueGrade: cmd.monologueGrade ?? null,
            monologueNote: cmd.monologueNote || '',
            blind: cmd.blind ?? null,
            via: cmd.via || null,   // which model button the wording came from, if any
          });
          break;
        case 'skip':
          result = engine.skip(cmd.cardId);
          break;
        case 'tracks':
          engine.setTracks(Array.isArray(cmd.tracks) ? cmd.tracks : []);
          result = { ok: true };
          break;
        case 'aperture':
          // clearQueue only when explicitly asked — see engine.setAperture().
          result = { ok: true, aperture: engine.setAperture(Number(cmd.paragraphIndex) || 0, { clearQueue: !!cmd.clearQueue }) };
          break;
        case 'reset':
          result = engine.reset();
          break;
        case 'select':
          result = await engine.selectSpan(cmd.text, cmd.note || '');
          break;
        case 'regenerate':
          result = await engine.regenerate(cmd.cardId, cmd.direction);
          break;
        case 'drop': {
          // A real reader's reaction: save it verbatim, let a subagent anchor it
          // to sentences, then queue those anchors ahead of the generated ones.
          const { addDrop, dropSummary } = await import('./drops.mjs');
          const saved = await addDrop({
            file: engine.file, text: cmd.text, source: cmd.source || '',
            kind: cmd.kind || 'review', sentences: engine.flatSentences(),
          });
          const queued = saved.ok ? engine.loadDrops() : 0;
          result = { ...saved, queued, summary: dropSummary(engine.file) };
          break;
        }
        case 'drops': {
          const { dropSummary } = await import('./drops.mjs');
          result = { ok: true, summary: dropSummary(engine.file) };
          break;
        }
        case 'pause':
          engine.session.paused = !!cmd.paused;
          saveSession(engine.session);
          result = { ok: true };
          break;
        case 'stop':
          stopping = true;
          result = { ok: true };
          break;
        default:
          result = { ok: false, error: `unknown action ${cmd.action}` };
      }
    } catch (err) {
      result = { ok: false, error: String(err?.message || err) };
    }
    try {
      fs.writeFileSync(path.join(BOX, `res-${id}.json`), JSON.stringify({ id, ts: new Date().toISOString(), ...result }));
    } catch {}
  }
}

/** Delete result files nobody collected, so the mailbox does not grow forever. */
function sweepResults() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(BOX)) {
      if (!f.startsWith('res-')) continue;
      const p = path.join(BOX, f);
      if (now - fs.statSync(p).mtimeMs > 10 * 60_000) fs.unlinkSync(p);
    }
  } catch {}
}

const ONCE = process.argv.includes('--once');
let ticks = 0;
const loop = setInterval(async () => {
  await drainCommands();
  heartbeat();
  // THE COMMIT QUEUE. Checked every 5s; the queue itself holds each batch until the burst settles,
  // so a writer committing three sentences in a row gets one commit rather than three. Errors are
  // recorded on the queue row and surfaced in state — never swallowed, never retried forever.
  if (ticks % 5 === 0) {
    // `CACHE_DIR`, not `store.CACHE_DIR` — this file uses named imports and there is no `store`
    // binding here. It threw a ReferenceError every five seconds for the life of every worker,
    // was caught, logged, and never surfaced: THE COMMIT QUEUE NEVER DRAINED. Every edit the
    // writer committed in the console was queued and never reached git, while the UI said
    // "one atomic git commit, tagged". A swallowed error in a periodic tick is invisible by
    // construction — the log line scrolls, and the missing commits look like nothing happening.
    try { await drainCommits({ cacheDir: CACHE_DIR, repoRoot: REPO, log: (m) => console.log(m) }); }
    catch (e) { console.log(`commit drain error: ${e.message}`); }
  }
  if (++ticks % 30 === 0) sweepResults();
  if (stopping || (ONCE && engine.session.cards.length >= 10)) {
    clearInterval(loop);
    engine.stop();
    heartbeat({ stopped: true });
    process.exit(0);
  }
}, 1000);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    engine.stop();
    try { heartbeat({ stopped: true }); } catch {}
    process.exit(0);
  });
}
// Detached from a terminal that later closes — do not die with it.
process.on('SIGHUP', () => {});
