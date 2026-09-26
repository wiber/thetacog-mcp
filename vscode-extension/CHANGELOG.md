# Changelog — ThetaCog Steer: Double-Entry Bookkeeping for Autonomy

Every entry names the commit it shipped in. Where a row landed is recomputable from that commit; whether it was good is not claimed.

## 0.3.53 — 2026-09-26 · 🔨 build by voice
- **A second box on 🎙️ Audio Stream: 🔨 auto-build.** Ticked, anything you say that opens with "steer …" or "build …" — and that the walk admits — goes to /steer as a dictation (its own rows only, ≤ 2 cycles, $20 each). Everything else still just slots into the tree.
- **Why the cue:** replayed part by part, a half hour of chatter had 8 of 32 parts pass the walk on their own. Where speech lands is not whether you asked for a build.
- The pill's build line reads parts walked · admissible · addressed · dispatched for the last 30 minutes.
- Guard: c233 (2671e22539).

## 0.3.52 — 2026-09-25 · 🎙️ the audio stream is a basin
- **🎙️ Audio Stream, directly above 📋 Copy Run Summary** — tick the checkbox and the mic is transcribed on this machine (whisper, Silero VAD), one timestamped line per utterance into `.thetacog/audio/stream.txt`; on a timer the lines slot into the tree through the same door a paste takes. Click the face to open the txt.
- **Its stats are read, never typed** — utterances and words per minute with a 30-bar spark, heard · slotted · carried · junk · owed, transcribe ms · lag, and the Merkle roots, nodes and spec nodes added in the last 30 minutes.
- **The settings are measured** — `node scripts/vna/audio-basin.mjs optimise` sweeps model × chunk length against a spoken reference and writes the pick to `data/vna/audio-basin-config.json`.
- Guard: c233 (ca3619f935).

## 0.3.47 — 2026-09-24 · one name for the keys door, one pill shape, and a release that reaches every editor
- **⚙️🔑 Engine & Keys is the door's one name** — the sidebar pill, the page title, its h1, the status-bar tooltip, the runner drawer's door and the command palette all read one constant (`scripts/vna/door-labels.mjs`, mirrored into `src/door-labels.ts` by generator, never re-typed). Before: "🔑 Engine keys" on the pill, "⚙️ Engine & Keys" on the page, "⚙️ Engines, Keys & Licences" in the drawer (C243, `016abd20e5`).
- **The keys pill is the same pill as every other pill** — the door on the face, `N of M held` beside it, the + inside the face, and behind the +: one row per engine — held / no key, the fp8 (never the key), and when it was set (off the C179a audit ledger; a held key with no row reads `set — no record`). A host that passes no rows reads `open ⚙️🔑 Engine & Keys to read` (C245, `4685c905f8`).
- **The key you Set shows up on the next render, not the one after** — the host now reads SecretStorage before it spawns the runner resolver, so a render in that window no longer paints the boot cache's "no key" (C245).
- **`npm run release`** packages once, prints the Marketplace + Open VSX publish commands (dry by default; `npm run release:publish` runs them — VSCE_PAT / OVSX_PAT from env or .env.local, named when missing, never printed), regenerates thetadriven.com/vsx from `data/vsx/release.json` (the version, the download, the sha256, `/vsx/release.json`), and reads all three back on one line: `marketplace <v> · open-vsx <v|404> · /vsx <v> · MATCH|MISMATCH` (C244, `6c73561da7`). Open VSX — the registry Cursor, Windsurf and VSCodium install from — is a publish away from answering 404.
- Guards: c243 · c244 · c245 (seen red before each change).

## 0.3.46 — 2026-09-24 · ⏹ stops the run the model started; the chain of thought is kept beside the reply; the keys, proved live
- **⏹ ends every /steer child a chat turn started.** The fenced `/steer until` a model fires (C207) and the typed verb in the inline form both ran on after ⏹ — 0.3.42 had fixed the section's typed verb only. One route now: actOnModelReply → runSteerVerb under the turn's signal, the inline branch on that same door with the controller ⏹ aborts, and the section keeps the turn in flight until the model's run ends (C217 for real, `789507e52d`).
- **The chain of thought never reaches the bubble.** A thinking model's `<think>…</think>` block (or ollama's `message.thinking`) is split out of the answer by chat-core.js and written beside it, one row per turn, to `.thetacog/chat/cot.ndjson`; `node scripts/vna/steerchat.mjs cot` prints the last N rows, thinking and reply labelled apart (C246, `2ff8899c3b` + `d2f7c112a1`).
- **`node scripts/vna/key-proof.mjs [--wait 900]`** reads the next claude worker row's `key_source` off runner.ndjson and prints ✓ or FAIL — the live proof that the key you Set is the key the run spends; SecretStorage is readable only in the extension host, so the record the worker leaves is the only place to read it (`1d3ad4797b`).
- Guards: c246 · c217 (rewritten; runs the real fixture child off the TypeScript source, never the out/ build) · c239a (same loader) · key-proof.
- Also in this build: C243 — one name for the keys door, ⚙️🔑 Engine & Keys, from one constant (`016abd20e5`, the other unit; landed on HEAD before this bump).

## 0.3.45 — 2026-09-24 · the recompute door: a stranger re-derives a receipt from its commit and writes down what they got
- **🔁 Recompute this receipt** (`vna.recomputeReceipt`) runs `scripts/vna/recompute-receipt.mjs` — `npx thetacog-mcp recompute-receipt --receipt <file>` away from home — on the 🔍 aperture document, a receipt .json open in the editor, or the workspace's own. The door re-derives the receipt's tuple from the IMMUTABLE commit with the code that made it (ω under aperture-receipt.mjs's own recipe, every reality blob at the commit, the spec basins at the commit, the kept window of every file re-cut on the engine the receipt names — the chip or node) and answers **match / MISMATCH / UNMEASURED** with both hashes. A receipt whose tuple is altered by one byte reads MISMATCH; a commit that is not in the repository, a chip the receipt names that is not here, or a preview receipt reads UNMEASURED with the reason, never match. The result opens beside the editor with ONE pasteable line first; a toast copies it. `docs/receipts/README.md` says how a third party appends that line to `docs/receipts/third-party-recompute.md` — the file this repo never writes itself (C241).
- The 🔍 aperture document now opens as jsonc with the recompute command, ω, the commit and the aperture version as comment lines at its top — a stranger's run has one line to paste.
- Guards: c241 (seen red on the missing command) · c116 accepts jsonc.

## 0.3.44 — 2026-09-24 · same as 0.3.43, with the chat's runner-env door injected at activation
- The 💬 chat's `/steer` takes its env through a door extension.ts wires at activation (`setRunnerEnvDoor(runnerEnv)`) instead of a static import of the keys module — the chat host module stays loadable in plain node, which thirteen guards depend on (C239a follow-up, `c850b90bcc`). Behaviour in the IDE is 0.3.43's.

## 0.3.43 — 2026-09-24 · the key you Set is the key the run spends, and the pill says so
- **⚙️ Engine & Keys · Set** now round-trips to every reader: the page reads `● stored`, the sidebar's **🔑 Engine keys** pill reads `claude/claude -p · key held (<fp8>)` — never the key, a one-way fingerprint — and every render door carries those rows, not only ⚡ Run Headless's (C239, `eb2a595f84`). Before: the key sat in SecretStorage while the pill read "set or check keys".
- **The 💬 Steer chat's `/steer` spawns on the same env as ⚡ Run Headless**, so a claude worker dispatched from the chat runs on the key you Set (`key_source: secretstorage` on its runner row). Measured before the fix: 103 of 103 claude worker rows in 36 h ran on no key at all (C239a, `e29073c3c2`).
- **media/chat.js parses again** — a comment had swallowed half an `||` (C223); the chat view would have mounted dead in this build. A guard parses every webview script (C239b, `a3ab3e8183`).
- 0.3.38–0.3.42 (2026-09-22/23, no entries here): C167–C226 — the chat in its own section, gemma/qwen roles, the 🤖 hands dropdown, claude -p with a named model, ⏹ stop, /workers · /end.
- Guards: c239 · c239a · c239b.

## 0.3.37 — 2026-09-22 · the download wedge, the local engine boots from the pill, chat is inline
- The listing leads with the download wedge and the measured token-savings story, the diet the run pays for its own attestation (C166, `9c6b8eeabb`).
- **💬 Local Ideation** is a sub-pill of ⚡ Run Headless, visible on the starter — an inline form (a steer verb or a question), streamed over the sidebar's own already-installed webview channel, never a second window (C167d/e/g).
- **⏵ Boot** / **⏹ Halt** bring the local engine up or down from the pill beside its 🟢/🔴 reading; the model is picked from `/api/tags`, never a hardcoded tag (C167e).
- **💳 Fund Autonomy Ledger** and **🔑 the licence box** are now indented sub-pills — one tier under ⚡ Run Headless, the licence box one tier deeper still, beside ⚙️ Tokens per cog (C172, C173a).
- The +/− toggle holds its one fixed box open or closed across every pill, root or indented (C172).
- The host key signs when no licence key is held; the machine keychain is the source of truth, VS Code SecretStorage mirrors it (C173d).
- Guards: c118 · c122 · c141 · c150 · c172 · c173a.

## 0.3.29 — 2026-09-21 · the claim token: paste the email, the licence binds to this device
- Bought on the site without the IDE open? The purchase email now carries a **claim token**. A box at the top of the sidebar (shown while no key is held) takes it — or a licence key — and the extension asks the site to bind your licences to this machine's key and hands back the key. Nothing to sign in to, nothing to paste twice (C161). The 🔌 Connect device flow still works as before.
- The 💳 pill's empty-state tooltip and the unclaimed email name the exact door (⋮ › 🔌 Connect, or the box) — C160.
- Guards: c161-claim-token (4) · c102a · c84h · c103d re-ratcheted.

12026-09-21 · the ten pills, the floating lead, the fund action that no longer refuses
- The name says it: **ThetaCog Steer: Double-Entry Bookkeeping for Autonomy**. The 💳 reads **Fund Autonomy Ledger** on every surface (C143).
- The left panel is TEN pills in the operator's order — 🚶 Walk HEAD [↳ 🔍 View Aperture Receipt] · ⚡ Run Headless · 💳 Fund Autonomy Ledger [↳ ⚙️ Tokens per cog, with its graphs] · ☑ 🟢 auto-paste [↳ 📋 Copy Run Summary · ↳ 🌳 Open Tree] · 📄 Open Spec [↳ 🔍 Inspect Halt Reason] — everything else folded under a + (C141–C152).
- The lead floats: the + and the pill's button stay on screen as the page scrolls sideways; the counts are beside the button, never on it, so you scroll to read them (C150, C150d). The ShortLex canonical rows float their identity term and expand (C150c).
- ⚙️ Tokens per cog carries THE RATCHET TO THE DIGNITY PIXEL (the ruler · the peg · the rank · the pixel, four receipts) and the envelope — the formal methods on their receipts (C155).
- 💳 Fund Autonomy Ledger on a fresh window no longer refuses with `no_room`: the licence binds to the key the tape signs with — the host key when no room is known (C156, `thetacog-mcp` 2.54.0). The page it opens carries the checkout form: type your email, the keys are mailed (box pre-checked) or shown once on the paid page to paste (C157, site).
- Guards: c141 · c142 · c143 · c150 · c152 (in c142) · c155 · c156 (auth-flow.test) · c157.

12026-09-20 · the stranger's first run
- A repo that has never declared a spec row walks HEAD with the commit message as intent and says so on the receipt (`intentFallback`), instead of dying on a missing `docs/specs/vna/SPEC-VNA-COCKPIT.md`.
- The NEXT → card reads `not run — <path> absent` when the onboarding steps file is missing, instead of taking the page down.
- The npm package (`thetacog-mcp` 2.54.0) now ships `docs/specs/vna/ONBOARDING-STEPS.md` — it was copied at prepack and dropped by the `files` whitelist.
- Marketplace listing fields: `pricing: Free`, `bugs`, `galleryBanner`, this changelog. Guard: `tests/vna/c125-stranger-first-run.test.mjs`.

## 0.3.26 — 2026-09-20 · `b07ef9d2fa`
- The lifecycle pill knows three versions (window · code · source) and names the one remedy — Reload Window, or rebuild-and-install — from outside the pane, so a blank sidebar is never silent.

## 0.3.25 — 2026-09-20 · `2b0ad68bf1`
- The view id is `thetacog.steer`; the pane title no longer collides with VS Code's cached "VNA — where the work landed".

## 0.3.24 — 2026-09-20 · `16f5b19a78`
- The activity bar carries the TD shield, monochrome.

## 0.3.23 — 2026-09-20 · `51e3341e67`
- The sidebar carries the name "ThetaCog Steer: Double Entry for Autonomy".

## 0.3.22 — 2026-09-20 · `95a25d6b9d`
- The aperture door (`steer://aperture/receipt.json`) opens as a read-only native document; every toast says Steer; the palette titles are the painted labels.

## 0.3.21 — 2026-09-20 · `ee3e9c54e6`
- One steer-ui render in flight at a time (trailing 2 s coalescer), reaching the running window on reload.

## 0.3.20 — 2026-09-20 · `86b41dd70a`
- The settings title reads ThetaCog Steer.

## 0.3.19 — 2026-09-20 · `ca5eb96fd5`
- 💳 Notarise insurable tape: the device flow (RFC 8628) from the sidebar — no paste, no download; the licence lands in SecretStorage by the poll.
- 🔗 Countersign (backup) · 🔑 Enter Key · the Steer: command palette.

## 0.3.2 — 2026-09-17 · `adc7628af8`
- The steer page opens in the side panel, never an editor column.

## 0.3.0 — 2026-09-17 · `ef6578c39f`
- Steer follows the file open; tail watcher + "seen by Claude" from the hook's receipt.
