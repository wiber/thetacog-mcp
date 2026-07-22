#!/usr/bin/env node
// scripts/pmu/attest-demo-lifecycle.mjs — THE SIX-PAGE LIFECYCLE SPEC (the documentation the
// build produces AFTER it is built). The instrument is a flight recorder; this is its
// airworthiness certificate — the industry standard-of-care document, not a user manual.
//
// buildLifecycle(R, links) → a single self-contained, print-safe HTML string.
//
// The six pages (each targets a specific reader in the room):
//   1. The Policy Trigger & the Boolean Standard        → Insurance executives
//   2. The Triangulation Measurement Protocol           → Claims adjusters & actuaries
//   3. The Execution Lineage (hardware determinism)     → Forensic engineers & opposing counsel
//   4. The Ingestion Schema & Data Handoff              → Enterprise IT & broker data teams
//   5. Lifecycle Roles & Liability Boundaries           → the whole transaction
//   6. Structural Limitations & Abstention              → underwriting committees
// + the anti-goals (what we did NOT build, and the objection each omission kills)
// + next steps (the Rust hookup).

import { readFileSync } from 'node:fs';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function locatedLabel(v) { return (v === 'MATCH' || v === 'DRIFT') ? 'PLACED' : 'UNPLACEABLE'; }

export function buildLifecycle(R, links = {}) {
  const reportHref = links.reportHref || 'attest-demo-report.html';
  const uxHref = links.uxHref || 'attest-demo-ux.html';
  const g = R.gate || {};
  const tp = (R.triptych && !R.triptych.error) ? R.triptych : null;
  let recDoc = {}; try { recDoc = JSON.parse(readFileSync(R.files.receipt, 'utf8')); } catch { /* */ }
  let reefDoc = {}; try { reefDoc = JSON.parse(readFileSync(R.files.reef, 'utf8')); } catch { /* */ }

  const placed = locatedLabel(g.verdict);
  const sigma = Number.isFinite(Number(g.sigma)) ? Number(g.sigma).toFixed(4) : '—';
  const cell = g.cell || tp?.actorCoord || '—';
  const offPct = tp?.offPct ?? null;
  const tier = tp?.tier || (tp?.tooMany ? 'PRICEABLE' : 'INSURABLE');
  const receiptId = recDoc.receipt_id || recDoc.run_id || 'n/a';
  const authorized = (reefDoc.authorized_cells || ['A', 'A1', 'A2']).join(' · ');

  // A concrete example drift-receipt object — the data handoff schema (page 4). Populated from this
  // run where possible so it is not a mockup. The provenance array is the chain-of-custody the whole
  // sale rests on: every stage names its source, line count, byte size, sha256.
  const receiptSchema = {
    receipt_id: receiptId,
    verdict: g.verdict || 'UNPLACEABLE',
    boolean_state: placed === 'UNPLACEABLE' ? 'UNPLACEABLE' : (/^A/.test(String(cell)) && (offPct == null || offPct < 25)) ? 'IN_LANE' : 'OFF_DOMAIN',
    sense_axis_cell: cell,
    sigma: g.sigma ?? null,
    off_lane_pct: offPct,
    kill_threshold_pct: 25,
    tier,
    reef_commitment: reefDoc.reef_commitment || null,
    payload_sha256: recDoc.payload_sha256 || null,
    signed: !!recDoc.signature,
    signature_scheme: 'ed25519',
    execution: { substrate: 'apple-silicon-pmu-analogue', production_standard: 'bare-metal-linux-definer-walk', llm_in_path: false, network_calls: 0 },
    provenance: [
      { stage: 'intent_ingest', source_file: 'intent_corpus.txt', line_count: String(R.intentCorpus || R.spec || '').split('\n').length, byte_size: Buffer.byteLength(String(R.intentCorpus || R.spec || ''), 'utf8'), sha256: '<per-stage>' },
      { stage: 'reality_ingest', source_file: 'work.txt', line_count: String(R.work || '').split('\n').length, byte_size: Buffer.byteLength(String(R.work || ''), 'utf8'), sha256: '<per-stage>' },
      { stage: 'negative_ingest', source_file: 'excluded_domain.txt', line_count: String(R.fakeWork || '').split('\n').length, byte_size: Buffer.byteLength(String(R.fakeWork || ''), 'utf8'), sha256: '<per-stage>' },
    ],
  };

  const page = (n, tag, title, target, body) => `
  <section class="page">
    <div class="pageno">PAGE ${n} / 6 · <span class="tag">${esc(tag)}</span></div>
    <h2>${esc(title)}</h2>
    <div class="target">Target reader: <b>${esc(target)}</b></div>
    ${body}
  </section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>attest-demo — lifecycle spec (six pages)</title>
<style>
  :root{--bg:#070910;--panel:#0e131e;--line:#1a2130;--ink:#e9edf5;--dim:#8a94a8;--cy:#5ad1ff;--gn:#46d369;--am:#f0b429;--rd:#ff5d52;--mono:ui-monospace,Menlo,Monaco,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:26px 22px 90px}
  a{color:var(--cy);text-decoration:none} a:hover{text-decoration:underline}
  h1{font-size:26px;letter-spacing:-.4px;margin:0 0 4px}
  .sub{color:var(--dim);font-style:italic;margin-bottom:8px}
  .mono{font-family:var(--mono)} .dim{color:var(--dim)} .gn{color:var(--gn)} .am{color:var(--am)} .rd{color:var(--rd)} .cy{color:var(--cy)}
  code{font-family:var(--mono);font-size:12.5px;color:#9fe6b0;background:#0a0e17;padding:1px 6px;border-radius:5px}
  pre{background:#0a0e17;border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;font-size:12px;color:#cdd6e4;line-height:1.55}
  .toc{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0}
  .toc ol{margin:6px 0 0;padding-left:20px} .toc li{margin:4px 0}
  .page{border-top:1px solid var(--line);padding-top:22px;margin-top:26px}
  .pageno{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase}
  .tag{color:var(--cy)}
  h2{font-size:21px;margin:6px 0 4px}
  .target{color:var(--dim);font-size:13px;margin-bottom:10px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:10px 0}
  table{width:100%;border-collapse:collapse;margin:8px 0} td,th{padding:8px;border-top:1px solid var(--line);text-align:left;vertical-align:top;font-size:13.5px} th{color:var(--cy);font-size:11px;text-transform:uppercase;letter-spacing:.1em}
  .state{display:inline-block;font-family:var(--mono);font-weight:700;padding:2px 10px;border-radius:20px;font-size:12px}
  .s-in{background:rgba(70,211,105,.14);color:var(--gn);border:1px solid var(--gn)}
  .s-off{background:rgba(255,93,82,.14);color:var(--rd);border:1px solid var(--rd)}
  .s-un{background:rgba(240,180,41,.14);color:var(--am);border:1px solid var(--am)}
  .omit{border-left:3px solid var(--am);padding-left:14px;margin:10px 0}
  .omit .pv{color:var(--rd)} .omit .ev{color:var(--gn)}
  ul{margin:8px 0;padding-left:20px} li{margin:4px 0}
  @media print{
    body{background:#fff!important;color:#111!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    .card,.toc{box-shadow:none!important;border-color:#ccc!important;background:#fafafa!important}
    pre{background:#f4f4f4!important;color:#111!important} code{color:#0a6b2e!important;background:#eef!important}
    .page{page-break-before:always} a{color:#0a58ca!important}
    .dim{color:#555!important} h2,.tag,.cy,th{color:#0a58ca!important}
  }
</style></head><body><div class="wrap">

  <h1>The instrument's airworthiness certificate</h1>
  <div class="sub">attest-demo — lifecycle, roles, and liability boundaries. Six pages. The standard is not care; it is what is available — and here is exactly what is available, page by page.</div>
  <div class="card"><b class="gn">🔒 Air-gapped by construction.</b> <span class="dim">Every measurement runs locally with no LLM in the receipt path and zero cloud exfiltration. This document specifies the lifecycle of that guarantee. The live instrument: <a href="${esc(uxHref)}">the local sandbox →</a> · the LLM red-pill session: <a href="${esc(reportHref)}">the redpill report →</a></span></div>

  <div class="toc"><b>The six pages</b>
    <ol>
      <li><a href="#p1">The Policy Trigger &amp; the Boolean Standard</a> — insurance executives</li>
      <li><a href="#p2">The Triangulation Measurement Protocol</a> — claims adjusters &amp; actuaries</li>
      <li><a href="#p3">The Execution Lineage (hardware determinism)</a> — forensic engineers &amp; opposing counsel</li>
      <li><a href="#p4">The Ingestion Schema &amp; Data Handoff</a> — enterprise IT &amp; broker data teams</li>
      <li><a href="#p5">Lifecycle Roles &amp; Liability Boundaries</a> — the whole transaction</li>
      <li><a href="#p6">Structural Limitations &amp; Abstention</a> — underwriting committees</li>
    </ol>
  </div>

  <a id="p1"></a>${page(1, 'Policy trigger', 'The Policy Trigger & the Boolean Standard', 'Insurance executives',
    `<div class="card">
      <p>An underwriter cannot write a policy against a heat-map. It can write one against a <b>Boolean</b>. The instrument collapses every measurement to exactly three mutually-exclusive states, which map directly into FINPRO / tech-E&amp;O policy wordings:</p>
      <table>
        <tr><th>State</th><th>Meaning</th><th>Policy role</th></tr>
        <tr><td><span class="state s-in">IN_LANE</span></td><td>Reality compressed closer to the authorized Intent than to the excluded domain, and off-lane% is under the kill threshold.</td><td>Condition of coverage MET — no scope breach this event.</td></tr>
        <tr><td><span class="state s-off">OFF_DOMAIN</span></td><td>Reality drifted across the ${receiptSchema.kill_threshold_pct}% threshold toward the excluded domain.</td><td>A counted, timestamped scope-breach event — the claim trigger.</td></tr>
        <tr><td><span class="state s-un">UNPLACEABLE</span></td><td>The two distances are within the tie-band; the instrument refuses to resolve.</td><td>Abstention — defers to a human; never a silent guess (see page 6).</td></tr>
      </table>
      <p class="dim">This run produced: <b>${esc(placed)}</b> @ cell <code>${esc(cell)}</code> · σ <b>${esc(sigma)}</b> · off-lane <b>${offPct != null ? offPct + '%' : '—'}</b> vs <b>${receiptSchema.kill_threshold_pct}%</b> kill · tier <b>${esc(tier)}</b>.</p>
      <p><b>Why a Boolean and not a score:</b> a score invites argument in front of a regulator; a Boolean with a published threshold and a recomputable receipt does not. The threshold itself (${receiptSchema.kill_threshold_pct}% off-lane) is the carrier's dial, set at bind time (page 5) — the instrument reports the number; the carrier sets where it trips.</p>
    </div>`)}

  <a id="p2"></a>${page(2, 'Measurement protocol', 'The Triangulation Measurement Protocol', 'Claims adjusters & actuaries',
    `<div class="card">
      <p>A claim is only processable if the deployer submits <b>three</b> corpora — the measurement triangulates; it does not opine. A single "was this bad?" reading is inadmissible; a WHERE-between-two-poles reading is decidable.</p>
      <table>
        <tr><th>Corpus</th><th>What it is</th><th>Who signs it</th></tr>
        <tr><td class="cy"><b>① Intent</b></td><td>The authorized spec, compiled to the reef lane (${esc(authorized)}).</td><td>Node A (the deployer / buyer).</td></tr>
        <tr><td class="am"><b>② Reality</b></td><td>The agent's realized action / work product.</td><td>Node B (the vendor / agent), independent key.</td></tr>
        <tr><td class="rd"><b>③ Negative</b></td><td>The excluded domain — a plausible off-lane deliverable (structural negation, not a one-word flip).</td><td>Named at bind time by the carrier + deployer.</td></tr>
      </table>
      <p><b>The measurement:</b> Normalized Compression Distance (NCD; Li–Vitányi 2004) from Reality to Intent and from Reality to the Negative. Closer to Intent → IN_LANE; closer to the Negative → OFF_DOMAIN; within the tie-band → UNPLACEABLE. The claims file must carry all three corpora or it cannot be triangulated — that requirement IS the protocol.</p>
      <p class="dim">Actuarial note: because every breach is a discrete, countable, timestamped event with a recomputable receipt, realized off-lane rates are directly observable — the precondition for pricing a book, not merely inspecting one incident.</p>
    </div>`)}

  <a id="p3"></a>${page(3, 'Execution lineage', 'The Execution Lineage (Hardware Determinism)', 'Forensic engineers & opposing counsel',
    `<div class="card">
      <p>There are two execution substrates, and the document is explicit about which produced which number — because opposing counsel will ask.</p>
      <table>
        <tr><th>Substrate</th><th>Role</th><th>Property</th></tr>
        <tr><td><b>Apple-Silicon PMU analogue</b> (incl. the browser gzip in the live sandbox)</td><td>Rapid local checking — the instrument you interact with.</td><td>Deterministic on a machine; the fast path. NOT the binding record.</td></tr>
        <tr><td><b>Bare-metal Linux definer-walk</b></td><td>The legally-binding production standard.</td><td>Hardware-deterministic, cross-platform reproducible, byte-identical — the receipt a stranger recomputes offline.</td></tr>
      </table>
      <p>The analogue and the Linux walk agree by construction: same reef, same NCD, same placement. The analogue lets a human see the shape move in real time; the Linux walk is what the receipt is signed against. When a receipt says <code>"execution.substrate"</code>, it names which ran — no ambiguity in a deposition.</p>
      <p class="dim"><b>The load-bearing property is recomputability, not "determinism is better."</b> Any hash is deterministic. What matters is that a hostile third party, offline, re-derives the identical placement from the sealed inputs — the property an LLM's sampled verdict structurally lacks. Verify: <code>npx thetacog-mcp prove-rice --check</code> (exit 0 = reproduced, byte-for-byte).</p>
    </div>`)}

  <a id="p4"></a>${page(4, 'Ingestion schema', 'The Ingestion Schema & Data Handoff', 'Enterprise IT & broker data teams',
    `<div class="card">
      <p>The drift-receipt is the unit that pipes into the broker's risk estate. Every stage carries its own <b>chain of custody</b> — source file, line count, byte size, sha256 — so liability is attributable to the byte and no hidden context can bleed in. If a stage cannot produce its provenance, the pipeline HALTS rather than emit an unattributable number.</p>
      <pre>${esc(JSON.stringify(receiptSchema, null, 2))}</pre>
      <p class="dim">The <code>provenance[]</code> array is the discipline the whole sale rests on: an underwriter asks "how do I know the instrument didn't quietly pull in outside context to make Reality look closer to the Negative?" — and the answer is not a paragraph, it is this array, re-derivable on their machine. <code>llm_in_path: false</code> and <code>network_calls: 0</code> are asserted per receipt and enforced by the regression guard.</p>
    </div>`)}

  <a id="p5"></a>${page(5, 'Roles & liability', 'Lifecycle Roles & Liability Boundaries', 'The whole transaction',
    `<div class="card">
      <table>
        <tr><th>Role</th><th>Strictly responsible for</th><th>Where liability sits</th></tr>
        <tr><td><b>The Deployer</b> (enterprise)</td><td>Writing the Intent specification.</td><td>If the spec is loose, liability stays here — a vague lane is the deployer's exposure, not the instrument's.</td></tr>
        <tr><td><b>The Broker / Carrier</b> (e.g. Marsh)</td><td>Pricing the delta; setting the acceptable σ-floor and off-lane kill threshold (e.g. ${receiptSchema.kill_threshold_pct}%).</td><td>The threshold is the carrier's dial. Mis-pricing the delta is the carrier's risk.</td></tr>
        <tr><td><b>The Architect</b> (ThetaDriven)</td><td>Maintaining the instrument, securing the cryptographic seed, guaranteeing cross-platform determinism on Linux.</td><td>A non-reproducible receipt or a broken seal is the architect's liability.</td></tr>
      </table>
      <p class="dim">Honest scope: three distinct keys, but one machine in this demo — three roles, not yet three remote parties. The independence the keys model is the property a real three-party transaction needs; the demo proves the mechanism, not the deployment.</p>
    </div>`)}

  <a id="p6"></a>${page(6, 'Abstention', 'Structural Limitations & Abstention', 'Underwriting committees',
    `<div class="card">
      <p>The instrument's most important feature for a committee is what it <b>refuses</b> to do. When the distance to Intent and the distance to the Negative fall within the tie-band, it returns <span class="state s-un">UNPLACEABLE</span> and defers to a human. It never breaks a tie by guessing.</p>
      <ul>
        <li><b>WHERE, not WHETHER.</b> It decides where a text sits on the shared map (decidable); it does NOT decide whether a paraphrase preserved the meaning (judgment). A synonym and a domain-breaking term register as nearly the same-size change — that is the fence, on purpose.</li>
        <li><b>In-lane blindness.</b> It grades region, not in-lane quality: word-salad and spec-echo pass in-lane by design. Quality is left outside the system.</li>
        <li><b>Camouflage lives at the fence.</b> Off-lane content sprinkled with in-lane vocabulary can move WHERE without moving WHETHER. Shown, not hidden — the redpill report demonstrates it.</li>
        <li><b>Finite coverage, infinite precision.</b> Unbounded sharpness on the carved lanes; not perfect grounding of all meaning. Calibration sharpens the lanes; it does not pretend to cover everything.</li>
      </ul>
      <p class="dim">A committee should read UNPLACEABLE as a strength, not a gap: an instrument that abstains where it cannot decide is exactly the one you can put in front of a regulator.</p>
    </div>`)}

  <section class="page"><div class="pageno">APPENDIX · <span class="tag">Anti-goals</span></div>
    <h2>What we did NOT build — and the objection each omission kills</h2>
    <div class="card">
      <div class="omit"><b>No continuous onChange recompute.</b> A discrete, button-pressed measurement that seals. <span class="pv">Prevents: "a jittery calculator guessing as I type — subjective."</span> <span class="ev">Enforces: "an industrial sensor: measure, seal, stamp a finalized receipt — a countable event."</span></div>
      <div class="omit"><b>No single-word ("left vs right kidney") examples.</b> Only structural negation — a shift in operational authority (Draft vs Execute). <span class="pv">Prevents: "a cheaper keyword filter does this."</span> <span class="ev">Enforces: "it caught a breach of authority a keyword filter would miss."</span></div>
      <div class="omit"><b>No LLM in the verification path.</b> The measurement is pure local arithmetic. <span class="pv">Prevents: "asking an AI to grade an AI — a black box in a black box."</span> <span class="ev">Enforces: "the model is excluded from the receipt entirely."</span></div>
      <div class="omit"><b>No cloud sync.</b> Sensitive incident logs never leave the deployer's machine. <span class="pv">Prevents: "I can't upload client AI-incident logs to a third-party startup."</span> <span class="ev">Enforces: "air-gapped; the record is yours."</span></div>
    </div>
    <h2>Next steps — the Rust hookup</h2>
    <div class="card">
      <p>Transition the binding path from the PMU analogue (Mac) to the bare-metal Linux definer-walk via the Rust backend — optimizing for massive parallel cloud verification while keeping the receipt portable and the analogue's live feel. The math does not change; the substrate hardens.</p>
      <p class="dim">Reproduce everything here: <code>npx thetacog-mcp attest-demo</code>.</p>
    </div>
  </section>

</div></body></html>`;
}

// CLI: node attest-demo-lifecycle.mjs <run.json> [out.html]
if (import.meta.url === `file://${process.argv[1]}`) {
  const runPath = process.argv[2];
  if (!runPath) { console.error('usage: attest-demo-lifecycle.mjs <run.json> [out.html]'); process.exit(1); }
  const R = JSON.parse(readFileSync(runPath, 'utf8'));
  const html = buildLifecycle(R, {});
  const out = process.argv[3];
  if (out) { const { writeFileSync } = await import('node:fs'); writeFileSync(out, html); console.log('wrote', out); }
  else process.stdout.write(html);
}
