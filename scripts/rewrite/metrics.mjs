// scripts/rewrite/metrics.mjs — THE TWENTY MEASURES, and an honest count of which ones exist yet.
//
// The operator's list (2026-08-12), verbatim in the `label` of each entry below. The rule this module
// follows, and the reason it is a module rather than a dashboard query:
//
//   A METRIC THAT CANNOT BE COMPUTED YET IS REPORTED AS NOT MEASURED, WITH WHAT IT IS WAITING FOR.
//
// Half of this list needs decisions in the ledger that do not exist. The tempting move is to render a
// plausible number from a thin sample and let the strip look complete — which is precisely the failure
// this whole codebase keeps catching in its own panels: a display that cannot tell you whether it is
// showing a measurement or a decoration. So every entry carries `measured`, `n`, and when n is too
// small to mean anything, `provisional: true`. A strip full of "not measured yet" is the true state of
// an instrument that has just been built, and it is more useful than a strip full of noise.
//
// Sources, all local, all already computed elsewhere — nothing here re-derives a measurement:
//   · store.readLedger / winRates      — accept, skip, rescan, direction rows
//   · readability.ledgerReadability    — ease/grade deltas on accepted edits
//   · session candidates               — per-candidate drift, slop, readability, massRatio, growth
//   · models.modelStats                — per-model latency and failure/timeout rate
//   · tesseract panels                 — aperture, in-lane/bleed/drift, σ (live, per card)

const MIN_N = 8;   // below this, a rate is a rumour. Reported, but flagged provisional.

const pct = (a, b) => (b ? +((a / b) * 100).toFixed(1) : null);
const mean = (xs) => (xs.length ? +(xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(3) : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const M = (id, label, extra = {}) => ({
  id, label,
  measured: false, value: null, unit: null, n: 0, provisional: false, waitingOn: null, detail: null,
  ...extra,
});

/**
 * @param {object} src
 * @param {Array}  src.rows        ledger rows (store.readLedger)
 * @param {object} src.winRates    store.winRates()
 * @param {object} src.readability readability.ledgerReadability(rows)
 * @param {Array}  src.candidates  every candidate across open sessions
 * @param {Array}  src.modelStats  models.modelStats()
 * @param {object} [src.panels]    the live panel meta for the current card, if any
 */
export function computeMetrics({ rows = [], winRates = {}, readability = {}, candidates = [], modelStats = [], panels = null } = {}) {
  const accepts = rows.filter((r) => r.kind === 'accept');
  const rescans = rows.filter((r) => r.kind === 'rescan');
  const directions = rows.filter((r) => r.kind === 'direction');
  const graded = accepts.filter((r) => r.monologueGrade);
  const withDrift = candidates.filter((c) => c.drift);

  const out = [];

  // 1 ── expansion ratio: how much longer the machine's sentence is than the one it replaced.
  const growth = candidates.map((c) => c.growth ?? (c.massRatio?.lenRatio)).filter((v) => typeof v === 'number');
  out.push(M('expansion', 'Watermark detour expansion ratio (len ×N)', growth.length
    ? { measured: true, value: mean(growth), unit: '×', n: growth.length, provisional: growth.length < MIN_N,
        detail: 'generated length ÷ flagged length, across every candidate generated this session' }
    : { waitingOn: 'candidates in an open session' }));

  // 2 ── information density against lattice footprint.
  const massPerCell = candidates.map((c) => (typeof c.massRatio === 'number' ? c.massRatio : c.massRatio?.perCell)).filter((v) => typeof v === 'number');
  out.push(M('massDensity', 'Mass density per active cell (mass / cell)', massPerCell.length
    ? { measured: true, value: mean(massPerCell), unit: 'B/cell', n: massPerCell.length, provisional: massPerCell.length < MIN_N,
        detail: 'gzip mass ÷ cells the passage occupies on the 144×144 lattice' }
    : { waitingOn: 'candidates in an open session' }));

  // 3 ── deterministic slop rules tripped before a human looked.
  // the candidate's slop reading is {before, after, delta}; `after.hits` is what the rules caught in
  // the generated sentence — the number that says how often a machine writes slop unprompted.
  const slopAfter = candidates.map((c) => c.slop?.after).filter(Boolean);
  const tripped = slopAfter.filter((a) => (a.hits?.length || 0) > 0);
  out.push(M('slopTrigger', 'Deterministic slop pattern trigger rate', slopAfter.length
    ? { measured: true, value: pct(tripped.length, slopAfter.length), unit: '% of candidates', n: slopAfter.length,
        provisional: slopAfter.length < MIN_N,
        detail: `mean density ${mean(slopAfter.map((a) => a.density ?? 0))}% · commonest: ${(() => {
          const k = {}; for (const a of tripped) for (const h of a.hits || []) k[h.kind] = (k[h.kind] || 0) + 1;
          return Object.entries(k).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n2, c2]) => `${n2}×${c2}`).join(' ') || 'none';
        })()}` }
    : { waitingOn: 'candidates in an open session' }));

  // 4 ── readability delta on what was actually committed.
  // Prefer the committed edits — that is the real signal. With an empty ledger, fall back to what the
  // candidates PROPOSE, clearly labelled: proposed ease is not accepted ease, and conflating them would
  // let the strip claim the tool improves prose before anyone has chosen anything.
  const candEase = candidates.map((c) => {
    const b = c.readability?.before, a = c.readability?.after;
    return (b && a && b.fleschReadingEase != null && a.fleschReadingEase != null) ? a.fleschReadingEase - b.fleschReadingEase : null;
  }).filter((v) => typeof v === 'number');
  out.push(M('easeGrade', 'Flesch-Kincaid / entropy balance (ease & grade)', readability?.n
    ? { measured: true, value: readability.avgEaseDelta, unit: 'Δ ease (committed)', n: readability.n, provisional: readability.n < MIN_N,
        detail: `grade Δ ${readability.avgGradeDelta} · ${readability.improvedPct}% of accepted edits read easier` }
    : candEase.length
      ? { measured: true, value: mean(candEase), unit: 'Δ ease (proposed, not accepted)', n: candEase.length, provisional: true,
          detail: 'no commits yet — this is what candidates OFFER, not what the writer chose' }
      : { waitingOn: 'accepted edits that are not the original' }));

  // 5 ── the σ the Rust walk puts between intent and the candidate.
  out.push(M('sigmaDisplacement', 'Rust geometric variance (σ displacement)', panels?.matchSigma != null
    ? { measured: true, value: panels.matchSigma, unit: 'σ', n: 1, provisional: true,
        detail: `live card only — ${panels.walkMode}, aperture ${panels.aperture?.actor}→${panels.aperture?.patient}` }
    : { waitingOn: 'a card with the tesseract panel computed' }));

  // 6 ── which cells an edit switches on, gives up, or keeps.
  const cellMoves = candidates.filter((c) => c.cells != null);
  out.push(M('latticeTransitions', 'Lattice state transitions (lit / dark / held)', cellMoves.length
    ? { measured: true, value: mean(cellMoves.map((c) => (typeof c.cells === 'number' ? c.cells : c.cells?.lit ?? 0))), unit: 'cells', n: cellMoves.length,
        provisional: cellMoves.length < MIN_N, detail: 'mean cells a candidate occupies; per-card lit/dark/held is on the card itself' }
    : { waitingOn: 'candidates in an open session' }));

  // 7 ── how much of the trajectory leaves the declared tolerance.
  out.push(M('bleedRate', 'Encircled tolerance bleed rate (off-lane %, bleed)', withDrift.length
    ? { measured: true, value: mean(withDrift.map((c) => c.drift.driftPct ?? 0)), unit: '% off-lane', n: withDrift.length,
        provisional: withDrift.length < MIN_N, detail: `mean weighted bleed ${mean(withDrift.map((c) => c.drift.weightedBleed ?? 0))}` }
    : { waitingOn: 'candidates with a drift reading' }));

  // 8 ── the only direct test of the product claim: did comprehension actually go up?
  const deltas = rescans.map((r) => r.delta).filter((v) => typeof v === 'number');
  out.push(M('rescanDelta', 'Cold reader re-scan delta', deltas.length
    ? { measured: true, value: mean(deltas), unit: 'points', n: deltas.length, provisional: deltas.length < MIN_N,
        detail: `${pct(deltas.filter((d) => d > 0).length, deltas.length)}% of commits raised the score on re-read` }
    : { waitingOn: 'commits followed by a re-scan' }));

  // 9 ── was the reader's diagnosis right? Human-graded.
  out.push(M('monologueFidelity', 'Monologue fidelity validation rate (r / p / w)', graded.length
    ? { measured: true, value: pct(graded.filter((r) => r.monologueGrade === 'right').length, graded.length), unit: '% right', n: graded.length,
        provisional: graded.length < MIN_N,
        detail: `right ${graded.filter((r) => r.monologueGrade === 'right').length} · partly ${graded.filter((r) => r.monologueGrade === 'partly').length} · wrong ${graded.filter((r) => r.monologueGrade === 'wrong').length}` }
    : { waitingOn: 'graded monologues at commit time' }));

  // 10 ── THE HEADLINE. Fenced vs unfenced preference.
  const t = winRates.tracks || {};
  const fenced = ['B', 'D'].reduce((s, k) => s + (t[k]?.won || 0), 0);
  const fencedOffered = ['B', 'D'].reduce((s, k) => s + (t[k]?.offered || 0), 0);
  const raw = ['A', 'C'].reduce((s, k) => s + (t[k]?.won || 0), 0);
  const rawOffered = ['A', 'C'].reduce((s, k) => s + (t[k]?.offered || 0), 0);
  out.push(M('fenceEfficacy', 'Fence efficacy ratio (guided vs raw win rate)', (fencedOffered && rawOffered)
    ? { measured: true, value: pct(fenced, fencedOffered), unit: '% fenced win rate', n: fencedOffered + rawOffered,
        provisional: (fenced + raw) < MIN_N, detail: `fenced ${fenced}/${fencedOffered} vs raw ${raw}/${rawOffered} — THE study question` }
    : { waitingOn: 'decisions with both fenced and unfenced tracks offered' }));

  // 11 ── unwatermarked local vs presumed-watermarked cloud.
  const localWon = ['A', 'B'].reduce((s, k) => s + (t[k]?.won || 0), 0);
  const cloudWon = ['C', 'D'].reduce((s, k) => s + (t[k]?.won || 0), 0);
  out.push(M('enginePreference', 'Cross-engine class preference (local vs cloud)', (localWon + cloudWon)
    ? { measured: true, value: pct(localWon, localWon + cloudWon), unit: '% local', n: localWon + cloudWon,
        provisional: (localWon + cloudWon) < MIN_N, detail: `local ${localWon} · cloud ${cloudWon}` }
    : { waitingOn: 'accepted machine candidates' }));

  // 12 ── does the fence pay off more on technical prose than narrative?
  out.push(M('precisionStrata', 'Precision-strata variance (technical vs narrative tax)', {
    waitingOn: 'a stratum label per card — nothing tags passages technical vs narrative yet (v8 intent #9)' }));

  // 13 ── how often every machine option is rejected.
  out.push(M('manualOverride', 'Manual override rate (commits as MANUAL)', winRates.totalDecisions
    ? { measured: true, value: pct(winRates.manual || 0, winRates.totalDecisions), unit: '% of decisions', n: winRates.totalDecisions,
        provisional: winRates.totalDecisions < MIN_N, detail: `${winRates.manual || 0} of ${winRates.totalDecisions} typed by hand` }
    : { waitingOn: 'decisions in the ledger' }));

  // 14 ── how often the human's own sentence beats everything offered.
  out.push(M('originalKept', 'Original retention baseline (ORIG keep-rate)', winRates.totalDecisions
    ? { measured: true, value: pct(winRates.keptOriginal || 0, winRates.totalDecisions), unit: '% kept', n: winRates.totalDecisions,
        provisional: winRates.totalDecisions < MIN_N, detail: `${winRates.keptOriginal || 0} of ${winRates.totalDecisions} — machines failed to beat the draft` }
    : { waitingOn: 'decisions in the ledger' }));

  // 15 ── cards that needed the human to redirect the prompt.
  out.push(M('directionRate', 'Direction intervention rate', (directions.length || accepts.length)
    ? { measured: true, value: pct(directions.length, directions.length + accepts.length), unit: '% of cards', n: directions.length + accepts.length,
        provisional: (directions.length + accepts.length) < MIN_N, detail: `${directions.length} redirections — structural flaws, not prose defects` }
    : { waitingOn: 'cards resolved either way' }));

  // 16 ── the one today's bug fed. Per-model latency and failure.
  out.push(M('subagentReliability', 'Subagent timeout & failure rate', modelStats.length
    ? { measured: true, value: mean(modelStats.map((m) => m.failRate ?? 0)) * 100, unit: '% calls failed', n: modelStats.reduce((s, m) => s + m.calls, 0),
        provisional: modelStats.reduce((s, m) => s + m.calls, 0) < MIN_N,
        detail: modelStats.map((m) => `${m.id} ${m.calls}× median ${m.medianMs ?? '—'}ms fail ${Math.round((m.failRate ?? 0) * 100)}%`).join(' · ') }
    : { waitingOn: 'model-bar presses this session' }));

  // 17 ── does giving a model more context change what wins?
  out.push(M('contextSensitivity', 'Context scope sensitivity delta', {
    waitingOn: 'the context ticks are recorded per suggestion but not yet per COMMIT — needs `context` on the accept row' }));

  // 18 ── the noise floor: what movement looks like when nothing was meant.
  out.push(M('nullFloor', 'Null control displacement floor (shuffle the lattice)', {
    waitingOn: 'shuffle draws are generated on demand and not yet written to the ledger as control rows' }));

  // 19 ── friction across a long session.
  out.push(M('frictionVelocity', 'Longitudinal document friction velocity', rows.filter((r) => r.kind === 'good-enough').length
    ? { measured: true, value: mean(rows.filter((r) => r.kind === 'good-enough').map((r) => r.score).filter((v) => typeof v === 'number')), unit: 'mean score', n: rows.filter((r) => r.kind === 'good-enough').length,
        provisional: false, detail: 'mean comprehension of paragraphs the reader followed cleanly' }
    : { waitingOn: 'scanned paragraphs' }));

  // 20 ── where taste and the cold reader disagree.
  const paired = rescans.filter((r) => typeof r.delta === 'number' && r.winner);
  out.push(M('preferenceDivergence', 'Preference-comprehension divergence rate', paired.length
    ? { measured: true, value: pct(paired.filter((r) => r.delta <= 0).length, paired.length), unit: '% divergent', n: paired.length,
        provisional: paired.length < MIN_N, detail: 'commits the human preferred that the re-scan did not score higher' }
    : { waitingOn: 'commits with both a winner and a re-scan' }));

  const measured = out.filter((m) => m.measured);
  return {
    metrics: out,
    summary: {
      measured: measured.length,
      total: out.length,
      provisional: measured.filter((m) => m.provisional).length,
      decisions: winRates.totalDecisions || 0,
    },
  };
}
