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
//   node scripts/vna/attest-commit.mjs --verify                    recompute every receipt's proof against its recorded root
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

const gitMessage = (sha) => execFileSync('git', ['log', '-1', '--format=%B', sha], { cwd: REPO, encoding: 'utf8' });
const gitFiles = (sha) => execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
const gitSha = (ref) => execFileSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' }).trim();

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json');
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
