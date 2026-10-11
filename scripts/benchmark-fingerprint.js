/**
 * @fileoverview Stable local fingerprint for an Act benchmark configuration.
 * @module benchmarkFingerprint
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NON_RUNTIME_BUILD_FILES = new Set(['build-metadata.json', 'BUILD.sha256']);

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fingerprintExtension(extensionDirectory) {
  const entries = [];
  const pendingDirectories = [''];

  while (pendingDirectories.length > 0) {
    const relativeDirectory = pendingDirectories.pop();
    const absoluteDirectory = path.join(extensionDirectory, relativeDirectory);
    const children = fs
      .readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => comparePaths(left.name, right.name));

    for (const child of children) {
      const relativePath = path.posix.join(relativeDirectory.replaceAll('\\', '/'), child.name);
      const absolutePath = path.join(extensionDirectory, relativeDirectory, child.name);
      if (child.isSymbolicLink()) {
        throw new Error(
          `Evaluation extension contains an unsupported symbolic link: ${relativePath}`
        );
      }
      if (child.isDirectory()) {
        pendingDirectories.push(relativePath);
      } else if (child.isFile()) {
        if (relativeDirectory === '' && NON_RUNTIME_BUILD_FILES.has(child.name)) continue;
        entries.push({
          path: relativePath,
          digest: crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex'),
        });
      }
    }
  }

  entries.sort((left, right) => comparePaths(left.path, right.path));
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

function fingerprintEndpointIdentity(endpoint) {
  if (!endpoint) return null;

  const parsed = new URL(endpoint);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Benchmark endpoint identity must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Benchmark endpoint identity cannot contain URL credentials.');
  }

  // The query and fragment are omitted because deployment URLs can carry tokens
  // there. The digest identifies the normalized route without persisting a URL.
  const identity = JSON.stringify({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
  });
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function createBenchmarkFingerprint({
  benchmarkSchemaVersion,
  provider,
  model,
  reasoningLevel,
  runsPerTask,
  tasks,
  endpoint,
  extensionDirectory,
}) {
  const extensionFingerprint = fingerprintExtension(extensionDirectory);
  const configuration = {
    benchmarkSchemaVersion,
    provider,
    model,
    reasoningLevel: reasoningLevel || null,
    runsPerTask,
    tasks,
    endpointIdentityDigest: fingerprintEndpointIdentity(endpoint),
    extensionFingerprint,
  };

  return crypto.createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
}

module.exports = {
  createBenchmarkFingerprint,
  fingerprintEndpointIdentity,
  fingerprintExtension,
};
