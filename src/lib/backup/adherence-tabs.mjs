// src/lib/backup/adherence-tabs.mjs — C508 THE TWO TABS (operator 2026-10-01, verbatim: "I guess we need a tab for either and
// then fill in the blanks of what we have"). /backup/adherence's CODING tab (the development process: the flight tape) and
// DEPLOYED tab (the LLM-wrapper and robot tapes), each a fixed list of fields read off twoTapes()'s points — the same one
// untar the slider draws. A field the backup holds is filled; a field it does not hold reads UNMEASURED with its reason,
// never 0 and never $0 (AXIOM 1). The field LIST is fixed per tab, so an absence is visible as a named blank.
//
// SUFFICIENT FOR: what this backup holds per workload — counts, lane words, spend where priced, last seen.
// NOT SUFFICIENT FOR: whether the work was good (Rice), or anything the tape did not record. Port row: none — a fold.
// @guard tests/site/c508-deployer-picks-who-to-ask.test.mjs

const ok = (key, label, value) => ({ key, label, status: 'MEASURED', value, why: null });
const un = (key, label, why) => ({ key, label, status: 'UNMEASURED', value: null, why });

function lanes(pts, key) {
  const inN = pts.filter((p) => p.word === 'in lane').length, offN = pts.filter((p) => p.word === 'off lane').length;
  const placed = inN + offN;
  const none = 'no row on this tape landed a lane reading';
  return [
    placed ? ok('in_lane', 'in lane', inN) : un('in_lane', 'in lane', none),
    placed ? ok('off_lane', 'off lane', offN) : un('off_lane', 'off lane', none),
    placed ? ok('off_lane_share', 'off-lane share of placed rows', `${Math.round((100 * offN) / placed)}%`) : un('off_lane_share', 'off-lane share of placed rows', none),
    ...(key === 'deployed' ? [pts.length ? ok('unplaced', 'not placed (no admissible card)', pts.length - placed) : un('unplaced', 'not placed (no admissible card)', 'no deployed row in this backup')] : []),
  ];
}
function lastSeen(pts) {
  let last = null; for (const p of pts) if (p.ts && (last === null || p.ts > last)) last = p.ts;
  return last ? ok('last_seen', 'last seen', last) : un('last_seen', 'last seen', 'no row carries a timestamp');
}

/** @param {{ points: any[] } | null | undefined} tapes @param {'coding'|'deployed'} tab → the tab's fixed field list */
export function tabFields(tapes, tab) {
  const all = tapes && Array.isArray(tapes.points) ? tapes.points : [];
  if (tab === 'deployed') {
    const pts = all.filter((p) => p.domain === 'DEPLOYED');
    if (!pts.length) {
      const why = 'no deployed row in this backup — the archive carries no .thetacog/fleet-tape/*.ndjson';
      return ['rows', 'jobs', 'in_lane', 'off_lane', 'unplaced', 'off_lane_share', 'models', 'spend', 'witnessed', 'last_seen']
        .map((k) => un(k, LABELS[k], why));
    }
    const jobs = [...new Set(pts.map((p) => p.lane))].sort();
    const models = [...new Set(pts.map((p) => p.model).filter(Boolean))].sort();
    const priced = pts.filter((p) => p.cost !== null);
    const usd = priced.reduce((s, p) => s + p.cost, 0);
    return [
      ok('rows', LABELS.rows, pts.length),
      ok('jobs', LABELS.jobs, `${jobs.length} (${jobs.join(', ')})`),
      ...lanes(pts, 'deployed'),
      models.length ? ok('models', LABELS.models, models.join(', ')) : un('models', LABELS.models, 'no deployed row names the model it called'),
      priced.length ? ok('spend', LABELS.spend, `$${usd.toFixed(4)} over ${priced.length} priced row${priced.length === 1 ? '' : 's'}; ${pts.length - priced.length} unpriced`) : un('spend', LABELS.spend, `no deployed row carries cost_usd (${pts.length} unpriced)`),
      un('witnessed', LABELS.witnessed, 'your own tape is not witnessed — witness lag and chain links are read on the notary ledger'),
      lastSeen(pts),
    ];
  }
  const pts = all.filter((p) => p.domain === 'CODING');
  if (!pts.length) {
    const why = 'no flight-tape row in this backup';
    return ['rows', 'commits', 'turns', 'in_lane', 'off_lane', 'off_lane_share', 'panels', 'spend', 'last_seen'].map((k) => un(k, LABELS[k], why));
  }
  const commits = pts.filter((p) => p.kind === 'commit').length;
  const withPanel = pts.filter((p) => p.panel).length;
  const commitWhy = (pts.find((p) => p.kind === 'commit' && !p.panel) || {}).panelWhy;
  return [
    ok('rows', LABELS.rows, pts.length),
    ok('commits', LABELS.commits, commits),
    ok('turns', LABELS.turns, pts.filter((p) => p.kind === 'turn').length),
    ...lanes(pts, 'coding'),
    withPanel ? ok('panels', LABELS.panels, `${withPanel} of ${commits} commits`) : un('panels', LABELS.panels, commits ? String(commitWhy || 'no panel published for any commit').replace(/^UNMEASURED — /, '') : 'no commit row to draw a panel for'),
    un('spend', LABELS.spend, 'the flight tape records no cost per commit or turn — spend is read on the DEPLOYED tab'),
    lastSeen(pts),
  ];
}

const LABELS = { rows: 'rows on the tape', commits: 'commits', turns: 'turns', jobs: 'jobs', in_lane: 'in lane', off_lane: 'off lane',
  unplaced: 'not placed (no admissible card)', off_lane_share: 'off-lane share of placed rows', panels: 'encircled panels published',
  models: 'models called', spend: 'spend', witnessed: 'witnessed', last_seen: 'last seen' };
