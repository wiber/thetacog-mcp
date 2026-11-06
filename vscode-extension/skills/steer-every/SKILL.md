---
name: steer-every
description: "Run one steer file round after round from Claude Code, in any repo the ThetaCog extension is installed in — a round, then a settle (reap, unload local models, rest until the machine is calm), under a dollar budget projected before every round — through the installed doors only (`npx thetacog-mcp <door>`). Triggers: '/steer-every', 'steer every', 'run the steer file every N minutes', 'loop the steer', 'keep the steer running', 'recurring steer', 'how is the loop doing', 'read the runs log', 'how much rest between rounds', 'settle the machine'."
---

# /steer-every — one steer file, round after round, a settle between

This is the STRANGER-SAFE `/steer-every`. It ships inside the ThetaCog npm package and the VS Code extension, and every command below is a door: `npx thetacog-mcp <door>`. A door not listed here does not exist here yet; say `not run — no <name> door` rather than guessing.

## The doors

| what it does | door |
|---|---|
| run the loop in the background | `npx thetacog-mcp steer-every <steer-file> --detach [--every-min 5] [--max-rest-min 20] [--runs 12] [--budget-usd 7.50] [--ceiling 0.75]` |
| is a loop running, and where is it | the last lines of `<steer-file>.runs.log` (a `rest` line last means between rounds) and `pgrep -fl steer-every` |
| one settle, now (reap, unload local models, rest until calm) | `npx thetacog-mcp mem --settle [--min 5] [--max 20]` |
| what is holding memory, kills nothing | `npx thetacog-mcp mem` |
| write a steer file from a dictation | `npx thetacog-mcp steer-compile "<dictation>"` |

## The shape (learned 2026-10-28, keep it)

1. **The file comes first.** A steer file carries one line `SCOPE: C1,C2,…` (the rows each round works). Rows are added to the file; a track keeps one file. SCOPE is re-read every round, so promoting a row needs no restart.
2. **No chat in the loop.** Each round is one `steer until --max-cycles 1` with turn-capped headless workers. A chat-scheduled tick re-reads the whole conversation every time; this loop spends only what its workers spend.
3. **A round, then a settle.** After every round the loop calls `mem --settle`: reap what nobody is coming back for, unload every model ollama holds, then rest at least `--every-min`, on until CALM, never past `--max-rest-min`. CALM is both: 1-min load per core at most 0.4, and under 100 swap-ins/s. So the period is round time plus rest, by design, never a fixed slot.
4. **Swap used is never waited on.** It sits at 85–97 % on a busy Mac, calm or not, and shrinks only when the processes holding its pages exit. The settle line names the biggest holders; stop the ones that are yours and idle (a dev server nobody is using), reload the apps.
5. **The budget is projected before a round.** The loop stops when spent plus its largest round so far would pass `--budget-usd`. Every round so far has run past its per-worker ceiling, so the ceiling alone never caps the spend.

## Read the log, in this order

`<steer-file>.runs.log` holds START (the knobs), one `RUN i · scope · spend $x` per round with its `cycle` line (the row dispatched, its verdict), one `rest · mem --settle: …` line per settle, and STOP/END.

- **Ticks:** rows TICKED vs still open in SCOPE.
- **Cost per verified tick:** total spend over ticks. A HALT or a rollback is spend with no tick. Two rounds on one row with no commit means the row needs reading by a person, not a third round.
- **Tick vs result:** a tick proves the row's contract, not the claim the row serves. Read the number the row produced before calling a result.
- **Rest:** minutes and calm-or-cap. Lower `--every-min` only when every settle reached calm at the floor; raise `--max-rest-min` when settles keep hitting the cap.

## Never

Start a second loop on the same file (a held lock only burns rounds). Stop a loop mid-round (stop it between rounds, when the log's last line is a `rest` line). Push, ship or send from inside the loop.
