/**
 * Common type definitions for the Chrome extension
 * @fileoverview Shared types used across the extension
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} role - The role of the message sender ('user', 'assistant', 'system')
 * @property {string} content - The content of the message
 * @property {number} [timestamp] - Unix timestamp when the message was created
 * @property {Object} [metadata] - Additional metadata for the message
 */

/**
 * @typedef {Object} Conversation
 * @property {string} id - Unique identifier for the conversation
 * @property {ChatMessage[]} messages - Array of messages in the conversation
 * @property {string} [title] - Optional title for the conversation
 * @property {number} createdAt - Unix timestamp when conversation was created
 * @property {number} [updatedAt] - Unix timestamp when conversation was last updated
 */

/**
 * @typedef {Object} InstructionProfile
 * @property {string} id - Unique identifier for the profile
 * @property {string} name - Display name for the profile
 * @property {string} instruction - The instruction text
 * @property {boolean} [isActive] - Whether the profile is currently active
 * @property {string[]} [domains] - List of domains where this profile applies
 * @property {number} createdAt - Unix timestamp when profile was created
 */

/**
 * @typedef {Object} StorageData
 * @property {Conversation[]} [conversations] - Array of saved conversations
 * @property {InstructionProfile[]} [profiles] - Array of instruction profiles
 * @property {Object} [settings] - Extension settings
 * @property {string} [settings.defaultModel] - Default AI model to use
 * @property {boolean} [settings.autoSave] - Whether to auto-save conversations
 * @property {boolean} [settings.darkMode] - Whether dark mode is enabled
 */

/**
 * @typedef {Object} ApiRequest
 * @property {string} endpoint - The API endpoint to call
 * @property {Object} [data] - Request payload data
 * @property {Object} [headers] - Additional headers for the request
 * @property {string} [method] - HTTP method (GET, POST, etc.)
 */

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Whether the request was successful
 * @property {any} [data] - Response data
 * @property {string} [error] - Error message if request failed
 * @property {number} [status] - HTTP status code
 */

/**
 * @typedef {Object} ContentExtractionResult
 * @property {boolean} success - Whether extraction was successful
 * @property {string} [text] - Extracted text content
 * @property {string} [url] - URL of the page
 * @property {string} [title] - Title of the page
 * @property {string} [error] - Error message if extraction failed
 */

/**
 * @typedef {Object} MediaProcessingOptions
 * @property {number} [maxSize] - Maximum size in bytes
 * @property {string[]} [allowedTypes] - Array of allowed MIME types
 * @property {boolean} [compress] - Whether to compress the media
 * @property {number} [quality] - Quality setting (0-1)
 */

/**
 * @typedef {Object} ChromeRuntimeMessage
 * @property {string} action - The action to perform
 * @property {any} [data] - Message payload
 * @property {string} [tabId] - ID of the sending tab
 * @property {(response?: any) => void} [sendResponse] - Response callback
 */

/**
 * @typedef {Object} ErrorInfo
 * @property {string} message - Error message
 * @property {string} [stack] - Error stack trace
 * @property {number} [code] - Error code
 * @property {string} [source] - Source of the error
 */

/**
 * @typedef {Object} StreamingChunk
 * @property {string} content - Partial content chunk
 * @property {boolean} [isComplete] - Whether streaming is complete
 * @property {string} [messageId] - ID of the message being streamed
 */
