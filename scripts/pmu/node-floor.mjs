// scripts/pmu/node-floor.mjs — C570 (2026-10-02): `npx thetacog-mcp attest-demo` under node
// v18.19.1 printed npm's own EBADENGINE for @hono/node-server@2.1.3 (needs node>=20) — a warning
// that scrolls off before the operator ever sees attest-demo's own output, with none of ITS
// context attached. Name the floor ourselves, in one line, at the very start of every run.
//
// Kept in its OWN module (not inlined in attest-demo.mjs) so a guard can import this one pure
// function directly, without pulling in attest-demo.mjs's module-level `main().catch(...)` —
// importing attest-demo.mjs for any reason runs the whole ~2-minute demo as a side effect.
export const NODE_FLOOR_MAJOR = 20;

export function nodeFloorLine(nodeVersion = process.versions.node) {
  const major = Number(String(nodeVersion).split('.')[0]);
  if (!Number.isFinite(major) || major >= NODE_FLOOR_MAJOR) return null;
  return `⚠ node ${nodeVersion} is below the floor (node>=${NODE_FLOOR_MAJOR}) — @hono/node-server@2.1.3 needs node>=${NODE_FLOOR_MAJOR} and npm prints EBADENGINE on install; attest-demo is unsupported below node ${NODE_FLOOR_MAJOR}.`;
}
