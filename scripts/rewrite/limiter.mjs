// scripts/rewrite/limiter.mjs
// ════════════════════════════════════════════════════════════════════════════
// PER-ENGINE CONCURRENCY LIMITS — why the console felt "stuck".
//
// THE MEASUREMENT that produced this file:
//   network round-trip to Anthropic ....... 0.25s
//   one `claude -p` call, trivial prompt .. 7.8s   (CLI startup, not network)
//   one `claude -p` call, real prompt ..... 17.4s  (inference)
//   the same call, as observed in the run . 112s   ← six times slower
//
// Nothing about the link is slow. The engine was queueing behind ITSELF: a 4-way
// parallel scanner plus four independent producers meant up to eight concurrent
// calls to the same two backends, and both of them serialise internally. Every
// request then waited behind every other request, so each individual call
// inflated from 17s to 112s and the writer watched an empty stack.
//
// Throughput arithmetic, which is the part that matters:
//   8 in flight at 112s each  → 0.071 completions/sec
//   2 in flight at  20s each  → 0.100 completions/sec   ← faster AND responsive
//
// Running fewer at once finishes more work. It also makes latency legible: a
// per-track number only means something when the track was not fighting three
// others for the same GPU or the same CLI.
// ════════════════════════════════════════════════════════════════════════════

/** A minimal FIFO semaphore. No deps, no timers, no cleverness. */
function createLimiter(name, max) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => { active--; next(); });
  };

  return {
    name,
    get max() { return max; },
    setMax(n) { max = Math.max(1, n | 0); next(); },
    get active() { return active; },
    get waiting() { return queue.length; },
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    },
  };
}

// ── THE TWO BACKENDS SCALE DIFFERENTLY, AND THE DIFFERENCE IS MEASURED ──
//
// Cloud parallelism sweep, identical prompt, `claude -p`:
//
//   N   wall    avg call   throughput
//   1   52.0s   52.0s      0.019 calls/s
//   2   65.1s   46.9s      0.031
//   4   87.4s   61.7s      0.046
//   6   95.4s   50.5s      0.063   ← still climbing, per-call latency FLAT
//
// BUT that sweep used a SHORT prompt, and it over-predicted. Re-run end to end with
// REAL generation prompts (passage + fence, ~600-2000 tokens in, ~1800 out) the
// picture inverts: at 6-wide the cloud tracks went 0-for-6, every call exceeding its
// 180s budget, and the stack fell from 7 cards to 2. Long prompts are much heavier
// than the probe implied, and the scanner competes for the same slots.
//
// Measured end-to-end, same 215s window, same document:
//   cloud 2 wide, 1 per track  → 7 cards, all four tracks producing   ← best
//   cloud 6 wide, 3 per track  → 2 cards, cloud 0/6, C avg 187s
//
// So: benchmark the real workload, not a probe. The probe said "go wider"; the
// product said otherwise, and the product is what ships.
//
// Local is the opposite. Ollama serialises on one GPU, so concurrent callers just
// queue behind each other while each one's clock runs. Throttling local (and only
// local) is what took the stack from 3 cards to 7 in the same window.
//
// Getting this backwards in either direction costs real throughput, which is why
// both numbers are here with the measurement that produced them.
export const localLimit = createLimiter('local', Number(process.env.REWRITE_LOCAL_CONCURRENCY || 2));
export const cloudLimit = createLimiter('cloud', Number(process.env.REWRITE_CLOUD_CONCURRENCY || 3));

// THE INTERACTIVE LANE (2026-08-12, operator: "⚠ timeout after 180000ms … clearly something is broken").
// A model-bar press was queueing behind the background track generation and then running while three
// other headless models had the machine. Measured: the same Opus prompt returns in 32s standalone and
// blew past a 180s ceiling through the server while the stack was filling.
//
// A human waiting on a button is not the same workload as a queue filling a buffer ten cards ahead, and
// sharing one lane makes the interactive path as slow as the batch path by construction. This lane is
// separate and small: presses never wait on the buffer, and two presses cannot gang up on the machine.
export const uiLimit = createLimiter('ui', Number(process.env.REWRITE_UI_CONCURRENCY || 2));

export function limiterStats() {
  return {
    local: { max: localLimit.max, active: localLimit.active, waiting: localLimit.waiting },
    cloud: { max: cloudLimit.max, active: cloudLimit.active, waiting: cloudLimit.waiting },
    ui: { max: uiLimit.max, active: uiLimit.active, waiting: uiLimit.waiting },
  };
}
