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

  // Fetch media and convert to base64
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

        const blob = await response.blob();
        logger.info('BackgroundMediaHandler', 'Blob size:', blob.size, 'Type:', blob.type);

        if (blob.size > this.maxFileSize) {
          throw createError('Media file too large (max 50MB)', {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            context: { size: blob.size, url },
          });
        }

        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const dataUrl = reader.result;
              logger.info('BackgroundMediaHandler', 'DataURL prefix:', dataUrl.substring(0, 50));
              const base64 = dataUrl.split(',')[1]; // Remove data:image/jpeg;base64, prefix
              logger.info('BackgroundMediaHandler', 'Base64 length:', base64.length);
              logger.info('BackgroundMediaHandler', 'Base64 sample:', base64.substring(0, 100));
              resolve(base64);
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

  // Get MIME type from URL
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
