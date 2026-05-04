# Technical Documentation

Detailed architecture, dependencies, and implementation notes for Eva AI Assistant.

> **Recommended experience:** Select **Eva (AIG)** from the model dropdown for the full
> Eva experience — persistent memory, emotion tracking, proactive data retrieval, and
> intelligent cross-model orchestration. All other models work standalone, but AIG is the
> way Eva was designed to be used.

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
     .com     github.ai  generative   │ ACP Bridge │
                          .google    │ (Python)   │
                          apis.com   │ port 8888  │
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
                           - GitHub Models endpoint: models.github.ai/inference
                           - Model name mapping (publisher/model format)
                           - Auto-detects bridge URL (same-host, localhost, configured)
                           - MCP configuration (applyMCPConfig, refreshMCPStatus)
    aig.js                 Eva AIG orchestration (aigSend)
                           - Routes through bridge /v1/aig/chat
                           - External data augmentation (weather, news, stocks, solar)
                           - localStorage-based message history (aigMessages)
                           - Optional client-side cognitive layer (see core/js/cognition.js)
                           - Phrase triggers ("trigger the chain", "use cognition", ...)
                             force the layer for a single turn even when the toggle is off
                           - Authoritative ground-truth note injected into the single-shot
                             system prompt so the model does not fabricate pipeline runs
    cognition.js           Browser-side multi-agent cognitive layer (Cognition.run)
                           - Three role-specific agents: conductor, implementer, reviewer
                           - Each agent calls /v1/aig/chat independently with its own
                             model and editable system prompt
                           - Bounded review loop (cogMaxCycles, default 1, range 0-3)
                           - Verdict-first reviewer protocol (APPROVE | REQUEST_CHANGES)
                           - Capability registry: Cognition.registerCapability({id,
                             description, run})
                           - Action protocol: implementer can emit
                             [[EVA_ACTION]]{"id":"...","args":{...}}[[/EVA_ACTION]]
                             blocks; the browser executes them and replaces each block
                             with the rendered HTML
                           - Built-in capability: file.download (delivers a downloadable
                             text artifact via a Blob URL, namespaced under a virtual
                             tmp/<session_id>/<filename> path)
    dalle3.js              DALL-E 3 image generation (dalle3Send)
                           - Standalone mode (model selector = dall-e-3)
    idb-store.js           IndexedDB storage backend (idbSaveSession, idbLoadSession)
                           - Replaces localStorage for session snapshots
                           - Binary blob store for images/audio per session
                           - Auto-migration from localStorage on first load
                           - Requests navigator.storage.persist() to prevent eviction
    sessions.js            Session persistence (initSessions, saveCurrentSession)
                           - Auto-save/restore across page refresh
                           - Session index in localStorage, snapshots in IndexedDB
    voice.js               Voice activation (startVoiceListener)
                           - Wake-word "Eva" via Web Speech API
                           - Continuous listening with status indicators
    external.js            External data fetching at page load
                           - date.data, weather.data, news.data, market.data, solar.data

tools/
  acp_bridge.py            ACP ↔ HTTP bridge server
                           - ACPClient: manages copilot subprocess, JSON-RPC protocol
                           - BridgeHandler: HTTP endpoints for browser
                           - AIG orchestrator with cognition layer
                           - Memory injection + post-response reflection
                           - SelfState capability tracking on startup
                           - Kusto inline ingest (direct, bypasses MCP for speed)
                           - Terminal capability for MCP tool execution
                           - Token caching across model switches
                           - MCP server configuration and hot-reload
  kusto_mcp.py             Custom MCP server for Azure Data Explorer
                           - 9 tools: list_databases, query, show_tables, show_schema,
                             sample_data, ingest_inline, eva_recall_knowledge,
                             eva_get_emotion_state, eva_get_recent_reflections
                           - DeviceCodeCredential with persistent token cache
                           - Accepts pre-fetched token via KUSTO_ACCESS_TOKEN env
  eva_seed.kql             Sanitized database seed (public-safe)
                           - Creates all 8 Eva tables with sample data
                           - Run in Kusto Web Explorer to bootstrap a new instance
  test_static.py           CI-safe static tests (no bridge needed)
                           - File integrity, secret scanning, CSV logic, config safety
  test_eva.py              Integration tests (requires live bridge)
                           - 64 checks across 13 sections
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
| Python 3.12+ | ACP Bridge, Kusto MCP | System package or `pyenv` |
| Node.js 24+ | Copilot CLI | `nvm install 24` or system package |
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

Models available through the Copilot CLI (requires a GitHub Copilot license). The
catalog evolves; this list reflects the live `copilot --list-models` output at the
time of writing. The browser model selector is grouped to mirror provider boundaries.

| Provider | Model ID | Notes |
|---|---|---|
| **Anthropic** | `claude-opus-4.7` | Most capable Claude. Variants: `-high`, `-xhigh` (reasoning effort) |
| | `claude-opus-4.6` | Variant: `-1m` (1M context) |
| | `claude-opus-4.5` | |
| | `claude-sonnet-4.6` | Default sonnet tier |
| | `claude-sonnet-4.5` | |
| | `claude-sonnet-4` | |
| | `claude-haiku-4.5` | Fastest Claude |
| **OpenAI** | `gpt-5.5` | |
| | `gpt-5.4` | |
| | `gpt-5.4-mini` | |
| | `gpt-5.3-codex` | |
| | `gpt-5.2-codex` | |
| | `gpt-5.2` | |
| | `gpt-5-mini` | |
| | `gpt-4.1` | Default AIG backend |

> Model availability depends on your Copilot license tier and may change.
> The default model (when none is specified) is determined by the Copilot CLI
> via `copilot config set model`.

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
| `/v1/aig/chat` | POST | `{"messages":[...], "user_message":"..."}` | OpenAI-compatible JSON with memory + orchestration |
| `/v1/memory/context` | GET | `?message=...` | `{"context":"...", "cognition_enabled":true}` |
| `/v1/memory/reflect` | POST | `{"user_message":"...", "assistant_message":"...", "model":"..."}` | `{"status":"ok"}` |
| `/v1/models` | GET | — | Available models list |
| `/v1/mcp` | GET | — | Active MCP servers and presets (secrets redacted) |
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
| `kusto_ingest_inline` | `table`, `data[]`, `database?`, `cluster_url?` | Write rows into a table |
| `eva_recall_knowledge` | `entity`, `limit?` | Recall facts about an entity |
| `eva_get_emotion_state` | — | Get Eva's current emotion + baseline |
| `eva_get_recent_reflections` | `limit?` | Get Eva's self-reflections |

### Authentication

1. Checks `KUSTO_ACCESS_TOKEN` env (pre-fetched by bridge at startup)
2. Tries `DeviceCodeCredential` with persistent token cache
3. Prompts for device code auth on stderr if no cached token

Token cache: `~/.azure/msal_token_cache.json` (persists across restarts, ~90 day refresh token lifetime).

## Settings Panel

Five tabs in a modal overlay:

| Tab | Contents |
|---|---|
| **General** | Theme (Default/LCARS/Eva), TTS engine/voice, auto-speak toggle |
| **Models** | Model selector (grouped by provider), temperature, max tokens, reasoning effort, AIG backend selector, ACP model selector, and the **Cognitive Layer** controls (toggle, three role-specific model selectors, max review cycles, editable per-agent system prompts, debug trace) |
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

### ACP Infrastructure Roadmap (tracking)

Current state (2026-04-05):
- Static web tier can run on legacy 32-bit hosts.
- ACP Bridge currently runs on a separate compatible machine.
- Single-host deployment is blocked until new hardware is available.

| Milestone | Status | Notes |
|---|---|---|
| Provision new bridge-capable server (`x86_64` or `arm64`) | planned | Recommended baseline: 2+ vCPU, 4+ GB RAM |
| Install runtime baseline (`node >= 24`, `python >= 3.12`) | planned | Copilot CLI currently requires Node.js 24+ |
| Authenticate Copilot CLI service account | planned | `copilot auth login` on target host |
| Deploy bridge as systemd service | planned | Use `tools/acp_setup.sh` and `tools/acp_bridge.service` |
| Move from split setup to single-host ACP | planned | Keep localhost fallback until this is complete |
| Post-migration validation gate | planned | `/health` ok + AIG raw-query smoke + `tools/test_eva.py` |
| macOS standalone build (signed + notarized) | planned | Build config exists (`npm run dist:mac` produces unsigned dmg/zip for x64+arm64). Distribution requires Apple Developer ID, hardened runtime, entitlements (likely `com.apple.security.cs.disable-library-validation` for spawning system `python3`), and `@electron/notarize` afterSign hook. Local-dev builds work today; signed distribution deferred. |
| Windows standalone build | planned | Add `win` target (nsis or portable) to electron-builder config; same Python/Node/Copilot CLI prereqs apply. |

## Eva (AIG) — Recommended Model

The **Eva (AIG)** model is the recommended way to use Eva. Selecting it in the model
dropdown activates the full stack: intelligent orchestration, persistent memory,
emotion tracking, and proactive data retrieval. An optional browser-side cognitive
layer (conductor / implementer / reviewer) can be enabled on top; see
[Cognition Layer](#cognition-layer).

### How AIG Works

```
Browser → POST /v1/aig/chat → ACP Bridge
  ├── Step 1: Build memory context (Kusto queries)
  │   ├── Skills manifest (always)
  │   ├── Core knowledge (Confidence ≥ 0.6)
  │   ├── Emotion state
  │   ├── Day lifecycle / morning reflection
  │   ├── Message-relevant recall
  │   └── Proactive data (databases, tables, conversations, emotions)
  │
  ├── Step 2: Detect data needs (KQL keywords → ACP tool call)
  │   └── MCP tools: kusto_query, kusto_ingest, web_search, etc.
  │
  ├── Step 3: Build Eva persona prompt (system + memory + retrieved data)
  │
  ├── Step 4: Generate response
  │   ├── Primary: GitHub Models API (PAT) → gpt-4.1
  │   └── Fallback: ACP (Copilot CLI) → whatever model is configured
  │
  └── Step 5: Background reflection (async thread)
      ├── Log to Conversations table
      ├── Extract entities → Knowledge table
      ├── Update HeuristicsIndex
      └── Compute emotion vector → EmotionState table
```

### AIG vs Copilot ACP

| Feature | Copilot ACP | Eva (AIG) |
|---------|------------|-----------|
| Chat | ✓ | ✓ |
| MCP Tools | ✓ | ✓ |
| Persistent memory injection | — | ✓ |
| Emotion tracking | — | ✓ |
| Entity extraction | — | ✓ |
| Morning reflection | — | ✓ |
| Proactive data retrieval | — | ✓ |
| Persona consistency | Basic | Full Eva system prompt |

## Cognition Layer

Eva has two complementary cognitive systems. The **bridge cognition layer** runs
server-side inside `acp_bridge.py` and adds persistent intelligence (memory injection,
emotion tracking, post-response reflection) to every AIG interaction. The **browser
cognitive layer** runs entirely in the page and adds an optional multi-agent
plan/draft/review loop on top of any AIG turn.

### Browser Cognitive Layer (`core/js/cognition.js`)

Opt-in via Settings > Models > **Enable Cognitive Layer**. When active, every Eva
(AIG) turn is routed through three role-specific agents before the user sees a
response:

```
User turn
  -> Conductor (planning, capability selection)
     -> Implementer (drafts the user-facing answer, may emit action blocks)
        -> Reviewer (verdict: APPROVE | REQUEST_CHANGES)
           -> Implementer (revises against feedback) ... up to cogMaxCycles
  -> executeActions(): runs any [[EVA_ACTION]] blocks the implementer emitted
  -> renderEvaResponse(): renders the final approved draft
```

Each agent calls the existing bridge endpoint `/v1/aig/chat` independently with its
own model and editable system prompt, so users can mix providers (for example,
Claude for planning, GPT for drafting, a smaller model for review). Per-stage progress
is surfaced in the footer status line and a small `Cognition: on` pill.

**Activation:**

| Trigger | Behavior |
|---|---|
| Settings toggle on | Layer runs for every AIG turn |
| Phrase in user message | Layer is force-enabled for that single turn even when the toggle is off |
| Neither | Single-shot AIG path; an authoritative system note tells the model the layer is OFF for this turn so it cannot fabricate phase narration |

Recognized trigger phrases include `trigger the chain`, `use cognition`,
`use the cognitive layer`, `run the conductor`, `run the reviewer`,
`run the implementer`, `engage cognition`, and `cognition: on`.

**Capability registry and action protocol:**

The implementer can invoke registered capabilities by emitting an action block on
its own line:

```
[[EVA_ACTION]]
{"id":"file.download","args":{"filename":"report.md","content":"# ...","mime":"text/markdown"}}
[[/EVA_ACTION]]
```

`Cognition.executeActions(text)` parses each block, runs the matching capability,
and replaces the block with the capability's rendered HTML. New capabilities are
registered with the same shape:

```js
Cognition.registerCapability({
  id: 'web.search',
  description: 'Search the public web. args: {query, max_results}.',
  run: async function (args) { /* call your search backend */ }
});
```

Built-in: `file.download` (text artifact -> Blob URL -> inline `<a download>` link,
namespaced under a virtual `tmp/<session_id>/<filename>` path; the repo `.gitignore`
excludes `tmp/`).

**Status tag format:**

```
Eva (AIG, cognition) - <implementer-model>  [cog:<c>+<i>+<r>/c<N>[/forced][/act<K>]]
```

`/forced` indicates a phrase-triggered run; `/act<K>` indicates K capability
invocations executed during the turn.

### Bridge Cognition Layer (`tools/acp_bridge.py`)

The cognition layer that runs inside the bridge and adds persistent intelligence to
every AIG interaction.

### Memory Context (`_build_memory_context`)

Injected into every AIG request as a structured system prompt section:

| Section | When | Source |
|---------|------|--------|
| `[Skills]` | Always | Hardcoded capability catalog |
| `[Workflow: Data Requests]` | Always | Instructions for tool use |
| `[Workflow: Memory]` | Always | Instructions for recall |
| `[Morning Reflection]` | First msg of day | `MemorySummaries` (latest 3) |
| `[Memory — Core Facts]` | Always | `Knowledge` where Confidence ≥ 0.6 (top 10) |
| `[Emotion State]` | Always | Latest `EmotionState` row |
| `[Memory — Relevant]` | On keyword match | `Knowledge` matching user words |
| `[Live Data]` | On intent detection | Various tables, queried on-demand |

### Post-Response Reflection (`_post_response_reflection`)

Runs in a background thread after each AIG response:

1. **Conversation logging** — both user and assistant messages → `Conversations`
2. **Entity extraction** — regex for proper nouns → `Knowledge` (Confidence: 0.5)
3. **Heuristics update** — entity frequency tracking → `HeuristicsIndex`
4. **Emotion computation** — sentiment word counting → `EmotionState`

### SelfState

On bridge startup, Eva writes 8 capability rows to `SelfState`:

- `kusto_access`, `acp_bridge`, `cognition`, `data_retrieval`
- `weather_news`, `image_skills`, `persistent_memory`, `mcp_*` (per MCP server)

### Kusto Inline Ingest Format

The bridge uses `.ingest inline into table <T> <|` with strict CSV:
- Delimiter: `,` (no space after comma)
- Strings with commas or quotes: wrapped in `"..."` with `""` escaping
- JSON/dynamic: `json.dumps()` → CSV-quoted
- Booleans: `true`/`false`
- Newlines: escaped as `\n`

## Session Explorer

`core/js/sessions.js` + `core/js/idb-store.js` provide persistent session management:

- **Storage backend** — IndexedDB (`eva_sessions_db`) with two object stores:
  - `sessions` — full DOM snapshots keyed by session ID
  - `blobs` — binary attachments (images, audio) indexed by `sessionId`
- **Auto-save** — after every response via `saveCurrentSession()` → `idbSaveSession()`
- **Auto-restore** — on page load (`initSessions()` → `idbLoadSession()`)
- **Session index** — lightweight list in `localStorage` key `eva_sessions` (id, title, timestamp)
- **Migration** — `idbMigrateFromLocalStorage()` runs once on first load, moves existing `session_<id>` entries from localStorage to IndexedDB, then cleans up
- **Persistent storage** — requests `navigator.storage.persist()` so the browser won't evict session data under storage pressure
- **Blob helpers** — `idbSaveBlob()`, `idbGetBlob()`, `dataUrlToBlob()`, `blobToDataUrl()` for handling inline images and audio
- **UI** — expandable panel in footer, chip in LCARS sidebar, session list in Eva sidebar

## Voice Activation

`core/js/voice.js` implements continuous wake-word listening:

- **Wake word**: "Eva" (detected via Web Speech API)
- **States**: Listening (green) → Awake (amber pulse) → Sending (blue) → Idle
- **Flow**: Continuous recognition → wake word detected → capture next phrase → auto-send
- **Fallback**: Click mic button for manual speech-to-text

## Workspace Agent Profiles

`.github/agents/` ships three VS Code Copilot workspace agents tuned for this
project's conventions. These are editor-time review tooling, not runtime components
of Eva, and they do not run automatically when the browser cognitive layer is
active.

| File | Role | When to use |
|---|---|---|
| `reviewer.agent.md` | Code reviewer | Reviewing browser UI, model routing, ACP bridge, Kusto cognition, secrets, tests, docs |
| `implementer.agent.md` | Code implementer | Writing, refactoring, or fixing changes (often in response to reviewer feedback) |
| `conductor.agent.md` | Orchestrator | Running an automated review → implement → re-review loop with bounded cycles |

The optional `.github/agents/local/` folder is gitignored and reserved for
maintainer-only notes (dev topology, recurring commands, internal hosts, agent
playbooks). Nothing under `local/` is published.

## Database Seed

For public cloning, a sanitized seed file is provided:

```bash
# 1. Create an Azure Data Explorer free cluster
# 2. Create a database named "Eva"
# 3. Run the seed file:
#    Copy contents of tools/eva_seed.kql into the Kusto Web Explorer and execute
```

The seed creates all 8 tables with sample data:

| Table | Seed Rows | Purpose |
|-------|-----------|---------|
| `SelfState` | 8 | Capability registry |
| `Knowledge` | 4 | Starter facts |
| `Conversations` | 2 | Example exchange |
| `EmotionState` | 1 | Initial emotion baseline |
| `EmotionBaseline` | 6 | Resting-state dimensions |
| `MemorySummaries` | 1 | First day summary |
| `Reflections` | 1 | Initial self-reflection |
| `HeuristicsIndex` | 1 | Pattern tracking starter |

See [tools/eva_seed.kql](tools/eva_seed.kql) for the full file.

## CI / Testing

### GitHub Actions (`eva-ci.yml`)

Runs on every PR to `main` or `notAIG`:

| Job | Checks |
|-----|--------|
| **static-checks** | Secret scanning, HTML structure, JS syntax, Python syntax, model routing, config templates, .gitignore |
| **python-tests** | `tools/test_static.py` — file integrity, config safety, CSV quoting logic, model selector, seed validation |

### Test Files

| File | When to Run | Needs Bridge? |
|------|-------------|---------------|
| `tools/test_static.py` | CI + local | No |
| `tools/test_eva.py` | Local only | Yes (live bridge on port 8888) |

```bash
# CI-safe tests (no bridge needed)
python3 tools/test_static.py

# Full integration tests (requires running bridge)
python3 tools/test_eva.py --verbose
```
