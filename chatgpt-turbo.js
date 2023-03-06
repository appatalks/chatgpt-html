// Javascript
// For OpenAI API

// Send API Call
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

    oHttp.onreadystatechange = function () {
        if (oHttp.readyState === 4) {
    	  // Check for errors
    	  if (oHttp.status === 500) {
      	    txtOutput.value += "Error 500: Internal Server Error";
      	    console.log("Error 500: Internal Server Error chatgpt-turbo.js Line 25");
      	    return;
    	  }
    	  if (oHttp.status === 429) {
      	    txtOutput.value += "Error 429: Too Many Requests";
            console.log("Error 429: Too Many Requests chatgpt-turbo.js Line 30");
      	    return;
    	  }
            //console.log(oHttp.status);
            var oJson = {}
            if (txtOutput.value != "") txtOutput.value += "\n"; // User Send Data
            try {
                oJson = JSON.parse(oHttp.responseText);  // API Response Data
            } catch (ex) {
                txtOutput.value += "Error: " + ex.message;
		console.log("Error: chatgpt-turbo.js Line 40");
		return;
              }
	
	// EasterEgg
	if (oJson.usage.completion_tokens === 420) {
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
	
	// Timeout Error Exponetial Backoff
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
	        console.log("Error Other: chatgpt-turbo.js Line 75");
                retryCount = 0;	  
	    }
       	}
	
	// Contine Send after Error Handling
	else if (oJson.choices && oJson.choices[0].message);
	 // console.log("chatgpt-turbo.js Line 79" + oJson.choices + "" + oJson.choices[0].message);
	    // Always Run Response 
	    {
            var s = oJson.choices[0].message;
	    // Empty Response Handling	     
	    if (s.content == "") {
        	txtOutput.value += "Eva: I'm sorry can you please ask me in another way?";
    	    } else {
		// console.log("chatgpt-turbo.js line 93" + typeof s, s);
        	txtOutput.value += "Eva: " + s.content.trim();
    	    }

            // Send to Local Storage - possibly way to intigrate into memory
	    masterOutput += "\n" + txtOutput.value + "\n";
	    localStorage.setItem("masterOutput", masterOutput);
	    lastResponse = s.content + "\n";

	    userMasterResponse += sQuestion + "\n";
	    localStorage.setItem("userMasterResponse", userMasterResponse);

            aiMasterResponse += lastResponse;
            localStorage.setItem("aiMasterResponse", aiMasterResponse);

            // console.log("chatgpt-turbo.js Line 93" + lastResponse);
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
    var iMaxTokens = 750;
    var dTemperature = 0.7;    
    var stop = "&*&";
    
    // API Payload
    var data = {
        model: sModel,
	// Need Revist after some time, need this to mature. Does not respond as expected with assistant. Not sure how to pass previous responses.
	messages: [
	      { role: 'system', content: selPers.value },  // Doesn't seem to stick well.
	      { role: 'user', content: selPers.value + " " + lastResponse.replace(/\n/g, '') + " " + sQuestion.replace(/\n/g, '') },
	      // { role: 'assistant', content: aiMasterResponse.replace(/\n/g, '') }, // Read ai responses, get's very confused.
	],
        max_tokens: iMaxTokens,
        temperature:  dTemperature,
        frequency_penalty: 0.0, // Between -2 and 2, Positive values decreases repeat responses.
        presence_penalty: 0.0,  // Between -2 and 2, Positive values increases new topic probability.
	stop: stop
    }

    // Sending API Payload
    oHttp.send(JSON.stringify(data));
    // console.log("chatgpt-turbo.js Line 139" + JSON.stringify(data));

    // Relay Send to Screen
    if (txtOutput.value != "") txtOutput.value += "\n";
    txtOutput.value += "You: " + sQuestion;
    txtMsg.value = "";
}
