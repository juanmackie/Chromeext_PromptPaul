/**
 * Unit Tests for MediaProcessor
 * Tests media fetching, base64 conversion, MIME detection, and validation
 */

const { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync } = require('../../../mocks/error-handler.mock.js');

// Mock global fetch and FileReader
const mockFetchResponse = {
  ok: true,
  blob: jest.fn()
};

const mockBlob = new Blob(['test data'], { type: 'image/jpeg' });
const mockBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'; // Truncated sample

jest.mock('global.fetch', () => jest.fn());

global.fetch = jest.fn();
global.FileReader = jest.fn(() => ({
  onload: null,
  onerror: null,
  readAsDataURL: jest.fn()
}));

const mockFileReader = new FileReader();
global.FileReader.mockReturnValue(mockFileReader);

describe('MediaProcessor', () => {
  let mediaProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    mediaProcessor = new MediaProcessor();
    mockFetchResponse.blob.mockResolvedValue(mockBlob);
    global.fetch.mockResolvedValue(mockFetchResponse);
    mockFileReader.onload = jest.fn();
    mockFileReader.onerror = jest.fn();
  });

  describe('Constructor', () => {
    test('should set default max file size to 50MB', () => {
      expect(mediaProcessor.maxFileSize).toBe(50 * 1024 * 1024);
      expect(mediaProcessor.getMaxFileSize()).toBe(50 * 1024 * 1024);
    });

    test('should allow setting custom max file size', () => {
      mediaProcessor.setMaxFileSize(10 * 1024 * 1024);
      expect(mediaProcessor.getMaxFileSize()).toBe(10 * 1024 * 1024);
    });
  });

  describe('fetchMediaAsBase64', () => {
    test('should fetch valid media URL and return base64', async () => {
      mockFetchResponse.blob.mockResolvedValue(mockBlob);
      mockFileReader.result = mockBase64;
      mockFileReader.onload.mockImplementation(() => {
        mockFileReader.onload();
      });

      const result = await mediaProcessor.fetchMediaAsBase64('https://example.com/image.jpg');

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/image.jpg');
      expect(mockFetchResponse.blob).toHaveBeenCalled();
      expect(mockFileReader.readAsDataURL).toHaveBeenCalledWith(mockBlob);
      expect(result).toBe(mockBase64.split(',')[1]); // Base64 without prefix
    });

    test('should throw error for no URL provided', async () => {
      await expect(mediaProcessor.fetchMediaAsBase64('')).rejects.toThrow('No URL provided for media fetching');
      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should throw error for network failure', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));
      await expect(mediaProcessor.fetchMediaAsBase64('https://example.com/image.jpg')).rejects.toThrow('Failed to fetch media');
      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should throw error for file too large', async () => {
      const largeBlob = new Blob(['large data'], { type: 'image/jpeg' });
      largeBlob.size = 60 * 1024 * 1024; // 60MB
      mockFetchResponse.blob.mockResolvedValue(largeBlob);

      await expect(mediaProcessor.fetchMediaAsBase64('https://example.com/large.jpg')).rejects.toThrow('Media file too large');
      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should handle non-OK response status', async () => {
      const errorResponse = { ok: false, status: 404, statusText: 'Not Found' };
      global.fetch.mockResolvedValue(errorResponse);

      await expect(mediaProcessor.fetchMediaAsBase64('https://example.com/missing.jpg')).rejects.toThrow('Failed to fetch media: 404 Not Found');
      expect(errorHandler.handle).toHaveBeenCalled();
    });
  });

  describe('convertBlobToBase64', () => {
    test('should convert blob to base64 successfully', async () => {
      mockFileReader.result = mockBase64;
      mockFileReader.onload.mockImplementation(() => {
        mockFileReader.onload();
      });

      const result = await mediaProcessor.convertBlobToBase64(mockBlob);

      expect(mockFileReader.readAsDataURL).toHaveBeenCalledWith(mockBlob);
      expect(result).toBe(mockBase64.split(',')[1]);
    });

    test('should reject on FileReader error', async () => {
      mockFileReader.onerror.mockImplementation(() => {
        mockFileReader.onerror(new Error('FileReader failed'));
      });

      await expect(mediaProcessor.convertBlobToBase64(mockBlob)).rejects.toThrow('FileReader error while processing media');
      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should handle data URL processing error', async () => {
      mockFileReader.result = 'invalid-data-url';
      mockFileReader.onload.mockImplementation(() => {
        mockFileReader.onload();
      });

      await expect(mediaProcessor.convertBlobToBase64(mockBlob)).rejects.toThrow('Failed to process media data URL');
      expect(errorHandler.handle).toHaveBeenCalled();
    });
  });

  describe('getMimeTypeFromUrl', () => {
    test('should detect image MIME types correctly', () => {
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/photo.jpg')).toBe('image/jpeg');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/image.PNG')).toBe('image/png');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/anim.gif')).toBe('image/gif');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/modern.webp')).toBe('image/webp');
    });

    test('should detect video MIME types correctly', () => {
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/video.mp4')).toBe('video/mp4');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/clip.webm')).toBe('video/webm');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/movie.mov')).toBe('video/quicktime');
    });

    test('should detect audio MIME types correctly', () => {
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/song.mp3')).toBe('audio/mpeg');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/sound.wav')).toBe('audio/wav');
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/track.m4a')).toBe('audio/mp4');
    });

    test('should return octet-stream for unknown extensions', () => {
      expect(mediaProcessor.getMimeTypeFromUrl('https://example.com/doc.txt')).toBe('application/octet-stream');
    });

    test('should handle null/empty URL', () => {
      expect(mediaProcessor.getMimeTypeFromUrl('')).toBe('application/octet-stream');
      expect(mediaProcessor.getMimeTypeFromUrl(null)).toBe('application/octet-stream');
    });

    test('should handle malformed URLs gracefully', () => {
      expect(mediaProcessor.getMimeTypeFromUrl('invalid.url')).toBe('application/octet-stream');
    });
  });

  describe('isValidMediaType', () => {
    test('should validate supported image types', () => {
      expect(mediaProcessor.isValidMediaType('image/jpeg')).toBe(true);
      expect(mediaProcessor.isValidMediaType('image/png')).toBe(true);
      expect(mediaProcessor.isValidMediaType('image/webp')).toBe(true);
    });

    test('should validate supported video types', () => {
      expect(mediaProcessor.isValidMediaType('video/mp4')).toBe(true);
      expect(mediaProcessor.isValidMediaType('video/webm')).toBe(true);
    });

    test('should validate supported audio types', () => {
      expect(mediaProcessor.isValidMediaType('audio/mpeg')).toBe(true);
      expect(mediaProcessor.isValidMediaType('audio/ogg')).toBe(true);
    });

    test('should reject unsupported types', () => {
      expect(mediaProcessor.isValidMediaType('text/plain')).toBe(false);
      expect(mediaProcessor.isValidMediaType('application/pdf')).toBe(false);
      expect(mediaProcessor.isValidMediaType('unknown/type')).toBe(false);
    });
  });

  describe('getMediaTypeCategory', () => {
    test('should categorize image MIME types', () => {
      expect(mediaProcessor.getMediaTypeCategory('image/jpeg')).toBe('image');
      expect(mediaProcessor.getMediaTypeCategory('image/png')).toBe('image');
    });

    test('should categorize video MIME types', () => {
      expect(mediaProcessor.getMediaTypeCategory('video/mp4')).toBe('video');
    });

    test('should categorize audio MIME types', () => {
      expect(mediaProcessor.getMediaTypeCategory('audio/mpeg')).toBe('audio');
    });

    test('should return unknown for non-media types', () => {
      expect(mediaProcessor.getMediaTypeCategory('text/plain')).toBe('unknown');
    });
  });

  describe('processMediaForApi', () => {
    test('should process media URL completely for API', async () => {
      mockFetchResponse.blob.mockResolvedValue(mockBlob);
      mockFileReader.result = mockBase64;
      mockFileReader.onload.mockImplementation(() => mockFileReader.onload());

      const result = await mediaProcessor.processMediaForApi('https://example.com/image.jpg');

      expect(result).toEqual({
        base64: mockBase64.split(',')[1],
        mimeType: 'image/jpeg',
        type: 'image',
        url: 'https://example.com/image.jpg',
        isValid: true
      });
    });

    test('should handle errors in full processing flow', async () => {
      global.fetch.mockRejectedValue(new Error('Fetch failed'));

      await expect(mediaProcessor.processMediaForApi('https://example.com/fail.jpg')).rejects.toThrow();
      expect(errorHandler.handle).toHaveBeenCalled();
    });
  });

  describe('Error Handling Integration', () => {
    test('should use wrapAsync error handling correctly', async () => {
      const spyHandle = jest.spyOn(errorHandler, 'handle');
      global.fetch.mockRejectedValue(new Error('Test error'));

      await expect(mediaProcessor.fetchMediaAsBase64('https://fail.com')).rejects.toThrow();
      expect(spyHandle).toHaveBeenCalled();
    });
  });
});