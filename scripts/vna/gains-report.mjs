#!/usr/bin/env node
// scripts/vna/gains-report.mjs — C612e THE VERSIONED GAINS REPORT (operator 2026-10-03, verbatim: *"email me versioned
// reports of measured gains ... we need to know exactly what the assumptions are"*).
//
// Composes every line-1 reading the closed-loop rows wrote (C609a, C609b, C610b, C610d, C610j, C612b, C612c, C612d) into
// ONE plain-text report: per reading, its rate, and per half the null mean, the null sd, z, n and the sessions in that
// half, followed by its NAMED ASSUMPTIONS. No z is ever printed without the rate, null mean, null sd and n beside it
// (PN1: no naked z). A receipt that does not exist yet renders `not run — <command>`, never as zeros.
//
// VERSIONING: docs/specs/vna/gains/<date>-gains-v<N>.txt. N is one global counter across dates. The version bumps ONLY
// when a reading changed: the readings block is hashed (no timestamps inside it) and the hash is stamped in the file;
// the same hash as the latest version writes nothing; a different hash writes N+1. A version number is never reused.
//
// MAIL: `--mail` sends a newly written version to the operator's own address only (elias@thetadriven.com) through the
// one self-mail door, scripts/email-artifact.mjs --from-room, with the .txt as body AND attachment.
//
// Sufficient for: what each loop read, on what n, against what null, under which assumptions — recomputable from the
// receipts in data/vna/. Not for: whether any of the work was good (Rice), nor for re-scoring — it reads receipts, it
// computes no score. RUST: this file decides no placement, score, threshold or verdict and holds no mass; it reads JSON,
// shuttles a file and mails (transport, per MAXIMISE RUST it stays node). The verdicts it prints are the receipts' own.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const GAINS_DIR = process.env.VNA_GAINS_DIR || resolve(REPO, 'docs/specs/vna/gains');
export const DATA_DIR = process.env.VNA_GAINS_DATA || resolve(REPO, 'data/vna');
export const TO = Object.freeze(['elias@thetadriven.com']);   // the operator's own address; never anyone else
export const FILE_RE = /^(\d{4}-\d{2}-\d{2})-gains-v(\d+)\.txt$/;
export const SHA_LINE_RE = /^readings-sha: ([0-9a-f]{16})$/m;

const f = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
const sd = (rate, nul, z) => (Number.isFinite(rate) && Number.isFinite(nul) && Number.isFinite(z) && z !== 0 && rate !== nul ? Math.abs((rate - nul) / z) : null);
const halfName = (i) => 'ab'[i] || String(i);

// one half → the normalised row every renderer prints. nullSdSource names where the sd came from.
function half({ n, rate, nullMean, nullSd, nullSdSource = 'receipt', z, sessions, sessionUnit = 'session days' }) {
  return { n, rate, nullMean, nullSd, nullSdSource, z, sessions: sessions ?? null, sessionUnit };
}

// THE READINGS — one entry per line-1 row. `file` is the receipt; `command` is what writes it (printed when absent);
// `read(json)` returns { metric, series:[{label, rate, halves}], verdict, why, assumptions }.
export const READINGS = Object.freeze([
  {
    row: 'C609a', file: 'brief-predicts-commit.json', command: 'node scripts/vna/brief-predicts-commit.mjs',
    title: 'the brief predicts the commit, in bits',
    read(j) {
      const gains = (j.scored || []).map((r) => r.gain).filter(Number.isFinite);
      const lo = gains.length ? Math.min(...gains) : null, hi = gains.length ? Math.max(...gains) : null;
      const mg = (j.masked?.scored || []).map((r) => r.gain).filter(Number.isFinite);
      const mlo = mg.length ? Math.min(...mg) : null, mhi = mg.length ? Math.max(...mg) : null;
      const mk = (h) => half({ n: h.n, rate: h.gain_mean, nullMean: h.null_gain_mean, nullSd: h.null_gain_sd, z: h.z, sessions: h.sessions });
      const sess = (j.halves || []).map((h) => (h.sessions || []).length);
      const survives = j.survives?.median;
      const A = [
        `halves are ${sess.join(' and ')} session days, so pairs inside one day are not independent and z is inflated`,
        `same-size-band null (band ±${Math.round((j.band ?? 0) * 100)} % of brief bytes, K ${j.K} draws)`,
        `inside gzip's 32 KiB window (window ${j.window} B, diff cap ${j.diff_cap} B, brief cap ${j.brief_cap} B)`,
        `per-pair range around the median ${lo != null && lo < 0 && hi > 0 ? 'crosses zero' : 'does not cross zero'}: raw [${f(lo)}, ${f(hi)}], masked [${f(mlo)}, ${f(mhi)}]`,
        `masked gain ${f(j.masked?.gain_median)} of raw ${f(j.gain_median)} bits/byte = ${survives != null ? Math.round(survives * 100) : '—'} % survives masking row ids, paths, filenames and hex runs`,
        ...(j.why || []).map((w) => `${w} → ${j.verdict}`),
        ...((j.no_null || []).length ? [`${j.no_null.length} pair(s) with no size-band null, not scored`] : []),
      ];
      return {
        metric: 'bits per diff byte (median gain = C(diff|shuffled brief) − C(diff|brief))',
        series: [
          { label: 'raw', rate: j.gain_median, halves: (j.halves || []).map(mk) },
          ...(j.masked ? [{ label: 'masked', rate: j.masked.gain_median, halves: (j.masked.halves || []).map(mk) }] : []),
        ],
        verdict: j.verdict, why: j.why || [], assumptions: A,
      };
    },
  },
  {
    row: 'C609b', file: 'commit-predicts-ask.json', command: 'node scripts/vna/commit-predicts-ask.mjs',
    title: 'the last commit predicts the next ask, in bits',
    provenance: 'MACHINE-PROPOSED — the Fable C609 wider pass (9ded5f16b1) ranked this loop; the operator never asked for it',
    read(j) {
      const A = [
        `halves split by transcript (${(j.halves || []).map((h) => h.transcripts).join(' and ')} transcripts), so asks inside one transcript are not independent`,
        `same-size-band null: a shuffled commit from another day (band ±${Math.round((j.band ?? 0) * 100)} %, K ${j.K} draws)`,
        `inside gzip's 32 KiB window (window ${j.window} B, ask cap ${j.ask_cap} B, commit cap ${j.commit_cap} B)`,
        `time fence: ${(j.fenced || []).length} asks that quote or paste their commit are fenced out, never scored; ${j.dedup_dropped ?? 0} duplicates dropped`,
        ...(j.why || []).map((w) => `${w} → ${j.verdict}`),
        ...(!(j.why || []).length && j.verdict !== 'MEASURED' ? [`receipt verdict ${j.verdict} (see its own line for the reason)`] : []),
      ];
      return {
        metric: 'bits per ask byte (gain = C(ask|shuffled commit) − C(ask|last commit))',
        series: [{ label: 'gain', rate: j.gain_mean, halves: (j.halves || []).map((h) => half({ n: h.n, rate: h.gain_mean, nullMean: h.null_gain_mean, nullSd: h.null_gain_sd, z: h.z, sessions: Array.from({ length: h.transcripts || 0 }), sessionUnit: 'transcripts' })) }],
        verdict: j.verdict, why: j.why || [], assumptions: A,
      };
    },
  },
  {
    row: 'C610b', file: 'forecast-hit-rate.json', command: 'node scripts/vna/forecast-scored-on-past-commits.mjs',
    title: 'the forecast scored on past commits — hit rate',
    read(j) {
      const A = [
        'null = shuffled forecast (another row\'s, same size band); null sd is derived as |rate − null| / z from the receipt, which stores no sd',
        `halves split by session day; top-${j.top_n} zones, fence ${j.fence}, K ${j.K} draws`,
        `pairs drawn only from dispatched briefs: ${j.counts?.collected ?? '—'} collected, ${j.counts?.unpaired ?? '—'} unpaired, ${j.counts?.fenced ?? '—'} fenced (brief postdates commit), ${j.counts?.refused ?? '—'} refused (no named file before the work)`,
        ...(j.why || []).map((w) => `${w} → ${j.verdict}`),
      ];
      return {
        metric: 'hit rate (ensemble forecast top zones ∩ commit zones)',
        series: [{ label: 'ensemble', rate: j.rates?.ensemble, halves: (j.halves || []).map((h) => half({ n: h.n, rate: h.ensemble, nullMean: h.null, nullSd: sd(h.ensemble, h.null, h.z), nullSdSource: 'derived |rate−null|/z', z: h.z, sessions: h.sessions })) }],
        verdict: j.verdict, why: j.why || [], assumptions: A,
      };
    },
  },
  {
    row: 'C610d', file: 'snowball-pick-ab.json', command: 'node scripts/vna/snowball-pick-ab.mjs',
    title: 'the snowball pick, ensemble vs greedy (paired)',
    read(j) {
      const A = [
        'paired difference per row (ensemble − greedy code-only gain); the null is a mean difference of 0, and its sd is derived as |d| / z from the receipt',
        `both arms at one aperture: window ${j.arms?.greedy?.window} B, token cap ${j.arms?.greedy?.token_cap}, τ ${j.arms?.greedy?.tau}, max steps ${j.arms?.greedy?.max_steps}`,
        `drawn on C609a's ${j.c609a_code_only_pairs} code-only pairs; never scored against a RANDOM prior (that is C612d's question); halves by session`,
        `the picks differ on ${f(j.pick_differs_pct, 0)} % of rows; greedy ${f(j.gain?.greedy)} vs ensemble ${f(j.gain?.ensemble)} bits/byte`,
        ...(j.why || []).map((w) => `${w} → ${j.verdict}`),
      ];
      return {
        metric: 'paired Δ code-only gain, bits per diff byte (ensemble − greedy)',
        series: [{ label: 'Δ', rate: (j.gain?.ensemble ?? NaN) - (j.gain?.greedy ?? NaN), halves: (j.halves || []).map((h) => half({ n: h.n, rate: h.d_mean, nullMean: 0, nullSd: sd(h.d_mean, 0, h.z), nullSdSource: 'derived |d|/z', z: h.z, sessions: h.sessions })) }],
        verdict: j.verdict, why: j.why || [], assumptions: A,
      };
    },
  },
  {
    row: 'C610j', file: 'forecast-hit-rate-wide.json', command: 'node scripts/vna/forecast-scored-on-past-commits.mjs --wide',
    title: 'the wide corpus and the prior neighbourhood — hit rate',
    read(j) {
      const arm = j.arms?.[j.primary] || {};
      const A = [
        `line 1 is the ${String(j.primary).toUpperCase()} reality_0 definition; ${(j.leaky || []).join(', ').toUpperCase()} is leaky (the outcome chose those files) and never line 1`,
        `seeded sample ${j.sample?.n} of ${j.sample?.of} attested commits (seed ${j.sample?.seed}); halves split by commit day`,
        'null = shuffled forecast in the same size band; null sd is derived as |rate − null| / z from the receipt, which stores no sd',
        `${j.counts?.[j.primary]?.reported ?? '—'} commits reported, not scored (no prior neighbourhood / no reality)`,
        ...(arm.why || []).map((w) => `${w} → ${arm.verdict}`),
      ];
      return {
        metric: `hit rate (ensemble × ${j.primary})`,
        series: [{ label: 'ensemble', rate: arm.rates?.ensemble, halves: (arm.halves || []).map((h) => half({ n: h.n, rate: h.ensemble, nullMean: h.null, nullSd: sd(h.ensemble, h.null, h.z), nullSdSource: 'derived |rate−null|/z', z: h.z, sessions: h.sessions })) }],
        verdict: arm.verdict ?? j.verdict, why: arm.why || [], assumptions: A,
      };
    },
  },
  {
    row: 'C612b', file: 'door-slot-crate.json', command: 'node --test tests/vna/c612b-the-door-and-the-slot-in-the-crate.test.mjs, then the C612b timing run (5 live runs)',
    title: 'the door and the slot in the crate — timing',
    read: generic('timing, ms (median [min,max] over n runs)'),
  },
  {
    row: 'C612c', file: 'path-prediction.json', command: 'pmu-onchip --path-predict (shuttled by the C612c scorer) → data/vna/path-prediction.json',
    title: 'the path-prediction read — p@k vs shuffled-row null',
    read: generic('precision@k of note-named files vs files the commit touched'),
  },
  {
    row: 'C612d', file: 'repo-as-spec-gain.json', command: 'the C612d scorer → data/vna/repo-as-spec-gain.json',
    title: 'the repo-as-spec gain — retrieved prior vs random prior',
    read: generic('bits per diff byte (C(diff|random prior+row) − C(diff|retrieved prior+row))'),
  },
]);

// A reader for receipts whose shape was not on disk when this file was written: it takes `halves[]` with any of
// {n, z, rate|gain_mean|ensemble|d_mean, null|null_gain_mean|null_mean, null_sd|null_gain_sd, sessions}, and the
// receipt's own `assumptions[]` / `why[]`. A field it cannot find prints `—`, never 0.
function generic(metric) {
  return (j) => {
    const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(o[k])) return o[k]; return null; };
    const halves = (j.halves || []).map((h) => {
      const rate = pick(h, ['rate', 'gain_mean', 'p_at_k', 'ensemble', 'd_mean', 'median_ms']);
      const nul = pick(h, ['null', 'null_mean', 'null_gain_mean']);
      let nsd = pick(h, ['null_sd', 'null_gain_sd']), src = 'receipt';
      if (nsd == null) { nsd = sd(rate, nul, h.z); src = 'derived |rate−null|/z'; }
      return half({ n: h.n, rate, nullMean: nul, nullSd: nsd, nullSdSource: src, z: h.z, sessions: h.sessions });
    });
    const A = [...(j.assumptions || []), ...(j.why || []).map((w) => `${w} → ${j.verdict}`)];
    if (!A.length) A.push('the receipt names no assumptions of its own — read it before trusting this reading');
    return { metric, series: [{ label: 'line 1', rate: pick(j, ['rate', 'gain_median', 'gain_mean', 'median_ms']), halves }], verdict: j.verdict ?? 'UNSTATED', why: j.why || [], assumptions: A };
  };
}

// Compose: one entry per READINGS row; absent receipt → { notRun: '<command>' }.
export function composeReadings({ dataDir = DATA_DIR, readings = READINGS } = {}) {
  return readings.map((r) => {
    const p = resolve(dataDir, r.file);
    if (!existsSync(p)) return { row: r.row, title: r.title, provenance: r.provenance, file: r.file, notRun: r.command };
    let j;
    try { j = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return { row: r.row, title: r.title, provenance: r.provenance, file: r.file, notRun: `${r.command} (receipt unreadable: ${e.message})` }; }
    return { row: r.row, title: r.title, provenance: r.provenance, file: r.file, receiptAt: j.at || null, ...r.read(j) };
  });
}

// PN1 — a line that prints a z must carry the rate, the null mean, the null sd and n on the same line.
export function nakedZ(line) {
  if (!/\bz\s+[-−]?\d/.test(line)) return false;
  return !(/\brate\s/.test(line) && /\bnull mean\s/.test(line) && /\bsd\s/.test(line) && /\bn\s+\d/.test(line));
}

// A receipt's own reason ("z 0.49 < 2 in half a") prints a z with nothing beside it. Restate it as the bar it missed;
// the number itself is printed once, on the half line, with its rate, null mean, null sd and n.
export function deZ(w) {
  return String(w).replace(/\bz\s+[-−]?[\d.]+\s*<\s*([\d.]+)\s+in half (\w+)(\s*\([^)]*\))?/g, (_m, bar, h, paren) => `half ${h} below the bar z ≥ ${bar}${paren || ''} (its z is on the half ${h} line, beside rate, null mean, sd and n)`);
}

export function renderReading(r) {
  const L = [`${r.row} — ${r.title}`];
  if (r.provenance) L.push(`  provenance: ${r.provenance}`);
  if (r.notRun) { L.push(`  not run — ${r.notRun}`, `  assumptions: none yet — no receipt at data/vna/${r.file}; nothing is read, so nothing is assumed`); return L; }
  L.push(`  receipt: data/vna/${r.file}`, `  metric: ${r.metric}`, `  verdict: ${r.verdict}${r.why?.length ? ` — ${r.why.map(deZ).join('; ')}` : ''}`);
  for (const s of r.series) {
    L.push(`  ${s.label}: rate ${f(s.rate)} (pooled)`);
    s.halves.forEach((h, i) => {
      const sess = h.sessions == null ? 'sessions not in the receipt' : `${h.sessions.length} ${h.sessionUnit}`;
      L.push(`    half ${halfName(i)}: rate ${f(h.rate)} vs null mean ${f(h.nullMean)} (sd ${f(h.nullSd)}${h.nullSdSource === 'receipt' ? '' : `, ${h.nullSdSource}`}) · z ${f(h.z, 2)} · n ${h.n ?? '—'} · ${sess}`);
    });
    if (!s.halves.length) L.push('    no halves in the receipt — no z to read');
  }
  L.push('  assumptions:');
  for (const a of r.assumptions) L.push(`    - ${deZ(a)}`);
  return L;
}

// The hashed block: the readings only (no report timestamp, no version) — so the version bumps only on a changed reading.
export function renderReadings(readings) { return readings.flatMap((r) => [...renderReading(r), '']).join('\n'); }
export function readingsSha(block) { return createHash('sha256').update(block).digest('hex').slice(0, 16); }

export function renderReport({ readings, version, date, at = new Date().toISOString(), prev = null }) {
  const block = renderReadings(readings);
  const sha = readingsSha(block);
  const measured = readings.filter((r) => !r.notRun).length;
  const head = [
    `THE GAINS REPORT — v${version} · ${date}`,
    `readings-sha: ${sha}`,
    `composed: ${at} by scripts/vna/gains-report.mjs (C612e) — reads data/vna receipts, computes no score`,
    prev ? `previous: v${prev.version} (${prev.file}) — readings-sha ${prev.sha}; this version exists because a reading changed` : 'previous: none — first version',
    `${measured} of ${readings.length} readings have a receipt; the rest read "not run", never zero.`,
    '',
    'How to read a line: rate is the arm\'s value; null mean and sd are what chance gives on the same pairs; z is (rate − null mean) / sd;',
    'n is the pairs in that half. The bar for every row is z ≥ 2 AND n ≥ 20 in BOTH halves, else UNMEASURED. A reading is',
    'only as good as its assumptions, so each one lists them; a z with no rate, null and n beside it is never printed.',
    'Sufficient for: what each loop read, on what n, under which assumptions. Not for: whether the work was good (Rice).',
    '',
  ].join('\n');
  return { text: `${head}\n${block}`, sha, block };
}

export function listVersions(dir = GAINS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => { const m = name.match(FILE_RE); if (!m) return null; const text = readFileSync(join(dir, name), 'utf8'); return { file: name, date: m[1], version: Number(m[2]), sha: text.match(SHA_LINE_RE)?.[1] || null }; })
    .filter(Boolean).sort((a, b) => a.version - b.version);
}

// Write the next version iff the readings changed. Returns { changed, version, file, sha }.
export function writeVersion({ readings, dir = GAINS_DIR, date = new Date().toISOString().slice(0, 10), at } = {}) {
  const vs = listVersions(dir);
  const latest = vs[vs.length - 1] || null;
  const sha = readingsSha(renderReadings(readings));
  if (latest && latest.sha === sha) return { changed: false, version: latest.version, file: join(dir, latest.file), sha };
  const version = (latest ? latest.version : 0) + 1;
  if (vs.some((v) => v.version === version)) throw new Error(`version v${version} already exists — refusing to reuse a version number`);
  const { text } = renderReport({ readings, version, date, at, prev: latest });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${date}-gains-v${version}.txt`);
  writeFileSync(file, text);
  return { changed: true, version, file, sha };
}

export function mailArgs(file, { version, repo = REPO } = {}) {
  const body = readFileSync(file, 'utf8');
  return [resolve(repo, 'scripts/email-artifact.mjs'), '--text', body, '--attach', file, '--subject', `Gains report v${version} — every line-1 reading with its assumptions (C612e)`, '--from-room', ...TO.flatMap((t) => ['--to', t])];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const readings = composeReadings();
  if (argv.includes('--json')) { console.log(JSON.stringify(readings, null, 2)); process.exit(0); }
  const r = writeVersion({ readings });
  const rel = relative(REPO, r.file);
  console.log(r.changed ? `C612e: wrote v${r.version} → ${rel} (readings-sha ${r.sha})` : `C612e: no reading changed — v${r.version} stands (${rel}, readings-sha ${r.sha}); nothing written`);
  if (argv.includes('--mail') && (r.changed || argv.includes('--force-mail'))) {
    const args = mailArgs(r.file, { version: r.version });
    if (argv.includes('--dry-run')) console.log(`would mail: node ${args.filter((a, i) => args[i - 1] !== '--text').join(' ')}`);
    else execFileSync(process.execPath, args, { stdio: 'inherit', cwd: REPO });
  }
}
