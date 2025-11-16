import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync } from '../errorHandler.js';

/**
 * Storage Service
 * Centralized Chrome storage operations with error handling
 * Provides a consistent interface for all storage operations
 */
export class StorageService {
    constructor() {
        this.defaultOptions = {
            enableStreaming: false,
            theme: 'auto'
        };
    }

    /**
     * Get data from Chrome local storage
     * @param {string|Array|Object} keys - Keys to retrieve
     * @returns {Promise<any>} Retrieved data
     */
    async getLocal(keys) {
        return this.wrapStorageOperation('local', 'get', keys);
    }

    /**
     * Set data in Chrome local storage
     * @param {Object} items - Items to store
     * @returns {Promise<void>}
     */
    async setLocal(items) {
        return this.wrapStorageOperation('local', 'set', items);
    }

    /**
     * Remove data from Chrome local storage
     * @param {string|Array} keys - Keys to remove
     * @returns {Promise<void>}
     */
    async removeLocal(keys) {
        return this.wrapStorageOperation('local', 'remove', keys);
    }

    /**
     * Get data from Chrome sync storage
     * @param {string|Array|Object} keys - Keys to retrieve
     * @returns {Promise<any>} Retrieved data
     */
    async getSync(keys) {
        return this.wrapStorageOperation('sync', 'get', keys);
    }

    /**
     * Set data in Chrome sync storage
     * @param {Object} items - Items to store
     * @returns {Promise<void>}
     */
    async setSync(items) {
        return this.wrapStorageOperation('sync', 'set', items);
    }

    /**
     * Remove data from Chrome sync storage
     * @param {string|Array} keys - Keys to remove
     * @returns {Promise<void>}
     */
    async removeSync(keys) {
        return this.wrapStorageOperation('sync', 'remove', keys);
    }

    /**
     * Clear all data from Chrome local storage
     * @returns {Promise<void>}
     */
    async clearLocal() {
        return this.wrapStorageOperation('local', 'clear');
    }

    /**
     * Clear all data from Chrome sync storage
     * @returns {Promise<void>}
     */
    async clearSync() {
        return this.wrapStorageOperation('sync', 'clear');
    }

    /**
     * Wrap Chrome storage operations with error handling
     * @param {string} storageType - 'local' or 'sync'
     * @param {string} operation - Storage operation ('get', 'set', 'remove', 'clear')
     * @param {*} args - Operation arguments
     * @returns {Promise<any>} Operation result
     */
    async wrapStorageOperation(storageType, operation, args) {
        return await wrapAsync(async () => {
            const storage = storageType === 'sync' ? chrome.storage.sync : chrome.storage.local;

            return new Promise((resolve, reject) => {
                storage[operation](args, (result) => {
                    if (chrome.runtime.lastError) {
                        const error = createError(`Storage ${operation} failed: ${chrome.runtime.lastError.message}`, {
                            category: ErrorCategory.STORAGE,
                            severity: ErrorSeverity.MEDIUM,
                            context: { storageType, operation, args },
                            originalError: chrome.runtime.lastError
                        });
                        reject(error);
                        return;
                    }
                    resolve(result);
                });
            });
        }, {
            category: ErrorCategory.STORAGE,
            userMessage: `Failed to ${operation} data in ${storageType} storage`,
            retryable: true
        });
    }

    /**
     * Get user profiles
     * @returns {Promise<Array>} Array of user profiles
     */
    async getProfiles() {
        const result = await this.getLocal(['profiles']);
        return result.profiles || [];
    }

    /**
     * Save user profiles
     * @param {Array} profiles - Array of profiles
     * @returns {Promise<void>}
     */
    async saveProfiles(profiles) {
        return this.setLocal({ profiles });
    }

    /**
     * Get last selected profile ID
     * @returns {Promise<string>} Profile ID
     */
    async getLastSelectedProfileId() {
        const result = await this.getLocal(['lastSelectedProfileId']);
        return result.lastSelectedProfileId || 'default';
    }

    /**
     * Set last selected profile ID
     * @param {string} profileId - Profile ID
     * @returns {Promise<void>}
     */
    async setLastSelectedProfileId(profileId) {
        return this.setLocal({ lastSelectedProfileId: profileId });
    }

    /**
     * Get tool definitions
     * @returns {Promise<Array>} Array of tool definitions
     */
    async getToolDefinitions() {
        const result = await this.getLocal(['promptPaulTools']);
        return result.promptPaulTools || [];
    }

    /**
     * Save tool definitions
     * @param {Array} tools - Array of tool definitions
     * @returns {Promise<void>}
     */
    async saveToolDefinitions(tools) {
        return this.setLocal({ promptPaulTools: tools });
    }

    /**
     * Get custom instructions for images
     * @returns {Promise<Array>} Array of custom instructions
     */
    async getImageCustomInstructions() {
        const result = await this.getLocal(['imageCustomInstructions']);
        return result.imageCustomInstructions || [];
    }

    /**
     * Save custom instructions for images
     * @param {Array} instructions - Array of instructions
     * @returns {Promise<void>}
     */
    async saveImageCustomInstructions(instructions) {
        return this.setLocal({ imageCustomInstructions: instructions });
    }

    /**
     * Get general custom instructions
     * @returns {Promise<Array>} Array of custom instructions
     */
    async getGeneralCustomInstructions() {
        const result = await this.getLocal(['generalCustomInstructions']);
        return result.generalCustomInstructions || [];
    }

    /**
     * Save general custom instructions
     * @param {Array} instructions - Array of instructions
     * @returns {Promise<void>}
     */
    async saveGeneralCustomInstructions(instructions) {
        return this.setLocal({ generalCustomInstructions: instructions });
    }

    /**
     * Get user options/preferences
     * @returns {Promise<Object>} User options
     */
    async getOptions() {
        const result = await this.getSync(Object.keys(this.defaultOptions));
        return { ...this.defaultOptions, ...result };
    }

    /**
     * Save user options/preferences
     * @param {Object} options - User options
     * @returns {Promise<void>}
     */
    async saveOptions(options) {
        return this.setSync(options);
    }

    /**
     * Get streaming settings
     * @returns {Promise<boolean>} Whether streaming is enabled
     */
    async getStreamingEnabled() {
        const options = await this.getOptions();
        return options.enableStreaming;
    }

    /**
     * Set streaming enabled setting
     * @param {boolean} enabled - Whether streaming is enabled
     * @returns {Promise<void>}
     */
    async setStreamingEnabled(enabled) {
        return this.setSync({ enableStreaming: enabled });
    }

    /**
     * Get theme setting
     * @returns {Promise<string>} Current theme
     */
    async getTheme() {
        const options = await this.getOptions();
        return options.theme;
    }

    /**
     * Set theme
     * @param {string} theme - Theme to set
     * @returns {Promise<void>}
     */
    async setTheme(theme) {
        return this.setSync({ theme });
    }

    /**
     * Get default LLM endpoint
     * @returns {Promise<string>} Default LLM endpoint URL
     */
    async getDefaultLlmEndpoint() {
        const result = await this.getLocal(['defaultLlmEndpoint']);
        return result.defaultLlmEndpoint || '';
    }

    /**
     * Set default LLM endpoint
     * @param {string} endpoint - Default LLM endpoint URL
     * @returns {Promise<void>}
     */
    async setDefaultLlmEndpoint(endpoint) {
        return this.setLocal({ defaultLlmEndpoint: endpoint });
    }

    /**
     * Export all settings to JSON
     * @returns {Promise<Object>} All settings as JSON object
     */
    async exportSettings() {
        const [
            profiles,
            lastSelectedProfileId,
            tools,
            imageInstructions,
            generalInstructions,
            options,
            defaultEndpoint
        ] = await Promise.all([
            this.getProfiles(),
            this.getLastSelectedProfileId(),
            this.getToolDefinitions(),
            this.getImageCustomInstructions(),
            this.getGeneralCustomInstructions(),
            this.getOptions(),
            this.getDefaultLlmEndpoint()
        ]);

        return {
            profiles,
            lastSelectedProfileId,
            promptPaulTools: tools,
            imageCustomInstructions: imageInstructions,
            generalCustomInstructions: generalInstructions,
            options,
            defaultLlmEndpoint: defaultEndpoint,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
    }

    /**
     * Import settings from JSON object
     * @param {Object} settings - Settings object to import
     * @returns {Promise<void>}
     */
    async importSettings(settings) {
        const {
            profiles,
            lastSelectedProfileId,
            promptPaulTools,
            imageCustomInstructions,
            generalCustomInstructions,
            options,
            defaultLlmEndpoint
        } = settings;

        const operations = [];

        if (profiles) operations.push(this.saveProfiles(profiles));
        if (lastSelectedProfileId) operations.push(this.setLastSelectedProfileId(lastSelectedProfileId));
        if (promptPaulTools) operations.push(this.saveToolDefinitions(promptPaulTools));
        if (imageCustomInstructions) operations.push(this.saveImageCustomInstructions(imageCustomInstructions));
        if (generalCustomInstructions) operations.push(this.saveGeneralCustomInstructions(generalInstructions));
        if (options) operations.push(this.saveOptions(options));
        if (defaultLlmEndpoint) operations.push(this.setDefaultLlmEndpoint(defaultLlmEndpoint));

        return Promise.all(operations);
    }

    /**
     * Get storage usage information
     * @returns {Promise<Object>} Storage usage stats
     */
    async getStorageUsage() {
        try {
            // Chrome doesn't provide direct storage usage for extension storage
            // This is a basic implementation that could be enhanced
            const [localData, syncData] = await Promise.all([
                this.getLocal(null),
                this.getSync(null)
            ]);

            const localSize = JSON.stringify(localData).length;
            const syncSize = JSON.stringify(syncData).length;

            return {
                localSize,
                syncSize,
                totalSize: localSize + syncSize,
                localKeys: Object.keys(localData).length,
                syncKeys: Object.keys(syncData).length
            };
        } catch (error) {
            console.warn('Failed to get storage usage:', error);
            return {
                localSize: 0,
                syncSize: 0,
                totalSize: 0,
                localKeys: 0,
                syncKeys: 0
            };
        }
    }
}

// Export singleton instance
export const storageService = new StorageService();