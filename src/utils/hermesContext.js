/**
 * @fileoverview Builds bounded Hermes turn payloads from local chat history.
 * @module hermesContext
 */

import { estimateTextTokens, fitTextToTokenBudget } from './contextBudget.js';

const DEFAULT_MODEL_CONTEXT_TOKENS = 64000;
const DEFAULT_OUTPUT_RESERVE_TOKENS = 8000;
const DEFAULT_PROMPT_RESERVE_TOKENS = 7000;
const MAX_UNKNOWN_MODEL_INPUT_TOKENS = 49000;

/**
 * Build the current Hermes input and a bounded explicit transcript.
 * Hermes /v1/runs uses session_id for correlation; the transcript is supplied
 * explicitly so follow-up turns retain page context on gateways that do not
 * restore persisted history for that endpoint.
 *
 * @param {Array} messages - Local Prompt Paul conversation messages.
 * @param {Object} [options] - Budget and context options.
 * @param {string} [options.modelId] - Selected Hermes model identifier.
 * @param {string} [options.instructions] - Instructions sent to Hermes.
 * @returns {{input: string|Array, conversationHistory: Array}}
 */
export function buildHermesTurn(messages, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const currentStart = findCurrentTurnStart(source);
  const currentMessages = source.slice(currentStart).map(normalizeCurrentMessage).filter(Boolean);
  if (currentMessages.length === 0) throw new Error('Hermes requires a user message.');

  const input =
    currentMessages.length === 1 && typeof currentMessages[0].content === 'string'
      ? currentMessages[0].content
      : currentMessages;
  const priorMessages = source.slice(0, currentStart).map(normalizeHistoryMessage).filter(Boolean);
  const pinned = priorMessages.filter(
    (message) => message._promptPaulContext?.type === 'page_content'
  );
  const historyBudget = resolveHistoryBudget(options);

  const bounded = boundHistory(priorMessages, pinned, historyBudget);
  return {
    input,
    conversationHistory: bounded.map((message) => {
      const clean = { ...message };
      delete clean._promptPaulContext;
      return clean;
    }),
  };
}

/**
 * Estimate the maximum input budget available to Hermes after output and
 * instruction reserves. The default keeps the request below the known 64k
 * Hermes-compatible window when no model metadata is available.
 *
 * @param {Object} options
 * @returns {number}
 */
export function resolveHistoryBudget(options = {}) {
  const modelId = String(options.modelId || '')
    .trim()
    .toLowerCase();
  const modelContextTokens =
    modelId && /(?:5\.5|5\.4|5\.2|gpt-5|gpt-4|claude-3|claude-4|pro)/u.test(modelId)
      ? 128000
      : DEFAULT_MODEL_CONTEXT_TOKENS;
  const instructionTokens = estimateTextTokens(options.instructions || '');
  const available =
    modelContextTokens -
    DEFAULT_OUTPUT_RESERVE_TOKENS -
    DEFAULT_PROMPT_RESERVE_TOKENS -
    instructionTokens;
  const inputCeiling =
    modelContextTokens > DEFAULT_MODEL_CONTEXT_TOKENS ? available : MAX_UNKNOWN_MODEL_INPUT_TOKENS;
  return Math.max(2000, Math.min(inputCeiling, available));
}

function findCurrentTurnStart(messages) {
  let index = messages.length;
  while (index > 0) {
    const message = messages[index - 1];
    if (message?.role !== 'user' || !message.content) break;
    index -= 1;
  }
  return index;
}

function normalizeCurrentMessage(message) {
  if (message?.role !== 'user' || !message.content) return null;
  return { role: 'user', content: message.content };
}

function normalizeHistoryMessage(message) {
  if (!['user', 'assistant'].includes(message?.role)) return null;
  const content = textOnlyContent(message.content);
  if (!content) return null;
  return {
    role: message.role,
    content,
    ...(message._promptPaulContext ? { _promptPaulContext: message._promptPaulContext } : {}),
  };
}

function textOnlyContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      return part && typeof part.text === 'string' ? part.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function messageTokens(message) {
  return estimateTextTokens(`${message.role}: ${message.content}`);
}

function boundHistory(messages, pinned, budget) {
  if (messages.length === 0) return [];
  const selected = new Map();
  let used = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!pinned.includes(message)) continue;
    let candidate = message;
    let tokens = messageTokens(candidate);
    if (tokens > budget - used) {
      const fitted = fitTextToTokenBudget(candidate.content, Math.max(0, budget - used - 8));
      candidate = { ...candidate, content: fitted.text };
      tokens = messageTokens(candidate);
    }
    if (candidate.content && tokens <= budget - used) {
      selected.set(index, candidate);
      used += tokens;
    }
  }

  for (let index = messages.length - 1; index >= 0 && used < budget; index -= 1) {
    if (selected.has(index)) continue;
    const message = messages[index];
    const tokens = messageTokens(message);
    if (used + tokens > budget) continue;
    selected.set(index, message);
    used += tokens;
  }

  return [...selected.keys()]
    .sort((left, right) => left - right)
    .map((index) => selected.get(index))
    .filter(
      (message, index, list) =>
        message.role === 'user' || (index > 0 && list[index - 1].role === 'user')
    );
}
