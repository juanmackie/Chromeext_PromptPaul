// pdf_content_script.js - PDF content extraction
// NOTE: Superseded by src/utils/pdfExtractor.js, which parses PDF bytes with
// pdf.js in the chat page. This DOM-scraping script cannot read Chrome's native
// PDF viewer and has no message listener; kept only for the manifest match.
(function () {
  let content = '';
  let success = false;
  let errorMessage = '';

  try {
    // Check if this is actually a PDF
    const isPDF = () => {
      return (
        window.location.pathname.toLowerCase().endsWith('.pdf') ||
        document.contentType === 'application/pdf' ||
        document.querySelector('embed[type="application/pdf"]') ||
        document.querySelector('object[type="application/pdf"]') ||
        window.location.href.includes('.pdf')
      );
    };

    if (!isPDF()) {
      errorMessage = "This doesn't appear to be a PDF document.";
      success = false;
      return { success, data: content, error: errorMessage };
    }

    // Method 1: Try to extract from PDF.js viewer
    const extractFromPDFJS = () => {
      // PDF.js creates text layers
      const textLayers = document.querySelectorAll('.textLayer');
      if (textLayers.length > 0) {
        let text = '';
        textLayers.forEach((layer) => {
          const spans = layer.querySelectorAll('span');
          spans.forEach((span) => {
            text += span.textContent + ' ';
          });
          text += '\n';
        });
        return text.trim();
      }
      return '';
    };

    // Method 2: Try to extract from embedded PDF viewer
    const extractFromEmbedded = () => {
      const embeds = document.querySelectorAll(
        'embed[type="application/pdf"], object[type="application/pdf"]'
      );
      if (embeds.length > 0) {
        // For embedded PDFs, we can't directly extract text
        // Return metadata instead
        return `PDF Document: ${document.title || 'Untitled PDF'}\nURL: ${window.location.href}`;
      }
      return '';
    };

    // Method 3: Check for Chrome's built-in PDF viewer
    const extractFromChromeViewer = () => {
      // Chrome's PDF viewer uses a plugin
      if (document.querySelector('embed[type="application/pdf"]')) {
        return `PDF Document loaded in Chrome viewer: ${document.title || 'Untitled PDF'}\nURL: ${window.location.href}`;
      }
      return '';
    };

    // Try extraction methods in order
    content = extractFromPDFJS() || extractFromEmbedded() || extractFromChromeViewer();

    if (content) {
      success = true;
      // Clean up the extracted content
      content = content
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s{2,}/g, ' ')
        .trim();
    } else {
      // Fallback: provide PDF metadata
      content = `PDF Document: ${document.title || 'Untitled PDF'}\nURL: ${window.location.href}\nNote: Text extraction from this PDF format is not supported. Please copy and paste the text manually if needed.`;
      success = true;
      errorMessage = 'PDF text extraction not available for this format.';
    }
  } catch (e) {
    console.error('PromptPaul Extension: pdf_content_script.js - Error extracting PDF content:', e);
    errorMessage = 'Error during PDF content extraction: ' + e.message;
    success = false;
  }

  return {
    success: success,
    data: content,
    error: errorMessage,
    url: window.location.href,
    title: document.title || '',
    timestamp: Date.now(),
    contentType: 'pdf',
  };
})();
