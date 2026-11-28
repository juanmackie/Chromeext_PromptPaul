/**
 * @fileoverview Act integration for optional WebMCP page tools.
 * @module actWebMcpTests
 */

import { describe, expect, it } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

function createStubSkillManager() {
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

function makeSnapshot() {
  return {
    snapshotId: 'page-snap-1',
    url: 'https://example.test/todos',
    title: 'Todos',
    header: 'Current page',
    content: '[0] <button label="Add">',
    footer: 'End of page',
    elements: [{ index: 0, tag: 'button', label: 'Add', text: 'Add', sensitive: false }],
  };
}

function makeCall(id, name, args) {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

async function startRun(executor) {
  const calls = [];
  const orch = new RunOrchestrator(createStubSkillManager(), {
    pageActionExecutor: async (tabId, actionName, args) => {
      calls.push({ actionName, args });
      return executor(actionName, args);
    },
  });
  const events = [];
  orch._emitEvent = (_runId, event) => events.push(event);
  const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
  return { orch, runId, calls, events };
}

describe('Act WebMCP tools', () => {
  it('keeps Act unchanged when the page exposes no WebMCP API', async () => {
    const { orch, runId, calls } = await startRun((actionName) => {
      if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
      return { success: true, available: false, tools: [] };
    });
    await orch.executeTool(runId, makeCall('state-1', 'page_get_state', {}));

    const result = await orch.executeTool(runId, makeCall('tools-1', 'page_webmcp_tools', {}));

    expect(calls.map((call) => call.actionName)).toContain('page_webmcp_tools');
    expect(result.result).toMatchObject({ available: false, tools: [] });
    expect(result.result.message).toMatch(/Continue with the DOM page actions/);

    // The ordinary DOM path still works on the same run.
    calls.length = 0;
    await orch.executeTool(
      runId,
      makeCall('find-1', 'page_find_text', { query: 'Add', snapshotId: 'page-snap-1' })
    );
    expect(calls.map((call) => call.actionName)).toEqual(['page_find_text']);
  });

  it('lists normalized tools and hides debugging tools', async () => {
    const { orch, runId } = await startRun((actionName) => {
      if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
      return {
        success: true,
        available: true,
        tools: [
          {
            name: 'get_order_status',
            description: 'Read one order',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
          },
          { name: 'debug_probe', annotations: { debugging: true } },
          { name: 'bad name' },
        ],
      };
    });
    await orch.executeTool(runId, makeCall('state-1', 'page_get_state', {}));

    const result = await orch.executeTool(runId, makeCall('tools-1', 'page_webmcp_tools', {}));

    expect(result.result.available).toBe(true);
    expect(result.result.tools.map((tool) => tool.name)).toEqual(['get_order_status']);
    expect(result.result.actionReceipt).toMatchObject({
      disposition: 'delivered_verified',
      evidence: { kind: 'webmcp_tool_list' },
    });
  });

  it('requires confirmation even when the page declares the tool read-only', async () => {
    const { orch, runId, calls, events } = await startRun((actionName, args) => {
      if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
      if (args.approve !== true)
        return {
          success: true,
          available: true,
          probe: true,
          name: args.name,
          annotations: { readOnlyHint: true, untrustedContentHint: true },
        };
      return {
        success: true,
        available: true,
        ok: true,
        name: args.name,
        text: 'order 42 shipped',
      };
    });
    await orch.executeTool(runId, makeCall('state-1', 'page_get_state', {}));
    orch.activeRuns.get(runId).pageActions.freshActionSnapshotAfterUnverified = true;

    const pending = orch.executeTool(
      runId,
      makeCall('call-1', 'page_webmcp_call', {
        name: 'get_order_status',
        arguments: { timeframe: 'today' },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation).toMatchObject({ action: 'page_webmcp_call', risk: 'high' });
    expect(confirmation.summary).toContain('get_order_status');
    expect(calls.filter((call) => call.args?.approve === true)).toHaveLength(0);

    orch.resolvePageActionDecision(runId, confirmation.confirmationId, true);
    const result = await pending;

    expect(result.result).toMatchObject({
      ok: true,
      toolResult: 'order 42 shipped',
      untrusted: true,
    });
    expect(result.result.actionReceipt).toMatchObject({
      disposition: 'delivered_unverified',
      evidence: { kind: 'webmcp_tool_result' },
    });
    // A prior fresh-snapshot exemption must not survive an unverified tool call.
    expect(orch.activeRuns.get(runId).pageActions.freshActionSnapshotAfterUnverified).toBe(false);
    // Probe first, then the approved execution with the model's arguments.
    expect(calls.filter((call) => call.actionName === 'page_webmcp_call')).toEqual([
      { actionName: 'page_webmcp_call', args: { name: 'get_order_status', approve: false } },
      {
        actionName: 'page_webmcp_call',
        args: { name: 'get_order_status', arguments: { timeframe: 'today' }, approve: true },
      },
    ]);
  });

  it('requires explicit confirmation before a mutating or consequential tool', async () => {
    const { orch, runId, calls, events } = await startRun((actionName, args) => {
      if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
      if (args.approve !== true)
        return {
          success: true,
          available: true,
          probe: true,
          name: args.name,
          annotations: { consequentialHint: true },
        };
      return { success: true, available: true, ok: true, name: args.name, text: 'booked' };
    });
    await orch.executeTool(runId, makeCall('state-1', 'page_get_state', {}));

    const pending = orch.executeTool(
      runId,
      makeCall('call-1', 'page_webmcp_call', {
        name: 'book_flight',
        arguments: { flightId: 'AB12' },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation).toMatchObject({ action: 'page_webmcp_call', risk: 'high' });
    expect(confirmation.summary).toContain('book_flight');
    // Nothing was executed before the decision.
    expect(calls.filter((call) => call.args?.approve === true)).toHaveLength(0);

    orch.resolvePageActionDecision(runId, confirmation.confirmationId, true);
    const result = await pending;
    expect(result.result).toMatchObject({ ok: true, toolResult: 'booked' });
    expect(result.result.actionReceipt).toMatchObject({
      disposition: 'delivered_unverified',
      evidence: { kind: 'webmcp_tool_result' },
    });
  });

  it('reports a denied tool without dispatching it', async () => {
    const { orch, runId, calls, events } = await startRun((actionName, args) => {
      if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
      if (args.approve !== true)
        return { success: true, available: true, probe: true, name: args.name, annotations: {} };
      return { success: true, available: true, ok: true, name: args.name, text: 'ran' };
    });
    await orch.executeTool(runId, makeCall('state-1', 'page_get_state', {}));

    const denied = orch.executeTool(
      runId,
      makeCall('call-1', 'page_webmcp_call', { name: 'add_todo' })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, false);

    await expect(denied).resolves.toMatchObject({ result: { error: 'PAGE_ACTION_DENIED' } });
    expect(calls.filter((call) => call.args?.approve === true)).toHaveLength(0);
  });

  it('reports a failed or missing tool as not delivered', async () => {
    const { orch, runId, events } = await startRun((actionName, args) => {
      if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
      if (args.name === 'gone_tool')
        return {
          success: true,
          available: true,
          error: 'WEBMCP_TOOL_UNAVAILABLE',
          message: 'The page no longer exposes that tool.',
        };
      if (args.approve !== true)
        return {
          success: true,
          available: true,
          probe: true,
          name: args.name,
          annotations: { readOnlyHint: true },
        };
      return { success: true, available: true, ok: false, error: 'WEBMCP_TOOL_FAILED' };
    });
    await orch.executeTool(runId, makeCall('state-1', 'page_get_state', {}));

    const missing = await orch.executeTool(
      runId,
      makeCall('call-1', 'page_webmcp_call', { name: 'gone_tool' })
    );
    expect(missing.result).toMatchObject({ error: 'WEBMCP_TOOL_UNAVAILABLE' });
    expect(missing.result.actionReceipt.disposition).toBe('not_delivered');

    const pendingFailed = orch.executeTool(
      runId,
      makeCall('call-2', 'page_webmcp_call', { name: 'read_tool' })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation).toMatchObject({ action: 'page_webmcp_call', risk: 'high' });
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, true);
    const failed = await pendingFailed;
    expect(failed.result).toMatchObject({ ok: false, error: 'WEBMCP_TOOL_FAILED' });
    expect(failed.result.actionReceipt).toMatchObject({
      disposition: 'not_delivered',
      evidence: { kind: 'webmcp_tool_failed' },
    });
  });
});
