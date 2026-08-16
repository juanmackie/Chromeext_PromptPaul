import { afterEach, describe, expect, it } from 'vitest';
import { settleHermesApproval, settleHermesApprovals } from '../src/chat/ChatHermes.js';

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

function makeCard(approvalId) {
  const buttons = [{ disabled: false }, { disabled: false }];
  const card = {
    dataset: { hermesApproval: approvalId },
    buttons,
    children: [],
    attributes: {},
    querySelectorAll(selector) {
      return selector === 'button' ? buttons : [];
    },
    querySelector(selector) {
      return selector === '[data-hermes-approval-status]'
        ? this.children.find((child) => child.dataset.hermesApprovalStatus)
        : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    appendChild(child) {
      this.children.push(child);
    },
  };
  return card;
}

function makeChatArea(cards) {
  return {
    querySelectorAll(selector) {
      return selector === '[data-hermes-approval]' ? cards : [];
    },
  };
}

describe('Hermes approval UI lifecycle', () => {
  it('settles only the approval card matching the gateway update', () => {
    globalThis.document = { createElement: () => ({ dataset: {}, className: '' }) };
    const first = makeCard('approval-1');
    const second = makeCard('approval-2');
    const chatArea = makeChatArea([first, second]);

    expect(settleHermesApproval(chatArea, { approvalId: 'approval-2', choice: 'once' })).toBe(
      second
    );
    expect(first.dataset.state).toBeUndefined();
    expect(second.dataset.state).toBe('settled');
    expect(second.buttons.every((button) => button.disabled)).toBe(true);
    expect(second.children[0].textContent).toBe('Allowed once');
  });

  it('settles outstanding cards when a run ends', () => {
    globalThis.document = { createElement: () => ({ dataset: {}, className: '' }) };
    const first = makeCard('approval-1');
    const second = makeCard('approval-2');
    const chatArea = makeChatArea([first, second]);

    expect(settleHermesApprovals(chatArea, 'error')).toBe(2);
    expect(first.dataset.decision).toBe('error');
    expect(second.dataset.decision).toBe('error');
    expect(settleHermesApprovals(chatArea, 'complete')).toBe(0);
  });
});
