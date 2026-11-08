/**
 * @fileoverview Runtime browser assets copied from locked npm packages.
 * @module runtimeDependencies
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'libs', 'vendor-manifest.json'), 'utf8')
);

function getNpmRuntimeAssets() {
  return Object.entries(manifest.libraries || {}).flatMap(([library, entry]) =>
    (entry.assets || []).map((asset) => ({
      library,
      packageName: entry.npmPackage,
      ...asset,
    }))
  );
}

function isGeneratedRuntimeAsset(file) {
  return getNpmRuntimeAssets().some((asset) => asset.file === file);
}

function copyNpmRuntimeAssets(destinationRoot) {
  for (const asset of getNpmRuntimeAssets()) {
    const sourcePath = path.join(repoRoot, asset.source);
    const destinationPath = path.join(destinationRoot, asset.file);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `${asset.library}: missing ${asset.source}; install the locked npm dependencies first`
      );
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

module.exports = { getNpmRuntimeAssets, isGeneratedRuntimeAsset, copyNpmRuntimeAssets };
