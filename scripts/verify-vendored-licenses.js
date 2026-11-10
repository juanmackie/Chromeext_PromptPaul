#!/usr/bin/env node

/**
 * @fileoverview Verify first-party records for vendored extension libraries.
 * @module verifyVendoredLicenses
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, 'libs', 'vendor-manifest.json');
const lockPath = path.join(repoRoot, 'package-lock.json');
const packageLock = readJson(lockPath);
const packageManifest = readJson(path.join(repoRoot, 'package.json'));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyFile(name, filePath, expectedHash, licenseMarker) {
  const absolutePath = path.join(repoRoot, filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`${name}: missing bundle ${filePath}`);
  if (sha256(absolutePath) !== expectedHash) {
    throw new Error(`${name}: hash does not match libs/vendor-manifest.json`);
  }
  if (licenseMarker && !fs.readFileSync(absolutePath, 'utf8').includes(licenseMarker)) {
    throw new Error(`${name}: license marker is missing from ${filePath}`);
  }
}

function verifyLibrary(name, entry) {
  if (!entry.version || !entry.license || !entry.source) {
    throw new Error(`${name}: version, license, and source are required`);
  }
  if (entry.bundle) {
    verifyFile(name, entry.bundle, entry.bundleSha256, entry.licenseMarker);
  }
  if (Array.isArray(entry.bundles)) {
    entry.bundles.forEach((bundle) => {
      verifyFile(`${name}/${bundle.file}`, bundle.file, bundle.sha256, entry.licenseMarker);
    });
  }
  if (entry.npmPackage) verifyNpmPackage(name, entry);
  if (!entry.bundle && !Array.isArray(entry.bundles) && !entry.npmPackage) {
    throw new Error(`${name}: a bundle or bundles entry is required`);
  }
  if (entry.licenseFile) {
    const licensePath = path.join(repoRoot, entry.licenseFile);
    if (!fs.existsSync(licensePath))
      throw new Error(`${name}: missing license file ${entry.licenseFile}`);
    if (sha256(licensePath) !== entry.licenseSha256) {
      throw new Error(`${name}: license hash does not match libs/vendor-manifest.json`);
    }
  }
  console.log(`Verified ${name} ${entry.version} (${entry.license})`);
}

function verifyNpmPackage(name, entry) {
  const packagePath = `node_modules/${entry.npmPackage}`;
  if (packageManifest.dependencies?.[entry.npmPackage] !== entry.version) {
    throw new Error(`${name}: direct dependency version does not match libs/vendor-manifest.json`);
  }
  const lockedPackage = packageLock.packages?.[packagePath];
  if (!lockedPackage || lockedPackage.version !== entry.version) {
    throw new Error(`${name}: package version does not match package-lock.json`);
  }
  if (!lockedPackage.resolved || !lockedPackage.integrity) {
    throw new Error(`${name}: package-lock.json lacks resolved provenance or integrity`);
  }

  const packageJsonPath = path.join(repoRoot, packagePath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`${name}: install the locked npm dependency before verifying vendors`);
  }
  const packageJson = readJson(packageJsonPath);
  if (
    packageJson.license !== entry.license &&
    !String(entry.license).includes(packageJson.license)
  ) {
    throw new Error(`${name}: npm package license does not match libs/vendor-manifest.json`);
  }

  for (const asset of entry.assets || []) {
    verifyFile(name, asset.source, asset.sha256);
    if (
      asset.kind === 'license' &&
      !fs.readFileSync(path.join(repoRoot, asset.source), 'utf8').trim()
    ) {
      throw new Error(`${name}: license file is empty`);
    }
    const builtFile = path.join(repoRoot, 'dist', asset.file);
    if (fs.existsSync(path.join(repoRoot, 'dist'))) {
      if (!fs.existsSync(builtFile) || sha256(builtFile) !== asset.sha256) {
        throw new Error(
          `${name}: built asset ${asset.file} is missing or differs from its lockfile source`
        );
      }
    }
  }
}

function verifyBenchmarkRecord(name, entry) {
  if (!entry.license || !entry.source || entry.licenseReviewed !== true) {
    throw new Error(`${name}: incomplete benchmark license record`);
  }
  if (entry.redistributed !== false || entry.use !== 'Clean-room case ideas only') {
    throw new Error(`${name}: benchmark materials must not be redistributed`);
  }
  console.log(`Verified ${name} benchmark record (${entry.license})`);
}

// First-party files inside libs/ that are not third-party vendored assets.
const FIRST_PARTY_LIBS_FILES = new Set(['libs/vendor-manifest.json']);

// Every third-party shipped asset must be covered by exactly one provenance record.
function verifyNoUnlistedAssets(manifest) {
  const covered = new Set();
  for (const entry of Object.values(manifest.libraries || {})) {
    if (entry.bundle) covered.add(entry.bundle);
    if (Array.isArray(entry.bundles)) {
      entry.bundles.forEach((bundle) => covered.add(bundle.file));
    }
    if (Array.isArray(entry.assets)) entry.assets.forEach((asset) => covered.add(asset.file));
    if (entry.licenseFile) covered.add(entry.licenseFile);
  }

  const candidates = fs
    .readdirSync(path.join(repoRoot, 'libs'))
    .filter((f) => fs.statSync(path.join(repoRoot, 'libs', f)).isFile())
    .map((f) => path.join('libs', f));
  const unlisted = [];
  for (const file of candidates) {
    const norm = file.split(path.sep).join('/');
    if (covered.has(norm) || FIRST_PARTY_LIBS_FILES.has(norm)) continue;
    if (fs.existsSync(path.join(repoRoot, file))) unlisted.push(norm);
  }

  if (unlisted.length > 0) {
    throw new Error(
      `Unlisted vendored asset(s) not covered by libs/vendor-manifest.json: ${unlisted.join(', ')}`
    );
  }

  const distLibs = path.join(repoRoot, 'dist', 'libs');
  if (fs.existsSync(distLibs)) {
    const built = fs.readdirSync(distLibs).map((file) => `libs/${file}`);
    const unlistedBuilt = built.filter(
      (file) => !covered.has(file) && !FIRST_PARTY_LIBS_FILES.has(file)
    );
    if (unlistedBuilt.length > 0) {
      throw new Error(`Unlisted built vendor asset(s): ${unlistedBuilt.join(', ')}`);
    }
  }
}

function main() {
  const manifest = readJson(manifestPath);
  for (const [name, entry] of Object.entries(manifest.libraries || {})) {
    verifyLibrary(name, entry);
  }
  for (const [name, entry] of Object.entries(manifest.benchmarkRecords || {})) {
    verifyBenchmarkRecord(name, entry);
  }
  if (Object.keys(manifest.libraries || {}).length === 0) {
    throw new Error('No vendored libraries are recorded');
  }
  verifyNoUnlistedAssets(manifest);
  console.log('Vendored license verification passed.');
}

try {
  main();
} catch (error) {
  console.error(`Vendored license verification failed: ${error.message}`);
  process.exitCode = 1;
}
