// C1441 — a spawnSync result killed on its time bound is a TIME-bound stop, never a reading of the bundle (C1403).
// Node marks it with error.code ETIMEDOUT and/or a kill signal and a null status; a bundle defect exits with a status.
export function smokeTimedOut(r) {
  if (!r) return false;
  if (r.error && r.error.code === 'ETIMEDOUT') return true;
  return r.status === null && !!r.signal;
}
