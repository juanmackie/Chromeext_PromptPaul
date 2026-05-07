# Architecture

Prompt Paul is a Chrome extension (Manifest V3) that provides AI-powered text processing with context menus and a side panel chat interface.

## Overview

```
┌─────────────────────────────────────────────────────┐
│                   Chrome Browser                     │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Background   │  │  Side Panel  │  │  Options  │ │
│  │  (Service     │  │  (chat.html) │  │  Page     │ │
│  │   Worker)     │  │              │  │           │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         │                 │                 │        │
│  ┌──────┴───────┐  ┌──────┴───────┐         │        │
│  │  Content     │  │  Chat        │         │        │
│  │  Scripts     │  │  Modules     │         │        │
│  └──────────────┘  └──────────────┘         │        │
│                                            │        │
│  ┌─────────────────────────────────────────┴────┐   │
│  │           Orchestrator Layer                  │   │
│  │  ┌───────────┐ ┌──────────┐ ┌─────────────┐  │   │
│  │  │ Run       │ │ Skill    │ │ Tool Choice  │  │   │
│  │  │Orchestrator│ │ Parser   │ │ Builder     │  │   │
│  │  └───────────┘ └──────────┘ └─────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │              LLM API Endpoint              │     │
│  └────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

## Module Architecture

### Chat Modules (src/chat/)

The chat interface has been modularized into focused modules:

```
chat.js (1929 lines) - Main entry point
├── State management (selectedText, tabId, etc.)
├── Event listeners (submit, clear, etc.)
├── Preset management
└── Message actions

src/chat/
├── ChatUI.js      (428 lines) - UI rendering & DOM manipulation
├── ChatAPI.js     (110 lines) - API orchestration & configuration
├── ChatSkills.js  (179 lines) - Skill detection & command parsing
├── ChatVoice.js   (367 lines) - Voice input & speech recognition
├── ChatMedia.js   (157 lines) - Media data processing & analysis
├── ChatStream.js  (230 lines) - Streaming state management
└── ChatPageActions.js (new) - Preset analysis, action cards, and page quick actions
```

### Module Responsibilities

#### ChatUI.js
- Message rendering (user, LLM, system messages)
- Media preview display
- DOM manipulation (clear chat, scroll, etc.)
- Message copy functionality

#### ChatAPI.js
- API configuration retrieval
- Tool definition management
- Orchestrator run lifecycle (start, execute, abort)
- Integration with `RunOrchestrator`

#### ChatSkills.js
- Skill intent detection from natural language
- Slash command parsing (`/skill`, `/skills`)
- Skills list formatting

#### ChatVoice.js
- Web Speech API integration
- Voice input toggle and lifecycle
- Speech recognition support detection
- Microphone permission management

#### ChatMedia.js
- Media type validation (image, video, audio)
- Base64 data processing
- Analysis prompt generation
- Vision model support detection

#### ChatStream.js
- `StreamStateManager` - centralized state management
- Streaming UI element tracking
- Conversation history management
- Run/abort state tracking

### Orchestrator Layer

#### RunOrchestrator (`src/orchestrator/RunOrchestrator.js`)
- Manages the lifecycle of LLM API runs
- Handles streaming responses
- Manages tool calls and function execution
- Provides event-based communication with the UI

#### Skill Parser (`src/utils/skillParser.js`)
- Parses SKILL.md frontmatter
- Validates skill metadata
- Extracts skill instructions

#### Tool Choice Builder (`src/utils/toolChoiceBuilder.js`)
- Builds `tool_choice` payloads for LLM API requests
- Supports `auto`, `none`, `required`, and specific tool selection

#### Context and Guard Utilities (`src/utils/*.js`)
- `contextBudget.js` estimates token budgets and truncates loaded page content to safe context sizes
- `readStrategy.js` picks `dom`, `vision`, or `hybrid` extraction based on page shape signals
- `permissionGuards.js` blocks unsupported browser URLs early with clear reasons
- `runtimeErrors.js` maps Chrome runtime errors to user-friendly messages
- `actionCards.js` generates platform-aware quick action prompts (for example YouTube, GitHub, Gmail)
- `suggestionStorage.js` stores site suggestions with normalization and deduplication

### Data Flow

#### Chat Message Flow

```
User Input
    │
    ▼
chat.js (sendMessage)
    │
    ├─► ChatSkills.js (detectSkillIntent)
    │      └─► Returns skill context
    │
    ├─► ChatAPI.js (getApiConfig, getTools)
    │      └─► Returns API configuration
    │
    ├─► ChatStream.js (StreamStateManager)
    │      └─► Tracks conversation history & streaming state
    │
    └─► ChatAPI.js (startRun, executeRun)
           └─► RunOrchestrator.js
                  └─► LLM API Endpoint
                         │
                         ▼
                  Streaming Response
                         │
                         ▼
                  chat.js (orchestratorEvent handler)
                         │
                         ├─► ChatUI.js (addMessage, update streaming)
                         └─► ChatStream.js (update history)
```

#### Context Menu Flow

```
Right-click on text/image
       │
       ▼
background.js (context menu handler)
       │
       ├─► Content Scripts (extract content)
       │
       └─► Side Panel (chat.html)
              │
              └─► chat.js
                     └─► Same as Chat Message Flow
```

### File Dependencies

```
chat.js
  ├── themeUtils.js
  ├── loadingManager.js
  ├── src/utils/toolChoiceBuilder.js
  ├── src/chat/ChatPageActions.js
  ├── src/chat/ChatUI.js
  ├── src/chat/ChatAPI.js
  │     └── src/orchestrator/RunOrchestrator.js
  │           └── src/utils/validation.js
  ├── src/chat/ChatSkills.js
  │     └── src/utils/skillParser.js
  ├── src/chat/ChatVoice.js
  ├── src/chat/ChatMedia.js
  └── src/chat/ChatStream.js
  ├── src/utils/contextBudget.js
  ├── src/utils/runtimeErrors.js
  ├── src/utils/permissionGuards.js
  └── src/utils/actionCards.js
```

## State Management

### StreamStateManager

The `StreamStateManager` class in `ChatStream.js` provides centralized state management:

```javascript
streamState = new StreamStateManager()

streamState.setRunId(id)
streamState.setStreamingElements(div, element, uniqueId)
streamState.addMessageToHistory({ role, content })
streamState.appendStreamedText(text)
streamState.resetStreamingState()
```

### Local Variables (chat.js)

Simple local variables for UI state:
- `selectedText` - Currently selected text from context menu
- `tabId` - Current tab identifier
- `panelTabId` - Owning tab for the side panel
- `currentAbortController` - Abort controller for API calls

## Skills System

Prompt Paul implements an OpenClaw-compatible Agent Skills system. See [AGENTS.md](../AGENTS.md) for the full specification.

### Skill Resolution Flow

1. User enters `/skill <name>` or natural language intent
2. `chat.js` parses command via `ChatSkills.js`
3. `Orchestrator` injects skill instructions into runtime context
4. Model response is generated with skill guidance applied

## Build System

See [DEVELOPMENT.md](DEVELOPMENT.md) for build and test documentation.

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/build.js` | Production and development builds |
| `scripts/test-runner.js` | Unit and integration tests |
| `scripts/smoke-check.js` | Quick validation checks |

## Testing

The test runner validates:
- Module existence and structure
- Manifest and package.json validity
- Skill file structure
- Import consistency
- Build script functionality

## Code Quality

- **ESLint** - JavaScript linting and code quality
- **Prettier** - Consistent code formatting

---

*Architecture documentation for Prompt Paul v6.0.0*
