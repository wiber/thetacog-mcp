#!/bin/bash
# Post-commit hook — async LLM voice audit.
#
# Architecture (May 4): heavy LLM-based audits run AFTER commit so
# they NEVER block the push or the human's edit cycle. The audit
# runs in the background, writes a report, and (Phase 2) triggers
# a cleanup subagent that auto-fixes ERROR-level violations as a
# follow-up `fix(voice): auto-cleanup ...` commit.
#
# Symmetric design:
#   pre-commit  : lexical voice-filter (fast)
#   post-commit : LLM audit (heavy, async, this file)
#   pre-push    : lexical only (fast — book build, deep-link gate)
#   post-push   : LLM audit on push range (heavy, async, GitHub
#                 Action — Phase 4 — opens cleanup PR)
#
# Recursion guard: auto-cleanup commits are skipped so the chain
# does not loop on itself.

# NO `set -e` (removed 2026-05-22). This hook orchestrates ~15 INDEPENDENT
# fire-and-forget dispatches — punch-list tick, GDD monologue, ghost-read
# drops, outreach dispatch, telegram digest, room-meta, shortlex auto-fix.
# Under `set -e` the FIRST unguarded non-zero exit aborted the script, so
# dispatch #3 hiccuping silently killed dispatches #4–#15 with nothing in
# the log — exactly the operator-visible "halt for no reason." A post-commit
# hook's own exit code is ignored by git, so `set -e` bought no safety; it
# only coupled independent steps. Each step is now guarded individually
# (`|| true`, `if`, or backgrounded) so a failure is contained to its step.

LATEST_SHA=$(git rev-parse HEAD 2>/dev/null || true)
[ -z "$LATEST_SHA" ] && exit 0

# ── Default-quiet operation (May 22) ──────────────────────────────────
# This hook fires ~15 background dispatches and prints ~80-150 lines of
# diagnostic stdout per commit. When an agent (Claude Code / Codex /
# Gemini CLI) runs `git commit`, ALL of that lands in the agent's context
# window — ~1,500 tokens × N agents × M commits = real compounding token
# burn that the operator never reads in real time anyway.
#
# Default-quiet: redirect EVERYTHING to .thetacog/cache/post-commit-<sha>.log
# and emit only a one-line summary to the original stderr. Background
# dispatches inherit the redirected fds, so their output joins the same log
# (one file per commit). Restore happens via a trap on EXIT so recursion-
# guard early-exits also get the summary.
#
# POSTCOMMIT_VERBOSE=1 restores the firehose for hook debugging — never
# the default; the cost only pays off in a hands-on debugging session.
POSTCOMMIT_LOG_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/.thetacog/cache"
mkdir -p "$POSTCOMMIT_LOG_DIR" 2>/dev/null || true
POSTCOMMIT_LOG="$POSTCOMMIT_LOG_DIR/post-commit-${LATEST_SHA:0:8}.log"

_postcommit_restore() {
  # Print the FIRED/PAUSED summary + write the deferred manifest BEFORE
  # closing fd 4 — pc_print_summary emits via fd 4 when the redirect is
  # active. Guarded by `declare -f` so the recursion-guard early exits
  # (lines 80-97) that exit BEFORE the lib loads stay silent. Also
  # honors POSTCOMMIT_SKIP_SUMMARY=1 for auto-flush commits that don't
  # want a second summary printed on top of the human commit's summary.
  if [ "${POSTCOMMIT_SKIP_SUMMARY:-0}" != "1" ] && declare -f pc_print_summary >/dev/null 2>&1; then
    pc_write_manifest "$LATEST_SHA" 2>/dev/null || true
    pc_print_summary "$LATEST_SHA" 2>/dev/null || true
  fi
  if [ "${POSTCOMMIT_REDIRECTED:-0}" = "1" ]; then
    exec >&3 2>&4
    exec 3>&- 4>&-
    echo "✓ post-commit ${LATEST_SHA:0:8} — log ${POSTCOMMIT_LOG#${PWD}/}" >&2
  fi
}

if [ "${POSTCOMMIT_VERBOSE:-0}" != "1" ]; then
  trap _postcommit_restore EXIT
  exec 3>&1 4>&2
  exec > "$POSTCOMMIT_LOG" 2>&1
  POSTCOMMIT_REDIRECTED=1
fi

# ── Registry + advertise-vs-fire gate (May 22 — rate-limit triage) ─────
# The lib decides per-hook whether to fire or record what WOULD have fired.
# Default is "advertise": list paused hooks on the agent-visible stderr;
# operator picks via scripts/post-commit-run.sh or pre-enables with
# POSTCOMMIT_ENABLE / POSTCOMMIT_MODE=gemini. See scripts/post-commit-lib.sh.
REPO_ROOT_PC="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -f "$REPO_ROOT_PC/scripts/post-commit-lib.sh" ]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT_PC/scripts/post-commit-lib.sh"
else
  # Lib missing: fall back to "fire everything" so legacy behavior is safe.
  pc_should_fire()    { return 0; }
  pc_defer()          { :; }
  pc_write_manifest() { :; }
  pc_print_summary()  { :; }
fi

# Skip auto-cleanup commits — Phase 2 auto-fixer (planned) loops on itself.
#
# NOTE: fix(voice/auto-rewrite) commits do NOT skip — they re-fire post-commit
# by design. The GDD auto-rewrite chain depends on this:
#
#   author commits prose → ghost-read → friction → APPLY top-20% → commit
#   → post-commit fires AGAIN → ghost-read on updated file → new friction
#   (N' < N) → APPLY new top-20% → commit → ... → LLM finds 0 APPLY-worthy
#   items remaining → no commit → LOOP CLOSES naturally
#
# Bound: DAILY_AUTO_APPLY_CAP in ghost-read-auto-rewrite.mjs (default 5/day)
# is the safety net; natural bound is "LLM stops finding clear top-20%."
COMMIT_MSG=$(git log -1 --pretty=%B 2>/dev/null || true)
# Recursion-guard exits suppress the registry summary too — these commits
# are agent-internal flushes the operator never typed, and a summary on
# top of the human commit's summary is just noise.
if echo "$COMMIT_MSG" | grep -qE '^fix\(voice\): auto-cleanup'; then
  POSTCOMMIT_SKIP_SUMMARY=1
  exit 0
fi
# Recursion guard for shortlex auto-fix commits (May 17 GDD pattern).
# Without this, fix(shortlex/auto) commits re-trigger the sweep + LLM dispatch
# + commit — infinite loop.
if echo "$COMMIT_MSG" | grep -qE '^fix\(shortlex/auto\):'; then
  POSTCOMMIT_SKIP_SUMMARY=1
  exit 0
fi
# Recursion guard for GDD monologue/metrics flush commits (May 19, GDD iter 2).
# The GDD capture block below auto-commits the monologue + convergence metric
# as a `log(gdd):` commit (--no-verify). That commit re-fires post-commit;
# this guard makes the re-fire a clean no-op so the flush cannot loop. A
# log(gdd) commit touches no tracked spec and carries no iteration narrative —
# nothing downstream should react to it.
if echo "$COMMIT_MSG" | grep -qE '^log\(gdd\):'; then
  POSTCOMMIT_SKIP_SUMMARY=1
  exit 0
fi

# ── Always-on Gemini job: commit-trailer suggester (May 22) ───────────
# Companion to the rate-limit-triage pause-by-default scheme. Cheap
# Gemini Flash call per commit drafts the Originating-Terminal /
# Relevant-Rooms / Story trailers CLAUDE.md requires when they are
# missing, and pbcopies a `git commit --amend -F …` snippet. Silent
# exit when trailers are already complete or gemini CLI is absent.
# Backgrounded so it does not delay the commit return; the pbcopy +
# one-line nudge arrive a couple seconds later. Disable per-commit
# with POSTCOMMIT_TRAILER_SUGGESTER=off.
TRAILER_SUGGESTER="$REPO_ROOT_PC/scripts/post-commit-gemini-trailer.sh"
if [ -x "$TRAILER_SUGGESTER" ]; then
  ( nohup "$TRAILER_SUGGESTER" > "$REPO_ROOT_PC/.thetacog/cache/trailer-suggester-${LATEST_SHA:0:8}.log" 2>&1 & )
  disown 2>/dev/null || true
fi

# ── Tile-intent trailer ingestion (May 17 — bit-density loop) ──────────────
# Parse commit message for `Intent:` declarations and ingest into tc_quotes
# as source_kind='spec'. Format (one per line):
#
#   Intent: B:Signal 2000 spear-fish 5 named LPs by 2026-05-23
#   Intent: A:Fund @ 800 — finalize CATO Convention pitch §8
#
# Pattern: `Intent:` + tile_id (col:row) + bits (optional separator: @ or ' ')
# + claim (everything after). Claim must pass the compressor-gate.
#
# THE DISTINCTION: trailer goes to source_kind='spec' (intent). The commit
# itself gets ingested separately (next block) as source_kind='commit'
# (reality). Same commit, two corpora, kept distinct.
if [ -f "$(git rev-parse --show-toplevel)/scripts/tile-intent.mjs" ]; then
  echo "$COMMIT_MSG" | grep -E '^Intent:' | while IFS= read -r line; do
    # Strip leading "Intent:" + whitespace
    payload=$(echo "$line" | sed -E 's/^Intent:[[:space:]]+//')
    # Capture tile (col:row), bits, claim
    tile=$(echo "$payload" | grep -oE '^[A-Za-z]+:[A-Za-z]+' || true)
    [ -z "$tile" ] && continue
    rest=$(echo "$payload" | sed -E "s/^${tile}[[:space:]]*(@[[:space:]]*)?//")
    bits=$(echo "$rest" | grep -oE '^[0-9]+' || true)
    [ -z "$bits" ] && continue
    claim=$(echo "$rest" | sed -E 's/^[0-9]+[[:space:]]*(—[[:space:]]*|-[[:space:]]*)?//')
    [ -z "$claim" ] && continue
    echo "📐 Intent trailer → tile=$tile bits=$bits"
    node "$(git rev-parse --show-toplevel)/scripts/tile-intent.mjs" \
      --tile "$tile" --bits "$bits" --claim "$claim" 2>&1 | sed 's/^/   /' || true
  done
fi

# Reality ingestion (commit itself → tc_quotes as source_kind='commit').
# Same classification logic as tile-backfill.mjs but for the single new commit.
# Fully async — never blocks the next git operation.
if [ -f "$(git rev-parse --show-toplevel)/scripts/tile-backfill.mjs" ]; then
  ( nohup node "$(git rev-parse --show-toplevel)/scripts/tile-backfill.mjs" --since "$(git log -1 --pretty=%aI HEAD~1 2>/dev/null || echo '1 day ago')" >/dev/null 2>&1 & )
  disown 2>/dev/null || true
fi

# ── Punch-list cycle (runs on EVERY commit, content or not) ────────────
# One task per commit, cursor cycles. Heavy work amortizes across commits.
# Fully async — never blocks the next git operation.
if [ -x "./scripts/punch-list-tick.sh" ]; then
  ./scripts/punch-list-tick.sh || true
fi

# ── PMU substrate measurement (§0a v0 canonical signal — 2026-05-23) ───
# The §0a spec amendment names cache-tier latency as the v0 canonical
# substrate signal. This dispatch lands the measurement next to the diff
# that produced it: runs .thetacog/pmu/target/release/pmu-onchip (~150ms),
# parses tier latencies + ballistic-gate ns + 12x12 walk ns, writes a
# JSON record to .thetacog/pmu/measurements/<sha>.json tagged with the
# touched files. File→coordinate mapping happens at query time.
#
# Fully fire-and-forget — soft-skips on missing daemon (fresh clone has
# no Rust binary built). Never blocks. Build the daemon with:
#   cargo build --release --manifest-path .thetacog/pmu/Cargo.toml
if [ -x "$REPO_ROOT_PC/scripts/pmu/pmu-measure-commit.mjs" ]; then
  PMU_LOG="$REPO_ROOT_PC/.thetacog/cache/pmu-measure-${LATEST_SHA:0:8}.log"
  ( nohup bash -c "
      node '$REPO_ROOT_PC/scripts/pmu/pmu-measure-commit.mjs' --quiet
      # Cloud-bridge send is fully opt-in. Set PMU_CLOUD_OPT_IN=1 (and
      # optionally PMU_CLOUD_URL / PMU_CLOUD_HOST_ID) to push each per-
      # commit measurement to the /api/pmu/measurement receiver. With
      # opt-in unset, this exits silently — the local record on disk is
      # already the v0 canonical store.
      if [ -x '$REPO_ROOT_PC/scripts/pmu/pmu-cloud-send.mjs' ]; then
        node '$REPO_ROOT_PC/scripts/pmu/pmu-cloud-send.mjs' --quiet
      fi
    " > "$PMU_LOG" 2>&1 & )
  disown 2>/dev/null || true
fi

# ── Living competence map (the dogfood, on EVERY commit) — THE FAST CHIP PATH ──
# Runs the SAME method the chip runs: real pmu-onchip --ballistic walks (~14ms each, millions of
# walks/sec) → the pixelated 144×144 ballistic OVERLAP with the three-colour tolerance (green
# in-lane · amber a-few-out · RED when too many out-of-lane = the surgeon-plumbing alarm). The
# whole render is sub-second. --no-llm KEEPS IT FAST: the Gemini monologue is the ~21s path and is
# OFF the on-commit critical path (a deterministic templated read ships instead). Fire-and-forget;
# never blocks the commit; emails the heatmap (day-threaded). "If it takes 21s we're doing it wrong."
if [ -f "$REPO_ROOT_PC/scripts/pmu/commit-triptych.mjs" ]; then
  CMAP_LOG="$REPO_ROOT_PC/.thetacog/cache/competence-map-${LATEST_SHA:0:8}.log"
  ( nohup bash -c "
      # THE canonical anatomy: runPipeline (walk+xor on the chip) → 144×144 lattice TRIPTYCH
      # (INTENT · REALITY · DELTA-XOR) + three-colour tolerance, exactly as the dashboard/screenshot.
      # --story (operator 2026-06-10: the commit email carries the LONG STORY + sense-making): the
      # Gemini narration runs INSIDE this detached nohup job — the commit returned long ago, so the
      # LLM is on the email path, never the critical path. The chip read itself stays sub-second.
      # set -m (2026-06-12 — the missing-images band): nohup shields only THIS bash; bash resets
      # SIGHUP to default in its children, so a terminal-close group-HUP killed node mid-run
      # ('Hangup: 1' in competence-map-*.log, Jun 11 22:34–23:15 — ~10 commit emails never sent).
      # Job control gives node (and the walk/email children it spawns) their OWN process group,
      # out of the dying terminal's group entirely. Belt+braces with the SIGHUP guard in
      # commit-triptych.mjs / email-artifact.mjs. Reproduced + verified via kill -HUP -<pgid>.
      set -m
      node '$REPO_ROOT_PC/scripts/pmu/commit-triptych.mjs' --commit '$LATEST_SHA' --no-open --email --story
    " > "$CMAP_LOG" 2>&1 & )
  disown 2>/dev/null || true
fi

# ── GDD spec inner-monologue capture (May 19) ──────────────────────────
# Implements Level 3 of §3c (Bridge Transversions) for the spec itself:
# post-commit captures the commit's Story trailer + extracted decisions
# into the per-spec monologue and updates the convergence metric.
SPEC_TOUCHED=$(git diff-tree --no-commit-id --name-only -r "$LATEST_SHA" 2>/dev/null \
  | grep -E '^(docs/architecture/pmu-counter-module-shortlex-spec\.html|src/content/blog/2026-05-19-your-commit-log-is-a-convergence-signal\.mdx|src/content/blog/2026-05-19-the-prompt-and-the-log-are-one-document\.mdx)$' || true)
if [ -n "$SPEC_TOUCHED" ] && [ -f "./scripts/gdd/spec-monologue-update.mjs" ]; then
  node ./scripts/gdd/spec-monologue-update.mjs "$LATEST_SHA" 2>&1 | sed 's/^/   /' || true
fi

# ── GTM commentary six-needs inner-monologue grade (May 28) ────────────
# When the commit touches the GTM decision-maker commentary, fire the Gemini
# inner-monologue grader in the BACKGROUND (per META rule: heavy LLM is
# post-commit + async, never blocks the main thread). It re-grades every
# triple's six-needs fit and rewrites data/gtm-commentary-state.json with the
# live verdict (CONVERGED when 80% of triples clear 95% on predictive/impact/
# confidence). Fully fire-and-forget: soft-skips if gemini is absent.
GTM_COMMENTARY_TOUCHED=$(git diff-tree --no-commit-id --name-only -r "$LATEST_SHA" 2>/dev/null \
  | grep -E '^docs/strategy/gtm-commentary-decision-makers-2026-05-28\.html$' || true)
if [ -n "$GTM_COMMENTARY_TOUCHED" ] && [ -x "$REPO_ROOT_PC/scripts/gdd/gtm-commentary-inner-monologue.sh" ] && command -v gemini >/dev/null 2>&1; then
  GTM_GRADE_LOG="$REPO_ROOT_PC/.thetacog/cache/gtm-commentary-grade-${LATEST_SHA:0:8}.log"
  ( nohup bash -c "'$REPO_ROOT_PC/scripts/gdd/gtm-commentary-inner-monologue.sh'" > "$GTM_GRADE_LOG" 2>&1 & )
  disown 2>/dev/null || true
  echo "   · GTM commentary touched → Gemini six-needs grader dispatched (bg) → data/gtm-commentary-state.json" >&2
fi

# ── GDD HTML spec monologue capture (May 26) ──────────────────────────
# Updates the "Inner Monologue" in scripts/gdd/goals/*.html
if [ -f "./scripts/gdd/html-spec-update.mjs" ]; then
  node ./scripts/gdd/html-spec-update.mjs "$LATEST_SHA" 2>&1 | sed 's/^/   /' || true
  
  # Auto-flush for both HTML goals and legacy monologues/metrics — SCOPED to
  # exactly the GDD artifacts. Bug fixed 2026-05-28: this block used an
  # un-pathspec'd `git diff --cached --quiet` + `git commit`, which inspected
  # and committed the WHOLE staged index. Any file the operator had staged for
  # their own commit got swept into a `log(gdd):` flush under the wrong message
  # (it bundled a run-type-honest audit fix this way). Both the staged-check and
  # the commit are now restricted to the GDD paths via `-- <pathspec>`, so the
  # flush can never again steal the operator's unrelated staged work.
  GDD_FLUSH_PATHS=()
  for p in scripts/gdd/goals/*.html docs/architecture/gdd-monologue-*.md data/spec-completion-metrics.json; do
    [ -e "$p" ] && GDD_FLUSH_PATHS+=("$p")
  done
  if [ ${#GDD_FLUSH_PATHS[@]} -gt 0 ]; then
    git add "${GDD_FLUSH_PATHS[@]}" 2>/dev/null || true
    if ! git diff --cached --quiet -- "${GDD_FLUSH_PATHS[@]}" 2>/dev/null; then
      git commit --no-verify \
        -m "log(gdd): GDD monologue/metrics flush for ${LATEST_SHA:0:8}" \
        -m "Originating-Terminal: 🤖 post-commit hook" \
        -m "Story: Automated GDD flush — updated the monologue and metrics for ${LATEST_SHA:0:8}. The loop closes itself." \
        -- "${GDD_FLUSH_PATHS[@]}" \
        2>&1 | sed 's/^/   /' || true
    fi
  fi
fi

# ── Preview send on draft-OR-outbox edit (L1.PV-1 + L1.PV-2) ───────────
# Whenever a commit lands a NEW or MODIFIED file in docs/outreach/drafts/
# OR docs/outreach/outbox/, fire scripts/outreach/preview-send.mjs.
#
# L1.PV-1 (drafts/): canonical-body preview. Subject `[PREVIEW vN]`.
# L1.PV-2 (outbox/): per-recipient personalization preview. Subject
#   `[PREVIEW vN → <RecipientName>]` so the author can distinguish each
#   recipient's individualized version in the elias@ inbox while the
#   thread stays coherent (base subject identical across all N).
#
# Author workflow:
#   1. Draft canonical body in drafts/ → preview fires
#   2. Approve → expand-audience.mjs fans out to outbox/
#   3. Per-recipient hand-edit (or LLM-proposed via propose-personalization.mjs)
#      in outbox/<slug>--<email>.mdx → preview fires per edit
#   4. Each commit on an outbox file triggers a fresh `[PREVIEW vN → Name]`
#   5. When satisfied, dispatch fires N Resend sends
#
# Async, never blocks.
DRAFT_OR_OUTBOX_NEW=$(git diff HEAD~1 HEAD --name-only --diff-filter=AM 2>/dev/null \
  | grep -E '^docs/outreach/(drafts|outbox)/.+\.mdx$' || true)
if [ -n "$DRAFT_OR_OUTBOX_NEW" ] && [ -f "./scripts/outreach/preview-send.mjs" ]; then
  mkdir -p .thetacog/punch-list-logs
  TS_PV=$(date +%Y%m%d-%H%M%S)
  for f in $DRAFT_OR_OUTBOX_NEW; do
    echo "📮 Preview send → $f"
    ( nohup bash -c "
        cd '$(pwd)' &&
        node scripts/outreach/preview-send.mjs '$f'
      " > ".thetacog/punch-list-logs/preview-${TS_PV}-${LATEST_SHA:0:8}.log" 2>&1 & )
    disown 2>/dev/null || true
  done
fi

# ── Tier-8 preview-send: paste-iterations + social transitions ─────────
# Detects two transitions on the just-landed commit and drops a
# `preview_send` mailbox request for each (postman drains async, applying
# urgency × budget gates before firing the actual send).
#
# Transitions detected:
#   1. New / modified file in docs/ops/article-14-paste-iterations/*.txt
#      (excluding README.md and days-N-M-tag-plan.md)
#   2. R (rename) docs/social/drafts/X.{html,md,mdx,txt}
#                  → docs/social/approved/X.{html,md,mdx,txt}
#   3. New / modified file in docs/social/drafts/*
#
# Move to outbox/ or sent/ does NOT fire preview (already past preview stage).
#
# The detector is `detectPreviewTransitions()` exported from
# scripts/social/preview-send.mjs (also unit-tested at
# tests/preview-send/transition-detection.test.mjs).
if [ -f "./scripts/mailbox/drop-request.mjs" ] && [ -f "./scripts/social/preview-send.mjs" ]; then
  PREVIEW_DIFF=$(git diff-tree --name-status -r --no-commit-id "$LATEST_SHA" 2>/dev/null || true)
  if [ -n "$PREVIEW_DIFF" ]; then
    # Use Node to call detectPreviewTransitions and emit one line per target
    PREVIEW_TARGETS=$(printf '%s' "$PREVIEW_DIFF" | node -e "
      const data = require('fs').readFileSync(0, 'utf8');
      import('./scripts/social/preview-send.mjs').then(m => {
        const t = m.detectPreviewTransitions(data);
        for (const x of t) console.log(x.transition + '\t' + x.target_file);
      }).catch(e => { process.stderr.write(String(e)); process.exit(0); });
    " 2>/dev/null || true)
    if [ -n "$PREVIEW_TARGETS" ]; then
      PV_COUNT=0
      while IFS=$'\t' read -r transition target; do
        [ -z "$target" ] && continue
        node ./scripts/mailbox/drop-request.mjs \
          --kind preview_send \
          --target "$target" \
          --sha "$LATEST_SHA" \
          --importance 0.9 \
          --chain "$transition,$LATEST_SHA" >/dev/null 2>&1 || true
        PV_COUNT=$((PV_COUNT + 1))
      done <<< "$PREVIEW_TARGETS"
      if [ $PV_COUNT -gt 0 ]; then
        echo "📮 Dropped $PV_COUNT preview_send request(s) into mailbox/inbox/ (postman drains async)"
      fi
    fi
  fi
fi

# ── Ghost-reader chat-back loop (GR-1) ───────────────────────────────
# On any draft commit, fire scripts/outreach/ghost-reader.mjs per draft.
# It impersonates each audience entry via `claude -p` and writes per-recipient
# feedback to .thetacog/ghost-reader/<slug>--<email>.md. Advisory only —
# always exits 0; never blocks the post-commit chain. The author reads the
# output BEFORE moving the draft to approved/.
DRAFT_FOR_GHOST=$(git diff HEAD~1 HEAD --name-only --diff-filter=AM 2>/dev/null \
  | grep -E '^docs/outreach/drafts/.+\.mdx$' || true)
if [ -n "$DRAFT_FOR_GHOST" ] && [ -f "./scripts/outreach/ghost-reader.mjs" ]; then
  if pc_should_fire ghost-reader; then
    mkdir -p .thetacog/punch-list-logs .thetacog/ghost-reader
    for f in $DRAFT_FOR_GHOST; do
      echo "👻 Ghost-reader → $f [${POSTCOMMIT_DISPOSITION}]"
      ( nohup $POSTCOMMIT_ENV_PREFIX bash -c "
          cd '$(pwd)' &&
          node scripts/outreach/ghost-reader.mjs '$f'
        " > ".thetacog/punch-list-logs/ghost-reader-$(date +%Y%m%d-%H%M%S).log" 2>&1 & )
      disown 2>/dev/null || true
    done
  elif [ "$POSTCOMMIT_DISPOSITION" = "advertise" ]; then
    for f in $DRAFT_FOR_GHOST; do
      pc_defer ghost-reader "$f" "node scripts/outreach/ghost-reader.mjs '$f'"
    done
  fi
fi

# ── Outreach dispatch (fires on commits touching approved/ only) ──────
# An "approve:" commit promotes a draft → approved/. This hook reacts:
#   1. expand-audience.mjs  — fan out audience[] → outbox/X--<email>.mdx
#   2. dispatch.mjs         — Resend per-recipient; on ack mv outbox/ → sent/
#                              (only when OUTREACH_AUTO_DISPATCH=1)
# Async (background); never blocks. Set OUTREACH_DRY_RUN=1 in env to skip
# real Resend calls (renders + logs only).
#
# OUTREACH_AUTO_DISPATCH gating (added with cloud routine setup):
#   =1 (current default behavior): expand audience + send immediately.
#   =0: expand audience only — files sit in outbox/ until cron drains them
#       via POST /api/outreach/dispatch (the cloud routine path).
#   unset: assumed =1 to preserve existing production behavior. Flip the
#          default to =0 AFTER first successful cloud-routine drain is
#          verified — see docs/ops/email-iterations/cloud-routine-setup.md
#          ("Default flip-cutover" section).
APPROVED_CHANGED=$(git diff-tree --name-only --no-commit-id -r "$LATEST_SHA" 2>/dev/null \
  | grep -E '^docs/outreach/approved/.*\.mdx$' || true)
if [ -n "$APPROVED_CHANGED" ]; then
  AUTO_DISPATCH="${OUTREACH_AUTO_DISPATCH:-1}"
  if [ "$AUTO_DISPATCH" = "1" ]; then
    echo "📮 Outreach dispatch fires on: (OUTREACH_AUTO_DISPATCH=1 — expand + send)"
    echo "$APPROVED_CHANGED" | sed 's/^/     /'
    ( nohup bash -c "
        cd '$(pwd)' &&
        node scripts/outreach/expand-audience.mjs &&
        node scripts/outreach/dispatch.mjs &&
        echo '📮 Dispatch complete. Check docs/outreach/sent/ for receipts.'
      " > '.thetacog/punch-list-logs/outreach-dispatch-${LATEST_SHA:0:8}.log' 2>&1 & )
    disown 2>/dev/null || true
  else
    echo "📮 Outreach enqueue fires on: (OUTREACH_AUTO_DISPATCH=0 — expand only, cron will drain)"
    echo "$APPROVED_CHANGED" | sed 's/^/     /'
    ( nohup bash -c "
        cd '$(pwd)' &&
        node scripts/outreach/expand-audience.mjs &&
        echo '📮 Enqueue complete. Files sit in docs/outreach/outbox/ until cron drains.'
      " > '.thetacog/punch-list-logs/outreach-enqueue-${LATEST_SHA:0:8}.log' 2>&1 & )
    disown 2>/dev/null || true
  fi
fi

# ── Outreach dispatch report (Milestone H) ─────────────────────────────
# Fires on commits touching docs/outreach/sent/*.mdx. Renders a per-rule
# pass/fail HTML report at .thetacog/outreach-reports/<slug>.html so the
# user can open it locally and see exactly which Layer-1 rules tripped
# on the dispatch that just landed in sent/. Also rebuilds the index.
SENT_CHANGED=$(git diff-tree --name-only --no-commit-id -r "$LATEST_SHA" 2>/dev/null \
  | grep -E '^docs/outreach/sent/.+\.mdx$' || true)
if [ -n "$SENT_CHANGED" ]; then
  echo "📊 Outreach dispatch report fires on:"
  echo "$SENT_CHANGED" | sed 's/^/     /'
  SENT_LIST=$(echo "$SENT_CHANGED" | tr '\n' ' ')
  ( nohup bash -c "
      cd '$(pwd)' &&
      node scripts/outreach/render-dispatch-report.mjs $SENT_LIST &&
      echo '📊 Reports written to .thetacog/outreach-reports/'
    " > '.thetacog/punch-list-logs/outreach-report-${LATEST_SHA:0:8}.log' 2>&1 & )
  disown 2>/dev/null || true
fi

# ─── Outreach post-commit re-validation + L2 LLM stubs ───
# Lexical L1 already ran in pre-commit; post-commit re-runs them
# (tile may have changed in the seconds between staging and commit)
# AND fires the L2 LLM checks async (these need network, can't gate dispatch).
# Both are advisory — never blocks the commit chain.
#
# Why re-run L1 in post-commit:
#   - data/today-tile.json may have flipped between pre-commit and the time
#     this hook fires (especially across UTC midnight in a long edit session)
#   - L1.NB-1 references blog content that may have been edited in the same
#     commit; re-running here catches drift
#
# Why fire L2 stubs here:
#   - L2 checks (AA-1..3, IC-1..5) shell out to LLM and need network
#   - they cannot gate dispatch (would block the post-commit sender)
#   - the stub holds the call shape; LLM scaffold drops in later
SENT_NEW=$(git diff HEAD~1 HEAD --name-only --diff-filter=A 2>/dev/null \
  | grep -E '^docs/outreach/sent/.+\.mdx$' || true)
if [ -n "$SENT_NEW" ]; then
    mkdir -p .thetacog/punch-list-logs
    TS_LOG=$(date +%Y%m%d-%H%M%S)
    for f in $SENT_NEW; do
        # Re-run L1 lexicals against the file now that it sits in sent/.
        # Path classification routes sent/ to skip in precommit.mjs by
        # default — we pass --template only when needed; here we just
        # invoke the script with the path and let it no-op on sent/ paths.
        # Output captured for the dispatch report; never blocks.
        ( node scripts/outreach/precommit.mjs "$f" \
            >> ".thetacog/punch-list-logs/post-commit-revalidate-${TS_LOG}.log" 2>&1 || true ) &
        # Fire L2 stubs (currently no-op shells until LLM scaffold lands).
        if [ -x "./scripts/outreach/l2-checks.sh" ]; then
            if pc_should_fire l2-checks; then
                ( $POSTCOMMIT_ENV_PREFIX ./scripts/outreach/l2-checks.sh "$f" \
                    >> ".thetacog/punch-list-logs/post-commit-l2-${TS_LOG}.log" 2>&1 || true ) &
            elif [ "$POSTCOMMIT_DISPOSITION" = "advertise" ]; then
                pc_defer l2-checks "$f" "./scripts/outreach/l2-checks.sh '$f'"
            fi
        fi
    done
    disown 2>/dev/null || true
fi

# ── Leverage surface (every commit, synchronous, fast) ────────────────
# Reads data/leverage-actions.json (regenerated periodically by the
# predict-leverage punch-list task) and prints the top 3 actions to
# the terminal. Catches the post-commit dopamine moment and redirects
# attention to the next-highest-leverage move.
if [ -x "./scripts/print-leverage.sh" ]; then
  ./scripts/print-leverage.sh 3 || true
fi

# Filter to content files we audit. Voice-audit-llm scope stays narrow
# (chapter MD + recent blog MDX). Ghost-read scope is broader and
# matches outreach dispatches + LinkedIn / paste-iteration files too —
# the script itself routes to the correct persona set per file path.
CHANGED_FILES=$(git diff-tree --name-only --no-commit-id -r "$LATEST_SHA" 2>/dev/null || true)
CONTENT=$(echo "$CHANGED_FILES" | grep -E '\.(mdx|md)$' | grep -E '^(src/content/blog/2026-(04|05)-|books/tesseract/chapters)' || true)

# Ghost-read targets: blog/book/scratchpad PLUS newsletter dispatches
# (approved/outbox only — sent/ is too late) PLUS short-form social /
# paste iterations (LinkedIn, article-14 paste, YouTube paste).
#
# IMPORTANT: this regex MUST match the route filters in
# `scripts/ghost-read-async.mjs` ROUTES — any file enqueued here that the
# route filter does not match wastes a postman queue cycle (the script
# loads, reads, then bails with "no route"). Keep them aligned.
#
# scratchpad .txt is EXCLUDED (user 2026-05-23): raw notes/transcripts/
# LLM-dialog dumps don't deserve the 3-persona LLM grading pass; only the
# intentional .md/.mdx drafts in scratchpad/ qualify.
GHOST_READ_TARGETS=$(echo "$CHANGED_FILES" | grep -E '(src/content/blog/.+\.mdx$|books/tesseract/chapters/.+\.md$|docs/05-content/blog/scratchpad/.+\.(md|mdx)$|docs/outreach/(approved|outbox)/.+\.mdx$|docs/strategy/linkedin-posts/.+\.txt$|docs/ops/article-14-paste-iterations/.+\.txt$|docs/ops/yt-paste-iterations/.+\.txt$|docs/social/drafts/.+\.(html|md|mdx|txt)$|src/app/iamfim(-landing)?/(.+/)?page\.tsx$|src/content/pages/iamfim-.+\.mdx$)' | grep -v '\.keep$' || true)

# Voice rules audit targets — the canonical rules MD or the lexical rule
# engine. Computed pre-early-exit so a rules-only commit still fires it.
RULES_CHANGED=$(echo "$CHANGED_FILES" \
    | grep -E '^(docs/ops/email-iterations/holden-voice-rules\.md|scripts/outreach/precommit\.mjs)$' \
    || true)

# ── ShortLex auto-fix dispatch (May 17 GDD pattern) — BEFORE early exit ────
# Must run on EVERY commit (even empty / non-content commits) because a
# violation could exist anywhere in the codebase from prior work. The
# scan + LLM fix is fully async (nohup), so it doesn't block the chain.
# Recursion guard at the top of this file catches fix(shortlex/auto)
# commits so the loop terminates.
SHORTLEX_FIX="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/shortlex-auto-fix.mjs"
if [ -f "$SHORTLEX_FIX" ]; then
    if pc_should_fire shortlex-fix; then
        mkdir -p .thetacog/punch-list-logs
        ( nohup $POSTCOMMIT_ENV_PREFIX node "$SHORTLEX_FIX" \
            > ".thetacog/punch-list-logs/shortlex-auto-fix-${LATEST_SHA:0:8}.log" 2>&1 & )
        disown 2>/dev/null || true
    elif [ "$POSTCOMMIT_DISPOSITION" = "advertise" ]; then
        pc_defer shortlex-fix "" "node '$SHORTLEX_FIX'"
    fi
fi

# ── Telegram return-path digest (EVERY commit, async, fire-and-forget) ──
# Placed BEFORE the early-exit guard below — the return path must fire on
# tooling/schema/state commits too, not only content commits, or the
# bridge goes quiet exactly when work happens off the content path.
# Delta-tracked + threshold-gated in notify-digest.mjs: silent when nothing
# is new, so firing on every commit costs nothing.
NOTIFY_DIGEST="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/voice-bridge/notify-digest.mjs"
if [ -f "$NOTIFY_DIGEST" ]; then
    nohup env -u CLAUDECODE node "$NOTIFY_DIGEST" >/dev/null 2>&1 &
    disown 2>/dev/null || true
fi

if [ -z "$CONTENT" ] && [ -z "$GHOST_READ_TARGETS" ] && [ -z "$RULES_CHANGED" ]; then
  exit 0
fi

# Phase 1: dispatch heavy audits in background. fire-and-forget; no
# cleanup yet (Phase 2 will read the reports and apply fixes).
REPORT_DIR="docs/reports/voice-audit-async"
mkdir -p "$REPORT_DIR"

# Voice audit (LLM rule-violation finder) — only for chapter MD + blog MDX.
if [ -n "$CONTENT" ]; then
  if pc_should_fire voice-audit; then
    nohup $POSTCOMMIT_ENV_PREFIX env -u CLAUDECODE bash -c "
      ./scripts/voice-audit-llm.sh $CONTENT \
        > '$REPORT_DIR/voice-audit-${LATEST_SHA:0:8}.log' 2>&1
    " >/dev/null 2>&1 &
    disown
  elif [ "$POSTCOMMIT_DISPOSITION" = "advertise" ]; then
    for f in $CONTENT; do
      pc_defer voice-audit "$f" "./scripts/voice-audit-llm.sh '$f'"
    done
  fi
fi

# ── Ghost-read (BATCHED MAILBOX) ───────────────────────────────────────
# Previously: synchronous nohup ... & disown that fanned out one heavy
# LLM-driven runner PER eligible file IMMEDIATELY. That cascade-burned
# the token budget the moment an adjacency rule auto-applied an edit
# across multiple chapters in a single commit (May 8 incident).
#
# Now: drop one request per eligible file into the mailbox inbox. The
# Postman (punch-list task `postman-tick`, sibling of ghost-read-watch)
# applies urgency × token-budget gates on its own clock and spawns at
# most ~16 ghost-read runners per UTC day (MAX_PER_DAY=20, 20% reserved
# for non-ghost_read kinds). Hook completes in <100ms.
#
# Routes (handled by ghost-read-async.mjs based on file path):
#   blog/book/scratchpad → 3 personas (E/A/G), paragraph-by-paragraph
#   docs/outreach/{approved,outbox}/*.mdx → recipients from frontmatter
#   docs/strategy/linkedin-posts/*.txt + article-14-paste-iterations
#                       → 4 personas (H/Y/C/F), end-to-end
#   docs/ops/yt-paste-iterations/*.txt → 3 personas (L/S/P)
#
# Reports still land in docs/reports/ghost-read/<sha>-<slug>.html;
# ghost-read-watch surfaces FRICTION-FLAGGED reports as leverage.
if [ -n "$GHOST_READ_TARGETS" ] && [ -f "./scripts/mailbox/drop-request.mjs" ]; then
  DROP_COUNT=0
  for f in $GHOST_READ_TARGETS; do
    node ./scripts/mailbox/drop-request.mjs \
      --kind ghost_read \
      --target "$f" \
      --sha "$LATEST_SHA" \
      --importance 0.7 >/dev/null 2>&1 || true
    DROP_COUNT=$((DROP_COUNT + 1))
  done
  echo "📬 Dropped $DROP_COUNT ghost-read request(s) into mailbox/inbox/ (postman drains async)"
fi

# Post-anchor-check (LLM engagement-anchor scorer) — only on
# LinkedIn drafts and 2026-04+ blog posts. Same async dispatch.
ANCHOR_TARGETS=$(echo "$CONTENT" | grep -E '(docs/strategy/linkedin-posts/.*\.txt$|src/content/blog/2026-0[4-9]-.*\.mdx$)' || true)
if [ -n "$ANCHOR_TARGETS" ] && [ -x "./scripts/post-anchor-check.sh" ]; then
  if pc_should_fire post-anchor; then
    nohup $POSTCOMMIT_ENV_PREFIX env -u CLAUDECODE bash -c "
      ./scripts/post-anchor-check.sh $ANCHOR_TARGETS \
        > '$REPORT_DIR/post-anchor-${LATEST_SHA:0:8}.log' 2>&1
    " >/dev/null 2>&1 &
    disown
  elif [ "$POSTCOMMIT_DISPOSITION" = "advertise" ]; then
    for f in $ANCHOR_TARGETS; do
      pc_defer post-anchor "$f" "./scripts/post-anchor-check.sh '$f'"
    done
  fi
fi

echo "🤖 Async audits dispatched. sha=${LATEST_SHA:0:8}. Reports in $REPORT_DIR/"

# ─── Voice rules audit — fire when rules or rule engine change ────────
# When the canonical voice rules file or the lexical rule engine moves,
# re-audit the META principle (every rule must name a reader-effect).
# Mirrors the async dispatch pattern used by voice-audit-llm above.
# RULES_CHANGED is computed earlier so a rules-only commit still gets here.
# Fully async, never blocks.
if [ -n "$RULES_CHANGED" ]; then
    if pc_should_fire voice-rules; then
        echo "🪞 voice-rules-audit queued (rules changed) [${POSTCOMMIT_DISPOSITION}]"
        nohup $POSTCOMMIT_ENV_PREFIX env -u CLAUDECODE bash -c "
            cd '$(pwd)' &&
            ./scripts/voice-rules-audit.sh \
              > '$REPORT_DIR/voice-rules-audit-${LATEST_SHA:0:8}.log' 2>&1
        " >/dev/null 2>&1 &
        disown 2>/dev/null || true
    elif [ "$POSTCOMMIT_DISPOSITION" = "advertise" ]; then
        pc_defer voice-rules "" "./scripts/voice-rules-audit.sh"
    fi
fi

# ── Voice-bridge feedback loop — dispatch-doc delta detector ───────────
# Spec: docs/architecture/voice-bridge-feedback-loop-spec.md §3.5–3.6
#
# When a commit touches a docs/ops/voice-dispatch/*.json dispatch doc, a room
# has just written its slice's results back. The DETECTION — which subdivisions
# are newly terminal, what their delta messages say, whether a rollup is owed —
# lives in ONE place: `dispatch-doc.mjs emit-deltas`. The same subcommand the
# e2e test exercises. This hook carries NO detection logic; it only finds the
# touched docs, calls emit-deltas, and pipes each emitted JSON line to
# notify-telegram.sh. emit-deltas is pure detection + atomic guard-flag
# write-back (notified / rollup_sent) — a re-fired post-commit emits nothing.
#
# Synchronous + fast: a dispatch doc has ≤4 subdivisions; notify-telegram.sh is
# one curl each. Runs on EVERY commit (a room's write-back commit is an
# ordinary commit) — the JSON-touch grep makes it a no-op otherwise.
VOICE_DISPATCH_TOUCHED=$(git diff-tree --no-commit-id --name-only -r "$LATEST_SHA" 2>/dev/null \
  | grep -E '^docs/ops/voice-dispatch/.+\.json$' || true)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
DISPATCH_DOC_MJS="$REPO_ROOT/scripts/voice-bridge/dispatch-doc.mjs"
NOTIFY_TG="$REPO_ROOT/scripts/voice-bridge/notify-telegram.sh"
if [ -n "$VOICE_DISPATCH_TOUCHED" ] && [ -f "$DISPATCH_DOC_MJS" ]; then
  for doc_file in $VOICE_DISPATCH_TOUCHED; do
    [ -f "$REPO_ROOT/$doc_file" ] || continue   # skip a deleted doc
    DELTA_COUNT=0
    # emit-deltas is the SINGLE source of truth for detection. It prints one
    # JSON object per line: {"kind":"delta"|"rollup","room"?,"chat_id","message"}.
    # The hook neither inspects nor re-derives — it just sends each line.
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      kind=$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).kind||""))' 2>/dev/null || true)
      chat=$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).chat_id||0)))' 2>/dev/null || true)
      MSG=$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).message||""))' 2>/dev/null || true)
      [ -z "$kind" ] || [ -z "$MSG" ] && continue
      "$NOTIFY_TG" --text "$MSG" --chat-id "${chat:-0}" --silent 2>/dev/null || true
      [ "$kind" = "delta" ] && DELTA_COUNT=$((DELTA_COUNT + 1))
    done <<< "$(node "$DISPATCH_DOC_MJS" emit-deltas --doc "$REPO_ROOT/$doc_file" 2>/dev/null || true)"
    if [ "$DELTA_COUNT" -gt 0 ]; then
      echo "📲 voice-bridge: pushed $DELTA_COUNT delta(s) for $(basename "$doc_file")"
    fi
  done
fi

# ── Meta-reorganize + predict-next-5 (every commit, async) ─────────────
# Fires scripts/room-meta-task.sh in background. Re-attributes the last
# 14d of commits against owned-surface globs in .workflow/rooms/*.html,
# surfaces glob-vs-tag drift (e.g. spin(performer): commits attributed
# to architect via the broad docs/strategy/ glob), and predicts the next
# 5 commits from spin-up DAG + cadence + dormant-room triggers.
#
# Output: .thetacog/cache/room-meta/<date>-<time>.json
# The next ./scripts/open-room-session.sh invocation reads the most-recent
# file and prepends a "🔮 Predicted next" block above the punch list.
META_TASK="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/room-meta-task.sh"
if [ -x "$META_TASK" ]; then
    if pc_should_fire room-meta; then
        nohup $POSTCOMMIT_ENV_PREFIX "$META_TASK" --trigger=post-commit >/dev/null 2>&1 &
        disown 2>/dev/null || true
    elif [ "$POSTCOMMIT_DISPOSITION" = "advertise" ]; then
        pc_defer room-meta "" "'$META_TASK' --trigger=post-commit"
    fi
fi

# ── PMU demo regen — dogfooding + cloud-bridge snapshot (async, fire-and-forget)
# Regenerates the `npm run pmu-demo` artifact on every commit so the operator's
# kitchen always has a fresh lattice movie + receipt at hand. Output:
#   docs/reports/pmu-walk/demo-<timestamp>/  (HTML + mp4 + receipt + summary)
#
# Then snapshots that fresh run into public/pmu-demo/ with stable filenames
# so the hosted route at /pmu-simulator/demo always serves a recent artifact.
# Snapshot is best-effort: if it fails, the previously committed public/pmu-demo/
# content stays valid and the hosted route keeps working. The snapshot does
# NOT git-add or commit — those artifacts are committed deliberately when the
# operator wants the deploy to update; the hook just keeps the working tree
# refreshed so a manual `git add public/pmu-demo/` is one step.
#
# Guarded by an existence check (the demo entry may not exist on every
# checkout — older branches, fresh clones); PMU_DEMO_NO_OPEN=1 suppresses
# the Finder window so the hook does not pop windows on every commit. Never
# blocks the commit.
PMU_DEMO="$(git rev-parse --show-toplevel 2>/dev/null)/src/app/pmu-simulator/demo.mjs"
PMU_PUBLIC_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/public/pmu-demo"
PMU_OUTPUT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)/docs/reports/pmu-walk"
if [ -f "$PMU_DEMO" ]; then
    # ── Gap D#10: recursion guard. The opt-in auto-commit (below) creates a
    # "chore(pmu-demo): auto-snapshot" commit; that commit re-fires post-commit
    # and would re-run + re-commit forever. Skip the regen on that subject.
    PMU_DEMO_LAST_MSG=$(git log -1 --format='%s' "$LATEST_SHA" 2>/dev/null)
    case "$PMU_DEMO_LAST_MSG" in
      "chore(pmu-demo): auto-snapshot"*) PMU_DEMO_SKIP=1 ;;
      *)                                  PMU_DEMO_SKIP=0 ;;
    esac
    # ── Gap D#12: debounce. Only re-run when something that affects the demo
    # changed — the simulator source, the operative spec, or the hook itself.
    # Override with PMU_DEMO_ALWAYS=1 to force on every commit.
    if [ "$PMU_DEMO_SKIP" = "0" ] && [ "${PMU_DEMO_ALWAYS:-0}" != "1" ]; then
        PMU_DEMO_AFFECTING=$(git diff-tree --no-commit-id --name-only -r "$LATEST_SHA" 2>/dev/null \
            | grep -E '^(src/app/pmu-simulator/|docs/architecture/pmu-|hooks/post-commit$)' || true)
        [ -z "$PMU_DEMO_AFFECTING" ] && PMU_DEMO_SKIP=1
    fi
    if [ "$PMU_DEMO_SKIP" = "1" ]; then
        mkdir -p .thetacog/punch-list-logs
        echo "demo regen skipped (recursion guard or no demo-affecting changes) — previous snapshot stays valid" \
            >> ".thetacog/punch-list-logs/pmu-demo-${LATEST_SHA:0:8}.log"
    else
    mkdir -p .thetacog/punch-list-logs
    (
        # PMU_DEMO_STORY=1 → run demo.mjs with --story so public/pmu-demo/
        # shows the intentional competence pattern (the GTM-demo visual),
        # not the noisy spec-derived lattice. Default off; the operator's
        # local dogfood run keeps the real-spec rail. Set in the env on
        # the host that publishes to thetadriven.com/pmu-simulator/demo.
        PMU_STORY_FLAG=""
        [ "${PMU_DEMO_STORY:-0}" = "1" ] && PMU_STORY_FLAG="--story"
        nohup env PMU_DEMO_NO_OPEN=1 node "$PMU_DEMO" $PMU_STORY_FLAG \
            > ".thetacog/punch-list-logs/pmu-demo-${LATEST_SHA:0:8}.log" 2>&1
        # Snapshot the freshest demo-* dir into public/pmu-demo/ with stable
        # filenames. Best-effort: any failure leaves the previous snapshot
        # intact. Only runs if the demo write succeeded (the latest dir
        # contains at least lattice-movie.html).
        LATEST_DEMO=$(ls -1dt "$PMU_OUTPUT_ROOT"/demo-* 2>/dev/null | head -n 1)
        SNAP_LOG=".thetacog/punch-list-logs/pmu-demo-${LATEST_SHA:0:8}.log"
        if [ -n "$LATEST_DEMO" ] && [ -f "$LATEST_DEMO/lattice-movie.html" ] && [ -d "$PMU_PUBLIC_DIR" ]; then
            cp "$LATEST_DEMO/lattice-movie.html"          "$PMU_PUBLIC_DIR/lattice-movie.html"          2>/dev/null || true
            cp "$LATEST_DEMO/lattice-movie.mp4"           "$PMU_PUBLIC_DIR/lattice-movie.mp4"           2>/dev/null || true
            cp "$LATEST_DEMO/receipt.html"                "$PMU_PUBLIC_DIR/receipt.html"                2>/dev/null || true
            cp "$LATEST_DEMO/role-continuity-receipt.html" "$PMU_PUBLIC_DIR/role-continuity-receipt.html" 2>/dev/null || true
            cp "$LATEST_DEMO/competence-heatmap.svg"      "$PMU_PUBLIC_DIR/competence-heatmap.svg"      2>/dev/null || true
            cp "$LATEST_DEMO/summary.txt"                 "$PMU_PUBLIC_DIR/summary.txt"                 2>/dev/null || true
            # lattice.json — the cloud-bridge sidecar the /api/pmu/* routes
            # serve. Without this copy the deployed API has no data source
            # (the docs/reports/ fallback only exists on the operator host).
            cp "$LATEST_DEMO/lattice.json"                "$PMU_PUBLIC_DIR/lattice.json"                2>/dev/null || true
            # stills — the demo's PNG indices vary by frame count; glob whatever
            # the run emitted instead of hard-coding stale frame numbers (the
            # earlier still-422 / still-844 names did not match recent runs).
            cp "$LATEST_DEMO"/still-*.png                  "$PMU_PUBLIC_DIR/"                            2>/dev/null || true
            # explicit verdict per Gap B#5: enumerate the page-needed files
            # actually present in public/ after the copy, so a partial-copy or
            # missing-source failure surfaces in the log instead of being silent.
            {
                echo "snapshot OK → public/pmu-demo/ (from $(basename "$LATEST_DEMO"))"
                for f in lattice-movie.html lattice-movie.mp4 role-continuity-receipt.html lattice.json; do
                    if [ -f "$PMU_PUBLIC_DIR/$f" ]; then
                        echo "  ✓ $f"
                    else
                        echo "  ✗ $f MISSING (page will 404 on it)"
                    fi
                done
                STILL_COUNT=$(ls -1 "$PMU_PUBLIC_DIR"/still-*.png 2>/dev/null | wc -l | tr -d ' ')
                echo "  · $STILL_COUNT still PNG(s) in public/"
            } >> "$SNAP_LOG"
            # ── Gap D#10: opt-in auto-commit for unattended hosts. Closes the
            # deploy loop — the snapshot lands in git automatically — without
            # forcing it on the operator. The recursion guard above prevents
            # the auto-commit from re-triggering itself in an infinite loop.
            if [ "${PMU_DEMO_AUTO_COMMIT:-0}" = "1" ] && [ -d "$PMU_PUBLIC_DIR" ]; then
                cd "$(git rev-parse --show-toplevel 2>/dev/null)" || true
                if ! git diff --quiet -- "$PMU_PUBLIC_DIR" 2>/dev/null; then
                    git add "$PMU_PUBLIC_DIR" >/dev/null 2>&1
                    if git commit -m "chore(pmu-demo): auto-snapshot from ${LATEST_SHA:0:8}" --no-verify >/dev/null 2>&1; then
                        echo "auto-commit ok — public/pmu-demo/ committed" >> "$SNAP_LOG"
                    else
                        echo "auto-commit FAILED (git commit non-zero)" >> "$SNAP_LOG"
                    fi
                else
                    echo "auto-commit skipped — no changes to public/pmu-demo/" >> "$SNAP_LOG"
                fi
            fi
        else
            # snapshot skipped — log WHY so the silent-deploy failure becomes
            # detectable on operator and unattended hosts (Gap B#5).
            {
                echo "snapshot SKIPPED — preconditions not met:"
                [ -z "$LATEST_DEMO" ] && echo "  · no demo-* dir found under $PMU_OUTPUT_ROOT (the demo run may have failed silently)"
                [ -n "$LATEST_DEMO" ] && [ ! -f "$LATEST_DEMO/lattice-movie.html" ] && echo "  · latest demo dir $(basename "$LATEST_DEMO") is missing lattice-movie.html"
                [ ! -d "$PMU_PUBLIC_DIR" ] && echo "  · public/pmu-demo/ does not exist on this host (this is fine on a fresh clone)"
            } >> "$SNAP_LOG"
        fi
    ) &
    disown 2>/dev/null || true
    fi
fi

# The FIRED/PAUSED summary + deferred-manifest write fire from the
# EXIT trap (_postcommit_restore) so all exit paths — including the
# early-exit on no-content-changes a few hundred lines up — emit the
# summary to the agent-visible stderr. No call here on purpose.

exit 0
