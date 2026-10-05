# Chrome Web Store Listing - Prompt Paul

Source of truth for the public Chrome Web Store listing. Update this file whenever the store listing changes, and keep the "What's new" entry aligned with the latest release section in `CHANGELOG.md`.

## Product name

Prompt Paul - AI Insights at the click of a mouse

## Summary (max 132 characters)

Context-aware AI in the browser. Short feedback loops for selected text, without ceremony.

## What's new (version 6.3.0)

Web search now uses a keyless Exa client backed by Exa's hosted MCP endpoint (with optional background-owned `exaSearchApiKey` to lift free-tier rate limits), falling back to Parallel's keyless hosted Search MCP. The provider preference is `exa` (default) or `brave`; stored legacy `duckduckgo` values migrate to `exa` automatically. The Options page Web Search section reflects the new provider selection.

## Next release permission notice (do not publish until release)

The upcoming experimental precise-input option adds Chrome's `debugger` permission. Chrome will ask existing users to review the added permission when the extension updates. The option is off by default and limits debugger use to approved mouse, keyboard, and text input; it does not enable page JavaScript, DOM inspection, screenshots, or network access.

## Description

**Prompt Paul - Context-aware AI in the browser**

Short feedback loops for selected text, without ceremony.

Prompt Paul keeps AI assistance close to the page you are already working on. Select text, load page context, right-click media, or open the side panel and start a focused conversation.

Bring your own model endpoint, including OpenAI-compatible cloud providers, routing services, or local setups. API profiles use an endpoint, API key, and model; Codex uses ChatGPT sign-in; Hermes uses a gateway URL and optional key.

### What it does

**Selected text actions**
Analyze, explain, proofread, summarize, or run a custom instruction against selected text from the context menu or side panel.

**Page-aware chat**
Load the current page into the side panel, ask follow-up questions, and keep the page context attached to the conversation.

**Media-aware prompts**
Work with images, video, and audio when your provider and model support them. Codex connections in this release support text and images; video and audio require a compatible API profile. Right-click media, ask, and get a response. YouTube workflows can include transcript context and visual moments when available.

**A clearer composer**
The composer keeps your working context visible:

- Selected text, media, and page content appear in a context tray
- Context can be detached without clearing the conversation
- Quick actions appear when they are relevant
- Responses include Stop, Retry, Edit, and Continue controls

**Custom instructions**
Save repeatable workflows for emails, meeting notes, captions, research summaries, code explanations, product descriptions, and support replies.

**Tools and Agent Skills**
Use configured custom HTTP tools and OpenClaw-compatible Agent Skills with API-key or Codex connections. Hermes runs use tools owned by the gateway.

**Optional web search**
Enable web search grounding for API-key or Codex connections when current or verifiable information would improve the answer. Responses that use search include a Sources section. The selected model must support function calling.

**Experimental precise input**
Act uses semantic page controls by default. An optional, default-off setting can send approved mouse and keyboard input through Chrome's debugger Input API for pages where synthetic DOM events do not work. Chrome may show a debugger permission warning. The setting does not enable page JavaScript, DOM inspection through CDP, screenshots, or network access.

### Privacy

Prompt Paul stores your configuration locally in Chrome and only sends selected text, page content, media, or instructions when you explicitly ask it to process them.

When you enable Act and submit a task, the selected provider receives a bounded outline of the inspected page, including non-sensitive field values (up to 160 characters per field and 8,000 per snapshot). Password, OTP, payment, credential, hidden and file values remain masked or excluded. Field values are not stored in activity journals or recovery checkpoints.

API keys stay in Chrome storage. Analytics is opt-in and disabled by default; if enabled, it sends coarse event labels and a rotating pseudonymous instance ID, not page content, prompts, keys, or credentials.

No ceremony. Just a short loop from context to answer.
