/**
 * @fileoverview Compact model-facing Act results, preserving internal snapshot evidence.
 * @module pageActionResult
 */

import { sanitizePageActionUrl } from './pageDom.js';

const MIND2WEB_CONTROL_INDEX_LIMIT = 32;
const MIND2WEB_ACTION_INDEX_LIMIT = 64;
const MIND2WEB_CONTROL_LINE_LIMIT = 320;
const MIND2WEB_CONTENT_LIMIT = 32_000;

function isMalformedMind2WebControl(element) {
  const value = String(element?.value || '');
  return /<[^>]+>\s*(?:Image is not internal|Cannot convert SVG to code)/iu.test(value);
}

function compactResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const compact = { ...result };
  if (result.snapshot) {
    const snapshot = result.snapshot;
    const links = (Array.isArray(snapshot.elements) ? snapshot.elements : [])
      .filter((element) => typeof element?.href === 'string')
      .slice(0, 32)
      .map((element) => ({
        index: element.index,
        label: String(element.label || element.text || 'link').slice(0, 120),
        href: sanitizePageActionUrl(element.href),
        opensNewTab: String(element.target || '').toLowerCase() === '_blank',
      }))
      .filter((link) => /^https?:\/\//i.test(link.href));
    compact.snapshot = {
      snapshotId: snapshot.snapshotId,
      url: snapshot.url,
      title: snapshot.title,
      header: snapshot.header,
      content: snapshot.content,
      readableContent: snapshot.readableContent,
      scroll: snapshot.scroll,
      scrollContainers: snapshot.scrollContainers,
      formNotices: snapshot.formNotices,
      routeChanged: snapshot.routeChanged,
      regions: snapshot.regions?.map(({ id, elementCount }) => ({ id, elementCount })),
      focusedElement: snapshot.focusedElement,
      truncated: snapshot.truncated,
      links,
    };
  }
  if (Array.isArray(result.results)) compact.results = result.results.map(compactResult);
  return compact;
}

/** Serialize a tool result without duplicate snapshot controls or internal metrics. */
export function serializePageActionResult(result) {
  if (typeof result === 'string') return result;
  return JSON.stringify(
    result?.result ? { ...result, result: compactResult(result.result) } : compactResult(result)
  );
}

/** Serialize an eval-only page result with a bounded index of observed editable controls. */
export function serializeMind2WebPageActionResult(result) {
  if (typeof result === 'string') return result;
  const serialized = result?.result
    ? { ...result, result: compactResult(result.result) }
    : compactResult(result);
  const sourceSnapshot = result?.result?.snapshot || result?.snapshot;
  const modelSnapshot = serialized?.result?.snapshot || serialized?.snapshot;
  if (!sourceSnapshot || !modelSnapshot || !Array.isArray(sourceSnapshot.elements))
    return JSON.stringify(serialized);

  const editable = sourceSnapshot.elements.filter((element) => {
    const tag = String(element?.tag || '').toLowerCase();
    return (
      element?.sensitive !== true &&
      !isMalformedMind2WebControl(element) &&
      (['input', 'textarea', 'select'].includes(tag) || element?.editable === true)
    );
  });
  const actionable = sourceSnapshot.elements.filter((element) => {
    if (element?.sensitive === true || isMalformedMind2WebControl(element)) return false;
    const tag = String(element?.tag || '').toLowerCase();
    const role = String(element?.role || '').toLowerCase();
    return (
      ['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag) ||
      ['button', 'link', 'option', 'menuitem', 'tab', 'checkbox', 'radio', 'switch'].includes(role)
    );
  });
  if (editable.length === 0 && actionable.length === 0) return JSON.stringify(serialized);

  const linkControls = actionable.filter(
    (element) => String(element?.tag || '').toLowerCase() === 'a'
  );
  const sectionAndMenuControls = actionable.filter((element) => {
    const tag = String(element?.tag || '').toLowerCase();
    const label = String(element?.label || element?.text || '').trim();
    const normalizedLabel = label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const matchingChild =
      tag === 'button' &&
      normalizedLabel.length > 2 &&
      linkControls.some((link) => {
        const linkIndex = Number(link.index);
        if (linkIndex <= Number(element.index) || linkIndex > Number(element.index) + 12)
          return false;
        const childLabel = String(link?.label || link?.text || '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
        return childLabel.includes(normalizedLabel);
      });
    return (
      matchingChild ||
      Boolean(element?.haspopup) ||
      element?.expanded === false ||
      /^(open|show)\b.*\b(menu|navigation)\b/iu.test(label)
    );
  });
  const sectionAndMenuIndexes = new Set(sectionAndMenuControls.map((element) => element.index));
  const remainingActionable = actionable.filter(
    (element) => !sectionAndMenuIndexes.has(element.index)
  );
  const malformedIndexes = new Set(
    sourceSnapshot.elements
      .filter(isMalformedMind2WebControl)
      .map((element) => Number(element.index))
  );
  const outlineLines = String(sourceSnapshot.content || '').split('\n');
  const cleanOutline = outlineLines.filter((line) => {
    const match = /^\s*\[(\d+)\] </u.exec(line);
    return !match || !malformedIndexes.has(Number(match[1]));
  });
  const outlineDepths = new Map();
  for (const line of cleanOutline) {
    const match = /^(\s*)\[(\d+)\] </u.exec(line);
    if (match) outlineDepths.set(Number(match[2]), Math.floor(match[1].length / 2));
  }

  const describe = (element, keys) => {
    const attributes = keys
      .map((key) => {
        const rawValue = element?.[key];
        if (typeof rawValue === 'boolean') return `${key}=${rawValue}`;
        const value = String(rawValue || '')
          .replace(/[\u0000-\u001f\u007f]/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, 96);
        return value ? `${key}=${JSON.stringify(value)}` : '';
      })
      .filter(Boolean)
      .join(' ');
    const outlineDepth = outlineDepths.get(Number(element.index));
    const depthAttribute = Number.isInteger(outlineDepth) ? `depth=${outlineDepth}` : '';
    const serializedAttributes = [attributes, depthAttribute].filter(Boolean).join(' ');
    return `[${Number(element.index)}] <${String(element.tag || 'input').toLowerCase()}${
      serializedAttributes ? ` ${serializedAttributes}` : ''
    }>`.slice(0, MIND2WEB_CONTROL_LINE_LIMIT);
  };
  const editableLines = editable
    .slice(0, MIND2WEB_CONTROL_INDEX_LIMIT)
    .map((element) => describe(element, ['role', 'name', 'type', 'label', 'placeholder', 'title']));
  const sectionAndMenuLines = sectionAndMenuControls
    .slice(0, MIND2WEB_CONTROL_INDEX_LIMIT)
    .map((element) =>
      describe(element, [
        'role',
        'haspopup',
        'expanded',
        'disabled',
        'label',
        'name',
        'title',
        'text',
        'resultContext',
      ])
    );
  const actionableLines = remainingActionable
    .slice(0, MIND2WEB_ACTION_INDEX_LIMIT)
    .map((element) =>
      describe(element, [
        'role',
        'haspopup',
        'expanded',
        'current',
        'selected',
        'disabled',
        'label',
        'name',
        'title',
        'text',
        'resultContext',
      ])
    );
  const inventory = [
    ...(editableLines.length
      ? [
          'EDITABLE CONTROLS (observed; indexes match the page outline):',
          ...editableLines,
          ...(editable.length > editableLines.length
            ? [
                `At least ${editable.length - editableLines.length} more editable controls were omitted.`,
              ]
            : []),
          '',
        ]
      : []),
    ...(sectionAndMenuLines.length
      ? [
          'MENU AND MATCHING SECTION PARENTS (check these before leaf links when browsing):',
          ...sectionAndMenuLines,
          ...(sectionAndMenuControls.length > sectionAndMenuLines.length
            ? [
                `At least ${sectionAndMenuControls.length - sectionAndMenuLines.length} more menu/section parents were omitted.`,
              ]
            : []),
          '',
        ]
      : []),
    ...(actionableLines.length
      ? [
          'ACTIONABLE CONTROLS (observed; indexes match the page outline):',
          ...actionableLines,
          ...(actionable.length > actionableLines.length
            ? [
                `At least ${actionable.length - actionableLines.length} more actionable controls were omitted.`,
              ]
            : []),
          '',
        ]
      : []),
    'FULL PAGE OUTLINE:',
    cleanOutline.join('\n'),
  ].join('\n');
  const decisionGuide =
    'MIND2WEB DECISION: Predict the next annotated step, not the shortest route to completion. ' +
    'For browsing, lower depth is the parent; open a relevant matching section parent or an “Open/Show … menu” control before its child link. ' +
    'For search, use an observed field only when its label accepts the requested entity. For input, ' +
    'follow the field label: a city/point-of-interest field gets the city; otherwise keep a task-supplied ' +
    'state as its USPS two-letter code.';
  const inventoryLimit = MIND2WEB_CONTENT_LIMIT - decisionGuide.length - 2;
  modelSnapshot.content = `${inventory.slice(0, inventoryLimit).trimEnd()}\n\n${decisionGuide}`;
  return JSON.stringify(serialized);
}
