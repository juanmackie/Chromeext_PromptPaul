/**
 * @fileoverview ESLint flat configuration (ESLint 10+).
 * @module eslintConfig
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'artifacts/',
      'libs/',
      'node_modules/',
      'dist/',
      'dist-dev/',
      'dist-eval/',
      'plans/',
      '.baseline/',
      '.commandcode/',
      '.dream-rsi/',
      '.idea/',
      '.pi/',
      '.pi-subagents/',
      '.vscode/',
      'coverage/',
      'test-results/',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        marked: 'readonly',
        hljs: 'readonly',
        chrome: 'readonly',
        Readability: 'readonly',
        TurndownService: 'readonly',
        DOMPurify: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-empty': 'warn',
      'no-undef': 'error',
      // Promoted to errors in ESLint 9+ recommended; flag pre-existing code as
      // warnings until those call sites are cleaned up.
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
];
