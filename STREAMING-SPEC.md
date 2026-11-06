# Spec — Continuous Topological Streaming (Tesseract v4/v5 Blueprint)

**Version:** v1.4 (2026-07-22)
**Changelog:**
- v1.4 (2026-07-22) — §9d ADVANCED MODE + THE GOAL LOOP: the adversarial diligence engine (goal-loop-v5) fires the three gotchas — tombstone race, orphan siphon, paging thrash — at scratch reefs and writes one recomputable receipt; the demo page gains the Advanced Mode checkbox strip (Normal-the-dot vs Advanced-the-line) rendering ONLY from that receipt. First live run: 0 ghost catches / 400 routes, siphon flatlined at cap, thrash INFO baseline, measured multiple ×18,694. Orphan hard cap (MAX_ORPHANS 10,000) shipped with it.
- v1.3 (2026-07-22) — three diligence gaps closed: ORPHAN LEDGER (a non-lock quarantines the payload to an append-only ledger — nothing ever evaporates), TOMBSTONE semantics for revert (append a correction, zero the vocabulary, keep the structural mass — no downstream orphaning), DYNAMIC PAGING for Layer 3 (pin only the depth-0 macro grid; page child shelves in on route). §9c: the Stop-hook auto-trigger (explicit operator go) — the loop fires detached on turn completion; live-amputation ID logged.
- v1.2 (2026-07-22) — §9a THE INJECTION TRAPS: overtraining (child-shelf, never parent-vocab mutation), asymptotic split (derivative circuit-breaker — stop on flattening fit, not a raw ≤0.05 while-loop), hallucination permanence (placement-not-truth, auditable + revertible). New receipt class `coherence_delta` (the NCD step-down array that drives the graph). Underwriter benefits: cryptographic proof of learning · terminal efficiency curve (cache-hit monopoly) · live auto-healing.
- v1.1 (2026-07-22) — §9 THE KNOCK-ON LOOP: the closed-loop injector (miss → inject → topological tweak → 95% lock, NCD ≤ 0.05) built into the discrete PMU NOW as the streaming proof-of-concept; coherence-convergence graph (receipts-only inline SVG) on the demo page; explicit now-vs-later fence.
- v1 (2026-07-22) — initial blueprint: batch→streaming core shift, three layers (PMU sidecar · event-sourced tape · pinned-context LLM), decidability fence, foreign-repo-bootstrap GTM line, staged migration S0→S3 with guards.

**Delegated to:** 📐 architect (infra — persistent sidecar + IPC) with 🔨 builder (migration stages + guards).
**Status:** spec for pickup. **Why now:** the discrete loop works (the dot); this is the blueprint for the line — and the line is what turns the foreign-repo bootstrap from an overnight batch into a live in-the-room demo.

---

## 0. The dot and the line (why this spec exists)

The demo strip that just shipped (`f571e0d50`, "the line, not the dot") shows milestones as a
trajectory, not a point. This spec is the same move applied to the engine itself: we don't just
show a functioning ~25-second discrete loop — we hand over the exact architectural blueprint for
the continuous streaming engine. The reader (a broker, an underwriter, a diligence engineer)
should see that the v4/v5 endgame is already architected, that the migration is staged and
guarded, and that we understand the limits of our own math better than anyone else in the market.

**The core shift:** migrate from a stateless, batch-processed REST-style loop
(Cold-Start → Execute → Lock → Write → Die) to a stateful, persistent Unix-style pipeline:
the repo continuously bleeds AST chunks into the compressor, the compressor continuously emits
fits, the tape continuously writes deltas, and the LLM continuously observes the exhaust.
REST is for requesting state; streams are for observing state changes.

### 0a. Running code this spec federates (never reinvent)

The streaming engine is not greenfield — every layer has a running or spec'd ancestor. This
blueprint's job is to wire them into the loop, not to invent them:

- **`pmu-rust/` → `pmu-onchip --resident`** — a persistent stdin-driven Rust daemon loop ALREADY
  in the published package, shipped as a prebuilt Apple Silicon binary (runs instantly via
  `bin/pmu-rust.sh`, no toolchain). `--ingest-transcript --path <f> --offset N` already does
  incremental ingest. Layer 1 promotes this from demo mode to the loop's substrate.
- **Prior streaming specs:** `docs/architecture/pmu-resident-onchip-spec.md` (the resident
  daemon), `docs/architecture/pmu-streaming-transcripts-spec.md` (streaming ~1GB of transcript
  JSONL through the resident daemon), `pmu-streaming-checkpoint-2026-06-13.md`. This spec is
  their convergence into the reef loop, superseding none of them.
- **Tape precedent:** CHANGELOG v2.21.0 shipped the append-only **hash-chained** mesh
  (`parent_hash`, atomic); v2.38.0 shipped the v2.1 canonical tape contract (append-only, disk
  keys = on-screen semantics). Layer 2's event stream inherits both.
- **Parallel-hunt harness:** `scripts/pmu/hunt-pool.mjs` (flagged off) is the measured A/B
  harness for fan-out — reuse it as the S0/S1 comparison rig.

## 1. Where we are — measured, not asserted (2026-07-22)

- **The loop is real and running:** `scripts/pmu/reef-loop.sh status` → RUNNING, tick **17s of
  work → 60s rest (50% duty)**, stage-times demand 9s · miner 2s · agent+gate 4s · sentinel 2s,
  mode B, zero-LLM verdict in **87ms**. Down from the 900s cadence of 2026-07-20. The dot works.
- **The yield problem is visible in git history:** the autonomous harvest cycle repeatedly commits
  `+0 vocab +2 derived +0 anchors` and gets reverted — full spawn-cycle cost paid for near-zero
  yield. Batch physics, not a bug: every tick pays cold-start before it learns the tick was empty.
- **Batch latency is already being bought down incrementally** (`11fec356a` mass-index-v2:
  entropy stripping, sha-dedupe at the door → rebuild 37s→25s). Incremental buys ~30%;
  Amdahl's Law caps this road. The remaining 100× is architectural, not incremental.
- **The tape is armored, serially:** `scripts/pmu/tape-append.mjs` is THE ONE DOOR — exclusive
  `mkdir` spin-lock (≤5s spin, 60s stale-break), fresh re-read inside the lock, auto-archive at
  600 events. It ended the clobbered-SPLIT class. But a spin-lock means writers wait in line:
  correctness bought at the price of serialization.
- **The chain of custody exists at batch grain:** `ca080e81c` (verbatim chain of custody + pinned
  ast-snap with fallback contract). Streaming extends this custody to per-delta grain.

### 1a. Current physics — the choke points, file:line grounded

| Choke point | Where | Mechanism | Measured cost |
|---|---|---|---|
| Outer loop | `scripts/pmu/reef-loop.sh:96-108` | bash `while/sleep`, 50% duty, 60s floor | ~72s/cycle · ~1200 ticks/day |
| Stage spawns | `reef-loop.sh:79-84` | **5 serial cold `node` processes per tick** (demand → miner → harvest-agent → sentinel → narrator) | 5 cold starts × 1200/day |
| Reef re-read | each stage, every tick | lens-reef 300KB + snippet-library 215KB + burn-mass 796KB JSON parsed fresh from disk, per process | ~1.3MB × 5 procs × 1200 ticks/day, zero reuse |
| The shootout | `reef-demand.mjs` (single-process, in-memory gzip-NCD) | `git grep` shelled per vocabulary term | 8–22s/tick · width 8 = 2807ms, ~350ms/target |
| Parallel hunt | `hunt-pool.mjs` | `execFile node reef-demand --pin` × (cores−2) | FLAGGED OFF (`REEF_HUNT_WORKERS=1`) |
| Proposal write | `reef-demand.mjs:703` / `reef-miner.mjs:425` | whole-file read-modify-write on shared `lens-c1-adjudication.json` | clobber-prone; workers dodge via `--adj-out` |
| Tape lock | `tape-append.mjs:22-30` | `mkdir` spin-lock, 50ms spin, 5s ceiling → throw | serializes all **7** tape writers |
| Gate subprocess | `harvest-agent.mjs:258` | `execFileSync node harvest-accept.mjs` | 0–50s — the tick's dominant variable cost |
| Throughput | `shootout-ledger.ndjson` | ~50 ticks/hr, ~35 produce a winner | **~204 KB/hr** ledger growth; intake 360–380 passages/tick, 0–12 survive |

Two facts the table makes undeniable:

- **The verdict path is ALREADY LLM-free end to end** (`reef-demand.mjs:30`; the narrator is the
  terminal stage, default B = `grammatical-walk.mjs`, ~50ms, zero LLM; nothing reads its output).
  Streaming changes cadence, not authority — Layer 3 below concerns the *navigator*, never the verdict.
- **Latency is not the only waste — re-derivation is.** The live ledger shows consecutive ticks
  seating the SAME child cell with byte-identical rows (`child:C,B1/A,B3 fit 0.7078`, twice in a
  row at 10:53 and 10:55). A batch loop that forgets its own last answer pays full price to
  recompute it. Streaming 100× faster without fixing this would re-derive the same cell 100×
  faster. The persistent in-memory index (Layer 1) is what makes the delta-novelty check cheap:
  a stream that knows what it already holds only pays for what changed.

## 2. Layer 1 — Reliability: Persistent IPC and Zero-Copy Math

In a discrete loop, reliability is threatened by process volatility — V8 garbage collection,
Node cold-starts, and the ~1.3MB of reef JSON each of the 5 per-tick processes re-parses from
disk before doing any work. The v5 spec eliminates the spawn cycle entirely.

- **Persistent sidecar:** the PMU transitions into a persistent, local-first **Rust sidecar
  daemon** — not hypothetical: `pmu-onchip --resident` is already a stdin-driven persistent loop
  in the shipped binary. This spec promotes it from demo mode to the loop's substrate: boot once,
  hold the reef/snippet/burn-mass index in memory, serve every tick. Rayon work-stealing across
  cores (already in the crate) gives the walk its ~6M walks/sec; no V8 in the hot path.
- **Zero-copy streams:** the AST parser does not write chunks to a file for a driver to re-read.
  It pipes them over IPC (Unix domain socket) directly into the sidecar's memory. The sidecar
  holds open `zlib`/gzip compression streams — no reallocation, no GC spikes, no cold start.
- **The matrix shootout (M voids × N tiles) runs continuously in native memory** at single-digit
  millisecond latency instead of the measured 2,807ms per width-8 batch (~350ms/target) — and
  because the index persists, it re-fits only deltas, killing the byte-identical-reseat waste
  visible in the live ledger.
- **The reliability pitch:** race conditions and memory spikes are eliminated by construction —
  the machine never stops breathing.

## 3. Layer 2 — Accountable AI: The Event-Sourced Actuarial Tape

The spin-lock was the right armor for a file-based batch world. Streaming removes the lock by
removing the file dependency — while KEEPING the one-door invariant. The door stops being a
lock and becomes a pipe.

- **The delta pipe:** persistent PMU workers never open the tape file. They emit verified
  `settlement_receipts` as fire-and-forget deltas into a strictly ordered, append-only local
  socket (the event stream).
- **The single writer:** one isolated aggregator thread reads the pipe and flushes sequentially
  to disk (NDJSON append — the same daily-append shape the lens-receipt refactor already chose).
  Lock contention drops to zero; write concurrency is bounded only by SSD I/O.
- **Invariants preserved, not relaxed:** append-only · never delete (auto-archive stays) ·
  SPLIT verdicts stay resident · one writer of record · **hash-chained** (`parent_hash` per
  delta, the v2.21 mesh discipline, so ordering itself is cryptographically attested).
  `tape-append.mjs` becomes the compatibility door that feeds the same pipe — all 7 existing
  callers keep their contract unchanged.
- **The accountable-AI pitch:** every decision the LLM proposes and every physical verification
  the PMU executes is captured as a real-time, immutable delta. If an underwriter needs to audit
  an AI's behavior from 4:12 PM last Tuesday, the event stream provides a mathematically
  un-forgeable, microsecond-accurate replay of the exact context the machine was holding.

## 4. Layer 3 — The LLM: From Stateless Prompts to Pinned Context

Today every LLM consult re-reads the state of the Tesseract from scratch. The v5 spec makes the
LLM a continuous co-processor instead of a batch oracle.

- **Context caching:** the 144-cell grid dumps and rule structures are pinned in the model's
  active context (prompt-cache / KV-pin). They are ingested once per epoch, not once per tick.
- **Streaming deltas in, streaming targets out:** as the PMU settles a promise and emits a
  receipt, that tiny delta streams INTO the hot context over an open SSE/WebSocket channel; the
  LLM streams back the next coordinate targets without re-reading the baseline map.
- **Dynamic paging (the anti-bloat fence):** because §9 spawns child shelves continuously, the
  grid's physical mass fractures downward without bound — an infinitely fracturing Tesseract
  cannot be pinned inside one context window without blowing the token limit or degrading
  attention. The pin is therefore limited to the **Depth-0 Macro Grid** (the top 144 cells +
  standing rules); child-shelf dumps are **paged in on route** — only when a prompt lands in
  that sector does its street-view stream into context. The model always holds the map of the
  universe; it downloads the neighborhood only when it enters it.
- **HARD FENCE (unchanged from canon): THE RECEIPT IS LLM-FREE.** The streaming LLM observes the
  exhaust and proposes targets; it never sits in the verdict path. σ, placement, lane, and every
  settlement receipt remain a pure deterministic function of the commit/delta — reproducible with
  zero model calls. Streaming makes the LLM *faster at reacting to* the receipts; it grants the
  LLM no new authority over them.

## 5. The Protocol Reality Check — the Decidability Fence

Moving from discrete software to a continuous streaming protocol is a massive structural upgrade,
but it does not exempt the system from the laws of computation. **A streaming protocol does not
save you from Rice's Theorem — and we say so first.**

- Any non-trivial semantic property of a program is undecidable. We cannot — and do not —
  mathematically guarantee that a streamed AI decision is "bug-free" or "factually true."
  Nobody can; the sellers who imply otherwise are the market's adverse-selection problem.
- **We don't underwrite *truth*; we underwrite *origin and placement*.** The v5 streaming
  protocol guarantees, with cryptographic certainty (ed25519-sealed deltas, the same seal
  discipline the flight tape carries today), the exact unbroken chain of custody: how a piece of
  logic entered the grid, what context justified it, and how it mathematically altered the mass
  of its neighbors. **We price the verification of the WHERE, not the WHETHER.**
- This is the fence that closes the broker: the claim gets *stronger* under streaming (custody at
  per-delta grain, microsecond replay) precisely because it never overreached into the
  undecidable half.

## 6. Around the corner — what the throughput buys (market penetration)

Throughput is not vanity; each order of magnitude unlocks a specific GTM proof:

- **Foreign-repo bootstrap becomes a LIVE demo (THE gap on the four-proof runway).** Everything
  measured so far is on our own curated repo. The deal-closing demo is `npx thetacog-mcp
  bootstrap` on an unseen repo → the miner+loop build a reef from that repo's own text → F1 ≥ 0.8
  on traps generated there. At hundreds of KB/hour that is an overnight batch job we schedule; at
  MB/s it runs **in the room, on the prospect's own repository, while they watch**. The streaming
  engine is the delivery mechanism for proof #2 — the one build that changes what we may claim.
- **The endurance claim compounds:** "runs every 15 minutes unattended" became "77-second duty
  cycle" and becomes "continuous — the tape never stops." A flight recorder that breathes is a
  categorically better artifact for an underwriter than one that snapshots.
- **The demo choreography (the alpha move):** open with the existing two-command proof line
  (`npx thetacog-mcp attest-demo` + `prove-rice` — the chip places byte-identically, the model
  signs nothing recomputable), show the dot (the running discrete loop, live status line, real
  receipts), then hand them the line (this blueprint). The prospect sees a working instrument
  AND evidence that the v4/v5 endgame is already architected — conviction, not vaporware in
  either direction. The `bootstrap` subcommand already exists as the stub this grows into.
- **Sequencing discipline (unchanged):** never claim foreign-repo generality until proof #2
  exists. This spec accelerates the proof; it is not a substitute for it.

## 7. Staged migration — S0→S3, each stage shippable, each with its guard

The fallback/test posture the operator asked for: streaming ships as an **opt-in mode**
(`THETACOG_STREAM=1` / `--stream`) beside the discrete loop until parity is proven. The discrete
loop remains the reference implementation the streaming mode is diffed against.

- **S0 — Baseline harness (no behavior change).** Instrument the current loop: per-stage
  timings, bytes-ingested/hour, spawn counts, lock-wait time, emitted to a metrics NDJSON.
  *Guard:* `tests/pmu-simulator/streaming-parity.test.mjs` scaffolding — replays a fixed input
  set through the discrete loop and records the golden receipt sequence.
- **S1 — Persistent sidecar (Layer 1).** Promote the existing `pmu-onchip --resident` loop from
  stdin-driven demo to a Unix-socket service holding the reef index in memory; the shootout runs
  in-process; Node callers talk to the socket with spawn-per-call as automatic fallback (the
  same graceful-degradation contract `bin/pmu-rust.sh` already implements for missing binaries).
  *Guard:* parity test — same inputs through sidecar path and spawn path produce byte-identical
  receipts; latency assertion (p95 single-digit ms per shootout).
- **S2 — Event-stream tape (Layer 2).** Aggregator thread + delta pipe; `tape-append.mjs`
  rewired to feed the pipe (API unchanged for callers). *Guard:* the existing one-door guard
  extended — concurrent-writer fuzz (N writers × M deltas) must yield zero lost/duplicated
  events and a strictly ordered tape; same-inputs-twice → identical tape.
- **S3 — Pinned-context LLM (Layer 3).** SSE channel + context pinning for the navigator.
  *Guard:* `receipt-is-llm-free` guard re-asserted over the streaming path — kill the LLM
  channel mid-run and the tape/receipts must be unaffected (the co-processor is advisory only).

Each stage lands with its guard **in the same commit** (CODE DEFINITION-OF-DONE); a stage that
can't state its failing test first is not ready to build.

## 8. Paths not taken (named, delegated — never dropped)

- **Kafka/Redpanda or any external broker** — rejected: the whole pitch is local-first, runs via
  npx, data never leaves the building. A broker dependency breaks the `npx thetacog-mcp` proof
  line. (No delegation needed; recorded as an anti-path.)
- **SQLite-WAL as the event stream** — viable lower-risk alternative to a socket pipe (the
  substrate spec already standardizes on SQLite); delegated to 📐 architect as a S2 design
  option to be decided by the S0 measurements, not by taste.
- **Go instead of Rust for the sidecar** — rejected: `pmu-rust/` already exists in-package;
  never reinvent running code.
- **Jumping straight to S3** — rejected: without S0 golden receipts there is no parity oracle,
  and an unguarded migration of the tape is exactly the clobbered-SPLIT class again.

## 9. The Knock-On Loop — the streaming proof-of-concept we build NOW

This is the mechanism that transitions the architecture from a static map into a self-healing
learning engine: the exhaust of the LLM wired directly back into the intake of the Tesseract,
the grid forced to permanently mutate until it perfectly catches the prompt that spawned it.
It is the perfect candidate for the v5 streaming architecture — and the physics and the graph
are buildable in the discrete PMU today. **We do not append the LLM's answer to a file; we
execute a closed-loop deterministic verification:**

1. **The Miss (the trigger).** A prompt P enters the grid and returns a weak match (e.g. NCD
   0.85 to its best template/rule). The turn produces a novel answer, rule, or template T.
2. **The Injection.** The knock-on function intercepts T — not as a string but as a proposed
   payload (Reality).
3. **The Topological Tweak (the child shelf — NEVER the parent).** The sequence is rigid: the
   PMU **never mutates the parent cell's core vocabulary** to force a lock (that overtrains the
   parent into a brittle one-key lock and destroys its general semantic gravity). It immediately
   spawns a highly specific **child shelf** seeded from T's own vocabulary, and applies P's
   distinguishing terms *only to the child*, batch by batch. The parent keeps its broad gravity;
   the child is the ultra-precise receptor.
4. **The Verification (the knock-on).** Re-evaluate the ORIGINAL prompt P against the grid. The
   lock is **topological**: the child shelf must be the top catch for P with a clear margin
   (≥ 2 stemmed hits over the runner-up — clear of the steering band). The NCD coherence curve
   is the graded exhaust, measured **relative to the physical floor** NCD(P,P) — gzip physics
   forbids an absolute ≤ 0.05 for non-literal text, so the green line on the graph is drawn at
   floor + 0.05, never at a fixed absolute. Termination is the **Derivative Circuit Breaker**,
   mathematically defined: the loop halts when ΔNCD < 0.005 across a 3-step trailing window —
   the moment the math proves further refinement yields no structural density. A halt without
   the topological lock is recorded as an honest non-lock (`local-max`) — never a faked pass,
   and an unlocked shelf is **never applied** to the live reef.

**The convergence receipt** is an NDJSON row per iteration (prompt-hash, cell, NCD, action
taken: seat/vocab/split), LLM-free like every receipt — so "we know where the new knowledge
ended up" is a replayable trajectory, not a claim.

**The demo graph — Coherence Convergence.** The demo page is strict static HTML built from
receipts (zero page-JS), so the PMU renders an inline SVG strip from the convergence receipt:
Y = NCD from 1.0 (total miss) down to 0.0 (perfect lock), with the 0.05 threshold as a hard
green limit line; X = iterations; tick 0 a red dot high on the axis, the injection drops the
line, the topological tweaks step it down, the lock punches through the green line. It proves
to the underwriter that the knowledge didn't just "go somewhere" in a vector database — the
system physically hammered the geometry of the grid until the new rule magnetized the original
prompt.

### 9a. The Injection Traps — the corners, named before the broker names them

- **The Overtraining Trap (brittle locks).** Aggressively mutating a Tesseract cell to lock one
  prompt destroys its ability to catch anything else — a lock that accepts one exact key instead
  of a semantic gravity well. Fix (rigid, guarded): parent vocabulary is read-only to the loop;
  the 95% receptor is always a spawned child shelf. Guard: the knock-on test asserts the parent
  `domains` array is byte-identical before/after an apply.
- **The Asymptotic Split (fractal explosion).** A hard absolute NCD ≤ 0.05 is near-impossible in
  natural language unless it is a literal string copy; a dumb `while (ncd > 0.05)` loop would
  fracture the grid into thousands of microscopic shelves and blow out process memory. Fix: the
  Derivative Circuit Breaker above — the demo graph must show the curve *flattening into* the
  lock, which is itself the proof the breaker fired at the local maximum.
- **The Hallucination Permanence (truth vs placement).** If the model's T is well-formed but
  factually wrong, the loop will still seat it — by design. We verify **placement, not truth**
  (the Decidability Fence, §5). The operational answer to "what happens when the AI learns a
  lie?": the convergence is recorded as an immutable delta sequence (the receipt carries the
  exact seated entry, `born_of` prompt-hash, and reef sha before/after), and revert is a
  **Tombstone Operation** — `knock-on.mjs --revert <name>` does not rewrite history or delete
  the physical topology (a shelf that lived for days may have magnetized legitimate downstream
  children; deleting the parent would orphan valid structure). It appends a correction: the
  entry's vocabulary (`when` bag) is zeroed so the scorer can never pick it again, the
  hallucinated payload is flagged with its `reverted_hash`, and the structural mass stays
  intact for anything that grew beneath it. Deterministic, O(1), receipted. We don't just know
  where the knowledge is; we can cleanly amputate its *pull* without breaking its neighbors.
  The system is accountable, not infallible.
- **The Honest Non-Lock Liability (the Orphan Ledger).** A circuit-breaker halt without the
  lock must not silently drop the payload — a system that quietly discards data it couldn't map
  is a liability hole. A non-lock therefore **quarantines the full payload** into the
  append-only orphan ledger (`data/pmu/knock-on-orphans.ndjson`): prompt-hash, the complete T,
  the step trajectory, and the stop reason. Nothing ever evaporates. The machine doesn't just
  know what it knows; it mathematically proves exactly what it *failed* to map, and the
  unmapped payloads queue for a human operator or a future model to resolve.

### 9b. The Underwriter's Benefits — what the loop proves

- **Cryptographic proof of learning.** No black-box "confidence score": a re-computable tape
  receipt proves the exact topological delta required to seat the knowledge — a legally
  auditable chain of custody for machine learning itself.
- **The terminal efficiency curve (the cache-hit monopoly).** Because the grid physically morphs
  to catch the prompt, the next similar prompt is caught at the newly formed dense shelf and
  bypasses generation entirely: the system gets computationally cheaper and faster the more it
  is used.
- **Live auto-healing.** A miss doesn't just fail; it builds the exact geometric structure that
  makes that specific miss mathematically unrepeatable — with the graph as the visible repair.

### 9c. The Stop-Hook Auto-Trigger — the loop fires itself (explicit operator go, 2026-07-22)

The demo climax is autonomy: a prompt the grid doesn't know misses, the turn produces the
payload, and — zero human intervention — the Stop-hook fires the knock-on detached the moment
the turn completes. The broker watches the grid fracture, seat the shelf, re-catch the original
prompt, and draw the SVG in front of them. "Watch it learn right now."

- **Asynchronous detachment (the hook NEVER blocks):** the Stop-hook shell detaches the worker
  (`nohup … & disown`) and exits instantly — the user gets their answer at full speed while the
  grid heals in the background. Same non-blocking law as every hook in this repo.
- **Fire discipline (no runaway fracturing):** the worker fires only on a real MISS (existing
  topology's top catch below the miss threshold), dedupes by `born_of` prompt-hash (the same
  prompt never seats twice), and respects a daily auto-shelf cap — every skip is logged with its
  reason, never silent.
- **The rollback guard (live-demo insurance):** every auto-seated shelf logs its exact ID and
  the ready-to-paste amputation command (`node scripts/pmu/knock-on.mjs --revert <name>`) to
  `.thetacog/knock-on-live.log` — if the live demo behaves unpredictably, the operator amputates
  mid-sentence without skipping a beat.

### 9d. Advanced Mode + the Goal Loop — the autonomous diligence engine (built 2026-07-22)

We didn't just build the streaming architecture; we built the adversarial loop that attacks it.
`scripts/pmu/goal-loop-v5.mjs` fires the failure modes an underwriter hates most at SCRATCH
copies of the reef (the live reef is sha-verified untouched) and writes one recomputable
receipt (`data/pmu/goal-loop-receipt.json`). The demo page's **Advanced Mode** strip — a
checkbox below MILESTONES, pure CSS toggle, zero page-JS — splits into NORMAL (the dot: one
pulse per measured 72s batch cycle) vs ADVANCED (the line), rendering ONLY from that receipt.
No receipt → the strip ships dark. A red engine renders FAILED — the strip cannot
cosmetically pass (guard-enforced anti-forgery negative).

- **Gotcha 1 — the Tombstone Race (the ghost catch).** Interleaved seat/route/revert storms on
  one coordinate: a prompt must never route to a shelf whose vocabulary was zeroed mid-flight.
  First live run: **10 storms, 400 routes, 0 ghost catches** — the zeroed `when`-bag makes a
  ghost catch structurally impossible, proven under fire, with clean fallback to the parent.
- **Gotcha 2 — the Orphan Siphon (the silent memory leak).** A token-disjoint noise flood
  against the hard ledger cap (`MAX_ORPHANS`, default 10,000): **flood 120 vs cap 50 → ledger
  flatlined at exactly 50, 70 rejections flagged + hard ALERT file** — the disk survives the
  DDOS, nothing silently eaten.
- **Gotcha 3 — the Paging Thrash (the LLM stutter).** Ricochet prompts across orthogonally
  distant coordinates. S3 is not built, so this records the **honest INFO baseline** (mean
  0.057ms route latency today) — a benchmark for the S3 hysteresis/warm-cache requirement,
  never a pass it didn't earn.
- **The Multiple — measured, not projected.** 259.6 full in-memory convergences/sec vs the 72s
  discrete cycle = **×18,694 measured** on this machine. The S1 sidecar's job is not to invent
  this speed; it is to make the already-measured in-memory cadence the shipped cadence.
- **The pitch:** "Anyone can make a system go faster. We built a system that survives its own
  speed — live race conditions, memory-leak floods, and hallucination reversions fired at the
  stream, caught and receipted without dropping a frame of custody."

**Now vs. later (the fence against breaking things):**
- **NOW (discrete, safe):** knock-on runs as a detached post-lens call; it iterates on an
  in-memory copy of the reef, writes the convergence receipt NDJSON (a NEW append-only file —
  no shared-file clobber), and applies the final seated entry atomically with a
  lens-still-works validation before the write lands. The lens read path is untouched.
- **LATER (v5):** in the discrete loop this convergence costs multiple forced batch cycles; in
  the IPC socket architecture the entire loop happens in single-digit milliseconds inside the
  persistent worker's memory before a single byte is flushed to the tape. The knock-on loop is
  therefore the first workload the S1 sidecar serves — the streamer is based on it, not the
  other way around.

---

*The receipt stays deterministic and LLM-free at every stage; the walk stays the real recursive
ballistic walk on the connectivity lattice — streaming changes the plumbing's cadence, never the
physics of the verdict.*
