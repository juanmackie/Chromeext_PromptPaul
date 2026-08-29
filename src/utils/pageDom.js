/**
 * @fileoverview Bounded semantic page-state normalization for page actions.
 * @module pageDom
 */

export const PAGE_DOM_CAPS = Object.freeze({
  maxElements: 120,
  maxSnapshotChars: 16_000,
  maxElementTextChars: 240,
  maxAttributeChars: 120,
  maxInputChars: 2_000,
  maxScrollPages: 5,
  // Total serialized snapshot budget (content + elements array). A control set
  // can otherwise reach 200 records with many 120-character fields, far beyond
  // the content-only cap.
  maxPayloadBytes: 64 * 1024,
});

const SENSITIVE_INPUT_PATTERN =
  /password|passcode|one[-_ ]?time|otp|2fa|secret|token|api[-_ ]?key|credit|card|cvv|cvc|ssn|social security/i;
const SENSITIVE_CONTROL_PATTERN =
  /password|passcode|one[-_ ]?time|otp|2fa|secret|token|api[-_ ]?key|credit\s+card|debit\s+card|card\s+number|cvv|cvc|ssn|social security/i;
const CONTROL_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'option',
  'summary',
  'label',
  '[contenteditable]',
]);

/**
 * Normalize arbitrary page text for safe prompt inclusion.
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
export function capPageText(value, maxLength = PAGE_DOM_CAPS.maxElementTextChars) {
  return String(value ?? '')
    .replace(/\u0000/gu, '') // eslint-disable-line no-control-regex
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, Math.max(0, maxLength));
}

function escapePageDisplay(value) {
  return capPageText(value).replace(/[<>]/gu, (character) => (character === '<' ? '&lt;' : '&gt;'));
}

/**
 * Determine whether an element's metadata indicates a sensitive field/control.
 * @param {object} element
 * @returns {boolean}
 */
export function isSensitivePageElement(element = {}) {
  const type = String(element.type || '').toLowerCase();
  const autocomplete = String(element.autocomplete || '').toLowerCase();
  const tag = String(element.tag || element.tagName || '').toLowerCase();
  const valueBearing =
    element.editable === true || ['input', 'textarea', 'select', 'option'].includes(tag);
  const descriptor = [
    element.tag,
    element.name,
    element.role,
    element.label,
    element.placeholder,
    element.text,
    type,
    autocomplete,
  ]
    .map((value) => String(value || ''))
    .join(' ');

  return (
    type === 'password' ||
    autocomplete.includes('current-password') ||
    autocomplete.includes('new-password') ||
    autocomplete.includes('one-time-code') ||
    (valueBearing ? SENSITIVE_INPUT_PATTERN : SENSITIVE_CONTROL_PATTERN).test(descriptor)
  );
}

/**
 * Normalize one content-script element record. Text input values are never
 * returned; checkbox/radio state is represented by `checked` only.
 * @param {object} raw
 * @param {number} index
 * @returns {object}
 */
export function normalizePageElement(raw = {}, index = 0) {
  const sensitive = Boolean(raw.sensitive) || isSensitivePageElement(raw);
  const tag = capPageText(raw.tag || raw.tagName || 'element', 32).toLowerCase();
  const normalized = {
    index: Math.max(0, Math.floor(Number(index) || 0)),
    tag,
    role: capPageText(raw.role, PAGE_DOM_CAPS.maxAttributeChars),
    name: capPageText(raw.name, PAGE_DOM_CAPS.maxAttributeChars),
    label: capPageText(raw.label, PAGE_DOM_CAPS.maxAttributeChars),
    placeholder: capPageText(raw.placeholder, PAGE_DOM_CAPS.maxAttributeChars),
    type: capPageText(raw.type, 32).toLowerCase(),
    text: capPageText(raw.text),
    disabled: Boolean(raw.disabled),
    checked: typeof raw.checked === 'boolean' ? raw.checked : undefined,
    editable: raw.editable === true ? true : undefined,
    newlyVisible: raw.newlyVisible === true ? true : undefined,
    sensitive,
    valuePresent: Boolean(raw.valuePresent),
  };

  if ((tag === 'a' || normalized.role === 'link') && raw.href) {
    try {
      const link = new URL(String(raw.href));
      if (['http:', 'https:'].includes(link.protocol)) {
        link.search = '';
        link.hash = '';
        normalized.href = link.href;
      }
    } catch (_) {
      // Invalid link destinations stay unavailable to page actions.
    }
    const target = capPageText(raw.target, 32).toLowerCase();
    if (target) normalized.target = target;
    if (raw.download === true) normalized.download = true;
  }

  if (sensitive) {
    normalized.text = '';
    normalized.placeholder = '';
    normalized.valuePresent = Boolean(raw.valuePresent);
  }

  for (const key of Object.keys(normalized)) {
    if (normalized[key] === undefined || normalized[key] === '') delete normalized[key];
  }
  return normalized;
}

/**
 * Return whether a DOM tag/record is a supported semantic control.
 * @param {object|string} value
 * @returns {boolean}
 */
export function isSupportedPageControl(value) {
  const tag = typeof value === 'string' ? value : value?.tag || value?.tagName;
  const normalized = String(tag || '').toLowerCase();
  return CONTROL_TAGS.has(normalized) || Boolean(value?.contenteditable);
}

/**
 * Format an element as compact, human-readable, untrusted page data.
 * @param {object} element
 * @returns {string}
 */
export function formatPageElement(element = {}) {
  const attrs = [];
  for (const key of ['role', 'name', 'label', 'placeholder', 'type', 'href', 'target']) {
    if (element[key]) attrs.push(`${key}=${JSON.stringify(capPageText(element[key], 80))}`);
  }
  if (element.checked !== undefined) attrs.push(`checked=${element.checked}`);
  if (element.disabled) attrs.push('disabled=true');
  if (element.editable) attrs.push('editable=true');
  if (element.newlyVisible) attrs.push('new=true');
  if (element.sensitive) attrs.push('sensitive=true');
  if (element.valuePresent) attrs.push('value_present=true');
  if (element.download) attrs.push('download=true');

  const tag = element.tag || 'element';
  const text = element.text ? ` ${JSON.stringify(escapePageDisplay(element.text))}` : '';
  return `[${element.index}] <${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${text}`;
}

/**
 * Redact a page URL to origin/path only: query strings and fragments may carry
 * tokens, message IDs, or other secrets and must not reach the model.
 * @param {unknown} rawUrl
 * @returns {string}
 */
export function sanitizePageActionUrl(rawUrl) {
  const value = String(rawUrl ?? '');
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_) {
    // Unparseable value: strip any query/fragment by hand and bound the result.
    return value.split(/[?#]/, 1)[0].slice(0, 2_048);
  }
}

const _textEncoder = new TextEncoder();

/**
 * UTF-8 byte length of a string (used to bound serialized payloads).
 * @param {unknown} text
 * @returns {number}
 */
export function utf8ByteLength(text) {
  return _textEncoder.encode(String(text ?? '')).length;
}

/**
 * Create a small deterministic hash for page fingerprints and action-loop
 * detection. This is intentionally non-cryptographic: it identifies whether
 * a bounded page state changed, it never authenticates page content.
 * @param {unknown} value
 * @returns {string}
 */
export function pageStateHash(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function capSnapshotText(value, maxLength) {
  return String(value ?? '')
    .replace(/\u0000/gu, '') // eslint-disable-line no-control-regex
    .replace(/\r\n/gu, '\n')
    .trim()
    .slice(0, Math.max(0, maxLength));
}

/**
 * Normalize a complete page snapshot and cap its serialized content.
 * @param {object} input
 * @returns {object}
 */
export function normalizePageSnapshot(input = {}) {
  const rawElements = Array.isArray(input.elements) ? input.elements : [];
  const maxChars = Math.min(
    PAGE_DOM_CAPS.maxSnapshotChars,
    Number(input.maxChars) || PAGE_DOM_CAPS.maxSnapshotChars
  );
  let elements = rawElements
    .filter((element) => isSupportedPageControl(element) || element?.tag)
    .slice(0, PAGE_DOM_CAPS.maxElements)
    .map((element, index) => normalizePageElement(element, element.index ?? index));

  const buildContent = (list) => capSnapshotText(list.map(formatPageElement).join('\n'), maxChars);
  let content = buildContent(elements);

  const payloadBase = {
    snapshotId: capPageText(input.snapshotId || '', 128),
    url: sanitizePageActionUrl(input.url),
    title: capPageText(input.title, 240),
    header: capPageText(input.header, 1_000),
    footer: capPageText(input.footer, 1_000),
    fingerprint: capPageText(input.fingerprint || '', 128),
    scroll: input.scroll && typeof input.scroll === 'object' ? input.scroll : undefined,
    scrollContainers: Array.isArray(input.scrollContainers)
      ? input.scrollContainers.slice(0, 16)
      : undefined,
    metrics: input.metrics && typeof input.metrics === 'object' ? input.metrics : undefined,
  };

  // Bound the complete serialized payload (content + elements array), not just
  // the content string, so a large control set cannot exceed the message budget.
  while (
    elements.length > 0 &&
    utf8ByteLength(JSON.stringify({ ...payloadBase, content, elements })) >
      PAGE_DOM_CAPS.maxPayloadBytes
  ) {
    elements = elements.slice(0, elements.length - 1);
    content = buildContent(elements);
  }

  return { ...payloadBase, content, elements };
}

/**
 * Check whether an action references the currently indexed snapshot.
 * @param {string} expected
 * @param {string} current
 * @returns {boolean}
 */
export function isCurrentSnapshot(expected, current) {
  return Boolean(expected && current && String(expected) === String(current));
}

export const pageDom = {
  PAGE_DOM_CAPS,
  capPageText,
  isSensitivePageElement,
  normalizePageElement,
  isSupportedPageControl,
  formatPageElement,
  normalizePageSnapshot,
  isCurrentSnapshot,
  sanitizePageActionUrl,
  utf8ByteLength,
  pageStateHash,
};
