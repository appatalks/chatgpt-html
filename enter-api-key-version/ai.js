// Javascript
// For OpenAI API

var lastResponse = "";
var masterOutput = "";
var retryCount = 0;
var maxRetries = 5;
var retryDelay = 2420; // initial delay in milliseconds

function OnLoad() {
// Place Holder
    document.getElementById("txtOutput").placeholder = "\n" +
    "		Here are some general prompt tips to help me understand:\n\n" +
    "   #1 Be specific: The more specific your prompt, the more targeted the response will be.\n\n" +
    "   #2 Start with a question: Starting your prompt will help me feel more natural.\n\n" +
    "   #3 Provide context: Often good context goes a long way for me.\n\n" +
    "   #4 Use puncuation, periods and question marks.\n\n" + 
    "   #5 Keep it short: Occam's razor.\n\n" +
    "                                       Oh and refresh for fresh session :)\n\n" +
    "   ***Note, Review carefully, may occasionally generate incorrect information.";
	
	  var textarea = document.getElementById("apiKeyinput");
	  var OPENAI_API_KEY;
	  textarea.addEventListener("input", function() {
	    OPENAI_API_KEY = textarea.value;
		plaintextAPI = textarea.value;   
	    var obscured = OPENAI_API_KEY.substr(0, 2) + "*".repeat(OPENAI_API_KEY.length - 2);
	    textarea.value = obscured;
	  });

}

function clearText(){
    document.getElementById("txtOutput").value = "";
}

function printMaster() {
    // Get the content of the textarea masterOutput
    var textareaContent = document.getElementById("txtOutput").value = masterOutput;
    	console.log(masterOutput);
    var printWindow = window.open();
    	printWindow.document.write(txtOutput.value.replace(/\n/g, "<br>"));
    	printWindow.print();
}

function shiftBreak() {
  // Capture Shift + Enter Keys for new line
    document.querySelector("#txtMsg").addEventListener("keydown", function(event) {
      if (event.shiftKey && event.keyCode === 13) {
        var newLine = "\n";
        var currentValue = document.querySelector("#txtMsg").value;
        document.querySelector("#txtMsg").value = currentValue + newLine;
        event.preventDefault();
      }
    });

  // Capture Enter Key to Send Message and Backspace to reset position
    document.querySelector("#txtMsg").addEventListener("keydown", function(event) {
      if (event.keyCode === 13 && !event.shiftKey) {
        document.querySelector("#btnSend").click();
        event.preventDefault();
        var backspace = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          keyCode: 8
        });
        document.querySelector("#txtMsg").dispatchEvent(backspace);
      }
    });
}

// Send API Call
function Send() {

    var sQuestion = txtMsg.value;
    if (sQuestion == "") {
        alert("Type in your question!");
        txtMsg.focus();
        return;
    }

    var sQAPI = apiKeyinput.value;
    if (sQAPI == "") {
        alert("Enter your API Key!");
        apiKeyinput.focus();
        return;
    }

    var OPENAI_API_KEY = document.getElementById("apiKeyinput").value;

    var oHttp = new XMLHttpRequest();
    oHttp.open("POST", "https://api.openai.com/v1/completions");
    oHttp.setRequestHeader("Accept", "application/json");
    oHttp.setRequestHeader("Content-Type", "application/json");
    oHttp.setRequestHeader("Authorization", "Bearer " + plaintextAPI)

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
		console.log("Error: ChatGPT.js Line 107");
		return;
              }
	
	// Catch 500 Internal Server Error
        if (oHttp.status === 500) {
            txtOutput.value += "Error 500: Internal Server Error";
            // potentially log the error or take other action
	    console.log("Error 500: Internal Server Error ChatGPT.js Line 115");
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
	    console.log("Error Other: ChatGPT.js Line 130");
            retryCount = 0;	  
       	}
	
	// Contine Send after Error Handling
	else if (oJson.choices && oJson.choices[0].text);
	// console.log("Line 136" + oJson.choices + "" +oJson.choices[0].text);
	    // Always Run Response 
	    {
            var s = oJson.choices[0].text;
	    // Empty Response Handling	     
	    if (s == "") {
        	txtOutput.value += "RaxAI: I'm sorry can you please ask me in another way?";
    	    } else {
        	txtOutput.value += "RaxAI: " + s.trim();
    	    }
	    masterOutput += "\n" + txtOutput.value + "\n";
	    localStorage.setItem("masterOutput", masterOutput);
	    lastResponse = s;
            }            
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
        prompt: selPers.value + lastResponse.replace(/\n/g, '') + " " + sQuestion.replace(/\n/g, ''),
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
