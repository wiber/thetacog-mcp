// src/lib/pmu/room-key.mjs — THE ROOM, NORMALISED, IN ONE PLACE (KR4, 2026-09-16).
//
// Two maps already existed on disk and nobody had joined them: a session's room is in its lens receipts
// (running_in.key) and a commit's room is in its Originating-Terminal trailer. The trailer is free text —
// twenty-four spellings of nine rooms were counted on 551 commits ("📐 architect", "📐 VS Code Architect",
// "🔒 vault (WezTerm)", "🔨 iTerm2 (builder)") — so the normaliser lives here and is imported by the tape door
// (walk-door stamps `room` on every commit row from the trailer) and by the knob ratchet (same-room pairing).
// One rule, one place: a new spelling is added here and nowhere else.
import { execFileSync } from 'node:child_process';

export const ROOM_KEYS = ['architect', 'voice', 'vault', 'builder', 'navigator', 'operator', 'laboratory', 'performer', 'network'];

/** free-text room label (a trailer, a terminal name, a receipt key) → one of ROOM_KEYS, or null */
export function roomKey(label) {
  if (!label) return null;
  const s = String(label).toLowerCase();
  for (const k of ROOM_KEYS) if (s.includes(k)) return k;
  if (/wezterm/.test(s)) return 'vault';
  if (/iterm/.test(s)) return 'builder';
  if (/kitty/.test(s)) return 'operator';
  if (/cursor/.test(s)) return 'laboratory';
  if (/alacritty/.test(s)) return 'performer';
  if (/\brio\b/.test(s)) return 'navigator';
  if (/vs ?code|vscode/.test(s)) return 'architect';
  if (/apple_terminal|terminal voice/.test(s)) return 'voice';
  if (/messages/.test(s)) return 'network';
  return null;
}

/** the room that MADE a commit, from its Originating-Terminal trailer; null when the sha or trailer is absent. Bounded: one git call. */
// the terminal → room table from scripts/room.sh auto_detect_room(), mirrored so a node hook signs with the room it runs in
// (2026-09-18: 103 of 164 flight-tape turn rows were unsigned — 'no room — no identity to sign with' — because THETACOG_ROOM is
// never set in the hook's env, while the shell resolver knew the room the whole time)
export function roomFromTerminal(env = process.env) {
  if (env.THETACOG_ROOM) return env.THETACOG_ROOM;
  const tp = env.TERM_PROGRAM || '';
  if (tp === 'iTerm.app') return 'builder';
  if (tp === 'Apple_Terminal') return 'voice';
  if (tp === 'WezTerm') return 'vault';
  if (tp === 'vscode') return (env.CURSOR_TRACE_ID || /cursor/i.test(env.VSCODE_GIT_ASKPASS_NODE || '')) ? 'laboratory' : 'architect';
  if (tp === 'rio') return 'navigator';
  if (env.KITTY_WINDOW_ID) return 'operator';
  if (env.ALACRITTY_LOG) return 'performer';
  if (env.RIO_VERSION || env.RIO_LOG_LEVEL) return 'navigator';
  if (env.CURSOR_TRACE_ID) return 'laboratory';
  return null;
}
export function roomFromCommitTrailer(ref, repoRoot = process.cwd()) {
  if (!ref || !/^[0-9a-f]{7,40}$/i.test(String(ref))) return null;
  try {
    const body = execFileSync('git', ['log', '-1', '--format=%B', String(ref)], { cwd: repoRoot, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = body.match(/^Originating-Terminal:\s*(.+)$/m);
    return m ? roomKey(m[1]) : null;
  } catch { return null; }
}
