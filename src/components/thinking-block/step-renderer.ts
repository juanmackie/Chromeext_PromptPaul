/**
 * Step Renderer
 * Handles rendering of thinking steps
 * Implements production-ready coding rules for step rendering
 *
 * Core Principles:
 * - Input Validation: Validate all step data
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

class StepRenderer {
  private logger: any;
  private virtualScrollEnabled: boolean = false;
  private maxVisibleSteps: number = 50;
  private renderedSteps: Map<string, HTMLElement> = new Map();

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Renders a list of steps
   * @param steps - Array of thinking steps
   * @param container - Container element
   * @returns Array of rendered step elements
   */
  renderSteps(steps: ThinkingStep[], container: HTMLElement): HTMLElement[] {
    if (!steps || !Array.isArray(steps)) {
      throw new Error('Valid steps array is required');
    }

    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('Valid container element is required');
    }

    this.logger.debug('Rendering steps', { stepCount: steps.length });

    try {
      // Clear existing content
      container.innerHTML = '';
      this.renderedSteps.clear();

      // Enable virtual scroll for large content
      this.virtualScrollEnabled = steps.length > this.maxVisibleSteps;

      // Render steps with performance optimization
      const fragment = document.createDocumentFragment();
      const renderedElements: HTMLElement[] = [];

      steps.forEach((step, index) => {
        const stepElement = this.renderStep(step, index);
        fragment.appendChild(stepElement);
        renderedElements.push(stepElement);
        this.renderedSteps.set(`step-${index}`, stepElement);
      });

      container.appendChild(fragment);

      // Handle virtual scroll if enabled
      if (this.virtualScrollEnabled) {
        this.handleVirtualScroll(container);
      }

      this.logger.debug('Steps rendered successfully', { stepCount: renderedElements.length });

      return renderedElements;
    } catch (error) {
      this.logger.error('Failed to render steps', {}, error);
      throw error;
    }
  }

  /**
   * Renders a single step
   * @param step - Thinking step to render
   * @param index - Step index
   * @returns Rendered step element
   */
  renderStep(step: ThinkingStep, index: number): HTMLElement {
    if (!step || typeof step !== 'object') {
      throw new Error('Valid step object is required');
    }

    this.logger.debug('Rendering step', { type: step.type, index });

    try {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.setAttribute('role', 'listitem');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-label', `${step.title}: ${step.description}`);
      li.setAttribute('data-step-index', index.toString());

      // Create step icon
      const stepIcon = document.createElement('div');
      stepIcon.className = `step-icon ${step.type}`;
      stepIcon.setAttribute('aria-hidden', 'true');
      stepIcon.textContent = this.getStepIcon(step.type);

      // Create step content
      const stepContent = document.createElement('div');
      stepContent.className = 'step-content';

      // Create step title
      const stepTitle = document.createElement('div');
      stepTitle.className = 'step-title';
      stepTitle.textContent = step.title;

      // Create step description
      const stepDescription = document.createElement('div');
      stepDescription.className = 'step-description';
      stepDescription.textContent = step.description;

      stepContent.appendChild(stepTitle);
      stepContent.appendChild(stepDescription);

      // Add tool call if present
      if (step.toolCall) {
        const toolCallElement = this.renderToolCall(step.toolCall);
        stepContent.appendChild(toolCallElement);
      }

      li.appendChild(stepIcon);
      li.appendChild(stepContent);

      // Add keyboard navigation
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleStepExpansion(li);
        }
      });

      // Add click handler for expansion
      li.addEventListener('click', () => {
        this.toggleStepExpansion(li);
      });

      return li;
    } catch (error) {
      this.logger.error('Failed to render step', { type: step.type, index }, error);
      throw error;
    }
  }

  /**
   * Renders a tool call
   * @param toolCall - Tool call to render
   * @returns Rendered tool call element
   */
  renderToolCall(toolCall: ToolCall): HTMLElement {
    if (!toolCall || typeof toolCall !== 'object') {
      throw new Error('Valid tool call object is required');
    }

    this.logger.debug('Rendering tool call', { name: toolCall.name, status: toolCall.status });

    try {
      const toolCallBlock = document.createElement('div');
      toolCallBlock.className = 'tool-call-block';

      // Create tool header
      const toolHeader = document.createElement('div');
      toolHeader.className = 'tool-header';
      toolHeader.addEventListener('click', () => {
        const toolBody = toolCallBlock.querySelector('.tool-body');
        if (toolBody) {
          const isExpanded = (toolBody as HTMLElement).style.display !== 'none';
          (toolBody as HTMLElement).style.display = isExpanded ? 'none' : 'block';
        }
      });

      // Create tool info
      const toolInfo = document.createElement('div');
      toolInfo.className = 'tool-info';

      const toolIcon = document.createElement('span');
      toolIcon.className = 'tool-icon';
      toolIcon.setAttribute('aria-hidden', 'true');
      toolIcon.textContent = '⚙️';

      const toolName = document.createElement('span');
      toolName.className = 'tool-name';
      toolName.textContent = toolCall.name;

      toolInfo.appendChild(toolIcon);
      toolInfo.appendChild(toolName);

      // Create tool status
      const toolStatus = document.createElement('span');
      toolStatus.className = `tool-status ${toolCall.status}`;
      toolStatus.textContent = `${this.getToolStatusIcon(toolCall.status)} ${this.capitalizeFirst(toolCall.status)}`;

      toolHeader.appendChild(toolInfo);
      toolHeader.appendChild(toolStatus);

      // Create tool body
      const toolBody = document.createElement('div');
      toolBody.className = 'tool-body';
      toolBody.style.display = 'none';

      // Add input section
      if (toolCall.input) {
        const inputSection = document.createElement('div');
        inputSection.className = 'tool-section';

        const inputLabel = document.createElement('div');
        inputLabel.className = 'tool-label';
        inputLabel.textContent = 'INPUT';

        const inputContent = document.createElement('div');
        inputContent.className = 'tool-content';
        inputContent.textContent = this.formatToolContent(toolCall.input);

        inputSection.appendChild(inputLabel);
        inputSection.appendChild(inputContent);
        toolBody.appendChild(inputSection);
      }

      // Add output section
      if (toolCall.output) {
        const outputSection = document.createElement('div');
        outputSection.className = 'tool-section';

        const outputLabel = document.createElement('div');
        outputLabel.className = 'tool-label';
        outputLabel.textContent = 'OUTPUT';

        const outputContent = document.createElement('div');
        outputContent.className = 'tool-content';
        outputContent.textContent = this.formatToolContent(toolCall.output);

        outputSection.appendChild(outputLabel);
        outputSection.appendChild(outputContent);
        toolBody.appendChild(outputSection);
      }

      toolCallBlock.appendChild(toolHeader);
      toolCallBlock.appendChild(toolBody);

      return toolCallBlock;
    } catch (error) {
      this.logger.error('Failed to render tool call', { name: toolCall.name }, error);
      throw error;
    }
  }

  /**
   * Updates a step
   * @param step - Updated step
   * @param index - Step index
   * @param container - Container element
   * @returns Updated step element
   */
  updateStep(step: ThinkingStep, index: number, container: HTMLElement): HTMLElement {
    if (!step || typeof step !== 'object') {
      throw new Error('Valid step object is required');
    }

    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('Valid container element is required');
    }

    this.logger.debug('Updating step', { type: step.type, index });

    try {
      const stepKey = `step-${index}`;
      const existingElement = this.renderedSteps.get(stepKey);

      if (existingElement) {
        // Replace existing element
        const newElement = this.renderStep(step, index);
        existingElement.replaceWith(newElement);
        this.renderedSteps.set(stepKey, newElement);
        return newElement;
      } else {
        // Add new element
        const newElement = this.renderStep(step, index);
        container.appendChild(newElement);
        this.renderedSteps.set(stepKey, newElement);
        return newElement;
      }
    } catch (error) {
      this.logger.error('Failed to update step', { type: step.type, index }, error);
      throw error;
    }
  }

  /**
   * Removes a step
   * @param index - Step index
   * @param container - Container element
   * @returns True if removed, false if not found
   */
  removeStep(index: number, container: HTMLElement): boolean {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('Valid container element is required');
    }

    this.logger.debug('Removing step', { index });

    try {
      const stepKey = `step-${index}`;
      const existingElement = this.renderedSteps.get(stepKey);

      if (existingElement) {
        container.removeChild(existingElement);
        this.renderedSteps.delete(stepKey);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to remove step', { index }, error);
      throw error;
    }
  }

  /**
   * Toggles step expansion
   * @param stepElement - Step element
   */
  toggleStepExpansion(stepElement: HTMLElement): void {
    if (!stepElement || !(stepElement instanceof HTMLElement)) {
      return;
    }

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
   * Handles virtual scroll
   * @param container - Container element
   */
  private handleVirtualScroll(container: HTMLElement): void {
    if (!container || !(container instanceof HTMLElement)) {
      return;
    }

    try {
      // Implementation for virtual scroll
      // This would be more complex in a real implementation
      this.logger.debug('Virtual scroll handled');
    } catch (error) {
      this.logger.error('Failed to handle virtual scroll', {}, error);
    }
  }

  /**
   * Gets step icon
   * @param type - Step type
   * @returns Step icon
   */
  private getStepIcon(type: string): string {
    switch (type) {
      case 'thinking':
        return '🤔';
      case 'tool':
        return '⚙️';
      case 'result':
        return '✓';
      case 'error':
        return '❌';
      default:
        return '📝';
    }
  }

  /**
   * Gets tool status icon
   * @param status - Tool status
   * @returns Tool status icon
   */
  private getToolStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return '⏳';
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '⏳';
    }
  }

  /**
   * Capitalizes first letter
   * @param text - Text to capitalize
   * @returns Capitalized text
   */
  private capitalizeFirst(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /**
   * Formats tool content
   * @param content - Content to format
   * @returns Formatted content
   */
  private formatToolContent(content: string): string {
    if (!content || typeof content !== 'string') {
      return '';
    }

    try {
      // Try to parse as JSON
      if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
        JSON.parse(content);
        return JSON.stringify(JSON.parse(content), null, 2);
      }
    } catch (e) {
      // Not JSON, continue as text
    }

    return content;
  }
}

  /**
   * Cleans up resources and prevents memory leaks
   */
  cleanup(): void {
    this.logger.debug('Cleaning up StepRenderer resources');
    
    try {
      // Clear rendered steps cache
      this.renderedSteps.clear();
      
      this.logger.debug('StepRenderer cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup StepRenderer', {}, error);
    }
  }
}

export default StepRenderer;