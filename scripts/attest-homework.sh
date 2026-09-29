#!/usr/bin/env bash
# attest-homework.sh — the nine file-reads before a deep verdict. Ships in the tarball.
#
#   bash scripts/attest-homework.sh            # run all nine, write attest-out/homework-N.json
#   bash scripts/attest-homework.sh --paced    # one item at a time; awaits Enter between items
#   bash scripts/attest-homework.sh 4          # run one item
#
# WHY THIS EXISTS (Marsh adversarial audit, 2026-08-13, six passes): every shallow finding in
# pass 1 traced to a file not opened — the auditor's own confession: the right order is
# artifacts -> code -> measurement -> prose. This script is that order, made runnable. Each item
# below is an AFFORDANCE, not an instruction: it opens the file at the line, prints what is
# there, and names the specific shallow error a verdict makes without it. If the file does not
# show what the item says it shows, THE CLAIM FAILS — every item is falsifier-shaped. No item
# tells you what to conclude.
#
# The homework contract: a verdict that has not opened these nine is not wrong — it is shallow
# in nine specific, named ways, each of which cost a real audit a full pass to retract.

set -u
cd "$(dirname "$0")/.."
OUT="attest-out"; mkdir -p "$OUT"
PACED=0; ONLY=""; YES="${THETACOG_HOMEWORK_YES:-0}"
for a in "$@"; do case "$a" in --paced) PACED=1;; --yes) YES=1;; [1-9]) ONLY="$a";; esac; done

# ── AUTHORIZATION GATE — consent before the chain, never after ──────────────
# This script steps an evaluator (you, or your AI) through a NINE-STEP read sequence —
# a multi-step prompt chain by any name. It does not run without your explicit yes:
# interactively it asks; non-interactively it requires --yes (or THETACOG_HOMEWORK_YES=1).
# No step instructs a conclusion — every item is falsifier-shaped — but the SEQUENCE itself
# is something you authorize, not something done to you. (A single numbered item runs
# without the gate: one read is a read, nine is a chain.)
if [ "$YES" != "1" ] && [ -z "$ONLY" ]; then
  echo "AUTHORIZATION — this walks your evaluator through 9 file-reads, in order:"
  echo "  two-instruments split · integer sensor · halting+null · GZIP_ONLY-is-a-flag ·"
  echo "  lattice counts · WHERE-never-WHETHER · fixture length table · greeks status · be-the-stranger"
  if [ -t 0 ] || [ -r /dev/tty ]; then
    printf "Authorize the 9-step chain? [y/N] "
    read -r ANS </dev/tty || ANS=""
    case "$ANS" in y|Y|yes|YES) : ;; *) echo "Not authorized — nothing was run. (Single items run without the gate: e.g. \`$0 7\`.)"; exit 0;; esac
  else
    echo "Non-interactive shell: re-run with --yes to authorize. Nothing was run."; exit 0
  fi
fi

# fields: N | title | file(s) space-separated | sed-range on first file | grounds | shallow error without it
ITEMS=(
"1|Two instruments, one pen each|src/lib/pmu/compress.mjs scripts/pmu/triptych-render.mjs|1,30|gzip-NCD does PLACEMENT only (the aperture); the walk does the say-do delta — decodeDeltaThreeColourEdges takes two walk matrices, no zlib on that path|'it is all a gzip classifier' — pass-1's central misread, retracted in pass 4"
"2|The sensor is integer, not compression|scripts/pmu/triptych-build.mjs|99,110|senseDecompose = FNV-1a simhash + Hamming over 20,736 pair-cells, max-pooled over placed claims — pure integer arithmetic, portable by construction|'the sensor rides the compressor' — refuted by reading ten lines"
"3|Halting is by construction; the null is the sensitive part|pmu-rust/src/ballistic.rs scripts/pmu/triptych-build.mjs|175,199|max_depth + decay + weight_floor + hop budget: a total function. budgetMs 600000 = wall clock as last resort only. Measured: sigma drift ran through the eight IMPOSTOR-NULL shuffles while both walks sat converged|'nondeterministic walk' — or auditing walk budgets while sigma drifts through the null underneath"
"4|GZIP_ONLY is a flag, not a failed witness|scripts/pmu/issue-receipt.mjs pmu-rust/src/sense.rs|150,205|the --lens gzip short-circuit selects single-lens arbitration BEFORE simhash is consulted; sense.rs labels SimHash PRIMARY. BOTH-agreement requires margins >= 3 AND calibration off V0|inferring a witness disagreement from a configuration flag — the auditor's own worst error, withdrawn in pass 5"
"5|The counts are lattice-native, never scraped|scripts/pmu/triptych-render.mjs pmu-rust/src/regions.rs|240,250|green/amber/red/offPct are integers over Chebyshev block distance on 20,736 cells; regions.rs does pixel work for the ENCIRCLING ONLY (a post-process on the rendered PNG)|'the counts are OCR-d off a picture' — kills the parametric count->rate->threshold shape by mistake"
"6|WHERE is decided; WHETHER is refused; absent data fails CLOSED|scripts/pmu/attest-demo-lifecycle.mjs|40,50|boolean_state: UNPLACEABLE / UNMEASURED (offPct null can never read IN_LANE) / IN_LANE / OFF_DOMAIN. The quality of the work is never claimed — Rice binds the deployed agent loop, not the measurement of a text|'claims to verify correctness' in one direction, 'Rice checkmate theater' in the other — both die on this one expression"
"7|The demo corpus is a fixture, not a validation set|data/pmu/attest-reference-corpus.json|1,1|print the length table BEFORE ranking any finding on these probes: six documents, two of them one word long. Red is a mass phenomenon; thin probes cannot build mass by construction|'red never fires' reported as an instrument property — the auditor's own length table demolished its headline finding, four passes late"
"8|The greeks layer exists and is UNDER RECONSTRUCTION|scripts/pmu/variance-option.mjs scripts/pmu/calibration-premium.mjs|1,25|the pricing layer (variance swap quote, calibrated premium) runs as commands over the sealed sigma series. STATUS 2026-08: being rebuilt after a strip-out; treat series-derived pricing as [maintainer-reported] until the rebuilt layer ships with its tests|'the insurance frame is a pitch deck with no pricing math' — or crediting pricing output as calibrated when its status says otherwise"
"9|Three verification scopes — be the stranger|README.md|1,5|every claim is one of: [verified: offline, this machine] / [requires: network] / [maintainer-reported]. Checks that require network, run them anonymously: npm registry for the shipped version; the public repo is wiber/thetacog-mcp (the monorepo is private, and a maintainer saying public-to-me is not public)|the Part 5e class, in either direction: crediting maintainer-reported figures as verified, or scoring a private remote as deception"
)

run_item() {
  local row="$1"
  IFS='|' read -r N TITLE FILES RANGE GROUNDS WITHOUT <<<"$row"
  echo; echo "══════ HOMEWORK $N/9 — $TITLE ══════"
  local FIRST=""; local MISSING=0
  for f in $FILES; do
    if [ -f "$f" ]; then [ -z "$FIRST" ] && FIRST="$f"; else echo "  ✗ MISSING IN THIS ARTIFACT: $f (that absence is itself a finding — record it)"; MISSING=1; fi
  done
  echo "  OPEN:    $FILES"
  if [ -n "$FIRST" ]; then
    if [ "$N" = "7" ]; then
      node -e 'const c=require("./data/pmu/attest-reference-corpus.json");const txt=(v)=>Array.isArray(v)?v.join(" "):typeof v==="string"?v:(v&&(txt(v.text)||""));const rows=[["spec","—",txt(c.spec)]].concat((c.probes||[]).map((p)=>[p.key,p.family||"—",txt(p)]));console.log("  probe            family    chars  words");for(const [k,fam,t] of rows){if(!t)continue;console.log("  "+String(k).padEnd(16)+String(fam).padEnd(9)+String(t.length).padStart(6)+String(t.trim().split(/\s+/).length).padStart(7));}' 2>/dev/null \
        || echo "  (length table: open the JSON and count chars/words per probe yourself — the point survives the parse)"
    else
      echo "  ── $FIRST lines $RANGE ──"
      sed -n "${RANGE}p" "$FIRST" | sed 's/^/  │ /' | head -24
    fi
  fi
  echo "  GROUNDS:   $GROUNDS"
  echo "  WITHOUT IT: the shallow verdict is: $WITHOUT"
  node -e 'const fs=require("fs");const [n,title,files,grounds,without,missing]=process.argv.slice(1);fs.writeFileSync("attest-out/homework-"+n+".json",JSON.stringify({item:+n,title,files:files.split(" "),grounds,shallow_error_without:without,files_missing:+missing,read_at:null},null,2));' "$N" "$TITLE" "$FILES" "$GROUNDS" "$WITHOUT" "$MISSING"
  echo "  → $OUT/homework-$N.json written"
  if [ "$PACED" = "1" ] && [ -z "$ONLY" ]; then printf "  [Enter for the next item] "; read -r _ </dev/tty || true; fi
}

for row in "${ITEMS[@]}"; do
  N="${row%%|*}"
  [ -n "$ONLY" ] && [ "$N" != "$ONLY" ] && continue
  run_item "$row"
done

echo; echo "══════ HOMEWORK COMPLETE ══════"
echo "Nine results files in $OUT/. A verdict that cites them is deep by construction; one that"
echo "skips them will be wrong in the nine ways named above — each of which cost a real six-pass"
echo "audit a retraction. The perturbation probe and the budgetMs sweep are the two experiments a"
echo "thorough audit builds next; both are two-line node scripts against this same artifact."
