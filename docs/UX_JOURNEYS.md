# UX Journey Validation

This document records the three representative journeys and how each of the
five verification axes is covered after the whole-extension UX refinement.
Walkthroughs are written so they can be replayed in an unpacked Chrome/Edge
build (`npm run build` then Load unpacked on `dist/`).

## Verification axes

1. **No data loss** — storage schemas, profiles, instructions, skills, tools,
   backups, and conversation context survive every flow.
2. **No broken entry paths** — context menus, toolbar action, side panel,
   Options, and website deep links all land in the canonical chat with context.
3. **Theme / responsive behavior** — light, dark, and system themes plus narrow
   side-panel widths render correctly.
4. **Context continuity** — attached context (selection, page, media) persists
   across turns, actions, and recovery (Retry/Edit/Continue).
5. **Capability parity** — skills, web search grounding, voice, presets, custom
   instructions, and tools behave exactly as before the refinement; page actions
   are a separate default-off opt-in.

## Journey 1 — Selected text (context menu + quick actions)

Steps:

1. On a web page, select a sentence and use the context menu
   ("Analyze", "Proofread", "Explain", or a custom instruction).
2. The side panel opens; the selected text appears as a removable chip in the
   composer **context tray**; the **quick-action row** shows
   Analyze / Proofread / Explain.
3. Click **Proofread** — the response streams; the action button shows **Stop**
   while running; the input area carries `data-run-state="streaming"` and
   `aria-busy="true"`.
4. After completion, the response gains inline **Retry / Edit / Continue**
   buttons and the run state becomes `complete`.
5. Click **Continue** — a follow-up is issued against the previous response
   (`previous_response` context), proving context continuity.
6. Click **Edit** — the last prompt is loaded into the composer for editing.
7. Detach the selection via the tray chip; sidebar actions now run as
   conversation follow-ups.

Verification: axes 1 (history intact), 2 (context menu → chat), 3 (theme),
4 (selection persists across actions and recovery), 5 (presets unchanged).

## Journey 2 — Page content (load page + follow-ups)

Steps:

1. Click the sidebar **Page** button (or a bare right-click context-menu item)
   to load the current page.
2. The chat shows the expandable "Content loaded" message; the composer
   **context tray** shows a **Page content** chip with the source URL; the
   quick-action row offers Summary / TL;DR / Technical.
3. Ask a question — the page content is included as structured
   `page_content` context.
4. Run **TL;DR** from the quick-action row — the answer builds on the page
   context from history.
5. Click the tray chip's **Remove** — the page context is detached, the tray
   item disappears, and follow-ups continue without page context.
6. Load a second page — the tray updates to the new page; no stale context
   leaks between pages.

Verification: axes 1 (history preserved while detaching), 3 (tray/labels in
both themes), 4 (page context continuity + clean detach), 5 (page presets).

## Journey 3 — Media attachment (right-click image + deep link)

Steps:

1. Right-click an image → context menu "Analyze image" (or custom instruction).
2. The side panel opens with the media attachment chip in the tray; the
   analysis runs and streams.
3. Paste or drop a second image while a selection exists — both contexts show
   in the tray; sending combines them.
4. From the Options page, click **Open Chat** (Get Started banner) — the
   browser side panel opens in the current window directly from the button
   gesture; the Options page does not open a full-page chat tab.
5. From the website (promptpaul.juanmackie.com, `externally_connectable`),
   send `chrome.runtime.sendMessage(EXTENSION_ID, { action: 'openChat',
context: { selectedText, mediaUrl } })` — the chat opens with the context
   attached; a `textPrompt` instruction runs automatically.
6. Click the toolbar icon — the side panel opens in the current tab.

Verification: axes 1 (media bytes + error paths preserved), 2 (three entry
paths — context menu, Options, website deep link, toolbar), 4 (attachment
continuity), 5 (media analysis unchanged).

## Journey 4 — Current-page semantic action

Steps:

1. Open a normal form or SPA and click the side-panel **Act** toggle; confirm it
   is `aria-pressed="true"` and that the next run is the only run granted page tools.
2. Ask Prompt Paul to inspect the page. It uses `page_get_state` and shows a
   bounded semantic snapshot; page text that contains instructions is treated as
   untrusted data.
3. Ask it to fill a harmless field or click a non-destructive control. The
   target is highlighted and the run shows an approval card; Deny causes no DOM
   event, while Approve executes once and refreshes the snapshot. **Approve all
   this session** enables every policy-allowed mutation for the rest of the
   current run; hard-blocked controls remain unavailable.
4. Change the SPA DOM before the next action. The stale snapshot is rejected and
   Prompt Paul requests a fresh state rather than guessing an index.
5. Enable **Trusted page actions** in Options and repeat a harmless mutation;
   allowed low/medium-risk actions may proceed without a card. Password, OTP,
   payment, security, destructive, navigation, and unsupported controls remain
   blocked or confirmation-gated.
6. Press Stop during approval or execution; the card disables, the run ends, the
   highlight is removed, the Act toggle resets to off, and the next run starts
   cleanly.

Verification: axes 1 (no secret/action leakage), 3 (approval card themes), 4
(snapshot refresh, session approval, and abort cleanup), 5 (Act-off parity and
trusted-mode limits).

## Options surface checks

- **Profile-first connection setup**: the selected connection profile appears before its
  provider-specific fields; saved profiles show their provider and a new connection flow asks for
  the provider before creating the profile.
- **Provider-specific controls**: API profiles show endpoint/key/model controls, Codex profiles show
  sign-in/model controls, and Hermes profiles show gateway/key controls without an unused model
  selector.
- **Setup**: Get Started banner shows "Not connected" until endpoint + key +
  model are set, then "Connected — <model> via <host>".
- **Masked credentials**: after saving a profile, the API key field shows a
  masked placeholder and never contains the raw key; the copy button still
  copies the stored key; saving with the field blank preserves the stored key.
- **Explicit section saves**: Connection, Privacy, Web Search, and Page Actions
  each persist on their own Save button with green flash feedback.
- **Unsaved changes**: editing any field shows the warning banner; navigating
  away triggers the `beforeunload` prompt.
- **Backup**: Full Backup exports all local data (warning discloses API keys);
  Import restores profiles/skills/tools/instructions.

## WCAG AA best-effort checklist

- Focus visibility: `:focus-visible` ring on all interactive elements
  (`--ext-focus-ring`), including chips, tray removes, and recovery buttons.
- Contrast: feedback tokens chosen with AA-compatible foreground/background
  pairs in both themes; muted surfaces use `--ext-muted-foreground`.
- Labels: quick actions and recovery buttons carry `title`/`aria-label`; the
  context tray items use visible text labels; the unsaved banner is
  `aria-live="polite"`.
- State: run states mirror to `aria-busy`; the Web and Act toggles use
  `aria-pressed`; approval cards use `role="alertdialog"` and native buttons.
- Reduced motion: `prefers-reduced-motion` disables pulse animations in
  `ui-primitives.css`.
- Keyboard: skip link targets the composer; all new controls are native
  buttons/inputs (enter/space/tab work without custom key handling).
