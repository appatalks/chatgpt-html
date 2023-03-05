// Javascript
// For OpenAI API

// Send API Call
function Send() {

    var sQuestion = txtMsg.value;
    if (sQuestion == "") {
        alert("Type in your question!");
        txtMsg.focus();
        return;
    }

    var oHttp = new XMLHttpRequest();
    oHttp.open("POST", "https://api.openai.com/v1/completions");
    oHttp.setRequestHeader("Accept", "application/json");
    oHttp.setRequestHeader("Content-Type", "application/json");
    oHttp.setRequestHeader("Authorization", "Bearer " + OPENAI_API_KEY)

    // Error Handling - Needs more testing
    oHttp.onreadystatechange = function () {
        if (oHttp.readyState === 4) {
            //console.log(oHttp.status);
            var oJson = {}
            if (txtOutput.value != "") txtOutput.value += "\n"; // User Send Data
            try {
                oJson = JSON.parse(oHttp.responseText);  // API Response Data
            } catch (ex) {
                txtOutput.value += "Error: " + ex.message;
		console.log("Error: chatgpt.js Line 30");
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
	
	// Catch 500 Internal Server Error
        if (oHttp.status === 500) {
            txtOutput.value += "Error 500: Internal Server Error";
            // potentially log the error or take other action
	    console.log("Error 500: Internal Server Error chatgpt.js Line 57");
            return;
        } 

	// Timeout Error Exponetial Backoff
        if (oJson.error && oJson.error.message) {
        	// txtOutput.value += "Error: " + oJson.error.message;
	    // 503 "Error That model is currently overloaded with other requests."
	    if (oJson.error.message == "overloaded" && retryCount < maxRetries) {
                retryCount++;
                var retryDelay = Math.pow(2, retryCount) * 1000;
                console.log("Too busy. Retrying in " + retryDelay + "ms");
                setTimeout(Send, retryDelay);
                return;
            }
            txtOutput.value += "Error Other: " + oJson.error.message;
	    console.log("Error Other: chatgpt.js Line 73");
            retryCount = 0;	  
       	}
	
	// Contine Send after Error Handling
	else if (oJson.choices && oJson.choices[0].text);
	// console.log("Line 79" + oJson.choices + "" +oJson.choices[0].text);
	    // Always Run Response 
	    {
            var s = oJson.choices[0].text;
	    // Empty Response Handling	     
	    if (s == "") {
        	txtOutput.value += "Eva: I'm sorry can you please ask me in another way?";
    	    } else {
        	txtOutput.value += "Eva: " + s.trim();
    	    }
	    masterOutput += "\n" + txtOutput.value + "\n";
	    localStorage.setItem("masterOutput", masterOutput);
	    lastResponse = s;
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
        prompt: selPers.value + " " +lastResponse.replace(/\n/g, '') + " " + sQuestion.replace(/\n/g, ''),
        max_tokens: iMaxTokens,
        temperature:  dTemperature,
        frequency_penalty: 0.0, // Between -2 and 2, Positive values decreases repeat responses.
        presence_penalty: 0.0,  // Between -2 and 2, Positive values increases new topic probability.
	stop: stop
    }

    // Sending API Payload
    oHttp.send(JSON.stringify(data));

    // Relay Send to Screen
    if (txtOutput.value != "") txtOutput.value += "\n";
    txtOutput.value += "You: " + sQuestion;
    txtMsg.value = "";
}
