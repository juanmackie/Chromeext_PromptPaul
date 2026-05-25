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
      return `Please summarize this ${mediaType} into a bullet list of key points. Focus on the main elements, text, objects, and overall message or purpose.`;

    case 'explain':
      return `Explain this ${mediaType} to me in a short concise MECE approach. Break down what you see into clear, structured categories.`;

    case 'custom':
      if (customInstruction) {
        return customInstruction;
      }
    // Fall through to default

    default:
      return `Please analyze this ${mediaType}. Describe what you see and provide any relevant insights.`;
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

/**
 * Validate a dropped file's type and size.
 * @param {File} file - File object from drop event
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDroppedFile(file) {
  const validPrefix = ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p));
  if (!validPrefix) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type || 'unknown'} (only images, video, audio allowed)`,
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
 * Read a dropped file as base64 data URL.
 * @param {File} file - File to read
 * @returns {Promise<{ base64: string, mimeType: string, name: string }>}
 */
export function readFileAsBase64(file) {
  return readBlobAsBase64(file, file.name);
}
