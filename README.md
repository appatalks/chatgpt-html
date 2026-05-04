# Eva AI Assistant

![screenshot](core/img/Eva-splash.png)

A no-build web UI for chatting with multiple AI providers, with persistent memory, emotion tracking, and multi-agent orchestration. Pure HTML, CSS, and JavaScript.

> Recommended: select **Eva (AIG)** in the model dropdown for the full experience.

## Get Started

### Easiest: Linux AppImage

Download or build the standalone AppImage and run it. The bridge starts automatically on a private localhost port.

```bash
cd standalone
npm install
npm run dist
./dist/'Eva Standalone-0.1.0.AppImage'
```

Prereqs on the host: Node.js 24+, Python 3.12+, GitHub Copilot CLI authenticated (`copilot auth login`). See [standalone/README.md](standalone/README.md).

### Browser only

```bash
cp config.example.json config.json   # add your API keys
xdg-open index.html                  # or open in any browser
```

For `file://` usage without a JSON loader, copy `config.local.example.js` to `config.local.js` instead.

### Full Eva experience (memory + cognition)

Run the ACP bridge alongside the UI to unlock persistent memory, knowledge graph, and emotion tracking through Azure Data Explorer.

```bash
python3 tools/acp_bridge.py --port 8888 \
  --enable-kusto-mcp \
  --kusto-cluster "https://<your-cluster>.region.kusto.windows.net" \
  --kusto-database Eva
```

Then select **Eva (AIG)** in the dropdown. Architecture and seed details are in [README-2.md](README-2.md).

## Documentation

- [README-2.md](README-2.md): architecture, MCP, ACP, dependencies, roadmap
- [standalone/README.md](standalone/README.md): AppImage build and runtime
- [.github/copilot-instructions.md](.github/copilot-instructions.md): contribution guide

