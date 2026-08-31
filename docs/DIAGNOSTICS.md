# Development Diagnostics

Prompt Paul has a development-only diagnostics build for troubleshooting the
extension. It records structured lifecycle, runtime-message, provider,
content-script, and page-action events.

## Build the diagnostics variant

```bash
npm run build:dev
```

Load `dist-dev/` from `chrome://extensions/`. The normal production build is
still created with:

```bash
npm run build:prod
```

The production build replaces the diagnostics implementation with no-op
variants and does not contain the development tracer. Do not load `dist-dev/`
when testing a release build.

## Enable and disable tracing

Open the Prompt Paul service-worker DevTools console from
`chrome://extensions/`, then run:

```js
await promptPaulDevDiagnostics.enable();
```

Tracing is enabled for one hour by default and is disabled automatically after
its expiry. Disable it without deleting the collected records:

```js
await promptPaulDevDiagnostics.disable();
```

Clear all records and disable tracing:

```js
await promptPaulDevDiagnostics.clear();
```

Tracing is off by default, including in development builds.

## Collect a diagnostic trace

1. Open the service-worker console before reproducing the problem.
2. Enable tracing.
3. Reload the target page and reload the Prompt Paul development extension.
4. Reproduce one focused failure.
5. Inspect the live records:

   ```js
   const trace = await promptPaulDevDiagnostics.get();
   console.table(trace.entries);
   ```

6. Copy the trace when needed:

   ```js
   copy(JSON.stringify(trace, null, 2));
   ```

The session copy is also available under the
`promptPaulDevDiagnosticsV1` key:

```js
await chrome.storage.session.get('promptPaulDevDiagnosticsV1');
```

## Capture browser-test traces

The Playwright suite can enable tracing for every browser test and save one
service-worker trace per test:

```bash
PROMPT_PAUL_CAPTURE_DIAGNOSTICS=true npm run test:browser
```

Files are written to `artifacts/browser-diagnostics/`, or to the directory set
by `PROMPT_PAUL_DIAGNOSTICS_DIR`. This is test-only collection; the browser
suite still uses local fixtures and simulated provider boundaries.

## What is recorded

Records include bounded structured data for:

- Run start, provider turns, tool dispatch, and terminal status
- Runtime message names, sender type, tab ID, and request keys
- Page-action validation, policy, approval, budget, bridge, navigation, receipt,
  and recovery decisions
- Planner activation and receipt progress
- Content-script errors, rejected promises, main-world page JavaScript console
  messages, and action responses
- Timing, error codes, stack traces, snapshot IDs, counts, and bounded results

Detailed action responses are printed to the service-worker console. Large or
high-volume records are bounded so diagnostics cannot stop the extension.

## Data safety

Diagnostics are local to the browser session and are not sent to analytics or
an external service. Credential-shaped fields and values are redacted. API
keys, OAuth tokens, cookies, passwords, OTPs, payment data, and credential
control values must not be logged. Page snapshots remain bounded; raw DOM data
is not added to the normal run journal.

The diagnostic store is intended for local development only. Clear it after a
troubleshooting session and do not attach traces to public bug reports without
reviewing their contents.

## Useful DevTools views

- **Service worker:** orchestration, provider, background, and central trace
- **Target page:** content-script and main-world page console output and errors
- **Side panel:** chat UI errors and run-event handling
- **Network panel:** provider and gateway requests, status, and timing

Use one focused task per trace. Include the run ID, browser version, provider
kind, target URL origin, and the first failing event when reporting an issue.
