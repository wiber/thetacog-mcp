#!/usr/bin/env bash
# scripts/pmu/drift-watch.sh — POST-COMMIT DRIFT WATCH.
# =============================================================================
# Every commit, grade the work against the ROOM'S DELEGATED SPEC (the intent), via the real
# on-chip Rust ballistic walk. Fast + LLM-OFF-the-critical-path (CLAUDE.md): the walk is ~tens
# of ms; commit-drift composes a DRAFT + posts the receipt to the mesh ledger. It NEVER sends an
# email (the ≥95 gated send stays a deliberate arm). Observable: logs to .thetacog/cache/, never
# /dev/null. No delegated spec for the room → clean no-op (exit 0).
#
# Intent resolution (the room's delegation spec, when available):
#   1. an explicit --spec / $DRIFT_SPEC
#   2. docs/specs/approved/  with `to_room: <room>`   (armed delegations win)
#   3. docs/specs/drafts/    with `to_room: <room>`
# Room resolution: --room / $THETACOG_ROOM > the commit's Originating-Terminal trailer > builder.
#
#   bash scripts/pmu/drift-watch.sh [--room <key>] [--spec <path>] [--sha <sha>]
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 0

ROOM=""; SPEC=""; SHA=""; PRINT_SPEC=""
while [ $# -gt 0 ]; do case "$1" in
  --room) ROOM="$2"; shift 2;; --spec) SPEC="$2"; shift 2;; --sha) SHA="$2"; shift 2;; --print-spec) PRINT_SPEC=1; shift;; *) shift;; esac; done
[ -z "$ROOM" ] && ROOM="${THETACOG_ROOM:-}"
[ -z "$SPEC" ] && SPEC="${DRIFT_SPEC:-}"
[ -z "$SHA" ] && SHA="$(git rev-parse --short HEAD 2>/dev/null || echo HEAD)"

# room from the commit trailer if not given (Originating-Terminal: <emoji> <Room>)
if [ -z "$ROOM" ]; then
  label="$(git log -1 --format=%B 2>/dev/null | grep -oiE 'Originating-Terminal:.*' | head -1)"
  case "$label" in
    *[Bb]uilder*) ROOM=builder;; *[Aa]rchitect*) ROOM=architect;; *[Vv]ault*) ROOM=vault;;
    *[Ll]aborator*) ROOM=laboratory;; *[Oo]perator*) ROOM=operator;; *[Vv]oice*) ROOM=voice;;
    *[Nn]avigator*) ROOM=navigator;; *[Nn]etwork*) ROOM=network;; *[Pp]erformer*) ROOM=performer;;
  esac
fi
[ -z "$ROOM" ] && ROOM="builder"

mkdir -p .thetacog/cache
LOG=".thetacog/cache/drift-watch-${SHA}.log"

# resolve the room's delegated spec = the intent. PRIORITY: the ACTUAL delegation record
# (the most-recent bifurcation to this room whose link is a docs/specs file) — NOT a blind
# first-grep, which could grade against the wrong spec. The forward trigger writes that
# bifurcation, so this ties the verdict to the spec that was really delegated here.
if [ -z "$SPEC" ] && [ -f data/room-bifurcations.json ]; then
  SPEC="$(node -e '
    try { const d=require("./data/room-bifurcations.json");
      const all=[...(d.bifurcations||[]),...(d.picked_up||[])].filter(b=>b.to_room===process.argv[1]);
      all.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
      for (const b of all){ const link=(b.links||[]).find(l=>/docs\/specs\/.*\.md$/.test(l)); if(link){console.log(link);break;} }
    } catch(e){}' "$ROOM" 2>/dev/null)"
  # the spec may have advanced approved/ → done/ since delegation; follow it
  [ -n "$SPEC" ] && [ ! -f "$SPEC" ] && SPEC="docs/specs/done/$(basename "$SPEC")"
  [ -n "$SPEC" ] && [ ! -f "$SPEC" ] && SPEC=""
fi
# fallback: a spec addressed to this room (approved/ beats drafts/)
if [ -z "$SPEC" ]; then
  SPEC="$(grep -rl "to_room: *${ROOM}\b" docs/specs/approved/ 2>/dev/null | head -1)"
  [ -z "$SPEC" ] && SPEC="$(grep -rl "to_room: *${ROOM}\b" docs/specs/done/ 2>/dev/null | head -1)"
  [ -z "$SPEC" ] && SPEC="$(grep -rl "to_room: *${ROOM}\b" docs/specs/drafts/ 2>/dev/null | head -1)"
fi

# --print-spec: resolution-only mode (post-commit uses this to drive commit-triptych --spec so the
# RICH signed email becomes the delegation receipt). Print the resolved delegated spec (if any) + exit
# before the walk; nothing else on stdout.
if [ -n "${PRINT_SPEC:-}" ]; then
  # GUARD (operator 2026-06-26): only attest THIS commit against the room's delegation if the
  # commit actually touches the delegation's DOMAIN. The room is detected from the terminal, so
  # a builder/README commit made FROM the voice terminal would otherwise be graded against voice's
  # delegation it never delivered → coverage 0 → "no work to attest" → empty panel. When the commit
  # is unrelated, print NO spec: commit-triptych then self-grades the commit's OWN backstage work
  # (message → changed files), so the attestation always reflects the real work and is never empty.
  if [ -n "$SPEC" ] && [ -f "$SPEC" ] && [ -n "$SHA" ]; then
    MATCH="$(node -e '
      const fs=require("fs"), cp=require("child_process");
      try {
        const spec=fs.readFileSync(process.argv[1],"utf8");
        const paths=[...spec.matchAll(/[`\s(]([a-zA-Z0-9_./-]+\.(?:mjs|js|sh|md|ts|tsx|json|mdx))/g)].map(m=>m[1]);
        const full=new Set(paths);                              // exact full-path refs
        const base=new Set(paths.map(p=>p.split("/").pop()));   // basename refs (spec often cites bare names)
        const dirs=new Set(paths.filter(p=>p.includes("/")).map(p=>p.split("/").slice(0,2).join("/")));
        const changed=cp.execSync("git diff-tree --no-commit-id --name-only -r "+process.argv[2],{encoding:"utf8"}).split("\n").filter(Boolean);
        const hit=changed.some(c=>full.has(c)||base.has(c.split("/").pop())||dirs.has(c.split("/").slice(0,2).join("/")));
        process.stdout.write(hit?"1":"0");
      } catch(e){ process.stdout.write("1"); }   // fail-safe: keep prior behavior on any error
    ' "$SPEC" "$SHA" 2>/dev/null)"
    [ "$MATCH" = "1" ] && printf '%s\n' "$SPEC"
  fi
  exit 0
fi

if [ -z "$SPEC" ] || [ ! -f "$SPEC" ]; then
  echo "drift-watch: no delegated spec for room '${ROOM}' — no-op @ ${SHA}" | tee -a "$LOG"
  exit 0
fi

echo "drift-watch: ${ROOM} × ${SPEC} @ ${SHA} (real walk · mesh-post · draft, no send)" | tee -a "$LOG"
# commit-drift = load job reef → real pmu-onchip --ballistic walk → cost → mesh-post → draft
if node scripts/pmu/commit-drift.mjs --spec "$SPEC" --room "$ROOM" --commit "$SHA" >>"$LOG" 2>&1; then
  # LOUD RECEIPT (spec mesh-verdict-loud-receipt, R1+R3): one honest line from the SIGNED ledger
  # event commit-drift just posted, with a pointer to recompute it. Best-effort, never fails.
  RECEIPT="$(node scripts/pmu/mesh-receipt-line.mjs --spec "$SPEC" 2>/dev/null)"
  [ -n "$RECEIPT" ] && echo "$RECEIPT" | tee -a "$LOG" >&2
else
  echo "mesh: drift-watch errored — see $LOG" | tee -a "$LOG" >&2
fi
echo "drift-watch: done → $LOG"
