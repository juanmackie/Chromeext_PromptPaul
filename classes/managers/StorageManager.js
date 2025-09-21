import { BaseManager } from './BaseManager.js';

/**
 * Storage Manager handling all storage-related operations
 * Implements the Manager pattern for business logic separation
 */
export class StorageManager extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Get data from chrome.storage.local
   * @param {String|Array|Object} keys - Keys to retrieve
   * @returns {Promise<Object>} - Retrieved data
   */
  async getLocal(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Set data in chrome.storage.local
   * @param {Object} items - Items to set
   * @returns {Promise<void>}
   */
  async setLocal(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Remove data from chrome.storage.local
   * @param {String|Array} keys - Keys to remove
   * @returns {Promise<void>}
   */
  async removeLocal(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get data from chrome.storage.sync
   * @param {String|Array|Object} keys - Keys to retrieve
   * @returns {Promise<Object>} - Retrieved data
   */
  async getSync(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Set data in chrome.storage.sync
   * @param {Object} items - Items to set
   * @returns {Promise<void>}
   */
  async setSync(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Remove data from chrome.storage.sync
   * @param {String|Array} keys - Keys to remove
   * @returns {Promise<void>}
   */
  async removeSync(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Clear all data from chrome.storage.local
   * @returns {Promise<void>}
   */
  async clearLocal() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Clear all data from chrome.storage.sync
   * @returns {Promise<void>}
   */
  async clearSync() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.clear(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get storage usage information
   * @returns {Promise<Object>} - Storage usage information
   */
  async getStorageUsage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.getBytesInUse((localBytes) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        chrome.storage.sync.getBytesInUse((syncBytes) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          resolve({
            local: {
              bytesInUse: localBytes,
              quota: chrome.storage.local.QUOTA_BYTES
            },
            sync: {
              bytesInUse: syncBytes,
              quota: chrome.storage.sync.QUOTA_BYTES
            }
          });
        });
      });
    });
  }

  /**
   * Migrate data from sync storage to local storage
   * @param {Array} keys - Keys to migrate
   * @returns {Promise<void>}
   */
  async migrateSyncToLocal(keys) {
    try {
      // Get data from sync storage
      const syncData = await this.getSync(keys);
      
      // Set data in local storage
      await this.setLocal(syncData);
      
      // Remove data from sync storage
      await this.removeSync(keys);
      
      console.log(`Successfully migrated keys ${keys.join(', ')} from sync to local storage`);
    } catch (error) {
      console.error('Error migrating data from sync to local storage:', error);
      throw error;
    }
  }
}