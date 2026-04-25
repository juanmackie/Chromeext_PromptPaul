/**
 * @fileoverview Chat Interface for Prompt Paul Chrome Extension
 *
 * This module handles the side panel chat interface including:
 * - Message sending and receiving
 * - Streaming API response handling
 * - Quick actions (load content, summarize, explain)
 * - Pinned custom instructions
 * - Copy functionality for messages
 * - Voice input support
 *
 * @module chat
 * @requires ./themeUtils.js
 * @requires ./loadingManager.js
 */

import { setupThemeToggle } from './themeUtils.js';
import { loadingManager } from './loadingManager.js';
import { normalizeToolChoice } from './src/utils/toolChoiceBuilder.js';
import { chatUI } from './src/chat/ChatUI.js';
import { getApiConfig, getApiConfigCached, getTools, startRun, executeRun, abortRun } from './src/chat/ChatAPI.js';
import {
  MediaType,
  validateMediaData,
  getMediaAnalysisPrompt,
  prepareMediaContent,
  hasValidMediaData,
  getMediaDisplayName,
  supportsVisionAnalysis,
} from './src/chat/ChatMedia.js';
import { StreamStateManager } from './src/chat/ChatStream.js';
import { debounce } from './src/utils/debounce.js';

// ── Lazy Module Loaders ───────────────────────────────────────────
// Non-critical modules are loaded on demand to reduce initial startup cost.

/** @type {import('./src/chat/ChatSkills.js') | null} */
let _chatSkillsModule = null;

/**
 * Lazy-load the ChatSkills module.
 * Loaded on first "/" keypress or skill command invocation.
 * @returns {Promise<import('./src/chat/ChatSkills.js')>}
 */
async function getChatSkills() {
  if (!_chatSkillsModule) {
    _chatSkillsModule = await import('./src/chat/ChatSkills.js');
  }
  return _chatSkillsModule;
}

/** @type {import('./src/chat/ChatVoice.js') | null} */
let _chatVoiceModule = null;

/**
 * Lazy-load the ChatVoice module.
 * Loaded on first voice-toggle button click.
 * @returns {Promise<import('./src/chat/ChatVoice.js')>}
 */
async function getChatVoice() {
  if (!_chatVoiceModule) {
    _chatVoiceModule = await import('./src/chat/ChatVoice.js');
  }
  return _chatVoiceModule;
}

/** @type {import('./src/chat/ChatAPI.js') | null} */
let _chatApiModule = null;

/**
 * Lazy-load the ChatAPI module for fresh config reads.
 * @returns {Promise<import('./src/chat/ChatAPI.js')>}
 */
async function getChatApi() {
  if (!_chatApiModule) {
    _chatApiModule = await import('./src/chat/ChatAPI.js');
  }
  return _chatApiModule;
}

/** @type {import('./src/chat/ChatMedia.js') | null} */
let _chatMediaModule = null;

/**
 * Lazy-load the ChatMedia module for media-heavy operations.
 * @returns {Promise<import('./src/chat/ChatMedia.js')>}
 */
async function getChatMedia() {
  if (!_chatMediaModule) {
    _chatMediaModule = await import('./src/chat/ChatMedia.js');
  }
  return _chatMediaModule;
}

/**
 * Error boundary wrapper for async operations.
 * Provides consistent error handling with user feedback.
 * @param {Function} asyncFn - The async function to wrap
 * @param {Object} options - Error handling options
 * @param {string} options.context - Description of the operation for logging
 * @param {boolean} options.showToast - Whether to show error toast (default: true)
 * @param {string} options.fallbackMessage - Custom error message if function fails
 * @returns {Promise<any>} The result of the async function or undefined on error
 */
async function handleAsyncError(asyncFn, options = {}) {
  const { context = 'Operation', showToast = true, fallbackMessage } = options;
  try {
    return await asyncFn();
  } catch (error) {
    const errorMessage = fallbackMessage || `${context} failed: ${error.message}`;
    console.error(`Chat Error [${context}]:`, error);
    if (showToast) {
      loadingManager.showToast(errorMessage, 'error');
    }
    return undefined;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const chatArea = document.getElementById('chat-area');
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const selectedTextDiv = document.getElementById('selectedText');
  const instructionInput = document.getElementById('instructionInput');
  const submitBtn = document.getElementById('submitBtn');
  const chatMainArea = document.getElementById('chat-main-area');
  const oneoffInstructionArea = document.getElementById('oneoff-instruction-area');

  // Quick Actions Sidebar Elements
  const addPageButton = document.getElementById('add-page-button');
  const analyzeButton = document.getElementById('analyze-button');
  const analyzeDropdown = document.getElementById('analyze-dropdown');
  const explainButton = document.getElementById('explain-button');

  // Configure marked with highlight.js for syntax highlighting
  if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
    marked.setOptions({
      highlight: function (code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (_) {
            return code;
          }
        }
        return code;
      },
    });
  }

  // Initialize chatUI DOM references
  chatUI.initialize();
  const pinnedActionsContainer = document.getElementById('pinned-actions-container');

  // Preset registry for analysis modes
  const PRESET_MODES = {
    summary: {
      key: 'summary',
      label: 'Summary',
      icon: 'auto_awesome',
      prompt: 'Please summarize the following content into a bullet list of key points.',
    },
    tldr: {
      key: 'tldr',
      label: 'TL;DR',
      icon: 'short_text',
      prompt: 'Provide a very brief TL;DR (3-4 sentences) of this content.',
    },
    technical: {
      key: 'technical',
      label: 'Technical',
      icon: 'code',
      prompt: 'Provide a technical deep dive of this content.',
    },
    executive: {
      key: 'executive',
      label: 'Executive',
      icon: 'assignment',
      prompt: 'Provide an executive summary of this content.',
    },
  };

  let lastUsedPreset = 'summary'; // Default preset mode

  /**
   * Helper to execute a preset analysis.
   */
  async function executePreset(presetKey, loadingText, successText) {
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
          const prompt = buildSmartPrompt(presetKey, response.content, metadata);

          chatMainArea.style.display = 'block';
          oneoffInstructionArea.style.display = 'none';
          makeApiCall(prompt);
          loadingManager.showToast(successText, 'success');

          if (metadata.siteName === 'YouTube' || response.type?.includes('youtube')) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) {
                chrome.tabs.sendMessage(
                  tabs[0].id,
                  { action: 'captureVideoFrames' },
                  (frameRes) => {
                    if (frameRes && frameRes.success && frameRes.frame) {
                      chatUI.addMessage('System', '📸 Visual context captured from video:');
                      chatUI.addMediaPreview({
                        type: 'image',
                        mimeType: 'image/jpeg',
                        base64: frameRes.frame.split(',')[1],
                      });
                    }
                  }
                );
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
      console.error('Chat.js: Execute preset error:', error.message);
      loadingManager.showToast(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Helper to execute a specific preset mode.
   */
  async function executePresetMode(modeKey) {
    const preset = PRESET_MODES[modeKey];
    if (!preset) {
      console.warn('Unknown preset mode:', modeKey);
      return;
    }
    lastUsedPreset = modeKey;
    executePreset(modeKey, `Generating ${preset.label}...`, `${preset.label} started`);
  }

  /**
   * Builds a smart prompt with dynamic context injection based on content type.
   */
  function buildSmartPrompt(presetKey, content, metadata) {
    const preset = PRESET_MODES[presetKey] || PRESET_MODES.summary;
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

  // Add event listeners for quick action buttons
  if (addPageButton) {
    addPageButton.addEventListener('click', async () => {
      try {
        loadingManager.showToast('Loading tab content...', 'info');

        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'getLoadContent' }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(res);
            }
          });
        });

        if (response && response.action === 'loadContentResponse') {
          if (response.success && response.content) {
            let sourceInfo = response.title;
            if (response.siteName) sourceInfo = `${response.title} (${response.siteName})`;
            if (response.byline) sourceInfo += ` by ${response.byline}`;

            chatUI.addLoadedContentMessage(sourceInfo, response.content);

            streamState.getConversationHistory().push({
              role: 'user',
              content: `I have loaded the content from the page "${response.title}" (${response.url}).\nSource: ${response.siteName || 'Unknown'}\nAuthor: ${response.byline || 'Unknown'}\n\nHere is the content:\n\n${response.content}`,
            });

            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.focus();
            loadingManager.showToast(
              'Content loaded! You can now ask questions about it.',
              'success'
            );
          } else {
            const errorMsg = response.error || 'Content not available';
            console.error('Chat.js: Add page button - Failed:', errorMsg);
            loadingManager.showToast('No content received: ' + errorMsg, 'error');
          }
        } else {
          loadingManager.showToast('Unexpected response from background script', 'error');
        }
      } catch (error) {
        console.error('Chat.js: Add page button - Error:', error.message);
        loadingManager.showToast(`Error: ${error.message}`, 'error');
      }
    });
  }

  // Analyze button - runs last used preset mode
  if (analyzeButton) {
    analyzeButton.addEventListener('click', () => {
      executePresetMode(lastUsedPreset);
    });
  }

  // Analyze dropdown - shows preset menu
  let presetMenuVisible = false;
  let presetMenu = null;

  function createPresetMenu() {
    if (presetMenu) return presetMenu;

    presetMenu = document.createElement('div');
    presetMenu.id = 'preset-menu';

    Object.values(PRESET_MODES).forEach((preset) => {
      const item = document.createElement('button');
      item.className = 'preset-menu-item';
      item.dataset.mode = preset.key;
      item.innerHTML = `<span class="material-icons">${preset.icon}</span>${preset.label}`;

      item.addEventListener('click', () => {
        lastUsedPreset = preset.key;
        hidePresetMenu();
        executePresetMode(preset.key);
      });

      presetMenu.appendChild(item);
    });

    document.body.appendChild(presetMenu);
    return presetMenu;
  }

  function showPresetMenu() {
    const menu = createPresetMenu();
    const btn = analyzeDropdown.getBoundingClientRect();
    menu.style.left = `${btn.left}px`;
    menu.style.top = `${btn.bottom + 4}px`;
    menu.style.display = 'block';
    presetMenuVisible = true;
  }

  function hidePresetMenu() {
    if (presetMenu) {
      presetMenu.style.display = 'none';
    }
    presetMenuVisible = false;
  }

  if (analyzeDropdown) {
    analyzeDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      if (presetMenuVisible) {
        hidePresetMenu();
      } else {
        showPresetMenu();
      }
    });
  }

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (presetMenuVisible && !presetMenu?.contains(e.target)) {
      hidePresetMenu();
    }
  });

  // Custom Prompts Dropdown
  let customPromptsMenuVisible = false;
  let customPromptsMenu = null;

  async function createCustomPromptsMenu() {
    if (customPromptsMenu) return customPromptsMenu;
    customPromptsMenu = document.createElement('div');
    customPromptsMenu.id = 'custom-prompts-menu';
    document.body.appendChild(customPromptsMenu);
    return customPromptsMenu;
  }

  async function populateCustomPromptsMenu() {
    const menu = await createCustomPromptsMenu();
    menu.innerHTML = '';

    const { instructions, pinnedQuickActions } = await new Promise((resolve) => {
      chrome.storage.local.get(['instructions', 'pinnedQuickActions'], resolve);
    });

    const allInstructions = instructions || [];
    const pinnedIds = new Set(pinnedQuickActions || []);

    if (allInstructions.length === 0) {
      menu.innerHTML =
        '<div class="custom-prompt-item" style="color:var(--ext-muted-foreground);font-style:italic;cursor:default;">No custom prompts</div>';
      return;
    }

    const sorted = [...allInstructions].sort((a, b) => {
      const aPinned = pinnedIds.has(a.id);
      const bPinned = pinnedIds.has(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    sorted.forEach((instruction) => {
      const isPinned = pinnedIds.has(instruction.id);
      const item = document.createElement('button');
      item.className = 'custom-prompt-item' + (isPinned ? ' pinned' : '');
      const iconLetter = instruction.name ? instruction.name[0].toUpperCase() : '?';
      item.innerHTML = `<span class="custom-prompt-icon">${iconLetter}</span>${instruction.name}`;
      item.addEventListener('click', () => {
        hideCustomPromptsMenu();
        executeCustomPrompt(instruction);
      });
      menu.appendChild(item);
    });
  }

  async function showCustomPromptsMenu() {
    await populateCustomPromptsMenu();
    const btn = customPromptsDropdown.getBoundingClientRect();
    customPromptsMenu.style.left = `${btn.left}px`;
    customPromptsMenu.style.top = `${btn.bottom + 4}px`;
    customPromptsMenu.style.display = 'block';
    customPromptsMenuVisible = true;
  }

  function hideCustomPromptsMenu() {
    if (customPromptsMenu) customPromptsMenu.style.display = 'none';
    customPromptsMenuVisible = false;
  }

  async function executeCustomPrompt(instruction) {
    chatMainArea.style.display = 'block';
    oneoffInstructionArea.style.display = 'none';

    chrome.runtime.sendMessage(
      {
        action: 'getPinnedActionTabContent',
        instruction: {
          id: instruction.id,
          name: instruction.name,
          content: instruction.content,
          tool_choice: normalizeToolChoice(instruction.tool_choice),
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          loadingManager.showToast(`Error: ${chrome.runtime.lastError.message}`, 'error');
          return;
        }
        const orig = response?.instruction;
        if (!orig) {
          loadingManager.showToast('Error: Instruction details not returned', 'error');
          return;
        }

        let prompt = orig.content;
        if (response?.success && response.content) {
          prompt += '\n\nActive Tab Content:\n' + response.content;
          loadingManager.showToast(`Executing: ${orig.name}...`, 'info');
        }
        if (selectedText?.trim()) prompt += '\n\nSelected Text:\n' + selectedText;

        makeApiCall(prompt, normalizeToolChoice(orig.tool_choice));
      }
    );
  }

  const customPromptsDropdown = document.getElementById('custom-prompts-dropdown');
  if (customPromptsDropdown) {
    customPromptsDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      customPromptsMenuVisible ? hideCustomPromptsMenu() : showCustomPromptsMenu();
    });
  }

  document.addEventListener('click', (e) => {
    if (
      customPromptsMenuVisible &&
      !customPromptsMenu?.contains(e.target) &&
      !customPromptsDropdown?.contains(e.target)
    ) {
      hideCustomPromptsMenu();
    }
  });

  if (explainButton) {
    explainButton.addEventListener('click', async () => {
      try {
        loadingManager.showToast('Requesting tab content for explanation...', 'info');

        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'getExplainContent' }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(res);
            }
          });
        });

        if (response && response.action === 'explainContentResponse') {
          if (response.success && response.content) {
            const prompt = 'Explain the following text:\n\n' + response.content;
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            makeApiCall(prompt);
            loadingManager.showToast('Tab content received, explaining...', 'success');
          } else {
            const errorMsg = response.error || 'Content not available';
            console.error('Chat.js: Explain button - Failed to get content:', errorMsg);
            loadingManager.showToast('No content received for explanation: ' + errorMsg, 'error');
          }
        } else {
          console.warn('Chat.js: Explain button - Received unexpected response:', response);
          loadingManager.showToast(
            'Received an unexpected response for explain action.',
            'warning'
          );
        }
      } catch (error) {
        console.error('Chat.js: Explain button - Error:', error.message);
        loadingManager.showToast(`Error: ${error.message}`, 'error');
      }
    });
  }

  const darkThemeToggle = document.getElementById('darkThemeToggle');
  if (darkThemeToggle) {
    setupThemeToggle(darkThemeToggle);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.pinnedQuickActions || changes.instructions)) {
      renderPinnedActions();
    }
  });

  const PENDING_PANEL_ACTION_KEY = 'pendingPanelAction';

  let selectedText = null;
  let tabId = null;
  let panelTabId = null; // Owning tab for this side panel (set from message sender)
  let currentAbortController = null;
  let lastProcessedPanelActionId = null;

  // Streaming and API call state manager
  const streamState = new StreamStateManager();

  // Convenience aliases for backward compatibility
  const getCurrentRunId = () => streamState.getRunId();
  const setCurrentRunId = (id) => streamState.setRunId(id);
  const getCurrentSourceTabId = () => streamState.getSourceTabId();
  const setCurrentSourceTabId = (id) => streamState.setSourceTabId(id);
  const getCurrentMediaData = () => streamState.getMediaData();
  const setCurrentMediaData = (data) => streamState.setMediaData(data);
  const getConversationHistory = () => streamState.getConversationHistory();
  const setConversationHistory = (history) => streamState.setConversationHistory(history);

  /**
   * Stops the current API request by aborting the orchestrator run.
   */
  function stopApiRequest() {
    if (streamState.getRunId()) {
      abortRun(streamState.getRunId());
    }
  }

  /**
   * Retrieves the API configuration from Chrome storage.
   * @returns {Promise<Object>} The selected profile configuration.
   * @throws {Error} If configuration is incomplete or cannot be read.
   */
  /**
   * Attaches click event listeners to copy icons for copying message content.
   * @param {string} rawMessage - The raw text message to copy.
   * @param {HTMLElement} contentElement - The element containing the formatted content.
   * @param {HTMLElement} copyIconElement - The copy icon element for plain text.
   * @param {HTMLElement} copyFormattedIconElement - The copy icon element for formatted text.
   */

  function applySetSelectedTextAction(request) {
    if (request.actionId && request.actionId === lastProcessedPanelActionId) {
      return;
    }

    if (request.actionId) {
      lastProcessedPanelActionId = request.actionId;
    }

    selectedText = request.selectedText || '';
    tabId = request.tabId;

    // Handle media data from context menu
    if (request.mediaData) {
      streamState.setMediaData(request.mediaData);

      // Show chat area with media preview
      chatMainArea.style.display = 'block';
      oneoffInstructionArea.style.display = 'none';

      if (streamState.getMediaData().error) {
        chatUI.addMessage(
          'System',
          `❌ Error loading ${streamState.getMediaData().type}: ${streamState.getMediaData().error}`
        );
      } else if (streamState.getMediaData().base64) {
        chatUI.addMediaPreview(streamState.getMediaData());
      }
    } else if (request.fromStartChat) {
      chatMainArea.style.display = 'block';
      oneoffInstructionArea.style.display = 'none';
      streamState.clearHistory();
    } else {
      selectedTextDiv.textContent = selectedText;
      chatMainArea.style.display = 'none';
      oneoffInstructionArea.style.display = 'block';
    }
  }

  function consumePendingPanelAction(pendingAction) {
    if (!pendingAction || pendingAction.action !== 'setSelectedText') {
      return;
    }

    // Filter: only process pending actions for our panel
    if (pendingAction.tabId && panelTabId && pendingAction.tabId !== panelTabId) {
      console.log('Chat: Ignoring pending action for other panel');
      // Clear it anyway to prevent stuck queue
      if (chrome.storage?.session) {
        chrome.storage.session.remove([PENDING_PANEL_ACTION_KEY]);
      }
      return;
    }

    applySetSelectedTextAction(pendingAction);

    if (!chrome.storage?.session) {
      return;
    }

    chrome.storage.session.get([PENDING_PANEL_ACTION_KEY], (result) => {
      const storedAction = result?.[PENDING_PANEL_ACTION_KEY];
      if (!storedAction) {
        return;
      }

      if (
        !pendingAction.actionId ||
        !storedAction.actionId ||
        storedAction.actionId === pendingAction.actionId
      ) {
        chrome.storage.session.remove([PENDING_PANEL_ACTION_KEY]);
      }
    });
  }

  function consumePendingPanelActionOnLoad() {
    if (!chrome.storage?.session) {
      return;
    }

    chrome.storage.session.get([PENDING_PANEL_ACTION_KEY], (result) => {
      const pendingAction = result?.[PENDING_PANEL_ACTION_KEY];
      consumePendingPanelAction(pendingAction);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') {
      return;
    }

    const pendingActionChange = changes[PENDING_PANEL_ACTION_KEY];
    if (pendingActionChange?.newValue) {
      consumePendingPanelAction(pendingActionChange.newValue);
    }
  });

  function isSkillLoaderTool(toolName) {
    return toolName === 'load_skill' || toolName === 'skill_view';
  }

  function tryParseToolPayload(value) {
    if (value == null || value === '') return {};
    if (typeof value === 'object') return value;

    const normalized = String(value).trim();
    if (!normalized) return {};

    try {
      return JSON.parse(normalized);
    } catch (error) {
      for (let i = normalized.length - 1; i >= 0; i--) {
        const char = normalized[i];
        if (char !== '{' && char !== '[') continue;

        try {
          return JSON.parse(normalized.slice(i));
        } catch (innerError) {
          // Keep scanning for a recoverable trailing JSON payload.
        }
      }
      throw error;
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Capture panel's owning tab on first message (establishes identity)
    if (sender.tab?.id && panelTabId === null) {
      panelTabId = sender.tab.id;
      console.log('Chat: Panel registered with tabId:', panelTabId);
    }

    // Helper: check if this message belongs to our panel
    const isPanelAction =
      request.tabId != null && panelTabId != null && request.tabId !== panelTabId;

    if (request.action === 'setSelectedText') {
      // Filter out messages for other panels
      if (isPanelAction) {
        console.log(
          'Chat: Ignoring setSelectedText for other panel',
          request.tabId,
          'vs',
          panelTabId
        );
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      applySetSelectedTextAction(request);
      if (sendResponse) sendResponse({ success: true });
      return true;
    } else if (request.action === 'setMediaForAnalysis') {
      // Filter out messages for other panels
      if (isPanelAction) {
        console.log(
          'Chat: Ignoring setMediaForAnalysis for other panel',
          request.tabId,
          'vs',
          panelTabId
        );
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }

      // Dedupe: skip if we've already processed this action
      if (request.actionId && request.actionId === lastProcessedPanelActionId) {
        console.log('Chat: Ignoring duplicate setMediaForAnalysis actionId:', request.actionId);
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      if (request.actionId) {
        lastProcessedPanelActionId = request.actionId;
      }

      // Handle media data from context menu
      const mediaData = request.mediaData;
      tabId = request.tabId;

      // Show chat area
      chatMainArea.style.display = 'block';
      oneoffInstructionArea.style.display = 'none';

      if (mediaData.loading) {
        // Show loading state
        chatUI.addMessage('System', `📥 Loading ${mediaData.type} for analysis...`);
      } else if (mediaData.error) {
        // Show error
        chatUI.addMessage('System', `❌ Error loading ${mediaData.type}: ${mediaData.error}`);
      } else if (mediaData.base64 || mediaData.textPrompt) {
        // Media loaded successfully OR text-only from context menu
        if (mediaData.base64) {
          streamState.setMediaData(mediaData);
          chatUI.addMediaPreview(streamState.getMediaData());
        }

        // Use textPrompt if provided (from text-only context menu)
        const promptText = mediaData.textPrompt || mediaData.prompt;

        // Generate prompt based on action type
        let analysisPrompt;
        if (mediaData.actionType === 'custom' && mediaData.instructionId) {
          // Handle custom instruction
          chrome.storage.local.get(['instructions'], (result) => {
            const instructions = result.instructions || [];
            const instruction = instructions.find((i) => i.id === mediaData.instructionId);
            let instructionToolChoice = 'auto';
            if (instruction) {
              analysisPrompt = mediaData.textPrompt || instruction.content;
              instructionToolChoice = normalizeToolChoice(instruction.tool_choice);
              chatUI.addMessage('System', `🎯 Using custom instruction: "${instruction.name}"`);
            } else {
              analysisPrompt =
                mediaData.textPrompt ||
                getMediaAnalysisPrompt('default', streamState.getMediaData());
            }

            if (streamState.getMediaData()) {
              makeApiCallWithMedia(
                analysisPrompt,
                streamState.getMediaData(),
                instructionToolChoice
              );
            } else {
              makeApiCall(analysisPrompt, instructionToolChoice);
            }
          });
          return; // Exit early for async custom instruction handling
        } else if (mediaData.actionType === 'summarize') {
          analysisPrompt =
            mediaData.textPrompt || getMediaAnalysisPrompt('summarize', streamState.getMediaData());
          chatUI.addMessage('System', `📝 Summarizing...`);
        } else if (mediaData.actionType === 'explain') {
          analysisPrompt =
            mediaData.textPrompt || getMediaAnalysisPrompt('explain', streamState.getMediaData());
          chatUI.addMessage('System', `💡 Explaining...`);
        } else {
          // Default analysis
          analysisPrompt =
            mediaData.textPrompt || getMediaAnalysisPrompt('default', streamState.getMediaData());
          chatUI.addMessage('System', `🔍 Analyzing...`);
        }

        if (streamState.getMediaData()) {
          makeApiCallWithMedia(analysisPrompt, streamState.getMediaData());
        } else {
          makeApiCall(analysisPrompt);
        }
      }
      if (sendResponse) sendResponse({ success: true });
      return true;
    } else if (request.action === 'setApiResponse') {
      // Filter: ignore if we have an active orchestrator run (deprecated legacy path)
      if (streamState.getRunId()) {
        console.log('Chat: Ignoring setApiResponse - orchestrator owns the run');
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      // Also filter by tabId if provided
      if (request.tabId && panelTabId && request.tabId !== panelTabId) {
        console.log('Chat: Ignoring setApiResponse for other tab');
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      chatMainArea.style.display = 'block';
      oneoffInstructionArea.style.display = 'none';
      userInput.disabled = false;
      sendButton.disabled = false;
      if (streamState.getCurrentStreamingMessageDiv()) {
        streamState.setStreamingElements(
          null,
          streamState.getCurrentStreamingContentElement(),
          streamState.getCurrentStreamingUniqueId()
        );
        streamState.setStreamingElements(
          streamState.getCurrentStreamingMessageDiv(),
          null,
          streamState.getCurrentStreamingUniqueId()
        );
        streamState.setStreamingElements(
          streamState.getCurrentStreamingMessageDiv(),
          streamState.getCurrentStreamingContentElement(),
          null
        );
        streamState.clearStreamedText();
        streamState.appendStreamedText('');
      }
      if (request.prompt) {
        // Add user prompt to history if not already there
        const lastMessage =
          streamState.getConversationHistory()[streamState.getConversationHistory().length - 1];
        if (
          !lastMessage ||
          !(lastMessage.role === 'user' && lastMessage.content === request.prompt)
        ) {
          chatUI.addMessage('User', request.prompt.split('\n')[0]); // Display shortened prompt
          streamState.addMessageToHistory({ role: 'user', content: request.prompt });
        }
      }

      if (request.apiResponse && typeof request.apiResponse === 'string') {
        // Standard text response (OpenAI, or Anthropic, or error string)
        chatUI.addMessage('LLM', request.apiResponse);
        const lastAssistantMessage =
          streamState.getConversationHistory().length > 0 &&
          streamState.getConversationHistory()[streamState.getConversationHistory().length - 1]
            .role === 'assistant'
            ? streamState.getConversationHistory()[streamState.getConversationHistory().length - 1]
                .content
            : null;
        if (lastAssistantMessage !== request.apiResponse) {
          streamState.addMessageToHistory({ role: 'assistant', content: request.apiResponse });
        }
      } else if (request.apiResponse) {
        // Fallback for unexpected structure
        console.warn(
          'Chat: setApiResponse received apiResponse in unexpected format:',
          request.apiResponse
        );
        chatUI.addMessage('LLM', JSON.stringify(request.apiResponse));
        streamState
          .getConversationHistory()
          .push({ role: 'assistant', content: JSON.stringify(request.apiResponse) });
      }
      if (sendResponse) sendResponse({ success: true });
      return true;
    } else if (request.action === 'streamApiStart') {
      // Filter: ignore if we have an active orchestrator run
      if (streamState.getRunId()) {
        console.log('Chat: Ignoring streamApiStart - orchestrator owns the run');
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      // Also filter by tabId
      if (request.tabId && panelTabId && request.tabId !== panelTabId) {
        console.log('Chat: Ignoring streamApiStart for other tab');
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      chatMainArea.style.display = 'block';
      oneoffInstructionArea.style.display = 'none';
      userInput.disabled = true;
      sendButton.disabled = true;
      if (request.prompt) {
        const lastMessage =
          streamState.getConversationHistory()[streamState.getConversationHistory().length - 1];
        if (
          !lastMessage ||
          !(lastMessage.role === 'user' && lastMessage.content === request.prompt)
        ) {
          chatUI.addMessage('User', request.prompt.split('\n')[0]);
          streamState.addMessageToHistory({ role: 'user', content: request.prompt });
        }
      }
      streamState.clearStreamedText();
      streamState.appendStreamedText('');
      const { messageDiv, contentElement, uniqueIdString } = chatUI.addMessage('LLM', '');
      streamState.setStreamingElements(
        messageDiv,
        streamState.getCurrentStreamingContentElement(),
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        contentElement,
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        streamState.getCurrentStreamingContentElement(),
        uniqueIdString
      );
      if (sendResponse) sendResponse({ success: true });
      return true;
    } else if (request.action === 'streamApiResponseChunk') {
      // Filter: ignore if we have an active orchestrator run (deprecated legacy path)
      if (streamState.getRunId()) {
        return;
      }
      if (streamState.getActiveToolCall()) return; // If a tool call is active, don't process further text chunks for this bubble
      if (streamState.getCurrentStreamingContentElement() && request.chunk != null) {
        streamState.appendStreamedText(request.chunk);
        streamState.getCurrentStreamingContentElement().innerHTML = marked.parse(
          streamState.getStreamedText()
        );
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    } else if (request.action === 'orchestratorEvent') {
      // NEW: Handle events from orchestrator
      const { runId, sourceTabId, event } = request;

      // Filter events: must match our current run AND come from our tab (or have no source)
      const isOwnedEvent =
        streamState.getRunId() &&
        runId === streamState.getRunId() &&
        (!sourceTabId || sourceTabId === panelTabId || !streamState.getSourceTabId());

      if (!isOwnedEvent) {
        console.log('Chat: Ignoring orchestratorEvent for other run/tab', {
          runId,
          sourceTabId,
          panelTabId,
          currentRunId: streamState.getRunId(),
          currentSourceTabId: streamState.getSourceTabId(),
        });
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }

      switch (event.type) {
        case 'content':
          if (streamState.getCurrentStreamingContentElement() && event.data) {
            streamState.appendStreamedText(event.data);
            streamState.getCurrentStreamingContentElement().innerHTML = marked.parse(
              streamState.getStreamedText()
            );
            chatArea.scrollTop = chatArea.scrollHeight;
          }
          break;

        case 'tool_start':
          streamState.setActiveToolCall(event.toolCall);
          if (streamState.getCurrentStreamingContentElement()) {
            if (event.capability === 'skill' || isSkillLoaderTool(event.toolCall.function.name)) {
              streamState.getCurrentStreamingContentElement().innerHTML = marked.parse(
                `📚 Loading skill: **${event.toolCall.function.name}**`
              );
            } else {
              streamState.getCurrentStreamingContentElement().innerHTML = marked.parse(
                `⚙️ Using tool: **${event.toolCall.function.name}**`
              );
            }
          }
          break;

        case 'tool_ready':
          chatUI.addMessage('System', `⚙️ Executing tool: **${event.toolCall.function.name}**...`);
          break;

        case 'tool_complete':
          // Distinguish tool vs skill in the trace
          if (isSkillLoaderTool(event.toolCall.function.name)) {
            try {
              const args = tryParseToolPayload(event.toolCall.function.arguments);
              const resultObj = tryParseToolPayload(event.result);
              const skillResult = resultObj?.result || resultObj;
              if (skillResult && skillResult.success) {
                chatUI.addMessage('System', `📚 Loaded skill: **${args.name || 'unknown'}**`);
                const skillContent = JSON.stringify(skillResult);
                const contentPreview =
                  skillContent.substring(0, 200) + (skillContent.length > 200 ? '...' : '');
                chatUI.addMessage(
                  'System',
                  `📝 Skill instructions preview:\n\`\`\`\n${contentPreview}\n\`\`\``
                );
              } else {
                chatUI.addMessage('System', `⚠️ Skill **${args.name || 'unknown'}** not found.`);
              }
            } catch (e) {
              console.warn(
                `Could not parse ${event.toolCall.function.name} arguments for traceability`
              );
            }
          } else {
            chatUI.addMessage('System', `✅ Tool ${event.toolCall.function.name} executed.`);
          }

          // Add assistant message with tool_calls before tool result
          streamState.addMessageToHistory({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: event.toolCall.id,
                type: 'function',
                function: {
                  name: event.toolCall.function.name,
                  arguments: event.toolCall.function.arguments,
                },
              },
            ],
          });

          // Add tool result to history
          streamState.getConversationHistory().push({
            role: 'tool',
            tool_call_id: event.toolCall.id,
            name: event.toolCall.function.name,
            content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
          });
          break;

        case 'tool_error':
          addMessage(
            'System',
            `❌ Error executing tool ${event.toolCall.function.name}: ${event.error}`
          );

          // Add assistant message with tool_calls before tool error result
          streamState.addMessageToHistory({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: event.toolCall.id,
                type: 'function',
                function: {
                  name: event.toolCall.function.name,
                  arguments: event.toolCall.function.arguments,
                },
              },
            ],
          });

          streamState.addMessageToHistory({
            role: 'tool',
            tool_call_id: event.toolCall.id,
            name: event.toolCall.function.name,
            content: `Error: ${event.error}`,
          });
          break;

        case 'complete': {
          // Finalize the existing streaming bubble instead of creating a duplicate
          if (streamState.getCurrentStreamingContentElement()) {
            const finalContent = event.content || streamState.getStreamedText() || '';
            streamState.getCurrentStreamingContentElement().innerHTML = marked.parse(finalContent);
            chatUI.postProcessRenderedContent(streamState.getCurrentStreamingContentElement());

            // Attach copy listeners to existing bubble
            // Copy listeners are now handled by ChatUI
          } else {
            // Fallback: create new bubble if no streaming element exists
            chatUI.addMessage('LLM', event.content || '');
          }

          // Persist final assistant content to conversation history
          const completeFinalContent = event.content || streamState.getStreamedText() || '';
          if (completeFinalContent) {
            streamState.addMessageToHistory({
              role: 'assistant',
              content: completeFinalContent,
            });
          }

          // Reset UI state
          userInput.disabled = false;
          sendButton.disabled = false;
          break;
        }
        case 'error': {
          chatUI.addMessage('System', `❌ Error: ${event.error}`);
          userInput.disabled = false;
          sendButton.disabled = false;
          clearButton.textContent = 'Clear';
          userInput.focus();

          // Reset streaming variables
          streamState.setStreamingElements(
            null,
            streamState.getCurrentStreamingContentElement(),
            streamState.getCurrentStreamingUniqueId()
          );
          streamState.setStreamingElements(
            streamState.getCurrentStreamingMessageDiv(),
            null,
            streamState.getCurrentStreamingUniqueId()
          );
          streamState.setStreamingElements(
            streamState.getCurrentStreamingMessageDiv(),
            streamState.getCurrentStreamingContentElement(),
            null
          );
          streamState.clearStreamedText();
          streamState.setActiveToolCall(null);
          streamState.setRunId(null);
          streamState.setSourceTabId(null);
          break;
        }
      }

      if (sendResponse) sendResponse({ success: true });
      return true;
    }
  });

  sendButton.addEventListener('click', sendMessage);
  const clearButton = document.getElementById('clear-button');
  clearButton.addEventListener('click', () => {
    if (clearButton.textContent === 'Stop') {
      stopApiRequest();
    } else {
      chatUI.clearChat();
    }
  });
  userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !userInput.disabled) {
      event.preventDefault();
      sendMessage();
    }
  });

  consumePendingPanelActionOnLoad();

  // ── Drag & Drop Support ────────────────────────────────────────

  const dropOverlay = document.getElementById('drop-overlay');

  function showDropOverlay() {
    if (dropOverlay) dropOverlay.style.display = 'flex';
  }
  function hideDropOverlay() {
    if (dropOverlay) dropOverlay.style.display = 'none';
  }

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    showDropOverlay();
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('dragleave', (e) => {
    // Only hide if we're leaving the document entirely
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      hideDropOverlay();
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    hideDropOverlay();

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    chatUI.addMessage('System', `📥 Processing ${files.length} dropped file(s)...`);

    for (const file of files) {
      try {
        const mediaModule = await getChatMedia();
        const validation = mediaModule.validateDroppedFile(file);
        if (!validation.valid) {
          chatUI.addMessage('System', `❌ ${validation.error}`);
          continue;
        }

        const fileData = await mediaModule.readFileAsBase64(file);
        const mediaType = file.type.startsWith('video/')
          ? MediaType.VIDEO
          : file.type.startsWith('audio/')
            ? MediaType.AUDIO
            : MediaType.IMAGE;

        const mediaData = {
          type: mediaType,
          mimeType: fileData.mimeType,
          base64: fileData.base64,
          textPrompt: `Analyze this ${mediaType}: ${fileData.name}`,
        };

        chatUI.addMediaPreview(mediaData);
        currentMediaData = mediaData;
        streamState.setMediaData(mediaData);

        // Auto-analyze with prompt
        const userPrompt = `Analyze this ${mediaModule.getMediaDisplayName(mediaType)}: ${fileData.name}`;
        makeApiCallWithMedia(userPrompt, mediaData);
      } catch (err) {
        console.error('Drop handler error:', err);
        chatUI.addMessage('System', `❌ Error processing ${file.name}: ${err.message}`);
      }
    }
  });


  /**
   * Makes an API call with media content (images, video, audio).
   * @param {string} userMessage - The user's message/prompt.
   * @param {Object} mediaData - The media data object containing base64, mimeType, etc.
   * @param {string} [tool_choice='auto'] - The tool choice strategy ('none', 'auto', or specific tool name).
   * @param {string|null} [requestedSkill=null] - Name of skill to preload via orchestrator.
   * @returns {Promise<void>}
   */
  async function makeApiCallWithMedia(
    userMessage,
    mediaData,
    tool_choice = 'auto',
    requestedSkill = null
  ) {
    try {
      const config = await getApiConfigCached();

      const effectiveToolChoice =
        tool_choice === undefined || tool_choice === null || tool_choice === ''
          ? 'auto'
          : tool_choice;

      // Store media data for the run
      streamState.setMediaData(mediaData);

      // Add user message to history if provided
      if (userMessage) {
        chatUI.addMessage('User', userMessage);

        // Create message content with media
        const messageContent = [{ type: 'text', text: userMessage }];

        // Add media content for vision models
        if (mediaData.type === 'image') {
          messageContent.push({
            type: 'image_url',
            image_url: { url: `data:${mediaData.mimeType};base64,${mediaData.base64}` },
          });
        }

        streamState.addMessageToHistory({
          role: 'user',
          content: messageContent,
        });
      }

      // Create UI elements for streaming
      const { messageDiv, contentElement, uniqueIdString } = chatUI.addMessage('LLM', '');
      streamState.setStreamingElements(
        messageDiv,
        streamState.getCurrentStreamingContentElement(),
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        contentElement,
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        streamState.getCurrentStreamingContentElement(),
        uniqueIdString
      );
      streamState.clearStreamedText();
      streamState.appendStreamedText('');
      userInput.disabled = true;
      sendButton.disabled = true;
      clearButton.textContent = 'Stop';

      // Prepare run configuration with media
      const runConfig = {
        llmEndpoint: config.llmEndpoint,
        apiKey: config.apiKey,
        modelName: config.modelName,
        systemPrompt: config.systemPrompt,
        tool_choice: effectiveToolChoice,
        tools: await getTools(),
        mediaData: mediaData,
        requestedSkill,
        sourceTabId: panelTabId,
      };

      // Start orchestrator run using ChatAPI module
      streamState.setRunId(await startRun(runConfig));
      streamState.setSourceTabId(panelTabId);

      // Execute the run using ChatAPI module
      await executeRun(streamState.getRunId(), streamState.getConversationHistory());
    } catch (error) {
      console.error('makeApiCallWithMedia Error:', error);
      chatUI.addMessage('System', 'Error: ' + error.message);
      userInput.disabled = false;
      sendButton.disabled = false;
      clearButton.textContent = 'Clear';
      userInput.focus();

      // Reset state
      streamState.setMediaData(null);
      streamState.setStreamingElements(
        null,
        streamState.getCurrentStreamingContentElement(),
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        null,
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        streamState.getCurrentStreamingContentElement(),
        null
      );
      streamState.clearStreamedText();
      streamState.appendStreamedText('');
      streamState.setActiveToolCall(null);
      streamState.setRunId(null);
      streamState.setSourceTabId(null);
    }
  }

  async function sendMessage() {
    streamState.setActiveToolCall(null); // Reset active tool call
    const message = userInput.value;
    if (message.trim() && !userInput.disabled) {
      // Fetch available skills
      const skillsResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSkills' }, (response) => {
          if (chrome.runtime.lastError) resolve({ skills: [] });
          else resolve(response || { skills: [] });
        });
      });
      const availableSkills = skillsResp && skillsResp.skills ? skillsResp.skills : [];
      const skillsModule = await getChatSkills();

      // Check for slash commands
      const cmd = skillsModule.parseCommand(message, availableSkills);

      if (cmd.type === 'skills') {
        chatUI.addMessage('User', message);
        const slashCommands = skillsResp.slashCommands || [];
        const skillsMessage = skillsModule.formatSkillsList(availableSkills, slashCommands);
        chatUI.addMessage('System', skillsMessage);
        userInput.value = '';
        return;
      }

      let requestedSkill = null;
      let effectiveMessage = message;

      if (cmd.type === 'skill') {
        requestedSkill = cmd.skillName;
        effectiveMessage = cmd.body || message;
        chatUI.addMessage('System', `📚 Loading skill: **${requestedSkill}**`);
      } else {
        // Fall back to natural-language intent detection
        const detectedSkill = skillsModule.detectSkillIntent(message, availableSkills);
        if (detectedSkill) {
          requestedSkill = detectedSkill.skillName;
          effectiveMessage = detectedSkill.body || message;
          chatUI.addMessage(
            'System',
            `🎯 Skill detected: **${requestedSkill}**. Loading skill instructions...`
          );
        }
      }

      if (streamState.getMediaData()) {
        makeApiCallWithMedia(effectiveMessage, streamState.getMediaData(), 'auto', requestedSkill);
        streamState.setMediaData(null); // Clear media after use
      } else {
        makeApiCall(effectiveMessage, 'auto', requestedSkill);
      }
      userInput.value = '';
    }
  }

  /**
   * Makes an API call to the LLM endpoint using the orchestrator.
   * @param {string|null} [userMessage=null] - The user's message/prompt.
   * @param {string} [tool_choice='auto'] - The tool choice strategy ('none', 'auto', or specific tool name).
   * @param {string|null} [requestedSkill=null] - Name of skill to preload via orchestrator.
   * @returns {Promise<void>}
   */
  async function makeApiCall(userMessage = null, tool_choice = 'auto', requestedSkill = null) {
    try {
      const config = await getApiConfig();

      const effectiveToolChoice =
        tool_choice === undefined || tool_choice === null || tool_choice === ''
          ? 'auto'
          : tool_choice;

      // Add user message to history if provided
      if (userMessage) {
        chatUI.addMessage('User', userMessage);

        if (streamState.getMediaData() && streamState.getMediaData().type === 'image') {
          const messageContent = [
            { type: 'text', text: userMessage },
            {
              type: 'image_url',
              image_url: {
                url: `data:${streamState.getMediaData().mimeType};base64,${streamState.getMediaData().base64}`,
              },
            },
          ];
          streamState.addMessageToHistory({ role: 'user', content: messageContent });
        } else {
          streamState.addMessageToHistory({ role: 'user', content: userMessage });
        }

        streamState.setMediaData(null); // Clear after use
      }

      // Prepare run configuration
      const runConfig = {
        llmEndpoint: config.llmEndpoint,
        apiKey: config.apiKey,
        modelName: config.modelName,
        systemPrompt: config.systemPrompt,
        tool_choice: effectiveToolChoice,
        tools: await getTools(),
        requestedSkill,
        sourceTabId: panelTabId,
      };

      // Create UI elements for streaming
      const { messageDiv, contentElement, uniqueIdString } = chatUI.addMessage('LLM', '');
      streamState.setStreamingElements(
        messageDiv,
        streamState.getCurrentStreamingContentElement(),
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        contentElement,
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        streamState.getCurrentStreamingContentElement(),
        uniqueIdString
      );
      streamState.clearStreamedText();
      streamState.appendStreamedText('');
      userInput.disabled = true;
      sendButton.disabled = true;
      clearButton.textContent = 'Stop';

      // Start orchestrator run using ChatAPI module
      streamState.setRunId(await startRun(runConfig));
      streamState.setSourceTabId(panelTabId);

      // Execute the run using ChatAPI module
      await executeRun(streamState.getRunId(), streamState.getConversationHistory());
    } catch (error) {
      console.error('makeApiCall Error:', error);
      chatUI.addMessage('System', 'Error: ' + error.message);
      userInput.disabled = false;
      sendButton.disabled = false;
      clearButton.textContent = 'Clear';
      userInput.focus();

      // Reset streaming state
      streamState.setStreamingElements(
        null,
        streamState.getCurrentStreamingContentElement(),
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        null,
        streamState.getCurrentStreamingUniqueId()
      );
      streamState.setStreamingElements(
        streamState.getCurrentStreamingMessageDiv(),
        streamState.getCurrentStreamingContentElement(),
        null
      );
      streamState.clearStreamedText();
      streamState.appendStreamedText('');
      streamState.setActiveToolCall(null);
      streamState.setRunId(null);
      streamState.setSourceTabId(null);
    }
  }

  submitBtn.addEventListener('click', async () => {
    streamState.setActiveToolCall(null);
    const instruction = instructionInput.value;
    if (!instruction.trim()) {
      loadingManager.showToast('Please enter an instruction', 'warning');
      return;
    }

    try {
      // Fetch available skills for intent detection
      const skillsResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSkills' }, (response) => {
          if (chrome.runtime.lastError) resolve({ skills: [] });
          else resolve(response || { skills: [] });
        });
      });
      const availableSkills = skillsResp && skillsResp.skills ? skillsResp.skills : [];
      const skillsModule = await getChatSkills();

      // Detect skill intent from instruction
      const cmd = skillsModule.parseCommand(instruction, availableSkills);
      let requestedSkill = null;
      let effectiveInstruction = instruction;

      if (cmd.type === 'skill') {
        requestedSkill = cmd.skillName;
        effectiveInstruction = cmd.body || instruction;
      } else {
        const detectedSkill = skillsModule.detectSkillIntent(instruction, availableSkills);
        if (detectedSkill) {
          requestedSkill = detectedSkill.skillName;
          effectiveInstruction = detectedSkill.body || instruction;
        }
      }

      let prompt;

      if (streamState.getMediaData() && streamState.getMediaData().base64) {
        // Media + instruction
        const mediaInfo = `[${streamState.getMediaData().type.toUpperCase()} loaded]`;
        prompt = effectiveInstruction + '\n\n' + mediaInfo;

        // Show chat area and hide one-off instruction area
        oneoffInstructionArea.style.display = 'none';
        chatMainArea.style.display = 'block';
        chatUI.addMessage('User', `${effectiveInstruction}\n\n[${mediaInfo}]`);
        if (requestedSkill) {
          chatUI.addMessage(
            'System',
            `🎯 Skill detected: **${requestedSkill}**. Loading skill instructions...`
          );
        }

        // Use orchestrator with media + skill
        await makeApiCallWithMedia(
          effectiveInstruction,
          streamState.getMediaData(),
          'auto',
          requestedSkill
        );

        instructionInput.value = '';
        selectedTextDiv.textContent = '';
        selectedText = null;
        streamState.setMediaData(null);
      } else if (selectedText && selectedText.trim()) {
        // Text-only instruction
        prompt = effectiveInstruction + '\n\n' + selectedText;

        // Show chat area and hide one-off instruction area
        oneoffInstructionArea.style.display = 'none';
        chatMainArea.style.display = 'block';
        chatUI.addMessage(
          'User',
          `${effectiveInstruction}\n\n[Selected text: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}]`
        );
        if (requestedSkill) {
          chatUI.addMessage(
            'System',
            `🎯 Skill detected: **${requestedSkill}**. Loading skill instructions...`
          );
        }

        await makeApiCall(prompt, 'auto', requestedSkill);
        instructionInput.value = '';
        selectedTextDiv.textContent = '';
        selectedText = null;
      } else {
        loadingManager.showToast('Please select text or load media first', 'warning');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        chatUI.addMessage('System', 'Response stopped');
      } else {
        let errorMsg = error.message;
        if (error.details) {
          errorMsg += ` (Details: ${JSON.stringify(error.details)})`;
        }
        loadingManager.showToast('Error: ' + errorMsg, 'error');
        console.error('Error in one-off instruction submission:', error);
      }
      userInput.disabled = false;
      sendButton.disabled = false;
      clearButton.textContent = 'Clear';
      currentAbortController = null;
    }
  });

  // --- Pinned Instructions Functionality ---
  async function renderPinnedActions() {
    if (!pinnedActionsContainer) return;
    pinnedActionsContainer.innerHTML = ''; // Clear existing pinned actions

    try {
      const { pinnedQuickActions, instructions } = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['pinnedQuickActions', 'instructions'], (result) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(result);
        });
      });

      const currentPins = pinnedQuickActions || [];
      const allInstructions = instructions || [];

      if (currentPins.length === 0) {
        return;
      }

      currentPins.forEach((pinId) => {
        const instruction = allInstructions.find((inst) => inst.id === pinId);
        if (instruction) {
          const button = document.createElement('button');
          const iconLetter = instruction.name ? instruction.name[0].toUpperCase() : '?';
          button.textContent = iconLetter;
          button.title = instruction.name; // Set full instruction name as tooltip
          button.classList.add('quick-action-button', 'pinned-action-item');
          button.dataset.instructionId = instruction.id; // Store ID
          // button.dataset.instructionContent = instruction.content; // Or store full content

          button.addEventListener('click', () => {
            // Ensure chat area is visible
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';

            // Retrieve the instruction object
            const instructionToExecute = allInstructions.find(
              (inst) => inst.id === button.dataset.instructionId
            );
            if (!instructionToExecute) {
              loadingManager.showToast('Error: Could not find instruction details.', 'error');
              return;
            }

            // Send a message to background.js to get tab content
            chrome.runtime.sendMessage(
              {
                action: 'getPinnedActionTabContent',
                instruction: {
                  // Pass necessary instruction details
                  id: instructionToExecute.id, // Keep track of the instruction
                  name: instructionToExecute.name,
                  content: instructionToExecute.content,
                  tool_choice: normalizeToolChoice(instructionToExecute.tool_choice),
                },
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    'Error sending getPinnedActionTabContent message:',
                    chrome.runtime.lastError.message
                  );
                  loadingManager.showToast(`Error: ${chrome.runtime.lastError.message}`, 'error');
                  // Fallback or error handling: maybe execute with just selected text or show error
                  // For now, we'll just show an error and not proceed.
                  return;
                }

                // response.instruction should contain the instruction object passed back from background.js
                const originalInstruction = response.instruction;
                if (!originalInstruction) {
                  loadingManager.showToast(
                    'Error: Instruction details not returned from background script.',
                    'error'
                  );
                  return;
                }

                let tabContent = '';
                if (response && response.success && response.content) {
                  tabContent = response.content;
                  loadingManager.showToast(
                    `Executing: ${originalInstruction.name} with tab content...`,
                    'info'
                  );
                } else if (response && !response.success) {
                  loadingManager.showToast(
                    `Note: Could not get tab content for ${originalInstruction.name}. Error: ${response.content || 'Unknown error'}`,
                    'warning'
                  );
                } else {
                  loadingManager.showToast(
                    `Note: No tab content received for ${originalInstruction.name}. Executing without it.`,
                    'warning'
                  );
                }

                let prompt = originalInstruction.content;

                if (tabContent && tabContent.trim() !== '') {
                  prompt += '\n\nActive Tab Content:\n' + tabContent;
                }

                if (selectedText && selectedText.trim() !== '') {
                  prompt += '\n\nSelected Text:\n' + selectedText;
                }

                // Pass the tool_choice from the original instruction
                // Use makeApiCall for proper run ownership tracking
                const toolChoice = normalizeToolChoice(originalInstruction.tool_choice);
                makeApiCall(prompt, toolChoice);
              }
            );
          });
          pinnedActionsContainer.appendChild(button);
        }
      });
    } catch (error) {
      console.error('Error rendering pinned actions:', error);
      loadingManager.showToast('Error loading pinned actions.', 'error');
    }
  }

  // Initial call to render and listener for changes will be added later.
  // The block for managePinnedActionsButton listener has been removed.

  // Initial rendering of pinned actions
  renderPinnedActions();

  // The chrome.storage.onChanged listener above has been updated to include this logic.
  // No need for a separate listener here.

  // Voice input functionality
  const voiceToggleButton = document.getElementById('voice-toggle-button');

  // Voice input initialization
  if (voiceToggleButton) {
    // Debounce wrapper for voice toggle to prevent rapid start/stop
    let lastVoiceToggleTime = 0;
    const VOICE_TOGGLE_DEBOUNCE_MS = 500; // 500ms debounce

    const debouncedToggleVoiceInput = async () => {
      const now = Date.now();
      if (now - lastVoiceToggleTime < VOICE_TOGGLE_DEBOUNCE_MS) {
        return;
      }
      lastVoiceToggleTime = now;
      const voice = await getChatVoice();
      voice.toggleVoiceInput(voiceToggleButton, userInput);
    };

    voiceToggleButton.addEventListener('click', debouncedToggleVoiceInput);
  }

  // Initialize voice input settings
  getChatVoice().then((voice) => {
    voice.syncVoiceInputSettings().then(() => {
      voice.updateVoiceToggleButtonState(voiceToggleButton);
    });

    // Clean up voice input on page unload
    window.addEventListener('beforeunload', function () {
      if (voice.getIsListening()) {
        voice.stopVoiceInput(voiceToggleButton, userInput);
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') {
        return;
      }

      if (changes['voiceInputEnabled'] || changes['voiceInputPermissionState']) {
        voice.syncVoiceInputSettings().then(() => {
          voice.updateVoiceToggleButtonState(voiceToggleButton);
        });
      }
    });
  });
}); // End of DOMContentLoaded
