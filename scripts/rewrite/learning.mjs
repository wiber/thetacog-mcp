// scripts/rewrite/learning.mjs — THE STACK SORTS ITSELF FROM WHAT YOU ACTUALLY DID.
//
// WHY (operator, 2026-08-12): "stack needs to be self sorting based on prior fixes — avoid same
// mistakes / misplaced actions / picks."
//
// The ranking was static: dip × 2 + (100 − score) / 2 + a fixed defect weight. It encodes what the
// READER thinks is hard, and never what the WRITER turned out to care about. The ledger already knows
// the difference and nothing was reading it:
//
//   · 5 of 5 recent decisions committed as MANUAL — every machine option was rejected. A card class
//     that reliably produces MANUAL is not a card class where generation is helping.
//   · a card that gets SKIPPED is the reader saying "this is broken" and the writer saying "no it
//     isn't". Serving its twin ten cards later is the "same mistake" being asked twice.
//   · a card that gets ORIGINAL kept is the same verdict, more politely.
//
// So this module computes, from the ledger only, a bias per finding — and the bias is DEMOTION-ONLY
// by default. Promoting on thin evidence is how a ranker starts hallucinating a preference; demoting
// what you have visibly declined is just listening.
//
// IT MUST STAY EXPLAINABLE. Every bias carries `why`, and the card can show it. A stack that reorders
// itself for reasons the writer cannot see is a stack the writer stops trusting — and this whole
// codebase is one long argument that an instrument must be able to say why it says what it says.

const BAND = (score) => (score >= 85 ? 'high' : score >= 70 ? 'mid' : 'low');
const KEY = (defect, score) => `${defect || 'none'}·${BAND(score ?? 0)}`;

// word-level Jaccard — cheap, no model, good enough to catch "you already declined this sentence".
function similarity(a, b) {
  const wa = new Set(String(a || '').toLowerCase().match(/[a-z0-9']+/g) || []);
  const wb = new Set(String(b || '').toLowerCase().match(/[a-z0-9']+/g) || []);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

const MIN_CLASS_N = 3;      // below this a class rate is noise; no bias at all
const DECLINE_FLOOR = 0.6;  // decline this often and the class gets demoted
const NEAR_DUP = 0.62;      // Jaccard above this counts as "the same sentence again"

/**
 * Build the learner from ledger rows. Pure; call it per scan, not per card.
 * @param {Array} rows store.readLedger()
 */
export function buildLearner(rows = []) {
  const accepts = rows.filter((r) => r.kind === 'accept');
  const skips = rows.filter((r) => r.kind === 'skip');

  // ── per class: how often did the writer decline what the machine offered? ──
  const cls = new Map();
  const bump = (k, field) => {
    if (!cls.has(k)) cls.set(k, { n: 0, declined: 0, tookMachine: 0 });
    cls.get(k).n++; cls.get(k)[field]++;
  };
  for (const r of accepts) {
    const k = KEY(r.defect, r.score);
    // MANUAL and ORIGINAL both mean: the generated options did not earn the edit.
    if (r.winner === 'MANUAL' || r.winner === 'ORIGINAL') bump(k, 'declined');
    else bump(k, 'tookMachine');
  }
  for (const r of skips) {
    const k = KEY(r.defect, r.score);
    if (!cls.has(k)) cls.set(k, { n: 0, declined: 0, tookMachine: 0 });
    cls.get(k).n++; cls.get(k).declined++;
  }

  // ── the sentences you already declined, to catch near-duplicates ──
  const declinedTexts = [
    ...skips.map((r) => r.text || r.original).filter(Boolean),
    ...accepts.filter((r) => r.winner === 'ORIGINAL').map((r) => r.original).filter(Boolean),
  ].slice(-200);

  // ── which re-scans actually improved, per class: the only positive signal worth using ──
  const rescan = new Map();
  for (const r of rows.filter((x) => x.kind === 'rescan' && typeof x.delta === 'number')) {
    const k = KEY(r.defect, r.before ?? r.score);
    if (!rescan.has(k)) rescan.set(k, { n: 0, gained: 0 });
    rescan.get(k).n++; if (r.delta > 0) rescan.get(k).gained++;
  }

  /**
   * @returns {{mult:number, why:string|null}} multiplier applied to a finding's rank
   */
  function bias(finding) {
    const k = KEY(finding.defect, finding.score);
    const c = cls.get(k);
    const notes = [];
    let mult = 1;

    // 1 ── you keep declining this class of flag.
    if (c && c.n >= MIN_CLASS_N) {
      const rate = c.declined / c.n;
      if (rate >= DECLINE_FLOOR) {
        mult *= 1 - Math.min(0.45, (rate - DECLINE_FLOOR) + 0.15);
        notes.push(`you declined ${Math.round(rate * 100)}% of ${k} cards (n=${c.n})`);
      }
    }

    // 2 ── this exact sentence, or its twin, has already been declined.
    let worst = 0, worstText = null;
    for (const t of declinedTexts) {
      const s = similarity(finding.text, t);
      if (s > worst) { worst = s; worstText = t; }
    }
    if (worst >= NEAR_DUP) {
      mult *= 0.35;
      notes.push(`near-duplicate of a sentence you already passed on (${Math.round(worst * 100)}% overlap)`);
    }

    // 3 ── the one promotion, and it is earned: this class, when edited, measurably read better.
    const rs = rescan.get(k);
    if (rs && rs.n >= MIN_CLASS_N && rs.gained / rs.n >= 0.7) {
      mult *= 1.2;
      notes.push(`edits to ${k} raised the re-scan ${Math.round((rs.gained / rs.n) * 100)}% of the time (n=${rs.n})`);
    }

    return { mult: +mult.toFixed(3), why: notes.length ? notes.join(' · ') : null };
  }

  return {
    bias,
    stats: {
      classes: [...cls.entries()].map(([k, v]) => ({ k, ...v, declineRate: v.n ? +(v.declined / v.n).toFixed(2) : null })).sort((a, b) => b.n - a.n),
      declinedTexts: declinedTexts.length,
      decisions: accepts.length,
      skips: skips.length,
    },
  };
}
