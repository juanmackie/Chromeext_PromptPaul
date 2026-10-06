/**
 * @fileoverview Compact model-facing Act results, preserving internal snapshot evidence.
 * @module pageActionResult
 */

function compactResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const compact = { ...result };
  if (result.snapshot) {
    const snapshot = result.snapshot;
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
