#!/usr/bin/env node
// scripts/vna/splatter.mjs — FROM RED SPLATTER TO A SENTENCE YOU CAN ACT ON.
//
// Operator: "the panel has to translate this into the real categories that make sense for the
// project aspect you're working on … from where the red splatter is to explaining where the doctor
// started acting like a plumber. What tool did you use? What words were different?"
//
// A coordinate is not a diagnosis. "C2.Operations.Loop × A1.Strategy.Law" tells you WHERE mass
// landed and nothing about what took it there. The story needs three things the lattice already
// holds and nobody was reading together:
//
//   THE ROOM YOU DECLARED  — the nearest strand, with the vocabulary of ITS coordinate.
//   THE ROOM YOU WORKED IN — the coordinate the mass snapped to, with the vocabulary of THAT one.
//   THE WORDS THAT CARRIED IT — terms present in the commit that belong to the landed coordinate's
//                               vocabulary and NOT to the declared one. That is the tool in the
//                               doctor's hand: not an inference, the actual words in the diff.
//
// THE VOCABULARY IS NOT INVENTED. It comes from data/pmu/snippet-library-144.json — the same 144
// snippets the walk is seeded from — so the words the story quotes are the words the placement was
// computed against. A story built from a different vocabulary than the measurement would be a second
// opinion wearing the receipt's clothes.
//
// IT NARRATES PLACEMENT, NEVER ACTION. "Mass landed in the plumbing lane" is a fact about the
// lattice. "You went off and did plumbing" is a claim about what an agent decided, and one click on
// the commit can disprove it. The distinction is the difference between a receipt and a story about
// a person, and this file stays on the first side of it.
//
// LLM-FREE: set intersection over the corpus and two snippet vocabularies. No model reads this.
//
// @guard tests/vna/splatter.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mesh, fullName, HORIZON } from './mesh.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const LIB = resolve(REPO, 'data/pmu/snippet-library-144.json');
const g = (c) => execSync(c, { cwd: REPO, maxBuffer: 1 << 26 }).toString();

const STOP = new Set(('the a an and or of to in for on with is are was were be been it its this that as at by from we you i our your their they them not no but if then than so can will may must should would could have has had do does did make made new use used using one two more most other some such only own same too very just about into over under again further once here there all any both each few nor own s t don now'.split(' ')));
const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z][a-z-]{2,}/g)?.filter((w) => !STOP.has(w)) || []);

// DISTINCTIVENESS IS THE WHOLE POINT OF THE NET, so the words a story quotes must be distinctive.
// A term that appears in most of the 144 snippets ("every", "which", "future") carries no lane
// information — quoting it makes the diagnosis sound specific while pointing nowhere. Document
// frequency across the library is the measure, and the cut is stated rather than tuned: a word must
// appear in at most a QUARTER of the coordinates to count as belonging to one.
// MEASURED, AND THE MEASUREMENT SAYS THE LIBRARY IS COARSER THAN THE STORY NEEDS: across the 144
// snippets the vocabulary is 739 words with a MEDIAN document frequency of 23 — the snippets are
// short prose in one house register, so most terms appear in about a sixth of the coordinates.
// Document frequency is therefore a weak discriminator here, and the correct response is not to tune
// the ceiling until the words look good. It is to report it: a story whose words are no rarer than
// the library's median is a WEAK story, and it says so. That is the operator's own point about mesh
// size, applied to the net's vocabulary rather than to its geometry — if the strands are not
// distinctive, the diagnosis they support is not either.
const DF_CEILING = 0.25;
function documentFrequency(lib) {
  const df = new Map();
  for (const a of lib.values()) {
    for (const w of new Set(words(a?.snippet))) df.set(w, (df.get(w) || 0) + 1);
  }
  const vals = [...df.values()].sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  return { df, n: lib.size, median, vocab: df.size };
}

function library() {
  if (!existsSync(LIB)) return null;
  try {
    let raw = JSON.parse(readFileSync(LIB, 'utf8'));
    if (!Array.isArray(raw)) raw = raw.anchors || raw.nodes || [];
    const by = new Map();
    for (const a of raw) if (a?.coord) by.set(a.coord, a);
    return by;
  } catch { return null; }
}

// A coordinate is actor,patient — two anchors. Its vocabulary is the union of both, which is what
// the composed cell carries in the placement.
function vocabOf(lib, coord) {
  const m = /^([A-C][1-3]?),([A-C][1-3]?)$/.exec(String(coord || '').trim());
  if (!lib || !m) return new Set();
  const out = new Set();
  for (const half of [m[1], m[2]]) {
    const a = lib.get(`${half},${half}`) || lib.get(half);
    for (const w of words(a?.snippet)) out.add(w);
  }
  return out;
}

export function splatter({ limit = 5, net } = {}) {
  const m = net || mesh();
  if (m.missing) return { missing: true, cmd: m.cmd };
  const lib = library();
  if (!lib) return { missing: true, cmd: 'data/pmu/snippet-library-144.json is absent — the vocabulary the placement used is not readable' };
  const { df, n: libN, median: dfMedian, vocab } = documentFrequency(lib);
  const distinctive = (w) => (df.get(w) || 0) <= Math.max(1, Math.floor(libN * DF_CEILING));

  const stories = [];
  for (const h of (m.holes || []).slice(0, limit)) {
    const landedVocab = vocabOf(lib, h.coord);
    const declaredCoord = h.nearest?.coord || null;
    const declaredVocab = declaredCoord ? vocabOf(lib, declaredCoord) : new Set();

    // The corpus of the commits that actually landed here — their messages and their file paths,
    // which is where the tool shows up by name.
    let corpus = '';
    for (const sha of (h.shas || []).slice(0, 4)) {
      try { corpus += g(`git log -1 --pretty=%B ${sha}`) + '\n' + g(`git show --name-only --pretty=format: ${sha}`) + '\n'; } catch { /* gone */ }
    }
    const said = words(corpus);
    const carried = [...landedVocab].filter((w) => said.has(w) && !declaredVocab.has(w) && distinctive(w))
      .sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0));   // rarest first: the most lane-specific words lead
    const shared = [...landedVocab].filter((w) => said.has(w) && declaredVocab.has(w) && distinctive(w))
      .sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0));

    // How distinctive the quoted words actually are, as a number rather than a feeling.
    const dfs = carried.map((w) => df.get(w) || 0).sort((a, b) => a - b);
    const storyDf = dfs.length ? dfs[Math.floor(dfs.length / 2)] : null;
    const weak = storyDf == null || storyDf >= dfMedian;

    stories.push({
      coord: h.coord, name: h.name, n: h.n, shas: h.shas,
      distinctiveness: { medianDf: storyDf, libraryMedianDf: dfMedian, libraryVocab: vocab, weak },
      declared: declaredCoord ? { id: h.nearest.id, coord: declaredCoord, name: fullName(declaredCoord), blocks: h.nearest.d } : null,
      horizonLanded: HORIZON[(h.coord || '')[0]] || null,
      horizonDeclared: declaredCoord ? HORIZON[declaredCoord[0]] || null : null,
      carried: carried.slice(0, 12),
      shared: shared.slice(0, 6),
      // The sentence. It says what landed where and which words carried it — and it explicitly does
      // not say what anyone intended, because the lattice cannot know that.
      story: declaredCoord
        ? `${h.n} commit(s) landed at ${h.name} while the nearest declaration (${h.nearest.id}) sits at ${fullName(declaredCoord)}, ${h.nearest.d} blocks away.` +
          (carried.length
            ? ` The words in those commits that belong to where it landed and not to what was declared: ${carried.slice(0, 8).join(', ')}.` +
              (weak ? ` (WEAK — those words are no rarer than the library's median coordinate, so they name the lane only loosely; the net's vocabulary is coarser than this diagnosis needs.)` : '')
            : ' No vocabulary from the landed coordinate appears in those commits — the placement came from structure rather than words, and this story is weaker for it.')
        : `${h.n} commit(s) landed at ${h.name} and there is no declaration anywhere on the lattice to compare it against.`,
    });
  }
  return { at: new Date().toISOString(), fence: m.fence, meshSize: m.meshSize, stories };
}

export function splatterText(s) {
  if (s.missing) return `not run — ${s.cmd}`;
  const l = ['# THE SPLATTER, TRANSLATED — what landed where, and the words that carried it'];
  for (const st of s.stories) {
    l.push('');
    l.push(`## ${st.name}${st.horizonLanded ? ` (${st.horizonLanded}-term)` : ''} ← ${st.declared ? `${st.declared.id} at ${st.declared.name}${st.horizonDeclared ? ` (${st.horizonDeclared}-term)` : ''}` : 'nothing declared'}`);
    l.push(`  ${st.story}`);
    if (st.shared.length) l.push(`  shared vocabulary (why it is adjacent rather than alien): ${st.shared.join(', ')}`);
    l.push(`  commits: ${(st.shas || []).join(' ')}`);
  }
  l.push('');
  l.push('Two moves, and the instrument does not choose between them: aim the next commit at the declared coordinate, or move the declaration to where the work actually is.');
  return l.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--limit');
  console.log(splatterText(splatter({ limit: i >= 0 ? Number(process.argv[i + 1]) || 5 : 5 })));
}
