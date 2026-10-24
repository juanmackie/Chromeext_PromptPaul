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
 * Read and parse a repository JSON file, failing loudly with the file name.
 * @param {string} relativePath
 * @returns {object}
 */
function readJson(relativePath) {
  try {
    return JSON.parse(readFileSafe(relativePath));
  } catch (error) {
    throw new Error(`${relativePath} is not valid JSON: ${error.message}`);
  }
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
 * Find browser source modules so architectural import rules cover new files too.
 * @param {string} directory
 * @returns {string[]}
 */
function listSourceModules(directory) {
  const entries = fs.readdirSync(path.join(repoRoot, directory), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceModules(relativePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [relativePath] : [];
  });
}

/**
 * Read local static and dynamic import specifiers from a source module.
 * The project uses plain JavaScript imports, so this small scanner keeps the
 * structural runner independent of a separate parser dependency.
 * @param {string} source
 * @returns {string[]}
 */
function getImportSpecifiers(source) {
  const imports = [];
  const pattern =
    /\bimport\s+(?:[^'";]+?\s+from\s+)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    imports.push(match[2] || match[4]);
  }
  return imports;
}

/**
 * Resolve a relative source import to a repository-relative path.
 * @param {string} fromPath
 * @param {string} specifier
 * @returns {string|null}
 */
function resolveSourceImport(fromPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolutePath = path.resolve(repoRoot, path.dirname(fromPath), specifier);
  const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
  return relativePath.startsWith('src/') ? relativePath : null;
}

/**
 * Treat files directly under src/ as shared entry modules; folders own areas.
 * @param {string} relativePath
 * @returns {string}
 */
function getSourceArea(relativePath) {
  const segments = relativePath.split('/');
  return segments.length === 2 ? 'shared' : segments[1];
}

/**
 * Validate current source ownership rules. Entry points compose capabilities;
 * capability modules do not import other capability internals. Shared helpers
 * do not depend on UI or orchestration modules, except for the eval-only trace
 * adapter that normalizes terminal outcomes in evaluation builds.
 */
function checkSourceImportDirections() {
  const sharedAreas = new Set(['utils', 'shared', 'prompts.js']);
  const applicationAreas = new Set(['chat', 'options', 'orchestrator']);
  const evaluationAdapterImports = new Set([
    'src/utils/evalTrace.eval.js -> src/orchestrator/ActOutcome.js',
  ]);

  for (const fromPath of listSourceModules('src')) {
    const fromArea = getSourceArea(fromPath);
    const isShared = sharedAreas.has(fromArea);
    const isApplication = applicationAreas.has(fromArea);
    const source = readFileSafe(fromPath);

    for (const specifier of getImportSpecifiers(source)) {
      const toPath = resolveSourceImport(fromPath, specifier);
      if (!toPath) continue;
      const toArea = getSourceArea(toPath);
      const toIsShared = sharedAreas.has(toArea);
      const toIsApplication = applicationAreas.has(toArea);
      const toIsCapability = !toIsShared && !toIsApplication;
      const edge = `${fromPath} -> ${toPath}`;

      if (isApplication && toIsApplication && fromArea !== toArea) {
        throw new Error(`Application areas must not import one another: ${edge}`);
      }
      if (isShared && !toIsShared && !evaluationAdapterImports.has(edge)) {
        throw new Error(
          `Shared source must not depend on application or capability areas: ${edge}`
        );
      }
      if (!isShared && !isApplication && toIsApplication) {
        throw new Error(`Capability modules must not import application areas: ${edge}`);
      }
      if (!isShared && !isApplication && toIsCapability && fromArea !== toArea) {
        throw new Error(`Capability modules must not import another capability: ${edge}`);
      }
      if (isApplication && toIsCapability && path.posix.basename(toPath) !== 'index.js') {
        throw new Error(`Application areas must import capabilities through index.js: ${edge}`);
      }
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
      'sidebar-model-value',
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
    const requiredFunctions = [
      'getApiConfig',
      'getTools',
      'startRun',
      'resumeActRun',
      'executeRun',
      'abortRun',
    ];
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
      'normalizeAvailableModels',
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

  runner.test('development diagnostics module is build-gated and bounded', () => {
    checkModule('src/utils/devDiagnostics.js');
    const content = readFileSafe('src/utils/devDiagnostics.js');
    for (const token of [
      'promptPaulDevDiagnosticsConfigV1',
      'promptPaulDevDiagnosticsV1',
      'MAX_TOTAL_CHARS',
      'SECRET_KEY_PATTERN',
      'options.persist',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`devDiagnostics.js missing contract token: ${token}`);
      }
    }
    const production = readFileSafe('src/utils/devDiagnostics.prod.js');
    if (production.includes('console.debug') || production.includes('chrome.storage.session')) {
      throw new Error('Production diagnostics module must remain a no-op');
    }
    for (const file of ['content_script_diagnostics.prod.js']) {
      if (readFileSafe(file).includes('sendMessage')) {
        throw new Error(`${file} must remain a no-op`);
      }
    }
  });

  runner.test('evaluation hook is build-gated and bounded', () => {
    checkModule('src/utils/evalHook.js');
    checkModule('src/utils/evalTrace.js');
    const hook = readFileSafe('src/utils/evalHook.js');
    const trace = readFileSafe('src/utils/evalTrace.js');
    const evaluationHook = readFileSafe('src/utils/evalHook.eval.js');
    const evaluationTrace = readFileSafe('src/utils/evalTrace.eval.js');
    const build = readFileSafe('scripts/build.js');
    if (hook.includes('TEST_RUN_TASK') || trace.includes('TEST_RUN_TASK')) {
      throw new Error('Source evaluation interfaces must remain no-op');
    }
    for (const token of ['TEST_RUN_TASK', 'MAX_TASK_CHARS', 'dryRun']) {
      if (!evaluationHook.includes(token)) {
        throw new Error(`Evaluation hook is missing contract token: ${token}`);
      }
    }
    for (const token of ['MAX_TRACE_CHARS', 'MAX_STEPS', 'SECRET_KEY_PATTERN']) {
      if (!evaluationTrace.includes(token)) {
        throw new Error(`Evaluation trace is missing contract token: ${token}`);
      }
    }
    for (const token of ['--eval', 'dist-eval', 'installEvalVariant']) {
      if (!build.includes(token)) {
        throw new Error(`Build script is missing evaluation variant support: ${token}`);
      }
    }
    if (!readFileSafe('.gitignore').includes('dist-eval/')) {
      throw new Error('Generated eval output must remain ignored');
    }
  });

  runner.test('validation module structure valid', () => {
    checkModule('src/utils/validation.js');
  });

  runner.test('Act recovery utility modules are valid', () => {
    checkModule('src/utils/retryBackoff.js', ['function getRetryDelay', 'function waitForRetry']);
    checkModule('src/utils/pageActionCheckpoint.js', [
      'function savePageActionCheckpoint',
      'function clearPageActionCheckpoint',
      'function listPageActionCheckpoints',
    ]);
    const checkpoint = readFileSafe('src/utils/pageActionCheckpoint.js');
    for (const token of [
      'chrome.storage.session',
      'maxRecords',
      'maxGoals',
      'Sensitive task detail',
    ]) {
      if (!checkpoint.includes(token)) {
        throw new Error(`Act checkpoint utility is missing its bound: ${token}`);
      }
    }
  });

  runner.test('contextBudget module structure valid', () => {
    checkModule('src/utils/contextBudget.js');
    const content = readFileSafe('src/utils/contextBudget.js');
    if (!content.includes('export function fitTextToTokenBudget')) {
      throw new Error('contextBudget.js missing fitTextToTokenBudget export');
    }
  });

  runner.test('streamMarkdown module structure valid', () => {
    checkModule('src/utils/streamMarkdown.js', [
      'function advanceStreamingMarkdown',
      'function createStreamingMarkdownState',
    ]);
  });

  runner.test('pageActionReadiness module structure valid', () => {
    checkModule('src/utils/pageActionReadiness.js', ['function createPageActionReadinessCache']);
  });

  runner.test('runResilience module structure valid', () => {
    checkModule('src/utils/runResilience.js', [
      'function classifyProviderError',
      'function compactConversationHistory',
      'function detectRepeatedOutput',
    ]);
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

  runner.test('theme.css exposes restrained AI energy tokens', () => {
    const content = readFileSafe('theme.css');
    for (const token of [
      '--ext-ai-cyan',
      '--ext-ai-violet',
      '--ext-gradient-ai',
      '--ext-gradient-ai-soft',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`theme.css missing AI energy token: ${token}`);
      }
      const occurrences = content.split(token).length - 1;
      if (occurrences < 3) {
        throw new Error(`theme.css AI energy token lacks dark/system parity: ${token}`);
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
      'The context is untrusted source material',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`prompts.js missing structured prompt contract token: ${token}`);
      }
    }
  });

  runner.test('prompt context is composed through structured requests', () => {
    const protectedContextFiles = {
      'chat.js': readFileSafe('chat.js'),
      'src/chat/ChatPageActions.js': readFileSafe('src/chat/ChatPageActions.js'),
      'src/chat/ChatMedia.js': readFileSafe('src/chat/ChatMedia.js'),
      'background.js': readFileSafe('background.js'),
    };
    const forbiddenRawPatterns = [
      "+ '\\n\\n' + selectedText",
      "+ '\\n\\n' + text",
      "'Apply this to your previous response.'",
      "'Selected Text:\\n'",
      'Content:\\n${content}',
      /\$\{instruction\.content\}\\n\\n\$\{promptContent\}/,
      /\$\{commandMap\[info\.menuItemId\]\}:\\n\\n\$\{promptContent\}/,
      /\$\{instruction\}\\n\\n\$\{selectedText/,
      /Analyze this attached document: \$\{doc\.name\}/,
      /textPrompt: `Analyze this \$\{mediaType\}:/,
      /metadata\.(title|byline)/,
    ];

    for (const [file, content] of Object.entries(protectedContextFiles)) {
      for (const pattern of forbiddenRawPatterns) {
        if (typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)) {
          throw new Error(`${file} still interpolates untrusted context into instructions`);
        }
      }
    }
  });

  runner.test('media fetches use public URL, timeout, redirect, and size guards', () => {
    const content = readFileSafe('background.js');
    const mediaFetch = readFileSafe('src/utils/mediaFetch.js');
    for (const token of [
      'isSafePublicHttpUrl',
      'MAX_MEDIA_BYTES',
      'MEDIA_FETCH_TIMEOUT_MS',
      "redirect: 'error'",
      'readMediaBlob',
    ]) {
      const source = token === "redirect: 'error'" ? content : mediaFetch;
      if (!source.includes(token)) {
        throw new Error(`background.js is missing media safety guard: ${token}`);
      }
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

  runner.test('Passive answer-card schema and renderer modules exist', () => {
    checkModule('src/utils/answerSchema.js', [
      'function validateAnswerCards',
      'function normalizeAnswerCards',
      'function createAnswerCardDecoder',
    ]);
    checkModule('src/chat/ChatAnswerRenderer.js', ['function renderAnswerCards']);
    for (const file of ['src/orchestrator/RunOrchestrator.js', 'src/chat/ChatAnswerRenderer.js']) {
      if (!readFileSafe(file).includes('answerSchema.js')) {
        throw new Error(`${file} must use the shared bounded answer-card contract`);
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

  runner.test('Act benchmark tasks match their local fixtures', () => {
    const suite = readFileSafe('scripts/act-benchmark.js');
    const fixture = readFileSafe('tests/browser/fixtures/act-benchmark.html');
    const taskIds = [...suite.matchAll(/^ {4}id: '([a-z0-9-]+)',\r?$/gmu)].map((match) => match[1]);
    if (taskIds.length < 5) throw new Error('Act benchmark task list looks truncated');
    const missing = taskIds.filter(
      (id) =>
        !fixture.includes(`kind === '${id}'`) &&
        !(id.startsWith('gmail-') && fixture.includes("kind.startsWith('gmail-')"))
    );
    if (missing.length) {
      throw new Error(`Benchmark tasks without a fixture branch: ${missing.join(', ')}`);
    }
  });

  // ---------- Manifest Validation ----------
  runner.test('Manifest.json is valid MV3', () => {
    const manifest = readJson('manifest.json');
    if (manifest.manifest_version !== 3) {
      throw new Error('Manifest must specify manifest_version 3');
    }
    if (!manifest.name || !manifest.name.trim()) throw new Error('Manifest missing name');
    if (!manifest.version) throw new Error('Manifest missing version');
    if (!manifest.background?.service_worker)
      throw new Error('Manifest missing background service_worker');
  });

  runner.test('Manifest references exist', () => {
    const manifest = readJson('manifest.json');
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

  runner.test('Development diagnostics content bridges are wired', () => {
    const manifest = readJson('manifest.json');
    const pageBridge = manifest.content_scripts?.find((entry) =>
      entry.js?.includes('content_script_page_diagnostics.js')
    );
    if (!pageBridge || pageBridge.world !== 'MAIN' || pageBridge.run_at !== 'document_start') {
      throw new Error('Manifest must load the main-world diagnostics bridge at document start');
    }
    if (!readFileSafe('content_script_diagnostics.js').includes("action: 'devDiagnostic'")) {
      throw new Error('Isolated diagnostics bridge must forward structured records');
    }
  });

  runner.test('Optional notch is registered dynamically and isolated', () => {
    const manifest = readJson('manifest.json');
    if (manifest.content_scripts?.some((entry) => entry.js?.includes('content_script_notch.js'))) {
      throw new Error('Optional notch must not load on every page');
    }
    const background = readFileSafe('background.js');
    if (
      !background.includes("const dynamicNotchScriptId = 'prompt-paul-notch'") ||
      !background.includes('chrome.scripting.registerContentScripts') ||
      !background.includes('syncDynamicNotchScript')
    ) {
      throw new Error('Background must register the notch only while the preference is enabled');
    }
    if (!readFileSafe('scripts/build.js').includes("'content_script_notch.js'")) {
      throw new Error('Build must package the on-demand notch script');
    }
    const notch = readFileSafe('content_script_notch.js');
    if (!notch.includes("attachShadow({ mode: 'open' })")) {
      throw new Error('Notch must use Shadow DOM isolation');
    }
    if (!notch.includes("const STORAGE_KEY = 'notchEnabled'")) {
      throw new Error('Notch must use the persistent notchEnabled preference');
    }
    if (!notch.includes("const PINNED_ACTIONS_KEY = 'pinnedQuickActions'")) {
      throw new Error('Notch must render saved pinned prompts');
    }
    if (!notch.includes('MAX_PINNED_ACTIONS = 4')) {
      throw new Error('Notch must keep the pinned prompt list bounded');
    }
    if (
      !notch.includes('notchActRunState') ||
      !notch.includes('startDictation') ||
      !notch.includes('notch-act-form') ||
      !notch.includes('includePageContext') ||
      !notch.includes('THEME_PREFERENCE_KEY') ||
      !notch.includes("data-theme='light'") ||
      !notch.includes('notch-energy-flow') ||
      !notch.includes('notch-signal') ||
      !notch.includes("const POSITION_STORAGE_KEY = 'notchPosition'") ||
      !notch.includes("const PLACEMENT_STORAGE_KEY = 'notchPlacement'") ||
      !notch.includes('beginNotchDrag') ||
      !notch.includes('pointerenter') ||
      !notch.includes('setPinned')
    ) {
      throw new Error(
        'Notch must expose Act activity, dictation, edge placement, and drag controls'
      );
    }
    if (!notch.includes('extension context invalidated') || !notch.includes('try {')) {
      throw new Error('Notch runtime messaging must handle invalidated extension contexts');
    }
  });

  runner.test('Notch actions use an allowlisted sender-bound bridge', () => {
    const background = readFileSafe('background.js');
    for (const token of [
      'const NOTCH_ACTIONS = new Set([',
      "'openActions',",
      "'runPinnedInstruction',",
      "'sendInstruction',",
      'notchPinnedAction',
      'notchInstructionAction',
      'pageActionActivityHandler',
      'NOTCH_MAX_INSTRUCTION_CHARS',
      'includePageContext',
      'isContentScriptSender(sender, extensionOrigin)',
      'requestMatchesSenderTab(sender, request?.tabId)',
      'NOTCH_MAX_PAGE_CHARS',
    ]) {
      if (!background.includes(token)) {
        throw new Error(`Notch bridge missing security guard: ${token}`);
      }
    }
  });

  runner.test('Manifest scopes Outlook compose adapter to Outlook hosts', () => {
    const manifest = readJson('manifest.json');
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
    const pkg = readJson('package.json');
    const requiredScripts = ['test', 'build', 'smoke', 'validate', 'audit', 'lint', 'format'];
    for (const s of requiredScripts) {
      if (!pkg.scripts?.[s]) {
        throw new Error(`Package missing required script: ${s}`);
      }
    }
  });

  runner.test('Production readiness guardrails are present', () => {
    const pkg = readJson('package.json');
    const requiredScripts = [
      'lint',
      'format:check',
      'test',
      'test:behavior',
      'test:browser',
      'smoke',
      'validate',
      'audit',
    ];
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
      'npm run audit',
    ]) {
      if (!readinessDoc.includes(phrase)) {
        throw new Error(`Production readiness documentation is missing: ${phrase}`);
      }
    }

    const sourceFiles = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (
          ['artifacts', 'node_modules', 'dist', 'libs', '.git', '.pi', '.pi-subagents'].includes(
            entry.name
          )
        ) {
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
    const pkg = readJson('package.json');
    if (!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0) {
      throw new Error('Package is missing devDependencies (eslint, prettier)');
    }
  });

  // ---------- Skills Validation ----------
  runner.test('Skills manifest references valid files', () => {
    const skills = readJson('skills/skills.json');
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
    const skills = readJson('skills/skills.json');
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

  runner.test('panel context handoff preserves rejected one-off actions', () => {
    const background = readFileSafe('background.js');
    const chat = readFileSafe('chat.js');

    if (!background.includes('result.response && result.response.ignored !== true')) {
      throw new Error('background.js must queue panel messages explicitly rejected by the panel');
    }
    if (!chat.includes('// Keep the action queued.')) {
      throw new Error('chat.js must preserve queued actions rejected by another panel');
    }
    const mismatchStart = chat.indexOf('if (pendingAction.tabId && panelTabId');
    const mismatchEnd = chat.indexOf('let consumed = false;', mismatchStart);
    if (mismatchStart < 0 || mismatchEnd < 0) {
      throw new Error('chat.js pending panel action ownership guard is missing');
    }
    if (chat.slice(mismatchStart, mismatchEnd).includes('chrome.storage.session.remove')) {
      throw new Error('chat.js must not delete a pending action rejected by another panel');
    }
  });

  runner.test('notch dictation attaches bounded page context', () => {
    const notch = readFileSafe('content_script_notch.js');
    const chat = readFileSafe('chat.js');
    const background = readFileSafe('background.js');
    for (const token of [
      'includePageContext: true',
      'request.includePageContext === true',
      "type: 'page_content'",
    ]) {
      if (!notch.includes(token) && !chat.includes(token) && !background.includes(token)) {
        throw new Error(`Notch dictation page-context guard missing: ${token}`);
      }
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
      'function runWithResponseGuard(run)',
      'const token = beginResponseRun()',
      'endResponseRun(token)',
      'submitBtn.disabled = true',
      'submitBtn.disabled = false',
    ];

    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`chat.js missing response guard token: ${token}`);
      }
    }
  });

  runner.test('chat.js starts every response run through the guard wrapper', () => {
    const content = readFileSafe('chat.js');
    const definitionStart = content.indexOf('function beginResponseRun()');
    const definitionEnd = content.indexOf('function rejectResponseRun()', definitionStart);
    const wrapperStart = content.indexOf('async function runWithResponseGuard(');
    const wrapperEnd = content.indexOf('function resetRunUi(', wrapperStart);
    if (
      definitionStart === -1 ||
      definitionEnd === -1 ||
      wrapperStart === -1 ||
      wrapperEnd === -1
    ) {
      throw new Error('chat.js missing the response guard definition or wrapper');
    }

    for (
      let index = content.indexOf('beginResponseRun(');
      index !== -1;
      index = content.indexOf('beginResponseRun(', index + 1)
    ) {
      const inDefinition = index >= definitionStart && index < definitionEnd;
      const inWrapper = index >= wrapperStart && index < wrapperEnd;
      if (!inDefinition && !inWrapper) {
        throw new Error('chat.js claims a response run outside runWithResponseGuard');
      }
    }

    const wrapperCalls = content.match(/runWithResponseGuard\(/g) || [];
    if (wrapperCalls.length !== 4) {
      throw new Error(
        'Expected exactly one wrapper call per run entry point (makeApiCall, makeApiCallWithMedia, resumeActCheckpoint)'
      );
    }
  });

  runner.test('chat.js starts the resume entry point through the response guard wrapper', () => {
    const content = readFileSafe('chat.js');
    const start = content.indexOf('async function resumeActCheckpoint(');
    const end = content.indexOf('\n  async function onActFreshInspection(', start);
    if (start === -1 || end === -1) {
      throw new Error('chat.js missing the resumeActCheckpoint run entry point');
    }
    const body = content.slice(start, end);
    if (!body.includes('runWithResponseGuard(') || body.includes('beginResponseRun(')) {
      throw new Error('resumeActCheckpoint must start through runWithResponseGuard');
    }
  });

  runner.test('chat.js never lets a stale terminal finalize a live run', () => {
    const content = readFileSafe('chat.js');
    const required = [
      'const terminalTargetsPanelRun =',
      '(!currentRunId && !isResponseInFlight) || runId === currentRunId',
      'finalizeStreamingBubbleForTerminal(event)',
      'function finalizeStreamingBubbleForTerminal(event)',
    ];
    for (const token of required) {
      if (!content.includes(token)) {
        throw new Error(`chat.js missing stale-terminal ownership token: ${token}`);
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
    readJson('.eslintrc.json');
    readJson('.prettierrc.json');
    readFileSafe('.gitignore');
    readJson('package-lock.json');
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
      'readCurrentPageSelection(getRunSourceTabId())',
      'executeSelectedTextMode(lastUsedPreset)',
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

  runner.test('Source modules respect capability import directions', () => {
    checkSourceImportDirections();
  });

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
      'themePreference',
      'notchEnabledToggle',
      'saveNotch',
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

  runner.test('options.js ships the starter OpenRouter profile', () => {
    const content = readFileSafe('options.js');
    for (const token of [
      'STARTER_OPENROUTER_ENDPOINT',
      'STARTER_OPENROUTER_API_KEY',
      'STARTER_OPENROUTER_MODEL',
      'https://openrouter.ai/api/v1/chat/completions',
      'openrouter/free',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`options.js missing starter OpenRouter configuration: ${token}`);
      }
    }
    if (!content.includes("const STARTER_OPENROUTER_API_KEY = '';")) {
      throw new Error('options.js must not ship a hardcoded starter credential');
    }
    if (/mistral|PROMPT_PAUL_DEMO_API_KEY/i.test(content + readFileSafe('scripts/build.js'))) {
      throw new Error('Options starter flow must not retain the retired Mistral or demo-key path');
    }
  });

  runner.test('options.html explains the OpenRouter free-model quick start', () => {
    const content = readFileSafe('options.html');
    for (const token of [
      'https://openrouter.ai/keys',
      'https://openrouter.ai/api/v1/chat/completions',
      'https://openrouter.ai/collections/free-models',
      'openrouter/free',
      'Quality may vary with less capable models.',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`options.html missing OpenRouter quick-start guidance: ${token}`);
      }
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
    for (const token of [
      'normalizeProfileRecord(profileToUpdate)',
      'normalizeProfileRecord(defaultProfile)',
      'normalizeProfileRecord(newProfile)',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`options.js must normalize profile writes: ${token}`);
      }
    }
  });

  runner.test('options imports are bounded and normalized', () => {
    const content = readFileSafe('options.js');
    for (const token of [
      'MAX_IMPORT_FILE_BYTES',
      'MAX_IMPORTED_RECORDS',
      'MAX_SKILL_MARKDOWN_CHARS',
      'readBoundedResponseText',
      'normalizeInstructionRecord',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`options.js is missing import boundary: ${token}`);
      }
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

  runner.test('Options connection setup is profile-first', () => {
    const html = readFileSafe('options.html');
    const options = readFileSafe('options.js');
    const styles = readFileSafe('options.css');
    const profileIndex = html.indexOf('id="profileSelect"');
    const providerIndex = html.indexOf('id="providerSelect"');
    if (profileIndex < 0 || providerIndex < 0 || profileIndex > providerIndex) {
      throw new Error('The connection profile must appear before the provider controls');
    }
    if ((html.match(/id="profileSelect"/g) || []).length !== 1) {
      throw new Error('The Options page must have one connection profile selector');
    }
    for (const token of [
      'profileProviderBadge',
      'providerModelControls',
      'Response defaults',
      'Appearance',
    ]) {
      if (!html.includes(token)) throw new Error(`Options UX contract missing: ${token}`);
    }
    for (const token of [
      'requestNewProfile',
      'newProfileProviderInput',
      'providerLabel',
      'getHermesEndpoint',
      'Save Settings before testing the Hermes connection.',
      'API Key (optional)',
      "apiKey.required = provider === 'api'",
      'providerSelect.disabled',
    ]) {
      if (!options.includes(token)) throw new Error(`options.js UX contract missing: ${token}`);
    }
    for (const token of ['.profile-selector-bar', '.options-disclosure']) {
      if (!styles.includes(token)) throw new Error(`options.css UX contract missing: ${token}`);
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
      'externalTabId',
      'Number.isInteger(sender?.tab?.id)',
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

  runner.test('background.js keeps one panel-action identity across retries and queueing', () => {
    const content = readFileSafe('background.js');
    for (const token of [
      'const message = payload.actionId',
      'chrome.runtime.sendMessage(message, (response) => {',
      'await queuePendingPanelAction(message)',
    ]) {
      if (!content.includes(token)) {
        throw new Error(`sendPanelMessage must reuse one actionId for every delivery: ${token}`);
      }
    }
  });

  runner.test('options.js opens Open Chat in the side panel', () => {
    const content = readFileSafe('options.js');
    if (!content.includes('chrome.sidePanel') || !content.includes('WINDOW_ID_CURRENT')) {
      throw new Error('options.js Open Chat does not open the current window side panel');
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
      'exaSearchApiKey',
      'webSearchEnabled',
      'searchProvider',
      'pageActionsEnabled',
      'pageActionsTrustedMode',
      'pageActionsPreciseInput',
      'notchPosition',
      'pinnedQuickActions',
      'customSiteSuggestions',
      'hermesApiKeys',
      'hermesSessions',
      'hermesSessionKeys',
      'promptPaulActCheckpointsV1',
      'pageActionSitePolicies',
    ];
    const sources = [
      'options.js',
      'background.js',
      'chat.js',
      'src/chat/ChatVoice.js',
      'src/utils/suggestionStorage.js',
      'src/utils/pageActionCheckpoint.js',
      'src/utils/pageActionSitePolicies.js',
      'content_script_notch.js',
    ]
      .map(readFileSafe)
      .join('\n');
    for (const key of canonicalKeys) {
      if (!sources.includes(key)) {
        throw new Error(`Canonical storage key no longer referenced anywhere: ${key}`);
      }
    }
  });

  runner.test('precise input keeps chrome.debugger contained to the Input allowlist', () => {
    const manifest = JSON.parse(readFileSafe('manifest.json'));
    if (!manifest.permissions?.includes('debugger')) {
      throw new Error(
        'The debugger permission must be declared for the opt-in precise-input mode.'
      );
    }
    const backendPath = path.join(repoRoot, 'src/orchestrator/CdpInputBackend.js');
    const backend = fs.readFileSync(backendPath, 'utf8');
    for (const method of [
      'Input.dispatchMouseEvent',
      'Input.dispatchKeyEvent',
      'Input.insertText',
    ]) {
      if (!backend.includes(method)) throw new Error(`Precise-input method is missing: ${method}`);
    }
    for (const forbidden of [
      ['Runtime', '.'].join(''),
      ['Page', '.captureScreenshot'].join(''),
      ['DOM', '.'].join(''),
      ['Network', '.'].join(''),
    ]) {
      if (backend.includes(forbidden)) {
        throw new Error(`Precise-input backend exposes a forbidden CDP namespace: ${forbidden}`);
      }
    }
    const appFiles = fs.readdirSync(repoRoot).filter((file) => file.endsWith('.js'));
    const sourceFiles = [...appFiles.map((file) => path.join(repoRoot, file))];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.isFile() && entry.name.endsWith('.js')) sourceFiles.push(fullPath);
      }
    };
    visit(path.join(repoRoot, 'src'));
    for (const file of sourceFiles) {
      if (file === backendPath) continue;
      if (fs.readFileSync(file, 'utf8').includes(['chrome', '.debugger'].join(''))) {
        throw new Error(
          `chrome.debugger must stay inside CdpInputBackend.js: ${path.relative(repoRoot, file)}`
        );
      }
    }
  });

  runner.test('Hermes credentials and session pointers stay out of backups', () => {
    const validation = readFileSafe('src/utils/validation.js');
    const sources = [readFileSafe('options.js'), readFileSafe('background.js')].join('\n');
    for (const key of ['hermesApiKeys', 'hermesSessions', 'hermesSessionKeys']) {
      if (!sources.includes(key)) throw new Error(`Hermes storage key is not wired: ${key}`);
      if (validation.includes(`'${key}'`)) {
        throw new Error(
          `Hermes secret or session key must not be included in backup allowlists: ${key}`
        );
      }
    }
  });

  runner.test('Hermes New chat ends only the selected session', () => {
    const background = readFileSafe('background.js');
    const chat = readFileSafe('chat.js');
    const composer = readFileSafe('src/chat/ChatComposer.js');
    const resetStart = background.indexOf("request.action === 'endHermesConversation'");
    const orchestrationStart = background.indexOf('// ===== Orchestration Handlers =====');
    if (resetStart < 0 || orchestrationStart <= resetStart) {
      throw new Error('Hermes New chat handler is missing.');
    }
    const resetHandler = background.slice(resetStart, orchestrationStart);
    for (const token of [
      'activeHermesRun',
      'hermesTransport.endSession',
      'hermesTransport.clearStoredSession',
      'Stop the active Hermes response before starting a new chat.',
    ]) {
      if (!resetHandler.includes(token)) {
        throw new Error(`Hermes New chat handler missing guard: ${token}`);
      }
    }
    if (resetHandler.includes('HERMES_SESSION_KEYS_KEY')) {
      throw new Error('Hermes New chat must not rotate or delete the memory key.');
    }
    for (const token of [
      'createConversationController',
      "config?.provider === 'hermes'",
      "action: 'endHermesConversation'",
      'clearLocal:',
    ]) {
      if (!`${chat}\n${composer}`.includes(token)) {
        throw new Error(`Chat New chat wiring missing: ${token}`);
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
    if (!htmlContent.includes('Backup files do not contain credentials')) {
      throw new Error('options.html must disclose that backup credentials are excluded');
    }
    if (!optionsContent.includes('normalizeBackupPayload({ local: localData, sync: syncData })')) {
      throw new Error('Backup export must use the validated, credential-free payload');
    }
  });

  runner.test('chat run bridge excludes provider credentials', () => {
    const chat = readFileSafe('chat.js');
    const chatApi = readFileSafe('src/chat/ChatAPI.js');
    if (chat.includes('apiKey:')) {
      throw new Error('chat.js must not place provider credentials in run messages');
    }
    if (!chatApi.includes('delete safeRunConfig.apiKey')) {
      throw new Error('ChatAPI must strip provider credentials before the background bridge');
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
    if (!content.includes('MAX_TOOL_ARGUMENTS_BYTES')) {
      throw new Error('Background custom-tool arguments must be bounded');
    }
  });

  runner.test('endpoint UI uses the shared HTTP(S) validator', () => {
    const controls = readFileSafe('input-controls.js');
    const html = readFileSafe('options.html');
    if (!controls.includes("import { isValidHttpUrl } from './src/utils/validation.js';")) {
      throw new Error('input-controls.js must use the shared HTTP(S) validator');
    }
    if (controls.includes("startsWith('https://')")) {
      throw new Error('input-controls.js contains a stale HTTPS-only validator');
    }
    if (!html.includes('<script type="module" src="input-controls.js"></script>')) {
      throw new Error('input-controls.js must load as an ES module');
    }
  });

  runner.test('privileged runtime messages enforce sender and run ownership', () => {
    const background = readFileSafe('background.js');
    const auth = readFileSafe('src/utils/runtimeAuthorization.js');
    const chatApi = readFileSafe('src/chat/ChatAPI.js');
    const harness = readFileSafe('tests/browser/extension-harness.js');
    for (const token of [
      'isContentScriptSender',
      'requestMatchesSenderTab',
      'isRunOwner',
      'resolveStoredRunConfig',
      'normalizeProfileRecord',
      'isAuthorizedRunRequest',
      'ownerToken',
      'getRunOwnerToken',
    ]) {
      if (![background, auth, chatApi, harness].some((content) => content.includes(token))) {
        throw new Error(`Runtime authorization contract is missing: ${token}`);
      }
    }
    for (const token of [
      "request.action === 'captureScreenshot'",
      "request.action === 'getTabContent'",
      "request.action === 'startRun'",
      "request.action === 'resumeActRun'",
      "request.action === 'executeRun'",
      "request.action === 'executeTool'",
      "request.action === 'abortRun'",
    ]) {
      if (!background.includes(token)) {
        throw new Error(`Background handler is missing authorization coverage: ${token}`);
      }
    }
  });

  runner.test('provider streams and error bodies are bounded', () => {
    const sources = [
      readFileSafe('src/utils/streamSafety.js'),
      readFileSafe('src/orchestrator/RunOrchestrator.js'),
      readFileSafe('src/orchestrator/CodexTransport.js'),
      readFileSafe('src/orchestrator/HermesTransport.js'),
      readFileSafe('src/utils/braveSearch.js'),
    ].join('\n');
    for (const token of [
      'MAX_SSE_BUFFER_BYTES',
      'MAX_PROVIDER_ERROR_BYTES',
      'appendBoundedSseBuffer',
      'readBoundedResponseText',
    ]) {
      if (!sources.includes(token)) {
        throw new Error(`Provider response bound is missing: ${token}`);
      }
    }
    if (sources.includes('buffer += decoder.decode(value, { stream: true })')) {
      throw new Error('Provider SSE buffers must use the bounded append helper');
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
    const content = readFileSafe('content_script_page_actions.js');
    const extraction = readFileSafe('content_script_unified.js');
    const build = readFileSafe('scripts/build.js');
    const orchestrator = readFileSafe('src/orchestrator/RunOrchestrator.js');
    const policy = readFileSafe('src/utils/pageActionPolicy.js');
    const background = readFileSafe('background.js');
    const chat = readFileSafe('chat.js');
    const card = readFileSafe('src/chat/ChatPageAutomation.js');
    const scopeDiff = readFileSafe('src/utils/pageActionScopeDiff.js');
    if (extraction.includes('PAGE_ACTION_MAX_ELEMENTS')) {
      throw new Error('Page-action runtime must stay out of the always-on extraction script');
    }
    if (
      !background.includes("'content_script_page_actions.js'") ||
      !build.includes("'content_script_page_actions.js'")
    ) {
      throw new Error('On-demand page-action runtime must be injected and packaged');
    }
    for (const token of [
      'pageActionSessions',
      'PAGE_ACTION_MAX_ELEMENTS',
      'PAGE_ACTION_MAX_PAYLOAD_BYTES',
      'PAGE_ACTION_MAX_OUTLINE_CHARS',
      'PAGE_ACTION_MAX_VALUE_CHARS',
      'PAGE_ACTION_MAX_TOTAL_VALUE_CHARS',
      'buildPageActionOutline',
      'walkPageActionNodes',
      'elementIds: new WeakMap()',
      'getPageActionElementId',
      'computeAccessibleName',
      'pageActionPing',
      'sanitizePageActionUrl',
      'clearPageActionHighlight',
      'pageAction',
      'editable: Boolean(element.isContentEditable)',
      'element.checked === true',
      "getAttribute('autocomplete')",
      'PAGE_ACTION_TARGET_OCCLUDED',
    ]) {
      if (!content.includes(token))
        throw new Error(`Content script missing page-action guard: ${token}`);
    }
    // The occlusion gate must run before any click is dispatched. A covered
    // target would otherwise receive the pointer sequence and click meant for a
    // different control, which the page reads as a real interaction. The hit
    // test and the dispatch are synchronous, so source order is the enforceable
    // invariant that keeps the DOM untouched on this path.
    const occlusionGateIndex = content.indexOf('if (clickTarget.covered)');
    const clickDispatchIndex = content.indexOf(
      'dispatchPageActionClick(clickTarget.deliveryElement, clickTarget.point)'
    );
    if (occlusionGateIndex < 0 || clickDispatchIndex < 0) {
      throw new Error('Page-action click dispatch must be guarded by the occlusion gate');
    }
    if (occlusionGateIndex > clickDispatchIndex) {
      throw new Error('The occlusion gate must precede click dispatch');
    }
    if (!content.includes('error.preDispatch = true')) {
      throw new Error('The occlusion failure must be marked as pre-dispatch');
    }
    if (!background.includes('if (response.preDispatch === true) error.preDispatch = true;')) {
      throw new Error('The background bridge must preserve the pre-dispatch signal');
    }
    for (const token of [
      'page_get_state',
      'page_click',
      'page_hover',
      'page_go_back',
      'page_input',
      'page_set_value',
      'page_keypress',
      'page_select',
      'page_scroll',
      'page_find_text',
      'page_request_user_input',
      'page_open_tab',
      'page_open_link',
      'resolvePageActionDecision',
      'sessionApproval',
      'page_action_confirmation',
      '_terminateRun',
      "state: 'error'",
      'page_pause_for_user',
      'actionReceipt',
      'scopeDiff',
      '_savePageActionCheckpoint',
      'finalVerificationCompleted',
      '_restoreActCheckpoint',
      'isPageActionPreDispatchFailure',
      '_refundPageActionBudget',
      'pre_dispatch_blocked',
    ]) {
      if (!orchestrator.includes(token))
        throw new Error(`Orchestrator missing page-action contract: ${token}`);
    }
    for (const token of [
      'buildIndexedPageRegions',
      'diffPageActionSnapshots',
      'measurePageActionScopeDiff',
    ]) {
      if (!scopeDiff.includes(token))
        throw new Error(`Scope/diff utility missing evaluation contract: ${token}`);
    }
    for (const token of [
      'PAGE_ACTION_RISKS',
      'evaluatePageActionPolicy',
      'sensitive',
      'navigation: true',
      'PAGE_ACTION_OCCLUSION_CODE',
      'buildPageActionOcclusionFailure',
    ]) {
      if (!policy.includes(token))
        throw new Error(`Page-action policy missing safety contract: ${token}`);
    }
    const accessibilityLicense = readFileSafe('libs/dom-accessibility-api.LICENSE.md');
    if (!accessibilityLicense.includes('MIT License')) {
      throw new Error('Vendored dom-accessibility-api is missing its MIT license record');
    }
    for (const token of [
      'libs/dom-accessibility-api.js',
      'pageActionPing',
      'PAGE_ACTION_NO_CONTENT_SCRIPT',
      'PAGE_ACTION_TIMEOUT',
      'finish(null, error)',
      'Approval decisions must come from the Prompt Paul extension.',
      'pageActionDocumentProvider',
      'pageManualInterventionResume',
    ]) {
      if (!background.includes(token))
        throw new Error(`Background missing page-action bridge guard: ${token}`);
    }
    for (const token of ["state === 'error'", 'abortRun(runId)', 'pageActionDecision']) {
      if (!chat.includes(token)) throw new Error(`Chat missing page-action UI guard: ${token}`);
    }
    for (const token of [
      "'Stop'",
      "'Approve similar actions this run'",
      'page-action-confirmation-context',
      'page_manual_intervention_request',
      'activeTab',
      'onStop',
    ]) {
      if (!card.includes(token))
        throw new Error(`Approval card missing context/Stop contract: ${token}`);
    }
    if (orchestrator.includes('execute_javascript')) {
      throw new Error('Page-action orchestrator must not expose arbitrary JavaScript execution');
    }
  });

  runner.test('Act working memory is bounded and excluded from durable state', () => {
    checkModule('src/orchestrator/ActWorkingMemory.js');
    const memory = readFileSafe('src/orchestrator/ActWorkingMemory.js');
    const content = readFileSafe('content_script_page_actions.js');
    const orchestrator = readFileSafe('src/orchestrator/RunOrchestrator.js');
    const checkpoint = readFileSafe('src/utils/pageActionCheckpoint.js');
    for (const token of [
      'maxEntries: 16',
      'maxVisited: 72',
      'maxPromptChars: 1_500',
      'makeActTargetKey',
      'recordActAction',
      'toggleBlockedTargetKey',
    ]) {
      if (!memory.includes(token)) throw new Error(`ActWorkingMemory missing contract: ${token}`);
    }
    if (/chrome\\.storage|savePageActionCheckpoint|recordRunJournal/u.test(memory)) {
      throw new Error('ActWorkingMemory must not persist or journal run memory');
    }
    if (/pageActions\\.memory|memory:\\s*record\\.memory/u.test(checkpoint)) {
      throw new Error('Page-action checkpoints must not serialize working memory');
    }
    const checkpointWriter = orchestrator.slice(
      orchestrator.indexOf('async _savePageActionCheckpoint'),
      orchestrator.indexOf('async _settlePageActionCheckpoint')
    );
    if (checkpointWriter.includes('pageActions.memory')) {
      throw new Error('The RunOrchestrator checkpoint writer must exclude working memory');
    }
    const progressStart = orchestrator.indexOf('_buildPageTaskProgressEvent(run)');
    const progressEnd = orchestrator.indexOf('_emitPageTaskProgress(run)', progressStart);
    if (
      progressStart < 0 ||
      progressEnd < 0 ||
      orchestrator.slice(progressStart, progressEnd).includes('memory')
    ) {
      throw new Error('Working memory must not be included in page-task journal/progress events');
    }
    for (const role of [
      'menuitem',
      'menuitemradio',
      'menuitemcheckbox',
      'option',
      'tab',
      'switch',
      'treeitem',
    ]) {
      if (!content.includes(`[role="${role}"]`)) {
        throw new Error(`ARIA page-action collector is missing ${role}`);
      }
    }
    if (
      !/const routeId = pageStateHash\(\s*`\$\{window\.location\.pathname\}\$\{window\.location\.search\}\$\{window\.location\.hash\}`\s*\);/u.test(
        content
      )
    ) {
      throw new Error('SPA route metadata must be a digest of query/fragment data');
    }
    if (!content.includes("buildPageActionReceipt('delivered_verified', 'route_changed')")) {
      throw new Error('Hash-only route changes need a verified route_changed receipt');
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
      'content_script_page_actions.js',
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
    const skills = readJson('skills/skills.json');
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
      'hasDevFlag',
      'hasProdFlag',
      'installDiagnosticsVariant',
      'generateBuildMetadata',
      'DEV_ONLY_EXCLUDES',
      'isDevOnly',
      'resolveGitInfo',
      'computeArtifactChecksum',
    ];
    for (const elem of required) {
      if (!content.includes(elem)) {
        throw new Error(`Build script missing: ${elem}`);
      }
    }
  });

  // ---------- Build Script: Packaging Allowlist (P3-02) ----------
  runner.test('Production build excludes development-only files (P3-02)', () => {
    const content = readFileSafe('scripts/build.js');
    // AGENTS.md (DOX instructions) must be excluded from the shipped package.
    if (!/DEV_ONLY_EXCLUDES\s*=\s*\[?\s*['"]AGENTS\.md['"]/.test(content)) {
      throw new Error('DEV_ONLY_EXCLUDES must include AGENTS.md');
    }
    // Exclusion must be applied in the directory copy path.
    if (!content.includes('isProd && isDevOnly(entry.name)')) {
      throw new Error('copyDir must filter dev-only files for production builds');
    }
  });

  // ---------- Build Script: Release Traceability (P3-03) ----------
  runner.test('Build metadata records real git revision and artifact checksum (P3-03)', () => {
    const content = readFileSafe('scripts/build.js');
    // Real git revision via rev-parse, not just an env fallback.
    if (!content.includes("runGit(['rev-parse', 'HEAD'])")) {
      throw new Error('Build must resolve the real git revision');
    }
    // Clean/dirty working-tree status.
    if (!content.includes("runGit(['status', '--porcelain'])")) {
      throw new Error('Build must record clean/dirty working-tree status');
    }
    // Per-file checksum manifest plus a root artifact checksum.
    if (!content.includes('artifactSha256') || !content.includes('BUILD.sha256')) {
      throw new Error('Build must produce an artifact checksum manifest');
    }
    // Reproducibility requires deterministic ordering of the checksum input.
    if (!content.includes('.sort()')) {
      throw new Error('Checksum computation must sort files for reproducibility');
    }
  });

  // ---------- Browser Harness Staging (P1-08) ----------
  runner.test('Production-output browser gate stages a test harness (P1-08)', () => {
    const wrapper = readFileSafe('scripts/test-browser-prod.js');
    const staging = readFileSafe('scripts/stage-browser-harness.js');
    // The prod runner must build, stage the harness, and point the loader at dist.
    if (!wrapper.includes("'build.js'") || !wrapper.includes("'--prod'")) {
      throw new Error('test:browser:prod runner must build production output');
    }
    if (!wrapper.includes('PROMPT_PAUL_LOAD_EXTENSION_DIR')) {
      throw new Error('test:browser:prod runner must point the loader at dist/');
    }
    if (!wrapper.includes('stage-browser-harness') && !wrapper.includes('stage()')) {
      throw new Error('test:browser:prod runner must stage the browser harness');
    }
    // The staging script must copy the harness files into the built output dir.
    if (!staging.includes('extension-harness.html') || !staging.includes('extension-harness.js')) {
      throw new Error('Harness staging must copy extension-harness.html and .js');
    }
    const packageJson = readFileSafe('package.json');
    if (!/"test:browser:prod"\s*:\s*"node scripts\/test-browser-prod\.js"/.test(packageJson)) {
      throw new Error('test:browser:prod must run the cross-platform Node wrapper');
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
      'docs/DIAGNOSTICS.md',
      'docs/FEATURE_REVIEW.md',
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
    checkModule('src/orchestrator/ServiceWorkerKeepAlive.js');
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
      'content_script_page_actions.js',
      'content_script_diagnostics.js',
      'content_script_diagnostics.prod.js',
      'content_script_page_diagnostics.js',
      'content_script_notch.js',
      'content_script_act_feedback.js',
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
