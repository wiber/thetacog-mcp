// packages/thetacog-mcp/scripts/tape/choose-meaningful.mjs — WHICH ADMISSIBLE QUESTION IS WORTH ASKING A HUMAN.
//
// Operator, repeatedly: "the llm chosen vector constraining question thats most human meaningful".
//
// ── WHAT WAS ACTUALLY HAPPENING ───────────────────────────────────────────────────────────────
// next-question.mjs ranked candidates by displacement geometry and then took the first survivor:
//
//     ask: ranked.find((r) => r.cls !== "DEGENERATE" && r.cls !== "FORMALITY")
//
// The geometry is real and it is load-bearing — it answers "does this question move the locked
// body, or does it collapse it onto one cell". What it cannot answer, and was never designed to, is
// "would a person recognise this as the thing they are actually stuck on". Those are different
// questions and only one of them had a judge. So the cone-narrowing candidate won by default, and
// the operator kept being handed a technically-optimal question he did not care about.
//
// ── THE SPLIT, AND WHY IT KEEPS THE RECEIPT CLEAN ─────────────────────────────────────────────
// THE CHIP GATES. THE MODEL CHOOSES AMONG SURVIVORS. Nothing here computes a metric, moves a
// coordinate, or touches σ — the model is handed a shortlist the LLM-free displacement field has
// already blessed and picks one. A candidate the chip disqualified can never be resurrected by this
// function, so the decidable half of the system is untouched (CLAUDE.md · THE RECEIPT IS LLM-FREE:
// the receipt is the panel and the placement, not which question gets asked next).
//
// ── AND IT ALWAYS SAYS WHO CHOSE ──────────────────────────────────────────────────────────────
// The record carries chosenBy: 'model' | 'geometry' and the reason. A model pick that silently
// replaced the geometric one would be indistinguishable from the old behaviour when it agreed, and
// unaccountable when it did not. On any failure — spawn, timeout, an id that is not on the
// shortlist — it falls back to the geometric pick and names why, because a fabricated choice is
// worse than an honest default.

import { sonnetJson } from './sonnet.mjs';

/** Candidates the displacement field admitted. Geometry keeps its veto; this only reorders survivors. */
// A RANKED ENTRY *IS* THE ASK. It carries {id, question, answers, cls, score, rank, …} directly —
// next-question assigns one straight into the `ask` field. Reaching for r.ask here returned
// undefined on every candidate; verified against the live ledger rather than assumed.
export const admissible = (ranked = []) =>
  ranked.filter((r) => r && r.question && r.cls !== 'DEGENERATE' && r.cls !== 'FORMALITY');

const brief = (cands, ctx) => `You are choosing which ONE question to put in front of an operator who is
building this system right now. Every candidate below has ALREADY passed a mechanical test: each one
measurably reorganizes the body of locked decisions rather than collapsing it. That part is settled.
You are not re-scoring them and you cannot reject the shortlist.

Your job is the part the measurement cannot do: WHICH OF THESE WOULD A WORKING HUMAN RECOGNISE AS THE
THING THEY ARE ACTUALLY STUCK ON.

FIRST, THE BAR: a winning question BISECTS. After its answer an entire branch of the architecture is
gone and cannot return without reopening the decision. If both answers could hold at once, or if a
third position exists that is neither, or if one answer is obviously right, that candidate has not
bisected anything — prefer one that has, even if it reads less tidily.

And it bisects the REMAINING space, like a turn of 21 questions: never pick a candidate whose answer
is already inferable from what the project has decided (the context below) — a turn spent confirming
the known is a turn wasted, however well it scored.

Then, among the ones that bisect, pick the one that:
  · names a live tension in this project that a person can feel, not a gap in a schema
  · can be answered from experience and judgement, without looking anything up
  · changes what gets built next, in a way the operator would notice within a day
  · could only have been asked of THIS project — it names the real TENSION this build is under, so
    the operator can tell the build was read, not surveyed. Proof-of-reading lives in the ANSWERS,
    which are written in the project's concrete nouns; the QUESTION proves it by naming the tradeoff
    the project actually faces. A question that has to name a file, a library, a flag, a format or a
    data structure to sound informed is a SPECIFICATION question — pick against it (see below)
  · carries two answers whose stated costs are REAL and DIFFERENT — the operator decides by
    comparing what each side forbids; a pair where a "costs:" line is missing or generic gives
    them nothing to weigh
  · reads in one pass — if the operator has to re-read it to find the decision, it is the wrong pick
    even when it is the sharpest one on the list

Pick AGAINST:
  · restating something already decided, in new words
  · a question whose two answers are both obviously true, or obviously the same
  · bookkeeping, naming, or "should we document X" — real, and not what a person is stuck on
  · anything that reads like it was written to satisfy a process
  · THE SPECIFICATION QUESTION, above all. "Do we use LRU or LFU for cache eviction?" is a clean XOR
    and it is worthless here: a spec is an IMPLEMENTATION of intent, so capturing it never captures
    the why, and the operator becomes a human compiler typing in the reality the instrument exists
    to measure. The test: could a competent person who has never read this codebase answer it from
    the tradeoff alone? If they need to know a file, a library, a flag or a format to have an
    opinion, pick a different candidate. Prefer the question one level UP the definer chain — the
    design tradeoff that FORCES the technical choice, which the subagents can then derive:
      vibe check  "What should our data strategy feel like?"            — no constraint, useless
      sandbag     "LRU or LFU for cache eviction?"                      — constraining, but a spec
      upstream    "Under heavy load, do we guarantee ground-truth data
                   (blocking the UI 2s), or immediate kinetic response
                   (serving data up to 5 minutes stale)?"              — constraining AND a value

${ctx ? `WHERE THE PROJECT IS RIGHT NOW:\n${ctx}\n` : ''}
CANDIDATES (each answer with the cost its proposer named — "(unstated)" means none was given):
${cands.map((c, i) => `[${c.id || `C${i + 1}`}] ${c.question}
${(c.answers || []).map((a) => `     · ${a.label || '(unlabelled)'}: ${String(a.rule || '').slice(0, 200)}
       costs: ${a.tradeoff ? String(a.tradeoff).slice(0, 160) : '(unstated)'}`).join('\n') || '     (no answers)'}`).join('\n\n')}

Return ONLY this JSON object:
{"id":"<the id in square brackets of your pick>","why":"<one sentence, max 25 words: name what a person is stuck on AND what stops being possible once this is answered>"}`;

/**
 * Choose the most human-meaningful question among the chip-admissible candidates.
 * Never throws. Never invents a candidate. Always reports who chose and why.
 *
 * @returns {Promise<{ask:object|null, chosenBy:'model'|'geometry', why:string|null, reason:string|null, shortlist:number}>}
 */
export async function chooseMeaningful(ranked = [], { context = null } = {}) {
  const cands = admissible(ranked);
  const geometric = cands[0] || null;
  const base = { ask: geometric, chosenBy: 'geometry', why: null, reason: null, shortlist: cands.length };

  // Nothing to choose between: one survivor is not a decision, and calling a model to confirm it
  // would spend 30 seconds to return the only possible answer.
  if (cands.length <= 1) {
    return { ...base, reason: cands.length ? 'only one admissible candidate — nothing to choose between' : 'no admissible candidate' };
  }

  const r = await sonnetJson(brief(cands, context), 'meaningfulness choice', { timeoutMs: 240_000 });
  if (!r.ok) return { ...base, reason: `${r.reason} — fell back to the highest-ranked candidate` };

  const id = String(r.value?.id ?? '').trim();
  const hit = cands.find((c) => String(c.id) === id);
  if (!hit) {
    // A model that names a candidate outside the shortlist has not made a choice, it has made
    // something up. The geometric pick stands and the attempt is on the record.
    return { ...base, reason: `model returned id "${id.slice(0, 40)}" which is not on the shortlist — fell back to the highest-ranked candidate` };
  }
  return {
    ask: hit,
    chosenBy: 'model',
    why: String(r.value?.why ?? '').slice(0, 240) || null,
    reason: null,
    shortlist: cands.length,
  };
}
