import { OptionsCoordinator } from './classes/coordinators/OptionsCoordinator.js';

// This module wires import/export actions for instructions and tools.
// Keeps options.js lean and focused on general page setup.

const coordinator = (() => {
  // Reuse the already created coordinator from options.js if present
  // Otherwise create a new one (safe fallback if this file loads alone in tests)
  try {
    // @ts-ignore
    if (window && window.optionsCoordinator instanceof OptionsCoordinator) {
      // @ts-ignore
      return window.optionsCoordinator;
    }
  } catch (_) {}
  return new OptionsCoordinator();
})();

import { ImportExportManager } from './classes/managers/ImportExportManager.js';
const importExportManager = new ImportExportManager();

function download(filename, dataObj) {
  importExportManager.downloadJson(filename, dataObj);
}

function readFileAsJson(file) {
  return importExportManager.readFileAsJson(file);
}

async function ensureCoordinatorStarted() {
  // If state uninitialized, start it
  try {
    if (!coordinator.viewModel || !coordinator.viewModel.getState) {
      await coordinator.start();
    }
  } catch (_) {
    try { await coordinator.start(); } catch {} // best effort
  }
}

function setupInstructionImportExport() {
  const exportBtn = document.getElementById('exportInstructionsBtn');
  const importBtn = document.getElementById('importInstructionsBtn');
  const importInput = document.getElementById('importInstructionsInput');

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        await ensureCoordinatorStarted();
        const data = await coordinator.exportInstructions();
        importExportManager.downloadJson(`instructions_export_${new Date().toISOString()}.json`, data);
      } catch (e) {
        console.error('Export instructions failed:', e);
      }
    });
  }

  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (evt) => {
      const file = evt.target.files && evt.target.files[0];
      if (!file) return;
      try {
        await ensureCoordinatorStarted();
        const data = await importExportManager.readFileAsJson(file);
        await coordinator.importInstructions(data);
      } catch (e) {
        console.error('Import instructions failed:', e);
      } finally {
        importInput.value = '';
      }
    });
  }
}

function setupToolImportExport() {
  const exportBtn = document.getElementById('exportTools');
  const importBtn = document.getElementById('importTools');
  const importInput = document.getElementById('importToolsFile');

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        await ensureCoordinatorStarted();
        const data = await coordinator.exportTools();
        importExportManager.downloadJson(`tools_export_${new Date().toISOString()}.json`, data);
      } catch (e) {
        console.error('Export tools failed:', e);
      }
    });
  }

  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (evt) => {
      const file = evt.target.files && evt.target.files[0];
      if (!file) return;
      try {
        await ensureCoordinatorStarted();
        const data = await importExportManager.readFileAsJson(file);
        await coordinator.importTools(data);
      } catch (e) {
        console.error('Import tools failed:', e);
      } finally {
        importInput.value = '';
      }
    });
  }
}

function init() {
  setupInstructionImportExport();
  setupToolImportExport();
}

document.addEventListener('DOMContentLoaded', init);
// Also run after templates are loaded to catch dynamic content
// This complements the existing templatesLoaded event in options.js
// and is idempotent due to additive listeners.
document.addEventListener('templatesLoaded', init);
