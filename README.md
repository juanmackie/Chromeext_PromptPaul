# Prompt Paul - AI Insights at the Click of a Mouse

A Chrome extension for processing selected text using an LLM endpoint. Prompt Paul provides context-aware AI insights through context menus and a side panel chat interface.

## Features

- **AI-Powered Text Processing**: Select any text on a webpage and process it with your configured LLM
- **Context Menu Integration**: Right-click on text, images, videos, or audio to analyze with AI
- **Side Panel Chat Interface**: Full-featured chat interface in Chrome's side panel
- **Custom Instructions**: Create and save custom prompts for repeated use
- **Multi-Modal Support**: Analyze images, videos, and audio content
- **Profile Management**: Configure multiple API profiles with different endpoints and models
- **Dark/Light Theme**: Toggle between themes for comfortable viewing
- **Privacy-First Analytics**: Optional, anonymized usage analytics with easy opt-out

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
   - **LLM API Endpoint**: Your LLM provider's API URL (e.g., `https://api.mistral.ai/v1/chat/completions`)
   - **API Key**: Your authentication key
   - **Model Name**: The model to use (e.g., `mistral-small-latest`)
   - **System Prompt** (optional): Custom instructions for the AI's behavior

3. Click **Save** to store your settings

### Default Demo Configuration

The extension comes with a demo API key from [Mistral AI](https://mistral.ai) for quick testing. For production use, configure your own API credentials.

### Creating Custom Instructions

1. Open the **Options** page
2. Navigate to the **Custom Instructions** section
3. Click **Add New Instruction**
4. Enter a name and the instruction prompt
5. Instructions can be pinned to the quick actions sidebar

## Usage

### Context Menu Actions

1. **Text Selection**:
   - Select text on any webpage
   - Right-click and choose **Process with Prompt Paul**
   - Select a custom instruction or enter a one-off prompt

2. **Image Analysis**:
   - Right-click on any image
   - Choose **Analyze Image with Prompt Paul**
   - Select from: General Analysis, Summarize, Explain, or custom instructions

3. **Video/Audio Analysis**:
   - Right-click on video or audio elements
   - Choose the analysis option from the context menu

### Side Panel Chat

1. Click the Prompt Paul icon in the toolbar to open the side panel
2. Use the chat interface to:
   - Type messages and get AI responses
   - Load page content for discussion
   - Use quick actions (Summarize, Explain)
   - Access pinned custom instructions

### Quick Actions Sidebar

- **Load Content** (📄): Load the current page's content into the chat context
- **Summarize** (S): Quickly summarize the current tab
- **Explain** (E): Get an explanation of the current tab's content
- **Pinned Actions**: Your pinned custom instructions appear here

## Development Setup

### Prerequisites

- Node.js (optional, for package management)
- Chrome browser

### Project Structure

```
prompt-paul/
├── manifest.json           # Extension configuration
├── background.js           # Service worker with context menus & API handling
├── chat.js                 # Side panel chat interface logic
├── chat.html               # Side panel HTML
├── chat.css                # Side panel styles
├── options.js              # Options page logic
├── options.html            # Options page HTML
├── options.css             # Options page styles
├── content_script_unified.js  # Content script for page interaction
├── pdfContentScript.js     # PDF-specific content extraction
├── theme.css               # Shared theme variables
├── themeUtils.js           # Theme toggle utilities
├── loadingManager.js       # Loading state management
├── loading-states.css      # Loading animation styles
├── input-controls.js       # Input field utilities
├── collapsible.js          # Collapsible UI components
├── error.html              # Error page
├── marked.min.js           # Markdown parser library
├── src/
│   └── utils/
│       └── validation.js   # Input validation utilities
├── icons/                  # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   ├── copy-formatted.png
│   ├── copy-markdown.png
│   └── ...
└── plans/                  # Development planning documents
```

### Key Files Explained

- **[`manifest.json`](manifest.json)**: Chrome Extension manifest v3 configuration
- **[`background.js`](background.js)**: Service worker handling:
  - Context menu creation and clicks
  - API communication
  - Message routing between components
  - Analytics tracking
- **[`chat.js`](chat.js)**: Side panel functionality:
  - Chat message handling
  - Streaming responses
  - Quick actions
  - Copy functionality
- **[`options.js`](options.js)**: Configuration page:
  - Profile management
  - Custom instructions
  - API settings
- **[`content_script_unified.js`](content_script_unified.js)**: Content extraction from web pages

### Building

No build step required - the extension runs directly from source files.

### Testing

1. Load the extension in Chrome (see Installation)
2. Open Chrome DevTools on the extension pages for debugging
3. Use `chrome://extensions/` to view errors and reload the extension

## API Compatibility

Prompt Paul is compatible with OpenAI-compatible API endpoints, including:

- [Mistral AI](https://mistral.ai)
- [OpenAI](https://openai.com)
- [Anthropic Claude](https://anthropic.com) (via compatible proxy)
- [Ollama](https://ollama.ai) (local models)
- Any OpenAI-compatible endpoint

## Privacy

- **Analytics**: Optional, anonymized usage analytics via Umami
- **Data Storage**: API keys and settings stored locally in Chrome storage
- **No External Tracking**: Only analytics endpoint is contacted (can be disabled)
- **Your Data**: Page content is only sent to your configured LLM endpoint

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License - see below for details:

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

Made with ✨ by Juan Mackie
