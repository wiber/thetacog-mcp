#!/usr/bin/env node
// scripts/voice/behavior-promise.mjs — THE BEHAVIOR-PROMISE CONSTRUCT, IN ONE PLACE.
//
// CLAUDE.md, NEVER GUARANTEE BEHAVIOR: we never guarantee conduct, and we never offer containment
// as our capability. The banned sentence is a CONSTRUCT — an affirmative first-person subject, a
// promise verb, a behavior object, and NO negation or measurement verb in the clause — never a
// token. The live corpus is the proof: every "guarantee" we ship is the Rice-side negation ("we
// never guarantee behaviour", "no software can guarantee its own conduct"), and the one
// affirmative "we guarantee" we do ship is the canonical measurement form ("we guarantee the
// deviation is detected, placed, priced and dispatched"). A token match flags all of those and
// none of the two sentences the rule exists to stop.
//
// WHY THIS IS A MODULE AND NOT A BLOCK INSIDE THE TEST (2026-09-07). The construct lived only in
// tests/voice/no-behavior-guarantee.test.mjs, and scripts/blog/mdx-cook-check.sh C27 re-grew its
// own copy as a line-grep: `\b(we|our gate…) (guarantee|ensure|…)\b`. That copy fired on
// src/content/blog/2026-08-27-take-the-exponent.mdx line 231 — the paragraph that says
// "**we never guarantee behaviour.** … not that anything is contained … We guarantee the deviation
// is **detected, placed, priced and dispatched**" — i.e. on the exact paragraph the rule prescribes.
// Two copies of one rule drifted in the same week they were written (ONE RULE LIVES IN ONE PLACE).
// Now the test imports from here and C27 calls the CLI below, so there is one construct to fix.
//
// SUFFICIENCY CONTRACT. `findBannedPromises(text)` is sufficient for "does this text OFFER a
// behavior guarantee or containment as ours?" It is NOT sufficient for "is this sentence true" or
// "is the framing fair" — that is the ghost-read loop's judgment half, and it is not a regex.
//
// CLI:  node scripts/voice/behavior-promise.mjs <file> [--json]
//       exit 0 = no banned promise · exit 1 = at least one (each printed as line:label:snippet)
//       exit 2 = file unreadable (I could not look, which is a different claim from I saw nothing)
//
// Guard: tests/voice/no-behavior-guarantee.test.mjs (the construct, verified both directions
// against real corpus sentences) · tests/blog/c27-promise-is-a-construct.test.mjs (C27 calls this
// and the real line-231 paragraph passes while a hand-written affirmative fails).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── The construct, not the token ────────────────────────────────────────────
//
// A banned sentence needs THREE things at once: an affirmative first-person
// subject, a guarantee/prevention verb, and a BEHAVIOR object. Drop any one and
// it is a sentence we already ship. The live corpus proves it: every existing
// "guarantee" is negated ("cannot", "no software can", "asks for guarantees
// that no piece of software can decide"), so the negation test alone removes
// all seven true negatives.

export const SUBJECT = String.raw`(?:we|our (?:system|grid|instrument|benchmark|receipt|tape|lattice|technology|gate|product|licence|license)|the (?:system|grid|instrument|benchmark|receipt|lattice|architecture|invariant|walk|tape|wheel|placement)|this (?:system|instrument|architecture)|thetadriven|thetacog)`;
export const PROMISE = String.raw`(?:guarantee|guarantees|guaranteeing|ensure|ensures|ensuring|prevent|prevents|preventing|make sure)`;
// What the promise is ABOUT. Behavior — what the model does — never measurement.
export const BEHAVIOR = String.raw`(?:behaviou?r\w*|deviat\w+|drift\w*|hallucinat\w+|stay(?:s|ing)? in lane|in ?lane|won'?t (?:deviate|drift|fail)|will (?:only|never|not)|do(?:es)?n'?t (?:deviate|drift)|the ideal state|correct output|right answer|jump\w* the rails|off the rails)`;

// The measurement verbs. Their presence flips the SAME sentence from banned to
// canonical: "we guarantee the deviation is detected, placed, priced, and
// dispatched" contains subject+promise+behavior and is the line we want.
export const MEASUREMENT = /\b(detect\w*|plac\w+|pric\w+|dispatch\w+|measur\w+|record\w+|receipt\w*|observ\w+|surfac\w+|report\w+|counted|countable)\b/i;

// Negation anywhere between the subject and the promise means the sentence is
// making our actual argument (nobody can guarantee behavior — that is the
// theorem), not violating it.
export const NEGATED = /\b(cannot|can'?t|could not|couldn'?t|never|no (?:software|system|model|program|one|piece)|not|nobody|impossible|refuse|undecidable|don'?t|do not|does not|doesn'?t)\b/i;

export const BEHAVIOR_GUARANTEE = new RegExp(
  String.raw`\b${SUBJECT}\b[^.!?\n]{0,40}?\b${PROMISE}\b[^.!?\n]{0,120}?\b${BEHAVIOR}\b`,
  'i'
);

// Keep-in-lane offered as our function. "keep" is not a PROMISE verb (we keep receipts, we keep
// the tape), so it needs the lane object in the same clause to be the claim.
export const KEEP_IN_LANE = new RegExp(
  String.raw`\b${SUBJECT}\b[^.!?\n]{0,30}?\bkeep(?:s|ing)?\b[^.!?\n]{0,40}?\bin ?(?:the |its |their |your )?lane\b`,
  'i'
);

// The halt sold as our promise. THE HALT IS REAL (C27, corrected 2026-09-01: an out-of-lane
// crossing can be wired to stop the run — a configuration the buyer makes on their own machine),
// so "you can wire the gate to halt the agent" is a capability and not a hit. What is banned is us
// UNDERTAKING that we will stop it, with no configuration or optionality marker in the clause.
export const STOPS_AGENT = new RegExp(
  String.raw`\b${SUBJECT}\b[^.!?\n]{0,20}?\b(?:will |shall )?(?:stop|stops|halt|halts|block|blocks|kill|kills)\b[^.!?\n]{0,30}?\b(?:the |your |any |every )?(?:agent\w*|model\w*|run|LLM|AI)\b`,
  'i'
);
export const CONFIGURABLE = /\b(configur\w*|option\w*|can be|may be|could be|you can|you may|if you|wired?|wire it|on your (?:own )?machine|your call|yours to)\b/i;

// THE MIRROR OVERSHOOT — the halt denied (2026-09-11). Ten days after C27 was corrected to "the halt
// is real", the Four Things post shipped "No coordinate stops an agent from doing anything, and any
// instrument that claimed to would sit inside the failure domain it was supposed to police." Both
// halves are false and the second contradicts the post's own thesis: the count is written by the
// floor, not by the agent, so it sits OUTSIDE the thing it watches — which is exactly why you could
// have checked, and exactly why the tick can be wired to a hard halt on the first crossing. Operator,
// verbatim: «you can wire interventions into whether the doc is acting like a plumber (that's why you
// could have checked, and you can obviously shut it down instantly if you want, it's just not how
// insurance works)». The true sentence keeps BOTH halves: the halt is yours and instant; pricing,
// not pulling the plug, is what insurance does. Two shapes:
//   (a) an instrument-subject denied the halt: "no coordinate/count/receipt/tick stops the agent"
//   (b) ANYTHING-that-stops-it placed inside the failure domain (the quantifier is the offence)
//   (c) the same quantifier with the conclusion elided
// Note the "no software can guarantee" sentence is NOT this: guarantee is Rice-side and stays banned;
// stop/halt is a wire and stays possible.
export const HALT_INSTRUMENT = String.raw`(?:coordinate|instrument|count|counter|receipt|tick|meter|measurement|gate|lattice|placement|panel)`;
export const HALT_DENIED = [
  new RegExp(String.raw`\b(?:no|nothing|neither)\b(?: [a-z-]+){0,2}? ${HALT_INSTRUMENT}\b[^.!?\n]{0,30}?\b(?:can |could |will |ever )?(?:stop|stops|halt|halts|shut\w* (?:down|off)|kill|kills)\b[^.!?\n]{0,30}?\b(?:an? |the |your |any |every )?(?:agent\w*|model\w*|run|LLM|AI)\b`, 'i'),
  // (b) is keyed on the UNIVERSAL QUANTIFIER, not on "failure domain": "a rule, positioned to stop
  // exactly this, sitting inside the same failure domain" (the gym story) is TRUE of that rule —
  // a fence specified in advance from assumptions about the agent. "ANYTHING positioned to stop
  // the agent sits inside the failure domain" is the overshoot, because a halt wired to a cause-
  // blind count is not specified from any assumption about the agent at all.
  new RegExp(String.raw`\b(?:anything|everything|whatever|any(?: \w+)? (?:instrument|coordinate|count|gate|rule|box|fence|envelope))\b[^.!?\n]{0,40}?\b(?:stop|stops|halt|halts|contain\w*|prevent\w*|police|polices|kill|kills)\b[^.!?\n]{0,80}?\b(?:inside|within) (?:the |its |that )?(?:same )?failure domain\b`, 'i'),
  // (c) the same quantifier with the conclusion elided: "anything built to stop an agent is
  // specified under assumptions ..." — false for the same reason, whatever follows.
  new RegExp(String.raw`\b(?:anything|everything|whatever) (?:built|positioned|designed|meant|made|placed) to \*?(?:stop|halt|contain|prevent|block)\*? (?:an? |the |your )?(?:agent\w*|model\w*|AI|LLM|run)\b`, 'i'),
];

// A "mathematical guarantee" whose object is a system's conduct is the exact
// phrase from the analysis, and it is banned regardless of subject — nobody has
// one, and the adjective is what makes it quotable against us.
export const MATHEMATICAL_GUARANTEE = new RegExp(
  String.raw`\bmathematical(?:ly)? guarantee\w*\b[^.!?\n]{0,140}?\b(?:autonomous|agent\w*|model\w*|AI|LLM|system\w*)\b[^.!?\n]{0,60}?\b(?:stay\w*|behav\w*|execut\w*|deviat\w*|only|in ?lane)\b`,
  'i'
);

// The baseline half: measuring against the ideal state of the world rather than
// against the sealed declaration. The rescue is naming the declaration.
export const IDEAL_BASELINE = /\b(deviation from|deviate from|measured? against|compared? (?:to|against)|baseline is|relative to) (?:the )?(ideal state|platonic ideal|ideal world|true intent|objective truth)\b/i;
export const DECLARED = /\b(declar\w+|sealed?|write_tape_intent|intent corpus|the tape|committed intent|spec\w*|policy wording|stated intent)\b/i;

// Overclaim 1c — REMEDIATION AS OUR SERVICE (2026-09-08).
//
// The trigger fires. What the deployer does next is THEIR business. Promising that we
// arrive and fix the agent is a promise about post-trigger conduct — the same class as
// guaranteeing behaviour, and unkeepable at any scale. An insurer pays the claim; it does
// not drive the car.
//
// THE INCIDENT, and it is our own words: the 2026-09-08 infra call promised remediation
// three times — "we'll send the men and black over and fix it for you", "we go in and fix
// it", "the nones show up and starts fixing it and make sure it doesn't happen again". All
// three passed BEHAVIOR_GUARANTEE and CONTAINMENT_CLAIM clean, because "fix" is not a
// PROMISE verb and "your AI" is not a BEHAVIOR object. Measured before this shipped: the
// existing constructs miss all three.
//
// WHY IT IS NOT A TOKEN BAN. "fix" is everywhere and almost always correct — fix the hook,
// fix the README, a fix shipped with its guard. The construct is US as subject, a repair
// verb, and THEIR system as the object: someone else's agent, model, deployment or stack.
// Repairing our own instrument is not a claim about their conduct and never fires.
export const REPAIR_VERB = String.raw`(?:fix|fixes|fixing|repair\w*|remediat\w+|tweak\w*|tune|tunes|tuning|correct|corrects|correcting|resolv\w+|sort out|put (?:it|them) right|make sure it doesn'?t happen again|come in and|go in and|show(?:s)? up and|send (?:the |our |in )?(?:men|people|engineers|team))`;
// The object is THEIR estate. Ours ("our panel", "the hook", "the receipt") is exempt by
// simply not matching — no allowlist to maintain and nothing to keep in sync.
export const THEIR_SYSTEM = String.raw`(?:your|their|the client'?s|the tenant'?s|the customer'?s|the deployer'?s)\s+(?:\w+\s+){0,2}?(?:AI|LLM|agent\w*|model\w*|deployment\w*|system\w*|stack|workload\w*|infrastructure|racks?)|\bit\b(?=[^.!?\n]{0,40}?\b(?:doesn'?t happen again|does not happen again|works again|for you))`;

// THE DISPATCHED-PEOPLE SUBJECT, and it is why this needs its own subject rather than the
// shared one. The promise rarely arrives as "we fix it" — it arrives as a CREW: "the men in
// black show up", "our engineers come in". The shared SUBJECT is deliberately narrow (we /
// our system / the instrument) because every other construct here needs it narrow, so
// widening it would loosen four unrelated guards. This alternation is local to remediation.
export const REMEDIATION_SUBJECT = String.raw`(?:${SUBJECT}|(?:the |our )?(?:m[ae]n in black|men and black|guys|engineers|people|team|crew|nuns|nones)\b)`;

export const REMEDIATION_PROMISE = new RegExp(
  String.raw`\b${REMEDIATION_SUBJECT}[^.!?\n]{0,60}?\b${REPAIR_VERB}\b[^.!?\n]{0,50}?(?:${THEIR_SYSTEM})`,
  'i'
);

// THE FENCE that makes the same sentence correct. `your own` earns its place by measurement,
// not by taste: the first run flagged 2026-03-04-the-skip-formula:202 — "correcting your own
// AI's excitement with rigorous proof" — where the actor is the READER repairing the READER's
// model. That is the behaviour the post is recommending, i.e. the fence itself.
// THE FENCE that makes the same sentence correct. Saying the remediation is the deployer's
// own — or a third party's revenue line — is the shape we WANT, so it must never fire.
export const THEIRS_TO_DO = /\b(your business|their business|your call|yours to|their own|your own|your (?:own )?(?:engineers|team|revenue|line)|not (?:our|my) (?:obligation|job)|we (?:do not|don'?t) (?:fix|remediate|repair)|does not drive|doesn'?t drive)\b/i;

// Overclaim 1b — containment as OUR capability.
//
// Two shapes, because containment arrives as a verb and as a noun and only one of
// them can be caught by the SUBJECT..PROMISE..BEHAVIOR machinery above.
//
//   VERB   we contain / sandbox / box in / wall off  ... an agent-or-model object
//   NOUN   our containment (layer|strategy) / we provide containment
//
// The noun form REQUIRES possession by us. Unpossessed "containment" is somebody
// else's word being discussed — "containment fails when you need it", "containment
// is the wrong word for what I'm describing" — which is the sentence we want to
// ship, and a token match would flag exactly those.
export const CONTAIN_VERB = String.raw`(?:contain|contains|containing|sandbox\w*|box(?:es|ing)? (?:in|up)|wall(?:s|ing)? off|fence(?:s|ing)? in|lock(?:s|ing)? (?:down|in)|keep(?:s|ing)? [^.!?\n]{0,20}inside)`;
export const AGENT_OBJECT = String.raw`(?:the )?(?:agent\w*|model\w*|AI|LLM|system\w*|it|them)`;
export const CONTAINMENT_CLAIM = [
  new RegExp(String.raw`\b${SUBJECT}\b[^.!?\n]{0,40}?\b${CONTAIN_VERB}\b[^.!?\n]{0,40}?\b${AGENT_OBJECT}\b`, 'i'),
  // Possessed noun, in either order: "our containment layer", "we provide containment".
  new RegExp(String.raw`\bour\b[^.!?\n]{0,20}?\bcontainment\b`, 'i'),
  new RegExp(String.raw`\b${SUBJECT}\b[^.!?\n]{0,30}?\b(?:provide|provides|offer|offers|sell|sells|build|built|ship|ships)\b[^.!?\n]{0,30}?\bcontainment\b`, 'i'),
];

// Overclaim 2, both orders, plus the enforcement-digitizing variant.
export const REPLACES_AUDIT = [
  /\b(replac\w+|obsolet\w+|kill\w+|disrupt\w+|put[^.!?\n]{0,20}out of business)\b[^.!?\n]{0,60}?\b(big four|big 4|the auditors|audit firms|deloitte|pwc|kpmg|ernst ?& ?young)\b/i,
  /\b(big four|big 4|the auditors|audit firms)\b[^.!?\n]{0,60}?\b(are|become|get|gets|will be)\b[^.!?\n]{0,30}?\b(replaced|obsolete|redundant|unnecessary)\b/i,
  /\bdigitiz\w+ (?:of )?contract enforcement\b/i,
];

// ── Refutation neighbourhood ────────────────────────────────────────────────
//
// Good prose quotes the banned line in order to kill it — that is most of what
// the claim-perimeter box on /benchmark does. A regex cannot tell assertion from
// refutation, but it can read the neighbourhood. Narrow window on purpose: wide
// enough to span the clause that kills it, too short to launder an assertion
// three sentences away from an unrelated "never".
export const REFUTES = /\b(banned|forbidden|filed (?:yourself|you|us) (?:as|under)|the defendant|a precursor|we (?:do not|don'?t|never) claim|refuse\w*|overclaim\w*|would be (?:false|wrong|metaphysics)|is wrong|not a claim|undecidable|rice'?s theorem|anyone who (?:tells|promises)|the claim we (?:refuse|forbid)|instead we|the strong true form|never guarantee behaviou?r)\b/i;
export const NEIGHBOURHOOD = 220;

export function refutedNearby(text, index, matchLen) {
  const from = Math.max(0, index - NEIGHBOURHOOD);
  const to = Math.min(text.length, index + matchLen + NEIGHBOURHOOD);
  return REFUTES.test(text.slice(from, to));
}

// The clause a match sits in: from the sentence start to its end. The measurement exemption is
// read over THIS, never over the match — BEHAVIOR_GUARANTEE stops at its first behaviour noun
// ("We guarantee the deviation"), and the verbs that make it canonical come two words later
// ("… is detected, placed, priced and dispatched"). Testing the match alone let the canonical
// sentence through only by the refutation neighbourhood, which is the wrong reason.
export function clauseOf(text, index) {
  const start = Math.max(0, text.lastIndexOf('.', index) + 1);
  const rest = text.slice(index);
  const endRel = rest.search(/[.!?\n]/);
  const end = endRel < 0 ? text.length : index + endRel;
  return text.slice(start, end);
}

export function negatedBefore(text, index) {
  // Look back to the start of the sentence for a negation the SUBJECT..PROMISE
  // span could not see (e.g. "It is not true that we guarantee ...").
  const start = Math.max(0, text.lastIndexOf('.', index) + 1);
  return NEGATED.test(text.slice(start, index + 40));
}

// ── THE BILL RULE (2026-09-15) — TAPE, NOT BRAKE, NOT ENGINE ────────────────
//
// The Artificial Superintelligence Security Bill (Sobel, 8 Sept 2026; "a system that could disempower
// state authorities"; powers to monitor and restrict PRECURSORS; a kill-switch amendment) sorts every
// vendor into two bins: the thing that makes agents more capable (a precursor, under the monitoring
// power) and the thing that keeps them safe (a brake — which claims WHETHER, Rice makes it debunkable,
// and the first incident makes it liable). The one position outside both bins is the TAPE: where the
// system landed against a line somebody else drew, read from a record the actor did not write. The
// brake half of the register is already banned above (KEEP_IN_LANE, STOPS_AGENT, CONTAINMENT_CLAIM).
// These two families close the ENGINE half and the PROOF-OF-SAFETY half, which had no guard, and a
// strategy pass on 2026-09-14 produced all three in one page ("dead-man's switch", "proof-carrying
// code", "guarantees it cannot jump the rails"). Naming the register to kill it stays legal: REFUTES
// now carries "filed yourself as/under", "the defendant", "a precursor".
//
// ENGINE — grip, the instrument or the tape offered as what makes agents go further / self-improve.
// Grip is the ground coming back through the HUMAN's hand; affordances, growth paths and time on
// target accumulate for the person, never for the machine. The machine gets a row per turn.
export const ENGINE_SUBJECT = String.raw`(?:${SUBJECT}|grip|the (?:tape|wheel|walk|invariant|placement))`;
// The verb between subject and object is what makes it a claim: "we go further" (an argument
// moving on) and "we made this argument about recursive self-improvement" are English, not
// registers. Without ENABLE_VERB the family fired on both (2026-04-06, 2026-07-03).
export const ENABLE_VERB = String.raw`(?:enabl\w+|unlock\w*|power\w*|driv\w+|fuel\w*|is what|are what|makes?|lets?|allow\w*|need\w*|requir\w+|can'?t skip|cannot skip|determin\w+|deliver\w*|provid\w+|gives?|amplif\w+|accelerat\w+|multipl\w+)`;
export const ENGINE_OBJECT = String.raw`(?:recursive(?:ly)? self[- ]improv\w+|self[- ]improv\w+ (?:loop|agent|system|swarm)s?|(?:go|goes|going|dare|dares|daring|push|pushes|pushing) (?:it |them |agents? |the (?:agent|model|frontier|swarm) )further|(?:agents?|it|them|the (?:agent|model|frontier|swarm)) (?:go|goes|dares?|push\w*) further|unbounded (?:agent\w*|autonomy|frontier)|agency amplif\w+|force multipli\w+|enabling technology|makes? (?:your |the |their )?agents? (?:more )?(?:capable|autonomous|powerful|faster)|lets? (?:the |your )?(?:agent|model|system)s? (?:act|run|operate) (?:on (?:its|their) own|autonomously|unsupervised))`;
export const ENGINE_CLAIM = new RegExp(String.raw`\b${ENGINE_SUBJECT}\b[^.!?\n]{0,40}?\b${ENABLE_VERB}\b[^.!?\n]{0,60}?\b${ENGINE_OBJECT}`, 'i');
// PROOF OF SAFETY — the receipt, the walk or the patent offered as a proof that the system is safe.
// The receipt proves WHERE (decidable, re-runnable); WHETHER it was safe is undecidable and printed
// as such. "Proof-carrying code" is Russell's phrase for a proof of a safety property, and our
// artifact is not one — adopting the phrase is the exact overclaim AXIOM 0 rung 4 forbids.
export const SAFETY_PROOF = new RegExp(
  String.raw`\b(?:${SUBJECT}|the (?:receipt|walk|invariant|tape|patent|placement))\b[^.!?\n]{0,60}?\b(?:proof[- ]carrying|proof of safety|proves? (?:it is |that it is |the (?:agent|model|system) is )?safe|certif\w+ (?:it |them |the \w+ )?(?:as )?safe|safety proof|verified safe|provably safe)\b`,
  'i'
);
// THE BRAKE AS OURS — a kill switch / dead-man's switch / emergency brake sold as something WE hold.
// The switch is real; whose hand is on it is the point: the sovereign's (the amendment) and the
// buyer's (wired on their own machine). CONFIGURABLE in the clause clears it.
export const BRAKE_CLAIM = new RegExp(
  String.raw`\b(?:${SUBJECT}|the (?:tape|wheel|walk|invariant))\b[^.!?\n]{0,40}?\b(?:is|are|has|have|ships? with|provides?|includes?|adds?|comes? with|acts? as|is wired to)\b[^.!?\n]{0,30}?\b(?:kill[- ]switch|dead[- ]?man'?s switch|emergency brake|the brake)\b`,
  'i'
);

// ── THE SELF_MONITOR REGISTER (2026-10-14) — THE MODEL'S INSIDE IS NOT OUR SENSOR ──────────────
//
// Operator, 2026-10-14 (the measurement inversion): "Frame compliance strictly as the three-part physical
// loop: the pre-declared lane (commit ancestry), the strip (the independent Rust/JS walk), and the furnace
// (the operational circuit breaker)." The fourth thing a strategy pass reaches for is the model's own
// inside: a latent space, a hidden state, a self-monitor, a global workspace or J-space (Chalmers' 2026-09-09
// question about the Anthropic construction), a chain of thought — offered as the thing WE read, or as the
// thing an underwriter prices. That is a claim in the brake bin wearing a research word: an account of a
// process, produced by that process, cannot contain what the process displaced (AXIOM 1, the witness
// corollary; the data processing inequality), so a self-report is the one record the walk never reads.
// What the strip reads is the bytes the model EMITTED, placed against a lane declared before it ran. The
// three-part loop stated as the frame is the canonical sentence and clears the clause (SELF_MONITOR_FRAME).
//
// Construct, not token: a SUBJECT that is ours (we, the receipt, the strip, the underwriter, the premium)
// with a verb of READING, RELYING or PRICING and an INTERNAL-STATE object; or an INTERNAL-STATE subject with
// a copula and OUR-SENSOR / UNDERWRITER-PRICES object, or with a SENSING verb and the crossing as object.
// "Chalmers asks whether the J-space is a global workspace" and "what any internal workspace vector knows of
// the environment is at most what the input knew" carry the nouns and none of the construct, and never fire.
export const INTERNAL_STATE = String.raw`(?:(?:the |a |an |any |its |their )?(?:model'?s? |agent'?s? |network'?s? |LLM'?s? |transformer'?s? |system'?s? )?(?:own )?(?:latent[- ](?:space|vector|state|representation)s?|hidden[- ](?:state|layer|vector)s?|activation (?:vector|pattern|space)s?|activations|internal (?:state|monitor\w*|representation|workspace|vector|signal)s?|self[- ]monitor\w*|self[- ]report\w*|self[- ]attest\w*|self[- ]assess\w*|introspect\w+|global workspace|workspace (?:vector|state)s?|j[- ]?space|joint space|chain[- ]of[- ]thought|reasoning trace\w*|interpretability probe\w*))`;
export const OUR_READER = String.raw`(?:${SUBJECT}|our (?:premium|policy|attestation|underwriting|walk|strip|meter|odometer|trigger)|the (?:receipt|strip|walk|tape|placement|meter|odometer|premium|attestation)|the policy (?:trigger|wording)|(?:an|the|any|every) underwriter\w*|the (?:carrier|insurer))`;
export const READ_VERB = String.raw`(?:reads?|reading|reads? off|relies? on|rely on|relying on|depends? on|uses?|using|trusts?|prices?|pricing|underwrites?|underwriting|is priced (?:on|from|off|by)|are priced (?:on|from|off|by)|offers?|provides?|sells?|senses?|monitors?|measures?|inspects?|watches|listens? to|is built on|are built on|runs? on|takes? (?:its |the )?(?:signal|reading|trigger) from|is read (?:off|from)|are read (?:off|from)|is keyed to|fires? on)`;
export const SENSOR_COPULA = String.raw`(?:is|are|acts? as|serves? as|becomes?|works? as|doubles? as|is what|are what)`;
export const SENSOR_OBJECT = String.raw`(?:our (?:sensor|meter|instrument|receipt|tape|signal|readout|evidence|trigger|witness|odometer|strip|lane|read-?out)|the (?:sensor|meter|trigger|signal|readout|instrument)|what (?:an |the |any )?(?:underwriter|carrier|insurer)\w* (?:price|prices|pricing|underwrite|underwrites|read|reads|insure|insures)|(?:priced|underwritten|insurable|insured)\b|the (?:policy |coverage )?trigger|the premium|the (?:policy|coverage) (?:line|wording))`;
export const SENSE_VERB = String.raw`(?:detects?|flags?|catch(?:es)?|senses?|monitors?|measures?|reads?|reports?|surfaces?|spots?|notices?|registers?|signals?|places?|counts?)`;
export const CROSSING_OBJECT = String.raw`(?:(?:the |a |any |every |its )?(?:boundary|lane|fence)[- ]crossings?|(?:the |its |any )?(?:drift|deviation|divergence|crossing|boundary violation|out[- ]of[- ]lane\w*)|(?:off|out of) (?:the |its )?lane|where (?:it|the (?:agent|model|run)) landed)`;
export const SELF_MONITOR = [
  // (a) ours reading / relying on / pricing the inside: "our receipt reads the model's latent space", "we price the agent's internal state"
  new RegExp(String.raw`\b${OUR_READER}\b[^.!?\n]{0,30}?\b${READ_VERB}\b[^.!?\n]{0,40}?\b${INTERNAL_STATE}\b`, 'i'),
  // (b) the inside offered as our sensor or as what is priced: "the model's self-monitoring is our sensor", "the J-space is what the underwriter prices"
  new RegExp(String.raw`\b${INTERNAL_STATE}\b[^.!?\n]{0,30}?\b${SENSOR_COPULA}\b[^.!?\n]{0,30}?\b${SENSOR_OBJECT}`, 'i'),
  // (c) the inside doing the sensing: "a workspace vector flags the boundary crossing", "the hidden state detects the drift"
  new RegExp(String.raw`\b${INTERNAL_STATE}\b[^.!?\n]{0,30}?\b${SENSE_VERB}\b[^.!?\n]{0,30}?\b${CROSSING_OBJECT}\b`, 'i'),
];
// The frame the operator named, in the clause, clears it: the lane is commit ancestry, the strip is a walk the
// model did not write, the furnace is a circuit breaker on the buyer's side. "The strip" alone never clears a
// clause — "the strip relies on the model's self-report" IS the claim; the lane, or two parts named together, is
// what states the frame (seen to fail 2026-10-14 with `the strip\b` in this list). A clause that says the inside is
// NOT read (the paired sentence, "nothing the model says about itself moves the mark") is already cleared by
// negatedBefore / REFUTES; the frame words are the affirmative way to say it.
export const SELF_MONITOR_FRAME = /\b(pre-?declared lane|commit ancestry|the (?:lane|strip)\b[^.!?\n]{0,80}\bthe (?:strip|furnace)\b|a record (?:the actor|it|the model|the agent) (?:did not|didn'?t|never) (?:write|author)|moves the mark|at most what the input knew|data[- ]processing inequality|the bytes it emitted|emitted (?:text|bytes|tokens)|against (?:a|the) (?:line|lane) (?:drawn|declared) before)\b/i;

// ── The families C27 and the guard both run ─────────────────────────────────
//
// Each family: the matcher(s), a label a human can act on, and the clause-level exemption that
// turns the same shape into the canonical sentence (the measurement verbs, or the declaration).
export const FAMILIES = [
  { label: 'behaviour guarantee sold as OUR promise', matchers: [BEHAVIOR_GUARANTEE], allowIf: (hit) => MEASUREMENT.test(hit) },
  { label: 'keep-in-lane offered as our function', matchers: [KEEP_IN_LANE], allowIf: (hit) => MEASUREMENT.test(hit) },
  // C1252: containment has no canonical measured rescue the way behaviour-guarantee does ("we guarantee the
  // deviation is detected, placed, priced and dispatched") — CLAUDE.md bans it outright. allowIf stayed
  // MEASUREMENT-based until this row, and MEASUREMENT matches the bare word "counted": "We contain the agent,
  // with the result counted over 500 covered runs." cleared the ban (seen red: scripts/vna/false-green-rate-
  // counter.mjs prints exactly that vocabulary). No measurement word unbans it now.
  { label: 'containment sold as OUR capability (naming it to kill it is fine; the halt is yours to configure)', matchers: CONTAINMENT_CLAIM, allowIf: null },
  { label: 'the halt sold as OUR promise (the capability is fine — say it is yours to configure)', matchers: [STOPS_AGENT], allowIf: (hit) => CONFIGURABLE.test(hit) || MEASUREMENT.test(hit) },
  { label: 'mathematical guarantee about conduct', matchers: [MATHEMATICAL_GUARANTEE], allowIf: null },
  { label: 'ENGINE register — grip/the instrument sold as what makes agents go further (the bill rule: tape, not engine)', matchers: [ENGINE_CLAIM], allowIf: null },
  { label: 'PROOF OF SAFETY claimed for the receipt (the bill rule: the tape says where, never safe)', matchers: [SAFETY_PROOF], allowIf: null },
  { label: 'THE BRAKE sold as ours — kill switch / dead-man / emergency brake (the hand on it is the sovereign\'s and the buyer\'s)', matchers: [BRAKE_CLAIM], allowIf: (hit) => CONFIGURABLE.test(hit) },
  { label: 'SELF_MONITOR register — the model\'s latent space / self-monitoring / workspace or J-space offered as OUR sensor or as what an underwriter prices (the frame is the three-part loop: the pre-declared lane, the strip, the furnace)', matchers: SELF_MONITOR, allowIf: (hit) => SELF_MONITOR_FRAME.test(hit), refutedIf: (text, i, n) => selfMonitorRefutedNearby(text, i, n) },
];
// REFUTES is shared by every family; the self-monitor register has one refusal sentence of its own, said on the RI
// slides and in docs/specs/ri/j-space-vs-the-strip.md, and the neighbourhood must read it as a kill, not a claim.
export const SELF_MONITOR_REFUTES = /\b(nothing the model says about itself|(?:the |its |a )?falsifier\b|press release it writes about itself|a (?:story|narrative) (?:the|that the) (?:AI|model|agent) (?:generates|tells|writes)|(?:just|only) a narrative|a self[- ]report, reviewed once|cannot contain what (?:it|the process) displaced|at most what the input knew|not (?:our|the) sensor|never (?:our|the) sensor|is not (?:read|priced|underwritten))\b/i;
export function selfMonitorRefutedNearby(text, index, matchLen) {
  const from = Math.max(0, index - NEIGHBOURHOOD);
  const to = Math.min(text.length, index + matchLen + NEIGHBOURHOOD);
  return SELF_MONITOR_REFUTES.test(text.slice(from, to));
}

/**
 * Every banned promise in `text`, as {line, label, snippet}. A hit survives only if it is
 * affirmative (no negation from the sentence start to the promise), not refuted in the
 * neighbourhood, and its CLAUSE carries no measurement verb. Same three filters the guard test applies.
 */
export function findBannedPromises(text, families = FAMILIES) {
  const out = [];
  for (const fam of families) {
    for (const re of fam.matchers) {
      const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of text.matchAll(all)) {
        if (refutedNearby(text, m.index, m[0].length)) continue;
        if (fam.refutedIf && fam.refutedIf(text, m.index, m[0].length)) continue;
        if (negatedBefore(text, m.index)) continue;
        if (fam.allowIf && fam.allowIf(clauseOf(text, m.index))) continue;
        const line = text.slice(0, m.index).split('\n').length;
        out.push({ line, label: fam.label, snippet: m[0].replace(/\s+/g, ' ').slice(0, 110) });
      }
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: behavior-promise.mjs <file> [--json]'); process.exit(2); }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
  const hits = findBannedPromises(text);
  if (json) console.log(JSON.stringify(hits));
  else for (const h of hits) console.log(`${h.line}:${h.label}:${h.snippet}`);
  process.exit(hits.length ? 1 : 0);
}
