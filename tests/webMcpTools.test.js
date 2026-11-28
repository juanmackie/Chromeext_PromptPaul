/**
 * @fileoverview WebMCP tool normalization, annotation gating, and bounded output.
 * @module webMcpToolsTests
 */
import { describe, expect, it } from 'vitest';
import {
  WEBMCP_UNTRUSTED_RESULT_NOTICE,
  boundWebMcpToolText,
  classifyWebMcpTool,
  isWebMcpToolVisible,
  normalizeWebMcpAnnotations,
  normalizeWebMcpTool,
  normalizeWebMcpToolList,
} from '../src/act/WebMcpTools.js';
import { PAGE_WEBMCP_CAPS, normalizePageActionArgs } from '../src/utils/pageActionPolicy.js';

describe('WebMCP tool normalization', () => {
  it('normalizes a page tool into a bounded record', () => {
    const tool = normalizeWebMcpTool({
      name: 'add_todo',
      description: `  Add a todo item ${'x'.repeat(400)}  `,
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      annotations: { readOnlyHint: true, untrustedContentHint: true, extra: 'ignored' },
      source: { some: 'window' },
      execute: () => 'never forwarded',
    });
    expect(tool).toEqual({
      name: 'add_todo',
      description: expect.any(String),
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
        consequentialHint: false,
        debugging: false,
      },
    });
    expect(tool.description.length).toBe(PAGE_WEBMCP_CAPS.maxDescriptionChars);
    expect(tool.description.endsWith('x')).toBe(true);
    expect(tool).not.toHaveProperty('execute');
    expect(tool).not.toHaveProperty('source');
  });

  it('drops unusable names, duplicates, and oversized schemas', () => {
    const tools = normalizeWebMcpToolList([
      { name: 'ok_tool' },
      { name: 'ok_tool', description: 'duplicate' },
      { name: '' },
      { name: 'has space' },
      { name: 'x'.repeat(80) },
      { name: 'big_schema', inputSchema: { blob: 'y'.repeat(PAGE_WEBMCP_CAPS.maxSchemaChars) } },
      null,
      'not a tool',
    ]);
    expect(tools.map((tool) => tool.name)).toEqual(['ok_tool', 'big_schema']);
    expect(tools[1].inputSchema).toBeNull();
  });

  it('caps the listed tool count', () => {
    const tools = normalizeWebMcpToolList(
      Array.from({ length: 50 }, (_unused, index) => ({ name: `tool_${index}` }))
    );
    expect(tools).toHaveLength(PAGE_WEBMCP_CAPS.maxTools);
  });

  it('treats non-boolean annotations as absent', () => {
    expect(normalizeWebMcpAnnotations({ readOnlyHint: 'true', consequentialHint: 1 })).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
      consequentialHint: false,
      debugging: false,
    });
    expect(normalizeWebMcpAnnotations(null)).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
      consequentialHint: false,
      debugging: false,
    });
  });
});

describe('WebMCP annotation gating', () => {
  it('requires confirmation even when the page declares read-only', () => {
    const decision = classifyWebMcpTool({ name: 'search', annotations: { readOnlyHint: true } });
    expect(decision).toMatchObject({
      allowed: true,
      readOnly: true,
      requiresConfirmation: true,
      untrusted: true,
      risk: 'read-only',
    });
    expect(decision.reason).toMatch(/untrusted/);
  });

  it('confirms every tool that is not declared read-only', () => {
    expect(classifyWebMcpTool({ name: 'add_todo' })).toMatchObject({
      allowed: true,
      readOnly: false,
      requiresConfirmation: true,
      risk: 'high',
    });
    const consequential = classifyWebMcpTool({
      name: 'book_flight',
      annotations: { consequentialHint: true },
    });
    expect(consequential.requiresConfirmation).toBe(true);
    expect(consequential.reason).toMatch(/hard-to-reverse change/);
    // A read-only claim cannot downgrade a consequential tool.
    expect(
      classifyWebMcpTool({
        name: 'pay',
        annotations: { readOnlyHint: true, consequentialHint: true },
      }).requiresConfirmation
    ).toBe(true);
  });

  it('hides developer debugging tools', () => {
    const tool = { name: 'inspect_state', annotations: { debugging: true, readOnlyHint: true } };
    expect(isWebMcpToolVisible(tool)).toBe(false);
    expect(classifyWebMcpTool(tool)).toMatchObject({ allowed: false, risk: 'prohibited' });
  });

  it('marks untrusted-content output and bounds the result text', () => {
    expect(
      classifyWebMcpTool({
        name: 'reviews',
        annotations: { readOnlyHint: true, untrustedContentHint: true },
      }).untrusted
    ).toBe(true);
    const bounded = boundWebMcpToolText({ text: 'z'.repeat(PAGE_WEBMCP_CAPS.maxResultChars + 50) });
    expect(bounded.text).toHaveLength(PAGE_WEBMCP_CAPS.maxResultChars);
    expect(bounded.truncated).toBe(true);
    expect(WEBMCP_UNTRUSTED_RESULT_NOTICE).toMatch(/untrusted page content/);
  });
});

describe('WebMCP page-action arguments', () => {
  it('accepts a listed tool name with bounded JSON arguments', () => {
    expect(normalizePageActionArgs('page_webmcp_tools', {}).value).toEqual({});
    const normalized = normalizePageActionArgs('page_webmcp_call', {
      name: 'add_todo',
      arguments: { text: 'Buy milk' },
      title: 'Adding the item',
    });
    expect(normalized.valid).toBe(true);
    expect(normalized.value).toEqual({
      name: 'add_todo',
      arguments: { text: 'Buy milk' },
      title: 'Adding the item',
    });
  });

  it('rejects unknown names and oversized arguments', () => {
    expect(normalizePageActionArgs('page_webmcp_call', { name: '../evil' }).valid).toBe(false);
    expect(normalizePageActionArgs('page_webmcp_call', {}).valid).toBe(false);
    expect(
      normalizePageActionArgs('page_webmcp_call', {
        name: 'add_todo',
        arguments: { text: 'y'.repeat(PAGE_WEBMCP_CAPS.maxInputChars + 1) },
      }).valid
    ).toBe(false);
    expect(
      normalizePageActionArgs('page_webmcp_call', { name: 'add_todo', arguments: ['nope'] }).valid
    ).toBe(false);
  });
});
