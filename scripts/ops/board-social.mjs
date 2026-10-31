// scripts/ops/board-social.mjs — C1020z: EVERY LINKEDIN CONNECTION AND EVERY X FOLLOWER ON THE BOARD, JOINED TO PEOPLE, WITH A STAGE.
// Operator 2026-10-19, verbatim: "linkedin - all linkedin people - to be marketed up etc (added them to the repo) as well as twitter
// followers" · "I pasted the linkedin and x followers / connections into a txt file recently put them into the sheets".
//
// THE SOURCE is the page text he pasted, read in place and never copied into a tracked file (it is other people's names and
// headlines): docs/05-content/blog/scratchpad/linkedinE.txt (2026-10-17). Two shapes live in it:
//   X        <name> / @<handle> / [Follows you] / <bio>      — the Followers tab of x.com/Wiber, pasted twice (dedup by handle)
//   LinkedIn <name> / <headline> / Connected on <date> / Message — the Connections page ("631 connections")
// A page paste is what the page had rendered: the counts are what was pasted, never the account's full list. The tab says so.
// THE JOIN: neither source carries an email, so a person joins the People tab by full name of two or more words, case-folded; a
// single-word or unmatched name reads "no match", never a guess. STAGE is read off the People row it joined:
//   connected / follows → warmed (a direct email on the record) → in book club → in a room. "paying" is UNMEASURED: no licence
//   ledger is keyed to a person's name. LLM-FREE.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SOCIAL_SOURCE = process.env.BOARD_SOCIAL_SOURCE || 'docs/05-content/blog/scratchpad/linkedinE.txt';
const clean = (s) => String(s || '').replace(/^☑\s*/, '').trim();

export function parseSocial(text) {
  const L = String(text || '').split('\n').map((l) => l.replace(/\r$/, ''));
  const x = new Map(); const li = new Map();
  for (let i = 1; i < L.length; i++) {
    const h = L[i].trim();
    if (/^@[A-Za-z0-9_]{1,15}$/.test(h)) {
      let j = i - 1; while (j > 0 && !L[j].trim()) j--;   // a verified badge renders as a blank line between the name and the handle
      const name = clean(L[j]);
      if (!name || /^(Follows you|Verified Followers|Followers|Following|Square profile picture)$/.test(name) || name.startsWith('@')) continue;
      const follows = L[i + 1]?.trim() === 'Follows you';
      const bio = clean(L[i + (follows ? 2 : 1)]);
      if (!x.has(h.toLowerCase())) x.set(h.toLowerCase(), { name, handle: h, follows, bio: /^@|^$/.test(bio) ? '' : bio });
    }
    const m = /^Connected on (.+)$/.exec(h);
    if (m) {
      const name = clean(L[i - 2]); const headline = clean(L[i - 1]);
      if (name && !li.has(name.toLowerCase())) li.set(name.toLowerCase(), { name, headline, connected: m[1].trim() });
    }
  }
  return { x: [...x.values()].filter((r) => r.follows), li: [...li.values()] };
}

export const nameKey = (n) => { const k = String(n || '').toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim(); return k.split(' ').length >= 2 ? k : null; };

// People rows (header + rows, as peopleTab emits them) → name key → { stage, id }.
export function peopleIndex(peopleRows) {
  const [head, ...rows] = peopleRows || [[]]; const col = (n) => head.indexOf(n);
  const iN = col('NAME'), iId = col('ID'), iR = col('ROOMS'), iB = col('BOOK CLUB'), iD = col('DIRECT EMAILS');
  const idx = new Map();
  for (const r of rows) {
    const k = nameKey(r[iN]); if (!k || idx.has(k)) continue;
    const stage = r[iR] ? 'in a room' : r[iB] === 'member' ? 'in book club' : Number(r[iD]) > 0 ? 'warmed' : null;
    idx.set(k, { id: r[iId], stage });
  }
  return idx;
}

const stageOf = (base, hit) => (hit && hit.stage ? hit.stage : base);

export function socialTabs({ text = existsSync(resolve(REPO, SOCIAL_SOURCE)) ? readFileSync(resolve(REPO, SOCIAL_SOURCE), 'utf8') : null, people = [[]] } = {}) {
  if (text == null) { const u = [[`UNMEASURED — no source at ${SOCIAL_SOURCE}`]]; return { li: u, x: u }; }
  const { x, li } = parseSocial(text); const idx = peopleIndex(people);
  const note = (n, what) => `${n} ${what} as pasted into ${SOCIAL_SOURCE} — a page paste holds what the page had rendered, not the whole account`;
  const liRows = [['NAME', 'HEADLINE', 'CONNECTED ON', 'STAGE', 'PEOPLE ID', 'PAYING', 'STATE (fill)', 'NEXT STEP (fill)', 'GRADE 0–9 (fill)', 'COMMENT (fill)'],
    ...li.map((p) => { const hit = idx.get(nameKey(p.name)); return [p.name, p.headline, p.connected, stageOf('connected', hit), hit ? hit.id : 'no match', 'UNMEASURED', '', '', '', '']; }),
    [note(li.length, 'LinkedIn connections')]];
  const xRows = [['NAME', 'HANDLE', 'BIO', 'STAGE', 'PEOPLE ID', 'PAYING', 'STATE (fill)', 'NEXT STEP (fill)', 'GRADE 0–9 (fill)', 'COMMENT (fill)'],
    ...x.map((p) => { const hit = idx.get(nameKey(p.name)); return [p.name, p.handle, p.bio, stageOf('follows', hit), hit ? hit.id : 'no match', 'UNMEASURED', '', '', '', '']; }),
    [note(x.length, 'X followers')]];
  return { li: liRows, x: xRows };
}
