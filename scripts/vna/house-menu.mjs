#!/usr/bin/env node
// scripts/vna/house-menu.mjs — C314 THE CHAT KNOWS THE HOUSE: a DERIVED menu of every skill and every
// door, never a hand-typed list. (operator 2026-09-25, verbatim: "make steer chat able to run all sh
// scripts to schedule calander events, sync sqlite, check site stats and open txt files with it, etc …
// it should be low hanginf fruit to run skills yes? … find the most useful way to use the chat - maybe
// not running code, but if it gets context with a menu of all available skills inherited ..")
//
// TWO KINDS OF ENTRY, ONE SHAPE:
//   SKILL  — derived from .claude/skills/*/SKILL.md frontmatter (name, description; triggers mined out
//            of the description's own quoted phrases, "Triggers: '...', '...'" when present, else any
//            quoted phrase in the description, else the skill's own name). A skill's body is instructions
//            FOR CLAUDE, not one runnable command — a 2B chat model cannot execute it, so every skill is
//            class OUTWARD: the chat hands back `/<skill>` for the OPERATOR to run in Claude Code. Never
//            pretend otherwise.
//   DOOR   — a small declared table, below. A READ door is a command that only reads/reports (it may
//            chain a sync ahead of a render with `&&`, e.g. the iamfim flow) and is safe for the HOST
//            itself to run and stream; the printed summary + its `opens` paths are the answer. An OUTWARD
//            door touches the world outside this machine (a calendar invite, a send) — the chat prints
//            the exact command and runs nothing.
//
// EVERY READ DOOR RESOLVES against the running code, never trusted by name: `resolvesAll` splits the
// command on `&&` and passes EACH `node scripts/…mjs` segment through steergoal.mjs's own commandResolves
// (never re-derived) — the script exists and every flag/subcommand it names is a literal in that script's
// code. A command that does not resolve is a menu entry that would emit a lie; the guard drops it.
//
//   node scripts/vna/house-menu.mjs [--json | --text | --route "<chat line>"]   (--route: C320, the pre-model route as JSON)
//
// @guard tests/vna/c314-the-chat-knows-the-house.test.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandResolves } from './steergoal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE_ROOT = resolve(HERE, '..', '..');
export const REPO = process.env.VNA_REPO || CODE_ROOT;
export const SKILLS_DIR = process.env.VNA_SKILLS_DIR || resolve(REPO, '.claude/skills');

// ── the declared doors — the house's own single commands, never a shell alias the model invents ──────
// READ doors run on the host and stream their own printed summary into the chat box; a `&&`-chained one
// is still ONE unit (sync, then render) because the render alone would read stale rows the operator never
// asked for. OUTWARD doors leave the machine (a calendar write, a send) and are NEVER run by the host —
// the chat prints the command/slash and stops there, exactly like a skill hand-back.
export const DOORS = Object.freeze([
  {
    id: 'iamfim-stats',
    kind: 'door',
    name: 'iamfim visit stats',
    description: 'Sync iamfim.com rows into the local mirror, render the visits-per-hour chart + the human ladder and the token×device split, then open both.',
    triggers: ['iamfim stats', 'iamfim.com traffic', 'site stats', 'visits per hour', 'who is visiting', 'iamfim split', 'token vs no token', 'iamfim', '/iamfim', 'how many visitors', 'iamfim visitors', 'iamfim visits', 'visitors on iamfim'],
    command: 'node scripts/central/mirror-sync.mjs --table iamfim && node scripts/track/iamfim-visits.mjs --no-open && node scripts/track/iamfim-split.mjs --no-open',
    class: 'READ',
    opens: ['.thetacog/iamfim-visits.html', '.thetacog/iamfim-split.html'],
    // C320 — "the last 6 hours" in the ask becomes `--since 6h` on THIS segment (iamfim-visits.mjs's own flag), which
    // writes the window html instead of the full one; applied per ask by routeChat, never written back into this table
    window: { script: 'scripts/track/iamfim-visits.mjs', opens: ['.thetacog/iamfim-visits-window.html', '.thetacog/iamfim-split.html'] },
  },
  {
    id: 'opt-targets',
    kind: 'door',
    name: 'optimisation targets',
    description: 'Every optimisation target the ratchet census found, plus hook latency per hook with unicode sparklines — printed inside the chat, nothing opened.',
    triggers: ['optimisation targets', 'optimization targets', 'hook latency', 'what is slowing us down', 'targets'],
    command: 'node scripts/vna/hook-latency.mjs --ratchet && node scripts/vna/opt-targets.mjs',
    class: 'READ',
    opens: [],
  },
  {
    id: 'inbox-verdict',
    kind: 'door',
    name: 'inbox sync verdict',
    description: 'One table: whether each inbound channel (WhatsApp, iMessage, Gmail sent+inbox, Gemini web) can see to now, and who wrote in.',
    triggers: ['did anyone write', 'who wrote in', 'check the inboxes', 'inbox verdict', 'is the sync working', 'check all channels', 'did they email us'],
    command: 'node scripts/chat/sync-verdict.mjs --who',
    class: 'READ',
    opens: [],
  },
  {
    id: 'mirror-status',
    kind: 'door',
    name: 'central mirror status',
    description: 'What the local SQLite mirror holds and how stale each table is, read-only.',
    triggers: ['mirror status', 'sqlite status', 'central mirror', 'how stale is the mirror', 'sync sqlite'],
    command: 'node scripts/central/mirror-sync.mjs --status',
    class: 'READ',
    opens: [],
  },
  {
    id: 'gcal-open',
    kind: 'door',
    name: 'open / schedule on Google Calendar',
    description: 'Opens calendar.google.com (or pulls today+7d events with a token). Scheduling touches another person\'s calendar — OUTWARD, handed back.',
    triggers: ['schedule a call', 'schedule a meeting', 'book a call', 'add to calendar', 'calendar invite', 'book a time', 'next week', 'set up a call'],
    command: 'bash scripts/gcal-open.sh',
    class: 'OUTWARD',
    opens: [],
  },
  {
    id: 'gcal-sync',
    kind: 'door',
    name: 'sync Google Calendar',
    description: 'Pulls the calendar into the day layout used to plan the day.',
    triggers: ['sync calendar', 'gcal sync', 'pull my calendar', 'sync my calendar'],
    command: 'bash scripts/gcal-agent/gcal-sync.sh',
    class: 'OUTWARD',
    opens: [],
  },
  {
    id: 'send',
    kind: 'door',
    name: 'send a message or email',
    description: 'Any outbound send (a reply, a newsletter, outreach) leaves the machine — OUTWARD. Compose with /reply, /club, /wave, /bump or /chan; the operator arms the send.',
    triggers: ['send an email', 'send it', 'reply to', 'follow up with', 'draft a reply', 'send the newsletter', 'email them'],
    command: '/reply, /club, /wave, /bump or /chan — compose there, the operator sends',
    class: 'OUTWARD',
    opens: [],
  },
]);

// ── the steer.mjs verbs, as menu entries (2026-09-25 addendum: "the steer.mjs verbs are part of the
// menu as READ/PAID entries" — a model or the operator can fire one with `door steer-<verb>` exactly
// like any other READ door; `run`/`until` carry `paid: true` and print their own plan + spend ceiling
// FIRST, because that is steer.mjs's own stdout on those two verbs, not something this door adds). id
// uses a hyphen (steer-status, not steer:status) because a fenced `door <id>` line only accepts \w and -.
export const STEER_VERB_NAMES = Object.freeze(['status', 'next', 'run', 'until', 'asks', 'close', 'plan', 'loop']);
export const STEER_PAID_VERBS = new Set(['run', 'until']);
const STEER_EXTRA_TRIGGERS = { status: ['where are we', 'goal status', 'what is the runner doing'], next: ['what is next'] };
export const STEER_DOORS = Object.freeze(STEER_VERB_NAMES.map((v) => ({
  id: `steer-${v}`,
  kind: 'door',
  name: `/steer ${v}`,
  description: STEER_PAID_VERBS.has(v)
    ? `PAID — steer.mjs ${v} prints its plan and spend ceiling before it dispatches anything.`
    : `steer.mjs ${v} — host-run, streamed, $0.`,
  triggers: [`/steer ${v}`, `steer ${v}`, ...(STEER_EXTRA_TRIGGERS[v] || [])],
  command: `node scripts/vna/steer.mjs ${v}`,
  class: 'READ',
  opens: [],
  ...(STEER_PAID_VERBS.has(v) ? { paid: true } : {}),
})));

// ── frontmatter — a plain key: value scanner, not a YAML library: every SKILL.md frontmatter observed
// (64/64) is flat key: value lines, some with a multi-field block (github-*), none with block scalars.
// A continuation line (indented, no `key:`) is appended to the last key seen, so a wrapped value survives.
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(String(raw || ''));
  if (!m) return null;
  const fields = {}; let cur = null;
  for (const line of m[1].split(/\r?\n/)) {
    const km = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (km) { cur = km[1]; fields[cur] = km[2]; continue; }
    if (cur && /^\s+\S/.test(line)) { fields[cur] += ` ${line.trim()}`; }
  }
  for (const k of Object.keys(fields)) {
    let v = fields[k].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fields[k] = v;
  }
  return fields;
}
export { parseFrontmatter };

/** the quoted phrases a description names as triggers — after a "Triggers" marker when one exists (every
 *  explicit list observed, both "Triggers:" and "Triggers -"), else any quoted phrase in the description
 *  (several skills, e.g. panel, name their trigger phrases inline with no marker at all), else none. */
export function extractTriggers(description) {
  const d = String(description || '');
  const tm = /triggers?\s*[-:]\s*([\s\S]*)$/i.exec(d);
  const scope = tm ? tm[1] : d;
  const out = []; const re = /'([^']+)'|"([^"]+)"/g; let mm;
  while ((mm = re.exec(scope))) { const t = (mm[1] != null ? mm[1] : mm[2]).trim(); if (t) out.push(t); }
  return out;
}

/** the skill dirs on disk that carry a SKILL.md — this IS the count the guard diffs the menu against */
export function listSkillDirs(dir = SKILLS_DIR) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => existsSync(join(dir, n, 'SKILL.md'))); } catch { names = []; }
  return names.sort();
}

/** every skill, as a menu entry — always class OUTWARD (HANDBACK): the host never pretends a chat model can run one */
export function skillEntries(dir = SKILLS_DIR) {
  return listSkillDirs(dir).map((n) => {
    const p = join(dir, n, 'SKILL.md');
    let fm = null;
    try { fm = parseFrontmatter(readFileSync(p, 'utf8')); } catch { fm = null; }
    const name = (fm && fm.name) || n;
    const description = (fm && fm.description) || '';
    const triggers = extractTriggers(description);
    return {
      id: `skill:${n}`,
      kind: 'skill',
      name,
      description: description.slice(0, 400),
      triggers: triggers.length ? triggers : [`/${n}`, n],
      command: `/${n}`,
      class: 'OUTWARD',
      opens: [],
    };
  });
}

/** a command resolves when EVERY `&&`-joined `node scripts/…mjs` segment passes steergoal.mjs's own
 *  commandResolves — never re-derived, so a menu entry cannot claim a flag that script does not parse */
export function resolvesAll(cmd, opts = {}) {
  const segments = String(cmd || '').split('&&').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return { ok: false, why: 'empty command' };
  for (const seg of segments) {
    const r = commandResolves(seg, opts);
    if (!r.ok) return r;
  }
  return { ok: true, why: null };
}

/** the whole derived menu: the declared doors, the steer.mjs verbs, then every skill on disk */
export function houseMenu({ skillsDir = SKILLS_DIR, repo = REPO } = {}) {
  void repo;
  return [...DOORS, ...STEER_DOORS, ...skillEntries(skillsDir)];
}

/** the chat-context line for one entry — id · class · one short line, so 71 entries stay a few KB, not a dump */
export function menuLine(entry, descChars = 34) {
  const desc = String(entry.description || '').split('\n')[0].slice(0, descChars);
  return ` · ${entry.id} [${entry.class}] ${desc}`;
}

export const MENU_BLOCK_CHARS_MAX = 4000;   // this block shares the turn's 9000-char cap with the leaf contract, the
// snowball and the open rows — it is enrichment, not the record, so it is capped well under half the budget and
// truncated on its OWN end (never the leaf/contract/status content composeContext already relies on)

/** the compact block chat-context.mjs folds into the turn's system line — doors first (fewer, decidable, the ones
 *  worth a model naming), skills last (a long flat list — a hand-back either way, so a cut there loses least) */
export function menuContextBlock(menu = houseMenu()) {
  const doors = menu.filter((e) => e.kind === 'door');
  const skills = menu.filter((e) => e.kind === 'skill');
  const head = [
    `HOUSE MENU (${menu.length}: ${doors.length} doors, ${skills.length} skills) — to ACT, reply with exactly one fenced line \`door <id>\`.`,
    'A READ door is run by the HOST and its printed summary + opened file(s) become the answer. An OUTWARD door or a skill is handed back to the operator as the exact command/slash — never run here. An id not on this list is refused.',
    ...doors.map((e) => menuLine(e, 60)),
  ];
  const text = [...head, ...skills.map((e) => menuLine(e, 24))].join('\n');
  return text.length > MENU_BLOCK_CHARS_MAX ? `${text.slice(0, MENU_BLOCK_CHARS_MAX)}\n[menu cut at its own cap — house-menu.mjs --json has the rest]` : text;
}

// ── deterministic routing — keyword/trigger substring match, NO MODEL ──────────────────────────────
/** the ask a chat line names, or null — the longest matching trigger phrase wins (most specific first) */
export function routeAsk(text, menu = houseMenu()) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  let best = null; let bestLen = 0;
  for (const entry of menu) {
    for (const trig of entry.triggers || []) {
      const tt = String(trig || '').toLowerCase().trim();
      if (!tt || !t.includes(tt)) continue;
      if (tt.length > bestLen) { bestLen = tt.length; best = entry; }
    }
  }
  return best;
}

// ── the model's own door line: a fenced block whose one line is `door <id>` ────────────────────────
const DOOR_FENCE_RE = /```[a-z]*\s*\n([\s\S]*?)\n?```/gi;
/** the raw `door <id>` a model reply names, or null when it named none */
export function modelDoorLineOf(reply) {
  const text = String(reply || ''); let m; DOOR_FENCE_RE.lastIndex = 0;
  while ((m = DOOR_FENCE_RE.exec(text))) {
    const body = m[1].trim(); if (!body || /\n/.test(body)) continue;
    const dm = /^door\s+([a-z0-9][\w-]*)$/i.exec(body.replace(/^\$\s*/, ''));
    if (dm) return { id: dm[1].toLowerCase(), line: `door ${dm[1].toLowerCase()}` };
  }
  return null;
}
/** resolve a model's `door <id>` line against the menu — { acted:false } when it named none, else a
 *  refusal (id not on the menu) or the matched entry. The host runs the entry ONLY when this returns
 *  ok:true and entry.class === 'READ' — an OUTWARD entry or a skill is a hand-back even when named. */
export function modelDoorOf(reply, menu = houseMenu()) {
  const line = modelDoorLineOf(reply);
  if (!line) return { acted: false };
  const entry = menu.find((e) => e.id === line.id);
  if (!entry) return { acted: true, ok: false, id: line.id, entry: null, why: `no menu entry '${line.id}' — refused` };
  return { acted: true, ok: true, id: line.id, entry };
}

// ── C314 addendum (2026-09-25) — "what can you do" MUST answer without a model call. Measured live: gemma2:2b,
// asked "show me a list of your skills / reports you can do" and "can you run sh / skills", answered "I'm a text
// model, no tools" both times — the 8 steer verbs were already IN its context (chat-context.mjs) and it still
// ignored them. A 2B model does not reliably use context it was not asked to restate verbatim, so a capability
// ask is intercepted BEFORE the model ever sees it (the same C298 house rule as `help` and a tool-shaped ask) and
// answered from the derived menu — zero model calls, guaranteed correct because it is not a claim, it is a print.
//
// MENU_ASK_RE is anchored start-to-end (never a bare .includes) precisely so "the menu bar is broken" does not
// fire: that sentence does not EQUAL any of the phrase templates below, it merely contains the token "menu" —
// exactly the token-vs-construct trap CLAUDE.md names. Every alternative here is a full-sentence shape, not a word.
const MENU_WORD = '(?:menu|skills|reports|commands)';
export const MENU_ASK_RE = new RegExp(
  '^(?:' + [
    '/menu',
    MENU_WORD,                                                                          // bare: "menu" · "skills" · "reports" · "commands"
    'what can you (?:do|run)',                                                          // "what can you do"
    `what ${MENU_WORD} can you (?:do|run)`,                                             // "what skills can you run"
    `list (?:your |the )?(?:/\\s*)?${MENU_WORD}(?:\\s*/\\s*${MENU_WORD})?(?:\\s+you can (?:do|run|use))?`,   // C320: "list the / commands you can use, …"                        // "list your skills"
    `(?:show|give) me (?:a |the )?list of (?:your |the )?${MENU_WORD}(?:\\s*/\\s*${MENU_WORD})?(?:\\s+you can (?:do|run))?`, // operator's own phrasing
    `can you run [a-z /]*${MENU_WORD}`,                                                 // "can you run sh / skills"
  ].join('|') + ')(?:[.?!]*$|\\s*[,;])', 'i',   // C320: a capability ask may run on past a comma ("list the / commands you can use, can you …")
);
/** true only for a full-sentence capability ask (a construct), never a sentence that merely CONTAINS the word "menu" */
export function isMenuAsk(text) { return MENU_ASK_RE.test(String(text || '').trim()); }

/** the on-demand, host-printed answer to a menu ask — READ doors first (runnable: reply/type `door <id>`), then
 *  OUTWARD (doors + skills, handed back as the exact command/slash), then the steer verbs as their own group
 *  (run/until marked PAID). No model is involved in building this string. */
export function formatMenuText(menu = houseMenu()) {
  const isSteer = (e) => e.id.startsWith('steer-');
  const read = menu.filter((e) => e.class === 'READ' && !isSteer(e));
  // doors only — skills are OUTWARD too, and counting them here printed "67 doors" and listed every skill twice
  const outward = menu.filter((e) => e.class === 'OUTWARD' && e.kind === 'door');
  const steer = menu.filter(isSteer);
  const line = (e) => ` · ${e.id} — ${e.description}`;
  return [
    `HOUSE MENU — ${menu.length} entries, derived from .claude/skills/*/SKILL.md + the house's own doors (never hand-typed).`,
    '',
    `READ (${read.length} — runnable here: reply with a fenced \`door <id>\` line, or type \`door <id>\` yourself):`,
    ...read.map(line),
    '',
    `OUTWARD (${outward.length} doors + ${menu.filter((e) => e.kind === 'skill').length} skills — never run here; the exact command/slash prints, the operator runs it):`,
    ...outward.map((e) => ` · ${e.id} — ${e.command}`),
    ...menu.filter((e) => e.kind === 'skill').map((e) => ` · ${e.command} — ${e.description.slice(0, 90)}`),
    '',
    `STEER VERBS (${steer.length} — host-run, streamed; run/until are PAID and print their plan + spend ceiling first):`,
    ...steer.map((e) => ` · /steer ${e.id.replace(/^steer-/, '')}${e.paid ? ' (PAID)' : ''}`),
  ].join('\n');
}

// ── C320 THE HOST ROUTES BEFORE THE MODEL — one function, asked by both chat surfaces before any model call ─────
// Measured live 2026-09-25: routeAsk existed and no chat surface called it, so "how many visitors … on iamfim.com" went
// to gemma2:2b, which said it cannot run commands. routeChat is the whole pre-model route, and it is deliberately
// NARROWER than routeAsk, because a door that fires on a mere mention is worse than no door (false positives are the
// failure mode of this fix):
//   1. a full-sentence capability ask → the menu
//   2. a typed `/<name>` → the door whose triggers name `/<name>`, or the skill whose slash it is (the host's own
//      slashes — /steer /workers /end /probe /clear /menu /help — are never taken)
//   3. a MULTI-WORD trigger of a READ door (never a single word: "iamfim" alone is a mention; never an OUTWARD door by
//      trigger: "reply to" / "next week" are ordinary English) → that door, with any "last N hours" applied as its window
// Anything else is null: the model gets it.
const HOST_SLASH = new Set(['steer', 'workers', 'end', 'probe', 'clear', 'menu', 'help']);
const WINDOW_RE = /\b(?:last|past)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i;
/** the ask's own time window as iamfim-visits' --since value ("6h"), or null */
export function windowOf(text) {
  const m = WINDOW_RE.exec(String(text || '')); if (!m) return null;
  const u = m[2].toLowerCase(); return `${m[1]}${u.startsWith('m') ? 'm' : u.startsWith('d') ? 'd' : 'h'}`;
}
/** a copy of the entry with the ask's window applied on its declared segment — the table itself is never edited */
export function withWindow(entry, text) {
  const w = entry && entry.window; const since = windowOf(text);
  if (!w || !since || !entry.command.includes(w.script)) return entry;
  return { ...entry, command: entry.command.replace(w.script, `${w.script} --since ${since}`), opens: [...w.opens] };
}
/** { kind:'menu' } | { kind:'door', entry } | null — null means the model answers */
export function routeChat(text, menu = houseMenu()) {
  const t = String(text || '').trim(); if (!t) return null;
  if (isMenuAsk(t)) return { kind: 'menu' };
  const sm = /^\/([a-z0-9][\w-]*)\b/i.exec(t);
  if (sm) {
    const name = sm[1].toLowerCase(); if (HOST_SLASH.has(name)) return null;
    const entry = menu.find((e) => e.kind === 'door' && (e.triggers || []).some((tr) => String(tr).toLowerCase() === `/${name}`))
      || menu.find((e) => e.kind === 'skill' && e.command === `/${name}`)
      || menu.find((e) => e.id === name);
    return entry ? { kind: 'door', entry: withWindow(entry, t) } : null;
  }
  const lower = t.toLowerCase(); let best = null; let bestLen = 0;
  for (const e of menu) {
    if (e.kind !== 'door' || e.class !== 'READ' || e.id.startsWith('steer-')) continue;
    for (const trig of e.triggers || []) {
      const tt = String(trig || '').toLowerCase().trim();
      if (!/\s/.test(tt) || tt.startsWith('/') || !lower.includes(tt)) continue;
      if (tt.length > bestLen) { bestLen = tt.length; best = e; }
    }
  }
  return best ? { kind: 'door', entry: withWindow(best, t) } : null;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const menu = houseMenu();
  const ri = process.argv.indexOf('--route');
  if (ri >= 0) {
    process.stdout.write(JSON.stringify(routeChat(process.argv[ri + 1] || '', menu)) + '\n');
  } else if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(menu, null, 2) + '\n');
  } else if (process.argv.includes('--text')) {
    process.stdout.write(`${formatMenuText(menu)}\n`);
  } else {
    const doors = menu.filter((e) => e.kind === 'door');
    const skills = menu.filter((e) => e.kind === 'skill');
    process.stdout.write(`${menu.length} entries — ${doors.length} doors, ${skills.length} skills\n`);
    for (const e of menu) process.stdout.write(`${e.class.padEnd(7)} ${e.kind.padEnd(5)} ${e.id.padEnd(28)} ${e.name}\n`);
  }
}
