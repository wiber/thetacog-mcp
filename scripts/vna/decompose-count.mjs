// C2366 — A LONG SINGLE-LINE DICTATION THAT CARRIES SEVERAL ASKS PRINTS A DECOMPOSE LINE (chair decomposition 2026-11-05 of the
// operator's words "build and ratchet the implied ones too"). splitAsks (steer.mjs) holds a single line as ONE ask unless it carries
// an explicit enumeration (C624 stands: a sentence boundary is how a person pauses, not how they enumerate). That rule is right and
// it is also how the 2026-11-05 "interesting didnt even think of that" and "Name the method and version /steer" dictations each
// became ONE row while carrying a dozen asks. This module never splits; it COUNTS boundary signals and the door prints one line so
// the chair numbers the asks (1) (2) … before the rows are declared.
//
// The signals are deterministic and each is a place a dictation hands over to a NEW ask, measured against the 2026-11-05 steers:
//   ?            a question mark ending a clause ("what else can we do?")
//   --           an ASCII double dash between clauses (the em dash is NOT one: the chair's preambles use it before every item)
//   also         "and also" · "also" as a joiner · "then you can" · "as well"
//   v1 v2 …      a sequential run of version markers (the C624 enumeration covers 1) (1) a); vN is not an enumeration it splits)
//   imperative   a sentence after the first that opens on an imperative verb ("Let's …", "Write …", "Make …")
//   " / "        a spaced slash between clauses (an unspaced understood/found/did is a list inside one ask, never counted)
// asks ≈ 1 + boundaries. The line prints at asks >= MIN_ASKS (4) on a line of >= MIN_WORDS words that splitAsks held whole.
// Guard: tests/vna/c2366-build-and-ratchet-the-implied-ones.test.mjs (the 2026-11-05 corpus, pinned as fixtures).
export const MIN_ASKS = 4;   // 3 fired on the one-ask "infer all the features" (a question + a "Let's"); every true multi-ask line read >= 7
export const MIN_WORDS = 30;
const IMPERATIVE = /^(?:let'?s|make|write|build|ship|fix|add|spec|run|put|show|drop|name|send|open|bash|use|move|keep|give|turn|wire|set|tie|declare|record|print|install|package|render|read|check|find|draft|commit|push|iterate|infer)\b/i;

export function decomposeSignals(line) {
  const t = String(line || '').trim();
  const sig = { question: 0, dash: 0, also: 0, version: 0, imperative: 0, slash: 0 };
  if (!t) return sig;
  sig.question = (t.match(/\?(?=\s|$|["')\].,])/g) || []).length;
  sig.dash = (t.match(/\s--\s/g) || []).length;
  sig.also = (t.match(/\b(?:and also|also|then you can|as well)\b/gi) || []).length;
  const vs = [...t.matchAll(/(?:^|\s)v(\d{1,2})\b/gi)].map((m) => Number(m[1]));
  let run = 0; for (let i = 0, want = 1; i < vs.length; i++) if (vs[i] === want) { run++; want++; }
  sig.version = run >= 2 ? run - 1 : 0;
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  sig.imperative = sentences.slice(1).filter((s) => IMPERATIVE.test(s)).length;
  sig.slash = (t.match(/\s\/\s/g) || []).length;
  return sig;
}

/** the estimated ask count of ONE line (1 + its boundary signals) */
export function countAsks(line) {
  const s = decomposeSignals(line);
  return 1 + Object.values(s).reduce((a, b) => a + b, 0);
}

/** the decompose line for a dictation, or null. `held` = the asks splitAsks returned; only a dictation held as ONE line is read. */
export function decomposeLine(text, held) {
  const t = String(text || '').trim();
  if (!t || /\r?\n/.test(t)) return null;            // a multi-line text is already one ask per line (C422)
  if (Array.isArray(held) && held.length !== 1) return null;   // an explicit enumeration already split it (C624)
  if (t.split(/\s+/).filter(Boolean).length < MIN_WORDS) return null;
  const n = countAsks(t);
  if (n < MIN_ASKS) return null;
  return `decompose: this dictation carries ~${n} asks on one line — number them (1) (2) … so each becomes its own row`;
}
