// THE PUBLIC-SURFACE REGISTER — THE CAMOUFLAGE RULE (operator 2026-09-19). One place for what the two package READMEs
// and their store descriptions may and may not say.
//
// Camouflage that works is TRUE at every rung the host checks: dull, useful before it is trusted, and never announcing
// what it is. The presentation of this system is judged on four counts:
//   THE COUCH  — the surface opens in the host's world and words (a cost, a re-read, a crash made countable), never
//                with the theorem and never with the posture underneath.
//   THE FIRST COMMAND — utility before trust: a runnable line the reader can act on precedes the first theorem noun.
//                The surface does not present a case for its usefulness; it is useful first.
//   THE TELL   — the claws are visible to anyone who checks and announced to no one: a stranger-recomputable check
//                ("run it twice", "same bytes, same hash", "a record the actor did not write", "whether it was good is
//                undecidable") is on the page. To the host it reads as a QA step; to the right pole it is the whole
//                claim with its falsifier attached. A DOG WHISTLE HERE IS A LITERAL, CHECKABLE SENTENCE — it selects
//                for competence, never for a tribe. A joke about the enemy selects a tribe and repels the actuary, who
//                sits INSIDE the apparatus and is the right pole.
//   NO FIGHT, NO MANIFESTO, NO CAGE, NO BOAST — the four registers that break the camouflage:
//     PREDATOR  — the camouflage names itself (insurgent, predator, lethal, weaponized, feral, apex, and the animal the
//                 operator banned outright on 2026-09-19: "never say cat or mice" — the metaphor is itself the leak).
//     MANIFESTO — the surface explains the posture underneath it or instructs the host ("say this out loud", "the one line to hold",
//                 "the moat", "the trick was never").
//     FIGHT     — the reader is the accused ("before you attack", "your probe", "your first reflex", "you are
//                 confusing"). Accused ≠ audience; the surface never fights the reader.
//     CAGE      — containment / confinement / a "constraint enforcer" / "un-hackable" / a boundary an agent
//                 "physically can't" leave, offered as ours. CLAUDE.md: TAPE, NOT BRAKE; never "containment" as OUR
//                 function. The behavior-promise construct (scripts/voice/behavior-promise.mjs) needs a first-person
//                 subject and missed every one of these because they rode noun phrases — this is the noun-phrase half.
//     BOAST     — "deterministic"/"determinism" bare. Operator 2026-09-18: "determinism means chaos; anyone who says they
//                 have determinism is going to blow you off; we don't use that word" · "use it but make fun of it". The
//                 word is what every vendor says and a hostile reader disproves in one step — it is the WOLVES' dog
//                 whistle: it attracts the loud and repels the awake. Quoted, as someone else's claim held up, allowed.
// Fenced code blocks are exempt from every family: captured CLI output is the tool's record, not our copy. CLI strings
// still carrying the word are named debt: scripts/pmu/attest.mjs "(deterministic gate)", scripts/pmu/prove.mjs
// "calibration · determinism · your-repo". (hooper.mjs C2 was renamed BYTE-IDENTICAL with this file.)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOOR_LABEL } from './door-audit.mjs';   // C111: sidebarPrimaryLabels resolves a primary painted from a door constant
import { NOTARISE_BASE, CHECKOUT_URL, MARKETPLACE_ID, MARKETPLACE_URL } from '../../src/lib/auth/notary-seat-checkout.mjs';   // C154: moved there, re-exported below — a Next page cannot import scripts/, this file can import src/lib

export const PUBLIC_SURFACES = ['packages/thetacog-mcp', 'packages/thetacog-mcp-vscode'];

// THE SURFACE MAP (operator 2026-09-19: "map the surfaces for the extension to move all ways it needs to"). The extension's
// reader arrives from one of four directions — the host (dev, marketplace, sidebar), the auditor (CLI output, registry,
// changelog), the underwriter (terms, LOI, /pricing, diligence) and the passer-by (iamfim, /cta) — and every text surface on
// the way is one of three kinds:
//   copy    — ours, now; every family asserted at zero.
//   record  — dated or printed by the tool (changelog entries, CLI output); rewriting it would falsify it, so the count is
//             a FLOOR that may only fall — new entries obey, old ones stand.
//   legal   — licence terms and the LOI; wording is deny-first (CLAUDE.md), so the same floor, and the lines are named.
//   anvil   — /cta, where "deterministic" is the SUBJECT the page hands the reader to trip on (voice-and-pitch L59): mention,
//             not use; floored so it cannot quietly become use.
// Measured 2026-09-19 before the copy fixes: iamfim 1/1/0/1/1 · DILIGENCE 1 · prove.mjs 6 · terms 2 · cta 18 · changelog 15/0/1/0/2.
export const SURFACE_MAP = [
  { path: 'packages/thetacog-mcp-vscode/README.md',     reader: 'host',        kind: 'copy' },
  { path: 'packages/thetacog-mcp-vscode/package.json',  reader: 'host',        kind: 'copy' },
  { path: 'packages/thetacog-mcp-vscode/src/vna-view.ts',    reader: 'host',   kind: 'copy' },
  { path: 'packages/thetacog-mcp-vscode/src/vna-steer.ts',   reader: 'host',   kind: 'copy' },
  { path: 'packages/thetacog-mcp-vscode/src/vna-cockpit.ts', reader: 'host',   kind: 'copy' },
  { path: 'packages/thetacog-mcp-vscode/src/extension.ts',   reader: 'host',   kind: 'copy' },
  { path: 'scripts/vna/controls.mjs',                   reader: 'host',        kind: 'copy' },
  { path: 'scripts/vna/legend.mjs',                     reader: 'auditor',     kind: 'copy' },
  { path: 'packages/thetacog-mcp/README.md',            reader: 'host',        kind: 'copy' },
  { path: 'packages/thetacog-mcp/package.json',         reader: 'host',        kind: 'copy' },
  { path: 'packages/thetacog-mcp/DILIGENCE.md',         reader: 'underwriter', kind: 'copy' },
  { path: 'packages/thetacog-mcp/REGISTRY.md',          reader: 'auditor',     kind: 'copy' },
  { path: 'src/app/pricing/page.tsx',                   reader: 'underwriter', kind: 'copy' },
  { path: 'src/app/iamfim/page.tsx',                    reader: 'passer-by',   kind: 'copy' },
  { path: 'scripts/pmu/prove.mjs',                      reader: 'auditor',     kind: 'record', floor: { BOAST: 0 } },
  { path: 'scripts/pmu/attest.mjs',                     reader: 'auditor',     kind: 'record', floor: { BOAST: 1 } },   // "(deterministic gate)" check label
  { path: 'scripts/pmu/hooper.mjs',                     reader: 'underwriter', kind: 'record', floor: { BOAST: 3 } },   // a comment + the identifier; C2 prints BYTE-IDENTICAL
  { path: 'packages/thetacog-mcp/CHANGELOG.md',         reader: 'auditor',     kind: 'record', floor: { BOAST: 15, FIGHT: 1, PREDATOR: 2 } },
  { path: 'docs/legal/agent-year-license-terms.md',     reader: 'underwriter', kind: 'legal',  floor: { BOAST: 2 } },   // §1.2 and §10.1 — the operator's call
  { path: 'docs/legal/loi-template.md',                 reader: 'underwriter', kind: 'legal',  floor: {} },
  { path: 'src/app/cta/page.tsx',                       reader: 'passer-by',   kind: 'anvil',  floor: { BOAST: 18 } },
];

// THE THREE READERS (operator 2026-09-19, "extension surfaces"): the extension is read by three people and each must find
// exactly their thing and nothing else. The COMMITTEE finds no ledge (every family at zero — the surface map above). The
// BUILDER finds a handhold only where work is done — a command, a painted control, a number — never rhetoric. The UNDERWRITER
// finds the door that closes on the debate — the record the actor did not write, the hash, the three verdicts. The reader
// sees the SIDEBAR, not its source files, and C89b decided the proof sentence appears once (renderPanels points at it), so
// the sidebar is judged as ONE surface: its sources concatenated. The marketplace listing and the README are judged alone.
export const EXTENSION_SURFACES = {
  'the sidebar': ['packages/thetacog-mcp-vscode/src/vna-view.ts', 'packages/thetacog-mcp-vscode/src/vna-steer.ts', 'packages/thetacog-mcp-vscode/src/vna-cockpit.ts', 'packages/thetacog-mcp-vscode/src/extension.ts', 'scripts/vna/controls.mjs', 'scripts/vna/legend.mjs'],
  'the marketplace listing': ['packages/thetacog-mcp-vscode/package.json'],
  'the README': ['packages/thetacog-mcp-vscode/README.md'],
};
export const BUILDER_HANDHOLD = /npx |`npm i|⚡ Run Headless|💳 Notarize|📋 Copy Run Summary|📄 View Unit Contract|🧠 Copy Prompt Bundle|📥 Ingest Refined Goal|"command": "vna\./;
export const UNDERWRITER_DOOR = ['a record the actor did not write', 'three verdicts and the hash', 'same bytes, same hash', 'undecidable, not unplaced', 'run it twice', 'placed, never judged'];
export const readerTest = (repo, paths) => {
  const t = paths.map((p) => readFileSync(resolve(repo, p), 'utf8')).join('\n');
  const doors = whistlesOn(t).filter((w) => UNDERWRITER_DOOR.includes(w));
  return { builder: BUILDER_HANDHOLD.test(t), doors, committee: Object.fromEntries(Object.entries(FAMILIES).map(([n, re]) => [n, hits(n === 'BOAST' ? stripQuoted(t) : t, re).length])) };
};

/** every family's count on one surface, fences blanked, the quoted use stripped for BOAST */
export function familyCounts(repo, path) {
  let t = readFileSync(resolve(repo, path), 'utf8'); if (path.endsWith('.md')) t = stripFences(t);
  const out = {}; for (const [name, re] of Object.entries(FAMILIES)) out[name] = hits(name === 'BOAST' ? stripQuoted(t) : t, re).length;
  return out;
}

export const BOAST = /determinis/i;
export const PREDATOR = /\binsurgen\w*|\bpredator\w*|\blethal\b|\bweaponi[sz]ed?\b|\bferal\b|\bapex\s+(?:hunter|predator)|\bkill[- ]success|\bsovereign\s+insurgent|\bcats?\b(?!\s+bonds?\b)|\bmice\b|\bmouse\b|\bfeline\b/i;   // "cat bond" is insurance's word for a catastrophe bond — a different construct, the one exclusion
export const MANIFESTO = /say this out loud|the one line to hold|\btop of mind\b|\bthe moat\b|\bis the moat\b|the moat's|the trick was never|secret sauce|\bunfair advantage\b/i;
export const FIGHT = /\byour? (?:attack|probes?\b|first reflex|are confusing|were attacking)|becomes confirmation|hunting a gotcha|dismiss the whole thing/i;
export const CAGE = /\bcontainment\b|\bconfinement\b|constraint enforcer|\bun-?hackable\b|physically can'?t|can(?:no|')t wander/i;
// INVERTED — boring AND wrong: a whistle the expert checks and finds backwards loses the right pole, which is worse than
// loud. "zero cache misses" as a goal inverts AXIOM 0 (the miss IS the read-out — a dependent load's latency is how a
// placement is observed; zero misses removes the instrument) and merges the PMU homonym. "is it compressible" as a slop
// detector is backwards too (slop compresses WELL — word-salad passes in-lane at higher σ; that is the fence) but has no
// regex-shaped form worth the false positives, so it lives only in the firing test as a rejected example.
export const INVERTED = /\bzero cache misses\b|\bno cache misses\b|optimi[sz]\w+ for (?:zero|no) (?:cache )?misses/i;
export const FAMILIES = { BOAST, PREDATOR, MANIFESTO, FIGHT, CAGE, INVERTED };

// THE TELL — the whistle roster. Each is literal, dull to the host, and carries its own check. The regex is the
// construct's minimal form; the two readings are documented so the next surface can carry one without explaining it.
export const WHISTLES = [
  { name: 'run it twice',            re: /run (?:it )?twice|run twice/i,                                   host: 'a QA step',              pole: 'the whole reproducibility claim with the falsifier in the imperative' },
  { name: 'same bytes, same hash',   re: /same bytes|same hash|byte-?identical|byte-for-byte/i,           host: 'a technical footnote',   pole: 'the only sense of "deterministic" that survives a hostile read, named as a test instead of an adjective' },
  { name: 'undecidable, not unplaced', re: /undecidable/i,                                                host: 'a modest disclaimer',    pole: 'Rice 1953 drawn as a boundary exactly where the eval vendors pretend there is none' },
  { name: 'a record the actor did not write', re: /did not write(?: alone)?|actor did not (?:write|author)/i, host: 'audit phrase',       pole: 'the data-processing inequality: a log from inside the boundary cannot contain what the process displaced' },
  { name: 'the crash made countable', re: /crash countable|made the crash countable|collision countable/i, host: 'a history anecdote',    pole: 'we do not sell safety, we sell the countable loss — the thing an underwriter prices' },
  { name: 'the tug that skipped the radio', re: /T\.?\s?J\.? Hooper|skipped the radio|tug (?:that|with no) radio/i, host: 'nautical colour', pole: 'Hand 1932: available + cheap → not using it is negligence' },
  { name: 'measurement free, underwriting paid', re: /measurement is free|underwriting is paid|free to install/i, host: 'a price list',   pole: 'no behaviour guarantee is ever coming, and the vendor said so in the pricing' },
  { name: 'no model in the path',    re: /no model in the path|0% model|model-free|LLM-free|zero LLM/i,   host: 'a speed stat',           pole: 'the receipt has no LLM in it, which is the only reason a stranger can recompute it' },
  { name: 'placed, never judged',    re: /WHERE[^.\n]{0,40}not WHETHER|placed,? (?:never|not) judged|where[^.\n]{0,30}landed/i, host: 'scope modesty', pole: 'the fence drawn on purpose — region, not stance' },
  { name: 'a cache miss is a cache miss', re: /a cache miss is a cache miss/i,                          host: 'a truism',                pole: 'the substrate has no field for which kind of operator produced the instruction — the two-markets argument in six words' },
  { name: 'how it prices out',      re: /prices? (?:it )?out|what (?:it )?would cost to insure|is it insurable/i, host: 'a budget line',         pole: 'if it is debatable it is not insurable — someone either prices it or refuses, and that is the check' },
  { name: 'prove it out',            re: /prove (?:it|that) out|proves? out on your machine/i,                  host: 'a due-diligence step',      pole: 'the second beat — the conversation moved onto what a stranger can recompute, never onto the model\x27s soul' },
  { name: 'against the null',       re: /against (?:the|its own) (?:null|shuffles?)|beats? its own shuffles?|shuffled null|permutation null/i, host: 'a stats question', pole: 'a placement is admitted only when the line beats its own shuffles — the permutation ratchet' },
  { name: 'the integrity of the ruler',  re: /integrity of the ruler|liab\w+ for the ruler/i,                    host: 'a QA-department sentence',  pole: 'a bounded, priceable duty — the ruler, never the soul of the model; naming the residual is what makes it stand up in a deposition' },
  { name: 'three verdicts and the hash', re: /in lane, off lane,? or unmeasured|matched,? (?:off-lane|did not match),? or unmeasured/i, host: 'a status legend', pole: 'the third verdict is the residual named out loud — hide it and you are another party claiming to know' },
  { name: 'what the binder attaches to', re: /what (?:does )?the binder (?:actually )?attach(?:es)? to|what the underwriter binds to/i, host: 'a procurement question', pole: 'the object a solvent third party can sign — the broker\x27s own noun, not ours' },
  { name: 'a story vs an address',      re: /(?:object|receipt|record) is an address|a story\. (?:this|the) (?:object|receipt) is an address/i, host: 'a figure of speech', pole: 'AXIOM 0 — positions are addresses; a story can be restated, an address can be pointed at' },
  { name: 'the quoted "deterministic"', re: /["“][^"”\n]*determinis[^"”\n]*["”]/i,                       host: 'a compliance word',      pole: 'the word held up as someone else\'s claim, deadpan — the only permitted use' },
];
export const MIN_WHISTLES = 4;

// THE PAID THING, stated the same way on every surface (operator 2026-09-19, dictated: "lead with the dev value prop; the
// backup of the attested tape is the licence — 10k actions, pinned to the compute to store or analyse it"). The unit is a
// meter, not a seat: 10,000 actions = one agent-year at $0.002/attestation (the reconciliation already in the record), so
// the licence code's agent_years entitlement is the same quantity under its other name. The price is pinned to a cost basis
// (storage + re-walk), never to a loss — DONT-SELL-THE-DOWNSIDE in the unit itself.
// CORRECTED the same day (operator, mid-flight: what is sold is never storage, it is the STAMP — docs/specs/vna/LEFT-PANEL-MONOLOGUE-
// 2026-09-19.txt Part 3, Candidate 4 picked, Candidate 5 its tooltip shadow): the sentence LEADS with the second key's
// countersignature; the kept copy and the cost basis are clauses, in that order, after the deliverable. "backup" survives only
// in the URL. The 10,000-action unit and the never-a-breach clause stay, second.
export const LICENCE_UNIT = /10,000 actions/;
export const LICENCE_PINNED = /the price follows the compute of keeping and re-walking it, never what a breach costs/;
export const LICENCE_LEADS_WITH_STAMP = /The key buys a stamp: a second key countersigns the rows you already signed/;
export const LICENCE_TOOLTIP = 'A second key countersigns your receipt and keeps it where your lead can fetch and recompute it — paths and hashes, never the code.';   // Candidate 5, for the 💳 tooltip
// C97f (operator 2026-09-19: "push the checkout to the notarise this tape page on the site, instead of upload tape"): the 💳
// opens THIS href and no other — the site page that names the tape by its key fingerprint and height and sells the stamp.
// The upload door (/backup?manifest=) is never a control's target again; the upload is programmatic (scripts/vna/notary-drain.mjs).
// C138 (operator 2026-09-21: "never miss an opportunity to 1) link to checkout licenses 2) show logged in or not and how many
// licenses left"): the checkout door is the same page, named once. Every surface the extension paints or copies out — the README
// hero, recipe step 2, the close of "Where this sits", the handoff, composeLine()'s unlicensed states, the sidebar's live line and
// the cards' + drawers — carries THIS string; never a second host, never a retype. Never "free trial"/"freemium": the measurement is
// free (MIT), the stamp is the paid thing.
// C154 (2026-09-21): NOTARISE_BASE/CHECKOUT_URL moved to src/lib/auth/notary-seat-checkout.mjs — read that file's C154 comment
// for why (LedgerDoor.tsx, the site's global checkout+login bar, mounts in the root layout; a Next page cannot import
// scripts/). Imported here for local use (NOTARISE_HREF below) and re-exported byte-identical, the same pattern as
// creditsPerUnit/countLine/WHY_YOU_PAY further down this file.
export { NOTARISE_BASE, CHECKOUT_URL };
// 2026-09-21 (operator: "the cta at the top of the book club is now going to be to review it on vscode … marketplace"): the listing's
// permanent URL — publisher.name from packages/thetacog-mcp-vscode/package.json; the ONE place the marketplace door is spelled.
// Cursor installs from Open VSX, a different registry — that door is added here the day the ovsx publish lands, never assumed.
// 2026-09-24: MARKETPLACE_ID/URL moved to src/lib/auth/notary-seat-checkout.mjs (the iamfim ledger door needs it from the root layout) — re-exported byte-identical.
export { MARKETPLACE_ID, MARKETPLACE_URL };
// 2026-09-21, later (operator: "if cursor can install it from our website do that … eclipse is being silly"): Cursor, VSCodium and
// Windsurf read Open VSX, whose publisher agreement sits behind an Eclipse account; the door that needs nobody's agreement is the
// same .vsix served from our own site — public/vsx/ (index.html = the two-step, the versioned file + its sha256, and -latest).
// The ONE place the Cursor door is spelled. The Open VSX listing is still the better door; scripts/publish-ovsx.sh is ready for it.
export const VSIX_URL = 'https://thetadriven.com/vsx';
export function NOTARISE_HREF(fp, h) {
  const f = String(fp || '').trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(f)) throw new Error('NOTARISE_HREF: fp must be the 16-hex fingerprint of the tape\'s key');
  const n = Number(h); const height = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  return `${NOTARISE_BASE}?fp=${f}&h=${height}`;
}
// C99c THE COUNT IS READ OFF THE PRICE (2026-09-19): how many countersignatures one licence buys is the Stripe price object's
// `metadata.credits_per_unit`, read at checkout time and carried on the session into C84c's delta — never typed. The three
// surfaces that say it (/notarise, the README boundary, the card) print THIS line from THAT read, or UNMEASURED. The reader
// and the line both live in the checkout module (src/lib/auth/notary-seat-checkout.mjs — the same file the session builder
// uses; a Next page cannot import scripts/, so the pure half lives under src/ and this register re-exports it). One function,
// three surfaces: the page and the session cannot disagree. Money is the price's unit_amount, never a typed "$20".
export { creditsPerUnit, countLine, COUNT_UNMEASURED } from '../../src/lib/auth/notary-seat-checkout.mjs';
// C102f THE CHECKOUT SAYS WHY YOU PAY, NOT WHY YOU DOWNLOADED (operator 2026-09-20: "it has to be clear instantly: it's not why
// you downloaded it, it's why you're going to give it money"): WHY_YOU_PAY — three sentences, SUPPORT · LOCAL · LATER, in that
// order, the only prose between the tape's name and the button on /notarise and the card's + tier under the 💳 (C103d),
// byte-identical. Written once in the checkout module (the page imports from there; a Next page cannot import scripts/),
// re-exported here for the card — the same pattern as countLine. Never safe / prove / guarantee, never a typed count.
// C103c THE CHECKOUT OPENS AT ONCE: the page's price read is the COMMITTED receipt (NOTARY_PRICE_RECEIPT, read synchronously by
// notaryPriceFromReceipt), written by scripts/vna/notary-price-receipt.mjs --write; Stripe is consulted at checkout time only.
export { WHY_YOU_PAY, NOTARY_PRICE_RECEIPT, priceReceipt, notaryPriceFromReceipt } from '../../src/lib/auth/notary-seat-checkout.mjs';
// C109d THE NAME IS THE SENTENCE, NOT THE ACRONYM (operator 2026-09-20: "calling it vna looses the opportunity to say ThetaCog Steer:
// Double Entry for Autonomous - where the work landed // thats better") — one constant for the page <title>, the sidebar container,
// package.json displayName, the README H1 and the marketplace description's first clause (C89d: one text). VNA stays in command ids,
// env vars, paths and file names only — never on a face, a title or the README's visible text. C109d.2 (operator 2026-09-20,
// "vna is fun to say, but naming it can be done better?" · "double entry for autonomy - better?" · "ThetaCog Steer: Double Entry for
// Autonomy"): AUTONOMY, the noun — the same word C114's tagline uses ("Double-entry bookkeeping, for autonomy"), one word on every surface.
export const STEER_NAME = 'ThetaCog Steer: Double-Entry Bookkeeping for Autonomy';   // the tail — where the work landed — lives in the README and the view name, not in the name (operator 2026-09-20)
// C114 — DOUBLE-ENTRY BOOKKEEPING, THE DEFLATION POSTURE (operator 2026-09-20: "how do we land the hilarity of this is just double entry
// bookkeeping for autonomy?" · "Declare C114"). Three flat sentences, one constant each: the tagline on the panel header (after the
// /steer line), the deflation and the asymmetry on the README after the killshot. Invariants: zero meta-humour — the text never
// names the joke; codified, never invented (Pacioli 1494 codified what Venetian merchants already did); the asymmetry stated flatly
// (AXIOM 1 W3) — the not-funny half that makes the funny half credible.
export const DOUBLE_ENTRY_TAGLINE = 'Double-entry bookkeeping, for autonomy. The second column has a chip.';
export const DOUBLE_ENTRY_README = 'Nothing here is new. Merchants have caught drift with two columns since the 1400s; we gave the second column a chip and a signature.';
export const DOUBLE_ENTRY_W3 = 'The second entry is written by someone who is not the actor.';
// C109a THE COUNT CARRIES ITS NOUN (operator 2026-09-20: "0 countersigned ____ (lost opportunity for s/n we have to use the correct
// form everywhere … countersigned receipts / attestations / whatever will move licenses"). Every count on the panel and the README
// paints `<n> ${COUNTERSIGNED_NOUN}`, never a bare "countersigned"; the six-word why sits beside the count on the face (C109g's bar).
export const COUNTERSIGNED_NOUN = 'countersigned receipts';
export const COUNTERSIGNED_WHY = 'countersigned receipts are what move licences';
// §25's one sentence for the site, the sidebar and the listing — byte-identical wherever it appears (SPEC-VNA-COCKPIT.md §25)
export const STEER_IS_GOAL = '/goal is what you want finished. /steer is /goal with the record holding it — every ask a row, every row a guard, every commit placed, every worker cold-booted from the tree, and the session evicted when the goal closes.';
// C95a — /steer IS /goal++: the three pluses under the sentence, one line each, naming their control by its PAINTED label and
// no other (README before "## The recipe" + sidebar card 1, byte-identical from here). Never a fourth plus — the 💳 stamp is the
// second reader's door and comes after (C94). No theorem noun here: the hook sits before the README's first runnable line.
// The short form for the line OUTSIDE card 1's fold (C80b: outside ▸ more = one measure + one action; the sentence is copy) — DERIVED
// from the sentence, never a second string: the second clause of the first sentence pair, before the dash. The README and the listing
// may reuse it; the full sentence stays their hook. → "/steer is /goal with the record holding it"
export const STEER_IS_GOAL_SHORT = STEER_IS_GOAL.split(' — ')[0].split('. ')[1];
export const HOOK_PLUSES = Object.freeze([
  '+ the record — the paste becomes a spec row and a node on the tree · 📄 View Unit Contract',
  '+ the workers — one ephemeral worker per unit, booted cold from the snowball, six gates · ⚡ Run Headless',
  '+ the receipt — where the commit landed, the tokens not re-sent, the labour stamp · 📋 Copy Run Summary',
]);
// C124b (operator 2026-09-21: "Lead with cost directly, land why first, which is… the viral wedge" · "Replace 'Stop paying your AI
// to re-read your codebase every turn'"): the H1 names the COST in the host's own words — the unsigned autonomous code nobody can
// put a number on, never the token bill — and carries none of C99a's animal (the operator's own "uninsurable liability" is a body
// sentence, C124's hero, never a header). The token sentence lives under "### The machine pays for its own attestation" (C124.3).
export const DEV_VALUE_PROP = 'Flying, and it saves you tokens. How? Double-entry bookkeeping for autonomy';
// C103 — THE ONE SENTENCE THE EXTENSION SAYS ABOUT WHY (operator 2026-09-20, revised by his own words: "it really is just a
// station — just receipts; it is double-entry bookkeeping for your robot, which is why it feels like flying and saves you tons of
// tokens"). The register is DRY, never a joke. Beside the wedge on the README recipe and on card 2's ▸ more (C103b's tiers);
// the ratio it rests on is READ (C98c) and sits next to it — never typed here. Never "safe", never "prove" (C100a's ban holds).
// C94a (the ninth Bridge paste, 2026-09-20; operator: "you lead with flying double entry certainty — and yes it saves you tokens"):
// the paste's closing paragraph is the sentence, one clause corrected — "so perfectly constrained that you no longer have to check
// its work" → "checking it is one click, not a leap of faith" (a check the reader runs, never a check the reader is excused from);
// "immutable math" → "same bytes, same hash" (never "determinism"). Leads the listing (P1), closes the loop in five (C104b), sits
// under NEXT →'s + with the READ ratio beneath. The aside "and yes, it saves you tokens" is the README's next paragraph, not this constant.
// 2026-09-20, operator: "the flying needs better" — ONE sentence, the reader before the machine: their experience first (the window not
// re-sent, the loop keeping its place), then the because (the record; the second entry they recompute; the one-click check), then flying.
export const FEELS_LIKE_FLYING = 'You stop paying to re-send the whole conversation every turn, and the loop keeps its place while you are away, because the work lives on a record instead of in the window — every row with a second entry you can recompute, same bytes, same hash — and when checking it is one click, not a leap of faith, double-entry bookkeeping feels like flying.';
// ── C94a THE LISTING REGISTER — the extension page is the README (the marketplace renders it), graded from the ninth paste ────
// THE KILLSHOT (voice-and-pitch.md; operator: "it's what-if, and what would it be worth to you") — in P1 on every outward surface,
// PUFFY BY DESIGN: a what-if and a worth, never the asserted form ("vendors keep the counted version and sell you the fog" is a
// fact a hostile reader disproves), never a named lab's intent. The dev-world form of the rule's own sentence. One constant, so
// iamfim and the next surface import it instead of retyping it.
export const KILLSHOT = 'What if the counted version stayed wherever the money is, and the fog was what reached your editor? You do not want to live in that world. Neither do I, and that is how I am on your side. Ask any vendor what their own engineers run against their own repo, and then ask what it would be worth to know which world you are in.';
export const KILLSHOT_WHAT_IF = /\bwhat if\b[\s\S]*\bneither do I, and that is how I am on your side\b[\s\S]*\bworth\b/i;   // the verbatim form: what-if · neither do I, and that is how I am on your side · a worth
export const KILLSHOT_ASSERTED = /vendors (?:keep|hold|sell)|keeps? the (?:good|counted) (?:stuff|version) (?:for|to) (?:themselves|itself)/i;   // the asserted form, refused
// ── C156 THE SIX SECONDS — the viral hook (operator 2026-09-21, verbatim: "dev tools do not go viral on formal logic; they go
// viral on tactile relief … they forward it when they see a 6-second visual of a pain they suffered twenty minutes ago, solved in
// a way that feels unfair. /steer should be a verb — everything lines up"). ONE block, byte-identical on every public surface
// (the extension README, the npm README, the book-club lock) — the host's world first (the pain, second person, twenty minutes
// ago), then /steer as a VERB, then the tell: the Δ line in the shape the sidebar actually prints (lane-actions.mjs: "landed at
// <pixel> … N blocks from the basin"; vna-tail.ts: "landed <pixel>"). No behaviour promise (the halt stays theirs to wire — tape,
// not brake), no "determinis*", no "unfair" on the page (MANIFESTO bans the boast; the reader feels it or does not). "Six seconds"
// is the READ, never a claim about the walk's wall-clock (the panel walk is ~21 s on a commit).
export const SIX_SECONDS_PAIN = 'Twenty minutes ago you asked an agent for one CSS class. It came back green. The diff touched fourteen files, and you read fourteen files to find the one it should not have touched.';
export const SIX_SECONDS_VERB = 'Steer it.';
export const SIX_SECONDS_VISUAL = [
  'you    › /steer  one CSS class on the pricing card',
  'agent  › … fourteen files …',
  'Δ      › landed C1,B3 · Operations.Grid × Tactics.Signal · 6 blocks from the basin you declared',
  '       › 📋 Copy Run Summary — on the pull request before you open the diff',
].join('\n');
// C157 — the same six seconds as a looping GIF (never a <video> tag: Gmail, Outlook and Apple Mail strip native video), rendered
// by scripts/vna/six-seconds-gif.mjs from the three strings above; the frame script sits beside it and the guard reads it
// byte-for-byte against this register. Served from public/ — the URL is the one place, the READMEs and the lock point at it.
// C157.7 (operator 2026-09-25) — the pain line promises "the one it should not have touched" and never names it; the GIF's own
// punchline was the counter, not the file. THE CULPRIT is the fourth register string the GIF's final frame draws in red, large —
// the ONE file, named, so the payoff is legible on its own without reading the pain line first.
export const SIX_SECONDS_CULPRIT = '✗ pricing-card.css was asked for · checkout.ts was not';
export const SIX_SECONDS_GIF_URL = 'https://thetadriven.com/vna/six-seconds.gif';
export const SIX_SECONDS_GIF_ALT = 'Six seconds: the diff counter climbs to fourteen files in red — Steer it. — /steer typed, the agent line, then the Δ line placed and the Copy Run Summary door';
export const SIX_SECONDS_TAIL = 'Six seconds to read. Your own machine, no model in the path, and the row is placed before you go looking. Not a brake — the halt stays yours to wire. It is the second entry, written under a key that is not the actor\'s.';
/** the block as markdown (the READMEs) — the pain, the verb, the looping GIF (C157), a fenced visual, the tail */
export const sixSecondsMarkdown = () => `**${SIX_SECONDS_PAIN.split('. ')[0]}.** ${SIX_SECONDS_PAIN.split('. ').slice(1).join('. ')}

**${SIX_SECONDS_VERB}**

![${SIX_SECONDS_GIF_ALT}](${SIX_SECONDS_GIF_URL})

\`\`\`
${SIX_SECONDS_VISUAL}
\`\`\`

${SIX_SECONDS_TAIL}`;

// THE FOUNDER NOTE (C158, operator 2026-09-22: "kill the corporate we, enter Elias" — "the voice oscillates between a 19th-century
// maritime underwriter, an institutional patent attorney, and a newsletter editor"). First person singular, at most three sentences,
// a declaration of terms in the advice posture: the two incidents (the night an agent re-read the whole repo to change a two-line
// import; the afternoon it touched a file it was never asked to touch while CI stayed green), why /steer exists, and what I would do
// in the reader's chair. The operator's own draft named a lab, a token count and a staging outage; the row that ordered this note
// forbids all three (no named lab, no number the receipt cannot back, no behaviour guarantee), so the note carries none of them.
// Spelled once here; the club porch and the extension README render it byte-for-byte and sign it with the one surname.
export const FOUNDER_NOTE = 'One night an agent re-read this whole repo to change a two-line import, and one afternoon it touched a file I never asked it to touch while CI stayed green. I built /steer so my agents boot cold from a row I wrote before they ran, and leave a second entry they did not write. It is free, and if I were in your chair I would run it on one file first and read what the meter says.';
export const FOUNDER_SIGN = 'Elias Moosman';
/** the porch short form (C156 precedent: cut the block to L25's room, never move the ceiling) — the two incidents and the why; the pill under it is the door, so the third sentence stays on the README */
export const founderNoteShort = () => FOUNDER_NOTE.split('. ').slice(0, 2).join('. ') + '.';
/** the note as markdown (the extension README) — the three sentences, then the signature on its own line */
export const founderNoteMarkdown = () => `${FOUNDER_NOTE}

— ${FOUNDER_SIGN}`;

// THE FORWARD-TO-YOUR-LEAD SNIPPET (C159, operator 2026-09-22: "a three-line copy-paste block a developer drops into #engineering,
// naming ThetaCog Steer, the install keystroke ⇧⌘X, the marketplace id thetadriven.thetacog-mcp and the one thing it does …
// spelled once on the register and rendered byte-identically on every surface, with a guard that the snippet is under 60 words
// and carries no claim the register does not already carry"). The snippet is COMPOSED of register constants and glue words only,
// so "no claim the register does not carry" is decidable: strip the constants, the residue must be glue (the guard's allowlist).
export const STEER_SHORT = 'ThetaCog Steer';
export const INSTALL_KEYSTROKE = '⇧⌘X';
export const ONE_THING = 'a worker boots from the spec row instead of the chat, and the commit gets a second entry the agent did not write';   // the row's own words
export const FORWARD_SNIPPET = [
  `${STEER_SHORT} — VS Code ${INSTALL_KEYSTROKE}, search "${STEER_SHORT}" (id ${MARKETPLACE_ID}, free)`,
  `One thing it does: ${ONE_THING}.`,
  MARKETPLACE_URL,
].join('\n');
export const FORWARD_LABEL = 'Forward this to your lead — three lines for #engineering:';
/** the snippet as markdown (both READMEs) — the label, then a fenced block so the copy is the three lines and nothing else */
export const forwardSnippetMarkdown = () => `**${FORWARD_LABEL}**

\`\`\`text
${FORWARD_SNIPPET}
\`\`\``;
// THE THREE VERBS (coordinator over the chair's two-verb split, operator 2026-09-20: "and notarises the attested tape to support
// this experience" · "countersign backup"): Sign is free and yours; Notarise is the paid door and stays local; Countersign is the
// backup, a NEXT step and never a face button. Each names its mechanism (AXIOM 1 W3: the check reads a record the actor did not
// write — the licence is minted by a party who is not you, and anyone can check it against the issuer's public key). Byte-identical
// on the README's listing section; the card may import them later.
export const THREE_VERBS = Object.freeze({
  sign: '**Sign** — free, and yours. Your own key signs every row the tape writes, on your disk, from the first walk. Anyone with the commit recomputes the row and checks your signature.',
  notarise: '**Notarise** — the paid door, and still local. A plain card checkout on thetadriven.com/notarise mints a licence signed by a party who is not you, naming your key by its fingerprint; from then on every row is stamped with it as it is written, one credit per stamped row, the credits decremented on a ledger inside your own repo. Anyone can check the licence against the issuer\'s public key and the row against yours — nothing leaves the room.',
  countersign: '**Countersign** — the next step, never a face button. When someone asks for the tape, the same credits back the stamped rows up to the third party and a second reader signs them; that door sits behind the + on THE SECOND READER (🔗 Countersign (backup)), and it is the one that leaves the machine.',
});
// C153 (operator 2026-09-21, README viral sequence): "The walk through the sidebar" merged into "## The runbook" — the
// pitch-walkthrough and the 5-step quick-start are now one section. LISTING_HEADING is the ONE constant every listing test
// reads through (REG.listingSection), so this one-line move re-targets C94a.3/.4/.5 without a per-test heading rewrite.
export const LISTING_HEADING = '## The runbook';
export const listingSection = (md) => sectionOf(md, LISTING_HEADING);
// the six buttons are named as the sidebar names them TODAY — read off steer-ui.mjs's primary() calls for the fresh-install cards,
// never typed here; a rename in steer-ui.mjs turns the README red until the listing follows
// aeb16cebb1 (C151, 2026-09-21) moved 📄 View Unit Contract off a primary() face button and under the 📄 Open Spec pill's + (C141/
// C142); vna.cogProof was already page-local before this list was written (C119e: go() opens the cog's + and scrolls to the graph,
// no spawn — never a primary() call at all). Both dropped here so the set names exactly the commands `sidebarPrimaryLabels` can
// still find, never a count the source can no longer produce.
export const STRAIGHT_PATH_CMDS = Object.freeze(['vna.steer', 'vna.runGoal', 'vna.notariseTape']);   // C109n: ⤵ Ingest Clipboard is the live line's door, not a section
// C111: a primary painted from a door constant (`primary('vna.x', DOOR_LABEL.k, …)`) resolves through door-audit's DOOR_LABEL — the
// literal-only regex missed DOOR_LABEL.sync already and would have read the 💳 as absent once its label moved to the one constant
export const sidebarPrimaryLabels = (src) => [...String(src).matchAll(/primary\('(vna\.[A-Za-z]+)',\s*(?:'([^']+)'|DOOR_LABEL\.([a-z]+))/g)].map((m) => ({ cmd: m[1], label: m[2] !== undefined ? m[2] : (DOOR_LABEL[m[3]] || `DOOR_LABEL.${m[3]} (unknown)`) }));
export const straightPathLabels = (src) => { const seen = new Set(); return sidebarPrimaryLabels(src).filter((p) => STRAIGHT_PATH_CMDS.includes(p.cmd) && !seen.has(p.label) && seen.add(p.label)).map((p) => p.label); };
export const NOT_RUN = 'not run';   // the six read this on a fresh install — absence is never a zero (C96)
// before "## The boundary" the listing carries no insurance, underwriting or actuarial word; the boundary section carries the sentence
export const LISTING_QUIET = /\binsur\w*|\bunderwrit\w*|\bactuar\w*/i;
export const BOUNDARY_SENTENCE = 'The measurement is free; the underwriting is paid.';
// C117 — MEASUREMENT IS FREE, UNDERWRITING IS PAID, in CLAUDE.md's exact sentence (verified across /pricing, the LOI and the
// insure-rounds decks 2026-08-30): wherever a README prices the thing it carries this line byte-identical — never "free trial",
// never "freemium", both of which imply a time-boxed or feature-capped free tier. BOUNDARY_SENTENCE above is §The boundary's
// one-line form (C82c); this is the split spelled out. One constant, so the two READMEs cannot drift from each other.
export const FREE_PAID_SPLIT = 'The install and the measurement are free and open-source (MIT); only the financialization/attestation layer is licensed.';
export const FREE_TIER_REFUSED = /free trial|freemium/i;
// the paste's REFUSED and CORRECTED phrases — absent from both packages and the sidebar source (a paraphrase that keeps the claim is a diff, not a pass)
export const LISTING_REFUSED = /acts like a friend|glittering lure|absolute sovereignty|flight software|older engineer|unshakeable control|no longer have to check|executes against the boundar|immutable math|active today|the feeling of/i;
// the publish is an outward act — composed as a draft, armed by him: no hook and no script runs the marketplace or Open VSX publish
export const PUBLISH_CMD = /\b(?:vsce|ovsx)\s+publish\b/;
// C102e — A SNIFF OF THE STORY, ADMISSIBLE ONLY: one line from C101's KEPT set — every noun in it a door in the day-one flow
// (meter · toll · receipt · actuary). Under the extension README's recipe and in THE SECOND READER's ▸ more, byte-identical.
// The meter stays free in the sentence next to it (C82c); nothing from C101's REFUSED set rides beside it.
export const STORY_SNIFF = 'We invented a meter, charged a toll, and let the actuaries sort out the rest.';
// C103e — THE SPARK IS IMPLICIT: two true things side by side, never a feeling named. One line per card, ≤ 12 words, two
// clauses — the large noun then the small mechanism; each on its card's face as the one line under the measure (C103b's cap).
// Never a feeling word (hilarious · absurd · funny · ironic · alien · apocalypse · billionaire · daydream · screaming), never a
// brake verb (says no · cannot break · restricts · cage · enforces · runs hot) — placement, never prevention (TAPE, NOT BRAKE).
// The README line's number is READ off the meter receipt (readmeSparkLine) or the sentence prints without a number.
export const SPARK_LINES = Object.freeze({
  walk: 'The model wanders. The walk says where.',
  contract: 'A contract is a promise with a test that fails first.',
  cog: 'The peg is a floor that only falls; never a dollar.',
  run: 'The worker gets the row, not the chat.',
  reader: 'A local tape is a diary. A countersigned tape is a ledger.',
  bridge: 'The pipeline ignores what the browser model thinks. It places the bytes.',   // the row's wording ran to 14 words against its own ≤ 12 cap; tightened, both clauses kept
});
export const SPARK_FEELING = /\b(?:hilarious|absurd|funny|ironic|alien|apocalypse|billionaires?|daydreams?|screaming)\b/i;
export const SPARK_BRAKE = /says no|cannot break|restricts?|\bcage[sd]?\b|enforces?|runs hot/i;
/** the README's spark line under the wedge — n is the window the meter measured (tokens not re-sent), or the sentence prints without a number */
export const readmeSparkLine = (n = null) => (Number.isFinite(n) && n > 0 ? `You are paying a supercomputer to re-read ${Math.round(n).toLocaleString('en-US')} tokens to change a CSS class.` : 'You are paying a supercomputer to re-read the whole conversation to change a CSS class.');
// the README block under the wedge — rendered by `node scripts/vna/clear-gauge.mjs --readme` from the committed ratio receipt's window
// (window.would = the tokens the goal window would have re-sent, C98c); replaced in place between the markers, never inserted by guess
export const SPARK_MARKERS = ['<!-- spark:begin — rendered by node scripts/vna/clear-gauge.mjs --readme from data/vna/readme-ratio.json (readmeSparkLine); do not edit by hand -->', '<!-- spark:end -->'];
export function sparkBlock(md) { const i = md.indexOf(SPARK_MARKERS[0]), j = md.indexOf(SPARK_MARKERS[1]); if (i < 0 || j < i) return null; return md.slice(i + SPARK_MARKERS[0].length, j).trim(); }
export function writeSparkBlock(md, receipt) { const i = md.indexOf(SPARK_MARKERS[0]), j = md.indexOf(SPARK_MARKERS[1]); if (i < 0 || j < i) return md; const n = receipt && receipt.window && Number.isFinite(receipt.window.would) ? receipt.window.would : null; return md.slice(0, i + SPARK_MARKERS[0].length) + '\n' + readmeSparkLine(n) + '\n' + md.slice(j); }
// C104b — THE LOOP IN FIVE LINES: inside NEXT →'s + (C103b's plus) and under the README recipe, byte-identical. The number in
// line 4 is the snowball cap constant (BUNDLE_TOKEN_CAP, C93g's knob) handed in by the caller — never a literal typed twice.
// "another LLM" is any model or a colleague (the tree does not care who wrote the paragraph, only that it was copied, C34).
export const loopInFive = (cap) => Object.freeze([
  '1 · Think it through with any model, or a colleague.',
  '2 · Copy the good part — the clipboard lands it on the tree, placed.',
  '3 · The spec grows a row.',
  `4 · A worker boots cold from the row: ${Number(cap).toLocaleString('en-US')} tokens, not the whole chat.`,
  '5 · The receipt lands — where it went, re-runnable by anyone.',
]);
export const LOOP_IN_FIVE_MARKERS = ['<!-- loop:begin — rendered from loopInFive(BUNDLE_TOKEN_CAP) in scripts/vna/public-surface-register.mjs; do not edit by hand -->', '<!-- loop:end -->'];
// the block between the markers: the five lines, then FEELS_LIKE_FLYING directly beneath (C104b) — replaced in place, never inserted by guess
// C148a (operator 2026-09-21: "in the readme we say bookkeeping in titles etc, it's superfluous — we say it once, then explain why it both
// saves tokens and makes it countersigned / insurable"): the README block is the five lines ONLY; FEELS_LIKE_FLYING is said once on the
// page, under "The machine pays for its own attestation", with the why-both paragraph before it. The panel's NEXT → + still carries the
// sentence beneath the five (C104b.4) — that is a different surface.
export const loopBlockText = (cap) => loopInFive(cap).join('\n');
export function loopBlock(md) { const i = md.indexOf(LOOP_IN_FIVE_MARKERS[0]), j = md.indexOf(LOOP_IN_FIVE_MARKERS[1]); if (i < 0 || j < i) return null; return md.slice(i + LOOP_IN_FIVE_MARKERS[0].length, j).trim(); }
export function writeLoopBlock(md, cap) { const i = md.indexOf(LOOP_IN_FIVE_MARKERS[0]), j = md.indexOf(LOOP_IN_FIVE_MARKERS[1]); if (i < 0 || j < i) return md; return md.slice(0, i + LOOP_IN_FIVE_MARKERS[0].length) + '\n' + loopBlockText(cap) + '\n' + md.slice(j); }
// C98b — THE ONE SENTENCE OF POSITIONING (the eighth paste, 2026-09-19). The paste offered "Temporal records distributed
// execution state"; REFUSED (Q2) — a claim about a third party's product on a public surface is a fact to disprove. Git alone
// is named; the "why" is the operator's dictated intent span on the tape (write_tape_intent), signed, placed against the spec
// tree — never inferred. Byte-identical at the head of the npm README and inside the extension README's "## The boundary".
export const RECORD_OF_INTENT = 'Git records what changed. ThetaCog records why: the intent you dictated, on the tape, signed, placed against the spec tree.';
// C98c — THE RATIO IS READ. The paste typed "99.9%"; a public surface carries the ratio the meter read (clear-gauge.mjs
// tokenMeter → not_re_sent_pct over its goal window) or UNMEASURED, never a typed number. The READMEs carry ONE marked block,
// rendered by `node scripts/vna/clear-gauge.mjs --readme` from a committed receipt (RATIO_RECEIPT — a snapshot of the meter's
// window, so a stranger's clone recomputes the same line without this machine's ledger). ratioLine REFUSES a receipt whose pct
// is not its own window's arithmetic — the number cannot be typed into the sidecar either. The marketplace description stays
// the wedge (C89d.0); "the listing" is the npm README. A block is replaced in place; never inserted by guess (writeRatioBlock).
export const RATIO_UNMEASURED = 'UNMEASURED — run one goal';
export const RATIO_RECEIPT = 'data/vna/readme-ratio.json';
export const RATIO_SURFACES = ['packages/thetacog-mcp/README.md', 'packages/thetacog-mcp-vscode/README.md'];
export const RATIO_MARKERS = ['<!-- ratio:begin — rendered by node scripts/vna/clear-gauge.mjs --readme from data/vna/readme-ratio.json; do not edit by hand -->', '<!-- ratio:end -->'];
const pctOf = (w) => (w && w.goals > 0 && w.would > 0) ? Math.round((100 * w.not / w.would) * 10) / 10 : null;   // the same arithmetic as clear-gauge.mjs notReSentPct, restated so this module stays import-free of the meter
export function ratioLine(receipt) {
  if (!receipt || receipt.not_re_sent_pct == null) return RATIO_UNMEASURED;
  const own = pctOf(receipt.window);
  if (own !== receipt.not_re_sent_pct) throw new Error(`ratioLine: not_re_sent_pct ${receipt.not_re_sent_pct} is not its window's arithmetic (${own}) — a typed number`);
  return `${receipt.not_re_sent_pct}% of the window not re-sent — read off this session`;
}
export const ratioReceipt = (meter, { at = new Date().toISOString() } = {}) => ({ at, meterAt: meter && meter.at ? meter.at : null, not_re_sent_pct: meter ? meter.not_re_sent_pct ?? null : null, window: meter && meter.window ? meter.window : { goals: 0, would: 0, not: 0 }, sufficientFor: 'the share of the measured goal window that was not re-sent, at the named ratio — never a price, never a promise' });
export function ratioBlock(md) { const i = md.indexOf(RATIO_MARKERS[0]), j = md.indexOf(RATIO_MARKERS[1]); if (i < 0 || j < i) return null; return md.slice(i + RATIO_MARKERS[0].length, j).trim(); }
export function writeRatioBlock(md, receipt) { const i = md.indexOf(RATIO_MARKERS[0]), j = md.indexOf(RATIO_MARKERS[1]); if (i < 0 || j < i) return md; return md.slice(0, i + RATIO_MARKERS[0].length) + '\n' + ratioLine(receipt) + '\n' + md.slice(j); }

export const THEOREM_NOUN = /Merkle|Rice\b|lattice|ShortLex|Landauer|Kolmogorov|data[- ]processing inequality/;
export const RUNNABLE = /`(?:npm i|npx |code --install|node )/;

export const stripFences = (s) => String(s).replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));   // blanked, not removed — line numbers stay true
export const stripQuoted = (s) => String(s).replace(/["“][^"”\n]*determinis[^"”\n]*["”]/gi, '');   // the mocked, quoted use is stripped; what remains must carry no bare instance

/** the copy of one package's surface: README prose (fences blanked) + the store description + keywords */
export function surfaceCopy(repo, pkgDir) {
  const dir = resolve(repo, pkgDir);
  const readme = readFileSync(resolve(dir, 'README.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  return { readme: stripFences(readme), description: String(pkg.description || ''), keywords: (pkg.keywords || []).join(' ') };
}

/** every hit with its line, so a red run names the sentence and not just the count */
// C111 (operator 2026-09-20: "notarise tape for insurance — the 💳 label names what the stamp is FOR"): the painted door label is
// the ONE string the quiet check lets through — the listing names the buttons as the sidebar names them TODAY (C94a.3), and the
// sidebar's 💳 says insurance by the operator's later sentence. Only that exact label is excused; a sentence about insurance is not.
export function hits(text, re) {
  const out = [];
  for (const [i, raw] of String(text).split('\n').entries()) { const line = raw.split(DOOR_LABEL.notarise).join('💳'); if (re.test(line)) out.push(`${i + 1}: ${raw.trim().slice(0, 120)}`); }
  return out;
}

export const whistlesOn = (text) => WHISTLES.filter((w) => w.re.test(text)).map((w) => w.name);

/** the first command before the theorem: the first runnable line precedes the first theorem noun */
export function commandBeforeTheorem(readme) {
  const m = readme.search(RUNNABLE), t = readme.search(THEOREM_NOUN);
  return { runnableAt: m, theoremAt: t, ok: m >= 0 && (t < 0 || m < t) };
}

// ── C98a THE FABLE SWEEP — six families that name a FUNCTION this instrument does not have ──────────────────────────────
// (operator's four verbs, CLAUDE.md: the deviation is DETECTED · PLACED · PRICED · DISPATCHED; never prevented, never
// guaranteed, never contained, never certified, never enforced). A surface may DENY the function ("insurance never prevented a
// single collision", "we do not say it prevents", "not a blowout preventer"): a denial is the family's own falsifier, not an
// instance of it. Two strips, each with its argument, then the count is zero:
//   fences   — captured CLI output is the tool's record, not our copy (stripFences, already the rule for every family);
//   denials  — a negation within three words of the family word is the posture stated, not broken (stripDenials); narrowed so
//              "not only prevents" / "not just enforces" stay caught — those are the claim wearing a hedge.
// NO quote strip here, unlike BOAST: the register cannot tell whose quote it is — README:1349 carried "… Prevent drift." as a
// room's own motto inside quotation marks, and a quote strip hid the very line this row was declared on. A competitor's brake
// is named by its NOUN (RBAC, OPA, a policy engine), never held up by the verb.
// Q1 (C98, 2026-09-19): "fail-closed gate" was true of the runner's six checks and is banned anyway — the register bans the
// phrase, not the fact; it reads "six receipts, all must hold". The four verbs appear ONCE on each README's boundary section.
// Seen red 2026-09-19 before the sweep on packages/thetacog-mcp/README.md:1349 ("Prevent drift."), :752 ("enforce role
// boundaries"), :233/:491 ("recomputable *enforcement*"), :1178 ("logic-layer enforcement"), :1239 ("Singleton-enforced"),
// :29 ("enforcing an SLA … enforceable contract") and packages/thetacog-mcp-vscode/README.md:32/:184 ("fail-closed").
// NOT folded into FAMILIES on purpose: the other copy surfaces in SURFACE_MAP still carry the families (measured 2026-09-19:
// pricing 5 · iamfim 18 · cta 11 · changelog 8) and are the next sweep, not this row's — a red there would be a different claim.
export const FUNCTION_FAMILIES = {
  prevent: /\bprevent\w*/i,
  guarantee: /\bguarantee\w*/i,
  containment: /\bcontainment\b/i,
  certify: /\bcertif(?:y|ies|ied|ying|icate|icates|ication|ications)\b/i,
  enforce: /\benforc\w*/i,
  'fail-closed': /\bfail-?closed\b/i,
};
export const FUNCTION = new RegExp(Object.values(FUNCTION_FAMILIES).map((r) => r.source).join('|'), 'i');
export const FOUR_VERBS = /\bdetect(?:ed|s)?\b[^.\n]{0,24}\bplace[ds]?\b[^.\n]{0,24}\bprice[ds]?\b[^.\n]{0,24}\bdispatch(?:ed|es)?\b/i;
export const SIX_RECEIPTS = 'six receipts, all must hold';   // Q1's rename, one string
// the boundary section of each README — the npm README's boundary is the "what is free, and what is not" paragraph inside its
// first section; the extension README has a section named for it
export const BOUNDARY_SECTION = { 'packages/thetacog-mcp/README.md': '## 🚗 Read this first', 'packages/thetacog-mcp-vscode/README.md': '## The boundary' };
export const FUNCTION_SURFACES = ['packages/thetacog-mcp/README.md', 'packages/thetacog-mcp-vscode/README.md', 'packages/thetacog-mcp/package.json', 'packages/thetacog-mcp-vscode/package.json'];
export const stripDenials = (s) => String(s).replace(/\b(?:never|not|no|nor|don'?t|doesn'?t|cannot|can'?t|without)\b\**(?!\s+(?:only|just|merely)\b)(?:\s+[\w'*-]+){0,3}\s+(?:prevent|guarantee|containment|certif|enforc|fail-?closed)[\w-]*/gi, (m) => ' '.repeat(m.length));
export const sectionOf = (md, heading) => { const i = md.indexOf(`\n${heading}`); if (i < 0) return null; const j = md.indexOf('\n## ', i + heading.length + 1); return md.slice(i, j > 0 ? j : undefined); };
/** every line where a FUNCTION family is OUR function — fences and denials blanked; each hit names its family */
export function functionHits(text, { md = true } = {}) {
  let t = String(text); if (md) t = stripFences(t); t = stripDenials(t);
  const out = [];
  for (const [i, line] of t.split('\n').entries()) for (const [name, re] of Object.entries(FUNCTION_FAMILIES)) if (re.test(line)) out.push(`${i + 1} [${name}]: ${line.trim().slice(0, 120)}`);
  return out;
}

// ── C99a THE HEADERS CARRY NO ANIMAL (the ninth paste, action 2 — "invert the copy"; 2026-09-19) ──────────────────────────
// A header is what a skimming host reads first and a store indexes; the body may name the second reader's world (the boundary
// section says "whoever asks"; the flywheel body names the cedent, the broker, the carrier), but an H1–H3 names what the
// section DOES in the builder's world. Seven animal words — insurer · underwriter · carrier · E&O · Rice · compliance ·
// liability — are absent from every H1–H3 on the four FUNCTION_SURFACES (both READMEs, fences blanked so a `# 1. Install`
// comment inside a code block is the tool's record, not a header) and from both package.json descriptions. "insur\w*" is the
// stem on purpose: "insurability" (README:764) and "uninsurable" are the same animal as "insurer". `prove-rice` is a CLI
// name and stays in the body and the fences; a header names the K-run proof by what it does. The H1 of the extension README
// stays DEV_VALUE_PROP byte-identical (C89d.0); "Lossless Context Steering" is a second sentence, never a header.
// Seen red 2026-09-19 before the sweep on packages/thetacog-mcp/README.md:326 ("the carrier's dials"), :764 ("The
// insurability flywheel"), :959/:978/:984 (`prove-rice`).
export const ANIMAL = /\b(?:un)?insur\w*|\bunderwrit\w*|\bcarriers?\b|\bE&O\b|\brice\b|\bcomplian\w*|\bliabilit\w*/i;
export const NEVER_A_HEADER = /Lossless Context Steering/i;
export const HEADER = /^#{1,3} /;
/** every H1–H3 that carries the animal — fences blanked so line numbers stay true; each hit names its line */
export function animalHeaders(md) {
  const out = [];
  for (const [i, line] of stripFences(md).split('\n').entries()) if (HEADER.test(line) && (ANIMAL.test(line) || NEVER_A_HEADER.test(line))) out.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  return out;
}

// ── C100a THE COPY CLEARS THE BAR WITHOUT NAMING IT (operator 2026-09-20: "Make the copy on the left panel and the extension
// clear this bar and email the changes to me") ─────────────────────────────────────────────────────────────────────────────
// The bar (C100) is a third party's three-step proposal: evaluators granted employee-level ACCESS; labs on COMMON, binding
// standards; governments on VERIFIABLE agreements; the thesis "build only as fast as it can prove they are safe". The demand
// behind each step is kept and answered by a mechanism that exists — recompute, not access (C97c: a party who was never in the
// building recomputes the receipt from the commit and the tape); the rows YOU declared, never a lab's standard (C92c); the
// countersignature, which is what a verifiable agreement is made of (C85b). "Prove they are safe" is corrected, not echoed:
// whether it was good is undecidable (Rice), so it is not claimed; where it landed is re-runnable by anyone. The essay's own
// words — safe · prove · pace · limit · evaluator · incident — are never ours on a surface (BAR_WORDS); the essay, its author and
// the lab are named nowhere under packages/ or on the card — the bar lives in the spec as a fixture the guard reads.
// ONE RULE ONE PLACE: NO_BADGE is the one sentence, byte-identical on the extension README's "## The boundary" (after the
// boundary sentence), the npm README's boundary section (before the runnable check), and THE SECOND READER card (the first
// line inside ▸ more — C80b.0 keeps the line outside the fold under 220 chars, so the sentence rides under the licence
// sentence behind the fold, never as a second line on the face).
// C119j (operator 2026-09-21: "say the obvious — these licences support our dev"): the one sentence on what a licence pays for, beside
// NO_BADGE under the 💳's +. It restates the canonical split (measurement free and MIT; only the attestation is licensed) and names
// the obvious: the seat is what funds the people building the measurement you already run for free. Never "free trial", never a dollar.
export const WHAT_THIS_FUNDS = 'The measuring you already run is free and stays MIT. A notary seat is the only thing sold, and it pays the people building the measurement — every licence funds the next row of this instrument.';
export const NO_BADGE = 'A third party recomputes this receipt from the commit and the tape — no access to your pipeline, your prompts or your weights — and says where the work landed against the rows you declared. Whether it was good is not claimed; where it landed is re-runnable by anyone.';
/** whole-word matcher: "Pro" never matches proof; "prove" never matches proofs; "pace" never matches space or speed-up */
export const wholeWord = (w) => new RegExp(`(^|[^A-Za-z0-9-])${w.replace(/[-]/g, '\\-')}s?(?![A-Za-z0-9-])`, 'i');
export const BAR_WORDS = /\b(?:safe(?:ty|ly)?|prov(?:e[sdn]?|ing)|pac(?:e[sd]?|ing)|limit(?:s|ed|ing)?|evaluators?|incidents?)\b/gi;
// a denial is the correct posture, not the leak — "Nobody made the car safe", "never proves", "not a speed limit" — the same
// argument stripDenials makes for the six function families; the word is ours only when it is what WE do
export const stripBarDenials = (s) => String(s).replace(/\b(?:nobody|never|not|no|nor|don'?t|doesn'?t|cannot|can'?t|without)\b\**(?!\s+(?:only|just|merely)\b)(?:\s+[\w'*-]+){0,3}\s+(?:safe|prov|pac|limit|evaluat|incident)[\w-]*/gi, (m) => ' '.repeat(m.length));
/** every bar word carried as ours — fences blanked (md), denials blanked; each hit names the word and its offset */
export function barWordHits(text, { md = true } = {}) {
  let t = String(text); if (md) t = stripFences(t); t = stripBarDenials(t);
  return [...t.matchAll(BAR_WORDS)].map((m) => ({ word: m[0], at: m.index, near: t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ') }));
}
