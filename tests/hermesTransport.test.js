import { describe, expect, it } from 'vitest';
import {
  buildHermesUrl,
  extractHermesOutputText,
  getMissingHermesCapabilities,
  HermesTransport,
  normalizeHermesEndpoint,
  normalizeHermesEvent,
  parseHermesEventData,
} from '../src/orchestrator/HermesTransport.js';

describe('HermesTransport', () => {
  it('accepts loopback endpoints and builds profile routes', () => {
    expect(normalizeHermesEndpoint('http://127.0.0.1:8642/')).toBe('http://127.0.0.1:8642');
    expect(buildHermesUrl('http://127.0.0.1:8642', '/v1/runs', 'work')).toBe(
      'http://127.0.0.1:8642/p/work/v1/runs'
    );
  });

  it('rejects untrusted remote endpoints and URL credentials', () => {
    expect(() => normalizeHermesEndpoint('http://example.test')).toThrow(/trust confirmation/i);
    expect(() => normalizeHermesEndpoint('https://user:pass@example.test')).toThrow(/credentials/i);
    expect(normalizeHermesEndpoint('https://example.test', { allowRemoteNetwork: true })).toBe(
      'https://example.test'
    );
  });

  it('accepts a remote HTTP Tailscale gateway after explicit confirmation', () => {
    expect(
      normalizeHermesEndpoint('http://100.126.237.111:30433', { allowRemoteNetwork: true })
    ).toBe('http://100.126.237.111:30433');
  });

  it('detects missing required gateway capabilities', () => {
    expect(
      getMissingHermesCapabilities({
        features: {
          run_submission: true,
          run_status: true,
          run_events_sse: true,
          run_stop: true,
          run_approval: true,
        },
      })
    ).toEqual([]);
    expect(getMissingHermesCapabilities({ features: { run_submission: true } })).toContain(
      'run_events_sse'
    );
    expect(getMissingHermesCapabilities({})).toHaveLength(5);
  });

  it('accepts the released gateway run_approval_response feature name', () => {
    expect(
      getMissingHermesCapabilities({
        features: {
          run_submission: true,
          run_status: true,
          run_events_sse: true,
          run_stop: true,
          run_approval_response: true,
        },
      })
    ).toEqual([]);
  });

  it('extracts text from recovered Hermes output shapes', () => {
    expect(extractHermesOutputText('Done')).toBe('Done');
    expect(
      extractHermesOutputText([
        { type: 'function_call', name: 'terminal' },
        { type: 'message', content: [{ type: 'output_text', text: 'Done.' }] },
      ])
    ).toBe('Done.');
    expect(extractHermesOutputText({ message: { content: 'Recovered.' } })).toBe('Recovered.');
  });

  it('maps documented event types into Prompt Paul events', () => {
    expect(normalizeHermesEvent({ type: 'message.delta', delta: 'Hello' })).toEqual({
      type: 'content',
      data: 'Hello',
    });
    expect(
      normalizeHermesEvent({ type: 'approval.request', approval_id: 'a1', summary: 'Run' })
    ).toEqual({
      type: 'hermes_approval_required',
      approvalId: 'a1',
      summary: 'Run',
      choices: ['once', 'session', 'always', 'deny'],
    });
    expect(normalizeHermesEvent({ type: 'run.cancelled' })).toEqual({
      type: 'hermes_terminal',
      status: 'stopped',
    });
    expect(
      normalizeHermesEvent({ type: 'run.completed', output: 'Done.', usage: { input_tokens: 4 } })
    ).toEqual({
      type: 'hermes_terminal',
      status: 'complete',
      output: 'Done.',
      usage: { input_tokens: 4 },
    });
  });

  it('parses JSON data and ignores terminal sentinels', () => {
    expect(parseHermesEventData('{"type":"run.completed"}')).toEqual({ type: 'run.completed' });
    expect(parseHermesEventData('[DONE]')).toBeNull();
    expect(() => parseHermesEventData('{')).toThrow(/invalid/i);
  });

  it('submits a run and consumes bounded SSE events without exposing the key', async () => {
    const calls = [];
    const encoder = new TextEncoder();
    const response = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });
    const streamResponse = {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"message.delta","delta":"Hi"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"run.completed"}\n\n'));
          controller.close();
        },
      }),
      text: async () => '',
    };
    const transport = new HermesTransport({
      credentialProvider: async () => 'secret-key',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/api/sessions')) {
          return response({ object: 'hermes.session', session: { id: 'session-1' } }, 201);
        }
        if (url.endsWith('/v1/runs'))
          return response({ run_id: 'run-1', session_id: 'session-1' }, 202);
        if (url.endsWith('/events')) return streamResponse;
        return response({});
      },
    });
    const profile = {
      id: 'p1',
      hermesEndpoint: 'http://127.0.0.1:8642',
      hermesProfile: '',
    };
    const session = await transport.ensureSession(profile);
    const run = await transport.startRun(profile, {
      input: 'Hello',
      conversationHistory: [{ role: 'user', content: 'Earlier context' }],
      sessionId: session,
      sessionKey: 'memory-key',
    });
    const events = [];
    await transport.streamRun(profile, run.runId, {
      sessionKey: 'memory-key',
      onEvent: (event) => events.push(event),
    });

    expect(session).toBe('session-1');
    expect(run.runId).toBe('run-1');
    const runRequest = calls.find(({ url }) => url.endsWith('/v1/runs'));
    expect(JSON.parse(runRequest.init.body).conversation_history).toEqual([
      { role: 'user', content: 'Earlier context' },
    ]);
    expect(events.map((event) => event.type)).toEqual(['message.delta', 'run.completed']);
    expect(
      calls.every(
        ({ url, init }) =>
          !url.includes('secret-key') && !String(init.body || '').includes('secret-key')
      )
    ).toBe(true);
    expect(calls[0].init.headers.Authorization).toBe('Bearer secret-key');
    expect(calls[0].init.headers['X-Hermes-Session-Key']).toBeUndefined();
  });

  it('includes a bounded gateway error detail without exposing credentials', async () => {
    const transport = new HermesTransport({
      credentialProvider: async () => 'secret-key',
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          error: { message: 'Invalid API key: secret-key' },
        }),
      }),
    });

    await expect(
      transport.ensureSession({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' })
    ).rejects.toThrow('Hermes session creation failed (HTTP 403): Invalid API key: [redacted]');
  });

  it('rejects a gateway that does not advertise required run support', async () => {
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => (url.endsWith('/health') ? { status: 'ok' } : { features: {} }),
      }),
    });

    await expect(
      transport.checkConnection({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' })
    ).rejects.toMatchObject({ code: 'unsupported_gateway' });
  });

  it('allows degraded provider health when required run support is advertised', async () => {
    const features = {
      run_submission: true,
      run_status: true,
      run_events_sse: true,
      run_stop: true,
      run_approval: true,
    };
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async (url) => {
        if (url.endsWith('/health')) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: { message: "Auth provider 'nous' unreachable" } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ features }) };
      },
    });

    await expect(
      transport.checkConnection({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' })
    ).resolves.toMatchObject({
      healthWarning: {
        status: 503,
        message: expect.stringContaining("Auth provider 'nous' unreachable"),
      },
      capabilities: { features },
    });
  });

  it('does not hide non-degraded health failures', async () => {
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } }),
      }),
    });

    await expect(
      transport.checkConnection({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('preserves the gateway error code for session recovery decisions', async () => {
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'session_not_found', message: 'Missing session' } }),
      }),
    });

    await expect(
      transport.startRun(
        { id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' },
        { input: 'Hello', sessionId: 'stale-session' }
      )
    ).rejects.toMatchObject({ status: 404, code: 'session_not_found' });
  });

  it('ends a session with the documented new-conversation reason', async () => {
    let request;
    const transport = new HermesTransport({
      credentialProvider: async () => 'secret-key',
      fetchImpl: async (url, init) => {
        request = { url, init };
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });

    await expect(
      transport.endSession({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' }, 'session/1')
    ).resolves.toBe(true);

    expect(request.url).toBe('http://127.0.0.1:8642/api/sessions/session%2F1');
    expect(request.init.method).toBe('PATCH');
    expect(JSON.parse(request.init.body)).toEqual({ end_reason: 'new_conversation' });
    expect(request.init.headers.Authorization).toBe('Bearer secret-key');
  });

  it('only treats the documented missing-session error as already ended', async () => {
    const missingSession = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'session_not_found' } }),
      }),
    });
    await expect(
      missingSession.endSession({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' }, 'session-1')
    ).resolves.toBe(false);

    const otherNotFound = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'route_not_found' } }),
      }),
    });
    await expect(
      otherNotFound.endSession({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' }, 'session-1')
    ).rejects.toMatchObject({ status: 404 });
  });

  it('clears only the session pointer and preserves the memory key', async () => {
    let storedSession = 'session-1';
    const memoryKey = 'prompt-paul-memory-key';
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      sessionKeyProvider: async () => memoryKey,
      sessionStore: {
        get: async () => storedSession,
        delete: async () => {
          storedSession = '';
        },
      },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    });

    await transport.clearStoredSession('p1');

    expect(storedSession).toBe('');
    await expect(transport.getSessionKey('p1')).resolves.toBe(memoryKey);
  });

  it('normalizes legacy session strings and stores conversation-bound records', async () => {
    let stored = 'legacy-session';
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      sessionStore: {
        get: async () => stored,
        set: async (_profileId, value) => {
          stored = value;
        },
      },
    });

    await expect(transport.getStoredSessionRecord('p1')).resolves.toEqual({
      sessionId: 'legacy-session',
      conversationId: '',
    });
    await transport.storeSession('p1', 'session-2', 'conversation-2');
    expect(stored).toEqual({ sessionId: 'session-2', conversationId: 'conversation-2' });
  });

  it('reads pollable run status with the memory-scoping session key', async () => {
    let request;
    const transport = new HermesTransport({
      credentialProvider: async () => 'secret-key',
      fetchImpl: async (url, init) => {
        request = { url, init };
        return {
          ok: true,
          status: 200,
          json: async () => ({ run_id: 'run-1', status: 'completed', output: 'Done' }),
        };
      },
    });

    await expect(
      transport.getRunStatus({ id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' }, 'run-1', {
        sessionKey: 'memory-key',
      })
    ).resolves.toMatchObject({ status: 'completed', output: 'Done' });
    expect(request.url).toBe('http://127.0.0.1:8642/v1/runs/run-1');
    expect(request.init.headers['X-Hermes-Session-Key']).toBe('memory-key');
  });

  it('sends only the gateway-supported approval choice', async () => {
    let request;
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async (url, init) => {
        request = { url, init };
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });

    await transport.respondToApproval(
      { id: 'p1', hermesEndpoint: 'http://127.0.0.1:8642' },
      'run-1',
      'once',
      {}
    );

    expect(JSON.parse(request.init.body)).toEqual({ choice: 'once' });
  });

  it('omits authorization when a trusted gateway does not use an API key', async () => {
    let request;
    const transport = new HermesTransport({
      credentialProvider: async () => '',
      fetchImpl: async (url, init) => {
        request = { url, init };
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });

    await transport.getCapabilities({
      id: 'trusted-hermes',
      hermesEndpoint: 'http://127.0.0.1:8642',
    });

    expect(request.init.headers.Authorization).toBeUndefined();
  });

  it('binds the default worker fetch implementation to the global scope', async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, json: async () => ({}) };
    };

    try {
      const transport = new HermesTransport({ credentialProvider: async () => '' });
      await transport.getCapabilities({
        id: 'default-fetch',
        hermesEndpoint: 'http://127.0.0.1:8642',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(request.url).toBe('http://127.0.0.1:8642/v1/capabilities');
  });
});
