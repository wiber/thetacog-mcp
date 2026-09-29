# THE REGISTRY — public receipts surfaces

Every row is an organization that forked the benchmark, ran the instrument on its own code,
and published its receipts + tesseract surface. A row is `[self-reported]` until its URL
resolves anonymously and at least one receipt recomputes; then it is `[stranger-verified]`.
Register with `npx thetacog-mcp register-surface --url <your fork>` (it prints the `gh`
command — you post it, the tool never posts for you).

| # | Surface | Receipts | Tesseract | Status |
|---|---------|----------|-----------|--------|
| 0 | this repo (ThetaDriven — the vendor, dogfooding first) | `tape/` — 1,600+ per-commit panels + the measurement series | shipped in-package (`data/pmu/` — the 144-registry, snippet libraries, reef) | `[maintainer-published; per-panel stranger-recomputable]` |

The vendor is row 0 on purpose: a warranty on the instrument's silence is only offerable by
someone whose own tape went public first. Rows are append-only; a removed row is a story the
diff tells forever.

## The registry's next form — the signed mesh and the big map (foreshadowed; transport ships today)

The table above is v1. Its destination is **reach-to-verify**: registration becomes an
**ed25519-signed event on the nostr-pattern mesh** (the transport already ships —
`npx thetacog-mcp mesh-up` runs the local signed ledger; the same event grammar federates), and
every registered fork's tape renders onto **THE BIG MAP** — one global ShortLex lattice where a
project's receipts occupy its coordinates. Verifying a competence claim then has one motion:
**reach the coordinate, recompute the receipts under it.** No directory, no API trust — the map
is a view on the record, and the record is git plus signatures.

Mock of the map entry (shape final, values illustrative — `tape/BIG-MAP.mock.json` carries fork #0's):

```json
{
  "coord": "B,C3",
  "surface_url": "https://github.com/wiber/thetacog-mcp",
  "tape_head": "<sha of latest panel commit>",
  "receipts": 1634,
  "series_rows": 1044,
  "registered_by": "<ed25519 pubkey>",
  "sig": "<signature over coord+surface+tape_head>",
  "status": "self-reported | stranger-verified"
}
```
