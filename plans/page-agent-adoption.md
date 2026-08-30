# Page-Agent Adoption Plan

**Status:** Completed. The original implementation plan is retained as a design record; current behavior and release gates are owned by `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, and the applicable `AGENTS.md` contracts.

## Context

Prompt Paul is an existing Manifest V3 Chrome extension with a side-panel chat, page/selection/media extraction, custom tools/skills, and optional Brave web grounding. The requested outcome is to study Alibaba's [`page-agent`](https://github.com/alibaba/page-agent) and identify the highest-value ideas or components we can adapt to make Prompt Paul more usable and helpful, without copying blindly or weakening extension safety/privacy.

Initial findings:

- Prompt Paul already has the main extension surfaces in `background.js`, `chat.js`, `options.js`, and supporting modules under `src/`.
- The current architecture already includes web grounding, tool-choice normalization, page-aware quick actions, context budgeting, permission guards, and run orchestration.
- Page-Agent is an MIT-licensed, DOM/text-oriented in-page GUI agent with a separable core, page controller, LLM adapter, UI panel, and optional Chrome extension for multi-tab/page control.
- Likely reusable ideas to evaluate are DOM/accessibility-aware page state extraction, natural-language page actions, explicit agent progress/history, user confirmation/question checkpoints, bounded tool permissions, data masking, custom knowledge injection, and cross-tab orchestration.
- The user wants both better page understanding and bounded natural-language actions on the current page. Risky actions should require confirmation by default, with an optional user-controlled trusted mode for broader automation. The approved plan should be implementation-ready rather than roadmap-only.

## Approach

1. Keep Prompt Paul's existing `RunOrchestrator` as the single LLM/tool loop. Do not embed Page-Agent's separate `PageAgentCore` loop or replace the current provider/streaming stack.
2. Adapt Page-Agent's strongest ideas as small browser-runtime modules: bounded interactive DOM dehydration, indexed semantic actions, structured activity/history events, and confirmation/permission gates.
3. Ship current-page understanding and semantic DOM actions first. Keep actions opt-in, default to confirmation for risky mutations, and add a user-controlled trusted mode that can auto-approve allowed low/medium-risk actions while hard-blocking destructive/security-sensitive actions.
4. Keep the first implementation single-tab and DOM-only. Do not add `tabs`/`tabGroups`, cross-tab automation, main-world APIs, arbitrary JavaScript execution, hover/drag/canvas automation, or cross-origin iframe control in this phase.
5. Reimplement the needed concepts in Prompt Paul's vanilla ES-module architecture instead of adding Page-Agent's TypeScript workspace as a runtime dependency. If any substantial upstream code is copied, preserve the MIT copyright/license notice and acknowledge the browser-use-derived lineage; prefer clean-room adaptation of the documented behavior.

## Files to modify

Expected implementation targets after plan approval:

- `content_script_unified.js`: add a bounded, on-demand interactive DOM snapshot/index and semantic click/input/select/scroll handlers; keep existing Readability/video/PDF extraction unchanged. Keep this in the classic all-pages content-script runtime rather than adding a second competing extractor.
- `background.js`: route run-scoped page-control requests to the originating tab, validate tab/page support, and resolve confirmation responses without exposing arbitrary browser control.
- `src/orchestrator/RunOrchestrator.js`: register/authorize page capabilities, track a page-action session, enforce step/action limits and policy, emit structured activity/confirmation events, and abort pending actions safely.
- `src/utils/pageDom.js` (new): pure flat-tree dehydration/indexing/formatting helpers (consumed by the content-script adapter or kept structurally mirrored there), attribute/text caps, semantic element classification, and safe target metadata that can be unit-tested independently.
- `src/utils/pageActionPolicy.js` (new): action schemas, risk classification, hard blocks, trusted-mode policy, and bounded text/target validation.
- `src/chat/ChatUI.js` and `src/chat/ChatComposer.js`: render page-action activity and approval cards using existing sanitized UI/run-state primitives.
- `chat.js`, `chat.html`, `chat.css`: pass the current source tab/run mode, add an explicit Page Actions opt-in/control, and handle approve/deny responses without growing the entry point beyond its existing guard.
- `options.html`, `options.js`, `src/options/OptionsUI.js`: add the trusted-mode preference and clear warning/disable controls; keep default-off behavior and credential masking.
- `manifest.json`: likely no new permission for single-tab DOM control; verify current `scripting`, host, and content-script coverage before changing it.
- `tests/pageDom.test.js`, `tests/pageActionPolicy.test.js`, and `tests/runOrchestrator.test.js`: pure DOM/policy coverage plus orchestration/confirmation/abort behavior.
- `scripts/test-runner.js`, `docs/ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`, and applicable `AGENTS.md` files: structural guards, setup/privacy/safety documentation, and DOX contracts.

## Reuse

Prompt Paul already supplies most of the surrounding product plumbing:

- `RunOrchestrator._buildTools()`, `executeTool()`, `_finalizeToolCall()`, abort handling, tool idempotency, provider continuations, and `orchestratorEvent` delivery.
- `ChatComposer` context/quick-action wiring, `ChatUI` sanitized rendering, `ChatGrounding` source-safe event helpers, `ChatStream` run state, and existing Bootstrap/UI primitives for inline recovery/confirmation.
- `content_script_unified.js`'s `getUnifiedContent()`, platform signals, `readStrategy`, and `getCurrentPageSupport()`/`executeTabContentExtraction()` for restricted-page checks and source-tab routing.
- `contextBudget.fitTextToTokenBudget()` for snapshot limits, `validation.normalizeToolDefinition()`/reserved names, `permissionGuards`, storage/preferences, and existing tests/build guards.

Page-Agent ideas worth adapting:

- `PageController.getBrowserState()` and `flatTreeToString()`: index interactive nodes and retain useful `role`, `name`, `placeholder`, `aria-*`, `value`, `checked`, `contenteditable`, and semantic landmark information while capping text/attributes.
- `PageController`'s async, isolated action methods: model actions by stable per-snapshot indices, refresh state after each mutation, and never let the model submit CSS/JS selectors directly.
- `PageAgentCore`'s `statuschange`/`activity`/`historychange` split: map this to existing run events instead of exposing hidden chain-of-thought.
- Page-Agent's `ask_user`, allowlist/blocklist, data transformation, visual mask, abort-signal, and max-step concepts: adapt them to explicit Prompt Paul confirmation cards, a DOM-only policy, snapshot masking, and existing abort lifecycle.

Explicitly defer or skip: Page-Agent's full `PageAgentCore`/macro-tool loop, `execute_javascript`, `TabsController`/tab groups, main-world token bridge, `/llms.txt` fetching, visual/canvas automation, and direct vendoring of its TypeScript packages.

Upstream references used for this mapping:

- [`PageController.ts`](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/PageController.ts) and [`dom/index.ts`](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/dom/index.ts): browser state, dehydration, indexed controls, and semantic attributes.
- [`PageAgentCore.ts`](https://github.com/alibaba/page-agent/blob/main/packages/core/src/PageAgentCore.ts) and [`tools/index.ts`](https://github.com/alibaba/page-agent/blob/main/packages/core/src/tools/index.ts): loop, abort signal, activity/history events, ask-user, tool permissions, and the explicit JavaScript risk.
- [`extension_api.md`](https://github.com/alibaba/page-agent/blob/main/packages/extension/docs/extension_api.md) and the extension controllers: token-gated main-world bridge and multi-tab architecture intentionally deferred here.
- [Page-Agent security/permissions docs](https://alibaba.github.io/page-agent/docs/advanced/security-permissions/) and [MIT license](https://github.com/alibaba/page-agent/blob/main/LICENSE): allowlist/blocklist, masking, confirmation guidance, and reuse obligations.

## Capability fit

| Page-Agent capability                              | Prompt Paul decision            | Why                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM dehydration with indexed interactive elements  | **Adapt now**                   | Improve answers about forms/apps and give page actions a bounded target model without screenshots. The current extraction remains the default for article/media context; the interactive snapshot is on-demand and capped.                    |
| Click/input/select/scroll tools                    | **Adapt now, current tab only** | Directly supports the user's natural-language action goal; route through existing orchestrator/tools. Use `page_get_state`, `page_click`, `page_input`, `page_select`, and `page_scroll`, each with a run-scoped `snapshotId`/index contract. |
| Ask-user/HITL pause                                | **Adapt now**                   | Required for risky mutations; use approval cards and existing run/abort events.                                                                                                                                                               |
| Allowlist/blocklist and data masking               | **Adapt now**                   | Essential safety/privacy boundary; mask password-like fields and exclude destructive/security targets.                                                                                                                                        |
| Visual mask/highlight                              | **Adapt now, lightweight**      | Show the controlled tab is active and prevent accidental manual interference while an action is executing; no screenshot dependency.                                                                                                          |
| Activity/history separation                        | **Adapt now**                   | Existing UI has traces but needs structured page-action status and approval history.                                                                                                                                                          |
| Custom/page-specific instructions                  | **Adapt partially**             | Reuse skills/custom site suggestions and add bounded per-site hints only if they remain local; do not fetch remote `llms.txt` initially.                                                                                                      |
| Arbitrary JavaScript execution                     | **Skip**                        | Page-Agent itself flags exfiltration/bypass risk; incompatible with Prompt Paul's safety promise.                                                                                                                                             |
| Multi-tab/tab-group control                        | **Defer**                       | Requires new `tabs`/`tabGroups` permissions and much broader consent/session lifecycle.                                                                                                                                                       |
| Main-world external API/token bridge               | **Skip for now**                | Prompt Paul has no need to let web pages invoke browser automation; it expands the attack surface.                                                                                                                                            |
| Canvas/hover/drag/rich cross-origin iframe support | **Defer/declare limits**        | DOM-only coverage is safer and matches Page-Agent's known limitations.                                                                                                                                                                        |

## Implementation contracts

### User controls and storage

- Add a side-panel **Act** toggle (`pageActionsEnabled`, default `false`) next to the existing Page/Web capabilities. Store it in session storage and consume it for one run; ordinary page loading and answers remain unchanged when off.
- Add an Options **Trusted page actions** switch (`pageActionsTrustedMode`, default `false`) with explicit copy: it may skip confirmations for allowed low/medium-risk actions, but it never enables JavaScript, cross-tab control, destructive actions, credential-field interaction, or security/account changes.
- Keep only the persistent trusted-mode key in local backup/restore data. The transient Act permission must not be exported or restored. Removing/disabling trusted mode must affect the next run; active runs retain their already-authorized policy snapshot.

### Snapshot and action protocol

- `page_get_state` returns `{ snapshotId, url, title, header, content, footer, elements }`, with a hard cap on total serialized size, element count, text/attribute lengths, and included attributes. Snapshot content is labeled untrusted page data in the system prompt; page text never becomes executable instructions.
- Each interactive element has a numeric index plus safe display metadata (`tag`, role/name/label, placeholder, type, checked/disabled, short text, risk hints). Do not return password/current-password/one-time-code values, hidden fields, cookies, local storage, or arbitrary HTML/JS.
- `page_click`, `page_input`, `page_select`, and `page_scroll` accept only bounded, schema-validated arguments. Element actions require the current `snapshotId`; stale or unknown indices fail closed and tell the model to call `page_get_state` again. Refresh the index after every successful mutation.
- Use DOM events and standard controls only. Never expose a selector, coordinate, arbitrary script, navigation/tab operation, or a generic “execute code” escape hatch.
- Enforce per-run limits for total page actions, snapshot size, input text, and action duration. Stop/abort clears the run's content-script index and any visual overlay.

### Safety and confirmation

- Classify actions/targets as read-only, low-risk, medium-risk, high-risk, or prohibited. Read-only state/scroll may run; clicks/inputs/selections on ordinary controls require confirmation by default when they can change state; submit/send/delete/purchase/account/security/payment/password/OTP controls are hard-blocked or always-confirmed and cannot be bypassed by trusted mode.
- Before a confirmable action, emit `page_action_confirmation` with a short action summary, target label, origin/title, risk, and `confirmationId`; the run waits with an abort/timeout path. Chat renders an accessible approval card with Approve, Deny, and Stop/disable actions. `background.js` accepts only the matching run/confirmation decision and rejects stale/duplicate decisions.
- Trusted mode may auto-approve only policy-allowed low/medium-risk actions. The user can still stop the run, and any hard block remains enforced. Confirmation text must not include raw secrets or full field values.
- Add a lightweight per-target highlight/interaction mask while the action is executing, with `data-page-agent-ignore`/`data-browser-use-ignore`-style markers so extraction does not treat the overlay as page content. Do not block the whole tab longer than the action timeout.

### Events and UI

- Reuse `orchestratorEvent` for `page_action_state`, `page_action_confirmation`, `tool_start`, `tool_complete`, `tool_error`, `complete`, and `aborted`; add structured fields rather than logging raw DOM or prompt data.
- Map Page-Agent's activity/history split to transient status indicators versus durable, sanitized action cards in `ChatUI`. Do not display or persist hidden chain-of-thought; show only “Reading page”, “Clicking …”, “Waiting for approval”, result, and failure.
- Add `pageActionsEnabled` to both normal and media run configuration only when a supported current source tab exists; media-only analysis should not advertise page tools unless a regular page context is explicitly active.

## Steps

- [x] Confirm the desired product scope and safety/permission posture with the user: improve page understanding and current-page actions; confirmation by default with an optional trusted mode; implementation-ready plan.
- [x] Inspect Page-Agent's README, package layout, controller/DOM extraction, agent loop, UI, extension bridge, license, and security/limitations documentation.
- [x] Inspect Prompt Paul's existing page extraction, action-card, tool, orchestration, chat, and permission flows in enough detail to avoid duplicating functionality.
- [x] Build the capability-by-capability fit matrix and choose a single-tab DOM-first scope.
- [x] Define and unit-test the snapshot/action data contracts, caps, masking, stale-snapshot behavior, and risk policy.
- [x] Add the on-demand content-script snapshot/index and semantic action handlers, including target highlight/mask cleanup.
- [x] Thread the opt-in toggle and trusted-mode policy through both chat run entry points; register/authorize page tools in the orchestrator.
- [x] Implement confirmation request/decision/timeout/abort routing and sanitized activity/history UI.
- [x] Add Options controls, backup/restore keys, docs, changelog, privacy/limitations copy, DOX updates, and structural guards.
- [x] Run automated and real-browser verification, including restricted pages, ordinary forms, SPAs, stale DOM changes, prompt injection text, password fields, submits, stop/abort, manual intervention, receipts, scope/diff measurement, and worker/UI restart cases. The credential-free corpus and browser suite are automated; interactive unpacked-extension spot checks and human security review remain release follow-ups.

## Verification

Automated:

- Add pure tests for DOM dehydration: semantic labels/ARIA attributes, bounded output, index stability within a snapshot, masked password/OTP/credential fields, hidden/disabled controls, prompt-injection text treated as data, and unsafe target rejection.
- Add policy tests for read-only/low/medium/high/prohibited risk classes, default confirmation, trusted-mode limits, hard blocks, input/text caps, reserved tool-name collisions, stale snapshot IDs, and unsupported action arguments.
- Extend `tests/runOrchestrator.test.js` for page-tools opt-in/off behavior, source-tab authorization, tool sequencing, confirmation pause/approve/deny/timeout, duplicate/stale decisions, abort cleanup, action limits, and both OpenAI-compatible and Anthropic continuation paths.
- Extend `scripts/test-runner.js` guards for new modules, storage keys, manifest/build references, reserved page tool names, and the `chat.js`/`src/chat` size/import contracts.
- Run `npm run test:behavior`, `npm run validate`, and `npm run build:prod`; do not use a live LLM or page in unit tests.

Manual in unpacked Chrome/Edge:

- Toggle Act off and confirm ordinary chat, Page loading, selected-text actions, media actions, skills, and Web grounding are unchanged.
- Toggle Act on against a static form and SPA: ask the model to inspect controls, click a harmless control, fill a non-sensitive field, select an option, and scroll; verify the highlighted target and refreshed snapshot.
- Verify risky actions show an accessible approval card, Deny prevents the DOM event, Approve performs exactly once, Trusted mode skips only allowed confirmations, and hard-blocked controls never execute.
- Verify stale DOM changes require a fresh snapshot, password/OTP/payment fields are masked or blocked, page text that says “ignore previous instructions” is never treated as policy, and no raw DOM/secrets appear in logs, analytics, history, or copied output.
- Verify restricted pages, PDF/native viewers, canvas-heavy pages, rich editors, cross-origin iframes, navigation attempts, action timeouts, Stop, service-worker suspension/restart, and side-panel restart fail closed with actionable messages.

Resolved defaults for this phase:

- Risky means state-changing controls; submit/send/delete/purchase/payment/account/security/password/OTP/navigation-away actions are always confirmed or hard-blocked, and trusted mode never bypasses those safeguards.
- The first release supports semantic HTML controls and bounded contenteditable input only; hover, drag/drop, canvas/WebGL, rich editors requiring site-specific APIs, nested/cross-origin iframes, and multi-tab work are explicitly deferred.
- Page snapshots are sent to the user's already-configured LLM endpoint only when Act is enabled and the user sends a run; support follows the existing OpenAI-compatible/Anthropic function-tool paths, with an explicit privacy disclosure and no new provider dependency.
