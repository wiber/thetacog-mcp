---
name: steer
description: "Run ThetaCog's attractor loop from Claude Code, away from home — the sensors, the map, both arms — through the installed extension's own doors (`npx thetacog-mcp <door>`), never a thetadrivencoach-only command. Splits a multi-job ask into numbered rows before running any of them, plans only unless told to go, and refuses to go on a dirty working tree. Triggers: '/steer', 'steer', 'run the loop', 'where is the work drifting', 'show me the map', 'what is out of lane'."
---

# /steer — away from home, through the installed doors only

This is the STRANGER-SAFE `/steer`. It ships inside the ThetaCog extension
(`packages/thetacog-mcp-vscode/skills/steer/SKILL.md`) and is meant to run in ANY repo
the extension is installed into — never only inside the extension's own development
repo. Everything it runs is a **door**: `npx thetacog-mcp <door> [args]`, the published
package's own dispatch table, never a command that only exists on one machine. If a
door is not listed below, it does not exist here yet — say so (`not run — no <name>
door`) rather than guessing a command that is not present in this workspace.

## The doors

| what it does | door |
|---|---|
| the map + spec as one page (what the sidebar renders) | `npx thetacog-mcp steer-ui` |
| the ballistic walk on the chip — the three panels | `npx thetacog-mcp cockpit` |
| the shape, its movement, its meaning | `npx thetacog-mcp story` |
| nine rooms vs declared poles | `npx thetacog-mcp alignment-map` |
| the operator's shape | `npx thetacog-mcp competence-pixel` |
| the trigger predicate + backtest | `npx thetacog-mcp parametric-trigger` |
| both arms + the pull | `npx thetacog-mcp envelope` |
| the net — strands, holes, mesh size | `npx thetacog-mcp mesh` |
| the Merkle spec tree | `npx thetacog-mcp spec-tree` |
| the goal — status · copy · import | `npx thetacog-mcp goal` |
| the one loop door — a verb, or free text | `npx thetacog-mcp steer <args>` |
| compile a dictation into ONE steer txt and open it (Template M per ask, the six percentages, the one-line goal) | `npx thetacog-mcp steer-compile "<dictation>"` · `--check` |
| workers — list · end one · end all | `npx thetacog-mcp workers <args>` |
| keep the loop running — on · off · status | `npx thetacog-mcp keep-running <args>` |

Every one of these is a door key the extension itself dispatches through (its own
command table, away from home). Run `npx thetacog-mcp --help` for the live list in
whatever version is installed, since it can grow after this skill was written. A job
that needs a door not on this list is not runnable here yet — report that plainly
instead of inventing a path.

## COMPILE FIRST — one txt, rewritten on the spot

Before listing rows, run `npx thetacog-mcp steer-compile "<the ask>"`. It writes `.thetacog/steers/<date>-<slug>.txt` and opens it. Each ask gets a row, a proposed guard, its act (yours or the worker's), the nearest rows already in your spec, the rules that bind it, and a Template M brief (prompt-master, MIT). Six percentages show what the brief still lacks. The steer ends on one goal line: go until every ask in it is ticked or named. No separate goal file is written. Edit the txt, then hand its STEER block back to this skill.

## SPLIT-THE-ASK — never run a multi-job prompt as one row

**A dictation carrying several jobs is never executed as one pass.** "Do all that",
"write a spec and fix the bug", "run steer and also clean up the tests" each name more
than one finish line. When the ask you were given does this:

1. **List it back as numbered rows**, each one a single finish line — one door call, or
   one self-contained unit of work, per row.
2. **Ask the user to approve the rows, one at a time**, before running any of them.
   Never run row 2 while row 1 is still open, and never silently fold two rows into one
   door call or one commit.
3. **A row that turns out to hide a second job on inspection gets split again** before
   it runs — the same rule applied to itself.

A wide ask run as one unit comes back as one unresolvable answer; the same ask, split,
comes back as several decidable ones.

## Plan only, unless told to go

**By default this skill only PLANS.** It reads what the doors above have already
produced (or reports `not run` for the ones that have not been run yet), composes the
rows (see SPLIT-THE-ASK above) and the two arms — move the work (a declared-but-
unworked item) or move the declaration (a worked-but-undeclared item) — and presents
them. Nothing is run and nothing in the workspace is written.

**A row runs only when the user's message carries `--go`**, said about that row or
about the whole plan. Without `--go`, the answer is the plan alone, however confident
the plan is.

## Refuse `--go` on a dirty tree

**Before running anything under `--go`, check the working tree first:** `git status
--porcelain`. Any output at all (staged, unstaged, or untracked files) means the tree
is dirty — refuse to run, name the dirty paths, and stop there. A door's writes must
never land on top of work that is not yet committed and is not this skill's to touch.
Require a clean tree (`git status --porcelain` prints nothing) before the first row of
a `--go` run, and re-check it between rows on a long run.

## What this skill does not do

- **It never re-derives a number a door already computed.** A door's own receipt is
  read and reported, never recomputed by hand.
- **It never writes out a command that only exists inside the extension's own
  development repo.** Every command it prints is a door, runnable in this workspace as
  it stands.
- **It never overwrites a `.claude/skills/steer/SKILL.md` you already have of your
  own.** If one exists and is not byte-identical to this bundled copy, the installer
  (command: `Steer: Add /steer to Claude Code`) refuses and names the path instead of
  touching it.
