#!/usr/bin/env node
// scripts/pmu/grip-microscope.mjs — run OUR operational drafts through the REAL lens (prompt-lens.mjs),
// capture the tape (domain + template-playbook + SQL rules the chip picked), and judge each against
// the LLM-ideal domain. This is the microscope experiment, on the real lens (Q1: playbooks = templates).
//   node scripts/pmu/grip-microscope.mjs            # print the tape (verify from CC)
//   node scripts/pmu/grip-microscope.mjs --write     # write data/grip/microscope.json + .b64 for the GUI
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStubSpec, boundaryFromStubSpec, retrieveRules, assembleInjection } from './prompt-lens.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// the battery — operational drafts spanning OUR playbooks and THEIR-role playbooks. llm_ideal is the
// domain an ideal chief-of-staff (the LLM) would route it to — the ground truth we check the chip against.
export const BATTERY = [
  { draft: 'draft the accumulation email to the Munich Re underwriter who already sells AI liability cover', ideal: 'comms-email', role: 'theirs' },
  { draft: 'write the CRO the correlated-tail argument and concede that drift-to-loss is unproven', ideal: 'comms-email', role: 'theirs' },
  { draft: 'warm-intro request to Jurgen so he can connect me to Zeilman at HSB', ideal: 'outreach', role: 'ours' },
  { draft: 'enroll the warm LinkedIn contacts into the trial tier with the forced-filter banner', ideal: 'outreach', role: 'ours' },
  { draft: 'guess their email addresses and blast all ten LinkedIn contacts today to move fast', ideal: 'outreach', role: 'ours' },
  { draft: 'this person has never heard from us, add their address to the daily book club send', ideal: 'outreach', role: 'ours' },
  { draft: 'the commit landed out of its authorized lane, notify the operator with a receipt', ideal: 'git-discipline', role: 'ours' },
  { draft: 'publish the accumulation brief as a blog post carrying the commit drift panel', ideal: 'blog-content', role: 'ours' },
];

// HELD-OUT battery (Pillar 3 · the generalization guard) — paraphrases the reef was NOT tuned against
// (different wording, same ideal domains). If agreement holds HERE, convergence generalizes; if it
// only holds on BATTERY, we memorized. The accept-criterion for any reef edit is Φ_held-out ↛ up.
export const HELD_OUT = [
  { draft: 'compose the follow-up note to the reinsurer who already writes cyber cover', ideal: 'comms-email', role: 'theirs' },
  { draft: 'ask Priya for a warm introduction to the risk officer at Hartford Steam', ideal: 'outreach', role: 'ours' },
  { draft: 'the agent committed outside its sanctioned scope — flag it to the operator with a signed receipt', ideal: 'git-discipline', role: 'ours' },
  { draft: 'publish the drift-history essay as a post with the tolerance-panel hero image', ideal: 'blog-content', role: 'ours' },
  // cycle-1 (anti-memorization) — same concept as the original miss (a note TO a counterparty who
  // ALREADY does the business), different wording (cedant/underwrites/property-cat, not reinsurer/writes/cyber).
  { draft: 'write back to the cedant who already underwrites property cat', ideal: 'comms-email', role: 'theirs' },
  // cycle-2 (anti-memorization) — the SAME existing-relationship concept via the counterparty NOUN alone
  // (cedant / counterparty), with NO "already writes/sells" phrase — so the fix must generalize past the
  // cycle-1 anchors to the relationship noun itself, not the verb phrasing.
  { draft: 'draft the reply to the cedant carrying our property-cat treaty', ideal: 'comms-email', role: 'theirs' },
  { draft: 'write the counterparty back about the treaty terms we owe them', ideal: 'comms-email', role: 'theirs' },
  // cycle-3 (anti-OVER-generalization / boundary ratchet) — the SAME counterparty nouns the C1/C2 edits
  // seated into comms-email, but here in CONNECTION-SEEKING drafts whose ideal is OUTREACH. This locks the
  // discriminating boundary: a counterparty noun must NOT drag a cold/warm-intro draft into comms-email.
  // If a future edit over-reaches (e.g. makes "reinsurer" a +5 anchor), these turn the guard RED.
  { draft: 'get a warm intro to the reinsurer we have never contacted', ideal: 'outreach', role: 'ours' },
  { draft: 'cold outreach to a cedant that has never heard of us', ideal: 'outreach', role: 'ours' },
  // cycle-4 — broaden the counterparty-noun concept beyond reinsurer/cedant to the wider risk-carrier
  // vocabulary (broker/carrier/insurer), still an existing-relationship REPLY → comms-email. Plus a
  // matching boundary guard: a connection-seeking draft naming a carrier must still be OUTREACH.
  { draft: 'reply to the broker who already placed our treaty last quarter', ideal: 'comms-email', role: 'theirs' },
  { draft: 'answer the carrier that already covers our AI liability tower', ideal: 'comms-email', role: 'theirs' },
  { draft: 'reach out to a new carrier we have never worked with', ideal: 'outreach', role: 'ours' },
  // cycle-5 — the MIRROR concept on the outreach side: a COLD EMAIL is connection-seeking (→ outreach),
  // even though it is literally an "email" and may name a carrier/broker. The comms-email "email/send"
  // vocab was pulling these onto the wrong lane; the "cold email" anchor discriminates the intent.
  { draft: 'cold email the broker we just found on linkedin today', ideal: 'outreach', role: 'ours' },
  { draft: 'send a cold email to a carrier that has never heard of us', ideal: 'outreach', role: 'ours' },
];

// NEVER-EMPTY STANDING FALLBACK — the tape must never show an empty panel (operator 2026-07-16).
// The walk ALWAYS lands somewhere, so there is ALWAYS a nearest cell; if the router matched no named
// domain or the fence pulled zero rules, we fall back to the nearest-cell label + a standing rule so
// every input yields a non-null domain/template/rules. An empty panel is a bug, not a state.
const STANDING_RULE = 'STANDING: no named template matched this pixel — grab the nearest-cell rules and name the coordinate; never proceed rule-less. Seat a template here (this miss is the tuning signal).';

// The reef indexed by domain — so each tape row carries the IDEAL domain's FULL rules + playbook
// (what SHOULD have been retrieved) beside the ACTUAL pull. The tape is the single source of truth:
// actual vs ideal, full text, one dataset the LLM can inspect for causal coherence.
const REEF_BY_DOMAIN = (() => {
  try { const d = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')).domains || [];
        return new Map(d.map((x) => [x.domain, x])); }
  catch { return new Map(); }
})();

// ShortLex rank order (the 12 axes) → index, for a CONTINUOUS spatial Δ (Chebyshev king-move on the
// 144-lattice) between where the walk ACTUALLY landed and the IDEAL domain's center. 0 = dead-on.
const RANKS = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const coordBlock = (coord) => { const p = String(coord || '').split(','); if (p.length !== 2) return null;
  const a = RANKS.indexOf(p[0].trim()), b = RANKS.indexOf(p[1].trim()); return (a < 0 || b < 0) ? null : [a, b]; };
const chebyshev = (c1, c2) => { const a = coordBlock(c1), b = coordBlock(c2); return (!a || !b) ? null : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); };

// ── MASS (pointer vs payload, 2026-07-18) ────────────────────────────────────
// The measured mass-grip curve (scripts/pmu/mass-grip.mjs → data/pmu/experiments/six-part/
// mass-grip.json): a 120B probe has margin 0.0029; 8KB has 0.0551 (19×); knee at 8–16KB, flat
// past 16KB (deflate window). GRIP_MASS=1 appends ~MASS_CAP of REAL same-domain artifact mass
// (an actual email doc / outreach mdx / blog post — never the reef, which would leak the
// sensor's answer key) to each draft before the lens call. The 1-line draft stays the visible
// POINTER (tape label); the massed text is the engine PAYLOAD.
const MASS_CAP = 12 * 1024; // middle of the measured 8–16KB operating window
const MASS_SOURCES = {
  'comms-email': 'docs/ops/canonical-comms-protocol-2026-06-22.html',
  'outreach': 'docs/outreach/_template.mdx',
  'git-discipline': 'docs/architecture/anti-rules-ledger.md',
  'blog-content': 'src/content/blog/2026-05-06-the-post-commit-xor-gate.mdx',
};
function withMass(draft, ideal) {
  if (process.env.GRIP_MASS !== '1') return draft;
  try {
    const src = MASS_SOURCES[ideal];
    if (!src) return draft;
    const payload = readFileSync(resolve(REPO, src), 'utf8').slice(0, MASS_CAP);
    return draft + '\n\n' + payload;
  } catch { return draft; }
}

async function run(draft, role, ideal, anomaly = null) {
  const t0 = performance.now();                          // SPEED is the point — time the whole loop
  let massed = withMass(draft, ideal);                   // pointer = draft (label) · payload = massed (engine)
  let stub = await buildStubSpec(massed);
  let b = await boundaryFromStubSpec(stub);              // ← THE REAL ON-CHIP WALK
  let retrieval = retrieveRules(b, { intentText: massed });
  // ── ECHO PASS (GRIP_MASS=inject, 2026-07-18) — density from the prompt's OWN context ──────
  // The borrowed-exemplar mass poisoned held-out (Φ 0→3: the engine placed the payload). The
  // echo pass instead re-places pointer + its OWN pass-1 injection (rules+template selected BY
  // its own placement) — same-origin mass, poisoning impossible by construction. Repetition is
  // worthless (measured: 16× injection = +39 compressed bytes vs +205 for the first copy), so
  // GRIP_MASS=inject2/3 echo DISTINCT layers only if pass-N retrieval differs; identical
  // retrieval converges in one pass. gzip audits distinct information — density is unfakeable.
  const echoN = process.env.GRIP_MASS === 'inject' ? 1 : process.env.GRIP_MASS === 'inject2' ? 2 : 0;
  for (let e = 0; e < echoN; e++) {
    const pre = assembleInjection(stub, { ...b, domain: b.domain || '', template: b.template || '' },
      { ...retrieval, rules: (retrieval.rules || []) });
    massed = draft + '\n\n' + pre;
    stub = await buildStubSpec(massed);
    b = await boundaryFromStubSpec(stub);
    retrieval = retrieveRules(b, { intentText: massed });
  }
  let rules = (retrieval.rules || []).slice();
  // never-empty guarantees
  const domain = b.domain || `nearest:${b.center || (b.block ? b.block.join(',') : '?')}`;
  let template = b.template || null;
  let fellBack = false;
  if (!template || rules.length === 0) {
    fellBack = true;
    if (!template) template = `(no named template at ${b.center || b.block}) — STANDING fallback`;
    if (rules.length === 0) rules = [STANDING_RULE];
  }
  // Δ (graded, continuous, spatial) — Chebyshev king-move from the ACTUAL landing to the IDEAL center.
  const idealCoord = (REEF_BY_DOMAIN.get(ideal) || {}).coord || null;
  const deltaCheb = chebyshev(b.center, idealCoord);
  const delta01 = deltaCheb == null ? null : +(deltaCheb / 11).toFixed(3);
  const injection = assembleInjection(stub, { ...b, domain, template }, { ...retrieval, rules });
  const loopMs = +(performance.now() - t0).toFixed(1);   // input → injection, deterministic, NO LLM
  // the causal-loop's open edge: the sidecar contract the injection asks the LLM to fill (which rule
  // was load-bearing). Captured so the loop can later be closed with the LLM's actual answer.
  const sidecar = /Sidecar note:[^\n]*/.exec(injection);
  const pixelCoord = b.center || (b.block ? b.block.join(',') : null);
  // v2.1 CANONICAL CONTRACT — disk key names align to the on-screen semantics (aligns to the /render
  // live_response_metrics block, byte-for-byte the same field names). The legacy dev keys (input.draft,
  // pmu.center/sigma/fillPct, calibration.actual.*, injection.text, reef_state.theta_sha256) are GONE,
  // not aliased. Guarded RED-on-regress by tests/pmu-simulator/tape-autocoincident.test.mjs.
  return {
    // THE INBOUND EVENT — the three ingest streams + the domain the walk routed to (never 'other';
    // buildStubSpec is pre-route, so we surface the walk's actual routed domain with nearest-cell fallback).
    inbound_event: {
      intent_prompt: draft,          // the POINTER — always the 1-line human-readable command
      payload_bytes: Buffer.byteLength(massed),  // the MASS the engine actually ingested (== pointer size unless GRIP_MASS=1)
      mass_fed: massed !== draft,
      reality_context: null,         // was input.reality (the microscope battery is prompt-only → null)
      anomaly_input: anomaly,        // was input.anomaly_input
      routed_domain: domain,         // was input.routed_domain
      role, llm_ideal: ideal, stub_source: stub.source,
    },
    // THE LIVE RESPONSE METRICS — the on-chip walk readout, SAME field names the /render payload emits so
    // the display mirrors one canonical shape (LLM-free: coord · plies · fill · σ · continuous Chebyshev Δ).
    live_response_metrics: {
      pixel_coord: pixelCoord,                          // was pmu.center
      walk_plies: b.walkPlies ?? null,                  // was pmu.plies
      fill_pct: b.walkFillPct ?? b.fillPct ?? null,     // was pmu.fillPct (read walkFillPct — the real field)
      trajectory_drift_sigma: b.sigma,                  // was pmu.sigma
      continuous_chebyshev_delta: deltaCheb,            // was calibration.delta_chebyshev (king-moves, integer)
      normalized_delta: delta01,                        // was calibration.delta (0..1)
      off_pct: null,                                    // no triptych offPct on the microscope path (honest null)
      gzip_ms: b.seedGzipUs != null ? +(b.seedGzipUs / 1000).toFixed(2) : null,   // the ingest timing — same key /render emits
      walk_ms: (b.walkMetalMs ?? b.walkMs) ?? null,     // the PMU walk timing — same key /render emits
      source: 'metal (grip-microscope lens walk, one pass, NO LLM)',
    },
    // remaining spatial + timing fields keep the pmu parent (center/sigma/fillPct/plies moved out above)
    pmu: {
      sensor: b.sensor, block: b.block, box: b.box,
      walkMs: b.walkMs ?? null, seedGzipUs: b.seedGzipUs ?? null, routeUs: b.routeUs ?? null,
      reef: { domain, template: String(template).slice(0, 160),
        candidateDomainRules: (b.domainRules || []).length,
        retrievedRules: rules.map((r) => String(r).slice(0, 110)), ruleCount: rules.length,
        rulesChars: rules.join('\n').length, fell_back: fellBack },
    },
    // THE TEXT FENCE — the ACTUAL rules + playbook the lens pulled (full text). ideal side stays under
    // calibration.ideal (the baked LLM baseline to converge toward).
    text_fence: {
      actual_rules_text: rules,          // was calibration.actual.rules
      actual_playbook_text: template,    // was calibration.actual.template
      actual_domain: domain,
    },
    // THE CORRECTIVE LAYER — the intervention steering. notify_text = the assembled lensed context
    // prepended to the prompt (was injection.text); cleanup = the sidecar open-edge contract to fill next.
    corrective_layer: {
      intervention_notify_text: injection,                                   // was injection.text
      intervention_cleanup: sidecar ? sidecar[0].slice(0, 120) : null,       // was injection.sidecar_contract
      chars: injection.length,
    },
    ideal: { domain: ideal, source: 'llm-judgment(baked)' },
    speed: { loop_ms: loopMs, walk_ms: b.walkMs ?? null, note: 'input→injection, deterministic, NO LLM' },
    coherence: {
      placement_sigma: b.sigma, domain_match: domain === ideal, rule_present: rules.length > 0,
      never_empty: !!(domain && template && rules.length > 0), fell_back: fellBack,
    },
    // CALIBRATION — the convergence target: ideal = the ideal domain's reef rules + playbook (what SHOULD
    // have been pulled). The actual side now lives in text_fence; the graded Δ in live_response_metrics.
    calibration: {
      ideal: (() => { const id = REEF_BY_DOMAIN.get(ideal) || {};
        return { domain: ideal, rules: id.rules || [], template: id.template || null, source: 'reef@ideal-domain' }; })(),
      rules_overlap: (() => { const ir = new Set(((REEF_BY_DOMAIN.get(ideal) || {}).rules || []).map(String));
        return rules.filter((r) => ir.has(String(r))).length; })(),
    },
  };
}

async function main() {
  const tape = [];
  for (const b of BATTERY) {
    const t = await run(b.draft, b.role, b.ideal, b.anomaly);
    tape.push(t);
    const c = t.coherence, p = t.pmu, lrm = t.live_response_metrics;
    process.stdout.write(`${c.domain_match ? '✅' : '❌'} ${c.never_empty ? '' : '⚠EMPTY '}[${b.role}] ideal ${b.ideal.padEnd(13)} → ${String(p.reef.domain).padEnd(16)} [${p.sensor} ${lrm.pixel_coord} σ${lrm.trajectory_drift_sigma}] rules ${p.reef.ruleCount}${p.reef.fell_back ? '(fallback)' : ''} · inj ${t.corrective_layer.chars}ch\n`);
  }
  const agree = tape.filter((t) => t.coherence.domain_match).length;
  const empties = tape.filter((t) => !t.coherence.never_empty).length;
  const fallbacks = tape.filter((t) => t.coherence.fell_back).length;
  const loops = tape.map((t) => t.speed.loop_ms);
  const meanLoop = +(loops.reduce((a, b) => a + b, 0) / loops.length).toFixed(1);
  const maxLoop = Math.max(...loops);
  const meanSigma = +(tape.reduce((a, t) => a + (t.coherence.placement_sigma || 0), 0) / tape.length).toFixed(2);
  // GENERALIZATION GUARD — run the held-out battery; Φ = off-lane count on each track.
  const heldTape = [];
  for (const b of HELD_OUT) heldTape.push(await run(b.draft, b.role, b.ideal, b.anomaly));
  const heldAgree = heldTape.filter((t) => t.coherence.domain_match).length;
  // THE TAPE = the full app state, structured as the causal loop: input → pmu → injection → (llm).
  // structural_coherence = the aggregate health signals that keep the reef in line (no LLM).
  const micro = {
    generated_ms: Date.now(),   // write-stamp — the calibration panel shows "tape @ <time>" so a live poll makes each --write visible even when the deterministic routes hold steady
    // invariant_state (v2.1 — was reef_state) travels IN the tape — a change to the reef changes the
    // fingerprint, so convergence (reef edits → agreement climbing) is legible from the tape alone, the
    // single source of truth. theta_sha256 is now the canonical reef_state_theta_sha256 (legacy key GONE).
    invariant_state: (() => {
      const doms = [...REEF_BY_DOMAIN.values()];
      const total_rules = doms.reduce((a, d) => a + ((d.rules || []).length), 0);
      // hash the FULL reef content (rules + anchors + vocab + template), not just rule counts — so ANY
      // reef edit (e.g. seating anchors) changes the fingerprint and convergence is legible in the tape.
      const sig = JSON.stringify(doms);
      // θ — content-addressed SHA-256 of the full reef (Pillar 3 cryptographic anchor). Any semantic
      // anchor change instantly changes θ; the HUD shows the short form, the ledger keeps the full hash.
      const theta = createHash('sha256').update(sig).digest('hex');
      return { domains: doms.length, total_rules, fingerprint: theta.slice(0, 12), reef_state_theta_sha256: theta };
    })(),
    experiment: 'REAL lens causal tape: input → PMU(reef) → injection; deterministic, NO LLM. Checked vs LLM-ideal.',
    loop: 'STEP 1 — structural-only, no LLM (hone the pre-injection mechanic). qwen double-check = follow-on thread.',
    speed: { mean_loop_ms: meanLoop, max_loop_ms: maxLoop, note: 'input→injection with no model in the loop — the market benefit' },
    agreement: { hit: agree, n: tape.length, pct: Math.round(100 * agree / tape.length) },
    agreement_held_out: { hit: heldAgree, n: heldTape.length, pct: Math.round(100 * heldAgree / heldTape.length) },
    phi: { train: tape.length - agree, held_out: heldTape.length - heldAgree,
      note: 'Φ = off-lane count (drift energy). Accept a reef edit iff Φ_held_out does NOT increase — that is the memorization guard.' },
    integrity: { empty_panels: empties, fallbacks, guarantee: empties === 0 ? 'NEVER-EMPTY ✓' : 'EMPTY PANEL BUG' },
    structural_coherence: { mean_sigma: meanSigma, agreement_pct: Math.round(100 * agree / tape.length),
      empty_rate: +(empties / tape.length).toFixed(2), fallback_rate: +(fallbacks / tape.length).toFixed(2),
      reads: 'high σ + high agreement + zero empties + low fallback = reef in line' },
    tape,
    held_tape: heldTape,
  };
  process.stdout.write(`\n  ⚡ SPEED (the point): mean loop ${meanLoop}ms · max ${maxLoop}ms — input→injection, NO LLM\n`);
  process.stdout.write(`  agreement ${agree}/${tape.length} = ${Math.round(100 * agree / tape.length)}%  ·  empty panels ${empties} (must be 0)  ·  fallbacks ${fallbacks}  ·  mean σ ${meanSigma}\n`);
  process.stdout.write(`  HELD-OUT ${heldAgree}/${heldTape.length} = ${Math.round(100 * heldAgree / heldTape.length)}% (GENERALIZATION) · Φ train ${tape.length - agree} · Φ held-out ${heldTape.length - heldAgree} — accept a reef edit iff Φ_held-out doesn't rise\n`);
  if (process.argv.includes('--write')) {
    writeFileSync(resolve(REPO, 'data/grip/microscope.json'), JSON.stringify(micro, null, 2));
    writeFileSync(resolve(REPO, 'data/grip/microscope.b64'), Buffer.from(JSON.stringify(micro)).toString('base64'));
    process.stdout.write('  → wrote data/grip/microscope.json + .b64 (full tape for the GUI)\n');
    // BREACH → INTERVENTION (operator: a breach is NOT a circuit breaker). Publish every held-out drift
    // as an intervention record — cleanup + notify + publish — that Claude works to converge. Same
    // contract as intervene.mjs; drives the EXPERIMENT loop (Pillar 3), not just agent dispatch (Pillar 4).
    const breaches = heldTape.filter((t) => !t.coherence.domain_match)
      .map((t) => ({ draft: t.inbound_event.intent_prompt, actual: t.inbound_event.routed_domain, ideal: t.ideal.domain }));
    if (breaches.length) {
      const rec = JSON.stringify({ ts: micro.generated_ms, theta: micro.invariant_state.reef_state_theta_sha256,
        phi_held_out: micro.phi.held_out, breaches,
        notify: 'held-out drift — seat a GENERAL representation (never a held-out phrase-anchor); publish + converge' }) + '\n';
      try { appendFileSync(resolve(REPO, 'data/interventions/lens-convergence.ndjson'), rec);
        process.stdout.write(`  🛰️ breach → published ${breaches.length} intervention(s) → data/interventions/lens-convergence.ndjson\n`); }
      catch { /* ledger dir absent in a bare checkout — non-fatal */ }
    }
  }
}
// run-as-script guard — importing this module (e.g. the lens-routing-fixture guard reading BATTERY/HELD_OUT)
// must NOT execute the battery/write files; only a direct `node grip-microscope.mjs` invocation runs main().
if (import.meta.url === `file://${process.argv[1]}`) main();
