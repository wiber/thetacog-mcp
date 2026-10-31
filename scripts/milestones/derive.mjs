// ONE RULE, ONE PLACE — the milestone naming scheme lives here and nowhere else.
//
// An item's NAME IS ITS POSITION. Nothing about a line item is hand-typed except
// its track, phase, emoji and three words:
//
//   seq  = 1-based index in the single ordered `items` array (the long list)
//   rank = <phase letter><ordinal within (track, phase), scanning the long list in order>
//
// So `12 C1 📡 Ingest live telemetry` is not written down anywhere — it is computed.
// Re-order the list and every number and rank re-derives with zero drift.
//
// SUFFICIENCY CONTRACT: this module is sufficient for "what is this item called and
// where does it sit". It is NOT sufficient for "how far along is it" — that is the
// scorer's job, and it is a separate, measured artifact.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE = path.join(REPO, 'data', 'milestones.json');
export const PROGRESS = path.join(REPO, 'data', 'milestones-progress.json');

export const AXES = ['spec', 'exec', 'market'];

export function loadSource(file = SOURCE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Derive seq + rank for every item. Pure function of array order. */
export function derive(source) {
  const counters = new Map(); // `${track}|${phase}` -> ordinal
  return source.items.map((item, i) => {
    const key = `${item.track}|${item.phase}`;
    const ordinal = (counters.get(key) || 0) + 1;
    counters.set(key, ordinal);
    return {
      ...item,
      seq: i + 1,
      rank: `${item.phase}${ordinal}`,
      // full label, per ALWAYS EXPAND COORDINATE LABELS: a bare rank is opaque
      rankFull: `${item.phase}${ordinal} ${source.phases?.[item.phase]?.name ?? item.phase}.${item.track}`,
    };
  });
}

/** The rendered line, exactly as it appears on the page and in the terminal. */
export function line(item) {
  return `${item.seq} ${item.rank} ${item.emoji} ${item.words}.`;
}

/**
 * The bare IDENTIFIER of an item — running number and phase rank, nothing else.
 * `line()` renders the whole line; callers that lay their own emoji and words
 * beside a reference need only the address, and doubling them reads as a bug.
 * Both halves stay DERIVED here (per the source contract, a rank is never
 * written into milestones.json), so a reference can never drift from the board.
 */
export function ref(item) {
  return `#${item.seq} [${item.rank}]`;
}

export function groupByTrack(source, derived) {
  return Object.entries(source.tracks).map(([key, track]) => ({
    key,
    ...track,
    items: derived.filter((d) => d.track === key),
  }));
}
