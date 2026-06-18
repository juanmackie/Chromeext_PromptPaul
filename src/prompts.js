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
 * Context types that can be composed into a final user prompt.
 * @typedef {'none'|'selected_text'|'page_content'|'media'|'previous_response'} ContextType
 */

/**
 * Build a context label for prompt composition.
 * @param {ContextType} type - Context type.
 * @returns {string}
 */
function getContextLabel(type) {
  const labels = {
    none: 'Context',
    selected_text: 'Selected text',
    page_content: 'Page content',
    media: 'Attached media',
    previous_response: 'Previous response',
  };
  return labels[type] || 'Context';
}

/**
 * Compose a structured prompt request into the final user message sent to the LLM.
 * Context-bearing requests are wrapped with explicit boundaries so models can distinguish
 * user intent from source material.
 * @param {string|{instruction:string, context?:{type?:ContextType, text?:string, metadata?:Object}}} promptRequest - Prompt request or raw instruction.
 * @returns {string}
 */
export function composeUserPrompt(promptRequest) {
  const request =
    typeof promptRequest === 'string' ? { instruction: promptRequest } : promptRequest;
  const instruction = String(request?.instruction || '').trim();
  const context = request?.context;
  const contextType = context?.type || 'none';

  if (contextType === 'none' || !context) {
    return instruction;
  }

  if (contextType === 'previous_response') {
    return [
      instruction,
      '',
      'Context: Apply this task to the previous assistant response in this conversation.',
    ].join('\n');
  }

  const text = String(context.text || '').trim();
  if (!text) {
    return instruction;
  }

  const label = getContextLabel(contextType);
  const parts = [instruction, '', `--- ${label} ---`, text, `--- End ${label} ---`];

  if (contextType === 'selected_text' || contextType === 'page_content') {
    parts.push(
      '',
      'Use the context as source material for the task. Do not continue or imitate the context author or sender. If asked for a reply or response, write from the user perspective.'
    );
  }

  return parts.join('\n');
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
