#!/usr/bin/env node

/**
 * @fileoverview Build script for Prompt Paul Chrome extension
 *
 * Responsibilities:
 * - Validate manifest.json
 * - Copy files to build directory
 * - Create production-ready package
 * - Generate build metadata
 */

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, 'dist');
const srcDir = repoRoot;

// Parse command line arguments
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const isProd = args.includes('--prod') || !isDev;

console.log(`🚀 Building Prompt Paul (${isProd ? 'production' : 'development'})...\n`);

/**
 * Read JSON file safely
 */
function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    const contents = fs.readFileSync(absolutePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    console.error(`❌ Failed to read ${relativePath}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Validate manifest.json
 */
function validateManifest(manifest) {
  const errors = [];

  if (!manifest.name) errors.push('Manifest missing "name"');
  if (!manifest.version) errors.push('Manifest missing "version"');
  if (!manifest.manifest_version) errors.push('Manifest missing "manifest_version"');

  if (manifest.manifest_version !== 3) {
    errors.push('Manifest must be version 3');
  }

  // Validate icons
  if (manifest.icons) {
    Object.values(manifest.icons).forEach((iconPath) => {
      const fullPath = path.join(srcDir, iconPath);
      if (!fs.existsSync(fullPath)) {
        errors.push(`Icon file does not exist: ${iconPath}`);
      }
    });
  }

  // Validate content scripts
  if (manifest.content_scripts) {
    manifest.content_scripts.forEach((contentScript) => {
      if (contentScript.js) {
        contentScript.js.forEach((scriptPath) => {
          const fullPath = path.join(srcDir, scriptPath);
          if (!fs.existsSync(fullPath)) {
            errors.push(`Content script does not exist: ${scriptPath}`);
          }
        });
      }
    });
  }

  // Validate background service worker
  if (manifest.background && manifest.background.service_worker) {
    const fullPath = path.join(srcDir, manifest.background.service_worker);
    if (!fs.existsSync(fullPath)) {
      errors.push(
        `Background service worker does not exist: ${manifest.background.service_worker}`
      );
    }
  }

  // Validate options page
  if (manifest.options_page) {
    const fullPath = path.join(srcDir, manifest.options_page);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Options page does not exist: ${manifest.options_page}`);
    }
  }

  return errors;
}

/**
 * Copy directory recursively
 */
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  entries.forEach((entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

/**
 * Create build directory
 */
function createBuildDir() {
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  fs.mkdirSync(buildDir, { recursive: true });
  console.log(`📁 Created build directory: ${buildDir}`);
}

/**
 * Copy extension files
 */
function copyFiles(manifest) {
  const filesToCopy = [
    'manifest.json',
    'background.js',
    'chat.html',
    'chat.js',
    'options.html',
    'options.js',
    'error.html',
    'input-controls.js',
    'loadingManager.js',
    'themeUtils.js',
    'theme-toggle.js',
    'content_script_unified.js',
    'pdfContentScript.js',
    // Shared stylesheets referenced by extension pages
    'theme.css',
    'chat.css',
    'options.css',
    'loading-states.css',
    'ui-primitives.css',
    // Root-level vendored assets referenced by extension pages
    'marked.min.js',
  ];

  // Add content script files
  if (manifest.content_scripts) {
    manifest.content_scripts.forEach((contentScript) => {
      if (contentScript.js) {
        contentScript.js.forEach((scriptPath) => {
          if (!filesToCopy.includes(scriptPath)) {
            filesToCopy.push(scriptPath);
          }
        });
      }
      if (contentScript.css) {
        contentScript.css.forEach((cssPath) => {
          if (!filesToCopy.includes(cssPath)) {
            filesToCopy.push(cssPath);
          }
        });
      }
    });
  }

  // Add options page
  if (manifest.options_page) {
    filesToCopy.push(manifest.options_page);
  }

  // Add icons
  if (manifest.icons) {
    Object.values(manifest.icons).forEach((iconPath) => {
      if (!filesToCopy.includes(iconPath)) {
        filesToCopy.push(iconPath);
      }
    });
  }

  // Copy each file
  filesToCopy.forEach((file) => {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(buildDir, file);

    // Create directory if needed
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  ✓ Copied ${file}`);
    } else {
      console.warn(`  ⚠ Warning: ${file} does not exist`);
    }
  });

  // Copy directories
  const dirsToCopy = ['src', 'libs', 'skills'];
  dirsToCopy.forEach((dir) => {
    const srcPath = path.join(srcDir, dir);
    const destPath = path.join(buildDir, dir);
    if (fs.existsSync(srcPath)) {
      copyDir(srcPath, destPath);
      console.log(`  ✓ Copied directory ${dir}/`);
    }
  });
}

/**
 * Generate build metadata
 */
function generateBuildMetadata() {
  const metadata = {
    buildTime: new Date().toISOString(),
    buildType: isProd ? 'production' : 'development',
    version: readJson('package.json').version,
    commit: process.env.GITHUB_SHA || 'local',
    branch: process.env.GITHUB_REF || 'local',
  };

  fs.writeFileSync(path.join(buildDir, 'build-metadata.json'), JSON.stringify(metadata, null, 2));
}

/**
 * Main build function
 */
function main() {
  const manifest = readJson('manifest.json');

  // Validate manifest
  console.log('🔍 Validating manifest.json...');
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) {
    console.error('❌ Manifest validation failed:');
    manifestErrors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  console.log('✅ Manifest validation passed\n');

  // Create build directory
  createBuildDir();

  // Copy files
  console.log('📦 Copying files...');
  copyFiles(manifest);
  console.log('');

  // Generate metadata
  generateBuildMetadata();
  console.log('✅ Build metadata generated\n');

  // Summary
  console.log('🎉 Build complete!');
  console.log(`   Output: ${buildDir}`);
  console.log(`   Type: ${isProd ? 'Production' : 'Development'}`);
  console.log(`   Version: ${manifest.version}`);

  if (isProd) {
    console.log('\n📦 To package the extension:');
    console.log('   1. Open chrome://extensions/');
    console.log('   2. Enable "Developer mode"');
    console.log('   3. Click "Load unpacked"');
    console.log(`   4. Select the ${buildDir} directory`);
  }
}

// Run main
main();
