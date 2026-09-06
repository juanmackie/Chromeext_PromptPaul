import { describe, it, expect, vi } from 'vitest';
import {
  MASKED_KEY_PLACEHOLDER,
  createDirtyTracker,
  initUnsavedGuard,
  announceDirtyChange,
  applyCredentialMask,
  resolveCredentialValue,
  resolveProfileCredentialValue,
  flashSaveFeedback,
  runErrorAwareSave,
  renderSetupStatus,
  endpointHost,
} from '../src/options/OptionsUI.js';

function makeInput(value = '') {
  const listeners = {};
  return {
    value,
    placeholder: '',
    required: true,
    dataset: {},
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener(type, fn) {
      if (listeners[type] === fn) delete listeners[type];
    },
    fire(type) {
      if (listeners[type]) listeners[type]();
    },
  };
}

function makeCheckbox(checked) {
  return { checked, value: '', dataset: {} };
}

describe('createDirtyTracker', () => {
  it('starts clean when fields match the baseline', () => {
    const field = makeInput('initial');
    const tracker = createDirtyTracker([{ element: field }]);
    expect(tracker.isDirty()).toBe(false);
  });

  it('reports dirty when a field changes', () => {
    const field = makeInput('initial');
    const tracker = createDirtyTracker([{ element: field }]);
    field.value = 'changed';
    expect(tracker.isDirty()).toBe(true);
    expect(tracker.getDirtyCount()).toBe(1);
  });

  it('uses getValue when provided', () => {
    const checkbox = makeCheckbox(true);
    const tracker = createDirtyTracker([
      { element: checkbox, getValue: (el) => String(el.checked) },
    ]);
    checkbox.checked = false;
    expect(tracker.isDirty()).toBe(true);
  });

  it('markClean resets the baseline', () => {
    const field = makeInput('a');
    const tracker = createDirtyTracker([{ element: field }]);
    field.value = 'b';
    tracker.markClean();
    expect(tracker.isDirty()).toBe(false);
    field.value = 'c';
    expect(tracker.isDirty()).toBe(true);
  });

  it('emits onChange when events fire', () => {
    const onChange = vi.fn();
    const field = makeInput('x');
    const tracker = createDirtyTracker([{ element: field }], { onChange });
    const detach = tracker.attachEvents(field);
    field.value = 'y';
    field.fire('input');
    expect(onChange).toHaveBeenCalledWith(true, expect.any(Array));
    detach();
    field.value = 'z';
    field.fire('input');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('tolerates null fields', () => {
    const tracker = createDirtyTracker([{ element: null }, { element: makeInput('') }]);
    expect(tracker.isDirty()).toBe(false);
  });
});

describe('applyCredentialMask', () => {
  it('clears the value and marks configured when a key is stored', () => {
    const input = makeInput('secret-value');
    applyCredentialMask(input, true);
    expect(input.value).toBe('');
    expect(input.required).toBe(false);
    expect(input.dataset.configured).toBe('true');
    expect(input.placeholder).toBe(MASKED_KEY_PLACEHOLDER);
  });

  it('unmarks when not configured and restores the placeholder', () => {
    const input = makeInput('anything');
    input.dataset.configured = 'true';
    applyCredentialMask(input, false, 'Paste key');
    expect(input.value).toBe('');
    expect(input.required).toBe(true);
    expect(input.dataset.configured).toBeUndefined();
    expect(input.placeholder).toBe('Paste key');
  });
});

describe('resolveCredentialValue', () => {
  it('returns the new typed value when present', () => {
    expect(resolveCredentialValue('  sk-123  ', false, 'old')).toBe('sk-123');
  });

  it('preserves the stored value when the field is masked', () => {
    expect(resolveCredentialValue('', true, 'stored-key')).toBe('stored-key');
  });

  it('returns empty when nothing typed and not masked', () => {
    expect(resolveCredentialValue('', false, 'stored-key')).toBe('');
  });
});

describe('resolveProfileCredentialValue', () => {
  it('preserves a stored profile key even when the mask marker is stale', () => {
    expect(resolveProfileCredentialValue('', false, 'stored-key')).toBe('stored-key');
  });

  it('prefers a newly typed key over the stored profile key', () => {
    expect(resolveProfileCredentialValue('new-key', true, 'stored-key')).toBe('new-key');
  });

  it('uses a pending credential for a new or reverted profile', () => {
    expect(resolveProfileCredentialValue('', false, '', 'pending-key')).toBe('pending-key');
  });
});

describe('flashSaveFeedback', () => {
  it('applies and removes the success class', () => {
    vi.useFakeTimers();
    try {
      const button = { classList: { add: vi.fn(), remove: vi.fn() }, offsetWidth: 0 };
      flashSaveFeedback(button, false);
      expect(button.classList.add).toHaveBeenCalledWith('is-success');
      vi.runAllTimers();
      expect(button.classList.remove).toHaveBeenCalledWith('is-success', 'is-error');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runErrorAwareSave', () => {
  function makeButton() {
    return { classList: { add: vi.fn(), remove: vi.fn() }, offsetWidth: 0 };
  }

  it('runs the write and surfaces success on resolve', async () => {
    vi.useFakeTimers();
    try {
      const button = makeButton();
      const notify = vi.fn();
      const markClean = vi.fn();
      const write = vi.fn().mockResolvedValue();
      const onSuccess = vi.fn();
      const handler = runErrorAwareSave({
        button,
        write,
        successMessage: 'Saved.',
        errorLabel: 'Failed',
        notify,
        onSuccess,
        markClean,
      });
      await handler();
      expect(write).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('Saved.', false, true);
      expect(button.classList.add).toHaveBeenCalledWith('is-success');
      expect(markClean).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces the write error without marking clean', async () => {
    vi.useFakeTimers();
    try {
      const button = makeButton();
      const notify = vi.fn();
      const markClean = vi.fn();
      const write = vi.fn().mockRejectedValue(new Error('boom'));
      const handler = runErrorAwareSave({
        button,
        write,
        successMessage: 'Saved.',
        errorLabel: 'Failed',
        notify,
        markClean,
      });
      await handler();
      expect(notify).toHaveBeenCalledWith('Failed: boom', true, true);
      expect(button.classList.add).toHaveBeenCalledWith('is-error');
      expect(markClean).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('renderSetupStatus', () => {
  it('renders the connected state', () => {
    const text = { textContent: '' };
    const icon = { textContent: '', classList: { toggle: vi.fn() } };
    renderSetupStatus(text, icon, {
      connected: true,
      model: 'gpt-4',
      endpointHost: 'api.example.com',
    });
    expect(text.textContent).toContain('Connected');
    expect(text.textContent).toContain('gpt-4');
    expect(icon.classList.toggle).toHaveBeenCalledWith('is-connected', true);
  });

  it('renders the configured (untested) state without claiming connection', () => {
    const text = { textContent: '' };
    const icon = { textContent: '', classList: { toggle: vi.fn() } };
    renderSetupStatus(text, icon, { configured: true, provider: 'hermes' });
    expect(text.textContent).toContain('Configured');
    expect(text.textContent).toContain('check');
    expect(text.textContent).not.toContain('Connected');
    expect(icon.classList.toggle).toHaveBeenCalledWith('is-connected', false);
  });

  it('renders a failed check with a visible retry action', () => {
    const text = { textContent: '' };
    const icon = { textContent: '', classList: { toggle: vi.fn() } };
    const action = { textContent: '', classList: { add: vi.fn(), remove: vi.fn() }, onclick: null };
    const onRetry = vi.fn();
    renderSetupStatus(
      text,
      icon,
      {
        configured: true,
        error: 'gateway offline',
        provider: 'hermes',
        onRetry,
        retryLabel: 'Retry',
      },
      action
    );
    expect(text.textContent).toContain('failed');
    expect(text.textContent).not.toContain('Connected');
    expect(action.classList.remove).toHaveBeenCalledWith('d-none');
    expect(action.textContent).toBe('Retry');
    action.onclick();
    expect(onRetry).toHaveBeenCalled();
  });

  it('hides the action button when connected', () => {
    const text = { textContent: '' };
    const action = { textContent: '', classList: { add: vi.fn(), remove: vi.fn() }, onclick: null };
    renderSetupStatus(text, null, { connected: true, provider: 'api' }, action);
    expect(action.classList.add).toHaveBeenCalledWith('d-none');
  });

  it('renders the not-configured state', () => {
    const text = { textContent: '' };
    renderSetupStatus(text, null, { configured: false });
    expect(text.textContent).toContain('Not configured');
    expect(text.textContent).not.toContain('Connected');
  });
});

describe('endpointHost', () => {
  it('extracts the hostname', () => {
    expect(endpointHost('https://api.example.com/v1/chat')).toBe('api.example.com');
  });

  it('falls back to the raw endpoint', () => {
    expect(endpointHost('not a url')).toBe('not a url');
    expect(endpointHost('')).toBe('');
  });
});

describe('initUnsavedGuard', () => {
  it('returns a teardown function in non-browser environments', () => {
    const tracker = createDirtyTracker([{ element: makeInput('a') }]);
    const teardown = initUnsavedGuard(tracker, { confirmBeforeUnload: true });
    expect(typeof teardown).toBe('function');
    teardown();
  });

  it('announceDirtyChange is a safe no-op without a window', () => {
    expect(() => announceDirtyChange(true)).not.toThrow();
  });
});
