# UX Journey Validation

This document records the three representative journeys and how each of the
five verification axes is covered after the whole-extension UX refinement.
Walkthroughs are written so they can be replayed in an unpacked Chrome/Edge
build (`npm run build` then Load unpacked on `dist/`).

## Verification axes

1. **No data loss** - storage schemas, profiles, instructions, skills, tools,
   backups, and conversation context survive every flow.
2. **No broken entry paths** - context menus, toolbar action, side panel,
   Options, and website deep links all land in the canonical chat with context.
3. **Theme / responsive behavior** - light, dark, and system themes plus narrow
   side-panel widths render correctly.
4. **Context continuity** - attached context (selection, page, media) persists
   across turns, actions, and recovery (Retry/Edit/Continue).
5. **Capability parity** - skills, web search grounding, voice, presets, custom
   instructions, and tools behave exactly as before the refinement; page actions
   are a separate default-off opt-in.

## Journey 1 - Selected text (context menu + quick actions)

Steps:

1. On a web page, select a sentence and use the context menu
   ("Analyze", "Proofread", "Explain", or a custom instruction).
2. The side panel opens; the selected text appears as a removable chip in the
   composer **context tray**; the **quick-action row** shows
   Analyze / Proofread / Explain.
3. Click **Proofread** - the response streams; the action button shows **Stop**
   while running; the input area carries `data-run-state="streaming"` and
   `aria-busy="true"`.
4. After completion, the response gains inline **Retry / Edit / Continue**
   buttons and the run state becomes `complete`.
5. Click **Continue** - a follow-up is issued against the previous response
   (`previous_response` context), proving context continuity.
6. Click **Edit** - the last prompt is loaded into the composer for editing.
7. Detach the selection via the tray chip; sidebar actions now run as
   conversation follow-ups, and the captured source tab is released so the next
   live selection read follows the active tab.

Verification: axes 1 (history intact), 2 (context menu → chat), 3 (theme),
4 (selection persists across actions and recovery), 5 (presets unchanged).

## Journey 2 - Page content (load page + follow-ups)

Steps:

1. Click the sidebar **Page** button (or a bare right-click context-menu item)
   to load the current page.
2. The chat shows the expandable "Content loaded" message; the composer
   **context tray** shows a **Page content** chip with the source URL; the
   quick-action row offers Summary / TL;DR / Technical.
3. Ask a question - the page content is included as structured
   `page_content` context.
4. Run **TL;DR** from the quick-action row - the answer builds on the page
   context from history.
5. Click the tray chip's **Remove** - the page context is detached, the tray
   item disappears, and follow-ups continue without page context.
6. Load a second page - the tray updates to the new page; no stale context
   leaks between pages.

Verification: axes 1 (history preserved while detaching), 3 (tray/labels in
both themes), 4 (page context continuity + clean detach), 5 (page presets).

## Journey 3 - Media attachment (right-click image + deep link)

Steps:

1. Right-click an image → context menu "Analyze image" (or custom instruction).
2. The side panel opens with the media attachment chip in the tray; the
   analysis runs and streams.
3. Paste or drop a second image while a selection exists - both contexts show
   in the tray; sending combines them.
4. Drop a text document (`.txt`, `.md`, `.markdown`, `.csv`, or `.json`) into
   the panel - it attaches as a named chip in the composer **context tray**
   (filename, truncation status when bounded, Remove) and **no run starts**.
   Sending uses the structured `document` context, never the vision pipeline. A
   second document asks **Replace** or **Keep current**; a failed submission
   keeps the chip for Retry/Edit, and terminal success clears it.
5. From the Options page, click **Open Chat** (Get Started banner) - the
   browser side panel opens in the current window directly from the button
   gesture; the Options page does not open a full-page chat tab.
6. From the website (promptpaul.juanmackie.com, `externally_connectable`),
   send `chrome.runtime.sendMessage(EXTENSION_ID, { action: 'openChat',
context: { selectedText, mediaUrl } })` - the chat opens with the context
   attached; a `textPrompt` instruction runs automatically.
7. Click the toolbar icon - the side panel opens in the current tab.

Verification: axes 1 (media bytes + error paths preserved), 2 (three entry
paths - context menu, Options, website deep link, toolbar), 4 (attachment and
document continuity, no auto-send on drop), 5 (media analysis unchanged).

## Journey 4 - Browser-page Top Notch

Steps:

1. Open Options, leave **Top Notch** off, and confirm no notch appears on a normal web page.
2. Enable the setting and click **Save Notch Settings**. Open pages mount the edge-pinnable notch without changing their layout.
3. The notch rests as a slim pill: hovering it reveals the details panel without pinning, and clicking pins it open so it stays on pointer-leave. Drag the rail along its edge (left/right on top or bottom, up/down on left or right) and confirm it stays within the viewport and keeps its placement and offset after reload. Confirm the compact primary actions, focus ring, Escape-to-close behavior, reduced-motion-safe transitions, and theme-matched Light/Dark/System styling.
4. If custom prompts are pinned, confirm the notch shows them in pin order and caps the visible list at four items. Choose a pinned prompt and confirm it runs against the current selection, current page, or active conversation through the existing chat action flow.
5. Choose **Dictate**, grant microphone access if needed, speak one instruction, and confirm the instruction is sent with the bounded current page as context when dictation ends. Confirm the same page-context behavior works with **Act** enabled.
6. Enable **Act** and confirm its floating task field appears. Submit a harmless page task and confirm the task uses the bounded page-action run path.
7. While the task is changing the page, confirm only the target page shows the temporary on-brand blue border glow. Confirm the glow clears when the action completes, errors, or stops.
8. Use **Summarize**. The background validates the sender tab, bounds the extracted page content, and routes the structured summary request into the side panel.
9. Select text on the page and confirm **Explain** becomes enabled. Run it and confirm the selected text is routed through the existing structured prompt path.
10. Disable and save the setting. Confirm the notch is removed from the open page and does not appear in a new tab.

Verification: axes 1 (preference, placement, and edge offset persist), 2 (notch, pinned, dictated, and Act actions reach canonical chat), 3 (isolated surface and responsive narrow pages), 4 (selection/page/pinned/task context stays bounded), 5 (allowlisted actions, glow lifecycle, and restricted-page boundaries).

## Journey 5 - Current-page semantic action

Steps:

1. Open a normal form or SPA and click the side-panel **Act** toggle; confirm it
   is `aria-pressed="true"` and that page tools stay enabled for the session
   until you turn them off (they do not reset after a single run).
2. Ask Prompt Paul to inspect the page. It uses `page_get_state` and shows a
   bounded semantic snapshot; page text that contains instructions is treated as
   untrusted data.
3. Ask it to fill a harmless field or click a non-destructive control. The
   target is highlighted and the run shows an approval card; Deny causes no DOM
   event, while Approve executes once and refreshes the snapshot. **Approve all
   this session** enables every policy-allowed mutation for the rest of the
   current run; hard-blocked controls remain unavailable.
4. Change the SPA DOM or navigate the active tab before the next action. Prompt
   Paul discards the stale snapshot, inspects the current page, and continues the
   request rather than guessing an index or requiring a new user message. If a
   mutation was interrupted during navigation, it is reported as unverified and
   is not repeated blindly.
5. Enable **Trusted page actions** in Options and repeat a harmless mutation;
   allowed low/medium-risk actions may proceed without a card. Password, OTP,
   payment, security, destructive, navigation, and unsupported controls remain
   blocked or confirmation-gated.
6. Press Stop during approval or execution; the card disables, the run ends, the
   highlight is removed, and the next run starts cleanly. The **Act** toggle stays
   enabled for the session until you turn it off or the browser session ends.
7. When Prompt Paul shows a **Manual step needed** card for a safe user-only
   step, complete the visible consent or sign-in handoff in the active tab
   without sending secrets to chat, then choose **Resume**. Confirm that the old
   snapshot is invalidated and the run performs a fresh inspection before acting.
8. After a mutation, check the activity result: `delivered_verified` includes
   bounded postcondition evidence; `delivered_unverified` stops repeat attempts
   until a fresh inspection; `not_delivered` reports that no supported effect was
   observed. Successful non-navigation mutations may also show bounded
   selector-free scope/diff evidence.
9. Restart the extension worker during an in-flight mutation. Confirm the
   recovery card does not resume automatically, warns that delivery is
   uncertain, and offers **Resume Act** only as an explicit user action. Resume
   starts a fresh run and performs `page_get_state` before any mutation.

Verification: axes 1 (no secret/action leakage), 3 (approval card themes), 4
(snapshot refresh, session approval, manual intervention, receipts, checkpoint
resume, and abort cleanup), 5 (Act-off parity and trusted-mode limits).

## Options surface checks

- **Profile-first connection setup**: the selected connection profile appears before its
  provider-specific fields; saved profiles show their provider and a new connection flow asks for
  the provider before creating the profile.
- **Provider-specific controls**: API profiles show endpoint/key/model controls, Codex profiles show
  sign-in/model controls, and Hermes profiles show gateway/key controls without an unused model
  selector.
- **Setup**: Get Started banner shows "Not connected" until endpoint + key +
  model are set, then "Connected - <model> via <host>".
- **Masked credentials**: after saving a profile, the API key field shows a
  masked placeholder and never contains the raw key; the copy button still
  copies the stored key; saving with the field blank preserves the stored key.
- **Explicit section saves**: Connection, Privacy, Web Search, Page Actions, and Top Notch
  each persist on their own Save button with green flash feedback.
- **Appearance**: choose **Light**, **Dark**, or **System**. System follows the browser or operating
  system preference and updates when that preference changes.
- **Top Notch**: off by default; saving the toggle updates open pages. The notch rests as a slim pill that reveals details on hover, pins open on click, and can dock to any viewport edge; it shows up to four saved pinned prompts.
- **Unsaved changes**: editing any field shows the warning banner; navigating
  away triggers the `beforeunload` prompt.
- **Backup**: Full Backup exports supported persistent settings and restores profiles
  **without** credentials; provider/Codex/Hermes API keys, Hermes keys, and session
  pointers are never included in a backup or the restore file.

## Six Day-1 acceptance journeys

The six release-gate journeys are scripted as real-browser regression in
[`tests/browser/acceptance-journeys.spec.js`](../tests/browser/acceptance-journeys.spec.js);
the deterministic context/test/approval parts are asserted credential-free, and the
natural-language answer bubbles are checked separately against a live provider.

1. **Summarize an article with attached context** - summarize `article.html` and keep the
   bounded page context attached.
2. **Rewrite selected text, retaining surroundings** - select a phrase and rewrite it while
   surrounding text stays intact.
3. **Follow up on an attached document** - drop `notes.md` onto the panel: it
   attaches as a bounded `document`-context tray chip via
   `ChatMedia.prepareDroppedFile` + `ChatComposer` with no provider request and
   no entry into the vision pipeline. The scripted case seeds a local GET-only
   fixture profile, sends, asserts the deterministic failure, and checks that
   the document identity stays bound to the user message with the chip retained
   after the failed submission.
4. **Filter a table and report matching rows** - read-only `page_find_text`-style observation over
   `tables.html` without page mutations.
5. **Fill a harmless form under approval** - a benign input mutation on `form.html` that goes
   through the approval gate.
6. **Compare two pages opened explicitly** - open `plan-a.html` and `plan-b.html` as separate
   owned tabs via explicit multi-page research.

Journey fixtures live in [`tests/browser/fixtures/`](../tests/browser/fixtures/)
(`article.html`, `notes.md`, `tables.html`, `plan-a.html`, `plan-b.html`).

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
  buttons/inputs (enter/space/tab work without custom key handling). The notch closes with Escape and
  exposes a visible focus ring inside its Shadow DOM.
