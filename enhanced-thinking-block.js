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
      this.parseContentWithTags(this.getAttribute('content') || '');
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
          this.parseContentWithTags(newVal || '');
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

  // Enhanced <thinking> tag parsing with support for nested tags
  parseContentWithTags(content) {
    try {
      this.parseErrors = [];
      this.thinkingTags = [];
      
      if (!content || !content.trim()) {
        this.updateThoughtContent('');
        return;
      }
      
      // Use the improved nested parsing function
      const segments = this.parseNestedThinking(content);
      
      // Process segments to extract thinking and answer content
      let allThinkingContent = '';
      let answerContent = '';
      
      segments.forEach(segment => {
        if (segment.type === 'thinking') {
          // For nested thinking blocks, we need to properly format the content
          allThinkingContent += this.formatNestedThinking(segment) + '\n\n';
        } else if (segment.type === 'text') {
          answerContent += segment.content + '\n';
        }
      });
      
      if (allThinkingContent.trim()) {
        this.updateThoughtContent(allThinkingContent.trim());
      } else {
        // Fallback to legacy parsing if no thinking tags found
        this.updateThoughtContent(content);
      }
      
      if (answerContent.trim()) {
        this.setAnswerContent(answerContent.trim());
      }
      
    } catch (error) {
      this.handleError('Content parsing error', error);
      // Fallback to legacy parsing
      this.updateThoughtContent(content);
    }
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
  
  // Stack-based parser for nested thinking tags that properly handles complex nesting
  parseNestedThinking(content) {
    if (!content) return [];

    const segments = [];
    const stack = [];
    let currentText = '';
    let i = 0;

    while (i < content.length) {
      // Look for the next tag
      const thinkingStart = content.indexOf('<thinking>', i);
      const thinkingEnd = content.indexOf('</thinking>', i);
      
      // Find the earliest occurring tag
      let nextTagPos = -1;
      let isStartTag = false;
      
      if (thinkingStart !== -1 && (thinkingEnd === -1 || thinkingStart < thinkingEnd)) {
        nextTagPos = thinkingStart;
        isStartTag = true;
      } else if (thinkingEnd !== -1) {
        nextTagPos = thinkingEnd;
        isStartTag = false;
      }
      
      if (nextTagPos === -1) {
        // No more tags, add remaining content as text
        if (currentText || stack.length === 0) {
          const textToAdd = currentText + content.substring(i);
          if (textToAdd.trim()) {
            if (stack.length > 0) {
              stack[stack.length - 1].content += textToAdd;
            } else {
              segments.push({ type: 'text', content: textToAdd });
            }
          }
        }
        break;
      }
      
      // Add content before the tag
      const contentBeforeTag = content.substring(i, nextTagPos);
      if (stack.length > 0) {
        stack[stack.length - 1].content += contentBeforeTag;
      } else {
        currentText += contentBeforeTag;
      }
      
      if (isStartTag) {
        // Process start tag
        if (currentText) {
          if (stack.length > 0) {
            stack[stack.length - 1].content += currentText;
          } else {
            segments.push({ type: 'text', content: currentText });
          }
          currentText = '';
        }
        
        // Push a new thinking container to the stack
        stack.push({
          type: 'thinking',
          content: '',
          children: []
        });
      } else {
        // Process end tag
        if (stack.length > 0) {
          const top = stack.pop();
          if (stack.length > 0) {
            // Add the popped thinking as a child to the new top
            stack[stack.length - 1].children.push({
              type: 'thinking',
              content: top.content,
              children: top.children
            });
          } else {
            // Stack is empty, add to main segments
            segments.push({
              type: 'thinking',
              content: top.content,
              children: top.children
            });
          }
        } else {
          // Unmatched closing tag, treat as text
          currentText += '</thinking>';
        }
      }
      
      i = nextTagPos + (isStartTag ? 10 : 11); // Skip past the tag
    }
    
    // Add any remaining text if there's no active thinking block
    if (currentText && stack.length === 0) {
      segments.push({ type: 'text', content: currentText });
    } else if (currentText && stack.length > 0) {
      stack[stack.length - 1].content += currentText;
    }
    
    // Handle any unclosed tags
    if (stack.length > 0) {
      console.warn('Unclosed thinking tags detected, treating remaining content as text');
      let remainingContent = '';
      while (stack.length > 0) {
        const top = stack.pop();
        remainingContent = top.content + remainingContent;
      }
      if (remainingContent) {
        segments.push({ type: 'text', content: remainingContent });
      }
    }
    
    return segments;
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
        // During streaming, use longer debounce to reduce flashing
        const delay = this.isStreaming ? 500 : 0;
        
        if (delay > 0) {
          this.debounce(() => {
            requestAnimationFrame(() => {
              this.renderStepsList();
            });
          }, delay)();
        } else {
          requestAnimationFrame(() => {
            this.renderStepsList();
          });
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
    
    // During streaming, only append new steps instead of rebuilding everything
    if (this.isStreaming && stepsList.children.length > 0) {
      const existingCount = stepsList.children.length;
      const newSteps = this.steps.slice(existingCount);
      
      // Only add new steps to avoid flashing
      const fragment = document.createDocumentFragment();
      newSteps.forEach((step, index) => {
        const li = this.createStepElement(step, existingCount + index, true);
        fragment.appendChild(li);
      });
      
      if (fragment.children.length > 0) {
        stepsList.appendChild(fragment);
      }
      return;
    }
    
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
      li.style.opacity = '1';
      li.style.transform = 'translateY(0)';
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
        answerContent.innerHTML = '';
        
        if (answer && answer.trim()) {
          if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
            const parsedContent = marked.parse(answer || '');
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