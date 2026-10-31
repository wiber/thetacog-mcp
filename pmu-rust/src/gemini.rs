//! The gemini-web scrape dialect, read on the chip.
//!
//! Gemini has no export API, so the scrape writes its own shape: one header line
//!
//!     {"conversationId":"…","scrapedAt":"…","kind":"main","source":"gemini-web", …}
//!
//! followed by turn lines {"cid":"…","role":"…","text":"…"}. JS grew TWO hand-rolled parsers
//! for it — flattenGeminiWeb() in transcript-ingest.mjs and an inline loop in
//! turn-identity.mjs. One string, two mirrors: fix the dialect in one and the other keeps its
//! own idea of the shape.
//!
//! This port is qualified by the only criterion that applies: it DELETES both JS parsers
//! rather than adding a third copy. A port that adds a parallel copy is taste drifting into
//! cost, and it is countable in the diff.
//!
//! REFUSES RATHER THAN SKIPS. Both JS parsers did `try { JSON.parse } catch { continue }`, so
//! a shape change on Google's side would have produced a shorter transcript and exit 0 —
//! silent success, which this repo has paid for repeatedly. An unrecognised line is a claim
//! that the dialect moved, and that claim is worth more than the turns it costs.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct GeminiTurn {
    pub cid: String,
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeminiWeb {
    pub conversation_id: String,
    pub scraped_at: String,
    pub turns: Vec<GeminiTurn>,
}

/// Parse a gemini-web scrape. `Err` names the offending line, because a refusal a human
/// cannot act on is only marginally better than a silent skip.
pub fn read_gemini_web(path: &str) -> Result<GeminiWeb, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let mut lines = raw.lines().filter(|l| !l.trim().is_empty());

    let head_raw = lines.next().ok_or_else(|| format!("{path}: empty file"))?;
    let head: Value = serde_json::from_str(head_raw)
        .map_err(|e| format!("{path}: line 1 is not JSON ({e}) — expected the scrape header"))?;
    if head["kind"] != "main" {
        return Err(format!(
            "{path}: line 1 is not a gemini-web header (kind={}) — the dialect moved, or this \
             is a different transcript",
            head["kind"]
        ));
    }
    let conversation_id = head["conversationId"]
        .as_str()
        .ok_or_else(|| format!("{path}: header carries no conversationId"))?
        .to_string();
    // scrapedAt is the ONLY timestamp in the file and it lives at byte zero. An absent one is
    // recorded as empty rather than refused: the turns are still real, and a store that can
    // say "I have turns with no cutoff" is more useful than one that discarded them.
    let scraped_at = head["scrapedAt"].as_str().unwrap_or_default().to_string();

    let mut turns = Vec::new();
    for (i, line) in lines.enumerate() {
        let n = i + 2; // 1-based, and line 1 was the header
        let v: Value =
            serde_json::from_str(line).map_err(|e| format!("{path}:{n}: not JSON ({e})"))?;
        if v["kind"] == "main" {
            return Err(format!("{path}:{n}: a second header — two conversations in one file"));
        }
        let cid = v["cid"]
            .as_str()
            .ok_or_else(|| format!("{path}:{n}: turn has no cid — dialect changed"))?;
        let role = v["role"]
            .as_str()
            .ok_or_else(|| format!("{path}:{n}: turn has no role — dialect changed"))?;
        let text = v["text"]
            .as_str()
            .ok_or_else(|| format!("{path}:{n}: turn has no text — dialect changed"))?;
        turns.push(GeminiTurn {
            cid: cid.to_string(),
            role: role.to_string(),
            text: text.to_string(),
        });
    }
    Ok(GeminiWeb { conversation_id, scraped_at, turns })
}

/// The JSON the CLI prints. Field names match what the JS parsers returned, so the bit-identity
/// gate compares like with like rather than comparing a rename.
pub fn to_json(g: &GeminiWeb) -> Value {
    serde_json::json!({
        "conversationId": g.conversation_id,
        "scrapedAt": g.scraped_at,
        "turns": g.turns.iter().map(|t| serde_json::json!({
            "cid": t.cid, "role": t.role, "text": t.text,
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const HEAD: &str = r#"{"conversationId":"abc123","title":"T","url":"u","turns":2,"scrapedAt":"2026-08-25T18:52:23Z","kind":"main","source":"gemini-web"}"#;
    const T1: &str = r#"{"cid":"c1","role":"user","text":"first thing"}"#;
    const T2: &str = r#"{"cid":"c2","role":"model","text":"second thing"}"#;

    fn fixture(tag: &str, body: &str) -> String {
        let p = std::env::temp_dir().join(format!("gemweb-{tag}.jsonl"));
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(body.as_bytes()).unwrap();
        p.to_string_lossy().to_string()
    }

    #[test]
    fn reads_header_and_turns_in_order() {
        let p = fixture("ok", &format!("{HEAD}\n{T1}\n{T2}\n"));
        let g = read_gemini_web(&p).expect("well-formed scrape refused");
        assert_eq!(g.conversation_id, "abc123");
        assert_eq!(g.scraped_at, "2026-08-25T18:52:23Z");
        assert_eq!(g.turns.len(), 2);
        assert_eq!(g.turns[0].role, "user");
        assert_eq!(g.turns[1].text, "second thing");
    }

    // SMOKE: every shape change must be LOUD. Both JS parsers skipped these silently.
    #[test]
    fn refuses_a_file_with_no_header() {
        let p = fixture("nohead", &format!("{T1}\n"));
        let e = read_gemini_web(&p).unwrap_err();
        assert!(e.contains("not a gemini-web header"), "wrong refusal: {e}");
    }

    #[test]
    fn refuses_a_turn_missing_a_field_naming_the_line() {
        let bad = r#"{"cid":"c1","role":"user"}"#;
        let p = fixture("notext", &format!("{HEAD}\n{T1}\n{bad}\n"));
        let e = read_gemini_web(&p).unwrap_err();
        assert!(e.contains("no text"), "wrong refusal: {e}");
        assert!(e.contains(":3:"), "the refusal does not name the offending line: {e}");
    }

    #[test]
    fn refuses_unparseable_json_rather_than_skipping_it() {
        let p = fixture("badjson", &format!("{HEAD}\n{T1}\nnot json at all\n"));
        assert!(read_gemini_web(&p).is_err(), "a corrupt line was silently skipped");
    }

    #[test]
    fn refuses_two_conversations_concatenated() {
        let p = fixture("twohead", &format!("{HEAD}\n{T1}\n{HEAD}\n"));
        let e = read_gemini_web(&p).unwrap_err();
        assert!(e.contains("second header"), "wrong refusal: {e}");
    }

    // NO SMOKE: an absent scrapedAt is not a dialect change — the turns are still real.
    #[test]
    fn a_header_without_scraped_at_still_reads() {
        let h = r#"{"conversationId":"abc123","kind":"main"}"#;
        let p = fixture("nots", &format!("{h}\n{T1}\n"));
        let g = read_gemini_web(&p).expect("a missing timestamp must not lose the turns");
        assert_eq!(g.scraped_at, "");
        assert_eq!(g.turns.len(), 1);
    }
}
