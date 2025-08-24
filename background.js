import './marked.min.js';

// ===== Main Background Script - Module Orchestration =====
import { trackInstalled, trackErrorEvent } from './analytics.js';
import {
  handleContextMenuClick,
  createContextMenus,
  createMediaContextMenus,
  setupContextMenuListeners
} from './context-menu.js';
import { makeLlmApiRequest } from './api-client.js';
import {
  executePromptPaulTool,
  getDiscoveredMcpToolSchema,
  fetchMcpToolDetailsFromServer
} from './tool-executor.js';
import { cleanupMcpSessions } from './mcp-client.js';
// Initialize context menus
chrome.runtime.onInstalled.addListener(async (details) => {
  // Track install/update event once
  try {
    await trackInstalled();
  } catch (_) {}

  // Create standard context menus
  createContextMenus();

  // Create media analysis context menus
  createMediaContextMenus();

  // Set up context menu listeners
  setupContextMenuListeners();
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await handleContextMenuClick(info, tab);
});

console.log('marked.min.js imported successfully.');
console.log('Background service worker script started.');

// Enable the side panel on all pages
chrome.sidePanel
  .setOptions({ path: 'chat.html' })
  .catch((error) => console.error(error));

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.sidePanel.setOptions({
    tabId,
    path: 'chat.html',
    enabled: true
  }).catch((error) => console.error(`Error setting side panel options for tab ${tabId}:`, error));
});





// Message listener setup - placeholder for now
// Note: Message handling will be implemented as needed

