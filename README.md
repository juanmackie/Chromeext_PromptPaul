# Prompt Paul

Prompt Paul is a Chrome extension for sending selected text or page content to an LLM from the context menu or side panel.

## What It Does

- Process selected text, images, video, and audio from the browser
- Load page content into a side panel chat
- Save custom instructions and quick actions
- Support OpenClaw-compatible Agent Skills
- Use page-aware action cards for sites like YouTube, GitHub, Gmail, and docs
- Trim loaded content to stay within context limits
- Store settings locally with opt-in anonymous analytics

## Install

### From source

```bash
git clone https://github.com/juanmackie/Chromeext_PromptPaul.git
cd Chromeext_PromptPaul
```

1. Open Chrome and go to `chrome://extensions/`
2. Turn on Developer mode
3. Click Load unpacked
4. Select this repository

## Configure

1. Open the extension Options page
2. Set your LLM endpoint, API key, and model. The extension does not ship with a demo API key.
3. Optionally set a system prompt and create custom instructions
4. Save the profile you want to use

## Use

### Context menu

- Right-click selected text to process it with Prompt Paul
- Right-click images, video, or audio for media-aware analysis
- Choose a saved instruction or use a one-off prompt

### Side panel

- Load the current page into chat
- Ask questions about the page content
- **Quick actions and selected text:**
  - Select text on the page and use Explain, Proofread, Analyze, or custom prompts
  - Selected text displays as a visible chip in the input area
  - Remove the chip to run sidebar actions as conversation follow-ups instead
  - Sidebar action buttons enable when you have selected text or an active conversation
- Invoke skills with `/skills`, `/skill <name>`, or `/<skill-name>`

## Skills

Built-in skills:

- `humanizer`
- `weather-guide`

See [docs/SKILL_EXAMPLES.md](docs/SKILL_EXAMPLES.md) for usage examples and [AGENTS.md](AGENTS.md) for the full skill specification.

## Development

### Scripts

```bash
npm run build
npm run build:dev
npm run build:prod
npm run test
npm run smoke
npm run validate
```

### Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/SKILL_EXAMPLES.md](docs/SKILL_EXAMPLES.md)
- [docs/RANKED_IMPLEMENTATION.md](docs/RANKED_IMPLEMENTATION.md)

## API Compatibility

Prompt Paul works with OpenAI-compatible endpoints, including Mistral, OpenAI, and compatible local or proxy-backed providers.

## Privacy

- API keys and settings stay in Chrome storage
- Anonymous analytics are opt-in and disabled by default
- Analytics sends only coarse event labels such as instruction name, model name, and tool names
- No page URLs, page titles, page content, API keys, or prompt text are sent to analytics
- Browser-internal pages and the Chrome Web Store are blocked before extraction
- Page content is only sent when you explicitly invoke processing

## Permissions

- The extension is designed to work across all pages and uses broad host permissions for that behavior.
- Content extraction and context-menu workflows rely on this all-pages scope.
- Restricted browser pages (for example `chrome://`, extension pages, and the Chrome Web Store) are detected and reported with user-friendly errors before extraction.

## Contributing

Contributions are welcome. Please feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License.

## Support

- **Feedback**: [Submit feedback](https://promptpaul.juanmackie.com/#feedbackform)
- **Coffee**: [Buy me a coffee](https://ko-fi.com/N4N3184MUV)

---

Made with care by Juan Mackie
