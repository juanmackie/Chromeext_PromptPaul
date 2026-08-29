# Prompt Paul

Prompt Paul is a Chrome extension for sending selected text or page content to an LLM from the context menu or side panel.

## What It Does

- Process selected text, images, video, and audio from the browser
- Load page content into a side panel chat
- Attach `.txt` / `.md` / `.csv` / `.json` documents as bounded text context (converted locally, never uploaded as raw files)
- Structured extraction for Reddit threads, GitHub repository/issue pages, and RSS/Atom feed URLs, plus YouTube transcripts
- Composer-led chat: a visible context tray shows every attached context (selection, media, page) with one-click detach, and contextual quick actions (Analyze/Proofread/Explain, page Summary/TL;DR/Technical) sit right above the input
- Inline recovery on every response: Stop, Retry, Edit, Continue
- Save custom instructions and quick actions
- Support OpenClaw-compatible Agent Skills
- Use page-aware action cards for sites like YouTube, GitHub, Gmail, and docs
- Opt into guarded natural-language actions on the current page (inspect, click, fill, select, scroll)
- Receive bounded action receipts and safe recovery when a page action is not verified
- Trim loaded content to stay within context limits
- Store settings locally with opt-in anonymous analytics
- Open the chat from the toolbar icon, context menus, the Options page, or website deep links

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
2. Follow the **Get Started** banner: source checkouts seed an OpenRouter-compatible endpoint with the `openrouter/free` model, but require your own API key. See [OpenRouter's API keys](https://openrouter.ai/keys) and [free models](https://openrouter.ai/collections/free-models) to get started; free-model quality may vary. You can also choose **Codex subscription (ChatGPT)** and use **Sign in with ChatGPT**; a successful sign-in creates/selects a **Codex** profile, loads the available models, and exposes the model-specific thinking level. Codex credentials stay background-owned and are not included in backups. Replace the starter settings with your own endpoint, API key, or connected ChatGPT profile, then click **Open Chat** to start in the side panel.
3. Configure Web Search Grounding (optional):
   - Enable the **Web** toggle in the side panel to allow grounding
   - Add a Brave Search API key on the Options page (see [Brave's current plans and terms](https://brave.com/search/api/))
   - When a key is configured and the toggle is on, the model may search the web when current, verifiable, or time-sensitive information would improve the answer — search is a permission, not a mandate, so the model can still answer directly
   - The selected endpoint/model must support function calling; otherwise grounding will be disabled for that request
4. Optionally set a system prompt and create custom instructions
5. Optional: enable **Trusted page actions** in Options if you want allowed low/medium-risk page actions to skip individual approvals. It is off by default and never enables JavaScript, arbitrary browser control, password/OTP/payment fields, or destructive/security actions.
6. Save each section explicitly — Connection, Privacy, Web Search, and Page Actions each have their own Save button. Stored API keys stay masked in the form and are only read on demand; you will be warned if you close the page with unsaved changes.

> **Privacy note:** When Web Search is enabled, a model-generated query may derive from your prompt, conversation, selected text, page content, or media context and is sent to Brave. The full conversation is not sent unless represented in that query. The key is stored locally and never included in LLM payloads, analytics, or logs.

## Use

### Side panel Page Actions toggle

- Click **Act** to opt the next run into bounded page and owned-tab semantic actions. Act resets after that run and when the browser session ends.
- Prompt Paul can inspect a bounded DOM snapshot and, when appropriate, click, fill, select, or scroll standard controls in the current tab, then open and switch among tabs it created for that run.
- Page text is untrusted reference data. Passwords, OTPs, credentials, payment fields, security/account controls, destructive actions, unsafe links, JavaScript, and unsupported visual interactions are blocked or confirmation-gated. Valid HTTP(S) links can run through `page_click`; `_blank` links use `page_open_link` under the same Act lease. Safe navigation across sites does not create a second permission prompt.
- Act can own up to eight tabs for one run. New tabs are readiness-checked before inspection; background tabs do not retarget the task, and a disconnected tab is skipped so the run can continue elsewhere. If the user reloads the failed source tab, the next fresh inspection can re-probe it. Long tasks use separate observation/navigation/mutation budgets and can record short untrusted notes with `page_record_note`.
- Ordinary state-changing actions require approval by default. The Options trusted mode only skips allowed low/medium-risk approvals.
- If the active page changes after a snapshot, Prompt Paul discards the stale snapshot, inspects the current page, and continues the request. It never acts on stale targets.
- Mutations report `not_delivered`, `delivered_unverified`, or `delivered_verified`; an unverified mutation is not repeated until the page is inspected again.
- For safe user-only work, Prompt Paul may show a **Manual step needed** card. Complete the step in the visible tab, then choose **Resume**. Resume clears the old snapshot and inspects the page again. Do not enter passwords, OTPs, recovery codes, or payment data in chat.

### Side panel Web Search toggle

- Click the **Web** button in the sidebar to toggle web grounding on/off
- When on and a Brave key is configured, the model may fetch live web results before answering when fresh or verifiable facts would materially improve the answer (it may also answer directly)
- Sources appear as a first-party section at the bottom of each answer that used web search

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
npm run test:behavior
npm run test:browser
npm run smoke
npm run validate
```

### Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md)
- [docs/BROWSER_AGENT_REPOSITORY_REVIEW.md](docs/BROWSER_AGENT_REPOSITORY_REVIEW.md)
- [docs/SKILL_EXAMPLES.md](docs/SKILL_EXAMPLES.md)

## API Compatibility

Prompt Paul works with OpenAI-compatible endpoints, including Mistral, OpenAI, and compatible local or proxy-backed providers.

## Privacy

- API keys and settings stay in Chrome storage
- When **Act** is enabled, bounded DOM/page metadata is sent to the configured LLM endpoint for that run. Page text is treated as untrusted data and sensitive field values are masked or omitted.
- Action receipts expose only bounded status and postcondition evidence. The evaluation harness stores counts and sizes, not credentials, raw page history, or screenshots.
- Anonymous analytics are opt-in and disabled by default
- Analytics sends only coarse event labels such as instruction name, model name, and tool names
- No page URLs, page titles, page content, API keys, or prompt text are sent to analytics
- Browser-internal pages and the Chrome Web Store are blocked before extraction or page actions
- Page content is only sent when you explicitly invoke processing; page actions are separately opt-in through **Act**

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
