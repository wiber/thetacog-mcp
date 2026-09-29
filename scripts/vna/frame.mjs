#!/usr/bin/env node
// scripts/vna/frame.mjs — ONE FRAME OF THE LATTICE, computed in ONE place.
//
// Both the cockpit (pixels) and the story (prose) must read the SAME frame. Two computations of
// "the current frame" would let the picture and the sentence describing it disagree, which is the
// one failure an instrument cannot survive — and ONE RULE LIVES IN ONE PLACE exists for exactly
// this. This module is that place.
//
// It reinvents nothing: runPipeline for the commit-scoped corpora, definerWalk144 for the REAL
// recursive on-chip ballistic walk (never the analytic shortcut), and decodeDeltaThreeColourEdges
// for the canonical Δ decode — whose `pattern.region` is the shape vocabulary the story narrates.
//
// LLM-FREE. Every field here is a pure function of the commit.
import { execSync } from 'node:child_process';
import { runPipeline } from '../pmu/pipeline.mjs';
import { definerWalk144 } from '../pmu/definer-walk-144.mjs';
import { decodeDeltaThreeColourEdges } from '../pmu/triptych-render.mjs';

const CELLS = 144 * 144;

// walk.*_heatmap_b64 is a near-flat PLATEAU (0.04% relative spread) — a LIT-SET, not a heat field.
// Banding it collapses significantEdges and refuses every panel. The grids come from the xor stage
// and the heat comes from the walk. Measured 2026-09-07; do not "simplify" this back.
function unpackGrid(b64) {
  const b = Buffer.from(b64, 'base64');
  const bits = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) bits[i] = (b[i >> 3] >> (7 - (i & 7))) & 1;
  return bits;
}

export async function computeFrame({ sha = 'HEAD', repo = process.cwd(), killTolerancePct = 15 } = {}) {
  const g = (c) => execSync(c, { cwd: repo, maxBuffer: 1 << 26 }).toString();
  const full = g(`git rev-parse ${sha}`).trim();
  const short = full.slice(0, 9);
  const msg = g(`git log -1 --pretty=%B ${full}`);
  const files = g(`git show --name-only --pretty=format: ${full}`).split('\n').filter(Boolean);
  let reality = '';
  for (const f of files.slice(0, 20)) { try { reality += g(`git show ${full}:${f}`).slice(0, 4000) + '\n'; } catch { /* deleted */ } }

  const t0 = Date.now();
  const r = await runPipeline({ intentText: msg, realityText: reality, intentLabel: `commit ${short}`, realityLabel: 'changed files' });
  const x = r.stages?.xor || {}, w = r.stages?.walk || {};
  let im = null, rm = null, walkMeta = null;
  if (x.intent_bitmap_b64 && x.reality_bitmap_b64) {
    const starts = (x.intent_lit_indices || []).slice(0, 2).map(Number);
    const run = async (bits) => {
      const o = await definerWalk144(starts.length ? starts : [0], { gridBits: bits })   // knobs: THE ONE HOME (walk-knobs.mjs); the 2500 ms wall valve is gone;
      return { matrix: Float64Array.from(o.matrix), hops: o.hops, maxPly: o.maxPly, truncated: !!o.timeBudgetTripped };
    };
    const [iw, rw] = await Promise.all([run(unpackGrid(x.intent_bitmap_b64)), run(unpackGrid(x.reality_bitmap_b64))]);
    im = iw.matrix; rm = rw.matrix;
    walkMeta = { hops: iw.hops + rw.hops, maxPly: Math.max(iw.maxPly, rw.maxPly), truncated: iw.truncated || rw.truncated };
  }

  const tol = (im && rm) ? decodeDeltaThreeColourEdges(im, rm, killTolerancePct) : null;
  return {
    sha: short, shaFull: full, subject: msg.split('\n')[0], files, ms: Date.now() - t0,
    intentMatrix: im, realityMatrix: rm, tol, walkMeta,
    pattern: tol && !tol.refused ? tol.pattern : null,
    refused: !tol || !!tol.refused,
    refusal: tol?.refusal || (im && rm ? null : 'no grids from the xor stage'),
    agreementPct: w.agreement_pct ?? null, divergencePct: w.divergence_pct ?? null,
    witness: { intentAgree: r.stages?.sense?.intent_witness_agree ?? null,
               realityAgree: r.stages?.sense?.reality_witness_agree ?? null,
               primary: r.stages?.sense?.primary_witness ?? null, secondary: r.stages?.sense?.secondary_witness ?? null },
  };
}
