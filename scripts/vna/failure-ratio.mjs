#!/usr/bin/env node
// C93k — STATIC VS DYNAMIC: the red witness says WHY it was red.
//
// A guard that fails on the parent tree can fail two ways, and they ground different things:
//   STATIC  — the surface did not exist on that tree (module not found · file ENOENT · syntax · reference · not a function · no such
//             export). The red proves only that the file is new.
//   DYNAMIC — the surface existed and an invariant failed (an assertion). The red grounds the parent's BEHAVIOUR.
// grounding_ratio = dynamic / (static + dynamic): 1 = every failure was an invariant on a surface the parent already had;
// 0 = red by absence. Nothing failed → UNMEASURED with null, never 0 — an absent measurement is not a zero.
//
// The construct is the TAP block, not a grep of the whole output: node's runner prints a file-level crash as `#` comment
// lines BEFORE that file's `not ok`, and an assertion INSIDE the subtest's YAML — so each failing subtest is classified from
// the text accumulated since the previous block ended, through its own `...` terminator. One class per subtest, static first
// when both signatures appear (a crashed file's stderr can quote an assertion from an earlier run). A parent whose
// `failureType: 'subtestsFailed'` is a container, not a failure — its children were counted. LLM-free.
// Guard: tests/vna/c93k-failure-ratio.test.mjs.

const STATIC_RE = /ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|ENOENT: no such file|SyntaxError|ReferenceError|is not a function|does not provide an export|ERR_UNKNOWN_FILE_EXTENSION|ERR_REQUIRE_ESM/;
const DYNAMIC_RE = /AssertionError|ERR_ASSERTION|failureType: 'testCodeFailure'/;
const DYNAMIC_WITNESS_RE = /AssertionError|ERR_ASSERTION/;   // the quoted line names the assertion, never the runner's generic failureType

export function ratioOf({ static: s = 0, dynamic: d = 0 } = {}) { const n = s + d; return n > 0 ? d / n : null; }

export function classifyFailures(output) {
  const lines = String(output || '').split('\n');
  const out = { static: 0, dynamic: 0, first: { static: null, dynamic: null } };
  let buf = [], inBlock = null;   // inBlock: { failing } while inside an ok/not-ok YAML block
  const close = () => {
    if (inBlock && inBlock.failing) {
      const text = buf.join('\n');
      if (!/failureType: 'subtestsFailed'/.test(text)) {
        const s = text.match(STATIC_RE), d = text.match(DYNAMIC_RE);
        if (s) { out.static++; out.first.static ||= lineOf(text, STATIC_RE); }
        else if (d) { out.dynamic++; out.first.dynamic ||= lineOf(text, DYNAMIC_WITNESS_RE) || lineOf(text, DYNAMIC_RE); }
      }
    }
    buf = []; inBlock = null;
  };
  for (const line of lines) {
    const head = line.match(/^\s*(not ok|ok) \d+/);
    if (head && !inBlock) { inBlock = { failing: head[1] === 'not ok' }; buf.push(line); continue; }
    buf.push(line);
    if (inBlock && /^\s*\.\.\.\s*$/.test(line)) close();
  }
  if (inBlock) close();
  const grounding_ratio = ratioOf(out);
  return { ...out, grounding_ratio, status: grounding_ratio === null ? 'UNMEASURED' : 'MEASURED' };
}
const lineOf = (text, re) => (text.split('\n').find((l) => re.test(l)) || '').replace(/^#\s*/, '').trim().slice(0, 160) || null;

export const UNMEASURED = () => ({ static: 0, dynamic: 0, grounding_ratio: null, status: 'UNMEASURED', first: { static: null, dynamic: null } });

if (process.argv[1] && process.argv[1].endsWith('failure-ratio.mjs')) {
  const { readFileSync } = await import('node:fs');
  const src = process.argv[2] && process.argv[2] !== '-' ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
  console.log(JSON.stringify(classifyFailures(src), null, 2));
}
