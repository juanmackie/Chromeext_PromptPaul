/**
 * @fileoverview Deterministic, secret-free Act benchmark fingerprint tests.
 * @module benchmarkFingerprintTests
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const { createBenchmarkFingerprint, fingerprintEndpointIdentity } = createRequire(import.meta.url)(
  '../scripts/benchmark-fingerprint.js'
);

const temporaryDirectories = [];

function createExtension(
  files = { 'manifest.json': '{"version":"1"}', 'src/runner.js': 'fixture' }
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'act-benchmark-fingerprint-'));
  temporaryDirectories.push(directory);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return directory;
}

function buildMetadata(buildTime, dirtyPath) {
  return JSON.stringify({
    buildTime,
    buildType: 'evaluation',
    diagnostics: 'available',
    evalHook: 'available',
    version: '6.3.0',
    commit: 'fixture-commit',
    branch: 'main',
    clean: false,
    dirtyPaths: [dirtyPath],
    artifactSha256: 'stable-artifact-digest',
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Act benchmark fingerprint', () => {
  it('is stable for identical tasks, configuration, and extension contents', () => {
    const extensionDirectory = createExtension();
    const input = {
      benchmarkSchemaVersion: 2,
      provider: 'api',
      model: 'fixture-model',
      reasoningLevel: null,
      runsPerTask: 1,
      tasks: [{ id: 'fixture-task', prompt: 'Complete the local fixture.' }],
      extensionDirectory,
    };

    expect(createBenchmarkFingerprint(input)).toBe(createBenchmarkFingerprint(input));
  });

  it('changes when selected task definitions, provider/model settings, or extension files change', () => {
    const extensionDirectory = createExtension();
    const baseline = {
      benchmarkSchemaVersion: 2,
      provider: 'api',
      model: 'fixture-model',
      reasoningLevel: 'medium',
      runsPerTask: 1,
      tasks: [{ id: 'fixture-task', prompt: 'Complete the local fixture.' }],
      extensionDirectory,
    };
    const fingerprint = createBenchmarkFingerprint(baseline);

    expect(
      createBenchmarkFingerprint({
        ...baseline,
        tasks: [{ id: 'fixture-task', prompt: 'Changed task fixture.' }],
      })
    ).not.toBe(fingerprint);
    expect(createBenchmarkFingerprint({ ...baseline, provider: 'codex' })).not.toBe(fingerprint);
    expect(createBenchmarkFingerprint({ ...baseline, model: 'other-model' })).not.toBe(fingerprint);
    expect(createBenchmarkFingerprint({ ...baseline, reasoningLevel: 'high' })).not.toBe(
      fingerprint
    );
    expect(createBenchmarkFingerprint({ ...baseline, runsPerTask: 2 })).not.toBe(fingerprint);
    fs.writeFileSync(path.join(extensionDirectory, 'src/runner.js'), 'changed build');
    expect(createBenchmarkFingerprint(baseline)).not.toBe(fingerprint);
  });

  it('ignores volatile build metadata while still fingerprinting runtime files', () => {
    const extensionDirectory = createExtension({
      'manifest.json': '{"version":"1"}',
      'src/runner.js': 'runtime code',
      'build-metadata.json': buildMetadata('2026-10-10T00:00:00.000Z', 'scripts/act-benchmark.js'),
      'BUILD.sha256': 'stable runtime digest manifest',
    });
    const input = {
      benchmarkSchemaVersion: 2,
      provider: 'api',
      model: 'fixture-model',
      reasoningLevel: null,
      runsPerTask: 1,
      tasks: [{ id: 'fixture-task', prompt: 'Complete the local fixture.' }],
      extensionDirectory,
    };
    const fingerprint = createBenchmarkFingerprint(input);

    fs.writeFileSync(
      path.join(extensionDirectory, 'build-metadata.json'),
      buildMetadata('2026-10-10T00:01:00.000Z', 'tests/benchmarkFingerprint.test.js')
    );
    fs.writeFileSync(path.join(extensionDirectory, 'BUILD.sha256'), 'rewritten checksum manifest');
    expect(createBenchmarkFingerprint(input)).toBe(fingerprint);

    fs.writeFileSync(path.join(extensionDirectory, 'src/runner.js'), 'changed runtime code');
    expect(createBenchmarkFingerprint(input)).not.toBe(fingerprint);
  });

  it('fingerprints normalized endpoint routes but omits query and credential material', () => {
    const extensionDirectory = createExtension();
    const baseline = {
      benchmarkSchemaVersion: 2,
      provider: 'api',
      model: 'fixture-model',
      reasoningLevel: null,
      runsPerTask: 1,
      tasks: [{ id: 'fixture-task', prompt: 'Complete the local fixture.' }],
      extensionDirectory,
      endpoint: 'https://example.invalid/v1/chat/completions?api_key=first-secret#credential',
      apiKey: 'secret-value',
    };
    const changedSecrets = {
      ...baseline,
      endpoint: 'https://EXAMPLE.invalid:443/v1/./chat/completions?api_key=second-secret#other',
      apiKey: 'different-secret',
    };

    const fingerprint = createBenchmarkFingerprint(baseline);
    expect(createBenchmarkFingerprint(changedSecrets)).toBe(fingerprint);
    expect(
      createBenchmarkFingerprint({
        ...baseline,
        endpoint: 'https://other.invalid/v1/chat/completions',
      })
    ).not.toBe(fingerprint);
    expect(
      createBenchmarkFingerprint({
        ...baseline,
        endpoint: 'https://example.invalid/v1/responses',
      })
    ).not.toBe(fingerprint);
    expect(fingerprintEndpointIdentity(baseline.endpoint)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintEndpointIdentity(baseline.endpoint)).not.toContain('example.invalid');
    expect(() => fingerprintEndpointIdentity('https://user:pass@example.invalid/v1')).toThrow(
      'cannot contain URL credentials'
    );
  });
});
