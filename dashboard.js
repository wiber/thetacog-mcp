#!/usr/bin/env node
/**
 * thetacog dashboard — local web UI for rules management.
 *
 * Shadow Agent architecture (May 4):
 * - SQLite at .thetacog/rules.db is the source of truth
 * - Web UI edits SQLite
 * - Manual-run buttons spawn the relevant scripts in background
 * - Copy-prompt buttons emit pre-formatted prompts for Claude Code
 *   so the user can paste into a CC session and have cc work on rules
 * - Hooks (.sh) read from SQLite (Phase 3 — for now they read from
 *   the JSON file regenerated from SQLite via `thetacog regen-hooks`)
 *
 * Singleton: a lockfile at .thetacog/dashboard.pid prevents two
 * instances from running. `thetacog dashboard --kill` stops it.
 *
 * Port: 3737 by default; override via THETACOG_DASHBOARD_PORT.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const PORT = parseInt(process.env.THETACOG_DASHBOARD_PORT || '3737', 10);
const CWD = process.cwd();
const THETACOG_DIR = path.join(CWD, '.thetacog');
const DB_PATH = path.join(THETACOG_DIR, 'rules.db');
const PID_PATH = path.join(THETACOG_DIR, 'dashboard.pid');
const HOOKS_JSON_PATH = path.join(THETACOG_DIR, 'hooks-config.json');

// ──────────────────────────────────────────────────────────────────
// Singleton: only one dashboard process per repo
// ──────────────────────────────────────────────────────────────────

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

if (process.argv.includes('--kill')) {
  if (fs.existsSync(PID_PATH)) {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10);
    if (isPidAlive(pid)) { try { process.kill(pid); } catch {} }
    fs.unlinkSync(PID_PATH);
    console.log(`✓ Dashboard PID ${pid} stopped.`);
  } else {
    console.log('No dashboard running.');
  }
  process.exit(0);
}

if (process.argv.includes('--status')) {
  if (fs.existsSync(PID_PATH)) {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10);
    if (isPidAlive(pid)) {
      console.log(`✓ Dashboard running. PID=${pid}, URL=http://localhost:${PORT}`);
      process.exit(0);
    } else {
      fs.unlinkSync(PID_PATH);
    }
  }
  console.log('No dashboard running.');
  process.exit(1);
}

fs.mkdirSync(THETACOG_DIR, { recursive: true });

if (fs.existsSync(PID_PATH)) {
  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10);
  if (isPidAlive(pid)) {
    console.log(`✗ Dashboard already running (PID ${pid}). Open http://localhost:${PORT}`);
    console.log(`  Stop it with: thetacog dashboard --kill`);
    process.exit(1);
  }
  fs.unlinkSync(PID_PATH);
}

fs.writeFileSync(PID_PATH, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(PID_PATH); } catch {} });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ──────────────────────────────────────────────────────────────────
// SQLite schema + seed
// ──────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS voice_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    pattern     TEXT NOT NULL,
    level       TEXT NOT NULL CHECK(level IN ('ERROR','WARNING','INFO')),
    description TEXT,
    scope       TEXT NOT NULL DEFAULT 'voice',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key             TEXT NOT NULL UNIQUE,           -- e.g. 'C1.Builder'
    shortlex        TEXT NOT NULL UNIQUE,           -- e.g. 'C1' (sort key)
    label           TEXT NOT NULL,                  -- e.g. 'Builder'
    emoji           TEXT,
    terminal        TEXT,                            -- e.g. 'iTerm2'
    pull_statement  TEXT,                            -- "THE PULL" from README
    primary_scope   TEXT,                            -- legacy mapping: voice/structural/business-comms
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rule_room_relevance (
    rule_id     INTEGER NOT NULL,
    room_id     INTEGER NOT NULL,
    relevance   INTEGER NOT NULL,    -- 0-100; 0 = irrelevant
    rationale   TEXT,                 -- LLM's reasoning OR user note
    scored_at   TEXT NOT NULL DEFAULT (datetime('now')),
    scored_by   TEXT NOT NULL DEFAULT 'seed',  -- 'llm-orthogonalize' | 'user-manual' | 'seed'
    PRIMARY KEY (rule_id, room_id),
    FOREIGN KEY (rule_id) REFERENCES voice_rules(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_rrr_room ON rule_room_relevance (room_id, relevance DESC);

  -- Migration: add scope column if missing on existing dbs
  -- (sqlite ALTER TABLE ADD COLUMN ignores IF NOT EXISTS pre-3.35; wrap in try)

  CREATE TABLE IF NOT EXISTS hook_config (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hook_name   TEXT NOT NULL UNIQUE,
    enabled     INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    body        TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Try to add scope column if upgrading from older schema
try { db.exec(`ALTER TABLE voice_rules ADD COLUMN scope TEXT NOT NULL DEFAULT 'voice'`); } catch {}

const ruleCount = db.prepare('SELECT COUNT(*) as n FROM voice_rules').get();
if (ruleCount.n === 0) {
  const ins = db.prepare('INSERT INTO voice_rules (name, pattern, level, description, scope) VALUES (?, ?, ?, ?, ?)');
  // scope=voice — paradox-voice rules (default room: terminal-voice)
  ins.run('paradox-no-tell-feelings', '\\b(did you feel|do you feel|you may feel|if you felt|if you recognized)\\b', 'ERROR',
    'Paradox tells stories that MOVE you; the reader names the feeling silently. Never instruct internal state.', 'voice');
  ins.run('no-meta-announcements', '\\b(in this section|in this post|next section|next paragraph|the post you have just read)\\b', 'WARNING',
    'No meta-commentary about the prose itself. Show, do not announce.', 'voice');
  ins.run('voice-technique-name-leak', '\\b(paradox voice|holden voice|judo flip|reporting posture)\\b', 'WARNING',
    'Technique names stay in docs/memory, not published prose.', 'voice');
  // scope=structural — 6needs + canonical definitions (default room: iterm2-builder)
  ins.run('structural-six-needs-required', '<pseudo>blog-section-headers-must-match-canonical-six-needs</pseudo>', 'INFO',
    'Blog posts use Connection → Contribution → Growth → Uncertainty → Certainty → Significance as named A-F sections. Argument lives in Uncertainty.', 'structural');
  ins.run('structural-canonical-tile-form', '\\bA:Law|\\bB:Speed|\\bC:Grid|\\bA:Goal|\\bA:Fund|\\bB:Deal|\\bB:Signal|\\bC:Loop|\\bC:Flow', 'WARNING',
    'Tile identity must render as {emoji} {rank}.{FullName}, never raw shorthand like A:Law.', 'structural');
  ins.run('six-needs-monotonic-order', '<lexical:scripts/voice-six-needs-order-check.sh>', 'ERROR',
    'All chapter / blog / LinkedIn writing must hit the Six Human Needs in canonical order at first appearance: Connection → Contribution → Growth → Uncertainty → Certainty → Significance. Cycling back later is fine; first establishment must be in order. How expressed: (1) Connection — second-person address establishing shared situation BEFORE argument runs ("You have heard the sentence"). (2) Contribution — explicit naming of the portable artifact handed over ("Here is what this post hands you"). (3) Growth — the transformation arc ("the reader who carries this becomes..."). (4) Uncertainty — the twist/slip/complication that makes the cure load-bearing. (5) Certainty — the declarative that resolves it ("Determinism is not an alibi"). (6) Significance — wider stakes + reader-as-hero close ("Wake up"). Pre-commit lexical check on H2 headers; post-commit LLM check for narrative flow when no explicit labels exist.', 'structural');
  // scope=business-comms — LinkedIn posts, replies, business communications (default room: kitty-operator)
  ins.run('business-comms-name-at-start', '^@[A-Za-z]', 'WARNING',
    'LinkedIn replies prepopulate @name. Drafts must start with the first substantive sentence, not "Name —".', 'business-comms');
  ins.run('business-comms-puffery', '\\b(revolutionary|game-changing|paradigm shift|cutting-edge)\\b', 'INFO',
    'Puffery without substance. Acceptable as load-bearing move with substance underneath; flag for review.', 'business-comms');
}

const hookCount = db.prepare('SELECT COUNT(*) as n FROM hook_config').get();
if (hookCount.n === 0) {
  const ins = db.prepare('INSERT INTO hook_config (hook_name, enabled, description) VALUES (?, ?, ?)');
  ins.run('pre-commit-lexical', 1, 'Lexical voice-filter against SQLite voice_rules. Fast.');
  ins.run('post-commit-llm-audit', 1, 'Heavy LLM voice audit, async. Spawns voice-audit-llm.sh.');
  ins.run('post-commit-anchor-check', 1, 'Heavy LLM engagement-anchor scorer, async. Blog drafts only.');
  ins.run('pre-push-lexical', 1, 'Pre-push lexical only — book HTML rebuild + deep-link gate.');
}

const promptCount = db.prepare('SELECT COUNT(*) as n FROM prompts').get();
if (promptCount.n === 0) {
  const ins = db.prepare('INSERT INTO prompts (slug, label, body) VALUES (?, ?, ?)');
  ins.run('refine-voice-rules', 'Refine voice rules',
    'Read .thetacog/rules.db (SQLite) and review the voice_rules table. For each rule, ask: does the pattern catch real violations without false positives? Suggest refinements as INSERT/UPDATE statements I can run to update the table. Then regenerate the lexical hook by running `thetacog regen-hooks`.');
  ins.run('add-rule-from-incident', 'Add a rule from a recent incident',
    'I just saw a voice violation in this draft: [paste here]. Help me extract the underlying rule, write a regex pattern that catches it, propose ERROR vs WARNING level, and write the SQL INSERT for .thetacog/rules.db voice_rules table. Stress-test the pattern against the rest of the draft to confirm no false positives.');
  ins.run('audit-meta-commentary', 'Audit current draft for meta-commentary',
    'Read the most recent draft I edited (use git status + git diff to find it). Audit for meta-commentary violations — sentences naming the prose itself, naming voice techniques, telling the reader what to feel. List each violation with line number and proposed surgical replacement.');
}

// Seed the 9 canonical rooms from README grid (shortlex order)
const roomCount = db.prepare('SELECT COUNT(*) as n FROM rooms').get();
if (roomCount.n === 0) {
  const ins = db.prepare('INSERT INTO rooms (key, shortlex, label, emoji, terminal, pull_statement, primary_scope) VALUES (?,?,?,?,?,?,?)');
  // shortlex order: A1, A2, A3, B1, B2, B3, C1, C2, C3
  ins.run('A1.Vault', 'A1', 'Vault', '🔒', 'WezTerm', 'PROVE, not claim. Mathematical certainty.', null);
  ins.run('A2.Architect', 'A2', 'Architect', '📐', 'VS Code', 'CASCADE and COMPOUND. Strategic systems.', null);
  ins.run('A3.Performer', 'A3', 'Performer', '🎬', 'Alacritty', 'MULTIPLIER RATIO. Demos, presentations, delivery.', null);
  ins.run('B1.Navigator', 'B1', 'Navigator', '🧭', 'Terminal', '15-MINUTE DISCIPLINE. Cache hits.', null);
  ins.run('B2.Network', 'B2', 'Network', '🌐', 'Messages', 'RECIPROCITY FIRST. Communication, signal exchange.', null);
  ins.run('B3.Voice', 'B3', 'Voice', '🎤', 'Terminal', 'STAKE CONVICTION. Voice rules, paradox prose.', 'voice');
  ins.run('C1.Builder', 'C1', 'Builder', '🔨', 'iTerm2', 'SHIPPED AND INSTRUMENTED. Structural, canonical forms.', 'structural');
  ins.run('C2.Lab', 'C2', 'Laboratory', '🧪', 'Cursor', '2 hours not 2 weeks. Iteration, experimentation.', null);
  ins.run('C3.Operator', 'C3', 'Operator', '🎩', 'Kitty', 'BINDING COMMITMENT INDEX. Business communications, deals.', 'business-comms');
}

// Seed initial rule_room_relevance from voice_rules.scope (one-time migration).
// Each rule's primary scope → relevance 100 in matching room. Other rooms = 0
// (no row). Orthogonalisation prompt refines this — see /api/cc-prompt/orthogonalize.
const rrrCount = db.prepare('SELECT COUNT(*) as n FROM rule_room_relevance').get();
if (rrrCount.n === 0) {
  const rules = db.prepare('SELECT id, scope FROM voice_rules').all();
  const roomByScope = db.prepare("SELECT id FROM rooms WHERE primary_scope = ?");
  const insRRR = db.prepare("INSERT INTO rule_room_relevance (rule_id, room_id, relevance, rationale, scored_by) VALUES (?,?,?,?,?)");
  for (const rule of rules) {
    const room = roomByScope.get(rule.scope);
    if (room) {
      insRRR.run(rule.id, room.id, 100, `seed migration: scope=${rule.scope} → primary_scope room`, 'seed');
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const text = (res, code, str) => {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(str);
};

const readBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

// Run a script in background, write output to .thetacog/runs/<id>.log
function runInBackground(scriptPath, args = []) {
  const runsDir = path.join(THETACOG_DIR, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logPath = path.join(runsDir, `${id}.log`);
  const out = fs.openSync(logPath, 'a');
  const child = spawn(scriptPath, args, {
    cwd: CWD,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, CLAUDECODE: undefined },
  });
  child.unref();
  return { id, pid: child.pid, logPath };
}

// ──────────────────────────────────────────────────────────────────
// Inline UI
// ──────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>thetacog · rules dashboard</title>
<style>
:root { --bg:#0a0a0f; --panel:#13131c; --fg:#e0e0e0; --cyan:#66fcf1; --purple:#c678dd; --yellow:#fbbf24; --red:#ff6b6b; --green:#22c55e; --grey:#475569; }
* { box-sizing: border-box; }
body { font-family: 'JetBrains Mono', ui-monospace, monospace; background: var(--bg); color: var(--fg); margin: 0; line-height: 1.5; }
.shell { max-width: 1100px; margin: 0 auto; padding: 24px 20px 80px; }
h1 { color: var(--cyan); font-size: 22px; letter-spacing: 1px; margin: 0 0 4px; }
h2 { color: var(--purple); font-size: 14px; letter-spacing: 2px; text-transform: uppercase; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #2a2a3a; }
.muted { color: var(--grey); font-size: 12px; }
nav.top { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0 18px; border-bottom: 1px dashed #20202a; margin-bottom: 12px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
nav.top a { color: var(--grey); text-decoration: none; padding: 4px 10px; border: 1px solid #20202a; border-radius: 3px; }
nav.top a:hover { color: var(--cyan); border-color: var(--cyan); }
nav.top a.current { color: var(--cyan); border-color: var(--cyan); }
nav.top .label { color: var(--purple); padding: 4px 6px; }
.rule-card { padding: 10px 12px; border: 1px solid #20202a; border-radius: 4px; margin: 6px 0; background: #0e0e16; }
.rule-card:hover { border-color: #303040; }
.rule-row1 { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 12px; }
.rule-name { color: var(--cyan); font-weight: 600; flex: 1; min-width: 200px; }
.rule-badges { display: flex; gap: 6px; }
.rule-badge { font-size: 9px; padding: 2px 6px; border: 1px solid currentColor; border-radius: 3px; letter-spacing: 1px; text-transform: uppercase; }
.rule-actions { font-size: 10px; }
.rule-desc { color: var(--fg); font-size: 13px; line-height: 1.5; margin: 6px 0; }
.rule-pattern details summary { cursor: pointer; color: var(--grey); font-size: 11px; user-select: none; }
.rule-pattern details summary:hover { color: var(--yellow); }
.rule-pattern code { display: block; margin-top: 4px; padding: 6px 8px; word-break: break-all; font-size: 11px; }
.cc-action { display: block; width: 100%; margin: 10px 0 4px; padding: 10px 14px; background: var(--purple); color: var(--bg); border: 1px solid var(--purple); font-family: inherit; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer; }
.cc-action:hover { background: var(--cyan); border-color: var(--cyan); color: var(--bg); }
.intro-banner { background: linear-gradient(135deg, rgba(167,139,250,0.08), rgba(102,252,241,0.05)); border: 1px solid rgba(167,139,250,0.3); border-radius: 6px; padding: 14px 16px; margin: 8px 0 24px; }
.intro-banner h3 { color: var(--cyan); margin: 0 0 6px; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; }
.intro-banner p { margin: 4px 0; color: var(--fg); font-size: 13px; line-height: 1.5; }
.intro-banner b { color: var(--purple); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 8px 10px; border-bottom: 1px solid #20202a; text-align: left; vertical-align: top; }
th { color: var(--purple); font-weight: 600; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; }
code { background: var(--panel); padding: 1px 6px; border-radius: 3px; color: var(--yellow); }
.lvl-ERROR { color: var(--red); font-weight: 700; }
.lvl-WARNING { color: var(--yellow); }
.lvl-INFO { color: var(--cyan); }
button, .btn { background: transparent; color: var(--cyan); border: 1px solid var(--cyan); padding: 8px 14px; cursor: pointer; font-family: inherit; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; margin: 4px 4px 4px 0; }
button:hover, .btn:hover { background: var(--cyan); color: var(--bg); }
button.copy { color: var(--purple); border-color: var(--purple); }
button.copy:hover { background: var(--purple); color: var(--bg); }
button.run { color: var(--yellow); border-color: var(--yellow); }
button.run:hover { background: var(--yellow); color: var(--bg); }
button.danger { color: var(--red); border-color: var(--red); border-style: dashed; padding: 4px 8px; font-size: 10px; }
button.danger:hover { background: var(--red); color: var(--bg); }
input, textarea, select { background: var(--panel); color: var(--fg); border: 1px solid #2a2a3a; padding: 6px 8px; font-family: inherit; font-size: 12px; margin: 2px; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--cyan); }
form.add { display: grid; grid-template-columns: 1fr 2fr 100px 2fr 80px; gap: 4px; margin-top: 8px; }
.runs { font-size: 11px; color: var(--grey); margin-top: 4px; }
.toast { position: fixed; bottom: 20px; right: 20px; background: var(--green); color: var(--bg); padding: 8px 16px; border-radius: 4px; font-size: 12px; }
</style>
</head><body><div class="shell">

<nav class="top" id="nav-top"><span class="label">loading nav…</span></nav>

<h1>🧠 thetacog · rules dashboard</h1>
<div class="muted">Local SQLite: <code id="db-path"></code> · Hooks read from this DB · Singleton on port ${PORT}</div>

<div class="intro-banner">
<h3>How this works</h3>
<p>Every rule below has a <b>📋 Copy prompt</b> button. Click it, paste into a Claude Code session, and CC works on the rule with full context — pattern, description, file paths, related Shadow Agent architecture.</p>
<p>The dashboard <b>finds</b> the right rules; Claude Code <b>edits</b> them. SQLite at <code>.thetacog/rules.db</code> is the single source of truth. After any rule change in CC, run <code>thetacog regen-hooks</code> to regenerate the JSON the lexical hooks read.</p>
<p style="margin-top:10px">
  <button class="cc-action" style="display:inline-block;width:auto;padding:8px 14px;margin-right:6px" onclick="ccOrthogonalize()">📋 Copy orthogonalisation prompt → score rule × room relevance in CC</button>
  <button class="cc-action" style="display:inline-block;width:auto;padding:8px 14px;background:transparent;color:var(--purple)" onclick="ccRegenerateDashboard()">📋 Regenerate this dashboard in CC</button>
</p>
</div>

<h2>Cognitive Rooms (shortlex)</h2>
<div id="rooms"></div>

<h2>Search</h2>
<input id="search" type="search" placeholder="search rules + hook files (name, pattern, description, path)…" style="width:100%; padding:10px 12px; font-size:14px; background:var(--panel); color:var(--fg); border:1px solid #2a2a3a;">
<div class="muted" style="margin-top:4px">Filter applies to both lists below. Empty = show all.</div>

<h2>Voice Rules</h2>
<div id="rules"></div>
<form id="add-form" class="add">
  <input name="name" placeholder="rule-slug" required>
  <input name="pattern" placeholder="regex pattern" required>
  <select name="level"><option>ERROR</option><option selected>WARNING</option><option>INFO</option></select>
  <input name="description" placeholder="why this rule exists">
  <button type="submit">Add</button>
</form>

<h2>Hook Config</h2>
<div id="hooks"></div>

<h2>Hook Scripts (all .sh paths)</h2>
<div class="muted" style="margin-bottom:8px">Every hook script discovered in the repo. Click <b>📋 Copy prompt</b> to send the script + Shadow Agent context to Claude Code.</div>
<div id="hook-files"></div>

<h2>Manual Run</h2>
<button class="run" onclick="run('voice-audit')">🤖 Voice audit (dirty files)</button>
<button class="run" onclick="run('anchor-check')">🎯 Post-anchor check (blog drafts)</button>
<button class="run" onclick="run('regen-hooks')">⚙️ Regenerate hooks-config.json from SQLite</button>
<div class="runs" id="runs">No runs yet.</div>

<h2>Copy-Prompt for Claude Code</h2>
<div class="muted">Each button copies a pre-formatted prompt. Paste into a Claude Code session to have cc work on the rules with full context.</div>
<div id="prompts"></div>

<div id="toast" style="display:none"></div>

<script>
async function fetchJSON(url, opts) { const r = await fetch(url, opts); return r.ok ? r.json() : Promise.reject(await r.text()); }
function toast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.background = color || 'var(--green)'; t.style.display = 'block'; t.className = 'toast';
  setTimeout(() => t.style.display = 'none', 2500);
}
function getScope() { return new URLSearchParams(location.search).get('scope') || ''; }
function getRoom() { return new URLSearchParams(location.search).get('room') || ''; }
async function loadNav() {
  try {
    const pages = await fetchJSON('/api/pages');
    const byCat = pages.reduce((acc, p) => ((acc[p.category] = acc[p.category] || []).push(p), acc), {});
    const cur = location.pathname;
    const html = '<a href="/" class="' + (cur === '/' ? 'current' : '') + '">🧠 rules</a>' +
      Object.entries(byCat).map(([cat, ps]) =>
        '<span class="label">' + cat + '</span>' +
        ps.map(p => '<a href="/page/' + encodeURIComponent(p.path) + '" title="' + escape(p.path) + '">' + escape(p.title || p.file) + '</a>').join('')
      ).join('');
    document.getElementById('nav-top').innerHTML = html;
  } catch (err) {
    document.getElementById('nav-top').innerHTML = '<span class="label">nav unavailable</span>';
  }
}
async function loadRules() {
  const room = getRoom();
  const scope = getScope();
  const q = (document.getElementById('search')?.value || '').toLowerCase();
  const url = room ? '/api/rules?room=' + encodeURIComponent(room)
                    : (scope ? '/api/rules?scope=' + encodeURIComponent(scope) : '/api/rules');
  let rules = await fetchJSON(url);
  if (q) rules = rules.filter(r => (r.name+' '+r.pattern+' '+(r.description||'')+' '+r.scope).toLowerCase().includes(q));
  const scopes = await fetchJSON('/api/scopes');
  const scopeBar = '<div class="muted" style="margin-bottom:12px">Scope: ' +
    '<a href="?" style="color:'+(!scope?'var(--cyan)':'var(--grey)')+';margin-right:10px;text-decoration:none">all</a>' +
    scopes.map(s => '<a href="?scope='+s.scope+'" style="color:'+(scope===s.scope?'var(--cyan)':'var(--grey)')+';margin-right:10px;text-decoration:none">'+s.scope+' ('+s.count+')</a>').join('') +
    '</div>';
  const cards = rules.map(r =>
    '<div class="rule-card">' +
      '<div class="rule-row1">' +
        '<span class="rule-name">' + r.name + '</span>' +
        '<span class="rule-badges">' +
          '<span class="rule-badge lvl-' + r.level + '">' + r.level + '</span>' +
          (scope || room ? '' : '<span class="rule-badge" style="color:var(--purple)">' + r.scope + '</span>') +
          (room && r.relevance != null ? '<span class="rule-badge" style="color:var(--cyan)">rel ' + r.relevance + '</span>' : '') +
          '<span class="rule-badge" style="color:' + (r.enabled?'var(--green)':'var(--grey)') + '">' + (r.enabled?'on':'off') + '</span>' +
        '</span>' +
        '<span class="rule-actions">' +
          '<button class="danger" onclick="toggleRule(' + r.id + ')">' + (r.enabled?'disable':'enable') + '</button> ' +
          '<button class="danger" onclick="delRule(' + r.id + ')">delete</button>' +
        '</span>' +
      '</div>' +
      '<div class="rule-desc">' + escape(r.description || '(no description)') + '</div>' +
      (r.rationale ? '<div class="muted" style="font-size:11px;margin:4px 0;font-style:italic">↳ relevance rationale: ' + escape(r.rationale) + '</div>' : '') +
      '<div class="rule-pattern">' +
        '<details><summary>▸ regex pattern</summary><code>' + escape(r.pattern) + '</code></details>' +
        '<details><summary>▸ full rule (all metadata + ids)</summary><pre style="background:var(--panel);padding:8px;font-size:11px;color:var(--fg);white-space:pre-wrap;word-break:break-word">' + escape(JSON.stringify(r, null, 2)) + '</pre></details>' +
      '</div>' +
      '<button class="cc-action" onclick="ccPromptForRule(' + r.id + ')">📋 Copy prompt → develop this rule in Claude Code</button>' +
    '</div>'
  ).join('');
  document.getElementById('rules').innerHTML = scopeBar + cards;
}
async function ccPromptForRule(id) {
  const body = await fetch('/api/rules/' + id + '/cc-prompt').then(r => r.text());
  await navigator.clipboard.writeText(body);
  toast('CC prompt copied. Paste into Claude Code.');
}
async function loadHooks() {
  const hooks = await fetchJSON('/api/hooks');
  document.getElementById('hooks').innerHTML = '<table><tr><th>Hook</th><th>Description</th><th>Enabled</th><th></th></tr>' +
    hooks.map(h => '<tr><td><code>'+h.hook_name+'</code></td><td>'+(h.description||'')+'</td><td>'+(h.enabled?'✓':'·')+'</td><td><button class="danger" onclick="toggleHook('+h.id+')">'+(h.enabled?'disable':'enable')+'</button></td></tr>').join('') + '</table>';
}
async function loadPrompts() {
  const prompts = await fetchJSON('/api/prompts');
  document.getElementById('prompts').innerHTML = prompts.map(p =>
    '<button class="copy" onclick="copyPrompt(\\''+p.slug+'\\')">📋 '+p.label+'</button>'
  ).join('');
}
async function loadHookFiles() {
  try {
    const files = await fetchJSON('/api/hook-files');
    const q = (document.getElementById('search')?.value || '').toLowerCase();
    const filtered = q ? files.filter(f => (f.name+' '+f.path+' '+(f.description||'')).toLowerCase().includes(q)) : files;
    document.getElementById('hook-files').innerHTML = filtered.map(f =>
      '<div class="rule-card">' +
        '<div class="rule-row1"><span class="rule-name">' + f.name + '</span>' +
        '<span class="rule-badges"><span class="rule-badge" style="color:var(--purple)">' + f.dir + '</span><span class="rule-badge" style="color:var(--grey)">' + f.size + 'b</span></span></div>' +
        '<div class="rule-desc">' + (f.description ? escape(f.description) : '<i style="color:var(--grey)">no header comment</i>') + '</div>' +
        '<div class="rule-pattern">' +
          '<details><summary>▸ full path</summary><code>' + f.path + '</code></details>' +
          '<details onclick="loadHookContent(this, \\''+f.path+'\\')"><summary>▸ full file content</summary><pre style="background:var(--panel);padding:8px;font-size:11px;color:var(--fg);white-space:pre-wrap;max-height:400px;overflow:auto"><i>loading…</i></pre></details>' +
        '</div>' +
        '<button class="cc-action" onclick="ccPromptForHook(\\''+f.path+'\\')">📋 Copy prompt → fix this hook in Claude Code</button>' +
      '</div>'
    ).join('');
  } catch (err) {
    document.getElementById('hook-files').innerHTML = '<div class="muted">Hook files unavailable.</div>';
  }
}
async function ccPromptForHook(p) {
  const body = await fetch('/api/hook-file/' + encodeURIComponent(p) + '/cc-prompt').then(r => r.text());
  await navigator.clipboard.writeText(body);
  toast('CC prompt copied. Paste into Claude Code.');
}
async function loadHookContent(detailsEl, p) {
  if (detailsEl.dataset.loaded) return;
  detailsEl.dataset.loaded = '1';
  const pre = detailsEl.querySelector('pre');
  try {
    const body = await fetch('/api/hook-file/' + encodeURIComponent(p)).then(r => r.text());
    pre.textContent = body;
  } catch (err) {
    pre.textContent = 'Failed to load: ' + err;
  }
}
async function ccRegenerateDashboard() {
  const body = await fetch('/api/cc-prompt/regenerate-dashboard').then(r => r.text());
  await navigator.clipboard.writeText(body);
  toast('Regenerate-dashboard prompt copied. Paste into Claude Code.');
}
async function ccOrthogonalize() {
  const body = await fetch('/api/cc-prompt/orthogonalize').then(r => r.text());
  await navigator.clipboard.writeText(body);
  toast('Orthogonalisation prompt copied. Paste into CC; CC returns SQL INSERTs you run.');
}
async function loadRooms() {
  try {
    const rooms = await fetchJSON('/api/rooms');
    const cur = new URLSearchParams(location.search).get('room') || '';
    document.getElementById('rooms').innerHTML =
      '<div class="muted" style="margin-bottom:8px">Click a room to filter rules to its scope. Rules below ranked by relevance score (100 = canonical for that room).</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
      rooms.map(r => {
        const isCurrent = cur === r.key;
        return '<a href="?room=' + encodeURIComponent(r.key) + '" style="display:block;padding:10px 12px;border:1px solid '+(isCurrent?'var(--cyan)':'#20202a')+';border-radius:4px;color:'+(isCurrent?'var(--cyan)':'var(--fg)')+';text-decoration:none;background:'+(isCurrent?'rgba(102,252,241,0.06)':'transparent')+'">' +
          '<div style="font-size:11px;color:var(--purple);letter-spacing:1.5px">' + r.shortlex + '</div>' +
          '<div style="font-size:14px;margin-top:2px"><span style="font-size:18px">' + (r.emoji||'') + '</span> ' + r.label + '</div>' +
          '<div style="font-size:11px;color:var(--grey);margin-top:2px">' + (r.terminal||'—') + ' · ' + r.rule_count + ' rules</div>' +
          '<div style="font-size:11px;color:var(--fg);margin-top:6px;line-height:1.4">' + escape(r.pull_statement||'') + '</div>' +
        '</a>';
      }).join('') +
      '</div>' +
      (cur ? '<div style="margin-top:10px"><a href="/" style="color:var(--grey);font-size:11px">← clear room filter</a></div>' : '');
  } catch (err) {
    document.getElementById('rooms').innerHTML = '<div class="muted">Rooms unavailable.</div>';
  }
}
function escape(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function toggleRule(id) { await fetch('/api/rules/'+id+'/toggle', {method:'POST'}); loadRules(); }
async function delRule(id) { if (!confirm('Delete rule?')) return; await fetch('/api/rules/'+id, {method:'DELETE'}); loadRules(); }
async function toggleHook(id) { await fetch('/api/hooks/'+id+'/toggle', {method:'POST'}); loadHooks(); }
document.getElementById('add-form').onsubmit = async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  fd.enabled = 1;
  try { await fetchJSON('/api/rules', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(fd)}); e.target.reset(); loadRules(); toast('Rule added'); }
  catch (err) { toast('Error: ' + err, 'var(--red)'); }
};
async function run(name) {
  try {
    const res = await fetchJSON('/api/run/'+name, {method:'POST'});
    document.getElementById('runs').innerHTML = 'Last run: <code>'+name+'</code> dispatched (id='+res.id+', pid='+res.pid+'). Log: <code>'+res.logPath+'</code>';
    toast('Dispatched: ' + name);
  } catch (err) { toast('Error: ' + err, 'var(--red)'); }
}
async function copyPrompt(slug) {
  const r = await fetch('/api/prompts/'+slug); const body = await r.text();
  await navigator.clipboard.writeText(body);
  toast('Copied. Paste into Claude Code.');
}
document.getElementById('db-path').textContent = window.location.origin;
loadNav(); loadRooms(); loadRules(); loadHooks(); loadPrompts(); loadHookFiles();
// Live search filter
document.getElementById('search').addEventListener('input', () => { loadRules(); loadHookFiles(); });
</script>
</div></body></html>`;

// ──────────────────────────────────────────────────────────────────
// HTTP server
// ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    // Static UI
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    // Rules CRUD — supports ?room=X (relevance-ranked) OR ?scope=X (legacy) OR all
    if (p === '/api/rules' && req.method === 'GET') {
      const room = url.searchParams.get('room');
      const scope = url.searchParams.get('scope');
      let rows;
      if (room) {
        rows = db.prepare(`
          SELECT r.*, rrr.relevance, rrr.rationale
          FROM voice_rules r
          JOIN rule_room_relevance rrr ON rrr.rule_id = r.id
          JOIN rooms rm ON rm.id = rrr.room_id
          WHERE rm.key = ? AND rrr.relevance > 0
          ORDER BY rrr.relevance DESC, r.level, r.name
        `).all(room);
      } else if (scope) {
        rows = db.prepare('SELECT * FROM voice_rules WHERE scope = ? ORDER BY level, name').all(scope);
      } else {
        rows = db.prepare('SELECT * FROM voice_rules ORDER BY scope, level, name').all();
      }
      return json(res, 200, rows);
    }
    if (p === '/api/scopes' && req.method === 'GET') {
      const rows = db.prepare('SELECT scope, COUNT(*) as count FROM voice_rules GROUP BY scope ORDER BY scope').all();
      return json(res, 200, rows);
    }
    // Gmail sent-mail mirror (populated by gmail-sync.js — zero-LLM connector).
    // ?q= substring-matches subject/to/body; ?days= bounds the window (default 7).
    if (p === '/api/gmail' && req.method === 'GET') {
      try {
        const qy = url.searchParams.get('q');
        const days = Number(url.searchParams.get('days') || 7);
        const since = new Date(Date.now() - days * 86400e3).toISOString();
        const rows = qy
          ? db.prepare(`SELECT id, thread_id, date_utc, to_addrs, subject, snippet FROM gmail_sent
                        WHERE date_utc >= ? AND (subject LIKE ? OR to_addrs LIKE ? OR body_text LIKE ?)
                        ORDER BY date_utc DESC LIMIT 100`).all(since, `%${qy}%`, `%${qy}%`, `%${qy}%`)
          : db.prepare('SELECT id, thread_id, date_utc, to_addrs, subject, snippet FROM gmail_sent WHERE date_utc >= ? ORDER BY date_utc DESC LIMIT 100').all(since);
        return json(res, 200, rows);
      } catch { return json(res, 200, []); }   // table absent until first sync — empty, not error
    }
    // Canon index (populated by gmail-sync.js --index-canon): FTS5 search over
    // CLAUDE.md + the ledgers + the Q&A — the rules-and-canonicals surface of the bundle.
    if (p === '/api/canon' && req.method === 'GET') {
      try {
        const qy = url.searchParams.get('q');
        const rows = qy
          ? db.prepare(`SELECT path, title, snippet(canonicals_fts, 2, '«', '»', ' … ', 18) AS hit
                        FROM canonicals_fts WHERE canonicals_fts MATCH ? LIMIT 30`).all(qy)
          : db.prepare('SELECT path, title, sha, indexed_at FROM canonicals ORDER BY path').all();
        return json(res, 200, rows);
      } catch { return json(res, 200, []); }
    }
    if (p === '/api/rooms' && req.method === 'GET') {
      const rows = db.prepare(`
        SELECT rm.*, COUNT(CASE WHEN rrr.relevance > 0 THEN 1 END) as rule_count
        FROM rooms rm
        LEFT JOIN rule_room_relevance rrr ON rrr.room_id = rm.id
        GROUP BY rm.id
        ORDER BY rm.shortlex
      `).all();
      return json(res, 200, rows);
    }
    // Orthogonalisation prompt — emit the prompt CC runs to score rule×room relevance
    if (p === '/api/cc-prompt/orthogonalize' && req.method === 'GET') {
      const rules = db.prepare('SELECT id, name, level, scope, description, pattern FROM voice_rules WHERE enabled = 1').all();
      const rooms = db.prepare('SELECT id, key, shortlex, label, emoji, terminal, pull_statement FROM rooms ORDER BY shortlex').all();
      const prompt = `# Orthogonalisation prompt — score rule × room relevance

You are scoring rule-relevance across cognitive rooms in shortlex order. The shortlex is the breadth-first iteration order (A1 → A2 → A3 → B1 → B2 → B3 → C1 → C2 → C3). Run room-by-room in that order.

## Rules to score (${rules.length})

\`\`\`json
${JSON.stringify(rules, null, 2)}
\`\`\`

## Rooms (in shortlex order)

\`\`\`json
${JSON.stringify(rooms, null, 2)}
\`\`\`

## Your task

For EACH (rule, room) pair, output a relevance score 0–100 and a one-sentence rationale.

- 100 = canonical / load-bearing for this room
- 70-99 = strongly relevant
- 30-69 = weakly relevant (rule applies in some cases)
- 1-29 = barely relevant (edge cases only)
- 0 = irrelevant; do NOT emit a row for relevance 0

Use each room's THE PULL statement as your guide for what belongs there.

## Output format

Output ONLY SQL INSERT statements I can paste into sqlite. Replace any prior rows for these (rule_id, room_id) pairs (use INSERT OR REPLACE). Format:

\`\`\`sql
INSERT OR REPLACE INTO rule_room_relevance (rule_id, room_id, relevance, rationale, scored_by) VALUES
  (1, 6, 100, 'paradox-no-tell-feelings is the canonical voice rule', 'llm-orthogonalize'),
  (1, 7, 60, 'voice rules apply when Builder writes structural prose', 'llm-orthogonalize'),
  ...;
\`\`\`

Iterate room-by-room (A1 first, then A2, ..., C3 last). For each room, list every rule that scored > 0. Skip the 0-relevance pairs entirely.

After the SQL, write a one-paragraph summary of the orthogonalisation result: which rules concentrated in which rooms, which rules are universal, which rules are surprisingly room-specific.

Run \`thetacog regen-hooks\` after the SQL is applied so the lexical hooks see the updated relevance.
`;
      return text(res, 200, prompt);
    }
    if (p === '/api/rules' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const r = db.prepare('INSERT INTO voice_rules (name, pattern, level, description) VALUES (?, ?, ?, ?)')
          .run(body.name, body.pattern, body.level || 'WARNING', body.description || '');
        return json(res, 200, { id: r.lastInsertRowid });
      } catch (e) { return text(res, 400, e.message); }
    }
    let m;
    if ((m = p.match(/^\/api\/rules\/(\d+)\/toggle$/)) && req.method === 'POST') {
      db.prepare('UPDATE voice_rules SET enabled = 1 - enabled, updated_at = datetime("now") WHERE id = ?').run(m[1]);
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/rules\/(\d+)$/)) && req.method === 'DELETE') {
      db.prepare('DELETE FROM voice_rules WHERE id = ?').run(m[1]);
      return json(res, 200, { ok: true });
    }

    // Hook config
    if (p === '/api/hooks' && req.method === 'GET') {
      return json(res, 200, db.prepare('SELECT * FROM hook_config ORDER BY hook_name').all());
    }
    if ((m = p.match(/^\/api\/hooks\/(\d+)\/toggle$/)) && req.method === 'POST') {
      db.prepare('UPDATE hook_config SET enabled = 1 - enabled, updated_at = datetime("now") WHERE id = ?').run(m[1]);
      return json(res, 200, { ok: true });
    }

    // Prompts
    if (p === '/api/prompts' && req.method === 'GET') {
      return json(res, 200, db.prepare('SELECT id, slug, label FROM prompts ORDER BY label').all());
    }
    if ((m = p.match(/^\/api\/prompts\/([^/]+)$/)) && req.method === 'GET') {
      const row = db.prepare('SELECT body FROM prompts WHERE slug = ?').get(m[1]);
      if (!row) return text(res, 404, 'not found');
      return text(res, 200, row.body);
    }

    // Manual runs
    if ((m = p.match(/^\/api\/run\/(.+)$/)) && req.method === 'POST') {
      const which = m[1];
      const map = {
        'voice-audit': './scripts/voice-audit-llm.sh',
        'anchor-check': './scripts/post-anchor-check.sh',
        'regen-hooks': './packages/thetacog-mcp/regen-hooks.js',
      };
      const scriptPath = map[which];
      if (!scriptPath) return text(res, 404, 'unknown run target');
      const result = runInBackground(scriptPath);
      return json(res, 200, result);
    }

    // Discover navigable pages (rooms + workspace + relevant dashboards)
    if (p === '/api/pages' && req.method === 'GET') {
      const pages = [];
      const candidates = [
        { dir: '.workflow/rooms', label_prefix: 'room', filter: f => f.endsWith('.html') && !f.startsWith('create-') && !f.startsWith('archive-') },
        { dir: '.workflow', label_prefix: 'workflow', filter: f => f === 'index.html' || f.startsWith('cognitive-dashboard') || f.startsWith('advertising-') },
        { dir: 'cognitive-workspace/dashboards', label_prefix: 'dashboard', filter: f => f.endsWith('.html') && !f.startsWith('archive-') },
      ];
      for (const { dir, label_prefix, filter } of candidates) {
        const full = path.join(CWD, dir);
        if (!fs.existsSync(full)) continue;
        for (const f of fs.readdirSync(full)) {
          if (!filter(f)) continue;
          const fp = path.join(full, f);
          if (!fs.statSync(fp).isFile()) continue;
          // Extract <title> from HTML for label
          let title = f.replace(/\.html$/, '').replace(/[-_]/g, ' ');
          try {
            const head = fs.readFileSync(fp, 'utf8').slice(0, 4000);
            const m = head.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (m) title = m[1].trim().replace(/\s+/g, ' ').slice(0, 80);
          } catch {}
          pages.push({ category: label_prefix, file: f, path: path.join(dir, f), title });
        }
      }
      return json(res, 200, pages);
    }

    // Serve a page (room HTML etc.) from the host repo
    if ((m = p.match(/^\/page\/(.+)$/)) && req.method === 'GET') {
      const rel = decodeURIComponent(m[1]);
      if (!/^(\.workflow|cognitive-workspace)\//.test(rel) || rel.includes('..')) return text(res, 400, 'forbidden path');
      const fp = path.join(CWD, rel);
      if (!fs.existsSync(fp)) return text(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(fp, 'utf8'));
    }

    // Discover hook scripts in the host repo
    if (p === '/api/hook-files' && req.method === 'GET') {
      const scan = [
        { dir: 'hooks', filter: f => !f.startsWith('.') },
        { dir: 'scripts', filter: f => /^(voice-|post-anchor|check-reply|verify-blog-book|build-book-html|validate-mdx)/.test(f) && (f.endsWith('.sh') || f.endsWith('.js')) },
      ];
      const files = [];
      for (const { dir, filter } of scan) {
        const full = path.join(CWD, dir);
        if (!fs.existsSync(full)) continue;
        for (const f of fs.readdirSync(full)) {
          if (!filter(f)) continue;
          const fp = path.join(full, f);
          let firstLines = '';
          try { firstLines = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 25).join('\n'); } catch {}
          // Extract first comment block as description
          const desc = (firstLines.match(/^#\s*(.+)$/m) || [, ''])[1].trim();
          files.push({ dir, name: f, path: path.join(dir, f), description: desc, size: fs.statSync(fp).size });
        }
      }
      return json(res, 200, files);
    }
    if ((m = p.match(/^\/api\/hook-file\/(.+)$/)) && req.method === 'GET') {
      const rel = decodeURIComponent(m[1]);
      // Path-traversal guard: only allow hooks/ or scripts/ subpath
      if (!/^(hooks|scripts)\//.test(rel) || rel.includes('..')) return text(res, 400, 'forbidden path');
      const fp = path.join(CWD, rel);
      if (!fs.existsSync(fp)) return text(res, 404, 'not found');
      return text(res, 200, fs.readFileSync(fp, 'utf8'));
    }

    // Build a CC prompt for a specific rule (find + point + work)
    if ((m = p.match(/^\/api\/rules\/(\d+)\/cc-prompt$/)) && req.method === 'GET') {
      const rule = db.prepare('SELECT * FROM voice_rules WHERE id = ?').get(m[1]);
      if (!rule) return text(res, 404, 'not found');
      const prompt = `Work on voice rule \`${rule.name}\` (scope=${rule.scope}, level=${rule.level}).

Source of truth: \`.thetacog/rules.db\` (SQLite), table \`voice_rules\`, id ${rule.id}.
Pattern: \`${rule.pattern}\`
Description: ${rule.description || '(none)'}

Tasks for you:
1. Read the rule above. Stress-test the pattern: does it catch real violations without false positives across our recent blog posts (\`src/content/blog/2026-05-*\`) and book chapters (\`books/tesseract/chapters/\`)?
2. If the pattern needs refinement, propose an UPDATE statement I can run against \`voice_rules\`. Include the new pattern and a one-line rationale.
3. After any rule change, run \`thetacog regen-hooks\` so \`.thetacog/hooks-config.json\` matches SQLite.
4. If the description is missing the positive mechanism + negative constraint + inversion (per the meta-rule on no-reductive-saves, May 4), rewrite the description to include all three.
`;
      return text(res, 200, prompt);
    }

    // CC prompt to regenerate / improve the dashboard itself (meta-prompt)
    if (p === '/api/cc-prompt/regenerate-dashboard' && req.method === 'GET') {
      const dashPath = path.relative(CWD, path.resolve(import.meta.url.startsWith('file:') ? new URL(import.meta.url).pathname : 'packages/thetacog-mcp/dashboard.js'));
      const prompt = `Regenerate / improve the thetacog dashboard in this repo.

File: \`packages/thetacog-mcp/dashboard.js\` (single self-contained Node HTTP server, embedded HTML/CSS/JS, SQLite via better-sqlite3).

Goals (per user direction May 4):
1. UX: find rules + point CC at them. NOT edit-in-HTML.
2. Search across rules + hook files (live filter).
3. Per-rule and per-hook-file "Copy CC prompt" buttons that emit prompts including the file/rule context.
4. Singleton dashboard via PID lockfile, port 3737.
5. Card layout (description prominent, regex collapsed in <details>).
6. Top nav dynamically scans .workflow/rooms/* + .workflow/* + cognitive-workspace/dashboards/*.
7. Three rule scopes: voice, structural, business-comms — each cognitive room links to one via ?scope=X.
8. SQLite at \`.thetacog/rules.db\` is the source of truth; \`thetacog regen-hooks\` writes \`.thetacog/hooks-config.json\`.

Tasks:
1. Read \`packages/thetacog-mcp/dashboard.js\` end-to-end.
2. Suggest concrete improvements for layout, accessibility, performance, and the find-and-point UX. Each suggestion as one line + diff sketch.
3. If proposing schema changes, write the migration SQL inline (additive only — no DROP COLUMN).
4. Per the liberal-commits rule, each meaningful improvement gets its own commit.
5. After each commit, restart dashboard locally to verify (\`thetacog dashboard --kill && thetacog dashboard\`).
`;
      return text(res, 200, prompt);
    }

    // Build a CC prompt for a specific hook file (find + point + fix)
    if ((m = p.match(/^\/api\/hook-file\/(.+)\/cc-prompt$/)) && req.method === 'GET') {
      const rel = decodeURIComponent(m[1]);
      if (!/^(hooks|scripts)\//.test(rel) || rel.includes('..')) return text(res, 400, 'forbidden path');
      const fp = path.join(CWD, rel);
      if (!fs.existsSync(fp)) return text(res, 404, 'not found');
      const content = fs.readFileSync(fp, 'utf8');
      const prompt = `Work on the hook script at \`${rel}\`.

Shadow Agent architecture (May 4): heavy LLM checks live POST-commit (async, never block); pre-commit + pre-push are lexical-only. Rules are stored in \`.thetacog/rules.db\` (SQLite, single source of truth) and exported to \`.thetacog/hooks-config.json\` via \`thetacog regen-hooks\`. The lexical hooks should READ the JSON, not hardcode patterns.

Current content (first lines):

\`\`\`
${content.split('\n').slice(0, 60).join('\n')}
\`\`\`

Tasks:
1. Read the full file: \`${rel}\`.
2. Audit for hardcoded rule patterns that should instead come from \`.thetacog/hooks-config.json\` (which is regenerated from SQLite).
3. If the script is fast-path lexical, confirm it stays under 1s and never makes network calls. If it's heavy/LLM, confirm it's wired into post-commit (async) and not pre-push (blocking).
4. Propose specific edits. Each edit gets its own commit per the liberal-commits-per-edit rule.
`;
      return text(res, 200, prompt);
    }

    res.writeHead(404); res.end('not found');
  } catch (err) {
    console.error('handler error:', err);
    res.writeHead(500); res.end(String(err.message || err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🧠 thetacog dashboard at http://localhost:${PORT}`);
  console.log(`   SQLite: ${DB_PATH}`);
  console.log(`   Stop:   thetacog dashboard --kill`);
  // Open browser (best-effort)
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(opener, [`http://localhost:${PORT}`], { detached: true, stdio: 'ignore' }).unref(); } catch {}
});
