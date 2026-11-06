// src/lib/marketplace.mjs — the VS Code Marketplace listing, spelled once, in a module with no node: imports so a CLIENT
// page (iamfim-landing) can import it as well as the root-layout server component (LedgerDoor, via notary-seat-checkout)
// and the extension side (scripts/vna/public-surface-register.mjs re-exports it). publisher.name from
// packages/thetacog-mcp-vscode/package.json.
export const MARKETPLACE_ID = 'thetadriven.thetacog-mcp';
export const MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${MARKETPLACE_ID}`;

// C635f — the listing tagged with the placement that sent the reader, so an arrival is countable per door (ref=iamfim-left,
// ref=fwd …). The untagged MARKETPLACE_URL stays the identity every guard resolves a tagged link back to.
export function marketplaceUrl(ref) {
  return ref ? `${MARKETPLACE_URL}&ref=${encodeURIComponent(ref)}` : MARKETPLACE_URL;
}

// C685 — the other two install doors, spelled once beside the listing: Cursor/Windsurf (no Open VSX listing yet; the .vsix is
// served from /vsx) and the one-command check that needs no editor at all. Previously hand-typed in claim-onboarding.mjs,
// the claim page and the nominate invite; new code imports these.
export const VSX_URL = 'https://thetadriven.com/vsx';
export const ATTEST_CMD = 'npx -y thetacog-mcp@latest attest-demo';
