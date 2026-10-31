// packages/thetacog-mcp/scripts/tape/stage-fingerprint.mjs — R1b: THE STAGE FINGERPRINT.
//
// ┌─ WHY (operator, verbatim) ──────────────────────────────────────────────────────────────────┐
// │ "Stage Fingerprint Diff Rail (R1b): The multi-stage hash diff (walk → sensor → classified → │
// │  regions → raster) needs to sit under the panel to instantly show the operator WHICH stage  │
// │  drifted when a commit lands off-lane."                                                     │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Today a wrong-looking panel has two indistinguishable explanations — the DISPLAY broke or the
// CORPUS is junk — and picking wrong costs hours (it did, repeatedly, this session). The
// canonical-panel litmus test proves the display path; THIS file answers the other half: which
// STAGE of the pipeline moved between two runs. The diff against the previous run — specifically
// the FIRST stage whose hash changed — is the product. Everything downstream of that stage changed
// *because* it did; colouring four innocent stages red would un-localize the very thing this
// exists to localize.
//
// ── NOTHING IS REIMPLEMENTED — every stage value is what the RUNNING pipeline already produces ──
//   walk        heat  scripts/pmu/tolerance-panel.mjs::runPanelPipeline → r.stages.walk heatmaps
//   sensor      scores packages/thetacog-mcp/src/lib/pmu/unified-drift.mjs::litScores (the sensor)
//   classified  buffer scripts/pmu/tolerance-panel.mjs::composeTolerancePanel → tolerance rgba+counts
//   regions     set    scripts/pmu/panel-door.mjs::panel() → regions (THE ONE DOOR's normalized shape)
//   raster      bytes  scripts/pmu/panel-door.mjs::panel() → png
// Stages 1–3 come from one composeTolerancePanel invocation; stages 4–5 from one panel() door call
// on the SAME input. Two invocations of the same deterministic pipeline are interchangeable by the
// determinism guard (tests/tape/stage-fingerprint-localizes.test.mjs asserts identical input →
// identical hashes at every stage) — if that ever stops holding, the guard goes red before this
// composition can lie. The door itself is used for the final two stages precisely so no new direct
// caller of the renderer internals is born (tests/pmu/one-panel-door.test.mjs).
//
// The stage ORDER is the operator's declared order, verbatim. sensor scores causally seed the walk
// inside the pipeline, but both derive directly from the input texts; the rail's order is the
// operator's reading order, not a causality re-derivation.
//
// ── CANONICAL SERIALISATION — a hash that varies run-to-run on identical input is worthless ────
// sha256 over: sorted object keys, numbers at fixed precision (9 significant digits), raw byte
// surfaces (heatmaps/rgba/png) hashed as bytes. NOTHING time-derived (ms, timestamps) is ever
// hashed. The guard carries a negative control: a naive insertion-order serialiser must FAIL the
// determinism property the canonical one passes.
//
// ── THE LEDGER ────────────────────────────────────────────────────────────────────────────────
// .thetacog/tape-sessions/<slug>/fingerprints.ndjson — append-only. Fingerprint rows AND
// reroll-request rows (the red stage's button records the operator's intent to re-run a bounded
// adaptive round scoped to that stage — scripts/pmu/intervene.mjs is the aimed round; the actual
// subagent dispatch is NOT wired yet, and every consumer says so rather than pretending).
//
// A first run reports "no baseline" with a reason — NEVER "all green". A first run that claims
// everything matches is a lie: there is nothing for it to have matched.
//
//   node packages/thetacog-mcp/scripts/tape/stage-fingerprint.mjs <slug> [--json] [--scale N]
//   node packages/thetacog-mcp/scripts/tape/stage-fingerprint.mjs <slug> --read [--json]
//   node packages/thetacog-mcp/scripts/tape/stage-fingerprint.mjs <slug> --reroll <stage> [--json]

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');

// ── the five stages, in the operator's declared order ─────────────────────────────────────────
export const STAGES = ['walk', 'sensor', 'classified', 'regions', 'raster'];
export const STAGE_NOTES = {
  walk: 'on-chip ballistic walk heat (intent + reality heatmaps, pipeline walk stage)',
  sensor: 'gzip-NCD lit scores against the 144-anchor sensor (litScores, unified-drift.mjs)',
  classified: 'tolerance-classified rgba buffer + green/amber/red counts + domBlocks',
  regions: 'detected region set (coords, ShortLex names, operator-message slices)',
  raster: 'encircled PNG bytes (ring-burn at scale)',
};

// ── canonical serialisation ───────────────────────────────────────────────────────────────────
// Sorted keys, fixed float precision, stable across insertion order. Buffers/TypedArrays are
// hashed as raw bytes by the caller (never JSON-walked — a 20736-float heatmap through JSON is
// slow AND precision-fragile).
const numCanon = (n) => {
  if (!Number.isFinite(n)) return String(n);            // null-safe: NaN/Infinity as literals
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 50) return String(n);
  return n.toPrecision(9);
};
export function canonicalSerialize(v) {
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'number') return numCanon(v);
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return '[' + Array.from(v, canonicalSerialize).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalSerialize(v[k])).join(',') + '}';
  }
  return JSON.stringify(String(v));
}
export const sha256 = (x) => createHash('sha256').update(Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8')).digest('hex');
export const hashStage = (value) => sha256(canonicalSerialize(value));
const bytesOf = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x?.buffer ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : x || []));

// ── ledger ────────────────────────────────────────────────────────────────────────────────────
export const sessionsDirDefault = () => process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');
export const ledgerPath = (slug, sessionsDir = sessionsDirDefault()) => resolve(sessionsDir, slug, 'fingerprints.ndjson');

export function readLedger(slug, sessionsDir = sessionsDirDefault()) {
  const p = ledgerPath(slug, sessionsDir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export function appendRow(slug, row, sessionsDir = sessionsDirDefault()) {
  const p = ledgerPath(slug, sessionsDir);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(row) + '\n');
  return p;
}

// ── compute — drive the running pipeline, hash what it already produces ───────────────────────
export async function computeStageHashes({ intent, reality, message = null, axesPath = undefined, scale = undefined } = {}) {
  if (!intent || !reality) return { ok: false, unmeasured: 'intent/reality text required — a fingerprint of nothing localizes nothing' };
  const t0 = Date.now();

  // heavy imports stay INSIDE the function: the cockpit route never imports this module into
  // Vite's SSR graph (house rule, $lib/struts/panel.js header), but keeping top-level imports to
  // node builtins means even an accidental import cannot drag the engine into a bundler.
  const TP = await import(resolve(REPO, 'scripts/pmu/tolerance-panel.mjs'));
  const UD = await import(resolve(PKG, 'src/lib/pmu/unified-drift.mjs'));
  const { panel } = await import(resolve(REPO, 'scripts/pmu/panel-door.mjs'));

  // stage 2 · SENSOR — litScores IS the sensor (the task's own words). Direct function of the texts.
  const sensorScores = { intent: UD.litScores(String(intent)), reality: UD.litScores(String(reality)) };

  // stages 1+3 · WALK + CLASSIFIED — one composeTolerancePanel invocation carries both boundaries.
  let tol;
  try {
    tol = await TP.composeTolerancePanel({ intentText: String(intent), realityText: String(reality), label: 'fingerprint', sub: '', axesPath });
  } catch (e) {
    return { ok: false, unmeasured: `tolerance pipeline threw: ${String(e?.message || e).slice(0, 200)}` };
  }
  const w = tol.w || {};
  if (!w.intent_heatmap_b64 || !w.reality_heatmap_b64) {
    return { ok: false, unmeasured: 'pipeline produced no walk heatmaps — nothing downstream is a real reading' };
  }

  // stages 4+5 · REGIONS + RASTER — THE ONE DOOR, same input. Interchangeable with the run above
  // by the determinism guard; the door is used here so no new direct renderer caller is born.
  const doorArgs = { intent: String(intent), reality: String(reality), label: 'fingerprint', sub: 'stage-fingerprint' };
  if (message != null) doorArgs.message = String(message);
  if (axesPath != null) doorArgs.axesPath = axesPath;
  if (scale !== undefined) doorArgs.scale = scale;
  const p = await panel(doorArgs);
  if (p.unmeasured || !p.png) return { ok: false, unmeasured: p.unmeasured || 'door returned no png' };

  const stages = {
    walk: {
      hash: hashStage({ intent: sha256(Buffer.from(w.intent_heatmap_b64, 'base64')), reality: sha256(Buffer.from(w.reality_heatmap_b64, 'base64')) }),
      note: STAGE_NOTES.walk,
    },
    sensor: { hash: hashStage(sensorScores), note: STAGE_NOTES.sensor },
    classified: {
      hash: hashStage({
        rgba: sha256(bytesOf(tol.rgba)),
        green: tol.meta?.green ?? null, amber: tol.meta?.amber ?? null, red: tol.meta?.red ?? null,
        offPct: tol.meta?.offPct ?? null, domBlocks: tol.domBlocks || [],
      }),
      note: STAGE_NOTES.classified,
    },
    regions: {
      // project to the door's promised shape only — incidental field additions on region objects
      // must not read as "the region stage drifted".
      hash: hashStage((p.regions || []).map((r) => ({
        kind: r.kind ?? null, name: r.name ?? null, center: r.center ?? null, span: r.span ?? null,
        slices: (r.slices || []).map((s) => ({ clause: String(s.clause || ''), coord: s.coord ?? null, sigma: s.sigma ?? null })),
      }))),
      note: STAGE_NOTES.regions,
    },
    raster: { hash: sha256(bytesOf(p.png)), note: STAGE_NOTES.raster },
  };

  return {
    ok: true,
    stages, order: STAGES,
    inputs: {
      intentSha: sha256(String(intent)), realitySha: sha256(String(reality)),
      intentChars: String(intent).length, realityChars: String(reality).length,
      scale: scale ?? 4, axesPath: axesPath || null,
    },
    meta: {
      offPct: p.meta?.offPct ?? null, green: p.meta?.green ?? null, amber: p.meta?.amber ?? null,
      red: p.meta?.red ?? null, domBlocks: p.meta?.domBlocks || null, engine: p.meta?.engine || null,
    },
    ms: Date.now() - t0,
    unmeasured: null,
  };
}

// ── diff — the FIRST changed stage is the product ─────────────────────────────────────────────
export function diffFingerprints(prev, curr) {
  if (!curr?.stages) return { hasBaseline: false, firstChanged: null, stages: [], reason: 'no current fingerprint to diff — compute one first' };
  const order = curr.order || STAGES;
  if (!prev?.stages) {
    return {
      hasBaseline: false, firstChanged: null,
      reason: 'no baseline — this is the first fingerprint in the ledger for this slug; there is no previous run to diff against, so no stage can honestly be called unchanged',
      stages: order.map((n) => ({ name: n, status: 'no-baseline', prevHash: null, currHash: curr.stages[n]?.hash || null })),
      inputChanged: null,
    };
  }
  let firstChanged = null;
  const stages = order.map((n) => {
    const a = prev.stages[n]?.hash || null, b = curr.stages[n]?.hash || null;
    const changed = a !== b;
    if (changed && !firstChanged) firstChanged = n;
    let status;
    if (!changed) status = 'unchanged';
    else if (n === firstChanged) status = 'first-changed';
    else status = `downstream of ${firstChanged}`;
    return { name: n, status, prevHash: a, currHash: b };
  });
  const inputChanged = prev.inputs && curr.inputs
    ? (prev.inputs.intentSha !== curr.inputs.intentSha || prev.inputs.realitySha !== curr.inputs.realitySha)
    : null;
  return {
    hasBaseline: true, firstChanged, stages, inputChanged,
    reason: firstChanged
      ? (inputChanged
        ? `first changed stage: ${firstChanged} — the input texts themselves changed, so movement is explained by input, not necessarily by a pipeline change`
        : `first changed stage: ${firstChanged} — inputs identical, so the PIPELINE moved at this stage`)
      : 'all five stages match the previous run',
  };
}

// ── the latest fingerprint + its diff, off the ledger (what the API serves) ───────────────────
export function latestWithDiff(slug, sessionsDir = sessionsDirDefault()) {
  const rows = readLedger(slug, sessionsDir).filter((r) => r.kind === 'fingerprint');
  if (!rows.length) {
    return { ok: false, slug, latest: null, diff: null, unmeasured: `no fingerprint ledger for '${slug}' — run stage-fingerprint.mjs ${slug} to compute the first one (${ledgerPath(slug, sessionsDir).replace(REPO + '/', '')})` };
  }
  const latest = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  return { ok: true, slug, latest, prev: prev ? { ts: prev.ts, stages: prev.stages } : null, diff: diffFingerprints(prev, latest), unmeasured: null };
}

export function recordRerollRequest(slug, stage, { sessionsDir = sessionsDirDefault(), note = '' } = {}) {
  if (!STAGES.includes(stage)) return { ok: false, unmeasured: `unknown stage '${stage}' — expected one of ${STAGES.join(', ')}` };
  const row = {
    ts: new Date().toISOString(), kind: 'reroll-request', slug, stage,
    note: note || 'operator asked for a bounded adaptive round scoped to this stage (scripts/pmu/intervene.mjs is the aimed round); subagent dispatch NOT yet wired — this row records the intent',
  };
  appendRow(slug, row, sessionsDir);
  return { ok: true, row };
}

// ── compute-and-append for a session (the CLI's default verb) ─────────────────────────────────
export async function fingerprintSession(slug, { sessionsDir = sessionsDirDefault(), scale = undefined } = {}) {
  const { assembleSides } = await import(resolve(HERE, 'project-panel.mjs'));
  const s = assembleSides(slug);
  if (!s.ok) return { ok: false, slug, unmeasured: s.reason };
  if (s.unmeasured) return { ok: false, slug, unmeasured: s.unmeasured };
  const fp = await computeStageHashes({ intent: s.intentText, reality: s.realityText, message: s.intentText, scale });
  if (!fp.ok) return { ok: false, slug, unmeasured: fp.unmeasured };
  const prevRows = readLedger(slug, sessionsDir).filter((r) => r.kind === 'fingerprint');
  const prev = prevRows.length ? prevRows[prevRows.length - 1] : null;
  const row = { ts: new Date().toISOString(), kind: 'fingerprint', slug, ...fp, source: 'project-panel.mjs assembleSides (locked coordinates vs claimed surfaces)' };
  delete row.ok; delete row.unmeasured;
  appendRow(slug, row, sessionsDir);
  return { ok: true, slug, row, diff: diffFingerprints(prev, row) };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  // stdout MUST be blocking before any exit — a --json payload piped through execFile is silently
  // cut at ~8188 bytes otherwise (measured across 10 files in this repo; see project-panel.mjs).
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(f);
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const slug = argv.find((a) => !a.startsWith('--') && a !== val('--reroll', null) && a !== val('--scale', null) && a !== val('--sessions-dir', null)) || 'gddadwill';
  const sessionsDir = val('--sessions-dir', sessionsDirDefault());
  const asJson = flag('--json');
  const out = (r, code) => { console.log(asJson ? JSON.stringify(r, null, 2) : human(r)); process.exit(code); };

  function human(r) {
    if (!r.ok) return `✗ ${r.unmeasured || 'failed'}`;
    const d = r.diff, lines = [`\n  STAGE FINGERPRINT · ${r.slug || slug}`];
    const st = r.row?.stages || r.latest?.stages || {};
    for (const n of STAGES) lines.push(`    ${n.padEnd(11)} ${st[n]?.hash?.slice(0, 16) || '—'}…  ${d ? (d.stages.find((s) => s.name === n)?.status || '') : ''}`);
    if (d) lines.push(`  ${d.hasBaseline ? d.reason : 'NO BASELINE — ' + d.reason}`);
    return lines.join('\n') + '\n';
  }

  const reroll = val('--reroll', null);
  if (reroll) out(recordRerollRequest(slug, reroll, { sessionsDir }), 0);
  else if (flag('--read')) { const r = latestWithDiff(slug, sessionsDir); out(r, r.ok ? 0 : 2); }
  else {
    const scaleRaw = val('--scale', null);
    const r = await fingerprintSession(slug, { sessionsDir, scale: scaleRaw ? Number(scaleRaw) : undefined });
    out(r, r.ok ? 0 : 2);
  }
}
