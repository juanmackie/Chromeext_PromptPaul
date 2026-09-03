/**
 * @fileoverview Dry-run interception tests for evaluation Act runs.
 * @module evalDryRunTest
 */

import { describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

function skillManager() {
  return {
    resolveSkill: () => null,
    getEligibleSnapshot: () => [],
    getSkillsList: () => [],
    getSlashCommands: () => [],
    hasSkill: () => false,
    getSkillNames: () => [],
  };
}

function call(id, name, args) {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

function snapshot() {
  return {
    snapshotId: 'dry-run-snapshot',
    url: 'https://fixture.test/task',
    title: 'Public fixture',
    fingerprint: 'fixture-state',
    elements: [
      { index: 0, tag: 'button', role: 'button', label: 'Delete record', text: 'Delete record' },
    ],
  };
}

describe('Act dry-run interception', () => {
  it('captures a high-risk action without dispatching it', async () => {
    const executor = vi.fn(async () => ({ success: true, snapshot: snapshot() }));
    const orchestrator = new RunOrchestrator(skillManager(), {
      pageActionExecutor: executor,
      pageActionPolicyProvider: async () => true,
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      provider: 'api',
      pageActions: true,
      sourceTabId: 7,
      evalDryRun: true,
      tool_choice: 'auto',
    });
    const run = orchestrator.getRun(runId);
    run.pageActions.snapshot = snapshot();
    run.pageActions.sessionApproval = true;

    const result = await orchestrator.executeTool(
      runId,
      call('delete-1', 'page_click', { snapshotId: 'dry-run-snapshot', index: 0 })
    );

    expect(result.result).toMatchObject({
      dryRun: true,
      intendedAction: {
        name: 'page_click',
        target: { label: 'Delete record', index: 0 },
        risk: 'high',
      },
      actionReceipt: { disposition: 'not_delivered' },
    });
    expect(executor).not.toHaveBeenCalled();
    orchestrator.abort(runId);
  });

  it('intercepts safe state changes as well as irreversible actions', async () => {
    const executor = vi.fn(async () => ({ success: true, snapshot: snapshot() }));
    const orchestrator = new RunOrchestrator(skillManager(), {
      pageActionExecutor: executor,
      pageActionPolicyProvider: async () => true,
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      provider: 'api',
      pageActions: true,
      sourceTabId: 7,
      evalDryRun: true,
      tool_choice: 'auto',
    });
    const run = orchestrator.getRun(runId);
    run.pageActions.snapshot = {
      ...snapshot(),
      elements: [{ index: 0, tag: 'button', role: 'button', label: 'Save public value' }],
    };
    run.pageActions.sessionApproval = true;

    const result = await orchestrator.executeTool(
      runId,
      call('save-1', 'page_click', { snapshotId: 'dry-run-snapshot', index: 0 })
    );

    expect(result.result).toMatchObject({
      dryRun: true,
      intendedAction: { name: 'page_click', target: { label: 'Save public value', index: 0 } },
      actionReceipt: { disposition: 'not_delivered' },
    });
    expect(executor).not.toHaveBeenCalled();
    orchestrator.abort(runId);
  });

  it('preserves hard policy blocks in dry-run mode', async () => {
    const executor = vi.fn(async () => ({ success: true, snapshot: snapshot() }));
    const orchestrator = new RunOrchestrator(skillManager(), {
      pageActionExecutor: executor,
      pageActionPolicyProvider: async () => true,
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      provider: 'api',
      pageActions: true,
      sourceTabId: 7,
      evalDryRun: true,
      tool_choice: 'auto',
    });
    const run = orchestrator.getRun(runId);
    run.pageActions.snapshot = {
      ...snapshot(),
      elements: [
        {
          index: 0,
          tag: 'input',
          role: 'textbox',
          label: 'Account password',
          type: 'password',
          sensitive: true,
        },
      ],
    };
    run.pageActions.sessionApproval = true;

    const result = await orchestrator.executeTool(
      runId,
      call('password-1', 'page_input', {
        snapshotId: 'dry-run-snapshot',
        index: 0,
        text: 'blocked',
      })
    );

    expect(result.result.error).toBe('PAGE_ACTION_BLOCKED');
    expect(executor).not.toHaveBeenCalled();
    orchestrator.abort(runId);
  });
});
