import { describe, expect, it } from 'vitest';
import {
  normalizePageElement,
  normalizePageSnapshot,
  PAGE_DOM_CAPS,
  formatPageElement,
} from '../src/utils/pageDom.js';
import { normalizePageActionArgs } from '../src/utils/pageActionPolicy.js';
import { diffPageActionSnapshots } from '../src/utils/pageActionScopeDiff.js';
import fs from 'node:fs';
import vm from 'node:vm';

function runtimeFunction(name) {
  const source = fs.readFileSync('content_script_page_actions.js', 'utf8');
  let start = source.indexOf(`  function ${name}(`);
  if (start < 0) start = source.indexOf(`  function* ${name}(`);
  if (start < 0) throw new Error('Missing shipped runtime helper: ' + name);
  const end = source.indexOf('\n  function ', start + 15);
  const generatorEnd = source.indexOf('\n  function* ', start + 15);
  const bounds = [end, generatorEnd].filter((value) => value > start);
  return vm.runInNewContext(source.slice(start, Math.min(...bounds)) + `; ${name};`);
}

describe('Phase 2 observation contracts', () => {
  it('walks open shadow roots in document order and does not invent access to closed roots', () => {
    const walk = runtimeFunction('walkPageActionNodes');
    const button = { childNodes: [] };
    const openHost = { childNodes: [], shadowRoot: { childNodes: [button] } };
    const closedHost = { childNodes: [], shadowRoot: null };
    const root = { childNodes: [openHost, closedHost] };
    expect([...walk(root)]).toEqual([root, openHost, button, closedHost]);
  });

  it('allocates monotonic IDs by node identity without recycling a removed node ID', () => {
    const getId = runtimeFunction('getPageActionElementId');
    const session = { elementIds: new WeakMap(), nextElementId: 0 };
    const node = {};
    expect(getId(session, node)).toBe(0);
    expect(getId(session, node)).toBe(0);
    expect(getId(session, {})).toBe(1);
    expect(getId(session, {})).toBe(2);
  });
  it('retains a bounded outline instead of reconstructing a flat list', () => {
    const snapshot = normalizePageSnapshot({
      snapshotId: 'outline',
      observationFormat: 'outline',
      content:
        'main\n  heading 1: Current section\n  The code is ORBIT-64.\n  [500] <input label="Code">',
      elements: [{ index: 500, tag: 'input', label: 'Code' }],
      regions: [{ id: 'region-0', indices: [500], elementCount: 1 }],
    });
    expect(snapshot.content).toContain('ORBIT-64');
    expect(snapshot.content).toContain('  heading 1:');
    expect(snapshot.regions[0].indices).toEqual([500]);
    expect(snapshot.elements[0].index).toBe(500);
  });

  it('admits document-stable IDs above the snapshot count while rejecting unsafe integers', () => {
    expect(normalizePageActionArgs('page_click', { snapshotId: 's', index: 500 }).valid).toBe(true);
    expect(
      normalizePageActionArgs('page_click', { snapshotId: 's', index: Number.MAX_SAFE_INTEGER + 1 })
        .valid
    ).toBe(false);
    expect(normalizePageActionArgs('page_click', { snapshotId: 's', index: -1 }).valid).toBe(false);
  });

  it('discloses bounded safe values, masking credentials and excluded input types', () => {
    expect(normalizePageElement({ tag: 'input', label: 'City', value: 'Brisbane' }).value).toBe(
      'Brisbane'
    );
    expect(
      normalizePageElement({ tag: 'input', label: 'City', value: 'x'.repeat(300) }).value
    ).toHaveLength(160);
    for (const type of ['password', 'file', 'hidden']) {
      expect(
        normalizePageElement({ tag: 'input', type, value: 'private-value' }).value
      ).toBeUndefined();
    }
    expect(
      normalizePageElement({ tag: 'input', label: 'API key', value: 'private-value' }).value
    ).toBeUndefined();
    const full = normalizePageSnapshot({
      elements: Array.from({ length: 200 }, (_, index) => ({
        index,
        tag: 'textarea',
        label: 'Notes',
        value: 'x'.repeat(160),
      })),
    });
    expect(
      full.elements.reduce((count, entry) => count + (entry.value?.length || 0), 0)
    ).toBeLessThanOrEqual(PAGE_DOM_CAPS.maxTotalValueChars);
    expect(full.content).toContain('value=');
    expect(full.content).not.toContain('value_present');
  });

  it('keeps focused-target metadata value-free when the shared field-value budget is exhausted', () => {
    const snapshot = normalizePageSnapshot({
      elements: Array.from({ length: 50 }, (_, index) => ({
        index,
        tag: 'textarea',
        label: 'Notes',
        value: 'x'.repeat(160),
      })),
      focusedElement: {
        tag: 'textarea',
        label: 'Extra notes',
        value: 'beyond-shared-budget',
        submitControl: { tag: 'button', label: 'Save', value: 'submit-value' },
      },
    });
    expect(snapshot.elements.reduce((count, entry) => count + entry.value.length, 0)).toBe(8_000);
    expect(snapshot.focusedElement).toMatchObject({ tag: 'textarea', label: 'Extra notes' });
    expect(snapshot.focusedElement.value).toBeUndefined();
    expect(snapshot.focusedElement.submitControl.value).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toMatch(/beyond-shared-budget|submit-value/);
  });

  it('detects a safe value change without returning the value in diff metadata', () => {
    const before = { elements: [{ index: 9, tag: 'input', label: 'City', value: 'Birch' }] };
    const after = { elements: [{ index: 9, tag: 'input', label: 'City', value: 'Cedar' }] };
    const diff = diffPageActionSnapshots(before, after);
    expect(diff.changes).toEqual([{ index: 9, kind: 'changed', sensitive: false }]);
    expect(JSON.stringify(diff)).not.toMatch(/Birch|Cedar/);
    expect(
      diffPageActionSnapshots(
        { elements: [{ ...before.elements[0], sensitive: true }] },
        { elements: [{ ...after.elements[0], sensitive: true }] }
      ).changedCount
    ).toBe(0);
  });

  it('validates set-value and append without widening input bounds', () => {
    expect(
      normalizePageActionArgs('page_set_value', { snapshotId: 's', index: 20, value: '2026-10-05' })
    ).toMatchObject({ valid: true, value: { value: '2026-10-05' } });
    expect(
      normalizePageActionArgs('page_set_value', { snapshotId: 's', index: 20, value: {} }).valid
    ).toBe(false);
    expect(
      normalizePageActionArgs('page_input', {
        snapshotId: 's',
        index: 20,
        text: 'more',
        mode: 'append',
      })
    ).toMatchObject({ valid: true, value: { mode: 'append' } });
    expect(
      normalizePageActionArgs('page_input', {
        snapshotId: 's',
        index: 20,
        text: 'more',
        mode: 'javascript',
      }).valid
    ).toBe(false);
  });

  it('requires a snapshot for element-scoped scroll', () => {
    expect(normalizePageActionArgs('page_scroll', { index: 500 }).valid).toBe(false);
    expect(
      normalizePageActionArgs('page_scroll', { snapshotId: 's', index: 500, direction: 'down' })
    ).toMatchObject({ valid: true, value: { snapshotId: 's', index: 500 } });
  });

  it('preserves bounded declared postconditions and never lets a malformed one block an action', () => {
    for (const action of ['page_click', 'page_input', 'page_keypress']) {
      const args = {
        snapshotId: 's',
        index: 0,
        key: 'Enter',
        text: 'Cedar',
        expect: { type: 'text_appears', text: 'Found Cedar' },
      };
      expect(normalizePageActionArgs(action, args)).toMatchObject({
        valid: true,
        value: { expect: args.expect },
      });
      // An unsupported postcondition is omitted; the action itself still runs.
      const unsupported = normalizePageActionArgs(action, {
        ...args,
        expect: { type: 'execute_script' },
      });
      expect(unsupported.valid).toBe(true);
      expect(unsupported.value.expect).toBeUndefined();
      // The same optional evidence accepts the common flattened spelling that
      // models actually send (`expect: { type, text_appears }`).
      expect(
        normalizePageActionArgs(action, {
          ...args,
          expect: { type: 'text_appears', text_appears: 'Found Cedar' },
        })
      ).toMatchObject({
        valid: true,
        value: { expect: { type: 'text_appears', text: 'Found Cedar' } },
      });
    }
  });

  it('surfaces invalid state and bounded error text without leaking values', () => {
    const element = normalizePageElement({
      tag: 'input',
      label: 'Email',
      value: 'not-an-email',
      invalid: true,
      error: 'Enter a valid email address.',
    });
    expect(element.invalid).toBe(true);
    expect(element.error).toBe('Enter a valid email address.');
    const long = normalizePageElement({
      tag: 'input',
      label: 'Email',
      invalid: true,
      error: 'x'.repeat(400),
    });
    expect(long.error).toHaveLength(160);
    const sensitive = normalizePageElement({
      tag: 'input',
      label: 'Password',
      type: 'password',
      invalid: true,
      error: 'Password is required.',
    });
    expect(sensitive.sensitive).toBe(true);
    expect(sensitive.value).toBeUndefined();
  });

  it('preserves bounded form notices for live regions and field errors', () => {
    const snapshot = normalizePageSnapshot({
      snapshotId: 'notices',
      content: 'form',
      elements: [{ index: 0, tag: 'input', label: 'Email' }],
      formNotices: [
        { kind: 'alert', text: "Couldn't find your account." },
        { kind: 'status', text: 'Saved.' },
      ],
    });
    expect(snapshot.formNotices).toHaveLength(2);
    expect(snapshot.formNotices[0]).toMatchObject({
      kind: 'alert',
      text: "Couldn't find your account.",
    });
  });

  it('masks error text on sensitive controls and keeps only bounded notices', () => {
    const sensitive = normalizePageElement({
      tag: 'input',
      label: 'Password',
      type: 'password',
      sensitive: true,
      invalid: true,
      error: 'Password must contain 3 digits.',
    });
    expect(sensitive.invalid).toBe(true);
    expect(sensitive.error).toBeUndefined();
    expect(formatPageElement({ ...sensitive, index: 0 })).not.toContain('3 digits');
    expect(formatPageElement({ ...sensitive, index: 0 })).toContain('invalid=true');

    const snapshot = normalizePageSnapshot({
      snapshotId: 'notice-bounds',
      content: 'form',
      elements: [],
      formNotices: [
        { kind: 'alert', text: 'x'.repeat(500) },
        ...Array.from({ length: 12 }, (_, index) => ({
          kind: 'status',
          text: `notice ${index}`,
        })),
      ],
    });
    expect(snapshot.formNotices).toHaveLength(8);
    expect(snapshot.formNotices[0].text).toHaveLength(200);
  });
});
