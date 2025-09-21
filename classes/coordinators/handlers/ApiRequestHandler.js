import { BaseManager } from '../../managers/BaseManager.js';

/**
 * API Request Handler for managing streaming and non-streaming API requests
 * Handles the communication with LLM APIs
 */
export class ApiRequestHandler extends BaseManager {
  constructor() {
    super();
    this.currentAbortController = null;
  }

  /**
   * Make a streaming request to the API
   * @param {Object} config - API configuration
   * @param {Object} fetchHeaders - Request headers
   * @param {Object} requestBody - Request body
   * @param {Function} onChunk - Callback for streaming chunks
   */
  async makeStreamingRequest(config, fetchHeaders, requestBody, onChunk) {
    this.currentAbortController = new AbortController();
    
    try {
      const apiResponse = await fetch(config.llmEndpoint, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(requestBody),
        signal: this.currentAbortController.signal
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error('API Error Response:', errorText);
        throw new Error(`API request failed with status ${apiResponse.status}: ${errorText}`);
      }

      const reader = apiResponse.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        sseBuffer += decoder.decode(value, { stream: true });

        let eventEndIndex;
        while ((eventEndIndex = sseBuffer.indexOf('\n\n')) >= 0) {
          const eventString = sseBuffer.slice(0, eventEndIndex).trim();
          sseBuffer = sseBuffer.slice(eventEndIndex + 2);

          if (eventString.startsWith('data:')) {
            const dataString = eventString.slice(5).trim();
            
            // Check for [DONE] token before attempting JSON parse
            if (dataString === '[DONE]') {
              return;
            }
            
            try {
              const jsonData = JSON.parse(dataString);
              if (jsonData) {
                const parsed = jsonData;
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                  const content = parsed.choices[0].delta.content;
                  onChunk(content);
                }
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', dataString, parseError);
            }
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Streaming request was aborted');
        return;
      }
      console.error('Streaming request failed:', error);
      throw error;
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * Make a non-streaming request to the API
   * @param {Object} config - API configuration
   * @param {Object} fetchHeaders - Request headers
   * @param {Object} requestBody - Request body
   * @returns {Object} - API response
   */
  async makeNonStreamingRequest(config, fetchHeaders, requestBody) {
    this.currentAbortController = new AbortController();
    
    try {
      const apiResponse = await fetch(config.llmEndpoint, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(requestBody),
        signal: this.currentAbortController.signal
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error('API Error Response:', errorText);
        throw new Error(`API request failed with status ${apiResponse.status}: ${errorText}`);
      }

      const responseData = await apiResponse.json();

      if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
        throw new Error('Invalid API response format');
      }

      return responseData;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
        return null;
      }
      console.error('Non-streaming request failed:', error);
      throw error;
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * Abort the current request
   */
  abortRequest() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * Check if a request is currently in progress
   * @returns {Boolean}
   */
  isRequestInProgress() {
    return this.currentAbortController !== null;
  }
}