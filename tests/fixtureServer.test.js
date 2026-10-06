/**
 * @fileoverview Fixture-server robustness: malformed paths must 404, never crash.
 * @module fixtureServerTests
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { startFixtureServer } = createRequire(import.meta.url)('./browser/browserTestSupport.js');

describe('fixture server path handling', () => {
  it('answers directory and missing paths with 404 and keeps serving', async () => {
    const server = await startFixtureServer();
    try {
      const rootResponse = await fetch(`${server.url('').replace(/\/$/, '')}/`);
      expect(rootResponse.status).toBe(404);
      await rootResponse.arrayBuffer();
      const missingResponse = await fetch(server.url('no-such-fixture.html'));
      expect(missingResponse.status).toBe(404);
      await missingResponse.arrayBuffer();
      // The server must still be alive after the bad requests.
      const okResponse = await fetch(server.url('act-benchmark.html?case=autocomplete'));
      expect(okResponse.status).toBe(200);
      const body = await okResponse.text();
      expect(body).toContain('Prompt Paul local Act benchmark');
    } finally {
      await server.close();
    }
  });
});
