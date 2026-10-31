// src/lib/backup/dispatch-market.mjs — C892 THE DISPATCH MARKET LADDER (operator 2026-10-17: "we sell this vision with how the
// sequencing in a hierarchy on the page is organized" · "it's a warranty or we come in and help you find the people quickly to solve
// your problem or give them the specifications in order to solve the problem quickly").
//
// One source for the five rungs, in the order a reader climbs them: the tape → grip → the trigger → the dispatch → the map of maps.
// /backup renders the short ladder right after what we sell; /backup/market (C893) renders it in full beside the nine rooms.
// Each rung carries its status off the record: BUILT (the path that runs it), PARTIAL (what runs, and what does not yet), or
// NOT BUILT (what is missing). Every number on a face is read from a committed receipt passed in, never typed here.
//
// Claim perimeter: no rung says halt, brake, prevent, contain, or guarantees what an agent does. What we guarantee is our own act:
// the deviation is DETECTED · PLACED · PRICED · DISPATCHED. The halt stays the deployer's to wire (MEASURE_NOT_CONTROL).
// @guard tests/site/c892-dispatch-market-ladder.test.mjs

// C906 THE SAFE HARBOR, SAID LOUDLY (operator 2026-10-17: "Proactively hit the safe harbor - loudly"): one sentence, on every surface that
// names the warranty, read from here. It names our act and refuses the agent's; it never cites a statute as protection (counsel's open).
export const SAFE_HARBOR = 'What we warrant is our own act: the tape is written, the trigger fires as declared, the re-run gives the same bytes, the dispatch arrives inside its window. What your agent does is never warranted; it stays yours and your carrier\'s.';

export const LADDER_HEAD = 'the tape · grip · the trigger · the dispatch · the map of maps';

// C910 THE WARRANTOR LINE, said once beside the three counterparty doors (deployer, provider, underwriter) that replace the
// logo slots on /backup/adherence. It carries SAFE_HARBOR word for word — never retyped — and says out loud that no carrier
// is named as committed, so a screenshot of the terminal never reads as an endorsement from a name we do not hold.
export const WARRANTOR_LINE = `ThetaDriven Inc is the warrantor on its own act. ${SAFE_HARBOR} No carrier is named as committed.`;

// C954 THE FOUNDER IS THE FIRST PROVIDER ON THE MAP OF MAPS, AND C938 IS ANSWERED (operator 2026-10-17: "we can treat my time as
// the first cap of maps operator founder consulting as a program for the warranty in kind if it helps sell licenses"): the
// trial's consulting hours are Elias Moosman's own, run as a program (the Warranty Trial, warranty-trial.mjs), paid in kind,
// bounded by his own monthly ceiling (C961 sets it at 20 hours). One source: read here; /backup/market and the lifecycle
// (src/lib/backup/lifecycle.mjs stage 11) both carry this line by import, never a retyped copy.
import { FOUNDER_MONTHLY_CEILING_HOURS } from './warranty-trial.mjs';   // C977: one place for the ceiling
export { FOUNDER_MONTHLY_CEILING_HOURS };

export const FOUNDER_PROVIDER = Object.freeze({
  key: 'founder', persona: 'Elias Moosman', declared: 'the warranty trial, run as a program, paid in kind',
  monthlyCeilingHours: FOUNDER_MONTHLY_CEILING_HOURS,
});

// C938 WHO PAYS THE DISPATCHED PROVIDER — answered by C954: the money path is the deployer's own prepaid hours (TRIAL_PROPOSAL,
// warranty-trial.mjs), routed to whoever is dispatched at the fired coordinate, the founder first inside his own monthly ceiling.
// The trial pool never pays a provider for the deployer's OWN excursion — a benefit paid on the same party's event is no longer a
// warranty on our act but insurance in kind (N.Y. Ins. Law § 1101(a)(1); C895, the warrant-our-own-act line).
export const PROVIDER_PAID_HOW = `The deployer's own prepaid hours route to whoever is dispatched at the coordinate that fired — ${FOUNDER_PROVIDER.persona} first, inside his monthly ceiling of ${FOUNDER_MONTHLY_CEILING_HOURS} hours, since the trial's consulting hours are his own, run as a program, paid in kind. The trial pool never pays a provider for the deployer's own excursion: a benefit paid on the same party's event is insurance, not a warranty on our act (N.Y. Ins. Law § 1101(a)(1); C895).`;

// THE DYAD: the tape and the cause. The tape is sufficient for WHERE the work landed; it is never sufficient for WHY (an account cannot
// hold what the process displaced, AXIOM 1 W). That gap is why the payout is a person and not a cheque: the tape cuts the discovery,
// the person at that coordinate supplies the cause.
export const DYAD_LINE = 'The tape holds where the work landed. The cause is never on it. That is why the dispatch is a person, not a cheque: the tape spares them the discovery, and the one with grip at that coordinate reads the cause.';

export const WHY_PAY_IN = 'The licence is good faith on your own service levels: the people who can hold your uptime are routed before you need them, by where their finished jobs landed, not by what they say about themselves.';

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

// the first threshold the backtest marks rare enough to price, with its event count and rate; null when the receipt has none
export function writableThreshold(trigger) {
  const row = (trigger && Array.isArray(trigger.curve) ? trigger.curve : []).find((r) => /^yes/i.test(String(r.writable || '')));
  return row ? { threshold: row.threshold, events: row.events, rate: row.rate } : null;
}

// the nine rooms as providers: declared pole (the expertise declared) beside the centre their placed commits landed on (the jobs done)
export function roomProviders(map) {
  const rooms = map && Array.isArray(map.rooms) ? map.rooms : [];
  return rooms.map((r) => ({
    key: r.key, emoji: r.emoji, persona: r.persona, declared: r.declared, declaredName: r.declaredName, n: r.n, status: r.status,
    centre: r.centre || null, centreName: r.centreName || null, withinBand: Number.isInteger(r.withinBand) ? r.withinBand : null, trendWord: r.trendWord || null,
  }));
}

// C916: the providers whose landed centre IS the given cell — an exact match, never the nearest room. The caller the
// excursion row names: when a deployed call lands off the declared pole, this is how it finds who already holds grip
// there. An unmatched or null cell comes back empty, never an error — no provider landed is a measurement, not a defect.
export function providersAtCell(map, cell) {
  if (!cell) return [];
  const rooms = map && Array.isArray(map.rooms) ? map.rooms : [];
  return rooms.filter((r) => r.centre === cell);
}

export function providerCounts(map) {
  const p = roomProviders(map);
  return { rooms: p.length, powered: p.filter((r) => r.status !== 'UNDERPOWERED').length, inBand: p.filter((r) => r.status === 'IN BAND').length, moved: p.filter((r) => r.status === 'RE-ROLL').length, at: map && map.at ? String(map.at).slice(0, 10) : null };
}

export function ladder({ trigger = null, map = null } = {}) {
  const w = writableThreshold(trigger);
  const c = providerCounts(map);
  return [
    {
      id: 'tape', label: 'The tape', status: 'BUILT', path: 'src/lib/backup/receive.mjs',
      face: 'What ran, in a record your agents did not write, named by the sha256 of its own bytes.',
      more: 'The archive the extension writes and this site re-hashes on upload. A field nobody measured reads UNMEASURED, never 0.',
    },
    {
      id: 'grip', label: 'Grip', status: 'BUILT', path: 'src/lib/backup/boundary-crossings.mjs',
      face: 'Where each step landed against the job declared before it ran: a shape you read, and crossings you count.',
      more: 'The one Rust walk places every commit on the 144×144 lattice; the odometer counts the boundary crossings. The semantic vega is how far that landing moves when the input wobbles: the variance of your grip.',
    },
    {
      id: 'trigger', label: 'The trigger', status: trigger ? 'BUILT' : 'UNMEASURED', path: 'scripts/vna/parametric-trigger.mjs',
      face: trigger && w
        ? `A predicate over the tape decides the event, with no adjuster. Backtested: ${trigger.eligible} of ${trigger.corpus} commits eligible; at ${w.threshold}% off lane, ${w.events} events (${pct(w.rate)}), rare enough to price.`
        : 'A predicate over the tape decides the event, with no adjuster. The backtest receipt was not read for this render.',
      more: 'Signed attestation, a lane read off the tolerance panel, an off-lane share at or past a threshold set before the work ran. Nobody argues intent; the tape either crossed or it did not. Not yet bound into any contract.',
    },
    {
      id: 'dispatch', label: 'The dispatch', status: 'PARTIAL', path: 'scripts/vna/steer.mjs',
      face: 'When the trigger fires, we dispatch: the person with grip at the coordinate where it fired, handed the frozen tape, or the specification that lets anyone fix it. The dispatch is a service inside your licence tier.',
      more: 'Built: the specification half. Every open row already compiles to a brief a worker can act on with no discovery meeting (steer.mjs brief). Not built: routing a fired trigger to an outside person and paying them from the warranty. What is warranted is our own act (the tape written, the trigger fired as declared, the dispatch inside its window), never what your agent does.',
    },
    {
      id: 'map', label: 'The map of maps', status: 'PARTIAL', path: 'scripts/vna/alignment-map.mjs',
      face: map
        ? `Each provider's declared expertise beside where their finished jobs landed. Measured on our own ${c.rooms} rooms (${c.at}): ${c.powered} carry enough jobs to read, ${c.inBand} sits on what it declared, ${c.moved} moved toward the work they took.`
        : 'Each provider\'s declared expertise beside where their finished jobs landed. The room map receipt was not read for this render.',
      more: 'Taking a contract moves your niche toward it: the jobs you finish pull your landed centre, and the map shows it before you say it. Built for our own rooms. Not built: outside providers, who has time right now, and the price of a coordinate.',
    },
  ];
}

// what this needs that we cannot build alone — said on the page so nobody has to find it. Counsel's open questions are NOT here:
// they live in the business plan, never on a public page (C895, need-to-know).
export const NOT_BUILT = [
  { id: 'capacity', label: 'Capacity behind the warranty', line: 'Carriers or data centres who stand behind the in-kind payout. ThetaDriven holds neither capital nor risk today.' },
  { id: 'providers', label: 'Outside providers on the map', line: 'People and shops outside our nine rooms, placed by their own finished jobs. Today the map has one company on it.' },
  { id: 'availability', label: 'Who has time right now', line: 'A provider\'s open hours beside their grip, so the network picks the best one free today. No calendar is joined to the map yet.' },
  { id: 'payout-ledger', label: 'The payout ledger', line: 'A record of each fired trigger, who was dispatched, and what they were paid. The trigger is backtested; nothing has paid out.' },
  { id: 'provider-payment', label: 'How the dispatched provider gets paid', line: PROVIDER_PAID_HOW },
  { id: 'human-alpha', label: 'Where human grip beats the agent', line: 'UNMEASURED. The measurement: split placed jobs by who declared the intent, a person or an agent, and compare how often each lands in band at the same coordinate.' },
];

// C932: providers placed by their own finished jobs who are NOT one of our nine rooms — read off the map's own `outside` flag,
// never inferred from a name, so a room is never counted as an outside provider and the market line "the map has one company
// on it" stays true until a row carries outside: true. Guard: tests/warranty-plan/w04-place-outside-provider.test.mjs
export function outsideProviders(map) {
  const rooms = map && Array.isArray(map.rooms) ? map.rooms : [];
  return rooms.filter((r) => r && r.outside === true).map((r) => ({ key: r.key, persona: r.persona, declared: r.declared, centre: r.centre || null, n: r.n, status: r.status, withinBand: Number.isInteger(r.withinBand) ? r.withinBand : null }));
}

// C968 THE QUEUE IS THE MAP OF MAPS PRIORITY, AND IT IS EDITABLE (operator 2026-10-18: "this goes right into the map
// of maps priority - the cue is editable"): the dispatch queue (C964) orders holders in the map of maps as one
// declared priority object, defaulted from live balance and fire time only. Every edit — the operator's step
// table, a holder moving their own place within what their own balance allows, a holder lending their place to a
// named neighbour — is a signed row (type, actor, signedBy, at) replayed over the default in sequence, so the
// order a provider sees is a declaration anyone can recompute from (entries, edits) alone, never a hidden ranking.
//
// NO HOLDER'S AGENT EVENT MAY ENTER THE QUEUE: an edit's actor is 'operator' or a holder's own key, never 'agent'.
// rejectedQueueEdits() names every edit that fails the signed shape or carries that actor, and queueOrder() never
// folds a rejected edit into the served order.
//
// SUFFICIENT FOR: that the served order equals defaultQueueOrder() plus every signed edit replayed in sequence,
// and that no holder's agent moved it. NOT SUFFICIENT FOR: whether the balance step table (C964) is published, or
// whether a lend is honest — both are read off the tape, never computed here.
// Guard: tests/vna/c968-the-queue-is-the-map-of.test.mjs
export const QUEUE_EDIT_TYPES = Object.freeze(['step-table', 'move', 'lend']);

// entries: [{ key, balance, fireTime }] → keys ordered by balance desc, fire time asc tiebreak — C964's own words,
// "queue order is a pure function of balance and fire time only", read here as the one default this module computes.
export function defaultQueueOrder(entries = []) {
  return [...entries]
    .sort((a, b) => (b.balance - a.balance) || (a.fireTime - b.fireTime) || String(a.key).localeCompare(String(b.key)))
    .map((e) => e.key);
}

// a signed row carries its four fields and never names 'agent' as the actor who moved it.
export function isSignedQueueEdit(edit) {
  return !!edit && QUEUE_EDIT_TYPES.includes(edit.type) && typeof edit.actor === 'string' && edit.actor.length > 0
    && edit.signedBy === edit.actor && Number.isFinite(edit.at) && edit.actor !== 'agent';
}

// every edit this module will not fold in, named with why — a holder's agent, or a row missing a signed field.
export function rejectedQueueEdits(edits = []) {
  return (edits || []).filter((e) => !isSignedQueueEdit(e)).map((e) => ({
    edit: e,
    why: e && e.actor === 'agent' ? "actor is 'agent' — a holder's agent never edits the queue" : 'missing a signed field (type, actor, signedBy, at)',
  }));
}

// one signed edit applied to `order` (an array of keys); balanceOf(key) reads the same entries passed to
// defaultQueueOrder. Pure: the same order, edit and balances always give the same next order.
export function applyQueueEdit(order, edit, balanceOf) {
  if (edit.type === 'step-table') {
    // the operator's published table is itself a full replacement order over the same key set
    const next = Array.isArray(edit.order) ? edit.order.filter((k) => order.includes(k)) : order;
    const missing = order.filter((k) => !next.includes(k));
    return [...next, ...missing];
  }
  if (edit.type === 'move') {
    const idx = order.indexOf(edit.holder);
    if (idx < 0 || !Number.isFinite(edit.toIndex)) return order;
    const mine = balanceOf(edit.holder);
    const target = Math.max(0, Math.min(order.length - 1, edit.toIndex));
    const next = order.filter((k) => k !== edit.holder);
    next.splice(target, 0, edit.holder);
    const newIdx = next.indexOf(edit.holder);
    // never leave anyone who outweighs this holder sitting behind them — "within what their balance allows"
    const blocked = next.slice(newIdx + 1).some((k) => balanceOf(k) > mine);
    return blocked ? order : next;
  }
  if (edit.type === 'lend') {
    const idx = order.indexOf(edit.holder);
    const toIdx = order.indexOf(edit.to);
    if (idx < 0 || toIdx < 0 || toIdx <= idx) return order; // a lend only moves a worse-placed named neighbour up
    const next = [...order];
    [next[idx], next[toIdx]] = [next[toIdx], next[idx]];
    return next;
  }
  return order;
}

// the served order: defaultQueueOrder(entries) replayed through every signed, non-agent edit in sequence. The one
// thing a provider is shown, and the one thing this function reads — nothing else enters a queue position.
export function queueOrder({ entries = [], edits = [] } = {}) {
  const balanceOf = (key) => { const e = entries.find((x) => x.key === key); return e ? e.balance : -Infinity; };
  const rejected = rejectedQueueEdits(edits);
  const accepted = (edits || []).filter((e) => isSignedQueueEdit(e));
  const base = defaultQueueOrder(entries);
  const served = accepted.reduce((order, edit) => applyQueueEdit(order, edit, balanceOf), base);
  return { default: base, accepted, rejected, served };
}
