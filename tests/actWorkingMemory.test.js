import { describe, expect, it } from 'vitest';
import {
  ACT_WORKING_MEMORY_CAPS,
  buildActWorkingMemoryPrompt,
  createActWorkingMemory,
  deriveActActionEffect,
  makeActTargetKey,
  recordActAction,
  shouldBlockActTarget,
} from '../src/act/ActWorkingMemory.js';

const delivered = { disposition: 'delivered_verified' };

describe('ActWorkingMemory', () => {
  it('uses the shared bounded memory limits', () => {
    expect(ACT_WORKING_MEMORY_CAPS).toEqual({
      maxEntries: 16,
      maxVisited: 72,
      maxPromptChars: 1_500,
      maxLabelChars: 80,
    });
    expect(Object.isFrozen(ACT_WORKING_MEMORY_CAPS)).toBe(true);
  });

  it('keeps a stable target identity across snapshots and excludes URL secrets', () => {
    const first = makeActTargetKey({
      role: 'button',
      tag: 'button',
      label: 'Showing most relevant',
      href: 'https://mail.example/search?q=secret#token',
      elementKey: 'snap-1:4',
    });
    const next = makeActTargetKey({
      role: 'button',
      tag: 'button',
      label: 'Showing most relevant',
      href: 'https://mail.example/search?q=other#different',
      elementKey: 'snap-2:9',
    });
    expect(first).toBe(next);
    expect(first).not.toContain('secret');
    expect(first).not.toContain('token');
  });

  it('derives bounded effects from receipts and indexed scope changes', () => {
    expect(deriveActActionEffect({ navigated: true })).toBe('navigated');
    expect(deriveActActionEffect({ routeChanged: true })).toBe('route_changed');
    expect(deriveActActionEffect({ scopeDiff: { changes: [{ kind: 'added' }] } })).toBe('opened');
    expect(deriveActActionEffect({ scopeDiff: { changes: [{ kind: 'removed' }] } })).toBe('closed');
    expect(deriveActActionEffect({ scopeDiff: { changes: [{ kind: 'changed' }] } })).toBe(
      'changed'
    );
    expect(deriveActActionEffect({})).toBe('none');
  });

  it('bounds the ledger and prompt, retaining labels but no raw URL or page payload', () => {
    const memory = createActWorkingMemory();
    for (let step = 1; step <= ACT_WORKING_MEMORY_CAPS.maxEntries + 4; step += 1) {
      recordActAction(memory, {
        step,
        action: 'page_click',
        target: { role: 'button', tag: 'button', label: `Control ${step}` },
        receipt: delivered,
        afterFingerprint: `fp-${step}`,
        routeId: `route-${step}`,
      });
    }
    expect(memory.ledger).toHaveLength(ACT_WORKING_MEMORY_CAPS.maxEntries);
    const prompt = buildActWorkingMemoryPrompt(memory);
    expect(prompt).toContain('Control 20');
    expect(prompt.length).toBeLessThanOrEqual(ACT_WORKING_MEMORY_CAPS.maxPromptChars);
    expect(JSON.stringify(memory)).not.toMatch(/https?:|#fragment|page text|secret/i);
  });

  it('detects A→B→A and blocks the next same-target activation until another target acts', () => {
    const memory = createActWorkingMemory();
    const target = { role: 'button', tag: 'button', label: 'Sort order' };
    const key = makeActTargetKey(target);
    recordActAction(memory, {
      action: 'page_click',
      target,
      receipt: delivered,
      beforeFingerprint: 'A',
      afterFingerprint: 'B',
      scopeDiff: { fingerprintChanged: true },
    });
    const result = recordActAction(memory, {
      action: 'page_click',
      target,
      receipt: delivered,
      beforeFingerprint: 'B',
      afterFingerprint: 'A',
      scopeDiff: { fingerprintChanged: true },
    });
    expect(result.toggleDetected).toBe(true);
    expect(shouldBlockActTarget(memory, key)).toBe(true);

    recordActAction(memory, {
      action: 'page_click',
      target: { role: 'menuitemradio', tag: 'div', label: 'Most recent' },
      receipt: delivered,
      beforeFingerprint: 'A',
      afterFingerprint: 'C',
    });
    expect(shouldBlockActTarget(memory, key)).toBe(false);
  });

  it('detects three mutating activations of one key inside six ledger entries', () => {
    const memory = createActWorkingMemory();
    const target = { role: 'button', tag: 'button', label: 'Toggle filter' };
    recordActAction(memory, {
      action: 'page_click',
      target,
      receipt: delivered,
      afterFingerprint: '1',
      scopeDiff: { fingerprintChanged: true },
    });
    recordActAction(memory, {
      action: 'page_click',
      target: { label: 'Other', role: 'button', tag: 'button' },
      receipt: delivered,
      afterFingerprint: '2',
      scopeDiff: { fingerprintChanged: true },
    });
    recordActAction(memory, {
      action: 'page_click',
      target,
      receipt: delivered,
      afterFingerprint: '3',
      scopeDiff: { fingerprintChanged: true },
    });
    const result = recordActAction(memory, {
      action: 'page_click',
      target,
      receipt: delivered,
      afterFingerprint: '4',
      scopeDiff: { fingerprintChanged: true },
    });
    expect(result.toggleDetected).toBe(true);
  });
});
