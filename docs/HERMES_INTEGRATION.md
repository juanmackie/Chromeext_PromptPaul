# Hermes Agent integration

Prompt Paul can use a local Hermes Agent gateway as its backend. Hermes keeps its own provider, model, skill, memory, and tool configuration. Prompt Paul provides the Chrome side panel, page context, media input, and run display.

## Setup

1. Install Hermes Agent and start its API gateway.
2. Open Prompt Paul Options.
3. Create or select a profile.
4. Set **Connection type** to **Hermes Agent gateway**.
5. Enter the gateway URL. Use `http://127.0.0.1:8642` for a local gateway.
6. Enter the Hermes API key if the gateway requires Bearer authentication. It may be left blank for
   a trusted gateway such as one reached only through your Tailscale network. Leave the Hermes
   profile field empty unless the gateway uses a named profile.
7. Save the profile, then select **Test Hermes connection**. The test uses the saved profile so
   the endpoint and background-owned key stay in sync with the gateway check.

Prompt Paul checks Hermes capability discovery and requires the advertised `run_submission`, `run_status`, `run_events_sse`, `run_stop`, and `run_approval` features. Released Hermes gateways (0.20.x) advertise the approval feature as `run_approval_response` in `/v1/capabilities`; Prompt Paul accepts either name. A `503` from `/health` can report degraded provider or optional tool health while the gateway still supports these run features. In that case, Prompt Paul connects and shows the provider warning. It reports an unsupported gateway when required run features are missing; session route failures are reported when a session is created or ended. Prompt Paul never silently falls back to another protocol.

## Security

Hermes API access can run high-risk tools on the computer. Keep the gateway on loopback unless a
private overlay or HTTPS network is required. HTTP is unencrypted and should only be used through
a trusted overlay such as Tailscale. Do not put an API key in the URL.

The Hermes key is stored by the background service worker. It is not sent through chat messages, run events, analytics, or backups. Prompt Paul does not execute Hermes terminal or filesystem tool payloads.

This needs security review before production, especially for remote gateways, shared computers, and persistent Hermes approvals.

## Sessions and approvals

Prompt Paul keeps one local conversation identity for the visible side-panel transcript. A Hermes session pointer is stored per profile with that local conversation identity, so switching providers or models between turns keeps the visible transcript and prevents an unrelated old Hermes session from being reused. The `session_id` is a gateway correlation and lifecycle pointer; Prompt Paul also sends a bounded explicit transcript because `/v1/runs` does not reliably restore persisted history from `session_id`. A separate stable `X-Hermes-Session-Key` scopes longer-term gateway memory and is generated and retained by the background worker. Neither value is included in chat messages, analytics, or backups.

In Hermes mode, the idle **New chat** button starts a new conversation. Prompt Paul first verifies that no Hermes run is active, then marks the current session ended with `PATCH /api/sessions/{id}` and `end_reason: "new_conversation"`. It clears the local chat and session pointer only after that request succeeds. The next Hermes prompt creates a new session. The stable `X-Hermes-Session-Key` remains unchanged, so longer-term gateway memory remains available. API and Codex profiles keep their existing local **Clear** behavior.

If the gateway loses the stored session (for example, after its session database is reset), the first run receives HTTP 404 with the documented `session_not_found` code, removes the stale pointer, creates one replacement session, and retries that run once. Unrelated 404 responses, such as a missing route, are not treated as stale sessions. The extension does not create duplicate runs during this recovery. A New chat request also treats only the documented `session_not_found` 404 code as an already-ended session; other errors leave the local pointer in place so the user can retry safely.

Runs use Hermes `/v1/runs` with the stored `session_id`, a bounded `conversation_history`, and the trailing unsent user input, then consume `/v1/runs/{id}/events`. The history budget reserves output and instruction space, retains attached page context while it is active, and removes historical image data URLs. If the event stream drops or closes without a terminal event, Prompt Paul polls `/v1/runs/{id}` at one-second intervals for up to five minutes and uses the terminal status. A healthy `run.completed` event supplies its output directly, so a status request is not added to the normal latency path. Stop and approval requests target the remote run ID, not the session ID.

For each run, Prompt Paul sends the trailing unsent local user messages as the Hermes current-turn input and sends older bounded user/assistant messages as `conversation_history`. This keeps follow-up questions grounded in loaded page content even when the gateway session database does not replay `/v1/runs` history. Prompt Paul never replays historical binary media; users must reattach an image when a later question requires its pixels.

Hermes approval requests appear as cards in the side panel. Prompt Paul binds each decision to the opaque approval ID from the pending request and rejects stale or duplicate decisions. **Allow once** is the default. Session-wide and always approvals require an explicit user action. Stop sends a Hermes stop request, marks the local run `stopping`, and keeps the profile occupied until Hermes reports a terminal state. Cards settle visibly when the gateway accepts a decision or when the run ends.

## Current limitation

Hermes server tools work through the released API. Prompt Paul custom HTTP tools remain gateway-owned and are not registered for Hermes runs. Hermes Act uses an explicit client-tool contract: the gateway must advertise `features.run_client_tools: true` and `endpoints.run_tool_result` as `POST /v1/runs/{run_id}/tool-result`. Prompt Paul sends bounded Act definitions in `client_tools`, receives `client_tool.request` SSE events, executes only the allowlisted page tools, and posts the result with the opaque `tool_call_id`. All existing policy, approval, tab-ownership, budget, and receipt checks still apply. The extension rejects Hermes Act runs when the gateway does not advertise this contract; it does not simulate browser actions through prompt text.

Prompt Paul forwards the core instructions, saved profile instructions, and only
the explicitly requested instruction-based Prompt Paul skill to Hermes. Hermes
continues to own its server tools and skill catalog; Prompt Paul custom tool
dispatch is not available for Hermes.

## Troubleshooting

- **Gateway unavailable:** start Hermes and confirm the endpoint and key.
- **Health check returns HTTP 503:** Hermes may have a degraded optional provider or tool backend while the API gateway remains usable. Confirm that `/v1/capabilities` advertises the required run features. Prompt Paul can connect in this state, but the affected Hermes feature may remain unavailable.
- **Endpoint required after typing a URL:** click **Save Settings** before testing. A new or
  changed endpoint is not sent directly from the Options form to the background gateway check.
- **Unsupported gateway:** upgrade Hermes to a version whose `/v1/capabilities` advertises `run_submission`, `run_status`, `run_events_sse`, `run_stop`, and the approval feature (advertised as `run_approval` or, on released 0.20.x gateways, `run_approval_response`). Session route errors are separate because session creation is not performed by the connection test.
- **Hermes Act unavailable:** the gateway must also advertise `features.run_client_tools: true` and `endpoints.run_tool_result` with `method: "POST"` and `path: "/v1/runs/{run_id}/tool-result"`. Hermes Agent v0.18.2 does not advertise or implement this contract. Upgrade or patch the gateway first; until then, use an API/Codex profile for browser Act or attach the email content to the chat.
- **Dashboard port used by mistake:** the API gateway and the dashboard run on separate ports. Enter the API gateway port, not the dashboard port, or the connection test can report `Hermes capability discovery failed (HTTP 503): Auth provider 'nous' unreachable` when the dashboard answers API routes. See `HERMES_TROUBLESHOOTING.md`.
- **Approval not visible after restart:** reopen the side panel. Prompt Paul never auto-approves a request.
- **Images rejected:** confirm that the Hermes gateway advertises multimodal input support.
