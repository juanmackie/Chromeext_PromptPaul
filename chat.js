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
import { PAGE_ACTION_NAMES, PAGE_TAB_ACTION_NAMES } from './src/utils/pageActionPolicy.js';
import { chatUI } from './src/chat/ChatUI.js';
import './src/chat/ChatAnswerRenderer.js';
import { attachCopyListeners, postProcessRenderedContent } from './src/chat/ChatClipboard.js';
import {
  getApiConfig,
  getApiConfigCached,
  getTools,
  prepareRunMessages,
  startRun,
  executeRun,
  abortRun,
  resumeActRun,
  getRunAuth,
  refreshRunOwnerToken,
  setRunOwnerToken,
  clearRunOwnerToken,
  selectOptimalProfile,
} from './src/chat/ChatAPI.js';
import {
  isWebSearchEnabled,
  initWebSearchToggle,
  buildFinalResponseBody,
  buildRecoveredBody,
  classifyToolExecutionResult,
} from './src/chat/ChatGrounding.js';
import { MediaType, getMediaAnalysisPrompt } from './src/chat/ChatMedia.js';
import { initChatModelStatus } from './src/chat/ChatModelStatus.js';
import { StreamStateManager } from './src/chat/ChatStream.js';
import { prepareLoadedPageContext } from './src/chat/PageContext.js';
import { extractPdfText } from './src/utils/pdfExtractor.js';
import { friendlyRuntimeErrorMessage } from './src/utils/runtimeErrors.js';
import { RUN_STATES, setRunState } from './src/utils/runState.js';
import { chatComposer } from './src/chat/ChatComposer.js';
import { renderMarkdown } from './src/utils/domSanitizer.js';
import {
  buildExplainPrompt,
  buildSummarizePrompt,
  PROOFREAD_PROMPT,
  composeUserPrompt,
} from './src/prompts.js';
import {
  buildCardPromptRequest,
  buildSmartPromptRequest,
  buildSiteActions,
  executePresetAnalysis,
} from './src/chat/ChatPageActions.js';
import {
  isPageActionsEnabled,
  setPageActionsEnabled,
  setPageActionsRunActive,
  initPageActionsToggle,
  renderPageActionConfirmation,
  resolvePageActionConfirmation,
  cancelPageActionConfirmations,
  updatePageActionActivity,
  updatePageTaskProgress,
  handlePageUserInputRequest,
} from './src/chat/ChatPageAutomation.js';
import {
  clearActiveRun,
  loadActiveRunJournal,
  loadActRecovery,
  restoreRunJournal,
} from './src/chat/ChatRunRecovery.js';
import * as hermesChat from './src/chat/ChatHermes.js';
import { initQuickActionsMenu } from './src/chat/ChatActionMenu.js';
import { readCurrentPageSelection } from './src/chat/ChatSelection.js';
import {
  initializeDevDiagnostics,
  installDevErrorHandlers,
  recordDevDiagnostic,
} from './src/utils/devDiagnostics.js';

void initializeDevDiagnostics('chat');
installDevErrorHandlers('chat');
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
const PAGE_ACTIVITY_TOOL_NAMES = new Set([...PAGE_ACTION_NAMES, ...PAGE_TAB_ACTION_NAMES]);

function renderMarkdownInto(element, markdown) {
  if (!element) return;
  const safeHtml = renderMarkdown(markdown);
  if (typeof DOMParser !== 'function') {
    element.textContent = String(markdown || '');
    return;
  }
  const parsed = new DOMParser().parseFromString(safeHtml, 'text/html');
  const fragment = document.createDocumentFragment();
  for (const node of parsed.body.childNodes) {
    fragment.appendChild(document.importNode(node, true));
  }
  element.replaceChildren(fragment);
}
function formatUserMessageForDisplay(message) {
  const text = String(message || '');
  const firstLine = text.split(/\r?\n/)[0];
  const maxInlineLength = 240;
  if (firstLine.length <= maxInlineLength) return firstLine;
  return `${firstLine.slice(0, maxInlineLength)}…`;
}
document.addEventListener('DOMContentLoaded', () => {
  recordDevDiagnostic('chat_loaded', {
    href: window.location.href,
    userAgent: navigator.userAgent,
  });
  const chatArea = document.getElementById('chat-area');
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const selectedTextDiv = document.getElementById('selectedText');
  const selectedTextStrip = document.getElementById('selected-text-strip');
  const selectedTextSnippet = document.getElementById('selected-text-snippet');
  const selectedTextRemoveButton = document.getElementById('selected-text-remove-button');
  const instructionInput = document.getElementById('instructionInput');
  const submitBtn = document.getElementById('submitBtn');
  const chatMainArea = document.getElementById('chat-main-area');
  const oneoffInstructionArea = document.getElementById('oneoff-instruction-area');
  // Quick Actions Sidebar Elements
  const addPageButton = document.getElementById('add-page-button');
  const analyzeButton = document.getElementById('analyze-button');
  const analyzeDropdown = document.getElementById('analyze-dropdown');
  const proofreadButton = document.getElementById('proofread-button');
  const explainButton = document.getElementById('explain-button');
  // Configure marked with highlight.js for syntax highlighting
  if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
    marked.setOptions({
      highlight: function (code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          if (isResponseBusy()) {
            loadingManager.showToast('A response is already in progress', 'warning');
            return;
          }
          submitBtn.disabled = true;
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
  initQuickActionsMenu(document.getElementById('quick-actions-sidebar'));
  // Preset registry for analysis modes
  const PRESET_MODES = {
    summary: {
      key: 'summary',
      label: 'Summary',
      icon: 'auto_awesome',
      prompt: buildSummarizePrompt('content'),
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
    proofread: {
      key: 'proofread',
      label: 'Proofread',
      icon: 'spellcheck',
      prompt: PROOFREAD_PROMPT,
    },
    executive: {
      key: 'executive',
      label: 'Executive',
      icon: 'assignment',
      prompt: 'Provide an executive summary of this content.',
    },
  };

  let lastUsedPreset = 'summary'; // Default preset mode
  let lastLoadedPageContext = null;
  // Bounded page text + identity for the attached page, kept so page-scoped
  // quick actions (action cards, page presets) can carry the page content in
  // the current request instead of relying on an earlier history turn.
  let lastLoadedPageRequest = null;
  let pageContextHistoryMessage = null;

  /**
   * Helper to execute a preset analysis.
   */
  async function executePreset(presetKey, loadingText, successText) {
    await executePresetAnalysis({
      presetKey,
      loadingText,
      successText,
      presetModes: PRESET_MODES,
      chatMainArea,
      oneoffInstructionArea,
      makeApiCall,
      loadingManager,
      chatUI,
      showSiteSuggestions,
    });
  }

  /**
   * Helper to execute a specific preset mode.
   */
  async function executePagePresetMode(modeKey) {
    const preset = PRESET_MODES[modeKey];
    if (!preset) {
      console.warn('Unknown preset mode:', modeKey);
      return;
    }
    executePreset(modeKey, `Generating ${preset.label}...`, `${preset.label} started`);
  }

  // Page-scoped quick actions (site cards, page presets) send the attached page
  // text inside the request, matching the preset and notch paths. Without
  // attached page content the instruction is passed through unchanged.
  function buildPageScopedRequest(instruction) {
    if (!lastLoadedPageRequest) return instruction;
    return buildCardPromptRequest(
      instruction,
      lastLoadedPageRequest.text,
      lastLoadedPageRequest.metadata
    );
  }

  async function showSiteSuggestions(url, platform = null, platformInfo = null) {
    if (!url) {
      composer?.setSiteActions?.([]);
      return;
    }
    const actions = await buildSiteActions({
      url,
      platform,
      platformInfo,
      onRun: (prompt) => {
        activateSelectedTextActionView();
        // Cards only render while page context is attached, so the page content
        // travels with the instruction rather than relying on history.
        makeApiCall(buildPageScopedRequest(prompt));
      },
    });
    composer.setSiteActions(actions);
  }

  function activateSelectedTextActionView() {
    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');
  }

  function clearSelectedTextState() {
    composer?.clearAnswerFollowup?.();
    selectedText = null;
    // Releasing the sticky selection also releases the source-tab identity
    // that arrived with it (so the next live selection read follows the
    // browser's active tab), but only when the selection handoff actually
    // established the tab. A media/page/notch handoff owns the tab identity
    // and must survive a later selection-chip clear.
    if (selectionOwnsTabId) {
      tabId = null;
      selectionOwnsTabId = false;
    }
    selectedTextDiv.textContent = '';
    refreshSelectedTextActionState();
    syncChatAreaHeight();
  }

  function getSelectedText() {
    return String(selectedText || '').trim();
  }

  function getSelectedTextForAction(actionLabel) {
    const text = getSelectedText();
    if (!text) {
      loadingManager.showToast(`Please select text first to ${actionLabel}.`, 'warning');
      return null;
    }

    return text;
  }

  function hasConversation() {
    const history = streamState.getConversationHistory();
    return Array.isArray(history) && history.length > 0;
  }

  // A previous-response follow-up needs an actual assistant turn. Loaded page
  // content is a user message, so hasConversation() alone is not enough.
  function hasPreviousAssistantResponse() {
    const history = streamState.getConversationHistory();
    return Array.isArray(history) && history.some((message) => message?.role === 'assistant');
  }

  function updateSelectedTextActionButtons() {
    [analyzeButton, proofreadButton, explainButton, analyzeDropdown, customPromptsDropdown].forEach(
      (button) => {
        if (!button) return;
        button.disabled = false;
        button.title = button.dataset.enabledTitle || button.title;
      }
    );
  }

  function updateSelectedTextChip() {
    if (!selectedTextStrip) return;
    const text = getSelectedText();
    if (text) {
      if (selectedTextSnippet) {
        selectedTextSnippet.textContent = text.length > 140 ? `${text.slice(0, 140)}…` : text;
      }
      selectedTextStrip.hidden = false;
    } else {
      selectedTextStrip.hidden = true;
      if (selectedTextSnippet) selectedTextSnippet.textContent = '';
    }
  }

  function refreshSelectedTextActionState() {
    updateSelectedTextActionButtons();
    updateSelectedTextChip();
  }

  // Restores the originating selected-text context into the tray so an Edit
  // replays the same request the original response used, not the current one.
  function applySelectedTextContext(text) {
    composer?.clearAnswerFollowup?.();
    selectedText = String(text || '').trim();
    if (selectedText) {
      activateSelectedTextActionView();
      refreshSelectedTextActionState();
    }
  }

  async function composeActionPrompt(basePrompt, actionLabel) {
    if (!getSelectedText()) {
      selectedText = await readCurrentPageSelection(getRunSourceTabId());
      if (selectedText) refreshSelectedTextActionState();
    }
    const text = getSelectedText();
    if (text) {
      return {
        instruction: basePrompt,
        context: {
          type: 'selected_text',
          text,
        },
      };
    }
    if (lastLoadedPageRequest) {
      // A page-scoped mode runs against the attached page, not against a
      // previous assistant response.
      return buildPageScopedRequest(basePrompt);
    }
    if (hasPreviousAssistantResponse()) {
      return {
        instruction: basePrompt,
        context: {
          type: 'previous_response',
        },
      };
    }
    getSelectedTextForAction(actionLabel);
    return null;
  }

  async function runSelectedTextPrompt(prompt, toolChoice, actionLabel) {
    const composed = await composeActionPrompt(prompt, actionLabel);
    if (composed === null) {
      return false;
    }

    activateSelectedTextActionView();
    await makeApiCall(composed, toolChoice);
    // Keep the selection sticky so further actions can run on the same text.
    return true;
  }

  async function executeSelectedTextMode(modeKey) {
    const preset = PRESET_MODES[modeKey];
    if (!preset) {
      console.warn('Unknown preset mode:', modeKey);
      return false;
    }

    const composed = await composeActionPrompt(preset.prompt, `run ${preset.label}`);
    if (composed === null) {
      return false;
    }

    lastUsedPreset = modeKey;
    activateSelectedTextActionView();
    loadingManager.showToast(`${preset.label} started`, 'info');
    await makeApiCall(composed, 'auto');
    // Keep the selection sticky so further actions can run on the same text.
    return true;
  }

  async function executeSelectedTextInstruction(instruction) {
    const actionName = instruction.name || 'this prompt';
    const composed = await composeActionPrompt(instruction.content, `run ${actionName}`);
    if (composed === null) {
      return false;
    }

    activateSelectedTextActionView();
    await makeApiCall(composed, normalizeToolChoice(instruction.tool_choice));
    // Keep the selection sticky so further actions can run on the same text.
    return true;
  }

  function removePageContextHistory() {
    if (pageContextHistoryMessage) {
      const history = streamState.getConversationHistory();
      const index = history.indexOf(pageContextHistoryMessage);
      if (index >= 0) history.splice(index, 1);
    }
    pageContextHistoryMessage = null;
    lastLoadedPageRequest = null;
  }

  // Inserts already-extracted page content into the chat context. Shared by the
  // normal DOM path and the PDF path (which supplies a response-shaped object).
  function applyLoadedPageContent(response) {
    // Prepare everything first so a budget or prompt error cannot leave a
    // visible page card without matching model context.
    const prepared = prepareLoadedPageContext(response, {
      hasMediaContext: Boolean(streamState.getMediaData()),
    });

    removePageContextHistory();
    document.querySelectorAll('.loaded-content-container').forEach((container) => {
      container.remove();
    });
    chatUI.addLoadedContentMessage(prepared.sourceInfo, response.content);
    showSiteSuggestions(response.url, response.platform, response.platformInfo);

    lastLoadedPageContext = prepared.pageContext;
    lastLoadedPageRequest = {
      text: prepared.fitted.text,
      sourceTabId:
        Number.isInteger(response.sourceTabId) && response.sourceTabId > 0
          ? response.sourceTabId
          : null,
      metadata: {
        title: response.title,
        siteName: response.siteName,
        byline: response.byline,
        url: response.url,
        type: response.type || response.platform,
      },
    };
    composer.setPageContext({
      title: prepared.sourceInfo,
      details: prepared.details,
      type:
        response.siteName && response.siteName !== 'Unknown' ? response.siteName : 'Page content',
      truncated: prepared.fitted.truncated,
    });
    pageContextHistoryMessage = prepared.historyMessage;
    streamState.getConversationHistory().push(pageContextHistoryMessage);

    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');
    userInput.focus();
    const statusParts = ['Content loaded.'];
    if (prepared.fitted.truncated) {
      statusParts.push(
        `Trimmed to fit context budget (${prepared.fitted.includedTokens}/${prepared.fitted.originalTokens} estimated tokens).`
      );
    }
    chatUI.addMessage('System', statusParts.join(' '));
    syncChatAreaHeight();
  }

  // Reads a PDF in the chat page via pdf.js and feeds the text into the chat.
  async function loadPdfContent(response, loadingToast, followUpInstruction = '') {
    loadingManager.hideToast(loadingToast);
    const pdfToast = loadingManager.showToast('Reading PDF…', 'info');
    try {
      const { text, title, numPages, truncated } = await extractPdfText(response.pdfUrl);
      loadingManager.hideToast(pdfToast);
      applyLoadedPageContent({
        success: true,
        content: text,
        title: title || response.title || 'PDF document',
        siteName: 'PDF document',
        url: response.pdfUrl,
        sourceTabId: response.sourceTabId,
        platform: 'pdf',
        platformInfo: null,
        readStrategy: 'auto',
      });
      if (truncated) {
        chatUI.addMessage(
          'System',
          `Note: only the first 300 pages were read (PDF has ${numPages} pages).`
        );
      }
      if (followUpInstruction) void makeApiCall(followUpInstruction, 'auto');
    } catch (pdfError) {
      loadingManager.hideToast(pdfToast);
      console.error('Chat.js: Add page button - PDF failed:', pdfError.message);
      loadingManager.showToast(pdfError.message, 'error');
    }
  }

  // Add event listeners for quick action buttons
  if (addPageButton) {
    addPageButton.addEventListener('click', async () => {
      let loadingToast = null;
      try {
        loadingToast = loadingManager.showToast('Loading tab content...', 'info');

        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'getLoadContent' }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(friendlyRuntimeErrorMessage(chrome.runtime.lastError.message)));
            } else {
              resolve(res);
            }
          });
        });

        if (response && response.action === 'loadContentResponse') {
          if (response.isPdf) {
            await loadPdfContent(response, loadingToast);
          } else if (response.success && response.content) {
            loadingManager.hideToast(loadingToast);
            applyLoadedPageContent(response);
          } else {
            loadingManager.hideToast(loadingToast);
            const errorMsg = response.error || 'Content not available';
            console.error('Chat.js: Add page button - Failed:', errorMsg);
            loadingManager.showToast('No content received: ' + errorMsg, 'error');
          }
        } else {
          loadingManager.hideToast(loadingToast);
          loadingManager.showToast('Unexpected response from background script', 'error');
        }
      } catch (error) {
        if (loadingToast) loadingManager.hideToast(loadingToast);
        console.error('Chat.js: Add page button - Error:', error.message);
        loadingManager.showToast(friendlyRuntimeErrorMessage(error), 'error');
      }
    });
  }

  if (analyzeButton) {
    analyzeButton.addEventListener('click', () => {
      executeSelectedTextMode(lastUsedPreset);
    });
  }

  if (proofreadButton) {
    proofreadButton.addEventListener('click', () => {
      executeSelectedTextMode('proofread');
    });
  }

  // ── Slash-command typeahead picker ────────────────────────────
  let slashMenuVisible = false;
  let slashMenu = null;
  let slashCandidates = [];
  let slashActiveIndex = 0;
  let cachedSkills = [];
  let cachedSlashCommands = [];
  let slashLoaded = false;

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
      item.textContent = preset.label;

      item.addEventListener('click', () => {
        hidePresetMenu();
        executeSelectedTextMode(preset.key);
      });

      presetMenu.appendChild(item);
    });

    document.body.appendChild(presetMenu);
    return presetMenu;
  }

  function positionMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  }

  function showPresetMenu() {
    const menu = createPresetMenu();
    positionMenu(menu, analyzeDropdown);
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
      const icon = document.createElement('span');
      icon.className = 'custom-prompt-icon';
      icon.textContent = iconLetter;
      item.appendChild(icon);
      item.appendChild(document.createTextNode(instruction.name || 'Untitled prompt'));
      item.addEventListener('click', () => {
        hideCustomPromptsMenu();
        executeSelectedTextInstruction(instruction);
      });
      menu.appendChild(item);
    });
  }

  async function showCustomPromptsMenu() {
    await populateCustomPromptsMenu();
    positionMenu(customPromptsMenu, customPromptsDropdown);
    customPromptsMenu.style.display = 'block';
    customPromptsMenuVisible = true;
  }

  function hideCustomPromptsMenu() {
    if (customPromptsMenu) customPromptsMenu.style.display = 'none';
    customPromptsMenuVisible = false;
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

  window.addEventListener(
    'scroll',
    () => {
      if (presetMenuVisible && presetMenu && analyzeDropdown)
        positionMenu(presetMenu, analyzeDropdown);
      if (customPromptsMenuVisible && customPromptsMenu && customPromptsDropdown) {
        positionMenu(customPromptsMenu, customPromptsDropdown);
      }
    },
    true
  );
  window.addEventListener('resize', () => {
    if (presetMenuVisible && presetMenu && analyzeDropdown)
      positionMenu(presetMenu, analyzeDropdown);
    if (customPromptsMenuVisible && customPromptsMenu && customPromptsDropdown) {
      positionMenu(customPromptsMenu, customPromptsDropdown);
    }
  });

  // ── Slash-command typeahead picker functions ─────────────────

  async function refreshSlashCandidates() {
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSkills' }, (response) => {
          if (chrome.runtime.lastError) resolve({ skills: [], slashCommands: [] });
          else resolve(response || { skills: [], slashCommands: [] });
        });
      });
      cachedSkills = resp.skills || [];
      cachedSlashCommands = resp.slashCommands || [];
    } catch {
      cachedSkills = [];
      cachedSlashCommands = [];
    }
  }

  function createSlashMenu() {
    if (slashMenu) return slashMenu;
    slashMenu = document.createElement('div');
    slashMenu.id = 'slash-command-menu';
    document.body.appendChild(slashMenu);
    return slashMenu;
  }

  function positionSlashMenu() {
    if (!slashMenu) return;
    const wrapper = document.getElementById('input-wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    slashMenu.style.left = `${rect.left}px`;
    slashMenu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    slashMenu.style.top = 'auto';
  }

  function updateSlashMenu(query) {
    const menu = createSlashMenu();

    const { buildSlashCandidates: build, filterSlashCandidates: filter } = _chatSkillsModule || {};
    if (!build || !filter) return;

    const allCandidates = build(cachedSkills, cachedSlashCommands);
    const filtered = filter(query, allCandidates);

    menu.innerHTML = '';
    slashActiveIndex = 0;

    if (filtered.length === 0) {
      menu.style.display = 'none';
      slashMenuVisible = false;
      return;
    }

    filtered.forEach((candidate, idx) => {
      const item = document.createElement('button');
      item.className = 'slash-menu-item' + (idx === 0 ? ' active' : '');
      item.dataset.index = idx;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'slash-menu-name';
      nameSpan.textContent = candidate.label;
      item.appendChild(nameSpan);

      if (candidate.description) {
        const descSpan = document.createElement('span');
        descSpan.className = 'slash-menu-desc';
        descSpan.textContent = candidate.description;
        item.appendChild(descSpan);
      }

      item.addEventListener('click', () => {
        acceptSlash(candidate);
      });

      menu.appendChild(item);
    });

    slashCandidates = filtered;
    positionSlashMenu();
    menu.style.display = 'block';
    slashMenuVisible = true;
  }

  function moveSlashActive(delta) {
    if (!slashMenuVisible || slashCandidates.length === 0) return;
    const items = slashMenu.querySelectorAll('.slash-menu-item');
    if (items.length === 0) return;

    items[slashActiveIndex]?.classList.remove('active');
    slashActiveIndex = (slashActiveIndex + delta + items.length) % items.length;
    items[slashActiveIndex]?.classList.add('active');
    items[slashActiveIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function acceptSlash(candidate) {
    if (!candidate) return;
    const input = document.getElementById('user-input');
    if (!input) return;

    const val = input.value;
    const slashIdx = val.indexOf('/');
    if (slashIdx !== -1) {
      input.value = val.slice(0, slashIdx) + candidate.label + ' ';
    } else {
      input.value = candidate.label + ' ';
    }

    hideSlashMenu();
    input.focus();
  }

  function hideSlashMenu() {
    if (slashMenu) {
      slashMenu.style.display = 'none';
    }
    slashMenuVisible = false;
    slashActiveIndex = 0;
    slashLoaded = false;
  }

  function isSlashMenuVisible() {
    return slashMenuVisible;
  }

  if (explainButton) {
    explainButton.addEventListener('click', async () => {
      await runSelectedTextPrompt(buildExplainPrompt('selected text'), 'auto', 'run Explain');
    });
  }

  if (selectedTextRemoveButton) {
    selectedTextRemoveButton.addEventListener('click', () => {
      clearSelectedTextState();
      loadingManager.showToast(
        'Selected text detached: actions now continue the conversation',
        'info'
      );
    });
  }

  // Initialize opt-in page action and web grounding toggles.
  initPageActionsToggle(document.getElementById('page-actions-toggle'), loadingManager);
  initWebSearchToggle(document.getElementById('web-search-toggle'), loadingManager);

  const darkThemeToggle = document.getElementById('darkThemeToggle');
  if (darkThemeToggle) {
    setupThemeToggle(darkThemeToggle);
  }

  initChatModelStatus({
    statusElement: document.getElementById('sidebar-model-status'),
    modeElement: document.getElementById('sidebar-mode-value'),
    modelElement: document.getElementById('sidebar-model-value'),
    reasoningElement: document.getElementById('sidebar-reasoning-value'),
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.pinnedQuickActions || changes.instructions)) {
      renderPinnedActions();
    }
    if (area === 'local' && (changes.profiles || changes.lastSelectedProfileId)) {
      void conversationControls?.refresh();
    }
  });
  const PENDING_PANEL_ACTION_KEY = 'pendingPanelAction';

  let selectedText = null;
  let tabId = null;
  // Tracks whether the current tabId was established by a sticky-selection
  // handoff. When true, clearing the selection also releases the tab identity;
  // when false the tab came from a media/page/notch handoff and survives a
  // later selection-chip clear, so getRunSourceTabId keeps following it.
  let selectionOwnsTabId = false;
  let panelTabId = null; // Owning tab for this side panel (set from message sender)
  let lastProcessedPanelActionId = null;
  let isResponseInFlight = false;
  let conversationControls = null;
  // Terminal Act outcome facts from the latest page_task_progress event, used by
  // the composer's recovery row so a generic Retry never blindly replays an Act
  // run that ended with an unverified/in-flight mutation. Resets each new run.
  let lastActOutcome = null;
  let progressiveAnswerTurn = null;
  let progressiveAnswerSeen = false;
  const inputArea = document.getElementById('input-area');
  let currentAttachmentPreviewUrl = null;
  const contextTray = document.getElementById('context-tray');
  const quickActionsRow = document.getElementById('quick-actions-row');
  const streamState = new StreamStateManager();
  streamState.setChatAreaRef(chatArea);
  function hasLiveStreamingRun() {
    return (
      Boolean(streamState.getRunId()) && Boolean(streamState.getCurrentStreamingContentElement())
    );
  }

  function isResponseBusy() {
    return isResponseInFlight || hasLiveStreamingRun();
  }

  function beginResponseRun() {
    if (isResponseBusy()) {
      console.warn('Chat: run start rejected - response already in flight', {
        currentRunId: streamState.getRunId(),
        sourceTabId: streamState.getSourceTabId(),
      });
      loadingManager.showToast('A response is already in progress', 'warning');
      return false;
    }

    // Recover from a stranded run whose terminal event never arrived so it
    // doesn't permanently block new runs. Also clear the streaming elements
    // so any permanent "Loading…" or "Using tool:…" bubble is removed.
    if (streamState.getRunId()) {
      console.warn('Chat: clearing stranded run state before starting a new run', {
        strandedRunId: streamState.getRunId(),
        sourceTabId: streamState.getSourceTabId(),
      });
      streamState.clearStreamingElements();
      streamState.clearStreamedText();
      streamState.setActiveToolCall(null);
      streamState.setRunId(null);
      streamState.setSourceTabId(null);
      void clearActiveRun();
    }

    isResponseInFlight = true;
    lastActOutcome = null;
    progressiveAnswerTurn = null;
    progressiveAnswerSeen = false;
    return true;
  }

  function endResponseRun() {
    isResponseInFlight = false;
    void conversationControls?.refresh();
  }

  function resetRunUi(runState) {
    setPageActionsRunActive(false);
    userInput.disabled = false;
    sendButton.disabled = false;
    clearButton.textContent = 'Clear';
    // A pending document consumed into a successful run is spent: follow-ups
    // rely on conversation history. Failed or stopped runs retain it.
    if (runState === RUN_STATES.COMPLETE) {
      composer.finishDocumentSend();
    } else {
      composer.cancelDocumentSend();
    }
    setRunState(inputArea, runState);
    void clearActiveRun();
  }

  function beginRunUi() {
    userInput.disabled = true;
    sendButton.disabled = true;
    clearButton.textContent = 'Stop';
    setRunState(inputArea, RUN_STATES.STREAMING);
  }

  async function watchActiveRun(recovery) {
    const latestRecovery = (await loadActiveRunJournal()) || recovery;
    if (!latestRecovery?.active) throw new Error('This run is no longer active.');
    if (isResponseBusy()) {
      loadingManager.showToast('A response is already in progress.', 'warning');
      throw new Error('A response is already in progress.');
    }
    const runId = String(
      latestRecovery.pointer?.runId || latestRecovery.journal?.runId || ''
    ).trim();
    const ownerToken = String(latestRecovery.ownerToken || '');
    if (!runId || !ownerToken || !setRunOwnerToken(runId, ownerToken)) {
      throw new Error('Run reconnect authorization was not established. Reload Prompt Paul.');
    }
    const { messageDiv, contentElement, uniqueIdString } = chatUI.addMessage('LLM', '');
    streamState.initStreamingElements(messageDiv, contentElement, uniqueIdString);
    streamState.setRunId(runId);
    streamState.setSourceTabId(
      latestRecovery.pointer?.sourceTabId ?? latestRecovery.journal?.sourceTabId ?? null
    );
    messageDiv.answerFollowupIdentity = chatComposer.buildAnswerFollowupIdentity(
      chatComposer.getLastUserRequest(chatArea),
      streamState.getSourceTabId()
    );
    streamState.setNextOrchestratorEventSequence(latestRecovery.journal?.eventSequence || 0);
    setPageActionsRunActive(latestRecovery.journal?.pageActions?.enabled === true);
    beginRunUi();
    // P1-05: replay pending user interactions so controls return after a
    // reconnect. A terminal event observed before a pending interaction means
    // the run already ended; do not render a stale control that can no longer
    // be resolved. Decisions and secret arguments are never restored from the
    // journal.
    let replaySawTerminal = false;
    for (const event of latestRecovery.journal?.events || []) {
      if (['complete', 'error', 'aborted'].includes(event.type)) {
        replaySawTerminal = true;
        continue;
      }
      if (event.type === 'page_task_progress') {
        updatePageTaskProgress(chatArea, { ...event, runId });
      } else if (event.type === 'page_action_state') {
        updatePageActionActivity(chatArea, { ...event, runId });
      } else if (event.type === 'page_action_warning' || event.type === 'page_action_notice') {
        updatePageActionActivity(chatArea, { ...event, runId, state: event.state || 'notice' });
      } else if (event.type === 'page_action_confirmation' && !replaySawTerminal) {
        renderPageActionConfirmation(
          chatArea,
          event,
          async (confirmationId, approved, approveAll, allowSite = false) => {
            if (!(await refreshRunOwnerToken(runId))) {
              throw new Error(
                'Run reconnect authorization was not established. Reload Prompt Paul.'
              );
            }
            const response = await chrome.runtime.sendMessage({
              action: 'pageActionDecision',
              runId,
              confirmationId,
              approved,
              approveAll,
              allowSite,
              ...getRunAuth(runId, streamState.getSourceTabId()),
            });
            if (!response?.success) {
              const error = new Error(response?.error || 'Approval was not accepted.');
              error.expired = response?.expired === true;
              throw error;
            }
            return response;
          },
          () => abortRun(runId)
        );
      } else if (event.type === 'page_action_decision') {
        resolvePageActionConfirmation(chatArea, event);
        updatePageActionActivity(chatArea, {
          ...event,
          runId: event.runId || '',
          action: event.action || 'page action',
          state: event.timedOut ? 'no answer' : event.approved ? 'approved' : 'declined',
        });
      } else if (!replaySawTerminal) {
        // Replay pending interactions through the same renderer used for live
        // events. The owner token is re-established from the run auth, never
        // persisted in the journal.
        if (
          event.type === 'page_user_input_request' ||
          event.type === 'page_manual_intervention_request'
        ) {
          event.ownerToken = getRunAuth(runId).ownerToken;
          handlePageUserInputRequest(
            chatArea,
            event,
            runId,
            streamState.getSourceTabId(),
            async () => {
              await refreshRunOwnerToken(runId);
              return getRunAuth(runId, streamState.getSourceTabId());
            }
          );
        } else if (event.type === 'hermes_approval_required') {
          hermesChat.renderHermesApproval(
            chatArea,
            event,
            async (choice) => {
              if (!(await refreshRunOwnerToken(runId))) {
                throw new Error(
                  'Run reconnect authorization was not established. Reload Prompt Paul.'
                );
              }
              const response = await chrome.runtime.sendMessage({
                action: 'hermesApprovalDecision',
                runId,
                approvalId: event.approvalId,
                choice,
                ...getRunAuth(runId, streamState.getSourceTabId()),
              });
              if (!response?.success)
                throw new Error(response?.error || 'This Hermes approval is no longer active.');
              return response;
            },
            () => abortRun(runId)
          );
        }
      }
    }
  }

  function restoreTerminalRun(recovery) {
    const event = [...(recovery?.journal?.events || [])]
      .reverse()
      .find((entry) => ['complete', 'error', 'aborted'].includes(entry.type));
    if (!event) return;
    if (event.type === 'complete' && event.content) {
      // Route the recovered answer through the canonical safe final renderer so
      // a truncated journal never shows as complete and grounding sources are
      // preserved alongside any visible partial-notice.
      const body = buildRecoveredBody(event);
      // Journals persist readable text and grounding metadata only; cards are
      // a live terminal projection and are intentionally not recovered.
      chatUI.addMessage('LLM', body);
      streamState.addMessageToHistory({ role: 'assistant', content: body });
    } else if (event.type === 'aborted') {
      chatUI.addMessage('System', 'Response stopped');
    } else {
      chatUI.addMessage('System', `❌ Error: ${event.error || event.message || 'The run failed.'}`);
    }
    void clearActiveRun();
  }

  async function resumeActCheckpoint(checkpoint, recoveryCard) {
    if (!checkpoint || isResponseBusy()) {
      loadingManager.showToast('A response is already in progress.', 'warning');
      return;
    }

    if (!beginResponseRun()) return;
    try {
      const instruction = String(checkpoint.instruction || '').trim();
      if (instruction && !instruction.startsWith('[Sensitive task detail omitted.]')) {
        chatUI.addMessage('User', formatUserMessageForDisplay(instruction));
        streamState.addMessageToHistory({ role: 'user', content: instruction });
      }
      const { messageDiv, contentElement, uniqueIdString } = chatUI.addMessage('LLM', '');
      streamState.initStreamingElements(messageDiv, contentElement, uniqueIdString);
      beginRunUi();
      const resumed = await resumeActRun(checkpoint);
      streamState.setRunId(resumed.runId);
      streamState.setSourceTabId(resumed.sourceTabId);
      setPageActionsRunActive(true);
      recoveryCard?.remove();
      await executeRun(resumed.runId, []);
    } catch (error) {
      handleRunFailure(error, 'resumeActCheckpoint');
      throw error;
    }
  }

  // Gated Retry recovery for an Act run that ended with an unverified/in-flight
  // mutation. Reuses the existing checkpoint/Resume path (which clears stale
  // page state and forces page_get_state). NEVER blindly replays the mutation;
  // when no interrupted checkpoint exists, surface the uncertainty instead.
  async function onActFreshInspection() {
    let checkpoint = null;
    try {
      const recovery = await loadActRecovery();
      checkpoint = recovery?.checkpoint || null;
    } catch (_) {
      checkpoint = null;
    }
    if (checkpoint) {
      await resumeActCheckpoint(checkpoint, null);
      return;
    }
    loadingManager.showToast(
      'The last page action may not have been verified. Re-running it could duplicate the change — inspect the page and start a fresh Act task instead.',
      'warning'
    );
  }

  // Shared failure cleanup for both run entry points.
  function handleRunFailure(error, source) {
    console.error(`${source} Error:`, error);
    chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
    chatUI.addMessage('System', 'Error: ' + friendlyRuntimeErrorMessage(error));
    resetRunUi(RUN_STATES.ERROR);
    userInput.focus();
    clearCurrentMediaData();
    streamState.clearStreamingElements();
    streamState.clearStreamedText();
    streamState.appendStreamedText('');
    streamState.setActiveToolCall(null);
    streamState.setRunId(null);
    streamState.setSourceTabId(null);
  }

  function syncChatAreaHeight() {
    if (!inputArea) return;
    document.documentElement.style.setProperty(
      '--chat-input-area-height',
      `${inputArea.offsetHeight}px`
    );
  }

  function revokeAttachmentPreviewUrl() {
    if (currentAttachmentPreviewUrl && currentAttachmentPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentAttachmentPreviewUrl);
    }
    currentAttachmentPreviewUrl = null;
  }

  function clearCurrentMediaData() {
    streamState.clearMediaData();
    chatUI.clearAttachmentPreview();
    revokeAttachmentPreviewUrl();
    syncChatAreaHeight();
  }

  function handleAttachmentRemove() {
    clearCurrentMediaData();
    loadingManager.showToast('Pasted image attachment removed', 'info');
  }

  function setCurrentMediaData(data) {
    composer?.clearAnswerFollowup?.();
    revokeAttachmentPreviewUrl();
    streamState.setMediaData(data);
    currentAttachmentPreviewUrl = data?.previewUrl || null;

    if (data && data.source === 'clipboard') {
      chatUI.setAttachmentPreview(data, handleAttachmentRemove);
    } else {
      chatUI.clearAttachmentPreview();
    }

    syncChatAreaHeight();
  }

  async function handleUserInputPaste(event) {
    const clipboardData = event.clipboardData;
    if (!clipboardData || userInput.disabled) return;

    const items = Array.from(clipboardData.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const imageFile =
      imageItem?.getAsFile?.() ||
      Array.from(clipboardData.files || []).find((file) => file.type.startsWith('image/'));

    if (!imageFile) return;

    event.preventDefault();

    try {
      const mediaModule = await getChatMedia();
      const fileData = await mediaModule.readBlobAsBase64(imageFile, 'pasted-image');
      const fileName =
        imageFile.name && imageFile.name.trim() ? imageFile.name.trim() : 'Pasted image';
      const previewUrl = URL.createObjectURL(imageFile);

      setCurrentMediaData({
        type: MediaType.IMAGE,
        mimeType: fileData.mimeType || imageFile.type || 'image/png',
        base64: fileData.base64,
        name: fileName,
        previewUrl,
        source: 'clipboard',
      });

      loadingManager.showToast('Pasted image attached', 'success');
    } catch (error) {
      console.error('Chat: Failed to process pasted image:', error);
      clearCurrentMediaData();
      chatUI.addMessage('System', `❌ Failed to attach pasted image: ${error.message}`);
    }
  }

  syncChatAreaHeight();
  window.addEventListener('resize', syncChatAreaHeight);

  const inputExpandToggle = document.getElementById('input-expand-toggle');
  const inputExpandIcon = inputExpandToggle?.querySelector('.material-symbols-outlined');
  if (inputExpandToggle && inputArea && userInput) {
    const setInputExpanded = (expanded) => {
      inputArea.classList.toggle('input-area-expanded', expanded);
      inputExpandToggle.setAttribute('aria-expanded', String(expanded));
      inputExpandToggle.title = expanded ? 'Collapse prompt input' : 'Expand prompt input';
      inputExpandToggle.setAttribute(
        'aria-label',
        expanded ? 'Collapse prompt input' : 'Expand prompt input'
      );
      if (inputExpandIcon) {
        inputExpandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
      }
      syncChatAreaHeight();
    };

    inputExpandToggle.addEventListener('click', () => {
      const expanded = !inputArea.classList.contains('input-area-expanded');
      setInputExpanded(expanded);
      userInput.focus();
    });
  }

  /**
   * Stops the current API request by aborting the orchestrator run.
   */
  async function stopApiRequest() {
    setRunState(inputArea, RUN_STATES.STOPPING);
    if (streamState.getRunId()) {
      await abortRun(streamState.getRunId());
    }
  }

  function getRunSourceTabId() {
    return tabId || panelTabId || null;
  }

  // Removes the loaded page context: clears state, hides the tray item, and
  // removes the expandable content message from the chat DOM. Site
  // suggestions are page-scoped, so they leave the composer row on detach.
  function detachPageContext(silent = false) {
    removePageContextHistory();
    lastLoadedPageContext = null;
    composer?.setSiteActions?.([]);
    document.querySelectorAll('.loaded-content-container').forEach((container) => {
      container.remove();
    });
    composer.setPageContext(null);
    syncChatAreaHeight();
    if (!silent) loadingManager.showToast('Page content detached', 'info');
  }

  // Reuses the existing current-page loading mechanism (the same backdrop the
  // sidebar Load-page button uses) to attach bounded page content to the tray.
  async function loadCurrentPageContext(loadingToast = null) {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getLoadContent' }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(friendlyRuntimeErrorMessage(chrome.runtime.lastError.message)));
        } else {
          resolve(res);
        }
      });
    });
    if (!response || response.action !== 'loadContentResponse') {
      throw new Error('Unexpected response from background script');
    }
    if (response.isPdf) {
      await loadPdfContent(response, loadingToast);
      return;
    }
    if (loadingToast) loadingManager.hideToast(loadingToast);
    if (!response.success || !response.content) {
      throw new Error(response.error || 'Content not available');
    }
    applyLoadedPageContent(response);
  }

  // Starter: load bounded current-page context, attach it, then summarize
  // through the canonical page-preset flow (one click after opening the panel).
  async function runStarterPageSummary() {
    const toast = loadingManager.showToast('Loading page content…', 'info');
    try {
      await loadCurrentPageContext(toast);
      await executePagePresetMode('summary');
    } catch (error) {
      if (toast) loadingManager.hideToast(toast);
      loadingManager.showToast(friendlyRuntimeErrorMessage(error), 'error');
    }
  }

  // Starter: attach bounded current-page context and focus the composer so
  // the user can ask about the page without sending anything automatically.
  async function runStarterAskPage() {
    const toast = loadingManager.showToast('Loading page content…', 'info');
    try {
      await loadCurrentPageContext(toast);
      userInput.focus();
    } catch (error) {
      if (toast) loadingManager.hideToast(toast);
      loadingManager.showToast(friendlyRuntimeErrorMessage(error), 'error');
    }
  }

  // Starts no run: toggles the sticky session Act permission and focuses the
  // composer so the user can type an Act task. The permission stays visible in
  // the composer context while idle via composer.setActEnabled.
  async function toggleActStarter() {
    let enabled;
    try {
      enabled = await isPageActionsEnabled();
      const warning = await setPageActionsEnabled(!enabled);
      composer.setActEnabled(!enabled);
      loadingManager.showToast(
        warning ||
          (enabled
            ? 'Page actions disabled for this browser session.'
            : 'Page actions enabled for this browser session. Risky actions still require approval.'),
        warning ? 'warning' : 'info'
      );
    } catch (error) {
      loadingManager.showToast(error.message || 'Could not update Act permission.', 'error');
      return;
    }
    if (!enabled) userInput.focus();
  }

  // Composer recovery: Continue always builds on the previous response;
  // other quick actions reuse the sticky-selection prompt path.
  async function sendComposerPrompt(instruction, actionLabel) {
    // Retry of an earlier response carries its originating structured
    // request/context identity (attachments, selection, page content). Replay
    // that exact request instead of rebuilding from the (possibly changed)
    // current context.
    if (instruction && typeof instruction === 'object' && instruction.request) {
      const replay = instruction.request;
      if (replay && replay.promptRequest && replay.mediaData) {
        await makeApiCallWithMedia(replay.promptRequest, replay.mediaData, 'auto');
      } else {
        await makeApiCall(replay, 'auto');
      }
      return;
    }
    if (actionLabel === 'continue' && hasConversation()) {
      await makeApiCall({ instruction, context: { type: 'previous_response' } }, 'auto');
      return;
    }
    await runSelectedTextPrompt(instruction, 'auto', actionLabel);
  }

  async function runAnswerCards(kind) {
    const label = kind === 'comparison' ? 'Compare cards' : 'Summary cards';
    const instruction =
      kind === 'comparison'
        ? 'Compare the main options, entities, or approaches in the attached material.'
        : 'Summarize the attached material with its key findings.';
    let promptRequest;
    let sourceTabIdOverride;
    const selected = getSelectedText();
    const pendingDocument = composer.getPendingDocument();
    if (selected) {
      promptRequest = { instruction, context: { type: 'selected_text', text: selected } };
    } else if (pendingDocument) {
      promptRequest = chatComposer.buildDocumentPromptRequest(instruction, pendingDocument);
      composer.beginDocumentSend();
    } else if (lastLoadedPageRequest) {
      promptRequest = buildPageScopedRequest(instruction);
      sourceTabIdOverride = lastLoadedPageRequest.sourceTabId;
    } else {
      loadingManager.showToast(
        `Attach page, selected text, or a document to ${label.toLowerCase()}.`,
        'warning'
      );
      return;
    }
    activateSelectedTextActionView();
    await makeApiCall(
      { ...promptRequest, answerFormat: 'cards' },
      'auto',
      null,
      sourceTabIdOverride
    );
  }

  // Composer-led UI: context tray, quick actions, inline recovery. All new
  // composer logic lives in ChatComposer.js; chat.js only supplies handlers.
  const composer = chatComposer.initComposer({
    container: inputArea,
    tray: contextTray,
    row: quickActionsRow,
    chatArea: document.getElementById('chat-area'),
    inputField: userInput,
    overflowMenu: document.getElementById('quick-actions-menu'),
    handlers: {
      onStop: () => stopApiRequest(),
      onAnalyze: () => executePagePresetMode(lastUsedPreset),
      onMode: (modeKey) => executeSelectedTextMode(modeKey),
      onPrompt: (instruction, actionLabel) => {
        composer.clearAnswerFollowup();
        return sendComposerPrompt(instruction, actionLabel);
      },
      onAnswerCards: (kind) => void runAnswerCards(kind),
      getRunActOutcome: () => lastActOutcome,
      onActFreshInspection: () => onActFreshInspection(),
      onPageSummary: () => void runStarterPageSummary(),
      onAskPage: () => void runStarterAskPage(),
      onActPage: () => void toggleActStarter(),
      onEdit: (instruction, request) => {
        composer.clearAnswerFollowup();
        // Edit replays the ORIGINAL request context: restore the originating
        // selection/attachment context into the composer tray alongside the
        // prompt text so the user edits the same request that produced it.
        if (request && request.context && request.context.type === 'selected_text') {
          applySelectedTextContext(request.context.text);
        }
        if (
          request &&
          request.context &&
          request.context.type === 'document' &&
          !composer.getPendingDocument()
        ) {
          // Re-attach the original document identity (memory only) unless a
          // document is already pending, which would force a replace choice.
          composer.setPendingDocument({
            name: request.context.metadata?.name || 'document',
            text: String(request.context.text || ''),
            truncated: false,
          });
        }
        userInput.value = instruction || '';
        userInput.dispatchEvent(new Event('input'));
        userInput.focus();
      },
      onDetachPage: () => detachPageContext(),
    },
  });

  // Surface the sticky session Act permission beside the composer while idle,
  // and keep it in sync with the sidebar Act toggle and the starter action.
  isPageActionsEnabled().then((enabled) => composer.setActEnabled(enabled));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.pageActionsEnabled) {
      composer.setActEnabled(Boolean(changes.pageActionsEnabled.newValue));
    }
  });

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
      return false;
    }

    if (request.actionId) {
      lastProcessedPanelActionId = request.actionId;
    }

    selectedText = request.selectedText || '';
    tabId = request.tabId;
    selectionOwnsTabId = true;
    refreshSelectedTextActionState();

    // Deep-link instruction: run it immediately against the attached context.
    if (request.textPrompt && request.textPrompt.trim()) {
      const instruction = request.textPrompt.trim();
      const text = getSelectedText();
      if (text) {
        void runSelectedTextPrompt(instruction, 'auto', 'deep link');
      } else {
        void makeApiCall({ instruction, context: { type: 'previous_response' } }, 'auto');
      }
    }

    // Handle media data from context menu
    if (request.mediaData) {
      setCurrentMediaData(request.mediaData);

      // Show chat area with media preview
      chatMainArea.classList.remove('hidden');
      oneoffInstructionArea.classList.add('hidden');

      if (streamState.getMediaData().error) {
        chatUI.addMessage(
          'System',
          `❌ Error loading ${streamState.getMediaData().type}: ${streamState.getMediaData().error}`
        );
      } else if (streamState.getMediaData().base64) {
        chatUI.addMediaPreview(streamState.getMediaData());
      }
    } else if (request.fromStartChat) {
      chatMainArea.classList.remove('hidden');
      oneoffInstructionArea.classList.add('hidden');
      streamState.startNewConversation();
      clearCurrentMediaData();
    } else {
      selectedTextDiv.textContent = selectedText;
      chatMainArea.classList.add('hidden');
      oneoffInstructionArea.classList.remove('hidden');
    }

    return true;
  }

  function applySetMediaForAnalysisAction(request) {
    if (request.actionId && request.actionId === lastProcessedPanelActionId) {
      console.log('Chat: Ignoring duplicate setMediaForAnalysis actionId:', request.actionId);
      return false;
    }

    if (request.actionId) {
      lastProcessedPanelActionId = request.actionId;
    }

    const mediaData = request.mediaData || {};
    tabId = request.tabId;
    selectionOwnsTabId = false;

    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');

    if (mediaData.loading) {
      chatUI.addMessage('System', `Loading ${mediaData.type} for analysis...`);
    } else if (mediaData.error) {
      chatUI.addMessage('System', `Error loading ${mediaData.type}: ${mediaData.error}`);
    } else if (mediaData.base64 || mediaData.textPrompt || mediaData.promptRequest) {
      if (mediaData.base64) {
        setCurrentMediaData(mediaData);
        chatUI.addMediaPreview(streamState.getMediaData());
      }

      let analysisPrompt;
      if (mediaData.actionType === 'custom' && mediaData.instructionId) {
        chrome.storage.local.get(['instructions'], (result) => {
          const instructions = result.instructions || [];
          const instruction = instructions.find((i) => i.id === mediaData.instructionId);
          let instructionToolChoice = 'auto';
          let promptRequest = mediaData.promptRequest;
          if (instruction) {
            analysisPrompt = mediaData.textPrompt || instruction.content;
            instructionToolChoice = normalizeToolChoice(instruction.tool_choice);
            promptRequest = promptRequest
              ? { ...promptRequest, instruction: instruction.content }
              : { instruction: analysisPrompt, context: { type: 'media' } };
            chatUI.addMessage('System', `Using custom instruction: "${instruction.name}"`);
          } else {
            analysisPrompt =
              mediaData.textPrompt || getMediaAnalysisPrompt('default', streamState.getMediaData());
            promptRequest = promptRequest || {
              instruction: analysisPrompt,
              context: { type: 'media' },
            };
          }

          if (streamState.getMediaData()) {
            makeApiCallWithMedia(promptRequest, streamState.getMediaData(), instructionToolChoice);
          } else {
            makeApiCall(promptRequest, instructionToolChoice);
          }
        });
        return true;
      } else if (mediaData.actionType === 'summarize') {
        analysisPrompt =
          mediaData.textPrompt || getMediaAnalysisPrompt('summarize', streamState.getMediaData());
        chatUI.addMessage('System', `Summarizing...`);
      } else if (mediaData.actionType === 'explain') {
        analysisPrompt =
          mediaData.textPrompt || getMediaAnalysisPrompt('explain', streamState.getMediaData());
        chatUI.addMessage('System', `Explaining...`);
      } else {
        analysisPrompt =
          mediaData.textPrompt || getMediaAnalysisPrompt('default', streamState.getMediaData());
        chatUI.addMessage('System', `Analyzing...`);
      }

      const promptRequest = mediaData.promptRequest || {
        instruction: analysisPrompt,
        context: { type: 'media' },
      };
      if (streamState.getMediaData()) {
        makeApiCallWithMedia(promptRequest, streamState.getMediaData());
      } else {
        makeApiCall(promptRequest);
      }
    }

    return true;
  }

  function applyNotchOpenActions(request) {
    if (request.actionId && request.actionId === lastProcessedPanelActionId) return false;
    if (request.actionId) lastProcessedPanelActionId = request.actionId;

    tabId = request.tabId;
    selectionOwnsTabId = false;
    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');
    const actionMenu = document.getElementById('quick-actions-more');
    if (actionMenu && actionMenu.getAttribute('aria-expanded') !== 'true') actionMenu.click();
    return true;
  }

  function applyNotchInstructionAction(request) {
    if (request.actionId && request.actionId === lastProcessedPanelActionId) return false;
    if (request.actionId) lastProcessedPanelActionId = request.actionId;

    const textPrompt = String(request.textPrompt || '')
      .trim()
      .slice(0, 20_000);
    if (!textPrompt) {
      loadingManager.showToast('An instruction is required.', 'warning');
      return false;
    }

    tabId = request.tabId;
    selectionOwnsTabId = false;
    const selected = String(request.selectedText || '')
      .trim()
      .slice(0, 20_000);
    const pageData = request.pageData || {};
    if (request.includePageContext === true) {
      if (pageData.isPdf && pageData.pdfUrl) {
        void (async () => {
          if (request.act === true) await setPageActionsEnabled(true, loadingManager);
          await loadPdfContent(pageData, null, textPrompt);
        })();
        return true;
      }
      if (!pageData.success || !pageData.content) {
        loadingManager.showToast('No page content was available for dictation.', 'error');
        return false;
      }
      const metadata = {
        title: pageData.title,
        siteName: pageData.siteName,
        byline: pageData.byline,
        url: pageData.url,
        type: pageData.type,
      };
      void (async () => {
        if (request.act === true) await setPageActionsEnabled(true, loadingManager);
        await makeApiCall(
          {
            instruction: textPrompt,
            context: {
              type: 'page_content',
              text: String(pageData.content).slice(0, 200_000),
              metadata,
            },
          },
          'auto'
        );
      })();
      return true;
    }
    if (selected && request.act !== true) {
      chatMainArea.classList.remove('hidden');
      oneoffInstructionArea.classList.add('hidden');
      void makeApiCall(
        {
          instruction: textPrompt,
          context: { type: 'selected_text', text: selected },
        },
        'auto'
      );
      return true;
    }

    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');
    void (async () => {
      if (request.act === true) await setPageActionsEnabled(true, loadingManager);
      userInput.value = textPrompt;
      userInput.dispatchEvent(new Event('input'));
      await sendMessage();
    })().catch((error) => {
      loadingManager.showToast(`Could not send instruction: ${error.message}`, 'error');
    });
    return true;
  }

  function applyNotchPinnedAction(request) {
    if (request.actionId && request.actionId === lastProcessedPanelActionId) return false;
    if (request.actionId) lastProcessedPanelActionId = request.actionId;

    const instructionId = String(request.instructionId || '').trim();
    if (!instructionId) {
      loadingManager.showToast('Pinned prompt is not available.', 'warning');
      return false;
    }

    tabId = request.tabId;
    const pinnedSelection = String(request.selectedText || '')
      .trim()
      .slice(0, 20_000);
    if (pinnedSelection) {
      selectedText = pinnedSelection;
      refreshSelectedTextActionState();
    }
    selectionOwnsTabId = Boolean(pinnedSelection);
    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');
    chrome.storage.local.get(['instructions'], (result) => {
      if (chrome.runtime.lastError) {
        loadingManager.showToast('Could not load the pinned prompt.', 'error');
        return;
      }
      const instruction = (result.instructions || []).find(
        (entry) => String(entry?.id || '') === instructionId
      );
      if (!instruction) {
        loadingManager.showToast('Pinned prompt is no longer available.', 'warning');
        return;
      }
      const pageData = request.pageData || {};
      if (!pinnedSelection && !hasConversation() && pageData.success && pageData.content) {
        const metadata = {
          title: pageData.title,
          siteName: pageData.siteName,
          byline: pageData.byline,
          url: pageData.url,
          type: pageData.type,
        };
        void makeApiCall(
          {
            instruction: instruction.content,
            context: {
              type: 'page_content',
              text: String(pageData.content).slice(0, 200_000),
              metadata,
            },
          },
          normalizeToolChoice(instruction.tool_choice)
        );
        return;
      }
      void executeSelectedTextInstruction(instruction);
    });
    return true;
  }

  function applyNotchSelectionAction(request) {
    if (request.actionId && request.actionId === lastProcessedPanelActionId) return false;
    if (request.actionId) lastProcessedPanelActionId = request.actionId;

    const text = String(request.selectedText || '')
      .trim()
      .slice(0, 20_000);
    if (!text) {
      loadingManager.showToast('Select text first.', 'warning');
      return false;
    }

    selectedText = text;
    tabId = request.tabId;
    selectionOwnsTabId = true;
    refreshSelectedTextActionState();
    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');
    void runSelectedTextPrompt(
      buildExplainPrompt('selected text'),
      'auto',
      'explain selected text'
    );
    return true;
  }

  function applyNotchPageAction(request) {
    if (request.actionId && request.actionId === lastProcessedPanelActionId) return false;
    if (request.actionId) lastProcessedPanelActionId = request.actionId;

    const response = request.pageData || {};
    if (response.isPdf) {
      tabId = request.tabId;
      selectionOwnsTabId = false;
      chatMainArea.classList.remove('hidden');
      oneoffInstructionArea.classList.add('hidden');
      void executePagePresetMode('summary');
      return true;
    }
    if (!response.success || !response.content) {
      loadingManager.showToast(response.error || 'No page content was available.', 'error');
      return false;
    }

    const metadata = {
      title: response.title,
      siteName: response.siteName,
      byline: response.byline,
      url: response.url,
      type: response.type,
    };
    const promptRequest = buildSmartPromptRequest(
      'summary',
      String(response.content).slice(0, 200_000),
      metadata,
      PRESET_MODES
    );
    tabId = request.tabId;
    selectionOwnsTabId = false;
    chatMainArea.classList.remove('hidden');
    oneoffInstructionArea.classList.add('hidden');
    chatUI.addMessage('System', 'Summarizing page…');
    void makeApiCall(promptRequest, 'auto');
    return true;
  }

  function consumePendingPanelAction(pendingAction) {
    const pendingPanelActions = [
      'setSelectedText',
      'setMediaForAnalysis',
      'notchOpenActions',
      'notchInstructionAction',
      'notchPinnedAction',
      'notchSelectionAction',
      'notchPageAction',
    ];
    if (!pendingAction || !pendingPanelActions.includes(pendingAction.action)) {
      return;
    }
    // Drop stale queued actions older than 30 seconds
    if (pendingAction.queuedAt && Date.now() - pendingAction.queuedAt > 30000) {
      console.warn('Chat: Dropping stale queued action:', pendingAction.action);
      if (chrome.storage?.session) {
        chrome.storage.session.remove([PENDING_PANEL_ACTION_KEY]);
      }
      return;
    }
    // Filter: only process pending actions for our panel
    if (pendingAction.tabId && panelTabId && pendingAction.tabId !== panelTabId) {
      console.log('Chat: Ignoring pending action for other panel');
      // Keep the action queued. The panel for the target tab may be opening
      // and will consume it during its own load.
      return;
    }
    let consumed = false;
    if (pendingAction.action === 'setSelectedText') {
      consumed = applySetSelectedTextAction(pendingAction);
    } else if (pendingAction.action === 'setMediaForAnalysis') {
      consumed = applySetMediaForAnalysisAction(pendingAction);
    } else if (pendingAction.action === 'notchOpenActions') {
      consumed = applyNotchOpenActions(pendingAction);
    } else if (pendingAction.action === 'notchInstructionAction') {
      consumed = applyNotchInstructionAction(pendingAction);
    } else if (pendingAction.action === 'notchPinnedAction') {
      consumed = applyNotchPinnedAction(pendingAction);
    } else if (pendingAction.action === 'notchSelectionAction') {
      consumed = applyNotchSelectionAction(pendingAction);
    } else if (pendingAction.action === 'notchPageAction') {
      consumed = applyNotchPageAction(pendingAction);
    }

    if (chrome.storage?.session) {
      chrome.storage.session.remove([PENDING_PANEL_ACTION_KEY]);
    }
    console.log('Chat: Consumed pending panel action:', pendingAction.action, { consumed });
  }

  function consumePendingPanelActionOnLoad() {
    if (!chrome.storage?.session) return;
    chrome.storage.session.get([PENDING_PANEL_ACTION_KEY], (result) => {
      consumePendingPanelAction(result?.[PENDING_PANEL_ACTION_KEY]);
    });
  }
  // Consume queued panel actions whenever written to session storage
  if (chrome.storage?.session) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session') return;
      const pending = changes[PENDING_PANEL_ACTION_KEY];
      if (!pending?.newValue) return;
      consumePendingPanelAction(pending.newValue);
    });
  }
  function isSkillLoaderTool(toolName) {
    return toolName === 'skill_view';
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

  function settleStreamingBubble(content) {
    const messageDiv = streamState.getCurrentStreamingMessageDiv();
    const contentElement = streamState.getCurrentStreamingContentElement();
    if (!messageDiv || !contentElement) return false;
    if (streamState.getReasoningContentElement()) {
      chatUI.finalizeReasoningPanel(messageDiv, streamState.getReasoningElapsedMs());
    }
    renderMarkdownInto(contentElement, content);
    postProcessRenderedContent(contentElement);
    return chatUI.moveMessageToEnd(messageDiv);
  }

  function interruptedAnswerText(message) {
    if (!progressiveAnswerSeen) return message;
    const contentElement = streamState.getCurrentStreamingContentElement();
    const readable = String(
      streamState.getStreamedText() || contentElement?.textContent || ''
    ).trim();
    return readable ? `${readable}\n\n${message}` : message;
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
      const consumed = applySetSelectedTextAction(request);
      if (sendResponse) sendResponse({ success: true, ignored: !consumed });
      return true;
    } else if (request.action === 'notchOpenActions') {
      if (isPanelAction) {
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      const consumed = applyNotchOpenActions(request);
      if (sendResponse) sendResponse({ success: true, ignored: !consumed });
      return true;
    } else if (request.action === 'notchInstructionAction') {
      if (isPanelAction) {
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      const consumed = applyNotchInstructionAction(request);
      if (sendResponse) sendResponse({ success: true, ignored: !consumed });
      return true;
    } else if (request.action === 'notchPinnedAction') {
      if (isPanelAction) {
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      const consumed = applyNotchPinnedAction(request);
      if (sendResponse) sendResponse({ success: true, ignored: !consumed });
      return true;
    } else if (request.action === 'notchSelectionAction') {
      if (isPanelAction) {
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      const consumed = applyNotchSelectionAction(request);
      if (sendResponse) sendResponse({ success: true, ignored: !consumed });
      return true;
    } else if (request.action === 'notchPageAction') {
      if (isPanelAction) {
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }
      const consumed = applyNotchPageAction(request);
      if (sendResponse) sendResponse({ success: true, ignored: !consumed });
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

      const consumed = applySetMediaForAnalysisAction(request);
      if (sendResponse) sendResponse({ success: true, ignored: !consumed });
      return true;
    } else if (request.action === 'orchestratorEvent') {
      let { runId, sourceTabId, event } = request;

      const currentRunId = streamState.getRunId();
      const currentSourceTabId = streamState.getSourceTabId();
      const sourceTabsMatch =
        sourceTabId == null || currentSourceTabId == null || sourceTabId === currentSourceTabId;
      const isOwnedEvent = currentRunId && runId === currentRunId && sourceTabsMatch;

      if (!isOwnedEvent) {
        const terminalTypes = ['complete', 'error', 'aborted'];
        if (terminalTypes.includes(event.type) && streamState.getCurrentStreamingContentElement()) {
          console.log('Chat: Finalizing stranded bubble for terminal event', {
            runId,
            eventType: event.type,
            currentRunId,
            sourceTabId,
            currentSourceTabId,
          });
          if (event.type === 'complete') {
            const body = buildFinalResponseBody(
              event.content,
              streamState.getStreamedText(),
              event.grounding?.sources || [],
              event.completion
            );
            renderMarkdownInto(streamState.getCurrentStreamingContentElement(), body);
            chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
            if (body.trim()) streamState.addMessageToHistory({ role: 'assistant', content: body });
          } else if (event.type === 'error') {
            chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
            renderMarkdownInto(
              streamState.getCurrentStreamingContentElement(),
              '❌ Error: ' + (event.error || 'unknown error')
            );
          } else if (event.type === 'aborted') {
            chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
            renderMarkdownInto(streamState.getCurrentStreamingContentElement(), 'Response stopped');
          }
          chatUI.moveMessageToEnd(streamState.getCurrentStreamingMessageDiv());
          resetRunUi(RUN_STATES.IDLE);
          streamState.clearStreamingElements();
          streamState.clearStreamedText();
          streamState.setActiveToolCall(null);
          clearRunOwnerToken(runId);
          streamState.setRunId(null);
          streamState.setSourceTabId(null);
          endResponseRun();
          if (sendResponse) sendResponse({ success: true });
          return true;
        }
        console.log('Chat: Ignoring orchestratorEvent for other run/tab', {
          runId,
          sourceTabId,
          panelTabId,
          currentRunId,
          currentSourceTabId,
        });
        if (sendResponse) sendResponse({ success: true, ignored: true });
        return true;
      }

      for (event of streamState.queueOrchestratorEvent(event))
        switch (event.type) {
          case 'reasoning':
            if (streamState.getCurrentStreamingMessageDiv() && event.data) {
              if (!streamState.getReasoningContentElement()) {
                const reasoningEl = chatUI.ensureReasoningPanel(
                  streamState.getCurrentStreamingMessageDiv()
                );
                streamState.setReasoningContentElement(reasoningEl);
              }
              streamState.markReasoningStart();
              streamState.queueRenderReasoning(event.data);
            }
            break;
          case 'content':
            if (streamState.getCurrentStreamingContentElement() && event.data) {
              // First answer token after reasoning: collapse the thinking panel.
              if (streamState.getReasoningContentElement()) {
                chatUI.finalizeReasoningPanel(
                  streamState.getCurrentStreamingMessageDiv(),
                  streamState.getReasoningElapsedMs()
                );
              }
              streamState.queueRenderChunk(event.data);
            }
            break;
          case 'answer_cards': {
            const bubble = streamState.getCurrentStreamingMessageDiv();
            if (!bubble || !Number.isInteger(event.answerTurn)) break;
            if (progressiveAnswerTurn !== null && event.answerTurn < progressiveAnswerTurn) break;
            if (progressiveAnswerTurn === null || event.answerTurn > progressiveAnswerTurn) {
              chatUI.clearProgressiveAnswer(bubble);
              progressiveAnswerTurn = event.answerTurn;
            }
            if (event.invalid === true || !event.answerCards) {
              chatUI.clearProgressiveAnswer(bubble);
              break;
            }
            chatUI.renderProgressiveAnswer(
              bubble,
              event.answerCards,
              event.grounding?.sources || []
            );
            if (bubble.querySelector(':scope > .answer-cards')) progressiveAnswerSeen = true;
            break;
          }
          case 'page_action_confirmation':
            renderPageActionConfirmation(
              chatArea,
              event,
              async (confirmationId, approved, approveAll, allowSite = false) => {
                try {
                  if (!(await refreshRunOwnerToken(runId))) {
                    throw new Error(
                      'Run reconnect authorization was not established. Reload Prompt Paul.'
                    );
                  }
                  const response = await chrome.runtime.sendMessage({
                    action: 'pageActionDecision',
                    runId,
                    confirmationId,
                    approved,
                    approveAll,
                    allowSite,
                    ...getRunAuth(runId, sourceTabId ?? streamState.getSourceTabId()),
                  });
                  if (!response?.success) {
                    const error = new Error(
                      response?.error || 'This page-action approval is no longer active.'
                    );
                    error.expired = response?.expired === true;
                    throw error;
                  }
                  return response;
                } catch (error) {
                  console.warn('Chat: page-action decision failed:', error.message);
                  loadingManager.showToast(
                    error.message || 'Could not send the page-action decision.',
                    'error'
                  );
                  throw error;
                }
              },
              () => abortRun(runId)
            );
            break;

          case 'hermes_approval_required':
            hermesChat.renderHermesApproval(
              chatArea,
              event,
              async (choice) => {
                try {
                  const response = await chrome.runtime.sendMessage({
                    action: 'hermesApprovalDecision',
                    runId,
                    approvalId: event.approvalId,
                    choice,
                    ...getRunAuth(runId, streamState.getSourceTabId()),
                  });
                  if (!response?.success) {
                    throw new Error(response?.error || 'This Hermes approval is no longer active.');
                  }
                  return response;
                } catch (error) {
                  console.warn('Chat: Hermes approval failed:', error.message);
                  loadingManager.showToast(
                    error.message || 'Could not send the Hermes approval.',
                    'error'
                  );
                  throw error;
                }
              },
              () => abortRun(runId)
            );
            break;
          case 'hermes_approval_updated':
            hermesChat.settleHermesApproval(chatArea, event);
            break;
          case 'page_action_decision':
            resolvePageActionConfirmation(chatArea, event);
            // Surface a user decline explicitly in the Act activity log (the
            // follow-up page_task_progress already appends a technical line).
            updatePageActionActivity(chatArea, {
              ...event,
              runId,
              action: event.action || 'page action',
              state: event.timedOut ? 'no answer' : event.approved ? 'approved' : 'declined',
            });
            break;
          case 'page_task_progress':
            updatePageTaskProgress(chatArea, { ...event, runId });
            if (event.outcome && typeof event.outcome === 'object') {
              // Keep the terminal Act outcome facts available so the composer
              // recovery row can gate Retry when delivery was unverified.
              lastActOutcome = event.outcome;
            }
            break;
          case 'page_action_state':
            updatePageActionActivity(chatArea, {
              ...event,
              runId,
              message: event.error || event.message,
            });
            break;
          /*
              `❌ Page action failed: ${event.action} ${label}: ${event.error || 'the page did not respond.'}`
          */
          case 'page_action_warning':
            updatePageActionActivity(chatArea, { ...event, runId, state: 'warning' });
            break;
          case 'page_action_notice':
            updatePageActionActivity(chatArea, { ...event, runId, state: 'notice' });
            break;
          case 'page_user_input_request':
          case 'page_manual_intervention_request':
            event.ownerToken = getRunAuth(runId).ownerToken;
            handlePageUserInputRequest(
              chatArea,
              event,
              runId,
              sourceTabId ?? streamState.getSourceTabId(),
              async () => {
                await refreshRunOwnerToken(runId);
                return getRunAuth(runId, sourceTabId ?? streamState.getSourceTabId());
              }
            );
            break;
          case 'continuation_start':
            chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
            progressiveAnswerSeen = false;
            streamState.startNewTurn();
            if (streamState.getCurrentStreamingContentElement()) {
              streamState.getCurrentStreamingContentElement().innerHTML = '';
            }
            break;
          case 'tool_start':
            chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
            progressiveAnswerSeen = false;
            if (streamState.getReasoningContentElement()) {
              chatUI.finalizeReasoningPanel(
                streamState.getCurrentStreamingMessageDiv(),
                streamState.getReasoningElapsedMs()
              );
            }
            streamState.startNewTurn();
            streamState.setActiveToolCall(event.toolCall);
            if (streamState.getCurrentStreamingContentElement()) {
              if (event.capability === 'skill' || isSkillLoaderTool(event.toolCall.function.name)) {
                renderMarkdownInto(
                  streamState.getCurrentStreamingContentElement(),
                  `Loading skill: **${event.toolCall.function.name}**`
                );
              } else {
                renderMarkdownInto(
                  streamState.getCurrentStreamingContentElement(),
                  `⚙️ Using tool: **${event.toolCall.function.name}**`
                );
              }
            }
            break;
          case 'tool_ready':
            if (PAGE_ACTIVITY_TOOL_NAMES.has(event.toolCall?.function?.name)) break;
            chatUI.addMessage(
              'System',
              `⚙️ Executing tool: **${event.toolCall.function.name}**...`
            );
            break;
          case 'tool_complete':
            if (PAGE_ACTIVITY_TOOL_NAMES.has(event.toolCall?.function?.name)) break;
            if (isSkillLoaderTool(event.toolCall.function.name)) {
              try {
                clearCurrentMediaData();
                const args = tryParseToolPayload(event.toolCall.function.arguments);
                const resultObj = tryParseToolPayload(event.result);
                const skillResult = resultObj?.result || resultObj;
                if (skillResult && skillResult.success) {
                  chatUI.addMessage('System', `Loaded skill: **${args.name || 'unknown'}**`);
                  const skillContent = JSON.stringify(skillResult);
                  const contentPreview =
                    skillContent.substring(0, 200) + (skillContent.length > 200 ? '...' : '');
                  chatUI.addMessage(
                    'System',
                    `Skill instructions preview:\n\`\`\`\n${contentPreview}\n\`\`\``
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
              const resultObj = tryParseToolPayload(event.result);
              const outcome = classifyToolExecutionResult(resultObj);
              if (outcome.payload?.skill) {
                chatUI.addMessage(
                  'System',
                  `📚 Loaded skill: **${outcome.payload.skill.name || event.toolCall.function.name}**`
                );
              } else if (outcome.status !== 'success') {
                chatUI.addMessage(
                  'System',
                  `⚠️ Tool ${event.toolCall.function.name}: ${outcome.message || outcome.error || 'error'}`
                );
              } else {
                chatUI.addMessage('System', `✅ Tool ${event.toolCall.function.name} executed.`);
              }
            }
            break;
          case 'tool_error':
            chatUI.addMessage(
              'System',
              `❌ Error executing tool ${event.toolCall.function.name}: ${event.error}`
            );

            streamState.setActiveToolCall(null);
            break;

          case 'complete': {
            hermesChat.settleHermesApprovals(chatArea, 'complete');
            // Collapse the thinking panel if it never got collapsed (e.g. reasoning-only turn).
            if (streamState.getReasoningContentElement()) {
              chatUI.finalizeReasoningPanel(
                streamState.getCurrentStreamingMessageDiv(),
                streamState.getReasoningElapsedMs()
              );
            }

            const body = buildFinalResponseBody(
              event.content,
              streamState.getStreamedText(),
              event.grounding?.sources || [],
              event.completion
            );

            const completedMessageDiv = streamState.getCurrentStreamingMessageDiv();
            const sources = event.grounding?.sources || [];
            if (completedMessageDiv?.querySelector(':scope > .answer-cards') || event.answerCards) {
              const followupIdentity = completedMessageDiv?.answerFollowupIdentity || null;
              const presentation = {
                followupIdentity,
                onAnswerFollowup: (kind, identity) =>
                  composer.prefillAnswerFollowup(kind, identity),
              };
              if (completedMessageDiv) {
                chatUI.renderCompletedAnswer(
                  completedMessageDiv,
                  body,
                  event.answerCards,
                  sources,
                  presentation
                );
              } else {
                chatUI.addMessage('LLM', body, null, {
                  answerCards: event.answerCards,
                  groundingSources: sources,
                  ...presentation,
                });
              }
            } else if (streamState.getCurrentStreamingContentElement()) {
              renderMarkdownInto(streamState.getCurrentStreamingContentElement(), body);
              postProcessRenderedContent(streamState.getCurrentStreamingContentElement());

              const uid = streamState.getCurrentStreamingUniqueId();
              if (completedMessageDiv && uid) {
                const rawIcon = document.getElementById(`copy-icon-${uid}`);
                const formattedIcon = document.getElementById(`copy-formatted-icon-${uid}`);
                if (rawIcon && formattedIcon) {
                  attachCopyListeners(
                    body,
                    streamState.getCurrentStreamingContentElement(),
                    rawIcon,
                    formattedIcon
                  );
                }
              }
            } else {
              chatUI.addMessage('LLM', body);
            }

            if (completedMessageDiv) {
              chatUI.moveMessageToEnd(completedMessageDiv, {
                preserveViewport: Boolean(event.answerCards),
              });
            }

            if (body.trim()) {
              streamState.addMessageToHistory({
                role: 'assistant',
                content: body,
              });
            }
            resetRunUi(RUN_STATES.COMPLETE);

            // Reset run state so the next message isn't rejected as "in progress".
            // Without clearing the run id, isResponseBusy() stays true forever.
            streamState.clearStreamingElements();
            streamState.clearStreamedText();
            streamState.setActiveToolCall(null);
            clearRunOwnerToken(runId);
            streamState.setRunId(null);
            streamState.setSourceTabId(null);
            progressiveAnswerTurn = null;

            // A conversation now exists, so sidebar actions can run as follow-ups.
            refreshSelectedTextActionState();
            break;
          }
          case 'aborted': {
            hermesChat.settleHermesApprovals(chatArea, 'aborted');
            cancelPageActionConfirmations(chatArea);
            chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
            if (!settleStreamingBubble(interruptedAnswerText('Response stopped'))) {
              chatUI.addMessage('System', 'Response stopped');
            }
            resetRunUi(RUN_STATES.STOPPED);

            // Reset streaming variables
            streamState.clearStreamingElements();
            streamState.clearStreamedText();
            streamState.setActiveToolCall(null);
            clearRunOwnerToken(runId);
            streamState.setRunId(null);
            streamState.setSourceTabId(null);
            progressiveAnswerTurn = null;
            progressiveAnswerSeen = false;
            break;
          }
          case 'error': {
            hermesChat.settleHermesApprovals(chatArea, 'error');
            chatUI.clearProgressiveAnswer(streamState.getCurrentStreamingMessageDiv());
            // Terminal page-action cards use the same explicit state === 'error' guard.
            cancelPageActionConfirmations(chatArea);
            if (!settleStreamingBubble(interruptedAnswerText(`❌ Error: ${event.error}`))) {
              chatUI.addMessage('System', `❌ Error: ${event.error}`);
            }
            resetRunUi(RUN_STATES.ERROR);
            userInput.focus();

            // Reset streaming variables
            streamState.clearStreamingElements();
            streamState.clearStreamedText();
            streamState.setActiveToolCall(null);
            clearRunOwnerToken(runId);
            streamState.setRunId(null);
            streamState.setSourceTabId(null);
            progressiveAnswerTurn = null;
            progressiveAnswerSeen = false;
            break;
          }
        }

      if (sendResponse) sendResponse({ success: true });
      return true;
    }
  });

  sendButton.addEventListener('click', sendMessage);
  const clearButton = document.getElementById('clear-button');

  conversationControls = chatComposer.createConversationController({
    button: clearButton,
    isBusy: isResponseBusy,
    getConfig: getApiConfig,
    stop: stopApiRequest,
    resetHermes: async (profileId) => {
      const response = await chrome.runtime.sendMessage({
        action: 'endHermesConversation',
        profileId,
      });
      if (!response?.success) {
        throw new Error(response?.error || 'Hermes could not start a new chat.');
      }
    },
    clearLocal: () => {
      chatUI.clearChat();
      composer.clearAnswerFollowup();
      streamState.startNewConversation();
      clearCurrentMediaData();
      clearSelectedTextState();
      composer.clearPendingDocument();
      if (lastLoadedPageContext) detachPageContext(true);
    },
    onError: (error) =>
      loadingManager.showToast(`Could not start a new chat: ${error.message}`, 'error'),
  });
  clearButton.addEventListener('click', conversationControls.handleClick);
  void conversationControls.refresh();
  userInput.addEventListener('keydown', (event) => {
    if (isSlashMenuVisible()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSlashActive(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlashActive(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        acceptSlash(slashCandidates[slashActiveIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSlashMenu();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !userInput.disabled) {
      event.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener('input', async () => {
    const val = userInput.value;
    const match = val.match(/^\/(\S*)$/);
    if (match) {
      if (!_chatSkillsModule) {
        await getChatSkills();
      }
      if (!slashLoaded) {
        await refreshSlashCandidates();
        slashLoaded = true;
      }
      updateSlashMenu(match[1]);
    } else {
      hideSlashMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (slashMenuVisible && slashMenu && !slashMenu.contains(e.target) && e.target !== userInput) {
      hideSlashMenu();
    }
  });
  userInput.addEventListener('paste', handleUserInputPaste);

  consumePendingPanelActionOnLoad();

  // ── Drag & Drop Support ────────────────────────────────────────

  const dropOverlay = document.getElementById('drop-overlay');

  function showDropOverlay() {
    if (dropOverlay) dropOverlay.classList.remove('hidden');
  }
  function hideDropOverlay() {
    if (dropOverlay) dropOverlay.classList.add('hidden');
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

    chatUI.addMessage('System', `Processing ${files.length} dropped file(s)...`);

    try {
      const mediaModule = await getChatMedia();
      const plans = [];
      for (const file of files) {
        try {
          plans.push(await mediaModule.prepareDroppedFile(file));
        } catch (err) {
          console.error('Drop handler error:', err);
          chatUI.addMessage('System', `❌ Error processing ${file.name}: ${err.message}`);
        }
      }

      // Documents (.txt/.md/.csv/.json) attach as bounded text context in the
      // composer tray. Dropping NEVER starts a provider request: the pending
      // document is sent only when the user sends a prompt. One document at a
      // time; extra documents get one actionable limit message (ChatComposer).
      const drop = chatComposer.resolveDocumentDrop(plans);
      if (drop.limitMessage) chatUI.addMessage('System', drop.limitMessage);
      if (drop.attach) composer.setPendingDocument(drop.attach);

      // Images/video/audio keep the existing auto-analyze media pipeline;
      // invalid files surface their validation errors.
      for (const plan of plans) {
        if (plan.kind === 'invalid') {
          chatUI.addMessage('System', `❌ ${plan.error}`);
          continue;
        }
        if (plan.kind !== 'media') continue;
        chatUI.addMediaPreview(plan.mediaData);
        setCurrentMediaData(plan.mediaData);
        // A pending document (dropped before this image) rides along as
        // structured context in the auto-analyze run, sharing the same
        // begin/finish/cancel lifecycle: it is spent on terminal success and
        // retained on failure or stop.
        const pendingDoc = composer.getPendingDocument();
        makeApiCallWithMedia(buildMediaPromptRequest(plan.instruction, pendingDoc), plan.mediaData);
        if (pendingDoc) composer.beginDocumentSend();
      }
    } catch (err) {
      console.error('Drop handler error:', err);
      chatUI.addMessage('System', `❌ Error processing dropped files: ${err.message}`);
    }
  });

  /**
   * Makes an API call with media content (images, video, audio).
   * @param {string|Object} promptRequest - The user's prompt request.
   * @param {Object} mediaData - The media data object containing base64, mimeType, etc.
   * @param {string} [tool_choice='auto'] - The tool choice strategy ('none', 'auto', or specific tool name).
   * @param {string|null} [requestedSkill=null] - Name of skill to preload via orchestrator.
   * @returns {Promise<void>}
   */
  async function makeApiCallWithMedia(
    promptRequest,
    mediaData,
    tool_choice = 'auto',
    requestedSkill = null
  ) {
    if (!beginResponseRun()) return;

    try {
      clearCurrentMediaData();
      const config = await getApiConfigCached();
      const userMessage = composeUserPrompt(promptRequest);

      const effectiveToolChoice =
        tool_choice === undefined || tool_choice === null || tool_choice === ''
          ? 'auto'
          : tool_choice;

      if (userMessage) {
        chatUI.addMessage('User', formatUserMessageForDisplay(userMessage), {
          promptRequest,
          mediaData,
        });

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

      const { messageDiv, contentElement, uniqueIdString } = chatUI.addMessage('LLM', '');
      streamState.initStreamingElements(messageDiv, contentElement, uniqueIdString);
      beginRunUi();

      const webSearchEnabled = await isWebSearchEnabled();
      const pageActionsEnabled = await isPageActionsEnabled();
      const runConfig = {
        provider: config.provider || 'api',
        profileId: config.profileId || config.id,
        llmEndpoint: config.llmEndpoint,
        hermesEndpoint: config.hermesEndpoint,
        hermesProfile: config.hermesProfile,
        hermesRemoteConfirmed: config.hermesRemoteConfirmed === true,
        modelName: config.modelName,
        reasoningLevel: config.reasoningLevel,
        systemPrompt: config.systemPrompt,
        tool_choice: effectiveToolChoice,
        tools: await getTools(),
        webSearch: webSearchEnabled,
        pageActions: pageActionsEnabled,
        pageActionsMultiTab: pageActionsEnabled,
        mediaData: mediaData,
        requestedSkill,
        conversationId: streamState.getConversationId(),
        sourceTabId: getRunSourceTabId(),
      };
      streamState.setRunId(await startRun(runConfig));
      streamState.setSourceTabId(runConfig.sourceTabId);
      if (pageActionsEnabled) setPageActionsRunActive(true);

      await executeRun(
        streamState.getRunId(),
        prepareRunMessages(runConfig, streamState.getConversationHistory())
      );
    } catch (error) {
      handleRunFailure(error, 'makeApiCallWithMedia');
    } finally {
      endResponseRun();
    }
  }

  /**
   * Build the prompt request for a media send. A pending document rides along
   * as structured context through composeUserPrompt; without one the request
   * carries only the media marker. Media still attaches via makeApiCallWithMedia's
   * mediaData parameter in either case.
   * @param {string} instruction - The typed or fallback instruction.
   * @param {Object|null} document - Pending document record, or null.
   * @returns {Object} Prompt request for the media run.
   */
  function buildMediaPromptRequest(instruction, document) {
    return document
      ? chatComposer.buildDocumentPromptRequest(instruction, document)
      : {
          instruction,
          context: { type: 'media' },
        };
  }

  async function sendMessage() {
    streamState.setActiveToolCall(null); // Reset active tool call
    const message = userInput.value;
    const mediaData = streamState.getMediaData();
    const pendingDocument = composer.getPendingDocument();
    const hasText = message.trim().length > 0;
    const hasMedia = Boolean(mediaData?.base64);
    const hasDocument = Boolean(pendingDocument);

    if ((hasText || hasMedia || hasDocument) && !userInput.disabled) {
      let requestedSkill = null;
      let effectiveMessage = hasText
        ? message
        : hasMedia
          ? `Analyze this ${mediaData?.type || 'image'}`
          : '';

      if (hasText) {
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
          chatUI.addMessage('User', formatUserMessageForDisplay(message));
          const slashCommands = skillsResp.slashCommands || [];
          const skillsMessage = skillsModule.formatSkillsList(availableSkills, slashCommands);
          chatUI.addMessage('System', skillsMessage);
          userInput.value = '';
          return;
        }

        if (cmd.type === 'skill') {
          requestedSkill = cmd.skillName;
          effectiveMessage = cmd.body || message;
          chatUI.addMessage('System', `Loading skill: **${requestedSkill}**`);
        } else {
          // Fall back to natural-language intent detection
          const detectedSkill = skillsModule.detectSkillIntent(message, availableSkills);
          if (detectedSkill) {
            requestedSkill = detectedSkill.skillName;
            effectiveMessage = detectedSkill.body || message;
            chatUI.addMessage(
              'System',
              `Skill detected: **${requestedSkill}**. Loading skill instructions...`
            );
          }
        }
      }

      if (!hasMedia && !hasDocument) {
        const answerFollowup = composer.getAnswerFollowup(effectiveMessage);
        if (answerFollowup) {
          const accepted = await makeApiCall(
            answerFollowup.request,
            'auto',
            requestedSkill,
            answerFollowup.sourceTabId
          );
          if (!accepted) return;
          composer.clearAnswerFollowup();
          userInput.value = '';
          return;
        }
      }

      if (hasMedia) {
        // A pending document rides along as structured context: the media still
        // attaches through makeApiCallWithMedia's mediaData, but the prompt
        // request carries the document through composeUserPrompt and shares the
        // same begin/finish/cancel lifecycle as a document-only send. A failed
        // submission retains the chip; terminal success clears it.
        makeApiCallWithMedia(
          buildMediaPromptRequest(effectiveMessage, hasDocument ? pendingDocument : null),
          mediaData,
          'auto',
          requestedSkill
        );
        if (hasDocument) composer.beginDocumentSend();
      } else if (hasDocument) {
        // Structured document context through composeUserPrompt; a failed
        // submission retains the attachment (cleared only on terminal success
        // via finishDocumentSend), and Retry/Edit replay the bound identity.
        makeApiCall(
          chatComposer.buildDocumentPromptRequest(effectiveMessage, pendingDocument),
          'auto',
          requestedSkill
        );
        composer.beginDocumentSend();
      } else {
        // A typed send carries the attached page as structured `page_content`
        // context instead of relying on the earlier history turn. With no
        // attached page, buildPageScopedRequest returns the bare instruction.
        makeApiCall(buildPageScopedRequest(effectiveMessage), 'auto', requestedSkill);
      }
      userInput.value = '';
    }
  }

  /**
   * Makes an API call to the LLM endpoint using the orchestrator.
   * @param {string|Object} promptRequest - The user's prompt request.
   * @param {string} [tool_choice='auto'] - The tool choice strategy ('none', 'auto', or specific tool name).
   * @param {string|null} [requestedSkill=null] - Name of skill to preload via orchestrator.
   * @returns {Promise<void>}
   */
  async function makeApiCall(
    promptRequest = null,
    tool_choice = 'auto',
    requestedSkill = null,
    sourceTabIdOverride = undefined
  ) {
    if (!beginResponseRun()) return false;

    try {
      if (sourceTabIdOverride !== undefined) {
        if (!Number.isInteger(sourceTabIdOverride) || sourceTabIdOverride <= 0) {
          loadingManager.showToast(
            'The original answer source is unavailable. Attach its context again.',
            'warning'
          );
          return false;
        }
        try {
          await chrome.tabs.get(sourceTabIdOverride);
        } catch (_) {
          loadingManager.showToast(
            'The original source tab is no longer available. Attach its context again to continue.',
            'warning'
          );
          return false;
        }
      }
      const config = await getApiConfigCached();
      const userMessage = composeUserPrompt(promptRequest);

      // Adaptive model routing: check if media context needs a vision-capable model
      const mediaData = streamState.getMediaData();
      let effectiveConfig = config;
      if (mediaData && (mediaData.type === 'image' || mediaData.type === 'video')) {
        try {
          const { profiles } = await new Promise((resolve) => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], resolve);
          });
          const routingResult = await selectOptimalProfile(
            profiles || [],
            config.id || 'default',
            mediaData
          );
          if (routingResult.rerouted && routingResult.config) {
            effectiveConfig = routingResult.config;
            console.log(
              `[Chat] Rerouted to vision-capable model: ${routingResult.config.modelName}`
            );
            chatUI.addMessage(
              'System',
              `Auto-switched to **${routingResult.config.modelName}** for image analysis.`
            );
          }
        } catch (e) {
          // routing failure is non-fatal: fall back to current config
        }
      }

      const effectiveToolChoice =
        tool_choice === undefined || tool_choice === null || tool_choice === ''
          ? 'auto'
          : tool_choice;

      // Add user message to history if provided
      if (userMessage) {
        chatUI.addMessage('User', formatUserMessageForDisplay(userMessage), promptRequest);

        if (mediaData && mediaData.type === 'image') {
          const messageContent = [
            { type: 'text', text: userMessage },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaData.mimeType};base64,${mediaData.base64}`,
              },
            },
          ];
          streamState.addMessageToHistory({ role: 'user', content: messageContent });
        } else {
          streamState.addMessageToHistory({ role: 'user', content: userMessage });
        }

        clearCurrentMediaData(); // Clear after use
      }

      // Prepare run configuration
      const webSearchEnabled = await isWebSearchEnabled();
      const pageActionsEnabled = await isPageActionsEnabled();
      const runConfig = {
        provider: effectiveConfig.provider || 'api',
        profileId: effectiveConfig.profileId || effectiveConfig.id,
        llmEndpoint: effectiveConfig.llmEndpoint,
        hermesEndpoint: effectiveConfig.hermesEndpoint,
        hermesProfile: effectiveConfig.hermesProfile,
        hermesRemoteConfirmed: effectiveConfig.hermesRemoteConfirmed === true,
        modelName: effectiveConfig.modelName,
        reasoningLevel: effectiveConfig.reasoningLevel,
        systemPrompt: effectiveConfig.systemPrompt,
        tool_choice: effectiveToolChoice,
        tools: await getTools(),
        webSearch: webSearchEnabled,
        pageActions: pageActionsEnabled,
        pageActionsMultiTab: pageActionsEnabled,
        requestedSkill,
        ...(promptRequest && promptRequest.answerFormat === 'cards'
          ? { answerFormat: 'cards' }
          : {}),
        conversationId: streamState.getConversationId(),
        sourceTabId: sourceTabIdOverride === undefined ? getRunSourceTabId() : sourceTabIdOverride,
      };
      const { messageDiv, contentElement, uniqueIdString } = chatUI.addMessage('LLM', '');
      streamState.initStreamingElements(messageDiv, contentElement, uniqueIdString);
      beginRunUi();

      streamState.setRunId(await startRun(runConfig));
      streamState.setSourceTabId(runConfig.sourceTabId);
      messageDiv.answerFollowupIdentity = chatComposer.buildAnswerFollowupIdentity(
        promptRequest,
        runConfig.sourceTabId
      );
      if (pageActionsEnabled) setPageActionsRunActive(true);

      await executeRun(
        streamState.getRunId(),
        prepareRunMessages(runConfig, streamState.getConversationHistory())
      );
      return true;
    } catch (error) {
      handleRunFailure(error, 'makeApiCall');
      return false;
    } finally {
      endResponseRun();
    }
  }

  submitBtn.addEventListener('click', async () => {
    streamState.setActiveToolCall(null);
    const instruction = instructionInput.value;
    if (!instruction.trim()) {
      loadingManager.showToast('Please enter an instruction', 'warning');
      return;
    }

    if (isResponseBusy()) {
      loadingManager.showToast('A response is already in progress', 'warning');
      return;
    }

    submitBtn.disabled = true;

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

      if (streamState.getMediaData() && streamState.getMediaData().base64) {
        // Media + instruction
        const mediaInfo = `[${streamState.getMediaData().type.toUpperCase()} loaded]`;

        // Show chat area and hide one-off instruction area
        oneoffInstructionArea.classList.add('hidden');
        chatMainArea.classList.remove('hidden');
        chatUI.addMessage('User', `${effectiveInstruction}\n\n[${mediaInfo}]`);
        if (requestedSkill) {
          chatUI.addMessage(
            'System',
            `🎯 Skill detected: **${requestedSkill}**. Loading skill instructions...`
          );
        }

        // Use orchestrator with media + skill
        await makeApiCallWithMedia(
          {
            instruction: effectiveInstruction,
            context: {
              type: 'media',
            },
          },
          streamState.getMediaData(),
          'auto',
          requestedSkill
        );

        instructionInput.value = '';
        selectedTextDiv.textContent = '';
        selectedText = null;
        clearCurrentMediaData();
      } else if (selectedText && selectedText.trim()) {
        // Text-only instruction
        const promptRequest = {
          instruction: effectiveInstruction,
          context: {
            type: 'selected_text',
            text: selectedText,
          },
        };

        // Show chat area and hide one-off instruction area
        oneoffInstructionArea.classList.add('hidden');
        chatMainArea.classList.remove('hidden');
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

        await makeApiCall(promptRequest, 'auto', requestedSkill);
        instructionInput.value = '';
        // Keep the selection sticky so further sidebar prompts can reuse it.
      } else if (lastLoadedPageRequest || hasConversation()) {
        // No selection/media: an attached page is the source material;
        // otherwise run as a follow-up on the previous assistant response.
        const promptRequest = lastLoadedPageRequest
          ? buildPageScopedRequest(effectiveInstruction)
          : {
              instruction: effectiveInstruction,
              context: {
                type: 'previous_response',
              },
            };

        oneoffInstructionArea.classList.add('hidden');
        chatMainArea.classList.remove('hidden');
        chatUI.addMessage('User', effectiveInstruction);
        if (requestedSkill) {
          chatUI.addMessage(
            'System',
            `🎯 Skill detected: **${requestedSkill}**. Loading skill instructions...`
          );
        }

        await makeApiCall(promptRequest, 'auto', requestedSkill);
        instructionInput.value = '';
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
      resetRunUi(RUN_STATES.IDLE);
    } finally {
      submitBtn.disabled = false;
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
          button.textContent = instruction.name || 'Untitled prompt';
          button.title = instruction.name; // Set full instruction name as tooltip
          button.classList.add('quick-action-button', 'pinned-action-item');
          button.dataset.instructionId = instruction.id; // Store ID
          // button.dataset.instructionContent = instruction.content; // Or store full content

          button.addEventListener('click', () => {
            // Retrieve the instruction object
            const instructionToExecute = allInstructions.find(
              (inst) => inst.id === button.dataset.instructionId
            );
            if (!instructionToExecute) {
              loadingManager.showToast('Error: Could not find instruction details.', 'error');
              return;
            }
            executeSelectedTextInstruction(instructionToExecute);
          });
          pinnedActionsContainer.appendChild(button);
        }
      });
    } catch (error) {
      console.error('Error rendering pinned actions:', error);
      loadingManager.showToast('Error loading pinned actions.', 'error');
    }
  }

  // Initial rendering of pinned actions
  renderPinnedActions();

  // Rehydrate bounded activity and an optional Act checkpoint after a
  // side-panel reconnect. Checkpoint actions resume only after explicit Resume.
  void restoreRunJournal(chatArea, resumeActCheckpoint, watchActiveRun, restoreTerminalRun);

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
