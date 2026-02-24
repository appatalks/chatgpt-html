# Technical Documentation

Detailed architecture, dependencies, and implementation notes for Eva AI Assistant.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                        Browser                           │
│  index.html + core/js/*.js + core/style.css              │
│                                                          │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌───────────────┐  │
│  │ OpenAI  │ │ Copilot  │ │ Gemini │ │ Copilot (ACP) │  │
│  │ Direct  │ │ PAT API  │ │ Direct │ │ via Bridge    │  │
│  └────┬────┘ └────┬─────┘ └───┬────┘ └───────┬───────┘  │
└───────┼──────────┼─────────┼──────────────┼──────────────┘
        │          │         │              │
        ▼          ▼         ▼              ▼
   api.openai  models.     google     ┌────────────┐
     .com    inference   generative   │ ACP Bridge │
             .ai.azure     .google    │ (Python)   │
               .com        apis.com   │ port 8888  │
                                      └─────┬──────┘
                                            │ stdio (NDJSON)
                                            ▼
                                      ┌────────────┐
                                      │ copilot    │
                                      │ --acp      │
                                      │ --stdio    │
                                      └─────┬──────┘
                                            │ spawns
                                            ▼
                                      ┌────────────┐
                                      │ MCP Servers│
                                      │ kusto, gh  │
                                      │ azure      │
                                      └────────────┘
```

### Request Flow

**Direct models (OpenAI, Copilot PAT, Gemini):**
Browser → XHR/fetch → Provider API → JSON response → `renderEvaResponse()`

**ACP models (Copilot CLI):**
1. Browser → `POST /v1/chat/completions` → ACP Bridge (HTTP)
2. Bridge → `session/prompt` → Copilot CLI (JSON-RPC over NDJSON/stdio)
3. Copilot may invoke MCP tools (bridge auto-grants permissions)
4. Copilot streams `session/update` notifications with text chunks
5. Bridge accumulates chunks → returns OpenAI-compatible JSON response

**Image handling:**
1. `_detectGenerationIntent()` captures user's intent + subject before send
2. AI responds with `[Image of ...]` placeholder
3. `renderEvaResponse()` detects placeholder, routes to:
   - **DALL-E 3** if user said "generate/create/draw" (uses user's simple subject)
   - **Wikimedia Commons** otherwise (progressive query: full → 2 words → 1 word)
4. Image inserted inline with lightbox click-to-expand

## Project Structure

```
index.html                 Main UI — chat output, settings modal, LCARS sidebar,
                           monitors dock, input area, lightbox
config.json                API keys (not committed, gitignored)
config.example.json        Template for config.json
config.local.example.js    Template for file:// usage (inlined config)

core/
  style.css                All styling — base theme, LCARS theme, settings panel,
                           monitors, chat bubbles, buttons, lightbox, responsive
  themes/lcars.css         Modular LCARS overrides (minimal — most in style.css)
  js/
    options.js             Core application logic:
                           - Config loading (auth(), applyConfig())
                           - Auth key management (getAuthKey, saveAuthKeys, loadAuthOverrides)
                           - System prompt management (getSystemPrompt, applyPersonalityPreset)
                           - Model routing (updateButton, sendData)
                           - Theme management (applyTheme)
                           - Token/network/session monitors
                           - Image handling (renderEvaResponse, _searchImage, _generateImage)
                           - Markdown renderer (renderMarkdown)
                           - AWS Polly TTS (speakText)
                           - Speech recognition, print, clear memory
    gpt-core.js            OpenAI Chat Completions API (trboSend)
                           - XHR-based (legacy, not fetch)
                           - Error handling with exponential backoff
                           - Model-specific params (o3-mini reasoning, gpt-5 top_p)
                           - External data augmentation (weather, news, markets, solar)
    gl-google.js           Google Gemini API (geminiSend)
                           - Thinking mode (extracts thoughts vs non-thoughts)
                           - Uses generativelanguage.googleapis.com v1alpha
    lm-studio.js           Local LLM via lm-studio (lmsSend)
                           - OpenAI-compatible endpoint on localhost:1234
                           - Hardcoded model name (granite-3.1-8b-instruct)
    copilot.js             GitHub Copilot integration (copilotSend)
                           - Dual mode: GitHub Models API (PAT) + ACP Bridge
                           - Auto-detects bridge URL (same-host, localhost, configured)
                           - MCP configuration (applyMCPConfig, refreshMCPStatus)
    dalle3.js              DALL-E 3 image generation (dalle3Send)
                           - Standalone mode (model selector = dall-e-3)
    external.js            External data fetching at page load
                           - date.data, weather.data, news.data, market.data, solar.data

tools/
  acp_bridge.py            ACP ↔ HTTP bridge server
                           - ACPClient: manages copilot subprocess, JSON-RPC protocol
                           - BridgeHandler: HTTP endpoints for browser
                           - Terminal capability for MCP tool execution
                           - Token caching across model switches
                           - MCP server configuration and hot-reload
  kusto_mcp.py             Custom MCP server for Azure Data Explorer
                           - 5 tools: list_databases, query, show_tables, show_schema, sample_data
                           - DeviceCodeCredential with persistent token cache
                           - Accepts pre-fetched token via KUSTO_ACCESS_TOKEN env
  acp_bridge.service       Systemd unit file for headless server deployment
  acp_setup.sh             One-command installer (arch check, copilot install, service setup)
  barkTTS_server.py        Suno Bark TTS engine server (GPU)
```

## Dependencies

### Browser-side (no install needed)
- Barlow Condensed font (loaded from Google Fonts CDN)
- AWS SDK v2.1304.0 (bundled, for Polly TTS)

### Server-side (for ACP Bridge)
| Dependency | Required for | Install |
|---|---|---|
| Python 3.7+ | ACP Bridge, Kusto MCP | Pre-installed on most Linux |
| Node.js 20+ | Copilot CLI | `nvm install 20` or system package |
| `@github/copilot` | Copilot CLI | `npm install -g @github/copilot` |
| `azure-identity` | Kusto MCP auth | `pip install azure-identity` |
| `requests` | Kusto MCP HTTP calls | `pip install requests` |
| Docker | GitHub MCP server | [docker.com](https://docker.com) |
| `@azure/mcp` | Azure MCP server | Auto-installed via `npx` |

### API Keys
| Key | Used by | Get it from |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI models, DALL-E 3 | [platform.openai.com](https://platform.openai.com/api-keys) |
| `GITHUB_PAT` | Copilot Models API | [github.com/settings/tokens](https://github.com/settings/tokens) (needs "Models" permission) |
| `GOOGLE_GL_KEY` | Google Gemini | [aistudio.google.com](https://aistudio.google.com/apikey) |
| `GOOGLE_VISION_KEY` | Google Vision (image analysis) | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| AWS credentials | Amazon Polly TTS | [AWS IAM Console](https://console.aws.amazon.com/iam/) |

## ACP Bridge

### Protocol

The bridge implements the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/overview/introduction) — a JSON-RPC 2.0 protocol over NDJSON (newline-delimited JSON) on stdio.

**ACP methods handled:**

| Method | Direction | Purpose |
|---|---|---|
| `initialize` | Client → Agent | Negotiate version, exchange capabilities |
| `session/new` | Client → Agent | Create conversation session |
| `session/prompt` | Client → Agent | Send user message |
| `session/update` | Agent → Client | Stream response chunks, tool calls, plans |
| `session/request_permission` | Agent → Client | Request tool execution permission (auto-granted) |
| `session/cancel` | Client → Agent | Cancel ongoing operation |
| `terminal/create` | Agent → Client | Execute shell command |
| `terminal/output` | Agent → Client | Get command output |
| `terminal/release` | Agent → Client | Release terminal |

### Available ACP Models

Models available through the Copilot CLI (requires a GitHub Copilot license):

| Provider | Model ID | Notes |
|---|---|---|
| **Anthropic** | `claude-sonnet-4.6` | Default model |
| | `claude-opus-4.6` | Most capable Claude |
| | `claude-opus-4.6-fast` | Faster Opus variant |
| | `claude-sonnet-4.5` | |
| | `claude-opus-4.5` | |
| | `claude-haiku-4.5` | Fastest Claude |
| | `claude-sonnet-4` | |
| **OpenAI** | `gpt-5.3-codex` | Latest codex |
| | `gpt-5.2-codex` | |
| | `gpt-5.2` | |
| | `gpt-5.1-codex-max` | Extended context |
| | `gpt-5.1-codex` | |
| | `gpt-5.1` | |
| | `gpt-5.1-codex-mini` | Lighter codex |
| | `gpt-5-mini` | |
| | `gpt-4.1` | |
| **Google** | `gemini-3-pro-preview` | Preview access |

> Model availability depends on your Copilot license tier and may change.
> The default model (when none is specified) is determined by the Copilot CLI.

### CLI Flags

```bash
python3 tools/acp_bridge.py [options]

Options:
  --port PORT              HTTP port (default: 8888)
  --copilot-path PATH      Path to copilot binary (default: copilot)
  --model MODEL            Default AI model (e.g. claude-sonnet-4.6, gpt-5.2)
  --cwd DIR                Working directory for ACP session
  --enable-kusto-mcp       Enable Kusto MCP server
  --kusto-cluster URL      Kusto cluster URL
  --kusto-database NAME    Default Kusto database
  --enable-azure-mcp       Enable Azure MCP server (requires az login)
  --enable-github-mcp      Enable GitHub MCP server (requires Docker + PAT)
  --mcp-config PATH        Custom MCP config JSON file
```

### HTTP Endpoints

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/v1/chat/completions` | POST | `{"messages":[...], "model":"copilot-acp", "acp_model":"claude-sonnet-4.6"}` | OpenAI-compatible completion JSON |
| `/v1/models` | GET | — | Available models list |
| `/v1/mcp` | GET | — | Active MCP servers and presets |
| `/v1/mcp/configure` | POST | `{"mcp_servers":{...}}` | Restarts copilot with new MCP config |
| `/health` | GET | — | Status, session ID, model, MCP servers |

### Security

- Binds to `127.0.0.1` by default (localhost only)
- `--allow-all-tools` bypasses ACP permission prompts (required for non-interactive MCP)
- Terminal commands execute with the bridge process's user permissions
- MCP env vars (tokens) are passed to the copilot subprocess environment

## Kusto MCP Server

Custom MCP server implementing the [Model Context Protocol](https://modelcontextprotocol.io/) for Azure Data Explorer.

### Tools

| Tool | Parameters | Description |
|---|---|---|
| `kusto_list_databases` | `cluster_url?` | List all databases in the cluster |
| `kusto_query` | `query`, `database?`, `cluster_url?` | Execute a KQL query |
| `kusto_show_tables` | `database?`, `cluster_url?` | Show all tables |
| `kusto_show_schema` | `table`, `database?`, `cluster_url?` | Show table schema |
| `kusto_sample_data` | `table`, `count?`, `database?`, `cluster_url?` | Sample rows from a table |

### Authentication

1. Checks `KUSTO_ACCESS_TOKEN` env (pre-fetched by bridge at startup)
2. Tries `DeviceCodeCredential` with persistent token cache
3. Prompts for device code auth on stderr if no cached token

Token cache: `~/.azure/msal_token_cache.json` (persists across restarts, ~90 day refresh token lifetime).

## Settings Panel

Five tabs in a modal overlay:

| Tab | Contents |
|---|---|
| **General** | Theme (Default/LCARS), TTS engine/voice, auto-speak toggle |
| **Models** | Model selector (grouped by provider), temperature slider, max tokens, reasoning effort, ACP model selector |
| **Auth** | API key inputs with show/hide toggles, ACP bridge URL. Keys stored in localStorage, override config.json |
| **Prompts** | Personality presets (Default/Concise/Advanced/Terminal/Custom), editable system prompt textarea |
| **MCP** | Azure MCP, GitHub MCP, Kusto MCP toggles with config fields. Apply/refresh buttons |

## Image Handling

```
User types "show me a cat"
  → _detectGenerationIntent() saves subject="cat", generate=false
  → Model responds with [Image of a cute domestic cat...]
  → renderEvaResponse() detects placeholder
  → Uses "cat" (user's words) as search query
  → _searchImage("cat") → Wikimedia Commons → cat photo
  → Inserted inline with lightbox

User types "generate an image of a dragon"
  → _detectGenerationIntent() saves subject="dragon", generate=true
  → Model responds with [Image of a dragon...]
  → renderEvaResponse() detects placeholder + generation flag
  → _generateImage("dragon") → DALL-E 3 → generated image
  → Inserted inline with "AI Generated" badge + lightbox
```

## LCARS Theme

Star Trek-inspired interface using the Lower Decks color palette:

- **Barlow Condensed** font (Google Fonts)
- Proper LCARS elbows (top/bottom curved connectors via CSS pseudo-elements)
- Flat colored sidebar chips with black gaps
- Accent-border chat bubbles (cyan=Eva, blue=User)
- Stacked button grid (Upload/Mic/Send)
- Dark background with subtle borders
- Monitor dock with 4 tabs (Tokens, Network, Session, System)

## Deployment

### Local (file://)
Just open `index.html`. Use `config.local.js` for API keys.

### Hosted (nginx/Apache)
Serve the directory over HTTP(S). Use `config.json` for API keys.

### With ACP Bridge (current — split setup)
- Web server: any machine (even i386)
- ACP Bridge: 64-bit machine with Copilot CLI
- Browser connects to both

### With ACP Bridge (future — single server)
```bash
sudo ./tools/acp_setup.sh
```
- Installs Copilot CLI, verifies auth
- Deploys systemd service (`acp-bridge`)
- Auto-starts on boot, restarts on failure
- Bridge auto-detected by browser on same host
