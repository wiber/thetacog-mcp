// C348 — the attest-demo status item's words, kept pure (no vscode import) so the guard can call them.
// One command id, one terminal line: the same no-install command the OSS README points strangers at
// (packages/thetacog-mcp/server.js routes `attest-demo` to scripts/pmu/attest-demo.mjs).
export const ATTEST_DEMO_COMMAND_ID = 'vna.attestDemo';
export const ATTEST_DEMO_TERMINAL_NAME = 'ThetaCog: attest-demo';
export const ATTEST_DEMO_TEXT = '$(shield) attest-demo';
export const ATTEST_DEMO_TOOLTIP = 'Runs `npx thetacog-mcp attest-demo` in a terminal: the demo receipt, computed locally, checkable twice (same bytes, same hash).';
export function attestDemoTerminalLine(): string { return 'npx thetacog-mcp attest-demo'; }
