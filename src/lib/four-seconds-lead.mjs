// src/lib/four-seconds-lead.mjs — THE README's first paragraph, the one sentence the homepage leads with (C2229).
// Lives in src/ so the homepage imports a plain string: importing it from scripts/vna/public-surface-register.mjs pulled that
// module's whole tree (244 scripts files .vercelignore strips) into the Next build, and the ship preflight refused origin/main
// (2 Nov 2026). The register re-exports it, so this is the one place the sentence is written.
export const FOUR_SECONDS_LEAD = 'When an AI breaks something, the receipt shows whether the instruction or the work left the lane. Deciding fault was impossible from the AI\'s own account. Now you can.';
