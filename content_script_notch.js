/**
 * @fileoverview Optional top-centered Prompt Paul quick-action notch.
 * @module contentScriptNotch
 */

(() => {
  if (window.top !== window || document.querySelector('[data-prompt-paul-notch-host]')) return;

  const STORAGE_KEY = 'notchEnabled';
  const THEME_PREFERENCE_KEY = 'themePreference';
  const LEGACY_DARK_THEME_KEY = 'darkTheme';
  const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';
  const PINNED_ACTIONS_KEY = 'pinnedQuickActions';
  const INSTRUCTIONS_KEY = 'instructions';
  const HOST_ATTRIBUTE = 'data-prompt-paul-notch-host';
  const ACT_GLOW_HOST_ATTRIBUTE = 'data-prompt-paul-act-glow';
  const ACT_GLOW_STYLE = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483639;
      display: block;
      pointer-events: none;
    }

    .act-glow-frame {
      position: absolute;
      inset: 4px;
      border: 3px solid rgba(10, 132, 255, 0.78);
      border-radius: 10px;
      box-shadow:
        0 0 0 1px rgba(10, 132, 255, 0.34),
        0 0 12px rgba(10, 132, 255, 0.64),
        0 0 30px rgba(10, 132, 255, 0.28),
        inset 0 0 14px rgba(10, 132, 255, 0.2);
      animation: act-glow-pulse 1.8s ease-in-out infinite;
    }

    @keyframes act-glow-pulse {
      0%,
      100% {
        opacity: 0.76;
      }
      50% {
        opacity: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .act-glow-frame {
        animation: none;
      }
    }
  `;
  const MAX_SELECTION_CHARS = 20_000;
  const MAX_PINNED_ACTIONS = 4;
  const ACTIONS = Object.freeze({
    OPEN_CHAT: 'openChat',
    OPEN_ACTIONS: 'openActions',
    SUMMARIZE_PAGE: 'summarizePage',
    EXPLAIN_SELECTION: 'explainSelection',
    RUN_PINNED_INSTRUCTION: 'runPinnedInstruction',
    SEND_INSTRUCTION: 'sendInstruction',
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
  let glowHost = null;
  let glowRunId = null;
  let actEnabled = false;
  let dictationRecognition = null;
  let dictationListening = false;
  let dictationFinalText = '';
  let dictationHadError = false;
  let themePreference = 'light';
  const systemThemeMediaQuery = window.matchMedia?.(SYSTEM_THEME_QUERY) || null;

  const styleText = `
    :host {
      all: initial;
      position: fixed;
      top: max(0px, env(safe-area-inset-top));
      left: 50%;
      z-index: 2147483640;
      display: block;
      font-family: "Geist Mono", "JetBrains Mono", "SF Mono", "Monaco", monospace;
      transform: translateX(-50%);
    }

    * {
      box-sizing: border-box;
    }

    .notch-shell {
      --notch-spring: cubic-bezier(0.34, 1.36, 0.64, 1);
      --notch-surface: rgba(10, 12, 16, 0.96);
      --notch-surface-deep: rgba(14, 16, 21, 0.98);
      --notch-surface-top: rgba(5, 7, 10, 0.98);
      --notch-surface-raised: rgba(25, 28, 35, 0.78);
      --notch-surface-hover: rgba(255, 255, 255, 0.08);
      --notch-edge: rgba(255, 255, 255, 0.12);
      --notch-edge-soft: rgba(255, 255, 255, 0.08);
      --notch-ink: #f5f7fa;
      --notch-ink-strong: #ffffff;
      --notch-ink-muted: rgba(245, 247, 250, 0.82);
      --notch-ink-subtle: rgba(245, 247, 250, 0.58);
      --notch-ink-faint: rgba(245, 247, 250, 0.4);
      --notch-brand: #818cf8;
      --notch-brand-bright: #a5b4fc;
      --notch-brand-soft: rgba(129, 140, 248, 0.14);
      --notch-brand-border: rgba(129, 140, 248, 0.68);
      --notch-brand-border-soft: rgba(129, 140, 248, 0.5);
      --notch-brand-foreground: #ffffff;
      --notch-surface-pinned: rgba(255, 255, 255, 0.04);
      --notch-shadow: rgba(0, 0, 0, 0.3);
      --notch-shadow-soft: rgba(0, 0, 0, 0.16);
      --notch-error: #ffb4ab;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 184px;
      pointer-events: none;
      color: var(--notch-ink);
      color-scheme: dark;
      font-family: "Geist Mono", "JetBrains Mono", "SF Mono", "Monaco", monospace;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      line-height: 1.3;
      transition: width 420ms var(--notch-spring);
    }

    .notch-shell[data-theme='light'] {
      --notch-surface: rgba(255, 255, 255, 0.98);
      --notch-surface-deep: rgba(248, 248, 252, 0.98);
      --notch-surface-top: rgba(248, 247, 252, 0.98);
      --notch-surface-raised: rgba(245, 244, 251, 0.92);
      --notch-surface-hover: rgba(80, 70, 229, 0.08);
      --notch-edge: rgba(67, 56, 202, 0.2);
      --notch-edge-soft: rgba(67, 56, 202, 0.12);
      --notch-ink: #1a1a2e;
      --notch-ink-strong: #1a1a2e;
      --notch-ink-muted: rgba(26, 26, 46, 0.82);
      --notch-ink-subtle: rgba(26, 26, 46, 0.58);
      --notch-ink-faint: rgba(26, 26, 46, 0.42);
      --notch-brand: #5046e5;
      --notch-brand-bright: #6366f1;
      --notch-brand-soft: rgba(80, 70, 229, 0.12);
      --notch-brand-border: rgba(80, 70, 229, 0.5);
      --notch-brand-border-soft: rgba(80, 70, 229, 0.35);
      --notch-brand-foreground: #ffffff;
      --notch-surface-pinned: rgba(80, 70, 229, 0.05);
      --notch-shadow: rgba(31, 25, 79, 0.2);
      --notch-shadow-soft: rgba(31, 25, 79, 0.12);
      --notch-error: #b42318;
      color-scheme: light;
    }

    .notch-shell[data-theme='dark'] {
      color-scheme: dark;
    }

    .notch-shell[data-expanded='true'] {
      width: min(360px, calc(100vw - 20px));
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
      height: 31px;
      min-height: 31px;
      padding: 3px 7px 4px;
      overflow: visible;
      border: 1px solid var(--notch-edge);
      border-top: 0;
      border-radius: 0 0 16px 16px;
      background: linear-gradient(180deg, var(--notch-surface-top), var(--notch-surface));
      box-shadow: 0 7px 22px var(--notch-shadow-soft), inset 0 1px var(--notch-edge-soft);
      backdrop-filter: blur(20px) saturate(1.25);
      transition: height 420ms var(--notch-spring), border-radius 520ms var(--notch-spring),
        box-shadow 220ms ease;
    }

    .notch-shell[data-expanded='true'] .notch-rail {
      width: 100%;
      height: 29px;
      min-height: 29px;
      border-color: transparent;
      border-radius: 0;
      box-shadow: inset 0 -1px var(--notch-edge-soft);
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
      color: var(--notch-ink);
    }

    .notch-toggle:hover,
    .notch-toggle:focus-visible {
      background: var(--notch-surface-hover);
    }

    .notch-toggle:hover .notch-mark,
    .notch-toggle:focus-visible .notch-mark {
      border-color: var(--notch-brand);
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
      outline: 2px solid var(--notch-brand);
      outline-offset: 2px;
    }

    .notch-toggle-content {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      width: 100%;
    }

    .notch-toggle-name {
      color: var(--notch-ink-muted);
      font-size: 10px;
      font-weight: 650;
      letter-spacing: 0.015em;
    }

    .notch-mark {
      display: grid;
      place-items: center;
      width: 15px;
      height: 15px;
      border: 1px solid var(--notch-brand-border);
      border-radius: 47% 53% 44% 56%;
      color: var(--notch-brand-bright);
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
      background: var(--notch-brand);
      box-shadow: 0 0 0 3px var(--notch-brand-soft);
    }

    .notch-panel {
      width: 100%;
      margin: 0;
      padding: 13px;
      border: 1px solid var(--notch-edge);
      border-top: 0;
      border-radius: 0 0 20px 20px;
      background: linear-gradient(180deg, var(--notch-surface), var(--notch-surface-deep));
      box-shadow: 0 18px 44px var(--notch-shadow);
      backdrop-filter: blur(24px) saturate(1.2);
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
      margin-bottom: 10px;
    }

    .notch-title {
      display: block;
      color: var(--notch-ink);
      font-size: 14px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }

    .notch-kicker {
      display: block;
      margin-top: 2px;
      color: var(--notch-ink-subtle);
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
      color: var(--notch-ink-subtle);
      font-size: 18px;
      line-height: 1;
    }

    .notch-close:hover {
      background: var(--notch-surface-hover);
      color: var(--notch-ink-strong);
    }

    .notch-site-row {
      gap: 7px;
      min-width: 0;
      margin-bottom: 10px;
      color: var(--notch-ink-subtle);
      font-size: 10px;
    }

    .notch-site-dot {
      width: 6px;
      height: 6px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--notch-brand);
    }

    .notch-site {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-actions {
      display: grid;
      gap: 6px;
    }

    .notch-primary-actions {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .notch-action {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 35px;
      padding: 7px 8px;
      border: 1px solid var(--notch-edge);
      border-radius: 9px;
      background: var(--notch-surface-raised);
      color: var(--notch-ink);
      text-align: left;
      transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    .notch-primary-actions .notch-action {
      min-height: 54px;
      flex-direction: column;
      justify-content: center;
      gap: 5px;
      padding: 7px 4px;
      text-align: center;
    }

    .notch-primary-actions .notch-action-copy {
      width: 100%;
    }

    .notch-primary-actions .notch-action-label {
      justify-content: center;
      overflow: hidden;
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-utility-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-top: 6px;
    }

    .notch-utility-action {
      justify-content: center;
      min-height: 34px;
      padding: 6px 8px;
    }

    .notch-utility-action .notch-action-icon {
      width: 18px;
      height: 18px;
    }

    .notch-utility-action .notch-action-label {
      font-size: 10px;
    }

    .notch-utility-action.notch-dictation-active,
    .notch-utility-action.notch-act-enabled {
      border-color: var(--notch-brand-border);
      background: var(--notch-brand-soft);
      color: var(--notch-ink-strong);
    }

    .notch-act-form {
      display: flex;
      gap: 6px;
      margin-top: 7px;
      padding: 5px;
      border: 1px solid var(--notch-brand-border-soft);
      border-radius: 10px;
      background: var(--notch-surface-top);
      box-shadow: 0 0 16px var(--notch-brand-soft);
    }

    .notch-act-form[hidden] {
      display: none;
    }

    .notch-act-input {
      min-width: 0;
      flex: 1 1 auto;
      height: 31px;
      padding: 0 8px;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--notch-ink);
      font: inherit;
      font-size: 11px;
    }

    .notch-act-input::placeholder {
      color: var(--notch-ink-faint);
    }

    .notch-act-submit {
      display: grid;
      place-items: center;
      width: 31px;
      height: 31px;
      flex: 0 0 auto;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: var(--notch-brand);
      color: var(--notch-brand-foreground);
      cursor: pointer;
    }

    .notch-act-submit:hover {
      background: var(--notch-brand-bright);
    }

    .notch-act-submit .notch-action-icon {
      width: 17px;
      height: 17px;
    }

    .notch-secondary-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--notch-edge-soft);
    }

    .notch-secondary-actions .notch-action {
      justify-content: center;
      min-height: 32px;
      padding: 6px 8px;
      text-align: center;
    }

    .notch-action:hover:not(:disabled) {
      border-color: var(--notch-brand-border);
      background: var(--notch-brand-soft);
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
      width: 21px;
      height: 21px;
      flex: 0 0 auto;
      color: var(--notch-brand-bright);
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
      color: var(--notch-ink);
      font-size: 11px;
      font-weight: 600;
    }

    .notch-action-hint {
      display: none;
      overflow: hidden;
      margin-top: 2px;
      color: var(--notch-ink-subtle);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-action:disabled .notch-action-hint {
      display: block;
    }

    .notch-pinned-section {
      margin-top: 11px;
      padding-top: 10px;
      border-top: 1px solid var(--notch-edge-soft);
    }

    .notch-pinned-section[hidden] {
      display: none;
    }

    .notch-section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0 2px 6px;
      color: var(--notch-ink-subtle);
      font-size: 9px;
      font-weight: 650;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .notch-section-count {
      color: var(--notch-ink-faint);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.03em;
    }

    .notch-pinned-actions {
      max-height: 166px;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .notch-pinned-action {
      min-height: 34px;
      padding: 6px 8px;
      background: var(--notch-surface-pinned);
    }

    .notch-pinned-action .notch-action-icon {
      width: 19px;
      height: 19px;
      color: var(--notch-brand-bright);
    }

    .notch-pinned-more {
      margin: 6px 2px 0;
      color: var(--notch-ink-faint);
      font-size: 9px;
    }

    .notch-feedback {
      min-height: 15px;
      margin: 10px 2px 0;
      color: var(--notch-ink-subtle);
      font-size: 10px;
      line-height: 1.35;
    }

    .notch-feedback[data-tone="error"] {
      color: var(--notch-error);
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
      .notch-shell,
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

  function normalizeThemePreference(preference, legacyDarkTheme = false) {
    if (['light', 'dark', 'system'].includes(preference)) return preference;
    return legacyDarkTheme === true ? 'dark' : 'light';
  }

  function applyThemePreference(preference, legacyDarkTheme = false) {
    themePreference = normalizeThemePreference(preference, legacyDarkTheme);
    const isDark =
      themePreference === 'dark' ||
      (themePreference === 'system' && Boolean(systemThemeMediaQuery?.matches));
    const shell = shadow?.querySelector('.notch-shell');
    if (!shell) return;
    shell.dataset.themePreference = themePreference;
    shell.dataset.theme = isDark ? 'dark' : 'light';
  }

  function loadThemePreference() {
    try {
      chrome.storage.sync.get(
        { [THEME_PREFERENCE_KEY]: '', [LEGACY_DARK_THEME_KEY]: false },
        (result) => {
          if (chrome.runtime.lastError) return;
          applyThemePreference(result?.[THEME_PREFERENCE_KEY], result?.[LEGACY_DARK_THEME_KEY]);
        }
      );
    } catch (_) {
      // Keep the light fallback if sync storage is unavailable.
    }
  }

  function handleSystemThemeChange() {
    if (themePreference === 'system') applyThemePreference('system');
  }

  if (systemThemeMediaQuery?.addEventListener) {
    systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
  } else if (systemThemeMediaQuery?.addListener) {
    systemThemeMediaQuery.addListener(handleSystemThemeChange);
  }

  const icons = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M7 10h10M7 13h6"/></svg>',
    page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20Z"/><path d="M14 3.5V8h4M8.5 12h7M8.5 15h5"/></svg>',
    selection:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4H5a1 1 0 0 0-1 1v2M17 4h2a1 1 0 0 1 1 1v2M7 20H5a1 1 0 0 1-1-1v-2M17 20h2a1 1 0 0 0 1-1v-2"/><path d="M8 8h8v8H8z"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.1 1.9 2.2.5.2 2.2 1.7 1.4-1.2 1.9.5 2.2-2 .9-.5 2.2-2.1.5L10 21l-1.1-1.9-2.2-.5-.2-2.2-1.7-1.4 1.2-1.9-.5-2.2 2-.9.5-2.2 2.1-.5Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6"/></svg>',
    act: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 4 14 3.5-5L18 18l2-2-5.5-6L20 8 5 3Z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 5 16 7-16 7 3-7-3-7Z"/><path d="M7 12h13"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 0 1.5 5-2.5 2.5v3H9v-3L6.5 9 8 4Z"/><path d="M12 14.5V21"/></svg>',
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

  function setActGlow(active, runId) {
    const nextRunId = String(runId || '');
    if (!active) {
      if (glowRunId && nextRunId && glowRunId !== nextRunId) return;
      glowHost?.remove();
      glowHost = null;
      glowRunId = null;
      return;
    }
    if (!nextRunId) return;
    if (!glowHost) {
      glowHost = document.createElement('div');
      glowHost.setAttribute(ACT_GLOW_HOST_ATTRIBUTE, '');
      glowHost.setAttribute('aria-hidden', 'true');
      const glowShadow = glowHost.attachShadow({ mode: 'open' });
      glowShadow.innerHTML = `<style>${ACT_GLOW_STYLE}</style><div class="act-glow-frame" aria-hidden="true"></div>`;
      document.documentElement.appendChild(glowHost);
    }
    glowRunId = nextRunId;
  }

  function readPinnedActions() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([PINNED_ACTIONS_KEY, INSTRUCTIONS_KEY], (result) => {
          if (chrome.runtime.lastError) {
            resolve({ items: [], total: 0 });
            return;
          }

          const pinnedIds = Array.isArray(result?.[PINNED_ACTIONS_KEY])
            ? result[PINNED_ACTIONS_KEY]
            : [];
          const instructions = Array.isArray(result?.[INSTRUCTIONS_KEY])
            ? result[INSTRUCTIONS_KEY]
            : [];
          const byId = new Map(
            instructions.map((instruction) => [String(instruction?.id || '').trim(), instruction])
          );
          const seen = new Set();
          const items = [];

          for (const rawId of pinnedIds) {
            const id = String(rawId || '').trim();
            const instruction = byId.get(id);
            if (!id || !instruction || seen.has(id)) continue;
            seen.add(id);
            items.push({
              id,
              label: String(instruction.name || 'Untitled prompt')
                .trim()
                .slice(0, 80),
            });
          }

          resolve({ items: items.slice(0, MAX_PINNED_ACTIONS), total: items.length });
        });
      } catch (_) {
        resolve({ items: [], total: 0 });
      }
    });
  }

  function createPinnedAction(item) {
    const button = document.createElement('button');
    button.className = 'notch-action notch-pinned-action';
    button.type = 'button';
    button.dataset.notchAction = ACTIONS.RUN_PINNED_INSTRUCTION;
    button.dataset.instructionId = item.id;
    button.title = item.label;

    const icon = document.createElement('span');
    icon.className = 'notch-action-icon';
    icon.innerHTML = icons.pin;

    const copy = document.createElement('span');
    copy.className = 'notch-action-copy';
    const label = document.createElement('span');
    label.className = 'notch-action-label';
    label.textContent = item.label || 'Untitled prompt';
    copy.appendChild(label);
    button.append(icon, copy);
    button.addEventListener('click', () =>
      sendAction(ACTIONS.RUN_PINNED_INSTRUCTION, { instructionId: item.id })
    );
    return button;
  }

  async function renderPinnedActions() {
    const section = shadow?.querySelector('.notch-pinned-section');
    const container = shadow?.querySelector('.notch-pinned-actions');
    const count = shadow?.querySelector('.notch-section-count');
    const more = shadow?.querySelector('.notch-pinned-more');
    if (!section || !container) return;

    const { items, total } = await readPinnedActions();
    if (!shadow || !section.isConnected) return;
    container.replaceChildren(...items.map(createPinnedAction));
    section.hidden = items.length === 0;
    if (count) count.textContent = String(total);
    if (more) {
      more.hidden = total <= items.length;
      more.textContent = more.hidden ? '' : `+ ${total - items.length} more in All actions`;
    }
  }

  function updateActModeUI() {
    const toggle = shadow?.querySelector('.notch-act-toggle');
    const form = shadow?.querySelector('.notch-act-form');
    const input = shadow?.querySelector('.notch-act-input');
    if (!toggle || !form) return;

    toggle.setAttribute('aria-pressed', String(actEnabled));
    toggle.title = actEnabled ? 'Turn off Act mode' : 'Enable Act mode';
    toggle.classList.toggle('notch-act-enabled', actEnabled);
    form.hidden = !actEnabled;
    if (!actEnabled && input) input.value = '';
  }

  function setActEnabled(next) {
    actEnabled = Boolean(next);
    updateActModeUI();
    if (actEnabled) shadow?.querySelector('.notch-act-input')?.focus();
  }

  function updateDictationUI() {
    const button = shadow?.querySelector('.notch-dictation-action');
    const icon = button?.querySelector('.notch-action-icon');
    const label = button?.querySelector('.notch-action-label');
    if (!button || !icon || !label) return;

    button.classList.toggle('notch-dictation-active', dictationListening);
    button.setAttribute('aria-pressed', String(dictationListening));
    button.title = dictationListening ? 'Stop dictation' : 'Dictate an instruction';
    icon.innerHTML = dictationListening ? icons.send : icons.mic;
    label.textContent = dictationListening ? 'Send' : 'Dictate';
  }

  function cancelDictation() {
    const recognition = dictationRecognition;
    dictationRecognition = null;
    dictationListening = false;
    dictationFinalText = '';
    dictationHadError = false;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try {
        recognition.stop();
      } catch (_) {
        // The recognition may already be stopping.
      }
    }
    updateDictationUI();
  }

  function startDictation() {
    if (dictationListening) {
      dictationRecognition?.stop();
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setFeedback('Dictation is not available in this browser.', 'error');
      return;
    }

    const recognition = new Recognition();
    dictationRecognition = recognition;
    dictationListening = true;
    dictationFinalText = '';
    dictationHadError = false;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = navigator.language || 'en-US';
    updateDictationUI();
    setFeedback('Listening…');

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = String(event.results[index][0]?.transcript || '');
        if (event.results[index].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      dictationFinalText = `${dictationFinalText} ${finalText}`.trim();
      const preview = `${dictationFinalText} ${interimText}`.trim();
      const input = shadow?.querySelector('.notch-act-input');
      if (input && actEnabled) input.value = preview;
      setFeedback(preview ? `Listening: ${preview}` : 'Listening…');
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        dictationHadError = true;
        setFeedback(
          event.error === 'not-allowed'
            ? 'Microphone permission is required for dictation.'
            : 'Dictation could not start.',
          'error'
        );
      }
    };

    recognition.onend = () => {
      if (dictationRecognition !== recognition) return;
      dictationRecognition = null;
      dictationListening = false;
      updateDictationUI();
      const text = dictationFinalText.trim();
      const hadError = dictationHadError;
      dictationFinalText = '';
      dictationHadError = false;
      if (!text) {
        if (!hadError) setFeedback('No instruction heard.', 'error');
        return;
      }
      sendAction(ACTIONS.SEND_INSTRUCTION, { textPrompt: text, act: actEnabled });
    };

    try {
      recognition.start();
    } catch (_) {
      cancelDictation();
      setFeedback('Dictation could not start.', 'error');
    }
  }

  function submitActInstruction(event) {
    event.preventDefault();
    const input = shadow?.querySelector('.notch-act-input');
    const textPrompt = String(input?.value || '').trim();
    if (!textPrompt) {
      setFeedback('Describe the task first.', 'error');
      input?.focus();
      return;
    }
    sendAction(ACTIONS.SEND_INSTRUCTION, { textPrompt, act: true });
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
    if (!expanded) {
      cancelDictation();
      setActEnabled(false);
    }
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
    if (expanded) {
      updateSelectionState();
      void renderPinnedActions();
    }
  }

  function sendAction(notchAction, details = {}) {
    const payload = { action: 'notchAction', notchAction, ...details };
    if (
      notchAction === ACTIONS.EXPLAIN_SELECTION ||
      notchAction === ACTIONS.RUN_PINNED_INSTRUCTION ||
      notchAction === ACTIONS.SEND_INSTRUCTION
    ) {
      payload.selectedText = getSelectedText();
    }
    if (notchAction === ACTIONS.EXPLAIN_SELECTION && !payload.selectedText) {
      setFeedback('Select text first.', 'error');
      updateSelectionState();
      return;
    }
    if (notchAction === ACTIONS.SEND_INSTRUCTION) {
      const textPrompt = String(payload.textPrompt || '')
        .trim()
        .slice(0, 20_000);
      if (!textPrompt) {
        setFeedback('Describe the task first.', 'error');
        return;
      }
      payload.textPrompt = textPrompt;
    }

    setFeedback(
      notchAction === ACTIONS.SEND_INSTRUCTION ? 'Sending instruction…' : 'Opening Prompt Paul…'
    );
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
    cancelDictation();
    actEnabled = false;
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
      <div class="notch-shell" data-expanded="false" data-theme="light" data-theme-preference="light">
        <div class="notch-rail">
          <button class="notch-toggle" type="button" aria-expanded="false" aria-controls="notch-panel" title="Open Prompt Paul notch">
            <span class="notch-toggle-content">
              <span class="notch-mark" aria-hidden="true"></span>
              <span class="notch-toggle-name">Prompt Paul</span>
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
          <div class="notch-actions notch-primary-actions" role="toolbar" aria-label="Primary Prompt Paul actions">
            <button class="notch-action" type="button" data-notch-action="openChat">
              <span class="notch-action-icon">${icons.chat}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Open chat</span><span class="notch-action-hint">Ask anything about this page</span></span>
            </button>
            <button class="notch-action" type="button" data-notch-action="summarizePage">
              <span class="notch-action-icon">${icons.page}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Summarize</span><span class="notch-action-hint">Read and summarize this page</span></span>
            </button>
            <button class="notch-action" type="button" data-notch-action="explainSelection" disabled>
              <span class="notch-action-icon">${icons.selection}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Explain</span><span class="notch-action-hint">Select text to enable</span></span>
            </button>
          </div>
          <div class="notch-utility-actions" role="toolbar" aria-label="Voice and page actions">
            <button
              class="notch-action notch-utility-action notch-dictation-action"
              type="button"
              aria-pressed="false"
              title="Dictate an instruction"
            >
              <span class="notch-action-icon">${icons.mic}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Dictate</span></span>
            </button>
            <button
              class="notch-action notch-utility-action notch-act-toggle"
              type="button"
              aria-pressed="false"
              title="Enable Act mode"
            >
              <span class="notch-action-icon">${icons.act}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Act</span></span>
            </button>
          </div>
          <form class="notch-act-form" aria-label="Act task" hidden>
            <label class="notch-sr-only" for="notch-act-input">Task for Prompt Paul to perform</label>
            <input
              id="notch-act-input"
              class="notch-act-input"
              type="text"
              maxlength="20000"
              autocomplete="off"
              placeholder="What should I do on this page?"
            />
            <button class="notch-act-submit" type="submit" title="Run Act task" aria-label="Run Act task">
              <span class="notch-action-icon">${icons.send}</span>
            </button>
          </form>
          <section class="notch-pinned-section" aria-labelledby="notch-pinned-title" hidden>
            <div class="notch-section-heading">
              <span id="notch-pinned-title">Pinned prompts</span>
              <span class="notch-section-count" aria-label="Pinned prompt count"></span>
            </div>
            <div class="notch-actions notch-pinned-actions" role="toolbar" aria-label="Pinned prompts"></div>
            <div class="notch-pinned-more" hidden></div>
          </section>
          <div class="notch-secondary-actions" role="toolbar" aria-label="More Prompt Paul actions">
            <button class="notch-action" type="button" data-notch-action="openActions">
              <span class="notch-action-icon">${icons.selection}</span>
              <span class="notch-action-copy"><span class="notch-action-label">All actions</span><span class="notch-action-hint">Open the full action menu</span></span>
            </button>
            <button class="notch-action" type="button" data-notch-action="openOptions">
              <span class="notch-action-icon">${icons.settings}</span>
              <span class="notch-action-copy"><span class="notch-action-label">Settings</span><span class="notch-action-hint">Manage Prompt Paul</span></span>
            </button>
          </div>
          <div class="notch-feedback" role="status" aria-live="polite"></div>
        </section>
      </div>
    `;
    document.documentElement.appendChild(host);
    applyThemePreference(themePreference);
    loadThemePreference();
    const site = shadow.querySelector('.notch-site');
    if (site) site.textContent = siteLabel();

    shadow.querySelector('.notch-toggle')?.addEventListener('click', () => setExpanded(!expanded));
    shadow.querySelector('.notch-close')?.addEventListener('click', () => setExpanded(false));
    shadow.querySelectorAll('[data-notch-action]').forEach((button) => {
      button.addEventListener('click', () => sendAction(button.dataset.notchAction));
    });
    shadow.querySelector('.notch-dictation-action')?.addEventListener('click', startDictation);
    shadow
      .querySelector('.notch-act-toggle')
      ?.addEventListener('click', () => setActEnabled(!actEnabled));
    shadow.querySelector('.notch-act-form')?.addEventListener('submit', submitActInstruction);

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
    void renderPinnedActions();
  }

  function applyEnabled(enabled) {
    if (enabled) mount();
    else destroy();
  }

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    applyEnabled(result?.[STORAGE_KEY] === true);
  });

  storageListener = (changes, area) => {
    if (area === 'sync' && (changes[THEME_PREFERENCE_KEY] || changes[LEGACY_DARK_THEME_KEY])) {
      const preference = changes[THEME_PREFERENCE_KEY]
        ? changes[THEME_PREFERENCE_KEY].newValue
        : changes[LEGACY_DARK_THEME_KEY]?.newValue;
      applyThemePreference(preference, changes[LEGACY_DARK_THEME_KEY]?.newValue);
      return;
    }
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      applyEnabled(changes[STORAGE_KEY].newValue === true);
    }
    if (changes[PINNED_ACTIONS_KEY] || changes[INSTRUCTIONS_KEY]) {
      void renderPinnedActions();
    }
  };
  chrome.storage.onChanged.addListener(storageListener);
  runtimeListener = (request) => {
    if (request?.action === 'notchPreferenceChanged') {
      applyEnabled(request.enabled === true);
    }
    if (request?.action === 'notchActRunState') {
      setActGlow(request.active === true, request.runId);
    }
  };
  chrome.runtime.onMessage.addListener(runtimeListener);
})();
