#!/usr/bin/env node
// scripts/vna/runner-resolver.mjs — C166 THE ENGINE IS A PRESET, NOT A HARDCODED SPAWN TARGET (unit 1 of
// docs/specs/vna/SPEC-MULTI-ENGINE.md). `claude -p` stays the default; goose, ollama and any shell template the operator
// types are the same door. This file owns the ONE preset table (the extension's ⚙️ Engines & Keys panel mirrors it and
// tests/vna/c166-engines-pill-secretstorage-and-sub-agent.test.mjs diffs the two), the interpolation, the selection
// file, and the exit-127 reading. It spawns nothing — steer-runner.mjs does, from what this returns.
//
// THE SELECTION IS NOT A SECRET; THE KEYS ARE. .thetacog/vna-engine.json holds { preset, customTemplate } and nothing else —
// writeEngineConfig drops every other field and REFUSES a template that carries a key (the clip daemon's SECRET_RE, one
// detector). The keys (ANTHROPIC_API_KEY · OPENROUTER_API_KEY · OLLAMA_HOST · CUSTOM_BEARER_TOKEN) live in VS Code
// SecretStorage only and reach the worker through its child env at spawn; this file never reads, writes or prints one.
//
// A TEMPLATE WITHOUT A PLACEHOLDER IS REFUSED (MISSING_SNOWBALL_PLACEHOLDER): a worker that is never handed the snowball runs
// on its own context, which is the leak the headless runner exists to remove.
//
// EXIT 127 IS A HALT WITH A NAME. `sh -c` answers 127 when the binary is not on PATH; the runner halts, writes the binary to
// runner.ndjson as missing_binary, and the unit is never read as UNMEASURED or green — a missing engine is a fact, not a gap.
//
//   node scripts/vna/runner-resolver.mjs status [--json]                 the active engine + the status-bar line
//   node scripts/vna/runner-resolver.mjs set --preset <id> [--template "<cmd with {snowball}>"] [--subagent-model <ollama tag>]
//   node scripts/vna/runner-resolver.mjs set --subagent-model <ollama tag>      (keeps the engine; C198)
//   node scripts/vna/runner-resolver.mjs set --claude-model sonnet|opus|haiku   (the --model every claude -p worker is pinned to; C215)
// LLM-FREE: nothing here calls a model.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isSecret } from './clip-watch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const ENGINE_JSON = (repo = REPO) => process.env.VNA_ENGINE_JSON || resolve(repo, '.thetacog/vna-engine.json');
export const RUNNER_NDJSON = (repo = REPO) => process.env.VNA_RUNNER_NDJSON || resolve(repo, '.thetacog/runner.ndjson');

// the four factory presets — id · template · the status-bar name · whether a run spends money. claude-code-headless carries the
// flags the runner has always passed (skip-permissions so a headless worker can commit, json so its usage/cost are facts).
export const PRESETS = Object.freeze([
  Object.freeze({ id: 'claude-code-headless', title: 'Claude Code (headless)', template: 'claude -p "{prompt}" --dangerously-skip-permissions --output-format json', engine: 'claude/claude -p', local: false }),
  Object.freeze({ id: 'goose-local', title: 'Goose (local Ollama: qwen2.5-coder:3b)', template: 'GOOSE_PROVIDER=ollama GOOSE_MODEL=qwen2.5-coder:3b GOOSE_MODE=auto goose run --no-session --text "{prompt}"', engine: 'goose/qwen2.5-coder:3b', local: true }),
  Object.freeze({ id: 'ollama-local', title: 'Ollama (qwen2.5-coder:3b)', template: 'ollama run qwen2.5-coder:3b "{prompt}"', engine: 'ollama/qwen2.5-coder:3b', local: true }),
  Object.freeze({ id: 'custom-command', title: 'Custom command', template: null, engine: 'custom', local: null }),
]);
export const DEFAULT_PRESET = 'claude-code-headless';
// C168g — A DISPATCH ENGINE MUST BE AN AGENT THAT CAN COMMIT; A BARE MODEL IS FOR CHAT ONLY. `ollama run <tag> "{prompt}"`
// prints text and has no tools — it can never pass gate one (HEAD must move, steer-runner.mjs gradeCommit), so it is never
// spawned as a DISPATCH worker (steer-runner.mjs run() halts before ever building a brief for it). The preset entry itself
// stays on PRESETS (the knob still turns, .thetacog/vna-engine.json still names it, checkDriver/applyDriver still resolve
// it) because it is the chat-only door's name for a bare model — nothing here deletes it, only run() refuses to spend a
// dispatch on it. goose-local is the local DISPATCH path (tools via the `developer` extension, C213).
export const CHAT_ONLY_PRESETS = Object.freeze(['ollama-local']);
export const canDispatch = (id) => { const p = presetOf(id); return !!p && !CHAT_ONLY_PRESETS.includes(p.id); };
// C198 — THE LOCAL-MODEL CONVENTION, ITS ONE HOME (operator 2026-09-23: "use gemma for control chat and qwen for subagents if
// needed by default) settable in engine keys"). The control chat (💬 Local Ideation, media/chat-core.js FALLBACK_MODEL) asks for
// gemma; a LOCAL subagent preset (goose-local · ollama-local) runs qwen. Both are defaults, never locks: the chat tag is picked on
// ⚙️ Engine & Keys (vna.setChatModel → the chat's own globalState key) and the subagent tag is `set --subagent-model <tag>` here.
// chat-core.js is a browser UMD file and cannot import this; tests/vna/c198-*.test.mjs diffs the two so they never drift.
export const LOCAL_ROLES = Object.freeze({ chat: 'gemma2:2b', subagent: 'qwen2.5-coder:3b' });
const TAG_RE = /^[A-Za-z0-9][\w.\-/]*(:[\w.\-]+)?$/;   // an ollama tag — name[:tag], nothing a shell would read
// C285 — WHICH LOCAL TAGS THINK, ITS ONE HOME (operator 2026-09-25, verbatim: *"download and label the model non thinking in the
// dropdown"* · *"make it editable by cli"*). First match wins, so a build that switches thinking off (-nothink, C284) or an instruct
// cut is read before its family. Both dropdowns (⚙️ Engine & Keys · the 💬 chat's 🤖) label a tag from THIS table — `status --json`
// carries it as `thinkingRules` and the extension applies it; scripts/vna/local-models.mjs lists through thinkingOf. Never a second
// table in TS or in a webview. A tag the table does not know reads `unknown`, never a guess.
export const THINKING_RULES = Object.freeze([
  Object.freeze({ re: '-nothink(:|$)', label: 'non-thinking' }),          // the same weights, thinking off in the TEMPLATE (C284)
  Object.freeze({ re: '(-instruct|instruct-2507)', label: 'non-thinking' }),
  Object.freeze({ re: '^(qwen3|gpt-oss|deepseek-r1)', label: 'thinking' }),
  Object.freeze({ re: '^(qwen2\\.5|gemma|llama)', label: 'non-thinking' }),
]);
export const THINKING_LABELS = Object.freeze(['thinking', 'non-thinking', 'unknown']);
/** 'thinking' | 'non-thinking' | 'unknown' for an ollama tag — the ONE reading (a registry path prefix like hf.co/x/ is dropped) */
export function thinkingOf(tag) {
  const t = String(tag || '').trim().toLowerCase().replace(/^.*\//, '');
  if (!t) return 'unknown';
  for (const r of THINKING_RULES) if (new RegExp(r.re, 'i').test(t)) return r.label;
  return 'unknown';
}
/** { tag: label } for a list of tags */
export const thinkingMap = (tags) => Object.fromEntries([...new Set((tags || []).filter(Boolean).map(String))].map((t) => [t, thinkingOf(t)]));
// C215 — A claude -p WORKER ALWAYS RUNS A NAMED MODEL. Before this, WORKER_ARGS carried no --model, so every /steer worker inherited
// the interactive default (the $665 foot-gun: scheduled-claude--p-must-pin). The pick is one of these; sonnet is the default.
export const CLAUDE_MODELS = Object.freeze(['sonnet', 'opus', 'haiku']);
export const DEFAULT_CLAUDE_MODEL = 'sonnet';
export const isClaudeModel = (m) => CLAUDE_MODELS.includes(String(m || '')) || /^claude-[a-z0-9.-]{3,60}$/.test(String(m || ''));
export const isModelTag = (t) => TAG_RE.test(String(t || '')) && String(t).length <= 80;
// the spec's red witness writes selectedPreset 'custom'; the pill writes 'custom-command' — one preset, two spellings accepted
const ALIAS = { custom: 'custom-command', claude: 'claude-code-headless', goose: 'goose-local', ollama: 'ollama-local' };
export const presetOf = (id) => PRESETS.find((p) => p.id === (ALIAS[id] || id)) || null;
// the keys the pill stores — names only; the values never pass through this file
export const SECRET_NAMES = Object.freeze(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_HOST', 'CUSTOM_BEARER_TOKEN']);
export const PLACEHOLDER_RE = /\{(snowball|prompt|target_files)\}/;

// ── C166a THE PILL'S KEYS ARE THE ONLY KEYS A SUB-AGENT RUNS ON, AND EVERY DISPATCH ROW PROVES ITS COST. The extension names the keys it
// injected from SecretStorage in VNA_ENGINE_KEYS (names only — vna-engines.ts engineSecretEnv). keyedEnv() is the one door every worker
// env passes through: a SECRET_NAMES value the pill did not inject is DROPPED (it came from the operator's shell), and the row gets the
// provenance — key_source · key_names · key_fp (sha256, 12 hex: computable from the key the billing console lists, never the key) ·
// shell_keys_dropped. rowRed() is the one judgment: a non-local dispatch is red when its key did not come from SecretStorage or when
// the worker reported no cost/usage of its own. Known limit, named: VNA_ENGINE_KEYS is a declaration by the spawner — a shell that
// sets it by hand is believed; what it cannot do is make a shell key ride along silently under a pill-less dispatch.
export const ENGINE_KEYS_ENV = 'VNA_ENGINE_KEYS';
export const keyFp = (v) => 'sha256:' + createHash('sha256').update(String(v)).digest('hex').slice(0, 12);
export function keyedEnv(base = {}) {
  const pill = new Set(String(base[ENGINE_KEYS_ENV] || '').split(',').map((x) => x.trim()).filter((n) => SECRET_NAMES.includes(n)));
  const env = {}; const dropped = []; const names = []; const fp = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === ENGINE_KEYS_ENV) continue;
    if (SECRET_NAMES.includes(k)) { if (!pill.has(k) || !v) { if (v) dropped.push(k); continue; } names.push(k); fp[k] = keyFp(v); }
    env[k] = v;
  }
  return { env, provenance: { key_source: names.length ? 'secretstorage' : 'none', key_names: names.sort(), key_fp: fp, shell_keys_dropped: dropped.sort() } };
}
/** the one judgment of a dispatch row. A row with no preset predates the engine table (C166) and is not judged; nor is a missing binary. */
export function rowRed(row) {
  if (!row || (row.kind !== 'worker' && row.kind !== 'verdict') || !row.preset || row.missing_binary) return { judged: false, red: false, why: [] };   // a binary that never started spent nothing
  const p = presetOf(row.preset); const why = [];
  if (p && p.local === true) { if (row.cost_usd !== 0) why.push('a local preset row must carry cost_usd 0'); return { judged: true, red: why.length > 0, why }; }
  if (row.key_source !== 'secretstorage') why.push(`key_source ${row.key_source || 'absent'} — the worker did not run on a ⚙️ Engines & Keys key`);
  if (typeof row.cost_usd !== 'number') why.push('no cost_usd reported by the worker');
  if (!row.usage) why.push('no usage reported by the worker');
  return { judged: true, red: why.length > 0, why };
}

// POSIX single-quote a value unless it is plainly safe — a snowball path with a space must stay one argv word
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
// inside a template's own "…" the value is escaped for a double-quoted shell word ($ ` \ " and ! stay literal)
const dq = (s) => String(s).replace(/([\\"$`])/g, '\\$1');

/**
 * The shell command for one dispatch. `config` = { selectedPreset | preset, customTemplate }; `snowballPath` is the file the
 * worker is handed. {snowball} → the path, {prompt} → the prompt (default: the snowball path, so a preset that takes an
 * instruction string is told where the contract is), {target_files} → the unit's paths, space-joined.
 * Throws MISSING_SNOWBALL_PLACEHOLDER when the template names neither {snowball} nor {prompt}; UNKNOWN_PRESET on a bad id.
 */
export function resolveEngineCommand(config, snowballPath, { prompt = null, targetFiles = [] } = {}) {
  const id = (config && (config.selectedPreset || config.preset)) || DEFAULT_PRESET;
  const p = presetOf(id); if (!p) throw new Error(`UNKNOWN_PRESET: ${id} — one of ${PRESETS.map((x) => x.id).join(' · ')}`);
  let template = String((p.template || (config && config.customTemplate)) || '').trim();
  template = withSubagentModel(p, template, config && config.subagentModel);
  if (!/\{(snowball|prompt)\}/.test(template)) throw new Error(`MISSING_SNOWBALL_PLACEHOLDER: the ${p.id} template "${template}" names neither {snowball} nor {prompt} — the worker would never be handed the contract`);
  const pr = prompt == null ? String(snowballPath) : String(prompt);
  return template.replace(/(")?\{(snowball|prompt|target_files)\}(")?/g, (m, open, key, close) => {
    const v = key === 'snowball' ? String(snowballPath) : key === 'prompt' ? pr : (targetFiles || []).join(' ');
    if (open && close) return `"${dq(v)}"`;
    return `${open || ''}${key === 'target_files' ? (targetFiles || []).map(shq).join(' ') : shq(v)}${close || ''}`;
  });
}

/**
 * C198: a local preset's template with the operator's subagent tag in place of the convention's default. ollama-local names the
 * tag on its argv; goose-local names it in its own GOOSE_MODEL= prefix (C213 — goose 1.50 has no config on this machine, so the template
 * carries provider, model and auto-mode itself, and takes --text: --instruction was never a goose flag), swapped only when the tag differs from
 * the default — the default template stays byte-identical. A cloud or custom preset is never touched; a malformed tag is ignored.
 */
export function withSubagentModel(p, template, tag) {
  if (!p || p.local !== true || !tag || tag === LOCAL_ROLES.subagent || !isModelTag(tag)) return template;
  if (p.id === 'ollama-local') return template.split(LOCAL_ROLES.subagent).join(tag);
  if (p.id === 'goose-local') return template.split(LOCAL_ROLES.subagent).join(tag);   // C213: the template names GOOSE_MODEL itself (goose has no config here) — swapped in place, never a second GOOSE_MODEL= that the first would shadow
  return template;
}

/** the first word of a resolved command — what `sh` names when it answers 127 */
export const binaryOf = (cmd) => { const m = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*("([^"]+)"|'([^']+)'|(\S+))/.exec(String(cmd || '')); return m ? (m[2] || m[3] || m[4]) : null; };
/**
 * exit 127 (sh: command not found) or a spawn ENOENT → { missing: true, binary }. The stderr's own `sh: <x>: command not found`
 * wins over the template's first word (a wrapper script can be present and call a missing tool).
 */
export function missingBinary({ exit, spawnError = null, stderr = '', cmd = '' }) {
  const enoent = spawnError && /ENOENT/.test(String(spawnError));
  if (exit !== 127 && !enoent) return { missing: false, binary: null };
  const said = /(?:^|\n)(?:[^:\n]*:\s*)?(?:line \d+:\s*)?([^:\s]+): (?:command )?not found/.exec(String(stderr || ''));
  return { missing: true, binary: (said && said[1]) || binaryOf(cmd) || 'UNKNOWN' };
}

/** the selection on disk, or the default. Fields other than preset/customTemplate are ignored — never a key. */
export function readEngineConfig(repo = REPO) {
  let j = null; try { j = JSON.parse(readFileSync(ENGINE_JSON(repo), 'utf8')); } catch {}
  const preset = j && presetOf(j.preset || j.selectedPreset) ? presetOf(j.preset || j.selectedPreset).id : DEFAULT_PRESET;
  const customTemplate = j && typeof j.customTemplate === 'string' ? j.customTemplate : '';
  const subagentModel = j && isModelTag(j.subagentModel) ? j.subagentModel : LOCAL_ROLES.subagent;   // C198
  const claudeModel = j && isClaudeModel(j.claudeModel) ? j.claudeModel : DEFAULT_CLAUDE_MODEL;   // C215
  return { preset, customTemplate, subagentModel, claudeModel, source: j ? 'file' : 'default' };
}
/** the one writer of the selection file — refuses a template carrying a key, drops every field it does not own */
export function writeEngineConfig({ preset, customTemplate = '', subagentModel, claudeModel } = {}, repo = REPO) {
  const cur = readEngineConfig(repo);
  if (!preset) { preset = cur.preset; if (cur.preset === 'custom-command' && !customTemplate) customTemplate = cur.customTemplate; }   // C198: `set --subagent-model` alone keeps the engine
  const p = presetOf(preset); if (!p) return { ok: false, why: `UNKNOWN_PRESET: ${preset}` };
  const sm = subagentModel == null || subagentModel === '' ? cur.subagentModel : String(subagentModel).trim();
  if (!isModelTag(sm)) return { ok: false, why: `BAD_MODEL_TAG: "${sm}" is not an ollama tag (name[:tag])` };
  const cm = claudeModel == null || claudeModel === '' ? cur.claudeModel : String(claudeModel).trim();   // C215: the pin survives every other set
  if (!isClaudeModel(cm)) return { ok: false, why: `BAD_CLAUDE_MODEL: "${cm}" — one of ${CLAUDE_MODELS.join(' · ')} or a claude-* id` };
  const t = String(customTemplate || '').trim();
  if (isSecret(t)) return { ok: false, why: 'the template carries what looks like a key — keys go in 🔑 SecretStorage and reach the worker through its env, never the template' };
  if (p.id === 'custom-command' && !/\{(snowball|prompt)\}/.test(t)) return { ok: false, why: `MISSING_SNOWBALL_PLACEHOLDER: a custom command must name {snowball} or {prompt}` };
  const row = { preset: p.id, customTemplate: p.id === 'custom-command' ? t : '', subagentModel: sm, claudeModel: cm, at: new Date().toISOString() };
  mkdirSync(dirname(ENGINE_JSON(repo)), { recursive: true }); writeFileSync(ENGINE_JSON(repo), JSON.stringify(row, null, 2) + '\n');
  return { ok: true, ...row };
}

/** the engine's name for the status bar: goose/qwen2.5-coder:3b · custom/<binary> */
export function engineName(cfg = readEngineConfig()) {
  const p = presetOf(cfg.preset) || presetOf(DEFAULT_PRESET);
  if (p.id === 'custom-command') return `custom/${binaryOf(cfg.customTemplate) || '—'}`;
  if (p.id === DEFAULT_PRESET) return `${p.engine} · ${cfg.claudeModel || DEFAULT_CLAUDE_MODEL}`;   // C215: the pinned model is in the name
  return p.local === true && cfg.subagentModel && isModelTag(cfg.subagentModel) ? p.engine.replace(LOCAL_ROLES.subagent, cfg.subagentModel) : p.engine;   // C198
}
/**
 * `[Runner: goose/qwen2.5-coder:3b · Local $0.00]`. A local preset spends $0.00 by construction; a cloud one prints the sum of the
 * workers' OWN reported cost_usd on today's runner.ndjson rows (UTC day), and `API $ UNMEASURED` when no row reported one —
 * never an estimate. A custom command's billing is unknown to us: `cost UNMEASURED` until its rows carry a cost.
 */
export function statusLine({ repo = REPO, cfg = readEngineConfig(repo), now = new Date() } = {}) {
  const p = presetOf(cfg.preset) || presetOf(DEFAULT_PRESET); const name = engineName(cfg);
  if (p.local) return { name, preset: p.id, local: true, cost_usd: 0, line: `[Runner: ${name} · Local $0.00]` };
  const day = now.toISOString().slice(0, 10); let sum = 0, rows = 0, red = 0;
  try { for (const l of readFileSync(RUNNER_NDJSON(repo), 'utf8').split('\n')) { if (!l.includes(day)) continue; let r; try { r = JSON.parse(l); } catch { continue; } if (String(r.at || '').slice(0, 10) !== day) continue; if (rowRed(r).red) red++; if ((r.kind === 'verdict' || r.kind === 'worker') && typeof r.cost_usd === 'number') { sum += r.cost_usd; rows++; } } } catch {}
  const cost = rows ? `$${sum.toFixed(2)}` : '$ UNMEASURED';
  return { name, preset: p.id, local: p.local === null ? null : false, cost_usd: rows ? +sum.toFixed(4) : null, cost_rows: rows, red_rows: red, line: `[Runner: ${name} · ${p.local === null ? 'Custom' : 'API'} ${cost}${red ? ` · ${red} red` : ''}]` };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (argv[0] === 'set') {
    const r = writeEngineConfig({ preset: arg('--preset'), customTemplate: arg('--template') || '', subagentModel: arg('--subagent-model'), claudeModel: arg('--claude-model') });
    console.log(argv.includes('--json') ? JSON.stringify(r) : r.ok ? `engine → ${r.preset}${r.customTemplate ? ` · ${r.customTemplate}` : ''} · ${statusLine().line}` : `refused — ${r.why}`);
    process.exit(r.ok ? 0 : 1);
  }
  const cfg = readEngineConfig(); const s = statusLine({ cfg });
  const p = presetOf(cfg.preset); const template = withSubagentModel(p, p.template || cfg.customTemplate, cfg.subagentModel);
  console.log(argv.includes('--json') ? JSON.stringify({ ...s, template, presets: PRESETS, secretNames: SECRET_NAMES, source: cfg.source, subagentModel: cfg.subagentModel, claudeModel: cfg.claudeModel, claudeModels: CLAUDE_MODELS, localRoles: LOCAL_ROLES, thinkingRules: THINKING_RULES, thinking: thinkingMap([cfg.subagentModel, LOCAL_ROLES.chat, LOCAL_ROLES.subagent]) }) : `${s.line} · ${p.id} · ${template}`);
}
