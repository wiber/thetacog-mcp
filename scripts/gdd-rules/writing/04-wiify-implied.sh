#!/usr/bin/env bash
# Rule: WIIFY implied throughout — each labeled section (A-J) contains ≥3
# reader-second-person markers: "for you[r X]", "what this means", "your
# engineer/CFO/CISO/CTO/actuary/IC/Ops/underwriter/auditor/counsel", "take
# to your meeting".
#
# Heuristic catches sections that forgot the reader; not a replacement for
# ghost-read's semantic check, but it surfaces structural WIIFY gaps as a
# fast file-grep-able signal.
#
# Implementation uses node (instead of awk) because macOS ships BSD awk
# which lacks 3-arg match()/regex support gnu awk has.
FILE="$1"

# Only enforce on full-structured blog posts (labeled A-J letter pattern)
if ! grep -qE 'text-(red|purple|blue|green|orange|pink|cyan|yellow|indigo|emerald)-500' "$FILE"; then
  exit 0
fi

node -e "
const fs = require('fs');
const src = fs.readFileSync('$FILE','utf8').split('\n');
const sectionRe = /text-(red|purple|blue|green|orange|pink|cyan|yellow|indigo|emerald)-500.*>([A-J])</;
const markerRe = /for you|your CFO|your CISO|your CTO|your actuary|your IC|your Ops|your engineer|your underwriter|your auditor|your counsel|what this means|you can sign|you can ship|you can defend|you can file|you can claim|you can price|you can attest|take to your meeting/i;
let curSec = null;
let counts = {};
for (const line of src) {
  const m = line.match(sectionRe);
  if (m) { curSec = m[2]; counts[curSec] = counts[curSec] || 0; continue; }
  if (curSec && markerRe.test(line)) counts[curSec]++;
}
const minMarkers = 3;
const fails = Object.entries(counts).filter(([s,n]) => n < minMarkers);
if (fails.length === 0) process.exit(0);
for (const [s,n] of fails) {
  console.error('section §' + s + ': ' + n + ' WIIFY marker(s) (need ≥' + minMarkers + ' — \"for your X\", \"what this means\", \"take to your meeting\")');
}
process.exit(1);
"
