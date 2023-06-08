// JavaScript
// For Google PaLM API ie Bard

function palmSend() {
  function auth() {
    return fetch('./config.json')
      .then(response => response.json())
      .then(config => config.GOOGLE_PALM_KEY);
  }

  let palmMessages = [];

  // Check if there are messages stored in local storage
  const storedPalmMessages = localStorage.getItem("palmMessages");
  if (storedPalmMessages) {
    palmMessages = JSON.parse(storedPalmMessages);
  }

  var sQuestion = document.getElementById("txtMsg").innerHTML;
  sQuestion = sQuestion.replace(/<br>/g, "\n");

  if (sQuestion.trim() == "") {
    alert("Type in your question!");
    txtMsg.focus();
    return;
  }

  const MODEL_NAME = "chat-bison-001";

  auth().then(GOOGLE_PALM_KEY => {
    document.getElementById("txtMsg").innerHTML = "";
    document.getElementById("txtOutput").innerHTML += "You: " + sQuestion + "\n";

    const gapiUrl = `https://generativelanguage.googleapis.com/v1beta2/models/${MODEL_NAME}:generateMessage?key=${GOOGLE_PALM_KEY}`;

    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: {
          context:
            "You are Eva, a knowledgeable AI language model. Your goal is to provide accurate and helpful responses to questions while being honest and straightforward. " + dateContents,
          examples: [],
          messages: palmMessages.concat([{ author: "0", content: sQuestion }])
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
          const imagePlaceholders = formattedResult.match(imagePlaceholderRegex);
       //   console.log("Image placeholders:", imagePlaceholders);

	if (imagePlaceholders) {
  	  for (let i = 0; i < Math.min(imagePlaceholders.length, 3); i++) {
    	  const placeholder = imagePlaceholders[i];
    	  const searchQuery = placeholder.substring(10, placeholder.length - 3).trim();
         //     console.log("Search query:", searchQuery);

              try {
                const searchResult = await fetchGoogleImages(searchQuery);
           //     console.log("Search result:", searchResult);

                if (searchResult && searchResult.items && searchResult.items.length > 0) {
                  const topImage = searchResult.items[0];
                  const imageLink = topImage.link;
             //     console.log("Top image link:", imageLink);
	       formattedResult = formattedResult.replace(placeholder, `<img src="${imageLink}" alt="${searchQuery}">`);
//	formattedResult = formattedResult.replace(placeholder,`<img src="${imageLink}" alt="${searchQuery}" class="palm-image" data-link="${imageLink}">`);
                }
              } catch (error) {
                console.error("Error fetching image:", error);
              }
            }
          }

          //  document.getElementById("txtOutput").innerHTML += `Eva: ${formattedResult}\n`;

          palmMessages.push({
            author: "0",
            content: sQuestion
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
	document.getElementById("txtOutput").innerHTML += `Eva: ${formattedResult}\n`;
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
  const maxResults = 3;

  return fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_KEY}&cx=${GOOGLE_SEARCH_ID}&searchType=image&num=${maxResults}&q=${encodeURIComponent(query)}`)
    .then((response) => response.json())
    .then((result) => result)
    .catch((error) => {
      console.error("Error fetching Google Images:", error);
      throw error;
    });
}
