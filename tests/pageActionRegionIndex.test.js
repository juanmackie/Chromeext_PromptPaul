/**
 * @fileoverview Regression coverage for the document-scoped element index: a
 * region-scoped page_get_state lists only its own slice, so controls discovered
 * outside that region must stay resolvable until the document itself changes.
 * @module pageActionRegionIndex
 */

import { describe, expect, it } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

function skillManager() {
  return {
    resolveSkill: () => null,
    getEligibleSnapshot: () => [],
    getSkillsList: () => [],
    getSlashCommands: () => [],
    hasSkill: () => false,
    getSkillNames: () => [],
    getSkillContent: () => null,
  };
}

const APP_URL = 'https://example.test/app';

/** A control record as the content script reports it. */
function control(index, label) {
  return { index, tag: 'button', label, text: label, sensitive: false };
}

function elements(range) {
  return range.map((index) => control(index, `Control ${index}`));
}

/**
 * Executor that serves a full index for a plain read and only the requested
 * slice for a region read, mirroring the content script's region filtering.
 */
function createRegionExecutor() {
  const clicks = [];
  const executor = async (_tabId, actionName, args = {}) => {
    if (actionName === 'page_get_state') {
      if (args.regionId === 'region-1') {
        return {
          success: true,
          snapshot: {
            snapshotId: 'snap-region-1',
            url: APP_URL,
            title: 'App',
            header: 'Current page',
            content: '[32] <button> Control 32',
            footer: 'End of page.',
            fingerprint: 'fp-region',
            regionId: 'region-1',
            elements: elements([32, 33]),
            scroll: { x: 0, y: 0 },
          },
        };
      }
      return {
        success: true,
        snapshot: {
          snapshotId: 'snap-full',
          url: APP_URL,
          title: 'App',
          header: 'Current page',
          content: '[0] <button> Control 0',
          footer: 'End of page.',
          fingerprint: 'fp-full',
          elements: elements(Array.from({ length: 41 }, (_, index) => index)),
          scroll: { x: 0, y: 0 },
        },
      };
    }
    if (actionName === 'page_click') {
      clicks.push(Number(args.index));
      return {
        success: true,
        snapshot: {
          snapshotId: 'snap-after-click',
          url: APP_URL,
          title: 'App',
          header: 'Current page',
          content: '',
          footer: 'End of page.',
          fingerprint: 'fp-after-click',
          elements: elements([5]),
          scroll: { x: 0, y: 0 },
        },
        actionReceipt: {
          disposition: 'delivered_unverified',
          evidence: { kind: 'action_dispatched' },
        },
      };
    }
    throw new Error(`Unexpected action ${actionName}`);
  };
  return { executor, clicks };
}

async function startRun(executor) {
  const orchestrator = new RunOrchestrator(skillManager(), {
    pageActionPolicyProvider: async () => true,
    pageActionExecutor: executor,
  });
  orchestrator._emitEvent = () => {};
  const runId = await orchestrator.startRun({
    pageActions: true,
    sourceTabId: 7,
    profileId: 'default',
    provider: 'api',
    messages: [{ role: 'user', content: 'Click the save draft button.' }],
  });
  const run = orchestrator.getRun(runId);
  run.pageActions.sessionApproval = true;
  return { orchestrator, runId, run };
}

let readCounter = 0;

function readState(orchestrator, runId, args) {
  // Tool-call ids must be unique: the orchestrator dedupes repeated ids and
  // would otherwise return the first read's cached result.
  readCounter += 1;
  return orchestrator.executeTool(runId, {
    id: `state-${readCounter}`,
    function: { name: 'page_get_state', arguments: JSON.stringify(args) },
  });
}

function click(orchestrator, runId, snapshotId, index, id = 'click-1') {
  return orchestrator.executeTool(runId, {
    id,
    function: {
      name: 'page_click',
      arguments: JSON.stringify({ snapshotId, index }),
    },
  });
}

describe('document-scoped element index', () => {
  it('keeps an out-of-region index resolvable after a region-scoped read', async () => {
    const { executor, clicks } = createRegionExecutor();
    const { orchestrator, runId, run } = await startRun(executor);

    await readState(orchestrator, runId, {});
    expect(run.pageActions.snapshot.snapshotId).toBe('snap-full');

    // A region read narrows the payload the model sees, not what it can act on.
    await readState(orchestrator, runId, { regionId: 'region-1' });
    expect(run.pageActions.snapshot.snapshotId).toBe('snap-region-1');
    expect(run.pageActions.snapshot.elements.map((element) => element.index)).toEqual([32, 33]);

    const outcome = await click(orchestrator, runId, 'snap-region-1', 5);

    expect(outcome.result.error).toBeUndefined();
    expect(outcome.result.actionReceipt).toMatchObject({ disposition: 'delivered_unverified' });
    // The click reached the page executor, so the control was still resolvable.
    expect(clicks).toEqual([5]);
  });

  it('still rejects an index that was never observed in this document', async () => {
    const { executor, clicks } = createRegionExecutor();
    const { orchestrator, runId } = await startRun(executor);

    await readState(orchestrator, runId, {});
    await readState(orchestrator, runId, { regionId: 'region-1' });

    const outcome = await click(orchestrator, runId, 'snap-region-1', 150);

    expect(outcome.result.error).toBe('PAGE_STATE_STALE');
    expect(clicks).toEqual([]);
  });

  it('invalidates the merged index when the document changes', async () => {
    const { executor, clicks } = createRegionExecutor();
    const { orchestrator, runId, run } = await startRun(executor);

    await readState(orchestrator, runId, {});
    await readState(orchestrator, runId, { regionId: 'region-1' });

    // A navigation is a new document: indices from the old one must not resolve.
    orchestrator.pageActionExecutor = async (_tabId, actionName, args = {}) => {
      if (actionName === 'page_get_state') {
        return {
          success: true,
          snapshot: {
            snapshotId: 'snap-other-doc',
            url: 'https://example.test/other',
            title: 'Other',
            header: 'Current page',
            content: '',
            footer: 'End of page.',
            fingerprint: 'fp-other',
            elements: elements([0, 1]),
            scroll: { x: 0, y: 0 },
          },
        };
      }
      clicks.push(Number(args.index));
      return { success: true, snapshot: null };
    };

    await readState(orchestrator, runId, {});
    expect(run.pageActions.snapshot.snapshotId).toBe('snap-other-doc');
    expect(run.pageActions.documentUrl).toBe('https://example.test/other');

    const outcome = await click(orchestrator, runId, 'snap-other-doc', 5);

    expect(outcome.result.error).toBe('PAGE_STATE_STALE');
    expect(clicks).toEqual([]);
  });
});
