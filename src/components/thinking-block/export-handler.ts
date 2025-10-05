/**
 * Export Handler
 * Handles export functionality for thinking blocks
 * Implements production-ready coding rules for export handling
 *
 * Core Principles:
 * - Input Validation: Validate all export data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient export with proper formatting
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

interface ExportOptions {
  format: 'json' | 'markdown' | 'text' | 'csv';
  includeTimestamps?: boolean;
  includeToolCalls?: boolean;
  includeMetadata?: boolean;
}

interface ExportData {
  steps: ThinkingStep[];
  content: string;
  thinking: string;
  answer: string;
  tokens: number;
  timestamp: string;
}

class ExportHandler {
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Exports thinking block data
   * @param data - Data to export
   * @param options - Export options
   * @returns Exported data
   */
  export(data: ExportData, options: ExportOptions): string {
    if (!data || typeof data !== 'object') {
      throw new Error('Valid data object is required');
    }

    if (!options || typeof options !== 'object') {
      throw new Error('Valid options object is required');
    }

    if (!options.format || typeof options.format !== 'string') {
      throw new Error('Valid format is required and must be a string');
    }

    this.logger.debug('Exporting thinking block data', { format: options.format });

    try {
      let exportedData: string;

      switch (options.format) {
        case 'json':
          exportedData = this.exportAsJson(data, options);
          break;
        case 'markdown':
          exportedData = this.exportAsMarkdown(data, options);
          break;
        case 'text':
          exportedData = this.exportAsText(data, options);
          break;
        case 'csv':
          exportedData = this.exportAsCsv(data, options);
          break;
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

      this.logger.debug('Thinking block data exported successfully', { format: options.format });

      return exportedData;
    } catch (error) {
      this.logger.error('Failed to export thinking block data', { format: options.format }, error);
      throw error;
    }
  }

  /**
   * Downloads exported data
   * @param data - Data to download
   * @param filename - Filename
   * @param format - File format
   */
  download(data: string, filename: string, format: string): void {
    if (!data || typeof data !== 'string') {
      throw new Error('Valid data is required and must be a string');
    }

    if (!filename || typeof filename !== 'string') {
      throw new Error('Valid filename is required and must be a string');
    }

    if (!format || typeof format !== 'string') {
      throw new Error('Valid format is required and must be a string');
    }

    this.logger.debug('Downloading exported data', { filename, format });

    try {
      // Create blob
      const mimeType = this.getMimeType(format);
      const blob = new Blob([data], { type: mimeType });

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.logger.debug('Exported data downloaded successfully', { filename, format });
    } catch (error) {
      this.logger.error('Failed to download exported data', { filename, format }, error);
      throw error;
    }
  }

  /**
   * Exports data as JSON
   * @param data - Data to export
   * @param options - Export options
   * @returns JSON string
   */
  private exportAsJson(data: ExportData, options: ExportOptions): string {
    const includeTimestamps = options.includeTimestamps !== false;
    const includeToolCalls = options.includeToolCalls !== false;
    const includeMetadata = options.includeMetadata !== false;

    const exportData: any = {
      steps: data.steps.map(step => {
        const stepData: any = {
          type: step.type,
          title: step.title,
          description: step.description
        };

        if (includeTimestamps && step.timestamp) {
          stepData.timestamp = step.timestamp;
        }

        if (includeToolCalls && step.toolCall) {
          stepData.toolCall = step.toolCall;
        }

        return stepData;
      })
    };

    if (includeMetadata) {
      exportData.content = data.content;
      exportData.thinking = data.thinking;
      exportData.answer = data.answer;
      exportData.tokens = data.tokens;
      exportData.timestamp = data.timestamp;
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Exports data as Markdown
   * @param data - Data to export
   * @param options - Export options
   * @returns Markdown string
   */
  private exportAsMarkdown(data: ExportData, options: ExportOptions): string {
    const includeTimestamps = options.includeTimestamps !== false;
    const includeToolCalls = options.includeToolCalls !== false;
    const includeMetadata = options.includeMetadata !== false;

    let markdown = '';

    // Add metadata
    if (includeMetadata) {
      markdown += '# Thinking Block\n\n';
      markdown += `**Timestamp:** ${data.timestamp}\n\n`;
      markdown += `**Tokens:** ${data.tokens}\n\n`;

      if (data.content) {
        markdown += '## Content\n\n';
        markdown += `${data.content}\n\n`;
      }

      if (data.thinking) {
        markdown += '## Thinking\n\n';
        markdown += `${data.thinking}\n\n`;
      }

      if (data.answer) {
        markdown += '## Answer\n\n';
        markdown += `${data.answer}\n\n`;
      }

      markdown += '## Steps\n\n';
    }

    // Add steps
    data.steps.forEach((step, index) => {
      markdown += `### ${index + 1}. ${step.title}\n\n`;
      markdown += `${step.description}\n\n`;

      if (includeTimestamps && step.timestamp) {
        markdown += `**Timestamp:** ${step.timestamp}\n\n`;
      }

      if (includeToolCalls && step.toolCall) {
        markdown += '#### Tool Call\n\n';
        markdown += `**Name:** ${step.toolCall.name}\n\n`;
        markdown += `**Status:** ${step.toolCall.status}\n\n`;

        if (step.toolCall.input) {
          markdown += '**Input:**\n\n';
          markdown += '```\n';
          markdown += `${step.toolCall.input}\n`;
          markdown += '```\n\n';
        }

        if (step.toolCall.output) {
          markdown += '**Output:**\n\n';
          markdown += '```\n';
          markdown += `${step.toolCall.output}\n`;
          markdown += '```\n\n';
        }
      }
    });

    return markdown;
  }

  /**
   * Exports data as plain text
   * @param data - Data to export
   * @param options - Export options
   * @returns Text string
   */
  private exportAsText(data: ExportData, options: ExportOptions): string {
    const includeTimestamps = options.includeTimestamps !== false;
    const includeToolCalls = options.includeToolCalls !== false;
    const includeMetadata = options.includeMetadata !== false;

    let text = '';

    // Add metadata
    if (includeMetadata) {
      text += 'Thinking Block\n';
      text += '=============\n\n';
      text += `Timestamp: ${data.timestamp}\n`;
      text += `Tokens: ${data.tokens}\n\n`;

      if (data.content) {
        text += 'Content:\n';
        text += '-------\n';
        text += `${data.content}\n\n`;
      }

      if (data.thinking) {
        text += 'Thinking:\n';
        text += '---------\n';
        text += `${data.thinking}\n\n`;
      }

      if (data.answer) {
        text += 'Answer:\n';
        text += '------\n';
        text += `${data.answer}\n\n`;
      }

      text += 'Steps:\n';
      text += '-----\n\n';
    }

    // Add steps
    data.steps.forEach((step, index) => {
      text += `${index + 1}. ${step.title}\n`;
      text += `${step.description}\n\n`;

      if (includeTimestamps && step.timestamp) {
        text += `Timestamp: ${step.timestamp}\n\n`;
      }

      if (includeToolCalls && step.toolCall) {
        text += 'Tool Call:\n';
        text += `Name: ${step.toolCall.name}\n`;
        text += `Status: ${step.toolCall.status}\n\n`;

        if (step.toolCall.input) {
          text += 'Input:\n';
          text += `${step.toolCall.input}\n\n`;
        }

        if (step.toolCall.output) {
          text += 'Output:\n';
          text += `${step.toolCall.output}\n\n`;
        }
      }
    });

    return text;
  }

  /**
   * Exports data as CSV
   * @param data - Data to export
   * @param options - Export options
   * @returns CSV string
   */
  private exportAsCsv(data: ExportData, options: ExportOptions): string {
    const includeTimestamps = options.includeTimestamps !== false;
    const includeToolCalls = options.includeToolCalls !== false;

    // Create CSV header
    let csv = 'Index,Type,Title,Description';

    if (includeTimestamps) {
      csv += ',Timestamp';
    }

    if (includeToolCalls) {
      csv += ',Tool Name,Tool Status,Tool Input,Tool Output';
    }

    csv += '\n';

    // Add steps
    data.steps.forEach((step, index) => {
      // Escape CSV fields
      const indexField = index.toString();
      const typeField = this.escapeCsvField(step.type);
      const titleField = this.escapeCsvField(step.title);
      const descriptionField = this.escapeCsvField(step.description);

      csv += `${indexField},${typeField},${titleField},${descriptionField}`;

      if (includeTimestamps) {
        const timestampField = this.escapeCsvField(step.timestamp || '');
        csv += `,${timestampField}`;
      }

      if (includeToolCalls && step.toolCall) {
        const toolNameField = this.escapeCsvField(step.toolCall.name);
        const toolStatusField = this.escapeCsvField(step.toolCall.status);
        const toolInputField = this.escapeCsvField(step.toolCall.input);
        const toolOutputField = this.escapeCsvField(step.toolCall.output);

        csv += `,${toolNameField},${toolStatusField},${toolInputField},${toolOutputField}`;
      } else if (includeToolCalls) {
        csv += ',,,,';
      }

      csv += '\n';
    });

    return csv;
  }

  /**
   * Gets MIME type for format
   * @param format - File format
   * @returns MIME type
   */
  private getMimeType(format: string): string {
    switch (format) {
      case 'json':
        return 'application/json';
      case 'markdown':
        return 'text/markdown';
      case 'text':
        return 'text/plain';
      case 'csv':
        return 'text/csv';
      default:
        return 'text/plain';
    }
  }

  /**
   * Escapes CSV field
   * @param field - Field to escape
   * @returns Escaped field
   */
  private escapeCsvField(field: string): string {
    if (!field || typeof field !== 'string') {
      return '';
    }

    // If field contains comma, newline, or quotes, wrap in quotes and escape quotes
    if (field.includes(',') || field.includes('\n') || field.includes('"')) {
      return `"${field.replace(/"/g, '""')}"`;
    }

    return field;
  }

  /**
   * Creates export filename
   * @param format - File format
   * @param timestamp - Timestamp
   * @returns Filename
   */
  createFilename(format: string, timestamp?: string): string {
    const now = timestamp || new Date().toISOString();
    const date = now.split('T')[0]; // Get date part
    const time = now.split('T')[1].split('.')[0].replace(/:/g, '-'); // Get time part and replace colons

    return `thinking-block-${date}-${time}`;
  }

  /**
   * Copies exported data to clipboard with fallback support
   * @param data - Data to copy
   * @returns Promise that resolves when data is copied
   */
  async copyToClipboard(data: string): Promise<void> {
    if (!data || typeof data !== 'string') {
      throw new Error('Valid data is required and must be a string');
    }

    this.logger.debug('Copying exported data to clipboard');

    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.permissions) {
        const permission = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName });
        if (permission.state === 'granted' || permission.state === 'prompt') {
          await navigator.clipboard.writeText(data);
          this.logger.debug('Exported data copied to clipboard successfully');
          return;
        }
      }

      // Fallback for browsers that support clipboard API without permissions
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(data);
        this.logger.debug('Exported data copied to clipboard successfully');
        return;
      }

      // Final fallback using document execCommand
      await this.fallbackCopyToClipboard(data);
      this.logger.debug('Exported data copied to clipboard using fallback method');

    } catch (error) {
      this.logger.error('Failed to copy exported data to clipboard', {}, error);
      
      // Try fallback method as last resort
      try {
        await this.fallbackCopyToClipboard(data);
        this.logger.debug('Exported data copied to clipboard using fallback method after error');
      } catch (fallbackError) {
        this.logger.error('All clipboard copy methods failed', {}, fallbackError);
        throw new Error('Failed to copy to clipboard: ' + fallbackError.message);
      }
    }
  }

  /**
   * Fallback clipboard copy method using execCommand
   * @param data - Data to copy
   * @returns Promise that resolves when data is copied
   */
  private async fallbackCopyToClipboard(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = data;
        textarea.style.position = 'fixed';
        textarea.style.left = '-999999px';
        textarea.style.top = '-999999px';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        textarea.setAttribute('readonly', '');
        
        document.body.appendChild(textarea);
        
        // Select the text
        textarea.select();
        textarea.setSelectionRange(0, data.length);
        
        // Execute copy command
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (successful) {
          resolve();
        } else {
          reject(new Error('execCommand copy failed'));
        }
      } catch (error) {
        reject(error);
      }
    });
  }
}

export default ExportHandler;