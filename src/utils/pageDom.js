/**
 * @fileoverview Bounded semantic page-state normalization for page actions.
 * @module pageDom
 */

export const PAGE_DOM_CAPS = Object.freeze({
  maxElements: 200,
  maxSnapshotChars: 32_000,
  maxOutlineChars: 24_000,
  maxValueChars: 160,
  maxTotalValueChars: 8_000,
  maxReadableContentChars: 16_000,
  maxElementTextChars: 320,
  maxAttributeChars: 120,
  maxInputChars: 2_000,
  maxFindQueryChars: 160,
  maxWaitMs: 10_000,
  maxBatchActions: 6,
  maxScrollPages: 5,
  maxUrlChars: 2_048,
  // Total serialized snapshot budget (content + elements array). A control set
  // can otherwise reach 200 records with many 120-character fields, far beyond
  // the content-only cap.
  maxPayloadBytes: 128 * 1024,
});

export const PAGE_REGION_ID_PATTERN = /^region-\d+$/;

/**
 * Normalize a content-script-produced indexed region identifier.
 * Only region-N values are accepted; selectors and free text are rejected.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeRegionId(value) {
  const text = String(value ?? '').trim();
  if (!PAGE_REGION_ID_PATTERN.test(text)) return null;
  return text.slice(0, 32);
}

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
    ['password', 'hidden', 'file'].includes(type) ||
    autocomplete.includes('current-password') ||
    autocomplete.includes('new-password') ||
    autocomplete.includes('one-time-code') ||
    (valueBearing ? SENSITIVE_INPUT_PATTERN : SENSITIVE_CONTROL_PATTERN).test(descriptor)
  );
}

/**
 * Normalize one record, disclosing only bounded non-sensitive control values.
 * @param {object} raw
 * @param {number} index
 * @returns {object}
 */
export function normalizePageElement(raw = {}, index = 0) {
  const sensitive = Boolean(raw.sensitive) || isSensitivePageElement(raw);
  const tag = capPageText(raw.tag || raw.tagName || 'element', 32).toLowerCase();
  let frameOrigin = '';
  try {
    const parsedFrameOrigin = new URL(String(raw.frameOrigin || ''));
    if (['http:', 'https:'].includes(parsedFrameOrigin.protocol))
      frameOrigin = parsedFrameOrigin.origin;
  } catch (_) {
    frameOrigin = '';
  }
  const normalized = {
    index: Math.max(0, Math.floor(Number(index) || 0)),
    ...(frameOrigin ? { frameOrigin } : {}),
    elementKey: capPageText(raw.elementKey, 64),
    tag,
    role: capPageText(raw.role, PAGE_DOM_CAPS.maxAttributeChars),
    name: capPageText(raw.name, PAGE_DOM_CAPS.maxAttributeChars),
    label: capPageText(raw.label, PAGE_DOM_CAPS.maxAttributeChars),
    placeholder: capPageText(raw.placeholder, PAGE_DOM_CAPS.maxAttributeChars),
    type: capPageText(raw.type, 32).toLowerCase(),
    text: capPageText(raw.text),
    disabled: Boolean(raw.disabled),
    checked: typeof raw.checked === 'boolean' || raw.checked === 'mixed' ? raw.checked : undefined,
    expanded: typeof raw.expanded === 'boolean' ? raw.expanded : undefined,
    haspopup: normalizeAriaPopup(raw.haspopup),
    selected: typeof raw.selected === 'boolean' ? raw.selected : undefined,
    pressed: typeof raw.pressed === 'boolean' ? raw.pressed : undefined,
    current: normalizeAriaCurrent(raw.current),
    editable: raw.editable === true ? true : undefined,
    newlyVisible: raw.newlyVisible === true ? true : undefined,
    focused: raw.focused === true ? true : undefined,
    inForm: raw.inForm === true ? true : undefined,
    sensitive,
    value: !sensitive && typeof raw.value === 'string' ? capPageValue(raw.value) : undefined,
  };
  if (raw.submitControl && typeof raw.submitControl === 'object') {
    normalized.submitControl = normalizePageElement(
      { ...raw.submitControl, submitControl: undefined, value: undefined },
      0
    );
  }

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
  }

  for (const key of Object.keys(normalized)) {
    if (normalized[key] === undefined || (normalized[key] === '' && key !== 'value'))
      delete normalized[key];
  }
  return normalized;
}

/** Bound and redact a non-sensitive field value without flattening its whitespace. */
export function capPageValue(value, maxLength = PAGE_DOM_CAPS.maxValueChars) {
  return String(value ?? '')
    .replace(/\u0000/gu, '') // eslint-disable-line no-control-regex
    .replace(/\b(?:\d[ -]*?){13,19}\b/gu, '[REDACTED_NUMBER]')
    .replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/gu, '[REDACTED_ID]')
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, '[REDACTED_TOKEN]')
    .slice(0, Math.max(0, maxLength));
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
  if (element.expanded !== undefined) attrs.push(`expanded=${element.expanded}`);
  if (element.haspopup !== undefined) attrs.push(`haspopup=${element.haspopup}`);
  if (element.selected !== undefined) attrs.push(`selected=${element.selected}`);
  if (element.pressed !== undefined) attrs.push(`pressed=${element.pressed}`);
  if (element.current !== undefined) attrs.push(`current=${element.current}`);
  if (element.disabled) attrs.push('disabled=true');
  if (element.editable) attrs.push('editable=true');
  if (element.newlyVisible) attrs.push('new=true');
  if (element.sensitive) attrs.push('sensitive=true');
  if (typeof element.value === 'string' && !element.sensitive)
    attrs.push(`value=${JSON.stringify(element.value)}`);
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
    const availablePathChars = Math.max(0, PAGE_DOM_CAPS.maxUrlChars - parsed.origin.length);
    return `${parsed.origin}${parsed.pathname.slice(0, availablePathChars)}`.slice(
      0,
      PAGE_DOM_CAPS.maxUrlChars
    );
  } catch (_) {
    // Unparseable value: strip any query/fragment by hand and bound the result.
    return value.split(/[?#]/, 1)[0].slice(0, PAGE_DOM_CAPS.maxUrlChars);
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

function normalizeAriaPopup(value) {
  if (typeof value === 'boolean') return value ? 'menu' : undefined;
  const normalized = String(value || '').toLowerCase();
  return ['menu', 'listbox', 'tree', 'grid', 'dialog'].includes(normalized)
    ? normalized
    : undefined;
}

function normalizeAriaCurrent(value) {
  if (typeof value === 'boolean') return value || undefined;
  const normalized = String(value || '').toLowerCase();
  return ['page', 'step', 'location', 'date', 'time'].includes(normalized) ? normalized : undefined;
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

  let valueCharsRemaining = PAGE_DOM_CAPS.maxTotalValueChars;
  for (const element of elements) {
    if (typeof element.value !== 'string') continue;
    element.value = element.value.slice(0, valueCharsRemaining);
    valueCharsRemaining -= element.value.length;
  }

  const buildContent = (list) =>
    input.observationFormat === 'outline'
      ? capSnapshotText(input.content, Math.min(maxChars, PAGE_DOM_CAPS.maxOutlineChars))
      : capSnapshotText(list.map(formatPageElement).join('\n'), maxChars);
  let content = buildContent(elements);

  const regions = Array.isArray(input.regions)
    ? input.regions
        .slice(0, 12)
        .map((region, regionPosition) => ({
          id: capPageText(region?.id || `region-${regionPosition}`, 32),
          indices: Array.isArray(region?.indices)
            ? region.indices
                .map((value) => Math.max(0, Math.floor(Number(value) || 0)))
                .filter(
                  (value) =>
                    Number.isSafeInteger(value) &&
                    elements.some((element) => element.index === value)
                )
                .slice(0, 32)
            : [],
          elementCount: Math.max(0, Math.floor(Number(region?.elementCount) || 0)),
        }))
        .filter((region) => region.indices.length > 0)
    : undefined;
  const payloadBase = {
    snapshotId: capPageText(input.snapshotId || '', 128),
    url: sanitizePageActionUrl(input.url),
    title: capPageText(input.title, 240),
    focusedElement: input.focusedElement
      ? normalizePageElement({ ...input.focusedElement, value: undefined }, 0)
      : undefined,
    header: capPageText(input.header, 1_000),
    footer: capPageText(input.footer, 1_000),
    readableContent: capSnapshotText(input.readableContent, PAGE_DOM_CAPS.maxReadableContentChars),
    fingerprint: capPageText(input.fingerprint || '', 128),
    routeId: /^[a-f0-9]{8}$/iu.test(String(input.routeId || ''))
      ? String(input.routeId)
      : undefined,
    routeChanged: input.routeChanged === true,
    regions,
    regionId:
      typeof input.regionId === 'string' && PAGE_REGION_ID_PATTERN.test(input.regionId)
        ? input.regionId
        : undefined,
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
