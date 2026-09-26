// scripts/vna/witness.mjs — C270 (U7) WITNESS TEMPLATES: THE HOST WRITES THE FAILING TEST FOR A MECHANICAL ROW. Operator 2026-09-25,
// verbatim: "The worker receives a test that is already red." C260's guard did not exist at dispatch — an 8B model had to invent a CSS
// regression test before it could make a one-line edit. For a MECHANICAL row the test is a template the host fills and proves red:
//   css-property  "set `.card3.pill` margin-bottom to 4px in packages/…/chat.css"   selector · property · target, cascade-aware
//   config-value  "set `engine.preset` to goose-local in data/vna/x.json"           a dotted key in a JSON file
//   copy-string   "replace \"Old words\" with \"New words\" in src/…/page.tsx"       the new text present, the old one gone
// witnessFor(row) returns { kind, spec } or null (a row that is not mechanical keeps its own guard — the model or a human writes it).
// prepareWitness() writes the guard at the row's named guard path when absent, runs it, and REFUSES the dispatch when the guard is
// green at HEAD (nothing to do, or the wrong assertion) — the loop never spends a worker on a test that is already satisfied.
// Pure over the row + the files; LLM-free. The generated guard imports nothing of ours: it reads the file it checks, so it runs on
// the parent tree in the red witness exactly as at HEAD.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { namedPaths } from './spec-clarity.mjs';

const strip = (s) => String(s || '').replace(/^\s*-\s*\[[ xX]\]\s*C\d+[a-z]?\s*/, '').replace(/\(guard:\s*`[^`]*`[^)]*\)\s*/, '');
const guardOf = (row) => (/\(guard:\s*`([^`]+)`/.exec(row) || [])[1] || null;

/** the mechanical reading of a row, or null */
export function witnessFor(row) {
  const t = strip(row); const files = namedPaths(t);
  const css = /`?((?:[.#][\w-]+)(?:[\s>+~]*[.#]?[\w-]+)*)`?\s+([a-z-]+)\s+(?:to|=|→)\s+`?([\w.%#()-]+)`?/i.exec(t);
  const cssFile = files.find((f) => f.endsWith('.css'));
  if (css && cssFile) return { kind: 'css-property', spec: { file: cssFile, selector: css[1].trim(), property: css[2].toLowerCase(), target: css[3] } };
  const cfg = /set\s+`?([\w-]+(?:\.[\w-]+)+)`?\s+(?:in\s+(\S+\.json)\s+)?to\s+`?([^`\s,;)]+)`?/i.exec(t);
  const jsonFile = (cfg && cfg[2]) || files.find((f) => f.endsWith('.json'));
  if (cfg && jsonFile) { let v = cfg[3]; try { v = JSON.parse(v); } catch { /* a bare string */ } return { kind: 'config-value', spec: { file: jsonFile, key: cfg[1], value: v } }; }
  const copy = /replace\s+["“]([^"”]{2,200})["”]\s+with\s+["“]([^"”]{2,200})["”]/i.exec(t);
  const copyFile = files.find((f) => !f.endsWith('.json') && !f.startsWith('tests/'));
  if (copy && copyFile) return { kind: 'copy-string', spec: { file: copyFile, old: copy[1], new: copy[2] } };
  return null;
}

/** the guard source for a witness — node:test, reads the file relative to the repo root the test sits under */
export function witnessSource(w, { guardPath, label = 'C?' }) {
  const up = relative(dirname(guardPath), '.') || '.';
  const head = [`// ${label} — host-written red witness (C270, template ${w.kind}). Generated before dispatch; the worker makes it pass.`,
    "import test from 'node:test';", "import assert from 'node:assert/strict';", "import { readFileSync } from 'node:fs';", "import { resolve, dirname } from 'node:path';", "import { fileURLToPath } from 'node:url';",
    `const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ${JSON.stringify(up)});`, `const read = () => readFileSync(resolve(ROOT, ${JSON.stringify(w.spec.file)}), 'utf8');`];
  if (w.kind === 'css-property') return [...head,
    `// the cascade within the file: every rule whose selector list names the selector exactly; the LAST declaration of the property wins`,
    `test(${JSON.stringify(`${w.spec.selector} ${w.spec.property} is ${w.spec.target}`)}, () => {`,
    `  const css = read().replace(/\\/\\*[\\s\\S]*?\\*\\//g, ''); let v = null;`,
    `  for (const m of css.matchAll(/([^{}]+)\\{([^{}]*)\\}/g)) {`,
    `    if (!m[1].split(',').map((s) => s.trim().replace(/\\s+/g, ' ')).includes(${JSON.stringify(w.spec.selector.replace(/\s+/g, ' '))})) continue;`,
    `    for (const d of m[2].split(';')) { const [p, ...r] = d.split(':'); if (p && p.trim().toLowerCase() === ${JSON.stringify(w.spec.property)}) v = r.join(':').replace(/!important/, '').trim(); }`,
    `  }`,
    `  assert.equal(v, ${JSON.stringify(w.spec.target)}, ${JSON.stringify(`${w.spec.selector} { ${w.spec.property} } in ${w.spec.file}`)});`, '});', ''].join('\n');
  if (w.kind === 'config-value') return [...head,
    `test(${JSON.stringify(`${w.spec.key} is ${JSON.stringify(w.spec.value)}`)}, () => {`,
    `  const v = ${JSON.stringify(w.spec.key)}.split('.').reduce((o, k) => (o == null ? o : o[k]), JSON.parse(read()));`,
    `  assert.deepEqual(v, ${JSON.stringify(w.spec.value)});`, '});', ''].join('\n');
  if (w.kind === 'copy-string') return [...head,
    `test(${JSON.stringify(`the copy reads the new words`)}, () => {`,
    `  const s = read(); assert.ok(s.includes(${JSON.stringify(w.spec.new)}), 'the new words are missing'); assert.ok(!s.includes(${JSON.stringify(w.spec.old)}), 'the old words are still there');`, '});', ''].join('\n');
  throw new Error(`UNKNOWN_WITNESS ${w.kind}`);
}

const clean = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; };
/** before dispatch: { mechanical, wrote, state: 'red'|'green'|'none', refuse, why } — refuse is true only for a mechanical row already green */
export function prepareWitness({ repo, row, label = null }) {
  const w = witnessFor(row); const g = guardOf(row);
  if (!w) return { mechanical: false, wrote: false, state: 'none', refuse: false, why: 'not a mechanical row — its guard is the worker\'s to write' };
  if (!g) return { mechanical: true, wrote: false, state: 'none', refuse: true, why: `mechanical (${w.kind}) but the row names no guard path` };
  if (!existsSync(resolve(repo, w.spec.file))) return { mechanical: true, wrote: false, state: 'none', refuse: true, why: `mechanical (${w.kind}) but ${w.spec.file} is not on disk` };
  let wrote = false;
  if (!existsSync(resolve(repo, g))) { mkdirSync(dirname(resolve(repo, g)), { recursive: true }); writeFileSync(resolve(repo, g), witnessSource(w, { guardPath: g, label: label || '' })); wrote = true; }
  const r = spawnSync('node', ['--test', g], { cwd: repo, encoding: 'utf8', env: clean(), timeout: 60000 });
  if (r.status === 0) return { mechanical: true, wrote, state: 'green', refuse: true, kind: w.kind, guard: g, why: `the ${w.kind} witness ${g} is already GREEN at HEAD — nothing for a worker to do, or the assertion is wrong` };
  return { mechanical: true, wrote, state: 'red', refuse: false, kind: w.kind, guard: g, why: `the ${w.kind} witness ${g} is red at HEAD${wrote ? ' (written by the host)' : ''}` };
}
