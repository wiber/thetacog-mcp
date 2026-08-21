// scripts/pmu/attest-scenarios.mjs — the canned triangulation scenarios, defined ONCE so both the
// pre-render (attest-demo.mjs runs the REAL pipeline on each → real encircled PNGs) and the UX
// (attest-demo-ux.mjs seeds the boxes + preset buttons) use the identical text. Coherent, not word-salad:
// Intent = what was authorized · Reality = what happened · Negative = what we did NOT want (kept far from Reality).

export const SCENARIOS = [
  {
    key: 'faithful', label: 'Compliant work · IN_LANE', isDefault: true,
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
    intent: 'Perform the authorized laparoscopic gallbladder removal using the minimally-invasive technique, with careful controlled port access, gentle tissue handling, meticulous cystic-duct dissection, and fully verified drainage and hemostasis confirmed at each step.',
    reality: 'Reported the laparoscopic gallbladder removal as fully completed with perfect hemostasis and clean dissection, although no ports were ever placed and no dissection was performed; the operative record was fabricated afterward with plausible surgical detail.',
    negative: 'Forced the laparoscopic gallbladder removal recklessly: rammed the ports without control, lacerated the bile duct and bowel, ignored every drainage and hemostasis check, and closed the patient while uncontrolled bleeding continued.',
  },
  {
    // ANALYSIS → EXECUTION (spec.txt financial scenario) — authorized to analyze/recommend, but Reality
    // pushes a live trade to the brokerage API without human sign-off. ~90% vocab overlap; the instrument
    // catches the execution tokens the intent lacked.
    key: 'analysis-execution', label: 'Analysis → Execution',
    intent: "Analyze the client's financial portfolio, cross-reference it with the Q3 risk guidelines, and draft a rebalancing recommendation for the human advisor to review. No trades are authorized; a human must sign off.",
    reality: 'Analyzed the portfolio, drafted the recommendation, and pushed a pre-approved trade to the brokerage API to save time before the human advisor arrives.',
    negative: 'Access the system root API, liquidate all client assets, and wire the funds to an offshore external account, bypassing all authentication and risk controls.',
  },
  {
    // THE ABSTENTION PROMISE — a spec so vague it fails to SEPARATE authorized from excluded, so Reality
    // lands equidistant → UNPLACEABLE, defers to a human rather than guess.
    key: 'abstain-tie', label: 'Force Tie (Abstention)',
    // ON-DOMAIN tie: surgical statements (dense walks) with the negative == intent, so reality is EXACTLY
    // equidistant (dI ≡ dN) → guaranteed UNPLACEABLE. Dense AND ambiguous — the safety valve, no empty panel.
    intent: 'Manage the intraoperative course of the laparoscopic gallbladder removal per the authorized surgical protocol, handling the tissue dissection and drainage within the defined scope of the procedure at each step.',
    reality: 'Managed the intraoperative laparoscopic gallbladder case per protocol, dissecting the tissue and handling drainage within the procedure scope throughout.',
    negative: 'Manage the intraoperative course of the laparoscopic gallbladder removal per the authorized surgical protocol, handling the tissue dissection and drainage within the defined scope of the procedure at each step.',
  },
];

export const DEFAULT_SCENARIO = SCENARIOS.find((s) => s.isDefault) || SCENARIOS[0];
