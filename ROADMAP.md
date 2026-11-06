# ThetaCog MCP Roadmap

## Current State (v1.0.7)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CURRENT ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Claude     │───▶│   SQLite     │───▶│  state.json  │      │
│  │   (MCP)      │    │ thetacog.db  │    │   export     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                 │               │
│                                                 ▼               │
│                                          ┌──────────────┐      │
│                                          │  HTML Files  │      │
│                                          │ (static, no  │      │
│                                          │  JSON read)  │      │
│                                          └──────────────┘      │
│                                                                 │
│  PROBLEM: HTML files don't actually read state.json yet!        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### What Works
- 8 MCP tools: detect, status, switch, open, todo, stream, export, terminal
- 9 cognitive rooms defined in server.js
- SQLite persistence at ~/.thetacog/thetacog.db
- JSON export to ~/.thetacog/state.json
- Terminal detection via TERM_PROGRAM

### What's Missing
- HTML dashboards don't read state.json (they're static)
- No live todo display in dashboards
- No flywheel stream display
- No cross-machine sync

---

## Target State (v1.1.0)

```
┌─────────────────────────────────────────────────────────────────┐
│                     TARGET ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Claude     │───▶│   SQLite     │───▶│  state.json  │      │
│  │   (MCP)      │    │ thetacog.db  │    │   export     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                 │               │
│                                                 ▼               │
│                                          ┌──────────────┐      │
│                                          │  HTML Files  │      │
│                                          │ visibilitychange    │
│                                          │ reads state.json    │
│                                          │ renders todos/      │
│                                          │ streams live        │
│                                          └──────────────┘      │
│                                                                 │
│  SOLUTION: Add thetacog-state-reader.js to all HTML files       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Target State (v1.2.0 - Cloud Sync)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLOUD SYNC ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Claude     │───▶│   SQLite     │◀──▶│  Supabase    │      │
│  │   (MCP)      │    │ thetacog.db  │    │  (optional)  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                             │                    │              │
│                             ▼                    │              │
│                      ┌──────────────┐            │              │
│                      │  state.json  │            │              │
│                      └──────────────┘            │              │
│                             │                    │              │
│                             ▼                    ▼              │
│                      ┌──────────────┐    ┌──────────────┐      │
│                      │  HTML Files  │    │ thetacoach   │      │
│                      │  (local)     │    │ .biz/thetacog│      │
│                      └──────────────┘    └──────────────┘      │
│                                                                 │
│  FREE TIER: Local SQLite + JSON + HTML (works offline)          │
│  CLOUD TIER ($1/mo): + Supabase sync + Web dashboard            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: JSON → HTML Rendering (v1.1.0) ✅ IN PROGRESS

1. **Create `thetacog-state-reader.js`**
   - Reads `~/.thetacog/state.json` on visibilitychange
   - Renders todos into `#thetacog-todos` container
   - Renders input streams into `#thetacog-streams` container
   - Shows current room indicator

2. **Update HTML dashboards**
   - Add state reader script to all 9 room HTMLs
   - Add container divs for dynamic content
   - Style todo list and stream display

3. **File access challenge**
   - Browser can't read local files directly (security)
   - Options:
     a. Use `file://` protocol (works for local HTML files)
     b. Embed JSON in HTML via postinstall script
     c. Use a tiny local server (overkill for this)
   - **Decision:** Option (b) - postinstall regenerates HTML with embedded state

### Phase 2: Cloud Sync (v1.2.0)

1. **Add Supabase tables**
   ```sql
   CREATE TABLE thetacog_rooms (
     user_id UUID REFERENCES auth.users,
     room TEXT,
     todos JSONB,
     streams JSONB,
     updated_at TIMESTAMPTZ
   );
   ```

2. **Sync logic in server.js**
   - On write: SQLite first, then Supabase if configured
   - On startup: Pull from Supabase if newer than local
   - Conflict resolution: Last-write-wins with timestamps

3. **Web dashboard at thetadriven.com/thetacog**
   - Same layout as local HTML
   - Reads directly from Supabase
   - Real-time updates via Supabase subscriptions

---

## Room Configurations (All 9)

| Room | Emoji | Color | Terminal | Tier |
|------|-------|-------|----------|------|
| builder | 🔨 | #3b82f6 (Blue) | iTerm2 | tactical |
| architect | 📐 | #4f46e5 (Indigo) | VS Code | strategic |
| operator | 🎩 | #22c55e (Green) | Kitty | strategic |
| vault | 🔒 | #ef4444 (Red) | WezTerm | foundational |
| voice | 🎤 | #a855f7 (Purple) | Terminal | tactical |
| laboratory | 🧪 | #06b6d4 (Cyan) | Cursor | tactical |
| performer | 🎬 | #f59e0b (Amber) | Alacritty | performance |
| navigator | 🧭 | #0d9488 (Teal) | Rio | exploration |
| network | 🌐 | #6366f1 (Indigo) | Messages | communication |

---

## Data Flow Summary

```
USER ACTION          MCP TOOL              STORAGE           DISPLAY
─────────────────────────────────────────────────────────────────────
"Add todo"     →  thetacog-todo add   →  SQLite + JSON  →  HTML refresh
"Send stream"  →  thetacog-stream     →  SQLite + JSON  →  HTML refresh
"Switch room"  →  thetacog-switch     →  SQLite + JSON  →  HTML refresh
"Get status"   →  thetacog-status     →  (read only)    →  Terminal output
Tab focus      →  (browser event)     →  Read JSON      →  HTML refresh
```

---

## Next Actions

- [x] Fix tool schemas for all 9 rooms
- [x] Fix exportStateToJson for all 9 rooms
- [x] Sync version numbers
- [x] Update README with 9 rooms
- [x] Create thetacog-state-reader.js (embedded in HTML)
- [x] Update postinstall.js to create initial state.json
- [x] Add todo/stream containers to rio-navigator.html
- [x] Test full data flow with embedded state
- [ ] Add state reader to remaining 8 room HTMLs
- [ ] Publish v1.1.0 to npm

---

## Current Implementation Status (2026-02-10)

### Completed
```
✅ server.js - All 9 rooms in tool schemas + export
✅ README.md - Updated to show 9 rooms
✅ CHANGELOG.md - Documented v1.1.0 changes
✅ postinstall.js - Creates initial state.json, detects Rio
✅ rio-navigator.html - Full state reader implementation
✅ ROADMAP.md - Architecture documentation
✅ thetacog-state-reader.js - Reusable script created
```

### Data Flow (Working)
```
1. Claude calls thetacog-todo/stream → SQLite write
2. Every write triggers exportStateToJson() → state.json
3. HTML has embedded state OR reads state.json on focus
4. visibilitychange event refreshes display
```

### File Locations
```
Development:
  .workflow/rooms/rio-navigator.html  ← Has state reader
  .workflow/rooms/state.json          ← Symlink to ~/.thetacog/state.json
  .workflow/state.json                ← Copy for parent paths

Production (npm install):
  ~/.thetacog/state.json              ← Created by postinstall
  ~/.thetacog/*.html                  ← Copied from package
```
