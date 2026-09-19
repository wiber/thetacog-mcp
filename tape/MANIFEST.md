# THE TAPE — fork #0's public receipts (this company, dogfooding its own warranty baseline)

This directory is the production receipt tape of the company that ships this instrument —
published in the open-source project as **fork #0** of the benchmark product this repo is.

- `panels/` — one 144×144 tolerance-panel PNG per production commit, named by the commit sha
  that produced it. Each is a deterministic, LLM-free function of that commit: re-derive any
  of them with the shipped walker and diff the result. 6,100+ distinct commit shas and growing with every commit.
- `series.ndjson` — **the autotick scheduler series: when the background loop ran and why it did
  not.** Rows look like `{"tick":"autotick-cli","ran":false,"on_ac":false,"action":"pause"}` — a
  record of cron ticks and laptop power state. **It is NOT a measurement series and no breach rate
  or volatility figure can be computed from it.** This line previously described it as "the
  actuarial input"; that was wrong, it was caught before this file was ever published, and it is
  corrected here rather than quietly deleted because a reader who fetched the old description would
  have found power states labelled as underwriting input. The drift series it was confused with is
  `data/pmu/measure-history.ndjson`, which is NOT in this mirror.

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

<!-- BEGIN sync-tape-to-oss:receipts -->
## Receipts — count, and how to recompute one

`panels/` holds 2820 per-commit tolerance panels and `encircled/` holds
4066 encircled drift receipts, covering 6111 distinct commit shas. Each
is a deterministic, LLM-free function of its commit — re-derive any of them with the shipped
walker and diff the result:

```bash
npx -y thetacog-mcp@latest attest-demo
```

**Sufficient for:** where a commit landed relative to the lane it declared. **Not sufficient
for:** whether that commit is correct — that is undecidable (Rice, 1953) and is not claimed.
Full contract in `RECEIPTS.md`.
<!-- END sync-tape-to-oss:receipts -->
