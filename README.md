# ChatGPT HTML - Using OpenAI APIs; 
Optional Support with AWS Polly and Google Search APIs.

![Screenshot_new](Screenshot_new.png)

v.1.1

This allows you to easily interact with the OpenAI API.

## Getting Started

1. Add your OpenAI API key and AWS Keys to the "OPENAI_API_KEY" variable and (optinally) AWS and Google Keys in config.json. 
2. Open chatgpt.html and have fun!

## Features

- GPT-4 Support (Needs Testing)
- Model Selection, Multiple languages, and Print Conversation.
- Convert to Speech using Amazon Polly's Text-to-Speech service.
- Use Google Search with the Keyword "Google"
- Additional scraped data with scripts
- Basic Error handling

## Bugs
- actively on the look out for these
- Response with "usage":{"completion_tokens":420} causes weird display bug on-screen.

Grabbed the inital idea from here https://www.codeproject.com/Articles/5350454/Chat-GPT-in-JavaScript <br>
Complete overhaul of the code base.
