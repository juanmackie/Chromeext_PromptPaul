import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} from '../errorHandler.js';
import { storageService } from '../services/storage-service.js';
import logger from '../utils/logger.js';

/**
 * Profile Manager
 * Handles profile CRUD operations, storage management, and profile switching
 * Manages configuration profiles for different API settings
 */
export class ProfileManager {
  constructor(showStatusCallback) {
    this.showStatus = showStatusCallback;

    // Default profile configuration
    this.defaultProfile = {
      id: 'default',
      name: 'Default',
      provider: 'custom',
      llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
      apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
      modelName: 'mistral-small-latest',
      maxTokens: 16000,
      systemPrompt: 'You are a helpful assistant.',
      lastUpdated: new Date().toLocaleString(),
    };
  }

  /**
   * Load all profiles from storage
   * @returns {Promise<Array>} Array of profiles
   */
  async loadProfiles() {
    return wrapAsync(
      async () => {
        logger.info('ProfileManager', 'Loading profiles...');

        const result = await storageService.getLocal(['profiles']);
        const profiles = result.profiles || [];

        // Ensure default profile exists
        if (!profiles.find(p => p.id === 'default')) {
          logger.info('ProfileManager', 'Default profile not found, creating it.');
          profiles.push(this.defaultProfile);
          await storageService.setLocal({ profiles });

          // Sync default profile to chrome.storage.sync for API client
          await storageService.setSync({
            apiKey: this.defaultProfile.apiKey,
            apiEndpoint: this.defaultProfile.llmEndpoint,
            modelName: this.defaultProfile.modelName,
            maxTokens: this.defaultProfile.maxTokens,
            systemPrompt: this.defaultProfile.systemPrompt,
          });

          logger.info('ProfileManager', 'Default profile created and synced:', this.defaultProfile);
        } else {
          logger.info('ProfileManager', 'Default profile already exists.');
        }

        logger.info('ProfileManager', 'Loaded profiles:', profiles);
        return profiles;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to load profiles',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Get the last selected profile ID
   * @returns {Promise<string>} Profile ID
   */
  async getLastSelectedProfileId() {
    return wrapAsync(
      async () => {
        const result = await storageService.getLocal(['lastSelectedProfileId']);
        return result.lastSelectedProfileId || 'default';
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to get selected profile',
        severity: ErrorSeverity.LOW,
      }
    );
  }

  /**
   * Set the last selected profile ID
   * @param {string} profileId - Profile ID to set as selected
   */
  async setLastSelectedProfileId(profileId) {
    return wrapAsync(
      async () => {
        await storageService.setLocal({ lastSelectedProfileId: profileId });
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to save selected profile',
        severity: ErrorSeverity.LOW,
      }
    );
  }

  /**
   * Get profile by ID
   * @param {string} profileId - Profile ID to retrieve
   * @returns {Promise<Object|null>} Profile object or null
   */
  async getProfile(profileId) {
    return wrapAsync(
      async () => {
        const profiles = await this.loadProfiles();
        return profiles.find(p => p.id === profileId) || null;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to get profile',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Save or update a profile
   * @param {Object} profileData - Profile data to save
   * @returns {Promise<Object>} Saved profile
   */
  async saveProfile(profileData) {
    return wrapAsync(
      async () => {
        const { id, name, provider, llmEndpoint, apiKey, modelName, maxTokens, systemPrompt } = profileData;

        logger.info('ProfileManager', 'Saving profile:', { id, name, provider, hasEndpoint: !!llmEndpoint });

        const profiles = await this.loadProfiles();
        let profileToUpdate = profiles.find(p => p.id === id);

        if (!profileToUpdate) {
          logger.info('ProfileManager', `Profile with ID '${id}' not found, creating new profile.`);
          profileToUpdate = {
            id,
            name: id === 'default' ? 'Default' : name || `Profile ${Date.now()}`,
            provider: provider || 'custom',
            llmEndpoint,
            apiKey,
            modelName,
            maxTokens,
            systemPrompt,
            lastUpdated: new Date().toLocaleString(),
          };
          profiles.push(profileToUpdate);
          logger.info('ProfileManager', 'New profile created:', profileToUpdate);
        } else {
          logger.info(
            'ProfileManager',
            `Profile with ID '${id}' found, updating existing profile.`
          );
          profileToUpdate.llmEndpoint = llmEndpoint;
          profileToUpdate.apiKey = apiKey;
          profileToUpdate.modelName = modelName;
          profileToUpdate.maxTokens = maxTokens;
          profileToUpdate.systemPrompt = systemPrompt;
          profileToUpdate.lastUpdated = new Date().toLocaleString();
          logger.info('ProfileManager', 'Profile updated:', profileToUpdate);
        }

        // Save to storage
        await storageService.setLocal({
          profiles: profiles,
          lastSelectedProfileId: id,
        });

        // Also sync to chrome.storage.sync for API client
        // The API client reads from sync storage, so we need to keep it updated
        await storageService.setSync({
          apiKey: profileToUpdate.apiKey,
          apiEndpoint: profileToUpdate.llmEndpoint,
          modelName: profileToUpdate.modelName,
          maxTokens: profileToUpdate.maxTokens,
          systemPrompt: profileToUpdate.systemPrompt,
        });

        logger.info(
          'ProfileManager',
          `Settings for profile '${profileToUpdate.name}' saved successfully and synced.`
        );
        this.showStatus(`Settings for profile '${profileToUpdate.name}' saved!`);

        return profileToUpdate;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to save profile',
        severity: ErrorSeverity.HIGH,
        context: { profileId: profileData.id, profileName: profileData.name },
      }
    );
  }

  /**
   * Create a new profile
   * @param {string} profileName - Name for the new profile
   * @param {Object} templateProfile - Template profile to copy from (optional)
   * @returns {Promise<Object>} Created profile
   */
  async createProfile(profileName, templateProfile = null) {
    return wrapAsync(
      async () => {
        const profiles = await this.loadProfiles();
        const newProfileId = `profile_${  Date.now()}`;

        const newProfile = {
          id: newProfileId,
          name: profileName.trim(),
          llmEndpoint: templateProfile?.llmEndpoint || this.defaultProfile.llmEndpoint,
          apiKey: templateProfile?.apiKey || this.defaultProfile.apiKey,
          modelName: templateProfile?.modelName || this.defaultProfile.modelName,
          maxTokens: templateProfile?.maxTokens || this.defaultProfile.maxTokens,
          systemPrompt: templateProfile?.systemPrompt || this.defaultProfile.systemPrompt,
          lastUpdated: new Date().toLocaleString(),
        };

        profiles.push(newProfile);
        await storageService.setLocal({
          profiles: profiles,
          lastSelectedProfileId: newProfileId,
        });

        this.showStatus(`Profile "${newProfile.name}" created successfully.`);
        return newProfile;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to create profile',
        severity: ErrorSeverity.MEDIUM,
        context: { profileName },
      }
    );
  }

  /**
   * Delete a profile
   * @param {string} profileId - Profile ID to delete
   * @returns {Promise<boolean>} True if profile was deleted
   */
  async deleteProfile(profileId) {
    return wrapAsync(
      async () => {
        if (profileId === 'default') {
          throw createError('The "Default" profile cannot be deleted.', {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            userMessage: 'Cannot delete default profile',
          });
        }

        const profiles = await this.loadProfiles();
        const profileToDelete = profiles.find(p => p.id === profileId);

        if (!profileToDelete) {
          throw createError('Profile not found', {
            category: ErrorCategory.NOT_FOUND,
            severity: ErrorSeverity.MEDIUM,
            userMessage: 'Profile not found',
          });
        }

        const updatedProfiles = profiles.filter(p => p.id !== profileId);
        await storageService.setLocal({
          profiles: updatedProfiles,
          lastSelectedProfileId: 'default',
        });

        this.showStatus(`Profile "${profileToDelete.name}" deleted successfully.`, false, true);
        return true;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to delete profile',
        severity: ErrorSeverity.MEDIUM,
        context: { profileId },
      }
    );
  }

  /**
   * Get profile names for dropdown
   * @returns {Promise<Array>} Array of {id, name} objects
   */
  async getProfileOptions() {
    return wrapAsync(
      async () => {
        const profiles = await this.loadProfiles();
        return profiles.map(profile => ({
          id: profile.id,
          name: profile.name,
        }));
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to get profile options',
        severity: ErrorSeverity.LOW,
      }
    );
  }

  /**
   * Validate profile data
   * @param {Object} profileData - Profile data to validate
   * @returns {Object} Validation result { isValid: boolean, errors: string[] }
   */
  validateProfileData(profileData) {
    const errors = [];

    if (!profileData.name || profileData.name.trim() === '') {
      errors.push('Profile name is required');
    }

    if (!profileData.llmEndpoint || profileData.llmEndpoint.trim() === '') {
      errors.push('API endpoint is required');
    } else {
      try {
        new URL(profileData.llmEndpoint);
      } catch (e) {
        errors.push('Please enter a valid URL for API endpoint');
      }
    }

    if (!profileData.apiKey || profileData.apiKey.trim() === '') {
      errors.push('API key is required');
    }

    if (!profileData.modelName || profileData.modelName.trim() === '') {
      errors.push('Model name is required');
    }

    const maxTokens = parseInt(profileData.maxTokens, 10);
    if (isNaN(maxTokens) || maxTokens < 1 || maxTokens > 100000) {
      errors.push('Max tokens must be a number between 1 and 100000');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Export profiles to JSON
   * @returns {Promise<Object>} Export data
   */
  async exportProfiles() {
    return wrapAsync(
      async () => {
        const profiles = await this.loadProfiles();
        const lastSelectedProfileId = await this.getLastSelectedProfileId();

        return {
          version: 1,
          profiles,
          lastSelectedProfileId,
          exportedAt: new Date().toISOString(),
        };
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to export profiles',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Import profiles from JSON
   * @param {Object} importData - Import data
   * @returns {Promise<Object>} Import result
   */
  async importProfiles(importData) {
    return wrapAsync(
      async () => {
        if (!importData.version || !Array.isArray(importData.profiles)) {
          throw createError('Invalid import file format', {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            userMessage: 'Invalid import file format',
          });
        }

        const existingProfiles = await this.loadProfiles();
        const importedProfiles = importData.profiles;
        let addedCount = 0;
        let updatedCount = 0;

        importedProfiles.forEach(importedProfile => {
          const existingIndex = existingProfiles.findIndex(p => p.id === importedProfile.id);
          if (existingIndex > -1) {
            // Update existing profile
            existingProfiles[existingIndex] = {
              ...existingProfiles[existingIndex],
              ...importedProfile,
              lastUpdated: new Date().toISOString(),
            };
            updatedCount++;
          } else {
            // Add new profile
            existingProfiles.push({
              ...importedProfile,
              id: importedProfile.id || `profile_${  Date.now()}`,
              createdAt: importedProfile.createdAt || new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
            });
            addedCount++;
          }
        });

        await storageService.setLocal({ profiles: existingProfiles });

        this.showStatus(
          `Profiles imported successfully! Added: ${addedCount}, Updated: ${updatedCount}`
        );

        return {
          added: addedCount,
          updated: updatedCount,
          total: existingProfiles.length,
        };
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to import profiles',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Get profile statistics
   * @returns {Promise<Object>} Profile statistics
   */
  async getProfileStats() {
    return wrapAsync(
      async () => {
        const profiles = await this.loadProfiles();
        const lastSelectedProfileId = await this.getLastSelectedProfileId();

        return {
          totalProfiles: profiles.length,
          selectedProfileId: lastSelectedProfileId,
          selectedProfileName:
            profiles.find(p => p.id === lastSelectedProfileId)?.name || 'Unknown',
          hasDefaultProfile: profiles.some(p => p.id === 'default'),
          customProfiles: profiles.filter(p => p.id !== 'default').length,
        };
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to get profile statistics',
        severity: ErrorSeverity.LOW,
      }
    );
  }
}
