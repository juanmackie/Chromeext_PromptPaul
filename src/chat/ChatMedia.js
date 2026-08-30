/**
 * @fileoverview Chat Media Module - Handles media data processing and analysis
 *
 * Responsibilities:
 * - Media data validation and processing
 * - Media type detection
 * - Media analysis prompt generation
 * - Media data state management
 *
 * @module ChatMedia
 */

import { buildExplainPrompt, buildSummarizePrompt, buildAnalyzePrompt } from '../prompts.js';

/**
 * Media types supported by the extension
 * @enum {string}
 */
export const MediaType = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  TEXT: 'text',
};

/**
 * Validate media data object
 * @param {Object} mediaData - Media data object to validate
 * @returns {Object} - Validation result { valid: boolean, error?: string }
 */
export function validateMediaData(mediaData) {
  if (!mediaData) {
    return { valid: false, error: 'No media data provided' };
  }

  if (!mediaData.type) {
    return { valid: false, error: 'Media type not specified' };
  }

  if (!Object.values(MediaType).includes(mediaData.type)) {
    return { valid: false, error: `Unsupported media type: ${mediaData.type}` };
  }

  // For images, require base64 data
  if (mediaData.type === MediaType.IMAGE && !mediaData.base64) {
    return { valid: false, error: 'Image data missing base64 content' };
  }

  // For video/audio, require either base64 or URL
  if (
    (mediaData.type === MediaType.VIDEO || mediaData.type === MediaType.AUDIO) &&
    !mediaData.base64 &&
    !mediaData.url
  ) {
    return { valid: false, error: 'Media data missing base64 or URL' };
  }

  return { valid: true };
}

/**
 * Get media analysis prompt based on action type
 * @param {string} actionType - Type of analysis action
 * @param {Object} mediaData - Media data object
 * @param {string} customInstruction - Custom instruction content
 * @returns {string} - Generated analysis prompt
 */
export function getMediaAnalysisPrompt(actionType, mediaData, customInstruction = null) {
  const mediaType = mediaData?.type || 'content';

  switch (actionType) {
    case 'summarize':
      return buildSummarizePrompt(mediaType, true);

    case 'explain':
      return buildExplainPrompt(mediaType);

    case 'custom':
      if (customInstruction) {
        return customInstruction;
      }
    // Fall through to default

    default:
      return buildAnalyzePrompt(mediaType);
  }
}

/**
 * Prepare media content for API call
 * @param {Object} mediaData - Media data object
 * @returns {Array} - Message content array with media
 */
export function prepareMediaContent(mediaData) {
  if (!mediaData || !mediaData.base64) {
    return [];
  }

  const content = [];

  // Add text prompt if provided
  if (mediaData.textPrompt) {
    content.push({ type: 'text', text: mediaData.textPrompt });
  }

  // Add media content based on type
  if (mediaData.type === MediaType.IMAGE) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mediaData.mimeType || 'image/png'};base64,${mediaData.base64}` },
    });
  } else if (mediaData.type === MediaType.VIDEO) {
    content.push({
      type: 'video_url',
      video_url: { url: `data:${mediaData.mimeType || 'video/mp4'};base64,${mediaData.base64}` },
    });
  } else if (mediaData.type === MediaType.AUDIO) {
    content.push({
      type: 'audio_url',
      audio_url: { url: `data:${mediaData.mimeType || 'audio/mpeg'};base64,${mediaData.base64}` },
    });
  }

  return content;
}

/**
 * Check if media data is valid for API call
 * @param {Object} mediaData - Media data object
 * @returns {boolean} - True if media data is valid
 */
export function hasValidMediaData(mediaData) {
  if (!mediaData) return false;
  if (mediaData.error) return false;
  if (!mediaData.base64 && !mediaData.textPrompt) return false;
  return true;
}

/**
 * Get media type display name
 * @param {string} mediaType - Media type enum value
 * @returns {string} - Display name
 */
export function getMediaDisplayName(mediaType) {
  const names = {
    [MediaType.IMAGE]: 'Image',
    [MediaType.VIDEO]: 'Video',
    [MediaType.AUDIO]: 'Audio',
    [MediaType.TEXT]: 'Text',
  };
  return names[mediaType] || 'Media';
}

/**
 * Check if media type supports vision analysis
 * @param {string} mediaType - Media type enum value
 * @returns {boolean} - True if vision analysis is supported
 */
export function supportsVisionAnalysis(mediaType) {
  return mediaType === MediaType.IMAGE || mediaType === MediaType.VIDEO;
}

// ── Dropped File Handling ──────────────────────────────────────────

/** Maximum allowed file size in bytes (20 MB) */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Allowed MIME type prefixes for dropped files */
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];

/** Maximum characters extracted from a document attachment (200k chars). */
export const MAX_DOCUMENT_CHARS = 200_000;

/** Document extensions accepted as bounded text attachments (markitdown-style). */
const DOCUMENT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json'];

/**
 * Return the lowercase extension of a filename, or '' when absent.
 * @param {string} name File name.
 * @returns {string} Lowercase extension including the leading dot.
 */
export function getDocumentExtension(name) {
  const match = String(name || '')
    .toLowerCase()
    .match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

/**
 * Check whether a dropped file is a supported document attachment.
 * Extension-first because Windows drops often carry empty MIME types.
 * @param {File} file File object from a drop event.
 * @returns {boolean} True when the extension is in the allowlist.
 */
export function isDocumentFile(file) {
  return DOCUMENT_EXTENSIONS.includes(getDocumentExtension(file?.name));
}

/**
 * Validate a dropped file's type and size.
 * @param {File} file - File object from drop event
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDroppedFile(file) {
  if (isDocumentFile(file)) {
    if (file.size > MAX_FILE_SIZE) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return {
        valid: false,
        error: `File too large: ${file.name} (${mb} MB, max 20 MB)`,
      };
    }
    return { valid: true };
  }
  const validPrefix = ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p));
  if (!validPrefix) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type || file.name || 'unknown'} (images, video, audio, or .txt/.md/.csv/.json documents only)`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File too large: ${file.name} (${mb} MB, max 20 MB)`,
    };
  }
  return { valid: true };
}

/**
 * Read a dropped file as base64 data URL.
 * @param {File} file - File to read
 * @returns {Promise<{ base64: string, mimeType: string, name: string }>}
 */
export function readBlobAsBase64(blob, name = 'clipboard-image') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:...;base64,...
      const commaIdx = result.indexOf(',');
      const base64 = commaIdx !== -1 ? result.slice(commaIdx + 1) : result;
      resolve({
        base64,
        mimeType: blob.type || 'image/png',
        name: blob.name || name,
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${blob.name || name}`));
    reader.readAsDataURL(blob);
  });
}

/**
 * Read a supported document file as bounded plain text for prompt context.
 * @param {File} file Document file (.txt/.md/.csv/.json).
 * @returns {Promise<{ name: string, mimeType: string, size: number, text: string, truncated: boolean }>}
 */
export function readFileAsDocumentText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      let text = String(reader.result || '')
        .replace(/\u0000/g, '') // eslint-disable-line no-control-regex
        .replace(/\r\n/g, '\n');
      let truncated = false;
      if (text.length > MAX_DOCUMENT_CHARS) {
        text = `${text.slice(0, MAX_DOCUMENT_CHARS - 13)}… [truncated]`;
        truncated = true;
      }
      resolve({
        name: file.name || 'document',
        mimeType: file.type || 'text/plain',
        size: file.size,
        text: text.trim(),
        truncated,
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file?.name || 'document'}`));
    reader.readAsText(file);
  });
}

/**
 * Classify and read a dropped file into a ready-to-send attachment plan.
 * Documents (.txt/.md/.csv/.json) become bounded text context; everything else
 * follows the existing base64 media pipeline. Pure data out: no UI side effects.
 * @param {File} file File object from a drop event.
 * @returns {Promise<{kind:'invalid',error:string}|{kind:'document',preview:Object,instruction:string,text:string}|{kind:'media',mediaData:Object,instruction:string}>}
 */
export async function prepareDroppedFile(file) {
  const validation = validateDroppedFile(file);
  if (!validation.valid) {
    return { kind: 'invalid', error: validation.error };
  }

  if (isDocumentFile(file)) {
    const doc = await readFileAsDocumentText(file);
    if (!doc.text) {
      return { kind: 'invalid', error: `${doc.name} is empty or unreadable.` };
    }
    return {
      kind: 'document',
      preview: {
        type: MediaType.TEXT,
        name: doc.name,
        mimeType: doc.mimeType,
        size: doc.size,
        truncated: doc.truncated,
        lineCount: doc.text.split('\n').length,
      },
      instruction: 'Analyze this attached document.',
      text: doc.text,
    };
  }

  const fileData = await readFileAsBase64(file);
  const mediaType = file.type.startsWith('video/')
    ? MediaType.VIDEO
    : file.type.startsWith('audio/')
      ? MediaType.AUDIO
      : MediaType.IMAGE;
  const instruction = `Analyze this ${getMediaDisplayName(mediaType)}.`;
  const mediaData = {
    type: mediaType,
    mimeType: fileData.mimeType,
    base64: fileData.base64,
    textPrompt: instruction,
  };
  return {
    kind: 'media',
    mediaData,
    instruction,
  };
}

/**
 * Read a dropped file as base64 data URL.
 * @param {File} file - File to read
 * @returns {Promise<{ base64: string, mimeType: string, name: string }>}
 */
export function readFileAsBase64(file) {
  return readBlobAsBase64(file, file.name);
}
