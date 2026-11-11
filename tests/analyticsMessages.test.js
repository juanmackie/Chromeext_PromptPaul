/**
 * @fileoverview Usage-analytics message routing tests.
 * @module analyticsMessagesTest
 */

import { describe, expect, it, vi } from 'vitest';
import { handleAnalyticsMessage } from '../src/background/index.js';

function dependencies(overrides = {}) {
  return {
    extensionPageSender: true,
    rejectUnauthorizedMessage: vi.fn((sendResponse) => {
      sendResponse({ error: 'Unauthorized' });
      return false;
    }),
    sendResponse: vi.fn(),
    trackInstructionUsageById: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('background analytics message handler', () => {
  it('ignores messages owned by another capability', () => {
    expect(handleAnalyticsMessage({ action: 'other' }, {}, dependencies())).toBeNull();
  });

  it('requires an extension page sender', () => {
    const deps = dependencies({ extensionPageSender: false });

    const result = handleAnalyticsMessage(
      { action: 'trackInstructionUsage', instructionId: 'inst_1' },
      {},
      deps
    );

    expect(result).toBe(false);
    expect(deps.rejectUnauthorizedMessage).toHaveBeenCalledOnce();
    expect(deps.trackInstructionUsageById).not.toHaveBeenCalled();
  });

  it('acknowledges and forwards a bounded instruction id plus source', () => {
    const deps = dependencies();

    const result = handleAnalyticsMessage(
      { action: 'trackInstructionUsage', instructionId: ' inst_1 ', source: 'notch' },
      {},
      deps
    );

    expect(result).toBe(false);
    expect(deps.sendResponse).toHaveBeenCalledWith({ success: true });
    expect(deps.trackInstructionUsageById).toHaveBeenCalledWith('inst_1', 'notch');
  });

  it('defaults the source to the side panel', () => {
    const deps = dependencies();

    handleAnalyticsMessage({ action: 'trackInstructionUsage', instructionId: 'inst_1' }, {}, deps);

    expect(deps.trackInstructionUsageById).toHaveBeenCalledWith('inst_1', 'side_panel');
  });

  it('rejects a missing instruction id without calling the tracker', () => {
    const deps = dependencies();

    handleAnalyticsMessage({ action: 'trackInstructionUsage', instructionId: '   ' }, {}, deps);

    expect(deps.sendResponse).toHaveBeenCalledWith({ success: false });
    expect(deps.trackInstructionUsageById).not.toHaveBeenCalled();
  });
});
