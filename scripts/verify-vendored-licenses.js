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
  if (!entry.bundle && !Array.isArray(entry.bundles)) {
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

function verifyBenchmarkRecord(name, entry) {
  if (!entry.license || !entry.source || entry.licenseReviewed !== true) {
    throw new Error(`${name}: incomplete benchmark license record`);
  }
  if (entry.redistributed !== false || entry.use !== 'Clean-room case ideas only') {
    throw new Error(`${name}: benchmark materials must not be redistributed`);
  }
  console.log(`Verified ${name} benchmark record (${entry.license})`);
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
  console.log('Vendored license verification passed.');
}

try {
  main();
} catch (error) {
  console.error(`Vendored license verification failed: ${error.message}`);
  process.exitCode = 1;
}
