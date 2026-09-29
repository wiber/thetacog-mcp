#!/usr/bin/env node
// scripts/vna/alignment-map.mjs — VECTOR 2: the attractor network across rooms.
//
// The spec asks for "a real-time map of enterprise alignment, eliminating the middle-management
// abstraction layer" — every local cockpit feeding one view, initiatives as ATTRACTOR STATES rather
// than transitive instructions, and a "re-roll" flag when something drifts past acceptable variance.
//
// THIS IS BUILT ON REAL TEAMS, NOT SIMULATED ONES. The nine rooms in data/rooms.json each declare a
// coordinate — 🔒 vault is A1.Strategy.Law, and so on. That declared coordinate IS the magnetic
// pole. Commits carry `Originating-Terminal:` trailers (374 of the last 400 — 93.5% coverage,
// printed every run), and every commit already has a realized coordinate in the greeks index. So
// "where did this team's work actually land, versus the pole it declared" is answerable from
// receipts that exist, with nothing invented.
//
// THE RE-ROLL IS A FLAG, NEVER AN ACTION — and this is the operator's correction applied at
// organizational scale: "I never said to make it impossible to fail... the water sticks to the net."
// Nothing here halts a team, blocks a merge, or auto-corrects an initiative. A room past its
// variance band is SURFACED, with the distance and the direction, and a human decides. An
// enclosure at this scale would be middle management with a dashboard, which is the exact thing
// the spec says to eliminate.
//
// WHAT THIS IS NOT SUFFICIENT FOR, fenced rather than left to be discovered: it cannot say whether
// a room's work was GOOD (Rice), and it cannot say a room SHOULD be at its declared pole — a room
// that has moved may be right, and the declaration may be the stale half. That is precisely the
// two-armed question the envelope asks locally, and it does not get easier by aggregating.
//
// LLM-FREE. Every number is a pure function of rooms.json, the git trailers, and the greeks index.
//
// @guard tests/vna/alignment-map.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const ROOMS = resolve(REPO, 'data/rooms.json');
const GREEKS = resolve(REPO, 'src/data/commit-greeks-index.json');
const AXL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const LANE = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };

const WINDOW = Number(process.env.VNA_WINDOW || 400);
const MIN_COMMITS = Number(process.env.VNA_MIN_ROOM || 8);   // below this a room's shape is noise
const VARIANCE_BAND = Number(process.env.VNA_BAND || 3);      // Chebyshev blocks; past it → re-roll flag

if (!existsSync(ROOMS) || !existsSync(GREEKS)) {
  console.error('NOT ADMISSIBLE (exit 2): rooms registry or greeks index absent — "I did not look" is not "I looked and saw nothing".');
  process.exit(2);
}

const laneIdx = (ax) => AXL.indexOf(ax);
const blockOf = (coord) => {
  const m = /^([A-C])([1-3])?,([A-C])([1-3])?$/.exec(String(coord || '').trim());
  if (!m) return null;
  return ['ABC'.indexOf(m[1]) * 3 + (m[2] ? +m[2] - 1 : 1), 'ABC'.indexOf(m[3]) * 3 + (m[4] ? +m[4] - 1 : 1)];
};
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const fullName = (c) => { const m = /^([A-C][1-3]?),([A-C][1-3]?)$/.exec(String(c || ''));
  return m ? `${m[1]}.${LANE[m[1]]} × ${m[2]}.${LANE[m[2]]}` : String(c || '?'); };

// A room declares ONE axis ("A1 Strategy.Law"). Its pole on the 12×12 block grid is that axis
// crossed with itself — the self-cell — because a room's declared territory is its own lane acting
// on its own lane. Any other reading would need a second declared axis the registry does not carry.
function poleOf(room) {
  const ax = String(room.coordinate || '').trim().split(/\s+/)[0];
  const i = laneIdx(ax);
  return i >= 0 ? { axis: ax, block: [i, i], coord: `${ax},${ax}` } : null;
}

// ROOM-NAME NORMALIZATION, and it is load-bearing. The trailer is written by hand and by scripts, so
// the SAME room appears as "📐 architect" and "📐 VS Code Architect" — measured, both live in the
// last 400. Matching the raw string would split one room into two half-powered ones and quietly
// halve every count. Normalize to the registry key by looking for the key OR the persona words.
function normalizeRoom(trailer, rooms) {
  const t = String(trailer || '').toLowerCase();
  for (const r of rooms) {
    const key = r.key.toLowerCase();
    const persona = String(r.persona || '').toLowerCase().replace(/^the\s+/, '');
    const term = String(r.terminal || '').toLowerCase();
    if (t.includes(key) || (persona && t.includes(persona)) || (term && t.includes(term))) return r.key;
  }
  return null;
}

export function buildMap({ window = WINDOW } = {}) {
  const reg = JSON.parse(readFileSync(ROOMS, 'utf8'));
  const rooms = Object.values(reg.rooms);
  const greeks = JSON.parse(readFileSync(GREEKS, 'utf8'));

  // git log → [sha, originating-terminal]. The trailer is the only attribution that exists; a commit
  // without one is COUNTED as unattributed rather than dropped, because a silent drop would make
  // coverage look perfect.
  const raw = execSync(`git log -${window} --pretty=format:%H%x1f%B%x1e`, { cwd: REPO, maxBuffer: 1 << 28 }).toString();
  const entries = raw.split('\x1e').filter((s) => s.trim());
  let attributed = 0, unattributed = 0, unplaced = 0;
  const byRoom = new Map(rooms.map((r) => [r.key, []]));

  for (const e of entries) {
    const [sha, body = ''] = e.split('\x1f');
    const m = /^Originating-Terminal:\s*(.+)$/m.exec(body);
    if (!m) { unattributed++; continue; }
    const key = normalizeRoom(m[1], rooms);
    if (!key) { unattributed++; continue; }
    attributed++;
    const g = greeks[sha.trim()] || greeks[sha.trim().slice(0, 12)];
    const b = g && blockOf(g.coord);
    if (!b) { unplaced++; continue; }
    byRoom.get(key).push({ sha: sha.trim().slice(0, 9), coord: g.coord, block: b, sigma: g.sigma });
  }

  const out = [];
  for (const r of rooms) {
    const pole = poleOf(r);
    const landings = byRoom.get(r.key) || [];
    const row = { key: r.key, emoji: r.emoji, persona: r.persona, declared: pole?.coord || null,
      declaredName: pole ? fullName(pole.coord) : null, n: landings.length };
    if (!pole) { row.status = 'NO POLE'; row.note = 'the registry declares no parseable coordinate for this room'; out.push(row); continue; }
    if (landings.length < MIN_COMMITS) {
      row.status = 'UNDERPOWERED';
      row.note = `${landings.length} placed commit(s) in the window, floor ${MIN_COMMITS} — a shape from this is noise wearing a number`;
      out.push(row); continue;
    }
    const dists = landings.map((l) => cheb(l.block, pole.block));
    const pull = +(dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(2);
    const com = [landings.reduce((s, l) => s + l.block[0], 0) / landings.length,
                 landings.reduce((s, l) => s + l.block[1], 0) / landings.length];
    const comCoord = `${AXL[Math.round(com[0])]},${AXL[Math.round(com[1])]}`;
    // trend: first half vs second half of the window for this room
    const h = Math.floor(landings.length / 2);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const trend = +(mean(dists.slice(h)) - mean(dists.slice(0, h))).toFixed(2);
    Object.assign(row, {
      status: pull > VARIANCE_BAND ? 'RE-ROLL' : 'IN BAND',
      pull, band: VARIANCE_BAND, trend,
      trendWord: trend < -0.3 ? 'converging' : trend > 0.3 ? 'diverging' : 'flat',
      centre: comCoord, centreName: fullName(comCoord),
      withinBand: dists.filter((d) => d <= VARIANCE_BAND).length,
    });
    out.push(row);
  }
  const total = attributed + unattributed;
  return { rooms: out, coverage: { attributed, unattributed, unplaced, total,
    pct: total ? +(100 * attributed / total).toFixed(1) : 0 }, window, band: VARIANCE_BAND, floor: MIN_COMMITS };
}

function main() {
  const m = buildMap();
  console.log(`VNA ALIGNMENT MAP — the attractor network · window ${m.window} commits · LLM-free\n`);
  console.log(`attribution: ${m.coverage.attributed}/${m.coverage.total} commits carry a room trailer (${m.coverage.pct}%)` +
    ` · ${m.coverage.unattributed} unattributed · ${m.coverage.unplaced} attributed-but-unplaced`);
  console.log(`variance band: ${m.band} blocks · room floor: ${m.floor} placed commits\n`);

  const w = (s, n) => String(s).padEnd(n);
  console.log(`${w('room', 14)}${w('declared pole', 34)}${w('n', 5)}${w('pull', 7)}${w('trend', 12)}status`);
  console.log('─'.repeat(90));
  for (const r of m.rooms) {
    const base = `${w((r.emoji || '') + ' ' + r.key, 14)}${w(r.declaredName || '—', 34)}${w(r.n, 5)}`;
    if (r.status === 'UNDERPOWERED' || r.status === 'NO POLE') { console.log(base + w('—', 7) + w('—', 12) + r.status); continue; }
    console.log(base + w(r.pull, 7) + w(r.trendWord, 12) + r.status);
  }

  const reroll = m.rooms.filter((r) => r.status === 'RE-ROLL');
  const under = m.rooms.filter((r) => r.status === 'UNDERPOWERED');
  console.log('');
  if (reroll.length) {
    console.log(`RE-ROLL FLAGGED (${reroll.length}) — surfaced, never acted on:`);
    for (const r of reroll) {
      console.log(`  ${r.emoji} ${r.key}: declared ${r.declaredName}, work centred on ${r.centreName}`);
      console.log(`     pull ${r.pull} blocks (band ${r.band}) · ${r.trendWord} · ${r.withinBand}/${r.n} landings inside the band`);
      console.log(`     → either the room moved, or the declaration is the stale half. A human decides which.`);
    }
  } else console.log(`No room past the variance band.`);
  if (under.length) console.log(`\nUNDERPOWERED (${under.length}): ${under.map((r) => `${r.emoji} ${r.key} (n=${r.n})`).join(' · ')}`);

  console.log(`\nSUFFICIENT FOR: where each room's work landed against the pole it declared, and whether that gap is closing.`);
  console.log(`NOT SUFFICIENT FOR: whether a room's work was good (Rice), or whether a room SHOULD be at its pole —`);
  console.log(`a room that moved may be right and the declaration may be stale. Aggregating does not make that easier.`);

  mkdirSync(resolve(REPO, 'data/vna'), { recursive: true });
  writeFileSync(resolve(REPO, 'data/vna/alignment-map.json'), JSON.stringify({ at: new Date().toISOString(), ...m }, null, 2));
  console.log(`\nreceipt → data/vna/alignment-map.json`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
export { normalizeRoom, poleOf, fullName };
