// Javascript
// For OpenAI API

// gpt-3.5-turbo + gpt-4 API Call 
function trboSend() {

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
    oHttp.onreadystatechange = function () {
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
            } catch (ex) {
                txtOutput.innerHTML += "Error: " + ex.message;
		console.log("Error: chatgpt-turbo.js Line 52");
		return;
              }
	
	// EasterEgg
	if ((oJson.usage.completion_tokens === 420) || (oJson.usage.total_tokens === 420)) {
          function displayImage() {
            // code to display image
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
	
	// Timeout Error Exponetial Backoff - needs testing
        if (oJson.error && oJson.error.message) {
        	// txtOutput.innerHTML += "Error: " + oJson.error.message;
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
	else if (oJson.choices && oJson.choices[0].message);
	 // console.log("chatgpt-turbo.js Line 94" + oJson.choices + "" + oJson.choices[0].message);
	    // Always Run Response 
	    {
            var s = oJson.choices[0].message;
	    // Empty Response Handling	     
	    if (s.content == "") {
        	txtOutput.innerHTML += "Eva: I'm sorry can you please ask me in another way?";
	    } // Switch to text-davinci-003 in event of AI fumbled response
	      else if (s.content.includes("AI language model") || s.content.includes("sorry")) { 
		var selectElement = document.getElementById("selModel");
		selectElement.value = "text-davinci-003";
		document.getElementById("txtMsg").innerHTML = sQuestion;
		clearText();
    		Send();
		selectElement.value = "gpt-3.5-turbo";
    	    } else {
		// console.log("chatgpt-turbo.js line 110" + typeof s, s);
        	//txtOutput.innerHTML += "<br>" + "Eva: " + s.content.trim() ;
    		const message = "Eva: " + s.content.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    		txtOutput.innerHTML += "<br>" + message;
    	    }

            // Send to Local Storage - possibly way to intigrate into memory
	    let outputWithoutTags = txtOutput.innerText + "\n";
	    masterOutput += outputWithoutTags;
	    localStorage.setItem("masterOutput", masterOutput);
	    
            // userMasterResponse += sQuestion + "\n";
	    // localStorage.setItem("userMasterResponse", userMasterResponse);

            // aiMasterResponse += lastResponse;
            // localStorage.setItem("aiMasterResponse", aiMasterResponse);
	    
	    // Set lastResponse
	    lastResponse = s.content + "\n";
            // console.log("chatgpt-turbo.js Line 127" + lastResponse);
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
    var iMaxTokens = 1420; // 1024 is good. 3600 for externaldata. 4096 is Max for Turbo. 8192 for gpt-4.
	if (sModel === "gpt-4-32k") {
    	   iMaxTokens = 32768;
	}
    var dTemperature = 0.7; 
    var eFrequency_penalty = 0.0; // Between -2 and 2, Positive values decreases repeat responses.
    var cPresence_penalty = 0.0; // Between -2 and 2, Positive values increases new topic probability. 
    var hStop = "&*&"; // I have no idea why I choose this as my stop

    // Messages payload
    // Check if the messages item exists in localStorage
    if (!localStorage.getItem("messages")) {
      // If it does not exist, create an array with the initial messages
      const iMessages = [
        { role: 'system', content: "You are Eva. You have access to previous chats and responses. You also have access to updated real-time news and information. You will keep conversation to a minimum and answer to the best of your abilities." },
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
//	const query = sQuestion.replace(/google|Google/g, '').trim();
	const query = sQuestion.replace(/<[^>]*>/g, '').replace(/google|Google/g, '').trim();

	let googleContents; 
	if (sQuestion.includes(keyword_google) || sQuestion.includes(keyword_Google)) {
	const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_KEY}&cx=${GOOGLE_SEARCH_ID}&q=${encodeURIComponent(query)}&fields=kind,items(title,snippet,displayLink)&num=5`;
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
                newMessages.push({ role: 'user', content: "What are the search results for: " + sQuestion.replace(/\n/g, '') + " list results, snippet and associated links please." });
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
		    if (txtOutput.innerHTML != "") txtOutput.innerHTML += "\n";
		    txtOutput.innerHTML += "You: " + sQuestion;
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
    // console.log("chatgpt-turbo.js Line 255" + JSON.stringify(data));

    // Relay Send to Screen
    if (txtOutput.innerHTML != "") txtOutput.innerHTML += "\n";
    txtOutput.innerHTML += "You: " + sQuestion;
    txtMsg.innerHTML = "";
}
