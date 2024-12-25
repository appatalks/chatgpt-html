// lm-studio.js
// Function to send data to local OpenAI-like endpoint

function lmsSend() {
    // Remove occurrences of specific syntax from the txtMsg element
    txtMsg.innerHTML = txtMsg.innerHTML.replace(/<div[^>]*>.*<\/div>/g, '');

    let openAIMessages = [
        {
            "role": "system",
            "content": selPers.value + " Images can be shown with this tag: [Image of <Description>]. " + dateContents
        },
        {
            "role": "assistant",
            "content": "I am Eva, a highly knowledgeable AI assistant designed to provide accurate, concise, and helpful responses to your questions. I aim to be honest and straightforward in my interactions with you. I emulate emotions to give more personable responses. While I may not possess all the answers, I will do my best to assist you with your inquiries."
        }
    ];

    // Check if there are messages stored in local storage
    const storedOpenAIMessages = localStorage.getItem("openAIMessages");
    if (storedOpenAIMessages) {
        openAIMessages = JSON.parse(storedOpenAIMessages);
    }

    const sQuestion = document.getElementById("txtMsg").innerHTML.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").trim();
    if (!sQuestion) {
        alert("Type in your question!");
        txtMsg.focus();
        return;
    }

    // Document the user's message
    document.getElementById("txtMsg").innerHTML = "";
    document.getElementById("txtOutput").innerHTML += '<span class="user">You: </span>' + sQuestion + "<br>\n";

    const openAIUrl = `http://localhost:1234/v1/chat/completions`;
    const requestOptions = {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
            model: "granite-3.1-8b-instruct", // Replace with your actual local model identifier
            messages: openAIMessages.concat([
                { role: "user", content: sQuestion }
            ]),
            temperature: 0.7, // Adjust as needed
        }),
    };

    fetch(openAIUrl, requestOptions)
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`Error: ${response.status}`)))
        .then(result => {
            const candidate = result.choices[0].message.content;

            document.getElementById("txtOutput").innerHTML += '<span class="eva">Eva: </span>' + candidate + "<br>\n";

            // Check for [Image of ...] tags
            const imageTagMatch = candidate.match(/\[Image of (.*?)\]/);
            if (imageTagMatch) {
                const imageQuery = imageTagMatch[1];
                fetchGoogleImages(imageQuery).then(imageResult => {
                    const imageUrl = imageResult.items[0].link;
                    document.getElementById("txtOutput").innerHTML += `<br><a href="${imageUrl}" target="_blank"><img src="${imageUrl}" alt="${imageQuery}"></a>`;
                }).catch(error => {
                    console.error("Error fetching image:", error);
                });
            }

            // Update conversation history
            openAIMessages.push({ role: "user", content: sQuestion });
            openAIMessages.push({ role: "assistant", content: candidate });
            localStorage.setItem("openAIMessages", JSON.stringify(openAIMessages));
        })
        .catch(error => {
            console.error("Error:", error);
            document.getElementById("txtOutput").innerHTML += '<span class="error">Error: </span>' + error.message + "<br>\n";
        });
}

// Function to handle sending data based on the selected model
function sendData() {
    if (selModel.value.startsWith("gpt")) {
        geminiSend(); // Use Google Gemini if the model starts with "gpt"
    } else {
        lmsSend(); // Use OpenAI-like local endpoint otherwise
    }
}
