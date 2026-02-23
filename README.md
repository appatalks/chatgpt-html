# ChatGPT HTML - Eva AI Assistant
![screenshot](core/img/lcars-screenshot.png)

v.5.0

A lightweight web UI for interacting with multiple AI providers — OpenAI, GitHub Copilot, Google Gemini, and local LLMs. No frameworks, no build steps — just HTML, CSS, and JavaScript.

## Getting Started

1. Add your API keys to `config.json` (see `config.example.json` for the template).
2. Open `index.html` in a browser and start chatting.

**Local file:// usage** (no server needed):
- Copy `config.local.example.js` → `config.local.js` and fill your keys.
- Open `index.html` directly — no fetch call needed.

**Hosted usage** (nginx, Apache, etc.):
- Serve the project over HTTP(S) and use `config.json` for API keys.

## Features

### AI Providers
| Provider | Models | Auth |
|---|---|---|
| **OpenAI** | GPT-4o, o1, o3-mini, GPT-5-mini, latest | OpenAI API Key |
| **GitHub Copilot** (Models API) | GPT-4o, GPT-4o Mini, o3-mini | GitHub PAT (Models permission) |
| **GitHub Copilot** (ACP Bridge) | Claude Opus/Sonnet/Haiku, GPT-5.x, Gemini 3 Pro | Copilot CLI license |
| **Google Gemini** | Gemini 2.0 Flash Thinking | Google Gemini API Key |
| **lm-studio** | Any local model | Local (no key) |
| **DALL-E 3** | Image generation | OpenAI API Key |

### MCP Tools (via ACP Bridge)
| Tool | What it does | Auth |
|---|---|---|
| **Kusto MCP** | Query Azure Data Explorer — KQL queries, list databases/tables/schemas | Device code (Microsoft account) |
| **Azure MCP** | 42+ Azure services — Storage, Key Vault, Monitor, Compute, etc. | `az login` |
| **GitHub MCP** | Repos, issues, PRs, Actions, code search, Dependabot | GitHub PAT + Docker |

### Other Features
- Full-featured **Settings panel** (General, Models, Auth, Prompts, MCP tabs)
- Editable **system/developer prompt** with personality presets
- **Conversation memory** (localStorage)
- **Google Search** augmentation (keyword "Google")
- **Google Vision** for image analysis
- **Amazon Polly** and **Bark** text-to-speech
- **LCARS theme** (Star Trek-inspired UI)
- Print conversation, speech recognition input

## Copilot ACP Bridge

The ACP Bridge connects Eva to GitHub Copilot CLI's [Agent Client Protocol](https://zed.dev/acp), giving access to all models your Copilot license supports.

```bash
# Start the bridge (on any 64-bit machine with copilot CLI)
python3 tools/acp_bridge.py --port 8888

# With Kusto/ADX support
python3 tools/acp_bridge.py --port 8888 --enable-kusto-mcp \
  --kusto-cluster "https://your-cluster.region.kusto.windows.net"

# With all MCP servers
python3 tools/acp_bridge.py --port 8888 --enable-kusto-mcp --enable-azure-mcp --enable-github-mcp
```

**Prerequisites:** `copilot` CLI installed and authenticated (`copilot login`), Python 3.7+.

**For server deployment** (64-bit Linux): `sudo ./tools/acp_setup.sh`

## Project Structure

```
index.html              — Main UI
config.json             — API keys (not committed)
core/
  style.css             — All styling (base + LCARS theme)
  js/
    options.js          — Config, routing, settings, auth, prompts
    gpt-core.js         — OpenAI Chat Completions
    gl-google.js        — Google Gemini
    lm-studio.js        — Local LLM (lm-studio)
    copilot.js          — GitHub Copilot (Models API + ACP)
    dalle3.js           — DALL-E image generation
    external.js         — External data (weather, news, markets)
  themes/lcars.css      — LCARS theme overrides
tools/
  acp_bridge.py         — ACP ↔ HTTP bridge server
  kusto_mcp.py          — Kusto MCP server (ADX queries)
  acp_setup.sh          — One-command server installer
  acp_bridge.service    — Systemd unit file
  barkTTS_server.py     — Bark TTS engine server
```

## Contributing

See `.github/copilot-instructions.md` for contribution guidance and model wiring conventions.

## Bugs
- Check [Issues](https://github.com/appatalks/chatgpt-html/issues)
- **Not for production use** — this is a learning playground and personal project.

Based on the initial idea from [CodeProject](https://www.codeproject.com/Articles/5350454/Chat-GPT-in-JavaScript). Complete overhaul of the codebase.

