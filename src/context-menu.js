// ===== Context Menu Module - Menu management =====
import { trackInstructionUsed, trackErrorEvent } from './analytics.js';

// Track existing image custom instruction menu items
let existingImageCustomMenuItems = new Set();

// Helper function to fetch media and convert to base64
async function fetchMediaAsBase64(url) {
  try {
    console.log('Fetching media from URL:', url);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    console.log('Blob size:', blob.size, 'Type:', blob.type);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        console.log('DataURL prefix:', dataUrl.substring(0, 50));
        const base64 = dataUrl.split(',')[1]; // Remove data:image/jpeg;base64, prefix
        console.log('Base64 length:', base64.length);
        console.log('Base64 sample:', base64.substring(0, 100));
        resolve(base64);
      };
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(error);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error fetching media:', error);
    throw error;
  }
}

// Helper function to determine MIME type from URL
function getMimeTypeFromUrl(url) {
  try {
    // Handle query parameters and fragments
    const cleanUrl = url.split('?')[0].split('#')[0];
    const extension = cleanUrl.split('.').pop().toLowerCase();
    console.log('Detected extension:', extension, 'from URL:', cleanUrl);

    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'bmp': 'image/bmp',
      'tiff': 'image/tiff',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'flac': 'audio/flac'
    };

    const mimeType = mimeTypes[extension] || 'image/jpeg'; // Default to jpeg for images
    console.log('Determined MIME type:', mimeType);
    return mimeType;
  } catch (error) {
    console.error('Error determining MIME type:', error);
    return 'image/jpeg'; // Safe default
  }
}

// Helper function to update image custom instructions in context menu
async function updateImageCustomInstructions() {
  try {
    // Remove existing custom instruction menu items that we know exist
    for (const menuItemId of existingImageCustomMenuItems) {
      try {
        await new Promise((resolve, reject) => {
          chrome.contextMenus.remove(menuItemId, () => {
            if (chrome.runtime.lastError) {
              // Menu item doesn't exist, that's fine
              resolve();
            } else {
              resolve();
            }
          });
        });
      } catch (e) {
        // Ignore errors for non-existent menu items
      }
    }
    existingImageCustomMenuItems.clear();

    // Add current custom instructions
    const { instructions } = await chrome.storage.local.get(['instructions']);
    if (instructions && instructions.length > 0) {
      for (const instruction of instructions) {
        const menuItemId = `imageCustom_${instruction.id}`;
        try {
          await new Promise((resolve, reject) => {
            chrome.contextMenus.create({
              id: menuItemId,
              parentId: "imageAnalysis",
              title: `⚡ ${instruction.name}`,
              contexts: ["image"]
            }, () => {
              if (chrome.runtime.lastError) {
                console.warn(`Failed to create menu item ${menuItemId}:`, chrome.runtime.lastError.message);
                resolve();
              } else {
                existingImageCustomMenuItems.add(menuItemId);
                resolve();
              }
            });
          });
        } catch (e) {
          console.warn(`Error creating menu item for instruction ${instruction.name}:`, e);
        }
      }
      console.log(`Updated image context menu with ${existingImageCustomMenuItems.size} custom instructions`);
    } else {
      console.log('No custom instructions found for image context menus');
    }
  } catch (error) {
    console.error('Error updating image custom instructions:', error);
  }
}

// Handle context menu clicks for media analysis
async function handleMediaContextMenuClick(info, tab) {
  try {
    // Open side panel FIRST (must be in direct response to user gesture)
    await chrome.sidePanel.open({ tabId: tab.id });

    // Get the media URL and determine action type
    const mediaUrl = info.srcUrl;
    let mediaType, actionType, instructionId;

    if (info.menuItemId.startsWith("imageCustom_")) {
      mediaType = "image";
      actionType = "custom";
      instructionId = info.menuItemId.replace("imageCustom_", "");
    } else if (info.menuItemId === "summarizeImage") {
      mediaType = "image";
      actionType = "summarize";
    } else if (info.menuItemId === "explainImage") {
      mediaType = "image";
      actionType = "explain";
    } else {
      // Default analysis (analyzeImage, analyzeVideo, analyzeAudio)
      mediaType = info.menuItemId.replace("analyze", "").toLowerCase();
      actionType = "analyze";
    }

    // Show loading message immediately (with error handling)
    try {
      chrome.runtime.sendMessage({
        action: 'setMediaForAnalysis',
        mediaData: {
          type: mediaType,
          base64: null, // Will be set later
          url: mediaUrl,
          mimeType: getMimeTypeFromUrl(mediaUrl),
          loading: true
        },
        tabId: tab.id
      });
    } catch (error) {
      console.log('Side panel not ready yet, will send message after image loads');
    }

    // Convert media to base64 for API (async operation)
    fetchMediaAsBase64(mediaUrl).then(base64Data => {
      const mimeType = getMimeTypeFromUrl(mediaUrl);
      console.log('Sending media data:', {
        type: mediaType,
        url: mediaUrl,
        mimeType: mimeType,
        base64Length: base64Data.length
      });

      // Send the actual media data (with retry logic for side panel)
      const sendMediaData = () => {
        try {
          chrome.runtime.sendMessage({
            action: 'setMediaForAnalysis',
            mediaData: {
              type: mediaType,
              base64: base64Data,
              url: mediaUrl,
              mimeType: mimeType,
              loading: false,
              actionType: actionType,
              instructionId: instructionId
            },
            tabId: tab.id
          });
        } catch (error) {
          console.log('Retrying message send in 500ms...');
          setTimeout(sendMediaData, 500);
        }
      };

      // Give side panel time to load if it was just opened
      setTimeout(sendMediaData, 1000);
    }).catch(async error => {
      console.error('Error fetching media:', error);
      try { await trackErrorEvent('network', `media_${error?.name || 'err'}`); } catch (_) {}
      chrome.runtime.sendMessage({
        action: 'setMediaForAnalysis',
        mediaData: {
          type: mediaType,
          base64: null,
          url: mediaUrl,
          mimeType: getMimeTypeFromUrl(mediaUrl),
          error: error.message
        },
        tabId: tab.id
      });
    });

  } catch (error) {
    console.error('Error processing media:', error);
  }
}

// Optimized context menu click handler
async function handleContextMenuClick(info, tab) {
  // Skip media analysis menu items - they're handled by the new multimodal handler above
  if (info.menuItemId === "analyzeImage" || info.menuItemId === "analyzeVideo" || info.menuItemId === "analyzeAudio" ||
      info.menuItemId === "summarizeImage" || info.menuItemId === "explainImage" ||
      info.menuItemId.startsWith("imageCustom_") ||
      info.menuItemId === "imageAnalysis" || info.menuItemId === "videoAnalysis" || info.menuItemId === "audioAnalysis") {
    return handleMediaContextMenuClick(info, tab);
  }

  console.log("Context Menu Clicked:", info.menuItemId, "Initial selectionText:", info.selectionText);
  await chrome.sidePanel.open({ tabId: tab.id });

  let originalSelectionText = info.selectionText;
  let promptContent = info.selectionText || '';

  if (!originalSelectionText) {
    console.log("No text selected, attempting to fetch tab content via 'getTabContent' message...");
    try {
      // The contextMenus.onClicked listener IS async (line 23).
      const tabDataResponse = await new Promise((resolve, reject) => {
        const messageTimeout = setTimeout(() => {
          reject(new Error("Timeout waiting for getTabContent response"));
        }, 5000); // 5 second timeout for the message response

        chrome.runtime.sendMessage({ action: 'getTabContent', tabId: tab.id }, (response) => {
          clearTimeout(messageTimeout);
          if (chrome.runtime.lastError) {
            console.error("Background: Error receiving getTabContent response:", chrome.runtime.lastError.message);
            return reject(new Error("Failed to get tab content: " + chrome.runtime.lastError.message));
          }
          if (response) {
            resolve(response); // Resolve with the full response object
          } else {
            // This case should ideally be caught by chrome.runtime.lastError if sendResponse is not called
            reject(new Error("Failed to get tab content: No response from getTabContent handler."));
          }
        });
      });

      // Check for both content and data properties to handle different response formats
      if (tabDataResponse && tabDataResponse.success) {
        if (tabDataResponse.content) {
          promptContent = tabDataResponse.content;
          console.log("Background: Tab content fetched via 'getTabContent' message (content property), length:", promptContent.length);
        } else if (tabDataResponse.data) {
          promptContent = tabDataResponse.data;
          console.log("Background: Tab content fetched via 'getTabContent' message (data property), length:", promptContent.length);
        } else {
          console.error("Background: Tab content response successful but missing content/data property. Response:", tabDataResponse);
          promptContent = originalSelectionText; // Fallback
        }
      } else {
        console.error("Background: Failed to get tab content via 'getTabContent' message. Response:", tabDataResponse);
        promptContent = originalSelectionText; // Fallback to empty or original selection
      }
    } catch (error) {
      console.error("Background: Exception while fetching tab content via 'getTabContent' message:", error.message);
      promptContent = originalSelectionText; // Fallback
    }
  }

  // Handle image context (only for non-multimodal menu items)
  // This should be applied *after* potentially fetching tab content if selection was empty
  // Skip this for our new multimodal menu items since they're handled separately
  if (info.mediaType === 'image' && info.srcUrl && !info.menuItemId.includes("Image") && !info.menuItemId.includes("Video") && !info.menuItemId.includes("Audio")) {
    // If promptContent is from tab summary, prepend image URL. Otherwise, it's selection text.
    promptContent = `Image URL: ${info.srcUrl}\n${promptContent}`.trim();
    console.log("Image context added. Updated promptContent:", promptContent.substring(0, 100));
  }

  console.log("Base promptContent before instruction:", promptContent.substring(0, 100));

  // Handle special menu items
  if (info.menuItemId === 'manageInstructions') {
    console.log("Handling manageInstructions, opening options page.");
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return;
  }

  // Common message sending function
  const sendMessage = (action, extra = {}) => {
    chrome.runtime.sendMessage({
      action,
      selectedText: promptContent,
      tabId: tab.id,
      ...extra
    }).catch(error => console.log(`Error sending ${action}: ${error.message}, tabId: ${tab.id}`));
  };

  if (info.menuItemId === 'oneoff_instruction') {
    console.log("Handling oneoff_instruction. Sending setSelectedText message.");
    setTimeout(() => sendMessage('setSelectedText'), 100); // sendMessage already logs errors
    return;
  }

  if (info.menuItemId === 'start_chat') {
    console.log("Handling start_chat. Sending setSelectedText and calling API.");
    sendMessage('setSelectedText', { fromStartChat: true });
    console.log("Final promptContent with instruction (start_chat - implicit):", promptContent.substring(0, 100));
    console.log("Calling makeLlmApiRequest for menuItemId:", info.menuItemId);
    // Note: makeLlmApiRequest will be imported and called from the main module
    return;
  }

  // Handle custom instructions
  if (info.menuItemId.startsWith('custom_')) {
    const instructionId = info.menuItemId.replace('custom_', '');
    console.log("Handling custom instruction. ID:", instructionId);
    const { instructions } = await chrome.storage.local.get(['instructions']);
    const instruction = instructions.find(i => i.id === instructionId);

    if (instruction) {
      // Track custom instruction usage
      try {
        // Note: validateConfig and trackInstructionUsed will be imported from other modules
        const cfg = await validateConfig().catch(() => ({}));
        await trackInstructionUsed({ instruction: instruction.name || 'custom', model: cfg?.modelName, tools: Array.isArray(instruction.tool_choice) ? instruction.tool_choice : (instruction.tool_choice && instruction.tool_choice !== 'none' ? [instruction.tool_choice] : []) });
      } catch (_) {}
      promptContent = `${instruction.content}\n\n${promptContent}`;
      console.log("Final promptContent with instruction (custom):", promptContent.substring(0, 100));
      const toolChoice = instruction.tool_choice || 'none';
      console.log("Calling makeLlmApiRequest for menuItemId (custom):", info.menuItemId, "with tool_choice:", toolChoice);
      // Note: makeLlmApiRequest will be imported and called from the main module
    } else {
      console.error("Custom instruction not found for ID:", instructionId);
    }
    return;
  }

  // Handle predefined commands
  const commandMap = {
    summarize: 'Please summarize the following text into a bullet list of points',
    explain: 'Explain this to me in a short concise MECE approach',
    polish: 'Polish this text with clarity and purpose',
    shorten: 'Shorten this text without losing its meaning and context',
    formal: 'Make this text more formal and eloquent',
    casual: 'Make this text more casual and fun',
    analyze: 'Please analyze the following text'
  };

  if (commandMap[info.menuItemId]) {
    // Track predefined instruction usage
    try {
      const cfg = await validateConfig().catch(() => ({}));
      await trackInstructionUsed({ instruction: info.menuItemId, model: cfg?.modelName, tools: [] });
    } catch (_) {}
    promptContent = `${commandMap[info.menuItemId]}:\n${promptContent}`;
    console.log("Final promptContent with instruction (predefined):", promptContent.substring(0, 100));
  } else if (info.menuItemId.startsWith('custom_')) {
    // handled earlier, but if reaches here ignore
  } else if (info.menuItemId !== 'prompt_paul' && info.menuItemId !== 'oneoff_instruction' && info.menuItemId !== 'start_chat' && info.menuItemId !== 'manageInstructions') {
    console.log("No specific command/instruction prepended for menuItemId:", info.menuItemId);
  }

  console.log("Calling makeLlmApiRequest for menuItemId:", info.menuItemId);
  // Note: makeLlmApiRequest will be imported and called from the main module
}

// Create context menu items
function createContextMenus() {
  // Create one-off instruction menu item (always at top)
  chrome.contextMenus.create({
    id: 'oneoff_instruction',
    title: '✨ One-off Instruction',
    contexts: ['selection', 'image'],
  });

  // Create start chat menu item
  chrome.contextMenus.create({
    id: 'start_chat',
    title: '💬 Start Chat',
    contexts: ['selection', 'image'],
  });

  // Create parent menu for Prompt Paul
  chrome.contextMenus.create({
    id: 'prompt_paul',
    title: 'Query Prompt Paul',
    contexts: ['selection', 'image'],
  });

  // Create predefined menu items under Prompt Paul
  chrome.contextMenus.create({
    id: 'summarize',
    title: '📝 Summarize',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'analyze',
    title: '🧐 Analyze',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'explain',
    title: '❓ Explain',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'polish',
    title: '🪄 Polish',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'shorten',
    title: '✂️ Shorten',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'formal',
    title: '💼 Formal',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'casual',
    title: '🤙 Casual',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  // Create parent menu for custom instructions
  chrome.contextMenus.create({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: ['selection', 'image'],
  });

  // Add a separator and manage instructions at the end
  setTimeout(() => {
    // Add a separator
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['selection', 'image'],
    });

    // Add option to manage custom instructions as the last item
    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: ['selection', 'image'],
    });
  }, 100);
}

// Create context menus for images and other media
function createMediaContextMenus() {
  // Create parent menu for images
  chrome.contextMenus.create({
    id: "imageAnalysis",
    title: "Analyze Image with Prompt Paul",
    contexts: ["image"]
  });

  // Quick actions for images
  chrome.contextMenus.create({
    id: "analyzeImage",
    parentId: "imageAnalysis",
    title: "🔍 General Analysis",
    contexts: ["image"]
  });

  chrome.contextMenus.create({
    id: "summarizeImage",
    parentId: "imageAnalysis",
    title: "📝 Summarize Image",
    contexts: ["image"]
  });

  chrome.contextMenus.create({
    id: "explainImage",
    parentId: "imageAnalysis",
    title: "💡 Explain Image",
    contexts: ["image"]
  });

  // Add separator
  chrome.contextMenus.create({
    id: "imageSeparator",
    parentId: "imageAnalysis",
    type: "separator",
    contexts: ["image"]
  });

  // Load and add custom instructions for images
  updateImageCustomInstructions();

  // Create parent menu for videos
  chrome.contextMenus.create({
    id: "videoAnalysis",
    title: "Analyze Video with Prompt Paul",
    contexts: ["video"]
  });

  chrome.contextMenus.create({
    id: "analyzeVideo",
    parentId: "videoAnalysis",
    title: "🎥 General Analysis",
    contexts: ["video"]
  });

  // Create parent menu for audio
  chrome.contextMenus.create({
    id: "audioAnalysis",
    title: "Analyze Audio with Prompt Paul",
    contexts: ["audio"]
  });

  chrome.contextMenus.create({
    id: "analyzeAudio",
    parentId: "audioAnalysis",
    title: "🎵 General Analysis",
    contexts: ["audio"]
  });
}

// Update context menus when instructions change
function setupContextMenuListeners() {
  chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && changes.instructions) {
      console.log('Custom instructions changed, updating image context menus...');
      updateImageCustomInstructions();
    }
  });
}

export {
  handleContextMenuClick,
  createContextMenus,
  createMediaContextMenus,
  setupContextMenuListeners,
  updateImageCustomInstructions,
  fetchMediaAsBase64,
  getMimeTypeFromUrl
};