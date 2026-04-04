// sessions.js — Session persistence and explorer panel
// Stores chat sessions in localStorage so conversations survive page refresh.

var SESSION_INDEX_KEY = 'eva_sessions';
var SESSION_ACTIVE_KEY = 'eva_active_session';

// All provider message keys
var SESSION_MSG_KEYS = ['messages', 'copilotMessages', 'copilotACPMessages', 'geminiMessages', 'openLLMessages', 'aigMessages'];

function _getSessionIndex() {
  try { return JSON.parse(localStorage.getItem(SESSION_INDEX_KEY)) || []; }
  catch(e) { return []; }
}

function _saveSessionIndex(index) {
  localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(index));
}

function _activeSessionId() {
  return localStorage.getItem(SESSION_ACTIVE_KEY) || null;
}

/** Snapshot current conversation state into a session object */
function _snapshotSession() {
  var data = {};
  SESSION_MSG_KEYS.forEach(function(key) {
    var raw = localStorage.getItem(key);
    if (raw) data[key] = raw;
  });
  data._masterOutput = localStorage.getItem('masterOutput') || '';
  data._model = (document.getElementById('selModel') || {}).value || '';
  data._htmlSnapshot = (document.getElementById('txtOutput') || {}).innerHTML || '';
  return data;
}

/** Restore a session snapshot into localStorage and DOM */
function _restoreSession(data) {
  // Clear existing messages
  SESSION_MSG_KEYS.forEach(function(key) { localStorage.removeItem(key); });
  localStorage.removeItem('masterOutput');

  // Write stored keys back
  Object.keys(data).forEach(function(key) {
    if (key.charAt(0) === '_') return; // skip meta keys
    localStorage.setItem(key, data[key]);
  });
  if (data._masterOutput) {
    localStorage.setItem('masterOutput', data._masterOutput);
    if (typeof masterOutput !== 'undefined') masterOutput = data._masterOutput;
  }

  // Restore DOM
  var txtOutput = document.getElementById('txtOutput');
  if (txtOutput && data._htmlSnapshot) {
    txtOutput.innerHTML = data._htmlSnapshot;
    txtOutput.scrollTop = txtOutput.scrollHeight;
  }

  // Restore model selection
  if (data._model) {
    var sel = document.getElementById('selModel');
    if (sel) {
      sel.value = data._model;
      if (typeof updateButton === 'function') updateButton();
    }
  }
}

/** Derive a display name from the first user message */
function _sessionTitle(data) {
  for (var i = 0; i < SESSION_MSG_KEYS.length; i++) {
    var raw = data[SESSION_MSG_KEYS[i]];
    if (!raw) continue;
    try {
      var msgs = JSON.parse(raw);
      for (var j = 0; j < msgs.length; j++) {
        if (msgs[j].role === 'user') {
          var txt = typeof msgs[j].content === 'string' ? msgs[j].content : '';
          if (!txt && Array.isArray(msgs[j].content)) {
            msgs[j].content.forEach(function(p) { if (p.text) txt += p.text; });
          }
          txt = txt.replace(/<[^>]+>/g, '').replace(/[<>]/g, '').trim();
          if (txt) return txt.length > 50 ? txt.substring(0, 47) + '...' : txt;
        }
      }
    } catch(e) {}
  }
  return 'Untitled';
}

/** Count user messages in a snapshot */
function _sessionMsgCount(data) {
  var count = 0;
  SESSION_MSG_KEYS.forEach(function(key) {
    try {
      var msgs = JSON.parse(data[key] || '[]');
      msgs.forEach(function(m) { if (m.role === 'user') count++; });
    } catch(e) {}
  });
  return count;
}

/** Auto-save the current session (call on every send and periodically) */
function saveCurrentSession() {
  var snapshot = _snapshotSession();
  // Only save if there's actual content
  if (_sessionMsgCount(snapshot) === 0) return;

  var id = _activeSessionId();
  var index = _getSessionIndex();

  if (!id) {
    // First save — create a new session
    id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    localStorage.setItem(SESSION_ACTIVE_KEY, id);
    index.unshift({ id: id, title: _sessionTitle(snapshot), created: Date.now(), updated: Date.now() });
  } else {
    // Update existing
    for (var i = 0; i < index.length; i++) {
      if (index[i].id === id) {
        index[i].title = _sessionTitle(snapshot);
        index[i].updated = Date.now();
        break;
      }
    }
  }

  localStorage.setItem('session_' + id, JSON.stringify(snapshot));
  _saveSessionIndex(index);
  renderSessionList();
}

/** Start a brand new session */
function newSession() {
  // Auto-save current first
  saveCurrentSession();

  // Clear active
  localStorage.removeItem(SESSION_ACTIVE_KEY);
  SESSION_MSG_KEYS.forEach(function(key) { localStorage.removeItem(key); });
  localStorage.removeItem('masterOutput');
  if (typeof masterOutput !== 'undefined') masterOutput = '';
  if (typeof lastResponse !== 'undefined') lastResponse = '';

  var txtOutput = document.getElementById('txtOutput');
  if (txtOutput) {
    if (typeof showWelcome === 'function') showWelcome();
    else txtOutput.innerHTML = '';
  }

  renderSessionList();
}

/** Load a session by id */
function loadSession(id) {
  // Save current first
  saveCurrentSession();

  var raw = localStorage.getItem('session_' + id);
  if (!raw) return;

  try {
    var data = JSON.parse(raw);
    _restoreSession(data);
    localStorage.setItem(SESSION_ACTIVE_KEY, id);
    renderSessionList();
  } catch(e) {
    console.error('Failed to load session:', e);
  }
}

/** Delete a session */
function deleteSession(id) {
  var index = _getSessionIndex();
  index = index.filter(function(s) { return s.id !== id; });
  _saveSessionIndex(index);
  localStorage.removeItem('session_' + id);

  // If deleting the active session, start fresh
  if (_activeSessionId() === id) {
    localStorage.removeItem(SESSION_ACTIVE_KEY);
  }
  renderSessionList();
}

/** Render the session list in the panel */
function renderSessionList() {
  var ul = document.getElementById('sessionList');
  if (!ul) return;

  var index = _getSessionIndex();
  var activeId = _activeSessionId();

  ul.innerHTML = '';

  if (index.length === 0) {
    ul.innerHTML = '<li class="session-empty">No saved sessions</li>';
    return;
  }

  index.forEach(function(entry) {
    var li = document.createElement('li');
    li.className = 'session-item' + (entry.id === activeId ? ' active' : '');

    var titleSpan = document.createElement('span');
    titleSpan.className = 'session-title';
    titleSpan.textContent = entry.title || 'Untitled';
    titleSpan.title = entry.title || 'Untitled';

    var timeSpan = document.createElement('span');
    timeSpan.className = 'session-time';
    var d = new Date(entry.updated || entry.created);
    timeSpan.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

    var delBtn = document.createElement('button');
    delBtn.className = 'session-delete';
    delBtn.textContent = '\u00d7';
    delBtn.title = 'Delete session';
    delBtn.onclick = function(e) {
      e.stopPropagation();
      deleteSession(entry.id);
    };

    li.appendChild(titleSpan);
    li.appendChild(timeSpan);
    li.appendChild(delBtn);
    li.onclick = function() { loadSession(entry.id); };

    ul.appendChild(li);
  });
}

/** Toggle the session panel visibility */
function toggleSessionPanel() {
  var panel = document.getElementById('sessionPanel');
  if (!panel) return;
  var visible = panel.getAttribute('aria-hidden') !== 'true';
  panel.setAttribute('aria-hidden', visible ? 'true' : 'false');
  if (!visible) renderSessionList();
}

/** Wire up session panel buttons + auto-save on page unload */
function initSessions() {
  // Button bindings
  var sessBtn = document.getElementById('sidebarSessionsBtn');
  if (sessBtn) sessBtn.addEventListener('click', toggleSessionPanel);

  var closeBtn = document.getElementById('sessionPanelClose');
  if (closeBtn) closeBtn.addEventListener('click', toggleSessionPanel);

  var newBtn = document.getElementById('sessionNewBtn');
  if (newBtn) newBtn.addEventListener('click', function() { newSession(); });

  // Restore active session on page load
  var activeId = _activeSessionId();
  if (activeId) {
    var raw = localStorage.getItem('session_' + activeId);
    if (raw) {
      try { _restoreSession(JSON.parse(raw)); } catch(e) {}
    }
  }

  // Auto-save on unload
  window.addEventListener('beforeunload', function() {
    saveCurrentSession();
  });

  // Periodic auto-save every 30s
  setInterval(saveCurrentSession, 30000);

  renderSessionList();
}
