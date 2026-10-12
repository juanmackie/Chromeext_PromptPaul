import { describe, expect, it } from 'vitest';
import {
  serializeMind2WebPageActionResult,
  serializePageActionResult,
} from '../src/utils/pageActionResult.js';
import { compactPageTaskHistory } from '../src/orchestrator/PageTaskMemory.js';

describe('compact Act results', () => {
  it('keeps one readable control list and receipts without modifying internal evidence', () => {
    const snapshot = {
      snapshotId: 'state-1',
      url: 'https://example.test/',
      title: 'Form',
      header: 'Untrusted page',
      content: '[0] input Name',
      readableContent: 'Contact form',
      elements: [
        { index: 0, label: 'Name' },
        {
          index: 1,
          tag: 'a',
          label: 'Recipe details',
          href: 'https://user:password@example.test/recipe?token=secret#section',
          target: '_blank',
        },
      ],
      regions: [{ id: 'region-0', indices: [0], elementCount: 1 }],
      fingerprint: 'abcd',
      metrics: { buildMs: 5 },
    };
    const original = {
      success: true,
      result: {
        snapshot,
        notice: 'Fresh indexes',
        actionReceipt: { disposition: 'delivered_verified' },
      },
    };
    const encoded = serializePageActionResult(original);
    const decoded = JSON.parse(encoded);
    expect(decoded.result.snapshot).toMatchObject({
      snapshotId: 'state-1',
      content: '[0] input Name',
      readableContent: 'Contact form',
    });
    expect(decoded.result.snapshot.elements).toBeUndefined();
    expect(decoded.result.snapshot.links).toEqual([
      {
        index: 1,
        label: 'Recipe details',
        href: 'https://example.test/recipe',
        opensNewTab: true,
      },
    ]);
    expect(encoded).not.toMatch(/password|token=secret|section/);
    expect(decoded.result.snapshot.regions).toEqual([{ id: 'region-0', elementCount: 1 }]);
    expect(decoded.result.snapshot.fingerprint).toBeUndefined();
    expect(decoded.result.snapshot.metrics).toBeUndefined();
    expect(decoded.result.notice).toBe('Fresh indexes');
    expect(decoded.result.actionReceipt.disposition).toBe('delivered_verified');
    expect(snapshot.elements).toHaveLength(2);
    expect(encoded.length).toBeLessThan(JSON.stringify(original).length);
    const history = ['state-1', 'state-2'].map((snapshotId) => ({
      role: 'tool',
      name: 'page_get_state',
      content: serializePageActionResult({
        success: true,
        result: { snapshot: { ...snapshot, snapshotId } },
      }),
    }));
    const compacted = compactPageTaskHistory(history);
    expect(JSON.parse(compacted[0].content).result.snapshot.compacted).toBe(true);
    expect(JSON.parse(compacted[1].content).result.snapshot.content).toBe(snapshot.content);
  });

  it('surfaces bounded editable-control indexes for Mind2Web without exposing field values', () => {
    const original = {
      success: true,
      result: {
        snapshot: {
          snapshotId: 'mind2web-state',
          content:
            '[0] <a label="Find a doctor">\n[12] <input placeholder="Specialty">\n        [5] <button label="Resources">\n          [6] <a label="Guidance & Resources">\n[99] <input label="INPUT" value="<div class=\"alert alert-danger\">Image is not internal. Cannot convert SVG to code.</div>">',
          elements: [
            {
              index: 12,
              tag: 'input',
              role: 'combobox',
              label: 'Search doctors',
              placeholder: 'Specialty',
              value: 'PRIVATE FORM VALUE',
            },
            {
              index: 13,
              tag: 'input',
              type: 'password',
              label: 'Password',
              sensitive: true,
              value: 'PRIVATE PASSWORD',
            },
            {
              index: 2,
              tag: 'button',
              role: 'button',
              label: 'Find a doctor',
              text: 'Find a doctor',
            },
            {
              index: 3,
              tag: 'a',
              label: 'Benefits',
              text: 'Benefits',
              resultContext: 'Benefits eligibility and application details',
              haspopup: 'menu',
              expanded: false,
            },
            {
              index: 4,
              tag: 'a',
              label: 'Privacy policy',
              text: 'Privacy policy',
            },
            {
              index: 5,
              tag: 'button',
              role: 'button',
              label: 'Resources',
              text: 'Resources',
            },
            {
              index: 6,
              tag: 'a',
              label: 'Guidance & Resources',
              text: 'Resources',
            },
            {
              index: 99,
              tag: 'input',
              label: 'INPUT',
              value:
                '<div class="alert alert-danger">Image is not internal. Cannot convert SVG to code.</div>',
            },
          ],
        },
      },
    };

    const encoded = serializeMind2WebPageActionResult(original);
    const decoded = JSON.parse(encoded);
    expect(decoded.result.snapshot.content).toContain('EDITABLE CONTROLS');
    expect(decoded.result.snapshot.content).toContain('[12] <input role="combobox"');
    expect(decoded.result.snapshot.content).toContain('placeholder="Specialty" depth=0>');
    expect(decoded.result.snapshot.content).toContain(
      'MENU AND MATCHING SECTION PARENTS (check these before leaf links when browsing)'
    );
    expect(decoded.result.snapshot.content).toContain(
      'label="Resources" text="Resources" depth=4>'
    );
    expect(decoded.result.snapshot.content).toContain(
      '[2] <button role="button" label="Find a doctor"'
    );
    expect(decoded.result.snapshot.content).toContain('ACTIONABLE CONTROLS');
    expect(
      decoded.result.snapshot.content.indexOf('MENU AND MATCHING SECTION PARENTS')
    ).toBeLessThan(decoded.result.snapshot.content.indexOf('ACTIONABLE CONTROLS'));
    expect(decoded.result.snapshot.content).toContain('haspopup="menu" expanded=false');
    expect(decoded.result.snapshot.content).toContain('resultContext="Benefits eligibility');
    expect(decoded.result.snapshot.content).toContain('FULL PAGE OUTLINE');
    expect(decoded.result.snapshot.content.endsWith('state as its USPS two-letter code.')).toBe(
      true
    );
    expect(decoded.result.snapshot.elements).toBeUndefined();
    expect(encoded).not.toContain('PRIVATE FORM VALUE');
    expect(encoded).not.toContain('PRIVATE PASSWORD');
    expect(encoded).not.toContain('Cannot convert SVG to code');
    expect(decoded.result.snapshot.content).not.toContain('[99] <input');
    expect(original.result.snapshot.elements).toHaveLength(8);
  });
});
