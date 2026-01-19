import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} from '../errorHandler.js';

import logger from '../utils/logger.js'; /**
 * Media Handler
 * Handles media fetching and processing utilities
 */

export class MediaHandler {
  constructor() {
    this.maxFileSize = 50 * 1024 * 1024; // 50MB limit
  }

  /**
   * Fetch media and return details including validation
   * @param {string} url - Media URL
   * @returns {Promise<Object>} Object with base64 and mimeType
   */
  async fetchMediaAsBase64(url) {
    return await wrapAsync(
      async () => {
        logger.info('BackgroundMediaHandler', 'Fetching media from URL:', url);

        if (!url) {
          throw createError('No URL provided for media fetching', {
            category: ErrorCategory.USER_INPUT,
            severity: ErrorSeverity.MEDIUM,
          });
        }

        // Handle data URLs directly to avoid CSP violations
        if (url.startsWith('data:')) {
          logger.info('BackgroundMediaHandler', 'Processing data URL directly');
          // Extract base64 and mime type from data URL
          // Format: data:[<mediatype>][;base64],<data>
          const matches = url.match(/^data:([^;]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            return {
              mimeType: matches[1],
              base64: matches[2]
            };
          }
          // Fallback if not standard base64 data URI (unlikely for this use case but safe to fallback or error)
          // If we can't parse it easily, we might let the fetch try or just error out. 
          // Given the context of CSP blocking fetch, we should probably treat it as a blob if possible or specific error.
          // But for simplicity, let's assume standard base64 from captureVisibleTab.
        }

        const response = await fetch(url);

        if (!response.ok) {
          throw createError(`Failed to fetch media: ${response.status} ${response.statusText}`, {
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.HIGH,
            retryable: true,
            context: {
              url,
              status: response.status,
              statusText: response.statusText,
            },
          });
        }

        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer]);
        logger.info('BackgroundMediaHandler', 'Blob size:', blob.size, 'Initial Type:', blob.type);

        if (blob.size > this.maxFileSize) {
          throw createError('Media file too large (max 50MB)', {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            context: { size: blob.size, url },
          });
        }

        // Detect true MIME type from magic numbers
        const detectedMimeType = this.detectMimeTypeFromBuffer(arrayBuffer);
        const finalMimeType = detectedMimeType || blob.type || this.getMimeTypeFromUrl(url);

        logger.info('BackgroundMediaHandler', 'MIME detection:', {
          initial: blob.type,
          magic: detectedMimeType,
          final: finalMimeType
        });

        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const result = reader.result;
              if (typeof result !== 'string') {
                throw new Error('FileReader result is not a string');
              }
              const dataUrl = result;
              // If the data URL MIME type differs from our detected one, fix it
              const base64 = dataUrl.split(',')[1];

              resolve({
                base64,
                mimeType: finalMimeType
              });
            } catch (error) {
              reject(
                createError('Failed to process media data URL', {
                  category: ErrorCategory.SYSTEM,
                  severity: ErrorSeverity.MEDIUM,
                  originalError: error,
                })
              );
            }
          };
          reader.onerror = error => {
            reject(
              createError('FileReader error while processing media', {
                category: ErrorCategory.SYSTEM,
                severity: ErrorSeverity.MEDIUM,
                originalError: error,
              })
            );
          };
          reader.readAsDataURL(blob);
        });
      },
      {
        category: ErrorCategory.NETWORK,
        userMessage: 'Failed to fetch and process media file',
        retryable: true,
      }
    );
  }


  /**
   * Detects MIME type by reading specific magic numbers from the buffer
   * @param {ArrayBuffer} buffer 
   * @returns {string|null} Detected MIME type or null
   */
  detectMimeTypeFromBuffer(buffer) {
    if (!buffer || buffer.byteLength < 4) return null;

    const arr = new Uint8Array(buffer).subarray(0, 4);
    let header = '';
    for (let i = 0; i < arr.length; i++) {
      header += arr[i].toString(16).toUpperCase();
    }

    // Magic Numbers
    // JPG: FF D8 FF
    if (header.startsWith('FFD8FF')) {
      return 'image/jpeg';
    }
    // PNG: 89 50 4E 47
    if (header === '89504E47') {
      return 'image/png';
    }
    // GIF: 47 49 46 38
    if (header === '47494638') {
      return 'image/gif';
    }
    // WEBP: RIFF....WEBP (Detected via "RIFF" at start and "WEBP" at offest 8)
    // We need a slightly deeper check for WebP
    if (header.startsWith('52494646')) { // "RIFF"
      // Check bytes 8-11 for "WEBP"
      if (buffer.byteLength >= 12) {
        const sub = new Uint8Array(buffer).subarray(8, 12);
        let webpHeader = '';
        for (let i = 0; i < sub.length; i++) {
          webpHeader += sub[i].toString(16).toUpperCase();
        }
        // "WEBP" in hex is 57 45 42 50
        if (webpHeader === '57454250') {
          return 'image/webp';
        }
      }
    }

    return null;
  }

  // Get MIME type from URL (Fallback)
  getMimeTypeFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();

      if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
        return 'image/jpeg';
      } else if (pathname.endsWith('.png')) {
        return 'image/png';
      } else if (pathname.endsWith('.gif')) {
        return 'image/gif';
      } else if (pathname.endsWith('.webp')) {
        return 'image/webp';
      } else if (pathname.endsWith('.webm')) {
        return 'video/webm';
      } else if (pathname.endsWith('.mp4')) {
        return 'video/mp4';
      } else if (pathname.endsWith('.ogg')) {
        return 'video/ogg';
      }

      // Default to octet-stream if we can't determine the type
      return 'application/octet-stream';
    } catch (error) {
      logger.warn('BackgroundMediaHandler', 'Failed to parse URL:', url, error);
      return 'application/octet-stream';
    }
  }

  // Validate URL format
  isValidURL(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
}

// Export singleton instance
export const mediaHandler = new MediaHandler();
