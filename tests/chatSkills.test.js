import { describe, it, expect } from 'vitest';
import { parseCommand, detectSkillIntent, formatSkillsList } from '../src/chat/ChatSkills.js';

const mockSkills = [
  { name: 'humanizer', description: 'Makes text natural', userInvocable: true },
  { name: 'summarizer', description: 'Summarizes text', userInvocable: true },
  { name: 'weather-guide', description: 'Weather info', userInvocable: false },
];

describe('ChatSkills', () => {
  describe('parseCommand', () => {
    it('returns null type for non-slash input', () => {
      const result = parseCommand('hello world', mockSkills);
      expect(result.type).toBeNull();
      expect(result.body).toBe('hello world');
    });

    it('detects /skills command', () => {
      const result = parseCommand('/skills', mockSkills);
      expect(result.type).toBe('skills');
      expect(result.skillName).toBeNull();
    });

    it('detects /skill <name> canonical form', () => {
      const result = parseCommand('/skill humanizer rewrite this', mockSkills);
      expect(result.type).toBe('skill');
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toBe('rewrite this');
    });

    it('detects /skill <name> without body', () => {
      const result = parseCommand('/skill humanizer', mockSkills);
      expect(result.type).toBe('skill');
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toBe('');
    });

    it('detects per-skill shortcut for user-invocable skills', () => {
      const result = parseCommand('/humanizer make it natural', mockSkills);
      expect(result.type).toBe('skill');
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toBe('make it natural');
    });

    it('does not match non-user-invocable skills as shortcuts', () => {
      const result = parseCommand('/weather-guide check forecast', mockSkills);
      expect(result.type).toBeNull();
      expect(result.body).toBe('/weather-guide check forecast');
    });

    it('passes through unknown slash commands', () => {
      const result = parseCommand('/unknown-cmd do something', mockSkills);
      expect(result.type).toBeNull();
      expect(result.body).toBe('/unknown-cmd do something');
    });

    it('matches skill names case-insensitively', () => {
      const result = parseCommand('/HUMANIZER test', mockSkills);
      expect(result.type).toBe('skill');
      expect(result.skillName).toBe('humanizer');
    });

    it('matches skill names ignoring hyphens', () => {
      const result = parseCommand('/humanizer test', [
        { name: 'human-izer', description: 'test', userInvocable: true },
      ]);
      expect(result.type).toBe('skill');
      expect(result.skillName).toBe('human-izer');
    });
  });

  describe('detectSkillIntent', () => {
    it('returns null for empty skills list', () => {
      expect(detectSkillIntent('use humanizer', [])).toBeNull();
      expect(detectSkillIntent('use humanizer', null)).toBeNull();
    });

    it('detects "use <skill> skill" pattern', () => {
      const result = detectSkillIntent('use humanizer skill to rewrite', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toContain('rewrite');
    });

    it('detects "apply <skill>" pattern', () => {
      const result = detectSkillIntent('apply summarizer to this text', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('summarizer');
    });

    it('detects "with <skill>" pattern with trigger word', () => {
      const result = detectSkillIntent('with humanizer to rewrite this', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('humanizer');
    });

    it('detects "use /<skill>" slash-in-verb pattern', () => {
      const result = detectSkillIntent('use /humanizer and rewrite', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('humanizer');
    });

    it('detects "please use <skill> to" loose pattern', () => {
      const result = detectSkillIntent('please use humanizer to rewrite this', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toContain('rewrite this');
    });

    it('returns null for non-matching messages', () => {
      expect(detectSkillIntent('hello world', mockSkills)).toBeNull();
      expect(detectSkillIntent('I like coding', mockSkills)).toBeNull();
    });

    it('returns null for unknown skill names', () => {
      expect(detectSkillIntent('use unknown-skill to do things', mockSkills)).toBeNull();
    });

    it('matches skill names ignoring hyphens', () => {
      const result = detectSkillIntent('use weatherguide skill', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('weather-guide');
    });
  });

  describe('formatSkillsList', () => {
    it('returns no-skills message for empty list', () => {
      expect(formatSkillsList([])).toBe('No skills installed.');
    });

    it('formats eligible skills', () => {
      const result = formatSkillsList(mockSkills);
      expect(result).toContain('humanizer');
      expect(result).toContain('summarizer');
      // weather-guide is not user-invocable but is still listed if not disabled
      expect(result).toContain('Available skills');
    });

    it('excludes skills with disableModelInvocation', () => {
      const skills = [
        { name: 'alpha', description: 'Alpha skill', disableModelInvocation: true },
        { name: 'bravo', description: 'Bravo skill' },
      ];
      const result = formatSkillsList(skills);
      expect(result).not.toContain('alpha');
      expect(result).toContain('bravo');
    });

    it('includes slash commands when provided', () => {
      const cmds = [{ name: 'humanizer', description: 'Humanize text' }];
      const result = formatSkillsList(mockSkills, cmds);
      expect(result).toContain('Commands');
      expect(result).toContain('/humanizer');
    });
  });
});
