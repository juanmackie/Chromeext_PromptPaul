/**
 * @fileoverview Chat Clipboard Module - Copy-to-clipboard and rendered-content helpers
 *
 * Responsibilities:
 * - Attach copy-as-raw / copy-as-formatted listeners to message action buttons
 * - Post-process rendered markdown to add per-code-block copy buttons
 *
 * These helpers are stateless (they operate purely on the DOM elements passed to
 * them), so they live outside the ChatUI singleton to keep that module focused.
 *
 * @module ChatClipboard
 * @requires ../../loadingManager.js
 */

import { loadingManager } from '../../loadingManager.js';

/**
 * Attach click event listeners to copy icons.
 * @param {string} rawMessage - Raw text message to copy
 * @param {HTMLElement} contentElement - Element containing formatted content
 * @param {HTMLElement} copyIconElement - Copy icon for plain text
 * @param {HTMLElement} copyFormattedIconElement - Copy icon for formatted text
 */
export function attachCopyListeners(
  rawMessage,
  contentElement,
  copyIconElement,
  copyFormattedIconElement
) {
  const newCopyIcon = copyIconElement.cloneNode(true);
  if (copyIconElement.parentNode) {
    copyIconElement.parentNode.replaceChild(newCopyIcon, copyIconElement);
  }
  const newFormattedCopyIcon = copyFormattedIconElement.cloneNode(true);
  if (copyFormattedIconElement.parentNode) {
    copyFormattedIconElement.parentNode.replaceChild(
      newFormattedCopyIcon,
      copyFormattedIconElement
    );
  }
  // Briefly flash a confirmation label/state on the clicked button, then revert.
  const flashButtonState = (button, message, stateClass) => {
    const originalLabel = (button.dataset.copyLabel ||= button.textContent);
    if (button._copyResetTimer) clearTimeout(button._copyResetTimer);
    button.textContent = message;
    button.classList.add(stateClass);
    button._copyResetTimer = setTimeout(() => {
      button.textContent = originalLabel;
      button.classList.remove('copied', 'copy-error');
    }, 1500);
  };

  newCopyIcon.addEventListener('click', async function (event) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(rawMessage);
      flashButtonState(newCopyIcon, 'Copied!', 'copied');
      loadingManager.showToast('Copied raw text to clipboard', 'success');
    } catch (err) {
      console.error('Failed to copy raw text: ', err);
      flashButtonState(newCopyIcon, 'Copy failed', 'copy-error');
      loadingManager.showToast('Error copying raw text.', 'error');
    }
  });
  newFormattedCopyIcon.addEventListener('click', async function (event) {
    event.stopPropagation();
    const htmlContent = contentElement.innerHTML;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([rawMessage], { type: 'text/plain' }),
        }),
      ]);
      flashButtonState(newFormattedCopyIcon, 'Copied!', 'copied');
      loadingManager.showToast('Copied formatted text to clipboard', 'success');
    } catch (err) {
      console.error('Failed to copy formatted text: ', err);
      try {
        await navigator.clipboard.writeText(rawMessage);
        flashButtonState(newFormattedCopyIcon, 'Copied!', 'copied');
        loadingManager.showToast('Copied (plain text fallback) to clipboard', 'success');
      } catch (errFallback) {
        console.error('Failed to copy plain text fallback: ', errFallback);
        flashButtonState(newFormattedCopyIcon, 'Copy failed', 'copy-error');
        loadingManager.showToast('Error copying text.', 'error');
      }
    }
  });
}

/**
 * Post-process rendered HTML to add copy buttons to code blocks.
 * Called automatically after `marked.parse()` content is inserted.
 * @param {HTMLElement} container - Element containing rendered markdown
 */
export function postProcessRenderedContent(container) {
  if (!container) return;

  const codeBlocks = container.querySelectorAll('pre code');
  codeBlocks.forEach((codeBlock) => {
    const pre = codeBlock.parentElement;
    // Avoid adding multiple wrappers
    if (pre.parentElement.classList.contains('code-block-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-code-btn';
    copyBtn.innerHTML = '<span class="copy-code-label">Copy</span>';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = codeBlock.textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.querySelector('.copy-code-label').textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.querySelector('.copy-code-label').textContent = 'Copy';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy code block:', err);
        copyBtn.querySelector('.copy-code-label').textContent = 'Error';
        setTimeout(() => {
          copyBtn.querySelector('.copy-code-label').textContent = 'Copy';
        }, 2000);
      }
    });

    wrapper.appendChild(copyBtn);
  });
}
