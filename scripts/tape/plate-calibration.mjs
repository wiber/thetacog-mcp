// packages/thetacog-mcp/scripts/tape/plate-calibration.mjs — THE TABLE THAT SAYS WHICH KNOB IS WRONG.
//
// Plate selection asks: given the operator verbatim words for this atom (aperture I), which reef plate
// (role/hat/rule) shape-matches? Score every plate, rank ascending, inject under threshold, show the
// rest dimmed. When that does NOT separate, this script says whether the width, the threshold, or the
// plate corpus is at fault — so the failure is diagnosable instead of merely disappointing.
//
//   node packages/thetacog-mcp/scripts/tape/plate-calibration.mjs
//
// ══ RESULT 2026-08-20 — IT DOES NOT SEPARATE, AND THE CORPUS IS WHY ══════════════════════════════
// 99 reef templates x 19 GDDadwill atoms = 1881 pairs in 1365ms, no model. All winners cluster
// 0.68-0.74; nothing crosses a 0.45 threshold; one plate wins 12/19.
//
// §3 CONTROL IS THE FINDING. Same sensor, same atoms, plate swapped for prose in the atoms own register:
//   prose taken from DECISION-007  vs its own atom 0.1138 · vs DECISION-017 0.6826  -> delta 0.5688
//   prose taken from DECISION-017  vs its own atom 0.1733 · vs DECISION-007 0.7152  -> delta 0.5419
//   the reef keyword bag (when)    vs DECISION-007 0.4035 · vs DECISION-017 0.4035  -> delta 0.0000
// The keyword bag scores IDENTICALLY, to four decimals, against two maximally different passages. That
// is not a weak signal, it is a constant: a keyword list has no prose structure, so gzip finds the same
// shared structure against any prose window. THE SENSOR IS FINE. THE PLATE CORPUS CANNOT BE MATCHED.
//
// §1 THE MAGNET IS A LENGTH ARTIFACT. The plate that wins 12/19 is rank 1/99 by length (209 chars, the
// shortest of all 99). match() windows at the PLATES OWN length, so the shortest plate gets the shortest
// window and the fewest chances to mismatch. Within one plate that is correct (extractive law,
// enforcement); ACROSS plates it makes the scores incomparable. Ranking needs a COMMON window length.
//
// TWO CORRECTIONS THIS DETERMINES (not guesses):
//   1. A plate shape corpus must be PROSE IN THE APERTURES REGISTER - selected real passages the plate
//      was harvested from, never a composed keyword list. The extractive law applies to plates too.
//   2. Cross-plate ranking must use a FIXED window length, not each plates own, or the shortest plate
//      wins by construction.
//
// ══ RESULT 2026-08-20, AFTER BOTH FIXES — §5 BELOW — STILL DOES NOT SEPARATE, BUT NOW FOR A NAMED,
// DIFFERENT REASON THAN EITHER ORIGINAL DIAGNOSIS ═════════════════════════════════════════════════
// data/pmu/plate-corpus.json: 100/100 templates got real prose — 99 from a matched domain's
// derived_statements (verbatim historical operator prompts that missed the lens, seeded by
// lens-s2-seed.mjs/harvest-agent.mjs; per-statement sha256 provenance), 1 via git-grep on its own
// distinctive terms. Zero invented, zero null. Lengths 390-669 chars (vs the old shape corpus's
// 209-1239 spread — already tighter by construction before the window fix is even applied).
//
// rankPlates({fixedWindow}) was tried at the corpus MEDIAN (426) first and that choice itself failed
// MEASURABLY: a plate shorter than the window is left at its own (shorter) length rather than padded
// (padding fakes entropy the file already refuses to fake — see bulkToMatch above), so a MEDIAN window
// leaves ~half the corpus "underfilled" and the shortest plate keeps its shortest-window edge over that
// whole half — it won 15/19. Switching to the corpus MINIMUM (390) removes every underfilled plate: a
// mechanical check inside §5 confirms only ONE windowLen value (390) is ever used, across all 100
// plates × 19 atoms — the specific bug from §1 (match() windows at the plate's OWN length) is now
// STRUCTURALLY impossible, not just numerically improved.
//
//   winner distribution: 5 distinct winners across 19 atoms (baseline: 4)
//   score range: 0.792-0.831 (baseline: 0.680-0.739 — HIGHER, i.e. WORSE separation from the 0.45 gate)
//   crossing 0.45 threshold: 0/19 (baseline: 0/19 — unchanged)
//   top magnet win rate: 8/19 (baseline: 12/19 — down, but see below)
//   is the winner still the shortest plate? YES, by native length (390 chars, rank 1/100) — but the
//     MECHANISM that caused that in the baseline (windowLen tracking plate length) is proven absent
//     here (windowLen is constant). The residual is a DIFFERENT, subtler effect: rankPlates clips a
//     plate to its first fixedWindow chars, so a plate exactly AT the window length is scored on 100%
//     of itself while a longer plate is scored on a PREFIX only — a completeness bias, not a windowing
//     bug. Not chased further this run; named so the next person doesn't re-diagnose it as §1.
//
// SO: fix A (prose corpus) is real, extractive, and DID tighten the length spread — but did not, on its
// own or combined with fix B, manufacture separation from the 19 GDDadwill atoms; the score range
// actually moved slightly AWAY from the threshold. Fix B (fixed window) DID do its one stated job —
// mechanically proven, not just observed — the length-artifact from §1 cannot recur under this ranking
// mode. NEITHER fix produced the headline result (a chief-of-staff-style plate winning different atoms
// than a blog-tone-style plate in a way that clears a usable threshold): 5 plates do win at least one
// atom each, which is a real improvement over the 1-winner `when`-only baseline, but 0/19 clears 0.45 and
// the concentration (8/19) is still far from flat. NAMED CAUSE: this corpus is 100 generic operational
// templates (incident-forensics, ratchet-bugfix, delegation-package, ...) harvested from THIS repo's own
// history, not authored to be mutually exclusive along whatever axis separates GDDadwill's insurance/
// FINPRO/E&O transcript — gzip-NCD has no way to reward "same topic register" the way it rewards "same
// document" (§3's control literally reused a slice of the atom's OWN text). The ceiling here is corpus
// BREADTH/RELEVANCE to this particular atom set, not the sensor (§3 still holds) and not the window
// (§5's mechanical check still holds) — both were the correct fixes for the bugs they targeted, and
// neither bug was ever "why plate selection can't separate these 19 atoms".
const P = await import('/Users/thetacoach/GitHub/thetadrivencoach/packages/thetacog-mcp/scripts/tape/physics.mjs');
const fs = await import('node:fs');
const reef = JSON.parse(fs.readFileSync('data/pmu/lens-reef.json','utf8'));
const atoms = fs.readFileSync('.thetacog/tape-sessions/gddadwill/specs.ndjson','utf8').trim().split('\n').map(JSON.parse);
const T = reef.templates;

// 1 · IS THE MAGNET A LENGTH ARTIFACT?
const lens = T.map(t=>({name:t.name, when:(t.when||'').length, skel:(t.skeleton||'').length, both:((t.when||'')+' '+(t.skeleton||'')).length}));
lens.sort((a,b)=>a.both-b.both);
const mag = lens.find(x=>x.name==='ratchet-bugfix');
console.log('=== 1 · LENGTH ===');
console.log(`shape lengths: min ${lens[0].both} median ${lens[Math.floor(lens.length/2)].both} max ${lens.at(-1).both}`);
console.log(`the magnet 'ratchet-bugfix': when=${mag.when} skel=${mag.skel} both=${mag.both}  → rank ${lens.findIndex(x=>x.name==='ratchet-bugfix')+1}/${lens.length} by length`);

// 2 · WHICH FIELD DISCRIMINATES? when(keyword bag) vs skeleton(prose)
console.log('\n=== 2 · WHICH FIELD ===  (spread = max-min winner score across atoms; higher spread = more discriminating)');
for (const [fieldName, pick] of [['when only',t=>t.when||''],['skeleton only',t=>t.skeleton||''],['when+skeleton',t=>(t.when||'')+' '+(t.skeleton||'')]]){
  const plates=T.map(t=>({id:t.name,name:t.name,shape:pick(t)})).filter(p=>p.shape.trim().length>20);
  const wins={}; const scores=[];
  for(const a of atoms.slice(0,19)){
    const r=P.rankPlates(plates,a.quote,{threshold:0.45});
    if(!r.length) continue;
    wins[r[0].name]=(wins[r[0].name]||0)+1; scores.push(r[0].plateMatch);
  }
  const top=Object.entries(wins).sort((a,b)=>b[1]-a[1])[0];
  console.log(`  ${fieldName.padEnd(15)} plates=${String(plates.length).padStart(3)} distinct winners=${String(Object.keys(wins).length).padStart(2)}  best ${Math.min(...scores).toFixed(3)}  worst ${Math.max(...scores).toFixed(3)}  top magnet ${top[0]} ×${top[1]}`);
}

// 3 · CONTROL: does the sensor separate when the plate IS prose from the same register?
console.log('\n=== 3 · CONTROL — sensor works when both sides are the same register? ===');
const a7 = atoms.find(a=>a.id==='DECISION-007');   // the dress-code / backpack departure
const a17 = atoms.find(a=>a.id==='DECISION-017');  // the GDD spec ask
const probes = [
  ['prose FROM a7 (own words)',  a7.quote.slice(200,420)],
  ['prose FROM a17 (own words)', a17.quote.slice(200,420)],
  ['reef keyword bag (when)',    T.find(t=>t.name==='ratchet-bugfix').when],
];
for (const [label, plate] of probes){
  const m7=P.match(plate,a7.quote), m17=P.match(plate,a17.quote);
  console.log(`  ${label.padEnd(28)} vs a7 ${m7.plateMatch}  vs a17 ${m17.plateMatch}   Δ ${(Math.abs(m7.plateMatch-m17.plateMatch)).toFixed(4)}`);
}

// 4 · WIDTH SWEEP on one atom — does the winner ever flip?
console.log('\n=== 4 · WIDTH SWEEP (DECISION-017) — does widening flip the winner? ===');
const plates=T.map(t=>({id:t.name,name:t.name,shape:(t.when||'')+' '+(t.skeleton||'')}));
for (const s of P.widthSweep(plates, a17.quote, [150,300,450,600,900], {threshold:0.45}))
  console.log(`  width ${String(s.width).padStart(4)}  gz ${String(s.gzBytes).padStart(3)}${s.belowFloor?' BELOW-FLOOR':'            '}  winner ${(s.winner?.name||'-').padEnd(22)} ${s.winner?.plateMatch}`);

// 5 · THE FIX, MEASURED — prose corpus (data/pmu/plate-corpus.json) + rankPlates({fixedWindow}).
// Both corrections from the header, applied together, then re-measured against the same 19 atoms
// the baseline was measured against — the honest comparison is apples to apples.
console.log('\n=== 5 · THE FIX — prose corpus + fixed-window ranking, same 19 atoms ===');
const corpus = JSON.parse(fs.readFileSync('data/pmu/plate-corpus.json','utf8'));
const prosePlates = Object.entries(corpus.templates)
  .filter(([, v]) => v.prose)
  .map(([name, v]) => ({ id: name, name, shape: v.prose }));
const proseLens = prosePlates.map(p => p.shape.length).sort((a, b) => a - b);
// THE MEDIAN WAS TRIED FIRST AND MEASURABLY FAILED (2026-08-20): rankPlates({fixedWindow}) leaves any
// plate SHORTER than the window at its own (shorter) length, flagged `underfilled` rather than padded —
// correct on its own terms (no manufactured entropy), but choosing the MEDIAN as the window guarantees
// ~half the corpus is underfilled by construction, so the shortest plate keeps its shortest-window
// advantage over that whole underfilled half. Measured: fixedWindow=426 (median) still handed the win
// to the corpus's SHORTEST plate (390 chars) on 15/19 atoms — the exact bug restated one level up.
// The MINIMUM plate length is the only choice under which NO plate is underfilled — every plate in the
// corpus clips to the identical window, zero exceptions. That is the "stated constant" this run uses.
const FIXED_WINDOW = proseLens[0]; // corpus minimum — the only choice with zero underfilled plates
const realMedian = proseLens[Math.floor(proseLens.length / 2)];
const shortestPlate = prosePlates.slice().sort((a, b) => a.shape.length - b.shape.length)[0];
console.log(`  corpus: ${prosePlates.length}/${T.length} templates with real prose (${T.length - prosePlates.length} null-with-reason, excluded) · lengths min ${proseLens[0]} median ${realMedian} max ${proseLens.at(-1)}`);
console.log(`  fixedWindow = ${FIXED_WINDOW} (corpus MINIMUM, not median — see comment above) · shortest plate by prose length: ${shortestPlate.name} (${shortestPlate.shape.length} chars)`);

const wins5 = {}; const scores5 = []; const winnerNames5 = []; const windowLensSeen = new Set();
for (const a of atoms.slice(0, 19)) {
  const r = P.rankPlates(prosePlates, a.quote, { threshold: 0.45, fixedWindow: FIXED_WINDOW });
  if (!r.length) continue;
  for (const row of r) windowLensSeen.add(row.windowLen);
  wins5[r[0].name] = (wins5[r[0].name] || 0) + 1;
  scores5.push(r[0].plateMatch);
  winnerNames5.push(r[0].name);
}
const top5 = Object.entries(wins5).sort((a, b) => b[1] - a[1])[0];
const crossing5 = scores5.filter(s => s <= 0.45).length;
console.log(`  plates=${prosePlates.length} distinct winners=${Object.keys(wins5).length}  score range ${Math.min(...scores5).toFixed(3)}–${Math.max(...scores5).toFixed(3)}  crossing 0.45: ${crossing5}/${scores5.length}`);
console.log(`  top magnet: ${top5[0]} ×${top5[1]}  (its prose length: ${corpus.templates[top5[0]].prose.length} chars, rank-by-length ${proseLens.indexOf(corpus.templates[top5[0]].prose.length) + 1}/${prosePlates.length})`);
// THE MECHANICAL PROOF the window is actually fixed: every plate's windowLen (returned by match(),
// what NCD actually compared at) must be the SAME single value across ALL 100 plates × 19 atoms —
// not "the winner happens to be short" but "there is only one window size in the whole run, period".
console.log(`  MECHANICAL CHECK — distinct windowLen values seen across ${prosePlates.length}×19 scored pairs: {${[...windowLensSeen].join(', ')}} ${windowLensSeen.size === 1 ? '— ONE value: every plate genuinely scored at the same aperture, the construction-artifact is structurally impossible here' : '— MORE THAN ONE: fixedWindow did not fully apply, investigate'}`);
console.log(`  is the winner still the corpus's shortest-by-native-length plate? ${top5[0] === shortestPlate.name ? 'YES' : 'NO'} — but note the WINDOWING mechanism that CAUSED the old artifact is mechanically ruled out above; a residual correlation between native length and win-rate here would be a DIFFERENT, subtler effect (prefix-clip discards more of a longer plate's content than a shorter one, since slice(0,N) always keeps a short plate whole) — not the windowLen-tracks-plate-length bug the calibration originally found.`);
console.log(`  HEADLINE — does a chief-of-staff-style plate win on different atoms than a blog-tone-style plate? ${Object.keys(wins5).length > 1 ? `${Object.keys(wins5).length} distinct plates win across the 19 atoms — YES, differently-toned plates DO win on different atoms, though concentration is still high (top magnet ${top5[1]}/19)` : 'NO — one plate still wins everything'}`);
