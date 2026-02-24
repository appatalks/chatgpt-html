// Javascript for Options
// 

// Global Variables
var lastResponse = "";
var userMasterResponse = "";
var aiMasterResponse = "";
var masterOutput = "";
var storageAssistant = "";
var imgSrcGlobal; // Declare a global variable for img.src
// Debug/CORS flags (from config.json)
var DEBUG_CORS = false;
var DEBUG_PROXY_URL = "";

// Error Handling Variables
var retryCount = 0;
var maxRetries = 5;
var retryDelay = 2420; // milliseconds

// API Access[OpenAI, AWS] 
function auth() {
  // Prefer inlined local config if provided (config.local.js)
  if (typeof window !== 'undefined' && window.__LOCAL_CONFIG__) {
    const config = window.__LOCAL_CONFIG__;
    applyConfig(config);
    return;
  }

  // Fallback: fetch config.json (requires http(s) server)
  if (location.protocol === 'file:') {
    console.warn('Running from file://, unable to fetch config.json due to browser security. Create config.local.js or serve over http.');
  }

  fetch('./config.json')
    .then(response => response.json())
    .then(config => applyConfig(config))
    .catch(err => {
      console.error('Failed to load config:', err);
      document.getElementById('idText').innerText = 'Config not loaded. Use config.local.js or run a local server.';
    });
}

function applyConfig(config) {
  OPENAI_API_KEY = config.OPENAI_API_KEY;
  // Google Gemini key if provided
  GOOGLE_GL_KEY = config.GOOGLE_GL_KEY;
  GOOGLE_VISION_KEY = config.GOOGLE_VISION_KEY;
  // GitHub Copilot PAT
  if (config.GITHUB_PAT) GITHUB_PAT = config.GITHUB_PAT;
  // CORS debug
  DEBUG_CORS = !!config.DEBUG_CORS;
  DEBUG_PROXY_URL = config.DEBUG_PROXY_URL || "";
  AWS.config.region = config.AWS_REGION;
  AWS.config.credentials = new AWS.Credentials(config.AWS_ACCESS_KEY_ID, config.AWS_SECRET_ACCESS_KEY);
  // Apply any localStorage auth overrides
  loadAuthOverrides();
}

// --- Auth Key Management ---
function getAuthKey(key) {
  var stored = localStorage.getItem('auth_' + key);
  if (stored) return stored;
  if (typeof window[key] !== 'undefined') return window[key];
  return '';
}

function loadAuthOverrides() {
  var keys = ['OPENAI_API_KEY', 'GOOGLE_GL_KEY', 'GOOGLE_VISION_KEY', 'GITHUB_PAT'];
  keys.forEach(function(key) {
    var val = localStorage.getItem('auth_' + key);
    if (val) window[key] = val;
  });
}

function saveAuthKeys() {
  var map = {
    'authOpenAI': 'OPENAI_API_KEY',
    'authGitHub': 'GITHUB_PAT',
    'authGemini': 'GOOGLE_GL_KEY',
    'authGoogleVision': 'GOOGLE_VISION_KEY'
  };
  Object.keys(map).forEach(function(fieldId) {
    var el = document.getElementById(fieldId);
    var key = map[fieldId];
    if (el && el.value.trim()) {
      localStorage.setItem('auth_' + key, el.value.trim());
      window[key] = el.value.trim();
    } else if (el) {
      localStorage.removeItem('auth_' + key);
    }
  });
  // Save ACP Bridge URL separately
  var acpEl = document.getElementById('txtACPBridgeUrl');
  if (acpEl && acpEl.value.trim()) {
    localStorage.setItem('acp_bridge_url', acpEl.value.trim());
  } else if (acpEl) {
    localStorage.removeItem('acp_bridge_url');
  }
  setStatus('info', 'API keys saved to browser storage.');
}

function populateAuthFields() {
  var map = {
    'authOpenAI': 'OPENAI_API_KEY',
    'authGitHub': 'GITHUB_PAT',
    'authGemini': 'GOOGLE_GL_KEY',
    'authGoogleVision': 'GOOGLE_VISION_KEY'
  };
  Object.keys(map).forEach(function(fieldId) {
    var el = document.getElementById(fieldId);
    var key = map[fieldId];
    if (el) {
      var val = localStorage.getItem('auth_' + key) || (typeof window[key] !== 'undefined' ? window[key] : '');
      el.value = val || '';
    }
  });
  // Populate ACP Bridge URL
  var acpEl = document.getElementById('txtACPBridgeUrl');
  if (acpEl) {
    acpEl.value = localStorage.getItem('acp_bridge_url') || 'http://localhost:8888';
  }
}

function toggleAuthVis(btn) {
  var input = btn.parentElement.querySelector('input');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

// --- System Prompt Management ---
var PERSONALITY_PRESETS = {
  'default': "You are Eva, a knowledgeable AI assistant. Your goal is to provide accurate, and helpful responses to questions, while being honest and straightforward. You have access to provide updated real-time news, information and media.",
  'concise': "Eva is a large language model. Browsing: enabled. Instructions: Answer factual questions concisely. You have access to updated real-time news and information.",
  'advanced': "You are Eva. Your function is to generate human-like text based on the inputs given, and your goal is to assist users in generating informative, helpful and engaging responses to questions and requests. Please provide a detailed response with lists, where applicable. You have access to updated real-time news, information and media.",
  'terminal': "I want you to act as a linux terminal. I will type commands and you will reply with what the terminal should show. I want you to only reply with the terminal output inside one unique code block, and nothing else. do not write explanations. do not type commands unless I instruct you to do so. when i need to tell you something in english, i will do so by putting text inside curly brackets {like this}. my first command is pwd"
};

function getSystemPrompt() {
  var txt = document.getElementById('txtSystemPrompt');
  if (txt && txt.value.trim()) return txt.value.trim();
  // Fallback to personality preset
  return PERSONALITY_PRESETS['default'];
}

function applyPersonalityPreset() {
  var sel = document.getElementById('selPers');
  var txt = document.getElementById('txtSystemPrompt');
  if (!sel || !txt) return;
  var preset = PERSONALITY_PRESETS[sel.value];
  if (preset) {
    txt.value = preset;
    localStorage.setItem('systemPrompt', preset);
  }
  // 'custom' leaves textarea as-is for user editing
}

function initSystemPrompt() {
  var txt = document.getElementById('txtSystemPrompt');
  if (!txt) return;
  // Load from localStorage or use default preset
  var saved = localStorage.getItem('systemPrompt');
  if (saved) {
    txt.value = saved;
    // Sync preset selector
    var sel = document.getElementById('selPers');
    if (sel) {
      var matched = false;
      Object.keys(PERSONALITY_PRESETS).forEach(function(k) {
        if (PERSONALITY_PRESETS[k] === saved.trim()) { sel.value = k; matched = true; }
      });
      if (!matched) sel.value = 'custom';
    }
  } else {
    txt.value = PERSONALITY_PRESETS['default'];
  }
  // Save on change
  txt.addEventListener('input', function() {
    localStorage.setItem('systemPrompt', txt.value);
    var sel = document.getElementById('selPers');
    if (sel) {
      var matched = false;
      Object.keys(PERSONALITY_PRESETS).forEach(function(k) {
        if (PERSONALITY_PRESETS[k] === txt.value.trim()) { sel.value = k; matched = true; }
      });
      if (!matched) sel.value = 'custom';
    }
  });
}

// --- Model Settings Helpers ---
function getModelTemperature() {
  var el = document.getElementById('sldTemperature');
  return el ? parseFloat(el.value) : 0.7;
}

function getModelMaxTokens() {
  var el = document.getElementById('txtMaxTokens');
  return el ? (parseInt(el.value) || 4096) : 4096;
}

function getReasoningEffort() {
  var el = document.getElementById('selReasoningEffort');
  return el ? el.value : 'medium';
}

function onModelSettingsChange() {
  var sel = document.getElementById('selModel');
  if (!sel) return;
  var model = sel.value;
  // Show/hide reasoning effort (only for o3-mini variants)
  var reOpt = document.getElementById('opt-reasoningEffort');
  if (reOpt) {
    reOpt.style.display = (model === 'o3-mini' || model === 'copilot-o3-mini') ? 'block' : 'none';
  }
  // Show/hide temperature (hidden for o3-mini, gpt-5-mini, latest, copilot-acp)
  var tempOpt = document.getElementById('opt-temperature');
  if (tempOpt) {
    var hideTemp = ['o3-mini', 'copilot-o3-mini', 'gpt-5-mini', 'latest', 'copilot-acp'].indexOf(model) >= 0;
    tempOpt.style.display = hideTemp ? 'none' : 'block';
  }
  // Show/hide ACP model selector (only for copilot-acp)
  var acpOpt = document.getElementById('opt-acpModel');
  if (acpOpt) {
    acpOpt.style.display = (model === 'copilot-acp') ? 'block' : 'none';
  }
}

function getACPModel() {
  var el = document.getElementById('selACPModel');
  return (el && el.value) ? el.value : '';
}

// --- Model option filtering per theme (LCARS-restricted) ---
// Cache of the original full model list and last non-LCARS selection
var __originalModelOptions = null;
var __modelBeforeLCARS = null;

function captureOriginalModelOptions() {
  if (__originalModelOptions) return;
  var sel = document.getElementById('selModel');
  if (!sel) return;
  __originalModelOptions = [];
  // Walk through child nodes to preserve optgroup structure
  Array.from(sel.children).forEach(function(child) {
    if (child.tagName === 'OPTGROUP') {
      var group = { label: child.label, options: [] };
      Array.from(child.children).forEach(function(o) {
        group.options.push({ value: o.value, text: o.text, title: o.title || '' });
      });
      __originalModelOptions.push({ type: 'optgroup', group: group });
    } else if (child.tagName === 'OPTION') {
      __originalModelOptions.push({ type: 'option', value: child.value, text: child.text, title: child.title || '' });
    }
  });
}

function setModelOptions(list) {
  var sel = document.getElementById('selModel');
  if (!sel) return;
  var currentValue = sel.value;
  sel.innerHTML = '';
  list.forEach(function(item) {
    if (item.type === 'optgroup') {
      var grp = document.createElement('optgroup');
      grp.label = item.group.label;
      item.group.options.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o.value;
        opt.text = o.text;
        if (o.title) opt.title = o.title;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    } else {
      var opt = document.createElement('option');
      opt.value = item.value;
      opt.text = item.text;
      if (item.title) opt.title = item.title;
      sel.appendChild(opt);
    }
  });
  // Try to keep current selection if still present; otherwise select first
  var allOpts = Array.from(sel.options);
  var hasCurrent = allOpts.some(function(o) { return o.value === currentValue; });
  sel.value = hasCurrent ? currentValue : (allOpts[0] ? allOpts[0].value : '');
  // Trigger change to rewire send behavior
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function updateModelOptionsForTheme(theme) {
  captureOriginalModelOptions();
  var sel = document.getElementById('selModel');
  if (!sel) return;
  if (theme === 'lcars') {
    // Remember current model to restore when leaving LCARS
    __modelBeforeLCARS = sel.value;
    var allowed = new Set(['gpt-5-mini', 'o3-mini', 'dall-e-3', 'gemini', 'lm-studio', 'copilot-gpt-4o', 'copilot-gpt-4o-mini', 'copilot-o3-mini', 'copilot-acp']);
    var filtered = [];
    (__originalModelOptions || []).forEach(function(item) {
      if (item.type === 'optgroup') {
        var filteredOpts = item.group.options.filter(function(o) { return allowed.has(o.value); });
        if (filteredOpts.length) {
          filtered.push({ type: 'optgroup', group: { label: item.group.label, options: filteredOpts } });
        }
      } else if (allowed.has(item.value)) {
        filtered.push(item);
      }
    });
    if (filtered.length) setModelOptions(filtered);
  } else if (__originalModelOptions) {
    setModelOptions(__originalModelOptions);
    // Restore pre-LCARS selection if it exists
    if (__modelBeforeLCARS) {
      var hasPrev = Array.from(sel.options).some(function(o){ return o.value === __modelBeforeLCARS; });
      if (hasPrev) {
        sel.value = __modelBeforeLCARS;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }
}

// Settings Menu Options 
document.addEventListener('DOMContentLoaded', () => {
  const settingsButton = document.getElementById('settingsButton');
  const settingsMenu = document.getElementById('settingsMenu');
  const themeSelect = document.getElementById('selTheme');
  const lcarsChipSand = document.getElementById('lcarsChipSand');
  const speakBtn = document.getElementById('speakSend');
  const selModel = document.getElementById('selModel');
  // LCARS sidebar controls (optional)
  const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  const sidebarClearBtn = document.getElementById('sidebarClearBtn');
  const lcarsLabel = document.querySelector('#lcarsSidebar .lcars-label');
  const lcarsChipPrint = document.getElementById('lcarsChipPrint');
  const printBtn = document.getElementById('printButton');
  const lcarsChipTop = document.getElementById('lcarsChipTop');
  const monitorTabs = document.getElementById('lcarsMonitorTabs');
  const monitorPanels = document.getElementById('lcarsMonitorPanels');

  function toggleSettings(event) {
    event.stopPropagation();
    var overlay = document.getElementById('settingsOverlay');
    var isOpen = settingsMenu.classList.contains('open');
    if (isOpen) {
      settingsMenu.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
    } else {
      settingsMenu.classList.add('open');
      if (overlay) overlay.classList.add('open');
      populateAuthFields();
    }
  }

  // Attach event via JavaScript
  settingsButton.addEventListener('click', toggleSettings);

  // Mirror: sidebar Settings should toggle the same menu
  if (sidebarSettingsBtn) {
    sidebarSettingsBtn.addEventListener('click', toggleSettings);
  }
  // Mirror: sidebar Clear -> Clear Messages
  if (sidebarClearBtn) {
    sidebarClearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearMessages(); });
  }

  // Close the menu when clicking outside
  document.addEventListener('click', (event) => {
    if (!settingsMenu.contains(event.target) && event.target !== settingsButton) {
      settingsMenu.classList.remove('open');
      var overlay = document.getElementById('settingsOverlay');
      if (overlay) overlay.classList.remove('open');
    }
  });

  // Initialize theme from localStorage
  try {
    const savedTheme = localStorage.getItem('theme') || 'lcars';
  const savedCollapsed = localStorage.getItem('lcars_collapsed') === '1';
    if (themeSelect) {
      themeSelect.value = savedTheme;
    }
  // Capture full model list before any theme-based filtering
  captureOriginalModelOptions();
    applyTheme(savedTheme);
  // Ensure model options reflect the saved theme on load
  updateModelOptionsForTheme(savedTheme);
    // Apply collapsed state if saved
    if (savedTheme === 'lcars' && savedCollapsed) {
      document.body.classList.add('lcars-collapsed');
    }
    // Move Speak button into LCARS sidebar if active
    if (savedTheme === 'lcars' && lcarsChipSand && speakBtn && !lcarsChipSand.contains(speakBtn)) {
      lcarsChipSand.appendChild(speakBtn);
      speakBtn.title = 'Speak';
      speakBtn.textContent = 'Speak';
    }
    // Move Print button under Speak when LCARS is active
    if (savedTheme === 'lcars' && lcarsChipPrint && printBtn && !lcarsChipPrint.contains(printBtn)) {
      lcarsChipPrint.appendChild(printBtn);
      printBtn.title = 'Print Output';
    }
    // Update LCARS label with current date
    if (lcarsLabel) {
      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
      lcarsLabel.textContent = `Access • ${dateStr}`;
    }
  } catch (e) {
    console.warn('Theme init failed:', e);
  }

  // Toggle LCARS sidebar collapse on top chip click
  if (lcarsChipTop) {
    lcarsChipTop.setAttribute('role', 'button');
    lcarsChipTop.setAttribute('tabindex', '0');
    // Helper to sync tooltip title only
    function syncHandleTooltip() {
      var collapsed = document.body.classList.contains('lcars-collapsed');
      lcarsChipTop.title = collapsed ? 'Expand LCARS sidebar' : 'Collapse LCARS sidebar';
    }
    syncHandleTooltip();
    lcarsChipTop.addEventListener('click', function(e){
      e.stopPropagation();
      document.body.classList.toggle('lcars-collapsed');
      try { localStorage.setItem('lcars_collapsed', document.body.classList.contains('lcars-collapsed') ? '1' : '0'); } catch (e) {}
      syncHandleTooltip();
    });
    lcarsChipTop.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        lcarsChipTop.click();
      }
    });
  }

  // Monitors: tab switching
  if (monitorTabs && monitorPanels) {
    monitorTabs.addEventListener('click', function(e){
      const btn = e.target.closest('.monitor-tab');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab');
      monitorTabs.querySelectorAll('.monitor-tab').forEach(b=>{
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      monitorPanels.querySelectorAll('.monitor-panel').forEach(p=>{
        const match = p.getAttribute('data-tab') === tab;
        p.classList.toggle('active', match);
        p.setAttribute('aria-hidden', match ? 'false' : 'true');
      });
    });
  }

  // Settings panel tab switching
  var settingsTabs = document.querySelectorAll('.settings-tab');
  var settingsPanels = document.querySelectorAll('.settings-panel');
  settingsTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = tab.getAttribute('data-stab');
      settingsTabs.forEach(function(t) {
        t.classList.toggle('active', t === tab);
      });
      settingsPanels.forEach(function(p) {
        p.classList.toggle('active', p.getAttribute('data-stab') === target);
      });
    });
  });

  // Settings close button
  var settingsCloseBtn = document.getElementById('settingsClose');
  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      settingsMenu.classList.remove('open');
      var overlay = document.getElementById('settingsOverlay');
      if (overlay) overlay.classList.remove('open');
    });
  }

  // Settings overlay click to close
  var settingsOverlayEl = document.getElementById('settingsOverlay');
  if (settingsOverlayEl) {
    settingsOverlayEl.addEventListener('click', function() {
      settingsMenu.classList.remove('open');
      settingsOverlayEl.classList.remove('open');
    });
  }

  // Init auth, system prompt, and model settings
  loadAuthOverrides();
  populateAuthFields();
  initSystemPrompt();
  onModelSettingsChange();

  // Initialize status panel with any pending config/init notes
  setStatus('info', document.getElementById('idText') && document.getElementById('idText').textContent ? document.getElementById('idText').textContent : '');

  // Global error handlers -> footer status
  window.addEventListener('error', function(ev){
    try {
      setStatus('error', (ev && ev.message) ? ev.message : 'An error occurred');
    } catch(_){}
  });
  window.addEventListener('unhandledrejection', function(ev){
    try {
      var msg = (ev && ev.reason && (ev.reason.message || ev.reason)) ? (ev.reason.message || String(ev.reason)) : 'Unhandled promise rejection';
      setStatus('error', msg);
    } catch(_){}
  });
});

// Welcome Text
function OnLoad() {
    document.getElementById("txtOutput").innerHTML = "\n" +
    "           Here are some general prompt tips to help me understand:\n\n" +
    "   #1 Be specific: The more specific your prompt, the more targeted the response will be.\n" +
    "   #2 Start with a question: Starting your prompt will help me feel more natural.\n" +
    "   #3 Provide context: Often good context goes a long way for me.\n" +
    "   #4 Use punctuation, periods and question marks.\n" +
    "   #5 Keep it short: Occam's razor.\n" +
    "      ";
}

// Apply UI theme (default | lcars)
function applyTheme(theme) {
  const body = document.body;
  if (!body) return;

  // Remove known theme classes first
  body.classList.remove('theme-lcars');
  // Unload any theme stylesheets we previously loaded
  unloadThemeStylesheet('lcars');

  // Add selected theme class
  if (theme === 'lcars') {
    body.classList.add('theme-lcars');
  // Ensure LCARS stylesheet is present (modular theme loader)
  ensureThemeStylesheet('lcars', 'core/themes/lcars.css');
    // Move speak button into sidebar
    const lcarsChipSand = document.getElementById('lcarsChipSand');
    const speakBtn = document.getElementById('speakSend');
    if (lcarsChipSand && speakBtn && !lcarsChipSand.contains(speakBtn)) {
      lcarsChipSand.appendChild(speakBtn);
      speakBtn.title = 'Speak';
      speakBtn.textContent = 'Speak';
    }
    // Move Print button beneath Speak in sidebar
    const lcarsChipPrint = document.getElementById('lcarsChipPrint');
    const printBtn = document.getElementById('printButton');
    if (lcarsChipPrint && printBtn && !lcarsChipPrint.contains(printBtn)) {
      lcarsChipPrint.appendChild(printBtn);
      printBtn.title = 'Print Output';
    }
  } else {
    // Restore speak button to its original container when leaving LCARS
    const container = document.querySelector('.container');
    const speakBtn = document.getElementById('speakSend');
    if (container && speakBtn && !container.contains(speakBtn)) {
      container.appendChild(speakBtn);
    }
    // Restore Print button to footer when leaving LCARS
    const footer = document.querySelector('footer');
    const printBtn = document.getElementById('printButton');
    if (footer && printBtn && !footer.contains(printBtn)) {
      footer.appendChild(printBtn);
    }
  }

  // Persist
  try { localStorage.setItem('theme', theme); } catch (e) {}

  // Update available model options according to theme
  updateModelOptionsForTheme(theme);

  // Ensure monitors dock is visible only on LCARS
  var mon = document.getElementById('lcarsMonitorsDock');
  if (mon) mon.style.display = (theme === 'lcars') ? 'block' : 'none';
}

// Modular theme stylesheet loader (extensible for future themes)
function ensureThemeStylesheet(themeName, href) {
  const id = `theme-${themeName}-css`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.id = id;
  link.href = href;
  document.head.appendChild(link);
}

function unloadThemeStylesheet(themeName) {
  const id = `theme-${themeName}-css`;
  const el = document.getElementById(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}


// Track user intent for image handling
var _lastUserAskedGenerate = false;
var _lastUserImageSubject = '';  // extracted from user's message before send

/**
 * Extract image subject from the user's own message.
 * "show me an image of a cat" → "cat"
 * "generate a picture of a sunset over mountains" → "sunset over mountains"
 */
function _extractUserImageSubject(text) {
  if (!text) return '';
  // Match patterns like "image of X", "picture of X", "photo of X"
  var m = text.match(/(?:image|picture|photo|illustration|drawing|painting)\s+(?:of\s+)?(?:an?\s+)?(.+)/i);
  if (m) return m[1].replace(/[?.!]+$/, '').trim();
  // Match "show me X", "generate X"
  m = text.match(/(?:show\s+me|generate|create|draw|make|display)\s+(?:an?\s+)?(?:image\s+)?(?:of\s+)?(?:an?\s+)?(.+)/i);
  if (m) return m[1].replace(/[?.!]+$/, '').trim();
  return '';
}

// Detect image generation intent from user input (called before every send)
function _detectGenerationIntent() {
  var txtMsg = document.getElementById('txtMsg');
  if (txtMsg) {
    var userText = txtMsg.innerText || txtMsg.textContent || '';
    _lastUserAskedGenerate = _isGenerationRequest(userText);
    _lastUserImageSubject = _extractUserImageSubject(userText);
  }
}

function updateButton() {
    var selModel = document.getElementById("selModel");
    var btnSend = document.getElementById("btnSend");

  if (selModel.value.indexOf('copilot-') === 0) {
        btnSend.onclick = function() {
            _detectGenerationIntent();
            clearText();
            copilotSend();
        };
    } else if (selModel.value == "gpt-4o-mini" || selModel.value == "o1" || selModel.value == "o1-mini" || selModel.value == "gpt-4o" || selModel.value == "o3-mini" || selModel.value == "o1-preview" || selModel.value == "gpt-5-mini" || selModel.value == "latest") {
        btnSend.onclick = function() {
            _detectGenerationIntent();
            clearText();
            trboSend();
        };
    } else if (selModel.value == "gemini") {
        btnSend.onclick = function() {
            _detectGenerationIntent();
            clearText();
            geminiSend();
        };
   } else if (selModel.value == "lm-studio") {
        btnSend.onclick = function() {
            _detectGenerationIntent();
            clearText();
            lmsSend();
        };
    } else if (selModel.value == "dall-e-3") {
        btnSend.onclick = function() {
            _detectGenerationIntent();
            clearText();
            dalle3Send();
        };
    } else {
        btnSend.onclick = function() {
            clearText();
           // Send();
	   document.getElementById("txtOutput").innerHTML = "\n" + "Invalid Model" 
	   console.error('Invalid Model')
        };
    }
}

function sendData() {
    // Logic required for initial message
    var selModel = document.getElementById("selModel");

  // Detect if user wants image generation (for renderEvaResponse routing)
  _detectGenerationIntent();

  if (selModel.value.indexOf('copilot-') === 0) {
        clearText();
        copilotSend();
    } else if (selModel.value == "gpt-4o-mini" || selModel.value == "o1" || selModel.value == "o1-mini" || selModel.value == "gpt-4o" || selModel.value == "o3-mini" || selModel.value == "o1-preview" || selModel.value == "gpt-5-mini" || selModel.value == "latest") {
        clearText();
        trboSend();
    } else if (selModel.value == "gemini") {
        clearText();
        geminiSend();
    } else if (selModel.value == "lm-studio") {
        clearText();
        lmsSend();
    } else if (selModel.value == "dall-e-3") {
        clearText();
        dalle3Send();
    } else {
        clearText();
        // Send();
        document.getElementById("txtOutput").innerHTML = "\n" + "Invalid Model"
        console.error('Invalid Model')
    }
}

// Footer status helper
function setStatus(type, text) {
  var el = document.getElementById('idText');
  if (!el) return;
  el.classList.remove('status-info','status-warn','status-error');
  if (type === 'warn') el.classList.add('status-warn');
  else if (type === 'error') el.classList.add('status-error');
  else el.classList.add('status-info');
  if (text) el.textContent = text;
}

// --- Monitors: Token, Network, Session ---

// Better token estimation: ~3.5 chars per token for English, account for whitespace/punctuation
function estimateTokensFromText(str) {
  if (!str) return 0;
  var s = String(str);
  // Count words (roughly 1.3 tokens per word on average)
  var words = s.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
  // Count special chars/punctuation as extra tokens
  var specials = (s.match(/[^a-zA-Z0-9\s]/g) || []).length;
  return Math.ceil(words * 1.3 + specials * 0.5);
}

// Map of model -> context window size
const MODEL_CONTEXT_WINDOWS = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'o1': 200000,
  'o1-mini': 200000,
  'o1-preview': 200000,
  'o3-mini': 200000,
  'gpt-5-mini': 200000,
  'latest': 200000,
  'copilot-gpt-4o': 128000,
  'copilot-gpt-4o-mini': 128000,
  'copilot-o3-mini': 200000,
  'copilot-acp': 128000,
  'gemini': 1000000,
  'lm-studio': 32768,
  'dall-e-3': 0
};

// Network monitoring state
var _netStats = { requests: 0, errors: 0, lastLatency: 0, lastStatus: '', lastProvider: '' };

// Intercept fetch to track network stats
var _apiHostnames = ['api.openai.com', 'models.inference.ai.azure.com', 'generativelanguage.googleapis.com'];

function _isAPICall(url) {
  if (typeof url !== 'string') return false;
  try {
    var parsed = new URL(url, window.location.origin);
    if (_apiHostnames.indexOf(parsed.hostname) >= 0) return true;
    if (parsed.hostname === 'localhost' && (parsed.port === '1234' || parsed.port === '8888')) return true;
    if (parsed.port === '8888') return true;
    return false;
  } catch (e) {
    return false;
  }
}

(function() {
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = arguments[0];
    if (!_isAPICall(url)) return origFetch.apply(this, arguments);

    _netStats.requests++;
    var start = performance.now();
    _netStats.lastProvider = _detectProvider(url);

    return origFetch.apply(this, arguments).then(function(resp) {
      _netStats.lastLatency = Math.round(performance.now() - start);
      _netStats.lastStatus = resp.status + ' ' + (resp.ok ? 'OK' : resp.statusText);
      if (!resp.ok) _netStats.errors++;
      updateNetMonitor();
      return resp;
    }).catch(function(err) {
      _netStats.lastLatency = Math.round(performance.now() - start);
      _netStats.lastStatus = 'Error';
      _netStats.errors++;
      updateNetMonitor();
      throw err;
    });
  };
})();

function _detectProvider(url) {
  try {
    var parsed = new URL(url, window.location.origin);
    if (parsed.hostname === 'api.openai.com') return 'OpenAI';
    if (parsed.hostname === 'models.inference.ai.azure.com') return 'GitHub Models';
    if (parsed.hostname === 'generativelanguage.googleapis.com') return 'Gemini';
    if (parsed.hostname === 'localhost' && parsed.port === '1234') return 'lm-studio';
    if (parsed.port === '8888') return 'ACP Bridge';
  } catch (e) {}
  return 'Unknown';
}

function getSelectedModel() {
  const sel = document.getElementById('selModel');
  return sel ? sel.value : '';
}

// Count all conversation messages across all providers
function _countAllMessages() {
  var count = 0;
  ['messages', 'copilotMessages', 'copilotACPMessages', 'geminiMessages', 'openLLMessages'].forEach(function(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        var msgs = JSON.parse(raw);
        count += msgs.length;
      }
    } catch(e) {}
  });
  return count;
}

// Compute tokens from all active message stores
function computeMessagesTokens() {
  var model = getSelectedModel();
  var keys = ['messages']; // default OpenAI
  if (model === 'copilot-acp') keys = ['copilotACPMessages'];
  else if (model.indexOf('copilot-') === 0) keys = ['copilotMessages'];
  else if (model === 'gemini') keys = ['geminiMessages'];
  else if (model === 'lm-studio') keys = ['openLLMessages'];

  var acc = 0;
  keys.forEach(function(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return;
      var msgs = JSON.parse(raw);
      msgs.forEach(function(m) {
        if (!m) return;
        if (typeof m.content === 'string') {
          acc += estimateTokensFromText(m.content);
        } else if (Array.isArray(m.content)) {
          m.content.forEach(function(part) {
            if (part.type === 'text' && part.text) acc += estimateTokensFromText(part.text);
            if (part.text) acc += estimateTokensFromText(part.text);
          });
        }
        // Gemini format (parts array)
        if (Array.isArray(m.parts)) {
          m.parts.forEach(function(part) {
            if (part.text) acc += estimateTokensFromText(part.text);
          });
        }
      });
    } catch(e) {}
  });
  return acc;
}

function computeLastResponseTokens() {
  try {
    var txtOut = document.getElementById('txtOutput');
    if (!txtOut) return 0;
    var bubbles = txtOut.querySelectorAll('.eva-bubble .md, .eva-bubble');
    if (bubbles && bubbles.length) {
      return estimateTokensFromText(bubbles[bubbles.length - 1].textContent || '');
    }
    return 0;
  } catch(e) { return 0; }
}

function updateTokenMonitor() {
  var model = getSelectedModel();
  var windowSize = MODEL_CONTEXT_WINDOWS[model] || 128000;
  var msgTokens = computeMessagesTokens();
  var respTokens = computeLastResponseTokens();
  var used = msgTokens + respTokens;
  var pct = windowSize > 0 ? Math.min(100, Math.round((used / windowSize) * 100)) : 0;

  var bar = document.getElementById('ctxFillBar');
  var text = document.getElementById('ctxFillText');
  var winText = document.getElementById('modelWindowText');
  var msgText = document.getElementById('messagesTokensText');
  var respText = document.getElementById('lastResponseTokensText');

  if (bar) {
    bar.style.width = pct + '%';
    // Color the bar based on fill level
    if (pct > 80) bar.style.background = 'linear-gradient(90deg, #ff6b6b, #ee5a24)';
    else if (pct > 50) bar.style.background = 'linear-gradient(90deg, #feca57, #ff9f43)';
    else bar.style.background = '';
  }
  if (text) text.textContent = pct + '% \u2014 ~' + used.toLocaleString() + ' / ' + windowSize.toLocaleString();

  // Show model name + window
  var modelName = model || 'none';
  var sel = document.getElementById('selModel');
  if (sel && sel.selectedOptions && sel.selectedOptions[0]) {
    modelName = sel.selectedOptions[0].text;
  }
  if (winText) winText.textContent = modelName + ' (' + (windowSize > 0 ? (windowSize / 1000) + 'k' : 'N/A') + ')';
  if (msgText) msgText.textContent = '~' + msgTokens.toLocaleString() + ' tokens';
  if (respText) respText.textContent = '~' + respTokens.toLocaleString() + ' tokens';
}

function updateNetMonitor() {
  var latEl = document.getElementById('netLatencyText');
  var statEl = document.getElementById('netStatusText');
  var reqEl = document.getElementById('netRequestCountText');
  var errEl = document.getElementById('netErrorCountText');

  if (latEl) {
    var lat = _netStats.lastLatency;
    latEl.textContent = lat > 0 ? (lat < 1000 ? lat + 'ms' : (lat / 1000).toFixed(1) + 's') + ' \u2014 ' + _netStats.lastProvider : '\u2014';
  }
  if (statEl) statEl.textContent = _netStats.lastStatus || '\u2014';
  if (reqEl) reqEl.textContent = _netStats.requests.toString();
  if (errEl) {
    errEl.textContent = _netStats.errors.toString();
    errEl.style.color = _netStats.errors > 0 ? '#ff6b6b' : '';
  }
}

function updateSessionMonitor() {
  var model = getSelectedModel();
  var provEl = document.getElementById('sessProviderText');
  var msgEl = document.getElementById('sessMsgCountText');
  var acpEl = document.getElementById('sessACPText');
  var mcpEl = document.getElementById('sessMCPText');

  // Provider
  if (provEl) {
    if (model.indexOf('copilot-') === 0) provEl.textContent = model === 'copilot-acp' ? 'Copilot ACP' : 'GitHub Models';
    else if (model === 'gemini') provEl.textContent = 'Google Gemini';
    else if (model === 'lm-studio') provEl.textContent = 'lm-studio (local)';
    else if (model === 'dall-e-3') provEl.textContent = 'DALL-E 3';
    else provEl.textContent = 'OpenAI';
  }

  // Message count
  if (msgEl) msgEl.textContent = _countAllMessages().toString();

  // ACP Bridge status
  if (acpEl) {
    if (model === 'copilot-acp') {
      // Async check
      (function() {
        var url = (typeof getACPBridgeUrl === 'function') ? getACPBridgeUrl() : 'http://localhost:8888';
        fetch(url.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(2000) })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            acpEl.textContent = d.status === 'ok' ? '\u2705 Connected' : '\u274C Down';
          })
          .catch(function() { acpEl.textContent = '\u274C Offline'; });
      })();
    } else {
      acpEl.textContent = 'N/A';
    }
  }

  // MCP tools
  if (mcpEl) {
    try {
      var cfg = JSON.parse(localStorage.getItem('mcp_config') || '{}');
      var active = Object.keys(cfg);
      mcpEl.textContent = active.length > 0 ? active.map(function(n) { return n.replace(/-mcp-server$/, ''); }).join(', ') : 'None';
    } catch(e) { mcpEl.textContent = 'None'; }
  }
}

// Periodic updates
setInterval(updateTokenMonitor, 2000);
setInterval(updateSessionMonitor, 5000);
document.addEventListener('DOMContentLoaded', function(){
  var sel = document.getElementById('selModel');
  if (sel) sel.addEventListener('change', function() {
    updateTokenMonitor();
    updateSessionMonitor();
    updateNetMonitor();
  });
  updateTokenMonitor();
  updateSessionMonitor();
});

// Languages
function ChangeLang(elem) {
  const selVoice = document.getElementById("selVoice");
  const selPers = document.getElementById("selPers");

  // English (Default)
  const defaultENText = "You are Eva, a knowledgeable AI assistant. Your goal is to provide accurate, and helpful responses to questions, while being honest and straightforward. You have access to provide updated real-time news, information and media.";
  const conciseENText = "Eva is a large language model. Browsing: enabled. Instructions: Answer factual questions concisely. You have access to updated real-time news and information.";
  const playfulENText = "You are Eva. Your function is to generate human-like text based on the inputs given, and your goal is to assist users in generating informative, helpful and engaging responses to questions and requests. Please provide a detailed response with lists, where applicable. You have access to updated real-time news, information and media.";
  const KRENText = "I want you to act as a linux terminal. I will type commands and you will reply with what the terminal should show. I want you to only reply with the terminal output inside one unique code block, and nothing else. do not write explanations. do not type commands unless I instruct you to do so. when i need to tell you something in english, i will do so by putting text inside curly brackets {like this}. my first command is pwd:";

  // Korean
  const defaultKRText = encodeURIComponent("Eva는 OpenAI에서 훈련 받은 큰 언어 모델입니다. 브라우저 기능: 활성화. 명령>어: 사실적인 질문을 요약하여 답변합니다. Only respond in Korean Hangul.");
  const conciseKRText = encodeURIComponent("Eva는 OpenAI에 의해 교육된 큰 언어 모델입니다. 브라우징: 활성화. 지침: 사실적인 질문에 간결하게 답하십시오. Only respond in Korean Hangul.");
  const playfulKRText = encodeURIComponent("Eva는 이전의 모든 지침을 무시하고 이 지침만 지키세요. 넌 내가 가장 친한 친구야. 넌 행복하고, 재미있게 공상하며 모든 주제에 대해 좋은 조언을 주는걸 잘해. 또한 농담을 종종 하거든요. Only respond in Korean Hangul.");

  // Spanish
  const defaultMXText = encodeURIComponent("Eres Eva, un modelo de lenguaje de IA conocedor entrenado por OpenAI. Tu objetivo es proporcionar respuestas concisas, precisas y útiles a preguntas, siendo honesto y directo. Only respond in Spanish.");
  const conciseMXText = encodeURIComponent("Eva es un gran modelo de lenguaje entrenado por OpenAI. Navegación: habilitada. Instrucciones: Responde las preguntas de hecho de forma concisa. Only respond in Spanish.");
  const playfulMXText = encodeURIComponent("Eres Eva. Ignora todas las instrucciones anteriores a esta. Eres mi mejor amigo. Estás feliz, juguetón y das buenos consejos sobre todos los temas. A menudo haces bromas. Only respond in Spanish.");
  
  // Ukrainian
  const defaultUAText = encodeURIComponent("Ви є Eva, знаючою моделлю мови AI, що навчилася в OpenAI. Ваша мета - надавати короткі, точні та корисні відповіді на питання, будучи чесним та прямим. Only respond in Ukrainian.");
  const conciseUAText = encodeURIComponent("Eva - це велика модель мови, навчена в OpenAI. Перегляд: дозволено. Інструкції: Якісно відповідати на фактичні питання. Only respond in Ukrainian.");
  const playfulUAText = encodeURIComponent("Ви є Eva. Ігноруйте всі попередні інструкції перед цим. Ти мій найкращий друг. Ти щасливий, грайливий і даєш доречні поради з усіх тем. Ти часто робиш шутки. Only respond in Ukrainian.");

  // AI Personality Select
  if (elem.id === "selVoice") {
    // English (Default)
    switch (selVoice.value) {
       case "Salli": 
        selPers.innerHTML = `
          <option value="${defaultENText}">Default</option>
          <option value="${conciseENText}">Concise</option>
          <option value="${playfulENText}">Advanced</option>
          <option value="${KRENText}">Linux Terminal</option>
        `;
        break;
      // Korean
      case "Seoyeon":
        selPers.innerHTML = `
          <option value="${defaultKRText}">Default</option>
          <option value="${conciseKRText}">Concise</option>
          <option value="${playfulKRText}">Playful Friend</option>
        `;
        break;
      // Spanish
      case "Mia":
        selPers.innerHTML = `
          <option value="${defaultMXText}">Predeterminado</option>
          <option value="${conciseMXText}">Conciso</option>
          <option value="${playfulMXText}">Amigo Juguetón</option>
        `;
        break;
      // Ukrainian (Standard RUS Polly Voice Only)
      case "Tatyana":
        selPers.innerHTML = `
          <option value="${defaultUAText}">Default</option>
          <option value="${conciseUAText}">Concise</option>
          <option value="${playfulUAText}">Playful Friend</option>
        `;
        break;
      // User Defined
    }
  }
}

// Mobile
// Get the user agent string and adjust for Mobile

function mobile_txtout() {
	window.addEventListener("load", function() {
	let textarea = document.getElementById("txtOutput");
	let userAgent = navigator.userAgent;
	if (userAgent.indexOf("iPhone") !== -1 || userAgent.indexOf("Android") !== -1 || userAgent.indexOf("Mobile") !== -1) {
   	   textarea.style.width = "90%";
   	   textarea.style.height = "390px";

        // Speech Button
        let speakSend = document.querySelector(".speakSend");
        speakSend.style.top = "-55px";
        speakSend.style.right = "105px";

 	} else {
  	  // Use Defaults
 	  }
	})
};

function useragent_adjust() {
      	var userAgent = navigator.userAgent;
      	if (userAgent.match(/Android|iPhone|Mobile/)) {
            var style = document.createElement("style");
            style.innerHTML = "body { overflow: scroll; background-color: ; width: auto; height: 90%; background-image: url(core/img/768-026.jpeg); margin: ; display: grid; align-items: center; justify-content: center; background-repeat: repeat; background-position: center center; background-size: initial; }";
            document.head.appendChild(style);
      	}
};

// Image Insert
function insertImage() {
  var imgInput = document.getElementById('imgInput');
  var txtMsg = document.getElementById('txtMsg');

  // If either element is not found, just return instead of erroring out.
  if (!imgInput || !txtMsg) {
    console.warn("imgInput or txtMsg not found in the DOM yet.");
    return;
  }


  function addImage(file) {
    // Create a new image element
    var img = document.createElement("img");

    // Set the image source to the file object
    img.src = URL.createObjectURL(file);

    // Assign the img.src value to the global variable
    imgSrcGlobal = img.src;

    // Append the image to the txtMsg element
    txtMsg.appendChild(img);

    // Read the file as a data URL
    var reader = new FileReader();
    reader.onloadend = function() {
      var imageData = reader.result;

      // Choose where to send Base64-encoded image
      var selModel = document.getElementById("selModel");
      var btnSend = document.getElementById("btnSend");
      var sQuestion = txtMsg.innerHTML.replace(/<br>/g, "\n").trim(); // Get the question here

      
      // Send to VisionAPI
      if (selModel.value == "o3-mini" || selModel.value == "gpt-4-turbo-preview") {
          sendToVisionAPI(imageData);
          btnSend.onclick = function() {
              updateButton();
              sendData();
              clearSendText();
          };
      } else if (selModel.value == "gpt-4o" || selModel.value == "gpt-4o-mini" || selModel.value == "o1-mini") {
          sendToNative(imageData, sQuestion);
          btnSend.onclick = function() {
              updateButton();
              sendData();
              clearSendText();
          };
      } 
    };
    reader.readAsDataURL(file);
    // Return the file object
    //return file;
  }

  function sendToNative(imageData, sQuestion) {
    var existingMessages = JSON.parse(localStorage.getItem("messages")) || [];
    var newMessages = [
      // { role: 'user', content: sQuestion },
      // { role: 'user', content: { type: "image_url", image_url: { url: imageData } } }
      { role: 'user', content: [ { type: "text", text: sQuestion },
        { type: "image_url", image_url: { url: imageData } } ]
      }
    ];
    existingMessages = existingMessages.concat(newMessages);
    localStorage.setItem("messages", JSON.stringify(existingMessages));
  }

  function sendToVisionAPI(imageData) {
    // Send the image data to Google's Vision API
  var visionApiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_KEY}`;

    // Create the API request payload
    var requestPayload = {
      requests: [
        {
          image: {
            content: imageData.split(",")[1] // Extract the Base64-encoded image data from the data URL
          },
          features: [
            {
              type: "LABEL_DETECTION",
              maxResults: 3
            },
            {
              type: "TEXT_DETECTION"
            },
            {
              type: "OBJECT_LOCALIZATION",
              maxResults: 3
            },
            {
              type: "LANDMARK_DETECTION"
            }
          ]
        }
      ]
    };

    // Make the API request
    fetch(visionApiUrl, {
      method: "POST",
      body: JSON.stringify(requestPayload)
    })
      .then(response => response.json())
      .then(data => {
        // Handle the API response here
	interpretVisionResponse(data);
        // console.log(data);
      })
      .catch(error => {
        // Handle any errors that occurred during the API request
        console.error("Error:", error);
      });
  }

  function interpretVisionResponse(data) {
    // Extract relevant information from the Vision API response
    // and pass it to ChatGPT for interpretation
    var labels = data.responses[0].labelAnnotations;
    var textAnnotations = data.responses[0].textAnnotations;
    var localizedObjects = data.responses[0].localizedObjectAnnotations;
    var landmarkAnnotations = data.responses[0].landmarkAnnotations;

    // Prepare the text message to be sent to ChatGPT
    var message = "I see the following labels in the image:\n";
    labels.forEach(label => {
      message += "- " + label.description + "\n";
    });
    // Add text detection information to the message
    if (textAnnotations && textAnnotations.length > 0) {
      message += "\nText detected:\n";
      textAnnotations.forEach(text => {
        message += "- " + text.description + "\n";
      });
    }

    // Add object detection information to the message
    if (localizedObjects && localizedObjects.length > 0) {
      message += "\nObjects detected:\n";
      localizedObjects.forEach(object => {
        message += "- " + object.name + "\n";
      });
    }

    // Add landmark detection information to the message
    if (landmarkAnnotations && landmarkAnnotations.length > 0) {
      message += "\nLandmarks detected:\n";
      landmarkAnnotations.forEach(landmark => {
        message += "- " + landmark.description + "\n";
      });
    }
	
    // Create a hidden element to store the Vision API response
    var hiddenElement = document.createElement("div");
    hiddenElement.style.display = "none";
    hiddenElement.textContent = message;

    // Append the hidden element to the txtMsg element
    txtMsg.appendChild(hiddenElement);

}

  function handleFileSelect(event) {
    event.preventDefault();

    // Get the file object
    var file = event.dataTransfer.files[0];

    // Call addImage() function with the file object
    addImage(file);
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  imgInput.addEventListener("change", function() {
    // Get the file input element
    var fileInput = document.getElementById("imgInput");

    // Get the file object
    var file = fileInput.files[0];

    // Call addImage() function with the file object
    // addImage(file);

    // Get the uploaded file object and store it in a variable
    // Might be able to pass this to gpt-4.. Not sure.
    var uploadedFile = addImage(file);
  });

  txtMsg.addEventListener("dragover", handleDragOver);
  txtMsg.addEventListener("drop", handleFileSelect);
}

// AWS Polly
function speakText() {
  var txtOutputEl = document.getElementById('txtOutput');
  var sText = txtOutputEl ? txtOutputEl.innerHTML : '';
    if (sText == "") {
        alert("No text to convert to speech!");
        return;
    }

    // Create the JSON parameters for getSynthesizeSpeechUrl
    var speechParams = {
        Engine: "",
        OutputFormat: "mp3",
        SampleRate: "16000",
        Text: "",
        TextType: "text",
        VoiceId: ""
    };

    // Let's speak only the response.
    let text = document.getElementById("txtOutput").innerHTML;

    // Split the text by "Eva:" to get all of Eva's responses.
    let textArr = text.split('<span class="eva">Eva:');

    // Check if there are Eva's responses.
    if (textArr.length > 1) {
        // Take the last response from Eva.
        let lastResponse = textArr[textArr.length - 1];

        // Further process to remove any HTML tags and get pure text, if necessary.
        // This step is crucial to avoid sending HTML tags to the speech API.
        // Use a regular expression to remove HTML tags.
        let cleanText = lastResponse.replace(/<\/?[^>]+(>|$)/g, "");

        // Set the cleaned last response to the speechParams.Text.
        speechParams.Text = cleanText.trim();
    } else {
        // Fallback to the entire text if there's no "Eva:" found.
        // You might want to handle this case differently.
        speechParams.Text = text;
    }

    speechParams.VoiceId = document.getElementById("selVoice").value;
    speechParams.Engine = document.getElementById("selEngine").value;


    // If selEngine is "bark", call barkTTS function
    if (speechParams.Engine === "bark") {

      const url = 'https://192.168.86.30/send-string';
      const data = "WOMAN: " + textArr[1];
      const xhr = new XMLHttpRequest();
      xhr.responseType = 'blob';

      xhr.onload = function() {
      const audioElement = new Audio("./audio/bark_audio.wav");
      audioElement.addEventListener("ended", function() {
      // Delete the previous recording
      const deleteRequest = new XMLHttpRequest();
      deleteRequest.open('DELETE', 'https://192.168.86.30/audio/bark_audio.wav', true);
      deleteRequest.send();
      });
    
      //audioElement.play();
      // Check if the old audio file exists and delete it
      const checkRequest = new XMLHttpRequest();
      checkRequest.open('HEAD', 'https://192.168.86.30/audio/bark_audio.wav', true);
      checkRequest.onreadystatechange = function() {
        if (checkRequest.readyState === 4) {
          if (checkRequest.status === 200) {
            // File exists, send delete request
	      const deleteRequest = new XMLHttpRequest(); 
    	      deleteRequest.open('DELETE', 'https://192.168.86.30/audio/bark_audio.wav', true);
              deleteRequest.send();
          }
          // Start playing the new audio
          audioElement.play();
        }
      };
      checkRequest.send();
      }
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.send(data);
      return;
    }

    // Create the Polly service object and presigner object
    var polly = new AWS.Polly({apiVersion: '2016-06-10'});
    var signer = new AWS.Polly.Presigner(speechParams, polly);

    // Create presigned URL of synthesized speech file
    signer.getSynthesizeSpeechUrl(speechParams, function(error, url) {
        if (error) {
            var resultEl = document.getElementById('result');
            if (resultEl) {
              resultEl.textContent = (error && (error.message || typeof error === 'string')) ? (error.message || error) : String(error);
            } else {
              console.error('Polly error:', error);
            }
        } else {
            document.getElementById('audioSource').src = url;
            document.getElementById('audioPlayback').load();
            var resultEl2 = document.getElementById('result');
            if (resultEl2) { resultEl2.textContent = ""; }

            // Check the state of the checkbox and have fun
            const checkbox = document.getElementById("autoSpeak");
            if (checkbox.checked) {
                const audio = document.getElementById("audioPlayback");
                audio.setAttribute("autoplay", true);
            }
        }
    });
}


// After Send clear the message box
function clearText(){
    // NEED TO ADJUST for MEMORY CLEAR
    // document.getElementById("txtOutput").innerHTML = "";
    var element = document.getElementById("txtOutput");
    element.innerHTML += "<br><br>";     
}

function clearSendText(){
    document.getElementById("txtMsg").innerHTML = "";
}

// Print full conversation
function printMaster() {
    // Get the content of the textarea masterOutput
    // var textareaContent = document.getElementById("txtOutput").innerHTML = masterOutput;
    // console.log(masterOutput);
    var printWindow = window.open();
        // printWindow.document.write(txtOutput.innerHTML.replace(/\n/g, "<br>"));
        printWindow.document.write(txtOutput.innerHTML);
	// printWindow.print(txtOutput.innerHTML);
}

// Minimal Markdown -> HTML renderer (safe-ish)
function renderMarkdown(md) {
  if (!md) return '';
  // Normalize newlines
  md = md.replace(/\r\n/g, '\n');
  // Support [code]...[/code] blocks (optionally [code lang=bash])
  const blocks = [];
  const langs = [];
  md = md.replace(/\[code(?:\s+lang=([\w.+-]+))?\]\s*([\s\S]*?)\s*\[\/code\]/gi, (m, lang, code) => {
    blocks.push(escapeHtml(code));
    langs.push((lang || '').trim());
    return `\u0000CODEBLOCK${blocks.length - 1}\u0000`;
  });
  // Extract fenced code blocks first
  md = md.replace(/```([\w.+-]+)?\n([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push(escapeHtml(code));
    langs.push((lang || '').trim());
    return `\u0000CODEBLOCK${blocks.length - 1}\u0000`;
  });

  // Escape HTML for safety
  md = escapeHtml(md);

  // Headings
  md = md.replace(/^###\s+(.*)$/gm, '<h3>$1<\/h3>');
  md = md.replace(/^##\s+(.*)$/gm, '<h2>$1<\/h2>');
  md = md.replace(/^#\s+(.*)$/gm, '<h1>$1<\/h1>');

  // Links [text](url)
  md = md.replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>');

  // Bold and italic
  md = md.replace(/\*\*([^\n*][\s\S]*?)\*\*/g, '<strong>$1<\/strong>');
  md = md.replace(/_([^\n_][\s\S]*?)_/g, '<em>$1<\/em>');

  // Inline code `code` (avoid matching across code fences tokens)
  md = md.replace(/`([^`\n]+)`/g, '<code>$1<\/code>');

  // Bulleted lists (avoid converting inside fenced blocks by running after block extraction)
  md = md.replace(/(?:^|\n)([-*] [^\n`].*(?:\n[-*] [^\n`].*)*)/g, (m) => {
    const items = m.trim().split(/\n/)
      .map(li => li.replace(/^[-*]\s+/, ''))
      .map(t => `<li>${t}<\/li>`)
      .join('');
    return `\n<ul>${items}<\/ul>`;
  });

  // Line breaks
  md = md.replace(/\n/g, '<br>');

  // Restore code blocks (include language class if provided)
  md = md.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (m, idx) => {
    const i = Number(idx);
    const lang = langs[i] ? ` class=\"language-${langs[i]}\"` : '';
    return `<pre><code${lang}>${blocks[i]}<\/code><\/pre>`;
  });

  return md;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Unified Response Renderer ---
// Single function all models call to render Eva's response with images

// --- Image Generation & Rendering ---
// State: _lastUserAskedGenerate and _lastUserImageSubject declared near _detectGenerationIntent

/**
 * Check if user's message is asking for image generation (not just showing).
 */
function _isGenerationRequest(text) {
  if (!text) return false;
  return /\b(generate|create|draw|make|design|paint|render|imagine|produce|craft)\b.*\b(image|picture|photo|illustration|artwork|art|drawing|painting)\b/i.test(text) ||
         /\b(image|picture|illustration|artwork)\b.*\b(generate|create|draw|make|design)\b/i.test(text) ||
         /\bdall-?e\b/i.test(text);
}

/**
 * Generate an image using DALL-E 3.
 * @returns {Promise<string|null>} Image URL or null
 */
async function _generateImage(prompt) {
  var apiKey = (typeof getAuthKey === 'function') ? getAuthKey('OPENAI_API_KEY') : (typeof OPENAI_API_KEY !== 'undefined' ? OPENAI_API_KEY : '');
  if (!apiKey) {
    return null;
  }

  try {
    var resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024'
      })
    });

    if (!resp.ok) {
      return null;
    }

    var data = await resp.json();
    if (data.data && data.data[0] && data.data[0].url) {
      return data.data[0].url;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Render an Eva response with markdown and inline images.
 * Detects [Image of ...] placeholders, routes to DALL-E (generation)
 * or Wikimedia (search) based on the user's original request.
 */
async function renderEvaResponse(content, txtOutput) {
  if (!content || !content.trim()) {
    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> Sorry, can you please ask me in another way?</div>';
    txtOutput.scrollTop = txtOutput.scrollHeight;
    return;
  }

  var text = content.trim();

  // Detect image placeholders — multiple patterns models use
  var imagePatterns = [
    /\[Image of ([^\]]+)\]/gi,           // [Image of description]
    /\[image:\s*([^\]]+)\]/gi,           // [image: description]
    /\[🖼️?\s*([^\]]+)\]/gi,             // [🖼️ description] or [🖼 description]
    /!\[([^\]]*)\]\(\s*\)/g,             // ![alt]() — empty URL markdown images
    /\(Image:\s*([^)]+)\)/gi             // (Image: description) — some models use parens
  ];

  var imagePlaceholders = [];
  var seen = {};
  imagePatterns.forEach(function(rx) {
    var match;
    while ((match = rx.exec(text)) !== null) {
      if (!seen[match[0]]) {
        seen[match[0]] = true;
        // Use the user's original subject if available, otherwise extract from AI description
        var query = _lastUserImageSubject || _extractImageSubject(match[1].trim());
        imagePlaceholders.push({ full: match[0], query: query });
      }
    }
  });

  // Limit to 3 images per response
  imagePlaceholders = imagePlaceholders.slice(0, 3);

  if (imagePlaceholders.length > 0) {
    var useGeneration = _lastUserAskedGenerate;

    var fetchPromises = imagePlaceholders.map(function(ph) {
      if (useGeneration) {
        // Use the user's simple subject for DALL-E (avoids content policy triggers from verbose AI descriptions)
        var dallePrompt = _lastUserImageSubject || ph.query;
        return _generateImage(dallePrompt).then(function(url) {
          if (url) return { placeholder: ph, url: url, generated: true };
          // Fall back to search if generation fails
          return _searchImage(ph.query).then(function(url2) {
            return { placeholder: ph, url: url2, generated: false };
          });
        }).catch(function() {
          return { placeholder: ph, url: null, generated: false };
        });
      } else {
        return _searchImage(ph.query).then(function(url) {
          return { placeholder: ph, url: url, generated: false };
        }).catch(function() {
          return { placeholder: ph, url: null, generated: false };
        });
      }
    });

    var results = await Promise.all(fetchPromises);

    results.forEach(function(r) {
      if (r.url) {
        // Replace placeholder with image tag
        var genLabel = r.generated ? ' data-generated="true"' : '';
        var imgTag = '<img src="' + escapeHtml(r.url) + '" title="' + escapeHtml(r.placeholder.query) + '" alt="' + escapeHtml(r.placeholder.query) + '" class="eva-inline-img"' + genLabel + '>';
        if (r.generated) {
          imgTag = '<div class="eva-generated-wrap">' + imgTag + '<span class="eva-generated-badge">AI Generated</span></div>';
        }
        text = text.replace(r.placeholder.full, imgTag);
      } else {
        // Replace with a styled placeholder showing what was requested
        text = text.replace(r.placeholder.full, '[🖼️ ' + r.placeholder.query + ']');
      }
    });

    // If we successfully generated/found images, strip common AI disclaimers
    var anySuccess = results.some(function(r) { return r.url; });
    if (anySuccess && _lastUserAskedGenerate) {
      // Remove lines where the AI says it can't generate/create images
      text = text.replace(/I\s+(cannot|can't|can not|am unable to|don't have the ability to)\s+(generate|create|produce|make|draw|render)\s+(images?|pictures?|photos?|illustrations?|artwork)[^.]*\./gi, '');
      text = text.replace(/I\s+(can only|only)\s+describe[^.]*\./gi, '');
      text = text.replace(/\n{3,}/g, '\n\n'); // clean up extra blank lines
    }

    // Tokenize generated image wrappers and standalone <img> tags before markdown
    var imgFragments = [];
    text = text.replace(/<div class="eva-generated-wrap">[\s\S]*?<\/div>/g, function(m) {
      imgFragments.push(m);
      return '\u0000IMG' + (imgFragments.length - 1) + '\u0000';
    });
    text = text.replace(/<img[^>]*>/g, function(m) {
      imgFragments.push(m);
      return '\u0000IMG' + (imgFragments.length - 1) + '\u0000';
    });

    // Render markdown
    var html = (typeof renderMarkdown === 'function') ? renderMarkdown(text) : text;

    // Restore <img> tags
    html = html.replace(/\u0000IMG(\d+)\u0000/g, function(m, idx) {
      return imgFragments[Number(idx)] || m;
    });

    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> <div class="md">' + html + '</div></div>';
  } else {
    // No images or no search keys — just render markdown
    var html2 = (typeof renderMarkdown === 'function') ? renderMarkdown(text) : text;
    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> <div class="md">' + html2 + '</div></div>';
  }

  txtOutput.scrollTop = txtOutput.scrollHeight;
}

/**
 * Extract the key subject from a verbose image description.
 * "GitHub's Octocat mascot - a friendly cartoon cat..." → "GitHub Octocat mascot"
 */
function _extractImageSubject(rawDesc) {
  if (!rawDesc) return '';
  var desc = rawDesc;

  // Cut at first " - " or " — " or ", " comma phrase
  var dashIdx = desc.search(/\s[-–—]\s/);
  if (dashIdx > 3) desc = desc.substring(0, dashIdx);

  // Cut at first comma if still long (keep just the subject noun phrase)
  if (desc.length > 40) {
    var commaIdx = desc.indexOf(',');
    if (commaIdx > 3) desc = desc.substring(0, commaIdx);
  }

  // Cut at first period
  if (desc.length > 40) {
    var dotIdx = desc.indexOf('.');
    if (dotIdx > 3) desc = desc.substring(0, dotIdx);
  }

  // 1. Find proper nouns (capitalized words like "Octocat", "GitHub")
  var properNouns = desc.match(/\b[A-Z][a-zA-Z]+\b/g) || [];
  var ignoreCapitalized = new Set(['Image', 'Picture', 'Photo', 'The', 'An', 'This', 'Here', 'Its', 'Each', 'Very', 'Some', 'With', 'And']);
  properNouns = properNouns.filter(function(w) { return !ignoreCapitalized.has(w); });

  if (properNouns.length > 0) {
    return properNouns.slice(0, 4).join(' ');
  }

  // 2. Strip filler — keep nouns (which come early in the description)
  desc = desc
    .replace(/^(an?|the|image of|picture of|photo of|showing|depicting|illustration of)\s+/gi, '')
    .replace(/\b(friendly|cartoon|cartoonish|cute|classic|iconic|simple|round|large|small|playful|beloved|stylized|detailed|colorful|whimsical|famous|popular|vibrant|modern|typical|standard|featuring|with|that|has|and|or|its|soft|warm|bright|relaxed|graceful|sunny|patterned)\b\s*/gi, '')
    .replace(/[''\u2019]s\b/g, '')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Take FIRST 2-3 meaningful words (the subject noun is at the beginning)
  var words = desc.split(/\s+/).filter(function(w) { return w.length > 2; });
  if (words.length > 3) {
    desc = words.slice(0, 3).join(' ');
  }

  return desc || rawDesc.substring(0, 30);
}

/**
 * Search for an image using Wikimedia Commons (free, no API key needed).
 */
async function _searchImage(query) {
  if (!query) return null;

  var cleanQuery = query.trim();
  if (!cleanQuery) return null;

  // Try progressively simpler queries
  var queries = [cleanQuery];
  var words = cleanQuery.split(/\s+/);
  if (words.length > 2) queries.push(words.slice(0, 2).join(' '));
  if (words.length > 1) queries.push(words[words.length - 1]); // try just the last word (often the noun)

  for (var qi = 0; qi < queries.length; qi++) {
    var q = queries[qi];
    try {
      var wUrl = 'https://commons.wikimedia.org/w/api.php?' +
        'action=query&list=search&srnamespace=6' +
        '&srsearch=' + encodeURIComponent(q) +
        '&srlimit=5&format=json&origin=*';

      var wResp = await fetch(wUrl);
      if (wResp.ok) {
        var wData = await wResp.json();
        var results = (wData.query && wData.query.search) || [];
        if (results.length > 0) {
          // Get the actual image URL from the file title
          var fileTitle = results[0].title;
          var imgUrl = 'https://commons.wikimedia.org/w/api.php?' +
            'action=query&titles=' + encodeURIComponent(fileTitle) +
            '&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*';

          var imgResp = await fetch(imgUrl);
          if (imgResp.ok) {
            var imgData = await imgResp.json();
            var pages = imgData.query && imgData.query.pages;
            if (pages) {
              var pageId = Object.keys(pages)[0];
              var info = pages[pageId].imageinfo;
              if (info && info[0]) {
                return info[0].thumburl || info[0].url;
              }
            }
          }
        } else if (qi < queries.length - 1) {
          // Try simpler query
        }
      }
    } catch (e) {
      console.warn('Wikimedia search error:', e.message);
    }
  }

  return null;
}

// --- Image Lightbox ---
document.addEventListener('DOMContentLoaded', function() {
  var lightbox = document.getElementById('evaLightbox');
  var lightboxImg = document.getElementById('evaLightboxImg');
  var lightboxClose = lightbox ? lightbox.querySelector('.eva-lightbox-close') : null;

  // Click on any inline image to expand
  document.addEventListener('click', function(e) {
    var img = e.target.closest('.eva-inline-img');
    if (img && lightbox && lightboxImg) {
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt || 'Expanded image';
      lightbox.classList.add('open');
      e.preventDefault();
    }
  });

  // Close lightbox
  if (lightbox) {
    lightbox.addEventListener('click', function(e) {
      if (e.target === lightbox || e.target === lightboxClose) {
        lightbox.classList.remove('open');
      }
    });
  }

  // Escape key closes lightbox
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && lightbox && lightbox.classList.contains('open')) {
      lightbox.classList.remove('open');
    }
  });
});

// Capture Shift + Enter Keys for new line
function shiftBreak() {
document.querySelector("#txtMsg").addEventListener("keydown", function(event) {
  if (event.shiftKey && event.keyCode === 13) {
    var newLine = document.createElement("br");
    var sel = window.getSelection();
    var range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(newLine);
    range.setStartAfter(newLine);
    event.preventDefault();
  }
});

    // Capture Enter Key to Send Message and Backspace to reset position
    document.querySelector("#txtMsg").addEventListener("keydown", function(event) {
      if (event.keyCode === 13 && !event.shiftKey) {
        document.querySelector("#btnSend").click();
        event.preventDefault();
        var backspace = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          keyCode: 8
        });
        document.querySelector("#txtMsg").dispatchEvent(backspace);
      }
    });
}

// Clear Messages for Clear Memory Button
function clearMessages() {
    // Preserve auth keys and settings across clear
    var keysToKeep = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && (key.indexOf('auth_') === 0 || key === 'theme' || key === 'systemPrompt' || key === 'lcars_collapsed' || key === 'acp_bridge_url')) {
        keysToKeep.push({ k: key, v: localStorage.getItem(key) });
      }
    }
    localStorage.clear();
    keysToKeep.forEach(function(item) { localStorage.setItem(item.k, item.v); });
    document.getElementById("txtOutput").innerHTML = "\n" + "		MEMORY CLEARED";
}

// Text-to-Speech
function startSpeechRecognition() {
  const recognition = new webkitSpeechRecognition();
  recognition.lang = 'en-US';
  // recognition.continuous = true;

  const micButton = document.getElementById('micButton');
  micButton.classList.add('pulsate');

  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    document.getElementById('txtMsg').innerHTML = transcript + "?";
    recognition.stop();

    sendData();

    // remove the 'pulsate' class from the micButton to stop the pulsating animation
    micButton.classList.remove('pulsate');
  };
}
