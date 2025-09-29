class ThinkingBlock extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isStreaming = false;
    this.toolCalls = [];
    this.steps = [];
  }

  static get observedAttributes() {
    return ['think', 'answer', 'tokens', 'streaming'];
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    // Initialize with current attributes if present
    if (this.hasAttribute('think')) this.updateThoughtContent(this.getAttribute('think'));
    if (this.hasAttribute('answer')) this.setAnswerContent(this.getAttribute('answer'));
    if (this.hasAttribute('streaming')) this.setStreamingState(this.getAttribute('streaming') === 'true');
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (name === 'think') {
      this.updateThoughtContent(newVal || '');
    } else if (name === 'answer') {
      this.setAnswerContent(newVal || '');
    } else if (name === 'tokens') {
      const tokenCountElement = this.shadowRoot?.getElementById('token-count');
      if (tokenCountElement && typeof newVal !== 'undefined' && newVal !== null) {
        tokenCountElement.textContent = String(newVal);
      }
    } else if (name === 'streaming') {
      this.setStreamingState(newVal === 'true');
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
        
        /* Main container */
        .thinking-container {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          transition: all 0.3s ease;
        }
        
        .thinking-container.streaming {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        /* Header */
        .thinking-header {
          padding: 16px 20px;
          background: #f8fafc;
          border-bottom: 1px solid #e5e7eb;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: background-color 0.2s ease;
          user-select: none;
        }
        
        .thinking-header:hover {
          background: #f1f5f9;
        }
        
        .thinking-header.streaming .title {
          color: #3b82f6;
        }
        
        .thinking-icon {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          transition: transform 0.3s ease;
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
          font-size: 14px;
          color: #374151;
          transition: color 0.2s ease;
        }
        
        .streaming-indicator {
          display: none;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #3b82f6;
        }
        
        .streaming .streaming-indicator {
          display: flex;
        }
        
        .streaming-dot {
          width: 6px;
          height: 6px;
          background: #3b82f6;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }
        
        .streaming-dot:nth-child(2) { animation-delay: 0.2s; }
        .streaming-dot:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
        
        .token-count {
          font-size: 12px;
          color: #6b7280;
          background: #f3f4f6;
          padding: 4px 8px;
          border-radius: 12px;
          font-weight: 500;
        }

        /* Content Area */
        .thinking-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        
        .thinking-container[open] .thinking-content {
          max-height: 600px;
          overflow-y: auto;
        }

        /* Steps List */
        .steps-list {
          margin: 0;
          padding: 20px;
          list-style: none;
        }
        
        .step-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 0;
          border-bottom: 1px solid #f3f4f6;
          opacity: 0;
          transform: translateY(10px);
          animation: slideIn 0.3s ease forwards;
        }
        
        .step-item:last-child {
          border-bottom: none;
        }
        
        .step-item:nth-child(1) { animation-delay: 0.1s; }
        .step-item:nth-child(2) { animation-delay: 0.2s; }
        .step-item:nth-child(3) { animation-delay: 0.3s; }
        
        @keyframes slideIn {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .step-icon {
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 600;
        }
        
        .step-icon.thinking {
          background: #dbeafe;
          color: #1e40af;
        }
        
        .step-icon.tool {
          background: #fef3c7;
          color: #92400e;
        }
        
        .step-icon.result {
          background: #d1fae5;
          color: #065f46;
        }
        
        .step-content {
          flex: 1;
        }
        
        .step-title {
          font-weight: 600;
          font-size: 13px;
          color: #374151;
          margin-bottom: 4px;
        }
        
        .step-description {
          font-size: 13px;
          color: #6b7280;
          line-height: 1.5;
        }

        /* Tool Call Blocks */
        .tool-call-block {
          margin: 16px 0;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #fefefe;
          overflow: hidden;
        }
        
        .tool-header {
          padding: 12px 16px;
          background: #f8fafc;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .tool-icon {
          width: 16px;
          height: 16px;
        }
        
        .tool-name {
          font-weight: 600;
          font-size: 13px;
          color: #374151;
        }
        
        .tool-body {
          padding: 16px;
        }
        
        .tool-section {
          margin-bottom: 12px;
        }
        
        .tool-section:last-child {
          margin-bottom: 0;
        }
        
        .tool-label {
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
        
        .tool-content {
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          border-radius: 4px;
          padding: 8px 12px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          line-height: 1.4;
          color: #374151;
          white-space: pre-wrap;
          word-break: break-word;
        }

        /* Raw thinking fallback */
        .raw-thinking {
          padding: 20px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 13px;
          line-height: 1.5;
          color: #374151;
          white-space: pre-wrap;
          word-break: break-word;
          background: #f8fafc;
          border-radius: 8px;
          margin: 16px;
        }

        /* Answer Section */
        .answer-section {
          margin-top: 16px;
          padding: 0 20px 20px;
        }
        
        .answer-content {
          background: #ffffff;
          border-left: 4px solid #4f46e5;
          padding: 16px;
          border-radius: 6px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .answer-content p {
          margin: 0 0 1em 0;
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
          margin: 0.25em 0;
        }
        
        .answer-content li:last-child {
          margin-bottom: 0;
        }

        /* Actions */
        .thinking-actions {
          padding: 12px 20px;
          background: #f8fafc;
          border-top: 1px solid #e5e7eb;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        
        .action-button {
          padding: 6px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #ffffff;
          color: #374151;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .action-button:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
        }
        
        .action-button:active {
          background: #e5e7eb;
        }

        /* Dark theme support */
        :host-context(.dark-theme) .thinking-container {
          background: #1f2937;
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .thinking-header {
          background: #111827;
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .thinking-header:hover {
          background: #1f2937;
        }
        
        :host-context(.dark-theme) .title {
          color: #f3f4f6;
        }
        
        :host-context(.dark-theme) .token-count {
          background: #374151;
          color: #d1d5db;
        }
        
        :host-context(.dark-theme) .step-item {
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .tool-call-block {
          background: #1f2937;
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .tool-header {
          background: #111827;
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
          background: #111827;
          color: #f3f4f6;
        }
        
        :host-context(.dark-theme) .thinking-actions {
          background: #111827;
          border-color: #374151;
        }
        
        :host-context(.dark-theme) .action-button {
          background: #374151;
          border-color: #4b5563;
          color: #f3f4f6;
        }
        
        :host-context(.dark-theme) .action-button:hover {
          background: #4b5563;
          border-color: #6b7280;
        }
        
        /* Dark Theme: Answer content */
        :host-context(.dark-theme) .answer-content {
          background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
          border-left-color: #6366f1;
          color: #f3f4f6;
        }
        :host-context(.dark-theme) .answer-content .answer-wrapper { color: inherit; }
        :host-context(.dark-theme) .answer-content h1,
        :host-context(.dark-theme) .answer-content h2,
        :host-context(.dark-theme) .answer-content h3,
        :host-context(.dark-theme) .answer-content h4,
        :host-context(.dark-theme) .answer-content h5,
        :host-context(.dark-theme) .answer-content h6 { color: #f3f4f6; }
        :host-context(.dark-theme) .answer-content p,
        :host-context(.dark-theme) .answer-content li { color: #e5e7eb; }
        :host-context(.dark-theme) .answer-content strong { color: #f9fafb; }
        :host-context(.dark-theme) .answer-content a { color: #93c5fd; }
        :host-context(.dark-theme) .answer-content code {
          background: #111827;
          color: #e5e7eb;
          border: 1px solid #374151;
          padding: 0.1em 0.3em;
          border-radius: 4px;
        }
        :host-context(.dark-theme) .answer-content pre {
          background: #111827;
          border: 1px solid #374151;
          color: #e5e7eb;
          padding: 12px;
          border-radius: 8px;
          overflow: auto;
        }
        :host-context(.dark-theme) .answer-content blockquote {
          border-left: 3px solid #4b5563;
          color: #e5e7eb;
          background: #111827;
          padding: 8px 12px;
          border-radius: 6px;
        }
      </style>
      
      <div class="thinking-container" id="thinking-container">
        <div class="thinking-header" id="thinking-header" role="button" tabindex="0" aria-expanded="false">
          <span class="thinking-icon">&#9654;</span>
          <div class="title-area">
            <span class="title">Model Thinking Process</span>
            <div class="streaming-indicator">
              <span class="streaming-dot"></span>
              <span class="streaming-dot"></span>
              <span class="streaming-dot"></span>
              <span style="margin-left: 4px;">Thinking...</span>
            </div>
          </div>
          <span class="token-count">(<span id="token-count">0</span> tokens)</span>
        </div>
        
        <div class="thinking-content" id="thinking-content">
          <ul class="steps-list" id="steps-list"></ul>
          <div class="raw-thinking" id="raw-thinking" style="display: none;"></div>
        </div>
        
        <div class="answer-section">
          <div class="answer-content" id="answer-content" aria-live="polite"></div>
        </div>
        
        <div class="thinking-actions">
          <button class="action-button" id="copy-button" title="Copy thinking process">
            \uD83D\uDCCB Copy
          </button>
          <button class="action-button" id="toggle-raw-button" title="Toggle raw view">
            \uD83D\uDCC4 Raw
          </button>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const header = this.shadowRoot?.getElementById('thinking-header');
    const container = this.shadowRoot?.getElementById('thinking-container');
    const copyButton = this.shadowRoot?.getElementById('copy-button');
    const toggleRawButton = this.shadowRoot?.getElementById('toggle-raw-button');
    
    if (!header || !container) return;
    
    const key = 'thinkExpanded';
    // Restore collapse preference
    const wasExpanded = localStorage.getItem(key) !== 'false';
    if (wasExpanded) {
      container.setAttribute('open', '');
      header.setAttribute('aria-expanded', 'true');
    }
    
    // Toggle collapse
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
    
    // Toggle raw view
    if (toggleRawButton) {
      toggleRawButton.addEventListener('click', () => {
        this.toggleRawView();
      });
    }
  }

  updateThoughtContent(thought) {
    const tokenCountElement = this.shadowRoot?.getElementById('token-count');
    const stepsList = this.shadowRoot?.getElementById('steps-list');
    const rawThinking = this.shadowRoot?.getElementById('raw-thinking');
    
    // Update token count
    if (tokenCountElement) {
      const tokenCount = this.calculateTokenCount(thought || '');
      tokenCountElement.textContent = String(tokenCount);
    }
    
    // Parse thinking content into structured steps
    this.parseThinkingContent(thought || '');
    
    // Update steps list
    if (stepsList) {
      stepsList.innerHTML = '';
      this.steps.forEach((step, index) => {
        const li = document.createElement('li');
        li.className = 'step-item';
        li.innerHTML = `
          <div class="step-icon ${step.type}">
            ${step.type === 'thinking' ? '\uD83E\uDD14' : step.type === 'tool' ? '\u2699\uFE0F' : '\u2713'}
          </div>
          <div class="step-content">
            <div class="step-title">${step.title}</div>
            <div class="step-description">${step.description}</div>
            ${step.toolCall ? this.renderToolCall(step.toolCall) : ''}
          </div>
        `;
        stepsList.appendChild(li);
      });
    }
    
    // Update raw thinking fallback
    if (rawThinking) {
      rawThinking.textContent = thought || '';
    }
  }
  
  parseThinkingContent(thought) {
    this.steps = [];
    this.toolCalls = [];
    
    if (!thought.trim()) return;
    
    // Try to parse structured thinking
    const lines = thought.split('\n').filter(line => line.trim());
    
    let currentStep = null;
    let inToolCall = false;
    let currentToolCall = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Detect tool calls
      if (trimmed.startsWith('Tool:') || trimmed.startsWith('Using tool:')) {
        if (currentStep) {
          this.steps.push(currentStep);
        }
        
        const toolName = trimmed.replace(/^(Tool:|Using tool:)\s*/, '');
        currentStep = {
          type: 'tool',
          title: `Using tool: ${toolName}`,
          description: 'Executing tool call...',
          toolCall: {
            name: toolName,
            input: '',
            output: ''
          }
        };
        inToolCall = true;
        currentToolCall = currentStep.toolCall;
        continue;
      }
      
      // Detect tool input
      if (inToolCall && (trimmed.startsWith('Input:') || trimmed.startsWith('Arguments:'))) {
        if (currentToolCall) {
          currentToolCall.input = trimmed.replace(/^(Input:|Arguments:)\s*/, '');
        }
        continue;
      }
      
      // Detect tool output
      if (inToolCall && (trimmed.startsWith('Output:') || trimmed.startsWith('Result:'))) {
        if (currentToolCall) {
          currentToolCall.output = trimmed.replace(/^(Output:|Result:)\s*/, '');
        }
        continue;
      }
      
      // Detect step indicators
      if (trimmed.match(/^\d+\.?\s/) || trimmed.startsWith('Step:') || trimmed.startsWith('-')) {
        if (currentStep) {
          this.steps.push(currentStep);
        }
        
        const stepText = trimmed.replace(/^\d+\.?\s*/, '').replace(/^Step:\s*/, '').replace(/^-\s*/, '');
        currentStep = {
          type: 'thinking',
          title: this.truncateText(stepText, 60),
          description: stepText
        };
        inToolCall = false;
        continue;
      }
      
      // If we have a current step, append to its description
      if (currentStep && !inToolCall) {
        currentStep.description += ' ' + trimmed;
      } else if (inToolCall && currentToolCall) {
        // Append to tool input/output if we're in a tool call
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
    
    // If no structured steps were found, create a single raw thinking step
    if (this.steps.length === 0) {
      this.steps.push({
        type: 'thinking',
        title: 'Thinking Process',
        description: thought
      });
    }
  }
  
  renderToolCall(toolCall) {
    return `
      <div class="tool-call-block">
        <div class="tool-header">
          <span class="tool-icon">&#9881;&#65039;</span>
          <span class="tool-name">${toolCall.name}</span>
        </div>
        <div class="tool-body">
          ${toolCall.input ? `
            <div class="tool-section">
              <div class="tool-label">INPUT</div>
              <div class="tool-content">${this.escapeHtml(toolCall.input)}</div>
            </div>
          ` : ''}
          ${toolCall.output ? `
            <div class="tool-section">
              <div class="tool-label">OUTPUT</div>
              <div class="tool-content">${this.escapeHtml(toolCall.output)}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }
  
  setStreamingState(isStreaming) {
    this.isStreaming = isStreaming;
    const container = this.shadowRoot?.getElementById('thinking-container');
    const header = this.shadowRoot?.getElementById('thinking-header');
    
    if (container) {
      if (isStreaming) {
        container.classList.add('streaming');
      } else {
        container.classList.remove('streaming');
      }
    }
    
    // Auto-expand when streaming starts
    if (isStreaming && container && !container.hasAttribute('open')) {
      container.setAttribute('open', '');
      header?.setAttribute('aria-expanded', 'true');
      localStorage.setItem('thinkExpanded', 'true');
    }
  }
  
  copyThinkingProcess() {
    const stepsList = this.shadowRoot?.getElementById('steps-list');
    const rawThinking = this.shadowRoot?.getElementById('raw-thinking');
    const answerContent = this.shadowRoot?.getElementById('answer-content');
    
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
      content += rawThinking.textContent + '\n\n';
    }
    
    // Add answer if available
    if (answerContent && answerContent.textContent.trim()) {
      content += 'Final Answer:\n' + answerContent.textContent;
    }
    
    navigator.clipboard.writeText(content).then(() => {
      this.showToast('Thinking process copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy thinking process:', err);
      this.showToast('Failed to copy thinking process');
    });
  }
  
  toggleRawView() {
    const stepsList = this.shadowRoot?.getElementById('steps-list');
    const rawThinking = this.shadowRoot?.getElementById('raw-thinking');
    const toggleButton = this.shadowRoot?.getElementById('toggle-raw-button');
    
    if (stepsList && rawThinking) {
      const isShowingRaw = rawThinking.style.display !== 'none';
      if (isShowingRaw) {
        rawThinking.style.display = 'none';
        stepsList.style.display = 'block';
        toggleButton.textContent = '\uD83D\uDCC4 Raw';
      } else {
        rawThinking.style.display = 'block';
        stepsList.style.display = 'none';
        toggleButton.textContent = '\uD83D\uDCCB Structured';
      }
    }
  }
  
  showToast(message) {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #374151;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      animation: slideInRight 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 2000);
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

  setAnswerContent(answer) {
    const answerContent = this.shadowRoot?.getElementById('answer-content');
    if (answerContent) {
      // Clear previous content
      answerContent.innerHTML = '';
      
      if (answer && answer.trim()) {
        // If marked is available, parse the answer as markdown; otherwise use textContent
        if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
          // Parse markdown and ensure proper structure
          const parsedContent = marked.parse(answer || '');
          
          // Create a wrapper element for better styling
          const answerWrapper = document.createElement('div');
          answerWrapper.className = 'answer-wrapper';
          answerWrapper.innerHTML = parsedContent;
          
          answerContent.appendChild(answerWrapper);
        } else {
          // Fallback to plain text with proper wrapper
          const answerWrapper = document.createElement('div');
          answerWrapper.className = 'answer-wrapper';
          answerWrapper.textContent = answer || '';
          answerContent.appendChild(answerWrapper);
        }
      }
    }
  }

  // Approximate token counting (simple heuristic)
  calculateTokenCount(text) {
    if (!text || typeof text !== 'string') return 0;
    const normalized = text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width chars
      .replace(/([.,!?;:()\[\]{}"“”'’`~@#$%^&*+=<>\\/|\-])/g, ' $1 ') // pad punctuation
      .trim();
    if (!normalized) return 0;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.length;
  }
}

customElements.define('thinking-block', ThinkingBlock);
