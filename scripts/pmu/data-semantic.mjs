// scripts/pmu/data-semantic.mjs — STRUCTURED DATA IS THE FOURTH INGEST KIND (root fix, 2026-08-14;
// escalations bf-4351 + bf-4352, both raised against commit bad039241 sensing 0 anchors).
// ============================================================================================
// THE HOLE: commit-triptych's ingest classified a commit's changed files into exactly three kinds —
// docs (.md/.mdx/.txt/.html → intent), code (.mjs/.js/.ts/.tsx/.rs/.sh/.py → reality) and tests
// (→ intent). A commit whose whole diff is STRUCTURED DATA matched NONE of them: docFiles/codeFiles
// both empty, diffCode/diffDocs both '' (their predicates gate on the same regexes), and the raw-file
// fallback handed claimify unparsed JSON — which it correctly drops as code-soup. Four separate paths
// all returning nothing looked exactly like a healthy thin commit. Measured on bad039241
// (src/data/pixel-carousel.json, 22 insertions): intent 0 claims, reality 0 claims, 0 lit on both
// sides — a BLIND instrument, not a thin commit. That file carries the site's live billboard PROSE
// (headlines, kickers, subs): real reality, invisible to the sensor.
//
// THE EXTRACTOR: regex, never JSON.parse — so the SAME function grips a whole file, an ndjson line,
// a toml pair, AND a raw DIFF FRAGMENT (a hunk's added lines are not valid JSON and never parse).
// The KEY is the identifier (→ words), the string VALUE is the prose, emitted as `key — value`.
// One pair per BLOCK (blank-line join), per the bf-170 block-isolation lesson: a single '\n' join
// lets one code-ish line flip the ENTIRE corpus into claimify's code mode and collapse it to ~0.
//
// SCOPE, deliberately narrow: quoted-key/quoted-value only. That covers json · ndjson · jsonl · toml
// and every data file this repo actually commits. Unquoted YAML pairs and CSV cells are NOT extracted
// — a looser pattern starts harvesting enum tokens and ids, which is the code-soup claimify exists to
// reject. Widen it only with a measurement, not a hunch.
//
// SAFE AGAINST FALSE-GRIP by construction: it emits only what is literally written in the file, and
// every emitted sentence still has to clear claimify + salienceRank (isSemantic · classifyClaim
// 'meaning' · !looksLikeCodeSyntax) downstream. Hrefs, slugs, hex ids and dates are kebab/camel
// identifier soup and get dropped there — the extractor needs no quality bar of its own.
//
// Extracted from commit-triptych.mjs so it is UNIT-TESTABLE, exactly as reef-bridge.mjs was extracted
// for the same reason. Guarded by tests/pmu-simulator/ingest-data-files.test.mjs.

// The fourth kind. Lives HERE so every ingest surface shares ONE definition of "this is data".
// NOTE what is ABSENT: .ndjson / .jsonl. In this repo those ARE the append-only LEDGER format
// (.thetacog/email-sent.ndjson, data/interventions/events.ndjson, fires.ndjson …) and they change on
// almost every commit. Ingesting them would put the same log rows into EVERY commit's corpus — which
// is precisely AR-10, the generic-flood failure mode that once made every commit peak on anchor 111.
// Data ingest is for CONTENT data (declared copy, config, fixtures), never for telemetry.
export const DATA_EXT = /\.(json|ya?ml|toml|csv|tsv)$/;

// …and the same guard by PATH, for the .json ledgers that don't carry the .ndjson extension
// (.thetacog/punch-list.json, data/pmu/* receipts, lens state). Deterministic, no model.
export const isLedgerPath = (f) => /^\.thetacog\/|^data\/pmu\/|^public\/commit\/|(^|\/)(receipts?|logs?|panels?)\//.test(String(f || ''));

// THE one predicate every caller should use: is this changed file ingestible content data?
export const isDataFile = (f) => DATA_EXT.test(String(f || '')) && !isLedgerPath(f);

const MIN_VALUE = 12;    // "cyan" / "Show me" are enum-ish decoration, not claims
const MAX_OUT = 20000;   // whole-file semantic budget — same as semanticOfCode

const splitIdent = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();

// semanticOfData — deterministic: same bytes in, byte-identical string out (no Date, no ordering by Set
// iteration beyond insertion order, no model). That determinism is load-bearing: the receipt is a pure
// function of the commit (CLAUDE.md — THE RECEIPT IS LLM-FREE).
export function semanticOfData(content) {
  const out = [], seen = new Set();
  const re = /["']((?:[^"'\\]|\\.)*)["']\s*[:=]\s*["']((?:[^"'\\]|\\.)*)["']/g;
  let m;
  while ((m = re.exec(String(content || '')))) {
    const key = splitIdent(m[1].replace(/[.\-_/]+/g, ' ')).trim();
    const val = m[2].replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim();
    if (val.length < MIN_VALUE) continue;
    const s = key ? `${key} — ${val}` : val;
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out.join('\n\n').slice(0, MAX_OUT);
}

export default semanticOfData;
