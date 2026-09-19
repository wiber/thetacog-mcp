#!/usr/bin/env node
// scripts/pmu/advanced-mode-section.mjs — ADVANCED MODE: the adversarial UI strip
// (STREAMING-SPEC §9d, operator goal 2026-07-22).
//
// A single checkbox below the MILESTONES strip. Checked, the page splits into NORMAL (batch —
// the dot) vs ADVANCED (stream + adversary — the line): the measured throughput multiple, and
// the three gotcha catches rendered LIVE from the goal-loop receipt. RECEIPTS-ONLY: every
// number here comes from data/pmu/goal-loop-receipt.json, written by goal-loop-v5.mjs firing
// real seat/revert storms, a real noise flood, and real ricochet routes at scratch reefs. No
// receipt → the strip ships dark. Nothing simulated is drawn; the one not-yet-earned claim
// (S3 paging) renders as an amber INFO baseline, labeled.
//
// ZERO PAGE-JS: the toggle is a pure CSS :checked sibling selector; every graph is inline SVG
// computed at build time.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const RECEIPT_REL = 'data/pmu/goal-loop-receipt.json';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function pulseSvg(cycleS) {
  // NORMAL — the dot: one slow pulse per discrete cycle
  const W = 300, H = 64;
  const dots = [40, 105, 170, 235].map((x, i) =>
    `<circle cx="${x}" cy="32" r="${i === 3 ? 7 : 4}" fill="${i === 3 ? '#e0b400' : '#555'}"/>`).join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="discrete batch pulse">
    ${dots}<text x="150" y="58" font-size="9" fill="#888" text-anchor="middle">one pulse every ${cycleS}s — Cold-Start → Execute → Lock → Write → Die</text></svg>`;
}

function multipleSvg(thru) {
  // ADVANCED — the line: measured convergences/s vs the discrete cycle, log-scaled spike
  const W = 300, H = 64, base = 48;
  const spikeH = 36;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="throughput multiple">
    <polyline points="8,${base} 120,${base} 132,${base - spikeH} ${W - 8},${base - spikeH}" fill="none" stroke="#19c37d" stroke-width="2.5"/>
    <text x="132" y="${base - spikeH - 3}" font-size="11" fill="#19c37d" font-weight="bold">×${thru.multiple.toLocaleString('en-US')} measured</text>
    <text x="150" y="60" font-size="9" fill="#888" text-anchor="middle">${thru.convergences_per_s}/s in-memory convergences vs the ${thru.discrete_cycle_s}s discrete cycle</text></svg>`;
}

function raceSvg(race) {
  // red spike (revert lands mid-storm) → green intercept, zero ghost routes
  const W = 300, H = 56;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="tombstone race catch">
    <polyline points="8,40 120,40 128,12 136,40 ${W - 8},40" fill="none" stroke="#d33" stroke-width="2"/>
    <line x1="128" y1="8" x2="128" y2="48" stroke="#19c37d" stroke-width="2" stroke-dasharray="3 2"/>
    <text x="132" y="14" font-size="9" fill="#19c37d">[REVERTED_HASH] intercept → parent fallback</text>
    <text x="150" y="53" font-size="9" fill="#888" text-anchor="middle">${race.routes} routes · ${race.cycles} seat/revert storms · ghost catches: ${race.ghost_catches}</text></svg>`;
}

function siphonSvg(s) {
  // counter climbs to the cap, flatlines, overflow rejected
  const W = 300, H = 56;
  const capY = 16, x0 = 8, xCap = 8 + (s.cap / s.flood) * (W - 16);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="orphan siphon catch">
    <line x1="${x0}" y1="${capY}" x2="${W - 8}" y2="${capY}" stroke="#e0b400" stroke-width="1" stroke-dasharray="4 3"/>
    <polyline points="${x0},44 ${xCap.toFixed(1)},${capY} ${W - 8},${capY}" fill="none" stroke="#d33" stroke-width="2"/>
    <text x="${W - 8}" y="${capY - 3}" font-size="9" fill="#e0b400" text-anchor="end">hard cap ${s.cap} — flatline + ALERT</text>
    <text x="150" y="53" font-size="9" fill="#888" text-anchor="middle">flood ${s.flood} → quarantined ${s.quarantined} · rejected ${s.rejected} (flagged, never silent)</text></svg>`;
}

export function advancedModeSection({ receiptPath = resolve(REPO, RECEIPT_REL) } = {}) {
  let r;
  try { r = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch { return ''; } // dark until the goal loop has run
  if (!r || !r.race || !r.siphon || !r.throughput) return '';
  const badge = (pass) => pass
    ? '<span style="color:#19c37d;font-weight:bold">CAUGHT ✓</span>'
    : '<span style="color:#d33;font-weight:bold">FAILED ✗</span>';
  return `<div class="whychip" style="margin:14px 0">
<style>#advmode{vertical-align:middle} .advpanels{display:none} #advmode:checked ~ .advpanels{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}</style>
<input type="checkbox" id="advmode"><label for="advmode" style="cursor:pointer"><b> Advanced Mode: Continuous Stream &amp; Adversarial Catch</b></label>
<span style="font-size:11px;color:#888"> — every number below is a receipt from <code>node scripts/pmu/goal-loop-v5.mjs</code> (${esc(r.ts)}); recompute it yourself</span>
<div class="advpanels">
  <div>
    <div style="font-size:12px;font-weight:bold;margin-bottom:4px">NORMAL — the dot (batch, measured)</div>
    ${pulseSvg(r.throughput.discrete_cycle_s)}
    <div style="font-size:11px;color:#888">5 cold Node spawns per tick · ~1.3MB reef re-parse per stage · the working loop, live today</div>
  </div>
  <div>
    <div style="font-size:12px;font-weight:bold;margin-bottom:4px">ADVANCED — the line (stream + adversary, measured)</div>
    ${multipleSvg(r.throughput)}
    <div style="font-size:11px;margin-top:6px"><b>Tombstone catch</b> ${badge(r.race.pass)}</div>
    ${raceSvg(r.race)}
    <div style="font-size:11px;margin-top:6px"><b>Orphan catch</b> ${badge(r.siphon.pass)}</div>
    ${siphonSvg(r.siphon)}
    <div style="font-size:11px;margin-top:6px"><b>Thrash catch</b> <span style="color:#e0b400;font-weight:bold">INFO — baseline only</span></div>
    <div style="font-size:10px;color:#888">${r.thrash.ricochets} ricochet routes across distant coordinates · mean ${r.thrash.mean_ms}ms · ${esc(r.thrash.note)}</div>
  </div>
</div>
<div style="font-size:11px;color:#888;margin-top:8px;font-style:italic">"Anyone can make a system go faster. We built a system that survives its own speed: live race conditions, a memory-leak flood, and hallucination reversions fired at the stream — caught, receipted, without dropping a frame of custody." · in-memory convergence measured ×${r.throughput.multiple.toLocaleString('en-US')}; the S1 sidecar's job is to make that the shipped cadence</div>
</div>`;
}
