// src/lib/street-offer.mjs — C485 THE STREET PAGE SELLS TWO THINGS, and each is written from both sides, here, once.
//
// Operator 2026-09-29, verbatim: "street callout free license is likely not 5 licenses, but less?" · "really have to seel
// a) tool b) the insurable robot" · "optimise the prompt with what we learned, sometimes the two sided what we must write,
// what they must hear changes the tone a lot" · "for iamfim.com" · "where do we do this? in the flag for balance sheet box?"
// · "make it less though, 20?" · "or pay for response to the email!" · "market that if you respond you get to try the
// cooles thtere is".
//
// THE TWO-SIDED FORM IS C476's LESSON (scopeSentence in scripts/vna/public-surface-register.mjs): WHAT WE MUST WRITE is the
// category and the claim at full strength; WHAT THEY MUST HEAR is their own position and an example they recognise. A door
// that carries only the first half reads as a spec sheet; one that carries only the second reads as a pitch with nothing
// under it. Both halves of both doors live in this file so the tone is chosen on purpose and never drifts per surface.
//
// THE PRICE OF THE STREET LICENCE IS A REPLY. The claim lives inside the box the iamfim page already has (CallbackHook, the
// $1.2B filter / "Is AI-agent risk yours?" field): an address typed there already fires the ONE nomination email
// (src/lib/nominate/invite-email.ts, From alerts@, Reply-To elias@). For a street placement that email asks for ONE
// SENTENCE back — what repo or runtime their agent touches (market intelligence, and the bot filter: a scanner can click,
// only a person answers a question). The reply lands in the operator's own inbox and the loop is MANUAL for the first
// STREET_GRANT_CAP (chair, 2026-09-29): he runs the /grant door's mint once per reply —
//     node scripts/meetings/grant.mjs mint --street --account <their email> --live
// which writes ONE licence ($20, one agent-year) to that address through the credits ledger (src/lib/notary/street-grant.mjs),
// one per address, refusing licence cap+1 with the reason. No reply→mint webhook: the existing inbox ingestion accepts only
// the operator's own addresses, and a stranger's reply never mints unattended. The DM claim pages keep their five
// (scripts/comms/claim-pages.mjs).
//
// No node: imports — the iamfim landing is a client page. scripts/vna/public-surface-register.mjs re-exports this.
// Guard: tests/site/c485-street-sells-two-doors.test.mjs
import { MARKETPLACE_URL, MARKETPLACE_ID, marketplaceUrl } from './marketplace.mjs';

/** the street grant: one licence, $20, one agent-year — the same unit /pricing sells (grant.mjs USD_PER_LICENCE) */
export const STREET_GRANT = Object.freeze({ usd: 20, licences: 1, credits: 10000 });
/** how many street licences go out in all, one per address — the one number that caps the reply-for-a-licence door */
export const STREET_GRANT_CAP = 25;

/** the CallbackHook placements on the iamfim host whose address submits are street signups (the nominate ref is callback-<where>).
 *  Every one of them renders STREET_BOX_LINE under its field, so the box says what the email will ask. The book-club
 *  lightbox's box (iamfim-lightbox-top) is left out on purpose: that reader chose the off-ramp, not the licence. */
export const STREET_BOX_WHERE = Object.freeze(['iamfim-landing-top', 'iamfim-fork-transition', 'scan-ask-top']);
export const isStreetRef = (ref) => STREET_BOX_WHERE.some((w) => String(ref || '') === `callback-${w}`);

/** the command both surfaces quote — the same pin as ATTEST_CMD on the landing page */
export const STREET_CMD = 'npx -y thetacog-mcp@latest attest-demo';
export const STREET_CLAIM_ANCHOR = 'street-claim';

/** the line under the box's field on the iamfim host: what a reply buys, said plainly, then the WHO-question the box always ends on */
export const STREET_BOX_LINE =
  `Leave your email. Answer the one email that comes back with one sentence on what repo or runtime your agent touches, ` +
  `and you run it on that agent with every run countersigned for a year: one licence, one per address, ${STREET_GRANT_CAP} in all. ` +
  `If it isn't yours, who does this make you think of?`;

/** the box's status line once an address is typed (CallbackHook emailHint) — the same promise as the line under it */
export const STREET_EMAIL_HINT = 'an email with one question — answer it in one sentence and one licence lands on this address';

/** THE TWO DOORS, in order. weWrite = the category and the claim at full strength; theyHear = their position and an example. */
export const STREET_DOORS = Object.freeze([
  Object.freeze({
    id: 'tool',
    kicker: 'a · the tool',
    weWrite:
      'The measurement is free and open-source (MIT), so you can read every line instead of taking our word for it. It runs ' +
      'on your machine, places where any agentic AI’s work landed against the line you drew, and signs a receipt anyone ' +
      'can recompute: same bytes, same hash.',
    theyHear:
      'You asked an agent for one CSS class. It came back green, and the diff touched fourteen files. One line in your ' +
      'terminal shows the file it was never asked to touch.',
    action: Object.freeze({ label: 'Run it on your laptop', cmd: STREET_CMD, href: MARKETPLACE_URL, hrefLabel: 'or install ThetaCog Steer in VS Code' }),
  }),
  Object.freeze({
    id: 'robot',
    kicker: 'b · the insurable robot',
    weWrite:
      'One licence signs one agent’s runs for a year against the spec it was given. The receipt is a record the agent ' +
      'did not write, and that record is what a carrier can price. Whether the work was good stays undecidable (Rice, 1953); ' +
      `where it landed does not. The licence is the paid half: $${STREET_GRANT.usd} per agent-year.`,
    theyHear:
      'The agent you already run: the one that answers tickets overnight, or opens pull requests while you sleep. When ' +
      'someone asks what it did, today the only answer is the log it wrote about itself.',
    action: Object.freeze({ label: 'Leave your email in the box below', href: `#${STREET_CLAIM_ANCHOR}`, line: STREET_BOX_LINE }),
  }),
]);

/** the street variant of the one nomination email's question — the one-sentence reply IS the price (the address arrives escaped) */
export const STREET_REPLY_ASK = 'What repo or runtime does your agent touch?';
/** the one command the operator runs per reply — the /grant door's mint, street form */
export const streetMintCommand = (email) => `node scripts/meetings/grant.mjs mint --street --account ${email} --live`;
export const streetEmailQuestion = (nomineeHtml) =>
  `One question: <b>${STREET_REPLY_ASK}</b> Reply with one sentence saying which, and one licence ` +
  `lands on <b>${nomineeHtml}</b>: that agent, every run countersigned for a year against the spec you gave it. ` +
  `One per address, ${STREET_GRANT_CAP} in all. Reply "no" and you'll just get the book club you signed up for.`;

// ── C635g THE FIRST EYESHOT CARRIES THE INSTALL (operator 2026-10-04, verbatim: "a VS code … badge of some kind so that right there in
// the first eye shot, you have a cultural action something I tell the devs to Install … and then make the claim and then include the
// toothy graph"). The badge, the action a non-developer can hand on, the claim and the tooth graph's words live HERE, once, so the
// lightbox, the landing's first section and the left door can never drift (src/components/SteerInstall.tsx renders them).
// The graph is rung 2 of the C519 ladder (data/vna/token-savings.json): 1 − Σ (hook payload live at each call SINCE THE LAST /clear OR
// COMPACTION) ÷ (calls × min(1M, corpus ÷ 4)). That formula is the whole licence for the captions: the payload only accumulates
// inside a session (a ramp down) and empties at a reset (a jump back); it is a size the injector chooses before the call, never the
// bill and never a claim about what the agent then does. Guard: tests/vna/c635g-first-eyeshot-carries-the-install.test.mjs

/** our own badge (C635h): shields.io retired its marketplace badges; no count, because downloadCount counts update downloads */
export const MARKETPLACE_BADGE_SRC = 'https://thetadriven.com/api/badge/marketplace';
export const MARKETPLACE_BADGE_ALT = 'ThetaCog Steer on the VS Code Marketplace: install free, open-source (MIT)';
/** the cultural action: one sentence a reader who does not code can hand to the people who do */
export const STEER_INSTALL_ACTION = 'Tell your devs: install ThetaCog Steer. Free and open-source (MIT), it runs on their laptop.';
/** the claim, said after the action and before the picture */
export const STEER_INSTALL_CLAIM = 'Every agent run is placed against the line you drew before it ran, on a record the agent did not write.';
/** the committed picture (scripts/vna/steer-ab-tokens.mjs --tooth-graph); absolute because iamfim.com rewrites every relative path */
export const TOOTH_GRAPH_SRC = 'https://thetadriven.com/vna/tooth-graph.svg';
export const TOOTH_GRAPH_ALT = 'The tooth graph: per tick, the steering the agent is handed beside the spec it steers by. Teal at or above the 99 percent line, violet below; the line ramps down through a session and jumps back at each reset.';
/** the left door's caption: what the picture is a reading of, in plain words, with no number in it (C635f's line carries the numbers) */
export const TOOTH_GRAPH_DOOR_CAPTION =
  'This is the ingress: what the agent is handed to steer by is chosen, and on the record, before it acts. ' +
  'Each ramp down is one session’s steering piling up since the last /clear or compaction; each jump back is the reset.';
/** the hero's one-line caption, from the committed reading (src/lib/tooth-graph-reading.json) — never a hand-typed number */
export function toothGraphHeroCaption(reading) {
  const ok = reading && Number.isFinite(reading.n) && reading.n > 0 && Number.isFinite(reading.crossed);
  return ok
    ? `The steering the agent is handed, tick by tick: no more than 1 % of the spec it steers by, on ${reading.crossed} of ${reading.n} ticks.`
    : 'The steering the agent is handed, tick by tick, beside the spec it steers by.';
}

// C635j — THE STICKER LEADS SOMEWHERE A PHONE CAN GO. 86 % of /s/b2 arrivals are phones, where a VS Code extension cannot be
// installed, so on a scanned phone the install block's primary action is the hand-on: the share sheet carrying the action
// sentence above (one constant) and the listing tagged ref=sticker-share, with sms:/mailto: when navigator.share is missing.
// Falsifier: 0 ref=sticker-share arrivals over two weeks at ~70 scans/week.
// Guard: tests/vna/c635j-the-sticker-leads-somewhere-a-phone-can-go.test.mjs
export const STICKER_SHARE_REF = 'sticker-share';
/** the button: the phone cannot install it, the person it is sent to can */
export const STICKER_SHARE_LABEL = 'Send it to your devs';
/** under the button: the same sheet reaches the reader's own laptop */
export const STICKER_SHARE_ALT_LINE = 'Or send it to your own laptop, where it installs.';
/** the fallback anchors' words, for browsers without navigator.share */
export const STICKER_SHARE_SMS = 'Text it';
export const STICKER_SHARE_EMAIL = 'Email it';

/** the share payload, and the same text + url as sms:/mailto: hrefs (sms:?&body= opens the composer on iOS and Android) */
export function steerHandOn() {
  const title = 'ThetaCog Steer';
  const text = STEER_INSTALL_ACTION;
  const url = marketplaceUrl(STICKER_SHARE_REF);
  const body = encodeURIComponent(`${text} ${url}`);
  return {
    title,
    text,
    url,
    sms: `sms:?&body=${body}`,
    mailto: `mailto:?subject=${encodeURIComponent(`${title}: install it on your laptop`)}&body=${body}`,
  };
}

/** scanned AND a phone (touch-first or a narrow viewport). Desktop and unscanned visits keep the install link. */
export function isHandOnVisit({ scanned, coarsePointer, width }) {
  return Boolean(scanned) && (Boolean(coarsePointer) || (Number.isFinite(width) && width < 768));
}
