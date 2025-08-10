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
  GOOGLE_SEARCH_KEY = config.GOOGLE_SEARCH_KEY;
  GOOGLE_SEARCH_ID = config.GOOGLE_SEARCH_ID;
  GOOGLE_VISION_KEY = config.GOOGLE_VISION_KEY;
  // CORS debug
  DEBUG_CORS = !!config.DEBUG_CORS;
  DEBUG_PROXY_URL = config.DEBUG_PROXY_URL || "";
  AWS.config.region = config.AWS_REGION;
  AWS.config.credentials = new AWS.Credentials(config.AWS_ACCESS_KEY_ID, config.AWS_SECRET_ACCESS_KEY);
}

// --- Model option filtering per theme (LCARS-restricted) ---
// Cache of the original full model list and last non-LCARS selection
var __originalModelOptions = null;
var __modelBeforeLCARS = null;

function captureOriginalModelOptions() {
  if (__originalModelOptions) return;
  var sel = document.getElementById('selModel');
  if (!sel) return;
  __originalModelOptions = Array.from(sel.options).map(function(o){
    return { value: o.value, text: o.text, title: o.title || '' };
  });
}

function setModelOptions(list) {
  var sel = document.getElementById('selModel');
  if (!sel) return;
  var currentValue = sel.value;
  // Rebuild options
  sel.innerHTML = '';
  list.forEach(function(item){
    var opt = document.createElement('option');
    opt.value = item.value;
    opt.text = item.text;
    if (item.title) opt.title = item.title;
    sel.appendChild(opt);
  });
  // Try to keep current selection if still present; otherwise select first
  var hasCurrent = list.some(function(i){ return i.value === currentValue; });
  sel.value = hasCurrent ? currentValue : (list[0] ? list[0].value : '');
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
    var allowed = new Set(['gpt-5-mini', 'o3-mini', 'dall-e-3', 'gemini', 'lm-studio']);
    var filtered = (__originalModelOptions || []).filter(function(o){ return allowed.has(o.value); });
    if (filtered.length) {
      setModelOptions(filtered);
    }
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
    settingsMenu.style.display =
      (settingsMenu.style.display === 'none' || !settingsMenu.style.display)
        ? 'block'
        : 'none';
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
      settingsMenu.style.display = 'none';
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


function updateButton() {
    var selModel = document.getElementById("selModel");
    var btnSend = document.getElementById("btnSend");

  if (selModel.value == "gpt-4o-mini" || selModel.value == "o1" || selModel.value == "o1-mini" || selModel.value == "gpt-4o" || selModel.value == "o3-mini" || selModel.value == "o1-preview" || selModel.value == "gpt-5-mini" || selModel.value == "latest") {
        btnSend.onclick = function() {
            clearText();
            trboSend();
        };
    } else if (selModel.value == "gemini") {
        btnSend.onclick = function() {
            clearText();
            geminiSend();
        };
   } else if (selModel.value == "lm-studio") {
        btnSend.onclick = function() {
            clearText();
            lmsSend();
        };
    } else if (selModel.value == "dall-e-3") {
        btnSend.onclick = function() {
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

  if (selModel.value == "gpt-4o-mini" || selModel.value == "o1" || selModel.value == "o1-mini" || selModel.value == "gpt-4o" || selModel.value == "o3-mini" || selModel.value == "o1-preview" || selModel.value == "gpt-5-mini" || selModel.value == "latest") {
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

// --- Lightweight token/context window monitor ---
// Simple per-character heuristic when tokenizer not available
function estimateTokensFromText(str) {
  if (!str) return 0;
  // crude: ~4 chars per token
  return Math.ceil(String(str).length / 4);
}

// Map of model -> context window size (approx) for display
const MODEL_CONTEXT_WINDOWS = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'o1': 200000,
  'o1-mini': 200000,
  'o1-preview': 200000,
  'o3-mini': 200000,
  'gpt-5-mini': 200000,
  'latest': 200000,
  'gemini': 128000,
  'lm-studio': 32768,
  'dall-e-3': 0
};

function getSelectedModel() {
  const sel = document.getElementById('selModel');
  return sel ? sel.value : '';
}

function computeMessagesTokens() {
  try {
    const raw = localStorage.getItem('messages');
    if (!raw) return 0;
    const msgs = JSON.parse(raw);
    let acc = 0;
    msgs.forEach(m => {
      if (!m) return;
      if (typeof m.content === 'string') {
        acc += estimateTokensFromText(m.content);
      } else if (Array.isArray(m.content)) {
        m.content.forEach(part => {
          if (part.type === 'text' && part.text) acc += estimateTokensFromText(part.text);
          // ignore images for now
        });
      }
    });
    return acc;
  } catch(e) { return 0; }
}

function computeLastResponseTokens() {
  try {
    const txtOut = document.getElementById('txtOutput');
    if (!txtOut) return 0;
    // grab last Eva bubble text, fall back to all innerText
    const evaSpans = txtOut.querySelectorAll('.eva');
    let last = '';
    if (evaSpans && evaSpans.length) {
      last = evaSpans[evaSpans.length - 1].parentElement ? evaSpans[evaSpans.length - 1].parentElement.textContent : evaSpans[evaSpans.length - 1].textContent;
    } else {
      last = txtOut.textContent || '';
    }
    return estimateTokensFromText(last);
  } catch(e) { return 0; }
}

function updateTokenMonitor() {
  const model = getSelectedModel();
  const windowSize = MODEL_CONTEXT_WINDOWS[model] || 128000;
  const msgTokens = computeMessagesTokens();
  const respTokens = computeLastResponseTokens();
  const used = msgTokens + respTokens;
  const pct = windowSize > 0 ? Math.min(100, Math.round((used / windowSize) * 100)) : 0;

  const bar = document.getElementById('ctxFillBar');
  const text = document.getElementById('ctxFillText');
  const winText = document.getElementById('modelWindowText');
  const msgText = document.getElementById('messagesTokensText');
  const respText = document.getElementById('lastResponseTokensText');
  if (bar) bar.style.width = pct + '%';
  if (text) text.textContent = pct + '% (' + used + ' / ' + windowSize + ')';
  if (winText) winText.textContent = windowSize ? (windowSize.toLocaleString() + ' tokens') : '—';
  if (msgText) msgText.textContent = msgTokens.toLocaleString();
  if (respText) respText.textContent = respTokens.toLocaleString();
}

// Periodic update
setInterval(updateTokenMonitor, 1500);
// Also update on model change
document.addEventListener('DOMContentLoaded', function(){
  const sel = document.getElementById('selModel');
  if (sel) sel.addEventListener('change', updateTokenMonitor);
  updateTokenMonitor();
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
    localStorage.clear();
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
