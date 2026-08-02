// Outlook web selection adapter for Prompt Paul.
// Shows a small in-page button near selected text inside Outlook drafts and opened emails.

(function () {
  const host = window.location.hostname.replace(/^www\./, '').toLowerCase();
  const isOutlookHost =
    host === 'outlook.com' ||
    host.endsWith('.outlook.com') ||
    host === 'outlook.office.com' ||
    host === 'outlook.office365.com' ||
    host === 'outlook.live.com' ||
    host === 'outlook.cloud.microsoft';

  if (!isOutlookHost) {
    return;
  }

  if (window.__PROMPT_PAUL_OUTLOOK_SELECTION__) {
    return;
  }
  window.__PROMPT_PAUL_OUTLOOK_SELECTION__ = true;

  const EDITOR_SELECTOR = [
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="textbox"]',
  ].join(', ');

  const COMPOSE_HINT_SELECTOR = [
    '[aria-label*="compose" i]',
    '[aria-label*="message body" i]',
    '[aria-label*="new message" i]',
    '[aria-label*="reply" i]',
    '[data-testid*="compose" i]',
    '[data-testid*="editor" i]',
    '[data-automationid*="compose" i]',
    '[data-automationid*="editor" i]',
    '[placeholder*="compose" i]',
    '[placeholder*="message" i]',
  ].join(', ');

  const READ_HINT_SELECTOR = [
    'article',
    '[role="article"]',
    '[role="document"]',
    '[aria-label*="message body" i]',
    '[aria-label*="message content" i]',
    '[aria-label*="reading pane" i]',
    '[aria-label*="conversation" i]',
    '[aria-label*="mail body" i]',
    '[data-testid*="messagebody" i]',
    '[data-testid*="message-content" i]',
    '[data-testid*="readingpane" i]',
    '[data-testid*="conversation" i]',
    '[data-automationid*="messagebody" i]',
    '[data-automationid*="message-content" i]',
    '[data-automationid*="readingpane" i]',
    '[data-automationid*="conversation" i]',
  ].join(', ');

  const OUTLOOK_UI_CHROME_SELECTOR = [
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="menu"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="tablist"]',
    '[role="toolbar"]',
    '[role="navigation"]',
    '[role="tree"]',
    '[role="list"]',
    '[role="listitem"]',
    '[role="grid"]',
    '[role="gridcell"]',
    '[contenteditable="false"]',
  ].join(', ');

  const OUTLOOK_SELECTION_RELAY_ACTION = 'prompt-paul-outlook-selection-relay';

  const state = {
    button: null,
    notice: null,
    reloadRequired: false,
    rafId: 0,
    visible: false,
  };

  function getElementFromNode(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) return node;
    return getParentElement(node);
  }

  function getParentElement(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const rootNode = node.getRootNode?.();
    if (rootNode && rootNode.host instanceof Element) {
      return rootNode.host;
    }
    return null;
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  function buildSignalText(element) {
    if (!element) return '';

    return normalizeText(
      [
        element.getAttribute?.('aria-label'),
        element.getAttribute?.('data-testid'),
        element.getAttribute?.('data-automationid'),
        element.getAttribute?.('placeholder'),
        element.getAttribute?.('title'),
        element.getAttribute?.('role'),
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  function flattenSignalText(element) {
    return buildSignalText(element)
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '');
  }

  function findMatchingRoot(startNode, predicate) {
    let current = getElementFromNode(startNode);
    while (current) {
      if (predicate(current)) {
        return current;
      }
      current = getParentElement(current);
    }
    return null;
  }

  function getEditableRoot(node) {
    return findMatchingRoot(node, (element) => element.matches?.(EDITOR_SELECTOR));
  }

  function isLikelyComposeRoot(root) {
    if (!root) return false;

    if (root.matches?.(COMPOSE_HINT_SELECTOR)) {
      return true;
    }

    const labelBits = [
      root.getAttribute?.('aria-label'),
      root.getAttribute?.('data-testid'),
      root.getAttribute?.('data-automationid'),
      root.getAttribute?.('placeholder'),
      root.getAttribute?.('title'),
    ]
      .filter(Boolean)
      .join(' ');

    if (/(compose|message body|new message|reply|forward|draft|editor)/i.test(labelBits)) {
      return true;
    }

    if (root.isContentEditable && root === document.activeElement) {
      return true;
    }

    return Boolean(root.matches?.(EDITOR_SELECTOR));
  }

  function isLikelyReadRoot(root) {
    if (!root) return false;
    if (root.matches?.(EDITOR_SELECTOR)) return false;
    if (root.closest?.(OUTLOOK_UI_CHROME_SELECTOR)) return false;

    if (root.matches?.(READ_HINT_SELECTOR)) {
      return true;
    }

    const flattened = flattenSignalText(root);
    const textLength = normalizeText(root.textContent).length;

    if (textLength < 20) {
      return false;
    }

    if (
      /(?:messagebody|messagecontent|readingpane|conversationview|mailmessage|emailmessage|mailbody|emailbody|threadview|openmessage|currentmessage|messagepane|mailcontent)/.test(
        flattened
      )
    ) {
      return true;
    }

    if (
      root.closest?.('[role="main"], main') &&
      /(?:message|mail|email|conversation|thread|readingpane)/.test(flattened)
    ) {
      return true;
    }

    if (
      root.closest?.('[role="main"], main') &&
      textLength > 60 &&
      !root.closest?.(
        '[role="list"], [role="listitem"], [role="navigation"], [role="toolbar"], [role="tablist"]'
      )
    ) {
      return true;
    }

    return false;
  }

  function getSelectionSurface(selection) {
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    const commonAncestor = selection.getRangeAt(0).commonAncestorContainer;

    const composeRoot =
      getEditableRoot(anchorNode) || getEditableRoot(focusNode) || getEditableRoot(commonAncestor);

    if (composeRoot && isLikelyComposeRoot(composeRoot)) {
      return { mode: 'compose', root: composeRoot };
    }

    const readRoot =
      findMatchingRoot(anchorNode, isLikelyReadRoot) ||
      findMatchingRoot(focusNode, isLikelyReadRoot) ||
      findMatchingRoot(commonAncestor, isLikelyReadRoot);

    if (readRoot) {
      return { mode: 'read', root: readRoot };
    }

    return null;
  }

  function getCurrentSelectionInfo() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const text = String(selection.toString() || '').trim();
    if (!text) {
      return null;
    }

    const surface = getSelectionSurface(selection);
    if (!surface?.root) {
      return null;
    }

    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      const clientRects = range.getClientRects();
      if (clientRects.length > 0) {
        rect = clientRects[0];
      }
    }

    if (!rect || (!rect.width && !rect.height)) {
      return null;
    }

    return { text, rect, mode: surface.mode };
  }

  function ensureButton() {
    if (state.button) {
      return state.button;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Prompt Paul';
    button.title = 'Send selected text to Prompt Paul';
    button.setAttribute('aria-label', 'Send selected text to Prompt Paul');
    button.style.position = 'fixed';
    button.style.zIndex = '2147483647';
    button.style.display = 'none';
    button.style.visibility = 'hidden';
    button.style.border = '1px solid rgba(43, 48, 58, 0.16)';
    button.style.borderRadius = '999px';
    button.style.background = '#ffffff';
    button.style.color = '#111827';
    button.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.16)';
    button.style.font = '600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    button.style.letterSpacing = '0';
    button.style.padding = '8px 12px';
    button.style.cursor = 'pointer';
    button.style.whiteSpace = 'nowrap';
    button.style.userSelect = 'none';
    button.style.webkitUserSelect = 'none';
    button.style.pointerEvents = 'auto';

    button.addEventListener(
      'mousedown',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const info = getCurrentSelectionInfo();
      if (!info) {
        hideButton();
        return;
      }

      relaySelectionToExtension(info.text);
      hideButton();
    });

    document.documentElement.appendChild(button);
    state.button = button;
    return button;
  }

  function ensureNotice() {
    if (state.notice) {
      return state.notice;
    }

    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.textContent = 'Prompt Paul was updated. Refresh Outlook to reconnect.';
    notice.style.position = 'fixed';
    notice.style.zIndex = '2147483647';
    notice.style.right = '16px';
    notice.style.bottom = '16px';
    notice.style.maxWidth = '320px';
    notice.style.border = '1px solid rgba(43, 48, 58, 0.16)';
    notice.style.borderRadius = '8px';
    notice.style.background = '#ffffff';
    notice.style.color = '#111827';
    notice.style.boxShadow = '0 10px 28px rgba(15, 23, 42, 0.18)';
    notice.style.font = '600 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    notice.style.letterSpacing = '0';
    notice.style.padding = '10px 12px';
    notice.style.display = 'none';
    notice.style.pointerEvents = 'none';

    document.documentElement.appendChild(notice);
    state.notice = notice;
    return notice;
  }

  function showReconnectNotice() {
    const notice = ensureNotice();
    notice.style.display = 'block';
    state.reloadRequired = true;
    if (state.button) {
      state.button.disabled = true;
      state.button.style.opacity = '0.65';
      state.button.style.cursor = 'not-allowed';
    }
    window.setTimeout(() => {
      if (state.notice) {
        state.notice.style.display = 'none';
      }
    }, 6000);
  }

  // True only while this content script still has a live connection to the
  // extension. After the extension is reloaded/updated/disabled, `chrome.runtime`
  // (and its `id`) become undefined in the already-injected script.
  function isExtensionContextAvailable() {
    return Boolean(globalThis.chrome?.runtime?.id);
  }

  function isExtensionContextError(error) {
    const message = String(error?.message || error || '');
    // Two faces of the same failure: the explicit invalidation message, and the
    // TypeError thrown when `chrome.runtime` itself has gone undefined.
    return /extension context invalidated/i.test(message) || /reading 'sendMessage'/i.test(message);
  }

  function sendSelectionToExtension(selectedText) {
    if (state.reloadRequired) {
      showReconnectNotice();
      return;
    }

    // Detect a torn-down context up front so we surface the reconnect notice
    // instead of throwing a raw TypeError on `chrome.runtime.sendMessage`.
    if (!isExtensionContextAvailable()) {
      showReconnectNotice();
      return;
    }

    try {
      chrome.runtime.sendMessage(
        {
          action: 'openPromptPaulFromSelection',
          selectedText,
        },
        () => {
          if (chrome.runtime.lastError) {
            if (isExtensionContextError(chrome.runtime.lastError)) {
              showReconnectNotice();
              return;
            }

            console.warn(
              'PromptPaul: Outlook selection handoff warning:',
              chrome.runtime.lastError.message
            );
          }
        }
      );
    } catch (error) {
      if (isExtensionContextError(error)) {
        showReconnectNotice();
        return;
      }

      console.warn('PromptPaul: Failed to forward Outlook selection:', error);
    }
  }

  function relaySelectionToExtension(selectedText) {
    const trimmedText = String(selectedText || '').trim();
    if (!trimmedText) {
      return;
    }

    if (state.reloadRequired) {
      showReconnectNotice();
      return;
    }

    if (window.top === window) {
      sendSelectionToExtension(trimmedText);
      return;
    }

    try {
      window.top.postMessage(
        {
          action: OUTLOOK_SELECTION_RELAY_ACTION,
          selectedText: trimmedText,
        },
        window.location.origin
      );
    } catch (error) {
      console.warn('PromptPaul: Failed to relay Outlook selection to top window:', error);
    }
  }

  function isAllowedRelayOrigin(origin) {
    if (!origin || origin === 'null') return false;
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      return (
        host === 'outlook.com' ||
        host.endsWith('.outlook.com') ||
        host === 'outlook.office.com' ||
        host === 'outlook.office365.com' ||
        host === 'outlook.live.com' ||
        host === 'outlook.cloud.microsoft'
      );
    } catch (_) {
      return false;
    }
  }

  function handleRelayMessage(event) {
    if (event.source === window || !isAllowedRelayOrigin(event.origin)) {
      return;
    }

    const data = event.data;
    if (!data || data.action !== OUTLOOK_SELECTION_RELAY_ACTION) {
      return;
    }

    const selectedText = String(data.selectedText || '').trim();
    if (!selectedText) {
      return;
    }

    if (state.reloadRequired) {
      showReconnectNotice();
      return;
    }

    sendSelectionToExtension(selectedText);
  }

  if (window.top === window) {
    window.addEventListener('message', handleRelayMessage, true);
  }

  function hideButton() {
    if (!state.button) {
      return;
    }

    state.button.style.display = 'none';
    state.button.style.visibility = 'hidden';
    state.visible = false;
  }

  function positionButton(rect) {
    const button = ensureButton();
    button.style.display = 'block';
    button.style.visibility = 'hidden';

    const width = button.getBoundingClientRect().width || 120;
    const height = button.getBoundingClientRect().height || 32;
    const gap = 10;
    const viewportPadding = 8;

    const aboveTop = rect.top - height - gap;
    const belowTop = rect.bottom + gap;
    const top = aboveTop >= viewportPadding ? aboveTop : belowTop;
    const clampedTop = Math.max(
      viewportPadding,
      Math.min(top, window.innerHeight - height - viewportPadding)
    );
    const clampedLeft = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - width - viewportPadding)
    );

    button.style.top = `${Math.round(clampedTop)}px`;
    button.style.left = `${Math.round(clampedLeft)}px`;
    button.style.visibility = 'visible';
    state.visible = true;
  }

  function refreshButton() {
    state.rafId = 0;
    const info = getCurrentSelectionInfo();
    if (!info) {
      hideButton();
      return;
    }

    positionButton(info.rect);
  }

  function scheduleRefresh() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
    }
    state.rafId = requestAnimationFrame(refreshButton);
  }

  function isEventInsideButton(event) {
    return Boolean(state.button && event.target && state.button.contains(event.target));
  }

  document.addEventListener('selectionchange', scheduleRefresh, true);
  document.addEventListener('mouseup', scheduleRefresh, true);
  document.addEventListener('keyup', scheduleRefresh, true);
  document.addEventListener(
    'mousedown',
    (event) => {
      if (!state.visible) {
        return;
      }
      if (isEventInsideButton(event)) {
        return;
      }
      scheduleRefresh();
    },
    true
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        hideButton();
      }
    },
    true
  );
  document.addEventListener('scroll', scheduleRefresh, true);
  window.addEventListener('resize', scheduleRefresh, true);
  window.addEventListener('blur', hideButton, true);

  console.log('PromptPaul: Outlook selection adapter loaded.');
})();
