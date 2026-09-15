// lib/entry-point.mjs — THE ENTRY POINT IS A SEQUENCE, AND IT STARTS AT attest-demo.
//
// WHY THIS EXISTS: a stranger who typed the package's own name — `npx thetacog-mcp` — got a
// silently hung terminal. The bare invocation fell straight through to the MCP stdio server,
// which speaks JSON-RPC to a client and says nothing to a human. Every published surface
// (README, DILIGENCE, the blog) already said "start with attest-demo"; the TOOL ITSELF was the
// one place that did not, so the first thing a cold runner experienced was a hang.
//
// The sequence printed here is the operator's, in order: run the demo, then compute your own
// pixel, then RUN YOUR OWN INDEX over the surfaces in your lane. There is no central registry
// in any of it — the index is yours, over signed events from surfaces you chose to follow.
//
// THE INVARIANT A TIDY-UP MUST NOT BREAK: an MCP client spawns this binary with PIPED stdio and
// no arguments — byte-identical to the human's bare invocation except for the TTY bits. So the
// gate is the TTY bits and nothing else. Print to a human; stay silent and serve to a pipe.
// Guarded by tests/entry-point.test.mjs, which spawns the real server over pipes and asserts
// the banner never appears there.

/**
 * Decide whether the bare invocation belongs to a human (print the sequence) or to an MCP
 * client (start the stdio server). Takes the stream/env facts explicitly so the DECISION is
 * testable directly, rather than through a proxy for it.
 */
export function shouldPrintEntry({ argv = [], stdoutIsTTY = false, stdinIsTTY = false, env = {} } = {}) {
  const sub = argv[2];
  // An explicit ask for help is a human asking, pipe or not.
  if (sub === '--help' || sub === '-h' || sub === 'help') return true;
  // Any subcommand owns its own output — never speak over it.
  if (sub !== undefined) return false;
  // The escape hatch: force the stdio server even at a terminal.
  if (env.THETACOG_STDIO === '1') return false;
  // Both ends TTY = a person typed this. A client's pipes are never TTYs.
  return Boolean(stdoutIsTTY && stdinIsTTY);
}

const B = (s) => `[1m${s}[0m`;
const D = (s) => `[2m${s}[0m`;

/** The sequence, in the order it has to be run. Plain text; colour is decoration only. */
export function renderEntry({ colour = true } = {}) {
  const b = colour ? B : (s) => s;
  const d = colour ? D : (s) => s;
  return [
    '',
    b('◎ thetacog-mcp — a signed, recomputable record of WHERE work landed.'),
    d('  Four commands, in order. The first one is the whole argument.'),
    '',
    b('  1  npx thetacog-mcp attest-demo'),
    '     THE ENTRY POINT. Runs the chain on this machine — five panels, three keys, one',
    '     signed receipt — so your AI gets something it can RECOMPUTE instead of something',
    '     it has to believe. Nothing below means anything until you have watched this run.',
    d('     Add --open for the rendered report, --report for the HTML on stdout.'),
    '',
    b('  2  npx thetacog-mcp my-pixel'),
    '     Your coordinate, computed from your own public text on the same 144×144 lattice.',
    '     Nobody grants it, so nobody can revoke it — they can only recompute it.',
    '',
    b('  3  npx thetacog-mcp index'),
    '     YOUR index. No central registry, no permission, no account: it ranks the surfaces',
    '     YOU follow by lane proximity to YOUR pixel, and names the adjacent coordinate that',
    '     nobody you index has taken yet — the corner you can grow into.',
    d('     Feed it first: npx thetacog-mcp map-crawl  [network]'),
    '',
    b('  4  npx thetacog-mcp register-surface --url https://github.com/you/your-fork'),
    '     Publish yours, so the people already in your lane can index you back.',
    '',
    d('  MCP mode is unchanged: a client that spawns this over a pipe gets the stdio server.'),
    d('  Force it at a terminal with `npx thetacog-mcp serve` (or THETACOG_STDIO=1).'),
    d('  The diligence prompts live in the README, not in this output — evidence must not'),
    d('  instruct its auditor. github.com/wiber/thetacog-mcp'),
    '',
  ].join('\n');
}
