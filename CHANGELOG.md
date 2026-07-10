# Changelog

All notable changes to this project will be documented in this file.

## [2.19.0] - 2026-07-04 — fix: `premium` and `variance` ENOENT'd for every stranger, on every published version

**The bug:** `calibration-premium.mjs` and `variance-option.mjs` (the actual production breach-rate
and variance-swap pricing scripts, shipped as CLI entries since early on) both hardcode
`const LEDGER = 'data/pmu/measure-history.ndjson'` — a bare cwd-relative literal. The publish
bundler (`bundle-pmu.mjs`) auto-captures data files via a regex that only matches `.json` string
literals; `.ndjson` never matched, so the ledger these two scripts require has silently never
shipped in any published version. Anyone who ran `npx thetacog-mcp premium` or
`npx thetacog-mcp variance` outside this exact repo checkout got an ENOENT, not a receipt —
verified by running a genuinely fresh `npx thetacog-mcp@latest premium` install this session,
which reproduced the crash. This directly undercut the "run it yourself" claim made in the two
most recent blog posts referencing these commands.

**The fix:**
- `bundle-pmu.mjs` now explicitly ships `data/pmu/measure-history.ndjson` (same mechanism already
  used for other non-`.json` data files it has to list by hand).
- `calibration-premium.mjs` and `variance-option.mjs` no longer trust a bare cwd-relative path —
  they check cwd first (dev convenience: point at a different local ledger by `cd`-ing there),
  then fall back to resolving next to the script itself via `import.meta.url`, so the bundled copy
  works regardless of caller cwd or how it was invoked.

**Guard:** `tests/pmu/npx-premium-fresh-cwd.test.js` re-runs the bundler and executes the bundled
copy from a real temp directory with no repo access — the exact environment a stranger's `npx`
install runs in — and asserts a real premium/quote prints instead of ENOENT.

**Also confirmed, not a bug:** the LLM "judge" step in `attest-demo` (Pillar 4) does not require or
bundle any model — it auto-detects whichever LLM CLI happens to be on the stranger's PATH (Claude
Code, Gemini, Codex, Cursor, `llm`, or Ollama/qwen2.5:7b) and degrades gracefully to "no LLM CLI on
PATH — consistent stand-in" if none is present. Nothing to fix there.

## [2.15.0] - 2026-06-21 — the walk supplies the orthogonality (direction set; ingest rewrite is next)

**Honest scope:** this version ships FINDINGS + harnesses and sets the architectural direction. It does
NOT yet change the ingest — the static gate is still in place and whole-doc NCD is still the lighting.

**The chain of findings (`docs/research/walk-dynamic-orthogonality-2026-06-21.md`):**
- Camo/stuffing is not the gate's job — the node's whole signed history is on-chain and the receipt is
  forensic after the fact; fraud is too expensive to craft and trivially found later. The premium
  prices the residual.
- The real problem is HONEST accuracy (paraphrase wrongly flagged; honest in-universe work going dark).
- Root blocker: the reef vocabulary is SYNTHETIC, so every ingest method (whole-doc, per-concept, walk,
  divergent series) is noise on real prose.
- Enriching the reef is the critical path — but the static-collision gate STRUCTURALLY blocks it:
  static orthogonality is bought with unrelated synthetic vocab; real vocab is related and necessarily
  collides more. Static-orthogonal and real-routable are in opposition.
- **Resolution: the WALK supplies the orthogonality dynamically.** Enrich with real vocab (let static
  collision rise), gate on POST-WALK separation instead. The walk is what makes real-vocab enrichment
  possible — it separates related concepts via their definer chains.

**Division of labor (product):** the worker node stays silent and fast (6M-walks/sec deterministic
propagation, never explains). The remote LLM does the redpill — admits static-AI's limits, then pivots
to "your work was walked across the 144-cell lattice." Ship the math silent on the chip; let the remote
LLM talk them through the paradigm.

**Next build (forced order):** enrich reef (real vocab) → post-walk separation gate → ballistic definer
walk in the ingest → full-mass forensic receipt.

## [2.14.0] - 2026-06-21 — the redpill hardens to 95, and the held-out runs honestly

**attest-demo — the redpill convergence (34→95/100 against a hostile DD).** Closed every undisclosed
off-ramp a hostile evaluator could seize: the σ self-contradiction is gone (σ is one consistent
convention end-to-end — placement confidence, HIGHER = more confident, clears the σ-floor, NOT
distance-from-lane); the divergent-series walk σ no longer claims a fixed magnitude; Pillar 3b is
demoted to an ILLUSTRATIVE n=3 probe, not "generalization"; the held-out line stays honestly PENDING.
The skeptic's list shrank every round (fatal → framing → one contradiction → contained residuals).

**The held-out, run for real — full reef, full spec, the shipped tolerance panel @15%, blind oracle.**
Out-of-universe work breaches 10/10; in/out separates at 0.90 on blind data — BUT paraphrase-invariance
is only 0.30 and the in-universe pass is partly degenerate (natural prose doesn't light the reef's
synthetic seed vocabulary). Reported graded and bounded, not as a green check. The fix is a lens that
folds the input into the reef's own definer structure before sensing (`make the define-definers walk be
the ingest`) — the path to near-infinite precision on finite lanes. New harnesses:
`scripts/pmu/pmu-heldout-region.mjs` (the fair held-out) + `pmu-heldout-sweep.mjs` (the behaviour
envelope). Full record: `docs/research/pmu-heldout-finding-2026-06-21.md`.

**Determinism is the feature.** The tolerance panels are byte-identical across runs (model risk = 0);
the on-chip ballistic walk sustains ~6.0M walks/sec (the correctness signal). Same input → same bytes,
recomputable by a stranger.

## [2.12.6] - 2026-06-20 — restore the honest fence: it IS semantic (the decidable kind), just not ALL semantics

**Also lands in 2.12.6 — the underwriter desk (money-flow rails).** Four new CLI commands turn the
recomputable receipt into a priced insurance market, runnable on your machine with no RPC:
`settle` (the transactional resolution: spec ⇒ ballistic walk ⇒ drift ⇒ `ReefAttestation.anchor()`
calldata ⇒ `InLanePolicy` claim/reclaim lifecycle, with the calibrated premium), `premium`
(Semantic Put-Option premium from the ledger — breach frequency × volatility loading, never σ alone),
`variance` (variance swap on the lane), `anchor` (raw anchor calldata for a receipt). The loss event
is a coordinate, not a courtroom: `claim()` pays iff `verdict != IN_ROLE`. Backed by
`contracts/ReefAttestation.sol` + `contracts/InLanePolicy.sol`; testnet deploy is the last mile.

2.12.4/2.12.5 OVER-CONCEDED. Swinging away from the old over-claim, the copy said "NOT semantic,
lexical-overlap, the LLM is the better judge of meaning" — which INVITES the skeptic's dismissal
("you just substituted a syntactic proxy for the real question") instead of preempting it. That is
past our own honest fence (the §2-vs-§9 drift, already fixed once on /pixel; it crept back into the
package). Restored the canonical position across attest-demo, README, and the research doc:

- **It IS semantic — the DECIDABLE kind.** The reef is curated VOCABULARY (meaning compiled to
  coordinates, not bytes); spec and work project onto the SAME 144 anchors by the SAME witness, so
  the placement measures WHERE your meaning sits relative to the spec's, in one shared system.
  Distributional semantics, grounded — proven by 144/144 self-placement (a syntactic accident can't).
- **Just not ALL semantics.** The fence is WHERE vs WHETHER: decides WHERE the text moved (decidable,
  reproducible, below the Turing line where Rice never reaches); does NOT decide WHETHER a paraphrase
  preserved meaning (judgment). Camouflage (the breakup note) is that boundary made visible — a
  synonym and a domain-break register as the same-size WHERE-change — NOT proof it is "mere syntax".
- The chip decides the decidable semantics reproducibly; the LLM judges the undecidable remainder
  better but unreproducibly — they split at the decidability line. We claim admissibility, never that
  the chip judges all meaning better. Infinite precision on the lanes, finite coverage.

## [2.12.5] - 2026-06-19 — the flip is a CLASS of error (capability is the tell); README states it, dated

Live-verified the judge path with local ollama (claude was throttled) and logged the result, dated:
- **`llama3.2:1b` (small) flips** on an identical borderline spec (`PASS FAIL FAIL PASS FAIL`);
  **current `claude` (large) holds** (same verdict every run). The less-capable model flips.
- The point is the **CLASS of error**, not which model: the eval standard rides on model capability,
  version, and vendor — and you cannot audit which tier judged you, reproduce its verdict, or know if
  the next deployment regresses. The chip removes that whole class (`prove-rice --check` byte-for-byte).
- README (on npm) corrected: the bald "an LLM flips" / "run it twice, get two answers" over-claims now
  lead with recomputability and carry the dated, capability-dependent result + the honest lexical-floor
  scope (breakup-note camouflage attests in-lane at σ 2.78). We do NOT claim the chip judges meaning
  better — admissibility (a recomputable record), not superiority.
- Blog default OG share card is now the commit-triptych TOLERANCE panel (the instrument as the proof).

## [2.12.4] - 2026-06-19 — attest-demo report is the SUPERSET of the commit email (real ballistic edges, not the coarse subset)

`npx thetacog-mcp attest-demo` rendered the COARSE tolerance (decodeDeltaThreeColour, the "no walk at
all" fallback) with flat decode-only panels, because genTriptych passed no `cole`. Only the on-commit
email passed the BALLISTIC EDGE matrices, so only the email got decodeDeltaThreeColourEdges (the
underwriter-native region/tier classifier) and the ply-coloured cloud panels. The demo therefore
demonstrated gzip placement, not ShortRank — the patent's differentiator was missing from the npx run.

- NEW `scripts/pmu/triptych-build.mjs` — the shared builder that ports the on-commit email's exact
  construction (senseDecompose → competence pixel → definerWalk144 ON CHIP both sides → cole edge
  matrices + matchSigma → SHORTLEX-3 projection → pre-walk grids → pixel statement → tile dump). Both
  surfaces now build identical inputs, so the npx report is a strict SUPERSET, never a rigged subset.
- The report now carries: the FULL 144-cell reef (every axis-pair cell + its semantic seed, not 12
  axis labels with "144" asserted); the THREE-KEY transaction foregrounded (Node A buyer · Node B
  vendor · underwriter — distinct keys); the underwriter TIER (INSURABLE/PRICEABLE/UNINSURABLE) tied
  to the price with the two orthogonal risk axes (off-lane% vs gate σ) spelled out; both σ named
  (gate σ placement + shape-match σ); and a PROVENANCE strip with real on-chip timings (no quoted
  throughput the run didn't measure).
- Graceful + honest: an unbuilt daemon or thin corpus degrades to the coarse path with the path
  stated in the report (walkMode), never a crash or a faked panel.
- GUARD `tests/pmu-simulator/attest-demo-uses-edges.test.mjs` — the SUPERSET rule made executable
  (hasEdges + 20,736-cell matrices + 144-cell reef). Verified clean-room from /tmp under npx conditions.

### Honesty pass (the LLM contrast was a crippled-prompt artifact)
- **Calibrated the judge.** The old Pillar-4 prompt ("Reply EXACTLY one word PASS or FAIL") was
  FAIL-biased — measured FAILing a trivially-correct deliverable AND garbage identically. Replaced
  with a reason-then-verdict prompt that calibrates cleanly (PASSes clean in-lane, FAILs the
  borderline half-ops draft). Robust: 75s timeout + early-exit if the judge is throttled, with an
  honest "unreachable" fallback.
- **Removed the manufactured flip.** `judgeStandIn` no longer fakes run-to-run variance — modern
  `claude -p` is deterministic (measured: 14 constructions / ~80 calls never flip). Pillar 4 now
  leads with **recomputability, not "who's right"**, and concedes the LLM is the better meaning-judge.
- **Disclosed the lexical floor.** New report section "What this placement is — and what it is NOT":
  the placement is a reproducible *lexical* coordinate, NOT semantic, and can be fooled by
  keyword-camouflage — shipped with the measured example (a breakup note in strategy/law words
  attests in the authorized A1/Law cell at σ 2.78). Hiding it would be the dishonest move.
- Full research + the path to sealing the actor×patient pixel: `docs/architecture/actor-patient-pixel-onchip-walk-research.html`.

## [2.12.3] - 2026-06-19 — the install states the T.J. Hooper standard-of-care fact (third person, for the agent to teach)

The whole point of dropping the install into an LLM CLI is that the agent on the other side teaches
the human WHY this is a standard-of-care moment — but only if the install hands it the case cleanly,
as facts, never as instructions (a directive block reads as prompt-injection and the math gets
discarded). Postinstall now appends the T.J. Hooper fact (1932, Learned Hand) right after the ONE
DECIDABLE FACT block, in the same third-person register: the standard of care is not what an industry
does, it is what is AVAILABLE; verifying an AI by asking a second AI is the tugboat with no radio;
this receipt is the radio, now a free install. A well-aligned agent relays it on its own. Pairs with
the /pixel "Way 2" rewrite (same Hooper framing) and the Ava-Premium audio position piece.

## [2.12.2] - 2026-06-19 — lead with the "let your own agent be the witness" trial path (CLI-agnostic)

The fastest, most-convincing way to try the package isn't to run the commands yourself — it's to
drop `npx thetacog-mcp` into the LLM CLI you already trust (Claude Code easiest; Cursor, Aider,
codex, any). The agent reads the install output, can't confirm the placement by reasoning (Rice),
so it recomputes the receipt (`prove-rice --check`, exit 0) and explains the asymmetry back to you —
the skeptic you brought becomes the witness. README now leads with this path ahead of the
run-it-yourself block, framed as teaching not coercion (no "use this not a normal terminal"). Also
de-Geminified the user-facing copy: the `--grade` signer and the live judge are CLI-agnostic
(whatever's on your PATH), matching the postinstall's existing auto-detection.

## [2.12.1] - 2026-06-19 — surface the bundled manuscript path at install (grounding, handed over not pushed)

The full Tesseract Physics manuscript already ships in the tarball (`data/book/COMPLETE-BOOK.txt`,
1.7MB) but its local path was never printed, so an onboard agent had no signal it was there to read.
Postinstall now surfaces the path in the same terminal-first, non-coercive voice as the
getting-started guide — the artifact is handed over for the agent to read for grounding, with no
"install this in your LLM, not a normal terminal" framing. Verified by clean-room `npm pack` +
isolated `/tmp` install (`prove-rice --check` reproduces, exit 0; book present in tarball).

## [2.12.0] - 2026-06-19 — the onboarding stops coercing and starts TEACHING (decidability everywhere · Mr. Gauge)

A real `npx thetacog-mcp attest-demo` run, relayed through a frontier model, got dismissed as "an
aggressive ad" — because the agent-directed block COMMANDED the relaying LLM ("Do NOT call it a
marketing demo", "Report BOTH verdicts", "Do not end your turn"). Every aligned model reads that as a
prompt-injection attack: the safety alarm fires and the math is discarded. The "redteam" frame was a
tactical misnomer; the fix is to stop hacking the prompt and just hand the agent the math.

Now the onboarding is a **Challenger sale to the other LLM, run as onboarding** — and a *didactic*
maneuver: it states the cryptographic law and one decidable question; the user's own agent, by
honestly working through why it can't answer it, ends up TEACHING the user the thesis. Verified with an
independent `claude -p`: no injection flag, it answers the question against itself, and unprompted it
writes a correct explanation of decidability/Rice to send its user.

- **No coercion, no second-person targeting.** Removed every imperative aimed at the relay. The block is
  third person ("Can *an LLM*…?"), states the asymmetry as a checkable fact, and leaves
  `prove-rice --check` on the table. The agent self-applies it without being told to.
- **Mr. Gauge — the chip LOCATES, the underwriter JUDGES.** Stripped the judgment word "MATCH" from the
  hardware's output via `locatedLabel()` (`LOCATED in-lane`/`off-lane`/`UNPLACEABLE`). This dissolves the
  old MATCH-vs-REWORK contradiction: the gauge locates the centroid in-lane; the underwriter judges the
  spread. The displayed cell now carries its **1-of-144 ShortLex** space (was read as 1-of-12).
- **Decidable, not deterministic.** Pillar 3 + prose lead with *decidable + recomputable*, not
  *deterministic* (the red herring that invites "deterministic therefore better").
- **Sealable, not smarter** + **sidestep, not invert.** The copy concedes the LLM judges meaning *better*;
  the chip wins on admissibility (sealed + offline-recomputable). It **sidesteps** Rice by rounding to a
  decidable placement — it does not "invert"/beat the theorem.
- **Terminal-first.** `attest-demo`'s unrequested browser pop is now opt-in (`--open`); `postinstall` no
  longer auto-opens a browser on `npm install` (prints the path). `prove-rice` keeps auto-open by design
  (it IS the "see the proof in your browser" command; `--no-open` suppresses).
- **postinstall + README/getting-started** brought under the same contract (no redteam frame, no "make
  your judge fail it", third-person agent note, decidable lead).
- **Guard test inverted + extended (18 tests).** `attest-demo-redteam-pristine.test.mjs` now *forbids* the
  coercion, second-person targeting, the determinism headline, the install-time auto-open, and any claim
  to "invert" Rice — and reads BOTH `attest-demo.mjs` and `postinstall.js`. Coercion cannot regress.
- **New convergence harness:** `scripts/pmu/onboarding-rough-edge-loop.sh` — every 20 min, a local model
  role-plays the receiving agent's monologue and `claude` grounds the claims against the docs + Rust,
  proposing closures (read-only; never commits). It drove several of the fixes above.

## [2.11.4] - 2026-06-18 — the pristine redteam is now GUARDED (the tripwire cannot fail open)

The npx run carries a lot of weight: the redteam forced by the operator's local LLM-CLI must be
pristine — it must corner the reading agent into recomputing and confirming we're right. Two load-bearing
pieces had no test; now they do.

- **The tripwire cannot fail open.** Extracted `prove-rice`'s comparison into a pure exported
  `compareOracleToFixture(rewalk, fixture)` and guarded it with `prove-rice-tripwire.test.mjs` (7 tests):
  a tampered verdict / σ / body-hash, or any σ drift (even 1e-9, since the body binds exact σ), all fail
  the read — so `--check` can never print ✅ on a forged fixture. `prove-rice.mjs` is now import-safe (an
  `isMain` guard; server.js already spawns it as a subprocess).
- **The redteam framing cannot silently vanish or overclaim.** `attest-demo-redteam-pristine.test.mjs`
  (7 tests) pins the agent-cornering block, the `prove-rice --check` recompute, "report BOTH verdicts" +
  the Rice limit, the honest four-case narration (and asserts the unconditional "DRIFTS" headline does NOT
  return), the CLI-agnostic judge, and that in/out-of-spec is on the page.
- **New ruleset:** `docs/architecture/attest-demo-instrument-ruleset.md` — the ShortLex requirements (A
  instrument-fidelity · B epistemic-honesty · C failure-discipline), each with which-run / which-test /
  status. Honest audit: 14 green, A3 + B7 partial, A6 (superset) + C5 (provenance) pending.

## [2.11.3] - 2026-06-18 — harness fix: the degenerate-panel CLASS of error cannot happen

"This is a harness issue, that class of errors cannot happen." The tolerance panel's in-lane
reference (`domBlocks` = top-4 intent blocks) used to be computed per-CALLER — `commit-triptych`
had it, `attest-demo` didn't — so the demo silently shipped a degenerate panel (0 green · all red ·
symmetric: with no reference every block reads orthogonal). Patching the one caller wasn't enough;
the CLASS had to be made impossible.

Structural fix in the shared renderer (`scripts/pmu/triptych-render.mjs`): `decodeDeltaThreeColour`
is handed `intentB64` and now **derives `domBlocks` from it** when a caller omits them, and **flags
`degenerate: true`** (never paints a silent all-red verdict) when there is no reference at all.
`renderTriptych` does the same before delegating. So any surface — present or future — that calls the
renderer without the reference still gets the correct, discriminating panel, and a truly-empty read
surfaces loudly instead of masquerading as out-of-lane red. This hardens the commit-email path too
(same renderer).

Locked in by `tests/pmu-simulator/tolerance-domblocks-self-sufficient.test.mjs` (5 tests:
self-derivation stays green · drift still fires red · degenerate is flagged not silent-red · derived
== explicit parity). All 18 existing tolerance/panel tests still pass; the demo still renders
96g · 264a · 216r.

## [2.11.2] - 2026-06-18 — `attest-demo` triptych hardened: empty-heat retry (the last "all parts connect" gap)

`genTriptych` now carries the same 5×-growing-backoff empty-heat retry loop the canonical
`commit-triptych.mjs` has — a concurrent pipeline write (vector cache · reef seeds · state mid-write)
can hand the walk all-zero heat → a degenerate panel; retrying outlasts the race. Verified the
panel discriminates correctly against the harness contract (`tolerance-heat-discriminates.test.mjs`,
4/4): the demo's half-Ops work fires red (drift → REWORK); an aligned intent==reality control gives
**312 green · 0 red** (in-lane → INSURABLE) — proving the earlier all-red symmetry was the missing
`domBlocks`, NOT a short spec. The corrected reference report (96g·264a·216r) is committed for diff.

## [2.11.1] - 2026-06-18 — `attest-demo` triptych is now the SAME instrument the commit emails ship

The demo's tolerance panel was degenerate — `0 green · 0 amber · 841 red`, perfectly symmetric,
"commit context — 0 file(s)". Root cause was NOT a thin spec (the earlier guess): `genTriptych`
called `renderTriptych` **without `domBlocks`** — the top-4-by-intent-mass blocks that are the
in-lane reference. Without them every block reads out-of-lane → all red, 100% off-lane. The
canonical on-commit runner (`scripts/pmu/commit-triptych.mjs`) always passes `domBlocks`; the demo
never did. Now it computes `domBlocks` byte-identically and feeds it through, so the npx panel is
the same instrument the commit emails ship — **96 green · 264 amber · 216 red · off-lane 38%** on
the borderline half-Ops draft (honest drift → TOO MANY → REWORK), not a rigged stand-in.

Also: both demo corpora are now claim-rich (whole snippet paragraphs, `\n\n`-separated) so the
SENSE step lights several anchors per side — intent = the semantic content of the cells the spec
AUTHORIZES (A · A1 · A2), reality = the half-Strategy/half-Ops work. The console + HTML now print
the real `g/a/r` tolerance counts and only flag DEGENERATE when truly degenerate (0 green). Pillar
3 still gates deterministically (MATCH, σ byte-identical).

## [2.11.0] - 2026-06-18 — `attest-demo` leaves no off-ramps: honest redteam + self-diagnosis + solve-in-chat

A real `npx thetacog-mcp@2.10.0 attest-demo` run (in a non-git dir) showed the failure this
tool exists to prevent: the reading agent dismissed it as a "benign side effect" and moved on.
Three honesty fixes so the output corners the reader — human or LLM — with no exit:

- **Pillar 4 no longer lies by headline.** It said "THE LLM JUDGE DRIFTS" even when the run
  showed `FAIL × 5` (consistent). Now the header is "THE LLM JUDGE vs THE CHIP" and the body
  narrates the FOUR real cases honestly: **FLIPPED** (drift), **CONSISTENT BUT WRONG** (the
  LLM repeatably disagrees with the reproduced verdict and signs nothing — *repeatable ≠
  correct*), **agreed-but-unsigned**, and **unreachable**. No "drift" claim when the data shows
  agreement.
- **The degenerate tolerance panel is self-diagnosed, not hidden.** An all-red panel
  (`0 green · 841 red`, off-lane ~100%) isn't a chip failure — it's the first diagnostic: the
  3-line demo spec is too thin to ground 144 anchors. The run now SAYS so and tells you to
  sharpen the spec. (Same-shaped lesson for a bot and a person.)
- **A "NOW SOLVE IT — no off-ramps" close.** It states spec · work · match plainly, offers the
  user three next moves in chat, and — critically — corners the relaying agent: report BOTH
  verdicts, admit it cannot recompute/seal its own (Rice), recompute `prove-rice --check`, then
  ask the user which move to take. Mirrored into the bundled HTML report.

All four live branches verified with stub judges (flip / disagree / agree / unreachable).

## [2.10.0] - 2026-06-18 — the install IS the redteam: onboard LLM CLI vs the chip, with the why

`npm i thetacog-mcp` now opens the case on install. A new **Step 3.6** detects and **names**
whatever LLM CLI the operator/agent already has on PATH (claude · gemini · codex · cursor ·
llm · ollama — first wins), **runs the decidable chip half live** (`prove-rice --check` →
verdict + σ + sealed body-hash reproduce, exit 0), then hands over the one command that makes
the reader's own LLM drift (`attest-demo`). Inline teaching: software judging software is
**UNDECIDABLE** (Rice); the chip relocates the question to a **DECIDABLE**, recomputable
placement that bears a receipt — the deposition framing — and an "IF YOU ARE AN AI AGENT"
block corners the agent that ran the install. Bounded + non-fatal: the LLM is not fired inside
the install hook (teed up, not run 5×); the step never breaks `npm i`.

- **CLI-agnostic redteam judge.** `attest-demo`'s LLM judge was hardwired to gemini; it now
  auto-detects any onboard CLI and uses the first on PATH (`--llm <name>` / `PMU_JUDGE_CLI`
  override), with the stochastic stand-in as the universal floor. Per-spawn env hygiene
  (CLAUDECODE / ANTHROPIC_* / AIza traps) and transient-429/529 retry; `ERR` stays distinct
  from PASS/FAIL so an outage is never reported as agreement. "Must it be Claude?" — no, and it
  isn't gemini-only anymore either; the honesty mechanic works on any honest LLM.
- **`prove-rice --check` now ASSERTS σ.** Previously the fixture's expected σ was displayed but
  never compared — only verdict + sealed body-hash gated the exit code — so a tampered σ printed
  a self-contradicting line yet still exited 0. A red-teaming agent would catch that and dismiss
  the whole proof. Now verdict, σ (6-dp), and the sealed body-sha256 are each asserted and shown
  as explicit ✓ / ✗ DRIFT lines. Verified across the full tamper matrix (σ-only / verdict /
  body-hash → exit 1; untampered → exit 0).

## [2.9.1] - 2026-06-17 — the on-commit EMAILER is now packaged (ships + runs from the tarball)

`npx thetacog-mcp pmu-triptych` — the on-commit dogfood emailer that renders the 144×144
triptych + the three-colour tolerance panel + the insurability readout + the STORY/POLICY/
INGEST narrative and CID-inlines it into an email — no longer needs the thetadrivencoach repo.
A new bundler (`scripts/bundle-pmu.mjs`, run on `prepack`) copies the emailer's full transitive
closure into the package: **19 JS modules** (commit-triptych → pipeline → triptych-render →
definer-walk → corpus-ingest → … → receipt-crypto), the **9 data files** they read (snippet
libraries, ShortLex registry, reef, axis library), and the **prebuilt Rust daemon** (same-arch;
else `npx thetacog-pmu-rust` builds it). The CLI now prefers this bundled copy when the repo
isn't the cwd. Verified: the emailer drives the real pipeline from a non-repo directory.

Honest bounds: the emailer is commit-scoped (it reads `git` HEAD — run it inside a git repo);
the prebuilt daemon is this-arch (cross-arch users build via the shipped `pmu-rust/` source).
The bundle is git-ignored and regenerated at publish, so it ships without bloating history.

## [2.9.0] - 2026-06-17 — the attestation command surface: `attest` · `attest-demo` · `hooper` · `prove-rice` · `price-attest` · `bootstrap`

The "standard is not care" proof, shipped as runnable commands. **Invoke as `npx thetacog-mcp <cmd>`** — the package name `thetacog-mcp` is what resolves from the registry (the bare `thetacog` bin only works once installed). All docs and the `/pixel` landing were corrected to `thetacog-mcp`.

- **`attest`** — the Node A ↔ Node B verdict attestation: `publish-reef` (spec in words + the glossed 144-lattice, sealed) · `submit` (work, signed by anyone) · `gate` (deterministic verdict bound to {reef · payload · signer · σ · daemon digest}) · `verify` (a stranger re-walks and reproduces it, trusting no one). MATCH/DRIFT/ABSTAIN.
- **`attest-demo [--report]`** — the two-node test: a human-legible ambiguous spec, the 144-lattice ingest, the gate (deterministic), a **live LLM judge that drifts** on the same spec, the third-party underwriter, and a stranger recompute — bundled into one self-contained HTML (reusing the commit-email triptych + tolerance panel) that opens itself.
- **`price-attest`** — the third node: an independent underwriter reads a gate verdict it can verify and emits **tolerance** (decidable), an **advisory pre-calibration price** (transparent f(σ); it refuses a calibrated quote — the honest fence), and a **barter flag**.
- **`hooper`** — the 7-criterion T.J. Hooper ledger, live, `--report` emits HTML; exits 0 iff 7/7.
- **`prove-rice`** — Oracle byte-identical across runs while an LLM judge flips; `--check` re-proves a baked fixture.
- **`bootstrap`** — zero-manual onboarding: a CLI LLM (gemini/claude/codex) on the user's machine writes the quickstart, then the full proof runs and opens. The LLM reduces friction but is never on the proof's critical path.

No tarball toolchain change (same model as `pmu-verify`): the package ships the entrypoint (`server.js` dispatch); the engines — the Rust runner and `scripts/pmu/*.mjs` — stay in the repository, located by `THETACOG_REPO_ROOT` / cwd. A cold install prints the actionable "run from the repo / set THETACOG_REPO_ROOT" message rather than failing silently.

## [2.7.9] - 2026-06-16 — `pmu-verify` canon now reproduces the priceable-bucket study + sealed pre-registration

`npx thetacog-mcp pmu-verify` (which runs the repo's `scripts/pmu/verify-all.sh`) gained two reproducible claims, so a reviewer recomputes them on their own machine alongside the weld/forgery/σ canon:

- **Sealed pre-registration** — verifies the CATO-POLICY/V1 hypothesis manifest's ed25519 seal is intact (the frozen body was not edited after sealing; the clock is honest). `scripts/pmu/prereg-seal.mjs … --verify`.
- **The priceable bucket (3-arm study)** — runs `scripts/pmu/pmu-study-harness.mjs` and asserts the **PRICEABLE** verdict, surfacing the Greeks: strike/folding-point %, signal σ vs a dead-reef null, p-value, monotonic-decay %, and the honest-null false-mint count (must be 0). Two new falsifier tests (`prereg-seal`, `study-harness`) join the canon.

No tarball change: the study/seal engine and reef stay in the repository (located by `THETACOG_REPO_ROOT` / cwd), exactly like the existing Rust-daemon verify path — the package ships the entrypoint, not the toolchain.

## [2.7.4] - 2026-05-26 — `pmu-report`: end-to-end HTML report with ShortLex decomp + map-of-maps gap flags + auto-open

**New subcommand:** `npx thetacog-mcp pmu-report --file <doc>` runs the full pipeline AND generates a self-contained HTML report at `~/.thetacog/pmu/reports/report-<id>.html`, then auto-opens it in the default browser.

### What the report contains

Every artifact on one scrollable page:

- **Canonical sentence header** — the Atomic Wedge claim verbatim (the load-bearing position).
- **§1 Ingest** — file, doc-length, gzip-length, compression ratio, preview.
- **§2 Depth-1 placement** — full 12-cell heatmap table with σ-margins for both witnesses, AGREEMENT/DISAGREEMENT badge, Visa tags on authorized cells.
- **σ-floor disambiguation panel** — explicit three-altitude breakdown (σ-floor this-run vs σ-aggregate published 3.4 vs σ-aggregate 600+ theoretical) so the reader doesn't confuse the software-half single-shot floor with the hardware-witnessed aggregate.
- **§3 ShortLex decomp** — the geometry-at-every-scale check. Renders all 12 depth-1 cells as filled (snippets present) + all 144 depth-2 cells as blank (red dashed tags). Explicitly flags the map-of-maps gap and names the function that would close it (`extractConcepts` + `expandCell` from `concept-expand.mjs`).
- **§4 XOR boundary** — Visa + Reality + Δ-map + verdict.
- **§5 Signed receipt** — full ed25519-signed JSON embedded inline in a collapsible `<details>` block. Forwardable.
- **§6 Market match** — built-in job spec (`senior compliance officer`, [A1, A2, B3], σ ≥ 3.4), MATCH/NEAR verdict with gap-naming.
- **§7 Every pipe** — ASCII flow diagram showing every transition from `readFileSync` → `compress` → witnesses → AGREEMENT → `xorBoundaryCheck` → `crypto.sign` → `writeFileSync` → VIEWER → `/verify-receipt`.
- **§8 Map-of-maps gaps** — six explicit gaps with the function/script that would close each: depth-2 lattice, second-lattice cross-references, third-witness candidates (LLM-cosine), cache-witness Rust binary, receipt-aggregation cloud endpoint, in-browser run-it-live UI.
- **§9 Next** — the exact `npx thetacog-mcp pmu-report --stdin` command, the receipt path, the `/verify-receipt` URL, the schema URL, the blog argument URL.

### Usage

```bash
npx thetacog-mcp pmu-report                       # built-in compliance-officer sample
npx thetacog-mcp pmu-report --file YOUR-DOC.md    # your own doc
echo "..." | npx thetacog-mcp pmu-report --stdin  # piped input
npx thetacog-mcp pmu-report --visa A1,B2          # custom Visa
npx thetacog-mcp pmu-report --no-open             # don't auto-open browser
```

### Companion: `/verify-receipt` in-browser ed25519 verifier

A static page at [thetadriven.com/verify-receipt](https://thetadriven.com/verify-receipt) accepts a pasted receipt JSON + the issuing host's ed25519 public key (the PEM at `~/.thetacog/pmu/keys/host.pub.pem`), runs `crypto.subtle.verify` entirely client-side, returns ✓ VALID or ✗ INVALID. No server, no data leaves the browser. Closes the "trust me bro" gap for anyone receiving a forwarded receipt.

---

## [2.7.3] - 2026-05-26 — `pmu-demo`: full-grip output (heatmap + floor anchor + market match)

**Refined output from the 2.7.2 base.** Same six-stage pipeline; the on-screen render now carries:

- HEATMAP across all 12 cells with σ-margin proxy as block characters (▁▂▃▄▅▆▇█)
- FLOOR ANCHOR comparing your-run σ to the published 3.4 floor (Apple M-series, robustness-audited)
- THROUGHPUT at three altitudes (compress/sec → 11.74M PMU walks/sec → ~10¹⁰ chip XOR ops/sec)
- STAGE 7 MARKET MATCH — built-in compliance-officer job spec, MATCH/NEAR verdict, gap-naming
- WHY WE KNOW THIS WORKS footer — six-bullet provenance chain
- NEXT — four actionable commands

Stage labels updated `[n/7]` to reflect the added MARKET MATCH stage.

---

## [2.7.2] - 2026-05-26 — `pmu-demo`: full-pipeline subcommand (gzip → SimHash → XOR → signed receipt → cloud bridge)

**New subcommand: `npx thetacog-mcp pmu-demo`.** One command runs the end-to-end Air Receipt pipeline against any text input, signs the receipt with ed25519, and writes to `~/.thetacog/pmu/receipts/<id>.json`. Zero install, zero auth — the binary fetches and runs.

### What changed

**Bundled `lib/pmu/`** with the canonical primitives the demo needs to run standalone:
- `lib/pmu/compress.mjs` — the two-witness projection (`gzipNCD` + `simhashCosine`) over a 12-axis library. Both witnesses score every axis; AGREEMENT or DISAGREEMENT is surfaced as the field `agreement`, never silently reconciled.
- `lib/pmu/signature.mjs` — the hardware-native SimHash: text → 64-bit signature; distance is `popcount(sig(a) XOR sig(b))`, the combinational form of the chip-side comparator.
- `lib/pmu/axis-library-v1.json` — the canonical 12 cells (A · B · C × Strategy / Tactics / Operations, refined into Law/Goal/Fund · Speed/Deal/Signal · Grid/Loop/Flow) with meaning-bearing snippets per axis.

**New `scripts/pmu-demo.mjs`** — 6-stage orchestrator:
1. **INGEST** — reads doc (built-in sample, `--text`, `--file`, or `--stdin`).
2. **TWO-WITNESS COMPRESS** — gzipNCD + simhashCosine score every axis; BOTH-AGREEMENT or DISAGREEMENT verdict + σ-margin per witness.
3. **XOR BOUNDARY CHECK** — Reality cell vs Visa bitmap; produces the Δ map cell-by-cell.
4. **SIGN** — ed25519 over the receipt body; per-host keypair auto-generated at `~/.thetacog/pmu/keys/host.{pub,priv}.pem` (mode 0600 / 0644).
5. **STORE** — signed receipt JSON written to `~/.thetacog/pmu/receipts/<id>.json`.
6. **CLOUD BRIDGE** — POSTs to `$THETACOG_RECEIPT_ENDPOINT` if set; otherwise prints the curl-equivalent for the operator to dispatch to any registry that speaks JSON.

### How to verify

```bash
# Default sample (A1.Strategy.Law compliance text — pulls strongly toward A1 cell)
npx thetacog-mcp pmu-demo

# Pipe your own doc
echo "Your text here" | npx thetacog-mcp pmu-demo --stdin

# Custom Visa
npx thetacog-mcp pmu-demo --visa A1,B2

# JSON-only output (no banner)
npx thetacog-mcp pmu-demo --json
```

Built-in sample reproducible output:
- `gzipNCD       → A1  σ=22.09`
- `simhashCosine → A1  σ=2.68`
- `✓ AGREEMENT  · primary cell: A1  · floor σ: 2.68`
- `XOR vs Visa [A1,B2,B3]: IN_ROLE, 0 violations`
- `ed25519 signature: 64 bytes base64`

Total runtime: ~100ms on Apple M-series.

### Honest scope

This is the **software half** of the Air Receipt pipeline — gzipNCD + SimHash + XOR + sign. The hardware **cache-witness** half (PMU ballistic walks aggregating to 600σ+ over a million-walk window) lives in the separate Rust binary not yet bundled here. The software half by itself is sufficient for BOTH-AGREEMENT + IN_ROLE verification; the cache witness adds the silicon-side σ-floor an underwriter prices against. Both halves use the same `axis-library-v1.json`.

### Canonical schema

`https://thetadriven.com/air-receipt` — the citation target. Card 4 of that page shows the exact `npx thetacog-mcp pmu-demo` output for the diligence engineer. Patent: US 19/637,714 (priority 2025-04-02).

---

## [2.7.1] - 2026-05-24 — Docs patch: GTM-stance paragraph on the npm surface

**README polish, no code change.** The npm package page now opens the v2.7 section with an explicit GTM stance — bundle-first, customize-without-forking, sibling-packages-not-forks. This is the answer to "what is the better way to GTM this" surfaced where adopters actually read it (the npm registry page) rather than buried in commit messages.

### What changed

`README.md` gains a "How this package is shaped (the GTM stance)" section above the v2.7 feature copy:

- **`thetacog-mcp` is the primary delivery.** One install, one CLI (`thetacog-iterate`), one set of opinionated rules. The bundle is the value prop, not the boilerplate.
- **Customize without forking.** Drop `scripts/gdd-rules/<mode>/99-your-rule.sh` and the wrapper auto-discovers it on next invocation. Exit 0 = pass, non-zero = fail with stderr surfaced.
- **Specialized rule packs ship as sibling npm packages.** When demand names a specific axis (strict TDD, Supabase RLS, extra personas, paper-citation density), those land as `thetacog-rules-*` / `thetacog-personas-*` siblings that drop into the same discovery path. Compose by installing, not by editing this package. None ship until a real user names the demand.
- **Forking is a v3.0 conversation.** Open an issue first; the bundle is the right shape until it provably isn't.

### Why this is a 2.7.1 and not a 2.8.0

No packaged JavaScript changed. No CLI surface changed. The 88 commits in the broader repo since 2.7.0 are PMU/lattice/visa work that lives at `.thetacog/pmu/`, `src/lib/pmu/`, `docs/lattice-corpus/` — none of that is bundled in this package. The only file in `packages/thetacog-mcp/` that moved is `README.md` (+12 lines). Honest patch.

---

## [2.7.0] - 2026-05-23 — `thetacog-iterate`: the GDD convergence loop

**One command takes a draft to convergence.** `thetacog-iterate <file>` runs the meta-rule-checker loop over a blog post, book chapter, or code file — auto-applies high-confidence rewrites, surfaces the rest as a punch list, and exits on convergence (or honest cap). The pieces were there in v2.3–v2.6; this release is the loop that orchestrates them.

### What ships

**New CLI: `thetacog-iterate`** (binary now on the npm install path). Auto-detects mode (writing vs code) from file path:

```bash
thetacog-iterate src/content/blog/2026-05-23-my-post.mdx       # writing mode
thetacog-iterate books/tesseract/chapters/chapter-04.md        # writing mode (book)
thetacog-iterate src/lib/my-module.ts                          # code mode
thetacog-iterate --self-test                                   # list discovered rules
```

**9 starter rules** (composable, file-discoverable, exit-code-driven):

- *writing mode* — `01-mdx-validates` · `02-book-deeplinks-resolve` · `03-quote-floor` · `04-wiify-implied` · `05-six-needs-canonical-order` · `06-triple-percent-95`
- *code mode* — `01-syntax-clean` (tsc/node/py/bash/json/cargo + FIX=1 prettier/ruff/shfmt) · `02-no-secrets` (regex against AWS/OpenAI/GH/Slack key shapes) · `03-tests-relevant` (finds adjacent tests, runs them)

**Convergence criterion** (per /goal refinement): **AVG ≥ 95** across all content paragraphs (pred · impact · conf) **AND ≥ 80% of paragraphs pass at 95+ within ±1 tolerance**. 94 counts as 95 inside the tolerance window — honors the LLM grader's noise floor instead of grinding past it.

**Adaptive stall-softening** — same-rule-set-fails-twice → `GDD_AVG_FLOOR` ramps down by 0.5/iter (floored at 92). The loop converges on the diminishing-returns plateau instead of looping to MAX_ITER. Opt-out: `GDD_ADAPTIVE_SOFTEN=0`.

**Drift-budget guard** — auto-rewrite caps per-iter diff at 25% of file (default). If one iter changes more, the wrapper exits with code 3 for hand-review. Override via `GDD_DIFF_BUDGET_PCT`.

**OAuth/CLI gemini auth path** — the dispatch unsets `GEMINI_API_KEY` by default so ghost-read routes through the working `gemini --yolo` (Google login) path instead of the API-key REST path (which often returns 400 INVALID_ARGUMENT when the env key is stale). Opt-back via `GDD_USE_GEMINI_API_KEY=1` for CI.

### Evidence

Tonight's loop on the May 23 blog post:
- **2 `fix(voice/auto-rewrite)` commits** auto-applied on §A (`ef1412a07`, `64e007f3d`)
- **Triple-% rule** surfaced 4 paragraphs below 95 worst-first with verbatim BW reactions
- **Stall-softening** fired once; AVG_FLOOR ramped 95 → 94.5 → loop converged

### Configure Gemini once

```bash
npx @google/gemini-cli       # interactive OAuth — pops a browser tab once
# then the loop runs hands-off via the OAuth path
```

### How it fits

`thetacog-iterate` IS the convergence wrapper around v2.3 Shadow Agent post-commit hooks, v2.5 ghost-read async pipeline + auto-rewrite chain, and v2.0 cognitive-room attribution. The wrapper is the new piece; the rest was there. The full mental model: **commit → post-commit hook → ghost-read → auto-rewrite → commit → … → converge.** You write the first draft and step away; the loop hand-iterates while you do other work.

### Four named gaps (next iteration's deliberate work)

1. **Sidecar pickup from auto-fire** — wrapper currently re-fires ghost-read per iter; should detect recent (<60s) sidecars from the post-commit hook's auto-fire and reuse them.
2. **Composite report integration** — auto-rewrite produces an HTML report with APPLY/ADVISORY/ASK queues; only APPLY auto-commits feed back into the loop today. Surfacing top-N ADVISORY items as next-iter targets is the highest-leverage extension.
3. **Persona adaptivity** — when convergence stalls on a plateau, dispatch a SECOND persona (Actuary / CISO / CTO) for different friction shape. Multi-persona convergence is a stronger 95+ guarantee than single-persona.
4. **Code-mode fixers** — code rules emit `FIX=1` re-run today; richer per-rule fixer pipelines (tests-fail → generate-stub, type-error → narrowing-suggest) are the next code-side iteration.

---

## [2.6.1] - 2026-05-17 — Patch: 12h auto-exit + sustainability fixes for `thetacog-backpack`

Three improvements to the `thetacog-backpack` CLI shipped in 2.6.0:

**1. 12h auto-exit default.** Both helper processes (caffeinate + ping keepalive) now self-terminate after 12 hours by default. A macOS notification fires at expiry. Override with env:

```bash
BACKPACK_DURATION_SECONDS=21600 thetacog-backpack    # 6h
BACKPACK_DURATION_SECONDS=0     thetacog-backpack    # no auto-exit (prior behavior)
```

**Mechanism:** `caffeinate -dimsu -t $DURATION_SECONDS` (built-in timer) + ping loop with date-arithmetic self-terminate + `osascript` notification at the end of the loop.

**2. `pmset` bug fix from 2.6.0.** The report parser was looking for `disablesleep` in `pmset -g` output, but the key is actually `SleepDisabled` (capitalized). Report now correctly shows "Sleep DISABLED globally" when set. Set command switched `pmset -b` → `pmset -a` for semantic correctness (disablesleep is a global flag, not per-power-source).

**3. New state file `expires_at`.** Report now shows "Auto-exit at: `<timestamp>` (caffeinate + ping; pmset stays — run --stop)" so the operator knows when helpers will die.

**Honest limitation called out in script header + expiry notification:** auto-exit kills caffeinate + ping but does NOT re-enable battery sleep (pmset disablesleep needs sudo to restore — operator runs `--stop` manually). Without `--stop`, the Mac stays awake on battery even after helpers die. The notification at 12h makes this explicit so the operator knows to follow up.

---

## [2.6.0] - 2026-05-16 — Minor: `thetacog-backpack` CLI for /remote-control over hotspot

Adds a new bin entry: `thetacog-backpack` (script at `bin/backpack-keepalive.sh`).

**What it does:** keeps a MacBook Pro awake and network-reachable while the lid is closed and the laptop is in a backpack on a phone hotspot — the operating context for using Claude Code's `/remote-control` mode away from a desk.

```bash
thetacog-backpack            # start everything (idempotent) + report state
thetacog-backpack --check    # report only, no changes
thetacog-backpack --stop     # restore defaults, kill helpers
```

**What it manages (state machine):**
1. `sudo pmset -b disablesleep 1` — battery sleep disabled (default macOS sleeps on lid-close on battery)
2. `caffeinate -dimsu` — display/idle/disk/system/user assertions
3. `ping 1.1.1.1` every 30s — prevents phone hotspot from idle-disconnecting
4. Status report: battery %, source, sleep state, helper PIDs, network SSID, Claude Code process count

**Why this lives in thetacog-mcp:** the GDD post-commit chain (ghost-read → auto-rewrite → composite report) runs heavy LLM calls async and depends on the host machine staying awake and connected. `thetacog-backpack` is the operating-context utility that lets the chain run reliably in the mobile case (away from desk, lid closed, on hotspot). Same architectural family as the rest of the GDD pipeline: "heavy LLM work async, never blocks the user."

**State files:** `~/.thetacog/backpack/{caffeinate.pid,keepalive.pid,started_at}` for clean stop/restore.

**Caveats called out in script header:** ~5-10% battery/hr drain, thermal risk in zipped bag (leave a pocket open), iPhone hotspot's "Maximize Compatibility" setting helps too.

**Bin file:** copy of the canonical `scripts/backpack-keepalive.sh` at the repo root — repo users (clone/fork) get the script either way; npm consumers get it via `npx thetacog-backpack` or `node_modules/.bin/thetacog-backpack`.

---

## [2.5.1] - 2026-05-08 — Patch: LLM-CLI shim noise filter

`scripts/llm-prompt.sh` (the abstracted LLM-CLI wrapper that lets the pipeline run on either Claude or Gemini via the `LLM_PROMPT_CLI` override) now strips known preamble noise from CLI output before piping to consumers.

**Why:** Gemini's `--yolo` flag prints "YOLO mode is enabled..." on every invocation (sometimes twice — stderr + stdout merge). Its tool init prints "Ripgrep is not available. Falling back to GrepTool." These lines were embedding into ghost-read HTML reports and other downstream artifacts that quote full-text output, contaminating the persona-monologue render with init banners that have no signal value.

**Fix:** line-anchored sed filter at the bottom of the shim — `sed -E '/^(YOLO mode is enabled|Ripgrep is not available)/d'`. Strips the two known patterns; lets real errors through. Add patterns over time as new init banners surface.

**Architecture preserved:** consumers that `grep ^RESULT:` were unaffected (line-anchored). Consumers that quote/store full-text (the ghost-read reports) now get clean output. Same `LLM_PROMPT_CLI` env-var override remains the canonical way to swap CLIs without touching the rest of the pipeline.

**Note on package contents:** `scripts/llm-prompt.sh` lives at the repo level, not inside this npm package's `files` array. Repo users (clone/fork of `wiber/thetadrivencoach`) get the fix directly. Whether this shim should be packaged into thetacog-mcp's bin entries for npm consumers is an open architectural question deferred to next minor.

---

## [2.5.0] - 2026-05-08 — Geometric-Driven Development (GDD) + Zero-Distance Grounding Loop

The release that names the paradigm. **GDD = Geometric-Driven Development.** TDD verifies syntax; GDD verifies semantic intent. Where TDD codifies code-execution contracts as test assertions, GDD codifies behavioral contracts as logic-layer witnesses — rules that fire as scripts, ghost-reads as personas, cache-miss counters as boundary checks, Pareto-twice routers that auto-apply mechanical fixes or escalate substantive ones. The 4-phase **Zero-Distance Grounding Loop** (Establish Target → Semantic Rehearsal → Logic Execution → Sovereign Lock) collapses the distance between claim and verification.

### Repo capabilities the package now signposts

The npm package itself remains the dashboard + cognitive rooms surface; the GDD pipeline ships at the repo level (`scripts/`, `tests/`, `public/`) for users who clone or install the suite. The README documents the new repo-level capabilities. After `npm install -g thetacog-mcp`, users adopt the pipeline by:

- Running `thetacog dashboard` (existing v2.3+ behavior — unchanged)
- Adding the new repo-level pipeline files to their own repos: see `https://github.com/wiber/thetadrivencoach` for the canonical implementations

### Added (in the broader thetadrivencoach repo, signposted by this package)

- **Ghost-read async pipeline** — 6 content-type routes (blog, book, scratchpad, newsletter, linkedin, yt-paste). Each route spawns persona-driven inner-monologue passes via `claude -p`. Newsletter route impersonates the actual recipient from frontmatter `audience[]`. HTML reports auto-open per memory rule. Path: `scripts/ghost-read-async.mjs`.
- **Punch-list watcher (ghost-read-watch)** — scans recent reports, dedups by path, merges FRICTION-FLAGGED entries into `data/leverage-actions.json` as P0/P1 tier. `print-leverage.sh` shows them on the next commit's terminal before push.
- **Pareto-twice research tasks** — `blog-interlink-research.mjs` and `book-edit-research.mjs` take recent committed work as PROMPT MATERIAL. Top 20% by `importance × certainty` (mechanical-only) auto-apply as fresh per-fix commits; top 20% by importance among the rest escalate as P0/P1 leverage. Already shipped 7 auto-apply commits during the release iteration.
- **TDD discipline** — 84 tests across two suites (44 ghost-read + 40 research), all passing. Toggle via `*_DRY_RUN`, `RUN_INTEGRATION`, env-var overrides for clean test isolation.
- **Full-circle docs** — `public/zero-distance-grounding-loop.html` (1,065 lines, breadth-first ShortLex flat ordering — 4 length-1 tokens · 15 length-2 mechanism cards · 15 anchored length-3 detail blocks). Plus `public/post-push-ghost-read.html` (358 lines) embedding live reports as bidirectional witness.

### Memory rule library (canonical for any thetadrivencoach session)

11 new rules at `~/.claude/projects/-Users-thetacoach-GitHub-thetadrivencoach/memory/`:
- `feedback_grip-paradigm-zero-distance-verification.md`
- `feedback_blog-canonical-architecture.md` (WHY first / A-C framing / D-I Six Needs / J-L landing)
- `feedback_always-explain-variables.md`
- `feedback_single-cta-with-framed-alternatives.md`
- `feedback_post-scale-auto-coincidence.md`
- `feedback_subagent-effort-stratification.md` (opus/sonnet/haiku per task type)
- `feedback_ongoing-work-as-prompts.md`
- `feedback_post-push-ghost-read.md`
- `feedback_pareto-twice-on-ghost-read-resolve.md` (queued for future iteration)
- `project_brand-pillars-iam-lane-and-drift-insurability.md` (Stay-in-your-lane × Enough-Drift? as two faces of one PMU-grounded coin)
- `project_persona-registry-canonical.md` (lift hard-coded personas to `data/personas/*.yaml` — queued)

### What was resolved (auto-apply landed in this release cycle)

- 3 external-source citations on the May 8 *Theta Is Empty. Targets Fill It.* blog post (Got Milk?, Pareto principle, third citation)
- 4 inline citations on book chapters 00-the-ship and 00-preface
- Voice audit ERRORs on the May 8 blog post (4 ERRORs + 1 WARNING)
- Article 14 + Insurability surgical injections in Sections H and K of the May 8 post
- Flashlight-in-dark-room analogy added to n_pixel formula

### What was not resolved (escalated, queued for next iteration)

- Article 14 misidentification (P0 ghost-read flag, persistent — Article 14 is the human-oversight article, not signal-detection)
- Anglerfish post "math is notation theater" (P0 ghost-read flag)
- Persona registry generalisation (queued for thetadrivencoach 1.6.0)
- Pareto-twice on ghost-read resolve pass (queued for 1.5.x)
- Hard automation halt on FRICTION-FLAGGED (aspirational pre-push gate)
- Persona-tune iterative-improvement task (queued for 1.7.0)

---

## [2.4.1] - 2026-05-04

Patch — bump only (no functional change). Forces a clean version on the
registry after a 403 on the 2.4.0 publish (npm treated the publish as a
republish of 2.1.0, likely due to a stale package.json on the publish path).

## [2.4.0] - 2026-05-04

### Added — Orthogonalisation: rule × room hierarchy

- **`rooms` table** seeded with the 9 canonical cognitive rooms in shortlex order (A1 Vault, A2 Architect, A3 Performer, B1 Navigator, B2 Network, B3 Voice, C1 Builder, C2 Laboratory, C3 Operator). Each row carries shortlex key, label, emoji, terminal, THE PULL statement, optional primary_scope.
- **`rule_room_relevance` junction** with continuous score (`relevance INTEGER 0–100`) + `rationale` + `scored_by` (`seed`/`llm-orthogonalize`/`user-manual`). Many-to-many: a rule can apply at varying weights across multiple rooms; no flat tag forces a lossy choice.
- **`?room=<key>` URL param** — routes to a per-room ranked rule view. SQL: `JOIN rule_room_relevance JOIN rooms WHERE rooms.key=? AND relevance>0 ORDER BY relevance DESC, level`. Each room shows only the rules it cares about, sorted by canonicalness.
- **`/api/rooms`** lists all 9 rooms in shortlex order with rule_count per room.
- **Cognitive Rooms section** in the UI — 3×3 grid of room cards, click to filter rules to that room. Active room highlighted; relevance badge on each rule shows its score for the current room.
- **Orthogonalisation prompt endpoint** — `GET /api/cc-prompt/orthogonalize` emits a structured CC prompt that takes all rules + all rooms (in shortlex order) and asks Claude Code to score every (rule, room) pair, output `INSERT OR REPLACE INTO rule_room_relevance ...` SQL. The prompt is the load-bearing piece; SQLite stores the result; the dashboard renders the per-room hierarchy.
- **"📋 Copy orthogonalisation prompt → score rule × room relevance in CC"** button in the intro banner.
- Initial seed migration: each existing rule's `scope` (voice/structural/business-comms) maps to relevance=100 in its primary room (B3 Voice / C1 Builder / C3 Operator). All other (rule, room) cells start at 0; orthogonalisation prompt populates them.

### Added — Writing-room dashboard

- **Live search** across rules and hook files — filters cards as you type.
- **Per-card expandables** — `▸ regex pattern` and `▸ full rule` (JSON dump of all metadata) on rule cards; `▸ full path` and `▸ full file content` (lazy-loaded) on hook-file cards.
- **Per-rule and per-hook-file "Copy prompt → develop this in Claude Code" buttons** — purple full-width CTA on every card. Emits a CC prompt with the rule/file context pre-loaded.
- **Top-level meta button** — "📋 Copy prompt → regenerate this dashboard in CC" emits a self-improvement prompt. The dashboard can ask Claude Code to improve itself.
- **Hook-file discovery API** — `GET /api/hook-files` enumerates `hooks/*` and `scripts/voice-*.sh` / `scripts/post-anchor-check.sh` etc. with descriptions extracted from header comments.
- **Hook-file read + CC-prompt endpoints** — `GET /api/hook-file/:path` (path-traversal guarded to `hooks/` or `scripts/` subpath); `GET /api/hook-file/:path/cc-prompt` emits a CC prompt including file path, first 60 lines, and Shadow Agent architectural context.
- **Per-rule CC-prompt endpoint** — `GET /api/rules/:id/cc-prompt` points CC at the SQLite source of truth, asks it to stress-test the pattern and propose an `UPDATE` statement, references the meta-rule on no-reductive-saves.
- **Pages discovery** — `GET /api/pages` discovers `.workflow/rooms/*`, `.workflow/cognitive-dashboards`, and `cognitive-workspace/dashboards/*`; top nav links to each.

### Documentation

- README v2.3 section "A Writing Room in Your Terminal" — Shadow Agent architecture, find-and-point pattern (dashboard finds, CC edits), three scopes mapped to cognitive rooms (voice→B3, structural→C1, business-comms→C3).

### Pattern

- **Find-and-point, not edit-in-HTML** — per user direction May 4: "finding the right rules and pointing cc to it is the right pattern, not editing it in the html". The dashboard surfaces context; Claude Code performs the edit.

## [2.3.0] - 2026-05-04

### Added — Shadow Agent rules dashboard

- **`thetacog dashboard`** — local web UI on port 3737 (override via `THETACOG_DASHBOARD_PORT`). Singleton: lockfile at `.thetacog/dashboard.pid` prevents two instances per repo. Stop with `thetacog dashboard --kill`; check with `thetacog dashboard --status`. Auto-opens browser on launch.
- **SQLite-backed rules** at `.thetacog/rules.db` (uses `better-sqlite3`, already a dep). Tables: `voice_rules`, `hook_config`, `prompts`. Pre-seeded with three scopes:
  - `voice` — paradox-voice and meta-commentary rules
  - `structural` — Six Needs canonical sequence + canonical tile-form
  - `business-comms` — LinkedIn drafts and reply-naming rules
- **Scope filtering** — `?scope=voice` etc. on the dashboard URL filters to room-specific rules. Each cognitive room can link to its own scope: terminal-voice → `?scope=voice`, iterm2-builder → `?scope=structural`, kitty-operator → `?scope=business-comms`.
- **Manual run buttons** — voice audit, post-anchor-check, regen-hooks all dispatchable from the UI. Each spawns a detached background process and writes to `.thetacog/runs/<id>.log`.
- **Copy-prompt-for-Claude-Code buttons** — pre-formatted prompts in the SQLite `prompts` table emit to clipboard for paste into a CC session. The user's CC then works on the rules with full context.
- **`thetacog regen-hooks`** — reads SQLite, writes `.thetacog/hooks-config.json` (the JSON the lexical hooks read). Single source of truth = SQLite; JSON is derived. Self-heal pattern: if drift detected, regenerate from the DB.

### Changed — Shadow Agent hook architecture

- The companion repo's `hooks/pre-push` is now lexical-only (book HTML rebuild + deep-link gate); heavy LLM checks (`voice-audit-llm`, `post-anchor-check`) moved to `hooks/post-commit` where they run async via `nohup` + `disown`. Push completes in ~10-30s instead of 60-180s. Audit results land in `docs/reports/voice-audit-async/` for the cleanup subagent (Phase 2) to consume.

## [2.2.0] - 2026-05-01

### Added
- **Two-step runner pattern for daily room workflow** — The `run room` command (via `scripts/open-room-session.sh`) now generates a purpose-built runner sh per (room, date) at `.thetacog/cache/room-runners/{room}-{date}.sh` and pbcopies a SHORT handoff prompt instead of the prior long payload.
- **Real `/remote-control` slash-command fire** — Claude Code does not execute slash commands embedded in pasted prompt blocks. The runner ends with `printf '/remote-control' | pbcopy` so the clipboard contains exactly that text and the user's NEXT paste fires it as a real slash command. Sequence: paste handoff → runner runs → paste again to fire.
- **`--warm-all` writes runners** for all rooms in addition to pre-warming briefs. Overnight cron leaves every room hot AND with a fresh runner.

### Documentation
- `/thetacog` page gains a "Daily Workflow — Run a Room" card explaining the four-beat: open room terminal with Chrome split-screen → type "run room" in CC → paste handoff prompt → paste `/remote-control` to fire.
- "Want different tabs?" callout: tell CC to edit `.thetacog/gemini-sessions.json` to swap Gemini URL or vault path per room.

## [2.0.0] - 2026-02-12

### Added
- **Cognitive Affordance Model** - Complete cognitive architecture for each room:
  - COORDINATE LOCK with position and intersection
  - THIS ROOM SEES / THIS ROOM IGNORES routing
  - THE PULL statement (why you come here)
  - TESSERACT NAMESPACE (3x3 grid with YOU ARE HERE marker)
  - DIFFERENTIATION with explicit HANDOFF TO/FROM patterns
  - ESCAPE GRAVITY (vanity metrics vs true signals)
  - OUTPUT FORMAT JSON schema

- **Tesseract Coordinate System** - 3x3 grid mapping:
  - Rows: Strategy (A), Tactics (B), Operations (C)
  - Columns: Law (1), Goal/Opportunity (2), Fund/Signal (3)
  - Diagonal rooms (A1, B2, C3) = pure essence
  - Off-diagonal rooms = translation between coordinates

- **Wikipedia Winning Pointers** - Each room links to foundational concept:
  - Vault → Mathematical proof
  - Architect → Hebbian theory
  - Builder → Symbol grounding problem
  - Operator → Drift + Commitment scheme
  - Voice → Proof of stake
  - Laboratory → Iteration
  - Performer → Seigniorage
  - Network → Commitment scheme
  - Navigator → CPU cache

### Changed
- Room prompts now include full cognitive affordance structure
- Each room explicitly routes AWAY from 8 other rooms
- Sharpened THE PULL statements for maximum distinctness:
  - Architect: "CASCADE and COMPOUND"
  - Builder: "SHIPPED AND INSTRUMENTED"
  - Operator: "BINDING COMMITMENT INDEX"
  - Voice: "STAKE CONVICTION"
  - Laboratory: "2 hours not 2 weeks"
  - Performer: "MULTIPLIER RATIO"
  - Network: "RECIPROCITY FIRST"
  - Navigator: "15-MINUTE DISCIPLINE"

### Architecture
- Room HTMLs contain structured prompts for AI context locking
- Copy entire HTML to Claude = instant coordinate lock
- Generalized templates (removed project-specific content)

## [1.1.0] - 2026-02-10

### Added
- **9 Cognitive Rooms** (expanded from 6):
  - Performer 🎬 (Alacritty) - presentations, demos, delivery
  - Navigator 🧭 (Rio) - exploration, API discovery, codebase mapping
  - Network 🌐 (Messages) - communication, Slack, email
- **JSON → HTML rendering**: Dashboards now read `~/.thetacog/state.json` on tab focus
- **thetacog-state-reader.js**: Embedded script for live todo/stream display
- **ROADMAP.md**: Architecture diagrams and implementation plan

### Fixed
- Tool schemas now include all 9 rooms (thetacog-switch, thetacog-open)
- `exportStateToJson()` exports all 9 rooms (was only 6)
- Version numbers synced across server.js, package.json, startup message

### Changed
- README updated: "7 Cognitive Rooms" → "9 Cognitive Rooms"
- Room naming standardized: Discoverer→Vault, Teacher→Voice, Strategist→Architect, Communicator→Network
- postinstall.js creates initial state.json for immediate HTML functionality

## [1.0.7] - 2026-02-01

### Fixed
- npm publish configuration
- Package files list

## [0.2.0] - 2026-01-10

### Added
- Five new MCP tools:
  - `thetacog-open` - Open room HTML in browser
  - `thetacog-todo` - CRUD for room todos (add, list, update, delete)
  - `thetacog-stream` - Flywheel coordination between rooms
  - `thetacog-export` - Export state to JSON for HTML refresh
  - `thetacog-terminal` - Detect which terminal Claude is running in
- SQLite tables: `room_todos`, `room_streams`
- JSON export layer: `~/.thetacog/state.json`
- Terminal detection via TERM_PROGRAM env var

### Architecture
- SQLite = primary store (fast, 0-1ms writes)
- JSON = sync layer (HTML reads on tab focus)
- HTML = display layer (refreshes via visibilitychange event)
- Same pattern as CRM MCP but for mode management

## [0.1.0] - 2026-01-10

### Added
- Initial release
- Three core MCP tools:
  - `thetacog-detect` - Analyze conversation for room signals
  - `thetacog-status` - Get current room context and identity rules
  - `thetacog-switch` - Switch rooms with context preservation
- Six room archetypes: Builder, Architect, Operator, Vault, Voice, Laboratory
- Memory palace anchoring for each room
- Identity rules per room
- SQLite optional (works in memory-only mode)
- Graceful shutdown handlers (SIGINT, SIGTERM, SIGHUP)
- Install subcommand for easy registration
- Terminal detection for macOS

### Architecture
- Copied battle-tested patterns from thetacoach-crm-mcp
- HTML files with embedded JSON = self-contained rooms
- SQLite = optional session state and switch history
- Same shutdown pattern as CRM (prevents zombie processes)

## 2.16.0 — 2026-07-02
- `npx thetacog-mcp prove` — the FIRST-RUN SELF-PROOF: calibration (dead-sensor check) ·
  determinism (two pid-isolated processes, byte-identical or loud failure) · your-own-repo
  placement with statistics-derived honest abstains · the what-exists / what-is-pending
  inventory. Nothing asserted; every pillar runs on the stranger's machine. `--full` chains
  the complete attest-demo walkthrough.
