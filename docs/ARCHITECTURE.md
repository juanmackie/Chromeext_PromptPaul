# Architecture

Prompt Paul is a Manifest V3 Chrome extension with three main surfaces:

- `background.js` - service worker, context menus, storage orchestration, and message routing
- `chat.js` - side panel chat interface
- `options.js` - settings, instructions, tools, and skills management

## System Layers

### Browser Layer

- Content scripts extract page content and page metadata
- The background worker coordinates context menu actions and permissions
- The side panel displays chat, page actions, and loaded content

### Chat Layer

- `src/chat/ChatUI.js` renders messages and attachments
- `src/chat/ChatAPI.js` resolves profiles and starts runs
- `src/chat/ChatGrounding.js` web-search toggle state, Brave key status bridge, and Sources formatting
- `src/chat/ChatSkills.js` parses `/skills` and `/skill` commands
- `src/chat/ChatMedia.js` prepares image, video, and audio requests
- `src/chat/ChatStream.js` tracks streaming state and history
- `src/chat/ChatPageActions.js` renders page-aware quick actions and preset prompts

### Shared Utilities

- `src/utils/contextBudget.js` trims loaded page content to fit the model window
- `src/utils/readStrategy.js` picks the extraction mode from page signals
- `src/utils/permissionGuards.js` blocks unsupported browser pages
- `src/utils/actionCards.js` generates site-specific quick actions
- `src/utils/suggestionStorage.js` stores custom site suggestions
- `src/utils/skillParser.js` parses and validates `SKILL.md`
- `src/utils/toolChoiceBuilder.js` normalizes tool choice payloads
- `src/utils/validation.js` provides small shared validators
- `src/utils/braveSearch.js` bounded Brave LLM Context client with URL and payload validation

## Data Flow

### Page content

1. The user loads a page into the side panel
2. The content script extracts text and metadata
3. The background worker returns the extracted payload
4. `chat.js` trims the content to the current budget
5. The user asks follow-up questions against that page context

### Skill usage

1. The user types `/skills`, `/skill <name>`, or `/<skill-name>`
2. `ChatSkills.js` parses the command
3. The orchestrator resolves the matching skill
4. The skill instructions are injected into the run context

### Prompt composition

1. All prompt paths return structured `{instruction, context}` request objects
2. `composeUserPrompt` from `src/prompts.js` combines instruction and context into a single user message
3. Context boundaries (e.g. `--- Selected text ---`) mark where external content begins and ends
4. Media payloads are attached separately in `makeApiCallWithMedia`, not inlined in the text prompt

### Profile routing

1. `ChatAPI.js` reads the selected profile
2. Shared routing helpers validate the endpoint, key, and model
3. Media requests can reroute to a vision-capable profile when needed

### Web Search Grounding (optional)

1. The sidebar **Web** toggle sets a boolean `webSearchEnabled` in `chrome.storage.local`; the side panel asks the background worker only for configured/not-configured status and never reads `braveSearchApiKey`
2. `chat.js` reads the global preference at each `makeApiCall` / `makeApiCallWithMedia` entry and injects `webSearch: true` into `runConfig`
3. The background worker validates key availability and injects a background-owned search executor; only that executor reads `braveSearchApiKey` from storage at search time
4. `RunOrchestrator._buildTools()` offers the reserved `web_search` tool alongside the normal toolset (or alone for `none` / a satisfied forced user tool) with automatic model selection while a search is available; grounding is permission, not a mandate
5. `executeTool()` claims the single search slot before network I/O. Parallel or hallucinated duplicate calls receive `WEB_SEARCH_ALREADY_USED` and cannot issue another Brave request
6. After an attempt, the grounding prompt switches to an already-completed phase and the immediate LLM continuation is text-only so the model consumes the existing result and produces the final answer
7. Empty normalized results become the safe `WEB_SEARCH_NO_RESULTS` outcome. Nested tool outcomes are classified before rendering so failures are not shown as successful executions
8. `_finalizeTextResponse()` emits normalized `event.grounding.sources` when a search produced usable sources, and `chat.js` appends an escaped first-party `**Sources:**` section to rendered, copied, and persisted output
9. When grounding is off, no grounding field or Sources section is added; the normal LLM payload and UI behavior remain unchanged
10. Grounding requires an endpoint/model that supports function tools. Tool rejection is surfaced as an actionable error rather than retried indefinitely

## Build and Test

- `scripts/build.js` copies the extension into `dist/`
- `scripts/test-runner.js` checks module structure and key regression guards
- `scripts/smoke-check.js` performs the cheapest end-to-end sanity check

## Notes

- The extension stays inside Chrome storage and the browser runtime
- Remote APIs are only called when the user sends a prompt or action
- Restricted pages are blocked early with a user-friendly message
