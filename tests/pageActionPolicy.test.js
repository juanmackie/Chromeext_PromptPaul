import { describe, expect, it } from 'vitest';
import {
  PAGE_ACTION_RISKS,
  evaluatePageActionPolicy,
  normalizePageActionArgs,
  normalizePageTabActionArgs,
  normalizePageUserInputArgs,
  normalizePageManualInterventionArgs,
} from '../src/utils/pageActionPolicy.js';

describe('pageActionPolicy', () => {
  it('normalizes bounded action arguments', () => {
    expect(normalizePageActionArgs('page_click', { snapshotId: 'snap-1', index: 3 })).toEqual({
      valid: true,
      value: { snapshotId: 'snap-1', index: 3 },
    });
    expect(normalizePageActionArgs('page_scroll', { direction: 'down', pages: 1 })).toEqual({
      valid: true,
      value: { direction: 'down', pages: 1 },
    });
    expect(normalizePageActionArgs('page_find_text', { query: 'Used - Good' })).toEqual({
      valid: true,
      value: { query: 'Used - Good' },
    });
    expect(
      normalizePageActionArgs('page_wait', {
        condition: 'text',
        text: 'Results loaded',
        timeoutMs: 2_000,
      })
    ).toEqual({
      valid: true,
      value: { condition: 'text', text: 'Results loaded', timeoutMs: 2_000 },
    });
    expect(
      normalizePageActionArgs('page_batch', {
        actions: [
          { name: 'page_scroll', args: { direction: 'down' } },
          { name: 'page_find_text', args: { query: 'Results' } },
        ],
      })
    ).toEqual({
      valid: true,
      value: {
        actions: [
          { name: 'page_scroll', args: { direction: 'down', pages: 0.5 } },
          { name: 'page_find_text', args: { query: 'Results' } },
        ],
      },
    });
  });

  it('rejects stale-shaped or oversized arguments before execution', () => {
    expect(normalizePageActionArgs('page_click', { index: 1 })).toEqual({
      valid: false,
      error: 'A current snapshotId is required.',
    });
    expect(
      normalizePageActionArgs('page_input', {
        snapshotId: 'snap-1',
        index: 1,
        text: 'x'.repeat(2_001),
      }).valid
    ).toBe(false);
    expect(normalizePageActionArgs('page_scroll', { direction: 'sideways' }).valid).toBe(false);
    expect(normalizePageActionArgs('page_find_text', { query: ' ' })).toEqual({
      valid: false,
      error: 'Search text cannot be empty.',
    });
    expect(normalizePageActionArgs('page_wait', { condition: 'text', text: 'ready' })).toEqual({
      valid: true,
      value: { condition: 'text', text: 'ready', timeoutMs: 5_000 },
    });
    expect(
      normalizePageActionArgs('page_wait', { condition: 'text_gone', text: 'loading' })
    ).toEqual({
      valid: true,
      value: { condition: 'text_gone', text: 'loading', timeoutMs: 5_000 },
    });
    expect(
      normalizePageActionArgs('page_wait', { condition: 'url_changed', timeoutMs: 10_001 })
    ).toEqual({
      valid: false,
      error: 'Wait timeout must be between 0 and 10000 milliseconds.',
    });
    expect(
      normalizePageActionArgs('page_batch', {
        actions: [{ name: 'page_click', args: { snapshotId: 'snap', index: 1 } }],
      })
    ).toEqual({
      valid: false,
      error: 'A page batch must contain 2 to 4 read-only actions.',
    });
    expect(
      normalizePageActionArgs('page_batch', {
        actions: [
          { name: 'page_find_text', args: { query: 'a' } },
          { name: 'page_click', args: { snapshotId: 'snap', index: 1 } },
        ],
      })
    ).toEqual({
      valid: false,
      error: 'Page batches support only non-nested read-only actions.',
    });
  });

  it('bounds multi-tab actions to safe http(s) URLs and integer tab ids', () => {
    expect(
      normalizePageTabActionArgs('page_open_tab', { url: 'https://example.com/path?q=secret' })
    ).toEqual({
      valid: true,
      value: { url: 'https://example.com/path', background: false },
    });
    expect(normalizePageTabActionArgs('page_open_tab', { url: 'javascript:alert(1)' }).valid).toBe(
      false
    );
    expect(
      normalizePageTabActionArgs('page_open_tab', { url: { toString: () => 'https://safe.test' } })
    ).toMatchObject({
      valid: false,
    });
    expect(
      normalizePageTabActionArgs('page_open_tab', {
        url: `https://example.com/${'x'.repeat(2_048)}`,
      })
    ).toMatchObject({ valid: false });
    expect(
      normalizePageTabActionArgs('page_open_tab', {
        url: `https://example.com/${'é'.repeat(1_000)}`,
      })
    ).toMatchObject({ valid: false });
    expect(normalizePageTabActionArgs('page_switch_tab', { tabId: 4 })).toEqual({
      valid: true,
      value: { tabId: 4 },
    });
    expect(
      normalizePageTabActionArgs('page_open_link', {
        snapshotId: 'snap-1',
        index: 2,
        background: true,
      })
    ).toEqual({
      valid: true,
      value: { snapshotId: 'snap-1', index: 2, background: true },
    });
  });

  it('allows bounded clarification but rejects secret requests', () => {
    expect(
      normalizePageUserInputArgs({ question: 'Which account should I use?', options: ['A', 'B'] })
    ).toEqual({
      valid: true,
      value: { question: 'Which account should I use?', options: ['A', 'B'] },
    });
    expect(normalizePageUserInputArgs({ question: 'Enter your password' }).valid).toBe(false);
  });

  it('allows safe manual intervention but rejects secret or destructive requests', () => {
    expect(
      normalizePageManualInterventionArgs({ question: 'Complete the CAPTCHA in the visible tab.' })
    ).toEqual({
      valid: true,
      value: { question: 'Complete the CAPTCHA in the visible tab.' },
    });
    expect(normalizePageManualInterventionArgs({ question: 'Enter the OTP' }).valid).toBe(false);
    expect(normalizePageManualInterventionArgs({ question: 'Complete the purchase' }).valid).toBe(
      false
    );
  });

  it('allows read-only page state and scrolling without confirmation', () => {
    expect(evaluatePageActionPolicy({ actionName: 'page_get_state' })).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      risk: PAGE_ACTION_RISKS.READ_ONLY,
    });
    expect(evaluatePageActionPolicy({ actionName: 'page_scroll' })).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
    });
    expect(evaluatePageActionPolicy({ actionName: 'page_find_text' })).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      risk: PAGE_ACTION_RISKS.READ_ONLY,
    });
    expect(evaluatePageActionPolicy({ actionName: 'page_wait' })).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      risk: PAGE_ACTION_RISKS.READ_ONLY,
    });
    expect(evaluatePageActionPolicy({ actionName: 'page_batch' })).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      risk: PAGE_ACTION_RISKS.READ_ONLY,
    });
  });

  it('requires confirmation for ordinary mutations by default', () => {
    const result = evaluatePageActionPolicy({
      actionName: 'page_click',
      target: { tag: 'button', text: 'Open details' },
    });
    expect(result).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
      risk: PAGE_ACTION_RISKS.MEDIUM,
    });
  });

  it('keeps submit/send controls confirmation-gated even in trusted mode', () => {
    const result = evaluatePageActionPolicy({
      actionName: 'page_click',
      trustedMode: true,
      target: { tag: 'button', type: 'submit', text: 'Submit form' },
    });
    expect(result).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
      requiresExplicitConfirmation: true,
      risk: PAGE_ACTION_RISKS.HIGH,
    });
  });

  it('allows trusted mode to skip only low/medium confirmations', () => {
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        trustedMode: true,
        target: { tag: 'textarea', label: 'Search', text: 'Search' },
      })
    ).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      requiresExplicitConfirmation: false,
    });

    expect(
      evaluatePageActionPolicy({
        actionName: 'page_click',
        trustedMode: true,
        target: { tag: 'button', text: 'Submit order' },
      })
    ).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
      requiresExplicitConfirmation: true,
      risk: PAGE_ACTION_RISKS.HIGH,
    });
  });

  it('allows safe links as explicit navigation actions', () => {
    const result = evaluatePageActionPolicy({
      actionName: 'page_click',
      target: {
        tag: 'a',
        role: 'link',
        text: 'Open external page',
        href: 'https://external.example/docs',
      },
      trustedMode: true,
    });
    expect(result).toMatchObject({
      allowed: true,
      prohibited: false,
      navigation: true,
      requiresConfirmation: true,
      risk: PAGE_ACTION_RISKS.MEDIUM,
    });
  });

  it('blocks unsafe, download, and new-tab links from page_click', () => {
    for (const target of [
      { tag: 'a', href: 'javascript:alert(1)', text: 'Run script' },
      { tag: 'a', href: 'https://example.test/file.pdf', download: true },
      { tag: 'a', href: 'https://example.test/new', target: '_blank' },
    ]) {
      expect(evaluatePageActionPolicy({ actionName: 'page_click', target })).toMatchObject({
        allowed: false,
        prohibited: true,
      });
    }
  });

  it('keeps navigation-capable buttons confirmation-gated in trusted mode', () => {
    for (const text of ['Open', 'Continue', 'Next', 'Sign in', 'Log in']) {
      const result = evaluatePageActionPolicy({
        actionName: 'page_click',
        trustedMode: true,
        target: { tag: 'button', text },
      });
      expect(result).toMatchObject({
        allowed: true,
        requiresConfirmation: true,
        risk: PAGE_ACTION_RISKS.MEDIUM,
      });
      expect(result.reason).toContain('navigate');
    }
  });

  it('still skips confirmations for ordinary controls in trusted mode', () => {
    const result = evaluatePageActionPolicy({
      actionName: 'page_input',
      trustedMode: true,
      target: { tag: 'textarea', label: 'Search', text: 'Search' },
    });
    expect(result).toMatchObject({ allowed: true, requiresConfirmation: false });
  });

  it('blocks credential and security-sensitive controls in every mode', () => {
    const result = evaluatePageActionPolicy({
      actionName: 'page_input',
      trustedMode: true,
      target: { tag: 'input', type: 'password', name: 'password', sensitive: true },
    });
    expect(result).toMatchObject({
      allowed: false,
      prohibited: true,
      risk: PAGE_ACTION_RISKS.PROHIBITED,
    });
  });
});
