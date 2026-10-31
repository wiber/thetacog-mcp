// scripts/bookclub/internal-addresses.mjs — the ONE definition of "this address is us".
//
// Extracted on first duplication (CLAUDE.md: a rule stated once lives in ONE place). Without
// the `wibe`/`emoo`/`moosman` arms, nine of the top 100 readers were the operator's own
// mailboxes and family — a self-ranking list. `elias@`/`eliasmoosman@` alone does not catch
// redacted@example.com, redacted@example.com, redacted@example.com, redacted@example.com,
// redacted@example.com or redacted@example.com.
//
// Owners: rank-readers-v2.mjs (ranking) and fast-human-queue.mjs (follow-up ordering). Any new
// consumer imports this — it never re-grows its own copy.
export const INTERNAL = new RegExp([
  '^(elias|eliasmoosman|bookclub|no-?reply|postmaster|mailer-daemon|bounce)@',
  '@thetadriven\\.com$',
  'moosman',            // elias.moosman@, marithamoosman@ (family), eliasmoosman.dare2dream@
  'wibe|wiber',         // thewibe@, wibenet@, wiber.b5ca2@
  'mr\\.emoo@',
  'elias_\\d+@',        // redacted@example.com
  'beyondthat@gmail',
].join('|'), 'i');

// Role inboxes never receive a *personal* follow-up — nobody owns them, so nobody answers.
export const ROLE = /^(info|investors|press|media|sales|support|hello|contact|team|news|admin|office|help|careers|jobs|marketing)@/i;

export const isInternal = (e) => INTERNAL.test(String(e || ''));
export const isRole = (e) => ROLE.test(String(e || ''));
export const skipForPersonalReply = (e) => isInternal(e) || isRole(e);
