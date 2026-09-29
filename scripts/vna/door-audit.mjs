#!/usr/bin/env node
// scripts/vna/door-audit.mjs — THE DOOR NAMED IS THE DOOR OPENED (C105, operator 2026-09-20: "obviously notarise does not
// upload, but backup does, uses your licenses" · "[bugs] all identified with steer and prevent steer falling short next time").
// A survey turn found by grep that the button labelled 💳 Notarise this tape runs vna.backupTape — the upload. /steer had
// painted that page for two days and never said so. This is the sensor that says so: DOOR_SEMANTICS is the one place the
// verbs of the left panel are bound to the command each must run and to what that command does with the tape (does it
// leave the machine? what does it spend?), and doorAudit reads the controls manifest (C89a — derived from the page, never
// typed) and reports every label whose verb names one door while its onclick opens another. DETECTED, never gated: the
// line is painted on the page and printed by the CLI; nothing here stops a render, and the fix stays its own row (C101a).
//   node scripts/vna/door-audit.mjs            the line for docs/specs/vna/steer/latest.html
//   node scripts/vna/door-audit.mjs --json     the audit as JSON
// @guard tests/vna/c105-door-named-is-door-opened.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { controlsManifest, PAGE } from './controls.mjs';

/** THE THREE DOORS (operator 2026-09-20: "and notarises the attested tape to support this experience" · "countersign backup"):
 *  🔏 Sign — free, your own key, local (every new row is signed at append, C97e; the door appends HEAD's row now) ·
 *  💳 Fund Autonomy Ledger (C132; was 💳 Notarise insurable tape until 2026-09-21) — the PAID door: the licence key from the portal stamps the attested tape locally, one credit per row, up to 10k, nothing uploaded (C102a/C102b) ·
 *  🔗 Countersign (backup) — the POST (C102c): the second reader's signature on the upload, a NEXT → step in day one, never a face button.
 *  Paths not taken, named: "Witness" (a noun, already the reader-set word) · "Legitimise" (a claim, not an act) · "Sign" for the paid door (it is the free one).
 *  The labels are CONSTANTS here and painted from here — two doors can never share one (the guard reads it). */
export const DOOR_LABEL = Object.freeze({ sign: '🔏 Sign this tape', notarise: '💳 Fund Autonomy Ledger', buy: 'buy keys', backup: '🔗 Countersign (backup)', sync: '☁️ Sync tape' });   // C132 (operator 2026-09-21, verbatim: "[💳 Fund Autonomy Ledger] … 🔗 Countersign (backup)"): the 💳 names what the credits FUND — the ledger of signed rows; one label in both key states (C111's construct kept). C111→C113h (operator 2026-09-20: "emoji notarise insurable tape - 0 countersigned receipts - 0 3rd party backups"): the 💳 names what the tape is FOR in every unfunded state, its metric is two numbers; buy: the same door's first step, the dim line UNDER the card's + — never a face, never a second button (C109c: one 💳). Before C111 the face flipped Buy keys → Notarise this tape by key state (C105).
// the verbs carry the `u` flag (C111): without it `💳?` makes only the emoji's LOW SURROGATE optional, so an emoji-less label
// (`buy keys`, the tier line) never matched a door — a token standing in for the construct, seen red on C105a
export const DOOR_SEMANTICS = Object.freeze({
  sign: Object.freeze({ verb: /^🔏?\s*sign\b/iu, label: DOOR_LABEL.sign, cmd: 'vna.signTape', uploads: false, spends: 'nothing — your own key, free, local', row: 'C97e' }),
  notarise: Object.freeze({ verb: /^💳?\s*(fund|notari[sz]e|buy keys)\b/iu, label: DOOR_LABEL.notarise, cmd: 'vna.notariseTape', uploads: false, spends: 'one credit per stamped row, on the local ledger', row: 'C102a' }),
  backup: Object.freeze({ verb: /^🔗?\s*(countersign|backup)\b/iu, label: DOOR_LABEL.backup, cmd: 'vna.backupTape', uploads: true, spends: 'licence credits — one per archive the third party countersigns', row: 'C102c' }),
});
/** the hosted notary's door (C97f), dormant behind notarize: hosted (C97b) — audited when painted, not one of the three day-one doors */
export const DORMANT_DOORS = Object.freeze({
  sync: Object.freeze({ verb: /^(?:☁️)?\s*sync tape\b/iu, label: DOOR_LABEL.sync, cmd: 'vna.syncTape', uploads: true, spends: 'one credit per witnessed commit', row: 'C97f' }),
});
const ALL_DOORS = Object.freeze({ ...DOOR_SEMANTICS, ...DORMANT_DOORS });

/** the door a label names, by its verb — null when the label names no bound door */
export function doorOf(label) {
  const l = String(label || '').trim();
  for (const [name, d] of Object.entries(ALL_DOORS)) if (d.verb.test(l)) return { name, ...d };
  return null;
}

/** pure over a controls manifest (C89a): every control whose label names a door, and whether its command is that door's */
export function doorAudit(manifest) {
  const named = [];
  for (const c of manifest || []) {
    if (c.kind !== 'button' || !c.cmd) continue;
    const d = doorOf(c.label);
    if (!d) continue;
    const agree = c.cmd === d.cmd;
    const ran = Object.values(ALL_DOORS).find((x) => x.cmd === c.cmd) || null;
    named.push({ label: c.label, card: c.card, cmd: c.cmd, expected: d.cmd, agree, uploads: ran ? ran.uploads : null, row: d.row });
  }
  return { named, disagree: named.filter((n) => !n.agree) };
}

/** one line for the page and the CLI — the verdict names both commands and whether the one that runs uploads */
export function doorLine(audit) {
  const n = audit.named.length;
  if (!n) return 'doors: none named — no button on this render carries a bound verb';
  if (!audit.disagree.length) return `doors: ${n} named · all agree`;
  const parts = audit.disagree.map((d) => `"${d.label}" runs ${d.cmd}${d.uploads === true ? ' (uploads)' : d.uploads === false ? ' (local)' : ''} · expected ${d.expected} (${d.row})`);
  return `doors: ${n} named · ${audit.disagree.length} DISAGREE — ${parts.join(' · ')}`;
}

export function auditPage(html) { return doorAudit(controlsManifest(html)); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = readFileSync(PAGE, 'utf8');
  const audit = auditPage(html);
  if (process.argv.includes('--json')) console.log(JSON.stringify(audit, null, 2));
  else console.log(doorLine(audit));
}
