# Receipts — recompute one, write down what you got

A ThetaCog aperture receipt (`data/vna/aperture-receipt.json` in a repository that runs the walk) names the commit it was read from, every file that painted reality with its blob sha and the byte window the chip kept, the spec basins that were intent, and ω — a sha256 over that tuple under a recipe the receipt itself prints. Everything in it is recomputable from the commit. This directory is where people who are not us write down that they recomputed one.

`docs/receipts/third-party-recompute.md` is that record. It does not exist until a third party creates it, and nothing in this repository writes it. One line per recompute, appended by the person who ran it, in a pull request from their own fork.

## The line

The door prints exactly one line, and that line is what you append:

```
RECOMPUTE · receipt <commit10>@<aperture_version> · commit <sha40> · expected ω <sha256> · recomputed ω <sha256 | UNMEASURED> · <match | MISMATCH — why | UNMEASURED — why> · <engine> · <platform-arch release · node vN> · <ISO date>
```

- `receipt` — the tuple key: the first ten hex of the commit and the aperture version the receipt was cut under.
- `expected ω` — the hash the receipt carries. `recomputed ω` — the hash over the rows re-derived from the commit on your machine, or `UNMEASURED` when a leg could not run.
- the verdict — `match` when every leg re-derives; `MISMATCH — why` names the leg that differed (a row, a blob, a basin, the hash); `UNMEASURED — why` names what was missing (the commit, the chip, a preview receipt). An UNMEASURED line is worth appending: it says what a stranger's machine could not read.
- `engine` — `rust-aperture` (the chip, `pmu-onchip --aperture`) or `node-aperture`; the door re-runs the engine the receipt names, never a different one.
- the machine line and the date are yours. No hostname, no username — only the platform, the kernel release and the node version.

Append the line as printed. Do not edit the hashes, do not paraphrase the verdict, and do not add a line for a run you did not do.

## How to produce one, end to end

1. Get a receipt. Start with `docs/receipts/public-target/aperture-receipt.json`: it was cut against a commit in a public repository, so you can check out everything it names. Or use one someone emailed you as a `.json` file.
2. Have the commit it names. The line `"commit"` in the receipt is a sha; the door reads `git ls-tree` and `git show` at that sha, so run it inside a checkout that contains the commit. For the public-target receipt: `git clone https://github.com/wiber/thetacog-mcp.git && cd thetacog-mcp && git checkout 9d739ec11ca2be0ea706734b188b0ef1df7e1f9d`. That checkout carries the door itself (`scripts/vna/recompute-receipt.mjs`) and the chip's source (`pmu-rust/`); `docs/receipts/public-target/README.txt` has the exact commands and the line we got. For a receipt from another repository, clone that one; a receipt whose commit sits in a repository you cannot clone is one you cannot recompute, and the door says UNMEASURED rather than guess.
3. Run the door, either way:
   - from the IDE: install the ThetaCog Steer extension, open the checkout, open the receipt (`.json`) in the editor or run **Steer: 🔍 View Aperture Receipt**, then run **Steer: 🔁 Recompute this receipt** from the command palette. The result opens beside the editor with the line first; the toast's **Copy the line** puts it on the clipboard.
   - from a terminal, inside the checkout: `npx thetacog-mcp recompute-receipt --receipt <path-to-receipt.json>` (or, inside this repository, `node scripts/vna/recompute-receipt.mjs --receipt <path>`). The line is the first line printed; exit 0 is match, 1 MISMATCH, 2 UNMEASURED.
   - the receipt says which engine cut it. `rust-aperture` needs the chip: `cargo build --release` in `.thetacog/pmu` of the checkout (in the thetacog-mcp checkout the crate is `pmu-rust/`), or `PMU_BINARY=<path to pmu-onchip>`. Without it the door prints UNMEASURED and says so; it does not fall back to node and call that a match.
4. Append the line to `docs/receipts/third-party-recompute.md` in your fork — create the file if you are the first — and open a pull request. One line, as printed, nothing else on it.

What a match is sufficient for: that the bytes the chip was fed came from that commit under that aperture, re-derived on a machine we do not control. What it is not sufficient for: whether the walk was right. That is undecidable (Rice), no receipt claims it, and neither does your line.
