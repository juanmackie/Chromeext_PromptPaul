/**
 * @fileoverview Improve typed composer prompts and allow the user to undo.
 * @module ImprovePrompt
 */

/**
 * Wire the composer Improve action.
 * @param {{input: HTMLTextAreaElement, button: HTMLButtonElement, undoButton: HTMLButtonElement, sendButton: HTMLButtonElement, status: HTMLElement, send: (prompt: string) => Promise<object>}} options
 */
export function initImprovePrompt({ input, button, undoButton, sendButton, status, send }) {
  let original = null;
  let pending = false;
  const sync = () => {
    button.disabled = pending || !input.value.trim();
  };
  const clearUndo = () => {
    original = null;
    undoButton.hidden = true;
  };
  sendButton.addEventListener('click', clearUndo);
  input.addEventListener('input', () => {
    clearUndo();
    sync();
  });
  undoButton.addEventListener('click', () => {
    if (original === null) return;
    input.value = original;
    clearUndo();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  button.addEventListener('click', async () => {
    if (pending || !input.value.trim()) return;
    const snapshot = input.value;
    pending = true;
    status.textContent = '';
    sync();
    try {
      const response = await send(snapshot);
      if (input.value !== snapshot) {
        status.textContent = 'Prompt changed while improving; the result was not applied.';
      } else if (!response?.success) {
        status.textContent = response?.error || 'Could not improve this prompt.';
      } else {
        original = snapshot;
        input.value = response.content;
        undoButton.hidden = false;
        sync();
      }
    } catch (error) {
      status.textContent = error?.message || 'Could not improve this prompt.';
    } finally {
      pending = false;
      sync();
    }
  });
  sync();
}
