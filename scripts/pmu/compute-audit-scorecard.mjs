#!/usr/bin/env node
// scripts/pmu/compute-audit-scorecard.mjs — the ACTUAL-vs-IDEAL selection scorecard (R6/R8), computed
// with gzip-NCD (the canonical LLM-FREE sensor), frozen onto the tape.
//
// WHY gzip-NCD and not string overlap: the reef's ACTUAL rules (repo constraints) and qwen's IDEAL
// rules (an independent prediction) are DIFFERENT TEXT — an exact-match overlap would always read 0 and
// tell the auditor nothing. gzip-NCD (Li–Vitányi 2004) measures SEMANTIC distance between two strings
// with no model in the loop — the same sensor the placement uses. So "how close did the reef's pick get
// to the ideal?" is answered by the compression distance, deterministically and re-runnably.
//
// It reads actual_rules (on-chip, sealed) from metrics.walk.rule_hat_compare and ideal rules from the
// held-out st.audit_ideal (baked in R5), and writes st.audit_ideal.scorecard. Scorecard lives in the
// UNSEALED sidecar — it is a comparison annotation, never part of the receipt. Deterministic: same tape
// in → same scorecard out (no qwen, no randomness). Run after bake-ideal-into-tape.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const TAPE = process.argv[2] ? resolve(process.argv[2]) : resolve(REPO, 'docs/pmu/attest-demo-tape.json');
const THRESH = Number(process.env.AUDIT_NCD_THRESH || 0.62);   // NCD below this = "on-target" (semantically near)

const gz = (s) => gzipSync(Buffer.from(String(s || ' '), 'utf8')).length;
const ncd = (x, y) => { if (!x || !y) return 1; const cx = gz(x), cy = gz(y), cxy = gz(x + '\n' + y); const mx = Math.max(cx, cy), mn = Math.min(cx, cy); return mx ? Math.max(0, Math.min(1.2, (cxy - mn) / mx)) : 1; };
const minNcd = (a, list) => (list && list.length) ? Math.min.apply(null, list.map((b) => ncd(a, b))) : 1;

export function scoreActualVsIdeal(actualRules, idealRules, actualHat, idealHat, thresh = THRESH) {
  const A = (actualRules || []).map(String), I = (idealRules || []).map(String);
  const actual_match = A.map((a) => +minNcd(a, I).toFixed(3));           // per actual rule: distance to nearest ideal
  const ideal_covered = I.map((i) => +minNcd(i, A).toFixed(3));          // per ideal rule: distance to nearest actual
  const onTarget = actual_match.filter((d) => d < thresh).length;       // actual rules that land near an ideal
  const idealCovered = ideal_covered.filter((d) => d < thresh).length;  // ideal rules the reef reached
  const shared = Math.min(onTarget, idealCovered);                      // conservative shared count
  const union = A.length + I.length - shared;
  const iou = union > 0 ? +(shared / union).toFixed(3) : 0;
  const overlap_pct = A.length ? Math.round(100 * onTarget / A.length) : 0;
  const coverage_pct = I.length ? Math.round(100 * idealCovered / I.length) : 0;   // the "coverage gap" = 100 - this
  const hat_ncd = (actualHat && idealHat) ? +ncd(actualHat, idealHat).toFixed(3) : null;
  return { sensor: 'gzip-NCD', threshold: thresh, actual_n: A.length, ideal_n: I.length,
    on_target: onTarget, ideal_covered: idealCovered, iou, overlap_pct, coverage_pct, hat_ncd,
    actual_match, ideal_match: ideal_covered };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const tape = JSON.parse(readFileSync(TAPE, 'utf8'));
  let n = 0;
  for (const st of (tape.timeline_events || [])) {
    const c = st.metrics && st.metrics.walk && st.metrics.walk.rule_hat_compare;
    const ai = st.audit_ideal;
    if (!c || !ai) continue;
    const idealRules = (ai.rules && ai.rules.length) ? ai.rules : (c.ideal_rules || []);
    ai.scorecard = scoreActualVsIdeal(c.actual_rules, idealRules, c.actual_hat, ai.hat || c.ideal_hat);
    n++;
    console.log('  ✓ ' + st.id + ' → IoU ' + ai.scorecard.iou + ' · on-target ' + ai.scorecard.on_target + '/' + ai.scorecard.actual_n + ' · coverage ' + ai.scorecard.coverage_pct + '% · hat-NCD ' + ai.scorecard.hat_ncd);
  }
  writeFileSync(TAPE, JSON.stringify(tape, null, 2) + '\n');
  console.log('scored ' + n + ' states (gzip-NCD, LLM-free) into ' + TAPE + ' · seals unchanged (scorecard is in the unsealed sidecar)');
}
