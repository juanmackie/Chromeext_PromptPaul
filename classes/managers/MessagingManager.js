import { BaseManager } from './BaseManager.js';

/**
 * Manages messaging between different parts of the extension.
 */
export class MessagingManager extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Sends a message to the side panel, retrying if the connection fails.
   * This is to handle cases where the side panel is not yet ready to receive messages.
   * @param {Object} message - The message to send.
   * @param {number} retries - The number of retries.
   * @param {number} delay - The delay between retries in milliseconds.
   */
  async sendMessageToSidePanel(message, retries = 3, delay = 250) {
    for (let i = 0; i < retries; i++) {
      try {
        await this.sendMessage(message);
        console.log("Successfully sent message to side panel:", message.action);
        return;
      } catch (error) {
        if (error.message.includes("Could not establish connection. Receiving end does not exist.") && i < retries - 1) {
          console.warn(`Could not connect to side panel. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`Failed to send message to side panel after ${i + 1} attempts:`, error);
          throw error;
        }
      }
    }
  }

  /**
   * Send a message using proper callback handling
   * @param {Object} message - The message to send
   * @returns {Promise} - Promise that resolves/rejects based on message success
   */
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }
}
