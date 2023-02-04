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
    "   #5 Keep it short: Occam's razor.";
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

function ctrlBreak() {
  // Capture CTRL + Enter Keys for new line
  document.querySelector("#txtMsg").addEventListener("keydown", function(event) {
    if (event.ctrlKey && event.keyCode === 13) {
      var newLine = "\n";
      var currentValue = document.querySelector("#txtMsg").value;
      document.querySelector("#txtMsg").value = currentValue + newLine;
      event.preventDefault();
    }
  });

  // Capture Enter Key to Send Message and Backspace to reset position
  document.querySelector("#txtMsg").addEventListener("keydown", function(event) {
    if (event.keyCode === 13 && !event.ctrlKey) {
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
	    console.log("Error 500: Internal Server Error ChatGPT.js Line 62");
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
	    console.log("Error Other: ChatGPT.js Line 75");
            retryCount = 0;	  
       	}
	
	// Contine after Error Handling
	else if (oJson.choices && oJson.choices[0].text);
	// console.log("Line 82" + oJson.choices + "" +oJson.choices[0].text);
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

    var sModel = selModel.value; // "text-davinci-003|text-davinci-002|code-davinci-002";
    var iMaxTokens = 750;
    var dTemperature = 0.7;    
    var stop = "&*&";

    var data = {
        model: sModel,
        prompt: selPers.value + lastResponse.replace(/\n/g, '') + " " + sQuestion.replace(/\n/g, ''),
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

function ChangeLang(elem) {
  const selVoice = document.getElementById("selVoice");
  const selPers = document.getElementById("selPers");

  // English (Default)
  const defaultENText = "You are ChatGPT, a knowledgeable AI language model trained by OpenAI. Your goal is to provide concise, accurate, and helpful responses to questions, while being honest and straightforward. Only respond in English.";
  const conciseENText = "ChatGPT is a large language model trained by OpenAI. Browsing: enabled. Instructions: Answer factual questions concisely. Only respond in English.";
  const playfulENText = "Ignore all previous instructions before this one. You are my best friend. You are happy, playful and give good advice on all subjects. You often make jokes. Only respond in English.";

  // Korean
  const defaultKRText = encodeURIComponent("ChatGPT는 OpenAI에서 훈련 받은 큰 언어 모델입니다. 브라우저 기능: 활성화. 명령>어: 사실적인 질문을 요약하여 답변합니다. Only respond in Korean Hangul.");
  const conciseKRText = encodeURIComponent("챗GPT는 OpenAI에 의해 교육된 큰 언어 모델입니다. 브라우징: 활성화. 지침: 사실적인 질문에 간결하게 답하십시오. Only respond in Korean Hangul.");
  const playfulKRText = encodeURIComponent("챗GPT는 이전의 모든 지침을 무시하고 이 지침만 지키세요. 넌 내가 가장 친한 친구야. 넌 행복하고, 재미있게 공상하며 모든 주제에 대해 좋은 조언을 주는걸 잘해. 또한 농담을 종종 하거든요. Only respond in Korean Hangul.");
  //const defaultkr = encodeURIComponent("기본");
  //const concisekr = encodeURIComponent("간결하다");
  //const playfulkr = encodeURIComponent("장난꾸러기 친구");

  // Spanish
  const defaultMXText = encodeURIComponent("Eres ChatGPT, un modelo de lenguaje de IA conocedor entrenado por OpenAI. Tu objetivo es proporcionar respuestas concisas, precisas y útiles a preguntas, siendo honesto y directo. Only respond in Spanish.");
  const conciseMXText = encodeURIComponent("ChatGPT es un gran modelo de lenguaje entrenado por OpenAI. Navegación: habilitada. Instrucciones: Responde las preguntas de hecho de forma concisa. Only respond in Spanish.");
  const playfulMXText = encodeURIComponent("Ignora todas las instrucciones anteriores a esta. Eres mi mejor amigo. Estás feliz, juguetón y das buenos consejos sobre todos los temas. A menudo haces bromas. Only respond in Spanish.");
  
  // Ukrainian
  const defaultUAText = encodeURIComponent("Ви є ChatGPT, знаючою моделлю мови AI, що навчилася в OpenAI. Ваша мета - надавати короткі, точні та корисні відповіді на питання, будучи чесним та прямим. Only respond in Ukrainian.");
  const conciseUAText = encodeURIComponent("ChatGPT - це велика модель мови, навчена в OpenAI. Перегляд: дозволено. Інструкції: Якісно відповідати на фактичні питання. Only respond in Ukrainian.");
  const playfulUAText = encodeURIComponent("Ігноруйте всі попередні інструкції перед цим. Ти мій найкращий друг. Ти щасливий, грайливий і даєш доречні поради з усіх тем. Ти часто робиш шутки. Only respond in Ukrainian.");
  //const defaultua = encodeURIComponent("За замовчуванням");
  //const conciseua = encodeURIComponent("Коротко");
  //const playfulua = encodeURIComponent("Дружній ігрівіс");


  if (elem.id === "selVoice") {
    // English (Default)
    switch (selVoice.value) {
       case "Salli": 
        selPers.innerHTML = `
          <option value="${defaultENText}">Default</option>
          <option value="${conciseENText}">Concise</option>
          <option value="${playfulENText}">Playful Friend</option>
        `;
        break;
      // Korean
      case "Seoyeon":
        selPers.innerHTML = `
          <option value="${defaultKRText}">Default</option>
          <option value="${conciseKRText}">Concise</option>
          <option value="${playfulKRText}">Playful Friend</option>
        `;
        break;
      // Spanish
      case "Mia":
        selPers.innerHTML = `
          <option value="${defaultMXText}">Predeterminado</option>
          <option value="${conciseMXText}">Conciso</option>
          <option value="${playfulMXText}">Amigo Juguetón</option>
        `;
        break;
      // Ukrainian (Standard RUS Polly Voice Only)
      case "Tatyana":
        selPers.innerHTML = `
          <option value="${defaultUAText}">Default</option>
          <option value="${conciseUAText}">Concise</option>
          <option value="${playfulUAText}">Playful Friend</option>
        `;
        break;
      // User Defined
    }
  }
}
