/**
 * Settings Manager
 * Handles settings management for the options page
 * Implements production-ready coding rules for settings management
 *
 * Core Principles:
 * - Input Validation: Validate all settings data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient settings management with proper caching
 */

import { logger, validators } from '../shared/index.js';

class SettingsManager {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.validator = dependencies.Validator;
    
    // Settings manager configuration
    this.settings = {
      analyticsConsent: false,
      debugMode: false,
      autoSave: true,
      theme: 'light',
      language: 'en'
    };
    
    // Default settings
    this.defaultSettings = { ...this.settings };
  }

  /**
   * Initializes the settings manager
   */
  async initialize() {
    this.logger.debug('Initializing settings manager');

    try {
      // Load settings from storage
      await this.loadSettings();

      this.logger.debug('Settings manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize settings manager', {}, error);
      throw error;
    }
  }

  /**
   * Loads settings from storage
   */
  async loadSettings() {
    try {
      const result = await this.storage.get(['settings']);
      const storedSettings = result.settings || {};
      
      // Merge with defaults
      this.settings = { ...this.defaultSettings, ...storedSettings };

      this.logger.debug('Settings loaded from storage');
    } catch (error) {
      this.logger.error('Failed to load settings from storage', {}, error);
      throw error;
    }
  }

  /**
   * Saves settings to storage
   */
  async saveSettings() {
    try {
      await this.storage.set({ settings: this.settings });

      this.logger.debug('Settings saved to storage');
    } catch (error) {
      this.logger.error('Failed to save settings to storage', {}, error);
      throw error;
    }
  }

  /**
   * Gets all settings
   * @returns {Object} Settings object
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Gets a setting by key
   * @param {string} key - Setting key
   * @returns {any} Setting value or null if not found
   */
  getSetting(key) {
    if (!key || typeof key !== 'string') {
      return null;
    }

    return this.settings.hasOwnProperty(key) ? this.settings[key] : null;
  }

  /**
   * Updates settings
   * @param {Object} updates - Settings updates
   * @returns {boolean} True if updated, false if failed
   */
  async updateSettings(updates) {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Valid updates object is required');
    }

    this.logger.debug('Updating settings', { updates });

    try {
      // Validate updates
      const updatedSettings = { ...this.settings, ...updates };
      const validation = this.validator.validateSettings(updatedSettings);
      if (!validation.isValid) {
        throw new Error(`Invalid settings: ${Object.values(validation.errors).join(', ')}`);
      }

      // Apply updates
      Object.assign(this.settings, updates);

      // Save to storage
      await this.saveSettings();

      this.logger.debug('Settings updated successfully');

      return true;
    } catch (error) {
      this.logger.error('Failed to update settings', { updates }, error);
      throw error;
    }
  }

  /**
   * Updates a single setting
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   * @returns {boolean} True if updated, false if failed
   */
  async updateSetting(key, value) {
    if (!key || typeof key !== 'string') {
      throw new Error('Valid key is required and must be a string');
    }

    this.logger.debug('Updating setting', { key, value });

    try {
      // Validate setting
      const updatedSettings = { ...this.settings, [key]: value };
      const validation = this.validator.validateSettings(updatedSettings);
      if (!validation.isValid) {
        throw new Error(`Invalid setting ${key}: ${validation.errors[key] || 'Unknown error'}`);
      }

      // Apply update
      this.settings[key] = value;

      // Save to storage
      await this.saveSettings();

      this.logger.debug('Setting updated successfully', { key });

      return true;
    } catch (error) {
      this.logger.error('Failed to update setting', { key, value }, error);
      throw error;
    }
  }

  /**
   * Resets settings to defaults
   */
  async resetSettings() {
    this.logger.debug('Resetting settings to defaults');

    try {
      // Reset to defaults
      this.settings = { ...this.defaultSettings };

      // Save to storage
      await this.saveSettings();

      this.logger.debug('Settings reset to defaults successfully');
    } catch (error) {
      this.logger.error('Failed to reset settings', {}, error);
      throw error;
    }
  }

  /**
   * Resets a single setting to default
   * @param {string} key - Setting key
   * @returns {boolean} True if reset, false if not found
   */
  async resetSetting(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('Valid key is required and must be a string');
    }

    this.logger.debug('Resetting setting to default', { key });

    try {
      // Check if setting exists
      if (!this.defaultSettings.hasOwnProperty(key)) {
        return false;
      }

      // Reset to default
      this.settings[key] = this.defaultSettings[key];

      // Save to storage
      await this.saveSettings();

      this.logger.debug('Setting reset to default successfully', { key });

      return true;
    } catch (error) {
      this.logger.error('Failed to reset setting', { key }, error);
      throw error;
    }
  }

  /**
   * Exports settings
   * @returns {string} JSON string of settings
   */
  exportSettings() {
    this.logger.debug('Exporting settings');

    try {
      const exportData = {
        settings: this.settings,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      this.logger.error('Failed to export settings', {}, error);
      throw error;
    }
  }

  /**
   * Imports settings
   * @param {string} settingsJson - JSON string of settings
   * @returns {Object} Import result
   */
  async importSettings(settingsJson) {
    if (!settingsJson || typeof settingsJson !== 'string') {
      throw new Error('Valid settings JSON is required and must be a string');
    }

    this.logger.debug('Importing settings');

    try {
      const importData = JSON.parse(settingsJson);

      if (!importData.settings || typeof importData.settings !== 'object') {
        throw new Error('Invalid settings data format');
      }

      // Validate imported settings
      const validation = this.validator.validateSettings(importData.settings);
      if (!validation.isValid) {
        throw new Error(`Invalid settings: ${Object.values(validation.errors).join(', ')}`);
      }

      // Apply imported settings
      this.settings = { ...this.defaultSettings, ...importData.settings };

      // Save to storage
      await this.saveSettings();

      this.logger.debug('Settings imported successfully');

      return {
        imported: true,
        settingsCount: Object.keys(importData.settings).length
      };
    } catch (error) {
      this.logger.error('Failed to import settings', {}, error);
      throw error;
    }
  }

  /**
   * Validates settings
   * @param {Object} settings - Settings to validate
   * @returns {Object} Validation result
   */
  validateSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      return {
        isValid: false,
        errors: { general: 'Valid settings object is required' }
      };
    }

    try {
      return this.validator.validateSettings(settings);
    } catch (error) {
      this.logger.error('Failed to validate settings', {}, error);
      return {
        isValid: false,
        errors: { general: 'Validation error: ' + error.message }
      };
    }
  }

  /**
   * Gets analytics consent
   * @returns {boolean} Analytics consent
   */
  getAnalyticsConsent() {
    return this.settings.analyticsConsent || false;
  }

  /**
   * Sets analytics consent
   * @param {boolean} consent - Analytics consent
   */
  async setAnalyticsConsent(consent) {
    if (typeof consent !== 'boolean') {
      throw new Error('Analytics consent must be a boolean');
    }

    await this.updateSetting('analyticsConsent', consent);
  }

  /**
   * Gets debug mode
   * @returns {boolean} Debug mode
   */
  getDebugMode() {
    return this.settings.debugMode || false;
  }

  /**
   * Sets debug mode
   * @param {boolean} debugMode - Debug mode
   */
  async setDebugMode(debugMode) {
    if (typeof debugMode !== 'boolean') {
      throw new Error('Debug mode must be a boolean');
    }

    await this.updateSetting('debugMode', debugMode);
  }

  /**
   * Gets auto save
   * @returns {boolean} Auto save
   */
  getAutoSave() {
    return this.settings.autoSave !== false; // Default to true
  }

  /**
   * Sets auto save
   * @param {boolean} autoSave - Auto save
   */
  async setAutoSave(autoSave) {
    if (typeof autoSave !== 'boolean') {
      throw new Error('Auto save must be a boolean');
    }

    await this.updateSetting('autoSave', autoSave);
  }

  /**
   * Gets theme
   * @returns {string} Theme
   */
  getTheme() {
    return this.settings.theme || 'light';
  }

  /**
   * Sets theme
   * @param {string} theme - Theme
   */
  async setTheme(theme) {
    if (!theme || typeof theme !== 'string') {
      throw new Error('Theme is required and must be a string');
    }

    const validThemes = ['light', 'dark', 'auto'];
    if (!validThemes.includes(theme)) {
      throw new Error(`Theme must be one of: ${validThemes.join(', ')}`);
    }

    await this.updateSetting('theme', theme);
  }

  /**
   * Gets language
   * @returns {string} Language
   */
  getLanguage() {
    return this.settings.language || 'en';
  }

  /**
   * Sets language
   * @param {string} language - Language
   */
  async setLanguage(language) {
    if (!language || typeof language !== 'string') {
      throw new Error('Language is required and must be a string');
    }

    await this.updateSetting('language', language);
  }

  /**
   * Gets settings statistics
   * @returns {Object} Settings statistics
   */
  getStatistics() {
    return {
      totalSettings: Object.keys(this.settings).length,
      analyticsConsent: this.settings.analyticsConsent,
      debugMode: this.settings.debugMode,
      autoSave: this.settings.autoSave,
      theme: this.settings.theme,
      language: this.settings.language
    };
  }
}

export default SettingsManager;