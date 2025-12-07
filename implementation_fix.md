# Implementation Fix for Custom Image Instructions

## Problem

Custom image instructions fail with "Could not establish connection. Receiving end does not exist" error because they attempt to fetch tab content via unreliable message passing, while pre-written image instructions use direct media processing.

## Solution

Modify the context menu handler in [`background.js`](background.js) to treat `imageCustom_` instructions like other image instructions, bypassing the unreliable `getTabContent` message.

## Required Changes

### File: `background.js`

#### Change 1: Modify Context Menu Handler (Lines 514-530)

**Current Code:**

```javascript
let mediaType, actionType, instructionId;

if (info.menuItemId.startsWith('imageCustom_')) {
  mediaType = 'image';
  actionType = 'custom';
  instructionId = info.menuItemId.replace('imageCustom_', '');
} else if (info.menuItemId === 'summarizeImage') {
  mediaType = 'image';
  actionType = 'summarize';
} else if (info.menuItemId === 'explainImage') {
  mediaType = 'image';
  actionType = 'explain';
} else {
  // Default analysis (analyzeImage, analyzeVideo, analyzeAudio)
  mediaType = info.menuItemId.replace('analyze', '').toLowerCase();
  actionType = 'analyze';
}
```

**Fixed Code:**

```javascript
let mediaType, actionType, instructionId;

if (info.menuItemId.startsWith('imageCustom_')) {
  mediaType = 'image';
  actionType = 'custom';
  instructionId = info.menuItemId.replace('imageCustom_', '');
} else if (info.menuItemId === 'summarizeImage') {
  mediaType = 'image';
  actionType = 'summarize';
} else if (info.menuItemId === 'explainImage') {
  mediaType = 'image';
  actionType = 'explain';
} else {
  // Default analysis (analyzeImage, analyzeVideo, analyzeAudio)
  mediaType = info.menuItemId.replace('analyze', '').toLowerCase();
  actionType = 'analyze';
}
```

#### Change 2: Bypass Content Extraction for Image Instructions (Lines 588-636)

**Current Code:**

```javascript
console.log('Context Menu Clicked:', info.menuItemId, 'Initial selectionText:', info.selectionText);
await chrome.sidePanel.open({ tabId: tab.id });

let originalSelectionText = info.selectionText;
let promptContent = info.selectionText || '';

if (!originalSelectionText) {
  console.log("No text selected, attempting to fetch tab content via 'getTabContent' message...");
  // ... content extraction logic that fails
}
```

**Fixed Code:**

```javascript
console.log('Context Menu Clicked:', info.menuItemId, 'Initial selectionText:', info.selectionText);
await chrome.sidePanel.open({ tabId: tab.id });

let originalSelectionText = info.selectionText;
let promptContent = info.selectionText || '';

// Skip content extraction for image-based instructions (both custom and pre-written)
if (mediaType === 'image') {
  console.log('Image instruction detected, skipping content extraction');
  promptContent = originalSelectionText || ''; // Keep empty for image-only processing
} else if (!originalSelectionText) {
  console.log("No text selected, attempting to fetch tab content via 'getTabContent' message...");
  try {
    // ... existing content extraction logic (only for non-image instructions)
  } catch (error) {
    console.error(
      "Background: Exception while fetching tab content via 'getTabContent' message:",
      error.message
    );
    promptContent = originalSelectionText; // Fallback
  }
}
```

#### Change 3: Add Custom Instruction Processing (Lines 683-704)

**Current Code:**

```javascript
// Handle custom instructions
if (info.menuItemId.startsWith('custom_')) {
  const instructionId = info.menuItemId.replace('custom_', '');
  console.log('Handling custom instruction. ID:', instructionId);
  const { instructions } = await chrome.storage.local.get(['instructions']);
  const instruction = instructions.find(i => i.id === instructionId);

  if (instruction) {
    // Track custom instruction usage
    try {
      const cfg = await validateConfig().catch(() => ({}));
      await analytics.trackInstructionUsed({
        instruction: instruction.name || 'custom',
        model: cfg?.modelName,
        tools: Array.isArray(instruction.tool_choice)
          ? instruction.tool_choice
          : instruction.tool_choice && instruction.tool_choice !== 'none'
            ? [instruction.tool_choice]
            : [],
      });
    } catch (_) {}
    promptContent = `${instruction.content}\n\n${promptContent}`;
    console.log('Final promptContent with instruction (custom):', promptContent.substring(0, 100));
    const toolChoice = instruction.tool_choice || 'none';
    console.log(
      'Calling makeLlmApiRequest for menuItemId (custom):',
      info.menuItemId,
      'with tool_choice:',
      toolChoice
    );
    await makeLlmApiRequest(promptContent, tab.id, { customInstructionToolChoice: toolChoice });
  } else {
    console.error('Custom instruction not found for ID:', instructionId);
  }
  return;
}
```

**Fixed Code:**

```javascript
// Handle custom instructions (text-based only)
if (info.menuItemId.startsWith('custom_') && mediaType !== 'image') {
  const instructionId = info.menuItemId.replace('custom_', '');
  console.log('Handling custom text instruction. ID:', instructionId);
  const { instructions } = await chrome.storage.local.get(['instructions']);
  const instruction = instructions.find(i => i.id === instructionId);

  if (instruction) {
    // Track custom instruction usage
    try {
      const cfg = await validateConfig().catch(() => ({}));
      await analytics.trackInstructionUsed({
        instruction: instruction.name || 'custom',
        model: cfg?.modelName,
        tools: Array.isArray(instruction.tool_choice)
          ? instruction.tool_choice
          : instruction.tool_choice && instruction.tool_choice !== 'none'
            ? [instruction.tool_choice]
            : [],
      });
    } catch (_) {}
    promptContent = `${instruction.content}\n\n${promptContent}`;
    console.log(
      'Final promptContent with instruction (custom text):',
      promptContent.substring(0, 100)
    );
    const toolChoice = instruction.tool_choice || 'none';
    console.log(
      'Calling makeLlmApiRequest for menuItemId (custom text):',
      info.menuItemId,
      'with tool_choice:',
      toolChoice
    );
    await makeLlmApiRequest(promptContent, tab.id, { customInstructionToolChoice: toolChoice });
  } else {
    console.error('Custom instruction not found for ID:', instructionId);
  }
  return;
}

// Handle custom image instructions
if (info.menuItemId.startsWith('imageCustom_')) {
  console.log('Handling custom image instruction. ID:', instructionId);
  const { instructions } = await chrome.storage.local.get(['instructions']);
  const instruction = instructions.find(i => i.id === instructionId);

  if (instruction) {
    // Track custom instruction usage
    try {
      const cfg = await validateConfig().catch(() => ({}));
      await analytics.trackInstructionUsed({
        instruction: instruction.name || 'custom',
        model: cfg?.modelName,
        tools: Array.isArray(instruction.tool_choice)
          ? instruction.tool_choice
          : instruction.tool_choice && instruction.tool_choice !== 'none'
            ? [instruction.tool_choice]
            : [],
      });
    } catch (_) {}

    // For image instructions, prepend instruction to media processing
    // The actual image processing will be handled by the existing media pipeline
    console.log(
      'Final promptContent with instruction (custom image):',
      instruction.content.substring(0, 100)
    );

    // Set a flag or modify the media processing to include the instruction
    // The existing media processing code will handle the actual API call
    return; // Let the existing media processing continue
  } else {
    console.error('Custom image instruction not found for ID:', instructionId);
  }
  return;
}
```

#### Change 4: Modify Media Processing to Include Custom Instruction (Lines 560-583)

**Current Code:**

```javascript
// Send actual media data (with retry logic for side panel)
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
        instructionId: instructionId,
      },
      tabId: tab.id,
    });
  } catch (error) {
    console.log('Retrying message send in 500ms...');
    setTimeout(sendMediaData, 500);
  }
};
```

**Fixed Code:**

```javascript
// Send actual media data (with retry logic for side panel)
const sendMediaData = () => {
  try {
    // For custom image instructions, get the instruction content
    let instructionContent = '';
    if (actionType === 'custom' && instructionId) {
      const { instructions } = chrome.storage.local.get(['instructions']);
      const instruction = instructions.find(i => i.id === instructionId);
      if (instruction) {
        instructionContent = instruction.content;
      }
    }

    chrome.runtime.sendMessage({
      action: 'setMediaForAnalysis',
      mediaData: {
        type: mediaType,
        base64: base64Data,
        url: mediaUrl,
        mimeType: mimeType,
        loading: false,
        actionType: actionType,
        instructionId: instructionId,
        instructionContent: instructionContent, // Add instruction content to media data
      },
      tabId: tab.id,
    });
  } catch (error) {
    console.log('Retrying message send in 500ms...');
    setTimeout(sendMediaData, 500);
  }
};
```

## Testing Steps

1. **Apply the changes** to `background.js`
2. **Reload the extension** to ensure new code takes effect
3. **Test custom image instructions** on various images
4. **Verify pre-written image instructions** still work
5. **Test text-based custom instructions** to ensure no regression
6. **Check console logs** for diagnostic information

## Expected Results

- ✅ Custom image instructions work without "connection" errors
- ✅ Pre-written image instructions continue to work
- ✅ Text-based custom instructions still work
- ✅ No more content extraction for image-based operations
- ✅ Cleaner, more reliable code path for all image instructions

## Rollback Plan

If issues occur:

1. Revert to original `background.js`
2. Test that basic functionality is restored
3. Implement alternative approach (Option 2 from diagnostic plan)
4. Consider feature flag for gradual rollout

## Alternative Approaches

If the direct processing fix doesn't work:

1. **Robust Content Script Injection** (Option 2): Improve reliability of content script injection
2. **Hybrid Approach** (Option 3): Use different processing based on instruction modality
3. **Message Passing Improvements**: Add retry mechanisms and better error handling

The direct processing approach (Option 1) is recommended as it's the simplest and most reliable fix.
