# Diagnostic Plan for Chrome Extension Connection Issue

## Problem Summary
Custom image instructions fail with "Could not establish connection. Receiving end does not exist" error, while pre-written image instructions work correctly.

## Root Cause Analysis

### Error Flow
1. User clicks custom image instruction (`imageCustom_${instructionId}`)
2. Background script processes the click and attempts to fetch tab content
3. Background sends `getTabContent` message to content script
4. Content script fails to respond or isn't properly injected
5. Error occurs: "Could not establish connection. Receiving end does not exist"

### Key Differences
- **Pre-written instructions** (`summarizeImage`, `explainImage`): Direct media processing path
- **Custom instructions** (`imageCustom_${instructionId}`): Requires content extraction via `getTabContent` message

## Diagnostic Steps

### Step 1: Verify Content Script Injection
**Goal**: Confirm content script is properly injected and ready

**Actions**:
1. Add comprehensive logging to [`background.js:2053`](background.js:2053) around `chrome.scripting.executeScript`
2. Check for `chrome.runtime.lastError` immediately after injection
3. Verify injection results contain valid data
4. Add debug logging in content script to confirm it loads

**Test Code**:
```javascript
// Add to background.js before injection
console.log('[DIAGNOSTIC] Attempting content script injection for tab:', activeTabId);

chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['content_script_unified.js']
}, (injectionResults) => {
    console.log('[DIAGNOSTIC] Injection callback triggered');
    console.log('[DIAGNOSTIC] Injection results:', injectionResults);
    console.log('[DIAGNOSTIC] Last error:', chrome.runtime.lastError);
    
    // ... existing error handling
});
```

### Step 2: Test Message Passing Reliability
**Goal**: Verify message communication between background and content script

**Actions**:
1. Add message listener verification in content script
2. Test with simple ping/pong messages
3. Check for message timeout issues
4. Verify message format consistency

**Test Code**:
```javascript
// Add to content_script_unified.js at the beginning
console.log('[DIAGNOSTIC] Content script loaded and executing');

// Add message listener test
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[DIAGNOSTIC] Content script received message:', request.action);
    if (request.action === 'getTabContent') {
        console.log('[DIAGNOSTIC] Processing getTabContent request');
        // ... existing logic
    }
});
```

### Step 3: Compare Code Paths
**Goal**: Identify why custom instructions trigger different behavior

**Actions**:
1. Log the complete `info` object in context menu handler
2. Trace execution path for both working and failing cases
3. Check if `originalSelectionText` is empty for custom instructions
4. Verify tab ID validity in both scenarios

**Test Code**:
```javascript
// Add to background.js context menu handler
console.log('[DIAGNOSTIC] Context menu clicked:', {
    menuItemId: info.menuItemId,
    hasSelection: !!info.selectionText,
    mediaType: info.mediaType,
    srcUrl: info.srcUrl,
    tabId: tab.id,
    tabUrl: tab.url
});
```

### Step 4: Test Content Script Readiness
**Goal**: Ensure content script is ready before messages are sent

**Actions**:
1. Add readiness check before sending messages
2. Implement retry mechanism with backoff
3. Test with different page load states
4. Check for race conditions in script injection

**Test Code**:
```javascript
// Add readiness verification
async function ensureContentScriptReady(tabId) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 3;
        
        const tryInjection = () => {
            attempts++;
            console.log(`[DIAGNOSTIC] Injection attempt ${attempts}/${maxAttempts} for tab ${tabId}`);
            
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    return { ready: true, hasListener: typeof chrome.runtime.onMessage !== 'undefined' };
                }
            }, (results) => {
                if (chrome.runtime.lastError) {
                    if (attempts >= maxAttempts) {
                        reject(chrome.runtime.lastError);
                    } else {
                        setTimeout(tryInjection, 500 * attempts);
                    }
                } else {
                    resolve(results);
                }
            });
        };
        
        tryInjection();
    });
}
```

### Step 5: Validate Message Response Handling
**Goal**: Ensure proper async response handling

**Actions**:
1. Check that `sendResponse` is called exactly once
2. Verify no double response errors
3. Test with async/await patterns
4. Check for message timeout handling

**Test Code**:
```javascript
// Add to background.js message handler
console.log('[DIAGNOSTIC] Setting up message response for action:', request.action);
const responseSent = { value: false };

const safeSendResponse = (response) => {
    if (!responseSent.value) {
        responseSent.value = true;
        console.log('[DIAGNOSTIC] Sending response for action:', request.action);
        sendResponse(response);
    } else {
        console.warn('[DIAGNOSTIC] Attempted to send response twice for action:', request.action);
    }
};
```

## Implementation Fix Strategy

### Option 1: Direct Media Processing (Recommended)
Modify custom image instructions to bypass content extraction and use direct media processing like pre-written instructions.

**Changes needed**:
1. In [`background.js:516-520`](background.js:516-520), handle `imageCustom_` instructions similar to `summarizeImage`/`explainImage`
2. Remove the `getTabContent` dependency for image-based custom instructions
3. Use the existing media processing pipeline

### Option 2: Robust Content Script Injection
Improve the reliability of content script injection and message passing.

**Changes needed**:
1. Add injection verification and retry logic
2. Implement content script readiness checks
3. Add better error handling and fallbacks
4. Consider using `chrome.tabs.executeScript` with proper error handling

### Option 3: Hybrid Approach
Combine both approaches based on instruction type.

**Changes needed**:
1. Detect if instruction is image-based vs text-based
2. Use direct media processing for image instructions
3. Use content extraction for text-based instructions
4. Add modality detection to instruction objects

## Testing Checklist

- [ ] Test custom image instructions on various image types (jpg, png, gif)
- [ ] Test custom image instructions on different websites
- [ ] Verify pre-written image instructions still work
- [ ] Test text-based custom instructions
- [ ] Test with empty selection vs selected text
- [ ] Test on pages with heavy JavaScript/content
- [ ] Test on pages where content script injection might fail
- [ ] Verify error messages are user-friendly
- [ ] Check console logs for diagnostic information
- [ ] Test extension reload and service worker restart scenarios

## Expected Outcomes

### Success Criteria
1. Custom image instructions work without "connection" errors
2. Pre-written instructions continue to work
3. Content extraction works reliably for text-based instructions
4. Error messages are clear and actionable
5. No regression in existing functionality

### Failure Scenarios to Handle
1. Content script injection fails (permissions, CSP)
2. Message timeout due to slow page load
3. Race conditions in async operations
4. Service worker restart during operation
5. Invalid or inaccessible tab contexts

## Rollback Plan
If fixes cause issues:
1. Revert to original implementation
2. Disable custom image instructions temporarily
3. Add feature flag for gradual rollout
4. Monitor error rates and user reports