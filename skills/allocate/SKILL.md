---
name: allocate
description: "Shows the default way to run a multi-job ask: one Claude Code session, one spec, every job a row, worked through /steer one row at a time with npx thetacog-mcp doors only. Running several sessions at once is an appendix, marked optional. Triggers: '/allocate', 'allocate this work', 'how do I split this up', 'should I run several sessions', 'one session or many'."
---

# /allocate — one session, one spec, is the default

CC apps usually run one session at a time. The default path here matches that: one
Claude Code session, one spec, every job in the ask becomes a row on that spec, and
`/steer` works the rows one at a time through the installed doors (`npx thetacog-mcp
<door>`), never a thetadrivencoach-only command. The chair reasons; the dispatched
`claude -p` workers build. This keeps the one session's own context clean — it holds
the map and the next row, not every row's history at once.

## The default: one session, one spec, rows in order

1. Split the ask into rows on ONE spec (`npx thetacog-mcp steer-compile "<the ask>"`
   does this: one row per job, a guard proposed for each).
2. Give each row one area — a row that touches two unrelated areas gets split again.
3. Run the rows through `/steer` one at a time. Check the goal before starting the
   next row (`npx thetacog-mcp goal`): a row still open stays open until its own guard
   is green, never folded into the row after it.
4. Check who is working and end anything that should stop before starting more
   (`npx thetacog-mcp workers list`).

## The doors

| what it does | door |
|---|---|
| split an ask into rows on one spec, one guard proposed per row | `npx thetacog-mcp steer-compile "<ask>" --check` (status only; drop `--check` to run) |
| the goal line — which row is open, which is done | `npx thetacog-mcp goal` |
| who is working right now — list, or end one | `npx thetacog-mcp workers list` |
| keep the one-row-at-a-time loop running — on, off, status | `npx thetacog-mcp keep-running` |

Every one of these is a door the extension itself dispatches through (`npx
thetacog-mcp --help` prints the live list). A job that needs a door not on this list
is not runnable here yet — say so plainly rather than inventing a path.

## Appendix: several sessions at once (optional, never the default)

Running more than one Claude Code session on the same working tree is possible. Each lesson below cost
something the night this skill was written; each names the failure, then the rule.

1. **One area per session, named before any edit.** Two sessions on one area overwrite each other's
   uncommitted work. Give each session an area no other session touches, and say it in that session's
   first message.
2. **Say which files you hold before you edit them.** Before restoring, staging or committing a path you
   did not just edit, ask whether another session holds it. If it does, message that session; never
   sweep a directory.
3. **A running /steer loop does not pick up rows another session queues for it.** The loop works the scope
   it started with. To run your rows, wait for the loop to end, then start your own scope; if another
   waiter takes the loop first, wait again. Never stop someone else's loop to start yours.
4. **Commit only your own lines in a shared file.** The spec carries other sessions' uncommitted ticks and
   edits. Committing the whole file lands their lines under your message. Commit your one line, and leave
   theirs in the tree.
5. **A tick counts only once it is committed.** A checkbox toggled in the working tree can be overwritten
   by the next session that rewrites the file. Commit the tick in the same turn you earn it.
6. **A halted worker can leave its files staged.** When a /steer row stops (turn cap, drift gate), read
   what it staged before anyone commits: green work stranded in a shared index lands under the next
   commit's message.
7. **Send a murky row back before /steer, never into it.** A row without the owner's words, a guard and a
   plain done-when spends a worker's turns and halts. Rewrite it first; dispatch only the clear rows.

This appendix is the exception path. The default — one session, one spec, rows in order — is what
`/allocate` recommends first. Reach for several sessions only when a named constraint (time, or areas
that never touch) makes the default too slow.
