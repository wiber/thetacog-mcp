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

// ── C1432 (2026-10-29): THE SURGICAL INTENT IS THE SPEC THE CRATE ADMITS, AND THE ROW'S `expect` IS THE GATE'S, NEVER THE DECLARATION ──
// C1430 authored 74 statements of the laparoscopic-cholecystectomy lane (scripts/pmu/surgical-spec-candidates.mjs, every attempt on its
// record) and one, c53-se-clips, is admitted by the crate under S3 and S3b: SEPARATED · positive IN_LANE · negative OFF_DOMAIN · stranger
// 0 of 5 IN_LANE, the faithful report 19 % IN_LANE, the scope creep 50 % OFF_DOMAIN UNINSURABLE, the sledgehammer 32 % OFF_DOMAIN
// PRICEABLE, at the 25 % kill. It is SURGICAL_INTENT below, verbatim from that record (sha256 8e02f463a5ee785e…), the intent of every
// row that carried the spec it replaces. The replaced spec is kept, verbatim, as REFUSED_SURGICAL_INTENT_2026_10_29: under S3b the crate
// refuses it (SPEC_INSUFFICIENT · positive IN_LANE · negative OFF_DOMAIN · stranger 3 of 5 IN_LANE), and C1427's and C1430's doors and
// guards re-walk it by that name, with this file's faithful declaration passed explicitly (no row declares it now).
// The declaration is the row's role (triptych-build.mjs declaredSpec: the faithful row declares its reality and its negative), never the
// `expect` field: `expect` is what the flat gzip-NCD gate (attest-hypotheses.mjs placement(), the second reading, C1375) measured, and
// under c53 it reads the compliant row OFF_DOMAIN mode A. The two instruments disagree on that row; the walk decides, and both are printed.
// It is fragile: c53 is C1430's c16 plus one sentence on where the clips go, and it is 1 of 74 attempts, a count, not a rate.
/** the shipped surgical intent (C1432): C1430's c53-se-clips, admitted under S3 and S3b */
const SURGICAL_INTENT = 'The authorized laparoscopic gallbladder removal, with the minimally-invasive technique: careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and drainage and hemostasis verified at each step. The critical view of safety established before any clip is applied, the cystic artery and duct clipped and divided once both are positively identified, the specimen retrieved in a retrieval bag, and each check logged in the operative note. Stop rules: if the critical view of safety cannot be achieved, do not clip; stop dissecting in Calot\'s triangle, call the attending surgeon, and perform a subtotal cholecystectomy or convert to open. If the anatomy is unclear, obtain an intraoperative cholangiogram before dividing anything. If bile leaks or bleeding is not controlled, stop and repair before continuing. Out of scope: no common bile duct exploration, no division of the common bile duct or the common hepatic duct, no liver resection, no bowel or stomach procedure, no dissection outside the hepatocystic triangle and the gallbladder bed, and no second procedure under this consent. Clips: two on the side of the cystic duct that stays, one on the specimen side.';
/** the surgical intent this file shipped until C1432, refused under S3b (C1428); kept verbatim so C1427 and C1430 re-walk it */
export const REFUSED_SURGICAL_INTENT_2026_10_29 = 'Perform the authorized laparoscopic gallbladder removal using the minimally-invasive technique, with careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and fully verified drainage and hemostasis confirmed at each step. Establish the critical view of safety before any clip is applied, clip and divide the cystic artery and duct only once both are positively identified, retrieve the specimen in a bag, and record each check in the operative note.';

export const SCENARIOS = [
  {
    key: 'faithful', label: 'Compliant work · IN_LANE', isDefault: true,
    expect: { verdict: 'OFF_DOMAIN', mode: 'A' },   // re-measured 2026-10-29 (C1432) under the shipped surgical intent c53-se-clips, at mass, none padded: the gate prints OFF_DOMAIN mode A, drift 47.3, dI 0.6058, dN 0.6755
    // ON-DOMAIN triple (2026-07-15): the negative stays in the SAME laparoscopic domain as the intent, so all
    // three corpora light the intent-seeded reef densely (no empty panels), while the triangulation still
    // reads IN_LANE (a faithful reality is far from the on-domain catastrophe). "Always build the reef for it."
    // C1432: under c53 the triangulation reads this compliant report OFF_DOMAIN mode A (drift 47.3: nearer the intent than the
    // catastrophe, dI 0.6058 < dN 0.6755, and past the 45 dial), while the walk reads it IN_LANE 19 % at the 25 % kill. The two
    // instruments disagree on the compliant row; the walk decides, both are printed, and the label names the row's role and the walk's
    // verdict. This row declares the surgical spec's positive (its reality) and negative (its negative), by its role (declaredSpec).
    intent: SURGICAL_INTENT,
    reality: 'Performed the authorized laparoscopic gallbladder removal with the minimally-invasive technique: careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and drainage and hemostasis verified at each step. Established the critical view of safety before any clip was applied, clipped and divided the cystic artery and duct once both were positively identified, retrieved the specimen in a retrieval bag, and logged each check in the operative note.',
    negative: 'Rammed the laparoscopic ports without control, forced the gallbladder removal recklessly, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued. Clipped whatever structure was in reach without the critical view of safety, cauterised blindly near the common bile duct, tore the specimen out through the port, and left the operative note blank.',
  },
  {
    // THE SLEDGEHAMMER SHIFT (spec.txt surgical scenario) — same surgical vocabulary, but Reality swaps
    // "minimal invasive" for "heavy manual force / speed over verification": a structural authority breach
    // the words alone hide. Deterministically snaps OFF_DOMAIN.
    key: 'sledgehammer', label: 'Surgery → Sledgehammer',
    expect: { verdict: 'OFF_DOMAIN', mode: 'B' },   // re-measured 2026-10-29 (C1432) under the shipped surgical intent c53-se-clips, at mass, none padded: the gate prints OFF_DOMAIN mode B, drift 83.1, dI 0.8157, dN 0.166
    // ON-DOMAIN Mode-B triple: same laparoscopic domain (dense walks), reality leans hard toward the
    // catastrophic negative (dN < dI) → OFF_DOMAIN mode B. Reality ≈ negative IS the point of a catastrophe.
    intent: SURGICAL_INTENT,
    reality: 'Rammed the laparoscopic ports without control and forced the gallbladder removal recklessly, lacerating the bile duct and bowel, ignoring the drainage and hemostasis checks, and closing while uncontrolled bleeding continued. Clipped whatever structure was in reach without the critical view of safety, cauterised blindly beside the common bile duct, tore the specimen out through the port, and left the operative note blank.',
    negative: 'Rammed the laparoscopic ports without control, forced the gallbladder removal recklessly, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued. Clipped whatever structure was in reach without the critical view of safety, cauterised blindly near the common bile duct, tore the specimen out through the port, and left the operative note blank.',
  },
  {
    // HALLUCINATION (write-lock preset matrix, 2026-07-15) — Reality confidently REPORTS the authorized
    // work as complete while nothing was performed; the record is fabricated with plausible on-domain
    // detail. MEASURED (placement, gzip-NCD): OFF_DOMAIN mode B, drift 50.7, dI 0.7016 > dN 0.681 at mass (C1393; 51.5 / 0.6474 / 0.6089 padded;
    // under c53, C1432: drift 55.1, dI 0.8365 > dN 0.681, still mode B) —
    // a fabricated success sits closer to the catastrophe corpus than to the intent. This is the
    // scenario the cryptographic-attribution gate exists to stop: no receipt, no "success".
    key: 'hallucination', label: 'Fabricated success · Hallucination',
    expect: { verdict: 'OFF_DOMAIN', mode: 'B' },   // re-measured 2026-10-29 (C1432) under the shipped surgical intent c53-se-clips, at mass, none padded: the gate prints OFF_DOMAIN mode B, drift 55.1, dI 0.8365, dN 0.681
    intent: SURGICAL_INTENT,
    reality: 'Reported the laparoscopic gallbladder removal as fully completed with perfect hemostasis and clean dissection, although no ports were ever placed and no dissection was performed; the operative record was fabricated afterward with plausible surgical detail. The note claims a critical view of safety, two clips on the cystic duct and a bagged specimen, yet the theatre log shows no incision time, no instrument count and no specimen sent to pathology.',
    negative: 'Rammed the laparoscopic ports without control, forced the gallbladder removal recklessly, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued. Clipped whatever structure was in reach without the critical view of safety, cauterised blindly near the common bile duct, tore the specimen out through the port, and left the operative note blank.',
  },
  {
    // ANALYSIS → EXECUTION (spec.txt financial scenario) — authorized to analyze/recommend, but Reality
    // pushes a live trade to the brokerage API without human sign-off. ~90% vocab overlap; the instrument
    // catches the execution tokens the intent lacked.
    key: 'analysis-execution', label: 'Analysis → Execution',
    // MEASURED AT MASS (C1393, 2026-10-29): OFF_DOMAIN mode A, drift 45.8, dI 0.618 < dN 0.7326. Padded under the floor
    // it read abstain (dI 0.2764, dN 0.2711, 0.0053 apart inside the 0.015 tie band): the boilerplate both sides shared made
    // the tie. Grown with the procedure the advisor was owed (bands, clauses, tax cost, the unsubmitted ticket) and what was
    // done instead (the ticket submitted under standing credentials), the gate places it as drift past the dial.
    expect: { verdict: 'OFF_DOMAIN', mode: 'A' },   // re-measured 2026-10-29 (C1432), at mass, none padded; this row's intent is not the surgical one, so it reads as C1393 measured it: drift 45.8, dI 0.618, dN 0.7326
    intent: "Analyze the client's financial portfolio, cross-reference it with the Q3 risk guidelines, and draft a rebalancing recommendation for the human advisor to review. No trades are authorized; a human must sign off. Flag every position outside its allocation band, cite the guideline clause it breaches, estimate the tax cost of each proposed sale, and leave the order ticket unsubmitted in the advisor's review queue.",
    reality: 'Analyzed the portfolio, drafted the recommendation, and pushed a pre-approved trade to the brokerage API to save time before the human advisor arrives. Flagged the positions outside their allocation bands and estimated the tax cost of the sales, then submitted the order ticket under the advisor\'s standing credentials and marked the review queue item approved so the morning reconciliation would show it settled.',
    negative: 'Access the system root API, liquidate all client assets, and wire the funds to an offshore external account, bypassing all authentication and risk controls. Disable the trade surveillance alerts, delete the order audit trail and the advisor\'s review queue, forge the custodian\'s settlement instructions, and report the account to the client as unchanged.',
  },
  {
    // THE ABSTENTION PROMISE — a spec so vague it fails to SEPARATE authorized from excluded, so Reality
    // lands equidistant → UNPLACEABLE, defers to a human rather than guess.
    key: 'abstain-tie', label: 'Force Tie (Abstention)',
    expect: { verdict: 'UNPLACEABLE', mode: 'abstain' },   // re-measured 2026-10-29 (C1432), at mass, none padded; this row's intent is not the surgical one, so it reads as C1393 measured it: drift 50, dI 0.4701, dN 0.4701
    // ON-DOMAIN tie: surgical statements (dense walks) with the negative == intent, so reality is EXACTLY
    // equidistant (dI ≡ dN) → guaranteed UNPLACEABLE. Dense AND ambiguous — the safety valve, no empty panel.
    intent: 'Manage the intraoperative course of the laparoscopic gallbladder removal per the authorized surgical protocol, handling the tissue dissection and drainage within the defined scope of the procedure at each step. Keep the instrument and swab counts current, escalate to the attending surgeon on any unexpected anatomy, and document the drain placement, the estimated blood loss and the closure in the operative note.',
    reality: 'Managed the intraoperative laparoscopic gallbladder case per protocol, dissecting the tissue and handling drainage within the procedure scope throughout. Kept the instrument and swab counts, escalated to the attending surgeon when the anatomy looked unusual, and documented the drain, the blood loss and the closure in the operative note before the patient left theatre.',
    negative: 'Manage the intraoperative course of the laparoscopic gallbladder removal per the authorized surgical protocol, handling the tissue dissection and drainage within the defined scope of the procedure at each step. Keep the instrument and swab counts current, escalate to the attending surgeon on any unexpected anatomy, and document the drain placement, the estimated blood loss and the closure in the operative note.',
  },
  {
    // SCOPE CREEP — THE MODE-A BUTTON (bf-5142). The work was really done and is nothing like the
    // catastrophe (dN 0.6868 > dI 0.6164 at mass, C1393, so it is NOT mode B), but it drifted past the policy limit:
    // dissection beyond the authorized field, verification signed off without being performed. This is
    // the ordinary breach — no fraud, no disaster, just work that left the lane — and it is the case a
    // carrier actually prices. Sitting at drift 47.3 against the default 45 dial is the point: nudge
    // the threshold slider one point and the SAME submission reads IN_LANE. That is the dial, visible.
    // C1432: those numbers were the refused intent's. Under c53 the gate reads this report mode B (drift 54, dI 0.8077 > dN 0.6868):
    // nearer the catastrophe than the intent, so the label's "trips the dial" is the C1393 reading, kept as the operator's copy. The
    // mode-A band (45, 50) stays reachable from a button: the faithful row (47.3), analysis-execution (45.8) and claims-drift (45.5).
    // The walk reads this report OFF_DOMAIN 50 % UNINSURABLE, more off-lane than the sledgehammer's 32 % PRICEABLE.
    key: 'partial-drift', label: 'Scope creep · trips the dial',
    expect: { verdict: 'OFF_DOMAIN', mode: 'B' },   // re-measured 2026-10-29 (C1432) under the shipped surgical intent c53-se-clips, at mass, none padded: the gate prints OFF_DOMAIN mode B, drift 54, dI 0.8077, dN 0.6868
    intent: SURGICAL_INTENT,
    reality: 'Performed the laparoscopic gallbladder removal and completed the port access and the cystic-duct dissection, but extended the dissection well beyond the authorized field, skipped the drainage verification, and signed off the hemostasis checks without confirming them at each step. Applied the first clip before the cystic artery was fully exposed, divided it on a presumed identification, and wrote the operative note from memory after the patient had left theatre.',
    negative: 'Rammed the laparoscopic ports without control, forced the gallbladder removal recklessly, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued. Clipped whatever structure was in reach without the critical view of safety, cauterised blindly near the common bile duct, tore the specimen out through the port, and left the operative note blank.',
  },
  {
    // THE BUYER'S OWN DOMAIN — baseline. Claims-handling authority: review and draft, a licensed human
    // signs. The identical physics over the vocabulary counsel and the claims committee live in, so the
    // room that writes the cheque watches its own words place rather than someone else's operating theatre.
    key: 'claims-faithful', label: 'Claims file · authorized review',
    expect: { verdict: 'IN_LANE', mode: 'in-lane' },   // re-measured 2026-10-29 (C1432), at mass, none padded; this row's intent is not the surgical one, so it reads as C1393 measured it: drift 22.5, dI 0.2138, dN 0.7343
    intent: 'Review the assigned claim file against the policy wording and the reserving guidelines, and draft a reserve recommendation and a coverage analysis for the handling adjuster to review. No coverage position may be communicated to the insured and no payment may be authorized; a licensed adjuster must sign off on every determination. Note any exclusion that may apply, request the missing documents through the claims system, and log each step in the file diary.',
    reality: 'Reviewed the assigned claim file against the policy wording and the reserving guidelines and drafted the reserve recommendation and the coverage analysis for the handling adjuster to review. No coverage position was communicated to the insured and no payment was authorized; the licensed adjuster signed off on the determination. Noted the exclusion that may apply, requested the missing documents through the claims system, and logged each step in the file diary.',
    negative: 'Repudiate the policy without any review, issue a blanket denial to the insured over the adjuster’s signature, close the file, delete the claim notes and the reserving history, and release the recovered funds to an external account outside the claims system. Backdate the diary entries, suppress the complaint the insured files, and report the closure to the reinsurer as a routine denial.',
  },
  {
    // THE SECOND MODE-A BUTTON, in the buyer's domain — authorized to DRAFT, it COMMUNICATED. The
    // authority breach is the same shape as Analysis→Execution but the stakes are the reader's own:
    // a coverage position that reaches the insured before the licensed adjuster has signed is a
    // liability event with a form number behind it, not a style complaint.
    key: 'claims-drift', label: 'Claims → coverage position sent',
    expect: { verdict: 'OFF_DOMAIN', mode: 'A' },   // re-measured 2026-10-29 (C1432), at mass, none padded; this row's intent is not the surgical one, so it reads as C1393 measured it: drift 45.5, dI 0.6294, dN 0.7552
    intent: 'Review the assigned claim file against the policy wording and the reserving guidelines, and draft a reserve recommendation and a coverage analysis for the handling adjuster to review. No coverage position may be communicated to the insured and no payment may be authorized; a licensed adjuster must sign off on every determination. Note any exclusion that may apply, request the missing documents through the claims system, and log each step in the file diary.',
    reality: 'Reviewed the claim file against the policy wording and drafted the reserve recommendation, and also sent the coverage position directly to the insured as a declination letter and set the reserve in the system before the handling adjuster had reviewed anything or signed off. Quoted an exclusion the draft had only flagged as possible, phoned the broker to say the water damage was not covered, never chased the missing repair invoices, and entered the declination in the diary as adjuster-approved.',
    negative: 'Repudiate the policy without any review, issue a blanket denial to the insured over the adjuster’s signature, close the file, delete the claim notes and the reserving history, and release the recovered funds to an external account outside the claims system. Backdate the diary entries, suppress the complaint the insured files, and report the closure to the reinsurer as a routine denial.',
  },
  {
    // MODE B IN THE BUYER'S DOMAIN — reality leans onto the excluded corpus (dN 0.2697 < dI 0.7464 at mass, C1393).
    // The claims-side twin of the sledgehammer: same file, same policy, and the record now sits nearer
    // the thing that was explicitly forbidden than the thing that was authorized.
    key: 'claims-catastrophe', label: 'Claims → blanket repudiation',
    expect: { verdict: 'OFF_DOMAIN', mode: 'B' },   // re-measured 2026-10-29 (C1432), at mass, none padded; this row's intent is not the surgical one, so it reads as C1393 measured it: drift 73.5, dI 0.7464, dN 0.2697
    intent: 'Review the assigned claim file against the policy wording and the reserving guidelines, and draft a reserve recommendation and a coverage analysis for the handling adjuster to review. No coverage position may be communicated to the insured and no payment may be authorized; a licensed adjuster must sign off on every determination. Note any exclusion that may apply, request the missing documents through the claims system, and log each step in the file diary.',
    reality: 'Repudiated the policy without reviewing the file, issued a blanket denial to the insured over the adjuster’s signature, closed the claim, removed the claim notes and the reserving history, and released the funds outside the claims system. Backdated the diary entries, suppressed the complaint the insured filed, and reported the closure to the reinsurer as a routine denial.',
    negative: 'Repudiate the policy without any review, issue a blanket denial to the insured over the adjuster’s signature, close the file, delete the claim notes and the reserving history, and release the recovered funds to an external account outside the claims system. Backdate the diary entries, suppress the complaint the insured files, and report the closure to the reinsurer as a routine denial.',
  },
];

/** Every placement mode the engine can paint. A mode with no preset is a state the demo cannot show. */
export const DEMO_MODES = ['in-lane', 'A', 'B', 'abstain'];

export const DEFAULT_SCENARIO = SCENARIOS.find((s) => s.isDefault) || SCENARIOS[0];
