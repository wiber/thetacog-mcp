#!/bin/bash
# smoke-accept.sh — C2233: what counts as attest-demo SPEAKING in the cold-start smoke.
# Until 2026-11-02 the smoke passed on any non-empty output, and a Node stack trace is non-empty:
# 2.58.3 and 2.59.0 shipped with `npx -y thetacog-mcp@latest attest-demo` throwing ENOENT on line 73,
# and the smoke printed green over it. Speaking now means one of the demo's two opening lines is there
# (bare run: "YOUR INPUT, TURNED INTO A SPEC"; --repo run: "YOUR BUILD, CHECKED BY MATH") and no
# uncaught-error frame is.
# Usage: smoke_accept "<captured output>"  → exit 0 accept, exit 1 reject (reason on stdout)
# Guard: tests/vna/c2233-attest-demo-runs-from-the-installed-package.test.mjs
smoke_accept() {
  local out="$1"
  if [ -z "$out" ]; then echo "zero output"; return 1; fi
  if printf '%s\n' "$out" | grep -Eq '^[[:space:]]+at .+\.m?js:[0-9]+|^(Error|TypeError|ReferenceError|SyntaxError)( \[[A-Z_]+\])?: |^node:internal'; then
    echo "uncaught error: $(printf '%s\n' "$out" | grep -Em1 '^[A-Za-z]*Error|code:')"; return 1
  fi
  if ! printf '%s\n' "$out" | grep -Eq 'YOUR INPUT, TURNED INTO A SPEC|YOUR BUILD, CHECKED BY MATH'; then
    echo "the demo's opening line never printed"; return 1
  fi
  return 0
}

# smoke_accept_generic "<captured output>" — C2315: the same acceptance for a door that carries no fixed opening
# line of its own (doctor, auth-flow whoami, …). Nonempty output with no uncaught-error frame is speaking; a door's
# own exit code (doctor FAILs on an unrelated missing MCP config, whoami answers source "none") is its own reading,
# never this function's business. Usage: smoke_accept_generic "<captured output>" → exit 0 accept, exit 1 reject.
smoke_accept_generic() {
  local out="$1"
  if [ -z "$out" ]; then echo "zero output"; return 1; fi
  if printf '%s\n' "$out" | grep -Eq '^[[:space:]]+at .+\.m?js:[0-9]+|^(Error|TypeError|ReferenceError|SyntaxError)( \[[A-Z_]+\])?: |^node:internal'; then
    echo "uncaught error: $(printf '%s\n' "$out" | grep -Em1 '^[A-Za-z]*Error|code:')"; return 1
  fi
  return 0
}
