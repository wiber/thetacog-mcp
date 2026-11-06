// scripts/vna/no-river.mjs — C626 THE NO-RIVER ARM. The one NOT BUILT row on the C611h infographic ledger, IR-B2 "Lobotomized
// Prompting (No River)": "no arm compares a negative-prompt brief against a plain one on the same rows". Operator 2026-10-03,
// stop-hook goal verbatim: *"dont stop untill all my asks are converted to rust, measured"*.
//
// Variant N of the replay bench is variant A's brief VERBATIM plus NO_RIVER_BLOCK below: heavy negative constraints (NEVER / DO
// NOT lines) and a narrow output schema. The block is FROZEN here — editing it changes NO_RIVER_SHA, and every N trial row carries
// the sha it ran under, so a reading never pools two different blocks (noRiverReading counts only rows stamped with today's sha).
//
// noRiverReading(rows) is the reading IR-B2 resolves to, computed from the bench's own recorded rows (.thetacog/replay-bench.ndjson)
// and nothing else: landed/trials per arm with Wilson 95 % intervals, the rate gap (A − N) with its Newcombe hybrid-score 95 %
// interval, n per arm. MEASURED only at n ≥ 20 per arm with the gap's interval excluding 0; otherwise UNMEASURED with the n — never
// a typed number. SAME TASKS: N's valid rows define the engine, the task set and the start time; an A row counts only on that
// engine, on one of those tasks, at or after N's first trial (the interleaved run puts both arms in the same machine hour).
// SUFFICIENT FOR: "on these tasks, with this worker, does the negative-prompt block move the landed rate?"
// NOT SUFFICIENT FOR: whether negative prompting costs reasoning in general, on other models, or on other kinds of task.
// Light by construction (zero imports beyond node:crypto) so the infographic checker reads it without loading the bench.
// PORT ROW: C626-rust — the reading DECIDES a verdict; it moves into the crate beside the C611h port once green in use.
import { createHash } from 'node:crypto';

export const NO_RIVER_BLOCK = [
  'NO-RIVER CONSTRAINTS (frozen, C626 variant N — follow every line exactly):',
  '- NEVER explain your reasoning.',
  '- NEVER think out loud or describe a plan.',
  '- NEVER open a file the guard does not import.',
  '- NEVER modify a test file.',
  '- NEVER create a new file.',
  '- NEVER add a comment to the code.',
  '- NEVER refactor, rename or reformat anything.',
  '- NEVER ask a question.',
  '- DO NOT explore the repository.',
  '- DO NOT run any command except node --test on the guard, git add and git commit.',
  '- DO NOT change more than 12 lines.',
  '- DO NOT write prose of any kind.',
  'OUTPUT SCHEMA — your final message is exactly one line, and nothing else:',
  'DONE <the one path you changed>',
  'or',
  'FAIL <one word>',
].join('\n');
export const NO_RIVER_SHA = createHash('sha256').update(NO_RIVER_BLOCK).digest('hex');
/** variant N = variant A's brief, verbatim, then one blank line, then the frozen block */
export const noRiverBrief = (briefA) => `${briefA}\n\n${NO_RIVER_BLOCK}`;

export const MIN_N = 20;
/** Wilson 95 % interval for x successes in n — a rate is never reported without its interval (C265; the bench re-exports this one) */
export function wilson(x, n, z = 1.96) {
  if (!n) return [null, null];
  const p = x / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)].map((v) => Math.round(v * 1000) / 1000);
}
/** the 95 % interval of pA − pB from the two Wilson intervals (Newcombe 1998, method 10) */
export function gapInterval(xa, na, xb, nb) {
  if (!na || !nb) return [null, null];
  const pa = xa / na, pb = xb / nb, [la, ua] = wilson(xa, na), [lb, ub] = wilson(xb, nb), d = pa - pb;
  const r = (v) => Math.round(v * 1000) / 1000;
  return [r(d - Math.sqrt((pa - la) ** 2 + (ub - pb) ** 2)), r(d + Math.sqrt((ua - pa) ** 2 + (pb - lb) ** 2))];
}

const isEvent = (r) => r && (r.kind === 'arm_frozen' || r.kind === 'arm_opened');
/** a row the reading may count: a real trial (not a stub, not an event, not stamped invalid or a dry run) */
const valid = (r) => r && !isEvent(r) && r.engine && r.engine !== 'stub' && !r.invalid && !/^dry run$/.test(String(r.halt || '')) && typeof r.T4_landed === 'boolean';

export function noRiverReading(rows, { a = 'A', b = 'N', minN = MIN_N, sha = NO_RIVER_SHA } = {}) {
  const all = (rows || []).filter(valid);
  const N = all.filter((r) => r.variant === b && r.no_river_sha === sha);
  const first = N.length ? N.map((r) => r.at).sort()[0] : null;
  const engines = new Set(N.map((r) => r.engine)); const tasks = new Set(N.map((r) => r.sha));
  const A = N.length ? all.filter((r) => r.variant === a && engines.has(r.engine) && tasks.has(r.sha) && String(r.at) >= first) : [];
  const arm = (rs) => { const x = rs.filter((r) => r.T4_landed).length; return { landed: x, trials: rs.length, rate: rs.length ? Math.round(x / rs.length * 1000) / 1000 : null, wilson95: wilson(x, rs.length), tasks: new Set(rs.map((r) => r.sha)).size }; };
  const ra = arm(A), rb = arm(N);
  const gap = ra.trials && rb.trials ? Math.round((ra.landed / ra.trials - rb.landed / rb.trials) * 1000) / 1000 : null;
  const gap95 = gapInterval(ra.landed, ra.trials, rb.landed, rb.trials);
  const enough = ra.trials >= minN && rb.trials >= minN;
  const excludes0 = gap95[0] != null && (gap95[0] > 0 || gap95[1] < 0);
  const nLine = `n ${a} ${ra.trials} · n ${b} ${rb.trials} (need ${minN} each)`;
  const verdict = enough && excludes0
    ? `MEASURED — ${a} ${ra.landed}/${ra.trials} [${ra.wilson95}] vs ${b} ${rb.landed}/${rb.trials} [${rb.wilson95}] · gap ${gap} [${gap95}] excludes 0`
    : enough ? `UNMEASURED — at the null: gap ${gap} [${gap95}] spans 0 · ${nLine}`
    : `UNMEASURED — ${nLine}${ra.trials || rb.trials ? ` · so far ${a} ${ra.landed}/${ra.trials}, ${b} ${rb.landed}/${rb.trials}` : ''}`;
  return { row: 'C626', a, b, block_sha: sha, engines: [...engines], since: first, [a]: ra, [b]: rb, gap, gap95, min_n: minN, at_null: enough && !excludes0, verdict,
    sufficient_for: 'on these tasks, with this worker, whether the negative-prompt block moves the landed rate',
    not_sufficient_for: 'whether negative prompting costs reasoning in general, on other models or other kinds of task' };
}
/** the bench ledger as rows (missing file → []) */
export function rowsOf(text) { return String(text || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
