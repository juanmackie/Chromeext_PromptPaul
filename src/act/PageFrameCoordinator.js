/**
 * @fileoverview Coordinates safe frame discovery, snapshot collection, and run-local frame routing.
 * @module PageFrameCoordinator
 */

import { ACT_FRAME_CAPS } from './ActLimits.js';
import { createPageFrameSnapshots } from './PageFrameSnapshots.js';

/**
 * @param {object} adapters Browser and page-action operations supplied by the service worker.
 * @returns {object} Run-scoped frame coordination operations.
 */
export const createPageFrameCoordinator = ({
  chrome,
  getCurrentPageSupport,
  getPageActionSiteOrigin,
  sendPageActionMessage,
  injectPageActionFrameScriptsInFrames,
  messageTimeoutMs,
}) => {
  const snapshots = createPageFrameSnapshots();

  const getFrameDescriptors = async (tabId) => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const parsed = new URL(location.href);
          return {
            origin: /^https?:$/u.test(parsed.protocol) ? parsed.origin : '',
            title: String(document.title || '').slice(0, 120),
            frameTitle: String(window.frameElement?.getAttribute('title') || '').slice(0, 120),
            frameName: String(window.name || '').slice(0, 120),
            isTop: window === window.top,
          };
        },
      });
      return (Array.isArray(results) ? results : [])
        .filter((entry) => Number.isInteger(entry.frameId) && entry.result?.origin)
        .map((entry) => {
          const origin = String(entry.result.origin).slice(0, 256);
          let hostname = '';
          try {
            hostname = new URL(origin).hostname;
          } catch (_) {
            return null;
          }
          const paymentFrame =
            /stripe|paypal|adyen|braintree|checkout\.com|worldpay|squareup/i.test(hostname) ||
            /payment|checkout|card|billing/i.test(
              `${String(entry.result.title || '')} ${String(entry.result.frameTitle || '')} ${String(entry.result.frameName || '')}`
            );
          return {
            frameId: entry.frameId,
            documentId: typeof entry.documentId === 'string' ? entry.documentId : '',
            origin,
            isTop: entry.frameId === 0,
            restricted: !getCurrentPageSupport(origin).available,
            paymentFrame,
          };
        })
        .filter(Boolean)
        .sort((a, b) => Number(b.isTop) - Number(a.isTop) || a.frameId - b.frameId);
    } catch (_) {
      return [];
    }
  };

  const collectSnapshots = async ({ tabId, runId, blockedOrigins, signal, topResponse = null }) => {
    const allDescriptors = await getFrameDescriptors(tabId);
    const descriptors = allDescriptors.slice(0, ACT_FRAME_CAPS.maxFrames);
    const frames = [];
    let omittedFrameCount = Math.max(0, allDescriptors.length - descriptors.length);
    const eligibleFrames = descriptors.filter((frame) => {
      if (frame.restricted || frame.paymentFrame || blockedOrigins.includes(frame.origin)) {
        omittedFrameCount += 1;
        return false;
      }
      if (frame.isTop && topResponse?.snapshot) {
        if (getPageActionSiteOrigin(topResponse.snapshot.url || '') === frame.origin) {
          frames.push({ ...frame, snapshot: topResponse.snapshot });
        } else {
          omittedFrameCount += 1;
        }
        return false;
      }
      return true;
    });
    const requestFrameState = (frame) =>
      sendPageActionMessage(
        tabId,
        {
          action: 'pageAction',
          runId,
          pageAction: 'page_get_state',
          args: {},
          blockedOrigins,
        },
        signal,
        messageTimeoutMs,
        frame.frameId
      );
    const childResponses = await Promise.all(
      eligibleFrames.map(async (frame) => {
        try {
          return { frame, response: await requestFrameState(frame), error: null };
        } catch (error) {
          return { frame, response: null, error };
        }
      })
    );
    const missingBridges = childResponses.filter(
      ({ error }) => error?.code === 'PAGE_ACTION_MESSAGE_FAILED'
    );
    if (missingBridges.length && !signal?.aborted) {
      const currentFrames = new Map(
        (await getFrameDescriptors(tabId)).map((frame) => [frame.frameId, frame])
      );
      const recoverable = missingBridges.flatMap(({ frame }) => {
        const current = currentFrames.get(frame.frameId);
        if (
          !current ||
          current.origin !== frame.origin ||
          !current.documentId ||
          current.restricted ||
          current.paymentFrame ||
          blockedOrigins.includes(current.origin)
        )
          return [];
        return [current];
      });
      const injectedFrames = await injectPageActionFrameScriptsInFrames(tabId, recoverable);
      if (injectedFrames.size) {
        const recovered = await Promise.all(
          recoverable
            .filter((frame) => injectedFrames.has(frame.frameId))
            .map(async (frame) => {
              try {
                return { frame, response: await requestFrameState(frame) };
              } catch (_) {
                return { frame, response: null };
              }
            })
        );
        const recoveredByFrameId = new Map(recovered.map((item) => [item.frame.frameId, item]));
        for (let index = 0; index < childResponses.length; index += 1) {
          const replacement = recoveredByFrameId.get(childResponses[index].frame.frameId);
          if (replacement) childResponses[index] = replacement;
        }
      }
    }
    for (const { frame, response } of childResponses) {
      const responseOrigin = getPageActionSiteOrigin(response?.snapshot?.url || '');
      if (
        response?.snapshot &&
        responseOrigin === frame.origin &&
        !blockedOrigins.includes(responseOrigin)
      ) {
        frames.push({ ...frame, snapshot: response.snapshot });
      } else omittedFrameCount += 1;
    }
    if (!frames.some((frame) => frame.isTop) && topResponse?.snapshot) {
      const origin = getPageActionSiteOrigin(topResponse.snapshot.url || '');
      if (origin && !blockedOrigins.includes(origin)) {
        frames.unshift({ frameId: 0, origin, isTop: true, snapshot: topResponse.snapshot });
      }
    }
    return snapshots.merge(runId, frames, omittedFrameCount);
  };

  return {
    getFrameDescriptors,
    collectSnapshots,
    resolveRoute: snapshots.resolveRoute,
    mapFindTextIndices: snapshots.mapFindTextIndices,
    deleteRun: snapshots.deleteRun,
  };
};
