#!/usr/bin/env node
// reef-focus.mjs — POINT THE LENS AT THE WORK (spec: docs/architecture/gdd-lens-at-the-work.md).
//
// The bootstrap measures a COMMIT's message-vs-code. The PRODUCT aims the same gzip-NCD lens at the
// repo's actual FUNCTIONS: for each function, compress its SAID (name + leading doc/comment) and its
// DID (body) against the 144 reef seeds; DRIFT = the two landing on different competence cells — the
// function does something other than what it says. Drift first (per operator); alignment is the
// mirror op later. Stage 0–2 here (parse → lens → drift); the Claude story + email panels are next.
//
// Usage: node scripts/pmu/reef-focus.mjs <file-or-dir=scripts/pmu> [--top 12] [--json]

import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const target = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'scripts/pmu';
const TOP = parseInt(arg('--top', '12'), 10);
const daemon = resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip');

// ── the reef (the competence map) ──
const lib = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8'));
const targets = lib.map((t) => t.snippet);
const targetLens = targets.map((s) => gzipSync(Buffer.from(s, 'utf8')).length);

// ── Stage 1: THE LENS — gzip-NCD best reef anchor for a text (the proven lens) ──
function bestAnchor(text) {
  if (!text || text.trim().length < 12) return null;
  const out = JSON.parse(execSync(`"${daemon}" --sense`, {
    input: JSON.stringify({ claims: [text.slice(0, 4000)], targets, target_lens: targetLens, simhash_only: false }),
    encoding: 'utf8', maxBuffer: 2e8,
  }));
  const ncd = out.ncd_scores || [];
  let mi = -1, mx = -1; for (let i = 0; i < ncd.length; i++) if (ncd[i] > mx) { mx = ncd[i]; mi = i; }
  return mi < 0 ? null : { idx: mi, coord: lib[mi].coord, score: +mx.toFixed(4), snippet: lib[mi].snippet };
}

// SEMANTIC INGEST (PMU discipline: docs→intent, code→reality SEMANTIC not raw — comments +
// identifier-words, strip syntax). Raw code text gzip-compressed against prose seeds is mostly noise;
// the meaning lives in the comments and the identifier names (camelCase/snake split into words).
const JS_KEYWORDS = new Set('const let var function return if else for while do switch case break continue new this typeof instanceof await async import export from default try catch finally throw class extends super yield void delete in of null true false undefined'.split(' '));
export function semanticExtract(code) {
  const words = [];
  // comments
  for (const m of code.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) words.push(m[0].replace(/[/*]/g, ' '));
  // identifiers → split camelCase + snake_case → words
  for (const m of code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g)) {
    const id = m[0];
    if (JS_KEYWORDS.has(id)) continue;
    for (const w of id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_$]/g, ' ').split(/\s+/)) {
      if (w.length >= 3 && !JS_KEYWORDS.has(w.toLowerCase())) words.push(w.toLowerCase());
    }
  }
  return words.join(' ');
}

// ── Stage 0: INGEST THE WORK — parse functions (SAID = name+leading //comment, DID = body SEMANTIC) ──
function parseFunctions(src, file) {
  const fns = [];
  const re = /(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{|(?:^|\n)[ \t]*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1] || m[2];
    const bracePos = src.indexOf('{', m.index + m[0].length - 1);
    if (bracePos < 0) continue;
    let depth = 0, j = bracePos, inStr = null;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (inStr) { if (ch === inStr && src[j - 1] !== '\\') inStr = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    const body = src.slice(bracePos, j);
    const before = src.slice(0, m.index).split('\n');
    const com = [];
    for (let k = before.length - 1; k >= 0 && /^\s*\/\//.test(before[k]); k--) com.unshift(before[k].replace(/^\s*\/\/\s?/, ''));
    if (body.length < 40) continue;   // skip trivial stubs
    // SAID = the declared intent (name split to words + the doc comment, both prose-like).
    // DID = the body sensed SEMANTICALLY (comments + identifier-words), per the PMU ingest discipline.
    fns.push({ file, name, said: `${semanticExtract(name)} ${com.join(' ')}`.trim(), did: semanticExtract(body) });
  }
  return fns;
}

const isCode = (f) => /\.(mjs|js|ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f);   // src/ is TypeScript — cover it
function collect(p) {
  const abs = resolve(REPO, p);
  const st = statSync(abs);
  if (st.isFile()) return isCode(abs) ? [abs] : [];
  return readdirSync(abs).flatMap((f) => isCode(f) ? [join(abs, f)] : []);
}

// ── run (CLI only; importing the module exposes semanticExtract etc. without side effects) ──
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
const files = collect(target);
const fns = files.flatMap((f) => parseFunctions(readFileSync(f, 'utf8'), f.replace(REPO + '/', '')));
console.error(`reef-focus: ${fns.length} functions across ${files.length} file(s) · lens=gzip-NCD · reef=144`);

const domain = (coord) => String(coord || '').split(',')[0].replace(/[0-9]/g, '')[0] || '?';  // top-level letter A/B/C
const rows = [];
for (const fn of fns) {
  const said = bestAnchor(fn.said), did = bestAnchor(fn.did);
  if (!said || !did) continue;
  const sameCell = said.coord === did.coord;
  const crossDomain = domain(said.coord) !== domain(did.coord);
  // drift score: cross-domain is the loud drift; different-cell-same-domain is mild; same-cell = aligned
  const drift = crossDomain ? 2 : sameCell ? 0 : 1;
  rows.push({ fn: `${fn.file.split('/').pop()}:${fn.name}`, saidCoord: said.coord, didCoord: did.coord, drift, crossDomain, sameCell, said, did });
}

// Stage 2: DRIFT — rank the drifters (what the work SAYS vs what it DOES)
const drifters = rows.filter((r) => r.drift > 0).sort((a, b) => b.drift - a.drift || (a.fn < b.fn ? -1 : 1));
const aligned = rows.filter((r) => r.drift === 0);

// WORK-FOCUS measure — the cell-occupancy of the work (the self-recursive loop's objective). A cell
// many functions pile onto = a vague/over-attracting seed; coverage = distinct cells used / 144.
const occ = new Map();
for (const r of rows) occ.set(r.didCoord, (occ.get(r.didCoord) || 0) + 1);
const coverage = occ.size;
const topAttractors = [...occ.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
const driftRate = rows.length ? Math.round(100 * drifters.length / rows.length) : 0;

// Stage 3+4: FOCUS → STORY (Claude, for now). The drifters + their said/did reef content ARE the prompt.
function storyPrompt() {
  const lines = drifters.slice(0, 15).map((r) =>
    `- ${r.fn}\n    SAYS (name+doc) → ${r.said.coord}: "${(r.said.snippet || '').replace(/\s+/g, ' ').slice(0, 110)}…"\n    DOES (body)     → ${r.did.coord}: "${(r.did.snippet || '').replace(/\s+/g, ' ').slice(0, 110)}…"`).join('\n');
  return `We aimed a compression lens (gzip-NCD over a 144-cell semantic "reef") at the FUNCTIONS in ${target}. For each function we compared where its NAME+DOC land on the reef (SAID) vs where its BODY lands (DID). Different cell = the function "drifts" — does something other than what it says.\n\n${drifters.length}/${rows.length} functions drift (${driftRate}%); the work covers ${coverage}/144 reef cells. Top drifters:\n\n${lines}\n\nTell the coherent story in 5-7 sentences: which parts of this work are drifting from what they claim, at the code level and the strategic level. BE HONEST: if the drift reads like NOISE (the reef is strategy-domain and may not be shaped for code yet) rather than real function-drift, say so plainly — that is itself the finding, and it means the instrument needs the reef refined against the work first. Coherence is the test.`;
}
if (process.argv.includes('--story')) {
  const pf = `/tmp/reef-focus-story-prompt.txt`; writeFileSync(pf, storyPrompt());
  // The focused drift + reef content IS the prompt. LLM tells the coherent story (coherence = validation).
  // Default = gemini (proven in-repo path); --claude uses claude -p (stdin) when available.
  let story = '';
  try {
    if (process.argv.includes('--claude')) {
      story = execSync(`env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDECODE claude -p < ${pf}`, { encoding: 'utf8', maxBuffer: 2e7, timeout: 150000 });
    } else {
      const { geminiCall } = await import('./gemini-call.mjs');
      story = geminiCall(storyPrompt(), { retriesPerModel: 1, timeoutMs: 120000 });
    }
    console.log(`\n── THE STORY (coherence = validation) ──\n${String(story).trim()}\n`);
  } catch (e) { console.error('story skipped:', String(e.message || e).slice(0, 160), `· prompt at ${pf}`); }
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ target, total: rows.length, drifters, alignedCount: aligned.length }, null, 2) + '\n');
} else {
  console.log(`\nWORK DRIFT (lens aimed at the functions) — ${drifters.length}/${rows.length} functions drift · ${aligned.length} aligned\n`);
  console.log(`  ${'function'.padEnd(42)} SAID→DID            drift`);
  for (const r of drifters.slice(0, TOP)) {
    console.log(`  ${r.fn.slice(0, 42).padEnd(42)} ${(r.saidCoord + '→' + r.didCoord).padEnd(20)} ${r.crossDomain ? 'CROSS-DOMAIN ⚠' : 'cell'}`);
  }
  console.log(`\n  (a function "drifts" when its name+doc land on a different reef competence cell than its body —`);
  console.log(`   it does something other than what it says. CROSS-DOMAIN = the top-level competence letter differs.)`);

  // THE MIRROR OP (operator: always do both) — the ALIGNED core: functions that do what they say.
  if (process.argv.includes('--aligned') && aligned.length) {
    console.log(`\nALIGNED (the solid core — says ≈ does) — ${aligned.length}/${rows.length}\n`);
    for (const r of aligned.slice(0, TOP)) console.log(`  ${r.fn.slice(0, 42).padEnd(42)} ${r.saidCoord} ✓`);
  }
}
}   // end isMain
