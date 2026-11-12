const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const errors = [];

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    const contents = fs.readFileSync(absolutePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    errors.push(`Failed to read ${relativePath}: ${error.message}`);
    return null;
  }
}

function assertFileExists(relativePath, reason) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${reason}: missing ${relativePath}`);
  }
}

function collectManifestFiles(manifest) {
  const files = new Set();

  if (manifest.options_page) {
    files.add(manifest.options_page);
  }

  if (manifest.background && manifest.background.service_worker) {
    files.add(manifest.background.service_worker);
  }

  if (manifest.icons && typeof manifest.icons === 'object') {
    Object.values(manifest.icons).forEach((iconPath) => {
      if (typeof iconPath === 'string' && iconPath.trim()) {
        files.add(iconPath);
      }
    });
  }

  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((contentScript) => {
      if (Array.isArray(contentScript.js)) {
        contentScript.js.forEach((scriptPath) => files.add(scriptPath));
      }
      if (Array.isArray(contentScript.css)) {
        contentScript.css.forEach((stylePath) => files.add(stylePath));
      }
    });
  }

  return files;
}

const manifest = readJson('manifest.json');

if (manifest) {
  const manifestFiles = collectManifestFiles(manifest);
  manifestFiles.forEach((relativePath) => {
    assertFileExists(relativePath, 'Manifest references file that does not exist');
  });
}

// Evaluation purity: the evaluation build is opt-in (`npm run build:eval`) and
// must never reach production. The build swaps no-op interfaces in src/utils
// for direct-run implementations in dist-eval only, so the production no-ops
// must contain none of the evaluation-only markers, a production build must
// not contain them in any manifest-referenced script or swapped module, and
// the swapped variants must not survive into dist/.
const EVAL_ONLY_MARKERS = [
  'TEST_RUN_TASK',
  'TEST_INSPECT_PAGE',
  'TEST_GET_TRACE',
  'setEvalTraceActionCallback',
  'prediction_captured',
];
const EVAL_NOOP_MODULES = ['src/utils/evalHook.js', 'src/utils/evalTrace.js'];
const EVAL_VARIANT_MODULES = ['src/utils/evalHook.eval.js', 'src/utils/evalTrace.eval.js'];

function readTextIfPresent(absolutePath) {
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (_) {
    return null;
  }
}

function assertNoEvaluationMarkers(baseDir, relativePath) {
  const source = readTextIfPresent(path.join(baseDir, relativePath));
  if (source === null) return;
  for (const marker of EVAL_ONLY_MARKERS) {
    if (source.includes(marker)) {
      errors.push(
        `${baseDir === repoRoot ? '' : 'dist/'}${relativePath} contains evaluation-only marker "${marker}"`
      );
    }
  }
}

for (const relativePath of EVAL_NOOP_MODULES) {
  assertNoEvaluationMarkers(repoRoot, relativePath);
}

const distManifest = readJson('dist/manifest.json');
if (distManifest) {
  const distRoot = path.join(repoRoot, 'dist');
  collectManifestFiles(distManifest).forEach((relativePath) => {
    if (relativePath.endsWith('.js')) {
      assertNoEvaluationMarkers(distRoot, relativePath);
    }
  });
  for (const relativePath of EVAL_NOOP_MODULES) {
    assertNoEvaluationMarkers(distRoot, relativePath);
  }
  for (const relativePath of EVAL_VARIANT_MODULES) {
    if (fs.existsSync(path.join(distRoot, relativePath))) {
      errors.push(`Production build contains evaluation variant dist/${relativePath}`);
    }
  }
}

if (errors.length > 0) {
  console.error('Smoke check failed:\n');
  errors.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Smoke check passed.');
