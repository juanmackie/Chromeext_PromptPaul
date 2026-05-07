/**
 * @fileoverview Runtime error classification for user-friendly messaging.
 * @module runtimeErrors
 */

const TRANSIENT_DISCONNECT_PATTERNS = [
  /message channel closed before a response was received/i,
  /receiving end does not exist/i,
  /message port closed before a response was received/i,
  /extension context invalidated/i,
  /frame with id \d+ was removed/i,
  /temporarily lost (?:its )?connection to this tab/i,
];

const HOST_ACCESS_PATTERNS = [
  /cannot access contents of url/i,
  /missing host permission/i,
  /either the '<all_urls>' or 'activetab' permission is required/i,
  /cannot access a chrome:\/\//i,
];

const AUTH_OR_CONFIG_PATTERNS = [
  /access token could not be refreshed/i,
  /please sign in again/i,
  /api key/i,
  /configuration is incomplete/i,
  /401|403/,
];

export function classifyRuntimeMessageError(error) {
  const message = toErrorMessage(error);
  if (TRANSIENT_DISCONNECT_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'transient-disconnect';
  }
  if (HOST_ACCESS_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'host-access';
  }
  if (AUTH_OR_CONFIG_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'auth-or-config';
  }
  return 'unknown';
}

export function friendlyRuntimeErrorMessage(error) {
  const kind = classifyRuntimeMessageError(error);
  switch (kind) {
    case 'transient-disconnect':
      return 'The page connection was interrupted. Reload the tab and try again.';
    case 'host-access':
      return 'Prompt Paul cannot access this page context. Try a standard web page or grant site access.';
    case 'auth-or-config':
      return 'Your API profile appears invalid or expired. Check endpoint, API key, and model in Options.';
    default:
      return toErrorMessage(error) || 'Unexpected runtime error.';
  }
}

export function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}
