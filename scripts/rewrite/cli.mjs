#!/usr/bin/env node
// scripts/rewrite/cli.mjs — THE GHOST-READ MATRIX FROM A TERMINAL.
//
// WHY (operator 2026-08-12): "can we run this from the command line as well — run it directly from
// here [Claude Code], while I am walking, and you suggest the rewrites and show the encircled panels
// in the chat … or even send them to telegram to confirm they are the right kind."
//
// So this is not a second implementation of the console. It is a THIN CLIENT of the same server the
// GUI uses: same session, same cards, same ledger, same panel door. Whatever you accept here appears
// in the GUI, and vice versa — one mailbox, two mouths. A CLI with its own state would be a second
// instrument, which is the failure mode this whole codebase keeps guarding against.
//
// It boots the server if nothing is listening, so a walk does not require two terminals.
//
// USAGE
//   node cli.mjs open <file>                       open a file (starts the reader, fills the stack)
//   node cli.mjs next [--panel]                    show the current card + context (+ write the panel PNG)
//   node cli.mjs models                            who is answering
//   node cli.mjs ask <model-id> [--ctx a,b,c] [-n 4]   suggestions for the current card
//   node cli.mjs accept "<the new sentence>"       commit it (same path as ⏎ in the GUI)
//   node cli.mjs skip
//   node cli.mjs panel [--out <path>] [--telegram] the encircled panel for the current card
//
// FLAGS
//   --port N        default 4319 (REWRITE_PORT)
//   --file <path>   act on a specific file instead of the most recent session
//   --json          machine output — for an agent driving this, not a human reading it
//   --telegram      also send the panel PNG to Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
//
// The panel is written as a real PNG on disk and its path is printed, so an agent reading this
// transcript can open it and show it in the chat. That is the whole "show me the panels while I
// walk" path: no new rendering, the same bytes the GUI displays.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0] || 'next';
const flag = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);
const PORT = Number(flag('--port', process.env.REWRITE_PORT || 4319));
const BASE = `http://localhost:${PORT}`;
const JSON_OUT = has('--json');

const out = (human, data) => { if (JSON_OUT) console.log(JSON.stringify(data ?? {}, null, 2)); else console.log(human); };
const die = (msg, data) => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg, ...(data || {}) }, null, 2)); else console.error(`✗ ${msg}`); process.exit(1); };

const get = (action, params = {}) =>
  fetch(`${BASE}/api?action=${action}&${new URLSearchParams(params)}`).then((r) => r.json());
const post = (body) =>
  fetch(`${BASE}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

// ── the server: reuse if listening, boot if not ────────────────────────────────
async function ensureServer() {
  try {
    const r = await fetch(`${BASE}/api?action=health`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) return 'running';
  } catch { /* not listening */ }
  const child = spawn(process.execPath, [path.join(HERE, 'serve.mjs'), '--port', String(PORT)], {
    detached: true, stdio: 'ignore', cwd: process.cwd(),
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { const r = await fetch(`${BASE}/api?action=health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return 'booted'; } catch { /* keep waiting */ }
  }
  die(`could not start the console on ${PORT}`);
}

// ── which file are we on? the flag, else the most recently touched session ─────
function recentSessionFile() {
  const dir = path.join(process.cwd(), '.thetacog', 'cache', 'rewrite');
  if (!fs.existsSync(dir)) return null;
  const rows = fs.readdirSync(dir).filter((f) => f.startsWith('session-') && f.endsWith('.json'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!rows.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, rows[0].f), 'utf8'))?.file || null; } catch { return null; }
}
const targetFile = () => flag('--file', null) || recentSessionFile();

async function currentCard(file) {
  const s = await get('state', { file });
  const card = (s?.cards || [])[0];
  return { state: s, card };
}

function contextFlags() {
  const raw = flag('--ctx', 'before,after');
  const on = new Set(String(raw).split(',').map((x) => x.trim()).filter(Boolean));
  if (on.has('all')) return { before: true, after: true, metrics: true, tesseract: true, monologue: true };
  return { before: on.has('before'), after: on.has('after'), metrics: on.has('metrics'), tesseract: on.has('tesseract'), monologue: on.has('monologue') };
}

// ── the panel: write the PNG the GUI shows, print the path ─────────────────────
async function writePanel(file, card, dest) {
  const r = await post({ action: 'encircle', file, cardId: card.id, text: flag('--text', undefined) });
  const p = r?.panels;
  if (!p || p.error) return { error: p?.error || r?.error || 'panel unavailable' };
  const target = dest || path.join(os.tmpdir(), `ghost-read-panel-${card.id}.png`);
  fs.writeFileSync(target, Buffer.from(String(p.dataUri).split(',')[1], 'base64'));
  const sides = {};
  for (const [k, uri] of Object.entries(p.surfaces || {})) {
    const sp = target.replace(/\.png$/, `-${k}.png`);
    fs.writeFileSync(sp, Buffer.from(String(uri).split(',')[1], 'base64'));
    sides[k] = sp;
  }
  return { path: target, sides, panels: p };
}

async function toTelegram(pngPath, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' };
  const form = new FormData();
  form.append('chat_id', chat);
  form.append('caption', String(caption || '').slice(0, 1000));
  form.append('photo', new Blob([fs.readFileSync(pngPath)], { type: 'image/png' }), path.basename(pngPath));
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    const j = await r.json();
    return { ok: !!j.ok, error: j.ok ? null : (j.description || 'telegram rejected it') };
  } catch (e) { return { ok: false, error: String(e.message) }; }
}

const rule = (s) => `\n${'─'.repeat(72)}\n${s}`;

function printCard(card, file) {
  const f = card.finding, w = card.window;
  const before = w.text.slice(0, w.sentenceInWindow.start).trim();
  const after = w.text.slice(w.sentenceInWindow.end).trim();
  console.log(rule(`¶${f.paragraphIndex} · ${path.basename(file)} · comprehension ${f.score}/100 (baseline ${f.baseline}, dip ${f.dip})`));
  if (before) console.log(`\n…${before.slice(-420)}`);
  console.log(`\n>>> ${f.text}\n`);
  if (after) console.log(`${after.slice(0, 420)}…`);
  if (f.monologue) console.log(rule(`READER'S HEAD: ${f.monologue}`));
  console.log(rule(`card ${card.id}`));
}

// ── commands ──────────────────────────────────────────────────────────────────
await ensureServer();

if (cmd === 'models') {
  const r = await get('models');
  if (JSON_OUT) out('', r);
  else (r.models || []).forEach((m) => console.log(`${m.available ? '✓' : '✗'} ${m.id.padEnd(30)} ${m.label.padEnd(14)} ${m.note || m.reason || ''}`));
  process.exit(0);
}

if (cmd === 'open') {
  const file = path.resolve(argv[1] || die('usage: cli.mjs open <file>'));
  const r = await post({ action: 'open', file });
  out(r?.ok ? `✓ opened ${path.basename(file)} — the reader is filling the stack` : `✗ ${r?.error}`, r);
  process.exit(r?.ok ? 0 : 1);
}

const FILE = targetFile();
if (!FILE) die('no open session — run: cli.mjs open <file>');

if (cmd === 'next') {
  const { state, card } = await currentCard(FILE);
  if (!card) die(`stack empty (worker ${state?.workerAlive ? 'still reading' : 'down'}) — try again in a moment`, { state });
  if (JSON_OUT) { out('', { file: FILE, card }); process.exit(0); }
  printCard(card, FILE);
  if (has('--panel')) {
    const p = await writePanel(FILE, card, flag('--out', null));
    if (p.error) console.log(`panel: ✗ ${p.error}`);
    else console.log(`panel: ${p.path}\n  ${p.panels.walkMode} · aperture ${p.panels.aperture?.actor}→${p.panels.aperture?.patient} · σ ${p.panels.matchSigma} · ${p.panels.regions?.length} regions`);
  }
  process.exit(0);
}

if (cmd === 'panel') {
  const { card } = await currentCard(FILE);
  if (!card) die('no card');
  const p = await writePanel(FILE, card, flag('--out', null));
  if (p.error) die(p.error);
  const pn = p.panels;
  const caption = `¶${card.finding.paragraphIndex} · ${pn.walkMode} · aperture ${pn.aperture?.actor}→${pn.aperture?.patient} grip ${pn.aperture?.grip} · σ ${pn.matchSigma} · ${pn.green}/${pn.amber}/${pn.red} · ${pn.regions?.length} regions`;
  if (has('--telegram')) {
    const t = await toTelegram(p.path, caption);
    console.log(t.ok ? '✓ sent to telegram' : `✗ telegram: ${t.error}`);
  }
  if (JSON_OUT) out('', { ...p, caption });
  else console.log(`${p.path}\n${caption}\nsides: ${Object.values(p.sides).join(' ')}`);
  process.exit(0);
}

if (cmd === 'ask') {
  const model = argv[1] || die('usage: cli.mjs ask <model-id>  (see: cli.mjs models)');
  const { card } = await currentCard(FILE);
  if (!card) die('no card');
  const r = await post({
    action: 'sensemake', file: FILE, cardId: card.id,
    text: flag('--text', undefined), model, n: Number(flag('-n', 4)), context: contextFlags(),
  });
  if (!r?.ok) die(r?.error || 'no answer', r);
  if (JSON_OUT) { out('', r); process.exit(0); }
  console.log(rule(`${r.model} · ${r.ms}ms · context: ${Object.entries(r.context).filter(([, v]) => v).map(([k]) => k).join(' · ')}`));
  console.log(`\nNOW: ${card.finding.text}\n`);
  r.options.forEach((o, i) => console.log(`${i + 1}. ${o.text}\n   — ${o.why}\n`));
  console.log(`accept with:  node cli.mjs accept "<the sentence you want>"`);
  process.exit(0);
}

if (cmd === 'accept') {
  const text = argv[1];
  if (!text) die('usage: cli.mjs accept "<the new sentence>"');
  const { card } = await currentCard(FILE);
  if (!card) die('no card');
  const r = await post({ action: 'accept', file: FILE, cardId: card.id, text });
  out(r?.error ? `✗ ${r.error}` : `✓ committed ¶${card.finding.paragraphIndex}`, r);
  process.exit(r?.error ? 1 : 0);
}

if (cmd === 'skip') {
  const { card } = await currentCard(FILE);
  if (!card) die('no card');
  const r = await post({ action: 'skip', file: FILE, cardId: card.id });
  out(r?.error ? `✗ ${r.error}` : '✓ skipped', r);
  process.exit(r?.error ? 1 : 0);
}

die(`unknown command: ${cmd}`);
