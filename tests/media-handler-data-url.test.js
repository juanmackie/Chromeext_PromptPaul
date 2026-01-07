
import { MediaHandler } from '../background/media-handler.js';

// Mock specific parts of errorHandler to avoid implementation details
jest.mock('../errorHandler.js', () => ({
    errorHandler: { uniqueError: jest.fn() },
    ErrorSeverity: { MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
    ErrorCategory: { USER_INPUT: 'USER_INPUT', NETWORK: 'NETWORK' },
    createError: (msg, details) => {
        const error = new Error(msg);
        Object.assign(error, details);
        return error;
    },
    wrapAsync: async (fn) => fn(), // Simple passthrough
}));

// Mock logger
jest.mock('../utils/logger.js', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

global.fetch = jest.fn();

describe('MediaHandler Data URL Support', () => {
    let mediaHandler;

    beforeEach(() => {
        mediaHandler = new MediaHandler();
        jest.clearAllMocks();
    });

    test('should process valid base64 data URL directly without fetch', async () => {
        // Arrange
        const base64Content = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const dataUrl = `data:image/png;base64,${base64Content}`;

        // Act
        const result = await mediaHandler.fetchMediaAsBase64(dataUrl);

        // Assert
        expect(result).toEqual({
            mimeType: 'image/png',
            base64: base64Content
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should fetch normal URLs', async () => {
        // Arrange
        const url = 'https://example.com/image.png';
        const mockArrayBuffer = new ArrayBuffer(8);
        const mockBlob = { size: 100, type: 'image/png' };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => mockArrayBuffer
        });

        // Mock FileReader because the original code uses it for blobs
        const mockFileReader = {
            readAsDataURL: jest.fn(),
            onload: null,
            onerror: null,
            result: 'data:image/png;base64,MockBase64Data'
        };

        global.FileReader = jest.fn(() => mockFileReader);

        // This is tricky because the original code uses FileReader which is async via events.
        // We'll mock detectMimeTypeFromBuffer to return something so it doesn't fail
        jest.spyOn(mediaHandler, 'detectMimeTypeFromBuffer').mockReturnValue('image/png');

        // We can't easily unit test the full FileReader flow here without a more complex setup 
        // or JSDOM with full FileReader support.
        // But the key thing we wanted to test was that data URLs *don't* hit this path.
        // So for this test, we just want to ensure fetch IS called.

        // Let's rely on the previous test proving fetch IS NOT called for data URLs.
        // And here just prove fetch IS called.
        // We might fail on the FileReader part, so let's wrap in try/catch or mock it better if needed.

        try {
            await mediaHandler.fetchMediaAsBase64(url);
        } catch (e) {
            // Ignore downstream errors, we just want to check fetch was called
        }

        expect(global.fetch).toHaveBeenCalledWith(url);
    });

    test('should handle data URL with different mime type', async () => {
        const base64 = 'c29tZSBqcGVnIGRhdGE=';
        const dataUrl = `data:image/jpeg;base64,${base64}`;

        const result = await mediaHandler.fetchMediaAsBase64(dataUrl);

        expect(result.mimeType).toEqual('image/jpeg');
        expect(result.base64).toEqual(base64);
    });
});
