// src/lib/marketplace.mjs — the VS Code Marketplace listing, spelled once, in a module with no node: imports so a CLIENT
// page (iamfim-landing) can import it as well as the root-layout server component (LedgerDoor, via notary-seat-checkout)
// and the extension side (scripts/vna/public-surface-register.mjs re-exports it). publisher.name from
// packages/thetacog-mcp-vscode/package.json.
export const MARKETPLACE_ID = 'thetadriven.thetacog-mcp';
export const MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${MARKETPLACE_ID}`;
