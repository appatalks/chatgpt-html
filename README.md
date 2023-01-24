# OpenAI API and Amazon Polly integration for Webpage

v.0.1

This JavaScript and HTML file allows you to easily interact with the OpenAI API and convert the response to speech using Amazon Polly's Text-to-Speech service.

## Getting Started

1. Add your OpenAI API key and AWS Keys to the "OPENAI_API_KEY" variable and "AWS.config.credentials" resctively. 
2. Add the file to your project and trigger the Send() function on an event (such as a button press).
3. The response from the OpenAI API will be displayed in a text area and also converted to speech using Amazon Polly. 

## Features

- Send a question to the OpenAI API and receive a response.
- Select the model, language, and voice for the response.
- Convert the response to speech using Amazon Polly's Text-to-Speech service.
- Error handling for issues that may occur during the API call and speech conversion.

Grabbed the idea from here https://www.codeproject.com/Articles/5350454/Chat-GPT-in-JavaScript
I also replaced speech to use Polly and removed other parts to fit my needs. I had also modifed the code to use with Korean Language.
