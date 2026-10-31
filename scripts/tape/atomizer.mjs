// packages/thetacog-mcp/scripts/tape/atomizer.mjs — THE GEOMETRIC SORTER.
//
// The ONLY lane in /tape that spends a model call per unit of real extraction work (the off-path
// contradiction judge in contradict.mjs is the other, smaller one). ONE model call PER TURN — R0,
// GDDadwill L1328's own named anti-pattern. Fan-out is a BOUNDED PROMISE POOL, never a sequential
// `for`/`while` loop with an `await` inside it (CLAUDE.md "QWEN IS BANNED FROM ACTIVE TASKS" /
// tests/shoot/no-sequential-model-loop.test.mjs names the exact banned shape — this file avoids it
// structurally via mapPool() below, not by promising to remember).
//
// THE EXTRACTIVE LAW IS ENFORCED IN CODE, NOT LEFT TO THE PROMPT. A model asked nicely to "only
// quote verbatim" will still occasionally paraphrase under its breath. Every atom's `quote` is
// checked against the turn's actual text before it is accepted; a non-verbatim quote is REJECTED,
// never repaired — repairing a quote by rewriting it is exactly the failure mode the extractive law
// exists to prevent (it would silently convert an operator's words into a model's words on a path
// that is supposed to be receipt-grade downstream, via physics.apertureFidelity).
//
// ONE BAD TURN NEVER KILLS THE TAPE. A turn whose model call fails, times out, or returns
// unparseable text records { turn, status:'extract-failed', raw: <first 200 chars> } and the walk
// continues over every other turn — see mapPool's per-item error isolation.
import { cloud, extractJson } from '../rewrite/llm.mjs';
import { apertureFidelity } from './physics.mjs';
import { buildExtractionPrompt } from './prompts.mjs';

const VALID_TYPES = new Set(['DECISION', 'CONSTRAINT', 'VERIFY', 'CONTEXT']);
const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2']);

// ── BOUNDED PROMISE POOL — the required shape, not a sequential await-loop ─────────────────────
// Fires up to `concurrency` calls to `fn` at once, preserves input order in the output array, and
// isolates per-item failures (one rejected promise does not abort the others or the pool itself).
export function mapPool(items, concurrency, fn) {
  const list = items || [];
  const n = Math.max(1, concurrency | 0);
  return new Promise((resolveAll) => {
    if (list.length === 0) return resolveAll([]);
    const results = new Array(list.length);
    let nextIndex = 0;
    let inFlight = 0;
    let settled = 0;
    const pump = () => {
      while (inFlight < n && nextIndex < list.length) {
        const i = nextIndex++;
        inFlight++;
        Promise.resolve()
          .then(() => fn(list[i], i))
          .then((r) => { results[i] = r; })
          .catch((e) => { results[i] = { error: String(e?.message || e) }; })
          .finally(() => {
            inFlight--; settled++;
            if (settled === list.length) resolveAll(results);
            else pump();
          });
      }
    };
    pump();
  });
}

// Verbatim-substring check with the ONE permitted normalization: whitespace-collapse. Never a
// rewrite, never a fuzzy/edit-distance match — either the model copied it or it did not.
function normWs(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
export function quoteIsVerbatim(quote, turnText) {
  const q = String(quote || '');
  const t = String(turnText || '');
  if (!q || !t) return false;
  if (t.includes(q)) return true;
  return normWs(t).includes(normWs(q));
}

function validateAndAttachAtom(raw, turn) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reject: { turn: turn.index, reason: 'atom is not an object', raw: JSON.stringify(raw).slice(0, 200) } };
  }
  const { type, quote, rule, target_surface = null, falsifier = null, priority = 'P2' } = raw;
  if (!VALID_TYPES.has(type)) {
    return { ok: false, reject: { turn: turn.index, reason: `unrecognized type "${type}"`, quote: quote || null } };
  }
  if (typeof quote !== 'string' || !quote.trim()) {
    return { ok: false, reject: { turn: turn.index, reason: 'missing or empty quote', raw: JSON.stringify(raw).slice(0, 200) } };
  }
  if (!quoteIsVerbatim(quote, turn.text)) {
    return { ok: false, reject: { turn: turn.index, reason: 'quote is NOT a verbatim substring of this turn (extractive law violated)', quote } };
  }
  if (typeof rule !== 'string' || !rule.trim()) {
    return { ok: false, reject: { turn: turn.index, reason: 'missing or empty rule', quote } };
  }
  const atom = {
    type,
    quote,
    rule: rule.trim(),
    target_surface: (typeof target_surface === 'string' && target_surface.trim()) ? target_surface.trim() : null,
    falsifier: (typeof falsifier === 'string' && falsifier.trim()) ? falsifier.trim() : null,
    priority: VALID_PRIORITIES.has(priority) ? priority : 'P2',
    turn: turn.index,
    chunk: [turn.startLine ?? null, turn.endLine ?? null],
    apertureFidelity: apertureFidelity(quote, rule),
  };
  return { ok: true, atom };
}

async function atomizeOneTurn(turn, primer, callModel) {
  const t0 = Date.now();
  let prompt;
  try {
    prompt = buildExtractionPrompt(turn, primer);
  } catch (e) {
    return { turn: turn.index, status: 'extract-failed', raw: String(e.message).slice(0, 200), ms: Date.now() - t0 };
  }

  const res = await callModel(prompt, { json: true });
  const ms = Date.now() - t0;
  if (!res || !res.ok) {
    return { turn: turn.index, status: 'extract-failed', raw: String(res?.error || 'model call failed').slice(0, 200), ms };
  }

  const parsed = extractJson(res.text);
  if (!Array.isArray(parsed)) {
    return { turn: turn.index, status: 'extract-failed', raw: String(res.text || '').slice(0, 200), ms };
  }

  const atoms = [];
  const rejects = [];
  for (const raw of parsed) {
    const v = validateAndAttachAtom(raw, turn);
    if (v.ok) atoms.push(v.atom); else rejects.push(v.reject);
  }
  return { turn: turn.index, status: 'ok', atoms, rejects, ms };
}

/**
 * assignIds(atomsByTurn) — PURE. No model, no I/O, no clock (ids are content, not timestamps).
 *
 * atomsByTurn: Array<{ turnIndex, atoms: Atom[] }>, already in TURN ORDER (the order atomizeTurns
 * produces from a turn-order input array). Assigns per-type zero-padded ids (DECISION-001, ...) by
 * walking turns in order and, within a turn, atoms in extraction order. Deterministic: the same
 * atomsByTurn structure always yields the same ids, so a test can verify it with zero model calls.
 */
export function assignIds(atomsByTurn) {
  const counters = { DECISION: 0, CONSTRAINT: 0, VERIFY: 0, CONTEXT: 0 };
  const out = [];
  for (const group of atomsByTurn || []) {
    for (const atom of group.atoms || []) {
      const type = VALID_TYPES.has(atom.type) ? atom.type : 'CONTEXT';
      counters[type] = (counters[type] || 0) + 1;
      out.push({ ...atom, id: `${type}-${String(counters[type]).padStart(3, '0')}` });
    }
  }
  return out;
}

/**
 * atomizeTurns(turns, { primer, concurrency, model, minChars }) -> {
 *   atoms, rejects, failures, skipped, stats
 * }
 *
 * turns       — array of segmented turns from chunker.segment()/chunkText(), in tape order.
 * primer      — session steering prose, passed through to every prompt unchanged.
 * concurrency — bounded pool width (default 4). NEVER sequential.
 * model       — optional model fn (prompt, opts) -> {ok, text, ...}, defaults to `cloud` from
 *               ../rewrite/llm.mjs. Inject a stub here for tests when the claude CLI is unavailable.
 * minChars    — turns whose trimmed text is under this length skip the model call entirely (there
 *               is nothing extractable in "ok" or a lone "?") and are recorded honestly in `skipped`
 *               rather than silently spending a call on them. Default 20.
 */
export async function atomizeTurns(turns, { primer = '', concurrency = 4, model, minChars = 20 } = {}) {
  const callModel = model || ((prompt, opts) => cloud(prompt, opts));
  const all = turns || [];
  const eligible = [];
  const skipped = [];
  for (const t of all) {
    if ((t.text || '').trim().length >= minChars) eligible.push(t);
    else skipped.push({ turn: t.index, reason: `turn text under ${minChars} chars — skipped without spending a model call` });
  }

  const t0 = Date.now();
  const results = await mapPool(eligible, concurrency, (t) => atomizeOneTurn(t, primer, callModel));
  const ms = Date.now() - t0;

  const failures = results.filter((r) => r && r.status === 'extract-failed');
  const oks = results.filter((r) => r && r.status === 'ok');

  // Preserve TURN ORDER for id assignment: `results` already mirrors `eligible`'s order (mapPool
  // writes into results[i] by the input index), and `eligible` is a filtered sub-sequence of the
  // original turn-ordered `turns` array, so this is turn-order by construction.
  const atomsByTurn = oks.map((r) => ({ turnIndex: r.turn, atoms: r.atoms }));
  const rejects = oks.flatMap((r) => r.rejects || []);
  const atoms = assignIds(atomsByTurn);

  return {
    atoms,
    rejects,
    failures,
    skipped,
    stats: {
      turnsTotal: all.length,
      turnsEligible: eligible.length,
      turnsSkipped: skipped.length,
      calls: eligible.length,
      atomsAccepted: atoms.length,
      atomsRejected: rejects.length,
      extractFailed: failures.length,
      ms,
    },
  };
}
