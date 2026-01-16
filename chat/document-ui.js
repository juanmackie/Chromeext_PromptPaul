import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
} from '../errorHandler.js';

import logger from '../utils/logger.js';

export class DocumentUI {
  constructor(container, documentManager) {
    this.container = container;
    this.documentManager = documentManager;
    this.dropZone = null;
    this.documentList = null;
    this.clearAllBtn = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    this.findElements();
    this.bindEvents();
    this.render();
    this.initialized = true;

    logger.info('DocumentUI', 'Document UI initialized');
  }

  findElements() {
    this.dropZone = this.container.querySelector('#document-drop-zone');
    this.documentList = this.container.querySelector('#document-list');
    this.clearAllBtn = this.container.querySelector('#clear-all-docs');
  }

  bindEvents() {
    if (this.dropZone) {
      this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
      this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
      this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));
      this.dropZone.addEventListener('click', () => this.triggerFileInput());
    }

    if (this.clearAllBtn) {
      this.clearAllBtn.addEventListener('click', () => this.handleClearAll());
    }
  }

  triggerFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.docx,.csv,.txt,.md,.markdown';
    input.className = 'hidden-file-input';

    input.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await this.documentManager.handleFileDrop(Array.from(e.target.files));
      }
    });

    document.body.appendChild(input);
    input.click();
    input.remove();
  }

  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone?.classList.add('drag-over');
  }

  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone?.classList.remove('drag-over');
  }

  async handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone?.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files).filter(
      (file) => file.size > 0
    );

    if (files.length === 0) {
      logger.warn('DocumentUI', 'No valid files dropped');
      return;
    }

    await this.documentManager.handleFileDrop(files);
  }

  async handleClearAll() {
    const confirmed = confirm('Remove all indexed documents? This cannot be undone.');
    if (!confirmed) return;

    try {
      const ragManager = this.documentManager?.ragManager;
      if (ragManager?.ragContextInjector) {
        ragManager.ragContextInjector.clearSelection();
      }

      await this.documentManager.clearAll();
      this.render();
      this.showToast('All documents cleared', 'success');
    } catch (error) {
      logger.error('DocumentUI', 'Failed to clear documents:', error);
      this.showToast('Failed to clear documents', 'error');
    }
  }

  render() {
    this.renderDropZone();
    this.renderDocumentList();
    this.updateClearAllButton();
  }

  renderDropZone() {
    if (!this.dropZone) return;

    this.dropZone.innerHTML = `
      <span class="material-icons upload-icon-large">cloud_upload</span>
      <p class="upload-title">Drop documents here</p>
      <span class="upload-hint">PDF, DOCX, CSV, MD, TXT</span>
    `;
  }

  renderDocumentList() {
    if (!this.documentList) return;

    const documents = this.documentManager.getAllDocuments();

    if (documents.length === 0) {
      this.documentList.innerHTML = '';
      return;
    }

    this.documentList.innerHTML = documents
      .map((doc) => this.renderDocumentCard(doc))
      .join('');

    this.bindDocumentEvents();
  }

  renderDocumentCard(doc) {
    const statusClass = doc.status === 'indexed' ? 'status-success' :
      doc.status === 'error' ? 'status-error' : 'status-loading';

    const statusIcon = doc.status === 'indexed' ? 'check_circle' :
      doc.status === 'error' ? 'error' : 'hourglass_empty';

    const statusText = doc.status === 'indexed' ?
      `✓ Indexed${doc.sizeFormatted ? ' • ' + doc.sizeFormatted : ''}${doc.chunkCount ? ' • ' + doc.chunkCount + ' chunks' : ''}` :
      doc.status === 'error' ?
        `✕ ${doc.error || 'Error'}` :
        this.getLoadingText(doc);

    return `
      <div class="document-card" data-doc-id="${doc.id}">
        <div class="document-card-header">
          <span class="material-icons document-icon">${this.getFileIcon(doc.fileType)}</span>
          <span class="document-card-name" title="${doc.fileName}">${this.truncateFileName(doc.fileName)}</span>
        </div>
        <div class="document-card-status ${statusClass}">
          <span class="material-icons status-icon">${statusIcon}</span>
          <span>${statusText}</span>
        </div>
        ${doc.status !== 'loading' ? `
          <div class="document-card-actions">
            <button class="document-action-btn remove-btn" data-action="remove" data-doc-id="${doc.id}" title="Remove document">
              <span class="material-icons action-icon">delete</span>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  getFileIcon(fileType) {
    const icons = {
      pdf: 'picture_as_pdf',
      docx: 'description',
      csv: 'table_chart',
      txt: 'text_snippet',
      markdown: 'notes',
    };
    return icons[fileType] || 'insert_drive_file';
  }

  truncateFileName(fileName, maxLength = 20) {
    if (fileName.length <= maxLength) return fileName;
    return fileName.substring(0, maxLength - 3) + '...';
  }

  getLoadingText(doc) {
    const loadingTexts = {
      parsing: 'Parsing...',
      chunking: 'Creating chunks...',
      indexing: 'Generating embeddings...',
    };
    return loadingTexts[doc.status] || 'Processing...';
  }

  bindDocumentEvents() {
    const removeBtns = this.documentList.querySelectorAll('.remove-btn');
    removeBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const docId = btn.dataset.docId;
        await this.handleRemoveDocument(docId);
      });
    });
  }

  async handleRemoveDocument(docId) {
    try {
      await this.documentManager.removeDocument(docId);
      this.render();
    } catch (error) {
      logger.error('DocumentUI', 'Failed to remove document:', error);
      this.showToast('Failed to remove document', 'error');
    }
  }

  updateDocument(docId, documentInfo) {
    const card = this.documentList?.querySelector(`[data-doc-id="${docId}"]`);
    if (card) {
      card.outerHTML = this.renderDocumentCard(documentInfo);
      this.bindDocumentEvents();
    }
    this.updateClearAllButton();
  }

  removeDocument(docId) {
    const card = this.documentList?.querySelector(`[data-doc-id="${docId}"]`);
    if (card) {
      card.remove();
    }
    this.updateClearAllButton();
  }

  clearAll() {
    if (this.documentList) {
      this.documentList.innerHTML = '';
    }
    this.updateClearAllButton();
  }

  updateClearAllButton() {
    if (this.clearAllBtn) {
      const hasDocuments = this.documentManager.getDocumentCount() > 0;
      if (hasDocuments) {
        this.clearAllBtn.classList.remove('ui-hidden');
        this.clearAllBtn.classList.add('ui-visible');
      } else {
        this.clearAllBtn.classList.add('ui-hidden');
        this.clearAllBtn.classList.remove('ui-visible');
      }
    }
  }

  showStatus(docId, status, message) {
    const card = this.documentList?.querySelector(`[data-doc-id="${docId}"]`);
    if (!card) return;

    const statusEl = card.querySelector('.document-card-status');
    if (statusEl) {
      statusEl.className = `document-card-status ${status === 'error' ? 'status-error' : 'status-loading'}`;
      statusEl.innerHTML = `
        <span class="material-icons status-icon">${status === 'error' ? 'error' : 'hourglass_empty'}</span>
        <span>${message}</span>
      `;
    }
  }

  showSuccess(docId) {
    const card = this.documentList?.querySelector(`[data-doc-id="${docId}"]`);
    if (!card) return;

    const doc = this.documentManager.getDocument(docId);
    if (doc) {
      card.outerHTML = this.renderDocumentCard(doc);
      this.bindDocumentEvents();
    }
    this.updateClearAllButton();
  }

  showError(fileName, errorMessage) {
    logger.error('DocumentUI', `Error for ${fileName}:`, errorMessage);
  }

  showToast(message, type = 'success', duration = 3000) {
    if (window.loadingManager && window.loadingManager.showToast) {
      window.loadingManager.showToast(message, type, duration);
    } else {
      logger.info('DocumentUI', `Toast (${type}): ${message}`);
    }
  }

  isInitialized() {
    return this.initialized;
  }

  show() {
    this.container.classList.remove('ui-hidden', 'document-panel-hidden');
    this.container.classList.add('ui-visible', 'document-panel-visible');
  }

  hide() {
    this.container.classList.add('ui-hidden', 'document-panel-hidden');
    this.container.classList.remove('ui-visible', 'document-panel-visible');
  }

  toggle() {
    if (this.container.classList.contains('document-panel-hidden') || this.container.classList.contains('ui-hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }
}

export const documentUI = new DocumentUI(null, null);
