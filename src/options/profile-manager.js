/**
 * Profile Manager
 * Handles profile management for the options page
 * Implements production-ready coding rules for profile management
 *
 * Core Principles:
 * - Input Validation: Validate all profile data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient profile management with proper caching
 */

import { logger, validators } from '../shared/index.js';

class ProfileManager {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.validator = dependencies.Validator;
    
    // Profile manager configuration
    this.profiles = [];
    this.currentProfileId = null;
    this.defaultProfileId = 'default';
  }

  /**
   * Initializes the profile manager
   */
  async initialize() {
    this.logger.debug('Initializing profile manager');

    try {
      // Load profiles from storage
      await this.loadProfiles();

      this.logger.debug('Profile manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize profile manager', {}, error);
      throw error;
    }
  }

  /**
   * Loads profiles from storage
   */
  async loadProfiles() {
    try {
      const result = await this.storage.get(['profiles', 'lastSelectedProfileId']);
      this.profiles = result.profiles || [];
      this.currentProfileId = result.lastSelectedProfileId || this.defaultProfileId;

      // Ensure default profile exists
      if (!this.profiles.find(p => p.id === this.defaultProfileId)) {
        await this.createDefaultProfile();
      }

      this.logger.debug(`Loaded ${this.profiles.length} profiles from storage`);
    } catch (error) {
      this.logger.error('Failed to load profiles from storage', {}, error);
      throw error;
    }
  }

  /**
   * Saves profiles to storage
   */
  async saveProfiles() {
    try {
      await this.storage.set({
        profiles: this.profiles,
        lastSelectedProfileId: this.currentProfileId
      });

      this.logger.debug(`Saved ${this.profiles.length} profiles to storage`);
    } catch (error) {
      this.logger.error('Failed to save profiles to storage', {}, error);
      throw error;
    }
  }

  /**
   * Creates a default profile
   */
  async createDefaultProfile() {
    this.logger.debug('Creating default profile');

    try {
      const defaultProfile = {
        id: this.defaultProfileId,
        name: 'Default Profile',
        llmEndpoint: '',
        apiKey: '',
        modelName: '',
        maxTokens: 2048,
        systemPrompt: '',
        isDefault: true
      };

      this.profiles.push(defaultProfile);
      this.currentProfileId = this.defaultProfileId;

      await this.saveProfiles();

      this.logger.debug('Default profile created successfully');
    } catch (error) {
      this.logger.error('Failed to create default profile', {}, error);
      throw error;
    }
  }

  /**
   * Gets all profiles
   * @returns {Array} Array of profiles
   */
  getProfiles() {
    return [...this.profiles];
  }

  /**
   * Gets a profile by ID
   * @param {string} profileId - Profile ID
   * @returns {Object|null} Profile object or null if not found
   */
  getProfile(profileId) {
    if (!profileId || typeof profileId !== 'string') {
      return null;
    }

    return this.profiles.find(p => p.id === profileId) || null;
  }

  /**
   * Gets the current profile
   * @returns {Object|null} Current profile object or null if not found
   */
  getCurrentProfile() {
    if (!this.currentProfileId) {
      return null;
    }

    return this.getProfile(this.currentProfileId);
  }

  /**
   * Creates a new profile
   * @param {Object} profileData - Profile data
   * @returns {string} Profile ID
   */
  async createProfile(profileData) {
    if (!profileData || typeof profileData !== 'object') {
      throw new Error('Valid profile data object is required');
    }

    this.logger.debug('Creating new profile');

    try {
      // Validate profile data
      const validation = this.validator.validateConfig(profileData);
      if (!validation.isValid) {
        throw new Error(`Invalid profile data: ${Object.values(validation.errors).join(', ')}`);
      }

      // Generate profile ID
      const profileId = 'profile_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // Create profile
      const profile = {
        id: profileId,
        name: profileData.name || 'New Profile',
        llmEndpoint: profileData.llmEndpoint || '',
        apiKey: profileData.apiKey || '',
        modelName: profileData.modelName || '',
        maxTokens: profileData.maxTokens || 2048,
        systemPrompt: profileData.systemPrompt || '',
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Add to profiles
      this.profiles.push(profile);

      // Save to storage
      await this.saveProfiles();

      this.logger.debug(`Profile created successfully: ${profileId}`);

      return profileId;
    } catch (error) {
      this.logger.error('Failed to create profile', {}, error);
      throw error;
    }
  }

  /**
   * Updates a profile
   * @param {string} profileId - Profile ID
   * @param {Object} updates - Profile updates
   * @returns {boolean} True if updated, false if not found
   */
  async updateProfile(profileId, updates) {
    if (!profileId || typeof profileId !== 'string') {
      throw new Error('Valid profile ID is required and must be a string');
    }

    if (!updates || typeof updates !== 'object') {
      throw new Error('Valid updates object is required');
    }

    this.logger.debug(`Updating profile: ${profileId}`);

    try {
      const profile = this.profiles.find(p => p.id === profileId);
      if (!profile) {
        return false;
      }

      // Validate updates
      const updatedProfile = { ...profile, ...updates };
      const validation = this.validator.validateConfig(updatedProfile);
      if (!validation.isValid) {
        throw new Error(`Invalid profile data: ${Object.values(validation.errors).join(', ')}`);
      }

      // Apply updates
      Object.assign(profile, updates);
      profile.updatedAt = new Date().toISOString();

      // Save to storage
      await this.saveProfiles();

      this.logger.debug(`Profile updated successfully: ${profileId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to update profile: ${profileId}`, {}, error);
      throw error;
    }
  }

  /**
   * Deletes a profile
   * @param {string} profileId - Profile ID
   * @returns {boolean} True if deleted, false if not found
   */
  async deleteProfile(profileId) {
    if (!profileId || typeof profileId !== 'string') {
      throw new Error('Valid profile ID is required and must be a string');
    }

    // Don't allow deletion of default profile
    if (profileId === this.defaultProfileId) {
      throw new Error('Cannot delete default profile');
    }

    this.logger.debug(`Deleting profile: ${profileId}`);

    try {
      const index = this.profiles.findIndex(p => p.id === profileId);
      if (index === -1) {
        return false;
      }

      // Remove from profiles
      this.profiles.splice(index, 1);

      // Update current profile if needed
      if (this.currentProfileId === profileId) {
        this.currentProfileId = this.defaultProfileId;
      }

      // Save to storage
      await this.saveProfiles();

      this.logger.debug(`Profile deleted successfully: ${profileId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to delete profile: ${profileId}`, {}, error);
      throw error;
    }
  }

  /**
   * Sets the current profile
   * @param {string} profileId - Profile ID
   * @returns {boolean} True if set, false if not found
   */
  async setCurrentProfile(profileId) {
    if (!profileId || typeof profileId !== 'string') {
      throw new Error('Valid profile ID is required and must be a string');
    }

    this.logger.debug(`Setting current profile: ${profileId}`);

    try {
      const profile = this.profiles.find(p => p.id === profileId);
      if (!profile) {
        return false;
      }

      this.currentProfileId = profileId;

      // Save to storage
      await this.saveProfiles();

      this.logger.debug(`Current profile set successfully: ${profileId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to set current profile: ${profileId}`, {}, error);
      throw error;
    }
  }

  /**
   * Duplicates a profile
   * @param {string} profileId - Profile ID to duplicate
   * @param {string} newName - New profile name
   * @returns {string} New profile ID
   */
  async duplicateProfile(profileId, newName) {
    if (!profileId || typeof profileId !== 'string') {
      throw new Error('Valid profile ID is required and must be a string');
    }

    if (!newName || typeof newName !== 'string') {
      throw new Error('Valid new name is required and must be a string');
    }

    this.logger.debug(`Duplicating profile: ${profileId}`);

    try {
      const profile = this.profiles.find(p => p.id === profileId);
      if (!profile) {
        throw new Error(`Profile not found: ${profileId}`);
      }

      // Create duplicate
      const duplicateProfileData = {
        name: newName,
        llmEndpoint: profile.llmEndpoint,
        apiKey: profile.apiKey,
        modelName: profile.modelName,
        maxTokens: profile.maxTokens,
        systemPrompt: profile.systemPrompt
      };

      const newProfileId = await this.createProfile(duplicateProfileData);

      this.logger.debug(`Profile duplicated successfully: ${profileId} -> ${newProfileId}`);

      return newProfileId;
    } catch (error) {
      this.logger.error(`Failed to duplicate profile: ${profileId}`, {}, error);
      throw error;
    }
  }

  /**
   * Exports profiles
   * @returns {string} JSON string of profiles
   */
  exportProfiles() {
    this.logger.debug('Exporting profiles');

    try {
      const exportData = {
        profiles: this.profiles,
        currentProfileId: this.currentProfileId,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      this.logger.error('Failed to export profiles', {}, error);
      throw error;
    }
  }

  /**
   * Imports profiles
   * @param {string} profilesJson - JSON string of profiles
   * @returns {Object} Import result
   */
  async importProfiles(profilesJson) {
    if (!profilesJson || typeof profilesJson !== 'string') {
      throw new Error('Valid profiles JSON is required and must be a string');
    }

    this.logger.debug('Importing profiles');

    try {
      const importData = JSON.parse(profilesJson);

      if (!importData.profiles || !Array.isArray(importData.profiles)) {
        throw new Error('Invalid profiles data format');
      }

      // Validate imported profiles
      const validProfiles = [];
      for (const profile of importData.profiles) {
        const validation = this.validator.validateConfig(profile);
        if (validation.isValid) {
          // Generate new ID to avoid conflicts
          const newProfile = {
            ...profile,
            id: 'profile_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            isDefault: false,
            importedAt: new Date().toISOString()
          };
          validProfiles.push(newProfile);
        } else {
          this.logger.warn('Skipping invalid profile during import', {
            name: profile.name,
            errors: validation.errors
          });
        }
      }

      // Add valid profiles
      this.profiles.push(...validProfiles);

      // Save to storage
      await this.saveProfiles();

      this.logger.debug(`Profiles imported successfully: ${validProfiles.length}/${importData.profiles.length}`);

      return {
        imported: validProfiles.length,
        total: importData.profiles.length,
        skipped: importData.profiles.length - validProfiles.length
      };
    } catch (error) {
      this.logger.error('Failed to import profiles', {}, error);
      throw error;
    }
  }

  /**
   * Validates a profile
   * @param {Object} profile - Profile to validate
   * @returns {Object} Validation result
   */
  validateProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return {
        isValid: false,
        errors: { general: 'Valid profile object is required' }
      };
    }

    try {
      return this.validator.validateConfig(profile);
    } catch (error) {
      this.logger.error('Failed to validate profile', {}, error);
      return {
        isValid: false,
        errors: { general: 'Validation error: ' + error.message }
      };
    }
  }

  /**
   * Gets profile statistics
   * @returns {Object} Profile statistics
   */
  getStatistics() {
    return {
      totalProfiles: this.profiles.length,
      currentProfileId: this.currentProfileId,
      defaultProfileId: this.defaultProfileId,
      hasDefaultProfile: !!this.profiles.find(p => p.id === this.defaultProfileId)
    };
  }
}

export default ProfileManager;