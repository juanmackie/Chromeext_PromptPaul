import { describe, expect, it, vi } from 'vitest';
import { initImprovePrompt } from '../src/chat/improve-prompt/ImprovePrompt.js';

function fixtures(send) {
  const listeners = {};
  const input = {
    value: 'Original prompt',
    addEventListener: (name, fn) => (listeners[name] = fn),
    dispatchEvent: vi.fn(),
    focus: vi.fn(),
  };
  const button = { disabled: false, addEventListener: (name, fn) => (listeners.click = fn) };
  const undoButton = { hidden: true, addEventListener: (name, fn) => (listeners.undo = fn) };
  const sendButton = { addEventListener: (name, fn) => (listeners.send = fn) };
  const status = { textContent: '' };
  initImprovePrompt({ input, button, undoButton, sendButton, status, send });
  return { input, button, undoButton, status, listeners };
}

describe('Improve prompt controller', () => {
  it('applies a result and Undo restores the original text', async () => {
    const ui = fixtures(vi.fn().mockResolvedValue({ success: true, content: 'Improved' }));
    await ui.listeners.click();
    expect(ui.input.value).toBe('Improved');
    expect(ui.undoButton.hidden).toBe(false);
    ui.listeners.undo();
    expect(ui.input.value).toBe('Original prompt');
  });

  it('leaves text unchanged on failure and discards a result after edits', async () => {
    const failed = fixtures(vi.fn().mockResolvedValue({ success: false, error: 'Unsupported' }));
    await failed.listeners.click();
    expect(failed.input.value).toBe('Original prompt');
    expect(failed.status.textContent).toBe('Unsupported');
    let resolve;
    const pending = fixtures(() => new Promise((done) => (resolve = done)));
    const request = pending.listeners.click();
    pending.input.value = 'My edit';
    resolve({ success: true, content: 'Improved' });
    await request;
    expect(pending.input.value).toBe('My edit');
    expect(pending.status.textContent).toMatch(/changed/i);
  });

  it('disables empty input and suppresses a second click while pending', async () => {
    let resolve;
    const send = vi.fn(() => new Promise((done) => (resolve = done)));
    const ui = fixtures(send);
    ui.input.value = '';
    ui.listeners.input();
    expect(ui.button.disabled).toBe(true);
    ui.input.value = 'Prompt';
    ui.listeners.input();
    const first = ui.listeners.click();
    const second = ui.listeners.click();
    expect(send).toHaveBeenCalledTimes(1);
    resolve({ success: true, content: 'Improved' });
    await Promise.all([first, second]);
  });
});
