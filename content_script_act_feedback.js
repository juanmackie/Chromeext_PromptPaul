/**
 * @fileoverview On-demand Act activity indicator for pages without the notch runtime.
 */
(() => {
  if (
    window.top !== window ||
    window.__promptPaulActFeedbackInstalled === true ||
    window.__promptPaulNotchRuntimeInstalled === true
  ) {
    return;
  }
  window.__promptPaulActFeedbackInstalled = true;

  const GLOW_HOST_WINDOW_KEY = '__promptPaulActGlowHost';
  const GLOW_HOST_ATTRIBUTE = 'data-prompt-paul-act-glow';
  const GLOW_STYLE = `
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
      100% { opacity: 0.76; }
      50% { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .act-glow-frame { animation: none; }
    }
  `;

  let glowHost = null;
  let glowRunId = null;
  let glowExpiryTimer = null;

  function setActGlow(active, runId) {
    const nextRunId = String(runId || '').slice(0, 128);
    if (!active) {
      if (glowRunId && nextRunId && glowRunId !== nextRunId) return;
      clearTimeout(glowExpiryTimer);
      glowExpiryTimer = null;
      glowHost?.remove();
      if (window[GLOW_HOST_WINDOW_KEY] === glowHost) window[GLOW_HOST_WINDOW_KEY] = null;
      glowHost = null;
      glowRunId = null;
      return;
    }
    if (!nextRunId) return;
    if (!glowHost?.isConnected) {
      glowHost = window[GLOW_HOST_WINDOW_KEY]?.isConnected ? window[GLOW_HOST_WINDOW_KEY] : null;
    }
    if (!glowHost) {
      glowHost = document.createElement('div');
      glowHost.setAttribute(GLOW_HOST_ATTRIBUTE, '');
      glowHost.setAttribute('aria-hidden', 'true');
      const glowShadow = glowHost.attachShadow({ mode: 'open' });
      glowShadow.innerHTML = `<style>${GLOW_STYLE}</style><div class="act-glow-frame" aria-hidden="true"></div>`;
      document.documentElement.appendChild(glowHost);
      window[GLOW_HOST_WINDOW_KEY] = glowHost;
    }
    glowRunId = nextRunId;
    clearTimeout(glowExpiryTimer);
    glowExpiryTimer = setTimeout(() => setActGlow(false, nextRunId), 90_000);
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request?.action === 'notchActRunState') {
      setActGlow(request.active === true, request.runId);
    }
  });
})();
