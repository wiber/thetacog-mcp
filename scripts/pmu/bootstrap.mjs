#!/usr/bin/env node
// scripts/pmu/bootstrap.mjs — onboarding with ZERO manual.
//
// Don't ask people to read the docs. A CLI LLM already on their machine reads the
// package's purpose and onboards them in plain language — then the full proof runs
// and opens itself. This is also the acceptance test made literal: "if a CLI LLM can
// bootstrap it, it works" — so the package uses a CLI LLM to bootstrap onboarding.
// When the LLM is good enough to generate the full quickstart, that IS the manual.
//
//   npx thetacog-mcp bootstrap                # LLM onboards you, then runs the full proof + opens the report
//   npx thetacog-mcp bootstrap --explain-only # just the LLM onboarding, don't run anything
//   npx thetacog-mcp bootstrap --no-llm       # static quickstart (no LLM), still runs the proof
//
// Degrades gracefully: no LLM / throttled → a hand-written quickstart, and the proof
// still runs. The LLM reduces friction; it is never on the critical path of the proof.

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ATTEST_DEMO = resolve(__dirname, 'attest-demo.mjs');
const has = (f) => process.argv.includes(f);

// What the LLM is told. Short, factual, no hype — it onboards from THIS, not the manual.
const BRIEF = `thetacog is a deterministic, hardware-grounded verification gate for AI work.
The problem: verifying an AI deliverable with another LLM ("an eval") is software verifying
software — Rice's theorem says that can't be reliable, and in practice the LLM judge flips
between runs and signs nothing you can replay. The fix: a gate that runs the same way every
time (gzip bridge -> 144x144 semantic lattice -> ballistic walk on a Rust runner -> ed25519
receipt). Same input -> same verdict + sigma, byte-identical, recomputable by a stranger who
trusts no one. The legal frame is The T.J. Hooper (1932): the standard is not care, it is
what is available — once a deterministic gate is available, "we ran an eval" stops being a
defense. Runnable commands the user can type right now:
  npx thetacog-mcp bootstrap     # this — LLM onboards you, then runs the full proof
  npx thetacog-mcp attest-demo --report   # two-node spec->work->underwriter chain + a live LLM that drifts; opens one HTML with every artifact
  npx thetacog-mcp hooper        # the 7-criterion "standard is not care" ledger, exits 0 iff 7/7
  npx thetacog-mcp prove-rice    # watch an LLM judge flip while the silicon holds
  npx thetacog-mcp attest verify # recompute a verdict yourself, trusting no one`;

const PROMPT = `You are onboarding a developer who just installed an npm package and has NOT read any documentation. Using ONLY the brief below, write a short, friendly, plain-language onboarding (no marketing fluff): (1) one sentence on what problem this solves, (2) one sentence on why it's different, (3) a numbered list of the EXACT commands to run first and what each shows. Keep it under 160 words. End with the single command you'd tell them to run right now.\n\nBRIEF:\n${BRIEF}`;

function cleanEnv() {
  const e = { ...process.env };
  for (const k of ['CLAUDECODE', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete e[k];
  return e;
}
function which(bin) { return spawnSync('which', [bin], { encoding: 'utf8' }).status === 0; }
function denoise(s) { return (s || '').split('\n').filter((l) => !/ripgrep|falling back|fallback|^warning:|GaxiosError|^\s*at /i.test(l)).join('\n').trim(); }

// Try the CLI LLMs the user already has, OAuth-authed. gemini first (most common here).
function runLLM(prompt) {
  const env = cleanEnv();
  if (which('gemini')) {
    for (let a = 0; a < 3; a++) {
      const r = spawnSync('gemini', ['-p', prompt], { encoding: 'utf8', env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      const blob = (r.stdout || '') + (r.stderr || '');
      const out = denoise(r.stdout);
      if (out && !/429|no capacity|critical error/i.test(blob)) return { llm: 'gemini', text: out };
      spawnSync('sleep', ['2']);
    }
  }
  if (which('claude')) {
    const r = spawnSync('claude', ['-p', prompt], { encoding: 'utf8', env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const out = denoise(r.stdout);
    if (r.status === 0 && out) return { llm: 'claude', text: out };
  }
  if (which('codex')) {
    const r = spawnSync('codex', ['-q', prompt], { encoding: 'utf8', env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const out = denoise(r.stdout);
    if (r.status === 0 && out) return { llm: 'codex', text: out };
  }
  return null;
}

const STATIC = `Welcome to thetacog — a deterministic, recomputable verification gate for AI work.
Why different: it doesn't ask another LLM if the output "looks ok" (that flips between runs);
it measures, on hardware, and signs a verdict a stranger can reproduce.

Run these, in order:
  1. npx thetacog-mcp attest-demo --report   → the full two-node proof; opens one HTML with every artifact
  2. npx thetacog-mcp hooper                 → the 7-criterion "standard is not care" ledger (exits 0 iff 7/7)
  3. npx thetacog-mcp prove-rice             → watch an LLM judge flip while the silicon holds

Start here:  npx thetacog-mcp attest-demo --report`;

function main() {
  console.log('\n' + '━'.repeat(72));
  console.log('  thetacog · zero-manual onboarding');
  console.log('━'.repeat(72));

  let onboarding = null;
  if (!has('--no-llm')) {
    process.stdout.write('  Asking a CLI LLM on your machine to onboard you (no manual)…\n');
    onboarding = runLLM(PROMPT);
  }
  if (onboarding) {
    console.log(`\n  ✦ generated live by your ${onboarding.llm} CLI — not a doc you had to read:\n`);
    console.log(onboarding.text.split('\n').map((l) => '    ' + l).join('\n'));
    console.log('\n  ✓ A CLI LLM just bootstrapped this onboarding. That is the acceptance test, met live.');
  } else {
    console.log(`\n  (no CLI LLM reachable${has('--no-llm') ? ' (--no-llm)' : ' — install/auth gemini, claude, or codex for live onboarding'}) — here is the quickstart:\n`);
    console.log(STATIC.split('\n').map((l) => '    ' + l).join('\n'));
  }

  if (has('--explain-only')) { console.log('\n  (--explain-only — not running the proof)\n'); return; }

  console.log('\n' + '─'.repeat(72));
  console.log('  Now seeing it beats reading it — running the full proof:  npx thetacog-mcp attest-demo --report\n');
  const demoArgs = [ATTEST_DEMO];
  if (has('--no-llm')) demoArgs.push('--no-llm');
  const r = spawnSync(process.execPath, demoArgs, { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}
main();
