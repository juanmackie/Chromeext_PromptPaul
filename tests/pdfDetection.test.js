import { describe, expect, it, vi } from 'vitest';
import {
  getPdfSourceUrl,
  hasPdfResponseHeaders,
  isLikelyPdfUrl,
  probePdfUrl,
} from '../src/utils/pdfDetection.js';

describe('pdfDetection', () => {
  it('recognizes PDF filename hints in paths, query values, and titles', () => {
    expect(isLikelyPdfUrl('https://example.test/files/report.pdf')).toBe(true);
    expect(isLikelyPdfUrl('https://example.test/download?filename=report.pdf')).toBe(true);
    expect(isLikelyPdfUrl('https://example.test/download', 'report.pdf')).toBe(true);
    expect(isLikelyPdfUrl('https://example.test/articles/report.pdfx')).toBe(false);
  });

  it('unwraps the built-in Chrome PDF viewer source URL', () => {
    const viewerUrl =
      'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=' +
      encodeURIComponent('https://example.test/webdownload?document=quarterly-report.pdf');

    expect(getPdfSourceUrl(viewerUrl)).toBe(
      'https://example.test/webdownload?document=quarterly-report.pdf'
    );
    expect(isLikelyPdfUrl(viewerUrl)).toBe(true);
    expect(
      isLikelyPdfUrl(
        'chrome-extension://other-extension/index.html?file=' +
          encodeURIComponent('https://example.test/report.pdf')
      )
    ).toBe(false);
  });

  it('recognizes PDF and attachment response headers', () => {
    expect(hasPdfResponseHeaders(new Headers({ 'content-type': 'application/pdf' }))).toBe(true);
    expect(
      hasPdfResponseHeaders(
        new Headers({ 'content-disposition': 'attachment; filename="report.pdf"' })
      )
    ).toBe(true);
    expect(hasPdfResponseHeaders(new Headers({ 'content-type': 'text/html' }))).toBe(false);
  });

  it('detects an extensionless PDF endpoint from response metadata', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } })
      );

    await expect(probePdfUrl('https://example.test/webdownload', { fetchImpl })).resolves.toBe(
      true
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/webdownload',
      expect.objectContaining({ method: 'HEAD' })
    );
  });

  it('probes the source URL when Chrome reports its PDF viewer wrapper', async () => {
    const sourceUrl = 'https://example.test/webdownload';
    const viewerUrl =
      'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=' +
      encodeURIComponent(sourceUrl);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } })
      );

    await expect(probePdfUrl(viewerUrl, { fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(sourceUrl, expect.objectContaining({ method: 'HEAD' }));
  });

  it('detects a PDF from the bounded range signature when metadata is generic', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { 'content-type': 'text/plain' } })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), {
          status: 206,
          headers: { 'content-type': 'application/octet-stream' },
        })
      );

    await expect(probePdfUrl('https://example.test/webdownload', { fetchImpl })).resolves.toBe(
      true
    );
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://example.test/webdownload',
      expect.objectContaining({ method: 'GET', headers: { Range: 'bytes=0-4' } })
    );
  });
});
