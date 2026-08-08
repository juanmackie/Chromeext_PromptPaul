# Changelog

## [Unreleased]

### Prompt Paul UX Refinement

A coordinated, composer-led refinement of the whole extension, shipped together:

- **Foundation**: Extended the theme token system with semantic feedback colors (`--ext-success`, `--ext-warning`, `--ext-info`, `--ext-running` + deep/bright/foreground/muted variants) across light, dark, and system-preference themes; added a shared UI primitives layer (`ui-primitives.css` with buttons, chips, badges, trays, sections, and run indicators); standardized the run/feedback state vocabulary (`idle`, `running`, `streaming`, `stopping`, `complete`, `error`, `stopped`) in `src/utils/runState.js`, applied to the chat input area with `aria-busy` mirroring.
- **Chat-first composer**: The chat is now composer-led. A visible context tray (`#context-tray`) shows every attached context (selected text, media, page content) as removable chips near the input. A contextual quick-action row offers Analyze/Proofread/Explain for selections and Summary/TL;DR/Technical for loaded pages. Responses gain inline recovery: Stop while streaming, then Retry/Edit/Continue — Continue always builds on the previous response. Capabilities (sidebar, Web toggle, voice, skills) stay visible but visually secondary. Logic lives in `src/chat/ChatComposer.js`.
- **Options**: Chat-led setup with a Get Started banner, live connection status, and an Open Chat button. Explicit per-section saves (Connection, Privacy, Web Search) replace implicit persistence, with flash feedback on each. Capability sections (Instructions, Agent Skills, Tools, Web Search) are marked with badges. Credentials are masked: stored API keys are never written into input fields; masked placeholders indicate configured keys, and saving preserves the stored key unless replaced. An unsaved-changes banner plus a `beforeunload` guard covers the combined dirty state of every section.
- **Entry points**: All entry points funnel into the canonical chat. A toolbar action opens the side panel; extension pages and the Prompt Paul website (`externally_connectable`) can deep-link with `{ action: 'openChat', context }`, preserving selection, media, and instruction context; deep-link instructions run automatically against the attached context. Context-menu flows keep preserving page, selection, and media context.
- **Compatibility**: Storage schemas, profiles, capabilities, and backups are unchanged; nothing was retired. Regression guards pin the storage keys, backup/import/export entry points, and capability surfaces.

### New Features

- **Web Search Grounding**: A sidebar toggle (Web) lets users optionally ground LLM answers with Brave Search. When enabled, the model may call the reserved `web_search` function tool when current, verifiable, or time-sensitive information would materially improve the answer — the toggle is a permission, not a mandate, so the model can answer directly without searching. Queries Brave's LLM Context API and returns source-cited results that the UI renders as a first-party Sources section. Requires a Brave Search API key; pricing and quotas are subject to Brave's current plans. Grounding is disabled by default.

### Bug Fixes

- Fixed reasoning-only completions that could consume the response budget without producing a final answer; provider completion metadata, reserved output capacity, and a bounded text-only recovery now prevent misleading token-budget warnings
- Fixed "A response is already in progress" error that prevented follow-up messages after initial response completion (run state was not cleared on success)
- Fixed sidebar quick-action buttons becoming permanently disabled after initial selected-text action

### Improvements

- **Selected text handling**: Selected text now displays as a visible, dismissible chip in the chat input area instead of hidden state
  - Chip shows a 2-line preview of selected text and can be removed independently of clearing the chat
  - Sidebar actions (Explain, Proofread, Analyze, custom prompts) now work as conversation follow-ups when no text is selected
  - Buttons enable when there's a selection OR existing conversation history
- **Copy button feedback**: Response copy buttons (raw/formatted) now flash green "Copied!" or red "Copy failed" on interaction with 1.5s auto-revert
- **Copy button labels**: Updated from "Copy"/"Formatted" to clearer "Copy As Raw text" / "Copy As Formatted Text" with white-space handling
- Removed first-run analytics consent banner (consent toggle still available in Options)
- Refactored `chat.js` to move page action cards, preset analysis, and site suggestion rendering into `src/chat/ChatPageActions.js`
- Added page-context helpers for token budgeting, read strategy selection, permission guards, and runtime error normalization
- Updated docs to match the current module layout and page-aware quick-action flow
- Expanded content extraction metadata for platform-aware quick actions and YouTube moment prompts

### New

- `src/utils/braveSearch.js` — bounded Brave LLM Context API client and normalized source contract
- `src/chat/ChatGrounding.js` — toggle state, Brave key status bridge, and Sources formatting helpers

## [6.0.0] - 2026-04-25

### Major Changes

- **Modular refactor**: Extracted 7 modules from chat.js and related helpers for page-aware analysis
  - `ChatUI.js` - UI rendering and DOM manipulation
  - `ChatAPI.js` - API orchestration and configuration
  - `ChatSkills.js` - Skill detection and command parsing
  - `ChatVoice.js` - Voice input and speech recognition
  - `ChatMedia.js` - Media data processing and analysis
  - `ChatStream.js` - Streaming state management
  - `ChatPageActions.js` - Preset analysis and page action cards

- **Build system**: Added comprehensive build infrastructure
  - Production and development builds
  - Manifest validation
  - Build metadata generation

- **Test framework**: Created automated test suite
  - Unit tests for module structure
  - Integration tests for file dependencies
  - Coverage reporting

- **CI/CD pipeline**: Enhanced GitHub Actions workflow
  - Validate job (lint, format, tests)
  - Build job (production build with artifact upload)
  - Test job (full suite with coverage)

- **Code quality tools**: Added ESLint and Prettier configuration

### New Features

- StreamStateManager for centralized streaming state
- Enhanced media analysis prompt generation
- Improved error handling in chat modules

### Bug Fixes

- Fixed duplicate variable declarations in chat.js
- Fixed invalid object literal method calls in console.log
- Fixed unreachable code in error handler
- Fixed missing closing brace in DOMContentLoaded handler

### Documentation

- Created ARCHITECTURE.md
- Created DEVELOPMENT.md
- Created CHANGELOG.md
- Created CONTRIBUTING.md
- Updated README.md with new build/test documentation
- Updated README.md, ARCHITECTURE.md, and DEVELOPMENT.md for action cards, context budgeting, and restricted-page handling

## [5.0.0] - 2026-03-22

### Major Changes

- **Agent Skills system**: OpenClaw-compatible skill system
  - SKILL.md frontmatter specification
  - Slash command support (`/skill`, `/skills`)
  - Natural language intent detection
  - Built-in skills: humanizer, weather-guide

- **Orchestrator**: RunOrchestrator for streaming API calls
  - Event-based streaming response handling
  - Tool call management
  - Conversation history tracking

- **Voice input**: Web Speech API integration
  - Microphone permission management
  - Toggle button with state feedback

### New Features

- Custom instruction presets with pinning
- Media analysis (images, videos, audio)
- Quick action sidebar
- Dark/light theme toggle
- Profile management for multiple API endpoints

### Improvements

- Enhanced error handling and user feedback
- Loading states and toast notifications
- Better accessibility support

## [4.0.0] - 2025-12-15

### Major Changes

- **Manifest V3 migration**: Upgraded from MV2 to MV3
  - Service worker replacement for background page
  - Side panel API integration
  - Updated permission model

### New Features

- Side panel chat interface
- Context menu integration for text, images, video, audio
- Multi-modal support
- Privacy-first analytics (Umami)

## [3.0.0] - 2025-09-01

### Major Changes

- **Options page redesign**: Complete UI overhaul
  - Connection configuration
  - Custom instruction management
  - Profile management
  - Analytics controls

### New Features

- Custom instruction support
- Multiple API profile support
- System prompt customization
- Export/import configuration

## [2.0.0] - 2025-06-01

### Major Changes

- **OpenAI API compatibility**: Support for any OpenAI-compatible endpoint
- **Streaming responses**: Real-time response display

### New Features

- Mistral AI support
- Model selection
- Temperature and max tokens configuration

## [1.0.0] - 2025-03-01

### Initial Release

- Basic text processing via context menu
- Simple API integration
- Chrome extension foundation

---

_Prompt Paul Changelog_
