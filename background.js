/**
 * @fileoverview Background Service Worker for Prompt Paul Chrome Extension
 *
 * This service worker handles:
 * - Context menu creation and click handling for text, image, video, and audio analysis
 * - Message routing between content scripts, side panel, and options page
 * - LLM API communication with streaming support
 * - Analytics tracking via Umami
 *
 * @module background
 * @requires ./src/utils/validation.js
 */

import { parseSkillMarkdown } from './src/utils/skillParser.js';
import { getCurrentPageSupport } from './src/utils/permissionGuards.js';
import {
  classifyRuntimeMessageError,
  friendlyRuntimeErrorMessage,
  isRuntimeMessageUndelivered,
} from './src/utils/runtimeErrors.js';
import {
  formatToolRequestError,
  isValidHttpUrl,
  MAX_TOOL_ARGUMENTS_BYTES,
  normalizeProfileRecord,
  normalizeToolHttpMethod,
} from './src/utils/validation.js';
import {
  getHermesEndpoint,
  getProfileToolSupport,
  resolvePreferredProfile,
} from './src/utils/profileRouting.js';
import { sanitizePageActionUrl } from './src/utils/pageDom.js';
import {
  createPageActionSitePolicyStore,
  getPageActionSiteOrigin,
} from './src/utils/pageActionSitePolicies.js';
import { CONTEXT_MENU_PROMPTS } from './src/prompts.js';
import { executeBraveSearch, BraveSearchError } from './src/utils/braveSearch.js';
import { executeKeylessSearch } from './src/utils/keylessSearch.js';
import { readBoundedResponseText } from './src/utils/streamSafety.js';
import { randomId } from './src/utils/ids.js';
import {
  isSafePublicHttpUrl,
  MEDIA_FETCH_TIMEOUT_MS,
  readMediaBlob,
} from './src/utils/mediaFetch.js';
import { waitForRetry } from './src/utils/retryBackoff.js';
import { createPageActionReadinessCache } from './src/utils/pageActionReadiness.js';
import { getPdfSourceUrl, isLikelyPdfUrl, probePdfUrl } from './src/utils/pdfDetection.js';
import { PageTabController } from './src/orchestrator/PageTabController.js';
import { ACT_FRAME_CAPS, ACT_PAGE_DOM_CAPS, createPageFrameSnapshots } from './src/act/index.js';
import { isPageActionReadOnly } from './src/utils/pageActionPolicy.js';
import { createCodexAuthManager } from './src/utils/codexAuth.js';
import { fetchAvailableModels } from './src/utils/modelDiscovery.js';
import { HermesTransport, supportsHermesClientTools } from './src/orchestrator/HermesTransport.js';
import { createKeyedOperationLock } from './src/utils/keyedOperationLock.js';
import { validateHermesKey, removeProfileHermesState } from './src/utils/hermesKeys.js';
import {
  clearPageActionCheckpoint,
  getPageActionCheckpoint,
} from './src/utils/pageActionCheckpoint.js';
import {
  isContentScriptSender,
  isExtensionSender,
  isRunOwner,
  requestMatchesSenderTab,
} from './src/utils/runtimeAuthorization.js';
import {
  clearDevDiagnostics,
  disableDevDiagnostics,
  enableDevDiagnostics,
  getDevDiagnostics,
  getDevDiagnosticsStatus,
  initializeDevDiagnostics,
  installDevErrorHandlers,
  recordDevDiagnostic,
  recordRemoteDevDiagnostic,
} from './src/utils/devDiagnostics.js';
import { registerEvalRunHook } from './src/utils/evalHook.js';
import {
  handleDevDiagnosticsMessage,
  handleExternalPanelMessage,
  handleImproveInstructionMessage,
  handleNotchMessage,
  handlePageActionMessage,
  handlePageContentMessage,
  handlePanelMessage,
  handleProviderMessage,
  handleRunMessage,
  handleSearchMessage,
  handleSkillMessage,
} from './src/background/index.js';

void initializeDevDiagnostics('background');
installDevErrorHandlers('background');
globalThis.promptPaulDevDiagnostics = {
  enable: enableDevDiagnostics,
  disable: disableDevDiagnostics,
  clear: clearDevDiagnostics,
  get: getDevDiagnostics,
};

// ===== Umami Analytics Module (privacy-first, opt-in) =====
const UMAMI_ENDPOINT = 'https://cloud.umami.is/api/send';
const UMAMI_WEBSITE_ID = 'd1b4d7cb-2e57-44ec-a91f-6692fb365a02';
const ANALYTICS_CONSENT_KEY = 'analyticsConsent';
const ANALYTICS_INSTANCE_KEY = 'analyticsInstance';
const ANALYTICS_ROTATE_AT_KEY = 'analyticsRotateAt';
const ANALYTICS_ROTATE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SAFE_LABEL_REGEX = /^[A-Za-z0-9._:-]{1,64}$/;
const DENYLIST = [
  'email',
  'token',
  'key',
  'password',
  'secret',
  'auth',
  'cookie',
  'session',
  'ssid',
];
const PENDING_PANEL_ACTION_KEY = 'pendingPanelAction';
const NOTCH_ACTIONS = new Set([
  'openChat',
  'openActions',
  'summarizePage',
  'prepareDictation',
  'explainSelection',
  'runPinnedInstruction',
  'sendInstruction',
  'openOptions',
]);
const NOTCH_MAX_SELECTION_CHARS = 20_000;
const NOTCH_MAX_PAGE_CHARS = 200_000;
const NOTCH_MAX_INSTRUCTION_CHARS = 20_000;
const NOTCH_DICTATION_LEASE_KEY = 'notchDictationPanelLease';
const NOTCH_DICTATION_LEASE_MS = 10 * 60 * 1000;
const activeNotchRunTabs = new Map();
const activeNotchDictationLeases = new Map();
const HERMES_API_KEYS_KEY = 'hermesApiKeys';
const HERMES_SESSIONS_KEY = 'hermesSessions';
const HERMES_SESSION_KEYS_KEY = 'hermesSessionKeys';
const hermesSessionResetLock = createKeyedOperationLock();
const hermesSessionKeyLock = createKeyedOperationLock();
const pageTabController = new PageTabController();
const codexAuthManager = createCodexAuthManager();
const hermesTransport = new HermesTransport({
  credentialProvider: getHermesCredential,
  sessionKeyProvider: getHermesSessionKey,
  sessionStore: {
    get: getHermesSession,
    set: setHermesSession,
    delete: async (profileId) => {
      const result = await chrome.storage.local.get(HERMES_SESSIONS_KEY);
      const sessions = { ...(result?.[HERMES_SESSIONS_KEY] || {}) };
      delete sessions[profileId];
      await chrome.storage.local.set({ [HERMES_SESSIONS_KEY]: sessions });
    },
  },
});

async function getHermesCredential(profileId) {
  const result = await chrome.storage.local.get(HERMES_API_KEYS_KEY);
  return result?.[HERMES_API_KEYS_KEY]?.[profileId] || '';
}

async function setHermesCredential(profileId, value) {
  const result = await chrome.storage.local.get(HERMES_API_KEYS_KEY);
  const keys = result?.[HERMES_API_KEYS_KEY] || {};
  keys[profileId] = value;
  await chrome.storage.local.set({ [HERMES_API_KEYS_KEY]: keys });
}

async function removeHermesCredential(profileId) {
  const result = await chrome.storage.local.get(HERMES_API_KEYS_KEY);
  const keys = { ...(result?.[HERMES_API_KEYS_KEY] || {}) };
  if (!(profileId in keys)) return;
  delete keys[profileId];
  await chrome.storage.local.set({ [HERMES_API_KEYS_KEY]: keys });
}

async function getHermesSession(profileId) {
  const result = await chrome.storage.local.get(HERMES_SESSIONS_KEY);
  return result?.[HERMES_SESSIONS_KEY]?.[profileId] || '';
}

async function setHermesSession(profileId, sessionRecord) {
  const result = await chrome.storage.local.get(HERMES_SESSIONS_KEY);
  const sessions = result?.[HERMES_SESSIONS_KEY] || {};
  sessions[profileId] = sessionRecord;
  await chrome.storage.local.set({ [HERMES_SESSIONS_KEY]: sessions });
}

async function getHermesSessionKey(profileId) {
  return hermesSessionKeyLock.run(profileId, async () => {
    const result = await chrome.storage.local.get(HERMES_SESSION_KEYS_KEY);
    const keys = { ...(result?.[HERMES_SESSION_KEYS_KEY] || {}) };
    if (keys[profileId]) return keys[profileId];
    const key = `prompt-paul-${randomId()}`.slice(0, 256);
    keys[profileId] = key;
    await chrome.storage.local.set({ [HERMES_SESSION_KEYS_KEY]: keys });
    return key;
  });
}

/**
 * Sanitizes a label string for safe use in analytics.
 * Removes potentially sensitive information and enforces character restrictions.
 * @param {string} v - The label value to sanitize.
 * @returns {string|undefined} The sanitized label, or undefined if invalid.
 */
function sanitizeLabel(v) {
  if (typeof v !== 'string') return undefined;
  let s = v.trim().toLowerCase();
  if (!s) return undefined;
  // quick deny if looks like an email or has spaces
  if (s.includes('@') || s.includes(' ')) return undefined;
  // denylisted keywords
  for (const k of DENYLIST) {
    if (s.includes(k)) return undefined;
  }
  // enforce charset and length
  if (!SAFE_LABEL_REGEX.test(s)) return undefined;
  return s;
}

/**
 * Retrieves environment information for analytics purposes.
 * @returns {Promise<{extVersion: string, platform: string, chromeMajor: string}>} Environment info object.
 */
async function getEnvInfo() {
  const manifest = chrome.runtime.getManifest();
  const extVersion = manifest?.version || '0.0.0';
  const platformInfo = await new Promise((resolve) => chrome.runtime.getPlatformInfo(resolve));
  let chromeMajor = '0';
  try {
    const ua = navigator.userAgent;
    const m = ua.match(/Chrome\/(\d+)/);
    if (m) chromeMajor = m[1];
  } catch (_) {
    // Platform detection is best-effort and must not block the extension.
  }
  return { extVersion, platform: platformInfo?.os || 'unknown', chromeMajor };
}

/**
 * Checks if the user has consented to analytics tracking.
 * Default is opt-in (consent = false until the user enables it).
 * @returns {Promise<boolean>} True if user has consented to analytics.
 */
async function getConsent() {
  const { [ANALYTICS_CONSENT_KEY]: consent } =
    await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
  return consent === true;
}

/**
 * Gets or creates a unique instance ID for analytics, rotating every 30 days.
 * @returns {Promise<string>} The instance identifier.
 */
async function getInstanceId() {
  const now = Date.now();
  const res = await chrome.storage.local.get([ANALYTICS_INSTANCE_KEY, ANALYTICS_ROTATE_AT_KEY]);
  let instance = res[ANALYTICS_INSTANCE_KEY];
  let rotateAt = res[ANALYTICS_ROTATE_AT_KEY];
  if (!instance || !rotateAt || now >= rotateAt) {
    instance = randomId();
    rotateAt = now + ANALYTICS_ROTATE_MS;
    await chrome.storage.local.set({
      [ANALYTICS_INSTANCE_KEY]: instance,
      [ANALYTICS_ROTATE_AT_KEY]: rotateAt,
    });
  }
  return instance;
}

/**
 * Sends an analytics event to the Umami analytics endpoint.
 * Only sends if user has consented to analytics.
 * @param {string} name - The event name/category.
 * @param {Object} [data] - Additional event data to include.
 * @returns {Promise<void>}
 */
async function sendUmamiEvent(name, data) {
  try {
    const consent = await getConsent();
    if (!consent) return;

    // Send richer segmentation to Umami so you can filter by instruction/model/tools directly.
    // Umami supports additional fields in the payload object such as event_name and data.
    // We keep name as a stable event category (e.g., "instruction_used") and also include
    // event_name set to the specific instruction for top-level segmentation.
    const payload = {
      type: 'event',
      payload: {
        website: UMAMI_WEBSITE_ID,
        hostname: 'extension',
        url: `/ext/usage/${data?.instruction || 'unknown'}`,
        referrer: '',
        name, // high-level category, e.g., "instruction_used"
        event_name: data?.instruction || name, // specific instruction or fallback to name
        data: {
          ...data,
          // Duplicate key fields at top-level-friendly keys for Umami dashboards
          instruction: data?.instruction || 'unknown',
          model: data?.model || 'unknown',
          tools: Array.isArray(data?.tools) ? data.tools : [],
        },
      },
    };
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(UMAMI_ENDPOINT, blob);
    } else {
      await fetch(UMAMI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch (e) {
    // never throw
    console.warn('Analytics send failed:', e);
  }
}

/**
 * Tracks an error event for analytics purposes.
 * @param {string} category - The error category.
 * @param {string} code - The error code.
 * @returns {Promise<void>}
 */
async function trackErrorEvent(category, code) {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  const cat = sanitizeLabel(category) || 'unknown';
  const c = sanitizeLabel(code) || 'unknown';
  await sendUmamiEvent('error_event', { ...env, instance, category: cat, code: c });
}

/**
 * Tracks when a custom instruction is used.
 * @param {Object} params - The tracking parameters.
 * @param {string} params.instruction - The instruction name.
 * @param {string} params.model - The model name used.
 * @param {Array<string>} [params.tools] - Array of tool names used.
 * @returns {Promise<void>}
 */
async function trackInstructionUsed({ instruction, model, tools }) {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  const instr = sanitizeLabel(instruction) || 'unknown';
  const mdl = sanitizeLabel(model) || 'unknown';
  const toolsSafe = Array.isArray(tools)
    ? tools
        .map((t) => sanitizeLabel(String(t)))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  // Put the instruction and model into the event "name" context via sendUmamiEvent enhancements above
  await sendUmamiEvent('instruction_used', {
    ...env,
    instance,
    instruction: instr,
    model: mdl,
    tools: toolsSafe,
    count: 1,
  });
}

// Listen for options page consent changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[ANALYTICS_CONSENT_KEY]) {
    // no-op, just acknowledge; future hook if batching is added
  }
});

/**
 * Queues a side-panel action when the panel is not ready yet.
 * @param {Object} payload - The action payload to preserve.
 * @returns {Promise<boolean>} True when the payload was queued.
 */
async function queuePendingPanelAction(payload) {
  if (!chrome.storage?.session) {
    return false;
  }

  try {
    await chrome.storage.session.set({
      [PENDING_PANEL_ACTION_KEY]: {
        ...payload,
        queuedAt: Date.now(),
      },
    });
    return true;
  } catch (error) {
    console.error('Background: Failed to queue pending side panel action:', error.message);
    return false;
  }
}

/**
 * Sends a payload to the side panel, with a session queue fallback if it is not ready.
 * @param {Object} payload - The runtime message payload.
 * @returns {Promise<{queuedFallback:boolean, response:any}>}
 */
async function sendPanelMessage(payload) {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 150;
  // Give the whole delivery chain one identity. A retry can race a delivery the
  // panel already accepted (another panel can answer "ignored" first), and the
  // queued fallback can duplicate a live message; a shared actionId lets the
  // panel discard the repeat instead of starting the action twice.
  const message = payload.actionId
    ? payload
    : { ...payload, actionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve({ response });
        });
      } catch (error) {
        resolve({ error: error.message });
      }
    });

    // A live panel can receive the message and still reject it when it belongs
    // to a different tab. Treat missing or rejected acknowledgements like a
    // delivery failure so the session queue can hand it to the target panel.
    if (!result.error && result.response && result.response.ignored !== true) {
      return { queuedFallback: false, response: result.response };
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  // All retries failed: queue for later consumption
  const queued = await queuePendingPanelAction(message);
  if (!queued) {
    console.warn(
      `Background: sendMessage (${payload.action}) failed after ${MAX_RETRIES + 1} attempts and queue fallback failed`
    );
  }
  return { queuedFallback: queued, response: null };
}

/**
 * Determines MIME type based on file extension in a URL.
 * @param {string} url - The URL of the media file.
 * @returns {string} The MIME type string (defaults to 'image/jpeg' if unknown).
 */
function getMimeTypeFromUrl(url) {
  try {
    // Handle query parameters and fragments
    const cleanUrl = url.split('?')[0].split('#')[0];
    const extension = cleanUrl.split('.').pop().toLowerCase();

    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
      mp4: 'video/mp4',
      webm: 'video/webm',
      ogg: 'video/ogg',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      flac: 'audio/flac',
    };

    const mimeType = mimeTypes[extension] || null;
    return mimeType;
  } catch (error) {
    console.error('Error determining MIME type:', error);
    return null;
  }
}

/**
 * Fetches media from a public URL and converts it to base64 encoding.
 * @param {string} url - The URL of the media to fetch.
 * @returns {Promise<{base64:string,mimeType:string}>} Base64 encoded string and MIME type.
 * @throws {Error} If the URL, fetch, or media size is invalid.
 */
async function fetchMediaAsBase64(url) {
  if (!isSafePublicHttpUrl(url)) throw new Error('Media URL must be a public HTTP(S) URL.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }

    const blob = await readMediaBlob(response);
    const mimeType = response.headers.get('content-type') || getMimeTypeFromUrl(url);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, mimeType });
      };
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(error);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Media request timed out.');
    console.error('Error fetching media:', error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const pageActionReadinessCache = createPageActionReadinessCache({ ttlMs: 60_000, maxEntries: 32 });
const extractionDependencyPromises = new Map();
const dynamicNotchScriptId = 'prompt-paul-notch';
const actFeedbackInjectionPromises = new Map();
const notchActMessageQueues = new Map();
let dynamicNotchSyncQueue = Promise.resolve();

const ensureExtractionDependencies = (tabId, documentUrl) => {
  const key = `${tabId}:${String(documentUrl || '').split(/[?#]/, 1)[0]}`;
  if (extractionDependencyPromises.has(key)) return extractionDependencyPromises.get(key);
  const promise = new Promise((resolve, reject) => {
    try {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['libs/readability.js', 'libs/turndown.js'] },
        () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message || 'Could not load extraction libraries.'));
          else resolve(true);
        }
      );
    } catch (error) {
      reject(error);
    }
  }).catch((error) => {
    extractionDependencyPromises.delete(key);
    throw error;
  });
  extractionDependencyPromises.set(key, promise);
  return promise;
};

const injectNotchIntoOpenTabs = async () => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id) && /^(?:https?:|file:)/u.test(tab.url || ''))
      .map(
        (tab) =>
          new Promise((resolve) => {
            chrome.scripting.executeScript(
              {
                target: { tabId: tab.id },
                files: ['content_script_diagnostics.js', 'content_script_notch.js'],
              },
              () => {
                void chrome.runtime.lastError;
                resolve();
              }
            );
          })
      )
  );
};

const notifyNotchPreference = async (enabled) => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map(
        (tab) =>
          new Promise((resolve) => {
            try {
              chrome.tabs.sendMessage(tab.id, { action: 'notchPreferenceChanged', enabled }, () => {
                void chrome.runtime.lastError;
                resolve();
              });
            } catch (_) {
              resolve();
            }
          })
      )
  );
};

const syncDynamicNotchScript = () => {
  const next = dynamicNotchSyncQueue
    .catch(() => {})
    .then(async () => {
      const preference = await chrome.storage.local.get(['notchEnabled']);
      const enabled = preference.notchEnabled === true;
      const registered = await chrome.scripting.getRegisteredContentScripts({
        ids: [dynamicNotchScriptId],
      });
      if (enabled) {
        if (!registered.length) {
          await chrome.scripting.registerContentScripts([
            {
              id: dynamicNotchScriptId,
              matches: ['<all_urls>'],
              js: ['content_script_diagnostics.js', 'content_script_notch.js'],
              allFrames: false,
              runAt: 'document_idle',
              persistAcrossSessions: true,
            },
          ]);
        }
        await injectNotchIntoOpenTabs();
      } else if (registered.length) {
        await chrome.scripting.unregisterContentScripts({ ids: [dynamicNotchScriptId] });
      }
      await notifyNotchPreference(enabled);
    });
  dynamicNotchSyncQueue = next.catch(() => {});
  return next;
};

function injectActFeedbackScript(tabId) {
  const existing = actFeedbackInjectionPromises.get(tabId);
  if (existing) return existing;
  let pending;
  pending = new Promise((resolve, reject) => {
    try {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content_script_act_feedback.js'] },
        () => {
          const error = chrome.runtime.lastError;
          if (error)
            reject(new Error(error.message || 'Could not load the Act activity indicator.'));
          else resolve();
        }
      );
    } catch (error) {
      reject(error);
    }
  }).catch((error) => {
    if (actFeedbackInjectionPromises.get(tabId) === pending) {
      actFeedbackInjectionPromises.delete(tabId);
    }
    throw error;
  });
  actFeedbackInjectionPromises.set(tabId, pending);
  return pending;
}

const markPageActionReadiness = async (tabId, documentUrl) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.status === 'loading') return false;
  } catch (_) {
    return false;
  }
  return pageActionReadinessCache.mark(tabId, documentUrl);
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || typeof changeInfo.url === 'string') {
    pageActionReadinessCache.invalidate(tabId);
    for (const key of extractionDependencyPromises.keys()) {
      if (key.startsWith(`${tabId}:`)) extractionDependencyPromises.delete(key);
    }
    actFeedbackInjectionPromises.delete(tabId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  pageActionReadinessCache.invalidate(tabId);
  actFeedbackInjectionPromises.delete(tabId);
  notchActMessageQueues.delete(tabId);
  for (const key of extractionDependencyPromises.keys()) {
    if (key.startsWith(`${tabId}:`)) extractionDependencyPromises.delete(key);
  }
});

// Enable the side panel on all pages
chrome.sidePanel.setOptions({ path: 'chat.html' }).catch((error) => console.error(error));

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.sidePanel
    .setOptions({
      tabId,
      path: 'chat.html',
      enabled: true,
    })
    .catch((error) => console.error(`Error setting side panel options for tab ${tabId}:`, error));
});

// Unified context menu click handler for all modalities
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Validate tab exists and has a valid ID (tab.id is -1 for side panel, devtools, chrome:// URLs)
  if (!info || typeof info !== 'object' || !tab || !Number.isInteger(tab.id) || tab.id < 0) {
    console.warn('Context menu invoked from invalid tab context - ignoring');
    return;
  }

  try {
    await openSidePanelForTab(tab.id, tab.windowId);

    // Detect media context
    const isMediaContext =
      info.mediaType === 'image' || info.mediaType === 'video' || info.mediaType === 'audio';
    const mediaUrl = typeof info.srcUrl === 'string' ? info.srcUrl.trim().slice(0, 2_048) : '';
    const mediaType = ['image', 'video', 'audio'].includes(info.mediaType)
      ? info.mediaType
      : 'text';

    // Normalize selection text to avoid undefined and unbounded payloads.
    let originalSelectionText = String(info.selectionText || '')
      .trim()
      .slice(0, NOTCH_MAX_SELECTION_CHARS);
    let promptContent = originalSelectionText;
    let promptContextType = isMediaContext
      ? originalSelectionText
        ? 'selected_text'
        : 'media'
      : originalSelectionText
        ? 'selected_text'
        : 'page_content';

    // Fetch tab content only if we have no media and no selection
    if (!isMediaContext && !originalSelectionText) {
      try {
        const tabDataResponse = await executeTabContentExtraction(tab.id);
        if (tabDataResponse && tabDataResponse.success) {
          promptContent = String(tabDataResponse.content || tabDataResponse.data || '')
            .trim()
            .slice(0, NOTCH_MAX_PAGE_CHARS);
        }
      } catch (error) {
        console.error('Background: Exception while fetching tab content:', error.message);
        promptContent = '';
      }
    }

    // Handle media loading
    let mediaData = null;
    if (isMediaContext && mediaUrl) {
      try {
        const media = await fetchMediaAsBase64(mediaUrl);

        mediaData = {
          type: mediaType,
          base64: media.base64,
          url: mediaUrl,
          mimeType: media.mimeType,
        };
      } catch (error) {
        console.error('Error fetching media:', error);
        try {
          await trackErrorEvent('network', `media_${error?.name || 'err'}`);
        } catch (_) {
          // Analytics is best-effort; preserve the media error path.
        }

        mediaData = {
          type: mediaType,
          base64: null,
          url: mediaUrl,
          mimeType: getMimeTypeFromUrl(mediaUrl),
          error: error.message,
        };
      }

      if (info.menuItemId !== 'oneoff_instruction') {
        await sendPanelMessage({
          action: 'setSelectedText',
          selectedText: '',
          mediaData: {
            ...mediaData,
            loading: false,
          },
          tabId: tab.id,
          actionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        });
      }
    }

    // Handle special menu items
    if (info.menuItemId === 'manageInstructions') {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
      return;
    }

    if (info.menuItemId === 'oneoff_instruction') {
      if (isMediaContext) {
        await sendPanelMessage({
          action: 'setSelectedText',
          selectedText: '',
          mediaData,
          tabId: tab.id,
          actionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        });
      } else {
        await sendPanelMessage({
          action: 'setSelectedText',
          selectedText: promptContent || '',
          tabId: tab.id,
          actionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        });
      }
      return;
    }

    // Start chat
    if (info.menuItemId === 'start_chat') {
      await sendPanelMessage({
        action: 'setSelectedText',
        selectedText: promptContent || '',
        fromStartChat: true,
        mediaData,
        tabId: tab.id,
        actionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      });
      // Media will be handled in chat.js via currentMediaData
      return;
    }

    // Handle custom instructions
    if (info.menuItemId.startsWith('custom_')) {
      const instructionId = info.menuItemId.replace('custom_', '');
      const { instructions = [] } = await chrome.storage.local.get(['instructions']);
      const instruction = instructions.find((i) => i.id === instructionId);

      if (instruction) {
        try {
          const cfg = await validateConfig().catch(() => ({}));
          await trackInstructionUsed({
            instruction: instruction.name || 'custom',
            model: cfg?.modelName,
            tools: Array.isArray(instruction.tool_choice)
              ? instruction.tool_choice
              : instruction.tool_choice && instruction.tool_choice !== 'none'
                ? [instruction.tool_choice]
                : [],
          });
        } catch (_) {
          // Analytics is best-effort; preserve the instruction action path.
        }

        // Send to chat for processing
        await sendPanelMessage({
          action: 'setMediaForAnalysis',
          mediaData: {
            ...mediaData,
            actionType: 'custom',
            instructionId: instructionId,
            promptRequest: {
              instruction: instruction.content,
              context: { type: promptContextType, text: promptContent },
            },
          },
          tabId: tab.id,
        });
      } else {
        console.error('Custom instruction not found for ID:', instructionId);
      }
      return;
    }

    // Handle predefined commands (modality-neutral prompts)
    const commandMap = CONTEXT_MENU_PROMPTS;

    if (commandMap[info.menuItemId]) {
      try {
        const cfg = await validateConfig().catch(() => ({}));
        await trackInstructionUsed({
          instruction: info.menuItemId,
          model: cfg?.modelName,
          tools: [],
        });
      } catch (_) {
        // Analytics is best-effort; preserve the predefined command path.
      }

      // Send to chat for processing
      const actionType = info.menuItemId;
      await sendPanelMessage({
        action: 'setMediaForAnalysis',
        mediaData: {
          ...mediaData,
          actionType: actionType,
          instructionId: null,
          promptRequest: {
            instruction: commandMap[info.menuItemId],
            context: { type: promptContextType, text: promptContent },
          },
        },
        tabId: tab.id,
      });
    }
  } catch (error) {
    console.error('Error in context menu click handler:', error);
  }
});

// Simplified validateConfig function
async function validateConfig() {
  const result = await new Promise((resolve) =>
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], resolve)
  );

  const profiles = result.profiles || [];
  const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
  const selectedProfile = profiles.find((p) => p.id === lastSelectedProfileId);
  const defaultProfile = profiles.find((p) => p.id === 'default');
  const validProfile = resolvePreferredProfile({ selectedProfile, defaultProfile });

  if (validProfile) {
    return validProfile;
  }

  if (!selectedProfile && !defaultProfile) {
    throw new Error('No valid profiles found. Please create a profile in the options page.');
  }

  throw new Error(
    'Configuration is incomplete. Please set API endpoint, API key, and model name in the options page.'
  );
}

// ===== Skill Manager (Agent Skills Spec Compliant) =====
class SkillManager {
  constructor() {
    this.skills = new Map();
    this.initialized = false;
    this.initPromise = null;
    this._metadataCache = null;
    this._cacheExpiry = 0;
    this._reloadLock = null;
  }

  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  async _doInit() {
    await this.loadSkills();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.customSkills) {
        this.loadSkills();
      }
    });
    this.initialized = true;
  }

  async ready() {
    await this.init();
    return this;
  }

  async loadSkills() {
    // Prevent concurrent reloads
    if (this._reloadLock) {
      return this._reloadLock;
    }

    this._reloadLock = this._doLoadSkills();
    try {
      await this._reloadLock;
    } finally {
      this._reloadLock = null;
    }
  }

  async _doLoadSkills() {
    // Build new map before swapping to avoid exposing empty state
    const newSkills = new Map();

    await Promise.all([
      this._loadBuiltInSkillsInto(newSkills),
      this._loadCustomSkillsInto(newSkills),
    ]);

    // Atomic swap
    this.skills = newSkills;
    this._invalidateCache();

    console.log('SkillManager: Loaded skills:', Array.from(this.skills.keys()));
  }

  async _loadBuiltInSkillsInto(targetMap) {
    try {
      const url = chrome.runtime.getURL('skills/skills.json');
      const response = await fetch(url);
      if (!response.ok) return;

      const builtIn = await response.json();
      for (const skill of builtIn) {
        try {
          const skillUrl = chrome.runtime.getURL(skill.path);
          const skillResponse = await fetch(skillUrl);
          if (!skillResponse.ok) continue;

          const markdown = await skillResponse.text();
          const expectedDirectoryName = String(skill.path || '')
            .split('/')
            .slice(-2, -1)[0];
          const parsed = parseSkillMarkdown(markdown, { expectedDirectoryName });

          if (parsed.valid) {
            targetMap.set(parsed.metadata.name, {
              metadata: parsed.metadata,
              parsed: parsed,
              raw: markdown,
              type: 'built-in',
              path: skill.path,
            });
          } else {
            console.warn(`Built-in skill '${skill.name}' parse error:`, parsed.error);
          }
        } catch (e) {
          console.warn(`Failed to load built-in skill '${skill.name}':`, e);
        }
      }
    } catch (e) {
      console.warn('Failed to load built-in skills:', e);
    }
  }

  async _loadCustomSkillsInto(targetMap) {
    try {
      const result = await chrome.storage.local.get(['customSkills']);
      const customSkills = result.customSkills || [];

      for (const skill of customSkills) {
        try {
          const skillMd = typeof skill.skillMd === 'string' ? skill.skillMd : null;
          if (!skillMd) {
            console.warn(`Custom skill '${skill.name}' is not in canonical SKILL.md format.`);
            continue;
          }
          const parsed = parseSkillMarkdown(skillMd);

          if (parsed.valid) {
            targetMap.set(parsed.metadata.name, {
              metadata: parsed.metadata,
              parsed: parsed,
              raw: skillMd,
              type: 'custom',
              lastUpdated: skill.lastUpdated,
            });
          } else {
            console.warn(`Custom skill '${skill.name}' parse error:`, parsed.error);
          }
        } catch (e) {
          console.error(`Failed to load custom skill '${skill.name}':`, e);
        }
      }
    } catch (e) {
      console.error('Failed to load custom skills:', e);
    }
  }

  _invalidateCache() {
    this._metadataCache = null;
    this._cacheExpiry = 0;
  }

  /**
   * Returns true if a skill with the given name exists.
   * @param {string} name
   * @returns {boolean}
   */
  hasSkill(name) {
    return this.skills.has(name);
  }

  /**
   * Returns all skill names.
   * @returns {string[]}
   */
  getSkillNames() {
    return Array.from(this.skills.keys());
  }

  getSkillsList() {
    const now = Date.now();
    if (this._metadataCache && now < this._cacheExpiry) {
      return this._metadataCache;
    }

    this._metadataCache = Array.from(this.skills.values()).map((s) => ({
      name: s.metadata.name,
      description: s.metadata.description,
      compatibility: s.metadata.compatibility,
      license: s.metadata.license,
      allowedTools: s.metadata['allowed-tools'],
      metadata: s.metadata.metadata,
      type: s.type,
      // OpenClaw-style fields
      userInvocable: s.metadata['user-invocable'] !== false,
      disableModelInvocation: s.metadata['disable-model-invocation'] === true,
      commandDispatch: s.metadata['command-dispatch'] || null,
      commandTool: s.metadata['command-tool'] || null,
      commandArgMode: s.metadata['command-arg-mode'] || null,
      homepage: s.metadata.homepage || null,
    }));
    this._cacheExpiry = now + 60000;
    return this._metadataCache;
  }

  async getSkillContent(name) {
    const skill = this.skills.get(name);
    if (!skill || !skill.parsed?.valid) return null;

    const m = skill.parsed.metadata;
    return {
      name: m.name,
      description: m.description,
      license: m.license,
      compatibility: m.compatibility,
      allowedTools: m['allowed-tools'],
      metadata: m.metadata,
      instructions: skill.parsed.instructions,
      rawMarkdown: skill.raw,
      type: skill.type,
      // OpenClaw-style fields
      userInvocable: m['user-invocable'] !== false,
      disableModelInvocation: m['disable-model-invocation'] === true,
      commandDispatch: m['command-dispatch'] || null,
      commandTool: m['command-tool'] || null,
      commandArgMode: m['command-arg-mode'] || null,
      homepage: m.homepage || null,
    };
  }

  // --- OpenClaw-style skill capabilities ---

  /**
   * Returns eligible skills for prompt injection (filters out disable-model-invocation).
   * Mirrors OpenClaw's session-level skill snapshot.
   * @returns {Array<{name:string, description:string}>}
   */
  getEligibleSnapshot() {
    return Array.from(this.skills.values())
      .filter((s) => {
        if (!s.parsed?.valid) return false;
        // Skills with disable-model-invocation are hidden from the model
        if (s.parsed.metadata['disable-model-invocation'] === true) return false;
        return true;
      })
      .map((s) => ({
        name: s.parsed.metadata.name,
        description: s.parsed.metadata.description,
        userInvocable: s.parsed.metadata['user-invocable'] !== false,
        commandDispatch: s.parsed.metadata['command-dispatch'] || null,
        commandTool: s.parsed.metadata['command-tool'] || null,
      }));
  }

  /**
   * Formats eligible skills as a compact text block for system-prompt injection.
   * Mirrors OpenClaw's formatSkillsForPrompt.
   * @returns {string}
   */
  formatForPrompt() {
    const skills = this.getEligibleSnapshot();
    if (skills.length === 0) return '';
    const lines = skills.map((s) => `- **${s.name}**: ${s.description}`);
    return `Available skills (reference instructions, NOT callable tools):\n${lines.join('\n')}\nUse the \`/skill <name> [input]\` command to activate a skill.`;
  }

  /**
   * Resolve a skill by name and return its full instructions for prompt injection.
   * @param {string} name
   * @returns {{name:string, description:string, instructions:string, metadata:Object, rawMarkdown:string, type:string}|null}
   */
  resolveSkill(name) {
    const skill = this.skills.get(name);
    if (!skill || !skill.parsed?.valid) return null;
    return {
      name: skill.parsed.metadata.name,
      description: skill.parsed.metadata.description,
      instructions: skill.parsed.instructions,
      metadata: skill.parsed.metadata,
      rawMarkdown: skill.raw,
      type: skill.type,
    };
  }

  /**
   * Get per-skill slash commands for user-invocable skills.
   * @returns {Array<{name:string, description:string, commandDispatch:string|null, commandTool:string|null}>}
   */
  getSlashCommands() {
    return Array.from(this.skills.values())
      .filter((s) => {
        if (!s.parsed?.valid) return false;
        // Default user-invocable is true unless explicitly false
        return s.parsed.metadata['user-invocable'] !== false;
      })
      .map((s) => ({
        name: s.parsed.metadata.name,
        description: s.parsed.metadata.description,
        commandDispatch: s.parsed.metadata['command-dispatch'] || null,
        commandTool: s.parsed.metadata['command-tool'] || null,
      }));
  }

  /**
   * Check if a skill uses command-dispatch: tool (deterministic dispatch, no model).
   * @param {string} name
   * @returns {boolean}
   */
  isCommandDispatch(name) {
    const skill = this.skills.get(name);
    if (!skill || !skill.parsed?.valid) return false;
    return skill.parsed.metadata['command-dispatch'] === 'tool';
  }
}

const skillManager = new SkillManager();
// Initialize on startup
skillManager.init();

// Import and initialize orchestrator
import RunOrchestrator from './src/orchestrator/RunOrchestrator.js';

const getBraveSearchApiKey = () =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(['braveSearchApiKey'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result.braveSearchApiKey || '');
    });
  });

const getExaSearchApiKey = () =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(['exaSearchApiKey'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result.exaSearchApiKey || '');
    });
  });

/** Default search provider used when no provider is stored. */
const DEFAULT_SEARCH_PROVIDER = 'exa';

/**
 * Resolve the active search provider from storage. A legacy stored
 * 'duckduckgo' value is migrated to 'exa' once and resolved as 'exa'.
 * @returns {Promise<'exa'|'brave'>}
 */
const getSearchProvider = () =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(['searchProvider'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (result.searchProvider === 'brave') {
        resolve('brave');
        return;
      }
      if (result.searchProvider === 'duckduckgo') {
        // One-time migration of the legacy value; fire and forget.
        chrome.storage.local.set({ searchProvider: 'exa' });
      }
      resolve(DEFAULT_SEARCH_PROVIDER);
    });
  });

/**
 * Web-search executor that dispatches to the active provider. The Exa keyless
 * MCP path needs no configuration; Brave requires a configured key. Named
 * `braveSearchExecutor` (kept as the orchestrator seam name) because
 * renaming it would churn unrelated orchestrator tests.
 */
const braveSearchExecutor = async (query, options = {}) => {
  const provider = await getSearchProvider();
  if (provider === 'brave') {
    const apiKey = await getBraveSearchApiKey();
    if (!apiKey) {
      throw new BraveSearchError(
        'Web search requires a Brave Search API key. Configure it in Options.',
        { code: 'NO_KEY' }
      );
    }
    return executeBraveSearch(query, apiKey, options);
  }
  return executeKeylessSearch(query, { ...options, exaApiKey: await getExaSearchApiKey() });
};

const pageActionSitePolicyStore = createPageActionSitePolicyStore(chrome.storage.local);
const pageActionSitePolicyProvider = () => pageActionSitePolicyStore.read();

const pageActionPolicyProvider = async () => {
  const result = await chrome.storage.local.get(['pageActionsTrustedMode']);
  return result.pageActionsTrustedMode === true;
};

const PAGE_ACTION_PING_TIMEOUT_MS = 1500;
const PAGE_ACTION_PING_RETRY_DELAY_MS = 250;
const PAGE_ACTION_INJECTION_TIMEOUT_MS = 5000;
const PAGE_ACTION_READY_TIMEOUT_MS = 30_000;
const PAGE_ACTION_READY_POLL_MS = 300;

/**
 * Ping the page-action content script on a tab with a bounded timeout.
 * Resolves to { connected }: never throws.
 * @param {number} tabId
 * @returns {Promise<{connected: boolean}>}
 */
const pingPageActionContentScript = (tabId) =>
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ connected: false });
    }, PAGE_ACTION_PING_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'pageActionPing' }, { frameId: 0 }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ connected: !chrome.runtime.lastError && Boolean(response?.success) });
      });
    } catch (_) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ connected: false });
    }
  });

/**
 * Verify the page-action content script is reachable, retrying once after a
 * short delay so transient interruptions (for example a tab that just started
 * loading) do not count as a permanent disconnect.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
const verifyPageActionConnection = async (tabId, signal) => {
  const first = await pingPageActionContentScript(tabId);
  if (first.connected) return true;
  await waitForRetry(0, {
    baseMs: PAGE_ACTION_PING_RETRY_DELAY_MS,
    maxMs: PAGE_ACTION_PING_RETRY_DELAY_MS,
    jitter: 0,
    signal,
  });
  return (await pingPageActionContentScript(tabId)).connected;
};

const injectPageActionFrameScripts = (tabId) =>
  new Promise((resolve) => {
    try {
      chrome.scripting.executeScript(
        { target: { tabId, allFrames: true }, files: ['content_script_page_actions.js'] },
        () => resolve(!chrome.runtime.lastError)
      );
    } catch (_) {
      resolve(false);
    }
  });

const injectPageActionFrameScriptsInFrames = async (tabId, frames) => {
  const results = await Promise.all(
    frames.map(
      (frame) =>
        new Promise((resolve) => {
          if (typeof frame.documentId !== 'string' || !frame.documentId) return resolve(false);
          try {
            chrome.scripting.executeScript(
              {
                target: { tabId, documentIds: [frame.documentId] },
                files: ['content_script_page_actions.js'],
              },
              (results) =>
                resolve(
                  !chrome.runtime.lastError &&
                    Array.isArray(results) &&
                    results.some((result) => result.documentId === frame.documentId)
                )
            );
          } catch (_) {
            resolve(false);
          }
        })
    )
  );
  return new Set(frames.filter((_, index) => results[index]).map((frame) => frame.frameId));
};

/**
 * Inject the unified page bridge when a tab was opened after the extension
 * content-script match was evaluated. Chrome can return from tabs.create while
 * the document is still in its provisional state, so readiness is a separate
 * bounded phase instead of an implicit assumption in page_open_tab.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
const injectPageActionContentScript = (tabId) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      const error = new Error('Content script injection did not complete in time.');
      error.code = 'PAGE_ACTION_INJECTION_FAILED';
      finish(error);
    }, PAGE_ACTION_INJECTION_TIMEOUT_MS);
    try {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: [
            'content_script_diagnostics.js',
            'libs/readability.js',
            'libs/turndown.js',
            'libs/dom-accessibility-api.js',
            'content_script_unified.js',
            'content_script_page_actions.js',
          ],
        },
        () => {
          if (chrome.runtime.lastError) {
            const error = new Error(
              chrome.runtime.lastError.message || 'Content script injection failed.'
            );
            error.code = 'PAGE_ACTION_INJECTION_FAILED';
            finish(error);
            return;
          }
          void injectPageActionFrameScripts(tabId).finally(() => finish());
        }
      );
    } catch (error) {
      error.code = error.code || 'PAGE_ACTION_INJECTION_FAILED';
      finish(error);
    }
  });

/**
 * Wait for a tab's document and page bridge to become usable. This absorbs the
 * normal tabs.create -> loading -> content-script attach race and quarantines
 * only genuinely unavailable tabs at the orchestrator boundary.
 * @param {number} tabId
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>}
 */
const ensurePageActionContentScript = async (tabId, signal) => {
  const deadline = Date.now() + PAGE_ACTION_READY_TIMEOUT_MS;
  let injected = false;
  let lastError = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('The run was aborted.', 'AbortError');
    let tab;
    try {
      tab = await chrome.tabs.get(Number(tabId));
    } catch (error) {
      lastError = error;
      break;
    }
    const url = String(tab?.url || tab?.pendingUrl || '').trim();
    if (url && getCurrentPageSupport(url).available) {
      if (await verifyPageActionConnection(Number(tabId), signal)) {
        await injectPageActionFrameScripts(Number(tabId));
        return true;
      }
      // A content script may be absent because this tab was created after the
      // match decision. Inject once after the document commits, then continue
      // polling until the bridge answers.
      if (!injected && tab.status !== 'loading') {
        try {
          await injectPageActionContentScript(Number(tabId));
        } catch (error) {
          lastError = error;
          throw error;
        }
        injected = true;
      }
    } else if (url && !getCurrentPageSupport(url).available) {
      const error = new Error('This browser page cannot host Prompt Paul page actions.');
      error.code = 'PAGE_ACTION_NO_CONTENT_SCRIPT';
      throw error;
    }
    await waitForRetry(attempt++, {
      baseMs: PAGE_ACTION_READY_POLL_MS,
      maxMs: 1_200,
      jitter: 0.15,
      signal,
    });
  }
  const error = new Error(
    'The Prompt Paul content script did not become ready in time. Reload the tab and try again.'
  );
  error.code = 'PAGE_ACTION_NO_CONTENT_SCRIPT';
  error.cause = lastError?.message || '';
  throw error;
};

const pageActionAvailabilityProvider = async (tabId) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!getCurrentPageSupport(tab?.url).available) {
      const error = new Error(
        'Act is on, but this page cannot host page actions. Open a regular web page and try again.'
      );
      error.code = 'PAGE_ACTION_UNAVAILABLE';
      throw error;
    }
    // The URL is supported, but page actions also need a connected content
    // script. Verify the bridge before the run starts; otherwise the forced
    // page_get_state call would fail and the orchestrator would retry it
    // until the tool-call limit is reached.
    await ensurePageActionContentScript(tabId);
    await markPageActionReadiness(tabId, tab?.url);
    return true;
  } catch (error) {
    if (['PAGE_ACTION_NO_CONTENT_SCRIPT', 'PAGE_ACTION_INJECTION_FAILED'].includes(error?.code)) {
      const actionable = new Error(
        'Page actions are on, but the Prompt Paul content script is not ready in this tab. Reload the tab and try again.'
      );
      actionable.code = 'PAGE_ACTION_NO_CONTENT_SCRIPT';
      throw actionable;
    }
    const actionable = new Error(
      'Act is on, but the selected page is no longer available. Open a regular web page and try again.'
    );
    actionable.code = 'PAGE_ACTION_UNAVAILABLE';
    actionable.cause = error?.message || '';
    throw actionable;
  }
};

/**
 * Resolve the current document identity for a tab (origin/path only). The
 * orchestrator binds a page-actions run to this identity and can rebind the
 * active Act run when the tab changes documents. Query strings and fragments
 * remain excluded from the identity.
 * Returns null when the identity cannot be resolved.
 * @param {number} tabId
 * @returns {Promise<{url: string}|null>}
 */
const pageActionDocumentProvider = async (tabId) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return null;
    return { url: sanitizePageActionUrl(tab.url) };
  } catch (_) {
    return null;
  }
};

const PAGE_ACTION_NAVIGATION_TIMEOUT_MS = 15_000;
const PAGE_ACTION_NAVIGATION_POLL_MS = 250;
const PAGE_ACTION_MESSAGE_TIMEOUT_MS = 15_000;
const PAGE_ACTION_BATCH_TIMEOUT_MAX_MS = 75_000;

const getPageActionTabUrl = async (tabId) => {
  const tab = await chrome.tabs.get(tabId);
  return sanitizePageActionUrl(tab?.url || '');
};

/**
 * Wait for an approved current-tab navigation to commit and for the new
 * document's page-action bridge to reconnect. A full document navigation can
 * close the message port before the content script replies, so this is the
 * recovery path for that expected transition.
 * @param {number} tabId
 * @param {string} previousUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<{url: string}>}
 */
const waitForPageActionNavigation = async (tabId, previousUrl, signal) => {
  const deadline = Date.now() + PAGE_ACTION_NAVIGATION_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('The run was aborted.', 'AbortError');

    let currentUrl = '';
    try {
      currentUrl = await getPageActionTabUrl(tabId);
    } catch (_) {
      const error = new Error('The source tab is no longer available for page navigation.');
      error.code = 'PAGE_ACTION_NAVIGATION_FAILED';
      throw error;
    }

    if (currentUrl && currentUrl !== previousUrl) {
      try {
        if (await ensurePageActionContentScript(tabId, signal)) return { url: currentUrl };
      } catch (_) {
        // Keep waiting while the destination document finishes loading.
      }
    }

    await waitForRetry(attempt++, {
      baseMs: PAGE_ACTION_NAVIGATION_POLL_MS,
      maxMs: 1_000,
      jitter: 0.15,
      signal,
    });
  }

  const error = new Error('The approved page navigation did not complete in time.');
  error.code = 'PAGE_ACTION_NAVIGATION_TIMEOUT';
  throw error;
};

/**
 * Wait for the page-action bridge to attach to the current document after a
 * navigation that completed before the first recovery inspection.
 * @param {number} tabId
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
const waitForPageActionBridge = async (tabId, signal) => {
  const deadline = Date.now() + PAGE_ACTION_NAVIGATION_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('The run was aborted.', 'AbortError');
    try {
      if (await ensurePageActionContentScript(tabId, signal)) return;
    } catch (_) {
      // Keep waiting while the destination document finishes loading.
    }
    await waitForRetry(attempt++, {
      baseMs: PAGE_ACTION_NAVIGATION_POLL_MS,
      maxMs: 1_000,
      jitter: 0.15,
      signal,
    });
  }
  const error = new Error('The page did not reconnect to page actions in time.');
  error.code = 'PAGE_ACTION_TIMEOUT';
  throw error;
};

const sendPageActionMessage = (
  tabId,
  message,
  signal,
  timeoutMs = PAGE_ACTION_MESSAGE_TIMEOUT_MS,
  frameId = 0
) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let onAbort = null;
    const timeoutId = setTimeout(() => {
      const error = new Error('The page did not respond to the action in time.');
      error.code = 'PAGE_ACTION_TIMEOUT';
      finish(null, error);
    }, timeoutMs);

    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value || { success: false, error: 'Empty page-action response.' });
    };

    if (signal) {
      if (signal.aborted) {
        finish(null, new DOMException('The run was aborted.', 'AbortError'));
        return;
      }
      onAbort = () => finish(null, new DOMException('The run was aborted.', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const callback = (response) => {
        if (chrome.runtime.lastError) {
          const runtimeMessage = chrome.runtime.lastError.message || '';
          const error = new Error(friendlyRuntimeErrorMessage(runtimeMessage));
          error.code = 'PAGE_ACTION_MESSAGE_FAILED';
          if (isRuntimeMessageUndelivered(runtimeMessage)) error.notDelivered = true;
          finish(null, error);
          return;
        }
        if (response?.success === false) {
          const error = new Error(response.error || 'The page action failed.');
          error.code = response.code || 'PAGE_ACTION_FAILED';
          // Preserve the pre-dispatch signal and occluder identity so the
          // orchestrator can record not_delivered and tell the model what is
          // covering the target instead of collapsing to a bare message.
          if (response.preDispatch === true) error.preDispatch = true;
          if (response.occluder && typeof response.occluder === 'object') {
            error.occluder = response.occluder;
          }
          finish(null, error);
          return;
        }
        finish(response, null);
      };
      if (Number.isInteger(frameId)) chrome.tabs.sendMessage(tabId, message, { frameId }, callback);
      else chrome.tabs.sendMessage(tabId, message, callback);
    } catch (error) {
      error.code = error.code || 'PAGE_ACTION_MESSAGE_FAILED';
      finish(null, error);
    }
  });

const getPageActionMessageTimeoutMs = (actionName, args = {}) => {
  if (actionName !== 'page_batch' || !Array.isArray(args.actions)) {
    return PAGE_ACTION_MESSAGE_TIMEOUT_MS;
  }
  const waitMs = args.actions.reduce((total, action) => {
    if (action?.name !== 'page_wait') return total;
    const requested = Number(action.args?.timeoutMs ?? 5_000);
    return total + (Number.isFinite(requested) ? Math.max(0, Math.min(10_000, requested)) : 5_000);
  }, 0);
  return Math.min(PAGE_ACTION_BATCH_TIMEOUT_MAX_MS, PAGE_ACTION_MESSAGE_TIMEOUT_MS + waitMs);
};

let runOrchestrator = null;

const pageFrameSnapshots = createPageFrameSnapshots();
const PAGE_ACTION_MAX_FRAMES = ACT_FRAME_CAPS.maxFrames;

const getPageActionFrameDescriptors = async (tabId) => {
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

const collectPageActionFrameSnapshots = async ({
  tabId,
  runId,
  blockedOrigins,
  signal,
  topResponse = null,
}) => {
  const allDescriptors = await getPageActionFrameDescriptors(tabId);
  const descriptors = allDescriptors.slice(0, PAGE_ACTION_MAX_FRAMES);
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
      PAGE_ACTION_MESSAGE_TIMEOUT_MS,
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
      (await getPageActionFrameDescriptors(tabId)).map((frame) => [frame.frameId, frame])
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
  return pageFrameSnapshots.merge(runId, frames, omittedFrameCount);
};

const pageActionExecutor = async (tabId, actionName, args, options = {}) => {
  const startedAt = Date.now();
  recordDevDiagnostic('page_action_executor_start', {
    runId: options.runId,
    tabId,
    action: actionName,
    expectNavigation: options.expectNavigation === true,
  });
  if (!tabId) {
    recordDevDiagnostic('page_action_executor_rejected', {
      runId: options.runId,
      tabId,
      action: actionName,
      code: 'PAGE_ACTION_NO_TAB',
      durationMs: Date.now() - startedAt,
    });
    const error = new Error('No supported source tab is available for page actions.');
    error.code = 'PAGE_ACTION_NO_TAB';
    throw error;
  }

  const blockedOrigins = Object.entries(
    runOrchestrator.activeRuns.get(options.runId)?.pageActions?.sitePolicies || {}
  )
    .filter(([, policy]) => policy === 'block')
    .map(([origin]) => origin)
    .slice(0, ACT_PAGE_DOM_CAPS.maxElements);
  const assertSiteAllowed = async (url = '') => {
    if (actionName === 'clearPageActionSession' || !blockedOrigins.length) return;
    if (
      blockedOrigins.includes(getPageActionSiteOrigin(url || (await getPageActionTabUrl(tabId))))
    ) {
      const error = new Error('Act is blocked on this site. Review site policies in Options.');
      error.code = 'PAGE_ACTION_SITE_BLOCKED';
      throw error;
    }
  };
  const { isCurrentSnapshot, route: frameRoute } = pageFrameSnapshots.resolveRoute(
    options.runId,
    args
  );
  if (
    isCurrentSnapshot &&
    ((Number.isInteger(args?.index) && !frameRoute) || (args?.focused === true && !frameRoute))
  ) {
    const error = new Error(
      'The indexed frame target is no longer available. Inspect the page again.'
    );
    error.code = 'PAGE_STATE_STALE';
    error.preDispatch = true;
    throw error;
  }
  const frameArgs = frameRoute
    ? {
        ...args,
        snapshotId: frameRoute.snapshotId,
        ...(Number.isInteger(frameRoute.index) ? { index: frameRoute.index } : {}),
        elementKey: frameRoute.elementKey,
      }
    : args;
  const message =
    actionName === 'clearPageActionSession'
      ? { action: 'clearPageActionSession', runId: options.runId }
      : {
          action: 'pageAction',
          runId: options.runId,
          pageAction: actionName,
          args: frameArgs,
          blockedOrigins,
        };
  const expectNavigation = options.expectNavigation === true;
  let previousUrl = '';
  try {
    previousUrl = await getPageActionTabUrl(tabId);
  } catch (_) {
    // Preserve the existing executor error path if the tab disappears before
    // the message can be sent.
  }
  let usedCachedReadiness = false;
  if (actionName === 'clearPageActionSession') pageActionReadinessCache.invalidate(tabId);
  else {
    await assertSiteAllowed(previousUrl);
    usedCachedReadiness = pageActionReadinessCache.get(tabId, previousUrl);
    if (!usedCachedReadiness) {
      pageActionReadinessCache.invalidate(tabId);
      await ensurePageActionContentScript(tabId, options.signal);
      const verifiedUrl = await getPageActionTabUrl(tabId);
      await assertSiteAllowed(verifiedUrl);
      await markPageActionReadiness(tabId, verifiedUrl);
      previousUrl = verifiedUrl;
    }
  }

  const messageTimeoutMs = getPageActionMessageTimeoutMs(actionName, args);
  let retriedCachedBridge = false;
  const checkedSend = async (
    messageOverride = message,
    targetFrameId = frameRoute?.frameId ?? 0
  ) => {
    await assertSiteAllowed();
    let response;
    try {
      response = await sendPageActionMessage(
        tabId,
        messageOverride,
        options.signal,
        messageTimeoutMs,
        targetFrameId
      );
    } catch (error) {
      const currentUrl = await getPageActionTabUrl(tabId).catch(() => '');
      if (
        actionName !== 'clearPageActionSession' &&
        usedCachedReadiness &&
        !retriedCachedBridge &&
        error?.code === 'PAGE_ACTION_MESSAGE_FAILED' &&
        error?.notDelivered === true &&
        currentUrl === previousUrl
      ) {
        retriedCachedBridge = true;
        usedCachedReadiness = false;
        pageActionReadinessCache.invalidate(tabId);
        await ensurePageActionContentScript(tabId, options.signal);
        const verifiedUrl = await getPageActionTabUrl(tabId);
        await assertSiteAllowed(verifiedUrl);
        previousUrl = verifiedUrl;
        await markPageActionReadiness(tabId, verifiedUrl);
        response = await sendPageActionMessage(
          tabId,
          messageOverride,
          options.signal,
          messageTimeoutMs,
          targetFrameId
        );
      } else {
        throw error;
      }
    }
    await assertSiteAllowed();
    if (response?.snapshot?.url) await assertSiteAllowed(response.snapshot.url);
    return response;
  };
  try {
    let response;
    if (actionName === 'clearPageActionSession') {
      response = await checkedSend(message, 0);
      const frames = await getPageActionFrameDescriptors(tabId);
      await Promise.all(
        frames
          .filter((frame) => !frame.isTop)
          .map((frame) =>
            sendPageActionMessage(
              tabId,
              message,
              options.signal,
              messageTimeoutMs,
              frame.frameId
            ).catch(() => null)
          )
      );
    } else {
      response = await checkedSend();
    }
    if (response?.snapshot && actionName !== 'clearPageActionSession') {
      const canReuseTopSnapshot = response?.snapshot && (!frameRoute || frameRoute.frameId === 0);
      const topResponse =
        actionName === 'page_get_state' && !frameRoute
          ? response
          : canReuseTopSnapshot
            ? { success: true, snapshot: response.snapshot }
            : await checkedSend(
                {
                  action: 'pageAction',
                  runId: options.runId,
                  pageAction: 'page_get_state',
                  args: {},
                  blockedOrigins,
                },
                0
              ).catch(() => null);
      if (topResponse?.snapshot) {
        const mergedSnapshot = await collectPageActionFrameSnapshots({
          tabId,
          runId: options.runId,
          blockedOrigins,
          signal: options.signal,
          topResponse,
        });
        if (mergedSnapshot) response = { ...response, snapshot: mergedSnapshot };
      }
    }
    const diagnosticResponse = { ...(response || {}) };
    delete diagnosticResponse.screenshot;
    recordDevDiagnostic(
      'page_action_message_response_detail',
      {
        runId: options.runId,
        tabId,
        action: actionName,
        response: diagnosticResponse,
        durationMs: Date.now() - startedAt,
      },
      { persist: false }
    );
    recordDevDiagnostic('page_action_message_response', {
      runId: options.runId,
      tabId,
      action: actionName,
      response: {
        success: response?.success,
        error: response?.error,
        code: response?.code,
        navigated: Boolean(response?.navigated),
        navigationUrl: sanitizePageActionUrl(response?.navigationUrl || ''),
        snapshot: response?.snapshot
          ? {
              snapshotId: response.snapshot.snapshotId,
              fingerprint: response.snapshot.fingerprint,
              url: sanitizePageActionUrl(response.snapshot.url || ''),
              elementCount: Array.isArray(response.snapshot.elements)
                ? response.snapshot.elements.length
                : 0,
            }
          : null,
        actionReceipt: response?.actionReceipt || null,
        scopeDiff: response?.scopeDiff || null,
      },
      durationMs: Date.now() - startedAt,
    });

    if (actionName === 'page_find_text') {
      response = pageFrameSnapshots.mapFindTextIndices(options.runId, response);
    } else if (actionName === 'page_batch' && Array.isArray(response?.results)) {
      response = {
        ...response,
        results: response.results.map((item, index) =>
          args?.actions?.[index]?.name === 'page_find_text'
            ? pageFrameSnapshots.mapFindTextIndices(options.runId, item)
            : item
        ),
      };
    }

    const responseUrl = sanitizePageActionUrl(response?.snapshot?.url || '');
    if (responseUrl && previousUrl && responseUrl !== previousUrl) {
      pageActionReadinessCache.invalidate(tabId);
      return { ...response, navigated: true, navigationUrl: responseUrl };
    }

    let currentUrl = '';
    try {
      currentUrl = await getPageActionTabUrl(tabId);
    } catch (_) {
      if (!expectNavigation) return response;
      throw _;
    }
    if (currentUrl) await assertSiteAllowed(currentUrl);
    if (currentUrl && previousUrl && currentUrl !== previousUrl) {
      const connected = await pingPageActionContentScript(tabId);
      if (connected.connected) {
        pageActionReadinessCache.invalidate(tabId);
        return { ...response, navigated: true, navigationUrl: currentUrl };
      }
    }
    if (actionName !== 'clearPageActionSession' && response?.success !== false) {
      await markPageActionReadiness(tabId, currentUrl || previousUrl);
    }
    return response;
  } catch (error) {
    if (
      [
        'PAGE_ACTION_MESSAGE_FAILED',
        'PAGE_ACTION_NO_CONTENT_SCRIPT',
        'PAGE_ACTION_INJECTION_FAILED',
        'PAGE_ACTION_TIMEOUT',
      ].includes(error?.code)
    ) {
      pageActionReadinessCache.invalidate(tabId);
    }
    recordDevDiagnostic('page_action_executor_error', {
      runId: options.runId,
      tabId,
      action: actionName,
      error,
      durationMs: Date.now() - startedAt,
    });
    // A full document navigation commonly closes the content-script message
    // port before it can reply. If the URL changed, wait for the new bridge and
    // return a recoverable transition even when the action was not pre-approved
    // as navigation-capable. The orchestrator records the mutation as
    // unverified so it is never blindly repeated.
    if (!['PAGE_ACTION_MESSAGE_FAILED', 'PAGE_ACTION_TIMEOUT'].includes(error?.code)) {
      throw error;
    }
    let currentUrl = '';
    try {
      currentUrl = await getPageActionTabUrl(tabId);
    } catch (_) {
      throw error;
    }
    if (
      error?.code === 'PAGE_ACTION_TIMEOUT' &&
      !isPageActionReadOnly(actionName) &&
      currentUrl === previousUrl
    ) {
      const unresponsive = new Error(
        'The page stopped responding after the action. It may be showing a browser dialog or still be busy.'
      );
      unresponsive.code = 'PAGE_ACTION_UNRESPONSIVE';
      throw unresponsive;
    }
    if (expectNavigation) {
      const navigation = await waitForPageActionNavigation(tabId, previousUrl, options.signal);
      await assertSiteAllowed(navigation.url);
      return { success: true, navigated: true, navigationUrl: navigation.url };
    }
    if (actionName === 'page_get_state' && currentUrl && currentUrl === previousUrl) {
      // A navigation can finish before the new content script has attached.
      // Give the bridge one bounded reconnect window before surfacing the
      // original failure to the orchestrator.
      await waitForPageActionBridge(tabId, options.signal);
      return await checkedSend();
    }
    if (!currentUrl || !previousUrl || currentUrl === previousUrl) throw error;
    const navigation = await waitForPageActionNavigation(tabId, previousUrl, options.signal);
    await assertSiteAllowed(navigation.url);
    return {
      success: true,
      navigated: true,
      navigationUrl: navigation.url,
      delivery: 'unknown',
    };
  }
};

const removeTemporarySearchTab = (tabId) =>
  new Promise((resolve) => {
    if (!Number.isInteger(tabId)) {
      resolve();
      return;
    }
    try {
      chrome.tabs.remove(tabId, () => resolve());
    } catch (_) {
      resolve();
    }
  });

/**
 * Read one search result through the existing page extraction content script.
 * Search URLs are untrusted; reuse the public-host guard before navigation and
 * after redirects, and always close the inactive temporary tab.
 * @param {string} url
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{content: string, title: string, url: string}|null>}
 */
const readSearchResultPage = async (url, { signal } = {}) => {
  if (!isSafePublicHttpUrl(url)) return null;
  let tabId = null;
  try {
    if (signal?.aborted) throw new DOMException('The run was aborted.', 'AbortError');
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = Number.isInteger(tab?.id) ? tab.id : null;
    if (tabId === null) return null;

    await ensurePageActionContentScript(tabId, signal);
    const current = await chrome.tabs.get(tabId);
    if (!isSafePublicHttpUrl(current?.url)) return null;

    const extracted = await executeTabContentExtraction(tabId);
    if (!extracted?.success || typeof extracted.content !== 'string') return null;
    return {
      content: extracted.content,
      title: String(extracted.title || current.title || ''),
      url: String(extracted.url || current.url || url),
    };
  } finally {
    await removeTemporarySearchTab(tabId);
  }
};

runOrchestrator = new RunOrchestrator(skillManager, {
  codexAuthProvider: (profileId) => codexAuthManager.getValidAuth(profileId),
  hermesTransport,
  hermesClientToolsProvider: async (config) => {
    const capabilities = await hermesTransport.getCapabilities({
      id: config?.profileId,
      hermesEndpoint: getHermesEndpoint(config),
      hermesProfile: config?.hermesProfile,
      hermesRemoteConfirmed: config?.hermesRemoteConfirmed === true,
    });
    return supportsHermesClientTools(capabilities) ? capabilities : false;
  },
  userToolExecutor: (tool, args) =>
    callUserDefinedEndpoint(tool.endpointUrl, args, tool.httpMethod),
  webSearchStatusProvider: async () => {
    const provider = await getSearchProvider();
    if (provider === 'exa') return true; // keyless, always configured
    return Boolean(await getBraveSearchApiKey());
  },
  braveSearchExecutor,
  webSearchPageReader: readSearchResultPage,
  pageActionPolicyProvider,
  pageActionSitePolicyProvider,
  pageActionAvailabilityProvider,
  pageActionDocumentProvider,
  pageActionExecutor,
  pageTabExecutor: (runId, actionName, args, options = {}) =>
    pageTabController.execute(runId, actionName, { ...args, signal: options.signal }),
  pageTabRunRegistrar: (runId, sourceTabId) => pageTabController.registerRun(runId, sourceTabId),
  pageTabRunDisposer: (runId) => {
    pageFrameSnapshots.deleteRun(runId);
    const ownedTabIds = pageTabController.getOwnedTabIds(runId);
    return Promise.all(
      ownedTabIds.map((tabId) =>
        pageActionExecutor(tabId, 'clearPageActionSession', {}, { runId }).catch(() => undefined)
      )
    ).finally(() => pageTabController.disposeRun(runId));
  },
  pageActionTabFailureHandler: (runId, tabId, failure) =>
    pageTabController.quarantine(runId, tabId, failure),
  pageActionActivityHandler: updateNotchActState,
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.pageActionSitePolicies) return;
  const policies = changes.pageActionSitePolicies.newValue || {};
  try {
    runOrchestrator.applySitePolicyChange(policies);
  } catch (error) {
    console.warn('[Act] Could not apply live site-policy tightening:', error?.message || error);
  }
});

// PageTabController owns tab scope; the background owns bridge readiness and
// injection because only the service worker can use chrome.scripting safely.
pageTabController.ensureTabReady = ensurePageActionContentScript;

registerEvalRunHook({
  getExtensionOrigin,
  isExtensionSender,
  resolveStoredRunConfig,
  runOrchestrator,
  createOwnerToken: randomId,
});

// ===== Menu System (Serialized Rebuild Queue) =====

// Menu rebuild queue - prevents concurrent rebuilds that could cause duplicate IDs
let menuRebuildQueue = Promise.resolve();

/**
 * Queues a menu rebuild operation to run serially.
 * All menu rebuild requests go through this queue to avoid race conditions.
 * @param {string} reason - Reason for the rebuild (for logging)
 * @returns {Promise<void>}
 */
async function queueMenuRebuild(reason = 'unknown') {
  menuRebuildQueue = menuRebuildQueue
    .then(() => rebuildUnifiedMenus())
    .then(() => console.log(`Menu rebuilt: ${reason}`))
    .catch((err) => console.error(`Menu rebuild failed (${reason}):`, err));
  return menuRebuildQueue;
}

/**
 * Removes all context menus atomically.
 * @returns {Promise<void>}
 */
function removeAllMenus() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      // Ignore errors - removeAll is idempotent
      resolve();
    });
  });
}

/**
 * Open the side panel for a tab's browser window.
 * @param {number} tabId - Tab used to resolve the window when needed.
 * @param {number|null} [windowId] - Known window ID, preferably from the sender tab.
 * @returns {Promise<void>}
 */
async function openSidePanelForTab(tabId, windowId = null) {
  const resolvedWindowId = Number.isInteger(windowId)
    ? windowId
    : (await chrome.tabs.get(tabId))?.windowId;
  if (!Number.isInteger(resolvedWindowId)) throw new Error('The tab window could not be resolved.');
  await chrome.sidePanel.open({ windowId: resolvedWindowId });
}

/**
 * Opens the side panel for a tab and forwards selected text into it.
 * @param {number} tabId - Source tab ID.
 * @param {string} selectedText - Selected text to send.
 * @param {number|null} [windowId] - Known source window ID.
 * @returns {Promise<void>}
 */
async function openPromptPaulForSelection(tabId, selectedText, windowId = null) {
  await openSidePanelForTab(tabId, windowId);
  await sendPanelMessage({
    action: 'setSelectedText',
    selectedText: selectedText || '',
    tabId,
    actionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

/**
 * Open the standalone chat page when a side panel cannot be opened.
 * @returns {Promise<Object>} { success, mode } result.
 */
function openChatInTab() {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: chrome.runtime.getURL('chat.html') }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve({
          success: false,
          error: chrome.runtime.lastError?.message || 'Unable to open chat',
        });
        return;
      }
      resolve({ success: true, mode: 'tab', tabId: tab.id });
    });
  });
}

/**
 * Canonical deep-link funnel: opens the side panel and routes context
 * (selection, media, or instruction) into the chat, preserving every
 * attachment. Used by the toolbar action, extension-page deep links, and
 * website deep links (chrome.runtime.onMessageExternal).
 * @param {Object} context - { tabId, selectedText, mediaUrl, mediaType,
 *   instruction }.
 * @param {Object} [options] - Internal routing options.
 * @param {Promise<void>} [options.panelOpenPromise] - A panel-open promise
 *   started inside the user-gesture handler.
 * @returns {Promise<Object>} { success, mode } result.
 */
async function openChatWithContext(context = {}, options = {}) {
  const {
    tabId,
    windowId = null,
    selectedText = '',
    mediaUrl = '',
    mediaType = 'image',
    instruction = '',
  } = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
  const normalizedTabId = Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
  const normalizedWindowId = Number.isInteger(windowId) ? windowId : null;
  const normalizedSelectedText =
    typeof selectedText === 'string' ? selectedText.trim().slice(0, NOTCH_MAX_SELECTION_CHARS) : '';
  const normalizedMediaUrl = typeof mediaUrl === 'string' ? mediaUrl.trim() : '';
  const normalizedInstruction =
    typeof instruction === 'string' ? instruction.trim().slice(0, NOTCH_MAX_INSTRUCTION_CHARS) : '';
  const normalizedMediaType = ['image', 'video', 'audio'].includes(mediaType) ? mediaType : 'image';

  if (normalizedTabId === null) {
    return { success: false, error: 'No valid tab context for deep link' };
  }
  if (normalizedMediaUrl && !isSafePublicHttpUrl(normalizedMediaUrl)) {
    return { success: false, error: 'Media URL must be a public HTTP(S) URL.' };
  }
  const tabIdForContext = normalizedTabId;

  if (options.panelOpenPromise) await options.panelOpenPromise;
  else await openSidePanelForTab(tabIdForContext, normalizedWindowId);
  const actionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // Media context: preserve the attachment and keep selected text structured.
  if (normalizedMediaUrl) {
    let mediaData;
    try {
      const media = await fetchMediaAsBase64(normalizedMediaUrl);
      mediaData = {
        type: normalizedMediaType,
        base64: media.base64,
        url: normalizedMediaUrl,
        mimeType: media.mimeType,
      };
    } catch (error) {
      mediaData = {
        type: normalizedMediaType,
        base64: null,
        url: normalizedMediaUrl,
        mimeType: getMimeTypeFromUrl(normalizedMediaUrl),
        error: error.message,
      };
    }
    await sendPanelMessage({
      action: 'setMediaForAnalysis',
      mediaData: {
        ...mediaData,
        actionType: normalizedInstruction ? 'custom' : null,
        instructionId: null,
        promptRequest: {
          instruction: normalizedInstruction || 'Analyze the attached media.',
          context: normalizedSelectedText
            ? { type: 'selected_text', text: normalizedSelectedText }
            : { type: 'media' },
        },
      },
      tabId: tabIdForContext,
    });
    return { success: true, mode: 'media' };
  }

  // Text/selection context (instruction rides along as the initial prompt).
  await sendPanelMessage({
    action: 'setSelectedText',
    selectedText: normalizedSelectedText,
    fromStartChat: true,
    textPrompt: normalizedInstruction || null,
    tabId: tabIdForContext,
    actionId,
  });
  return { success: true, mode: 'text' };
}

// Toolbar action: clicking the extension icon opens the canonical chat.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id === -1 || tab.id === undefined) {
    return;
  }
  try {
    await openChatWithContext({ tabId: tab.id, windowId: tab.windowId });
  } catch (error) {
    console.error('Background: Failed to open chat from toolbar action:', error);
  }
});

/**
 * Creates a single menu item with error handling.
 * @param {Object} menuConfig - Chrome context menu configuration
 * @returns {Promise<void>}
 */
function createMenu(menuConfig) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(menuConfig, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.warn(`Menu creation error for '${menuConfig.id}':`, error.message);
      }
      resolve();
    });
  });
}

/**
 * Creates all context menu items in a deterministic order.
 * Assumes menus have already been cleared.
 * @param {Array<Object>} instructions - Custom instructions from storage
 */
async function createAllMenus(instructions = []) {
  const modalities = ['selection', 'image', 'video', 'audio'];

  // 1. Static top-level items
  await createMenu({
    id: 'oneoff_instruction',
    title: '✨ One-off Instruction',
    contexts: modalities,
  });

  await createMenu({
    id: 'start_chat',
    title: '💬 Start Chat',
    contexts: modalities,
  });

  // 2. Parent menu
  await createMenu({
    id: 'prompt_paul',
    title: 'Query Prompt Paul',
    contexts: modalities,
  });

  // 3. Prompt Paul submenu items
  const promptPaulChildren = [
    { id: 'summarize', title: '📝 Summarize' },
    { id: 'analyze', title: '🔍 Analyze' },
    { id: 'explain', title: '❓ Explain' },
    { id: 'polish', title: '🪄 Polish' },
    { id: 'shorten', title: '✂️ Shorten' },
    { id: 'formal', title: '💼 Formal' },
    { id: 'casual', title: '🤙 Casual' },
    { id: 'proofread', title: '✅ Proof Read' },
  ];

  for (const child of promptPaulChildren) {
    await createMenu({
      id: child.id,
      title: child.title,
      contexts: modalities,
      parentId: 'prompt_paul',
    });
  }

  // 4. Custom Instructions parent
  await createMenu({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: modalities,
  });

  // 5. Custom instruction items (with deduplication check)
  const seenIds = new Set();
  if (instructions && instructions.length > 0) {
    for (const instruction of instructions) {
      const menuId = `custom_${instruction.id}`;
      if (seenIds.has(menuId)) {
        console.warn(`Skipping duplicate instruction ID: ${menuId}`);
        continue;
      }
      seenIds.add(menuId);

      await createMenu({
        id: menuId,
        parentId: 'customInstructions',
        title: `✨ ${instruction.name}`,
        contexts: modalities,
      });
    }
  }

  // 6. Separator and manage option
  await createMenu({
    id: 'separator',
    type: 'separator',
    contexts: modalities,
  });

  await createMenu({
    id: 'manageInstructions',
    title: 'Manage Custom Instructions',
    contexts: modalities,
  });
}

/**
 * Atomically rebuilds all context menus from scratch.
 * Clears all existing menus and recreates them deterministically.
 */
async function rebuildUnifiedMenus() {
  // Fetch instructions before clearing menus (minimize time between clear and recreate)
  const { instructions } = await chrome.storage.local.get(['instructions']);

  // Remove all menus atomically
  await removeAllMenus();

  // Recreate all menus in deterministic order
  await createAllMenus(instructions);
}

// ===== Event Listeners =====

// Create context menu items on install
chrome.runtime.onInstalled.addListener(async (details) => {
  await queueMenuRebuild('onInstalled');
  if (details.reason === 'install') {
    const existing = await chrome.storage.local.get(['notchEnabled']);
    if (typeof existing.notchEnabled === 'undefined') {
      await chrome.storage.local.set({ notchEnabled: false });
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?firstRun=1') });
  }
  await syncDynamicNotchScript();
});

// Also rebuild on browser startup (service worker may restart)
chrome.runtime.onStartup.addListener(async () => {
  await queueMenuRebuild('onStartup');
  await syncDynamicNotchScript();
});

// Update context menus when instructions change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes.instructions) {
    // Use the queue to prevent race conditions
    await queueMenuRebuild('instructions-changed');
  }
  if (namespace === 'local' && changes.notchEnabled) {
    void syncDynamicNotchScript().catch((error) =>
      console.warn(
        'Prompt Paul: Could not update the optional notch script:',
        error?.message || error
      )
    );
  }
});

// --- Tool Execution Logic ---

// Generic function to call a user-defined endpoint
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod = 'GET') {
  if (!isValidHttpUrl(endpointUrl)) {
    throw new Error('Tool endpoint URL must use http or https.');
  }
  const normalizedMethod = normalizeToolHttpMethod(userDefinedMethod);
  if (normalizedMethod === null) {
    throw new Error('Tool HTTP method is not supported.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 1-minute timeout

  try {
    let finalEndpointUrl = endpointUrl;
    let finalFetchOptions = {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    };
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('Tool arguments must be an object.');
    }
    const serializedArgs = JSON.stringify(args);
    if (new TextEncoder().encode(serializedArgs).byteLength > MAX_TOOL_ARGUMENTS_BYTES) {
      throw new Error('Tool arguments are too large.');
    }
    const finalArgs = args;

    const isEmptyArgs = Object.keys(finalArgs).length === 0;
    let method = normalizedMethod || (isEmptyArgs ? 'GET' : 'POST');
    finalFetchOptions.method = method;

    if (method === 'GET' && !isEmptyArgs) {
      // Build the destination with URL/URLSearchParams so an endpoint that
      // already has a query (or a fragment) keeps its existing parameters and
      // tool arguments become separate, correctly encoded parameters (P2-14).
      const destination = new URL(finalEndpointUrl);
      const params = new URLSearchParams(destination.search);
      for (const [key, value] of Object.entries(finalArgs)) {
        params.set(key, value);
      }
      destination.search = params.toString();
      finalEndpointUrl = destination.toString();
    } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
      finalFetchOptions.headers['Content-Type'] = 'application/json';
      finalFetchOptions.body = JSON.stringify(finalArgs);
    }
    // For DELETE, args might be used in the URL path or ignored

    const response = await fetch(finalEndpointUrl, finalFetchOptions); // Use finalEndpointUrl and finalFetchOptions
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorMsg = formatToolRequestError(response.status);
      console.warn('Background: User tool request failed', { status: response.status });
      throw new Error(errorMsg);
    }

    // Attempt to parse response as JSON, fall back to text if not JSON
    const contentType = response.headers.get('content-type');

    const boundedBody = await readBoundedResponseText(response);
    if (contentType && contentType.includes('application/json')) {
      try {
        return JSON.parse(boundedBody);
      } catch (_) {
        return boundedBody;
      }
    }

    return boundedBody;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn('Background: User tool request timed out');
      throw new Error('User tool request timed out after 60 seconds.');
    }
    console.warn('Background: User tool request failed', { errorName: error.name || 'Error' });
    throw new Error(formatToolRequestError());
  }
}

const IMPROVE_INSTRUCTION_TIMEOUT_MS = 30_000;
const IMPROVE_INSTRUCTION_SYSTEM_PROMPT =
  'You are an expert prompt engineer. Improve the following prompt for a large language model to be clearer, more concise, and more effective. Only return the improved prompt text, nothing else.';

/**
 * Route the Options-page Improve Instruction flow through a background-owned,
 * provider-aware, bounded request (P2-06).
 *
 * The API provider gets a bounded chat-completions POST reusing the endpoint,
 * key, and model saved for the selected profile (credentials stay background-
 * owned). Codex and Hermes profiles receive an explicit capability message
 * rather than a misleading "configuration incomplete" error, because their
 * transports are streaming run pipelines rather than a single OpenAI-shaped
 * fetch. Any timeout or transport failure rejects, so the caller leaves the
 * original instruction untouched.
 * @param {string} prompt - The instruction content to improve.
 * @returns {Promise<string>} The improved instruction text.
 */
async function improveInstructionForProfile(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('The instruction is empty; nothing to improve.');
  }
  const result = await chrome.storage.local.get(['profiles', 'lastSelectedProfileId']);
  const profiles = result.profiles || [];
  const profileId = result.lastSelectedProfileId || 'default';
  const storedProfile = profiles.find((entry) => entry.id === profileId);
  if (!storedProfile) throw new Error('The selected connection profile was not found.');
  const normalizedProfile = normalizeProfileRecord(storedProfile);
  if (!normalizedProfile.valid) throw new Error(normalizedProfile.error);
  const profile = normalizedProfile.value;

  if (profile.provider === 'codex' || profile.provider === 'hermes') {
    const error = new Error(
      `Improve Instruction is not supported for ${profile.provider === 'hermes' ? 'Hermes' : 'Codex'} profiles yet. Switch to an API connection profile to use it.`
    );
    error.capability = 'unsupported';
    throw error;
  }

  if (!profile.llmEndpoint || !profile.apiKey || !profile.modelName) {
    throw new Error('API configuration is incomplete. Please set it up in settings.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMPROVE_INSTRUCTION_TIMEOUT_MS);
  try {
    const response = await fetch(profile.llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify({
        model: profile.modelName,
        messages: [
          { role: 'system', content: IMPROVE_INSTRUCTION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}.`);
    }
    const bodyText = await readBoundedResponseText(response);
    let responseData;
    try {
      responseData = JSON.parse(bodyText);
    } catch (_) {
      throw new Error('Invalid response format from API: not valid JSON.');
    }
    const content = responseData?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Invalid response format from API: Missing message content.');
    }
    return content.trim();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('The improve request timed out. Your instruction was left unchanged.');
    }
    if (error.capability === 'unsupported') throw error;
    if (error.message === 'Invalid response format from API: Missing message content.') throw error;
    throw new Error('The improve request failed. Your instruction was left unchanged.');
  }
}

// Registry for built-in tool implementations: now handled by RunOrchestrator

async function isPdfTab(tab) {
  if (isLikelyPdfUrl(tab?.url, tab?.title)) return true;
  return probePdfUrl(tab?.url);
}

function createPdfExtractionResult(tab) {
  return {
    success: false,
    isPdf: true,
    pdfUrl: getPdfSourceUrl(tab.url) || tab.url,
    title: tab.title || '',
  };
}

// Unified extraction function to avoid circular messaging and redundant injections
async function executeTabContentExtraction(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      // PDFs can't be read from the DOM (native viewer is an opaque plugin); the
      // chat page parses the bytes with pdf.js instead. Route by URL before the
      // restriction guard so local file:// PDFs aren't blocked as `file:` pages.
      if (isLikelyPdfUrl(tab?.url, tab?.title)) {
        resolve(createPdfExtractionResult(tab));
        return;
      }

      // A hidden URL almost always means a local file (e.g. a PDF opened from
      // disk) without file access, rather than a genuinely missing page.
      if (!tab?.url) {
        resolve({
          success: false,
          errorKind: 'no-url',
          error:
            'Prompt Paul can’t read this tab. If it’s a local file (e.g. a PDF from your ' +
            'computer), enable "Allow access to file URLs" for Prompt Paul in chrome://extensions.',
          readStrategy: 'auto',
        });
        return;
      }

      const support = getCurrentPageSupport(getPdfSourceUrl(tab?.url) || tab?.url);
      if (!support.available) {
        resolve({ success: false, error: support.blockedReason, readStrategy: 'auto' });
        return;
      }

      const timeoutId = setTimeout(() => {
        resolve({ success: false, error: 'Extraction timed out', readStrategy: 'auto' });
      }, 15000);

      ensureExtractionDependencies(tabId, tab.url)
        .then(() => {
          chrome.tabs.sendMessage(tabId, { action: 'getTabContent' }, (response) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              const runtimeError = chrome.runtime.lastError.message;
              const errorKind = classifyRuntimeMessageError(runtimeError);
              console.warn(
                'Background: Tab message failed (script might not be loaded):',
                runtimeError
              );
              isPdfTab(tab).then((isPdf) => {
                if (isPdf) {
                  resolve(createPdfExtractionResult(tab));
                  return;
                }
                // Fallback: only inject if needed
                chrome.scripting.executeScript(
                  {
                    target: { tabId: tabId },
                    files: ['libs/readability.js', 'libs/turndown.js', 'content_script_unified.js'],
                  },
                  () => {
                    if (chrome.runtime.lastError) {
                      resolve({
                        success: false,
                        error: friendlyRuntimeErrorMessage(runtimeError),
                        errorKind,
                        readStrategy: 'auto',
                      });
                    } else {
                      // Try messaging again after injection
                      chrome.tabs.sendMessage(tabId, { action: 'getTabContent' }, (res) => {
                        if (chrome.runtime.lastError) {
                          resolve({
                            success: false,
                            error: friendlyRuntimeErrorMessage(chrome.runtime.lastError.message),
                            errorKind: classifyRuntimeMessageError(
                              chrome.runtime.lastError.message
                            ),
                            readStrategy: 'auto',
                          });
                        } else {
                          resolve(
                            res || {
                              success: false,
                              error: 'Empty response after injection',
                              readStrategy: 'auto',
                            }
                          );
                        }
                      });
                    }
                  }
                );
              });
            } else {
              const result = response || {
                success: false,
                error: 'Empty response from content script',
                readStrategy: 'auto',
              };
              if (result.success && result.content) {
                resolve(result);
                return;
              }
              isPdfTab(tab).then((isPdf) => {
                if (isPdf) {
                  resolve(createPdfExtractionResult(tab));
                } else {
                  resolve(result);
                }
              });
            }
          });
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            error: friendlyRuntimeErrorMessage(error?.message || 'Could not prepare extraction.'),
            readStrategy: 'auto',
          });
        });
    });
  });
}

/**
 * Returns whether a tab can host the side panel. Extension and browser
 * internal pages cannot be used with chrome.sidePanel.open().
 * @param {Object} tab - Chrome tab descriptor.
 * @returns {boolean} True when the tab is a regular web page.
 */
function isUsablePanelTab(tab) {
  const url = String(tab?.url || '');
  return Boolean(
    tab &&
    tab.id !== undefined &&
    /^(https?:|file:)/i.test(url) &&
    !/^(chrome|chrome-extension|edge|about|devtools):/i.test(url)
  );
}

function isExtensionPageTab(tab) {
  return /^(chrome|edge|moz)-extension:/i.test(String(tab?.url || ''));
}

function isActiveUnsupportedBrowserTab(tab, preferredTabId = null) {
  const url = String(tab?.url || '');
  return Boolean(
    tab?.active &&
    tab.id !== preferredTabId &&
    !isExtensionPageTab(tab) &&
    (!url || /^(about:|chrome:|edge:|devtools:)/i.test(url))
  );
}

/**
 * Resolves the most relevant regular web tab for extension-page entry points.
 * Options pages are extension tabs, so the active tab at click time is not a
 * valid side-panel host; prefer the active web tab in the same window instead.
 * @param {number|null} preferredTabId - Optional requested tab id.
 * @param {{rejectUnsupportedActive?: boolean}} [options]
 * @returns {Promise<number|null>} A side-panel-capable tab id.
 */
async function resolvePanelTabId(preferredTabId = null, options = {}) {
  let tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  let preferred = tabs.find((tab) => tab.id === preferredTabId);
  let candidate = [preferred, ...tabs.filter((tab) => tab.active), ...tabs].find(isUsablePanelTab);

  if (
    options.rejectUnsupportedActive &&
    tabs.some((tab) => isActiveUnsupportedBrowserTab(tab, preferredTabId))
  ) {
    return null;
  }

  // An Options page may be opened in a separate extension window. If that
  // window has no web tab, fall back to any regular tab in the browser.
  if (!candidate) {
    tabs = await chrome.tabs.query({});
    preferred = tabs.find((tab) => tab.id === preferredTabId);
    candidate = [preferred, ...tabs.filter((tab) => tab.active), ...tabs].find(isUsablePanelTab);
  }

  return candidate?.id ?? null;
}

function getExtensionOrigin() {
  return chrome.runtime.getURL('');
}

function sendNotchActState(tabId, active, runId) {
  if (!Number.isInteger(tabId) || !runId) return;
  const previous = notchActMessageQueues.get(tabId) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      if (active) {
        try {
          await injectActFeedbackScript(tabId);
        } catch (_) {
          // Restricted or closing tabs cannot show the activity indicator.
        }
      }
      await new Promise((resolve) => {
        try {
          chrome.tabs.sendMessage(tabId, { action: 'notchActRunState', active, runId }, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        } catch (_) {
          resolve();
        }
      });
    });
  let settled;
  settled = operation
    .catch(() => {})
    .then(() => {
      if (notchActMessageQueues.get(tabId) === settled) notchActMessageQueues.delete(tabId);
    });
  notchActMessageQueues.set(tabId, settled);
}

function updateNotchActState(run, event) {
  if (!run?.pageActions?.enabled || !run.id) return;

  const runId = String(run.id);
  const targetTabId =
    Number(event?.tabId || run.pageActions.targetTabId || run.sourceTabId || 0) || null;
  const isActionRunning = event?.type === 'page_action_state' && event.state === 'running';
  const isActionFinished =
    event?.type === 'page_action_state' && ['complete', 'error'].includes(event.state);
  const isRunFinished = ['complete', 'error', 'aborted'].includes(event?.type);
  let trackedTabs = activeNotchRunTabs.get(runId);

  if (isActionRunning && targetTabId) {
    if (!trackedTabs) trackedTabs = new Set();
    for (const previousTabId of trackedTabs) {
      if (previousTabId !== targetTabId) sendNotchActState(previousTabId, false, runId);
    }
    sendNotchActState(targetTabId, true, runId);
    trackedTabs.add(targetTabId);
    activeNotchRunTabs.set(runId, trackedTabs);
    return;
  }

  if (!isActionFinished && !isRunFinished) return;
  if (trackedTabs) {
    for (const trackedTabId of trackedTabs) sendNotchActState(trackedTabId, false, runId);
    activeNotchRunTabs.delete(runId);
  } else if (targetTabId) {
    sendNotchActState(targetTabId, false, runId);
  }
}

function rejectUnauthorizedMessage(sendResponse, error = 'Prompt Paul authorization is required.') {
  sendResponse({ success: false, error });
  return true;
}

function isAuthorizedRunRequest(request, sender) {
  return isRunOwner(
    runOrchestrator.activeRuns.get(request?.runId),
    request,
    sender,
    getExtensionOrigin()
  );
}

async function resolveStoredRunConfig(config) {
  const profileId = typeof config?.profileId === 'string' ? config.profileId.trim() : '';
  if (!profileId) {
    if (config?.pageActions && !config.provider) return config;
    throw new Error('A saved connection profile is required.');
  }

  const result = await chrome.storage.local.get(['profiles', 'promptPaulTools']);
  const profile = (result.profiles || []).find((entry) => entry.id === profileId);
  if (!profile) throw new Error('The selected connection profile was not found.');
  const normalizedProfile = normalizeProfileRecord(profile);
  if (!normalizedProfile.valid) throw new Error(normalizedProfile.error);

  const storedProfile = normalizedProfile.value;
  const provider = storedProfile.provider;
  return {
    ...config,
    provider,
    profileId: storedProfile.id,
    llmEndpoint: provider === 'api' ? storedProfile.llmEndpoint : '',
    apiKey: provider === 'api' ? storedProfile.apiKey : '',
    modelName: storedProfile.modelName,
    reasoningLevel: storedProfile.reasoningLevel || '',
    systemPrompt: storedProfile.systemPrompt || '',
    tools: Array.isArray(result.promptPaulTools) ? result.promptPaulTools : [],
    ...(provider === 'hermes'
      ? {
          hermesEndpoint: getHermesEndpoint(storedProfile),
          hermesProfile: storedProfile.hermesProfile || '',
          hermesRemoteConfirmed: storedProfile.hermesRemoteConfirmed === true,
        }
      : {}),
  };
}

/**
 * Send a notch action after its panel-open operation has started synchronously.
 * @param {string} action - Chat-side action name.
 * @param {number} tabId - Sender tab ID.
 * @param {Object} [payload] - Bounded action payload.
 * @param {Promise<void>|null} [panelOpenPromise] - Existing gesture-bound open.
 * @returns {Promise<Object>} Panel delivery result.
 */
async function createNotchPanelAction(action, tabId, payload = {}, panelOpenPromise = null) {
  const actionId = `notch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  if (panelOpenPromise) await panelOpenPromise;
  else await openSidePanelForTab(tabId);
  return sendPanelMessage({ action, ...payload, tabId, actionId });
}

/**
 * Stores a short-lived lease for a panel opened during the dictation gesture.
 * @param {number} tabId - Sender tab ID.
 * @returns {Promise<string>} Opaque lease token.
 */
async function createNotchDictationLease(tabId) {
  const lease = {
    token: `dictation-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
    expiresAt: Date.now() + NOTCH_DICTATION_LEASE_MS,
  };
  activeNotchDictationLeases.set(tabId, lease);
  try {
    const result = await chrome.storage.session.get(NOTCH_DICTATION_LEASE_KEY);
    const leases =
      result?.[NOTCH_DICTATION_LEASE_KEY] && typeof result[NOTCH_DICTATION_LEASE_KEY] === 'object'
        ? { ...result[NOTCH_DICTATION_LEASE_KEY] }
        : {};
    leases[String(tabId)] = lease;
    await chrome.storage.session.set({ [NOTCH_DICTATION_LEASE_KEY]: leases });
  } catch (_) {
    // The in-memory lease still covers the current service-worker lifetime.
  }
  return lease.token;
}

/**
 * Consumes a panel lease without opening the panel again.
 * @param {number} tabId - Sender tab ID.
 * @param {string} token - Opaque lease token.
 * @returns {Promise<boolean>} True when the lease is valid and unused.
 */
async function consumeNotchDictationLease(tabId, token) {
  let lease = activeNotchDictationLeases.get(tabId) || null;
  if (!lease) {
    try {
      const result = await chrome.storage.session.get(NOTCH_DICTATION_LEASE_KEY);
      lease = result?.[NOTCH_DICTATION_LEASE_KEY]?.[String(tabId)] || null;
    } catch (_) {
      lease = null;
    }
  }

  const valid = Boolean(lease?.token === token && lease.expiresAt > Date.now());
  activeNotchDictationLeases.delete(tabId);
  try {
    const result = await chrome.storage.session.get(NOTCH_DICTATION_LEASE_KEY);
    const leases =
      result?.[NOTCH_DICTATION_LEASE_KEY] && typeof result[NOTCH_DICTATION_LEASE_KEY] === 'object'
        ? { ...result[NOTCH_DICTATION_LEASE_KEY] }
        : {};
    if (leases[String(tabId)]?.token === token) {
      delete leases[String(tabId)];
      await chrome.storage.session.set({ [NOTCH_DICTATION_LEASE_KEY]: leases });
    }
  } catch (_) {
    // A consumed in-memory lease cannot be reused in this worker.
  }
  return valid;
}

/**
 * Handle the small, allowlisted action surface exposed by the browser-page notch.
 * Content-script requests are always bound to the sender tab.
 * @param {Object} request - Runtime request from the notch content script.
 * @param {Object} sender - Runtime sender descriptor.
 * @returns {Promise<Object>}
 */
async function handleNotchAction(request, sender) {
  const extensionOrigin = getExtensionOrigin();
  if (
    !isContentScriptSender(sender, extensionOrigin) ||
    !requestMatchesSenderTab(sender, request?.tabId)
  ) {
    return { success: false, error: 'Notch actions must come from their page.' };
  }

  const action = String(request?.notchAction || '');
  if (!NOTCH_ACTIONS.has(action)) {
    return { success: false, error: 'Unsupported notch action.' };
  }

  const tabId = sender.tab.id;
  if (!isUsablePanelTab(sender.tab)) {
    return { success: false, error: 'Prompt Paul is not available on this page.' };
  }
  const requestedDictationToken =
    action === 'sendInstruction' && typeof request?.dictationPanelToken === 'string'
      ? request.dictationPanelToken.trim()
      : '';
  const panelAlreadyOpen = requestedDictationToken
    ? await consumeNotchDictationLease(tabId, requestedDictationToken)
    : false;
  if (requestedDictationToken && !panelAlreadyOpen) {
    return { success: false, error: 'The dictation session expired. Start dictation again.' };
  }
  const panelOpenPromise =
    action === 'openOptions' || panelAlreadyOpen
      ? null
      : openSidePanelForTab(tabId, sender.tab.windowId);
  const tab = await chrome.tabs.get(tabId);
  if (!isUsablePanelTab(tab)) {
    if (panelOpenPromise) await panelOpenPromise.catch(() => {});
    return { success: false, error: 'Prompt Paul is not available on this page.' };
  }

  if (action === 'openOptions') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return { success: true };
  }

  if (action === 'prepareDictation') {
    await panelOpenPromise;
    return { success: true, panelToken: await createNotchDictationLease(tabId) };
  }

  if (action === 'openChat') {
    return openChatWithContext({ tabId, windowId: sender.tab.windowId }, { panelOpenPromise });
  }

  if (action === 'runPinnedInstruction') {
    const instructionId =
      typeof request?.instructionId === 'string' ? request.instructionId.trim() : '';
    if (!instructionId || instructionId.length > 256) {
      return { success: false, error: 'Pinned prompt is not available.' };
    }
    const { instructions = [], pinnedQuickActions = [] } = await chrome.storage.local.get([
      'instructions',
      'pinnedQuickActions',
    ]);
    const isPinned =
      Array.isArray(pinnedQuickActions) &&
      pinnedQuickActions.some((pinId) => String(pinId) === instructionId);
    const instruction =
      Array.isArray(instructions) &&
      instructions.find((entry) => String(entry?.id || '') === instructionId);
    if (!isPinned || !instruction) {
      return { success: false, error: 'Pinned prompt is no longer available.' };
    }
    const selectedText = String(request?.selectedText || '')
      .trim()
      .slice(0, NOTCH_MAX_SELECTION_CHARS);
    let pageData = null;
    if (!selectedText) {
      const extracted = await executeTabContentExtraction(tabId);
      if (extracted?.success && extracted.content) {
        pageData = {
          success: true,
          content: String(extracted.content).slice(0, NOTCH_MAX_PAGE_CHARS),
          title: String(extracted.title || tab.title || '').slice(0, 300),
          siteName: String(extracted.siteName || '').slice(0, 120),
          byline: String(extracted.byline || '').slice(0, 240),
          url: sanitizePageActionUrl(extracted.url || tab.url || ''),
          type: String(extracted.type || '').slice(0, 80),
        };
      }
    }
    const result = await createNotchPanelAction(
      'notchPinnedAction',
      tabId,
      { instructionId, selectedText, pageData },
      panelOpenPromise
    );
    return { success: true, queued: result.queuedFallback };
  }

  if (action === 'sendInstruction') {
    const textPrompt =
      typeof request?.textPrompt === 'string'
        ? request.textPrompt.trim().slice(0, NOTCH_MAX_INSTRUCTION_CHARS)
        : '';
    if (!textPrompt) return { success: false, error: 'An instruction is required.' };
    const selectedText = String(request?.selectedText || '')
      .trim()
      .slice(0, NOTCH_MAX_SELECTION_CHARS);
    let pageData = null;
    if (request?.includePageContext === true) {
      const extracted = await executeTabContentExtraction(tabId);
      if (extracted?.isPdf) {
        pageData = {
          isPdf: true,
          pdfUrl: sanitizePageActionUrl(extracted.pdfUrl || tab.url || ''),
          title: String(extracted.title || tab.title || '').slice(0, 300),
        };
      } else if (extracted?.success && extracted.content) {
        pageData = {
          success: true,
          content: String(extracted.content).slice(0, NOTCH_MAX_PAGE_CHARS),
          title: String(extracted.title || tab.title || '').slice(0, 300),
          siteName: String(extracted.siteName || '').slice(0, 120),
          byline: String(extracted.byline || '').slice(0, 240),
          url: sanitizePageActionUrl(extracted.url || tab.url || ''),
          type: String(extracted.type || '').slice(0, 80),
        };
      }
      if (!pageData) {
        return {
          success: false,
          error: extracted?.error || 'No page content was available for dictation.',
        };
      }
    }
    const result = await createNotchPanelAction(
      'notchInstructionAction',
      tabId,
      {
        textPrompt,
        selectedText: pageData ? '' : selectedText,
        pageData,
        includePageContext: request?.includePageContext === true,
        act: request?.act === true,
      },
      panelAlreadyOpen ? Promise.resolve() : panelOpenPromise
    );
    return { success: true, queued: result.queuedFallback };
  }

  if (action === 'openActions') {
    const result = await createNotchPanelAction('notchOpenActions', tabId, {}, panelOpenPromise);
    return { success: true, queued: result.queuedFallback };
  }

  if (action === 'explainSelection') {
    const selectedText = String(request?.selectedText || '')
      .trim()
      .slice(0, NOTCH_MAX_SELECTION_CHARS);
    if (!selectedText) return { success: false, error: 'Select text first.' };
    const result = await createNotchPanelAction(
      'notchSelectionAction',
      tabId,
      { selectedText },
      panelOpenPromise
    );
    return { success: true, queued: result.queuedFallback };
  }

  const pageData = await executeTabContentExtraction(tabId);
  if (pageData?.isPdf) {
    const result = await createNotchPanelAction(
      'notchPageAction',
      tabId,
      {
        pageData: {
          success: true,
          isPdf: true,
          pdfUrl: sanitizePageActionUrl(pageData.pdfUrl || tab.url || ''),
          title: String(pageData.title || tab.title || '').slice(0, 300),
        },
      },
      panelOpenPromise
    );
    return { success: true, queued: result.queuedFallback };
  }
  if (!pageData?.success || !pageData.content) {
    return { success: false, error: pageData?.error || 'No page content was available.' };
  }
  const boundedPageData = {
    success: true,
    content: String(pageData.content).slice(0, NOTCH_MAX_PAGE_CHARS),
    title: String(pageData.title || '').slice(0, 300),
    siteName: String(pageData.siteName || '').slice(0, 120),
    byline: String(pageData.byline || '').slice(0, 240),
    url: sanitizePageActionUrl(pageData.url || tab.url || ''),
    type: String(pageData.type || '').slice(0, 80),
  };
  const result = await createNotchPanelAction(
    'notchPageAction',
    tabId,
    { pageData: boundedPageData },
    panelOpenPromise
  );
  return { success: true, queued: result.queuedFallback };
}

// Listener for messages from content scripts or other extension parts (like chat.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const messageDependencies = {
    extensionOrigin: getExtensionOrigin(),
    isExtensionSender,
    isContentScriptSender,
    requestMatchesSenderTab,
    rejectUnauthorizedMessage,
    recordRemoteDevDiagnostic,
    getDevDiagnosticsStatus,
    handleNotchAction,
    improveInstructionForProfile,
    sendResponse,
  };
  const diagnosticsMessage = handleDevDiagnosticsMessage(request, sender, messageDependencies);
  if (diagnosticsMessage !== null) return diagnosticsMessage;
  const notchMessage = handleNotchMessage(request, sender, messageDependencies);
  if (notchMessage !== null) return notchMessage;
  const improveInstructionMessage = handleImproveInstructionMessage(
    request,
    sender,
    messageDependencies
  );
  if (improveInstructionMessage !== null) return improveInstructionMessage;
  const extensionOrigin = getExtensionOrigin();
  const extensionPageSender = isExtensionSender(sender, extensionOrigin);
  recordDevDiagnostic('runtime_message_received', {
    action: request?.action,
    sender: {
      extensionPage: extensionPageSender,
      contentScript: isContentScriptSender(sender, extensionOrigin),
      tabId: sender?.tab?.id || null,
      frameId: sender?.frameId || 0,
    },
    requestKeys: request && typeof request === 'object' ? Object.keys(request).sort() : [],
  });

  const panelMessage = handlePanelMessage(request, sender, {
    chrome,
    extensionOrigin,
    extensionPageSender,
    isContentScriptSender,
    openChatInTab,
    openChatWithContext,
    openPromptPaulForSelection,
    rejectUnauthorizedMessage,
    requestMatchesSenderTab,
    resolvePanelTabId,
    sendResponse,
  });
  if (panelMessage !== null) return panelMessage;

  const pageContentMessage = handlePageContentMessage(request, sender, {
    chrome,
    extensionOrigin,
    extensionPageSender,
    executeTabContentExtraction,
    friendlyRuntimeErrorMessage,
    isContentScriptSender,
    rejectUnauthorizedMessage,
    sendResponse,
  });
  if (pageContentMessage !== null) return pageContentMessage;

  const skillMessage = handleSkillMessage(request, sender, {
    extensionPageSender,
    rejectUnauthorizedMessage,
    sendResponse,
    skillManager,
  });
  if (skillMessage !== null) return skillMessage;

  // ===== Web Search Status =====

  const searchMessage = handleSearchMessage(request, sender, {
    chrome,
    extensionPageSender,
    rejectUnauthorizedMessage,
    sendResponse,
  });
  if (searchMessage !== null) return searchMessage;

  const providerMessage = handleProviderMessage(request, sender, {
    chrome,
    codexAuthManager,
    extensionPageSender,
    fetchAvailableModels,
    getHermesCredential,
    getHermesEndpoint,
    hermesSessionResetLock,
    hermesTransport,
    removeHermesCredential,
    removeProfileHermesState,
    rejectUnauthorizedMessage,
    runOrchestrator,
    sendResponse,
    setHermesCredential,
    supportsHermesClientTools,
    validateHermesKey,
  });
  if (providerMessage !== null) return providerMessage;

  // ===== Orchestration Handlers =====

  const runMessage = handleRunMessage(request, sender, {
    chrome,
    clearPageActionCheckpoint,
    extensionPageSender,
    getPageActionCheckpoint,
    getRunJournalStorageKey: RunOrchestrator.getRunJournalStorageKey,
    hermesSessionResetLock,
    isAuthorizedRunRequest,
    randomId,
    rejectUnauthorizedMessage,
    resolvePanelTabId,
    resolveStoredRunConfig,
    runOrchestrator,
    sendResponse,
  });
  if (runMessage !== null) return runMessage;

  const pageActionMessage = handlePageActionMessage(request, sender, {
    chrome,
    extensionPageSender,
    getPageActionSiteOrigin,
    getProfileToolSupport,
    isAuthorizedRunRequest,
    pageActionDocumentProvider,
    pageActionSitePolicyStore,
    rejectUnauthorizedMessage,
    resolvePreferredProfile,
    runOrchestrator,
    sendResponse,
  });
  if (pageActionMessage !== null) return pageActionMessage;

  // Handle other actions if any
});

// Website deep links: promptpaul.juanmackie.com can open the canonical chat
// with context via chrome.runtime.sendMessage(EXTENSION_ID, { action: 'openChat',
// context: { selectedText, mediaUrl, mediaType, instruction } }).
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  return handleExternalPanelMessage(request, sender, { openChatWithContext, sendResponse });
});
