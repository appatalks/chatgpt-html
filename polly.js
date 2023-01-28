// Javascript
// For AWS Polly API

    // Function invoked by button click
    function speakText() {
	var sText = txtOutput.value;
    	if (sText == "") {
        	alert("No text to convert to speech!");
        	return;
    	}

        // Create the JSON parameters for getSynthesizeSpeechUrl
        var speechParams = {
	    Engine: "",
            OutputFormat: "mp3",
            SampleRate: "16000",
            Text: "",
            TextType: "text",
            VoiceId: ""
        };

	// Let's speak only the response.
	let text = document.getElementById("txtOutput").value;
	let textArr = text.split('AI:');
	if(textArr.length > 1){
   	   speechParams.Text = textArr[1];
	}else{
	   speechParams.Text = text;
	}

	speechParams.VoiceId = document.getElementById("selVoice").value;
	speechParams.Engine = document.getElementById("selEngine").value;

        // Create the Polly service object and presigner object
        var polly = new AWS.Polly({apiVersion: '2016-06-10'});
        var signer = new AWS.Polly.Presigner(speechParams, polly);

        // Create presigned URL of synthesized speech file
	signer.getSynthesizeSpeechUrl(speechParams, function(error, url) {
    if (error) {
        document.getElementById('result').innerHTML = error;
    } else {
        document.getElementById('audioSource').src = url;
        document.getElementById('audioPlayback').load();
        document.getElementById('result').innerHTML = "";
    	}
    });
}
