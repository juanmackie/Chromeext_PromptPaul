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
  return path.resolve(repoRoot, process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR || 'dist-dev');
}

/**
 * Copy the harness files into the load dir under `tests/browser/`.
 * When testing the source checkout itself, the harness is already present, so
 * this is a no-op. Returns the list of staged destinations.
 * @returns {{files: string[]}}
 */
function stage() {
  const target = loadDir();
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
  return { files: staged };
}

if (require.main === module) {
  const result = stage();
  for (const file of result.files) {
    console.log(`Harness staged: ${file}`);
  }
}

module.exports = { stage, loadDir };
