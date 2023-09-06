# ChatGPT HTML - Using OpenAI APIs; 
![screenshot-catdog](screenshot-catdog.png)

v.1.6a

This allows you to easily interact with the OpenAI API.

## Getting Started

1. Add your OpenAI API key to the "OPENAI_API_KEY" variable and (optionally) AWS, Google Keys in config.json for additional functionality. 
2. Open index.html and have fun!
3. Optional: - Suno-Ai's Bark TTS Engine Added. Run server.py (GPU Enabled)
4. **Note: You may have to review/adjust the code for your specific env. ie CIDR ranges, NGINX/webserver configuration,scripting piece etc.**
   
## Features

- GPT-4 Support
- Google PaLM Support added (Bard)
- Google Vision API added (AI Image processing)
- Model Selection, Multiple languages, and Print Conversation.
- Convert to Speech using Amazon Polly's Text-to-Speech service.
- Suno-Ai's Bark TTS Added
- Use Google Search with the Keyword "Google"
- Images served with Google Image Search
- Additional scraped data with scripts
- Basic Error handling

## Bugs
- Check Issues
- Response with "usage":{"completion_tokens":420} causes weird display bug on-screen.
- **Not for Production use (really messy code, likely security concerns, all-over-the-place, good playgroud and learning tho!)**

Grabbed the inital idea from here https://www.codeproject.com/Articles/5350454/Chat-GPT-in-JavaScript <br>
Complete overhaul of the code base.
