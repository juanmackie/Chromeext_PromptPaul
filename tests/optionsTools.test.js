/**
 * @fileoverview Custom tool import normalization behavior.
 * @module optionsToolsTests
 */
import { describe, expect, it } from 'vitest';
import { normalizeToolsForImport } from '../src/options/OptionsTools.js';
import { MAX_IMPORTED_RECORDS } from '../src/options/OptionsLimits.js';

describe('Options tool imports', () => {
  it('keeps valid tools and counts invalid or reserved entries for the user notice', () => {
    expect(
      normalizeToolsForImport([
        {
          id: 'tool-1',
          name: 'lookup_weather',
          description: 'Look up current weather.',
          parameters: { type: 'object', properties: {} },
          endpointUrl: 'https://api.example.test/weather',
          httpMethod: 'POST',
        },
        { name: 'web_search', description: 'Reserved tool name' },
        { name: 'missing-description' },
      ])
    ).toEqual({
      valid: true,
      tools: [
        {
          id: 'tool-1',
          name: 'lookup_weather',
          description: 'Look up current weather.',
          parameters: '{"type":"object","properties":{}}',
          endpointUrl: 'https://api.example.test/weather',
          httpMethod: 'POST',
        },
      ],
      skippedCount: 2,
    });
  });

  it('rejects malformed and over-limit imports before merging them', () => {
    expect(normalizeToolsForImport(null)).toEqual({ valid: false, reason: 'format' });
    expect(normalizeToolsForImport(Array.from({ length: MAX_IMPORTED_RECORDS + 1 }))).toEqual({
      valid: false,
      reason: 'too_many',
    });
  });
});
