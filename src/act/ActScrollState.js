/**
 * @fileoverview Stable identities and movement checks for Act scrolling.
 * @module ActScrollState
 */

import { pageStateHash } from '../utils/pageDom.js';

/** Serialize bounded viewport and container positions for a snapshot. */
export function pageScrollPositionKey(snapshot) {
  if (!snapshot) return '';
  return JSON.stringify({
    window: { x: snapshot.scroll?.x ?? null, y: snapshot.scroll?.y ?? null },
    containers: (snapshot.scrollContainers || []).map((entry) => ({
      index: entry.index,
      top: entry.top,
      left: entry.left,
    })),
  });
}

/** Hash the page state and position to detect repeated no-progress scrolls. */
export function pageScrollStateKey(snapshot) {
  if (!snapshot) return '';
  return pageStateHash(
    JSON.stringify({
      fingerprint: snapshot.fingerprint || '',
      routeId: snapshot.routeId || '',
      position: pageScrollPositionKey(snapshot),
    })
  );
}

/** Hash a route and position for the run-local visited-position set. */
export function pageScrollVisitKey(snapshot) {
  if (!snapshot) return '';
  return pageStateHash(
    JSON.stringify({
      routeId: snapshot.routeId || '',
      position: pageScrollPositionKey(snapshot),
    })
  );
}

/** Hash the current document and route for scroll-stall recovery. */
export function pageScrollLocationKey(run) {
  return pageStateHash(
    JSON.stringify({
      documentUrl: run?.pageActions?.documentUrl || '',
      routeId: run?.pageActions?.snapshot?.routeId || '',
    })
  );
}

/** Return whether the viewport or an observed scroll container moved. */
export function hasObservedPageScrollMovement(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot || !nextSnapshot) return false;
  const previousPositions = new Map(
    (previousSnapshot.scrollContainers || []).map((entry) => [entry.index, [entry.top, entry.left]])
  );
  const nextPositions = new Map(
    (nextSnapshot.scrollContainers || []).map((entry) => [entry.index, [entry.top, entry.left]])
  );
  if (
    previousSnapshot.scroll?.x !== nextSnapshot.scroll?.x ||
    previousSnapshot.scroll?.y !== nextSnapshot.scroll?.y
  ) {
    return true;
  }
  for (const [index, position] of previousPositions) {
    const nextPosition = nextPositions.get(index);
    if (nextPosition && (position[0] !== nextPosition[0] || position[1] !== nextPosition[1])) {
      return true;
    }
  }
  return false;
}
