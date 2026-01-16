import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
} from '../errorHandler.js';

import logger from '../utils/logger.js';

export class RAGContextInjector {
  constructor(ragManager) {
    this.ragManager = ragManager;
    this.enabled = false;
    this.selectedDocs = new Set();
    this.defaultOptions = {
      limit: 5,
      similarity: 0.7,
      includeSources: true,
    };
  }

  async getContextForQuery(query, options = {}) {
    if (!this.enabled) {
      return null;
    }

    if (!this.ragManager || !this.ragManager.isInitialized()) {
      logger.warn('RAGContextInjector', 'RAG manager not initialized');
      return null;
    }

    const docIds = this.selectedDocs.size > 0 ?
      Array.from(this.selectedDocs) : null;

    if (docIds === null) {
      const stats = await this.ragManager.getStats();
      if (stats.documentCount === 0) {
        return null;
      }
    }

    try {
      const searchOptions = {
        ...this.defaultOptions,
        ...options,
        docIds,
      };

      const results = await this.ragManager.searchWithVector(query, searchOptions);

      if (results.length === 0) {
        return null;
      }

      const context = this.formatContext(results, query);

      logger.info('RAGContextInjector', `Retrieved ${results.length} chunks for query`);
      return context;
    } catch (error) {
      logger.error('RAGContextInjector', 'Failed to get context:', error);
      throw createError(`Failed to retrieve document context: ${error.message}`, {
        category: ErrorCategory.SEARCH,
        severity: ErrorSeverity.MEDIUM,
        originalError: error,
      });
    }
  }

  formatContext(results, query) {
    const sourcesByDoc = new Map();

    results.forEach((result, index) => {
      if (!sourcesByDoc.has(result.docId)) {
        sourcesByDoc.set(result.docId, {
          fileName: result.fileName,
          fileType: result.fileType,
          chunks: [],
        });
      }
      sourcesByDoc.get(result.docId).chunks.push({
        content: result.content,
        score: result.score,
        index: result.chunkIndex,
        position: index + 1,
      });
    });

    let context = '=== DOCUMENT CONTEXT ===\n\n';

    sourcesByDoc.forEach((doc, docId) => {
      context += `Source: ${doc.fileName}\n`;
      context += `Relevance: Top ${doc.chunks.length} passages\n\n`;

      doc.chunks.forEach((chunk, i) => {
        context += `[${chunk.position}] ${chunk.content}\n\n`;
      });
    });

    context += '=======================\n\n';
    context += 'When citing information, please reference the source document(s) above by filename.\n';

    return context;
  }

  formatContextForSystemPrompt(results, query) {
    if (results.length === 0) {
      return null;
    }

    const uniqueDocs = [...new Set(results.map((r) => r.docId))];

    const docs = uniqueDocs.map((docId) => {
      const docResults = results.filter((r) => r.docId === docId);
      return {
        fileName: docResults[0].fileName,
        fileType: docResults[0].fileType,
        relevantChunks: docResults.map((r) => ({
          content: r.content,
          relevanceScore: Math.round(r.score * 100),
        })),
      };
    });

    let systemContext = 'You have access to the following document(s) for answering questions:\n\n';

    docs.forEach((doc, i) => {
      systemContext += `${i + 1}. ${doc.fileName}\n`;
      doc.relevantChunks.forEach((chunk, j) => {
        systemContext += `   [${j + 1}] (${chunk.relevanceScore}% match): ${chunk.content.substring(0, 200)}...\n`;
      });
      systemContext += '\n';
    });

    systemContext += 'Use these documents to answer the user\'s question accurately. Cite sources when appropriate.\n';

    return systemContext;
  }

  setEnabled(enabled) {
    const wasEnabled = this.enabled;
    this.enabled = enabled;

    if (enabled && !wasEnabled) {
      logger.info('RAGContextInjector', 'RAG context injection enabled');
    } else if (!enabled && wasEnabled) {
      logger.info('RAGContextInjector', 'RAG context injection disabled');
    }
  }

  isEnabled() {
    return this.enabled;
  }

  selectDocument(docId) {
    this.selectedDocs.add(docId);
    logger.info('RAGContextInjector', `Selected document: ${docId}`);
  }

  deselectDocument(docId) {
    this.selectedDocs.delete(docId);
    logger.info('RAGContextInjector', `Deselected document: ${docId}`);
  }

  toggleDocument(docId) {
    if (this.selectedDocs.has(docId)) {
      this.deselectDocument(docId);
    } else {
      this.selectDocument(docId);
    }
  }

  selectAllDocuments() {
    this.selectedDocs.clear();
  }

  clearSelection() {
    this.selectedDocs.clear();
    logger.info('RAGContextInjector', 'Cleared document selection');
  }

  getSelection() {
    return Array.from(this.selectedDocs);
  }

  getSelectionCount() {
    return this.selectedDocs.size;
  }

  setDefaultOptions(options) {
    this.defaultOptions = {
      ...this.defaultOptions,
      ...options,
    };
  }

  getDefaultOptions() {
    return { ...this.defaultOptions };
  }

  async getAvailableDocuments() {
    if (!this.ragManager) {
      return [];
    }

    try {
      const stats = await this.ragManager.getStats();
      return {
        count: stats.documentCount,
        chunks: stats.chunkCount,
      };
    } catch (error) {
      logger.warn('RAGContextInjector', 'Failed to get document stats:', error);
      return { count: 0, chunks: 0 };
    }
  }

  formatSourcesForCitation(results) {
    if (!results || results.length === 0) {
      return [];
    }

    const sources = [];

    results.forEach((result) => {
      const existingSource = sources.find((s) => s.docId === result.docId);
      if (existingSource) {
        existingSource.chunks.push({
          position: result.chunkIndex,
          relevance: Math.round(result.score * 100),
        });
      } else {
        sources.push({
          docId: result.docId,
          fileName: result.fileName,
          fileType: result.fileType,
          chunks: [{
            position: result.chunkIndex,
            relevance: Math.round(result.score * 100),
          }],
        });
      }
    });

    return sources;
  }
}

export const ragContextInjector = new RAGContextInjector(null);
