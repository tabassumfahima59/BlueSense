# Copilot connection verification

Verified on 17 November 2026. The local frontend sends `POST http://127.0.0.1:8001/api/copilot/stream`; the backend accepts `message`, `region`, `history` and `clientId`, with optional validated scenario/context fields. The shared frontend API base defaults to `http://localhost:8001` and must point to the backend origin without an extra `/api` suffix. Frontend deployments need that value at build time and a matching backend CORS origin.

## Observed incident and resolution

The browser reached the backend and received HTTP 200 with an SSE `llm_unavailable` error. Backend logs identified `httpx.ConnectError` while contacting Gemini. A direct, network-enabled API test succeeded, so this was an outbound-connectivity issue in the local backend process rather than a mismatched frontend URL or invalid request payload.

Restarting the local backend with outbound network access resolved the incident. The actual browser request “give the weather forecast” completed, invoked the weather-forecast tool and rendered a generated response from the configured `gemini-3.5-flash-lite`. The local `.env` was not edited.

## Provider status evidence

| Request | Result |
|---|---|
| Gemini model list using existing server credentials | HTTP 200 |
| Minimal generation with configured `gemini-3.5-flash-lite` | HTTP 200, finish reason STOP |
| Minimal generation with documented stable `gemini-3.8-flash` | HTTP 503 UNAVAILABLE: “This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.” |
| Browser → local backend → configured Gemini → tool-based answer | Completed successfully after restart |

Google's [model catalog](https://ai.google.dev/gemini-api/docs/models) and [3.8 Flash reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) list 3.8 Flash as stable. Availability is separate from model validity. The working explicit model override was preserved; the code does not silently switch models/providers after a failure.

Provider HTTP failures now include the numeric status, provider status and sanitized provider message in the SSE error detail and chat UI. Keys are redacted before messages are logged or returned. HTTP 429, 403, 404 and 503 remain distinct errors; transport failures have no provider HTTP status and are reported as connectivity errors. Tests exercise diagnostics and key redaction with mock transports, without calling Google.

## Local checks

Check `/api/health` and `/api/copilot/status` first. A `not_configured` status means the selected provider's server-side key is missing, not that the browser should supply it. Inspect the browser request URL and response type: successful streaming uses `text/event-stream`, and failures can arrive as application error events after the initial HTTP 200. Verify that the backend process can reach the configured provider host and that any local proxy/firewall permits outbound HTTPS. API keys remain server-side; never use a public frontend key variable.
