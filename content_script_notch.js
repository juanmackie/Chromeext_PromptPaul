/**
 * @fileoverview Optional top-centered Prompt Paul quick-action notch.
 * @module contentScriptNotch
 */

(() => {
  if (window.top !== window || window.__promptPaulNotchRuntimeInstalled === true) return;
  window.__promptPaulNotchRuntimeInstalled = true;
  if (document.querySelector('[data-prompt-paul-notch-host]')) return;

  const STORAGE_KEY = 'notchEnabled';
  const POSITION_STORAGE_KEY = 'notchPosition';
  const PLACEMENT_STORAGE_KEY = 'notchPlacement';
  const DEFAULT_NOTCH_POSITION = 50;
  const DEFAULT_NOTCH_PLACEMENT = 'top';
  const PLACEMENTS = Object.freeze(['top', 'right', 'bottom', 'left']);
  const DRAG_THRESHOLD_PX = 4;
  const THEME_PREFERENCE_KEY = 'themePreference';
  const LEGACY_DARK_THEME_KEY = 'darkTheme';
  const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';
  const PINNED_ACTIONS_KEY = 'pinnedQuickActions';
  const INSTRUCTIONS_KEY = 'instructions';
  const HOST_ATTRIBUTE = 'data-prompt-paul-notch-host';
  const ACT_GLOW_HOST_ATTRIBUTE = 'data-prompt-paul-act-glow';
  const ACT_GLOW_HOST_WINDOW_KEY = '__promptPaulActGlowHost';
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
    PREPARE_DICTATION: 'prepareDictation',
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
  let hoverTimer = null;
  let glowHost = null;
  let glowRunId = null;
  let glowExpiryTimer = null;
  let actEnabled = false;
  let dictationRecognition = null;
  let dictationPanelReady = null;
  let dictationListening = false;
  let dictationFinalText = '';
  let dictationHadError = false;
  let themePreference = 'light';
  let notchPosition = DEFAULT_NOTCH_POSITION;
  let notchPlacement = DEFAULT_NOTCH_PLACEMENT;
  let notchPositionDirty = false;
  let pinned = false;
  let dragState = null;
  let dragClickSuppressed = false;
  let dragClickResetTimer = null;
  let notchResizeObserver = null;
  const systemThemeMediaQuery = window.matchMedia?.(SYSTEM_THEME_QUERY) || null;

  const styleText = `
    :host {
      all: initial;
      position: fixed;
      top: max(0px, env(safe-area-inset-top));
      left: 50%;
      z-index: 2147483640;
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transform: translateX(-50%);
    }

    * {
      box-sizing: border-box;
    }

    .notch-shell {
      --notch-spring: cubic-bezier(0.22, 1, 0.36, 1);
      --notch-surface: rgba(12, 14, 19, 0.97);
      --notch-surface-deep: #0b0d12;
      --notch-surface-top: #151821;
      --notch-surface-raised: rgba(255, 255, 255, 0.055);
      --notch-surface-hover: rgba(255, 255, 255, 0.095);
      --notch-edge: rgba(255, 255, 255, 0.115);
      --notch-edge-soft: rgba(255, 255, 255, 0.065);
      --notch-ink: #f5f6f8;
      --notch-ink-strong: #ffffff;
      --notch-ink-muted: rgba(245, 246, 248, 0.76);
      --notch-ink-subtle: rgba(245, 246, 248, 0.52);
      --notch-ink-faint: rgba(245, 246, 248, 0.34);
      --notch-brand: #8b8df8;
      --notch-brand-bright: #b5b6ff;
      --notch-brand-soft: rgba(139, 141, 248, 0.14);
      --notch-brand-border: rgba(139, 141, 248, 0.52);
      --notch-brand-border-soft: rgba(139, 141, 248, 0.3);
      --notch-ai-cyan: #7dd3e8;
      --notch-ai-violet: #b6a6e8;
      --notch-energy-gradient: linear-gradient(100deg, #777af0, #a99ce9 54%, #71c5dc);
      --notch-energy-soft: radial-gradient(
        circle at 18% -30%,
        rgba(139, 141, 248, 0.14),
        transparent 46%
      );
      --notch-mark-fill: radial-gradient(circle at 68% 28%, #9de3f0, transparent 42%);
      --notch-brand-foreground: #ffffff;
      --notch-surface-pinned: rgba(255, 255, 255, 0.038);
      --notch-shadow: rgba(2, 4, 10, 0.48);
      --notch-shadow-soft: rgba(2, 4, 10, 0.28);
      --notch-error: #ffb4ab;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 172px;
      isolation: isolate;
      pointer-events: none;
      color: var(--notch-ink);
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      line-height: 1.35;
      filter: drop-shadow(0 14px 26px var(--notch-shadow-soft));
      transition: width 460ms var(--notch-spring), filter 240ms ease;
    }

    .notch-shell::before {
      position: absolute;
      top: 0;
      left: 10%;
      right: 10%;
      z-index: 2;
      height: 2px;
      border-radius: 0 0 4px 4px;
      background: var(--notch-energy-gradient);
      content: '';
      opacity: 0.78;
      pointer-events: none;
    }

    .notch-shell[data-act-running='true']::before {
      background-size: 220% 100%;
      animation: notch-energy-flow 2.4s linear infinite;
      opacity: 0.94;
    }

    .notch-shell[data-theme='light'] {
      --notch-surface: rgba(250, 250, 252, 0.96);
      --notch-surface-deep: #f4f4f7;
      --notch-surface-top: #ffffff;
      --notch-surface-raised: rgba(31, 35, 48, 0.045);
      --notch-surface-hover: rgba(79, 70, 200, 0.085);
      --notch-edge: rgba(31, 35, 48, 0.12);
      --notch-edge-soft: rgba(31, 35, 48, 0.075);
      --notch-ink: #171821;
      --notch-ink-strong: #0d0e14;
      --notch-ink-muted: rgba(23, 24, 33, 0.72);
      --notch-ink-subtle: rgba(23, 24, 33, 0.5);
      --notch-ink-faint: rgba(23, 24, 33, 0.34);
      --notch-brand: #5d5fc7;
      --notch-brand-bright: #4f51bb;
      --notch-brand-soft: rgba(93, 95, 199, 0.1);
      --notch-brand-border: rgba(93, 95, 199, 0.38);
      --notch-brand-border-soft: rgba(93, 95, 199, 0.24);
      --notch-ai-cyan: #348aa0;
      --notch-ai-violet: #7662b4;
      --notch-energy-gradient: linear-gradient(100deg, #5d5fc7, #806ab9 54%, #398da3);
      --notch-energy-soft: radial-gradient(
        circle at 18% -30%,
        rgba(93, 95, 199, 0.1),
        transparent 46%
      );
      --notch-mark-fill: radial-gradient(circle at 68% 28%, #72c6d8, transparent 42%);
      --notch-brand-foreground: #ffffff;
      --notch-surface-pinned: rgba(31, 35, 48, 0.035);
      --notch-shadow: rgba(31, 35, 48, 0.2);
      --notch-shadow-soft: rgba(31, 35, 48, 0.12);
      --notch-error: #b42318;
      color-scheme: light;
    }

    .notch-shell[data-theme='dark'] {
      color-scheme: dark;
    }

    .notch-shell[data-expanded='true'] {
      width: min(390px, calc(100vw - 24px));
      filter: drop-shadow(0 22px 42px var(--notch-shadow));
    }

    .notch-rail,
    .notch-panel {
      background-color: var(--notch-surface);
      pointer-events: auto;
    }

    .notch-rail {
      position: relative;
      display: flex;
      cursor: grab;
      touch-action: none;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 37px;
      min-height: 37px;
      padding: 4px 7px;
      overflow: hidden;
      border: 1px solid var(--notch-edge);
      border-top: 0;
      border-radius: 0 0 19px 19px;
      background: var(--notch-energy-soft),
        linear-gradient(180deg, var(--notch-surface-top), var(--notch-surface));
      box-shadow: inset 0 -1px var(--notch-edge-soft), inset 0 1px rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(24px) saturate(1.25);
      transition: height 460ms var(--notch-spring), border-radius 460ms var(--notch-spring),
        border-color 220ms ease, background-color 220ms ease;
    }

    .notch-rail:active {
      cursor: grabbing;
    }

    .notch-shell[data-expanded='true'] .notch-rail {
      height: 42px;
      min-height: 42px;
      border-bottom-color: transparent;
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
      height: 28px;
      padding: 0 8px;
      border-radius: 14px;
      background: transparent;
      color: var(--notch-ink);
      transition: background-color 180ms ease, transform 180ms ease;
    }

    .notch-toggle:active {
      transform: scale(0.985);
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
      gap: 8px;
      width: 100%;
    }

    .notch-toggle-name {
      color: var(--notch-ink-muted);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: -0.005em;
    }

    .notch-mark {
      position: relative;
      display: grid;
      place-items: center;
      width: 19px;
      height: 19px;
      border: 1px solid var(--notch-brand-border);
      border-radius: 7px;
      background: var(--notch-mark-fill), var(--notch-brand-soft);
      color: var(--notch-brand-bright);
      box-shadow: inset 0 1px rgba(255, 255, 255, 0.16), 0 0 14px var(--notch-brand-soft);
      font-size: 0;
      line-height: 1;
      transform: rotate(-3deg);
      transition: transform 240ms var(--notch-spring), border-color 180ms ease;
    }

    .notch-toggle:hover .notch-mark {
      transform: rotate(3deg) scale(1.04);
    }

    .notch-mark::before {
      width: 7px;
      height: 7px;
      content: '';
      border-radius: 2px 5px 3px 5px;
      background: currentColor;
      transform: rotate(18deg);
    }

    .notch-status {
      width: 5px;
      height: 5px;
      margin-left: 1px;
      border-radius: 50%;
      background: var(--notch-brand);
      box-shadow: 0 0 0 3px var(--notch-brand-soft);
      transition: transform 180ms ease, box-shadow 180ms ease;
    }

    .notch-shell[data-act-running='true'] .notch-status {
      box-shadow: 0 0 0 4px var(--notch-brand-soft), 0 0 12px var(--notch-brand);
      animation: notch-signal 1.1s ease-in-out infinite;
    }

    .notch-panel {
      width: 100%;
      margin: 0;
      padding: 14px 14px 15px;
      overflow: hidden;
      border: 1px solid var(--notch-edge);
      border-top: 0;
      border-radius: 0 0 24px 24px;
      background: var(--notch-energy-soft),
        linear-gradient(180deg, var(--notch-surface), var(--notch-surface-deep));
      box-shadow: inset 0 1px rgba(255, 255, 255, 0.035);
      backdrop-filter: blur(28px) saturate(1.22);
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
      margin-bottom: 9px;
      padding: 0 2px;
    }

    .notch-title {
      display: block;
      color: var(--notch-ink-strong);
      font-size: 17px;
      font-weight: 680;
      letter-spacing: -0.035em;
      line-height: 1.1;
    }

    .notch-kicker {
      display: block;
      margin-top: 4px;
      color: var(--notch-ink-subtle);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.015em;
    }

    .notch-model-status {
      max-width: 100%;
      margin-top: 3px;
      overflow: hidden;
      color: var(--notch-ink-muted);
      font-size: 9px;
      font-weight: 650;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-close {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0 0 2px;
      border: 1px solid var(--notch-edge-soft);
      border-radius: 10px;
      background: var(--notch-surface-raised);
      color: var(--notch-ink-subtle);
      font-size: 19px;
      line-height: 1;
      transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
    }

    .notch-close:active {
      transform: scale(0.94);
    }

    .notch-close:hover {
      background: var(--notch-surface-hover);
      color: var(--notch-ink-strong);
    }

    .notch-site-row {
      gap: 7px;
      min-width: 0;
      width: fit-content;
      max-width: 100%;
      margin-bottom: 11px;
      padding: 5px 8px;
      border: 1px solid var(--notch-edge-soft);
      border-radius: 9px;
      background: var(--notch-surface-raised);
      color: var(--notch-ink-subtle);
      font-size: 10px;
      font-weight: 550;
    }

    .notch-site-dot {
      width: 6px;
      height: 6px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--notch-brand);
      box-shadow: 0 0 8px var(--notch-brand);
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

    .notch-primary-actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .notch-action {
      display: flex;
      align-items: center;
      gap: 9px;
      width: 100%;
      min-height: 39px;
      padding: 8px 10px;
      border: 1px solid var(--notch-edge-soft);
      border-radius: 12px;
      background: var(--notch-surface-raised);
      color: var(--notch-ink);
      text-align: left;
      box-shadow: inset 0 1px rgba(255, 255, 255, 0.035);
      transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease,
        box-shadow 180ms ease;
    }

    .notch-primary-actions .notch-action {
      min-height: 52px;
      padding: 9px 11px;
    }

    .notch-primary-actions .notch-action:first-child {
      grid-column: 1 / -1;
      min-height: 58px;
      border-color: var(--notch-brand-border-soft);
      background: linear-gradient(105deg, var(--notch-brand-soft), var(--notch-surface-raised));
    }

    .notch-primary-actions .notch-action-copy {
      width: 100%;
    }

    .notch-primary-actions .notch-action-label {
      overflow: hidden;
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-primary-actions .notch-action-hint {
      display: block;
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
      background: var(--notch-surface-hover);
      box-shadow: inset 0 1px rgba(255, 255, 255, 0.06), 0 7px 18px var(--notch-shadow-soft);
      transform: translateY(-1px);
    }

    .notch-action:active:not(:disabled) {
      box-shadow: none;
      transform: translateY(1px) scale(0.985);
    }

    .notch-action:disabled {
      cursor: not-allowed;
      opacity: 0.38;
    }

    .notch-action-icon {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      border-radius: 9px;
      background: var(--notch-brand-soft);
      color: var(--notch-brand-bright);
    }

    .notch-action-icon svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.75;
    }

    .notch-action-copy {
      display: block;
      min-width: 0;
    }

    .notch-action-label {
      gap: 6px;
      color: var(--notch-ink);
      font-size: 11px;
      font-weight: 640;
      letter-spacing: -0.01em;
    }

    .notch-action-hint {
      display: none;
      overflow: hidden;
      margin-top: 2px;
      color: var(--notch-ink-subtle);
      font-size: 9px;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notch-action:disabled .notch-action-hint {
      display: block;
    }

    .notch-pinned-section {
      margin-top: 12px;
      padding-top: 11px;
      border-top: 1px solid var(--notch-edge-soft);
    }

    .notch-pinned-section[hidden] {
      display: none;
    }

    .notch-section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0 3px 7px;
      color: var(--notch-ink-subtle);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.075em;
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
      min-height: 40px;
      padding: 6px 9px;
      background: var(--notch-surface-pinned);
    }

    .notch-pinned-action .notch-action-icon {
      width: 25px;
      height: 25px;
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

    /* ---- Edge placement + pin ---- */
    /* Vertical edges lay the rail on the edge and open the panel inward. */
    .notch-shell[data-placement='left'] {
      flex-direction: row;
      width: auto;
    }

    .notch-shell[data-placement='right'] {
      flex-direction: row-reverse;
      width: auto;
    }

    .notch-shell[data-placement='left'][data-expanded='true'],
    .notch-shell[data-placement='right'][data-expanded='true'] {
      width: auto;
    }

    .notch-shell[data-placement='bottom'] {
      flex-direction: column-reverse;
    }

    /* Rail shape adapts to the edge it sits on. */
    .notch-shell[data-placement='bottom'] .notch-rail {
      border-top: 0;
      border-bottom: 1px solid var(--notch-edge);
      border-radius: 19px 19px 0 0;
    }

    .notch-shell[data-placement='left'] .notch-rail,
    .notch-shell[data-placement='right'] .notch-rail {
      flex: 0 0 auto;
      width: 37px;
      min-width: 37px;
      height: 172px;
      min-height: 172px;
      padding: 7px 4px;
      writing-mode: vertical-rl;
      border-top: 0;
      border-radius: 0 19px 19px 0;
    }

    .notch-shell[data-placement='right'] .notch-rail {
      border-radius: 19px 0 0 19px;
    }

    .notch-shell[data-placement='left'] .notch-toggle-content,
    .notch-shell[data-placement='right'] .notch-toggle-content {
      flex-direction: row;
      width: auto;
      gap: 7px;
    }

    .notch-shell[data-placement='left'] .notch-toggle,
    .notch-shell[data-placement='right'] .notch-toggle {
      height: 100%;
      width: auto;
      padding: 8px 0;
    }

    /* Panel rounds the edge it opens from. */
    .notch-shell[data-placement='bottom'] .notch-panel {
      border-radius: 24px 24px 0 0;
      animation: none;
    }

    .notch-shell[data-placement='left'] .notch-panel,
    .notch-shell[data-placement='right'] .notch-panel {
      flex: 1 1 auto;
      width: auto;
      border-radius: 0 24px 24px 0;
      animation: none;
    }

    .notch-shell[data-placement='right'] .notch-panel {
      border-radius: 24px 0 0 24px;
    }

    /* Expand the panel away from the anchored edge. */
    .notch-shell[data-placement='left'][data-expanded='true'] .notch-panel,
    .notch-shell[data-placement='right'][data-expanded='true'] .notch-panel {
      width: min(390px, calc(100vw - 24px));
    }

    /* Hover reveal: the rail grows only when the panel is closed and unpinned. */
    .notch-shell[data-pinned='false']:hover .notch-rail {
      background-color: var(--notch-surface-hover);
      border-color: var(--notch-brand-border);
    }

    .notch-shell[data-pinned='true'] .notch-rail {
      border-color: var(--notch-brand-border-soft);
    }

    @media (prefers-reduced-motion: reduce) {
      .notch-shell[data-placement='left'] .notch-panel,
      .notch-shell[data-placement='right'] .notch-panel,
      .notch-shell[data-placement='bottom'] .notch-panel {
        animation: none;
        transition: none;
      }
    }

      from {
        background-position: 0% 50%;
      }
      to {
        background-position: 100% 50%;
      }
    }

    @keyframes notch-signal {
      0%,
      100% {
        transform: scale(0.9);
      }
      50% {
        transform: scale(1.25);
      }
    }

    @keyframes notch-unfold {
      from {
        opacity: 0;
        clip-path: inset(0 5% 100% 5% round 0 0 20px 20px);
        transform: translateY(-8px) scale(0.97);
        transform-origin: top center;
      }
      45% {
        opacity: 1;
      }
      to {
        opacity: 1;
        clip-path: inset(0 0 0 0 round 0 0 24px 24px);
        transform: translateY(0) scale(1);
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
      .notch-shell::before,
      .notch-status,
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

  function normalizeNotchPosition(position) {
    const numericPosition = Number(position);
    if (!Number.isFinite(numericPosition)) return DEFAULT_NOTCH_POSITION;
    return Math.min(100, Math.max(0, numericPosition));
  }

  function normalizeNotchPlacement(placement) {
    return PLACEMENTS.includes(placement) ? placement : DEFAULT_NOTCH_PLACEMENT;
  }

  function isVerticalPlacement() {
    return notchPlacement === 'left' || notchPlacement === 'right';
  }

  function applyNotchPlacement(placement = notchPlacement) {
    notchPlacement = normalizeNotchPlacement(placement);
    const shell = shadow?.querySelector('.notch-shell');
    if (shell) shell.dataset.placement = notchPlacement;
    applyNotchPosition();
  }

  function applyNotchPosition(position = notchPosition) {
    notchPosition = normalizeNotchPosition(position);
    if (!host) return;

    const vertical = isVerticalPlacement();
    const mainSize = vertical ? window.innerHeight || 1 : window.innerWidth || 1;
    const box = host.getBoundingClientRect();
    const mainDimension = vertical ? box.height || 172 : box.width || 172;
    const sideSpace = Math.max(0, (mainSize - mainDimension) / 2);
    const edgePadding = Math.min(12, sideSpace);
    const minimumCenter = mainDimension / 2 + edgePadding;
    const maximumCenter = mainSize - minimumCenter;
    const requestedCenter = (notchPosition / 100) * mainSize;
    const center =
      maximumCenter < minimumCenter
        ? mainSize / 2
        : Math.min(maximumCenter, Math.max(minimumCenter, requestedCenter));

    host.style.left = '';
    host.style.top = '';
    host.style.right = '';
    host.style.bottom = '';
    host.style.transform = '';

    if (notchPlacement === 'top') {
      host.style.top = 'max(0px, env(safe-area-inset-top))';
      host.style.left = `${center}px`;
      host.style.transform = 'translateX(-50%)';
    } else if (notchPlacement === 'bottom') {
      host.style.bottom = '0px';
      host.style.left = `${center}px`;
      host.style.transform = 'translateX(-50%)';
    } else if (notchPlacement === 'left') {
      host.style.left = '0px';
      host.style.top = `${center}px`;
      host.style.transform = 'translateY(-50%)';
    } else {
      host.style.right = '0px';
      host.style.top = `${center}px`;
      host.style.transform = 'translateY(-50%)';
    }
  }

  function persistNotchPosition() {
    try {
      chrome.storage.local.set({
        [POSITION_STORAGE_KEY]: notchPosition,
        [PLACEMENT_STORAGE_KEY]: notchPlacement,
      });
    } catch (_) {
      // The extension context may be unavailable while the page is closing.
    }
  }

  function updateNotchPositionFromDrag(center) {
    const vertical = isVerticalPlacement();
    const mainSize = vertical ? window.innerHeight || 1 : window.innerWidth || 1;
    notchPositionDirty = true;
    applyNotchPosition((center / mainSize) * 100);
  }

  function loadNotchPosition() {
    try {
      chrome.storage.local.get([POSITION_STORAGE_KEY, PLACEMENT_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError || notchPositionDirty) return;
        applyNotchPlacement(result?.[PLACEMENT_STORAGE_KEY]);
        applyNotchPosition(result?.[POSITION_STORAGE_KEY]);
      });
    } catch (_) {
      // Keep the default position if local storage is unavailable.
    }
  }

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

  function removeNotchDragListeners() {
    window.removeEventListener('pointermove', handleNotchDragMove, true);
    window.removeEventListener('pointerup', endNotchDrag, true);
    window.removeEventListener('pointercancel', endNotchDrag, true);
  }

  function endNotchDrag(event) {
    if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
    const moved = dragState.moved;
    dragState = null;
    removeNotchDragListeners();
    if (!moved) return;

    persistNotchPosition();
    dragClickSuppressed = true;
    clearTimeout(dragClickResetTimer);
    dragClickResetTimer = window.setTimeout(() => {
      dragClickSuppressed = false;
      dragClickResetTimer = null;
    }, 0);
  }

  function handleNotchDragMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const vertical = isVerticalPlacement();
    const coordinate = vertical ? event.clientY : event.clientX;
    const delta = coordinate - dragState.startCoordinate;
    if (!dragState.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
    dragState.moved = true;
    event.preventDefault();
    updateNotchPositionFromDrag(dragState.startCenter + delta);
  }

  function beginNotchDrag(event) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    clearTimeout(hoverTimer);
    hoverTimer = null;
    const rect = host?.getBoundingClientRect();
    if (!rect) return;
    const vertical = isVerticalPlacement();
    dragState = {
      pointerId: event.pointerId,
      startCoordinate: vertical ? event.clientY : event.clientX,
      startCenter: vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2,
      moved: false,
    };
    window.addEventListener('pointermove', handleNotchDragMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener('pointerup', endNotchDrag, true);
    window.addEventListener('pointercancel', endNotchDrag, true);
  }

  function cancelNotchDrag() {
    dragState = null;
    removeNotchDragListeners();
    clearTimeout(dragClickResetTimer);
    dragClickResetTimer = null;
    dragClickSuppressed = false;
  }

  function handleViewportResize() {
    applyNotchPosition(notchPosition);
  }

  function siteLabel() {
    return String(location.hostname || 'Current page')
      .replace(/^www\./i, '')
      .slice(0, 120);
  }

  function formatProfileMode(provider) {
    const normalizedProvider = String(provider || '')
      .trim()
      .toLowerCase();
    if (normalizedProvider === 'codex') return 'Codex';
    if (normalizedProvider === 'hermes') return 'Hermes';
    if (normalizedProvider === 'api') return 'API';
    return normalizedProvider ? normalizedProvider.toUpperCase() : 'API';
  }

  function formatProfileModel(modelName) {
    const normalizedModel = String(modelName || '').trim();
    return normalizedModel || 'Not set';
  }

  function formatProfileReasoning(level) {
    const normalizedLevel = String(level || '')
      .trim()
      .toLowerCase();
    return normalizedLevel || 'Auto';
  }

  function refreshProfileStatus() {
    const status = shadow?.querySelector('.notch-model-status');
    if (!status) return;
    try {
      chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
        if (chrome.runtime.lastError || !status.isConnected) return;
        const profiles = Array.isArray(result?.profiles) ? result.profiles : [];
        const profile =
          profiles.find((candidate) => candidate.id === result?.lastSelectedProfileId) ||
          profiles.find((candidate) => candidate.id === 'default');
        const mode = profile ? formatProfileMode(profile.provider) : ' - ';
        const model = formatProfileModel(profile?.modelName);
        const reasoning = formatProfileReasoning(profile?.reasoningLevel);
        const summary = `${mode} · ${model} · ${reasoning}`;
        status.textContent = summary;
        status.title = `Current mode: ${mode}. Model: ${model}. Reasoning level: ${reasoning}.`;
        status.setAttribute(
          'aria-label',
          `Current mode: ${mode}, model: ${model}, reasoning level: ${reasoning}`
        );
      });
    } catch (_) {
      // Keep the initial status if local storage is unavailable.
    }
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
    const shell = shadow?.querySelector('.notch-shell');
    if (!active) {
      if (glowRunId && nextRunId && glowRunId !== nextRunId) return;
      clearTimeout(glowExpiryTimer);
      glowExpiryTimer = null;
      shell?.setAttribute('data-act-running', 'false');
      glowHost?.remove();
      if (window[ACT_GLOW_HOST_WINDOW_KEY] === glowHost) {
        window[ACT_GLOW_HOST_WINDOW_KEY] = null;
      }
      glowHost = null;
      glowRunId = null;
      return;
    }
    if (!nextRunId) return;
    shell?.setAttribute('data-act-running', 'true');
    if (!glowHost?.isConnected) {
      glowHost = window[ACT_GLOW_HOST_WINDOW_KEY]?.isConnected
        ? window[ACT_GLOW_HOST_WINDOW_KEY]
        : null;
    }
    if (!glowHost) {
      glowHost = document.createElement('div');
      glowHost.setAttribute(ACT_GLOW_HOST_ATTRIBUTE, '');
      glowHost.setAttribute('aria-hidden', 'true');
      const glowShadow = glowHost.attachShadow({ mode: 'open' });
      glowShadow.innerHTML = `<style>${ACT_GLOW_STYLE}</style><div class="act-glow-frame" aria-hidden="true"></div>`;
      document.documentElement.appendChild(glowHost);
      window[ACT_GLOW_HOST_WINDOW_KEY] = glowHost;
    }
    glowRunId = nextRunId;
    clearTimeout(glowExpiryTimer);
    glowExpiryTimer = setTimeout(() => setActGlow(false, nextRunId), 90_000);
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

  function prepareDictationPanel() {
    const ready = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'notchAction', notchAction: ACTIONS.PREPARE_DICTATION },
          (response) => {
            if (chrome.runtime.lastError || !response?.success || !response.panelToken) {
              setFeedback(
                response?.error || 'Prompt Paul could not open. Try the extension icon.',
                'error'
              );
              resolve(null);
              return;
            }
            resolve(String(response.panelToken));
          }
        );
      } catch (error) {
        const message = String(error?.message || error);
        setFeedback(
          /extension context invalidated/i.test(message)
            ? 'Reload this page to reconnect Prompt Paul.'
            : 'Prompt Paul could not open. Try the extension icon.',
          'error'
        );
        resolve(null);
      }
    });
    dictationPanelReady = ready;
    return ready;
  }

  function cancelDictation() {
    const recognition = dictationRecognition;
    dictationRecognition = null;
    dictationPanelReady = null;
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

    recognition.onend = async () => {
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
      const panelToken = await dictationPanelReady;
      if (!panelToken) return;
      dictationPanelReady = null;
      sendAction(ACTIONS.SEND_INSTRUCTION, {
        textPrompt: text,
        act: actEnabled,
        dictationPanelToken: panelToken,
        includePageContext: true,
      });
    };

    try {
      recognition.start();
      prepareDictationPanel();
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

  function updatePinnedStyle() {
    const shell = shadow?.querySelector('.notch-shell');
    if (shell) shell.dataset.pinned = String(pinned);
  }

  function setExpanded(next) {
    expanded = Boolean(next);
    if (!expanded) {
      pinned = false;
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
    updatePinnedStyle();
    if (expanded) {
      updateSelectionState();
      void renderPinnedActions();
    }
  }

  function setPinned(next) {
    pinned = Boolean(next);
    updatePinnedStyle();
    setExpanded(pinned);
  }

  function sendAction(notchAction, details = {}) {
    const payload = { action: 'notchAction', notchAction, ...details };
    if (
      notchAction === ACTIONS.EXPLAIN_SELECTION ||
      notchAction === ACTIONS.RUN_PINNED_INSTRUCTION ||
      (notchAction === ACTIONS.SEND_INSTRUCTION && payload.includePageContext !== true)
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
    cancelNotchDrag();
    notchResizeObserver?.disconnect();
    notchResizeObserver = null;
    window.removeEventListener('resize', handleViewportResize);
    if (selectionListener) document.removeEventListener('selectionchange', selectionListener);
    if (documentClickListener) document.removeEventListener('click', documentClickListener, true);
    if (keydownListener) document.removeEventListener('keydown', keydownListener, true);
    selectionListener = null;
    documentClickListener = null;
    keydownListener = null;
    host?.remove();
    glowHost?.remove();
    clearTimeout(glowExpiryTimer);
    glowExpiryTimer = null;
    host = null;
    shadow = null;
    glowHost = null;
    glowRunId = null;
    expanded = false;
  }

  function mount() {
    if (host || !document.documentElement) return;
    host = document.createElement('div');
    host.setAttribute(HOST_ATTRIBUTE, '');
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${styleText}</style>
      <div class="notch-shell" data-expanded="false" data-placement="top" data-pinned="false" data-theme="light" data-theme-preference="light">
        <div class="notch-rail">
          <button class="notch-toggle" type="button" aria-expanded="false" aria-controls="notch-panel" title="Open Prompt Paul notch">
            <span class="notch-toggle-content">
              <span class="notch-mark" aria-hidden="true"></span>
              <span class="notch-toggle-name">Prompt Paul</span>
              <span class="notch-status" aria-hidden="true"></span>
            </span>
            <span class="notch-sr-only">Open Prompt Paul quick actions. Drag horizontally to move the notch.</span>
          </button>
        </div>
        <section id="notch-panel" class="notch-panel" role="dialog" aria-label="Prompt Paul quick actions" hidden>
          <div class="notch-header">
            <div>
              <span class="notch-title">Quick actions</span>
              <span class="notch-kicker">Prompt Paul · current page</span>
              <span
                class="notch-model-status"
                aria-label="Current mode, model, and reasoning level"
                title="Current mode, model, and reasoning level"
                >Loading model…</span
              >
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
    notchPositionDirty = false;
    applyNotchPlacement(notchPlacement);
    applyNotchPosition();
    loadNotchPosition();
    if (window.ResizeObserver) {
      notchResizeObserver = new window.ResizeObserver(() => applyNotchPosition(notchPosition));
      notchResizeObserver.observe(host);
    }
    window.addEventListener('resize', handleViewportResize);
    applyThemePreference(themePreference);
    loadThemePreference();
    const site = shadow.querySelector('.notch-site');
    if (site) site.textContent = siteLabel();
    refreshProfileStatus();

    const rail = shadow.querySelector('.notch-rail');
    rail?.addEventListener('pointerdown', beginNotchDrag);
    const shell = shadow.querySelector('.notch-shell');
    shell?.addEventListener('pointerenter', () => {
      if (pinned) return;
      clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        hoverTimer = null;
        if (!pinned && !dragState) setExpanded(true);
      }, 120);
    });
    shell?.addEventListener('pointerleave', () => {
      clearTimeout(hoverTimer);
      hoverTimer = null;
      if (!pinned && expanded) setExpanded(false);
    });
    shadow.querySelector('.notch-toggle')?.addEventListener('click', (event) => {
      if (dragClickSuppressed) {
        event.preventDefault();
        dragClickSuppressed = false;
        return;
      }
      setPinned(!pinned);
    });
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

  chrome.storage.local.get([STORAGE_KEY, POSITION_STORAGE_KEY, PLACEMENT_STORAGE_KEY], (result) => {
    notchPosition = normalizeNotchPosition(result?.[POSITION_STORAGE_KEY]);
    notchPlacement = normalizeNotchPlacement(result?.[PLACEMENT_STORAGE_KEY]);
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
    if (changes[POSITION_STORAGE_KEY]) {
      applyNotchPosition(changes[POSITION_STORAGE_KEY].newValue);
    }
    if (changes[PLACEMENT_STORAGE_KEY]) {
      applyNotchPlacement(changes[PLACEMENT_STORAGE_KEY].newValue);
    }
    if (changes.profiles || changes.lastSelectedProfileId) {
      refreshProfileStatus();
    }
    if (changes[PINNED_ACTIONS_KEY] || changes[INSTRUCTIONS_KEY]) {
      void renderPinnedActions();
    }
  };
  chrome.storage.onChanged.addListener(storageListener);
  runtimeListener = (request, _sender, sendResponse) => {
    if (request?.action === 'notchPreferenceChanged') {
      applyEnabled(request.enabled === true);
    }
    if (request?.action === 'notchActRunState') {
      setActGlow(request.active === true, request.runId);
      sendResponse?.({ received: true });
    }
  };
  chrome.runtime.onMessage.addListener(runtimeListener);
})();
