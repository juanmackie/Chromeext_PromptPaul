/**
 * @fileoverview Page-action schemas, risk classification, and trusted-mode policy.
 * @module pageActionPolicy
 */

import { PAGE_DOM_CAPS, capPageText, isSensitivePageElement } from './pageDom.js';

export const PAGE_ACTION_NAMES = Object.freeze([
  'page_get_state',
  'page_click',
  'page_input',
  'page_select',
  'page_scroll',
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

  if (actionName === 'page_get_state') return { valid: true, value: {} };
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
      value: { direction, pages, ...(containerIndex === null ? {} : { containerIndex }) },
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
    return { valid: true, value: { snapshotId, index, text } };
  }

  if (actionName === 'page_select') {
    const option = capPageText(args.option ?? args.optionText, PAGE_DOM_CAPS.maxElementTextChars);
    if (!option) return { valid: false, error: 'A select option is required.' };
    return { valid: true, value: { snapshotId, index, option } };
  }

  return { valid: true, value: { snapshotId, index } };
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
  if (actionName === 'page_get_state' || actionName === 'page_scroll') {
    return {
      risk: PAGE_ACTION_RISKS.READ_ONLY,
      requiresConfirmation: false,
      prohibited: false,
      reason: 'This action only reads or scrolls the current page.',
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
  PAGE_TAB_ACTION_NAMES,
  PAGE_USER_INPUT_ACTION_NAME,
  PAGE_MANUAL_INTERVENTION_ACTION_NAME,
  PAGE_ACTION_RISKS,
  isPageActionName,
  isPageTabActionName,
  isPageUserInputActionName,
  isPageManualInterventionActionName,
  normalizePageActionArgs,
  normalizePageTabActionArgs,
  normalizePageUserInputArgs,
  normalizePageManualInterventionArgs,
  classifyPageAction,
  evaluatePageActionPolicy,
};
