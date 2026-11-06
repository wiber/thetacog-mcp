---
name: standing-answers
description: Fill in or refine the ten standing answers (the deployer's readiness check, in insurance the proposal form) from this repo's own code and record, and save them into .thetacog/deployer-playbook.json — the same file the ThetaCog sidebar's 📝 boxes and /backup/warranty save to. Triggers - '/standing-answers', 'fill in the standing answers', 'answer the ten questions', 'refine my standing answers', 'readiness check', 'proposal form'.
---
<!-- GENERATED — NEVER HAND-EDIT. Source: .claude/skills/standing-answers/SKILL.md.
     Regenerate: node scripts/backup/emit-standing-answers-skill.mjs -->

# /standing-answers — draft the ten from the repo, save them where the sidebar reads them

Operator, 2026-10-17, verbatim: *"then you can ask claude to refine the answer, think it through (or fill it in with a /skill in claude bsed on the requirements for the repo - then copy the all 10 questions, and currecnt answers..."*

## 1. Read the ten and the current answers

- The questions: the installed extension's own bundled copy, the newest `~/.vscode/extensions/thetadriven.thetacog-mcp-*/out/standing-questions.json` (or `~/.cursor/...`) — never the thetadrivencoach repo's `src/lib/backup/standing-answers.mjs`, which is not present here.
- The current answers: this repo's own `.thetacog/deployer-playbook.json` if it exists, else draft against an empty playbook (every box blank). Or the operator pastes the "Copy all ten + my answers" block.

## 2. Draft each answer from the record, never from memory

- **`draft: 'ai'` questions (plumber, electrician, demolisher, blast, witness):** read the code that runs unattended (its entry point, config, rate limits, the paths it writes) and answer with names a stranger can check: tables, routes, files, commands, numbers. Numbers come from a ledger or config you read, with where you read them.
- **`draft: 'you'` questions (cause, decides, first hour, wording, level and stop):** draft only what the repo shows (who is paged, which actions are held for a person). What only the holder knows (the policy text, the stop date, the price) stays EMPTY so the sidebar badge keeps it open. Never type UNMEASURED into a text box as an answer; an empty box is the honest state.
- Read each question's `teach` line and stay inside it: the tape measures where the work landed; whether the work was good is undecidable (Rice, 1953). Never promise what the agent will do, never warrant the agent or its outcome.

## 3. Save through the extension's own writer

Never a thetadrivencoach script — this repo does not carry `scripts/backup/standing-write.mjs`. For each answer, call the installed extension's own writer, the same `out/standing-answers.js` the sidebar's boxes save through:

```
node -e "require('<path to the installed extension>/out/standing-answers.js').savePlaybookAnswer(process.cwd(), '<id>', { text: '...', drafted_by_model: true })"
```

It refuses an unknown question id, appends the prior answers to `revisions` (never an overwrite), and the sidebar's watcher repaints the 📝 sub-pill and the badge on its own.

## 4. Report

In chat: the readiness line it printed, each answer you drafted (one line each), and every box you left empty with what the holder must supply. The holder's saved file is theirs: do not commit it on your behalf.
