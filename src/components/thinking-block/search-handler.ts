/**
 * Search Handler
 * Handles search functionality for thinking blocks
 * Implements production-ready coding rules for search handling
 *
 * Core Principles:
 * - Input Validation: Validate all search data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient search with proper indexing
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

interface SearchResult {
  step: ThinkingStep;
  stepIndex: number;
  matches: SearchMatch[];
}

interface SearchMatch {
  type: 'title' | 'description' | 'toolName' | 'toolInput' | 'toolOutput';
  text: string;
  startIndex: number;
  endIndex: number;
}

class SearchHandler {
  private logger: any;
  private searchIndex: Map<string, number[]> = new Map();
  private steps: ThinkingStep[] = [];
  private isCaseSensitive: boolean = false;
  private isRegexEnabled: boolean = false;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Initializes the search handler
   * @param steps - Array of thinking steps
   * @param options - Search options
   */
  initialize(steps: ThinkingStep[], options: {
    caseSensitive?: boolean;
    regexEnabled?: boolean;
  } = {}): void {
    if (!steps || !Array.isArray(steps)) {
      throw new Error('Valid steps array is required');
    }

    this.logger.debug('Initializing search handler', { stepCount: steps.length });

    try {
      this.steps = steps;
      this.isCaseSensitive = options.caseSensitive || false;
      this.isRegexEnabled = options.regexEnabled || false;

      // Build search index
      this.buildSearchIndex();

      this.logger.debug('Search handler initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize search handler', {}, error);
      throw error;
    }
  }

  /**
   * Searches for text in steps
   * @param query - Search query
   * @returns Array of search results
   */
  search(query: string): SearchResult[] {
    if (!query || typeof query !== 'string') {
      throw new Error('Valid search query is required and must be a string');
    }

    this.logger.debug('Searching for text', { query, caseSensitive: this.isCaseSensitive, regexEnabled: this.isRegexEnabled });

    try {
      const results: SearchResult[] = [];

      // Process query
      const processedQuery = this.processQuery(query);
      if (!processedQuery) {
        return results;
      }

      // Search in steps
      this.steps.forEach((step, index) => {
        const matches = this.searchInStep(step, processedQuery);
        if (matches.length > 0) {
          results.push({
            step,
            stepIndex: index,
            matches
          });
        }
      });

      this.logger.debug('Search completed', { query, resultCount: results.length });

      return results;
    } catch (error) {
      this.logger.error('Failed to search', { query }, error);
      throw error;
    }
  }

  /**
   * Highlights search results in a step element
   * @param stepElement - Step element to highlight
   * @param matches - Search matches
   * @returns Highlighted step element
   */
  highlightSearchResults(stepElement: HTMLElement, matches: SearchMatch[]): HTMLElement {
    if (!stepElement || !(stepElement instanceof HTMLElement)) {
      throw new Error('Valid step element is required');
    }

    if (!matches || !Array.isArray(matches)) {
      return stepElement;
    }

    this.logger.debug('Highlighting search results', { matchCount: matches.length });

    try {
      // Create a clone to avoid modifying the original
      const highlightedElement = stepElement.cloneNode(true) as HTMLElement;

      // Highlight title matches
      const titleElement = highlightedElement.querySelector('.step-title');
      if (titleElement) {
        const titleMatches = matches.filter(match => match.type === 'title');
        if (titleMatches.length > 0) {
          titleElement.innerHTML = this.highlightText(titleElement.textContent || '', titleMatches);
        }
      }

      // Highlight description matches
      const descriptionElement = highlightedElement.querySelector('.step-description');
      if (descriptionElement) {
        const descriptionMatches = matches.filter(match => match.type === 'description');
        if (descriptionMatches.length > 0) {
          descriptionElement.innerHTML = this.highlightText(descriptionElement.textContent || '', descriptionMatches);
        }
      }

      // Highlight tool name matches
      const toolNameElement = highlightedElement.querySelector('.tool-name');
      if (toolNameElement) {
        const toolNameMatches = matches.filter(match => match.type === 'toolName');
        if (toolNameMatches.length > 0) {
          toolNameElement.innerHTML = this.highlightText(toolNameElement.textContent || '', toolNameMatches);
        }
      }

      // Highlight tool input matches
      const toolInputElements = highlightedElement.querySelectorAll('.tool-input');
      if (toolInputElements.length > 0) {
        const toolInputMatches = matches.filter(match => match.type === 'toolInput');
        if (toolInputMatches.length > 0) {
          toolInputElements.forEach(element => {
            element.innerHTML = this.highlightText(element.textContent || '', toolInputMatches);
          });
        }
      }

      // Highlight tool output matches
      const toolOutputElements = highlightedElement.querySelectorAll('.tool-output');
      if (toolOutputElements.length > 0) {
        const toolOutputMatches = matches.filter(match => match.type === 'toolOutput');
        if (toolOutputMatches.length > 0) {
          toolOutputElements.forEach(element => {
            element.innerHTML = this.highlightText(element.textContent || '', toolOutputMatches);
          });
        }
      }

      return highlightedElement;
    } catch (error) {
      this.logger.error('Failed to highlight search results', {}, error);
      throw error;
    }
  }

  /**
   * Clears search highlights
   * @param stepElement - Step element to clear highlights from
   * @returns Step element with highlights cleared
   */
  clearSearchHighlights(stepElement: HTMLElement): HTMLElement {
    if (!stepElement || !(stepElement instanceof HTMLElement)) {
      throw new Error('Valid step element is required');
    }

    this.logger.debug('Clearing search highlights');

    try {
      // Create a clone to avoid modifying the original
      const clearedElement = stepElement.cloneNode(true) as HTMLElement;

      // Remove highlight elements
      const highlights = clearedElement.querySelectorAll('.search-highlight');
      highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight);
          parent.normalize();
        }
      });

      return clearedElement;
    } catch (error) {
      this.logger.error('Failed to clear search highlights', {}, error);
      throw error;
    }
  }

  /**
   * Sets search options
   * @param options - Search options
   */
  setSearchOptions(options: {
    caseSensitive?: boolean;
    regexEnabled?: boolean;
  }): void {
    if (!options || typeof options !== 'object') {
      throw new Error('Valid options object is required');
    }

    this.logger.debug('Setting search options', options);

    try {
      if (options.caseSensitive !== undefined) {
        this.isCaseSensitive = options.caseSensitive;
      }

      if (options.regexEnabled !== undefined) {
        this.isRegexEnabled = options.regexEnabled;
      }

      // Rebuild search index with new options
      this.buildSearchIndex();

      this.logger.debug('Search options set successfully');
    } catch (error) {
      this.logger.error('Failed to set search options', {}, error);
      throw error;
    }
  }

  /**
   * Builds search index
   */
  private buildSearchIndex(): void {
    this.logger.debug('Building search index');

    try {
      this.searchIndex.clear();

      this.steps.forEach((step, index) => {
        // Index title
        this.indexText(step.title.toLowerCase(), index);

        // Index description
        this.indexText(step.description.toLowerCase(), index);

        // Index tool call
        if (step.toolCall) {
          // Index tool name
          this.indexText(step.toolCall.name.toLowerCase(), index);

          // Index tool input
          this.indexText(step.toolCall.input.toLowerCase(), index);

          // Index tool output
          this.indexText(step.toolCall.output.toLowerCase(), index);
        }
      });

      this.logger.debug('Search index built successfully');
    } catch (error) {
      this.logger.error('Failed to build search index', {}, error);
      throw error;
    }
  }

  /**
   * Indexes text for search
   * @param text - Text to index
   * @param stepIndex - Step index
   */
  private indexText(text: string, stepIndex: number): void {
    if (!text || typeof text !== 'string') {
      return;
    }

    try {
      const words = text.split(/\s+/);
      words.forEach(word => {
        if (word.length > 2) { // Only index words longer than 2 characters
          if (!this.searchIndex.has(word)) {
            this.searchIndex.set(word, []);
          }
          this.searchIndex.get(word)!.push(stepIndex);
        }
      });
    } catch (error) {
      this.logger.error('Failed to index text', {}, error);
    }
  }

  /**
   * Processes search query
   * @param query - Search query
   * @returns Processed query
   */
  private processQuery(query: string): string | RegExp | null {
    if (!query || typeof query !== 'string') {
      return null;
    }

    try {
      let processedQuery = query.trim();

      if (!this.isCaseSensitive) {
        processedQuery = processedQuery.toLowerCase();
      }

      if (this.isRegexEnabled) {
        try {
          return new RegExp(processedQuery, this.isCaseSensitive ? 'g' : 'gi');
        } catch (e) {
          this.logger.warn('Invalid regex query, falling back to text search', { query: processedQuery });
          return processedQuery;
        }
      }

      return processedQuery;
    } catch (error) {
      this.logger.error('Failed to process query', { query }, error);
      return null;
    }
  }

  /**
   * Searches in a step
   * @param step - Step to search in
   * @param query - Processed query
   * @returns Array of search matches
   */
  private searchInStep(step: ThinkingStep, query: string | RegExp): SearchMatch[] {
    const matches: SearchMatch[] = [];

    try {
      // Search in title
      const titleMatches = this.searchInText(step.title, query, 'title');
      matches.push(...titleMatches);

      // Search in description
      const descriptionMatches = this.searchInText(step.description, query, 'description');
      matches.push(...descriptionMatches);

      // Search in tool call
      if (step.toolCall) {
        // Search in tool name
        const toolNameMatches = this.searchInText(step.toolCall.name, query, 'toolName');
        matches.push(...toolNameMatches);

        // Search in tool input
        const toolInputMatches = this.searchInText(step.toolCall.input, query, 'toolInput');
        matches.push(...toolInputMatches);

        // Search in tool output
        const toolOutputMatches = this.searchInText(step.toolCall.output, query, 'toolOutput');
        matches.push(...toolOutputMatches);
      }
    } catch (error) {
      this.logger.error('Failed to search in step', {}, error);
    }

    return matches;
  }

  /**
   * Searches in text
   * @param text - Text to search in
   * @param query - Processed query
   * @param type - Match type
   * @returns Array of search matches
   */
  private searchInText(text: string, query: string | RegExp, type: string): SearchMatch[] {
    const matches: SearchMatch[] = [];

    if (!text || typeof text !== 'string') {
      return matches;
    }

    try {
      const searchText = this.isCaseSensitive ? text : text.toLowerCase();

      if (query instanceof RegExp) {
        let match;
        while ((match = query.exec(searchText)) !== null) {
          matches.push({
            type: type as any,
            text: searchText.substring(match.index, match.index + match[0].length),
            startIndex: match.index,
            endIndex: match.index + match[0].length
          });
        }
      } else {
        let index = searchText.indexOf(query as string);
        while (index !== -1) {
          matches.push({
            type: type as any,
            text: searchText.substring(index, index + (query as string).length),
            startIndex: index,
            endIndex: index + (query as string).length
          });
          index = searchText.indexOf(query as string, index + 1);
        }
      }
    } catch (error) {
      this.logger.error('Failed to search in text', {}, error);
    }

    return matches;
  }

  /**
   * Highlights text with matches
   * @param text - Text to highlight
   * @param matches - Search matches
   * @returns Highlighted HTML
   */
  private highlightText(text: string, matches: SearchMatch[]): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    if (!matches || matches.length === 0) {
      return this.escapeHtml(text);
    }

    try {
      // Sort matches by start index
      const sortedMatches = [...matches].sort((a, b) => a.startIndex - b.startIndex);

      let highlightedText = '';
      let lastIndex = 0;

      sortedMatches.forEach(match => {
        // Add text before match
        highlightedText += this.escapeHtml(text.substring(lastIndex, match.startIndex));

        // Add highlighted match
        highlightedText += `<span class="search-highlight">${this.escapeHtml(match.text)}</span>`;

        lastIndex = match.endIndex;
      });

      // Add remaining text
      highlightedText += this.escapeHtml(text.substring(lastIndex));

      return highlightedText;
    } catch (error) {
      this.logger.error('Failed to highlight text', {}, error);
      return this.escapeHtml(text);
    }
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
}

  /**
   * Cleans up resources and prevents memory leaks
   */
  cleanup(): void {
    this.logger.debug('Cleaning up SearchHandler resources');
    
    try {
      // Clear search index
      this.searchIndex.clear();
      this.steps = [];
      
      this.logger.debug('SearchHandler cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup SearchHandler', {}, error);
    }
  }
}

export default SearchHandler;