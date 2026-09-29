// packages/thetacog-mcp/scripts/tape/sharpen-rules.mjs — THE RULES GET SHARPER AS THE WORK RUNS.
//
// Operator, 2026-08-20: "make the rules more effective, that's the llm's job as it's working."
//
// ── WHAT "MORE EFFECTIVE" MEANS, AND WHY IT IS NOT A TASTE JUDGEMENT ──────────────────────────
// A locked coordinate is a rule that defines what the project IS. Until today "effective" would
// have been a matter of opinion, so a rewrite loop would have been an LLM grading its own prose —
// the exact circularity the receipt rule bans. Measuring the question metric gave a way out of it:
//
//   A rule is EFFECTIVE when, folded into the body of locked rules, it makes the rest of the body
//   READ DIFFERENTLY — each other rule pulled its own way. It is INEFFECTIVE when the body lands on
//   fewer distinct cells than it occupied, because that is the rule's text swamping every reading
//   rather than informing any of them.
//
// That was measured, not assumed. Ranking three candidate questions showed the separation has
// nothing to do with length — the LONGEST answers collapsed the body least — and everything to do
// with vocabulary. A rule phrased in the project's own terms pulls each other rule differently. A
// rule phrased in a corner's terms reads the same against everything, and a rule that reads the
// same against everything cannot constrain anything.
//
// ── THE DIVISION OF LABOUR, WHICH IS THE WHOLE POINT ──────────────────────────────────────────
// The LLM PROPOSES. The chip DISPOSES. Sonnet writes candidate rephrasings; every acceptance
// decision is made by the LLM-free ballistic walk. No model is anywhere near the verdict, which
// keeps this on the right side of THE RECEIPT IS LLM-FREE while still being, as the operator put
// it, the LLM's job. And the proposals fan out with Promise.all — never a sequential await-loop
// over a model call (CLAUDE.md · QWEN IS BANNED FROM ACTIVE TASKS, guarded by
// tests/shoot/no-sequential-model-loop.test.mjs).
//
// ── THE THREE GATES, IN ORDER. A CANDIDATE MUST PASS ALL THREE ────────────────────────────────
//   1. FIDELITY      the candidate must place within Chebyshev 1 of the original's coordinate.
//                    Sharpening changes the PHRASING, never the decision. A rewrite that lands
//                    somewhere else on the lattice has silently re-decided something, and shipping
//                    it as an improvement would be drift wearing an improvement's clothes. This is
//                    the gate that makes the loop safe to run unattended.
//   2. NON-COLLAPSE  the candidate must not reduce the number of distinct cells the body occupies.
//   3. IMPROVEMENT   the candidate's reorganization must STRICTLY exceed the incumbent's. Ties lose,
//                    so the loop cannot churn the ledger with lateral rewrites.
//
// Nothing is ever overwritten: an accepted rewrite is a fork-forward append to coordinates.ndjson
// carrying the prior text, both scores, and the gate readings, so the sharpening is auditable and
// reversible by reading the tape backwards.
//
//   node packages/thetacog-mcp/scripts/tape/sharpen-rules.mjs --slug gddadwill [--id COORD-004]
//                                                             [--candidates 4] [--apply] [--json]
//
// Without --apply this MEASURES and prints and writes nothing. That is the default on purpose: the
// first run of a rewrite loop should never be the one that edits the ledger.
//
// @guard tests/tape/sharpen-preserves-the-decision.test.mjs

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

/** Ask Sonnet for ONE rephrasing. Text in, text out — this process never edits a file. */
export function proposeRewrite(rule, siblings, seed) {
  const prompt = [
    'You are sharpening ONE rule in a project specification. Rules here are semantic coordinates:',
    'each one states what the project IS, in a way that constrains later decisions.',
    '',
    'THE RULE TO SHARPEN:',
    rule,
    '',
    'THE OTHER RULES ALREADY LOCKED IN THIS PROJECT (for vocabulary and register — do not restate them):',
    ...siblings.map((s) => `- ${s}`),
    '',
    'Rewrite the rule so it is MORE EFFECTIVE, meaning:',
    '  · it uses this project\'s own vocabulary, as visible in the other rules, rather than generic',
    '    software-engineering words. A rule phrased in generic terms reads the same against every',
    '    other rule and therefore constrains nothing.',
    '  · it says what MUST or MUST NOT happen, concretely enough that a later change could violate it',
    '    and you could point at the violation.',
    '  · it stays ONE decision. Do not merge in a second idea, do not add a caveat that softens it.',
    '',
    'ABSOLUTE CONSTRAINT: do not change what the rule DECIDES. Same decision, sharper words. If you',
    'cannot improve it without changing the decision, return the original text unchanged.',
    '',
    seed ? `Bias this attempt toward: ${seed}` : '',
    '',
    'Output ONLY the rewritten rule as a single paragraph of plain prose. No preamble, no quotes, no',
    'markdown, no explanation.',
  ].filter(Boolean).join('\n');

  return new Promise((res) => {
    const child = spawn('env', [
      '-u', 'CLAUDECODE', '-u', 'CLAUDE_CODE_ENTRYPOINT',
      '-u', 'ANTHROPIC_API_KEY', '-u', 'ANTHROPIC_AUTH_TOKEN', '-u', 'ANTHROPIC_BASE_URL',
      'claude', '-p', prompt, '--model', 'sonnet', '--output-format', 'json',
    ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} res({ ok: false, error: 'timeout after 180s' }); }, 180_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); res({ ok: false, error: String(e.message) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      // `claude -p --output-format json` reports fatal errors on STDOUT with an empty stderr, so the
      // diagnostic has to be dug out of the envelope or the row says "exit 1:" and nothing after it.
      if (code !== 0) {
        let why = String(err).trim().slice(0, 300);
        try { const j = JSON.parse(out); why = j.result || j.error || j.terminal_reason || why; } catch { /* not JSON */ }
        return res({ ok: false, error: `claude exit ${code}: ${why || '(no output)'}` });
      }
      let text = out;
      try { text = String(JSON.parse(out).result || out); } catch { /* raw */ }
      res({ ok: true, text: text.trim().replace(/^["'`]+|["'`]+$/g, '') });
    });
  });
}

/**
 * Grade a candidate rule against the body, LLM-FREE. Returns the three gate readings.
 * `physics` is injected so the guard can drive this with a deterministic placer.
 */
export async function gradeRule(candidate, siblings, incumbentCoord, P, Q) {
  const context = siblings.join('\n');
  const place = async (t) => { const r = await P.placeText(t); return r.available ? P.representativeCoord(r.coords) : null; };

  const ownCoord = await place(context ? `${context}\n${candidate}` : candidate);
  const fidelity = incumbentCoord && ownCoord ? Q.chebyshev(incumbentCoord, ownCoord) : null;

  const base = [], withRule = [];
  for (const s of siblings) {
    base.push(await place(`${context}\n${s}`));
    withRule.push(await place(`${context}\n${candidate}\n${s}`));
  }
  const baseDistinct = new Set(base.filter(Boolean)).size;
  const field = Q.displacementField(base, withRule);
  return {
    ownCoord, fidelity,
    baseDistinct, distinct: field.distinct,
    collapses: field.n > 0 && field.distinct < baseDistinct,
    translation: field.translation,
    reorganization: field.reorganization,
    unmeasured: field.reason,
  };
}

/** The three gates, applied in order, each with the reason it fired. */
export function verdict(cand, incumbent, { maxDrift = 1 } = {}) {
  if (cand.reorganization === null) return { accept: false, gate: 'UNMEASURED', why: cand.unmeasured || 'the candidate could not be placed against the body' };
  if (cand.fidelity === null) return { accept: false, gate: 'FIDELITY', why: 'the candidate or the incumbent could not be placed, so fidelity is unknown — never assume it held' };
  if (cand.fidelity > maxDrift) return { accept: false, gate: 'FIDELITY', why: `the rewrite moved ${cand.fidelity} cells from the incumbent (${cand.ownCoord}); that is a different decision, not sharper words` };
  if (cand.collapses) return { accept: false, gate: 'NON-COLLAPSE', why: `the body drops to ${cand.distinct} of ${cand.baseDistinct} distinct cells — this text swamps every reading instead of informing them` };
  if (!(cand.reorganization > (incumbent.reorganization ?? -Infinity))) {
    return { accept: false, gate: 'IMPROVEMENT', why: `reorganization ${cand.reorganization} does not beat the incumbent's ${incumbent.reorganization}; ties lose so the ledger cannot churn on lateral rewrites` };
  }
  return { accept: true, gate: null, why: `reorganization ${incumbent.reorganization} → ${cand.reorganization}, same decision (${cand.fidelity} cells from the incumbent), body still occupies ${cand.distinct}/${cand.baseDistinct} cells` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const only = arg('--id', null);
  const nCand = Math.max(1, parseInt(arg('--candidates', '4'), 10) || 4);
  const apply = process.argv.includes('--apply');

  const P = await import(resolve(HERE, 'physics.mjs'));
  const Q = await import(resolve(HERE, 'next-question.mjs'));
  const { liveCoordinates } = await import(resolve(HERE, 'coordinates.mjs'));
  const locked = liveCoordinates(slug).filter((c) => c.rule);
  if (!locked.length) { console.error(`  no locked coordinates in "${slug}" — nothing to sharpen`); process.exit(2); }

  const targets = only ? locked.filter((c) => c.id === only) : locked;
  if (!targets.length) { console.error(`  no coordinate "${only}" in "${slug}"`); process.exit(2); }

  console.log(`\n  SHARPENING ${targets.length} of ${locked.length} locked rule(s) · ${nCand} candidates each · ${apply ? 'APPLY' : 'MEASURE ONLY (pass --apply to write)'}\n`);

  const SEEDS = [
    'naming the exact file or artifact the rule governs',
    'stating the forbidden form as well as the required one',
    'using the noun the other rules already use for this thing',
    'making the violation observable — what you would see if it broke',
  ];

  for (const t of targets) {
    const siblings = locked.filter((c) => c.id !== t.id).map((c) => c.rule);
    const incumbent = await gradeRule(t.rule, siblings, t.coord, P, Q);
    console.log(`  ${t.id}  ${t.coord || 'UNMEASURED'}  incumbent reorganization ${incumbent.reorganization ?? 'UNMEASURED'}${incumbent.collapses ? '  ⚠ THE INCUMBENT ITSELF COLLAPSES THE BODY' : ''}`);
    console.log(`     "${String(t.rule).slice(0, 110)}${t.rule.length > 110 ? '…' : ''}"`);

    // PROPOSALS FAN OUT. Never a sequential await-loop over a model call.
    const proposals = await Promise.all(
      Array.from({ length: nCand }, (_, i) => proposeRewrite(t.rule, siblings, SEEDS[i % SEEDS.length])),
    );
    const usable = proposals.filter((r) => r.ok && r.text && r.text !== t.rule);
    if (proposals.some((r) => !r.ok)) {
      for (const r of proposals.filter((x) => !x.ok)) console.log(`     ✗ proposal failed — ${r.error}`);
    }
    if (!usable.length) { console.log('     no usable proposal — rule unchanged\n'); continue; }

    const graded = [];
    for (const u of usable) {
      const g = await gradeRule(u.text, siblings, t.coord, P, Q);
      graded.push({ text: u.text, ...g, verdict: verdict(g, incumbent) });
    }
    graded.sort((a, b) => (b.verdict.accept ? 1 : 0) - (a.verdict.accept ? 1 : 0) || (b.reorganization ?? 0) - (a.reorganization ?? 0));

    for (const g of graded) {
      console.log(`     ${g.verdict.accept ? '✓ ACCEPT' : `✗ ${g.verdict.gate}`}  reorg ${String(g.reorganization).padStart(6)}  drift ${g.fidelity}  cells ${g.distinct}/${g.baseDistinct}`);
      console.log(`        ${g.verdict.why}`);
      console.log(`        "${g.text.slice(0, 110)}${g.text.length > 110 ? '…' : ''}"`);
    }

    const winner = graded.find((g) => g.verdict.accept);
    if (!winner) { console.log('     nothing beat the incumbent — rule unchanged\n'); continue; }
    if (!apply) { console.log('     (measure-only — pass --apply to fork this forward)\n'); continue; }

    // FORK FORWARD. The prior text and both scores ride along so the tape explains itself.
    const live = locked.find((c) => c.id === t.id);
    appendFileSync(resolve(SESSIONS, slug, 'coordinates.ndjson'), JSON.stringify({
      ...live,
      rule: winner.text,
      ts: new Date().toISOString(),
      sharpened: {
        from: t.rule,
        incumbentReorganization: incumbent.reorganization,
        reorganization: winner.reorganization,
        fidelityCells: winner.fidelity,
        distinct: `${winner.distinct}/${winner.baseDistinct}`,
        why: winner.verdict.why,
        proposedBy: 'claude -p --model sonnet',
        gradedBy: 'the LLM-free ballistic walk — no model touched the acceptance decision',
      },
    }) + '\n');
    console.log(`     → forked forward on ${t.id}\n`);
  }
}
