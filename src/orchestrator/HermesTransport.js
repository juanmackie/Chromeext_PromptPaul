/**
 * @fileoverview Hermes Agent API transport with bounded SSE handling.
 * @module HermesTransport
 */

import { appendBoundedSseBuffer, readBoundedResponseText } from '../utils/streamSafety.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_EVENT_BYTES = 512 * 1024;
const HERMES_APPROVAL_CHOICES = Object.freeze(['once', 'session', 'always', 'deny']);
const REQUIRED_CAPABILITIES = Object.freeze([
  'run_submission',
  'run_status',
  'run_events_sse',
  'run_stop',
  'run_approval',
]);
const HERMES_CLIENT_TOOL_FEATURE = 'run_client_tools';
const HERMES_CLIENT_TOOL_RESULT_ROUTE = '/v1/runs/{run_id}/tool-result';
const MAX_CLIENT_TOOL_RESULT_BYTES = 512 * 1024;

// Released Hermes API servers (0.20.x) advertise the approval feature as
// `run_approval_response` in /v1/capabilities even though the Hermes docs and
// the /v1/runs/{run_id}/approval endpoint use `run_approval`. Accept either
// name so the documented contract and the released gateway both pass.
const CAPABILITY_ADVERTISED_NAMES = Object.freeze({
  run_approval: ['run_approval', 'run_approval_response'],
});
const defaultFetch = (...args) => globalThis.fetch(...args);

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getHermesErrorCode(payload) {
  return asString(payload?.error?.code || payload?.code || payload?.error_code);
}

/**
 * True when a required capability is advertised under any accepted name.
 * @param {object} features - Advertised feature map from capability discovery.
 * @param {string} name - Required capability name.
 * @returns {boolean}
 */
function advertisesFeature(features, name) {
  const candidates = CAPABILITY_ADVERTISED_NAMES[name] || [name];
  return candidates.some((candidate) => features[candidate] === true);
}

/**
 * Return the required Hermes gateway capabilities that are not advertised.
 * @param {object|null|undefined} capabilities - Capability discovery payload.
 * @returns {string[]} Missing capability names.
 */
export function getMissingHermesCapabilities(capabilities) {
  const features = capabilities?.features;
  if (!features || typeof features !== 'object') return [...REQUIRED_CAPABILITIES];
  return REQUIRED_CAPABILITIES.filter((name) => !advertisesFeature(features, name));
}

/**
 * Return true when a gateway advertises the Prompt Paul client-tool contract.
 * Client tools are optional so ordinary Hermes runs remain compatible with
 * gateways that only execute server-side tools.
 * @param {object|null|undefined} capabilities - Capability discovery payload.
 * @returns {boolean}
 */
export function supportsHermesClientTools(capabilities) {
  const features = capabilities?.features;
  const endpoint = capabilities?.endpoints?.run_tool_result;
  return Boolean(
    features &&
    typeof features === 'object' &&
    features[HERMES_CLIENT_TOOL_FEATURE] === true &&
    endpoint &&
    String(endpoint.method || '').toUpperCase() === 'POST' &&
    endpoint.path === HERMES_CLIENT_TOOL_RESULT_ROUTE
  );
}

/**
 * Extract assistant text from the string and content-block shapes returned by
 * Hermes run-status recovery.
 * @param {unknown} output - Hermes status output.
 * @returns {string} Extracted assistant text.
 */
export function extractHermesOutputText(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output
      .map((entry) => extractHermesOutputText(entry))
      .filter(Boolean)
      .join('');
  }
  if (!output || typeof output !== 'object') return '';

  if (typeof output.text === 'string') return output.text;
  if (typeof output.output_text === 'string') return output.output_text;
  if (typeof output.content === 'string') return output.content;
  if (output.content && typeof output.content === 'object') {
    return extractHermesOutputText(output.content);
  }
  if (output.message && typeof output.message === 'object') {
    return extractHermesOutputText(output.message);
  }
  if (output.output && typeof output.output === 'object') {
    return extractHermesOutputText(output.output);
  }
  return '';
}

/**
 * Validate and normalize a Hermes API server endpoint.
 * @param {string} value - Candidate endpoint.
 * @param {{allowRemoteNetwork?: boolean}} [options] - Validation options.
 * @returns {string} Normalized endpoint.
 */
export function normalizeHermesEndpoint(value, options = {}) {
  const raw = asString(value);
  if (!raw || raw.length > 2048) throw new Error('Hermes endpoint is required.');

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('Hermes endpoint must be a valid HTTP(S) URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Hermes endpoint must use HTTP(S) without URL credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('Hermes endpoint must not contain a query string or fragment.');
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (!isLoopback && options.allowRemoteNetwork !== true) {
    throw new Error(
      'Hermes uses loopback by default. Remote HTTP(S) endpoints require trust confirmation.'
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

/**
 * Build a Hermes API route, including an optional gateway profile prefix.
 * @param {string} endpoint - Normalized endpoint.
 * @param {string} route - API route beginning with '/'.
 * @param {string} [profileSlug] - Optional Hermes profile slug.
 * @returns {string}
 */
export function buildHermesUrl(endpoint, route, profileSlug = '') {
  const base = normalizeHermesEndpoint(endpoint, { allowRemoteNetwork: true });
  const path = String(route || '').startsWith('/') ? route : `/${route}`;
  const slug = asString(profileSlug);
  if (slug && !/^[A-Za-z0-9._-]{1,64}$/.test(slug)) {
    throw new Error('Hermes profile name is invalid.');
  }
  return `${base}${slug ? `/p/${encodeURIComponent(slug)}` : ''}${path}`;
}

/**
 * Parse one bounded SSE event payload.
 * @param {string} data - Text after one or more data lines.
 * @returns {object|null}
 */
export function parseHermesEventData(data) {
  const text = String(data || '').trim();
  if (!text || text === '[DONE]') return null;
  if (new TextEncoder().encode(text).byteLength > MAX_EVENT_BYTES) {
    throw new Error('Hermes event is too large.');
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    throw new Error('Hermes returned invalid event data.');
  }
}

/**
 * Map a Hermes event into the existing Prompt Paul event vocabulary.
 * @param {object} event - Hermes event.
 * @returns {object|null}
 */
export function normalizeHermesEvent(event) {
  const type = asString(event?.type || event?.event || event?.name);
  const payload = event?.data && typeof event.data === 'object' ? event.data : event;
  if (!type) return null;

  if (type === 'message.delta') {
    const delta = payload?.delta ?? payload?.content ?? payload?.text;
    return typeof delta === 'string' && delta ? { type: 'content', data: delta } : null;
  }
  if (type === 'reasoning.available') {
    const reasoning = payload?.reasoning ?? payload?.summary ?? payload?.content;
    return typeof reasoning === 'string' && reasoning
      ? { type: 'reasoning', data: reasoning }
      : null;
  }
  if (type === 'client_tool.request') {
    const toolCallId = asString(payload?.tool_call_id || payload?.toolCallId || payload?.id);
    const name = asString(payload?.name || payload?.tool_name);
    const rawArguments = payload?.arguments ?? payload?.args ?? {};
    const argumentsText =
      typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments);
    return {
      type: 'hermes_client_tool_call',
      toolCall: {
        id: toolCallId,
        type: 'function',
        function: { name, arguments: argumentsText || '{}' },
      },
    };
  }
  if (type === 'tool.started') {
    return {
      type: 'tool_start',
      capability: 'hermes',
      toolCall: {
        id: asString(payload?.tool_call_id || payload?.toolCallId || payload?.id),
        type: 'server_tool',
        function: { name: asString(payload?.name || payload?.tool_name || 'Hermes tool') },
      },
    };
  }
  if (type === 'tool.completed') {
    return {
      type: 'tool_complete',
      capability: 'hermes',
      toolCall: {
        id: asString(payload?.tool_call_id || payload?.toolCallId || payload?.id),
        type: 'server_tool',
        function: { name: asString(payload?.name || payload?.tool_name || 'Hermes tool') },
      },
      result: { success: payload?.success !== false, summary: asString(payload?.summary) },
    };
  }
  if (type === 'approval.request') {
    const advertisedChoices = Array.isArray(payload?.choices)
      ? payload.choices.filter((choice) => HERMES_APPROVAL_CHOICES.includes(choice))
      : [];
    return {
      type: 'hermes_approval_required',
      approvalId: asString(payload?.approval_id || payload?.approvalId || payload?.id),
      summary: asString(payload?.summary || payload?.description || 'Hermes requires approval.'),
      choices: advertisedChoices.length > 0 ? advertisedChoices : [...HERMES_APPROVAL_CHOICES],
    };
  }
  if (type === 'approval.responded') {
    return {
      type: 'hermes_approval_updated',
      approvalId: asString(payload?.approval_id || payload?.approvalId || payload?.id),
      choice: asString(payload?.choice),
    };
  }
  if (type === 'run.completed') {
    const terminal = {
      type: 'hermes_terminal',
      status: 'complete',
    };
    if (payload?.output !== undefined) terminal.output = payload.output;
    if (payload?.usage !== undefined) terminal.usage = payload.usage;
    return terminal;
  }
  if (type === 'run.cancelled') return { type: 'hermes_terminal', status: 'stopped' };
  if (type === 'run.failed') {
    return {
      type: 'hermes_terminal',
      status: 'error',
      error: asString(payload?.error || payload?.message),
    };
  }
  return null;
}

/**
 * Transport for the released Hermes API server.
 */
export class HermesTransport {
  /**
   * @param {{credentialProvider: Function, fetchImpl?: Function, sessionStore?: Object}} options
   */
  constructor({
    credentialProvider,
    fetchImpl = defaultFetch,
    sessionStore = null,
    sessionKeyProvider = null,
  } = {}) {
    if (typeof credentialProvider !== 'function') {
      throw new Error('Hermes credential provider is required.');
    }
    this.credentialProvider = credentialProvider;
    this.fetchImpl = fetchImpl;
    this.sessionStore = sessionStore;
    this.sessionKeyProvider = sessionKeyProvider;
  }

  async _headers(profileId, sessionKey = '') {
    const apiKey = asString(await this.credentialProvider(profileId));
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey.slice(0, 256);
    return headers;
  }

  async _request({ profile, route, method = 'GET', body = undefined, signal, sessionKey = '' }) {
    const endpoint = normalizeHermesEndpoint(profile.hermesEndpoint, {
      allowRemoteNetwork: profile.hermesRemoteConfirmed === true,
    });
    const response = await this.fetchImpl(buildHermesUrl(endpoint, route, profile.hermesProfile), {
      method,
      headers: {
        ...(await this._headers(profile.id, sessionKey)),
        Accept: route.endsWith('/events') ? 'text/event-stream' : 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    return response;
  }

  async _safeError(response, fallback) {
    let detail = '';
    let errorCode = '';
    try {
      const source = typeof response?.clone === 'function' ? response.clone() : response;
      const raw = await readBoundedResponseText(source);
      let payload = raw;
      try {
        payload = raw ? JSON.parse(raw) : '';
      } catch (_) {
        payload = raw;
      }
      if (typeof payload === 'string') {
        detail = payload;
      } else if (payload && typeof payload === 'object') {
        errorCode = getHermesErrorCode(payload);
        detail =
          (typeof payload.error === 'string' ? payload.error : '') ||
          payload.error?.message ||
          payload.error?.detail ||
          payload.message ||
          payload.detail ||
          '';
      }
    } catch (_) {
      detail = '';
    }

    const safeDetail = String(detail)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(
        /((?:api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*)[^,;\s]+/gi,
        '$1[redacted]'
      )
      .trim()
      .slice(0, 400);
    const error = new Error(
      `${fallback} (HTTP ${response.status})${safeDetail ? `: ${safeDetail}` : '.'}`
    );
    error.status = response.status;
    if (errorCode) error.code = errorCode;
    return error;
  }

  async getCapabilities(profile) {
    const response = await this._request({ profile, route: '/v1/capabilities' });
    if (!response.ok) throw await this._safeError(response, 'Hermes capability discovery failed');
    return response.json();
  }

  async checkConnection(profile) {
    const response = await this._request({ profile, route: '/health' });
    let healthWarning = null;
    if (!response.ok && response.status !== 503) {
      throw await this._safeError(response, 'Hermes health check failed');
    }
    let health;
    if (response.ok) {
      health = await response.json().catch(() => ({}));
    } else {
      const error = await this._safeError(
        response,
        'Hermes health check reported degraded provider health'
      );
      health = { status: 'degraded', httpStatus: response.status };
      healthWarning = {
        status: error.status,
        code: error.code || '',
        message: error.message,
      };
    }
    const capabilities = await this.getCapabilities(profile);
    const missing = getMissingHermesCapabilities(capabilities);
    if (missing.length > 0) {
      const error = new Error(
        `Hermes gateway does not support the required run features: ${missing.join(', ')}.`
      );
      error.code = 'unsupported_gateway';
      throw error;
    }
    return { health, healthWarning, capabilities };
  }

  async ensureSession(profile) {
    const response = await this._request({
      profile,
      route: '/api/sessions',
      method: 'POST',
      body: {},
    });
    if (!response.ok) throw await this._safeError(response, 'Hermes session creation failed');
    const payload = await response.json();
    const sessionId = asString(
      payload?.id ||
        payload?.session_id ||
        payload?.sessionId ||
        payload?.session?.id ||
        payload?.session?.session_id ||
        payload?.session?.sessionId
    );
    if (!sessionId) throw new Error('Hermes did not return a session ID.');
    return sessionId;
  }

  async getSessionKey(profileId) {
    if (typeof this.sessionKeyProvider === 'function') {
      return asString(await this.sessionKeyProvider(profileId));
    }
    return '';
  }

  async getStoredSessionRecord(profileId) {
    if (typeof this.sessionStore?.get !== 'function') {
      return { sessionId: '', conversationId: '' };
    }
    const stored = await this.sessionStore.get(profileId);
    if (typeof stored === 'string') return { sessionId: asString(stored), conversationId: '' };
    return {
      sessionId: asString(stored?.sessionId || stored?.id),
      conversationId: asString(stored?.conversationId),
    };
  }

  async getStoredSession(profileId) {
    return (await this.getStoredSessionRecord(profileId)).sessionId;
  }

  async storeSession(profileId, sessionId, conversationId = '') {
    if (typeof this.sessionStore?.set === 'function' && sessionId) {
      await this.sessionStore.set(profileId, {
        sessionId,
        conversationId: asString(conversationId),
      });
    }
  }

  async clearStoredSession(profileId) {
    if (typeof this.sessionStore?.delete === 'function') {
      await this.sessionStore.delete(profileId);
    } else if (typeof this.sessionStore?.set === 'function') {
      await this.sessionStore.set(profileId, '');
    }
  }

  /**
   * End one Hermes session without deleting its server record.
   * @param {object} profile - Hermes profile configuration.
   * @param {string} sessionId - Opaque Hermes session identifier.
   * @returns {Promise<boolean>} True when the session was ended by this call.
   */
  async endSession(profile, sessionId) {
    const normalizedSessionId = asString(sessionId);
    if (!normalizedSessionId) return false;

    const response = await this._request({
      profile,
      route: `/api/sessions/${encodeURIComponent(normalizedSessionId)}`,
      method: 'PATCH',
      body: { end_reason: 'new_conversation' },
    });
    if (response.ok) return true;

    let errorCode = '';
    try {
      const source = typeof response?.clone === 'function' ? response.clone() : response;
      const raw = await readBoundedResponseText(source);
      const payload = raw ? JSON.parse(raw) : null;
      errorCode = asString(payload?.error?.code || payload?.code);
    } catch (_) {
      errorCode = '';
    }

    if (response.status === 404 && errorCode === 'session_not_found') return false;
    throw await this._safeError(response, 'Hermes session end failed');
  }

  async startRun(
    profile,
    {
      input,
      conversationHistory = [],
      sessionId,
      instructions = '',
      model = '',
      clientTools = [],
      sessionKey = '',
      signal,
    }
  ) {
    const body = {
      input,
      ...(Array.isArray(conversationHistory) && conversationHistory.length > 0
        ? { conversation_history: conversationHistory }
        : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(instructions ? { instructions } : {}),
      ...(model ? { model } : {}),
      ...(Array.isArray(clientTools) && clientTools.length > 0
        ? { client_tools: clientTools }
        : {}),
    };
    const response = await this._request({
      profile,
      route: '/v1/runs',
      method: 'POST',
      body,
      sessionKey,
      signal,
    });
    if (!response.ok) throw await this._safeError(response, 'Hermes run submission failed');
    const payload = await response.json();
    const runId = asString(payload?.run_id || payload?.runId || payload?.id);
    if (!runId) throw new Error('Hermes did not return a run ID.');
    return { runId, sessionId: asString(payload?.session_id || payload?.sessionId || sessionId) };
  }

  async getRunStatus(profile, runId, { sessionKey = '', signal } = {}) {
    const response = await this._request({
      profile,
      route: `/v1/runs/${encodeURIComponent(runId)}`,
      sessionKey,
      signal,
    });
    if (!response.ok) throw await this._safeError(response, 'Hermes run status request failed');
    return response.json();
  }

  async streamRun(profile, runId, { sessionKey = '', signal, onEvent }) {
    const response = await this._request({
      profile,
      route: `/v1/runs/${encodeURIComponent(runId)}/events`,
      sessionKey,
      signal,
    });
    if (!response.ok) throw await this._safeError(response, 'Hermes event stream failed');
    if (!response.body?.getReader)
      throw new Error('Hermes did not return a readable event stream.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines = [];
    let dataBytes = 0;

    const flushEvent = async () => {
      if (!dataLines.length) return;
      const parsed = parseHermesEventData(dataLines.join('\n'));
      dataLines = [];
      dataBytes = 0;
      if (parsed && typeof onEvent === 'function') await onEvent(parsed);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = appendBoundedSseBuffer(
        buffer,
        decoder.decode(value, { stream: true }),
        MAX_EVENT_BYTES * 2
      );

      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) {
          await flushEvent();
        } else if (line.startsWith('data:')) {
          const dataLine = line.slice(5).trimStart();
          dataBytes += new TextEncoder().encode(dataLine).byteLength;
          if (dataBytes > MAX_EVENT_BYTES) throw new Error('Hermes event is too large.');
          dataLines.push(dataLine);
        }
      }
    }
    if (buffer.trim().startsWith('data:')) {
      const dataLine = buffer.trim().slice(5).trimStart();
      dataBytes += new TextEncoder().encode(dataLine).byteLength;
      if (dataBytes > MAX_EVENT_BYTES) throw new Error('Hermes event is too large.');
      dataLines.push(dataLine);
    }
    await flushEvent();
  }

  async stopRun(profile, runId, { sessionKey = '' } = {}) {
    const response = await this._request({
      profile,
      route: `/v1/runs/${encodeURIComponent(runId)}/stop`,
      method: 'POST',
      body: {},
      sessionKey,
    });
    if (!response.ok && response.status !== 404) {
      throw await this._safeError(response, 'Hermes stop request failed');
    }
    return true;
  }

  async respondToApproval(profile, runId, choice, { sessionKey = '' } = {}) {
    if (!HERMES_APPROVAL_CHOICES.includes(choice)) {
      throw new Error('Hermes approval choice is invalid.');
    }
    const response = await this._request({
      profile,
      route: `/v1/runs/${encodeURIComponent(runId)}/approval`,
      method: 'POST',
      body: { choice },
      sessionKey,
    });
    if (!response.ok) throw await this._safeError(response, 'Hermes approval response failed');
    return true;
  }

  /**
   * Submit one result for a gateway-requested client tool call.
   * @param {object} profile - Hermes profile configuration.
   * @param {string} runId - Remote Hermes run ID.
   * @param {string} toolCallId - Opaque gateway tool-call ID.
   * @param {object} result - Bounded Prompt Paul tool result.
   * @param {{sessionKey?: string}} [options]
   * @returns {Promise<object>} Gateway acknowledgement.
   */
  async submitToolResult(profile, runId, toolCallId, result, { sessionKey = '' } = {}) {
    const normalizedRunId = asString(runId);
    const normalizedToolCallId = asString(toolCallId);
    if (!normalizedRunId || !normalizedToolCallId) {
      throw new Error('Hermes client-tool result requires run and tool-call IDs.');
    }
    const body = { tool_call_id: normalizedToolCallId, result };
    const encoded = JSON.stringify(body);
    if (new TextEncoder().encode(encoded).byteLength > MAX_CLIENT_TOOL_RESULT_BYTES) {
      throw new Error('Hermes client-tool result is too large.');
    }
    const response = await this._request({
      profile,
      route: `/v1/runs/${encodeURIComponent(normalizedRunId)}/tool-result`,
      method: 'POST',
      body,
      sessionKey,
    });
    if (!response.ok) throw await this._safeError(response, 'Hermes client-tool result failed');
    return response.json().catch(() => ({}));
  }
}
