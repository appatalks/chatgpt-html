# ChatGPT HTML — Eva AI Assistant
![screenshot](core/img/Eva-splash.png)

v.5.1

A lightweight web UI for chatting with multiple AI providers. No frameworks, no build steps — just HTML, CSS, and JavaScript.

> **Best experience:** Select **Eva (AIG)** from the model dropdown — persistent memory,
> emotion tracking, proactive data retrieval, and intelligent cross-model orchestration.

## What is AIG?

**AIG (Artificial Intelligence Gateway)** is Eva's multi-agentic orchestration layer. Rather than calling a single model directly, AIG acts as an intelligent router and coordinator:

- **Model routing** — Selects the best provider for each request: GitHub Models API (GPT-4.1, GPT-5, o4-mini, DeepSeek-R1) via PAT, or Copilot CLI via ACP (Claude, Gemini, GPT-5.x) as fallback.
- **MCP tool use** — The underlying Copilot agent autonomously invokes [Model Context Protocol](https://modelcontextprotocol.io/) servers to retrieve live data before generating a response:
  - **Kusto MCP** — Query Azure Data Explorer for Eva's memory tables (conversations, reflections, emotion state, knowledge graph).
  - **GitHub MCP** — Search repos, issues, and PRs via the GitHub MCP server (Docker).
  - **Azure MCP** — Access Azure services and resources.
- **Cognition pipeline** — After each exchange, AIG automatically extracts knowledge entities, updates emotion vectors, logs conversations to Kusto, and triggers periodic self-reflections.
- **Memory injection** — Before every response, AIG fetches relevant context from Kusto (recent conversations, reflections, emotion baseline, knowledge) and injects it into the system prompt.
- **Hot-reloadable MCP** — Add or remove MCP servers at runtime via `POST /v1/mcp/configure` without restarting the bridge.

The bridge (`tools/acp_bridge.py`) exposes an OpenAI-compatible API so any client that speaks Chat Completions can use the full AIG stack.

## Quick Start

1. Copy `config.example.json` → `config.json` and add your API keys.
2. Open `index.html` in a browser.
3. *(Optional)* For the full Eva experience with persistent memory:
   ```bash
   # Seed the Kusto database (see tools/eva_seed.kql)
   python3 tools/acp_bridge.py --port 8888 \
     --enable-kusto-mcp --kusto-cluster "https://your-cluster.region.kusto.windows.net" \
     --kusto-database Eva
   ```
   Then select **Eva (AIG)** from the model dropdown.

> **Tip:** For local file:// usage, copy `config.local.example.js` → `config.local.js` instead.

## Supported Providers

| Provider | Models | Auth |
|---|---|---|
| **Eva (AIG)** ⭐ | Intelligent orchestration (GPT-4.1 + ACP fallback) | Copilot CLI + optional GitHub PAT |
| **OpenAI** | GPT-4o, o1, o3-mini, GPT-5-mini | OpenAI API Key |
| **GitHub Copilot** (PAT) | GPT-4o, GPT-4o Mini, o3-mini, GPT-4.1, GPT-5, o4-mini | GitHub PAT |
| **GitHub Copilot** (ACP) | Claude, GPT-5.x, Gemini 3 Pro | Copilot CLI |
| **Google Gemini** | Gemini 2.0 Flash Thinking | Gemini API Key |
| **lm-studio** | Any local model | None |
| **DALL-E 3** | Image generation | OpenAI API Key |

## Highlights

- **Eva (AIG)** — multi-agentic gateway with persistent memory, emotion tracking, and proactive data retrieval
- **MCP tool ecosystem** — Kusto (memory/analytics), GitHub (repos/issues), Azure (cloud resources) — hot-reloadable at runtime
- **Cognition layer** — automatic knowledge extraction, morning reflections, emotion vectors, conversation logging
- **Cross-model orchestration** — routes OpenAI models via GitHub Models API, Claude/Gemini via Copilot CLI ACP
- **Session explorer** — auto-save/restore conversations across page refresh
- **Voice activation** — wake-word "Eva" with continuous listening
- **Settings panel** with tabbed UI (General, Models, Auth, Prompts, MCP)
- **Inline images** — Wikimedia search or DALL-E generation
- **LCARS theme** — Star Trek-inspired interface
- **Text-to-speech** — Amazon Polly and Bark TTS
- **Conversation memory** in localStorage
- **Database seed** — `tools/eva_seed.kql` for quick public setup
- **CI pipeline** — secret scanning, syntax checks, model routing validation

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

