# Eva AI Assistant

![screenshot](core/img/Eva-splash.png)

A no-build web UI for chatting with multiple AI providers, with persistent memory, emotion tracking, and multi-agent orchestration. Pure HTML, CSS, and JavaScript.

> Recommended: select **Eva (AIG)** in the model dropdown for the full experience.

## Get Started

Run the installer first. It detects and installs every dependency Eva needs on
your machine (Linux or macOS), self-updates the checkout, and can rebuild the
AppImage:

```bash
./install.sh            # check dependencies, install missing (asks first)
./install.sh --check    # report only, install nothing
./install.sh --yes      # install everything missing, no prompts
```

Then download or build the standalone Linux AppImage and run it. The bridge
starts automatically on a private localhost port.

```bash
cd standalone
npm install
npm run dist
./dist/'Eva Standalone-5.2.3.AppImage'
```

Prereqs on the host: Node.js 24+, Python 3.12+, GitHub Copilot CLI authenticated (`copilot auth login`). See [standalone/README.md](standalone/README.md).

> **Tip:** For the full Eva experience (persistent memory, emotion tracking, knowledge graph), point Settings > MCP at an Azure Data Explorer cluster you can sign in to. The bridge uses `azure-identity` device code or interactive login on first use, so no keys are stored. Browser-only setup and the manual ACP bridge launch are documented in [README-2.md](README-2.md).
>
> **Semantic recall:** When an OpenAI API key is set in Settings > Auth, Eva ranks stored facts by meaning (OpenAI `text-embedding-3-small`, cached on disk) so relevant memories surface even when worded differently. Without a key, recall falls back to synonym-expanded keyword matching.

> **Skills:** Import a skill from pasted text, a URL, a GitHub repo/SKILL.md, or a file in Settings > Models > Skills. Eva normalizes ("Eva'rises") it into her own format, stores it in ADX, and applies the matching skill automatically when a request fits.

## Documentation

- [README-2.md](README-2.md): architecture, MCP, ACP, browser-only setup, roadmap
- [standalone/README.md](standalone/README.md): AppImage build and runtime

