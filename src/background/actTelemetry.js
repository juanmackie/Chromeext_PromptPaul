/**
 * @fileoverview Opt-in, anonymous ACT outcome telemetry. Event-only and
 * content-free: every field is a bounded enum, small integer, boolean, or
 * sanitized label. Instruction text, page content, URLs, prompts,
 * responses, or reasoning are never sent.
 * @module actTelemetry
 */
import { ACT_OUTCOME_REASONS } from '../act/ActOutcome.js';

export const ACT_TELEMETRY_EVENT_NAME = 'act_run_outcome';
const OUTCOMES = new Set(['done', 'failed', 'blocked']);
const REASONS = new Set(['none', ...ACT_OUTCOME_REASONS]);

const DURATION_BUCKETS = [
  [120_000, 'under_2m'],
  [300_000, '2_5m'],
  [900_000, '5_15m'],
  [Number.POSITIVE_INFINITY, '15m_plus'],
];
const STEP_BUCKETS = [
  [3, 'under_4'],
  [8, '4_8'],
  [16, '9_17'],
  [Number.POSITIVE_INFINITY, '18_plus'],
];

function bucket(value, brackets) {
  const v = Number.isFinite(value) && value >= 0 ? value : 0;
  for (const [cap, label] of brackets) if (v <= cap) return label;
  return brackets.at(-1)[1];
}

function int(value, cap = 10_000) {
  const v = Math.floor(Number(value ?? 0));
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(v, cap);
}

/**
 * Build the bounded act_run_outcome payload from already-sanitized pieces.
 * @param {object} input
 * @returns {Record<string, string|number>|null} Null when the outcome is not usable.
 */
export function buildActRunOutcomePayload(input = {}) {
  if (!OUTCOMES.has(input.outcome)) return null;
  const reason = REASONS.has(input.reason) ? input.reason : 'ambiguous';
  return {
    outcome: input.outcome,
    reason: input.reason === null ? 'none' : reason,
    steps: bucket(int(input.steps), STEP_BUCKETS),
    duration: bucket(int(input.durationMs, 86_400_000), DURATION_BUCKETS),
    observation: int(input.observation, 1_000),
    navigation: int(input.navigation, 1_000),
    mutation: int(input.mutation, 1_000),
    loop_warnings: int(input.loopWarnings, 1_000),
    replans: int(input.replanCount, 100),
    model: String(input.model || 'unknown').slice(0, 64),
  };
}
