---
name: "Sheet"
description: "After signing into Google once, write the Asks sheet (every ask of this steer run, then every ask the extension has ever carried, one row per ask in the Steer · Compiled layout: plain head, verbatim span, guard, state, commit and Merkle leaf) and, on ask, the Spec · Tree sheet (the spec's Merkle tree, root first). Triggers: '/sheet', 'the asks sheet', 'itemise the asks', 'write the asks sheet', 'sheet skill', 'sign into Google', 'the merkle tree as a sheet', 'the tree sheet'."
---

# /sheet — the Google Sheets door a stranger can run themselves

(chair decomposition 2026-11-05 of the operator's words *"/steer infer all the features we need to bundle here. So what do we really need to ship with this for the /dir command to be as compelling as possible? We alrea"*, not on the tape: *"Spec adherence ships inside the npm package, and the sheets are how a stranger sees it. — Bundle the Google Sheets integration as skills in the package: /board, /tend and /project, plus a new /sheet skill that, after the person signs into Google once, creates a sheet for a steer run that itemises every ask of that run and of the extension in general, one row per ask with its plain head, verbatim span, guard, state, commit and Merkle leaf, at maximum density so the eye reads it at once, and an option to write the spec Merkle tree as a sheet."*)

**The sheets are how a stranger sees it.** `/board`, `/tend` and `/project` are built for an operator who already holds a Drive folder. `/sheet` is the narrower door: the one Google sign-in, then one sheet.

## The one sign-in

Every sheet door in this package reads the same token: an rclone remote named `thetacog-gdrive` with `scope=drive`. Sign in once:

```
rclone config create thetacog-gdrive drive scope=drive
```

`node scripts/ops/board-asks.mjs` checks this before any write and prints `UNMEASURED — <why> — sign in to Google once, then re-run` and stops cleanly when it is missing — it never guesses a folder or creates one without the sign-in.

## The ask sheet

```
node scripts/ops/board-asks.mjs --print [--rows C1,C2] [--date YYYY-MM-DD]
node scripts/ops/board-asks.mjs [--rows C1,C2] [--date YYYY-MM-DD]
```

Writes the sheet **Asks** (created on the first run, in the Drive folder named in `data/vna/board-drive.json`; rewritten cell by cell after that). One tab, one header, the same layout the operator reads on **Steer · Compiled**: both are composed by one function, `composeAsksTab()` in `scripts/ops/board-steer.mjs`, so what this package writes is what he sees.

- Row 1 is the title, row 2 one sentence saying what the tab is, row 3 the one header.
- **THIS RUN** comes first: the rows in scope (`--rows`, or every top-level row the spec dates today), PROJECT = `THIS RUN (…)`.
- **EVERY ASK OF THE EXTENSION** follows: every other top-level row the spec has carried, PROJECT = `EVERY ASK OF THE EXTENSION`. Each id appears once, because the writer keys your typed cells by id.

The columns that carry a spec row, each read off the record and never typed:

- **ID**: the row's own id. A Sheets comment anchored on this cell resolves back to the row (`anchoredRow()` reads the id off the quoted cell).
- **COMMENT (fill)**: yours, second, blank until you type. Mirrored in the last column so it stays in view when you scroll right.
- **HEAD (draft — rewrite it)**: the plain ask, with the checkbox, guard and span stripped (`headline()`, the same reading `/tend`'s asks ledger uses).
- **ASK (verbatim)**: the row's own quoted words, the fullest `*"…"*` span on the line, never retyped.
- **STATE**: `✓ done` or `☐ open`, with the guard's state (`not written` / `on disk` / `in HEAD`, `guardState()`).
- **COMMITS**: the sha that ticked it, read off the runner's ledger first, then `git log`.
- **GUARD**: the guard's path.
- **LEAF**: the same 10-hex that `/project`'s Project sheets and `/board`'s Spec · Tree print. It comes from one index (`leafIndex()`), read here and never re-derived.

The provenance columns (WHEN, TRANSCRIPT, AGENT, TAPE ROW, STEER FILE, RUN LOG) fill for asks a `/steer` compiled. A spec row leaves them blank and reads `not compiled — a spec row` under EMPTY SLOTS.

`composeAsks()` turns spec rows into asks (`specAsk()`) and hands them to `composeAsksTab()`. No second layout exists to drift from this one. The Google sign-in is checked before the spec or `board-drive.json` is read.

## The option: the spec Merkle tree as a sheet

```
node scripts/ops/board-asks.mjs --tree [--print]
```

Hands off to `scripts/ops/board-tree.mjs` (C2170a) unchanged — the tree-as-a-sheet already exists there, under `/board`, and `/sheet` never re-derives it under a second name.

## Rules

- **LLM-free.** Every cell is read off the spec, git, the runner's ledger and `data/vna/spec-tree.json` — never typed, never summarised by a model.
- **A refused write never claims an empty extension.** Zero asks read is a refusal (`✗ refused`), never a sheet that says "none".
- **Google sign-in is the person's own act.** A missing token stops the write in one printed line; it is never a silent no-op and never a created folder guessing at where the sheet belongs.

Related skills: `/board` (every other sheet door) · `/tend` (keeps the sheets this skill writes consistent and aimed) · `/project` (the project-level sheets, same Merkle leaf).
