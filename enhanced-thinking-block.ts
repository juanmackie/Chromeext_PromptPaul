// enhanced-thinking-block.ts - Enhanced thinking block with proper <thinking> tag parsing

class EnhancedThinkingBlock extends HTMLElement {
  private shadow: ShadowRoot;
  private isStreaming: boolean = false;
  private toolCalls: any[] = [];
  private steps: any[] = [];
  private thinkingTags: any[] = [];
  private parseErrors: any[] = [];
  private debounceTimer: any = null;
  private virtualScrollEnabled: boolean = false;
  private maxVisibleSteps: number = 50;
  private currentSegments: ContentSegment[] = [];
  private rawAnswer: string = '';

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.isStreaming = false;
    this.toolCalls = [];
    this.steps = [];
    this.thinkingTags = [];
    this.parseErrors = [];
    this.debounceTimer = null;
    this.virtualScrollEnabled = false;
    this.maxVisibleSteps = 50;
  }

  static get observedAttributes(): string[] {
    return ['content', 'think', 'answer', 'tokens', 'streaming'];
  }

  connectedCallback(): void {
    this.render();
    this.setupEventListeners();
    this.setupAccessibility();
    this.initializeVirtualScroll();
    
    // Initialize with current attributes if present
    if (this.hasAttribute('content')) {
      this.parseContentWithTags(this.getAttribute('content') || '');
    } else {
      if (this.hasAttribute('think')) this.updateThoughtContent(this.getAttribute('think') || '');
      if (this.hasAttribute('answer')) this.setAnswerContent(this.getAttribute('answer') || '');
    }
    if (this.hasAttribute('streaming')) this.setStreamingState(this.getAttribute('streaming') === 'true');
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal) return;
    
    try {
      switch (name) {
        case 'content':
          this.parseContentWithTags(newVal || '');
          break;
        case 'think':
          this.updateThoughtContent(newVal || '');
          break;
        case 'answer':
          this.setAnswerContent(newVal || '');
          break;
        case 'tokens':
          const tokenCountElement = this.shadow.getElementById('token-count');
          if (tokenCountElement && typeof newVal !== 'undefined' && newVal !== null) {
            tokenCountElement.textContent = String(newVal);
          }
          break;
        case 'streaming':
          this.setStreamingState(newVal === 'true');
          break;
      }
    } catch (error) {
      this.handleError('Attribute change error', error);
    }
  }

  private render(): void {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          margin: 1.5em 0;
          font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }
        
        /* Enhanced Main container */
        .thinking-container {
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          background: #ffffff;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
        }
        
        .thinking-container.streaming {
          border-color: #3b82f6;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1), 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .thinking-container.error {
          border-color: #ef4444;
          box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1), 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        /* Enhanced Header */
        .thinking-header {
          padding: 16px 20px;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border-bottom: 1px solid #e5e7eb;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: all 0.3s ease;
          user-select: none;
          position: relative;
        }
        
        .thinking-header:hover {
          background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
        }
        
        .thinking-header.streaming .title {
          color: #3b82f6;
          font-weight: 700;
        }
        
        .thinking-icon {
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .thinking-container[open] .thinking-icon {
          transform: rotate(90deg);
        }
        
        .title-area {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .title {
          font-weight: 600;
          font-size: 16px;
          color: #374151;
          transition: color 0.2s ease;
        }
        
        .enhanced-streaming-indicator {
          display: none;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: #3b82f6;
          font-weight: 500;
        }
        
        .streaming .enhanced-streaming-indicator {
          display: flex;
        }
        
        .thinking-pulse {
          width: 8px;
          height: 8px;
          background: #3b82f6;
          border-radius: 50%;
          animation: enhancedPulse 2s infinite;
        }
        
        .thinking-pulse:nth-child(2) { animation-delay: 0.3s; }
        .thinking-pulse:nth-child(3) { animation-delay: 0.6s; }
        
        @keyframes enhancedPulse {
          0%, 100% { 
            opacity: 0.3; 
            transform: scale(0.8);
          }
          50% { 
            opacity: 1; 
            transform: scale(1.2);
          }
        }
        
        .token-count {
          font-size: 12px;
          color: #6b7280;
          background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
          padding: 6px 12px;
          border-radius: 16px;
          font-weight: 600;
          border: 1px solid #d1d5db;
        }

        .error-indicator {
          display: none;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #ef4444;
          font-weight: 500;
        }
        
        .error .error-indicator {
          display: flex;
        }

        /* Enhanced Content Area */
        .thinking-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .thinking-container[open] .thinking-content {
          max-height: 800px;
          overflow-y: auto;
        }

        /* Virtual Scroll Container */
        .virtual-scroll-container {
          position: relative;
          max-height: 600px;
          overflow-y: auto;
        }

        .virtual-scroll-content {
          position: relative;
        }

        /* Enhanced Steps List */
        .steps-list {
          margin: 0;
          padding: 20px;
          list-style: none;
        }
        
        .step-item {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          padding: 16px 0;
          border-bottom: 1px solid #f3f4f6;
          opacity: 0;
          transform: translateY(20px);
          animation: enhancedSlideIn 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
          transition: background-color 0.2s ease;
        }
        
        .step-item:hover {
          background-color: #f8fafc;
          margin: 0 -20px;
          padding-left: 20px;
          padding-right: 20px;
        }
        
        .step-item:last-child {
          border-bottom: none;
        }
        
        .step-item:nth-child(1) { animation-delay: 0.1s; }
        .step-item:nth-child(2) { animation-delay: 0.2s; }
        .step-item:nth-child(3) { animation-delay: 0.3s; }
        
        @keyframes enhancedSlideIn {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .step-icon {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .step-icon.thinking {
          background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
          color: #1e40af;
        }
        
        .step-icon.tool {
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          color: #92400e;
        }
        
        .step-icon.result {
          background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
          color: #065f46;
        }
        
        .step-icon.error {
          background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
          color: #991b1b;
        }
        
        .step-content {
          flex: 1;
          min-width: 0;
        }
        
        .step-title {
          font-weight: 600;
          font-size: 14px;
          color: #374151;
          margin-bottom: 6px;
          line-height: 1.4;
        }
        
        .step-description {
          font-size: 14px;
          color: #6b7280;
          line-height: 1.6;
          word-wrap: break-word;
        }

        /* Enhanced Tool Call Blocks */
        .tool-call-block {
          margin: 20px 0;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #ffffff;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          transition: all 0.3s ease;
        }
        
        .tool-call-block:hover {
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
          transform: translateY(-2px);
        }
        
        .tool-header {
          padding: 16px 20px;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
        }
        
        .tool-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .tool-icon {
          width: 20px;
          height: 20px;
        }
        
        .tool-name {
          font-weight: 600;
          font-size: 14px;
          color: #374151;
        }
        
        .tool-status {
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 12px;
          font-weight: 500;
        }
        
        .tool-status.success {
          background: #d1fae5;
          color: #065f46;
        }
        
        .tool-status.error {
          background: #fee2e2;
          color: #991b1b;
        }
        
        .tool-status.running {
          background: #dbeafe;
          color: #1e40af;
        }
        
        .tool-body {
          padding: 20px;
        }
        
        .tool-section {
          margin-bottom: 16px;
        }
        
        .tool-section:last-child {
          margin-bottom: 0;
        }
        
        .tool-label {
          font-size: 12px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        
        .tool-content {
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 12px 16px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 13px;
          line-height: 1.5;
          color: #374151;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 200px;
          overflow-y: auto;
        }

        .tool-content.json {
          background: #1e293b;
          color: #e2e8f0;
          border-color: #334155;
        }

        /* Enhanced Raw thinking fallback */
        .raw-thinking {
          padding: 24px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 14px;
          line-height: 1.6;
          color: #374151;
          white-space: pre-wrap;
          word-break: break-word;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border-radius: 12px;
          margin: 20px;
          border: 1px solid #e5e7eb;
        }

        /* Enhanced Answer Section */
        .answer-section {
          margin-top: 20px;
          padding: 0 20px 20px;
        }
        
        .answer-content {
          background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          border-left: 4px solid #4f46e5;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        
        .answer-content p {
          margin: 0 0 1em 0;
          line-height: 1.6;
        }
        
        .answer-content p:last-child {
          margin-bottom: 0;
        }
        
        .answer-content strong {
          color: #1f2937;
          font-weight: 600;
        }
        
        .answer-content ul, .answer-content ol {
          margin: 1em 0;
          padding-left: 1.5em;
        }
        
        .answer-content li {
          margin: 0.5em 0;
          line-height: 1.6;
        }
        
        .answer-content li:last-child {
          margin-bottom: 0;
        }

        /* Enhanced Actions */
        .thinking-actions {
          padding: 16px 20px;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border-top: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }
        
        .action-button {
          padding: 8px 16px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          color: #374151;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .action-button:hover {
          background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
          border-color: #9ca3af;
          transform: translateY(-1px);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
        }
        
        .action-button:active {
          background: linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%);
          transform: translateY(0);
        }

        .action-button.primary {
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          border-color: #2563eb;
        }

        .action-button.primary:hover {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          border-color: #1d4ed8;
        }

        /* Search functionality */
        .search-container {
          padding: 12px 20px;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border-bottom: 1px solid #e5e7eb;
          display: none;
        }
        
        .search-container.active {
          display: block;
        }
        
        .search-input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 13px;
          background: white;
        }
        
        .search-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        /* Progress bar */
        .progress-container {
          height: 3px;
          background: #e5e7eb;
          overflow: hidden;
          display: none;
        }
        
        .progress-container.active {
          display: block;
        }
        
        .progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6 0%, #2563eb 100%);
          width: 0%;
          transition: width 0.3s ease;
        }

        /* Error display */
        .error-display {
          margin: 16px;
          padding: 16px;
          background: #fee2e2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #991b1b;
          font-size: 13px;
          display: none;
        }
        
        .error-display.active {
          display: block;
        }

        /* Enhanced Dark theme support */
        :host-context(.dark-theme) .thinking-container {
          background: #1f2937;
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .thinking-header {
          background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .thinking-header:hover {
          background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
        }
        
        :host-context(.dark-theme) .title {
          color: #f3f4f6;
        }
        
        :host-context(.dark-theme) .token-count {
          background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
          color: #d1d5db;
          border-color: #4b5563;
        }
        
        :host-context(.dark-theme) .step-item:hover {
          background-color: #374151;
        }
        
        :host-context(.dark-theme) .step-item {
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .tool-call-block {
          background: #1f2937;
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .tool-header {
          background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .tool-name {
          color: #f3f4f6;
        }
        
        :host-context(.dark-theme) .tool-content {
          background: #111827;
          border-color: #374151;
          color: #f3f4f6;
        }
        
        :host-context(.dark-theme) .raw-thinking {
          background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
          color: #f3f4f6;
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .thinking-actions {
          background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .action-button {
          background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
          border-color: #4b5563;
          color: #f3f4f6;
        }
        
        :host-context(.dark-theme) .action-button:hover {
          background: linear-gradient(135deg, #4b5563 0%, #6b7280 100%);
          border-color: #6b7280;
        }

        :host-context(.dark-theme) .search-input {
          background: #1f2937;
          border-color: #4b5563;
          color: #f3f4f6;
        }

        :host-context(.dark-theme) .answer-content {
          background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
          border-left-color: #6366f1;
        }

        /* Accessibility improvements */
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        /* Loading skeleton */
        .skeleton {
          background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
          background-size: 200% 100%;
          animation: loading 1.5s infinite;
        }

        @keyframes loading {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Responsive design */
        @media (max-width: 640px) {
          .thinking-header {
            padding: 12px 16px;
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
          
          .title-area {
            width: 100%;
            justify-content: space-between;
          }
          
          .step-item {
            flex-direction: column;
            gap: 12px;
            padding: 12px 0;
          }
          
          .step-icon {
            align-self: flex-start;
          }
          
          .thinking-actions {
            flex-direction: column;
            align-items: stretch;
          }
          
          .action-button {
            justify-content: center;
          }
        }
      </style>
      
      <div class="thinking-container" id="thinking-container">
        <div class="progress-container" id="progress-container">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
        
        <div class="thinking-header" id="thinking-header" role="button" tabindex="0" aria-expanded="false" aria-label="Model thinking process">
          <span class="thinking-icon" aria-hidden="true">&#9654;</span>
          <div class="title-area">
            <span class="title">Model Thinking Process</span>
            <div class="enhanced-streaming-indicator">
              <span class="thinking-pulse"></span>
              <span class="thinking-pulse"></span>
              <span class="thinking-pulse"></span>
              <span style="margin-left: 4px;">Thinking...</span>
            </div>
            <div class="error-indicator">
              <span>\u26A0\uFE0F</span>
              <span>Error</span>
            </div>
          </div>
          <span class="token-count" aria-label="Token count">(<span id="token-count">0</span> tokens)</span>
        </div>
        
        <div class="search-container" id="search-container">
          <input type="text" class="search-input" id="search-input" placeholder="Search thinking process..." aria-label="Search thinking process">
        </div>
        
        <div class="thinking-content" id="thinking-content">
          <div class="virtual-scroll-container" id="virtual-scroll-container">
            <div class="virtual-scroll-content">
              <ul class="steps-list" id="steps-list" role="list"></ul>
              <div class="raw-thinking" id="raw-thinking" style="display: none;" aria-hidden="true"></div>
            </div>
          </div>
        </div>
        
        <div class="error-display" id="error-display" role="alert"></div>
        
        <div class="answer-section">
          <div class="answer-content" id="answer-content" aria-live="polite"></div>
        </div>
        
        <div class="thinking-actions">
          <div class="action-group">
            <button class="action-button" id="search-button" title="Search thinking process" aria-label="Search thinking process">
              \uD83D\uDD0D Search
            </button>
            <button class="action-button" id="copy-button" title="Copy thinking process" aria-label="Copy thinking process">
              \uD83D\uDCCB Copy
            </button>
            <button class="action-button" id="export-button" title="Export thinking process" aria-label="Export thinking process">
              \uD83D\uDCBE Export
            </button>
          </div>
          <div class="action-group">
            <button class="action-button" id="copy-answer-raw-button" title="Copy final answer (raw)" aria-label="Copy final answer as plain text">
              \uD83D\uDCC4 Copy Answer
            </button>
            <button class="action-button" id="copy-answer-formatted-button" title="Copy final answer (formatted)" aria-label="Copy final answer as formatted">
              ✨ Copy Formatted
            </button>
          </div>
          <div class="action-group">
            <button class="action-button" id="toggle-raw-button" title="Toggle raw view" aria-label="Toggle raw view">
              \uD83D\uDCC4 Raw
            </button>
            <button class="action-button primary" id="toggle-expand-button" title="Toggle expand all" aria-label="Toggle expand all tool calls">
              ↕️ Expand All
            </button>
          </div>
        </div>
      </div>
      
      <!-- Hidden elements for accessibility -->
      <div class="sr-only" id="accessibility-announcements" aria-live="polite" aria-atomic="true"></div>
    `;
  }

  private setupEventListeners(): void {
    try {
      const header = this.shadow.getElementById('thinking-header');
      const container = this.shadow.getElementById('thinking-container');
      const copyButton = this.shadow.getElementById('copy-button');
      const copyAnswerRawButton = this.shadow.getElementById('copy-answer-raw-button');
      const copyAnswerFormattedButton = this.shadow.getElementById('copy-answer-formatted-button');
      const toggleRawButton = this.shadow.getElementById('toggle-raw-button');
      const searchButton = this.shadow.getElementById('search-button');
      const searchContainer = this.shadow.getElementById('search-container');
      const searchInput = this.shadow.getElementById('search-input');
      const exportButton = this.shadow.getElementById('export-button');
      const toggleExpandButton = this.shadow.getElementById('toggle-expand-button');
      
      if (!header || !container) return;
      
      const key = 'thinkExpanded';
      const wasExpanded = localStorage.getItem(key) !== 'false';
      if (wasExpanded) {
        container.setAttribute('open', '');
        header.setAttribute('aria-expanded', 'true');
      }
      
      const toggleCollapse = () => {
        const isOpen = container.hasAttribute('open');
        if (isOpen) {
          container.removeAttribute('open');
          header.setAttribute('aria-expanded', 'false');
        } else {
          container.setAttribute('open', '');
          header.setAttribute('aria-expanded', 'true');
        }
        localStorage.setItem(key, String(!isOpen));
        this.announceToScreenReader(`Thinking process ${!isOpen ? 'expanded' : 'collapsed'}`);
      };
      
      header.addEventListener('click', toggleCollapse);
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleCollapse();
        }
      });
      
      // Copy functionality
      if (copyButton) {
        copyButton.addEventListener('click', () => {
          this.copyThinkingProcess();
        });
      }
      
      // Copy final answer (raw)
      if (copyAnswerRawButton) {
        copyAnswerRawButton.addEventListener('click', () => {
          this.copyFinalAnswer(false);
        });
      }

      // Copy final answer (formatted)
      if (copyAnswerFormattedButton) {
        copyAnswerFormattedButton.addEventListener('click', () => {
          this.copyFinalAnswer(true);
        });
      }

      // Toggle raw view
      if (toggleRawButton) {
        toggleRawButton.addEventListener('click', () => {
          this.toggleRawView();
        });
      }
      
      // Search functionality
      if (searchButton && searchContainer) {
        searchButton.addEventListener('click', () => {
          this.toggleSearch();
        });
      }
      
      if (searchInput) {
        searchInput.addEventListener('input', this.debounce(() => {
          this.performSearch(searchInput.value);
        }, 300));
        
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            this.toggleSearch();
          }
        });
      }
      
      // Export functionality
      if (exportButton) {
        exportButton.addEventListener('click', () => {
          this.exportThinkingProcess();
        });
      }
      
      // Toggle expand all
      if (toggleExpandButton) {
        toggleExpandButton.addEventListener('click', () => {
          this.toggleExpandAll();
        });
      }
      
      // Keyboard navigation
      this.setupKeyboardNavigation();
      
    } catch (error) {
      this.handleError('Event listener setup error', error);
    }
  }

  private setupAccessibility(): void {
    const container = this.shadow.getElementById('thinking-container');
    const header = this.shadow.getElementById('thinking-header');
    
    if (container && header) {
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Model thinking process');
      
      // Ensure proper ARIA attributes
      if (!header.hasAttribute('aria-expanded')) {
        header.setAttribute('aria-expanded', 'false');
      }
    }
  }

  private setupKeyboardNavigation(): void {
    this.addEventListener('keydown', (e) => {
      const container = this.shadow.getElementById('thinking-container');
      const steps = this.shadow.querySelectorAll('.step-item');
      
      if (!container || !steps) return;
      
      // Handle keyboard navigation within steps
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const activeElement = this.shadow.activeElement;
        if (activeElement && activeElement.classList.contains('step-item')) {
          e.preventDefault();
          const currentIndex = Array.from(steps).indexOf(activeElement as Element);
          const nextIndex = e.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;
          
          if (nextIndex >= 0 && nextIndex < steps.length) {
            (steps[nextIndex] as HTMLElement).focus();
          }
        }
      }
      
      // Handle Escape key
      if (e.key === 'Escape') {
        const searchContainer = this.shadow.getElementById('search-container');
        if (searchContainer?.classList.contains('active')) {
          this.toggleSearch();
        }
      }
    });
  }

  private initializeVirtualScroll(): void {
    const container = this.shadow.getElementById('virtual-scroll-container');
    if (container) {
      container.addEventListener('scroll', this.debounce(() => {
        this.handleVirtualScroll();
      }, 100));
    }
  }

  private handleVirtualScroll(): void {
    if (!this.virtualScrollEnabled) return;
    
    const container = this.shadow.getElementById('virtual-scroll-container');
    const steps = this.shadow.querySelectorAll('.step-item');
    
    if (!container || !steps) return;
    
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const stepHeight = 80; // Approximate height of each step
    
    const startIndex = Math.floor(scrollTop / stepHeight);
    const endIndex = Math.min(startIndex + Math.ceil(containerHeight / stepHeight) + 2, steps.length);
    
    // Show/hide steps based on visibility
    steps.forEach((step, index) => {
      if (index >= startIndex && index < endIndex) {
        (step as HTMLElement).style.display = 'flex';
      } else {
        (step as HTMLElement).style.display = 'none';
      }
    });
  }

  // Enhanced <thinking> tag parsing
  private parseContentWithTags(content: string): void {
    try {
      this.parseErrors = [];
      this.thinkingTags = [];
      
      if (!content || !content.trim()) {
        this.updateThoughtContent('');
        return;
      }
      
      // Parse <thinking> tags
      const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
      let match;
      let allThinkingContent = '';
      
      while ((match = thinkingRegex.exec(content)) !== null) {
        const thinkingContent = match[1].trim();
        if (thinkingContent) {
          this.thinkingTags.push({
            content: thinkingContent,
            startIndex: match.index,
            endIndex: match.index + match[0].length
          });
          allThinkingContent += thinkingContent + '\n\n';
        }
      }
      
      // Extract content outside thinking tags as the answer
      const answerContent = content.replace(thinkingRegex, '').trim();
      
      if (allThinkingContent.trim()) {
        this.updateThoughtContent(allThinkingContent.trim());
      } else {
        // Fallback to legacy parsing if no thinking tags found
        this.updateThoughtContent(content);
      }
      
      if (answerContent) {
        this.setAnswerContent(answerContent);
      }
      
    } catch (error) {
      this.handleError('Content parsing error', error);
      // Fallback to legacy parsing
      this.updateThoughtContent(content);
    }
  }

  private updateThoughtContent(thought: string): void {
    try {
      const tokenCountElement = this.shadow.getElementById('token-count');
      const stepsList = this.shadow.getElementById('steps-list');
      const rawThinking = this.shadow.getElementById('raw-thinking');
      
      // Update token count with debouncing
      if (tokenCountElement) {
        this.debounce(() => {
          const tokenCount = this.calculateTokenCount(thought || '');
          tokenCountElement.textContent = String(tokenCount);
        }, 200)();
      }
      
      // Parse thinking content into structured steps
      this.parseThinkingContent(thought || '');
      
      // Update steps list with virtual scroll support
      if (stepsList) {
        this.renderStepsList();
      }
      
      // Update raw thinking fallback
      if (rawThinking) {
        rawThinking.textContent = thought || '';
      }
      
      // Enable virtual scroll for large content
      this.virtualScrollEnabled = this.steps.length > this.maxVisibleSteps;
      
    } catch (error) {
      this.handleError('Thought content update error', error);
    }
  }

  private renderStepsList(): void {
    const stepsList = this.shadow.getElementById('steps-list');
    if (!stepsList) return;
    
    // Clear existing content
    stepsList.innerHTML = '';
    
    // Render steps with performance optimization
    const fragment = document.createDocumentFragment();
    
    this.steps.forEach((step, index) => {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.setAttribute('role', 'listitem');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-label', `${step.title}: ${step.description}`);
      
      li.innerHTML = `
        <div class="step-icon ${step.type}" aria-hidden="true">
          ${step.type === 'thinking' ? '\uD83E\uDD14' : step.type === 'tool' ? '\u2699\uFE0F' : step.type === 'result' ? '\u2713' : '\u274C'}
        </div>
        <div class="step-content">
          <div class="step-title">${this.escapeHtml(step.title)}</div>
          <div class="step-description">${this.escapeHtml(step.description)}</div>
          ${step.toolCall ? this.renderToolCall(step.toolCall) : ''}
        </div>
      `;
      
      // Add keyboard navigation
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleStepExpansion(li);
        }
      });
      
      fragment.appendChild(li);
    });
    
    stepsList.appendChild(fragment);
    
    // Handle virtual scroll if enabled
    if (this.virtualScrollEnabled) {
      this.handleVirtualScroll();
    }
  }

  private parseThinkingContent(thought: string): void {
    try {
      this.steps = [];
      this.toolCalls = [];
      
      if (!thought.trim()) return;
      
      // Try to parse structured thinking with enhanced patterns
      const lines = thought.split('\n').filter(line => line.trim());
      
      let currentStep = null;
      let inToolCall = false;
      let currentToolCall = null;
      let inCodeBlock = false;
      let codeBlockContent = '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Handle code blocks
        if (trimmed.startsWith('```')) {
          if (inCodeBlock) {
            // End code block
            if (currentStep && currentToolCall) {
              if (currentToolCall.output) {
                currentToolCall.output += '\n' + codeBlockContent;
              } else {
                currentToolCall.input += '\n' + codeBlockContent;
              }
            }
            codeBlockContent = '';
            inCodeBlock = false;
          } else {
            // Start code block
            inCodeBlock = true;
          }
          continue;
        }
        
        if (inCodeBlock) {
          codeBlockContent += line + '\n';
          continue;
        }
        
        // Enhanced tool call detection
        const toolMatch = trimmed.match(/(?:Tool:|Using tool:|Calling:|Execute:)\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (toolMatch) {
          if (currentStep) {
            this.steps.push(currentStep);
          }
          
          const toolName = toolMatch[1];
          currentStep = {
            type: 'tool',
            title: `Using tool: ${toolName}`,
            description: 'Executing tool call...',
            toolCall: {
              name: toolName,
              input: '',
              output: '',
              status: 'running'
            }
          };
          inToolCall = true;
          currentToolCall = currentStep.toolCall;
          continue;
        }
        
        // Enhanced input/output detection
        const inputMatch = trimmed.match(/(?:Input:|Arguments:|Params:|Request:)\s*(.*)/);
        const outputMatch = trimmed.match(/(?:Output:|Result:|Response:|Returns:)\s*(.*)/);
        
        if (inputMatch && inToolCall && currentToolCall) {
          currentToolCall.input += (currentToolCall.input ? '\n' : '') + inputMatch[1];
          continue;
        }
        
        if (outputMatch && inToolCall && currentToolCall) {
          currentToolCall.output += (currentToolCall.output ? '\n' : '') + outputMatch[1];
          currentToolCall.status = 'success';
          continue;
        }
        
        // Enhanced step detection
        const stepMatch = trimmed.match(/(?:\d+\.?\s*|Step\s*\d*:|-|•|→)\s*(.+)/);
        if (stepMatch) {
          if (currentStep) {
            this.steps.push(currentStep);
          }
          
          const stepText = stepMatch[1];
          currentStep = {
            type: 'thinking',
            title: this.truncateText(stepText, 80),
            description: stepText
          };
          inToolCall = false;
          continue;
        }
        
        // Detect thinking patterns
        const thinkingPatterns = [
          /^(I think|Let me|I need to|I should|I will|First|Next|Then|Finally)/i,
          /^(Analyze|Consider|Evaluate|Assess|Determine|Decide)/i,
          /^(Looking at|Based on|According to|From the)/i
        ];
        
        const isThinkingLine = thinkingPatterns.some(pattern => pattern.test(trimmed));
        
        if (isThinkingLine && !inToolCall) {
          if (currentStep && currentStep.type === 'thinking') {
            currentStep.description += ' ' + trimmed;
          } else {
            if (currentStep) {
              this.steps.push(currentStep);
            }
            currentStep = {
              type: 'thinking',
              title: this.truncateText(trimmed, 80),
              description: trimmed
            };
          }
          continue;
        }
        
        // Append to current step or tool call
        if (currentStep && !inToolCall) {
          currentStep.description += ' ' + trimmed;
        } else if (inToolCall && currentToolCall) {
          if (currentToolCall.output) {
            currentToolCall.output += ' ' + trimmed;
          } else {
            currentToolCall.input += ' ' + trimmed;
          }
        }
      }
      
      // Add the last step
      if (currentStep) {
        this.steps.push(currentStep);
      }
      
      // If no structured steps were found, create intelligent chunks
      if (this.steps.length === 0) {
        this.createIntelligentChunks(thought);
      }
      
      // Process tool calls for better display
      this.processToolCalls();
      
    } catch (error) {
      this.handleError('Thinking content parsing error', error);
      // Fallback to raw thinking
      this.steps = [{
        type: 'thinking',
        title: 'Thinking Process',
        description: thought
      }];
    }
  }

  private createIntelligentChunks(thought: string): void {
    const sentences = thought.split(/[.!?]+/).filter(s => s.trim());
    const chunkSize = 3; // sentences per chunk
    
    for (let i = 0; i < sentences.length; i += chunkSize) {
      const chunk = sentences.slice(i, i + chunkSize).join('. ').trim();
      if (chunk) {
        this.steps.push({
          type: 'thinking',
          title: this.truncateText(chunk, 80),
          description: chunk + (i + chunkSize < sentences.length ? '.' : '')
        });
      }
    }
  }

  private processToolCalls(): void {
    this.steps.forEach(step => {
      if (step.toolCall) {
        // Try to parse JSON input/output
        try {
          if (step.toolCall.input.trim().startsWith('{') || step.toolCall.input.trim().startsWith('[')) {
            JSON.parse(step.toolCall.input);
            step.toolCall.inputIsJson = true;
          }
        } catch (e) {
          // Not JSON, continue as text
        }
        
        try {
          if (step.toolCall.output.trim().startsWith('{') || step.toolCall.output.trim().startsWith('[')) {
            JSON.parse(step.toolCall.output);
            step.toolCall.outputIsJson = true;
          }
        } catch (e) {
          // Not JSON, continue as text
        }
        
        // Determine tool status
        if (step.toolCall.output && step.toolCall.output.toLowerCase().includes('error')) {
          step.toolCall.status = 'error';
        } else if (step.toolCall.output) {
          step.toolCall.status = 'success';
        } else {
          step.toolCall.status = 'running';
        }
      }
    });
  }

  private renderToolCall(toolCall: any): string {
    const inputClass = toolCall.inputIsJson ? 'json' : '';
    const outputClass = toolCall.outputIsJson ? 'json' : '';
    const statusClass = toolCall.status || 'running';
    const statusIcon = toolCall.status === 'error' ? '\u274C' : toolCall.status === 'success' ? '\u2705' : '\u23F3';
    
    return `
      <div class="tool-call-block">
        <div class="tool-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
          <div class="tool-info">
            <span class="tool-icon" aria-hidden="true">\u2699\uFE0F</span>
            <span class="tool-name">${this.escapeHtml(toolCall.name)}</span>
          </div>
          <span class="tool-status ${statusClass}">
            ${statusIcon} ${toolCall.status || 'Running'}
          </span>
        </div>
        <div class="tool-body">
          ${toolCall.input ? `
            <div class="tool-section">
              <div class="tool-label">INPUT</div>
              <div class="tool-content ${inputClass}">${this.formatToolContent(toolCall.input, toolCall.inputIsJson)}</div>
            </div>
          ` : ''}
          ${toolCall.output ? `
            <div class="tool-section">
              <div class="tool-label">OUTPUT</div>
              <div class="tool-content ${outputClass}">${this.formatToolContent(toolCall.output, toolCall.outputIsJson)}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private formatToolContent(content: string, isJson: boolean): string {
    if (isJson) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch (e) {
        return this.escapeHtml(content);
      }
    }
    return this.escapeHtml(content);
  }

  private setStreamingState(isStreaming: boolean): void {
    this.isStreaming = isStreaming;
    const container = this.shadow.getElementById('thinking-container');
    const header = this.shadow.getElementById('thinking-header');
    const progressContainer = this.shadow.getElementById('progress-container');
    const progressBar = this.shadow.getElementById('progress-bar');

    if (container) {
      if (isStreaming) {
        container.classList.add('streaming');
        container.classList.remove('error');
        progressContainer?.classList.add('active');
      } else {
        container.classList.remove('streaming');
        progressContainer?.classList.remove('active');
        progressBar.style.width = '100%';
      }
    }
    
    // Auto-expand when streaming starts
    if (isStreaming && container && !container.hasAttribute('open')) {
      container.setAttribute('open', '');
      header?.setAttribute('aria-expanded', 'true');
      localStorage.setItem('thinkExpanded', 'true');
    }
    
    // Simulate progress during streaming
    if (isStreaming) {
      this.simulateProgress();
    }
  }

  private simulateProgress(): void {
    const progressBar = this.shadow.getElementById('progress-bar');
    if (!progressBar) return;
    
    let progress = 0;
    const interval = setInterval(() => {
      if (!this.isStreaming) {
        clearInterval(interval);
        progressBar.style.width = '100%';
        setTimeout(() => {
          progressBar.style.width = '0%';
        }, 500);
        return;
      }
      
      progress += Math.random() * 10;
      if (progress > 90) progress = 90;
      progressBar.style.width = `${progress}%`;
    }, 200);
  }

  private copyThinkingProcess(): void {
    try {
      const stepsList = this.shadow.getElementById('steps-list');
      const rawThinking = this.shadow.getElementById('raw-thinking');
      const answerContent = this.shadow.getElementById('answer-content');

      // If the model did not think (no steps and no raw thinking), return only the final answer
      const noThinking = (!this.steps || this.steps.length === 0) && (!rawThinking || !rawThinking.textContent || !rawThinking.textContent.trim());
      if (noThinking && answerContent && (answerContent.textContent || '').trim()) {
        navigator.clipboard.writeText((answerContent.textContent || '').trim()).then(() => {
          this.showToast('Final answer copied to clipboard', 'success');
          this.announceToScreenReader('Final answer copied to clipboard');
        }).catch(err => {
          this.handleError('Copy failed', err);
          this.showToast('Failed to copy final answer', 'error');
        });
        return;
      }
      
      let content = 'Model Thinking Process:\n\n';
      
      // Add structured steps if available
      if (stepsList && this.steps.length > 0) {
        this.steps.forEach((step, index) => {
          content += `${index + 1}. ${step.title}\n`;
          content += `   ${step.description}\n`;
          if (step.toolCall) {
            content += `   Tool: ${step.toolCall.name}\n`;
            if (step.toolCall.input) {
              content += `   Input: ${step.toolCall.input}\n`;
            }
            if (step.toolCall.output) {
              content += `   Output: ${step.toolCall.output}\n`;
            }
          }
          content += '\n';
        });
      } else if (rawThinking) {
        // Fallback to raw thinking
        content += ((rawThinking.textContent || '') + '\n\n');
      }
      
      // Add answer if available
      if (answerContent && (answerContent.textContent || '').trim()) {
        content += 'Final Answer:\n' + (answerContent.textContent || '').trim();
      }
      
      navigator.clipboard.writeText(content).then(() => {
        this.showToast('Thinking process copied to clipboard', 'success');
        this.announceToScreenReader('Thinking process copied to clipboard');
      }).catch(err => {
        this.handleError('Copy failed', err);
        this.showToast('Failed to copy thinking process', 'error');
      });
    } catch (error) {
      this.handleError('Copy process error', error);
    }
  }

  private exportThinkingProcess(): void {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        steps: this.steps,
        rawThinking: this.shadow.getElementById('raw-thinking')?.textContent || '',
        answer: this.shadow.getElementById('answer-content')?.textContent || '',
        tokens: this.shadow.getElementById('token-count')?.textContent || '0'
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`thinking-process-\${Date.now()}.json\`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.showToast('Thinking process exported', 'success');
      this.announceToScreenReader('Thinking process exported');
    } catch (error) {
      this.handleError('Export failed', error);
      this.showToast('Failed to export thinking process', 'error');
    }
  }

  private toggleRawView(): void {
    try {
      const stepsList = this.shadow.getElementById('steps-list');
      const rawThinking = this.shadow.getElementById('raw-thinking');
      const toggleButton = this.shadow.getElementById('toggle-raw-button');
      
      if (stepsList && rawThinking) {
        const isShowingRaw = rawThinking.style.display !== 'none';
        if (isShowingRaw) {
          rawThinking.style.display = 'none';
          stepsList.style.display = 'block';
          toggleButton.textContent = '\uD83D\uDCC4 Raw';
          this.announceToScreenReader('Switched to structured view');
        } else {
          rawThinking.style.display = 'block';
          stepsList.style.display = 'none';
          toggleButton.textContent = '\uD83D\uDCCB Structured';
          this.announceToScreenReader('Switched to raw view');
        }
      }
    } catch (error) {
      this.handleError('Toggle raw view error', error);
    }
  }

  private toggleSearch(): void {
    try {
      const searchContainer = this.shadow.getElementById('search-container');
      const searchInput = this.shadow.getElementById('search-input');
      
      if (searchContainer && searchInput) {
        const isActive = searchContainer.classList.contains('active');
        if (isActive) {
          searchContainer.classList.remove('active');
          searchInput.value = '';
          this.performSearch(''); // Clear search
          this.announceToScreenReader('Search closed');
        } else {
          searchContainer.classList.add('active');
          setTimeout(() => searchInput.focus(), 100);
          this.announceToScreenReader('Search opened');
        }
      }
    } catch (error) {
      this.handleError('Toggle search error', error);
    }
  }

  private performSearch(query: string): void {
    try {
      const steps = this.shadow.querySelectorAll('.step-item');
      if (!steps) return;
      
      const lowerQuery = query.toLowerCase();
      let hasResults = false;
      
      steps.forEach(step => {
        const title = step.querySelector('.step-title')?.textContent || '';
        const description = step.querySelector('.step-description')?.textContent || '';
        
        if (lowerQuery === '' || title.toLowerCase().includes(lowerQuery) || description.toLowerCase().includes(lowerQuery)) {
          (step as HTMLElement).style.display = 'flex';
          hasResults = true;
        } else {
          (step as HTMLElement).style.display = 'none';
        }
      });
      
      // Announce search results to screen readers
      if (query) {
        const resultCount = hasResults ? 'Results found' : 'No results found';
        this.announceToScreenReader(\`\${resultCount} for "\${query}"\`);
      }
    } catch (error) {
      this.handleError('Search error', error);
    }
  }

  private toggleExpandAll(): void {
    try {
      const toolBodies = this.shadow.querySelectorAll('.tool-body');
      const toggleButton = this.shadow.getElementById('toggle-expand-button');
      
      if (!toolBodies || !toggleButton) return;
      
      const allExpanded = Array.from(toolBodies).every(body => (body as HTMLElement).style.display !== 'none');
      
      toolBodies.forEach(body => {
        (body as HTMLElement).style.display = allExpanded ? 'none' : 'block';
      });
      
      toggleButton.textContent = allExpanded ? '↕️ Expand All' : '↕️ Collapse All';
      this.announceToScreenReader(\`All tool calls \${allExpanded ? 'collapsed' : 'expanded'}\`);
      
    } catch (error) {
      this.handleError('Toggle expand all error', error);
    }
  }

  private toggleStepExpansion(stepElement: HTMLElement): void {
    try {
      const toolBody = stepElement.querySelector('.tool-body');
      if (toolBody) {
        const isExpanded = (toolBody as HTMLElement).style.display !== 'none';
        (toolBody as HTMLElement).style.display = isExpanded ? 'none' : 'block';
        this.announceToScreenReader(\`Step \${isExpanded ? 'collapsed' : 'expanded'}\`);
      }
    } catch (error) {
      this.handleError('Toggle step expansion error', error);
    }
  }

  private showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    try {
      const toast = document.createElement('div');
      toast.textContent = message;
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: \${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#374151'};
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      `;
      
      document.body.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
        }, 300);
      }, 3000);
    } catch (error) {
      this.handleError('Toast display error', error);
    }
  }

  private handleError(context: string, error: any): void {
    console.error(\`\${context}:\`, error);
    
    this.parseErrors.push({
      context,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    // Show error in UI
    const container = this.shadow.getElementById('thinking-container');
    const errorDisplay = this.shadow.getElementById('error-display');
    
    if (container) {
      container.classList.add('error');
    }
    
    if (errorDisplay) {
      errorDisplay.textContent = \`\${context}: \${error.message}\`;
      errorDisplay.classList.add('active');
      
      setTimeout(() => {
        errorDisplay.classList.remove('active');
        container?.classList.remove('error');
      }, 5000);
    }
    
    // Announce to screen readers
    this.announceToScreenReader(\`Error: \${error.message}\`);
  }

  private announceToScreenReader(message: string): void {
    const announcements = this.shadow.getElementById('accessibility-announcements');
    if (announcements) {
      announcements.textContent = message;
      setTimeout(() => {
        announcements.textContent = '';
      }, 1000);
    }
  }

  private debounce(func: Function, wait: number): Function {
    return (...args: any[]) => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => func.apply(this, args), wait);
    };
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private setAnswerContent(answer: string): void {
    try {
      const answerContent = this.shadow.getElementById('answer-content');
      // store raw answer for copy
      this.rawAnswer = answer || '';
      if (answerContent) {
        answerContent.innerHTML = '';
        
        if (answer && answer.trim()) {
          if (typeof marked !== 'undefined' && typeof (marked as any).parse === 'function') {
            const parsedContent = (marked as any).parse(answer || '');
            const answerWrapper = document.createElement('div');
            answerWrapper.className = 'answer-wrapper';
            answerWrapper.innerHTML = parsedContent;
            answerContent.appendChild(answerWrapper);
          } else {
            const answerWrapper = document.createElement('div');
            answerWrapper.className = 'answer-wrapper';
            answerWrapper.textContent = answer || '';
            answerContent.appendChild(answerWrapper);
          }
        }
      }
    } catch (error) {
      this.handleError('Answer content setting error', error);
    }
  }

  private calculateTokenCount(text: string): number {
    if (!text || typeof text !== 'string') return 0;
    const normalized = text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width chars
      .replace(/([.,!?;:()\[\]{}""''\`~@#\$%\^&*+=<>/|-])/g, ' \$1 ') // pad punctuation
      .trim();
    if (!normalized) return 0;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.length;
  }
  private copyFinalAnswer(formatted: boolean = false): void {
    try {
      const answerContent = this.shadow.getElementById('answer-content');
      const raw = (this.rawAnswer || '').trim();
      const hasAnswer = raw.length > 0 || (answerContent && (answerContent.textContent || '').trim().length > 0);
      if (!hasAnswer) {
        this.showToast('No final answer to copy', 'error');
        return;
      }
      if (!formatted) {
        const text = raw || (answerContent ? (answerContent.textContent || '').trim() : '');
        navigator.clipboard.writeText(text).then(() => {
          this.showToast('Final answer copied to clipboard', 'success');
          this.announceToScreenReader('Final answer copied to clipboard');
        }).catch(err => {
          this.handleError('Copy failed', err);
          this.showToast('Failed to copy final answer', 'error');
        });
      } else {
        const htmlContent = answerContent ? (answerContent.innerHTML || '') : '';
        const plain = raw || (answerContent ? (answerContent.textContent || '') : '');
        const ClipboardItemCtor: any = (window as any).ClipboardItem;
        if (ClipboardItemCtor) {
          navigator.clipboard.write([
            new ClipboardItemCtor({
              'text/html': new Blob([htmlContent], { type: 'text/html' }),
              'text/plain': new Blob([plain], { type: 'text/plain' })
            })
          ]).then(() => this.showToast('Copied formatted answer', 'success'))
          .catch((err: any) => {
            console.error('Failed to copy formatted answer: ', err);
            navigator.clipboard.writeText(plain).then(() => this.showToast('Copied (plain text fallback) to clipboard', 'success'))
              .catch((errFallback: any) => { console.error('Failed to copy plain text fallback: ', errFallback); this.showToast('Error copying text.', 'error'); });
          });
        } else {
          navigator.clipboard.writeText(plain).then(() => this.showToast('Final answer copied to clipboard', 'success'))
            .catch((err: any) => { console.error('Failed to copy final answer: ', err); this.showToast('Error copying text.', 'error'); });
        }
      }
    } catch (error) {
      this.handleError('Copy final answer error', error);
    }
  }
}

// ContentSegment type definition
interface ContentSegment {
  type: 'text' | 'thinking';
  content: string;
  children?: ContentSegment[];
}

// Register the enhanced thinking block
customElements.define('enhanced-thinking-block', EnhancedThinkingBlock);

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedThinkingBlock;
}