import { describe, it, expect, vi } from 'vitest';
import {
  MASKED_KEY_PLACEHOLDER,
  createDirtyTracker,
  initUnsavedGuard,
  announceDirtyChange,
  applyCredentialMask,
  resolveCredentialValue,
  flashSaveFeedback,
  renderSetupStatus,
  endpointHost,
} from '../src/options/OptionsUI.js';

function makeInput(value = '') {
  const listeners = {};
  return {
    value,
    placeholder: '',
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
    expect(input.dataset.configured).toBe('true');
    expect(input.placeholder).toBe(MASKED_KEY_PLACEHOLDER);
  });

  it('unmarks when not configured and restores the placeholder', () => {
    const input = makeInput('anything');
    input.dataset.configured = 'true';
    applyCredentialMask(input, false, 'Paste key');
    expect(input.value).toBe('');
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

  it('renders the not-connected state', () => {
    const text = { textContent: '' };
    renderSetupStatus(text, null, { connected: false });
    expect(text.textContent).toContain('Not connected');
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
