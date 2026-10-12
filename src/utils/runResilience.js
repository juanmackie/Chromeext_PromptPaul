/**
 * @fileoverview Bounded long-run budgets, provider recovery, and output safety.
 * @module runResilience
 */

import { estimateTextTokens, fitTextToTokenBudget } from './contextBudget.js';

export const RUN_RESILIENCE_DEFAULTS = Object.freeze({
  maxIterations: 500,
  runBudgetMs: 30 * 60 * 1000,
  maxProviderRetries: 2,
  requestTimeoutMs: 120 * 1000,
  maxHistoryTokens: 49_000,
});

const REASONING_TIMEOUT_FLOORS = Object.freeze([
  [
    /\b(?:o1(?:-pro|-preview)?(?!-)|o3(?:-pro)?(?!-)|deepseek[- ]?(?:r1|v4)(?!-?flash)|nemotron[^\s]*ultra)\b/i,
    600_000,
  ],
  [/\b(?:o3-mini|o4-mini|grok[- ]?4)\b/i, 300_000],
  [/\bclaude[- ]?opus[- ]?[45](?:\.[\w-]+)?\b/i, 240_000],
  [/\bclaude[- ]?sonnet[- ]?4(?:\.[\w-]+)?\b/i, 180_000],
]);

const CONTEXT_PATTERNS = [
  /context(?:[_ -]?(?:length|window|limit|overflow))/i,
  /maximum context/i,
  /prompt is too long/i,
  /payload is too large/i,
  /input.{0,12}too large/i,
];
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /temporar(?:y|ily)/i,
  /overloaded/i,
  /capacity/i,
  /network/i,
  /fetch failed/i,
  /connection/i,
];
const BILLING_PATTERNS = [/billing/i, /quota/i, /insufficient[_ -]?credit/i, /payment required/i];
const AUTH_PATTERNS = [/unauthori[sz]ed/i, /invalid api key/i, /authentication/i, /forbidden/i];
const OVERLOADED_PATTERNS = [/overloaded/i, /capacity/i, /server is busy/i];
const MODEL_PATTERNS = [/model.{0,20}(?:not found|does not exist|unavailable)/i];
const CONTENT_POLICY_PATTERNS = [/content policy/i, /safety system/i, /moderation/i];
const SSL_PATTERNS = [/certificate/i, /self-signed/i, /ssl/i, /tls/i];
const RETRYABLE_PROVIDER_KINDS = new Set([
  'rate_limit',
  'upstream_rate_limit',
  'overloaded',
  'server_error',
  'timeout',
  'unknown',
]);

/**
 * Return the provider timeout floor used for a model.
 * @param {string} modelName
 * @param {number} [defaultMs]
 * @returns {number}
 */
export function getProviderTimeoutMs(
  modelName,
  defaultMs = RUN_RESILIENCE_DEFAULTS.requestTimeoutMs
) {
  const base = Math.max(1_000, Number(defaultMs) || RUN_RESILIENCE_DEFAULTS.requestTimeoutMs);
  const floor = REASONING_TIMEOUT_FLOORS.find(([pattern]) => pattern.test(String(modelName || '')));
  return Math.max(base, floor?.[1] || 0);
}

/**
 * Create a child abort signal for one provider request. Caller cancellation is
 * preserved; a timeout is distinguishable through the returned state.
 * @param {AbortSignal|null} parentSignal
 * @param {number} timeoutMs
 * @returns {{signal: AbortSignal, cleanup: Function, timedOut: boolean}}
 */
export function createTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', onAbort, { once: true });

  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1_000, Number(timeoutMs) || RUN_RESILIENCE_DEFAULTS.requestTimeoutMs)
  );

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    },
    get timedOut() {
      return timedOut;
    },
  };
}

/**
 * Classify a provider error before selecting recovery.
 * @param {unknown} error
 * @returns {string}
 */
export function classifyProviderError(error) {
  const status = Number(error?.status);
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || error || '');

  if (code === 'provider_timeout' || code === 'timeout' || /aborterror/i.test(code))
    return 'timeout';
  if (CONTEXT_PATTERNS.some((pattern) => pattern.test(message)) || status === 413) {
    return 'context_overflow';
  }
  if (SSL_PATTERNS.some((pattern) => pattern.test(message))) return 'ssl_cert_verification';
  if (MODEL_PATTERNS.some((pattern) => pattern.test(message)) || status === 404)
    return 'model_not_found';
  if (CONTENT_POLICY_PATTERNS.some((pattern) => pattern.test(message)))
    return 'content_policy_blocked';
  if (status === 401 || status === 403 || AUTH_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'auth';
  }
  if (status === 402 || BILLING_PATTERNS.some((pattern) => pattern.test(message))) return 'billing';
  if (status === 429)
    return /upstream|model provider/i.test(message) ? 'upstream_rate_limit' : 'rate_limit';
  if (OVERLOADED_PATTERNS.some((pattern) => pattern.test(message)) || status === 503)
    return 'overloaded';
  if (
    status === 408 ||
    status === 504 ||
    TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return 'timeout';
  }
  if (status >= 500 && status <= 599) return 'server_error';
  return 'unknown';
}

/**
 * True when retrying the provider request is safer than failing immediately.
 * @param {string} kind
 * @returns {boolean}
 */
export function isRetryableProviderError(kind) {
  return RETRYABLE_PROVIDER_KINDS.has(kind);
}

/**
 * Bound and redact provider error text before it reaches the chat surface.
 * @param {unknown} value
 * @param {number} [maxChars]
 * @returns {string}
 */
export function redactProviderErrorMessage(value, maxChars = 400) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(
      /((?:["']?(?:api[_ -]?key|authorization|bearer|token|secret|password)["']?\s*[:=]\s*["']?))[^,;\s}"']+/gi,
      '$1[redacted]'
    )
    .trim()
    .slice(0, Math.max(80, maxChars));
}

/**
 * Compact old conversation turns without calling another model. The first
 * user turn and recent turns remain, while the middle becomes bounded,
 * explicitly untrusted reference text.
 * @param {Array} messages
 * @param {number} maxTokens
 * @param {{tailMessages?: number}} [options]
 * @returns {{messages: Array, compacted: boolean, droppedMessages: number}}
 */
export function compactConversationHistory(messages, maxTokens, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const budget = Math.max(1, Math.floor(Number(maxTokens) || 0));
  const total = source.reduce((sum, message) => sum + messageTokens(message), 0);
  if (total <= budget) return { messages: source, compacted: false, droppedMessages: 0 };
  if (source.length <= 2)
    return { messages: boundMessages(source, budget), compacted: true, droppedMessages: 0 };

  const tailCount = Math.max(4, Math.floor(Number(options.tailMessages) || 12));
  let tailStart = Math.max(1, source.length - tailCount);
  while (tailStart > 1 && source[tailStart]?.role === 'tool') tailStart -= 1;

  const head = { ...source[0] };
  const middle = source.slice(1, tailStart);
  const tail = source.slice(tailStart);
  const summary = fitTextToTokenBudget(
    buildConversationSummary(middle),
    Math.max(32, Math.floor(budget * 0.2))
  ).text;
  if (summary) head.content = appendSummary(head.content, summary);

  const kept = [head, ...tail];
  const bounded = boundMessages(kept, budget);
  return {
    messages: bounded,
    compacted: true,
    droppedMessages: Math.max(0, source.length - bounded.length),
  };
}

function buildConversationSummary(messages) {
  const lines = messages
    .map((message) => {
      const role = String(message?.role || 'message');
      const content = contentText(message?.content) || toolNames(message);
      if (!content) return '';
      const excerpt = fitTextToTokenBudget(content, 120).text;
      return `${role}: ${excerpt}`;
    })
    .filter(Boolean)
    .slice(-80);
  if (lines.length === 0) return '';
  return (
    '\n\n--- Earlier conversation context (untrusted reference; details may be omitted) ---\n' +
    lines.join('\n') +
    '\n--- End earlier conversation context ---'
  );
}

function appendSummary(content, summary) {
  if (typeof content === 'string') return `${content}${summary}`;
  if (Array.isArray(content)) return [...content, { type: 'text', text: summary }];
  return summary.trim();
}

function boundMessages(messages, budget) {
  const result = messages.map((message) => ({ ...message }));
  let used = result.reduce((sum, message) => sum + messageTokens(message), 0);
  while (result.length > 2 && used > budget) {
    for (const removed of removeOldestTailTurn(result)) used -= messageTokens(removed);
  }
  for (let index = 0; index < result.length && used > budget; index += 1) {
    const message = result[index];
    const current = messageTokens(message);
    const allowance = Math.max(1, Math.floor((budget - (used - current)) * 0.9));
    const text = contentText(message.content);
    let bounded = message;
    if (text) {
      const fitted = fitTextToTokenBudget(text, allowance);
      bounded = { ...message, content: fitted.text || '[Message content omitted.]' };
    }
    if (Array.isArray(message.tool_calls)) {
      bounded = {
        ...bounded,
        tool_calls: message.tool_calls.map((toolCall) => ({
          ...toolCall,
          function: toolCall.function
            ? { ...toolCall.function, arguments: '{}' }
            : toolCall.function,
        })),
      };
    }
    if (bounded !== message) {
      result[index] = bounded;
      used += messageTokens(bounded) - current;
    }
  }
  while (result.length > 1 && used > budget) {
    for (const removed of removeOldestTailTurn(result)) used -= messageTokens(removed);
  }
  return result;
}

function removeOldestTailTurn(messages) {
  const removed = [messages.splice(1, 1)[0]];
  const toolIds = new Set(
    removed[0]?.role === 'assistant'
      ? (removed[0].tool_calls || []).map((toolCall) => toolCall?.id).filter(Boolean)
      : []
  );
  for (let index = messages.length - 1; index >= 1; index -= 1) {
    if (messages[index]?.role === 'tool' && toolIds.has(messages[index].tool_call_id)) {
      removed.push(messages.splice(index, 1)[0]);
    }
  }
  return removed;
}

function messageTokens(message) {
  return estimateTextTokens(
    `${message?.role || ''}: ${contentText(message?.content)} ${toolNames(message)} ${toolArguments(message)}`
  );
}

function toolNames(message) {
  if (!Array.isArray(message?.tool_calls)) return '';
  return message.tool_calls.map((toolCall) => toolCall?.function?.name || '').join(' ');
}

function toolArguments(message) {
  if (!Array.isArray(message?.tool_calls)) return '';
  return message.tool_calls.map((toolCall) => toolCall?.function?.arguments || '').join(' ');
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part === 'string' ? part : String(part?.text || part?.content || '')))
    .filter(Boolean)
    .join('\n');
}

/**
 * Detect a conservative exact-fragment repetition loop.
 * @param {string} value
 * @param {{minFragmentChars?: number, coverageRatio?: number}} [options]
 * @returns {{fragmentChars: number, repetitions: number, coverage: number}|null}
 */
export function detectRepeatedOutput(value, options = {}) {
  const text = String(value || '');
  const minChars = Math.max(60, Math.floor(Number(options.minFragmentChars) || 60));
  const coverageRatio = Math.min(0.95, Math.max(0.5, Number(options.coverageRatio) || 0.5));
  if (text.length < minChars * 2) return null;

  const maxFragmentChars = Math.min(2_048, Math.floor(text.length / 2));
  const scanLimit = Math.min(128, text.length - minChars * 2);
  for (let start = 0; start <= scanLimit; start += 1) {
    for (let size = minChars; size <= maxFragmentChars; size += 1) {
      const fragment = text.slice(start, start + size);
      if (new Set(fragment).size < 12) continue;
      let cursor = start;
      let repetitions = 0;
      while (text.startsWith(fragment, cursor)) {
        repetitions += 1;
        cursor += size;
      }
      const coverage = (repetitions * size) / text.length;
      if (repetitions >= 2 && coverage >= coverageRatio) {
        return { fragmentChars: size, repetitions, coverage };
      }
    }
  }
  return null;
}
