#!/usr/bin/env node
// C43 — MERKLE-PROOF ATTESTATION PER COMMIT: an inclusion proof linking a commit to the path of the spec node it
// satisfied. A commit whose message names a declared row (C52a, T11, …) is attested against that row's BASIN
// (n_spec_<label>, C52a): the proof is the basin's sibling hashes root-ward (spec-tree.mjs proof/verifyProof), recomputed
// here and checked against the root the tree carried at attestation time; the receipt is one ndjson row per commit in
// data/vna/attestations.ndjson — sha · at · labels · per-label {id, hash, root, verified, pathLen} · files touched.
// Idempotent per (sha, root). LLM-free: sha256 and git.
//
// This is also the door the operator asked for — "the snowball starts on the spec and runs backwards into the repo":
// a basin's bundle now carries the commits that satisfied it (attestationsFor), so a seed that lands on C52a reads the
// shas and files that built it instead of the chat that discussed it.
//
//   node scripts/vna/attest-commit.mjs [<sha>|HEAD] [--json]      attest one commit (post-commit calls this, detached)
//   node scripts/vna/attest-commit.mjs --for C52a                  the attestations a row carries
//   node scripts/vna/attest-commit.mjs --verify                    every receipt's basin vs the tree now (revised / moved)
//   node scripts/vna/attest-commit.mjs --recompute [--ledger f] [--proofs dir] [--repo dir] [--json]
//                                                                  C592: recompute EVERY row's proof + placement → MATCH/MISMATCH/UNMEASURED + count
import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proof, verifyProof, TREE } from './spec-tree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const ATTEST = process.env.VNA_ATTESTATIONS || resolve(REPO, 'data/vna/attestations.ndjson');
// a ROW label, never a COORDINATE: `C1` inside `B3,C1` or `C1,C2` is a ShortLex cell, and the bare \bC1\b matched it — 16 of
// C1's attestations (2026-09-18 audit) came from commit bodies naming the cell, not the row. A label is not preceded by a comma
// or a cell letter and not followed by `,<cell>`.
export const PROOFS_DIR = process.env.VNA_PROOFS_DIR || resolve(REPO, 'data/vna/proofs');
// C63: the inclusion proof itself (the sibling hashes) is content-addressed on disk — data/vna/proofs/<proof_id>.json — so a
// CAR can be verified from bare files after the tree has moved on; the ledger row carries proof_id, never the 7 KB path
export function writeProofFile(pr, dir = PROOFS_DIR) { const proof_id = createHash('sha256').update(JSON.stringify(pr.path)).digest('hex').slice(0, 16); mkdirSync(dir, { recursive: true }); const f = resolve(dir, `${proof_id}.json`); if (!existsSync(f)) writeFileSync(f, JSON.stringify({ proof_id, hash: pr.hash, root: pr.root, path: pr.path }) + '\n'); return proof_id; }
export const LABEL_RE = /(?<![A-C][1-3]?,)(?<![A-Za-z0-9])(C\d{1,3}[a-z]?|T\d{1,3})(?![A-Za-z0-9])(?!,[A-C](?:[1-3])?\b)/g;

export function labelsOf(message) { const out = new Set(); for (const m of String(message || '').matchAll(LABEL_RE)) out.add(m[1]); return [...out]; }

export function attest(tree, { sha, message, files = [], at = new Date().toISOString(), by = process.env.VNA_BY || 'cli', proofsDir = PROOFS_DIR }) {
  const labels = labelsOf(message);
  const proofs = [];
  for (const label of labels) {
    const id = `n_spec_${label}`; const n = tree.nodes[id];
    if (!n || !n.basin) { proofs.push({ label, id, present: false }); continue; }
    const pr = proof(tree, id); const recomputed = verifyProof(pr);
    let proof_id = null; try { proof_id = writeProofFile(pr, proofsDir); } catch {}
    proofs.push({ label, id, present: true, hash: n.hash, root: pr.root, verified: recomputed === pr.root, pathLen: pr.path.length, proof_id, headline: n.content.headline, done: !!(n.meta && n.meta.done) });
  }
  return { sha, at, by, root: tree.root, labels, basins: proofs.filter((p) => p.present).length, verified: proofs.filter((p) => p.present && p.verified).length, proofs, files, subject: String(message || '').split('\n')[0].slice(0, 160) };
}

export function readAttestations(path = ATTEST) { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
export function attestationsFor(label, path = ATTEST) { return readAttestations(path).filter((a) => a.proofs.some((p) => p.label === label && p.present)).map((a) => ({ sha: a.sha, at: a.at, subject: a.subject, files: a.files.length, verified: a.proofs.find((p) => p.label === label).verified, root: String(a.root).slice(0, 8) })); }
export function recordAttestation(rec, path = ATTEST) {
  const prior = readAttestations(path).filter((a) => a.sha === rec.sha && a.root === rec.root);
  // C63: a row written before proof files existed is superseded by one that carries proof_id — append-only, the old row stays
  if (prior.length && prior.some((a) => (a.proofs || []).every((p) => !p.present || p.proof_id))) return { written: false, why: 'already attested at this root' };
  mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(rec) + '\n'); return { written: true, why: null };
}
export function verifyAll(tree, path = ATTEST) {
  // a receipt recorded at an older root still verifies against ITS root (the basin's hash and path at the time); a
  // receipt whose basin was since revised is reported as superseded, never as broken
  const out = [];
  for (const a of readAttestations(path)) for (const p of a.proofs) {
    if (!p.present) continue;
    const n = tree.nodes[p.id];
    out.push({ sha: a.sha, label: p.label, recordedVerified: p.verified, basinNow: n ? (n.hash === p.hash ? 'same' : 'revised since') : 'gone', rootNow: tree.root === a.root ? 'same' : 'moved' });
  }
  return out;
}

// ── C592 — THE CARRIER RECOMPUTE DOOR. One headless command an underwriter or compliance officer runs in a CLONE:
//   npx thetacog-mcp attest-commit --recompute            (or, at home: node scripts/vna/attest-commit.mjs --recompute)
// It RECOMPUTES every ledger row from bare files and the clone's git objects, never from the tree in memory and never from
// the row's own `verified` flag. Two legs per row:
//   proof      for each basin the row names: data/vna/proofs/<proof_id>.json is content-addressed (sha256 of its path ==
//              proof_id), carries the row's leaf hash and root, and hashing the leaf up its sibling path (spec-tree.mjs
//              verifyProof — the same function attest() used) reproduces the recorded root.
//   placement  `git show <sha>` in the clone: labelsOf(message) — the same labelsOf attest() used — names the row's basins,
//              the files the commit touched are the row's files, the subject is the row's subject. An attestation row
//              carries no lattice coordinate; its placement IS commit → spec basin(s) + files, so that is what recomputes.
// A row prints MATCH (every measured leg recomputes), MISMATCH (a measured leg differs — what differs is named) or
// UNMEASURED with the reason (the commit is not in this clone, the row predates proof files, the proof file is absent).
// A missing input is never a MISMATCH. LLM-free: sha256 and git.
// SUFFICIENT FOR: each row's inclusion proof and commit placement recompute from bytes the agent did not hold at check time.
// NOT FOR: whether the work was good (Rice, 1953) — this is a recomputation, never a risk score or a pass/fail on the agent.
// Rust port row: declared C592r (this decides a verdict per row — it moves into the crate once in use).
const sameSet = (a, b) => { const A = new Set(a || []), B = new Set(b || []); return A.size === B.size && [...A].every((x) => B.has(x)); };
function gitShowMany(repo, shas) {
  const out = new Map(); if (!shas.length) return out;
  // only shas that resolve to a commit in this clone go to `git show` (an absent object would abort the batch)
  const check = execFileSync('git', ['cat-file', '--batch-check'], { cwd: repo, input: shas.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 28 });
  const have = check.split('\n').filter((l) => / commit \d+$/.test(l)).map((l) => l.split(' ')[0]);
  for (let i = 0; i < have.length; i += 400) {
    const raw = execFileSync('git', ['show', '--name-only', '--no-color', '--format=%x00%H%n%B%x01', ...have.slice(i, i + 400)], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30 });
    for (const chunk of raw.split('\0').slice(1)) {
      const nl = chunk.indexOf('\n'); const sha = chunk.slice(0, nl); const end = chunk.indexOf('\x01');
      out.set(sha, { message: chunk.slice(nl + 1, end), files: chunk.slice(end + 1).split('\n').filter(Boolean) });
    }
  }
  return out;
}
export function recomputeRow(row, { commit, proofsDir }) {
  const diffs = [], unmeasured = [];
  const present = (row.proofs || []).filter((p) => p.present);
  let proofsMeasured = 0, proofsMatched = 0;
  for (const p of present) {
    if (!p.proof_id) { unmeasured.push(`${p.label}: row predates proof files (C63)`); continue; }
    const f = resolve(proofsDir, `${p.proof_id}.json`);
    if (!existsSync(f)) { unmeasured.push(`${p.label}: proof file ${p.proof_id}.json absent`); continue; }
    let pf = null; try { pf = JSON.parse(readFileSync(f, 'utf8')); } catch { diffs.push(`${p.label}: proof file unreadable`); proofsMeasured++; continue; }
    proofsMeasured++;
    const addr = createHash('sha256').update(JSON.stringify(pf.path)).digest('hex').slice(0, 16);
    const why = [];
    if (addr !== p.proof_id) why.push('proof file is not its own address');
    // the file is addressed by its PATH (sibling hashes), never by its leaf: a basin revised under unchanged siblings reuses
    // the file a first writer left (writeProofFile never overwrites), so the file's own hash/root are that writer's. The
    // recomputation is the ROW's leaf hashed up the content-addressed path, compared with the ROW's root.
    if (p.root !== row.root) why.push('the basin root is not the row root');
    if (!why.length && verifyProof({ hash: p.hash, path: pf.path || [] }) !== p.root) why.push('the leaf hashed up its sibling path does not reach the recorded root');
    if (why.length) diffs.push(`${p.label}: ${why.join(', ')}`); else proofsMatched++;
  }
  let placement = 'unmeasured';
  if (!commit) unmeasured.push('commit not in this clone');
  else {
    const why = [];
    const got = labelsOf(commit.message);
    if (!sameSet(got, row.labels)) {
      // name a label that is in the message only as a ShortLex cell (`B3,C1`) — the pre-2026-09-18 rule placed those; the
      // row still differs from the recomputation, so it stays a MISMATCH, with the cause in the line
      const cell = (row.labels || []).filter((l) => !got.includes(l) && new RegExp(`(?<![A-Za-z0-9])${l}(?![A-Za-z0-9])`).test(commit.message));
      why.push(`labels recompute to ${got.join(',') || '—'}, row says ${(row.labels || []).join(',') || '—'}${cell.length ? ` (${cell.join(',')}: named only as a cell coordinate — the pre-2026-09-18 label rule)` : ''}`);
    }
    if (!sameSet(commit.files, row.files)) why.push(`files differ (${commit.files.length} in the commit, ${(row.files || []).length} on the row)`);
    if (row.subject != null && String(commit.message).split('\n')[0].slice(0, 160) !== row.subject) why.push('subject differs');
    placement = why.length ? 'mismatch' : 'match'; diffs.push(...why.map((w) => `placement: ${w}`));
  }
  const measured = proofsMeasured > 0 || placement !== 'unmeasured';
  const verdict = diffs.length ? 'MISMATCH' : measured ? 'MATCH' : 'UNMEASURED';
  return { sha: row.sha, labels: row.labels || [], verdict, proofs: { present: present.length, measured: proofsMeasured, matched: proofsMatched }, placement, diffs, unmeasured };
}
export function recomputeAll({ ledger = ATTEST, proofsDir = PROOFS_DIR, repo = REPO } = {}) {
  const rows = readAttestations(ledger);
  let commits = new Map(); let gitError = null;
  try { commits = gitShowMany(repo, [...new Set(rows.map((r) => r.sha).filter((s) => /^[0-9a-f]{7,40}$/.test(String(s))))]); } catch (e) { gitError = String(e.message || e).split('\n')[0]; }
  const out = rows.map((r) => recomputeRow(r, { commit: commits.get(r.sha) || null, proofsDir }));
  const count = { rows: out.length, MATCH: 0, MISMATCH: 0, UNMEASURED: 0 }; for (const o of out) count[o.verdict]++;
  return { ledger, proofsDir, repo, gitError, rows: out, count };
}
export function formatRecompute(res) {
  const lines = [];
  for (const o of res.rows) {
    const legs = `proof ${o.proofs.matched}/${o.proofs.measured} of ${o.proofs.present} · placement ${o.placement}`;
    const tail = o.verdict === 'MISMATCH' ? ` — ${o.diffs.join('; ')}` : o.verdict === 'UNMEASURED' ? ` — ${o.unmeasured.join('; ')}` : '';
    lines.push(`${o.verdict.padEnd(10)} ${String(o.sha).slice(0, 10)} ${(o.labels.join(',') || '—').padEnd(12)} ${legs}${tail}`);
  }
  if (res.gitError) lines.push(`git: ${res.gitError} — placement UNMEASURED on every row`);
  const c = res.count;
  lines.push(`recomputed ${c.rows} rows · MATCH ${c.MATCH} · MISMATCH ${c.MISMATCH} · UNMEASURED ${c.UNMEASURED}`);
  lines.push('sufficient for: each row\'s inclusion proof and commit placement recompute from bare files + this clone · NOT for: whether the work was good (Rice) — a recomputation, never a score on the agent');
  return lines.join('\n');
}

const gitMessage = (sha) => execFileSync('git', ['log', '-1', '--format=%B', sha], { cwd: REPO, encoding: 'utf8' });
const gitFiles = (sha) => execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
const gitSha = (ref) => execFileSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' }).trim();

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json');
  if (argv.includes('--recompute')) {
    // C592: needs no tree and no repo setup — the ledger, the proof files and the clone's git objects are the whole input
    const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const res = recomputeAll({ ledger: opt('--ledger') || ATTEST, proofsDir: opt('--proofs') || PROOFS_DIR, repo: opt('--repo') || REPO });
    if (asJson) console.log(JSON.stringify(res)); else console.log(formatRecompute(res));
    process.exit(res.count.MISMATCH ? 1 : 0);
  }
  let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
  if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
  const fi = argv.indexOf('--for');
  if (fi >= 0) { const rows = attestationsFor(argv[fi + 1]); if (asJson) console.log(JSON.stringify(rows)); else { console.log(`${argv[fi + 1]} · ${rows.length} attestation${rows.length === 1 ? '' : 's'}`); for (const r of rows) console.log(`  ${r.sha.slice(0, 10)} · ${String(r.at).slice(0, 16)} · ${r.files} files · root ${r.root} · ${r.verified ? 'verified' : 'NOT verified'} — ${r.subject.slice(0, 100)}`); } process.exit(0); }
  if (argv.includes('--verify')) { const v = verifyAll(tree); if (asJson) console.log(JSON.stringify(v)); else for (const x of v) console.log(`  ${x.sha.slice(0, 10)} ${x.label} · recorded ${x.recordedVerified ? 'verified' : 'NOT verified'} · basin now ${x.basinNow} · root now ${x.rootNow}`); process.exit(0); }
  const ref = argv.find((a) => !a.startsWith('--')) || 'HEAD';
  const sha = gitSha(ref);
  const rec = attest(tree, { sha, message: gitMessage(sha), files: gitFiles(sha) });
  const w = rec.labels.length ? recordAttestation(rec) : { written: false, why: 'no spec label in the message' };
  if (asJson) { console.log(JSON.stringify({ ...rec, ...w })); process.exit(0); }
  console.log(`${sha.slice(0, 10)} · labels ${rec.labels.join(',') || '—'} · ${rec.basins} basin${rec.basins === 1 ? '' : 's'} (${rec.verified} verified) · ${rec.files.length} files · root ${String(rec.root).slice(0, 8)} · ${w.written ? 'RECORDED' : w.why}`);
  for (const p of rec.proofs) console.log(`  ${p.label} · ${p.present ? `${p.verified ? 'proof verifies' : 'PROOF FAILS'} · path ${p.pathLen} · ${p.done ? '[x]' : '[ ]'} ${p.headline.slice(0, 70)}` : 'no basin for this label'}`);
}
