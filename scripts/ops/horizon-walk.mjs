#!/usr/bin/env node
// scripts/ops/horizon-walk.mjs — THE HORIZONS WALK BACK THROUGH THE REPO (operator 2026-10-20, verbatim: "make the machinery ... to step
// through backwards from the horizons through the repo (snowball/ncd/l1 how?) working backwards from the hyperstitions should make
// these super compelling and tied to ongoing work").
// The same three arms as C1043's backward-walk.mjs, pointed from the far end: the QUERY is a horizon's aim + first step + how-we-know
// (docs/specs/vna/horizons.json); the MEMORY is the open spec rows (SPEC-VNA-COCKPIT.md, ids stripped from both sides so a hit is
// association, never a grep of a label) and the last 300 commit subjects.
//   ncd   gzip-NCD of the query to each open row and each commit (the sensor the snowball orders by)
//   snow  one snowball growth: the query grown by the top ncd row's text, re-ranked — the read picks its own next mass
//   l1    the one Rust walk's placement distance — UNMEASURED here until a horizon's text is walked (the walk door takes a row id,
//         not free text); named, never faked with a noun count (CLAUDE.md: a lattice reading comes from the one Rust walk)
// Each horizon prints the open rows it rides on (ongoing work) and the commits nearest it — so every aim names the work it pulls.
// Also: for each open Mailbox decision, the open rows its WHY + ACTION ride on. LLM-free. Writes data/vna/horizon-walk.json.
// Port row: decides an order → C1042r (the ranker) in the crate once the arms are read against a null.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUnitPrice } from '../economics/license-unit-economics.mjs';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const C = (s) => gzipSync(Buffer.from(s)).length;
export const ncd = (x, y) => { if (!x || !y) return 1; const a = C(x), b = C(y); return (C(`${x}\n${y}`) - Math.min(a, b)) / Math.max(a, b); };
export const strip = (s) => String(s || '').replace(/\b(C\d+[a-z0-9]*|Q\d+|bf-\d+|H-\d+|D-[\w-]+)\b/g, ' ').replace(/\s+/g, ' ').trim();
export function openRows(spec) {
  const out = []; for (const m of spec.matchAll(/^\s*- \[ \] (C\d+[a-z0-9]*)\b[^\n]*/gm)) { const t = strip(m[0].replace(/\(guard:[^)]*\)/, '')).slice(0, 600); if (t.length > 40 && !/PARKED/.test(m[0])) out.push({ id: m[1], text: t }); }
  return out;
}
export const RIDE_FLOOR = 0.15;
export function rank(query, mem, k = 3) { return mem.map((r) => ({ ...r, d: ncd(query, r.text) })).sort((a, b) => a.d - b.d).slice(0, k); }
// THE READING (measure, don't assert): margin = median NCD over all open rows minus the top hit's NCD — a hit no nearer than the crowd
// carries no address. A HUB is a row that is a top hit for more than a third of the horizons: generic text that sits near everything.
export function walkOne(query, rows, commits) {
  const all = rows.map((r) => ncd(query, r.text)).sort((a, b) => a - b); const median = all[Math.floor(all.length / 2)] || 1;
  const n = rank(query, rows, 3);
  const grown = n[0] ? `${query}\n${n[0].text}` : query;
  const s = rank(grown, rows.filter((r) => r.id !== (n[0] && n[0].id)), 2);
  return { margin: n[0] ? +(median - n[0].d).toFixed(3) : 0, ncd: n.map((r) => ({ id: r.id, d: +r.d.toFixed(3) })), snow: s.map((r) => ({ id: r.id, d: +r.d.toFixed(3) })), commits: rank(query, commits, 2).map((c) => ({ sha: c.id, subject: c.text.slice(0, 90), d: +c.d.toFixed(3) })), l1: 'UNMEASURED — the walk door takes a row id; a horizon text is not walked yet' };
}
// C1302 — THE WALK INVERTED: walkOne finds the open rows a horizon rides on; this finds the horizon a row's own text rides on, same
// margin reading (median NCD over the full horizon set minus the top hit's NCD), so an open row that cannot clear RIDE_FLOOR against
// every horizon's aim+step+know text names no horizon honestly, rather than taking whichever horizon happens to be nearest.
export function nearestHorizonFor(text, horizons) {
  if (!text || !horizons || horizons.length < 2) return null;
  const all = horizons.map((h) => ncd(text, h.text)).sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] || 1;
  const top = rank(text, horizons, 1)[0];
  if (!top) return null;
  const margin = +(median - top.d).toFixed(3);
  return margin >= RIDE_FLOOR ? { horizon: top.id, margin } : null;
}
export function horizonTexts(H) {
  return H.filter((h) => h.hz !== 'RULES').map((h) => ({ id: h.id, text: strip(`${h.aim} ${h.step} ${h.know}`) }));
}
export function compose() {
  const spec = readFileSync(resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md'), 'utf8');
  const rows = openRows(spec);
  const commits = execFileSync('git', ['log', '-300', '--format=%h\t%s'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').map((l) => { const [id, ...t] = l.split('\t'); return { id, text: strip(t.join(' ')) }; });
  const H = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/horizons.json'), 'utf8')).rows;
  const horizons = H.map((h) => ({ id: h.id, hz: h.hz, ...walkOne(strip(`${h.aim} ${h.step} ${h.know}`), rows, commits) }));
  const D = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-decisions.json'), 'utf8')).decisions.filter((d) => !d.done);
  // The action rows too (data/vna/mailbox-rpm.json), so every Mailbox row's MASSIVE ACTION names the open rows it rides on; a row in the
  // top four for more than a quarter of the mailbox is a hub and never counts as a ride (same reading as the horizons').
  let A = {}; try { A = JSON.parse(readFileSync(resolve(REPO, 'data/vna/mailbox-rpm.json'), 'utf8')).rows || {}; } catch { A = {}; }
  const asks = [...D, ...Object.entries(A).map(([id, x]) => ({ id, ...x }))];
  const decisions0 = asks.map((d) => { const q = strip(`${d.why || ''} ${d.result || ''} ${d.action || d.guess || ''} ${d.ask || ''}`); const all = rows.filter((r) => r.id !== d.id).map((r) => ncd(q, r.text)).sort((a, b) => a - b); return { id: d.id, horizon: d.horizon || '', median: all[Math.floor(all.length / 2)] || 1, near: rank(strip(`${d.why || ''} ${d.result || ''} ${d.action || d.guess || ''} ${d.ask || ''}`), rows.filter((r) => r.id !== d.id), 14).map((r) => ({ id: r.id, d: +r.d.toFixed(3) })) }; });
  const dtop = {}; for (const d of decisions0) for (const x of d.near.slice(0, 4)) dtop[x.id] = (dtop[x.id] || 0) + 1;
  const dhubs = new Set(Object.entries(dtop).filter(([, n]) => n > decisions0.length / 4).map(([id]) => id));   // measured 2026-10-21: C1025c sat in 28 of 31 top-fours
  // A ride counts only when it clears the crowd: median NCD minus the ride's NCD ≥ RIDE_FLOOR (the Horizons column's thin line). Below it
  // the row has no spec row of its own yet — said, never padded with the nearest generic row.
  const decisions = decisions0.map((d) => { const r = d.near.filter((x) => !dhubs.has(x.id)); const margin = r[0] ? +(d.median - r[0].d).toFixed(3) : 0; return { id: d.id, horizon: d.horizon, margin, rides: r.filter((x) => d.median - x.d >= RIDE_FLOOR).slice(0, 2) }; });
  const top = {}; for (const h of horizons) for (const x of h.ncd) top[x.id] = (top[x.id] || 0) + 1;
  const hubs = Object.entries(top).filter(([, n]) => n > horizons.length / 3).map(([id, n]) => ({ id, n }));
  for (const h of horizons) h.rides = h.ncd.filter((x) => !hubs.some((u) => u.id === x.id));
  return { at: new Date().toISOString(), open: rows.length, commits: commits.length, hubs, horizons, decisions, decisionHubs: [...dhubs] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = compose(); writeFileSync(resolve(REPO, 'data/vna/horizon-walk.json'), JSON.stringify(r, null, 1) + '\n');
  for (const h of r.horizons) console.log(`  ${h.id} ${h.hz.padEnd(10)} margin ${h.margin} · rides on ${h.rides.length ? h.rides.map((x) => `${x.id} (${x.d})`).join(' · ') : 'only hubs — no specific row yet'} · snowball → ${h.snow.map((x) => x.id).join(' · ')} · nearest commit ${h.commits[0] ? `${h.commits[0].sha} "${h.commits[0].subject}"` : '—'}`);
  console.log(`  mailbox: ${r.decisions.map((d) => `${d.id}→${d.rides.map((x) => x.id).join('/')}`).join(' · ')}`);
  console.log(`  hubs (near everything, dropped from rides): ${r.hubs.map((u) => `${u.id}×${u.n}`).join(' · ') || 'none'}`);
  console.log(`  ${r.open} open rows · ${r.commits} commits · l1 arm UNMEASURED (horizon text not walked yet)`);
}
// C1020a (his note on the Mailbox, 2026-10-20: "connect horizon to coordinates and links in the horizon doc always"): every Horizons row
// carries the open rows it rides on, each with the pixel the one Rust walk gave that row (spec-tree.json node.pixel — read, never
// re-walked), and one OPEN IN STEER link to the first ride. A receipt older than horizons.json, or none, prints UNMEASURED with the
// command, never a stale ride shown as current.
export function horizonCoords(rows, { walk, tree, steerLink, srcMtime = 0, walkMtime = 0 } = {}) {
  const pix = (id) => (tree && tree.nodes && tree.nodes[`n_spec_${id}`] && tree.nodes[`n_spec_${id}`].pixel) || 'unplaced';
  const by = new Map(((walk && walk.horizons) || []).map((h) => [h.id, h]));
  const stale = !walk || walkMtime < srcMtime;
  return rows.map((r) => {
    if (r.hz === 'RULES') return { ...r, coords: 'R4: each aim below names the open rows it rides on, at their pixel', open: '' };
    const h = by.get(r.id);
    if (stale || !h) return { ...r, coords: `UNMEASURED — ${!walk ? 'no walk receipt' : stale ? 'the walk is older than horizons.json' : 'row not in the walk'}; run node scripts/ops/horizon-walk.mjs`, open: '' };
    const rides = h.rides.length ? h.rides : h.ncd;
    const head = `margin ${h.margin}${h.margin < 0.15 ? ' (thin: no row is much nearer than the crowd)' : ''}`;
    return { ...r, coords: `${rides.map((x) => `${x.id} @ ${pix(x.id)}`).join(' · ')}${h.rides.length ? '' : ' (hubs only)'} · ${head}`, open: rides[0] ? steerLink(rides[0].id) : '' };
  });
}

// C1106 (operator note on H-07: "can do a more aggressive, more immediate connection — on 3 and 10, tie it to the actual story of
// the brand/IP and to a believable bottom-up count"): the bottom-up chain from today's install count to a horizon's placed-volume
// target. Every link is a number already on the record (installs, unit price, the target in the aim's own text) or UNMEASURED —
// never a forecast of the growth rate itself, only the arithmetic the target implies. TARGETS is a parse of each row's own aim text,
// so a changed aim changes the chain on the next run rather than silently drifting from it.
export function bottomUpTarget(aim) {
  const m = String(aim || '').match(/\$([\d.]+)T\+?\s*a year/);
  return m ? Number(m[1]) * 1e12 : null;
}
export function bottomUpYears(hz) {
  const m = String(hz || '').match(/(\d+)\s*year/);
  return m ? Number(m[1]) : null;
}
export function bottomUpChain(row, { installs, unitPrice } = {}) {
  const inst = installs || JSON.parse(readFileSync(resolve(REPO, 'data/vna/licence-funnel.json'), 'utf8')).installs;
  const unit = unitPrice || readUnitPrice();
  const target = bottomUpTarget(row.aim);
  const years = bottomUpYears(row.hz);
  if (!inst || inst.status !== 'MEASURED' || !target || !years) {
    return 'BOTTOM-UP: UNMEASURED — needs installs.status=MEASURED (data/vna/licence-funnel.json), a parsed "$NT a year" target and a parsed year count on this row';
  }
  const targetAgentYears = target / unit;
  const perYear = (targetAgentYears / inst.n) ** (1 / years);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  return `BOTTOM-UP: ${inst.n} installs today (MEASURED, data/vna/licence-funnel.json) × $${unit}/agent-year (src/app/pricing/page.tsx UNIT_PRICE) → $${(target / 1e12).toLocaleString('en-US')}T/yr needs ${fmt(targetAgentYears)} agent-years/yr; from ${inst.n} to ${fmt(targetAgentYears)} over ${years} years needs a sustained ${fmt(perYear)}×/yr — the arithmetic the target implies, not a prediction of the rate.`;
}

// C1107 (operator note on H-08: "double exponential has fired how many times by then? what guards mitigates the downsides?"):
// the doubling count, computed live from the two ×N rates named in the row's own aim text (never a pasted figure), plus the
// three downsides in the same aim's parenthetical, each matched to the guard that holds it and the licence clause it lives
// in — or UNMEASURED when a downside names no guard yet.
export function doubleExponentialRates(aim) {
  return [...String(aim || '').matchAll(/×([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}
export function downsideList(aim) {
  const m = String(aim || '').match(/guards \(([^()]*)\)/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}
export const DOWNSIDE_GUARDS = {
  'the halt stays with the deployer': { guard: 'C593 — tests/vna/c593-runtime-halt-is-theirs-to-wire.test.mjs', clause: 'docs/legal/agent-year-license-terms.md §9.3' },
  'records stay open': { guard: 'C165c — tests/vna/c165c-the-blob-store-is-append-only.test.mjs', clause: 'docs/legal/agent-year-license-terms.md §10.1' },
  'more than one recorder': { guard: 'mesh-ledger-concurrency — tests/pmu-simulator/mesh-ledger-concurrency.test.mjs', clause: 'docs/legal/agent-year-license-terms.md §6.2' },
};
export function doubleExponentialChain(row) {
  const years = bottomUpYears(row.hz);
  const rates = doubleExponentialRates(row.aim);
  const downsides = downsideList(row.aim);
  if (!years || rates.length < 2 || !downsides.length) {
    return 'DOUBLE-EXPONENTIAL: UNMEASURED — needs two ×N rates and a "guards (...)" downside list in this row\'s aim, and a parsed year count on hz';
  }
  const combined = rates.reduce((a, b) => a * b, 1);
  const doublings = Math.log2(combined);
  const perRate = rates.map((r) => `×${r.toLocaleString('en-US')} (${Math.log2(r).toFixed(2)} doublings)`);
  const guards = downsides.map((d) => {
    const g = DOWNSIDE_GUARDS[d];
    return g ? `${d} → guard ${g.guard}, licence ${g.clause}` : `${d} → UNMEASURED (no guard mapped)`;
  });
  return `DOUBLE EXPONENTIAL: ${perRate.join(' and ')} compound to ×${combined.toLocaleString('en-US')} over ${years} years = ${doublings.toFixed(2)} doublings, one every ${(years / doublings).toFixed(2)} yr (log2(${combined.toLocaleString('en-US')}) = ${doublings.toFixed(2)}). ${guards.join(' · ')}`;
}

// C1109 (operator note on H-06: "UL - what patterns do we run / create / ride on.."): the patterns H-06's
// aim already runs, creates and rides on — one per semicolon-joined clause in the aim's own text, never a
// hand-counted list — each matched to whose motion carries it (a hand-kept mapping, chair-read, keyed by
// the live clause text so a changed aim falls to UNMEASURED rather than drifting silently) and to the open
// spec row nearest it by gzip-NCD (same median-margin reading as walkOne), never a hand-typed row id.
// "UL" is the operator's own shorthand, kept verbatim; its meaning stays UNCLEAR.
export function patternPhrases(aim) {
  return String(aim || '').replace(/^AIM\s*·\s*/, '').split(';').map((s) => s.trim()).filter(Boolean);
}
export const PATTERN_MOTIONS = {
  "The double exponential fires: $1T a year placed through the record — the Agent-Year Meter's crossing — with retained revenue the political question the meter names":
    "the installs' own agent-year count climbing (data/vna/licence-funnel.json) against the meter's run-rate line — nobody pushes the count, it only grows",
  'the record is the default sign-off for agent write access across regulated industries':
    "a deployer's own policy motion — the policy already demands a stamp before write access; the record only has to be the stamp that policy reaches for",
  'the allies roll into one clearing layer':
    "the allies' own consolidation motion — each ally rolls its ledger into the shared one because the shared one costs less to hold than its own",
};
export function patternsChain(row, rows) {
  const phrases = patternPhrases(row.aim);
  if (phrases.length < 3) return "PATTERNS: UNMEASURED — needs at least 3 semicolon-joined clauses in this row's aim";
  const lines = phrases.map((phrase) => {
    const motion = PATTERN_MOTIONS[phrase] || 'UNMEASURED (no motion mapped)';
    const all = rows.map((r) => ncd(phrase, r.text)).sort((a, b) => a - b);
    const median = all[Math.floor(all.length / 2)] || 1;
    const top = rank(phrase, rows, 1)[0];
    const ride = top && median - top.d >= RIDE_FLOOR ? `${top.id} (margin ${(median - top.d).toFixed(3)})` : 'UNMEASURED — no open row clears the crowd';
    return `"${phrase}" — motion: ${motion} — rides on ${ride}`;
  });
  return `PATTERNS: ${lines.join(' · ')}`;
}

// C1105 (operator note on H-06: "what is the quantum leap we can do now to get this done?"): the one act
// this row's aim pulls hardest, from the open Mailbox asks (board-decisions.json decisions + mailbox-rpm.json
// rows, never hand-picked) ranked against the aim's own text by gzip-NCD. A quantum leap is the nearest act
// that still clears the crowd (margin ≥ RIDE_FLOOR against the median of ALL candidates, same reading as a
// ride) — below that floor every act is equally far and naming one would be an increment dressed as a leap.
// The act is named with today's date, the open spec row it rides on, and the margin by which it beats the
// next-best candidate, so "why it beats the next-best act" is a measured gap, never an asserted preference.
export function quantumLeapAsks(repo = REPO) {
  const D = JSON.parse(readFileSync(resolve(repo, 'data/vna/board-decisions.json'), 'utf8')).decisions.filter((d) => !d.done);
  let A = {}; try { A = JSON.parse(readFileSync(resolve(repo, 'data/vna/mailbox-rpm.json'), 'utf8')).rows || {}; } catch { A = {}; }
  return [...D, ...Object.entries(A).map(([id, x]) => ({ id, ...x }))].filter((d) => d.action);
}
export function quantumLeapChain(row, asks, rows, today = new Date().toISOString().slice(0, 10)) {
  if (asks.length < 2) return 'QUANTUM LEAP: UNMEASURED — needs at least 2 candidate acts with an action field across board-decisions.json and mailbox-rpm.json';
  const aim = strip(row.aim);
  const cands = asks.map((a) => ({ id: a.id, text: strip(a.action), d: ncd(aim, strip(a.action)) })).sort((a, b) => a.d - b.d);
  const all = cands.map((c) => c.d).sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] || 1;
  const [top, next] = cands;
  if (median - top.d < RIDE_FLOOR) return `QUANTUM LEAP: UNMEASURED — nearest candidate act (${top.id}) is only ${(median - top.d).toFixed(3)} below the median, under RIDE_FLOOR (${RIDE_FLOOR}); no act clears the crowd`;
  const ridden = rank(top.text, rows.filter((r) => r.id !== top.id), 1)[0];
  const rowAll = rows.filter((r) => r.id !== top.id).map((r) => ncd(top.text, r.text)).sort((a, b) => a - b);
  const rowMedian = rowAll[Math.floor(rowAll.length / 2)] || 1;
  const ride = ridden && rowMedian - ridden.d >= RIDE_FLOOR ? `${ridden.id} (margin ${(rowMedian - ridden.d).toFixed(3)})` : 'UNMEASURED — no open row clears the crowd';
  const beat = +(next.d - top.d).toFixed(3);
  return `QUANTUM LEAP (${today}): ${top.id} — "${top.text}" — rides on ${ride} — beats next-best ${next.id} ("${next.text}") by margin ${beat} (NCD ${top.d.toFixed(3)} vs ${next.d.toFixed(3)})`;
}

// C1110 (operator note on H-07, the Horizons page as a whole: "lets add to the mailbox in inferred
// by this page - this is the perspective that makes it all coheare if we do it right"): every
// horizon row needs at least one Mailbox IN ticket derived from it — its own `horizon` field naming
// the row, or its context/why naming the row's id as the note it was inferred from (the
// H-08/D-hz-continuations cross-reference already on the record) — or, when none rides on it yet, a
// one-line reason why not, hand-kept so a reason never drifts stale once a ticket does land.
export function mailboxTickets(repo = REPO) {
  const D = JSON.parse(readFileSync(resolve(repo, 'data/vna/board-decisions.json'), 'utf8')).decisions;
  let A = {}; try { A = JSON.parse(readFileSync(resolve(repo, 'data/vna/mailbox-rpm.json'), 'utf8')).rows || {}; } catch { A = {}; }
  return [...D.map((d) => ({ id: d.id, horizon: d.horizon || '', context: d.context || '', why: d.why || '' })),
    ...Object.entries(A).map(([id, x]) => ({ id, horizon: x.horizon || '', context: x.context || '', why: x.why || '' }))];
}
export const MAILBOX_UNCOVERED_REASONS = {
  'H-09': "No act inside the next quarter turns on a hundred-year horizon; every Mailbox IN ticket decides something nearer than that.",
  'H-10': "Nothing decidable rides on a thousand-year horizon; it names the limit the nearer horizons walk toward, never an act of its own.",
};
export function mailboxCoverage(id, tickets) {
  const hit = tickets.filter((t) => t.horizon === id || (t.horizon !== id && (t.context.includes(id) || t.why.includes(id))));
  if (hit.length) return `MAILBOX: covered by ${hit.map((t) => t.id).join(' · ')}`;
  const reason = MAILBOX_UNCOVERED_REASONS[id];
  return reason ? `MAILBOX: UNCOVERED — ${reason}` : 'MAILBOX: UNCOVERED — no reason named yet';
}

// C1108 (operator note on H-09: "tie it to the physics pov, the impact — what does it change if
// we are right (know we are where we are unassailable and price it in)"): the IF-RIGHT line ties
// H-09's aim to CLAUDE.md's pinned k_E and prices the consequence — never typed here, so a changed
// pin or a changed licence meter moves the line on the next run instead of drifting from it.
// canonicalKE() parses k_E and its bits-per-crossing gloss straight out of CLAUDE.md's CANONICAL
// NUMBERS section (the one place those numbers live); attestationCap() parses the licence's own
// meter cap ("N attestations") out of src/app/pricing/page.tsx, the same anchor readUnitPrice()
// already reads. The consequence is arithmetic already implied by two shipped facts — the unit
// price and the meter cap — divided, never asserted.
export function canonicalKE(repo = REPO) {
  const src = readFileSync(resolve(repo, 'CLAUDE.md'), 'utf8');
  const kE = src.match(/\*\*k_E = ([0-9.]+)\*\*/);
  const bits = src.match(/([0-9.]+ bits per boundary crossing)/);
  return kE && bits ? { value: kE[1], bits: bits[1] } : null;
}
export function attestationCap(repo = REPO) {
  const src = readFileSync(resolve(repo, 'src/app/pricing/page.tsx'), 'utf8');
  const m = src.match(/([\d,]+)\s*attestations/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
export function ifRightChain({ ke, unitPrice, cap } = {}) {
  const K = ke !== undefined ? ke : canonicalKE();
  const unit = unitPrice !== undefined ? unitPrice : readUnitPrice();
  const C = cap !== undefined ? cap : attestationCap();
  if (!K || !unit || !C) {
    return 'IF RIGHT: UNMEASURED — needs k_E parsed from CLAUDE.md, the unit price (src/app/pricing/page.tsx UNIT_PRICE) and the attestation cap (src/app/pricing/page.tsx "N attestations")';
  }
  const perCrossing = unit / C;
  return `IF RIGHT: k_E = ${K.value} (${K.bits}) — if meaning has addresses and every decision a countable cost, the $${unit} agent-year licence is already a price on crossings, not a flat fee: ${C.toLocaleString('en-US')} attestations for $${unit} prices one crossing at $${perCrossing.toFixed(4)}, a number above zero and below the cost of reading it — the pricing the physics implies is already shipped, not a future ask.`;
}

// C1090 (chair decomposition of the operator's words, not on the tape, carried on the row: "2. AIM UNPROVED: H-02 KNOW is
// 'Greg names the 17 Nov slot in writing'; email-sent.ndjson holds only book-club sends to redacted@example.com since 9 Oct."):
// a horizon's `know` field is a sentence someone wrote once; it is never, by itself, evidence that the thing it names has
// happened. The fix is not a stronger sentence — it is a CHECK that reads a record, not the live inbox (AXIOM 1 W3: a
// checkpoint reads a record the actor did not author; same reading as register/non-response.mjs, which states it plainly:
// "Gmail is not read here"). KNOW_CHECKS names, per horizon, whose address and what written phrase would count; knowCheck()
// reads .thetacog/inbound-replies.ndjson (the one place a logged inbound reply lands) for a hit, and returns UNPROVED — never
// silently PROVED — when that file does not exist or carries no matching row. A horizon with no entry in KNOW_CHECKS reads
// UNMEASURED, never a guess dressed as a check.
//
// C1094 (chair decomposition of the operator's words, carried on the spec row, not on the tape: "the hyperstitions should
// dictate backwards in time to today ie what the steps today are"): a single inbox check only covered H-02. Each horizon's
// `know` line now NAMES its proof source, one of five kinds this repo already keeps a record in — email-sent.ndjson, the
// inbox (.thetacog/inbound-replies.ndjson), the credits ledger, metrics-actuals.json, or a git commit — and knowCheck()
// reads that NAMED record, never the live tool behind it (same AXIOM 1 W3 reading as C1090). A third state joins
// PROVED/UNPROVED: BEHIND, when the item's own due date has passed with nothing proved — so "AIM UNPROVED" stops being
// whoever last eyeballed the sheet and starts being this function's return value. `source` reads committed text via
// `git show HEAD:<path>` (never the working tree — the same commit the receipt is read from elsewhere in this repo), so a
// staged-but-uncommitted fix does not falsely clear the check.
function committedText(repo, path) {
  try { return execFileSync('git', ['show', `HEAD:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
}
const dueState = (done, due, today) => (done ? 'PROVED' : !due ? 'UNPROVED' : today > due ? 'BEHIND' : 'UNPROVED');

export const KNOW_CHECKS = {
  'H-00': { kind: 'git-rule', source: 'a git commit', file: 'scripts/ops/horizon-walk.mjs', needle: 'h.rides = h.ncd.filter((x) => !hubs.some' },
  'H-01': { kind: 'compound', source: 'a git commit · metrics-actuals', items: [
    { label: 'C244', kind: 'spec-tick', rowId: 'C244', due: '2026-10-21', path: 'docs/specs/vna/SPEC-VNA-COCKPIT.md' },
    { label: 'the ledger wire', kind: 'metrics-actuals', due: '2026-10-27', path: 'data/vna/metrics-actuals.json' },
  ] },
  'H-02': {
    kind: 'inbox',
    source: 'the inbox',
    who: 'Greg Hill',
    from: [/@k4northwest\.com$/i, /@ecovg\.com$/i],
    pattern: /\b17(th)?[\s-]*nov(ember)?\b|\bnov(ember)?[\s-]*17(th)?\b/i,
    due: '2026-10-27',
  },
};

function checkItem(it, repo, today) {
  if (it.kind === 'spec-tick') {
    const text = committedText(repo, it.path);
    const m = text && text.match(new RegExp(`^- \\[([ x])\\] ${it.rowId}\\b`, 'm'));
    const status = dueState(!!(m && m[1] === 'x'), it.due, today);
    return { label: it.label, status, detail: m ? (m[1] === 'x' ? 'ticked' : 'open') : `${it.rowId} not found in HEAD:${it.path}` };
  }
  if (it.kind === 'metrics-actuals') {
    let wired = false, detail = `no HEAD:${it.path}`;
    const text = committedText(repo, it.path);
    if (text) { try { const j = JSON.parse(text); wired = j.status === 'MEASURED' && /credits_ledger/i.test(j.source || ''); detail = `status ${j.status} · source ${j.source}`; } catch { detail = 'unparsable JSON'; } }
    return { label: it.label, status: dueState(wired, it.due, today), detail };
  }
  return { label: it.label, status: 'UNMEASURED', detail: `no handler for item kind "${it.kind}"` };
}

export function knowCheck(id, repo = REPO, today = new Date().toISOString().slice(0, 10)) {
  const spec = KNOW_CHECKS[id];
  if (!spec) return 'KNOW: UNMEASURED — no check configured for this horizon (add an entry to KNOW_CHECKS)';

  if (spec.kind === 'git-rule') {
    const text = committedText(repo, spec.file);
    if (text && text.includes(spec.needle)) return `KNOW: PROVED — HEAD:${spec.file} carries the rule's own code (source: ${spec.source})`;
    return `KNOW: UNPROVED — HEAD:${spec.file} does not carry the rule's own code (source: ${spec.source})`;
  }

  if (spec.kind === 'compound') {
    const parts = spec.items.map((it) => checkItem(it, repo, today));
    const status = parts.some((p) => p.status === 'BEHIND') ? 'BEHIND' : parts.every((p) => p.status === 'PROVED') ? 'PROVED' : 'UNPROVED';
    return `KNOW: ${status} — ${parts.map((p) => `${p.label} ${p.status} (${p.detail})`).join(' · ')} (source: ${spec.source})`;
  }

  // spec.kind === 'inbox' — the H-02 path kept byte-identical to C1090 while UNPROVED is not yet due; BEHIND only replaces
  // the leading word once `due` has passed, so every C1090 regex against the live, not-yet-due record still matches.
  const label = dueState(false, spec.due, today) === 'BEHIND' ? 'BEHIND' : 'UNPROVED';
  const path = resolve(repo, '.thetacog/inbound-replies.ndjson');
  if (!existsSync(path)) {
    return `KNOW: ${label} — no inbound reply recorded yet (.thetacog/inbound-replies.ndjson does not exist); Gmail is never read here (AXIOM 1 W3), only a logged record`;
  }
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const addrOf = (s) => String(s || '').replace(/.*</, '').replace(/>.*/, '').trim();
  const hit = rows.find((r) => r && spec.from.some((re) => re.test(addrOf(r.from))) && spec.pattern.test(String(r.body || r.text || '')));
  if (!hit) return `KNOW: ${label} — .thetacog/inbound-replies.ndjson carries no reply from ${spec.who} naming the written slot`;
  return `KNOW: PROVED — ${hit.from} named it in writing (${hit.ts || hit.at || 'no timestamp on the row'})`;
}

// C1092 (chair decomposition 2026-10-21, not on the tape: "4. AIM BEHIND RISK: benchmark 2026-10-27 'three providers
// listed who can re-set a configured workflow inside a day' has no provider list on the record. Name the list's source
// file and the three candidates, or log the benchmark as behind with the row that closes it."): the 2026-10-27 benchmark
// on D6.H-02 (docs/specs/vna/warranty-demand.json) named no source file and no candidates anywhere in the record — grepped
// across docs/specs/vna, data/vna and .thetacog, the only hits are the benchmark's own sentence repeated through generated
// sidecars. data/vna/providers-map.json is now that source file, hand-kept and empty. providerListCheck() reads it the
// same way knowCheck() reads the inbox (AXIOM 1 W3 — never a guess, never the live web): UNPROVED before the due date,
// BEHIND once 2026-10-27 passes with fewer than 3 named providers. The row that closes the gap is this check itself —
// once providers-map.json carries 3 named entries the read flips to PROVED, so no second spec row is invented to carry
// work this function already tracks.
export const PROVIDER_LIST_DUE = '2026-10-27';
export function providerListCheck(repo = REPO, today = new Date().toISOString().slice(0, 10)) {
  const path = resolve(repo, 'data/vna/providers-map.json');
  if (!existsSync(path)) return `PROVIDERS: ${dueState(false, PROVIDER_LIST_DUE, today)} — data/vna/providers-map.json does not exist (no source file on the record)`;
  let providers = [];
  try { providers = JSON.parse(readFileSync(path, 'utf8')).providers || []; } catch { return `PROVIDERS: ${dueState(false, PROVIDER_LIST_DUE, today)} — data/vna/providers-map.json is not valid JSON`; }
  const named = providers.filter((p) => p && p.name);
  const status = dueState(named.length >= 3, PROVIDER_LIST_DUE, today);
  if (status === 'PROVED') return `PROVIDERS: PROVED — ${named.map((p) => p.name).join(', ')} (source: data/vna/providers-map.json)`;
  return `PROVIDERS: ${status} — data/vna/providers-map.json carries ${named.length} of 3 named providers (due ${PROVIDER_LIST_DUE})`;
}
