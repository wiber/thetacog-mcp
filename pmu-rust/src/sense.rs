use flate2::write::GzEncoder;
use flate2::Compression;
use rayon::prelude::*;
use std::io::Write;

pub fn gzip_len(data: &[u8]) -> usize {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap().len()
}

pub fn ncd_sim(za: usize, zb: usize, a: &[u8], b: &[u8]) -> f32 {
    let mut combined = Vec::with_capacity(a.len() + b.len() + 1);
    combined.extend_from_slice(a);
    combined.push(b'\n');
    combined.extend_from_slice(b);
    let zab = gzip_len(&combined);
    
    let ncd = (zab as f32 - (za.min(zb) as f32)) / (za.max(zb) as f32);
    (1.0 - ncd).max(0.0)
}

use crate::signature;

/// One sensed anchor: the dual-witness verdict for a single lattice node.
///
/// `score` is the PRIMARY witness — SimHash (popcount of the 64-bit
/// shingle signature XOR). It separates concepts even on short fragments,
/// where gzip-NCD collapses (length-dominated → flat). `ncd` is kept as the
/// cheap secondary witness. `best_idx` is the claim fragment the primary
/// witness matched (drives the hover payload). `agreement` is the scale-free
/// hallucination flag: do BOTH witnesses point at the same fragment?
pub struct SenseRow {
    pub score: f32,      // primary witness — max SimHash similarity
    pub ncd: f32,        // secondary witness — max gzip-NCD similarity
    pub best_idx: usize, // claim index the primary witness matched
    pub agreement: bool, // simhash-best fragment == ncd-best fragment
}

// SenseResult bundles the per-anchor rows with the COMPETITIVE inversion:
// for each claim, the anchor it matches best (its "vote"). Anchor→best-claim
// alone is degenerate (a generic/central claim wins every anchor); inverting
// to claim→best-anchor spreads the claims across the lattice, so the hover
// shows a distinct fragment per node instead of the same blob everywhere.
pub struct SenseResult {
    pub rows: Vec<SenseRow>,
    pub claim_best_anchor: Vec<usize>, // for each claim: argmax anchor (SimHash)
    pub claim_best_score: Vec<f32>,    // that claim↔anchor SimHash similarity
}

/// Senses every node in the lattice independently.
///
/// `claims`: salient semantic fragments from the input corpus.
/// `targets`: the semantic mass dump for every anchor in the lattice.
/// `target_lens`: pre-computed gzip lengths for the targets.
///
/// SimHash is the primary witness (see [`SenseRow`]); gzip-NCD rides along
/// as the secondary so the dual-witness agreement check still works. Both
/// run under Rayon — the 3-second JS zlib bottleneck disappears.
// `simhash_only` skips the gzip-NCD inner loop. At 144 nodes the dual-witness
// NCD is cheap and worth keeping (the canonical macro case); at 20,736 cells the
// NCD pair count is ~5M and costs ~60s, so cell-resolution runs SimHash-only
// (popcount AC⁰, milliseconds). The secondary witness then mirrors the primary.
// `mode` selects the simhash featurizer: ShingleMode::Char is the historical
// chip path (and the DEFAULT at the CLI layer — main.rs maps an absent/empty
// `shingle_mode` to Char so every existing caller is bit-identical);
// ShingleMode::Word is the JS production-ingest path (wordShingles).
pub fn sense_lattice(claims: &[String], targets: &[String], target_lens: &[usize], simhash_only: bool, mode: signature::ShingleMode) -> SenseResult {
    let claim_bytes: Vec<&[u8]> = claims.iter().map(|s| s.as_bytes()).collect();
    let claim_lens: Vec<usize> = if simhash_only { Vec::new() } else { claim_bytes.iter().map(|b| gzip_len(b)).collect() };
    let claim_sigs: Vec<u64> = claims.iter().map(|s| signature::simhash_mode(s, mode)).collect();
    let target_bytes: Vec<&[u8]> = targets.iter().map(|s| s.as_bytes()).collect();
    let target_sigs: Vec<u64> = targets.iter().map(|s| signature::simhash_mode(s, mode)).collect();

    let rows: Vec<SenseRow> = targets.par_iter().enumerate().map(|(i, _target)| {
        let mut max_ncd = 0.0f32;
        let mut ncd_best_idx = 0usize;
        let mut max_simhash = 0.0f32;
        let mut sim_best_idx = 0usize;

        let zb = target_lens[i];
        let tb = target_bytes[i];
        let tsig = target_sigs[i];

        for (j, cb) in claim_bytes.iter().enumerate() {
            if !simhash_only {
                let ncd = ncd_sim(claim_lens[j], zb, cb, tb);
                if ncd > max_ncd { max_ncd = ncd; ncd_best_idx = j; }
            }
            let simhash = signature::simhash_sim(claim_sigs[j], tsig);
            if simhash > max_simhash { max_simhash = simhash; sim_best_idx = j; }
        }

        // Scale-free hallucination flag: trust the match only when the two
        // independent witnesses converge on the SAME fragment. (The old
        // |ncd - simhash| < 0.1 test compared incommensurable scales.) Under
        // simhash_only there is no second witness, so it trivially agrees.
        let (ncd, agreement) = if simhash_only {
            (max_simhash, true)
        } else {
            (max_ncd, sim_best_idx == ncd_best_idx)
        };

        SenseRow {
            score: max_simhash,
            ncd,
            best_idx: sim_best_idx,
            agreement,
        }
    }).collect();

    // Competitive inversion: each claim picks the anchor it matches best. This
    // spreads claims across the lattice (no single generic claim can own every
    // anchor), which is what makes the per-anchor hover fragment distinct.
    let claim_best: Vec<(usize, f32)> = claim_sigs.par_iter().map(|&csig| {
        let mut best_i = 0usize;
        let mut best_v = -1.0f32;
        for (i, &tsig) in target_sigs.iter().enumerate() {
            let s = signature::simhash_sim(csig, tsig);
            if s > best_v { best_v = s; best_i = i; }
        }
        (best_i, best_v)
    }).collect();

    SenseResult {
        rows,
        claim_best_anchor: claim_best.iter().map(|x| x.0).collect(),
        claim_best_score: claim_best.iter().map(|x| x.1).collect(),
    }
}

// ── tests ────────────────────────────────────────────────────────────
//
// The pipeline ledger (stage 2/3) and the ideal-case spec (A3/B2) lean on
// sense being a deterministic locate: same claims + targets → same scores,
// same best_idx, every run (Rayon parallelism must not introduce order
// dependence — each row is computed independently and collected by index).
// The known-input fixture pins the gate pointed inward: an identical
// claim↔target pair must score 1.0 and win best_idx.
#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Vec<String>, Vec<String>, Vec<usize>) {
        let claims = vec![
            "the ballistic walk traverses the connectivity lattice on silicon".to_string(),
            "quarterly revenue forecasts for the sales pipeline dashboard".to_string(),
        ];
        let targets = vec![
            "quarterly revenue forecasts for the sales pipeline dashboard".to_string(),
            "the ballistic walk traverses the connectivity lattice on silicon".to_string(),
            "entirely unrelated prose about gardening tulips in spring rain".to_string(),
        ];
        let lens: Vec<usize> = targets.iter().map(|t| gzip_len(t.as_bytes())).collect();
        (claims, targets, lens)
    }

    #[test]
    fn identical_claim_scores_one_and_wins_best_idx() {
        let (claims, targets, lens) = fixture();
        let res = sense_lattice(&claims, &targets, &lens, false, signature::ShingleMode::Char);
        // target 0 is claim 1 verbatim; target 1 is claim 0 verbatim
        assert_eq!(res.rows[0].best_idx, 1);
        assert!((res.rows[0].score - 1.0).abs() < 1e-6, "identical text must score 1.0, got {}", res.rows[0].score);
        assert_eq!(res.rows[1].best_idx, 0);
        assert!((res.rows[1].score - 1.0).abs() < 1e-6);
        // the unrelated target scores strictly below the verbatim matches
        assert!(res.rows[2].score < res.rows[0].score);
        // competitive inversion: each claim's best anchor is its verbatim target
        assert_eq!(res.claim_best_anchor, vec![1, 0]);
        // dual-witness agreement on verbatim matches (both witnesses converge)
        assert!(res.rows[0].agreement && res.rows[1].agreement);
    }

    #[test]
    fn sense_is_deterministic_across_runs_and_modes() {
        let (claims, targets, lens) = fixture();
        let a = sense_lattice(&claims, &targets, &lens, false, signature::ShingleMode::Char);
        let b = sense_lattice(&claims, &targets, &lens, false, signature::ShingleMode::Char);
        for i in 0..targets.len() {
            assert_eq!(a.rows[i].score, b.rows[i].score);
            assert_eq!(a.rows[i].ncd, b.rows[i].ncd);
            assert_eq!(a.rows[i].best_idx, b.rows[i].best_idx);
            assert_eq!(a.rows[i].agreement, b.rows[i].agreement);
        }
        assert_eq!(a.claim_best_anchor, b.claim_best_anchor);
        assert_eq!(a.claim_best_score, b.claim_best_score);
        // simhash_only must agree with the dual-witness run on the PRIMARY
        // witness (scores/best_idx) — it only skips the NCD secondary.
        let s = sense_lattice(&claims, &targets, &lens, true, signature::ShingleMode::Char);
        for i in 0..targets.len() {
            assert_eq!(s.rows[i].score, a.rows[i].score);
            assert_eq!(s.rows[i].best_idx, a.rows[i].best_idx);
            assert!(s.rows[i].agreement, "simhash_only trivially agrees (no second witness)");
        }
    }

    #[test]
    fn word_mode_sense_is_deterministic_and_verbatim_scores_one() {
        // The production-shingler path through sense: same locate contract
        // (verbatim claim↔target → score 1.0, correct best_idx, determinism).
        let (claims, targets, lens) = fixture();
        let a = sense_lattice(&claims, &targets, &lens, false, signature::ShingleMode::Word);
        let b = sense_lattice(&claims, &targets, &lens, false, signature::ShingleMode::Word);
        assert_eq!(a.rows[0].best_idx, 1);
        assert!((a.rows[0].score - 1.0).abs() < 1e-6);
        assert_eq!(a.rows[1].best_idx, 0);
        assert!((a.rows[1].score - 1.0).abs() < 1e-6);
        for i in 0..targets.len() {
            assert_eq!(a.rows[i].score, b.rows[i].score);
            assert_eq!(a.rows[i].best_idx, b.rows[i].best_idx);
        }
        assert_eq!(a.claim_best_anchor, b.claim_best_anchor);
    }

    #[test]
    fn gzip_len_is_deterministic() {
        let d = b"the shape, not the payload";
        assert_eq!(gzip_len(d), gzip_len(d));
        assert!(gzip_len(d) > 0);
    }
}
