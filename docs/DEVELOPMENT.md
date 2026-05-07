# Development Guide

## Prerequisites

- **Node.js 18+** (for build tools and testing)
- **Chrome browser** (for extension testing)
- **Git** (for version control)

## Getting Started

### Clone and Install

```bash
git clone https://github.com/juanmackie/Chromeext_PromptPaul.git
cd Chromeext_PromptPaul
npm install
```

### Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the project directory
4. The Prompt Paul extension icon should appear in your Chrome toolbar

## Project Structure

```
prompt-paul/
├── background.js              # Service worker (MV3)
├── chat.js                    # Side panel chat entry point
├── chat.html / chat.css       # Chat UI markup and styles
├── options.js                 # Options page logic
├── options.html / options.css # Options page markup and styles
├── content_script_unified.js  # Page content extraction
├── pdfContentScript.js        # PDF content extraction
├── themeUtils.js              # Theme toggle utilities
├── loadingManager.js          # Loading states and toasts
├── collapsible.js             # Collapsible sections
├── input-controls.js          # Input element controls
├── manifest.json              # Extension manifest (MV3)
├── package.json               # NPM scripts and dependencies
│
├── src/                       # Source modules
│   ├── chat/                  # Chat interface modules
│   │   ├── ChatUI.js          # UI rendering
│   │   ├── ChatAPI.js         # API orchestration
│   │   ├── ChatSkills.js      # Skill detection
│   │   ├── ChatVoice.js       # Voice input
│   │   ├── ChatMedia.js       # Media processing
│   │   ├── ChatStream.js      # Streaming state
│   │   └── ChatPageActions.js # Preset analysis and page action cards
│   ├── orchestrator/
│   │   └── RunOrchestrator.js # LLM API run management
│   └── utils/
│       ├── actionCards.js     # Page-aware quick actions
│       ├── contextBudget.js   # Token budgeting helpers
│       ├── permissionGuards.js # Restricted page checks
│       ├── readStrategy.js    # DOM/vision/hybrid selection
│       ├── runtimeErrors.js    # Chrome/runtime error mapping
│       ├── suggestionStorage.js # Site suggestion persistence
│       ├── skillParser.js     # SKILL.md parsing
│       ├── toolChoiceBuilder.js# Tool choice construction
│       └── validation.js      # Input validation
│
├── skills/                    # Agent Skills
│   ├── skills.json            # Skills manifest
│   ├── humanizer/SKILL.md     # Humanizer skill
│   └── weather-guide/SKILL.md # Weather guide skill
│
├── libs/                      # Vendored libraries
│   ├── readability.js         # Readability extraction
│   └── turndown.js            # HTML to Markdown
│
├── icons/                     # Extension icons
│
├── docs/                      # Documentation
│   ├── SKILL_EXAMPLES.md      # Skill usage examples
│   ├── ARCHITECTURE.md        # Architecture docs
│   ├── DEVELOPMENT.md         # This file
│   └── SKILL_EXAMPLES.md      # Skill usage examples
│
├── scripts/                   # Build and test scripts
│   ├── build.js               # Extension build
│   ├── test-runner.js         # Test runner
│   └── smoke-check.js         # Quick validation
│
└── .github/workflows/
    └── ci.yml                 # CI/CD pipeline
```

## Available Scripts

### Build

```bash
# Development build (outputs to dist/)
npm run build:dev

# Production build
npm run build:prod

# Generic build (defaults to dev)
npm run build
```

### Test

```bash
# Run all tests
npm run test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Tests with coverage report
npm run test:coverage
```

### Code Quality

```bash
# Lint JavaScript files
npm run lint

# Format code with Prettier
npm run format

# Check formatting only
npm run format:check
```

### Validation

```bash
# Full validation pipeline
npm run validate
# Runs: lint → format:check → test → smoke
```

## Development Workflow

### 1. Make Changes

Edit the source files directly. The extension loads from source in developer mode.

### 2. Test Changes

```bash
# Quick validation
npm run check

# Full validation
npm run validate
```

### 3. Build (optional)

```bash
npm run build:dev
# Load from dist/ directory for testing
```

### 4. Reload Extension

1. Go to `chrome://extensions/`
2. Click the refresh icon on Prompt Paul

## Adding a New Chat Module

1. Create the module in `src/chat/YourModule.js`
2. Add `@fileoverview` and `@module` JSDoc tags
3. Export functions and classes
4. Import and use in `chat.js`
5. Add tests in `scripts/test-runner.js`
6. Run `npm run validate` to verify

Common extraction targets now include `ChatPageActions.js` for preset and page-card logic, and the `src/utils/` helpers for page routing and guards.

### Module Template

```javascript
/**
 * @fileoverview Brief description of the module
 * @module YourModule
 */

/**
 * Description of the function
 * @param {string} input - Input parameter description
 * @returns {Object} Return value description
 */
export function yourFunction(input) {
  // Implementation
}
```

## Adding a New Skill

1. Create `skills/your-skill/SKILL.md` with frontmatter
2. Add to `skills/skills.json`
3. Test with `/skills` and `/skill your-skill` in chat
4. See [AGENTS.md](../AGENTS.md) for the full specification

## Debugging

### Extension Logs
- Background worker logs: `chrome://extensions/` → Inspect views
- Side panel logs: Right-click → Inspect in side panel
- Content script logs: Right-click on page → Inspect → Console

### Common Issues

**Extension doesn't load:**
- Check manifest.json is valid
- Verify all referenced files exist
- Check Chrome console for errors

**API calls fail:**
- Verify API endpoint URL
- Check API key is set in Options
- Ensure model name is correct

**Skills not working:**
- Verify SKILL.md frontmatter is valid
- Check skills.json format
- Reload the extension

## Code Style

- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Trailing commas**: ES5 style
- **Line length**: 100 characters max
- **Arrow functions**: Parentheses always

## Building for Distribution

```bash
# Create production build
npm run build:prod

# The dist/ directory contains the packaged extension
# Load as unpacked or package as .crx/.zip
```

---

*Development guide for Prompt Paul v6.0.0*
