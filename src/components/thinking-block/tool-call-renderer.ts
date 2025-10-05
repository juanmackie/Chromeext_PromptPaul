/**
 * Tool Call Renderer
 * Handles rendering of tool calls
 * Implements production-ready coding rules for tool call rendering
 *
 * Core Principles:
 * - Input Validation: Validate all tool call data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient rendering with proper DOM management
 */

import { logger } from '../../shared/index.js';

interface ToolCall {
  name: string;
  input: string;
  output: string;
  status: 'running' | 'success' | 'error';
}

class ToolCallRenderer {
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Renders a tool call
   * @param toolCall - Tool call to render
   * @param expanded - Whether tool call should be expanded
   * @returns Rendered tool call element
   */
  renderToolCall(toolCall: ToolCall, expanded: boolean = false): HTMLElement {
    if (!toolCall || typeof toolCall !== 'object') {
      throw new Error('Valid tool call object is required');
    }

    this.logger.debug('Rendering tool call', { name: toolCall.name, status: toolCall.status });

    try {
      const toolCallBlock = document.createElement('div');
      toolCallBlock.className = 'tool-call-block';

      // Create tool header
      const toolHeader = this.createToolHeader(toolCall);
      toolCallBlock.appendChild(toolHeader);

      // Create tool body
      const toolBody = this.createToolBody(toolCall, expanded);
      toolCallBlock.appendChild(toolBody);

      // Add click handler to toggle expansion
      toolHeader.addEventListener('click', () => {
        const isExpanded = toolBody.style.display !== 'none';
        toolBody.style.display = isExpanded ? 'none' : 'block';
      });

      return toolCallBlock;
    } catch (error) {
      this.logger.error('Failed to render tool call', { name: toolCall.name }, error);
      throw error;
    }
  }

  /**
   * Creates a tool header
   * @param toolCall - Tool call
   * @returns Tool header element
   */
  private createToolHeader(toolCall: ToolCall): HTMLElement {
    const toolHeader = document.createElement('div');
    toolHeader.className = 'tool-header';
    toolHeader.setAttribute('role', 'button');
    toolHeader.setAttribute('tabindex', '0');
    toolHeader.setAttribute('aria-expanded', 'false');
    toolHeader.setAttribute('aria-label', `Tool call: ${toolCall.name}, Status: ${toolCall.status}`);

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

    // Add keyboard navigation
    toolHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const toolBody = toolHeader.nextElementSibling as HTMLElement;
        if (toolBody) {
          const isExpanded = toolBody.style.display !== 'none';
          toolBody.style.display = isExpanded ? 'none' : 'block';
          toolHeader.setAttribute('aria-expanded', (!isExpanded).toString());
        }
      }
    });

    return toolHeader;
  }

  /**
   * Creates a tool body
   * @param toolCall - Tool call
   * @param expanded - Whether body should be expanded
   * @returns Tool body element
   */
  private createToolBody(toolCall: ToolCall, expanded: boolean): HTMLElement {
    const toolBody = document.createElement('div');
    toolBody.className = 'tool-body';
    toolBody.style.display = expanded ? 'block' : 'none';
    toolBody.setAttribute('role', 'region');
    toolBody.setAttribute('aria-label', `Tool call details for ${toolCall.name}`);

    // Add input section
    if (toolCall.input) {
      const inputSection = this.createToolSection('INPUT', toolCall.input, 'tool-input');
      toolBody.appendChild(inputSection);
    }

    // Add output section
    if (toolCall.output) {
      const outputSection = this.createToolSection('OUTPUT', toolCall.output, 'tool-output');
      toolBody.appendChild(outputSection);
    }

    // If no input or output, add empty state
    if (!toolCall.input && !toolCall.output) {
      const emptySection = document.createElement('div');
      emptySection.className = 'tool-section';
      emptySection.textContent = 'No input or output data available';
      toolBody.appendChild(emptySection);
    }

    return toolBody;
  }

  /**
   * Creates a tool section
   * @param label - Section label
   * @param content - Section content
   * @param className - CSS class name
   * @returns Tool section element
   */
  private createToolSection(label: string, content: string, className: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tool-section';

    const labelElement = document.createElement('div');
    labelElement.className = 'tool-label';
    labelElement.textContent = label;

    const contentElement = document.createElement('div');
    contentElement.className = `tool-content ${className}`;

    // Check if content is JSON
    const isJson = this.isJsonContent(content);
    if (isJson) {
      contentElement.classList.add('json');
    }

    // Format content
    const formattedContent = this.formatToolContent(content, isJson);
    
    if (isJson) {
      // Use pre for JSON content
      const preElement = document.createElement('pre');
      preElement.textContent = formattedContent;
      contentElement.appendChild(preElement);
    } else {
      contentElement.textContent = formattedContent;
    }

    section.appendChild(labelElement);
    section.appendChild(contentElement);

    return section;
  }

  /**
   * Updates a tool call
   * @param toolCallElement - Tool call element to update
   * @param toolCall - Updated tool call data
   * @returns Updated tool call element
   */
  updateToolCall(toolCallElement: HTMLElement, toolCall: ToolCall): HTMLElement {
    if (!toolCallElement || !(toolCallElement instanceof HTMLElement)) {
      throw new Error('Valid tool call element is required');
    }

    if (!toolCall || typeof toolCall !== 'object') {
      throw new Error('Valid tool call object is required');
    }

    this.logger.debug('Updating tool call', { name: toolCall.name, status: toolCall.status });

    try {
      // Update tool name
      const toolNameElement = toolCallElement.querySelector('.tool-name');
      if (toolNameElement) {
        toolNameElement.textContent = toolCall.name;
      }

      // Update tool status
      const toolStatusElement = toolCallElement.querySelector('.tool-status');
      if (toolStatusElement) {
        toolStatusElement.className = `tool-status ${toolCall.status}`;
        toolStatusElement.textContent = `${this.getToolStatusIcon(toolCall.status)} ${this.capitalizeFirst(toolCall.status)}`;
      }

      // Update tool body
      const toolBodyElement = toolCallElement.querySelector('.tool-body');
      if (toolBodyElement) {
        // Clear existing content
        toolBodyElement.innerHTML = '';

        // Add input section
        if (toolCall.input) {
          const inputSection = this.createToolSection('INPUT', toolCall.input, 'tool-input');
          toolBodyElement.appendChild(inputSection);
        }

        // Add output section
        if (toolCall.output) {
          const outputSection = this.createToolSection('OUTPUT', toolCall.output, 'tool-output');
          toolBodyElement.appendChild(outputSection);
        }

        // If no input or output, add empty state
        if (!toolCall.input && !toolCall.output) {
          const emptySection = document.createElement('div');
          emptySection.className = 'tool-section';
          emptySection.textContent = 'No input or output data available';
          toolBodyElement.appendChild(emptySection);
        }
      }

      return toolCallElement;
    } catch (error) {
      this.logger.error('Failed to update tool call', { name: toolCall.name }, error);
      throw error;
    }
  }

  /**
   * Toggles tool call expansion
   * @param toolCallElement - Tool call element
   * @returns True if expanded, false if collapsed
   */
  toggleToolCallExpansion(toolCallElement: HTMLElement): boolean {
    if (!toolCallElement || !(toolCallElement instanceof HTMLElement)) {
      return false;
    }

    try {
      const toolBody = toolCallElement.querySelector('.tool-body') as HTMLElement;
      const toolHeader = toolCallElement.querySelector('.tool-header') as HTMLElement;

      if (toolBody && toolHeader) {
        const isExpanded = toolBody.style.display !== 'none';
        toolBody.style.display = isExpanded ? 'none' : 'block';
        toolHeader.setAttribute('aria-expanded', (!isExpanded).toString());
        return !isExpanded;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to toggle tool call expansion', {}, error);
      return false;
    }
  }

  /**
   * Expands a tool call
   * @param toolCallElement - Tool call element
   * @returns True if expanded, false if already expanded
   */
  expandToolCall(toolCallElement: HTMLElement): boolean {
    if (!toolCallElement || !(toolCallElement instanceof HTMLElement)) {
      return false;
    }

    try {
      const toolBody = toolCallElement.querySelector('.tool-body') as HTMLElement;
      const toolHeader = toolCallElement.querySelector('.tool-header') as HTMLElement;

      if (toolBody && toolHeader) {
        if (toolBody.style.display === 'none') {
          toolBody.style.display = 'block';
          toolHeader.setAttribute('aria-expanded', 'true');
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to expand tool call', {}, error);
      return false;
    }
  }

  /**
   * Collapses a tool call
   * @param toolCallElement - Tool call element
   * @returns True if collapsed, false if already collapsed
   */
  collapseToolCall(toolCallElement: HTMLElement): boolean {
    if (!toolCallElement || !(toolCallElement instanceof HTMLElement)) {
      return false;
    }

    try {
      const toolBody = toolCallElement.querySelector('.tool-body') as HTMLElement;
      const toolHeader = toolCallElement.querySelector('.tool-header') as HTMLElement;

      if (toolBody && toolHeader) {
        if (toolBody.style.display !== 'none') {
          toolBody.style.display = 'none';
          toolHeader.setAttribute('aria-expanded', 'false');
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to collapse tool call', {}, error);
      return false;
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
   * Checks if content is JSON
   * @param content - Content to check
   * @returns True if content is JSON
   */
  private isJsonContent(content: string): boolean {
    if (!content || typeof content !== 'string') {
      return false;
    }

    const trimmed = content.trim();
    return (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    );
  }

  /**
   * Formats tool content
   * @param content - Content to format
   * @param isJson - Whether content is JSON
   * @returns Formatted content
   */
  private formatToolContent(content: string, isJson: boolean): string {
    if (!content || typeof content !== 'string') {
      return '';
    }

    if (isJson) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch (e) {
        return content;
      }
    }

    return content;
  }
}

export default ToolCallRenderer;