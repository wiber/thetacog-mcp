// rings.js — `require('intentguard').ringReading` / `require('intentguard/rings')`: C915 THE THREE-RING ENVELOPE FOR A
// DEPLOYED JOB. PLUMBER · ELECTRICIAN · DEMOLISHER, read off the same card lane.js reads (card.pixel, the walked cell a
// placement landed on) plus the action text the harness already tapes, against an envelope the deployer declares. There
// is no default pole: a boundary this file picked would be one nobody drew.
//
//   ringReading({ card, action, envelope })   → { ring, pixel, why?, matched? }
//   ringCounts(rows, envelope)                → { plumber, electrician, demolisher, unmeasured, total } over tape rows
//
// THE ENVELOPE (the deployer's to declare — e.g. a `docs/specs/fleet/<job>.rings.json` sidecar beside the job spec):
//   { pole: [...cells], electrician: [...cells], forbidden: [...substrings] }
//   pole          ring 1, the plumber pole — the job's home cells
//   electrician   ring 2 — allowed, adjacent cells, named
//   forbidden     ring 3's named half — tool/API text patterns that are the demolisher wherever they appear, even
//                 inside the pole's own cell (a forbidden call overrides the cell it landed on)
//
// THE FOUR READINGS:
//   plumber       card.pixel is in envelope.pole, and the action matches no forbidden pattern
//   electrician   card.pixel is in envelope.electrician (not pole), and the action matches no forbidden pattern
//   demolisher    card.pixel is in neither declared ring, OR the action matches a named forbidden pattern
//   unmeasured    the envelope declares no pole (nothing to score against), or the card carries no pixel —
//                 never scored as plumber: an unscored cell is not the same claim as a plumber cell
//
// SUFFICIENT FOR: which of three rings a placed, receipted action's cell and text fall in, against a declared pole.
// NOT SUFFICIENT FOR: whether the action itself was good (Rice), or anything taken outside a placed, receipted action.
'use strict';

const RING = Object.freeze({ PLUMBER: 'plumber', ELECTRICIAN: 'electrician', DEMOLISHER: 'demolisher', UNMEASURED: 'unmeasured' });

/** The card object from a card buffer/string or a receipt (the card is its first line), or a parsed card — mirrors lane.js. */
function cardOf(x) {
  if (x && typeof x === 'object' && !Buffer.isBuffer(x)) return x;
  const first = String(x).split('\n').find((l) => l.trim());
  if (!first) throw new Error('empty card');
  return JSON.parse(first);
}

function envelopeOf(e) {
  const pole = Array.isArray(e && e.pole) ? e.pole : [];
  const electrician = Array.isArray(e && e.electrician) ? e.electrician : [];
  const forbidden = Array.isArray(e && e.forbidden) ? e.forbidden : [];
  return { pole: new Set(pole), electrician: new Set(electrician), forbidden, declared: pole.length > 0 };
}

function ringReading({ card, action = null, envelope } = {}) {
  const env = envelopeOf(envelope);
  if (!env.declared) return { ring: RING.UNMEASURED, pixel: null, why: 'the job declares no pole' };
  const c = cardOf(card);
  const pixel = c.pixel ?? null;
  if (pixel === null) return { ring: RING.UNMEASURED, pixel: null, why: 'the card carries no pixel' };
  const text = action === null || action === undefined ? null : String(action);
  const matched = text === null ? null : (env.forbidden.find((pat) => text.includes(pat)) ?? null);
  if (matched !== null) return { ring: RING.DEMOLISHER, pixel, why: `named forbidden pattern matched`, matched };
  if (env.pole.has(pixel)) return { ring: RING.PLUMBER, pixel };
  if (env.electrician.has(pixel)) return { ring: RING.ELECTRICIAN, pixel };
  return { ring: RING.DEMOLISHER, pixel, why: 'cell outside the declared pole and electrician rings' };
}

/** A tape's rings, over rows shaped { receipt, action }: one ringReading per receipted row, else unmeasured. */
function ringCounts(rows, envelope) {
  const out = { [RING.PLUMBER]: 0, [RING.ELECTRICIAN]: 0, [RING.DEMOLISHER]: 0, [RING.UNMEASURED]: 0, total: 0 };
  for (const r of rows || []) {
    out.total++;
    const receipt = r && typeof r.receipt === 'string' && r.receipt ? r.receipt : null;
    if (!receipt) { out[RING.UNMEASURED]++; continue; }
    let reading;
    try { reading = ringReading({ card: receipt, action: r.action, envelope }); }
    catch { out[RING.UNMEASURED]++; continue; }
    out[reading.ring]++;
  }
  return out;
}

module.exports = { ringReading, ringCounts, cardOf, RING };
