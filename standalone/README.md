# Eva Standalone

This directory contains the Electron scaffold for the Linux AppImage build. The Electron files stay under `standalone/`; electron-builder copies the parent web UI and bridge into `resources/app` with `extraResources`. In development, `main.js` loads the parent repo directly.

## Prerequisites

- Node.js >= 24
- Python >= 3.12
- GitHub Copilot CLI installed on the host
- Copilot CLI authenticated on the host with `copilot auth login`

## Run In Development

```sh
cd standalone
npm install
npm run start
```

## Build AppImage

```sh
cd standalone
npm run dist
```

The AppImage build is configured in `package.json` but this scaffold does not include generated output or a lockfile.

## Runtime Notes

- Electron starts `tools/acp_bridge.py` with `python3` on `127.0.0.1` using a free dynamic port.
- The renderer receives the bridge URL through `window.evaStandalone.acpBaseUrl`.
- Standalone exposes Eva (AIG) only. All routing, cognition, AIG backend selection, and Settings sub-controls remain available.
- The Kusto database field is intentionally blank on first run. Configure it in Settings > MCP.
- Bark is hidden in standalone mode. AWS Polly remains in the Auth tab, and browser SpeechSynthesis remains available.
