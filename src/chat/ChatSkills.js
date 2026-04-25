/**
 * @fileoverview Chat Skills Module - Handles skill detection and command parsing
 *
 * Responsibilities:
 * - Parse slash commands (/skills, /skill <name>, /<skill-name>)
 * - Detect natural language skill intents
 * - Format skill lists for display
 *
 * @module ChatSkills
 */

/**
 * Parse a potential slash command.
 * @param {string} message - Raw user input
 * @param {Array} availableSkills - List of available skills (from getSkills)
 * @returns {{ type: 'skills'|'skill'|null, skillName: string|null, body: string }}
 */
export function parseCommand(message, availableSkills) {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) {
    return { type: null, skillName: null, body: message };
  }

  // /skills
  if (trimmed === '/skills') {
    return { type: 'skills', skillName: null, body: '' };
  }

  const rest = trimmed.slice(1);
  const spaceIdx = rest.indexOf(' ');
  const cmd = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const body = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1);

  // /skill <name> [body] (OpenClaw-style canonical path)
  if (cmd === 'skill' && body) {
    const bodyParts = body.split(/\s+/);
    const skillName = bodyParts[0];
    const remaining = bodyParts.slice(1).join(' ');
    const foundSkill = availableSkills.find(
      (s) =>
        s.name.toLowerCase() === skillName.toLowerCase() ||
        s.name.toLowerCase().replace(/-/g, '') === skillName.toLowerCase().replace(/-/g, '')
    );
    if (foundSkill) {
      return { type: 'skill', skillName: foundSkill.name, body: remaining.trim() };
    }
    // Unknown skill name — pass through
    return { type: null, skillName: null, body: message };
  }

  // /<skill-name> [body] — per-skill command (alias, only for user-invocable skills)
  const foundSkill = availableSkills.find(
    (s) =>
      (s.name.toLowerCase() === cmd.toLowerCase() ||
        s.name.toLowerCase().replace(/-/g, '') === cmd.toLowerCase().replace(/-/g, '')) &&
      s.userInvocable !== false
  );

  if (foundSkill) {
    return { type: 'skill', skillName: foundSkill.name, body: body.trim() };
  }

  // Unknown slash command — pass through as normal message
  return { type: null, skillName: null, body: message };
}

/**
 * Detects if user wants to use a specific skill.
 * Patterns: "use <skill> skill", "apply <skill>", "with <skill>", "use /<skill>", etc.
 * @param {string} message - User message
 * @param {Array} availableSkills - List of available skills
 * @returns {{ skillName: string, body: string }|null} - Skill payload if detected, null otherwise
 */
export function detectSkillIntent(message, availableSkills) {
  if (!availableSkills || availableSkills.length === 0) return null;

  const trimSkillBody = (body) => {
    let cleaned = (body || '').trim();
    cleaned = cleaned.replace(/^[,:;-]+\s*/, '');
    cleaned = cleaned.replace(/^(?:and|to|for|on|then|in)\b[\s,:;-]*/i, '');
    return cleaned.trim();
  };

  // Pattern: "use /skillname ...", "apply skillname skill ...", "use /skillname and ..."
  // The trailing "skill" is optional. The leading "/" is optional.
  const skillPatterns = [
    /(?:use|apply|with|invoke|using|applying)\s+\/?(\w[\w-]*)\s+skill/i,
    /(?:use|apply|with|invoke|using|applying)\s+\/(\w[\w-]*)/i,
  ];

  for (const pattern of skillPatterns) {
    const match = message.match(pattern);
    if (match) {
      const requestedSkill = match[1].toLowerCase();
      const remainder = message.slice((match.index || 0) + match[0].length);
      // Check if requested skill exists in available skills
      const foundSkill = availableSkills.find(
        (s) =>
          s.name.toLowerCase() === requestedSkill ||
          s.name.toLowerCase().replace(/-/g, '') === requestedSkill.replace(/-/g, '')
      );
      if (foundSkill) {
        console.log(`Chat: Detected skill intent for '${foundSkill.name}'`);
        return {
          skillName: foundSkill.name,
          body: trimSkillBody(remainder),
        };
      }
    }
  }

  // Also detect any /skillname embedded in text after an intent verb
  // e.g. "use /humanizer and rewrite", "apply /summarizer to this"
  const verbSlashPattern = /(?:use|apply|with|invoke|using|applying)\s+\/(\w[\w-]*)/i;
  const slashMatch = message.match(verbSlashPattern);
  if (slashMatch) {
    const requestedSkill = slashMatch[1].toLowerCase();
    const remainder = message.slice((slashMatch.index || 0) + slashMatch[0].length);
    const foundSkill = availableSkills.find(
      (s) =>
        s.name.toLowerCase() === requestedSkill ||
        s.name.toLowerCase().replace(/-/g, '') === requestedSkill.replace(/-/g, '')
    );
    if (foundSkill) {
      console.log(`Chat: Detected slash-in-verb intent for '${foundSkill.name}'`);
      return {
        skillName: foundSkill.name,
        body: trimSkillBody(remainder),
      };
    }
  }

  // Also check for skill names mentioned anywhere after "use" or "apply"
  // Handles: "please use humanizer to rewrite", "use the summarizer on this"
  const loosePatterns = [
    /(?:use|apply|with|invoke)\s+(?:the\s+)?(\w[\w-]*)\s+(?:to|for|on|and|then|in)\s+(.*)$/i,
  ];

  for (const pattern of loosePatterns) {
    const match = message.match(pattern);
    if (match) {
      const requestedSkill = match[1].toLowerCase();
      const remainder = match[2] || '';
      const foundSkill = availableSkills.find(
        (s) =>
          s.name.toLowerCase() === requestedSkill ||
          s.name.toLowerCase().replace(/-/g, '') === requestedSkill.replace(/-/g, '')
      );
      if (foundSkill) {
        console.log(`Chat: Detected loose skill intent for '${foundSkill.name}'`);
        return {
          skillName: foundSkill.name,
          body: trimSkillBody(remainder),
        };
      }
    }
  }

  return null;
}

/**
 * Format the list of available skills for display
 * @param {Array} availableSkills - List of available skills
 * @param {Array} slashCommands - List of slash commands
 * @returns {string} - Formatted skill list message
 */
export function formatSkillsList(availableSkills, slashCommands = []) {
  const eligibleSkills = availableSkills.filter((s) => !s.disableModelInvocation);
  if (eligibleSkills.length === 0) {
    return 'No skills installed.';
  }

  const list = eligibleSkills.map((s) => `- **${s.name}**: ${s.description}`).join('\n');
  let cmdList = '';

  if (slashCommands.length > 0) {
    cmdList =
      '\n\n**Commands:**\n' +
      slashCommands.map((c) => `- \`/${c.name}\` — ${c.description}`).join('\n');
    cmdList += '\n- `/skill <name> [input]` — invoke any skill by name';
  }

  return `📚 Available skills:\n${list}${cmdList}`;
}
