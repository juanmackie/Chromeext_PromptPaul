// Type definitions for Chrome extension

// Chrome API types
declare global {
  interface Window {
    showLoading: (element: string | Element, message?: string) => string;
    hideLoading: (elementOrId: string | Element) => void;
    showToast: (message: string, type?: 'info' | 'success' | 'error' | 'warning', duration?: number, options?: any) => HTMLElement;
    showError: (element: string | Element, error: Error, options?: any) => HTMLElement;
    setButtonLoading: (button: string | Element, isLoading?: boolean) => void;
    marked: any;
    anthropicStreamFinalizedByStopEvent?: boolean;
  }
}

// Error handling types
export interface ErrorContext {
  timestamp?: string;
  userAgent?: string;
  url?: string;
  context?: Record<string, any>;
}

export interface FriendlyErrorMessage {
  title: string;
  message: string;
  type: 'network' | 'validation' | 'auth' | 'not_found' | 'rate_limit' | 'server' | 'unknown' | 'cancelled';
  suggestions: string[];
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryCondition?: (error: Error) => boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

export interface EnhancedError extends Error {
  timestamp: string;
  context?: Record<string, any>;
  originalError?: Error;
  status?: number;
  code?: string;
}

// Virtual scrolling types
export interface VirtualScrollOptions {
  itemHeight?: number;
  buffer?: number;
  renderItem?: (item: any, index: number) => HTMLElement | null;
  onScrollEnd?: () => void;
}

export interface MessagePaginatorOptions {
  pageSize?: number;
  maxPagesInMemory?: number;
  onLoadPage?: (pageNumber: number, pageSize: number) => Promise<{ items: any[]; totalCount?: number }>;
}

export interface MessageItem {
  id: string;
  sender: 'User' | 'System' | 'LLM';
  content: string;
  timestamp: string;
}

// Content extraction types
export interface ContentExtractionResult {
  url?: string[];
  email?: string[];
  codeBlock?: string[];
  inlineCode?: string[];
  mention?: string[];
  hashtag?: string[];
}

export interface ContentExtractorOptions {
  cacheSize?: number;
  patterns?: Record<string, RegExp>;
}

// API types
export interface ApiConfig {
  llmEndpoint: string;
  apiKey: string;
  modelName: string;
  maxTokens?: string;
  systemPrompt?: string;
  enableStreaming?: boolean;
}

export interface ApiRequest {
  model: string;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
  max_tokens?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: string | { type: string; function: { name: string } };
}

export interface ApiResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

// MCP types
export interface McpToolDefinition {
  name: string;
  description: string;
  parameters?: string;
  parametersForLlm?: Record<string, any>;
  source?: string;
  mcpServerUrl?: string;
  mcpAuthToken?: string;
}

export interface McpServerEntry {
  type: string;
  url: string;
  name: string;
  authorization_token?: string;
}

// Chrome extension types
export interface ChromeMessage {
  action: string;
  [key: string]: any;
}

export interface ContextMenuInfo {
  menuItemId: string;
  selectionText?: string;
  pageUrl?: string;
  frameUrl?: string;
}

export interface TabInfo {
  id?: number;
  url?: string;
  title?: string;
}

// Analytics types
export interface AnalyticsEvent {
  event: string;
  properties?: Record<string, any>;
  timestamp?: string;
  sessionId?: string;
}

export interface ErrorEvent extends AnalyticsEvent {
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    status?: number;
  };
  context?: Record<string, any>;
}