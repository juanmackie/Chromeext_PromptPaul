/**
 * Enhanced Thinking Block
 * Refactored thinking block component with modular architecture
 * Implements production-ready coding rules for component design
 *
 * Core Principles:
 * - Single Responsibility: Coordinate component modules, don't implement business logic
 * - Dependency Injection: Use the DI container for module management
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 */

import { logger } from '../shared/index.js';
import ThinkingBlockCore from './thinking-block/thinking-block-core.js';
import ContentParser from './thinking-block/content-parser.js';
import StepRenderer from './thinking-block/step-renderer.js';
import ToolCallRenderer from './thinking-block/tool-call-renderer.js';
import SearchHandler from './thinking-block/search-handler.js';
import ExportHandler from './thinking-block/export-handler.js';

interface ThinkingStep {
  type: 'thinking' | 'tool' | 'result' | 'error';
  title: string;
  description: string;
  toolCall?: ToolCall;
  timestamp?: string;
}

interface ToolCall {
  name: string;
  input: string;
  output: string;
  status: 'running' | 'success' | 'error';
}

interface ExportData {
  steps: ThinkingStep[];
  content: string;
  thinking: string;
  answer: string;
  tokens: number;
  timestamp: string;
}

class EnhancedThinkingBlock extends HTMLElement {
  private shadow: ShadowRoot;
  private core!: ThinkingBlockCore;
  private contentParser!: ContentParser;
  private stepRenderer!: StepRenderer;
  private toolCallRenderer!: ToolCallRenderer;
  private searchHandler!: SearchHandler;
  private exportHandler!: ExportHandler;
  private logger: any;
  private isInitialized: boolean = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.logger = logger;
  }

  /**
   * Called when the element is connected to the DOM
   */
  connectedCallback(): void {
    this.logger.debug('Enhanced thinking block connected to DOM');

    try {
      // Initialize modules
      this.core = new ThinkingBlockCore(this.shadow);
      this.contentParser = new ContentParser(this.logger);
      this.stepRenderer = new StepRenderer(this.logger);
      this.toolCallRenderer = new ToolCallRenderer(this.logger);
      this.searchHandler = new SearchHandler(this.logger);
      this.exportHandler = new ExportHandler(this.logger);

      // Initialize core
      this.core.initialize();

      // Set initial empty state to prevent flashing
      this.core.setContent('');
      this.core.setStreamingState(false);

      // Render initial template
      this.renderTemplate();

      // Set up event listeners
      this.setupEventListeners();

      // Set up attribute observers
      this.setupAttributeObservers();

      this.isInitialized = true;
      this.logger.debug('Enhanced thinking block initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize enhanced thinking block', {}, error);
      this.showError('Failed to initialize thinking block');
    }
  }

  /**
   * Called when the element is disconnected from the DOM
   */
  disconnectedCallback(): void {
    this.logger.debug('Enhanced thinking block disconnected from DOM');

    try {
      // Clean up core resources
      if (this.core) {
        this.core.cleanup();
      }
      
      // Clean up other modules if they have cleanup methods
      if (this.contentParser && typeof (this.contentParser as any).cleanup === 'function') {
        (this.contentParser as any).cleanup();
      }
      
      if (this.stepRenderer && typeof (this.stepRenderer as any).cleanup === 'function') {
        (this.stepRenderer as any).cleanup();
      }
      
      if (this.searchHandler && typeof (this.searchHandler as any).cleanup === 'function') {
        (this.searchHandler as any).cleanup();
      }
      
      // Clear references (using undefined for definite assignment assertions)
      this.core = undefined as any;
      this.contentParser = undefined as any;
      this.stepRenderer = undefined as any;
      this.toolCallRenderer = undefined as any;
      this.searchHandler = undefined as any;
      this.exportHandler = undefined as any;
      
      this.isInitialized = false;
      
      this.logger.debug('Enhanced thinking block cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup enhanced thinking block', {}, error);
    }
  }

  /**
   * Called when an attribute is changed
   */
  static get observedAttributes(): string[] {
    return ['content', 'think', 'answer', 'tokens', 'streaming'];
  }

  /**
   * Called when an attribute is changed
   */
  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (!this.isInitialized) {
      return;
    }

    this.logger.debug(`Attribute changed: ${name}`, { oldValue, newValue });

    try {
      switch (name) {
        case 'content':
          this.handleContentChange(newValue);
          break;
        case 'think':
          this.handleThinkingChange(newValue);
          break;
        case 'answer':
          this.handleAnswerChange(newValue);
          break;
        case 'tokens':
          this.handleTokensChange(newValue);
          break;
        case 'streaming':
          this.handleStreamingChange(newValue);
          break;
      }
    } catch (error) {
      this.logger.error(`Failed to handle attribute change: ${name}`, { name, oldValue, newValue }, error);
    }
  }

  /**
   * Renders the initial template
   */
  private renderTemplate(): void {
    this.logger.debug('Rendering initial template');

    try {
      this.shadow.innerHTML = `
        <style>
          :host {
            display: block;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.5;
            color: #333;
            background-color: #f8f9fa;
            border-radius: 8px;
            padding: 16px;
            margin: 8px 0;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            opacity: 0;
            transition: opacity 0.2s ease-in-out;
          }

          :host([streaming="true"]) {
            opacity: 1;
          }

          :host([streaming="false"]) {
            opacity: 1;
          }

          /* Prevent flash during initialization */
          .thinking-content {
            min-height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .thinking-content:empty::before {
            content: "Thinking...";
            color: #6c757d;
            font-style: italic;
          }

          .thinking-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e9ecef;
          }

          .thinking-title {
            display: flex;
            align-items: center;
            font-weight: 600;
            font-size: 16px;
            color: #495057;
          }

          .thinking-icon {
            margin-right: 8px;
            font-size: 18px;
          }

          .thinking-actions {
            display: flex;
            gap: 8px;
          }

          .thinking-action {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            color: #6c757d;
            transition: color 0.2s, background-color 0.2s;
          }

          .thinking-action:hover {
            color: #495057;
            background-color: #e9ecef;
          }

          .thinking-action:focus {
            outline: 2px solid #007bff;
            outline-offset: 2px;
          }

          .thinking-content {
            margin-bottom: 12px;
          }

          .steps-container {
            margin-bottom: 12px;
          }

          .steps-list {
            list-style: none;
            padding: 0;
            margin: 0;
          }

          .step-item {
            display: flex;
            align-items: flex-start;
            margin-bottom: 8px;
            padding: 8px;
            border-radius: 4px;
            background-color: #fff;
            border-left: 3px solid #007bff;
          }

          .step-icon {
            margin-right: 8px;
            font-size: 16px;
            flex-shrink: 0;
          }

          .step-content {
            flex: 1;
            min-width: 0;
          }

          .step-title {
            font-weight: 600;
            margin-bottom: 4px;
            color: #495057;
          }

          .step-description {
            font-size: 14px;
            color: #6c757d;
            word-wrap: break-word;
          }

          .tool-call-block {
            margin-top: 8px;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            overflow: hidden;
          }

          .tool-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px;
            background-color: #f8f9fa;
            cursor: pointer;
            user-select: none;
          }

          .tool-info {
            display: flex;
            align-items: center;
          }

          .tool-icon {
            margin-right: 4px;
            font-size: 14px;
          }

          .tool-name {
            font-weight: 600;
            font-size: 14px;
            color: #495057;
          }

          .tool-status {
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 12px;
            background-color: #e9ecef;
            color: #6c757d;
          }

          .tool-status.running {
            background-color: #fff3cd;
            color: #856404;
          }

          .tool-status.success {
            background-color: #d4edda;
            color: #155724;
          }

          .tool-status.error {
            background-color: #f8d7da;
            color: #721c24;
          }

          .tool-body {
            padding: 8px;
            border-top: 1px solid #e9ecef;
          }

          .tool-section {
            margin-bottom: 8px;
          }

          .tool-section:last-child {
            margin-bottom: 0;
          }

          .tool-label {
            font-weight: 600;
            font-size: 12px;
            color: #6c757d;
            margin-bottom: 4px;
            text-transform: uppercase;
          }

          .tool-content {
            font-size: 14px;
            color: #495057;
            background-color: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            font-family: monospace;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 200px;
            overflow-y: auto;
          }

          .tool-content.json {
            background-color: #f1f3f4;
          }

          .answer-container {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #e9ecef;
          }

          .answer-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: #495057;
          }

          .answer-content {
            font-size: 14px;
            color: #495057;
          }

          .answer-wrapper {
            background-color: #fff;
            padding: 12px;
            border-radius: 4px;
            border-left: 3px solid #28a745;
          }

          .thinking-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 12px;
            padding-top: 8px;
            border-top: 1px solid #e9ecef;
            font-size: 12px;
            color: #6c757d;
          }

          .token-count {
            font-weight: 600;
          }

          .streaming-indicator {
            display: flex;
            align-items: center;
          }

          .streaming-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: #007bff;
            margin-right: 4px;
            animation: pulse 1.5s infinite ease-in-out;
          }

          .streaming-dot:nth-child(2) {
            animation-delay: 0.2s;
          }

          .streaming-dot:nth-child(3) {
            animation-delay: 0.4s;
          }

          @keyframes pulse {
            0%, 80%, 100% {
              transform: scale(0.8);
              opacity: 0.5;
            }
            40% {
              transform: scale(1);
              opacity: 1;
            }
          }

          .search-highlight {
            background-color: #fff3cd;
            padding: 1px 2px;
            border-radius: 2px;
          }

          .error-message {
            color: #721c24;
            background-color: #f8d7da;
            padding: 12px;
            border-radius: 4px;
            border-left: 3px solid #dc3545;
            margin-bottom: 12px;
          }
        </style>

        <div class="thinking-header">
          <div class="thinking-title">
            <span class="thinking-icon">🤔</span>
            <span>Thinking Process</span>
          </div>
          <div class="thinking-actions">
            <button class="thinking-action" id="search-action" title="Search">
              🔍
            </button>
            <button class="thinking-action" id="export-action" title="Export">
              📥
            </button>
            <button class="thinking-action" id="copy-action" title="Copy">
              📋
            </button>
            <button class="thinking-action" id="toggle-action" title="Toggle">
              👁️
            </button>
          </div>
        </div>

        <div class="thinking-content">
          <div class="steps-container">
            <ul class="steps-list" id="steps-list"></ul>
          </div>
        </div>

        <div class="answer-container" id="answer-container" style="display: none;">
          <div class="answer-title">Answer</div>
          <div class="answer-content" id="answer-content"></div>
        </div>

        <div class="thinking-footer">
          <div class="token-count">Tokens: <span id="token-count">0</span></div>
          <div class="streaming-indicator" id="streaming-indicator" style="display: none;">
            <div class="streaming-dot"></div>
            <div class="streaming-dot"></div>
            <div class="streaming-dot"></div>
            <span>Streaming...</span>
          </div>
        </div>
      `;
    } catch (error) {
      this.logger.error('Failed to render initial template', {}, error);
      throw error;
    }
  }

  /**
   * Sets up event listeners
   */
  private setupEventListeners(): void {
    this.logger.debug('Setting up event listeners');

    try {
      // Search action
      const searchAction = this.shadow.getElementById('search-action');
      if (searchAction) {
        searchAction.addEventListener('click', () => {
          this.handleSearchAction();
        });
      }

      // Export action
      const exportAction = this.shadow.getElementById('export-action');
      if (exportAction) {
        exportAction.addEventListener('click', () => {
          this.handleExportAction();
        });
      }

      // Copy action
      const copyAction = this.shadow.getElementById('copy-action');
      if (copyAction) {
        copyAction.addEventListener('click', () => {
          this.handleCopyAction();
        });
      }

      // Toggle action
      const toggleAction = this.shadow.getElementById('toggle-action');
      if (toggleAction) {
        toggleAction.addEventListener('click', () => {
          this.handleToggleAction();
        });
      }
    } catch (error) {
      this.logger.error('Failed to set up event listeners', {}, error);
      throw error;
    }
  }

  /**
   * Sets up attribute observers
   */
  private setupAttributeObservers(): void {
    this.logger.debug('Setting up attribute observers');

    try {
      // Attribute observers are set up via observedAttributes and attributeChangedCallback
    } catch (error) {
      this.logger.error('Failed to set up attribute observers', {}, error);
      throw error;
    }
  }

  /**
   * Handles content change
   */
  private handleContentChange(content: string): void {
    this.logger.debug('Handling content change', { contentLength: content?.length || 0 });

    try {
      // For streaming content, use a more gradual approach
      if (this.isInitialized && content) {
        // Parse content segments to separate thinking and answer
         const segments = this.contentParser.parseContentSegments(content);

         this.logger.debug('Content segments received:', {
           segmentCount: segments.length,
           segments: segments.map(s => ({
             type: s.type,
             contentLength: s.content.length,
             contentPreview: s.content.substring(0, 50)
           }))
         });

         let thinkingContent = '';
         let answerContent = '';

         segments.forEach((segment, index) => {
           this.logger.debug(`Processing segment ${index}:`, {
             type: segment.type,
             contentLength: segment.content.length
           });

           if (segment.type === 'thinking') {
             thinkingContent += segment.content;
           } else {
             answerContent += segment.content;
           }
         });
        
        this.logger.debug('Content segments parsed', {
          thinkingLength: thinkingContent.length,
          answerLength: answerContent.length,
          segmentCount: segments.length
        });

        this.logger.debug('Final content breakdown:', {
          thinkingContentPreview: thinkingContent.substring(0, 100),
          answerContentPreview: answerContent.substring(0, 100)
        });
        
        // Update thinking and answer separately to prevent flashing
        if (thinkingContent) {
          this.core.setThinkingContent(thinkingContent);
        }
        
        if (answerContent && answerContent.trim()) {
           this.core.setAnswerContent(answerContent);

           // Show/hide answer container based on answer content
           const answerContainer = this.shadow.getElementById('answer-container');
           if (answerContainer) {
             answerContainer.style.display = 'block';
             this.logger.debug('Answer container shown with content', {
               answerLength: answerContent.length,
               answerPreview: answerContent.substring(0, 100)
             });
           }
         } else {
           // Hide answer container if no answer content
           const answerContainer = this.shadow.getElementById('answer-container');
           if (answerContainer) {
             answerContainer.style.display = 'none';
             this.logger.debug('Answer container hidden due to no/empty answer content', {
               answerLength: answerContent?.length || 0
             });
           }
         }
        
        // Also set full content for comprehensive parsing
        this.core.setContent(content);
      } else {
        this.core.setContent(content || '');
        
        // For empty or non-string content, check if we should still show answer container
        if (!content || typeof content !== 'string') {
          const answerContainer = this.shadow.getElementById('answer-container');
          if (answerContainer) {
            answerContainer.style.display = 'none';
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle content change', {}, error);
      this.showError('Failed to update content');
    }
  }

  /**
   * Handles thinking change
   */
  private handleThinkingChange(thinking: string): void {
    this.logger.debug('Handling thinking change', { thinkingLength: thinking?.length || 0 });

    try {
      this.core.setThinkingContent(thinking || '');
    } catch (error) {
      this.logger.error('Failed to handle thinking change', {}, error);
      this.showError('Failed to update thinking content');
    }
  }

  /**
   * Handles answer change
   */
  private handleAnswerChange(answer: string): void {
    this.logger.debug('Handling answer change', { answerLength: answer?.length || 0 });

    try {
      this.core.setAnswerContent(answer || '');

      // Show/hide answer container
      const answerContainer = this.shadow.getElementById('answer-container');
      if (answerContainer) {
        const shouldShow = answer && answer.trim();
        answerContainer.style.display = shouldShow ? 'block' : 'none';
        this.logger.debug('Answer container visibility updated from handleAnswerChange', {
          shouldShow,
          answerLength: answer?.length || 0,
          answerPreview: shouldShow ? answer.substring(0, 100) : 'N/A'
        });
      }
    } catch (error) {
      this.logger.error('Failed to handle answer change', {}, error);
      this.showError('Failed to update answer content');
    }
  }

  /**
   * Handles tokens change
   */
  private handleTokensChange(tokens: string): void {
    this.logger.debug('Handling tokens change', { tokens });

    try {
      const tokenCount = parseInt(tokens) || 0;
      this.core.setTokenCount(tokenCount);
    } catch (error) {
      this.logger.error('Failed to handle tokens change', {}, error);
      this.showError('Failed to update token count');
    }
  }

  /**
   * Handles streaming change
   */
  private handleStreamingChange(streaming: string): void {
    this.logger.debug('Handling streaming change', { streaming });

    try {
      const isStreaming = streaming === 'true';
      this.core.setStreamingState(isStreaming);

      // Show/hide streaming indicator
      const streamingIndicator = this.shadow.getElementById('streaming-indicator');
      if (streamingIndicator) {
        streamingIndicator.style.display = isStreaming ? 'flex' : 'none';
      }
    } catch (error) {
      this.logger.error('Failed to handle streaming change', {}, error);
      this.showError('Failed to update streaming state');
    }
  }

  /**
   * Handles search action
   */
  private handleSearchAction(): void {
    this.logger.debug('Handling search action');

    try {
      // Create search dialog
      const searchDialog = document.createElement('dialog');
      searchDialog.style.width = '400px';
      searchDialog.style.padding = '16px';
      searchDialog.style.borderRadius = '8px';
      searchDialog.style.border = '1px solid #e9ecef';
      searchDialog.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';

      searchDialog.innerHTML = `
        <h3 style="margin-top: 0; margin-bottom: 16px;">Search Thinking Block</h3>
        <input type="text" id="search-input" placeholder="Enter search query..." style="width: 100%; padding: 8px; margin-bottom: 16px; border: 1px solid #e9ecef; border-radius: 4px;">
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="search-cancel" style="padding: 8px 16px; border: 1px solid #e9ecef; border-radius: 4px; background-color: #f8f9fa; cursor: pointer;">Cancel</button>
          <button id="search-submit" style="padding: 8px 16px; border: 1px solid #007bff; border-radius: 4px; background-color: #007bff; color: white; cursor: pointer;">Search</button>
        </div>
      `;

      document.body.appendChild(searchDialog);
      searchDialog.showModal();

      // Set up search dialog event listeners
      const searchInput = searchDialog.querySelector('#search-input') as HTMLInputElement;
      const searchCancel = searchDialog.querySelector('#search-cancel') as HTMLButtonElement;
      const searchSubmit = searchDialog.querySelector('#search-submit') as HTMLButtonElement;

      const closeSearchDialog = () => {
        document.body.removeChild(searchDialog);
      };

      searchCancel.addEventListener('click', closeSearchDialog);

      searchSubmit.addEventListener('click', () => {
        const query = searchInput.value.trim();
        if (query) {
          this.performSearch(query);
        }
        closeSearchDialog();
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          if (query) {
            this.performSearch(query);
          }
          closeSearchDialog();
        } else if (e.key === 'Escape') {
          closeSearchDialog();
        }
      });
    } catch (error) {
      this.logger.error('Failed to handle search action', {}, error);
      this.showError('Failed to open search dialog');
    }
  }

  /**
   * Performs search
   */
  private performSearch(query: string): void {
    this.logger.debug('Performing search', { query });

    try {
      const steps = this.core.getSteps();
      this.searchHandler.initialize(steps);
      const results = this.searchHandler.search(query);

      if (results.length > 0) {
        // Highlight search results
        const stepsList = this.shadow.getElementById('steps-list');
        if (stepsList) {
          const stepElements = stepsList.querySelectorAll('.step-item');
          results.forEach(result => {
            if (stepElements[result.stepIndex]) {
              const highlightedElement = this.searchHandler.highlightSearchResults(
                stepElements[result.stepIndex] as HTMLElement,
                result.matches
              );
              stepElements[result.stepIndex].replaceWith(highlightedElement);
            }
          });
        }
      } else {
        // Show no results message
        this.showError('No results found');
      }
    } catch (error) {
      this.logger.error('Failed to perform search', { query }, error);
      this.showError('Failed to perform search');
    }
  }

  /**
   * Handles export action
   */
  private handleExportAction(): void {
    this.logger.debug('Handling export action');

    try {
      // Create export dialog
      const exportDialog = document.createElement('dialog');
      exportDialog.style.width = '400px';
      exportDialog.style.padding = '16px';
      exportDialog.style.borderRadius = '8px';
      exportDialog.style.border = '1px solid #e9ecef';
      exportDialog.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';

      exportDialog.innerHTML = `
        <h3 style="margin-top: 0; margin-bottom: 16px;">Export Thinking Block</h3>
        <div style="margin-bottom: 16px;">
          <label for="export-format" style="display: block; margin-bottom: 8px; font-weight: 600;">Format:</label>
          <select id="export-format" style="width: 100%; padding: 8px; border: 1px solid #e9ecef; border-radius: 4px;">
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
            <option value="text">Plain Text</option>
            <option value="csv">CSV</option>
          </select>
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 600;">Options:</label>
          <label style="display: block; margin-bottom: 4px;">
            <input type="checkbox" id="include-timestamps" checked> Include timestamps
          </label>
          <label style="display: block; margin-bottom: 4px;">
            <input type="checkbox" id="include-tool-calls" checked> Include tool calls
          </label>
          <label style="display: block; margin-bottom: 4px;">
            <input type="checkbox" id="include-metadata" checked> Include metadata
          </label>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="export-cancel" style="padding: 8px 16px; border: 1px solid #e9ecef; border-radius: 4px; background-color: #f8f9fa; cursor: pointer;">Cancel</button>
          <button id="export-submit" style="padding: 8px 16px; border: 1px solid #007bff; border-radius: 4px; background-color: #007bff; color: white; cursor: pointer;">Export</button>
        </div>
      `;

      document.body.appendChild(exportDialog);
      exportDialog.showModal();

      // Set up export dialog event listeners
      const exportFormat = exportDialog.querySelector('#export-format') as HTMLSelectElement;
      const includeTimestamps = exportDialog.querySelector('#include-timestamps') as HTMLInputElement;
      const includeToolCalls = exportDialog.querySelector('#include-tool-calls') as HTMLInputElement;
      const includeMetadata = exportDialog.querySelector('#include-metadata') as HTMLInputElement;
      const exportCancel = exportDialog.querySelector('#export-cancel') as HTMLButtonElement;
      const exportSubmit = exportDialog.querySelector('#export-submit') as HTMLButtonElement;

      const closeExportDialog = () => {
        document.body.removeChild(exportDialog);
      };

      exportCancel.addEventListener('click', closeExportDialog);

      exportSubmit.addEventListener('click', () => {
        const format = exportFormat.value as any;
        const options = {
          format,
          includeTimestamps: includeTimestamps.checked,
          includeToolCalls: includeToolCalls.checked,
          includeMetadata: includeMetadata.checked
        };

        this.performExport(options);
        closeExportDialog();
      });
    } catch (error) {
      this.logger.error('Failed to handle export action', {}, error);
      this.showError('Failed to open export dialog');
    }
  }

  /**
   * Performs export
   */
  private performExport(options: any): void {
    this.logger.debug('Performing export', { format: options.format });

    try {
      const steps = this.core.getSteps();
      const content = this.getAttribute('content') || '';
      const thinking = this.getAttribute('think') || '';
      const answer = this.getAttribute('answer') || '';
      const tokens = parseInt(this.getAttribute('tokens') || '0');
      const timestamp = new Date().toISOString();

      const exportData: ExportData = {
        steps,
        content,
        thinking,
        answer,
        tokens,
        timestamp
      };

      const exportedData = this.exportHandler.export(exportData, options);
      const filename = this.exportHandler.createFilename(options.format, timestamp);

      this.exportHandler.download(exportedData, filename, options.format);
    } catch (error) {
      this.logger.error('Failed to perform export', {}, error);
      this.showError('Failed to export thinking block');
    }
  }

  /**
   * Handles copy action
   */
  private handleCopyAction(): void {
    this.logger.debug('Handling copy action');

    try {
      const answer = this.core.getRawAnswer();
      if (answer) {
        this.exportHandler.copyToClipboard(answer).then(() => {
          this.showSuccess('Copied to clipboard');
        }).catch(error => {
          this.logger.error('Failed to copy to clipboard', {}, error);
          this.showError('Failed to copy to clipboard');
        });
      } else {
        this.showError('No content to copy');
      }
    } catch (error) {
      this.logger.error('Failed to handle copy action', {}, error);
      this.showError('Failed to copy content');
    }
  }

  /**
   * Handles toggle action
   */
  private handleToggleAction(): void {
    this.logger.debug('Handling toggle action');

    try {
      const thinkingContent = this.shadow.querySelector('.thinking-content') as HTMLElement;
      if (thinkingContent) {
        const isHidden = thinkingContent.style.display === 'none';
        thinkingContent.style.display = isHidden ? 'block' : 'none';
      }
    } catch (error) {
      this.logger.error('Failed to handle toggle action', {}, error);
      this.showError('Failed to toggle content');
    }
  }

  /**
   * Shows error message
   */
  private showError(message: string): void {
    this.logger.debug('Showing error message', { message });

    try {
      // Remove existing error messages
      const existingErrors = this.shadow.querySelectorAll('.error-message');
      existingErrors.forEach(error => {
        error.remove();
      });

      // Create error message
      const errorMessage = document.createElement('div');
      errorMessage.className = 'error-message';
      errorMessage.textContent = message;

      // Insert at the beginning of thinking content
      const thinkingContent = this.shadow.querySelector('.thinking-content');
      if (thinkingContent) {
        thinkingContent.insertBefore(errorMessage, thinkingContent.firstChild);
      }

      // Auto-remove after 5 seconds
      setTimeout(() => {
        if (errorMessage.parentNode) {
          errorMessage.parentNode.removeChild(errorMessage);
        }
      }, 5000);
    } catch (error) {
      this.logger.error('Failed to show error message', {}, error);
    }
  }

  /**
   * Shows success message
   */
  private showSuccess(message: string): void {
    this.logger.debug('Showing success message', { message });

    try {
      // Create success message
      const successMessage = document.createElement('div');
      successMessage.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #d4edda;
        color: #155724;
        padding: 12px;
        border-radius: 4px;
        border-left: 3px solid #28a745;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        z-index: 1000;
      `;
      successMessage.textContent = message;

      document.body.appendChild(successMessage);

      // Auto-remove after 3 seconds
      setTimeout(() => {
        if (successMessage.parentNode) {
          successMessage.parentNode.removeChild(successMessage);
        }
      }, 3000);
    } catch (error) {
      this.logger.error('Failed to show success message', {}, error);
    }
  }

  /**
   * Cleans up resources
   */
  private cleanup(): void {
    this.logger.debug('Cleaning up resources');

    try {
      // Remove event listeners
      // (This would be more complex in a real implementation)
    } catch (error) {
      this.logger.error('Failed to cleanup resources', {}, error);
    }
  }
}

// Register the custom element
customElements.define('enhanced-thinking-block', EnhancedThinkingBlock);

export default EnhancedThinkingBlock;