/**
 * @fileoverview Merges bounded frame snapshots and routes merged indices back to their source frame.
 * @module PageFrameSnapshots
 */

import { ACT_PAGE_DOM_CAPS } from './ActLimits.js';

/**
 * Create run-scoped storage for merged frame snapshots and their local routes.
 * @returns {{ merge: Function, resolveRoute: Function, mapFindTextIndices: Function, deleteRun: Function }}
 */
export const createPageFrameSnapshots = () => {
  const snapshotsByRun = new Map();

  const merge = (runId, frameSnapshots, omittedFrameCount = 0) => {
    const topFrame = frameSnapshots.find((frame) => frame.isTop) || frameSnapshots[0];
    if (!topFrame?.snapshot) return null;
    const snapshotId = `frames-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const elements = [];
    const routes = Object.create(null);
    const contentParts = [];
    let contentPartsChars = 0;
    const addContentPart = (part) => {
      contentParts.push(part);
      contentPartsChars += part.length;
    };
    let valueBudget = ACT_PAGE_DOM_CAPS.maxTotalValueChars;
    let topFrameRemap = null;
    for (const [frameIndex, frame] of frameSnapshots.entries()) {
      const local = frame.snapshot;
      if (!local) continue;
      // Frame-local IDs can differ from the merged positional indices, so
      // remap both rendered markers and action routes from the same source.
      const markerRemap = new Map();
      for (const element of Array.isArray(local.elements) ? local.elements : []) {
        if (elements.length >= ACT_PAGE_DOM_CAPS.maxElements) break;
        const index = elements.length;
        if (Number.isInteger(element?.index) && !markerRemap.has(element.index)) {
          markerRemap.set(element.index, index);
        }
        const mapped = {
          ...element,
          index,
          elementKey: `${snapshotId}:${index}`.slice(0, 64),
          frameOrigin: frame.origin,
        };
        if (typeof mapped.value === 'string') {
          mapped.value = mapped.value.slice(0, valueBudget);
          valueBudget -= mapped.value.length;
        }
        elements.push(mapped);
        routes[index] = {
          frameId: frame.frameId,
          snapshotId: local.snapshotId,
          index: element.index,
          elementKey: element.elementKey,
        };
      }
      if (frame.isTop) topFrameRemap = markerRemap;
      // Rewrite only record markers; bracketed prose and control text stay intact.
      const frameContent = String(local.content || '')
        .split('\n')
        .map((line) =>
          line.replace(/^(\s*)\[(\d+)\](?=\s<)/, (match, indent, digits) => {
            const remapped = markerRemap.get(Number(digits));
            return remapped === undefined ? match : `${indent}[${remapped}]`;
          })
        )
        .join('\n');
      addContentPart(
        `Frame ${frameIndex + 1} — ${frame.isTop ? 'main page' : frame.origin}\n${frameContent}`
      );
    }
    if (omittedFrameCount > 0) {
      addContentPart(
        `${omittedFrameCount} embedded frame${omittedFrameCount === 1 ? '' : 's'} omitted by safety policy.`
      );
    }
    let content = '';
    for (const part of contentParts) {
      const separator = content ? '\n\n' : '';
      content += `${separator}${part}`.slice(
        0,
        Math.max(0, ACT_PAGE_DOM_CAPS.maxOutlineChars - content.length)
      );
      if (content.length >= ACT_PAGE_DOM_CAPS.maxOutlineChars) break;
    }
    const focusedFrame = frameSnapshots.find((frame) => frame.snapshot?.focusedElement);
    const focusedElement = focusedFrame?.snapshot?.focusedElement
      ? {
          ...focusedFrame.snapshot.focusedElement,
          elementKey: `${snapshotId}:focus`.slice(0, 64),
          frameOrigin: focusedFrame.origin,
        }
      : undefined;
    if (focusedFrame) {
      routes.focused = {
        frameId: focusedFrame.frameId,
        snapshotId: focusedFrame.snapshot.snapshotId,
        index: focusedFrame.snapshot.focusedElement.index,
        elementKey: focusedFrame.snapshot.focusedElement.elementKey,
      };
    }
    const mergedRegions = Array.isArray(topFrame.snapshot.regions)
      ? topFrame.snapshot.regions
          .map((region) => ({
            ...region,
            indices: (Array.isArray(region?.indices) ? region.indices : [])
              .map((value) => topFrameRemap?.get(Number(value)))
              .filter((value) => Number.isInteger(value)),
          }))
          .filter((region) => region.indices.length > 0)
      : [];
    const merged = {
      ...topFrame.snapshot,
      snapshotId,
      content,
      elements,
      ...(focusedElement ? { focusedElement } : { focusedElement: undefined }),
      regions: mergedRegions,
      truncated:
        contentPartsChars > content.length || elements.length >= ACT_PAGE_DOM_CAPS.maxElements,
    };
    snapshotsByRun.set(runId, { snapshotId, routes });
    return merged;
  };

  const resolveRoute = (runId, args = {}) => {
    const frameMap = snapshotsByRun.get(runId);
    const isCurrentSnapshot = args.snapshotId === frameMap?.snapshotId;
    const route = !isCurrentSnapshot
      ? null
      : Number.isInteger(args.index)
        ? frameMap.routes[args.index] || null
        : args.focused === true
          ? frameMap.routes.focused || null
          : null;
    return { isCurrentSnapshot, route };
  };

  const mapFindTextIndices = (runId, result) => {
    if (!result || typeof result !== 'object') return result;
    const map = snapshotsByRun.get(runId);
    const sourceIndices = Array.isArray(result.elementIndices) ? result.elementIndices : [];
    const localSnapshotId = result.snapshotId;
    const mappedIndices = [];
    if (localSnapshotId && map?.routes) {
      const topFrameIndices = new Map();
      for (const [mergedIndex, route] of Object.entries(map.routes)) {
        if (route.frameId === 0 && route.snapshotId === localSnapshotId) {
          topFrameIndices.set(route.index, Number(mergedIndex));
        }
      }
      for (const localIndex of sourceIndices) {
        const mergedIndex = topFrameIndices.get(localIndex);
        if (mergedIndex !== undefined) mappedIndices.push(mergedIndex);
      }
    }
    const safeResult = { ...result };
    delete safeResult.snapshotId;
    return {
      ...safeResult,
      ...(map?.snapshotId ? { snapshotId: map.snapshotId } : {}),
      ...(Array.isArray(result.elementIndices) ? { elementIndices: mappedIndices } : {}),
      ...(sourceIndices.length
        ? {
            message: mappedIndices.length
              ? String(result.message || '').replace(
                  /Matching control indices: [^.]+/,
                  `Matching control indices: ${mappedIndices.join(', ')}`
                )
              : 'Found page text, but no matching control index is available in the current merged snapshot. Inspect the page again before acting.',
          }
        : {}),
    };
  };

  return {
    merge,
    resolveRoute,
    mapFindTextIndices,
    deleteRun: (runId) => snapshotsByRun.delete(runId),
  };
};
