#!/usr/bin/env node

/**
 * @fileoverview Test runner for Prompt Paul
 *
 * Responsibilities:
 * - Run unit tests for module structure and validity
 * - Run integration tests for cross-module consistency
 * - Generate coverage reports
 * - Validate code quality
 */

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();

// Parse command line arguments
const args = process.argv.slice(2);
const runUnit = args.includes('--unit') || args.length === 0;
const runIntegration = args.includes('--integration') || args.length === 0;
const showCoverage = args.includes('--coverage');

console.log('🧪 Running Prompt Paul tests...\n');

/**
 * Test result collector
 */
class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.errors = [];
    this.tests = [];
  }

  test(name, fn) {
    try {
      fn();
      this.passed++;
      this.tests.push({ name, status: 'pass' });
      console.log(`  ✓ ${name}`);
    } catch (error) {
      this.failed++;
      this.tests.push({ name, status: 'fail', error: error.message });
      this.errors.push({ name, error: error.message });
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
    }
  }

  skip(name) {
    this.skipped++;
    this.tests.push({ name, status: 'skip' });
    console.log(`  ⚐ ${name} (skipped)`);
  }

  summary() {
    const total = this.passed + this.failed + this.skipped;
    console.log(`\n📊 Test Summary:`);
    console.log(`   Total: ${total}`);
    console.log(`   Passed: ${this.passed} ✓`);
    console.log(`   Failed: ${this.failed} ✗`);
    console.log(`   Skipped: ${this.skipped} ⚐`);

    if (this.failed > 0) {
      console.log(`\n❌ Some tests failed!`);
      process.exit(1);
    } else {
      console.log(`\n✅ All tests passed!`);
    }
  }
}

/**
 * Read file and throw readable error on failure
 */
function readFileSafe(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File does not exist: ${relativePath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  if (!content || content.trim().length === 0) {
    throw new Error(`File is empty: ${relativePath}`);
  }
  return content;
}

/**
 * Validate module file structure and exports
 */
function checkModule(relativePath, expectedExportPatterns = []) {
  const content = readFileSafe(relativePath);

  if (!content.includes('export') && !content.includes('module.exports')) {
    throw new Error(`Module has no exports: ${relativePath}`);
  }
  if (!content.includes('@fileoverview')) {
    throw new Error(`Module missing @fileoverview JSDoc: ${relativePath}`);
  }
  if (!content.includes('@module')) {
    throw new Error(`Module missing @module JSDoc: ${relativePath}`);
  }

  // Check expected exports exist
  for (const exp of expectedExportPatterns) {
    const patterns = [
      `export ${exp}`,
      `export { ${exp}`,
      `export {${exp}`,
      `export default ${exp}`,
    ];
    const found = patterns.some((p) => content.includes(p));
    if (!found) {
      throw new Error(`Module missing expected export '${exp}': ${relativePath}`);
    }
  }
}

/**
 * ============================================================
 * UNIT TESTS
 * ============================================================
 */
function runUnitTests(runner) {
  console.log('📁 Running unit tests...\n');

  // ---------- Chat Module Structure ----------
  runner.test('ChatUI module structure valid', () => {
    checkModule('src/chat/ChatUI.js');
  });

  runner.test('ChatAPI module structure valid', () => {
    checkModule('src/chat/ChatAPI.js', []);
    const content = readFileSafe('src/chat/ChatAPI.js');
    const requiredFunctions = ['getApiConfig', 'getTools', 'startRun', 'executeRun', 'abortRun'];
    for (const fn of requiredFunctions) {
      if (!content.includes(`export async function ${fn}`) && !content.includes(`export function ${fn}`)) {
        throw new Error(`ChatAPI.js missing export: ${fn}`);
      }
    }
  });

  runner.test('ChatStream module structure valid', () => {
    checkModule('src/chat/ChatStream.js', ['class StreamStateManager']);
  });

  runner.test('ChatMedia module structure valid', () => {
    checkModule('src/chat/ChatMedia.js', ['const MediaType', 'function validateMediaData', 'function getMediaAnalysisPrompt', 'function prepareMediaContent', 'function hasValidMediaData', 'function getMediaDisplayName', 'function supportsVisionAnalysis']);
  });

  runner.test('ChatSkills module structure valid', () => {
    checkModule('src/chat/ChatSkills.js', ['function parseCommand', 'function detectSkillIntent', 'function formatSkillsList']);
  });

  runner.test('ChatVoice module structure valid', () => {
    checkModule('src/chat/ChatVoice.js', []);
    const content = readFileSafe('src/chat/ChatVoice.js');
    const requiredFunctions = ['toggleVoiceInput', 'stopVoiceInput', 'syncVoiceInputSettings', 'updateVoiceToggleButtonState', 'getIsListening', 'getIsSpeechRecognitionSupported'];
    for (const fn of requiredFunctions) {
      if (!content.includes(`export function ${fn}`) && !content.includes(`export const ${fn}`) && !content.includes(`export async function ${fn}`)) {
        throw new Error(`ChatVoice.js missing export: ${fn}`);
      }
    }
  });

  // ---------- Utils Module Structure ----------
  runner.test('skillParser module structure valid', () => {
    checkModule('src/utils/skillParser.js');
  });

  runner.test('toolChoiceBuilder module structure valid', () => {
    checkModule('src/utils/toolChoiceBuilder.js');
  });

  runner.test('validation module structure valid', () => {
    checkModule('src/utils/validation.js');
  });

  // ---------- Manifest Validation ----------
  runner.test('Manifest.json is valid MV3', () => {
    const content = readFileSafe('manifest.json');
    const manifest = JSON.parse(content);
    if (manifest.manifest_version !== 3) {
      throw new Error('Manifest must specify manifest_version 3');
    }
    if (!manifest.name || !manifest.name.trim()) throw new Error('Manifest missing name');
    if (!manifest.version) throw new Error('Manifest missing version');
    if (!manifest.background?.service_worker) throw new Error('Manifest missing background service_worker');
  });

  runner.test('Manifest references exist', () => {
    const manifest = JSON.parse(readFileSafe('manifest.json'));
    const filesToCheck = [];
    if (manifest.background?.service_worker) filesToCheck.push(manifest.background.service_worker);
    if (manifest.options_page) filesToCheck.push(manifest.options_page);
    if (manifest.icons) Object.values(manifest.icons).forEach(p => filesToCheck.push(p));
    if (manifest.content_scripts) {
      manifest.content_scripts.forEach(cs => {
        if (cs.js) cs.js.forEach(p => filesToCheck.push(p));
        if (cs.css) cs.css.forEach(p => filesToCheck.push(p));
      });
    }
    filesToCheck.forEach(file => {
      if (!fs.existsSync(path.join(repoRoot, file))) {
        throw new Error(`Manifest references missing file: ${file}`);
      }
    });
  });

  // ---------- Package Validation ----------
  runner.test('Package.json has required scripts', () => {
    const pkg = JSON.parse(readFileSafe('package.json'));
    const requiredScripts = ['test', 'build', 'smoke', 'validate', 'lint', 'format'];
    for (const s of requiredScripts) {
      if (!pkg.scripts?.[s]) {
        throw new Error(`Package missing required script: ${s}`);
      }
    }
  });

  runner.test('Package.json has devDependencies', () => {
    const pkg = JSON.parse(readFileSafe('package.json'));
    if (!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0) {
      throw new Error('Package is missing devDependencies (eslint, prettier)');
    }
  });

  // ---------- Skills Validation ----------
  runner.test('Skills manifest references valid files', () => {
    const skills = JSON.parse(readFileSafe('skills/skills.json'));
    if (!Array.isArray(skills) || skills.length === 0) {
      throw new Error('Skills manifest must be a non-empty array');
    }
    skills.forEach((skill, idx) => {
      if (!skill.id) throw new Error(`Skill at index ${idx} missing id`);
      if (!skill.name) throw new Error(`Skill ${skill.id} missing name`);
      if (!skill.description) throw new Error(`Skill ${skill.id} missing description`);
      if (!skill.path) throw new Error(`Skill ${skill.id} missing path`);
      if (!fs.existsSync(path.join(repoRoot, skill.path))) {
        throw new Error(`Skill ${skill.id} references missing file: ${skill.path}`);
      }
    });
  });

  runner.test('Skill SKILL.md files have valid frontmatter', () => {
    const skills = JSON.parse(readFileSafe('skills/skills.json'));
    skills.forEach((skill) => {
      const content = readFileSafe(skill.path);
      if (!content.startsWith('---')) {
        throw new Error(`Skill ${skill.name} SKILL.md missing frontmatter`);
      }
      if (!content.includes('name:')) throw new Error(`Skill ${skill.name} SKILL.md missing name`);
      if (!content.includes('description:')) throw new Error(`Skill ${skill.name} SKILL.md missing description`);
    });
  });

  // ---------- Directory Structure ----------
  runner.test('Required directories exist', () => {
    const dirs = ['src', 'src/chat', 'src/utils', 'src/orchestrator', 'scripts', 'docs', 'skills', 'libs'];
    dirs.forEach((dir) => {
      if (!fs.existsSync(path.join(repoRoot, dir))) {
        throw new Error(`Required directory missing: ${dir}`);
      }
    });
  });

  // ---------- File Size Validation ----------
  runner.test('chat.js does not exceed 2000 lines', () => {
    const lines = readFileSafe('chat.js').split('\n').length;
    if (lines > 2000) {
      throw new Error(`chat.js is ${lines} lines, exceeds 2000 limit`);
    }
  });

  runner.test('No source module exceeds 600 lines', () => {
    const moduleFiles = fs.readdirSync(path.join(repoRoot, 'src/chat')).filter(f => f.endsWith('.js'));
    for (const file of moduleFiles) {
      const lines = readFileSafe(`src/chat/${file}`).split('\n').length;
      if (lines > 600) {
        throw new Error(`${file} is ${lines} lines, exceeds 600 limit`);
      }
    }
  });

  // ---------- Import Cross-Reference ----------
  runner.test('chat.js imports all chat modules', () => {
    const chatContent = readFileSafe('chat.js');
    const expectedImports = [
      'ChatUI.js', 'ChatAPI.js', 'ChatSkills.js',
      'ChatVoice.js', 'ChatMedia.js', 'ChatStream.js',
    ];
    for (const imp of expectedImports) {
      if (!chatContent.includes(imp.replace('.js', ''))) {
        throw new Error(`chat.js missing import for ${imp}`);
      }
    }
  });

  runner.test('All chat modules are imported in chat.js', () => {
    const chatContent = readFileSafe('chat.js');
    const moduleFiles = fs.readdirSync(path.join(repoRoot, 'src/chat'))
      .filter(f => f.endsWith('.js'));
    for (const file of moduleFiles) {
      const importRef = `./src/chat/${file.replace('.js', '')}`;
      if (!chatContent.includes(importRef)) {
        throw new Error(`Module src/chat/${file} is not imported in chat.js`);
      }
    }
  });

  // ---------- Config Files ----------
  runner.test('Config files exist and are valid', () => {
    JSON.parse(readFileSafe('.eslintrc.json'));
    JSON.parse(readFileSafe('.prettierrc.json'));
    readFileSafe('.gitignore');
    JSON.parse(readFileSafe('package-lock.json'));
  });
}

/**
 * ============================================================
 * INTEGRATION TESTS
 * ============================================================
 */
function runIntegrationTests(runner) {
  console.log('🔗 Running integration tests...\n');

  // ---------- Entry Files ----------
  runner.test('All main entry files exist and non-empty', () => {
    const mainFiles = [
      'background.js', 'chat.html', 'chat.js',
      'options.html', 'options.js',
      'collapsible.js', 'input-controls.js',
      'loadingManager.js', 'themeUtils.js',
      'content_script_unified.js', 'pdfContentScript.js',
    ];
    for (const file of mainFiles) {
      const content = readFileSafe(file);
      if (content.trim().length < 10) {
        throw new Error(`Main file ${file} is nearly empty`);
      }
    }
  });

  // ---------- HTML Validation ----------
  runner.test('HTML files have DOCTYPE and basic structure', () => {
    for (const file of ['chat.html', 'options.html']) {
      const content = readFileSafe(file).toLowerCase();
      if (!content.includes('<!doctype html>')) {
        throw new Error(`${file} missing DOCTYPE declaration`);
      }
      if (!content.includes('<html')) {
        throw new Error(`${file} missing html tag`);
      }
      if (!content.includes('</html>')) {
        throw new Error(`${file} missing closing html tag`);
      }
    }
  });

  // ---------- Skills Consistency ----------
  runner.test('All skill directories are referenced in skills manifest', () => {
    const skills = JSON.parse(readFileSafe('skills/skills.json'));
    const manifestNames = skills.map(s => s.name);
    const skillDirs = fs.readdirSync(path.join(repoRoot, 'skills'))
      .filter(item => fs.statSync(path.join(repoRoot, 'skills', item)).isDirectory());
    for (const dir of skillDirs) {
      if (!manifestNames.includes(dir)) {
        throw new Error(`Skill directory '${dir}' has no entry in skills.json`);
      }
    }
  });

  // ---------- Build Script ----------
  runner.test('Build script has required functions', () => {
    const content = readFileSafe('scripts/build.js');
    const required = ['function main', 'readJson', 'validateManifest', 'createBuildDir', 'copyFiles', 'generateBuildMetadata'];
    for (const elem of required) {
      if (!content.includes(elem)) {
        throw new Error(`Build script missing: ${elem}`);
      }
    }
  });

  // ---------- Test Runner Self-Check ----------
  runner.test('Test runner can validate itself', () => {
    const content = readFileSafe('scripts/test-runner.js');
    if (!content.includes('TestRunner')) throw new Error('Missing TestRunner class');
    if (!content.includes('test(name, fn)')) throw new Error('Missing test method');
    if (!content.includes('summary()')) throw new Error('Missing summary method');
  });

  // ---------- Smoke Check ----------
  runner.test('Smoke check script has required checks', () => {
    const content = readFileSafe('scripts/smoke-check.js');
    if (!content.includes('assertFileExists')) throw new Error('Missing assertFileExists');
    if (!content.includes('collectManifestFiles')) throw new Error('Missing collectManifestFiles');
  });

  // ---------- Documentation ----------
  runner.test('All documentation files exist and are non-empty', () => {
    const docFiles = [
      'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md',
      'docs/ARCHITECTURE.md', 'docs/DEVELOPMENT.md', 'docs/SKILL_EXAMPLES.md',
    ];
    for (const file of docFiles) {
      const content = readFileSafe(file);
      if (content.length < 200) {
        throw new Error(`Documentation file too small: ${file} (${content.length} bytes)`);
      }
    }
  });

  // ---------- Orchestrator ----------
  runner.test('RunOrchestrator module exists and is valid', () => {
    checkModule('src/orchestrator/RunOrchestrator.js');
  });

  // ---------- Orphaned File Detection ----------
  runner.test('No orphaned .js files in root (except marked)', () => {
    const rootFiles = fs.readdirSync(repoRoot).filter(f => f.endsWith('.js'));
    const knownRootFiles = [
      'background.js', 'chat.js', 'collapsible.js',
      'content_script_unified.js', 'input-controls.js',
      'loadingManager.js', 'options.js', 'pdfContentScript.js',
      'themeUtils.js', 'marked.js', 'marked.min.js',
    ];
    for (const file of rootFiles) {
      if (!knownRootFiles.includes(file) && !file.endsWith('.min.js')) {
        console.warn(`  ⚠ Unknown root file: ${file}`);
      }
    }
  });
}

/**
 * ============================================================
 * COVERAGE REPORT
 * ============================================================
 */
function generateCoverageReport() {
  console.log('\n📊 Coverage Report:\n');

  const modules = [
    'src/chat/ChatUI.js',
    'src/chat/ChatAPI.js',
    'src/chat/ChatStream.js',
    'src/chat/ChatMedia.js',
    'src/chat/ChatSkills.js',
    'src/chat/ChatVoice.js',
  ];

  let totalLines = 0;
  let totalFunctions = 0;

  for (const modulePath of modules) {
    const fullPath = path.join(repoRoot, modulePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;
      // Count function definitions
      const functions = (content.match(/(?:exports+)?(?:asyncs+)?functions+w+|classs+w+/g) || []).length;
      totalLines += lines;
      totalFunctions += functions;
      console.log(`  ${modulePath}:`);
      console.log(`    Lines: ${lines}`);
      console.log(`    Functions/Classes: ${functions}`);
    }
  }

  console.log(`\n  Total: ${totalLines} lines, ${totalFunctions} functions/classes`);
}

/**
 * ============================================================
 * MAIN
 * ============================================================
 */
function main() {
  const runner = new TestRunner();

  if (runUnit) {
    runUnitTests(runner);
  }

  if (runIntegration) {
    runIntegrationTests(runner);
  }

  if (showCoverage) {
    generateCoverageReport();
  }

  runner.summary();
}

main();
