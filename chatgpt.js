// Javascript
// For OpenAI API

// Send API Call
function Send() {

  var sQuestion = txtMsg.innerHTML; 
    sQuestion = sQuestion.replace(/<br>/g, "\n");
  if (sQuestion.trim() == "") {
    alert("Type in your question!");
    txtMsg.focus(); 
    return;         
  }        

    var oHttp = new XMLHttpRequest();
    oHttp.open("POST", "https://api.openai.com/v1/completions");
    oHttp.setRequestHeader("Accept", "application/json");
    oHttp.setRequestHeader("Content-Type", "application/json");
    oHttp.setRequestHeader("Authorization", "Bearer " + OPENAI_API_KEY)

    // Error Handling 
    oHttp.onreadystatechange = function () {
        if (oHttp.readyState === 4) {
          // Check for errors
    	  if (oHttp.status === 500) {
      	    txtOutput.innerHTML += "<br> Error 500: Internal Server Error" + "<br>" + oHttp.responseText;
      	    console.log("Error 500: Internal Server Error chatgpt-turbo.js Line 27");
      	    return;
    	  }
    	  if (oHttp.status === 429) {
      	    txtOutput.innerHTML += "<br> Error 429: Too Many Requests" + "<br>" + oHttp.responseText;
            console.log("Error 429: Too Many Requests chatgpt-turbo.js Line 32");
      	    return;
    	  }
          if (oHttp.status === 404) {
            txtOutput.innerHTML += "<br> Error 404: Not Found" + "<br>" + oHttp.responseText;
            console.log("Error 404: Too Many Requests chatgpt-turbo.js Line 37");
            return;
          }
            //console.log(oHttp.status);
            var oJson = {}
            if (txtOutput.innerHTML != "") txtOutput.innerHTML += "<br>"; // User Send Data
            try {
                oJson = JSON.parse(oHttp.responseText);  // API Response Data
            } catch (ex) {
                txtOutput.innerHTML += "Error: " + ex.message;
                console.log("Error: chatgpt.js Line 47");
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
	
	// Timeout Error Exponetial Backoff
        if (oJson.error && oJson.error.message) {
        	// txtOutput.innerHTML += "Error: " + oJson.error.message;
	    // 503 "Error That model is currently overloaded with other requests."
	    if (oJson.error.message == "overloaded" && retryCount < maxRetries) {
                retryCount++;
                var retryDelay = Math.pow(2, retryCount) * 1000;
                console.log("Too busy. Retrying in " + retryDelay + "ms");
                setTimeout(Send, retryDelay);
                return;
            }
            txtOutput.innerHTML += "Error Other: " + oJson.error.message;
	    console.log("Error Other: chatgpt.js Line 82");
            retryCount = 0;	  
       	}
	
        // Interpret AI Response after Error Handling
	else if (oJson.choices && oJson.choices[0].text);
	// console.log("Line 88" + oJson.choices + "" +oJson.choices[0].text);
	    // Always Run Response 
	    {
            var s = oJson.choices[0].text;
	    // Empty Response Handling	     
	    if (s == "") {
        	txtOutput.innerHTML += "Eva: I'm sorry can you please ask me in another way?";
    	    } else {
        	txtOutput.innerHTML += "Eva: " + s.trim();
    	    }

            // Send to Local Storage - possibly way to intigrate into memory
            let outputWithoutTags = txtOutput.innerText ;
            masterOutput += outputWithoutTags;
            localStorage.setItem("masterOutput", masterOutput);

            userMasterResponse += sQuestion + "\n";
            localStorage.setItem("userMasterResponse", userMasterResponse);

            // Set lastResponse
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
    if (txtOutput.innerHTML != "") txtOutput.innerHTML += "<br>";
    txtOutput.innerHTML += "You: " + sQuestion;
    txtMsg.innerHTML = "";
}
