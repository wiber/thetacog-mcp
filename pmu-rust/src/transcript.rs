// .thetacog/pmu/src/transcript.rs
//
// M1 — the transcript reader/streamer.
// Spec: docs/architecture/pmu-streaming-rust-ollama-spec.md §6 (milestone M1).
//
// Turns the Claude Code chat-transcript stream into intent + reality claims.
// Source: ~/.claude/projects/<repo-path-dashed>/*.jsonl — heterogeneous NDJSON,
// one JSON object per line, discriminated by a top-level "type". Single files
// reach 28 MB and single lines reach multi-MB (embedded tool_result dumps), so
// the reader is INCREMENTAL: it consumes only complete lines from a byte offset
// and leaves the partial trailing line for the next read (the stream cursor).
//
// FRAME-SHAPED on purpose: every read advances `new_offset` and yields the
// claims for one movie frame. Downstream, the ballistic walk emits a walk frame
// per re-light and G1 signs it — so this cursor is the heartbeat of the
// "tolerance movie" and, once each frame carries a receipt, the
// "insurance movie streaming receipt."
//
// RELIABILITY FIRST: complete-lines-only + idempotent offset cursor + lossy
// UTF-8 at a guaranteed-clean newline boundary means a half-written line, an
// invalid byte, or a re-read never corrupts state — the read is replayable.
//
// THE GATE: this module is bit-identical to the Node reference
// readNewLines / firstUserPromptOf / assistantTextOf in
// scripts/pmu/resident-watch.mjs. That equivalence is the M1 acceptance test.

use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom};

/// Result of one incremental read: the complete lines consumed and the advanced cursor.
#[derive(Debug, PartialEq)]
pub struct ReadResult {
    pub new_offset: u64,
    pub lines: Vec<String>,
}

/// Read complete NEW lines starting at byte `offset`. A partial trailing line
/// (no '\n' yet) stays unconsumed and the cursor does not advance past it.
/// Mirror of readNewLines() in resident-watch.mjs.
pub fn read_new_lines(path: &str, offset: u64) -> std::io::Result<ReadResult> {
    let mut f = fs::File::open(path)?;
    let size = f.metadata()?.len();
    if size <= offset {
        return Ok(ReadResult { new_offset: offset, lines: Vec::new() });
    }
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; (size - offset) as usize];
    f.read_exact(&mut buf)?;
    // last newline within the buffer; nothing complete before it → consume nothing.
    let last_nl = match buf.iter().rposition(|&b| b == 0x0a) {
        Some(i) => i,
        None => return Ok(ReadResult { new_offset: offset, lines: Vec::new() }),
    };
    let chunk = &buf[..=last_nl];
    // newline is never a UTF-8 continuation byte, so the chunk ends cleanly;
    // any interior invalid bytes become U+FFFD, matching Buffer.toString('utf8').
    let text = String::from_utf8_lossy(chunk);
    let lines: Vec<String> = text
        .split('\n')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    Ok(ReadResult { new_offset: offset + chunk.len() as u64, lines })
}

/// First user prompt with every <system-reminder> span stripped, that is
/// longer than 40 (JS String.length / UTF-16) code units. firstUserPromptOf().
pub fn first_user_prompt(path: &str) -> std::io::Result<String> {
    let content = fs::read_to_string(path)?;
    for line in content.split('\n').filter(|s| !s.is_empty()) {
        let obj: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let msg = &obj["message"];
        if msg["role"] != "user" {
            continue;
        }
        let stripped = strip_system_reminders(&user_text(msg));
        let txt = stripped.trim();
        if js_len(txt) > 40 {
            return Ok(txt.to_string());
        }
    }
    Ok(String::new())
}

/// Assistant `text` blocks, joined per message by '\n'. assistantTextOf().
pub fn assistant_text(lines: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for line in lines {
        let obj: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let msg = &obj["message"];
        if msg["role"] != "assistant" {
            continue;
        }
        let blocks = match msg["content"].as_array() {
            Some(a) => a,
            None => continue,
        };
        let txt = blocks
            .iter()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if !txt.trim().is_empty() {
            out.push(txt);
        }
    }
    out
}

/// Assistant `thinking` blocks — the plan stream that extends the intent corpus
/// (spec §4.1). No Node equivalent; new in the Rust reader.
pub fn thinking_text(lines: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for line in lines {
        let obj: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let msg = &obj["message"];
        if msg["role"] != "assistant" {
            continue;
        }
        let blocks = match msg["content"].as_array() {
            Some(a) => a,
            None => continue,
        };
        for b in blocks {
            if b["type"] == "thinking" {
                if let Some(t) = b["thinking"].as_str() {
                    if !t.is_empty() {
                        out.push(t.to_string());
                    }
                }
            }
        }
    }
    out
}

/// Extract the text payload of a user `message` (content is either a bare string
/// or an array of blocks; only `text` blocks with truthy text contribute).
fn user_text(message: &Value) -> String {
    match &message["content"] {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Strip every <system-reminder>…</system-reminder> span, global and non-greedy,
/// matching the JS regex /<system-reminder>[\s\S]*?<\/system-reminder>/g. An
/// unmatched open tag is left verbatim (the regex would not match it).
fn strip_system_reminders(s: &str) -> String {
    const OPEN: &str = "<system-reminder>";
    const CLOSE: &str = "</system-reminder>";
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    loop {
        match rest.find(OPEN) {
            Some(start) => {
                out.push_str(&rest[..start]);
                let after_open = &rest[start + OPEN.len()..];
                match after_open.find(CLOSE) {
                    Some(end) => rest = &after_open[end + CLOSE.len()..],
                    None => {
                        // no closing tag → keep open tag and the remainder as-is
                        out.push_str(&rest[start..]);
                        break;
                    }
                }
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }
    out
}

/// JS String.length is UTF-16 code units; match it so the >40 threshold is exact.
fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    const L_TITLE: &str = r#"{"type":"custom-title","sessionId":"s1","customTitle":"x"}"#;
    const L_USER_SHORT: &str = r#"{"type":"user","message":{"role":"user","content":"hi there"}}"#;
    const L_USER_LONG: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>noise here</system-reminder>Build the streaming transcript reader for the chip"}]}}"#;
    const L_ASST: &str = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"plan: read lines"},{"type":"text","text":"I will build it."},{"type":"text","text":"Starting now."}]}}"#;
    const PARTIAL: &str = r#"{"incomplete"#;

    fn write_fixture(tag: &str, with_partial: bool) -> String {
        let mut body = format!("{}\n{}\n{}\n{}\n", L_TITLE, L_USER_SHORT, L_USER_LONG, L_ASST);
        if with_partial {
            body.push_str(PARTIAL);
        }
        let path = std::env::temp_dir()
            .join(format!("pmu-transcript-{}-{}.jsonl", std::process::id(), tag));
        fs::write(&path, &body).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn read_new_lines_returns_complete_and_leaves_partial_unconsumed() {
        let path = write_fixture("partial", true);
        let full = fs::read(&path).unwrap();
        let r = read_new_lines(&path, 0).unwrap();
        assert_eq!(r.lines.len(), 4);
        assert_eq!(r.lines[0], L_TITLE);
        assert_eq!(r.lines[3], L_ASST);
        assert_eq!(r.new_offset, (full.len() - PARTIAL.len()) as u64);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn read_new_lines_from_cursor_yields_nothing_until_newline() {
        let path = write_fixture("cursor", true);
        let full = fs::read(&path).unwrap();
        let cursor = (full.len() - PARTIAL.len()) as u64;
        let r = read_new_lines(&path, cursor).unwrap();
        assert!(r.lines.is_empty());
        assert_eq!(r.new_offset, cursor);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn read_new_lines_at_eof_is_empty() {
        let path = write_fixture("eof", false);
        let size = fs::metadata(&path).unwrap().len();
        let r = read_new_lines(&path, size).unwrap();
        assert!(r.lines.is_empty());
        assert_eq!(r.new_offset, size);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn first_user_prompt_skips_short_and_strips_reminders() {
        let path = write_fixture("firstprompt", false);
        let p = first_user_prompt(&path).unwrap();
        assert_eq!(p, "Build the streaming transcript reader for the chip");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn assistant_text_joins_text_blocks_per_message() {
        let lines = vec![L_TITLE.to_string(), L_ASST.to_string()];
        assert_eq!(
            assistant_text(&lines),
            vec!["I will build it.\nStarting now.".to_string()]
        );
    }

    #[test]
    fn thinking_text_extracts_thinking_blocks() {
        let lines = vec![L_ASST.to_string()];
        assert_eq!(thinking_text(&lines), vec!["plan: read lines".to_string()]);
    }

    #[test]
    fn strip_system_reminders_is_global_and_nongreedy() {
        let s = "a<system-reminder>X</system-reminder>b<system-reminder>Y</system-reminder>c";
        assert_eq!(strip_system_reminders(s), "abc");
        // unmatched open tag is preserved verbatim
        assert_eq!(strip_system_reminders("keep<system-reminder>open"), "keep<system-reminder>open");
    }

    #[test]
    fn js_len_counts_utf16_code_units() {
        assert_eq!(js_len("abc"), 3);
        // a BMP char is 1 unit; an astral char (emoji) is 2 (surrogate pair) — JS parity
        assert_eq!(js_len("a\u{1F600}"), 3);
    }
}
