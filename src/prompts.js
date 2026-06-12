/**
 * @fileoverview Shared prompt builders — single source of truth for all prompt strings.
 *
 * Every prompt entry point (sidebar, context menu, media analysis) imports from here.
 * When a prompt needs updating, change it in one place.
 *
 * @module prompts
 */

/**
 * Build an explain prompt for the given context.
 * @param {string} contextLabel - What is being explained (e.g. 'selected text', 'content', 'image')
 * @returns {string}
 */
export function buildExplainPrompt(contextLabel) {
  return `Explain the following ${contextLabel} to me in a short concise MECE approach. Break down the content into clear, structured categories.`;
}

/**
 * Build a summarize prompt for the given context.
 * @param {string} contextLabel - What is being summarized (e.g. 'content', 'image')
 * @param {boolean} [includeMediaGuidance=false] - Whether to append media-specific guidance
 * @returns {string}
 */
export function buildSummarizePrompt(contextLabel, includeMediaGuidance = false) {
  let prompt = `Please summarize the following ${contextLabel} into a bullet list of key points.`;
  if (includeMediaGuidance) {
    prompt += ' Focus on the main elements, text, objects, and overall message or purpose.';
  }
  return prompt;
}

/**
 * Proofread prompt — fixed, no parameters.
 */
export const PROOFREAD_PROMPT =
  'Proofread the following content for spelling, grammar, punctuation, and clarity issues. Fix all errors and return the corrected text followed by a brief bullet list of changes made.';

/**
 * Analyze prompt for the given context.
 * @param {string} contextLabel - What is being analyzed
 * @returns {string}
 */
export function buildAnalyzePrompt(contextLabel) {
  return `Please analyze the following ${contextLabel}. Describe what you see and provide any relevant insights.`;
}

/**
 * Context menu command prompts — maps command IDs to prompt strings.
 * Used by background.js for right-click context menu dispatch.
 */
export const CONTEXT_MENU_PROMPTS = {
  summarize: buildSummarizePrompt('content'),
  explain: buildExplainPrompt('content'),
  proofread: PROOFREAD_PROMPT,
  polish: 'Polish the following content with clarity and purpose',
  shorten: 'Shorten the following content without losing its meaning and context',
  formal: 'Make the following content more formal and eloquent',
  casual: 'Make the following content more casual and fun',
  analyze: buildAnalyzePrompt('content'),
};
