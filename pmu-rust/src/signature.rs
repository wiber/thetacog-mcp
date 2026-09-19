// The canonical signature width (the JS twin's SIG_BITS). Referenced by the
// weld tests; allow(dead_code) because the non-test build hardcodes 64 inline.
#[allow(dead_code)]
pub const SIG_BITS: usize = 64;
const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

pub fn fnv1a(data: &[u8], seed: u64) -> u64 {
    let mut h = FNV_OFFSET ^ seed;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(FNV_PRIME);
    }
    h
}

pub fn shingles(text: &str, n: usize) -> Vec<String> {
    let t = text.replace(|c: char| c.is_whitespace(), " ");
    let t = t.trim();
    if t.is_empty() { return vec![]; }

    let chars: Vec<char> = t.chars().collect();
    if chars.len() <= n { return vec![t.to_string()]; }

    let mut out = Vec::new();
    for i in 0..=chars.len() - n {
        let s: String = chars[i..i+n].iter().collect();
        out.push(s);
    }
    out
}

// ── STOPWORDS — the JS twin's set, verbatim (signature.mjs STOPWORDS) ─
// Generic English function words + the trace-structural tokens every
// step shares. Stripped before word shingling so only domain words vote.
// Order and contents MUST track signature.mjs — the weld fixtures below
// pin the consequence (the golden u64s) so silent drift fails loudly.
pub const STOPWORDS: &[&str] = &[
    "the", "to", "a", "an", "of", "for", "and", "or", "in", "on", "at", "is", "it", "its",
    "as", "by", "be", "with", "from", "into", "that", "this", "then", "how", "every", "all",
    "i", "re", "so", "up", "out", "add", "added", "adding", "change", "changed", "check",
    "review", "trace", "confirm", "inspect", "print", "printed", "before", "after", "diff",
    "usage", "usages", "run", "running", "new", "old",
    "editfile", "readfile", "writefile", "bash", "grep", "npm", "npx", "yarn", "node",
    "src", "lib", "dist", "ts", "tsx", "js", "jsx", "mjs", "json", "file", "files",
];

fn stopwords() -> &'static std::collections::HashSet<&'static str> {
    static SET: std::sync::OnceLock<std::collections::HashSet<&'static str>> = std::sync::OnceLock::new();
    SET.get_or_init(|| STOPWORDS.iter().copied().collect())
}

// ── word_shingles — the JS twin's wordShingles, ported exactly ───────
// JS (signature.mjs): text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
//   .trim().split(/\s+/).filter(w => w && !STOPWORDS.has(w)), then
//   unigrams + adjacent bigrams ("w[i] w[i+1]") over the FILTERED list.
// Replication notes:
//   · the regex replaces RUNS of non-[a-z0-9] with one space, then trim
//     + split(/\s+/) — mapping each non-[a-z0-9] char to ' ' and using
//     split_whitespace() is the identical decomposition (runs collapse,
//     so the JS whitespace-collapse semantics hold here by construction);
//   · bigrams bridge over removed stopwords (filter happens FIRST), e.g.
//     "lattice on silicon" → "lattice silicon";
//   · features are always ASCII [a-z0-9 ] after the replace, so the JS
//     fnv1a (UTF-16 low bytes) and the Rust fnv1a (UTF-8 bytes) coincide
//     — the ledger's non-ASCII fnv1a divergence cannot reach this path.
pub fn word_shingles(text: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    let cleaned: String = lowered
        .chars()
        .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = cleaned
        .split_whitespace()
        .filter(|w| !stopwords().contains(w))
        .collect();
    if words.is_empty() { return vec![]; }
    let mut out: Vec<String> = words.iter().map(|w| w.to_string()).collect();
    for i in 0..words.len() - 1 {
        out.push(format!("{} {}", words[i], words[i + 1]));
    }
    out
}

// ── ShingleMode — which featurizer feeds the simhash vote ────────────
// Char  = the historical chip path (char 4-grams) — the DEFAULT on every
//         existing caller; do not flip it implicitly.
// Word  = the JS production-ingest path (wordShingles: unigrams+bigrams,
//         STOPWORDS stripped) — selectable where the caller opts in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ShingleMode { Char, Word }

// The voting core, shared by both modes (identical to the JS simhash
// accumulator for SIG_BITS=64: seed = 1, ±1 vote per bit, sign → bit).
fn simhash_from_feats(feats: &[String]) -> u64 {
    if feats.is_empty() { return 0; }
    let mut acc = vec![0i32; 64];
    for f in feats {
        let h = fnv1a(f.as_bytes(), 1); // seed = 1 for 64-bit
        for b in 0..64 {
            if ((h >> b) & 1) == 1 {
                acc[b] += 1;
            } else {
                acc[b] -= 1;
            }
        }
    }
    let mut sig = 0u64;
    for i in 0..64 {
        if acc[i] > 0 {
            sig |= 1 << i;
        }
    }
    sig
}

// simhash — the historical entry point. Char mode, unchanged behavior.
// sense.rs now routes through simhash_mode (Char remains its default at
// the CLI layer), so the non-test build no longer calls this directly;
// kept (allow(dead_code)) as the weld-test surface and the stable name.
#[allow(dead_code)]
pub fn simhash(text: &str) -> u64 {
    simhash_mode(text, ShingleMode::Char)
}

// simhash_mode — mode-selectable simhash. Word mode is the production
// weld: bit-exact with JS simhash(text, 64, wordShingles).
pub fn simhash_mode(text: &str, mode: ShingleMode) -> u64 {
    let feats = match mode {
        ShingleMode::Char => shingles(text, 4),
        ShingleMode::Word => word_shingles(text),
    };
    simhash_from_feats(&feats)
}

pub fn hamming_dist(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

pub fn simhash_sim(a: u64, b: u64) -> f32 {
    let dist = hamming_dist(a, b);
    1.0 - (dist as f32 / 64.0)
}

// ── tests ────────────────────────────────────────────────────────────
//
// THE WELD, tested honestly. The certified claim is "chip weld bit-exact":
// the Rust simhash and the JS twin (src/app/pmu-simulator/signature.mjs)
// must produce THE SAME u64 for the same input. That claim now holds on
// BOTH paths: the CHAR-SHINGLE path (the historical default on both
// sides, values recomputed from the JS twin 2026-06-11) and the
// WORD-SHINGLE path (wordShingles ported 2026-06-11 — the production
// ingest path, pinned against the golden-fixture values of
// tests/pmu-simulator/ingest-golden-fixtures.test.mjs). The former
// failing-loud inequality pin (weld_wordshingle_divergence_is_pinned_
// not_hidden, commit 88d2ff59a) is superseded by the EQUALITY weld
// below; the two modes remaining DISTINCT sensors is still pinned
// (char output must not equal the word fixtures).
#[cfg(test)]
mod tests {
    use super::*;

    // The two frozen ingest seeds from ingest-golden-fixtures.test.mjs.
    const SEED_A: &str = "the ballistic walk traverses the connectivity lattice on silicon";
    const SEED_B: &str = "quarterly revenue forecasts for the sales pipeline dashboard";

    // JS twin, CHAR-shingle path (simhash(text, 64) with the default
    // shingler), recomputed 2026-06-11 from signature.mjs:
    const JS_CHAR_A: u64 = 0x382372ec6e9fb4d5;
    const JS_CHAR_B: u64 = 0xb9bc706a4fc785d0;

    // JS twin, WORD-shingle path — THE production golden-fixture values
    // (frozen in tests/pmu-simulator/ingest-golden-fixtures.test.mjs).
    const JS_WORD_A: u64 = 0xc445e0851ade787b;
    const JS_WORD_B: u64 = 0x65de9e48b94bd1de;

    #[test]
    fn weld_char_path_is_bit_exact_with_js_twin() {
        // Mirrors the JS golden test's SIG_BITS pin: width change = re-freeze.
        assert_eq!(SIG_BITS, 64, "SIG_BITS changed — re-freeze the weld fixtures in this commit");
        assert_eq!(simhash(SEED_A), JS_CHAR_A,
            "Rust simhash diverged from the JS char-shingle twin — the weld broke");
        assert_eq!(simhash(SEED_B), JS_CHAR_B,
            "Rust simhash diverged from the JS char-shingle twin — the weld broke");
    }

    #[test]
    fn weld_word_path_is_bit_exact_with_js_twin() {
        // THE PRODUCTION WELD (supersedes the 88d2ff59a inequality pin):
        // Rust word_shingles + simhash must reproduce the JS golden-fixture
        // values of simhash(text, 64, wordShingles) — the path every reef/σ
        // ingest script senses with. If this fires, the production sensor
        // split again — update the gap ledger in the same commit.
        assert_eq!(simhash_mode(SEED_A, ShingleMode::Word), JS_WORD_A,
            "Rust word-shingle simhash diverged from the JS production twin — the weld broke");
        assert_eq!(simhash_mode(SEED_B, ShingleMode::Word), JS_WORD_B,
            "Rust word-shingle simhash diverged from the JS production twin — the weld broke");
        // The two modes stay DISTINCT sensors: the char path must not
        // accidentally produce the word fixtures (mode confusion guard).
        assert_ne!(simhash(SEED_A), JS_WORD_A);
        assert_ne!(simhash(SEED_B), JS_WORD_B);
    }

    #[test]
    fn word_shingles_features_match_js_twin_exactly() {
        // The exact feature list the JS wordShingles emits for SEED_A
        // (printed from signature.mjs 2026-06-11): stopwords stripped
        // FIRST ("the", "on"), bigrams formed over the FILTERED list so
        // "lattice silicon" bridges the removed "on".
        let expect: Vec<String> = [
            "ballistic", "walk", "traverses", "connectivity", "lattice", "silicon",
            "ballistic walk", "walk traverses", "traverses connectivity",
            "connectivity lattice", "lattice silicon",
        ].iter().map(|s| s.to_string()).collect();
        assert_eq!(word_shingles(SEED_A), expect);
        // Punctuation = separator runs (JS /[^a-z0-9]+/ → ' '), case folded:
        let punct: Vec<String> = [
            "jwt", "token", "refresh", "oauth2", "flows",
            "jwt token", "token refresh", "refresh oauth2", "oauth2 flows",
        ].iter().map(|s| s.to_string()).collect();
        assert_eq!(word_shingles("JWT-token, refresh; OAuth2 flows!"), punct);
        // JS value for that punctuation fixture: 0x7c60e15d5c1af68b.
        assert_eq!(simhash_mode("JWT-token, refresh; OAuth2 flows!", ShingleMode::Word), 0x7c60e15d5c1af68b);
        // Single surviving word → one unigram, no bigram (JS: 0xae45d89712a748b9).
        assert_eq!(word_shingles("silicon"), vec!["silicon".to_string()]);
        assert_eq!(simhash_mode("silicon", ShingleMode::Word), 0xae45d89712a748b9);
    }

    #[test]
    fn word_mode_is_deterministic_and_empty_or_stopword_only_is_zero() {
        assert_eq!(simhash_mode(SEED_A, ShingleMode::Word), simhash_mode(SEED_A, ShingleMode::Word));
        assert_eq!(simhash_mode("", ShingleMode::Word), 0);
        assert_eq!(simhash_mode("   \t\n ", ShingleMode::Word), 0);
        // All-stopword text has no domain words to vote → zero signature
        // (JS verified 2026-06-11: simhash('the of and to', 64, wordShingles) == 0n).
        assert_eq!(simhash_mode("the of and to", ShingleMode::Word), 0);
    }

    #[test]
    fn word_mode_collapses_whitespace_runs_like_js() {
        // Unlike the pinned char-path divergence below, the WORD path
        // inherits the JS run-collapse by construction (separator runs →
        // one split). JS value for both spacings: 0xc76560047ad65cfd.
        let multi = simhash_mode("ballistic  walk on   silicon lattice", ShingleMode::Word);
        let single = simhash_mode("ballistic walk on silicon lattice", ShingleMode::Word);
        assert_eq!(multi, single, "word mode must collapse whitespace runs (JS semantics)");
        assert_eq!(single, 0xc76560047ad65cfd);
    }

    #[test]
    fn word_mode_distances_are_sane() {
        // Mirrors the char-path distance test, on the production path.
        let a = simhash_mode(SEED_A, ShingleMode::Word);
        let b = simhash_mode(SEED_B, ShingleMode::Word);
        let d_unrelated = hamming_dist(a, b);
        assert!(d_unrelated >= 20, "unrelated seeds only {} bits apart on the word path — the sensor lost its grip", d_unrelated);
        // Inserting a STOPWORD is invisible to the word path (the whole
        // point of stripping): "on the silicon" == "on silicon" features.
        let stop_edit = simhash_mode(
            "the ballistic walk traverses the connectivity lattice on the silicon",
            ShingleMode::Word);
        assert_eq!(hamming_dist(a, stop_edit), 0, "stopword insertion must not move the word-path signature");
        // A real domain-word edit lands closer than unrelated text.
        let near = simhash_mode("the ballistic walk traverses the connectivity lattice on metal", ShingleMode::Word);
        let d_near = hamming_dist(a, near);
        assert!(d_near > 0, "a domain-word edit must move the signature");
        assert!(d_near < d_unrelated, "one-word domain edit ({}) should land closer than unrelated ({})", d_near, d_unrelated);
    }

    #[test]
    fn simhash_is_deterministic_and_empty_is_zero() {
        assert_eq!(simhash(SEED_A), simhash(SEED_A));
        assert_eq!(simhash(""), 0);
        assert_eq!(simhash("   \t\n "), 0);
    }

    #[test]
    fn shingles_short_text_is_one_feature() {
        assert_eq!(shingles("ab", 4), vec!["ab".to_string()]);
        assert_eq!(shingles("", 4), Vec::<String>::new());
        // "abcde" with n=4 → "abcd", "bcde"
        assert_eq!(shingles("abcde", 4), vec!["abcd".to_string(), "bcde".to_string()]);
    }

    // SECOND PINNED DIVERGENCE (found 2026-06-11 writing the weld test):
    // JS collapses whitespace RUNS (`replace(/\s+/g, ' ')`); Rust maps each
    // whitespace char 1:1 to a space (no collapse). So inputs containing
    // consecutive whitespace produce DIFFERENT signatures across the weld:
    //   JS  simhash("ballistic  walk on   silicon lattice") == simhash(single-spaced)
    //   Rust shingles keep the double space → different features → different sig.
    // The weld is bit-exact ONLY on single-spaced input. Documented in
    // docs/architecture/pmu-rust-verification-gaps.md; this test pins the
    // Rust behavior so a future fix is a visible CHOICE, not silent drift.
    #[test]
    fn whitespace_run_divergence_is_pinned() {
        // Rust does NOT collapse the run — "a  b" (4 chars) stays one feature
        // with two spaces, where JS would shingle "a b".
        assert_eq!(shingles("a  b", 4), vec!["a  b".to_string()]);
        // And therefore the multi-space and single-space signatures differ
        // in Rust (in JS they are equal — verified 2026-06-11).
        let multi = simhash("ballistic  walk on   silicon lattice");
        let single = simhash("ballistic walk on silicon lattice");
        assert_ne!(multi, single,
            "Rust now collapses whitespace runs — the weld scope changed; update the gap ledger and re-verify against the JS twin");
        // The JS value for BOTH spacings (runs collapsed): 0x59310aaae61f20a1.
        // Rust matches it on the single-spaced form only — the weld holds there.
        assert_eq!(single, 0x59310aaae61f20a1);
    }

    // THE PINNED NON-ASCII DIVERGENCE (char path — gap ledger item (3),
    // pinned 2026-06-11): JS fnv1a hashes `charCodeAt(i) & 0xff` — UTF-16
    // code-unit LOW BYTES, so 'é' contributes ONE byte (0xe9). Rust hashes
    // UTF-8 bytes, so 'é' contributes TWO (0xc3 0xa9). Identical for ASCII;
    // divergent for ANY non-ASCII character on the char path. The values
    // below are Rust's OWN fixtures — the JS twin produces DIFFERENT values,
    // recomputed from src/app/pmu-simulator/signature.mjs 2026-06-11:
    //   JS fnv1a("café", 1)                            = 0x9a36819baa19cfb5
    //   JS simhash("déjà vu on the café lattice", 64)  = 0x332113eccecdcd95
    // The WORD path cannot reach this divergence: its features are ASCII
    // [a-z0-9 ] by construction (word_shingles docs). ASCII equivalence
    // stays welded — asserted below and by the char/word weld fixtures above.
    #[test]
    fn non_ascii_fnv1a_divergence_is_pinned_as_rust_own_fixture() {
        // Rust UTF-8 fixtures — deliberately NOT the JS values (see above).
        assert_eq!(fnv1a("café".as_bytes(), 1), 0x24153b820990472a);
        assert_eq!(simhash("déjà vu on the café lattice"), 0xb0511be466de8d97);
        // The divergence is a tested FACT: if Rust ever starts matching the
        // JS UTF-16-low-byte values, the weld scope changed — update the gap
        // ledger and the JS twin in the SAME commit.
        assert_ne!(fnv1a("café".as_bytes(), 1), 0x9a36819baa19cfb5,
            "Rust now matches the JS UTF-16 low-byte hash — the char-path divergence closed; re-freeze the weld");
        assert_ne!(simhash("déjà vu on the café lattice"), 0x332113eccecdcd95,
            "Rust char-path simhash now matches the JS non-ASCII value — re-freeze the weld");
        // ASCII equivalence stays welded: same bytes on both sides → same
        // hash. 0x43744800edde7dd5 is the value BOTH twins produce for "walk".
        assert_eq!(fnv1a("walk".as_bytes(), 1), 0x43744800edde7dd5);
    }

    #[test]
    fn distances_are_sane_far_apart_vs_near_duplicate() {
        // Mirrors the JS golden distance test, on the char path.
        let a = simhash(SEED_A);
        let b = simhash(SEED_B);
        let d_unrelated = hamming_dist(a, b);
        assert!(d_unrelated >= 20, "unrelated seeds only {} bits apart — the sensor lost its grip", d_unrelated);
        let near = simhash("the ballistic walk traverses the connectivity lattice on the silicon");
        let d_near = hamming_dist(a, near);
        assert!(d_near < d_unrelated, "one-word edit ({}) should land closer than unrelated ({})", d_near, d_unrelated);
    }

    #[test]
    fn simhash_sim_bounds() {
        assert_eq!(simhash_sim(0, 0), 1.0);
        assert_eq!(simhash_sim(0, u64::MAX), 0.0);
    }
}
