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

export function buildSmartPrompt(presetKey, content, metadata, presetModes) {
  const preset = presetModes[presetKey] || presetModes.summary;
  let prompt = preset.prompt;

  if (metadata.siteName === 'YouTube' || metadata.type?.includes('youtube')) {
    prompt += `\n\nThis is a video titled "${metadata.title}" from channel "${metadata.byline}".`;
  } else if (metadata.url?.includes('github.com') || metadata.url?.includes('gitlab.com')) {
    prompt += `\n\nThis is code from "${metadata.title}".`;
  } else if (metadata.byline) {
    prompt += `\n\nThis is an article titled "${metadata.title}" by ${metadata.byline}.`;
  }

  return prompt + `\n\nContent:\n${content}`;
}

export async function renderSiteSuggestions(input) {
  const {
    url,
    platform = null,
    platformInfo = null,
    chatMainArea,
    oneoffInstructionArea,
    makeApiCall,
    chatAreaElement,
  } = input;
  const siteKey = extractSiteKey(url);
  const suggestions = siteKey ? await getSuggestionsForSite(siteKey) : [];
  const actionCards = inferActionCards({ url, platform, platformInfo });
  if (suggestions.length === 0 && actionCards.length === 0) return;

  const container = document.createElement('div');
  container.className = 'site-suggestions-container';
  container.innerHTML = '<div class="site-suggestions-label">Quick actions for this page:</div>';

  const chips = document.createElement('div');
  chips.className = 'site-suggestions-chips';

  for (const card of actionCards) {
    const chip = document.createElement('button');
    chip.className = 'site-suggestion-chip site-suggestion-chip-primary';
    chip.textContent = card.title;
    chip.title = card.prompt;
    chip.addEventListener('click', () => {
      chatMainArea.style.display = 'block';
      oneoffInstructionArea.style.display = 'none';
      makeApiCall(card.prompt);
    });
    chips.appendChild(chip);
  }

  for (const s of suggestions) {
    const chip = document.createElement('button');
    chip.className = 'site-suggestion-chip';
    chip.textContent = s.command;
    chip.title = s.prompt;
    chip.addEventListener('click', () => {
      chatMainArea.style.display = 'block';
      oneoffInstructionArea.style.display = 'none';
      makeApiCall(s.prompt);
    });
    chips.appendChild(chip);
  }

  container.appendChild(chips);
  if (chatAreaElement) chatAreaElement.appendChild(container);
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
        const prompt = buildSmartPrompt(presetKey, response.content, metadata, presetModes);

        chatMainArea.style.display = 'block';
        oneoffInstructionArea.style.display = 'none';
        makeApiCall(prompt);
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
