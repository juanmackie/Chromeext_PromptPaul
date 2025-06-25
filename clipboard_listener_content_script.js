console.log("Prompt Paul: Clipboard listener content script loaded.");

document.addEventListener('copy', () => {
    // A robust check to see if the script is running in a context with extension APIs.
    // In some sandboxed iframes, `chrome` might exist but `chrome.runtime` or other APIs will be undefined.
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        // Silently exit if not in a proper extension context.
        return;
    }

    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
        // We've established that APIs should be available, so we can proceed.
        // A try/catch is still good practice for robustness.
        try {
            chrome.storage.sync.get(['enableSmartClipboard'], (result) => {
                // It's also good practice to check for chrome.runtime.lastError in callbacks.
                if (chrome.runtime.lastError) {
                    console.warn("Prompt Paul: Error getting smart clipboard setting:", chrome.runtime.lastError.message);
                    return;
                }

                if (result.enableSmartClipboard) {
                    console.log("Prompt Paul: Smart Clipboard is enabled, sending copied text message.");
                    chrome.runtime.sendMessage({
                        action: 'textCopied',
                        copiedText: selectedText
                    }).catch(err => {
                        // This catch is for cases where the background script isn't listening.
                        console.warn("Prompt Paul: Could not send 'textCopied' message. Background script might not be ready or listening.", err.message);
                    });
                } else {
                    console.log("Prompt Paul: Smart Clipboard is disabled, not sending copied text.");
                }
            });
        } catch (error) {
            // This catch is a fallback, the initial guard should prevent this.
            console.error("Prompt Paul: Unexpected error accessing chrome.storage.sync:", error);
        }
    }
});
