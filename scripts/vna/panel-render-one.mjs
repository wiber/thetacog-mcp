#!/usr/bin/env node
// scripts/vna/panel-render-one.mjs — C667b RENDER THIS PANEL, ONE COMMIT AT A TIME, WHERE THE RUST WALK CAN RUN (operator
// 2026-10-05, verbatim: "can they be run from the tesseract in browser on button push one at a time (or from extension) or
// doesn't it matter?").
//
// The answer, as built: the encircled panel is the one Rust pipeline's PNG (commit-triptych.mjs → triptych-render); that walk
// runs on the holder's machine, never in a public browser — a page that rendered it would be a redraw, not the panel. So the
// button lives where the walk runs: the extension's "Steer: render this commit's panel" command and the local attest server's
// POST /render-panel (http://localhost:7315, 127.0.0.1 only) both call renderOne() here. The public tile for a commit with no
// panel says why in one line (tape-window.mjs tileWhy) and never offers a render.
//
// BOUNDED, OFF THE HOOK PATH. renderOne() goes through the same lane the controller's panel-repair uses: the render slot
// (scripts/ops/slot.sh, ≤2 renders machine-wide), the commit-render mailbox (MAILBOX_MAX_WAIT_S → exit 75 = "busy, try later",
// never a failure), and a wall-clock alarm per render (RENDER_TIMEOUT_S). backRender() walks the tape's commits that have NO
// panel in any tracked tree at HEAD, newest first, and renders at most BACKRENDER_CAP of them per run (the machine was
// overloaded on 2026-10-05 — a small batch, never the whole 518). Each panel it publishes is then signed as a `retro: true` row
// (panel-coverage.mjs signRetro — C649a's tool, AXIOM 1 W4: a later render is never counted as contemporaneous).
//
// SUFFICIENT FOR: which commits have no panel at HEAD, and rendering one of them through the one pipeline on request.
// NOT SUFFICIENT FOR: what the panel would have shown at the time (a retro render reads the commit's immutable tree, never the
// working tree, and is labelled retro), or whether the work was good (Rice — undecidable).
// Port row: none — orchestration (spawn the existing render through the existing lane); it decides no placement.
// @guard tests/vna/c667b-the-slider-shows-the-panels-we-have.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { panelFilesAtHead } from './panel-carry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
/** at most this many past panels rendered per back-render run */
export const BACKRENDER_CAP = 5;
/** each render's wall clock, seconds (SIGALRM) */
export const RENDER_TIMEOUT_S = 300;
/** the wait for the render lane, seconds (the mailbox exits 75 past it) */
export const LANE_WAIT_S = 120;
/** the newest tape commits a back-render leaves alone — the post-commit hook may still be rendering them (never race it) */
export const HOOK_WINDOW = 20;

const SHA = /^[0-9a-f]{7,40}$/;
/** a commit sha the render may be asked for — hex only, so nothing reaches a shell or an argv but a sha */
export const isSha = (s) => typeof s === 'string' && SHA.test(s.toLowerCase());

/** the argv that renders one commit's panel through the slot, the lane and the alarm — the panel-repair line, one commit */
export function renderArgv(sha, { timeout = RENDER_TIMEOUT_S } = {}) {
  if (!isSha(sha)) throw new Error('renderArgv: a commit sha (7–40 hex) is required');
  const s = sha.toLowerCase();
  return ['bash', 'scripts/ops/slot.sh', 'with', 'render', '--label', `panel-render-one ${s}`, '--',
    'bash', 'scripts/ops/mailbox.sh', 'commit-render', '--',
    'perl', '-e', 'alarm shift; exec @ARGV', String(timeout),
    'node', 'scripts/pmu/commit-triptych.mjs', '--commit', s, '--no-open', '--no-qwen'];
}

/** the tape's commits (full sha, time order, distinct) */
export function tapeCommitShas(tape) {
  let lines = []; try { lines = readFileSync(tape, 'utf8').split('\n'); } catch { return []; }
  const seen = new Set(); const out = [];
  for (const l of lines) { if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (r && r.kind === 'commit' && isSha(r.sha) && r.sha.length >= 10) { const s = r.sha.toLowerCase(); if (!seen.has(s)) { seen.add(s); out.push(s); } } }
  return out;
}

/** the tape's commits with no panel in any tracked panel tree at HEAD, newest first → { commits, missing: [sha…] } */
export function missingPanels({ repo = REPO, tape = resolve(repo, 'data/vna/flight-tape.ndjson') } = {}) {
  const shas = tapeCommitShas(tape);
  const files = panelFilesAtHead(repo);
  if (!files) return { commits: shas.length, missing: null, why: 'no HEAD tree to read the published panels from' };
  const has = (full) => { for (let n = Math.min(full.length, 40); n >= 7; n--) if (files.has(full.slice(0, n))) return true; return false; };
  return { commits: shas.length, missing: shas.filter((s) => !has(s)).reverse() };
}

/** render one commit's panel; rc 75 = the lane was busy (try later), 142 = the alarm fired */
export function renderOne(sha, { repo = REPO, run = spawnSync, timeout = RENDER_TIMEOUT_S, laneWait = LANE_WAIT_S } = {}) {
  const argv = renderArgv(sha, { timeout });
  const r = run(argv[0], argv.slice(1), { cwd: repo, encoding: 'utf8', env: { ...process.env, MAILBOX_MAX_WAIT_S: String(laneWait), VNA_PANEL_RETRO: '1' }, maxBuffer: 16 * 1024 * 1024 });
  const rc = typeof r.status === 'number' ? r.status : 1;
  const status = rc === 0 ? 'rendered' : rc === 75 ? 'lane-busy' : rc === 142 ? 'timeout' : 'failed';
  return { sha: sha.toLowerCase(), rc, status, argv, tail: String(r.stdout || '').split('\n').filter(Boolean).slice(-3) };
}

/** render up to `cap` missing panels, newest first; stops at the first busy lane (the next one would wait the same) */
export function backRender({ repo = REPO, tape, cap = BACKRENDER_CAP, run = spawnSync, sign = null, hookWindow = HOOK_WINDOW } = {}) {
  const m = missingPanels({ repo, tape });
  if (!m.missing) return { ...m, tried: [], signed: null };
  const recent = new Set(tapeCommitShas(tape || resolve(repo, 'data/vna/flight-tape.ndjson')).slice(-Math.max(0, hookWindow)));
  if (!hookWindow) recent.clear();
  const tried = [];
  for (const sha of m.missing.filter((s) => !recent.has(s)).slice(0, Math.max(0, cap))) {
    const r = renderOne(sha, { repo, run }); tried.push({ sha: r.sha, status: r.status, rc: r.rc });
    if (r.status === 'lane-busy') break;
  }
  const signed = sign && tried.some((t) => t.status === 'rendered') ? sign() : null;
  return { commits: m.commits, missing: m.missing.length, cap, tried, signed };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  if (a.includes('--missing')) {
    const m = missingPanels();
    console.log(JSON.stringify({ commits: m.commits, missing: m.missing ? m.missing.length : null, newest: m.missing ? m.missing.slice(0, 10) : [], why: m.why || null }, null, 2));
  } else if (a.includes('--sha')) {
    const sha = arg('--sha');
    if (!isSha(sha)) { console.error('usage: panel-render-one.mjs --sha <commit sha>'); process.exit(2); }
    const r = renderOne(sha); console.log(JSON.stringify(r, null, 2)); process.exit(r.rc === 0 ? 0 : r.rc === 75 ? 75 : 1);
  } else if (a.includes('--back')) {
    const cap = Math.min(BACKRENDER_CAP * 4, Number(arg('--back')) || BACKRENDER_CAP);
    const { signRetro } = await import('./panel-coverage.mjs');
    console.log(JSON.stringify(backRender({ cap, sign: () => signRetro({ cap }) }), null, 2));
  } else {
    console.error('usage: panel-render-one.mjs --sha <sha> | --missing | --back [n ≤ 20]');
    process.exit(2);
  }
}
