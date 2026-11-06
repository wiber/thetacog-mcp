---
name: doctor
description: "Check this ThetaCog install and write the handoff: runtime, the IntentGuard addon, the walk binary for this platform, the demo run twice for the same digest, the MCP server's tool list, and whether every coding agent here (Claude Code, Cursor, Gemini) has the /steer skill. Writes .thetacog/doctor/handoff.md, ready to paste into any coding agent. Triggers: '/doctor', 'run the doctor', 'check this install', 'diagnose thetacog', 'is thetacog working', 'write the handoff'."
---

# /doctor: check this install and write the handoff

One command answers "does everything this install needs actually run here?" — `npx thetacog-mcp doctor`. Every check is a program with no model in it (THE RECEIPT IS LLM-FREE); a local model, when one answers, adds a labelled note under its own heading and never changes a check result.

## Run it

```
npx thetacog-mcp doctor [--json] [--print] [--no-llm] [--out <file>] [--skills-only] [--fix [--hosts claude-code,cursor,gemini]]
```

| what you want | flag |
|---|---|
| the full run: runtime, addon, walk binary, demo twice, MCP server, skills | no flags |
| machine-readable checks | `--json` |
| the handoff printed to stdout too, not only written | `--print` |
| skip the local-model note | `--no-llm` |
| write the handoff somewhere other than `.thetacog/doctor/handoff.md` | `--out <file>` |
| the fast pass: only whether each agent's skill slot is current | `--skills-only` |
| write the missing and earlier-ours skill slots (never a foreign file) | `--fix` (narrow with `--hosts`) |

Exit 0 when no check FAILED (UNMEASURED is not a failure); exit 1 otherwise.

## Read the result

The handoff opens as `.thetacog/doctor/handoff.md`: every check (PASS, FAIL or UNMEASURED), its detail, and for a FAIL the fix. Read the last line back first — it is the one-line verdict. Paste the whole file into Claude Code, Codex or Grok to wire whatever is left; it names the package map and the exact command each remaining fix needs.

A FAIL on `skills:<host>` means that agent's `.claude/skills` (or its adapter's folder) is missing `/steer` or holds someone else's file at that slot — run `npx thetacog-mcp doctor --fix` to write the missing and earlier-ours slots. A FAIL never overwrites a foreign `SKILL.md`; the handoff says whose file is in the way.

## What this is sufficient for, and what it is not

It answers whether this install's pieces are present and answer on this host, today. It does not say the work done with them is correct (undecidable, Rice 1953) — only that the runtime, the addon, the walk binary, the demo and the MCP server each ran once and gave the expected shape.
