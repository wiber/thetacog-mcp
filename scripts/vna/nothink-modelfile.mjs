// scripts/vna/nothink-modelfile.mjs — C284 THE NON-THINKING BUILD (U19 · D2b). `qwen3:8b-nothink` is the same qwen3:8b weights with
// thinking switched off IN THE TEMPLATE, because goose cannot send think:false (measured: 509 reasoning tokens through
// /v1/chat/completions with /no_think in the prompt). Operator 2026-09-25, verbatim: *"download and label the model non thinking in
// the dropdown"*. The build's source is config/ollama/qwen3-8b-nothink.Modelfile; this file is the ONE reading of whether that text is
// still a non-thinking build, as a pure function over the text so a guard can feed it a bad copy and see it go red.
//
// What "non-thinking" means here, construct by construct (never a grep for the word):
//   · FROM qwen3:8b — the same weights, nothing else
//   · the TEMPLATE has no `.Thinking` and no `IsThinkSet` branch — the model's own template decides thinking from the request;
//     a copy of it would hand the decision back to a client that cannot make it
//   · the last user turn carries /no_think — $lastUserIdx is the index of the last "user" message, and /no_think sits inside
//     `if eq $i $lastUserIdx`
//   · every reply opens on an EMPTY <think></think>, unconditionally — the generation prompt block is `if and (ne .Role "assistant")
//     $last` and the empty think follows the assistant header with no other directive between
//   · Qwen3's non-thinking sampling (model card): temperature 0.7 · top_p 0.8
// LLM-FREE: nothing here calls a model. `node scripts/vna/local-models.mjs build` runs this before it runs `ollama create`.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const NOTHINK_TAG = 'qwen3:8b-nothink';
export const NOTHINK_BASE = 'qwen3:8b';
export const NOTHINK_MODELFILE = resolve(HERE, '..', '..', 'config', 'ollama', 'qwen3-8b-nothink.Modelfile');

/** the TEMPLATE """…""" body, or null */
export function templateOf(text) {
  const m = /^TEMPLATE\s+"""([\s\S]*?)"""/m.exec(String(text || ''));
  return m ? m[1] : null;
}
/** PARAMETER name → [values] (stop repeats) */
export function parametersOf(text) {
  const out = {};
  const body = String(text || '').replace(/^TEMPLATE\s+"""[\s\S]*?"""/m, '');   // a PARAMETER line inside the template is not a parameter
  for (const m of body.matchAll(/^PARAMETER\s+(\S+)\s+(.+)$/gm)) (out[m[1]] ||= []).push(m[2].trim());
  return out;
}

/**
 * The C284 reading of a Modelfile's text → { ok, fails: [reason…] }. Pure; never reads a file, never calls ollama.
 */
export function checkNothinkModelfile(text) {
  const fails = [];
  const t = String(text || '');
  const from = /^FROM\s+(\S+)\s*$/m.exec(t);
  if (!from || from[1] !== NOTHINK_BASE) fails.push(`FROM is ${from ? from[1] : 'absent'} — the build must be FROM ${NOTHINK_BASE} (the same weights)`);
  const tpl = templateOf(t);
  if (tpl == null) { fails.push('no TEMPLATE """…""" block — the switch lives in the template'); return { ok: false, fails }; }
  if (/\.Thinking\b/.test(tpl)) fails.push('the TEMPLATE reads .Thinking — a thinking branch is back');
  if (/\bIsThinkSet\b/.test(tpl)) fails.push('the TEMPLATE reads IsThinkSet — the client decides thinking again, and goose cannot send think:false');
  // $lastUserIdx must be the index of the last user message …
  if (!/range \$idx, \$msg := \.Messages[\s\S]*?if eq \$msg\.Role "user"\s*\}\}\{\{\s*\$lastUserIdx = \$idx/.test(tpl)) fails.push('$lastUserIdx is not assigned from the last "user" message');
  // … and /no_think must sit inside the branch that fires on exactly that turn
  if (!/\{\{-?\s*if eq \$i \$lastUserIdx\s*\}\}\s*\/no_think\s*\{\{-?\s*end\s*-?\}\}/.test(tpl)) fails.push('/no_think is not on the last user turn (`if eq $i $lastUserIdx` → /no_think)');
  // the generation block opens the reply on an empty think with no directive between the header and it
  if (!/\{\{-?\s*if and \(ne \.Role "assistant"\) \$last\s*\}\}<\|im_start\|>assistant\n<think>\n\n<\/think>/.test(tpl)) fails.push('the reply does not open unconditionally on an empty <think>\\n\\n</think> after the assistant header');
  const P = parametersOf(t);
  const num = (k) => (P[k] && P[k].length ? Number(P[k][P[k].length - 1]) : NaN);
  if (num('temperature') !== 0.7) fails.push(`temperature is ${P.temperature ? P.temperature.join(',') : 'unset'} — Qwen3 non-thinking sampling is 0.7`);
  if (num('top_p') !== 0.8) fails.push(`top_p is ${P.top_p ? P.top_p.join(',') : 'unset'} — Qwen3 non-thinking sampling is 0.8`);
  return { ok: fails.length === 0, fails };
}

export const readNothinkModelfile = (path = NOTHINK_MODELFILE) => readFileSync(path, 'utf8');
