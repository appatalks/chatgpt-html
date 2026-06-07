// browser-agent.js
// Eva's vision browser agent: frontend controller + floating, Eva-themed popup.
//
// Talks to the ACP bridge endpoints:
//   POST /v1/browser/run        -> { id, status, ... }
//   GET  /v1/browser/status     -> run status snapshot
//   GET  /v1/browser/screenshot -> latest PNG for the run
//   POST /v1/browser/confirm    -> approve/answer a parked run
//   POST /v1/browser/cancel     -> stop a run
//
// Public API (window.EvaBrowser):
//   launch(goal, opts)  -> starts a run and opens the popup
//   isActive()          -> true while a run is being tracked
//
// Designed to be extensible: the popup is a generic "Eva activity window" we can
// reuse for future visual tasks. Keep new run types flowing through launch().

(function (global) {
  'use strict';

  var POLL_MS = 1200;
  var _state = {
    runId: null,
    poll: null,
    status: null,
    shotTick: 0,
    endpoint: '/v1/browser',   // bridge path prefix for the active run type
    title: 'Browser Agent',
    onComplete: null,          // fired once when a run reaches a terminal state
    completed: false
  };

  // --- Bridge helpers -------------------------------------------------------

  function bridgeBase() {
    if (typeof getSafeBridgeBaseUrl === 'function') return getSafeBridgeBaseUrl();
    return 'http://localhost:8888';
  }

  function openaiKey() {
    if (typeof getAuthKey === 'function') return getAuthKey('OPENAI_API_KEY') || '';
    return (global.OPENAI_API_KEY || '');
  }

  function setChatStatus(type, text) {
    if (typeof setStatus === 'function') setStatus(type, text);
  }

  // --- Popup construction ---------------------------------------------------

  function ensurePopup() {
    var el = document.getElementById('evaBrowserPopup');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'evaBrowserPopup';
    el.className = 'eva-browser-popup';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Eva browser agent');
    el.innerHTML = [
      '<div class="ebp-titlebar" id="ebpTitlebar">',
      '  <span class="ebp-dot"></span>',
      '  <span class="ebp-title">Eva &middot; Browser Agent</span>',
      '  <span class="ebp-step" id="ebpStep"></span>',
      '  <button class="ebp-close" id="ebpClose" type="button" aria-label="Close">&times;</button>',
      '</div>',
      '<div class="ebp-goal" id="ebpGoal"></div>',
      '<div class="ebp-stage">',
      '  <img class="ebp-shot" id="ebpShot" alt="Browser view" />',
      '  <div class="ebp-shot-empty" id="ebpShotEmpty">Waiting for the first screenshot&hellip;</div>',
      '</div>',
      '<div class="ebp-subgoal" id="ebpSubgoal"></div>',
      '<div class="ebp-statusrow">',
      '  <span class="ebp-badge" id="ebpBadge">starting</span>',
      '  <span class="ebp-url" id="ebpUrl"></span>',
      '</div>',
      '<div class="ebp-prompt" id="ebpPrompt" hidden>',
      '  <div class="ebp-prompt-text" id="ebpPromptText"></div>',
      '  <input class="ebp-input" id="ebpInput" type="text" placeholder="Type your answer&hellip;" hidden />',
      '  <div class="ebp-prompt-actions" id="ebpPromptActions"></div>',
      '</div>',
      '<div class="ebp-footer">',
      '  <button class="ebp-btn ebp-stop" id="ebpStop" type="button">Stop</button>',
      '</div>'
    ].join('');

    document.body.appendChild(el);

    document.getElementById('ebpClose').addEventListener('click', closePopup);
    document.getElementById('ebpStop').addEventListener('click', stopRun);
    document.getElementById('ebpShot').addEventListener('error', function () {
      this.style.visibility = 'hidden';
      var empty = document.getElementById('ebpShotEmpty');
      if (empty) empty.hidden = false;
    });
    document.getElementById('ebpShot').addEventListener('load', function () {
      this.style.visibility = 'visible';
      var empty = document.getElementById('ebpShotEmpty');
      if (empty) empty.hidden = true;
    });

    makeDraggable(el, document.getElementById('ebpTitlebar'));
    return el;
  }

  function makeDraggable(panel, handle) {
    var ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', function (e) {
      if (e.target && e.target.id === 'ebpClose') return;
      dragging = true;
      var rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - ox));
      var y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    });
    document.addEventListener('mouseup', function () {
      dragging = false;
      document.body.style.userSelect = '';
    });
  }

  function closePopup() {
    stopPolling();
    var el = document.getElementById('evaBrowserPopup');
    if (el) el.remove();
    _state.runId = null;
    _state.status = null;
  }

  // --- Rendering ------------------------------------------------------------

  var BADGE_LABELS = {
    starting: 'starting',
    running: 'working',
    awaiting_confirmation: 'needs approval',
    awaiting_input: 'needs input',
    done: 'done',
    cancelled: 'stopped',
    error: 'error'
  };

  function render(status) {
    if (!status) return;
    _state.status = status;
    ensurePopup();

    var goalEl = document.getElementById('ebpGoal');
    if (goalEl) goalEl.textContent = status.goal || '';

    var stepEl = document.getElementById('ebpStep');
    if (stepEl) stepEl.textContent = status.step != null ? ('step ' + status.step) : '';

    var subEl = document.getElementById('ebpSubgoal');
    if (subEl) subEl.textContent = status.subgoal ? ('Plan: ' + status.subgoal) : '';

    var urlEl = document.getElementById('ebpUrl');
    if (urlEl) urlEl.textContent = status.title || status.url || status.active_app || status.screen || '';

    var badge = document.getElementById('ebpBadge');
    if (badge) {
      badge.textContent = BADGE_LABELS[status.status] || status.status;
      badge.setAttribute('data-state', status.status);
    }

    refreshShot(status);
    renderPrompt(status);
    renderFooter(status);
  }

  function refreshShot(status) {
    // Refresh the screenshot whenever the step advances or we are mid-run.
    var img = document.getElementById('ebpShot');
    if (!img) return;
    var live = (status.status === 'running' || status.status === 'starting' ||
                status.status === 'awaiting_confirmation' || status.status === 'awaiting_input' ||
                status.status === 'done');
    if (!live) return;
    var url = bridgeBase() + _state.endpoint + '/screenshot?run_id=' +
              encodeURIComponent(status.id) + '&t=' + (_state.shotTick++);
    img.src = url;
  }

  function renderPrompt(status) {
    var wrap = document.getElementById('ebpPrompt');
    var textEl = document.getElementById('ebpPromptText');
    var input = document.getElementById('ebpInput');
    var actions = document.getElementById('ebpPromptActions');
    if (!wrap) return;
    actions.innerHTML = '';

    if (status.status === 'awaiting_confirmation') {
      wrap.hidden = false;
      input.hidden = true;
      var act = status.pending_action || {};
      var reason = act.reason || act.action || 'a sensitive action';
      textEl.textContent = 'Eva wants to: ' + reason + '. Approve?';
      addBtn(actions, 'Approve', 'ebp-approve', function () {
        confirmRun(true, '');
      });
      addBtn(actions, 'Decline', 'ebp-decline', function () {
        confirmRun(false, '');
      });
    } else if (status.status === 'awaiting_input') {
      wrap.hidden = false;
      input.hidden = false;
      textEl.textContent = status.pending_question || 'Eva needs input.';
      addBtn(actions, 'Send', 'ebp-approve', function () {
        var v = input.value;
        input.value = '';
        confirmRun(true, v);
      });
    } else {
      wrap.hidden = true;
      input.hidden = true;
      textEl.textContent = '';
    }
  }

  function renderFooter(status) {
    var stop = document.getElementById('ebpStop');
    if (!stop) return;
    var terminal = (status.status === 'done' || status.status === 'cancelled' || status.status === 'error');
    if (terminal) {
      stop.textContent = 'Close';
      stop.classList.add('ebp-done');
      stop.onclick = closePopup;
      if (status.result) {
        var sub = document.getElementById('ebpSubgoal');
        if (sub) sub.textContent = status.result;
      } else if (status.error) {
        var subE = document.getElementById('ebpSubgoal');
        if (subE) subE.textContent = 'Error: ' + status.error;
      }
    } else {
      stop.textContent = 'Stop';
      stop.classList.remove('ebp-done');
      stop.onclick = stopRun;
    }
  }

  function addBtn(parent, label, cls, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ebp-btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    parent.appendChild(b);
  }

  // --- Network actions ------------------------------------------------------

  async function launch(goal, opts) {
    opts = opts || {};
    goal = (goal || '').trim();
    _state.endpoint = opts.endpoint || '/v1/browser';
    _state.title = opts.title || 'Browser Agent';
    _state.onComplete = (typeof opts.onComplete === 'function') ? opts.onComplete : null;
    _state.completed = false;
    if (!goal) {
      setChatStatus('error', _state.title + ': no goal provided.');
      return;
    }
    var key = openaiKey();
    if (!key) {
      setChatStatus('error', _state.title + ' needs an OpenAI key (Settings > Auth).');
      return;
    }

    closePopup(); // one run at a time
    ensurePopup();
    _applyTitle();
    render({ id: '', goal: goal, status: 'starting', step: 0 });

    var body = {
      goal: goal,
      openai_api_key: key,
      autonomy: opts.autonomy || 'pause',
      use_director: opts.use_director !== false
    };
    if (opts.start_url) body.start_url = opts.start_url;
    if (opts.vision_model) body.vision_model = opts.vision_model;
    if (opts.max_steps) body.max_steps = opts.max_steps;

    try {
      var resp = await fetch(bridgeBase() + _state.endpoint + '/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var data = await resp.json();
      if (!resp.ok) {
        var msg = (data && data.error && data.error.message) || ('HTTP ' + resp.status);
        setChatStatus('error', _state.title + ': ' + msg);
        render({ id: '', goal: goal, status: 'error', error: msg });
        return;
      }
      _state.runId = data.id;
      render(data);
      startPolling();
      setChatStatus('info', _state.title + ' started.');
    } catch (e) {
      setChatStatus('error', _state.title + ' could not reach the bridge.');
      render({ id: '', goal: goal, status: 'error', error: String(e) });
    }
  }

  function _applyTitle() {
    var t = document.querySelector('#evaBrowserPopup .ebp-title');
    if (t) t.innerHTML = 'Eva &middot; ' + _state.title;
  }

  function startPolling() {
    stopPolling();
    _state.poll = setInterval(pollOnce, POLL_MS);
    pollOnce();
  }

  function stopPolling() {
    if (_state.poll) {
      clearInterval(_state.poll);
      _state.poll = null;
    }
  }

  async function pollOnce() {
    if (!_state.runId) return;
    try {
      var resp = await fetch(bridgeBase() + _state.endpoint + '/status?run_id=' +
        encodeURIComponent(_state.runId), { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return;
      var status = await resp.json();
      render(status);
      if (status.status === 'done' || status.status === 'cancelled' || status.status === 'error') {
        stopPolling();
        // Fire the completion hook exactly once so the caller (Eva) can become
        // aware of the actual outcome and acknowledge it.
        if (!_state.completed) {
          _state.completed = true;
          if (typeof _state.onComplete === 'function') {
            try { _state.onComplete(status, _state.endpoint, _state.title); } catch (e) {}
          }
        }
      }
    } catch (e) {
      // transient; keep polling
    }
  }

  async function confirmRun(approve, text) {
    if (!_state.runId) return;
    try {
      await fetch(bridgeBase() + _state.endpoint + '/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: _state.runId, approve: approve, text: text || '' })
      });
      // optimistic: hide the prompt until next poll
      var wrap = document.getElementById('ebpPrompt');
      if (wrap) wrap.hidden = true;
      pollOnce();
    } catch (e) {
      setChatStatus('error', 'Browser agent: could not send confirmation.');
    }
  }

  async function stopRun() {
    if (!_state.runId) { closePopup(); return; }
    try {
      await fetch(bridgeBase() + _state.endpoint + '/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: _state.runId })
      });
      pollOnce();
    } catch (e) {
      closePopup();
    }
  }

  function isActive() {
    return !!_state.runId;
  }

  global.EvaBrowser = {
    launch: launch,
    isActive: isActive,
    close: closePopup
  };

  // Desktop ('computer use') agent reuses the same popup + controller, pointed
  // at the bridge's /v1/desktop endpoints.
  global.EvaDesktop = {
    launch: function (goal, opts) {
      opts = opts || {};
      opts.endpoint = '/v1/desktop';
      opts.title = opts.title || 'Desktop Agent';
      return launch(goal, opts);
    },
    isActive: isActive,
    close: closePopup
  };

})(typeof window !== 'undefined' ? window : this);
