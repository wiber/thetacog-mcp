#!/usr/bin/env node
// scripts/pmu/walk-audio.mjs — BRICK #6: the optional audio walkthrough (local TTS).
//
// Operator (2026-06-10): "create an audio — that's local work. Gemini creates a transcript, we read it
// with the local [voice] and send it. Have a flag for it; while we're on Wi-Fi send the audio on the
// commit. The audio is optional — turn it on/off." So: the Brick #5 STORY text is the transcript; this
// renders it to an MP3 LOCALLY (macOS `say` → lame, no network, no API cost — the voice-file engine
// from memory) and hands back the path for the email to attach. Graceful: no `say`/`lame` → null, no fail.
//
// @canonical-algorithm  local TTS: clean the Brick #5 story for speech → macOS `say -v <voice>` (aiff) → lame (mp3); return path; graceful if the tools are absent
// @forbidden-alternative  a paid/cloud TTS on the critical path · bracket/markup tags in the spoken text (say reads them aloud) · generating audio in the post-commit hook (off-path, --audio only)
// @why  audio is local + free + optional; it lets the operator HEAR the read on the move — text always, audio on demand
// @guard  tests/pmu-simulator/walk-audio.test.mjs
//
// Usage (lib):  import { renderAudio } from './walk-audio.mjs'; const mp3 = renderAudio(storyText, '/tmp/x.mp3')

import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';

const have = (cmd) => { try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; } };

// Clean the story for SPEECH: drop the section headers + the machine verdict line, strip any markup,
// normalize whitespace — `say` reads punctuation/tags literally, so a clean transcript matters.
export function speechText(story) {
  return String(story || '')
    .replace(/INGEST\s*=\s*(GOOD|SUSPECT|UNKNOWN|ERROR)/gi, '')   // drop the machine verdict token
    .replace(/^\s*(STORY|INGEST)\s*:?\s*$/gim, '')                // drop bare section headers
    .replace(/^\s*(STORY|INGEST)\s*:/gim, '')                     // …or inline header labels
    .replace(/[<>*_`#|]+/g, ' ')                                  // strip markup the voice would read
    .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ')
    .replace(/\s+([.,;:])/g, '$1').trim();
}

// Render text → mp3 locally. voice defaults to Ava (Premium) — the canonical audio default (easier to
// hear). Returns the mp3 path on success, or null (no `say`/`lame`, empty text, or a render error) — never throws.
export function renderAudio(storyText, outMp3, { voice = 'Ava (Premium)' } = {}) {
  const text = speechText(storyText);
  if (text.length < 20) return null;
  if (!have('say') || !have('lame')) return null;
  const aiff = outMp3.replace(/\.mp3$/, '') + '.aiff';
  const txt = outMp3.replace(/\.mp3$/, '') + '.txt';
  try {
    writeFileSync(txt, text);
    execFileSync('say', ['-v', voice, '-o', aiff, '-f', txt], { stdio: 'ignore' });
    execFileSync('lame', ['--quiet', '-V5', aiff, outMp3], { stdio: 'ignore' });
    try { unlinkSync(aiff); unlinkSync(txt); } catch { /* */ }
    return existsSync(outMp3) ? outMp3 : null;
  } catch { return null; }
}

// CLI self-demo.
if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = 'STORY\nReality tracked the intent, staying in lane with zero red drift.\nINGEST\nThe sensor gripped on-topic content. INGEST=GOOD';
  const out = renderAudio(demo, '/tmp/walk-audio-demo.mp3');
  console.log(out ? `wrote ${out}` : '(no say/lame available — skipped)');
  if (out) console.log('spoken text:', JSON.stringify(speechText(demo)));
}
