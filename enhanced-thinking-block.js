// EnhancedThinkingBlock - Enhanced thinking block with proper <thinking> tag parsing

class EnhancedThinkingBlock extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isStreaming = false;
    this.toolCalls = [];
    this.steps = [];
    this.thinkingTags = [];
    this.parseErrors = [];
    this.debounceTimer = null;
    this.virtualScrollEnabled = false;
    this.maxVisibleSteps = 50;
    this.currentSegments = [];
  }

  static get observedAttributes() {
    return ['content', 'think', 'answer', 'tokens', 'streaming'];
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.setupAccessibility();
    this.initializeVirtualScroll();
    
    // Initialize with current attributes if present
    if (this.hasAttribute('content')) {
      const parseResult = this.parseContentWithTags(this.getAttribute('content') || '');
      if (parseResult.steps.length > 0) {
        this.steps = parseResult.steps;
        this.updateThoughtContent(parseResult.steps.map(s => s.content).join('\n\n'));
      }
      if (parseResult.answerContent) {
        this.setAnswerContent(parseResult.answerContent);
      }
    } else {
      if (this.hasAttribute('think')) this.updateThoughtContent(this.getAttribute('think') || '');
      if (this.hasAttribute('answer')) this.setAnswerContent(this.getAttribute('answer') || '');
    }
    if (this.hasAttribute('streaming')) this.setStreamingState(this.getAttribute('streaming') === 'true');
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    
    try {
      switch (name) {
        case 'content':
          const parseResult = this.parseContentWithTags(newVal || '');
          if (parseResult.steps.length > 0) {
            this.steps = parseResult.steps;
            this.updateThoughtContent(parseResult.steps.map(s => s.content).join('\n\n'));
          }
          if (parseResult.answerContent) {
            this.setAnswerContent(parseResult.answerContent);
          }
          break;
        case 'think':
          this.updateThoughtContent(newVal || '');
          break;
        case 'answer':
          this.setAnswerContent(newVal || '');
          break;
        case 'tokens':
          const tokenCountElement = this.shadowRoot.getElementById('token-count');
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

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          margin: 1.5em 0;
          font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }
      </style>
      
      <link rel="stylesheet" href="enhanced-thinking-block.css">
      
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
              \u2728 Copy Formatted
            </button>
          </div>
          <div class="action-group">
            <button class="action-button" id="toggle-raw-button" title="Toggle raw view" aria-label="Toggle raw view">
              \uD83D\uDCC4 Raw
            </button>
            <button class="action-button primary" id="toggle-expand-button" title="Toggle expand all" aria-label="Toggle expand all tool calls">
              \u2195\uFE0F Expand All
            </button>
          </div>
        </div>
      </div>
      
      <!-- Hidden elements for accessibility -->
      <div class="sr-only" id="accessibility-announcements" aria-live="polite" aria-atomic="true"></div>
    `;
  }

  setupEventListeners() {
    try {
      const header = this.shadowRoot.getElementById('thinking-header');
      const container = this.shadowRoot.getElementById('thinking-container');
      const copyButton = this.shadowRoot.getElementById('copy-button');
      const copyAnswerRawButton = this.shadowRoot.getElementById('copy-answer-raw-button');
      const copyAnswerFormattedButton = this.shadowRoot.getElementById('copy-answer-formatted-button');
      const toggleRawButton = this.shadowRoot.getElementById('toggle-raw-button');
      const searchButton = this.shadowRoot.getElementById('search-button');
      const searchContainer = this.shadowRoot.getElementById('search-container');
      const searchInput = this.shadowRoot.getElementById('search-input');
      const exportButton = this.shadowRoot.getElementById('export-button');
      const toggleExpandButton = this.shadowRoot.getElementById('toggle-expand-button');
      
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

  setupAccessibility() {
    const container = this.shadowRoot.getElementById('thinking-container');
    const header = this.shadowRoot.getElementById('thinking-header');
    
    if (container && header) {
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Model thinking process');
      
      // Ensure proper ARIA attributes
      if (!header.hasAttribute('aria-expanded')) {
        header.setAttribute('aria-expanded', 'false');
      }
    }
  }

  setupKeyboardNavigation() {
    this.addEventListener('keydown', (e) => {
      const container = this.shadowRoot.getElementById('thinking-container');
      const steps = this.shadowRoot.querySelectorAll('.step-item');
      
      if (!container || !steps) return;
      
      // Handle keyboard navigation within steps
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const activeElement = this.shadowRoot.activeElement;
        if (activeElement && activeElement.classList.contains('step-item')) {
          e.preventDefault();
          const currentIndex = Array.from(steps).indexOf(activeElement);
          const nextIndex = e.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;
          
          if (nextIndex >= 0 && nextIndex < steps.length) {
            steps[nextIndex].focus();
          }
        }
      }
      
      // Handle Escape key
      if (e.key === 'Escape') {
        const searchContainer = this.shadowRoot.getElementById('search-container');
        if (searchContainer?.classList.contains('active')) {
          this.toggleSearch();
        }
      }
    });
  }

  initializeVirtualScroll() {
    const container = this.shadowRoot.getElementById('virtual-scroll-container');
    if (container) {
      container.addEventListener('scroll', this.debounce(() => {
        this.handleVirtualScroll();
      }, 100));
    }
  }

  handleVirtualScroll() {
    if (!this.virtualScrollEnabled) return;
    
    const container = this.shadowRoot.getElementById('virtual-scroll-container');
    const steps = this.shadowRoot.querySelectorAll('.step-item');
    
    if (!container || !steps) return;
    
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const stepHeight = 80; // Approximate height of each step
    
    const startIndex = Math.floor(scrollTop / stepHeight);
    const endIndex = Math.min(startIndex + Math.ceil(containerHeight / stepHeight) + 2, steps.length);
    
    // Show/hide steps based on visibility
    steps.forEach((step, index) => {
      if (index >= startIndex && index < endIndex) {
        step.style.display = 'flex';
      } else {
        step.style.display = 'none';
      }
    });
  }

  // Enhanced <thinking> tag parsing with robust error handling and validation
  parseContentWithTags(content) {
    try {
      // Input validation with enhanced checks
      if (!content || typeof content !== 'string') {
        return {
          steps: [],
          answerContent: '',
          rawContent: content || ''
        };
      }

      // Enhanced content sanitization with comprehensive XSS protection
      const sanitizedContent = this.sanitizeContent(content);

      // Enhanced regex patterns for better tag matching and malformed tag handling
      const thinkingTagRegex = this.createRobustThinkingTagRegex();
      const answerTagRegex = this.createRobustAnswerTagRegex();

      // Extract thinking content with comprehensive error handling
      let thinkingContent = '';
      let answerContent = '';
      let parseErrors = [];

      // Try multiple parsing strategies for maximum robustness
      try {
        const thinkingResult = this.extractThinkingContentRobust(sanitizedContent, thinkingTagRegex);
        thinkingContent = thinkingResult.content;
        parseErrors.push(...thinkingResult.errors);
      } catch (e) {
        console.warn('Failed to parse thinking content:', e);
        parseErrors.push(`Thinking content parsing failed: ${e.message}`);
        thinkingContent = this.extractThinkingContentFallback(sanitizedContent);
      }

      try {
        const answerResult = this.extractAnswerContentRobust(sanitizedContent, answerTagRegex);
        answerContent = answerResult.content;
        parseErrors.push(...answerResult.errors);
      } catch (e) {
        console.warn('Failed to parse answer content:', e);
        parseErrors.push(`Answer content parsing failed: ${e.message}`);
        answerContent = this.extractAnswerContentFallback(sanitizedContent, thinkingContent);
      }

      // Enhanced fallback: treat everything after thinking tags as answer
      if (!answerContent && thinkingContent) {
        const fallbackResult = this.extractAnswerFromFallback(sanitizedContent, thinkingContent);
        answerContent = fallbackResult.content;
        if (fallbackResult.usedFallback) {
          parseErrors.push('Used fallback method to extract answer content');
        }
      }

      // Validate and clean extracted content
      const validationResult = this.validateAndCleanContent(thinkingContent, answerContent);
      thinkingContent = validationResult.thinkingContent;
      answerContent = validationResult.answerContent;
      parseErrors.push(...validationResult.errors);

      // Log parsing issues for debugging if any occurred
      if (parseErrors.length > 0) {
        console.warn('Content parsing completed with warnings:', parseErrors);
      }

      // Enhanced step parsing with better error handling
      const steps = this.parseThinkingSteps(thinkingContent);

      return {
        steps,
        answerContent,
        rawContent: sanitizedContent,
        parseErrors: parseErrors.length > 0 ? parseErrors : undefined
      };
    } catch (error) {
      console.error('Content parsing failed:', error);
      // Enhanced error recovery with detailed error information
      return this.createErrorFallback(content, error);
    }
  }

  // Enhanced content sanitization with comprehensive protection
  sanitizeContent(content) {
    if (!content) return '';

    try {
      return content
        // Remove potentially dangerous HTML tags and content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT REMOVED]')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '[IFRAME REMOVED]')
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '[OBJECT REMOVED]')
        .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '[EMBED REMOVED]')
        .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '[FORM REMOVED]')
        .replace(/<input\b[^>]*>/gi, '[INPUT REMOVED]')
        .replace(/<button\b[^>]*>/gi, '[BUTTON REMOVED]')
        // Handle malformed tags by fixing common issues
        .replace(/<([^>]*$)/g, '<$1') // Fix unclosed tags
        .replace(/<\/([^>]*$)/g, '</$1') // Fix malformed closing tags
        // Normalize whitespace while preserving intentional formatting
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove excessive whitespace but preserve paragraph breaks
        .replace(/[ \t]+/g, ' ')
        .trim();
    } catch (error) {
      console.warn('Content sanitization failed:', error);
      // Fallback to basic sanitization
      return content
        .replace(/<script/gi, '[SCRIPT REMOVED]')
        .replace(/<iframe/gi, '[IFRAME REMOVED]')
        .trim();
    }
  }

  // Create robust regex for thinking tag matching with malformed tag support
  createRobustThinkingTagRegex() {
    try {
      // Enhanced regex that handles:
      // - Standard tags: <thinking>...</thinking>
      // - Alternative tags: ◁think▷...◁/think▷ and ◁think▷...◁/thinking▷
      // - Malformed tags with missing brackets or typos
      // - Nested and overlapping tags
      return /(?:(<thinking[^>]*>)([\s\S]*?)(<\/thinking[^>]*>)|◁think▷([\s\S]*?)◁\/think▷|◁think▷([\s\S]*?)◁\/thinking▷|(?<!\/)thinking(?:\s*>)|(?<!<)\/thinking(?:\s*>))/gi;
    } catch (error) {
      console.warn('Failed to create robust thinking regex:', error);
      // Fallback to simpler regex
      return /<thinking>([\s\S]*?)<\/thinking>/gi;
    }
  }

  // Create robust regex for answer tag matching
  createRobustAnswerTagRegex() {
    try {
      // Enhanced regex that handles:
      // - Standard tags: <answer>...</answer>
      // - Malformed tags with missing brackets
      // - Case variations
      return /(<answer[^>]*>)([\s\S]*?)(<\/answer[^>]*>)|(?<!\/)answer(?:\s*>)|(?<!<)\/answer(?:\s*>)/gi;
    } catch (error) {
      console.warn('Failed to create robust answer regex:', error);
      // Fallback to simpler regex
      return /<answer>([\s\S]*?)<\/answer>/gi;
    }
  }

  // Robust thinking content extraction with multiple strategies
  extractThinkingContentRobust(content, regex) {
    const errors = [];

    try {
      const matches = [];
      let match;

      // Reset regex lastIndex to ensure proper matching
      regex.lastIndex = 0;

      while ((match = regex.exec(content)) !== null) {
        matches.push(match);
      }

      if (matches.length === 0) {
        return { content: '', errors: ['No thinking tags found'] };
      }

      // Try to extract content from different tag formats
      for (const currentMatch of matches) {
        try {
          // Standard format: <thinking>content</thinking>
          if (currentMatch[1] && currentMatch[3] && currentMatch[2]) {
            return {
              content: currentMatch[2].trim(),
              errors: []
            };
          }

          // Alternative format 1: ◁think▷content◁/think▷
          if (currentMatch[4]) {
            return {
              content: currentMatch[4].trim(),
              errors: []
            };
          }

          // Alternative format 2: ◁think▷content◁/thinking▷
          if (currentMatch[5]) {
            return {
              content: currentMatch[5].trim(),
              errors: []
            };
          }

          // Handle malformed tags by attempting to extract content anyway
          if (currentMatch[0] && currentMatch.index >= 0) {
            const tagContent = currentMatch[0]
              .replace(/^<thinking[^>]*>/i, '')
              .replace(/<\/thinking[^>]*>$/i, '')
              .replace(/^◁think▷/, '')
              .replace(/◁\/think▷$/i, '')
              .replace(/◁\/thinking▷$/i, '')
              .trim();

            if (tagContent) {
              errors.push('Used fallback extraction for malformed thinking tag');
              return {
                content: tagContent,
                errors
              };
            }
          }
        } catch (e) {
          errors.push(`Error processing thinking match: ${e.message}`);
        }
      }

      return { content: '', errors: ['No valid thinking content found'] };
    } catch (error) {
      return {
        content: '',
        errors: [`Thinking content extraction failed: ${error.message}`]
      };
    }
  }

  // Fallback thinking content extraction for when regex fails
  extractThinkingContentFallback(content) {
    try {
      // Try to find content between common thinking tag patterns
      const patterns = [
        /<thinking[^>]*>([\s\S]*?)(?:<\/thinking>|$)/i,
        /◁think▷([\s\S]*?)(?:◁\/think▷|◁\/thinking▷|$)/i,
        /(?:thinking:|think:|💭|🤔)\s*([\s\S]*?)(?=\n\s*(?:answer:|final|conclusion|$))/i
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match && match[1] && match[1].trim()) {
          return match[1].trim();
        }
      }

      // If no patterns match, return empty
      return '';
    } catch (error) {
      console.warn('Fallback thinking extraction failed:', error);
      return '';
    }
  }

  // Robust answer content extraction
  extractAnswerContentRobust(content, regex) {
    const errors = [];

    try {
      const matches = [];
      let match;

      // Reset regex lastIndex
      regex.lastIndex = 0;

      while ((match = regex.exec(content)) !== null) {
        matches.push(match);
      }

      if (matches.length === 0) {
        return { content: '', errors: ['No answer tags found'] };
      }

      // Try to extract content from answer tags
      for (const currentMatch of matches) {
        try {
          // Standard format: <answer>content</answer>
          if (currentMatch[1] && currentMatch[3] && currentMatch[2]) {
            return {
              content: currentMatch[2].trim(),
              errors: []
            };
          }

          // Handle malformed tags
          if (currentMatch[0] && currentMatch.index >= 0) {
            const tagContent = currentMatch[0]
              .replace(/^<answer[^>]*>/i, '')
              .replace(/<\/answer[^>]*>$/i, '')
              .trim();

            if (tagContent) {
              errors.push('Used fallback extraction for malformed answer tag');
              return {
                content: tagContent,
                errors
              };
            }
          }
        } catch (e) {
          errors.push(`Error processing answer match: ${e.message}`);
        }
      }

      return { content: '', errors: ['No valid answer content found'] };
    } catch (error) {
      return {
        content: '',
        errors: [`Answer content extraction failed: ${error.message}`]
      };
    }
  }

  // Fallback answer content extraction
  extractAnswerContentFallback(content, thinkingContent) {
    try {
      if (!thinkingContent) {
        // If no thinking content, the entire content might be the answer
        return content.trim();
      }

      // Remove thinking content and find what remains
      const thinkingPatterns = [
        /<thinking[^>]*>[\s\S]*?<\/thinking[^>]*>/gi,
        /◁think▷[\s\S]*?◁\/think▷/gi,
        /◁think▷[\s\S]*?◁\/thinking▷/gi
      ];

      let cleanedContent = content;
      for (const pattern of thinkingPatterns) {
        cleanedContent = cleanedContent.replace(pattern, '');
      }

      return cleanedContent.trim();
    } catch (error) {
      console.warn('Fallback answer extraction failed:', error);
      return '';
    }
  }

  // Enhanced fallback answer extraction from after thinking tags
  extractAnswerFromFallback(content, thinkingContent) {
    try {
      const result = { content: '', usedFallback: false };

      if (!content || !thinkingContent) {
        return result;
      }

      // Find the last closing thinking tag
      const closeTagPatterns = [
        { pattern: /<\/thinking>/gi, offset: 11 },
        { pattern: /◁\/think▷/gi, offset: 8 },
        { pattern: /◁\/thinking▷/gi, offset: 10 }
      ];

      let lastClosePos = -1;
      let usedPattern = null;

      for (const { pattern, offset } of closeTagPatterns) {
        pattern.lastIndex = 0;
        let match;
        let lastMatchPos = -1;

        while ((match = pattern.exec(content)) !== null) {
          lastMatchPos = match.index;
        }

        if (lastMatchPos > lastClosePos) {
          lastClosePos = lastMatchPos;
          usedPattern = { pattern, offset };
        }
      }

      if (lastClosePos !== -1 && usedPattern) {
        const afterThinking = content.substring(lastClosePos + usedPattern.offset).trim();
        if (afterThinking) {
          result.content = afterThinking;
          result.usedFallback = true;
        }
      }

      return result;
    } catch (error) {
      console.warn('Answer fallback extraction failed:', error);
      return { content: '', usedFallback: false };
    }
  }

  // Validate and clean extracted content
  validateAndCleanContent(thinkingContent, answerContent) {
    const errors = [];
    const result = {
      thinkingContent: thinkingContent || '',
      answerContent: answerContent || '',
      errors
    };

    try {
      // Validate thinking content
      if (thinkingContent) {
        // Check for reasonable length limits
        if (thinkingContent.length > 100000) { // 100KB limit
          errors.push('Thinking content exceeds maximum length');
          result.thinkingContent = thinkingContent.substring(0, 100000) + '... [truncated]';
        }

        // Remove excessive repeated characters that might indicate parsing issues
        result.thinkingContent = result.thinkingContent
          .replace(/(.)\1{100,}/g, '$1$1$1... [repeated characters removed]')
          .trim();
      }

      // Validate answer content
      if (answerContent) {
        // Check for reasonable length limits
        if (answerContent.length > 500000) { // 500KB limit
          errors.push('Answer content exceeds maximum length');
          result.answerContent = answerContent.substring(0, 500000) + '... [truncated]';
        }
      }

      return result;
    } catch (error) {
      errors.push(`Content validation failed: ${error.message}`);
      return result;
    }
  }

  // Enhanced error fallback with detailed error information
  createErrorFallback(content, error) {
    const errorMessage = error.message || 'Unknown parsing error';

    return {
      steps: [{
        id: 'error-step',
        content: `Content parsing failed: ${errorMessage}. Raw content displayed below.`,
        type: 'error'
      }],
      answerContent: '',
      rawContent: content || '',
      parseErrors: [`Critical parsing error: ${errorMessage}`]
    };
  }
  
  // Helper function to format nested thinking blocks for display
  formatNestedThinking(segment, depth = 0) {
    let content = '';
    
    // Add current thinking content
    if (segment.content) {
      content += segment.content;
    }
    
    // Add nested children if they exist
    if (segment.children && segment.children.length > 0) {
      content += '\n' + '  '.repeat(depth) + 'Children:\n';
      segment.children.forEach(child => {
        if (child.type === 'thinking') {
          content += '  '.repeat(depth + 1) + '[Nested Thinking]: ' + this.formatNestedThinking(child, depth + 1) + '\n';
        } else {
          content += '  '.repeat(depth + 1) + child.content + '\n';
        }
      });
    }
    
    return content;
  }
  
  // Enhanced stack-based parser for nested thinking tags with robust error handling
  parseNestedThinking(content) {
    if (!content) return [];

    const segments = [];
    const stack = [];
    const errors = [];
    let currentText = '';
    let i = 0;
    let lastErrorPos = -1;

    try {
      while (i < content.length) {
        // Enhanced tag detection with multiple formats and malformed tag handling
        const tagMatches = this.findNextThinkingTag(content, i);

        if (tagMatches.length === 0) {
          // No more tags found, add remaining content
          const remainingContent = content.substring(i);
          if (remainingContent.trim()) {
            this.addTextSegment(segments, stack, currentText + remainingContent, errors);
          }
          break;
        }

        // Find the earliest valid tag
        let nextTag = null;
        let nextTagPos = content.length;

        for (const match of tagMatches) {
          if (match.position >= i && match.position < nextTagPos) {
            nextTag = match;
            nextTagPos = match.position;
          }
        }

        if (!nextTag || nextTagPos >= content.length) {
          // No valid tag found, add remaining content
          const remainingContent = content.substring(i);
          if (remainingContent.trim()) {
            this.addTextSegment(segments, stack, currentText + remainingContent, errors);
          }
          break;
        }

        // Add content before the tag
        const contentBeforeTag = content.substring(i, nextTagPos);
        if (contentBeforeTag.trim()) {
          this.addTextSegment(segments, stack, currentText + contentBeforeTag, errors);
          currentText = '';
        }

        // Process the tag
        if (nextTag.isStartTag) {
          const result = this.processStartTag(stack, segments, nextTag, errors);
          if (result.shouldContinue) {
            i = nextTagPos + nextTag.length;
            continue;
          } else {
            // Error occurred, skip this tag
            i = nextTagPos + nextTag.length;
            continue;
          }
        } else {
          const result = this.processEndTag(stack, segments, nextTag, errors);
          if (result.shouldContinue) {
            i = nextTagPos + nextTag.length;
            continue;
          } else {
            // Error occurred, treat as text
            currentText += nextTag.fullMatch;
            i = nextTagPos + nextTag.length;
            continue;
          }
        }
      }

      // Handle any remaining text
      if (currentText.trim()) {
        this.addTextSegment(segments, stack, currentText, errors);
      }

      // Handle any unclosed tags with enhanced recovery
      if (stack.length > 0) {
        const recoveryResult = this.recoverFromUnclosedTags(stack, segments, errors);
        segments.push(...recoveryResult.segments);
        errors.push(...recoveryResult.errors);
      }

      // Log errors if any occurred
      if (errors.length > 0 && i - lastErrorPos > 100) {
        console.warn('Nested thinking parsing completed with warnings:', errors);
        lastErrorPos = i;
      }

      return segments;

    } catch (error) {
      errors.push(`Nested thinking parsing failed: ${error.message}`);
      console.error('Nested thinking parsing error:', error);

      // Return basic fallback parsing
      return this.parseNestedThinkingFallback(content, errors);
    }
  }

  // Enhanced tag detection with support for multiple formats and malformed tags
  findNextThinkingTag(content, startPos) {
    const tagPatterns = [
      // Standard tags
      { pattern: /<thinking>/gi, isStartTag: true, length: 10, type: 'standard-start' },
      { pattern: /<\/thinking>/gi, isStartTag: false, length: 11, type: 'standard-end' },

      // Alternative tags
      { pattern: /◁think▷/gi, isStartTag: true, length: 7, type: 'alt-start' },
      { pattern: /◁\/think▷/gi, isStartTag: false, length: 8, type: 'alt-end' },
      { pattern: /◁\/thinking▷/gi, isStartTag: false, length: 10, type: 'alt-end-variant' },

      // Malformed tags (missing brackets, typos)
      { pattern: /thinking(?:\s*>|$)/gi, isStartTag: true, length: 8, type: 'malformed-start' },
      { pattern: /\/thinking(?:\s*>|$)/gi, isStartTag: false, length: 9, type: 'malformed-end' },
      { pattern: /<thinking/gi, isStartTag: true, length: 9, type: 'incomplete-start' },
      { pattern: /<\/thinking/gi, isStartTag: false, length: 10, type: 'incomplete-end' }
    ];

    const matches = [];

    for (const tagPattern of tagPatterns) {
      try {
        tagPattern.pattern.lastIndex = startPos;
        const match = tagPattern.pattern.exec(content);

        if (match && match.index >= startPos) {
          matches.push({
            position: match.index,
            fullMatch: match[0],
            isStartTag: tagPattern.isStartTag,
            length: tagPattern.length,
            type: tagPattern.type,
            pattern: tagPattern.pattern
          });
        }
      } catch (error) {
        // Skip malformed patterns
        continue;
      }
    }

    return matches;
  }

  // Process start tag with enhanced error handling
  processStartTag(stack, segments, tag, errors) {
    try {
      // Validate stack depth to prevent infinite nesting
      if (stack.length >= 50) {
        errors.push('Maximum nesting depth exceeded, treating as text');
        return { shouldContinue: false };
      }

      // Create new thinking container
      const newContainer = {
        type: 'thinking',
        content: '',
        children: [],
        startPos: tag.position,
        tagType: tag.type
      };

      stack.push(newContainer);
      return { shouldContinue: true };
    } catch (error) {
      errors.push(`Error processing start tag: ${error.message}`);
      return { shouldContinue: false };
    }
  }

  // Process end tag with enhanced error handling
  processEndTag(stack, segments, tag, errors) {
    try {
      if (stack.length === 0) {
        // Unmatched closing tag
        errors.push('Unmatched closing tag found, treating as text');
        return { shouldContinue: false };
      }

      const top = stack.pop();

      if (stack.length > 0) {
        // Add as child to parent
        stack[stack.length - 1].children.push({
          type: 'thinking',
          content: top.content,
          children: top.children,
          tagType: top.tagType
        });
      } else {
        // Add to main segments
        segments.push({
          type: 'thinking',
          content: top.content,
          children: top.children,
          tagType: top.tagType
        });
      }

      return { shouldContinue: true };
    } catch (error) {
      errors.push(`Error processing end tag: ${error.message}`);
      return { shouldContinue: false };
    }
  }

  // Enhanced text segment handling
  addTextSegment(segments, stack, text, errors) {
    if (!text.trim()) return;

    try {
      if (stack.length > 0) {
        // Add to current thinking container
        stack[stack.length - 1].content += text;
      } else {
        // Add as standalone text segment
        segments.push({
          type: 'text',
          content: text.trim()
        });
      }
    } catch (error) {
      errors.push(`Error adding text segment: ${error.message}`);
    }
  }

  // Enhanced recovery from unclosed tags
  recoverFromUnclosedTags(stack, segments, errors) {
    const recoverySegments = [];
    const recoveryErrors = [];

    try {
      console.warn(`Recovering from ${stack.length} unclosed thinking tags`);

      // Try to salvage content from unclosed tags
      while (stack.length > 0) {
        const unclosedTag = stack.pop();

        if (unclosedTag.content && unclosedTag.content.trim()) {
          recoverySegments.push({
            type: 'text',
            content: `[Unclosed thinking tag content]: ${unclosedTag.content.trim()}`
          });
          recoveryErrors.push(`Recovered content from unclosed ${unclosedTag.tagType} tag`);
        }
      }

      return {
        segments: recoverySegments,
        errors: recoveryErrors
      };
    } catch (error) {
      return {
        segments: [],
        errors: [`Recovery from unclosed tags failed: ${error.message}`]
      };
    }
  }

  // Fallback parsing for when main parser fails
  parseNestedThinkingFallback(content, errors) {
    try {
      // Simple pattern-based extraction as last resort
      const patterns = [
        /<thinking[^>]*>([\s\S]*?)(?:<\/thinking>|$)/gi,
        /◁think▷([\s\S]*?)(?:◁\/think▷|◁\/thinking▷|$)/gi
      ];

      const segments = [];

      for (const pattern of patterns) {
        let match;
        pattern.lastIndex = 0;

        while ((match = pattern.exec(content)) !== null) {
          if (match[1] && match[1].trim()) {
            segments.push({
              type: 'thinking',
              content: match[1].trim()
            });
          }
        }
      }

      if (segments.length === 0) {
        // If no structured content found, return everything as text
        if (content.trim()) {
          segments.push({
            type: 'text',
            content: content.trim()
          });
        }
      }

      return segments;
    } catch (error) {
      errors.push(`Fallback parsing failed: ${error.message}`);
      return [{
        type: 'text',
        content: content || ''
      }];
    }
  }

  // Enhanced step parsing method with robust error handling and malformed content support
  parseThinkingSteps(thinkingContent) {
    if (!thinkingContent || typeof thinkingContent !== 'string') {
      return [];
    }

    const errors = [];
    let steps = [];

    try {
      // Enhanced step patterns with malformed content support
      const stepPatterns = [
        {
          // Standard numbered steps: "1. Content", "2) Content", etc.
          pattern: /^\s*\d+[\.\)]\s*(.+)$/gm,
          extract: (match) => match[1]?.trim(),
          type: 'numbered'
        },
        {
          // Bullet points: "- Content", "* Content", "• Content"
          pattern: /^\s*[-*•]\s*(.+)$/gm,
          extract: (match) => match[1]?.trim(),
          type: 'bullet'
        },
        {
          // Step labels: "Step 1:", "Step:", "Next:", etc.
          pattern: /^\s*(?:Step|Next|Then|First|Second|Third|Finally)[\s\d]*:\s*(.+)$/gmi,
          extract: (match) => match[1]?.trim(),
          type: 'labeled'
        },
        {
          // Thinking indicators: "I think", "Let me", "I need to", etc.
          pattern: /^\s*(?:I think|Let me|I need to|I should|I will|Consider|Analyze|Looking at)[:,\s]*(.+)$/gmi,
          extract: (match) => match[1]?.trim(),
          type: 'thinking'
        },
        {
          // Tool usage patterns
          pattern: /^\s*(?:Using tool|Calling|Execute|Tool)[:,\s]*([^\n]+)$/gmi,
          extract: (match) => match[1]?.trim(),
          type: 'tool'
        }
      ];

      // Try each pattern with error handling
      for (const stepPattern of stepPatterns) {
        try {
          const matches = [...thinkingContent.matchAll(stepPattern.pattern)];
          if (matches.length > 0) {
            steps = matches
              .map((match, index) => {
                try {
                  const content = stepPattern.extract(match);
                  if (content && this.isValidStepContent(content)) {
                    return {
                      id: `step-${Date.now()}-${index}`,
                      content: this.sanitizeStepContent(content),
                      type: 'thinking',
                      pattern: stepPattern.type,
                      rawMatch: match[0]
                    };
                  }
                } catch (error) {
                  errors.push(`Error processing step match: ${error.message}`);
                }
                return null;
              })
              .filter(Boolean);

            if (steps.length > 0) {
              break; // Use first successful pattern
            }
          }
        } catch (error) {
          errors.push(`Error with pattern ${stepPattern.type}: ${error.message}`);
          continue;
        }
      }

      // Enhanced paragraph-based parsing if no structured steps found
      if (steps.length === 0) {
        steps = this.parseStepsFromParagraphs(thinkingContent, errors);
      }

      // Enhanced post-processing for malformed content recovery
      if (steps.length === 0) {
        steps = this.parseStepsWithAdvancedRecovery(thinkingContent, errors);
      }

      // Validate and clean all steps
      steps = steps.map((step, index) => ({
        ...step,
        id: step.id || `recovered-step-${index}`,
        content: this.validateAndRepairStepContent(step.content, errors),
        type: step.type || 'thinking'
      }));

      // Remove duplicate or very similar steps
      steps = this.deduplicateSteps(steps, errors);

      // Log parsing results if there were issues
      if (errors.length > 0) {
        console.warn(`Step parsing completed with ${errors.length} warnings:`, errors.slice(0, 5));
      }

      return steps;

    } catch (error) {
      errors.push(`Critical step parsing error: ${error.message}`);
      console.error('Step parsing failed:', error);

      // Enhanced fallback with content preservation
      return this.createStepParsingFallback(thinkingContent, errors);
    }
  }

  // Validate if content is suitable for a step
  isValidStepContent(content) {
    if (!content || typeof content !== 'string') return false;

    // Must have minimum length but not be too long for a single step
    const length = content.length;
    if (length < 3 || length > 10000) return false;

    // Must contain actual content (not just punctuation or whitespace)
    const trimmed = content.trim();
    if (!trimmed || /^[^\w]*$/.test(trimmed)) return false;

    // Check for reasonable word count (not just one word, not extremely long)
    const words = trimmed.split(/\s+/).length;
    if (words < 2 || words > 500) return false;

    return true;
  }

  // Parse steps from paragraphs with enhanced logic
  parseStepsFromParagraphs(content, errors) {
    try {
      const steps = [];

      // Split by various paragraph separators
      const paragraphs = content
        .split(/\n\s*\n|\r\n\s*\r\n|\r\s*\r/)
        .map(p => p.trim())
        .filter(p => p && this.isValidStepContent(p));

      if (paragraphs.length === 0) {
        return steps;
      }

      // Group related paragraphs into logical steps
      let currentStep = '';
      let stepIndex = 0;

      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];

        // Check if this paragraph should start a new step
        const shouldStartNewStep = this.shouldStartNewStep(paragraph, currentStep);

        if (shouldStartNewStep && currentStep.trim()) {
          // Save current step
          steps.push({
            id: `paragraph-step-${stepIndex++}`,
            content: this.sanitizeStepContent(currentStep.trim()),
            type: 'thinking',
            pattern: 'paragraph'
          });
          currentStep = '';
        }

        // Add current paragraph to step
        if (currentStep) {
          currentStep += '\n\n' + paragraph;
        } else {
          currentStep = paragraph;
        }
      }

      // Add final step
      if (currentStep.trim()) {
        steps.push({
          id: `paragraph-step-${stepIndex}`,
          content: this.sanitizeStepContent(currentStep.trim()),
          type: 'thinking',
          pattern: 'paragraph'
        });
      }

      return steps;
    } catch (error) {
      errors.push(`Paragraph parsing failed: ${error.message}`);
      return [];
    }
  }

  // Determine if a paragraph should start a new step
  shouldStartNewStep(paragraph, currentStep) {
    // Don't split if current step is empty
    if (!currentStep.trim()) return false;

    // Check for step transition indicators
    const transitionIndicators = [
      /^\d+[\.\)]\s/i,           // Numbered steps
      /^[-*•]\s/i,               // Bullet points
      /^(Step|Next|Then|First|Second|Third|Finally)/i, // Step labels
      /^(I think|Let me|I need to|I should|I will)/i,  // Thinking indicators
      /^(Using tool|Calling|Execute)/i // Tool usage
    ];

    return transitionIndicators.some(indicator => indicator.test(paragraph));
  }

  // Advanced recovery for severely malformed content
  parseStepsWithAdvancedRecovery(content, errors) {
    try {
      const steps = [];
      let stepIndex = 0;

      // Try sentence-based parsing for very dense content
      const sentences = content.split(/[.!?]+/).filter(s => s.trim());
      const sentenceGroups = [];

      // Group sentences into logical chunks
      for (let i = 0; i < sentences.length; i += 2) {
        const chunk = sentences.slice(i, i + 2).join('. ').trim();
        if (chunk && this.isValidStepContent(chunk)) {
          sentenceGroups.push(chunk);
        }
      }

      // Convert chunks to steps
      for (const chunk of sentenceGroups) {
        steps.push({
          id: `recovered-step-${stepIndex++}`,
          content: this.sanitizeStepContent(chunk),
          type: 'thinking',
          pattern: 'recovered'
        });
      }

      return steps;
    } catch (error) {
      errors.push(`Advanced recovery parsing failed: ${error.message}`);
      return [];
    }
  }

  // Validate and repair step content
  validateAndRepairStepContent(content, errors) {
    if (!content) return '';

    try {
      let repaired = content;

      // Fix common issues
      repaired = repaired
        // Fix excessive whitespace
        .replace(/\s+/g, ' ')
        // Fix broken quotes
        .replace(/(["'])(\s*)\1/g, '$1$2$1')
        // Fix common typos in step indicators
        .replace(/\bteh\b/gi, 'the')
        .replace(/\btaht\b/gi, 'that')
        .replace(/\badn\b/gi, 'and');

      // Truncate extremely long steps with warning
      if (repaired.length > 5000) {
        errors.push('Step content truncated due to excessive length');
        repaired = repaired.substring(0, 5000) + '... [truncated]';
      }

      return this.sanitizeStepContent(repaired);
    } catch (error) {
      errors.push(`Content repair failed: ${error.message}`);
      return this.sanitizeStepContent(content);
    }
  }

  // Remove duplicate or very similar steps
  deduplicateSteps(steps, errors) {
    if (steps.length <= 1) return steps;

    try {
      const uniqueSteps = [];
      const seen = new Set();

      for (const step of steps) {
        if (!step.content) continue;

        // Create a normalized signature for comparison
        const signature = this.createStepSignature(step.content);

        if (!seen.has(signature)) {
          seen.add(signature);
          uniqueSteps.push(step);
        } else {
          errors.push('Duplicate step removed');
        }
      }

      return uniqueSteps;
    } catch (error) {
      errors.push(`Deduplication failed: ${error.message}`);
      return steps;
    }
  }

  // Create a normalized signature for step comparison
  createStepSignature(content) {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim()
      .substring(0, 100); // First 100 chars for comparison
  }

  // Enhanced fallback for when all parsing methods fail
  createStepParsingFallback(content, errors) {
    try {
      if (!content || !content.trim()) {
        return [];
      }

      // As a last resort, create a single step with the entire content
      const fallbackStep = {
        id: `fallback-step-${Date.now()}`,
        content: this.sanitizeStepContent(content.trim()),
        type: 'thinking',
        pattern: 'fallback'
      };

      errors.push('Used fallback parsing - all structured parsing methods failed');
      return [fallbackStep];

    } catch (error) {
      errors.push(`Fallback creation failed: ${error.message}`);
      return [{
        id: 'error-fallback',
        content: 'Content parsing failed completely',
        type: 'error'
      }];
    }
  }

  // Add content sanitization method
  sanitizeStepContent(content) {
    if (!content) return '';

    return content
      // Remove potentially dangerous HTML
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      // Limit length to prevent excessive content
      .substring(0, 5000)
      .trim();
  }

  updateThoughtContent(thought) {
    try {
      const tokenCountElement = this.shadowRoot.getElementById('token-count');
      const stepsList = this.shadowRoot.getElementById('steps-list');
      const rawThinking = this.shadowRoot.getElementById('raw-thinking');

      // Update token count with debouncing
      if (tokenCountElement) {
        this.debounce(() => {
          const tokenCount = this.calculateTokenCount(thought || '');
          tokenCountElement.textContent = String(tokenCount);
        }, 200)();
      }

      // Parse thinking content into structured steps
      this.parseThinkingContent(thought || '');

      // Update steps list with optimized rendering for streaming
      if (stepsList) {
        if (this.isStreaming) {
          // For streaming: use RAF directly and throttle updates for very fast streams
          requestAnimationFrame(() => {
            this.renderStepsList();
          });
        } else {
          // For non-streaming: use debounce to prevent excessive updates
          this.debounce(() => {
            requestAnimationFrame(() => {
              this.renderStepsList();
            });
          }, 500)();
        }
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
  
  // Performance-optimized rendering using DocumentFragment and virtualization
  renderStepsList() {
    const stepsList = this.shadowRoot.getElementById('steps-list');
    if (!stepsList) return;

    // Use requestAnimationFrame for streaming updates
    if (this.isStreaming) {
      requestAnimationFrame(() => {
        // During streaming, disable animations and only append new steps instead of rebuilding everything
        if (stepsList.children.length > 0) {
          const existingCount = stepsList.children.length;
          const newSteps = this.steps.slice(existingCount);

          // Only add new steps to avoid flashing
          if (newSteps.length > 0) {
            this.renderStreamingSteps(stepsList, newSteps, existingCount);
          }
          return;
        }

        // Clear existing content only when not streaming or for initial render
        stepsList.innerHTML = '';

        // Disable animations during streaming for all steps
        stepsList.style.setProperty('--animation-duration', '0s');

        // Use DocumentFragment for efficient DOM operations
        const fragment = document.createDocumentFragment();

        // Render only visible steps if virtual scrolling is enabled
        const stepsToRender = this.virtualScrollEnabled
          ? this.steps.slice(0, this.maxVisibleSteps)
          : this.steps;

        // Batch DOM operations using DocumentFragment
        stepsToRender.forEach((step, index) => {
          const li = this.createStepElement(step, index, true);
          fragment.appendChild(li);
        });

        stepsList.appendChild(fragment);

        // Handle virtual scroll if enabled
        if (this.virtualScrollEnabled) {
          this.handleVirtualScroll();
        }
      });
    } else {
      // Non-streaming: Use standard RAF scheduling
      requestAnimationFrame(() => {
        // Clear existing content only when not streaming
        stepsList.innerHTML = '';

        // Use DocumentFragment for efficient DOM operations
        const fragment = document.createDocumentFragment();

        // Render only visible steps if virtual scrolling is enabled
        const stepsToRender = this.virtualScrollEnabled
          ? this.steps.slice(0, this.maxVisibleSteps)
          : this.steps;

        // Batch DOM operations using DocumentFragment
        stepsToRender.forEach((step, index) => {
          const li = this.createStepElement(step, index, false);
          fragment.appendChild(li);
        });

        stepsList.appendChild(fragment);

        // Handle virtual scroll if enabled
        if (this.virtualScrollEnabled) {
          this.handleVirtualScroll();
        }
      });
    }
  }

  // Optimized streaming step rendering with RAF batching and scroll preservation
  renderStreamingSteps(stepsList, newSteps, existingCount) {
    if (this.isStreaming) {
      // Use requestAnimationFrame for streaming updates
      requestAnimationFrame(() => {
        // First batch: Read all DOM properties to avoid reflows during reads
        const existingSteps = Array.from(stepsList.children);
        const stepCount = existingSteps.length;
        const containerRect = stepsList.getBoundingClientRect();
        const scrollTop = stepsList.scrollTop;
        const preserveScroll = stepsList.scrollHeight - scrollTop < containerRect.height + 100;

        // Second batch: Write all DOM changes using optimized DocumentFragment
        if (newSteps.length > 0) {
          requestAnimationFrame(() => {
            // Use DocumentFragment for batch insertion to minimize reflows
            const fragment = document.createDocumentFragment();

            // Create and add all new elements to fragment before DOM insertion
            newSteps.forEach((step, index) => {
              const li = this.createStepElement(step, existingCount + index, true);
              fragment.appendChild(li);
            });

            // Single DOM insertion for optimal performance
            stepsList.appendChild(fragment);

            // Restore scroll position if needed to maintain user context
            if (preserveScroll) {
              requestAnimationFrame(() => {
                stepsList.scrollTop = scrollTop;
              });
            }
          });
        }
      });
    }
  }
  
  // Memoized step element creation
  createStepElement(step, index, isStreaming = false) {
    const li = document.createElement('li');
    li.className = 'step-item';
    li.setAttribute('role', 'listitem');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', `${step.title}: ${step.description}`);

    // During streaming, disable animations to prevent flashing
    if (isStreaming) {
      li.style.animation = 'none';
      li.style.opacity = '1';
      li.style.transform = 'none';
    }
    
    li.innerHTML = `
      <div class="step-icon ${step.type}" aria-hidden="true">
        ${step.type === 'thinking' ? '🤔' : step.type === 'tool' ? '⚙️' : step.type === 'result' ? '✓' : '❌'}
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
    
    return li;
  }


  parseThinkingContent(thought) {
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

  createIntelligentChunks(thought) {
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

  processToolCalls() {
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

  renderToolCall(toolCall) {
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

  formatToolContent(content, isJson) {
    if (isJson) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch (e) {
        return this.escapeHtml(content);
      }
    }
    return this.escapeHtml(content);
  }

  setStreamingState(isStreaming) {
    this.isStreaming = isStreaming;
    const container = this.shadowRoot.getElementById('thinking-container');
    const header = this.shadowRoot.getElementById('thinking-header');
    const progressContainer = this.shadowRoot.getElementById('progress-container');
    const progressBar = this.shadowRoot.getElementById('progress-bar');

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

  simulateProgress() {
    const progressBar = this.shadowRoot.getElementById('progress-bar');
    if (!progressBar) return;

    let progress = 0;
    const interval = setInterval(() => {
      if (!this.isStreaming) {
        clearInterval(interval);
        // Ensure progress bar shows completion before hiding
        progressBar.style.width = '100%';
        setTimeout(() => {
          if (progressBar) { // Check if element still exists
            progressBar.style.width = '0%';
          }
        }, 500);
        return;
      }

      progress += Math.random() * 10;
      if (progress > 90) progress = 90;
      progressBar.style.width = `${progress}%`;
    }, 200);
  }

  copyThinkingProcess() {
    try {
      const stepsList = this.shadowRoot.getElementById('steps-list');
      const rawThinking = this.shadowRoot.getElementById('raw-thinking');
      const answerContent = this.shadowRoot.getElementById('answer-content');
      
      // If the model did not think (no steps and no raw thinking), return only the final answer
      const noThinking = (!this.steps || this.steps.length === 0) && (!rawThinking || !rawThinking.textContent || !rawThinking.textContent.trim());
      if (noThinking && answerContent && answerContent.textContent.trim()) {
        navigator.clipboard.writeText(answerContent.textContent.trim()).then(() => {
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
        content += (rawThinking.textContent || '') + '\n\n';
      }
      
      // Add answer if available
      if (answerContent && answerContent.textContent.trim()) {
        content += 'Final Answer:\n' + answerContent.textContent.trim();
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

  exportThinkingProcess() {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        steps: this.steps,
        rawThinking: this.shadowRoot.getElementById('raw-thinking')?.textContent || '',
        answer: this.shadowRoot.getElementById('answer-content')?.textContent || '',
        tokens: this.shadowRoot.getElementById('token-count')?.textContent || '0'
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `thinking-process-${Date.now()}.json`;
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

  toggleRawView() {
    try {
      const stepsList = this.shadowRoot.getElementById('steps-list');
      const rawThinking = this.shadowRoot.getElementById('raw-thinking');
      const toggleButton = this.shadowRoot.getElementById('toggle-raw-button');
      
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

  toggleSearch() {
    try {
      const searchContainer = this.shadowRoot.getElementById('search-container');
      const searchInput = this.shadowRoot.getElementById('search-input');
      
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

  performSearch(query) {
    try {
      const steps = this.shadowRoot.querySelectorAll('.step-item');
      if (!steps) return;
      
      const lowerQuery = query.toLowerCase();
      let hasResults = false;
      
      steps.forEach(step => {
        const title = step.querySelector('.step-title')?.textContent || '';
        const description = step.querySelector('.step-description')?.textContent || '';
        
        if (lowerQuery === '' || title.toLowerCase().includes(lowerQuery) || description.toLowerCase().includes(lowerQuery)) {
          step.style.display = 'flex';
          hasResults = true;
        } else {
          step.style.display = 'none';
        }
      });
      
      // Announce search results to screen readers
      if (query) {
        const resultCount = hasResults ? 'Results found' : 'No results found';
        this.announceToScreenReader(`${resultCount} for "${query}"`);
      }
    } catch (error) {
      this.handleError('Search error', error);
    }
  }

  toggleExpandAll() {
    try {
      const toolBodies = this.shadowRoot.querySelectorAll('.tool-body');
      const toggleButton = this.shadowRoot.getElementById('toggle-expand-button');
      
      if (!toolBodies || !toggleButton) return;
      
      const allExpanded = Array.from(toolBodies).every(body => body.style.display !== 'none');
      
      toolBodies.forEach(body => {
        body.style.display = allExpanded ? 'none' : 'block';
      });
      
toggleButton.textContent = allExpanded ? '\u2195\uFE0F Expand All' : '\u2195\uFE0F Collapse All';
      this.announceToScreenReader(`All tool calls ${allExpanded ? 'collapsed' : 'expanded'}`);
      
    } catch (error) {
      this.handleError('Toggle expand all error', error);
    }
  }

  toggleStepExpansion(stepElement) {
    try {
      const toolBody = stepElement.querySelector('.tool-body');
      if (toolBody) {
        const isExpanded = toolBody.style.display !== 'none';
        toolBody.style.display = isExpanded ? 'none' : 'block';
        this.announceToScreenReader(`Step ${isExpanded ? 'collapsed' : 'expanded'}`);
      }
    } catch (error) {
      this.handleError('Toggle step expansion error', error);
    }
  }

  showToast(message, type = 'info') {
    try {
      const toast = document.createElement('div');
      toast.textContent = message;
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#374151'};
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

  handleError(context, error) {
    console.error(`${context}:`, error);
    
    this.parseErrors.push({
      context,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    // Show error in UI
    const container = this.shadowRoot.getElementById('thinking-container');
    const errorDisplay = this.shadowRoot.getElementById('error-display');
    
    if (container) {
      container.classList.add('error');
    }
    
    if (errorDisplay) {
      errorDisplay.textContent = `${context}: ${error.message}`;
      errorDisplay.classList.add('active');
      
      setTimeout(() => {
        errorDisplay.classList.remove('active');
        container?.classList.remove('error');
      }, 5000);
    }
    
    // Announce to screen readers
    this.announceToScreenReader(`Error: ${error.message}`);
  }

  announceToScreenReader(message) {
    const announcements = this.shadowRoot.getElementById('accessibility-announcements');
    if (announcements) {
      announcements.textContent = message;
      setTimeout(() => {
        announcements.textContent = '';
      }, 1000);
    }
  }

  disconnectedCallback() {
    // Clean up any running intervals or timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Ensure streaming state is cleared when element is removed
    if (this.isStreaming) {
      this.setStreamingState(false);
      console.log('EnhancedThinkingBlock: Cleared streaming state on disconnect');
    }
  }

  debounce(func, wait) {
    return (...args) => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => func.apply(this, args), wait);
    };
  }
  
  // Throttle function for high-frequency events
  throttle(func, limit) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
  
  // Memoization function for expensive operations
  memoize(fn) {
    const cache = new Map();
    return (...args) => {
      const key = JSON.stringify(args);
      if (cache.has(key)) {
        return cache.get(key);
      }
      const result = fn.apply(this, args);
      cache.set(key, result);
      return result;
    };
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  calculateTokenCount(text) {
    // Simple token estimation: roughly 1 token per 4 characters
    return Math.ceil(text.length / 4);
  }

  setAnswerContent(answer) {
    try {
      const answerContent = this.shadowRoot.getElementById('answer-content');
      if (answerContent) {
        answerContent.innerHTML = marked.parse(answer || '');
      }
    } catch (error) {
      this.handleError('Answer content update error', error);
    }
  }

  copyFinalAnswer(formatted = false) {
    try {
      const answerContent = this.shadowRoot.getElementById('answer-content');
      if (!answerContent || !answerContent.textContent.trim()) {
        this.showToast('No answer content to copy', 'error');
        return;
      }

      const content = formatted ? answerContent.innerHTML : answerContent.textContent;
      navigator.clipboard.writeText(content).then(() => {
        this.showToast(`${formatted ? 'Formatted' : 'Raw'} answer copied to clipboard`, 'success');
        this.announceToScreenReader(`${formatted ? 'Formatted' : 'Raw'} answer copied to clipboard`);
      }).catch(err => {
        this.handleError('Copy answer failed', err);
        this.showToast('Failed to copy answer', 'error');
      });
    } catch (error) {
      this.handleError('Copy answer error', error);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  calculateTokenCount(text) {
    if (!text || typeof text !== 'string') return 0;
    const normalized = text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width chars
      .replace(/([.,!?;:()[\]{}""''`~@#$%^&*+=<>/|-])/g, ' $1 ') // pad punctuation
      .trim();
    if (!normalized) return 0;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.length;
  }

  setAnswerContent(answer) {
    try {
      const answerContent = this.shadowRoot.getElementById('answer-content');
      // store raw answer for copy
      this.rawAnswer = answer || '';
      if (answerContent) {
        // Clear existing content first
        answerContent.innerHTML = '';

        if (answer && answer.trim()) {
          if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
            const parsedContent = marked.parse(answer || '');
            const answerWrapper = document.createElement('div');
            answerWrapper.className = 'answer-wrapper';
            answerWrapper.innerHTML = parsedContent;
            answerContent.appendChild(answerWrapper);
          } else {
            // Use textContent for non-markdown content where appropriate
            answerContent.textContent = answer || '';
          }
        } else {
          // FIX: Ensure answer section is visible even when empty
          // Add a placeholder space to maintain minimum height
          answerContent.innerHTML = '<div style="min-height: 20px;"></div>';
        }
      }
    } catch (error) {
      this.handleError('Answer content setting error', error);
    }
  }
  
  copyFinalAnswer(formatted = false) {
    try {
      const answerContent = this.shadowRoot.getElementById('answer-content');
      const raw = (this.rawAnswer || '').trim();
      const hasAnswer = raw.length > 0 || (answerContent && answerContent.textContent && answerContent.textContent.trim().length > 0);
      if (!hasAnswer) {
        this.showToast('No final answer to copy', 'error');
        return;
      }
      if (!formatted) {
        const text = raw || (answerContent ? answerContent.textContent.trim() : '');
        navigator.clipboard.writeText(text).then(() => {
          this.showToast('Final answer copied to clipboard', 'success');
          this.announceToScreenReader('Final answer copied to clipboard');
        }).catch(err => {
          this.handleError('Copy failed', err);
          this.showToast('Failed to copy final answer', 'error');
        });
      } else {
        // formatted: copy HTML + plain text fallback similar to chat.js
        const htmlContent = answerContent ? answerContent.innerHTML : '';
        const plain = raw || (answerContent ? answerContent.textContent : '');
        if (window.ClipboardItem) {
          navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([htmlContent], { type: 'text/html' }),
              'text/plain': new Blob([plain], { type: 'text/plain' })
            })
          ]).then(() => this.showToast('Copied formatted answer', 'success'))
          .catch(err => {
            console.error('Failed to copy formatted answer: ', err);
            navigator.clipboard.writeText(plain).then(() => this.showToast('Copied (plain text fallback) to clipboard', 'success'))
              .catch(errFallback => { console.error('Failed to copy plain text fallback: ', errFallback); this.showToast('Error copying text.', 'error'); });
          });
        } else {
          navigator.clipboard.writeText(plain).then(() => this.showToast('Final answer copied to clipboard', 'success'))
            .catch(err => { console.error('Failed to copy final answer: ', err); this.showToast('Error copying text.', 'error'); });
        }
      }
    } catch (error) {
      this.handleError('Copy final answer error', error);
    }
  }
}

// Register the enhanced thinking block
customElements.define('enhanced-thinking-block', EnhancedThinkingBlock);