// Javascript
// For OpenAI API

// gpt-3.5-turbo API Call 
function trboSend() {

    var sQuestion = txtMsg.value;
    if (sQuestion == "") {
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
      	    txtOutput.value += "\n Error 500: Internal Server Error" + "\n" + oHttp.responseText;
      	    console.log("Error 500: Internal Server Error chatgpt-turbo.js Line 26");
      	    return;
    	  }
    	  if (oHttp.status === 429) {
      	    txtOutput.value += "\n Error 429: Too Many Requests" + "\n" + oHttp.responseText;
            console.log("Error 429: Too Many Requests chatgpt-turbo.js Line 31");
      	    return;
    	  }
          if (oHttp.status === 404) {
            txtOutput.value += "\n Error 404: Not Found" + "\n" + oHttp.responseText;
            console.log("Error 404: Too Many Requests chatgpt-turbo.js Line 36");
            return;
          }
            //console.log(oHttp.status);
            var oJson = {}
            if (txtOutput.value != "") txtOutput.value += "\n"; // User Send Data
            try {
                oJson = JSON.parse(oHttp.responseText);  // API Response Data
            } catch (ex) {
                txtOutput.value += "Error: " + ex.message;
		console.log("Error: chatgpt-turbo.js Line 46");
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
        	// txtOutput.value += "Error: " + oJson.error.message;
	    if (oJson.error.message == "overloaded" && retryCount < maxRetries) {
                retryCount++;
                var retryDelay = Math.pow(2, retryCount) * 1000;
                console.log("Too busy. Retrying in " + retryDelay + "ms");
                setTimeout(trboSend, retryDelay);
                return;
            }
	    else {
                txtOutput.value += "Error Other: " + oJson.error.message;
	        console.log("Error Other: chatgpt-turbo.js Line 81");
                retryCount = 0;	  
	    }
       	}
	
	// Interpret AI Response after Error Handling
	else if (oJson.choices && oJson.choices[0].message);
	 // console.log("chatgpt-turbo.js Line 88" + oJson.choices + "" + oJson.choices[0].message);
	    // Always Run Response 
	    {
            var s = oJson.choices[0].message;
	    // Empty Response Handling	     
	    if (s.content == "") {
        	txtOutput.value += "Eva: I'm sorry can you please ask me in another way?";
	    } // Switch to text-davinci-003 in event of AI fumbled response
	      else if (s.content.includes("AI") || s.content.includes("sorry")) { 
		var selectElement = document.getElementById("selModel");
		selectElement.value = "text-davinci-003";
		document.getElementById("txtMsg").value = sQuestion;
		clearText();
    		Send();
		selectElement.value = "gpt-3.5-turbo";
    	    } else {
		// console.log("chatgpt-turbo.js line 104" + typeof s, s);
        	txtOutput.value += "Eva: " + s.content.trim();
    	    }

            // Send to Local Storage - possibly way to intigrate into memory
	    masterOutput += "\n" + txtOutput.value + "\n";
	    localStorage.setItem("masterOutput", masterOutput);

	    userMasterResponse += sQuestion + "\n";
	    localStorage.setItem("userMasterResponse", userMasterResponse);

            aiMasterResponse += lastResponse;
            localStorage.setItem("aiMasterResponse", aiMasterResponse);
	    
	    // Set lastResponse
	    lastResponse = s.content + "\n";
            // console.log("chatgpt-turbo.js Line 120" + lastResponse);
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
    var iMaxTokens = 1250;
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
        { role: 'system', content: "You are Eva. You have access to previous chats and responses. You will keep conversation to a minimum and answer to the best of your abilities." },
        { role: 'user', content: selPers.value },
      ];

      // Store the initial messages in localStorage
      localStorage.setItem("messages", JSON.stringify(iMessages));
    }

    // Create a new array to store the messages
    let newMessages = [];

    // Push the messages to the new array
    newMessages.push({ role: 'assistant', content: lastResponse.replace(/\n/g, ' ') });
    newMessages.push({ role: 'user', content: sQuestion.replace(/\n/g, '') });

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
    // console.log("chatgpt-turbo.js Line 186" + JSON.stringify(data));

    // Relay Send to Screen
    if (txtOutput.value != "") txtOutput.value += "\n";
    txtOutput.value += "You: " + sQuestion;
    txtMsg.value = "";
}
