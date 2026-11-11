/**
 * @fileoverview Usage-analytics label and payload tests.
 * @module usageAnalyticsTest
 */

import { describe, expect, it } from 'vitest';
import {
  buildUsageEventPayload,
  normalizeAnalyticsTools,
  sanitizeAnalyticsLabel,
  sanitizeModelLabel,
} from '../src/background/usageAnalytics.js';

describe('usageAnalytics.sanitizeAnalyticsLabel', () => {
  it('keeps readable instruction names that previously collapsed to unknown', () => {
    expect(sanitizeAnalyticsLabel('Summarize this page')).toBe('summarize this page');
    expect(sanitizeAnalyticsLabel('Draft Email Reply')).toBe('draft email reply');
    expect(sanitizeAnalyticsLabel('Extract key points')).toBe('extract key points');
    expect(sanitizeAnalyticsLabel('Author bio')).toBe('author bio');
  });

  it('normalizes spacing and punctuation within bounds', () => {
    expect(sanitizeAnalyticsLabel('  Q&A: (short)  ')).toBe('q&a: short');
    expect([...sanitizeAnalyticsLabel('summarize '.repeat(20))].length).toBe(64);
  });

  it('rejects emails, credential-shaped values, and non-strings', () => {
    expect(sanitizeAnalyticsLabel('bob@example.com')).toBeUndefined();
    expect(sanitizeAnalyticsLabel('Contact bob@example.com')).toBeUndefined();
    expect(sanitizeAnalyticsLabel('sk-proj-abcdefghijklmnop')).toBeUndefined();
    expect(
      sanitizeAnalyticsLabel('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc')
    ).toBeUndefined();
    expect(sanitizeAnalyticsLabel('password')).toBeUndefined();
    expect(sanitizeAnalyticsLabel('')).toBeUndefined();
    expect(sanitizeAnalyticsLabel(null)).toBeUndefined();
  });

  it('keeps an @ mention that is not an email address', () => {
    expect(sanitizeAnalyticsLabel('Reply @mention')).toBe('reply mention');
  });
});

describe('usageAnalytics.sanitizeModelLabel', () => {
  it('keeps provider model identifiers that previously collapsed to unknown', () => {
    expect(sanitizeModelLabel('openrouter/free')).toBe('openrouter/free');
    expect(sanitizeModelLabel('Claude 3.5 Sonnet')).toBe('claude 3.5 sonnet');
    expect(sanitizeModelLabel('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
    expect(sanitizeModelLabel('@cf/meta/llama-3.1-8b-instruct')).toBe(
      '@cf/meta/llama-3.1-8b-instruct'
    );
  });

  it('drops empty and non-string values', () => {
    expect(sanitizeModelLabel('')).toBeUndefined();
    expect(sanitizeModelLabel(undefined)).toBeUndefined();
    expect(sanitizeModelLabel('sk-proj-abcdefghijklmnop')).toBeUndefined();
  });
});

describe('usageAnalytics.normalizeAnalyticsTools', () => {
  it('splits, sanitizes, deduplicates, and bounds tool labels', () => {
    expect(
      normalizeAnalyticsTools(['web_search', 'none', 'skill_view', 'web_search', 'auto'])
    ).toEqual(['web_search', 'skill_view', 'auto']);
    expect(normalizeAnalyticsTools('web_search, skill_view')).toEqual(['web_search', 'skill_view']);
  });

  it('returns an empty list for missing or none-only choices', () => {
    expect(normalizeAnalyticsTools(undefined)).toEqual([]);
    expect(normalizeAnalyticsTools(['none'])).toEqual([]);
  });
});

describe('usageAnalytics.buildUsageEventPayload', () => {
  it('builds a complete Umami event with a readable instruction and model', () => {
    const payload = buildUsageEventPayload({
      website: 'site-id',
      name: 'instruction_used',
      instance: 'instance-1',
      data: {
        instruction: 'summarize this page',
        model: 'openrouter/free',
        tools: ['web_search'],
        count: 1,
      },
    });

    expect(payload.type).toBe('event');
    expect(payload.payload).toMatchObject({
      website: 'site-id',
      hostname: 'extension',
      name: 'instruction_used',
      id: 'instance-1',
      url: '/ext/usage/summarize%20this%20page',
      data: {
        instruction: 'summarize this page',
        model: 'openrouter/free',
        tools: ['web_search'],
        count: 1,
      },
    });
    expect(payload.payload).not.toHaveProperty('event_name');
  });

  it('falls back to the event name in the path and keeps the distinct ID', () => {
    const payload = buildUsageEventPayload({
      website: 'site-id',
      name: 'feature_used',
      data: { instance: 'instance-2', feature: 'notch' },
    });

    expect(payload.payload.url).toBe('/ext/usage/feature_used');
    expect(payload.payload.id).toBe('instance-2');
    expect(payload.payload.data).toMatchObject({
      instruction: 'unknown',
      model: 'unknown',
      tools: [],
    });
  });
});
