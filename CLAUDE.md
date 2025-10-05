# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Prompt Paul** is a Manifest V3 Chrome extension that provides AI-powered text analysis via context menus. It integrates with LLM endpoints (OpenAI, Anthropic, etc.) and supports:
- Multimodal analysis (images, video, audio)
- Custom instructions via context menus
- Tool execution with webhook endpoints
- Privacy-first analytics (Umami)
- Streaming responses with thinking blocks

## Development Commands

### Extension Loading
- Load unpacked extension in Chrome: `chrome://extensions/` → Enable Developer Mode → Load unpacked
- Test pages are available in the root directory:
  - `test-enhanced-thinking-block.html` - Component testing for thinking blocks
  - `chat.html` - Chat interface testing
  - `options.html` - Settings page testing

### No Automated Tests
- Manual testing only via HTML test files
- No npm scripts for testing/building currently configured

## Architecture

### Core Files
- **`background.js`** - Service worker handling:
  - Context menu creation and click handlers
  - LLM API requests (streaming and non-streaming)
  - Tool execution orchestration
  - Media processing (base64 conversion)
  - Analytics tracking
  - Tab content extraction coordination

- **`chat.js`** - Side panel UI managing:
  - Conversation history
  - Message rendering with markdown
  - Enhanced thinking blocks (streaming support)
  - Media preview display
  - API calls with multimodal support
  - Tool execution UI feedback

### Modular Architecture

The codebase follows a modular service-oriented architecture under `src/`:

#### `src/shared/` - Core Utilities
- **`dependency-container.js`** - DI container with interface validation
- **`error-handler.js`** - Centralized error handling with custom error classes
- **`logger.js`** - Structured logging with log levels
- **`validators.js`** - Input validation and sanitization
- **`index.js`** - Barrel export for shared utilities

Import pattern:
```javascript
import { logger, errorHandler, validators } from '../shared/index.js';
```

#### `src/background/` - Background Services
- **`analytics-service.js`** - Umami analytics tracking
- **`api-service.js`** - LLM API request handling
- **`context-menu-service.js`** - Context menu management
- **`tool-execution-service.js`** - Tool execution logic
- **`tab-service.js`** - Tab content extraction
- **`media-service.js`** - Media processing utilities
- **`background.js`** - Service worker entry point

#### `src/chat/` - Chat UI Components
- **`chat/ui/message-renderer.js`** - Message rendering logic
- **`chat/ui/media-preview.js`** - Media preview components
- **`chat/ui/thinking-block-ui.js`** - Thinking block UI
- **`chat/api/chat-api-client.js`** - API client for chat
- **`chat/api/streaming-handler.js`** - Streaming response handling
- **`chat/state/conversation-store.js`** - Conversation state management
- **`chat/state/ui-state-manager.js`** - UI state management
- **`chat/chat.js`** - Chat interface entry point

#### `src/options/` - Options Page Components
- **`profile-manager.js`** - Profile CRUD operations
- **`instruction-manager.js`** - Custom instructions management
- **`tool-manager.js`** - Tool definitions management
- **`settings-manager.js`** - General settings
- **`options.js`** - Options page entry point

### Dependency Injection Pattern

Services are registered with the container using:
```javascript
container.register('ServiceName', ServiceClass, ['Dep1', 'Dep2'], {
  singleton: true,
  interface: 'InterfaceName'
});
```

Resolve dependencies:
```javascript
const service = container.resolve('ServiceName');
```

### Key Data Flow

1. **Context Menu Click** → `background.js` creates context menus → user clicks → handler fires
2. **Tab Content Extraction** → `background.js` injects `content_script_unified.js` → extracts DOM text → returns to background
3. **LLM Request** → `background.js` or `chat.js` → validates config → formats messages → sends to API → handles streaming
4. **Tool Execution** → LLM returns tool_calls → `background.js` executes via `executePromptPaulTool` → returns result → sends back to LLM
5. **Media Analysis** → Context menu on image → `background.js` converts to base64 → sends to chat.js → includes in API request with multimodal format

### Storage Schema

Uses `chrome.storage.local`:
- **`profiles`** - Array of LLM endpoint profiles with API keys, model names, system prompts
- **`lastSelectedProfileId`** - Active profile ID
- **`instructions`** - Custom instruction objects with name, content, tool_choice
- **`promptPaulTools`** - Tool definitions with name, description, parameters (JSON Schema), endpointUrl, httpMethod
- **`pinnedQuickActions`** - Array of pinned instruction IDs
- **`analyticsConsent`** - Boolean for analytics opt-out (default: true)

### API Request Structure

#### Non-Streaming
```javascript
{
  model: 'model-name',
  messages: [
    { role: 'system', content: 'Date/time + system prompt' },
    { role: 'user', content: 'prompt' },
    { role: 'assistant', content: 'response', tool_calls: [...] },
    { role: 'tool', tool_call_id: 'id', name: 'tool', content: 'result' }
  ],
  max_tokens: 2048,
  tools: [...], // OpenAI format tool definitions
  tool_choice: 'auto' | 'none' | { type: 'function', function: { name: 'tool' } }
}
```

#### Streaming
- Set `stream: true`
- Background.js handles SSE parsing
- Sends chunks via `chrome.runtime.sendMessage` with actions:
  - `streamApiStart` - Initialize streaming UI
  - `streamApiResponseChunk` - Text content chunks
  - `streamApiThinkingChunk` - Thinking/answer separated content
  - `streamApiToolCallChunk` - Tool call information
  - `streamApiEnd` - Finalize and execute tools if needed

### Thinking Blocks

Two implementations:
1. **`thinking-block`** - Basic web component with `think` and `answer` attributes
2. **`enhanced-thinking-block`** - Enhanced version supporting:
   - `<thinking>` tag parsing from content
   - Streaming mode with `streaming` attribute
   - Uses `content` attribute for raw text with tags
   - Auto-extracts thinking/answer sections

### Tool System

**Tool Definition**:
```javascript
{
  name: 'tool_name',
  description: 'What the tool does',
  parameters: '{"type":"object","properties":{...}}', // JSON Schema string
  endpointUrl: 'https://api.example.com/endpoint',
  httpMethod: 'POST' | 'GET' | 'PUT' | 'DELETE' // Optional, defaults to POST for args, GET for empty
}
```

**Tool Execution Flow**:
1. LLM responds with `tool_calls` array
2. Background.js receives and sends `executePromptPaulTool` message
3. Fetches tool definition from storage
4. Calls `endpointUrl` with arguments
5. Returns result to LLM in next request

**MCP Support**: Previously supported, now removed. MCP-related code is stubbed out.

### Analytics

Uses Umami analytics with privacy-first approach:
- **Opt-out by default** (user consent: true unless explicitly disabled)
- **Rotating instance IDs** - Change every 30 days
- **Sanitized labels** - Removes sensitive keywords (email, token, password, etc.)
- **Event tracking**:
  - `installed` - Extension installation
  - `instruction_used` - Custom instruction execution
  - `error_event` - Error occurrences

### Code Style Requirements

**File Naming**: `kebab-case.js`
**Classes**: `PascalCase`
**Functions**: `camelCase`
**Constants**: `UPPER_SNAKE_CASE`
**Services**: Suffix with `Service`

**Import Pattern**:
```javascript
import { service } from './relative/path.js'; // Always include .js extension
```

**Error Handling**:
```javascript
try {
  // operation
} catch (error) {
  errorHandler.handleApiError(error, context);
}
```

**Logging**:
```javascript
logger.debug('Operation detail', { data });
logger.info('User action completed');
logger.error('Error occurred', { error, context });
```

### Security Guidelines

- **Default Deny**: Explicit permission required for all operations
- **Input Validation**: Use `validators.validate()` for external data
- **Sanitization**: Mask sensitive data in logs (API keys, tokens)
- **CSP**: Extension pages restricted to `'self'` for scripts
- **Storage**: Never store raw API keys in sync storage

### Manifest V3 Specifics

- **Background**: Service worker, not persistent background page
- **Content Scripts**: Injected on-demand via `chrome.scripting.executeScript`
- **Permissions**: `activeTab`, `contextMenus`, `storage`, `sidePanel`, `scripting`
- **Side Panel**: Chat UI opens in browser side panel

### Important Implementation Notes

1. **Message Passing**: Use retry logic (`sendMessageWithRetry`) for robustness
2. **Tab Validation**: Check tab is still active before sending messages
3. **Streaming State**: Track with `currentStreamingMessageDiv`, `currentStreamingContentElement`, `accumulatedStreamedText`
4. **Tool Execution**: Prevent duplicates with `activeToolExecutions` Set
5. **Media Format**: Convert to base64, use OpenAI format (`image_url`) or Anthropic format (`image.source.base64`) based on endpoint

### Common Pitfalls

- **Don't** access `shadowRoot` directly on thinking blocks - use attributes
- **Don't** forget `.js` extension in imports
- **Don't** use bash grep/sed/cat - use specialized tools (Read, Edit, Grep)
- **Do** validate config with `validateConfig()` before API calls
- **Do** clear streaming state on `streamApiEnd`
- **Do** use dependency injection for testability

### Testing Notes

- No automated tests exist yet
- Manual testing workflow:
  1. Load extension unpacked
  2. Right-click text → select Prompt Paul action
  3. Verify side panel opens with expected behavior
  4. Check console for errors
  5. Test custom instructions from options page
  6. Verify tool execution with sample endpoints

### Future Considerations

From CRUSH.md production rules:
- **File size**: Monitor for 400+ line files (yellow flag), 800+ (red flag)
- **Maintainability**: Use metrics (cyclomatic complexity < 10, maintainability index > 50)
- **Testing**: Add automated tests using AAA pattern (Arrange, Act, Assert)
- **Refactoring**: Apply when deletion test, understanding test, or reuse test fails
