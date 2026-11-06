// scripts/vna/door-crate.mjs — C612b THE DOOR AND THE SLOT IN THE CRATE (the node side: spawn, shuttle, map back — nothing decides here).
//
// C610n measured the drift note at a median 21.4 s: the Δ door's node-side compose ~15.2 s (inside it, triptych-build.mjs's
// senseDecompose — 160 claims × 20,736 BigInt popcounts a side — and ten `pmu-onchip --definer-walk` spawns, each writing and
// unlinking a temp grid file) plus the code slot's tree read ~5.6 s. Under MAXIMISE RUST those move into `pmu-onchip --door-serve`
// (.thetacog/pmu/src/door.rs): one long-lived process per node process for the async callers (sense, walks, anchor NCD), and one
// spawn per rankFiles call for the sync slot. Every caller keeps its node path as the reference and the fallback: PMU_DOOR_CRATE=0
// forces it, and any crate error falls back to it, so the answer never depends on whether the crate answered.
//
// THE STATIC ANCHORS (spec rows) — their gzip length is cached ONCE PER HEAD at .thetacog/anchor-clen/<head>.bin (gitignored) by the
// crate, so a note compresses only the prompt and the prompt+anchor pairs. ONE COMPRESSOR: the crate's vendored Node zlib.
//
// Port rows (data/vna/rust-punch-list.json declared): C612b-sense · C612b-walks · C612b-slot · C612b-anchor-ncd · C612b2-*.
// @guard tests/vna/c612b-the-door-and-the-slot-in-the-crate.test.mjs
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { statSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ANCHOR_DIR = (repo = REPO) => resolve(repo, '.thetacog/anchor-clen');
export const crateEnabled = (env = process.env) => env.PMU_DOOR_CRATE !== '0';
// requests: every stage the crate answered (C612r: the panel op answers sense · walks · png · place … in one request, each counted);
// ops: the requests actually sent to the daemon; declined: a panel request the crate handed back to the node path (named, never an error)
export const stats = { requests: {}, fallbacks: {}, ops: {}, declined: {} };
const count = (k, op) => { stats[k][op] = (stats[k][op] || 0) + 1; };
export const noteFallback = (op, e) => { count('fallbacks', op); if (process.env.PMU_DOOR_CRATE_DEBUG) console.error(`door-crate ${op} fell back: ${e && e.message || e}`); };

// ── the long-lived resident (async callers) ─────────────────────────────────────────────────
// C612b2: the resident is a SOCKET daemon (`pmu-onchip --door-serve --socket <SOCK>`), shared by every node process on this machine,
// so what it holds — the tree's rows at a root, the pair signatures, the anchor lengths — survives from one note to the next. A client
// connects; when nothing answers it starts the daemon detached and connects again. A daemon older than the binary on disk (ping's
// exe_mtime_ms) is shut down and replaced. The daemon exits on its own after 30 idle minutes.
// C1373 (2026-10-28): a Unix socket path is capped at SUN_LEN — 104 bytes on macOS, 108 on Linux. Past it the daemon panics before
// it binds ("door-serve failed: path must be shorter than SUN_LEN", measured at 185 bytes), dial() times out, and EVERY walk falls
// back to node — silently, engine=node on the recompute line — for any install whose root is deeper than ~75 characters. A cold
// npm install under a scratch path did exactly this while the same tarball in a short path read engine=rust. The socket stays
// beside the repo when the path fits; otherwise it moves to the OS temp dir, keyed by a hash of the repo path so two repos never
// share a daemon. PMU_DOOR_SOCK still overrides both. (crate-call.mjs:32, lens-bound-guards.mjs:47 and return-reading.mjs:175
// compute the beside-path themselves — repo tooling off the demo's path; named here, not moved.)
export const SUN_PATH_MAX = 100;   // under both limits, with room for the trailing NUL
export function doorSockPath(repo = REPO, env = process.env) {
  if (env.PMU_DOOR_SOCK) return env.PMU_DOOR_SOCK;
  const beside = resolve(repo, '.thetacog/door-serve.sock');
  if (Buffer.byteLength(beside) <= SUN_PATH_MAX) return beside;
  const name = `pmu-door-${createHash('sha256').update(resolve(repo)).digest('hex').slice(0, 12)}.sock`;
  const inTmp = resolve(tmpdir(), name);
  return Buffer.byteLength(inTmp) <= SUN_PATH_MAX ? inTmp : resolve('/tmp', name);
}
export const SOCK = doorSockPath();
let nextId = 1; const pending = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function refState() { /* connections close per request */ }
const connectOnce = () => new Promise((res, rej) => { const s = net.connect(SOCK); s.once('connect', () => { s.removeAllListeners('error'); res(s); }); s.once('error', rej); });
function wire(s) {
  let parts = [];   // a long line (the tree's rows, ~1.8 MB) arrives in many chunks: collect them, join once at its newline
  s.on('data', (chunk) => {
    let from = 0, i;
    while ((i = chunk.indexOf(10, from)) >= 0) {
      parts.push(chunk.subarray(from, i)); from = i + 1;
      const line = Buffer.concat(parts).toString('utf8'); parts = []; if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const p = pending.get(j.id); if (!p) continue; pending.delete(j.id);
      j.error ? p.reject(new Error(j.error)) : p.resolve(j);
    }
    if (from < chunk.length) parts.push(chunk.subarray(from));
    refState();
  });
  const die = (why) => { for (const [id, p] of pending) if (p.s === s) { pending.delete(id); p.reject(new Error(`door-serve ${why}`)); } };   // only this socket's requests
  s.on('error', (e) => die(`socket error ${e.message}`)); s.on('close', () => die('socket closed'));
}
// bf-6808 R1: the pid a started daemon is tied to, or null for the repo's own long-lived door. PMU_DOOR_PARENT_PID names the run
// explicitly; otherwise a daemon is tied to this process when its socket sits off the repo (the C1373 temp-dir move) or the repo
// itself sits under the OS temp dir (a packed extract), because nothing removes that socket when the run ends.
export function doorTiePid({ repo = REPO, sock = SOCK, env = process.env, pid = process.pid, tmp = tmpdir() } = {}) {
  const named = Number(env.PMU_DOOR_PARENT_PID);
  if (Number.isInteger(named) && named > 1) return named;
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const under = (p, root) => p === root || p.startsWith(root + '/');   // both the given and the real path: /var/folders → /private/var
  const offRepo = sock !== resolve(repo, '.thetacog/door-serve.sock');
  const underTmp = [resolve(repo), real(repo)].some((r) => [resolve(tmp), real(tmp), '/tmp', '/private/tmp'].some((t) => under(r, t)));
  return offRepo || underTmp ? pid : null;
}
export const doorServeArgs = (sock = SOCK, tie = doorTiePid({ sock })) => ['--door-serve', '--socket', sock, ...(tie ? ['--parent-pid', String(tie)] : [])];
function spawnDaemon() { const c = spawn(resolvePmuBinary(REPO), doorServeArgs(), { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); }
async function dial() { for (let k = 0; k < 100; k++) { try { return await connectOnce(); } catch { await sleep(30); } } throw new Error(`door-serve socket ${SOCK} did not come up`); }
function send(s, op, payload) {
  return new Promise((res, rej) => { const id = nextId++; pending.set(id, { resolve: res, reject: rej, s }); refState(); s.write(JSON.stringify({ ...payload, op, id }) + '\n'); });
}
// ONE CONNECTION PER REQUEST: a connection is closed as soon as its answer lands, so a client never holds the daemon's door open
// while it idles (the daemon also serves each connection on its own thread). The binary-age check runs once per process.
let checked = false;
async function open() {
  let s; try { s = await connectOnce(); } catch { spawnDaemon(); s = await dial(); }
  wire(s);
  if (!checked) {
    checked = true;
    let binMs = null; try { binMs = Math.floor(statSync(resolvePmuBinary(REPO)).mtimeMs); } catch { /* */ }
    const p = await send(s, 'ping', {});
    if (binMs != null && p.exe_mtime_ms !== binMs) {   // an older daemon than the binary on disk: retire it, start the current one
      try { await send(s, 'shutdown', {}); } catch { /* */ }
      s.destroy();
      for (let k = 0; k < 50 && existsSync(SOCK); k++) await sleep(20);
      spawnDaemon(); s = await dial(); wire(s);
    }
  }
  return s;
}
/** one request to the daemon → its response (rejects on a crate error; the caller falls back) */
export async function ask(op, payload = {}, { timeoutMs = 120000 } = {}) {
  count('requests', op); count('ops', op);
  const s = await open();
  let t; const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`door-serve ${op} timed out`)), timeoutMs); t.unref(); });
  try { return await Promise.race([send(s, op, payload), timeout]); } finally { clearTimeout(t); try { s.end(); } catch { /* */ } }
}
export function stopResident() { /* C612b2: connections close per request; nothing is held open */ }

/** a one-shot spawn for sync callers: the requests in, the responses out, in order */
export function askSync(reqs, { timeoutMs = 120000, relayTimeoutMs = 30000 } = {}) {   // C612j: relayTimeoutMs — a relay that waits longer exits 4 and the one-shot door answers
  const input = reqs.map((r, k) => JSON.stringify({ ...r, id: k + 1 })).join('\n') + '\n';
  for (const r of reqs) count('requests', r.op);
  // C612b2: through the daemon first (--relay: what it holds — the code files at their (len, mtime) — survives across notes); no daemon
  // → start one for next time and answer with the one-shot door, which holds nothing.
  const bin = resolvePmuBinary(REPO); let out = null;
  if (crateEnabled()) {
    try { out = execFileSync(bin, ['--door-serve', '--relay', SOCK, '--timeout-ms', String(relayTimeoutMs)], { input, encoding: 'utf8', maxBuffer: 1 << 30, timeout: timeoutMs, stdio: ['pipe', 'pipe', 'ignore'] }); count('requests', 'relay'); }
    catch { out = null; try { if (!existsSync(SOCK)) spawnDaemon(); } catch { /* */ } }
  }
  if (out == null || !out.trim()) out = execFileSync(bin, ['--door-serve'], { input, encoding: 'utf8', maxBuffer: 1 << 30, timeout: timeoutMs, stdio: ['pipe', 'pipe', 'ignore'] });
  const res = out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  for (const r of res) if (r.error) throw new Error(r.error);
  if (res.length !== reqs.length) throw new Error(`door-serve answered ${res.length} of ${reqs.length}`);
  return res;
}

// ── C1394: THE WALK'S ONE ENTRY — the floor and the health stamp, decided in the crate (door.rs entry_op) ────────────────────
// texts: [{ field, text }] (intent, reality, negative — whatever the caller is about to walk). The crate refuses any text under
// OOC_MIN_CHARS trimmed characters or MIN_GZIP_BYTES of gzip mass (state UNMEASURED, the field and both sizes named) and stamps
// every answer with apertureVersion · reef_sha · axes_sha · engine · the text sizes. Node carries the texts in and the answer out;
// it computes no floor and no stamp. A crate error REJECTS — buildTriptychInputs turns that into UNMEASURED, never a node walk.
// C1406: drawBelowFloor is the commit panel's named opt-in, decided in the crate (the sealed stamp carries below_floor); node passes it on.
// C1407: axes is the ONE library path the sense and the walks read (the stamp hashes it; the walks op refuses another); no reef is
// stamped, since no stage of the walk reads one.
// C1411: leg ('positive' | 'negative') marks a separation leg — the spec walked against its own declared text; the crate stamps the role.
export async function entryCrate({ texts, axes = resolve(REPO, 'data/pmu/snippet-library-144.json'), drawBelowFloor = false, leg = null } = {}) {
  const { apertureInputs } = await import(/* webpackIgnore: true */ '../pmu/prompt-lens.mjs');
  return ask('entry', { texts: (texts || []).map((t) => ({ field: String(t.field), text: String(t.text ?? '') })), axes: resolve(axes), aperture: apertureInputs(), draw_below_floor: !!drawBelowFloor, ...(leg ? { leg } : {}) });
}

// ── C1411 S3: THE ADMISSION — the crate reads the spec's own positive and negative legs and seals spec_separation (door.rs admit_op) ──
// Node carries the reading's sealed stamp and each declared text with its leg's sealed stamp; the crate decides SEPARATED /
// SPEC_INSUFFICIENT / PLACEMENT_ONLY and answers the stamp re-sealed. A crate error rejects; the caller relays it, never a verdict.
export async function admitCrate({ stamp, positive = null, negative = null }) {
  return ask('admit', { stamp, ...(positive ? { positive } : {}), ...(negative ? { negative } : {}) });
}

// ── C1406: A STAMP IS VERIFIED AS THE CRATE'S, NEVER TRUSTED BY SHAPE ─────────────────────────────────────────────────────────
// walkBoolean is synchronous, so the check is one sync door call (door.rs verify_op): the crate recomputes the stamp's seal under its
// own build id and refuses a mismatch, a foreign build, a sub-floor size, or a missing sense/walk stage. Node decides nothing here; it
// carries the stamp in and { ok, reason } out. An answer is held per stamp for the life of the process (same bytes, same binary).
// A crate that cannot answer is a refusal, never a pass.
const _verified = new Map();
export function verifyStamp(stamp) {
  const key = JSON.stringify(stamp ?? null);
  if (_verified.has(key)) return _verified.get(key);
  let v;
  // C1411: admitted / admission are the crate's S3 answer (door.rs admission_reason) — relayed, never computed here
  try { const [r] = askSync([{ op: 'verify', stamp: stamp ?? null }], { timeoutMs: 30000 }); v = { ok: r.ok === true, reason: r.reason || null, admitted: r.admitted === true, admission: r.admission || (r.admitted === true ? null : 'the crate returned no admission (a binary older than C1411)'), specMissing: Array.isArray(r.spec_missing) ? r.spec_missing : null, buildId: r.build_id || null }; }
  catch (e) { v = { ok: false, reason: `the crate could not verify the stamp (${String((e && e.message) || e).slice(0, 120)})`, admitted: false, admission: null, buildId: null }; }
  if (_verified.size > 4096) _verified.clear();
  _verified.set(key, v);
  return v;
}

// ── sense (triptych-build.mjs senseDecompose's score loop) ───────────────────────────────────
/** sides: [[BigInt claim sigs]] → [{ score: Float32Array, grid: Uint8Array, lit, theta }] */
// C1406: a stamp handed in comes back re-sealed by the crate with sense "rust" — on the returned array's .stamp (relayed, never written)
export async function senseCrate({ pairsPath, sides, target = 900, floor = 0.56, stamp = null }) {
  const r = await ask('sense', { pairs: pairsPath, sides: sides.map((s) => s.map((x) => BigInt.asUintN(64, x).toString())), target, floor, ...(stamp ? { stamp } : {}) });
  const out = r.sides.map((s) => {
    const raw = Buffer.from(s.score_b64, 'base64'); const score = new Float32Array(Uint8Array.from(raw).buffer);
    const bits = Buffer.from(s.grid_b64, 'base64'); const grid = new Uint8Array(score.length);
    for (let i = 0; i < grid.length; i++) if (bits[i >> 3] & (1 << (7 - (i & 7)))) grid[i] = 1;
    return { score, grid, lit: s.lit, theta: s.theta };
  });
  if (r.stamp) out.stamp = r.stamp;
  return out;
}

// ── walks (definer-walk-144.mjs definerWalk144, many grids in one call) ──────────────────────
const packBits = (u8) => { const b = Buffer.alloc(Math.ceil(u8.length / 8)); for (let i = 0; i < u8.length; i++) if (u8[i]) b[i >> 3] |= 1 << (7 - (i & 7)); return b.toString('base64'); };
/** the same return shape as definerWalk144, one per grid */
export async function walksCrate(startAnchors, grids, opts = {}) {
  const { floorKnobs } = await import(/* webpackIgnore: true */ '../../src/lib/pmu/walk-knobs.mjs');
  const { COORDS } = await import(/* webpackIgnore: true */ '../pmu/definer-walk-144.mjs');
  const knobs = floorKnobs(opts);
  const seeds = [...new Set((startAnchors || []).filter((x) => x >= 0 && x < 144 && COORDS[x]))];
  const t0 = Date.now();
  // C1406: opts.stamp comes back re-sealed by the crate with the bound that stopped the walks — on the returned array's .stamp
  // C1407: opts.lib is the library the caller's sense read (triptych-build's one path); the module repo's is only the default
  const r = await ask('walks', { lib: resolve(opts.lib || resolve(REPO, 'data/pmu/snippet-library-144.json')), seeds, grids: grids.map(packBits), knobs: { maxDepth: knobs.maxDepth, topK: knobs.topK, budget: knobs.budget, budgetMs: knobs.budgetMs, decay: knobs.decay }, ...(opts.stamp ? { stamp: opts.stamp } : {}), ...(opts.kill != null && Number.isFinite(Number(opts.kill)) ? { kill: Number(opts.kill) } : {}) });   // C1409: the crate decodes at this kill
  const ms = Date.now() - t0;
  const out = r.walks.map((j) => ({ heat: j.heat, ply: j.ply, hops: j.hops, maxPly: j.max_ply, matrix: j.matrix, mPly: j.m_ply, timeBudgetTripped: !!j.time_budget_tripped, elapsedMs: ms,
    knobs: { maxDepth: knobs.maxDepth, topK: knobs.topK, budget: knobs.budget, budgetMs: knobs.budgetMs, decay: knobs.decay }, knobsRaised: knobs.knobsRaised, hopLog: j.hop_log || [] }));
  if (r.stamp) out.stamp = r.stamp;
  return out;
}

// ── slot (code-slot.mjs hitsMany, sync) ─────────────────────────────────────────────────────
/** files (ls-files, filtered) + both term sets → { sym: Map(term → Map(file → lines)), word: … } */
export function slotCrate({ repo, files, symTerms = [], wordTerms = [] }) {
  const [r] = askSync([{ op: 'slot', repo: resolve(repo), files, sym_terms: symTerms, word_terms: wordTerms }]);
  const toMap = (terms, arr) => new Map(terms.map((t, k) => [t, new Map((arr[k] || []).map(([f, ls]) => [f, ls]))]));
  return { sym: toMap(symTerms, r.sym), word: toMap(wordTerms, r.word), filesRead: r.files_read };
}

// ── anchors + NCD (spec-tree.mjs ncd over the spec rows) ─────────────────────────────────────
let _head = null;
export function headOf(repo = REPO) { if (_head && _head.repo === repo) return _head.sha; let sha = null; try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* */ } _head = { repo, sha }; return sha; }
/** anchors [{ id, text }] (already lowercased by the caller, as retro-snowball lowercases) → the crate holds their lengths for this head */
export async function anchorsCrate({ head, anchors, level = 9, dir = ANCHOR_DIR() }) {
  return ask('anchors', { head, dir, level, anchors });
}
/** prompt vs every held anchor id → Map(id → ncd), C(anchor) from the cache */
export async function ncdCrate({ head, prompt, ids }) {
  const r = await ask('ncd', { head, prompt, ids });
  return { ncd: new Map(Object.entries(r.ncd)), promptClen: r.prompt_clen, pairs: r.computed_pairs };
}
/** retro-snowball's textDist from the crate: (id) → ncd(prompt, row) — null when the crate cannot answer (the caller keeps spec-tree ncd) */
export async function crateTextDist({ rows, prompt, repo = REPO, head = headOf(repo) }) {
  if (!crateEnabled() || !head || !rows || !rows.length) return null;
  try {
    const anchors = rows.map((r) => ({ id: r.id, text: String(r.text || '').toLowerCase() }));
    await anchorsCrate({ head, anchors, dir: ANCHOR_DIR(repo) });
    const { ncd } = await ncdCrate({ head, prompt: String(prompt).toLowerCase(), ids: anchors.map((a) => a.id) });
    return (id) => ncd.get(id);
  } catch (e) { noteFallback('ncd', e); return null; }
}

// ── C612b2: the tree's rows held in the daemon (re-read only when the root moves) ────────────────
/** rowsOf(readTree(treePath)) from the daemon — null when the crate cannot answer (the caller reads the tree in node) */
export async function treeRows({ treePath = null } = {}) {
  if (!crateEnabled()) return null;
  try {
    const p = treePath || (await import(/* webpackIgnore: true */ './spec-tree.mjs')).TREE;
    const r = await ask('rows', { tree: resolve(p) });
    return Object.assign(r.rows, { root: r.root, parsed: r.parsed, reads: r.reads });
  } catch (e) { noteFallback('rows', e); return null; }
}
/** C612b2: compress.mjs placePixel for every clause, the 144 snippet lengths from the per-HEAD cache → [{ pixel, sigma }] */
export async function placeCrate(clauses, cells, { repo = REPO, head = headOf(repo) } = {}) {
  if (!head) throw new Error('place: no HEAD');
  const r = await ask('place', { head, dir: ANCHOR_DIR(repo), cells: cells.map((c) => ({ coord: c.coord, snippet: c.snippet })), clauses });
  return r.placements;
}
/** C612b2: annotate-regions.mjs pngFromRgba, encoded in the crate (intentguard png.rs png_from_rgba) */
export async function pngCrate(rgba, w, h) {
  const r = await ask('png', { rgba_b64: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length).toString('base64'), w, h });
  return Buffer.from(r.png_b64, 'base64');
}

// ── C1280/C1304: op:"reward" — the called-shot gate fold (gateFromPanel + reward) and the spill statistic, read through the
// crate when it answers them; node (called-shot-reward.mjs, called-shot-spill.mjs, called-shot-train/score.mjs) stays the
// reference AND the fallback, and runs ONLY when the crate declines — never beside a crate answer, which would be the second
// computation in node this row (C1305) exists to retire. Until C1276/C1304 land the op in door_panel.rs, every call here
// returns null (the door's own catch-all errors "unknown op 'reward'") and every caller's existing node path is unchanged.
export async function rewardCrate(payload) {
  if (!crateEnabled()) return null;
  try { return await ask('reward', payload); }
  catch (e) { noteFallback('reward', e); return null; }
}

// ── C612r: the whole encircled panel in ONE request ────────────────────────────────────────────────────────────────────────────────
// What C612b2 left in node — runPipeline (its five pmu-onchip spawns, the vectors cache, the run receipt, the sealed /epoch post), the
// claim extraction and its simhash, the competence pixel, the tolerance decode, the regions' spawn, the ring drawing — runs in
// `pmu-onchip --door-serve {op:"panel"}` (.thetacog/pmu/src/door_panel.rs). Node sends the two texts and the clauses and gets back the
// panel; it keeps only the light text tail (the region labels and the reef name, the slice of clauses into rings).
// Paths and knobs are read from their one home and passed, never restated in the crate; a request the crate declines (the ncd arm,
// an axes override, the coverage clusterer, a degenerate intent) returns null and the caller runs its own path.
// Port rows C612b-next · C612b2-next (data/vna/rust-punch-list.json). @guard tests/vna/c612r-the-door-node-half-in-the-crate.test.mjs
const PAIRS_DIR = (repo = REPO) => resolve(repo, '.thetacog/cache');                                   // triptych-build.mjs PAIR_CACHE's dir
const DIR_CONN = (repo = REPO) => resolve(repo, '.thetacog/pmu/reef-connectivity-directed.json');      // definer-walk-144.mjs DIR_CONN
const VEC_PATH = (repo = REPO) => resolve(repo, 'data/pmu/pipeline/cache/vectors.json');               // pipeline.mjs VEC_PATH
// C1270: realityKind 'diff' asks the crate to read the reality as a unified diff (hunk-level claims, door_panel.rs diff_ranked); absent
// or 'prose', the claim chain is the one it always was. The crate's answer carries the kind it read (realityKind) and the claim counts
// per side (senseMeta). The node path (PMU_DOOR_CRATE=0) has no diff kind: the diff path lives in the crate only (MAXIMISE RUST).
export async function panelCrate({ intentText, realityText, realityKind, message = null, scale = 4, repo = REPO } = {}) {
  const t0 = performance.now();
  const [{ WALK_KNOBS, floorKnobs }, PS, { UNPLACED_SIGMA }, { HOST_PRIVATE_KEY_PATH }, { canonicalMassFloor }] = await Promise.all([
    import(/* webpackIgnore: true */ '../../src/lib/pmu/walk-knobs.mjs'), import(/* webpackIgnore: true */ '../pmu/pipeline-state.mjs'), import(/* webpackIgnore: true */ '../../src/lib/pmu/unified-drift.mjs'),
    import(/* webpackIgnore: true */ '../pmu/receipt-crypto.mjs'), import(/* webpackIgnore: true */ '../pmu/panel-door.mjs')]);
  const { REGISTRY_PATH: REGISTRY } = await import(/* webpackIgnore: true */ '../pmu/shortlex-registry.mjs');   // the zone seams renderTriptych draws on the panel
  const knobs = floorKnobs({ maxDepth: WALK_KNOBS.maxDepth, topK: WALK_KNOBS.topK, decay: WALK_KNOBS.decay, budget: WALK_KNOBS.budget, budgetMs: WALK_KNOBS.budgetMs });
  const RM = message != null ? await import(/* webpackIgnore: true */ '../pmu/region-message.mjs') : null;
  const clauses = RM ? RM.messageClauses(message) : [];
  const r = await ask('panel', {
    intent: String(intentText || ''), reality: String(realityText || ''), clauses, scale,
    ...(realityKind ? { reality_kind: String(realityKind) } : {}),
    lib: PS.LIB_144_PATH, state: PS.STATE_PATH, stage_dir: PS.STAGES_DIR, vectors: VEC_PATH(repo), pairs_dir: PAIRS_DIR(repo), conn: DIR_CONN(repo),
    key_dir: dirname(HOST_PRIVATE_KEY_PATH), bridge: process.env.CLAUDBRIDGE_URL || 'http://localhost:7777', primary_lens: process.env.PMU_PRIMARY_LENS || '',
    unplaced_sigma: UNPLACED_SIGMA, mass_floor: await canonicalMassFloor(), intent_label: 'intent', reality_label: 'reality', kill: 25,
    knobs: { maxDepth: knobs.maxDepth, topK: knobs.topK, budget: knobs.budget, budgetMs: knobs.budgetMs, decay: knobs.decay }, impostors: WALK_KNOBS.impostors,
    head: clauses.length ? headOf(repo) : null, anchor_dir: ANCHOR_DIR(repo), registry: REGISTRY,
  });
  if (r.fallback) { count('declined', 'panel'); if (process.env.PMU_DOOR_CRATE_DEBUG) console.error(`door-crate panel declined: ${r.fallback}`); return null; }
  for (const op of r.answered || []) if (op !== 'panel') count('requests', op);
  const kn = { maxDepth: knobs.maxDepth, topK: knobs.topK, budget: knobs.budget, budgetMs: knobs.budgetMs, decay: knobs.decay };
  const walkOf = (j) => ({ heat: j.heat, ply: j.ply, hops: j.hops, maxPly: j.max_ply, matrix: j.matrix, mPly: j.m_ply, timeBudgetTripped: !!j.time_budget_tripped, elapsedMs: Math.round(r.walk_ms),
    knobs: kn, knobsRaised: knobs.knobsRaised, hopLog: j.hop_log || [] });
  const c = r.cole;
  const cole = { intent: walkOf(c.intent), reality: walkOf(c.reality), startPixel: c.startPixel, startRow: c.startRow, pixelCell: c.pixelCell, hops: c.hops, maxPly: c.maxPly,
    matchSigma: c.matchSigma, actualMatch: c.actualMatch, impMean: c.impMean, intentCells: c.intentCells, realityCells: c.realityCells };
  const t = r.tol;
  // the nested objects arrive as the crate's ordered JSON text, so their key order is node's (a consumer that stringifies reads the same bytes)
  const meta = { green: t.green, amber: t.amber, red: t.red, offPct: t.offPct, region: r.region_json ? JSON.parse(r.region_json) : undefined, tooMany: t.tooMany, domBlocks: r.domBlocks, edges: 'built',
    refused: !!t.refused, refusal: t.refusal || null, litMass: r.lit_mass_json ? JSON.parse(r.lit_mass_json) : null };
  const { labelChipRegions } = await import(/* webpackIgnore: true */ '../pmu/regions-chip.mjs');
  const regions = labelChipRegions(JSON.parse(r.regions_json).regions);
  if (RM) {
    const placed = new Map(clauses.map((cl, i) => [cl, r.placements[i]]));
    RM.sliceMessageToRegions(message, regions, { pairLib: RM.loadPairLib(), placeFn: (cl) => placed.get(cl) });
  }
  meta.regionEngine = regions.engine;
  const rgba = new Uint8Array(Buffer.from(r.rgba_b64, 'base64'));
  // C612r timing receipt: PMU_DOOR_PANEL_TIMING=<ndjson> appends the crate's own stage times and this call's wall (scripts/vna/c612r-timing.mjs)
  if (process.env.PMU_DOOR_PANEL_TIMING) { try { (await import('node:fs')).appendFileSync(process.env.PMU_DOOR_PANEL_TIMING, JSON.stringify({ crate: r.timing, wall_ms: +(performance.now() - t0).toFixed(1), daemon_ms: r.ms }) + '\n'); } catch { /* a receipt aid, never a failure */ } }
  return { rgba, regions, png: Buffer.from(r.png_b64, 'base64'), meta, cole,
    stages: (({ walk, xor, sense }) => ({ walk: walk || null, xor: xor || null, sense: sense || null, pipelineMs: Math.round(r.pipeline_ms) }))(JSON.parse(r.stages_json)),
    grids: { intent_b64: r.grids.intent_b64, reality_b64: r.grids.reality_b64, sensor: 'claim' }, timing: r.timing,
    realityKind: r.reality_kind || 'prose', senseMeta: r.sense_meta || null };
}
