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
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            // "Authorization": "Bearer " + OPENAI_API_KEY
        },
        body: JSON.stringify({
            model: "granite-3.1-8b-instruct", // Replace with your actual local model identifier
            // model: "gpt-4o-mini", // Proxy directly to OpenAI
            // model: "tiger-gemma-9b-v3", // Good uncensored model

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

                        // Render Markdown like OpenAI path; inline image placeholders if present
                        const out = document.getElementById("txtOutput");
                        let content = String(candidate || '').trim();

                        try {
                            if (content.includes("Image of")) {
                                let formattedResult = content.replace(/\n\n/g, "\n").trim();
                                const imagePlaceholderRegex = /\[(Image of (.*?))\]/g;
                                const imagePlaceholders = formattedResult.match(imagePlaceholderRegex)?.slice(0, 3);

                                if (imagePlaceholders && imagePlaceholders.length) {
                                    for (let i = 0; i < Math.min(imagePlaceholders.length, 3); i++) {
                                        const placeholder = imagePlaceholders[i];
                                        const searchQuery = placeholder.substring(10, placeholder.length - 1).trim();
                                        try {
                                            const searchResult = await fetchGoogleImages(searchQuery);
                                            if (searchResult && searchResult.items && searchResult.items.length > 0) {
                                                const topImage = searchResult.items[0];
                                                const imageLink = topImage.link;
                                                formattedResult = formattedResult.replace(placeholder, `<img src="${imageLink}" title="${searchQuery}" alt="${searchQuery}">`);
                                            }
                                        } catch (err) {
                                            console.error("Error fetching image:", err);
                                        }
                                    }
                                    // Tokenize inserted <img> tags, run markdown safely, then restore <img>
                                    const imgFragments = [];
                                    const tokenized = formattedResult.replace(/<img[^>]*>/g, (m) => {
                                        imgFragments.push(m);
                                        return `\u0000IMG${imgFragments.length - 1}\u0000`;
                                    });
                                    const mdSafe = (typeof renderMarkdown === 'function') ? renderMarkdown(tokenized) : tokenized;
                                    const restored = mdSafe.replace(/\u0000IMG(\d+)\u0000/g, (m, idx) => imgFragments[Number(idx)] || m);
                                    out.innerHTML += '<div class="chat-bubble eva-bubble">' + '<span class="eva">Eva:</span> ' + '<div class="md">' + restored + '</div>' + '</div>';
                                    out.scrollTop = out.scrollHeight;
                                } else {
                                    const mdHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(content) : content;
                                    out.innerHTML += '<div class="chat-bubble eva-bubble">' + '<span class="eva">Eva:</span> ' + '<div class="md">' + mdHtml + '</div>' + '</div>';
                                    out.scrollTop = out.scrollHeight;
                                }
                            } else {
                                const mdHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(content) : content;
                                out.innerHTML += '<div class="chat-bubble eva-bubble">' + '<span class="eva">Eva:</span> ' + '<div class="md">' + mdHtml + '</div>' + '</div>';
                                out.scrollTop = out.scrollHeight;
                            }
                        } catch (e) {
                            console.error('LM Studio render error:', e);
                            // Fallback to plain text
                            out.innerHTML += '<div class="chat-bubble eva-bubble">' + '<span class="eva">Eva:</span> ' + content + '</div>';
                            out.scrollTop = out.scrollHeight;
                        }

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
                })
        .catch(error => {
            console.error("Error:", error);
            document.getElementById("txtOutput").innerHTML += '<span class="error">Error: </span>' + error.message + "<br>\n";
        });
}

// Redundant ?
// Function to handle sending data based on the selected model
// function sendData() {
//         lmsSend(); // Use OpenAI-like local endpoint
// }
