#!/usr/bin/env node
// packages/thetacog-mcp/scripts/tape/serve.mjs — standalone http mirror of /tape's API.
//
// WHY THIS EXISTS. Same reason as scripts/rewrite/serve.mjs: the Next console (R5)
// and cli.mjs (R6, terminal parity) both need one API surface that works whether or
// not `npm run dev` is up. This is a dependency-free node http server binding
// 127.0.0.1 ONLY — a writing/dispatch instrument for one person on one machine.
//
//   node scripts/tape/serve.mjs [--port 4321]
//
// GET  /api?action=health
// GET  /api?action=sessions
// GET  /api?action=state&slug=<slug>
// GET  /api?action=doc&slug=<slug>&source=<abs-or-rel-path>
// POST /api  { action: 'open'|'step'|'walk'|'pick'|'drop'|'reintroduce'|'editAtom'|
//              'decide'|'editPrompt'|'dispatch'|'steer'|'speak'|'pause'|'resume'|
//              'stop'|'report', slug, ... }
//
// POST actions route to the per-slug detached worker via the mailbox (spawned on
// first 'open' if not already running) and bounded-poll for the result: 20s for
// most verbs, 180s for 'open' (Lane-B ingest / first full segmentation) and
// 'dispatch' (subagents can run for minutes).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', process.env.TAPE_PORT || 4321));

const store = await import(path.join(HERE, 'store.mjs'));

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function boxFor(slug) { return path.join(store.sessionPath(slug), 'mailbox'); }
function workerJsonPath(slug) { return path.join(boxFor(slug), 'worker.json'); }

function workerStatus(slug) {
  const w = readJson(workerJsonPath(slug));
  if (!w?.pid) return { alive: false, worker: null };
  const fresh = Date.now() - new Date(w.heartbeat || 0).getTime() < 90_000;
  if (!fresh) return { alive: false, worker: w };
  try { process.kill(w.pid, 0); } catch { return { alive: false, worker: w }; }
  return { alive: true, worker: w };
}

function startWorker(slug, { sources = [] } = {}) {
  fs.mkdirSync(boxFor(slug), { recursive: true });
  const out = fs.openSync(path.join(boxFor(slug), 'worker.log'), 'a');
  const args = [path.join(HERE, 'worker.mjs'), '--slug', slug, '--repo', REPO];
  if (sources.length) args.push('--sources', JSON.stringify(sources));
  const child = spawn(process.execPath, args, { cwd: REPO, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  return child.pid;
}

async function command(slug, payload, timeoutMs = 20_000) {
  const box = boxFor(slug);
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
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok: false, error: `worker did not answer '${payload.action}' in ${timeoutMs}ms` };
}

function stateFor(slug) {
  const session = store.loadSession(slug);
  const { alive, worker } = workerStatus(slug);
  if (!session) return { open: false, workerAlive: alive };
  return {
    open: true, workerAlive: alive, workerPid: worker?.pid ?? null, workerHeavy: !!worker?.heavyInFlight,
    slug, sources: session.sources || [], cursor: session.cursor ?? 0, totalTurns: session.totalTurns ?? null,
    totalLines: session.totalLines ?? null, home: session.home || { coord: null, decidedFrom: 0 },
    paused: !!session.paused, steering: session.steering || [],
    stats: store.stats(slug),
    atoms: store.resolveAtoms(slug),
    decisions: store.readDecisions(slug),
    dispatches: store.readDispatches(slug),
    vega: store.readVega(slug),
    lastError: worker?.lastError ?? null,
  };
}

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.end(s);
};

const server = http.createServer(async (req, res) => {
  // Loopback only — this instrument dispatches subagents and makes commits.
  const host = (req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return json(res, 403, { error: 'loopback only' });

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api') {
    const action = url.searchParams.get('action') || 'sessions';
    try {
      if (action === 'health') {
        const bin = path.resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip');
        return json(res, 200, { ok: true, repoRoot: REPO, pmuOnchip: fs.existsSync(bin), port: PORT });
      }
      if (action === 'sessions') return json(res, 200, { sessions: store.listSessions() });
      if (action === 'state') {
        const slug = url.searchParams.get('slug');
        if (!slug) return json(res, 400, { error: 'slug required' });
        return json(res, 200, stateFor(slug));
      }
      if (action === 'doc') {
        const slug = url.searchParams.get('slug');
        const source = url.searchParams.get('source');
        if (!slug || !source) return json(res, 400, { error: 'slug and source required' });
        const session = store.loadSession(slug);
        if (!session) return json(res, 404, { error: `no session '${slug}'` });
        const abs = path.isAbsolute(source) ? source : path.resolve(REPO, source);
        const known = (session.sources || []).includes(abs) || (session.steering || []).some((r) => r.kind === 'path' && r.value === abs);
        if (!known) return json(res, 404, { error: 'source is not part of this session' });
        try {
          const text = fs.readFileSync(abs, 'utf8');
          // Both names, deliberately: route.ts answers `totalLines` and this door answered
          // `lines`. One documented action with two response shapes is a console that works
          // through one door and silently not the other, so both are emitted and equal.
          const n = text.length ? text.split('\n').length : 0;
          return json(res, 200, { ok: true, slug, source: abs, text, lines: n, totalLines: n });
        } catch (e) { return json(res, 404, { error: `cannot read source: ${e.message}` }); }
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
        const sources = Array.isArray(body.sources) ? body.sources.map((s) => (path.isAbsolute(s) ? s : path.resolve(REPO, s))) : [];
        const slug = body.slug || (sources[0] ? store.slugify(sources[0]) : null);
        if (!slug) return json(res, 400, { error: 'slug or sources required' });
        const { alive } = workerStatus(slug);
        if (!alive) {
          startWorker(slug, { sources });
          for (let i = 0; i < 60 && !fs.existsSync(path.join(store.sessionPath(slug), 'session.json')); i++) await new Promise((r) => setTimeout(r, 150));
        }
        const r = await command(slug, { action: 'open', sources }, 180_000);
        return json(res, 200, { ...r, state: stateFor(slug) });
      }

      const slug = body.slug;
      if (!slug) return json(res, 400, { error: 'slug required' });
      // `paste` is the FRONT DOOR — the operator pastes a document and hits Enter. It was added to
      // route.ts's VERBS on 2026-08-20 and NOT here, which broke the two-doors contract within the
      // hour: S5 caught it as "one door has a button the other refuses". The terminal and the page
      // must expose the same verb list or the CLI silently cannot do a thing the page can.
      const KNOWN = ['paste', 'step', 'walk', 'pick', 'drop', 'reintroduce', 'editAtom', 'decide', 'editPrompt', 'dispatch', 'steer', 'speak', 'pause', 'resume', 'stop', 'report'];
      if (!KNOWN.includes(action)) return json(res, 400, { error: `unknown action ${action}` });

      const { alive } = workerStatus(slug);
      if (!alive) return json(res, 409, { error: `no worker running for '${slug}' — open the session first` });

      const timeoutMs = ['open', 'dispatch', 'walk'].includes(action) ? 180_000 : 20_000;
      const r = await command(slug, body, timeoutMs);
      return json(res, 200, { ...r, state: stateFor(slug) });
    } catch (e) { return json(res, 500, { error: String(e.message) }); }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ◧ /tape — the geometric ledger, standalone server`);
  console.log(`     http://localhost:${PORT}/api?action=sessions\n`);
});
