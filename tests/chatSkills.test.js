import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  detectSkillIntent,
  resolveSkillName,
  formatSkillsList,
  buildSlashCandidates,
  filterSlashCandidates,
} from '../src/chat/ChatSkills.js';

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

    it('fuzzy matches /skill command with British spelling', () => {
      const result = parseCommand('/skill humaniser rewrite this', mockSkills);
      expect(result.type).toBe('skill');
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toBe('rewrite this');
    });

    it('fuzzy matches /<name> shortcut with typos', () => {
      const result = parseCommand('/humanizr rewrite this', mockSkills);
      expect(result.type).toBe('skill');
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toBe('rewrite this');
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

    it('fuzzy matches British s→z spelling (humaniser → humanizer)', () => {
      const result = detectSkillIntent('use humaniser skill to rewrite', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toContain('rewrite');
    });

    it('does not fuzzy match via loose pattern (exact match only)', () => {
      const result = detectSkillIntent('please use summarise to condense this', mockSkills);
      expect(result).toBeNull();
    });

    it('does not match ordinary sentences with "to" and "with" keywords', () => {
      const result = detectSkillIntent(
        'Turn this page into a concise research brief with next steps.',
        mockSkills
      );
      expect(result).toBeNull();
    });

    it('still matches exact skill name via loose pattern', () => {
      const result = detectSkillIntent('please use humanizer to rewrite this', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toContain('rewrite this');
    });

    it('fuzzy matches humanizr (dropped letter) via slash-in-verb', () => {
      const result = detectSkillIntent('use /humanizr and rewrite this', mockSkills);
      expect(result).not.toBeNull();
      expect(result.skillName).toBe('humanizer');
      expect(result.body).toContain('rewrite this');
    });
  });

  describe('resolveSkillName', () => {
    it('returns null for empty query or skills', () => {
      expect(resolveSkillName('', mockSkills)).toBeNull();
      expect(resolveSkillName('humanizer', [])).toBeNull();
      expect(resolveSkillName('humanizer', null)).toBeNull();
    });

    it('returns exact match by name', () => {
      const result = resolveSkillName('humanizer', mockSkills);
      expect(result).not.toBeNull();
      expect(result.name).toBe('humanizer');
    });

    it('matches case-insensitively', () => {
      const result = resolveSkillName('HUMANIZER', mockSkills);
      expect(result).not.toBeNull();
      expect(result.name).toBe('humanizer');
    });

    it('matches hyphen-insensitively', () => {
      const result = resolveSkillName('weatherguide', mockSkills);
      expect(result).not.toBeNull();
      expect(result.name).toBe('weather-guide');
    });

    it('fuzzy matches British s→z spelling (humaniser → humanizer)', () => {
      const result = resolveSkillName('humaniser', mockSkills);
      expect(result).not.toBeNull();
      expect(result.name).toBe('humanizer');
    });

    it('fuzzy matches summarise → summarizer', () => {
      const result = resolveSkillName('summarise', mockSkills);
      expect(result).not.toBeNull();
      expect(result.name).toBe('summarizer');
    });

    it('fuzzy matches single-character typos', () => {
      const result = resolveSkillName('humanizr', mockSkills);
      expect(result).not.toBeNull();
      expect(result.name).toBe('humanizer');
    });

    it('returns null for completely unrelated names', () => {
      expect(resolveSkillName('editor', mockSkills)).toBeNull();
      expect(resolveSkillName('translate', mockSkills)).toBeNull();
    });

    it('returns null for names too distant to fuzzy match', () => {
      expect(resolveSkillName('summer', mockSkills)).toBeNull();
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

  describe('buildSlashCandidates', () => {
    it('always includes /skills as the first builtin candidate', () => {
      const result = buildSlashCandidates([], []);
      expect(result[0]).toEqual({
        name: 'skills',
        label: '/skills',
        description: 'List available skills',
        kind: 'builtin',
      });
    });

    it('uses slashCommands when provided', () => {
      const cmds = [{ name: 'humanizer', description: 'Humanize text' }];
      const result = buildSlashCandidates(mockSkills, cmds);
      expect(result).toHaveLength(2);
      expect(result[1].name).toBe('humanizer');
      expect(result[1].label).toBe('/humanizer');
    });

    it('falls back to availableSkills filtered by userInvocable', () => {
      const result = buildSlashCandidates(mockSkills, []);
      const names = result.slice(1).map((c) => c.name);
      expect(names).toContain('humanizer');
      expect(names).toContain('summarizer');
      expect(names).not.toContain('weather-guide');
    });

    it('skips duplicate "skills" entry from slashCommands', () => {
      const cmds = [
        { name: 'skills', description: 'List' },
        { name: 'humanizer', description: 'Humanize' },
      ];
      const result = buildSlashCandidates(mockSkills, cmds);
      const skillEntries = result.filter((c) => c.name === 'skills');
      expect(skillEntries).toHaveLength(1);
    });
  });

  describe('filterSlashCandidates', () => {
    const candidates = [
      { name: 'skills', label: '/skills', description: 'List', kind: 'builtin' },
      { name: 'humanizer', label: '/humanizer', description: 'Humanize', kind: 'skill' },
      { name: 'summarizer', label: '/summarizer', description: 'Summarize', kind: 'skill' },
    ];

    it('returns all candidates for empty query', () => {
      expect(filterSlashCandidates('', candidates)).toEqual(candidates);
    });

    it('filters by prefix match', () => {
      const result = filterSlashCandidates('hum', candidates);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('humanizer');
    });

    it('filters case-insensitively', () => {
      const result = filterSlashCandidates('HUM', candidates);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('humanizer');
    });

    it('filters hyphen-insensitively', () => {
      const hyphenCandidates = [
        { name: 'weather-guide', label: '/weather-guide', description: 'Weather', kind: 'skill' },
      ];
      const result = filterSlashCandidates('weatherguide', hyphenCandidates);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('weather-guide');
    });

    it('ranks prefix matches before substring matches', () => {
      const mixedCandidates = [
        { name: 'skills', label: '/skills', description: 'List', kind: 'builtin' },
        { name: 'humanizer', label: '/humanizer', description: 'Humanize', kind: 'skill' },
        { name: 'summarizer', label: '/summarizer', description: 'Summarize', kind: 'skill' },
        { name: 'some-humility', label: '/some-humility', description: 'Other', kind: 'skill' },
      ];
      const result = filterSlashCandidates('hum', mixedCandidates);
      expect(result[0].name).toBe('humanizer');
      expect(result[1].name).toBe('some-humility');
    });

    it('returns empty array for no matches', () => {
      const result = filterSlashCandidates('zzz', candidates);
      expect(result).toHaveLength(0);
    });
  });
});
