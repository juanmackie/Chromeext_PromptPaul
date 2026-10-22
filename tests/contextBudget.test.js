import { describe, it, expect } from 'vitest';
import {
  resolveDomContextBudget,
  fitTextToTokenBudget,
  estimateTextTokens,
} from '../src/utils/contextBudget.js';

describe('contextBudget', () => {
  describe('estimateTextTokens', () => {
    it('returns 0 for empty text', () => {
      expect(estimateTextTokens('')).toBe(0);
      expect(estimateTextTokens(null)).toBe(0);
    });

    it('estimates tokens for ASCII text', () => {
      const tokens = estimateTextTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    it('counts whitespace less aggressively than content', () => {
      const textWithSpaces = 'a b c d e f g h i j';
      const textWithout = 'abcdefghij';
      const tokensWith = estimateTextTokens(textWithSpaces);
      const tokensWithout = estimateTextTokens(textWithout);
      // Spaces count less per character than content chars
      expect(tokensWith).toBeLessThan(tokensWithout + 5);
    });
  });

  describe('estimateTextTokens equivalence', () => {
    const dense =
      /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Sinhala}]/u;
    const reference = (text) => {
      let compact = 0;
      let denseCount = 0;
      let whitespace = 0;
      for (const char of String(text || '')) {
        if (/\s/u.test(char)) whitespace += 1;
        else if (dense.test(char)) denseCount += 1;
        else compact += 1;
      }
      return Math.ceil(compact / 3.2 + denseCount / 1.15 + whitespace / 8);
    };

    it.each([
      '',
      'ASCII text with words and punctuation.',
      '\t\n\r\v\f \u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
      '汉字かなカナ 한글',
      'العَرَبِيَّة עברית ภาษาไทย हिन्दी বাংলা தமிழ் తెలుగు සිංහල',
      'Emoji 😀 🧑🏽‍💻 and surrogate boundaries',
      'Latin 😀 漢字\n  x\u00a0y',
    ])('matches the prior formula for a sample', (sample) => {
      expect(estimateTextTokens(sample)).toBe(reference(sample));
    });

    it('matches the prior formula for a long mixed transcript', () => {
      const text = 'A long mixed transcript 漢字\n'.repeat(12_000);
      expect(estimateTextTokens(text)).toBe(reference(text));
    });
  });

  describe('resolveDomContextBudget', () => {
    it('returns valid budget for default input', () => {
      const budget = resolveDomContextBudget({});
      expect(budget.modelContextTokens).toBe(64000);
      expect(budget.perContextDomTokens).toBeGreaterThan(0);
      expect(budget.availableDomTokens).toBeGreaterThan(0);
    });

    it('adjusts for model ID', () => {
      const gpt4Budget = resolveDomContextBudget({ modelId: 'gpt-4' });
      expect(gpt4Budget.modelContextTokens).toBe(128000);

      const fastBudget = resolveDomContextBudget({ modelId: 'spark-fast' });
      expect(fastBudget.modelContextTokens).toBe(64000);
    });

    it('scales per-context with context count', () => {
      const single = resolveDomContextBudget({ contextCount: 1 });
      const double = resolveDomContextBudget({ contextCount: 2 });
      expect(double.perContextDomTokens).toBeLessThan(single.perContextDomTokens);
    });

    it('accounts for file attachments', () => {
      const noFiles = resolveDomContextBudget({ fileAttachmentCount: 0 });
      const withFiles = resolveDomContextBudget({ fileAttachmentCount: 2 });
      expect(withFiles.reservedPromptTokens).toBeGreaterThan(noFiles.reservedPromptTokens);
    });

    it('accounts for user message length', () => {
      const short = resolveDomContextBudget({ userMessage: 'hi' });
      const long = resolveDomContextBudget({ userMessage: 'a'.repeat(1000) });
      expect(long.userMessageTokens).toBeGreaterThan(short.userMessageTokens);
    });
  });

  describe('fitTextToTokenBudget', () => {
    it('returns text unchanged when under budget', () => {
      const text = 'Short text';
      const result = fitTextToTokenBudget(text, 1000);
      expect(result.truncated).toBe(false);
      expect(result.text).toBe(text);
    });

    it('truncates text when over budget', () => {
      const text = 'word '.repeat(500);
      const result = fitTextToTokenBudget(text, 100);
      expect(result.truncated).toBe(true);
      expect(result.includedTokens).toBeLessThanOrEqual(100);
      expect(result.text).toContain('...');
    });

    it('returns empty for zero budget with content', () => {
      const result = fitTextToTokenBudget('some text', 0);
      expect(result.truncated).toBe(true);
      expect(result.includedTokens).toBe(0);
    });

    it('normalizes line endings', () => {
      const text = 'line1\r\nline2\r\nline3';
      const result = fitTextToTokenBudget(text, 10000);
      expect(result.text).not.toContain('\r');
    });

    it('collapses excessive newlines', () => {
      const text = 'a\n\n\n\n\n\n\n\n\n\nb';
      const result = fitTextToTokenBudget(text, 10000);
      expect(result.text).not.toMatch(/\n{4,}/);
    });
  });
});
