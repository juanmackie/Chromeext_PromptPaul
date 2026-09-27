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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = process.cwd();
const srcDir = repoRoot;

// Parse command line arguments
const args = process.argv.slice(2);
const hasDevFlag = args.includes('--dev');
const hasEvalFlag = args.includes('--eval');
const hasProdFlag = args.includes('--prod');
if (Number(hasDevFlag) + Number(hasEvalFlag) + Number(hasProdFlag) > 1) {
  console.error('❌ Choose exactly one of --dev, --eval, or --prod.');
  process.exit(1);
}
const isEval = hasEvalFlag;
const isDev = hasDevFlag || isEval;
const isProd = hasProdFlag || (!hasDevFlag && !hasEvalFlag);
const buildDir = path.join(repoRoot, isEval ? 'dist-eval' : isDev ? 'dist-dev' : 'dist');

console.log(
  `🚀 Building Prompt Paul (${isEval ? 'evaluation' : isProd ? 'production' : 'development'})...\n`
);

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
 * Development-only files excluded from the production package. Each entry is
 * a review-approved pattern; production directory copies filter these out
 * while development/evaluation builds keep them for debugging. Runtime skill
 * files (SKILL.md, skills.json), provenance, and license notices are NOT in
 * this set and always ship.
 */
const DEV_ONLY_EXCLUDES = ['AGENTS.md'];

/**
 * Return true when a file name is a development-only file excluded from the
 * shipped production package.
 */
function isDevOnly(entry) {
  return DEV_ONLY_EXCLUDES.some((pattern) => entry === pattern);
}

/**
 * Copy directory recursively. For production builds, development-only files
 * (DOX instructions and dev/eval variant sources) are excluded.
 */
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  entries.forEach((entry) => {
    if (isProd && isDevOnly(entry.name)) {
      return;
    }
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
    'content_script_diagnostics.js',
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
function installEvalVariant() {
  const variants = [
    ['src/utils/evalTrace.js', 'src/utils/evalTrace.eval.js'],
    ['src/utils/evalHook.js', 'src/utils/evalHook.eval.js'],
  ];
  for (const [targetRelativePath, variantRelativePath] of variants) {
    const target = path.join(buildDir, targetRelativePath);
    const variant = path.join(buildDir, variantRelativePath);
    if (isEval) fs.copyFileSync(variant, target);
    fs.rmSync(variant, { force: true });
  }
  console.log(`  ✓ Evaluation hook: ${isEval ? 'available' : 'excluded'}`);
}

function installDiagnosticsVariant() {
  const moduleTarget = path.join(buildDir, 'src', 'utils', 'devDiagnostics.js');
  const moduleProduction = path.join(srcDir, 'src', 'utils', 'devDiagnostics.prod.js');
  if (isProd) fs.copyFileSync(moduleProduction, moduleTarget);
  fs.rmSync(path.join(buildDir, 'src', 'utils', 'devDiagnostics.prod.js'), { force: true });

  const contentTarget = path.join(buildDir, 'content_script_diagnostics.js');
  const contentProduction = path.join(srcDir, 'content_script_diagnostics.prod.js');
  if (isProd) fs.copyFileSync(contentProduction, contentTarget);

  console.log(`  ✓ Diagnostics variant: ${isProd ? 'excluded' : 'development trace available'}`);
}

/**
 * Run a git command, returning trimmed stdout, or null when git/HEAD is
 * unavailable (e.g. a source archive checked out without history).
 */
function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the actual git revision and working-tree cleanliness for the
 * release trace. Falls back to the CI-provided SHA when present, then to
 * 'unknown' when no repository is available.
 */
function resolveGitInfo() {
  const commit = runGit(['rev-parse', 'HEAD']) || process.env.GITHUB_SHA || 'unknown';
  const branch =
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || process.env.GITHUB_REF || 'unknown';
  const dirty =
    runGit(['status', '--porcelain']) !== null && runGit(['status', '--porcelain']) !== '';
  return {
    commit,
    branch,
    clean: !dirty,
    // Full set of modified/untracked paths for a reproducible trace.
    dirtyPaths: dirty ? (runGit(['status', '--porcelain']) || '').split('\n').filter(Boolean) : [],
  };
}

/**
 * Recursively collect files under a directory as relative paths.
 */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(abs));
    } else {
      out.push(path.relative(buildDir, abs));
    }
  }
  return out;
}

/**
 * Compute a reproducible SHA-256 root over the built artifact: a hash over
 * every file's path and content. Sorting guarantees the same tree yields the
 * same checksum regardless of copy order. Also writes a per-file checksum
 * manifest so any downloaded candidate can be verified exactly.
 */
function computeArtifactChecksum() {
  const files = collectFiles(buildDir)
    .filter((f) => f !== 'build-metadata.json' && f !== 'BUILD.sha256')
    .sort();
  const fileHashes = files.map((f) => {
    const content = fs.readFileSync(path.join(buildDir, f));
    return `${crypto.createHash('sha256').update(content).digest('hex')}  ${f}`;
  });
  const root = crypto
    .createHash('sha256')
    .update(fileHashes.join('\n') + '\n')
    .digest('hex');
  return { root, fileHashes };
}

function generateBuildMetadata() {
  const git = resolveGitInfo();
  const metadata = {
    buildTime: new Date().toISOString(),
    buildType: isEval ? 'evaluation' : isProd ? 'production' : 'development',
    diagnostics: isProd ? 'excluded' : 'available',
    evalHook: isEval ? 'available' : 'excluded',
    version: readJson('package.json').version,
    commit: git.commit,
    branch: git.branch,
    clean: git.clean,
    dirtyPaths: git.dirtyPaths,
  };

  // Per-file + root artifact checksum for release traceability. The recorded
  // commit/clean status plus this root checksum let a downloaded candidate be
  // traced to the tested revision and reproduced byte-for-byte.
  const checksum = computeArtifactChecksum();
  metadata.artifactSha256 = checksum.root;

  fs.writeFileSync(path.join(buildDir, 'build-metadata.json'), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(buildDir, 'BUILD.sha256'), checksum.fileHashes.join('\n') + '\n');
}

/**
 * Main build function
 */
function createBuildManifest(manifest) {
  if (!isProd) return manifest;
  const contentScripts = (manifest.content_scripts || [])
    .map((entry) => ({
      ...entry,
      js: entry.js?.filter((file) => file !== 'content_script_page_diagnostics.js'),
    }))
    .filter((entry) => entry.js?.length || entry.css?.length);
  return { ...manifest, content_scripts: contentScripts };
}

function main() {
  const manifest = readJson('manifest.json');
  const buildManifest = createBuildManifest(manifest);

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
  copyFiles(buildManifest);
  fs.writeFileSync(
    path.join(buildDir, 'manifest.json'),
    `${JSON.stringify(buildManifest, null, 2)}\n`
  );
  installDiagnosticsVariant();
  installEvalVariant();
  console.log('');

  // Generate metadata
  generateBuildMetadata();
  console.log('✅ Build metadata generated\n');

  // Summary
  console.log('🎉 Build complete!');
  console.log(`   Output: ${buildDir}`);
  console.log(`   Type: ${isEval ? 'Evaluation' : isProd ? 'Production' : 'Development'}`);
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
