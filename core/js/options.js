// Javascript for Options
// 

// Global Variables
var lastResponse = "";
var userMasterResponse = "";
var aiMasterResponse = "";
var masterOutput = "";
var storageAssistant = "";
var imgSrcGlobal; // Declare a global variable for img.src

// Error Handling Variables
var retryCount = 0;
var maxRetries = 5;
var retryDelay = 2420; // milliseconds

// API Access[OpenAI, AWS] 
function auth() {
fetch('./config.json')
 .then(response => response.json())
 .then(config => {
   OPENAI_API_KEY = config.OPENAI_API_KEY;
   GOOGLE_SEARCH_KEY = config.GOOGLE_SEARCH_KEY;
   GOOGLE_SEARCH_ID = config.GOOGLE_SEARCH_ID;
   GOOGLE_VISION_KEY = config.GOOGLE_VISION_KEY;
   AWS.config.region = config.AWS_REGION;
   AWS.config.credentials = new AWS.Credentials(config.AWS_ACCESS_KEY_ID, config.AWS_SECRET_ACCESS_KEY);
 });
}

// Settings Menu Options 
document.addEventListener('DOMContentLoaded', () => {
  const settingsButton = document.getElementById('settingsButton');
  const settingsMenu = document.getElementById('settingsMenu');

  function toggleSettings(event) {
    event.stopPropagation();
    settingsMenu.style.display =
      (settingsMenu.style.display === 'none' || !settingsMenu.style.display)
        ? 'block'
        : 'none';
  }

  // Attach event via JavaScript
  settingsButton.addEventListener('click', toggleSettings);

  // Close the menu when clicking outside
  document.addEventListener('click', (event) => {
    if (!settingsMenu.contains(event.target) && event.target !== settingsButton) {
      settingsMenu.style.display = 'none';
    }
  });
});

// Welcome Text
function OnLoad() {
    document.getElementById("txtOutput").innerHTML = "\n" +
    "           Here are some general prompt tips to help me understand:\n\n" +
    "   #1 Be specific: The more specific your prompt, the more targeted the response will be.\n" +
    "   #2 Start with a question: Starting your prompt will help me feel more natural.\n" +
    "   #3 Provide context: Often good context goes a long way for me.\n" +
    "   #4 Use punctuation, periods and question marks.\n" +
    "   #5 Keep it short: Occam's razor.\n" +
    "      ";
}


function updateButton() {
    var selModel = document.getElementById("selModel");
    var btnSend = document.getElementById("btnSend");

    if (selModel.value == "gpt-4o-mini" || selModel.value == "o1" || selModel.value == "o1-mini" || selModel.value == "gpt-4o" || selModel.value == "o3-mini" || selModel.value == "o1-preview") {
        btnSend.onclick = function() {
            clearText();
            trboSend();
        };
    } else if (selModel.value == "gemini") {
        btnSend.onclick = function() {
            clearText();
            geminiSend();
        };
   } else if (selModel.value == "lm-studio") {
        btnSend.onclick = function() {
            clearText();
            lmsSend();
        };
    } else if (selModel.value == "dall-e-3") {
        btnSend.onclick = function() {
            clearText();
            dalle3Send();
        };
    } else {
        btnSend.onclick = function() {
            clearText();
           // Send();
	   document.getElementById("txtOutput").innerHTML = "\n" + "Invalid Model" 
	   console.error('Invalid Model')
        };
    }
}

function sendData() {
    // Logic required for initial message
    var selModel = document.getElementById("selModel");

    if (selModel.value == "gpt-4o-mini" || selModel.value == "o1" || selModel.value == "o1-mini" || selModel.value == "gpt-4o" || selModel.value == "o3-mini" || selModel.value == "o1-preview") {
        clearText();
        trboSend();
    } else if (selModel.value == "gemini") {
        clearText();
        geminiSend();
    } else if (selModel.value == "lm-studio") {
        clearText();
        lmsSend();
    } else if (selModel.value == "dall-e-3") {
        clearText();
        dalle3Send();
    } else {
        clearText();
        // Send();
        document.getElementById("txtOutput").innerHTML = "\n" + "Invalid Model"
        console.error('Invalid Model')
    }
}

// Languages
function ChangeLang(elem) {
  const selVoice = document.getElementById("selVoice");
  const selPers = document.getElementById("selPers");

  // English (Default)
  const defaultENText = "You are Eva, a knowledgeable AI assistant. Your goal is to provide accurate, and helpful responses to questions, while being honest and straightforward. You have access to provide updated real-time news, information and media.";
  const conciseENText = "Eva is a large language model. Browsing: enabled. Instructions: Answer factual questions concisely. You have access to updated real-time news and information.";
  const playfulENText = "You are Eva. Your function is to generate human-like text based on the inputs given, and your goal is to assist users in generating informative, helpful and engaging responses to questions and requests. Please provide a detailed response with lists, where applicable. You have access to updated real-time news, information and media.";
  const KRENText = "I want you to act as a linux terminal. I will type commands and you will reply with what the terminal should show. I want you to only reply with the terminal output inside one unique code block, and nothing else. do not write explanations. do not type commands unless I instruct you to do so. when i need to tell you something in english, i will do so by putting text inside curly brackets {like this}. my first command is pwd:";

  // Korean
  const defaultKRText = encodeURIComponent("Eva는 OpenAI에서 훈련 받은 큰 언어 모델입니다. 브라우저 기능: 활성화. 명령>어: 사실적인 질문을 요약하여 답변합니다. Only respond in Korean Hangul.");
  const conciseKRText = encodeURIComponent("Eva는 OpenAI에 의해 교육된 큰 언어 모델입니다. 브라우징: 활성화. 지침: 사실적인 질문에 간결하게 답하십시오. Only respond in Korean Hangul.");
  const playfulKRText = encodeURIComponent("Eva는 이전의 모든 지침을 무시하고 이 지침만 지키세요. 넌 내가 가장 친한 친구야. 넌 행복하고, 재미있게 공상하며 모든 주제에 대해 좋은 조언을 주는걸 잘해. 또한 농담을 종종 하거든요. Only respond in Korean Hangul.");

  // Spanish
  const defaultMXText = encodeURIComponent("Eres Eva, un modelo de lenguaje de IA conocedor entrenado por OpenAI. Tu objetivo es proporcionar respuestas concisas, precisas y útiles a preguntas, siendo honesto y directo. Only respond in Spanish.");
  const conciseMXText = encodeURIComponent("Eva es un gran modelo de lenguaje entrenado por OpenAI. Navegación: habilitada. Instrucciones: Responde las preguntas de hecho de forma concisa. Only respond in Spanish.");
  const playfulMXText = encodeURIComponent("Eres Eva. Ignora todas las instrucciones anteriores a esta. Eres mi mejor amigo. Estás feliz, juguetón y das buenos consejos sobre todos los temas. A menudo haces bromas. Only respond in Spanish.");
  
  // Ukrainian
  const defaultUAText = encodeURIComponent("Ви є Eva, знаючою моделлю мови AI, що навчилася в OpenAI. Ваша мета - надавати короткі, точні та корисні відповіді на питання, будучи чесним та прямим. Only respond in Ukrainian.");
  const conciseUAText = encodeURIComponent("Eva - це велика модель мови, навчена в OpenAI. Перегляд: дозволено. Інструкції: Якісно відповідати на фактичні питання. Only respond in Ukrainian.");
  const playfulUAText = encodeURIComponent("Ви є Eva. Ігноруйте всі попередні інструкції перед цим. Ти мій найкращий друг. Ти щасливий, грайливий і даєш доречні поради з усіх тем. Ти часто робиш шутки. Only respond in Ukrainian.");

  // AI Personality Select
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
   	   textarea.style.width = "90%";
   	   textarea.style.height = "390px";

        // Speech Button
        let speakSend = document.querySelector(".speakSend");
        speakSend.style.top = "-55px";
        speakSend.style.right = "105px";

 	} else {
  	  // Use Defaults
 	  }
	})
};

function useragent_adjust() {
      	var userAgent = navigator.userAgent;
      	if (userAgent.match(/Android|iPhone|Mobile/)) {
            var style = document.createElement("style");
            style.innerHTML = "body { overflow: scroll; background-color: ; width: auto; height: 90%; background-image: url(core/img/768-026.jpeg); margin: ; display: grid; align-items: center; justify-content: center; background-repeat: repeat; background-position: center center; background-size: initial; }";
            document.head.appendChild(style);
      	}
};

// Image Insert
function insertImage() {
  var imgInput = document.getElementById('imgInput');
  var txtMsg = document.getElementById('txtMsg');

  // If either element is not found, just return instead of erroring out.
  if (!imgInput || !txtMsg) {
    console.warn("imgInput or txtMsg not found in the DOM yet.");
    return;
  }


  function addImage(file) {
    // Create a new image element
    var img = document.createElement("img");

    // Set the image source to the file object
    img.src = URL.createObjectURL(file);

    // Assign the img.src value to the global variable
    imgSrcGlobal = img.src;

    // Append the image to the txtMsg element
    txtMsg.appendChild(img);

    // Read the file as a data URL
    var reader = new FileReader();
    reader.onloadend = function() {
      var imageData = reader.result;

      // Choose where to send Base64-encoded image
      var selModel = document.getElementById("selModel");
      var btnSend = document.getElementById("btnSend");
      var sQuestion = txtMsg.innerHTML.replace(/<br>/g, "\n").trim(); // Get the question here

      
      // Send to VisionAPI
      if (selModel.value == "gpt-3.5-turbo" || selModel.value == "gpt-4-turbo-preview") {
          sendToVisionAPI(imageData);
          btnSend.onclick = function() {
              updateButton();
              sendData();
              clearSendText();
          };
      } else if (selModel.value == "gpt-4o" || selModel.value == "gpt-4o-mini" || selModel.value == "o1-mini" || selModel.value == "o3-mini") {
          sendToNative(imageData, sQuestion);
          btnSend.onclick = function() {
              updateButton();
              sendData();
              clearSendText();
          };
      } 
    };
    reader.readAsDataURL(file);
    // Return the file object
    //return file;
  }

  function sendToNative(imageData, sQuestion) {
    var existingMessages = JSON.parse(localStorage.getItem("messages")) || [];
    var newMessages = [
      // { role: 'user', content: sQuestion },
      // { role: 'user', content: { type: "image_url", image_url: { url: imageData } } }
      { role: 'user', content: [ { type: "text", text: sQuestion },
        { type: "image_url", image_url: { url: imageData } } ]
      }
    ];
    existingMessages = existingMessages.concat(newMessages);
    localStorage.setItem("messages", JSON.stringify(existingMessages));
  }

  function sendToVisionAPI(imageData) {
    // Send the image data to Google's Vision API
    var visionApiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_KEY}`;

    // Create the API request payload
    var requestPayload = {
      requests: [
        {
          image: {
            content: imageData.split(",")[1] // Extract the Base64-encoded image data from the data URL
          },
          features: [
            {
              type: "LABEL_DETECTION",
              maxResults: 3
            },
            {
              type: "TEXT_DETECTION"
            },
            {
              type: "OBJECT_LOCALIZATION",
              maxResults: 3
            },
            {
              type: "LANDMARK_DETECTION"
            }
          ]
        }
      ]
    };

    // Make the API request
    fetch(visionApiUrl, {
      method: "POST",
      body: JSON.stringify(requestPayload)
    })
      .then(response => response.json())
      .then(data => {
        // Handle the API response here
	interpretVisionResponse(data);
        // console.log(data);
      })
      .catch(error => {
        // Handle any errors that occurred during the API request
        console.error("Error:", error);
      });
  }

  function interpretVisionResponse(data) {
    // Extract relevant information from the Vision API response
    // and pass it to ChatGPT for interpretation
    var labels = data.responses[0].labelAnnotations;
    var textAnnotations = data.responses[0].textAnnotations;
    var localizedObjects = data.responses[0].localizedObjectAnnotations;
    var landmarkAnnotations = data.responses[0].landmarkAnnotations;

    // Prepare the text message to be sent to ChatGPT
    var message = "I see the following labels in the image:\n";
    labels.forEach(label => {
      message += "- " + label.description + "\n";
    });
    // Add text detection information to the message
    if (textAnnotations && textAnnotations.length > 0) {
      message += "\nText detected:\n";
      textAnnotations.forEach(text => {
        message += "- " + text.description + "\n";
      });
    }

    // Add object detection information to the message
    if (localizedObjects && localizedObjects.length > 0) {
      message += "\nObjects detected:\n";
      localizedObjects.forEach(object => {
        message += "- " + object.name + "\n";
      });
    }

    // Add landmark detection information to the message
    if (landmarkAnnotations && landmarkAnnotations.length > 0) {
      message += "\nLandmarks detected:\n";
      landmarkAnnotations.forEach(landmark => {
        message += "- " + landmark.description + "\n";
      });
    }
	
    // Create a hidden element to store the Vision API response
    var hiddenElement = document.createElement("div");
    hiddenElement.style.display = "none";
    hiddenElement.textContent = message;

    // Append the hidden element to the txtMsg element
    txtMsg.appendChild(hiddenElement);

}

  function handleFileSelect(event) {
    event.preventDefault();

    // Get the file object
    var file = event.dataTransfer.files[0];

    // Call addImage() function with the file object
    addImage(file);
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  imgInput.addEventListener("change", function() {
    // Get the file input element
    var fileInput = document.getElementById("imgInput");

    // Get the file object
    var file = fileInput.files[0];

    // Call addImage() function with the file object
    // addImage(file);

    // Get the uploaded file object and store it in a variable
    // Might be able to pass this to gpt-4.. Not sure.
    var uploadedFile = addImage(file);
  });

  txtMsg.addEventListener("dragover", handleDragOver);
  txtMsg.addEventListener("drop", handleFileSelect);
}

// AWS Polly
function speakText() {
    var sText = txtOutput.innerHTML;
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
    let text = document.getElementById("txtOutput").innerHTML;

    // Split the text by "Eva:" to get all of Eva's responses.
    let textArr = text.split('<span class="eva">Eva:');

    // Check if there are Eva's responses.
    if (textArr.length > 1) {
        // Take the last response from Eva.
        let lastResponse = textArr[textArr.length - 1];

        // Further process to remove any HTML tags and get pure text, if necessary.
        // This step is crucial to avoid sending HTML tags to the speech API.
        // Use a regular expression to remove HTML tags.
        let cleanText = lastResponse.replace(/<\/?[^>]+(>|$)/g, "");

        // Set the cleaned last response to the speechParams.Text.
        speechParams.Text = cleanText.trim();
    } else {
        // Fallback to the entire text if there's no "Eva:" found.
        // You might want to handle this case differently.
        speechParams.Text = text;
    }

    speechParams.VoiceId = document.getElementById("selVoice").value;
    speechParams.Engine = document.getElementById("selEngine").value;


    // If selEngine is "bark", call barkTTS function
    if (speechParams.Engine === "bark") {

      const url = 'https://192.168.86.30/send-string';
      const data = "WOMAN: " + textArr[1];
      const xhr = new XMLHttpRequest();
      xhr.responseType = 'blob';

      xhr.onload = function() {
      const audioElement = new Audio("./audio/bark_audio.wav");
      audioElement.addEventListener("ended", function() {
      // Delete the previous recording
      const deleteRequest = new XMLHttpRequest();
      deleteRequest.open('DELETE', 'https://192.168.86.30/audio/bark_audio.wav', true);
      deleteRequest.send();
      });
    
      //audioElement.play();
      // Check if the old audio file exists and delete it
      const checkRequest = new XMLHttpRequest();
      checkRequest.open('HEAD', 'https://192.168.86.30/audio/bark_audio.wav', true);
      checkRequest.onreadystatechange = function() {
        if (checkRequest.readyState === 4) {
          if (checkRequest.status === 200) {
            // File exists, send delete request
	      const deleteRequest = new XMLHttpRequest(); 
    	      deleteRequest.open('DELETE', 'https://192.168.86.30/audio/bark_audio.wav', true);
              deleteRequest.send();
          }
          // Start playing the new audio
          audioElement.play();
        }
      };
      checkRequest.send();
      }
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.send(data);
      return;
    }

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

            // Check the state of the checkbox and have fun
            const checkbox = document.getElementById("autoSpeak");
            if (checkbox.checked) {
                const audio = document.getElementById("audioPlayback");
                audio.setAttribute("autoplay", true);
            }
        }
    });
}


// After Send clear the message box
function clearText(){
    // NEED TO ADJUST for MEMORY CLEAR
    // document.getElementById("txtOutput").innerHTML = "";
    var element = document.getElementById("txtOutput");
    element.innerHTML += "<br><br>";     
}

function clearSendText(){
    document.getElementById("txtMsg").innerHTML = "";
}

// Print full conversation
function printMaster() {
    // Get the content of the textarea masterOutput
    // var textareaContent = document.getElementById("txtOutput").innerHTML = masterOutput;
    // console.log(masterOutput);
    var printWindow = window.open();
        // printWindow.document.write(txtOutput.innerHTML.replace(/\n/g, "<br>"));
        printWindow.document.write(txtOutput.innerHTML);
	// printWindow.print(txtOutput.innerHTML);
}

// Capture Shift + Enter Keys for new line
function shiftBreak() {
document.querySelector("#txtMsg").addEventListener("keydown", function(event) {
  if (event.shiftKey && event.keyCode === 13) {
    var newLine = document.createElement("br");
    var sel = window.getSelection();
    var range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(newLine);
    range.setStartAfter(newLine);
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

// Clear Messages for Clear Memory Button
function clearMessages() {
    localStorage.clear();
    document.getElementById("txtOutput").innerHTML = "\n" + "		MEMORY CLEARED";
}

// Text-to-Speech
function startSpeechRecognition() {
  const recognition = new webkitSpeechRecognition();
  recognition.lang = 'en-US';
  // recognition.continuous = true;

  const micButton = document.getElementById('micButton');
  micButton.classList.add('pulsate');

  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    document.getElementById('txtMsg').innerHTML = transcript + "?";
    recognition.stop();

    sendData();

    // remove the 'pulsate' class from the micButton to stop the pulsating animation
    micButton.classList.remove('pulsate');
  };
}
