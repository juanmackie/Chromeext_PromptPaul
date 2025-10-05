/**
 * Media Service
 * Handles all media processing functionality
 * Implements production-ready coding rules for media handling
 *
 * Core Principles:
 * - Input Validation: Validate all media inputs
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient media processing with proper timeouts
 */

import { errorHandler, logger, validators } from '../shared/index.js';

class MediaService {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.errorHandler = dependencies.ErrorHandler;
    this.validator = dependencies.Validator;
    
    // Media service configuration
    this.defaultTimeout = 30000; // 30 seconds
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
    this.supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    this.supportedVideoTypes = ['video/mp4', 'video/webm'];
    this.supportedAudioTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg'];
  }

  /**
   * Validates media type
   * @param {string} mimeType - MIME type to validate
   * @param {string} mediaType - Media type category ('image', 'video', 'audio')
   * @returns {boolean} True if valid
   */
  isValidMediaType(mimeType, mediaType) {
    if (!mimeType || typeof mimeType !== 'string') {
      return false;
    }

    switch (mediaType) {
      case 'image':
        return this.supportedImageTypes.includes(mimeType);
      case 'video':
        return this.supportedVideoTypes.includes(mimeType);
      case 'audio':
        return this.supportedAudioTypes.includes(mimeType);
      default:
        return false;
    }
  }

  /**
   * Converts data URL to base64 string
   * @param {string} dataUrl - Data URL
   * @returns {Object} Object with base64 and MIME type
   */
  dataUrlToBase64(dataUrl) {
    try {
      if (!dataUrl || typeof dataUrl !== 'string') {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          'Data URL is required and must be a string'
        );
      }

      // Extract MIME type and base64 data
      const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          'Invalid data URL format'
        );
      }

      const mimeType = matches[1];
      const base64Data = matches[2];

      return {
        mimeType,
        base64: base64Data
      };
    } catch (error) {
      this.logger.error('Failed to convert data URL to base64', { dataUrl: dataUrl.substring(0, 50) }, error);
      throw error;
    }
  }

  /**
   * Validates base64 data
   * @param {string} base64Data - Base64 data
   * @param {string} mimeType - MIME type
   * @returns {boolean} True if valid
   */
  isValidBase64(base64Data, mimeType) {
    try {
      // Validate base64 format
      if (!base64Data || typeof base64Data !== 'string') {
        return false;
      }

      if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(base64Data)) {
        return false;
      }

      // Validate MIME type
      if (!mimeType || typeof mimeType !== 'string') {
        return false;
      }

      // Check if MIME type is supported
      const mediaType = mimeType.split('/')[0];
      if (!['image', 'video', 'audio'].includes(mediaType)) {
        return false;
      }

      return this.isValidMediaType(mimeType, mediaType);
    } catch (error) {
      this.logger.error('Failed to validate base64 data', { mimeType }, error);
      return false;
    }
  }

  /**
   * Estimates file size from base64 data
   * @param {string} base64Data - Base64 data
   * @returns {number} Estimated file size in bytes
   */
  estimateFileSize(base64Data) {
    try {
      if (!base64Data || typeof base64Data !== 'string') {
        return 0;
      }

      // Base64 encoding increases size by ~33%
      return Math.floor(base64Data.length * 0.75);
    } catch (error) {
      this.logger.error('Failed to estimate file size', {}, error);
      return 0;
    }
  }

  /**
   * Processes media data from various sources
   * @param {Object} mediaData - Raw media data
   * @param {string} mediaType - Expected media type
   * @returns {Promise<Object>} Processed media data
   */
  async processMediaData(mediaData, mediaType) {
    this.logger.debug('Processing media data', { mediaType });

    try {
      // Validate media type
      if (!['image', 'video', 'audio'].includes(mediaType)) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `Unsupported media type: ${mediaType}`
        );
      }

      let processedData = {
        type: mediaType,
        mimeType: '',
        base64: '',
        loading: false,
        error: null
      };

      // Handle different media data sources
      if (mediaData.srcUrl) {
        // Media from URL (context menu)
        processedData = await this.processMediaFromUrl(mediaData.srcUrl, mediaType);
      } else if (mediaData.dataUrl) {
        // Media from data URL
        processedData = await this.processMediaFromDataUrl(mediaData.dataUrl, mediaType);
      } else if (mediaData.file) {
        // Media from file object
        processedData = await this.processMediaFromFile(mediaData.file, mediaType);
      } else {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          'No valid media source provided'
        );
      }

      // Validate processed data
      if (!this.isValidBase64(processedData.base64, processedData.mimeType)) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `Invalid ${mediaType} data`
        );
      }

      // Check file size
      const fileSize = this.estimateFileSize(processedData.base64);
      if (fileSize > this.maxFileSize) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `${mediaType} file is too large (max ${Math.floor(this.maxFileSize / 1024 / 1024)}MB)`
        );
      }

      this.logger.debug('Media data processed successfully', {
        mediaType,
        mimeType: processedData.mimeType,
        fileSize
      });

      return processedData;
    } catch (error) {
      this.logger.error('Failed to process media data', { mediaType }, error);
      return {
        type: mediaType,
        mimeType: '',
        base64: '',
        loading: false,
        error: error.message
      };
    }
  }

  /**
   * Processes media from URL
   * @param {string} url - Media URL
   * @param {string} mediaType - Expected media type
   * @returns {Promise<Object>} Processed media data
   */
  async processMediaFromUrl(url, mediaType) {
    this.logger.debug('Processing media from URL', { url, mediaType });

    try {
      // Validate URL
      const urlError = this.validator.validate('url', url, 'media URL');
      if (urlError) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `Invalid media URL: ${urlError}`
        );
      }

      // Fetch media
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
      }

      // Get MIME type from response
      const mimeType = response.headers.get('content-type');
      if (!this.isValidMediaType(mimeType, mediaType)) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `Unsupported ${mediaType} type: ${mimeType}`
        );
      }

      // Convert to base64
      const blob = await response.blob();
      const base64 = await this.blobToBase64(blob);

      return {
        type: mediaType,
        mimeType,
        base64,
        loading: false,
        error: null
      };
    } catch (error) {
      this.logger.error('Failed to process media from URL', { url, mediaType }, error);
      return {
        type: mediaType,
        mimeType: '',
        base64: '',
        loading: false,
        error: error.message
      };
    }
  }

  /**
   * Processes media from data URL
   * @param {string} dataUrl - Data URL
   * @param {string} mediaType - Expected media type
   * @returns {Promise<Object>} Processed media data
   */
  async processMediaFromDataUrl(dataUrl, mediaType) {
    this.logger.debug('Processing media from data URL', { mediaType });

    try {
      // Convert data URL to base64
      const { mimeType, base64 } = this.dataUrlToBase64(dataUrl);

      // Validate MIME type
      if (!this.isValidMediaType(mimeType, mediaType)) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `Unsupported ${mediaType} type: ${mimeType}`
        );
      }

      return {
        type: mediaType,
        mimeType,
        base64,
        loading: false,
        error: null
      };
    } catch (error) {
      this.logger.error('Failed to process media from data URL', { mediaType }, error);
      return {
        type: mediaType,
        mimeType: '',
        base64: '',
        loading: false,
        error: error.message
      };
    }
  }

  /**
   * Processes media from file object
   * @param {File} file - File object
   * @param {string} mediaType - Expected media type
   * @returns {Promise<Object>} Processed media data
   */
  async processMediaFromFile(file, mediaType) {
    this.logger.debug('Processing media from file', { mediaType });

    try {
      // Validate file
      if (!file || !(file instanceof File)) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          'Invalid file object provided'
        );
      }

      // Validate MIME type
      if (!this.isValidMediaType(file.type, mediaType)) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `Unsupported ${mediaType} type: ${file.type}`
        );
      }

      // Check file size
      if (file.size > this.maxFileSize) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `${mediaType} file is too large (max ${Math.floor(this.maxFileSize / 1024 / 1024)}MB)`
        );
      }

      // Convert to base64
      const base64 = await this.fileToBase64(file);

      return {
        type: mediaType,
        mimeType: file.type,
        base64,
        loading: false,
        error: null
      };
    } catch (error) {
      this.logger.error('Failed to process media from file', { mediaType }, error);
      return {
        type: mediaType,
        mimeType: '',
        base64: '',
        loading: false,
        error: error.message
      };
    }
  }

  /**
   * Converts blob to base64
   * @param {Blob} blob - Blob to convert
   * @returns {Promise<string>} Base64 string
   */
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const { base64 } = this.dataUrlToBase64(result);
          resolve(base64);
        } else {
          reject(new Error('Failed to read blob as data URL'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Converts file to base64
   * @param {File} file - File to convert
   * @returns {Promise<string>} Base64 string
   */
  async fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const { base64 } = this.dataUrlToBase64(result);
          resolve(base64);
        } else {
          reject(new Error('Failed to read file as data URL'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Creates a media data object for API requests
   * @param {Object} processedData - Processed media data
   * @returns {Object} Media data object for API
   */
  createMediaDataForApi(processedData) {
    if (!processedData || !processedData.base64) {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'Valid processed media data is required'
      );
    }

    return {
      type: processedData.type,
      mime_type: processedData.mimeType,
      data: processedData.base64
    };
  }

  /**
   * Resizes image if needed (placeholder implementation)
   * @param {string} base64Data - Base64 image data
   * @param {number} maxWidth - Maximum width
   * @param {number} maxHeight - Maximum height
   * @param {number} quality - Image quality (0-1)
   * @returns {Promise<string>} Resized base64 image data
   */
  async resizeImage(base64Data, maxWidth = 1024, maxHeight = 1024, quality = 0.9) {
    this.logger.debug('Resizing image', { maxWidth, maxHeight, quality });

    try {
      // This is a placeholder implementation
      // In a real scenario, you would:
      // 1. Convert base64 to Image
      // 2. Create canvas
      // 3. Draw and resize image
      // 4. Convert back to base64
      
      // For now, just return the original data
      return base64Data;
    } catch (error) {
      this.logger.error('Failed to resize image', {}, error);
      throw this.errorHandler.createError(
        'PROCESSING_ERROR',
        `Failed to resize image: ${error.message}`,
        error
      );
    }
  }
}

export default MediaService;