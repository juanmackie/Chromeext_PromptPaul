/**
 * @fileoverview Production-safe no-op interface for evaluation tracing.
 * @module evalTrace
 */

export const EVAL_TRACE_STORAGE_KEY = 'promptPaulEvalTraceV1';

export function beginEvalTrace() {}

export function recordEvalTrace() {}

export function finishEvalTrace() {}

export function getEvalTrace() {
  return null;
}

export function clearEvalTrace() {}
