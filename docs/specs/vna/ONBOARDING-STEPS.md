# ONBOARDING STEPS — the rows the operator tunes (C108)

HAND-EDITED. This file is never generated and no script writes it: the operator edits a step's words, its receipt, its null
and its predicted time here, and the sidebar's NEXT → card repaints from it on the next render (C108c). The parser
(`scripts/vna/onboarding-steps.mjs`) refuses the whole file when a step is missing one of its six fields, by the step's name.

The shape, per step — a heading `## <n>. <key> · <emoji> · <owning row>[ · branch]` and exactly six fields:

- `screen:`  the surface and the words on it, verbatim from the current render — the first "quoted" span is the card's line
- `click:`   the one control; `· <label> beside it` when a second control sits beside the primary
- `receipt:` the row / file / field that proves the user got there (a receipt, never a feeling)
- `null:`    what the receipt reads when the step was NOT reached — never a zero; UNMEASURED or `not run` with the command
- `predict:` C93f — the expected seconds to the next step and the drop-off %, numbers the operator edits (seeded by the chair 2026-09-20, untested)
- `measure:` the door under `scripts/vna/measure-*.mjs` that reads the receipt on THIS machine, else `unmeasured — no door named`

The order below is the FLOW order the operator fixed on 2026-09-20 — the first walk makes the tape; the 💳 checkout is the
first thing DONE while no key is held ("the first thing that must happen is attesting the local one with a simple credit
card checkup (not first on page)"); page order is separate (C103d). A `branch` step is one the record holds only while its
condition is true (a halt, a spent balance) and is never in the checklist sequence. The `<n>` in a line is read off the
record at render, never typed here.

Read it: `node scripts/vna/onboarding-steps.mjs` (`--json` for machines).

## 1. walk · 🚶 · C92d
screen: NEXT → card · "Run one walk on this repo" · Recommended: 🚶 Walk HEAD
click: 🚶 Walk HEAD
receipt: `data/vna/cockpit.json` `panels[]` non-empty (the walk's receipt), or an `onboard` row `seed.step: walk` on `data/vna/flight-tape.ndjson`
null: UNMEASURED — not run — node scripts/vna/cockpit.mjs (no cockpit.json, no onboard row)
predict: 30 s to the next step · drop-off 10 %
measure: unmeasured — no door named

## 2. notarise · 💳 · C102a
screen: NEXT → card · "Fund Autonomy Ledger — a simple checkout, then your key signs the next rows locally" · Recommended: 💳 Fund Autonomy Ledger
click: 💳 Fund Autonomy Ledger
receipt: the entitlement — a `snapshot` row (`kind: snapshot`, `ref: token:<jti>`) on `.thetacog/credits-local.ndjson` (C102b, the first sight of the token), or `VNA_ENTITLEMENT_CLAIMS` carrying `pubkey_fingerprint`; the JWT itself sits in the extension's SecretStorage under `vna.entitlement` (C102a), which no script outside the IDE can read
null: NOT HELD — no snapshot row on .thetacog/credits-local.ndjson and VNA_ENTITLEMENT_CLAIMS unset — node scripts/vna/measure-onboarding-key.mjs
predict: 180 s to the next step · drop-off 60 %
measure: scripts/vna/measure-onboarding-key.mjs

## 3. goal · 📄 · C98g
screen: NEXT → card · "Paste what you want finished — it becomes a row" · Recommended: 📄 View Unit Contract · ⤵ Ingest Clipboard beside it
click: 📄 View Unit Contract · ⤵ Ingest Clipboard beside it
receipt: `data/vna/goal.json` `units[]` non-empty (the goal on the record, C91a), or an `onboard` row `seed.step: goal` on the tape
null: UNMEASURED — no goal.json — node scripts/vna/goal.mjs set "<what you want finished>"
predict: 90 s to the next step · drop-off 25 %
measure: unmeasured — no door named

## 4. run · ⚡ · C67
screen: NEXT → card · "Run it headless — a worker boots cold from the row" · Recommended: ⚡ Run Headless
click: ⚡ Run Headless
receipt: `.thetacog/runner.ndjson` — the last row's state is DONE, RUNNING, HALTED, PAUSED, ABORTED or DISPATCH (a worker was booted), or an `onboard` row `seed.step: run` on the tape
null: not run — node scripts/vna/steer-runner.mjs (no runner.ndjson row, or its last state is `not run`)
predict: 600 s to the next step · drop-off 30 %
measure: unmeasured — no door named

## 5. halt · 🔍 · C89b · branch
screen: NEXT → card · "Read the halt — the file's own reason" · Recommended: 🔍 Inspect Halt Reason
click: 🔍 Inspect Halt Reason
receipt: `.thetacog/runner.ndjson` — the last row's state is HALTED and the row carries its `why` (the file's own words)
null: no halt — the runner's last row is not HALTED (this branch is closed) — node scripts/vna/runner-reading.mjs
predict: 120 s to the next step · drop-off 15 %
measure: unmeasured — no door named

## 6. buy · 💳 · C99c · branch
screen: NEXT → card · "Buy keys — <n> rows waiting" · Recommended: 💳 Fund Autonomy Ledger
click: 💳 Fund Autonomy Ledger
receipt: a key is held (step 2's receipt) and the SUM of `.thetacog/credits-local.ndjson` is 0 or below — the balance is a sum of rows, never an updated column (C102b)
null: no rows waiting on a spent balance — the balance is above 0, or no key is held (this branch is closed) — node scripts/vna/measure-onboarding-key.mjs
predict: 180 s to the next step · drop-off 50 %
measure: unmeasured — no door named

## 7. backup · 🔗 · C102c
screen: THE SECOND READER's + · "Countersign (backup) — post the tape to the third party, <n> rows signed" · Recommended: 🔗 Countersign (backup)
click: 🔗 Countersign (backup)
receipt: an `.upload.json` receipt with a `url` under `.thetacog/backup/` (the third party's countersignature), or an `onboard` row `seed.step: backup` on the tape
null: no backup posted yet — node scripts/vna/backup.mjs post (no .upload.json under .thetacog/backup)
predict: 60 s to the next step · drop-off 40 %
measure: unmeasured — no door named

## 8. keep · 🔑 · C102b
screen: NEXT → card · "Keep going — <n> rows notarised" · the six buttons beneath, none recommended in particular
click: none — the six buttons beneath
receipt: rows on `data/vna/flight-tape.ndjson` whose `proofs.licence` reads LICENSED under the held key (`licenceOf(row).status === 'LICENSED'`), count above 0
null: no rows notarised yet — the tape has no LICENSED row (write one turn with the key held) — node scripts/vna/flight-tape.mjs verify
predict: 0 s — the last step; the loop is yours · drop-off 0 %
measure: unmeasured — no door named
