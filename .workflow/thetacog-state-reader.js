/**
 * ThetaCog State Reader v1.1.0
 *
 * Reads ~/.thetacog/state.json and renders dynamic content in HTML dashboards.
 * Include this script in any room HTML to get live todo/stream updates.
 *
 * Usage:
 *   <script src="thetacog-state-reader.js"></script>
 *   <div id="thetacog-todos"></div>
 *   <div id="thetacog-streams"></div>
 *
 * The script automatically:
 * - Loads state on page load
 * - Refreshes on tab focus (visibilitychange event)
 * - Renders todos sorted by priority
 * - Renders unread input streams from other rooms
 */

(function() {
  'use strict';

  // Configuration - detect room from embedded JSON or URL
  const roomMeta = document.getElementById('thetacog-room');
  const CURRENT_ROOM = roomMeta ? JSON.parse(roomMeta.textContent).room : detectRoomFromUrl();

  // State file path (relative to HTML location)
  const STATE_FILE = '../state.json';

  // Fallback: Try to detect room from filename
  function detectRoomFromUrl() {
    const path = window.location.pathname;
    const roomMap = {
      'iterm2-builder': 'builder',
      'vscode-architect': 'architect',
      'kitty-operator': 'operator',
      'wezterm-vault': 'vault',
      'terminal-voice': 'voice',
      'cursor-laboratory': 'laboratory',
      'alacritty-performer': 'performer',
      'rio-navigator': 'navigator',
      'messages-network': 'network'
    };

    for (const [file, room] of Object.entries(roomMap)) {
      if (path.includes(file)) return room;
    }
    return 'builder'; // default
  }

  // Room emoji mapping
  const ROOM_EMOJI = {
    builder: '🔨',
    architect: '📐',
    operator: '🎩',
    vault: '🔒',
    voice: '🎤',
    laboratory: '🧪',
    performer: '🎬',
    navigator: '🧭',
    network: '🌐'
  };

  // Load and render state
  async function loadState() {
    try {
      const response = await fetch(STATE_FILE);
      if (!response.ok) {
        console.log('[ThetaCog] No state.json found, using defaults');
        renderEmpty();
        return;
      }

      const state = await response.json();
      renderState(state);
    } catch (error) {
      console.log('[ThetaCog] Could not load state:', error.message);
      renderEmpty();
    }
  }

  // Render the state into HTML containers
  function renderState(state) {
    const roomData = state.rooms?.[CURRENT_ROOM];
    if (!roomData) {
      renderEmpty();
      return;
    }

    // Render todos
    const todosContainer = document.getElementById('thetacog-todos');
    if (todosContainer) {
      renderTodos(todosContainer, roomData.todos || []);
    }

    // Render input streams
    const streamsContainer = document.getElementById('thetacog-streams');
    if (streamsContainer) {
      renderStreams(streamsContainer, roomData.inputStreams || []);
    }

    // Update room indicator if present
    const roomIndicator = document.getElementById('thetacog-room-indicator');
    if (roomIndicator) {
      roomIndicator.innerHTML = `${ROOM_EMOJI[CURRENT_ROOM]} ${CURRENT_ROOM.toUpperCase()} | Last sync: ${new Date(state.exportedAt).toLocaleTimeString()}`;
    }
  }

  // Render todos list
  function renderTodos(container, todos) {
    if (todos.length === 0) {
      container.innerHTML = `
        <div class="thetacog-empty">
          <p>No todos yet. Add one via Claude:</p>
          <code>thetacog-todo add room="${CURRENT_ROOM}" text="Your task" priority=1</code>
        </div>
      `;
      return;
    }

    const html = todos
      .sort((a, b) => a.priority - b.priority)
      .map(todo => `
        <div class="thetacog-todo ${todo.done ? 'done' : ''}" data-id="${todo.id}">
          <span class="priority">P${todo.priority}</span>
          <span class="text">${escapeHtml(todo.text)}</span>
          ${todo.done ? '<span class="status">✓</span>' : ''}
        </div>
      `)
      .join('');

    container.innerHTML = `
      <div class="thetacog-todo-list">
        <h4>${ROOM_EMOJI[CURRENT_ROOM]} ${CURRENT_ROOM.toUpperCase()} TODOS (${todos.filter(t => !t.done).length} active)</h4>
        ${html}
      </div>
    `;
  }

  // Render input streams from other rooms
  function renderStreams(container, streams) {
    if (streams.length === 0) {
      container.innerHTML = `
        <div class="thetacog-empty">
          <p>No incoming messages from other rooms.</p>
        </div>
      `;
      return;
    }

    const html = streams.map(stream => `
      <div class="thetacog-stream" data-id="${stream.id}">
        <span class="from">${ROOM_EMOJI[stream.from_room] || '📨'} ${stream.from_room}</span>
        <span class="message">${escapeHtml(stream.message)}</span>
        <span class="time">${formatTime(stream.created_at)}</span>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="thetacog-stream-list">
        <h4>📥 INCOMING FROM OTHER ROOMS (${streams.length} unread)</h4>
        ${html}
      </div>
    `;
  }

  // Render empty state
  function renderEmpty() {
    const todosContainer = document.getElementById('thetacog-todos');
    if (todosContainer) {
      todosContainer.innerHTML = `
        <div class="thetacog-empty">
          <p>State not loaded. Use Claude to add todos:</p>
          <code>thetacog-todo add room="${CURRENT_ROOM}" text="Your task"</code>
        </div>
      `;
    }

    const streamsContainer = document.getElementById('thetacog-streams');
    if (streamsContainer) {
      streamsContainer.innerHTML = `
        <div class="thetacog-empty">
          <p>No flywheel messages yet.</p>
        </div>
      `;
    }
  }

  // Helper: escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Helper: format timestamp
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Inject default styles if not already present
  function injectStyles() {
    if (document.getElementById('thetacog-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'thetacog-styles';
    styles.textContent = `
      .thetacog-todo-list, .thetacog-stream-list {
        background: #1e293b;
        border-radius: 12px;
        padding: 20px;
        margin: 15px 0;
      }
      .thetacog-todo-list h4, .thetacog-stream-list h4 {
        color: #94a3b8;
        margin: 0 0 15px 0;
        font-size: 0.9em;
        letter-spacing: 0.5px;
      }
      .thetacog-todo {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid #334155;
        color: #e2e8f0;
      }
      .thetacog-todo:last-child { border-bottom: none; }
      .thetacog-todo.done { opacity: 0.5; text-decoration: line-through; }
      .thetacog-todo .priority {
        background: #3b82f6;
        color: white;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.8em;
        font-weight: bold;
      }
      .thetacog-todo .status { color: #22c55e; }
      .thetacog-stream {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid #334155;
        color: #e2e8f0;
      }
      .thetacog-stream:last-child { border-bottom: none; }
      .thetacog-stream .from {
        background: #6366f1;
        color: white;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.8em;
      }
      .thetacog-stream .time {
        color: #64748b;
        font-size: 0.8em;
        margin-left: auto;
      }
      .thetacog-empty {
        color: #64748b;
        font-style: italic;
        padding: 15px 0;
      }
      .thetacog-empty code {
        display: block;
        margin-top: 10px;
        background: #0f172a;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 0.85em;
        color: #22c55e;
      }
      #thetacog-room-indicator {
        background: rgba(0,0,0,0.3);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 0.9em;
        display: inline-block;
        margin: 10px 0;
      }
    `;
    document.head.appendChild(styles);
  }

  // Initialize
  function init() {
    injectStyles();
    loadState();

    // Refresh on tab focus
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('[ThetaCog] Tab focused, refreshing state...');
        loadState();
      }
    });

    // Also refresh every 30 seconds while visible
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadState();
      }
    }, 30000);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for manual refresh
  window.ThetaCog = { loadState, CURRENT_ROOM };
})();
