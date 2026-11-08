# Prompt Paul

Prompt Paul is a Chrome extension for sending selected text or page content to an LLM from the context menu or side panel.

## What It Does

- Process selected text, images, video, and audio from the browser when the configured provider and model support them
- Load page content into a side panel chat
- Attach `.txt` / `.md` / `.csv` / `.json` documents as bounded text context (converted locally, never uploaded as raw files)
- Structured extraction for Reddit threads, GitHub repository/issue pages, and RSS/Atom feed URLs, plus YouTube transcripts
- Composer-led chat: a visible context tray shows every attached context (selection, media, page) with one-click detach, and contextual quick actions (Analyze/Proofread/Explain, page Summary/TL;DR/Technical) sit right above the input
- Inline recovery on every response: Stop, Retry, Edit, Continue
- Choose **Summary cards** or **Compare cards** for attached page, selected text, or document context; read-only cards keep a readable text fallback
- Save custom instructions and quick actions, surfaced as compact pinned prompts in the Top Notch
- Support OpenClaw-compatible Agent Skills
- Use page-aware action cards for sites like YouTube, GitHub, Gmail, and docs
- Opt into guarded natural-language actions on the current page (inspect, click, fill, select, scroll)
- Receive bounded action receipts and safe recovery when a page action is not verified
- Trim loaded content to stay within context limits
- Store settings locally with opt-in analytics that send coarse event labels and a rotating pseudonymous instance ID
- Open the chat from the toolbar icon, context menus, the Options page, or website deep links
- Use an optional browser-viewport edge notch for quick page, selection, chat, and settings actions

## Install

### From source

```bash
git clone https://github.com/juanmackie/Chromeext_PromptPaul.git
cd Chromeext_PromptPaul
npm ci
npm run build:dev
```

1. Open Chrome and go to `chrome://extensions/`
2. Turn on Developer mode
3. Click Load unpacked
4. Select the generated `dist-dev/` directory

## Configure

1. Open the extension Options page
2. Follow the **Get Started** banner. API profiles use an OpenRouter-compatible endpoint, API key, and model. Source checkouts seed the `openrouter/free` model but require your own API key. See [OpenRouter's API keys](https://openrouter.ai/keys) and [free models](https://openrouter.ai/collections/free-models) to get started; free-model quality may vary. You can instead choose **Codex subscription (ChatGPT)** and use **Sign in with ChatGPT**, or choose **Hermes Agent gateway** and enter its gateway URL and optional key. A successful Codex sign-in creates/selects a **Codex** profile, loads available models, and exposes the model-specific thinking level. Codex credentials stay background-owned and are not included in backups. Replace the starter settings with your own connection details, then click **Open Chat** to start in the side panel.
3. Configure Web Search Grounding (optional):
   - Enable the **Web** toggle in the side panel to allow grounding
   - Add a Brave Search API key on the Options page (see [Brave's current plans and terms](https://brave.com/search/api/))
   - When a key is configured and the toggle is on, the model may search the web when current, verifiable, or time-sensitive information would improve the answer - search is a permission, not a mandate, so the model can still answer directly
   - Web grounding is available for API-key and Codex connections. The selected endpoint/model must support function calling; otherwise grounding will be disabled for that request
4. Optionally set a system prompt and create custom instructions
5. Choose **Light**, **Dark**, or **System** in Appearance. System follows your browser or operating system preference.
6. Optional: enable **Trusted page actions** in Options to skip approvals for permitted low/medium-risk non-navigation controls. High-risk actions always ask; hard blocks stay unchanged. Prefer origin-scoped trust from an approval card, or review, block and remove sites under **Act site policies** in Options. Site changes save immediately and generally apply to new runs.
7. Optional: enable **Top Notch** in Options. The notch is off by default, appears only inside supported browser pages, can dock to any viewport edge, and is not an OS-wide overlay.
8. Save section settings explicitly with their Save buttons. Act site-policy add/block/remove controls save their own changes immediately. Stored API keys stay masked; unsaved section changes trigger a close warning.

> **Privacy note:** When Web Search is enabled, a model-generated query may derive from your prompt, conversation, selected text, page content, or media context and is sent to Brave. The full conversation is not sent unless represented in that query. The key is stored locally and never included in LLM payloads, analytics, or logs.

## Use

### Browser-page Top Notch

- Open Options and enable **Top Notch**, then save the section.
- On supported web pages, open the Prompt Paul notch for **Open chat**, **Summarize**, **Explain**, **Dictate**, **Act**, **All actions**, or **Settings**. It rests as a slim pill that reveals details on hover and pins open on click, and it can dock to the top, right, bottom, or left edge of the viewport.
- Saved pinned prompts appear in a compact section, in the order you pinned them. Choose one to run it against the current selection, the current page on a new chat, or the active conversation; up to four are shown so the notch stays focused.
- **Dictate** listens for one instruction and sends it when speech ends, automatically attaching the bounded current page as context (rather than the current selection or prior conversation). **Act** reveals a small task field; submitting it enables the bounded page-action run for that task only.
- While Act performs a page action, the target page gets a temporary blue border glow. The notch follows the saved Light/Dark/System theme preference, including live system-theme changes. Drag its rail along its edge to move it out of the way; its placement and offset are remembered. It uses an isolated Shadow DOM, blends into the chosen edge of the browser page, and does not change page layout.
- Page, selection, pinned-prompt, dictation, and Act task content is sent only after you choose the matching action. Content-script requests are bound to their sender tab and use the existing side-panel chat flow.

### Side panel Page Actions toggle

- Click **Act** to opt the next run into bounded page and owned-tab semantic actions. Act page actions stay enabled for the rest of the browser session until you turn them off; the session-scoped toggle does not reset after a single run.
- Prompt Paul inspects before its first non-Hermes model request. The bounded viewport outline includes nearby text, stable control IDs and safe field values. It supports keyboard, click/double-click, hover, text replacement/append, scalar fields, native/ARIA selection, nested scrolling and open shadow roots. Closed shadow roots, frame content and trusted-input-only controls are not supported in DOM mode yet.
- Page text is untrusted reference data. Passwords, OTPs, credentials, payment fields, security/account controls, destructive actions, unsafe links, JavaScript, and unsupported visual interactions are blocked or confirmation-gated. Act can search bounded page text for exact filters, labels, and prices without scrolling. Valid HTTP(S) links can run through `page_click`; `_blank` links use `page_open_link`, which stays in the current target by default and supports explicit background tabs for multi-page research under the same Act lease. Safe navigation across sites does not create a second permission prompt.
- Act uses a bounded owned-tab lease, readiness checks and separate observation/navigation/mutation budgets (256/96/64). Background tabs do not retarget the task; failed tabs can be re-probed after reload. The model may maintain a checklist (12 steps, 200 characters each, 5 revisions) through `page_update_plan`; completion needs new observed evidence. Notes do not advance steps, and planning never grants consent. Session checkpoints preserve only bounded metadata; explicit Resume starts fresh inspection, never automatic replay.
- Ordinary mutations require approval by default. **Approve similar actions this run** covers permitted low/medium-risk actions only. **Always allow low-risk actions on this site** saves origin-scoped trusted-mode behavior; high-risk actions still ask. Options can block a site before inspection, including redirected destinations. Policies are included in backups; session Act permission is not.
- Enabling Act warns when the selected API model advertises no tools or its support is unknown. Change the model in Options if needed. This check makes no generation request and does not measure model quality.
- If the active page changes after a snapshot, Prompt Paul discards the stale snapshot, inspects the current page, and continues the request. It never acts on stale targets.
- Mutations report `not_delivered`, `delivered_unverified`, or `delivered_verified`; an unverified mutation is not repeated until the page is inspected again. Successful non-navigation mutations may include bounded selector-free scope/diff evidence. When all planner sub-goals resolve, Act performs one final fresh inspection before its summary.
- The final progress card separates response completion from task outcome (`done`, `blocked`, `failed`) and shows bounded runtime reasons such as declined, sign-in required, CAPTCHA, needs confirmation, loop, budget or blocked site. Answer claims are not completion evidence.
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

### Summary and comparison cards

Attach a page, selected text, or text document, then choose **Summary cards** or **Compare cards** from the composer actions. Extra actions appear in the existing overflow menu. The request uses the attached material and your selected provider.

Compatible responses show summary, key/value, and comparison cards. **Read as text** opens the complete readable answer; raw and formatted copy use that answer. If the model returns ordinary text or invalid card data, the readable answer stays available. Reconnecting to a completed run restores bounded text, with the existing partial-response notice if the answer was truncated.

Complete validated blocks can appear while the answer streams. Existing cards keep their disclosure state and table controls as later blocks arrive. Comparison headers sort locally; **Filter rows** and **Reset table** make no provider requests. Interrupted or invalid structured responses remove provisional cards and retain readable text.

**Explain key findings** and **Compare tradeoffs** prefill the composer for review. The context chip identifies the original answer context; cancel it to use the current composer context instead. Only **Send** starts the follow-up, using the originating page, selection, or document and its captured source tab.

Cards are passive display data. They use the existing theme and do not grant page-action permission, invoke tools, or start automatic repair requests. No OpenUI service or new account is required.

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
npm run audit
```

`npm run build:dev` creates the local-only `dist-dev/` diagnostics build. See
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) for the enable, disable, and trace
collection workflow. Production builds are written to `dist/`.

### Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md)
- [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md)
- [Archived project reviews](docs/archive/)
- [docs/SKILL_EXAMPLES.md](docs/SKILL_EXAMPLES.md)

## API Compatibility

Prompt Paul works with OpenAI-compatible endpoints, including Mistral, OpenAI, compatible local or proxy-backed providers, and the official Anthropic API format when the configured endpoint is on Anthropic's API domain.

## Privacy

- API keys and settings stay in Chrome storage
- When **Act** is enabled, bounded DOM/page metadata is sent to the configured LLM endpoint for that run. Non-sensitive field values are limited to 160 characters per field and 8K total; sensitive values stay masked or omitted. Values remain in live model context, not journals or checkpoints. Page text is untrusted data.
- Action receipts expose only bounded status and postcondition evidence. The evaluation harness stores counts and sizes, not credentials, raw page history, or screenshots.
- Analytics are opt-in and disabled by default
- When enabled, analytics sends only coarse event labels such as instruction name, model name, and tool names, plus a rotating pseudonymous instance ID
- No page URLs, page titles, page content, API keys, credentials, or prompt text are sent to analytics
- Browser-internal pages and the Chrome Web Store are blocked before extraction or page actions
- Page content is only sent when you explicitly invoke processing; page actions are separately opt-in through **Act**
- Development diagnostics exist only in the local `dist-dev/` build, are disabled by default, expire after one hour, stay in session storage, and are never sent to analytics or external services

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
