#!/usr/bin/env node
// scripts/ops/board-top.mjs — C1030: THE TOP OF THE BOARD IS PRE-DECIDED, NOT RAW. Builds on C1027 (the plain head) and C1028 (the
// one priority, board-priority.mjs specPriority) and duplicates neither.
//
// A row reaches the TOP tab only when it is DECISION-READY: a head (two options side by side, or the one value when there is no
// fork — C1030.1), a recommendation, an evidence link that resolves (a commit this repo holds, or a file this repo holds — never
// prose that only names a row id), an owner, and no number or row id in its head/context/recommendation that its own `ask` text
// does not carry (C1027's inventions(), reused — one rule, one place, never a second check). A row missing any of these never
// surfaces: it is sent back to the room that owns it (bifurcate, never a branch — CLAUDE.md DELEGATION NEVER GIT-BRANCHES) to find
// the gap and state it on the record; it rises once that lands.
//
// The decisions are read from data/vna/board-decisions.json (C1020e, hand-maintained — the source; this module never writes it)
// or a spec row's own text. Nothing here invents an option, a recommendation or a release.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventions } from './plain-heads.mjs';
import { specPriority, loadContext } from './board-priority.mjs';
import { bifurcate } from './board-comments.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DECISIONS = 'data/vna/board-decisions.json';
export const CAP = 10;   // THE ANTI-CLERK RULE: the board never hands him more than one screen's worth of decisions.

const MAXBUF = 32 * 1024 * 1024;   // git ls-files on this repo runs ~1MB — the node default (1MB) throws ENOBUFS and reads as "no files"
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', maxBuffer: MAXBUF }); return r.status === 0 ? (r.stdout || '') : ''; };
let filesCache = null;
const repoFiles = () => (filesCache ??= sh('git', ['ls-files']).split('\n').filter(Boolean));
const commitExists = (sha) => spawnSync('git', ['rev-parse', '--quiet', '--verify', `${sha}^{commit}`], { cwd: REPO, maxBuffer: MAXBUF }).status === 0;

// An A/B fork read off the decision's own head text, never invented: "(A) ... · (B) ...". A head with no fork is ONE VALUE — still
// decision-ready, carried as a single option so the ANSWER cell still names what it accepts.
export function optionsOf(head) {
  const m = String(head || '').match(/\(A\)\s*(.+?)\s*·\s*\(B\)\s*(.+)$/);
  if (m) return [{ label: 'A', text: m[1].trim() }, { label: 'B', text: m[2].trim() }];
  return head ? [{ label: '', text: String(head).trim() }] : [];
}

// An evidence link resolves when it names a commit git holds, or a file git tracks — never when it only names a row id or says
// "its own text". UNRESOLVED carries why, so a sent-back row says what evidence its room still owes.
export function evidenceResolves(src) {
  const s = String(src || '').trim();
  if (!s) return { ok: false, why: 'no evidence link on the record' };
  for (const sha of s.match(/\b[0-9a-f]{7,40}\b/g) || []) if (commitExists(sha)) return { ok: true, path: sha };
  for (const m of s.match(/[\w./-]+\.(?:md|json|mjs|txt|html)\b/g) || []) {
    if (existsSync(resolve(REPO, m))) return { ok: true, path: m };
    const hit = repoFiles().find((f) => f === m || f.endsWith(`/${m}`));
    if (hit) return { ok: true, path: hit };
  }
  return { ok: false, why: `evidence link does not resolve to a commit or a file git holds: ${s}` };
}

// C1030a: the recommendation names the option AND why it was picked — a bare label ("B") carries no reason, so a row
// stops there and reads it off the decision's own `guess`, never adds one: "<option> — <one-line reason>".
export function reasonOf(guess) {
  const m = String(guess || '').match(/\s[—-]\s+(.+)$/);
  return m ? m[1].trim() : '';
}

// C1030.1: decision-ready, read off the decision alone — nothing here calls an LLM.
export function decisionReady(d) {
  const missing = [];
  const options = optionsOf(d.head);
  if (!options.length) missing.push('no options or value on the record (head)');
  if (!d.guess) missing.push('no recommendation on the record (guess)');
  else if (!reasonOf(d.guess)) missing.push('recommendation has no one-line reason — write it as "<option> — <reason>"');
  const evidence = evidenceResolves(d.guess_source);
  if (!evidence.ok) missing.push(evidence.why);
  if (!d.owner) missing.push('no owner on the record');
  if (!d.context) missing.push('no release named on the record (context)');
  const invented = inventions({ head: d.head, context: d.context, guess: d.guess }, d.ask || '');
  if (invented.length) missing.push(`facts not in its own ask: ${invented.join(', ')}`);
  return { ready: missing.length === 0, missing, options, evidence };
}

// C1030.2: not decision-ready — sent back to the room that owns it, never surfaced. Never a bare TODO: the missing pieces are named.
export function sentBack(d, check) {
  return { id: d.id, owner: d.owner || null, missing: check.missing };
}

// C1030.3: he never fills OWNER or PROJECT. The owning room (already on the record, data/vna/board-decisions.json) IS the project
// when the row names no separate one — assigned off the record, never invented, never left blank.
export function topRows({ decisions, ctx = loadContext() } = {}) {
  const ready = []; const sent = [];
  for (const d of decisions) {
    const check = decisionReady(d);
    if (check.ready) ready.push({ d, check, priority: specPriority({ ID: d.id, CLASS: d.class }, ctx) });
    else sent.push(sentBack(d, check));
  }
  ready.sort((a, b) => b.priority.p - a.priority.p || b.priority.tie - a.priority.tie);
  const over = Math.max(0, ready.length - CAP);
  const top = ready.slice(0, CAP).map(({ d, check, priority }) => ({
    id: d.id, class: d.class, owner: d.owner, project: d.project || d.owner,
    options: check.options, recommendation: d.guess, evidence: check.evidence.path, releases: d.context,
    priority: priority.p, why: priority.why, answer: '',
  }));
  return { top, sentBack: sent, over };
}

// The row's own cells, in the order the TOP tab prints them (ANSWER is the only (fill) column — CLAUDE.md anti-clerk).
export const HEAD = ['ID', 'CLASS', 'OWNER', 'PROJECT', 'OPTIONS (A vs B, or the one value)', 'RECOMMENDATION', 'EVIDENCE', 'WHAT ANSWERING RELEASES', 'PRIORITY 0–9', 'ANSWER (fill)'];
export const rowCells = (r) => [r.id, r.class, r.owner, r.project, r.options.map((o) => (o.label ? `(${o.label}) ${o.text}` : o.text)).join(' · '), r.recommendation, r.evidence, r.releases, r.priority, ''];

// C1030.2's dispatch: bifurcate (never a branch) asks the owning room to find the missing pieces named above.
export function sendBackToRooms(sent, { fire = bifurcate } = {}) {
  return sent.filter((s) => s.owner).map((s) => fire({ room: s.owner, action: `find the gap on ${s.id} so it can reach the board's TOP tab`, context: s.missing.join('; ') }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const df = resolve(REPO, DECISIONS);
  const decisions = existsSync(df) ? (JSON.parse(readFileSync(df, 'utf8')).decisions || []).filter((d) => !d.done && d.class !== 'ROOM-WORK') : [];
  const { top, sentBack: sent, over } = topRows({ decisions });
  if (process.argv[2] === 'send-back') {
    const fired = sendBackToRooms(sent);
    console.log(`sent ${fired.length} row(s) back to their room; ${sent.length - fired.length} have no owner on the record`);
  } else {
    console.log(`TOP: ${top.length} decision-ready row(s)${over ? ` (${over} more ready, past the cap of ${CAP})` : ''} · ${sent.length} sent back`);
    for (const r of top) console.log(`  ${r.id} (${r.priority}) ${r.owner} — ${r.recommendation}`);
    for (const s of sent) console.log(`  ${s.id} sent back to ${s.owner || 'UNCLEAR'}: ${s.missing.join('; ')}`);
  }
}
