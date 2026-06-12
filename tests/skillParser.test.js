import { describe, it, expect } from 'vitest';
import {
  parseSkillMarkdown,
  parseFrontmatter,
  validateMetadata,
  generateSkillMarkdown,
} from '../src/utils/skillParser.js';

describe('skillParser', () => {
  describe('parseSkillMarkdown', () => {
    it('returns invalid for empty input', () => {
      const result = parseSkillMarkdown('');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Empty or invalid/);
    });

    it('returns invalid for non-string input', () => {
      const result = parseSkillMarkdown(null);
      expect(result.valid).toBe(false);
    });

    it('parses valid frontmatter skill', () => {
      const md = [
        '---',
        'name: humanizer',
        'description: Makes text sound more natural',
        '---',
        '# Instructions',
        'Rewrite the text.',
      ].join('\n');

      const result = parseSkillMarkdown(md);
      expect(result.valid).toBe(true);
      expect(result.legacy).toBe(false);
      expect(result.metadata.name).toBe('humanizer');
      expect(result.metadata.description).toBe('Makes text sound more natural');
      expect(result.instructions).toContain('# Instructions');
    });

    it('parses legacy skill without frontmatter', () => {
      const md = 'Just some instructions with no frontmatter.';
      const result = parseSkillMarkdown(md);
      expect(result.valid).toBe(true);
      expect(result.legacy).toBe(true);
      expect(result.metadata.name).toBe('unknown');
    });

    it('rejects skill with missing closing ---', () => {
      const md = ['---', 'name: test', 'description: test'].join('\n');
      const result = parseSkillMarkdown(md);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/missing closing/);
    });

    it('rejects skill with uppercase name', () => {
      const md = [
        '---',
        'name: Humanizer',
        'description: Makes text natural',
        '---',
      ].join('\n');
      const result = parseSkillMarkdown(md);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/lowercase/);
    });

    it('rejects skill with hyphen-start name', () => {
      const md = [
        '---',
        'name: -bad',
        'description: test',
        '---',
      ].join('\n');
      const result = parseSkillMarkdown(md);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/hyphen/);
    });
  });

  describe('parseFrontmatter', () => {
    it('parses simple key-value pairs', () => {
      const text = 'name: test\ndescription: a test skill';
      const result = parseFrontmatter(text);
      expect(result.name).toBe('test');
      expect(result.description).toBe('a test skill');
    });

    it('parses inline arrays', () => {
      const text = 'tags: [coding, python, test]';
      const result = parseFrontmatter(text);
      expect(result.tags).toEqual(['coding', 'python', 'test']);
    });

    it('parses metadata block with nested JSON', () => {
      const text = [
        'metadata:',
        "  tags: 'coding, python'",
        "  version: '1.0.0'",
      ].join('\n');
      const result = parseFrontmatter(text);
      expect(result.metadata.tags).toBe('coding, python');
      expect(result.metadata.version).toBe('1.0.0');
    });

    it('throws on unexpected indentation', () => {
      const text = 'name: test\n  bad: indent';
      expect(() => parseFrontmatter(text)).toThrow(/unexpected indentation/);
    });
  });

  describe('validateMetadata', () => {
    it('rejects missing name', () => {
      const result = validateMetadata({ description: 'test' });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/name/);
    });

    it('rejects missing description', () => {
      const result = validateMetadata({ name: 'test' });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/description/);
    });

    it('accepts valid minimal metadata', () => {
      const result = validateMetadata({
        name: 'my-skill',
        description: 'A valid skill',
      });
      expect(result.valid).toBe(true);
      expect(result.metadata.name).toBe('my-skill');
    });

    it('rejects name exceeding max length', () => {
      const result = validateMetadata({
        name: 'a'.repeat(65),
        description: 'test',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/64 characters/);
    });

    it('rejects consecutive hyphens in name', () => {
      const result = validateMetadata({
        name: 'my--skill',
        description: 'test',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/consecutive hyphens/);
    });

    it('validates boolean fields', () => {
      const result = validateMetadata({
        name: 'test',
        description: 'test',
        'user-invocable': 'not-a-boolean',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/boolean/);
    });

    it('validates command-dispatch enum', () => {
      const result = validateMetadata({
        name: 'test',
        description: 'test',
        'command-dispatch': 'invalid',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/must be one of/);
    });

    it('validates directory name match', () => {
      const result = validateMetadata(
        { name: 'humanizer', description: 'test' },
        { expectedDirectoryName: 'humanizer' }
      );
      expect(result.valid).toBe(true);

      const mismatch = validateMetadata(
        { name: 'humanizer', description: 'test' },
        { expectedDirectoryName: 'wrong-name' }
      );
      expect(mismatch.valid).toBe(false);
      expect(mismatch.error).toMatch(/must match directory/);
    });
  });

  describe('generateSkillMarkdown', () => {
    it('generates valid SKILL.md from components', () => {
      const md = generateSkillMarkdown({
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do the thing.',
      });
      expect(md).toMatch(/^---\n/);
      expect(md).toContain('name: "test-skill"');
      expect(md).toContain('description: "A test skill"');
      expect(md).toContain('Do the thing.');
    });

    it('includes license when provided', () => {
      const md = generateSkillMarkdown({
        name: 'test',
        description: 'test',
        instructions: '',
        options: { license: 'MIT' },
      });
      expect(md).toContain('license: "MIT"');
    });

    it('includes metadata block when provided', () => {
      const md = generateSkillMarkdown({
        name: 'test',
        description: 'test',
        instructions: '',
        options: { metadata: { tags: 'coding', version: '1.0.0' } },
      });
      expect(md).toContain('metadata:');
      expect(md).toContain('tags:');
    });
  });
});
