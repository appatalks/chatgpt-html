// lm-studio.js
// Function to send data to local OpenAI-like endpoint

function lmsSend() {
    // Remove occurrences of specific syntax from the txtMsg element
    txtMsg.innerHTML = txtMsg.innerHTML.replace(/<div[^>]*>.*<\/div>/g, '');

    let openLLMessages = [
        {
            "role": "system",
            "content": ((typeof getSystemPrompt === 'function') ? getSystemPrompt() : '') + " Images can be shown with this tag: [Image of <Description>]. " + dateContents
        },
        {
            "role": "assistant",
            "content": "I am Eva, a highly knowledgeable AI assistant designed to provide accurate, concise, and helpful responses to your questions. I aim to be honest and straightforward in my interactions with you. I emulate emotions to give more personable responses. While I may not possess all the answers, I will do my best to assist you with your inquiries."
        }
    ];

    // Check if there are messages stored in local storage
    const storedopenLLMessages = localStorage.getItem("openLLMessages");
    if (storedopenLLMessages) {
        openLLMessages = JSON.parse(storedopenLLMessages);
    }

    const sQuestion = document.getElementById("txtMsg").innerHTML.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").trim();
    if (!sQuestion) {
        alert("Type in your question!");
        txtMsg.focus();
        return;
    }

    // --- Cognition: Fetch memory context from bridge ---
    var _lmsMemoryPromise = Promise.resolve('');
    try {
      var _bridgeUrl = (typeof getACPBridgeUrl === 'function') ? getACPBridgeUrl() : 'http://localhost:8888';
      _lmsMemoryPromise = fetch(_bridgeUrl.replace(/\/+$/, '') + '/v1/memory/context?message=' + encodeURIComponent(sQuestion), {
        signal: AbortSignal.timeout(3000)
      }).then(function(r) { return r.ok ? r.json() : { context: '' }; })
        .then(function(d) { return (d.context && d.cognition_enabled) ? d.context : ''; })
        .catch(function() { return ''; });
    } catch (e) {}

    _lmsMemoryPromise.then(function(_memCtx) {
      // Inject memory context into system message if available
      if (_memCtx && openLLMessages.length > 0 && openLLMessages[0].role === 'system') {
        openLLMessages[0].content = _memCtx + '\n\n' + openLLMessages[0].content;
      }

                // Document the user's message (match chat-bubble UI and sanitize)
                document.getElementById("txtMsg").innerHTML = "";
                (function appendUserBubble(raw){
                    const safe = (function escapeHtmlLite(str){
                        return String(str)
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;')
                            .replace(/'/g, '&#39;');
                    })(raw).replace(/\n/g, '<br>');
                    const wrap = '<div class="chat-bubble user-bubble">' + '<span class="user">You:</span> ' + safe + '</div>';
                    const out = document.getElementById("txtOutput");
                    out.innerHTML += wrap;
                    out.scrollTop = out.scrollHeight;
                })(sQuestion);

    const openAIUrl = `http://localhost:1234/v1/chat/completions`;
    // const openAIUrl = `http://192.168.86.69:1234/v1/chat/completions`;
    // const openAIUrl = "https://api.openai.com/v1/chat/completions" ;
    const requestOptions = {
        method: "POST",
        headers: { 
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "granite-3.1-8b-instruct",

            messages: openLLMessages.concat([
                { role: "user", content: sQuestion }
            ]),
            temperature: 0.7, // Adjust as needed
        }),
    };

        fetch(openAIUrl, requestOptions)
                .then(response => response.ok ? response.json() : Promise.reject(new Error(`Error: ${response.status}`)))
                .then(async (result) => {
                        const candidate = (result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '';

                        // Render via unified renderer
                        const out = document.getElementById("txtOutput");
                        await renderEvaResponse(candidate, out);

                        // Update conversation history
                        openLLMessages.push({ role: "user", content: sQuestion });
                        openLLMessages.push({ role: "assistant", content: candidate });
                        localStorage.setItem("openLLMessages", JSON.stringify(openLLMessages));

                        // Auto-speak
                        const checkbox = document.getElementById("autoSpeak");
                        if (checkbox && checkbox.checked) {
                            speakText();
                            const audio = document.getElementById("audioPlayback");
                            if (audio) audio.setAttribute("autoplay", true);
                        }

                        // --- Cognition: Post-response reflection ---
                        try {
                          var _brUrl = (typeof getACPBridgeUrl === 'function') ? getACPBridgeUrl() : 'http://localhost:8888';
                          fetch(_brUrl.replace(/\/+$/, '') + '/v1/memory/reflect', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              user_message: sQuestion.substring(0, 500),
                              assistant_message: candidate.substring(0, 500),
                              model: 'lm-studio'
                            }),
                            signal: AbortSignal.timeout(5000)
                          }).catch(function() {});
                        } catch (e) {}
                })
        .catch(error => {
            console.error("Error:", error);
            document.getElementById("txtOutput").innerHTML += '<span class="error">Error: </span>' + error.message + "<br>\n";
        });
    }); // end _lmsMemoryPromise.then
}
