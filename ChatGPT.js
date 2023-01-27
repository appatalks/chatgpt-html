// JavaScript code

var lastResponse = "";
var retryCount = 0;
var maxRetries = 5;
var retryDelay = 1000; // initial delay in milliseconds

function OnLoad() {
// Place Holder
}

function clearText(){
  document.getElementById("txtOutput").value = "";
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
            } else if (oJson.choices && oJson.choices[0].text) {
                var s = oJson.choices[0].text;

        //        if (selLang.value != "en-US") {
        //        }

                if (s == "") s = "No response";
		txtOutput.value += "AI: " + s.trim();
		lastResponse = s;
                SpeechToText;
            }            
        }
    };

    var sModel = selModel.value;// "text-davinci-003";
    var iMaxTokens = 600;
    var dTemperature = 0.7;    

    var data = {
        model: sModel,
        prompt: selPers.value + lastResponse + sQuestion,
        max_tokens: iMaxTokens,
        temperature:  dTemperature,
        frequency_penalty: 0.0, //Number between -2.0 and 2.0  Positive value decrease the model's likelihood to repeat the same line verbatim.
        presence_penalty: 0.0,  //Number between -2.0 and 2.0. Positive values increase the model's likelihood to talk about new topics.
        stop: ["#", ";"] //Up to 4 sequences where the API will stop generating further tokens. The returned text will not contain the stop sequence.
    }

    oHttp.send(JSON.stringify(data));

    if (txtOutput.value != "") txtOutput.value += "\n";
    txtOutput.value += "You: " + sQuestion;
    txtMsg.value = "";
}

function ChangeLang() {
// Place Holder
}

function SpeechToText() {
    if (!bTextToSpeechSupported) return;
    var sText = txtOutput.value;
    if (sText == "") {
        alert("No text to convert to speech!");
        return;
    }

    // Create a new Polly client
    const polly = new AWS.Polly();

    // Define the parameters for the Polly request
    const params = {
        OutputFormat: 'mp3',
        Text: sText,
	Engine: standard,    
        VoiceId: selVoices.value
    };

    // Call the Polly service to convert the text to speech
    polly.synthesizeSpeech(params, (err, data) => {
        if (err) {
          console.log(err);
        } else {
            var oAudio = new Audio();
            oAudio.src = URL.createObjectURL(new Blob([data.AudioStream], { type: "audio/mpeg" }));
            oAudio.play();
        }
    });
}
