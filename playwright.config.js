const { defineConfig } = require("@playwright/test");
const path = require("path");

// Resolve extension path (current project root)
const extensionPath = path.resolve(__dirname);

module.exports = defineConfig({
  testDir: "./tests/integration/end-to-end",
  timeout: 30000,
  use: {
    headless: false, // For extension debugging; can be overridden via CLI
    bypassCSP: true
  },
  projects: [
    {
      name: "chromium-extension",
      use: {
        browserName: "chromium"
      }
    }
  ],
  fullyParallel: false,
  reporter: [["list"]],
  // We keep it minimal: tests themselves are responsible for launching with the extension.
});