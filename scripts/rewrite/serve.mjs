#!/usr/bin/env node
// scripts/rewrite/serve.mjs — the Ghost-Read Matrix, standalone.
//
// WHY THIS EXISTS. The tool grew up inside a Next.js app, which meant it could only
// run for one person in one repo. Nothing about the engine needs Next: it is a
// worker, a mailbox of JSON files, and a page. So this is a dependency-free node
// http server that serves the same API and a single-file UI, which is what makes
// `npx thetacog rewrite <file>` possible for someone who has never seen this repo.
//
//   node scripts/rewrite/serve.mjs [--file <path>] [--port 4319] [--tracks A,B,C,D]
//
// LOCAL ONLY. It edits files and makes git commits. It binds 127.0.0.1 and refuses
// any request whose Host is not loopback. This is a writing instrument for one
// person on one machine, not a service.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.cwd();                      // the project being edited
const PKG = path.resolve(HERE, '..', '..');      // thetacog-mcp itself

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', process.env.REWRITE_PORT || 4319));
const OPEN_FILE = arg('--file', '');
const TRACKS = arg('--tracks', 'A,B,C,D');

const store = await import(path.join(HERE, 'store.mjs'));
const resolveT = await import(path.join(HERE, 'resolve-target.mjs'));
const chunker = await import(path.join(HERE, 'chunker.mjs'));
const tesseract = await import(path.join(HERE, 'tesseract.mjs'));
const llm = await import(path.join(HERE, 'llm.mjs'));
const readability = await import(path.join(HERE, 'readability.mjs'));
const attribution = await import(path.join(HERE, 'attribution.mjs'));
const models = await import(path.join(HERE, 'models.mjs'));
const sensemaker = await import(path.join(HERE, 'sensemake.mjs'));
const metricsMod = await import(path.join(HERE, 'metrics.mjs'));
const commitQueue = await import(path.join(HERE, 'commit-queue.mjs'));

const CACHE = store.CACHE_DIR;
const MAILBOX = path.join(CACHE, 'mailbox');
const slugFor = (f) => path.basename(f).replace(/[^\w.-]+/g, '-') || 'session';
const boxFor = (f) => path.join(MAILBOX, slugFor(f));
const sessionFile = (f) => path.join(CACHE, `session-${slugFor(f)}.json`);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function workerStatus(file) {
  const w = readJson(path.join(boxFor(file), 'worker.json'));
  if (!w?.pid) return { alive: false, worker: null };
  const fresh = Date.now() - new Date(w.heartbeat || 0).getTime() < 90_000;
  if (!fresh) return { alive: false, worker: w };
  try { process.kill(w.pid, 0); } catch { return { alive: false, worker: w }; }
  return { alive: true, worker: w };
}

function startWorker(file, { aperture = 0, tracks = TRACKS, threshold = 80 } = {}) {
  fs.mkdirSync(boxFor(file), { recursive: true });
  const out = fs.openSync(path.join(boxFor(file), 'worker.log'), 'a');
  const child = spawn(process.execPath, [
    path.join(HERE, 'worker.mjs'), '--file', file, '--repo', REPO,
    '--aperture', String(aperture), '--tracks', tracks, '--threshold', String(threshold),
  ], { cwd: REPO, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  return child.pid;
}

async function command(file, payload, timeoutMs = 120_000) {
  const box = boxFor(file);
  fs.mkdirSync(box, { recursive: true });
  const id = randomUUID().slice(0, 12);
  fs.writeFileSync(path.join(box, `cmd-${Date.now()}-${id}.json`), JSON.stringify({ id, ...payload }));
  const resPath = path.join(box, `res-${id}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(resPath)) {
      const r = readJson(resPath);
      try { fs.unlinkSync(resPath); } catch {}
      return r;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return { ok: false, error: 'worker did not answer in time' };
}

function stateFor(file) {
  const session = readJson(sessionFile(file));
  const { alive, worker } = workerStatus(file);
  if (!session) return { open: false, workerAlive: alive };
  return {
    open: true, workerAlive: alive, workerPid: worker?.pid ?? null,
    file: session.file, relFile: path.relative(REPO, session.file),
    aperture: session.aperture, cursor: session.cursor,
    totalParagraphs: session.totalParagraphs, totalLines: session.totalLines,
    tracks: session.tracks, paused: !!session.paused,
    buffer: worker?.buffer || { have: session.cards?.length || 0, target: 10, generating: 0, scanning: 0, pending: 0 },
    cards: session.cards || [], scanned: session.scanned || {}, edits: session.edits || [],
    stats: session.stats || {}, timing: session.timing || {},
    friction: readability.frictionSeries(session.scanned || {}, session.edits || []),
    attribution: (() => { try { return attribution.attributionSummary(session.file); } catch { return null; } })(),
    lastError: worker?.lastError ?? null,
    // the commit queue, so the page can say "3 queued · last a1b2c3d" instead of leaving the writer
    // to guess whether an accepted edit ever reached git.
    commits: commitQueue.queueStatus(CACHE),
  };
}

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.end(s);
};

const server = http.createServer(async (req, res) => {
  // Loopback only. The API writes files and makes commits.
  const host = (req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return json(res, 403, { error: 'loopback only' });

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/rewrite')) {
    const html = fs.readFileSync(path.join(HERE, 'ui.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  if (req.method === 'GET' && url.pathname === '/api') {
    const action = url.searchParams.get('action') || 'state';
    try {
      if (action === 'health') {
        const [h, t] = await Promise.all([llm.health(), tesseract.isAvailable()]);
        return json(res, 200, { ...h, tesseract: t, repoRoot: REPO, pkg: PKG });
      }
      if (action === 'targets') return json(res, 200, resolveT.listTargets(REPO));
      // the model roster is a read — the UI fetches it on load to draw the button bar.
      if (action === 'models') return json(res, 200, { ok: true, models: await models.roster({ force: url.searchParams.get('force') === '1' }) });
      // THE MEASURES STRIP. Everything the instrument can honestly say about itself right now, and a
      // named reason for everything it cannot say yet.
      if (action === 'metrics') {
        const rows = store.readLedger({ limit: 100000 });
        const cands = [];
        try {
          for (const f of fs.readdirSync(CACHE)) {
            if (!f.startsWith('session-') || !f.endsWith('.json')) continue;
            const sess = readJson(path.join(CACHE, f));
            for (const c of sess?.cards || []) for (const cd of c.candidates || []) cands.push(cd);
          }
        } catch { /* no sessions yet */ }
        return json(res, 200, metricsMod.computeMetrics({
          rows, winRates: store.winRates({}), readability: readability.ledgerReadability(rows),
          candidates: cands, modelStats: models.modelStats(),
        }));
      }
      if (action === 'winrates') {
        const rows = store.readLedger({ limit: 100000 });
        return json(res, 200, { ...store.winRates({}), readability: readability.ledgerReadability(rows) });
      }
      if (action === 'state') {
        const f = url.searchParams.get('file');
        if (!f) return json(res, 400, { error: 'file required' });
        return json(res, 200, stateFor(path.resolve(f)));
      }
      return json(res, 400, { error: `unknown action ${action}` });
    } catch (e) { return json(res, 500, { error: String(e.message) }); }
  }

  if (req.method === 'POST' && url.pathname === '/api') {
    let raw = '';
    for await (const c of req) raw += c;
    let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad json' }); }
    const { action } = body || {};
    try {
      if (action === 'open') {
        const r = resolveT.resolveTarget(body.target || body.file, REPO);
        if (!r.ok) return json(res, 404, { error: r.error, suggestions: r.suggestions || [] });
        const file = path.resolve(r.file);
        let aperture = 0;
        if (typeof body.aperture === 'number') aperture = body.aperture;
        else if (body.startAt) {
          const { paragraphs } = chunker.extractProse(fs.readFileSync(file, 'utf8'), { filename: file });
          aperture = resolveT.apertureFor(paragraphs, body.startAt);
        }
        const { alive } = workerStatus(file);
        if (!alive) {
          startWorker(file, { aperture, tracks: (body.tracks || TRACKS.split(',')).join?.(',') || TRACKS });
          for (let i = 0; i < 40 && !fs.existsSync(sessionFile(file)); i++) await new Promise((r2) => setTimeout(r2, 150));
        }
        return json(res, 200, { ok: true, label: r.label, ...stateFor(file) });
      }

      if (action === 'resolve') {
        const byName = resolveT.findByFilename(body.target || '', REPO);
        if (byName.ok) return json(res, 200, { ok: true, file: byName.file, relFile: path.relative(REPO, byName.file), label: byName.label });
        if (byName.ambiguous) return json(res, 200, { ok: false, error: byName.error, matches: byName.matches });
        const r = resolveT.resolveTarget(body.target || '', REPO);
        return r.ok
          ? json(res, 200, { ok: true, file: r.file, relFile: path.relative(REPO, r.file), label: r.label })
          : json(res, 200, { ok: false, error: r.error });
      }

      if (action === 'pick') {
        // The OS picker, because a path field with no picker is a field you paste into wrong.
        // macOS only; everywhere else the field is still the way in, which is why this fails soft.
        if (process.platform !== 'darwin') return json(res, 200, { error: 'native picker is macOS-only — paste the path' });
        const script = `POSIX path of (choose file with prompt "Ghost-Read Matrix — choose a file to edit" default location POSIX file "${REPO}")`;
        const picked = await new Promise((resolve) => {
          const p = spawn('osascript', ['-e', script]);
          let out = ''; p.stdout.on('data', (d) => { out += d; });
          p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
        });
        if (!picked) return json(res, 200, { error: 'cancelled' });
        return json(res, 200, { ok: true, file: picked, relFile: path.relative(REPO, picked) });
      }

      const file = body.file ? path.resolve(body.file) : null;
      if (!file) return json(res, 400, { error: 'file required' });

      if (action === 'shuffle') {
        // The lattice draw: cells this passage does NOT hold, from the real 144-cell library.
        // Two jobs from one draw — a null control (every other number compares the passage to
        // itself, so "coverage 31" has no floor under it) and a concrete provocation.
        const session = readJson(sessionFile(file));
        const card = session?.cards?.find((c) => c.id === body.cardId) || session?.cards?.[0];
        const text = card?.window?.text || card?.finding?.text || '';
        if (!text) return json(res, 404, { error: 'nothing to draw against' });
        return json(res, 200, { ok: true, ...(await tesseract.latticeSample(text, { n: 4 })) });
      }

      if (action === 'encircle') {
        const session = readJson(sessionFile(file));
        const card = session?.cards?.find((c) => c.id === body.cardId);
        if (!card?.window) return json(res, 404, { error: 'card not found' });
        const w = card.window;
        const draft = String(body.text ?? card.finding.text);
        const reality = w.text.slice(0, w.sentenceInWindow.start) + draft + w.text.slice(w.sentenceInWindow.end);
        const panels = await tesseract.pipelinePanels(w.text, reality);
        return json(res, 200, { ok: true, panels });
      }

      // THE MODEL BAR. One roster, discovered — the UI greys out what is not answering rather than
      // offering a button that fails on click.
      if (action === 'models') return json(res, 200, { ok: true, models: await models.roster({ force: !!body.force }) });

      // SENSEMAKE — ask ONE named model to improve what is in the edit box, with the context the
      // operator ticked. When `tesseract` is on the model is handed the SAME panel numbers the
      // encircled PNG is drawn from, so a wrong panel shows up as suggestions that argue with it.
      if (action === 'sensemake') {
        const session = readJson(sessionFile(file));
        const card = session?.cards?.find((c) => c.id === body.cardId);
        if (!card?.window) return json(res, 404, { error: 'card not found' });
        const w = card.window;
        const draft = String(body.text ?? card.finding.text);
        const context = { ...sensemaker.DEFAULT_CONTEXT, ...(body.context || {}) };

        // the panel is only computed when it was asked for — it costs a walk.
        let panels = null;
        if (context.tesseract) {
          const reality = w.text.slice(0, w.sentenceInWindow.start) + draft + w.text.slice(w.sentenceInWindow.end);
          panels = await tesseract.pipelinePanels(w.text, reality);
        }
        const r = await sensemaker.sensemake({
          modelId: body.model || models.DEFAULT_MODEL_ID,
          draft, card, window: w, panels,
          context, n: Number(body.n) || 4,
          picked: body.picked || null, steer: body.steer || null,
        });
        return json(res, r.ok ? 200 : 502, { ...r, panels });
      }

      if (['accept', 'skip', 'tracks', 'aperture', 'pause', 'stop', 'reset', 'drop', 'drops', 'regenerate', 'select'].includes(action)) {
        const { alive } = workerStatus(file);
        if (!alive) return json(res, 409, { error: 'no worker running — open the file first' });
        const budget = action === 'accept' ? 180_000 : ['drop', 'regenerate'].includes(action) ? 300_000 : 20_000;
        const r = await command(file, body, budget);
        return json(res, 200, { ...r, state: stateFor(file) });
      }
      return json(res, 400, { error: `unknown action ${action}` });
    } catch (e) { return json(res, 500, { error: String(e.message) }); }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}/rewrite`;
  console.log(`\n  ◧ GHOST-READ MATRIX — the anti-slop writing console`);
  console.log(`     ${url}\n`);
  const h = await llm.health().catch(() => null);
  const t = await tesseract.isAvailable().catch(() => null);
  const dot = (ok) => (ok ? '\x1b[0;32m●\x1b[0m' : '\x1b[0;31m○\x1b[0m');
  if (h) {
    console.log(`     ${dot(h.local?.available)} local ${h.local?.model || ''}`);
    console.log(`     ${dot(h.cloud?.available)} cloud ${h.cloud?.model || ''}`);
  }
  console.log(`     ${dot(t?.available)} tesseract ${t?.available ? '(rust chip)' : '(unavailable)'}\n`);
  if (OPEN_FILE) {
    const r = resolveT.resolveTarget(OPEN_FILE, REPO);
    if (r.ok) {
      const file = path.resolve(r.file);
      if (!workerStatus(file).alive) startWorker(file, { tracks: TRACKS });
      console.log(`     opened ${path.relative(REPO, file)}\n`);
      spawn('open', [`${url}?target=${encodeURIComponent(path.relative(REPO, file))}`], { stdio: 'ignore' }).unref();
    } else {
      console.error(`     ✗ ${r.error}\n`);
    }
  }
});
