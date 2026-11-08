/**
 * @fileoverview Canonical runtime limits for Act orchestration.
 * @module ActLimits
 */

export const ACT_ACTION_BUDGETS = Object.freeze({
  observation: 256,
  navigation: 96,
  mutation: 64,
});

export const ACT_FRAME_CAPS = Object.freeze({
  maxFrames: 16,
});

export const ACT_TAB_CAPS = Object.freeze({
  maxOwnedTabs: 12,
});

export const ACT_PAGE_DOM_CAPS = Object.freeze({
  maxElements: 200,
  maxSnapshotChars: 32_000,
  maxOutlineChars: 24_000,
  maxValueChars: 160,
  maxTotalValueChars: 8_000,
  maxErrorChars: 160,
  maxFormNotices: 8,
  maxFormNoticeChars: 200,
  maxReadableContentChars: 16_000,
  maxElementTextChars: 320,
  maxAttributeChars: 120,
  maxInputChars: 2_000,
  maxFindQueryChars: 160,
  maxWaitMs: 10_000,
  maxBatchActions: 6,
  maxScrollPages: 5,
  maxScrollContainers: 16,
  maxUrlChars: 2_048,
  maxPayloadBytes: 128 * 1024,
});

export const PAGE_ACTION_TURN_MUTATIONS = new Set([
  'page_open_tab',
  'page_open_link',
  'page_switch_tab',
  'page_go_back',
  'page_close_tab',
]);

export const PAGE_ACTION_RECEIPT_DISPOSITIONS = new Set([
  'not_delivered',
  'delivered_unverified',
  'delivered_verified',
]);

export const ACT_PLANNER_LIMITS = Object.freeze({
  maxSubGoals: 12,
  maxSubGoalChars: 200,
  maxReplans: 5,
  maxPromptChars: 6_000,
});

export const ACT_WORKING_MEMORY_CAPS = Object.freeze({
  maxEntries: 16,
  maxVisited: 72,
  maxPromptChars: 1_500,
  maxLabelChars: 80,
});

export const PAGE_TASK_MEMORY_CAPS = Object.freeze({
  maxNotes: 72,
  maxNoteChars: 800,
  maxHistoryChars: 360_000,
});

export const ACT_OUTCOME_MAX_TEXT_CHARS = 24_200;
