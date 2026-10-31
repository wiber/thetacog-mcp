// ONE TYPED READER FOR THE TAPE. A refusal must never be readable as a measurement.
//
// THE DEFECT, twice in one session. `readTapeReceipt` already refuses loudly and correctly —
// it returns {status:'REJECTED', instruction:'Missing required field reality_text.'}. The
// instrument was never the problem; the CONSUMERS were. A probe wrote
//
//     const m = r.metrics || {};  console.log(m.offPct)     → printed `undefined` four times
//
// over four rejections, and a rejection printed as `undefined` reads exactly like a physics
// engine that returned nothing. The same collapse is in shipped code:
// tape-blend-sweep.mjs:77 wrote `verdict: r.verdict || r.status`, which promotes the string
// 'REJECTED' into the verdict column, and `rec.metrics?.dI`, which yields undefined for a row
// that was never accepted. A sweep over rejected rows would have plotted a flat curve and
// looked like a finding.
//
// This is class 2 (SILENT SUCCESS: fast, empty, exit 0) meeting AXIOM 1's W2: `undefined` is
// an emission from inside the boundary that cannot say whether it means "measured nothing" or
// "was never measured". Those are different claims and optional chaining collapses them.
//
// THE FIX IS A TAGGED UNION WHOSE WRONG READ THROWS, not a convention. A convention is what
// failed: every consumer here already "knew" to check, and two did not. So the metric fields
// do not exist on a non-FILLED receipt, and reaching for one raises an error naming the
// refusal verbatim. You cannot get `undefined` out of this reader — you get a number or a
// stack trace with the reason in it.

/** The three states a tape read can be in. There is no fourth. */
export const FILLED = 'FILLED';
export const REJECTED = 'REJECTED';
export const EMPTY = 'EMPTY';

const METRICS = ['verdict', 'dI', 'dN', 'offPct', 'drift'];

/**
 * Wrap a non-FILLED receipt so that touching a metric throws instead of yielding undefined.
 * The trap is on GET rather than on a validator, because the failure is a READ that never
 * asked permission — a validator only helps the caller who remembered to call it, which is
 * precisely the caller who never had the bug.
 */
function fenced(base, why) {
  return new Proxy(base, {
    get(t, prop) {
      if (typeof prop === 'string' && METRICS.includes(prop)) {
        throw new Error(
          `tape receipt is ${t.state}, not FILLED — there is no ${prop} to read. ${why}`);
      }
      // Implicit string coercion is banned for the same reason: `${receipt}` in a log line
      // renders '[object Object]' and buries the refusal in something that looks like output.
      if (prop === Symbol.toPrimitive) {
        return () => { throw new Error(`tape receipt is ${t.state} — coerce .state or .reason, not the receipt. ${why}`); };
      }
      if (prop === 'metrics') {
        throw new Error(`tape receipt is ${t.state} — .metrics does not exist. ${why}`);
      }
      return t[prop];
    },
  });
}

/**
 * Read a tape receipt into exactly one of three shapes.
 *
 * @param {object} written  what writeTapeIntent returned (may carry a refusal)
 * @param {object} receipt  what readTapeReceipt returned (absent if the write was refused)
 * @returns {{state:string}} FILLED{verdict,dI,dN,offPct,drift,cursor_id} |
 *                           REJECTED{reason,cursor_id:null} | EMPTY{reason,cursor_id}
 */
export function typeReceipt(written, receipt) {
  // A write that produced no cursor was REFUSED. There is nothing downstream to read, and the
  // reason is the whole content of the result — carried verbatim, never summarised, because
  // "Missing required field reality_text" is actionable and "rejected" is not.
  if (!written || !written.cursor_id) {
    const reason = (written && (written.instruction || written.status)) || 'write returned no cursor';
    return fenced({ state: REJECTED, reason, cursor_id: null, filled: false }, reason);
  }
  // A cursor exists but the physics never filled it. Distinct from a refusal: the row IS on
  // the tape and can fill later, so a caller may legitimately retry. Collapsing this into
  // REJECTED would make a slow engine indistinguishable from a malformed submission.
  if (!receipt || receipt.filled !== true) {
    const reason = (receipt && (receipt.instruction || receipt.status)) || 'physics did not fill';
    return fenced({ state: EMPTY, reason, cursor_id: written.cursor_id, filled: false }, reason);
  }
  const m = receipt.metrics || {};
  // A receipt that says filled but carries no verdict is EMPTY, not FILLED. Trusting the flag
  // over the contents is how an empty success gets counted as a measurement.
  if (typeof m.verdict !== 'string') {
    const reason = 'receipt reports filled but carries no verdict';
    return fenced({ state: EMPTY, reason, cursor_id: written.cursor_id, filled: false }, reason);
  }
  return {
    state: FILLED, filled: true, cursor_id: written.cursor_id,
    verdict: m.verdict, dI: m.dI, dN: m.dN, offPct: m.offPct, drift: m.drift,
  };
}

/** One line fit for a log or a receipt row. Safe on every state by construction. */
export function describe(r) {
  if (r.state === FILLED) {
    return `FILLED ${r.verdict} · dI ${r.dI} · offPct ${r.offPct} · drift ${r.drift}`;
  }
  return `${r.state} — ${r.reason}`;
}
