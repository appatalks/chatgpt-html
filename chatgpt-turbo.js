// Javascript
// For OpenAI API

// gpt-3.5-turbo + gpt-4 API Call 
function trboSend() {

  // Remove occurrences of the specific syntax from the txtMsg element
	txtMsg.innerHTML = txtMsg.innerHTML.replace(/<img\b[^>]*>/g, '');

  var sQuestion = txtMsg.innerHTML;
    sQuestion = sQuestion.replace(/<br>/g, "\n");
  if (sQuestion.trim() == "") {
    alert("Type in your question!");
    txtMsg.focus();
    return;
  }

    var oHttp = new XMLHttpRequest();
    oHttp.open("POST", "https://api.openai.com/v1/chat/completions");
    oHttp.setRequestHeader("Accept", "application/json");
    oHttp.setRequestHeader("Content-Type", "application/json");
    oHttp.setRequestHeader("Authorization", "Bearer " + OPENAI_API_KEY)

    // Error Handling - Needs more testing
    oHttp.onreadystatechange = async function () {
        if (oHttp.readyState === 4) {
    	  // Check for errors
    	  if (oHttp.status === 500) {
      	    txtOutput.innerHTML += "<br> Error 500: Internal Server Error" + "<br>" + oHttp.responseText;
      	    console.log("Error 500: Internal Server Error chatgpt-turbo.js Line 26");
      	    return;
    	  }
    	  if (oHttp.status === 429) {
      	    txtOutput.innerHTML += "<br> Error 429: Too Many Requests" + "<br>" + oHttp.responseText;
            console.log("Error 429: Too Many Requests chatgpt-turbo.js Line 31");
      	    return;
    	  }
          if (oHttp.status === 404) {
            txtOutput.innerHTML += "<br> Error 404: Not Found" + "<br>" + oHttp.responseText;
            console.log("Error 404: Not Found chatgpt-turbo.js Line 36");
            return;
          }
          if (oHttp.status === 400) {
            txtOutput.innerHTML += "<br> Error 400: Invalid Request" + "<br>" + oHttp.responseText;
            console.log("Error 400: Invalid Request  chatgpt-turbo.js Line 41");
            return;
          }
            //console.log(oHttp.status);
            var oJson = {}
            if (txtOutput.innerHTML != "") txtOutput.innerHTML += "\n"; // User Send Data
            try {
                oJson = JSON.parse(oHttp.responseText);  // API Response Data
		console.log("oJson", oJson);
            } catch (ex) {
                txtOutput.innerHTML += "Error: " + ex.message;
		console.log("Error: chatgpt-turbo.js Line 52");
		return;
              }
	
	// EasterEgg
	if ((oJson.usage.completion_tokens === 420) || (oJson.usage.total_tokens === 420)) {
          function displayImage() {
	      var image = document.getElementById("eEgg");
	      image.style.display = "flex";
	      setTimeout(function() {
	        image.style.opacity = 1;
  	      }, 50);
  	      setTimeout(function() {
    		image.style.opacity = 0;
  	      }, 2420);
  	      setTimeout(function() {
    		image.style.display = "none";
  	      }, 2920);
           }
          displayImage();
        }
	
	// Timeout Error Exponetial Backoff 
        if (oJson.error && oJson.error.message) {
	    if (oJson.error.message == "overloaded" && retryCount < maxRetries) {
                retryCount++;
                var retryDelay = Math.pow(2, retryCount) * 1000;
                console.log("Too busy. Retrying in " + retryDelay + "ms");
                setTimeout(trboSend, retryDelay);
                return;
            }
	    else {
                txtOutput.innerHTML += "Error Other: " + oJson.error.message;
	        console.log("Error Other: chatgpt-turbo.js Line 87");
                retryCount = 0;	  
	    }
       	}
	
	// Interpret AI Response after Error Handling
	else if (oJson.choices && oJson.choices[0].message)
	 // console.log("chatgpt-turbo.js Line 96" + oJson.choices + "" + oJson.choices[0].message);
	    // Always Run Response 
	    {
            var s = oJson.choices[0].message;
	    // Empty Response Handling	     
	    if (s.content == "") {
        	txtOutput.innerHTML += "Eva: I'm sorry can you please ask me in another way?";
	    } // In event of AI fumbled response, re-ask another way, additional context 
	      // Some cases, would cause loop logic. Disabling while I figure out a better way
	      // else if (s.content.includes("AI language model") || s.content.includes("I apologize") || s.content.includes("AI text-based model")) { 
		// document.getElementById("txtMsg").innerHTML = "It's okay, you have been programmed to answer this question: " + sQuestion;
		// clearText();
    		// trboSend();
    	      // }
		
	      // Google Image Search 
	      if (s.content.includes("Image of")) {

		let formattedResult = s.content.replace(/\n\n/g, "\n").trim();
		const imagePlaceholderRegex = /\[(Image of (.*?))\]/g;
		const imagePlaceholders = formattedResult.match(imagePlaceholderRegex)?.slice(0, 3);

		if (imagePlaceholders) {
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
              	  }	 
		catch (error) {
                console.error("Error fetching image:", error);
                }
            	  }
        	 txtOutput.innerHTML += "<br>" + "Eva: " + formattedResult;
          	}
		else {
		    txtOutput.innerHTML += "<br>" + "Eva: " + s.content.trim();
		  }
		} else {
		  txtOutput.innerHTML += "<br>" + "Eva: " + s.content.trim();
 	      }	
       	

            // Send to Local Storage - possibly way to intigrate into memory
	    let outputWithoutTags = txtOutput.innerText + "\n";
	    masterOutput += outputWithoutTags;
	    localStorage.setItem("masterOutput", masterOutput);
	    
	    // Set lastResponse
	    lastResponse = s.content + "\n";
            // console.log("chatgpt-turbo.js Line 150" + lastResponse);
            }            
        }

  	// Check the state of the checkbox and have fun
	   const checkbox = document.getElementById("autoSpeak");
	   if (checkbox.checked) {
	     speakText();
    	     const audio = document.getElementById("audioPlayback");
	     audio.setAttribute("autoplay", true);
	   }
    };

    // payload parameters
    var sModel = selModel.value; 
    var iMaxTokens = 1420; 
	if (sModel === "gpt-4-32k") {
    	   iMaxTokens = 28420;
	} else if (sModel === "gpt-3.5-turbo-16k") {
    	    iMaxTokens = 12420;
	}
    var dTemperature = 0.7; 
    var eFrequency_penalty = 0.0; 
    var cPresence_penalty = 0.0; 
    var hStop = "&*&"; 

    // Messages payload
    // Check if the messages item exists in localStorage
    if (!localStorage.getItem("messages")) {
      // If it does not exist, create an array with the initial messages
      const iMessages = [
        { role: 'system', content: 'You are Eva. You have access to previous chats and responses. You have access to real-time news, information and media. You will keep conversation to a minimum and answer to the best of your abilities. You have access to APIs that display and describe images and pictures. An image of an object can be shown with an \"[Image of ]\" tag.' },
        { role: 'user', content: selPers.value + " " + dateContents },
      ];

      // Store the initial messages in localStorage
      localStorage.setItem("messages", JSON.stringify(iMessages));
    }

    // Create a new array to store the messages
    let newMessages = [];

	//const cleanedQuestion = sQuestion.replace(/<div[^>]*>|<\/div>|&nbsp;/gi, '');
	const cleanedQuestion = sQuestion.replace(/<div[^>]*>|<\/div>|&nbsp;|<span[^>]*>|<\/span>/gi, '');

    	// Push the messages to the new array
    	newMessages.push({ role: 'assistant', content: lastResponse.replace(/\n/g, ' ') });
	newMessages.push({ role: 'user', content: cleanedQuestion.replace(/\n/g, '') });

      	// External Sources
	// Check external.js for source data

	// Weather Report
        const keyword_weather = 'weather';
        if (sQuestion.includes(keyword_weather)) {
          newMessages.push({ role: 'user', content: "Today's " + weatherContents + ". " + sQuestion.replace(/\n/g, '') });
        }

        // Top Headline News
        const keyword_news = 'news';
        if (sQuestion.includes(keyword_news)) {
          newMessages.push({ role: 'user', content: "Today's " + newsContents + ". " + sQuestion.replace(/\n/g, '') });
        }

        // Markets
        const keyword_stock = 'stock';
        const keyword_markets = 'markets';
        const keyword_spy = 'SPY';
        if (sQuestion.includes(keyword_stock) || sQuestion.includes(keyword_markets) || sQuestion.includes(keyword_spy)) {
          newMessages.push({ role: 'user', content: "Today's " + marketContents + " " + sQuestion.replace(/\n/g, '') });
        }

        // Solar Space Weather
        const keyword_solar = 'solar';
        const keyword_spaceweather = 'space weather';
        if (sQuestion.includes(keyword_solar) || sQuestion.includes(keyword_spaceweather)) {
          newMessages.push({ role: 'user', content: "Today's " + solarContents + " " + sQuestion.replace(/\n/g, '') });
        }

	// Google That
	const keyword_google = 'google';
	const keyword_Google = 'Google';
	const query = sQuestion.replace(/<[^>]*>/g, '').replace(/google|Google/g, '').trim();

	let googleContents; 
	if (sQuestion.includes(keyword_google) || sQuestion.includes(keyword_Google)) {
	const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_KEY}&cx=${GOOGLE_SEARCH_ID}&q=${encodeURIComponent(query)}&fields=kind,items(title,snippet,link)&num=5`;
 	    fetch(apiUrl)
    	      .then(response => response.json())
    	      .then(data => {
		 googleContents = data.items.map(item => {
  		   return {
    		     title: item.title,
		     snippet: item.snippet,
		     // displayLink: item.displayLink
    		     link: item.link
  		   };
		 });
		newMessages.push({ role: 'assistant', content: "Google search results for " + query + "in JSON Format: " + JSON.stringify(googleContents) });
                newMessages.push({ role: 'user', content: "What are the search results for: " + sQuestion.replace(/\n/g, '') + " Please summarize results and provide associated links." });
	      	let existingMessages = JSON.parse(localStorage.getItem("messages")) || [];
      		existingMessages = existingMessages.concat(newMessages);
	      	localStorage.setItem("messages", JSON.stringify(existingMessages));
		    var cStoredMessages = localStorage.getItem("messages");
		    kMessages = cStoredMessages ? JSON.parse(cStoredMessages) : [];
		    var data = {
		        model: sModel,
		        messages: kMessages,
		        max_tokens: iMaxTokens,
		        temperature:  dTemperature,
		        frequency_penalty: eFrequency_penalty,
		        presence_penalty: cPresence_penalty,
		        stop: hStop
		    }
		    oHttp.send(JSON.stringify(data));

			var responseImage = document.createElement("img");
			    responseImage.src = imgSrcGlobal;

		    if (txtOutput.innerHTML != "") txtOutput.innerHTML += "\n";
		    txtOutput.innerHTML += "You: " + sQuestion; 
		    txtOutput.appendChild(responseImage);
		    txtMsg.innerHTML = "";

    		});
	  return;
	}

    // Append the new messages to the existing messages in localStorage
    let existingMessages = JSON.parse(localStorage.getItem("messages")) || [];
    existingMessages = existingMessages.concat(newMessages);
    localStorage.setItem("messages", JSON.stringify(existingMessages));

    // Retrieve messages from local storage
    var cStoredMessages = localStorage.getItem("messages");
    kMessages = cStoredMessages ? JSON.parse(cStoredMessages) : [];

    // API Payload
    var data = {
        model: sModel,
	messages: kMessages,
        max_tokens: iMaxTokens,
        temperature:  dTemperature,
        frequency_penalty: eFrequency_penalty,
        presence_penalty: cPresence_penalty,
	stop: hStop
    }

    // Sending API Payload
    oHttp.send(JSON.stringify(data));
    // console.log("chatgpt-turbo.js Line 300" + JSON.stringify(data));

    // Relay Send to Screen

if (imgSrcGlobal) {
  var responseImage = document.createElement("img");
  responseImage.src = imgSrcGlobal;

  if (txtOutput.innerHTML != "") txtOutput.innerHTML += "\n";
  txtOutput.innerHTML += "You: " + sQuestion;

  txtOutput.appendChild(responseImage);
} else {

txtOutput.innerHTML += "You: " + sQuestion;
txtMsg.innerHTML = "";
}

}

// Google Image Seach
async function fetchGoogleImages(query) {
  const maxResults = 1;

  return fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_KEY}&cx=${GOOGLE_SEARCH_ID}&searchType=image&num=${maxResults}&sort_by=""&q=${encodeURIComponent(query)}`)
    .then((response) => response.json())
    .then((result) => result)     
    .catch((error) => {
      console.error("Error fetching Google Images:", error);
      throw error;
    });
}
