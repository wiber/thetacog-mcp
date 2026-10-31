---
name: "Tend"
description: "Go through every board sheet with /steer and keep them reasonable, consistent and aimed at the most aggressive outcome the record supports: pull every sheet, run the consistency checklist, turn each break, gap, comment and trailing aim into a /steer row, rewrite the sheets cell by cell, and report. Triggers: '/tend', 'tend the sheets', 'keep the sheets consistent', 'go through all sheets', 'sheet sweep', 'are the sheets consistent', 'tidy the board'."
---

# /tend — the sheets stay true, and the aim stays high

Operator 2026-10-20, verbatim: *"how can we make a skill that uses /steer to go through all sheets and keep them reasonable and consistent (with the best possible, to the limit aggressive) outcome.."*

**The two forces held together:** *reasonable and consistent* means every number, date and status on a sheet is one the record holds. *To the limit aggressive* means the aim line (kind `aim` in `docs/specs/vna/days180-events.json`) is the target the work is measured against. **An aim is never lowered to fit the evidence. When the evidence trails an aim, the gap becomes a row that closes it. An aim moves only on his word.**

## What the pass is for: coherence on three axes, then the skim (operator 2026-10-24)
Verbatim: *"make things more cohesive, coherence and consistent across time scales and across categories … think of the skill command as a way to create coherence and then skim the cream of the Top with the flow chart."*
- **Across time scales.** Every row names the horizon it serves (`→ H-NN`), and the Horizons chain runs backwards from 1000 years to today with no gap (R2). A row naming no horizon has no question it is sufficient for (AXIOM 1 W6): the pass names it, never ranks it.
- **Across categories.** A ticket is formulated in ONE place, its HOME (the sheet whose ID column carries it, or the spec), and every other sheet shows it by id and links home. Never a second copy of its text (P1, P6). A ticket ticked at home leaves every NOW sheet in the same pass.
- **The skim.** The cream is the open threads with the widest reach across categories and the nearest horizon. It feeds THE TOP, where START HERE's flowchart ends (F-14, ≤10 decision-ready rows, C1030). The cream is read off the threads, never chosen by feel.
- **His words leave the sheet in the same pass that acts on them.** A held word (its row STUCK, open or never declared) is listed with its gate, and this pass works that row itself: it edits the source, ticks the row with its commit, then closes the word to the Log. A STUCK row is never left for a runner that already refused it twice.

## The pass, in order (every door below exists; run them, never re-derive them)

1. **Pull.** `node scripts/vna/steer-board-sync.mjs` reads the board, lands typed answers on their rows and runs his own comments as /steers. Then `node scripts/ops/board-watch.mjs` records every share-sheet cell (K4, Bryan); those are recorded and never dispatched.
   **Then every edit he made, wherever he made it:** `node scripts/ops/board-edit-reconcile.mjs` copies Google's edit log (every cell he changed, old and new, (fill) or not) into `data/vna/board-edits.ndjson`. An edit to our own text on an internal sheet is his word too: its work is to fold his text into the source, so every surface others read shows it. UNMEASURED until the trigger is installed (`scripts/ops/board-edit-trigger.gs`, his one paste) — say so in the report, never skip it.
   **Then the inbox, every pass, never skipped — close first, then steer.** `node scripts/ops/inbox-unworked.mjs --close` moves every steered word whose row is ticked and named by a commit to its sheet's Log tab with that commit, and clears the cell (his new words, typed since, stay). It then prints every HELD word with the gate that holds it (no row declared · row open with the runner's last verdict · ticked without a commit). Each held word is worked in THIS pass, as the coherence block above says, and the report lists any that remain with the reason. Then `node scripts/ops/inbox-unworked.mjs --steer`. The watch's hand-off is a filing, never a worker (2026-10-21: 398 of 400 bf- asks pending, 22 of his cells with no commit). This door takes every word he typed on any internal sheet that no commit has acted on, and runs them through `/steer` as rows, exactly once. A word leaves the sheet only through `notes-to-log.mjs` with the commit that acted on it; a cell is never moved to a Log tab without one. Guard: `tests/ops/inbox-unworked.test.mjs`.
2. **Check.** `bash scripts/ops/plan-consistency.sh` covers:
   - the aim chain
   - finance totals against their rows
   - first close after the S revocation
   - fixed dates inside travel, which are flagged, not failed
   - the Mailbox ranked by the Horizons: every open decision carries WHY (the horizon it serves) · RESULT (how we know) · MASSIVE ACTION (our recommendation first); a decision naming no horizon is sludge, listed last (`node scripts/ops/mailbox-rpm.mjs`)
   - the backward chain every Horizons row names (the horizon it CAUSES) and every `(tend: ...)`-tagged steer row (the horizon it SERVES); either naming none is sludge, counted and listed (`node scripts/ops/horizon-sludge.mjs`)

   **Then the threads, one ticket across every sheet:** `node scripts/ops/board-threads.mjs` reads every internal sheet's local copy and follows each id (C-row, H-, BP-, R-, D-) across them. It prints:
   - **STALE:** a row the spec ticked, still shown on a NOW sheet (Today, Mailbox IN, Steer · Compiled, Priorities).
   - **NO HORIZON:** an open row crossing two or more sheets that names no time scale.
   - **THE CREAM:** the ten open threads by reach plus horizon nearness, each with its home sheet's link.
   Mirror sheets (more than half the spec, such as Spec and Tesseract) never add reach. STALE and NO HORIZON become /steer rows in step 4, and THE CREAM opens the report. Guard: `tests/ops/board-threads.test.mjs`.

   Then `node --test tests/ops/board-requirements.test.mjs tests/ops/board-180-days.test.mjs tests/ops/board-cells.test.mjs` checks that statuses match the spec and that the week and year grids hold.
3. **Find the gaps against the aim.** For each aim whose date is near or past, ask whether the benchmark or fixed date that proves it is on the record:
   - **AIM BEHIND:** the aim's date has passed without proof. It becomes a row: what closes the gap by when.
   - **AIM UNPROVED:** no benchmark names how we would know the aim was hit. It becomes a row: name the check.
   - **STALE ROW:** a sheet status older than its source, such as a ticked spec row still shown open. The writer fixes it on the next pass.
4. **Steer every finding.** Each ✗, ⚑, AIM BEHIND, AIM UNPROVED and every unanswered share-sheet comment goes through `/steer` as its own row, carrying the sheet, the row id and the source line, tagged `(tend: sheet=<sheet> row=<id> → H-NN)` naming the horizon (`docs/specs/vna/horizons.json`) it serves. A row that cannot name one is sludge — `/tend` names the gap instead of filing the row untagged. `/steer` places it, ranks it and dispatches it as a turn-capped worker. Nothing here fixes a sheet by hand. Checked by `scripts/ops/mailbox-rpm.mjs --chain`, step 7 of the checklist below.
   **Every row step 4 writes is compiled first (C1221):** pass the findings to `node scripts/vna/steer-compile.mjs "<one finding per line>"` and read the txt it opens before the rows go to /steer. Each finding then carries its basin, the nearest rows already asked, the rules that bind it, a proposed guard and its six percentages. A finding whose Predictive Power is 0% gets its file named in the txt first. Every compile also lands on the record `data/vna/steer-compiled.json`.
4b. **The lens sheets (one per person, `docs/specs/vna/lens/<slug>.json`).** `node scripts/ops/board-lens.mjs --act` lists every focus item at ≥80 % understood with what we do, every comment typed on a lens sheet, and every item below the gate with the question to ask first. Each act goes through `/steer` (an email is composed, graded ≥95 per need, then armed through the comms pipeline). Then record it: `node scripts/ops/board-lens.mjs --act done <slug> <ref> "<what we did>" --commit <sha>`. SHARE is a separate call per person (`person.share`: yes / not yet / never, with why). The win condition is recognition: they read the sheet and say it is them.
4c. **His fingerprints, before any prose is rewritten.** `node scripts/voice/sent-index.mjs` copies the WhatsApp store and grades what he sent. It also matches each drafted DM to what he actually sent, and writes `out/voice/sent-index.json` (gitignored; private messages never enter the repo). `--moves` prints the fingerprints: the words he adds and cuts, and how answered DMs differ from unanswered ones. Read the MOVES and the nearest snippet in `data/voice/snippets.json` (the Book Ledger's Snippets tab), and fill one of his shapes before inventing one. A new line of his that drew an answer, or one he calls good, is added to `snippets.json` with its why, its use and its ref. The Snippets tab ranks by his pick and what a line drew, never by reading ease. The readability floors stay on the surfaces that carry them; a snippet is never rewritten to raise its ease. Guard: `tests/voice/sent-index.test.mjs`.
4d. **The network sheets — every LinkedIn connection and X follower, through named steps, never a pile** (operator 2026-10-22: "rework the data pipeline so we explicity set up information works through /tend through a set of steps to make them clearer and not sludge … all should be in there though, with commentary on where they fit"). `node scripts/ops/social-pipeline.mjs --status` shows each step's file, count and age. The steps, each one file under `out/board/social/` (gitignored: other people's names never enter a tracked file):
   1. **parse** the paste (`docs/05-content/blog/scratchpad/linkedinE.txt`), joined to People and the Investors sheet. Nobody is dropped.
   2. **fit**: the headline read. The bucket, the words that put them there, the Horizon it serves, a prior 0–9, one line of commentary, labelled "read off the headline".
   3. **shortlist**: the strongest priors (120) go to research.
   4. **research**: parallel turn-capped `claude -p --model sonnet` workers on the web, run outside the repo. A claim with no URL reads UNMEASURED, and a person not found reads "not found". Resumable: a batch on disk is kept.
   5. **rank**: research where it exists, else the headline prior.

   Then write `--spec network-li` and `--spec network-x` (step 5). A new paste re-runs from parse; a new research pass needs `--step research` after deleting the batches you want redone. Guard: `tests/ops/social-pipeline.test.mjs`.
5. **Write.** `--spec steer-compiled` writes **Steer · Compiled**: every compiled ask, scored out of six, under a TOP block of ten live Sheets formulas (`=INDEX(SORT(FILTER(…)))`, one per cell, over the sheet's own rows) that skim the highest score off the top. The record is the pipe and the formula is the skim; the sheet never reads another sheet's cells. The formula grid needs the version-2 cell writer, and the writer refuses on version 1 and names the redeploy (`scripts/ops/board-steer.mjs`, guard `tests/ops/c1221b-the-compiled-steer-on-the-board.test.mjs`).
   For each spec, run `node scripts/ops/board-requirements.mjs --spec <priorities|k4|bryan|finance|days180|year|start|network-li|network-x|steer-compiled|lens-<slug>|share-<slug>>`, then `node scripts/ops/board-lens.mjs --tabs` for every lens sheet's Rules (the general lens rules, then theirs) and Log (the act ledger). It writes cell by cell through the Apps Script writer. A conflict is a cell he or a counterparty typed; it is left as typed and listed.
6. **Report.** Bash-open one `.txt` (never the clipboard) with:
   - THE CREAM first: the ten threads to move, each with its horizon and its home sheet's link
   - his held words: each one worked this pass with its commit, or still held with the gate and why
   - checklist pass or fail
   - rows steered, with their ids
   - conflicts left as typed
   - aims behind, each with the row that closes it
   - what is UNMEASURED and why
   - **the link to every sheet the pass touched**, `https://docs.google.com/spreadsheets/d/<id>/edit` with the id read from `data/vna/board-drive.json`, never typed (operator 2026-10-23: *"always include the links to relevant sheets for my and the agents to follow"*). The chat reply carries the same links, and so does any steer row or flowchart that names a sheet.

## Hard rules
- **Never write in a (fill) cell**, and never answer a decision row (`/board` rules).
- **Never lower an aim** to make a sheet consistent. Raise the work instead, or ask him in one line whether the aim moves.
- **Share sheets carry need-to-know only.** An aim, a finance line, the S-election options and anyone's error never reach a sheet shared with K4 or Bryan.
- **A finding becomes a /steer row, never an edit to a derived cell.** The source file changes and the writer follows.
- **Respect live WIP claims:** `node scripts/ops/wip.mjs check <paths>` before touching a source another session holds.

Related skills: `/priorities` (the sheets and the writer) · `/board` (the board doors) · `/steer` (the rows).

## The skills call each other (operator 2026-10-21: "make sure that we let the skills call the other")
- `/steer` runs the board first (C1025), then the rows; after a cycle that changed a sheet's source it runs `/tend`'s write step.
- `/tend` checks every sheet and files each finding as a `/steer` row; it never fixes a sheet by hand.
- `/priorities` turns a paste into rows; `/tend` keeps those rows true afterwards.
- `/board` holds the doors all three use.
- Every write is cell by cell (`planGrid`, compare-and-set; no whole-file rewrite exists). Every sheet has a Rules tab (S1–S5, `node scripts/ops/sheet-tabs.mjs`) and a Log tab. A note of his that a commit acted on moves to that Log tab with the commit: `node scripts/ops/notes-to-log.mjs --sheet "<sheet>" <id> "<field>" <commit> "<what we did>"`. The move is the receipt.
(You are in `/tend`.)

