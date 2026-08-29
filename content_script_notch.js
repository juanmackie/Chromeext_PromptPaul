/**
 * @fileoverview Optional top-centered Prompt Paul quick-action notch.
 * @module contentScriptNotch
 */

(() => {
  if (window.top !== window || document.querySelector('[data-prompt-paul-notch-host]')) return;

  const STORAGE_KEY = 'notchEnabled';
  const HOST_ATTRIBUTE = 'data-prompt-paul-notch-host';
  const MAX_SELECTION_CHARS = 20_000;
  const ACTIONS = Object.freeze({
    OPEN_CHAT: 'openChat',
    OPEN_ACTIONS: 'openActions',
    SUMMARIZE_PAGE: 'summarizePage',
    EXPLAIN_SELECTION: 'explainSelection',
    OPEN_OPTIONS: 'openOptions',
  });

  let host = null;
  let shadow = null;
  let expanded = false;
  let selectionListener = null;
  let storageListener = null;
  let documentClickListener = null;
  let keydownListener = null;
  let runtimeListener = null;
  let collapseTimer = null;

  const styleText = `
    :host {
      all: initial;
      position: fixed;
      top: max(0px, env(safe-area-inset-top));
      left: 50%;
      z-index: 2147483640;
      display: block;
      color: #f5f7fa;
      color-scheme: dark;
      font-family: "Geist Mono", "JetBrains Mono", "SF Mono", "Monaco", monospace;
      transform: translateX(-50%);
    }

    * {
      box-sizing: border-box;
    }

    .notch-shell {
      --notch-spring: cubic-bezier(0.34, 1.36, 0.64, 1);
      --notch-surface: rgba(8, 10, 13, 0.97);
      --notch-edge: rgba(255, 255, 255, 0.12);
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 154px;
      pointer-events: none;
      font-family: "Geist Mono", "JetBrains Mono", "SF Mono", "Monaco", monospace;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      line-height: 1.3;
      transition: width 420ms var(--notch-spring);
    }

    .notch-shell[data-expanded='true'] {
      width: min(320px, calc(100vw - 24px));
    }

    .notch-rail,
    .notch-panel {
      pointer-events: auto;
    }

    .notch-rail {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 34px;
      min-height: 34px;
      padding: 4px 6px;
      overflow: visible;
      border: 1px solid var(--notch-edge);
      border-top: 0;
      border-radius: 0 0 19px 23px;
      background: var(--notch-surface);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16), inset 0 1px rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(18px);
      transition: height 420ms var(--notch-spring), border-radius 520ms var(--notch-spring);
    }

    .notch-shell[data-expanded='true'] .notch-rail {
      width: 100%;
      height: 31px;
      min-height: 31px;
      border-radius: 0 0 0 0;
    }

    .notch-toggle,
    .notch-close,
    .notch-action {
      appearance: none;
      border: 0;
      font: inherit;
      cursor: pointer;
    }

    .notch-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 18px;
      padding: 0 4px;
      border-radius: 12px;
      background: transparent;
      color: #f5f7fa;
    }

    .notch-toggle:hover,
    .notch-toggle:focus-visible {
      background: rgba(255, 255, 255, 0.08);
    }

    .notch-toggle:hover .notch-mark,
    .notch-toggle:focus-visible .notch-mark {
      border-color: #0a84ff;
    }

    .notch-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .notch-toggle:focus-visible,
    .notch-close:focus-visible,
    .notch-action:focus-visible {
      outline: 2px solid #0a84ff;
      outline-offset: 2px;
    }

    .notch-toggle-content {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .notch-mark {
      display: grid;
      place-items: center;
      width: 15px;
      height: 15px;
      border: 1px solid rgba(10, 132, 255, 0.78);
      border-radius: 47% 53% 44% 56%;
      color: #6bb6ff;
      font-size: 0;
      line-height: 1;
    }

    .notch-mark::before {
      width: 5px;
      height: 5px;
      content: '';
      border-radius: 46% 54% 58% 42%;
      background: currentColor;
      transform: rotate(-14deg);
    }

    .notch-status {
      width: 4px;
      height: 4px;
      margin: 0;
      border-radius: 50%;
      background: #0a84ff;
      box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.14);
    }

    .notch-panel {
      width: 100%;
      margin: 0;
      padding: 16px;
      border: 1px solid var(--notch-edge);
      border-top: 0;
      border-radius: 0 0 26px 26px;
      background: var(--notch-surface);
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(22px);
    }

    .notch-panel[hidden] {
      display: none;
    }

    .notch-panel.notch-collapsing {
      animation: notch-fold 200ms ease both;
      pointer-events: none;
    }

    .notch-panel:not([hidden]) {
      animation: notch-unfold 480ms var(--notch-spring) both;
    }

    .notch-panel:not([hidden]) .notch-header {
      animation: notch-settle 420ms var(--notch-spring) 40ms both;
    }

    .notch-panel:not([hidden]) .notch-site-row {
      animation: notch-settle 420ms var(--notch-spring) 90ms both;
    }

    .notch-panel:not([hidden]) .notch-action {
      animation: notch-settle 420ms var(--notch-spring) both;
    }

    .notch-panel:not([hidden]) .notch-action:nth-child(1) {
      animation-delay: 120ms;
    }

    .notch-panel:not([hidden]) .notch-action:nth-child(2) {
      animation-delay: 155ms;
    }

    .notch-panel:not([hidden]) .notch-action:nth-child(3) {
      animation-delay: 190ms;
    }

    .notch-panel:not([hidden]) .notch-action:nth-child(4) {
      animation-delay: 225ms;
    }

    .notch-panel:not([hidden]) .notch-action:nth-child(5) {
      animation-delay: 260ms;
    }

    .notch-header,
    .notch-site-row,
    .notch-action-label {
      display: flex;
      align-items: center;
    }

    .notch-header {
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 13px;
    }

    .notch-title {
      display: block;
      color: #f5f7fa;
      font-size: 14px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }

    .notch-kicker {
      display: block;
      margin-top: 2px;
      color: rgba(245, 247, 250, 0.55);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .notch-close {
      display: grid;
      place-items: center;
      width: 27px;
      height: 27px;
      padding: 0;
      border-radius: 8px;
      background: transparent;
      color: rgba(245, 247, 250, 0.6);
      font-size: 18px;
      line-height: 1;
    }

    .notch-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    .notch-site-row {
      gap: 7px;
      min-width: 0;
      margin-bottom: 13px;
      color: rgba(245, 247, 250, 0.58);
      font-size: 11px;
    }

    .notch-site-dot {
      width: 6px;
      height: 6px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: #0a84ff;
    }

    .notch-site {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-actions {
      display: grid;
      gap: 7px;
    }

    .notch-action {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 39px;
      padding: 8px 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.045);
      color: #f5f7fa;
      text-align: left;
      transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    .notch-action:hover:not(:disabled) {
      border-color: rgba(10, 132, 255, 0.6);
      background: rgba(10, 132, 255, 0.12);
      transform: translateX(2px);
    }

    .notch-action:active:not(:disabled) {
      transform: translateX(1px) scale(0.99);
    }

    .notch-action:disabled {
      cursor: not-allowed;
      opacity: 0.38;
    }

    .notch-action-icon {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
      color: #6bb6ff;
    }

    .notch-action-icon svg {
      width: 17px;
      height: 17px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.7;
    }

    .notch-action-copy {
      display: block;
      min-width: 0;
    }

    .notch-action-label {
      gap: 6px;
      color: #f5f7fa;
      font-size: 12px;
      font-weight: 600;
    }

    .notch-action-hint {
      display: block;
      overflow: hidden;
      margin-top: 2px;
      color: rgba(245, 247, 250, 0.52);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-feedback {
      min-height: 15px;
      margin: 10px 2px 0;
      color: rgba(245, 247, 250, 0.56);
      font-size: 10px;
      line-height: 1.35;
    }

    .notch-feedback[data-tone="error"] {
      color: #ffb4ab;
    }

    @media (prefers-reduced-motion: no-preference) {
      .notch-rail {
        animation: notch-breathe 9s ease-in-out infinite;
      }

      .notch-shell[data-expanded='true'] .notch-rail {
        animation: none;
      }
    }

    @keyframes notch-breathe {
      0%,
      100% {
        border-radius: 0 0 19px 23px;
      }
      50% {
        border-radius: 0 0 23px 18px;
      }
    }

    @keyframes notch-unfold {
      from {
        opacity: 0;
        transform: translateY(-14px) scaleY(0.86);
        transform-origin: top center;
      }
      60% {
        opacity: 1;
      }
      to {
        opacity: 1;
        transform: translateY(0) scaleY(1);
        transform-origin: top center;
      }
    }

    @keyframes notch-settle {
      from {
        opacity: 0;
        transform: translateY(-6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes notch-fold {
      from {
        opacity: 1;
        transform: translateY(0) scaleY(1);
        transform-origin: top center;
      }
      to {
        opacity: 0;
        transform: translateY(-12px) scaleY(0.88);
        transform-origin: top center;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .notch-action,
      .notch-panel,
      .notch-panel .notch-header,
      .notch-panel .notch-site-row,
      .notch-panel .notch-action,
      .notch-rail {
        transition: none;
        animation: none;
      }
    }
  `;

  const icons = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M7 10h10M7 13h6"/></svg>',
    page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20Z"/><path d="M14 3.5V8h4M8.5 12h7M8.5 15h5"/></svg>',
    selection:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4H5a1 1 0 0 0-1 1v2M17 4h2a1 1 0 0 1 1 1v2M7 20H5a1 1 0 0 1-1-1v-2M17 20h2a1 1 0 0 0 1-1v-2"/><path d="M8 8h8v8H8z"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.1 1.9 2.2.5.2 2.2 1.7 1.4-1.2 1.9.5 2.2-2 .9-.5 2.2-2.1.5L10 21l-1.1-1.9-2.2-.5-.2-2.2-1.7-1.4 1.2-1.9-.5-2.2 2-.9.5-2.2 2.1-.5Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  };

  function getSelectedText() {
    return String(window.getSelection?.()?.toString() || '')
      .trim()
      .slice(0, MAX_SELECTION_CHARS);
  }

  function siteLabel() {
    return String(location.hostname || 'Current page')
      .replace(/^www\./i, '')
      .slice(0, 120);
  }

  function setFeedback(message, tone = '') {
    const feedback = shadow?.querySelector('.notch-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  function updateSelectionState() {
    const button = shadow?.querySelector('[data-notch-action="explainSelection"]');
    if (!button) return;
    const hasSelection = Boolean(getSelectedText());
    button.disabled = !hasSelection;
    button.querySelector('.notch-action-hint').textContent = hasSelection
      ? 'Use the text currently selected on this page'
      : 'Select text to enable';
  }

  function setExpanded(next) {
    expanded = Boolean(next);
    const shell = shadow?.querySelector('.notch-shell');
    const panel = shadow?.querySelector('.notch-panel');
    const toggle = shadow?.querySelector('.notch-toggle');
    if (!shell || !panel || !toggle) return;
    clearTimeout(collapseTimer);
    collapseTimer = null;
    panel.classList.remove('notch-collapsing');
    if (expanded) {
      shell.dataset.expanded = 'true';
      panel.hidden = false;
    } else if (!panel.hidden) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (reducedMotion) {
        shell.dataset.expanded = 'false';
        panel.hidden = true;
      } else {
        shell.dataset.expanded = 'false';
        panel.classList.add('notch-collapsing');
        collapseTimer = setTimeout(() => {
          panel.classList.remove('notch-collapsing');
          panel.hidden = true;
          collapseTimer = null;
        }, 200);
      }
    }
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.title = expanded ? 'Collapse Prompt Paul notch' : 'Open Prompt Paul notch';
    if (expanded) updateSelectionState();
  }

  function sendAction(notchAction) {
    const payload = { action: 'notchAction', notchAction };
    if (notchAction === ACTIONS.EXPLAIN_SELECTION) payload.selectedText = getSelectedText();
    if (notchAction === ACTIONS.EXPLAIN_SELECTION && !payload.selectedText) {
      setFeedback('Select text first.', 'error');
      updateSelectionState();
      return;
    }

    setFeedback('Opening Prompt Paul…');
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          setFeedback('Prompt Paul could not open. Try the extension icon.', 'error');
          return;
        }
        if (!response?.success) {
          setFeedback(response?.error || 'Action could not be completed.', 'error');
          return;
        }
        setFeedback('');
        if (notchAction !== ACTIONS.OPEN_OPTIONS) setExpanded(false);
      });
    } catch (error) {
      const message = String(error?.message || error);
      setFeedback(
        /extension context invalidated/i.test(message)
          ? 'Reload this page to reconnect Prompt Paul.'
          : 'Prompt Paul could not open. Try the extension icon.',
        'error'
      );
    }
  }

  function destroy() {
    clearTimeout(collapseTimer);
    collapseTimer = null;
    if (selectionListener) document.removeEventListener('selectionchange', selectionListener);
    if (documentClickListener) document.removeEventListener('click', documentClickListener, true);
    if (keydownListener) document.removeEventListener('keydown', keydownListener, true);
    selectionListener = null;
    documentClickListener = null;
    keydownListener = null;
    host?.remove();
    host = null;
    shadow = null;
    expanded = false;
  }

  function mount() {
    if (host || !document.documentElement) return;
    host = document.createElement('div');
    host.setAttribute(HOST_ATTRIBUTE, '');
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${styleText}</style>
      <div class="notch-shell" data-expanded="false">
        <div class="notch-rail">
          <button class="notch-toggle" type="button" aria-expanded="false" aria-controls="notch-panel" title="Open Prompt Paul notch">
            <span class="notch-toggle-content">
              <span class="notch-mark" aria-hidden="true"></span>
              <span class="notch-status" aria-hidden="true"></span>
            </span>
            <span class="notch-sr-only">Open Prompt Paul quick actions</span>
          </button>
        </div>
        <section id="notch-panel" class="notch-panel" role="dialog" aria-label="Prompt Paul quick actions" hidden>
          <div class="notch-header">
            <div>
              <span class="notch-title">Prompt Paul</span>
              <span class="notch-kicker">Quick actions</span>
            </div>
            <button class="notch-close" type="button" title="Collapse notch" aria-label="Collapse notch">×</button>
          </div>
          <div class="notch-site-row">
            <span class="notch-site-dot" aria-hidden="true"></span>
            <span class="notch-site"></span>
          </div>
          <div class="notch-actions" role="toolbar" aria-label="Prompt Paul actions">
            <button class="notch-action" type="button" data-notch-action="openChat">
              <span class="notch-action-icon">${icons.chat}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Open chat</span><span class="notch-action-hint">Ask anything about this page</span></span>
            </button>
            <button class="notch-action" type="button" data-notch-action="openActions">
              <span class="notch-action-icon">${icons.selection}</span>
              <span class="notch-action-copy"><span class="notch-action-label">All actions</span><span class="notch-action-hint">Open the full Prompt Paul action menu</span></span>
            </button>
            <button class="notch-action" type="button" data-notch-action="summarizePage">
              <span class="notch-action-icon">${icons.page}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Summarize page</span><span class="notch-action-hint">Read the current page and summarize it</span></span>
            </button>
            <button class="notch-action" type="button" data-notch-action="explainSelection" disabled>
              <span class="notch-action-icon">${icons.selection}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Explain selection</span><span class="notch-action-hint">Select text to enable</span></span>
            </button>
            <button class="notch-action" type="button" data-notch-action="openOptions">
              <span class="notch-action-icon">${icons.settings}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Settings</span><span class="notch-action-hint">Manage the notch and connections</span></span>
            </button>
          </div>
          <div class="notch-feedback" role="status" aria-live="polite"></div>
        </section>
      </div>
    `;
    document.documentElement.appendChild(host);
    const site = shadow.querySelector('.notch-site');
    if (site) site.textContent = siteLabel();

    shadow.querySelector('.notch-toggle')?.addEventListener('click', () => setExpanded(!expanded));
    shadow.querySelector('.notch-close')?.addEventListener('click', () => setExpanded(false));
    shadow.querySelectorAll('[data-notch-action]').forEach((button) => {
      button.addEventListener('click', () => sendAction(button.dataset.notchAction));
    });

    selectionListener = () => updateSelectionState();
    document.addEventListener('selectionchange', selectionListener);
    documentClickListener = (event) => {
      if (expanded && host && !host.contains(event.target)) setExpanded(false);
    };
    document.addEventListener('click', documentClickListener, true);
    keydownListener = (event) => {
      if (event.key === 'Escape' && expanded) {
        event.preventDefault();
        setExpanded(false);
      }
    };
    document.addEventListener('keydown', keydownListener, true);
    updateSelectionState();
  }

  function applyEnabled(enabled) {
    if (enabled) mount();
    else destroy();
  }

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    applyEnabled(result?.[STORAGE_KEY] === true);
  });

  storageListener = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      applyEnabled(changes[STORAGE_KEY].newValue === true);
    }
  };
  chrome.storage.onChanged.addListener(storageListener);
  runtimeListener = (request) => {
    if (request?.action === 'notchPreferenceChanged') {
      applyEnabled(request.enabled === true);
    }
  };
  chrome.runtime.onMessage.addListener(runtimeListener);
})();
