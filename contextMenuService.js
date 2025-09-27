// ===== Context Menu Service =====

// Track existing dynamic menu items so we can rebuild without removeAll()
let existingImageCustomMenuItems = new Set();
let existingTextCustomMenuItems = new Set();

// Guards to prevent concurrent initialization/updates
let menusInitPromise = null;
let updateImageMenusPromise = null;
let updateTextMenusPromise = null;

async function fetchMediaAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }
    
    const blob = await response.blob();
    const maxSize = 10 * 1024 * 1024; // 10MB limit
    if (blob.size > maxSize) {
      throw new Error(`Image too large: ${(blob.size / 1024 / 1024).toFixed(1)}MB > 10MB`);
    }
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error fetching media:', error);
    throw error;
  }
}

async function updateImageCustomInstructions() {
  if (updateImageMenusPromise) {
    try { await updateImageMenusPromise; } catch (_) {}
    return; // Another update in progress or just finished
  }
  updateImageMenusPromise = (async () => {
  try {
    // Remove existing custom menu items
    for (const itemId of existingImageCustomMenuItems) {
      try {
        await chrome.contextMenus.remove(itemId);
      } catch (e) {
        console.warn(`Failed to remove menu item ${itemId}:`, e);
      }
    }
    existingImageCustomMenuItems.clear();

    // Get current instructions
    const { instructions } = await chrome.storage.local.get(['instructions']);
    if (!instructions || instructions.length === 0) return;

    // Filter instructions that support images in new schema (modalities contains 'image')
    const imageInstructions = instructions.filter(inst => {
      const modalities = inst.modalities || [];
      return (modalities.includes('image')) && inst.enabled !== false;
    });

    // Add new menu items for image instructions under the parent imageAnalysis
    for (const instruction of imageInstructions) {
      const menuId = `image_instruction_${instruction.id}`;
      const title = instruction.name || instruction.title || 'Custom Instruction';
      try {
        await chrome.contextMenus.create({
          id: menuId,
          parentId: 'imageAnalysis',
          title: `⚡ ${title}`,
          contexts: ['image'],
          documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
        });
        existingImageCustomMenuItems.add(menuId);
      } catch (error) {
        console.warn(`Failed to create menu item for ${title}:`, error);
      }
    }
  } catch (error) {
    console.error('Error updating image context menus:', error);
  } finally {
    updateImageMenusPromise = null;
  }
})() // end guarded promise
}

function getMimeTypeFromUrl(url) {
  const extension = url.split('.').pop()?.toLowerCase();
  const mimeMap = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml'
  };
  return mimeMap[extension] || 'image/jpeg';
}

// Initialize context menus
async function initializeContextMenus() {
  if (menusInitPromise) {
    try { await menusInitPromise; } catch (_) {}
    return; // already initialized or in progress
  }
  menusInitPromise = (async () => {
  try {
    // Remove all existing context menus first to prevent duplicates
    await chrome.contextMenus.removeAll();

    // Text selection menus (in specified order)
    await chrome.contextMenus.create({
      id: 'oneoff_instruction',
      title: '✨ One-off Instruction',
      contexts: ['selection','page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
    });

    await chrome.contextMenus.create({
      id: 'start_chat',
      title: '💬 Start Chat',
      contexts: ['selection','page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
    });

    // Parent: Query Prompt Paul
    await chrome.contextMenus.create({
      id: 'prompt_paul',
      title: '🤖 Query Prompt Paul',
      contexts: ['selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
    });

    const promptPaulChildren = [
      { id: 'summarize', title: '📝 Summarize' },
      { id: 'analyze', title: '🧐 Analyze' },
      { id: 'explain', title: '❓ Explain' },
      { id: 'polish', title: '🪄 Polish' },
      { id: 'shorten', title: '✂️ Shorten' },
      { id: 'formal', title: '💼 Formal' },
      { id: 'casual', title: '🤙 Casual' }
    ];

    for (const child of promptPaulChildren) {
      await chrome.contextMenus.create({
        id: child.id,
        parentId: 'prompt_paul',
        title: child.title,
        contexts: ['selection','page'],
        documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
      });
    }

    // Parent: Custom Instructions
    await chrome.contextMenus.create({
      id: 'customInstructions',
      title: '✨ Custom Instructions',
      contexts: ['selection','page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
    });

    // Build dynamic children now
    await updateTextCustomInstructions();

    // Separator and Manage
    await chrome.contextMenus.create({
      id: 'textSeparator',
      type: 'separator',
      contexts: ['selection','page']
    });

    await chrome.contextMenus.create({
      id: 'manageInstructions',
      title: '🛠️ Manage Custom Instructions',
      contexts: ['selection','page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
    });

    // Image analysis parent and children
    await chrome.contextMenus.create({
      id: 'imageAnalysis',
      title: 'Analyze Image with Prompt Paul',
      contexts: ['image'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });

    await chrome.contextMenus.create({
      id: 'analyzeImage',
      parentId: 'imageAnalysis',
      title: 'General Analysis',
      contexts: ['image']
    });

    await chrome.contextMenus.create({
      id: 'summarizeImage',
      parentId: 'imageAnalysis',
      title: 'Summarize Image',
      contexts: ['image']
    });

    await chrome.contextMenus.create({
      id: 'explainImage',
      parentId: 'imageAnalysis',
      title: 'Explain Image',
      contexts: ['image']
    });

    await chrome.contextMenus.create({
      id: 'imageSeparator',
      parentId: 'imageAnalysis',
      type: 'separator',
      contexts: ['image']
    });

    // Custom image instruction items will be created under imageAnalysis
    await updateImageCustomInstructions();

    // Video analysis parent and child
    await chrome.contextMenus.create({
      id: 'videoAnalysis',
      title: 'Analyze Video with Prompt Paul',
      contexts: ['video'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });

    await chrome.contextMenus.create({
      id: 'analyzeVideo',
      parentId: 'videoAnalysis',
      title: 'General Analysis',
      contexts: ['video']
    });

    // Audio analysis parent and child
    await chrome.contextMenus.create({
      id: 'audioAnalysis',
      title: 'Analyze Audio with Prompt Paul',
      contexts: ['audio'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });

    await chrome.contextMenus.create({
      id: 'analyzeAudio',
      parentId: 'audioAnalysis',
      title: 'General Analysis',
      contexts: ['audio']
    });
  } catch (error) {
    console.error('Error initializing context menus:', error);
  } finally {
    menusInitPromise = null;
  }
})() // end guarded promise
}

// Listen for instruction changes to update menus
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.instructions) {
      updateTextCustomInstructions();
      updateImageCustomInstructions();
    }
  });
}

// Dynamically (re)build Custom Instructions subtree for text selection
async function updateTextCustomInstructions() {
  if (updateTextMenusPromise) {
    try { await updateTextMenusPromise; } catch (_) {}
    return;
  }
  updateTextMenusPromise = (async () => {
    try {
      // Remove existing custom menu items
      for (const itemId of existingTextCustomMenuItems) {
        try { await chrome.contextMenus.remove(itemId); } catch (_) {}
      }
      existingTextCustomMenuItems.clear();

      const { instructions } = await chrome.storage.local.get(['instructions']);
      if (!instructions || instructions.length === 0) return;

      for (const inst of instructions) {
        if (inst.enabled === false) continue;
        const id = `custom_${inst.id}`;
        const title = inst.name || inst.title || 'Custom Instruction';
        try {
          await chrome.contextMenus.create({
            id,
            parentId: 'customInstructions',
            title: `✨ ${title}`,
            contexts: ['selection'],
            documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*/*']
          });
          existingTextCustomMenuItems.add(id);
        } catch (e) {
          console.warn('Failed creating text custom menu', id, e);
        }
      }
    } finally {
      updateTextMenusPromise = null;
    }
  })();
}

export {
  fetchMediaAsBase64,
  updateImageCustomInstructions,
  updateTextCustomInstructions,
  getMimeTypeFromUrl,
  initializeContextMenus,
  existingImageCustomMenuItems,
  existingTextCustomMenuItems
};