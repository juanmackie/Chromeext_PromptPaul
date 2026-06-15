const STORAGE_KEY = 'customSiteSuggestions';
const MAX_SUGGESTIONS = 60;
const MAX_COMMAND_LENGTH = 80;
const MAX_PROMPT_LENGTH = 280;
const MAX_LABEL_LENGTH = 80;

export async function getAllSuggestions() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeSuggestions(result[STORAGE_KEY] || []);
  } catch {
    return [];
  }
}

export async function getSuggestionsForSite(siteKey) {
  if (!siteKey) return [];
  const all = await getAllSuggestions();
  return all.filter((s) => s.siteKey === siteKey);
}

export async function addSuggestion(siteKey, siteLabel, command, prompt) {
  const all = await getAllSuggestions();
  const normalizedSiteKey =
    extractSiteKey(siteKey) ||
    String(siteKey || '')
      .trim()
      .toLowerCase();
  const normalizedPrompt = normalizePrompt(prompt);
  const normalizedCommand = normalizeCommand(command);
  if (!normalizedSiteKey || !normalizedPrompt || !normalizedCommand) {
    throw new Error('Suggestion requires site, command, and prompt.');
  }

  const now = Date.now();
  const newEntry = {
    id: createSuggestionId(normalizedSiteKey, normalizedPrompt, now),
    siteKey: normalizedSiteKey,
    siteLabel: normalizeSiteLabel(siteLabel, normalizedSiteKey),
    command: normalizedCommand,
    prompt: normalizedPrompt,
    createdAt: now,
  };
  const updated = normalizeSuggestions([
    newEntry,
    ...all.filter((item) => item.siteKey !== newEntry.siteKey || item.prompt !== newEntry.prompt),
  ]);
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return newEntry;
}

export async function removeSuggestion(id) {
  const all = await getAllSuggestions();
  const updated = all.filter((s) => s.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

export function extractSiteKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function normalizeSuggestions(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of arr) {
    const suggestion = normalizeSuggestion(item);
    if (!suggestion) continue;
    const dedupeKey = `${suggestion.siteKey}\n${suggestion.prompt}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(suggestion);
  }

  return normalized.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SUGGESTIONS);
}

function normalizeSuggestion(value) {
  if (!value || typeof value !== 'object') return null;
  const siteKey = extractSiteKey(String(value.siteKey || ''));
  const command = normalizeCommand(value.command);
  const prompt = normalizePrompt(value.prompt);
  if (!siteKey || !command || !prompt) return null;
  const createdAt = Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now();
  return {
    id: normalizeSuggestionId(value.id) || createSuggestionId(siteKey, prompt, createdAt),
    siteKey,
    siteLabel: normalizeSiteLabel(value.siteLabel, siteKey),
    command,
    prompt,
    createdAt,
  };
}

function normalizeCommand(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_COMMAND_LENGTH);
}

function normalizePrompt(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);
}

function normalizeSiteLabel(value, fallback) {
  const label = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  return label || fallback;
}

function normalizeSuggestionId(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function createSuggestionId(siteKey, prompt, createdAt) {
  return normalizeSuggestionId(`${siteKey}-${createdAt}-${hashString(prompt)}`);
}

function hashString(value) {
  let hash = 5381;
  for (const character of value) {
    hash = (hash * 33) ^ character.codePointAt(0);
  }
  return (hash >>> 0).toString(36);
}
