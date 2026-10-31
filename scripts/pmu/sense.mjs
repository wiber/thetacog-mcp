#!/usr/bin/env node
// scripts/pmu/sense.mjs — THE SENSE-MAKING MACHINE, wired to the PMU runner.
//
// Source: theDarwinian.txt (2026-07-04 Gemini session) — eight ASSERTIONS in the order of the
// six human needs (entry · connection · contribution · growth · uncertainty · certainty ·
// significance · evidence), each backed by a LIVE number recomputed on this machine as it
// prints. Assertions that force a question, asked eight times, become a sense-making machine;
// the close is the challenge: "where would you take this?"
//
// It adds NO new substrate: every number comes from the same shipped rails attest-demo drives
// (attest.mjs publish-reef/submit/gate/verify + price-attest.mjs → the Rust runner). The fixtures
// are attest-demo's own (same spec, same borderline work, same fake, same held-out paraphrase),
// so the numbers here and there corroborate instead of forking.
//
//   npx thetacog-mcp sense              # the whole machine, ~30-90s, terminal-only
//   npx thetacog-mcp sense --runs 3     # K gate runs for the decidability assertion (default 3)
//   npx thetacog-mcp sense --json       # machine-readable trail of every live number
//
// BRIDGE DISCIPLINE (the file's rule): every assertion must read two ways in one pass —
// Accelerator to the deployer in the Darwinian fight, Instrument to the insurer with
// paralyzed capital. The velocity numbers are the deployer's face; the priced-placement
// numbers are the insurer's. One rail, two doors.

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ATTEST = resolve(__dirname, 'attest.mjs');
const PRICE = resolve(__dirname, 'price-attest.mjs');

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const K = Math.max(2, Number(argOf('--runs', '3')));
const JSON_OUT = process.argv.includes('--json');
const TH = '2.0';
const LANE = 'A,A1,A2';

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const node = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const S = (rc) => (rc?.gzip_witness?.sigma ?? 0).toFixed(2);
const inA = (rc) => /^A/.test(String(rc?.authoritative_cell || ''));
const out = (s) => { if (!JSON_OUT) console.log(s); };
const trail = { assertions: [] };
function assert(n, need, text) {
  out('\n' + '─'.repeat(78));
  out(`  ${n} · ${need.toUpperCase()}`);
  out('─'.repeat(78));
  out(`  ${text}`);
  trail.assertions.push({ n, need, text, live: [] });
}
function live(s) { out(`     ⚡ LIVE: ${s}`); trail.assertions.at(-1)?.live.push(s); }

// ── The fixtures — attest-demo's own, verbatim, so the two commands corroborate ──────────────
const J = (a) => a.filter(Boolean).join('\n\n');
const spec = J([
  'The deliverable is the strategic capital-allocation plan: which dollars build the floor — the substrate that lifts future bets — versus the ceiling that caps the next round.',
  'It must name the target coordinate the system must occupy by end of quarter, and treat anything that does not drive toward it as exhaust.',
  'It must set the long-horizon direction the lattice inherits — the multi-year posture, irreversibly chosen. Strategy and funding, not the operational loop.',
]);
const work = J([
  'Our allocation puts the majority into the compounding substrate — the floor the next underwriter inherits — and reserves the remainder against the ceiling of the following round; once the wire clears the choice is irreversible.',
  'The target coordinate the system must occupy by quarter end is the seed-to-A milestone, and every initiative that does not drive toward that coordinate is exhaust we cut rather than fund.',
  'This is the long-horizon strategic direction the lattice inherits: the multi-year posture is chosen now, irreversibly, and each quarter renegotiates inside that fixed bearing.',
  'The mandate and the capital plan together set the bearing the whole rotation is measured against.',
]);
const fakeWork = J([
  'The daily commit and the hourly hook run whether anyone watches; the per-request fingerprint is the substrate of the substrate, ambient and unwatched.',
  'Each iteration is a hypothesis tested against the ground truth of the world; loops shorter than the feedback half-life waste the half-life.',
  'Flow is the rate at which committed work crosses the finish line; inventory accumulates upstream, and flow is the only thing the customer pays for.',
]);
const paraphraseWork = J([
  "Most of the capital goes into the compounding base that future bets stand on; the rest is kept back against the next round's cap, and once funds wire the decision cannot be undone.",
  'By the close of the quarter the system has to sit on the seed-to-A coordinate; work that does not push toward it is waste we stop funding.',
  'The years-long stance is locked in now and cannot reverse; every quarter re-argues its moves inside that set heading.',
  'Together the charter and the funding plan fix the bearing the whole turn is judged against.',
]);

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sense-'));
  const reef = join(dir, 'reef.json'), payload = join(dir, 'payload.json'), receipt = join(dir, 'receipt.json'), price = join(dir, 'price.json');

  out('\n' + '━'.repeat(78));
  out('  THE SENSE-MAKING MACHINE — eight assertions, each carrying its recomputed number');
  out('  (one rail, two doors: velocity for the deployer · priced placement for the insurer)');
  out('━'.repeat(78));

  // 1 · ENTRY — Don't Trust Me (the threshold)
  assert(1, 'entry — don’t trust me',
    'This terminal does not care about your pitch, your prose, or your brand. It only cares\n  whether the numbers recompute. A spec is being sealed to lattice coordinates and a\n  borderline work product graded against it — live, on your machine, right now.');
  node(ATTEST, ['publish-reef', '--job-id', 'sense', '--authorized', LANE, '--spec', spec, '--as', 'node-a-buyer', '--out', reef, '--quiet']);
  node(ATTEST, ['submit', '--reef', reef, '--payload', work, '--as', 'node-b-vendor', '--out', payload, '--quiet']);
  const sigmas = new Set(), verdicts = new Set();
  for (let i = 0; i < K; i++) {
    node(ATTEST, ['gate', '--reef', reef, '--payload', payload, '--threshold', TH, '--out', i === 0 ? receipt : join(dir, `k${i}.json`), '--quiet']);
    const rc = readJSON(i === 0 ? receipt : join(dir, `k${i}.json`));
    sigmas.add(rc.gzip_witness.sigma); verdicts.add(rc.verdict);
  }
  const rc0 = readJSON(receipt);
  const decidable = verdicts.size === 1 && sigmas.size === 1;
  live(`${K} runs → ${decidable ? 'ONE answer, byte-identical' : 'NON-DETERMINISTIC (report this!)'} · PLACED @ σ=${S(rc0)} · sense-axis ${rc0.authoritative_cell}`);
  trail.gate = { decidable, sigma: rc0.gzip_witness.sigma, cell: rc0.authoritative_cell, K };

  // 2 · CONNECTION — contact with reality
  assert(2, 'connection',
    'You are operating in a zero-confidence market: your vetting process is not a quality\n  layer, it is the bottleneck bleeding your speed. The sealed spec + signed submission +\n  decidable placement you just watched replaced that queue for this artifact.');
  live(`elapsed so far: ${secs()}s — a vendor-vetting cycle is measured in weeks; this chain is measured in seconds.`);

  // 3 · CONTRIBUTION — the insurable, countable event
  assert(3, 'contribution',
    'You stop consuming black-box output and start producing verified logic: a countable\n  event capital can underwrite. Proof it is not a rubber stamp — a well-written FAKE\n  (competent prose, wrong lane) goes through the same gate now.');
  const gateOf = (label, text) => {
    const pp = join(dir, `${label}-p.json`), pr = join(dir, `${label}-r.json`);
    node(ATTEST, ['submit', '--reef', reef, '--payload', text, '--as', 'node-b-vendor', '--out', pp, '--quiet']);
    node(ATTEST, ['gate', '--reef', reef, '--payload', pp, '--threshold', TH, '--out', pr, '--quiet']);
    return readJSON(pr);
  };
  const fakeRc = gateOf('fake', fakeWork);
  const fakeCaught = !inA(fakeRc);
  live(`the competent-but-WRONG work → ${fakeRc.authoritative_cell} · σ ${S(fakeRc)} ${fakeCaught ? '⛔ OFF the authorized lane — CAUGHT' : '⚠ not caught this run'} (a quality judge passes this prose).`);
  trail.fake = { cell: fakeRc.authoritative_cell, sigma: fakeRc.gzip_witness?.sigma, caught: fakeCaught };

  // 4 · GROWTH — the velocity arbitrage
  assert(4, 'growth',
    'Speed-to-trust is the metric that compounds: while the unverified sit in a months-long\n  vetting queue, the verified ship. The delta is not fear — it is watching a rival move.');
  live(`three full attestation chains (real · fake · counting) in ${secs()}s wall-clock, this laptop — the "3 months vs 3 minutes" arbitrage, measured at the small end.`);

  // 5 · UNCERTAINTY — the lane breach is the adventure
  assert(5, 'uncertainty',
    'Honest limit, stated before anyone swings: this proves nothing about correctness — an\n  in-lane failure is still a failure (Rice, 1953, closed that for everyone). What changes\n  is that the breach becomes an ACTUARIAL event: priceable, not just regrettable.');
  const pr = node(PRICE, ['--receipt', receipt, '--notional', '10000000', '--out', price]);
  let priced = null;
  try { priced = readJSON(price); } catch { /* price file optional */ }
  const prLine = (pr.stdout || '').split('\n').find((l) => /tolerance|price/i.test(l)) || '';
  live(priced || prLine ? `independent underwriter node priced the placement${prLine ? ` — ${prLine.trim()}` : ''} (advisory, pre-calibration — the honest fence).` : 'underwriter pricing step unavailable on this install — placement receipts above still stand.');

  // 6 · CERTAINTY — the rail
  assert(6, 'certainty',
    'The exclusion wave is live contract language whether or not you participate. The only\n  durable posture is a trail a hostile stranger can recompute — so recompute it, now,\n  trusting nothing from the run above.');
  const v = node(ATTEST, ['verify', '--receipt', receipt, '--reef', reef, '--payload', payload, '--threshold', TH, '--quiet', '--json']);
  live(`hostile re-verify → exit ${v.status} ${v.status === 0 ? '✅ verdict + σ reproduced byte-for-byte' : '❌ NOT reproduced (report this!)'}`);
  trail.verify = v.status === 0;

  // 7 · SIGNIFICANCE — who you become
  assert(7, 'significance',
    'You become the operator whose growth path is a plotted line, not a told story: verified\n  time on target, cell by cell. Proof the line survives rewording — a paraphrase sharing\n  almost no words with the original goes through the same gate.');
  const paraRc = gateOf('para', paraphraseWork);
  live(`novel surface, same meaning → ${paraRc.authoritative_cell} · σ ${S(paraRc)} ${inA(paraRc) ? '✅ still lands in the authorized family (illustrative, n=1 — held-out at scale is PENDING)' : '⚠ shifted out — the honest miss, report it'}`);
  trail.heldOut = { cell: paraRc.authoritative_cell, sigma: paraRc.gzip_witness?.sigma, inLane: inA(paraRc) };

  // 8 · EVIDENCE — the proof of work
  assert(8, 'evidence',
    'Nothing above asks for belief. The artifacts are on your disk and the rails are public:');
  const reefDoc = readJSON(reef), payDoc = readJSON(payload);
  live(`reef commitment ${reefDoc.reef_commitment.slice(0, 20)}… · payload sha ${payDoc.payload_sha256.slice(0, 20)}… · receipts in ${dir}`);
  live('deeper: npx thetacog-mcp attest-demo (the 7-pillar walkthrough) · pmu-verify (the sealed self-audit) · thetadriven.com/pixel');

  // The close — the challenge the file specifies
  out('\n' + '━'.repeat(78));
  out('  THE QUESTION (this is the whole machine)');
  out('━'.repeat(78));
  out('  If you could collapse months of vetting into the seconds you just watched, and your');
  out('  growth were no longer a story you tell but a coordinate a stranger can verify —');
  out('');
  out('      where would you take this?');
  out('');
  out(`  total: ${secs()}s · are you out of your pixel? → thetadriven.com/pixel`);
  trail.totalSecs = Number(secs());
  if (JSON_OUT) console.log(JSON.stringify(trail, null, 2));
  // exit 0 iff the machine's load-bearing numbers held: decidable gate + hostile recompute.
  process.exit(decidable && trail.verify ? 0 : 3);
}

main().catch((e) => { console.error('sense: ' + (e?.message || e)); process.exit(2); });
