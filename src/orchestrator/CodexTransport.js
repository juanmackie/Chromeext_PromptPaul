/**
 * @fileoverview HTTP Responses transport used by ChatGPT-authenticated Codex profiles.
 * @module CodexTransport
 */

import { CODEX_API_ENDPOINT } from '../utils/codexAuth.js';
import { appendBoundedSseBuffer, readBoundedResponseText } from '../utils/streamSafety.js';
import { createTimeoutSignal, redactProviderErrorMessage } from '../utils/runResilience.js';

function toResponsesContent(content, role) {
  if (typeof content === 'string') {
    return [{ type: role === 'user' ? 'input_text' : 'output_text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (typeof part === 'string') {
      return [{ type: role === 'user' ? 'input_text' : 'output_text', text: part }];
    }
    if (part?.type === 'text') {
      return [{ type: role === 'user' ? 'input_text' : 'output_text', text: part.text || '' }];
    }
    if (part?.type === 'image_url' && part.image_url?.url) {
      return [{ type: 'input_image', image_url: part.image_url.url }];
    }
    return [];
  });
}

export function buildCodexInput(messages = []) {
  const input = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object' || message.role === 'system') continue;
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: String(message.content || ''),
      });
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function?.name,
          arguments: String(toolCall.function?.arguments || '{}'),
        });
      }
      const text = toResponsesContent(message.content, 'assistant');
      if (text.length > 0) input.push({ role: 'assistant', content: text });
      continue;
    }
    const content = toResponsesContent(message.content, message.role);
    if (content.length > 0) input.push({ role: message.role, content });
  }
  return input;
}

export function buildCodexTools(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function?.name,
    description: tool.function?.description || '',
    parameters: tool.function?.parameters || { type: 'object', properties: {} },
  }));
}

export function buildCodexRequest({
  modelName,
  systemPrompt,
  messages,
  tools,
  toolChoice,
  reasoningLevel,
}) {
  const body = {
    model: modelName,
    instructions: systemPrompt,
    store: false,
    stream: true,
    input: buildCodexInput(messages),
  };
  if (reasoningLevel) body.reasoning = { effort: reasoningLevel };
  if (tools?.length && toolChoice !== 'none') {
    body.tools = buildCodexTools(tools);
    body.tool_choice =
      toolChoice === 'auto' || !toolChoice ? 'auto' : { type: 'function', name: toolChoice };
  }
  return body;
}

export function createCodexHeaders({ accessToken, accountId, sessionId }) {
  let clientVersion = '0.0.0';
  try {
    clientVersion = chrome.runtime.getManifest()?.version || clientVersion;
  } catch (_) {
    // Unit tests and non-extension callers do not provide chrome.runtime.
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'codex-1',
    originator: 'prompt_paul',
    version: clientVersion,
    'User-Agent': 'PromptPaul/6.1',
    'session-id': sessionId,
  };
  if (accountId) headers['ChatGPT-Account-ID'] = accountId;
  return headers;
}

export async function* streamCodexResponse({
  accessToken,
  accountId,
  sessionId,
  body,
  endpoint = CODEX_API_ENDPOINT,
  signal,
  timeoutMs,
  fetchImpl = fetch,
}) {
  const requestTimeout = createTimeoutSignal(signal, timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: createCodexHeaders({ accessToken, accountId, sessionId }),
      body: JSON.stringify(body),
      signal: requestTimeout.signal,
    });
    if (!response.ok) {
      const error = new Error(
        `Codex API error ${response.status}: ${redactProviderErrorMessage(await readBoundedResponseText(response))}`
      );
      error.status = response.status;
      error.provider = true;
      throw error;
    }
    if (!response.body?.getReader) throw new Error('Codex returned a response without a stream.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = appendBoundedSseBuffer(buffer, decoder.decode(value, { stream: true }));
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          yield JSON.parse(data);
        } catch (_) {
          // Ignore keep-alive or incomplete SSE frames.
        }
      }
    }
  } catch (error) {
    if (requestTimeout.timedOut && !signal?.aborted) {
      const timeoutError = new Error('Provider request timed out.');
      timeoutError.code = 'provider_timeout';
      timeoutError.provider = true;
      throw timeoutError;
    }
    if (error?.name !== 'AbortError') error.provider = true;
    throw error;
  } finally {
    requestTimeout.cleanup();
  }
}
