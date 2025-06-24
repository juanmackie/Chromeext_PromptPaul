console.log("Prompt Paul: Clipboard listener content script loaded.");

document.addEventListener('copy', () => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
        console.log("Prompt Paul: Text copied:", selectedText.substring(0, 100) + "...");
        // Check the setting before sending the message
        chrome.storage.sync.get(['enableSmartClipboard'], (result) => {
            if (result.enableSmartClipboard) {
                chrome.runtime.sendMessage({
                    action: 'textCopied',
                    copiedText: selectedText
                }).catch(err => {
                    // This catch is important because the background script might not be listening
                    // if the extension was just installed and the content script injected before
                    // the background script is fully ready, or if the side panel is closed
                    // and the background script isn't actively listening for this specific message yet.
                    console.warn("Prompt Paul: Could not send 'textCopied' message. Background script might not be ready or listening.", err.message);
                });
            } else {
                console.log("Prompt Paul: Smart Clipboard is disabled, not sending copied text.");
            }
        });
    }
});
