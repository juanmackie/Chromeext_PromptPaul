/**
 * @fileoverview Stage the browser-test harness into a built extension output so
 * the real-browser suite can exercise packaged files (P1-08).
 * @module stageBrowserHarness
 *
 * The real-browser specs load a test-only harness page at
 * `chrome-extension://<id>/tests/browser/extension-harness.html`. A source
 * checkout already contains `tests/browser/`, but a built output such as
 * `dist/` does not (the build copies only runtime files). This script copies
 * the minimal harness files into the extension that is under test so
 * `PROMPT_PAUL_LOAD_EXTENSION_DIR=dist` browser tests run against the exact
 * packaged files.
 *
 * The staging is test-time only: it never changes the source tree, and it is
 * not part of the shipped artifact (CI's `build` job rebuilds `dist/` fresh
 * without staging before uploading).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const srcHarnessDir = path.join(repoRoot, 'tests', 'browser');
const harnessFiles = ['extension-harness.html', 'extension-harness.js'];

/**
 * Resolve the extension directory under test. `PROMPT_PAUL_LOAD_EXTENSION_DIR`
 * mirrors the loader in tests/browser/browserTestSupport.js.
 * @returns {string}
 */
function loadDir() {
  const target = process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR || '';
  return target ? path.resolve(repoRoot, target) : repoRoot;
}

/**
 * Browser automation cannot accept Chrome's native optional-permission prompt.
 * Grant debugger only in the generated test copy so the precise-input runtime
 * path can be exercised; the source manifest and release build stay optional.
 * @param {string} target
 * @returns {boolean}
 */
function grantDebuggerForBrowserTests(target) {
  if (target === repoRoot) return false;
  const manifestPath = path.join(target, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const optional = Array.isArray(manifest.optional_permissions)
    ? manifest.optional_permissions
    : [];
  if (!optional.includes('debugger')) return false;
  manifest.optional_permissions = optional.filter((permission) => permission !== 'debugger');
  manifest.permissions = [...new Set([...(manifest.permissions || []), 'debugger'])];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

/**
 * Copy the harness files into the load dir under `tests/browser/`.
 * When testing the source checkout itself, the harness is already present, so
 * this is a no-op. Returns the list of staged destinations.
 * @returns {{files: string[], debuggerGranted: boolean}}
 */
function stage() {
  const target = loadDir();
  const debuggerGranted =
    process.env.PROMPT_PAUL_BROWSER_TEST_GRANT_DEBUGGER === 'true' &&
    grantDebuggerForBrowserTests(target);
  const destDir = path.join(target, 'tests', 'browser');
  fs.mkdirSync(destDir, { recursive: true });
  const staged = [];
  for (const file of harnessFiles) {
    const srcPath = path.join(srcHarnessDir, file);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Harness file not found in source: ${srcPath}`);
    }
    const destPath = path.join(destDir, file);
    fs.copyFileSync(srcPath, destPath);
    staged.push(destPath);
  }
  return { files: staged, debuggerGranted };
}

if (require.main === module) {
  const result = stage();
  for (const file of result.files) {
    console.log(`Harness staged: ${file}`);
  }
  if (result.debuggerGranted) {
    console.log('Debugger permission granted in the generated browser-test copy.');
  }
}

module.exports = { stage, loadDir, grantDebuggerForBrowserTests };
