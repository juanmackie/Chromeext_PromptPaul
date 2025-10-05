/**
 * Thinking Block Core
 * Core functionality for the thinking block component
 * Implements production-ready coding rules for component logic
 *
 * Core Principles:
 * - Input Validation: Validate all thinking block data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient rendering with proper DOM management
 */

import { logger } from '../../shared/index.js';

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

interface ContentSegment {
  type: 'text' | 'thinking';
  content: string;
  children?: ContentSegment[];
}

class ThinkingBlockCore {
  private shadow: ShadowRoot;
  private logger: any;
  private steps: ThinkingStep[] = [];
  private toolCalls: ToolCall[] = [];
  private parseErrors: any[] = [];
  private isStreaming: boolean = false;
  private virtualScrollEnabled: boolean = false;
  private maxVisibleSteps: number = 50;
  private debounceTimer: number | null = null;
  private rawAnswer: string = '';
  private renderScheduled: boolean = false;
  private cleanupTasks: (() => void)[] = [];
  private stepElements: Map<string, HTMLElement> = new Map();

  constructor(shadow: ShadowRoot) {
    this.shadow = shadow;
    this.logger = logger;
  }

  /**
   * Schedules a render using requestAnimationFrame for smooth performance
   */
  private scheduleRender(): void {
    if (this.renderScheduled) return;
    
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.debouncedRender();
      this.renderScheduled = false;
    });
  }

  /**
   * Debounced render function
   */
  private debouncedRender = this.debounce(() => {
    this.performRender();
  }, 100);

  /**
   * Initializes the thinking block core
   */
  initialize(): void {
    this.logger.debug('Initializing thinking block core');

    try {
      // Set up initial state
      this.steps = [];
      this.toolCalls = [];
      this.parseErrors = [];
      this.isStreaming = false;
      this.virtualScrollEnabled = false;
      this.rawAnswer = '';

      this.logger.debug('Thinking block core initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize thinking block core', {}, error);
      throw error;
    }
  }

  /**
   * Sets the streaming state
   * @param isStreaming - Streaming state
   */
  setStreamingState(isStreaming: boolean): void {
    if (typeof isStreaming !== 'boolean') {
      throw new Error('Streaming state must be a boolean');
    }

    this.isStreaming = isStreaming;
    this.logger.debug(`Streaming state set to: ${isStreaming}`);
  }

  /**
   * Gets the streaming state
   * @returns Current streaming state
   */
  getStreamingState(): boolean {
    return this.isStreaming;
  }

  /**
   * Sets the content
   * @param content - Content to set
   */
  setContent(content: string): void {
    if (!content || typeof content !== 'string') {
      throw new Error('Content is required and must be a string');
    }

    try {
      // Update token count with debouncing
      this.debounce(() => {
        const tokenCount = this.calculateTokenCount(content);
        this.updateTokenCount(tokenCount);
      }, 200)();

      // Parse thinking content into structured steps
      this.parseThinkingContent(content);

      // Schedule optimized render
      this.scheduleRender();

      // Enable virtual scroll for large content
      this.virtualScrollEnabled = this.steps.length > this.maxVisibleSteps;
    } catch (error) {
      this.logger.error('Failed to set content', {}, error);
      throw error;
    }
  }

  /**
   * Sets the thinking content
   * @param thinking - Thinking content to set
   */
  setThinkingContent(thinking: string): void {
    if (!thinking || typeof thinking !== 'string') {
      throw new Error('Thinking content is required and must be a string');
    }

    try {
      // Parse thinking content into structured steps
      this.parseThinkingContent(thinking);

      // Schedule optimized render
      this.scheduleRender();
    } catch (error) {
      this.logger.error('Failed to set thinking content', {}, error);
      throw error;
    }
  }

  /**
   * Sets the answer content
   * @param answer - Answer content to set
   */
  setAnswerContent(answer: string): void {
    if (!answer || typeof answer !== 'string') {
      throw new Error('Answer content is required and must be a string');
    }

    try {
      // Store raw answer for copy
      this.rawAnswer = answer;

      // Update answer content
      const answerContent = this.shadow.getElementById('answer-content');
      if (answerContent) {
        answerContent.innerHTML = '';

        if (answer && answer.trim()) {
          if (typeof marked !== 'undefined' && typeof (marked as any).parse === 'function') {
            const parsedContent = (marked as any).parse(answer);
            const answerWrapper = document.createElement('div');
            answerWrapper.className = 'answer-wrapper';
            answerWrapper.innerHTML = parsedContent;
            answerContent.appendChild(answerWrapper);
          } else {
            const answerWrapper = document.createElement('div');
            answerWrapper.className = 'answer-wrapper';
            answerWrapper.textContent = answer;
            answerContent.appendChild(answerWrapper);
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to set answer content', {}, error);
      throw error;
    }
  }

  /**
   * Sets the token count
   * @param tokens - Token count
   */
  setTokenCount(tokens: number): void {
    if (typeof tokens !== 'number' || tokens < 0) {
      throw new Error('Token count must be a non-negative number');
    }

    try {
      this.updateTokenCount(tokens);
    } catch (error) {
      this.logger.error('Failed to set token count', {}, error);
      throw error;
    }
  }

  /**
   * Gets the steps
   * @returns Array of thinking steps
   */
  getSteps(): ThinkingStep[] {
    return [...this.steps];
  }

  /**
   * Gets the tool calls
   * @returns Array of tool calls
   */
  getToolCalls(): ToolCall[] {
    return [...this.toolCalls];
  }

  /**
   * Gets the raw answer
   * @returns Raw answer content
   */
  getRawAnswer(): string {
    return this.rawAnswer;
  }

  /**
   * Parses thinking content into structured steps
   * @param thought - Thinking content to parse
   */
  private parseThinkingContent(thought: string): void {
    try {
      this.steps = [];
      this.toolCalls = [];

      if (!thought.trim()) {
        return;
      }

      // Try to parse structured thinking with enhanced patterns
      const lines = thought.split('\n').filter(line => line.trim());

      let currentStep: ThinkingStep | null = null;
      let inToolCall = false;
      let currentToolCall: ToolCall | null = null;
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
            },
            timestamp: new Date().toISOString()
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
            description: stepText,
            timestamp: new Date().toISOString()
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
              description: trimmed,
              timestamp: new Date().toISOString()
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
      this.logger.error('Failed to parse thinking content', {}, error);
      this.parseErrors.push({
        context: 'parseThinkingContent',
        error: error.message,
        timestamp: new Date().toISOString()
      });

      // Fallback to raw thinking
      this.steps = [{
        type: 'thinking',
        title: 'Thinking Process',
        description: thought,
        timestamp: new Date().toISOString()
      }];
    }
  }

  /**
   * Creates intelligent chunks from unstructured content
   * @param thought - Thinking content
   */
  private createIntelligentChunks(thought: string): void {
    const sentences = thought.split(/[.!?]+/).filter(s => s.trim());
    const chunkSize = 3; // sentences per chunk

    for (let i = 0; i < sentences.length; i += chunkSize) {
      const chunk = sentences.slice(i, i + chunkSize).join('. ').trim();
      if (chunk) {
        this.steps.push({
          type: 'thinking',
          title: this.truncateText(chunk, 80),
          description: chunk + (i + chunkSize < sentences.length ? '.' : ''),
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Processes tool calls for better display
   */
  private processToolCalls(): void {
    this.steps.forEach(step => {
      if (step.toolCall) {
        // Try to parse JSON input/output
        try {
          if (step.toolCall.input.trim().startsWith('{') || step.toolCall.input.trim().startsWith('[')) {
            JSON.parse(step.toolCall.input);
            (step.toolCall as any).inputIsJson = true;
          }
        } catch (e) {
          // Not JSON, continue as text
        }

        try {
          if (step.toolCall.output.trim().startsWith('{') || step.toolCall.output.trim().startsWith('[')) {
            JSON.parse(step.toolCall.output);
            (step.toolCall as any).outputIsJson = true;
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

  /**
   * Renders the steps list with incremental DOM updates
   */
  private renderStepsList(): void {
    const stepsList = this.shadow.getElementById('steps-list');
    if (!stepsList) return;

    this.logger.debug('Rendering steps list', { stepCount: this.steps.length });

    try {
      // Use document fragment for batch DOM operations
      const fragment = document.createDocumentFragment();
      const existingElements = new Set<string>();
      
      // Only render steps that don't exist yet or have changed
      this.steps.forEach((step, index) => {
        const stepId = `step-${index}`;
        existingElements.add(stepId);
        
        let stepElement = this.stepElements.get(stepId);
        
        if (!stepElement) {
          // Create new step element
          stepElement = this.createStepElement(step, stepId);
          this.stepElements.set(stepId, stepElement);
          fragment.appendChild(stepElement);
        } else {
          // Update existing element if needed
          this.updateStepElement(stepElement, step);
        }
      });

      // Remove orphaned elements
      const orphanedIds: string[] = [];
      this.stepElements.forEach((element, id) => {
        if (!existingElements.has(id)) {
          orphanedIds.push(id);
          element.remove();
        }
      });
      
      orphanedIds.forEach(id => this.stepElements.delete(id));

      // Append new elements in a single operation
      if (fragment.children.length > 0) {
        stepsList.appendChild(fragment);
      }
      
      this.logger.debug('Steps list rendered successfully');
    } catch (error) {
      this.logger.error('Failed to render steps list', {}, error);
    }
  }

  /**
   * Creates a step element
   */
  private createStepElement(step: ThinkingStep, stepId: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'step-item';
    li.id = stepId;
    li.setAttribute('role', 'listitem');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', `${step.title}: ${step.description}`);
    li.setAttribute('data-step-type', step.type);

    li.innerHTML = `
      <div class="step-icon ${step.type}" aria-hidden="true">
        ${step.type === 'thinking' ? '🤔' : step.type === 'tool' ? '⚙️' : step.type === 'result' ? '✓' : '❌'}
      </div>
      <div class="step-content">
        <div class="step-title">${this.escapeHtml(step.title)}</div>
        <div class="step-description">${this.escapeHtml(step.description)}</div>
        ${step.timestamp ? `<div class="step-timestamp">${step.timestamp}</div>` : ''}
        ${step.toolCall ? this.renderToolCall(step.toolCall) : ''}
      </div>
    `;

    // Add keyboard navigation
    const keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleStepExpansion(li);
      }
    };
    
    li.addEventListener('keydown', keydownHandler);
    
    // Store cleanup task
    this.addCleanupTask(() => {
      li.removeEventListener('keydown', keydownHandler);
    });

    return li;
  }

  /**
   * Updates an existing step element efficiently
   */
  private updateStepElement(stepElement: HTMLElement, step: ThinkingStep): void {
    // Update timestamp if present
    if (step.timestamp) {
      let timestampElement = stepElement.querySelector('.step-timestamp');
      if (!timestampElement) {
        timestampElement = document.createElement('div');
        timestampElement.className = 'step-timestamp';
        stepElement.querySelector('.step-content')?.appendChild(timestampElement);
      }
      timestampElement.textContent = step.timestamp;
    }
    
    // Update tool call if present and changed
    if (step.toolCall) {
      const existingToolBlock = stepElement.querySelector('.tool-call-block');
      if (!existingToolBlock) {
        const toolCallHtml = this.renderToolCall(step.toolCall);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = toolCallHtml;
        stepElement.querySelector('.step-content')?.appendChild(tempDiv.firstElementChild!);
      } else {
        this.updateToolCallBlock(existingToolBlock as HTMLElement, step.toolCall);
      }
    }
  }

  /**
   * Renders a tool call
   * @param toolCall - Tool call to render
   * @returns HTML string
   */
  private renderToolCall(toolCall: ToolCall): string {
    const inputClass = (toolCall as any).inputIsJson ? 'json' : '';
    const outputClass = (toolCall as any).outputIsJson ? 'json' : '';
    const statusClass = toolCall.status || 'running';
    const statusIcon = toolCall.status === 'error' ? '❌' : toolCall.status === 'success' ? '✅' : '⏳';

    return `
      <div class="tool-call-block">
        <div class="tool-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
          <div class="tool-info">
            <span class="tool-icon" aria-hidden="true">⚙️</span>
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
              <div class="tool-content ${inputClass}">${this.formatToolContent(toolCall.input, (toolCall as any).inputIsJson)}</div>
            </div>
          ` : ''}
          ${toolCall.output ? `
            <div class="tool-section">
              <div class="tool-label">OUTPUT</div>
              <div class="tool-content ${outputClass}">${this.formatToolContent(toolCall.output, (toolCall as any).outputIsJson)}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Formats tool content
   * @param content - Content to format
   * @param isJson - Whether content is JSON
   * @returns Formatted content
   */
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

  /**
   * Updates the token count display
   * @param tokenCount - Token count
   */
  private updateTokenCount(tokenCount: number): void {
    const tokenCountElement = this.shadow.getElementById('token-count');
    if (tokenCountElement) {
      tokenCountElement.textContent = String(tokenCount);
    }
  }

  /**
   * Handles virtual scroll
   */
  private handleVirtualScroll(): void {
    // Implementation for virtual scroll
    // This would be more complex in a real implementation
    this.logger.debug('Virtual scroll handled');
  }

  /**
   * Toggles step expansion
   * @param stepElement - Step element
   */
  private toggleStepExpansion(stepElement: HTMLElement): void {
    try {
      const toolBody = stepElement.querySelector('.tool-body');
      if (toolBody) {
        const isExpanded = (toolBody as HTMLElement).style.display !== 'none';
        (toolBody as HTMLElement).style.display = isExpanded ? 'none' : 'block';
      }
    } catch (error) {
      this.logger.error('Failed to toggle step expansion', {}, error);
    }
  }

  /**
   * Calculates token count
   * @param text - Text to calculate tokens for
   * @returns Token count
   */
  private calculateTokenCount(text: string): number {
    if (!text || typeof text !== 'string') {
      return 0;
    }

    const normalized = text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width chars
      .replace(/([.,!?;:()\[\]{}""''`~@#\$%\^&*+=<>/|-])/g, ' \$1 ') // pad punctuation
      .trim();

    if (!normalized) {
      return 0;
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.length;
  }

  /**
   * Truncates text
   * @param text - Text to truncate
   * @param maxLength - Maximum length
   * @returns Truncated text
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Escapes HTML
   * @param text - Text to escape
   * @returns Escaped text
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Performs the actual render operation
   */
  private performRender(): void {
    this.renderStepsList();
  }

  /**
   * Cleans up resources and prevents memory leaks
   */
  public cleanup(): void {
    this.logger.debug('Cleaning up ThinkingBlockCore resources');
    
    try {
      // Clear caches and state
      this.stepElements.clear();
      this.steps = [];
      this.toolCalls = [];
      this.parseErrors = [];
      
      // Cancel any pending renders
      this.renderScheduled = false;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      
      // Execute cleanup tasks
      this.cleanupTasks.forEach(task => {
        try {
          task();
        } catch (error) {
          this.logger.warn('Failed to execute cleanup task', {}, error);
        }
      });
      this.cleanupTasks = [];
      
      this.logger.debug('ThinkingBlockCore cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup ThinkingBlockCore', {}, error);
    }
  }

  /**
   * Adds a cleanup task to be executed on cleanup
   */
  public addCleanupTask(task: () => void): void {
    this.cleanupTasks.push(task);
  }

  /**
   * Debounce function
   * @param func - Function to debounce
   * @param wait - Wait time in milliseconds
   * @returns Debounced function
   */
  private debounce(func: Function, wait: number): Function {
    return (...args: any[]) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => func.apply(this, args), wait);
    };
  }
}

export default ThinkingBlockCore;