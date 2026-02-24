# ChatGPT HTML — Eva AI Assistant
![screenshot](core/img/lcars-screenshot.png)

v.5.0

A lightweight web UI for chatting with multiple AI providers. No frameworks, no build steps — just HTML, CSS, and JavaScript.

## Quick Start

1. Copy `config.example.json` → `config.json` and add your API keys.
2. Open `index.html` in a browser.

> **Tip:** For local file:// usage, copy `config.local.example.js` → `config.local.js` instead.

## Supported Providers

| Provider | Models | Auth |
|---|---|---|
| **OpenAI** | GPT-4o, o1, o3-mini, GPT-5-mini | OpenAI API Key |
| **GitHub Copilot** (PAT) | GPT-4o, GPT-4o Mini, o3-mini | GitHub PAT |
| **GitHub Copilot** (ACP) | Claude, GPT-5.x, Gemini 3 Pro | Copilot CLI |
| **Google Gemini** | Gemini 2.0 Flash Thinking | Gemini API Key |
| **lm-studio** | Any local model | None |
| **DALL-E 3** | Image generation | OpenAI API Key |

## Highlights

- **Settings panel** with tabbed UI (General, Models, Auth, Prompts, MCP)
- **MCP tools** — Query Azure Data Explorer (Kusto), GitHub repos, Azure services
- **Inline images** — Wikimedia search or DALL-E generation
- **LCARS theme** — Star Trek-inspired interface
- **Text-to-speech** — Amazon Polly and Bark TTS
- **Conversation memory** in localStorage

## ACP Bridge (Copilot CLI)

```bash
python3 tools/acp_bridge.py --port 8888
python3 tools/acp_bridge.py --port 8888 --enable-kusto-mcp --kusto-cluster "https://..."
```

Requires: `copilot` CLI installed + authenticated. [Details →](README-2.md#acp-bridge)

## Documentation

See [README-2.md](README-2.md) for architecture, dependencies, and technical details.

## Contributing

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for contribution guidance.

---
*Based on [CodeProject](https://www.codeproject.com/Articles/5350454/Chat-GPT-in-JavaScript). Complete overhaul.*

