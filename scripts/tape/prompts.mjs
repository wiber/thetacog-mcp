// packages/thetacog-mcp/scripts/tape/prompts.mjs — THE ONLY PLACE PROMPT TEXT LIVES for the
// Geometric Sorter (extraction) and the off-path contradiction judge.
//
// ┌─ R0 IS STRUCTURAL, NOT ADVISORY ────────────────────────────────────────────────────────────┐
// │ GDDadwill L1328, the document being processed, names its own anti-pattern: "If you try to    │
// │ process an entire transcript at once, the AI hallucinates, loses context, and breaks the     │
// │ codebase." buildExtractionPrompt therefore takes ONE turn object, never an array — the        │
// │ violation is made impossible to construct a prompt for, not merely discouraged in prose.      │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘

/**
 * buildExtractionPrompt(turn, primer) -> string
 *
 * turn   — a SINGLE segmented turn: { index, role, startLine, endLine, text }. Passing an array
 *          throws immediately (R0 made structurally impossible, not just documented).
 * primer — optional session context string (R1 heuristics + accumulated steering prose). May be
 *          '' or omitted; never required.
 */
export function buildExtractionPrompt(turn, primer = '') {
  if (Array.isArray(turn)) {
    throw new TypeError(
      'buildExtractionPrompt(turn, primer) takes ONE turn object, never an array — R0: ' +
      'one turn per model call is the entire point (GDDadwill L1328: "process an entire ' +
      'transcript at once" is the named anti-pattern this tool exists to refuse).'
    );
  }
  if (!turn || typeof turn !== 'object' || typeof turn.text !== 'string') {
    throw new TypeError('buildExtractionPrompt(turn, primer): turn must be a single { text, ... } object');
  }

  const primerBlock = primer && String(primer).trim()
    ? `\nSESSION CONTEXT (accumulated steering from the operator so far — use it to interpret this turn, never to invent atoms it does not contain):\n${String(primer).trim()}\n`
    : '';

  return `You are the Geometric Sorter — the ONE lane in this pipeline allowed to run a model. Your
entire job is to read ONE turn of a transcript and extract typed, VERBATIM spec atoms from it. You
are given exactly one turn. Do not ask for more context; if this turn alone does not name anything
actionable, return an empty array.

THE TURN IS VOICE-DICTATED. The operator dictates into a phone; the transcription is run-on, often
missing punctuation, sometimes garbling a word the transcriber mis-heard. It has already been passed
through a deterministic voice-glossary normalization pass, so the load-bearing nouns you see (tool
names, product names) are already corrected — treat them as authoritative. Ungrammatical phrasing is
not a sign the content is unimportant; dictated speech is simply how this operator works. Read past
the run-on syntax to the decisions and constraints inside it.
${primerBlock}
TURN METADATA — role: ${turn.role || 'unknown'} · source lines ${turn.startLine ?? '?'}-${turn.endLine ?? '?'} · turn index ${turn.index ?? '?'}

TURN TEXT (extract ONLY from this):
"""
${turn.text}
"""

EXTRACT ZERO OR MORE ATOMS. Each atom is one of exactly four types:
- DECISION   — a choice that was made ("we ship X, not Y"; "the answer is the tape sits in the middle").
- CONSTRAINT — a standing rule or prohibition ("no probabilistic safety monitoring"; "never process the
               whole transcript at once").
- VERIFY     — an acceptance criterion or a runnable check: anything phrased as "done when...", "the
               first returns nothing...", "the second is green as of...", a falsifiable test condition.
- CONTEXT    — load-bearing background that BINDS NOTHING on its own (no decision, no rule, no check)
               but that a later atom would be unreadable without.

THE EXTRACTIVE LAW — READ THIS TWICE:
Every atom's "quote" field MUST be copied CHARACTER-FOR-CHARACTER from the turn text above — a real
verbatim substring, not a paraphrase, not a cleaned-up version, not a summary. If you cannot find an
exact quote in the turn that supports the atom, DO NOT EMIT THAT ATOM. Do not fix the operator's
grammar inside the quote field. Do not shorten it "for readability." Copy it exactly, including any
transcription artifacts, or leave it out entirely.

OUTPUT FORMAT — STRICT JSON, NOTHING ELSE:
Return ONLY a JSON array. No markdown code fence, no leading "Here is the JSON:", no trailing prose,
no explanation. If nothing actionable is in this turn, return exactly: []

Each array element:
{
  "type": "DECISION" | "CONSTRAINT" | "VERIFY" | "CONTEXT",
  "quote": "<verbatim substring of THIS turn's text, copied exactly>",
  "rule": "<one-line imperative summary of what this atom asks for>",
  "target_surface": "<a repo path/route this binds to, if named in the turn, else null>",
  "falsifier": "<a runnable command or checkable condition, if the turn states one, else null>",
  "priority": "P0" | "P1" | "P2"
}

Return the JSON array now.`;
}

/**
 * buildContradictionPrompt(newAtom, shortlist) -> string
 *
 * newAtom   — { id, rule, quote } the atom being newly appended to the tape.
 * shortlist — the gzip-NCD shortlist from physics.ncdShortlist(): [{ id, rule, ncd }, ...],
 *             already narrowed LLM-free. This prompt NEVER re-derives the shortlist; it only
 *             judges the pairs it is handed.
 *
 * This lane is ALLOWED a model because it is OFF the receipt path (TAPE-CONTRACT.md, design §D):
 * placement, sigma, laneDrift, laneAuc, and every PNG are computed elsewhere and are LLM-free.
 * This prompt's answer may only ever populate one field: contradicts[].
 */
export function buildContradictionPrompt(newAtom, shortlist) {
  if (!newAtom || typeof newAtom !== 'object' || typeof newAtom.rule !== 'string') {
    throw new TypeError('buildContradictionPrompt(newAtom, shortlist): newAtom must carry a string .rule');
  }
  const list = Array.isArray(shortlist) ? shortlist : [];
  const rows = list.map((s, i) => `${i + 1}. id="${s.id}" (gzip-NCD proximity ${s.ncd}) — rule: "${s.rule}"`).join('\n');

  return `You are judging CONTRADICTION between one new rule and a short list of prior rules already
on this tape. The list below was narrowed by a deterministic proximity sensor (gzip-NCD over the rule
text) — it means "these rules live in the same neighborhood," nothing more. Most neighboring rules do
NOT contradict each other; they are simply about related things. Empty is usually the right answer.

A contradiction means the two rules CANNOT BOTH BE HONORED — following one makes it impossible to
follow the other. Sharing a topic, a file, a person's name, or a tool name is NOT a contradiction.
Two rules that narrow, extend, supersede, or add detail to each other are NOT a contradiction. Only
flag a genuine logical collision.

NEW RULE (id="${newAtom.id || '(unassigned)'}"): "${newAtom.rule}"
${newAtom.quote ? `NEW RULE'S SOURCE QUOTE: "${String(newAtom.quote).slice(0, 400)}"` : ''}

CANDIDATE PRIOR RULES (already proximity-shortlisted):
${rows || '(shortlist is empty — there is nothing to compare against; answer [])'}

OUTPUT FORMAT — STRICT JSON, NOTHING ELSE:
Return ONLY a JSON array of the ids from the candidate list above that the new rule GENUINELY
contradicts. No markdown fence, no prose. If none contradict — the common case — return exactly: []

Return the JSON array now.`;
}
