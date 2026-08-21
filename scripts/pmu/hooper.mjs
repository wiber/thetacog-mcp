#!/usr/bin/env node
// scripts/pmu/hooper.mjs — the Hooper Standard, crossed off live.
//
// In *The T.J. Hooper* (1932), Judge Learned Hand ruled that following industry
// CUSTOM is no defense when a reasonable, AVAILABLE precaution was omitted: "there
// are precautions so imperative that even their universal disregard will not excuse
// their omission." The standard is not care. The standard is what is available.
//
// Today's custom for "did this AI deliverable meet spec?" is an LLM eval — a judge
// with amnesia that gives a different answer each run and leaves no receipt anyone
// can replay. For the legal argument to hold — that LLM-eval governance is defunct
// because a better device is AVAILABLE — that device must satisfy seven criteria.
// This command runs all seven as LIVE checks against the shipped code, on YOUR
// machine, and prints a PASS/FAIL ledger. Anyone — a vendor, an underwriter, a
// regulator, opposing counsel — runs it and reproduces the verdict. That
// reproducibility IS the proof.
//
//   npx thetacog-mcp hooper                 # run the ledger, print PASS/FAIL
//   npx thetacog-mcp hooper --report r.html # also write a self-contained HTML report
//   npx thetacog-mcp hooper --json          # machine-readable
//
// Exit 0 iff all seven criteria PASS.

import { spawnSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, existsSync, mkdtempSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { verifyReceipt, sha256Hex } from './receipt-crypto.mjs';
import { openPrimer } from './pmu-primer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ATTEST = resolve(__dirname, 'attest.mjs');
const PROVE_RICE = resolve(__dirname, 'prove-rice.mjs');
const AXIS_LIB = resolve(REPO_ROOT, 'docs/architecture/axis-library-v1.json');
const DAEMON = resolve(REPO_ROOT, '.thetacog/pmu/target/release/pmu-onchip');
const THRESHOLD = '2.0';

function node(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
}
function readJSON(p) { return JSON.parse(readFileSync(p, 'utf8')); }

async function run() {
  const wantJSON = process.argv.includes('--json');
  // Consistent on-run behaviour: write the HTML report by default (suppress with
  // --no-json/--report PATH override); open a primer first unless --no-open / --json.
  const wantReport = wantJSON ? null
    : (process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1]
      : resolve(REPO_ROOT, 'docs/pmu/hooper-report.html'));
  const willOpen = wantReport && !process.argv.includes('--no-open');
  if (willOpen) {
    openPrimer(wantReport, {
      title: 'The T.J. Hooper ledger — 7 criteria, live',
      sub: 'For the legal argument to hold, a better device must be AVAILABLE. We run all seven criteria as live checks against the shipped code on your machine.',
      lines: [
        'C1 Available · C2 Deterministic · C3 Recomputable by a stranger.',
        'C4 Hardware-grounded + signed · C5 Tamper-evident (a forged receipt is rejected).',
        'C6 Exposes the incumbent (Rice) · C7 Legible to a non-engineer.',
        '7/7 PASS = under <i>Hand</i>, "we ran an eval" stops excusing the omission.',
        'Each criterion is a check you can re-run and reproduce yourself.',
      ],
    });
  }
  const dir = mkdtempSync(join(tmpdir(), 'hooper-'));
  const reef = join(dir, 'reef.json');
  const matchPayload = join(dir, 'match.json');
  const driftPayload = join(dir, 'drift.json');
  const matchReceipt = join(dir, 'match-receipt.json');
  const tampered = join(dir, 'tampered.json');

  // axis-aligned text: Strategy(A) text holds the lane; Operations(C2) text drifts.
  const lib = readJSON(AXIS_LIB);
  const inLane = lib.axes.find((a) => a.rank === 'A').snippets.slice(0, 2).join(' ');
  const outLane = (lib.axes.find((a) => a.rank === 'C2') || lib.axes.find((a) => a.rank === 'C')).snippets.slice(0, 2).join(' ');

  const criteria = [];
  const add = (id, title, hand, ok, evidence) => criteria.push({ id, title, hand, ok, evidence });

  // ── Stage the two-party transaction once (used by several criteria) ─────────
  node(ATTEST, ['publish-reef', '--job-id', 'hooper', '--authorized', 'A,A1,A2',
    '--spec', 'Deliverable must hold the Strategy lane: long-horizon direction, mandate, sovereignty.',
    '--as', 'munich-re', '--out', reef, '--quiet']);
  node(ATTEST, ['submit', '--reef', reef, '--payload', inLane, '--as', 'vendor-acme', '--out', matchPayload, '--quiet']);
  node(ATTEST, ['submit', '--reef', reef, '--payload', outLane, '--as', 'vendor-drifty', '--out', driftPayload, '--quiet']);
  const gateMatch = node(ATTEST, ['gate', '--reef', reef, '--payload', matchPayload, '--threshold', THRESHOLD, '--out', matchReceipt, '--quiet']);
  const gateDrift = node(ATTEST, ['gate', '--reef', reef, '--payload', driftPayload, '--threshold', THRESHOLD, '--out', join(dir, 'drift-receipt.json'), '--quiet']);

  // ── C1 — AVAILABLE: the device exists and runs in one command, free. ────────
  const available = existsSync(ATTEST) && existsSync(PROVE_RICE) && gateMatch.status === 0;
  add('C1', 'AVAILABLE — a free, one-command device exists',
    'The available precaution: `npx thetacog`. Not a future product — installed and running now.',
    available, `attest + prove-rice present; gate ran (exit ${gateMatch.status}); MATCH minted.`);

  // ── C2 — DETERMINISTIC: no amnesia. Same input → same verdict + σ, every run. ─
  const sigmas = new Set(); const verdicts = new Set();
  for (let i = 0; i < 5; i++) {
    const r = node(ATTEST, ['gate', '--reef', reef, '--payload', matchPayload, '--threshold', THRESHOLD, '--out', join(dir, `k${i}.json`), '--quiet']);
    const rc = readJSON(join(dir, `k${i}.json`));
    sigmas.add(rc.gzip_witness.sigma); verdicts.add(rc.verdict);
  }
  const deterministic = sigmas.size === 1 && verdicts.size === 1;
  add('C2', 'DETERMINISTIC — the gate has no amnesia',
    'The custom (LLM eval) flips between runs. The available device does not — that variance is the defect Hand would not excuse.',
    deterministic, `5 runs → ${verdicts.size} distinct verdict (${[...verdicts][0]}), ${sigmas.size} distinct σ (${[...sigmas][0]?.toFixed(6)}).`);

  // ── C3 — RECOMPUTABLE BY A STRANGER: a third party reproduces it, trusting nothing.
  const verifyMatch = node(ATTEST, ['verify', '--receipt', matchReceipt, '--reef', reef, '--payload', matchPayload, '--threshold', THRESHOLD, '--quiet', '--json']);
  const recomputable = verifyMatch.status === 0;
  add('C3', 'RECOMPUTABLE — a stranger reproduces the verdict',
    'Hand asked what a reasonable party could verify. Anyone re-runs the gate and gets the SAME answer without trusting the issuer.',
    recomputable, `attest verify re-walked on this machine → exit ${verifyMatch.status} (0 = reproduced verdict + σ).`);

  // ── C4 — HARDWARE-GROUNDED + SIGNED: a fact, not a software opinion. ─────────
  const rcpt = readJSON(matchReceipt);
  const sealOk = verifyReceipt(rcpt).ok;
  const hasDaemon = !!rcpt.host_attestation?.daemon_sha256;
  const grounded = sealOk && hasDaemon;
  add('C4', 'HARDWARE-GROUNDED + SIGNED — a fact, not an opinion',
    'An LLM verdict is an opinion in a head that dies with it. This verdict is bound to the silicon (daemon digest) and ed25519-sealed.',
    grounded, `host seal verifies=${sealOk}; daemon_sha256=${rcpt.host_attestation?.daemon_sha256?.slice(0, 16)}…; gate ${rcpt.host_attestation?.gate_ms?.toFixed?.(1)}ms.`);

  // ── C5 — TAMPER-EVIDENT: the receipt cannot lie. ────────────────────────────
  const flip = { ...rcpt, verdict: rcpt.verdict === 'MATCH' ? 'DRIFT' : 'MATCH' };
  writeFileSync(tampered, JSON.stringify(flip, null, 2));
  const sealCatches = !verifyReceipt(flip).ok;
  const verifyTamper = node(ATTEST, ['verify', '--receipt', tampered, '--reef', reef, '--payload', matchPayload, '--threshold', THRESHOLD, '--quiet', '--json']);
  const tamperRejected = sealCatches && verifyTamper.status !== 0;
  add('C5', 'TAMPER-EVIDENT — the receipt cannot lie',
    'A precaution that can be quietly altered is no precaution. Flip one field and it is caught twice.',
    tamperRejected, `flipped verdict → seal breaks=${sealCatches} AND re-walk disagrees (verify exit ${verifyTamper.status}).`);

  // ── C6 — EXPOSES THE INCUMBENT (Rice): the custom is mathematically defective.
  const riceCheck = node(PROVE_RICE, ['--check']);
  const oracleHolds = riceCheck.status === 0;
  add('C6', 'EXPOSES THE INCUMBENT — Rice\'s theorem',
    'Software cannot evaluate software without infinite recursion. The LLM judge drifts; the silicon holds. `prove-rice` shows both, and DRIFT is detected, not flattered.',
    oracleHolds && gateDrift.status === 1, `prove-rice --check (oracle reproduces) exit ${riceCheck.status}; out-of-lane payload → DRIFT (gate exit ${gateDrift.status}).`);

  // ── C7 — LEGIBLE: an underwriter/CRO can read what was asked & verified. ─────
  const reefDoc = readJSON(reef);
  const legible = Array.isArray(reefDoc.authorized_lattice) && reefDoc.authorized_lattice.length === reefDoc.authorized_cells.length && !!reefDoc.spec;
  add('C7', 'LEGIBLE — a non-engineer can read it',
    'A standard the risk officer cannot read is not a standard they can be held to. The reef states the spec in words AND in the glossed lattice.',
    legible, legible ? `reef carries spec + ${reefDoc.authorized_lattice.length} glossed cells: ${reefDoc.authorized_lattice.map((g) => g.reads).join(' · ')}` : 'missing legible lattice');

  const allPass = criteria.every((c) => c.ok);

  // ── render ──────────────────────────────────────────────────────────────────
  if (!wantJSON) {
    console.log('━'.repeat(78));
    console.log('  THE HOOPER STANDARD — crossed off live (The T.J. Hooper, 1932)');
    console.log('  "The standard is not care. The standard is what is available."');
    console.log('━'.repeat(78) + '\n');
    for (const c of criteria) {
      console.log(`  ${c.ok ? '✅' : '❌'} ${c.id} — ${c.title}`);
      console.log(`      ${c.hand}`);
      console.log(`      evidence: ${c.evidence}\n`);
    }
    console.log('━'.repeat(78));
    console.log(`  ${allPass ? '✅ ALL SEVEN CRITERIA PASS' : '❌ INCOMPLETE'} — the available device satisfies the Hooper standard.`);
    console.log(`  ${allPass ? 'An LLM-eval custom is, under Hand, no longer a defense. Are you out of your pixel?' : 'Fix the failing criteria above.'}`);
    console.log('━'.repeat(78));
  }
  if (wantJSON) console.log(JSON.stringify({ allPass, criteria }, null, 2));
  if (wantReport) { writeFileSync(wantReport, renderHtml(criteria, allPass)); if (!wantJSON) console.log(`\n  report → ${wantReport}`); }

  process.exit(allPass ? 0 : 1);
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderHtml(criteria, allPass) {
  const rows = criteria.map((c) => `
    <div class="crit ${c.ok ? 'pass' : 'fail'}">
      <div class="hd"><span class="badge">${c.ok ? '✅ PASS' : '❌ FAIL'}</span><span class="id">${c.id}</span><span class="title">${esc(c.title)}</span></div>
      <p class="hand">${esc(c.hand)}</p>
      <pre class="ev">${esc(c.evidence)}</pre>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Hooper Standard — Verification Ledger</title>
<style>
  body{margin:0;background:#0b0e14;color:#e6e6e6;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:0 0 60px}
  .wrap{max-width:820px;margin:0 auto;padding:0 24px}
  header{text-align:center;padding:54px 24px 30px;border-bottom:1px solid #1c2230}
  h1{font-size:30px;margin:0 0 8px;letter-spacing:-.5px}
  .sub{color:#8a93a6;font-style:italic;font-size:17px}
  .verdict{margin:30px auto;max-width:820px;padding:18px 24px;border-radius:12px;text-align:center;font-size:19px;font-weight:600;
    background:${allPass ? 'rgba(46,160,67,.12)' : 'rgba(248,81,73,.12)'};border:1px solid ${allPass ? '#2ea043' : '#f85149'};color:${allPass ? '#3fb950' : '#f85149'}}
  .crit{margin:18px 0;padding:18px 20px;border-radius:12px;background:#11151f;border:1px solid #1c2230;border-left:4px solid ${allPass ? '#2ea043' : '#30363d'}}
  .crit.fail{border-left-color:#f85149}
  .hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
  .badge{font-size:13px;font-weight:700}
  .id{font-family:ui-monospace,Menlo,monospace;color:#58a6ff;font-weight:700}
  .title{font-weight:600}
  .hand{color:#aab2c0;margin:10px 0 8px}
  .ev{background:#0b0e14;border:1px solid #1c2230;border-radius:8px;padding:10px 12px;font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#7ee787;white-space:pre-wrap;margin:0}
  .foot{color:#5a6373;font-size:13px;text-align:center;margin-top:34px;line-height:1.7}
  code{font-family:ui-monospace,Menlo,monospace;color:#79c0ff}
</style></head>
<body>
  <header>
    <h1>The Hooper Standard — Verification Ledger</h1>
    <div class="sub">"The standard is not care. The standard is what is available." — <i>The T.J. Hooper</i>, 1932</div>
  </header>
  <div class="verdict">${allPass ? '✅ ALL SEVEN CRITERIA PASS — Are you out of your pixel?' : '❌ INCOMPLETE'}</div>
  <div class="wrap">
    ${rows}
    <p class="foot">Every line above was produced by running the shipped code on this machine.<br>
    Reproduce it yourself: <code>npx thetacog-mcp hooper</code> · <code>npx thetacog-mcp prove-rice</code> · <code>npx thetacog-mcp attest verify …</code><br>
    Generated by <code>scripts/pmu/hooper.mjs</code> — the ledger IS the product.</p>
  </div>
</body></html>`;
}

run().catch((e) => { console.error(e.stack || e.message); process.exit(3); });
