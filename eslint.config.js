import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'build/**',
      '*.min.js',
      '*.config.js',
      '*.config.mjs',
      '*.config.cjs'
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        webextensions: true,
        chrome: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        crypto: 'readonly',
        navigator: 'readonly',
        document: 'readonly',
        window: 'readonly',
        console: 'readonly'
      }
    },
    rules: {
      // Error prevention
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Code quality
      'prefer-const': 'error',
      'no-var': 'error',

      // ES6+
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',

      // Chrome extension specific
      'no-alert': 'off', // Chrome extensions often use alert for debugging

      // Allow case block declarations
      'no-case-declarations': 'off',

      // Allow empty blocks for placeholders
      'no-empty': 'warn'
    }
  },
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.jest
      }
    },
    rules: {
      'no-unused-expressions': 'off',
    }
  }
];
