// scripts/rewrite/models.mjs — THE MODEL ROSTER. One list of who can be asked, used by every surface.
//
// WHY A ROSTER AND NOT A DROPDOWN PER SURFACE (operator 2026-08-12: "a button for each llm type…
// subagent opus, fable, qwen, sonnet or whatever is available"). The console, the packaged UI and the
// CLI must offer the SAME set, or an A/B across models is comparing surfaces rather than models. The
// roster is discovered, never hardcoded-optimistic: a local model appears because ollama reports it,
// a cloud model appears because the claude CLI answered. Anything unavailable is returned with
// available:false and a reason, so the UI can grey it out instead of failing on click.
//
// The four A/B tracks (A local · B local+Tesseract · C cloud · D cloud+Tesseract) are orthogonal to
// this: the roster says WHO writes, the track says what context they get.

import { health, local, cloud, LOCAL_MODEL, CLOUD_MODEL } from './llm.mjs';

// The cloud aliases the claude CLI accepts. Probed once per process, not per keystroke.
const CLOUD_CANDIDATES = [
  { id: 'opus', label: 'Opus', model: 'opus', note: 'deepest, slowest' },
  { id: 'sonnet', label: 'Sonnet', model: 'sonnet', note: 'the default working model' },
  { id: 'fable', label: 'Fable', model: 'fable', note: 'prose-weighted' },
  { id: 'haiku', label: 'Haiku', model: 'haiku', note: 'fast, cheap' },
];

let _cache = null, _cacheAt = 0;
const TTL = 60_000;

/**
 * The available models, local first (they cost nothing and run offline).
 * @returns {Promise<Array<{id,label,engine,model,available,note,reason}>>}
 */
export async function roster({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cacheAt < TTL) return _cache;
  const h = await health();

  // Embedding models answer /api/tags like any other, and generate nothing. Offering one as a rewrite
  // button is a button that always fails — filter by the name conventions ollama actually uses.
  const isEmbedding = (m) => /embed|bge-|e5-|gte-/i.test(m);

  const localModels = (h.local?.models || []).filter((m) => !isEmbedding(m)).map((m) => ({
    id: `local:${m}`,
    label: m.replace(/:latest$/, ''),
    engine: 'local',
    model: m,
    available: !!h.local?.ok,
    note: m === LOCAL_MODEL ? 'the A/B local arm' : 'local via ollama',
    reason: h.local?.ok ? null : h.local?.error || 'ollama unreachable',
  }));

  // AVAILABILITY IS LEARNED, NOT PROBED (2026-08-12). The first version probed every alias on each
  // roster load: four headless `claude -p` spawns per page open, ~$0.12 of Opus each, and under the
  // interactive lane they timed each other out — a health check that makes the thing it checks look
  // broken. So the roster reports what the CLI says, and then DEMOTES a model the moment a real call
  // to it fails, with that failure as the tooltip. Fable's "You've reached your Fable 5 limit" greys
  // the button out after one press instead of before any, and costs nothing to discover.
  const cloudModels = CLOUD_CANDIDATES.map((c) => {
    const id = `cloud:${c.id}`;
    const last = lastOutcome(id);
    const base = { id, label: c.label, engine: 'cloud', model: c.model,
      note: c.model === CLOUD_MODEL ? `${c.note} · the A/B cloud arm` : c.note };
    if (!h.cloud?.ok) return { ...base, available: false, reason: h.cloud?.error || 'claude CLI unavailable' };
    if (last && last.hard && Date.now() - last.ts < HARD_FAIL_TTL) return { ...base, available: false, reason: last.error };
    return { ...base, available: true, reason: null, lastError: last?.error || null };
  });

  _cache = [...localModels, ...cloudModels];
  _cacheAt = Date.now();
  return _cache;
}

// PER-MODEL CEILINGS. One 180s number for every cloud model was wrong in both directions: it killed
// Opus mid-answer on a full-context prompt (measured: 28.7s of API time, but 180s+ of wall once the
// machine was also filling the buffer) while giving Haiku three minutes it never needs. A ceiling
// should be a backstop against a hung process, not a bet on how long thinking takes.
const TIMEOUT_BY_MODEL = { opus: 420_000, sonnet: 300_000, fable: 300_000, haiku: 180_000 };
const LOCAL_TIMEOUT_MS = 120_000;

export function timeoutFor(id) {
  const [engine, ...rest] = String(id || '').split(':');
  const model = rest.join(':');
  if (engine === 'local') return LOCAL_TIMEOUT_MS;
  return TIMEOUT_BY_MODEL[model] || 240_000;
}

// ── OUTCOME MEMORY ────────────────────────────────────────────────────────────
// Every model call's fate, per model: what it cost in wall time and how it ended. Two jobs — it is
// what demotes a broken button above, and it is the raw material for the subagent timeout/failure
// rate in the metrics strip. A HARD failure is one that will not fix itself on retry (a credit limit,
// a logged-out CLI, an unknown model); a timeout is soft, because the next machine-quiet moment may
// well answer.
const OUTCOMES = new Map();          // id → [{ts, ok, ms, error, hard}] most recent last
const HARD_FAIL_TTL = 10 * 60_000;   // re-offer a hard-failed model after ten minutes
const KEEP = 50;

const isHard = (err) => /limit|not logged in|credit|quota|unknown model|invalid model|unauthor/i.test(String(err || ''));

export function noteOutcome(id, { ok, ms, error }) {
  const row = { ts: Date.now(), ok: !!ok, ms: ms ?? null, error: ok ? null : String(error || 'failed').slice(0, 160), hard: !ok && isHard(error) };
  const arr = OUTCOMES.get(id) || [];
  arr.push(row);
  OUTCOMES.set(id, arr.slice(-KEEP));
  return row;
}

export function lastOutcome(id) {
  const arr = OUTCOMES.get(id);
  return arr && arr.length ? arr[arr.length - 1] : null;
}

/**
 * Per-model reliability, for the metrics strip: calls, failure rate, timeout rate, median wall time.
 * Reports only what has actually happened this session — never an estimate.
 */
export function modelStats() {
  const out = [];
  for (const [id, rows] of OUTCOMES) {
    const n = rows.length;
    const fails = rows.filter((r) => !r.ok);
    const timeouts = fails.filter((r) => /timeout/i.test(r.error || ''));
    const oks = rows.filter((r) => r.ok && r.ms != null).map((r) => r.ms).sort((a, b) => a - b);
    out.push({
      id, calls: n,
      failRate: n ? +(fails.length / n).toFixed(3) : null,
      timeoutRate: n ? +(timeouts.length / n).toFixed(3) : null,
      medianMs: oks.length ? oks[Math.floor(oks.length / 2)] : null,
      lastError: fails.length ? fails[fails.length - 1].error : null,
    });
  }
  return out.sort((a, b) => b.calls - a.calls);
}

/** Run one roster id. Returns the raw llm result ({ok,text,ms,model} shape from llm.mjs). */
export async function runModel(id, prompt, opts = {}) {
  const [engine, ...rest] = String(id || '').split(':');
  const model = rest.join(':');
  if (!model) return { ok: false, error: `malformed model id: ${id}` };
  // interactive by default: every caller of runModel is a button or a CLI press with someone waiting.
  const o = { timeout: timeoutFor(id), interactive: true, ...opts, model };
  const t0 = Date.now();
  let r;
  if (engine === 'local') r = await local(prompt, o);
  else if (engine === 'cloud') r = await cloud(prompt, o);
  else return { ok: false, error: `unknown engine: ${engine}` };
  noteOutcome(id, { ok: r?.ok, ms: r?.ms ?? Date.now() - t0, error: r?.error });
  return r;
}

export const DEFAULT_MODEL_ID = `local:${LOCAL_MODEL}`;
