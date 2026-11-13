import { describe, expect, it, vi } from 'vitest';
import { normalizeBackupPayload } from '../src/utils/validation.js';
import {
  createPageActionSitePolicyStore,
  isPageActionSensitiveOrigin,
} from '../src/utils/pageActionSitePolicies.js';
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

  it('matches sensitive origins safely and rejects persistent low-risk approval', async () => {
    expect(isPageActionSensitiveOrigin('https://vault.bitwarden.com')).toBe(true);
    expect(isPageActionSensitiveOrigin('https://vault.eu.1password.com')).toBe(true);
    expect(isPageActionSensitiveOrigin('https://accounts.google.com.')).toBe(true);
    expect(isPageActionSensitiveOrigin('https://passwords.google.com')).toBe(true);
    expect(isPageActionSensitiveOrigin('https://evil1password.com')).toBe(false);
    const state = {};
    const store = createPageActionSitePolicyStore({
      get: async () => ({ pageActionSitePolicies: state.pageActionSitePolicies || {} }),
      set: async (value) => Object.assign(state, value),
    });
    await expect(store.update('https://accounts.google.com', 'allow_low_risk')).rejects.toThrow(
      'Low-risk site approval is not available for sensitive sites.'
    );
    await expect(store.update('https://accounts.google.com.', 'allow_low_risk')).rejects.toThrow(
      'Low-risk site approval is not available for sensitive sites.'
    );
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
        origin: 'https://accounts.google.com',
        sitePolicies: { 'https://accounts.google.com': 'allow_low_risk' },
      }).requiresConfirmation
    ).toBe(true);
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: { tag: 'input', label: 'City' },
        origin: 'https://frame.test',
        documentOrigin: 'https://accounts.google.com',
        sitePolicies: { 'https://frame.test': 'allow_low_risk' },
      }).requiresConfirmation
    ).toBe(true);
    // An unlisted origin still confirms field entry; only state-only controls
    // (menu, tab, option) skip the card now.
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
        target: { tag: 'button', role: 'menuitem', label: 'Analytics' },
        origin: 'https://other.test',
        sitePolicies: policies,
      }).requiresConfirmation
    ).toBe(false);
    // A plain control with no reversible-state marker still confirms.
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_click',
        target: { tag: 'button', label: 'More details' },
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

  it('requires approval and hides trust choices on a sensitive origin or document', async () => {
    const events = [];
    const orchestrator = new RunOrchestrator(skills);
    orchestrator._emitEvent = (_runId, event) => events.push(event);
    const id = await orchestrator.startRun({ pageActions: true, sourceTabId: 7 });
    const run = orchestrator.activeRuns.get(id);
    run.pageActions.snapshot = { url: 'https://accounts.google.com/', title: 'Account' };
    const pending = orchestrator._requestPageActionConfirmation(
      run,
      'page_click',
      {},
      { label: 'Open details', frameOrigin: 'https://frame.test' },
      { risk: 'low', reason: 'test action' }
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(true)
    );
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation.siteTrustAllowed).toBe(false);
    orchestrator.resolvePageActionDecision(id, confirmation.confirmationId, true, true);
    await expect(pending).resolves.toBe(true);
    expect(run.pageActions.sessionApproval).toBe(false);
  });

  it('does not honor run approval for a nonsensitive frame inside a sensitive document', async () => {
    const events = [];
    const execute = vi.fn(async () => ({ success: true }));
    const orchestrator = new RunOrchestrator(skills, {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: execute,
    });
    orchestrator._emitEvent = (_runId, event) => events.push(event);
    const id = await orchestrator.startRun({ pageActions: true, sourceTabId: 7 });
    const run = orchestrator.activeRuns.get(id);
    run.pageActions.snapshot = {
      snapshotId: 'sensitive-top',
      url: 'https://accounts.google.com/',
      elements: [
        {
          index: 0,
          tag: 'button',
          label: 'Open details',
          frameOrigin: 'https://frame.test',
          sensitive: false,
        },
      ],
    };
    run.pageActions.sessionApproval = true;
    const pending = orchestrator.executeTool(id, {
      id: 'frame-action',
      function: {
        name: 'page_click',
        arguments: JSON.stringify({ snapshotId: 'sensitive-top', index: 0 }),
      },
    });
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(true)
    );
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation.siteTrustAllowed).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    orchestrator.resolvePageActionDecision(id, confirmation.confirmationId, true, true);
    await expect(pending).resolves.toMatchObject({ result: { success: true } });
    expect(run.pageActions.sessionApproval).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps frame policy origin separate from the top-level document origin', async () => {
    const orchestrator = new RunOrchestrator(skills);
    orchestrator._emitEvent = vi.fn();
    const id = await orchestrator.startRun({ pageActions: true, sourceTabId: 7 });
    const run = orchestrator.activeRuns.get(id);
    run.pageActions.snapshot = { url: 'https://host.test/page' };
    const pending = orchestrator._requestPageActionConfirmation(
      run,
      'page_click',
      {},
      { label: 'Frame action', frameOrigin: 'https://frame.test' },
      { risk: 'low', reason: 'test action' }
    );
    expect(run.pageActions.pendingConfirmation).toMatchObject({
      siteOrigin: 'https://frame.test',
      documentOrigin: 'https://host.test',
    });
    orchestrator.resolvePageActionDecision(id, run.pageActions.pendingConfirmation.id, true);
    await expect(pending).resolves.toBe(true);
  });

  it('applies policy tightening to active runs but defers new allowances', async () => {
    const orchestrator = new RunOrchestrator(skills, {
      pageActionSitePolicyProvider: async () => ({ 'https://saved.test': 'allow_low_risk' }),
    });
    orchestrator._emitEvent = vi.fn();
    const id = await orchestrator.startRun({ pageActions: true, sourceTabId: 7 });
    expect(
      orchestrator.applySitePolicyChange({
        'https://saved.test': 'block',
        'https://new.test': 'allow_low_risk',
      })
    ).toBe(true);
    expect(orchestrator.activeRuns.get(id).pageActions.sitePolicies).toEqual({
      'https://saved.test': 'block',
    });
  });

  it('removes an active run low-risk allowance when storage removes it', async () => {
    const orchestrator = new RunOrchestrator(skills, {
      pageActionSitePolicyProvider: async () => ({ 'https://saved.test': 'allow_low_risk' }),
    });
    orchestrator._emitEvent = vi.fn();
    const id = await orchestrator.startRun({ pageActions: true, sourceTabId: 7 });
    expect(orchestrator.applySitePolicyChange({})).toBe(true);
    expect(orchestrator.activeRuns.get(id).pageActions.sitePolicies).toEqual({});
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
