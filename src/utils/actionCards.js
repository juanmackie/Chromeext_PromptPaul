/**
 * @fileoverview Platform-aware quick action cards for chat context workflows.
 * @module actionCards
 */

const MAX_ACTION_CARDS = 6;

const PROMPTS = {
  youtube: [
    card('youtube-summary', 'Summarize video', 'Summarize this YouTube video with key takeaways.'),
    card('youtube-moment', 'Explain this moment', 'Explain what is happening at the current timestamp.'),
    card('youtube-chapters', 'Chapter notes', 'Create chapter-by-chapter study notes for this video.'),
  ],
  github: [
    card('github-summary', 'Summarize page', 'Summarize this GitHub page with key technical context.'),
    card('github-risks', 'Review risks', 'Review likely bugs, regressions, and missing tests.'),
  ],
  gmail: [
    card('gmail-reply', 'Draft reply', 'Draft a practical reply for this email thread.'),
    card('gmail-summary', 'Summarize thread', 'Summarize this email thread into decisions and action items.'),
  ],
  'google-docs': [
    card('docs-summary', 'Summarize doc', 'Summarize this document with decisions, risks, and action items.'),
  ],
  'google-sheets': [
    card('sheets-insights', 'Find insights', 'Identify trends, outliers, and questions from this sheet context.'),
  ],
  news: [
    card('news-summary', 'Summarize article', 'Summarize this article and separate facts from open questions.'),
  ],
  arxiv: [
    card('arxiv-summary', 'Summarize paper', 'Summarize this paper: problem, method, results, and limits.'),
  ],
  pdf: [
    card('pdf-summary', 'Summarize PDF', 'Summarize this PDF with key claims, numbers, and action points.'),
  ],
  generic: [
    card('generic-summary', 'Summarize page', 'Summarize the current page with key points and practical takeaways.'),
    card('generic-research', 'Research brief', 'Turn this page into a concise research brief with next steps.'),
  ],
};

export function inferActionCards(input) {
  const platform = normalizePlatform(input?.platform);
  const base = PROMPTS[platform] || PROMPTS.generic;
  const cards = base.map((entry) => ({
    ...entry,
    prompt: hydratePrompt(entry.id, entry.prompt, input),
  }));
  return cards.slice(0, MAX_ACTION_CARDS);
}

export function createYouTubeCurrentMomentPromptResult(input) {
  const payload = input?.adapterPayload || {};
  const title = stringOr(payload.title, 'this video');
  const channel = stringOr(payload.channel, '');
  const currentTimeSeconds = finiteNumberOr(payload.currentTimeSeconds, 0);
  const timestamp = formatYouTubeMomentTimestamp(currentTimeSeconds);
  return {
    prompt: createYouTubeCurrentMomentPrompt({ adapterPayload: payload, locale: input?.locale }),
    title,
    channel,
    currentTimeSeconds,
    timestamp,
  };
}

export function createYouTubeCurrentMomentPrompt(input) {
  const payload = input?.adapterPayload || {};
  const title = stringOr(payload.title, 'this video');
  const channel = stringOr(payload.channel, '');
  const currentTimeSeconds = finiteNumberOr(payload.currentTimeSeconds, 0);
  const timestamp = formatYouTubeMomentTimestamp(currentTimeSeconds);
  const channelLabel = channel ? ` by ${channel}` : '';
  return `Explain what is happening at ${timestamp} (${currentTimeSeconds} seconds) in the YouTube video "${title}"${channelLabel}. Prioritize the exact moment currently playing, then include brief surrounding context.`;
}

export function formatYouTubeMomentTimestamp(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function hydratePrompt(id, prompt, input) {
  if (id !== 'youtube-moment') return prompt;
  const payload = input?.platformInfo || {};
  return createYouTubeCurrentMomentPrompt({ adapterPayload: payload });
}

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  if (!value) return 'generic';
  return value;
}

function card(id, title, prompt) {
  return { id, title, prompt };
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function finiteNumberOr(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
