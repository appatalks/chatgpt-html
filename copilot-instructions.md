# Copilot Instructions

This project is a simple web UI for interacting with OpenAI, Google Generative models, and local LLMs (lm-studio). Use this guide to keep contributions consistent and safe.

## Goals
- Keep the UI minimal and fast. Avoid heavy frameworks.
- Support multiple providers via a single routing point.
- Store transient chat state in localStorage; do not add servers unless requested.
- Prefer small, targeted PRs; preserve existing behavior unless a change is requested.

## Key Files
- `index.html`: UI, settings, and script wiring.
- `core/js/options.js`: Model routing and UI behavior.
- `core/js/gpt-core.js`: OpenAI chat/completions logic.
- `core/js/gl-google.js`: Gemini logic.
- `core/js/lm-studio.js`: Local inference via lm-studio OpenAI-compatible API.
- `core/js/dalle3.js`: Image generation.
- `config.json`: Local API keys (not committed).

## Model Routing
- Add new models to the selector in `index.html`.
- Wire routing in `updateButton()` and `sendData()` in `core/js/options.js`.
- If a model uses the OpenAI Chat Completions API, route to `trboSend()`.
- If a model uses a different API, create a new send function in `core/js/*.js` and route accordingly.
 - `gpt-5-mini`: treated like other OpenAI chat models unless documentation calls for different parameters.
 - `latest` alias: allowed in the selector; treated as an OpenAI model value. If OpenAI updates how `latest` resolves (e.g., via Responses API), adjust `gpt-core.js` accordingly.

## OpenAI Models
- Endpoint: `POST https://api.openai.com/v1/chat/completions` (XMLHttpRequest is currently used).
- Required headers: `Authorization: Bearer ${OPENAI_API_KEY}`, `Content-Type: application/json`.
- Base payload: `{ model, messages, max_completion_tokens, temperature, frequency_penalty, presence_penalty, stop }`.
- Special cases:
  - `o1*` models: filter out `developer` role messages and set `temperature = 1`.
  - `o3-mini`: include `reasoning_effort` and omit `temperature` in the Google-search branch.

## Edge Cases
- Image input: `options.js` pushes a text+image structured message for vision-capable models.
- Auto-speak checkbox triggers Polly TTS after responses.
- Google search augmentation triggers an async fetch that appends messages and resends the payload.

## Testing Checklist
- Verify send flow with and without images.
- Test each model route from the selector.
- Confirm Errors 400/404/429/500 are surfaced in `txtOutput`.
- Validate localStorage message persistence and clear/reset.

## Developer Prompts
- "Add a new provider/model; wire it into the selector and routing with minimal changes."
- "Refactor to a fetch() wrapper but keep backward compatibility; don't change behavior."
- "Add unit-lite tests as plain functions or small harnesses if feasible; avoid build steps."

## Security/Privacy
- Never commit keys. `config.json` is local-only and must not be added to version control.
- Do not introduce external network calls except to configured providers.

## Versioning
- Update `README.md` Features list when adding models or user-visible features.
