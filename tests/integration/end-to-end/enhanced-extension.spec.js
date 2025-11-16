/**
 * Enhanced E2E Tests for Chrome Extension
 * Tests full user workflows: extension load -> context menu -> side panel -> chat streaming
 */

const { test, expect, chromium } = require("@playwright/test");
const path = require("path");

test.describe('Enhanced Chrome Extension E2E', () => {
  test('complete user workflow: context menu -> media analysis -> chat streaming', async ({ browserName }) => {
    if (browserName !== 'chromium') {
      test.skip('Extension tests only supported in Chromium');
    }

    const extensionPath = path.resolve(__dirname, "../../../../");
    
    // Launch persistent context with extension
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    const page = await context.newPage();
    
    try {
      // 1. Navigate to test page with sample content/image
      await page.goto('https://example.com'); // Simple page with text/image
      
      // Wait for extension to load
      await page.waitForTimeout(3000);

      // 2. Simulate right-click on image to trigger context menu
      // Note: Playwright can't directly interact with extension context menus,
      // so verify extension background/service worker is active
      const backgroundPages = context.backgroundPages();
      const serviceWorkers = context.serviceWorkers();
      expect(backgroundPages.length + serviceWorkers.length).toBeGreaterThan(0);

      // 3. Open side panel (simulate user gesture via programmatic click)
      await page.evaluate(() => {
        // Simulate context menu click on image
        const img = document.querySelector('img') || document.createElement('img');
        img.src = 'data:image/png;base64,iVBORw0KGgo=';
        document.body.appendChild(img);
        
        // Dispatch context menu event
        img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      });

      // 4. Verify side panel opens (check chrome://inspect or extension pages)
      const extensionPages = context.pages().filter(p => p.url().startsWith('chrome-extension://'));
      expect(extensionPages.length).toBeGreaterThan(0);

      // 5. Test chat interaction (type prompt, verify streaming mock)
      const sidePanelPage = extensionPages[0];
      await sidePanelPage.waitForLoadState('networkidle');
      
      // Type in chat input and submit (adjust selectors based on chat.html)
      await sidePanelPage.fill('input[placeholder*="prompt"]', 'Hello from E2E test');
      await sidePanelPage.click('button[type="submit"]');
      
      // Verify streaming response appears (mocked via background)
      await expect(sidePanelPage.locator('.message-streaming')).toBeVisible({ timeout: 10000 });

    } finally {
      await context.close();
    }
  });

  test('extension options page loads and saves config', async ({ browserName }) => {
    if (browserName !== 'chromium') {
      test.skip('Extension tests only supported in Chromium');
    }

    const extensionPath = path.resolve(__dirname, "../../../../");
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--load-extension=${extensionPath}`]
    });

    try {
      // Navigate to chrome://extensions to enable options page
      const page = await context.newPage();
      await page.goto('chrome://extensions/');
      
      // Find and click options (requires developer mode)
      await page.click('text=Details');
      
      // Open options page
      const optionsUrl = page.url().replace('details.html', 'options.html');
      await page.goto(optionsUrl);

      // Test config save
      await page.fill('[name="apiKey"]', 'test-e2e-key');
      await page.click('button:has-text("Save")');
      
      // Verify save confirmation
      await expect(page.locator('.success-message')).toBeVisible();

    } finally {
      await context.close();
    }
  });
});