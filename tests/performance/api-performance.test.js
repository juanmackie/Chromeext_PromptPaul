/**
 * Performance Tests - API Response Times
 * Measures API handler performance under different loads
 */

const { ApiHandler } = require('../../background/api-handler.js');
const { mediaProcessor } = require('../../background/media-processor.js');

describe('API Performance Tests', () => {
  const apiHandler = new ApiHandler();

  beforeEach(() => {
    // Mock dependencies for performance testing
    apiHandler.validateConfig = jest.fn().mockResolvedValue({
      modelName: 'test-model',
      apiKey: 'test-key',
      maxTokens: 100,
    });
    apiHandler.getAllToolDefinitions = jest.fn().mockResolvedValue([]);
  });

  test('should measure API response time under normal load', async () => {
    const start = performance.now();
    await apiHandler.makeLlmApiRequest('performance test prompt', 'perf-tab');
    const end = performance.now();

    const duration = end - start;
    console.log(`API Response Time: ${duration.toFixed(2)}ms`);

    // Threshold for normal load (adjust based on environment)
    expect(duration).toBeLessThan(5000); // 5 second max for mock
  }, 10000);

  test('should measure concurrent API calls performance', async () => {
    const start = performance.now();
    const promises = Array.from({ length: 5 }, () =>
      apiHandler.makeLlmApiRequest('concurrent test', `tab-${Math.random()}`)
    );
    await Promise.all(promises);
    const end = performance.now();

    const duration = end - start;
    const avgDuration = duration / 5;
    console.log(`Concurrent API Avg Time: ${avgDuration.toFixed(2)}ms`);

    expect(avgDuration).toBeLessThan(3000);
  }, 15000);
});

describe('Media Processing Performance', () => {
  test('should measure media fetch and base64 conversion time', async () => {
    // Use small test image data URL to avoid network
    const testImageUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

    const start = performance.now();
    const base64 = await mediaProcessor.fetchMediaAsBase64(testImageUrl);
    const end = performance.now();

    const duration = end - start;
    console.log(`Media Processing Time: ${duration.toFixed(2)}ms`);

    expect(base64).toBeDefined();
    expect(duration).toBeLessThan(1000); // Should be fast for data URL
  }, 5000);
});
