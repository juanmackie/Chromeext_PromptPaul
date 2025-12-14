/**
 * Unit Tests for MediaProcessor
 * Tests media fetching, base64 conversion, MIME detection, and validation
 */

const {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} = require('../../../mocks/error-handler.mock.js');

// Mock global fetch and FileReader
const mockFetchResponse = {
  ok: true,
  blob: jest.fn(),
  arrayBuffer: jest.fn(),
};

const mockBlob = new Blob(['test data'], { type: 'image/jpeg' });
const mockBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'; // Truncated sample

jest.mock('global.fetch', () => jest.fn());

global.fetch = jest.fn();
global.FileReader = jest.fn(() => ({
  onload: null,
  onerror: null,
  readAsDataURL: jest.fn(),
  result: ''
}));

const mockFileReader = new FileReader();
global.FileReader.mockReturnValue(mockFileReader);

// Helper to create ArrayBuffer from hex string
function createBufferFromHex(hex) {
  const matched = hex.match(/.{1,2}/g);
  if (!matched) return new ArrayBuffer(0);
  const bytes = new Uint8Array(matched.map(byte => parseInt(byte, 16)));
  return bytes.buffer;
}

describe('MediaProcessor', () => {
  let mediaProcessor;

  beforeEach(() => {
    jest.clearAllMocks();

    // Debug Class Import
    try {
      const mod = require('../../../background/media-handler.js');
      console.log('DEBUG: media-handler.js module exports:', mod);
      const { MediaHandler } = mod;
      console.log('DEBUG: MediaHandler class:', MediaHandler);
      mediaProcessor = new MediaHandler();
    } catch (e) {
      console.error('DEBUG: Error importing MediaHandler:', e);
    }


    // Default mocks
    mockFetchResponse.blob.mockResolvedValue(mockBlob);
    mockFetchResponse.arrayBuffer.mockResolvedValue(new ArrayBuffer(8)); // Default empty buffer
    global.fetch.mockResolvedValue(mockFetchResponse);

    // Reset FileReader mock state
    mockFileReader.result = '';
    mockFileReader.onload = null;
    mockFileReader.onerror = null;

    // IMPORTANT: Make readAsDataURL trigger the onload callback immediately
    // This simulates the browser behavior synchronously for testing
    mockFileReader.readAsDataURL.mockImplementation(() => {
      if (typeof mockFileReader.onload === 'function') {
        mockFileReader.onload();
      }
    });
  });

  describe('Constructor', () => {
    test('should set default max file size to 50MB', () => {
      expect(mediaProcessor.maxFileSize).toBe(50 * 1024 * 1024);
    });
  });

  describe('fetchMediaAsBase64', () => {
    test('should fetch valid media URL and return base64 with correct MIME', async () => {
      // Setup successful response
      mockFetchResponse.blob.mockResolvedValue(mockBlob);
      // Mock a JPEG buffer
      const jpgBuffer = createBufferFromHex('FFD8FF00');
      mockFetchResponse.arrayBuffer.mockResolvedValue(jpgBuffer);

      mockFileReader.result = mockBase64;
      // Note: readAsDataURL mock in beforeEach handles triggering onload

      const result = await mediaProcessor.fetchMediaAsBase64('https://example.com/image.jpg');

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/image.jpg');
      expect(mockFetchResponse.arrayBuffer).toHaveBeenCalled();

      expect(result).toMatchObject({
        base64: expect.any(String),
        mimeType: 'image/jpeg'
      });
    });

    test('should correctly identify PNG masquerading as octet-stream', async () => {
      // Mock response saying it is octet-stream
      const octetBlob = new Blob(['png data'], { type: 'application/octet-stream' });
      mockFetchResponse.blob.mockResolvedValue(octetBlob);

      // Mock actual PNG bytes
      const pngBuffer = createBufferFromHex('89504E47');
      mockFetchResponse.arrayBuffer.mockResolvedValue(pngBuffer);

      mockFileReader.result = 'data:application/octet-stream;base64,PNG...';
      // Note: readAsDataURL mock in beforeEach handles triggering onload

      const result = await mediaProcessor.fetchMediaAsBase64('https://example.com/file');

      expect(result.mimeType).toBe('image/png'); // Should detect PNG despite octet-stream
    });

    test('should throw error for network failure', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));
      await expect(
        mediaProcessor.fetchMediaAsBase64('https://example.com/image.jpg')
      ).rejects.toThrow('Failed to fetch media');
    });
  });

  describe('detectMimeTypeFromBuffer', () => {
    test('should detect JPEG magic numbers', () => {
      const buffer = createBufferFromHex('FFD8FFE0');
      expect(mediaProcessor.detectMimeTypeFromBuffer(buffer)).toBe('image/jpeg');
    });

    test('should detect PNG magic numbers', () => {
      const buffer = createBufferFromHex('89504E47');
      expect(mediaProcessor.detectMimeTypeFromBuffer(buffer)).toBe('image/png');
    });

    test('should detect GIF magic numbers', () => {
      const buffer = createBufferFromHex('47494638');
      expect(mediaProcessor.detectMimeTypeFromBuffer(buffer)).toBe('image/gif');
    });

    test('should detect WEBP magic numbers', () => {
      // RIFF....WEBP
      // 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
      const buffer = createBufferFromHex('524946460000000057454250');
      expect(mediaProcessor.detectMimeTypeFromBuffer(buffer)).toBe('image/webp');
    });

    test('should return null for unknown signatures', () => {
      const buffer = createBufferFromHex('00000000');
      expect(mediaProcessor.detectMimeTypeFromBuffer(buffer)).toBeNull();
    });

    test('should return null for empty/short buffers', () => {
      expect(mediaProcessor.detectMimeTypeFromBuffer(new ArrayBuffer(0))).toBeNull();
      expect(mediaProcessor.detectMimeTypeFromBuffer(new ArrayBuffer(3))).toBeNull();
      expect(mediaProcessor.detectMimeTypeFromBuffer(null)).toBeNull();
    });
  });

  describe('getMimeTypeFromUrl', () => {
    // Existing tests preserved or simplified
    test('should detect image MIME types correctly', () => {
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/photo.jpg')).toBe('image/jpeg');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/image.PNG')).toBe('image/png');
    });
  });
});
