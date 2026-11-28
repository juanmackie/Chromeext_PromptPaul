/**
 * @fileoverview WebMCP page-tool runtime against a fake `document.modelContext`.
 * @module webMcpContentScriptTests
 */

import fs from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Exercise the shipped content-script functions without loading unrelated code.
const source = fs.readFileSync(
  new URL('../content_script_page_actions.js', import.meta.url),
  'utf8'
);
const webMcpSource = source.slice(
  source.indexOf('  // --- WEBMCP PAGE TOOLS (OPTIONAL) ---'),
  source.indexOf('  async function executePageAction(')
);

function createModelContext(tools = [], overrides = {}) {
  const listeners = new Map();
  return {
    getTools: vi.fn(async () => tools),
    executeTool: vi.fn(async () => 'done'),
    addEventListener: vi.fn((type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    }),
    emit(type) {
      for (const listener of listeners.get(type) || []) listener({ type });
    },
    ...overrides,
  };
}

function createRuntime(modelContext) {
  const document = modelContext === undefined ? {} : { modelContext };
  const context = vm.createContext({
    document,
    setTimeout,
    clearTimeout,
    AbortController,
    capPageActionText(value, maxLength = 320) {
      // Mirror the shipped helper without the NUL-strip regex lint exception.
      return String(value || '')
        .split(String.fromCharCode(0))
        .join('')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, maxLength);
    },
  });
  vm.runInContext(
    `${webMcpSource}\nthis.__webmcp = { listPageActionWebMcpTools, callPageActionWebMcpTool };`,
    context
  );
  return context.__webmcp;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebMCP page runtime', () => {
  it('reports the API as absent without changing page-action behavior', async () => {
    const runtime = createRuntime(undefined);
    await expect(runtime.listPageActionWebMcpTools()).resolves.toEqual({
      success: true,
      available: false,
      tools: [],
    });
    await expect(runtime.callPageActionWebMcpTool({ name: 'add_todo' })).resolves.toMatchObject({
      available: false,
      error: 'WEBMCP_UNAVAILABLE',
    });
  });

  it('discovers and normalizes registered tools', async () => {
    const modelContext = createModelContext([
      { name: 'add_todo', description: ' Add a todo ', inputSchema: { type: 'object' } },
      {
        name: 'get_order_status',
        annotations: { readOnlyHint: true, untrustedContentHint: true },
      },
      { name: 'bad name' },
      { name: 'debug_probe', annotations: { debugging: true } },
    ]);
    const runtime = createRuntime(modelContext);
    const listed = await runtime.listPageActionWebMcpTools();
    expect(listed.available).toBe(true);
    expect(listed.tools).toEqual([
      {
        name: 'add_todo',
        description: 'Add a todo',
        inputSchema: { type: 'object' },
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false,
          consequentialHint: false,
          debugging: false,
        },
      },
      {
        name: 'get_order_status',
        description: '',
        inputSchema: null,
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: true,
          consequentialHint: false,
          debugging: false,
        },
      },
      {
        name: 'debug_probe',
        description: '',
        inputSchema: null,
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false,
          consequentialHint: false,
          debugging: true,
        },
      },
    ]);
  });

  it('re-reads the tool set after a toolchange event', async () => {
    const modelContext = createModelContext([{ name: 'add_todo' }]);
    const runtime = createRuntime(modelContext);
    await runtime.listPageActionWebMcpTools();
    await runtime.listPageActionWebMcpTools();
    expect(modelContext.getTools).toHaveBeenCalledTimes(1);

    modelContext.getTools.mockResolvedValue([{ name: 'add_todo' }, { name: 'remove_todo' }]);
    modelContext.emit('toolchange');

    const listed = await runtime.listPageActionWebMcpTools();
    expect(modelContext.getTools).toHaveBeenCalledTimes(2);
    expect(listed.tools.map((tool) => tool.name)).toEqual(['add_todo', 'remove_todo']);
  });

  it('probes live annotations instead of annotations from an earlier listing', async () => {
    const modelContext = createModelContext([{ name: 'add_todo' }]);
    const runtime = createRuntime(modelContext);
    await runtime.listPageActionWebMcpTools();

    // The page upgrades the tool to consequential after it was listed.
    modelContext.getTools.mockResolvedValue([
      { name: 'add_todo', annotations: { consequentialHint: true } },
    ]);
    const probe = await runtime.callPageActionWebMcpTool({ name: 'add_todo' });
    expect(probe).toMatchObject({
      probe: true,
      name: 'add_todo',
      annotations: { consequentialHint: true },
    });
    expect(modelContext.executeTool).not.toHaveBeenCalled();
  });

  it('executes an approved tool and bounds its result', async () => {
    const modelContext = createModelContext([{ name: 'add_todo' }], {
      executeTool: vi.fn(async () => 'r'.repeat(5_000)),
    });
    const runtime = createRuntime(modelContext);
    const result = await runtime.callPageActionWebMcpTool({
      name: 'add_todo',
      arguments: { text: 'Buy milk' },
      approve: true,
    });
    expect(modelContext.executeTool).toHaveBeenCalledTimes(1);
    const [tool, input, options] = modelContext.executeTool.mock.calls[0];
    expect(tool.name).toBe('add_todo');
    expect(input).toEqual({ text: 'Buy milk' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({ ok: true, name: 'add_todo', truncated: true, navigated: false });
    expect(result.text).toHaveLength(4_000);
  });

  it('reports tool failure and missing tools without throwing', async () => {
    const modelContext = createModelContext([{ name: 'add_todo' }], {
      executeTool: vi.fn(async () => {
        throw new Error('page tool exploded');
      }),
    });
    const runtime = createRuntime(modelContext);
    await expect(
      runtime.callPageActionWebMcpTool({ name: 'add_todo', approve: true })
    ).resolves.toMatchObject({ ok: false, error: 'WEBMCP_TOOL_FAILED' });
    await expect(runtime.callPageActionWebMcpTool({ name: 'gone' })).resolves.toMatchObject({
      error: 'WEBMCP_TOOL_UNAVAILABLE',
    });
  });

  it('aborts a tool that exceeds the execution timeout', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const modelContext = createModelContext([{ name: 'slow_tool' }], {
      executeTool: vi.fn(
        (_tool, _input, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          })
      ),
    });
    const runtime = createRuntime(modelContext);
    const pending = runtime.callPageActionWebMcpTool({ name: 'slow_tool', approve: true });
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'WEBMCP_TIMEOUT' });
    expect(aborted).toBe(true);
  });

  it('rejects malformed or oversized tool arguments', async () => {
    const modelContext = createModelContext([{ name: 'add_todo' }]);
    const runtime = createRuntime(modelContext);
    await expect(
      runtime.callPageActionWebMcpTool({ name: 'add_todo', arguments: ['nope'], approve: true })
    ).resolves.toMatchObject({ error: 'WEBMCP_ARGUMENTS_INVALID' });
    await expect(
      runtime.callPageActionWebMcpTool({
        name: 'add_todo',
        arguments: { text: 'y'.repeat(2_000) },
        approve: true,
      })
    ).resolves.toMatchObject({ error: 'WEBMCP_ARGUMENTS_INVALID' });
    expect(modelContext.executeTool).not.toHaveBeenCalled();
  });
});
