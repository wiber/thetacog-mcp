#!/usr/bin/env node
// scripts/pmu/lens-run.mjs — `npx thetacog-mcp lens-run "<prompt>" [--ideal <domain>]`: run ONE prompt
// through the real, LLM-FREE lens from Claude Code / the terminal and print the readout + retrieved rules
// + the playbook template + the actual-vs-ideal match. Same pipeline as the page's POST /lens (it reuses
// attest-serve's lensReadout), so the CLI and the instrument agree byte-for-byte. No model in the path.
//
//   node scripts/pmu/lens-run.mjs "draft the accumulation email to the Munich Re underwriter" --ideal comms-email
//   node scripts/pmu/lens-run.mjs "fix the blog 500" --json

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const idealIdx = argv.indexOf('--ideal');
const ideal = idealIdx >= 0 ? argv[idealIdx + 1] : null;
const asJson = argv.includes('--json');
// the prompt = the first non-flag token(s) — everything that isn't --ideal <val> / --json
const prompt = argv.filter((a, i) => a !== '--json' && a !== '--ideal' && !(idealIdx >= 0 && i === idealIdx + 1)).join(' ').trim();

if (!prompt) {
  console.error('Usage: lens-run "<prompt>" [--ideal <domain>] [--json]');
  process.exit(2);
}

const { lensReadout } = await import(resolve(HERE, 'attest-serve.mjs'));
const out = await lensReadout({ prompt, ideal: ideal || undefined });
if (out.error) { console.error('✗ ' + out.error); process.exit(1); }

// NOTE: never process.exit(0) after printing — an eager exit truncates a piped stdout before the buffer
// flushes (the JSON came back cut at ~7.7KB under execFileSync). Let the process end naturally; nothing
// keeps the event loop alive (the Rust walk + sqlite reads already completed synchronously/awaited).
if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); }
else {

const ro = out.readout || {};
const C = { dim: '\x1b[2m', cy: '\x1b[36m', gn: '\x1b[32m', rd: '\x1b[31m', am: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };
const line = '────────────────────────────────────────────────────────';
console.log(`\n🔬 Lens Tester — LLM-free · deterministic`);
console.log(line);
console.log(out.receiptText || '(no receipt)');
console.log(line);
console.log(`${C.b}DOMAIN${C.x}    ${out.domain}${ideal ? `   ${out.domain_match ? C.gn + '✅ MATCH' : C.rd + '❌ MISS'} (ideal: ${ideal})${C.x}` : ''}`);
console.log(`${C.b}PIXEL${C.x}     ${ro.coord}   σ ${ro.sigma}   sensor ${ro.sensor}   ${ro.walkPlies} plies · fill ${ro.walkFillPct}%`);
console.log(`\n${C.cy}RETRIEVED SQL RULES (${(out.rules || []).length})${C.x}`);
(out.rules || []).forEach((r, i) => console.log(`  ${C.am}[${i + 1}]${C.x} ${r}`));
if (!(out.rules || []).length) console.log(`  ${C.dim}(no rules indexed for this pixel yet)${C.x}`);
console.log(`\n${C.cy}PLAYBOOK TEMPLATE${C.x}`);
const t = out.template || {};
if (t.workName || t.workSkeleton) console.log(`  work-shape [${t.workName || '?'}]: ${t.workSkeleton || ''}`);
if (t.domainTemplate) console.log(`  domain [${out.domain}]: ${t.domainTemplate}`);
if (!t.workName && !t.domainTemplate) console.log(`  ${C.dim}(no template picked — degenerate placement)${C.x}`);
console.log('');
}
