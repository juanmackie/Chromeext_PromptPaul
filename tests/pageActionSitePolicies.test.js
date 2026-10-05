import { describe, expect, it, vi } from 'vitest';
import { normalizeBackupPayload } from '../src/utils/validation.js';
import { evaluatePageActionPolicy } from '../src/utils/pageActionPolicy.js';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

const skills = {
  resolveSkill: () => null,
  getEligibleSnapshot: () => [],
  getSkillsList: () => [],
  getSlashCommands: () => [],
};
describe('Act site policy boundaries', () => {
  it('restores bounded origin policies and rejects paths, credentials, invalid rules and overflow', () => {
    const policies = { 'https://example.test': 'allow_low_risk', 'https://blocked.test': 'block' };
    expect(normalizeBackupPayload({ local: { pageActionSitePolicies: policies } })).toMatchObject({
      valid: true,
      value: { local: { pageActionSitePolicies: policies } },
    });
    for (const value of [
      [],
      { 'https://example.test/path': 'block' },
      { 'https://user:pass@example.test': 'block' },
      { 'chrome://settings': 'block' },
      { 'https://example.test': 'allow_all' },
      Object.fromEntries(
        Array.from({ length: 201 }, (_, index) => [`https://site${index}.test`, 'block'])
      ),
    ]) {
      expect(normalizeBackupPayload({ local: { pageActionSitePolicies: value } }).valid).toBe(
        false
      );
    }
  });

  it('blocks before inspection and applies allow-low-risk to its origin only', () => {
    const policies = { 'https://example.test': 'allow_low_risk', 'https://blocked.test': 'block' };
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_get_state',
        origin: 'https://blocked.test',
        sitePolicies: policies,
        trustedMode: true,
      })
    ).toMatchObject({ allowed: false, code: 'PAGE_ACTION_SITE_BLOCKED' });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: { tag: 'input', label: 'City' },
        origin: 'https://example.test',
        sitePolicies: policies,
      }).requiresConfirmation
    ).toBe(false);
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: { tag: 'input', label: 'City' },
        origin: 'https://other.test',
        sitePolicies: policies,
      }).requiresConfirmation
    ).toBe(true);
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_click',
        target: { tag: 'button', label: 'Send' },
        origin: 'https://example.test',
        sitePolicies: policies,
      })
    ).toMatchObject({ risk: 'high', requiresConfirmation: true });
  });

  it('stops gracefully when a bridge detects a blocked redirect', async () => {
    const orchestrator = new RunOrchestrator(skills, {
      pageActionExecutor: async () => {
        const error = new Error('Blocked redirect');
        error.code = 'PAGE_ACTION_SITE_BLOCKED';
        throw error;
      },
      pageActionDocumentProvider: async () => ({ url: 'https://allowed.test' }),
      pageActionSitePolicyProvider: async () => ({ 'https://blocked.test': 'block' }),
    });
    orchestrator._emitEvent = vi.fn();
    const id = await orchestrator.startRun({ pageActions: true, sourceTabId: 7 });
    await expect(
      orchestrator.executeTool(id, {
        id: 'inspect',
        function: { name: 'page_get_state', arguments: '{}' },
      })
    ).resolves.toMatchObject({ result: { error: 'PAGE_ACTION_SITE_BLOCKED' } });
    const run = orchestrator.activeRuns.get(id);
    expect(run.pageActions).toMatchObject({
      siteBlocked: true,
      lastBlockReason: 'site_blocked',
      snapshot: null,
    });
    expect(await orchestrator._buildTools(run)).toEqual([]);
  });

  it('snapshots saved policies, refuses blocked source extraction, and ignores model overrides', async () => {
    const saved = { 'https://blocked.test': 'block' };
    const executor = vi.fn(async () => ({
      snapshot: { snapshotId: 'state', url: 'https://blocked.test', elements: [] },
    }));
    const orchestrator = new RunOrchestrator(skills, {
      pageActionExecutor: executor,
      pageActionDocumentProvider: async () => ({ url: 'https://blocked.test' }),
      pageActionSitePolicyProvider: async () => saved,
    });
    orchestrator._emitEvent = vi.fn();
    const id = await orchestrator.startRun({ pageActions: true, sourceTabId: 7, sitePolicies: {} });
    saved['https://blocked.test'] = 'allow_low_risk';
    const result = await orchestrator.executeTool(id, {
      id: 'inspect',
      function: { name: 'page_get_state', arguments: '{}' },
    });
    expect(result.result.error).toBe('PAGE_ACTION_SITE_BLOCKED');
    expect(executor).not.toHaveBeenCalled();
  });
});
