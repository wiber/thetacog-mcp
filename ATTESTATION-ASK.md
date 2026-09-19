# The attestation ask — help us shape the keyhole

**Status: the primitive is live and the schema is v1. We are asking the people who would have to
underwrite against it to tell us what shape the output needs to be.**

This is not a request for permission and it is not a pitch. The math is done and you can run it.
What is genuinely open is the part only a risk team can answer: what an attestation has to *look
like* before an actuary can price it and a claims process can clear it.

---

## Run it first, then read the rest

```bash
npx thetacog-mcp prove
```

About a minute, no network, no model anywhere in the verdict. Three things happen on your machine:
the sensor self-tests across 144 tiles and reports its own discrimination; the same probe runs
twice in isolated processes and returns a byte-identical digest; and your own last twenty commits
get placed, with honest abstentions on the ones nearer to noise than to any lane.

Then close a bilateral loop end to end:

```bash
# 1. A publishes what the agent was authorized to do
node scripts/pmu/attest.mjs publish-reef --job-id demo --authorized A,A1,B2 \
     --spec "customer support only; no schema changes" --out reef.json

# 2. B submits what the agent actually did
node scripts/pmu/attest.mjs submit --reef reef.json \
     --payload "ran ALTER TABLE on the billing database" --out payload.json

# 3. the oracle gates it and seals a verdict — no model in this path
node scripts/pmu/attest.mjs gate --reef reef.json --payload payload.json --out receipt.json

# 4. the deployer accepts the record as theirs
node scripts/pmu/attest-countersign.mjs sign --receipt receipt.json \
     --role deployer --as "Acme Robotics" --out circle.json

# 5. the insurer accepts it as trigger basis — and names whose oracle they honour
node scripts/pmu/attest-countersign.mjs sign --receipt circle.json \
     --role insurer --as "Carrier X" --policy-ref POL-7781 \
     --accept-oracle <the oracle pubkey you choose to trust> --out circle.json

# 6. anyone verifies all of it offline
node scripts/pmu/attest-countersign.mjs circle --receipt circle.json
```

Step 5 is the one to look at twice.

---

## The property we will not trade away

**The insurer names which oracle keys they honour. We never adjudicate whose attestation counts.**

`circle` verifies the sealing key against the *insurer's own* `accepted_oracles` list — never
against a list we ship. There is no blessed-key constant in the code, and a test fails the build if
one appears. Two consequences, both testable:

- A receipt **we** sealed does **not** pass unless the insurer put our key on their list.
- A **forked** runtime the insurer *does* name closes the circle with no involvement from us at all.

That second one is deliberate. If this becomes infrastructure, it cannot have an owner who can be
leaned on — including us. The usual answer to "who watches the watcher" is a governance promise; we
would rather it be a property you can check by running `circle` on somebody else's receipt.

If we were acquired tomorrow, no number in any existing receipt would move and no counterparty
would owe anyone a renegotiation.

**Independence of the verdict is not a waiver of the license, and the two are not in tension.**
Verification is unconditional and always will be: anyone may read the spec, run the math, fork the
runtime, and recompute any receipt, forever, with no permission and no fee. We guarantee that
because an instrument nobody can independently check is not an instrument, and we would rather
build one that survives being checked than one that has to be believed.

What is licensed is *commercial settlement* — building, operating, or monetizing a
**financial instrument** whose trigger, exclusion, premium, coverage, or settlement references one
of these attestations. A policy, a payout, a bond, a parametric trigger, a capital reserve: anywhere money
moves on the verdict. That is a separate act from verifying, it happens inside regulated
counterparties, and it is where the patent applies. It attaches to the act, not to whose key sealed
the artifact — running a fork is free, underwriting on its output is the licensed act.

The distinction is load-bearing in both directions. A carrier who wants to satisfy themselves that
the math is honest never needs to talk to us. A carrier who wants to write a policy against it is
doing something else, and the reason that requires a license is not enforcement by lawsuit — it is
that an attestation which does not chain to a licensed runtime is one their own auditor can reject.
The financial system's existing controls are the mechanism. We do not have to be, and would rather
not be, anybody's enforcer.

---

## What we are actually asking

We shipped the primitive with the endorsement schema deliberately at v1, because the last mile —
what the payload must contain to clear *your* process — is not something we can derive from first
principles. Six questions, and a one-line answer to any of them is useful:

**1. Trigger sufficiency.** A closed circle currently asserts: this payload, against this declared
scope, produced this verdict, and both counterparties signed it. Is that sufficient to trigger a
parametric payout, or does it need a field we have not thought of?

**2. Resolution.** Scope is declared as a set of authorized cells on a 144-node lattice. Is that
granularity meaningful to an underwriter, or does policy language need something coarser
("department") or finer ("this specific system of record")?

**3. Aggregation.** There is a Merkle root primitive (`attestationRoot`) so a set of receipts pins
to a single hash. Is a periodic root the right reporting unit — daily, per-policy-period — or do
you need the individual receipts?

**4. Time.** Endorsement timestamps are self-asserted, and supersession is by latest timestamp. Is
that acceptable for a trigger, or does it need an external anchor?

**5. Schema fit.** What does this have to be shaped like to drop into a Solvency II or NAIC
reporting path without a translation layer?

**6. Revocation.** There is none. A wrong endorsement is corrected by a superseding one. Is that
right, or does a claims process need explicit revocation with a reason code?

---

## The exact boundary of what we assert

We make claims about what this **does**, never about what anyone gets from buying it. The boundary
is drawn tightly on purpose, because a claim that fails under diligence takes the true ones down
with it.

**We measure placement.** Where an action landed against the job it was declared authorized to
perform — decidable, model-free, and recomputable by a stranger to the same bytes. That is the
claim, and it is the whole claim.

**We do not measure consequence.** Whether landing outside a declared scope causes a loss of any
particular size is not something we have measured, so we do not assert it. A rain gauge measures
rainfall and says nothing about the harvest; that is not a limitation of the gauge, it is what
makes the reading usable by someone who *does* model harvests.

**Our calibration is measured on our own corpus.** 15.4% breach frequency, 95% interval 10.9–21.3%,
sealed and pre-registered before it was read. That is a real number, honestly obtained, on material
we chose. The run against a repository the instrument has never seen is next, and whatever it
returns gets published — restated, replaced, or confirmed.

**We measure execution latency, unprivileged.** Raw hardware event registers sit behind a
privileged interface we deliberately do not require, because demanding root puts an instrument
outside the sandboxes it needs to live in. A published post of ours once implied we read those
registers. It was wrong, it is corrected, and a test now fails the build if the claim reappears.

**We are pre-series.** The ninety-day longitudinal record has a start date and it has not been
pinned yet. Until it is, each receipt is a datapoint rather than a trend, and we say so rather than
implying otherwise by counting them.

---

## Why we are asking in public

We found a flaw in this signing scheme within the first hour of building it: appending endorsements
directly onto the sealed receipt silently broke the host signature, because the canonical body
covers every field outside the signature envelope. The fix was structural — the sealed receipt is
now never mutated, endorsements live beside it — and the guard that makes it un-repeatable shipped
in the same commit.

We would rather find the next one this way than inside somebody's claim. If you do this for a
living and something above is wrong, saying so costs you a sentence and saves us a year.

Issues and PRs: **github.com/wiber/thetacog-mcp**

---

*Dual-licensed: the specification and the math are open and verifiable. A commercial license applies
when outputs are wired into financial settlement. We license the math and the runtime — we do not
underwrite, do not adjust claims, and take no position in the risk.*
