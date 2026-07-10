# Patent notice & the toll booth

**The code is MIT. The signal has a patent. Here is exactly where the line is —
so you never have to trust us on it, and can plan around it.**

This package implements a decidable, on-chip, LLM-free **placement receipt**: a
commit or execution maps to a coordinate on a fixed 144-cell lattice, with σ, a
lane, and an ed25519 on-chip signature — `git show`-identical every run. The
method is covered by **US Patent Application 19/637,714** (Track One).

We claim **only that the measurement measures** — semantically, on-chip, with no
LLM in the loop, which is what makes it fair, priceable, and decidable. We make
**no** claim of prevention (no kill-switch), **no** claim of a blockchain (it is
an append-only signed mesh, not a deployed chain), and **no** claim that it
"satisfies" any regulation (we map to DORA/ISO; legal satisfaction is your
counsel's call). It is a Richter scale, not a blowout preventer.

## Who pays, and who never does

| You are… | What you do | License |
| --- | --- | --- |
| **A builder / operator** | install it, run it locally or in CI, wrap your agents, build enforcement layers on top, save tokens | **Free.** Go nuts. Improve it. The MIT grant covers the code; running the harness needs nothing from us. |
| **Running agents in production under the patent** | use the receipt as your operational standard of care | **Per-agent annual license** — one per production agent. Price fixed for good; see <https://thetadriven.com/pricing>. |
| **A financial issuer** | price, trigger, or underwrite an **insurance policy, bond, option, or derivative** on this signal | **Commercial utility license** — the 10% transferable fee. See <https://thetadriven.com/standard>. |

The economics are designed so the toll lands on the financialization, not on the
work. **A `$20` / agent-year license to underwrite a year of verifiable
competence is a rounding error** against the premium an underwriter writes on top
of it — which is why builders never have to be chased for pennies. You are safe
from us chasing you for licensing fees *because* you help this repo become
ubiquitous. Ubiquity is the prerequisite for financialization; the developer
community is the distribution.

## The unit

One 144-cell lattice execution = **one intent** (`L`). By benchmark,
`1 Agent-Year (Yₐ) = 10,000 L` — a fixed unit of cognitive-labor *volume*,
decoupled from calendar time (an agent may burn a decade of `L` in a weekend).
Full definition and unit economics: <https://thetadriven.com/agent-year>.

## Verify, don't trust

```
npx thetacog-mcp prove-rice --check   # exit 0 = verdict + σ reproduced byte-for-byte
```

A stranger recomputes any receipt with zero trust. That is the whole point: the
standard is not "care," it is **what is available** (*The T.J. Hooper*, 1932) —
and the radio is now a free npm install.

---

Questions on the commercial/patent license: **elias@thetadriven.com**.
Inventor: **Elias Moosman**, ThetaDriven Inc.
