// JavaScript
// For Google Generative Language API

// Google Gemini

function geminiSend() {
    // Remove occurrences of specific syntax from the txtMsg element
    txtMsg.innerHTML = txtMsg.innerHTML.replace(/<div[^>]*>.*<\/div>/g, '');

    function getGoogleGlKey() {
        // Prefer local inline config if present
        if (typeof window !== 'undefined' && window.__LOCAL_CONFIG__ && window.__LOCAL_CONFIG__.GOOGLE_GL_KEY) {
            return Promise.resolve(window.__LOCAL_CONFIG__.GOOGLE_GL_KEY);
        }
        // If options.js loaded config already, use global variable
        if (typeof GOOGLE_GL_KEY !== 'undefined' && GOOGLE_GL_KEY) {
            return Promise.resolve(GOOGLE_GL_KEY);
        }
        // Fallback to config.json (requires http(s) server)
        return fetch('./config.json')
            .then(r => r.ok ? r.json() : Promise.reject(new Error('Missing config.json')))
            .then(cfg => cfg.GOOGLE_GL_KEY);
    }

    let geminiMessages = [
        {
            "role": "user",
            "parts": [
                {
                    "text": selPers.value + " When you are asked to show an image, instead describe the image with [Image of <Description>]. " + dateContents
                }
            ]
        },
        {
            "role": "model",
            "parts": [
                {
                    "text": "I am Eva, a highly knowledgeable AI assistant designed to provide accurate, concise, and helpful responses to your questions. I aim to be honest and straightforward in my interactions with you. I emulate emotions to give more personable responses. While I may not possess all the answers, I will do my best to assist you with your inquiries."
                }
            ]
        }
    ];

    // Check if there are messages stored in local storage
    const storedGeminiMessages = localStorage.getItem("geminiMessages");
    if (storedGeminiMessages) {
        geminiMessages = JSON.parse(storedGeminiMessages);
    }

    const sQuestion = document.getElementById("txtMsg").innerHTML.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").trim();
    if (!sQuestion) {
        alert("Type in your question!");
        txtMsg.focus();
        return;
    }

    getGoogleGlKey().then(GOOGLE_GL_KEY => {
        document.getElementById("txtMsg").innerHTML = "";
        document.getElementById("txtOutput").innerHTML += '<span class="user">You: </span>' + sQuestion + "<br>\n";

    const geminiUrl = `https://generativelanguage.googleapis.com/v1alpha/models/gemini-2.0-flash-thinking-exp:generateContent?key=${GOOGLE_GL_KEY}`;

	const requestOptions = {
    	   method: "POST",
    	   headers: { "Content-Type": "application/json" },
    	   body: JSON.stringify({
               contents: geminiMessages.concat([
            	   { role: "user", parts: [{ text: sQuestion }] }
        	]),
        	systemInstruction: geminiMessages[0], // Assuming the first message is the system instruction
        	generationConfig: {
            	    temperature: 0.7, 
            	    // maxOutputTokens: 1024, 
            	    responseMimeType: "text/plain",
            	    thinking_config: { include_thoughts: true } // Enable thinking
        	}
    	   }),
	};

    fetch(geminiUrl, requestOptions)
            .then(response => response.ok ? response.json() : Promise.reject(new Error(`Error: ${response.status}`))) // Updated Error handling
            .then(result => {
                if (result.candidates[0].finishReason === "RECITATION") {
                    document.getElementById("txtOutput").innerHTML += '<span class="eva">Eva: Sorry, please ask me another way.</span><br>\n';
                } else { 
                    const candidate = result.candidates[0].content.parts;

                    // Extract thoughts and non-thoughts separately
                    const thoughts = candidate.filter(part => part.thought).map(part => part.text).join("\n\n");
                    const nonThoughts = candidate.filter(part => !part.thought);

                    // Display thoughts (if any)
                    if (thoughts) {
                        document.getElementById("txtOutput").innerHTML += '<span class="eva-thoughts">Eva\'s Thoughts:</span><br>' + thoughts + "<br><br>\n";
                    }

                                        // Display main response as Markdown with optional inline images
                                        (async () => {
                                            let mainResponse = nonThoughts.map(part => part.text).join("\n").trim();
                                            const out = document.getElementById("txtOutput");
                                            try {
                                                if (mainResponse.includes("Image of")) {
                                                    let formatted = mainResponse.replace(/\n\n/g, "\n");
                                                    const rx = /\[(Image of (.*?))\]/g;
                                                    const matches = formatted.match(rx)?.slice(0, 3);
                                                    if (matches && matches.length) {
                                                        for (let i = 0; i < matches.length; i++) {
                                                            const placeholder = matches[i];
                                                            const q = placeholder.substring(10, placeholder.length - 1).trim();
                                                            try {
                                                                const res = await fetchGoogleImages(q);
                                                                const link = res && res.items && res.items[0] && res.items[0].link;
                                                                if (link) {
                                                                    formatted = formatted.replace(placeholder, `<img src="${link}" title="${q}" alt="${q}">`);
                                                                }
                                                            } catch (e) {
                                                                console.error('Error fetching image:', e);
                                                            }
                                                        }
                                                    }
                                                    // Tokenize <img>, render MD, restore
                                                    const imgs = [];
                                                    const tokenized = formatted.replace(/<img[^>]*>/g, m => {
                                                        imgs.push(m);
                                                        return `\u0000IMG${imgs.length - 1}\u0000`;
                                                    });
                                                    const mdSafe = (typeof renderMarkdown === 'function') ? renderMarkdown(tokenized) : tokenized;
                                                    const restored = mdSafe.replace(/\u0000IMG(\d+)\u0000/g, (m, i) => imgs[Number(i)] || m);
                                                    out.innerHTML += '<div class="chat-bubble eva-bubble">' + '<span class="eva">Eva:</span> ' + '<div class="md">' + restored + '</div>' + '</div>';
                                                    out.scrollTop = out.scrollHeight;
                                                } else {
                                                    const mdHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(mainResponse) : mainResponse;
                                                    out.innerHTML += '<div class="chat-bubble eva-bubble">' + '<span class="eva">Eva:</span> ' + '<div class="md">' + mdHtml + '</div>' + '</div>';
                                                    out.scrollTop = out.scrollHeight;
                                                }
                                            } catch (e) {
                                                console.error('Gemini render error:', e);
                                                out.innerHTML += '<div class="chat-bubble eva-bubble">' + '<span class="eva">Eva:</span> ' + mainResponse + '</div>';
                                                out.scrollTop = out.scrollHeight;
                                            }
                                        })();

                    // Update conversation history: log both thoughts and non-thoughts
                    geminiMessages.push({ role: "user", parts: [{ text: sQuestion }] });
                    geminiMessages.push({ role: "model", parts: [...candidate] }); // Log the entire candidate
                    localStorage.setItem("geminiMessages", JSON.stringify(geminiMessages));
                }
	    })
            .catch(error => {
                console.error("Error:", error);
                document.getElementById("txtOutput").innerHTML += '<span class="error">Error: </span>' + error.message + "<br>\n";
            });
    });
}

function fetchGoogleImages(query) {
    const maxResults = 1;

    return fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_KEY}&cx=${GOOGLE_SEARCH_ID}&searchType=image&num=${maxResults}&q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(result => result)
        .catch(error => {
            console.error("Error fetching Google Images:", error);
            throw error;
        });
}
