import logger from './logger.js';

/**
 * Sends a message to the Chrome runtime with exponential backoff retry logic.
 * This is useful for handling race conditions where the receiving end (e.g., side panel)
 * might not be ready immediately.
 *
 * @param {Object} message - The message to send.
 * @param {number} [maxRetries=5] - Maximum number of retry attempts.
 * @param {number} [baseDelay=750] - Base delay in milliseconds for exponential backoff.
 * @returns {Promise<any>} - Resolves with the response if successful.
 * @throws {Error} - Throws if all retries fail.
 */
export async function sendMessageWithRetry(message, maxRetries = 5, baseDelay = 750) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Wrap chrome.runtime.sendMessage in a Promise to handle both sync and async errors
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(message, (res) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(res);
                    }
                });
            });

            logger.info('MessageUtils', `Message sent successfully: ${message.action}`);
            return response;
        } catch (error) {
            const isLastAttempt = i === maxRetries - 1;

            // Check if it's the specific error we're looking for (connection not established)
            // This error usually means the receiving end hasn't added a listener yet.
            if (error.message && (
                error.message.includes('Receiving end does not exist') ||
                error.message.includes('Could not establish connection')
            )) {

                if (isLastAttempt) {
                    logger.error('MessageUtils', `Failed to send message after ${maxRetries} attempts:`, error);
                    throw error;
                }

                // Exponential backoff
                const delay = baseDelay * Math.pow(1.5, i);
                logger.debug('MessageUtils', `Retry ${i + 1}/${maxRetries} for message ${message.action} in ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // For other errors (invalid arguments, etc.), log and rethrow immediately
                // unless we want to retry on ALL errors? stick to connection errors for now.
                logger.error('MessageUtils', 'Error sending message:', error);
                throw error;
            }
        }
    }
}
