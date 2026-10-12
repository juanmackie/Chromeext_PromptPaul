/**
 * @fileoverview Bounded trace storage used only by the evaluation build.
 * @module evalTraceEvaluation
 */

import { serializePageActionResult } from './pageActionResult.js';
import { normalizeActOutcome } from '../orchestrator/ActOutcome.js';

export const EVAL_TRACE_STORAGE_KEY = 'promptPaulEvalTraceV1';

const MAX_TASK_CHARS = 4_000;
const MAX_PROMPT_CHARS = 12_000;
const MAX_RESPONSE_CHARS = 12_000;
const MAX_RESULT_CHARS = 12_000;
const MAX_PROVIDER_MESSAGE_CHARS = 40_000;
const MAX_OBSERVED_TEXT_CHARS = 24_000;
const MAX_STEPS = 256;
const MAX_TRACE_CHARS = 512 * 1024;
const SECRET_KEY_PATTERN =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|passcode|otp|credential|client[_-]?secret|secret|private[_-]?key|token)$/i;
const SECRET_VALUE_PATTERN =
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+|\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b|\bAIza[A-Za-z0-9_-]{20,}\b/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|passcode|otp|credential|client[_-]?secret|secret|private[_-]?key|token)(?:["']?\s*[:=]\s*["']?))[^"',}\s]+/gi;

const traces = new Map();

function redactString(value, maxChars) {
  return String(value ?? '')
    .replace(SECRET_VALUE_PATTERN, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[REDACTED]')
    .slice(0, maxChars);
}

function sanitize(value, key = '', depth = 0, maxStringChars = MAX_RESULT_CHARS) {
  if (SECRET_KEY_PATTERN.test(String(key))) return '[REDACTED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value, maxStringChars);
  if (depth >= 5) return '[depth limit]';
  if (Array.isArray(value)) {
    return value
      .slice(0, 64)
      .map((item) => sanitize(item, '', depth + 1, maxStringChars));
  }
  if (typeof value !== 'object') return redactString(value, maxStringChars);
  const result = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 64)) {
    result[childKey] = sanitize(childValue, childKey, depth + 1, maxStringChars);
  }
  return result;
}

function boundedTrace(trace) {
  let result = trace;
  while (JSON.stringify(result).length > MAX_TRACE_CHARS && result.steps.length > 1) {
    result = { ...result, steps: result.steps.slice(1) };
  }
  return result;
}

/**
 * Extract the page text an agent actually observed for one action step.
 *
 * The generic result envelope truncates every string to 12,000 characters, so a
 * long article's later captions can fall out of the recorded evidence before a
 * grader reads it. This keeps the observed page text separate and wider for the
 * two read-only observation actions that ground an answer.
 *
 * @param {object|undefined} action - tool call that produced the step.
 * @param {object|undefined} actionResult - {success, result} envelope.
 * @returns {string}
 */
function deriveObservedText(action, actionResult) {
  const name = String(action?.function?.name || actionResult?.result?.name || '');
  if (name !== 'page_get_state' && name !== 'page_find_text') return '';
  const inner = actionResult?.result || {};
  if (name === 'page_find_text') {
    const matches = Array.isArray(inner.matches) ? inner.matches.map(String) : [];
    const labels = Array.isArray(inner.indexedLabels) ? inner.indexedLabels.map(String) : [];
    const observed = [...matches, ...labels].join('\n');
    return observed ? redactString(observed, MAX_OBSERVED_TEXT_CHARS) : '';
  }
  const snapshot = inner.snapshot || {};
  const parts = [snapshot.header, snapshot.content, snapshot.readableContent, snapshot.footer];
  const text = parts.filter((part) => typeof part === 'string' && part).join('\n');
  return redactString(text, MAX_OBSERVED_TEXT_CHARS);
}

/**
 * Start a trace for one evaluation task.
 * @param {object} details
 * @returns {object}
 */
export function beginEvalTrace(details = {}) {
  const runId = String(details.runId || '').slice(0, 128);
  if (!runId) return null;
  const trace = {
    schemaVersion: 1,
    taskId: redactString(details.taskId, 128),
    runId,
    task: redactString(details.task, MAX_TASK_CHARS),
    dryRun: details.dryRun !== false,
    startedAt: Date.now(),
    steps: [],
    terminal: null,
  };
  traces.set(runId, trace);
  return trace;
}

/**
 * Record one bounded provider or action step.
 * @param {string} runId
 * @param {object} details
 * @returns {object|null}
 */
export function recordEvalTrace(runId, details = {}) {
  const trace = traces.get(String(runId));
  if (!trace || (trace.steps.length >= MAX_STEPS && details.kind !== 'terminal')) return null;
  const step = {
    stepIndex: trace.steps.length,
    timestamp: Date.now(),
    kind: String(details.kind || 'event').slice(0, 32),
  };
  if (details.prompt !== undefined) step.prompt = redactString(details.prompt, MAX_PROMPT_CHARS);
  if (Array.isArray(details.providerMessages)) {
    step.providerMessages = sanitize(
      details.providerMessages.slice(0, 8),
      '',
      0,
      MAX_PROVIDER_MESSAGE_CHARS
    );
  }
  if (details.llmResponse !== undefined) {
    step.llm_response = redactString(details.llmResponse, MAX_RESPONSE_CHARS);
  }
  if (details.action !== undefined) step.action_taken = sanitize(details.action);
  if (details.actionResult !== undefined) step.action_result = sanitize(details.actionResult);
  if (details.kind === 'action') {
    const observedText = deriveObservedText(details.action, details.actionResult);
    if (observedText) step.observedText = observedText;
  }
  if (details.messageCount !== undefined)
    step.messageCount = Math.max(0, Number(details.messageCount) || 0);
  if (details.payloadChars !== undefined)
    step.payloadChars = Math.max(0, Number(details.payloadChars) || 0);
  if (details.toolCount !== undefined) step.toolCount = Math.max(0, Number(details.toolCount) || 0);
  const snapshot = details.actionResult?.result?.snapshot || details.actionResult?.snapshot;
  if (snapshot) {
    step.snapshotBytes = {
      before: new TextEncoder().encode(JSON.stringify({ snapshot })).length,
      after: new TextEncoder().encode(serializePageActionResult({ snapshot })).length,
    };
  }
  if (details.eventType) step.eventType = String(details.eventType).slice(0, 64);
  if (details.providerCallIndex !== undefined) {
    step.providerCallIndex = Math.max(1, Number(details.providerCallIndex) || 1);
  }
  if (details.servedModelId !== undefined) {
    step.servedModelId = redactString(details.servedModelId, 120);
  }
  if (details.actionName !== undefined) {
    step.actionName = redactString(details.actionName, 80);
  }
  if (Array.isArray(details.toolNames)) {
    step.toolNames = details.toolNames.slice(0, 16).map((name) => redactString(name, 80));
  }
  if (details.error) step.error = redactString(details.error, 1_000);
  if (details.durationMs !== undefined)
    step.durationMs = Math.max(0, Number(details.durationMs) || 0);
  if (details.tokenUsage && typeof details.tokenUsage === 'object') {
    step.tokenUsage = sanitize(details.tokenUsage);
  }
  if (trace.steps.length < MAX_STEPS) trace.steps.push(step);
  if (details.kind === 'terminal') {
    trace.terminal = sanitize({
      type: String(details.terminalType || 'complete').slice(0, 32),
      content: details.llmResponse,
      error: details.error,
      actOutcome: normalizeActOutcome(details.actOutcome),
      actDiagnostics: details.actDiagnostics,
    });
  }
  const bounded = boundedTrace(trace);
  traces.set(String(runId), bounded);
  return step;
}

/**
 * Mark a trace terminal and return it for the test bridge.
 * @param {string} runId
 * @param {object} terminal
 * @returns {object|null}
 */
export function finishEvalTrace(runId, terminal = {}) {
  const trace = traces.get(String(runId));
  if (!trace) return null;
  if (!trace.terminal) {
    trace.terminal = sanitize({
      type: String(terminal.type || 'complete').slice(0, 32),
      content: terminal.content,
      error: terminal.error,
      actOutcome: normalizeActOutcome(terminal.actOutcome),
      actDiagnostics: terminal.actDiagnostics,
    });
  }
  trace.finishedAt = Date.now();
  const bounded = boundedTrace(trace);
  traces.set(String(runId), bounded);
  return bounded;
}

export function getEvalTrace(runId) {
  return traces.get(String(runId)) || null;
}

export function clearEvalTrace(runId) {
  traces.delete(String(runId));
}
