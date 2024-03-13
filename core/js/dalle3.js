// dall-e-3

function dalle3Send() {
        // let OPENAI_API_KEY;

        function auth() {
            fetch('./config.json')
            .then(response => response.json())
            .then(config => {
                OPENAI_API_KEY = config.OPENAI_API_KEY;
            });
        }

        // Call the auth() function to retrieve the API key
        auth();

            // Get user input from the form
            const prompt = document.getElementById("txtMsg").innerHTML;
            // const size = document.getElementById("size").value;

            // Check if the API key is available
            if (!OPENAI_API_KEY) {
                alert("OpenAI API key not available. Please check your configuration.");
                return;
            }

            // Clear the send div before adding new images
            document.getElementById("txtMsg").innerHTML = "";
            document.getElementById("txtOutput").innerHTML += '<span class="user">You: </span>' + prompt + "<br>" + "\n";

            // Send an API request using JavaScript fetch
            fetch("https://api.openai.com/v1/images/generations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    "model": "dall-e-3",
                    "prompt": prompt,
                    "n": 1, // Request n images
                    "size": "1024x1024" // size Must be one of 1024x1024, 1792x1024, or 1024x1792 for dall-e-3 models.
                })
            })
            .then(response => response.json())
            .then(data => {
                // Display each generated image in the result div
		data.data.forEach((image, index) => {
    		const imgElement = document.createElement("img");
    		imgElement.src = image.url;
    		imgElement.alt = `Generated Image ${index + 1}`;

    		// Create an anchor element and set attributes for opening in a new tab
    		const linkElement = document.createElement("a");
    		linkElement.href = image.url; // Set the image URL as the link's destination
    		linkElement.target = "_blank"; // Ensures the link opens in a new tab
    		linkElement.appendChild(imgElement); // Append the image to the anchor element

    		// Append the anchor element (which contains the image) to the result div
		document.getElementById("txtOutput").innerHTML += '<span class="eva">Eva: </span>' + "Here is a generated image of that description ... " + "\n";
    		document.getElementById("txtOutput").appendChild(linkElement);
                var element = document.getElementById("txtOutput");
                element.scrollTop = element.scrollHeight;
		});
            })
            .catch(error => {
                console.error("Error:", error);
            });
        
}

