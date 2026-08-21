// packages/thetacog-mcp/scripts/tape/question-retirement.mjs — A CLOSED LOOP RETIRES ITS OWN QUESTION.
//
// ── WHY THIS IS THE CENTRAL TEST, NOT A UI DETAIL ─────────────────────────────────────────────
// Operator, three times and increasingly plainly: "the cockpit question is still there (I already
// answered it!) — that's a giveaway that the tape is not working", "the gui still gets clobbered",
// and "should be able to write the file as you serve it."
//
// None of those were rendering bugs. The question survived its own answer because nothing ever
// checked whether it had been answered, and nothing ever recorded that it had. The page was not
// blanked — it was refilled with identical stale state, which is worse: it looks alive while nothing
// moves, and it makes convergence UNTESTABLE. A system whose output is constant by construction can
// never be shown to narrow, so the null test the operator asked for could not even be run.
//
// ── HOW RETIREMENT IS DECIDED, LLM-FREE ───────────────────────────────────────────────────────
// A question is RETIRED when a coordinate locked AFTER its ranking timestamp says substantially the
// same thing as one of its answers. Measured with match() from physics.mjs — the ONE canonical
// gzip-NCD sensor, slid at the answer's own length so a longer coordinate cannot win by covering more
// ground. Never a second similarity formula; this repo has one sensor and adding another is how the
// panel got two doors.
//
// Measured on this repo when the check first ran: Q-WHO retired by COORD-010 at C,B1 saying the
// "private" answer at ncd 0.0752 — near-identical, and it had been served as "active" for 78 minutes.
//
// ── WRITE AS YOU SERVE ────────────────────────────────────────────────────────────────────────
// Retirement is APPENDED to questions.ndjson the first time it is observed, so it is durable, visible
// to the CLI, and not recomputed on every page load (the check shells out to the real walk — cheap
// once, wasteful every render). Append-only and idempotent: a second observation of the same
// retirement writes nothing. The ledger is the truth; this adds a fact to it rather than mutating one.
//
// @guard tests/tape/question-retires-when-answered.test.mjs

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

// MEASURED, not chosen. 0.62 was a guess and it was dangerously loose — the question's OWN OPPOSITE
// ANSWER scores 0.6316, so at 0.62 a question could nearly retire on the answer the operator did NOT
// pick, which is a decision silently lost. Measured separation on real text:
//     0.0752  the answer vs the coordinate that actually took it
//     0.6316  the answer vs its own opposite answer      <- the near-miss 0.62 would have allowed
//     0.6992  the answer vs an unrelated rule
// A second retirement check, built independently in api/closure, measured the same boundary from a
// different direction and landed on 0.52: true match 0.48 against 0.54-0.62 for every unrelated or
// other-question pairing. Both roads lead between 0.52 and 0.63, and 0.52 is the conservative end.
// Being conservative is correct here: failing to retire a question is visible and annoying, while
// wrongly retiring one silently drops a decision the operator still needed to make.
export const RETIRE_NCD = 0.52;

export async function retirementFor(slug, ask, askTs, { record = true } = {}) {
  if (!ask?.answers?.length) return { checked: false, reason: 'the record carries no answers to match against' };
  const answers = ask.answers.filter((a) => a.rule);
  if (!answers.length) return { checked: false, reason: 'the answers carry no rule text to match against — an older ranking record' };

  let P, C;
  try {
    P = await import(resolve(HERE, 'physics.mjs'));
    C = await import(resolve(HERE, 'coordinates.mjs'));
  } catch (e) {
    return { checked: false, reason: `sensor unavailable: ${String(e.message).slice(0, 160)}` };
  }

  const after = C.liveCoordinates(slug).filter((c) => c.rule && c.ts && Date.parse(c.ts) > Date.parse(askTs));
  const hits = [];
  for (const c of after) {
    for (const a of answers) {
      const m = P.match(a.rule, c.rule);
      if (Number.isFinite(m.plateMatch)) hits.push({ id: c.id, coord: c.coord, label: a.label, ncd: m.plateMatch, ts: c.ts });
    }
  }
  hits.sort((x, y) => x.ncd - y.ncd);
  const best = hits[0] || null;
  const retired = !!best && best.ncd <= RETIRE_NCD;

  const out = {
    checked: true, retired,
    coordinatesSince: after.length,
    answeredBy: retired ? best : null,
    nearest: best,
    threshold: RETIRE_NCD,
    reason: retired
      ? `${best.id} locked at ${best.coord} says the "${best.label}" answer (ncd ${best.ncd})`
      : after.length === 0
        ? 'no coordinate has been locked since this question was ranked — the loop has not turned'
        : `${after.length} coordinate(s) locked since, none close enough to an answer (nearest ncd ${best ? best.ncd : 'none placeable'} against a ${RETIRE_NCD} threshold)`,
  };

  if (retired && record) out.recorded = recordRetirement(slug, ask, out);
  return out;
}

/** Append the retirement once. Idempotent — a second sighting of the same pair writes nothing. */
export function recordRetirement(slug, ask, verdict) {
  const p = resolve(SESSIONS, slug, 'questions.ndjson');
  if (!existsSync(p)) return { written: false, reason: 'no questions.ndjson to append to' };
  try {
    const already = readFileSync(p, 'utf8').split('\n').filter(Boolean).some((l) => {
      try { const r = JSON.parse(l); return r.kind === 'retired' && r.askId === ask.id && r.by === verdict.answeredBy?.id; } catch { return false; }
    });
    if (already) return { written: false, reason: 'this retirement was already recorded' };
    appendFileSync(p, JSON.stringify({
      kind: 'retired', ts: new Date().toISOString(),
      askId: ask.id, question: ask.question,
      by: verdict.answeredBy.id, coord: verdict.answeredBy.coord,
      answer: verdict.answeredBy.label, ncd: verdict.answeredBy.ncd,
      sensor: 'gzip-NCD via physics.mjs match() — LLM-free',
    }) + '\n');
    return { written: true };
  } catch (e) { return { written: false, reason: String(e.message).slice(0, 160) }; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // ── STDOUT MUST BE BLOCKING BEFORE ANY process.exit() ───────────────────────────────────────
  // MEASURED twice, by two agents, on two different files: a JSON payload piped through execFile()
  // is silently CUT at ~8,188 bytes when the process exits right after logging it. exit() tears the
  // process down before the pipe drains, so the reader gets a PREFIX — and a prefix of valid JSON is
  // invalid JSON, surfacing in the caller as "Unterminated string in JSON at position 8180" with no
  // hint that truncation happened. It is invisible under 8KB, so it ships green and only bites once a
  // session grows.
  //
  // Making stdout blocking is the fix that preserves control flow. Dropping the exit() instead lets
  // the CLI fall through and print its human output after the JSON, which corrupts the payload a
  // different way — tried that first, and the parser said so immediately.
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const p = resolve(SESSIONS, slug, 'questions.ndjson');
  if (!existsSync(p)) { console.error(`no questions.ndjson for "${slug}"`); process.exit(2); }
  const records = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const idx = records.map((r) => !!r.ask).lastIndexOf(true);
  if (idx < 0) { console.error('no ranking record carries a question'); process.exit(2); }
  const rec = records[idx];
  const v = await retirementFor(slug, rec.ask, rec.ts, { record: !process.argv.includes('--dry') });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(v)); process.exit(0); }
  console.log(`\n  ${rec.ask.id} — ${rec.ask.question}`);
  console.log(`  ${v.retired ? '✓ RETIRED' : v.checked ? '· still open' : '? UNMEASURED'} — ${v.reason}`);
  if (v.recorded) console.log(`  recorded: ${v.recorded.written ? 'appended to questions.ndjson' : v.recorded.reason}`);
  console.log('');
}
