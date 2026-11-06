#!/usr/bin/env node
// scripts/pmu/attest-state-wrapper.mjs — C1503 T4: AN EXAMPLE OF THE DEPLOYER'S OWN WRAPPER (2026-10-30).
//
// This file is the deployer's, shown as an example. It is not part of the instrument. The instrument places the change and signs the
// verdict; what a verdict stops is the deployer's choice, wired here (business plan Q-14 and Q-90: "we never sell the halt"). Copy it,
// change it, and run your commit step only on the exit code you chose.
//
//   npx thetacog-mcp attest-state --run tomorrow --json | npx thetacog-mcp attest-state-wrapper
//
// Exit codes this example chooses: 0 GREEN (commit), 0 AMBER (commit and notify), 3 RED (do not commit), 4 the receipt did not verify.
// Guard: tests/vna/c1503-t3-t4-attest-state.test.mjs.
import { verifyReceipt } from './attest-state.mjs';

export function decide(receipt) {
  if (!verifyReceipt(receipt)) return { code: 4, line: 'WRAPPER: the receipt did not verify; nothing commits.' };
  if (receipt.verdict === 'RED') return { code: 3, line: `WRAPPER: RED (${receipt.class}) on ${receipt.snapshot}; this deploy does not commit. Your rule, in this file.` };
  if (receipt.verdict === 'AMBER') return { code: 0, line: `WRAPPER: AMBER (${receipt.class}) on ${receipt.snapshot}; commit, and notify the owner.` };
  return { code: 0, line: `WRAPPER: GREEN on ${receipt.snapshot}; commit.` };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let receipt;
  try { receipt = JSON.parse(raw); } catch { console.error('WRAPPER: stdin is not a receipt (expected the JSON of attest-state --run <name> --json).'); process.exit(4); }
  if (Array.isArray(receipt)) { console.error('WRAPPER: one receipt at a time: pass --run <name> to attest-state.'); process.exit(4); }
  const d = decide(receipt);
  console.log(d.line);
  process.exit(d.code);
}

if (process.argv[1]?.endsWith('attest-state-wrapper.mjs')) main();
