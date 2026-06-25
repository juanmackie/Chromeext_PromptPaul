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

import { isValidURL } from './src/utils/validation.js';
import { parseSkillMarkdown, migrateLegacySkill } from './src/utils/skillParser.js';
import { getCurrentPageSupport } from './src/utils/permissionGuards.js';
import {
  classifyRuntimeMessageError,
  friendlyRuntimeErrorMessage,
} from './src/utils/runtimeErrors.js';
import { normalizeToolChoice } from './src/utils/toolChoiceBuilder.js';
import { resolvePreferredProfile } from './src/utils/profileRouting.js';
import { CONTEXT_MENU_PROMPTS } from './src/prompts.js';

// ===== Umami Analytics Module (privacy-first, opt-out) =====
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

/**
 * Generates a UUID v4 compliant unique identifier.
 * @returns {string} A randomly generated UUID string.
 */
function uuidv4() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
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
  } catch (_) {}
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
    instance = uuidv4();
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
 * Tracks when the extension is installed or updated.
 * @returns {Promise<void>}
 */
async function trackInstalled() {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  await sendUmamiEvent('installed', { ...env, instance });
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
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          const lastErrorMessage = chrome.runtime.lastError.message;
          queuePendingPanelAction(payload).then((queued) => {
            if (!queued) {
              console.warn(
                `Background: sendMessage (${payload.action}) failed and queue fallback failed:`,
                lastErrorMessage
              );
            }
            resolve({ queuedFallback: queued, response: null });
          });
          return;
        }

        resolve({ queuedFallback: false, response });
      });
    } catch (error) {
      queuePendingPanelAction(payload).then((queued) => {
        if (!queued) {
          console.error(
            `Background: Exception sending message (${payload.action}):`,
            error.message
          );
        }
        resolve({ queuedFallback: queued, response: null });
      });
    }
  });
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
 * Fetches media from a URL and converts it to base64 encoding.
 * @param {string} url - The URL of the media to fetch.
 * @returns {Promise<{base64:string,mimeType:string}>} Base64 encoded string and MIME type.
 * @throws {Error} If the fetch fails or the media cannot be read.
 */
async function fetchMediaAsBase64(url) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
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
    console.error('Error fetching media:', error);
    throw error;
  }
}

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
  if (!tab || tab.id === -1 || tab.id === undefined) {
    console.warn('Context menu invoked from invalid tab context - ignoring');
    return;
  }

  try {
    await chrome.sidePanel.open({ tabId: tab.id });

    // Detect media context
    const isMediaContext =
      info.mediaType === 'image' || info.mediaType === 'video' || info.mediaType === 'audio';
    const mediaUrl = info.srcUrl || '';
    const mediaType = info.mediaType || 'text';

    // Normalize selection text to avoid undefined
    let originalSelectionText = info.selectionText || '';
    let promptContent = originalSelectionText;

    // Fetch tab content only if we have no media and no selection
    if (!isMediaContext && !originalSelectionText) {
      try {
        const tabDataResponse = await executeTabContentExtraction(tab.id);
        if (tabDataResponse && tabDataResponse.success) {
          promptContent = tabDataResponse.content || tabDataResponse.data || '';
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
        } catch (_) {}

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
        } catch (_) {}

        const toolChoice = normalizeToolChoice(instruction.tool_choice);

        // Send to chat for processing
        await sendPanelMessage({
          action: 'setMediaForAnalysis',
          mediaData: {
            ...mediaData,
            actionType: 'custom',
            instructionId: instructionId,
            textPrompt: isMediaContext ? null : `${instruction.content}\n\n${promptContent}`,
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
      } catch (_) {}

      // Send to chat for processing
      const actionType = info.menuItemId;
      await sendPanelMessage({
        action: 'setMediaForAnalysis',
        mediaData: {
          ...mediaData,
          actionType: actionType,
          instructionId: null,
          textPrompt: isMediaContext ? null : `${commandMap[info.menuItemId]}:\n\n${promptContent}`,
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
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], resolve)
  );

  const profiles = result.profiles || [];
  const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
  const defaultLlmEndpoint = result.defaultLlmEndpoint || '';

  // Find profiles
  const selectedProfile = profiles.find((p) => p.id === lastSelectedProfileId);
  const defaultProfile = profiles.find((p) => p.id === 'default');
  const validProfile = resolvePreferredProfile({
    selectedProfile,
    defaultProfile,
    defaultLlmEndpoint,
  });

  if (validProfile) {
    return validProfile;
  }

  // Handle errors
  const hasEndpoint = defaultLlmEndpoint && isValidURL(defaultLlmEndpoint);
  const hasValidProfile = selectedProfile || defaultProfile;

  if (!hasEndpoint) {
    throw new Error(
      'LLM API endpoint is missing or invalid. Please configure it in the options page.'
    );
  } else if (!hasValidProfile) {
    throw new Error('No valid profiles found. Please create a profile in the options page.');
  } else {
    throw new Error(
      'Configuration is incomplete. Please set API key and model name in the options page.'
    );
  }
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
          const skillMd = skill.skillMd || migrateLegacySkill(skill).skillMd;
          const parsed = parseSkillMarkdown(skillMd);

          if (parsed.valid) {
            targetMap.set(parsed.metadata.name, {
              metadata: parsed.metadata,
              parsed: parsed,
              raw: skillMd,
              type: 'custom',
              lastUpdated: skill.lastUpdated,
              legacy: !skill.skillMd,
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
const runOrchestrator = new RunOrchestrator(skillManager, {
  userToolExecutor: (tool, args) =>
    callUserDefinedEndpoint(tool.endpointUrl, args, tool.httpMethod),
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
 * Opens the side panel for a tab and forwards selected text into it.
 * @param {number} tabId - Source tab ID.
 * @param {string} selectedText - Selected text to send.
 * @returns {Promise<void>}
 */
async function openPromptPaulForSelection(tabId, selectedText) {
  await chrome.sidePanel.open({ tabId });
  await sendPanelMessage({
    action: 'setSelectedText',
    selectedText: selectedText || '',
    tabId,
    actionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

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
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?firstRun=1') });
  }
});

// Also rebuild on browser startup (service worker may restart)
chrome.runtime.onStartup.addListener(async () => {
  await queueMenuRebuild('onStartup');
});

// Update context menus when instructions change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes.instructions) {
    // Use the queue to prevent race conditions
    await queueMenuRebuild('instructions-changed');
  }
});

// --- Tool Execution Logic ---

// Generic function to call a user-defined endpoint
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod = 'GET') {
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
    let finalArgs = args;

    const isEmptyArgs = !args || Object.keys(args).length === 0;
    let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
    method = method.toUpperCase();
    finalFetchOptions.method = method;

    if (method === 'GET' && !isEmptyArgs) {
      const queryParams = new URLSearchParams(finalArgs).toString();
      finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
    } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
      finalFetchOptions.headers['Content-Type'] = 'application/json';
      finalFetchOptions.body = JSON.stringify(finalArgs);
    }
    // For DELETE, args might be used in the URL path or ignored

    const response = await fetch(finalEndpointUrl, finalFetchOptions); // Use finalEndpointUrl and finalFetchOptions
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text(); // Try to get error details from response body
      } catch (_) {
        /* Ignore if body cannot be read */
      }
      const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
      console.error(`Background: HTTP error for ${finalEndpointUrl}:`, errorMsg);
      throw new Error(errorMsg);
    }

    // Attempt to parse response as JSON, fall back to text if not JSON
    const contentType = response.headers.get('content-type');

    let result;
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`Background: Tool call to ${endpointUrl} timed out after 60 seconds.`);
      throw new Error(`Tool call to ${endpointUrl} timed out after 60 seconds.`);
    }
    console.error(`Background: Error calling endpoint ${endpointUrl}:`, error);
    // Rethrow a more specific error message
    throw new Error(`Failed to call endpoint ${endpointUrl}: ${error.message}`);
  }
}

// Registry for built-in tool implementations — now handled by RunOrchestrator

// True when a URL points at a PDF document (by path extension).
function isPdfUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

// Unified extraction function to avoid circular messaging and redundant injections
async function executeTabContentExtraction(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      // PDFs can't be read from the DOM (native viewer is an opaque plugin); the
      // chat page parses the bytes with pdf.js instead. Route by URL before the
      // restriction guard so local file:// PDFs aren't blocked as `file:` pages.
      if (isPdfUrl(tab?.url)) {
        resolve({ success: false, isPdf: true, pdfUrl: tab.url, title: tab.title || '' });
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

      const support = getCurrentPageSupport(tab?.url);
      if (!support.available) {
        resolve({ success: false, error: support.blockedReason, readStrategy: 'auto' });
        return;
      }

      const timeoutId = setTimeout(() => {
        resolve({ success: false, error: 'Extraction timed out', readStrategy: 'auto' });
      }, 15000);

      chrome.tabs.sendMessage(tabId, { action: 'getTabContent' }, (response) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          const runtimeError = chrome.runtime.lastError.message;
          const errorKind = classifyRuntimeMessageError(runtimeError);
          console.warn(
            'Background: Tab message failed (script might not be loaded):',
            runtimeError
          );
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
                      errorKind: classifyRuntimeMessageError(chrome.runtime.lastError.message),
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
        } else {
          resolve(
            response || {
              success: false,
              error: 'Empty response from content script',
              readStrategy: 'auto',
            }
          );
        }
      });
    });
  });
}

// Listener for messages from content scripts or other extension parts (like chat.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openPromptPaulFromSelection') {
    const tabId = request.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab context' });
      return false;
    }

    const selectedText = String(request.selectedText || '').trim();
    if (!selectedText) {
      sendResponse({ success: false, error: 'No selected text provided' });
      return false;
    }

    openPromptPaulForSelection(tabId, selectedText)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('Background: Failed to open Prompt Paul from selection:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'openOptionsPage') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'captureScreenshot') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ dataUrl: null, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true;
  }

  if (request.action === 'getLoadContent') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        const result = await executeTabContentExtraction(tabs[0].id);
        sendResponse({
          action: 'loadContentResponse',
          success: result.success,
          isPdf: result.isPdf || false,
          pdfUrl: result.pdfUrl || null,
          content: result.content || result.data,
          title: result.title,
          siteName: result.siteName,
          byline: result.byline,
          excerpt: result.excerpt,
          lang: result.lang,
          url: result.url,
          platform: result.platform || null,
          platformInfo: result.platformInfo || null,
          readStrategy: result.readStrategy || 'auto',
          screenshot: result.screenshot || null,
          error: result.error,
        });
      } else {
        sendResponse({
          action: 'loadContentResponse',
          success: false,
          error: 'No active tab found',
        });
      }
    });
    return true;
  }

  if (request.action === 'getTabContent') {
    const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
    if (tabId) {
      executeTabContentExtraction(tabId).then((result) => {
        sendResponse({
          action: 'tabContentResponse',
          success: result.success,
          content: result.content || result.data,
          title: result.title,
          siteName: result.siteName,
          byline: result.byline,
          excerpt: result.excerpt,
          lang: result.lang,
          url: result.url,
          platform: result.platform || null,
          platformInfo: result.platformInfo || null,
          readStrategy: result.readStrategy || 'auto',
          screenshot: result.screenshot || null,
          error: result.error,
        });
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          const result = await executeTabContentExtraction(tabs[0].id);
          sendResponse({
            action: 'tabContentResponse',
            success: result.success,
            content: result.content || result.data,
            title: result.title,
            siteName: result.siteName,
            byline: result.byline,
            excerpt: result.excerpt,
            lang: result.lang,
            url: result.url,
            platform: result.platform || null,
            platformInfo: result.platformInfo || null,
            readStrategy: result.readStrategy || 'auto',
            screenshot: result.screenshot || null,
            error: result.error,
          });
        } else {
          sendResponse({ action: 'tabContentResponse', success: false, error: 'No tab context' });
        }
      });
    }
    return true;
  }

  if (request.action === 'getPinnedActionTabContent') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        const result = await executeTabContentExtraction(tabs[0].id);
        sendResponse({
          action: 'pinnedActionTabContentResponse',
          success: result.success,
          content: result.content || result.data,
          title: result.title,
          siteName: result.siteName,
          byline: result.byline,
          excerpt: result.excerpt,
          lang: result.lang,
          url: result.url,
          error: result.error,
          instruction: request.instruction,
        });
      } else {
        sendResponse({
          action: 'pinnedActionTabContentResponse',
          success: false,
          error: 'No active tab found',
          instruction: request.instruction,
        });
      }
    });
    return true;
  }

  if (request.action === 'getSkills') {
    const skillsList = skillManager.getSkillsList();
    const slashCommands = skillManager.getSlashCommands();
    sendResponse({ skills: skillsList, slashCommands });
    return true;
  }

  if (request.action === 'getSkillContent') {
    skillManager
      .getSkillContent(request.name)
      .then((content) => {
        sendResponse({ content });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (request.action === 'resolveSkill') {
    const resolved = skillManager.resolveSkill(request.name);
    sendResponse({ skill: resolved });
    return true;
  }

  if (request.action === 'getSkillSnapshot') {
    const snapshot = skillManager.getEligibleSnapshot();
    const promptText = skillManager.formatForPrompt();
    sendResponse({ snapshot, promptText });
    return true;
  }

  if (request.action === 'getExplainContent') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        const result = await executeTabContentExtraction(tabs[0].id);
        sendResponse({
          action: 'explainContentResponse',
          success: result.success,
          content: result.content || result.data,
          title: result.title,
          siteName: result.siteName,
          byline: result.byline,
          excerpt: result.excerpt,
          lang: result.lang,
          url: result.url,
          error: result.error,
        });
      } else {
        sendResponse({
          action: 'explainContentResponse',
          success: false,
          error: 'No active tab found',
        });
      }
    });
    return true;
  }

  // ===== Orchestration Handlers =====

  if (request.action === 'startRun') {
    const { config } = request;
    runOrchestrator
      .startRun(config)
      .then((runId) => {
        sendResponse({ runId });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (request.action === 'executeRun') {
    const { runId, requestConfig } = request;
    runOrchestrator
      .execute(runId, requestConfig)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (request.action === 'executeTool') {
    const { runId, toolCall } = request;
    runOrchestrator
      .executeTool(runId, toolCall)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (request.action === 'abortRun') {
    const { runId } = request;
    runOrchestrator.abort(runId);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'getTools') {
    sendResponse({ tools: runOrchestrator.getToolImplementations() });
    return true;
  }

  // Legacy handler for backward compatibility
  if (request.action === 'executePromptPaulTool') {
    const { id, name, arguments: argsString } = request.toolCall;

    const normalizedArgs =
      typeof argsString === 'string' ? argsString : JSON.stringify(argsString || {});

    runOrchestrator
      .executeTool(null, { id, function: { name, arguments: normalizedArgs } })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'executeLlmApiRequest') {
    const { prompt, tool_choice } = request;
    const sourceTabId = sender.tab?.id || null;
    // Use orchestrator instead of legacy makeLlmApiRequest
    runOrchestrator
      .startRun({ tool_choice, sourceTabId })
      .then((runId) => {
        return runOrchestrator.execute(runId, { messages: [{ role: 'user', content: prompt }] });
      })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  }
  // Handle other actions if any
});
