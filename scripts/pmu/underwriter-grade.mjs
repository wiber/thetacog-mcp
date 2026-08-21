#!/usr/bin/env node
// scripts/pmu/underwriter-grade.mjs — the lightswitch grader.
//
// We optimise for ONE thing: the lightswitch moment — a reinsurance underwriter sees the
// result and BUYS IN. This runs Gemini AS that underwriter and grades the artifact on the
// triple, each 0–100: PREDICTIVE POWER (does the signal predict the violation distribution
// it would reinsure against?), IMPACT (is the exposure worth pricing — is the market real?),
// CONFIDENCE IN ESTIMATES (could they stand behind the number to a regulator?). Buy-in =
// REINSURE only when all three clear 95. Anything less prints the exact gap to close.
//
//   node scripts/pmu/underwriter-grade.mjs --file <path>      # grade a file (e.g. a first-run transcript)
//   echo "..." | node scripts/pmu/underwriter-grade.mjs --stdin
//   node scripts/pmu/underwriter-grade.mjs --file a.txt --file b.txt   # grade the combined artifact
//
// The LLM is the judge a real underwriter would delegate to; it scrutinises, it does not flatter.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(REPO, 'docs/pmu/underwriter-grade.html');
const argAll = (f) => { const o = []; process.argv.forEach((a, i) => { if (a === f && process.argv[i + 1]) o.push(process.argv[i + 1]); }); return o; };
const has = (f) => process.argv.includes(f);

const UNDERWRITER = `You are a senior reinsurance underwriter who prices AI-liability treaties. You have killed a thousand "deterministic AI" pitches that were vapor. You reinsure a signal ONLY when it clears 95/100 on ALL THREE of: PREDICTIVE POWER (does the signal actually predict the violation distribution you'd price against, or is it a one-off demo?), IMPACT (is the exposure real and large enough that a carrier pays to cede it?), CONFIDENCE IN ESTIMATES (could you defend the number to a regulator and your own board?). You are unmoved by jargon; you move on recomputable evidence and a calibrated number.`;

function cleanEnv() { const e = { ...process.env }; for (const k of ['CLAUDECODE', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete e[k]; return e; }
function denoise(s) { return (s || '').split('\n').filter((l) => !/ripgrep|falling back|fallback|^warning:|GaxiosError|^\s*at |Loaded cached|Data collection|migrate|antigravity/i.test(l)).join('\n').trim(); }
function gemini(prompt) {
  const env = cleanEnv();
  for (let a = 0; a < 4; a++) {
    const r = spawnSync('gemini', ['--yolo', '--model', process.env.IM_MODEL || 'gemini-2.5-flash', '-p', prompt], { encoding: 'utf8', env, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    const blob = (r.stdout || '') + (r.stderr || ''); const out = denoise(r.stdout);
    if (out && !/429|no capacity|critical error|RESOURCE_EXHAUSTED/i.test(blob)) return out;
    spawnSync('sleep', ['3']);
  }
  return null;
}
function scoreOf(text, label) { const m = (text || '').match(new RegExp(label + '\\s*[:=]?\\s*(\\d{1,3})', 'i')); return m ? Math.min(100, parseInt(m[1], 10)) : null; }

function main() {
  const files = argAll('--file');
  let artifact = '';
  if (has('--stdin')) artifact = readFileSync(0, 'utf8');
  for (const f of files) artifact += `\n\n===== ${f} =====\n` + readFileSync(f, 'utf8');
  if (!artifact.trim()) { console.error('usage: underwriter-grade --file <path> [--file ...] | --stdin'); process.exit(2); }

  if (!spawnSync('which', ['gemini'], { encoding: 'utf8' }).status === 0) { /* checked below */ }
  const geminiHere = spawnSync('which', ['gemini'], { encoding: 'utf8' }).status === 0;
  if (!geminiHere) { console.error('gemini CLI not found — install/auth it for the underwriter grade.'); process.exit(3); }

  const prompt = `${UNDERWRITER}\n\nYou are shown the ARTIFACT a stranger sees on first contact with this product (a first-run transcript + the pitch). Grade it for whether you would REINSURE the signal.\n\nARTIFACT:\n${artifact.slice(0, 12000)}\n\nReturn EXACTLY this format and nothing else:\nPREDICTIVE_POWER: <0-100> — <one sentence>\nIMPACT: <0-100> — <one sentence>\nCONFIDENCE: <0-100> — <one sentence>\nGAP: <the single most important thing that, if fixed, raises the lowest score to 95+>\nVERDICT: <REINSURE if all three >=95, else CONDITIONAL if all >=80, else PASS>`;

  console.log('\n' + '━'.repeat(76));
  console.log('  THE LIGHTSWITCH GRADE — a reinsurance underwriter, reading the first run');
  console.log('━'.repeat(76));
  const out = gemini(prompt);
  if (!out) { console.log('  (Gemini throttled — re-run). The artifact is unscored, not failed.'); process.exit(1); }
  console.log(out.split('\n').map((l) => '  ' + l).join('\n'));

  const pp = scoreOf(out, 'PREDICTIVE_POWER'), im = scoreOf(out, 'IMPACT'), cf = scoreOf(out, 'CONFIDENCE');
  const scores = [pp, im, cf].filter((x) => x != null);
  const pass = scores.length === 3 && scores.every((x) => x >= 95);
  const min = scores.length ? Math.min(...scores) : null;
  console.log('\n  ' + '─'.repeat(72));
  console.log(`  ${pass ? '✅ BUY-IN — clears 95 on all three. The lightswitch fired.' : `❌ NOT YET — lowest is ${min ?? '?'} (need 95 on all three). The GAP line says what to fix.`}`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `<!doctype html><meta charset=utf-8><title>Underwriter grade</title><body style="background:#070910;color:#e9edf5;font:15px/1.6 -apple-system,sans-serif;max-width:760px;margin:0 auto;padding:30px 22px"><h1 style="font-size:22px">The lightswitch grade — reinsurance underwriter, first run</h1><div style="font-size:34px;font-weight:800;color:${pass ? '#46d369' : '#f0b429'};margin:14px 0">${pass ? '✅ BUY-IN' : '❌ NOT YET'} ${min != null ? `· low ${min}/100` : ''}</div><pre style="background:#0e131e;border:1px solid #1a2130;border-radius:10px;padding:16px;white-space:pre-wrap;font:13px/1.6 ui-monospace,Menlo,monospace;color:#cdd6e4">${(out || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre><p style="color:#8a94a8;font-size:13px">Graded live by Gemini reading as a reinsurance underwriter on the triple: predictive power · impact · confidence in estimates. REINSURE only at ≥95 on all three. The LLM scrutinises; it does not certify.</p></body>`);
  console.log(`  → ${OUT.replace(REPO + '/', '')}`);
  if (!has('--no-open')) spawnSync('open', [OUT]);
  process.exit(pass ? 0 : 1);
}
main();
