// src/lib/pmu/signal-schema.mjs — THE PUBLISHED / LICENSABLE SIGNAL (the asset, not a debug dump).
// =============================================================================================
// The directive-lens runs a REAL on-chip ballistic walk per prompt (src/lib/pmu/unified-drift.mjs
// walkShape) and the commit gate runs the SAME walk. This module turns that trace into the artifact a
// reinsurer / options-writer pays to LICENSE — the per-turn twin of the commit/email receipt page. The
// frame-by-frame "video" of competence is the time-ordered stream of these signals (ref = the frame
// anchor). For the trace to be an ASSET it must be:
//   · AUDITABLE   — meaning-bearing lane, signed (tamper-evident), re-runnable hardware provenance.
//   · LICENSABLE  — auditable PLUS a calibration (breach rate · premium · sample N) you can price.
//
// A signal that LIES cannot be published: validateSignal() independently recomputes the sensible-metrics
// gate (verdict vs sigma-vs-threshold) and rejects an inconsistent metric EVEN WHEN the signature is
// genuine. It rejects a forged body (sig doesn't verify), a metal claim with no re-run anchor, and a
// missing-provenance debug dump. Dependency-free: node builtins only (ed25519 + sha256 from node:crypto).
//
// @canonical  the signal is the licensable asset · validateSignal is the door · the id is a content-hash
// @guard  tests/lens/published-signal.test.js

import {
  createHash, sign as edSign, verify as edVerify,
  createPrivateKey, createPublicKey,
} from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

export const VERDICTS = ['In-Lane', 'Drift'];
export const SENSORS = ['metal', 'gzip-fallback'];
export const RISK_KINDS = ['placement', 'coverage'];

// ── canonical serialization = stable (recursively sorted) key order. The hash AND the signature are both
// taken over this string so id/sig are byte-stable on recompute regardless of construction key order. ──
export function canonicalize(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
}

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x));

// deterministic content id = sha256 over the canonical PROVENANCE (same walk → same id; never a uuid).
export function contentId(provenance) {
  return 'sig_' + sha256hex(canonicalize(provenance)).slice(0, 32);
}

const toPriv = (k) => (typeof k === 'string' ? createPrivateKey(k) : k);
const toPub = (k) => (typeof k === 'string' ? createPublicKey(k) : k);

// everything that is SIGNED — the signal minus its own attestation.
export function extractBody(sig) {
  const { attestation, ...body } = sig;
  return body;
}

// ed25519 attestation over canonicalize(body). pubkey travels as SPKI PEM so a verifier needs nothing
// but node builtins. Real deployments pass a keystore PEM as signer.privateKey; tests pass a KeyObject.
export function attest(body, signer) {
  const priv = toPriv(signer.privateKey);
  const pub = toPub(signer.publicKey);
  const msg = Buffer.from(canonicalize(body), 'utf8');
  const sig = edSign(null, msg, priv).toString('base64');
  const pubkey = pub.export({ type: 'spki', format: 'pem' }).toString();
  return { alg: 'ed25519', pubkey, sig };
}

// re-runnable hardware proof. binary {path,mtimeOrVersion} + gridHash are the anchors a verifier needs to
// re-run the SAME walk on the SAME chip against the SAME lattice. metal MUST carry both (enforced below).
function buildProvenance(walk) {
  return {
    sensor: walk.sensor,
    plies: num(walk.plies),
    cells: num(walk.cells),
    fill: num(walk.fillPct !== undefined ? walk.fillPct : walk.fill),
    walksPerSec: num(walk.walksPerSec),
    seed: Array.isArray(walk.seed) ? walk.seed : [],
    seedCoords: Array.isArray(walk.seedCoords) ? walk.seedCoords : [],
    binary: binaryInfo(walk),
    gridHash: walk.gridHash || null,
  };
}

function binaryInfo(walk) {
  if (walk.binary) return walk.binary;
  const p = walk.binaryPath || process.env.PMU_BINARY || null;
  if (p && existsSync(p)) { const st = statSync(p); return { path: p, mtimeOrVersion: st.mtimeMs }; }
  return null;
}

// the sensible-metrics gate, computed at BUILD time and STAMPED into the signal. validateSignal recomputes
// it independently (it never trusts this flag for the verdict check) — the stamp is the self-report, the
// recompute is the audit. Both must agree or the signal is rejected.
function computeIntegrity({ risk, threshold, provenance }) {
  const checks = [];
  const verdictConsistent = risk.sigma > threshold ? risk.verdict === 'Drift' : risk.verdict === 'In-Lane';
  checks.push({ name: 'verdict-matches-sigma-vs-threshold', pass: verdictConsistent });
  const metalAnchored = provenance.sensor !== 'metal' || (!!provenance.binary && !!provenance.gridHash);
  checks.push({ name: 'metal-has-rerun-anchor', pass: metalAnchored });
  return { sensibleMetrics: checks.every((c) => c.pass) ? 'pass' : 'fail', checks };
}

function normCalibration(c) {
  return { breachRate: num(c.breachRate), premium: num(c.premium), sampleN: num(c.sampleN) };
}

// the five AI Greeks (greeks.mjs). Each rides as { value:number|null, note:string } — value is the
// measured number (or null when the running source had no data), note is its provenance/reason. Δ (delta)
// is the bounded weighted-bleed [0,1]; the rest are unbounded finite numbers. normGreeks preserves an
// honest null and coerces a present value to a real number so the canonical hash/signature is byte-stable.
export const GREEK_KEYS = ['delta', 'deltaSpread', 'gamma', 'vega', 'theta'];
function normGreek(g) {
  if (!g || typeof g !== 'object') return { value: null, note: 'malformed-greek' };
  const note = typeof g.note === 'string' ? g.note : '';
  if (g.value === null || g.value === undefined) return { value: null, note };
  return { value: num(g.value), note };
}
function normGreeks(gr) {
  const out = {};
  for (const k of GREEK_KEYS) out[k] = normGreek(gr[k]);
  return out;
}

// ── buildSignal — assemble + content-hash + sign. verdict is COMPUTED from sigma-vs-threshold so a signal
// minted here is honest by construction; the LIE only enters if a caller tampers the verdict (and then
// validateSignal catches it). ──
export function buildSignal({ walk, lane, ref, ts, signer, calibration, greeks }) {
  const provenance = buildProvenance(walk);
  const sigma = num(walk.sigma);
  const threshold = num(lane.threshold);
  const risk = {
    sigma,
    verdict: sigma > threshold ? 'Drift' : 'In-Lane',
    kind: walk.kind || 'placement',
  };
  const integrity = computeIntegrity({ risk, threshold, provenance });
  const id = contentId(provenance);
  const body = {
    id, ts, ref,
    lane: { domain: lane.domain, coord: lane.coord, threshold },
    risk, provenance, integrity,
  };
  // ── the AI GREEKS — the priced risk-sensitivities (greeks.mjs). OPTIONAL and ADDITIVE: a signal with
  // greeks + calibration = the full priced instrument; a Greek the source couldn't measure rides as
  // {value:null, note:<reason>} (honest, never fabricated). Signed as part of the body. ──────────────
  if (greeks) body.greeks = normGreeks(greeks);
  if (calibration) body.calibration = normCalibration(calibration);
  const attestation = attest(body, signer);
  return { ...body, attestation };
}

// ── validateSignal — THE DOOR. Returns {valid:true, tier:'licensable'|'auditable'} or {valid:false,errors}.
// A signal must clear EVERY check; a lying or forged or un-anchored signal cannot be published. ──
export function validateSignal(sig) {
  const errors = [];
  const E = (m) => errors.push(m);
  if (!sig || typeof sig !== 'object') return { valid: false, errors: ['not-an-object'] };

  // top-level presence (provenance + attestation + integrity are non-negotiable — auditable floor)
  for (const f of ['id', 'ts', 'ref', 'lane', 'risk', 'provenance', 'attestation', 'integrity']) {
    if (sig[f] === undefined || sig[f] === null) E(`missing:${f}`);
  }

  // lane — meaning-bearing
  if (sig.lane) {
    for (const f of ['domain', 'coord', 'threshold']) if (sig.lane[f] === undefined || sig.lane[f] === null) E(`missing:lane.${f}`);
    if (sig.lane.threshold !== undefined && typeof sig.lane.threshold !== 'number') E('lane.threshold-not-number');
  }

  // risk
  if (sig.risk) {
    if (typeof sig.risk.sigma !== 'number') E('risk.sigma-not-number');
    if (!VERDICTS.includes(sig.risk.verdict)) E('risk.verdict-invalid');
    if (!RISK_KINDS.includes(sig.risk.kind)) E('risk.kind-invalid');
  }

  // provenance — the re-runnable hardware proof; metal REQUIRES the re-run anchor
  const p = sig.provenance;
  if (p) {
    if (!SENSORS.includes(p.sensor)) E('provenance.sensor-invalid');
    for (const f of ['plies', 'cells', 'fill', 'walksPerSec']) if (typeof p[f] !== 'number') E(`provenance.${f}-not-number`);
    if (!Array.isArray(p.seed)) E('provenance.seed-not-array');
    if (!Array.isArray(p.seedCoords)) E('provenance.seedCoords-not-array');
    if (p.sensor === 'metal') {
      if (!p.binary || !p.binary.path) E('metal-without-binary-anchor');
      if (!p.gridHash) E('metal-without-gridHash-anchor');
    }
  }

  // ts — a real ISO instant
  if (sig.ts && (typeof sig.ts !== 'string' || Number.isNaN(Date.parse(sig.ts)))) E('ts-not-iso');

  // id — bound to the provenance content-hash (not a random uuid, and can't be swapped)
  if (p && sig.id && sig.id !== contentId(p)) E('id-not-content-hash-of-provenance');

  // attestation envelope
  const a = sig.attestation;
  if (a) {
    if (a.alg !== 'ed25519') E('attestation.alg-not-ed25519');
    if (!a.pubkey) E('attestation.pubkey-missing');
    if (!a.sig) E('attestation.sig-missing');
  }

  // SENSIBLE-METRICS gate, recomputed independently: a signal whose verdict lies about its own sigma vs
  // its lane threshold cannot be published — EVEN with a genuine signature. This ties the metric honesty
  // INTO the signal, not into a separate report.
  if (sig.risk && sig.lane && typeof sig.lane.threshold === 'number' && typeof sig.risk.sigma === 'number') {
    const consistent = sig.risk.sigma > sig.lane.threshold ? sig.risk.verdict === 'Drift' : sig.risk.verdict === 'In-Lane';
    if (!consistent) E('risk.verdict-inconsistent-with-sigma-vs-threshold');
  }

  // the stamped integrity self-report
  if (sig.integrity) {
    if (sig.integrity.sensibleMetrics === 'fail') E('integrity.sensibleMetrics-fail');
    if (!Array.isArray(sig.integrity.checks)) E('integrity.checks-not-array');
  }

  // TAMPER-EVIDENCE: verify the signature over the canonical body. Any altered byte → no verify → reject.
  if (a && a.pubkey && a.sig) {
    try {
      const ok = edVerify(null, Buffer.from(canonicalize(extractBody(sig)), 'utf8'), createPublicKey(a.pubkey), Buffer.from(a.sig, 'base64'));
      if (!ok) E('attestation-signature-does-not-verify');
    } catch (e) {
      E('attestation-verify-error:' + (e && e.message ? e.message : String(e)));
    }
  }

  // GREEKS — OPTIONAL. When present, each of the five keys must ride as { value:number|null, note }.
  // A present value must be FINITE (delta additionally bounded [0,1]); a null value must carry a non-empty
  // reason (the honest "no data" — never a silent/fabricated Greek). A malformed greeks block is rejected.
  if (sig.greeks !== undefined && sig.greeks !== null) {
    if (typeof sig.greeks !== 'object' || Array.isArray(sig.greeks)) E('greeks-not-object');
    else for (const k of GREEK_KEYS) {
      const g = sig.greeks[k];
      if (g === undefined || g === null) { E(`missing:greeks.${k}`); continue; }
      if (typeof g !== 'object' || !('value' in g)) { E(`greeks.${k}-malformed`); continue; }
      if (g.value === null) {
        if (typeof g.note !== 'string' || !g.note.trim()) E(`greeks.${k}-null-without-reason`);
      } else if (typeof g.value !== 'number' || !Number.isFinite(g.value)) {
        E(`greeks.${k}-value-not-finite`);
      } else if (k === 'delta' && (g.value < 0 || g.value > 1)) {
        E('greeks.delta-out-of-[0,1]');
      }
    }
  }

  // tier: calibration present + complete → LICENSABLE; absent → AUDITABLE; present-but-broken → invalid.
  let tier = 'auditable';
  if (sig.calibration !== undefined && sig.calibration !== null) {
    const c = sig.calibration;
    const calOk = c && typeof c.breachRate === 'number' && typeof c.premium === 'number'
      && Number.isInteger(c.sampleN) && c.sampleN > 0;
    if (!calOk) E('calibration-incomplete'); else tier = 'licensable';
  }

  if (errors.length) return { valid: false, errors };
  return { valid: true, tier };
}
