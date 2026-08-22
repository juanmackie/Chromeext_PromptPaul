import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_CHARS,
  getDocumentExtension,
  isDocumentFile,
  prepareDroppedFile,
  readFileAsDocumentText,
  validateDroppedFile,
} from '../src/chat/ChatMedia.js';

function makeFile(overrides = {}) {
  return { name: 'file.txt', type: 'text/plain', size: 10, ...overrides };
}

describe('chat document attachments', () => {
  describe('getDocumentExtension', () => {
    it('returns the lowercase extension', () => {
      expect(getDocumentExtension('Notes.MD')).toBe('.md');
      expect(getDocumentExtension('data.export.json')).toBe('.json');
    });

    it('returns empty for files without an extension or with junk names', () => {
      expect(getDocumentExtension('noext')).toBe('');
      expect(getDocumentExtension('')).toBe('');
      expect(getDocumentExtension(null)).toBe('');
    });
  });

  describe('isDocumentFile', () => {
    it('accepts the documented allowlist regardless of MIME type', () => {
      for (const name of ['a.txt', 'b.md', 'c.markdown', 'd.csv', 'e.json']) {
        expect(isDocumentFile(makeFile({ name, type: '' }))).toBe(true);
      }
    });

    it('rejects non-allowlisted and binary files even with empty MIME', () => {
      expect(isDocumentFile(makeFile({ name: 'virus.exe' }))).toBe(false);
      expect(isDocumentFile(makeFile({ name: 'archive.zip' }))).toBe(false);
      expect(isDocumentFile({})).toBe(false);
    });
  });

  describe('validateDroppedFile', () => {
    it('accepts documents within the size ceiling', () => {
      expect(validateDroppedFile(makeFile({ name: 'notes.md', size: 100 }))).toEqual({
        valid: true,
      });
    });

    it('rejects oversized documents with a readable error', () => {
      const result = validateDroppedFile(makeFile({ name: 'big.csv', size: 21 * 1024 * 1024 }));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('big.csv');
      expect(result.error).toContain('max 20 MB');
    });

    it('still accepts media by MIME prefix', () => {
      expect(validateDroppedFile(makeFile({ name: 'shot.png', type: 'image/png' }))).toEqual({
        valid: true,
      });
    });

    it('rejects unsupported binaries with updated guidance', () => {
      const result = validateDroppedFile(makeFile({ name: 'app.exe', type: '' }));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('.txt/.md/.csv/.json');
    });
  });

  describe('readFileAsDocumentText', () => {
    const originalFileReader = globalThis.FileReader;

    afterEach(() => {
      globalThis.FileReader = originalFileReader;
    });

    function stubFileReader(result) {
      globalThis.FileReader = class {
        readAsText() {
          this.result = result;
          this.onload();
        }
      };
    }

    it('normalizes CRLF, strips NUL bytes, and reports file metadata', async () => {
      stubFileReader('line1\r\nline2\u0000\n');
      const doc = await readFileAsDocumentText(makeFile({ name: 'notes.txt', size: 15 }));
      expect(doc.text).toBe('line1\nline2');
      expect(doc.name).toBe('notes.txt');
      expect(doc.size).toBe(15);
      expect(doc.truncated).toBe(false);
    });

    it('hard-truncates beyond MAX_DOCUMENT_CHARS with a marker', async () => {
      stubFileReader('x'.repeat(MAX_DOCUMENT_CHARS + 500));
      const doc = await readFileAsDocumentText(makeFile());
      expect(doc.truncated).toBe(true);
      expect(doc.text.length).toBe(MAX_DOCUMENT_CHARS);
      expect(doc.text.endsWith('… [truncated]')).toBe(true);
    });

    it('rejects on reader errors with the file name', async () => {
      globalThis.FileReader = class {
        readAsText() {
          this.onerror();
        }
      };
      await expect(readFileAsDocumentText(makeFile({ name: 'bad.csv' }))).rejects.toThrow(
        'bad.csv'
      );
    });
  });

  describe('prepareDroppedFile', () => {
    const originalFileReader = globalThis.FileReader;

    afterEach(() => {
      globalThis.FileReader = originalFileReader;
    });

    function stubDataReader(result) {
      globalThis.FileReader = class {
        readAsDataURL() {
          this.result = `data:image/png;base64,${result}`;
          this.onload();
        }
      };
    }

    it('returns an invalid plan with the validation error', async () => {
      const plan = await prepareDroppedFile(makeFile({ name: 'app.exe', type: '' }));
      expect(plan.kind).toBe('invalid');
      expect(plan.error).toContain('.txt/.md/.csv/.json');
    });

    it('plans documents as bounded text context without base64 data', async () => {
      globalThis.FileReader = class {
        readAsText() {
          this.result = 'a,b\r\n1,2';
          this.onload();
        }
      };
      const plan = await prepareDroppedFile(makeFile({ name: 'data.csv', size: 8 }));
      expect(plan.kind).toBe('document');
      expect(plan.text).toBe('a,b\n1,2');
      expect(plan.instruction).toContain('data.csv');
      expect(plan.preview).toMatchObject({ type: 'text', name: 'data.csv', lineCount: 2 });
      expect(JSON.stringify(plan)).not.toContain('base64');
    });

    it('rejects empty documents', async () => {
      globalThis.FileReader = class {
        readAsText() {
          this.result = '   ';
          this.onload();
        }
      };
      const plan = await prepareDroppedFile(makeFile({ name: 'empty.txt' }));
      expect(plan.kind).toBe('invalid');
      expect(plan.error).toContain('empty.txt');
    });

    it('keeps media files on the base64 pipeline', async () => {
      stubDataReader('abc');
      const plan = await prepareDroppedFile(makeFile({ name: 'shot.png', type: 'image/png' }));
      expect(plan.kind).toBe('media');
      expect(plan.mediaData).toMatchObject({ type: 'image', mimeType: 'image/png' });
      expect(plan.instruction).toBe('Analyze this Image: shot.png');
    });
  });
});
