# ChatGPT HTML - Using OpenAI APIs and AWS Polly speech

v.0.3

This allows you to easily interact with the OpenAI API and convert the response to speech using Amazon Polly's Text-to-Speech service.

## Getting Started

1. Add your OpenAI API key and AWS Keys to the "OPENAI_API_KEY" variable and "AWS.config.credentials" in config.json. 
2. Open ChatGPT.html and have fun!

## Features

- Model Selection, Multiple languages, and Print Conversation.
- Convert to Speech using Amazon Polly's Text-to-Speech service.
- Error handling for issues that may occur during the API call and speech conversion.

## Bugs
No Response Bug #7
  -- Can force it to continue by sending stop defined command "&*&" and then something totally random like, "Hello!!!!".

Grabbed the inital idea from here https://www.codeproject.com/Articles/5350454/Chat-GPT-in-JavaScript <br>
Complete overhaul of the code base.
