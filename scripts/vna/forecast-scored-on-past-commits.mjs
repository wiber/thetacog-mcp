#!/usr/bin/env node
// scripts/vna/forecast-scored-on-past-commits.mjs — C610b THE FORECAST SCORED ON PAST COMMITS. LINE 1 IS THE HIT RATE.
//
// The trust number: for every dispatched row with a stored brief and the commit that ticked it, rebuild the BEFORE state
// the builder had, walk the ensemble forecast over it, and ask whether the forecast named where the commit landed —
// better than another row's forecast (SHUFFLED) and better than today's single walk (SINGLE). LLM-free.
//
// PAIRING — reused verbatim, never a second pairer: brief-predicts-commit.mjs collectLive (C609a): briefs =
// .thetacog/runner/*.snowball.txt, the ticking commit = runner.ndjson's ok verdict/audit sha, else the first commit after
// dispatch whose subject leads with the row. THE TIME FENCE: a pair whose brief postdates its commit (brief_at > commit_at,
// brief_at = the row's first dispatch in runner.ndjson) is listed in `fenced` and contributes NOTHING to any number.
//
// THE BEFORE STATE (W3 — the immutable record, never the working tree):
//   intent    = the row's text in the spec AT THE PARENT + the S_in basins aperture-receipt.mjs intentPriority itemises for
//               that row (its snowball path headlines) + the brief (the candidate) + the ask when runner.ndjson holds one;
//   reality_0 = the files the row names, read with `git show <sha>^:<path>` (reality0() below — the guard pins it).
// THE DOOR: matchAperture (aperture.mjs) → panel (panel-door.mjs, the one door C567 and the commit email use) → its sensed
// 144×144 grids (stages.xor, MSB-first), apertureVersion() stamped. Nothing here walks except definer-walk-144.mjs.
//   ENSEMBLE  ensembleWalk(intent grid, top-k K=3)            — C610a; `ensemble_anchors` (rule intent-anchors) rides along
//   SINGLE    ensembleWalk(intent grid, top-k K=1)            — today's walk, byte for byte
//   SHUFFLED  another pair's ENSEMBLE forecast in the same ±25 % brief-size band (C609a's BAND), K seeded draws
//   OUTCOME A the realised commit's Δ heat through the same door, same intent: walk(reality grid at <sha>) −
//             walk(reality grid at <sha>^), positive part.
//
// PRIMARY, pre-registered: hit = every one of A's top-3 anchors has an F top-3 anchor within Chebyshev ≤ 2 blocks on the
// 12×12 anchor grid (THE METER's geometry; the same hit() C610h provisionally used). SECONDARY, reported on line 2 and
// never swapped into line 1: gzip-NCD(F bytes, A bytes) at a matched 144-byte length (each heat max-normalised to 0..255).
// Halves split by session (C609a's rule: sessions in order, each to the currently smaller half). Bar per half: z ≥ 2 on the
// ENSEMBLE hit rate vs the SHUFFLED rate AND n ≥ 20, else UNMEASURED with the count. ENSEMBLE vs SINGLE is its own paired
// z (McNemar on the discordant pairs), never "better" without it.
//
// ── THE PAIR SHAPE (the plug for C610h and any later arm) ─────────────────────────────────────────────────────────────
//   { label, sha, session, briefBytes, brief_at?, commit_at?,
//     forecasts: { ensemble, single, <any other arm, e.g. chained> },   each = [anchor…] (top-3, heat DESC)
//                                                                     or { top:[anchor…], bytes?:Buffer(144) }
//     outcome:  [anchor…] | { top:[anchor…], bytes?:Buffer(144) } }    — the walked commit's Δ cells
//   Anchors are 0..143 in definer-walk-144.mjs COORDS order; block = (⌊a/12⌋, a mod 12). Every arm in `forecasts` beyond
//   ensemble/single is scored on the identical pair set as an extra arm (rate + z per half + paired z vs single). C610h's
//   runLive pairs ({ forecasts:{single,chained,ensemble}, outcome }) plug in unchanged; mergeArm() folds a separately
//   produced arm in by label|sha. When scripts/vna/chained-ingress.mjs is TRACKED in git, the live run adds its chained arm.
//
// Sufficient for: whether the ensemble forecast names where the commit will land better than chance and better than one
// ingress, recomputable from the record. NOT sufficient for: whether the commit was good (Rice), or whether the builder
// read the forecast (none existed yet).
//
// Rust port row: declared C610b-port — the scorer DECIDES a verdict (MEASURED/UNMEASURED), so once in use hit()/the
// half split move into lens.rs beside --ensemble-walk; the git shuttling and the door calls stay node.
//
// @guard tests/vna/c610b-the-forecast-scored-on-past-commits.test.mjs
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_JSON = resolve(REPO, 'data/vna/forecast-hit-rate.json');
export const TOP_N = 3;
export const FENCE = 2;                       // Chebyshev blocks (THE METER)
export const BAND = 0.25;                     // C609a's shuffled-brief size band
export const K_DEFAULT = 50;
export const BAR = Object.freeze({ z: 2, n: 20 });
export const SPEC_REL = 'docs/specs/vna/SPEC-VNA-COCKPIT.md';
export const PORT_ROW = 'C610b-port — lens.rs forecast_hit(F_top, A_top, fence) + the session half split: the scorer decides a verdict, so it moves into the crate beside --ensemble-walk';
export const SUFFICIENT_FOR = 'whether the ensemble forecast names where the commit will land better than chance (SHUFFLED) and better than one ingress (SINGLE), recomputable from the record';
export const NOT_SUFFICIENT_FOR = 'whether the commit was good (Rice), or whether the builder read the forecast (none existed yet)';

// ── the pure core ───────────────────────────────────────────────────────────────────────────────────────────────────
const blk = (a) => [Math.floor(a / 12), a % 12];
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
/** hit(F, A) — every outcome anchor has a forecast anchor within FENCE blocks. Empty either side ⇒ false. */
export function hit(F, A, fence = FENCE) {
  if (!F?.length || !A?.length) return false;
  return A.every((a) => F.some((f) => cheb(blk(f), blk(a)) <= fence));
}
/** topCells(heat, n) — the n hottest anchors with heat > 0 (heat DESC, index ASC). */
export function topCells(heat, n = TOP_N) {
  return Array.from(heat, (v, i) => [Number(v) || 0, i]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, n).map((x) => x[1]);
}
/** heatBytes(heat144) — max-normalised to 0..255, exactly 144 bytes (the matched length for the secondary). */
export function heatBytes(heat) {
  const h = Array.from(heat, (v) => Math.max(0, Number(v) || 0)); const m = Math.max(0, ...h);
  return Buffer.from(h.map((v) => (m > 0 ? Math.round((255 * v) / m) : 0)));
}
const C = (b) => gzipSync(b, { windowBits: 15 }).length;
/** ncd(x, y) — gzip normalised compression distance (lens.rs node_gzip_len settings). */
export function ncd(x, y) {
  const cx = C(x), cy = C(y), cxy = C(Buffer.concat([x, y]));
  return (cxy - Math.min(cx, cy)) / Math.max(cx, cy);
}

const topOf = (v) => (Array.isArray(v) ? v : v?.top || null);
const bytesOf = (v) => (v && !Array.isArray(v) && v.bytes ? Buffer.from(v.bytes) : null);
function hash32(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** fenced(p) — the brief postdates its commit: it could have quoted it, so it is never scored. */
export const isFenced = (p) => !!(p.brief_at && p.commit_at && Date.parse(p.brief_at) > Date.parse(p.commit_at));

/** binomial z of k hits in n against null rate p; p clipped half a draw inside (0,1) so a perfect null still reads. */
function zOf(k, n, p, draws) {
  if (!(n > 0) || p == null) return null;
  const eps = 0.5 / Math.max(1, draws);
  const q = Math.min(1 - eps, Math.max(eps, p));
  return (k / n - q) / Math.sqrt((q * (1 - q)) / n);
}
/** McNemar paired z: b = a hit where b missed, c = the reverse. null when no pair is discordant. */
function pairedZ(rows, a, b) {
  const v = rows.filter((r) => r[a] != null && r[b] != null);
  const x = v.filter((r) => r[a] && !r[b]).length, y = v.filter((r) => !r[a] && r[b]).length;
  return x + y > 0 ? (x - y) / Math.sqrt(x + y) : null;
}

/**
 * scoreForecasts(pairs, { K, seed }) — PURE. Returns { verdict, why, line, line2, halves, rates, per, fenced, no_null, arms }.
 */
export function scoreForecasts(pairs, { K = K_DEFAULT, seed = 'C610b' } = {}) {
  const fenced = pairs.filter(isFenced).map((p) => ({ label: p.label, sha: p.sha ?? null, brief_at: p.brief_at, commit_at: p.commit_at, why: 'brief postdates its commit' }));
  const live = pairs.filter((p) => !isFenced(p) && topOf(p.outcome)?.length && topOf(p.forecasts?.ensemble)?.length);
  const arms = [...new Set(live.flatMap((p) => Object.keys(p.forecasts || {})))].filter((a) => a !== 'ensemble').sort((a, b) => (a === 'single' ? -1 : b === 'single' ? 1 : a.localeCompare(b)));
  const no_null = [], per = [];
  for (const p of live) {
    const bb = Number(p.briefBytes) || 0;
    const band = live.filter((q) => q !== p && Math.abs((Number(q.briefBytes) || 0) - bb) <= BAND * bb);
    if (!band.length) { no_null.push({ label: p.label, briefBytes: bb, band_n: 0 }); continue; }
    const rnd = mulberry32(hash32(`${seed}:${p.label}:${p.sha ?? ''}`));
    const draws = Array.from({ length: K }, () => band[Math.floor(rnd() * band.length)]);
    const A = topOf(p.outcome), Fe = topOf(p.forecasts.ensemble);
    const nullHits = draws.map((q) => hit(topOf(q.forecasts.ensemble), A));
    const row = { label: p.label, sha: p.sha ?? null, session: p.session ?? p.label, null: mean(nullHits.map(Number)), draws: draws.map((q) => q.label), band_n: band.length, ensemble: hit(Fe, A) };
    for (const a of arms) row[a] = topOf(p.forecasts[a])?.length ? hit(topOf(p.forecasts[a]), A) : null;
    const Ab = bytesOf(p.outcome), Fb = bytesOf(p.forecasts.ensemble);
    if (Ab && Fb) {
      row.ncd = ncd(Fb, Ab);
      const nb = draws.map((q) => bytesOf(q.forecasts.ensemble)).filter(Boolean);
      row.ncd_null = nb.length ? mean(nb.map((b) => ncd(b, Ab))) : null;
    }
    per.push(row);
  }
  // halves split by session (C609a's rule)
  const sessions = [...new Set(per.map((r) => r.session))].sort();
  const half = new Map(); const cnt = [0, 0];
  for (const s of sessions) { const n = per.filter((r) => r.session === s).length; const h = cnt[0] <= cnt[1] ? 0 : 1; half.set(s, h); cnt[h] += n; }
  for (const r of per) r.half = half.get(r.session) === 0 ? 'a' : 'b';
  const rate = (rows, k) => { const v = rows.filter((r) => r[k] != null); return v.length ? v.filter((r) => r[k]).length / v.length : null; };
  const halves = ['a', 'b'].map((h) => {
    const rows = per.filter((r) => r.half === h); const n = rows.length; const p = mean(rows.map((r) => r.null));
    const D = n * K;
    const out = { half: h, n, null: p, ensemble: rate(rows, 'ensemble'), z: zOf(rows.filter((r) => r.ensemble).length, n, p, D), sessions: sessions.filter((s) => half.get(s) === (h === 'a' ? 0 : 1)) };
    out.arms = Object.fromEntries(arms.map((a) => { const v = rows.filter((r) => r[a] != null); return [a, { rate: rate(rows, a), n: v.length, z: zOf(v.filter((r) => r[a]).length, v.length, p, D), paired_z_vs_ensemble: pairedZ(rows, 'ensemble', a) }]; }));
    out.paired_z_ens_vs_single = pairedZ(rows, 'ensemble', 'single');
    const nc = rows.filter((r) => r.ncd != null && r.ncd_null != null);
    out.ncd = nc.length ? { n: nc.length, ensemble: mean(nc.map((r) => r.ncd)), null: mean(nc.map((r) => r.ncd_null)) } : null;
    return out;
  });
  const why = [];
  for (const h of halves) {
    if (h.n < BAR.n) why.push(`n ${h.n} < ${BAR.n} in half ${h.half}`);
    else if (!(h.z != null && h.z >= BAR.z)) why.push(`z ${h.z == null ? '—' : h.z.toFixed(2)} < ${BAR.z} in half ${h.half}`);
  }
  const verdict = why.length ? 'UNMEASURED' : 'MEASURED';
  const rates = { ensemble: rate(per, 'ensemble'), shuffled: mean(per.map((r) => r.null)), ...Object.fromEntries(arms.map((a) => [a, rate(per, a)])) };
  const f = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
  const [a, b] = halves;
  const line = `C610b: hit rate ${f(rates.ensemble)} vs null ${f(rates.shuffled)} · single ${f(rates.single)} · z ${f(a.z, 2)}|${f(b.z, 2)} · n ${a.n}|${b.n} · ${verdict} — ` +
    (why.length ? why.join('; ') : `the ensemble clears z ≥ ${BAR.z}, n ≥ ${BAR.n} in both halves`) +
    (fenced.length ? ` · ${fenced.length} fenced (brief postdates commit), not scored` : '') +
    (no_null.length ? ` · ${no_null.length} with no size-band null` : '');
  const ncdAll = per.filter((r) => r.ncd != null && r.ncd_null != null);
  const extra = arms.filter((x) => x !== 'single').map((x) => `${x} ${f(rates[x])} (paired z vs ensemble ${f(a.arms[x]?.paired_z_vs_ensemble, 2)}|${f(b.arms[x]?.paired_z_vs_ensemble, 2)})`);
  const line2 = `C610b secondary (reported, never swapped into line 1): NCD ensemble ${f(mean(ncdAll.map((r) => r.ncd)))} vs null ${f(mean(ncdAll.map((r) => r.ncd_null)))} (n ${ncdAll.length}, 144 B matched) · ` +
    `ensemble−single paired z ${f(a.paired_z_ens_vs_single, 2)}|${f(b.paired_z_ens_vs_single, 2)}` + (extra.length ? ` · ${extra.join(' · ')}` : '');
  return { verdict, why, line, line2, halves, rates, per, fenced, no_null, arms: ['ensemble', ...arms, 'shuffled'], K, seed, bar: BAR, fence: FENCE, top_n: TOP_N, band: BAND };
}

/** mergeArm(pairs, name, forecastsByKey) — fold a separately produced arm (e.g. C610h chained) in by `label|sha`. */
export function mergeArm(pairs, name, byKey) {
  return pairs.map((p) => { const v = byKey[`${p.label}|${p.sha}`] ?? byKey[p.label]; return v ? { ...p, forecasts: { ...p.forecasts, [name]: v } } : p; });
}

// ── the record readers (W3: the immutable commit, never the working tree) ──────────────────────────────────────────
const gitOut = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
/** reality0(repo, sha, paths) — the files at the commit's PARENT (`git show <sha>^:<path>`); a path absent there is skipped. */
export function reality0(repo, sha, paths) {
  const docs = [];
  for (const p of paths) { try { docs.push({ path: `${sha.slice(0, 10)}^:${p}`, text: gitOut(repo, ['show', `${sha}^:${p}`]) }); } catch { /* absent at the parent */ } }
  return docs;
}
/** realityAt(repo, sha, paths) — the same files at the commit itself (the outcome side). */
export function realityAt(repo, sha, paths) {
  const docs = [];
  for (const p of paths) { try { docs.push({ path: `${sha.slice(0, 10)}:${p}`, text: gitOut(repo, ['show', `${sha}:${p}`]) }); } catch { /* deleted by the commit */ } }
  return docs;
}
/** rowAt(specMd, label) → { text, paths } — the row's line and the backticked paths it names. */
export function rowAt(specMd, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = String(specMd || '').split('\n').find((l) => new RegExp(`^\\s*- \\[[ xX]\\] ${esc}(?![A-Za-z0-9])`).test(l)) || null;
  if (!line) return { text: null, paths: [] };
  const paths = [...new Set([...line.matchAll(/`([^`\s]+)`/g)].map((m) => m[1].replace(/[:#].*$/, '')).filter((p) => /\//.test(p) && /\.[A-Za-z0-9]+$/.test(p) && !/^https?:/.test(p)))];
  return { text: line, paths };
}

// ── the live run ────────────────────────────────────────────────────────────────────────────────────────────────────
function unpack(b64) {
  const bytes = Buffer.from(String(b64 || ''), 'base64'); const out = new Uint8Array(20736);
  for (let i = 0; i < 20736; i++) if (bytes[i >> 3] & (1 << (7 - (i & 7)))) out[i] = 1;
  return out;
}
const CHECKPOINT = process.env.FORECAST_HIT_CHECKPOINT || resolve(tmpdir(), 'c610b-forecast-hit.checkpoint.ndjson');

export async function runLive({ repo = REPO, limit = Infinity, K = K_DEFAULT, out = OUT_JSON } = {}) {
  const { collectLive } = await import('./brief-predicts-commit.mjs');
  const { matchAperture } = await import('./aperture.mjs');
  const { intentPriority } = await import('./aperture-receipt.mjs');
  const { panel } = await import('../pmu/panel-door.mjs');
  const dw = await import('../pmu/definer-walk-144.mjs');
  const { apertureVersion } = await import('../pmu/prompt-lens.mjs');
  let chained = null;
  try { gitOut(repo, ['ls-files', '--error-unmatch', 'scripts/vna/chained-ingress.mjs']); chained = (await import('./chained-ingress.mjs')).chainedWalk || null; } catch { /* C610h not landed */ }

  const ledger = existsSync(join(repo, '.thetacog/runner.ndjson'))
    ? readFileSync(join(repo, '.thetacog/runner.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const { pairs: raw, unpaired } = collectLive(repo);
  const cp = new Map();
  if (existsSync(CHECKPOINT)) for (const l of readFileSync(CHECKPOINT, 'utf8').split('\n')) { try { const j = JSON.parse(l); cp.set(j.key, j.reading); } catch { /* */ } }
  const door = async (intentDocs, realityDocs, label) => {
    const ap = matchAperture(intentDocs, realityDocs);
    if (ap.admissible === false) return { ok: false, reason: `aperture: ${ap.reason || 'inadmissible'}` };
    const d = await panel({ intent: ap.intent, reality: ap.reality, label });
    const x = d?.stages?.xor;
    return d.unmeasured || !x?.intent_bitmap_b64 || !x?.reality_bitmap_b64 ? { ok: false, reason: `door: ${d.unmeasured || 'no sense grids returned'}` } : { ok: true, i: x.intent_bitmap_b64, r: x.reality_bitmap_b64 };
  };
  const pairs = [], refused = [];
  for (const p of raw.slice(0, limit)) {
    const mine = ledger.filter((r) => r.label === p.label);
    const brief_at = mine.filter((r) => r.kind === 'dispatch').map((r) => r.at).sort()[0] ?? null;
    let commit_at = null; try { commit_at = gitOut(repo, ['show', '-s', '--format=%cI', p.sha]).trim(); } catch { /* */ }
    const base = { label: p.label, sha: p.sha, session: p.session, briefBytes: p.brief.length, brief_at, commit_at };
    if (isFenced(base)) { pairs.push({ ...base, forecasts: {}, outcome: [] }); continue; }   // listed as fenced by the scorer, never walked
    const key = `${p.label}|${p.sha}`;
    let reading = cp.get(key);
    if (!reading) {
      let specMd = null; try { specMd = gitOut(repo, ['show', `${p.sha}^:${SPEC_REL}`]); } catch { /* */ }
      const row = rowAt(specMd, p.label);
      if (!row.text) reading = { ok: false, reason: 'the row is not in the spec at the parent' };
      else {
        const r0 = reality0(repo, p.sha, row.paths), r1 = realityAt(repo, p.sha, row.paths);
        if (!r0.length || !r1.length) reading = { ok: false, reason: `the row names no file present at ${r0.length ? 'the commit' : 'the parent'} (${row.paths.length} named)` };
        else {
          const basins = intentPriority({ ids: [p.label], specMd }).flatMap((x) => (x.snowball_path || []).map((n) => n.headline)).filter(Boolean);
          const ask = mine.map((r) => r.ask).find((x) => typeof x === 'string' && x.trim()) || '';
          const intentDocs = [{ path: `${SPEC_REL}@${p.sha.slice(0, 10)}^ (row ${p.label} + S_in basins)`, text: [row.text, ...basins].join('\n') },
            { path: `brief ${p.label}`, text: p.brief.toString('utf8') + (ask ? `\n${ask}` : '') }];
          const before = await door(intentDocs, r0, `C610b before ${p.label}@${p.sha.slice(0, 10)}^`);
          const after = before.ok ? await door(intentDocs, r1, `C610b after ${p.label}@${p.sha.slice(0, 10)}`) : before;
          reading = before.ok && after.ok ? { ok: true, i0: before.i, r0: before.r, r1: after.r, basins: basins.length, paths: row.paths } : { ok: false, reason: (before.ok ? after : before).reason };
        }
      }
      cp.set(key, reading); mkdirSync(dirname(CHECKPOINT), { recursive: true });
      appendFileSync(CHECKPOINT, JSON.stringify({ key, reading, at: new Date().toISOString() }) + '\n');
    }
    if (!reading.ok) { refused.push({ label: p.label, sha: p.sha, why: reading.reason }); continue; }
    const fp = await forecastPair(reading, dw, chained);
    if (fp.refused) { refused.push({ label: p.label, sha: p.sha, why: fp.refused }); continue; }
    pairs.push({ ...base, forecasts: fp.forecasts, outcome: fp.outcome, spread_mean: fp.spread_mean });
  }
  const s = scoreForecasts(pairs, { K });
  const C2 = dw.COORDS;
  const doc = {
    at: new Date().toISOString(), row: 'C610b', llm: false, aperture_version: apertureVersion(), line: s.line, line2: s.line2,
    verdict: s.verdict, why: s.why, rates: s.rates, halves: s.halves, arms: s.arms, K: s.K, bar: BAR, fence: FENCE, top_n: TOP_N, band: BAND,
    sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR, port_row: PORT_ROW,
    counts: { collected: raw.length, unpaired: unpaired.length, fenced: s.fenced.length, refused: refused.length, walked: pairs.length - s.fenced.length, scored: s.per.length, no_null: s.no_null.length },
    pairs: pairs.filter((p) => !isFenced(p)).map((p) => ({ label: p.label, sha: p.sha, session: p.session, briefBytes: p.briefBytes,
      zones: Object.fromEntries(Object.entries(p.forecasts).map(([k, v]) => [k, topOf(v).map((a) => ({ anchor: a, coord: C2[a] }))])),
      delta_cells: topOf(p.outcome).map((a) => ({ anchor: a, coord: C2[a] })), spread_mean: p.spread_mean })),
    per: s.per, fenced: s.fenced, refused, unpaired, no_null: s.no_null,
  };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); }
  return doc;
}

// ═══ C610j THE WIDE CORPUS AND THE PRIOR NEIGHBOURHOOD — the same scorer, more pairs, three reality_0 arms ═══════════════
// C610b read n 1|2: 60 dispatched briefs, and 22 of 28 refusals named no file existing before the work. Two changes, each
// its own arm, scored by scoreForecasts() above (extended, never forked):
//   CORPUS    every attested commit in data/vna/attestations.ndjson (rows merged by sha, labels unioned); the declaration =
//             the attested rows' text at <sha>^ (+ their S_in basins, as C610b); dispatched-brief pairs (collectLive) are
//             marked `dispatched` and kept as a subset; halves by COMMIT DAY (session = the commit's UTC day).
//   REALITY_0 three named definitions, scored side by side, NEVER merged (each its own scoreForecasts call):
//     named          the files the rows name that exist at <sha>^ — C610b's rule, kept;
//     neighbourhood  the files touched by the PRIOR attested commits (commit time strictly < this commit's) of the
//                    NEIGHBOUR_K rows nearest this declaration by gzip-NCD (spec-tree.mjs ncd()), read at <sha>^ —
//                    derived from history, never from the outcome. No prior neighbourhood ⇒ REPORTED, never scored;
//     touched        the files this commit touches, at <sha>^ — LEAKY (the outcome chose them): a labelled upper bound on
//                    line 2, NEVER line 1.
//   LINE 1 = the hit rate on the PRIMARY arm (ensemble × neighbourhood), z + n per half, the bar; LINE 2 = every arm.
// Sufficient for: whether the walk over declaration × pre-work reality forecasts where the commit's Δ lands, on enough
// pairs to read. NOT sufficient for: whether the work was good (Rice).
// Cost: each (sha, arm) is walked once through the door and cached under .thetacog/cache/forecast-wide/<apertureVersion>/
// (gitignored); shards run as bounded child processes; a full run past ~30 min runs a seeded sample (SAMPLE_N, seed on line 1).
export const REALITY_ARMS = Object.freeze(['named', 'neighbourhood', 'touched']);
export const PRIMARY_ARM = 'neighbourhood';
export const LEAKY_ARMS = Object.freeze(['touched']);
export const NEIGHBOUR_K = 5;                  // the k nearest rows by gzip-NCD — named once
export const MAX_REALITY_FILES = 12;           // a reality side is at most this many files (nearest row first, newest commit first)
export const MAX_FILE_BYTES = 1 << 20;         // a blob over 1 MiB at <sha>^ is skipped (the aperture would window it anyway)
export const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp3|mp4|m4a|wav|mov|zip|gz|tgz|vsix|node|wasm|bin|sqlite|db)$/i;   // no text to walk
export const SAMPLE_N = 400;
export const SAMPLE_SEED = 'C610j';
export const ATTEST_REL = 'data/vna/attestations.ndjson';
export const OUT_WIDE = resolve(REPO, 'data/vna/forecast-hit-rate-wide.json');
export const WIDE_CACHE = process.env.FORECAST_WIDE_CACHE || resolve(REPO, '.thetacog/cache/forecast-wide');
export const WIDE_SUFFICIENT_FOR = "whether the walk over declaration × pre-work reality forecasts where the commit's Δ lands, on enough pairs to read";
export const WIDE_NOT_SUFFICIENT_FOR = 'whether the work was good (Rice)';
const ms = (t) => Date.parse(t);

/** commitDay(iso) — the half key: the commit's UTC day. */
export const commitDay = (iso) => new Date(ms(iso)).toISOString().slice(0, 10);

/** mergeAttestations(rows) — one entry per sha, labels unioned in first-seen order. */
export function mergeAttestations(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r?.sha || !Array.isArray(r.labels)) continue;
    const e = by.get(r.sha) || { sha: r.sha, labels: [] };
    for (const l of r.labels) if (!e.labels.includes(l)) e.labels.push(l);
    by.set(r.sha, e);
  }
  return [...by.values()];
}

/** sampleCommits(list, n, seed) — a seeded draw without replacement, returned in the list's order. n ≥ length ⇒ all. */
export function sampleCommits(list, n = SAMPLE_N, seed = SAMPLE_SEED) {
  if (!(n < list.length)) return { sampled: false, seed: null, items: list.slice() };
  const rnd = mulberry32(hash32(seed));
  const idx = list.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const keep = new Set(idx.slice(0, n));
  return { sampled: true, seed, n, of: list.length, items: list.filter((_, i) => keep.has(i)) };
}

/**
 * neighbourhoodOf(target, history, { rowText, dist, k }) — PURE. target = { sha, at, labels, declaration };
 * history = [{ sha, at, labels, files }]. Only commits with at STRICTLY before target.at are eligible (an equal time is
 * excluded: it could be the outcome's sibling). Rows = the labels of those commits minus the target's own; each row's text
 * comes from rowText(label) (the spec AT THE PARENT); the k nearest by dist(declaration, text) win (ties by label). Files =
 * the union of files those rows' prior commits touched, nearest row first, newest commit first.
 * → { rows:[{label, d}], from:[{sha, at}], files:[path] } — files empty ⇒ no prior neighbourhood.
 */
export function neighbourhoodOf(target, history, { rowText, dist, k = NEIGHBOUR_K } = {}) {
  const t = ms(target.at);
  const prior = history.filter((h) => h.sha !== target.sha && Number.isFinite(ms(h.at)) && ms(h.at) < t);
  const own = new Set(target.labels || []);
  const byRow = new Map();
  for (const h of prior) for (const l of h.labels || []) { if (own.has(l)) continue; (byRow.get(l) || byRow.set(l, []).get(l)).push(h); }
  const scored = [];
  for (const l of byRow.keys()) { const tx = rowText(l); if (tx) scored.push({ label: l, d: dist(target.declaration, tx) }); }
  scored.sort((a, b) => a.d - b.d || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const rows = scored.slice(0, k);
  const files = [], from = [], seenSha = new Set();
  for (const r of rows) {
    for (const h of byRow.get(r.label).slice().sort((a, b) => ms(b.at) - ms(a.at))) {
      if (!seenSha.has(h.sha)) { seenSha.add(h.sha); from.push({ sha: h.sha, at: h.at }); }
      for (const f of h.files || []) if (!files.includes(f)) files.push(f);
    }
  }
  return { rows: rows.map((r) => ({ label: r.label, d: +r.d.toFixed(4) })), from, files };
}

const fmt = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
/**
 * scoreWide({ named, neighbourhood, touched }, { K, seed, sample, reported }) — PURE. Each arm's pairs go through
 * scoreForecasts() on their own (never merged). A neighbourhood pair without a `from` list, or with any `from` at or after
 * its commit_at, is MOVED to reported — it is never scored. Line 1 is the PRIMARY arm only; a LEAKY arm never reaches it.
 */
export function scoreWide(byArm, { K = K_DEFAULT, seed = 'C610j', sample = null, reported = {} } = {}) {
  const rep = Object.fromEntries(REALITY_ARMS.map((a) => [a, [...(reported[a] || [])]]));
  const clean = { ...byArm };
  clean.neighbourhood = (byArm.neighbourhood || []).filter((p) => {
    const ok = Array.isArray(p.from) && p.from.length && p.commit_at && p.from.every((f) => ms(f.at) < ms(p.commit_at));
    if (!ok) rep.neighbourhood.push({ label: p.label, sha: p.sha ?? null, why: 'no prior neighbourhood strictly before the commit' });
    return ok;
  });
  const scores = Object.fromEntries(REALITY_ARMS.map((a) => [a, scoreForecasts(clean[a] || [], { K, seed: `${seed}:${a}` })]));
  const subset = Object.fromEntries(REALITY_ARMS.map((a) => {
    const d = scores[a].per.filter((r) => (clean[a] || []).find((p) => p.label === r.label && p.sha === r.sha)?.dispatched);
    return [a, { n: d.length, ensemble: d.length ? d.filter((r) => r.ensemble).length / d.length : null }];
  }));
  const P = scores[PRIMARY_ARM];
  const corpus = sample?.sampled ? `seeded sample ${sample.n} of ${sample.of} attested commits (seed ${sample.seed})` : `${sample?.of ?? 'all'} attested commits`;
  const line = P.line.replace(/^C610b: /, `C610j [ensemble × ${PRIMARY_ARM.toUpperCase()}; ${corpus}]: `) +
    (rep[PRIMARY_ARM].length ? ` · ${rep[PRIMARY_ARM].length} reported, not scored (no prior neighbourhood / no reality)` : '');
  const armText = (a) => {
    const s = scores[a], [h1, h2] = s.halves, extra = s.arms.filter((x) => !['ensemble', 'single', 'shuffled'].includes(x));
    return `${a.toUpperCase()}${LEAKY_ARMS.includes(a) ? ' (LEAKY — the outcome chose these files; an upper bound, never line 1)' : ''}: ` +
      `ensemble ${fmt(s.rates.ensemble)} vs null ${fmt(s.rates.shuffled)} · single ${fmt(s.rates.single)}` +
      extra.map((x) => ` · ${x} ${fmt(s.rates[x])}`).join('') +
      ` · z ${fmt(h1.z, 2)}|${fmt(h2.z, 2)} · n ${h1.n}|${h2.n} · ${s.verdict} · reported ${rep[a].length} · dispatched subset n ${subset[a].n} rate ${fmt(subset[a].ensemble)}`;
  };
  const line2 = `C610j every arm (reality_0 definitions side by side, never merged): ${REALITY_ARMS.map(armText).join(' ‖ ')}`;
  return { line, line2, verdict: P.verdict, primary: PRIMARY_ARM, scores, reported: rep, subset, sample };
}

// ── the wide live run ──────────────────────────────────────────────────────────────────────────────────────────────────
function lsTree(repo, rev, paths) {
  const out = new Map(); if (!paths.length) return out;
  try {
    for (const l of gitOut(repo, ['ls-tree', '-l', rev, '--', ...paths]).split('\n')) {
      const m = l.match(/^\d+ blob [0-9a-f]+\s+(\d+)\t(.+)$/); if (m) out.set(m[2], Number(m[1]));
    }
  } catch { /* the parent is absent (root commit) */ }
  return out;
}
/** keepAt(repo, rev, paths) — the paths that exist as blobs ≤ MAX_FILE_BYTES at rev, capped at MAX_REALITY_FILES, order kept. */
function keepAt(repo, rev, paths) {
  const sz = lsTree(repo, rev, paths.filter((p) => p !== SPEC_REL && !BINARY_EXT.test(p)));
  return paths.filter((p) => sz.has(p) && sz.get(p) <= MAX_FILE_BYTES).slice(0, MAX_REALITY_FILES);
}
/** rowIndex(specMd) → Map(label → the row's line) in one pass. */
export function rowIndex(specMd) {
  const m = new Map();
  for (const l of String(specMd || '').split('\n')) { const x = l.match(/^\s*- \[[ xX]\] ([A-Z][A-Za-z0-9.]*)(?![A-Za-z0-9])/); if (x && !m.has(x[1])) m.set(x[1], l); }
  return m;
}
function loadHistory(repo, shas) {
  const meta = new Map();
  for (let i = 0; i < shas.length; i += 200) {
    let out = ''; try { out = gitOut(repo, ['show', '--name-only', '--format=%x01%H %cI', '--no-renames', ...shas.slice(i, i + 200)]); } catch { /* */ }
    for (const blk of out.split('\x01').filter(Boolean)) {
      const [head, ...rest] = blk.split('\n'); const [sha, at] = head.trim().split(' ');
      meta.set(sha, { at, files: rest.map((s) => s.trim()).filter(Boolean) });
    }
  }
  // a merge or an empty listing: fill files from diff-tree against the first parent
  for (const sha of shas) { const e = meta.get(sha); if (e && !e.files.length) { try { e.files = gitOut(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha]).split('\n').filter(Boolean); } catch { /* */ } } }
  return meta;
}

/** planWide(repo) — the corpus, the history and, per (sha, arm), the reality paths or the reason it is reported. Cheap: git only. */
export async function planWide({ repo = REPO, sampleN = null } = {}) {
  const { ncd: textNcd } = await import('./spec-tree.mjs');
  const rows = readFileSync(join(repo, ATTEST_REL), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const merged = mergeAttestations(rows);
  const meta = loadHistory(repo, merged.map((r) => r.sha));
  const history = merged.filter((r) => meta.has(r.sha)).map((r) => ({ ...r, ...meta.get(r.sha) }));
  const missing = merged.filter((r) => !meta.has(r.sha)).map((r) => ({ sha: r.sha, why: 'the sha is not in this repository' }));
  history.sort((a, b) => ms(a.at) - ms(b.at) || (a.sha < b.sha ? -1 : 1));
  let dispatched = new Set();
  try { const { collectLive } = await import('./brief-predicts-commit.mjs'); dispatched = new Set(collectLive(repo).pairs.map((p) => p.sha)); } catch { /* no runner ledger */ }
  const S = sampleCommits(history, sampleN ?? Infinity, SAMPLE_SEED);
  const plan = [];
  const specCache = new Map();
  for (const h of S.items) {
    const parent = `${h.sha}^`;
    let specMd = specCache.get(parent);
    if (specMd === undefined) { try { specMd = gitOut(repo, ['show', `${parent}:${SPEC_REL}`]); } catch { specMd = null; } specCache.clear(); specCache.set(parent, specMd); }
    const idx = rowIndex(specMd);
    const rowLines = h.labels.map((l) => idx.get(l)).filter(Boolean);
    const base = { sha: h.sha, at: h.at, labels: h.labels, label: h.labels.join('+'), session: commitDay(h.at), dispatched: dispatched.has(h.sha) };
    if (!rowLines.length) { plan.push({ ...base, refused: 'no attested row is in the spec at the parent' }); continue; }
    const declaration = rowLines.join('\n');
    const named = keepAt(repo, parent, [...new Set(h.labels.flatMap((l) => rowAt(specMd, l).paths))]);
    const nb = neighbourhoodOf({ ...base, declaration }, history, { rowText: (l) => idx.get(l) || null, dist: textNcd, k: NEIGHBOUR_K });
    const neighbourhood = nb.files.length ? keepAt(repo, parent, nb.files) : [];
    const touched = keepAt(repo, parent, h.files || []);
    plan.push({ ...base, declarationBytes: Buffer.byteLength(declaration), declaration,
      arms: {
        named: named.length ? { paths: named } : { refused: 'the rows name no file present at the parent' },
        neighbourhood: !nb.from.length ? { refused: 'no prior neighbourhood (no attested commit strictly before this one shares a row)' }
          : neighbourhood.length ? { paths: neighbourhood, rows: nb.rows, from: nb.from } : { refused: 'the prior neighbourhood names no file present at the parent', rows: nb.rows, from: nb.from },
        touched: touched.length ? { paths: touched } : { refused: 'the commit touches no file present at the parent' },
      } });
  }
  return { plan, missing, attested_rows: rows.length, history_n: history.length, sample: S.sampled ? { sampled: true, n: S.n, of: S.of, seed: S.seed } : { sampled: false, of: history.length } };
}

const cacheFile = (av, arm, sha) => join(WIDE_CACHE, String(av), arm, `${sha}.json`);
async function wideDoor(intentDocs, realityDocs, label) {
  const { matchAperture } = await import('./aperture.mjs');
  const { panel } = await import('../pmu/panel-door.mjs');
  const ap = matchAperture(intentDocs, realityDocs);
  if (ap.admissible === false) return { ok: false, reason: `aperture: ${ap.reason || 'inadmissible'}` };
  const d = await panel({ intent: ap.intent, reality: ap.reality, label });
  const x = d?.stages?.xor;
  return d.unmeasured || !x?.intent_bitmap_b64 || !x?.reality_bitmap_b64 ? { ok: false, reason: `door: ${d.unmeasured || 'no sense grids returned'}` } : { ok: true, i: x.intent_bitmap_b64, r: x.reality_bitmap_b64 };
}
/** walkReading(repo, item, arm, av) — the door twice (parent, commit) for one (sha, arm), cached by (sha, arm, apertureVersion). */
export async function walkReading(repo, item, arm, av) {
  const f = cacheFile(av, arm, item.sha);
  if (existsSync(f)) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* re-walk */ } }
  const { intentPriority } = await import('./aperture-receipt.mjs');
  let specMd = null; try { specMd = gitOut(repo, ['show', `${item.sha}^:${SPEC_REL}`]); } catch { /* */ }
  const basins = intentPriority({ ids: item.labels, specMd }).flatMap((x) => (x.snowball_path || []).map((n) => n.headline)).filter(Boolean);
  const paths = item.arms[arm].paths;
  const r0 = reality0(repo, item.sha, paths), r1 = realityAt(repo, item.sha, paths);
  let reading;
  if (!r0.length || !r1.length) reading = { ok: false, reason: `no reality file at ${r0.length ? 'the commit' : 'the parent'}` };
  else {
    const intentDocs = [{ path: `${SPEC_REL}@${item.sha.slice(0, 10)}^ (rows ${item.label} + S_in basins)`, text: [item.declaration, ...basins].join('\n') }];
    const before = await wideDoor(intentDocs, r0, `C610j ${arm} before ${item.sha.slice(0, 10)}^`);
    const after = before.ok ? await wideDoor(intentDocs, r1, `C610j ${arm} after ${item.sha.slice(0, 10)}`) : before;
    reading = before.ok && after.ok ? { ok: true, i0: before.i, r0: before.r, r1: after.r } : { ok: false, reason: (before.ok ? after : before).reason };
  }
  mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(reading));
  return reading;
}
/** forecastPair(reading, dw, chained) — the C610b walks over one reading (ENSEMBLE K=3, SINGLE K=1, anchors; Δ = after − before). */
export async function forecastPair(reading, dw, chained) {
  const ig = unpack(reading.i0), g0 = unpack(reading.r0), g1 = unpack(reading.r1);
  const ens = await dw.ensembleWalk(ig, dw.ingressFor('top-k', { grid: ig, k: 3 }), { rule: 'top-k' });
  const one = await dw.ensembleWalk(ig, dw.ingressFor('top-k', { grid: ig, k: 1 }), { rule: 'top-k' });
  const anc = await dw.ensembleWalk(ig, dw.ingressFor('intent-anchors', { grid: ig }), { rule: 'intent-anchors' });
  const w0 = await dw.ensembleWalk(g0, dw.ingressFor('top-k', { grid: g0, k: 1 }), { rule: 'top-k' });
  const w1 = await dw.ensembleWalk(g1, dw.ingressFor('top-k', { grid: g1, k: 1 }), { rule: 'top-k' });
  const delta = w1.meanHeat.map((v, c) => Math.max(0, v - w0.meanHeat[c]));
  const A = topCells(delta);
  if (!ens.k) return { refused: 'the intent grid has no lit anchor row (no ingress)' };
  if (!A.length) return { refused: 'no Δ heat: the commit walk lit nothing the parent walk had not' };
  const forecasts = { ensemble: { top: topCells(ens.meanHeat), bytes: heatBytes(ens.meanHeat) }, single: { top: topCells(one.meanHeat), bytes: heatBytes(one.meanHeat) }, ensemble_anchors: { top: topCells(anc.meanHeat) } };
  if (chained && one.ingress.length) { const ch = await chained(ig, one.ingress[0], { walk: dw.definerWalk144 }); forecasts.chained = { top: topCells(ch.heat) }; }
  return { forecasts, outcome: { top: A, bytes: heatBytes(delta) }, spread_mean: +(ens.spread.reduce((t, v) => t + v, 0) / 144).toFixed(5) };
}

/** walkShard — the child-process body: walk every (sha, arm) of the given plan items, cached; progress every 100. */
async function walkShard({ repo = REPO, itemsFile, shard, of }) {
  const { apertureVersion } = await import('../pmu/prompt-lens.mjs');
  const av = apertureVersion();
  const items = JSON.parse(readFileSync(itemsFile, 'utf8')).filter((_, i) => i % of === shard);
  let done = 0; const total = items.reduce((s, it) => s + REALITY_ARMS.filter((a) => it.arms?.[a]?.paths).length, 0);
  for (const it of items) for (const a of REALITY_ARMS) {
    if (!it.arms?.[a]?.paths) continue;
    await walkReading(repo, it, a, av);
    if (++done % 100 === 0 || done === total) console.log(`[shard ${shard}/${of}] ${done}/${total} walks · ${new Date().toISOString()}`);
  }
}

export async function runWide({ repo = REPO, K = K_DEFAULT, out = OUT_WIDE, sampleN = null, shards = 4 } = {}) {
  const dw = await import('../pmu/definer-walk-144.mjs');
  const { apertureVersion } = await import('../pmu/prompt-lens.mjs');
  const av = apertureVersion();
  let chained = null;
  try { gitOut(repo, ['ls-files', '--error-unmatch', 'scripts/vna/chained-ingress.mjs']); chained = (await import('./chained-ingress.mjs')).chainedWalk || null; } catch { /* C610h not landed */ }
  const t0 = Date.now();
  const { plan, missing, attested_rows, history_n, sample: S } = await planWide({ repo, sampleN });
  console.log(`[C610j] planned ${plan.length} commits (${S.sampled ? `seeded sample ${S.n} of ${S.of}, seed ${S.seed}` : 'all'}) in ${Math.round((Date.now() - t0) / 1000)} s · walking with ${shards} shards`);
  // walk: bounded child processes, each on its slice; the cache is the hand-off
  const itemsFile = join(WIDE_CACHE, String(av), `plan-${process.pid}.json`);
  mkdirSync(dirname(itemsFile), { recursive: true });
  writeFileSync(itemsFile, JSON.stringify(plan.filter((p) => !p.refused)));
  const { spawn } = await import('node:child_process');
  const self = fileURLToPath(import.meta.url);
  await Promise.all(Array.from({ length: shards }, (_, s) => new Promise((ok) => {
    const c = spawn(process.execPath, [self, '--wide-shard', `${s}/${shards}`, '--items', itemsFile], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'] });
    c.on('exit', ok);
  })));
  // score: every arm on its own pair set
  const byArm = Object.fromEntries(REALITY_ARMS.map((a) => [a, []])), reported = Object.fromEntries(REALITY_ARMS.map((a) => [a, []]));
  for (const it of plan) {
    for (const a of REALITY_ARMS) {
      if (it.refused) { reported[a].push({ label: it.label, sha: it.sha, why: it.refused }); continue; }
      const arm = it.arms[a];
      if (!arm.paths) { reported[a].push({ label: it.label, sha: it.sha, why: arm.refused }); continue; }
      const reading = await walkReading(repo, it, a, av);
      if (!reading.ok) { reported[a].push({ label: it.label, sha: it.sha, why: reading.reason }); continue; }
      const fp = await forecastPair(reading, dw, chained);
      if (fp.refused) { reported[a].push({ label: it.label, sha: it.sha, why: fp.refused }); continue; }
      byArm[a].push({ label: it.label, sha: it.sha, session: it.session, briefBytes: it.declarationBytes, commit_at: it.at, dispatched: it.dispatched,
        ...(a === 'neighbourhood' ? { from: arm.from, neighbour_rows: arm.rows } : {}), ...fp });
    }
  }
  const s = scoreWide(byArm, { K, sample: S, reported });
  const doc = {
    at: new Date().toISOString(), row: 'C610j', llm: false, aperture_version: av, line: s.line, line2: s.line2, verdict: s.verdict, primary: PRIMARY_ARM,
    leaky: LEAKY_ARMS, neighbour_k: NEIGHBOUR_K, max_reality_files: MAX_REALITY_FILES, sample: S,
    sufficient_for: WIDE_SUFFICIENT_FOR, not_sufficient_for: WIDE_NOT_SUFFICIENT_FOR, port_row: PORT_ROW,
    counts: { attested_rows, commits: history_n, missing: missing.length, planned: plan.length, refused_plan: plan.filter((p) => p.refused).length,
      ...Object.fromEntries(REALITY_ARMS.map((a) => [a, { scored: s.scores[a].per.length, reported: s.reported[a].length, no_null: s.scores[a].no_null.length, dispatched_subset: s.subset[a] }])) },
    arms: Object.fromEntries(REALITY_ARMS.map((a) => [a, { rates: s.scores[a].rates, halves: s.scores[a].halves, verdict: s.scores[a].verdict, why: s.scores[a].why }])),
    reported: s.reported, missing,
  };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); }
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--wide-shard')) {
  const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
  const [shard, of] = arg('--wide-shard').split('/').map(Number);
  await walkShard({ itemsFile: arg('--items'), shard, of });
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--wide')) {
  const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const doc = await runWide({ K: arg('--k') ? Number(arg('--k')) : K_DEFAULT, sampleN: arg('--sample') ? Number(arg('--sample')) : null, shards: arg('--shards') ? Number(arg('--shards')) : 4 });
  console.log(doc.line);
  console.log(doc.line2);
  console.log(`commits ${doc.counts.commits} · planned ${doc.counts.planned} · aperture ${doc.aperture_version} · → data/vna/forecast-hit-rate-wide.json`);
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const doc = await runLive({ limit: arg('--limit') ? Number(arg('--limit')) : Infinity, K: arg('--k') ? Number(arg('--k')) : K_DEFAULT });
  console.log(doc.line);
  console.log(doc.line2);
  const c = doc.counts;
  console.log(`collected ${c.collected} · unpaired ${c.unpaired} · fenced ${c.fenced} · refused ${c.refused} · scored ${c.scored} · aperture ${doc.aperture_version} · → data/vna/forecast-hit-rate.json`);
}
