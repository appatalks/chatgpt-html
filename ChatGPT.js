// Javascript
// For OpenAI API

var lastResponse = "";
var masterOutput = "";
var retryCount = 0;
var maxRetries = 5;
var retryDelay = 1000; // initial delay in milliseconds

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

    oHttp.onreadystatechange = function () {
        if (oHttp.readyState === 4) {
            //console.log(oHttp.status);
            var oJson = {}
            if (txtOutput.value != "") txtOutput.value += "\n";

            try {
                oJson = JSON.parse(oHttp.responseText);
            } catch (ex) {
                txtOutput.value += "Error: " + ex.message
            }

	    // Backend Error Exponetial Backoff - Needs more testing
            if (oJson.error && oJson.error.message) {
        //        txtOutput.value += "Error: " + oJson.error.message;
		if (oJson.error.message == "Too busy" && retryCount < maxRetries) {
                    retryCount++;
                    var retryDelay = Math.pow(2, retryCount) * 1000;
                    console.log("Too busy. Retrying in " + retryDelay + "ms");
                    setTimeout(Send, retryDelay);
                    return;
                }
                txtOutput.value += "Error: " + oJson.error.message;
                retryCount = 0;	  
            	}
 
		else if (oJson.choices && oJson.choices[0].text) {
                var s = oJson.choices[0].text;

        //        if (selLang.value != "en-US") {
		  // Place Holder
        //        }

                if (s == "") s = "No response";
		txtOutput.value += "AI: " + s.trim();
		// masterOutput += "AI: " + s.trim() + "\n";
		masterOutput += "\n" + txtOutput.value + "\n";
		localStorage.setItem("masterOutput", masterOutput);
		lastResponse = s;
	        // Retrieve the local storage masterOutput content
	        	// var storedContent = localStorage.getItem("textareaContent");
			// Place Holder
            	}            
        }
    };


    var sModel = selModel.value; // "text-davinci-003|text-davinci-002|code-davinci-002";
    var iMaxTokens = 600;
    var dTemperature = 0.7;    

    var data = {
        model: sModel,
        prompt: selPers.value + lastResponse + sQuestion,
        max_tokens: iMaxTokens,
        temperature:  dTemperature,
        frequency_penalty: 0.0, //Number between -2.0 and 2.0  Positive value decrease the model's likelihood to repeat the same line verbatim.
        presence_penalty: 0.0,  //Number between -2.0 and 2.0. Positive values increase the model's likelihood to talk about new topics.
        // stop: ["#", ";"] //Up to 4 sequences where the API will stop generating further tokens.
    }

    oHttp.send(JSON.stringify(data));

    if (txtOutput.value != "") txtOutput.value += "\n";
    txtOutput.value += "You: " + sQuestion;
    txtMsg.value = "";
}

function ChangeLang() {
// Place Holder
}
