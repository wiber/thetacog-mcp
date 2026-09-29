# The /steer row — one line, copy-paste

A `/steer` row is a single line of a spec. It only ever compiles when four parts are present, in
this order: a **guard** (the test that will fail red and then turn green), a **verbatim operator
span** (his own words, quoted, never paraphrased), a **falsifiable acceptance** (the observation
that would prove the row wrong), and a statement of **revertible** (how it comes back out).
Anything short of that is not a row yet — it's an idea.

This file carries the shape TWICE, MIRRORED: a blank **template** below, and a **worked example**
right after it that is itself a real, parseable row. Copy either fenced block, fill in the angle
brackets, done.

## The four parts, one line each

- **Guard** — `` (guard: `tests/<path>/c<n>-<slug>.test.mjs`) `` — a path, in backticks, under a
  test root. It does not have to exist yet; a declared-not-built guard is honest — the row's own
  deliverable is making it exist and turn green.
- **Verbatim operator span** — `(operator <YYYY-MM-DD>, verbatim: *"<his exact words>"*)`. Never
  a summary, never a cleaned-up version of what he said — the actual sentence, quoted. If there is
  no such sentence yet, the row is not licensed to be acted on; it stays a question, not a row.
- **Falsifiable acceptance** — a sentence naming the observation that would refute the row, stated
  as `Falsifier: state the observation that refutes "<the row's own claim>" — where it fires: `
  followed by the guard path. If nothing could ever prove the row wrong, it isn't a claim.
- **Revertible** — one line saying how the row comes back out if it turns out wrong: which commit
  reverts, which flag flips off, which file gets deleted. A row that cannot be taken back is not a
  row to act on alone — it needs the human act (push, publish, send, money) named explicitly.

## Template — copy this, fill in the angle brackets

```
- [ ] C<n> (guard: `tests/<path>/c<n>-<slug>.test.mjs`) <ONE-SENTENCE TITLE, WHAT SHIPS> (operator <YYYY-MM-DD>, verbatim: *"<paste the operator's exact words here, unedited>"*). Falsifier: state the observation that refutes "<the row's own claim, restated>" — where it fires: `tests/<path>/c<n>-<slug>.test.mjs`. Revertible: <one line — the commit, flag, or file whose removal undoes this, and what else (if anything) depends on it>.
```

## Worked example — a real row, following the same shape

```
- [ ] C900 (guard: `tests/vna/c900-example-row-shape.test.mjs`) THE EXAMPLE ROW SHOWS ITS OWN SHAPE — A ONE-LINE TEMPLATE ANYONE CAN COPY AND FILL IN (operator 2026-09-27, verbatim: *"give me one row I can just copy and paste and fill in — his words, the guard, what proves it wrong, how to undo it"*). Falsifier: state the observation that refutes "the row teaches its own shape" — where it fires: `tests/vna/c900-example-row-shape.test.mjs`. Revertible: delete the row and `tests/vna/c900-example-row-shape.test.mjs` in one commit; nothing else on the tree names C900.
```

`C900` is illustrative only — it is not a real row on `docs/specs/vna/SPEC-VNA-COCKPIT.md` and
never should become one; pick the next free `C<n>` when you actually file a row.

## Why the shape is enforced, not styled

The same four constructs are what the live spec is graded on — `OPERATOR_SPAN` and `guardOf` in
`scripts/vna/spec-clarity.mjs`, `FALSIFIER` in `scripts/vna/row-quality.mjs` — so a row written in
this shape already passes the ratchet CLAUDE.md calls "a compiling spec": targets resolve, a
verbatim operator span licenses it, the acceptance is falsifiable, and it's revertible. That
ratchet — not a sign-off — is what authorizes a worker to act on the row. See
`docs/architecture/claude-rules/the-ratchet-invariants.md` for the full method this row shape is
one instance of.

## One row, one ask

Do not fold two asks into one row. If a paste from the operator contains more than one distinct
thing, it becomes more than one row — each with its own guard, its own falsifier, its own
revertible line. A row that tries to carry two claims can only ever falsify one of them.
