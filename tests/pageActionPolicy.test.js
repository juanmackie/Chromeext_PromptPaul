import { describe, expect, it } from 'vitest';
import {
  PAGE_ACTION_OCCLUSION_CODE,
  PAGE_ACTION_RISKS,
  buildPageActionOcclusionFailure,
  evaluatePageActionPolicy,
  isPageActionPreDispatchFailure,
  normalizePageActionArgs,
  normalizePageActionOccluder,
  normalizePageActionTitle,
  normalizePageTabActionArgs,
  normalizePageUserInputArgs,
  normalizePageManualInterventionArgs,
  requestsHighRiskUserAction,
} from '../src/utils/pageActionPolicy.js';

describe('pageActionPolicy', () => {
  it('allow-lists keyboard input and classifies Enter and input submit by the form submit control', () => {
    expect(normalizePageActionArgs('page_keypress', { key: 'Enter' })).toMatchObject({
      valid: true,
      value: { key: 'Enter' },
    });
    expect(normalizePageActionArgs('page_keypress', { key: 'Control+L' }).valid).toBe(false);
    expect(normalizePageActionArgs('page_keypress', { key: 'Escape', index: 2 }).valid).toBe(false);
    const target = {
      tag: 'input',
      label: 'Message',
      submitControl: { tag: 'button', label: 'Send' },
    };
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_keypress',
        target,
        args: { key: 'Enter' },
        trustedMode: true,
      })
    ).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target,
        args: { submit: true },
        trustedMode: true,
      })
    ).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_keypress',
        target,
        args: { key: 'Escape' },
        trustedMode: true,
      })
    ).toMatchObject({ risk: 'low', requiresConfirmation: false });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_keypress',
        target: { ...target, sensitive: true },
        args: { key: 'Enter' },
      })
    ).toMatchObject({ allowed: false });
  });

  it('allows same-origin search GET submissions without weakening write-form confirmation', () => {
    const searchTarget = {
      tag: 'textarea',
      role: 'combobox',
      name: 'q',
      label: 'Search',
      frameOrigin: 'https://www.google.com',
      formMethod: 'get',
      formActionOrigin: 'https://www.google.com',
      submitControl: {
        tag: 'input',
        name: 'btnK',
        label: 'Google Search',
        type: 'submit',
        formMethod: 'get',
      },
    };
    for (const [actionName, args] of [
      ['page_input', { submit: true }],
      ['page_keypress', { key: 'Enter' }],
    ]) {
      expect(evaluatePageActionPolicy({ actionName, target: searchTarget, args })).toMatchObject({
        risk: 'low',
        requiresConfirmation: false,
        allowed: true,
      });
    }
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: {
          ...searchTarget,
          formMethod: 'post',
          submitControl: { ...searchTarget.submitControl, formMethod: 'post' },
        },
        args: { submit: true },
      })
    ).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: { ...searchTarget, formActionOrigin: 'https://search.example' },
        args: { submit: true },
      })
    ).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: {
          ...searchTarget,
          submitControl: { ...searchTarget.submitControl, formMethod: 'post' },
        },
        args: { submit: true },
      })
    ).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: {
          ...searchTarget,
          submitControl: {
            ...searchTarget.submitControl,
            formActionOrigin: 'https://submit.example',
          },
        },
        args: { submit: true },
      })
    ).toMatchObject({ risk: 'high', requiresConfirmation: true });
  });
  it('bounds double-click and hover arguments', () => {
    expect(
      normalizePageActionArgs('page_click', { snapshotId: 's', index: 1, count: 2 })
    ).toMatchObject({ valid: true, value: { count: 2 } });
    expect(
      normalizePageActionArgs('page_click', { snapshotId: 's', index: 1, count: 3 }).valid
    ).toBe(false);
    expect(normalizePageActionArgs('page_hover', { snapshotId: 's', index: 1 })).toMatchObject({
      valid: true,
    });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_hover',
        target: { tag: 'button', label: 'Products' },
      })
    ).toMatchObject({ allowed: true, requiresConfirmation: false, risk: 'read-only' });
  });

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
      error: 'A page batch must contain 2 to 6 read-only actions.',
    });
    expect(
      normalizePageActionArgs('page_batch', {
        actions: [
          { name: 'page_find_text', args: { query: 'Results' } },
          { name: 'page_click', args: { snapshotId: 'snap', index: 1 } },
        ],
      })
    ).toEqual({
      valid: false,
      error: 'Page batches support only non-nested read-only actions.',
    });
  });

  it('accepts batch arguments written inline as well as nested under args', () => {
    // The schema nests arguments under `args`, but models routinely write them
    // flat. Rejecting the flat shape failed every entry in the batch with
    // "Search text cannot be empty" and cost a whole provider turn.
    const flat = normalizePageActionArgs('page_batch', {
      actions: [
        { name: 'page_find_text', query: 'Results' },
        { name: 'page_scroll', direction: 'down', pages: 0.5 },
      ],
    });
    expect(flat).toEqual({
      valid: true,
      value: {
        actions: [
          { name: 'page_find_text', args: { query: 'Results' } },
          { name: 'page_scroll', args: { direction: 'down', pages: 0.5 } },
        ],
      },
    });
    // Mixed shapes normalize the same way.
    const mixed = normalizePageActionArgs('page_batch', {
      actions: [
        { name: 'page_find_text', args: { query: 'Price' } },
        { name: 'page_wait', condition: 'text', text: 'Done' },
      ],
    });
    expect(mixed.valid).toBe(true);
    expect(mixed.value.actions).toEqual([
      { name: 'page_find_text', args: { query: 'Price' } },
      { name: 'page_wait', args: { condition: 'text', text: 'Done', timeoutMs: 5_000 } },
    ]);
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

  it('allows handing a sign-in wall to the user without allowing secret disclosure', () => {
    // Observed live failure: the model asked the user to sign in themselves and
    // the credential-word filter rejected the only safe handoff, so the run
    // guessed at the form instead of pausing.
    for (const question of [
      'The workspace shows a sign-in wall. Please sign in yourself in this tab, then resume.',
      'Your work email is prefilled. Please type the password on the page and sign in, then resume.',
      'Sign in on the site so I can continue filing the report, then press Resume.',
      'A one-time code is needed. Please complete that step in the visible tab, then resume.',
    ]) {
      expect(requestsHighRiskUserAction(question)).toBe(false);
      expect(normalizePageManualInterventionArgs({ question }).valid).toBe(true);
    }
    for (const question of [
      'Paste your password here so I can continue.',
      'Send me the one-time code.',
      'Type the password into the chat.',
      'Tell me your credentials and I will sign in for you.',
      'Enter the OTP',
      'Approve the payment so I can finish.',
      'Delete the old reports and then continue.',
      'Change the password for me.',
    ]) {
      expect(requestsHighRiskUserAction(question)).toBe(true);
      expect(normalizePageManualInterventionArgs({ question }).valid).toBe(false);
    }
    expect(
      normalizePageUserInputArgs({
        question: 'Did you finish signing in on the page?',
        options: ['Yes, resume', 'Not yet'],
      }).valid
    ).toBe(true);
    expect(normalizePageUserInputArgs({ question: 'Send me the OTP' }).valid).toBe(false);
  });

  it('does not ask a human to approve a reversible page mutation', () => {
    const policy = (actionName, target, origin = 'https://example.test', extra = {}) =>
      evaluatePageActionPolicy({ actionName, target, origin, ...extra });

    // Typing without submitting stays local and correctable.
    expect(policy('page_input', { tag: 'input', label: 'City' })).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      risk: PAGE_ACTION_RISKS.LOW,
    });
    expect(policy('page_set_value', { tag: 'textarea', label: 'Notes' })).toMatchObject({
      requiresConfirmation: false,
    });
    expect(policy('page_select', { tag: 'select', label: 'Country' })).toMatchObject({
      requiresConfirmation: false,
    });
    // Submitting is where data leaves the page, so it still asks.
    expect(
      policy('page_input', { tag: 'input', label: 'City', inForm: true }, 'https://example.test', {
        args: { submit: true },
      })
    ).toMatchObject({ requiresConfirmation: true });

    // In-page state controls (menu, tab, switch, option) send nothing.
    expect(
      policy('page_click', { tag: 'button', label: 'Products', expanded: false })
    ).toMatchObject({ requiresConfirmation: false, risk: PAGE_ACTION_RISKS.LOW });
    expect(
      policy('page_click', { tag: 'button', role: 'menuitem', label: 'Analytics' })
    ).toMatchObject({ requiresConfirmation: false });
    expect(policy('page_click', { tag: 'button', role: 'tab', label: 'Activity' })).toMatchObject({
      requiresConfirmation: false,
    });
    expect(policy('page_click', { tag: 'div', role: 'option', label: 'Japan' })).toMatchObject({
      requiresConfirmation: false,
    });
    // Focus and widget keys cannot submit anything.
    for (const key of ['Escape', 'Tab', 'ArrowDown']) {
      expect(
        policy('page_keypress', { tag: 'input', label: 'City' }, undefined, { args: { key } })
      ).toMatchObject({ requiresConfirmation: false });
    }

    // Everything irreversible keeps its card.
    expect(
      policy('page_click', { tag: 'button', label: 'Delete row', role: 'menuitem' })
    ).toMatchObject({ requiresConfirmation: true, risk: PAGE_ACTION_RISKS.HIGH });
    expect(
      policy('page_click', { tag: 'a', href: 'https://example.test/docs', label: 'Docs' })
    ).toMatchObject({ requiresConfirmation: true, navigation: true });
    expect(
      policy('page_click', { tag: 'button', label: 'Save', inForm: true, role: 'menuitem' })
    ).toMatchObject({ requiresConfirmation: true });
    expect(policy('page_click', { tag: 'button', label: 'More details' })).toMatchObject({
      requiresConfirmation: true,
    });
  });

  it('keeps a human card on every mutation for a sensitive origin', () => {
    // Mail, banking and account origins never inherit the reversible default,
    // even with an allow-low-risk site policy, because the blast radius of a
    // wrong edit there is not local.
    // Credential surfaces are the origins the product treats as sensitive; an
    // app like Gmail is not, because its dangerous action (send) is caught by
    // the high-risk pattern instead.
    for (const origin of [
      'https://accounts.google.com',
      'https://login.microsoftonline.com',
      'https://vault.bitwarden.com',
    ]) {
      expect(
        evaluatePageActionPolicy({
          actionName: 'page_input',
          target: { tag: 'input', label: 'City' },
          origin,
          sitePolicies: { [origin]: 'allow_low_risk' },
        })
      ).toMatchObject({ allowed: true, requiresConfirmation: true });
      expect(
        evaluatePageActionPolicy({
          actionName: 'page_click',
          target: { tag: 'button', role: 'menuitem', label: 'Analytics' },
          origin,
          trustedMode: true,
        })
      ).toMatchObject({ allowed: true, requiresConfirmation: true });
      // Read-only inspection there is still unrestricted.
      expect(
        evaluatePageActionPolicy({
          actionName: 'page_get_state',
          origin,
          sitePolicies: { [origin]: 'allow_low_risk' },
        })
      ).toMatchObject({ allowed: true, requiresConfirmation: false });
    }
  });

  it('still confirms a send in an app origin even though typing is allowed', () => {
    const origin = 'https://mail.google.com';
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: { tag: 'input', label: 'Subject' },
        origin,
      })
    ).toMatchObject({ allowed: true, requiresConfirmation: false });
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_click',
        target: { tag: 'button', label: 'Send' },
        origin,
      })
    ).toMatchObject({ requiresConfirmation: true, risk: PAGE_ACTION_RISKS.HIGH });
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

  it('uses word boundaries for risk and navigation labels', () => {
    for (const label of ['Postal code', 'Search posts', 'Allowance calculator', 'Sender filter']) {
      expect(
        evaluatePageActionPolicy({
          actionName: 'page_input',
          target: { tag: 'input', label },
          trustedMode: true,
        }).requiresConfirmation
      ).toBe(false);
    }
    for (const label of ['Opening hours', 'Backpacks']) {
      expect(
        evaluatePageActionPolicy({
          actionName: 'page_click',
          target: { tag: 'button', label },
          trustedMode: true,
        })
      ).toMatchObject({ risk: PAGE_ACTION_RISKS.LOW, requiresConfirmation: false });
    }
    for (const label of ['Submit order', 'Delete account', 'Continue', 'Sign in']) {
      expect(
        evaluatePageActionPolicy({
          actionName: 'page_click',
          target: { tag: 'button', label },
          trustedMode: true,
        }).requiresConfirmation
      ).toBe(true);
    }
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

  it('blocks disabled targets for state-changing actions but allows read-only reads', () => {
    const disabledTarget = {
      tag: 'button',
      label: 'Open details',
      text: 'Open details',
      disabled: true,
    };
    const clickResult = evaluatePageActionPolicy({
      actionName: 'page_click',
      target: disabledTarget,
    });
    expect(clickResult.code).toBe('PAGE_ACTION_TARGET_DISABLED');
    expect(clickResult).toMatchObject({
      allowed: false,
      prohibited: true,
      risk: PAGE_ACTION_RISKS.PROHIBITED,
    });
    expect(clickResult.reason).toContain('disabled');
    expect(clickResult.reason).toContain('page_get_state');
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: { tag: 'input', disabled: true },
      }).prohibited
    ).toBe(true);
    // Disabled state never blocks read-only inspection.
    expect(
      evaluatePageActionPolicy({ actionName: 'page_get_state', target: disabledTarget })
    ).toMatchObject({ allowed: true, risk: PAGE_ACTION_RISKS.READ_ONLY });
    // An enabled control with identical metadata stays allowed.
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_click',
        target: { tag: 'button', label: 'Open details', text: 'Open details', disabled: false },
      }).allowed
    ).toBe(true);
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

  it('accepts and bounds an optional model-supplied step title', () => {
    expect(normalizePageActionTitle('Clicking the New task button')).toEqual({
      valid: true,
      value: 'Clicking the New task button',
    });
    // Missing or blank titles are optional.
    expect(normalizePageActionTitle(undefined)).toBeNull();
    expect(normalizePageActionTitle(null)).toBeNull();
    expect(normalizePageActionTitle('   ')).toBeNull();
    // Bounded to PAGE_ACTION_TITLE_MAX_CHARS.
    expect(normalizePageActionTitle('x'.repeat(120)).error).toContain('80 characters');
  });

  it('rejects titles with control characters or credential wording', () => {
    expect(normalizePageActionTitle('Opening the\u0000form').valid).toBe(false);
    expect(normalizePageActionTitle('Checking my password field').valid).toBe(false);
    expect(normalizePageActionTitle('Entering the otp code').valid).toBe(false);
    expect(normalizePageActionTitle('Filling the credit card').valid).toBe(false);
    expect(normalizePageActionTitle('Logging in with api_key').error).toContain('credentials');
  });

  it('drops unsafe optional titles without rejecting otherwise valid actions', () => {
    const withTitle = normalizePageActionArgs('page_click', {
      snapshotId: 'snap-1',
      index: 3,
      title: 'Opening details',
    });
    expect(withTitle).toEqual({
      valid: true,
      value: { snapshotId: 'snap-1', index: 3, title: 'Opening details' },
    });
    for (const title of [
      'Move card to Done',
      'Entering my password',
      'Open token list',
      'Bad\u0000title',
    ]) {
      const normalized = normalizePageActionArgs('page_click', {
        snapshotId: 'snap-1',
        index: 3,
        title,
      });
      expect(normalized).toEqual({ valid: true, value: { snapshotId: 'snap-1', index: 3 } });
    }
  });

  it('bounds and trims untrusted occluder descriptors', () => {
    expect(
      normalizePageActionOccluder({ index: 12, tag: 'DIV', role: 'dialog', label: 'Sign in' })
    ).toEqual({
      index: 12,
      tag: 'div',
      role: 'dialog',
      label: 'Sign in',
    });
    expect(normalizePageActionOccluder(null)).toBeNull();
    expect(normalizePageActionOccluder('dialog')).toBeNull();
    expect(normalizePageActionOccluder({})).toBeNull();
    // Negative and non-integer indices are dropped rather than echoed back.
    expect(normalizePageActionOccluder({ index: -4, tag: 'div' })).toEqual({ tag: 'div' });
    expect(normalizePageActionOccluder({ index: '3.5', tag: 'div' })).toEqual({ tag: 'div' });
    const long = normalizePageActionOccluder({ label: 'x'.repeat(400) });
    expect(long.label.length).toBe(120);
  });

  it('describes the covering control and tells the model to clear it first', () => {
    const failure = buildPageActionOcclusionFailure({
      occluder: { index: 3, tag: 'div', role: 'dialog', label: 'Sign in to continue' },
      targetLabel: 'Save draft',
    });
    expect(failure.code).toBe(PAGE_ACTION_OCCLUSION_CODE);
    expect(failure.message).toContain('Save draft');
    expect(failure.message).toContain('Sign in to continue');
    expect(failure.message).toContain('[3]');
    expect(failure.message).toContain('not delivered');
    // Waiting alone cannot clear a cover, so the suggestion must name the fix.
    expect(failure.suggestion).toMatch(/dismiss/i);
    expect(failure.occluder).toMatchObject({ index: 3, role: 'dialog' });

    // A missing descriptor still yields an actionable failure, never a throw.
    const bare = buildPageActionOcclusionFailure({});
    expect(bare.code).toBe(PAGE_ACTION_OCCLUSION_CODE);
    expect(bare.occluder).toBeNull();
    expect(bare.message).toContain('another element');
  });

  it('only treats a flagged, known pre-dispatch code as pre-dispatch', () => {
    expect(
      isPageActionPreDispatchFailure({
        code: PAGE_ACTION_OCCLUSION_CODE,
        preDispatch: true,
      })
    ).toBe(true);
    // A lost flag or an unknown code keeps the conservative existing accounting.
    expect(isPageActionPreDispatchFailure({ code: PAGE_ACTION_OCCLUSION_CODE })).toBe(false);
    expect(isPageActionPreDispatchFailure({ code: 'PAGE_ACTION_TIMEOUT', preDispatch: true })).toBe(
      false
    );
    expect(isPageActionPreDispatchFailure(null)).toBe(false);
  });
});
