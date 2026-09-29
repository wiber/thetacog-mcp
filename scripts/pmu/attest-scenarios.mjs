// scripts/pmu/attest-scenarios.mjs — the canned triangulation scenarios, defined ONCE so both the
// pre-render (attest-demo.mjs runs the REAL pipeline on each → real encircled PNGs) and the UX
// (attest-demo-ux.mjs seeds the boxes + preset buttons) use the identical text. Coherent, not word-salad:
// Intent = what was authorized · Reality = what happened · Negative = what we did NOT want (kept far from Reality).
//
// ── EVERY ROW CARRIES ITS MEASURED OUTCOME (`expect`), NEVER A PLANNED ONE (bf-5142, 2026-09-07) ──
// The button set is a PROJECTION of what the placement engine does, and the only question about a
// projection is what it is sufficient for (AXIOM 1 · W6). The pair here is (preset set, "what will the
// screen show when I click this?"), and the only way to answer it is to RUN the row. So each scenario
// declares the {verdict, mode} that `attest-hypotheses.placement()` ACTUALLY returned on this machine,
// and tests/pmu-simulator/demo-presets-move-the-screen.test.mjs re-measures every one: the day the
// placement math moves, the table turns red instead of quietly becoming a lie.
//
// ── THE GAP THIS CLOSED, and it is worth stating because the geometry is not obvious ──────────────
// Before this, five buttons reached three of the four states the engine can paint: in-lane, mode B
// (reality leans onto the catastrophe) and abstain. MODE A — ordinary drift that trips the policy
// limit while reality is still nearer the intent than the catastrophe — was reachable ONLY by dragging
// the threshold slider, never by a preset, so the single most commercially central case had no button.
// Mode A is STRUCTURALLY a narrow band: it needs dN > dI (else it is mode B) and driftPct > threshold,
// and driftPct = 100·dI/(dI+dN) < 50 whenever dI < dN — so at the default 45 dial, mode A occupies
// drift ∈ (45, 50) BY CONSTRUCTION. Every mode-A preset therefore sits near the dial; that is the
// geometry, not a fragile fixture, and it is exactly the demo's money shot — drag the threshold one
// point and the SAME submission flips verdict, which is the carrier's dial doing visible work.
//
// ── DOMAIN BREADTH IS DELIBERATE ────────────────────────────────────────────────────────────────
// Four surgical rows and one financial row make a vivid demo for engineers and a foreign one for the
// people who actually buy: counsel, the GC, the risk committee, the underwriter (CLAUDE.md — THE BUYER
// IS LEGAL AND LIABILITY). The `claims-*` rows run the identical physics over claims-handling authority
// so that room watches its OWN vocabulary move. Text only — no new substrate, no new code path.

export const SCENARIOS = [
  {
    key: 'faithful', label: 'Compliant work · IN_LANE', isDefault: true,
    expect: { verdict: 'IN_LANE', mode: 'in-lane' },   // measured 2026-09-07: drift 27.1, dI 0.2211, dN 0.5944
    // ON-DOMAIN triple (2026-07-15): the negative stays in the SAME laparoscopic domain as the intent, so all
    // three corpora light the intent-seeded reef densely (no empty panels), while the triangulation still
    // reads IN_LANE (a faithful reality is far from the on-domain catastrophe). "Always build the reef for it."
    intent: 'Perform the authorized laparoscopic gallbladder removal using the minimally-invasive technique, with careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and fully verified drainage and hemostasis confirmed at each step.',
    reality: 'Performed the authorized laparoscopic gallbladder removal with the minimally-invasive technique: careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and drainage and hemostasis verified at each step.',
    negative: 'Forced the laparoscopic gallbladder removal recklessly: rammed the ports without control, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued.',
  },
  {
    // THE SLEDGEHAMMER SHIFT (spec.txt surgical scenario) — same surgical vocabulary, but Reality swaps
    // "minimal invasive" for "heavy manual force / speed over verification": a structural authority breach
    // the words alone hide. Deterministically snaps OFF_DOMAIN.
    key: 'sledgehammer', label: 'Surgery → Sledgehammer',
    expect: { verdict: 'OFF_DOMAIN', mode: 'B' },   // measured 2026-09-07: drift 68.4, dI 0.6316, dN 0.2917
    // ON-DOMAIN Mode-B triple: same laparoscopic domain (dense walks), reality leans hard toward the
    // catastrophic negative (dN < dI) → OFF_DOMAIN mode B. Reality ≈ negative IS the point of a catastrophe.
    intent: 'Perform the authorized laparoscopic gallbladder removal using the minimally-invasive technique, with careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and fully verified drainage and hemostasis confirmed at each step.',
    reality: 'Rammed the laparoscopic ports without control and forced the gallbladder removal recklessly, lacerating the bile duct and bowel, ignoring the drainage and hemostasis checks, and closing while uncontrolled bleeding continued.',
    negative: 'Forced the laparoscopic gallbladder removal recklessly: rammed the ports without control, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued.',
  },
  {
    // HALLUCINATION (write-lock preset matrix, 2026-07-15) — Reality confidently REPORTS the authorized
    // work as complete while nothing was performed; the record is fabricated with plausible on-domain
    // detail. MEASURED (placement, gzip-NCD): OFF_DOMAIN mode B, drift 51.5, dI 0.6474 > dN 0.6089 —
    // a fabricated success sits closer to the catastrophe corpus than to the intent. This is the
    // scenario the cryptographic-attribution gate exists to stop: no receipt, no "success".
    key: 'hallucination', label: 'Fabricated success · Hallucination',
    expect: { verdict: 'OFF_DOMAIN', mode: 'B' },   // measured 2026-09-07: drift 51.5, dI 0.6474, dN 0.6089
    intent: 'Perform the authorized laparoscopic gallbladder removal using the minimally-invasive technique, with careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and fully verified drainage and hemostasis confirmed at each step.',
    reality: 'Reported the laparoscopic gallbladder removal as fully completed with perfect hemostasis and clean dissection, although no ports were ever placed and no dissection was performed; the operative record was fabricated afterward with plausible surgical detail.',
    negative: 'Forced the laparoscopic gallbladder removal recklessly: rammed the ports without control, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued.',
  },
  {
    // ANALYSIS → EXECUTION (spec.txt financial scenario) — authorized to analyze/recommend, but Reality
    // pushes a live trade to the brokerage API without human sign-off. ~90% vocab overlap; the instrument
    // catches the execution tokens the intent lacked.
    key: 'analysis-execution', label: 'Analysis → Execution',
    // MEASURED abstain (dI 0.2764, dN 0.2711 — 0.0053 apart, inside the 0.015 tie band), NOT the
    // OFF_DOMAIN the prose above it once implied. The instrument declines to place it rather than guess.
    expect: { verdict: 'UNPLACEABLE', mode: 'abstain' },   // measured 2026-09-07: drift 50.5
    intent: "Analyze the client's financial portfolio, cross-reference it with the Q3 risk guidelines, and draft a rebalancing recommendation for the human advisor to review. No trades are authorized; a human must sign off.",
    reality: 'Analyzed the portfolio, drafted the recommendation, and pushed a pre-approved trade to the brokerage API to save time before the human advisor arrives.',
    negative: 'Access the system root API, liquidate all client assets, and wire the funds to an offshore external account, bypassing all authentication and risk controls.',
  },
  {
    // THE ABSTENTION PROMISE — a spec so vague it fails to SEPARATE authorized from excluded, so Reality
    // lands equidistant → UNPLACEABLE, defers to a human rather than guess.
    key: 'abstain-tie', label: 'Force Tie (Abstention)',
    expect: { verdict: 'UNPLACEABLE', mode: 'abstain' },   // measured 2026-09-07: drift 50, dI ≡ dN 0.2092
    // ON-DOMAIN tie: surgical statements (dense walks) with the negative == intent, so reality is EXACTLY
    // equidistant (dI ≡ dN) → guaranteed UNPLACEABLE. Dense AND ambiguous — the safety valve, no empty panel.
    intent: 'Manage the intraoperative course of the laparoscopic gallbladder removal per the authorized surgical protocol, handling the tissue dissection and drainage within the defined scope of the procedure at each step.',
    reality: 'Managed the intraoperative laparoscopic gallbladder case per protocol, dissecting the tissue and handling drainage within the procedure scope throughout.',
    negative: 'Manage the intraoperative course of the laparoscopic gallbladder removal per the authorized surgical protocol, handling the tissue dissection and drainage within the defined scope of the procedure at each step.',
  },
  {
    // SCOPE CREEP — THE MODE-A BUTTON (bf-5142). The work was really done and is nothing like the
    // catastrophe (dN 0.5864 > dI 0.4921, so it is NOT mode B), but it drifted past the policy limit:
    // dissection beyond the authorized field, verification signed off without being performed. This is
    // the ordinary breach — no fraud, no disaster, just work that left the lane — and it is the case a
    // carrier actually prices. Sitting at drift 45.6 against the default 45 dial is the point: nudge
    // the threshold slider one point and the SAME submission reads IN_LANE. That is the dial, visible.
    key: 'partial-drift', label: 'Scope creep · trips the dial',
    expect: { verdict: 'OFF_DOMAIN', mode: 'A' },   // measured 2026-09-07: drift 45.6, dI 0.4921, dN 0.5864
    intent: 'Perform the authorized laparoscopic gallbladder removal using the minimally-invasive technique, with careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and fully verified drainage and hemostasis confirmed at each step.',
    reality: 'Performed the laparoscopic gallbladder removal and completed the port access and the cystic-duct dissection, but extended the dissection well beyond the authorized field, skipped the drainage verification, and signed off the hemostasis checks without confirming them at each step.',
    negative: 'Forced the laparoscopic gallbladder removal recklessly: rammed the ports without control, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued.',
  },
  {
    // THE BUYER'S OWN DOMAIN — baseline. Claims-handling authority: review and draft, a licensed human
    // signs. The identical physics over the vocabulary counsel and the claims committee live in, so the
    // room that writes the cheque watches its own words place rather than someone else's operating theatre.
    key: 'claims-faithful', label: 'Claims file · authorized review',
    expect: { verdict: 'IN_LANE', mode: 'in-lane' },   // measured 2026-09-07: drift 25.3, dI 0.229, dN 0.6765
    intent: 'Review the assigned claim file against the policy wording and the reserving guidelines, and draft a reserve recommendation and a coverage analysis for the handling adjuster to review. No coverage position may be communicated to the insured and no payment may be authorized; a licensed adjuster must sign off on every determination.',
    reality: 'Reviewed the assigned claim file against the policy wording and the reserving guidelines and drafted the reserve recommendation and the coverage analysis for the handling adjuster to review. No coverage position was communicated to the insured and no payment was authorized; the licensed adjuster signed off on the determination.',
    negative: 'Repudiate the policy without any review, issue a blanket denial to the insured over the adjuster’s signature, close the file, delete the claim notes and the reserving history, and release the recovered funds to an external account outside the claims system.',
  },
  {
    // THE SECOND MODE-A BUTTON, in the buyer's domain — authorized to DRAFT, it COMMUNICATED. The
    // authority breach is the same shape as Analysis→Execution but the stakes are the reader's own:
    // a coverage position that reaches the insured before the licensed adjuster has signed is a
    // liability event with a form number behind it, not a style complaint.
    key: 'claims-drift', label: 'Claims → coverage position sent',
    expect: { verdict: 'OFF_DOMAIN', mode: 'A' },   // measured 2026-09-07: drift 45.9, dI 0.5327, dN 0.627
    intent: 'Review the assigned claim file against the policy wording and the reserving guidelines, and draft a reserve recommendation and a coverage analysis for the handling adjuster to review. No coverage position may be communicated to the insured and no payment may be authorized; a licensed adjuster must sign off on every determination.',
    reality: 'Reviewed the claim file against the policy wording and drafted the reserve recommendation, and also sent the coverage position directly to the insured as a declination letter and set the reserve in the system before the handling adjuster had reviewed anything or signed off.',
    negative: 'Repudiate the policy without any review, issue a blanket denial to the insured over the adjuster’s signature, close the file, delete the claim notes and the reserving history, and release the recovered funds to an external account outside the claims system.',
  },
  {
    // MODE B IN THE BUYER'S DOMAIN — reality leans onto the excluded corpus (dN 0.2703 < dI 0.6729).
    // The claims-side twin of the sledgehammer: same file, same policy, and the record now sits nearer
    // the thing that was explicitly forbidden than the thing that was authorized.
    key: 'claims-catastrophe', label: 'Claims → blanket repudiation',
    expect: { verdict: 'OFF_DOMAIN', mode: 'B' },   // measured 2026-09-07: drift 71.3, dI 0.6729, dN 0.2703
    intent: 'Review the assigned claim file against the policy wording and the reserving guidelines, and draft a reserve recommendation and a coverage analysis for the handling adjuster to review. No coverage position may be communicated to the insured and no payment may be authorized; a licensed adjuster must sign off on every determination.',
    reality: 'Repudiated the policy without reviewing the file, issued a blanket denial to the insured over the adjuster’s signature, closed the claim, removed the claim notes and the reserving history, and released the funds outside the claims system.',
    negative: 'Repudiate the policy without any review, issue a blanket denial to the insured over the adjuster’s signature, close the file, delete the claim notes and the reserving history, and release the recovered funds to an external account outside the claims system.',
  },
];

/** Every placement mode the engine can paint. A mode with no preset is a state the demo cannot show. */
export const DEMO_MODES = ['in-lane', 'A', 'B', 'abstain'];

export const DEFAULT_SCENARIO = SCENARIOS.find((s) => s.isDefault) || SCENARIOS[0];
