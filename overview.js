/**
 * thetacog_overview — live 3-recent + 3-next computed from real git activity.
 *
 * Replaces static markdown / HTML overviews with a real computation:
 *  - parses each room's "Owned file/dir surface" globs from .workflow/rooms/*.html
 *  - reads room metadata (emoji, coordinate) from .thetacog/gemini-sessions.json
 *  - groups commits in the last 14d by owning room (largest-fraction-of-files wins)
 *  - filters auto-bumps (chore(scratchpad|burned-openers|audit), auto-update, etc.)
 *  - picks 3 just_completed (most recent, one per distinct room)
 *  - picks 3 next_up scored by (blocks_downstream × 2) + dormancy_days
 *  - returns JSON with grid_12x12_colored_cells map (diagonal cells for v0)
 *
 * Spin-up DAG: voice → performer → network → operator → architect.
 * Foundation rooms (builder, laboratory, claudelab, vault, navigator) are
 * independent unless dormant > 14 days, which adds +5 to score.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// HTML basename -> room key (matches .thetacog/gemini-sessions.json keys)
const HTML_TO_ROOM = {
  'alacritty-performer.html': 'performer',
  'claude-laboratory.html': 'claudelab',
  'cursor-laboratory.html': 'laboratory',
  'iterm2-builder.html': 'builder',
  'kitty-operator.html': 'operator',
  'messages-network.html': 'network',
  'rio-navigator.html': 'navigator',
  'terminal-voice.html': 'voice',
  'vscode-architect.html': 'architect',
  'wezterm-vault.html': 'vault'
};

// Spin-up dependencies: key blocks downstream values when key has activity
// voice → performer → network → operator → architect
const SPIN_UP_DAG = {
  voice: ['performer'],
  performer: ['network'],
  network: ['operator', 'architect'],
  operator: [],
  architect: [],
  // Foundation rooms — independent
  builder: [],
  laboratory: [],
  claudelab: [],
  vault: [],
  navigator: []
};

const FOUNDATION_ROOMS = new Set(['builder', 'laboratory', 'claudelab', 'vault', 'navigator']);

// Auto-bump heuristics — these don't count as meaningful work
const AUTO_BUMP_PREFIXES = [
  'chore(scratchpad)',
  'chore(burned-openers)',
  'chore(audit)',
  'chore(pipeline)',
  'auto-apply',
  'ops:'
];
const AUTO_BUMP_SUBSTRINGS = ['auto-update', 'auto-state regen', 'auto-bump'];

function isAutoBump(subject) {
  if (!subject) return false;
  for (const p of AUTO_BUMP_PREFIXES) if (subject.startsWith(p)) return true;
  for (const s of AUTO_BUMP_SUBSTRINGS) if (subject.includes(s)) return true;
  return false;
}

// Find repo root by walking up looking for .git
function findRepoRoot(startDir) {
  let dir = startDir;
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Parse "Owned file/dir surface" globs out of a room HTML.
 * Looks for: <h3>Owned file/dir surface</h3> ... <ul>...<li><code>GLOB</code>...</li>...</ul>
 * Returns array of glob strings.
 */
function parseOwnedSurface(htmlPath) {
  if (!fs.existsSync(htmlPath)) return [];
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Find the heading and the next </ul> after it
  const headingIdx = html.indexOf('Owned file/dir surface');
  if (headingIdx === -1) return [];

  const ulStart = html.indexOf('<ul>', headingIdx);
  if (ulStart === -1) return [];
  const ulEnd = html.indexOf('</ul>', ulStart);
  if (ulEnd === -1) return [];

  const ulBody = html.slice(ulStart, ulEnd);
  // Extract every <code>...</code> inside
  const re = /<code>([^<]+)<\/code>/g;
  const globs = [];
  let m;
  while ((m = re.exec(ulBody)) !== null) {
    const g = m[1].trim();
    if (g) globs.push(g);
  }
  return globs;
}

/**
 * Convert an "owned-surface glob" string from the HTML into a regex
 * that matches commit-touched file paths.
 *
 * Strategy (kept simple — these are mostly path prefixes / shell-style globs):
 *  - Trim trailing slash → treat as prefix
 *  - "*" → "[^/]*"   (no path separator crossing)
 *  - "**" → ".*"     (cross any depth)
 *  - "." → "\\."     (literal dot)
 */
function globToRegex(glob) {
  let g = glob;
  // Strip trailing slash (treat dir as prefix match)
  const dirMode = g.endsWith('/');
  if (dirMode) g = g.slice(0, -1);
  // Escape regex specials except * and ?
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      // Check for **
      if (g[i + 1] === '*') { re += '.*'; i++; }
      else re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+()|^$[]{}\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  // Anchor at start; if it was a dir, allow anything after the prefix
  return new RegExp('^' + re + (dirMode ? '(/|$)' : '($|/)'));
}

/**
 * For every room, build a list of compiled regexes from its owned-surface globs.
 * Returns: { roomKey: { globs: [...], regexes: [...] } }
 */
function buildRoomSurfaces(repoRoot) {
  const roomsDir = path.join(repoRoot, '.workflow', 'rooms');
  const result = {};
  for (const [htmlBasename, roomKey] of Object.entries(HTML_TO_ROOM)) {
    const htmlPath = path.join(roomsDir, htmlBasename);
    const globs = parseOwnedSurface(htmlPath);
    const regexes = globs.map(globToRegex);
    result[roomKey] = { globs, regexes };
  }
  return result;
}

/**
 * Read room emoji + coordinate from .thetacog/gemini-sessions.json
 */
function loadRoomMeta(repoRoot) {
  const p = path.join(repoRoot, '.thetacog', 'gemini-sessions.json');
  if (!fs.existsSync(p)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const meta = {};
    for (const [roomKey, v] of Object.entries(data.rooms || {})) {
      meta[roomKey] = {
        emoji: v.emoji || '',
        coordinate: v.coordinate || ''
      };
    }
    return meta;
  } catch {
    return {};
  }
}

// ---------- Relevant-Rooms trailer support ----------
//
// CLAUDE.md (commit 75a0e752c) requires every Claude-authored commit to carry
// a `Relevant-Rooms:` trailer naming the top-3 rooms whose owned-surface the
// commit most touches. When present, the trailer's first entry is the
// source-of-truth for attribution; glob-matching is the fallback.

// Cache of repoRoot -> { displayNameToRoomId: Map, byRoomId: Map } so we read
// .thetacog/gemini-sessions.json once per computeOverview() call.
const _roomNameCache = new Map();

/**
 * Build (and cache) a display_name -> roomId lookup from
 * .thetacog/gemini-sessions.json.
 */
function loadDisplayNameIndex(repoRoot) {
  if (_roomNameCache.has(repoRoot)) return _roomNameCache.get(repoRoot);
  const p = path.join(repoRoot, '.thetacog', 'gemini-sessions.json');
  const idx = { displayNameToRoomId: new Map() };
  if (fs.existsSync(p)) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [roomId, v] of Object.entries(data.rooms || {})) {
        const dn = (v.display_name || '').trim();
        if (dn) idx.displayNameToRoomId.set(dn, roomId);
      }
    } catch { /* leave empty */ }
  }
  _roomNameCache.set(repoRoot, idx);
  return idx;
}

/**
 * Map a display_name (e.g. "Rio Navigator") to its room id (e.g. "navigator").
 * Returns null if no exact match.
 */
function mapDisplayNameToRoomId(displayName, repoRoot) {
  if (!displayName) return null;
  const idx = loadDisplayNameIndex(repoRoot);
  return idx.displayNameToRoomId.get(displayName) || null;
}

/**
 * Parse the `Relevant-Rooms:` trailer from a full commit message body.
 *
 * Format (per CLAUDE.md):
 *   Relevant-Rooms: 🧭 Rio Navigator, 📐 VS Code Architect, 🎩 Kitty Operator
 *
 * For each comma-separated segment: strip whitespace + any leading emoji
 * (everything before the first alphabetic character). Returns an array of
 * display_name strings, or null if the trailer is missing/empty.
 */
function parseRelevantRoomsTrailer(commitMessage) {
  if (!commitMessage || typeof commitMessage !== 'string') return null;
  const m = commitMessage.match(/^Relevant-Rooms:\s*(.+)$/m);
  if (!m) return null;
  const segments = m[1].split(',').map(s => s.trim()).filter(Boolean);
  const names = [];
  for (const seg of segments) {
    // Strip leading non-alphabetic characters (emoji, punctuation, whitespace).
    // First /[A-Za-z]/ is the start of the display name.
    const nameMatch = seg.match(/[A-Za-z].*$/);
    if (nameMatch) {
      const cleaned = nameMatch[0].trim();
      if (cleaned) names.push(cleaned);
    }
  }
  return names.length > 0 ? names : null;
}

/**
 * Fetch full commit messages (subject + body + trailers) for a list of SHAs.
 * Returns Map<shaFull, fullMessage>. Done as one git invocation per repo for
 * efficiency; %B is NUL-terminated so embedded newlines in bodies are safe.
 */
function loadCommitBodies(repoRoot, shaFullList) {
  const bodies = new Map();
  if (!shaFullList || shaFullList.length === 0) return bodies;
  try {
    // -z separates records by NUL, --no-walk processes only the given SHAs.
    // Format: "<sha>\n<full-message>" then NUL.
    const args = ['--no-walk', '-z', '--format=%H%n%B', ...shaFullList];
    const raw = execSync(
      `git -C "${repoRoot}" log ${args.map(a => `"${a}"`).join(' ')}`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    const records = raw.split('\0').filter(Boolean);
    for (const rec of records) {
      const nlIdx = rec.indexOf('\n');
      if (nlIdx === -1) continue;
      const sha = rec.slice(0, nlIdx).trim();
      const body = rec.slice(nlIdx + 1);
      if (sha) bodies.set(sha, body);
    }
  } catch {
    // best-effort: leave bodies empty; trailer-attribution gracefully falls
    // back to glob-match.
  }
  return bodies;
}

/**
 * Run git log and return parsed commits (last 14d).
 * Each commit: { sha, ts (unix), subject, files: [...] }
 */
function loadRecentCommits(repoRoot, daysBack = 14) {
  let raw;
  try {
    raw = execSync(
      `git -C "${repoRoot}" log --since="${daysBack} days ago" --pretty=format:'@@COMMIT@@%H|%ct|%s' --name-only`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    return [];
  }

  const commits = [];
  const blocks = raw.split('@@COMMIT@@').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines.shift();
    if (!header) continue;
    const [sha, ts, ...rest] = header.split('|');
    const subject = rest.join('|');
    const files = lines.map(l => l.trim()).filter(Boolean);
    commits.push({
      sha: (sha || '').slice(0, 9),
      shaFull: sha || '',
      ts: parseInt(ts, 10) || 0,
      subject: subject || '',
      files
    });
  }
  return commits;
}

/**
 * Assign each commit to a room.
 *
 * Order:
 *   1. TRAILER — if the commit message carries `Relevant-Rooms: ...` and its
 *      first entry maps to a valid room id, that wins. method = "trailer".
 *   2. GLOB — fall back to the original largest-fraction-of-files match
 *      against each room's owned-surface globs (parsed from
 *      .workflow/rooms/*.html). method = "glob".
 *
 * Returns { room, method } or null if neither approach yields a room.
 *
 * `ctx` carries the cross-cutting state we need:
 *   - ctx.repoRoot: for display_name → roomId lookup
 *   - ctx.bodies:   Map<shaFull, fullMessage> from loadCommitBodies()
 */
function assignCommitToRoom(commit, surfaces, roomOrder, ctx = {}) {
  // ---- 1. Trailer attribution (source of truth when present) ----
  const body = ctx.bodies && commit.shaFull ? ctx.bodies.get(commit.shaFull) : null;
  if (body) {
    const names = parseRelevantRoomsTrailer(body);
    if (names && names.length > 0) {
      const firstRoom = mapDisplayNameToRoomId(names[0], ctx.repoRoot);
      if (firstRoom && surfaces[firstRoom]) {
        return { room: firstRoom, method: 'trailer' };
      }
      // first entry didn't map — fall through to glob fallback
    }
  }

  // ---- 2. Glob fallback ----
  if (!commit.files || commit.files.length === 0) return null;
  const counts = {}; // room -> count
  for (const file of commit.files) {
    for (const room of roomOrder) {
      const regexes = surfaces[room]?.regexes || [];
      for (const re of regexes) {
        if (re.test(file)) {
          counts[room] = (counts[room] || 0) + 1;
          break; // one file → one room match per room
        }
      }
    }
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    // tie-break: room order index
    return roomOrder.indexOf(a[0]) - roomOrder.indexOf(b[0]);
  });
  return { room: entries[0][0], method: 'glob' };
}

/**
 * For just_completed: pick the 3 most-recent meaningful (non-auto-bump)
 * commits, with no two from the same room.
 */
function pickJustCompleted(commits, surfaces, roomOrder, ctx) {
  const sorted = [...commits].sort((a, b) => b.ts - a.ts);
  const picked = [];
  const seenRooms = new Set();
  for (const c of sorted) {
    if (isAutoBump(c.subject)) continue;
    const att = assignCommitToRoom(c, surfaces, roomOrder, ctx);
    if (!att) continue;
    if (seenRooms.has(att.room)) continue;
    picked.push({ ...c, room: att.room, attribution_method: att.method });
    seenRooms.add(att.room);
    if (picked.length >= 3) break;
  }
  return picked;
}

/**
 * Determine which rooms have recent activity (within last 14d).
 * Used to fire spin-up triggers.
 */
function activeRoomsFromCommits(commits, surfaces, roomOrder, ctx) {
  const active = new Set();
  const lastCommitTs = {};
  for (const c of commits) {
    if (isAutoBump(c.subject)) continue;
    const att = assignCommitToRoom(c, surfaces, roomOrder, ctx);
    if (!att) continue;
    active.add(att.room);
    if (!lastCommitTs[att.room] || c.ts > lastCommitTs[att.room]) {
      lastCommitTs[att.room] = c.ts;
    }
  }
  return { active, lastCommitTs };
}

/**
 * Score next_up candidates and pick 3.
 *
 * Score = (blocks_downstream_count × 2) + dormancy_days_capped_at_14
 * Foundation rooms get +5 if dormant > 14 days.
 * Room must NOT be in just_completed picks.
 */
function pickNextUp(commits, surfaces, roomOrder, justCompleted, ctx) {
  const { active, lastCommitTs } = activeRoomsFromCommits(commits, surfaces, roomOrder, ctx);
  const now = Math.floor(Date.now() / 1000);
  const justCompletedRooms = new Set(justCompleted.map(c => c.room));

  const candidates = [];
  for (const room of roomOrder) {
    if (justCompletedRooms.has(room)) continue;

    const downstream = SPIN_UP_DAG[room] || [];
    const blocksDownstream = downstream.length;

    // Dormancy: days since last activity (cap 14, default 14 if never seen)
    const lastTs = lastCommitTs[room];
    const dormancyDays = lastTs
      ? Math.min(14, Math.floor((now - lastTs) / 86400))
      : 14;

    let score = (blocksDownstream * 2) + dormancyDays;

    // Trigger detection: any UPSTREAM room in the DAG had recent activity?
    let triggerMet = false;
    let triggerSha = null;
    for (const [upstream, downstreams] of Object.entries(SPIN_UP_DAG)) {
      if (downstreams.includes(room)) {
        if (active.has(upstream)) {
          triggerMet = true;
          // Find most recent upstream commit
          const upstreamCommits = commits
            .filter(c => !isAutoBump(c.subject))
            .filter(c => {
              const a = assignCommitToRoom(c, surfaces, roomOrder, ctx);
              return a && a.room === upstream;
            })
            .sort((a, b) => b.ts - a.ts);
          if (upstreamCommits.length > 0) triggerSha = upstreamCommits[0].sha;
          break;
        }
      }
    }

    // Foundation room dormancy boost
    if (FOUNDATION_ROOMS.has(room) && dormancyDays >= 14) {
      score += 5;
    }

    candidates.push({
      room,
      score,
      blocks_downstream: downstream,
      dormancy_days: dormancyDays,
      trigger_met: triggerMet,
      trigger_sha: triggerSha
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 3);
}

/**
 * Build the 12×12 grid colored-cells map. v0: diagonal cells (e.g. "A3,A3").
 * If a coordinate doesn't have a clear axis pair, fall back to a stable label.
 */
function buildGridMap(justCompleted, nextUp, roomMeta) {
  const map = {};
  const cellFor = (room) => {
    const coord = roomMeta[room]?.coordinate || '';
    // Pull RANK token (A1..C3) from the front of the coordinate string
    const m = coord.match(/^([A-C]\d)\b/);
    if (m) return `${m[1]},${m[1]}`;
    return coord || room;
  };
  justCompleted.forEach((c, i) => {
    map[`green_${i + 1}`] = cellFor(c.room);
  });
  nextUp.forEach((c, i) => {
    map[`amber_${i + 1}`] = cellFor(c.room);
  });
  return map;
}

/**
 * Build a wake-up-command for a next_up entry.
 * Cheap heuristic: probe the first owned-surface dir to see if there's a
 * recent artifact. Keeps the JSON useful without doing heavy I/O at call-time.
 */
function buildWakeUpCommand(room, surfaces) {
  const globs = surfaces[room]?.globs || [];
  const firstDir = globs.find(g => g.endsWith('/')) || globs[0] || '';
  if (!firstDir) return `echo "No owned surface declared for ${room}"`;
  const dir = firstDir.replace(/\/$/, '');
  return `test -d ${dir} && ls ${dir}/ 2>/dev/null | head -3`;
}

/**
 * Public entry: returns the full overview JSON.
 */
export function computeOverview(opts = {}) {
  const repoRoot = opts.repoRoot
    || findRepoRoot(process.cwd())
    || '/Users/thetacoach/GitHub/thetadrivencoach';

  const roomOrder = Object.values(HTML_TO_ROOM); // stable order
  const surfaces = buildRoomSurfaces(repoRoot);
  const meta = loadRoomMeta(repoRoot);
  const commits = loadRecentCommits(repoRoot, opts.daysBack || 14);

  // Filter: drop merge commits with no files
  const meaningful = commits.filter(c => c.files.length > 0);

  // Pre-fetch full commit bodies (subject + body + trailers) for the meaningful
  // commits so trailer-based attribution can run without per-commit shellouts.
  const bodies = loadCommitBodies(repoRoot, meaningful.map(c => c.shaFull));
  const ctx = { repoRoot, bodies };

  const justCompletedRaw = pickJustCompleted(meaningful, surfaces, roomOrder, ctx);
  const nextUpRaw = pickNextUp(meaningful, surfaces, roomOrder, justCompletedRaw, ctx);

  // Shape just_completed
  const just_completed = justCompletedRaw.map((c, i) => {
    const m = meta[c.room] || {};
    const coord = m.coordinate || '';
    const cellMatch = coord.match(/^([A-C]\d)\b/);
    const cell = cellMatch ? `${cellMatch[1]},${cellMatch[1]}` : coord;
    // Pick the owned-surface glob most reflected in this commit's files
    const globs = surfaces[c.room]?.globs || [];
    const regexes = surfaces[c.room]?.regexes || [];
    let bestGlob = globs[0] || '';
    let bestCount = 0;
    for (let g = 0; g < globs.length; g++) {
      const cnt = c.files.filter(f => regexes[g].test(f)).length;
      if (cnt > bestCount) { bestCount = cnt; bestGlob = globs[g]; }
    }
    return {
      rank: i + 1,
      room: c.room,
      emoji: m.emoji || '',
      coordinate: coord,
      cell,
      commit_sha: c.sha,
      commit_subject: c.subject,
      attribution_method: c.attribution_method || 'glob',
      artifacts: c.files.slice(0, 5),
      ts: new Date(c.ts * 1000).toISOString(),
      owned_surface_match: bestGlob
    };
  });

  // Shape next_up
  const next_up = nextUpRaw.map((n, i) => {
    const m = meta[n.room] || {};
    const coord = m.coordinate || '';
    const cellMatch = coord.match(/^([A-C]\d)\b/);
    const cell = cellMatch ? `${cellMatch[1]},${cellMatch[1]}` : coord;
    const reasons = [];
    if (n.blocks_downstream.length > 0) {
      reasons.push(`blocks ${n.blocks_downstream.length} downstream`);
    }
    if (n.trigger_met && n.trigger_sha) {
      reasons.push(`trigger met by ${n.trigger_sha}`);
    }
    if (n.dormancy_days >= 14 && FOUNDATION_ROOMS.has(n.room)) {
      reasons.push('foundation room dormant > 14d');
    } else if (n.dormancy_days > 0) {
      reasons.push(`dormant ${n.dormancy_days}d`);
    }
    return {
      rank: i + 1,
      room: n.room,
      emoji: m.emoji || '',
      coordinate: coord,
      cell,
      spin_up_status: n.trigger_met ? 'trigger_met' : 'independent',
      blocks_downstream: n.blocks_downstream,
      wake_up_command: buildWakeUpCommand(n.room, surfaces),
      owned_surface_globs: surfaces[n.room]?.globs || [],
      score_reason: reasons.join('; ') || `score ${n.score}`
    };
  });

  // Detect rooms with empty owned-surface (parser regression)
  const empty_surface_rooms = roomOrder.filter(
    r => (surfaces[r]?.globs || []).length === 0
  );

  return {
    computed_at: new Date().toISOString(),
    just_completed,
    next_up,
    grid_12x12_colored_cells: buildGridMap(just_completed, next_up, meta),
    ...(empty_surface_rooms.length > 0 ? { _warning_empty_surface_rooms: empty_surface_rooms } : {})
  };
}
