/**
 * @fileoverview Custom instruction normalization and search behavior.
 * @module optionsInstructionsTests
 */
import { describe, expect, it } from 'vitest';
import {
  getInstructionSearchTerms,
  matchesInstructionSearch,
  normalizeInstructionRecord,
  normalizeInstructionTags,
} from '../src/options/OptionsInstructions.js';
import {
  MAX_INSTRUCTION_CONTENT_CHARS,
  MAX_INSTRUCTION_NAME_CHARS,
} from '../src/options/OptionsLimits.js';

describe('Options instruction data', () => {
  it('normalizes tags, removes case-insensitive duplicates, and enforces tag count and length bounds', () => {
    expect(normalizeInstructionTags('  Research   Notes, research notes; Planning ')).toEqual([
      'Research Notes',
      'Planning',
    ]);
    expect(
      normalizeInstructionTags(Array.from({ length: 14 }, (_, index) => `tag-${index}`))
    ).toHaveLength(12);
    expect(normalizeInstructionTags(['x'.repeat(55)])[0]).toHaveLength(40);
  });

  it('rejects empty or over-limit records and assigns stable normalized fields', () => {
    expect(normalizeInstructionRecord({ name: 'Missing content' })).toBeNull();
    expect(
      normalizeInstructionRecord({
        name: 'x'.repeat(MAX_INSTRUCTION_NAME_CHARS + 1),
        content: 'body',
      })
    ).toBeNull();
    expect(
      normalizeInstructionRecord({
        name: 'Valid',
        content: 'x'.repeat(MAX_INSTRUCTION_CONTENT_CHARS + 1),
      })
    ).toBeNull();

    const record = normalizeInstructionRecord({
      id: ' My Instruction! ',
      name: '  A useful title  ',
      content: '  Keep this context bounded.  ',
      tags: 'Research, Planning',
      tool_choice: ['auto', '  '],
      modalities: ['text', 'unknown', 'image', 'text'],
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    expect(record).toMatchObject({
      id: 'my-instruction',
      name: 'A useful title',
      content: 'Keep this context bounded.',
      tags: ['Research', 'Planning'],
      tool_choice: ['auto'],
      modalities: ['text', 'image'],
      createdAt: '2026-01-02T03:04:05.000Z',
      lastUpdated: '2026-01-02T03:04:05.000Z',
    });
    expect(
      normalizeInstructionRecord({ name: 'Title', content: 'Body', createdAt: record.createdAt }).id
    ).toMatch(/^inst_[a-z0-9]+$/);
  });

  it('requires every normalized search term to match across instruction fields', () => {
    const instruction = {
      name: 'Team report',
      content: 'Summarize the weekly progress',
      tool_choice: 'auto',
      tags: ['planning', 'work'],
    };
    const terms = getInstructionSearchTerms('  TEAM   AUTO  ');
    expect(terms).toEqual(['team', 'auto']);
    expect(matchesInstructionSearch(instruction, terms)).toBe(true);
    expect(matchesInstructionSearch(instruction, ['team', 'missing'])).toBe(false);
    expect(matchesInstructionSearch(instruction, [])).toBe(true);
  });
});
