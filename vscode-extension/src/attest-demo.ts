// C348 — the attest-demo status item's words, kept pure (no vscode import) so the guard can call them.
// One command id, one terminal line.
//
// C1180 — THE BUTTON OPENS THE PITCH, NEVER THE WALKTHROUGH. The line used to run the bare fixed
// scenario (the 325-line mechanism demo, STEP 1..6 and all six pillars) — exactly what the deck's
// own close (PeterDeckClient.tsx, "run one command on your laptop … watch it become a spec") does
// NOT promise. `--input` is the laptop test (C1178); run with no `--walkthrough`, it defaults to
// the short pitch view (C1180): the spec it built, green/flagged/breach, the digest — never the
// preamble. The sample text below is a placeholder to edit in the terminal before pressing enter.
export const ATTEST_DEMO_COMMAND_ID = 'vna.attestDemo';
export const ATTEST_DEMO_TERMINAL_NAME = 'ThetaCog: attest-demo';
export const ATTEST_DEMO_TEXT = '$(shield) attest-demo';
export const ATTEST_DEMO_TOOLTIP = 'Runs `npx thetacog-mcp attest-demo --input "..."` in a terminal: the pitch view — your own text placed, green/flagged/breach, the same digest twice.';
export function attestDemoTerminalLine(): string { return 'npx thetacog-mcp attest-demo --input "Build a login form with email and password fields, validate on submit."'; }
