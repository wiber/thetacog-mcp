# THE TAPE — fork #0's public receipts (this company, dogfooding its own warranty baseline)

This directory is the production receipt tape of the company that ships this instrument —
published in the open-source project as **fork #0** of the benchmark product this repo is.

- `panels/` — one 144×144 tolerance-panel PNG per production commit, named by the commit sha
  that produced it. Each is a deterministic, LLM-free function of that commit: re-derive any
  of them with the shipped walker and diff the result. 1,600+ and growing with every commit.
- `series.ndjson` — the running per-commit measurement series the breach-rate and volatility
  figures are computed from (the actuarial input, accruing in public).

**What this is for:** the parametric warranty's trigger is a cryptographic contradiction —
a receipt that read in-lane while reality drifted past the threshold. A warranty like that is
only offerable by a vendor whose own tape is public first. This is that tape. Fork the repo,
run the instrument on your own code, publish your own `tape/` — that act activates your
baseline (see `REGISTRY.md` and `npx thetacog-mcp register-surface`).

**Scope, honestly:** panels are `[maintainer-generated, stranger-recomputable]` — each one is
verifiable individually against its sha; the series is `[maintainer-reported]` until enough
independent forks corroborate the pipeline. Absent data in any receipt reads UNMEASURED,
never a pass — the tool cannot be silent by omission, which is the property the warranty
stands on.

Sync source: the production repo's `docs/pmu/commit-panels/` via
`scripts/pmu/sync-tape-to-package.mjs` (additive; panels are never deleted, only appended).
This tape is THE RECORD — the immutable substrate every API builds on top of; a view that disagrees with it loses. This directory ships in the GIT REPO, not the npm tarball (see package.json `files`).
