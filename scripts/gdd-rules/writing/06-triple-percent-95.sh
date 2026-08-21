#!/usr/bin/env bash
# Rule: latest ghost-read sidecar for the file has every monologue line at
# pred ≥ 95, impact ≥ 95, conf ≥ 95. This is the LLM-dependent rule — it
# only meaningfully fires when ghost-read has run successfully (gemini auth
# working OR claude lane available).
#
# Behavior:
#   · If no sidecar exists for any commit touching this file → fail (the
#     wrapper's writing-mode fix-dispatch will fire ghost-read).
#   · If sidecar exists but RESULT=ERROR (gemini/claude both failed) → fail
#     with a diagnostic naming the auth gap.
#   · If sidecar has friction_paragraphs with pred|impact|conf < 95 → fail
#     and surface the worst paragraph indices for triage.
#   · If all monologue lines ≥ 95 OR friction_paragraphs is empty → pass.
FILE="$1"

# Find the most recent sidecar for this file. The naming pattern is
# docs/reports/ghost-read/<sha9>-<slug>-<llm>.sidecar.json
slug=$(basename "$FILE" | sed -E 's/\.(mdx|md)$//; s|[^a-z0-9]+|-|g')

# Look for any sidecar whose filename contains the file's slug
sidecar=$(ls -t docs/reports/ghost-read/*"$slug"*-gemini.sidecar.json 2>/dev/null | head -1)
[ -z "$sidecar" ] && sidecar=$(ls -t docs/reports/ghost-read/*"$slug"*-claude.sidecar.json 2>/dev/null | head -1)

if [ -z "$sidecar" ]; then
  echo "no ghost-read sidecar found for $FILE (slug=$slug) — fire ghost-read first" >&2
  exit 1
fi

# Parse with node (jq is not guaranteed; node is in PATH)
node -e "
const fs = require('fs');
let d;
try { d = JSON.parse(fs.readFileSync('$sidecar','utf8')); }
catch(e) { console.error('sidecar parse error: ' + e.message); process.exit(1); }

if (d.result === 'ERROR') {
  console.error('sidecar RESULT=ERROR — ghost-read failed (likely gemini auth)');
  console.error('  sidecar: $sidecar');
  process.exit(1);
}

// Convergence criterion (per /goal refinement):
//   · AVG ≥ 95 across all content paragraphs (pred, impact, conf)
//   · ≥ 80% of content paragraphs pass-with-tolerance (each cell ≥ 94)
//   · 94 counts as 95 within ±1 tolerance (diminishing-returns acknowledgment)
// Env overrides: GDD_AVG_FLOOR (def 95), GDD_PASS_PCT_FLOOR (def 80),
//                GDD_TOLERANCE (def 1)
const AVG_FLOOR = parseFloat(process.env.GDD_AVG_FLOOR || '95');
const PASS_PCT_FLOOR = parseFloat(process.env.GDD_PASS_PCT_FLOOR || '80');
const TOLERANCE = parseFloat(process.env.GDD_TOLERANCE || '1');
const PASS_THRESHOLD = 95 - TOLERANCE;  // each cell ≥ 94 with tol=1

const personas = d.personas || [];
let allCells = [];   // every (pred, impact, conf) triple across content paragraphs
let perPara = [];    // { idx, pred, impact, conf, passes }
for (const p of personas) {
  for (const l of (p.monologue_lines || [])) {
    const pr = l.pred ?? null, im = l.impact ?? null, co = l.conf ?? null;
    if (pr === null || im === null || co === null) continue;
    const t = (l.to95 || '').toLowerCase();
    if (t.startsWith('n/a') || t.includes('structural') || t.includes('navigation')) continue;
    const passesTol = (pr >= PASS_THRESHOLD && im >= PASS_THRESHOLD && co >= PASS_THRESHOLD);
    perPara.push({ idx: l.idx, pred: pr, impact: im, conf: co, passes: passesTol, reaction: (l.reaction||'').slice(0,120) });
    allCells.push(pr, im, co);
  }
}

if (perPara.length === 0) {
  console.error('triple-% 95: no content paragraphs scored (sidecar may be empty)');
  process.exit(1);
}

const avg = allCells.reduce((a,b)=>a+b, 0) / allCells.length;
const passCount = perPara.filter(p => p.passes).length;
const passPct = (passCount / perPara.length) * 100;

const passes = (avg >= AVG_FLOOR) && (passPct >= PASS_PCT_FLOOR);

console.error('triple-% 95 stats: avg=' + avg.toFixed(1) + ' (need ≥' + AVG_FLOOR + '), pass=' + passCount + '/' + perPara.length + ' (' + passPct.toFixed(0) + '%, need ≥' + PASS_PCT_FLOOR + '%), tolerance=±' + TOLERANCE);

if (passes) {
  console.error('  ✓ converged: AVG ' + avg.toFixed(1) + ' ≥ ' + AVG_FLOOR + ' AND ' + passPct.toFixed(0) + '% ≥ ' + PASS_PCT_FLOOR + '%');
  process.exit(0);
}

const below = perPara.filter(p => !p.passes).sort((a,b) => (a.pred+a.impact+a.conf) - (b.pred+b.impact+b.conf));
console.error('  ✗ ' + below.length + ' content paragraph(s) below ' + PASS_THRESHOLD + ' (worst first):');
for (const b of below.slice(0, 5)) {
  console.error('    ¶' + b.idx + ' pred=' + b.pred + ' imp=' + b.impact + ' conf=' + b.conf);
  console.error('      ' + b.reaction.replace(/\n/g,' '));
}
if (below.length > 5) console.error('    ... +' + (below.length-5) + ' more');
process.exit(1);
"
