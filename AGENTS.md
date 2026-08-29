# DOX Framework

- DOX is the AGENTS.md hierarchy installed for Prompt Paul.
- Agents must follow this file and every applicable child AGENTS.md before editing.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it.

## Read Before Editing

1. Read the root AGENTS.md.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every AGENTS.md found along each route.
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there.
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index.
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index.
- Each parent explains what its direct children cover and what stays owned by the parent.
- The closer a doc is to the work, the more specific and practical it must be.

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards.
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty.
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists.

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist.

## Closeout

1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents or children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text.
5. Run existing verification when relevant.
6. Report any docs intentionally left unchanged and why.

## Purpose

Prompt Paul is a Manifest V3 Chrome extension for sending selected text, media, and page content to an LLM from context menus and a side panel chat. It also implements an OpenClaw-compatible Agent Skills system for reusable AI instructions.

## Ownership

- Root owns project-wide contracts, `manifest.json`, package metadata, root extension entry points, shared browser UI files, README and changelog files, and the top-level DOX index.
- Root owns top-level extension surfaces: `background.js`, `chat.js`, `options.js`, content scripts, HTML/CSS entry files, theme/loading helpers, shared UI primitives (`ui-primitives.css`), and design prototypes.
- Child docs own durable subtrees listed in the Child DOX Index.
- Generated build output such as `dist/` is not source of truth and should not be edited directly.

## Local Contracts

- The extension is Manifest V3 and uses `background.js` as an ES module service worker.
- API keys, profiles, custom instructions, tools, skills, and user settings live in Chrome storage. Codex subscription credentials and Hermes gateway credentials are background-owned and keyed by profile; they are never included in profile records, run configs, events, logs, or backups.
- The storage schema is stable: canonical keys (`profiles`, `lastSelectedProfileId`, `instructions`, `customSkills`, `promptPaulTools`, `analyticsConsent`, `analyticsInstance`, `analyticsRotateAt`, `voiceInputEnabled`, `voiceInputPermissionState`, `voiceInputPermissionLastChecked`, `braveSearchApiKey`, `webSearchEnabled`, `pageActionsEnabled`, `pageActionsTrustedMode`, `pageActionsMultiTabEnabled`, `pinnedQuickActions`, `customSiteSuggestions`, `hermesApiKeys`, `hermesSessions`, `hermesSessionKeys`) are pinned by regression guards. `pageActionsEnabled` is session-scoped, one-run state and is excluded from local/sync backups; all provider and search credentials, Hermes keys, and session pointers are excluded from backups; backups export only supported persistent settings and restore profiles without credentials.
- Remote LLM calls happen only when the user sends a prompt or invokes an action.
- Browser-internal pages, extension pages, and Chrome Web Store pages must be blocked or reported before content extraction.
- Broad host permissions are intentional for page extraction and context-menu workflows.
- Built-in and custom skills are instructions by default, not executable tools, unless deterministic tool dispatch is explicitly implemented.
- `chat.js` run entry points (`makeApiCall`, `makeApiCallWithMedia`) require `beginResponseRun()` before any side effects; `endResponseRun()` must run in `finally` blocks. This prevents two orchestrator runs from starting simultaneously and orphaning events.
- The `executeRun` bridge acknowledges acceptance immediately instead of holding a runtime message channel open for the full run. Terminal status is delivered through ordered `orchestratorEvent` messages and the session journal; chat retains the opaque owner token until terminal cleanup or an acknowledged abort.
- Privileged background messages require an extension-page sender. Content-script requests are bound to the sender tab, and run mutations use an opaque owner token issued at run start; provider credentials and configuration are resolved from the saved profile in the background.
- Act runs opened from a directly opened side panel may omit `sourceTabId`; the background worker resolves the active usable web tab before starting the run, returns that source identity to the chat bridge for later approvals and manual responses, and fails with an actionable message when the active tab is blank or browser-internal instead of falling back to a background page.
- Run/feedback states use the standardized `data-run-state` vocabulary (`idle`, `running`, `streaming`, `stopping`, `complete`, `error`, `stopped`) driven by `src/utils/runState.js` and styled by shared primitives in `ui-primitives.css`; both extension surfaces must stay on this contract rather than introducing per-page state flags.
- Shared UI primitives (buttons, chips, badges, trays, sections, run indicators) live in `ui-primitives.css`, which depends on `theme.css` tokens and must be loaded after it in every extension page.
- The chat surface is composer-led: `chat.js` routes all send/action flows through the composer (`#input-area`) and `ChatComposer.js` owns the context tray, contextual quick-action row, and inline Stop/Retry/Edit/Continue recovery. `chat.js`'s line guard covers composer wiring; new composer UI logic must go into `src/chat/ChatComposer.js`, not the entry point.
- The Options page is setup-led with explicit section saves: each section persists on its own action, credentials stay masked (keys are never written into input fields; `applyCredentialMask`/`resolveCredentialValue` in `src/options/OptionsUI.js` handle it), and the unsaved-changes guard covers the combined dirty state of all sections. Connection profiles are first-class: the selected profile appears before provider controls, saved profiles retain their provider, and creating a new connection chooses its provider before credentials are entered. Fresh source checkouts seed the Default profile with OpenRouter's OpenAI-compatible endpoint and `openrouter/free` model but no credential. Existing profiles are preserved.
- Profiles may use `provider: 'api'`, `provider: 'codex'`, or `provider: 'hermes'`. Hermes profiles store a gateway endpoint and optional Hermes profile slug; their optional API keys live in the background-owned `hermesApiKeys` map, while remote HTTP(S) access requires explicit trust confirmation. Hermes runs use gateway sessions, explicit bounded `conversation_history`, server-side tools, and approval events. The local conversation identity remains authoritative across provider/model switches; Hermes session pointers include that identity so an unrelated remote session is never reused. Connection checks require the advertised Hermes run submission, status, SSE, stop, and approval features. Stale-run recovery clears a session pointer only for the documented `session_not_found` response. Hermes profile runs, reset operations, and session-key operations are serialized per profile. Hermes Stop keeps the local run active in `stopping` until the gateway reports a terminal state. In Hermes mode, the idle chat action is labeled **New chat**; it ends the selected gateway session, clears the local session pointer, preserves the stable memory key, and starts a new local conversation identity. API and Codex profiles keep local **Clear** behavior. Act/page actions remain disabled for Hermes until a documented client-tool result protocol exists. Codex profiles keep only model, reasoning-level, and prompt settings; a successful Codex device-code login creates or selects the profile named `Codex`. Options starts login, polls completion, and requests model metadata through the background worker. Codex discovery includes the extension client version required by the subscription models route; if discovery is unavailable, Options keeps a saved model and exposes manual model-ID entry. Restored Codex profiles require sign-in again.
- All entry points funnel into the canonical chat: context menus and deep links go through the side panel via `sendPanelMessage`/`openChatWithContext` in `background.js`, preserving selection, media, attachment, and page context. The toolbar action and website deep links (`externally_connectable` for promptpaul.juanmackie.com) open the chat with `{ action: 'openChat' }`; `chat.js` consumes deep-link `textPrompt` instructions against the attached context. The Options page calls `chrome.sidePanel.open()` directly from its button gesture for the current browser window, so it does not open a full-page `chat.html` fallback.
- Context-bearing prompts must use structured prompt request objects and `composeUserPrompt`; do not concatenate selected text, page content, media context, or previous-response instructions directly into raw prompt strings.
- PDF page extraction must detect both filename-based URLs and extensionless PDF endpoints from response metadata, unwrap the built-in Chrome PDF viewer source URL when present, and parse bytes through the chat page's bundled pdf.js path because Chrome's native PDF viewer has no readable DOM.
- Site-aware extraction adapters fill the existing `adapterMatched` slot in `content_script_unified.js`: structured Reddit-thread and RSS/Atom feed candidates score against the two-pass extractors with fail-open fallthrough, and GitHub pages gain a bounded metadata header above the winning body. Formatter logic is owned by `src/utils/siteExtractors.js` and mirrored in the classic content script; keep both sides aligned.
- Dropped `.txt`/`.md`/`.markdown`/`.csv`/`.json` documents attach as bounded text through `ChatMedia.prepareDroppedFile()` and the `document` prompt context type from `src/prompts.js`; they never enter the base64/vision media pipeline. All other dropped files keep the existing media flow.
- `chat.js` resolves `sourceTabId` for side-panel runs via `getRunSourceTabId()`, not a captured `panelTabId`.
- Pending panel actions (`setMediaForAnalysis`, `setSelectedText`) are consumed locally in `chat.js` and not re-sent via `chrome.runtime.sendMessage`.
- Panel context delivery treats a missing response or explicit `{ ignored: true }` response as a failed handoff; the session-queued action remains available until the panel for the target tab consumes it.
- Keep privacy-sensitive analytics opt-in and safe-label handling intact.
- Page actions are default-off, DOM/semantic-control-only tools. The session-scoped `pageActionsEnabled` Act permission is consumed by one run and must reset between jobs and browser sessions; current-tab runs remain the default. If run setup fails before the background accepts a run, the chat restores the consumed permission so a failed attempt does not silently disable Act. Every Act-enabled run forces an initial `page_get_state` inspection before the agent can respond; later mutations still go through policy and approval gates. Snapshot text is untrusted page data; password, OTP, payment, credential, account, security, destructive, download, unsafe-scheme, and unsupported controls must remain masked, confirmation-gated, or blocked. Valid HTTP(S) links may navigate under the bounded Act lease; links that open a new tab use the indexed `page_open_link` tool. Safe navigation across origins does not create a per-site permission prompt, while writes and risky controls remain confirmation-gated. Act owns up to eight run-created tabs; background tabs do not retarget the run, and each opened/switched tab passes a bounded document/bridge readiness check before inspection. If a bridge fails, that tab is quarantined and the run continues on another healthy owned tab or reports partial progress; after a user reload, a fresh `page_get_state` can re-probe the failed source tab. If the active target tab changes documents during a live run, Act automatically adopts the current supported page, discards stale snapshot state, and forces `page_get_state` before continuing. The model may request one bounded clarification through `page_request_user_input`, but the request is rejected if it asks for secrets or payment data. `page_pause_for_user` supports only safe manual steps, requires explicit Resume, clears the page-action session, and forces a fresh inspection; it cannot bypass policy or collect secrets. Observation, navigation, and mutation budgets are tracked separately (64/24/16), with bounded `page_record_note` task memory for long runs that rejects secret, credential, and payment wording. State-changing actions return bounded `not_delivered`, `delivered_unverified`, or `delivered_verified` receipts, and unchanged unverified mutations are not retried. The credential-free page-action corpus and browser-safe harness record only bounded evaluation metrics. Trusted mode never enables JavaScript. Progressive scope/diff measurements remain test-only and never accept model-supplied selectors.
- Successful instruction saves reset the Add/Edit Instruction form immediately; manual clearing may still require confirmation when fields contain unsaved content.

## Work Guidance

- Use 2-space indentation and single quotes in JavaScript.
- Add `@fileoverview` and `@module` JSDoc to new source modules.
- Prefer explicit exports from modules under `src/`.
- Keep shared logic in `src/chat/`, `src/utils/`, or `src/orchestrator/` instead of adding more large blocks to root entry points.
- Keep Codex authentication in `src/utils/codexAuth.js`, model discovery in `src/utils/modelDiscovery.js`, and Responses wire conversion in `src/orchestrator/CodexTransport.js`; do not pass OAuth access or refresh tokens through chat or UI messages. API model discovery uses the configured compatible `/models` route, while Codex discovery uses the authenticated Codex backend `/models` route.
- Keep `docs/`, README, tests, and DOX files current when behavior, workflows, or structure changes.
- Do not edit vendored libraries or binary assets unless the task is specifically about those files.
- Preserve existing user changes in the working tree.

## Verification

- `npm run test` checks module structure, manifest references, skill files, and regression guards.
- `npm run smoke` checks manifest file references and vendored dependency conflicts.
- `npm run build` copies the extension into `dist/` for unpacked or packaged testing.
- `npm run validate` runs lint, formatting checks, tests, and smoke checks.
- For UI or browser-runtime changes, also reload the unpacked extension in Chrome or Edge and exercise the affected flow.

## Agent Skills Specification

This section is the canonical specification reference for Prompt Paul skill format, metadata, and runtime behavior. For end-user examples and workflows, see `docs/SKILL_EXAMPLES.md`.

### Using Skills In Chat

1. List all skills: `/skills`
2. Invoke canonical command: `/skill <name> [input]`
3. Invoke per-skill shortcut when user-invocable: `/<skill-name> [input]`
4. Invoke by natural language trigger: `use <skill> skill and [your request]`

### Supported Skill Intent Patterns

| Pattern                  | Example                                  | Status    |
| ------------------------ | ---------------------------------------- | --------- |
| `use /<skill>`           | `use /humanizer and rewrite`             | supported |
| `use <skill> skill`      | `use humanizer skill and rewrite`        | supported |
| `apply /<skill>`         | `apply /summarizer to this`              | supported |
| `with /<skill>`          | `with /humanizer, rewrite this`          | supported |
| `invoke /<skill>`        | `invoke /weather-guide explain forecast` | supported |
| `use <skill> and/to/for` | `use humanizer and rewrite`              | supported |
| `please use <skill> to`  | `please use humanizer to rewrite`        | supported |

### Skill Format

Skills follow the Agent Skills specification with YAML frontmatter.

```markdown
---
name: 'skill-name'
description: 'Brief description of what this skill does'
license: 'MIT'
user-invocable: true
disable-model-invocation: false
metadata: { 'tags': 'category', 'version': '1.0.0' }
---

# Skill Name

## Purpose

Explain when and why to use this skill.

## Guidelines

1. Step-by-step instructions
2. Best practices
3. Expected outputs

## Examples

**Input:** Example input
**Output:** Expected output
```

### Frontmatter Fields

| Field                      | Type    | Default  | Description                                        |
| -------------------------- | ------- | -------- | -------------------------------------------------- |
| `name`                     | string  | required | Unique identifier, lowercase with optional hyphens |
| `description`              | string  | required | Brief description for AI and user discovery        |
| `license`                  | string  | optional | License identifier, for example MIT or Apache-2.0  |
| `user-invocable`           | boolean | true     | Creates `/<name>` shortcut command when true       |
| `disable-model-invocation` | boolean | false    | Hides from model auto-suggestions when true        |
| `command-dispatch`         | enum    | null     | Set to `tool` for deterministic execution          |
| `command-tool`             | string  | null     | Tool name when command-dispatch is `tool`          |
| `command-arg-mode`         | string  | `raw`    | Argument passing mode for tool dispatch            |
| `homepage`                 | string  | null     | URL for skill documentation                        |
| `metadata`                 | object  | `{}`     | OpenClaw-compatible nested metadata                |

### Metadata Object

The `metadata` field supports OpenClaw-style nested configuration:

```yaml
metadata:
  {
    'tags': 'coding, python',
    'version': '1.0.0',
    'openclaw':
      {
        'requires': { 'bins': ['python'], 'env': ['PYTHON_PATH'] },
        'install': [{ 'kind': 'brew', 'formula': 'python' }],
      },
  }
```

### Built-In Skills

Built-in skills are configured in `skills/skills.json`.

- `humanizer`: transforms AI-generated text to sound more natural and human.
- `weather-guide`: explains weather reports and meteorological terminology.

Each built-in skill source lives in `skills/<name>/SKILL.md`.

### Importing Skills

- From skills.sh: paste the skill URL into Prompt Paul Options -> Import from skills.sh.
- From file: export skills from another Prompt Paul instance, then import the JSON file from Options -> Import Skills.
- Manual import: create a `SKILL.md` file and place it in the skills directory, or create it via the Options page.

### Troubleshooting Skills

- If a skill does not appear in `/skills`, check `disable-model-invocation`, frontmatter validity, and extension reload state.
- If a slash command does not work, check `user-invocable`, lowercase hyphenated names, and save/load state.
- If metadata is not preserved, check YAML formatting and JSON syntax inside `metadata`.

### OpenClaw Compatibility

- `SKILL.md` format uses standard Agent Skills frontmatter.
- Metadata supports `metadata.openclaw.*`.
- Skills can specify required binaries or environment variables.
- Metadata can include installation instructions.

### Skill Resolution Flow

1. User enters `/skill <name> ...` or matching intent.
2. `chat.js` parses command or intent and resolves skill name.
3. Request is sent to `background.js`.
4. `SkillManager` resolves skill content and metadata.
5. `RunOrchestrator` injects skill instructions into runtime context.
6. Model response is generated with skill guidance applied.

### Skill Manager API

```javascript
const skills = skillManager.getSkillsList();
const eligible = skillManager.getEligibleSnapshot();
const skill = skillManager.resolveSkill('humanizer');
const commands = skillManager.getSlashCommands();
```

### Deterministic Tool-Dispatched Skills

1. Set `command-dispatch: "tool"`.
2. Set `command-tool: "your-tool-name"`.
3. Implement the tool dispatch handling in orchestrator or runtime code.

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.

- Follow the user's production-ready coding rules: question requirements, delete unnecessary work, simplify before optimizing, keep dependencies real, validate all inputs, include readable tests, flag security review needs, and use ASD-STE100 Simplified Technical English in new docs and comments.
- The concise repository checklist is `docs/PRODUCTION_READINESS.md`; keep it aligned with these contracts and the development workflow.

## Child DOX Index

- `docs/AGENTS.md`: documentation files, user guides, architecture notes, and development workflow docs.
- `src/AGENTS.md`: source modules shared by extension entry points, with deeper contracts for chat, utilities, and orchestration.
- `scripts/AGENTS.md`: build, smoke, and test scripts.
- `skills/AGENTS.md`: built-in skill registry and `SKILL.md` source files.
- `libs/AGENTS.md`: vendored browser libraries and third-party assets.
- `icons/AGENTS.md`: extension icons and copy/action image assets.
- `tests/AGENTS.md`: automated test suites, including real-browser integration coverage.

## Web Search Grounding

- Brave Search API integration via `src/utils/braveSearch.js` (LLM Context endpoint, bounded requests, normalized sources).
- The background worker owns Brave credential reads and injects the search executor; LLM profile keys never serve as Brave credentials.
- Sidebar toggle state and key bridge in `src/chat/ChatGrounding.js`.
- Reserved tool name `web_search` enforced in `src/chat/ChatAPI.js`, `src/orchestrator/RunOrchestrator.js`, and `options.js`.
- Grounded completions surface a normalized, escaped first-party **Sources** section; ordinary responses omit grounding metadata when grounding is off.
- Grounding is model-directed before use: web enabled means permission to search, not a mandate. `web_search` is offered with automatic selection alongside normal tools (or alone for `none`/a satisfied forced user tool).
- After the single search slot is consumed, the immediate continuation is text-only and receives a phase-aware instruction to use the existing result; duplicate search calls are rejected without another Brave request.
- Empty normalized Brave results are a safe `WEB_SEARCH_NO_RESULTS` outcome, not a successful grounded response.
- `braveSearch.js` and grounding/provider sequencing are covered by the behavior suite.
