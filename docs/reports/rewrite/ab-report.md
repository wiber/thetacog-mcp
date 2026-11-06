# Ghost-Read Matrix — A/B report

<sub>Generated 2026-11-01T15:01:06.234Z · rolling 14 days · regenerate with `node scripts/rewrite/report.mjs`</sub>

**This file is committed on every run, so `git log -p docs/reports/rewrite/ab-report.md` IS the
experiment's history.** Every number derives from the append-only ledger
(`.thetacog/cache/rewrite/ledger.ndjson`); nothing is carried forward by hand.

## The question

Does Tesseract-guided rewriting (tracks **B** and **D**) produce prose a human
actually accepts more often than raw model output (tracks **A** and **C**)?

**Current standing — guided 0 · raw 0** 

> ⚠ **Not callable yet.** 0 decisions recorded; this needs volume before the gap means anything. Reported as a running count, not a verdict.

## Win rate by track

| track | offered | won | win rate | avg ease Δ | avg latency | success |
|---|---|---|---|---|---|---|
| **A** local | 0 | 0 `··················` | —% | — | 45.0s | 0% |
| **B** local+tesseract | 0 | 0 `··················` | —% | — | 34.3s | 0% |
| **C** cloud | 0 | 0 `··················` | —% | — | 56.7s | 100% |
| **D** cloud+tesseract | 0 | 0 `··················` | —% | — | 35.4s | 75% |
| MANUAL | — | 0 | — | — | — | — |
| kept ORIGINAL | — | 0 | — | — | — | — |

<sub>**Latency is part of the result**, not overhead: a track that cannot answer in time
loses cards it might otherwise have won. Success% is runs that returned a usable
rewrite before timing out.</sub>

## Prose actually improved?

| metric | value |
|---|---|
| edits measured | 0 |
| avg Flesch reading-ease Δ | **—** (higher = easier) |
| avg grade-level Δ | **—** (lower = easier) |
| edits that improved ease without bloat | **—%** |
| paragraphs logged "good enough" | **0** |

<sub>"Good enough" is the control group: paragraphs the reader followed cleanly, logged
rather than silently skipped, so the edits have something to be measured against.</sub>

## Did comprehension actually rise? (re-scan after edit)

**The only direct test of the claim.** Every other number here is a proxy;
this one re-reads the edited passage with the same reader and compares. If the tool
works, most edits improve and the average delta is positive. If it does not, this is
where it shows first — and this should be believed over the proxies.

| | value |
|---|---|
| edits re-scanned | **0** |
| comprehension improved | 0 (**—%**) |
| got worse | 0 |
| **average score delta** | **—** |

> Nothing re-scanned yet — it fires automatically on the next accepted edit.



## Is the flagging engine any good? (monologue precision)

The only number that grades the **diagnosis** rather than the rewrite. Without it
the system is unfalsifiable — it would keep flagging confidently and nobody would
ever learn it was wrong.

| | value |
|---|---|
| flags graded | **0** |
| right | 0 |
| partly | 0 |
| wrong (false flags) | 0 |
| **precision** (right + ½·partly) | **—%** |

> No monologues graded yet. Press `r` / `p` / `w` on a card — this is the loop that tells you whether the reader model is worth trusting.



## Where does the fence help? (win rate per defect class)

The most actionable cut for developing the lattice — guidance may help on undefined
terms and do nothing for pacing, and an aggregate hides exactly that.

| defect | decisions | guided (B+D) | raw (A+C) | manual | kept original |
|---|---|---|---|---|---|
| — | no decisions recorded yet | | | | |

## Real reader drops

Pasted human reactions, anchored to sentences by a subagent and queued **ahead of**
generated findings. A model's guess about where a human stumbles is a hypothesis; a
reader saying "I lost you here" is evidence.

| | value |
|---|---|
| documents with drops | 0 |
| drops recorded | **0** |
| sentences anchored | **0** |

## Day by day

| date | accepted | skipped | good-enough | manual | avg ease Δ | avg slop Δ | tracks |
|---|---|---|---|---|---|---|---|
| — | no decisions recorded in the window | | | | | | |

## The standing caveat (do not delete)

Tesseract **drift** is reported as displacement magnitude, **not** quality, and is
weighted **zero** in every ranking here. Calibration
(`node scripts/rewrite/calibrate.mjs`) showed deliberate nonsense scoring at or
above a genuine rewrite in 2 of 4 sampled paragraphs, because `MIN_GZIP_BYTES ≈ 220`
and one sentence lacks the mass for a stable walk. The signals carrying weight are
the deterministic slop delta, the readability delta, and which card the writer
accepted.

## Sessions

| file | cards queued | accepted | last touched |
|---|---|---|---|
| `../../src/content/blog/2026-08-11-slop-is-not-what-you-meant.mdx` | 11 | 0 | 2026-08-12 16:32 |
