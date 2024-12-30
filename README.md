# ChatGPT HTML - Using OpenAI APIs; 
![Screenshot from 2024-12-23 22-14-32](https://github.com/user-attachments/assets/f26717ea-6048-4353-b668-7a10d66583f9)

v.2.0.6

This allows you to easily interact with OpenAI and Google Generative APIs.

## Getting Started

1. Add your OpenAI API key to the "```OPENAI_API_KEY```" variable and (optionally) AWS, Google Keys in ```config.json``` for additional functionality. 
2. Open ```index.html``` and have fun!
3. Optional: - Suno-Ai's Bark TTS Engine. Run ```server.py``` (GPU Enabled)
4. **Note: You may have to review/adjust the code for your specific env. ie ```CIDR ranges```, ```NGINX/webserver``` configuration,```scripting``` piece etc.**
   
## Features

- Keeps conversation memory
- OpenAI ```o1```, ```o1-*``` models
- OpenAI ```gpt-4o``` models
- Latest Google Gemini 2.0 ```Thinking``` model
- [lmstudio API](https://lmstudio.ai/docs/api/openai-api) local models 
- Dall-E Image Generation
- Google Vision 
- Model Selection, Multiple languages, and Print Conversation.
- Convert to Speech using Amazon Polly's Text-to-Speech service.
- Suno-Ai's Bark TTS Engine available
- Use Google Search with the Keyword "Google"
- Images served with Google Image Search
- Additional scraped data with scripts
- Basic Error handling

## Bugs
- Check Issues
- Response with ```"usage":{"completion_tokens":420}``` causes weird display bug on-screen.
- **Not for Production use (really messy code, likely security concerns, all-over-the-place, good playgroud and learning tho!)**

Grabbed the inital idea from here https://www.codeproject.com/Articles/5350454/Chat-GPT-in-JavaScript <br>
Complete overhaul of the code base.

> [!IMPORTANT]
> Check out this Android Port of Eva I am working on 🤖
> - [Eva LLM Android](https://github.com/appatalks/eva_llm_android)
