// packages/thetacog-mcp/scripts/tape/cone-check.mjs — IS THE PANEL A RECEIPT *OF THE SPEC*?
//
// SPEC S7: "The specification is the centre line of the cone. Compute the PNG encircled panels with
// the Rust path and verify they line up with that centre line — the panel should be a receipt OF
// THE SPEC, not a decoration beside it."
//
// ── THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT ───────────────────────────────────────
// ANSWERS: for every locked coordinate that HAS a rendered panel, how far is that coordinate's
// placement from the cone's centre line, and is it inside the cone the rest of the specification
// describes? A panel sitting well outside the cone is a picture of work this specification never
// claimed — which is exactly the difference between a receipt and a decoration.
//
// DOES NOT ANSWER: whether the PIXELS in the PNG encode that placement. This check reads the
// coordinate the panel was rendered FOR, not the panel's own contents. Re-deriving a centre from the
// image would be a SECOND placement of the same thing, and a second answer to "where did this land"
// is the two-doors failure this repo has already paid for twice (the panel selector, and question
// retirement at two thresholds). The panel renderer is the one door; this checks its INPUT against
// the spec, which is the comparison S7 actually asks for.
//
// ── WHY IT REFUSES RATHER THAN REPORTING ALL-CLEAR ───────────────────────────────────────────
// "No panel is outside the cone" and "there are no panels" produce the same green tick and are
// completely different facts. Same discipline as emit-spec.mjs refusing to write an empty SPEC.md:
// a reader who sees a pass cannot tell "everything lines up" from "nothing was checked", and only a
// refusal preserves that distinction. It also refuses on a PROVISIONAL centre — a cone computed
// from too few coordinates has a centre that will move, and measuring against a moving centre
// reports drift that is really just an early sample.
//
// ── THE BOUNDARY IS THE PROJECT'S OWN, NOT ONE INVENTED HERE ─────────────────────────────────
// "inside" is `distance <= cone.width`, and that rule is quoted verbatim from emit-spec.mjs's own
// howToCheckDrift, which every SPEC.md already carries: "Place a candidate rule or commit with the
// same walk, then measure its Chebyshev distance from cone.centre. Beyond cone.width it is outside
// the trade this spec describes." So this check applies the spec's published test to the spec's own
// panels rather than introducing a second threshold — the divergence that bit question retirement
// (0.62 in one route, 0.52 in another, and the wider one would have retired a question on its own
// opposite answer). Note that cone.width is the MEAN king-move distance, so a healthy spec has
// coordinates on both sides of it; a row outside is a finding to read, not automatically a defect.
//
// LLM-FREE by construction: liveCoordinates + cone + a directory listing. No model is in this path
// and none may be added — this is receipt-side, and THE RECEIPT IS LLM-FREE.
//
//   node packages/thetacog-mcp/scripts/tape/cone-check.mjs --slug gddadwill [--json]

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

/**
 * @returns {Promise<{ok:true, centre, centreLabel, width, max, checked, inside, outside, unpaneled}
 *                  | {ok:false, reason:string}>}
 */
export async function coneCheck(slug) {
  const { liveCoordinates, cone, fullLabel } = await import(resolve(HERE, 'coordinates.mjs'));
  const coords = liveCoordinates(slug).filter((c) => c.rule);
  if (!coords.length) return { ok: false, reason: `no locked coordinate for "${slug}" — there is no specification to be the centre line of` };

  const c = cone(coords);
  if (!c.centre) return { ok: false, reason: 'the cone has no centre — no coordinate carries a placement' };
  if (c.provisional) {
    return { ok: false, reason: `the cone centre is PROVISIONAL (${c.n} placed coordinate(s)) — it will move, and measuring a panel against a moving centre reports drift that is really an early sample` };
  }

  const receipts = resolve(SESSIONS, slug, 'html', 'receipts');
  const have = new Set(existsSync(receipts) ? readdirSync(receipts) : []);
  const byId = new Map(c.spread.map((s) => [s.id, s]));

  const checked = [];
  const unpaneled = [];
  for (const co of coords) {
    const s = byId.get(co.id);
    const png = `${co.id}.png`;
    const panel = have.has(png) ? `${resolve(receipts, png).replace(`${REPO}/`, '')}` : null;
    const row = {
      id: co.id,
      coord: co.coord ?? null,
      label: co.coord ? fullLabel(co.coord) : null,
      distance: s?.distance ?? null,
      panel,
    };
    // A COORDINATE WITH NO PANEL IS NOT "INSIDE". It is unmeasured, and counting it as a pass is how
    // a check reports a clean bill of health for work it never looked at.
    if (!panel || row.distance == null) unpaneled.push({ ...row, why: !panel ? 'no rendered panel' : 'no placement' });
    else checked.push({ ...row, inside: row.distance <= c.width });
  }

  if (!checked.length) {
    return { ok: false, reason: `${coords.length} locked coordinate(s) and NOT ONE has both a placement and a rendered panel — nothing could be compared, which is a different fact from everything lining up` };
  }

  const outside = checked.filter((r) => !r.inside).sort((a, b) => b.distance - a.distance);
  return {
    ok: true,
    slug,
    centre: c.centre,
    centreLabel: c.centreLabel,
    width: c.width,
    max: c.max,
    checked: checked.length,
    inside: checked.length - outside.length,
    outside,
    unpaneled,
    // Stated in the payload, not only in this file's header, so a consumer cannot present the result
    // as a stronger claim than it is.
    scope: 'compares each panel\'s COORDINATE against the spec\'s cone centre. It does not decode the PNG — the placement is read from the coordinate the panel was rendered for, because a second derivation of the same placement would be a second answer to "where did this land".',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const r = await coneCheck(arg('--slug', 'gddadwill'));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 2); }
  if (!r.ok) { console.error(`✗ NOT CHECKED — ${r.reason}`); process.exit(2); }
  console.log(`\n  THE CONE · ${r.slug}`);
  console.log(`  centre ${r.centreLabel} · width ${r.width} · max ${r.max}`);
  console.log(`  ${r.inside}/${r.checked} panelled coordinate(s) inside the cone`);
  if (r.outside.length) {
    console.log(`\n  OUTSIDE THE CONE — a panel for work this specification does not claim:`);
    for (const o of r.outside) console.log(`    ${o.id}  ${o.label}  distance ${o.distance} > width ${r.width}  ${o.panel}`);
  }
  if (r.unpaneled.length) console.log(`\n  ${r.unpaneled.length} coordinate(s) NOT checked: ${r.unpaneled.map((u) => `${u.id} (${u.why})`).join(', ')}`);
  console.log('');
}
