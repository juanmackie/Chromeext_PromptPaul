import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync, handleChromeApiCall } from '../errorHandler.js';

/**
 * Configuration Validator
 * Handles validation and management of extension configuration
 * Manages profiles, API settings, and ensures valid configuration
 */
export class ConfigValidator {
    constructor() {
        this.defaultProfile = {
            id: 'default',
            name: 'Default',
            llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
            apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
            modelName: 'mistral-small-latest',
            maxTokens: 16000,
            systemPrompt: 'You are a helpful, knowledgeable, and friendly AI assistant. Provide clear, accurate, and concise responses while being respectful and professional.',
            lastUpdated: new Date().toLocaleString()
        };
    }

    /**
     * Validate and return a valid configuration profile
     * @returns {Promise<Object>} Valid configuration profile
     */
    async validateConfig() {
        return await wrapAsync(async () => {
            console.log('Background: Validating configuration...');

            let result;
            try {
                result = await handleChromeApiCall((callback) =>
                    chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], callback)
                );
            } catch (error) {
                throw createError('Failed to access configuration storage', {
                    category: ErrorCategory.STORAGE,
                    severity: ErrorSeverity.CRITICAL,
                    retryable: true,
                    originalError: error
                });
            }

            // Defensive check - ensure result is always an object
            if (!result || typeof result !== 'object') {
                console.warn('Configuration storage returned unexpected result, using defaults:', result);
                result = {};
            }

            const profiles = result.profiles || [];
            const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
            const defaultLlmEndpoint = result.defaultLlmEndpoint || '';

            // Ensure we have at least a default profile
            const ensuredProfiles = await this.ensureDefaultProfile(profiles);

            // Find and validate profile
            const validProfile = this.findValidProfile(ensuredProfiles, lastSelectedProfileId, defaultLlmEndpoint);

            if (validProfile) {
                console.log(`Background: Using configuration from profile: ${validProfile.name || validProfile.id}`);
                return validProfile;
            }

            // Handle errors with specific error types
            this.handleConfigurationError(defaultLlmEndpoint, ensuredProfiles);

        }, {
            category: ErrorCategory.CONFIGURATION,
            userMessage: 'Failed to validate extension configuration',
            critical: true
        });
    }

    /**
     * Ensure default profile exists
     * @param {Array} profiles - Existing profiles
     * @returns {Promise<Array>} Updated profiles array
     */
    async ensureDefaultProfile(profiles) {
        if (profiles.length === 0 || !profiles.find(p => p.id === 'default')) {
            console.warn('No default profile found, creating one');

            const newDefaultProfile = { ...this.defaultProfile };
            newDefaultProfile.lastUpdated = new Date().toLocaleString();

            // Add default profile to array
            const updatedProfiles = profiles.length === 0 ?
                [newDefaultProfile] :
                [newDefaultProfile, ...profiles];

            // Try to save the default profile
            try {
                await chrome.storage.local.set({
                    profiles: updatedProfiles,
                    lastSelectedProfileId: 'default'
                });
                console.log('Default profile created and saved');
            } catch (saveError) {
                console.error('Failed to save default profile:', saveError);
            }

            return updatedProfiles;
        }

        return profiles;
    }

    /**
     * Find a valid profile based on priority order
     * @param {Array} profiles - Available profiles
     * @param {string} lastSelectedProfileId - Last selected profile ID
     * @param {string} defaultLlmEndpoint - Default LLM endpoint
     * @returns {Object|null} Valid profile or null
     */
    findValidProfile(profiles, lastSelectedProfileId, defaultLlmEndpoint) {
        const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
        const defaultProfile = profiles.find(p => p.id === 'default');

        // Validate profile with optional endpoint override
        const validateProfile = (profile, endpointOverride = null) => {
            const endpoint = endpointOverride || profile?.llmEndpoint;
            return endpoint && this.isValidURL(endpoint) && profile?.apiKey && profile?.modelName;
        };

        // Check profiles in priority order
        if (validateProfile(selectedProfile)) {
            return selectedProfile;
        } else if (validateProfile(selectedProfile, defaultLlmEndpoint)) {
            return { ...selectedProfile, llmEndpoint: defaultLlmEndpoint };
        } else if (validateProfile(defaultProfile)) {
            return defaultProfile;
        } else if (validateProfile(defaultProfile, defaultLlmEndpoint)) {
            return { ...defaultProfile, llmEndpoint: defaultLlmEndpoint };
        }

        return null;
    }

    /**
     * Handle configuration validation errors
     * @param {string} defaultLlmEndpoint - Default LLM endpoint
     * @param {Array} profiles - Available profiles
     */
    handleConfigurationError(defaultLlmEndpoint, profiles) {
        const hasEndpoint = defaultLlmEndpoint && this.isValidURL(defaultLlmEndpoint);
        const hasValidProfile = profiles.length > 0;

        if (!hasEndpoint) {
            throw createError('LLM API endpoint is missing or invalid. Please configure it in the options page.', {
                category: ErrorCategory.CONFIGURATION,
                severity: ErrorSeverity.CRITICAL,
                code: 'MISSING_ENDPOINT',
                context: { defaultLlmEndpoint, hasValidProfile }
            });
        } else if (!hasValidProfile) {
            throw createError('No valid profiles found. Please create a profile in the options page.', {
                category: ErrorCategory.CONFIGURATION,
                severity: ErrorSeverity.CRITICAL,
                code: 'NO_VALID_PROFILES',
                context: { profilesCount: profiles.length, hasEndpoint }
            });
        } else {
            throw createError('Configuration is incomplete. Please set API key and model name in the options page.', {
                category: ErrorCategory.CONFIGURATION,
                severity: ErrorSeverity.CRITICAL,
                code: 'INCOMPLETE_CONFIG',
                context: { hasEndpoint, hasValidProfile }
            });
        }
    }

    /**
     * Get all tool definitions from storage
     * @returns {Promise<Array>} Array of tool definitions
     */
    async getAllToolDefinitions() {
        return await wrapAsync(async () => {
            const localTools = await new Promise((resolve, reject) => {
                chrome.storage.local.get(['promptPaulTools'], (result) => {
                    if (chrome.runtime.lastError) {
                        reject(createError('Failed to access tool definitions from storage', {
                            category: ErrorCategory.STORAGE,
                            severity: ErrorSeverity.MEDIUM,
                            context: { error: chrome.runtime.lastError.message }
                        }));
                        return;
                    }
                    resolve(result.promptPaulTools || []);
                });
            });
            return localTools;
        }, {
            category: ErrorCategory.STORAGE,
            userMessage: 'Failed to load tool definitions',
            severity: ErrorSeverity.MEDIUM
        }).catch(error => {
            console.warn('Failed to load tool definitions, using empty array:', error);
            return [];
        });
    }

    /**
     * Get a single tool definition by name
     * @param {string} name - Tool name
     * @returns {Promise<Object|null>} Tool definition or null
     */
    async getToolDefinition(name) {
        return await wrapAsync(async () => {
            return await new Promise((resolve, reject) => {
                chrome.storage.local.get(['promptPaulTools'], (result) => {
                    if (chrome.runtime.lastError) {
                        reject(createError('Failed to access tool definition from storage', {
                            category: ErrorCategory.STORAGE,
                            severity: ErrorSeverity.MEDIUM,
                            context: { toolName: name, error: chrome.runtime.lastError.message }
                        }));
                        return;
                    }
                    const toolsArray = result.promptPaulTools || [];
                    const tool = toolsArray.find(t => t.name === name);
                    resolve(tool);
                });
            });
        }, {
            category: ErrorCategory.STORAGE,
            userMessage: 'Failed to load tool definition',
            severity: ErrorSeverity.MEDIUM
        }).catch(error => {
            console.warn(`Failed to load tool definition for '${name}':`, error);
            return null;
        });
    }

    /**
     * Validate if URL is properly formatted
     * @param {string} url - URL to validate
     * @returns {boolean} True if valid URL
     */
    isValidURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate API key format
     * @param {string} apiKey - API key to validate
     * @returns {boolean} True if valid format
     */
    isValidApiKey(apiKey) {
        return apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0;
    }

    /**
     * Validate model name
     * @param {string} modelName - Model name to validate
     * @returns {boolean} True if valid
     */
    isValidModelName(modelName) {
        return modelName && typeof modelName === 'string' && modelName.trim().length > 0;
    }

    /**
     * Validate max tokens value
     * @param {number|string} maxTokens - Max tokens to validate
     * @returns {boolean} True if valid
     */
    isValidMaxTokens(maxTokens) {
        const tokens = parseInt(maxTokens);
        return !isNaN(tokens) && tokens > 0 && tokens <= 100000;
    }

    /**
     * Create a new profile with validation
     * @param {Object} profileData - Profile data
     * @returns {Promise<Object>} Created profile
     */
    async createProfile(profileData) {
        const profile = {
            id: profileData.id || this.generateId(),
            name: profileData.name || 'New Profile',
            llmEndpoint: profileData.llmEndpoint || '',
            apiKey: profileData.apiKey || '',
            modelName: profileData.modelName || '',
            maxTokens: profileData.maxTokens || 2048,
            systemPrompt: profileData.systemPrompt || '',
            lastUpdated: new Date().toLocaleString()
        };

        // Validate profile
        this.validateProfileData(profile);

        return profile;
    }

    /**
     * Validate profile data
     * @param {Object} profile - Profile to validate
     * @throws {Error} If validation fails
     */
    validateProfileData(profile) {
        if (!profile.name || profile.name.trim().length === 0) {
            throw createError('Profile name is required', {
                category: ErrorCategory.VALIDATION,
                severity: ErrorSeverity.MEDIUM
            });
        }

        if (!this.isValidURL(profile.llmEndpoint)) {
            throw createError('Invalid LLM endpoint URL', {
                category: ErrorCategory.VALIDATION,
                severity: ErrorSeverity.HIGH
            });
        }

        if (!this.isValidApiKey(profile.apiKey)) {
            throw createError('API key is required', {
                category: ErrorCategory.VALIDATION,
                severity: ErrorSeverity.HIGH
            });
        }

        if (!this.isValidModelName(profile.modelName)) {
            throw createError('Model name is required', {
                category: ErrorCategory.VALIDATION,
                severity: ErrorSeverity.MEDIUM
            });
        }

        if (!this.isValidMaxTokens(profile.maxTokens)) {
            throw createError('Max tokens must be a positive number', {
                category: ErrorCategory.VALIDATION,
                severity: ErrorSeverity.MEDIUM
            });
        }
    }

    /**
     * Generate a unique ID
     * @returns {string} Unique ID
     */
    generateId() {
        return 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Save profile to storage
     * @param {Object} profile - Profile to save
     * @returns {Promise<void>}
     */
    async saveProfile(profile) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['profiles'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                const profiles = result.profiles || [];
                const existingIndex = profiles.findIndex(p => p.id === profile.id);

                if (existingIndex >= 0) {
                    profiles[existingIndex] = profile;
                } else {
                    profiles.push(profile);
                }

                chrome.storage.local.set({ profiles }, () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * Delete profile from storage
     * @param {string} profileId - Profile ID to delete
     * @returns {Promise<void>}
     */
    async deleteProfile(profileId) {
        if (profileId === 'default') {
            throw new Error('Cannot delete default profile');
        }

        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                const profiles = (result.profiles || []).filter(p => p.id !== profileId);
                let lastSelectedProfileId = result.lastSelectedProfileId;

                // If deleted profile was selected, switch to default
                if (lastSelectedProfileId === profileId) {
                    lastSelectedProfileId = 'default';
                }

                chrome.storage.local.set({
                    profiles,
                    lastSelectedProfileId
                }, () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }
}

// Export singleton instance
export const configValidator = new ConfigValidator();