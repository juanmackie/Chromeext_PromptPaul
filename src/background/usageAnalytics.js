/**
 * @fileoverview Usage-analytics payload helpers for the opt-in Umami events.
 * Labels are normalized and bounded so instruction, model, and tool names stay
 * useful for segmentation without carrying prompt text or credential values.
 * @module usageAnalytics
 */

const MAX_LABEL_CHARS = 64;
const MAX_MODEL_CHARS = 96;
const MAX_TOOL_LABELS = 8;

// Whole-value labels that must never leave the extension, even when a user
// names an instruction after a credential field. Matching the whole label
// keeps ordinary names such as "Email reply" or "Extract key points".
const SENSITIVE_LABELS = new Set([
  'api key',
  'api_key',
  'apikey',
  'access token',
  'auth token',
  'cookie',
  'passwd',
  'password',
  'secret',
  'ssid',
  'token',
]);

// Opaque credential shapes only. Model identifiers such as
// "claude-3-5-sonnet-20241022" are long but do not match these patterns.
const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs])[-_][a-z0-9_-]{12,}\b/i,
  /\b[a-f0-9]{32,}\b/i,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\./i,
];

const LABEL_DISALLOWED = /[^\p{L}\p{N} ._:/\-+&']+/gu;
const MODEL_DISALLOWED = /[^\p{L}\p{N} ._:@/+()-]+/gu;

function normalizeText(value, maxChars, disallowed) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\p{Cc}+/gu, ' ')
    .replace(disallowed, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return [...cleaned].slice(0, maxChars).join('').trim() || undefined;
}

/**
 * Normalize a coarse usage label such as an instruction name, feature name,
 * or error code. Returns undefined when the value looks like a secret or an
 * email address, or when nothing printable remains.
 * @param {unknown} value Raw label.
 * @returns {string|undefined} Bounded lowercase label.
 */
export function sanitizeAnalyticsLabel(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.normalize('NFKC').trim().toLowerCase();
  if (!raw || /\S+@\S+/.test(raw)) return undefined;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(raw))) return undefined;
  const label = normalizeText(raw, MAX_LABEL_CHARS, LABEL_DISALLOWED);
  if (!label || SENSITIVE_LABELS.has(label)) return undefined;
  return label;
}

/**
 * Normalize a provider model identifier. Model names are not user content, so
 * they keep provider punctuation and a larger bound than instruction labels.
 * @param {unknown} value Raw model name.
 * @returns {string|undefined} Bounded lowercase model label.
 */
export function sanitizeModelLabel(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.normalize('NFKC').trim().toLowerCase();
  if (SECRET_PATTERNS.some((pattern) => pattern.test(raw))) return undefined;
  return normalizeText(raw, MAX_MODEL_CHARS, MODEL_DISALLOWED);
}

/**
 * Turn an instruction's configured tool choice into bounded, deduplicated
 * tool labels. "none" is a mode rather than a tool and is dropped.
 * @param {unknown} value Tool choice string or array.
 * @returns {string[]} Up to eight tool labels.
 */
export function normalizeAnalyticsTools(value) {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const tools = [];
  for (const entry of entries) {
    const label = sanitizeAnalyticsLabel(String(entry));
    if (!label || label === 'none' || tools.includes(label)) continue;
    tools.push(label);
    if (tools.length >= MAX_TOOL_LABELS) break;
  }
  return tools;
}

/**
 * Build the Umami `/api/send` body for one usage event. The rotating instance
 * ID is also sent as the Umami distinct ID so visitor counts are meaningful.
 * @param {object} input
 * @param {string} input.website Umami website ID.
 * @param {string} input.name Stable event category.
 * @param {object} [input.data] Event data fields.
 * @param {string} [input.instance] Rotating pseudonymous instance ID.
 * @returns {{type: string, payload: object}} Umami request body.
 */
export function buildUsageEventPayload({ website, name, data, instance }) {
  const fields = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  const instruction =
    typeof fields.instruction === 'string' && fields.instruction ? fields.instruction : 'unknown';
  const model = typeof fields.model === 'string' && fields.model ? fields.model : 'unknown';
  const tools = Array.isArray(fields.tools) ? fields.tools : [];
  const distinctId = typeof instance === 'string' && instance ? instance : fields.instance;
  const pathKey = instruction === 'unknown' ? name : instruction;

  return {
    type: 'event',
    payload: {
      website,
      hostname: 'extension',
      url: `/ext/usage/${encodeURIComponent(pathKey)}`,
      referrer: '',
      name,
      ...(typeof distinctId === 'string' && distinctId ? { id: distinctId } : {}),
      data: {
        ...fields,
        instruction,
        model,
        tools,
      },
    },
  };
}
