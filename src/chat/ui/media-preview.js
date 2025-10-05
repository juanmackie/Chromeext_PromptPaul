/**
 * Media Preview Handler
 * Handles rendering of media previews in chat
 * Implements production-ready coding rules for media handling
 *
 * Core Principles:
 * - Input Validation: Validate all media data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient media rendering with proper resource management
 */

import { logger } from '../../shared/index.js';

class MediaPreviewHandler {
  constructor(dependencies) {
    this.logger = dependencies.Logger;
    this.chatArea = null;
    this.currentMediaData = null;
  }

  /**
   * Initializes the media preview handler
   * @param {HTMLElement} chatArea - Chat area element
   */
  initialize(chatArea) {
    if (!chatArea || !(chatArea instanceof HTMLElement)) {
      throw new Error('Valid chat area element is required');
    }

    this.chatArea = chatArea;
    this.logger.debug('Media preview handler initialized');
  }

  /**
   * Sets current media data for preview
   * @param {Object} mediaData - Media data object
   */
  setCurrentMediaData(mediaData) {
    if (!mediaData || typeof mediaData !== 'object') {
      throw new Error('Valid media data object is required');
    }

    this.currentMediaData = mediaData;
    this.logger.debug('Current media data set', { type: mediaData.type });
  }

  /**
   * Clears current media data
   */
  clearCurrentMediaData() {
    this.currentMediaData = null;
    this.logger.debug('Current media data cleared');
  }

  /**
   * Renders a media preview in the chat area
   * @param {Object} mediaData - Media data object
   * @returns {HTMLElement} Media preview element
   */
  renderMediaPreview(mediaData) {
    if (!mediaData || typeof mediaData !== 'object') {
      throw new Error('Valid media data object is required');
    }

    if (!mediaData.type || typeof mediaData.type !== 'string') {
      throw new Error('Media type is required and must be a string');
    }

    this.logger.debug('Rendering media preview', { type: mediaData.type });

    try {
      // Create preview container
      const previewDiv = document.createElement('div');
      previewDiv.className = 'message system-message';
      previewDiv.style.cssText = 'background: #e3f2fd; border-left: 4px solid #2196f3; margin-bottom: 10px;';

      // Create content based on media type
      let content;
      switch (mediaData.type) {
        case 'image':
          content = this.createImagePreview(mediaData);
          break;
        case 'video':
          content = this.createVideoPreview(mediaData);
          break;
        case 'audio':
          content = this.createAudioPreview(mediaData);
          break;
        default:
          throw new Error(`Unsupported media type: ${mediaData.type}`);
      }

      previewDiv.appendChild(content);

      // Add to chat area
      this.chatArea.appendChild(previewDiv);

      // Scroll to bottom
      this.chatArea.scrollTop = this.chatArea.scrollHeight;

      this.logger.debug('Media preview rendered successfully', { type: mediaData.type });

      return previewDiv;
    } catch (error) {
      this.logger.error('Failed to render media preview', { type: mediaData.type }, error);
      throw error;
    }
  }

  /**
   * Creates an image preview
   * @param {Object} mediaData - Media data object
   * @returns {HTMLElement} Image preview element
   */
  createImagePreview(mediaData) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    // Create image element
    const img = document.createElement('img');
    img.src = `data:${mediaData.mimeType};base64,${mediaData.base64}`;
    img.style.cssText = 'max-width: 200px; max-height: 150px; border-radius: 4px;';
    img.alt = 'Image for analysis';

    // Create info element
    const info = document.createElement('div');
    info.innerHTML = `
      <div>
        <strong>📷 Image Analysis</strong><br>
        <small>Right-clicked image ready for analysis</small>
      </div>
    `;

    container.appendChild(img);
    container.appendChild(info);

    return container;
  }

  /**
   * Creates a video preview
   * @param {Object} mediaData - Media data object
   * @returns {HTMLElement} Video preview element
   */
  createVideoPreview(mediaData) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    // Create video element
    const video = document.createElement('video');
    video.src = `data:${mediaData.mimeType};base64,${mediaData.base64}`;
    video.style.cssText = 'max-width: 200px; max-height: 150px; border-radius: 4px;';
    video.controls = true;

    // Create info element
    const info = document.createElement('div');
    info.innerHTML = `
      <div>
        <strong>🎬 Video Analysis</strong><br>
        <small>Right-clicked video ready for analysis</small>
      </div>
    `;

    container.appendChild(video);
    container.appendChild(info);

    return container;
  }

  /**
   * Creates an audio preview
   * @param {Object} mediaData - Media data object
   * @returns {HTMLElement} Audio preview element
   */
  createAudioPreview(mediaData) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    // Create audio element
    const audio = document.createElement('audio');
    audio.src = `data:${mediaData.mimeType};base64,${mediaData.base64}`;
    audio.style.cssText = 'width: 200px;';
    audio.controls = true;

    // Create info element
    const info = document.createElement('div');
    info.innerHTML = `
      <div>
        <strong>🎵 Audio Analysis</strong><br>
        <small>Right-clicked audio ready for analysis</small>
      </div>
    `;

    container.appendChild(audio);
    container.appendChild(info);

    return container;
  }

  /**
   * Renders a loading state for media
   * @param {Object} mediaData - Media data object
   * @returns {HTMLElement} Loading element
   */
  renderMediaLoading(mediaData) {
    if (!mediaData || typeof mediaData !== 'object') {
      throw new Error('Valid media data object is required');
    }

    this.logger.debug('Rendering media loading state', { type: mediaData.type });

    try {
      const previewDiv = document.createElement('div');
      previewDiv.className = 'message system-message';
      previewDiv.style.cssText = 'background: #f5f5f5; border-left: 4px solid #9e9e9e; margin-bottom: 10px;';

      // Create loading indicator
      const loadingText = document.createElement('div');
      loadingText.textContent = `Loading ${mediaData.type} for analysis...`;
      loadingText.style.cssText = 'padding: 10px; font-style: italic; color: #666;';

      previewDiv.appendChild(loadingText);

      // Add to chat area
      this.chatArea.appendChild(previewDiv);

      // Scroll to bottom
      this.chatArea.scrollTop = this.chatArea.scrollHeight;

      this.logger.debug('Media loading state rendered successfully', { type: mediaData.type });

      return previewDiv;
    } catch (error) {
      this.logger.error('Failed to render media loading state', { type: mediaData.type }, error);
      throw error;
    }
  }

  /**
   * Renders an error state for media
   * @param {Object} mediaData - Media data object
   * @param {string} error - Error message
   * @returns {HTMLElement} Error element
   */
  renderMediaError(mediaData, error) {
    if (!mediaData || typeof mediaData !== 'object') {
      throw new Error('Valid media data object is required');
    }

    if (!error || typeof error !== 'string') {
      throw new Error('Valid error message is required and must be a string');
    }

    this.logger.debug('Rendering media error state', { type: mediaData.type, error });

    try {
      const previewDiv = document.createElement('div');
      previewDiv.className = 'message system-message';
      previewDiv.style.cssText = 'background: #ffebee; border-left: 4px solid #f44336; margin-bottom: 10px;';

      // Create error indicator
      const errorText = document.createElement('div');
      errorText.innerHTML = `
        <div>
          <strong>❌ Error loading ${mediaData.type}</strong><br>
          <small>${error}</small>
        </div>
      `;
      errorText.style.cssText = 'padding: 10px; color: #c62828;';

      previewDiv.appendChild(errorText);

      // Add to chat area
      this.chatArea.appendChild(previewDiv);

      // Scroll to bottom
      this.chatArea.scrollTop = this.chatArea.scrollHeight;

      this.logger.debug('Media error state rendered successfully', { type: mediaData.type });

      return previewDiv;
    } catch (renderError) {
      this.logger.error('Failed to render media error state', { type: mediaData.type, error }, renderError);
      throw renderError;
    }
  }

  /**
   * Updates a media preview
   * @param {HTMLElement} previewElement - Preview element to update
   * @param {Object} mediaData - Updated media data
   */
  updateMediaPreview(previewElement, mediaData) {
    if (!previewElement || !(previewElement instanceof HTMLElement)) {
      throw new Error('Valid preview element is required');
    }

    if (!mediaData || typeof mediaData !== 'object') {
      throw new Error('Valid media data object is required');
    }

    this.logger.debug('Updating media preview', { type: mediaData.type });

    try {
      // Remove existing content
      while (previewElement.firstChild) {
        previewElement.removeChild(previewElement.firstChild);
      }

      // Add new content based on state
      let content;
      if (mediaData.loading) {
        content = document.createElement('div');
        content.textContent = `Loading ${mediaData.type} for analysis...`;
        content.style.cssText = 'padding: 10px; font-style: italic; color: #666;';
      } else if (mediaData.error) {
        content = document.createElement('div');
        content.innerHTML = `
          <div>
            <strong>❌ Error loading ${mediaData.type}</strong><br>
            <small>${mediaData.error}</small>
          </div>
        `;
        content.style.cssText = 'padding: 10px; color: #c62828;';
      } else {
        // Create content based on media type
        switch (mediaData.type) {
          case 'image':
            content = this.createImagePreview(mediaData);
            break;
          case 'video':
            content = this.createVideoPreview(mediaData);
            break;
          case 'audio':
            content = this.createAudioPreview(mediaData);
            break;
          default:
            throw new Error(`Unsupported media type: ${mediaData.type}`);
        }
      }

      previewElement.appendChild(content);

      // Scroll to bottom
      this.chatArea.scrollTop = this.chatArea.scrollHeight;

      this.logger.debug('Media preview updated successfully', { type: mediaData.type });
    } catch (error) {
      this.logger.error('Failed to update media preview', { type: mediaData.type }, error);
      throw error;
    }
  }

  /**
   * Removes a media preview
   * @param {HTMLElement} previewElement - Preview element to remove
   */
  removeMediaPreview(previewElement) {
    if (!previewElement || !(previewElement instanceof HTMLElement)) {
      this.logger.warn('Invalid preview element provided for removal');
      return;
    }

    try {
      if (previewElement.parentNode) {
        previewElement.parentNode.removeChild(previewElement);
        this.logger.debug('Media preview removed successfully');
      }
    } catch (error) {
      this.logger.error('Failed to remove media preview', {}, error);
      throw error;
    }
  }

  /**
   * Checks if media data is valid
   * @param {Object} mediaData - Media data to validate
   * @returns {boolean} True if valid
   */
  isValidMediaData(mediaData) {
    if (!mediaData || typeof mediaData !== 'object') {
      return false;
    }

    if (!mediaData.type || typeof mediaData.type !== 'string') {
      return false;
    }

    if (!['image', 'video', 'audio'].includes(mediaData.type)) {
      return false;
    }

    if (!mediaData.mimeType || typeof mediaData.mimeType !== 'string') {
      return false;
    }

    if (!mediaData.base64 || typeof mediaData.base64 !== 'string') {
      return false;
    }

    return true;
  }
}

export default MediaPreviewHandler;