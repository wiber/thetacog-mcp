// scripts/vna/iso-config.mjs — C226a COULD HAVE CHECKED: A READ/WRITE DISTANCE IS SCORED ONLY BETWEEN COMPARABLE WALKS.
// The iso-geometric win condition (C226) is that retrieval and placement are one shape match. A distance between a write-side
// walk (the fold's basin pixel for the row) and the landed walk (the one Rust walk's placement of the work commit) only means
// that if both walks are the same instrument: each admissible under its OWN null (a refused walk's pixel is a guess the walk
// declined to vouch for), on the same axes (axes_sha — the targets file the lattice is built from), at the same aperture
// (aperture_id — cap · bulk · digest · depth, walk-door.mjs). Measured 2026-09-23: the fold's basin walk stamps axes_sha but
// no aperture_id, the commit walk is t12000b0hk8, and both of C225's walks read admissible:false — so every l1_write_to_landed
// on the ledger compared two different apertures. Every knob here is already stamped on the rows, which is why a mismatch is
// "could have checked": it is decidable before any number is read. Pure function, LLM-free, no I/O.
// Port row: this DECIDES, so its home is the crate once C226b stops moving the knobs (MAXIMISE RUST; C226c names it).

// a walk stamp: { admissible, axes_sha, aperture_id } — any missing field is a mismatch that names the side that lacks it
export function walkStamp(w) {
  if (!w || typeof w !== 'object') return null;
  return { admissible: w.admissible === true, axes_sha: w.axes_sha || null, aperture_id: w.aperture_id || null };
}

/** isoComparable(write, landed) → { ok, mismatch: [{ knob, write, landed }] }. ok only when nothing mismatches. */
export function isoComparable(write, landed) {
  const w = walkStamp(write), l = walkStamp(landed); const mismatch = [];
  if (!w || !l) return { ok: false, mismatch: [{ knob: 'stamp', write: w ? 'present' : null, landed: l ? 'present' : null }] };
  if (!w.admissible || !l.admissible) mismatch.push({ knob: 'admissible', write: w.admissible, landed: l.admissible });
  if (!w.axes_sha || !l.axes_sha || w.axes_sha !== l.axes_sha) mismatch.push({ knob: 'axes_sha', write: w.axes_sha, landed: l.axes_sha });
  if (!w.aperture_id || !l.aperture_id || w.aperture_id !== l.aperture_id) mismatch.push({ knob: 'aperture_id', write: w.aperture_id, landed: l.aperture_id });
  return { ok: mismatch.length === 0, mismatch };
}

// one sentence for a ledger row's *_why — the knobs, both values, never a paraphrase
export function mismatchWhy(mismatch) {
  return (mismatch || []).map((m) => `${m.knob} ${m.write ?? '∅'} ≠ ${m.landed ?? '∅'}`).join(' · ');
}
