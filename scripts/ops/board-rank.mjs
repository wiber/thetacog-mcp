#!/usr/bin/env node
// scripts/ops/board-rank.mjs — C1048 T-MINUS + C1050 ONE RANKING. Operator 2026-10-20, verbatim: "based on what the milestones and
// planning and T minus what's important dates means that you get the important thing at the top of the list". One comparator every
// ranked list sorts through: fewer days to the row's milestone first (a dated row before NO DATE), then what it unblocks (more first),
// then nearness to the work in flight (gzip-NCD, lower first), then the id. Milestones: data/vna/milestones.json (hand-kept from the
// calendar). LLM-free. Port row C1048r: this DECIDES order — port to the crate once the keys settle (CLAUDE.md MAXIMISE RUST).
//   node scripts/ops/board-rank.mjs      print every milestone with its T-minus and the rows it serves
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MILESTONES = 'data/vna/milestones.json';
export const loadMilestones = (p = resolve(REPO, MILESTONES)) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).milestones || [] : []);
const day = (d) => Math.floor(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / 864e5);
// The nearest milestone not yet past that serves this row → { days, milestone }, or null (NO DATE).
export function tMinus(id, { milestones = loadMilestones(), today = new Date().toISOString().slice(0, 10) } = {}) {
  const m = milestones.filter((x) => (x.serves || []).includes(id) && day(x.date) >= day(today)).sort((a, b) => day(a.date) - day(b.date))[0];
  return m ? { days: day(m.date) - day(today), milestone: m } : null;
}
export const tMinusLabel = (t) => (t ? `T-${t.days} · ${t.milestone.name} (${t.milestone.date.slice(5)})` : 'NO DATE');
// a, b: { id, days (number|null), unlocks, near }
export function compareRank(a, b) {
  const da = a.days ?? Infinity; const db = b.days ?? Infinity;
  return da - db || (b.unlocks || 0) - (a.unlocks || 0) || (a.near ?? 1) - (b.near ?? 1) || String(a.id).localeCompare(String(b.id));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const today = new Date().toISOString().slice(0, 10);
  for (const m of loadMilestones().sort((a, b) => a.date.localeCompare(b.date))) console.log(`T-${day(m.date) - day(today)}`.padEnd(6), m.date, m.name.padEnd(36), (m.serves || []).join(' ') || '—');
}
