# Background capability contract

This directory owns background runtime-message handlers grouped by capability. Keep handlers independent of Chrome globals; inject platform APIs and authorization functions from `background.js`.

- Keep the service worker as the composer for capability handlers.
- Preserve extension-page authorization for privileged messages and sender-tab binding for content-script requests.
- Return `null` when a handler does not own an action so the worker can continue routing it.
- Keep each message group in its capability module and export it through `index.js`.
- New source areas are imported by application code through `src/background/index.js`.
