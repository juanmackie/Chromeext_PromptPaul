/**
 * @fileoverview Opt-in development diagnostics for extension troubleshooting.
 *
 * Detailed diagnostics are available only in development builds. Records are
 * session-scoped, bounded, and redact credential-shaped values before they are
 * written to the service-worker console or session storage.
 *
 * @module devDiagnostics
 */

export const DEV_DIAGNOSTICS_CONFIG_KEY = 'promptPaulDevDiagnosticsConfigV1';
export const DEV_DIAGNOSTICS_STORAGE_KEY = 'promptPaulDevDiagnosticsV1';

const MAX_ENTRY_CHARS = 96 * 1024;
const MAX_TOTAL_CHARS = 2 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const DEFAULT_TTL_MS = 60 * 60 * 1_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1_000;
const SECRET_KEY_PATTERN =
  /^(?:api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|session[_-]?(?:key|id)|authorization|cookie|password|passcode|otp|credential|client[_-]?secret|secret|private[_-]?key|token)$/i;
const URL_KEY_PATTERN = /(?:url|href)$/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /((?:api[_-]?key|x-api-key|client[_-]?secret|access[_-]?token|refresh[_-]?token|session[_-]?(?:key|id)|authorization|password|otp|secret|token)\s*[:=]\s*["']?)[^\s"',}]+/gi,
];

let context = 'unknown';
let enabled = false;
let expiresAt = 0;
let initialized = false;
let sequence = 0;
let writeQueue = Promise.resolve();

function sessionStorage() {
  return typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
}

function applyConfig(config) {
  expiresAt = Number(config?.expiresAt || 0);
  enabled = config?.enabled === true && expiresAt > Date.now();
  if (!enabled && config?.enabled === true && expiresAt > 0) {
    void sessionStorage()?.set({
      [DEV_DIAGNOSTICS_CONFIG_KEY]: { enabled: false, expiresAt: 0 },
    });
  }
}

/**
 * Initialize the session-scoped development tracer for one extension context.
 * @param {string} [nextContext]
 * @returns {Promise<boolean>}
 */
export async function initializeDevDiagnostics(nextContext = 'unknown') {
  context = String(nextContext || 'unknown').slice(0, 40);
  if (initialized) return enabled;
  initialized = true;
  const storage = sessionStorage();
  if (!storage) return false;
  try {
    const result = await storage.get(DEV_DIAGNOSTICS_CONFIG_KEY);
    applyConfig(result?.[DEV_DIAGNOSTICS_CONFIG_KEY]);
    chrome.storage.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'session' || !changes[DEV_DIAGNOSTICS_CONFIG_KEY]) return;
      applyConfig(changes[DEV_DIAGNOSTICS_CONFIG_KEY].newValue);
    });
  } catch (_) {
    enabled = false;
  }
  return enabled;
}

/**
 * Enable detailed diagnostics for a bounded session window.
 * @param {number} [ttlMs]
 * @returns {Promise<boolean>}
 */
export async function enableDevDiagnostics(ttlMs = DEFAULT_TTL_MS) {
  const storage = sessionStorage();
  if (!storage) return false;
  const boundedTtl = Math.min(MAX_TTL_MS, Math.max(1_000, Number(ttlMs) || DEFAULT_TTL_MS));
  const config = { enabled: true, expiresAt: Date.now() + boundedTtl };
  enabled = true;
  expiresAt = config.expiresAt;
  await storage.set({ [DEV_DIAGNOSTICS_CONFIG_KEY]: config });
  return true;
}

/**
 * Return whether this context currently has tracing enabled.
 * @returns {boolean}
 */
export function isDevDiagnosticsEnabled() {
  return tracingIsActive();
}
/**
 * Return the current tracing state for other extension contexts.
 * @returns {{enabled: boolean, expiresAt: number}}
 */
export function getDevDiagnosticsStatus() {
  return { enabled: tracingIsActive(), expiresAt: enabled ? expiresAt : 0 };
}

/**
 * Disable diagnostics without deleting the collected session records.
 * @returns {Promise<boolean>}
 */
export async function disableDevDiagnostics() {
  const storage = sessionStorage();
  enabled = false;
  expiresAt = 0;
  if (!storage) return false;
  await storage.set({ [DEV_DIAGNOSTICS_CONFIG_KEY]: { enabled: false, expiresAt: 0 } });
  return true;
}

function redactString(value) {
  let result = String(value);
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, (match, prefix) => {
      if (/^Bearer/i.test(match)) return 'Bearer [REDACTED]';
      return prefix ? `${prefix}[REDACTED]` : '[REDACTED]';
    });
  }
  return result.length > 32_000 ? `${result.slice(0, 32_000)}…[truncated]` : result;
}

function sanitizeValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (SECRET_KEY_PATTERN.test(String(key))) return '[REDACTED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (URL_KEY_PATTERN.test(String(key))) {
      try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname}`.slice(0, 2_000);
      } catch (_) {
        return redactString(value);
      }
    }
    return redactString(value);
  }
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
      stack: redactString(value.stack || ''),
      code: redactString(value.code || ''),
    };
  }
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (depth >= 6) return '[depth limit]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, '', depth + 1, seen));
  }

  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    output[childKey] = sanitizeValue(childValue, childKey, depth + 1, seen);
  }
  return output;
}

function buildEntry(event, details) {
  return {
    schemaVersion: 1,
    sequence: ++sequence,
    timestamp: Date.now(),
    context,
    event: redactString(event).slice(0, 100),
    data: sanitizeValue(details),
  };
}

function boundEntry(entry) {
  const serialized = JSON.stringify(entry);
  if (serialized.length <= MAX_ENTRY_CHARS) return entry;
  const data = entry?.data;
  const summary = Array.isArray(data)
    ? { type: 'array', length: data.length }
    : data && typeof data === 'object'
      ? { type: 'object', keys: Object.keys(data).slice(0, 40) }
      : { type: typeof data, preview: String(data || '').slice(0, 2_000) };
  return {
    ...entry,
    data: { truncated: true, originalChars: serialized.length, summary },
  };
}

function tracingIsActive() {
  if (!enabled) return false;
  if (expiresAt <= Date.now()) {
    enabled = false;
    return false;
  }
  return true;
}

async function appendEntry(entry) {
  const storage = sessionStorage();
  entry = boundEntry(entry);
  if (!storage) return;
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const result = await storage.get(DEV_DIAGNOSTICS_STORAGE_KEY);
      const existing = result?.[DEV_DIAGNOSTICS_STORAGE_KEY];
      const entries = Array.isArray(existing?.entries) ? existing.entries : [];
      entries.push(entry);
      while (entries.length > MAX_ENTRIES) entries.shift();
      while (JSON.stringify(entries).length > MAX_TOTAL_CHARS && entries.length > 1) {
        entries.shift();
      }
      await storage.set({
        [DEV_DIAGNOSTICS_STORAGE_KEY]: {
          schemaVersion: 1,
          updatedAt: Date.now(),
          entries,
        },
      });
    });
  await writeQueue;
}

/**
 * Sanitize a diagnostic payload before recording or displaying it.
 * @param {unknown} value
 * @returns {unknown}
 */
export function sanitizeDevDiagnostic(value) {
  return sanitizeValue(value);
}

/**
 * Record a structured development event. It is a no-op when the development
 * tracer is disabled or when this function is supplied by a production build.
 * @param {string} event
 * @param {object} [details]
 * @returns {object|null}
 */
export function recordDevDiagnostic(event, details = {}, options = {}) {
  if (!enabled) return null;
  const entry = boundEntry(buildEntry(event, details));
  console.debug('[PromptPaul][diagnostic]', entry);
  if (options.persist === false) return entry;
  if (context === 'background') {
    void appendEntry(entry);
  } else if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ action: 'devDiagnostic', entry }).catch(() => {});
  }
  return entry;
}

/**
 * Accept a sanitized diagnostic sent by an extension page or content script.
 * @param {object} entry
 * @returns {boolean}
 */
export function recordRemoteDevDiagnostic(entry) {
  if (!enabled || !entry || typeof entry !== 'object') return false;
  const safeEntry = boundEntry(sanitizeValue(entry));
  console.debug('[PromptPaul][diagnostic]', safeEntry);
  void appendEntry(safeEntry);
  return true;
}

/**
 * Install error and rejection capture for an extension page or content script.
 * @param {string} [sourceContext]
 * @returns {void}
 */
export function installDevErrorHandlers(sourceContext = context) {
  const scope = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null;
  if (!scope || scope.__PROMPT_PAUL_DEV_ERRORS__) return;
  scope.__PROMPT_PAUL_DEV_ERRORS__ = true;
  scope.addEventListener('error', (event) => {
    recordDevDiagnostic('uncaught_error', {
      sourceContext,
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });
  scope.addEventListener('unhandledrejection', (event) => {
    recordDevDiagnostic('unhandled_rejection', {
      sourceContext,
      reason: event.reason,
    });
  });
}

/**
 * Read all collected diagnostics from the current browser session.
 * @returns {Promise<object>}
 */
export async function getDevDiagnostics() {
  const storage = sessionStorage();
  if (!storage) return { schemaVersion: 1, entries: [] };
  const result = await storage.get(DEV_DIAGNOSTICS_STORAGE_KEY);
  return result?.[DEV_DIAGNOSTICS_STORAGE_KEY] || { schemaVersion: 1, entries: [] };
}

/**
 * Delete all collected diagnostics and disable tracing.
 * @returns {Promise<boolean>}
 */
export async function clearDevDiagnostics() {
  const storage = sessionStorage();
  enabled = false;
  expiresAt = 0;
  if (!storage) return false;
  await storage.remove([DEV_DIAGNOSTICS_STORAGE_KEY, DEV_DIAGNOSTICS_CONFIG_KEY]);
  return true;
}
