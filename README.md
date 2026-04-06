# Prompt Paul - AI Insights at the Click of a Mouse

A Chrome extension for processing selected text using an LLM endpoint. Prompt Paul provides context-aware AI insights through context menus and a side panel chat interface.

## Features

- **AI-Powered Text Processing**: Select any text on a webpage and process it with your configured LLM
- **Context Menu Integration**: Right-click on text, images, videos, or audio to analyze with AI
- **Side Panel Chat Interface**: Full-featured chat interface in Chrome's side panel
- **Custom Instructions**: Create and save custom prompts for repeated use
- **Multi-Modal Support**: Analyze images, videos, and audio content
- **Profile Management**: Configure multiple API profiles with different endpoints and models
- **Agent Skills**: OpenClaw-compatible skills system for specialized AI capabilities with slash commands
- **Dark/Light Theme**: Toggle between themes for comfortable viewing
- **Privacy-First Analytics**: Optional, anonymized usage analytics with opt-out controls

## Installation

### From Source (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/yourusername/prompt-paul.git
   cd prompt-paul
   ```

2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the extension directory
5. The Prompt Paul extension icon should appear in your Chrome toolbar

## Configuration

### Setting Up API Keys

1. Click the extension icon or right-click and select **Options**
2. In the **Connection** section, configure:
   - **LLM API Endpoint**: Your LLM provider API URL (for example `https://api.mistral.ai/v1/chat/completions`)
   - **API Key**: Your authentication key
   - **Model Name**: The model to use (for example `mistral-small-latest`)
   - **System Prompt** (optional): Custom instructions for the AI's behavior
3. Click **Save** to store your settings

### Default Demo Configuration

The extension includes a shipped demo configuration from [Mistral AI](https://mistral.ai) for quick testing. For production use, configure your own credentials and model settings.

### Creating Custom Instructions

1. Open the **Options** page
2. Navigate to the **Custom Instructions** section
3. Click **Add New Instruction**
4. Enter a name and prompt text
5. Optionally pin instructions to the quick actions sidebar

### Using Agent Skills

Prompt Paul includes an OpenClaw-compatible skills system.

**Built-in skills**:
- **humanizer** - Transforms AI-generated text to sound more natural and human
- **weather-guide** - Helps explain weather reports and terminology

**Discovering skills**:
- Type `/skills` in chat to list all available skills
- Skills marked as user-invocable have their own slash commands

For complete usage examples and command patterns, see:
- [Skill Usage Examples](docs/SKILL_EXAMPLES.md)

For complete skill authoring and metadata specification, see:
- [Agent Skills Specification](AGENTS.md)

## Usage

### Context Menu Actions

1. **Text Selection**:
   - Select text on any webpage
   - Right-click and choose **Process with Prompt Paul**
   - Select a custom instruction or enter a one-off prompt

2. **Image Analysis**:
   - Right-click on any image
   - Choose **Analyze Image with Prompt Paul**
   - Select from general analysis, summarize, explain, or custom instructions

3. **Video/Audio Analysis**:
   - Right-click on video or audio elements
   - Choose the analysis option from the context menu

### Side Panel Chat

1. Click the Prompt Paul icon in the toolbar to open the side panel
2. Use the chat interface to:
   - Type messages and get AI responses
   - Load page content for discussion
   - Use quick actions (summarize, explain)
   - Access pinned custom instructions

### Quick Actions Sidebar

- **Load Content**: Load the current page content into chat context
- **Summarize**: Quickly summarize the active tab
- **Explain**: Explain the active tab content
- **Pinned Actions**: Run your pinned custom instructions

## Development Setup

### Prerequisites

- Node.js (for package management and checks)
- Chrome browser

### Project Structure

```
prompt-paul/
|- manifest.json                # Extension manifest (MV3)
|- background.js                # Service worker
|- chat.js                      # Side panel chat logic
|- chat.html
|- chat.css
|- options.js                   # Options page logic
|- options.html
|- options.css
|- content_script_unified.js    # General page extraction
|- pdfContentScript.js          # PDF extraction
|- theme.css
|- themeUtils.js
|- loadingManager.js
|- loading-states.css
|- input-controls.js
|- collapsible.js
|- marked.min.js
|- src/
|  |- orchestrator/
|  |  |- RunOrchestrator.js
|  |- utils/
|     |- skillParser.js
|     |- toolChoiceBuilder.js
|     |- validation.js
|- skills/
|  |- skills.json
|  |- humanizer/SKILL.md
|  |- weather-guide/SKILL.md
|- docs/
|  |- SKILL_EXAMPLES.md
|- scripts/
|  |- smoke-check.js
|- .github/
|  |- workflows/
|     |- ci.yml
```

### Building

No build step is required. The extension runs directly from source files.

### Testing

1. Run repository smoke checks:
   ```bash
   npm run check
   ```
2. Load the extension in Chrome (see Installation)
3. Open Chrome DevTools on extension pages for debugging
4. Use `chrome://extensions/` to inspect errors and reload

### CI

GitHub Actions runs the same smoke check on pushes to `main` and pull requests.

## API Compatibility

Prompt Paul is compatible with OpenAI-compatible API endpoints, including:

- [Mistral AI](https://mistral.ai)
- [OpenAI](https://openai.com)
- [Anthropic Claude](https://anthropic.com) (via compatible proxy)
- [Ollama](https://ollama.ai) (local models)
- Any OpenAI-compatible endpoint

## Privacy

- **Analytics**: Anonymous usage analytics via Umami can be disabled in Options
- **Data Storage**: API keys and settings are stored in Chrome storage
- **Remote Assets**: Extension pages currently load Google Fonts in addition to analytics
- **Your Data**: Page content is sent only to your configured LLM endpoint when you invoke processing

## Permissions

- The extension is designed to work across all pages and uses broad host permissions for that behavior.
- Content extraction and context-menu workflows rely on this all-pages scope.

## Contributing

Contributions are welcome. Please feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License:

```
MIT License

Copyright (c) 2024 Prompt Paul

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Support

- **Feedback**: [Submit feedback](https://promptpaul.juanmackie.com/#feedbackform)
- **Coffee**: [Buy me a coffee](https://ko-fi.com/N4N3184MUV)

---

Made with ? by Juan Mackie
