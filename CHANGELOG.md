# Changelog

## [Unreleased]

### Bug Fixes

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
