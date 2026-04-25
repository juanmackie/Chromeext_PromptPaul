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
const pkg = readJson('package.json');

if (manifest) {
  const manifestFiles = collectManifestFiles(manifest);
  manifestFiles.forEach((relativePath) => {
    assertFileExists(relativePath, 'Manifest references file that does not exist');
  });
}

if (pkg) {
  const dependencies = pkg.dependencies || {};
  const hasVendoredReadability = fs.existsSync(path.join(repoRoot, 'libs', 'readability.js'));
  const hasVendoredTurndown = fs.existsSync(path.join(repoRoot, 'libs', 'turndown.js'));
  const hasNpmReadability = Object.prototype.hasOwnProperty.call(
    dependencies,
    '@mozilla/readability'
  );
  const hasNpmTurndown = Object.prototype.hasOwnProperty.call(dependencies, 'turndown');

  if (hasVendoredReadability && hasNpmReadability) {
    errors.push(
      'Duplicate dependency source for readability: vendored file and npm dependency are both present'
    );
  }

  if (hasVendoredTurndown && hasNpmTurndown) {
    errors.push(
      'Duplicate dependency source for turndown: vendored file and npm dependency are both present'
    );
  }
}

if (errors.length > 0) {
  console.error('Smoke check failed:\n');
  errors.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Smoke check passed.');
