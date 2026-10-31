// scripts/milestones/room-project.mjs
//
// THE DECIDABLE HALF OF SHORTLEX: a list earns its coordinate by WHERE ITS WORK LIVES.
//
// Operator, 2026-08-24: "we can tie them to the room and make them strategy tactics operations."
// That turns a semantic guess into a count. Every milestone declares shell predicates; every
// predicate names real repo paths; every room declares an OWNED FILE SURFACE in
// .workflow/rooms/<slug>.html and carries a canonical coordinate in data/rooms.json. So a list's
// coordinate is not a judgement about what the list is "about" — it is the coordinate of the room
// whose surface the list's own evidence actually touches, counted.
//
// WHY THIS AND NOT THE COMPRESSION PROJECTOR. The gzip-NCD projector was built first and measured
// second, which is the right order, and it failed: calibrated against the nine rooms it recovered
// 3/9 exactly, and worse, placements FLIPPED under benign preprocessing changes — Technical
// Integration landed on A, C or C2 depending only on whether predicate paths were included in the
// payload. A measurement that moves when you change an arbitrary preprocessing choice is not a
// measurement. This one cannot flip: the paths are in the predicates, the globs are in the room
// HTML, and a count is a count.
//
// SUFFICIENCY CONTRACT: sufficient for "whose surface does this list's declared evidence touch,
// and how decisively". NOT sufficient for "what is this list about" — a list whose predicates
// point nowhere gets no coordinate, and that abstention is correct rather than a gap.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO } from './derive.mjs';

const AXIS = (() => {
  const m = {};
  try {
    const raw = JSON.parse(readFileSync(resolve(REPO, 'docs/architecture/axis-library-v1.json'), 'utf8'));
    for (const a of Array.isArray(raw) ? raw : raw.axes || Object.values(raw)) m[a.rank] = { name: a.name, emoji: a.emoji || '' };
  } catch { /* */ }
  return m;
})();

/** ShortLex: breadth before depth - shorter ranks first, then lexicographic. */
export const shortlexCompare = (a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

/**
 * THE SURFACE IS TRACKED, THE BRIEFING IS NOT.
 * .workflow/rooms/<slug>.html is gitignored and declared regenerable state ("Auto-regenerated room
 * briefings", .gitignore:282), so a surface claim written only there is a claim that can vanish —
 * and one already had: The Performer owned `docs/strategy/deck/`, a directory that did not exist,
 * while eighteen real decks in docs/decks/ were owned by nobody and Pitch And Fund therefore
 * projected onto no room at all. data/room-surfaces.json is the tracked source; the HTML is the
 * fallback for a room the sidecar has not got yet. (CLAUDE.md: NEVER WRITE STATE INTO A GENERATED FILE.)
 */
function surfaceSidecar() {
  try {
    return JSON.parse(readFileSync(resolve(REPO, 'data/room-surfaces.json'), 'utf8')).rooms || {};
  } catch { return {}; }
}

export function loadRooms() {
  const raw = JSON.parse(readFileSync(resolve(REPO, 'data/rooms.json'), 'utf8')).rooms;
  const arr = Array.isArray(raw) ? raw : Object.entries(raw).map(([key, v]) => ({ key, ...v }));
  const sidecar = surfaceSidecar();
  return arr.map((r) => {
    const rank = String(r.coordinate || '').split(/[ .]/)[0];
    let owned = sidecar[r.key]?.owned ?? [];
    if (owned.length === 0) {
      try {
        const html = readFileSync(resolve(REPO, r.html_path || `.workflow/rooms/${r.key}.html`), 'utf8');
        const sec = html.split(/<h3>\s*Owned file\/dir surface\s*<\/h3>/i)[1] || '';
        const body = sec.split(/<h3>/)[0];
        owned = [...body.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1].trim()).filter(Boolean);
      } catch { /* a room with neither sidecar entry nor HTML simply owns nothing */ }
    }
    return { key: r.key, persona: r.persona, emoji: r.emoji, rank, coordinate: r.coordinate, owned };
  });
}

export function globToRe(g) {
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*');
  return new RegExp('^' + esc + (g.endsWith('/') ? '' : '(/|$)'));
}

/**
 * PROJECT AN ARBITRARY PATH LIST ONTO THE ROOMS — the same decidable count projectTrack() runs,
 * lifted out so a second caller does not re-roll it. Extracted 2026-08-24, when room-activity.mjs
 * needed to ask of a SESSION's touched files exactly what this file asks of a milestone's declared
 * evidence: whose owned surface does this work actually touch, counted.
 *
 * ONE RULE LIVES IN ONE PLACE. A second hand-rolled glob matcher is the drift this prevents, and
 * the header above is why it matters here specifically: the gzip projector FLIPPED under benign
 * preprocessing changes, so two independent implementations of "which room" would not merely
 * duplicate — they would disagree, and nothing would say which was right.
 *
 * Returns the FULL tally, not just the winner: a session that touches three rooms is a real and
 * interesting fact about the operator's attention, and collapsing it to one label throws that away.
 */
export function projectPaths(paths, rooms = loadRooms()) {
  const tallies = rooms.map((room) => {
    const res = room.owned.map(globToRe);
    const hits = paths.filter((p) => res.some((re) => re.test(p)));
    return {
      room: room.key, persona: room.persona, emoji: room.emoji, rank: room.rank,
      coordinate: room.coordinate, hits: hits.length, examples: [...new Set(hits)].slice(0, 6),
    };
  }).sort((a, b) => b.hits - a.hits || shortlexCompare(a.rank, b.rank));
  const [best, second] = tallies;
  const placed = !!best && best.hits > 0 && best.hits > (second?.hits ?? 0);
  return {
    placed, tallies, best: best || null,
    margin: best && second ? best.hits - second.hits : null,
    // Abstention is a correct answer, not a gap — same contract as projectTrack().
    reason: placed
      ? `${best.hits} of ${paths.length} touched paths fall inside ${best.persona}'s owned surface`
      : (best?.hits ?? 0) === 0
        ? 'no touched path falls inside any room surface'
        : `tied on ${best?.hits ?? 0} hits - the work does not favour one room`,
    sensor: 'owned-surface glob count - decidable - LLM-free',
  };
}

/** Every repo path a list's predicates actually name. */
export function trackPaths(source, trackKey) {
  const out = [];
  for (const item of source.items.filter((i) => i.track === trackKey)) {
    for (const ax of ['spec', 'exec', 'market']) {
      for (const p of item.evidence?.[ax] ?? []) {
        const check = typeof p === 'string' ? p : p.check;
        for (const m of String(check).matchAll(/[\w.[\]-]+(?:\/[\w.[\]*-]+)+/g)) {
          const s = m[0].replace(/^['"]|['"]$/g, '');
          if (s.includes('/')) out.push(s);
        }
      }
    }
  }
  return out;
}

export function projectTrack(source, trackKey, rooms = loadRooms()) {
  const paths = trackPaths(source, trackKey);
  const tallies = rooms
    .map((room) => {
      const res = room.owned.map(globToRe);
      const hits = paths.filter((p) => res.some((re) => re.test(p)));
      return { room: room.key, persona: room.persona, emoji: room.emoji, rank: room.rank, coordinate: room.coordinate, hits: hits.length, examples: [...new Set(hits)].slice(0, 4) };
    })
    .sort((a, b) => b.hits - a.hits || shortlexCompare(a.rank, b.rank));

  const [best, second] = tallies;
  const placed = !!best && best.hits > 0 && best.hits > (second?.hits ?? 0);
  return {
    placed,
    rank: placed ? best.rank : null,
    label: placed ? `${best.rank}.${AXIS[best.rank]?.name ?? best.rank}` : null,
    axisEmoji: placed ? AXIS[best.rank]?.emoji ?? '' : '',
    room: placed ? best.room : null,
    roomEmoji: placed ? best.emoji : '',
    persona: placed ? best.persona : null,
    hits: best?.hits ?? 0,
    pathsConsidered: paths.length,
    margin: best && second ? best.hits - second.hits : null,
    runnerUp: second && second.hits > 0 ? { room: second.room, rank: second.rank, hits: second.hits } : null,
    examples: best?.examples ?? [],
    reason: placed
      ? `${best.hits} of ${paths.length} declared evidence paths fall inside ${best.persona}'s owned surface`
      : (best?.hits ?? 0) === 0
        ? 'no declared evidence path falls inside any room surface yet'
        : `tied on ${best?.hits ?? 0} hits - the evidence does not favour one room`,
    sensor: 'owned-surface glob count - decidable - LLM-free',
  };
}

export function projectAll(source) {
  const rooms = loadRooms();
  const keys = Object.keys(source.tracks);
  const coords = Object.fromEntries(keys.map((k) => [k, projectTrack(source, k, rooms)]));

  const byRank = new Map();
  for (const [k, v] of Object.entries(coords)) if (v.placed) byRank.set(v.rank, [...(byRank.get(v.rank) || []), k]);
  for (const [, ks] of byRank) if (ks.length > 1) for (const k of ks) coords[k].collision = ks.filter((x) => x !== k);

  const order = keys.slice().sort((a, b) => {
    if (coords[a].placed !== coords[b].placed) return coords[a].placed ? -1 : 1;
    if (coords[a].placed) return shortlexCompare(coords[a].rank, coords[b].rank) || (a < b ? -1 : 1);
    return a < b ? -1 : 1;
  });
  return { coords, order };
}
