// packages/thetacog-mcp/scripts/tape/contradict.mjs — THE OFF-PATH CONTRADICTION JUDGE.
//
// ┌─ WHY A MODEL IS ALLOWED HERE, AND EXACTLY WHAT IT MAY TOUCH ───────────────────────────────────┐
// │ This lane is ALLOWED a model because it is OFF the receipt path. Placement, sigma, laneDrift,   │
// │ laneAuc, and every PNG are computed in physics.mjs and html-report.mjs — LLM-FREE, deterministic│
// │ receipts. This module's model call may write ONLY `contradicts[]` on an atom. It must never     │
// │ touch placement, sigma, laneDrift, laneAuc, enforcement numbers, or any panel image. Contra-     │
// │ diction is a semantic judgment (Rice territory — "do these two rules command incompatible       │
// │ actions" is not decidable by a deterministic sensor), so we prove WHERE the candidates sit with  │
// │ the LLM-free gzip-NCD shortlist (physics.ncdShortlist — consumed here, never re-implemented),    │
// │ and let a fallible judge flag the ones worth the operator's attention. The operator resolves.    │
// └────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// ONE model call per judged atom (mirrors R0's one-turn-per-call discipline: one NEW atom's
// shortlist per call, never a batch of atoms judged in one prompt).
import { cloud, extractJson } from '../rewrite/llm.mjs';
import { buildContradictionPrompt } from './prompts.mjs';

/**
 * judgeContradictions(newAtom, shortlist, { model }) -> {
 *   contradicts: string[],   // ids from `shortlist` the judge flagged — the ONLY field this lane may write
 *   judged: boolean,         // true iff a model actually returned a parseable verdict
 *   reason: string|null,     // why judged is false, or why contradicts is trivially empty
 *   ms: number,
 * }
 *
 * newAtom   — { id, rule, quote } (rule is required; quote/id are used for context, not enforced).
 * shortlist — physics.ncdShortlist()'s output: [{ id, rule, ncd }, ...]. LLM-FREE, computed by the
 *             caller and handed in here — this module never re-derives proximity itself, per the
 *             design's split: "the cheap deterministic sensor proposes, the model disposes."
 * model     — optional model fn (prompt, opts) -> {ok, text, ...}; defaults to `cloud` from
 *             ../rewrite/llm.mjs. Inject a stub for tests when the claude CLI is unavailable.
 *
 * "Empty is usually right" (told to the model in the prompt, and enforced here too): an empty or
 * missing shortlist short-circuits with contradicts:[] and NEVER spends a model call — there is
 * nothing to compare the new rule against, so there is nothing to judge.
 */
export async function judgeContradictions(newAtom, shortlist, { model } = {}) {
  if (!newAtom || typeof newAtom.rule !== 'string' || !newAtom.rule.trim()) {
    return { contradicts: [], judged: false, reason: 'newAtom carries no .rule to judge', ms: 0 };
  }
  const list = Array.isArray(shortlist) ? shortlist.filter((s) => s && s.id) : [];
  if (!list.length) {
    return { contradicts: [], judged: false, reason: 'shortlist is empty — nothing proximate to judge against, no model call spent', ms: 0 };
  }

  const callModel = model || ((prompt, opts) => cloud(prompt, opts));
  const prompt = buildContradictionPrompt(newAtom, list);

  const t0 = Date.now();
  const res = await callModel(prompt, { json: true });
  const ms = Date.now() - t0;

  if (!res || !res.ok) {
    return { contradicts: [], judged: false, reason: `model call failed: ${String(res?.error || 'unknown').slice(0, 200)}`, ms };
  }

  const parsed = extractJson(res.text);
  let ids;
  if (Array.isArray(parsed)) ids = parsed;
  else if (parsed && Array.isArray(parsed.contradicts)) ids = parsed.contradicts;
  else {
    return { contradicts: [], judged: false, reason: `unparseable verdict: ${String(res.text || '').slice(0, 200)}`, ms };
  }

  // The judge may only point at ids it was actually shown — never invent a collision against an
  // atom outside the shortlist it was handed. Silent filtering, not a thrown error: a model that
  // hallucinates an extra id should degrade to "the valid subset of what it said," not crash the tape.
  const validIds = new Set(list.map((s) => s.id));
  const contradicts = [...new Set(ids.filter((id) => typeof id === 'string' && validIds.has(id)))];

  return { contradicts, judged: true, reason: null, ms };
}
