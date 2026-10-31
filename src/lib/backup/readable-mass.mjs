// src/lib/backup/readable-mass.mjs — C925 READABLE MASS: the floor a room's tape must carry before its shape is read.
// One source for the number the map of maps already used (scripts/vna/alignment-map.mjs MIN_COMMITS): below the floor
// "a shape from this is noise wearing a number". The founder's free hours on a deployment are earned at this floor
// (operator 2026-10-17: "I can do the free consulting on your depployment if you set up the tape and break through to the
// tape semantic mass properly - then duplicate my process with the map of maps later"). An offer, never a gate: the
// install and the measurement stay free whatever the count.
// @guard tests/site/c925-consulting-earned-by-readable-mass.test.mjs

export const READABLE_JOBS = 8;

/** readableMass — per room, how many placed jobs it carries and how many are left to the floor. Never a score. */
export function readableMass(rooms = [], floor = READABLE_JOBS) {
  const rows = (Array.isArray(rooms) ? rooms : []).map((r) => {
    const n = Number(r && r.n) || 0;
    return { key: String((r && (r.key || r.terminal)) || 'room'), n, readable: n >= floor, left: Math.max(0, floor - n) };
  });
  const readable = rows.filter((r) => r.readable).length;
  return { floor, rooms: rows, readable, total: rows.length, earned: readable > 0 };
}

export const CONSULTING_OFFER = Object.freeze({
  head: 'Free consulting on your deployment, once your tape can be read',
  line: `Install the free measurement and let your agents work. When one of your rooms carries ${READABLE_JOBS} placed jobs, its shape can be read, and the founder reads it with you, free: where the work landed against what you declared, and which arm to take. After that, the map of maps runs on your rooms the way it runs on ours.`,
  floorLine: `A room reads at ${READABLE_JOBS} placed jobs. Below that, a shape is noise wearing a number, so the page says how many jobs are left and draws nothing.`,
  never: 'An offer, never a gate: the install and the measurement are free and open source (MIT) at any count.',
});
