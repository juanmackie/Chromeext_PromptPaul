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
  'page_hover',
  'page_input',
  'page_set_value',
  'page_keypress',
  'page_select',
  'page_scroll',
  'page_find_text',
  'page_wait',
  'page_batch',
]);

export const READ_ONLY_PAGE_ACTIONS = Object.freeze([
  'page_get_state',
  'page_hover',
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
  'page_go_back',
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

export const PAGE_ACTION_KEYS = Object.freeze([
  'Enter',
  'Escape',
  'Tab',
  'Shift+Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'Space',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export const PAGE_ACTION_TITLE_MAX_CHARS = 80;

/**
 * Distinct error code for a mutation whose target is covered by another
 * element. The click point hit-tests to a different node, so dispatching the
 * synthetic pointer sequence would deliver the action to the covering element
 * instead of the target. Reported before any event is dispatched.
 */
export const PAGE_ACTION_OCCLUSION_CODE = 'PAGE_ACTION_TARGET_OCCLUDED';

/** Maximum characters kept for a reported occluder label. */
export const PAGE_ACTION_OCCLUDER_MAX_CHARS = 120;

/**
 * Codes that can only be produced before anything reaches the page. A failure
 * with one of these codes carries no page effect, so it must be recorded as
 * `not_delivered` and must not consume a mutation budget slot or count toward
 * the no-progress lockout.
 */
export const PAGE_ACTION_PRE_DISPATCH_CODES = Object.freeze([
  PAGE_ACTION_OCCLUSION_CODE,
  'PAGE_STATE_STALE',
]);

// Credential/payment wording that must never appear in a model-supplied step
// title (mirrors the sensitive-field conventions in pageDom.js). Rejecting it
// here prevents a title from echoing a masked field's identity back to the
// user or into the journal.
const CREDENTIAL_TITLE_PATTERN =
  /password|passcode|one[-_ ]?time|otp|2fa|secret|api[-_ ]?key|token|credit|debit|card|\bcvv\b|\bcvc\b|ssn|social security|credential|previous password|pincode|bank/i;

const RISK_PATTERN =
  /\b(?:submit|send|delete|remove|purchase|buy|checkout|pay|payment|transfer|publish|post|sign out|log out|account|security|password|passcode|one[-_ ]?time|otp|2fa|credential|api[-_ ]?key|token|secret|permission|authorize|allow|deny)\b/i;
const NAVIGATION_PATTERN =
  /\b(?:log ?in|sign ?in|register|create account|continue|next|back|open|navigate)\b/i;
const SEARCH_FORM_PATTERN = /\b(?:search|query|find)\b|\bq\b/i;

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
/**
 * Resolve one batch entry's action arguments.
 *
 * The tool schema nests arguments under `args`, but a model routinely writes
 * them inline (`{name: 'page_find_text', query: 'Results'}`). Both shapes reach
 * the same normalization; rejecting the inline form wasted a whole provider
 * turn on "Search text cannot be empty" and pushed models back into
 * one-observation-per-turn loops.
 *
 * @param {object} entry - batch entry with a `name` and either nested or flat args.
 * @returns {object}
 */
function pageBatchEntryArgs(entry) {
  if (entry.args && typeof entry.args === 'object' && !Array.isArray(entry.args)) return entry.args;
  const args = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'name' || key === 'args' || key === 'title') continue;
    args[key] = value;
  }
  return args;
}

export function normalizePageActionArgs(actionName, args = {}) {
  if (!isPageActionName(actionName)) return { valid: false, error: 'Unknown page action.' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, error: 'Page action arguments must be an object.' };
  }

  // Optional human label shared by every page action. A rejected display title
  // is omitted rather than blocking the actual action; this also keeps
  // control-character or sensitive wording out of progress events and journals.
  const title = normalizePageActionTitle(args.title);
  let expect;
  if (args.expect != null && ['page_click', 'page_keypress', 'page_input'].includes(actionName)) {
    // The declared postcondition is optional evidence, not a safety gate. A
    // malformed shape must never block the underlying action; accept the common
    // alternate spellings and otherwise omit the declaration.
    const rawExpect = args.expect;
    if (rawExpect && typeof rawExpect === 'object' && !Array.isArray(rawExpect)) {
      const type = String(rawExpect.type || '').trim();
      const text = capPageText(
        rawExpect.text ?? rawExpect[type] ?? rawExpect.text_appears ?? rawExpect.text_gone,
        PAGE_DOM_CAPS.maxFindQueryChars
      );
      if (['text_appears', 'text_gone'].includes(type) && text) {
        expect = { type, text };
      } else if (type === 'url_changes') {
        expect = { type };
      }
    }
  }
  const attachTitle = (value) => ({
    ...value,
    ...(title?.valid && title.value ? { title: title.value } : {}),
    ...(expect ? { expect } : {}),
  });

  if (actionName === 'page_get_state') {
    if (args.regionId == null) return { valid: true, value: attachTitle({}) };
    const regionId = normalizeRegionId(args.regionId);
    if (!regionId)
      return {
        valid: false,
        error:
          'Region must be region-N from the latest snapshot regions list (for example region-0), not a snapshotId.',
      };
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
        return {
          valid: false,
          error:
            'Region must be region-N from the latest snapshot regions list (for example region-0), not a snapshotId.',
        };
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
      const normalized = normalizePageActionArgs(name, pageBatchEntryArgs(entry));
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
      return {
        valid: false,
        error:
          'Region must be region-N from the latest snapshot regions list (for example region-0), not a snapshotId.',
      };
    return { valid: true, value: attachTitle({ query, regionId }) };
  }
  if (actionName === 'page_scroll') {
    const index = args.index == null ? null : Number(args.index);
    const snapshotId = capPageText(args.snapshotId, 128);
    if (index != null && (!snapshotId || !Number.isSafeInteger(index) || index < 0))
      return {
        valid: false,
        error: 'Element-scoped scroll requires a current snapshot and safe element ID.',
      };
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
        ...(index === null ? {} : { snapshotId, index }),
      }),
    };
  }

  const snapshotId = capPageText(args.snapshotId, 128);
  if (actionName === 'page_keypress') {
    if (!PAGE_ACTION_KEYS.includes(args.key))
      return { valid: false, error: 'Unsupported page key.' };
    if (args.index == null)
      return {
        valid: true,
        value: attachTitle({ key: args.key, ...(snapshotId ? { snapshotId } : {}) }),
      };
  }
  const index = Number(args.index);
  if (!snapshotId) return { valid: false, error: 'A current snapshotId is required.' };
  if (!Number.isSafeInteger(index) || index < 0) {
    return { valid: false, error: 'Element index is outside the allowed range.' };
  }

  if (actionName === 'page_input') {
    const mode = args.mode ?? 'replace';
    if (!['replace', 'append'].includes(mode))
      return { valid: false, error: 'Input mode must be replace or append.' };
    const text = String(args.text ?? '');
    if (!text.trim()) return { valid: false, error: 'Input text cannot be empty.' };
    if (text.length > PAGE_DOM_CAPS.maxInputChars) {
      return {
        valid: false,
        error: `Input text is limited to ${PAGE_DOM_CAPS.maxInputChars} characters.`,
      };
    }
    if (args.submit != null && typeof args.submit !== 'boolean')
      return { valid: false, error: 'Submit must be a boolean.' };
    return {
      valid: true,
      value: attachTitle({
        snapshotId,
        index,
        text,
        mode,
        ...(args.submit === true ? { submit: true } : {}),
      }),
    };
  }

  if (actionName === 'page_set_value') {
    if (
      !['string', 'number'].includes(typeof args.value) ||
      (typeof args.value === 'number' && !Number.isFinite(args.value))
    )
      return { valid: false, error: 'A bounded string or numeric value is required.' };
    const value = String(args.value);
    if (!value || value.length > PAGE_DOM_CAPS.maxValueChars)
      return { valid: false, error: 'Set value is limited to 160 characters.' };
    return { valid: true, value: attachTitle({ snapshotId, index, value }) };
  }

  if (actionName === 'page_select') {
    const option = capPageText(args.option ?? args.optionText, PAGE_DOM_CAPS.maxElementTextChars);
    if (!option) return { valid: false, error: 'A select option is required.' };
    return { valid: true, value: attachTitle({ snapshotId, index, option }) };
  }

  if (actionName === 'page_click' && args.count != null) {
    if (![1, 2].includes(args.count)) return { valid: false, error: 'Click count must be 1 or 2.' };
    return { valid: true, value: attachTitle({ snapshotId, index, count: args.count }) };
  }
  if (actionName === 'page_keypress')
    return { valid: true, value: attachTitle({ snapshotId, index, key: args.key }) };

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
    if (!Number.isSafeInteger(index) || index < 0) {
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
export function classifyPageAction(target = {}, actionName = '', args = {}) {
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

  if (
    ((actionName === 'page_keypress' && args.key === 'Enter') ||
      (actionName === 'page_input' && args.submit === true)) &&
    isSameOriginSearchForm(target)
  ) {
    return {
      risk: PAGE_ACTION_RISKS.LOW,
      requiresConfirmation: false,
      prohibited: false,
      reason: 'This submits a search query through a same-origin GET form.',
    };
  }

  if (
    (actionName === 'page_keypress' && args.key === 'Enter') ||
    (actionName === 'page_input' && args.submit === true)
  ) {
    if (target.submitControl) return classifyPageAction(target.submitControl, 'page_click');
    if (target.inForm)
      return classifyPageAction({ tag: 'button', label: 'Submit form' }, 'page_click');
    if (actionName === 'page_keypress') return classifyPageAction(target, 'page_click');
  }
  if (
    actionName === 'page_keypress' &&
    ['Escape', 'Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
      args.key
    )
  ) {
    return {
      risk: PAGE_ACTION_RISKS.LOW,
      requiresConfirmation: true,
      prohibited: false,
      reason: 'This key changes focus or widget state.',
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

function isSameOriginSearchForm(target) {
  const formMethod = String(
    target.submitControl?.formMethod || target.formMethod || ''
  ).toLowerCase();
  const targetOrigin = String(target.frameOrigin || '');
  const formActionOrigin = String(
    target.submitControl?.formActionOrigin || target.formActionOrigin || ''
  );
  const descriptor = [
    target.name,
    target.label,
    target.placeholder,
    target.role,
    target.type,
    target.submitControl?.name,
    target.submitControl?.label,
    target.submitControl?.role,
    target.submitControl?.type,
  ]
    .map((value) => String(value || ''))
    .join(' ')
    .replace(/\bsubmit\b/giu, '');
  return (
    formMethod === 'get' &&
    Boolean(targetOrigin) &&
    formActionOrigin === targetOrigin &&
    SEARCH_FORM_PATTERN.test(descriptor) &&
    !RISK_PATTERN.test(descriptor)
  );
}

/**
 * Apply the default confirmation policy or trusted-mode preference.
 * @param {object} input
 * @returns {{allowed: boolean, requiresConfirmation: boolean, requiresExplicitConfirmation: boolean, risk: string, reason: string}}
 */
export function evaluatePageActionPolicy(input = {}) {
  const actionName = String(input.actionName || '');
  const sitePolicy = input.sitePolicies?.[input.origin];
  if (sitePolicy === 'block')
    return {
      allowed: false,
      prohibited: true,
      risk: PAGE_ACTION_RISKS.PROHIBITED,
      requiresConfirmation: false,
      requiresExplicitConfirmation: false,
      code: 'PAGE_ACTION_SITE_BLOCKED',
      reason: 'Act is blocked on this site. Review its policy in Options.',
    };
  const classification = classifyPageAction(input.target, actionName, input.args);
  if (classification.prohibited) {
    return { allowed: false, ...classification };
  }

  const trustedMode = input.trustedMode === true || sitePolicy === 'allow_low_risk';
  // High-risk and navigation-capable controls stay confirmation-gated in
  // persistent trusted mode. Explicit run approval never bypasses high risk.
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

/**
 * Bound a raw occluder descriptor reported by the content script. Page data is
 * untrusted, so every field is trimmed, capped, and optional.
 * @param {unknown} raw
 * @returns {{index?: number, tag?: string, role?: string, label?: string}|null}
 */
export function normalizePageActionOccluder(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const occluder = {};
  const index = Number(raw.index);
  if (Number.isInteger(index) && index >= 0) occluder.index = index;
  const tag = capPageText(raw.tag, 32).toLowerCase();
  if (tag) occluder.tag = tag;
  const role = capPageText(raw.role, 40);
  if (role) occluder.role = role;
  const label = capPageText(raw.label, PAGE_ACTION_OCCLUDER_MAX_CHARS);
  if (label) occluder.label = label;
  return Object.keys(occluder).length > 0 ? occluder : null;
}

/**
 * Human-readable identity for a normalized occluder, used in the model-facing
 * message so the covering control can be dismissed or targeted directly.
 * @param {object|null} occluder
 * @returns {string}
 */
function describePageActionOccluder(occluder) {
  if (!occluder) return 'another element';
  const parts = [];
  if (occluder.role) parts.push(occluder.role);
  else if (occluder.tag) parts.push(`<${occluder.tag}>`);
  if (occluder.label) parts.push(`"${occluder.label}"`);
  const descriptor = parts.join(' ') || occluder.tag || 'another element';
  return occluder.index == null ? descriptor : `${descriptor} [${occluder.index}]`;
}

/**
 * Build the model-facing occlusion failure. Waiting will not help on its own:
 * the covering element has to be dismissed or targeted, so the suggestion
 * names that path explicitly instead of telling the model to retry.
 * @param {object} input
 * @param {unknown} input.occluder - Raw occluder descriptor from the page.
 * @param {string} [input.targetLabel] - Label of the intended target.
 * @returns {{code: string, message: string, suggestion: string, occluder: object|null}}
 */
export function buildPageActionOcclusionFailure(input = {}) {
  const occluder = normalizePageActionOccluder(input.occluder);
  const target = capPageText(input.targetLabel, PAGE_ACTION_OCCLUDER_MAX_CHARS);
  const targetText = target ? ` for "${target}"` : '';
  return {
    code: PAGE_ACTION_OCCLUSION_CODE,
    message:
      `The target${targetText} is covered by ${describePageActionOccluder(occluder)}, so the ` +
      'click was not delivered. Nothing was dispatched to the page.',
    suggestion:
      'Dismiss or act on the covering element first (inspect it with page_get_state), then ' +
      're-issue the click. Retrying the same target without clearing the cover will fail again.',
    occluder,
  };
}

/**
 * Whether a page-action error was produced before any input reached the page.
 * Requires both the explicit pre-dispatch flag and a known pre-dispatch code so
 * a lost or spoofed flag falls back to the conservative existing accounting.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isPageActionPreDispatchFailure(error) {
  if (!error || error.preDispatch !== true) return false;
  return PAGE_ACTION_PRE_DISPATCH_CODES.includes(String(error.code || ''));
}
