import { BaseManager } from './BaseManager.js';

/**
 * Configuration Manager handling all configuration-related operations
 * Implements the Manager pattern for business logic separation
 */
export class ConfigManager extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Initialize configuration with default values
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Check if profiles exist
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });

      const profiles = result.profiles || [];
      const defaultProfile = profiles.find(p => p.id === 'default');

      // If no default profile exists, create one with preset values
      if (!defaultProfile) {
        const newDefaultProfile = {
          id: 'default',
          name: 'Default',
          llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
          apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
          modelName: 'mistral-small-latest',
          maxTokens: 16000,
          systemPrompt: '',
          lastUpdated: new Date().toLocaleString()
        };

        profiles.push(newDefaultProfile);

        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ 
            profiles: profiles, 
            lastSelectedProfileId: 'default' 
          }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });

        console.log('ConfigManager: Default profile created with preset values');
      } else {
        console.log('ConfigManager: Default profile already exists');
      }
    } catch (error) {
      console.error('ConfigManager: Error during initialization:', error);
    }
  }

  /**
   * Validate API configuration
   * @param {Object} config - Configuration object to validate
   * @returns {Boolean} - Whether configuration is valid
   */
  validateConfig(config) {
    if (!super.validateConfig(config)) {
      return false;
    }
    
    return config.llmEndpoint && 
           config.apiKey && 
           config.modelName &&
           this.isValidURL(config.llmEndpoint);
  }

  /**
   * Check if a string is a valid URL
   * @param {String} string - String to check
   * @returns {Boolean} - Whether string is a valid URL
   */
  isValidURL(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Get configuration from storage
   * @returns {Promise<Object>} - Configuration object
   */
  async getConfig() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        const profiles = result.profiles || [];
        const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
        const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId) || 
                               profiles.find(p => p.id === 'default');
        
        if (selectedProfile) {
          resolve(selectedProfile);
        } else {
          // Fallback to sync storage if profile not found
          chrome.storage.sync.get({
            llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
            apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
            modelName: 'mistral-small-latest',
            maxTokens: 16000,
            systemPrompt: '',
            lastUpdated: ''
          }, (items) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve({
                llmEndpoint: items.llmEndpoint,
                apiKey: items.apiKey,
                modelName: items.modelName,
                maxTokens: items.maxTokens,
                systemPrompt: items.systemPrompt,
                lastUpdated: items.lastUpdated
              });
            }
          });
        }
      });
    });
  }

  /**
   * Save configuration to storage
   * @param {Object} config - Configuration to save
   * @returns {Promise<void>}
   */
  async saveConfig(config) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        let profiles = result.profiles || [];
        const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
        let profileToUpdate = profiles.find(p => p.id === lastSelectedProfileId);

        if (!profileToUpdate) {
          profileToUpdate = {
            id: lastSelectedProfileId,
            name: lastSelectedProfileId === 'default' ? 'Default' : 'New Profile ' + Date.now(),
            llmEndpoint: config.llmEndpoint,
            apiKey: config.apiKey,
            modelName: config.modelName,
            maxTokens: config.maxTokens || 2048,
            systemPrompt: config.systemPrompt,
            lastUpdated: new Date().toLocaleString()
          };
          profiles.push(profileToUpdate);
        } else {
          profileToUpdate.llmEndpoint = config.llmEndpoint;
          profileToUpdate.apiKey = config.apiKey;
          profileToUpdate.modelName = config.modelName;
          profileToUpdate.maxTokens = config.maxTokens || 2048;
          profileToUpdate.systemPrompt = config.systemPrompt;
          profileToUpdate.lastUpdated = new Date().toLocaleString();
        }

        chrome.storage.local.set({ 
          profiles: profiles, 
          lastSelectedProfileId: lastSelectedProfileId 
        }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    });
  }
}