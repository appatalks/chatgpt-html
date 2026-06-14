# Eva AI Assistant

![screenshot](core/img/Eva-splash.png)

[Website](https://appatalks.github.io/eva-agent/) | [Documentation](README-2.md) | [Issues](https://github.com/appatalks/eva-agent/issues) | License: MIT

A voice-first AI assistant that sees through your camera, controls your browser and desktop, remembers everything, learns from experience, and runs tasks on a schedule. No build step. No framework. Open source.

## Quick install

```bash
curl -fsSL https://appatalks.github.io/eva-agent/get-eva.sh | bash
```

Or clone and run locally:

```bash
git clone https://github.com/appatalks/eva-agent.git
cd eva-agent
./install.sh            # install dependencies
cd standalone && npm install && npm run dist
./dist/'Eva Standalone-5.2.3.AppImage'
```

Prereqs: Node.js 24+, Python 3.12+, GitHub Copilot CLI (`copilot auth login`).

## Features

| | |
|---|---|
| **Camera vision** | Webcam presence sensing, face-detection auto-wake, on-demand "look" with gpt-4o |
| **Browser agent** | Playwright-based DOM control, persistent Chrome login, hybrid vision fallback |
| **Desktop agent** | PyAutoGUI mouse/keyboard control, optional AT-SPI via computer-use-linux MCP |
| **Voice interface** | Full-screen voice orb, wake/barge-in, TTS (OpenAI, Polly, Bark, browser) |
| **Persistent memory** | Kusto/ADX-backed conversations, emotion tracking, semantic recall |
| **Self-improving skills** | Auto-extracts reusable skills from successful tasks, stored as drafts |
| **Cron scheduler** | Standard cron expressions, recurring prompts, morning briefings, alerts |
| **Subagent parallelism** | Spawn up to 4 concurrent ACP tasks, results via notifications |
| **Multi-provider** | OpenAI, Google Gemini, GitHub Copilot, lm-studio (local) |
| **Doctor diagnostics** | Structured readiness probe for every subsystem with actionable fixes |
| **MCP ecosystem** | Azure, GitHub, Kusto, computer-use-linux desktop control |
| **Cognitive layer** | Eva + Reviewer dual-agent pipeline with configurable models |

## Get started

Select **Eva (AIG)** in the model dropdown for the full experience.

For persistent memory, point Settings > MCP at an Azure Data Explorer cluster. The bridge uses `azure-identity` device code login, no keys stored. For semantic recall, add an OpenAI key in Settings > Auth (falls back to keyword matching without one).

Import skills from text, URLs, GitHub repos, or files in Settings. Eva normalizes them into her format, stores in ADX, and applies matching skills automatically.

## Documentation

- [README-2.md](README-2.md): architecture, MCP, ACP, browser-only setup, roadmap
- [standalone/README.md](standalone/README.md): AppImage build and runtime
- [Website](https://appatalks.github.io/eva-agent/): features, comparison, install guide

