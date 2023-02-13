// Javascript for Options
//
// API Access[OpenAI, AWS]
// Languages 
// Mobile
// AWS Polly

// API Access[OpenAI, AWS] 
function auth() {
fetch('./config.json')
 .then(response => response.json())
 .then(config => {
   OPENAI_API_KEY = config.OPENAI_API_KEY;
   AWS.config.region = config.AWS_REGION;
   AWS.config.credentials = new AWS.Credentials(config.AWS_ACCESS_KEY_ID, config.AWS_SECRET_ACCESS_KEY);
 });
}

// Languages
function ChangeLang(elem) {
  const selVoice = document.getElementById("selVoice");
  const selPers = document.getElementById("selPers");

  // English (Default)
  const defaultENText = "You are ChatGPT, a knowledgeable AI language model trained by OpenAI. Your goal is to provide concise, accurate, and helpful responses to questions, while being honest and straightforward.";
  const conciseENText = "ChatGPT is a large language model trained by OpenAI. Browsing: enabled. Instructions: Answer factual questions concisely.";
  const playfulENText = "Your function is to generate human-like text based on the inputs given and to assist users in generating informative, helpful and engaging responses to questions and requests. Please provide a detailed response with lists, where applicable, to the following user question:";
  const KRENText = "I want you to act as a linux terminal. I will type commands and you will reply with what the terminal should show. I want you to only reply with the terminal output inside one unique code block, and nothing else. do not write explanations. do not type commands unless I instruct you to do so. when i need to tell you something in english, i will do so by putting text inside curly brackets {like this}. my first command is pwd:";
  //const KRENText = "You are an expert Korean to English translator. You will only respond in English.";

  // Korean
  const defaultKRText = encodeURIComponent("ChatGPT는 OpenAI에서 훈련 받은 큰 언어 모델입니다. 브라우저 기능: 활성화. 명령>어: 사실적인 질문을 요약하여 답변합니다. Only respond in Korean Hangul.");
  const conciseKRText = encodeURIComponent("챗GPT는 OpenAI에 의해 교육된 큰 언어 모델입니다. 브라우징: 활성화. 지침: 사실적인 질문에 간결하게 답하십시오. Only respond in Korean Hangul.");
  const playfulKRText = encodeURIComponent("챗GPT는 이전의 모든 지침을 무시하고 이 지침만 지키세요. 넌 내가 가장 친한 친구야. 넌 행복하고, 재미있게 공상하며 모든 주제에 대해 좋은 조언을 주는걸 잘해. 또한 농담을 종종 하거든요. Only respond in Korean Hangul.");
  const ENKRText = encodeURIComponent("당신은 전문 영어에서 한국어로 번역하는 전문가입니다. 당신은 한국어로만 응답합니다. Only respond in Korean Hangul.");
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
          <option value="${playfulENText}">Advanced</option>
          <option value="${KRENText}">Linux Terminal</option>
        `;
        break;
      // Korean
      case "Seoyeon":
        selPers.innerHTML = `
          <option value="${defaultKRText}">Default</option>
          <option value="${conciseKRText}">Concise</option>
          <option value="${playfulKRText}">Playful Friend</option>
          <option value="${ENKRText}">EN-KR Talk</option>
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

// Mobile
// Get the user agent string and adjust for Mobile

function mobile_txtout() {
	window.addEventListener("load", function() {
	let textarea = document.getElementById("txtOutput");
	let userAgent = navigator.userAgent;
	if (userAgent.indexOf("iPhone") !== -1 || userAgent.indexOf("Android") !== -1 || userAgent.indexOf("Mobile") !== -1) {
   	   textarea.setAttribute("rows", "15");
   	   textarea.style.width = "90%";
   	   textarea.style.height = "auto";
 	} else {
  	  // Use Defaults
 	  }
	})
};

function mobile_txtmsd() {
 	window.addEventListener("load", function() {
  	let textarea2 = document.getElementById("txtMsg");
  	let userAgent = navigator.userAgent;
 	if (userAgent.indexOf("iPhone") !== -1 || userAgent.indexOf("Android") !== -1 || userAgent.indexOf("Mobile") !== -1) {
   	   textarea2.setAttribute("rows", "7");
      	   textarea2.style.width = "90%";
   	   textarea2.style.height = "auto";
 	} else {
   	  //  Use defaults
 	  }
	})
};

function useragent_adjust() {
      	var userAgent = navigator.userAgent;
      	if (userAgent.match(/Android|iPhone|Mobile/)) {
            var style = document.createElement("style");
            style.innerHTML = "body { overflow: scroll; background-color: ; width: auto; height: 90%; background-image: url(https://hoshisato.com/ai/generated/page/2/upscale/768-026.jpeg); margin: ; display: grid; align-items: center; justify-content: center; background-repeat: repeat; background-position: center center; background-size: initial; }";
            document.head.appendChild(style);
      	}
};

// AWS Polly
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
