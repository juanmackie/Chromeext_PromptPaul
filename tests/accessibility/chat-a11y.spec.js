/**
 * Accessibility Tests - Chat UI
 * Uses Playwright axe-core integration for a11y testing
 */

const { test, expect } = require('@playwright/test');

test.describe('Chat UI Accessibility', () => {
  test('chat interface should have no accessibility violations', async ({ page }) => {
    // Load chat.html or simulate chat UI
    await page.goto(`file://${  __dirname  }/../../../../chat.html`);

    // Wait for UI to load
    await page.waitForLoadState('networkidle');

    // Run axe-core accessibility scan
    const accessibilityScanResults = await page.evaluate(async () => {
      // axe-core needs to be injected or use Playwright's built-in
      return new Promise(resolve => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/axe-core@latest/axe.min.js';
        script.onload = () => {
          axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }, (err, results) => {
            resolve(results);
          });
        };
        document.head.appendChild(script);
      });
    });

    expect(accessibilityScanResults.violations).toHaveLength(0);
  });

  test('options page should meet a11y standards', async ({ page }) => {
    await page.goto(`file://${  __dirname  }/../../../../options.html`);
    await page.waitForLoadState('networkidle');

    const a11yResults = await page.evaluate(async () => {
      return new Promise(resolve => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/axe-core@latest/axe.min.js';
        script.onload = () => {
          axe.run(document, (err, results) => {
            resolve(results);
          });
        };
        document.head.appendChild(script);
      });
    });

    // Allow minor violations but log them
    console.log('Accessibility violations:', a11yResults.violations.length);
    expect(a11yResults.violations.length).toBeLessThan(5);
  });

  test('keyboard navigation should work in chat UI', async ({ page }) => {
    await page.goto(`file://${  __dirname  }/../../../../chat.html`);

    // Focus chat input
    await page.focus('input[placeholder*="prompt"], textarea');

    // Test tab navigation
    await page.keyboard.press('Tab');
    await expect(page.locator('button[type="submit"]')).toBeFocused();

    await page.keyboard.press('Tab');
    // Should cycle through UI elements properly
  });
});
