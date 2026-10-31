#!/usr/bin/env node
// scripts/ops/rules-for.mjs
//
// WHAT RULES BIND THE FILES I AM ABOUT TO TOUCH?
//
// THE FAILURE THIS ENDS. Five times in one session a rule already existed in this repo, was not
// read, and the forbidden thing was done anyway: NO TABLES (written in CLAUDE.md and in the reef,
// enforced nowhere, four tables added); shortlex.mjs's "SHORTLEX NAMES THE LISTS, NEVER THE ITEMS
// ... DERIVED, NEVER ASSIGNED" (40 coordinates hand-assigned onto items, by someone editing a file
// in the same directory); META-BULK's matched-aperture rule (a 90-char query matched against
// 600-char excerpts); CLAUDE.md's "a control wired to nothing is fabrication wearing a UI" (a spec
// written with a weaker done-condition than the repo already demanded); "every iteration mails
// itself" (nine commits, zero emails).
//
// WHY IT KEEPS HAPPENING, mechanically rather than as a resolution to do better. The habit that IS
// followed is find-the-running-code-first — search for CODE. Nobody searches for RULES ABOUT THE
// PATHS. The prompt lens injects rules ranked by gzip-NCD against the PROMPT, which is a different
// question: it cannot know that `scripts/milestones/score.mjs` has a sibling whose header forbids
// what you are about to write. The proxy (prompt similarity) is not a sufficient statistic for the
// question asked (what binds these files).
//
// So this answers the path question directly, and it is deliberately dumb: no ranking, no model,
// no cleverness. Every rule attached to a path, printed, in full.
//
// SUFFICIENCY CONTRACT, because this tool is itself a projection and must say what it cannot do.
//   SUFFICIENT FOR: rules that NAME these paths (exactly, by basename, or by directory prefix),
//                   rules in the file's own header, and rules in sibling files' headers.
//   NOT SUFFICIENT FOR: rules about the TECHNIQUE you are about to use. META-BULK's matched-aperture
//                   rule was missed this session while writing prior-art.mjs, and this tool would
//                   NOT have caught it — META-BULK names grip-navigator.mjs, a file with no
//                   relationship to the one being written. That is the prompt-lens's job and the
//                   prompt-lens missed it too. Naming the gap beats implying coverage.
//                   THE OTHER DOOR, for the question this one cannot answer:
//                       node scripts/cog/rule-grab.mjs --query "<what did we resolve about ...>"
//                   Content-keyed instead of path-keyed, so it reaches the judgement rules that name
//                   no path. Neither subsumes the other; ask the path question here and the kind-of-
//                   change question there.
//
//   node scripts/ops/rules-for.mjs scripts/milestones/score.mjs
//   node scripts/ops/rules-for.mjs $(git diff --name-only)     # before committing
//
// @guard tests/ops/rules-for.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join, basename } from 'node:path';

const REPO = resolve(new URL('../..', import.meta.url).pathname);

// A SHOUTY HEADER is this repo's convention for a binding rule: a comment line in the first ~40
// lines that is MOSTLY capitals. 100+ files carry one. That is the corpus nobody was reading.
//
// THIS DETECTOR'S OWN FIRST VERSION FAILED, and the way it failed is the second half of the same
// disease. It used an exclusive character class — [A-Z0-9 ,'-] — which demands a line be entirely
// uppercase. The real header it was built to find reads:
//     "SHORTLEX NAMES THE LISTS, NEVER THE ITEMS (operator, 2026-08-24)."
// Lowercase "operator", a trailing full stop, and the match fails. A token pattern was written
// where the property is a RATIO, inside the tool built to stop exactly this. So: compute it.
const LETTERS = /[A-Za-z]/g;
function isShouty(text) {
  const letters = text.match(LETTERS) || [];
  if (letters.length < 12) return false;                     // too short to be a header
  const upper = letters.filter((c) => c === c.toUpperCase()).length;
  return upper / letters.length >= 0.75;                     // predominantly, not exclusively
}

function shoutyHeader(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(0, 40)
      .filter((l) => /^\s*(\/\/|#|\*)/.test(l))
      .map((l) => l.replace(/^\s*(\/\/|#|\*)\s?/, '').trim())
      .filter((t) => t && isShouty(t));
  } catch { return []; }
}

/** The rule text under a shouty header — the sentences that actually bind. */
function headerBlock(file, maxLines = 26) {
  try {
    const lines = readFileSync(file, 'utf8').split('\n');
    const out = [];
    for (const l of lines.slice(0, 60)) {
      if (!/^\s*(\/\/|#|\*)/.test(l)) { if (out.length) break; else continue; }
      out.push(l.replace(/^\s*(\/\/|#|\*)\s?/, ''));
      if (out.length >= maxLines) break;
    }
    return out;
  } catch { return []; }
}

/** CLAUDE.md sections that NAME this path — the rule wrote your filename down. */
function claudeSectionsFor(paths) {
  const md = readFileSync(resolve(REPO, 'CLAUDE.md'), 'utf8');
  const blocks = md.split(/\n(?=### )/);
  const hits = [];
  for (const b of blocks) {
    const title = b.split('\n')[0].replace(/^#+\s*/, '').trim();
    for (const p of paths) {
      const base = basename(p);
      // DIRECTORY PREFIXES TOO, not just exact paths. CLAUDE.md's blog-format section (which is
      // where NO TABLES lives, and NO TABLES is one of the five rules missed this session) names
      // "src/content/blog/" as a directory and never any individual post. Matching only exact
      // paths and basenames found nothing for a .mdx file — the rule was there and unreachable.
      // AT LEAST TWO SEGMENTS. The first version accepted any prefix, so "scripts/" matched — and
      // nearly every CLAUDE.md section names some scripts/ path, which surfaced four unrelated
      // sections for one file. A one-segment prefix carries no information; "scripts/milestones/"
      // does. Third false-positive trap of the same day, inside the fix for the second one, which
      // is itself the argument for narrowing with a reason rather than by feel.
      const dirs = [];
      const parts = p.split('/');
      for (let i = 2; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/') + '/');
      const dirHit = dirs.find((d) => b.includes(d));
      if (b.includes(p) || (base.length > 6 && b.includes(base)) || dirHit) {
        hits.push({ title, why: b.includes(p) ? p : (base.length > 6 && b.includes(base)) ? base : dirHit });
        break;
      }
    }
  }
  return hits;
}

/** Siblings in the same directory, because that is where the missed rule was, twice. */
function siblings(file) {
  const dir = dirname(file);
  try {
    return readdirSync(dir)
      .filter((e) => /\.(m?js|ts|sh)$/.test(e) && join(dir, e) !== file)
      .map((e) => join(dir, e))
      .filter((f) => statSync(f).isFile() && shoutyHeader(f).length);
  } catch { return []; }
}

export function rulesFor(paths) {
  const abs = paths.map((p) => (p.startsWith('/') ? p : resolve(REPO, p))).filter(existsSync);
  return {
    own: abs.map((f) => ({ file: relative(REPO, f), headers: shoutyHeader(f), block: headerBlock(f) }))
      .filter((x) => x.headers.length),
    siblings: [...new Set(abs.flatMap(siblings))]
      .map((f) => ({ file: relative(REPO, f), headers: shoutyHeader(f) }))
      .filter((x) => x.headers.length),
    claude: claudeSectionsFor(abs.map((f) => relative(REPO, f))),
    guards: abs.flatMap((f) => {
      try {
        return (readFileSync(f, 'utf8').match(/@guard\s+(\S+)/g) || []).map((g) => g.replace('@guard', '').trim());
      } catch { return []; }
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const paths = process.argv.slice(2);
  if (!paths.length) { process.stderr.write('usage: rules-for.mjs <path>...\n'); process.exit(2); }
  const r = rulesFor(paths);
  let any = false;
  for (const f of r.own) {
    any = true;
    process.stdout.write(`\n\x1b[1m${f.file}\x1b[0m — its own header binds you:\n`);
    for (const line of f.block) process.stdout.write(`    ${line}\n`);
  }
  if (r.siblings.length) {
    any = true;
    process.stdout.write('\n\x1b[1mSIBLINGS IN THE SAME DIRECTORY\x1b[0m — twice this session the missed rule was here:\n');
    for (const s of r.siblings) process.stdout.write(`    ${s.file}\n        ${s.headers.slice(0, 3).join(' · ')}\n`);
  }
  if (r.claude.length) {
    any = true;
    process.stdout.write('\n\x1b[1mCLAUDE.md SECTIONS NAMING THESE PATHS\x1b[0m:\n');
    for (const c of r.claude) process.stdout.write(`    ${c.title}\n        (matched on "${c.why}")\n`);
  }
  if (r.guards.length) {
    process.stdout.write(`\n\x1b[1mGUARDS\x1b[0m: ${[...new Set(r.guards)].join(', ')}\n`);
  }
  process.stdout.write(any
    ? '\nRead these before editing. Every one of the five misses this session was in a file like the above.\n'
    : '\nNo attached rules found for these paths.\n');
}
