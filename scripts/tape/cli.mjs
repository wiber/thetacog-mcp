#!/usr/bin/env node
// packages/thetacog-mcp/scripts/tape/cli.mjs — the TERMINAL DOOR onto a tape session.
//
// The page and the terminal are two doors onto ONE session: same ndjson files, same atoms, same
// ledger, nothing to reconcile. Anything you can inspect or edit on the page you can do here, which
// matters because the console is where you steer and the terminal is where you are already standing.
//
// This reads and writes the session files DIRECTLY (no server needed) for everything that is a pure
// file operation. The three verbs that need the producer loop — walk, dispatch, speak — go through
// the worker mailbox instead, spawning the detached worker if one is not already up, because
// worker.mjs is the SINGLE state writer and a CLI that stepped the engine itself would be a second
// one the moment the console is also open.
//
//   node cli.mjs status <slug>
//   node cli.mjs atoms  <slug> [--type DECISION] [--status picked] [--sort drift|sigma|id|pos] [--limit N]
//   node cli.mjs atom   <slug> <id>
//   node cli.mjs edit   <slug> <id> --rule "..." | --priority P1 | --type CONSTRAINT
//   node cli.mjs pick|drop|reintroduce <slug> <id>
//   node cli.mjs decide <slug> <id> --verdict accept|reject|defer --reply "..." [--subagents N]
//   node cli.mjs prompt <slug> <id> [--set "..."]
//   node cli.mjs vega   <slug>
//   node cli.mjs walk   <slug> [--turns N]   (the REAL walk: one model call per turn, minutes not seconds)
//   node cli.mjs dispatch <slug> <id>        (fire the decided atom's subagents, then measure the commit back)
//   node cli.mjs speak  <slug> <id>          (read the rule aloud)
//   node cli.mjs report <slug>            (regenerates + prints the HTML paths)
//   node cli.mjs open   <slug>            (bash-opens the HTML reports)
//   any verb + --json for machine output

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

const argv = process.argv.slice(2);
const JSONOUT = argv.includes('--json');
const flag = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);

const C = JSONOUT ? new Proxy({}, { get: () => (s) => s }) : {
  dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m`,
};

const NAMES = {
  A: 'Strategy', B: 'Tactics', C: 'Operations',
  A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
  C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
};
// ALWAYS EXPAND COORDINATE LABELS — a bare rank is opaque to anyone who did not build the lattice.
const label = (coord) => {
  if (!coord) return 'UNMEASURED';
  const [r, c] = String(coord).split(',');
  return `${coord} (${NAMES[r] || r} ⊕ ${NAMES[c] || c})`;
};

const dirOf = (slug) => resolve(SESSIONS, slug);
const readJson = (slug, f, d) => { try { return JSON.parse(readFileSync(resolve(dirOf(slug), f), 'utf8')); } catch { return d; } };
const readNd = (slug, f) => { try { return readFileSync(resolve(dirOf(slug), f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const appendNd = (slug, f, row) => appendFileSync(resolve(dirOf(slug), f), JSON.stringify(row) + '\n');

// FORK-FORWARD: rows share ids; the last row per id is live, and an edit never mutates its parent.
// The whole audit value of the tape is that the superseded row is still there to read.
const liveAtoms = (slug) => {
  // LAST ROW WINS ENTIRELY, in first-appearance order — byte-for-byte the same rule as
  // store.mjs:resolveAtoms(). This used to shallow-MERGE each new row onto the old one,
  // which silently disagreed with the engine's resolver whenever an edit row omitted a
  // field: the terminal and the page would then render different atoms off one ledger,
  // which is exactly what "two doors onto ONE session" forbids.
  const order = [];
  const latest = new Map();
  for (const r of readNd(slug, 'specs.ndjson')) {
    if (!r?.id) continue;
    if (!latest.has(r.id)) order.push(r.id);
    latest.set(r.id, r);
  }
  return order.map((id) => latest.get(id));
};


// ── forkForward — the ONLY way this file may append to specs.ndjson ────────────────────────────
// THE CONTRACT, learned the hard way 2026-08-20: resolveAtoms() is LAST-ROW-WINS-ENTIRELY, so every
// row in specs.ndjson must be a COMPLETE atom. store.mjs:editAtom already honoured that ({...live,
// ...patch}); this CLI did not — it appended BARE PATCH rows. Two writers, two contracts, and the
// atom in between got annihilated: one edit plus one decide left DECISION-017 with no rule, no
// quote and no coord, which is a silent data-loss bug that only shows up when you finally read the
// atom back. Merge onto the live row, always.
function forkForward(slug, id, patch) {
  const live = liveAtoms(slug).find((a) => a.id === id);
  if (!live) die(`no atom '${id}' in ${slug}`);
  const next = { ...live, ...patch, id, parent_id: id, ts: new Date().toISOString() };
  appendNd(slug, 'specs.ndjson', next);
  return next;
}

function die(msg, code = 2) { console.error(C.r('✗ ') + msg); process.exit(code); }
function out(obj, human) { if (JSONOUT) console.log(JSON.stringify(obj, null, 2)); else human(); }

function listSessions() {
  try { return readdirSync(SESSIONS).filter((d) => existsSync(resolve(SESSIONS, d, 'session.json'))); }
  catch { return []; }
}

// ── verbs ──────────────────────────────────────────────────────────────────────────────────────
const verb = argv[0];
const slug = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;

if (!verb || has('--help') || verb === 'help') {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  console.log('sessions: ' + (listSessions().join(', ') || '(none)'));
  process.exit(0);
}
if (verb === 'sessions') { out({ sessions: listSessions() }, () => console.log(listSessions().join('\n') || C.dim('(no sessions)'))); process.exit(0); }
if (!slug) die(`verb '${verb}' needs a session slug. Known: ${listSessions().join(', ') || '(none)'}`);
if (!existsSync(dirOf(slug))) die(`no session '${slug}' under ${SESSIONS}`);

const S = readJson(slug, 'session.json', { slug });
const atoms = liveAtoms(slug);
const vega = readNd(slug, 'vega-series.ndjson');
const decisions = readNd(slug, 'decisions.ndjson');
const dispatches = readNd(slug, 'dispatches.ndjson');

if (verb === 'status') {
  const by = (k) => atoms.reduce((a, x) => (a[x[k]] = (a[x[k]] || 0) + 1, a), {});
  const payload = {
    slug, sources: S.sources || [], cursor: S.cursor ?? 0, totalTurns: S.totalTurns ?? null,
    home: S.home?.coord || null, homeLabel: S.home?.coord ? label(S.home.coord) : null,
    atoms: atoms.length, byStatus: by('status'), byType: by('type'),
    laneAuc: vega.at(-1)?.laneAuc ?? 0,
    departures: atoms.filter((a) => (a.laneDrift ?? 0) >= 2).length,
    contradictions: atoms.filter((a) => (a.contradicts || []).length).length,
    decisions: decisions.length, dispatches: dispatches.length,
    extraction: S.extraction || 'llm',
  };
  out(payload, () => {
    console.log(C.b(`\n  tape · ${slug}`));
    console.log(`  ${C.dim('sources')}   ${(S.sources || []).map((s) => String(s).replace(REPO + '/', '')).join(', ') || C.dim('none')}`);
    console.log(`  ${C.dim('walked')}    ${payload.cursor}/${payload.totalTurns ?? '?'} turns`);
    console.log(`  ${C.dim('home')}      ${payload.homeLabel || C.y('UNMEASURED — home needs more placed atoms')}`);
    console.log(`  ${C.dim('atoms')}     ${payload.atoms}  ${Object.entries(payload.byStatus).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log(`  ${C.dim('types')}     ${Object.entries(payload.byType).map(([k, v]) => `${k}:${v}`).join(' ') || C.dim('none')}`);
    console.log(`  ${C.dim('lane AUC')}  ${payload.laneAuc}   ${C.dim(`(${payload.departures} departures at king-move ≥2)`)}`);
    console.log(`  ${C.dim('flags')}     ${payload.contradictions} contradiction(s) · ${payload.decisions} decision(s) · ${payload.dispatches} dispatch(es)`);
    if (payload.extraction !== 'llm') console.log(`  ${C.y('note')}      extraction = ${payload.extraction}`);
    console.log('');
  });
  process.exit(0);
}

if (verb === 'atoms') {
  let rows = atoms;
  const t = flag('--type'), st = flag('--status');
  if (t) rows = rows.filter((a) => a.type === t);
  if (st) rows = rows.filter((a) => a.status === st);
  const sort = flag('--sort', 'pos');
  const key = { drift: (a) => -(a.laneDrift ?? -1), sigma: (a) => -(a.sigma ?? -1), id: (a) => a.id, pos: (a) => a.turn ?? 0 }[sort] || ((a) => a.turn ?? 0);
  rows = [...rows].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
  const lim = parseInt(flag('--limit', '0'), 10);
  if (lim > 0) rows = rows.slice(0, lim);
  out({ atoms: rows }, () => {
    if (!rows.length) return console.log(C.dim(`\n  no atoms match — the tape has walked ${S.cursor ?? 0}/${S.totalTurns ?? '?'} turns\n`));
    console.log('');
    for (const a of rows) {
      const d = a.laneDrift ?? null;
      const dc = d === null ? C.y('  ?') : d >= 3 ? C.r(String(d).padStart(3)) : d >= 2 ? C.y(String(d).padStart(3)) : C.g(String(d).padStart(3));
      const dropped = a.status === 'dropped';
      const line = `  ${C.c(a.id.padEnd(15))} ${String(a.type || '').padEnd(10)} L${String((a.chunk || [])[0] ?? '?').padStart(4)}  ${String(a.coord || '—').padEnd(6)} drift${dc}  ${String(a.status || '').padEnd(11)} ${String(a.rule || '').slice(0, 58)}`;
      console.log(dropped ? C.dim(line + '   (dropped — still on the tape)') : line);
      if ((a.contradicts || []).length) console.log(C.r(`      ⚠ contradicts ${a.contradicts.join(', ')}`));
    }
    console.log(C.dim(`\n  ${rows.length} shown · sorted by ${sort}${t ? ` · type=${t}` : ''}${st ? ` · status=${st}` : ''}\n`));
  });
  process.exit(0);
}

if (verb === 'atom') {
  const id = argv[2];
  const a = atoms.find((x) => x.id === id);
  if (!a) die(`no atom '${id}' in ${slug}`);
  const dec = decisions.filter((d) => d.atomId === id).at(-1);
  const dis = dispatches.filter((d) => d.atomId === id).at(-1);
  out({ atom: a, decision: dec || null, dispatch: dis || null }, () => {
    console.log(`\n  ${C.b(a.id)}  ${a.type}  ${a.priority || ''}  ${C.dim(a.status)}`);
    console.log(`  ${C.dim('rule')}       ${a.rule}`);
    console.log(`  ${C.dim('source')}     ${String(a.source || '').replace(REPO + '/', '')} lines ${(a.chunk || []).join('–')}`);
    console.log(`  ${C.dim('placement')}  ${label(a.coord)}   σ ${a.sigma ?? C.y('UNMEASURED')}  sensor ${a.sensor || C.y('none')}`);
    console.log(`  ${C.dim('lane drift')} ${a.laneDrift ?? C.y('UNMEASURED (home unset or unplaced)')}`);
    if (a.apertureFidelity) console.log(`  ${C.dim('extraction')} NCD ${a.apertureFidelity.ncd}${a.apertureFidelity.lowMass ? C.y(' (low-mass — read with the caveat)') : ''}`);
    if ((a.contradicts || []).length) console.log(`  ${C.r('contradicts')} ${a.contradicts.join(', ')}`);
    console.log(`\n  ${C.dim('── the verbatim quote ──')}`);
    console.log(String(a.quote || '').split('\n').map((l) => '  ' + l).join('\n').slice(0, 1600));
    if (a.falsifier) console.log(`\n  ${C.dim('falsifier')}\n  ${a.falsifier}`);
    if (dec) console.log(`\n  ${C.dim('decision')}  ${dec.verdict} · subagents ${dec.subagents ?? 0}${dec.spoken ? ' · spoken' : ''}\n  ${dec.reply || ''}`);
    if (dis?.prompt) console.log(`\n  ${C.dim('dispatch prompt')} (sha ${String(dis.promptSha || '').slice(0, 12)})\n${dis.prompt.split('\n').map((l) => '  ' + l).join('\n')}`);
    console.log('');
  });
  process.exit(0);
}

if (['pick', 'drop', 'reintroduce'].includes(verb)) {
  const id = argv[2]; const a = atoms.find((x) => x.id === id);
  if (!a) die(`no atom '${id}' in ${slug}`);
  const status = verb === 'pick' ? 'picked' : verb === 'drop' ? 'dropped' : 'reintroduced';
  forkForward(slug, id, { status, picked_by: 'operator' });
  out({ id, status }, () => console.log(C.g(`✓ ${id} → ${status}`) + C.dim('  (fork-forward: the prior row is still on the tape)')));
  process.exit(0);
}

if (verb === 'edit') {
  const id = argv[2]; const a = atoms.find((x) => x.id === id);
  if (!a) die(`no atom '${id}' in ${slug}`);
  const patch = { id, parent_id: id, ts: new Date().toISOString(), picked_by: 'operator' };
  if (flag('--rule')) patch.rule = flag('--rule');
  if (flag('--priority')) patch.priority = flag('--priority');
  if (flag('--type')) patch.type = flag('--type');
  if (Object.keys(patch).length <= 4) die('nothing to edit — pass --rule, --priority or --type');
  forkForward(slug, id, patch);
  out({ edited: patch }, () => {
    console.log(C.g(`✓ ${id} edited`) + C.dim('  (new row, parent_id set — the original is never mutated)'));
    if (patch.rule) console.log(C.y('  note: the rule changed, so its extraction-fidelity reading and contradiction shortlist are now stale — re-place this atom.'));
  });
  process.exit(0);
}

if (verb === 'decide') {
  const id = argv[2]; const a = atoms.find((x) => x.id === id);
  if (!a) die(`no atom '${id}' in ${slug}`);
  const verdict = flag('--verdict');
  if (!['accept', 'reject', 'defer'].includes(verdict)) die('--verdict must be accept, reject or defer');
  const row = {
    ts: new Date().toISOString(), atomId: id, verdict,
    reply: flag('--reply', ''), spoken: has('--speak'),
    subagents: parseInt(flag('--subagents', '0'), 10) || 0, commit: null,
  };
  appendNd(slug, 'decisions.ndjson', row);
  forkForward(slug, id, { status: 'decided', picked_by: 'operator' });
  if (has('--speak')) execFile('say', ['-v', 'Ava (Premium)', String(a.rule || '')], () => {});   // detached, never blocks
  out({ decision: row }, () => {
    console.log(C.g(`✓ ${id} decided: ${verdict}`) + (row.subagents ? C.dim(`  · ${row.subagents} subagent(s) requested`) : ''));
    if (verdict === 'accept' && !row.subagents) console.log(C.y('  note: accepted with 0 subagents — this rule will produce no artifact until one is dispatched.'));
  });
  process.exit(0);
}

if (verb === 'prompt') {
  const id = argv[2]; const set = flag('--set');
  const cur = dispatches.filter((d) => d.atomId === id).at(-1);
  if (set) {
    const row = { ts: new Date().toISOString(), atomId: id, prompt: set, promptSha: null, agents: cur?.agents ?? 0, agentType: 'claude', status: 'queued', resultSummary: '', commits: [], receiptPng: null };
    appendNd(slug, 'dispatches.ndjson', row);
    out({ dispatch: row }, () => console.log(C.g(`✓ prompt set for ${id}`) + C.dim('  (recorded verbatim — the tape shows exactly what the agent will be told)')));
  } else {
    out({ dispatch: cur || null }, () => cur?.prompt ? console.log('\n' + cur.prompt + '\n') : console.log(C.dim(`no dispatch prompt for ${id} yet — decide it first, or set one with --set`)));
  }
  process.exit(0);
}

if (verb === 'vega') {
  out({ series: vega, laneAuc: vega.at(-1)?.laneAuc ?? 0 }, () => {
    if (!vega.length) return console.log(C.dim('\n  no series yet — atoms must be placed first\n'));
    const max = Math.max(1, ...vega.map((v) => v.laneDrift || 0));
    const bars = ' ▁▂▃▄▅▆▇█';
    console.log(`\n  ${C.b('lane departure')}  ${C.dim('per-atom king-move distance from ' + label(S.home?.coord))}`);
    console.log('  ' + vega.map((v) => bars[Math.round(((v.laneDrift || 0) / max) * (bars.length - 1))]).join(''));
    console.log(`  ${C.dim('total lane AUC')} ${C.b(String(vega.at(-1)?.laneAuc ?? 0))}   ${C.dim('— cumulative area away from home')}`);
    const dep = vega.filter((v) => (v.laneDrift ?? 0) >= 2);
    if (dep.length) {
      console.log(`\n  ${C.y('departures')} ${C.dim('(king-move ≥2 — the other trade\'s lane)')}`);
      for (const v of dep) console.log(`    ${v.atomId.padEnd(15)} ${label(v.coord).padEnd(44)} drift ${v.laneDrift}`);
    }
    console.log(C.dim('\n  This is a decidable WHERE, computed with no model in the path. Off-lane is scope\n  breadth, not defect — it says where the tape went, not whether going there was wrong.\n'));
  });
  process.exit(0);
}

if (verb === 'report' || verb === 'open') {
  const { generateReports } = await import(resolve(HERE, 'html-report.mjs'));
  const files = generateReports(slug);
  if (verb === 'open') execFile('open', Object.values(files), () => {});
  out({ files }, () => { for (const [k, v] of Object.entries(files)) console.log(`  ${C.c(k.padEnd(10))} ${v}`); });
  process.exit(0);
}

// ── THE ENGINE VERBS — walk · dispatch · speak ────────────────────────────────
// These need the producer loop, so they go through the WORKER MAILBOX rather than
// touching state directly. That is not ceremony: worker.mjs is the SINGLE state
// writer, and a CLI that ran engine.step() itself would be a second writer on an
// append-only ledger the moment the console is also open. Same protocol as
// serve.mjs (cmd-<ts>-<id>.json in, res-<id>.json out) so the terminal and the
// page are genuinely two doors onto one session, not two implementations.
function boxFor(s) { return resolve(SESSIONS, s, 'mailbox'); }

function workerAlive(s) {
  try {
    const w = JSON.parse(readFileSync(resolve(boxFor(s), 'worker.json'), 'utf8'));
    if (!w?.pid) return null;
    if (Date.now() - new Date(w.heartbeat || 0).getTime() > 90_000) return null;
    try { process.kill(w.pid, 0); } catch { return null; }
    return w;
  } catch { return null; }
}

async function ensureWorker(s) {
  const live = workerAlive(s);
  if (live) return live;
  const S = readJson(s, 'session.json', null);
  const args = [resolve(HERE, 'worker.mjs'), '--slug', s, '--repo', REPO];
  if (S?.sources?.length) args.push('--sources', JSON.stringify(S.sources));
  mkdirSync(boxFor(s), { recursive: true });
  const log = openSync(resolve(boxFor(s), 'worker.log'), 'a');
  spawn(process.execPath, args, { cwd: REPO, detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 80; i++) {                       // up to 12s for the heartbeat to appear
    const w = workerAlive(s);
    if (w) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

async function command(s, payload, timeoutMs) {
  const box = boxFor(s);
  mkdirSync(box, { recursive: true });
  const id = randomUUID().slice(0, 12);
  writeFileSync(resolve(box, `cmd-${Date.now()}-${id}.json`), JSON.stringify({ id, slug: s, ...payload }));
  const resPath = resolve(box, `res-${id}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(resPath)) {
      let r = null;
      try { r = JSON.parse(readFileSync(resPath, 'utf8')); } catch {}
      try { unlinkSync(resPath); } catch {}
      return r;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: `the worker did not answer '${payload.action}' within ${Math.round(timeoutMs / 1000)}s — it may still be walking; check: node cli.mjs status ${s}` };
}

if (['walk', 'dispatch', 'speak'].includes(verb)) {
  if (!slug) die(`'${verb}' needs a session slug.`);
  if (!readJson(slug, 'session.json', null)) die(`no session '${slug}'. Walk a file first: ./scripts/tape.sh <file.txt>`);

  const w = await ensureWorker(slug);
  if (!w) die('could not start the worker — see .thetacog/tape-sessions/' + slug + '/mailbox/worker.log');

  if (verb === 'walk') {
    const maxTurns = parseInt(flag('--turns', ''), 10) || Infinity;
    const before = readJson(slug, 'session.json', null)?.cursor ?? 0;
    const budget = parseInt(flag('--timeout', ''), 10) * 1000 || 3_600_000;
    console.log(C.dim(`  worker pid ${w.pid} · walking from turn ${before}${Number.isFinite(maxTurns) ? ` for ${maxTurns} turns` : ' to the end'} — extraction is one model call per turn, so this is minutes, not seconds`));
    const r = await command(slug, { action: 'walk', maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined }, budget);
    if (!r?.ok) die(r?.error || 'walk failed');
    const S = readJson(slug, 'session.json', null);
    out(r, () => {
      console.log(C.g(`✓ walked ${r.steps} turn(s)`) + C.dim(`  cursor ${before} → ${S.cursor}/${S.totalTurns}`));
      const byType = {};
      for (const a of liveAtoms(slug)) byType[a.type] = (byType[a.type] || 0) + 1;
      console.log('  ' + (Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · ') || C.dim('no atoms')));
    });
    process.exit(0);
  }

  if (verb === 'speak') {
    const id = argv[2];
    if (!id) die('speak needs an atom id');
    const r = await command(slug, { action: 'speak', atomId: id }, 20_000);
    out(r, () => console.log(r?.spoke ? C.g('✓ spoken') : C.y('nothing to speak — no rule on that atom')));
    process.exit(0);
  }

  // dispatch
  const id = argv[2];
  if (!id) die('dispatch needs an atom id');
  const r = await command(slug, { action: 'dispatch', atomId: id }, 1_800_000);
  if (!r?.ok) die(r?.error || 'dispatch failed');
  out(r, () => {
    console.log(C.g(`✓ dispatched ${id}`));
    if (r.dispatch) console.log(`  ${C.dim('status')} ${r.dispatch.status} · ${C.dim('agents')} ${r.dispatch.agents} · ${C.dim('commits')} ${(r.dispatch.commits || []).join(', ') || '—'}`);
    if (r.enforcement) {
      const e = r.enforcement;
      console.log(`  ${C.dim('enforcement')} ${e.refused ? C.y('REFUSED — ' + e.reason) : `offPct ${e.offPct} · sigmaDrift ${e.sigmaDrift}`}`);
    } else {
      console.log('  ' + C.y('enforcement UNMEASURED') + C.dim(' — no commit landed for this atom yet'));
    }
  });
  process.exit(0);
}

die(`unknown verb '${verb}'. Run with --help.`);
