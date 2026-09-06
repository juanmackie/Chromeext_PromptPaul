/**
 * @fileoverview Cross-platform runner for `npm run test:browser:prod`.
 * @module testBrowserProd
 *
 * Builds production output, stages the browser harness into `dist/`, sets
 * `PROMPT_PAUL_LOAD_EXTENSION_DIR=dist`, and runs the Playwright browser suite
 * against the packaged files. Node-based (instead of an inline `VAR=value`
 * shell assignment) so it works on Windows cmd, PowerShell, and POSIX shells.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { stage } = require('./stage-browser-harness');

const repoRoot = path.resolve(__dirname, '..');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Failed to run ${command} ${args.join(' ')}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

// Build production output first so the browser suite exercises packaged files.
run(process.execPath, [path.join('scripts', 'build.js'), '--prod']);

// Point the loader and harness staging at the built output for the remainder
// of this process (the playwright child inherits this env).
process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR = 'dist';

// Stage the test harness into dist/ so chrome-extension://.../tests/browser/
// resolves against the built extension.
stage();

// Run the browser suite with the loader pointed at dist/.
run(process.execPath, [
  path.join('node_modules', '@playwright', 'test', 'cli.js'),
  'test',
  'tests',
  'browser',
]);
