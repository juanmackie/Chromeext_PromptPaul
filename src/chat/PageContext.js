/**
 * @fileoverview Page-context preparation for loaded page and PDF content.
 * @module PageContext
 */

import { composeUserPrompt } from '../prompts.js';
import { resolveDomContextBudget, fitTextToTokenBudget } from '../utils/contextBudget.js';

/**
 * Prepare all derived page-context data before the chat UI or history changes.
 * @param {Object} response - Extracted page or PDF response.
 * @param {Object} [options] - Context preparation options.
 * @param {boolean} [options.hasMediaContext=false] - Whether media is attached.
 * @returns {Object} Prepared display metadata, fitted text, and history message.
 */
export function prepareLoadedPageContext(response = {}, options = {}) {
  let sourceInfo = response.title;
  if (response.siteName) sourceInfo = `${response.title} (${response.siteName})`;
  if (response.byline) sourceInfo += ` by ${response.byline}`;
  const pageContext = {
    url: response.url,
    platform: response.platform || null,
    readStrategy: response.readStrategy || 'auto',
    extractionSource: response.extractionSource || 'auto',
    extractionReason: response.extractionReason || '',
    hasScreenshot: Boolean(response.screenshot),
    hasMediaContext: Boolean(options.hasMediaContext),
  };
  const budget = resolveDomContextBudget({
    modelId: null,
    userMessage: '',
    contextCount: 1,
    fileAttachmentCount: options.hasMediaContext ? 1 : 0,
  });
  const fitted = fitTextToTokenBudget(response.content, budget.perContextDomTokens);
  const contextNotes = [];

  if (pageContext.readStrategy !== 'auto') {
    contextNotes.push(`Read strategy: ${pageContext.readStrategy}.`);
  }
  if (pageContext.extractionSource !== 'auto') {
    const extractionNote = `Extraction source: ${pageContext.extractionSource}.`;
    contextNotes.push(
      pageContext.extractionReason
        ? `${extractionNote} ${pageContext.extractionReason}`
        : extractionNote
    );
  }
  if (pageContext.hasScreenshot) {
    contextNotes.push('Visual screenshot context is available.');
  }
  if (pageContext.hasMediaContext) {
    contextNotes.push('Additional media attachment context is active.');
  }

  const loadedContextInstruction = [
    `I have loaded the content from the page "${response.title}" (${response.url}).`,
    `Source: ${response.siteName || 'Unknown'}`,
    `Author: ${response.byline || 'Unknown'}`,
    `Platform: ${response.platform || 'unknown'}`,
    contextNotes.length ? `Context notes: ${contextNotes.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    sourceInfo,
    pageContext,
    details: `${response.url}${fitted.truncated ? ' (trimmed)' : ''}`,
    fitted,
    historyMessage: {
      role: 'user',
      content: composeUserPrompt({
        instruction: loadedContextInstruction,
        context: {
          type: 'page_content',
          text: fitted.text,
        },
      }),
      _promptPaulContext: { type: 'page_content' },
    },
  };
}
