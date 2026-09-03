/**
 * @fileoverview Bounded indexed page-region and snapshot-diff measurements.
 * @module pageActionScopeDiff
 */

import { utf8ByteLength } from './pageDom.js';

export const PAGE_SCOPE_DIFF_CAPS = Object.freeze({
  maxRegions: 12,
  maxElementsPerRegion: 32,
  maxChanges: 64,
});

function boundedText(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f]/gu, '') // eslint-disable-line no-control-regex
    .trim()
    .slice(0, maxLength);
}

function boundedNumber(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function safeElementMetadata(element, index) {
  return {
    index: boundedNumber(element?.index, index),
    tag: boundedText(element?.tag, 32),
    role: boundedText(element?.role, 48),
    label: boundedText(element?.label || element?.name || element?.tag, 120),
    region: boundedText(element?.region || element?.section || '', 80),
  };
}

/**
 * Create model-safe indexed regions from semantic metadata already present in a
 * snapshot. The fallback uses stable element bands. It never accepts selectors.
 * @param {object} snapshot
 * @param {object} [limits]
 * @returns {Array<{id: string, label: string, indices: number[], elementCount: number}>}
 */
export function buildIndexedPageRegions(snapshot = {}, limits = {}) {
  const maxRegions = Math.min(
    PAGE_SCOPE_DIFF_CAPS.maxRegions,
    Math.max(1, Number(limits.maxRegions) || PAGE_SCOPE_DIFF_CAPS.maxRegions)
  );
  const maxElementsPerRegion = Math.min(
    PAGE_SCOPE_DIFF_CAPS.maxElementsPerRegion,
    Math.max(1, Number(limits.maxElementsPerRegion) || PAGE_SCOPE_DIFF_CAPS.maxElementsPerRegion)
  );
  const groups = new Map();
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
  elements.slice(0, maxRegions * maxElementsPerRegion).forEach((element, index) => {
    const metadata = safeElementMetadata(element, index);
    const band = Math.floor(index / maxElementsPerRegion);
    const key = metadata.region || `band-${band}`;
    if (!groups.has(key) && groups.size < maxRegions) groups.set(key, []);
    const group = groups.get(key);
    if (group && group.length < maxElementsPerRegion) group.push(metadata.index);
  });

  return Array.from(groups.values()).map((indices, index) => ({
    id: `region-${index}`,
    indices: [...new Set(indices)].slice(0, maxElementsPerRegion),
    elementCount: Math.min(indices.length, maxElementsPerRegion),
  }));
}

function comparableElement(element, index) {
  const metadata = safeElementMetadata(element, index);
  return {
    ...metadata,
    disabled: element?.disabled === true,
    checked: typeof element?.checked === 'boolean' ? element.checked : null,
    valuePresent: element?.valuePresent === true,
    sensitive: element?.sensitive === true,
  };
}

/**
 * Compare two bounded snapshots without returning page text, values, or
 * selectors. The result is suitable for evaluation metrics, not authentication.
 * @param {object} before
 * @param {object} after
 * @param {object} [limits]
 * @returns {object}
 */
export function diffPageActionSnapshots(before = {}, after = {}, limits = {}) {
  const maxChanges = Math.min(
    PAGE_SCOPE_DIFF_CAPS.maxChanges,
    Math.max(1, Number(limits.maxChanges) || PAGE_SCOPE_DIFF_CAPS.maxChanges)
  );
  const beforeElements = Array.isArray(before.elements) ? before.elements : [];
  const afterElements = Array.isArray(after.elements) ? after.elements : [];
  const indices = new Set([
    ...beforeElements.map((element, index) => boundedNumber(element?.index, index)),
    ...afterElements.map((element, index) => boundedNumber(element?.index, index)),
  ]);
  const beforeByIndex = new Map(
    beforeElements.map((element, index) => [
      boundedNumber(element?.index, index),
      comparableElement(element, index),
    ])
  );
  const afterByIndex = new Map(
    afterElements.map((element, index) => [
      boundedNumber(element?.index, index),
      comparableElement(element, index),
    ])
  );
  const changes = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    const previous = beforeByIndex.get(index) || null;
    const current = afterByIndex.get(index) || null;
    if (JSON.stringify(previous) === JSON.stringify(current)) continue;
    changes.push({
      index,
      kind: !previous ? 'added' : !current ? 'removed' : 'changed',
      sensitive: Boolean(previous?.sensitive || current?.sensitive),
    });
  }
  return {
    beforeSnapshotId: boundedText(before.snapshotId, 128),
    afterSnapshotId: boundedText(after.snapshotId, 128),
    requiresFreshSnapshot: String(before.snapshotId || '') !== String(after.snapshotId || ''),
    fingerprintChanged: String(before.fingerprint || '') !== String(after.fingerprint || ''),
    changedCount: changes.length,
    changes: changes.slice(0, maxChanges),
    truncated: changes.length > maxChanges,
  };
}

/**
 * Measure bounded payload sizes for an evaluation case. This does not send or
 * retain the page payload.
 * @param {object} snapshot
 * @param {object} diff
 * @returns {{fullSnapshotBytes: number, regionBytes: number, diffBytes: number}}
 */
export function measurePageActionScopeDiff(snapshot = {}, diff = {}) {
  const regions = buildIndexedPageRegions(snapshot);
  return {
    fullSnapshotBytes: utf8ByteLength(JSON.stringify(snapshot)),
    regionBytes: utf8ByteLength(JSON.stringify(regions)),
    diffBytes: utf8ByteLength(JSON.stringify(diff)),
  };
}
