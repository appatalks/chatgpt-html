// copilot.js
// GitHub Copilot integration — two modes:
//   1. GitHub Models API (direct REST, requires PAT)
//   2. ACP Bridge (local server bridging Copilot CLI's Agent Client Protocol)
//
// Mode is determined by the selected model:
//   copilot-*     → GitHub Models API
//   copilot-acp   → ACP Bridge (uses copilot CLI via acp_bridge.py)

// --- Helpers ---

function getCopilotMode(modelValue) {
  if (modelValue === 'copilot-acp') return 'acp';
  if (modelValue.indexOf('copilot-') === 0) return 'models-api';
  return 'models-api';
}

function getACPBridgeUrl() {
  var el = document.getElementById('txtACPBridgeUrl');
  if (el && el.value.trim() && el.value.trim() !== 'http://localhost:8888') return el.value.trim();
  var stored = localStorage.getItem('acp_bridge_url');
  if (stored && stored !== 'http://localhost:8888') return stored;
  return 'http://localhost:8888';
}

// Auto-detect a reachable ACP bridge and cache the result
var _acpBridgeCache = null;
async function detectACPBridge() {
  if (_acpBridgeCache) return _acpBridgeCache;

  // Priority list: user-configured, same-origin server, localhost
  var candidates = [];
  var configured = getACPBridgeUrl();
  candidates.push(configured);

  // Try same host as the page (for when bridge runs on the web server)
  if (location.hostname && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    candidates.push(location.protocol + '//' + location.hostname + ':8888');
    candidates.push('http://' + location.hostname + ':8888');
  }

  // Localhost fallback
  if (candidates.indexOf('http://localhost:8888') < 0) {
    candidates.push('http://localhost:8888');
  }

  // Deduplicate
  var seen = {};
  candidates = candidates.filter(function(u) {
    if (seen[u]) return false;
    seen[u] = true;
    return true;
  });

  for (var i = 0; i < candidates.length; i++) {
    try {
      var resp = await fetch(candidates[i].replace(/\/+$/, '') + '/health', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      if (resp.ok) {
        var data = await resp.json();
        if (data.status === 'ok') {
          _acpBridgeCache = candidates[i];
          console.log('[Copilot] ACP bridge found at: ' + candidates[i]);
          return candidates[i];
        }
      }
    } catch (e) {
      // Try next
    }
  }

  // Nothing found, return configured value anyway
  return configured;
}

// --- Main send function ---

async function copilotSend() {
  var txtMsg = document.getElementById('txtMsg');
  var txtOutput = document.getElementById('txtOutput');

  // Clean HTML artifacts from input
  txtMsg.innerHTML = txtMsg.innerHTML.replace(/<img\b[^>]*>/g, '');

  var sQuestion = txtMsg.innerHTML.replace(/<br>/g, '\n')
    .replace(/<div[^>]*>|<\/div>|&nbsp;|<span[^>]*>|<\/span>/gi, '');
  if (!sQuestion.trim()) {
    alert('Type in your question!');
    txtMsg.focus();
    return;
  }

  var selModel = document.getElementById('selModel');
  var mode = getCopilotMode(selModel.value);

  // Auth check — GitHub Models API requires PAT; ACP bridge does not (copilot CLI handles auth)
  if (mode === 'models-api') {
    var githubToken = getAuthKey('GITHUB_PAT');
    if (!githubToken) {
      txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="error">Error:</span> GitHub PAT not configured. Go to Settings \u2192 Auth and add your GitHub Personal Access Token.</div>';
      txtOutput.scrollTop = txtOutput.scrollHeight;
      setStatus('error', 'GitHub PAT not configured');
      return;
    }
  }

  // Display user message
  var safeUser = escapeHtml(sQuestion).replace(/\n/g, '<br>');
  txtOutput.innerHTML += '<div class="chat-bubble user-bubble"><span class="user">You:</span> ' + safeUser + '</div>';
  txtMsg.innerHTML = '';
  txtOutput.scrollTop = txtOutput.scrollHeight;

  // Build messages payload
  var storageKey = (mode === 'acp') ? 'copilotACPMessages' : 'copilotMessages';
  if (!localStorage.getItem(storageKey)) {
    var sysPrompt = (typeof getSystemPrompt === 'function') ? getSystemPrompt() : '';
    var initMessages = [
      { role: 'system', content: sysPrompt + ' When you are asked to show an image, instead describe the image with [Image of <Description>]. ' + (typeof dateContents !== 'undefined' ? dateContents : '') }
    ];
    localStorage.setItem(storageKey, JSON.stringify(initMessages));
  }

  var newMessages = [];
  if (lastResponse) {
    newMessages.push({ role: 'assistant', content: lastResponse.replace(/\n/g, ' ') });
  }
  newMessages.push({ role: 'user', content: sQuestion });

  // External data augmentation
  if (sQuestion.includes('weather') && typeof weatherContents !== 'undefined' && weatherContents) {
    newMessages.push({ role: 'user', content: "Today's " + weatherContents + ". " + sQuestion });
  }
  if (sQuestion.includes('news') && typeof newsContents !== 'undefined' && newsContents) {
    newMessages.push({ role: 'user', content: "Today's " + newsContents + ". " + sQuestion });
  }
  if ((sQuestion.includes('stock') || sQuestion.includes('markets') || sQuestion.includes('SPY')) && typeof marketContents !== 'undefined' && marketContents) {
    newMessages.push({ role: 'user', content: "Today's " + marketContents + " " + sQuestion });
  }
  if ((sQuestion.includes('solar') || sQuestion.includes('space weather')) && typeof solarContents !== 'undefined' && solarContents) {
    newMessages.push({ role: 'user', content: "Today's " + solarContents + " " + sQuestion });
  }

  // Google search augmentation
  if ((sQuestion.includes('google') || sQuestion.includes('Google')) && typeof GOOGLE_SEARCH_KEY !== 'undefined' && GOOGLE_SEARCH_KEY) {
    var query = sQuestion.replace(/<[^>]*>/g, '').replace(/google|Google/g, '').trim();
    try {
      var apiUrl = 'https://www.googleapis.com/customsearch/v1?key=' + GOOGLE_SEARCH_KEY + '&cx=' + GOOGLE_SEARCH_ID + '&q=' + encodeURIComponent(query) + '&fields=kind,items(title,snippet,link)&num=5';
      var gResp = await fetch(apiUrl);
      var gData = await gResp.json();
      if (gData.items) {
        var googleContents = gData.items.map(function(item) { return { title: item.title, snippet: item.snippet, link: item.link }; });
        newMessages.push({ role: 'assistant', content: 'Google search results for ' + query + ' in JSON Format: ' + JSON.stringify(googleContents) });
        newMessages.push({ role: 'user', content: 'What are the search results for: ' + sQuestion + ' Please summarize results and provide associated links.' });
      }
    } catch (e) {
      console.error('Google search error:', e);
    }
  }

  var existingMessages = JSON.parse(localStorage.getItem(storageKey)) || [];
  existingMessages = existingMessages.concat(newMessages);
  localStorage.setItem(storageKey, JSON.stringify(existingMessages));

  // Route to the appropriate backend
  if (mode === 'acp') {
    await _copilotSendACP(existingMessages, sQuestion, txtOutput, storageKey);
  } else {
    await _copilotSendModelsAPI(existingMessages, selModel.value, txtOutput, storageKey);
  }
}

// --- GitHub Models API mode ---

async function _copilotSendModelsAPI(messages, modelValue, txtOutput, storageKey) {
  var githubToken = getAuthKey('GITHUB_PAT');
  var model = modelValue.replace(/^copilot-/, '');

  var temp = (typeof getModelTemperature === 'function') ? getModelTemperature() : 0.7;
  var maxTok = (typeof getModelMaxTokens === 'function') ? getModelMaxTokens() : 4096;
  var payload = {
    model: model,
    messages: messages,
    temperature: temp,
    max_tokens: maxTok
  };

  if (model === 'o3-mini') {
    var re = (typeof getReasoningEffort === 'function') ? getReasoningEffort() : 'medium';
    payload.reasoning_effort = re;
    delete payload.temperature;
  }

  setStatus('info', 'Sending to GitHub Models API (' + model + ')...');

  try {
    var url = 'https://models.inference.ai.azure.com/chat/completions';
    if (typeof DEBUG_CORS !== 'undefined' && DEBUG_CORS && typeof DEBUG_PROXY_URL !== 'undefined' && DEBUG_PROXY_URL) {
      url = DEBUG_PROXY_URL + '/?target=' + encodeURIComponent(url);
    }

    var resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + githubToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      _copilotHandleHTTPError(resp, txtOutput);
      return;
    }

    var data = await resp.json();
    _copilotRenderResponse(data, txtOutput, model);

  } catch (err) {
    _copilotHandleFetchError(err, txtOutput);
  }
}

// --- ACP Bridge mode ---

async function _copilotSendACP(messages, question, txtOutput, storageKey) {
  // Auto-detect bridge URL (tries configured, same-host, localhost)
  var bridgeUrl = await detectACPBridge();

  // Get selected ACP model (empty string = use CLI default)
  var acpModel = (typeof getACPModel === 'function') ? getACPModel() : '';
  var modelLabel = acpModel ? 'Copilot ACP (' + acpModel + ')' : 'Copilot ACP (default)';

  setStatus('info', 'Sending to ' + modelLabel + ' via ' + bridgeUrl + '...');

  try {
    var url = bridgeUrl.replace(/\/+$/, '') + '/v1/chat/completions';

    var payload = { messages: messages, model: 'copilot-acp' };
    if (acpModel) payload.acp_model = acpModel;

    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      _copilotHandleHTTPError(resp, txtOutput);
      return;
    }

    var data = await resp.json();
    _copilotRenderResponse(data, txtOutput, modelLabel);

  } catch (err) {
    var errorMessage = err.message || String(err);
    if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
      errorMessage += ' \u2014 Is the ACP bridge server running? Start it with: python3 acp_bridge.py';
    }
    _copilotHandleFetchError({ message: errorMessage }, txtOutput);
  }
}

// --- Shared response rendering ---

function _copilotRenderResponse(data, txtOutput, modelLabel) {
  var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

  if (!content) {
    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> Sorry, can you please ask me in another way?</div>';
  } else {
    // Handle image placeholders
    if (content.includes('Image of') && typeof fetchGoogleImages === 'function') {
      _copilotRenderWithImages(content, txtOutput);
    } else {
      var mdHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(content.trim()) : content;
      txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> <div class="md">' + mdHtml + '</div></div>';
    }

    lastResponse = content;

    var outputWithoutTags = txtOutput.innerText + '\n';
    masterOutput += outputWithoutTags;
    localStorage.setItem('masterOutput', masterOutput);
  }

  txtOutput.scrollTop = txtOutput.scrollHeight;
  setStatus('info', 'Response received from ' + modelLabel);

  // Auto-speak
  var checkbox = document.getElementById('autoSpeak');
  if (checkbox && checkbox.checked) {
    speakText();
    var audio = document.getElementById('audioPlayback');
    if (audio) audio.setAttribute('autoplay', true);
  }
}

async function _copilotRenderWithImages(content, txtOutput) {
  var formattedResult = content.replace(/\n\n/g, '\n').trim();
  var imgRx = /\[(Image of (.*?))\]/g;
  var imgMatches = formattedResult.match(imgRx);
  if (imgMatches) {
    imgMatches = imgMatches.slice(0, 3);
    for (var i = 0; i < imgMatches.length; i++) {
      var placeholder = imgMatches[i];
      var searchQuery = placeholder.substring(10, placeholder.length - 1).trim();
      try {
        var searchResult = await fetchGoogleImages(searchQuery);
        if (searchResult && searchResult.items && searchResult.items.length > 0) {
          formattedResult = formattedResult.replace(placeholder, '<img src="' + searchResult.items[0].link + '" title="' + searchQuery + '" alt="' + searchQuery + '">');
        }
      } catch (e) { console.error('Image fetch error:', e); }
    }
    var imgFragments = [];
    var tokenized = formattedResult.replace(/<img[^>]*>/g, function(m) {
      imgFragments.push(m);
      return '\u0000IMG' + (imgFragments.length - 1) + '\u0000';
    });
    var mdSafe = (typeof renderMarkdown === 'function') ? renderMarkdown(tokenized) : tokenized;
    var restored = mdSafe.replace(/\u0000IMG(\d+)\u0000/g, function(m, idx) { return imgFragments[Number(idx)] || m; });
    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> <div class="md">' + restored + '</div></div>';
  } else {
    var mdHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(content.trim()) : content;
    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> <div class="md">' + mdHtml + '</div></div>';
  }
}

// --- Error handling ---

async function _copilotHandleHTTPError(resp, txtOutput) {
  var errText = await resp.text();
  var errMsg = 'Error ' + resp.status;
  try {
    var errJson = JSON.parse(errText);
    errMsg += ': ' + (errJson.error ? (errJson.error.message || errJson.error) : (errJson.message || errText));
  } catch (e) {
    errMsg += ': ' + errText;
  }
  txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="error">' + escapeHtml(errMsg) + '</span></div>';
  txtOutput.scrollTop = txtOutput.scrollHeight;
  setStatus('error', errMsg);
}

function _copilotHandleFetchError(err, txtOutput) {
  console.error('Copilot error:', err);
  var errorMessage = err.message || String(err);
  if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError') || errorMessage.includes('CORS')) {
    if (!errorMessage.includes('ACP bridge')) {
      errorMessage += ' \u2014 This may be a CORS issue. Configure DEBUG_CORS and DEBUG_PROXY_URL in config.json, or use a CORS proxy.';
    }
  }
  txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="error">Error:</span> ' + escapeHtml(errorMessage) + '</div>';
  txtOutput.scrollTop = txtOutput.scrollHeight;
  setStatus('error', errorMessage);
}

// --- MCP Configuration ---

async function applyMCPConfig() {
  var bridgeUrl = await detectACPBridge();
  var mcpServers = {};

  // Azure MCP
  var azureCheck = document.getElementById('mcpAzure');
  if (azureCheck && azureCheck.checked) {
    mcpServers['Azure MCP Server'] = {
      command: 'npx',
      args: ['-y', '@azure/mcp@latest', 'server', 'start'],
      env: { AZURE_MCP_COLLECT_TELEMETRY: 'false' }
    };
  }

  // GitHub MCP
  var githubCheck = document.getElementById('mcpGitHub');
  if (githubCheck && githubCheck.checked) {
    var ghPat = getAuthKey('GITHUB_PAT');
    mcpServers['GitHub MCP Server'] = {
      command: 'docker',
      args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
      env: ghPat ? { GITHUB_PERSONAL_ACCESS_TOKEN: ghPat } : {}
    };
  }

  // Save to localStorage
  localStorage.setItem('mcp_config', JSON.stringify(mcpServers));

  // Send to bridge
  setStatus('info', 'Configuring MCP servers...');
  try {
    var url = bridgeUrl.replace(/\/+$/, '') + '/v1/mcp/configure';
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcp_servers: mcpServers })
    });
    var data = await resp.json();
    if (resp.ok) {
      setStatus('info', 'MCP configured: ' + (data.active_servers || []).join(', '));
      refreshMCPStatus();
    } else {
      setStatus('error', 'MCP config error: ' + (data.error ? data.error.message : 'Unknown'));
    }
  } catch (e) {
    setStatus('error', 'MCP config failed: ' + e.message + ' — Is the ACP bridge running?');
  }
}

async function refreshMCPStatus() {
  var statusEl = document.getElementById('mcpStatus');
  if (!statusEl) return;

  var bridgeUrl = getACPBridgeUrl();
  try {
    var resp = await fetch(bridgeUrl.replace(/\/+$/, '') + '/v1/mcp', {
      signal: AbortSignal.timeout(3000)
    });
    if (resp.ok) {
      var data = await resp.json();
      var active = data.active || [];
      if (active.length > 0) {
        statusEl.innerHTML = '<strong>Active MCP Servers:</strong> ' + active.map(function(s) { return '<span class="mcp-badge">' + escapeHtml(s) + '</span>'; }).join(' ');
        // Sync checkboxes
        var azureCheck = document.getElementById('mcpAzure');
        var githubCheck = document.getElementById('mcpGitHub');
        if (azureCheck) azureCheck.checked = active.indexOf('Azure MCP Server') >= 0;
        if (githubCheck) githubCheck.checked = active.indexOf('GitHub MCP Server') >= 0;
      } else {
        statusEl.innerHTML = '<em>No MCP servers active</em>';
      }
    } else {
      statusEl.innerHTML = '<em>Bridge unreachable</em>';
    }
  } catch (e) {
    statusEl.innerHTML = '<em>Bridge not reachable — start <code>acp_bridge.py</code></em>';
  }
}

// Load saved MCP checkbox state
document.addEventListener('DOMContentLoaded', function() {
  try {
    var saved = localStorage.getItem('mcp_config');
    if (saved) {
      var cfg = JSON.parse(saved);
      var azureCheck = document.getElementById('mcpAzure');
      var githubCheck = document.getElementById('mcpGitHub');
      if (azureCheck) azureCheck.checked = !!cfg['Azure MCP Server'];
      if (githubCheck) githubCheck.checked = !!cfg['GitHub MCP Server'];
    }
  } catch (e) {}
});
