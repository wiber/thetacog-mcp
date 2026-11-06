// scripts/pmu/setpoint.mjs — C322b: A COMMIT THAT ONLY MOVES THE DECLARATION IS A SETPOINT STEP, NEVER DRIFT.
//
// THE DIAGNOSIS (2026-09-25). Every `spec(vna): … ticked` commit read 52–67 % red whatever the theme. It was not
// ledger churn: those commits touch exactly one file, docs/specs/vna/SPEC-VNA-COCKPIT.md. The triptych put the
// WHOLE touched doc on the intent side (docProse = the 1.17 MB spec, every theme at once, read off the WORKING
// TREE) and the three added row lines on the reality side. Intent was the entire declaration; reality was one
// tick. The mismatch between "everything we ever declared" and "three rows" is roughly constant, which is why
// the band did not move with the theme — a scoring defect, not drift.
//
// THE FIX, IN TWO PARTS:
//   1. commitClass(files) — a pure function of the commit's file list: 'setpoint' when every file is a spec file
//      or a derived ledger and at least one is a spec file; else 'work'. LLM-free, re-runnable from the commit.
//   2. setpointCorpus(diff) — for a setpoint commit, intent = the rows as they stood (the diff's removed lines,
//      plus the message) and reality = the rows as they now stand (the added lines). Never the whole file.
// The receipt carries commitClass; the drift series (percentile(), steer-metrics' driftFloor/lastCommitOf) skips
// setpoint rows. The PANEL is still rendered and published — excluding a row from a floor is not deleting it.
//
// NOT sufficient for: whether the declaration moved in the right direction (Rice). It says only that this commit
// moved the setpoint and did no work to be scored against it.

// Spec files: the cockpit spec and its siblings, the goals, the amendments ledger, a specs/<id>/spec.md.
export const SPEC_PATH = /^(docs\/specs\/|specs\/[^/]+\/spec\.md$)/;
// Derived ledgers and published panels ride along on a tick commit; they are not work either.
export const DERIVED_PATH = /^(\.thetacog\/|docs\/pmu\/commit-panels\/|public\/commit\/|data\/pmu\/measure-history\.ndjson$)/;

export function commitClass(files) {
  const fs = (Array.isArray(files) ? files : String(files || '').split('\n')).map((f) => String(f).trim()).filter(Boolean);
  if (!fs.length) return 'work';
  const spec = fs.filter((f) => SPEC_PATH.test(f));
  if (!spec.length) return 'work';
  return fs.every((f) => SPEC_PATH.test(f) || DERIVED_PATH.test(f)) ? 'setpoint' : 'work';
}

// diff = the raw `git show --format= --unified=0 <sha>` text. Only spec-file hunks count.
export function setpointCorpus(diff, msg = '') {
  const removed = [], added = [];
  let cur = '';
  for (const l of String(diff || '').split('\n')) {
    if (l.startsWith('diff --git')) { const m = l.match(/ b\/(\S+)/); cur = m ? m[1] : ''; continue; }
    if (!SPEC_PATH.test(cur)) continue;
    if (/^-[^-]/.test(l)) removed.push(l.slice(1).trim());
    else if (/^\+[^+]/.test(l)) added.push(l.slice(1).trim());
  }
  return {
    intent: [String(msg || '').trim(), ...removed].filter(Boolean).join('\n\n'),
    reality: added.filter(Boolean).join('\n\n'),
    removed: removed.length, added: added.length,
  };
}

// A measure-history row is out of the drift series when it names itself setpoint. Rows written before C322b carry
// no class and stay in the series as they were measured — the history is not rewritten.
export const isSetpointRow = (r) => !!r && r.commitClass === 'setpoint';
export const workRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => !isSetpointRow(r));
