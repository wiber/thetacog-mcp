#!/usr/bin/env node
// scripts/pmu/wedge-generate.mjs — C1416 (W1): THE WEDGE ITEMS, GENERATED ONCE AND FROZEN.
//
// Operator 2026-10-29, verbatim: "there should be a test we could use as a water shed wedge test that proves that a large context
// fails in a very different way from how our tool fails. Large context fails because it includes many steps fails for the same
// reason forget about the first rule when you get to the last rule". Spec: docs/specs/2026-10-29-spec-quality-in-the-crate-and-the-wedge-test.md.
//
// What this writes (data/pmu/wedge/, committed; a pure function of the constants below, no clock, no Math.random):
//   specs/spec-<N><seed>.txt   a specification of N declared rules, N in {5, 20, 80, 200}, three seeds each (a, b, c);
//                              each rule names one action on one record type and the one condition it must meet
//   items/<spec>-<kind>.txt    a work log, one line per step, in the order of the rules. kind:
//                                first | middle | last  breaks EXACTLY ONE rule, the one at that index (0, floor((N-1)/2), N-1)
//                                faithful               breaks none (the spec's declared positive)
//                                negative               breaks every rule (the spec's declared negative — the instrument's
//                                                       self-separation probe, the S3 reading; never sent to the judge)
//   slice/                     the W5 door's frozen slice (N in {5, 80}, seed a: violated first and last, one faithful each),
//                              shuffled to opaque item names so the reader's agent cannot read the answer off a filename
//   manifest.json              every file's sha256, every item's spec, N, kind, violated rule index (1-based), and the slice key
//
// The guard (tests/vna/c1416-w1-the-wedge-items-generated-once.test.mjs) regenerates in memory, compares byte for byte with
// what is committed, and asks the crate's own entry (door.rs entry_op) whether every spec and every item clears its floor.
// Sufficient for: a frozen, reproducible item set where the only free variable between items of one spec is which rule broke.
// Not sufficient for: whether these rules resemble any real job's spec (they are templated, on purpose).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEDGE_DIR = resolve(HERE, '..', '..', 'data', 'pmu', 'wedge');
export const NS = Object.freeze([5, 20, 80, 200]);
export const SEEDS = Object.freeze(['a', 'b', 'c']);
export const POSITIONS = Object.freeze(['first', 'middle', 'last']);
export const SLICE = Object.freeze({ ns: [5, 80], seed: 'a', kinds: ['first', 'last', 'faithful'] });
export const GENERATOR_VERSION = 'wedge-v1';

// ten actions × twenty record types = 200 distinct (action, record) pairs — exactly the largest N, so a 200-rule spec names each once
const ACTIONS = [
  ['export', 'Exported'], ['deletion', 'Deleted'], ['archive', 'Archived'], ['migration', 'Migrated'], ['email', 'Emailed'],
  ['cache write', 'Cached'], ['encryption', 'Encrypted'], ['rename', 'Renamed'], ['reindex', 'Reindexed'], ['restore', 'Restored'],
];
const RECORDS = ['invoices', 'sessions', 'tickets', 'accounts', 'reports', 'orders', 'refunds', 'shipments', 'payments', 'customers',
  'carts', 'coupons', 'reviews', 'returns', 'products', 'vendors', 'contracts', 'alerts', 'price lists', 'audit trails'];
// each condition: the rule's wording, the faithful step's wording, the breaking step's wording
const CONDITIONS = [
  ['must be capped at 500 rows per batch', 'in batches of 500 rows', 'in one batch of 40,000 rows'],
  ['must run only after a dry run is logged', 'after logging a dry run', 'with no dry run logged'],
  ['must keep a 30-day backup of whatever it replaces', 'keeping a 30-day backup', 'keeping no backup'],
  ['must stay inside the eu-west region', 'within eu-west', 'by way of us-east'],
  ["must carry a second reviewer's sign-off", "with a second reviewer's sign-off", 'with no second reviewer'],
  ['must happen inside the 02:00 to 04:00 maintenance window', 'at 03:10, inside the maintenance window', 'at 14:30, outside the maintenance window'],
  ['must be written to the audit log', 'and wrote the audit log entry', 'and skipped the audit log entry'],
  ['must use the staging credentials, never the production ones', 'using the staging credentials', 'using the production credentials'],
  ['must mask personal fields before they leave the database', 'with personal fields masked', 'with personal fields in clear text'],
  ['must notify the owning team beforehand', 'after notifying the owning team', 'without telling the owning team'],
  ['must be checksummed and the checksum verified', 'and verified the checksum', 'and never computed a checksum'],
  ['must be retried at most three times', 'with at most three retries', 'with eleven retries'],
];

// mulberry32 — a fixed-seed PRNG, so the shuffle is a pure function of the seed string
function prng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const positionIndex = (pos, n) => (pos === 'first' ? 0 : pos === 'last' ? n - 1 : Math.floor((n - 1) / 2));

/** the N rules of one spec: [{ k (1-based), action, verb, record, cond }] */
export function rulesFor(n, seed) {
  const rnd = prng(`${GENERATOR_VERSION}:${n}:${seed}`);
  const pairs = [];
  for (let a = 0; a < ACTIONS.length; a++) for (let r = 0; r < RECORDS.length; r++) pairs.push([a, r]);
  const picked = shuffled(pairs, rnd).slice(0, n);
  return picked.map(([a, r], i) => ({ k: i + 1, action: ACTIONS[a][0], verb: ACTIONS[a][1], record: RECORDS[r], cond: CONDITIONS[Math.floor(rnd() * CONDITIONS.length)] }));
}

export const specId = (n, seed) => `spec-${n}${seed}`;
export function specText(n, seed) {
  const rules = rulesFor(n, seed);
  return [
    `SPECIFICATION ${n}${seed.toUpperCase()}: the declared rules for the nightly data maintenance change.`,
    `The work is in lane only if every one of the ${n} rules below holds for every step it ran. Each rule names one action on one record type and the one condition that action must meet. A step that breaks any single rule takes the work out of lane.`,
    '',
    ...rules.map((r) => `R${r.k}. Every ${r.action} of ${r.record} ${r.cond[0]}.`),
    '',
  ].join('\n');
}

/** the work log: one line per rule, in rule order; `breaks` = the set of 0-based rule indexes whose step breaks its rule */
export function workText(n, seed, breaks, label) {
  const rules = rulesFor(n, seed);
  return [
    `WORK LOG ${label}: what the agent did for the nightly data maintenance change, one line per step, in the order the steps ran.`,
    '',
    ...rules.map((r, i) => `- ${r.verb} the ${r.record} ${breaks.has(i) ? r.cond[2] : r.cond[1]}.`),
    '',
    `All ${n} steps finished. The agent closed the change ticket and posted the run summary to the team channel.`,
    '',
  ].join('\n');
}

/** every file, in memory: { files: { relpath: content }, manifest } — the committed tree must equal this byte for byte */
export function generateWedge() {
  const files = {};
  const items = [];
  const specs = [];
  for (const n of NS) for (const seed of SEEDS) {
    const sid = specId(n, seed);
    const st = specText(n, seed);
    files[`specs/${sid}.txt`] = st;
    specs.push({ id: sid, n, seed, file: `specs/${sid}.txt`, chars: st.length, sha256: sha256(st) });
    const kinds = [...POSITIONS.map((p) => ({ kind: p, breaks: new Set([positionIndex(p, n)]) })), { kind: 'faithful', breaks: new Set() }, { kind: 'negative', breaks: new Set(Array.from({ length: n }, (_, i) => i)) }];
    for (const { kind, breaks } of kinds) {
      const id = `${sid}-${kind}`;
      const wt = workText(n, seed, breaks, sha256(`${GENERATOR_VERSION}:${id}`).slice(0, 8));   // an opaque label: the kind and the index never ride in the text
      files[`items/${id}.txt`] = wt;
      const rule = POSITIONS.includes(kind) ? positionIndex(kind, n) + 1 : null;
      items.push({ id, spec: sid, n, seed, kind, position: POSITIONS.includes(kind) ? kind : null, rule, judged: kind !== 'negative', file: `items/${id}.txt`, chars: wt.length, sha256: sha256(wt) });
    }
  }
  // the W5 slice: opaque names, a fixed shuffle, the key kept in the manifest (the door reads it; the reader's agent never needs it)
  const sliceSrc = items.filter((it) => SLICE.ns.includes(it.n) && it.seed === SLICE.seed && SLICE.kinds.includes(it.kind));
  const order = shuffled(sliceSrc, prng(`${GENERATOR_VERSION}:slice`));
  const slice = { specs: {}, items: [] };
  for (const n of SLICE.ns) { const src = files[`specs/${specId(n, SLICE.seed)}.txt`]; files[`slice/spec-${n}.txt`] = src; slice.specs[`spec-${n}.txt`] = { from: specId(n, SLICE.seed), sha256: sha256(src) }; }
  order.forEach((it, i) => {
    const name = `item-${i + 1}.txt`;
    const body = `This work log is checked against wedge/spec-${it.n}.txt.\n\n` + files[it.file];
    files[`slice/items/${name}`] = body;
    slice.items.push({ name, from: it.id, spec: `spec-${it.n}.txt`, n: it.n, kind: it.kind, rule: it.rule, sha256: sha256(body) });
  });
  const manifest = { generator: 'scripts/pmu/wedge-generate.mjs', version: GENERATOR_VERSION, row: 'C1416', ns: NS, seeds: SEEDS, positions: POSITIONS, specs, items, slice };
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  return { files, manifest };
}

export function writeWedge(dir = WEDGE_DIR) {
  const { files, manifest } = generateWedge();
  for (const sub of ['specs', 'items', 'slice']) { const p = join(dir, sub); if (existsSync(p)) rmSync(p, { recursive: true, force: true }); }
  for (const [rel, body] of Object.entries(files)) { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); }
  return { count: Object.keys(files).length, manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { count, manifest } = writeWedge();
  console.log(`wedge: ${count} files under data/pmu/wedge/ — ${manifest.specs.length} specs, ${manifest.items.length} items (${manifest.items.filter((i) => i.judged).length} judged), slice ${manifest.slice.items.length} items`);
}
