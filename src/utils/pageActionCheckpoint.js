/**
 * @fileoverview Session-safe checkpoints for uncertain page-action delivery.
 * @module pageActionCheckpoint
 *
 * Only compact execution metadata is stored. Page snapshots, page text,
 * credentials, and note text never enter a checkpoint.
 */

import { capPageText } from './pageDom.js';

export const PAGE_ACTION_CHECKPOINT_STORAGE_KEY = 'promptPaulActCheckpointsV1';
export const PAGE_ACTION_CHECKPOINT_CAPS = Object.freeze({
  maxRecords: 8,
  maxGoals: 8,
  maxGoalChars: 200,
  maxInstructionChars: 2_000,
});

const SENSITIVE_CHECKPOINT_TEXT =
  /password|passcode|one[-_ ]?time|otp|2fa|secret|api[-_ ]?key|access[-_ ]?token|credential|payment|credit\s+card|debit\s+card|card\s+number|cvv|cvc|ssn|social security|recovery\s+(?:code|key)|backup\s+code/i;

function safeCheckpointText(value, maxLength) {
  const text = capPageText(value, maxLength);
  return SENSITIVE_CHECKPOINT_TEXT.test(text) ? '[Sensitive task detail omitted.]' : text;
}

const memoryCheckpoints = new Map();
let storageQueue = Promise.resolve();

function hasSessionStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.session);
}

function getSessionStorage() {
  return chrome.storage.session;
}

function storageGet(key) {
  if (!hasSessionStorage()) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    try {
      getSessionStorage().get([key], (result) => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageSet(value) {
  if (!hasSessionStorage()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      getSessionStorage().set(value, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeRecord(record = {}) {
  const runId = capPageText(record.runId, 128);
  if (!runId) return null;
  const planner = record.planner && typeof record.planner === 'object' ? record.planner : null;
  const subGoals = Array.isArray(planner?.subGoals)
    ? planner.subGoals.slice(0, PAGE_ACTION_CHECKPOINT_CAPS.maxGoals).map((goal) => ({
        description: safeCheckpointText(
          goal?.description,
          PAGE_ACTION_CHECKPOINT_CAPS.maxGoalChars
        ),
        status: capPageText(goal?.status, 24),
        blockReason: safeCheckpointText(
          goal?.blockReason,
          PAGE_ACTION_CHECKPOINT_CAPS.maxGoalChars
        ),
        attempts: Math.max(0, Math.floor(Number(goal?.attemptCount) || 0)),
        completionEvidence:
          goal?.completionEvidence && typeof goal.completionEvidence === 'object'
            ? {
                disposition: capPageText(goal.completionEvidence.disposition, 32),
                actionName: capPageText(goal.completionEvidence.actionName, 64),
                evidenceKind: capPageText(goal.completionEvidence.evidenceKind, 64),
                receiptId: Number(goal.completionEvidence.receiptId) || null,
              }
            : null,
      }))
    : [];
  return {
    runId,
    sourceTabId: Number.isInteger(record.sourceTabId) ? record.sourceTabId : null,
    targetTabId: Number.isInteger(record.targetTabId) ? record.targetTabId : null,
    profileId: capPageText(record.profileId, 128),
    provider: capPageText(record.provider, 32),
    instruction: safeCheckpointText(
      record.instruction,
      PAGE_ACTION_CHECKPOINT_CAPS.maxInstructionChars
    ),
    actionName: capPageText(record.actionName, 64),
    toolCallId: capPageText(record.toolCallId, 128),
    actionHash: capPageText(record.actionHash, 128),
    snapshotId: capPageText(record.snapshotId, 128),
    status: capPageText(record.status, 32),
    savedAt: Number.isFinite(Number(record.savedAt)) ? Number(record.savedAt) : Date.now(),
    planner: planner
      ? {
          active: planner.active === true,
          currentSubGoalIndex: Math.max(0, Math.floor(Number(planner.currentSubGoalIndex) || 0)),
          replanCount: Math.max(0, Math.floor(Number(planner.replanCount) || 0)),
          subGoals,
          notesCount: Math.max(0, Math.floor(Number(planner.notesCount) || 0)),
        }
      : null,
    budgets: {
      observation: Math.max(0, Math.floor(Number(record.budgets?.observation) || 0)),
      navigation: Math.max(0, Math.floor(Number(record.budgets?.navigation) || 0)),
      mutation: Math.max(0, Math.floor(Number(record.budgets?.mutation) || 0)),
    },
    receipt: record.receipt
      ? {
          disposition: capPageText(record.receipt.disposition, 32),
          evidenceKind: capPageText(record.receipt.evidence?.kind, 64),
        }
      : null,
  };
}

async function readRecords() {
  if (!hasSessionStorage()) return Array.from(memoryCheckpoints.values());
  const result = await storageGet(PAGE_ACTION_CHECKPOINT_STORAGE_KEY);
  const records = result?.[PAGE_ACTION_CHECKPOINT_STORAGE_KEY];
  if (!Array.isArray(records)) return [];
  return records
    .map(normalizeRecord)
    .filter(Boolean)
    .slice(-PAGE_ACTION_CHECKPOINT_CAPS.maxRecords);
}

async function writeRecords(records) {
  const bounded = records
    .map(normalizeRecord)
    .filter(Boolean)
    .slice(-PAGE_ACTION_CHECKPOINT_CAPS.maxRecords);
  if (!hasSessionStorage()) {
    memoryCheckpoints.clear();
    bounded.forEach((record) => memoryCheckpoints.set(record.runId, record));
    return;
  }
  await storageSet({ [PAGE_ACTION_CHECKPOINT_STORAGE_KEY]: bounded });
}

function queueStorage(operation) {
  const next = storageQueue.then(operation, operation);
  storageQueue = next.catch(() => {});
  return next;
}

/**
 * Save or replace one bounded checkpoint.
 * @param {object} record
 * @returns {Promise<object>} Normalized saved record.
 */
export function savePageActionCheckpoint(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return Promise.reject(new Error('A checkpoint run ID is required.'));
  return queueStorage(async () => {
    const records = await readRecords();
    const next = records.filter((entry) => entry.runId !== normalized.runId);
    next.push(normalized);
    await writeRecords(next);
    return normalized;
  });
}

/**
 * Remove checkpoints for a completed or explicitly discarded run.
 * @param {string} runId
 * @returns {Promise<void>}
 */
export function clearPageActionCheckpoint(runId) {
  const id = capPageText(runId, 128);
  if (!id) return Promise.resolve();
  return queueStorage(async () => {
    const records = await readRecords();
    await writeRecords(records.filter((record) => record.runId !== id));
  });
}

/**
 * Read checkpoints without resuming any run.
 * @returns {Promise<object[]>}
 */
export function listPageActionCheckpoints() {
  return queueStorage(readRecords);
}

/**
 * Read one checkpoint without resuming it.
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
export async function getPageActionCheckpoint(runId) {
  const id = capPageText(runId, 128);
  if (!id) return null;
  const records = await listPageActionCheckpoints();
  return records.find((record) => record.runId === id) || null;
}

/**
 * Clear the in-memory fallback between unit tests.
 * @returns {void}
 */
export function resetPageActionCheckpointsForTests() {
  memoryCheckpoints.clear();
}

export const pageActionCheckpoint = Object.freeze({
  PAGE_ACTION_CHECKPOINT_STORAGE_KEY,
  PAGE_ACTION_CHECKPOINT_CAPS,
  savePageActionCheckpoint,
  clearPageActionCheckpoint,
  listPageActionCheckpoints,
  getPageActionCheckpoint,
});
