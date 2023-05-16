// Javascript
// For Google PaLM API ie Bard

function palmSend() {
var sQuestion = txtMsg.innerHTML;

function auth() {
  return fetch('./config.json')
    .then(response => response.json())
    .then(config => config.GOOGLE_PALM_KEY);
}

const MODEL_NAME = "chat-bison-001";

auth().then(GOOGLE_PALM_KEY => {
  const gapiUrl = `https://generativelanguage.googleapis.com/v1beta2/models/${MODEL_NAME}:generateMessage?key=${GOOGLE_PALM_KEY}`;

  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: {
        context:
          "You are Eva, a knowledgeable AI language model. Your goal is to provide accurate, and helpful responses to questions, while being honest and straightforward.",
        examples: [],
        messages: [{ content: sQuestion }],
      },
      temperature: 0.25,
      top_k: 40,
      top_p: 0.95,
      candidate_count: 1,
    }),
  };

  fetch(gapiUrl, requestOptions)
    .then((response) => response.json())
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
	txtOutput.innerHTML += JSON.stringify(result, null, 2);
    })
    .catch((error) => {
      console.error("Error:", error);
    });
});

}
