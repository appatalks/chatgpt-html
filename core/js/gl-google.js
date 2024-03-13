// JavaScript
// For Google Generative Language API

// Google Gemini
function geminiSend() {
    // Remove occurrences of specific syntax from the txtMsg element
    txtMsg.innerHTML = txtMsg.innerHTML.replace(/<div[^>]*>.*<\/div>/g, '');

    function auth() {
        return fetch('./config.json')
            .then(response => response.json())
            .then(config => config.GOOGLE_GL_KEY); // Assuming you have a Gemini API key in your config
    }

    // let geminiMessages = [];

    let geminiMessages = [
        {
            "role": "user",
            "parts": [
                {
                    "text": "You are Eva, a highly knowledgeable AI assistant that emulates appropriate emotions. Your goal is to provide accurate, concise and helpful responses to questions while being honest and straightforward. When you are asked to show an image, instead describe the image with [Image of <Description>]. "
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

    var sQuestion = document.getElementById("txtMsg").innerHTML;
    sQuestion = sQuestion.replace(/<br>/g, "\n");
    const cleanedQuestion = sQuestion.replace(/<[^>]+>/g, "");

    if (sQuestion.trim() == "") {
        alert("Type in your question!");
        txtMsg.focus();
        return;
    }

    auth().then(GOOGLE_GL_KEY => {
        document.getElementById("txtMsg").innerHTML = "";
        document.getElementById("txtOutput").innerHTML += '<span class="user">You: </span>' + cleanedQuestion + "<br>" + "\n";
	var element = document.getElementById("txtOutput");
        element.scrollTop = element.scrollHeight;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.0-pro-latest:generateContent?key=${GOOGLE_GL_KEY}`;

        const requestOptions = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: geminiMessages.concat([
                    { role: "user", parts: [{ text: cleanedQuestion }] }
                ])
            }),
        };

        fetch(geminiUrl, requestOptions)
            .then(response => response.json())
	    .then(result => {
    	    // Check if the finishReason is RECITATION without any text output
    	    if (result.candidates[0].finishReason === "RECITATION") {
        	// document.getElementById("txtOutput").innerHTML += `Eva: Sorry, please ask me another way.\n`;
        	document.getElementById("txtOutput").innerHTML += '<span class="eva">Eva: Sorry, please ask me another way.</span>' + `\n`;
                var element = document.getElementById("txtOutput");
                element.scrollTop = element.scrollHeight;
    	    } else {
        	const textResponse = result.candidates[0].content.parts[0].text; // Correct path to access the response text
        	document.getElementById("txtOutput").innerHTML += '<span class="eva">Eva: </span>' + `${textResponse}`;
                var element = document.getElementById("txtOutput");
                element.scrollTop = element.scrollHeight;
        	// Check if the response contains an [Image of ...] tag
        	const imageTagMatch = textResponse.match(/\[Image of (.*?)\]/);
        	if (imageTagMatch) {
            	    const imageQuery = imageTagMatch[1]; // Extract the query from the tag
            	    fetchGoogleImages(imageQuery).then(imageResult => {
                    // Handle the result of the Google Images API
                    const imageUrl = imageResult.items[0].link; // Assuming the result has an items array and you want the first item's link
                    document.getElementById("txtOutput").innerHTML += `<img src="${imageUrl}" alt="${imageQuery}">`;
                    var element = document.getElementById("txtOutput");
                    element.scrollTop = element.scrollHeight;
            	}).catch(error => {
                    console.error("Error fetching image:", error);
            	});
        	}
    	    }

    // Update the conversation history with either the response or the RECITATION message
    geminiMessages.push({ role: "user", parts: [{ text: cleanedQuestion }] });
    const responseText = result.candidates[0].finishReason === "RECITATION" ? "Sorry, please ask me another way." : result.candidates[0].content.parts[0].text;
    geminiMessages.push({ role: "model", parts: [{ text: responseText }] });

    // Store updated messages in local storage
    localStorage.setItem("geminiMessages", JSON.stringify(geminiMessages));
})
.catch(error => {
    console.error("Error:", error);
});



    });
}

// Legacy Google Bard
function palmSend() {

  // Remove occurrences of the specific syntax from the txtMsg element
	txtMsg.innerHTML = txtMsg.innerHTML.replace(/<div[^>]*>.*<\/div>/g, '');

  function auth() {
    return fetch('./config.json')
      .then(response => response.json())
      .then(config => config.GOOGLE_GL_KEY);
  }

  let palmMessages = [];

  // Check if there are messages stored in local storage
  const storedPalmMessages = localStorage.getItem("palmMessages");
  if (storedPalmMessages) {
    palmMessages = JSON.parse(storedPalmMessages);
  }

  var sQuestion = document.getElementById("txtMsg").innerHTML;
  sQuestion = sQuestion.replace(/<br>/g, "\n");
  cleanedQuestion = sQuestion.replace(/<[^>]+>/g, "");
  console.log(sQuestion); 

  if (sQuestion.trim() == "") {
    alert("Type in your question!");
    txtMsg.focus();
    return;
  }

  const MODEL_NAME = "chat-bison-001";

  auth().then(GOOGLE_GL_KEY => {
    document.getElementById("txtMsg").innerHTML = "";
//    document.getElementById("txtOutput").innerHTML += "You: " + sQuestion + "\n";
    document.getElementById("txtOutput").innerHTML += '<span class="user">You: </span>' + sQuestion + "<br>" + "\n";
    var element = document.getElementById("txtOutput");
    element.scrollTop = element.scrollHeight;


    const gapiUrl = `https://generativelanguage.googleapis.com/v1beta2/models/${MODEL_NAME}:generateMessage?key=${GOOGLE_GL_KEY}`;

    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: {
          context:
            "You are Eva, a knowledgeable AI assistant. Your goal is to provide accurate, concise and helpful responses to questions while being honest and straightforward. You can display images using [Image of <description>]. " + dateContents,
          examples: [],
          messages: palmMessages.concat([{ author: "0", content: cleanedQuestion }])
        },
        temperature: 0.25,
        top_k: 40,
        top_p: 0.95,
        candidate_count: 1,
      }),
    };

    fetch(gapiUrl, requestOptions)
      .then((response) => response.json())
      .then(async (result) => {
        console.log("PaLM response:", result);

        if (result.filters && result.filters.length > 0) {
          // Handle case when no response is available
       //   console.log("No response available");
          document.getElementById("txtOutput").innerHTML += "No response available\n";
        } else {
          const candidate = result.candidates[0];
          const content = candidate.content;
          let formattedResult = content.replace(/\n\n/g, "\n").trim();
       //   console.log("Formatted result:", formattedResult);

          const imagePlaceholderRegex = /\[Image of (.*?)\]/g;
 	  const imagePlaceholders = formattedResult.match(imagePlaceholderRegex)?.slice(0, 3);

	if (imagePlaceholders) {
  	  for (let i = 0; i < Math.min(imagePlaceholders.length, 3); i++) {
    	  const placeholder = imagePlaceholders[i];
    	  const searchQuery = placeholder.substring(10, placeholder.length - 1).trim();
         //     console.log("Search query:", searchQuery);
              try {
                const searchResult = await fetchGoogleImages(searchQuery);
           //     console.log("Search result:", searchResult);
                if (searchResult && searchResult.items && searchResult.items.length > 0) {
                  const topImage = searchResult.items[0];
                  const imageLink = topImage.link;
             //     console.log("Top image link:", imageLink);
	       formattedResult = formattedResult.replace(placeholder, `<img src="${imageLink}" title="${searchQuery}" alt="${searchQuery}">`);
                }
              } catch (error) {
                console.error("Error fetching image:", error);
              }
            }
		  formattedResult = formattedResult.replace(imagePlaceholderRegex, "").trim();
		  formattedResult = formattedResult.replace(/\n{2,}/g, "\n").trim();
          }

          palmMessages.push({
            author: "0",
            content: cleanedQuestion
          });

          palmMessages.push({
            author: "1",
            content: formattedResult
          });

          // Output citations if available
          if (candidate.citationMetadata && candidate.citationMetadata.citationSources) {
            const citations = candidate.citationMetadata.citationSources;
            formattedResult += "\n\nCitations:";
            citations.forEach((citation, index) => {
              formattedResult += `\n${index + 1}. ${citation.uri}`;
            });
          }
	document.getElementById("txtOutput").innerHTML += '<span class="eva">Eva: </span>' + `${formattedResult}`;
        var element = document.getElementById("txtOutput");
        element.scrollTop = element.scrollHeight;
        }

        // Store updated messages in local storage
        localStorage.setItem("palmMessages", JSON.stringify(palmMessages));

        let outputWithoutTags = txtOutput.innerText + "\n";
        masterOutput += outputWithoutTags;
        localStorage.setItem("masterOutput", masterOutput);
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  });
}

function fetchGoogleImages(query) {
  const maxResults = 1;

  return fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_KEY}&cx=${GOOGLE_SEARCH_ID}&searchType=image&num=${maxResults}&sort_by=""&q=${encodeURIComponent(query)}`)
    .then((response) => response.json())
    .then((result) => result)
    .catch((error) => {
      console.error("Error fetching Google Images:", error);
      throw error;
    });
}
