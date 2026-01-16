import { create, insert, search, remove, count, save, load } from '../lib/orama.js';

import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
} from '../errorHandler.js';

import logger from '../utils/logger.js';

const DB_NAME = 'prompt-paul-rag-db';
const DB_STORE = 'orama-store';
const DB_KEY = 'orama-data';

const SCHEMA = {
  content: 'string',
  docId: 'string',
  chunkIndex: 'number',
  fileName: 'string',
  fileType: 'string',
  metadata: 'string',
};

// Simple IndexedDB helpers
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
  });
}

async function saveToIndexedDB(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const request = store.put(data, DB_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
}

async function loadFromIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(DB_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    tx.oncomplete = () => db.close();
  });
}

export class RAGManager {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      logger.info('RAGManager', 'Initializing Orama database...');

      // Create database with schema
      this.db = create({
        schema: SCHEMA,
      });

      // Try to load persisted data
      await this.loadPersistedData();

      this.initialized = true;
      logger.info('RAGManager', 'Orama database initialized successfully');

      const stats = await this.getStats();
      logger.info('RAGManager', `Loaded ${stats.documentCount} documents, ${stats.chunkCount} chunks`);
    } catch (error) {
      logger.error('RAGManager', 'Failed to initialize Orama:', error);
      throw createError(`Failed to initialize RAG manager: ${error.message}`, {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.HIGH,
        originalError: error,
      });
    }
  }

  async loadPersistedData() {
    try {
      const savedData = await loadFromIndexedDB();
      if (savedData) {
        this.db = load(this.db, savedData);
        logger.info('RAGManager', 'Persisted data loaded');
      }
    } catch (error) {
      logger.warn('RAGManager', 'Could not load persisted data:', error.message);
    }
  }

  async indexDocument(docId, chunks, metadata) {
    if (!this.initialized || !this.db) {
      throw createError('RAG manager not initialized', {
        category: ErrorCategory.STATE,
        severity: ErrorSeverity.HIGH,
      });
    }

    try {
      logger.info('RAGManager', `Indexing document: ${metadata.fileName} (${chunks.length} chunks)`);

      const documents = chunks.map((chunk, index) => ({
        content: chunk.content,
        docId,
        chunkIndex: index,
        fileName: metadata.fileName,
        fileType: metadata.fileType,
        metadata: JSON.stringify({
          ...metadata,
          chunkStart: chunk.startChar,
          chunkEnd: chunk.endChar,
        }),
      }));

      for (const doc of documents) {
        await insert(this.db, doc);
      }

      await this.savePersistedData();

      logger.info('RAGManager', `Successfully indexed ${chunks.length} chunks for ${metadata.fileName}`);
      return chunks.length;
    } catch (error) {
      logger.error('RAGManager', 'Failed to index document:', error);
      throw createError(`Failed to index document: ${error.message}`, {
        category: ErrorCategory.INDEX,
        severity: ErrorSeverity.HIGH,
        originalError: error,
        context: { docId, chunkCount: chunks.length },
      });
    }
  }

  async search(query, options = {}) {
    if (!this.initialized || !this.db) {
      throw createError('RAG manager not initialized', {
        category: ErrorCategory.STATE,
        severity: ErrorSeverity.HIGH,
      });
    }

    const { limit = 10, docIds = null } = options;

    try {
      logger.info('RAGManager', `Searching for: "${query.substring(0, 50)}..."`);

      const searchParams = {
        term: query,
        limit,
        properties: ['content'],
      };

      // Add document filter if specified
      if (docIds && docIds.length > 0) {
        searchParams.where = { docId: docIds };
      }

      const results = await search(this.db, searchParams);

      const formattedResults = results.hits.map((hit) => ({
        content: hit.document.content,
        score: hit.score,
        docId: hit.document.docId,
        chunkIndex: hit.document.chunkIndex,
        fileName: hit.document.fileName,
        fileType: hit.document.fileType,
        metadata: JSON.parse(hit.document.metadata || '{}'),
      }));

      logger.info('RAGManager', `Found ${formattedResults.length} results`);
      return formattedResults;
    } catch (error) {
      logger.error('RAGManager', 'Search failed:', error);
      throw createError(`Search failed: ${error.message}`, {
        category: ErrorCategory.SEARCH,
        severity: ErrorSeverity.MEDIUM,
        originalError: error,
      });
    }
  }

  async searchWithVector(query, options = {}) {
    // Vector search not available without embeddings plugin
    // Fallback to full-text search
    return this.search(query, options);
  }

  async removeDocument(docId) {
    if (!this.initialized || !this.db) {
      throw createError('RAG manager not initialized', {
        category: ErrorCategory.STATE,
        severity: ErrorSeverity.HIGH,
      });
    }

    try {
      logger.info('RAGManager', `Removing document: ${docId}`);

      // Search for all chunks with this docId
      const results = await search(this.db, {
        term: '',
        where: { docId },
        limit: 10000,
      });

      const idsToDelete = results.hits.map((hit) => hit.id);
      for (const id of idsToDelete) {
        await remove(this.db, id);
      }

      await this.savePersistedData();

      logger.info('RAGManager', `Removed ${idsToDelete.length} chunks for ${docId}`);
      return idsToDelete.length;
    } catch (error) {
      logger.error('RAGManager', 'Failed to remove document:', error);
      throw createError(`Failed to remove document: ${error.message}`, {
        category: ErrorCategory.INDEX,
        severity: ErrorSeverity.MEDIUM,
        originalError: error,
        context: { docId },
      });
    }
  }

  async clearIndex() {
    if (!this.initialized) {
      throw createError('RAG manager not initialized', {
        category: ErrorCategory.STATE,
        severity: ErrorSeverity.HIGH,
      });
    }

    try {
      // Recreate the database
      this.db = create({
        schema: SCHEMA,
      });
      await this.savePersistedData();
      logger.info('RAGManager', 'Index cleared');
    } catch (error) {
      logger.error('RAGManager', 'Failed to clear index:', error);
      throw createError(`Failed to clear index: ${error.message}`, {
        category: ErrorCategory.INDEX,
        severity: ErrorSeverity.MEDIUM,
        originalError: error,
      });
    }
  }

  async savePersistedData() {
    try {
      if (this.db) {
        const data = save(this.db);
        await saveToIndexedDB(data);
        logger.info('RAGManager', 'Data persisted to IndexedDB');
      }
    } catch (error) {
      logger.warn('RAGManager', 'Could not persist data:', error.message);
    }
  }

  async getStats() {
    if (!this.initialized || !this.db) {
      return { documentCount: 0, chunkCount: 0, storageSize: 0 };
    }

    try {
      const chunkCount = await count(this.db);

      // Get unique document count by searching
      const results = await search(this.db, {
        term: '',
        limit: 10000,
      });

      const docIds = new Set();
      results.hits.forEach((hit) => {
        if (hit.document.docId) {
          docIds.add(hit.document.docId);
        }
      });

      return {
        documentCount: docIds.size,
        chunkCount: chunkCount,
        storageSize: 0,
      };
    } catch (error) {
      logger.warn('RAGManager', 'Could not get stats:', error.message);
      return { documentCount: 0, chunkCount: 0, storageSize: 0 };
    }
  }

  isInitialized() {
    return this.initialized;
  }
}

export const ragManager = new RAGManager();
