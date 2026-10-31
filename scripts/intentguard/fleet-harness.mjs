#!/usr/bin/env node
// scripts/intentguard/fleet-harness.mjs — C496 · R7 OUR OWN ROBOTS FIRST: the launchd fleet writes receipts.
//
// Operator 2026-09-30, verbatim: "having it running on our [own machines]" · "and build this to spec all the way".
// Each named machine actor on this Mac routes its discrete actions through the C494 reference harness
// (packages/intentguard/own/robot/harness.js) against the job spec committed at docs/specs/fleet/<job>.md:
//
//   cos-overnight        scripts/controller/cos-overnight.sh     (stage 8 of the controller tick)
//   spec-reply-execute   scripts/spec-reply-execute.sh           (com.thetacog.spec-reply-execute + tick stage 1)
//   accept-to-spec       scripts/cog/accept-to-spec.mjs          (com.thetacog.accept-to-spec)
//   calendar-primer      scripts/calendar-primer-cron.sh         (com.thetacog.calendar-primer)
//   controller-tick      scripts/controller/tick.sh              (com.thetacog.controller)
//
// Two doors, one harness:
//   in-process   import { fleetJob } from './fleet-harness.mjs'; const fleet = fleetJob('accept-to-spec');
//                fleet.act('<action text>', () => doIt())   — places the receipt, then runs fn and returns its result
//   a bash job   . scripts/intentguard/fleet-receipt.sh; fleet_receipt <job> '<action text>'
//                → node scripts/intentguard/fleet-harness.mjs place <job> '<action text>'   (bounded, always exit 0)
//
// Receipts land on .thetacog/fleet-tape/<job>.ndjson (gitignored; INTENTGUARD_FLEET_TAPE_DIR overrides). The witness is
// OFF unless INTENTGUARD_FLEET_WITNESS=1 (then INTENTGUARD_FLEET_WITNESS_URL, default the production notary ingest, and
// INTENTGUARD_LICENCE). No plist sets it; turning it on is a human act.
//
// TAPE, NOT BRAKE. Nothing here may block, slow meaningfully or break a job: a missing spec, an addon that will not load,
// a tape that will not append — each becomes an UNMEASURED row or a silent no-op, and fn runs anyway. There is no throw on
// the act path and the CLI exits 0 whatever happened.
//
// SUFFICIENT FOR: "this job placed and signed each wrapped action, in order, against its declared spec, before taking it".
// NOT SUFFICIENT FOR: whether any action was good (Rice), or an action the job took outside act()/fleet_receipt.
// Port row: none — this is transport (spawn, env, a file path); the deciding and the mass live in the crate already.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { providersAtCell } from '../../src/lib/backup/dispatch-market.mjs';   // C916: who holds landed grip at an excursion's cell
import { haltDecision } from './halt-policy.mjs';   // C917: the deployer's knobs (policy · max_excursion_distance · token_ceiling)

const require = createRequire(import.meta.url);
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HARNESS_PATH = join(REPO, 'packages/intentguard/own/robot/harness.js');
export const JOBS = ['cos-overnight', 'spec-reply-execute', 'accept-to-spec', 'calendar-primer', 'controller-tick'];
export const ENTRIES = {
  'cos-overnight': 'scripts/controller/cos-overnight.sh',
  'spec-reply-execute': 'scripts/spec-reply-execute.sh',
  'accept-to-spec': 'scripts/cog/accept-to-spec.mjs',
  'calendar-primer': 'scripts/calendar-primer-cron.sh',
  'controller-tick': 'scripts/controller/tick.sh',
};
export const DEFAULT_WITNESS_URL = 'https://thetadriven.com/api/notary/ingest';

export const tapeDir = (env = process.env) => resolve(env.INTENTGUARD_FLEET_TAPE_DIR || join(REPO, '.thetacog/fleet-tape'));
export const specDir = (env = process.env) => resolve(env.INTENTGUARD_FLEET_SPEC_DIR || join(REPO, 'docs/specs/fleet'));
export const specPath = (job, env = process.env) => join(specDir(env), `${job}.md`);
export const tapePath = (job, env = process.env) => join(tapeDir(env), `${job}.ndjson`);
export const keyHome = (env = process.env) => env.INTENTGUARD_HOME || undefined;

// C916: a job's own declared ring envelope (pole · electrician · forbidden), the same sidecar fleet-reading.mjs reads
// back — docs/specs/fleet/<job>.rings.json by default. No file means no declared pole yet; null, never a thrown error.
export function ringsFor(job, env = process.env) {
  try { return JSON.parse(readFileSync(join(specDir(env), `${job}.rings.json`), 'utf8')); } catch { return null; }
}

export const alignmentMapPath = (env = process.env) => resolve(env.INTENTGUARD_FLEET_ALIGNMENT_MAP || join(REPO, 'data/vna/alignment-map.json'));

// C916: the provider-naming callback the harness takes — reads the alignment map ONCE, lazily (so a job that never
// excurses never touches the file), and hands back the room keys landed at the given cell, off dispatch-market.mjs's
// own exact-match read. A missing or unreadable map comes back empty, never an error.
function providersFn(env) {
  let map, read = false;
  return (cell) => {
    if (!read) { read = true; try { map = JSON.parse(readFileSync(alignmentMapPath(env), 'utf8')); } catch { map = null; } }
    return map ? providersAtCell(map, cell).map((r) => r.key) : [];
  };
}

/** The witness the harness posts to: null (tape only) unless INTENTGUARD_FLEET_WITNESS=1. */
export function witnessConfig(env = process.env) {
  if (env.INTENTGUARD_FLEET_WITNESS !== '1') return { witnessUrl: null, licence: null };
  return { witnessUrl: env.INTENTGUARD_FLEET_WITNESS_URL || DEFAULT_WITNESS_URL, licence: env.INTENTGUARD_LICENCE || null };
}

const errText = (e) => String((e && e.message) || e);

// C917: the call's own cell, read off what place() already returned — the excursion's cell when one fired
// (electrician/demolisher), else the card's own pixel (the receipt's first line) for a plumber-ring call.
// Never a second placement: the SAME card the tape already carries.
function pixelOfPlaced(placed) {
  if (placed && placed.excursion && placed.excursion.cell) return placed.excursion.cell;
  if (!placed || !placed.receipt) return null;
  try { return JSON.parse(String(placed.receipt).split('\n')[0]).pixel ?? null; } catch { return null; }
}

// C917 THE DEPLOYER TUNES THE HALT: the same sidecar ringsFor() already reads (pole · electrician ·
// forbidden) carries three more knobs — policy, max_excursion_distance, token_ceiling — read HERE, not
// re-declared, so a deployer edits one file for both the ring and the halt. A job with no sidecar (every
// production job today) reads ring=null from pixelOfPlaced/placed.ring and gets LOG_AND_CONTINUE: this
// row changes nothing for a job that has declared nothing.
export function decisionFor(placed, envelope, tokens = null) {
  return haltDecision({ ring: (placed && placed.ring) || null, pixel: pixelOfPlaced(placed), pole: (envelope && envelope.pole) || [], knobs: envelope || {}, tokens });
}

/** The addon, through the host's one resolution (src/lib/intentguard/addon.mjs). null → the harness writes UNMEASURED rows. */
async function hostAddon() {
  try {
    const { loadAddon } = await import(pathToFileURL(join(REPO, 'src/lib/intentguard/addon.mjs')).href);
    const { addon, reason } = loadAddon();
    return addon && typeof addon.openSpec === 'function' ? { addon } : { addon: null, reason: reason || 'the host addon has no openSpec' };
  } catch (e) { return { addon: null, reason: errText(e) }; }
}
const ADDON = await hostAddon();

/**
 * One job's harness, built on the first act (so importing an entry mints nothing and opens nothing).
 * Returns { job, act(action, fn), place(action), flush(ms), stats() }. Never throws.
 */
export function fleetJob(job, { env = process.env } = {}) {
  let h = null, down = null;
  const open = () => {
    if (h || down) return h;
    try {
      const { createHarness } = require(HARNESS_PATH);
      let spec = '', addon = ADDON.addon;
      try { spec = readFileSync(specPath(job, env), 'utf8'); }
      catch (e) {
        // no declared spec: the action still happened, so it still takes a seq, as an UNMEASURED row naming why
        const why = `no declared job spec at ${specPath(job, env)} (${errText(e)})`;
        addon = { openSpec() { throw new Error(why); } };
      }
      const rings = ringsFor(job, env);
      h = createHarness({ spec, tapePath: tapePath(job, env), job, keyHome: keyHome(env), ...(rings ? { rings, providersAtCell: providersFn(env) } : {}), ...witnessConfig(env), ...(addon ? { addon } : {}) });
    } catch (e) { down = `UNMEASURED: fleet harness for ${job} did not open — ${errText(e)}`; h = null; }
    return h;
  };
  const place = (action) => {
    try { const hh = open(); return hh ? hh.place(String(action)) : { receipt: null, unmeasured: down }; }
    catch (e) { return { receipt: null, unmeasured: `UNMEASURED: ${errText(e)}` }; }
  };
  return {
    job,
    place,
    // C917: place first (the call is on the tape and ringed before anything else runs), read the
    // deployer's own knobs off the SAME rings.json sidecar, then decide — PAUSE_FOR_DISPATCH and HALT
    // never call fn: the decision lands before the call leaves the box. LOG_AND_CONTINUE (the only
    // reading a job with no declared knobs can ever get) runs fn exactly as before this row.
    act(action, fn, { tokens = null } = {}) {
      const placed = place(action);
      const decision = decisionFor(placed, ringsFor(job, env), tokens);
      if (decision.action !== 'LOG_AND_CONTINUE') return { skipped: true, placed, decision };
      return fn();
    },
    flush(ms = 8000) { try { return h ? h.flush(ms) : Promise.resolve({ posted: 0, unwitnessed: 0, pending: 0 }); } catch { return Promise.resolve({}); } },
    stats() { try { return h ? { ...h.stats(), addonReason: ADDON.reason || null } : { down, addonReason: ADDON.reason || null }; } catch (e) { return { down: errText(e) }; } },
  };
}

// ─── CLI: the door a bash job uses (bounded by the caller's wall clock; always exits 0) ─────────────────────────────
//   node scripts/intentguard/fleet-harness.mjs place <job> <action text…>
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, job, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'place' && JOBS.includes(job) && rest.length) {
      const fleet = fleetJob(job);
      const r = fleet.place(rest.join(' '));
      if (witnessConfig().witnessUrl) await fleet.flush(8000);   // a short-lived process: give the queued post its bounded chance
      if (process.env.FLEET_HARNESS_VERBOSE) console.log(JSON.stringify({ job, seq: r.seq ?? null, sha256: r.sha256 ?? null, unmeasured: r.unmeasured || null }));
    } else if (process.env.FLEET_HARNESS_VERBOSE) {
      console.log(`usage: fleet-harness.mjs place <${JOBS.join('|')}> <action text>`);
    }
  } catch { /* tape, not brake: the job never sees a failure here */ }
  process.exit(0);
}
