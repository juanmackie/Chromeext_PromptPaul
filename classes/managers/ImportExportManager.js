import { BaseManager } from './BaseManager.js';

/**
 * ImportExportManager centralizes JSON file import/export helpers.
 * - Reading JSON from a selected File
 * - Triggering JSON downloads
 */
export class ImportExportManager extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Trigger a JSON file download of the provided data object.
   * @param {string} filename
   * @param {object} data
   */
  downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Read a File object as JSON.
   * @param {File} file
   * @returns {Promise<object>}
   */
  async readFileAsJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || '{}'));
          resolve(data);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
}
