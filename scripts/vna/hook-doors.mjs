#!/usr/bin/env node
// The prompt hook's two doors that are pure enough to test WITHOUT running the hook — steer-hook.mjs is a script:
// importing it runs it against the live pointer and process.exit()s the importer (tests/vna/spec-first.test.mjs lost its
// second test that way, and its lock mutation never went red because the assertions never ran).
//   queueHead    — the open rows of the spec, newest label first; printed when the snowball abstains
//   dispatchFold — when the tape is ahead of the tree, spawn spec-tree.mjs detached, once (pid lock), receipted
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');

// THE QUEUE HEAD (operator 2026-09-17: "/clear the context and rely on /steer and the spec to get fast grip again"):
// the first open rows of the spec's Part 1, printed when the snowball abstains — the first prompt after a clear is
// "continue", which seeds nothing; the queue is what it should land on. Read off the md until C52e renders it from the tree.
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export function queueHead(specPath = SPEC_MD, n = 3) {
  let md = ''; try { md = readFileSync(specPath, 'utf8'); } catch { return null; }
  const open = md.split('\n').filter((l) => /^\s*- \[ \] (C\d+[a-z]?|T\d+)\b/.test(l)).map((l) => l.replace(/^\s*- \[ \] /, '').replace(/\s+/g, ' ').trim());
  if (!open.length) return null;
  // newest declared first — the LABEL is the sequence (C52 > C47), never the file order: the spec is not chronological
  // (C52 sits above C45–C47 on disk); the seen-red case printed C47 as newest. Sub-rows follow their parent (C52a after C52).
  const key = (l) => { const m = /^([CT])(\d+)([a-z]?)/.exec(l); return m ? [m[1] === 'C' ? 1 : 0, Number(m[2]), m[3] ? m[3].charCodeAt(0) - 96 : 0] : [-1, 0, 0]; };
  const cmp = (a, b) => { const ka = key(a), kb = key(b); return kb[0] - ka[0] || kb[1] - ka[1] || ka[2] - kb[2]; };
  const sorted = [...open].sort(cmp);
  const head = sorted.slice(0, n), oldest = sorted[sorted.length - 1];
  return { open: open.length, lines: [`⟦ QUEUE — open rows on the spec · ${open.length} · newest first; the next unit of work is the first one ⟧`, ...head.map((l) => `  · ${l.slice(0, 150)}${l.length > 150 ? '…' : ''}`), ...(open.length > n ? [`  (… ${open.length - n} older open rows · oldest: ${oldest.slice(0, 60)}…)`] : [])] };
}

// THE FOLD IS THE HOOK'S TO GUARANTEE (operator 2026-09-17: "every turn of the LLM here should be a prompt turn as
//     well … guarantee that the snowball starts on the spec … on every turn"). Until tonight the fold ran on a 30-minute
//     Monitor that expired mid-question and left row 49 on the tape unfolded. Now: when the ledger is ahead of the tree,
//     the hook DISPATCHES spec-tree.mjs — detached (an unbounded call never rides inline in a hook), one at a time (a pid
//     lock), receipted (.thetacog/vna-fold-dispatch.ndjson) — and the NEXT turn reads the folded nodes. The hook itself
//     stays under its door; the 1–8 s of walk + reef reading happens beside it, not inside it.
// C170a leg 1: the lock, the budget, the stale rule and the watermark sidecar live in ONE place (fold-writer.mjs); the fold
// claims the same lock itself, so the runner's gate-5 fold and a hand run are the same single writer as this dispatch.
export { FOLD_LOCK, FOLD_RECEIPT, FOLD_BUDGET_MS } from './fold-writer.mjs';
import { FOLD_LOCK, FOLD_RECEIPT, FOLD_BUDGET_MS, foldLockState, reportOverBudget, pidIsFold, readWatermark, foldedThrough } from './fold-writer.mjs';
import { lastRowWhere, ledgerTail } from './ndjson-tail.mjs';
import { heavyHolder, HEAVY_LOCK, alive } from './heavy-lock.mjs';

// C287b — THE HOOKS YIELD TO THE HEAVY LOCK. C287's mutex fenced benches from each other and from the guard suite, but
// the hooks never read it: on 2026-09-25 the C291 reading (replay-bench, heavy-locked) ran at load1 136 on 10 cores while
// every prompt AND every tool call fired steer-hook's detached walks (fold, envelope, transcript rows, snowball refresh,
// mass refresh, flight tape) — 1 trial in 15 min, and C289 stamps a trial started over 2 × cores as starved. A live
// holder that is not this process DEFERS each detached dispatch (the next turn after the lock frees retries it; the
// sidecar still serves the cached bundle, so the hook's own output is unchanged). Deferred, never failed.
// VNA_HEAVY_YIELD_OFF=1 is the explicit override. Reads one small file + kill(pid,0) — no ps, no spawn.
export function heavyYield({ env = process.env, isAlive = alive, self = process.pid } = {}) {
  if (env.VNA_HEAVY_YIELD_OFF) return null;
  const h = heavyHolder({ path: env.VNA_HEAVY_LOCK || HEAVY_LOCK() });
  if (!h || !h.pid || h.pid === self || !isAlive(h.pid)) return null;
  return `heavy lock held by ${h.job || 'a heavy job'} · pid ${h.pid} — deferred until it frees (C287b)`;
}   // C194: the last dispatch's own timestamp, read off the receipt's tail — never the whole file
export const FOLD_HUNG_MS = FOLD_BUDGET_MS;   // the old name — now a REPORTING threshold, never an overtake threshold
// ONE FOLD ARGV (operator 2026-09-22: "run the fold with an expanded V8 heap"). The runner's fold died in a V8 heap OOM
// at ~3.5 GB (runner.ndjson halt 12:22, C161) while the hook's fold ran on the same default heap. Both spawn sites read
// this one argv, so the heap is set in one place and cannot drift between the hook and the runner.
export const FOLD_HEAP_MB = Number(process.env.VNA_FOLD_HEAP_MB) || 8192;
export const foldArgv = (repo = REPO) => ['node', `--max-old-space-size=${FOLD_HEAP_MB}`, resolve(repo, 'scripts/vna/spec-tree.mjs')];
// C194 THE FOLD IS DEBOUNCED (operator 2026-09-23, from the C190 meta review): MEASURED 39.8 folds/hour, each a
// ~2.67 GB process (rust-punch-list #2) — dispatchFold used to fire on ANY single new tape row (behind >= 1),
// gated only by the pid lock (one RUNNING at a time, never a floor on how often one STARTS). A fold is worth
// starting only when >= FOLD_MIN_ROWS_BEHIND tape rows are behind the tree, or FOLD_DEBOUNCE_MS has passed since
// the last one actually dispatched — a hand edit to the spec (specNewer) always dispatches, since it carries no
// tape row for the row-count floor to count. C175 (a brief waiting for the newest row before it is built) is a
// separate, still-open row this debounce assumes rather than builds.
export const FOLD_MIN_ROWS_BEHIND = Number(process.env.VNA_FOLD_MIN_ROWS_BEHIND) || 4;
export const FOLD_DEBOUNCE_MS = Number(process.env.VNA_FOLD_DEBOUNCE_MS) || 60000;
// a real dispatch row (this function's own append, below) always carries `rows` (ledgerRows); the OTHER kinds this
// receipt carries — fold-writer.mjs's 'over-budget' and 'refused-held' — never do, and must never reset this clock
const isDispatchRow = (r) => r && Number.isFinite(Date.parse(r.at)) && r.rows !== undefined;
export function dispatchFold({ ledgerRows, ledger = null, treePath = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json'), specPath = process.env.VNA_SPEC_BASINS !== undefined ? (process.env.VNA_SPEC_BASINS || null) : resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md'), lock = FOLD_LOCK, receipt = FOLD_RECEIPT, spawnFn = spawn, now = Date.now(), isFold = pidIsFold, minRowsBehind = FOLD_MIN_ROWS_BEHIND, debounceMs = FOLD_DEBOUNCE_MS } = {}) {
  { const HY = heavyYield(); if (HY) return { dispatched: false, behind: null, heavy: true, why: HY }; }
  // C170a leg 1: the watermark is read off the sidecar the fold writes (a few hundred bytes), NEVER by parsing the tree —
  // the 57 MB JSON.parse ran here on every turn to read one integer. No sidecar → the tree is treated as behind; the fold writes one.
  const W = readWatermark(treePath);
  const wm = foldedThrough(W);   // max(own-source watermark, global index scanned) — foreign rows never hold the gate open
  let behind = ledgerRows - 1 - wm;
  // …and never START one: the fold ingests only W.source's rows, so a tail of transcript:* rows is nothing to fold. With the
  // ledger path, count only own-source rows past wm (a bounded tail read, flat memory). Without it, the global count stands.
  let foreign = 0;
  if (ledger && W && W.source && behind > 0) { try { const own = ledgerTail(ledger, { afterIndex: wm, source: W.source }).rows.length; foreign = behind - own; behind = own; } catch {} }
  // C52a/C36: a hand edit to the spec (a tick, a new row) is new mass too — the basins refold when the spec is newer than the tree
  let specNewer = false; try { if (specPath) specNewer = statSync(specPath).mtimeMs > statSync(treePath).mtimeMs; } catch {}
  if (behind <= 0 && !specNewer) return { dispatched: false, behind: 0, foreign, why: foreign ? `tree at the tape — ${foreign} row${foreign === 1 ? '' : 's'} past it belong to other sources, nothing to fold` : 'tree at the tape' };
  // C194: below the row floor, only a fold that has not run in `debounceMs` is worth starting — the first-ever
  // dispatch (no prior row on the receipt) is never debounced, so a fresh clone still folds its first paste.
  if (!specNewer && behind < minRowsBehind) {
    const last = lastRowWhere(receipt, isDispatchRow);
    const lastAt = last ? Date.parse(last.at) : null;
    if (lastAt != null && now - lastAt < debounceMs) {
      return { dispatched: false, behind, debounced: true, why: `debounced: ${behind} row${behind === 1 ? '' : 's'} behind (< ${minRowsBehind}) and the last fold dispatched ${Math.round((now - lastAt) / 1000)}s ago (< ${Math.round(debounceMs / 1000)}s)` };
    }
  }
  // ONE WRITER (C170a leg 1). 2026-09-20: a lock older than 120 s was overtaken while alive → 21 concurrent folds. 2026-09-22:
  // a fold alive past 30 min was overtaken → two writers on the tree for 35+ min (pid 48140). A live fold holds the lock at ANY
  // age; past the budget it is REPORTED once (over-budget row), never doubled. Only a dead pid — or a live pid that is not a
  // fold (reuse) — is stale, and the reclaim is receipted.
  const st = foldLockState(lock, { now, isFold, self: -1 });
  if (st.state === 'live') return { dispatched: false, behind, why: `fold already running (pid ${st.pid}, ${Math.round(st.ageMs / 1000)} s)` };
  if (st.state === 'over-budget') { const reported = reportOverBudget(st, { lock, receipt, now }); return { dispatched: false, behind, overBudget: true, reported, why: `fold over budget (pid ${st.pid}, ${Math.round(st.ageMs / 1000)} s > ${Math.round(FOLD_BUDGET_MS / 1000)} s) — reported, not doubled` }; }
  const reclaimed = st.state === 'stale' ? st.pid : null;
  const child = spawnFn(foldArgv()[0], foldArgv().slice(1), { cwd: REPO, detached: true, stdio: 'ignore', env: { ...process.env, VNA_BY: 'hook:fold', VNA_FOLD_WAIT_MS: '0' } });
  const pid = child && child.pid; if (child && child.unref) child.unref();
  try { mkdirSync(dirname(lock), { recursive: true }); writeFileSync(lock, JSON.stringify({ pid, at: new Date(now).toISOString(), behind })); } catch {}
  try { mkdirSync(dirname(receipt), { recursive: true }); appendFileSync(receipt, JSON.stringify({ at: new Date(now).toISOString(), pid, behind: Math.max(0, behind), specNewer, rows: ledgerRows, watermark: wm, watermarkFrom: W ? 'sidecar' : 'none', ...(reclaimed != null ? { kind: 'reclaimed', reclaimed, staleWhy: st.why } : {}) }) + '\n'); } catch {}
  return { dispatched: true, behind: Math.max(0, behind), specNewer, pid, reclaimed, why: null };
}

// C60 THE FOREST LINE (operator 2026-09-18: "wire the forest line into the prompt hook immediately … bridges the macro-project
// trajectory with the micro-task leaf on every turn at near-zero token cost"). One line beside the snowball, read from the
// envelope RECEIPT that envelope.mjs writes (data/vna/envelope.json) — the hook COMPUTES NOTHING here (computeCycle places
// unfolded rows by NCD and reads the greeks index; that is the envelope's door, not the hook's 800 ms). A missing receipt
// prints the command that makes one, never a blank; a receipt older than the last commit on the walk tape says STALE with
// its age, so a zero pull can never be read off yesterday's forest.
export const ENVELOPE = process.env.VNA_ENVELOPE || resolve(REPO, 'data/vna/envelope.json');
export function forestLine({ receipt = ENVELOPE, lastCommit = null, now = Date.now() } = {}) {
  let e = null; try { e = JSON.parse(readFileSync(receipt, 'utf8')); } catch {}
  if (!e || typeof e.pull === 'undefined') return { line: '⟦ FOREST ⟧ no envelope receipt — node scripts/vna/envelope.mjs writes one (pull · both arms · the net)', stale: null, receipt: null };
  const at = Date.parse(e.at || '') || null;
  const ageMin = at ? Math.max(0, Math.round((now - at) / 60000)) : null;
  const commitAt = lastCommit ? Date.parse(lastCommit.ts || lastCommit.at || '') || null : null;
  const stale = !!(at && commitAt && commitAt > at);
  const arm1 = e.moveWork && e.moveWork.target ? `${e.moveWork.target.id} (${e.moveWork.target.coord}, ${e.moveWork.distanceFromWork} block${e.moveWork.distanceFromWork === 1 ? '' : 's'} away)` : '—';
  const arm2 = e.moveDecl ? `${e.moveDecl.coord} ×${e.moveDecl.n}${e.moveDecl.repeated ? '' : ' (single)'}` : '—';
  const net = e.coverage ? `net ${e.coverage.pct} % at fence ${e.coverage.fence} (${e.coverage.exact} exact)${e.coverage.pct >= 95 ? ' SATURATED' : ''}` : 'net unmeasured';
  const rows = e.rows ? ` · ${e.rows.open} open / ${e.rows.ticked} ticked` : '';
  const last = lastCommit && lastCommit.pixel ? ` · last commit at ${lastCommit.pixel} (${String(lastCommit.ref || '').slice(0, 10)})` : '';
  const age = ageMin == null ? 'receipt undated' : `receipt ${ageMin} min old`;
  const line = `⟦ FOREST ⟧ pull ${e.pull ?? '—'} · ${(e.undeclared || []).length} undeclared · ${(e.unworked || []).length} unworked · Arm 1 → ${arm1} · Arm 2 → ${arm2} · ${net}${rows}${last} · ${stale ? `STALE — ${age}, a commit landed after it (node scripts/vna/envelope.mjs)` : age}`;
  return { line, stale, receipt: e.at || null, pull: e.pull ?? null };
}
// a STALE line refreshes the receipt for the NEXT turn — detached (~120 ms, no model), never inline in the hook's door; a
// chore commit from another daemon (2026-09-18: chore(benchmark) 1c804c2c1a) can land between post-commit refreshes
export function refreshEnvelopeDetached({ repo = REPO } = {}) {
  { const HY = heavyYield(); if (HY) return { dispatched: false, why: HY }; }
  if (process.env.VNA_NO_ENVELOPE_DISPATCH) return { dispatched: false, why: 'VNA_NO_ENVELOPE_DISPATCH' };
  try { const c = spawn('node', [resolve(repo, 'scripts/vna/envelope.mjs'), '--json'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env } }); c.unref(); return { dispatched: true, pid: c.pid }; } catch (e) { return { dispatched: false, why: String(e.message || e).slice(0, 80) }; }
}

// C184 — TRANSCRIPT ROWS, DETACHED. C183's ledger measured the PostToolUse hook at p50 2198 ms / p95 4029 ms (n=41); the
// diagnosis (--cpu-prof-shaped ablation, VNA_NO_TRANSCRIPT_ROWS=1 dropped a 3.7–6 s run to 177 ms) traced it to ONE step:
// transcript-rows.mjs's ledgerShas() reads the WHOLE amendments.ndjson (415 MB) and JSON.parses every line, on every
// call — measured standalone at 2297 ms, alone accounting for the whole median. steer-hook.mjs never reads the result
// (TRANSCRIPT_ROWS was assigned and never referenced) — it exists only to append the operator's/assistant's transcript
// prose onto the ledger as spec mass for a LATER turn's fold, so nothing the hook prints this turn depends on it
// finishing before the hook returns. Detached, same as dispatchFold/dispatchDrain/refreshEnvelopeDetached.
// A back-off gap (not a pid lock — dispatchDrain's shape, not claimFoldLock's) stops a burst of tool calls a few
// hundred ms apart from stacking N of these 2+ second ledger reads on top of each other; ledgerShas' own sha-dedup
// still makes a slightly-overlapping pair of runs idempotent, so the gap only needs to bound CONCURRENCY, not
// correctness. The root cost (the whole-file read) is untouched here and is its own debt — named, not fixed, in this
// commit; ndjson-tail.mjs's own header names the shape (tail-bounded, never whole-file) that door would need to grow.
export const TRANSCRIPT_DISPATCH_RECEIPT = process.env.VNA_TRANSCRIPT_DISPATCH_RECEIPT || resolve(REPO, '.thetacog/transcript-rows-dispatch.json');
export const TRANSCRIPT_DISPATCH_GAP_MS = Number(process.env.VNA_TRANSCRIPT_DISPATCH_GAP_MS) || 5000;
export function dispatchTranscriptRows({ transcriptPath, receipt = TRANSCRIPT_DISPATCH_RECEIPT, gapMs = TRANSCRIPT_DISPATCH_GAP_MS, spawnFn = spawn, now = Date.now(), repo = REPO, env = process.env } = {}) {
  if (!transcriptPath) return { dispatched: false, why: 'no transcript_path' };
  if (env.VNA_NO_TRANSCRIPT_ROWS) return { dispatched: false, why: 'VNA_NO_TRANSCRIPT_ROWS' };
  { const HY = heavyYield({ env }); if (HY) return { dispatched: false, why: HY }; }
  let last = null; try { last = JSON.parse(readFileSync(receipt, 'utf8')); } catch {}
  if (last && Number.isFinite(last.at) && now - last.at < gapMs) return { dispatched: false, why: `backoff: last dispatch ${Math.round((now - last.at) / 1000)}s ago, gap ${Math.round(gapMs / 1000)}s`, pid: last.pid };
  try {
    const c = spawnFn('node', [resolve(repo, 'scripts/vna/transcript-rows.mjs'), '--file', transcriptPath, '--json'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...env, VNA_BY: 'hook:transcript-rows' } });
    const pid = c && c.pid; if (c && c.unref) c.unref();
    try { mkdirSync(dirname(receipt), { recursive: true }); writeFileSync(receipt, JSON.stringify({ at: now, pid, transcriptPath })); } catch {}
    return { dispatched: true, pid };
  } catch (e) { return { dispatched: false, why: String(e && e.message || e).slice(0, 80) }; }
}

// ── C193 THE SNOWBALL SIDECAR (operator 2026-09-23, from the C190 meta review): prompt-steer (UserPromptSubmit)
// measured p50 ~6.5s (.thetacog/hook-timing.ndjson, label prompt-steer, n=86) while the walk snowball() waits on is
// admitted — re-aims the turn — 12 of 757 times (1.6%). Nearly every turn pays a ~53MB spec-tree.json parse plus a
// synchronous Rust walk to re-confirm a leaf the /goal door already names for free: goal.mjs's ACTIVE_LEAF override
// (.thetacog/vna-active-leaf.json), a few hundred bytes. THE HOOK READS THAT FIRST. When a sidecar already carries a
// rendered bundle for the SAME leaf, snowball() serves it as-is (readSnowballSidecar) and dispatches THIS prompt's
// own walk here, detached (dispatchSnowballRefresh) — its outcome (an admitted re-aim, or nothing) lands in the
// sidecar for the NEXT turn, never blocking this one. Joins C184a's resident process where it already helps
// (ensureResident, via resident-client.mjs, keeps the tree warm); the refresh script itself still parses the tree
// once, off this hot path, because the resident's op set today answers "tree-nodes for a row sha", not "the full
// bundle for a leaf id" — named here as the next leg, not silently worked around.
export const SNOWBALL_SIDECAR = process.env.VNA_SNOWBALL_SIDECAR || resolve(REPO, '.thetacog/vna-snowball-sidecar.json');
export const SNOWBALL_DISPATCH_RECEIPT = process.env.VNA_SNOWBALL_DISPATCH_RECEIPT || resolve(REPO, '.thetacog/vna-snowball-dispatch.json');
export const SNOWBALL_DISPATCH_GAP_MS = Number(process.env.VNA_SNOWBALL_DISPATCH_GAP_MS) || 5000;
// the goal leaf, read off goal.mjs's own override file — a few hundred bytes, never the tree
export function readGoalLeafLabel(path = process.env.VNA_ACTIVE_LEAF || resolve(REPO, '.thetacog/vna-active-leaf.json')) {
  try { const g = JSON.parse(readFileSync(path, 'utf8')); return g && g.label ? g.label : null; } catch { return null; }
}
export function readSnowballSidecar(path = SNOWBALL_SIDECAR) {
  try { const s = JSON.parse(readFileSync(path, 'utf8')); return s && Array.isArray(s.lines) && s.lines.length && s.leafLabel ? s : null; } catch { return null; }
}
export function writeSnowballSidecar(row, path = SNOWBALL_SIDECAR) { try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(row)); } catch {} }
// the detached refresh — back-off-gapped like dispatchTranscriptRows, so a burst of prompts a few hundred ms apart
// never stacks N tree parses on top of each other. The prompt rides in a small sidecar file, never argv: unbounded
// length, a newline would break a spawned argv anyway, and a prompt never belongs in `ps`.
export function dispatchSnowballRefresh({ prompt, treePath = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json'), sidecar = SNOWBALL_SIDECAR, receipt = SNOWBALL_DISPATCH_RECEIPT, gapMs = SNOWBALL_DISPATCH_GAP_MS, spawnFn = spawn, now = Date.now(), repo = REPO, env = process.env } = {}) {
  if (env.VNA_NO_SNOWBALL_DISPATCH) return { dispatched: false, why: 'VNA_NO_SNOWBALL_DISPATCH' };
  { const HY = heavyYield({ env }); if (HY) return { dispatched: false, why: HY }; }
  if (!prompt || String(prompt).trim().length < 12) return { dispatched: false, why: 'prompt under 12 chars — nothing to walk' };
  let last = null; try { last = JSON.parse(readFileSync(receipt, 'utf8')); } catch {}
  if (last && Number.isFinite(last.at) && now - last.at < gapMs) return { dispatched: false, why: `backoff: last dispatch ${Math.round((now - last.at) / 1000)}s ago, gap ${Math.round(gapMs / 1000)}s`, pid: last.pid };
  const promptFile = `${sidecar}.prompt.txt`;
  try { mkdirSync(dirname(promptFile), { recursive: true }); writeFileSync(promptFile, String(prompt)); } catch (e) { return { dispatched: false, why: `prompt file: ${String(e.message || e).slice(0, 80)}` }; }
  try {
    const c = spawnFn('node', [resolve(repo, 'scripts/vna/snowball-refresh.mjs')], { cwd: repo, detached: true, stdio: 'ignore', env: { ...env, VNA_SPEC_TREE: treePath, VNA_SNOWBALL_SIDECAR: sidecar, VNA_SNOWBALL_PROMPT_FILE: promptFile, VNA_BY: 'hook:snowball-refresh' } });
    const pid = c && c.pid; if (c && c.unref) c.unref();
    try { mkdirSync(dirname(receipt), { recursive: true }); writeFileSync(receipt, JSON.stringify({ at: now, pid })); } catch {}
    return { dispatched: true, pid };
  } catch (e) { return { dispatched: false, why: String(e && e.message || e).slice(0, 80) }; }
}

// ── C176f THE COMMIT-MASS CACHE, DETACHED — never a git call on the hook's hot path (commitMass() alone measured
// ~1.1s on the live repo, well over the hook's 800ms door). read-set.mjs's rowsFromTree()/loadMassCache() always
// reads this cache (empty object when absent — a fresh clone degrades to hairs over row TEXT alone, never a crash);
// this dispatch is how the cache gets refreshed for the NEXT turn, back-off gapped the same shape as
// dispatchSnowballRefresh/dispatchTranscriptRows so a burst of prompts never stacks N git-log calls.
export const MASS_REFRESH_RECEIPT = process.env.VNA_MASS_REFRESH_RECEIPT || resolve(REPO, '.thetacog/vna-mass-refresh-dispatch.json');
export const MASS_REFRESH_GAP_MS = Number(process.env.VNA_MASS_REFRESH_GAP_MS) || 300000;   // commit mass moves only on new commits — a 5 min gap is generous, never starved
export function dispatchMassRefresh({ receipt = MASS_REFRESH_RECEIPT, gapMs = MASS_REFRESH_GAP_MS, spawnFn = spawn, now = Date.now(), repo = REPO, env = process.env } = {}) {
  if (env.VNA_NO_MASS_DISPATCH) return { dispatched: false, why: 'VNA_NO_MASS_DISPATCH' };
  { const HY = heavyYield({ env }); if (HY) return { dispatched: false, why: HY }; }
  let last = null; try { last = JSON.parse(readFileSync(receipt, 'utf8')); } catch {}
  if (last && Number.isFinite(last.at) && now - last.at < gapMs) return { dispatched: false, why: `backoff: last dispatch ${Math.round((now - last.at) / 1000)}s ago, gap ${Math.round(gapMs / 1000)}s`, pid: last.pid };
  try {
    const c = spawnFn('node', [resolve(repo, 'scripts/vna/read-set.mjs'), '--refresh-mass'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...env, VNA_BY: 'hook:mass-refresh' } });
    const pid = c && c.pid; if (c && c.unref) c.unref();
    try { mkdirSync(dirname(receipt), { recursive: true }); writeFileSync(receipt, JSON.stringify({ at: now, pid })); } catch {}
    return { dispatched: true, pid };
  } catch (e) { return { dispatched: false, why: String(e && e.message || e).slice(0, 80) }; }
}
