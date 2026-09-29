#!/usr/bin/env node
// scripts/vna/local-models.mjs — C285 THE DROPDOWN SAYS WHICH MODELS THINK, AND THE CLI SETS IT (U19a). Operator 2026-09-25, verbatim:
// *"download and label the model non thinking in the dropdown"* · *"make it editable by cli"*. The 🤖 subagent and control-chat
// dropdowns label every installed tag thinking / non-thinking from ONE table (runner-resolver.mjs THINKING_RULES → thinkingOf); this
// is the CLI door onto the same two things: the label, and the subagent tag in force.
//
// ONE WRITER. `use <tag>` goes through runner-resolver.mjs writeEngineConfig({ subagentModel }) — the door `set --subagent-model`
// runs and the ⚙️ Engine & Keys dropdown's Use button runs — so the dropdown and the CLI can never disagree on the tag in force: they
// read and write the one file (.thetacog/vna-engine.json). It keeps the engine (preset) as it is, exactly as the dropdown does. A tag
// that is not installed is refused, and so is any tag when the installed list cannot be read (a pick is never a tag not on disk).
//
// THE CONTROL CHAT'S TAG lives in the extension's globalState (vna-chat.ts vna.setChatModel), which no shell can read; `list` prints
// the chat DEFAULT (LOCAL_ROLES.chat) and says so, never a guess at what the window has picked.
//
//   node scripts/vna/local-models.mjs list [--json] [--tags a,b]   installed tags (GET /api/tags, else `ollama list`), each labelled,
//                                                                   the subagent tag in force and the chat default marked
//   node scripts/vna/local-models.mjs show [--json]                 the subagent tag in force + its label + the engine
//   node scripts/vna/local-models.mjs use <tag> [--json]            set the subagent tag (writeEngineConfig — the dropdown's door)
//   node scripts/vna/local-models.mjs build [--json]                check config/ollama/qwen3-8b-nothink.Modelfile (C284), then
//                                                                   `ollama create qwen3:8b-nothink -f <it>` — only when invoked
// VNA_LOCAL_MODELS_TAGS=a,b (or --tags) injects the installed list, so a guard never needs ollama.
// LLM-FREE: nothing here calls a model (`ollama create` builds a tag from a Modelfile; it runs no inference).
import { spawnSync, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEngineConfig, writeEngineConfig, thinkingOf, LOCAL_ROLES, presetOf, engineName } from './runner-resolver.mjs';
import { checkNothinkModelfile, readNothinkModelfile, NOTHINK_MODELFILE, NOTHINK_TAG } from './nothink-modelfile.mjs';

const EMBED_RE = /embed/i;   // embedding-only tags are never a chat or subagent pick (media/chat-core.js EMBED_RE, same convention)
const splitTags = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/** `ollama list` text → tag names */
export function parseOllamaList(text) {
  return String(text || '').split('\n').slice(1).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
}

/** the installed, non-embedding tags → { tags, source } — tags null when nothing could be read */
export async function installedTags({ tags = null, host = process.env.OLLAMA_HOST || 'http://localhost:11434', timeoutMs = 1500 } = {}) {
  const inj = tags != null ? tags : (process.env.VNA_LOCAL_MODELS_TAGS != null ? splitTags(process.env.VNA_LOCAL_MODELS_TAGS) : null);
  if (inj) return { tags: inj.filter((t) => !EMBED_RE.test(t)), source: 'injected' };
  try {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch(`${String(host).replace(/\/$/, '')}/api/tags`, { signal: ac.signal }); clearTimeout(tm);
    const j = await r.json();
    return { tags: ((j && j.models) || []).map((m) => String(m.name || m.model)).filter((t) => t && !EMBED_RE.test(t)), source: 'api/tags' };
  } catch { /* fall through to the CLI */ }
  try { return { tags: parseOllamaList(execFileSync('ollama', ['list'], { encoding: 'utf8', timeout: 5000 })).filter((t) => !EMBED_RE.test(t)), source: 'ollama list' }; } catch {}
  return { tags: null, source: 'unreadable' };
}

/** the subagent tag in force, read off the one selection file */
export function show() {
  const cfg = readEngineConfig();
  return { subagentModel: cfg.subagentModel, thinking: thinkingOf(cfg.subagentModel), preset: cfg.preset, engine: engineName(cfg), local: presetOf(cfg.preset)?.local === true, chatDefault: LOCAL_ROLES.chat, source: cfg.source };
}

export async function list(opts = {}) {
  const { tags, source } = await installedTags(opts); const cur = show();
  const all = [...new Set([...(tags || []), cur.subagentModel, LOCAL_ROLES.chat])];
  const rows = all.map((tag) => ({ tag, thinking: thinkingOf(tag), installed: tags ? tags.includes(tag) : null, subagent: tag === cur.subagentModel, chatDefault: tag === LOCAL_ROLES.chat }));
  return { source, rows, subagentModel: cur.subagentModel, chatDefault: LOCAL_ROLES.chat, preset: cur.preset };
}

/** set the subagent tag — writeEngineConfig, the dropdown's own door; refuses a tag that is not installed */
export async function use(tag, opts = {}) {
  const t = String(tag || '').trim();
  if (!t) return { ok: false, why: 'use <tag> — name an installed ollama tag' };
  const { tags, source } = await installedTags(opts);
  if (!tags) return { ok: false, why: `cannot read the installed tags (${source}) — is ollama running? A tag is only set when it is on disk` };
  if (!tags.includes(t)) return { ok: false, why: `${t} is not installed — installed: ${tags.join(', ') || 'none'}${t === NOTHINK_TAG ? ' (node scripts/vna/local-models.mjs build)' : ''}` };
  const r = writeEngineConfig({ subagentModel: t });
  return r.ok ? { ok: true, subagentModel: r.subagentModel, thinking: thinkingOf(r.subagentModel), preset: r.preset } : r;
}

/** C284's check, then ollama create — the only way the nothink tag is (re)built */
export function build() {
  const c = checkNothinkModelfile(readNothinkModelfile());
  if (!c.ok) return { ok: false, why: `the Modelfile is not a non-thinking build: ${c.fails.join(' · ')}` };
  const r = spawnSync('ollama', ['create', NOTHINK_TAG, '-f', NOTHINK_MODELFILE], { stdio: ['ignore', 'inherit', 'inherit'] });
  return r.status === 0 ? { ok: true, tag: NOTHINK_TAG, thinking: thinkingOf(NOTHINK_TAG) } : { ok: false, why: `ollama create exited ${r.status ?? r.error}` };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const json = argv.includes('--json');
  const ti = argv.indexOf('--tags'); const opts = ti >= 0 ? { tags: splitTags(argv[ti + 1]) } : {};
  const verb = argv[0] || 'list';
  const out = (o, text) => { console.log(json ? JSON.stringify(o) : text); if (o && o.ok === false) process.exitCode = 1; };
  if (verb === 'list') {
    const l = await list(opts);
    out(l, l.rows.length ? l.rows.map((r) => `${r.subagent ? '🤖' : '  '}${r.chatDefault ? '💬' : '  '} ${r.tag} · ${r.thinking}${r.installed === false ? ' — not installed' : ''}`).join('\n') + `\n(🤖 subagent tag in force · 💬 chat default — the chat's own pick lives in the extension · source ${l.source})` : `no local tags (${l.source})`);
  } else if (verb === 'show') {
    const s = show(); out(s, `🤖 ${s.subagentModel} · ${s.thinking} · engine ${s.engine}${s.local ? '' : ' (a cloud engine ignores the local tag until a local preset is picked)'}`);
  } else if (verb === 'use') {
    const r = await use(argv[1], opts); out(r, r.ok ? `🤖 subagent → ${r.subagentModel} · ${r.thinking} (engine ${r.preset})` : `refused — ${r.why}`);
  } else if (verb === 'build') {
    const r = build(); out(r, r.ok ? `built ${r.tag} · ${r.thinking}` : `refused — ${r.why}`);
  } else { console.error('usage: local-models.mjs list|show|use <tag>|build [--json] [--tags a,b]'); process.exitCode = 2; }
}
