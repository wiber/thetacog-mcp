#!/usr/bin/env node
// scripts/ops/board-gtm.mjs — the GTM · Spec sheet (operator 2026-10-30: "write it as a spreadsheet use /tend … easier to
// hierarchically scan by eye … It has to reference the numbers and titles of the spec rows").
// Source: docs/specs/vna/gtm-spec.json (hand-authored; holds ids, never a spec row's title). Every ref is resolved LIVE at
// write time: a C-row reads its tick and title off SPEC-VNA-COCKPIT.md and its Merkle leaf off data/vna/spec-tree.json;
// Q-, WC-, FN-, H- read their own sheet's source; F-/T-/G-/R- point inside this sheet. An unresolved ref prints
// "? <id> UNRESOLVED", never a blank. The hierarchy is drawn in column B (■ section · ├ motion · └ part) so the eye
// scans the band, then the motion, then its parts. Guard: tests/ops/gtm-spec-sheet.test.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BUYS from '../../src/lib/licence-buys.mjs';   // F-02 and F-05 read the shipped lines live: one rule, one place

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const GTM_SRC = 'docs/specs/vna/gtm-spec.json';
export const GTM_HEAD = ['ID', 'LEVEL', 'WHAT', 'WHO PAYS · WHO READS', 'THE LINE WE SAY', 'NEAR MISS CLOSED (the line it replaces → the rule it broke)', 'THE CHECK THEY RUN', 'SPEC ROWS (live: ✓ ticked · · open · Merkle leaf)', 'HORIZON', 'DONE WHEN', 'READY TO BUILD', 'UNBLOCKS (computed: the motions that wait on this row)', 'SUFFICIENT FOR · NOT FOR', 'RESOURCE (errata → use of funds)', 'NOTE (fill)'];

const read = (p) => readFileSync(resolve(REPO, p), 'utf8');
const rowsOf = (p) => { const j = JSON.parse(read(p)); return Array.isArray(j) ? j : (j.rows || Object.values(j).find(Array.isArray) || []); };

// The spec rows, read off the markdown the door ticks: id → { ticked, title }.
export function specIndex(md = read('docs/specs/vna/SPEC-VNA-COCKPIT.md')) {
  const ix = new Map();
  for (const l of md.split('\n')) {
    const m = l.match(/^\s*- \[( |x)\] (C\d+[a-z]*) (?:\(guard: `[^`]*`\) )?(.*)$/);
    if (m && !ix.has(m[2])) ix.set(m[2], { ticked: m[1] === 'x', title: m[3].replace(/\s*\((?:chair decomposition|operator|declared)\b.*$/i, '').replace(/^\((?:GTM|TEND):[^)]*\)\s*/i, '').trim() });
  }
  return ix;
}

function leafIndex() {
  const p = 'data/vna/spec-tree.json';
  if (!existsSync(resolve(REPO, p))) return new Map();
  const nodes = JSON.parse(read(p)).nodes || [];
  return new Map((Array.isArray(nodes) ? nodes : Object.values(nodes)).filter((n) => n?.cue).map((n) => [n.cue, String(n.hash || '').slice(0, 10)]));
}

export function refIndex({ src = JSON.parse(read(GTM_SRC)), spec = specIndex(), leaves = leafIndex() } = {}) {
  const ix = new Map();
  const short = (s, n = 64) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  for (const [id, r] of spec) ix.set(id, `${r.ticked ? '✓' : '·'} ${id} ${short(r.title)}${leaves.get(id) ? ` [${leaves.get(id)}]` : ''}`);
  for (const r of rowsOf('docs/specs/vna/business-plan-v2.json')) ix.set(r.id, `${r.id} ${short(r.part + ' — ' + r.question)}`);
  for (const r of rowsOf('docs/specs/vna/warranty-circuit.json')) ix.set(r.id, `${r.id} ${short(Object.values(r)[1] + ' — ' + Object.values(r)[2])}`);
  for (const r of rowsOf('docs/specs/vna/funnel.json')) ix.set(r.id, `${r.id} ${short(Object.values(r)[1] + ' — ' + Object.values(r)[3])}`);
  for (const r of rowsOf('docs/specs/vna/horizons.json')) ix.set(r.id, `${r.id} ${r.hz} ${r.date || ''}`.trim());
  for (const r of src.rows) ix.set(r.id, `→ ${r.id} ${short(r.what, 48)}`);
  return ix;
}

// A line written "@NAME" is that export of src/lib/licence-buys.mjs (ONE_SKU, CANONICAL_SPLIT), never a copy; an unknown name prints UNRESOLVED.
export const sayOf = (r) => { const m = /^@([A-Z_]+)$/.exec(r.say || ''); return m ? (typeof BUYS[m[1]] === 'string' ? BUYS[m[1]] : `? @${m[1]} UNRESOLVED`) : (r.say || ''); };

const mark = (r, next) => r.level === 0 ? '■' : r.level === 1 ? '├' : (next && next.level === 2 ? '│ ├' : '│ └');

// READY TO BUILD is computed, never typed: the open C-rows a row cites, plus the not-ready rows of this sheet it cites,
// followed by the source note (parked, the operator’s amount). One rule for every row, so two rows with one dependency shape
// can never read it two ways (the second cold grade’s contradiction, 2026-10-30).
export function readyOf(r, { src, spec, seen = new Set() }) {
  if (/^yes — a definition/.test(r.ready || '') || /^parked/.test(r.ready || '')) return r.ready;
  if (seen.has(r.id)) return ''; seen.add(r.id);
  const open = [];
  for (const id of r.refs || []) {
    if (spec.has(id)) { if (!spec.get(id).ticked) open.push(id); continue; }
    const t = src.rows.find((x) => x.id === id && x.level > 0);
    if (t && /^[TG]-/.test(t.id) && !/^yes/.test(readyOf(t, { src, spec, seen }))) open.push(id);
  }
  const note = (r.ready || '').replace(/^(?:waits on [^;(]*|yes\b)/, '').replace(/^[;\s]+/, '').trim();
  return (open.length ? `waits on ${[...new Set(open)].join(', ')}` : 'yes') + (note ? ` — ${note}` : '');
}

// C2173 — THE CRITICAL PATH, COMPUTED (operator 2026-10-30: "this is both a spec to be ticked, and a affordance for me to see where we
// are - so how do we improve it?"). waitSet is everything a row's readiness stands on, transitively: its open C-rows, and every T-/G- row
// it cites that is not ready, with that row's own wait set. unblocksIndex inverts it over the motions (G-), so a row's UNBLOCKS cell names
// the motions that move the day it is done. One rule with readyOf: a row readyOf reads "yes" has an empty wait set.
export function waitSet(r, { src, spec, memo = new Map(), seen = new Set() }) {
  if (memo.has(r.id)) return memo.get(r.id);
  const out = new Set();
  if (seen.has(r.id) || /^parked/.test(r.ready || '')) return out;
  seen.add(r.id);
  for (const id of r.refs || []) {
    if (spec.has(id)) { if (!spec.get(id).ticked) out.add(id); continue; }
    const t = src.rows.find((x) => x.id === id && x.level > 0);
    if (t && /^[TG]-/.test(t.id)) { const w = waitSet(t, { src, spec, memo, seen }); if (w.size) { out.add(id); for (const x of w) out.add(x); } }
  }
  memo.set(r.id, out); return out;
}
export function unblocksIndex({ src, spec }) {
  const memo = new Map(); const ix = new Map();
  for (const r of src.rows) if (r.level > 0 && /^G-/.test(r.id) && !/^parked/.test(r.ready || '')) for (const id of waitSet(r, { src, spec, memo })) ix.set(id, [...(ix.get(id) || []), r.id]);
  return ix;
}
// The NOW line: floor ready k/n · motions ready k/n · the rows that unblock the most, first. Read off the same readyOf and unblocksIndex.
export function nowLine({ src, spec, ub = unblocksIndex({ src, spec }) }) {
  const live = (re) => src.rows.filter((r) => r.level > 0 && re.test(r.id) && !/^parked/.test(r.ready || ''));
  const ready = (rows) => rows.filter((r) => /^yes\b/.test(readyOf(r, { src, spec }))).length;
  const T = live(/^T-/), G = live(/^G-/);
  const top = [...ub].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 5).map(([id, m]) => `${id} (${m.length})`);
  return `floor ${ready(T)}/${T.length} ready · motions ${ready(G)}/${G.length} ready · first, by motions unblocked: ${top.join(' · ') || 'none waiting'}`;
}

export function composeGtm({ src = JSON.parse(read(GTM_SRC)), ix = refIndex({ src }), spec = specIndex() } = {}) {
  const res = (id) => ix.get(id) || `? ${id} UNRESOLVED`;
  const ub = unblocksIndex({ src, spec });
  const blank = () => Array(GTM_HEAD.length).fill('');
  const why = blank(); why[0] = 'WHY'; why[2] = src.title; why[4] = src.rule; why[7] = src.sources.join(' · ');
  const now = blank(); now[0] = 'NOW'; now[2] = 'WHERE WE ARE (computed)'; now[4] = nowLine({ src, spec, ub });
  const out = [GTM_HEAD, why, now];
  const ubCell = (id) => { const m = ub.get(id) || []; return m.length ? `${m.length} motion${m.length === 1 ? '' : 's'}: ${m.join(' · ')}` : ''; };
  src.rows.forEach((r, i) => {
    const pad = r.level === 2 ? '    ' : r.level === 1 ? '  ' : '';
    if (r.level === 0) { out.push([r.id, mark(r), r.what.toUpperCase(), ...Array(GTM_HEAD.length - 3).fill('')]); return; }
    out.push([r.id, mark(r, src.rows[i + 1]), pad + r.what, r.who || '', sayOf(r), r.near || '', r.check || '',
      (r.refs || []).map(res).join('\n'), r.hz ? res(r.hz) : '', r.done || '', readyOf(r, { src, spec }), ubCell(r.id), r.suff || '', r.resource || '', '']);
  });
  return out;
}

export const compose = composeGtm;

// The sheet's own invariants, as findings (empty = sound). The guard runs this; so does --print --lint.
export async function lintGtm({ src = JSON.parse(read(GTM_SRC)), spec = specIndex() } = {}) {
  const { BEHAVIOR_GUARANTEE, STOPS_AGENT } = await import('../voice/behavior-promise.mjs');
  const ix = refIndex({ src, spec });
  const ids = new Set(src.rows.map((r) => r.id));
  const out = [];
  for (const r of src.rows) {
    if (r.level === 0) { if (!src.rows.some((c) => c.level === 1 && c.id.startsWith(r.id + '-'))) out.push(`${r.id}: a section with no rows`); continue; }
    // C2174: an INTAKE row (I-) records a pasted idea — what it was, the repo fact checked, where it landed, the correction; no line of ours
    const need = /^I-/.test(r.id) ? ['what', 'say', 'near', 'check', 'done'] : ['what', 'who', 'say', 'near', 'check', 'hz', 'done', 'ready', 'suff'];
    for (const k of need) if (!String(r[k] ?? '').trim()) out.push(`${r.id}: no ${k}`);
    if (/^I-/.test(r.id) && !(r.refs || []).length) out.push(`${r.id}: an intake row that names no row it landed on`);
    if (r.hz && !/^H-\d\d$/.test(r.hz)) out.push(`${r.id}: horizon ${r.hz} is not an H- id`);
    for (const id of [...(r.refs || []), r.hz].filter(Boolean)) if (!ix.has(id)) out.push(`${r.id}: ref ${id} UNRESOLVED`);
    if (/^[TG]-/.test(r.id) && !(r.refs || []).some((id) => /^C\d+[a-z]*$/.test(id))) out.push(`${r.id}: a plan step that cites no row in the tree`);
    if (/not declared/i.test(r.ready || '')) out.push(`${r.id}: a step marked not declared — declare it, then cite its C-number`);
    const say = sayOf(r);
    if (/UNRESOLVED$/.test(say)) out.push(`${r.id}: ${say}`);
    // the lessons of 2026-10-16..10-30, as findings: one thing to buy · never a customer count · a number carries its source ·
    // need-to-know (no filing status) · every floor row names the resource that closes it (errata are the use of funds)
    if (/\b(setup fee|pilot fee|subscription|per[- ]seat|retainer|consulting (?:hours|fee))\b/i.test(say + ' ' + (r.who || ''))) out.push(`${r.id}: a second purchase — we sell agent-years only (ONE_SKU)`);
    if (/\bpays:/.test(r.who || '') && !/agent-years?/.test(r.who)) out.push(`${r.id}: names a payer but not agent-years`);
    if (/\b(our first (?:buyer|customer)|one customer|already paid|\d+ (?:customers|buyers|paying))\b/i.test(say)) out.push(`${r.id}: a customer count in a line we say`);
    if (/\b\d[\d,]* (?:rows )?of [\d,]{2,}\b|\b\d+(?:\.\d+)?%/.test(say) && !r.numSrc) out.push(`${r.id}: a count in the line with no numSrc on the record`);
    if (/\b(patent|CIP|track one|prosecution|filed)\b/i.test(say)) out.push(`${r.id}: filing status in a line we say (need-to-know)`);
    if (/^T-/.test(r.id) && !String(r.resource || '').trim()) out.push(`${r.id}: a floor row with no resource`);
    if (BEHAVIOR_GUARANTEE.test(say) || STOPS_AGENT.test(say)) out.push(`${r.id}: the line we say promises behaviour — ${say.slice(0, 80)}`);
    if (/^yes\b/.test(r.ready || '')) for (const id of r.refs || []) {
      if (spec.has(id) && !spec.get(id).ticked) out.push(`${r.id}: READY yes but ${id} is open`);
      if (ids.has(id)) { const t = src.rows.find((x) => x.id === id); if (t && !/^yes\b/.test(t.ready || '')) out.push(`${r.id}: READY yes but ${id} reads "${t.ready}"`); }
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--print')) {
  for (const r of composeGtm()) console.log([r[0], r[1], String(r[2]).slice(0, 52), String(r[7]).split('\n')[0].slice(0, 70), r[10]].join(' │ '));
}
