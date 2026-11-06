// scripts/pmu/auditor-attestation.mjs — the AUDITOR-GRADE top-of-email ATTESTATION block +
// the deterministic LANE:IN/OUT verdict, factored out as a PURE module so the guard test
// (tests/pmu/email-auditor-header.test.js) can render + assert ordering fast and deterministically.
//
// WHY (operator 2026-07-01): a compliance/auditor reader needs the DECIDABLE, PROVABLE facts FIRST —
// LANE:IN/OUT/UNPLACED, the lattice placement, sensor:metal, the ed25519 signature, gridHash, binary
// version, the σ placement measurement — and the interpretive narration (qwen "why it drifted") + the
// delegation direction LAST. The top block is PROOF: no risk-price, no defect-prediction, nothing
// probabilistic. LANE is a deterministic function of σ/tolerance vs the threshold + lattice placement,
// NOT a probability. This module owns that ordering contract so it cannot regress.

// ── DETERMINISTIC LANE VERDICT — THREE HONEST STATES: IN · OUT · UNPLACED ─────────────────────────
// Pure, total, deterministic — NOT a probability, NOT a price. Inputs come straight from the walk:
//   unplaced      the unified-drift `unplaced` sentinel (non-blank text, zero lattice placement) → UNPLACED.
//                 We could not PLACE it on the lattice, so we make NO drift claim either way. This is a
//                 DISTINCT third verdict — reporting it as OUT would be a FALSE ALARM (the CATO commit was
//                 actually in-lane), as bad as reporting it as a clean IN would be a blind spot.
//   tolEmpty      reality lit nothing measurable (direction-only) → neither IN nor OUT: 'DIRECTION'
//   placed===false the walk placed nothing measurable on the lattice → OUT
//   tolTooMany    out-of-lane: off-lane % exceeded the tolerance (the 25% threshold) → OUT
// Otherwise a placed commit within tolerance → IN.
export function laneVerdict({ placed = null, unplaced = false, tolTooMany = false, tolEmpty = false } = {}) {
  if (unplaced === true) return 'UNPLACED';   // unified-drift sentinel — off the lattice, no domain claim
  if (tolEmpty === true) return 'DIRECTION';  // reality not yet measurable — honest third state (not a fail)
  if (placed === false) return 'OUT';         // non-empty commit that landed nothing on the lattice
  if (tolTooMany === true) return 'OUT';      // off-lane % over the tolerance threshold
  return 'IN';                                // placed AND within tolerance
}

// The interpretive divider — everything BELOW it is optional narration, explicitly not part of the proof.
export const INTERPRETIVE_LABEL =
  `<div style="max-width:660px;margin:22px auto 12px;padding-top:12px;border-top:1px dashed #2a3552;`
  + `font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#7e8b99;text-align:center">`
  + `&darr; interpretive &middot; optional &mdash; why it drifted (qwen narration) &amp; where its QC is directed. `
  + `NOT part of the attested proof above.</div>`;

// ── THE ATTESTATION BLOCK (decidable facts only) ─────────────────────────────────────────────────
export function renderAttestation({
  lane = 'DIRECTION',
  sigma = null,                 // the σ placement measurement (matchSigma); null if no walk ran
  coord = null, patient = null, domain = '',
  sensorMetal = false, sensorLabel = '',
  sigValid = false, sigHex = '', signer = '',
  gridHash = '', binVersion = '',
  threshold = '25% off-lane', walkNs = null,
} = {}) {
  // Three honest verdicts get three distinct colours: IN green · OUT red · UNPLACED amber (NOT red — an
  // unplaceable commit is not an out-of-lane failure) · DIRECTION grey.
  const laneCol = lane === 'IN' ? '#2ecf6f'
    : lane === 'OUT' ? '#ff3b3b'
    : lane === 'UNPLACED' ? '#d8a24a'
    : '#9aa6b2';
  const laneTxt = lane === 'IN' ? 'IN'
    : lane === 'OUT' ? 'OUT'
    : lane === 'UNPLACED' ? 'UNPLACED <span style="font-size:11px;font-weight:600;color:#8b98a5">(unmapped &mdash; no domain claim)</span>'
    : '&mdash; direction only';
  const ck = '<span style="color:#2ecf6f">&#10003;</span>';   // ✓
  const xk = '<span style="color:#ff3b3b">&#10007;</span>';   // ✗
  const row = (l, v) => `<div style="margin:2px 0"><span style="color:#5f6b78">${l}</span> ${v}</div>`;
  // ── PROVENANCE GATE (operator 2026-07-01) — the verdict's AUTHORITY is gated on where the walk ran ──
  // The central market claim is "recompute the walk yourself." That claim is ONLY honest when the σ/verdict
  // came off the REAL on-chip metal walk (sensor:'metal'). If the walk fell back to the JS gzip-NCD
  // approximation (binary absent / timed out / no seeds), the same LANE letter is NOT silicon-attested — so
  // it must NEVER wear the authoritative "recompute-it-yourself / sensor:metal ✓" dress. We do NOT change the
  // deterministic LANE value (laneVerdict is untouched); we mark its PROVENANCE so a gzip verdict reads as
  // PROVISIONAL and the recompute-authority line is withheld until the metal walk actually ran. Additive,
  // deterministic, flag-free; the metal branch renders byte-identically to before.
  const authoritative = sensorMetal === true;
  const headerLine = authoritative
    ? `<div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#5f6b78;margin-bottom:8px">&#9095; attestation &middot; decidable facts &mdash; recompute-it-yourself, no trust in the sender</div>`
    : `<div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#d8a24a;margin-bottom:8px">&#9095; attestation &middot; PROVISIONAL &mdash; gzip fallback, NOT silicon-attested &middot; the recompute-the-walk authority requires the on-chip metal walk</div>`;
  // On the fallback, qualify the LANE headline itself so a scalar reader can never mistake a JS-approximation
  // verdict for the silicon-attested one. Empty on metal → the metal headline is unchanged.
  const laneSuffix = authoritative
    ? ''
    : ` <span style="font-size:11px;font-weight:600;color:#d8a24a">(provisional &mdash; gzip fallback, not silicon-attested)</span>`;
  // ── THE DECIDABILITY LINE (operator 2026-07-01) — plain-language, right under the LANE headline so it is
  // among the first things any reader (incl. a non-expert) sees. The point that keeps regressing away: this
  // is DECIDABLE. We make PLACEMENT decidable (WHERE the work landed on the lattice — provable + re-runnable,
  // the walk always halts with this verdict); we do NOT make QUALITY decidable (bug-freedom is Rice-
  // undecidable) and we explicitly REFUSE that claim. Both halves are always present so the frame cannot
  // regress to an overclaim. Metal-gated for the "recompute-it-yourself" authority (same gate as the header).
  const decidableLine = authoritative
    ? `<div style="font-size:11.5px;color:#8fb7ff;margin:2px 0 10px;line-height:1.6"><b>&#9989; DECIDABLE:</b> WHERE this work landed is provable &amp; re-runnable &mdash; recompute this LANE verdict yourself. WHETHER it is bug-free is <b>UNDECIDABLE</b> (Rice) &mdash; we do <b>NOT</b> claim that.</div>`
    : `<div style="font-size:11.5px;color:#8fb7ff;margin:2px 0 10px;line-height:1.6"><b>&#9989; DECIDABLE (provisional):</b> WHERE this work landed is provable in principle &amp; re-runnable, but recompute-authority needs the on-chip metal walk (gzip fallback ran). WHETHER it is bug-free is <b>UNDECIDABLE</b> (Rice) &mdash; we do <b>NOT</b> claim that.</div>`;
  return `<div style="max-width:660px;margin:0 auto 18px;padding:14px 16px;background:#070c14;border:1px solid ${laneCol}55;border-left:4px solid ${laneCol};border-radius:8px;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.7;color:#c9d1d9">`
    + headerLine
    + `<div style="font-size:20px;font-weight:800;letter-spacing:.04em;color:${laneCol};margin-bottom:6px">LANE: ${laneTxt}${laneSuffix}</div>`
    + `<div style="font-size:10px;color:#5f6b78;margin:-2px 0 10px">deterministic &mdash; &sigma; / tolerance vs the ${threshold} threshold + lattice placement; NOT a probability, NOT a risk-price</div>`
    + decidableLine
    + row('placement:', coord ? `<b style="color:#ff8ad8">${coord}</b>${patient ? ` &rarr; <b style="color:#ff8ad8">${patient}</b>` : ''}${domain ? ` &middot; <span style="color:#8b98a5">${domain}</span>` : ''}` : '<span style="color:#7e8b99">unplaced &mdash; text did not land on the lattice</span>')
    + row('&sigma; (placement measurement):', sigma == null ? '<span style="color:#7e8b99">&mdash; no walk (unplaced / churn)</span>' : `<b style="color:#c9d1d9">${sigma}</b> <span style="color:#5f6b78">shape-match &sigma;</span>`)
    + row('sensor:', sensorMetal ? `metal ${ck}${sensorLabel ? ` <span style="color:#7e8b99">${sensorLabel}</span>` : ''}` : `metal ${xk} <span style="color:#7e8b99">attestation unavailable</span>`)
    + row('ed25519 signature:', sigValid ? `valid ${ck}${sigHex ? ` <span style="color:#7e8b99">${sigHex}&hellip;${signer ? ` &middot; signer ${signer}&hellip;` : ''}</span>` : ''}` : `${xk} <span style="color:#7e8b99">unsigned</span>`)
    + row('gridHash:', gridHash ? `<b style="color:#c9d1d9">${gridHash}</b> <span style="color:#5f6b78">(reef the &sigma; was measured against)</span>` : '&mdash;')
    + row('binary:', binVersion ? `<b style="color:#c9d1d9">${binVersion}&hellip;</b> <span style="color:#5f6b78">daemon sha256${walkNs ? ` &middot; ${walkNs}ns/walk` : ''}</span>` : '&mdash;')
    + `</div>`;
}

// ── THE ORDERING CONTRACT ────────────────────────────────────────────────────────────────────────
// HEADLINE (the encircled COMPETENCE SHAPE — the highest-signal PICTURE) leads → PROOF (attestation) →
// telemetry/calibration → the maps → interpretive narration last.
// WHY the headline leads (operator 2026-07-01, with the screenshot): the encircled density-zone panel is
// "the first picture you see; then LANE:OUT etc. comes after." The auditor reorder had demoted it into
// `narration` (LAST) — in a ~200KB email that pushed it past Gmail's ~102KB clip, so the shape vanished
// from the received mail. Leading with it restores the original design (it was always meant to be the
// FIRST image, before the bearer metrics) AND keeps it above the clip. Additive: `headline` defaults to
// '' so every existing caller is byte-identical until it passes one.
export function assembleAuditorBody({ headline = '', attestation = '', telemetry = '', maps = '', narration = '' } = {}) {
  return `${headline}${attestation}${telemetry}${maps}${narration ? INTERPRETIVE_LABEL + narration : ''}`;
}
