/**
 * @fileoverview SKILL.md Parser - Agent Skills specification aligned
 *
 * Implements parsing, normalization, and validation for Agent Skills
 * frontmatter used by Prompt Paul.
 *
 * @module skillParser
 */

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;
export const MAX_SKILL_MARKDOWN_CHARS = 100_000;

/**
 * Parses SKILL.md frontmatter and body according to Agent Skills conventions.
 * @param {string} markdown - Full SKILL.md content
 * @param {Object} [options] - Parse options
 * @param {string} [options.expectedDirectoryName] - Optional expected parent directory name
 * @returns {Object} Parsed skill with metadata and instructions
 */
export function parseSkillMarkdown(markdown, options = {}) {
  if (!markdown || typeof markdown !== 'string') {
    return {
      valid: false,
      error: 'Empty or invalid markdown content',
      metadata: null,
      instructions: null,
    };
  }
  if (markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    return {
      valid: false,
      error: `SKILL.md exceeds ${MAX_SKILL_MARKDOWN_CHARS} characters`,
      metadata: null,
      instructions: null,
    };
  }

  const normalized = normalizeLineEndings(markdown).replace(/^\uFEFF/, '');
  const frontmatterParts = extractFrontmatter(normalized);

  if (!frontmatterParts.hasFrontmatter) {
    return {
      valid: false,
      error: 'SKILL.md requires YAML frontmatter',
      metadata: null,
      instructions: null,
    };
  }

  if (!frontmatterParts.valid) {
    return {
      valid: false,
      error: frontmatterParts.error,
      metadata: null,
      instructions: null,
    };
  }

  let metadata;
  try {
    metadata = parseFrontmatter(frontmatterParts.frontmatterText);
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      metadata: null,
      instructions: null,
    };
  }

  const normalizedMetadata = normalizeMetadataForValidation(metadata);
  const validation = validateMetadata(normalizedMetadata, {
    expectedDirectoryName: options.expectedDirectoryName,
  });

  if (!validation.valid) {
    return {
      valid: false,
      error: validation.error,
      metadata: null,
      instructions: null,
    };
  }

  return {
    valid: true,
    metadata: validation.metadata,
    instructions: frontmatterParts.body,
    raw: markdown,
  };
}

/**
 * Extracts YAML frontmatter from markdown content.
 * @param {string} markdown - Full markdown content
 * @returns {{hasFrontmatter:boolean, valid:boolean, error?:string, frontmatterText?:string, body?:string}}
 */
function extractFrontmatter(markdown) {
  const lines = markdown.split('\n');
  if (lines.length === 0) {
    return { hasFrontmatter: false, valid: true };
  }

  if (lines[0].trim() !== '---') {
    return { hasFrontmatter: false, valid: true };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return {
      hasFrontmatter: true,
      valid: false,
      error: 'Invalid frontmatter: missing closing ---',
    };
  }

  const frontmatterText = lines.slice(1, closingIndex).join('\n');
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .trim();
  return {
    hasFrontmatter: true,
    valid: true,
    frontmatterText,
    body,
  };
}

/**
 * Parses frontmatter with a lightweight YAML subset parser.
 * Supports top-level scalars, inline arrays, block arrays, and metadata maps.
 * @param {string} text - YAML frontmatter content without delimiters
 * @returns {Object} Parsed frontmatter object
 */
export function parseFrontmatter(text) {
  const result = {};
  const lines = normalizeLineEndings(text).split('\n');

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      index += 1;
      continue;
    }

    if (countIndent(rawLine) !== 0) {
      throw new Error(`Invalid frontmatter at line ${index + 1}: unexpected indentation`);
    }

    const fieldMatch = rawLine.match(/^([A-Za-z0-9][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!fieldMatch) {
      throw new Error(`Invalid frontmatter at line ${index + 1}: expected 'key: value'`);
    }

    const key = fieldMatch[1];
    const rawValue = typeof fieldMatch[2] === 'string' ? fieldMatch[2] : '';

    if (rawValue === '') {
      const nested = readIndentedBlock(lines, index + 1);

      if (key === 'metadata') {
        // Try to parse the indented block as inline JSON (OpenClaw-style)
        const jsonAttempt = tryParseMetadataJson(nested.lines);
        if (jsonAttempt !== null) {
          result[key] = jsonAttempt;
          index = nested.nextIndex;
          continue;
        }
        // Fallback to flat key-value parsing
        result[key] = parseMetadataBlock(nested.lines, index + 1);
      } else if (
        nested.lines.length > 0 &&
        nested.lines.every((line) => line.trim().startsWith('- '))
      ) {
        result[key] = nested.lines.map((line) => parseScalar(line.trim().slice(2)));
      } else if (nested.lines.length > 0) {
        result[key] = nested.lines
          .map((line) => line.trim())
          .join('\n')
          .trim();
      } else {
        result[key] = '';
      }

      index = nested.nextIndex;
      continue;
    }

    result[key] = parseValue(rawValue);
    index += 1;
  }

  return result;
}

/**
 * Validates skill metadata for Agent Skills compatibility.
 * @param {Object} metadata - Parsed metadata
 * @param {Object} [options] - Validation options
 * @param {string} [options.expectedDirectoryName] - Optional expected parent directory name
 * @returns {{valid: boolean, error?: string, metadata?: Object}}
 */
export function validateMetadata(metadata, options = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { valid: false, error: 'Frontmatter must be a YAML mapping' };
  }

  const normalized = { ...metadata };
  // Pass through unknown fields for forward-compatibility (e.g. OpenClaw extensions)

  if (typeof normalized.name !== 'string' || normalized.name.trim() === '') {
    return { valid: false, error: 'Missing required field: name' };
  }

  const normalizedName = normalized.name.normalize('NFKC').trim();
  if (normalizedName.length > MAX_NAME_LENGTH) {
    return { valid: false, error: `Skill name exceeds ${MAX_NAME_LENGTH} characters` };
  }
  if (normalizedName !== normalizedName.toLocaleLowerCase()) {
    return { valid: false, error: 'Skill name must be lowercase' };
  }
  if (normalizedName.startsWith('-') || normalizedName.endsWith('-')) {
    return { valid: false, error: 'Skill name must not start or end with a hyphen' };
  }
  if (normalizedName.includes('--')) {
    return { valid: false, error: 'Skill name must not contain consecutive hyphens' };
  }
  if (!/^[\p{Ll}\p{Nd}-]+$/u.test(normalizedName)) {
    return { valid: false, error: 'Skill name contains invalid characters' };
  }

  if (typeof normalized.description !== 'string' || normalized.description.trim() === '') {
    return { valid: false, error: 'Missing required field: description' };
  }
  const normalizedDescription = normalized.description.trim();
  if (normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
    return {
      valid: false,
      error: `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters`,
    };
  }

  if (normalized.license !== undefined) {
    if (typeof normalized.license !== 'string' || normalized.license.trim() === '') {
      return { valid: false, error: "Field 'license' must be a non-empty string" };
    }
    normalized.license = normalized.license.trim();
  }

  if (normalized.compatibility !== undefined) {
    if (typeof normalized.compatibility !== 'string') {
      return { valid: false, error: "Field 'compatibility' must be a string" };
    }
    const compatibility = normalized.compatibility.trim();
    if (compatibility.length === 0 || compatibility.length > MAX_COMPATIBILITY_LENGTH) {
      return {
        valid: false,
        error: `Field 'compatibility' must be 1-${MAX_COMPATIBILITY_LENGTH} characters`,
      };
    }
    normalized.compatibility = compatibility;
  }

  if (normalized['allowed-tools'] !== undefined) {
    if (
      typeof normalized['allowed-tools'] !== 'string' ||
      normalized['allowed-tools'].trim() === ''
    ) {
      return { valid: false, error: "Field 'allowed-tools' must be a non-empty string" };
    }
    normalized['allowed-tools'] = normalized['allowed-tools'].trim();
  }

  if (normalized.metadata !== undefined) {
    if (
      !normalized.metadata ||
      typeof normalized.metadata !== 'object' ||
      Array.isArray(normalized.metadata)
    ) {
      return { valid: false, error: "Field 'metadata' must be a key-value mapping" };
    }

    const metadataMap = {};
    for (const [key, value] of Object.entries(normalized.metadata)) {
      const metadataKey = String(key).trim();
      if (!metadataKey) {
        return { valid: false, error: "Field 'metadata' contains an empty key" };
      }
      // Preserve nested objects/arrays (OpenClaw-style metadata.openclaw.*)
      // Only stringify scalars
      if (value !== null && typeof value === 'object') {
        metadataMap[metadataKey] = value;
      } else {
        metadataMap[metadataKey] = String(value ?? '');
      }
    }
    normalized.metadata = metadataMap;
  }

  // Validate OpenClaw-style boolean fields
  for (const boolField of ['user-invocable', 'disable-model-invocation']) {
    if (normalized[boolField] !== undefined) {
      if (typeof normalized[boolField] !== 'boolean') {
        return { valid: false, error: `Field '${boolField}' must be a boolean` };
      }
    }
  }

  // Validate OpenClaw-style string fields
  for (const strField of ['command-dispatch', 'command-tool', 'command-arg-mode', 'homepage']) {
    if (normalized[strField] !== undefined) {
      if (typeof normalized[strField] !== 'string' || normalized[strField].trim() === '') {
        return { valid: false, error: `Field '${strField}' must be a non-empty string` };
      }
      normalized[strField] = normalized[strField].trim();
    }
  }

  // Validate command-dispatch enum
  if (normalized['command-dispatch'] !== undefined) {
    const allowed = ['tool'];
    if (!allowed.includes(normalized['command-dispatch'])) {
      return {
        valid: false,
        error: `Field 'command-dispatch' must be one of: ${allowed.join(', ')}`,
      };
    }
  }

  if (
    typeof options.expectedDirectoryName === 'string' &&
    options.expectedDirectoryName.trim() !== ''
  ) {
    const expected = options.expectedDirectoryName.normalize('NFKC').trim();
    if (expected !== normalizedName) {
      return {
        valid: false,
        error: `Skill name '${normalizedName}' must match directory '${expected}'`,
      };
    }
  }

  const resultMetadata = {
    name: normalizedName,
    description: normalizedDescription,
    ...(normalized.license !== undefined ? { license: normalized.license } : {}),
    ...(normalized.compatibility !== undefined ? { compatibility: normalized.compatibility } : {}),
    ...(normalized['allowed-tools'] !== undefined
      ? { 'allowed-tools': normalized['allowed-tools'] }
      : {}),
    ...(normalized.metadata !== undefined ? { metadata: normalized.metadata } : {}),
    // OpenClaw-style fields
    ...(normalized['user-invocable'] !== undefined
      ? { 'user-invocable': normalized['user-invocable'] }
      : {}),
    ...(normalized['disable-model-invocation'] !== undefined
      ? { 'disable-model-invocation': normalized['disable-model-invocation'] }
      : {}),
    ...(normalized['command-dispatch'] !== undefined
      ? { 'command-dispatch': normalized['command-dispatch'] }
      : {}),
    ...(normalized['command-tool'] !== undefined
      ? { 'command-tool': normalized['command-tool'] }
      : {}),
    ...(normalized['command-arg-mode'] !== undefined
      ? { 'command-arg-mode': normalized['command-arg-mode'] }
      : {}),
    ...(normalized.homepage !== undefined ? { homepage: normalized.homepage } : {}),
  };

  // Pass through any other unknown fields for forward-compatibility
  const knownKeys = new Set([
    'name',
    'description',
    'license',
    'compatibility',
    'allowed-tools',
    'metadata',
    'user-invocable',
    'disable-model-invocation',
    'command-dispatch',
    'command-tool',
    'command-arg-mode',
    'homepage',
  ]);
  for (const [key, value] of Object.entries(normalized)) {
    if (!knownKeys.has(key)) {
      resultMetadata[key] = value;
    }
  }

  return {
    valid: true,
    metadata: resultMetadata,
  };
}

/**
 * Generates canonical SKILL.md from components.
 * @param {Object} skill - Skill data
 * @param {string} skill.name - Skill name
 * @param {string} skill.description - Skill description
 * @param {string} skill.instructions - Markdown instructions body
 * @param {Object} [skill.options] - Optional metadata
 * @returns {string} Canonical SKILL.md content
 */
export function generateSkillMarkdown({ name, description, instructions, options = {} }) {
  const frontmatterLines = [
    '---',
    `name: ${formatYamlString(name || '')}`,
    `description: ${formatYamlString(description || '')}`,
  ];

  if (typeof options.license === 'string' && options.license.trim() !== '') {
    frontmatterLines.push(`license: ${formatYamlString(options.license.trim())}`);
  }

  if (typeof options.compatibility === 'string' && options.compatibility.trim() !== '') {
    frontmatterLines.push(`compatibility: ${formatYamlString(options.compatibility.trim())}`);
  }

  const allowedTools = options['allowed-tools'];
  if (typeof allowedTools === 'string' && allowedTools.trim() !== '') {
    frontmatterLines.push(`allowed-tools: ${formatYamlString(allowedTools.trim())}`);
  }

  // OpenClaw-style fields
  for (const [fmKey, optKey] of [
    ['user-invocable', 'userInvocable'],
    ['disable-model-invocation', 'disableModelInvocation'],
    ['command-dispatch', 'commandDispatch'],
    ['command-tool', 'commandTool'],
    ['command-arg-mode', 'commandArgMode'],
    ['homepage', 'homepage'],
  ]) {
    const val = options[optKey] ?? options[fmKey];
    if (val !== undefined && val !== null && val !== '') {
      if (typeof val === 'boolean') {
        frontmatterLines.push(`${fmKey}: ${val}`);
      } else {
        frontmatterLines.push(`${fmKey}: ${formatYamlString(String(val))}`);
      }
    }
  }

  const metadata = options.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    Object.keys(metadata).length > 0
  ) {
    frontmatterLines.push('metadata:');
    const sortedEntries = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of sortedEntries) {
      const safeKey = String(key).trim();
      if (!safeKey) {
        continue;
      }
      // Serialize nested objects as inline JSON (OpenClaw-style)
      if (value !== null && typeof value === 'object') {
        frontmatterLines.push(`  ${safeKey}: ${JSON.stringify(value)}`);
      } else {
        frontmatterLines.push(`  ${safeKey}: ${formatYamlString(String(value ?? ''))}`);
      }
    }
  }

  frontmatterLines.push('---');

  const body = typeof instructions === 'string' ? instructions.trim() : '';
  if (!body) {
    return `${frontmatterLines.join('\n')}\n`;
  }

  return `${frontmatterLines.join('\n')}\n\n${body}\n`;
}

/**
 * Extracts skill metadata for listing (progressive disclosure).
 * @param {Object} parsedSkill - Result from parseSkillMarkdown
 * @returns {Object|null} Metadata for skill discovery
 */
export function extractSkillMetadata(parsedSkill) {
  if (!parsedSkill || !parsedSkill.valid) {
    return null;
  }

  const m = parsedSkill.metadata;
  return {
    name: m.name,
    description: m.description,
    ...(m.license ? { license: m.license } : {}),
    ...(m.compatibility ? { compatibility: m.compatibility } : {}),
    ...(m['allowed-tools'] ? { 'allowed-tools': m['allowed-tools'] } : {}),
    ...(m.metadata ? { metadata: m.metadata } : {}),
    // OpenClaw-style fields
    ...(m['user-invocable'] !== undefined ? { 'user-invocable': m['user-invocable'] } : {}),
    ...(m['disable-model-invocation'] !== undefined
      ? { 'disable-model-invocation': m['disable-model-invocation'] }
      : {}),
    ...(m['command-dispatch'] ? { 'command-dispatch': m['command-dispatch'] } : {}),
    ...(m['command-tool'] ? { 'command-tool': m['command-tool'] } : {}),
    ...(m['command-arg-mode'] ? { 'command-arg-mode': m['command-arg-mode'] } : {}),
    ...(m.homepage ? { homepage: m.homepage } : {}),
  };
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeMetadataForValidation(metadata) {
  const normalized = { ...metadata };

  // Normalize OpenClaw boolean fields from YAML strings to actual booleans
  for (const boolField of ['user-invocable', 'disable-model-invocation']) {
    if (normalized[boolField] !== undefined && typeof normalized[boolField] === 'string') {
      const v = normalized[boolField].trim().toLowerCase();
      if (v === 'true') normalized[boolField] = true;
      else if (v === 'false') normalized[boolField] = false;
    }
  }

  const metadataMap =
    normalized.metadata &&
    typeof normalized.metadata === 'object' &&
    !Array.isArray(normalized.metadata)
      ? { ...normalized.metadata }
      : {};

  if (Object.keys(metadataMap).length > 0) {
    normalized.metadata = metadataMap;
  }

  if (Array.isArray(normalized['allowed-tools'])) {
    normalized['allowed-tools'] = normalized['allowed-tools'].join(' ').trim();
  }

  return normalized;
}

function parseValue(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseInlineArray(trimmed);
  }
  // Try JSON parsing for inline objects (OpenClaw-style metadata: { ... })
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      // Single-quoted JSON is not valid JSON; try replacing quotes
      try {
        const normalized = trimmed.replace(/'/g, '"');
        return JSON.parse(normalized);
      } catch (_2) {
        // Not parseable, fall through
      }
    }
  }
  return parseScalar(trimmed);
}

function parseInlineArray(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  const items = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of inner) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      current += char;
      continue;
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }

    if (quote && char === quote) {
      quote = null;
      current += char;
      continue;
    }

    if (!quote && char === ',') {
      items.push(parseScalar(current));
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim() !== '') {
    items.push(parseScalar(current));
  }

  return items;
}

function parseScalar(rawValue) {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0];
    let value = trimmed.slice(1, -1);
    if (quote === '"') {
      value = value
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    } else {
      value = value.replace(/''/g, "'");
    }
    return value;
  }

  return trimmed;
}

/**
 * Try to parse an indented metadata block as inline JSON.
 * Returns the parsed object if successful, or null if not JSON.
 * @param {string[]} lines - Indented lines (leading spaces stripped)
 * @returns {Object|null}
 */
function tryParseMetadataJson(lines) {
  if (!lines || lines.length === 0) return null;

  const joined = lines.join('\n').trim();
  if (!joined.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(joined);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_) {
    // not valid JSON
  }
  return null;
}

function parseMetadataBlock(lines, baseLineNumber) {
  const metadata = {};

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([^:#][^:]*):\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid metadata entry at line ${baseLineNumber + i + 1}`);
    }

    const key = match[1];
    const rawVal = match[2];

    // Try parsing value as JSON first (for nested objects/arrays)
    if (rawVal && (rawVal.trim().startsWith('{') || rawVal.trim().startsWith('['))) {
      try {
        metadata[key] = JSON.parse(rawVal.trim());
        continue;
      } catch (_) {
        // not JSON, fall through to scalar parsing
      }
    }

    metadata[key] = parseScalar(rawVal);
  }

  return metadata;
}

function readIndentedBlock(lines, startIndex) {
  const collected = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      collected.push(line);
      index += 1;
      continue;
    }

    if (countIndent(line) < 2) {
      break;
    }

    collected.push(line.slice(2));
    index += 1;
  }

  return {
    lines: collected,
    nextIndex: index,
  };
}

function countIndent(line) {
  let count = 0;
  while (count < line.length && line[count] === ' ') {
    count += 1;
  }
  return count;
}

function formatYamlString(value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
