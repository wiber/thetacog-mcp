A RECEIPT A STRANGER CAN RECOMPUTE (C423)

The receipt beside this file, aperture-receipt.json, was cut against a commit in a PUBLIC repository.
Anyone with git, node and (for the chip) cargo can check it out and re-derive it. Nothing was pushed to cut it:
the commit was already public when the receipt was read from it.

  repository   https://github.com/wiber/thetacog-mcp.git
  commit       9d739ec11ca2be0ea706734b188b0ef1df7e1f9d
  engine       rust-aperture (pmu-onchip --aperture, built from pmu-rust/ at that same commit)
  aperture     c691ab7a55de806c
  omega        c67ed60157f17f646ce5e15fd9008620cc49537bef74f5ec7ab910bafe215e33

THE COMMANDS, in a clean directory (save aperture-receipt.json from this directory first):

  git clone https://github.com/wiber/thetacog-mcp.git
  cd thetacog-mcp
  git checkout 9d739ec11ca2be0ea706734b188b0ef1df7e1f9d
  (cd pmu-rust && cargo build --release)
  PMU_BINARY=$PWD/pmu-rust/target/release/pmu-onchip node scripts/vna/recompute-receipt.mjs --receipt <path-to>/aperture-receipt.json

The first line printed is the line. Exit 0 is match, 1 MISMATCH, 2 UNMEASURED.
On an arm64 Mac the commit also carries a prebuilt chip at .thetacog/pmu/target/release/pmu-onchip, and the door
finds it without PMU_BINARY. On any other machine build pmu-rust as above; if the chip cannot run, the door prints
UNMEASURED and says why. It never re-runs on node and calls that a match.

THE LINE WE GOT, 2026-09-29, from a fresh clone with HOME pointed at an empty directory (so no chip outside the
checkout could be picked up), exit 0:

RECOMPUTE · receipt 9d739ec11c@c691ab7a55de806c · commit 9d739ec11ca2be0ea706734b188b0ef1df7e1f9d · expected ω c67ed60157f17f646ce5e15fd9008620cc49537bef74f5ec7ab910bafe215e33 · recomputed ω c67ed60157f17f646ce5e15fd9008620cc49537bef74f5ec7ab910bafe215e33 · match · rust-aperture · darwin-arm64 25.6.0 · node v20.20.0 · 2026-09-29T03:51:00.954Z

The same receipt with one reality row's used_bytes raised by one printed MISMATCH on the tuple leg and the cut leg.

HOW IT WAS CUT, inside the checkout at that commit, with the chip built from its own pmu-rust/:

  PMU_BINARY=$PWD/pmu-rust/target/release/pmu-onchip node scripts/vna/cockpit.mjs --commit 9d739ec11ca2be0ea706734b188b0ef1df7e1f9d --no-open
  PMU_BINARY=$PWD/pmu-rust/target/release/pmu-onchip node scripts/vna/aperture-receipt.mjs

WHAT A MATCH IS SUFFICIENT FOR: the bytes the chip was fed came from that commit under that aperture, re-derived on
your machine. WHAT IT IS NOT SUFFICIENT FOR: whether the walk was right (undecidable, Rice), and on this commit, any
placement at all. Read the receipt's own fields before quoting it:

  - intent is the commit message (69 bytes). The repository declares no spec, so the cockpit falls back to the message
    and the receipt names no spec basins (intent.basins.labels is null; the spec leg is skipped, and the line says so
    in --json).
  - admissible is false: after matching, intent gzip 89 bytes is under the 220 floor. The walk is too thin to read, and
    the receipt says so in its own "reason" field. This receipt proves the recompute path. It is not a drift reading.
  - the commit is a root commit (the public mirror is one commit), and the cockpit's binary exclusion reads
    `git diff-tree --numstat`, which prints nothing for a root commit without --root. So binary files (a png, a sqlite
    db, the prebuilt pmu-onchip) sit among the 20 reality rows as 200-byte windows. The recompute reproduces that cut
    exactly; the cut itself is a defect in cockpit.mjs's root-commit handling, named here, not fixed by this receipt.

WHERE YOUR LINE GOES: docs/receipts/README.md step 4.
