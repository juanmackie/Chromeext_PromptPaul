# Connect Prompt Paul to Hermes Agent

This guide explains how to connect Prompt Paul to a Hermes Agent gateway. It
also explains common connection errors.

## Before you start

Make sure that:

- The Hermes Agent gateway is running.
- You know the gateway API URL.
- You have a gateway API key if the gateway requires authentication.
- You know the Hermes profile name if you use a named profile.

Hermes can run high-risk tools on the host computer. Use a gateway only on a
network that you trust.

## Use the API gateway URL

Hermes can provide two different web services:

- The **API gateway** accepts requests from Prompt Paul.
- The **dashboard** provides a browser interface for Hermes.

Use the API gateway URL in Prompt Paul. Do not use the dashboard URL. The
dashboard serves a browser interface, not the API. A dashboard URL can return
an HTML page, or it can answer API routes with a JSON error such as
`Hermes capability discovery failed (HTTP 503): Auth provider 'nous' unreachable`. Prompt Paul needs JSON from API routes.

Enter the base gateway URL. Do not add `/health` or
`/v1/capabilities`. Prompt Paul adds these paths when it tests the gateway and checks the required run features advertised by `/v1/capabilities`.

For example:

```text
https://your-hermes-host.example
```

Use the URL and port published by your Hermes deployment. A local installation
may use a different URL from a hosted or container installation. The API
gateway and the dashboard run on separate ports. Find the API gateway port in
the Hermes server configuration (`API_SERVER_PORT`); do not assume it is the
same port as the dashboard.

## Configure Prompt Paul

1. Open Prompt Paul Options.
2. Create or select a connection profile.
3. Set **Connection type** to **Hermes Agent gateway**.
4. Enter the Hermes API gateway URL.
5. Enter the gateway API key if the gateway requires one.
6. Leave **Hermes profile** blank unless you created a named profile.
7. Confirm that you trust the remote Hermes network when you use a remote URL.
8. Select **Save Settings**.
9. Select **Test Hermes connection**.

The API key is optional only when the gateway does not require Bearer
authentication. A trusted network does not always remove the gateway's
authentication requirement.

## Allow Prompt Paul browser access

Hermes rejects browser requests by default when `API_SERVER_CORS_ORIGINS` is
empty. A command-line request may work while Prompt Paul receives an empty
`HTTP 403` response. This is a CORS origin policy failure, not proof that the
Prompt Paul API key is wrong.

Get the exact Prompt Paul origin from the Options page or side-panel DevTools
console. Run this only in an extension page, not in an ordinary website tab:

```js
chrome.runtime.getURL('').replace(/\/$/, '');
```

The result has this form:

```text
chrome-extension://YOUR_PROMPT_PAUL_EXTENSION_ID
```

Add that exact value to the Hermes `API_SERVER_CORS_ORIGINS` allowlist. Keep
existing entries and do not use `*`. Restart the Hermes API service after the
change, then reload Prompt Paul from `chrome://extensions`.

If the Hermes dashboard has terminal access, you can ask its agent to make the
change. Replace the placeholder with the origin returned by the command above:

```text
Configure Hermes Agent for Prompt Paul.

1. Inspect the current API_SERVER_CORS_ORIGINS configuration.
2. Add this exact origin, preserving existing entries:
   chrome-extension://YOUR_PROMPT_PAUL_EXTENSION_ID
3. Do not print, change, or expose API_SERVER_KEY or any other secret.
4. Do not use a wildcard origin.
5. Show me the proposed configuration change and ask for confirmation before editing files or restarting containers.
6. After confirmation, apply the change and restart only the Hermes API service.
7. Verify that a request from the Prompt Paul origin is accepted.
```

The agent should report that the origin was added, existing entries were
preserved, the API key was unchanged, the Hermes service is running, and the
origin's preflight request was accepted. A dashboard login does not replace
this API-server CORS setting.

## Test the gateway

Open this URL in a browser, replacing the placeholder with your gateway URL:

```text
https://your-hermes-host.example/health
```

The gateway should return JSON, such as:

```json
{ "status": "ok" }
```

The gateway root can return `404: Not Found`. This is normal. The root path is
not a web page. A response from `/health` proves that the API gateway is
reachable.

If the gateway requires authentication, use an API client that can send this
header to test protected routes:

```text
Authorization: Bearer YOUR_API_KEY
```

## Common errors

### `The selected Hermes profile was not found.`

The profile name does not exist on the Hermes gateway.

Clear the **Hermes profile** field. Save the connection. Test it again. Add a
profile name only when that name exists in Hermes.

### `Hermes endpoint is required.`

The endpoint is empty, or the new endpoint has not been saved.

Enter the base API gateway URL. Select **Save Settings** before you select
**Test Hermes connection**.

### `Unexpected token '<'` or an HTML response

Prompt Paul received an HTML page instead of JSON from the gateway.

Change the endpoint to the Hermes API gateway URL. Do not use the dashboard
URL.

### `Hermes capability discovery failed (HTTP 401)`

The gateway received no valid API key.

Check the gateway configuration. Copy the gateway API key into Prompt Paul.
Do not use the dashboard username or password as the gateway API key.

### `Hermes health check failed (HTTP 503)`

Hermes reported degraded provider or optional tool health. The main Hermes
model may still work.

If `/v1/capabilities` advertises the required run features, update Prompt Paul
and test the connection again. Prompt Paul can connect while an optional Hermes
feature is unavailable.

If capability discovery also fails, fix the provider or tool backend in Hermes
before testing Prompt Paul again.

### `Hermes capability discovery failed (HTTP 503): Auth provider 'nous' unreachable`

The gateway is reachable and accepted your API key, but it cannot reach one of
its upstream providers while it answers `/v1/capabilities`. This is a
server-side provider outage, not a Prompt Paul or endpoint problem. It is
typically transient.

Check that the endpoint is the **API gateway URL, not the dashboard URL**.
The API gateway and the dashboard run on separate ports. A deployment can
publish the dashboard on one port (for example `30433`) and the API gateway on
another (for example `30432`). The dashboard serves a browser interface with
its own auth providers, and a dashboard URL can answer this exact JSON `503`
with an auth-provider error instead of an HTML page. Use the API gateway port
in Prompt Paul.

Otherwise, check these items on the Hermes server:

- Confirm the gateway can reach the upstream provider network. A firewall,
  DNS, or proxy change can break it.
- Remove stale environment overrides such as `NOUS_BASE_URL`,
  `NOUS_INFERENCE_BASE_URL`, or `HERMES_PORTAL_BASE_URL` unless you set them
  deliberately.
- Run `hermes update`, then `hermes auth`, then restart the gateway.
- Query the gateway again from the server:

```bash
curl -sS -H "Authorization: Bearer $API_SERVER_KEY" \
  http://127.0.0.1:PORT/v1/capabilities
```

When `/v1/capabilities` returns `200` with the required run features, test the
Prompt Paul connection again.

### `unsupported_gateway`

The gateway responded to health and capability discovery, but its
`/v1/capabilities` payload does not advertise all required run features:
`run_submission`, `run_status`, `run_events_sse`, `run_stop`, and
`run_approval`. Released Hermes gateways (0.20.x) advertise the approval
feature as `run_approval_response`; Prompt Paul accepts either name, so this
error means the feature is missing under both names. Upgrade or configure
Hermes with the released runs API.

### `Hermes session creation failed (HTTP 403)`

If `/health` works and a server-side API test succeeds, but Prompt Paul gets
an empty 403 during session creation, check the browser origin allowlist:

1. Run the `chrome.runtime.getURL` command above in Prompt Paul DevTools.
2. Confirm the exact `chrome-extension://...` value is in
   `API_SERVER_CORS_ORIGINS`.
3. Confirm Hermes was restarted after the configuration change.
4. Reload Prompt Paul from `chrome://extensions` and retry.

Do not replace the API key based on this error alone. Hermes can return 401 for
an invalid key but 403 for a browser origin that is not allowed.

### `This site cannot be reached`

Check these items:

- The Hermes Agent gateway is running.
- The API gateway URL is correct.
- The API port is published for network access.
- Your device can reach the host.
- A firewall allows the API port.
- The URL uses the correct `http` or `https` scheme.

Test `/health` instead of the gateway root. A `404` at the root means that the
port is reachable. A connection error means that the service or network path
is not reachable.

### `Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation`

This error can occur with an older Prompt Paul build. Reload or update the
extension, then test the saved Hermes profile again.

### Follow-up questions lose page context

Prompt Paul sends the current Hermes input together with a bounded explicit
`conversation_history`. If a follow-up still cannot refer to loaded page data,
reload the extension and update the Hermes gateway. A stored `session_id` is a
correlation pointer, not a guarantee that `/v1/runs` will restore transcript
history. Prompt Paul keeps the visible local transcript authoritative across
provider and model switches. Historical image bytes are not replayed; reattach
an image when a follow-up needs the original pixels.

## Security notes

- Treat the gateway API key as a secret.
- Do not put the API key in the URL.
- Do not paste the API key into support chats, screenshots, or public files.
- Rotate the key if you expose it.
- HTTP does not encrypt traffic. Use HTTP only through a trusted private
  overlay or VPN. Use HTTPS for other networks.
- Keep the dashboard and API gateway private. Do not publish them to the
  public internet.
- Hermes tools can access files, run commands, and affect the host computer.
  Review every approval request.

## Further reading

- [Hermes API server documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md)
- [Prompt Paul Hermes integration](./HERMES_INTEGRATION.md)
