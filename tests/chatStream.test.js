import { describe, expect, it, vi } from 'vitest';

vi.mock('../loadingManager.js', () => ({
  loadingManager: { showToast: vi.fn() },
}));

import { ChatUI } from '../src/chat/ChatUI.js';
import { StreamStateManager } from '../src/chat/ChatStream.js';

describe('StreamStateManager orchestrator event ordering', () => {
  it('keeps a conversation identity until an explicit new chat', () => {
    const state = new StreamStateManager();
    const original = state.getConversationId();
    state.addMessageToHistory({ role: 'user', content: 'hello' });

    expect(state.getConversationId()).toBe(original);
    state.startNewConversation();
    expect(state.getConversationId()).not.toBe(original);
    expect(state.getConversationHistory()).toEqual([]);
  });

  it('buffers out-of-order events until the missing sequence arrives', () => {
    const state = new StreamStateManager();
    const second = { type: 'tool_complete', sequence: 2 };
    const first = { type: 'tool_ready', sequence: 1 };

    expect(state.queueOrchestratorEvent(second)).toEqual([]);
    expect(state.queueOrchestratorEvent(first)).toEqual([first, second]);
  });

  it('ignores duplicate and stale events', () => {
    const state = new StreamStateManager();
    const first = { type: 'content', sequence: 1 };

    expect(state.queueOrchestratorEvent(first)).toEqual([first]);
    expect(state.queueOrchestratorEvent(first)).toEqual([]);
    expect(state.queueOrchestratorEvent({ type: 'content', sequence: 0 })).toEqual([
      { type: 'content', sequence: 0 },
    ]);
  });

  it('flushes buffered events before a terminal event when a sequence is unavailable', () => {
    const state = new StreamStateManager();
    const second = { type: 'tool_complete', sequence: 2 };
    const terminal = { type: 'complete', sequence: 3 };

    expect(state.queueOrchestratorEvent(second)).toEqual([]);
    expect(state.queueOrchestratorEvent(terminal)).toEqual([second, terminal]);
  });

  it('starts after the last sequence represented by a reconnect journal', () => {
    const state = new StreamStateManager();
    state.setNextOrchestratorEventSequence(4);
    const event = { type: 'tool_ready', sequence: 5 };

    expect(state.queueOrchestratorEvent(event)).toEqual([event]);
  });

  it('passes through events from legacy senders without sequence metadata', () => {
    const state = new StreamStateManager();
    const event = { type: 'content', data: 'Hello' };

    expect(state.queueOrchestratorEvent(event)).toEqual([event]);
  });
});

describe('ChatUI message placement', () => {
  it('moves the completed response after tool activity', () => {
    const chatArea = {
      children: [],
      scrollHeight: 100,
      scrollTop: 0,
      appendChild(node) {
        const existingIndex = this.children.indexOf(node);
        if (existingIndex >= 0) this.children.splice(existingIndex, 1);
        this.children.push(node);
        node.parentNode = this;
      },
    };
    const response = { parentNode: chatArea };
    const toolTrace = { parentNode: chatArea };
    chatArea.children.push(response, toolTrace);

    const ui = new ChatUI();
    ui.chatArea = chatArea;

    expect(ui.moveMessageToEnd(response)).toBe(true);
    expect(chatArea.children).toEqual([toolTrace, response]);
    expect(chatArea.scrollTop).toBe(chatArea.scrollHeight);
  });
});
