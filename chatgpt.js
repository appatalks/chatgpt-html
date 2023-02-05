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
    "		Here are some general prompt tips to help me understand:\n\n\n" +
    "   #1 Be specific: The more specific your prompt, the more targeted the response will be.\n\n" +
    "   #2 Start with a question: Starting your prompt will help me feel more natural.\n\n" +
    "   #3 Provide context: Often good context goes a long way for me.\n\n" +
    "   #4 Use puncuation, periods and question marks.\n\n" + 
    "   #5 Keep it short: Occam's razor.\n\n" +
    "                                       Oh and refresh for fresh session :)";
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
		console.log("Error: ChatGPT.js Line 53");
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
	    console.log("Error 500: Internal Server Error ChatGPT.js Line 114");
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
        	txtOutput.value += "AI: I'm sorry can you please ask me in another way?";
    	    } else {
        	txtOutput.value += "AI: " + s.trim();
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

// Get Account Usage Information 
//
// Billing
async function getOpenaiBillUsage(apiKey, start_date, end_date) {
var oKey = OPENAI_API_KEY;

  const headers = {
    'Authorization': `Bearer ${oKey}`,
    'Content-Type': 'application/json',
  };

  if (!start_date) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    start_date = new Date(year, month, 1).toISOString().slice(0, 10);
  }

  if (!end_date) {
    const today = new Date();
   	  today.setDate(today.getDate() + 1);
    end_date = today.toISOString().slice(0, 10);
  }
  
  const searchParams = new URLSearchParams();
  searchParams.set('start_date', start_date);
  searchParams.set('end_date', end_date);
  const response = await fetch(
    `https://api.openai.com/dashboard/billing/usage?${searchParams.toString()}`,
    {
      headers,
    }
  );

  if (response.status === 200) {
    const data = await response.json();
    // console.log(data);
    const totalUsage = data.total_usage;
    // Rounded up the 0.01
    const formattedUsage = (totalUsage / 100 + 0.01).toFixed(2);
    document.getElementById("txtOutput").value = "\n\n\n  Month's Current Spend: $" + formattedUsage;
  } else {
  throw new Error(`Failed to retrieve OpenAI usage data: ${await response.text()}`);
  }
}

// Token Usage // Disabled
async function getOpenaiUsage(apiKey, start_date, end_date) {
var oKey = OPENAI_API_KEY;

  const headers = {
    'Authorization': `Bearer ${oKey}`,
    'Content-Type': 'application/json',
  };

  if (!start_date) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    start_date = new Date(year, month, 1).toISOString().slice(0, 10);
  }

  if (!end_date) {
    const today = new Date();
    end_date = today.toISOString().slice(0, 10);
  }

  const searchParams = new URLSearchParams();
  searchParams.set('start_date', start_date);
  searchParams.set('end_date', end_date);
//  const response = await fetch(
//    `https://api.openai.com/v1/usage?${searchParams.toString()}`,
//    {
//      headers,
//    }
//  );
//
//  if (response.status === 200) {
//    const data = await response.json();
//    console.log(data);
//    //  document.getElementById("txtOutput").value = "\n\n\n" + data ;
//  } else {
//  throw new Error(`Failed to retrieve OpenAI usage data: ${await response.text()}`);
//  }
}

// Tie the API together
function getOpenaiUsageNested() {
  getOpenaiBillUsage();
  // getOpenaiUsage(); Not very useful information to show here. maybe "current_usage_usd": 0.0
  // Placer
}
