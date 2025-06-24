// content_script_explain.js
(function() {
    let content = "";
    let success = false;
    let errorMessage = "";

    try {
        // Primary method: Try to get main content if available, otherwise fall back.
        // This can be sophisticated (e.g., looking for <main>, <article>, specific IDs/classes)
        // For now, a robust fallback is document.body.innerText.
        if (document.body && typeof document.body.innerText === 'string') {
            content = document.body.innerText;
            success = true;
        } else {
            // Fallback if innerText is not available or body is not standard
            content = document.documentElement.innerText || document.body.textContent || "";
            if (content) {
                success = true;
            } else {
                errorMessage = "Could not extract text content from the page.";
                console.warn("PromptPaul Extension: content_script_explain.js - " + errorMessage);
            }
        }

        // Basic cleanup: trim whitespace
        content = content.trim();

        // Optional: Further cleanup (e.g., remove excessive newlines)
        if (success && content) {
            content = content.replace(/\n{3,}/g, '\n\n'); // Replace 3+ newlines with 2
        } else if (success && !content) {
            // If successful extraction resulted in empty content (e.g. an image page)
            errorMessage = "Page seems to have no textual content.";
            // success remains true, but content is empty. chat.js should handle this.
        }

    } catch (e) {
        console.error("PromptPaul Extension: content_script_explain.js - Error extracting content:", e);
        errorMessage = "Error during content extraction: " + e.message;
        success = false;
    }

    // Instead of sendMessage, return the object.
    return { success: success, content: content, error: errorMessage };
})();