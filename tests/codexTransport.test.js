import { describe, expect, it } from 'vitest';
import { buildCodexRequest, buildCodexTools } from '../src/orchestrator/CodexTransport.js';

describe('Codex Responses transport', () => {
  it('converts chat history and tools to the Responses wire shape', () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'lookup', description: 'Look up data', parameters: { type: 'object' } },
      },
    ];
    const body = buildCodexRequest({
      modelName: 'gpt-5.4',
      systemPrompt: 'Be concise.',
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call-1', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
      ],
      tools,
      toolChoice: 'auto',
      reasoningLevel: 'high',
    });

    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
      { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' },
      { type: 'function_call_output', call_id: 'call-1', output: '{"ok":true}' },
    ]);
    expect(buildCodexTools(tools)).toEqual([
      {
        type: 'function',
        name: 'lookup',
        description: 'Look up data',
        parameters: { type: 'object' },
      },
    ]);
    expect(body.tool_choice).toBe('auto');
    expect(body.reasoning).toEqual({ effort: 'high' });
  });
});
