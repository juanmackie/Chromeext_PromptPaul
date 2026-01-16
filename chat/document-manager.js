import { fileParsers, canParse } from '../utils/file-parsers.js';

import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
} from '../errorHandler.js';

import logger from '../utils/logger.js';

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

export class DocumentManager {
  constructor(ragManager, uiManager) {
    this.ragManager = ragManager;
    this.uiManager = uiManager;
    this.documents = new Map();
    this.idCounter = 0;
  }

  async handleFileDrop(files) {
    const validFiles = [];

    for (const file of files) {
      const type = await canParse(file);
      if (type) {
        validFiles.push({ file, type });
      } else {
        logger.warn('DocumentManager', `Unsupported file type: ${file.name}`);
        if (this.uiManager) {
          this.uiManager.showError(file.name, 'Unsupported file type');
        }
      }
    }

    if (validFiles.length === 0) {
      return [];
    }

    const results = [];

    for (const { file, type } of validFiles) {
      try {
        const doc = await this.processDocument(file, type);
        results.push(doc);
      } catch (error) {
        logger.error('DocumentManager', `Failed to process ${file.name}:`, error);
        if (this.uiManager) {
          this.uiManager.showError(file.name, error.message);
        }
      }
    }

    return results.filter((doc) => doc !== null);
  }

  async processDocument(file, type) {
    const docId = this.generateDocId();
    let documentInfo = {
      id: docId,
      fileName: file.name,
      fileType: type,
      status: 'parsing',
      size: file.size,
      chunkCount: 0,
      error: null,
      addedAt: Date.now(),
    };

    this.documents.set(docId, documentInfo);
    if (this.uiManager) {
      this.uiManager.updateDocument(docId, documentInfo);
    }

    try {
      if (this.uiManager) {
        this.uiManager.updateStatus(docId, 'parsing', 'Parsing document...');
      }

      const parsed = await fileParsers.parse(file);

      documentInfo.metadata = parsed.metadata;
      documentInfo.rawContent = parsed.content;
      documentInfo.status = 'chunking';
      this.documents.set(docId, documentInfo);
      if (this.uiManager) {
        this.uiManager.updateDocument(docId, documentInfo);
      }

      if (this.uiManager) {
        this.uiManager.updateStatus(docId, 'chunking', 'Creating chunks...');
      }

      const chunks = this.chunkText(parsed.content);

      documentInfo.chunkCount = chunks.length;
      documentInfo.status = 'indexing';
      this.documents.set(docId, documentInfo);
      if (this.uiManager) {
        this.uiManager.updateDocument(docId, documentInfo);
      }

      if (this.uiManager) {
        this.uiManager.updateStatus(docId, 'indexing', 'Generating embeddings and indexing...');
      }

      const metadata = {
        fileName: file.name,
        fileType: type,
        size: file.size,
        ...parsed.metadata,
      };

      await this.ragManager.indexDocument(docId, chunks, metadata);

      documentInfo.status = 'indexed';
      documentInfo.sizeFormatted = this.formatFileSize(file.size);
      this.documents.set(docId, documentInfo);
      if (this.uiManager) {
        this.uiManager.updateDocument(docId, documentInfo);
      }

      logger.info('DocumentManager', `Successfully indexed ${file.name} (${chunks.length} chunks)`);
      return documentInfo;
    } catch (error) {
      documentInfo.status = 'error';
      documentInfo.error = error.message;
      this.documents.set(docId, documentInfo);
      if (this.uiManager) {
        this.uiManager.updateDocument(docId, documentInfo);
      }

      throw error;
    }
  }

  chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
    if (!text || text.length === 0) {
      return [];
    }

    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const chunks = [];
    let start = 0;

    while (start < normalizedText.length) {
      let end = start + chunkSize;

      if (end >= normalizedText.length) {
        chunks.push({
          content: normalizedText.slice(start).trim(),
          startChar: start,
          endChar: normalizedText.length,
        });
        break;
      }

      const paragraphBreak = normalizedText.lastIndexOf('\n\n', end);
      const sentenceBreak = normalizedText.lastIndexOf('. ', end);
      const breakPoint = Math.max(paragraphBreak, sentenceBreak);

      if (breakPoint > start + chunkSize / 2) {
        end = breakPoint;
      } else if (end < normalizedText.length && normalizedText[end] !== ' ') {
        const spaceIndex = normalizedText.lastIndexOf(' ', end);
        if (spaceIndex > start + chunkSize / 2) {
          end = spaceIndex;
        }
      }

      const chunkContent = normalizedText.slice(start, end).trim();
      if (chunkContent) {
        chunks.push({
          content: chunkContent,
          startChar: start,
          endChar: end,
        });
      }

      start = end - overlap;
      if (start < 0) start = 0;

      if (chunks.length > 0 && start >= chunks[chunks.length - 1].startChar) {
        start = chunks[chunks.length - 1].startChar + 1;
      }
    }

    return chunks;
  }

  async removeDocument(docId) {
    const documentInfo = this.documents.get(docId);
    if (!documentInfo) {
      logger.warn('DocumentManager', `Document not found: ${docId}`);
      return false;
    }

    try {
      await this.ragManager.removeDocument(docId);
      this.documents.delete(docId);

      if (this.uiManager) {
        this.uiManager.removeDocument(docId);
      }

      logger.info('DocumentManager', `Removed document: ${documentInfo.fileName}`);
      return true;
    } catch (error) {
      logger.error('DocumentManager', `Failed to remove document ${docId}:`, error);
      throw createError(`Failed to remove document: ${error.message}`, {
        category: ErrorCategory.STORAGE,
        severity: ErrorSeverity.MEDIUM,
        originalError: error,
        context: { docId },
      });
    }
  }

  async clearAll() {
    const docIds = Array.from(this.documents.keys());

    for (const docId of docIds) {
      try {
        await this.ragManager.removeDocument(docId);
      } catch (error) {
        logger.warn('DocumentManager', `Failed to remove ${docId} during clearAll:`, error.message);
      }
    }

    this.documents.clear();
    this.idCounter = 0;

    if (this.uiManager) {
      this.uiManager.clearAll();
    }

    logger.info('DocumentManager', 'Cleared all documents');
  }

  getDocument(docId) {
    return this.documents.get(docId);
  }

  getAllDocuments() {
    return Array.from(this.documents.values()).sort(
      (a, b) => b.addedAt - a.addedAt
    );
  }

  getDocumentCount() {
    return this.documents.size;
  }

  generateDocId() {
    this.idCounter++;
    return `doc_${Date.now()}_${this.idCounter}`;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export const documentManager = new DocumentManager(null, null);
