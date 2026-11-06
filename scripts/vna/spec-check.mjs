#!/usr/bin/env node
// scripts/vna/spec-check.mjs — TICK A CHECKLIST BOX ONLY WHEN ITS ACCEPTANCE IS GREEN (C26, §15.5).
//
// A tick is a CLAIM that an item is done, and every other instrument here reads the checklist as
// state: six-pct's sufficiency axis divides by the ticked items, the steer page prints "19/30", the
// clipboard payload hands the count to the model on the right. A box ticked by hand on a feeling
// propagates through all three as a fact.
//
// So the tick is earned: this runs the acceptance named ON THE ITEM'S OWN LINE and flips the box
// only if it passes. It refuses by NAMING the failing test rather than saying no — a refusal you
// cannot act on is just an obstacle.
//
// UNTICKING IS ALWAYS ALLOWED, AND THAT ASYMMETRY IS DELIBERATE. Ticking asserts something;
// unticking withdraws an assertion, and withdrawing a claim you can no longer support must never
// require permission from the thing that stopped supporting it.
//
// AN ITEM WITH NO NAMED ACCEPTANCE CANNOT BE TICKED HERE. Not an oversight: its one-line description
// is a projection nobody can reconstruct "is it done?" from, which is exactly what axis 5 counts as
// insufficient. Naming the guard is the work, not the paperwork.
//
// C98g — THE TWO DOORS OUT OF PENDING. A released snippet of a clip row (the fold's C58 release: nearest basin, UNMEASURED)
// lists as `P<row>.<k>` under ## PENDING in SPEC-FROM-TREE.md until one of these runs. `declare <id> --as <Cn>` appends the
// snippet's text VERBATIM as the next free lettered sub-row of Cn's numbered family in SPEC-VNA-COCKPIT.md, stamped
// `(declared <date> from pending <id>)` — the stamp is what the fold reads to stop listing it. `dismiss <id> --why "…"` is a
// `pending-dismiss` row on the amendments ledger carrying the text (AXIOM 1). These are the ONLY writers of the hand spec
// on behalf of a pending ask; the fold never writes it (C98g).
//
// @guard tests/vna/spec-check.test.mjs · tests/vna/c98g-released-is-pending.test.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tickDecision, hollowReason } from './steer-rules.mjs';   // C236 S2: the tick's decision is the crystal's pure function — this file runs the guard, that function decides
import { regrip } from '../lib/grip-word.mjs';   // C305c: every line this file PRINTS into the session routes through the one rewrite before it reaches stdout
import { rewriteRow } from './row-rewrite.mjs';
import { parseExternal, runExternalGuard, externalWitness } from './external-guard.mjs';   // C474: a guard in a sibling repo runs on that repo's commit   // C378: the one check that a rewrite keeps the operator's `*"…"*` span intact
import { guardTimeoutMs } from '../lib/guard-timeout.mjs';   // the one guard time limit, shared with steer-follow-through.mjs

// C1017d: the repo being ticked is the caller's (VNA_REPO, as npx thetacog-mcp sets it), never the package's own tree
const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SPEC = process.env.VNA_SPEC || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
// C178a's HEAD read needs a real git repo to read HEAD FROM. In production that is always REPO (this checkout);
// a guard test that wants a controllable green/red fixture without committing throwaway files into THIS repo's
// real history points VNA_GUARD_REPO at its own disposable temp git repo instead — the same override shape as
// VNA_SPEC, never a second code path.
const GUARD_REPO = process.env.VNA_GUARD_REPO || REPO;

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'status';
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

function lines() { return readFileSync(SPEC, 'utf8').split('\n'); }
// C255b — ONE ID NAMES ONE ROW. Two rows filed as C255 (2026-09-24): the toggle took the first, which was the
// wrong one, and unticked a proved row. Every row carrying the id is returned so the toggle can refuse the ambiguity.
export function rowsWithId(ls, id) {
  const re = new RegExp(`^-\\s*\\[[ xX]\\]\\s*${id}(\\s|$)`);
  return ls.map((l, i) => (re.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
}
function findItem(ls, id) {
  const i = ls.findIndex((l) => new RegExp(`^-\\s*\\[[ xX]\\]\\s*${id}(\\s|$)`).test(l.trim()));
  return i < 0 ? null : { i, line: ls[i], done: /^-\s*\[[xX]\]/.test(ls[i].trim()) };
}
// The acceptance is whatever the line itself names in backticks after "guard:". One place, written
// beside the claim it backs — never a second registry that can drift from the checklist.
// \b: `intentguard` dependency … matched `guard\`` inside the word on C21 (2026-09-18) — the token is not the construct
const guardOf = (line) => /\bguard[:s]?\s*`([^`]+)`/i.exec(line)?.[1] || null;

// A GREEN VERDICT MUST NOT DEPEND ON WHO IS ASKING. `node --test` exits 0 on a FAILING file when
// NODE_TEST_CONTEXT is set in its environment — the variable node's own runner exports into child
// processes so they report through the parent protocol instead of by exit code. Any caller that
// happens to be running under a test runner (or a hook, or a wrapper that inherited one) would be
// told every red guard is green, silently and in the flattering direction. Measured: the same
// failing file exits 1 plainly and 0 with NODE_TEST_CONTEXT=child. So the child gets a scrubbed env.
const CLEAN_ENV = (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; })();
// C178a — THE EARNED TICK READS ITS GUARD FROM HEAD, NEVER THE WORKING TREE (operator 2026-09-22). The incident: C173a was
// ticked at aae08ebbdb while its guard file sat UNTRACKED — green in the room that wrote it, absent in every other clone.
// `toggle` now runs the guard AS IT STANDS IN THE COMMIT: `git cat-file -e HEAD:<guard>` refuses an untracked path outright
// (`guard not committed — commit it, then tick`); a tracked one is extracted with `git show HEAD:<guard>` into a sibling
// temp file — same directory as the real guard, so its relative imports (`../../scripts/…`, `./_hermetic.mjs`) resolve
// exactly as they do for the committed file — and THAT is what runs. A room's own uncommitted edit to an already-tracked
// guard (loosen an assertion, delete a case) cannot earn a tick this way either: only the byte the commit carries can.
function guardTrackedAtHead(rel) {
  try { execFileSync('git', ['cat-file', '-e', `HEAD:${rel}`], { cwd: GUARD_REPO, stdio: 'pipe' }); return true; } catch { return false; }
}
function runGuard(rel) {
  // C474 — `../<repo>/…` runs on the sibling's committed tree (git archive), never either working tree.
  const ext = parseExternal(rel, GUARD_REPO);
  if (ext) { const r = runExternalGuard(ext); return { state: r.state === 'unmeasured' ? 'red' : r.state, detail: `${rel}: ${r.detail}${r.commit ? ` @ ${ext.name} ${r.commit.slice(0, 10)}` : ''}` }; }
  if (!guardTrackedAtHead(rel)) return { state: 'not-committed', detail: `${rel} is not committed at HEAD` };
  let headSrc;
  try { headSrc = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: GUARD_REPO, encoding: 'utf8' }); }
  catch (e) { return { state: 'not-committed', detail: `${rel} could not be read from HEAD: ${String(e.message || e).slice(0, 200)}` }; }
  const abs = resolve(GUARD_REPO, rel);
  // C501a: the copy keeps the guard's OWN extension — a CommonJS `.js` guard renamed `.mjs` ran as an ES module and died on its first
  // `require`, so the door refused a guard `node --test` read green. Same directory AND same extension = it runs as the committed file runs.
  const tmp = resolve(dirname(abs), `.${abs.split('/').pop()}.at-head-${process.pid}-${Date.now()}${extname(abs) || '.mjs'}`);
  try {
    writeFileSync(tmp, headSrc);
    const tap = execFileSync('node', ['--test', '--test-reporter=tap', tmp], { cwd: GUARD_REPO, stdio: 'pipe', timeout: guardTimeoutMs(), env: CLEAN_ENV, encoding: 'utf8' });
    const hollow = hollowReason(tap);   // C283 — exit 0 is not green when the run proves nothing
    if (hollow) return { state: 'hollow', detail: `${rel}: ${hollow}` };
    return { state: 'green', detail: rel };
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    const failing = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
    return { state: 'red', detail: failing.length ? failing.join(' · ') : `${rel} failed at HEAD` };
  } finally {
    try { rmSync(tmp); } catch {}
  }
}

if (cmd === 'status') {
  const ls = lines();
  const items = ls.map((l) => l.trim()).filter((l) => /^-\s*\[[ xX]\]/.test(l));
  const ticked = items.filter((l) => /^-\s*\[[xX]\]/.test(l));
  const named = ticked.filter((l) => guardOf(l));
  console.log(`${ticked.length}/${items.length} ticked · ${named.length} of the ticked name an acceptance`);
  for (const l of ticked.filter((l) => !guardOf(l))) {
    console.log(`  UNVERIFIABLE TICK — ${/^-\s*\[[xX]\]\s*(\S+)/.exec(l)?.[1]}: no guard named on the line`);
  }
  process.exit(0);
}

// C107d — TRIAGE IS A DOOR. `triage [--limit N] [--apply] [--json]`: every pending id gets ONE proposed verdict on one line — the
// deterministic classes (rtf-junk · separator · assistant-echo · instrument-echo · duplicate-of-<Cn>) as `dismiss`, the residue as
// `declare --as <the basin the fold computed>` with d and ring. --apply executes the deterministic dismissals ONLY (a pending-dismiss
// row on the amendments ledger, `class` named, nothing deleted from the tree) and prints the residue as the brief for ONE headless
// worker (steer-runner.mjs --triage). The residue is never declared here: a row is a judgment (C98g).
if (cmd === 'triage') {
  const { pendingAsks, LEDGER, TREE, readTree, triageVerdicts, triageLine, triageBrief, transcriptCorpus } = await import('./spec-tree.mjs');
  let tree = null; try { tree = readTree(TREE); } catch { console.error(`no spec tree at ${TREE} — fold first: node scripts/vna/spec-tree.mjs`); process.exit(2); }
  const P = pendingAsks(tree, { ledger: LEDGER, specMd: readFileSync(SPEC, 'utf8') });
  const limit = flag('--limit') ? Number(flag('--limit')) : Infinity;
  const T = triageVerdicts(P, { corpus: transcriptCorpus(LEDGER), limit });
  const apply = argv.includes('--apply'); const at = new Date().toISOString(); let applied = 0;
  if (apply) {
    mkdirSync(dirname(LEDGER), { recursive: true });
    for (const v of T.verdicts) {
      if (v.verdict !== 'dismiss') continue;
      appendFileSync(LEDGER, JSON.stringify({ at, source: 'pending', status: 'dismissed', kind: 'pending-dismiss', pending: v.id, basin: v.basin, row: v.row, hash: v.hash, class: v.class, why: v.why, by: process.env.VNA_BY || 'spec-check triage', text: (P.held.find((h) => h.id === v.id) || P.pending.find((p) => p.id === v.id) || {}).text || null }) + '\n');
      applied++;
    }
  }
  const after = T.counts.pending - T.verdicts.filter((v) => v.verdict === 'dismiss' && !v.retyped).length;
  const line = regrip(`triage · ${T.counts.pending} pending + ${T.counts.held} held by the fold → ${T.counts.residue} residue · ${T.counts['rtf-junk']} rtf-junk · ${T.counts.separator} separators · ${T.counts['assistant-echo']} assistant-echo · ${T.counts['instrument-echo']} instrument-echo · ${T.counts.duplicate} duplicates (τ ${T.tau})${apply ? ` · ${applied} dismissals written to ${LEDGER.slice(REPO.length + 1)}` : ' · proposals only (--apply writes the deterministic dismissals)'}`);
  // a piped stdout is async: exit in the write callback or the JSON is cut mid-string (seen at 7,932 bytes, 2026-09-20)
  const out = argv.includes('--json') ? JSON.stringify({ ...T.counts, tau: T.tau, after, applied, verdicts: T.verdicts, brief: triageBrief(T.residue) })
    : [line, ...T.verdicts.map((v) => '  ' + triageLine(v)), ...(T.residue.length ? ['', apply ? triageBrief(T.residue) : `${T.residue.length} residue — the brief for one headless worker prints with --apply; dispatch: node scripts/vna/steer-runner.mjs --triage`] : [])].join('\n');
  process.stdout.write(out + '\n', () => process.exit(0)); await new Promise(() => {});
}

if (cmd === 'declare' || cmd === 'dismiss') {
  const pid = argv[1] && /^P\d+\.\d+$/.test(argv[1]) ? argv[1] : null;
  if (!pid) { console.error(`usage: spec-check.mjs ${cmd} P<row>.<k> ${cmd === 'declare' ? '--as <Cn>' : '--why "…"'}`); process.exit(2); }
  const { pendingAsks, LEDGER, TREE, readTree } = await import('./spec-tree.mjs');
  // C562 FOUND: a raw JSON.parse of the tree has no revision text since C165's blob split — declare wrote the row as "undefined"
  let tree = null; try { tree = readTree(TREE); } catch { console.error(`no spec tree at ${TREE} — fold first: node scripts/vna/spec-tree.mjs`); process.exit(2); }
  const P = pendingAsks(tree, { ledger: LEDGER, specMd: readFileSync(SPEC, 'utf8') });
  const ask = P.pending.find((p) => p.id === pid);
  if (!ask) {
    if (P.declared.includes(pid)) console.error(`${pid} REFUSED — already declared as a row of the spec (the basin names "from pending ${pid}")`);
    else if (P.dismissed.includes(pid)) console.error(`${pid} REFUSED — already dismissed on the amendments ledger`);
    else console.error(`${pid} is not pending — ${P.pending.length} pending from row ${P.fromRow} on: ${P.pending.map((p) => p.id).join(' ') || 'none'}`);
    process.exit(1);
  }
  const at = new Date().toISOString();
  if (cmd === 'dismiss') {
    const why = flag('--why');
    if (!why || !why.trim()) { console.error(`${pid} REFUSED — a dismissal without --why is a deletion, not a decision (AXIOM 1: the reason is the record)`); process.exit(2); }
    mkdirSync(dirname(LEDGER), { recursive: true });
    appendFileSync(LEDGER, JSON.stringify({ at, source: 'pending', status: 'dismissed', kind: 'pending-dismiss', pending: pid, basin: ask.basin, row: ask.row, hash: ask.hash, why: why.trim(), by: process.env.VNA_BY || 'spec-check', text: ask.text }) + '\n');
    console.log(`${pid} DISMISSED — row on ${LEDGER.slice(REPO.length + 1)}: ${why.trim()}`);
    process.exit(0);
  }
  const as = flag('--as');
  const fam = /^(C\d+)([a-z]?)$/.exec(String(as || '').trim());
  if (!fam) { console.error(`${pid} REFUSED — --as names a basin like C94 or C94c (got ${JSON.stringify(as ?? null)})`); process.exit(2); }
  const ls = lines();
  const parent = findItem(ls, fam[1]);
  if (!parent) { console.error(`${pid} REFUSED — no basin ${fam[1]} in ${SPEC.slice(REPO.length + 1)}${fam[2] ? ` (asked for ${as})` : ''}`); process.exit(1); }
  if (fam[2] && !findItem(ls, as)) { console.error(`${pid} REFUSED — no basin ${as} in ${SPEC.slice(REPO.length + 1)}`); process.exit(1); }
  // the family's lettered sub-rows sit directly under the parent, two-space indented; the new row goes after the last of them
  let last = parent.i, letter = 'a'.charCodeAt(0);
  for (let i = parent.i + 1; i < ls.length; i++) {
    const m = new RegExp(`^\\s*-\\s*\\[[ xX]\\]\\s*${fam[1]}([a-z])\\b`).exec(ls[i]);
    if (m) { last = i; letter = Math.max(letter, m[1].charCodeAt(0) + 1); continue; }
    if (/^\s*-\s*\[[ xX]\]\s*(?:C\d+|T\d+)\b/.test(ls[i]) && !ls[i].startsWith('  ')) break;   // the next top-level row ends the family
  }
  if (letter > 'z'.charCodeAt(0)) { console.error(`${pid} REFUSED — ${fam[1]} has no free letter left`); process.exit(1); }
  const label = `${fam[1]}${String.fromCharCode(letter)}`;
  if (typeof ask.text !== 'string' || !ask.text.trim()) { console.error(`${pid} REFUSED — the ask carries no text on the tree (blob ${ask.tsha || 'unknown'} not read); a row without its words is not a declaration`); process.exit(1); }
  const text = String(ask.text).replace(/\s+/g, ' ').trim();
  const row = `  - [ ] ${label} (declared ${at.slice(0, 10)} from pending ${pid}) (released by the fold to ${ask.basin} at d ${ask.ncd}${fam[2] && fam[2] !== String(ask.basin).replace(/^C\d+/, '') ? `; declared under ${as}` : ''}) ${text}`;
  ls.splice(last + 1, 0, row);
  writeFileSync(SPEC, ls.join('\n'));
  console.log(`${pid} DECLARED as ${label} under ${fam[1]} in ${SPEC.slice(REPO.length + 1)} — re-fold to list it as a basin: node scripts/vna/spec-tree.mjs`);
  process.exit(0);
}

// C378 — A WORKER REWRITES ITS OWN ROW. `rewrite <Cn> --text "…"` replaces the row's own words with a text the worker
// wrote from its updated understanding of what it is building; the checkbox and the label never move, and the write
// is REFUSED if any `*"…"*` span the row already carries would be dropped (row-rewrite.mjs) — the operator's own
// sentence is the row's warrant, never the worker's to paraphrase away. The fold (spec-tree.mjs basins(), C109f)
// picks up the changed hash next run and archives the prior words as a version; nothing here writes the tree.
if (cmd === 'rewrite') {
  const rid = argv[1];
  if (!rid || !/^(?:C\d+[a-z]?|T\d+)$/.test(rid)) { console.error('usage: spec-check.mjs rewrite <Cn> --text "…"'); process.exit(2); }
  const proposed = flag('--text');
  if (!proposed || !proposed.trim()) { console.error(`${rid} REFUSED — rewrite needs --text "…"`); process.exit(2); }
  const ls = lines();
  const found = findItem(ls, rid);
  if (!found) { console.error(`no checklist item ${rid} in ${SPEC.slice(REPO.length + 1)}`); process.exit(2); }
  const same = rowsWithId(ls, rid);
  if (same.length > 1) { console.error(`${rid} REFUSED — ${same.length} rows carry this id (lines ${same.map((i) => i + 1).join(', ')}); one id names one row (C255b)`); process.exit(1); }
  const lm = new RegExp(`^(\\s*-\\s*\\[[ xX]\\]\\s*${rid}\\s*)(.*)$`).exec(ls[found.i]);
  const r = rewriteRow(lm[2], proposed);
  if (!r.ok) { console.error(`${rid} REFUSED — ${r.why}`); process.exit(1); }
  ls[found.i] = lm[1] + r.text;
  writeFileSync(SPEC, ls.join('\n'));
  console.log(`${rid} REWRITTEN in ${SPEC.slice(REPO.length + 1)} — re-fold to archive the prior words as a version: node scripts/vna/spec-tree.mjs`);
  process.exit(0);
}

const id = flag('--item');
if (!id) { console.error('usage: spec-check.mjs toggle --item <Cn>'); process.exit(2); }
const ls = lines();
const found = findItem(ls, id);
if (!found) { console.error(`no checklist item ${id} in ${SPEC.slice(REPO.length + 1)}`); process.exit(2); }
const same = rowsWithId(ls, id);
if (same.length > 1) { console.error(`${id} REFUSED — ${same.length} rows carry this id (lines ${same.map((i) => i + 1).join(", ")}); one id names one row (C255b). Rename one, then toggle.`); process.exit(1); }

const guard = guardOf(found.line);
const pre = tickDecision({ done: found.done, guard, state: null });   // before the guard runs: untick, refuse (no guard), or run it
if (pre.action === 'untick') {
  // Withdrawing a claim never needs the guard's permission.
  ls[found.i] = ls[found.i].replace(/\[[xX]\]/, '[ ]');
  writeFileSync(SPEC, ls.join('\n'));
  console.log(`${id} UNTICKED — a withdrawn claim needs no proof, only the claim did`);
  process.exit(0);
}
if (pre.code === 'no-guard') {
  console.error(`${id} REFUSED — no acceptance named on its line.`);
  console.error(`  A tick with nothing to check is a claim nobody can verify, and the sufficiency axis counts it as insufficient.`);
  console.error(`  Add: guard: \`tests/…\` to the item, then tick it.`);
  process.exit(1);
}
const r = runGuard(guard);
// C283 — THE GUARD MUST BE ABLE TO FAIL. Green at HEAD is half the receipt; the other half is RED on the tree before the change.
// The witness commit is --witness <sha>, else the commit that first added the guard file; its guard runs on that commit's parent
// (steer-runner's redWitness: the same archive, the same classification the loop grades workers by). GREEN-ON-PARENT — the guard
// passed before the change it claims to prove — refuses the tick; so does UNMEASURED (it could not run there), with its why.
if (r.state === 'green' && !process.env.VNA_SPEC_CHECK_NO_WITNESS) {
  const extW = parseExternal(guard, GUARD_REPO);
  if (extW) {
    const w = externalWitness(extW, { witness: flag('--witness') });
    if (w.verdict !== 'RED') { r.state = w.verdict === 'GREEN-ON-PARENT' ? 'green-on-parent' : 'witness-unmeasured'; r.detail = `${w.why}${w.verdict === 'GREEN-ON-PARENT' ? ' — a guard that cannot fail proves nothing; name the commit it was written against: --witness <sha>' : ''}`; }
    else console.log(`  red witness: ${guard} ${w.why} and passes at HEAD`);
  } else {
  const { redWitness, originWitness } = await import('./steer-runner.mjs');
  // C1334: a guard that was renamed after it was written must witness against the commit that introduced its CONTENT,
  // never the rename — `originWitness` follows the rename chain back; the default unfollowed `git log` here would stop
  // at whichever commit last moved the file and read GREEN-ON-PARENT against a parent that already held the passing guard.
  const witness = flag('--witness') || originWitness(guard, { repo: GUARD_REPO });
  if (!witness) { r.state = 'no-witness'; r.detail = `no commit adds ${guard} — name one: --witness <sha>`; }
  else {
    const { tmpdir } = await import('node:os');
    const w = redWitness({ repo: GUARD_REPO, head: witness, tests: [guard], scratchRoot: tmpdir() });
    if (w.verdict !== 'RED') { r.state = w.verdict === 'GREEN-ON-PARENT' ? 'green-on-parent' : 'witness-unmeasured'; r.detail = `at ${witness.slice(0, 10)}~1: ${w.why}${w.verdict === 'GREEN-ON-PARENT' ? ' — a guard that cannot fail proves nothing; name the commit it was written against: --witness <sha>' : ''}`; }
    else console.log(`  red witness: ${guard} fails at ${witness.slice(0, 10)}~1 and passes at HEAD`);
  }
  }
}
const td = tickDecision({ done: found.done, guard, state: r.state });   // C236 S2: tick ⇔ the guard, as it stands in HEAD, ran green
if (td.code === 'not-committed') {
  console.error(`${id} REFUSED — guard not committed — commit it, then tick`);
  console.error(`  ${r.detail}`);
  process.exit(1);
}
if (td.action !== 'tick') {
  console.error(`${id} REFUSED — its acceptance is ${r.state}: ${r.detail}`);
  console.error(`  The markdown is unchanged. Fix the acceptance, or fix what it measures.`);
  process.exit(1);
}
// C178b — A WRITER HOLDING AN OLDER COPY OF THIS FILE NEVER REVERTS ANOTHER WRITER'S ROW. `ls` above was read before
// runGuard ran the guard (up to 300s) — another writer (a hand edit, spec-check declare, steer.mjs text→rows) may have
// appended or amended rows in that window. Writing the stale `ls` back would silently drop that edit — last-writer-wins,
// the exact class of bug that flipped C173a [x]→[ ] on 2026-09-22 with no amendment row. So: re-read the file, splice
// ONLY this row's own checkbox into the CURRENT text, never the snapshot taken before the guard ran.
const fresh = lines();
const freshFound = findItem(fresh, id);
if (!freshFound) { console.error(`${id} REFUSED — the row was removed from ${SPEC.slice(REPO.length + 1)} while its guard ran; nothing written`); process.exit(1); }
if (freshFound.done) { console.log(`${id} already ticked by another writer while its guard ran — nothing to do`); process.exit(0); }
fresh[freshFound.i] = fresh[freshFound.i].replace(/\[\s\]/, '[x]');
writeFileSync(SPEC, fresh.join('\n'));
console.log(`${id} TICKED — ${guard} is green`);
