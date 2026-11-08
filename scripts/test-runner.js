#!/usr/bin/env node

/**
 * @fileoverview Lightweight manifest and built-package checks.
 * @module testRunner
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const failures = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
    return null;
  }
}

function addResourcePaths(manifest, paths = new Set()) {
  if (manifest.options_page) paths.add(manifest.options_page);
  if (manifest.options_ui?.page) paths.add(manifest.options_ui.page);
  if (manifest.side_panel?.default_path) paths.add(manifest.side_panel.default_path);
  if (manifest.background?.service_worker) paths.add(manifest.background.service_worker);
  if (manifest.action?.default_popup) paths.add(manifest.action.default_popup);
  for (const icon of Object.values(manifest.icons || {})) paths.add(icon);
  for (const icon of Object.values(manifest.action?.default_icon || {})) paths.add(icon);
  for (const script of manifest.content_scripts || []) {
    for (const file of [...(script.js || []), ...(script.css || [])]) paths.add(file);
  }
  for (const resourceGroup of manifest.web_accessible_resources || []) {
    for (const resource of resourceGroup.resources || []) {
      if (!resource.includes('*')) paths.add(resource);
    }
  }
  return paths;
}

function checkManifestAt(manifest, baseDir, label) {
  if (!manifest) return;
  if (manifest.manifest_version !== 3) failures.push(`${label}: manifest_version must be 3`);
  if (!manifest.name || !manifest.version) failures.push(`${label}: name and version are required`);
  const required = new Set(manifest.permissions || []);
  for (const permission of manifest.optional_permissions || []) {
    if (required.has(permission)) failures.push(`${label}: duplicate required/optional permission ${permission}`);
  }
  for (const resource of addResourcePaths(manifest)) {
    if (!fs.existsSync(path.join(baseDir, resource))) {
      failures.push(`${label}: manifest references missing file ${resource}`);
    }
  }
}

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
checkManifestAt(manifest, root, 'manifest.json');
if (manifest && pkg && manifest.version !== pkg.version) {
  failures.push(`package.json version ${pkg.version} does not match manifest ${manifest.version}`);
}

// CI builds after validation; when a build is present, check its manifest too.
const distDir = path.join(root, 'dist');
if (fs.existsSync(distDir)) {
  checkManifestAt(readJson(path.relative(root, path.join(distDir, 'manifest.json'))), distDir, 'dist/manifest.json');
}

if (failures.length) {
  console.error(`Manifest/build checks failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Manifest/build checks passed.');
