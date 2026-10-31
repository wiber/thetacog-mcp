// scripts/bookclub/club-subject.mjs — the ONE home of the book-club subject's shape (operator 2026-10-07:
// "put the chapter name first in the subject row … starting with the chapter name then paragraph and
// number, then book club … we tried many times and it still fails"). It failed because the shape lived as a
// template string in render-email.mjs and as six hand-copied `^📖 Book Club · ` regexes in its readers; a
// change to one left the others reading the old order. Now the writer and every reader import from here.
//
//   Ch 8: From Meat to Metal · ¶1–10 · 📖 Book Club · 2026-10-07
//
// The "📖 Book Club · <day>" stem moved to the END but is still one contiguous string, so the ledger key
// LIKE '%Book Club · <day>%' (publish-editions, send-compare, roundup) matches both the old and new shape.
// Readers see subjects of BOTH shapes for as long as the ledger holds pre-2026-10-07 rows.
// Guard: tests/comms/club-subject-chapter-first.test.mjs.

/** "Chapter 8: From Meat to Metal" → "Ch 8: From Meat to Metal" (the name stays; only the word shortens). */
export function chapterLabel(chapter) {
  const c = String(chapter || '').trim();
  return c.replace(/^chapter\s+/i, 'Ch ').replace(/^appendix\s+/i, 'App ').replace(/^part\s+/i, 'Part ');
}

export const CLUB_STEM = (day) => `📖 Book Club · ${day}`;

/** The subject for a hook (chapter + ¶ range, or a composed line): the hook first, the stem last. */
export function clubSubject(hook, day) {
  const h = stripClubStem(hook);
  return h ? `${h} · ${CLUB_STEM(day)}` : CLUB_STEM(day);
}

// Old shape: "📖 Book Club · 2026-10-05 — The False Fit · ¶1–16 · Ch 5". New shape: "… · 📖 Book Club · 2026-10-07".
const OLD_PREFIX = /^\s*📖\s*Book Club · \S+ ?—? ?/;
const NEW_SUFFIX = /\s*·\s*📖\s*Book Club · \d{4}-\d{2}-\d{2}\s*$/;

/** The hook alone, whichever shape the subject has (and however many times a pasted stem was doubled). */
export function stripClubStem(s) {
  let t = String(s || '').trim();
  for (let i = 0; i < 4 && (OLD_PREFIX.test(t) || NEW_SUFFIX.test(t)); i++) t = t.replace(OLD_PREFIX, '').replace(NEW_SUFFIX, '').trim();
  return t;
}

/** Is this subject one our renderer emitted (either shape)? A construct, not the words "book club" anywhere —
 *  a cold outreach titled "an invitation to the book club" carries neither the emoji stem nor the dated suffix. */
export const FEED_SUBJECT = /^\s*📖\s*Book Club\s*·|·\s*📖\s*Book Club · \d{4}-\d{2}-\d{2}\s*$/;

/** The day a club subject names, either shape; null when it is not one of ours. */
export function clubDay(s) {
  const m = String(s || '').match(/📖\s*Book Club · (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
