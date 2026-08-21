# /tape — THE BUILD CONTRACT (pinned 2026-08-19; all builders read this FIRST)

Spec: `docs/specs/drafts/tape-console-spec-v2.md` (+v1). This file pins the exact shapes so three
parallel builders (engine · console · reports/skill/tests) compose without drift. A builder who
needs to deviate EXTENDS this file in the same commit as the deviation.

## Processes (carbon copy of packages/thetacog-mcp/scripts/rewrite/ — the CANONICAL copy; repo-root scripts/rewrite is stale, never fork it)
Next route (mailbox client, no engine imports) → detached `worker.mjs` (SINGLE state writer, heartbeat) →
`engine.mjs` (producer loop) → `store.mjs` (atomic writes: tmp+rename; append-only ndjson ledgers).
`serve.mjs` = standalone http mirror of the API, port **4321** (`TAPE_PORT`) so `cli.mjs` works without Next.

## Paths
- Engine: `packages/thetacog-mcp/scripts/tape/*.mjs` (store, chunker, atomizer, physics, contradict, engine, worker, serve, cli, html-report, prompts)
- Reuse by import, never copy: `../rewrite/llm.mjs` (models), `../rewrite/store.mjs` patterns, `../../scripts/pmu/tape-intent.mjs` — NOTE from inside packages/thetacog-mcp: `scripts/pmu/tape-intent.mjs` (package-local) is the physics module.
- Console: `src/app/tape/page.tsx` + `src/app/api/tape/route.ts` (loopback-only, no-store, 404-in-prod guard — copy rewrite's).
- Launcher: `scripts/tape.sh` (routes dev server through `./scripts/dev.sh`, primes engine, opens browser + bash-opens HTML reports).
- Skill: `.claude/skills/tape/SKILL.md`. Tests: `tests/tape/*.test.mjs`.
- Session: `.thetacog/tape-sessions/<slug>/` →
  `session.json` · `flight-tape.json` · `specs.ndjson` · `decisions.ndjson` · `dispatches.ndjson` · `vega-series.ndjson` · `html/` · `mailbox/`

## INGEST LANES — TWO, and the second one is ALREADY BUILT IN RUST (found 2026-08-20, do not reimplement)
The operator's ask names two input kinds: "the txt file (or cc total transcripts as inputs)". They are NOT the
same ingest and must not be merged into one JS reader.

**Lane A · raw operator text (.txt, .md)** — `chunker.mjs` (built). Glossary-normalize, then segment into turns by
the measured heuristics. Deterministic, pure. This is the GDDadwill.txt lane.

**Lane B · Claude Code transcripts (.jsonl)** — **the Rust walker already does this.** `.thetacog/pmu/src/transcript.rs`
+ `pmu-onchip --ingest-transcript --path <file.jsonl> --offset <N> [--json]`. It is incremental and FRAME-SHAPED by
design: complete-lines-only, a replayable byte cursor (`newOffset`), lossy-UTF8 at a guaranteed-clean newline, and it
returns `{firstUserPrompt, intentThinking[], reality[], lineCount, newOffset}` — i.e. it already splits a transcript
into INTENT and REALITY claims, which is precisely the split the tape needs. Its header states the acceptance gate:
bit-identical to the Node reference `readNewLines`/`firstUserPromptOf`/`assistantTextOf` in `scripts/pmu/resident-watch.mjs`.
Spec: `docs/architecture/pmu-streaming-rust-ollama-spec.md` §6 (M1).
- **MEASURED on this machine 2026-08-20** (speed is a correctness signal): full read of a 41,951,239-byte transcript
  = 12,939 lines → 927 reality claims in **0.30s real**; a 200KB incremental tail = 81 lines → 6 claims in **0.02s**;
  the cursor is idempotent (same `newOffset` both runs). ~140 MB/s. That is the chip lane, not a model lane.
- **CONTRACT:** `/tape` MUST shell out to `pmu-onchip --ingest-transcript` for `.jsonl` inputs and MUST NOT grow a
  JS transcript reader. A second implementation would fork the M1 bit-identity gate and is banned here for the same
  reason the analytic walk is banned: the running code exists and it is on the metal.
- Session records `ingest_cursor: {<source>: <newOffset>}` so a live transcript can be re-read incrementally and the
  tape extended without re-walking what it already placed — the "tolerance movie" heartbeat applied to specs.
- Lane B's `reality[]` entries are assistant output and its `intentThinking[]` are the intent side; feed the INTENT
  side to atom extraction and hold the REALITY side for enforcement-fidelity measurement (they are different measurements
  — see the four-measurements list in the spec, never conflate them).

## session.json (v1)
```json
{ "version": 1, "slug": "gddadwill", "sources": ["/abs/path/GDDadwill.txt"], "createdAt": "", "updatedAt": "",
  "cursor": 0, "totalTurns": 0, "totalLines": 0, "home": {"coord": "B,C1", "decidedFrom": 24},
  "stats": {"atoms": 0, "picked": 0, "dropped": 0, "reintroduced": 0, "decided": 0, "dispatched": 0, "done": 0, "contradictions": 0},
  "paused": false, "steering": [] }
```
`steering[]` rows: `{ts, kind: "prose"|"path", value, appliedAt}`. A `path` row = walk+merge that file into the session.

## specs.ndjson — THE ATOM (append-only; edits fork forward: new row, `parent_id` = old id, old row superseded)
```json
{ "id": "DECISION-041", "type": "DECISION|CONSTRAINT|VERIFY|CONTEXT", "ts": "",
  "source": "/abs/path", "chunk": [1285, 1301], "turn": 62, "quote": "<verbatim, MUST appear in source>",
  "rule": "<one-line extracted rule>", "target_surface": "src/... or null", "falsifier": "<runnable cmd or null>",
  "cursor_id": "<sha256 from writeTapeIntent>", "coord": "B,C1", "placement": ["B,C1", "...~30 lit cells..."],
  "sigma": 1.73, "sensor": "metal", "apertureFidelity": 0.34, "laneDrift": 0, "extractor": "atomizer.mjs",
  "priority": "P0|P1|P2", "status": "suggested|picked|dropped|reintroduced|decided|dispatched|done",
  "picked_by": "ai|operator", "parent_id": null, "contradicts": [] }
```
ID counters are per-type, zero-padded 3 (DECISION-001…). `laneDrift` = Chebyshev king-move distance of this
atom's `coord` from `session.home.coord` on the 12×12 grid (0 = in-lane; null = UNMEASURED, home not yet decided).

**FIELD NAMES ABOVE ARE THE SHIPPED ONES (reconciled against live ledgers 2026-08-20).** The first draft of this
block said `placement: ["B,C1"]` and `drift`. Both were superseded by design-doc §G and the running code already
agreed; only this file lagged. **`coord`** is the single representative cell (the lit cell nearest the centroid —
`physics.representativeCoord`) and is what every display reads; **`placement`** is the FULL lit set (~28–37 cells)
and is never a label. **`laneDrift`/`laneAuc`** replace `drift`/`auc` per G3, because
`tape-walk-worker.mjs` already writes a 0–100 `metrics.drift` into the same flight-tape these atoms cite by
cursor_id. Verified identical across writers (physics/engine/worker) and readers (cli, html-report, page.tsx,
route.ts).

## decisions.ndjson
```json
{ "ts": "", "atomId": "DECISION-041", "verdict": "accept|reject|defer", "reply": "<operator text (typed or TTS-dictated)>",
  "spoken": true, "subagents": 2, "commit": "<sha|null>" }
```

## dispatches.ndjson
```json
{ "ts": "", "atomId": "DECISION-041", "prompt": "<the FULL prompt as fired — page-editable before firing>",
  "promptSha": "<sha256>", "agents": 2, "agentType": "claude", "status": "queued|running|done|failed",
  "resultSummary": "", "commits": [], "receiptPng": null }
```

## vega-series.ndjson (one row per atom, appended at placement time; deterministic, LLM-free)
```json
{ "atomId": "", "pos": 62, "kind": "lane-auc", "coord": "B,C1", "sigma": 1.73,
  "laneDrift": 0, "laneAuc": 4.0, "unmeasured": null }
```
`laneAuc` = running Σ `laneDrift` (the area under the lane-departure curve). Recomputable from prior rows.
`kind:'lane-auc'` is the G2 marker: this is NOT `greeks.mjs:computeVega`, which is a variance. `laneDrift:null`
plus a non-null `unmeasured` reason is the honest UNMEASURED row (placed before a home coordinate existed);
it contributes 0 to the area and is drawn as a distinct state, never as an in-lane zero.

## Physics (LLM-FREE path — guard-enforced)

### ⚠ CORRECTION 2026-08-20 (MEASURED, supersedes the original line below) — TWO CALLS, NOT ONE
The first draft of this contract said the tape receipt returns "placement coords + sigma". **It does not.** Probed
live against `scripts/pmu/tape-intent.mjs`, a filled receipt is exactly:
```
{ cursor_id, filled:true, status:'FILLED', verdict:'OFF_DOMAIN',
  metrics:{ verdict, mode:'B', drift:76.3, dI:0.7556, dN:0.2349, offPct:52 },
  receipt_id, receipt_ts, elapsed_ms:455 }
```
No `coords`. No `sigma`. No `io_context` on the read path. **Coordinates come from a different running module.**

**CALL 1 · WHERE (the coordinate)** — `packages/thetacog-mcp/scripts/rewrite/tesseract.mjs` → `place(text)`:
```
{ coords:[...33 cells...], sigma:1.6, cells:33, sensor:'metal',
  apertureRatio:1, apertureMismatch, fillPct:1.86, ms:302.68, _walk }
```
Measured on the GDD payload quote: 33 cells, σ 1.6, **sensor `metal`** (the real Rust walk, not the gzip fallback),
~300 ms, and byte-identical coords + σ across two runs. `isAvailable()` returns `{available:true, root, error:null}`.
This is the atom's placement. Budget ~300 ms per atom — 200 atoms ≈ 60 s for a full session walk, acceptable
off the interactive path; show progress, never block the console on it.

**CALL 2 · THE INTENT-VS-REALITY READING** — `tape-intent.mjs` write/read, per the original line. It yields
`verdict / drift / dI / dN / offPct`, ~455 ms, and it is the *reading*, not the placement.

**MASS ASYMMETRY IS REAL AND SHOWED UP ON THE FIRST PROBE.** Quote (430 chars) vs one-line rule (130 chars) returned
`OFF_DOMAIN, dI 0.7556, offPct 52`. That is very likely a MASS artifact, not an extraction-fidelity signal — the two
sides are not the same size-order, which is exactly the condition META-BULK exists to prevent. Therefore: never read a
raw quote-vs-rule verdict as fidelity. Bulk BOTH sides to matched mass first (equal context added to each side), and
if the reading still cannot be made honest, record it as UNMEASURED with the reason rather than publishing a verdict
the geometry does not support.

### Original line (still correct for CALL 2 only)
- Per atom: `writeTapeIntent({intent_text: quote, reality_text: rule, negative_text: '', scenario_tag: 'semantic-drift', tape: <session>/flight-tape.json})` then `readTapeReceipt`. Quote-vs-rule = EXTRACTION FIDELITY **only after symmetric bulking**.
- If gzip mass < floor (short atoms): pad symmetrically per META-BULK by bundling the atom with its chunk context on BOTH sides (never one side).
- Contradiction shortlist: gzip-NCD proximity between the new atom's `rule` and all prior rules (top 5, threshold ≤0.45) — LLM-free; the LLM judge runs OFF this path (engine's extraction lane) and only writes `contradicts[]`.
- No model import may appear in `physics.mjs` or anything it imports. Guard: `tests/tape/receipt-is-llm-free.test.mjs`.

## Extraction (the ONLY LLM lane; one turn at a time — R0)
`atomizer.mjs` prompts (in `prompts.mjs`) receive ONE segmented turn + the session primer (spec v2 R1 heuristics
+ voice-glossary-normalized text) and return strict JSON atoms with verbatim quotes. Fan out per-turn calls
concurrently (bounded), NEVER a sequential await-loop (guard: `tests/tape/no-sequential-model-loop.test.mjs`),
and NEVER feed >1 turn to one call (guard asserts the prompt builder takes a single turn).
Model access: import `../rewrite/llm.mjs` (cloud=claude CLI with CLAUDE_* env stripped, local=ollama). Default cloud.

## API actions (route.ts + serve.mjs expose identically)
GET: `health` · `sessions` · `state&slug=` (whole console payload: session + atoms + decisions + dispatches + vega + buffer/worker status) · `doc&slug=&source=` (raw text + line offsets)
POST `{action, slug, …}`: `open {sources[]}` · `pick|drop|reintroduce {atomId}` · `editAtom {atomId, rule?, priority?, type?}` (forks forward) ·
`decide {atomId, verdict, reply, spoken, subagents}` · `editPrompt {atomId, prompt}` · `dispatch {atomId}` ·
`steer {kind, value}` · `speak {atomId}` (server-side detached `say` reads the rule aloud; never blocks) ·
`pause|resume|stop` · `report` (regenerate html/ + return paths)
Worker mailbox verbs mirror POST actions; command files unlinked before execution; results `res-<id>.json`.

## Console page regions (R5; all present v1)
tape view (raw text + per-chunk placement chips) · sortable/filterable atoms table with picked/dropped/reintroduced
toggle + inline rule edit · contradiction flags (red) · decision box per atom: TTS "speak" button, reply textarea,
subagent-count stepper, accept/reject/defer · dispatch panel with EDITABLE prompt textarea + fire + anatomy-of-proof
result (diff/receipt/panel, never bare "Success") · steering box (prose or file paths) · vega AUC SVG (frictionSeries/
FrictionGraph pattern) with lane-departure circles · receipts strip. Poll `state` every 1600ms, no-store.

## HTML reports (`html-report.mjs` → session `html/`; static, self-contained, bash-`open`ed by tape.sh and `report`)
`decisions.html` (decision ledger) · `specs.html` (sortable atoms table, sortable client-side JS) · `vega.html`
(AUC graph SVG) · `verbiage.html` (per-atom quote + rule + code blocks). Print-safe CSS per .context/print-safe-css.md.

## Commits
One atom decision = one commit (`tape(<slug>): decide DECISION-041 — <rule …>` with body: quote, verdict, reply,
subagents, placement, drift). Dispatch commits by the dispatched agents themselves. NEVER amend, NEVER branch,
`git commit --only <paths>`. Builders commit their own scoped files the same way.

## Determinism
Same source file twice → identical segmentation, atom ids for unchanged extraction, identical placements + vega rows
(timestamps excluded from comparison). Guard: `tests/tape/tape-walk-deterministic.test.mjs` runs the LLM-free half
(segment + placement of fixture atoms) twice and diffs.

## ⚙ INTEGRATION PASS 2026-08-20 — FOUR SEAMS CLOSED (each observed live, each now guarded)
Six builders composed against this file in parallel; these are the joins none of them could see from
inside their own lane. Guard for all four: `tests/tape/integration-seams.test.mjs` (7 assertions,
2 of them negative controls).

**S1 · A module import must never walk a session.** `walk-spine.mjs` had no main guard — every line
ran at import time, so an inventory check that merely imported it re-walked GDDadwill.txt and rewrote
`gddadwill`'s ledgers. (It rewrote them *identically*, which is the determinism working and is also
exactly why nobody noticed.) Now `export async function walkSpine({src, slug})` behind
`import.meta.url === pathToFileURL(process.argv[1]).href`.

**S2 · The slug is threaded, never hardcoded — and this one had already corrupted a live session.**
`walk-spine.mjs` wrote `slug:'gddadwill'` and `totalLines:1467` as literals and called
`generateReports('gddadwill')` regardless of `TAPE_SLUG`. So the `billem` run wrote into `billem/`
while stamping `slug:"gddadwill"` and `totalLines:1467` (billEm.txt's real count is not 1467), and it
regenerated GDDadwill's HTML reports instead of its own. The corrupted file is on disk and is where
this was found.

**S3 · THE DIRECTORY IS THE SLUG.** `loadSession()` returned the stale in-file `slug` verbatim, so
`listSessions()` handed the console two entries both calling themselves `gddadwill` — and a console
that trusts that field posts commands to the wrong session's mailbox. `loadSession(slug)` now stamps
the directory name it was asked for. The ledgers are keyed on the directory; a disagreeing field is a
stale copy, not a second opinion.

**S4 · Two numbers may not share one name (the G3 discipline, applied again).** `engine.open()`
published the SUM OF TURN SPANS as `session.totalLines` — 1386 on GDDadwill.txt, while
`action=doc` returns the file's real 1467. The console sizes the tape view against one and anchors
chunk chips with the other, which is the line-anchor shift the design doc warns mis-anchors every
chip. `totalLines` is now the source's own line count; the span sum ships as `coveredLines`.

**S5 · The single-writer lock is re-asserted every heartbeat, not only at startup.** `worker.json`
can vanish or be replaced while a worker lives (a session dir recreated, a stale file cleaned), and
the API's spawn path keys off that file alone — so it starts a SECOND worker on the same slug.
OBSERVED LIVE: pids 54854 and 54879 both ran slug `gdd-real`; one consumed the walk command while the
other reported `heavyInFlight:false`, and the walk appeared to die at cursor 1 with no error anywhere.
Two workers draining one mailbox is two state writers on an append-only ledger. Resolution rule is
deterministic so both sides never yield at once: the OLDER worker (earliest `startedAt`) keeps the
slug, a younger one that finds a live older owner stands down (`{"ok":true,"stoodDown":true}`).
