/**
 * @fileoverview Chat Page Actions Module - Preset analysis and site action cards
 *
 * Responsibilities:
 * - Preset prompt assembly
 * - Site action card rendering
 * - Preset analysis execution
 *
 * @module ChatPageActions
 */

import { getSuggestionsForSite, extractSiteKey } from '../utils/suggestionStorage.js';
import { inferActionCards } from '../utils/actionCards.js';
import { friendlyRuntimeErrorMessage } from '../utils/runtimeErrors.js';

/**
 * Build the structured prompt request for a page-scoped action. The page text
 * travels as bounded untrusted `page_content` context so the action carries the
 * content it was generated from instead of relying on an earlier history turn.
 * @param {string} prompt - Instruction text (preset prompt or action-card prompt).
 * @param {string} content - Bounded page content for the current page.
 * @param {Object} metadata - Page identity fields (title, siteName, byline, url, type).
 * @returns {{instruction: string, context: {type: string, text: string, metadata: Object}}}
 */
export function buildCardPromptRequest(prompt, content, metadata) {
  return {
    instruction: prompt,
    context: {
      type: 'page_content',
      text: content,
      metadata,
    },
  };
}

export function buildSmartPromptRequest(presetKey, content, metadata, presetModes) {
  const preset = presetModes[presetKey] || presetModes.summary;

  return buildCardPromptRequest(preset.prompt, content, metadata);
}

export async function buildSiteActions({ url, platform = null, platformInfo = null, onRun }) {
  const siteKey = extractSiteKey(url);
  const suggestions = siteKey ? await getSuggestionsForSite(siteKey) : [];
  const actionCards = inferActionCards({ url, platform, platformInfo });
  const actions = [];
  const append = (label, prompt, primary = false) => {
    actions.push({
      id: `site:${label}`,
      label,
      title: prompt || label,
      type: 'site',
      primary,
      run: () => onRun?.(prompt),
    });
  };
  for (const card of actionCards) append(card.title, card.prompt, true);
  for (const s of suggestions) append(s.command, s.prompt);
  return actions;
}

export async function executePresetAnalysis(input) {
  const {
    presetKey,
    loadingText,
    successText,
    presetModes,
    chatMainArea,
    oneoffInstructionArea,
    makeApiCall,
    loadingManager,
    chatUI,
    showSiteSuggestions,
  } = input;

  try {
    loadingManager.showToast(loadingText, 'info');
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getTabContent' }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });

    if (response && response.action === 'tabContentResponse') {
      if (response.content) {
        const metadata = {
          title: response.title,
          siteName: response.siteName,
          byline: response.byline,
          url: response.url,
          type: response.type,
        };
        const promptRequest = buildSmartPromptRequest(
          presetKey,
          response.content,
          metadata,
          presetModes
        );

        chatMainArea.style.display = 'block';
        oneoffInstructionArea.style.display = 'none';
        makeApiCall(promptRequest);
        loadingManager.showToast(successText, 'success');

        showSiteSuggestions(response.url, response.platform, response.platformInfo);

        if (metadata.siteName === 'YouTube' || response.type?.includes('youtube')) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'captureVideoFrames' }, (frameRes) => {
                if (frameRes && frameRes.success && frameRes.frame) {
                  chatUI.addMessage('System', '📸 Visual context captured from video:');
                  chatUI.addMediaPreview({
                    type: 'image',
                    mimeType: 'image/jpeg',
                    base64: frameRes.frame.split(',')[1],
                  });
                }
              });
            }
          });
        }
      } else {
        loadingManager.showToast('No content received from tab.', 'error');
      }
    } else {
      loadingManager.showToast('Unexpected response from background script', 'error');
    }
  } catch (error) {
    console.error('ChatPageActions: Execute preset error:', error.message);
    loadingManager.showToast(friendlyRuntimeErrorMessage(error), 'error');
  }
}
