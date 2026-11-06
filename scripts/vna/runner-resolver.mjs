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
import { execFileSync } from 'node:child_process';   // C1200: the live runner off the process table
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
// C484 — THE ENGINE BUTTONS CARRY THE BIG MODELS, AND THE FREE-ON-WEB ONES (operator 2026-09-29, verbatim: *"add more llm choices to
// the buttons, expecially the big ones"* · *"free on web?"* · *"deepseek is free?"*). Two kinds of choice, beside the factory PRESETS
// (which stay the runner's four — C166 pins them):
//   kind 'cli' — a big Claude model by its exact id, run through the ONE claude -p path (claude-code-headless + `--model <id>`, the
//     C215 pin), so the worker keeps the runner's own args and read set; never a second claude template that would drift from it.
//   kind 'web-handoff' — a free web chat. It copies the prompt and opens the chat (the prompt in the URL where the site reads one,
//     clipboard + open where it does not). It costs nothing, needs no key, spawns nothing and returns no commit, so it can never tick a
//     row and is never a /steer driver (checkDriver refuses it with WEB_HANDOFF). A non-Anthropic model is named by its web product,
//     never by a guessed API id. `status` is what one bounded curl answered on 2026-09-29 (a bot-walled 403 is still a live site).
// packages/thetacog-mcp-vscode/src/vna-engines.ts ENGINE_CHOICES mirrors this table; tests/vna/c484-*.test.mjs diffs the two.
export const CLAUDE_BIG_MODELS = Object.freeze(['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001']);
const CLAUDE_TITLE = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5': 'Claude Sonnet 5', 'claude-fable-5-1': 'Claude Fable 5.1', 'claude-haiku-4-5-20251001': 'Claude Haiku 4.5' };
export const WEB_HANDOFFS = Object.freeze([
  Object.freeze({ id: 'chatgpt-web', title: 'ChatGPT (free on web)', url: 'https://chatgpt.com/', prefill: 'https://chatgpt.com/?q={q}', status: 403 }),
  Object.freeze({ id: 'claude-web', title: 'Claude (free on web)', url: 'https://claude.ai/new', prefill: 'https://claude.ai/new?q={q}', status: 403 }),
  Object.freeze({ id: 'gemini-web', title: 'Gemini (free on web)', url: 'https://gemini.google.com/app', prefill: null, status: 200 }),
  Object.freeze({ id: 'deepseek-web', title: 'DeepSeek (free on web)', url: 'https://chat.deepseek.com/', prefill: null, status: 202 }),
  Object.freeze({ id: 'grok-web', title: 'Grok (free on web)', url: 'https://grok.com/', prefill: 'https://grok.com/?q={q}', status: 200 }),
  Object.freeze({ id: 'perplexity-web', title: 'Perplexity (free on web)', url: 'https://www.perplexity.ai/', prefill: 'https://www.perplexity.ai/search/new?q={q}', status: 403 }),
  Object.freeze({ id: 'copilot-web', title: 'Microsoft Copilot (free on web)', url: 'https://copilot.microsoft.com/', prefill: null, status: 200 }),   // ?q= no longer fills the box (late 2025) — clipboard + open
  Object.freeze({ id: 'mistral-web', title: 'Mistral Le Chat (free on web)', url: 'https://chat.mistral.ai/chat', prefill: 'https://chat.mistral.ai/chat?q={q}', status: 403 }),
]);
// C940 — A THIRD-PARTY CODING AGENT IS A NAMED TEMPLATE ON THE CUSTOM DOOR, NEVER A FIFTH PRESET (operator 2026-10-17, verbatim:
// *"is it a drop in replacement for claude code … can we support it out of the box in steer vscode?"* · *"prepare what we can to
// integrate this - fill in the blanks"*). kind 'agent' = a headless coding CLI that edits, runs shell and commits, so it can pass gate
// one; a click writes the custom-command preset with THIS template (the four factory presets stay C166's four). The flags are the
// vendor's documented ones as read on 2026-10-17 (`source`); a flag nobody has run here is UNMEASURED until a dispatch row carries it.
// Its cost is the worker's own report or nothing: costOf reads Claude's field names, so a Grok row reads cost UNMEASURED until one real
// `--output-format json` result has been read and its fields named — never a price table multiplied here.
export const AGENT_CLIS = Object.freeze([
  Object.freeze({ id: 'grok-build-headless', title: 'Grok Build (grok -p, xAI)', binary: 'grok', keyName: 'XAI_API_KEY',
    template: 'grok -p "{prompt}" --always-approve --trust --output-format json',
    source: 'xAI Grok Build docs as read 2026-10-17: -p headless · --always-approve · --output-format plain|json|streaming-json · --trust (project hooks + MCP trusted for the run) · reads AGENTS.md, CLAUDE.md and .claude/rules/ · hooks from .grok/hooks/*.json (C941 derives ours from .claude/settings.json) with SessionStart · UserPromptSubmit · PreToolUse · PostToolUse · Stop · PreCompact and more · subagents use git worktrees (never on this tree) · no documented turn cap',
    unmeasured: Object.freeze(['json result field names (cost, tokens)', 'turn cap', 'tool names the Bash / Edit|Write matchers meet', 'the UserPromptSubmit prompt field and how stdout reaches the model', 'land rate on the runner ledger']) }),
]);
export const agentOf = (id) => AGENT_CLIS.find((a) => a.id === String(id || '')) || null;
export const ENGINE_CHOICES = Object.freeze([
  ...PRESETS.map((p) => Object.freeze({ id: p.id, title: p.title, kind: 'runner', preset: p.id, claudeModel: null, url: null, prefill: null })),
  ...CLAUDE_BIG_MODELS.map((m) => Object.freeze({ id: m, title: `${CLAUDE_TITLE[m]} (claude -p --model ${m})`, kind: 'cli', preset: DEFAULT_PRESET, claudeModel: m, url: null, prefill: null })),
  ...AGENT_CLIS.map((a) => Object.freeze({ id: a.id, title: a.title, kind: 'agent', preset: 'custom-command', claudeModel: null, url: null, prefill: null })),
  ...WEB_HANDOFFS.map((w) => Object.freeze({ id: w.id, title: w.title, kind: 'web-handoff', preset: null, claudeModel: null, url: w.url, prefill: w.prefill })),
]);
export const choiceOf = (id) => ENGINE_CHOICES.find((c) => c.id === String(id || '')) || null;
export const isWebHandoff = (id) => { const c = choiceOf(id); return !!c && c.kind === 'web-handoff'; };
export const HANDOFF_PREFILL_MAX = 2000;   // a prompt longer than this goes by clipboard only — a URL that long is truncated by some browsers
/** pure: { url, prefilled, copy } — the URL a handoff opens and the text it copies. The prompt always goes to the clipboard; it rides
 * in the URL too when the site reads one and it fits. Throws NOT_A_WEB_HANDOFF for any other id. */
export function handoffUrl(id, prompt = '') {
  const c = choiceOf(id); if (!c || c.kind !== 'web-handoff') throw new Error(`NOT_A_WEB_HANDOFF: ${id}`);
  const p = String(prompt || '').trim();
  const prefilled = !!(c.prefill && p && p.length <= HANDOFF_PREFILL_MAX);
  return { url: prefilled ? c.prefill.replace('{q}', encodeURIComponent(p)) : c.url, prefilled, copy: p };
}
/** the named refusal a web handoff gets anywhere a runner or a /steer driver is asked for */
export const webHandoffRefusal = (id) => `WEB_HANDOFF: ${id} is a free web chat — it is handed the prompt (clipboard + open), it spawns no worker and returns no commit, so it can never run /steer or tick a row; pick claude-code-headless, a claude-* model or goose-local`;
export const isModelTag = (t) => TAG_RE.test(String(t || '')) && String(t).length <= 80;
// the spec's red witness writes selectedPreset 'custom'; the pill writes 'custom-command' — one preset, two spellings accepted
const ALIAS = { custom: 'custom-command', claude: 'claude-code-headless', goose: 'goose-local', ollama: 'ollama-local' };
export const presetOf = (id) => PRESETS.find((p) => p.id === (ALIAS[id] || id)) || null;
// the keys the pill stores — names only; the values never pass through this file
export const SECRET_NAMES = Object.freeze(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_HOST', 'CUSTOM_BEARER_TOKEN', 'XAI_API_KEY']);   // C940: grok -p reads XAI_API_KEY
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
  if (isWebHandoff(id)) throw new Error(webHandoffRefusal(id));   // C484: a web chat is handed the prompt, never spawned
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
// C410 — THE PROMOTION FLOOR: THE LIVE LOCAL ENGINE READS THE BENCH, AND ONLY WHEN THE BENCH BEATS THE INCUMBENT (operator 2026-09-28,
// verbatim: *"can it be wired up end to end? for the mutate /goal in gemma and /steer in qwen"*). data/vna/local-arm-floor.json is
// written by `node scripts/vna/mutate-until.mjs --promote` (and at the end of every mutate-until run): the best local ARM (model ·
// brief variant · dial) by the Wilson 95 % LOWER bound of landed / valid trials over both ledgers (replay-bench.ndjson +
// mutate-until.ndjson), and `scores` per MODEL pooled (the live engine has no variant knob). The floor's lower bound only rises.
// readEngineConfig swaps the subagent tag for the floor's model only when the floor's lower bound is above the incumbent tag's own
// pooled lower bound on the same record, and stamps subagent_by: 'local-arm-floor'. A floor with nothing landed (arm null) changes
// nothing — an unmeasured promotion is not a promotion. Port row C410p: the promotion decides, so it moves to the crate once one arm has landed.
export const ARM_FLOOR = (repo = REPO) => process.env.VNA_ARM_FLOOR || resolve(repo, 'data/vna/local-arm-floor.json');
export function readArmFloor(repo = REPO) { try { return JSON.parse(readFileSync(ARM_FLOOR(repo), 'utf8')); } catch { return null; } }
/** pure: { model, by, why } — the tag the live local engine runs, given the config's tag and the floor */
export function promotedSubagent(incumbent, floor) {
  if (!floor || !floor.arm || !isModelTag(floor.arm.model) || !Array.isArray(floor.wilson95)) return { model: incumbent, by: 'config', why: 'no landed arm on the floor' };
  const lb = (m) => { const s = (floor.scores || []).find((x) => x.model === m); return s && Array.isArray(s.wilson95) ? s.wilson95[0] : 0; };
  if (floor.arm.model === incumbent) return { model: incumbent, by: 'config', why: 'the floor names the incumbent' };
  const f = floor.wilson95[0], i = lb(incumbent);
  return f > i ? { model: floor.arm.model, by: 'local-arm-floor', why: `the floor's lower bound ${f} is above the incumbent's ${i}` } : { model: incumbent, by: 'config', why: `the floor's lower bound ${f} is not above the incumbent's ${i}` };
}
export function readEngineConfig(repo = REPO) {
  let j = null; try { j = JSON.parse(readFileSync(ENGINE_JSON(repo), 'utf8')); } catch {}
  // C334a: a /steer run pins its engine through VNA_ENGINE_PRESET (steer.mjs applyDriver) so it never has to write this file,
  // which is the chat's selection; the pin wins for that process tree only.
  const pin = presetOf(process.env.VNA_ENGINE_PRESET || '');
  const preset = pin ? pin.id : j && presetOf(j.preset || j.selectedPreset) ? presetOf(j.preset || j.selectedPreset).id : DEFAULT_PRESET;
  // C940: a /steer --driver <agent choice> pins the custom template for its own process tree (VNA_ENGINE_TEMPLATE), never the file
  const tplPin = pin && pin.id === 'custom-command' && /\{(snowball|prompt)\}/.test(process.env.VNA_ENGINE_TEMPLATE || '') ? process.env.VNA_ENGINE_TEMPLATE : null;
  const customTemplate = tplPin || (j && typeof j.customTemplate === 'string' ? j.customTemplate : '');
  const configured = j && isModelTag(j.subagentModel) ? j.subagentModel : LOCAL_ROLES.subagent;   // C198
  const pr = presetOf(preset) && presetOf(preset).local === true ? promotedSubagent(configured, readArmFloor(repo)) : { model: configured, by: 'config', why: 'not a local preset' };   // C410
  // C484: a /steer --driver <claude-* choice> pins the model for its own process tree the same way (VNA_CLAUDE_MODEL), never the file
  const claudeModel = isClaudeModel(process.env.VNA_CLAUDE_MODEL) ? process.env.VNA_CLAUDE_MODEL : j && isClaudeModel(j.claudeModel) ? j.claudeModel : DEFAULT_CLAUDE_MODEL;   // C215
  return { preset, customTemplate, subagentModel: pr.model, subagent_by: pr.by, claudeModel, source: pin ? 'pin' : j ? 'file' : 'default' };
}
/** the one writer of the selection file — refuses a template carrying a key, drops every field it does not own */
export function writeEngineConfig({ preset, customTemplate = '', subagentModel, claudeModel } = {}, repo = REPO) {
  const cur = readEngineConfig(repo);
  if (preset && isWebHandoff(preset)) return { ok: false, why: webHandoffRefusal(preset) };   // C484: never the runner's engine
  const ch = preset && !presetOf(preset) ? choiceOf(preset) : null;   // C484: a big Claude model is the claude -p preset pinned to its id
  if (ch && ch.kind === 'cli') { preset = ch.preset; if (claudeModel == null || claudeModel === '') claudeModel = ch.claudeModel; }
  if (ch && ch.kind === 'agent') { preset = ch.preset; customTemplate = agentOf(ch.id).template; }   // C940: the agent's own template on the custom door
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
// C1200 (operator 2026-10-22, on a ⚙️🔑 pill and a status bar reading goose/qwen3:8b while the live worker was claude -p:
// "very worrying that local llm is running? clearly this is an active session"): the engine file is the IDE chat's
// preset; a /steer started anywhere else runs DEFAULT_PRESET (steer.mjs checkDriver). While a worker is live the line
// names the engine its run row recorded — the worker actually spawned — never the file. Live is read off the process
// table (a steer-runner.mjs alive with --label L), never off file order: two runners interleave rows in one runner.ndjson.
export function liveRunnerLabels({ ps = null } = {}) {
  let out = ps; if (out == null) { try { out = execFileSync('ps', ['-Ao', 'command'], { encoding: 'utf8', timeout: 2000 }); } catch { return []; } }
  return String(out).split('\n').filter((l) => /node\S*\s+\S*steer-runner\.mjs/.test(l)).map((l) => { const m = l.match(/--label\s+(\S+)/); return m ? m[1] : null; });
}
export function liveRun(repo = REPO, { labels = liveRunnerLabels() } = {}) {
  if (!labels.length) return null;
  let rows; try { rows = readFileSync(RUNNER_NDJSON(repo), 'utf8').trim().split('\n').slice(-400).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; }
  const run = rows.filter((r) => r.kind === 'run' && r.preset && (labels.includes(r.label) || labels.includes(null))).pop();
  return run ? { preset: run.preset, engine: run.engine || run.preset, label: run.label || null, at: run.at } : null;
}
export function statusLine({ repo = REPO, cfg = readEngineConfig(repo), now = new Date(), live = liveRun(repo) } = {}) {
  if (live && live.preset !== cfg.preset && presetOf(live.preset)) cfg = { ...cfg, preset: live.preset, subagentModel: null };
  const p = presetOf(cfg.preset) || presetOf(DEFAULT_PRESET); const name = live && live.preset === p.id ? `${live.engine} · running` : engineName(cfg);
  if (p.local) return { name, preset: p.id, local: true, cost_usd: 0, live, line: `[Runner: ${name} · Local $0.00]` };
  const day = now.toISOString().slice(0, 10); let sum = 0, rows = 0, red = 0;
  try { for (const l of readFileSync(RUNNER_NDJSON(repo), 'utf8').split('\n')) { if (!l.includes(day)) continue; let r; try { r = JSON.parse(l); } catch { continue; } if (String(r.at || '').slice(0, 10) !== day) continue; if (rowRed(r).red) red++; if ((r.kind === 'verdict' || r.kind === 'worker') && typeof r.cost_usd === 'number') { sum += r.cost_usd; rows++; } } } catch {}
  const cost = rows ? `$${sum.toFixed(2)}` : '$ UNMEASURED';
  return { name, preset: p.id, live, local: p.local === null ? null : false, cost_usd: rows ? +sum.toFixed(4) : null, cost_rows: rows, red_rows: red, line: `[Runner: ${name} · ${p.local === null ? 'Custom' : 'API'} ${cost}${red ? ` · ${red} red` : ''}]` };
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
  console.log(argv.includes('--json') ? JSON.stringify({ ...s, template, presets: PRESETS, engineChoices: ENGINE_CHOICES, secretNames: SECRET_NAMES, source: cfg.source, subagentModel: cfg.subagentModel, claudeModel: cfg.claudeModel, claudeModels: [...CLAUDE_MODELS, ...CLAUDE_BIG_MODELS], localRoles: LOCAL_ROLES, thinkingRules: THINKING_RULES, thinking: thinkingMap([cfg.subagentModel, LOCAL_ROLES.chat, LOCAL_ROLES.subagent]) }) : `${s.line} · ${p.id} · ${template}`);
}
