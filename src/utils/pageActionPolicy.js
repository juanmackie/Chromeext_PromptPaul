/**
 * @fileoverview Page-action schemas, risk classification, and trusted-mode policy.
 * @module pageActionPolicy
 */

import {
  PAGE_DOM_CAPS,
  capPageText,
  isSensitivePageElement,
  normalizeRegionId,
} from './pageDom.js';

export const PAGE_ACTION_NAMES = Object.freeze([
  'page_get_state',
  'page_click',
  'page_input',
  'page_select',
  'page_scroll',
  'page_find_text',
  'page_wait',
  'page_batch',
]);

export const READ_ONLY_PAGE_ACTIONS = Object.freeze([
  'page_get_state',
  'page_scroll',
  'page_find_text',
  'page_wait',
  'page_batch',
]);

export const PAGE_TAB_ACTION_NAMES = Object.freeze([
  'page_list_tabs',
  'page_open_tab',
  'page_open_link',
  'page_switch_tab',
  'page_close_tab',
]);
export const PAGE_USER_INPUT_ACTION_NAME = 'page_request_user_input';
export const PAGE_MANUAL_INTERVENTION_ACTION_NAME = 'page_pause_for_user';

export const PAGE_ACTION_RISKS = Object.freeze({
  READ_ONLY: 'read-only',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  PROHIBITED: 'prohibited',
});

export const PAGE_ACTION_TITLE_MAX_CHARS = 80;

// Credential/payment wording that must never appear in a model-supplied step
// title (mirrors the sensitive-field conventions in pageDom.js). Rejecting it
// here prevents a title from echoing a masked field's identity back to the
// user or into the journal.
const CREDENTIAL_TITLE_PATTERN =
  /password|passcode|one[-_ ]?time|otp|2fa|secret|api[-_ ]?key|token|credit|debit|card|\bcvv\b|\bcvc\b|ssn|social security|credential|previous password|pincode|bank/i;

const RISK_PATTERN =
  /submit|send|delete|remove|purchase|buy|checkout|pay|payment|transfer|publish|post|sign out|log out|account|security|password|passcode|one[-_ ]?time|otp|2fa|credential|api[-_ ]?key|token|secret|permission|authorize|allow|deny/i;
const NAVIGATION_PATTERN =
  /log ?in|sign ?in|register|create account|continue|next|back|open|navigate/i;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPageActionName(value) {
  return PAGE_ACTION_NAMES.includes(String(value || ''));
}

export function isPageActionReadOnly(value) {
  return READ_ONLY_PAGE_ACTIONS.includes(String(value || ''));
}

export function isPageTabActionName(value) {
  return PAGE_TAB_ACTION_NAMES.includes(String(value || ''));
}

export function isPageUserInputActionName(value) {
  return String(value || '') === PAGE_USER_INPUT_ACTION_NAME;
}

export function isPageManualInterventionActionName(value) {
  return String(value || '') === PAGE_MANUAL_INTERVENTION_ACTION_NAME;
}

/**
 * Validate a bounded optional model-supplied step title for a page action.
 * Overseen by the policy layer: over-long titles, control characters, and
 * credential/payment wording are rejected so the label is safe to render on
 * the progress card and persist in the journal.
 * @param {unknown} raw
 * @returns {{valid: boolean, value?: string, error?: string}|null} - null when
 *   absent or empty (optional field), otherwise a validation result.
 */
export function normalizePageActionTitle(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return { valid: false, error: 'Title must be a string.' };
  const title = raw.trim();
  if (!title) return null;
  if (title.length > PAGE_ACTION_TITLE_MAX_CHARS) {
    return {
      valid: false,
      error: `Title is limited to ${PAGE_ACTION_TITLE_MAX_CHARS} characters.`,
    };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    return { valid: false, error: 'Title cannot contain control characters.' };
  }
  if (CREDENTIAL_TITLE_PATTERN.test(title)) {
    return {
      valid: false,
      error: 'Title cannot reference credentials, secret, or payment data.',
    };
  }
  return { valid: true, value: title };
}

/**
 * Normalize and bound arguments received from a model tool call.
 * @param {string} actionName
 * @param {object} args
 * @returns {{valid: boolean, value?: object, error?: string}}
 */
export function normalizePageActionArgs(actionName, args = {}) {
  if (!isPageActionName(actionName)) return { valid: false, error: 'Unknown page action.' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, error: 'Page action arguments must be an object.' };
  }

  // Optional human label shared by every page action. Rejected titles abort
  // the whole call so a control-character/credential title never reaches the
  // page or the journal.
  const title = normalizePageActionTitle(args.title);
  if (title && !title.valid) return title;
  const attachTitle = (value) => (title?.value ? { ...value, title: title.value } : value);

  if (actionName === 'page_get_state') {
    if (args.regionId == null) return { valid: true, value: attachTitle({}) };
    const regionId = normalizeRegionId(args.regionId);
    if (!regionId)
      return { valid: false, error: 'Region must be a content-script region-N identifier.' };
    return { valid: true, value: attachTitle({ regionId }) };
  }
  if (actionName === 'page_wait') {
    const condition = String(args.condition || '')
      .trim()
      .toLowerCase();
    if (!['text', 'text_gone', 'url_changed'].includes(condition)) {
      return { valid: false, error: 'Wait condition must be text, text_gone, or url_changed.' };
    }
    const timeoutMs = Number(args.timeoutMs ?? 5_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > PAGE_DOM_CAPS.maxWaitMs) {
      return {
        valid: false,
        error: `Wait timeout must be between 0 and ${PAGE_DOM_CAPS.maxWaitMs} milliseconds.`,
      };
    }
    const text = capPageText(args.text, PAGE_DOM_CAPS.maxFindQueryChars);
    if (condition !== 'url_changed' && !text) {
      return { valid: false, error: 'Wait text cannot be empty for this condition.' };
    }
    if (args.regionId != null) {
      const regionId = normalizeRegionId(args.regionId);
      if (!regionId)
        return { valid: false, error: 'Region must be a content-script region-N identifier.' };
      return {
        valid: true,
        value: attachTitle({ condition, timeoutMs, ...(text ? { text } : {}), regionId }),
      };
    }
    return {
      valid: true,
      value: attachTitle({ condition, timeoutMs, ...(text ? { text } : {}) }),
    };
  }
  if (actionName === 'page_batch') {
    if (!Array.isArray(args.actions) || args.actions.length < 2) {
      return { valid: false, error: 'A page batch must contain 2 to 6 read-only actions.' };
    }
    if (args.actions.length > PAGE_DOM_CAPS.maxBatchActions) {
      return {
        valid: false,
        error: `A page batch is limited to ${PAGE_DOM_CAPS.maxBatchActions} actions.`,
      };
    }
    const actions = [];
    for (const entry of args.actions) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { valid: false, error: 'Each page batch item must be an action object.' };
      }
      const name = String(entry.name || '');
      if (!READ_ONLY_PAGE_ACTIONS.includes(name) || name === 'page_batch') {
        return { valid: false, error: 'Page batches support only non-nested read-only actions.' };
      }
      const normalized = normalizePageActionArgs(name, entry.args || {});
      if (!normalized.valid) return normalized;
      actions.push({ name, args: normalized.value });
    }
    return { valid: true, value: attachTitle({ actions }) };
  }
  if (actionName === 'page_find_text') {
    const query = capPageText(args.query, PAGE_DOM_CAPS.maxFindQueryChars);
    if (!query) return { valid: false, error: 'Search text cannot be empty.' };
    if (args.regionId == null) return { valid: true, value: attachTitle({ query }) };
    const regionId = normalizeRegionId(args.regionId);
    if (!regionId)
      return { valid: false, error: 'Region must be a content-script region-N identifier.' };
    return { valid: true, value: attachTitle({ query, regionId }) };
  }
  if (actionName === 'page_scroll') {
    const direction = String(args.direction || (args.down === false ? 'up' : 'down')).toLowerCase();
    const pages = Number(args.pages ?? 0.5);
    const containerIndex = args.containerIndex == null ? null : Number(args.containerIndex);
    if (!['up', 'down', 'left', 'right'].includes(direction)) {
      return { valid: false, error: 'Scroll direction must be up, down, left, or right.' };
    }
    if (!Number.isFinite(pages) || pages < 0 || pages > PAGE_DOM_CAPS.maxScrollPages) {
      return {
        valid: false,
        error: `Scroll pages must be between 0 and ${PAGE_DOM_CAPS.maxScrollPages}.`,
      };
    }
    if (
      containerIndex !== null &&
      (!Number.isInteger(containerIndex) || containerIndex < 0 || containerIndex >= 16)
    ) {
      return { valid: false, error: 'Scroll container index is outside the allowed range.' };
    }
    return {
      valid: true,
      value: attachTitle({
        direction,
        pages,
        ...(containerIndex === null ? {} : { containerIndex }),
      }),
    };
  }

  const snapshotId = capPageText(args.snapshotId, 128);
  const index = Number(args.index);
  if (!snapshotId) return { valid: false, error: 'A current snapshotId is required.' };
  if (!Number.isInteger(index) || index < 0 || index >= PAGE_DOM_CAPS.maxElements) {
    return { valid: false, error: 'Element index is outside the allowed range.' };
  }

  if (actionName === 'page_input') {
    const text = String(args.text ?? '');
    if (!text.trim()) return { valid: false, error: 'Input text cannot be empty.' };
    if (text.length > PAGE_DOM_CAPS.maxInputChars) {
      return {
        valid: false,
        error: `Input text is limited to ${PAGE_DOM_CAPS.maxInputChars} characters.`,
      };
    }
    return { valid: true, value: attachTitle({ snapshotId, index, text }) };
  }

  if (actionName === 'page_select') {
    const option = capPageText(args.option ?? args.optionText, PAGE_DOM_CAPS.maxElementTextChars);
    if (!option) return { valid: false, error: 'A select option is required.' };
    return { valid: true, value: attachTitle({ snapshotId, index, option }) };
  }

  return { valid: true, value: attachTitle({ snapshotId, index }) };
}

/**
 * Normalize bounded multi-tab arguments. Tab tools are available only inside
 * the single Act lease and remain owned by the current run; arbitrary browser
 * APIs are never exposed to the model.
 * @param {string} actionName
 * @param {object} args
 * @returns {{valid: boolean, value?: object, error?: string}}
 */
export function normalizePageTabActionArgs(actionName, args = {}) {
  if (!isPageTabActionName(actionName)) return { valid: false, error: 'Unknown tab action.' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, error: 'Tab action arguments must be an object.' };
  }
  if (actionName === 'page_list_tabs') return { valid: true, value: {} };
  if (actionName === 'page_open_link') {
    const snapshotId = capPageText(args.snapshotId, 128);
    const index = Number(args.index);
    if (!snapshotId) return { valid: false, error: 'A current snapshotId is required.' };
    if (!Number.isInteger(index) || index < 0 || index >= PAGE_DOM_CAPS.maxElements) {
      return { valid: false, error: 'Element index is outside the allowed range.' };
    }
    return { valid: true, value: { snapshotId, index, background: args.background === true } };
  }
  const tabId = Number(args.tabId);
  if (actionName === 'page_open_tab') {
    if (
      typeof args.url !== 'string' ||
      !args.url.trim() ||
      args.url.length > PAGE_DOM_CAPS.maxUrlChars
    ) {
      return { valid: false, error: 'A bounded http(s) URL is required.' };
    }
    let url;
    try {
      url = new URL(args.url.trim());
    } catch (_) {
      return { valid: false, error: 'A valid http(s) URL is required.' };
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Only http(s) tab URLs are allowed.' };
    }
    const normalizedUrl = `${url.origin}${url.pathname}`;
    if (normalizedUrl.length > PAGE_DOM_CAPS.maxUrlChars) {
      return { valid: false, error: 'The normalized http(s) URL is too long.' };
    }
    return {
      valid: true,
      value: { url: normalizedUrl, background: args.background === true },
    };
  }
  if (!Number.isInteger(tabId) || tabId < 1) {
    return { valid: false, error: 'A valid owned tabId is required.' };
  }
  return { valid: true, value: { tabId } };
}

export function normalizePageManualInterventionArgs(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, error: 'Manual-intervention arguments must be an object.' };
  }
  const question = capPageText(args.question, 600);
  if (!question) return { valid: false, error: 'A clear manual-intervention request is required.' };
  if (
    /password|passcode|one[-_ ]?time|otp|api[-_ ]?key|token|secret|payment|credential|purchase|buy|checkout|pay|transfer|delete|remove|destructive|security settings|change password/i.test(
      question
    )
  ) {
    return {
      valid: false,
      error:
        'Manual intervention cannot request secrets, payments, destructive actions, or security changes.',
    };
  }
  return { valid: true, value: { question } };
}

export function normalizePageUserInputArgs(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, error: 'User-input arguments must be an object.' };
  }
  const question = capPageText(args.question, 600);
  if (!question) return { valid: false, error: 'A clear question is required.' };
  if (
    /password|passcode|one[-_ ]?time|otp|api[-_ ]?key|token|secret|payment|credential/i.test(
      question
    )
  ) {
    return { valid: false, error: 'User-input requests cannot ask for secrets or payment data.' };
  }
  const options = Array.isArray(args.options)
    ? args.options
        .map((option) => capPageText(option, 120))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return { valid: true, value: { question, options } };
}

/**
 * Classify a target using only safe, short metadata from the current snapshot.
 * @param {object} target
 * @param {string} actionName
 * @returns {{risk: string, requiresConfirmation: boolean, prohibited: boolean, reason: string}}
 */
export function classifyPageAction(target = {}, actionName = '') {
  if (isPageActionReadOnly(actionName)) {
    return {
      risk: PAGE_ACTION_RISKS.READ_ONLY,
      requiresConfirmation: false,
      prohibited: false,
      reason: 'This action only reads or scrolls the current page.',
    };
  }

  if (target.disabled === true) {
    return {
      risk: PAGE_ACTION_RISKS.PROHIBITED,
      requiresConfirmation: true,
      prohibited: true,
      code: 'PAGE_ACTION_TARGET_DISABLED',
      reason:
        'This control is disabled on the page and cannot be activated. Re-inspect with ' +
        "page_get_state and choose a different, enabled control (for a list row, use the row's own " +
        'link or button instead).',
    };
  }

  const sensitive = Boolean(target.sensitive) || isSensitivePageElement(target);
  const descriptor = [
    target.tag,
    target.role,
    target.name,
    target.label,
    target.placeholder,
    target.text,
    target.type,
  ]
    .map((value) => String(value || ''))
    .join(' ')
    .trim();

  if (sensitive) {
    return {
      risk: PAGE_ACTION_RISKS.PROHIBITED,
      requiresConfirmation: true,
      prohibited: true,
      reason: 'Credential, password, one-time-code, or security-sensitive controls are blocked.',
    };
  }

  if (RISK_PATTERN.test(descriptor)) {
    return {
      risk: PAGE_ACTION_RISKS.HIGH,
      requiresConfirmation: true,
      prohibited: false,
      reason: 'This control may send, delete, purchase, publish, or change account/security state.',
    };
  }

  const isLink = String(target.tag || '').toLowerCase() === 'a' || target.role === 'link';
  let safeLink = false;
  if (isLink) {
    try {
      safeLink = ['http:', 'https:'].includes(new URL(String(target.href || '')).protocol);
    } catch (_) {
      safeLink = false;
    }
  }

  if (isLink && target.download === true) {
    return {
      risk: PAGE_ACTION_RISKS.PROHIBITED,
      requiresConfirmation: true,
      prohibited: true,
      reason: 'Downloads are outside the page-action boundary.',
    };
  }

  if (isLink && !safeLink) {
    return {
      risk: PAGE_ACTION_RISKS.PROHIBITED,
      requiresConfirmation: true,
      prohibited: true,
      reason: 'This link has no safe HTTP(S) destination.',
    };
  }

  if (isLink && actionName === 'page_click' && target.target === '_blank') {
    return {
      risk: PAGE_ACTION_RISKS.PROHIBITED,
      requiresConfirmation: true,
      prohibited: true,
      reason: 'This link opens a new tab. Use page_open_link when Act is enabled.',
    };
  }

  if (isLink) {
    return {
      risk: PAGE_ACTION_RISKS.MEDIUM,
      requiresConfirmation: true,
      prohibited: false,
      navigation: true,
      reason: 'This link navigates the current page and may open an external site.',
    };
  }

  if (NAVIGATION_PATTERN.test(descriptor)) {
    return {
      risk: PAGE_ACTION_RISKS.MEDIUM,
      requiresConfirmation: true,
      prohibited: false,
      navigation: true,
      reason: 'This control may navigate or change the current workflow.',
    };
  }

  return {
    risk: PAGE_ACTION_RISKS.LOW,
    requiresConfirmation: true,
    prohibited: false,
    reason: 'This action changes a page control or field.',
  };
}

/**
 * Apply the default confirmation policy or trusted-mode preference.
 * @param {object} input
 * @returns {{allowed: boolean, requiresConfirmation: boolean, requiresExplicitConfirmation: boolean, risk: string, reason: string}}
 */
export function evaluatePageActionPolicy(input = {}) {
  const actionName = String(input.actionName || '');
  const classification = classifyPageAction(input.target, actionName);
  if (classification.prohibited) {
    return { allowed: false, ...classification };
  }

  const trustedMode = input.trustedMode === true;
  // High-risk and navigation-capable controls stay confirmation-gated in
  // persistent trusted mode. An explicit session approval is handled by the
  // orchestrator and may bypass this confirmation for allowed actions.
  const requiresExplicitConfirmation =
    classification.risk === PAGE_ACTION_RISKS.HIGH || classification.navigation === true;
  const requiresConfirmation =
    classification.requiresConfirmation &&
    !(
      trustedMode &&
      !requiresExplicitConfirmation &&
      [PAGE_ACTION_RISKS.LOW, PAGE_ACTION_RISKS.MEDIUM].includes(classification.risk)
    );

  return {
    allowed: true,
    ...classification,
    requiresConfirmation,
    requiresExplicitConfirmation,
    reason: requiresConfirmation
      ? classification.reason
      : trustedMode
        ? 'Trusted page-actions mode approved this allowed action.'
        : classification.reason,
  };
}

export const pageActionPolicy = {
  PAGE_ACTION_NAMES,
  READ_ONLY_PAGE_ACTIONS,
  PAGE_TAB_ACTION_NAMES,
  PAGE_USER_INPUT_ACTION_NAME,
  PAGE_MANUAL_INTERVENTION_ACTION_NAME,
  PAGE_ACTION_RISKS,
  PAGE_ACTION_TITLE_MAX_CHARS,
  isPageActionName,
  isPageActionReadOnly,
  isPageTabActionName,
  isPageUserInputActionName,
  isPageManualInterventionActionName,
  normalizePageActionArgs,
  normalizePageActionTitle,
  normalizePageTabActionArgs,
  normalizePageUserInputArgs,
  normalizePageManualInterventionArgs,
  classifyPageAction,
  evaluatePageActionPolicy,
};
