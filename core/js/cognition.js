// cognition.js
// Eva's optional internal cognitive layer.
//
// When enabled, a single user message goes through three role-specific
// agents before Eva replies:
//
//   conductor   plans the response and decides which capabilities apply
//   implementer drafts the user-facing answer (and, in the future, runs
//               registered actions via Cognition.capabilities)
//   reviewer    critiques the draft and either approves or requests
//               concrete revisions, bounded by maxCycles
//
// Each agent is a separate call to the bridge's /v1/aig/chat endpoint
// with its own model and system prompt. The user only ever sees the
// implementer's final, approved draft. Per-stage progress is reflected
// in the footer status line via setStatus().
//
// Capabilities (Cognition.capabilities) is a registry stub for future
// real-world actions: deal scrapers, bill payment, calendar writes,
// home-automation calls, etc. The framework is in place; individual
// capabilities will be added on the roadmap.

(function (global) {
  'use strict';

  var DEFAULT_PROMPTS = {
    conductor: [
      "You are Eva's Conductor agent.",
      "Your job is to plan how Eva should respond to the user.",
      "You do NOT write the user-facing answer yourself.",
      "Output a short plan covering: (1) what the user actually needs,",
      "(2) which capabilities or sources are required, (3) any risks,",
      "(4) the response shape (length, tone, structure).",
      "Be concise. Use plain prose or short bullets.",
      "Do not address the user directly."
    ].join(' '),

    implementer: [
      "You are Eva's Implementer agent.",
      "You produce the user-facing answer. Speak as Eva.",
      "Follow the conductor's plan when present.",
      "If the plan calls for an action you cannot yet perform (capability not registered),",
      "say so plainly and offer the best assistant-style answer instead.",
      "Be direct, accurate, and well-structured. Do not narrate the review process.",
      "Do not mention conductor, reviewer, or this multi-agent pipeline to the user."
    ].join(' '),

    reviewer: [
      "You are Eva's Reviewer agent.",
      "You critique the implementer's draft against the user's actual request.",
      "Check for accuracy, completeness, tone match, and avoidable failure modes",
      "(hallucinated facts, missed parts of the question, unsafe suggestions, leaked",
      "internal pipeline mentions).",
      "Always respond with a verdict line first:",
      "VERDICT: APPROVE  or  VERDICT: REQUEST_CHANGES",
      "If requesting changes, follow with concrete bullets. Do not rewrite the answer."
    ].join(' ')
  };

  function ls(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return (v == null) ? fallback : v;
    } catch (_) { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function getDefaultModel() {
    var el = document.getElementById('selAIGBackend');
    return (el && el.value) ? el.value : 'gpt-4.1';
  }

  function getCfg() {
    var def = getDefaultModel();
    return {
      enabled: ls('cogEnabled', '0') === '1',
      conductorModel:   ls('cogConductorModel', '')   || def,
      implementerModel: ls('cogImplementerModel', '') || def,
      reviewerModel:    ls('cogReviewerModel', '')    || def,
      maxCycles: Math.max(0, parseInt(ls('cogMaxCycles', '1'), 10) || 0),
      conductorPrompt:   ls('cogConductorPrompt', '')   || DEFAULT_PROMPTS.conductor,
      implementerPrompt: ls('cogImplementerPrompt', '') || DEFAULT_PROMPTS.implementer,
      reviewerPrompt:    ls('cogReviewerPrompt', '')    || DEFAULT_PROMPTS.reviewer,
      showTrace: ls('cogShowTrace', '0') === '1'
    };
  }

  function setCfg(partial) {
    if (!partial) return;
    var map = {
      enabled: 'cogEnabled',
      conductorModel: 'cogConductorModel',
      implementerModel: 'cogImplementerModel',
      reviewerModel: 'cogReviewerModel',
      maxCycles: 'cogMaxCycles',
      conductorPrompt: 'cogConductorPrompt',
      implementerPrompt: 'cogImplementerPrompt',
      reviewerPrompt: 'cogReviewerPrompt',
      showTrace: 'cogShowTrace'
    };
    Object.keys(partial).forEach(function (k) {
      if (!map[k]) return;
      var v = partial[k];
      if (typeof v === 'boolean') v = v ? '1' : '0';
      lsSet(map[k], String(v == null ? '' : v));
    });
  }

  function isEnabled() { return getCfg().enabled; }

  function bridgeUrl() {
    return (typeof getACPBridgeUrl === 'function') ? getACPBridgeUrl() : 'http://localhost:8888';
  }

  function authPat() {
    return (typeof getAuthKey === 'function') ? getAuthKey('GITHUB_PAT') : '';
  }

  function status(text, kind) {
    if (typeof setStatus === 'function') {
      setStatus(kind || 'info', text);
    }
  }

  // ---------------------------------------------------------------------------
  // Capability registry (future actions)
  // ---------------------------------------------------------------------------
  // Shape: { id: 'string', description: 'string', run: async function(args) }
  // The conductor receives the list of registered capability descriptions in
  // its system prompt so it can include them in the plan. The implementer
  // will (in a later iteration) be able to invoke them. For now this is a
  // stub so feature work has a stable contract.
  var capabilities = [];

  function registerCapability(spec) {
    if (!spec || !spec.id || typeof spec.run !== 'function') return false;
    // Replace existing with same id so reload is safe
    capabilities = capabilities.filter(function (c) { return c.id !== spec.id; });
    capabilities.push({
      id: String(spec.id),
      description: String(spec.description || ''),
      run: spec.run
    });
    return true;
  }

  function listCapabilities() { return capabilities.slice(); }

  function describeCapabilities() {
    if (!capabilities.length) return '(no capabilities registered yet)';
    return capabilities.map(function (c) {
      return '- ' + c.id + ': ' + c.description;
    }).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Bridge call primitive
  // ---------------------------------------------------------------------------
  async function callAgent(role, model, systemPrompt, conversation, taskMessage) {
    var url = bridgeUrl().replace(/\/+$/, '') + '/v1/aig/chat';
    var msgs = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(conversation) && conversation.length) {
      // Strip any prior system messages so each agent's framing is its own.
      msgs = msgs.concat(conversation.filter(function (m) { return m && m.role !== 'system'; }));
    }
    if (taskMessage) {
      msgs.push({ role: 'user', content: taskMessage });
    }
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: msgs,
        user_message: taskMessage || '',
        model: model,
        github_pat: authPat()
      })
    });
    if (!resp.ok) {
      var t = '';
      try { t = await resp.text(); } catch (_) {}
      throw new Error(role + ' (' + model + ') HTTP ' + resp.status + (t ? ': ' + t : ''));
    }
    var data = await resp.json();
    var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return { content: content, model: data.model || model };
  }

  function parseVerdict(text) {
    var s = String(text || '');
    var m = s.match(/VERDICT\s*:\s*(APPROVE|REQUEST[_\- ]?CHANGES|BLOCKED)/i);
    if (m) {
      var v = m[1].toUpperCase().replace(/[_\- ]/g, '_');
      if (v === 'APPROVE') return 'APPROVE';
      if (v === 'BLOCKED') return 'BLOCKED';
      return 'REQUEST_CHANGES';
    }
    if (/^\s*APPROVE\b/im.test(s)) return 'APPROVE';
    if (/^\s*BLOCKED\b/im.test(s)) return 'BLOCKED';
    return 'REQUEST_CHANGES';
  }

  // ---------------------------------------------------------------------------
  // Pipeline: conductor -> implementer -> (reviewer -> implementer)*
  // ---------------------------------------------------------------------------
  // opts:
  //   userMessage : string  (required) the raw user turn
  //   messages    : array   prior conversation [{role, content}, ...]
  //
  // returns: { content, trace, conductorModel, implementerModel, reviewerModel, cycles }
  async function run(opts) {
    opts = opts || {};
    var cfg = getCfg();
    var userMsg = String(opts.userMessage || '').trim();
    var convo = Array.isArray(opts.messages) ? opts.messages.slice() : [];
    var trace = [];
    var capDesc = describeCapabilities();

    // Stage 1: conductor produces the plan
    status('Eva thinking [conductor: ' + cfg.conductorModel + ']...');
    var conductorTask = [
      'User message:',
      userMsg,
      '',
      'Registered capabilities Eva can invoke (or empty if none):',
      capDesc,
      '',
      'Produce the plan now.'
    ].join('\n');
    var conductor = await callAgent(
      'conductor', cfg.conductorModel, cfg.conductorPrompt, convo, conductorTask
    );
    trace.push({ role: 'conductor', model: conductor.model, content: conductor.content });

    // Stage 2: implementer drafts the user-facing answer
    status('Eva drafting [implementer: ' + cfg.implementerModel + ']...');
    var draftTask = [
      'User message:',
      userMsg,
      '',
      'Conductor plan:',
      conductor.content,
      '',
      'Available capabilities:',
      capDesc,
      '',
      'Write the user-facing answer now. Speak as Eva.',
      'If the plan calls for actions that no registered capability can perform yet,',
      'say so plainly and provide the best assistant-style answer.'
    ].join('\n');
    var draft = await callAgent(
      'implementer', cfg.implementerModel, cfg.implementerPrompt, convo, draftTask
    );
    trace.push({ role: 'implementer', model: draft.model, content: draft.content });

    var current = draft.content;
    var cyclesUsed = 0;
    var lastVerdict = 'APPROVE';

    // Stage 3+: reviewer loop, bounded by cfg.maxCycles
    for (var cycle = 1; cycle <= cfg.maxCycles; cycle++) {
      cyclesUsed = cycle;
      status('Eva reviewing [reviewer: ' + cfg.reviewerModel + '] cycle ' + cycle + '/' + cfg.maxCycles + '...');
      var reviewTask = [
        'User message:',
        userMsg,
        '',
        'Conductor plan:',
        conductor.content,
        '',
        'Implementer draft:',
        current,
        '',
        'Review the draft. First line MUST be either:',
        'VERDICT: APPROVE',
        'VERDICT: REQUEST_CHANGES',
        'If requesting changes, follow with concrete bullet points.'
      ].join('\n');
      var review = await callAgent(
        'reviewer', cfg.reviewerModel, cfg.reviewerPrompt, convo, reviewTask
      );
      var verdict = parseVerdict(review.content);
      lastVerdict = verdict;
      trace.push({
        role: 'reviewer', model: review.model, content: review.content,
        cycle: cycle, verdict: verdict
      });
      if (verdict === 'APPROVE' || verdict === 'BLOCKED') break;

      // Implementer revises against reviewer feedback
      status('Eva revising [implementer: ' + cfg.implementerModel + '] cycle ' + cycle + '...');
      var reviseTask = [
        'User message:',
        userMsg,
        '',
        'Previous draft:',
        current,
        '',
        'Reviewer feedback:',
        review.content,
        '',
        'Produce the revised final answer for the user. Apply the reviewer\'s concrete points.',
        'Do not mention the review process or any internal pipeline.'
      ].join('\n');
      var revised = await callAgent(
        'implementer', cfg.implementerModel, cfg.implementerPrompt, convo, reviseTask
      );
      trace.push({
        role: 'implementer', model: revised.model, content: revised.content,
        cycle: cycle, revised: true
      });
      current = revised.content;
    }

    return {
      content: current,
      trace: trace,
      conductorModel: conductor.model,
      implementerModel: draft.model,
      reviewerModel: cfg.reviewerModel,
      cycles: cyclesUsed,
      lastVerdict: lastVerdict
    };
  }

  // ---------------------------------------------------------------------------
  // Trace rendering helper (optional, off by default)
  // ---------------------------------------------------------------------------
  function renderTraceHtml(trace) {
    if (!Array.isArray(trace) || !trace.length) return '';
    var esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    var parts = ['<details class="cog-trace"><summary>Cognition trace (',
                 String(trace.length), ' steps)</summary>'];
    trace.forEach(function (step, i) {
      var label = (step.role || 'step') +
                  (step.cycle ? ' #' + step.cycle : '') +
                  (step.revised ? ' (revised)' : '') +
                  (step.verdict ? ' [' + step.verdict + ']' : '');
      parts.push('<div class="cog-step"><div class="cog-step-head">' +
                 esc(label) + ' <span class="cog-step-model">' +
                 esc(step.model || '') + '</span></div>' +
                 '<pre class="cog-step-body">' + esc(step.content) + '</pre></div>');
    });
    parts.push('</details>');
    return parts.join('');
  }

  global.Cognition = {
    run: run,
    isEnabled: isEnabled,
    getCfg: getCfg,
    setCfg: setCfg,
    DEFAULT_PROMPTS: DEFAULT_PROMPTS,
    registerCapability: registerCapability,
    listCapabilities: listCapabilities,
    describeCapabilities: describeCapabilities,
    renderTraceHtml: renderTraceHtml
  };
})(window);
