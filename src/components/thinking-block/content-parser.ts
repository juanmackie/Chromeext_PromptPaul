/**
 * Content Parser
 * Handles parsing of thinking block content
 * Implements production-ready coding rules for content parsing
 *
 * Core Principles:
 * - Input Validation: Validate all content data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient parsing with proper caching
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

class ContentParser {
  private logger: any;
  private parseCache: Map<string, ThinkingStep[]> = new Map();
  private maxCacheSize: number = 100;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Parses thinking content into structured steps
   * @param thought - Thinking content to parse
   * @returns Array of thinking steps
   */
  parseThinkingContent(thought: string): ThinkingStep[] {
    if (!thought || typeof thought !== 'string') {
      throw new Error('Valid thinking content is required and must be a string');
    }

    this.logger.debug('Parsing thinking content', { contentLength: thought.length });

    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(thought);
      if (this.parseCache.has(cacheKey)) {
        this.logger.debug('Using cached parse result');
        return [...this.parseCache.get(cacheKey)!];
      }

      const steps: ThinkingStep[] = [];

      if (!thought.trim()) {
        return steps;
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
            steps.push(currentStep);
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
          currentToolCall = currentStep.toolCall || null;
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
            steps.push(currentStep);
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
              steps.push(currentStep);
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
        steps.push(currentStep);
      }

      // If no structured steps were found, create intelligent chunks
      if (steps.length === 0) {
        const chunkedSteps = this.createIntelligentChunks(thought);
        steps.push(...chunkedSteps);
      }

      // Process tool calls for better display
      this.processToolCalls(steps);

      // Cache result
      this.cacheParseResult(cacheKey, steps);

      this.logger.debug('Thinking content parsed successfully', { stepCount: steps.length });

      return steps;
    } catch (error) {
      this.logger.error('Failed to parse thinking content', {}, error);

      // Fallback to raw thinking
      return [{
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
   * @returns Array of thinking steps
   */
  createIntelligentChunks(thought: string): ThinkingStep[] {
    const steps: ThinkingStep[] = [];

    if (!thought || !thought.trim()) {
      return steps;
    }

    try {
      const sentences = thought.split(/[.!?]+/).filter(s => s.trim());
      const chunkSize = 3; // sentences per chunk

      for (let i = 0; i < sentences.length; i += chunkSize) {
        const chunk = sentences.slice(i, i + chunkSize).join('. ').trim();
        if (chunk) {
          steps.push({
            type: 'thinking',
            title: this.truncateText(chunk, 80),
            description: chunk + (i + chunkSize < sentences.length ? '.' : ''),
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to create intelligent chunks', {}, error);
    }

    return steps;
  }

  /**
   * Processes tool calls for better display
   * @param steps - Array of thinking steps
   */
  processToolCalls(steps: ThinkingStep[]): void {
    if (!steps || !Array.isArray(steps)) {
      return;
    }

    try {
      steps.forEach(step => {
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
    } catch (error) {
      this.logger.error('Failed to process tool calls', {}, error);
    }
  }

  /**
   * Parses content segments
   * @param content - Content to parse
   * @returns Array of content segments
   */
  parseContentSegments(content: string): ContentSegment[] {
    if (!content || typeof content !== 'string') {
      throw new Error('Valid content is required and must be a string');
    }

    this.logger.debug('Parsing content segments', { contentLength: content.length });
    this.logger.debug('Content preview (first 200 chars):', { preview: content.substring(0, 200) });

    // Parse thinking tags - support <thinking></thinking>, ◁think▷◁/think▷, and ◁think▷◁/thinking▷ formats
    // Improved regex pattern with better matching and fallback handling
    const thinkingRegex = /(?:<thinking>([\s\S]*?)<\/thinking>|(◁think▷[\s\S]*?◁\/think▷)|(◁think▷[\s\S]*?◁\/thinking▷))/g;
    this.logger.debug('Using regex pattern:', { pattern: thinkingRegex.source });

    let matchCount = 0;

    try {
      const segments: ContentSegment[] = [];

      if (!content.trim()) {
        return segments;
      }

      let lastIndex = 0;
      let match;

      while ((match = thinkingRegex.exec(content)) !== null) {
        matchCount++;
        this.logger.debug(`Match ${matchCount} found:`, {
          index: match.index,
          fullMatch: match[0],
          group1: match[1],
          group2: match[2],
          groups: match.slice(1)
        });

        // Add text before thinking tag
        if (match.index > lastIndex) {
          const textContent = content.substring(lastIndex, match.index);
          if (textContent.trim()) {
            segments.push({
              type: 'text',
              content: textContent.trim()
            });
            this.logger.debug('Added text segment:', { content: textContent.trim() });
          }
        }

        // Add thinking content - match[1] is for <thinking> tags, match[2] and match[3] are for ◁think▷ tags
        let thinkingContent = '';
        if (match[1]) {
          // <thinking> tags
          thinkingContent = match[1].trim();
        } else if (match[2]) {
          // ◁think▷◁/think▷ tags
          thinkingContent = match[2].trim();
        } else if (match[3]) {
          // ◁think▷◁/thinking▷ tags
          thinkingContent = match[3].trim();
        }

        this.logger.debug('Extracted thinking content:', {
          thinkingContentLength: thinkingContent.length,
          thinkingContentPreview: thinkingContent.substring(0, 100),
          matchGroups: [match[1], match[2], match[3]]
        });

        segments.push({
          type: 'thinking',
          content: thinkingContent
        });

        lastIndex = match.index + match[0].length;
        this.logger.debug('Updated lastIndex:', { lastIndex, contentLength: content.length });
      }

      // Add remaining text
      if (lastIndex < content.length) {
        const textContent = content.substring(lastIndex);
        if (textContent.trim()) {
          segments.push({
            type: 'text',
            content: textContent.trim()
          });
        }
      }

      // If no thinking tags found, treat entire content as text
      if (segments.length === 0) {
        this.logger.debug('No thinking tags found, treating entire content as text');
        segments.push({
          type: 'text',
          content: content.trim()
        });
      } else {
        this.logger.debug('Thinking tags processed successfully, checking for unprocessed content...');

        // Check if there's any content after the last thinking tag that should be treated as answer
        if (lastIndex < content.length) {
          const remainingContent = content.substring(lastIndex).trim();
          if (remainingContent) {
            this.logger.debug('Found remaining content after thinking tags:', {
              remainingLength: remainingContent.length,
              remainingPreview: remainingContent.substring(0, 100)
            });
            segments.push({
              type: 'text',
              content: remainingContent
            });
          }
        }
      }

       this.logger.debug('Content segments parsed successfully', {
         segmentCount: segments.length,
         matchCount: matchCount,
         segments: segments.map(s => ({ type: s.type, contentLength: s.content.length }))
       });

       return segments;
     } catch (error) {
       this.logger.error('Failed to parse content segments', {
         contentLength: content.length,
         matchCount: matchCount,
         error: error instanceof Error ? error.message : String(error)
       }, error);

      // Fallback to text segment
      return [{
        type: 'text',
        content: content.trim()
      }];
    }
  }

  /**
   * Generates a cache key
   * @param content - Content to generate key for
   * @returns Cache key
   */
  private generateCacheKey(content: string): string {
    // Simple hash function for cache key
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Caches parse result
   * @param key - Cache key
   * @param steps - Parse result
   */
  private cacheParseResult(key: string, steps: ThinkingStep[]): void {
    try {
      // If cache is full, remove oldest entry
      if (this.parseCache.size >= this.maxCacheSize) {
        const firstKey = this.parseCache.keys().next().value;
        if (firstKey) {
          this.parseCache.delete(firstKey);
        }
      }

      this.parseCache.set(key, [...steps]);
    } catch (error) {
      this.logger.error('Failed to cache parse result', {}, error);
    }
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
   * Cleans up resources and prevents memory leaks
   */
  cleanup(): void {
    this.logger.debug('Cleaning up ContentParser resources');
    
    try {
      // Clear cache
      this.parseCache.clear();
      
      this.logger.debug('ContentParser cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup ContentParser', {}, error);
    }
  }
}

export default ContentParser;