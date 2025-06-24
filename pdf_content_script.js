// Check if pdf.js is already loaded (e.g., by another extension or the page itself)
// This is a simple check; more robust checks might be needed in complex scenarios.
if (typeof pdfjsLib === 'undefined') {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('vendor/pdfjs/pdf.min.js');
    script.onload = initializePdfJs;
    (document.head || document.documentElement).appendChild(script);
} else {
    initializePdfJs();
}

function initializePdfJs() {
    // Set the workerSrc for pdf.js
    // The worker path must be an absolute URL to the script in the extension.
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js');
    console.log("pdf_content_script.js: pdf.js initialized with worker:", pdfjsLib.GlobalWorkerOptions.workerSrc);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractPdfText') {
        console.log("pdf_content_script.js: Received extractPdfText request for URL:", document.location.href);
        if (typeof pdfjsLib === 'undefined' || !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            console.error("pdf_content_script.js: pdf.js library not ready.");
            sendResponse({ success: false, error: 'PDF library not ready. Try again in a moment.' });
            // Attempt to re-initialize if it failed earlier, though this might be too late for the current request.
            if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                 pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js');
            }
            return true; // Keep message channel open for async response (though likely to fail here)
        }

        const pdfUrl = document.location.href;

        pdfjsLib.getDocument(pdfUrl).promise.then(async (pdfDoc) => {
            const numPages = pdfDoc.numPages;
            let fullText = '';
            console.log(`pdf_content_script.js: PDF loaded. Number of pages: ${numPages}`);

            for (let i = 1; i <= numPages; i++) {
                try {
                    const page = await pdfDoc.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n\n'; // Add double newline between pages
                } catch (pageError) {
                    console.error(`pdf_content_script.js: Error processing page ${i}:`, pageError);
                    fullText += `[Error processing page ${i}]\n\n`;
                }
            }
            console.log("pdf_content_script.js: Text extraction complete. Total length:", fullText.length);
            sendResponse({ success: true, content: fullText });
        }).catch(error => {
            console.error('pdf_content_script.js: Error loading or parsing PDF:', error);
            sendResponse({ success: false, error: `Failed to load/parse PDF: ${error.message}` });
        });
        return true; // Keep message channel open for async response
    }
});

// Inform background script that content script is loaded and ready (optional)
// chrome.runtime.sendMessage({ action: "pdfContentLoaded", url: document.location.href });
console.log("pdf_content_script.js loaded and listener active for URL:", document.location.href);
