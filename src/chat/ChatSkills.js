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
 * Compute Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const an = a.length;
  const bn = b.length;
  const matrix = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;
  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      matrix[i][j] =
        a[j - 1] === b[i - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[bn][an];
}

/**
 * Normalize a skill name for matching: lowercase, strip non-alphanumeric (keep hyphens).
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/**
 * Resolve a user-provided skill query against the available skills list.
 * Tries exact match first (normalized), then falls back to edit-distance matching
 * (Levenshtein ≤1, or ≤2 for names ≥6 chars) to catch typos like humaniser→humanizer.
 * @param {string} query - User-provided name
 * @param {Array} availableSkills - List of available skills
 * @returns {Object|null} - The matching skill object, or null
 */
export function resolveSkillName(query, availableSkills) {
  if (!query || !availableSkills || availableSkills.length === 0) return null;
  const q = normalizeName(query);

  // Exact (normalized) match
  const exact = availableSkills.find(
    (s) =>
      normalizeName(s.name) === q || normalizeName(s.name).replace(/-/g, '') === q.replace(/-/g, '')
  );
  if (exact) return exact;

  // Fuzzy edit-distance match
  const threshold = q.length >= 6 ? 2 : 1;
  let best = null;
  let bestDist = Infinity;
  for (const s of availableSkills) {
    const sn = normalizeName(s.name);
    const dist = levenshtein(q, sn);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      best = s;
    }
    // Also try without hyphens
    const snFlat = sn.replace(/-/g, '');
    const qFlat = q.replace(/-/g, '');
    if (snFlat !== sn) {
      const distFlat = levenshtein(qFlat, snFlat);
      if (distFlat <= threshold && distFlat < bestDist) {
        bestDist = distFlat;
        best = s;
      }
    }
  }
  return best;
}

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
    const foundSkill = resolveSkillName(skillName, availableSkills);
    if (foundSkill) {
      return { type: 'skill', skillName: foundSkill.name, body: remaining.trim() };
    }
    // Unknown skill name — pass through
    return { type: null, skillName: null, body: message };
  }

  // /<skill-name> [body] — per-skill command (alias, only for user-invocable skills)
  const foundSkill = resolveSkillName(cmd, availableSkills);
  if (foundSkill && foundSkill.userInvocable !== false) {
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
      const foundSkill = resolveSkillName(requestedSkill, availableSkills);
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
    const foundSkill = resolveSkillName(requestedSkill, availableSkills);
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
  // NOTE: Loose patterns use exact-name match only (no fuzzy Levenshtein) to
  // prevent ordinary sentences like "Turn this into a brief with next steps"
  // from hijacking the run via accidental skill-name proximity.
  const loosePatterns = [
    /(?:use|apply|with|invoke)\s+(?:the\s+)?(\w[\w-]*)\s+(?:to|for|on|and|then|in)\s+(.*)$/i,
  ];

  for (const pattern of loosePatterns) {
    const match = message.match(pattern);
    if (match) {
      const requestedSkill = match[1].toLowerCase();
      const remainder = match[2] || '';
      const q = normalizeName(requestedSkill);
      const foundSkill =
        availableSkills.find(
          (s) =>
            normalizeName(s.name) === q ||
            normalizeName(s.name).replace(/-/g, '') === q.replace(/-/g, '')
        ) || null;
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
 * Build a list of slash-command candidates for the typeahead picker.
 * @param {Array} availableSkills - Skills from getSkills response
 * @param {Array} slashCommands - Slash commands from getSkills response
 * @returns {Array<{name: string, label: string, description: string, kind: 'builtin'|'skill'}>}
 */
export function buildSlashCandidates(availableSkills, slashCommands) {
  const candidates = [
    { name: 'skills', label: '/skills', description: 'List available skills', kind: 'builtin' },
  ];

  const cmds =
    slashCommands && slashCommands.length > 0
      ? slashCommands
      : (availableSkills || []).filter((s) => s.userInvocable !== false);

  for (const cmd of cmds) {
    if (cmd.name === 'skills') continue;
    candidates.push({
      name: cmd.name,
      label: `/${cmd.name}`,
      description: cmd.description || '',
      kind: 'skill',
    });
  }

  return candidates;
}

/**
 * Filter slash-command candidates by a query prefix (case-insensitive, hyphen-insensitive).
 * Prefix matches rank before substring matches.
 * @param {string} query - The typed text after the leading "/"
 * @param {Array} candidates - Candidate list from buildSlashCandidates
 * @returns {Array} Filtered and ranked candidates
 */
export function filterSlashCandidates(query, candidates) {
  if (!query) return candidates;

  const q = query.toLowerCase().replace(/-/g, '');

  const prefixMatches = [];
  const substringMatches = [];

  for (const c of candidates) {
    const name = c.name.toLowerCase().replace(/-/g, '');
    if (name.startsWith(q)) {
      prefixMatches.push(c);
    } else if (name.includes(q)) {
      substringMatches.push(c);
    }
  }

  return [...prefixMatches, ...substringMatches];
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
