---
name: project
description: "The project sheets — one sheet per project (Project · GTM, Project · Code) that prints how the steer is doing: what is done over what is next, every row a spec row with its guard, its files, its tags and its Merkle leaf, a comment and a ✓/✗ cell on each, ticked rows moved into DONE · LOG by program. Steer writes them between cycles when enabled; this skill runs them on ask, reads his comments back, and flips the switch. Triggers: '/project', 'project sheet', 'the project sheets', 'how is the steer doing', 'what is done and what is next', 'write the project sheets', 'the GTM project', 'the code project', 'the tree sheet', 'turn the project sheets on/off'."
---

# /project — the project level, one above the prompt level

Operator 2026-10-30, verbatim: *"we need a check box or a comment on how it went for the spec written, and it needs to be always called by the sear when we enable it so this is sort of like the second incentive project level, not the prompt level"* · *"the left offer part of it needs to be absolutely legible for a human to see what has been done over what is next"* · *"move the completed Rose to the lawn section right that's something we should be able to not generate actually program"*.

**The prompt level** is Steer · Compiled (`board-steer.mjs`): every dictation's asks. **The project level** is this: the rows a project holds until they are done. Both are spec rows; nothing here is typed by a model.

## The sheets

| sheet | built by | rows |
|---|---|---|
| Project · GTM | `node scripts/ops/board-project.mjs --project gtm` | every C-row `docs/specs/vna/gtm-spec.json` cites, plus every row tagged `(GTM: …)` |
| Project · Code | `node scripts/ops/board-project.mjs --project code` | the goal's units, the compiled steer's asks, rows declared in the last 7 days with a guard; GTM rows excluded; done rows kept 7 days |
| Spec · Tree | `node scripts/ops/board-tree.mjs` | every node of `data/vna/spec-tree.json`, root first, with its LEAF and the project sheet that holds it |

The selection lives in `docs/specs/vna/projects.json`. A new project is a new entry there, never a new script.

**Columns, left to right:** ID · HOW IT WENT · YOUR COMMENT (fill) · OK? ✓ / ✗ (fill) · STATE (✓ DONE · ☐ NEXT · ✋ YOUR ACT · ✋ NEEDS YOU) · WHAT · NEXT STEP or the commit that ticked it · GUARD · FILES · TAGS · LEAF. The first five carry the reading; the rest are the references.

**The move is a program, never tokens.** The NEXT block sits on top by priority (`data/vna/board-heads.ndjson`). The pass after a row's tick lands, the row composes under DONE · LOG, and his cells move with it (the writer keys a typed cell by id and header). The move is ledgered first (`data/vna/project-moves.ndjson`), then appended to the sheet's Log tab.

**The LEAF is where the sheets meet.** A project row's LEAF is the same 10-hex as that row's line on Spec · Tree.

## The loop

1. **Print first, every time:** `node scripts/ops/board-project.mjs --print` (both) or `--project gtm|code`. It reads the spec, the heads, the tree and one cached git pass. No Drive call.
2. **Write on ask:** `node scripts/ops/board-project.mjs --all`, cell by cell, created on the first run in the board folder. `node scripts/ops/board-tree.mjs` writes the tree.
3. **Steer writes them by itself when enabled.** `projects.json` → `steer.enabled`. After each verdict lands, `steer.mjs until` (and `run`, after its dispatch) spawns one detached, `nice 19` `board-project.mjs --between` pass. That pass holds `.thetacog/project-sheets.lock`, writes only a sheet whose composed hash moved, and appends its lines to `.thetacog/project-sheets.ndjson`. **The work comes first; the sheet takes the space between cycles.** Set `enabled` to false to stop it; on ask still works.
4. **His side is read before the cycle.** The sheets are in `data/vna/board-drive.json`, so `board-watch` (C1025's board read) pulls a typed comment or ✓/✗ before the next cycle classifies, and `board-comments.mjs pull` runs a comment as a /steer. A comment a commit acted on moves to the Log tab through `scripts/ops/notes-to-log.mjs --sheet "Project · GTM" <id> "HOW IT WENT · YOUR COMMENT (fill)" <sha> "<what we did>"`.
5. **Away from home:** `npx thetacog-mcp project-sheet --print` · `npx thetacog-mcp tree-sheet --print`. In VS Code: **Steer: 📋 Write the Project Sheets**. A write with no `data/vna/board-drive.json` prints UNMEASURED.

## Rules

- **Never type a row here.** A row that is missing is a selection fix in `projects.json` or a spec row to declare.
- **A path is printed only when it exists on disk.** Spec rows are upper-cased; the token is lower-cased and checked.
- **What it is sufficient for:** where each row stands (ticked or open, by which commit) is read off the spec and git, and anyone can re-run it. **Whether the work was good is undecidable (Rice).** The HOW IT WENT and OK? cells are his reading of that, and the program never fills them.

Guards: `tests/ops/c2170-project-sheets.test.mjs` · `tests/ops/c2170a-tree-sheet.test.mjs` · `tests/ops/c2170b-project-sheets-between-cycles.test.mjs` · `tests/ops/c2170c-project-sheet-door.test.mjs`.
