import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync, handleChromeApiCall } from '../errorHandler.js';

/**
 * Media Processor
 * Handles fetching and processing media files (images, videos, audio)
 * Converts media to base64 format for API consumption
 */
export class MediaProcessor {
    constructor() {
        this.maxFileSize = 50 * 1024 * 1024; // 50MB limit
    }

    /**
     * Fetch media from URL and convert to base64
     * @param {string} url - URL of the media to fetch
     * @returns {Promise<string>} Base64 encoded media data
     */
    async fetchMediaAsBase64(url) {
        return await wrapAsync(async () => {
            console.log('Fetching media from URL:', url);

            if (!url) {
                throw createError('No URL provided for media fetching', {
                    category: ErrorCategory.USER_INPUT,
                    severity: ErrorSeverity.MEDIUM
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
                        statusText: response.statusText
                    }
                });
            }

            const blob = await response.blob();
            console.log('Blob size:', blob.size, 'Type:', blob.type);

            if (blob.size > this.maxFileSize) {
                throw createError('Media file too large (max 50MB)', {
                    category: ErrorCategory.VALIDATION,
                    severity: ErrorSeverity.MEDIUM,
                    context: { size: blob.size, url }
                });
            }

            return await this.convertBlobToBase64(blob);
        }, {
            category: ErrorCategory.NETWORK,
            userMessage: 'Failed to fetch and process media file',
            retryable: true
        });
    }

    /**
     * Convert blob to base64 string
     * @param {Blob} blob - Media blob to convert
     * @returns {Promise<string>} Base64 encoded data
     */
    async convertBlobToBase64(blob) {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const dataUrl = reader.result;
                    console.log('DataURL prefix:', dataUrl.substring(0, 50));
                    const base64 = dataUrl.split(',')[1]; // Remove data:image/jpeg;base64, prefix
                    console.log('Base64 length:', base64.length);
                    console.log('Base64 sample:', base64.substring(0, 100));
                    resolve(base64);
                } catch (error) {
                    reject(createError('Failed to process media data URL', {
                        category: ErrorCategory.SYSTEM,
                        severity: ErrorSeverity.MEDIUM,
                        originalError: error
                    }));
                }
            };
            reader.onerror = (error) => {
                reject(createError('FileReader error while processing media', {
                    category: ErrorCategory.SYSTEM,
                    severity: ErrorSeverity.MEDIUM,
                    originalError: error
                }));
            };
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Get MIME type from URL
     * @param {string} url - URL to extract MIME type from
     * @returns {string} MIME type
     */
    getMimeTypeFromUrl(url) {
        if (!url) return 'application/octet-stream';

        try {
            const extension = url.split('.').pop()?.toLowerCase();
            const mimeTypes = {
                // Image types
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'bmp': 'image/bmp',
                'svg': 'image/svg+xml',
                'ico': 'image/x-icon',

                // Video types
                'mp4': 'video/mp4',
                'webm': 'video/webm',
                'ogg': 'video/ogg',
                'avi': 'video/x-msvideo',
                'mov': 'video/quicktime',
                'wmv': 'video/x-ms-wmv',
                'flv': 'video/x-flv',
                'mkv': 'video/x-matroska',

                // Audio types
                'mp3': 'audio/mpeg',
                'wav': 'audio/wav',
                'ogg': 'audio/ogg',
                'm4a': 'audio/mp4',
                'aac': 'audio/aac',
                'flac': 'audio/flac',
                'wma': 'audio/x-ms-wma'
            };
            return mimeTypes[extension] || 'application/octet-stream';
        } catch (error) {
            return 'application/octet-stream';
        }
    }

    /**
     * Validate media file type
     * @param {string} mimeType - MIME type to validate
     * @returns {boolean} True if valid media type
     */
    isValidMediaType(mimeType) {
        const validTypes = [
            // Images
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/bmp',
            'image/svg+xml',

            // Videos
            'video/mp4',
            'video/webm',
            'video/ogg',
            'video/quicktime',

            // Audio
            'audio/mpeg',
            'audio/wav',
            'audio/ogg',
            'audio/mp4',
            'audio/aac'
        ];

        return validTypes.includes(mimeType);
    }

    /**
     * Get media type category from MIME type
     * @param {string} mimeType - MIME type
     * @returns {string} Media category (image, video, audio)
     */
    getMediaTypeCategory(mimeType) {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        return 'unknown';
    }

    /**
     * Process media data for API consumption
     * @param {string} url - Media URL
     * @returns {Promise<Object>} Processed media data
     */
    async processMediaForApi(url) {
        const base64Data = await this.fetchMediaAsBase64(url);
        const mimeType = this.getMimeTypeFromUrl(url);

        return {
            base64: base64Data,
            mimeType: mimeType,
            type: this.getMediaTypeCategory(mimeType),
            url: url,
            isValid: this.isValidMediaType(mimeType)
        };
    }

    /**
     * Set maximum file size limit
     * @param {number} sizeInBytes - Maximum file size in bytes
     */
    setMaxFileSize(sizeInBytes) {
        this.maxFileSize = sizeInBytes;
    }

    /**
     * Get current maximum file size limit
     * @returns {number} Maximum file size in bytes
     */
    getMaxFileSize() {
        return this.maxFileSize;
    }
}

// Export singleton instance
export const mediaProcessor = new MediaProcessor();