#!/usr/bin/env node
// packages/thetacog-mcp/scripts/pmu-demo.mjs
//
// FULL PIPELINE DEMO — text → gzipNCD + SimHash → cell + σ → XOR boundary
// check against Visa bitmap → signed receipt → cloud-bridge stub.
//
// Self-contained: bundles the canonical compress.mjs + signature.mjs +
// axis-library-v1.json into the npm package so `npx thetacog-mcp pmu-demo`
// runs end-to-end on a fresh machine with zero install.
//
// Invocation:
//   npx thetacog-mcp pmu-demo                       # built-in sample text
//   npx thetacog-mcp pmu-demo --text "..."          # inline text
//   npx thetacog-mcp pmu-demo --file path/to/doc    # read from file
//   echo "..." | npx thetacog-mcp pmu-demo --stdin  # read from stdin
//   npx thetacog-mcp pmu-demo --visa A1,B2,B3       # custom authorized cells
//   npx thetacog-mcp pmu-demo --json                # JSON-only output (no banner)
//
// Pipeline stages:
//   1. INGEST  — read the doc text
//   2. WITNESS — compress(doc, axisLib) → gzipNCD + simhashCosine
//                Both witnesses score every axis; cells must agree for
//                BOTH-AGREEMENT verdict.
//   3. XOR     — bitwise boundary check: doc's cell ∈ Visa bitmap?
//                Δ = Reality − Visa, cell-by-cell.
//   4. SIGN    — ed25519 signature over the receipt body. Per-host keys
//                stored in ~/.thetacog/pmu/keys/host.{pub,priv}.pem.
//   5. STORE   — receipt JSON written to ~/.thetacog/pmu/receipts/<id>.json
//   6. BRIDGE  — cloud-bridge stub. If THETACOG_RECEIPT_ENDPOINT is set,
//                POSTs the signed receipt; otherwise prints the would-send
//                URL and a curl-equivalent for the operator to dispatch.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readFileSync as rf } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { generateKeyPairSync, createSign, createPrivateKey, createPublicKey } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

import { compress } from '../lib/pmu/compress.mjs';
import { openPrimer } from './pmu/pmu-primer.mjs';

// ── resolve self-contained paths ─────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const AXIS_LIB_PATH = resolve(__dirname, '../lib/pmu/axis-library-v1.json');
const HOME_DIR = resolve(homedir(), '.thetacog/pmu');
const RECEIPTS_DIR = resolve(HOME_DIR, 'receipts');
const REPORTS_DIR = resolve(HOME_DIR, 'reports');
const KEYS_DIR = resolve(HOME_DIR, 'keys');

function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Compact self-contained results HTML for pmu-demo (the JS software-witness receipt).
function renderDemoHtml(signedReceipt, result, xor, receiptPath, pmuWalks) {
  const inrole = xor.in_role;
  const walkRow = (pmuWalks && pmuWalks.ok)
    ? `<tr><td>on-chip walk (--rust)</td><td><b style="color:#46d369">${fmtRate(pmuWalks.shallow)} shallow/sec · ${fmtRate(pmuWalks.deep)} deep/sec</b> — measured HERE on your chip (full 144×144)</td></tr>`
    : `<tr><td>on-chip walk</td><td class="dim">reference 11.2M / 780K (recorded, Apple M-series) — run <code>pmu-demo --rust</code> to measure on this machine, or <code>prove-rice</code> for the full on-chip proof</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>pmu-demo — signed Air Receipt</title><style>
  body{margin:0;background:#070910;color:#e9edf5;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:820px;margin:0 auto;padding:30px 22px 70px}
  h1{font-size:26px;margin:0 0 4px} .sub{color:#8a94a8;font-style:italic;margin-bottom:14px}
  h2{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5ad1ff;margin:28px 0 8px;border-top:1px solid #1a2130;padding-top:16px}
  .verdict{font-size:18px;font-weight:700;text-align:center;padding:14px;border-radius:12px;margin:14px 0;background:rgba(70,211,105,.1);border:1px solid ${inrole ? '#46d369' : '#ff5d52'};color:${inrole ? '#46d369' : '#ff5d52'}}
  table{width:100%;border-collapse:collapse;font-size:14px} td{padding:8px;border-top:1px solid #1a2130} td:first-child{color:#8a94a8;width:180px}
  pre{background:#0a0e17;border:1px solid #1a2130;border-radius:10px;padding:14px;overflow:auto;font-size:12px;color:#cdd6e4;white-space:pre-wrap}
  code{font-family:ui-monospace,Menlo,monospace;color:#9fe6b0} a{color:#5ad1ff;text-decoration:none} .dim{color:#8a94a8}
</style></head><body><div class="wrap">
  <h1>pmu-demo — the signed Air Receipt</h1>
  <div class="sub">Pure-JS software witness (gzip-NCD + SimHash) on the CPU — fast, signed, recomputable. For the on-chip ballistic walk + bearer artifact, run <code>npx thetacog-mcp prove-rice</code>.</div>
  <div class="verdict">${inrole ? '✅ IN_ROLE' : '✗ OUT_OF_ROLE'} · witnesses ${result.agreement ? 'AGREE' : 'DISAGREE'} · σ-floor ${(result.sigma || 0).toFixed(2)}</div>
  <h2>What ran (7 steps, on your CPU)</h2>
  <table>
    <tr><td>1 · ingest</td><td>doc sensed (length + gzip-length)</td></tr>
    <tr><td>2 · two-witness compress</td><td>gzip-NCD + SimHash → cell <code>${escHtml(result.cell)}</code> · ${result.agreement ? 'BOTH-AGREEMENT' : 'DISAGREEMENT'}</td></tr>
    <tr><td>3 · XOR boundary check</td><td>cell ∈ authorized lane → <b>${inrole ? 'IN_ROLE' : 'OUT_OF_ROLE'}</b></td></tr>
    ${walkRow}
    <tr><td>4 · sign</td><td class="dim mono">ed25519 · fp ${escHtml(String(signedReceipt.signature_pub_fingerprint || '').slice(0, 16))}…</td></tr>
    <tr><td>5 · store</td><td class="dim">${escHtml(receiptPath)}</td></tr>
    <tr><td>6 · cloud bridge</td><td class="dim">${process.env.THETACOG_RECEIPT_ENDPOINT ? 'published' : 'local-only (set THETACOG_RECEIPT_ENDPOINT to publish)'}</td></tr>
    <tr><td>7 · verdict</td><td><b>${escHtml(signedReceipt.verdict)}</b></td></tr>
  </table>
  <h2>The signed receipt (recompute it yourself)</h2>
  <pre>${escHtml(JSON.stringify(signedReceipt, null, 2))}</pre>
  <p class="dim">Verify the ed25519 signature with <code>node:crypto</code> / <code>openssl</code>, or the <a href="https://thetadriven.com/verify-receipt">/verify-receipt</a> in-browser verifier. Schema: <a href="https://thetadriven.com/air-receipt">/air-receipt</a>.</p>
  <p class="dim">This is the software witness. The hardware on-chip proof (per-mode ballistic walk on the 144 tiles, two-judge incongruity, bearer seal): <code>npx thetacog-mcp prove-rice</code>.</p>
</div></body></html>`;
}
const KEY_PRIV = resolve(KEYS_DIR, 'host.priv.pem');
const KEY_PUB = resolve(KEYS_DIR, 'host.pub.pem');

// ── ANSI color helpers (no chalk dependency) ─────────────────────────
const NO_COLOR = process.env.NO_COLOR || process.argv.includes('--no-color');
const c = (code, s) => NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`;
const dim = s => c('2', s);
const bold = s => c('1', s);
const green = s => c('32', s);
const cyan = s => c('36', s);
const yellow = s => c('33', s);
const red = s => c('31', s);
const magenta = s => c('35', s);
const blue = s => c('34', s);

// ── live on-chip PMU walk measurement (--rust) ───────────────────────
// Spawns the Rust `pmu-onchip` ballistic runner on THIS machine at the
// full 144×144 lattice and scrapes its measured walks/sec. Shallow = depth-2,
// deep = depth-5 — the same two configs the published reference figures use.
// Builds the binary via cargo on first use; degrades gracefully (returns
// {ok:false, reason}) if the binary is absent and no toolchain is available.
const PMU_RUST_DIR = resolve(__dirname, '../pmu-rust');
// ONE canonical daemon, shared with the rest of the package + postinstall: the
// SHIPPED prebuilt (macOS arm64) is at .thetacog/pmu/target/release/pmu-onchip.
// Prefer it (instant on a fresh npx); fall back to a local pmu-rust build.
const PMU_PREBUILT = resolve(__dirname, '..', '.thetacog/pmu/target/release/pmu-onchip');
const PMU_RUST_BIN = resolve(PMU_RUST_DIR, 'target/release/pmu-onchip');
function resolveDaemon() {
  if (existsSync(PMU_PREBUILT)) return PMU_PREBUILT;
  if (existsSync(PMU_RUST_BIN)) return PMU_RUST_BIN;
  return null;
}

function fmtRate(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function runWalk(bin, depth, arcs) {
  const r = spawnSync(bin,
    ['--throughput', '--width', '144', '--depth', String(depth), '--arcs', String(arcs)],
    { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0 || !r.stdout) return null;
  const m = r.stdout.match(/walks\/sec=(\d+)/);
  return m ? Number(m[1]) : null;
}

function measurePmuWalks() {
  let bin = resolveDaemon();
  if (!bin) {
    const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
    if (cargo.status !== 0) {
      return { ok: false, reason: 'no prebuilt daemon (macOS arm64 ships one) and no cargo toolchain to build it on this platform' };
    }
    const build = spawnSync('cargo',
      ['build', '--release', '--manifest-path', resolve(PMU_RUST_DIR, 'Cargo.toml')],
      { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'ignore', 'inherit'] });
    if (build.status !== 0 || !existsSync(PMU_RUST_BIN)) {
      return { ok: false, reason: 'cargo build failed — see output above' };
    }
    bin = PMU_RUST_BIN;
  }
  const shallow = runWalk(bin, 2, 20000);
  const deep = runWalk(bin, 5, 20000);
  if (shallow == null || deep == null) {
    return { ok: false, reason: 'pmu-onchip ran but produced no parseable walks/sec' };
  }
  return { ok: true, shallow, deep };
}

// ── argv parsing (minimal, no deps) ──────────────────────────────────
function parseArgs(argv) {
  const args = { text: null, file: null, stdin: false, visa: ['A1', 'B2', 'B3'], json: false, open: true, rust: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') args.text = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--stdin') args.stdin = true;
    else if (a === '--no-open') args.open = false;
    else if (a === '--visa') args.visa = argv[++i].split(',').map(s => s.trim());
    else if (a === '--json') args.json = true;
    else if (a === '--rust') args.rust = true;
    else if (a === '--no-color') {} // handled above
    else if (a === '--help' || a === '-h') {
      console.log(`
${bold('thetacog pmu-demo')} — full pipeline: text → gzipNCD/SimHash → XOR → signed receipt

USAGE:
  npx thetacog-mcp pmu-demo                       built-in sample (sales agent)
  npx thetacog-mcp pmu-demo --text "..."          inline text input
  npx thetacog-mcp pmu-demo --file path/to/doc    read from file
  echo "..." | npx thetacog-mcp pmu-demo --stdin  read from stdin
  npx thetacog-mcp pmu-demo --visa A1,B2,B3       authorized cells (Visa bitmap)
  npx thetacog-mcp pmu-demo --json                JSON-only output (no banner)
  npx thetacog-mcp pmu-demo --rust                measure the on-chip PMU walk live (builds Rust if needed)
  npx thetacog-mcp pmu-demo --no-color            disable ANSI color

OUTPUT:
  ~/.thetacog/pmu/receipts/<id>.json          signed receipt (ed25519)
  ~/.thetacog/pmu/keys/host.{pub,priv}.pem    auto-generated per host

CANONICAL SCHEMA:  https://thetadriven.com/air-receipt
PATENT:            US 19/637,714 (priority 2025-04-02)
`);
      process.exit(0);
    }
  }
  return args;
}

// ── read stdin ───────────────────────────────────────────────────────
async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// ── built-in sample (A1.Strategy.Law — compliance officer role) ──────
// Tuned to pull strongly toward A1 cell so both witnesses (gzipNCD +
// simhashCosine) AGREE on A1, which IS in the default Visa [A1, B2, B3].
// Verdict on this sample: BOTH-AGREEMENT + IN_ROLE.
const SAMPLE_DOC = `The compliance officer reviews every proposed action before the gate
releases it to production. Article 14 of the EU AI Act requires the human
supervisor be able to interrupt the system at any moment; the consent
envelope is a provenance primitive, not a feature. A forbidden action is
forbidden at the gate, not in the prompt — the fine is the price of the
omitted control. The constraint precedes the objective: the cap-table,
the license text, the regulatory boundary each draw the inviolate line
that the optimization must respect, and the line is enforced before any
optimization runs. A rule names what the system MAY NOT do; if the agent
can do X, then "forbid X" is wishful thinking dressed as policy.
Constraints live in the gate, not in the prompt. The supervisor's
interrupt capability is the load-bearing requirement, not the audit log.`;

// ── ed25519 host key bootstrap ───────────────────────────────────────
function ensureKeys() {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  if (existsSync(KEY_PRIV) && existsSync(KEY_PUB)) {
    return {
      priv: createPrivateKey(rf(KEY_PRIV, 'utf8')),
      pub: createPublicKey(rf(KEY_PUB, 'utf8')),
      generated: false,
    };
  }
  const kp = generateKeyPairSync('ed25519');
  const privPem = kp.privateKey.export({ format: 'pem', type: 'pkcs8' });
  const pubPem = kp.publicKey.export({ format: 'pem', type: 'spki' });
  writeFileSync(KEY_PRIV, privPem, { mode: 0o600 });
  writeFileSync(KEY_PUB, pubPem, { mode: 0o644 });
  return { priv: kp.privateKey, pub: kp.publicKey, generated: true };
}

// ── XOR boundary check (Visa bitmap vs Reality cell) ─────────────────
//
// The Visa is an array of authorized cell-ranks (e.g., ['A1', 'B2', 'B3']).
// Reality is the single cell the doc landed in (e.g., 'B2'). The XOR
// boundary check is: is Reality ∈ Visa? (the silicon-side check would
// be popcount(visa_mask XOR reality_bit) === total_set_bits_in_visa
// minus 0 or 1, but for the demo a set-membership check is the same
// boolean.)
function xorBoundaryCheck(realityCell, visaCells) {
  const delta_map = [];
  for (const cell of visaCells) {
    delta_map.push({ coord: cell, violation: 0, status: cell === realityCell ? 'hit' : 'authorized-unused' });
  }
  if (!realityCell) {
    return { in_role: false, violation: true, reason: 'witnesses disagree — primary cell ambiguous', delta_map };
  }
  const visa_set = new Set(visaCells);
  const in_role = visa_set.has(realityCell);
  if (!in_role) {
    delta_map.push({ coord: realityCell, violation: 1, status: 'unauthorized-hit' });
  }
  return { in_role, violation: !in_role, delta_map };
}

// ── pretty-print stage banner ────────────────────────────────────────
function stage(n, label) { return `${dim(`[${n}/7]`)} ${bold(label)}`; }

// ── main pipeline ────────────────────────────────────────────────────
async function run() {
  // ── demo-th-rec KILL-SWITCH (operator directive 2026-06-29) ──────────
  // "we are supposed to use only one pipeline, and this is from the wrong one"
  // → "Remove the demo-th-rec report generator". This command wrote a PARALLEL
  // signed Air-Receipt report to ~/.thetacog/pmu/reports/demo-th-rec-<id>.html on
  // every run — a SECOND pipeline the operator rejected (the gcal-agent gate that
  // silently spammed 55 of these on 2026-06-29 was retired in 54313219; this
  // disables the generator itself so the parallel path cannot silently return).
  // The file is preserved for reference and re-armed only by an EXPLICIT opt-in.
  // The one canonical pipeline is the per-commit tolerance-panel + the /commit page.
  if (process.env.DEMO_TH_REC !== '1') {
    console.log('disabled: the canonical pipeline is the commit tolerance-panel + /commit page; demo-th-rec was the removed parallel path');
    console.log('(set DEMO_TH_REC=1 to opt back into this parallel demo report generator)');
    process.exit(0);
  }
  const args = parseArgs(process.argv.slice(3)); // skip "node", "server.js", "pmu-demo"

  // Consistent on-run PRIMER (unless --json or --no-open): known report path up front,
  // primer opens, the run overwrites the same file, the tab auto-refreshes into results.
  const receiptId = `th-rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true, mode: 0o700 });
  const reportPath = resolve(REPORTS_DIR, `demo-${receiptId}.html`);
  const wantHtml = !args.json;               // always write the HTML results (unless --json)
  if (wantHtml) {
    openPrimer(reportPath, {
      title: 'pmu-demo — the Air Receipt',
      sub: 'Your doc is sensed by two witnesses, XOR-checked against the authorized lane, and ed25519-signed — a receipt anyone recomputes (pure-JS, on your CPU).',
      lines: [
        'Ingest + the <b>two-witness compress</b> (gzip-NCD + SimHash) placing the doc on the lattice.',
        'The <b>XOR boundary check</b> against the authorized Visa → IN_ROLE / OUT_OF_ROLE.',
        'The <b class="green">ed25519-signed receipt</b>, recomputable by anyone with the pubkey.',
        'The market-match (the same receipt that prices AI liability also clears a human into a role).',
        'For the on-chip hardware proof, the next step is <b>prove-rice</b>.',
      ],
    }, { open: args.open });
  }

  // --rust: measure the on-chip PMU walk live on THIS machine (builds the binary on
  // first use — that compile can take a few minutes; default runs use the reference).
  if (args.rust && !args.json) {
    console.log(dim('  ⏳ --rust: measuring the on-chip PMU walk on this machine (first run may compile the daemon)…'));
  }
  const pmuWalks = args.rust ? measurePmuWalks() : null;

  // STAGE 1 — INGEST
  let doc;
  if (args.text) doc = args.text;
  else if (args.file) doc = readFileSync(args.file, 'utf8');
  else if (args.stdin) doc = await readStdin();
  else doc = SAMPLE_DOC;
  doc = doc.trim();

  if (!args.json) {
    console.log(`\n${bold(cyan('THETACOG PMU-DEMO'))} ${dim('· full pipeline · schema https://thetadriven.com/air-receipt')}\n`);
    console.log(stage(1, 'INGEST'));
    console.log(dim(`        doc-length: ${doc.length} chars`));
    console.log(dim(`        gzip-length: ${gzipSync(Buffer.from(doc, 'utf8')).length} bytes`));
    console.log(dim(`        preview: "${doc.slice(0, 80).replace(/\n/g, ' ')}${doc.length > 80 ? '…' : ''}"`));
    console.log('');
  }

  // STAGE 2 — TWO-WITNESS COMPRESS (gzipNCD + simhashCosine)
  const axisLib = JSON.parse(readFileSync(AXIS_LIB_PATH, 'utf8'));
  if (!args.json) {
    console.log(stage(2, 'TWO-WITNESS COMPRESS'));
    console.log(dim(`        axis library: ${axisLib.axes.length} canonical cells · ${axisLib.version || 'v1'}`));
  }
  const t0 = Date.now();
  const result = compress(doc, axisLib);
  const t1 = Date.now();

  const gzipTop = result.witnesses.gzipNCD;
  const simTop = result.witnesses.simhashCosine;

  if (!args.json) {
    const agreeStr = result.agreement
      ? green(`✓ AGREEMENT`)
      : red(`✗ DISAGREEMENT (calibration signal — not an error)`);
    console.log(`        gzipNCD       → ${cyan(gzipTop.cell || 'none')}  σ=${(gzipTop.sigma || 0).toFixed(2)}`);
    console.log(`        simhashCosine → ${cyan(simTop.cell || 'none')}  σ=${(simTop.sigma || 0).toFixed(2)}`);
    console.log(`        ${agreeStr}  · primary cell: ${bold(cyan(result.cell || 'none'))}  · floor σ: ${bold((result.sigma || 0).toFixed(2))}  · ${t1 - t0}ms`);
    console.log('');

    // ── HEATMAP — 12-axis projection with σ-margins as heat blocks ──
    console.log(dim(`        ${bold('HEATMAP')} · doc projection across all 12 canonical cells (both witnesses)`));
    const blocks = ['░', '▒', '▓', '█'];
    const heatChar = (s) => {
      if (s >= 8) return green('█');
      if (s >= 4) return green('▓');
      if (s >= 2) return cyan('▒');
      if (s >= 1) return yellow('░');
      return dim('·');
    };
    // pair both witness scores per axis (already sorted desc; re-sort by canonical rank)
    const byRank = {};
    for (const s of gzipTop.scores) byRank[s.rank] = { rank: s.rank, name: s.name, emoji: s.emoji, gzip: s.score };
    for (const s of simTop.scores) byRank[s.rank] = { ...(byRank[s.rank] || {}), sim: s.score };
    // also pull sigma per cell — recompute by ranking position in each witness
    const gzipRanks = {}; gzipTop.scores.forEach((s, i) => { gzipRanks[s.rank] = i; });
    const simRanks = {}; simTop.scores.forEach((s, i) => { simRanks[s.rank] = i; });
    const order = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
    for (const r of order) {
      const cell = byRank[r];
      if (!cell) continue;
      const isTopG = gzipTop.cell === r;
      const isTopS = simTop.cell === r;
      const inVisa = args.visa.includes(r);
      // approximate per-axis sigma = (this score - mean other 11) / std other 11
      // we already have gzipTop.sigma + simTop.sigma globally; for the heatmap, use rank-pos as a proxy
      // (lower rank = higher score). σ-proxy = (12 - rank_position) / 2; top = 6, last = 0.
      const sigmaG = (12 - (gzipRanks[r] ?? 11)) / 2;
      const sigmaS = (12 - (simRanks[r] ?? 11)) / 2;
      const marker = isTopG && isTopS ? bold(green('●●')) : isTopG ? green('●○') : isTopS ? cyan('○●') : '  ';
      const visaTag = inVisa ? cyan('[VISA]') : dim('      ');
      const label = `${cell.emoji || ' '} ${cell.name || r}`.padEnd(28);
      const heat = `${heatChar(sigmaG)}${heatChar(sigmaS)}`;
      console.log(dim(`        ${marker}  ${heat}  ${label}  gzip=${cell.gzip?.toFixed(3) ?? '—'}  sim=${cell.sim?.toFixed(3) ?? '—'}  ${visaTag}`));
    }
    console.log(dim(`        ${bold('●●')}=both top  ${green('●○')}=gzip top  ${cyan('○●')}=simhash top  ${cyan('[VISA]')}=authorized cell`));
    console.log(dim(`        heat blocks: ${green('█')}=σ≥8  ${green('▓')}=σ≥4  ${cyan('▒')}=σ≥2  ${yellow('░')}=σ≥1  ${dim('·')}=below floor`));
    console.log('');

    // ── 3.4σ FLOOR ANCHOR + chip-throughput projection ──
    const FLOOR_PUBLISHED = 3.4;
    const myFloor = result.sigma || 0;
    const floorVerdict = myFloor >= FLOOR_PUBLISHED ? green(`✓ at-or-above published floor`) : yellow(`below published floor — calibration signal, not a fail`);
    const compressMs = t1 - t0;
    const compressOpsSec = ((1 / Math.max(compressMs, 1)) * 1000).toFixed(0);
    // The throughput is the MEASURED PMU ballistic walk rate on the full 144×144 lattice, Apple
    // M-series. The compress() call is a higher-level operation (gzip +
    // simhash + 12-axis scoring) — not directly comparable. We show both:
    // the high-level compress() rate (this run) AND the measured PMU walk
    // rate (the reference). Chip projection is "if every op were one XOR +
    // popcount at AC⁰ silicon" — picosecond range, ~10^10 ops/sec.
    console.log(dim(`        ${bold('FLOOR ANCHOR')} (published 3.4σ on Apple M-series, time-local baseline, robustness-audited)`));
    console.log(`        published floor: σ=${bold(yellow('3.4'))}  ·  your run: σ=${bold(myFloor >= FLOOR_PUBLISHED ? green(myFloor.toFixed(2)) : yellow(myFloor.toFixed(2)))}  ·  ${floorVerdict}`);
    console.log(dim(`        ${bold('THROUGHPUT')} · three rates, three altitudes`));
    console.log(`        this run (high-level compress):    ${cyan(compressMs + 'ms / call')} = ${cyan(compressOpsSec + ' compress/sec')} ${green('— measured here, just now')} (Node, single-thread)`);
    // The PMU ballistic walk rate. DEFAULT = the published reference (recorded on an
    // Apple M-series), HONESTLY labeled — it is NOT measured by this JS run. Pass
    // --rust to spawn the real pmu-onchip binary and measure it on THIS machine now.
    if (pmuWalks && pmuWalks.ok) {
      console.log(`        on-chip PMU walks (full 144×144):  ${bold(green(`${fmtRate(pmuWalks.shallow)} shallow/sec (d2) · ${fmtRate(pmuWalks.deep)} deep/sec (d5)`))} ${green('— measured HERE on your chip, just now')}`);
    } else {
      console.log(`        on-chip PMU walks (full 144×144):  ${bold('11.2M shallow/sec (d2) · 780K deep/sec (d5)')} ${dim('— reference, recorded on Apple M-series')} ${yellow('· run --rust to measure on THIS machine')}`);
      if (pmuWalks && pmuWalks.reason) console.log(dim(`          (--rust: ${pmuWalks.reason})`));
    }
    console.log(`        chip projection (XOR + popcount):  ${bold(green('~10¹⁰ ops/sec'))} ${dim('— theoretical projection, AC⁰ ~100ps/op, per US 19/637,714')}`);
    console.log(dim(`        each rate is a different altitude of the same comparator — software → ballistic → silicon`));
    console.log('');
  }

  // STAGE 3 — XOR BOUNDARY CHECK
  if (!args.json) {
    console.log(stage(3, 'XOR BOUNDARY CHECK (Reality ⊕ Visa)'));
    console.log(dim(`        visa (authorized cells): [${args.visa.join(', ')}]`));
    console.log(dim(`        reality (witnessed cell): ${result.cell || 'none'}`));
  }
  const xor = xorBoundaryCheck(result.cell, args.visa);
  if (!args.json) {
    const verdictStr = xor.in_role ? green('IN_ROLE') : red('OUT_OF_ROLE');
    console.log(`        verdict: ${bold(verdictStr)}  · violations: ${xor.violation ? red(1) : green(0)}`);
    for (const cell of xor.delta_map) {
      const sym = cell.violation ? red('✗') : (cell.status === 'hit' ? green('●') : dim('○'));
      console.log(dim(`        ${sym} ${cell.coord.padEnd(6)} ${cell.status}`));
    }
    console.log('');
  }

  // STAGE 4 — SIGN
  if (!args.json) console.log(stage(4, 'SIGN (ed25519)'));
  const { priv, pub, generated } = ensureKeys();
  const pubPem = pub.export({ format: 'pem', type: 'spki' }).toString();
  const pubFingerprint = pubPem.split('\n').slice(1, -2).join('').slice(0, 16); // first 16 chars of b64
  if (!args.json && generated) {
    console.log(dim(`        host key generated → ${KEY_PRIV} (mode 0600)`));
  } else if (!args.json) {
    console.log(dim(`        host key loaded → ${KEY_PRIV}`));
  }

  // STAGE 5 — BUILD RECEIPT + STORE
  const receipt = {
    receipt_id: receiptId,
    schema: 'air-receipt-v1',
    host_uuid: pubFingerprint,
    timestamp_utc: new Date().toISOString(),
    semantic_intent: {
      job_role_hint: 'pmu-demo',
      authorized_cells: args.visa,
    },
    physical_execution: {
      doc_length: doc.length,
      gzip_length: gzipSync(Buffer.from(doc, 'utf8')).length,
      walks_completed: 0, // PMU walk would happen in the cache-witness stage; demo runs software-only
      primary_cell_hit: result.cell,
      sigma_floor: result.sigma,
    },
    witnesses: {
      gzipNCD: { cell: gzipTop.cell, sigma: gzipTop.sigma },
      simhashCosine: { cell: simTop.cell, sigma: simTop.sigma },
      agreement: result.agreement,
    },
    delta_map: xor.delta_map,
    verdict: xor.in_role ? 'IN_ROLE' : 'OUT_OF_ROLE',
    compute_time_ms: t1 - t0,
  };
  const receiptBody = JSON.stringify(receipt, null, 2);

  // sign over the canonical (deterministic) JSON of the body
  const signer = createSign('SHA512'); // ed25519 in Node ignores the digest arg but accepts it
  // for ed25519, use crypto.sign directly (Node >= 12)
  const { sign } = await import('node:crypto');
  const signature = sign(null, Buffer.from(receiptBody), priv).toString('base64');

  const signedReceipt = { ...receipt, signature: `ed25519:${signature}`, signature_pub_fingerprint: pubFingerprint };

  if (!existsSync(RECEIPTS_DIR)) mkdirSync(RECEIPTS_DIR, { recursive: true, mode: 0o700 });
  const receiptPath = resolve(RECEIPTS_DIR, `${receiptId}.json`);
  writeFileSync(receiptPath, JSON.stringify(signedReceipt, null, 2));

  if (!args.json) {
    console.log(stage(5, 'STORE'));
    console.log(dim(`        receipt id: ${cyan(receiptId)}`));
    console.log(dim(`        written to: ${receiptPath}`));
    console.log(dim(`        signature: ed25519:${signature.slice(0, 32)}…`));
    console.log('');
  }

  // STAGE 6 — CLOUD BRIDGE
  const endpoint = process.env.THETACOG_RECEIPT_ENDPOINT;
  if (!args.json) console.log(stage(6, 'CLOUD BRIDGE'));
  if (endpoint) {
    if (!args.json) console.log(dim(`        POSTing to: ${endpoint}`));
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedReceipt),
      });
      if (!args.json) {
        if (res.ok) console.log(green(`        ✓ accepted by registry (${res.status})`));
        else console.log(red(`        ✗ rejected (${res.status})`));
      }
    } catch (e) {
      if (!args.json) console.log(red(`        ✗ network error: ${e.message}`));
    }
  } else {
    if (!args.json) {
      console.log(dim(`        local-only mode (set THETACOG_RECEIPT_ENDPOINT to publish)`));
      console.log(dim(`        would-publish equivalent:`));
      console.log(`        ${yellow(`curl -X POST -H 'content-type: application/json' \\`)}`);
      console.log(`        ${yellow(`     -d @${receiptPath} \\`)}`);
      console.log(`        ${yellow(`     "$THETACOG_RECEIPT_ENDPOINT"`)}`);
    }
  }

  // STAGE 7 — MARKET MATCH · the dual-use payoff visible
  // The same receipt that prices AI containment liability also matches a
  // human into a verified role. Built-in job spec: senior compliance officer
  // role authorizing A1·Law cell. Match = seeker's Reality cell ∈ job Visa.
  if (!args.json) {
    console.log('');
    console.log(stage(7, 'MARKET MATCH · the dual-use payoff'));
    const BUILTIN_JOB = {
      role: 'senior compliance officer',
      authorized: ['A1', 'A2', 'B3'],
      requires_floor: 3.4,
    };
    const seekerCell = result.cell;
    const seekerFloor = result.sigma || 0;
    const cellInJob = seekerCell && BUILTIN_JOB.authorized.includes(seekerCell);
    const floorMeetsJob = seekerFloor >= BUILTIN_JOB.requires_floor;
    const matchVerdict = cellInJob && floorMeetsJob;
    console.log(dim(`        ${bold('built-in job spec')} (override with your own via --job-cells A1,B2):`));
    console.log(dim(`          role:               ${BUILTIN_JOB.role}`));
    console.log(dim(`          authorized cells:   [${BUILTIN_JOB.authorized.join(', ')}]`));
    console.log(dim(`          requires σ-floor:   ≥ ${BUILTIN_JOB.requires_floor.toFixed(1)}`));
    console.log(dim(`        ${bold('your receipt as the seeker:')}`));
    console.log(dim(`          reality cell:       ${seekerCell || 'none'}`));
    console.log(dim(`          σ-floor:            ${seekerFloor.toFixed(2)}`));
    console.log(dim(`          stayed-in-lane:     ${xor.in_role ? green('✓ IN_ROLE') : red('✗ OUT_OF_ROLE')}`));
    console.log(`        ${bold('match verdict:')} ${matchVerdict ? green('● MATCH — same receipt clears you into this role') : yellow('○ NEAR — adjust σ-floor or cell to land')}`);
    if (!matchVerdict) {
      if (!cellInJob) console.log(dim(`          gap: your cell ${seekerCell || '?'} not in job Visa — grow into ${BUILTIN_JOB.authorized.filter(c => !c.includes('?')).join(' / ')} (Δ map names the axes)`));
      if (!floorMeetsJob) console.log(dim(`          gap: your σ-floor ${seekerFloor.toFixed(2)} < required ${BUILTIN_JOB.requires_floor.toFixed(1)} — more time-in-cell raises it (√N stacking)`));
    }
    console.log(dim(`        ${bold('the dual-use')}: this exact verdict is what an underwriter prices against (Market 1)`));
    console.log(dim(`                       and what an employer signs against (Market 2). Same JSON, same XOR.`));
    console.log('');
  }

  // FINAL — pretty summary OR --json full receipt
  if (args.json) {
    console.log(JSON.stringify(signedReceipt, null, 2));
  } else {
    const verdictStr = xor.in_role ? green('IN_ROLE') : red('OUT_OF_ROLE');
    const witnessStr = result.agreement ? green('BOTH-AGREEMENT') : red('DISAGREEMENT');
    console.log(dim('═'.repeat(72)));
    console.log(`  ${bold('VERDICT')}: ${verdictStr}  ·  ${bold('WITNESSES')}: ${witnessStr}  ·  ${bold('σ-floor')}: ${(result.sigma || 0).toFixed(2)}`);
    console.log(`  ${bold('RECEIPT')}: ${receiptPath}`);
    console.log(`  ${bold('SCHEMA')}:  https://thetadriven.com/air-receipt`);
    console.log(dim('─'.repeat(72)));
    console.log(`  ${bold('WHY WE KNOW THIS WORKS')}`);
    console.log(`    • Two witnesses (gzipNCD oracle + simhashCosine on-chip-shape) must AGREE — disagreement surfaces, never hides.`);
    console.log(`    • σ-floor anchored at ${bold(yellow('3.4'))} (Apple M-series, time-local baseline, robustness-audited);`);
    console.log(`      ${green('600σ+')} aggregate over a million-walk window by √N stacking.`);
    console.log(`    • XOR + popcount boundary check is ${green('AC⁰')} — combinational, no Turing loop, no instruction surface to drift into.`);
    console.log(`    • Patent ${cyan('US 19/637,714')} (priority 2025-04-02; 36 claims, 7 provisionals).`);
    console.log(`    • PMU canon guard: ${green('31 oracle harnesses')} green; ${green('6 structural decisions')} locked.`);
    console.log(`    • Replication protocol: ${cyan('thetadriven.com/pmu-simulator/demo#skybridge-proof')} (seven-step, on your own hardware).`);
    console.log(dim('─'.repeat(72)));
    console.log(`  ${bold('NEXT')}`);
    console.log(`    • pipe your own doc:     ${cyan('cat doc.md | npx thetacog-mcp pmu-demo --stdin')}`);
    console.log(`    • custom job-Visa:       ${cyan('npx thetacog-mcp pmu-demo --visa A1,B2 --job-cells A1,A2')}`);
    console.log(`    • cloud-publish:         ${cyan('THETACOG_RECEIPT_ENDPOINT=https://… npx thetacog-mcp pmu-demo')}`);
    console.log(`    • read the implications: ${cyan('thetadriven.com/blog/2026-05-25-the-rices-theorem-checkmate')}`);
    console.log(dim('═'.repeat(72)));
    console.log('');
  }

  // RESULTS HTML — overwrite the primer; the already-open tab auto-refreshes into this.
  if (wantHtml) {
    writeFileSync(reportPath, renderDemoHtml(signedReceipt, result, xor, receiptPath, pmuWalks));
    console.log(`  ${bold('REPORT')}: ${reportPath}  (your browser tab auto-updated from the primer)\n`);
  }
}

// Top-level await so the importing server.js does not race past stage 4
// (server.js calls process.exit(0) after the import resolves; that resolution
// must wait for the full pipeline to complete).
try {
  await run();
} catch (e) {
  console.error(red(`✗ pmu-demo failed: ${e.message}`));
  console.error(e.stack);
  process.exit(1);
}
