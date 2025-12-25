
import { apiClient } from '../../../background/api-client.js';

// Mock logger
jest.mock('../../../utils/logger.js', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

// Mock fetch
global.fetch = jest.fn();

describe('BackgroundApiClient Retry Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset nextRequestTime
        apiClient.nextRequestTime = 0;
    });

    test('should succeed on first attempt if no error', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ ok: true }),
        });

        const response = await apiClient.fetchWithRetry('https://api.example.com', {});
        expect(response.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('should retry on 429', async () => {
        // Mock fetch to return 429 twice, then 200
        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                headers: new Map(),
                clone: () => ({ text: () => Promise.resolve('Rate limit') }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                headers: new Map(),
                clone: () => ({ text: () => Promise.resolve('Rate limit') }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ ok: true }),
            });

        // Mock sleep to be instant
        const originalSleep = apiClient.sleep;
        apiClient.sleep = jest.fn().mockResolvedValue();

        const response = await apiClient.fetchWithRetry('https://api.example.com', {});

        expect(response.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(3);
        // Should have slept twice
        expect(apiClient.sleep).toHaveBeenCalledTimes(2);

        // Restore sleep
        apiClient.sleep = originalSleep;
    });

    test('should stop retrying on quota exceeded', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Map(),
            clone: () => ({ text: () => Promise.resolve('You have exceeded your current quota, please check your plan and billing details.') }),
        });

        await expect(apiClient.fetchWithRetry('https://api.example.com', {}))
            .rejects.toThrow('Quota Exceeded');

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('should fail after max retries', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Map(),
            clone: () => ({ text: () => Promise.resolve('Rate limit') }),
        });

        const originalSleep = apiClient.sleep;
        apiClient.sleep = jest.fn().mockResolvedValue();

        await expect(apiClient.fetchWithRetry('https://api.example.com', {}, 0, 2))
            .rejects.toThrow('max retries exceeded');

        // Initial + 2 retries = 3 calls
        expect(global.fetch).toHaveBeenCalledTimes(3);

        apiClient.sleep = originalSleep;
    });

    test('should respect Retry-After header', async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                headers: { get: (key) => key === 'Retry-After' ? '1' : null },
                clone: () => ({ text: () => Promise.resolve('Rate limit') }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
            });

        const originalSleep = apiClient.sleep;
        apiClient.sleep = jest.fn().mockResolvedValue();

        await apiClient.fetchWithRetry('https://api.example.com', {});

        expect(apiClient.sleep).toHaveBeenCalledWith(2000);

        apiClient.sleep = originalSleep;
    });
});
