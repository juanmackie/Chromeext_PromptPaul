/**
 * @fileoverview Build or reuse an extension output, stage its browser harness,
 * and run the real-browser suite with forwarded Playwright arguments.
 * @module testBrowser
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { stage } = require('./stage-browser-harness');

const repoRoot = path.resolve(__dirname, '..');
const useProductionBuild = process.argv.includes('--prod');
const extensionDir =
  process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR || (useProductionBuild ? 'dist' : 'dist-dev');
const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== '--prod');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Failed to run ${command} ${args.join(' ')}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR) {
  run(process.execPath, [
    path.join('scripts', 'build.js'),
    useProductionBuild ? '--prod' : '--dev',
  ]);
}

process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR = extensionDir;
stage();

run(process.execPath, [
  path.join('node_modules', '@playwright', 'test', 'cli.js'),
  'test',
  'tests',
  'browser',
  ...playwrightArgs,
]);
