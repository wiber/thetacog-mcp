// scripts/rewrite/attribution.mjs
// ════════════════════════════════════════════════════════════════════════════
// IN-LINE ATTRIBUTION — which prose came from which track, kept out of the prose.
//
// The spec asks that edited text "retain a persistent, subtle visual tag
// corresponding to its origin" — blue for Local, gold for Local+Tesseract, magenta
// for Cloud, amber for Cloud+Tesseract, grey for Manual.
//
// It CANNOT live in the manuscript. The moment attribution is written into the
// `.md` it ships in the epub, breaks the mdx-cook checks, and turns a clean source
// file into an annotated one. So it lives in a sidecar next to the file:
//
//     books/tesseract/chapters/chapter-08-from-meat-to-metal.md
//     books/tesseract/chapters/chapter-08-from-meat-to-metal.md.matrix-map.json
//
// ── ANCHORING BY TEXT, NOT OFFSET ──
// Every accepted edit shifts every byte after it, so stored offsets rot within one
// commit. Entries therefore store the committed SENTENCE TEXT and are located by
// exact match at read time. An entry whose text no longer appears has been edited
// again by someone else; it is reported as `stale` rather than pointed at a
// plausible-looking wrong span. A badge on the wrong sentence is worse than none.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';

const TRACK_COLORS = {
  A: '#4fc3f7',        // local
  B: '#ffd166',        // local + tesseract
  C: '#e879f9',        // cloud
  D: '#fb923c',        // cloud + tesseract
  MANUAL: '#8b98a5',
  ORIGINAL: '#5c6773',
};

const mapPath = (file) => `${file}.matrix-map.json`;

export function readMap(file) {
  try { return JSON.parse(fs.readFileSync(mapPath(file), 'utf8')); }
  catch { return { file, entries: [] }; }
}

function writeMap(file, data) {
  const p = mapPath(file);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
  return p;
}

/**
 * Record one accepted edit. `text` is the sentence that actually landed — the unit
 * a badge attaches to — not the whole window the writer committed.
 */
export function recordEdit(file, { text, original, track, sha, line, defect, monologueGrade }) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const map = readMap(file);
  map.file = file;
  map.entries = [
    ...(map.entries || []).filter((e) => e.text !== clean),   // re-edit supersedes
    {
      text: clean,
      original: String(original || '').trim() || null,
      track: track || 'MANUAL',
      color: TRACK_COLORS[track] || TRACK_COLORS.MANUAL,
      sha: sha || null,
      line: line ?? null,
      defect: defect || null,
      monologueGrade: monologueGrade || null,
      ts: new Date().toISOString(),
    },
  ];
  return writeMap(file, map);
}

/**
 * Resolve the map against the file as it is NOW.
 * @returns entries with live {start,end} where still found, `stale:true` where not.
 */
export function resolveMap(file, raw) {
  const map = readMap(file);
  const src = raw ?? (() => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } })();
  const out = [];
  for (const e of map.entries || []) {
    const at = src.indexOf(e.text);
    if (at < 0) { out.push({ ...e, stale: true }); continue; }
    // Ambiguous match: the same sentence appears twice, so a badge cannot be
    // placed with confidence. Report it rather than guessing which one.
    const second = src.indexOf(e.text, at + 1);
    out.push({
      ...e,
      start: at,
      end: at + e.text.length,
      stale: false,
      ambiguous: second >= 0,
    });
  }
  return out;
}

/** Counts for the console: how much of this document came from where. */
export function attributionSummary(file, raw) {
  const entries = resolveMap(file, raw);
  const live = entries.filter((e) => !e.stale);
  const byTrack = {};
  for (const e of live) byTrack[e.track] = (byTrack[e.track] || 0) + 1;
  const chars = live.reduce((a, e) => a + e.text.length, 0);
  return {
    total: entries.length,
    live: live.length,
    stale: entries.length - live.length,
    ambiguous: live.filter((e) => e.ambiguous).length,
    byTrack,
    charsAttributed: chars,
    entries: live.map((e) => ({
      text: e.text.slice(0, 120), track: e.track, color: e.color,
      start: e.start, end: e.end, line: e.line, sha: e.sha, ambiguous: e.ambiguous,
    })),
  };
}

export { TRACK_COLORS, mapPath };
