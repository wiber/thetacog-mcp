#!/usr/bin/env node
// scripts/vna/labour.mjs — C93j THE PIN IS SALARIED HOURS. Three readings, each a receipt or UNMEASURED:
//   hoursOf(row)      — MEASURED wall-clock for the route that made the commit: the chair's turns' span (C93b's t0/t1) or the
//                       runner's verdict ms; never a base constant, never a formula over guards and spans
//   skillOf(label)    — the basin's reef hat and domain READ from the tree at the commit; never a hand table (ONE PLACE)
//   readRate()        — data/vna/labour-rate.json, the BUYER'S declaration: every number carries `cites` or the file is refused;
//                       absent → UNPINNED, and nothing downstream prints a currency glyph
//   reclaimed()       — (declared human h/cog for the band − measured route h/cog) × cogs; UNMEASURED without the declaration
// KR40 is satisfied by construction: the only dollar is hours × a declared, cited rate. The pin never enters a peg or a fit.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const RATE = process.env.VNA_LABOUR_RATE || resolve(REPO, 'data/vna/labour-rate.json');
export const REEF = process.env.VNA_LENS_REEF || resolve(REPO, 'data/pmu/lens-reef.json');

/** THE COMPETENCE SPLIT (operator 2026-09-19: "maybe many are required, so split competence cost"): the cells the walk lit map to the
 *  reef's domains by coordinate (exact pixel first, then the block that contains it); the share of cells per domain is the share of
 *  the work that needed that competence, and the value is hours × Σ share_d × rate_d — never one rate for a mosaic. */
export function readReef(path = REEF) { try { return (JSON.parse(readFileSync(path, 'utf8')).domains || []).filter((d) => d.domain && d.coord); } catch { return []; } }
const part = (t) => { const m = /^([ABC])(\d)?$/.exec(String(t).trim()); return m ? { blk: m[1], px: m[2] ? m[1] + m[2] : null } : null; };
export function domainOfCell(cell, reef) {
  const [r, c] = String(cell).split(',').map(part); if (!r || !c) return null;
  let best = null, score = -1;
  for (const d of reef) { const [dr, dc] = String(d.coord).split(',').map(part); if (!dr || !dc) continue;
    const sr = dr.px ? (r.px && dr.px === r.px ? 2 : -1) : (dr.blk === r.blk ? 1 : -1); const sc = dc.px ? (c.px && dc.px === c.px ? 2 : -1) : (dc.blk === c.blk ? 1 : -1);
    if (sr < 0 || sc < 0) continue; const sc2 = sr + sc; if (sc2 > score) { score = sc2; best = d.domain; } }
  return best;
}
export function competenceSplit(cells, reef = readReef()) {
  const counts = {}; let n = 0; for (const c of cells || []) { const d = domainOfCell(c, reef); if (!d) continue; counts[d] = (counts[d] || 0) + 1; n++; }
  if (!n) return { status: 'UNMEASURED', why: 'no lit cell maps to a reef domain', shares: {} };
  return { status: 'measured', n, shares: Object.fromEntries(Object.entries(counts).map(([d, k]) => [d, Math.round((k / n) * 1000) / 1000])) };
}
export function blendedRate(split, rate) {
  if (!split || split.status !== 'measured' || !rate || rate.status !== 'PINNED') return { hourly: null, why: 'no split or no pinned rate', missing: [] };
  let h = 0, covered = 0; const missing = [];
  for (const [d, share] of Object.entries(split.shares)) { const r = rate.rates[d]; if (r && Number.isFinite(r.hourly)) { h += share * r.hourly; covered += share; } else missing.push(d); }
  if (!covered) return { hourly: null, why: `no declared rate for any lit domain: ${missing.join(', ')}`, missing };
  return { hourly: Math.round((h / covered) * 100) / 100, covered: Math.round(covered * 1000) / 1000, missing };
}

/** measured wall-clock hours for the route that made the commit */
export function hoursOf({ spend, turns = [], runnerRow = null }) {
  if (runnerRow && Number.isFinite(runnerRow.ms)) return { hours: Math.round((runnerRow.ms / 3600000) * 1000) / 1000, route: 'runner', source: 'runner verdict row ms' };
  if (spend && spend.route === 'chair' && Array.isArray(spend.turns) && spend.turns.length) {
    const inside = turns.filter((t) => spend.turns.includes(t.n) && t.t0 && t.t1);
    if (!inside.length) return { hours: null, route: 'chair', status: 'UNMEASURED', why: 'the commit\'s turns carry no timestamps' };
    const ms = inside.reduce((a, t) => a + Math.max(0, Date.parse(t.t1) - Date.parse(t.t0)), 0);
    return { hours: Math.round((ms / 3600000) * 1000) / 1000, route: 'chair', source: 'transcript turn span (t0→t1)' };
  }
  return { hours: null, route: null, status: 'UNMEASURED', why: 'no runner row and no chair turns for this sha' };
}

/** the skill is the basin's reef hat and domain on the tree — read, never tabled */
export function skillOf(labels, tree) {
  const nodes = (tree && tree.nodes) || {};
  for (const l of labels || []) { const n = nodes[`n_spec_${l}`]; if (n && n.reef && (n.reef.hat || n.reef.domain)) return { label: l, hat: n.reef.hat || null, domain: n.reef.domain || null, source: 'data/vna/spec-tree.json n.reef' }; }
  return { label: null, hat: null, domain: null, status: 'UNMEASURED', why: 'no named basin carries a reef reading' };
}

/** the buyer's declaration; every number must carry cites or the file is refused */
export function readRate(path = RATE) {
  if (!existsSync(path)) return { status: 'UNPINNED', why: 'no data/vna/labour-rate.json — the rate is the buyer\'s declaration', rates: null, human_hours_per_cog: null };
  let j; try { j = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { status: 'REFUSED', why: `unreadable: ${e.message}`, rates: null, human_hours_per_cog: null }; }
  const bad = [];
  for (const [k, v] of Object.entries(j.rates || {})) if (!v || !Number.isFinite(v.hourly) || !v.cites) bad.push(`rates.${k}`);
  for (const [k, v] of Object.entries(j.human_hours_per_cog || {})) if (!v || !Number.isFinite(v.hours) || !v.cites) bad.push(`human_hours_per_cog.${k}`);
  for (const [k, v] of Object.entries(j.grip || {})) if (k !== 'note' && (!v || !Number.isFinite(v.value) || !v.cites)) bad.push(`grip.${k}`);
  if (!j.currency || !j.by || !j.at) bad.push('currency/by/at');
  if (bad.length) return { status: 'REFUSED', why: `a declared number without cites is not a receipt: ${bad.join(', ')}`, rates: null, human_hours_per_cog: null };
  return { status: 'PINNED', currency: j.currency, by: j.by, at: j.at, rates: j.rates || {}, anchor: j.anchor || null, grip: j.grip || null, human_hours_per_cog: j.human_hours_per_cog || null, source: path };
}

/** THE TABLE (operator 2026-09-19: "token cog complexity dollar per hour for human jobs matching x"): per band x — the peg (tokens/cog by
 *  route, C93c), the measured route hours/cog, the matched competences (the reef domains the band's minted rows lit, by share), the
 *  declared rate blended over them, the declared human hours/cog, the human value/cog and the compute cost/cog (the runner's own
 *  cost_usd ÷ cog when a verdict row carries it; UNMEASURED otherwise). Every cell is a receipt or says UNMEASURED/UNPINNED. */
export function bandTable({ rows = [], peg = null, rate = readRate(), runnerRows = [] } = {}) {
  const bands = {}; const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  for (const r of rows) { if (r.status !== 'measured') continue; const b = (bands[r.band] ||= { band: r.band, n: 0, chair_h: [], runner_h: [], domains: {}, hourly: [], human_h: null, value_per_cog: [], compute_per_cog: [] }); b.n++;
    (r.route === 'runner' ? b.runner_h : b.chair_h).push(r.route_hours_per_cog);
    if (r.split && r.split.shares) for (const [d, sh] of Object.entries(r.split.shares)) b.domains[d] = (b.domains[d] || 0) + sh;
    if (r.hourly != null) b.hourly.push(r.hourly); if (r.human_hours_per_cog != null) b.human_h = r.human_hours_per_cog;
    if (r.value != null && r.cog) b.value_per_cog.push(Math.round((r.human_hours_per_cog * r.hourly) * 100) / 100);
    const rr = runnerRows.find((x) => x.kind === 'verdict' && x.work && String(r.sha).startsWith(String(x.work).slice(0, 10)) && Number.isFinite(x.cost_usd)); if (rr && r.cog) b.compute_per_cog.push(Math.round((rr.cost_usd / r.cog) * 100) / 100); }
  return Object.values(bands).sort((a, b) => 'smlx'.indexOf(a.band[0]) - 'smlx'.indexOf(b.band[0])).map((b) => { const tot = Object.values(b.domains).reduce((x, y) => x + y, 0) || 1; const top = Object.entries(b.domains).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([d, v]) => `${d} ${Math.round((v / tot) * 100)}%`); const pg = peg && peg.bands && peg.bands[b.band]; return { band: b.band, n: b.n, peg_tokens_per_cog: pg && pg.peg != null ? Math.round(pg.peg) : null, peg_route: pg ? pg.route : null, chair_h_per_cog: med(b.chair_h), runner_h_per_cog: med(b.runner_h), competences: top, hourly: rate.status === 'PINNED' ? med(b.hourly) : null, human_h_per_cog: b.human_h, human_value_per_cog: rate.status === 'PINNED' ? med(b.value_per_cog) : null, compute_cost_per_cog: med(b.compute_per_cog), currency: rate.status === 'PINNED' ? rate.currency : null, pin: rate.status }; });
}
/** hours reclaimed on one row, and the dollar only when the rate is pinned */
/** the reality grip on one row — measured inputs (attempts, halts, the walk's reading, the probe) and the buyer's declared multiplier */
export function gripOf(cogRow, rate) {
  const inp = (cogRow && cogRow.inputs) || {}; const attempts = Number(inp.attempts) || 0, halts = Number(inp.halts) || 0;
  const lat = inp.lattice || {}; const probe = (cogRow && cogRow.probe) || null;
  const measured = { attempts, halts, lit_reality: inp.lit_reality ?? null, lane_jump: inp.lane_jump ?? null, walk: lat.status || 'UNMEASURED', probe: probe ? (probe.admissible ? 'measured' : 'NOT ADMISSIBLE') : 'UNMEASURED' };
  const g = rate && rate.status === 'PINNED' && rate.grip ? rate.grip : null;
  if (!g) return { ...measured, multiplier: null, why: 'no declared grip multiplier' };
  const mult = 1 + (g.per_attempt ? g.per_attempt.value * attempts : 0) + (g.per_halt ? g.per_halt.value * halts : 0);
  return { ...measured, multiplier: Math.round(mult * 1000) / 1000 };
}
export function reclaimed({ cogRow, hours, skill, rate, split = null }) {
  if (!cogRow || !cogRow.minted || !Number.isFinite(cogRow.cog) || cogRow.cog <= 0) return { status: 'UNMEASURED', why: 'no minted cog' };
  if (!hours || !Number.isFinite(hours.hours)) return { status: 'UNMEASURED', why: (hours && hours.why) || 'no measured hours' };
  const routePerCog = hours.hours / cogRow.cog;
  const out = { status: 'measured', route: hours.route, route_hours: hours.hours, route_hours_per_cog: Math.round(routePerCog * 1000) / 1000, band: cogRow.band, cog: cogRow.cog };
  if (rate.status !== 'PINNED') return { ...out, reclaimed_hours: null, value: null, pin: rate.status, why: rate.why };
  const h = rate.human_hours_per_cog && rate.human_hours_per_cog[cogRow.band];
  if (!h) return { ...out, reclaimed_hours: null, value: null, pin: 'PINNED', why: `no declared human hours/cog for band ${cogRow.band}` };
  const grip = gripOf(cogRow, rate); const humanPerCog = h.hours * (grip.multiplier || 1);   // the declared human hours carry the declared grip; the route's hours are measured and carry nothing
  const reclaimedHours = Math.round((humanPerCog - routePerCog) * cogRow.cog * 1000) / 1000;
  const blend = split ? blendedRate(split, rate) : null;
  const r = skill && skill.domain && rate.rates[skill.domain];
  const hourly = blend && blend.hourly != null ? blend.hourly : r ? r.hourly : null;
  const value = hourly != null ? Math.round(reclaimedHours * hourly * 100) / 100 : null;
  return { ...out, reclaimed_hours: reclaimedHours, human_hours_per_cog: Math.round(humanPerCog * 1000) / 1000, grip, hourly, split: blend ? { shares: split.shares, covered: blend.covered, missing: blend.missing } : null, value, currency: value == null ? null : rate.currency, pin: 'PINNED', why: hourly != null ? null : (blend && blend.why) || `no declared rate for domain ${skill && skill.domain}` };
}

if (process.argv[1] && /labour\.mjs$/.test(process.argv[1])) {
  const { cogCardData } = await import('./steer-ui.mjs'); const d = cogCardData();
  const nd = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const t = bandTable({ rows: (d.labour && d.labour.rows) || [], peg: d.peg, runnerRows: nd(resolve(REPO, '.thetacog/runner.ndjson')) });
  const f = (v, s = '') => (v == null ? 'UNMEASURED' : `${typeof v === 'number' && v >= 1000 ? v.toLocaleString() : v}${s}`);
  console.log(`TOKENS · COG · HOURS · RATE — per band x (pin: ${d.labour ? d.labour.pin : 'UNMEASURED'}${d.labour && d.labour.estimate ? ', rates are the operator\'s estimate' : ''})`);
  for (const b of t) console.log(`  ${b.band}  n ${b.n} · peg ${f(b.peg_tokens_per_cog, ' tok/cog')} (${b.peg_route || '—'}) · h/cog chair ${f(b.chair_h_per_cog)} runner ${f(b.runner_h_per_cog)} · human h/cog ${f(b.human_h_per_cog)} · ${b.competences.join(', ') || 'no split'} · rate ${b.pin === 'PINNED' ? f(b.hourly, ' ' + b.currency + '/h') : 'UNPINNED'} · human value/cog ${b.pin === 'PINNED' ? f(b.human_value_per_cog, ' ' + b.currency) : 'UNPINNED'} · compute/cog ${b.compute_cost_per_cog == null ? 'UNMEASURED (no runner cost row)' : b.compute_cost_per_cog + ' USD list'}`);
}
