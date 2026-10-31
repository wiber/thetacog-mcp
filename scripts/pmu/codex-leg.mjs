// scripts/pmu/codex-leg.mjs — C579 (2026-10-02): the Mizan run (Ubuntu under Proxmox) printed
// Pillar 4's codex judge as "codex (your CLI, same spec 2x): ERR (judge slow/throttled —
// stopping after 1)" and "codex was unreachable (timeout / 429 / no-capacity, 1 call)". C571
// already found that codex, run as the AGENT driving the whole demo, needs
// `--dangerously-bypass-approvals-and-sandbox` or it gives up silently — the same CLI, invoked
// here non-interactively by Pillar 4 AS THE JUDGE (`codex exec <prompt>`), needs the identical
// approval flag or it blocks on an approval prompt that never arrives and the hard timeout (25s,
// attest-demo.mjs) fires, which attest-demo then reported as a bare "judge slow/throttled" with
// no exit code or stderr attached.
//
// Kept in its OWN module (not inlined in attest-demo.mjs) so a guard can import these two pure
// functions directly, without pulling in attest-demo.mjs's module-level `main().catch(...)` —
// importing attest-demo.mjs for any reason runs the whole live demo as a side effect (C570).

// THE EXACT FLAG — matches packages/thetacog-mcp/README.md's per-agent invocation line
// (`codex --dangerously-bypass-approvals-and-sandbox`, C571) and the Mizan run's own finding:
// codex needs this flag to act non-interactively instead of giving up or waiting on an approval
// prompt no one is present to answer. `exec` is codex's own non-interactive one-shot subcommand.
export const CODEX_APPROVAL_FLAG = '--dangerously-bypass-approvals-and-sandbox';

export function codexExecArgs(prompt) {
  return ['exec', CODEX_APPROVAL_FLAG, prompt];
}

// describeJudgeFailure — turns a spawnSync-shaped result ({status, signal, stderr, stdout, error})
// into the EXACT exit/stderr line Pillar 4 prints when a judge CLI fails, so the reader never sees
// a bare "judge slow/throttled" with nothing to act on. Pure: takes the result, returns a string —
// never spawns anything itself, so a guard feeds synthetic exit codes/stderr with no real CLI call.
export function describeJudgeFailure({ name, status = null, signal = null, stderr = '', stdout = '', error = null } = {}) {
  const who = name || 'judge';
  const bits = [];
  if (error && error.code === 'ETIMEDOUT') bits.push('timed out (ETIMEDOUT)');
  else if (status != null) bits.push(`exited ${status}`);
  else if (signal) bits.push(`killed by ${signal}`);
  else if (error && error.code) bits.push(`failed to start (${error.code})`);
  else bits.push('failed');
  if (signal && !(error && error.code === 'ETIMEDOUT')) bits.push(`signal ${signal}`);
  const snippet = String(stderr || '').trim().split('\n').filter(Boolean)[0]
    || String(stdout || '').trim().split('\n').filter(Boolean).slice(-1)[0]
    || (error && error.message)
    || '(no stderr)';
  return `${who} ${bits.join(', ')}: ${snippet.slice(0, 200)}`;
}
