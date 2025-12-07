/**
 * Jest configuration for Chrome extension project.
 * Optimized for ES6 modules and Chrome extension testing with comprehensive mocking.
 */
module.exports = {
  testEnvironment: "jsdom",
  testMatch: [
    "<rootDir>/tests/**/*.test.js",
    "<rootDir>/tests/**/*.spec.js"
  ],

  // Transform configuration for ES6 modules
  transform: {
    "^.+\\.(js|jsx|mjs|cjs)$": "babel-jest"
  },

  moduleFileExtensions: ["js", "json", "mjs", "cjs"],

  // Ignore node_modules transformation but allow specific packages
  transformIgnorePatterns: [
    "/node_modules/(?!(marked)/)"
  ],

  setupFilesAfterEnv: [
    "<rootDir>/tests/setup/chrome-mocks.cjs",
    "<rootDir>/tests/setup/jest.setup.js"
  ],

  // Module name mappings for Chrome extension and browser APIs
  moduleNameMapper: {
    // Handle errorHandler imports (absolute/relative)
    "^(?:errorHandler|\\.?\.?/errorHandler(?:\\.js)?)$": "<rootDir>/tests/mocks/error-handler.mock.js",
    "^(?:analytics|\\.?\.?/analytics(?:\\.js)?)$": "<rootDir>/tests/mocks/analytics.mock.js",
    // Map module paths to actual files
    "^chat/(.*)$": "<rootDir>/tests/mocks/chat-modules.mock.js",
    "^background/(.*)$": "<rootDir>/background/$1",
    "^services/(.*)$": "<rootDir>/services/$1",
    "^utils/(.*)$": "<rootDir>/utils/$1",
    "^options/(.*)$": "<rootDir>/options/$1"
  },
  // Enable coverage collection for core extension code.
  collectCoverage: true,
  collectCoverageFrom: [
    "background/**/*.js",
    "chat/**/*.js",
    "services/**/*.js",
    "utils/**/*.js",
    "options/**/*.js",
    "content_script_unified.js",
    "pdf_content_script.js",
    "!**/node_modules/**",
    "!tests/**",
    "!mocks/**",
    "!**/coverage/**",
    "!**/*.config.*"
  ],
  coverageDirectory: "coverage",
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  }
};