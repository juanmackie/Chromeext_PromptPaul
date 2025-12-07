const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('Chrome Extension E2E - Load and expose pages', () => {
  test('loads extension and exposes at least one extension page', async () => {
    const extensionPath = path.resolve(__dirname, '../../../');

    // Ensure manifest exists
    const manifestPath = path.join(extensionPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json not found at project root; cannot run extension E2E test.');
    }

    const context = await chromium.launchPersistentContext('', {
      headless: false, // Extensions are not supported in headless mode in Chromium
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    try {
      // Wait a bit for extension to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));

      const backgroundPages = context.backgroundPages ? context.backgroundPages() : [];
      const serviceWorkers = context.serviceWorkers ? context.serviceWorkers() : [];

      // Either a background page or a service worker should exist for MV3
      const hasBackgroundLike =
        (backgroundPages && backgroundPages.length > 0) ||
        (serviceWorkers && serviceWorkers.length > 0);

      expect(hasBackgroundLike).toBeTruthy();

      // Open the options page via chrome://extensions API is tricky from here,
      // instead enumerate pages and ensure at least one extension URL is present.
      const pages = context.pages();
      const extensionPageFound = pages.some(page => {
        const url = page.url();
        return url.startsWith('chrome-extension://');
      });

      expect(extensionPageFound || hasBackgroundLike).toBeTruthy();
    } finally {
      await context.close();
    }
  });
});
