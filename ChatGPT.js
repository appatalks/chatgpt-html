// Javascript
// For OpenAI API

var lastResponse = "";
var masterOutput = "";
var retryCount = 0;
var maxRetries = 5;
var retryDelay = 2420; // initial delay in milliseconds

function OnLoad() {
// Place Holder
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

// Sending
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
	
	// Catch 500 Internal Server Error
        if (oHttp.status === 500) {
            txtOutput.value += "Error 500: Internal Server Error";
            // potentially log the error or take other action
	    console.log("Error 500: Internal Server Error ChatGPT.js Line 62");
            return;
        } 

	// Timeout Error Exponetial Backoff
        if (oJson.error && oJson.error.message) {
        	// txtOutput.value += "Error: " + oJson.error.message;
	    if (oJson.error.message == "Too busy" && retryCount < maxRetries) {
                retryCount++;
                var retryDelay = Math.pow(2, retryCount) * 1000;
                console.log("Too busy. Retrying in " + retryDelay + "ms");
                setTimeout(Send, retryDelay);
                return;
            }
            txtOutput.value += "Error Other: " + oJson.error.message;
	    console.log("Error Other: ChatGPT.js Line 75");
            retryCount = 0;	  
       	}
	
	// Contine after Error Handling
	else if (oJson.choices && oJson.choices[0].text);
	// console.log("Line 82" + oJson.choices + "" +oJson.choices[0].text);
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
    };

    var sModel = selModel.value; // "text-davinci-003|text-davinci-002|code-davinci-002";
    var iMaxTokens = 600;
    var dTemperature = 0.7;    
    var stop = "&*&";

    var data = {
        model: sModel,
        prompt: selPers.value.replace(/@/g, " ") + lastResponse.replace(/\n/g, '') + " " + sQuestion.replace(/\n/g, ''),
        max_tokens: iMaxTokens,
        temperature:  dTemperature,
        frequency_penalty: 0.0, // Between -2.0 and 2.0  Positive values decreases repeat responses.
        presence_penalty: 0.0,  // Between -2.0 and 2.0. Positive values increases new topic probability.
	stop: stop
    }

    oHttp.send(JSON.stringify(data));

    if (txtOutput.value != "") txtOutput.value += "\n";
    txtOutput.value += "You: " + sQuestion;
    txtMsg.value = "";
}

function ChangeLang() {
  // Place Holder
}
