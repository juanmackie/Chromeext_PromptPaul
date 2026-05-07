/**
 * @fileoverview Read strategy selection for page context extraction.
 * @module readStrategy
 */

export function determineReadStrategy(input) {
  if (input?.adapterMatched) return 'adapter';
  if (input?.hasCanvas) return 'hybrid';
  if (input?.hasVideo || input?.hasDenseInteractiveUi) return 'hybrid';
  if ((input?.textLength || 0) < 500 && (input?.imageCount || 0) > 0) return 'vision';
  return 'dom';
}
