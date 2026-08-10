#!/usr/bin/env node

/**
 * @fileoverview Test runner for Prompt Paul
 *
 * Responsibilities:
 * - Run unit tests for module structure and validity
 * - Run integration tests for cross-module consistency
 * - Validate code quality
 */

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();

// Parse command line arguments
const args = process.argv.slice(2);
const runUnit = args.includes('--unit') || args.length === 0;
const runIntegration = args.includes('--integration') || args.length === 0;
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

  runner.test('ChatComposer module structure valid', () => {
    checkModule('src/chat/ChatComposer.js', [
      'function getContextState',
      'function getQuickActions',
      'function getLastUserPrompt',
      'function ensureStopButton',
      'function ensureRecoveryRow',
      'function initComposer',
      'const chatComposer',
    ]);
    const content = readFileSafe('src/chat/ChatComposer.js');
    for (const token of [
      'RUN_STATES',
      'data-run-state',
      'message-actions',
      'tray.hidden !== shouldHide',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`ChatComposer.js missing contract token: ${token}`);
      }
    }
  });

  runner.test('chat.html has composer-led surfaces', () => {
    const content = readFileSafe('chat.html');
    for (const id of [
      'context-tray',
      'quick-actions-row',
      'page-context-strip',
      'page-context-remove-button',
    ]) {
      if (!content.includes(`id="${id}"`)) {
        throw new Error(`chat.html missing composer surface: ${id}`);
      }
    }
    if (!content.includes('ui-primitives.css')) {
      throw new Error('chat.html does not load ui-primitives.css');
    }
  });

  runner.test('ChatAPI module structure valid', () => {
    checkModule('src/chat/ChatAPI.js', []);
    const content = readFileSafe('src/chat/ChatAPI.js');
    const requiredFunctions = ['getApiConfig', 'getTools', 'startRun', 'executeRun', 'abortRun'];
    for (const fn of requiredFunctions) {
      if (
        !content.includes(`export async function ${fn}`) &&
        !content.includes(`export function ${fn}`)
      ) {
        throw new Error(`ChatAPI.js missing export: ${fn}`);
      }
    }
  });

  runner.test('ChatStream module structure valid', () => {
    checkModule('src/chat/ChatStream.js', ['class StreamStateManager']);
  });

  runner.test('ChatMedia module structure valid', () => {
    checkModule('src/chat/ChatMedia.js', [
      'const MediaType',
      'function validateMediaData',
      'function getMediaAnalysisPrompt',
      'function prepareMediaContent',
      'function hasValidMediaData',
      'function getMediaDisplayName',
      'function supportsVisionAnalysis',
    ]);
  });

  runner.test('ChatMedia clipboard helper exists', () => {
    const content = readFileSafe('src/chat/ChatMedia.js');
    if (!content.includes('export function readBlobAsBase64')) {
      throw new Error('ChatMedia.js missing readBlobAsBase64 export');
    }
    if (!content.includes('export function readFileAsBase64')) {
      throw new Error('ChatMedia.js missing readFileAsBase64 export');
    }
  });

  runner.test('ChatSkills module structure valid', () => {
    checkModule('src/chat/ChatSkills.js', [
      'function parseCommand',
      'function detectSkillIntent',
      'function formatSkillsList',
    ]);
  });

  runner.test('ChatVoice module structure valid', () => {
    checkModule('src/chat/ChatVoice.js', []);
    const content = readFileSafe('src/chat/ChatVoice.js');
    const requiredFunctions = [
      'toggleVoiceInput',
      'stopVoiceInput',
      'syncVoiceInputSettings',
      'updateVoiceToggleButtonState',
      'getIsListening',
      'getIsSpeechRecognitionSupported',
    ];
    for (const fn of requiredFunctions) {
      if (
        !content.includes(`export function ${fn}`) &&
        !content.includes(`export const ${fn}`) &&
        !content.includes(`export async function ${fn}`)
      ) {
        throw new Error(`ChatVoice.js missing export: ${fn}`);
      }
    }
  });

  // ---------- Utils Module Structure ----------
  runner.test('skillParser module structure valid', () => {
    checkModule('src/utils/skillParser.js');
  });

  runner.test('modelDiscovery module structure valid', () => {
    checkModule('src/utils/modelDiscovery.js', [
      'function normalizeAvailableModels',
      'function deriveModelsEndpoint',
      'async function fetchAvailableModels',
    ]);
    const content = readFileSafe('src/utils/modelDiscovery.js');
    for (const token of [
      'createCodexModelHeaders',
      'CODEX_MODELS_ENDPOINT',
      'return normalizeAvailableModels',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`modelDiscovery.js missing contract token: ${token}`);
      }
    }
    if (content.includes('return { ...auth') || content.includes('return auth')) {
      throw new Error('modelDiscovery.js must not return authentication records');
    }
  });

  runner.test('toolChoiceBuilder module structure valid', () => {
    checkModule('src/utils/toolChoiceBuilder.js');
  });

  runner.test('validation module structure valid', () => {
    checkModule('src/utils/validation.js');
  });

  runner.test('contextBudget module structure valid', () => {
    checkModule('src/utils/contextBudget.js');
    const content = readFileSafe('src/utils/contextBudget.js');
    if (!content.includes('export function fitTextToTokenBudget')) {
      throw new Error('contextBudget.js missing fitTextToTokenBudget export');
    }
  });

  runner.test('runState module structure valid', () => {
    checkModule('src/utils/runState.js', [
      'const RUN_STATES',
      'function isRunState',
      'function isActiveRunState',
      'function setRunState',
      'function getRunState',
    ]);
  });

  runner.test('shared UI primitives stylesheet exists', () => {
    const content = readFileSafe('ui-primitives.css');
    const requiredPrimitives = [
      '.ext-btn',
      '.ext-chip',
      '.ext-badge',
      '.ext-tray',
      '.ext-section',
      'data-run-state',
      '.ext-run-indicator',
      '.ext-run-banner',
      'prefers-reduced-motion',
    ];
    for (const token of requiredPrimitives) {
      if (!content.includes(token)) {
        throw new Error(`ui-primitives.css missing primitive: ${token}`);
      }
    }
  });

  runner.test('theme.css exposes semantic feedback tokens', () => {
    const content = readFileSafe('theme.css');
    for (const token of [
      '--ext-success',
      '--ext-success-deep',
      '--ext-success-bright',
      '--ext-success-foreground',
      '--ext-success-muted',
      '--ext-warning',
      '--ext-warning-deep',
      '--ext-warning-foreground',
      '--ext-warning-muted',
      '--ext-info',
      '--ext-info-deep',
      '--ext-info-foreground',
      '--ext-info-muted',
      '--ext-running',
      '--ext-running-muted',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`theme.css missing feedback token: ${token}`);
      }
      // Light + dark + system-preference blocks must all define feedback tokens.
      const occurrences = content.split(token).length - 1;
      if (occurrences < 3) {
        throw new Error(
          `theme.css feedback token ${token} lacks dark/system parity (${occurrences} blocks)`
        );
      }
    }
  });

  runner.test('prompts module exposes structured prompt composition', () => {
    checkModule('src/prompts.js', ['function composeUserPrompt']);
    const content = readFileSafe('src/prompts.js');
    for (const token of [
      'selected_text',
      'page_content',
      'previous_response',
      'Use the context as source material for the task',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`prompts.js missing structured prompt contract token: ${token}`);
      }
    }
  });

  runner.test('prompt context is composed through structured requests', () => {
    const chatContent = readFileSafe('chat.js');
    const pageActionsContent = readFileSafe('src/chat/ChatPageActions.js');
    const forbiddenRawPatterns = [
      "+ '\\n\\n' + selectedText",
      "+ '\\n\\n' + text",
      "'Apply this to your previous response.'",
      "'Selected Text:\\n'",
      'Content:\\n${content}',
    ];

    for (const file of ['chat.js', 'src/chat/ChatPageActions.js']) {
      const content = file === 'chat.js' ? chatContent : pageActionsContent;
      for (const pattern of forbiddenRawPatterns) {
        if (content.includes(pattern)) {
          throw new Error(`${file} still concatenates context directly: ${pattern}`);
        }
      }
    }
  });

  runner.test('readStrategy module structure valid', () => {
    checkModule('src/utils/readStrategy.js');
    const content = readFileSafe('src/utils/readStrategy.js');
    if (!content.includes('export function determineReadStrategy')) {
      throw new Error('readStrategy.js missing determineReadStrategy export');
    }
  });

  runner.test('runtimeErrors module structure valid', () => {
    checkModule('src/utils/runtimeErrors.js');
    const content = readFileSafe('src/utils/runtimeErrors.js');
    if (!content.includes('export function friendlyRuntimeErrorMessage')) {
      throw new Error('runtimeErrors.js missing friendlyRuntimeErrorMessage export');
    }
  });

  runner.test('DOM sanitizer module exists and is referenced by chat surfaces', () => {
    checkModule('src/utils/domSanitizer.js', [
      'function escapeHtml',
      'function sanitizeHtml',
      'function renderMarkdown',
    ]);
    for (const file of ['src/chat/ChatUI.js', 'src/chat/ChatStream.js', 'chat.js', 'options.js']) {
      if (!readFileSafe(file).includes('domSanitizer')) {
        throw new Error(`${file} does not reference domSanitizer`);
      }
    }
  });

  runner.test('permissionGuards module structure valid', () => {
    checkModule('src/utils/permissionGuards.js');
    const content = readFileSafe('src/utils/permissionGuards.js');
    if (!content.includes('export function isRestrictedBrowserUrl')) {
      throw new Error('permissionGuards.js missing isRestrictedBrowserUrl export');
    }
  });

  runner.test('suggestionStorage normalizes and caps suggestions', () => {
    const content = readFileSafe('src/utils/suggestionStorage.js');
    if (!content.includes('MAX_SUGGESTIONS = 60')) {
      throw new Error('suggestionStorage.js should cap suggestions to 60');
    }
    if (!content.includes('normalizeSuggestions')) {
      throw new Error('suggestionStorage.js missing normalization logic');
    }
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
    if (!manifest.background?.service_worker)
      throw new Error('Manifest missing background service_worker');
  });

  runner.test('Manifest references exist', () => {
    const manifest = JSON.parse(readFileSafe('manifest.json'));
    const filesToCheck = [];
    if (manifest.background?.service_worker) filesToCheck.push(manifest.background.service_worker);
    if (manifest.options_page) filesToCheck.push(manifest.options_page);
    if (manifest.icons) Object.values(manifest.icons).forEach((p) => filesToCheck.push(p));
    if (manifest.content_scripts) {
      manifest.content_scripts.forEach((cs) => {
        if (cs.js) cs.js.forEach((p) => filesToCheck.push(p));
        if (cs.css) cs.css.forEach((p) => filesToCheck.push(p));
      });
    }
    filesToCheck.forEach((file) => {
      if (!fs.existsSync(path.join(repoRoot, file))) {
        throw new Error(`Manifest references missing file: ${file}`);
      }
    });
  });

  runner.test('Manifest scopes Outlook compose adapter to Outlook hosts', () => {
    const manifest = JSON.parse(readFileSafe('manifest.json'));
    const outlookScript = manifest.content_scripts?.find(
      (entry) =>
        Array.isArray(entry.matches) &&
        entry.matches.includes('https://outlook.com/*') &&
        entry.matches.includes('https://*.outlook.com/*') &&
        entry.matches.includes('https://outlook.office.com/*') &&
        entry.matches.includes('https://outlook.office365.com/*') &&
        entry.matches.includes('https://outlook.live.com/*') &&
        entry.matches.includes('https://outlook.cloud.microsoft/*')
    );

    if (!outlookScript) {
      throw new Error('Manifest is missing the Outlook compose content script entry');
    }
    if (
      !Array.isArray(outlookScript.js) ||
      !outlookScript.js.includes('content_script_outlook_compose.js')
    ) {
      throw new Error('Outlook compose content script is not referenced in the manifest');
    }
    if (outlookScript.all_frames !== true) {
      throw new Error('Outlook compose adapter should be injected into all frames');
    }
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

  runner.test('Production readiness guardrails are present', () => {
    const pkg = JSON.parse(readFileSafe('package.json'));
    const requiredScripts = ['lint', 'format:check', 'test', 'test:behavior', 'smoke', 'validate'];
    for (const script of requiredScripts) {
      if (typeof pkg.scripts?.[script] !== 'string') {
        throw new Error(`package.json is missing the production gate: ${script}`);
      }
    }

    const gitignore = readFileSafe('.gitignore');
    for (const entry of ['.env', '.env.local', 'coverage/', 'test-results/']) {
      if (!gitignore.includes(entry)) {
        throw new Error(`.gitignore is missing the sensitive or generated path: ${entry}`);
      }
    }

    const readinessDoc = readFileSafe('docs/PRODUCTION_READINESS.md');
    for (const phrase of [
      'Validate and bound user input',
      'Never commit secrets',
      'Add readable tests',
      'npm audit --audit-level=high --omit=optional',
    ]) {
      if (!readinessDoc.includes(phrase)) {
        throw new Error(`Production readiness documentation is missing: ${phrase}`);
      }
    }

    const sourceFiles = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (['node_modules', 'dist', 'libs', '.git', '.pi', '.pi-subagents'].includes(entry.name)) {
          continue;
        }
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) sourceFiles.push(fullPath);
      }
    };
    visit(repoRoot);

    const secretPatterns = [
      /\bsk-[A-Za-z0-9]{20,}\b/,
      /\bAIza[A-Za-z0-9_-]{20,}\b/,
      /\bBearer\s+[A-Za-z0-9._-]{20,}\b/,
      /\b(?:xox[baprs]|gh[pousr])-[A-Za-z0-9_-]{20,}\b/,
      /\bAKIA[A-Z0-9]{16}\b/,
    ];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (secretPatterns.some((pattern) => pattern.test(content))) {
        throw new Error(`Possible hardcoded credential found in ${path.relative(repoRoot, file)}`);
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
      if (!content.includes('description:'))
        throw new Error(`Skill ${skill.name} SKILL.md missing description`);
    });
  });

  // ---------- Directory Structure ----------
  runner.test('Required directories exist', () => {
    const dirs = [
      'src',
      'src/chat',
      'src/utils',
      'src/orchestrator',
      'scripts',
      'docs',
      'skills',
      'libs',
    ];
    dirs.forEach((dir) => {
      if (!fs.existsSync(path.join(repoRoot, dir))) {
        throw new Error(`Required directory missing: ${dir}`);
      }
    });
  });

  // ---------- File Size Validation ----------
  // Limit reflects the composer-led refactor: new composer UI (context tray,
  // quick actions, inline recovery) lives in src/chat/ChatComposer.js, keeping
  // chat.js growth small and modular.
  runner.test('chat.js does not exceed 2380 lines', () => {
    const lines = readFileSafe('chat.js').trimEnd().split('\n').length;
    if (lines > 2380) {
      throw new Error(`chat.js is ${lines} lines, exceeds 2380 limit`);
    }
  });

  runner.test('No source module exceeds 600 lines', () => {
    const moduleFiles = fs
      .readdirSync(path.join(repoRoot, 'src/chat'))
      .filter((f) => f.endsWith('.js'));
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
      'ChatUI.js',
      'ChatAPI.js',
      'ChatSkills.js',
      'ChatVoice.js',
      'ChatMedia.js',
      'ChatStream.js',
      'ChatComposer.js',
    ];
    for (const imp of expectedImports) {
      if (!chatContent.includes(imp.replace('.js', ''))) {
        throw new Error(`chat.js missing import for ${imp}`);
      }
    }
  });

  runner.test('All chat modules are imported in chat.js', () => {
    const chatContent = readFileSafe('chat.js');
    const moduleFiles = fs
      .readdirSync(path.join(repoRoot, 'src/chat'))
      .filter((f) => f.endsWith('.js'));
    for (const file of moduleFiles) {
      const importRef = `./src/chat/${file.replace('.js', '')}`;
      if (!chatContent.includes(importRef)) {
        throw new Error(`Module src/chat/${file} is not imported in chat.js`);
      }
    }
  });

  runner.test('Relative imports in src/chat/*.js resolve to existing files', () => {
    const moduleFiles = fs
      .readdirSync(path.join(repoRoot, 'src/chat'))
      .filter((f) => f.endsWith('.js'));
    const importRe = /from\s+['"](\.[^'"]+\.js)['"]/g;
    for (const file of moduleFiles) {
      const content = readFileSafe(`src/chat/${file}`);
      let match;
      while ((match = importRe.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = path.resolve(repoRoot, 'src/chat', importPath);
        if (!fs.existsSync(resolved)) {
          throw new Error(
            `src/chat/${file} imports '${importPath}' but ${path.relative(repoRoot, resolved)} does not exist`
          );
        }
      }
    }
  });

  runner.test('chat.js supports clipboard image paste attachment flow', () => {
    const content = readFileSafe('chat.js');
    const required = [
      "userInput.addEventListener('paste'",
      'clipboardData.items',
      'readBlobAsBase64',
      "source: 'clipboard'",
      'setAttachmentPreview',
      'clearAttachmentPreview',
      '--chat-input-area-height',
    ];
    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`chat.js missing clipboard attachment token: ${token}`);
      }
    }
  });

  runner.test('chat.js consumes queued panel actions locally', () => {
    const content = readFileSafe('chat.js');
    const required = [
      'function applySetMediaForAnalysisAction(request)',
      'consumed = applySetSelectedTextAction(pendingAction)',
      'consumed = applySetMediaForAnalysisAction(pendingAction)',
      'chrome.storage.session.remove([PENDING_PANEL_ACTION_KEY])',
    ];

    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`chat.js missing pending panel action token: ${token}`);
      }
    }

    if (content.includes('chrome.runtime.sendMessage(pendingAction')) {
      throw new Error('chat.js should consume pending panel actions locally, not resend them');
    }
    if (content.includes('pendingActionChange')) {
      throw new Error('chat.js should not consume queued panel actions from storage change events');
    }
  });

  runner.test('chat.js routes side-panel run events by current run ID', () => {
    const content = readFileSafe('chat.js');
    const required = [
      'const currentRunId = streamState.getRunId()',
      'runId === currentRunId',
      'sourceTabsMatch',
      'sourceTabId: getRunSourceTabId()',
      'streamState.setSourceTabId(runConfig.sourceTabId)',
    ];

    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`chat.js missing side-panel event routing token: ${token}`);
      }
    }

    if (content.includes('sourceTabId === panelTabId')) {
      throw new Error('chat.js should not require side-panel events to match panelTabId');
    }
  });

  runner.test('chat.js prevents overlapping response submissions', () => {
    const content = readFileSafe('chat.js');
    const required = [
      'let isResponseInFlight = false',
      'function isResponseBusy()',
      'function beginResponseRun()',
      'if (!beginResponseRun()) return;',
      'submitBtn.disabled = true',
      'submitBtn.disabled = false',
    ];

    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`chat.js missing response guard token: ${token}`);
      }
    }
  });

  runner.test('ChatUI attachment preview helpers exist', () => {
    const content = readFileSafe('src/chat/ChatUI.js');
    const required = ['setAttachmentPreview(', 'clearAttachmentPreview(', 'attachment-strip'];
    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`ChatUI.js missing attachment preview token: ${token}`);
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

  // ---------- Regression: Stop button reverts to Clear ----------
  runner.test('Regression: Stop button reverts to Clear after response', () => {
    const chatContent = readFileSafe('chat.js');

    // Check that 'aborted' case exists in orchestratorEvent handler
    if (!chatContent.includes("case 'aborted'")) {
      throw new Error(
        "'aborted' case missing in orchestratorEvent handler - button won't reset after user stops response"
      );
    }

    // Check that 'complete' case resets the run UI (clearButton back to 'Clear')
    const completeCaseMatch = chatContent.match(/case 'complete':[\s\S]*?break;/);
    if (!completeCaseMatch) {
      throw new Error("'complete' case not found in orchestratorEvent handler");
    }
    if (
      !completeCaseMatch[0].includes("clearButton.textContent = 'Clear'") &&
      !completeCaseMatch[0].includes('resetRunUi(')
    ) {
      throw new Error(
        "'complete' case doesn't reset clearButton to 'Clear' - button will stay as 'Stop'"
      );
    }

    // Check that 'aborted' case resets the run UI (clearButton back to 'Clear')
    const abortedCaseMatch = chatContent.match(/case 'aborted':[\s\S]*?break;/);
    if (!abortedCaseMatch) {
      throw new Error("'aborted' case not found or has no break statement");
    }
    if (
      !abortedCaseMatch[0].includes("clearButton.textContent = 'Clear'") &&
      !abortedCaseMatch[0].includes('resetRunUi(')
    ) {
      throw new Error("'aborted' case doesn't reset clearButton to 'Clear'");
    }

    // The shared resetRunUi helper must restore the Clear label directly.
    const helperMatch = chatContent.match(/function resetRunUi\(runState\)\{[\s\S]*?\n {2}\}/);
    if (helperMatch && !helperMatch[0].includes("clearButton.textContent = 'Clear'")) {
      throw new Error("resetRunUi helper doesn't reset clearButton to 'Clear'");
    }
  });

  runner.test('YouTube extraction supports watch/live/shorts/embed URLs', () => {
    const content = readFileSafe('content_script_unified.js');
    const requiredPathChecks = [
      "path.startsWith('/watch')",
      "path.startsWith('/live')",
      "path.startsWith('/shorts')",
      "path.startsWith('/embed')",
    ];
    for (const check of requiredPathChecks) {
      if (!content.includes(check)) {
        throw new Error(`YouTube route support missing: ${check}`);
      }
    }
  });

  runner.test('YouTube extraction has YouTube-specific no-transcript fallback', () => {
    const content = readFileSafe('content_script_unified.js');
    if (!content.includes("type: 'youtube-error'")) {
      throw new Error("YouTube fallback type 'youtube-error' missing");
    }
    if (!content.includes('No transcript available')) {
      throw new Error('No-transcript fallback message missing');
    }
  });

  runner.test('YouTube player response does not depend on one source only', () => {
    const content = readFileSafe('content_script_unified.js');
    const requiredSources = [
      'window.ytInitialPlayerResponse',
      'findPlayerResponseInScripts()',
      'fetchPlayerFromInnerTube(videoId)',
    ];
    for (const src of requiredSources) {
      if (!content.includes(src)) {
        throw new Error(`Missing YouTube player fallback source: ${src}`);
      }
    }
  });

  runner.test('Outlook compose adapter has the runtime bridge it needs', () => {
    const content = readFileSafe('content_script_outlook_compose.js');
    const requiredTokens = [
      'openPromptPaulFromSelection',
      'Prompt Paul',
      'selectionchange',
      'outlook.com',
      'outlook.cloud.microsoft',
      'READ_HINT_SELECTOR',
      'OUTLOOK_UI_CHROME_SELECTOR',
      'prompt-paul-outlook-selection-relay',
      'window.top.postMessage',
      'showReconnectNotice',
      'reloadRequired',
      'extension context invalidated',
      'getSelectionSurface',
      'isLikelyReadRoot',
      "mode: 'read'",
    ];
    for (const token of requiredTokens) {
      if (!content.includes(token)) {
        throw new Error(`Outlook compose adapter missing token: ${token}`);
      }
    }

    const background = readFileSafe('background.js');
    if (!background.includes("request.action === 'openPromptPaulFromSelection'")) {
      throw new Error('Background.js missing openPromptPaulFromSelection handler');
    }
    if (!background.includes('openPromptPaulForSelection')) {
      throw new Error('Background.js missing openPromptPaulForSelection helper');
    }
  });

  runner.test('Chat sidebar includes a proofread quick action', () => {
    const html = readFileSafe('chat.html');
    if (!html.includes('id="proofread-button"')) {
      throw new Error('chat.html is missing the proofread quick action button');
    }
    if (!html.includes('Proofread selected text')) {
      throw new Error('chat.html proofread quick action is missing the selected-text title');
    }

    const chatContent = readFileSafe('chat.js');
    if (!chatContent.includes("key: 'proofread'")) {
      throw new Error('chat.js is missing the proofread preset mode');
    }
    if (!chatContent.includes("proofreadButton.addEventListener('click'")) {
      throw new Error('chat.js is missing the proofread sidebar button handler');
    }
  });

  runner.test('Chat sidebar routes selected-text actions without page extraction', () => {
    const chatContent = readFileSafe('chat.js');
    const requiredTokens = [
      'executePagePresetMode',
      'executeSelectedTextMode',
      'executeSelectedTextInstruction',
      'runSelectedTextPrompt',
      'getSelectedTextForAction',
      'executePagePresetMode(lastUsedPreset)',
      "executeSelectedTextMode('proofread')",
      'executeSelectedTextInstruction(instructionToExecute)',
    ];

    for (const token of requiredTokens) {
      if (!chatContent.includes(token)) {
        throw new Error(`chat.js is missing selected-text routing token: ${token}`);
      }
    }

    const forbiddenTokens = ['getPinnedActionTabContent', 'getExplainContent'];
    for (const token of forbiddenTokens) {
      if (chatContent.includes(token)) {
        throw new Error(
          `chat.js should not fetch page context for selected-text actions: ${token}`
        );
      }
    }

    const pageActions = readFileSafe('src/chat/ChatPageActions.js');
    if (!pageActions.includes("chrome.runtime.sendMessage({ action: 'getTabContent' }")) {
      throw new Error('ChatPageActions.js must keep page-context extraction for Analyze');
    }
  });
}

/**
 * ============================================================
 * INTEGRATION TESTS
 * ============================================================
 */
function runIntegrationTests(runner) {
  console.log('🔗 Running integration tests...\n');

  runner.test('OptionsUI module structure valid', () => {
    checkModule('src/options/OptionsUI.js', [
      'function createDirtyTracker',
      'function initUnsavedGuard',
      'function applyCredentialMask',
      'function resolveCredentialValue',
      'function flashSaveFeedback',
      'function renderSetupStatus',
    ]);
  });

  runner.test('options.html has chat-led setup and explicit section saves', () => {
    const content = readFileSafe('options.html');
    for (const id of [
      'setup-status-text',
      'openChatButton',
      'unsaved-banner',
      'savePrivacy',
      'saveGrounding',
    ]) {
      if (!content.includes(`id="${id}"`)) {
        throw new Error(`options.html missing setup/save surface: ${id}`);
      }
    }
    const capabilityBadges = content.split('data-capability-badge').length - 1;
    if (capabilityBadges < 4) {
      throw new Error(`options.html should mark capability sections; found ${capabilityBadges}`);
    }
    if (!content.includes('ui-primitives.css')) {
      throw new Error('options.html does not load ui-primitives.css');
    }
  });

  runner.test('options.js ships the starter Mistral profile', () => {
    const content = readFileSafe('options.js');
    for (const token of [
      'STARTER_MISTRAL_ENDPOINT',
      'STARTER_MISTRAL_API_KEY',
      'STARTER_MISTRAL_MODEL',
      'api.mistral.ai/v1/chat/completions',
      'mistral-small-latest',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`options.js missing starter Mistral configuration: ${token}`);
      }
    }
    if (!content.includes("const STARTER_MISTRAL_API_KEY = '';")) {
      throw new Error('options.js must not ship a hardcoded starter credential');
    }
    if (!readFileSafe('scripts/build.js').includes('PROMPT_PAUL_DEMO_API_KEY')) {
      throw new Error('build.js must document the explicit public demo-key injection path');
    }
  });

  runner.test('options.js masks credentials and guards unsaved changes', () => {
    const content = readFileSafe('options.js');
    for (const token of [
      'applyCredentialMask',
      'createDirtyTracker',
      'initUnsavedGuard',
      'resolveCredentialValue',
      'announceDirtyChange',
      'renderSetupStatus',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`options.js missing OptionsUI contract: ${token}`);
      }
    }
    if (content.includes("document.getElementById('apiKey').value = selectedProfile.apiKey")) {
      throw new Error('options.js loads the raw API key into the DOM field');
    }
    if (!content.includes('dataset.configured')) {
      throw new Error('options.js does not track masked credential state');
    }
  });

  runner.test('options.js escapes imported skill status output', () => {
    const content = readFileSafe('options.js');
    if (!content.includes('escapeHtml(parsed.metadata.name)')) {
      throw new Error('Imported skill names must be escaped before innerHTML rendering');
    }
    if (content.includes("parsed.metadata.name + '\"</span>'")) {
      throw new Error('Imported skill names must not be concatenated into HTML unescaped');
    }
    if (!content.includes('statusEl.textContent = `Error: ${error?.message')) {
      throw new Error('Import errors must use textContent instead of HTML rendering');
    }
  });

  runner.test('instruction action buttons use a uniform gap wrapper', () => {
    const optionsContent = readFileSafe('options.js');
    const styles = readFileSafe('options.css');
    if (!optionsContent.includes('class="instruction-actions"')) {
      throw new Error('Instruction actions are missing their spacing wrapper');
    }
    if (!styles.includes('.instruction-actions') || !styles.includes('gap: 0.5rem')) {
      throw new Error('Instruction action spacing is not defined consistently');
    }
  });

  runner.test('input-controls.js copies masked keys from storage', () => {
    const content = readFileSafe('input-controls.js');
    if (!content.includes('dataset.configured') || !content.includes('profiles')) {
      throw new Error('input-controls.js missing masked-key copy fallback');
    }
  });

  runner.test('manifest declares deep-link and toolbar entry points', () => {
    const content = readFileSafe('manifest.json');
    if (!content.includes('externally_connectable')) {
      throw new Error('manifest.json missing externally_connectable for website deep links');
    }
    if (!content.includes('promptpaul.juanmackie.com')) {
      throw new Error('manifest.json deep-link domain missing');
    }
    if (!content.includes('"action"')) {
      throw new Error('manifest.json missing toolbar action entry point');
    }
  });

  runner.test('background.js funnels deep links into canonical chat', () => {
    const content = readFileSafe('background.js');
    for (const token of [
      'async function openChatWithContext',
      'function isUsablePanelTab',
      'async function resolvePanelTabId',
      'chrome.action.onClicked',
      'chrome.runtime.onMessageExternal',
      "request.action === 'openChat'",
      'setMediaForAnalysis',
      'setSelectedText',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`background.js missing deep-link contract: ${token}`);
      }
    }
  });

  runner.test('chat.js consumes deep-link instructions', () => {
    const content = readFileSafe('chat.js');
    if (!content.includes('request.textPrompt')) {
      throw new Error('chat.js does not consume deep-link textPrompt');
    }
  });

  runner.test('options.js routes Open Chat through the canonical funnel', () => {
    const content = readFileSafe('options.js');
    if (!content.includes("{ action: 'openChat' }")) {
      throw new Error('options.js Open Chat does not use the canonical openChat action');
    }
  });

  runner.test('storage schema is stable (no retired keys)', () => {
    const canonicalKeys = [
      'profiles',
      'lastSelectedProfileId',
      'instructions',
      'customSkills',
      'promptPaulTools',
      'analyticsConsent',
      'analyticsInstance',
      'analyticsRotateAt',
      'voiceInputEnabled',
      'voiceInputPermissionState',
      'voiceInputPermissionLastChecked',
      'braveSearchApiKey',
      'webSearchEnabled',
      'pageActionsEnabled',
      'pageActionsTrustedMode',
      'pinnedQuickActions',
      'customSiteSuggestions',
    ];
    const sources = [
      'options.js',
      'background.js',
      'chat.js',
      'src/chat/ChatVoice.js',
      'src/utils/suggestionStorage.js',
    ]
      .map(readFileSafe)
      .join('\n');
    for (const key of canonicalKeys) {
      if (!sources.includes(key)) {
        throw new Error(`Canonical storage key no longer referenced anywhere: ${key}`);
      }
    }
  });

  runner.test('retired compatibility paths are absent', () => {
    const sources = [
      readFileSafe('background.js'),
      readFileSafe('chat.js'),
      readFileSafe('options.js'),
      readFileSafe('src/orchestrator/RunOrchestrator.js'),
      readFileSafe('src/utils/skillParser.js'),
      readFileSafe('src/utils/toolChoiceBuilder.js'),
    ].join('\n');
    for (const token of [
      'executePromptPaulTool',
      'executeLlmApiRequest',
      'getPinnedActionTabContent',
      'getExplainContent',
      'defaultLlmEndpoint',
      'migrateLegacySkill',
      'parametersForLlm',
      'load_skill',
    ]) {
      if (sources.includes(token)) {
        throw new Error(`Retired compatibility path remains: ${token}`);
      }
    }
  });

  runner.test('backup/import/export workflows are intact', () => {
    const optionsContent = readFileSafe('options.js');
    for (const token of [
      'setupBackupHandlers',
      'exportAllData',
      'importAllDataBtn',
      'importAllFile',
      'chrome.storage.local.get(null',
    ]) {
      if (!optionsContent.includes(token)) {
        throw new Error(`options.js backup workflow missing: ${token}`);
      }
    }
    const htmlContent = readFileSafe('options.html');
    if (!htmlContent.includes('Backup files contain API keys')) {
      throw new Error('options.html backup warning must disclose API keys');
    }
  });

  runner.test('custom-tool diagnostics do not leak endpoint or response data', () => {
    const content = readFileSafe('background.js');
    for (const token of [
      'HTTP error for ${finalEndpointUrl}',
      'Error calling endpoint ${endpointUrl}',
      'errorBody = await response.text',
    ]) {
      if (content.includes(token)) {
        throw new Error(`Custom-tool diagnostics still expose sensitive data: ${token}`);
      }
    }
    if (!content.includes('formatToolRequestError')) {
      throw new Error('Background custom-tool failures must use the redacted error formatter');
    }
  });

  runner.test('current capability entry points still exist', () => {
    const chat = readFileSafe('chat.js');
    for (const token of [
      'PRESET_MODES',
      'web-search-toggle',
      'initWebSearchToggle',
      'page-actions-toggle',
      'initPageActionsToggle',
      'toggleVoiceInput',
      'setMediaForAnalysis',
      'openPromptPaulForSelection',
    ]) {
      if (!chat.includes(token) && !readFileSafe('background.js').includes(token)) {
        throw new Error(`Retired or missing capability entry point: ${token}`);
      }
    }
  });

  runner.test('page action contracts are wired and guarded', () => {
    const content = readFileSafe('content_script_unified.js');
    const orchestrator = readFileSafe('src/orchestrator/RunOrchestrator.js');
    const policy = readFileSafe('src/utils/pageActionPolicy.js');
    const background = readFileSafe('background.js');
    const chat = readFileSafe('chat.js');
    const card = readFileSafe('src/chat/ChatPageAutomation.js');
    for (const token of [
      'pageActionSessions',
      'PAGE_ACTION_MAX_ELEMENTS',
      'PAGE_ACTION_MAX_PAYLOAD_BYTES',
      'pageActionPing',
      'sanitizePageActionUrl',
      'clearPageActionHighlight',
      'pageAction',
      'editable: Boolean(element.isContentEditable)',
      'element.checked === true',
      "getAttribute('autocomplete')",
    ]) {
      if (!content.includes(token))
        throw new Error(`Content script missing page-action guard: ${token}`);
    }
    for (const token of [
      'page_get_state',
      'page_click',
      'page_input',
      'page_select',
      'page_scroll',
      'page_request_user_input',
      'page_open_tab',
      'page_open_link',
      'resolvePageActionDecision',
      'sessionApproval',
      'page_action_confirmation',
      '_isPageActionTerminalError',
      '_terminateRun',
      "state: 'error'",
    ]) {
      if (!orchestrator.includes(token))
        throw new Error(`Orchestrator missing page-action contract: ${token}`);
    }
    for (const token of [
      'PAGE_ACTION_RISKS',
      'evaluatePageActionPolicy',
      'sensitive',
      'navigation: true',
    ]) {
      if (!policy.includes(token))
        throw new Error(`Page-action policy missing safety contract: ${token}`);
    }
    for (const token of [
      'pageActionPing',
      'PAGE_ACTION_NO_CONTENT_SCRIPT',
      'PAGE_ACTION_TIMEOUT',
      'finish(null, error)',
      'Approval decisions must come from the Prompt Paul extension.',
      'pageActionDocumentProvider',
    ]) {
      if (!background.includes(token))
        throw new Error(`Background missing page-action bridge guard: ${token}`);
    }
    for (const token of ["state === 'error'", "action: 'abortRun'", 'pageActionDecision']) {
      if (!chat.includes(token)) throw new Error(`Chat missing page-action UI guard: ${token}`);
    }
    for (const token of [
      "'Stop'",
      "'Approve all this session'",
      'page-action-confirmation-context',
      'onStop',
    ]) {
      if (!card.includes(token))
        throw new Error(`Approval card missing context/Stop contract: ${token}`);
    }
    if (orchestrator.includes('execute_javascript')) {
      throw new Error('Page-action orchestrator must not expose arbitrary JavaScript execution');
    }
  });

  // ---------- Entry Files ----------
  runner.test('All main entry files exist and non-empty', () => {
    const mainFiles = [
      'background.js',
      'chat.html',
      'chat.js',
      'options.html',
      'options.js',
      'input-controls.js',
      'loadingManager.js',
      'themeUtils.js',
      'content_script_unified.js',
      'content_script_outlook_compose.js',
      'pdfContentScript.js',
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

  runner.test('Chat input has attachment strip markup', () => {
    const content = readFileSafe('chat.html');
    const required = [
      'attachment-strip',
      'attachment-thumbnail',
      'attachment-title',
      'attachment-details',
      'attachment-remove-button',
      'Type a prompt or paste an image',
    ];
    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`chat.html missing attachment input token: ${token}`);
      }
    }
    const css = readFileSafe('chat.css');
    if (!css.includes('#attachment-strip[hidden]')) {
      throw new Error('chat.css missing hidden-state override for attachment strip');
    }
  });

  // ---------- Skills Consistency ----------
  runner.test('All skill directories are referenced in skills manifest', () => {
    const skills = JSON.parse(readFileSafe('skills/skills.json'));
    const manifestNames = skills.map((s) => s.name);
    const skillDirs = fs
      .readdirSync(path.join(repoRoot, 'skills'))
      .filter((item) => fs.statSync(path.join(repoRoot, 'skills', item)).isDirectory());
    for (const dir of skillDirs) {
      if (!manifestNames.includes(dir)) {
        throw new Error(`Skill directory '${dir}' has no entry in skills.json`);
      }
    }
  });

  // ---------- Build Script ----------
  runner.test('Build script has required functions', () => {
    const content = readFileSafe('scripts/build.js');
    const required = [
      'function main',
      'readJson',
      'validateManifest',
      'createBuildDir',
      'copyFiles',
      'generateBuildMetadata',
    ];
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
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'AGENTS.md',
      'docs/ARCHITECTURE.md',
      'docs/DEVELOPMENT.md',
      'docs/PRODUCTION_READINESS.md',
      'docs/SKILL_EXAMPLES.md',
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
    const content = readFileSafe('src/orchestrator/RunOrchestrator.js');
    for (const token of [
      'formatToolsForLlm(normalizedUserTools)',
      'MAX_TOOL_CALL_RETRIES',
      'activeToolCalls',
      '_buildSystemPrompt(run, eligibleSkills)',
      // Terminal teardown is centralized: every completion path must go through
      // _terminateRun, and the active run must be deleted inside it.
      '_terminateRun(runId, event',
      'this.activeRuns.delete(runId)',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`RunOrchestrator.js missing regression guard: ${token}`);
      }
    }
  });

  // ---------- Orphaned File Detection ----------
  runner.test('No orphaned .js files in root (except marked)', () => {
    const rootFiles = fs.readdirSync(repoRoot).filter((f) => f.endsWith('.js'));
    const knownRootFiles = [
      'background.js',
      'chat.js',
      'content_script_unified.js',
      'input-controls.js',
      'content_script_outlook_compose.js',
      'loadingManager.js',
      'options.js',
      'pdfContentScript.js',
      'themeUtils.js',
      'theme-toggle.js',
      'marked.min.js',
      'vitest.config.js',
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

  runner.summary();
}

main();
