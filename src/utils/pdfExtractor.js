/**
 * @fileoverview Extracts text from PDF documents by parsing their bytes with
 *   pdf.js. Runs in the chat extension page (not the service worker) so a real
 *   module worker is available. Used by the "Add page" flow for both remote
 *   (http/https) and local (file://) PDFs.
 * @module pdfExtractor
 */

// Hard cap so a very large PDF can't hang the UI. Anything beyond this is
// dropped (the caller's context-budget trimming would discard it anyway).
const MAX_PAGES = 300;

let pdfjsLibPromise = null;

/**
 * Lazily load the bundled pdf.js ESM build and point it at the bundled worker.
 * Kept out of the chat startup path — only loaded the first time a PDF is read.
 * @returns {Promise<object>} the pdfjs library namespace.
 */
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('../../libs/pdf.min.mjs').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.mjs');
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

/**
 * Fetch a PDF and extract its text content.
 * @param {string} url - The PDF URL (http/https or file://).
 * @returns {Promise<{text: string, title: string, numPages: number, truncated: boolean}>}
 * @throws {Error} with a user-facing message when the PDF cannot be read.
 */
export async function extractPdfText(url) {
  const isLocal = typeof url === 'string' && url.startsWith('file:');

  let buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    buffer = await response.arrayBuffer();
  } catch (error) {
    if (isLocal) {
      throw new Error(
        'Cannot read this local PDF. Enable "Allow access to file URLs" for Prompt Paul ' +
          'in chrome://extensions, then reload the PDF and try again.'
      );
    }
    throw new Error(`Could not download the PDF (${error.message}).`);
  }

  let pdf;
  try {
    const pdfjsLib = await loadPdfJs();
    pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch (error) {
    throw new Error(`Could not parse the PDF (${error.message}).`);
  }

  const numPages = pdf.numPages;
  const pageLimit = Math.min(numPages, MAX_PAGES);
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= pageLimit; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (text) {
      pageTexts.push(text);
    }
  }

  const metadata = await pdf.getMetadata().catch(() => null);
  const title = metadata?.info?.Title || '';

  const fullText = pageTexts.join('\n\n');
  if (!fullText) {
    throw new Error(
      'No selectable text found in this PDF (it may be a scanned/image-only document).'
    );
  }

  return {
    text: fullText,
    title,
    numPages,
    truncated: numPages > pageLimit,
  };
}
