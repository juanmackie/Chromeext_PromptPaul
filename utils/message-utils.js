import logger from './logger.js';

// Connection state tracking
const connectionState = {
    isChatReady: false,
    isBackgroundReady: true,
    lastPingTime: 0,
    connectionAttempts: 0
};

/**
 * Checks if the receiving end is likely ready to receive messages
 * @returns {boolean} True if connection is likely ready
 */
function isConnectionLikelyReady() {
    // If chat has marked itself as ready, we're good
    if (connectionState.isChatReady) {
        return true;
    }
    
    // If it's been more than 2 seconds since last successful message, assume ready
    const timeSinceLastPing = Date.now() - connectionState.lastPingTime;
    if (timeSinceLastPing > 2000 && connectionState.connectionAttempts === 0) {
        return true;
    }
    
    return false;
}

/**
 * Sends a message to the Chrome runtime with exponential backoff retry logic.
 * This is useful for handling race conditions where the receiving end (e.g., side panel)
 * might not be ready immediately.
 *
 * @param {Object} message - The message to send.
 * @param {number} [maxRetries=5] - Maximum number of retry attempts.
 * @param {number} [baseDelay=750] - Base delay in milliseconds for exponential backoff.
 * @param {boolean} [skipConnectionCheck=false] - Skip connection readiness check
 * @returns {Promise<any>} - Resolves with the response if successful.
 * @throws {Error} - Throws if all retries fail.
 */
export async function sendMessageWithRetry(message, maxRetries = 5, baseDelay = 750, skipConnectionCheck = false) {
    connectionState.connectionAttempts++;
    
    // For certain message types, we should check if the receiver is ready
    if (!skipConnectionCheck && !isConnectionLikelyReady()) {
        const actionsNeedingReady = ['streamApiStart', 'streamApiResponseChunk', 'streamApiEnd', 'setApiResponse'];
        if (actionsNeedingReady.includes(message.action)) {
            logger.debug('MessageUtils', `Delaying ${message.action} - receiver may not be ready`);
            // Add extra delay for streaming messages when receiver isn't ready
            await new Promise(resolve => setTimeout(resolve, baseDelay));
        }
    }
    
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

            // Mark successful connection
            connectionState.lastPingTime = Date.now();
            connectionState.connectionAttempts = 0;
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

                // Exponential backoff with jitter
                const baseDelayMs = baseDelay * Math.pow(1.5, i);
                const jitter = Math.random() * 200; // Add up to 200ms jitter
                const delay = baseDelayMs + jitter;
                
                logger.debug('MessageUtils', `Retry ${i + 1}/${maxRetries} for message ${message.action} in ${Math.round(delay)}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // For other errors (invalid arguments, etc.), log and rethrow immediately
                logger.error('MessageUtils', 'Error sending message:', error);
                throw error;
            }
        }
    }
}

/**
 * Mark the chat interface as ready to receive messages
 */
export function markChatReady() {
    connectionState.isChatReady = true;
    logger.info('MessageUtils', 'Chat interface marked as ready');
}

/**
 * Mark the chat interface as not ready
 */
export function markChatNotReady() {
    connectionState.isChatReady = false;
    logger.info('MessageUtils', 'Chat interface marked as not ready');
}

/**
 * Get current connection state
 * @returns {Object} Current connection state
 */
export function getConnectionState() {
    return { ...connectionState };
}
