// src/lib/notary/mmr.mjs — C85a THE MERKLE MOUNTAIN RANGE ACCUMULATOR (goal 12 unit 2, 2026-09-18).
// The notary's witness ledger was a LINEAR hash chain under one key (C44: entry_hash commits to prev_hash) — proving that a
// receipt at height h belongs to the chain a later head commits to meant replaying every entry, O(n), and no client did.
// This is the accumulator that makes membership a path: an MMR (Todd's Merkle Mountain Range) over the ledger's car_shas.
//   leaf  = sha256(0x00 ‖ car_sha bytes)          node = sha256(0x01 ‖ left ‖ right)       — domain-separated: a leaf can never pose as a node
//   root  = the bagged peaks, right-fold:   bag(p0 … pk) = node(p0, node(p1, … node(pk-1, pk)))
//   proof(leaf_index) = { leaf_index, peak_index, path: [{ side, hash }], peaks }   — path climbs the leaf's own mountain to its peak;
//   verify({ leaf_hash, proof }) → root  — the recomputed peak replaces peaks[peak_index] and the peaks are bagged; the caller
//   compares against the root it trusts (the receipt's witness_root, or a later head). A flipped bit anywhere changes the answer.
// The path is ≤ ⌊log₂N⌋ hashes and the peaks are ≤ ⌊log₂N⌋+1, so a proof is ≤ ⌈log₂N⌉ + peaks hashes at any height N.
// WebCrypto ONLY (globalThis.crypto.subtle) — the same bytes run on Node ≥ 20 and on the edge runtime, like gateway.mjs.
// The node list (nodes()) is the whole state: an append-only sequence of hex hashes; openMMR(nodes) reopens to the same peaks.
// Positions are 0-indexed MMR positions (the standard layout: a parent immediately follows its right child).
// @guard tests/vna/c85-mmr-accumulator.test.mjs

const subtle = globalThis.crypto.subtle;
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array((String(h).match(/../g) || []).map((x) => parseInt(x, 16)));
const isHash = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
const cat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const digest = async (bytes) => hex(await subtle.digest('SHA-256', bytes));

export const leafHash = (carShaHex) => digest(cat(new Uint8Array([0x00]), unhex(carShaHex)));
export const nodeHash = (leftHex, rightHex) => digest(cat(new Uint8Array([0x01]), unhex(leftHex), unhex(rightHex)));
export async function bagPeaks(peaks) {
  if (!peaks.length) return null;
  let acc = peaks[peaks.length - 1]; for (let i = peaks.length - 2; i >= 0; i--) acc = await nodeHash(peaks[i], acc);
  return acc;
}

// ── position arithmetic (pure integers, no hashing) ──────────────────────────────────────────────
// height of the node at position pos: climb while the node is a right child of a complete mountain
const allOnes = (n) => n !== 0 && (n & (n + 1)) === 0;
const jumpLeft = (pos) => { const bl = 32 - Math.clz32(pos + 1); return pos - ((1 << (bl - 1)) - 1); };
function heightAt(pos) { let p = pos; while (!allOnes(p + 1)) p = jumpLeft(p); return 32 - Math.clz32(p + 1) - 1; }
// peak positions for an MMR of `size` nodes — largest complete mountain first
function peakPositions(size) {
  const out = []; let left = size, offset = 0;
  while (left > 0) { let h = 0; while ((1 << (h + 2)) - 1 <= left) h++; const n = (1 << (h + 1)) - 1; out.push(offset + n - 1); offset += n; left -= n; }
  return out;
}
// the MMR position of the k-th leaf (0-indexed): 2k − popcount(k)
const leafPos = (k) => { let c = 0, x = k; while (x) { c += x & 1; x >>>= 1; } return 2 * k - c; };
const leavesForSize = (size) => { let n = 0; for (const p of peakPositions(size)) n += 1 << heightAt(p); return n; };

export function createMMR() { return openMMR([]); }
export function openMMR(nodes) {
  if (!Array.isArray(nodes) || !nodes.every(isHash)) throw new Error('node list must be an array of 64-hex sha256 hashes');
  const N = nodes.slice(); const size = () => N.length;
  const hs = peakPositions(N.length).map(heightAt); if (hs.some((h, i) => i && h >= hs[i - 1])) throw new Error('node list is not an MMR size — two peaks of one height would have merged');
  const peaks = () => peakPositions(size()).map((p) => N[p]);
  const proof = (leaf_index) => {
    const n = leavesForSize(size()); if (!Number.isInteger(leaf_index) || leaf_index < 0 || leaf_index >= n) throw new Error(`leaf_index ${leaf_index} is not in 0..${n - 1}`);
    const pk = peakPositions(size()); let pos = leafPos(leaf_index), h = 0; const path = [];
    while (!pk.includes(pos)) {
      // a right child's parent sits at pos+1 (height h+1); otherwise pos is a left child and its parent is at pos + 2^(h+1)
      if (heightAt(pos + 1) === h + 1) { path.push({ side: 'left', hash: N[pos - ((1 << (h + 1)) - 1)] }); pos += 1; }
      else { path.push({ side: 'right', hash: N[pos + ((1 << (h + 1)) - 1)] }); pos += 1 << (h + 1); }
      h++;
    }
    return { leaf_index, peak_index: pk.indexOf(pos), path, peaks: peaks() };
  };
  const verify = async ({ leaf_hash, proof: pr }) => {
    if (!isHash(leaf_hash) || !pr || !Array.isArray(pr.path) || !Array.isArray(pr.peaks) || !Number.isInteger(pr.peak_index)) return null;
    let h = leaf_hash;
    for (const s of pr.path) { if (!isHash(s.hash)) return null; h = s.side === 'left' ? await nodeHash(s.hash, h) : await nodeHash(h, s.hash); }
    const ps = pr.peaks.slice(); if (pr.peak_index < 0 || pr.peak_index >= ps.length) return null; ps[pr.peak_index] = h;
    return bagPeaks(ps);
  };
  const append = async (carShaHex) => {
    if (!isHash(carShaHex)) throw new Error('append takes a 64-hex car_sha');
    const leaf_index = leavesForSize(size()); N.push(await leafHash(carShaHex));
    // merge while the new node's left neighbour is a complete mountain of the same height
    let h = 0; let pos = size() - 1;
    while (pos >= (1 << (h + 1)) - 1 && heightAt(pos - ((1 << (h + 1)) - 1)) === h) { const left = pos - ((1 << (h + 1)) - 1); N.push(await nodeHash(N[left], N[pos])); pos = size() - 1; h++; }
    return { leaf_index, peaks: peaks(), root: await bagPeaks(peaks()) };
  };
  return { append, proof, verify, peaks, root: () => bagPeaks(peaks()), nodes: () => N.slice(), size, leafCount: () => leavesForSize(size()) };
}
