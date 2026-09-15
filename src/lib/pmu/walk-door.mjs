// src/lib/pmu/walk-door.mjs — ONE DOOR TO THE PER-TEXT WALK, ONE TAPE (rust-pipeline spec v4 · 2026-09-13).
// =============================================================================================
// Operator: "unify how we call the rust pipeline both in commits and here per turn (all added to the tape)".
// Before this file, the chat lens spawned `pmu-onchip --lens` inline (prompt-lens.mjs) and wrote per-file
// receipts; the commit gate ran the per-hop `--ballistic` triptych and wrote data/pmu/measure-history.ndjson.
// Two modes, two tapes, two schemas — the doctor-acting-as-plumber signal (declared lane vs where the work
// landed) could not be read as ONE series across the two events that produce it.
//
// This is the door: every per-text placement — a prompt at turn time, the intent and the reality of a
// commit — runs the SAME one-process Rust walk (seed + walk + fence + 144-byte lattice) through the SAME
// resolver, and appends ONE row to ONE append-only tape. The triptych keeps its panel; this row is the
// comparable number beside it. LLM-free. When the binary refuses, the row says UNMEASURED — never a
// fallback painted as a reading (CLAUDE.md, A LATTICE READING COMES FROM THE ONE RUST WALK).
//
//   import { lensWalk } from '../../src/lib/pmu/walk-door.mjs';
//   const { result, row } = lensWalk(text, { source: 'turn' | 'commit-intent' | 'commit-reality', ref, bulk });
// Tape: .thetacog/walk-tape.ndjson (PMU_WALK_TAPE overrides). Guard: tests/pmu-simulator/walk-door.test.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { resolvePmuBinary } from './pmu-binary.mjs';
import { WALK_KNOBS, lensWalkFlags, floorKnobs, SEED_APERTURE, seedApertureFlags } from './walk-knobs.mjs';
import { MASS_FLOOR, gzipMass } from './thread-aperture.mjs';   // JS-side mirror of the floor + a measurement helper; the thread itself is built inside the binary   // THE ONE WALK-KNOB HOME — the tape walk is the deep walk, never lens.rs's defaults

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const WALK_TAPE = process.env.PMU_WALK_TAPE || resolve(REPO, '.thetacog/walk-tape.ndjson');
export const LENS_TEXT_MAX = 800;   // the same cut the lens has always applied to --text
// THE APERTURE IS PART OF THE ROW (v2, 2026-09-13). A prompt was always cut to 800 chars; a commit's intent or
// reality is 10–30k chars, and cutting it to 800 compared two HEADS, not two corpora (measured: laneJump S/N flat at
// n=17). Per-source caps, both sides of a commit at the SAME cap (matched aperture), and the cap + bulk stamped on
// the row so a series is never read across two apertures as one. PMU_LENS_TEXT_MAX_COMMIT overrides the commit cap.
export const LENS_TEXT_MAX_COMMIT = Number(process.env.PMU_LENS_TEXT_MAX_COMMIT || 12000);
export const capFor = (source) => (source && source.startsWith('commit')) ? LENS_TEXT_MAX_COMMIT : LENS_TEXT_MAX;
// THE DIGEST FOR LONG TEXTS (2026-09-13). The Rust matched seed reads the first BULK_EYE_FINE = 900 chars of --text
// (lens.rs: cut(&intent_full, BULK_EYE_FINE)) — the matched aperture against 671–1,899-char cell snippets. A 30k-char
// diff handed in whole is therefore judged by its first hunk; measured on 88 commits, declared→delivered S/N read
// 0.11 (head-800) and −0.03 (head-12000) — the same head twice. A long text must reach the eye as a SAMPLE of the
// whole span, not its head: lines chosen at an even stride across the text, order kept, filling the eye. Deterministic,
// recomputable, stamped on the row as aperture.digest. Turns (≤ 800 chars) keep 'head'; commit sources use 'strided'.
export const DIGEST_CHARS = Number(process.env.PMU_DIGEST_CHARS || 900);
export function digestForAperture(text, chars = DIGEST_CHARS) {
  const s = String(text); if (s.length <= chars) return s;
  const lines = s.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length <= 1) { const step = Math.max(1, Math.floor(s.length / chars)); let out = ''; for (let i = 0; i < s.length && out.length < chars; i += step) out += s[i]; return out; }
  const avg = Math.max(1, Math.floor(lines.reduce((a, l) => a + l.length + 1, 0) / lines.length));
  const want = Math.max(2, Math.floor(chars / avg));
  const stride = Math.max(1, lines.length / want);
  const picked = []; for (let k = 0; k < want; k++) { const i = Math.min(lines.length - 1, Math.floor(k * stride)); if (picked[picked.length - 1] !== i) picked.push(i); }
  if (picked[picked.length - 1] !== lines.length - 1) picked.push(lines.length - 1);
  const per = Math.max(8, Math.floor((chars - picked.length) / picked.length));   // every picked line gets an equal budget so the LAST line always lands
  let out = ''; for (const i of picked) { const l = lines[i].slice(0, per); out += (out ? '\n' : '') + l; }
  return out.slice(0, chars);
}
// THE DEFAULT IS DECIDED BY THE TAPE (aperture-ab.mjs, 120 commits / 88 pairs, 2026-09-13): admissible placements by the
// seed's own null test — head 14.8% / 14.8% (intent / reality) · strided 8% / 8% · strided+prose 8% / 1.1%. Head wins; the
// digests stay as options and every run is a receipt in .thetacog/aperture-ab.ndjson. Re-run before changing this line.
export const digestFor = (source) => process.env.PMU_COMMIT_DIGEST || 'head';
// THE PROSE PROJECTION OF A DIFF (2026-09-13). Measured on 120 commits: reality placed from raw diff lines was
// admissible by the seed's own null test 1 time in 88 (z median 1.78) — a diff is code, every reef cell is prose,
// so the seed picks the least-far cell and the lane jump is noise. The projection declares what it is sufficient
// for: the LANE of a change by its vocabulary — comment text, identifiers split into words, path basenames — never
// its correctness. Deterministic, recomputable; stamped on the row as aperture.digest = 'prose'.
export function proseProjection(diffText) {
  const words = [];
  for (const raw of String(diffText).split('\n')) {
    let l = raw.replace(/^[+-]/, '').trim(); if (!l) continue;
    const comment = l.match(/(?:\/\/|#|\/\*|\*|<!--|--)\s*(.+)$/); if (comment && comment[1].length > 8) words.push(comment[1].replace(/[^\w\s'-]/g, ' '));
    const paths = l.match(/[\w./-]+\.(?:mjs|js|ts|tsx|rs|md|mdx|sh|json|html|css)\b/g) || []; for (const p of paths) words.push(p.split('/').pop().replace(/\.[a-z]+$/, '').replace(/[-_.]/g, ' '));
    const idents = l.match(/[A-Za-z][A-Za-z0-9_]{3,}/g) || [];
    for (const id of idents) words.push(id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase());
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}
const sha12 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

// The tape's tail, parsed (best-effort). Used by the commit gate to find the PRIOR DECLARATION — the last
// turn row placed BEFORE the commit — and by the end-state readouts. Never throws.
export function readWalkTape(tape = WALK_TAPE, last = 500) {
  try { if (!existsSync(tape)) return []; const lines = readFileSync(tape, 'utf8').trim().split('\n'); const start = Math.max(0, lines.length - last);
    return lines.slice(start).map((l, i) => { try { return { ...JSON.parse(l), _seq: start + i }; } catch { return null; } }).filter(Boolean); } catch { return []; }   // _seq = absolute row index — the T0 binding compares it to the previous seal's count
}

// THE APERTURE RATCHET (operator 2026-09-13: "measured without matching lane mass, producing meaningless zero readings
// … we need the kind of errors to be hardcoded out … cycle until you get a reading by trying different things and
// re-running the ballistic walk and the NCD compression until it makes sense. There needs to be an absolute
// impossibility of that at the architectural level."). This door is the ONE caller of the walk (guarded), so the
// impossibility lives here: a thin text is never walked once against no mass and handed back as a placement. The
// walk is re-run through a ladder of matched masses — the caller's bulk, the named lane's mass, then the reef lanes
// ranked by vocabulary overlap — and stops at the FIRST reading the seed's own null test admits. If none is admitted,
// the row is sensor 'unmeasured' with every attempt on it (gain, z, mass), and the caller must treat the pixel as
// absent. Deterministic, LLM-free, bounded (≤ 4 rungs + guided passes, all inside one binary run).
// THE LADDER LIVES IN THE BINARY (lens.rs bulk_ladder: given → lane → reef lanes by vocabulary overlap, ≤ 4). What
// remains here is a data read the replays use to name a lane's mass; nothing here ranks, cuts, or walks.
let _reef = null;
function reefDomains() {
  if (_reef) return _reef;
  try { _reef = (JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')).domains || []).map((d) => ({ domain: d.domain, coord: d.coord || null, vocab: String(d.vocab || '').toLowerCase().split(/\s+/).filter(Boolean), mass: [d.template || '', ...(d.rules || []).slice(0, 6)].filter(Boolean).join(' ') })); } catch { _reef = []; }
  return _reef;
}
export function laneMass(domain) { const d = reefDomains().find((x) => x.domain === domain); return d ? d.mass : ''; }

export function lensWalk(text, { source = 'turn', ref = null, bulk = null, repoRoot = REPO, timeoutMs = 800, seed = 'matched', tape = WALK_TAPE, extra = null, maxChars = null, digest = null, lane = null, knobs = WALK_KNOBS, session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null, receiptsDir = undefined, before = null, seedAperture = SEED_APERTURE } = {}) {
  const bin = resolvePmuBinary(repoRoot);
  // THE FLOOR: a caller may not walk shallower than the home (operator 2026-09-14: "the full is the minimum")
  knobs = floorKnobs(knobs || {});
  const cap = maxChars || capFor(source);
  const mode = digest || digestFor(source);
  const used = mode === 'strided' ? digestForAperture(String(text).slice(0, cap), DIGEST_CHARS)
    : mode === 'prose' ? digestForAperture(proseProjection(String(text).slice(0, cap)), DIGEST_CHARS)
    : String(text).slice(0, cap);
  const t0 = performance.now();
  let result = null, err = null, attempts = [];
  if (process.env.PMU_BINARY === 'absent' || !bin || !existsSync(bin)) err = 'binary absent';
  else {
    // ONE RUN, ONE RUST (operator 2026-09-14): the thread (intent latches first), the mass ladder (given → lane →
    // reef), the walk-guided rung and the winner are all decided inside pmu-onchip --lens. This door passes the
    // line and the config and reads the answer. No loop here, no ladder here, no receipt read here — ever.
    const args = ['--lens', '--seed', seed, '--text', used, ...(session ? ['--session', String(session)] : []), ...(receiptsDir ? ['--receipts-dir', receiptsDir] : []), ...(before ? ['--before', String(before)] : []), ...(lane ? ['--lane', String(lane)] : []), ...(bulk ? ['--bulk', String(bulk)] : []), '--guided-passes', String(Number(seedAperture && seedAperture.guidedPasses != null ? seedAperture.guidedPasses : SEED_APERTURE.guidedPasses) || 0), ...lensWalkFlags(knobs), ...seedApertureFlags(seedAperture)];   // knobs already floored above
    try {
      const j = JSON.parse(execFileSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }));
      attempts = Array.isArray(j.attempts) ? j.attempts : [];
      if (j && j.pixel) result = j; else err = 'no pixel';
    } catch (e) { err = String(e && e.message || e).slice(0, 120); }
  }
  const thread = result && result.intent_span && result.intent_span.thread ? result.intent_span : null;
  const admissible = !!(result && result.seed_fit && result.seed_fit.better_than_random);
  const winner = result && result.ratchet ? attempts.find((x) => x.label === result.ratchet.winner) : null;
  const bulkChars = winner ? Number(winner.mass) || 0 : (bulk ? String(bulk).length : 0);
  const ms = +(performance.now() - t0).toFixed(1);
  const inN = result ? (result.in_role || []).length : null, outN = result ? (result.out_of_role || []).length : null;
  const row = {
    ts: new Date().toISOString(), source, ref, session: process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null, text_sha: sha12(text), text_chars: String(text).length, bulk_chars: bulkChars,
    aperture: { cap, used: used.length, bulk: bulkChars ? 1 : 0, digest: mode, ladder: attempts.length, thread: thread ? 1 : 0 },
    // intentSpan: the mass window an auditor recomputes — which prompts the WINNING reading walked
    intentSpan: result && result.intent_span ? result.intent_span : { prompts: 1, chars: used.length, gzip: gzipMass(used), floor: MASS_FLOOR, session: session || null, thread: false },
    ratchet: result && result.ratchet ? result.ratchet : null,   // steps · guided_passes · winner — the search cost, on the row
    trajectory: attempts.map((x) => x.pixel || null),   // WHERE IT MOVES as mass is added is the sensor (operator 2026-09-14)
    aperture_id: `t${cap}b${bulkChars ? 1 : 0}${mode === 'strided' ? 'd' : mode === 'prose' ? 'p' : 'h'}k${knobs.maxDepth}`,
    knobs: { maxDepth: knobs.maxDepth, topK: knobs.topK, budget: knobs.budget, decay: knobs.decay, raised: knobs.knobsRaised || [] },   // the walk's instrument setting, on every row — a series is split by this, never pooled across a knob change
    sensor: admissible ? 'metal' : 'unmeasured', admissible, attempts, err,   // 'metal' ONLY for a reading the seed's null test admits; otherwise UNMEASURED with every attempt on the row
    pixel: result ? result.pixel : null, sigma: result ? result.sigma : null,
    fit: result && result.seed_fit ? { gain: result.seed_fit.gain, z: result.seed_fit.z_fine, ok: !!result.seed_fit.better_than_random } : null,
    walked: result ? (result.walked || []).length : null, in_role: inN, out_of_role: outN,
    cells: result ? (result.walked || []) : null,   // the walked coords themselves — the 144-lattice mask a Hamming distance is taken over (end-state metric ΔH)
    off_pct: result && (inN + outN) > 0 ? Math.round(100 * outN / (inN + outN)) : null,
    hops: result ? result.hops : null, max_ply: result ? result.max_ply : null, ms,
    bin: bin ? bin.replace(REPO + '/', '') : null, bin_mtime: (() => { try { return statSync(bin).mtime.toISOString(); } catch { return null; } })(),
    ...(extra || {}),
  };
  // CLI/test runs (source lens-cli) are NOT executions: measured 2026-09-13, one hour of suites wrote 1,460 such rows
  // beside 265 turns — the actuarial tape is for turns and commits only. PMU_WALK_TAPE_CLI=1 records them for a study.
  if (source !== 'lens-cli' || process.env.PMU_WALK_TAPE_CLI === '1') {
    try { mkdirSync(dirname(tape), { recursive: true }); appendFileSync(tape, JSON.stringify(row) + '\n'); } catch { /* the tape is best-effort; the result still returns */ }
  }
  return { result, row };
}
