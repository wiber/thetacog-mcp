#!/usr/bin/env node
// scripts/vna/chat-bridge.mjs — C167b THE 💬 LOCAL IDEATION PILL'S READING: a real probe of the local engine, receipted, painted.
//
// The steer page's pill (top of the intake funnel, above 🟢 auto-paste) reads 🟢 Online (11434) · <tag> or 🔴 Engine Offline off
// .thetacog/chat-probe.json — written here (`probe`, which steer-ui.mjs main runs before each render) and by the chat view's host
// (src/vna-chat.ts) each time it probes, so the tag on the pill is the tag the user picked. Both go through the ONE core,
// packages/thetacog-mcp-vscode/media/chat-core.js: probe = GET /api/tags with a 1,500 ms ceiling (lists tags, loads no model),
// probeReceipt = a whitelist of the probe's fields — never a message, never a transcript. Nothing here calls a model.
//
// THE TRANSCRIPT NEVER ENTERS A WORKER SNOWBALL: this module is the only script that loads the chat core, steer-ui.mjs is the only
// script that loads this module, and the receipt carries no text. The chat's words leave the chat by one click, 📋→🌳 Fold to Tree,
// into vna.clipIngest (clip-ingest.mjs --stdin). tests/vna/c167-local-chat-webview-stream.test.mjs holds all of it.
//
//   node scripts/vna/chat-bridge.mjs probe [--host <url>] [--model <tag>] [--json]
// Exit 0 always (offline is a reading, not a failure). Receipt: VNA_CHAT_PROBE, else .thetacog/chat-probe.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA = resolve(REPO, 'packages/thetacog-mcp-vscode/media');
export const core = createRequire(import.meta.url)(resolve(MEDIA, 'chat-core.js'));
export const PROBE_CMD = 'node scripts/vna/chat-bridge.mjs probe';
export const CHAT_LABEL = core.PILL_LABEL;
export const probeFile = () => process.env.VNA_CHAT_PROBE || resolve(REPO, '.thetacog/chat-probe.json');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtAge = (ms) => (!Number.isFinite(ms) ? '?' : ms < 60e3 ? `${Math.max(0, Math.round(ms / 1e3))}s` : ms < 3600e3 ? `${Math.round(ms / 60e3)}m` : ms < 86400e3 ? `${Math.round(ms / 3600e3)}h` : `${Math.round(ms / 86400e3)}d`);

/** the last receipt, or null when none was written — absence is "not probed", never offline */
export function readProbe(file = probeFile()) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }

/** probe the engine and write the receipt; the requested tag defaults to the one the last receipt carried (the chat view's pick) */
export async function probeAndWrite({ host = process.env.VNA_OLLAMA_HOST || core.DEFAULT_HOST, model = null, file = probeFile() } = {}) {
  const requested = model || (readProbe(file) || {}).requested || core.FALLBACK_MODEL;
  const rcpt = core.probeReceipt(await core.probe({ host }), requested);
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(rcpt) + '\n'); } catch (e) { rcpt.error = `${rcpt.error ? rcpt.error + ' · ' : ''}receipt not written: ${e.message}`; }
  return rcpt;
}

/** the stylesheet the pill and the chat view share — the steer page inlines it whole (every rule is scoped) */
export function chatCss() { try { return readFileSync(resolve(MEDIA, 'chat.css'), 'utf8'); } catch { return ''; } }

/** the pill's metric: the face off the receipt and its age; no receipt → not probed with the command that probes */
export function chatPillMetric(rcpt, { now = Date.now() } = {}) {
  if (!rcpt) return `not probed — <code>${esc(PROBE_CMD)}</code>`;
  const age = rcpt.at ? ` · <span class="chat-age age" data-at="${esc(rcpt.at)}">${fmtAge(now - Date.parse(rcpt.at))}</span> ago` : '';
  if (!rcpt.online) return `<span class="chat-off">${esc(core.OFFLINE_FACE)}</span>${age}`;
  const tag = rcpt.model ? `<span class="chat-tag">${esc(rcpt.model)}</span>` : `<span class="chat-tag">${esc(rcpt.requested)} not installed</span>`;
  return `<span class="chat-on">🟢 Online (${esc(rcpt.port)})</span> · ${tag}${age}`;
}

/** the pill's reading beside its name (behind the +): what the probe saw, in words */
export function chatReading(rcpt) {
  if (!rcpt) return 'not probed';
  if (!rcpt.online) return `${core.OFFLINE_LINE} · ${rcpt.host}`;
  return `${rcpt.face} · ${rcpt.models.length} tag${rcpt.models.length === 1 ? '' : 's'} installed${rcpt.ms != null ? ` · ${rcpt.ms} ms` : ''}`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  if (argv[0] !== 'probe') { console.error('usage: chat-bridge.mjs probe [--host <url>] [--model <tag>] [--json]'); process.exit(2); }
  const r = await probeAndWrite({ host: arg('--host') || undefined, model: arg('--model') });
  console.log(argv.includes('--json') ? JSON.stringify(r) : `${r.face}${r.online ? '' : ` — ${core.OFFLINE_LINE}`} · ${r.host}`);
}
