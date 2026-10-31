#!/usr/bin/env node
// scripts/vna/asked-vs-dictation.mjs — C777: THE POST-RUN LOOPBACK AS A DOOR, LLM-FREE.
//
// Operator (2026-10-12, verbatim): "Look at our process here something went quite wrong … missing some kind of loopback
// function … use the snowball the retro snowball in order to go back into compare what was done with with actually which
// extrapolated from what I asked for". /steer decomposes the dictation into rows at the start (splitAsks → declareRows) and
// never reads the dictation again; every row is then graded against its own guard on its own box. The four Mac fixes of
// docs/specs/vna/asks/2026-10-12-hud-run-postmortem.txt (mirror-only HUD modules · a tsc error that was UNMEASURED when the
// row landed · a server op reading a 1.6 GB tape whole · a branch built on a base main had left) are each a RELATION between
// rows, or between a row and the machine it ships to, and no row-isolated guard can see one. This door runs AFTER the run,
// over the WHOLE dictation, and reads off the record only:
//   (a) INTENT = the dictation as the tape holds it (loadTape, the newest /steer text with its pastes; --dictation <file> is the
//       explicit input when the tape cannot see it) · REALITY = the prose projection of the commits the run landed (git rev-list
//       <since>..<until>, the same range the dispatch reads, C110d: messages + `git show --stat` names) — both through the ONE
//       walk door (lensWalk, source 'loopback', matched aperture, a scratch tape) so the run's placement is a panel beside the
//       row placements; the walk refusing → UNMEASURED with its why, never a noun count.
//   (b) THE RETRO SNOWBALL (retro-snowball.mjs retroGrow, C582) seeded from the dictation as the prompt over the spec tree's
//       walked contract rows; its row set, set-differenced against the rows the chair declared, names the extrapolation both
//       ways: asked-not-built (snowball rows the decomposition never minted) · built-not-asked (declared rows it never reaches).
//   (c) THE RELATIONS a row cannot see, each {name, ok, receipt}: canonical-vs-mirror (rust-crate-mirror's tracked sets, read
//       off `git ls-tree` at a commit, replayed over the range) · tsc (the typecheck on the tree, bounded; UNMEASURED without
//       tsc; plus the later commits that re-touched the range's TS files) · tape-read-whole (a read_to_string on the walk-tape
//       path in a hud.rs must sit beside the HEALTH_TAPE_CAP idiom of fc1283a76e) · base (merge-base against origin/main,
//       commits behind, a merge named when main moved).
//   (d) THE LINE `loopback: <n> rows asked · <b> built · <x> extrapolated · <m> asked-not-built · relations <k>/<k> green ·
//       <behind> behind main`, written to .thetacog/steer-loopback.json and read by steer.mjs's close line beside C186c's
//       regressed ticks; a red relation makes the segment read NOT DONE.
//
// USAGE  node scripts/vna/asked-vs-dictation.mjs --since <sha> [--until <sha>=HEAD] [--rows C733-C774] [--dictation <file>]
//          [--match <substr>] [--out <json>] [--scratch <dir>] [--main origin/main] [--max-steps 6] [--no-walk]
// port: a C7xx row once the door is proved — the relation checks and the set difference DECIDE (engine-map AUTHORITY), so their
//       home is the crate (door.rs beside the anchors/ncd op); node stays the transport (git, tsc, the tape file).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const LOOPBACK_JSON = process.env.VNA_STEER_LOOPBACK || resolve(REPO, '.thetacog/steer-loopback.json');
export const TREE_PATH = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export const CANON = '.thetacog/pmu';
export const MIRROR = 'packages/thetacog-mcp/pmu-rust';
export const HUD_RS = ['packages/thetacog-mcp/pmu-rust/src/hud.rs', 'packages/thetacog-mcp/intentguard/src/hud.rs', '.thetacog/pmu/src/hud.rs'];
export const TSC_PROJECT = 'packages/thetacog-mcp-vscode';
export const LOOPBACK_CAP = 12000;   // the commit cap (walk-door LENS_TEXT_MAX_COMMIT): both sides of the pair at the same aperture
const STEER_MARK = '<command-name>/steer</command-name>';

const git = (args, { repo = REPO, timeout = 60000 } = {}) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
const tryGit = (args, o) => { try { return git(args, o).trim(); } catch { return null; } };
export const short = (sha) => String(sha || '').slice(0, 10);

// ── rows: "C733-C774,C776" → ['C733', …] ─────────────────────────────────────────────────────────────────────────
export function parseRows(spec) {
  const out = [];
  for (const part of String(spec || '').split(/[,\s]+/).filter(Boolean)) {
    const m = /^C(\d+)(?:-C?(\d+))?$/i.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= b; i++) out.push(`C${i}`);
  }
  return [...new Set(out)];
}

// ── (a) intent: the dictation as the tape holds it ───────────────────────────────────────────────────────────────
// the newest tape text carrying the /steer command mark (the harness wraps a /steer dictation in it, pastes and all); --match
// narrows to the newest row containing that substring; --dictation <file> is the explicit input when the tape cannot see it.
export function pickDictation({ tape = [], match = null, file = null } = {}) {
  if (file) { const text = readFileSync(file, 'utf8'); return { text, chars: text.length, source: 'file', ref: file }; }
  const rows = (tape || []).filter((t) => typeof t === 'string' && (match ? t.includes(match) : t.includes(STEER_MARK)));
  if (!rows.length) return { text: '', chars: 0, source: 'tape', ref: null, why: match ? `no tape row contains "${match}"` : 'no /steer dictation on the tape (loadTape saw none)' };
  const text = rows[rows.length - 1];
  return { text, chars: text.length, source: 'tape', ref: `tape row ${tape.indexOf(text) + 1}/${tape.length}` };
}

// ── (a) reality: the prose projection of the range — messages plus the --stat names, never a diff ──────────────
export function rangeShas(since, until = 'HEAD', { repo = REPO } = {}) {
  const out = tryGit(['rev-list', '--reverse', `${since}..${until}`], { repo });
  return out ? out.split('\n').filter(Boolean) : [];
}
export function proseOfRange(since, until = 'HEAD', { repo = REPO } = {}) {
  const shas = rangeShas(since, until, { repo });
  const parts = shas.map((s) => `${tryGit(['log', '-1', '--format=%s%n%b', s], { repo }) || ''}\n${tryGit(['show', '--stat', '--format=', s], { repo }) || ''}`);
  return { shas, text: parts.join('\n\n'), chars: parts.join('\n\n').length };
}

// ── (a) the pair through the one walk door, source 'loopback', on a scratch tape ────────────────────────────────
export function makeWalker(scratch, { lensWalk, timeoutMs = 8000 } = {}) {
  mkdirSync(scratch, { recursive: true });
  return (text, { maxChars = LOOPBACK_CAP, ref = 'loopback' } = {}) => {
    try {
      const { row } = lensWalk(String(text), { source: 'loopback', ref, tape: join(scratch, 'loopback-tape.ndjson'), receiptsDir: join(scratch, 'receipts'), timeoutMs, maxChars, digest: String(text).length > 900 ? 'strided' : 'head' });
      return { pixel: row.pixel || null, cells: row.cells || [], err: row.err || null, aperture_id: row.aperture_id || null, ms: row.ms ?? null };
    } catch (e) { return { pixel: null, cells: [], err: String(e.message || e).slice(0, 160) }; }
  };
}
export function jaccardOverlap(a = [], b = []) { const A = new Set(a), B = new Set(b); if (!A.size && !B.size) return null; let i = 0; for (const x of A) if (B.has(x)) i++; return +(i / (A.size + B.size - i)).toFixed(3); }
export function walkPair({ intent, reality, walk }) {
  const I = walk(intent, { ref: 'loopback-intent' }), R = walk(reality, { ref: 'loopback-reality' });
  const unmeasured = I.err || !I.pixel ? `intent: ${I.err || 'no pixel'}` : R.err || !R.pixel ? `reality: ${R.err || 'no pixel'}` : null;
  return { intent: { pixel: I.pixel, cells: I.cells, aperture_id: I.aperture_id, ms: I.ms }, reality: { pixel: R.pixel, cells: R.cells, aperture_id: R.aperture_id, ms: R.ms }, overlap: unmeasured ? null : jaccardOverlap(I.cells, R.cells), same_pixel: unmeasured ? null : I.pixel === R.pixel, unmeasured };
}

// ── (b) the retro snowball from the dictation, set-differenced against the declared rows ────────────────────────
export function extrapolation({ snowballRows = [], declared = [] }) {
  const S = new Set(snowballRows), D = new Set(declared);
  const askedNotBuilt = [...S].filter((r) => !D.has(r)).sort();
  const builtNotAsked = [...D].filter((r) => !S.has(r)).sort();
  return { askedNotBuilt, builtNotAsked, extrapolated: askedNotBuilt.length + builtNotAsked.length };
}
// retroGrow's text distance comes from the crate (door-crate.mjs, pmu-onchip --door-serve) with spec-tree.mjs's ncd as its own reference
// fallback. The crate dial can leave the loop with nothing referenced (its timers are unref'd), so the door holds its own bounded timer:
// past crateMs the grow re-runs on the reference ncd and the receipt says so — a bounded wait, never a hang and never a silent swap.
export async function snowballFromDictation({ dictation, treePath = TREE_PATH, walk, maxSteps, tau, retroGrow, rowsOf, crateMs = 60000 }) {
  let tree; try { tree = JSON.parse(readFileSync(treePath, 'utf8')); } catch { return { rows: [], why: `no spec tree at ${treePath}`, steps: [] }; }
  const R = rowsOf(tree); const W = (t, o) => walk(t, { ...(o || {}), ref: 'loopback-snowball' });
  let g, dist = 'crate', timer;
  const bound = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('crate text distance exceeded ' + crateMs + ' ms')), crateMs); });
  try { g = await Promise.race([retroGrow(tree, dictation, { walk: W, maxSteps, tau, rows: R }), bound]); }
  catch (e) {
    const { ncd } = await import('./spec-tree.mjs');
    const p = String(dictation).toLowerCase(), memo = new Map(), byId = Object.fromEntries(R.map((r) => [r.id, r]));
    const textDist = (id) => { if (!memo.has(id)) memo.set(id, ncd(p, byId[id].text.toLowerCase())); return memo.get(id); };
    g = await retroGrow(tree, dictation, { walk: W, maxSteps, tau, rows: R, textDist }); dist = `ncd (reference; ${String(e.message || e).slice(0, 80)})`;
  } finally { clearTimeout(timer); }
  return { rows: g.set || [], why: g.why || null, dist, steps: (g.steps || []).map((s) => ({ step: s.step, added: s.added, overlap: s.overlap, err: s.err || null })), overlap: g.overlap ?? null, stop: g.stop || null };
}

// ── (c) the relations a row cannot see — each {name, ok, receipt}; ok null = UNMEASURED ────────────────────────
// rust-crate-mirror's "git tracks the same .rs set in both crates", read at a COMMIT (ls-tree: name + blob sha), so the
// check replays at any point of the range without touching the working tree. An untracked copy is not a copy.
export function trackedRs(at, rel, { repo = REPO } = {}) {
  const out = tryGit(['ls-tree', '-r', at, `${rel}/src`], { repo });
  const m = new Map();
  for (const l of (out || '').split('\n')) { const mm = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(l); if (mm && mm[2].endsWith('.rs')) m.set(mm[2].slice(rel.length + 5), mm[1]); }
  return m;
}
export function canonicalVsMirror({ at = 'HEAD', repo = REPO } = {}) {
  const c = trackedRs(at, CANON, { repo }), m = trackedRs(at, MIRROR, { repo });
  if (!c.size && !m.size) return { name: 'canonical-vs-mirror', ok: null, at: short(at), receipt: `UNMEASURED — git ls-tree ${short(at)} sees no .rs in either crate` };
  const mirrorOnly = [...m.keys()].filter((f) => !c.has(f)).sort(), canonOnly = [...c.keys()].filter((f) => !m.has(f)).sort();
  const differ = [...c.keys()].filter((f) => m.has(f) && m.get(f) !== c.get(f)).sort();
  const ok = !mirrorOnly.length && !canonOnly.length && !differ.length;
  const bits = [mirrorOnly.length ? `mirror-only: ${mirrorOnly.join(' ')}` : '', canonOnly.length ? `canonical-only: ${canonOnly.join(' ')}` : '', differ.length ? `blob differs: ${differ.join(' ')}` : ''].filter(Boolean);
  return { name: 'canonical-vs-mirror', ok, at: short(at), mirrorOnly, canonOnly, differ, receipt: ok ? `git ls-tree ${short(at)}: ${c.size} .rs tracked identically in ${CANON} and ${MIRROR}` : `git ls-tree ${short(at)}: ${bits.join(' · ')} (${CANON} vs ${MIRROR})` };
}
// the same relation replayed over every commit of the range: a red anywhere in the range is a finding even when the end is green
export function canonicalVsMirrorOverRange(shas, { repo = REPO } = {}) {
  const reds = [];
  for (const s of shas) { const r = canonicalVsMirror({ at: s, repo }); if (r.ok === false) reds.push({ sha: short(s), receipt: r.receipt }); }
  return { reds, first: reds[0] || null, count: shas.length };
}

// fc1283a76e's idiom: the walk tape is read from its TAIL, bounded by HEALTH_TAPE_CAP (last_row_with_source(&tape, …, HEALTH_TAPE_CAP)).
// The construct: the identifier bound to the walk-tape path, and every read_to_string applied to it (directly, or through a closure
// whose body is read_to_string) — green only when each such read of the tape sits beside the cap, i.e. no whole read remains.
export function tapeReadWhole({ source, path }) {
  if (source == null) return { name: 'tape-read-whole', ok: null, path, receipt: `UNMEASURED — ${path} unreadable` };
  const tapeVar = /let\s+(\w+)\s*:\s*PathBuf\s*=[^\n]*walk-tape\.ndjson/.exec(source) || /let\s+(\w+)\s*=[^\n]*walk-tape\.ndjson/.exec(source);
  if (!tapeVar) return { name: 'tape-read-whole', ok: true, path, receipt: `${path}: no walk-tape path bound — nothing to read whole` };
  const tv = tapeVar[1];
  const closures = [...source.matchAll(/let\s+(\w+)\s*=\s*\|[^|]*\|[^{;]*\{[^}]*read_to_string/g)].map((m) => m[1]);
  const wholeReads = [];
  for (const m of source.matchAll(new RegExp(`(?:read_to_string|${closures.length ? closures.join('|') : 'NEVER_MATCH'})\\(&?${tv}\\)`, 'g'))) {
    const line = source.slice(0, m.index).split('\n').length;
    wholeReads.push(`${path}:${line} ${m[0]}`);
  }
  const capped = new RegExp(`&?${tv}\\b[^\\n]*HEALTH_TAPE_CAP`).test(source);
  const ok = wholeReads.length === 0;
  return { name: 'tape-read-whole', ok, path, wholeReads, capped, receipt: ok ? `${path}: the walk tape \`${tv}\` is read ${capped ? 'beside HEALTH_TAPE_CAP (bounded tail)' : 'by no read_to_string'}` : `${path}: the walk tape \`${tv}\` is read whole — ${wholeReads.join('; ')}${capped ? '' : ' — no HEALTH_TAPE_CAP idiom (fc1283a76e)'}` };
}
export function tapeReadWholeAt({ at = null, repo = REPO, paths = HUD_RS } = {}) {
  const checks = paths.map((p) => {
    let source = null;
    if (at) source = tryGit(['show', `${at}:${p}`], { repo });
    else { try { source = readFileSync(resolve(repo, p), 'utf8'); } catch {} }
    if (source == null) return null;   // a hud.rs that does not exist at this tree is not a server op
    return tapeReadWhole({ source, path: p });
  }).filter(Boolean);
  if (!checks.length) return { name: 'tape-read-whole', ok: null, at: short(at || 'worktree'), receipt: `UNMEASURED — none of ${paths.join(', ')} exists at ${short(at || 'worktree')}` };
  const red = checks.filter((c) => c.ok === false);
  return { name: 'tape-read-whole', ok: red.length === 0, at: short(at || 'worktree'), checks, receipt: red.length ? red.map((c) => c.receipt).join(' · ') : checks.map((c) => c.receipt).join(' · ') };
}

// the typecheck on the tree (bounded; UNMEASURED when tsc is absent) plus the relation the row could not see: the commits AFTER the
// range that re-touched a TS file the range wrote — the shape of 69c8087f9b (one type error shipped while tsc was UNMEASURED).
export function typecheck({ repo = REPO, since = null, until = 'HEAD', timeout = 180000, exec = execFileSync, project = TSC_PROJECT } = {}) {
  const tsc = resolve(repo, 'node_modules/.bin/tsc');
  let live;
  if (!existsSync(tsc)) live = { ok: null, receipt: `UNMEASURED — ${tsc} absent` };
  else {
    try { exec(tsc, ['-p', project, '--noEmit'], { cwd: repo, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }); live = { ok: true, receipt: `tsc -p ${project} --noEmit: 0 errors` }; }
    catch (e) { const out = String(e.stdout || '') + String(e.stderr || ''); const errs = (out.match(/error TS\d+/g) || []).length; live = { ok: e.killed || e.signal ? null : false, receipt: e.killed || e.signal ? `UNMEASURED — tsc exceeded ${timeout} ms` : `tsc -p ${project} --noEmit: ${errs} error${errs === 1 ? '' : 's'} — ${out.trim().split('\n')[0].slice(0, 160)}` }; }
  }
  let later = [];
  if (since) {
    const tsFiles = (tryGit(['diff', '--name-only', since, until, '--', `${project}/src`], { repo }) || '').split('\n').filter((f) => /\.tsx?$/.test(f));
    if (tsFiles.length) {
      const log = tryGit(['log', '--full-history', '--no-merges', '--format=%h %s', `${until}..HEAD`, '--', ...tsFiles], { repo }) || '';   // --full-history: every commit that wrote the file, not the simplified lineage (a merge hides the Mac's fix)
      later = log.split('\n').filter(Boolean).map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i).slice(0, 10), subject: l.slice(i + 1) }; });
    }
    later.tsFiles = tsFiles;
  }
  const ok = live.ok;
  const laterNote = later.length ? ` · after ${short(until)}: ${later.length} later commit${later.length === 1 ? '' : 's'} re-touched the range's TS files (${later.map((l) => l.sha).join(' ')})` : '';
  return { name: 'tsc', ok, later, tsFiles: later.tsFiles || [], receipt: live.receipt + laterNote };
}

// the base: merge-base against origin/main, commits behind; main moved → a merge is named. `git fetch` may fail offline → UNMEASURED
// only when origin/main cannot be resolved at all (a stale local origin/main still measures, and says so).
export function baseAgainstMain({ at = 'HEAD', main = 'origin/main', repo = REPO, fetch = true } = {}) {
  let fetched = false;
  if (fetch) { try { git(['fetch', '--quiet', 'origin', 'main'], { repo, timeout: 30000 }); fetched = true; } catch {} }
  const mainSha = tryGit(['rev-parse', '--verify', main], { repo });
  if (!mainSha) return { name: 'base', ok: null, behind: null, receipt: `UNMEASURED — ${main} cannot be resolved${fetched ? '' : ' (fetch failed)'}` };
  const base = tryGit(['merge-base', at, mainSha], { repo });
  const behind = Number(tryGit(['rev-list', '--count', `${at}..${mainSha}`], { repo }) ?? NaN);
  if (!base || !Number.isFinite(behind)) return { name: 'base', ok: null, behind: null, receipt: `UNMEASURED — merge-base ${short(at)} ${main} failed` };
  const moved = behind > 0;
  return { name: 'base', ok: !moved, behind, base: short(base), main: short(mainSha), fetched, receipt: moved ? `${short(at)} is ${behind} behind ${main} (${short(mainSha)}); merge-base ${short(base)} — main moved: merge ${main} before the next dispatch` : `${short(at)} contains ${main} (${short(mainSha)}); merge-base ${short(base)}${fetched ? '' : ' · fetch skipped/failed, local ref'}` };
}

// ── (d) the line ─────────────────────────────────────────────────────────────────────────────────────────────────
export function loopbackLine({ asked, built, extrapolated, askedNotBuilt, relations, behind }) {
  const green = relations.filter((r) => r.ok === true).length, red = relations.filter((r) => r.ok === false), un = relations.filter((r) => r.ok == null);
  const b = behind == null ? 'UNMEASURED' : String(behind);
  return `loopback: ${asked} rows asked · ${built} built · ${extrapolated} extrapolated · ${askedNotBuilt} asked-not-built · relations ${green}/${relations.length} green · ${b} behind main${red.length ? ` · RED: ${red.map((r) => r.name).join(', ')}` : ''}${un.length ? ` · UNMEASURED: ${un.map((r) => r.name).join(', ')}` : ''}`;
}

// the findings the postmortem names, read off the relations — each a sentence with its receipt, never a recalled list
export function findings({ relations, mirrorRange, tapeAtUntil, typecheckRel, baseAtUntil }) {
  const out = [];
  if (mirrorRange && mirrorRange.first) out.push(`canonical-vs-mirror: red at ${mirrorRange.reds.length}/${mirrorRange.count} commits of the range, first ${mirrorRange.first.sha} — ${mirrorRange.first.receipt}`);
  if (tapeAtUntil && tapeAtUntil.ok === false) out.push(`tape-read-whole: ${tapeAtUntil.receipt}`);
  if (typecheckRel && (typecheckRel.ok === false || typecheckRel.later.length)) out.push(`tsc: ${typecheckRel.receipt}`);
  if (baseAtUntil && baseAtUntil.ok === false) out.push(`base: ${baseAtUntil.receipt}`);
  for (const r of relations) if (r.ok === false && !out.some((f) => f.startsWith(`${r.name}:`))) out.push(`${r.name}: ${r.receipt}`);
  return out;
}

// ── the door ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function run({ since, until = 'HEAD', rows = null, dictationFile = null, match = null, repo = REPO, out = LOOPBACK_JSON, scratch = join(tmpdir(), 'vna-loopback'), main = 'origin/main', maxSteps = undefined, tau = undefined, walk = true, fetch = true, treePath = TREE_PATH, deps = {} } = {}) {
  if (!since) throw new Error('--since <sha> is required (the HEAD at dispatch, the range the dispatch reads)');
  const untilSha = tryGit(['rev-parse', until], { repo }) || until;
  const { loadTape, goalStatusJson } = deps.steer || await import('./steer.mjs');
  const { lensWalk } = deps.walkDoor || await import('../../src/lib/pmu/walk-door.mjs');
  const { retroGrow, rowsOf, RETRO_MAX_STEPS, RETRO_TAU } = deps.retro || await import('./retro-snowball.mjs');

  // (a) intent and reality
  const dict = pickDictation({ tape: dictationFile ? [] : loadTape({ repo }), match, file: dictationFile });
  const prose = proseOfRange(since, untilSha, { repo });
  const walker = walk ? makeWalker(scratch, { lensWalk }) : () => ({ pixel: null, cells: [], err: 'walk disabled (--no-walk)' });
  const pair = dict.text && prose.shas.length ? walkPair({ intent: dict.text, reality: prose.text, walk: walker }) : { unmeasured: !dict.text ? `no dictation — ${dict.why || 'empty'}` : `empty range ${short(since)}..${short(untilSha)}` };

  // (b) the snowball and the set difference
  let declared = rows ? parseRows(rows) : [];
  if (!declared.length) { try { const st = goalStatusJson({ repo }); declared = st ? st.units.flatMap((u) => u.labels) : []; } catch {} }
  const snow = dict.text ? await snowballFromDictation({ dictation: dict.text, treePath, walk: walker, maxSteps: maxSteps ?? RETRO_MAX_STEPS, tau: tau ?? RETRO_TAU, retroGrow, rowsOf }) : { rows: [], why: 'no dictation', steps: [] };
  const diff = extrapolation({ snowballRows: snow.rows, declared });

  // (c) the relations — live on the tree, and replayed at the range's end so the run's own defects are named
  const mirrorLive = canonicalVsMirror({ at: 'HEAD', repo });
  const mirrorRange = canonicalVsMirrorOverRange(prose.shas, { repo });
  const tapeLive = tapeReadWholeAt({ at: null, repo });
  const tapeAtUntil = tapeReadWholeAt({ at: untilSha, repo });
  const typecheckRel = typecheck({ repo, since, until: untilSha });
  const baseLive = baseAgainstMain({ at: 'HEAD', main, repo, fetch });
  const baseAtUntil = baseAgainstMain({ at: untilSha, main, repo, fetch: false });
  const relations = [mirrorLive, typecheckRel, tapeLive, baseLive];
  const found = findings({ relations, mirrorRange, tapeAtUntil, typecheckRel, baseAtUntil });

  const line = loopbackLine({ asked: snow.rows.length, built: declared.length, extrapolated: diff.extrapolated, askedNotBuilt: diff.askedNotBuilt.length, relations, behind: baseLive.behind });
  const json = { at: new Date().toISOString(), since: short(since), until: short(untilSha), commits: prose.shas.length, dictation: { source: dict.source, ref: dict.ref, chars: dict.chars, why: dict.why || null }, reality_chars: prose.chars, panel: pair, snowball: { rows: snow.rows, dist: snow.dist || null, steps: snow.steps, overlap: snow.overlap ?? null, why: snow.why || null }, declared, asked_not_built: diff.askedNotBuilt, built_not_asked: diff.builtNotAsked, relations, replay: { mirror_range: mirrorRange, tape_at_until: tapeAtUntil, base_at_until: baseAtUntil }, findings: found, line };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(json, null, 2)); }
  return json;
}

// the close-line segment steer.mjs reads — absent file → not run; a red relation → NOT DONE, never a green close
export function loopbackSegment({ file = LOOPBACK_JSON } = {}) {
  let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { return { state: 'not run', line: 'loopback: not run — node scripts/vna/asked-vs-dictation.mjs' }; }
  const red = (j.relations || []).filter((r) => r.ok === false);
  const line = `${j.line || 'loopback: (no line)'}${red.length ? ` · NOT DONE while a relation is red (${red.map((r) => r.name).join(', ')})` : ''}`;
  return { state: red.length ? 'red' : 'green', red: red.map((r) => r.name), line, at: j.at || null };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('--help') || !arg('--since')) { console.error('usage: asked-vs-dictation.mjs --since <sha> [--until <sha>=HEAD] [--rows C733-C774] [--dictation <file>] [--match <substr>] [--out <json>] [--scratch <dir>] [--main origin/main] [--max-steps 6] [--no-walk] [--no-fetch] [--json]'); process.exit(2); }
  // no top-level await here: run() imports steer.mjs, which imports this module for loopbackSegment — a pending TLA would deadlock that cycle
  run({ since: arg('--since'), until: arg('--until', 'HEAD'), rows: arg('--rows', null), dictationFile: arg('--dictation', null), match: arg('--match', null), out: arg('--out', LOOPBACK_JSON), scratch: arg('--scratch', join(tmpdir(), 'vna-loopback')), main: arg('--main', 'origin/main'), maxSteps: arg('--max-steps') ? Number(arg('--max-steps')) : undefined, walk: !argv.includes('--no-walk'), fetch: !argv.includes('--no-fetch') })
    .then((j) => { if (argv.includes('--json')) console.log(JSON.stringify(j)); else { console.log(j.line); for (const f of j.findings) console.log(`  finding: ${f}`); } process.exit(0); })
    .catch((e) => { console.error(`asked-vs-dictation: ${e && e.message || e}`); process.exit(1); });
}
