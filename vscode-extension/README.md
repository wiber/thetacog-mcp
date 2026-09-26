# Flying, and it saves you tokens. How? Double-entry bookkeeping for autonomy

**ThetaDriven Inc** · `thetadriven.thetacog-mcp`

*ThetaCog Steer: Double-Entry Bookkeeping for Autonomy — where the work landed*

**Twenty minutes ago you asked an agent for one CSS class.** It came back green. The diff touched fourteen files, and you read fourteen files to find the one it should not have touched.

**Steer it.**

![Six seconds: the diff counter climbs to fourteen files in red — Steer it. — /steer typed, the agent line, then the Δ line placed and the Copy Run Summary door](https://thetadriven.com/vna/six-seconds.gif)

```
you    › /steer  one CSS class on the pricing card
agent  › … fourteen files …
Δ      › landed C1,B3 · Operations.Grid × Tactics.Signal · 6 blocks from the basin you declared
       › 📋 Copy Run Summary — on the pull request before you open the diff
```

Six seconds to read. Your own machine, no model in the path, and the row is placed before you go looking. Not a brake — the halt stays yours to wire. It is the second entry, written under a key that is not the actor's.

**What it keeps, and what it refuses.** You are buying a Richter scale, not a concrete bunker.

- **Kept:** I will show exactly where this commit sat relative to the spec you declared, without ever asking a statistical model to grade it.
- **The second job, off the same match:** The instrument does two jobs that share one match. Routing makes the tokens cheap. The same match mints a receipt of spec-versus-outcome. It is frozen, not true — it settles the execution fight, not intent, and a stranger can re-run it from the commit alone.
- **Every walk ends in one of four words:** PLACED · UNMEASURED · UNDECLARED · REFUSED — never a score, never a fifth word.
- The paid stamp is optional: buy it only when a named person outside your company will recompute it. `npx thetacog-mcp buyer-monologue` walks the twelve questions and tells you which side of that line you are on.

And before the agent wrote a single line, you paid for it to re-read the entire conversation. Again. Last Thursday I watched 41% of my week's allowance go before the day was over, and went to find out where. My own repo keeps the receipt: **474,878,618 tokens re-read that day, against 1,735,789 written.** Ninety-eight point six percent of everything I paid for was context being recomputed — 274 tokens re-read for every one that wrote anything. One session alone re-read 123 million to produce 407 thousand. The agent was not thinking harder. It was reading the same conversation back to itself, over and over, and billing me for the privilege. Two days later I built this.

Read-to-write, on a scale where every rung is ten times the one below it. Find your own repo on it:

```
      1 : 1   every token you pay for puts a character on disk
     10 : 1   a tight loop — short thread, small files, you are fine
    100 : 1   the conversation is now the product; the code is a side effect
    266 : 1   ← this repo, every session the ledger holds
    274 : 1   ← that Thursday
    303 : 1   ← the worst single session: 123,520,617 read, 407,840 written
  1,000 : 1   you are paying rent on a transcript
```

Nothing on that scale is a claim about your machine. It is one repository, counted, and the count is below so you can put your own number on the same rungs.

You do not have to take my word for any of that. The ledger is a file and the count is one line. Run it and you get every session it holds, not just that Thursday — **494,195,058 re-read against 1,860,755 written, 266 to one**, and the day above is one slice of it:

```
node -e 'const r=require("fs").readFileSync("data/vna/cog-spend.ndjson","utf8").trim().split("\n").map(JSON.parse);
  const s=new Map(); for(const x of r) if(!s.has(x.session)||x.total>s.get(x.session).total) s.set(x.session,x);
  let read=0,wrote=0; for(const x of s.values()){read+=x.cache_read||0; wrote+=x.output||0;}
  console.log(read.toLocaleString(),"re-read vs",wrote.toLocaleString(),"written —",(read/wrote).toFixed(0)+"x")'
```

The work moves out of the context window and onto a record on disk. The next turn boots cold from that record instead of your transcript, the loop keeps its place while you are away, and the meter prints what you stopped re-sending — 2,533,089 tokens of 2,552,589 on the session that wrote this line, read off the meter and never typed (the live percentage is the block below). Checking where the work landed is one click instead of a leap of faith, and that is the part that feels like flying.

![The ThetaCog Steer sidebar: INTENT, REALITY and Δ panels, then ten pills — Walk HEAD, View Aperture Receipt, Run Headless, Fund Autonomy Ledger, Tokens per cog, auto-paste, Copy Run Summary, Open Tree, Open Spec, Inspect Halt Reason](https://thetadriven.com/vna/steer-sidebar.png)

One night an agent re-read this whole repo to change a two-line import, and one afternoon it touched a file I never asked it to touch while CI stayed green. I built /steer so my agents boot cold from a row I wrote before they ran, and leave a second entry they did not write. It is free, and if I were in your chair I would run it on one file first and read what the meter says.

— Elias Moosman

**Forward this to your lead — three lines for #engineering:**

```text
ThetaCog Steer — VS Code ⇧⌘X, search "ThetaCog Steer" (id thetadriven.thetacog-mcp, free)
One thing it does: a worker boots from the spec row instead of the chat, and the commit gets a second entry the agent did not write.
https://marketplace.visualstudio.com/items?itemName=thetadriven.thetacog-mcp
```

/goal is what you want finished. /steer is /goal with the record holding it — every ask a row, every row a guard, every commit placed, every worker cold-booted from the tree, and the session evicted when the goal closes.

+ the record — the paste becomes a spec row and a node on the tree · 📄 View Unit Contract
+ the workers — one ephemeral worker per unit, booted cold from the snowball, six gates · ⚡ Run Headless
+ the receipt — where the commit landed, the tokens not re-sent, the labour stamp · 📋 Copy Run Summary

Every commit a worker lands gets a second entry: where it landed against the row you declared, written under a key that is not the actor's, recomputable by a stranger with the commit. That is why it works, and it is why it saves you tokens: You stop paying to re-send the whole conversation every turn, and the loop keeps its place while you are away, because the work lives on a record instead of in the window — every row with a second entry you can recompute, same bytes, same hash — and when checking it is one click, not a leap of faith, double-entry bookkeeping feels like flying. **Unsigned autonomous code is an uninsurable liability.** The key buys a stamp: a second key countersigns the rows you already signed — paths, hashes, placement, never the code — and a countersigned row is the one thing a risk officer can price. One key per **10,000 actions**, an unbroken record; the price follows the compute of keeping and re-walking it, never what a breach costs. Your Time on Target clock starts with the first row you sign — a record of steering autonomous agents that accumulates under your key. What if the counted version stayed wherever the money is, and the fog was what reached your editor? You do not want to live in that world. Neither do I, and that is how I am on your side. Ask any vendor what their own engineers run against their own repo, and then ask what it would be worth to know which world you are in.

- **For engineers** — start your Time on Target clock. Every commit a worker lands is placed against the row you declared, signed locally, and stays yours; the record of you steering autonomous agents grows one row at a time, and 📋 Copy Run Summary is the receipt you drop into the pull request.
- **For the enterprise** — a risk officer cannot underwrite a leap of faith. The tape carries the measured Δ between the declared spec and where the work landed, placed on a 144-cell map, hashed and countersigned — paths and hashes, never the code.
- **For underwriters** — if it is debatable, it is not insurable. The tape is the exhibit a loss is read from: signed at the row, placed against a lane declared before the work ran, recomputable from the commit by someone who is not the actor.

Fund the ledger: https://thetadriven.com/notarise — email only, no company fields; the measuring stays free (MIT), the stamp is the paid thing.

Nothing here is new. Merchants have caught drift with two columns since the 1400s; we gave the second column a chip and a signature. The second entry is written by someone who is not the actor.

*The cockpit, as it sits in your sidebar.* Three panels — **INTENT** (what you declared), **REALITY** (where the commit landed), **Δ** (the drift between them) — then ten pills, each one a button and a reading. This is where the flying feeling comes from: you leave the window and ride the record. The lead of every line stays on screen while its counts scroll under it, the loop keeps its place while you are away, the halt is yours to wire, and every number on this page is read off a receipt on disk — this page computes none of them, and no model is in the path. Lift-off is one click on 🚶 Walk HEAD; the horizon is Δ.

### The machine pays for its own attestation

<!-- spark:begin — rendered by node scripts/vna/clear-gauge.mjs --readme from data/vna/readme-ratio.json (readmeSparkLine); do not edit by hand -->
You are paying a supercomputer to re-read 2,552,589 tokens to change a CSS class.
<!-- spark:end -->


The record instead of the window is what stops the re-send — the number above is read off this session, never typed — and the same record is what the stamp below countersigns.

And yes, it saves you tokens. Every turn, your coding agent re-sends the transcript it is carrying — the whole
conversation, again — and you pay for that re-read before it writes a line. This extension moves the work from
the window to the record: a spec tree on disk that every paste and every decision folds into, a snowball of at
most `BUNDLE_TOKEN_CAP` tokens that boots the next turn cold, and a meter that prints what was not re-sent.
You do the measuring locally, for free. The one paid thing is the stamp on your own tape, and the walk below
starts there. The savings are the operational proof point, not the pitch: what a session stopped re-sending is read off the meter below, never typed.

<!-- ratio:begin — rendered by node scripts/vna/clear-gauge.mjs --readme from data/vna/readme-ratio.json; do not edit by hand -->
99.2% of the window not re-sent — read off this session
<!-- ratio:end -->

## Where this sits

Four kinds of tool live next door. Each is good at its corner; each stops where this one starts.

- **Transparency logs — Sigstore, Rekor, in-toto.** They sign the static artifact at the end of a pipeline and put the signature in an append-only log: *artifact X was produced by identity Y at time Z*. They stop there. They know nothing of the run that produced it — where an agent's edits landed, what it re-read, what it cost.
- **Verifiable compute — RISC Zero, SP1.** They prove an execution trace ran, at a compute cost that is the price of the proof. Whether a diff was *intended* is undecidable for them as it is for anyone — the proof section below says why; they prove that a program ran, not that the program was the right one.
- **Agent observability — LangSmith, Arize Phoenix, Braintrust.** Spans, prompt histories and token spend in a vendor's database. Useful for debugging; nothing in them is an inclusion proof, and the raw prompts leave the building to get there.
- **Runtime guardrails — Guardrails AI, NeMo Guardrails.** A brake on the completion, applied to the words as they come out. Not a record of the disk: they do not measure which files changed or where those files sit in the repo's own map.

This extension records **where autonomous work landed**, on the machine that did it, signed locally under your licence, with the file **paths and hashes and never the code** — and hands whoever asks a receipt they can recompute from the commit. That receipt is the asset the insurance industry needs for accountable losses: **insurable data** — a loss read from a signed row placed against a lane declared before the work ran, not from a story told afterwards. The licence that stamps those rows is a card checkout at https://thetadriven.com/notarise; the measuring stays free (MIT), the stamp is the paid thing. ThetaCog is a tape, not a brake; the halt is yours to wire, and the tape is your proof.

## The runbook

Five steps, on the controls the sidebar actually paints — 🚶 Walk HEAD (↳ 🔍 View Aperture Receipt) · ⚡ Run Headless · 💳 Fund Autonomy Ledger (↳ ⚙️ Tokens per cog) · 🟢 auto-paste (↳ 📋 Copy Run Summary · ↳ 🌳 Open Tree) · 📄 Open Spec (↳ 🔍 Inspect Halt Reason). Beside every action are the exact metrics of your machine's health: 🚶 Walk HEAD reads `Δ <off-lane>% off-lane · <red> red`, 🔍 View Aperture Receipt reads `<n> files · <kB>`, 💳 Fund Autonomy Ledger reads `credits <n>`. An instrument that has not been read says `not run`, then the command that would run it.

1. **Install** — from the Marketplace: [ThetaCog Steer](https://marketplace.visualstudio.com/items?itemName=thetadriven.thetacog-mcp)
   (free), or ⇧⌘X and search `ThetaCog Steer`, or `code --install-extension thetadriven.thetacog-mcp`. The source is
   public at [github.com/wiber/thetacog-mcp/tree/main/vscode-extension](https://github.com/wiber/thetacog-mcp/tree/main/vscode-extension).
   Or build the `.vsix` yourself (in the monorepo the folder is `packages/thetacog-mcp-vscode`, in the public repo it is
   `vscode-extension/`: `cd packages/thetacog-mcp-vscode && npm install && npm run compile && npx @vscode/vsce package
   --allow-missing-repository --no-dependencies`, then `code --install-extension thetacog-mcp-<version>.vsix
   --force`; Cursor is the same binary under a different name). Reload the window, open this repo as the
   workspace folder, and click the ThetaCog icon in the activity bar.
2. **Fund the Ledger & Start Your Clock** — The first thing you do is **💳 Fund Autonomy Ledger** (https://thetadriven.com/notarise). Email only. Connect via OAuth 2.0 or paste your key. Your Time on Target history starts accumulating locally.
3. **Say what to finish** — `/steer <what to finish>` — it is /goal with the record holding it: the snowball seeds the unit, the Merkle tree briefs the worker, the spec row is the contract, the guard is seen red first. Headless, the same door: `node scripts/vna/goal.mjs set --text "<what to finish>" --unit "<spec rows>"`. It lands in
   `data/vna/goal.json` and card 1 (ACTIVE CONTRACT) shows unit 1 with **📄 View Unit Contract**.
   **The morning `/steer`.** Say it before the first coffee — the snowball for unit 1 is built from the spec tree, not yesterday's chat.
   **The copy.** A paragraph from anywhere — ⌘C and nothing else. Tick **🟢 auto-paste** once and every ⌘C lands on the steer file verbatim,
   without a paste; **📋→🌳 Paste → Tree** attaches each clip by gzip-NCD to its nearest row when the margin holds and holds it unplaced
   when it does not. `node scripts/vna/spec-tree.mjs --status` prints the attach and abstain counts as the fold saw them.
4. Click **⚡ Run Headless** — on the AUTONOMOUS RUNNER card. One ephemeral worker per open unit, each in its own output channel, booted
   cold from the snowball instead of your session's transcript. Then six receipts, all must hold: exit 0 · HEAD moved · red witness · guard green · fold · CAR.
   **The unattended run.** Step away. A worker that cannot clear the six receipts halts and writes why in its own words to `runner.ndjson` — a red
   witness that stayed red, a commit that did not name its row — and the next unit is not started on a lie. The meter counts the whole time:
   `<tokens not re-sent>` input tokens never sent again because the snowball carried the state, `<saved %>` against the transcript the
   session would otherwise have re-sent every turn.
5. **Read the receipt** on the AUTONOMOUS RUNNER card — the unit, the verdict with the six receipts it cleared, the worker's tokens, the tokens
   not re-sent, and the files Δ placed off-lane, every term read from `runner.ndjson` and the meter. **📋 Copy Run Summary** is the
   engineer's flex, not just a summary — it puts the receipt on your clipboard: `Verified by ThetaCog: <off-lane>% off-lane (Δ <rings>) ·
   <n> files walked (<kB>) · Time on Target secured.` with the commit hash and the ledger link, every slot read off the receipt, never
   typed — for the pull request, the Slack thread, or whoever asks what the agent did, to show the work is verified.
   **The reality check.** Click **🚶 Walk HEAD** — it reads your repository, places your last commit on the 144-cell map, and shows you
   where the work landed against what you declared; it does not judge, and where it landed is re-runnable by anyone with the commit. Green
   in lane, amber adjacent, red off-lane — red is scope-breadth, not a defect. Δ tells you where to look; you decide what it meant — move
   the work back, or move the declaration to where the work went.
   **The handoff.** Every slot is read off a receipt, never typed, and a slot with no receipt prints UNMEASURED rather than a zero. Until
   the row is stamped, the Time on Target slot reads `UNSIGNED` or `signed · unlicensed` and carries the door itself — 💳
   https://thetadriven.com/notarise — so the pasted line offers the licence wherever it lands. **🔗 Countersign (backup)**, behind the +
   on THE SECOND READER, gives your client a receipt at `<height>` on the tape that a second reader signed and that they can recompute
   from the commit.

The stamp is on THE SECOND READER, and it is three verbs, in this order:

- **Sign** — free, and yours. Your own key signs every row the tape writes, on your disk, from the first walk. Anyone with the commit recomputes the row and checks your signature.
- **Notarise** — the paid door, and still local. A plain card checkout on thetadriven.com/notarise mints a licence signed by a party who is not you, naming your key by its fingerprint; from then on every row is stamped with it as it is written, one credit per stamped row, the credits decremented on a ledger inside your own repo. Anyone can check the licence against the issuer's public key and the row against yours — nothing leaves the room.
- **Countersign** — the next step, never a face button. When someone asks for the tape, the same credits back the stamped rows up to the third party and a second reader signs them; that door sits behind the + on THE SECOND READER (🔗 Countersign (backup)), and it is the one that leaves the machine.

<!-- loop:begin — rendered from loopInFive(BUNDLE_TOKEN_CAP) in scripts/vna/public-surface-register.mjs; do not edit by hand -->
1 · Think it through with any model, or a colleague.
2 · Copy the good part — the clipboard lands it on the tree, placed.
3 · The spec grows a row.
4 · A worker boots cold from the row: 1,500 tokens, not the whole chat.
5 · The receipt lands — where it went, re-runnable by anyone.
<!-- loop:end -->

## The boundary

The measurement is free; the underwriting is paid.
The install and the measurement are free and open-source (MIT); only the financialization/attestation layer is licensed.

A third party recomputes this receipt from the commit and the tape — no access to your pipeline, your prompts or your weights — and says where the work landed against the rows you declared. Whether it was good is not claimed; where it landed is re-runnable by anyone.

What it refuses to promise: This does not make the work insurable, good, or cheap. Cheap is a byproduct. Good is your job as the oracle. Insurable is a decision made by a later buyer.

- **MIT, and it stays that way:** this extension, the local runner and every script it spawns under `scripts/vna/`, the ballistic
  walk client (`pmu-onchip`), and the local CAR flight tape with its Ed25519 signatures and Merkle proofs. Everything that computes
  a coordinate, a ring, a receipt or a proof runs on your machine, reads your repo, and can be recomputed by anyone with the same
  commit. The extension has no runtime dependency and imports nothing outside its own `src/`. Nothing on the free side is
  time-boxed or feature-capped.
- **The paid boundary is one thing:** the licence — the key that stamps your rows on your own disk as they
  land and, when you choose, pays a third party to countersign them so the record is one you did not write alone.
  The three doors the scripts reach for that second half are the only remote calls in the package:
  `https://thetadriven.com/api/auth`, `https://thetadriven.com/api/notary/ingest` and `https://thetadriven.com/api/backup/upload`
  (`https://thetadriven.com/backup` is the page the manifest URL opens).

On either side of the line the function is the same four verbs and no fifth: a unit that lands off its lane is detected, placed, priced and dispatched
to whoever asks. Whether the work was good stays undecidable; nothing here holds the agent's hand.

**One node can be priced today. The horizon is the federation.** What this extension makes priceable right now is a single repository: one developer, one key, one tape, one 144-cell map of where that work landed. That is already a thing no carrier could price before, and it is the whole of what is built. The direction is a map of maps — each node keeping its own record under its own key, nothing leaving the machine but paths and hashes, and the federation reading across them without any node handing over its code. A portfolio priced from many tapes rather than one. That part is the roadmap, not the product, and this README will say so until the day it ships.

Git records what changed. ThetaCog records why: the intent you dictated, on the tape, signed, placed against the spec tree.

## The proof underneath

This is the one place the theorem belongs, and it says what the receipt is sufficient for and what it is
not. **Sufficient for:** WHERE a commit's work landed relative to what was declared — a coordinate on a
144-cell lattice, rows the actor lane, columns the patient lane, ShortLex on both, reached by a
recursive ballistic walk that resolves to positions, not to further words; recomputable by anyone with the
same commit, and re-runnable on the chip. **Not sufficient for:** WHETHER the work is correct. That is
undecidable (Rice, 1953) and nothing here claims it. The flight tape is a CAR chain with Ed25519 signatures
and Merkle inclusion proofs; a notary receipt is a countersignature on the same coordinate the walk already
placed, and it makes the record harder to dispute, not different. The boundary probe at rung 3 says exactly
this much about the machine it ran on:
the boundary-crossing cost was measured on this machine; whether this was silicon is not what it proves.
Every number comes from a script in `scripts/vna/`, which is the running
code. This extension spawns them and renders what comes back; it computes nothing of its own, and no model
is called anywhere in it. A second implementation in TypeScript would fork the receipt, and a forked receipt
is a second answer to a question that must have exactly one. Nothing here gates, blocks, or fails closed:
drift is the input it reads, and the redirect comes after the work.

## License

MIT

## Appendix: UI Reference

Everything the sidebar paints, kept for reference and never load-bearing for the runbook above.

### What it shows

- **Three encircled panels** — INTENT, REALITY and Δ, from a real recursive ballistic walk on the
  chip. Only the Δ panel's rings mean drift; the other two mean that corpus is dispersed about its
  own centre. Scattered work matching a scattered declaration reads clean on Δ and still rings on
  reality, and both readings are correct.
- **The 144-cell lattice** — rows are the actor lane, columns the patient lane, ShortLex on both.
  Your centre of mass, your peak, the growth edge, every room's declared pole and where its work
  actually sits.
- **The checkbox spec** — generated, and ticked only when the acceptance named on the item's own line
  runs green.
- **Both arms** — MOVE THE WORK (a declared coordinate no commit reached) and MOVE THE DECLARATION
  (a worked coordinate the spec never named). Never one without the other: sometimes the drift *was*
  the real work.
- **The refusals** — items the placer declined to place, below a calibrated margin floor where a
  confident wrong placement measured worse than chance. They carry no buttons.

### Commands

- **Steer: Run the Loop** — the whole loop: the chip walk first (named in the progress bar while it runs),
  then the other sensors, then the map + spec + panels + arms **in the ThetaCog side panel** (the
  activity-bar view). It never takes an editor column: the loop follows the `.txt` that is the active
  editor, and a page beside it would steal that focus. The page also carries the formal methods'
  receipts — the commit unit in the record's own units (KR40, dollars UNPINNED until the price table
  is dated), the covenant (KR37), the aperture (KR39), steering work (KR41) and both meters — read,
  never computed.
- **Steer: Open the Last Steer Page** — the same page without re-walking.
- **Steer: Open Semantic Cockpit** / **Refresh** — the three panels for one commit.
- **Steer: Preview the Working Tree** — *where would this land if committed now?* Own panel, own
  caption: PREVIEW · mutable tree · not a receipt.
- **Steer: Cycle** — the attractor envelope: both arms, pick one, re-run.
- **Steer: Steer This File** — points the tail watcher and the Claude Code hook at the active `.txt`,
  then runs Steer. Steer does this by itself whenever a `.txt` is the active editor.
- **Steer: Check the Tail** — an append to the dictation file is a SPEC AMENDMENT, never a command; it
  opens read-only and is retained in a tracked ledger.
- **`vna.stream`** — not a palette command but a door on the attest instrument's own origin: `GET http://127.0.0.1:7315/vna.stream` is a read-only Server-Sent-Events tail of the flight tape and the witness file, every `commit` · `batch` · `reading` · `witness` row as written (the raw signed line, never re-serialised) with its inclusion proof beside it; loopback only, no POST; verify what you receive with the same `verifyWitnessRow` the panel uses; a model may subscribe and tell a story afterwards, and nothing it says enters a receipt.

<!-- controls:begin — rendered by node scripts/vna/controls.mjs --readme; do not edit by hand -->
## The left panel — every control, what it stands for, what next

Every button, drawer and panel in the ThetaCog sidebar, with the tooltip it carries. This section is rendered from the painted page (`node scripts/vna/controls.mjs --readme`), so it says exactly what the panel says. A tooltip names what the control does, where the result lands, and what to do next.

### T1 · the page

- **INTENT** (`panel`) — declared mass — where the active spec rows planned to touch code; ring size is dispersion over the 144-basin lattice (green: one core · red: a dispersed scope); next: compare with REALITY — Declared: 1 row · 616 spec items · 61 headings · 13 questions · 4100 gzip-bytes
- **REALITY** (`panel`) — performed mass — the files this commit touched; red rings are broad dispersion across subsystems, not error; next: read Δ — Performed: 3 files · data/vna · scripts/vna · 2012 gzip-bytes
- **Δ** (`panel`) — performed minus declared; green in-lane · amber adjacent · red off-lane — scope-breadth, not a defect; next: open ▸ WHAT THE RINGS MEAN for the files under each ring — 14 rings · 16% off-lane · 0 red

### T1 · 1 behind HEAD

- **🚶 Walk HEAD** (`vna.steer`) · in ▸ g-health — walk the last authored commit again — every sensor (≈2 s) — and repaint; the same door as THE WALK card's 🚶; next: read Δ on the triptych
- **+** (`plus-walk`) — the walk — the commit and engine it read, the counts under each panel, the rings, the aperture, ▸ what the rings mean, and while Δ shows drift the fork (amend the basin · revert the drift); next: 🚶 Walk HEAD after your next commit
- **↗ Open the walk · 1m 9s ago** (`vna.openWalk`) · in ▸ plus-walk — opens docs/specs/vna/turns/latest.html · .thetacog/walk-tape.ndjson in the editor (the rendered page in a webview); next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **📝 Auto-Amend Spec Basin** (`vna.amendBasin`) · in ▸ plus-walk — the drift is the work: append an amendment row naming the working tree's pixel to the basin (C52a revision on the next fold), then run again; next: ⚡ Run Headless
- **↩️ Revert Drift Changes** (`vna.revertDrift`) · in ▸ plus-walk — the drift is a mistake: git restore exactly the tracked paths the working tree changed — refused while another room holds a live claim on one of them — then run again; next: ⚡ Run Headless
- **🚶 Walk HEAD · 16% off-lane · 0 red · walk 39s ago · 1 commit behind HEAD stale** (`g-health`) — how far the last walked commit sits from its declared lane — off-lane %, red rings, the age of the walk, commits behind HEAD; the face walks HEAD again (vna.steer — the same door THE WALK card runs, every sensor, ≈2 s) and re-renders; next: read Δ on the triptych
- **the aperture — 146.43:1 raw → 1.25:1 cut** (`g-health-ap`) — what the chip looked at — the engine, the raw→cut ratio and whether the aperture matched and cleared its byte floor; below the floor the walk is UNMEASURED, never wrong
- **Optimisers · 6 of 6 measured** (`g-optimisers`) — the optimisers — every loop result (read=write, steering, yield, retrieval, harness, suite) with its source, value and null, painted from the C183a receipt data/vna/loop-health.json; read-only, computes nothing; next: node scripts/vna/loop-health-set.mjs when a row is UNMEASURED
- **Net · holding · caught 20/20 · mesh 0 vs fence 2 · 15 thin · 0 holes** (`g-net`) — whether the net is holding — how many of the last commits the fence caught, mesh vs fence, thin cells and holes on the 144 lattice; next: a hole is a lane with no spec row, declare one
- **the map — 144 lattice, rows = actor lane, cols = patient lane** (`g-net-map`) — the 144-cell lattice — rows are the actor lane, columns the patient lane; a lit cell is a commit placed there; hover a cell for its coordinate and its rows
- **⇄ pick** (`vna.cycle`) · in ▸ g-fork — both arms with pick buttons — the pick is recorded, never inferred
- **Fork · arm 1: nothing · arm 2: nothing · pull 0.2 · 15 abstained ⇄ pick** (`g-fork`) — the two arms the drift offers — move the work back to the declaration, or move the declaration to the work — with the pull between them; ⇄ pick records your choice on the ledger, never inferred
- **The story — one frame** (`g-fork-story`) — one frame of what the walk saw, how it moved since the last commit, and what that means — read from data/vna/story.json, no model
- **The rooms** (`d-rooms`) — each room against its declared name — IN BAND held, RE-ROLL forced a new declaration, the pull between them; a flag, never acted on

### T1 · Δ 18

- **🔍 Rings** (`vna.openWalk`) · in ▸ plus-walk — the rings on each panel, read off the walk receipt (panel.rings) — I 11 · R 13 · Δ 18; only Δ's rings mean drift (green in-lane · amber adjacent · red off-lane); an I or R ring is self-dispersion, how tightly that corpus clusters about its own centre · opens docs/specs/vna/turns/latest.html · .thetacog/walk-tape.ndjson in the editor (the rendered page in a webview); next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **+** (`plus-rings`) — what the rings mean — the ShortLex redefinition in full: the three panels, the A/B/C horizons, the 144-basin lattice, the full ShortLex name of every active ring on THIS render, the aperture; next: hover a ring on Δ
- **▸ WHAT THE RINGS MEAN** (`details-meaning`) — what a ring means on each panel and where each active ring sits in THIS repo — the coordinate, the two subsystems, the files git placed there; the sufficiency contract, never a verdict; next: find your last commit's files under their ring
- **+** (`lxp-A`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-B`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-C`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-A1`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-A2`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-A3`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-B1`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-B2`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-B3`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-C1`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-C2`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)
- **+** (`lxp-C3`) — the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)

### T1 · 🚶 Walk HEAD

- **⇄ Pick an arm** (`vna.cycle`) · in ▸ plus-walk — the two arms the drift offers — move the work back to the declared coordinate, or move the declaration to where the work landed; the pick is written to the envelope ledger (node scripts/vna/envelope.mjs --pick work|declaration), never inferred; next: the next commit lands on the arm you took

### T1 · THE WALK

- **↗ Open the walk** (`vna.openWalk`) · in ▸ plus-walk — opens docs/specs/vna/turns/latest.html · .thetacog/walk-tape.ndjson in the editor (the rendered page in a webview); next: read it, or edit the file — the fold reads the hand-edited spec on the next turn

### T2 · THE APERTURE

- **🔍 View Aperture Receipt** (`vna.viewAperture`) — open the aperture receipt as a read-only native document beside the editor (steer://aperture/receipt.json, json): the intent rows and the spec basins they were itemized from, the reality rows with each file's blob sha at the immutable commit, the files the aperture excluded, κ over raw bytes, the Δ slack and ω; next: compare the files under REALITY with the rows under INTENT
- **+** (`plus-aperture`) — the aperture — what the chip looked at (files · bytes · share of the repo) against what was declared (intent rows), the two proportions as bars, the engine line, root and ω; next: 🔍 View Aperture Receipt for the rows themselves

### T2 · AUTONOMOUS RUNNER

- **⚡ Run Headless** (`vna.runGoal`) — one ephemeral claude -p per open unit, booted cold from the 1,500-token snowball instead of this session's context; the run halts unless every check holds: exit 0 · HEAD moved · red witness · guard green · fold · CAR; next: step away, read the receipt here
- **↗ Open the runner log** (`vna.openRunLog`) — opens .thetacog/runner.ndjson in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **+** (`plus-runner`) — the runner — the last run and its gates, the worker line, the saved and cost lines, tokens per cog; next: 📋 Copy Run Summary on the export pill
- **⚙️🔑 Engine & Keys · goose/qwen3:8b · 🔑 19d66dc5 · 10000 cr** (`vna.openEnginesConfig`) · in ▸ plus-runner — [Runner: goose/qwen3:8b · Local $0.00] — pick the worker the headless runner spawns (claude -p · goose · ollama · your own command with {snowball}) and set its keys; the keys live in VS Code SecretStorage and reach the worker through its env, never a file or this page; next: ⚡ Run Headless
- **▸ more** (`details-runner`) — the runner line · last run · performance · saved · cost · the engine; next: 📋 Copy Run Summary for the team
- **🛑 Abort Worker** (`vna.abortGoal`) — kill the active worker's process group; the abort is written to runner.ndjson as its own row; next: read why on this card, then run again
- **⚙️🔑 Engine & Keys · goose/qwen3:8b · 🔑 no licence** (`vna.openEnginesConfig`) · in ▸ plus-runner — [Runner: goose/qwen3:8b · Local $0.00] — pick the worker the headless runner spawns (claude -p · goose · ollama · your own command with {snowball}) and set its keys; the keys live in VS Code SecretStorage and reach the worker through its env, never a file or this page; next: ⚡ Run Headless
- **⚙️🔑 Engine & Keys · goose/qwen3:8b · 🔑 fixture · 3 cr** (`vna.openEnginesConfig`) · in ▸ plus-runner — [Runner: goose/qwen3:8b · Local $0.00] — pick the worker the headless runner spawns (claude -p · goose · ollama · your own command with {snowball}) and set its keys; the keys live in VS Code SecretStorage and reach the worker through its env, never a file or this page; next: ⚡ Run Headless

### T2 · HALT REASON / RED WITNESS

- **🛒 Buy licences** (`vna.notariseTape`) · in ▸ plus-halt — buy licence credits at thetadriven.com/notarise — email only, no company fields; the device flow starts here and the key lands in SecretStorage by the poll, one credit stamps one row; next: the 💳 reads credits left
- **🔍 Inspect Halt Reason** (`vna.inspectHalt`) — open the worker's output channel and the halt row runner.ndjson wrote — the reason is the file's own words (a red witness that stayed red, a commit that did not name its row, a lane the walk refused), never a typed list; next: fix the named cause, then 🔁 Retry Unit
- **+** (`plus-halt`) — the halt — the reason row in full, the red witness and its why, the retry; next: fix the named cause, then ⚡ Run Headless
- **⋮** (`ctx-vna.runGoal`) — more actions for this card — the secondary buttons, folded on a narrow panel
- **🔁 Retry Unit · Run Headless** (`vna.runGoal`) · in ▸ ctx-vna.runGoal — one ephemeral claude -p per open unit, booted cold from the 1,500-token snowball instead of this session's context; the run halts unless every check holds: exit 0 · HEAD moved · red witness · guard green · fold · CAR; next: step away, read the receipt here

### T2 · ⚙️🔑 Engine & Keys

- **⚙️🔑 Engine & Keys** (`vna.openEnginesConfig`) — open ⚙️🔑 Engine & Keys — the page that sets and reads the keys (SecretStorage, C166); the rows behind this pill's + are a face of it, never a second store
- **+** (`plus-engine-keys`) — the keys the runner can spend, per engine — held / no key, the fp8 (never the key), and when it was set (C245); read from SecretStorage through the host, never the key itself

### T2 · THE SECOND READER

- **💳 Fund Autonomy Ledger** (`vna.notariseTape`) — A second key countersigns your receipt and keeps it where your lead can fetch and recompute it — paths and hashes, never the code. the key with credits is held: every new row is stamped locally as it is written, one credit per row; this opens thetadriven.com/notarise?fp=<fp>&h=<h>&code=<code> again to top up — nothing leaves the machine; next: 🔗 Countersign (backup) when someone asks for the tape
- **+** (`plus-attest`) — the second reader — the signed rows and the height, the price and why you pay, the key, buy keys, the three doors (sign · notarise · countersign); next: 💳 Fund Autonomy Ledger
- **↗ Open the tape · 27s ago** (`vna.openTape`) · in ▸ plus-attest — opens data/vna/flight-tape.ndjson in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **🔗 Countersign (backup)** (`vna.backupTape`) · in ▸ plus-attest — post the tape + proofs as one content-addressed archive to thetadriven.com/api/backup/upload with your key — this is the door that LEAVES the machine, to the third party: a second reader who is not you countersigns the same bytes and keeps them where your lead can fetch and recompute them; it spends licence credits, one per archive; the manifest URL prints here, no file to find; next: paste that URL to a client, it carries no credential
- **⋮** (`ctx-vna.connect+vna.signTape+vna.enterEntitlement`) — more actions for this card — the secondary buttons, folded on a narrow panel
- **🔌 Connect** (`vna.connect`) · in ▸ ctx-vna.connect+vna.signTape+vna.enterEntitlement — OAuth 2.0 device flow on the tape's own key: the site shows a user code, login + payment + the licence happen there, the signed entitlement lands in SecretStorage (C75) with nothing to paste; next: the 💳 reads credits left
- **🔏 Sign this tape** (`vna.signTape`) · in ▸ ctx-vna.connect+vna.signTape+vna.enterEntitlement — sign HEAD onto the tape with your own key, free, local — every new row is already signed at append; this appends the commit row for HEAD now (auth-flow.mjs sign --sha HEAD); next: 💳 when you want a second key on the same rows
- **🔑 Paste licence key** (`vna.enterEntitlement`) · in ▸ ctx-vna.connect+vna.signTape+vna.enterEntitlement — the manual bypass — paste the licence key off the receipt page into a masked input box; the key is verified against the site's signing key before it is stored in VS Code SecretStorage, never in a file or a setting, and every new row is stamped locally from then on, one credit per row; next: 💳 reads credits left
- **▸ more** (`details-attest`) — the entitlement · credits · the witness · what this funds; next: 🔌 Connect under ⋮ when you hold a key
- **↗ Open the tape** (`vna.openTape`) · in ▸ plus-attest — opens data/vna/flight-tape.ndjson in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **☁️ Sync tape** (`vna.syncTape`) — send the signed rows the notary has not seen to the co-signer and keep its receipts beside the tape (data/vna/notary-witness.ndjson) — one credit per witnessed commit; the receipts carry the MMR proof once C85a lands; next: read k-of-n and the policy line in ▸ more

### T2 · 2478 signed

- **🔑 Licence** (`vna.openEnginesConfig`) · in ▸ plus-attest — open ⚙️🔑 Engine & Keys (C198) — the page that reads this claim beside the engines it pays for and takes another licence (C182d); the claim after this button is the metric, read off the entitlement, never the key
- **+** (`plus-key`) — the licence — paste a key or claim token; the site binds it to this device only (C173e: a second device is refused); next: 💳 reads Signed · credits
- **🔑 Paste a licence** (`vna.openEnginesConfig`) · in ▸ plus-attest — open ⚙️🔑 Engine & Keys (C198) — the bigger paste box (C182d: one licence or a list) and the engines the credits pay for; the inline box beside this button is the same door
- **Claim to this device** (`vna.enterEntitlement`) · in ▸ plus-attest — claim it to this device — the key lands in SecretStorage, the 💳 pill reads Signed · credits

### T2 · TOKENS PER COG

- **⚙️ Tokens per cog** (`vna.cogProof`) — open the proof — how this percentile was computed: the ruler (every cog a human minted here), the predict weights Σw·x over this ask's own walk, the peg per band and the discrepancy log; the graph of the recent asks; next: 🪙 Re-read session behind ⋮
- **+** (`plus-cog`) — tokens per cog — the peg per band, effectiveness, the stamp, the scatter and the three regimes; next: mint the next commit with node scripts/vna/cog.mjs --since <sha>
- **↗ Open the cog ledger · 5d 23h ago** (`vna.openCog`) · in ▸ plus-cog — opens data/vna/cog.ndjson · data/vna/cog-peg.json in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **⋮** (`ctx-cog`) — more actions on this card; next: 🪙 Re-read session
- **🪙 Re-read session** (`vna.steer`) · in ▸ ctx-cog — run every sensor and repaint — the cog card reads data/vna/cog.ndjson, data/vna/cog-peg.json and this session's transcript usage rows on each paint; to mint new commits first: node scripts/vna/cog.mjs --since <sha>; next: the peg walk (node scripts/vna/peg.mjs --transcript <jsonl>) writes the moves
- **▸ more** (`details-cog`) — the scatter · the three regimes · hours per cog · the band table · this session against the ceiling and the floor · the receipts
- **The envelope — the formal methods, read from their receipts** (`g-cog-fm`) — the formal methods on their receipts — the crystal, the shape guards, the readings — each PROVED, MEASURED or UNMEASURED from its own file, never asserted here
- **↗ Open the cog ledger** (`vna.openCog`) · in ▸ plus-cog — opens data/vna/cog.ndjson · data/vna/cog-peg.json in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn

### T2 · AUTO-PASTE

- **🟢 auto-paste** (`vna.clipArm`) — every ⌘C appends to the steer file (clip-watch daemon pid 5754); untick to stop reading the clipboard; next: 🌳 fold → tree
- **↗ Open the steer file** (`vna.openBridge`) — opens .thetacog/vna-steer-file.json · docs/specs/vna/RESEARCH-BUNDLE.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **+** (`plus-live`) — the auto-paste line — HEAD and the walk behind it, the tree door, ⤵ Ingest Clipboard and 🔄 refresh, the feed doors, the installed build, the doors audit, asked-vs-built, the panel signal, then the workbench, the ingest receipt and the steer file; next: 🌳 fold → tree when the tape is ahead
- **⋮** (`ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree`) — more actions for this card — the secondary buttons, folded on a narrow panel
- **⤵ Ingest Clipboard · last 1d 18h ago** (`vna.clipIngest`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — one click: the clipboard lands on the steer file under a clip stamp, becomes a ledger row, and the fold runs now — the line above then reads what the fold did; next: 📥 Ingest Refined Goal
- **🔄 refresh · 20s ago** (`vna.refreshPage`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale
- **↻ Reload Window** (`vna.reloadWindow`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — Developer: Reload Window — remounts the extension host and re-reads the manifest (views, titles, activation events); 🔄 refresh only repaints this panel from the receipts on disk and cannot. Use it when a button toasts "not registered in this window" or the pane spins; Restart Extensions cannot fix a stale window
- **📄 follow .txt** (`vna.steerThisFile`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — point the tail watcher + the hook at the active .txt; next: append to it and watch the auto-paste pill
- **⤓ tail** (`vna.checkTail`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — turn new appends into rows now; next: 🌳 fold → tree
- **🌳 fold → tree** (`vna.pasteToTree`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — fold every new row into the Merkle spec tree; next: read the released asks under the 📄 Open Spec +
- **🌲 tree · 7m 27s ago** (`vna.openTree`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — open the spec tree in the editor, the age is the last fold's — opens data/vna/spec-tree.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **🟢 auto-paste · 🟢 auto-paste ON · txt +1,561B 4h 19m ago by CLIPBOARD · NOT YET READ** (`g-feed`) — what the loop is reading — the steer file the clipboard and the tail watcher append to, and whether the daemon has read it yet; the face is the clipboard's state (🟢 armed · ⚪ not), the toggle itself is on the live line; next: fold it into the tree (📋→🌳) or walk
- **The steer file — what the loop follows** (`g-feed-steer`) — the .txt the loop follows (its path, size, last append, who appended) — every ⌘C with auto-paste on and every tail append lands here before it is folded
- **⚪ auto-paste** (`vna.clipArm`) — tick to start clip-watch: every ⌘C appends to the steer file under a clip stamp; next: copy a paragraph
- **⤵ Ingest Clipboard** (`vna.clipIngest`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — one click: the clipboard lands on the steer file under a clip stamp, becomes a ledger row, and the fold runs now — the line above then reads what the fold did; next: 📥 Ingest Refined Goal
- **🔄 refresh** (`vna.refreshPage`) · in ▸ ctx-vna.clipIngest+vna.refreshPage+vna.reloadWindow+vna.steerThisFile+vna.checkTail+vna.pasteToTree+vna.openTree — repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale

### T2 · THE TREE

- **⚡ /clear the terminal** (`vna.clearClaudeTerminal`) · in ▸ plus-tree — send /clear to the active Claude terminal — you are carrying 4.6 MB of transcript because it feels needed; the tree holds everything that was folded, so a clear loses 0 B and the next turn re-seeds from the spec; next: the snowball boots the next turn cold
- **📋→🌳 Paste → Tree** (`vna.pasteToTree`) · in ▸ plus-tree — arm the clipboard, fold every new amendment row into the tree, repaint
- **🌳 Open Tree** (`vna.openTree`) — open the spec tree in the editor — opens data/vna/spec-tree.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn; the metric is the tree's nodes, its Merkle root, its revisions and how far it is behind the tape; next: 📋→🌳 Paste → Tree when it is behind
- **+** (`plus-telemetry`) — the tree — its facts, then the raw telemetry for the Merkle tree and the ballistic walk (the root, the fold, the last prompt's pixel with its gain and z, the basins lit, the chain's height and signature, the build, the backups); read-only, from receipts, no model; next: 📋→🌳 Paste → Tree when the tree is behind
- **↗ Open the tree · 7m 56s ago** (`vna.openTree`) · in ▸ plus-telemetry — opens data/vna/spec-tree.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **tree · root dc4765e3 · 12629 nodes · 328 ungraded · open →** (`vna.openTree`) · in ▸ g-tasks — opens data/vna/spec-tree.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **🔑 Connect / Buy credits** (`vna.connect`) · in ▸ plus-tree — OAuth 2.0 device flow on the tape's own key — login, payment and the licence happen on the site (C75)
- **↗ Open the tree** (`vna.openTree`) · in ▸ plus-telemetry — opens data/vna/spec-tree.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn

### T2 · AT THE TAPE

- **+** (`plus-wb`) — the workbench — the developer's four facts from receipts: the /goal and its units, the next unit of work, the last seed, the fold, the borne-out counts, and the doors 🌳 open tree · ⚡ walk; next: 📋→🌳 Paste → Tree when the ledger is ahead of the tree
- **🌳 open tree** (`vna.openTree`) · in ▸ plus-wb — open the spec tree in the editor — opens data/vna/spec-tree.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **⚡ walk** (`vna.steer`) · in ▸ plus-wb — run the sensors and repaint

### T2 · +1,540 bytes from transcript:ab2baf02-9403-46d0-8a21-ed39332c2bdd

- **⤵ Ingest** (`vna.clipIngest`) · in ▸ plus-live — one click: the clipboard lands on the steer file under a clip stamp, a ledger row is written, the fold runs; this line is the Rust walk's receipt for the LAST paste — every number is the hook's
- **+** (`plus-ingest`) — the last paste's receipt rows — paste · fold · walk · basin · state; every number is the hook's, not run when the hook has not

### T2 · 4h 19m

- **📄 steer.txt · row 7149** (`vna.steerThisFile`) · in ▸ g-feed — open docs/05-content/blog/scratchpad/steer.txt in the editor (vna.steerThisFile)
- **📑 7176 rows · 1h 48m** (`vna.openAmendments`) · in ▸ g-feed — open docs/specs/vna/amendments.ndjson in the editor (vna.openAmendments)
- **📜 spec · 19s** (`vna.openSpec`) · in ▸ g-feed — open docs/specs/vna/SPEC-VNA-COCKPIT.md in the editor (vna.openSpec)
- **🌲 dc4765e3 · 12629 nodes · 28649 rev · 7m 28s** (`vna.openTree`) · in ▸ g-feed — open the spec tree (data/vna/spec-tree.txt) in the editor (vna.openTree)

### T2 · EXPORT

- **📋 Copy Run Summary** (`vna.copyRunSummary`) — one line for the team — unit · verdict with its gates · the worker's tokens · tokens not re-sent · Δ, each from runner.ndjson, the meter and the cockpit, never typed; next: paste it where "what did the agent do" gets asked
- **+** (`plus-export`) — the export — the Verified line in full, the whole-state export for a chat; next: 📋 Copy Run Summary, then paste it in the chat on the right
- **⋮** (`ctx-vna.copyPayload`) — more actions for this card — the secondary buttons, folded on a narrow panel
- **📋 export** (`vna.copyPayload`) · in ▸ ctx-vna.copyPayload — copy the state for a chat — stamped, never re-ingested; next: paste it into the chat on the right
- **Export · 5 tape rows · 114 open** (`g-export`) — copy the whole state as text for a chat — the shape, the movement, the meaning and the open rows; stamped on its first line so the daemon never re-ingests it
- **📋 Copy the whole state** (`button`) · in ▸ g-export — copy the state below to the clipboard — paste it into the chat on the right; it is stamped, so pasting it back never re-enters the tree

### T2 · ACTIVE CONTRACT

- **📄 Open Spec** (`vna.openSpec`) — open the spec in the editor (opens docs/specs/vna/SPEC-VNA-COCKPIT.md in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn) — the rows, the ticks, the active unit; edit a row and the fold reads it on the next turn; next: ⚡ Run Headless on the open unit, or work it by hand
- **🧪 Open Red Witness** (`vna.openGuard`) — open tests/vna/c266-the-calibration-run-is-on-the-record.test.mjs in the editor — the test the row names, the one that must fail red before code lands and green after; next: node --test tests/vna/c266-the-calibration-run-is-on-the-record.test.mjs
- **+** (`plus-contract`) — the contract — the unit and its lane, the red witness, the hook sentence, the coordinate; next: 🧪 Open Red Witness
- **📄 View Unit Contract** (`vna.viewUnit`) · in ▸ plus-contract — open this unit's spec row in the editor (docs/specs/vna/SPEC-VNA-COCKPIT.md at the row's line — edit it if you like, the fold reads the file on the next turn) — its invariants, its acceptance checklist and the guard path that must fail red before code lands; next: run it headless on the ⚡ pill, or work it by hand
- **⋮** (`ctx-vna.copyGoal`) — more actions for this card — the secondary buttons, folded on a narrow panel
- **📋 copy the goal** (`vna.copyGoal`) · in ▸ ctx-vna.copyGoal — copy the /goal with its units in execution order and the command that runs them — for a fresh Claude or for you; next: paste it into a fresh terminal
- **⋮** (`ctx-vna.copyResearch+vna.ingestGoal`) — more actions for this card — the secondary buttons, folded on a narrow panel
- **🧠 Copy Prompt Bundle** (`vna.copyResearch`) · in ▸ ctx-vna.copyResearch+vna.ingestGoal — rebuild RESEARCH-BUNDLE.txt from the receipts and copy it: the active basin, the recent Δ coordinates, the open rows and the goal, with the handshake — paste it to a browser model (Gemini, Claude); next: 📥 Ingest Refined Goal with its answer on the clipboard
- **📥 Ingest Refined Goal** (`vna.ingestGoal`) · in ▸ ctx-vna.copyResearch+vna.ingestGoal — read a refined /goal from the clipboard and run goal.mjs import --validate --install — every row it names must be a basin in spec-tree.json or the gate refuses and says which; on ACCEPTED it is written to data/vna/goal.json and card 1 shows unit 1; next: run it headless on card 2
- **▸ more** (`details-contract`) — the hook sentence · the three pluses · the unit · the coordinate · preview · spec · export; next: 👁 preview before you commit
- **⚡ walk · 48s ago** (`vna.steer`) · in ▸ details-contract — run every sensor and repaint the panels from the new receipt; next: read Δ
- **👁 preview · 43s ago** (`vna.preview`) · in ▸ details-contract — where would the working tree land? — a look, not a receipt; next: commit to make it one
- **📜 spec · 27s ago** (`vna.openSpec`) · in ▸ details-contract — open SPEC-VNA-COCKPIT.md in the editor; next: edit a row, the fold reads it on the next turn
- **📋 export · 6d 6h ago** (`vna.copyPayload`) · in ▸ details-contract — copy the state for a chat — stamped, never re-ingested; next: paste it into the chat on the right
- **🔄 refresh · 21s ago** (`vna.refreshPage`) · in ▸ details-contract — repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale
- **📄 Open SPEC-VNA-COCKPIT.md** (`vna.openSpec`) · in ▸ g-tasks — opens docs/specs/vna/SPEC-VNA-COCKPIT.md in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **📄 Open SPEC-VNA-COCKPIT.md · spec 502/616 · 114 open · tree dc4765e3 · 12629 nodes · 28649 rev** (`g-tasks`) — what is on the spec and how much is ticked — the checked rows and the Merkle tree they fold into; the face opens docs/specs/vna/SPEC-VNA-COCKPIT.md in the editor (vna.openSpec); next: the unit card 1 names
- **Open questions** (`d-questions`) — the open questions the ratchet has not yet closed — each filed under the id it was raised at; read before filing a new one
- **The trigger** (`d-trigger`) — what makes a corpus attach-eligible and what happens once it does — the coverage gap and the attach curve, read from the trigger receipt, never typed
- **The tape — last 5 entries (the mass in the paste)** (`d-tape`) — the last commits taped and where each was placed — an UNPLACED entry carries no coordinate yet, never a guess
- **⚡ walk · 10s ago** (`vna.steer`) · in ▸ details-contract — run every sensor and repaint the panels from the new receipt; next: read Δ
- **👁 preview · 21s ago** (`vna.preview`) · in ▸ details-contract — where would the working tree land? — a look, not a receipt; next: commit to make it one
- **📜 spec · 1m 29s ago** (`vna.openSpec`) · in ▸ details-contract — open SPEC-VNA-COCKPIT.md in the editor; next: edit a row, the fold reads it on the next turn
- **🔄 refresh · 40s ago** (`vna.refreshPage`) · in ▸ details-contract — repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale
- **⚡ walk · 50s ago** (`vna.steer`) · in ▸ details-contract — run every sensor and repaint the panels from the new receipt; next: read Δ
- **👁 preview · 1m 0s ago** (`vna.preview`) · in ▸ details-contract — where would the working tree land? — a look, not a receipt; next: commit to make it one
- **📜 spec · 2m 8s ago** (`vna.openSpec`) · in ▸ details-contract — open SPEC-VNA-COCKPIT.md in the editor; next: edit a row, the fold reads it on the next turn
- **🔄 refresh · 19s ago** (`vna.refreshPage`) · in ▸ details-contract — repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale
- **👁 preview · 26s ago** (`vna.preview`) · in ▸ details-contract — where would the working tree land? — a look, not a receipt; next: commit to make it one
- **📜 spec · 2m 46s ago** (`vna.openSpec`) · in ▸ details-contract — open SPEC-VNA-COCKPIT.md in the editor; next: edit a row, the fold reads it on the next turn
- **🔄 refresh · 57s ago** (`vna.refreshPage`) · in ▸ details-contract — repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale
- **⚡ walk · 15s ago** (`vna.steer`) · in ▸ details-contract — run every sensor and repaint the panels from the new receipt; next: read Δ
- **👁 preview · 48s ago** (`vna.preview`) · in ▸ details-contract — where would the working tree land? — a look, not a receipt; next: commit to make it one
- **📜 spec · 3m 8s ago** (`vna.openSpec`) · in ▸ details-contract — open SPEC-VNA-COCKPIT.md in the editor; next: edit a row, the fold reads it on the next turn
- **🔄 refresh · 1m 19s ago** (`vna.refreshPage`) · in ▸ details-contract — repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale

### T2 · THE SPEC

- **spec · 502/616 ticked · 114 pending · open →** (`vna.openSpec`) · in ▸ g-tasks — opens docs/specs/vna/SPEC-VNA-COCKPIT.md in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn
- **+** (`plus-spec`) — the spec's borne-out counts (GUARDED · MEASURED · BUILT · DECLARED, read from each guard's last run) and the tick bar; the rows themselves are in the file the line opens; next: ↗ open →

### T4 · the page

- **🌲 tree** (`vna.openTree`) — open the spec tree in the editor, the age is the last fold's — opens data/vna/spec-tree.txt in the editor; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn

### T5 · the page

- **+** (`plus-loop`) — the loop — §25's sentence, the shebang and the tagline, then the short form, the receipts count and when this page was painted; next: read the stats beside the +
<!-- controls:end -->
