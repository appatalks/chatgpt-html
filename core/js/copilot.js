// copilot.js
// GitHub Copilot / GitHub Models API integration
// Uses GitHub Personal Access Token (PAT) for authentication
// Endpoint: https://models.inference.ai.azure.com/chat/completions

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

  // Get GitHub PAT
  var githubToken = getAuthKey('GITHUB_PAT');
  if (!githubToken) {
    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="error">Error:</span> GitHub PAT not configured. Go to Settings \u2192 Auth and add your GitHub Personal Access Token.</div>';
    txtOutput.scrollTop = txtOutput.scrollHeight;
    setStatus('error', 'GitHub PAT not configured');
    return;
  }

  // Display user message
  var safeUser = escapeHtml(sQuestion).replace(/\n/g, '<br>');
  txtOutput.innerHTML += '<div class="chat-bubble user-bubble"><span class="user">You:</span> ' + safeUser + '</div>';
  txtMsg.innerHTML = '';
  txtOutput.scrollTop = txtOutput.scrollHeight;

  // Build messages payload
  if (!localStorage.getItem('copilotMessages')) {
    var sysPrompt = (typeof getSystemPrompt === 'function') ? getSystemPrompt() : '';
    var initMessages = [
      { role: 'system', content: sysPrompt + ' When you are asked to show an image, instead describe the image with [Image of <Description>]. ' + (typeof dateContents !== 'undefined' ? dateContents : '') }
    ];
    localStorage.setItem('copilotMessages', JSON.stringify(initMessages));
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

  var existingMessages = JSON.parse(localStorage.getItem('copilotMessages')) || [];
  existingMessages = existingMessages.concat(newMessages);
  localStorage.setItem('copilotMessages', JSON.stringify(existingMessages));

  // Get model (strip copilot- prefix)
  var selModel = document.getElementById('selModel');
  var model = selModel.value.replace(/^copilot-/, '');

  // Build payload
  var temp = (typeof getModelTemperature === 'function') ? getModelTemperature() : 0.7;
  var maxTok = (typeof getModelMaxTokens === 'function') ? getModelMaxTokens() : 4096;
  var payload = {
    model: model,
    messages: existingMessages,
    temperature: temp,
    max_tokens: maxTok
  };

  // Model-specific adjustments
  if (model === 'o3-mini') {
    var re = (typeof getReasoningEffort === 'function') ? getReasoningEffort() : 'medium';
    payload.reasoning_effort = re;
    delete payload.temperature;
  }

  setStatus('info', 'Sending to GitHub Models API (' + model + ')...');

  try {
    var url = 'https://models.inference.ai.azure.com/chat/completions';

    // Use proxy if configured for CORS
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
      return;
    }

    var data = await resp.json();
    var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

    if (!content) {
      txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> Sorry, can you please ask me in another way?</div>';
    } else {
      // Handle image placeholders
      if (content.includes('Image of') && typeof fetchGoogleImages === 'function') {
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
          // Tokenize images, render MD, restore
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
      } else {
        var mdHtml2 = (typeof renderMarkdown === 'function') ? renderMarkdown(content.trim()) : content;
        txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="eva">Eva:</span> <div class="md">' + mdHtml2 + '</div></div>';
      }

      lastResponse = content;

      // Store for masterOutput
      var outputWithoutTags = txtOutput.innerText + '\n';
      masterOutput += outputWithoutTags;
      localStorage.setItem('masterOutput', masterOutput);
    }

    txtOutput.scrollTop = txtOutput.scrollHeight;
    setStatus('info', 'Response received from GitHub Models (' + model + ')');

    // Auto-speak
    var checkbox = document.getElementById('autoSpeak');
    if (checkbox && checkbox.checked) {
      speakText();
      var audio = document.getElementById('audioPlayback');
      if (audio) audio.setAttribute('autoplay', true);
    }

  } catch (err) {
    console.error('Copilot error:', err);
    var errorMessage = err.message || String(err);

    // Detect CORS issues
    if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError') || errorMessage.includes('CORS')) {
      errorMessage += ' \u2014 This may be a CORS issue. Configure DEBUG_CORS and DEBUG_PROXY_URL in config.json, or use a CORS proxy.';
    }

    txtOutput.innerHTML += '<div class="chat-bubble eva-bubble"><span class="error">Error:</span> ' + escapeHtml(errorMessage) + '</div>';
    txtOutput.scrollTop = txtOutput.scrollHeight;
    setStatus('error', errorMessage);
  }
}
