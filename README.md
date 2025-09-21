# Prompt Paul Chrome Extension

A Chrome extension for processing selected text using an LLM endpoint.

## Overview

Prompt Paul is a Chrome extension that allows users to interact with AI models directly from their browser. It provides context menu options to process selected text, analyze images, and manage custom instructions and tools.

## Features

- Process selected text with custom instructions
- Analyze images, videos, and audio files
- Manage custom instructions and tools
- Support for multiple AI providers (OpenAI, Anthropic, Mistral, etc.)
- Streaming responses
- Dark/light theme support
- MCP (Model Connector Protocol) support for external tools

## Architecture

The extension follows a modular architecture with clear separation of concerns:

### Class Structure

The codebase is organized into three main types of classes:

1. **Managers** - Handle business logic and data operations
2. **ViewModels** - Manage UI state and logic
3. **Coordinators** - Control navigation and flow between components

See [classes/README.md](classes/README.md) for detailed information about the class structure.

### Key Components

- `background.js` - Background service worker
- `chat.js` - Chat interface logic
- `options.js` - Options page logic
- `content_script_unified.js` - Content extraction script
- `pdf_content_script.js` - PDF content extraction script

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory

## Configuration

1. Click the extension icon and select "Options"
2. Configure your LLM endpoint, API key, and model name
3. Add custom instructions and tools as needed

## Usage

1. Select text on any webpage
2. Right-click and choose a Prompt Paul option
3. Use the chat interface to interact with the AI

## Development

This project follows specific architectural principles:

- File length limits (< 400 lines per file)
- Single responsibility principle
- Modular design
- OOP first approach
- Manager and Coordinator patterns

## Contributing

Contributions are welcome! Please follow the established architectural patterns and coding standards.

## License

[License information would go here]