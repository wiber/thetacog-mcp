---
name: rewrite
description: "The anti-slop pass on one file, run wherever /steer runs. A reader model reports where its comprehension breaks, a deterministic slop detector (no model in it) scores hedges, filler and narrator-voice lines, and each cold sentence gets rewrite candidates ranked by slop removed and readability gained. Dry-run by default: it writes an HTML report and edits nothing. Triggers: '/rewrite', 'rewrite <file>', 'anti-slop pass', 'slop check', 'de-slop this', 'ghost-read this'."
---

# /rewrite — the anti-slop pass

Every command here is a door: `npx thetacog-mcp <door>`, run from the root of the repo you are working in. Nothing names a path on
one machine.

## On invocation

1. Resolve the target to one existing file. When the user named none, use the file they are editing or the draft just written.
   Ask only when two files fit equally.
2. Run the dry-run pass:

```bash
npx thetacog-mcp rewrite --file <path> --tracks C,D --limit 10
```

   - `--tracks C,D` uses the cloud writer (`claude -p`, the same login /steer uses). Tracks A and B are the local writer and need
     ollama with `qwen2.5:7b`; add them only when `ollama list` shows that model.
   - `--from L120` or `--from 40%` or `--from "<phrase>"` starts the scan partway into a long file.
   - `--limit N` caps the cold sentences worked (default 15). Short, high-stakes text (a message, an intro) is where it pays most.
3. The report lands in `.thetacog/rewrite/reports/<file>-<stamp>.html`. Open it (`open <report>` on macOS) and read the top card
   per cold sentence back to the user: the sentence, the winning candidate, and what it removed.
4. Apply a candidate only when the user picks it. Edit the file yourself with the chosen line and commit it as one change.
   `--apply` commits every top candidate unattended; never pass it unless the user asks for exactly that.

## What the report is sufficient for, and what it is not

- **Sufficient for:** where a reader's comprehension broke, which lines carry hedges, filler or narrator-voice meta, and whether a
  candidate removed slop without adding words. The slop score is a pattern match a person can read and re-run to the same number.
- **Not sufficient for:** whether the text is true, or whether the rewrite keeps the author's meaning. Check each picked line
  against the original before it lands.

## When it cannot run

- `claude` not on PATH: say so and stop. The cloud tracks are the writer.
- A file with no prose paragraphs (code, JSON) reports zero cards. Say that it holds no prose; do not widen the scan.
