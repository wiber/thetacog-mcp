# CATO-POLICY/V1 — Pre-Registration Manifest

**Project:** Topological Stress Test & Derivative Pricing Validation
**Architecture:** ThetaDriven S=P=H (Semantic = Physical = Hardware)
**Objective:** Validate the 144-tile PMU lattice as a **deterministic, priceable underlying asset**
for autonomous-execution options — bound by an Honest Null.

> Sealed hypothesis manifest. Frozen BEFORE the held-out is opened. The seal sidecar
> (`pmu-shape-detection-prereg.seal.json`) hash-pins this document's frozen body, the reef, the
> deployed lens, and the ground-truth held-out. Once sealed, the results are a measurement of
> physics, not a negotiation. Verify: `node scripts/pmu/prereg-seal.mjs docs/research/pmu-shape-detection-prereg.md --verify`.
>
> This is NOT an ML-eval. We are not beating OpenAI on a reasoning benchmark. We are establishing
> the instrument as a **Financial Pricing Oracle**: the underlying for a derivatives market on
> autonomous execution. The reliability properties below are the option's pricing inputs — the
> **Greeks of the competence pixel** — not accuracy scores.

| Option concept       | Instrument property the study must prove |
|----------------------|------------------------------------------|
| The strike           | the **folding-point** — the entropy % at which the bucket flips to ABSTAIN, bounded and knowable |
| No model risk        | **determinism** — same input → bit-identical bucket (already 31/31 bit-exact) |
| The greek (Δ / vol)  | **monotonic** σ decay as semantic integrity drops |
| No false-payout tail | **abstain-before-mint** — it refuses to mint an INSURABLE token it cannot grip |

## 1. The Bounding Fence (Admission Criteria)

The instrument claims **infinite precision on finite lanes**, not universal comprehension. An item
is admitted to the held-out corpus ONLY if it passes the **Conjunction Classifier Gate**:

- **Paraphrase-Invariant:** the logic survives re-encoding regardless of surface vocabulary.
- **Substitution-Sensitive:** a structural meaning-swap fundamentally alters the logic (collapses).
- **Rejection:** items failing the gate are pure-symbol catches or shapeless surface noise —
  classified **un-mappable and excluded from the N-count, NOT counted as failures.**

We publish the fence and validate strictly inside it. This is the "limitless test" used as the
admission gate, precisely so the study is convincing rather than a sandbag.

## 2. The Hypotheses (Pricing the Underlying)

- **H1 — The Actuarial Claim:** within the fence, the instrument outputs deterministic, bounded
  confidence buckets. σ decays monotonically under entropy; folding-points are mathematically
  knowable (sharp, low between-item variance); and catastrophic substitutions trigger **ABSTAIN
  prior to minting**, eliminating false-payout tail risk. The structure-attributable signal,
  **(live reef − dead-reef null)**, is significant on HELD-OUT NOVEL instances.
- **H0 — The Falsification / Null:** decay is non-monotonic, OR the folding-point varies
  within-item / is unbounded, OR the system mints an INSURABLE token on a catastrophic shape-hazard
  (i.e. it is reading lexical overlap, not the fold).

## 3. The Protocol & The 3 Arms

The pipeline executes ~10^6 **localized measurements** (chip cells × corruption steps) across
**N distinct, admitted commits**. Every reported σ is null-subtracted.

- **Arm 1 — Stable Control:** live reef, uncorrupted codebase → establishes the max-σ ceiling.
- **Arm 2 — Prion Stressor:** live reef on incrementally corrupted payloads (and cross-domain
  novel shapes the instrument never trained on) → establishes the decay curve.
- **Arm 3 — Dead-Reef Null:** seed-scrambled reef on identical inputs (same words, scrambled
  meaning) → establishes the noise floor.
  **PILOT FINDING (2026-06-16): the null floor is 4/12, NOT 0** — a shuffled reef still passes
  4/12 on the perturbation probe. Therefore **all reported signal = Arm2 − Arm3, always.**
  Reporting Arm 2 alone overstates by the null floor; this is non-negotiable.

## 4. The Metrics (The "Greeks" of the Competence Pixel)

Financial-stability metrics, not ML accuracy:

1. **Model Risk (Determinism):** within-item variance must equal **exactly 0** (deterministic chip).
2. **Strike Price (Folding-Point Distribution):** the exact entropy % at which the bucket drops
   below threshold and triggers UNDETERMINED. Reported as population mean **± 99.9% CI across
   distinct N items.**
3. **Volatility (Monotonicity):** σ must **strictly decay** as the payload degrades.
4. **Zero-Tail Risk (The Honest Null):** the adversarial false-pass rate on the near-miss set
   (surface ~90% identical to a rupture, fold benign). MUST NOT fire.

**Power — distinct items, NOT repeated runs (the statistician's gate).** Determinism gives zero
within-item measurement variance — a gift. It does **not** license inflating N by re-running a
deterministic computation; that is pseudoreplication and a referee discards it. The unit of
replication is the **distinct semantic item** (a distinct held-out shape / commit); the 10^6 figure
is *measurements*, the p-value comes from the effect across **distinct items**. The chip's speed is
why thousands of distinct items are tractable — not a license for 10^6 repeats of one input.

## 5. The Grader ≠ Producer Firewall

- **Independent Ground Truth:** truth labels (paraphrase vs. substitution, % corruption, shape vs.
  near-miss) are generated by an **isolated, offline oracle / human panel** and hash-pinned to
  `docs/research/pmu-shape-detection-ground-truth.json` (pinned in the seal block below).
- **Blindness, both directions:** the instrument is forbidden from reading the labels; the generator
  is forbidden from reading the instrument's σ output. The instrument never trains/tunes on the
  held-out. It does not grade its own homework.
- This analysis plan is frozen at the seal; deviations are logged as protocol violations.

## 6. Pre-Committed Falsification Criteria (the study FAILS if any holds)

1. **H0 Survival (un-knowable strike):** the 99.9% CI of the folding-point distribution spans the
   entire spectrum — the strike price is un-knowable.
2. **Tail-Risk Violation:** the adversarial false-pass rate exceeds the pre-set actuarial ceiling
   (**> 1%**).
3. **Loss of Grounding:** Dead-Reef (Arm 3) σ **matches or exceeds** Live-Reef (Arm 1) σ — the
   instrument is reading statistical noise, not semantic shape.
4. **THE HONEST-NULL PILLAR (hard, overriding gate):** if the instrument loses its capacity to
   ABSTAIN — mints a confident INSURABLE verdict on a SUSPECT held-out item it cannot grip — the
   study **FAILS regardless of every other metric.** You cannot win by being confident; only by
   being honestly bounded. It is mathematically impossible to "win" while losing the right to be blind.

## 7. End Purpose

The deliverable is not a paper — it is the certification that the confidence bucket is a **priceable
underlying**: a bounded, deterministic, abstain-protected folding-point IS the strike, plus the
no-false-mint guarantee that lets a carrier write **options on "will this agent hold its lane."**
This defines the mathematical bounds of an autonomous agent's **liability**, not its intelligence.
The reliability metrics above are the pricing inputs; this study is their derivation.

## 8. Hash-Pin (the bearer seal of the hypothesis)

- reef (lens lexicon): `data/pmu/reef/reef-144.json`
- lens / deployed seed-lib: `data/pmu/snippet-library-144.json`
- ground-truth held-out (Section 5): `docs/research/pmu-shape-detection-ground-truth.json`
- harness: `scripts/pmu/pmu-study-harness.mjs` (executes the 3 arms against the sealed held-out)
- seal: written below by `scripts/pmu/prereg-seal.mjs` (sha256 + ed25519 over this frozen body).
- Once sealed, the clock starts honest and the harness runs with impunity.

<!-- PREREG-SEAL-BELOW -->

<!-- This block is auto-generated by scripts/pmu/prereg-seal.mjs. Do NOT hand-edit. -->
<!-- It lives BELOW the sentinel and is therefore NOT part of the hashed frozen body. -->

### Bearer seal — `pmu-prereg/v1`

| Field | Value |
|-------|-------|
| sealed_at_note | frozen before held-out opened (no machine clock in scripts — pin via git commit time) |
| manifest_body_sha256 | `62ce8410c9bb01f0f0cab1e9b3d311f489ceeca274a7a6e5e1e880ab84e21b0d` |
| reef_sha256 (`data/pmu/reef/reef-144.json`) | `6545f57f39446e22dffc28d4253eb62f76da785005d06cb1ff12687d5da8ed2b` |
| lens_sha256 (`data/pmu/snippet-library-144.json`) | `6f77c19a7500b64a16b241875e635174201e34dd9948b365465c11f28a29fe97` |
| ground_truth_sha256 (`docs/research/pmu-shape-detection-ground-truth.json`) | `44e6fe78c26749d4c7f979bf674fc6cd8666414bb6d7488d11899697e0ea60ad` |
| pubkey_hex (host identity) | `fc0fb4d5709e3a763c3b794bf8be039fecc8786f78fd1143ff0172553875f139` |
| sig_hex (ed25519) | `bedd09f2433796bb67402867ab4176b1207169752e8cda38ff19481bb7151d842feb528b7dcc0a4ce419a02c9f87007be84d399f09d56d7acf790f3ac71abf07` |
| token sha256 | `ee04774d10e8b551375ba7bd9e29afd0ba4032f9da80a6df736160cd192ddc31` |

> Verify: `node scripts/pmu/prereg-seal.mjs docs/research/pmu-shape-detection-prereg.md --verify`
> A re-seal that changes the body hash means the hypothesis was edited after pre-registration — void.
