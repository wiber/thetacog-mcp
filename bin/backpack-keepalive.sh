#!/bin/bash
# scripts/backpack-keepalive.sh
# ═══════════════════════════════════════════════════════════════════════════
# Keep this MacBook awake + connected for Claude Code /remote-control
# while the lid is closed and the laptop is in a backpack on hotspot.
#
# WHAT IT DOES
#   1. Disables sleep globally        (sudo pmset -a disablesleep 1 — system-wide flag, not per-profile)
#   2. Starts caffeinate -dimsu       (idle/display/disk/system/user assertions)
#   3. Starts ping keepalive          (every 30s → 1.1.1.1, prevents hotspot idle-disconnect)
#   4. Reports the state machine      (battery, sleep, network, Claude Code proc)
#
# USAGE
#   ./scripts/backpack-keepalive.sh            — start everything (idempotent) + report
#   ./scripts/backpack-keepalive.sh --check    — report current state, no changes
#   ./scripts/backpack-keepalive.sh --stop     — restore defaults, kill helpers
#
# AUTO-EXIT (default 12h)
#   caffeinate and ping keepalive both self-terminate after 12 hours so a
#   forgotten session doesn't run unbounded. Override with env:
#     BACKPACK_DURATION_SECONDS=21600 ./scripts/backpack-keepalive.sh   # 6h
#     BACKPACK_DURATION_SECONDS=0 ...                                    # no auto-exit
#
#   IMPORTANT: auto-exit kills caffeinate + ping. It does NOT re-enable
#   battery sleep (pmset disablesleep stays set — needs sudo to restore).
#   When you return: run `--stop` to clear pmset. Without --stop the Mac
#   stays awake on battery even after the helpers die. A notification
#   fires at expiry to remind you.
#
# STATE FILES (in ~/.thetacog/backpack/)
#   caffeinate.pid  keepalive.pid  started_at  expires_at
#
# PRACTICAL NOTES
#   - Battery drain is real: assume ~5-10% per hour idle, faster under load.
#     A full MBP charge gets you 3-6 hours of /remote-control runtime.
#   - Thermal: zipped backpack + LLM calls = throttle/shutdown risk. Leave a
#     pocket open for airflow, or use a mesh sleeve.
#   - Hotspot: keepalive prevents idle-disconnect, but iPhone's "Maximize
#     Compatibility" setting in Hotspot helps too.
#   - This script does NOT start Claude Code itself — `claude` must already be
#     running in a terminal session (tmux/screen recommended so it survives
#     terminal closure).
# ═══════════════════════════════════════════════════════════════════════════

set -e

STATE_DIR="$HOME/.thetacog/backpack"
mkdir -p "$STATE_DIR"

CAFFEINATE_PID_FILE="$STATE_DIR/caffeinate.pid"
KEEPALIVE_PID_FILE="$STATE_DIR/keepalive.pid"
STARTED_FILE="$STATE_DIR/started_at"
EXPIRES_FILE="$STATE_DIR/expires_at"

# Default duration: 12h (43200s). Set BACKPACK_DURATION_SECONDS=0 to disable.
DURATION_SECONDS="${BACKPACK_DURATION_SECONDS:-43200}"

# ── Helpers ────────────────────────────────────────────────────────────────

pid_alive() {
    local file="$1"
    [ -f "$file" ] || return 1
    local pid
    pid=$(cat "$file" 2>/dev/null)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Color codes (skip if not a tty)
if [ -t 1 ]; then
    G="\033[32m"; Y="\033[33m"; R="\033[31m"; B="\033[34m"; C="\033[36m"; N="\033[0m"
else
    G=""; Y=""; R=""; B=""; C=""; N=""
fi

ok()   { echo -e "  ${G}✓${N} $*"; }
warn() { echo -e "  ${Y}⚠${N} $*"; }
bad()  { echo -e "  ${R}✗${N} $*"; }
info() { echo -e "  ${B}→${N} $*"; }

# ── Status report ──────────────────────────────────────────────────────────

report() {
    echo -e "${C}═══ Backpack keepalive — current state ═══${N}"

    # Battery
    local batt src
    batt=$(pmset -g batt | grep -oE '[0-9]+%' | head -1)
    src=$(pmset -g batt | grep -oE "'.+'" | tr -d "'" | head -1)
    echo "  🔋 Battery: ${batt:-unknown} (source: ${src:-unknown})"

    # Sleep settings — disablesleep is a GLOBAL flag (not per-profile),
    # surfaced in `pmset -g` as "SleepDisabled".
    local sleep_disabled
    sleep_disabled=$(pmset -g | grep -iE 'sleepdisabled' | awk '{print $2}')
    if [ "$sleep_disabled" = "1" ]; then
        ok "Sleep DISABLED globally (pmset -a disablesleep 1) — lid-close stays awake"
    else
        warn "Sleep ENABLED (default) — lid-close will sleep on battery"
    fi

    # Caffeinate
    if pid_alive "$CAFFEINATE_PID_FILE"; then
        ok "caffeinate running (PID $(cat "$CAFFEINATE_PID_FILE"))"
    else
        warn "caffeinate NOT running"
    fi

    # Keepalive
    if pid_alive "$KEEPALIVE_PID_FILE"; then
        ok "ping keepalive running (PID $(cat "$KEEPALIVE_PID_FILE"))"
    else
        warn "ping keepalive NOT running"
    fi

    # Network
    if ping -c 1 -t 2 1.1.1.1 >/dev/null 2>&1; then
        local ssid
        ssid=$(networksetup -getairportnetwork en0 2>/dev/null | awk -F': ' '{print $2}')
        ok "network reachable (SSID: ${ssid:-unknown})"
    else
        bad "network UNREACHABLE — hotspot not connected?"
    fi

    # Claude Code
    if pgrep -f "claude" >/dev/null 2>&1; then
        local count
        count=$(pgrep -f "claude" 2>/dev/null | wc -l | tr -d ' ')
        ok "Claude Code process(es): $count running"
    else
        bad "Claude Code NOT detected — start with \`claude\` in a tmux session"
    fi

    # Remote Login (SSH)
    if systemsetup -getremotelogin 2>/dev/null | grep -q "On"; then
        ok "Remote Login (SSH) enabled"
    else
        info "Remote Login (SSH) disabled — /remote-control uses Anthropic infra, not SSH (this is fine)"
    fi

    # Time since start + expected expiry
    if [ -f "$STARTED_FILE" ]; then
        echo "  ⏱  Started: $(cat "$STARTED_FILE")"
    fi
    if [ -f "$EXPIRES_FILE" ]; then
        echo "  ⏰ Auto-exit at: $(cat "$EXPIRES_FILE") (caffeinate + ping; pmset stays — run --stop)"
    fi

    echo -e "${C}══════════════════════════════════════════${N}"
}

# ── Start ──────────────────────────────────────────────────────────────────

start() {
    echo -e "${C}Starting backpack keepalive…${N}"

    # 1. Disable sleep globally (needs sudo).
    # disablesleep is a system-wide flag, NOT per-profile — `-b` would be a
    # silent no-op on this flag, so `-a` (all profiles) is required.
    info "Requesting sudo to disable sleep globally (pmset -a disablesleep 1)…"
    sudo pmset -a disablesleep 1 2>&1 | sed 's/^/  /'

    # 2. Caffeinate with optional auto-exit timer
    if pid_alive "$CAFFEINATE_PID_FILE"; then
        info "caffeinate already running (PID $(cat "$CAFFEINATE_PID_FILE")); skipping"
    else
        if [ "$DURATION_SECONDS" -gt 0 ]; then
            nohup caffeinate -dimsu -t "$DURATION_SECONDS" >/dev/null 2>&1 &
        else
            nohup caffeinate -dimsu >/dev/null 2>&1 &
        fi
        echo $! > "$CAFFEINATE_PID_FILE"
        ok "caffeinate started (PID $(cat "$CAFFEINATE_PID_FILE"))$([ "$DURATION_SECONDS" -gt 0 ] && echo " — auto-exit in $((DURATION_SECONDS / 3600))h")"
    fi

    # 3. Ping keepalive (with optional self-terminate at duration + osascript notification)
    if pid_alive "$KEEPALIVE_PID_FILE"; then
        info "ping keepalive already running (PID $(cat "$KEEPALIVE_PID_FILE")); skipping"
    else
        if [ "$DURATION_SECONDS" -gt 0 ]; then
            nohup bash -c "
                KILL_AT=\$((\$(date +%s) + $DURATION_SECONDS))
                while [ \$(date +%s) -lt \$KILL_AT ]; do
                    ping -c 1 -t 5 1.1.1.1 >/dev/null 2>&1 || true
                    sleep 30
                done
                # Auto-exit reached. caffeinate -t handles its own exit. Fire a
                # macOS notification reminding the user that pmset disablesleep
                # is STILL set (needs sudo to restore — run --stop manually).
                osascript -e 'display notification \"caffeinate + ping stopped. pmset disablesleep is STILL set — run ./scripts/backpack-keepalive.sh --stop to restore battery sleep.\" with title \"Backpack Keepalive 12h elapsed\"' >/dev/null 2>&1 || true
            " >/dev/null 2>&1 &
        else
            nohup bash -c '
                while true; do
                    ping -c 1 -t 5 1.1.1.1 >/dev/null 2>&1 || true
                    sleep 30
                done
            ' >/dev/null 2>&1 &
        fi
        echo $! > "$KEEPALIVE_PID_FILE"
        ok "ping keepalive started (PID $(cat "$KEEPALIVE_PID_FILE")) — 30s interval$([ "$DURATION_SECONDS" -gt 0 ] && echo ", auto-exit in $((DURATION_SECONDS / 3600))h")"
    fi

    # 4. Mark started + expected expiry
    date "+%Y-%m-%d %H:%M:%S %Z" > "$STARTED_FILE"
    if [ "$DURATION_SECONDS" -gt 0 ]; then
        # macOS date -v for offset; Linux date -d. Try macOS first.
        date -v "+${DURATION_SECONDS}S" "+%Y-%m-%d %H:%M:%S %Z" > "$EXPIRES_FILE" 2>/dev/null \
            || date -d "+${DURATION_SECONDS} seconds" "+%Y-%m-%d %H:%M:%S %Z" > "$EXPIRES_FILE" 2>/dev/null \
            || rm -f "$EXPIRES_FILE"
    else
        rm -f "$EXPIRES_FILE"
    fi

    echo ""
    report

    echo ""
    echo -e "${Y}REMINDER${N}: this script does NOT start Claude Code itself."
    echo "If you don't see 'Claude Code process(es): N running' above, start it now:"
    echo "  tmux new -s claude 'claude'"
    echo "(tmux so the session survives terminal closure when lid closes)"
}

# ── Stop ───────────────────────────────────────────────────────────────────

stop() {
    echo -e "${C}Stopping backpack keepalive…${N}"

    # Restore sleep (global flag)
    info "Re-enabling sleep globally (sudo pmset -a disablesleep 0)…"
    sudo pmset -a disablesleep 0 2>&1 | sed 's/^/  /'

    # Kill caffeinate
    if pid_alive "$CAFFEINATE_PID_FILE"; then
        local pid
        pid=$(cat "$CAFFEINATE_PID_FILE")
        kill "$pid" 2>/dev/null || true
        ok "caffeinate killed (PID $pid)"
    fi
    rm -f "$CAFFEINATE_PID_FILE"

    # Kill keepalive
    if pid_alive "$KEEPALIVE_PID_FILE"; then
        local pid
        pid=$(cat "$KEEPALIVE_PID_FILE")
        kill "$pid" 2>/dev/null || true
        ok "ping keepalive killed (PID $pid)"
    fi
    rm -f "$KEEPALIVE_PID_FILE"

    rm -f "$STARTED_FILE"
    rm -f "$EXPIRES_FILE"

    echo ""
    echo -e "${G}═══ Defaults restored ═══${N}"
}

# ── Dispatch ───────────────────────────────────────────────────────────────

case "${1:-}" in
    --check|-c)  report ;;
    --stop|-s)   stop ;;
    --help|-h)
        sed -n '2,30p' "$0"
        exit 0
        ;;
    "")          start ;;
    *)
        echo "Unknown flag: $1" >&2
        echo "Usage: $0 [--check|--stop|--help]" >&2
        exit 2
        ;;
esac
