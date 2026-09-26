#!/usr/bin/env node
// scripts/pmu/proof-monologue.mjs — the step-by-step proof the Budget Writer needs.
//
// Runs the Hooper ledger LIVE (real evidence, on this machine), then walks it claim by
// claim and has Gemini — reading AS the Budget Writer (the person who signs the check;
// technical-fluent, allergic to brand cosmology without a procurement line) — write an
// honest inner monologue PROOFING each piece of evidence: does it actually establish the
// claim, would they believe it, what's the gap. Per-item readout BEFORE the roll-up
// (the witness contract: no verdict without reading each piece first).
//
//   npx thetacog-mcp proof                 # live ledger → Gemini-Budget-Writer monologue per claim → HTML, opened
//   npx thetacog-mcp proof --no-open       # don't open the report
//
// The LLM scrutinizes; it does not certify. The evidence is the deterministic ledger
// (hooper.mjs); Gemini's job is to try to NOT believe it and report what survives.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const HOOPER = resolve(__dirname, 'hooper.mjs');
const REPORT = resolve(REPO_ROOT, 'docs/pmu/budget-writer-proof.html');
const has = (f) => process.argv.includes(f);

const PERSONA = 'the Budget Writer — the person who signs the check; technical-fluent (reads patents, respects physics) but allergic to brand cosmology without a procurement line. You are skeptical by default and you have been pitched a thousand "deterministic AI" decks that were vapor.';

function cleanEnv() { const e = { ...process.env }; delete e.CLAUDECODE; delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN; delete e.GEMINI_API_KEY; delete e.GOOGLE_API_KEY; return e; }
function denoise(s) { return (s || '').split('\n').filter((l) => !/ripgrep|falling back|fallback|^warning:|GaxiosError|^\s*at |Loaded cached|Attempt \d|Data collection/i.test(l)).join('\n').trim(); }

// Gemini AS the Budget Writer, the proven inner-monologue invocation. Retries the
// transient 429/no-capacity; returns null (→ ERR) rather than faking belief.
function geminiProof(prompt) {
  const env = cleanEnv();
  for (let a = 0; a < 4; a++) {
    const r = spawnSync('gemini', ['--yolo', '--model', process.env.IM_MODEL || 'gemini-2.5-flash', '-p', prompt],
      { encoding: 'utf8', env, timeout: 70000, maxBuffer: 8 * 1024 * 1024 });
    const blob = (r.stdout || '') + (r.stderr || '');
    const out = denoise(r.stdout);
    if (out && !/429|no capacity|critical error|RESOURCE_EXHAUSTED/i.test(blob)) return out;
    spawnSync('sleep', ['3']);
  }
  return null;
}
function parseVerdict(text) {
  const m = (text || '').toUpperCase().match(/\b(CONVINCED|SKEPTICAL|NEED[- ]MORE)\b/g);
  return m ? m[m.length - 1].replace(' ', '-') : 'UNCLEAR';
}

function main() {
  if (!spawnSync('which', ['gemini'], { encoding: 'utf8' }).status === 0) { /* checked below */ }
  console.log('\n' + '━'.repeat(78));
  console.log('  THE STEP-BY-STEP PROOF — proofed by Gemini reading as the Budget Writer');
  console.log('━'.repeat(78));

  // 1. LIVE evidence — run the Hooper ledger, capture the 7 claims + their evidence.
  console.log('  Running the ledger live for fresh evidence (npx thetacog-mcp hooper)…');
  const h = spawnSync(process.execPath, [HOOPER, '--json'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  let ledger;
  try { ledger = JSON.parse(h.stdout); } catch { console.error('could not run the ledger:\n' + (h.stderr || h.stdout)); process.exit(3); }
  const criteria = ledger.criteria || [];
  console.log(`  Ledger: ${criteria.filter((c) => c.ok).length}/${criteria.length} criteria pass. Now the Budget Writer proofs each one.\n`);

  const geminiHere = spawnSync('which', ['gemini'], { encoding: 'utf8' }).status === 0;
  const items = [];
  for (const c of criteria) {
    const prompt = `You are ${PERSONA}\n\nYou are being shown ONE claim in a proof, with the evidence that was produced LIVE on the machine in front of you. Proof THIS piece only.\n\nCLAIM: ${c.title}\nWHY IT MATTERS: ${c.hand}\nEVIDENCE (ran live, this machine): ${c.evidence}\nPASSED ITS OWN CHECK: ${c.ok ? 'yes' : 'no'}\n\nWrite 2-4 sentences of your HONEST inner monologue: does this evidence actually establish the claim for someone who signs the check? What, specifically, still nags you or what would you demand before trusting it with real liability? Be concrete, no flattery. Then on a final line write exactly one of: VERDICT: CONVINCED  /  VERDICT: SKEPTICAL  /  VERDICT: NEED-MORE`;
    process.stdout.write(`  ▸ ${c.id} ${c.title}\n`);
    const mono = geminiHere ? geminiProof(prompt) : null;
    const verdict = mono ? parseVerdict(mono) : 'LLM-UNREACHABLE';
    items.push({ ...c, monologue: mono, verdict });
    if (mono) console.log(mono.split('\n').map((l) => '      ' + l).join('\n') + '\n');
    else console.log('      (Gemini unreachable — transient throttle. Re-run; the deterministic evidence stands regardless.)\n');
  }

  // 2. Roll-up — the Budget Writer's procurement verdict, AFTER reading every piece.
  let rollup = null;
  if (geminiHere && items.some((i) => i.monologue)) {
    const summary = items.map((i) => `${i.id} ${i.title}: ${i.verdict}`).join('\n');
    rollup = geminiProof(`You are ${PERSONA}\n\nYou just proofed each piece of this proof one by one. Your per-piece verdicts:\n${summary}\n\nNow, in 3-4 sentences, give your procurement decision: would you put this in front of your underwriter / sign a pilot, and what is the ONE condition you attach? End with exactly one line: DECISION: PILOT  /  DECISION: PILOT-WITH-CONDITION  /  DECISION: NOT-YET`);
    if (rollup) { console.log('  ── Budget Writer roll-up (after reading every piece) ──'); console.log(rollup.split('\n').map((l) => '    ' + l).join('\n')); }
  }

  // 3. The step-by-step proof, bundled as the artifact the Budget Writer keeps.
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, render(items, rollup, ledger.allPass));
  console.log(`\n  📄 STEP-BY-STEP PROOF (Budget-Writer-proofed) → ${REPORT}`);
  if (!has('--no-open')) spawnSync('open', [REPORT]);
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function vColor(v) { return /CONVINCED|PILOT$/.test(v) ? '#46d369' : /SKEPTIC|CONDITION/.test(v) ? '#f0b429' : /NEED|NOT-YET|UNREACH/.test(v) ? '#ff5d52' : '#8a94a8'; }
function render(items, rollup, allPass) {
  const rows = items.map((i) => `
    <div class="claim">
      <div class="hd"><span class="id">${esc(i.id)}</span><span class="title">${esc(i.title)}</span><span class="v" style="color:${vColor(i.verdict)}">${esc(i.verdict)}</span></div>
      <div class="why">${esc(i.hand)}</div>
      <pre class="ev">EVIDENCE (live): ${esc(i.evidence)}</pre>
      <div class="mono"><span class="lbl">Budget Writer, proofing it:</span><br>${i.monologue ? esc(i.monologue).replace(/\n/g, '<br>') : '<span class="dim">Gemini unreachable this run (transient throttle). The deterministic evidence above stands; re-run for the monologue.</span>'}</div>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The step-by-step proof — Budget-Writer-proofed</title><style>
  body{margin:0;background:#070910;color:#e9edf5;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:820px;margin:0 auto;padding:36px 22px 80px}
  h1{font-size:28px;letter-spacing:-.5px;margin:0 0 4px} .sub{color:#8a94a8;font-style:italic;margin-bottom:18px}
  .claim{background:#0e131e;border:1px solid #1a2130;border-radius:12px;padding:16px 18px;margin:14px 0}
  .hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap} .id{font-family:ui-monospace,Menlo,monospace;color:#5ad1ff;font-weight:700}
  .title{font-weight:700;font-size:17px;flex:1} .v{font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700}
  .why{color:#8a94a8;font-size:14px;margin:8px 0} .ev{background:#0a0e17;border:1px solid #1a2130;border-radius:8px;padding:10px 12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#7ee787;white-space:pre-wrap;margin:8px 0}
  .mono{background:rgba(90,209,255,.05);border-left:3px solid #5ad1ff;border-radius:6px;padding:10px 14px;font-size:14.5px;color:#dbe6f2}
  .lbl{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#5ad1ff}
  .dim{color:#5a6478} .rollup{background:rgba(70,211,105,.07);border:1px solid #46d369;border-radius:12px;padding:18px;margin:22px 0;font-size:16px}
  .rollup .lbl{color:#46d369} code{font-family:ui-monospace,Menlo,monospace;color:#9fe6b0}
</style></head><body><div class="wrap">
  <h1>The step-by-step proof — proofed by the Budget Writer</h1>
  <div class="sub">Evidence ran live (the Hooper ledger, ${allPass ? '7/7' : 'partial'}). Gemini read each piece AS the check-signer and tried not to believe it. What survives is below.</div>
  ${rows}
  ${rollup ? `<div class="rollup"><span class="lbl">Budget Writer — procurement decision (after reading every piece)</span><br>${esc(rollup).replace(/\n/g, '<br>')}</div>` : ''}
  <p class="dim" style="margin-top:24px">The LLM here scrutinizes; it does not certify. Reproduce the evidence yourself: <code>npx thetacog-mcp hooper</code> · <code>npx thetacog-mcp attest-demo --report</code>. Per-claim monologue generated by Gemini reading as the Budget Writer persona.</p>
</div></body></html>`;
}
main();
