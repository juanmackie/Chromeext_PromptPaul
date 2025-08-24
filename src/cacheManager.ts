// cacheManager.ts - Advanced caching strategies for the Chrome extension
import type { ApiConfig, McpToolDefinition, ContentExtractionResult } from './types/index.js';

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  metadata?: Record<string, any>;
}

interface CacheConfig {
  defaultTtl: number;
  maxSize: number;
  compression: boolean;
  persistence: boolean;
  strategies: {
    lru: boolean;
    lfu: boolean;
    adaptive: boolean;
  };
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
  memoryUsage: number;
}

export class CacheManager {
  private cache = new Map<string, CacheEntry>();
  private accessOrder = new Map<string, number>(); // For LRU
  private accessFrequency = new Map<string, number>(); // For LFU
  private config: CacheConfig;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      defaultTtl: 5 * 60 * 1000, // 5 minutes
      maxSize: 100,
      compression: false,
      persistence: true,
      strategies: {
        lru: true,
        lfu: false,
        adaptive: false
      },
      ...config
    };

    this.loadPersistedCache();
    this.startCleanupInterval();
  }

  // Main cache operations
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    // Update access patterns
    this.updateAccessPatterns(key);

    this.stats.hits++;
    return entry.data as T;
  }

  async set<T>(
    key: string,
    data: T,
    ttl: number = this.config.defaultTtl,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Check if we need to evict
    if (this.cache.size >= this.config.maxSize) {
      this.evict();
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      metadata
    };

    // Compress if enabled
    if (this.config.compression) {
      entry.data = this.compressData(data) as T;
    }

    this.cache.set(key, entry);
    this.updateAccessPatterns(key);

    // Persist if enabled
    if (this.config.persistence) {
      this.persistCache();
    }

    this.stats.size = this.cache.size;
  }

  async delete(key: string): Promise<boolean> {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.accessOrder.delete(key);
      this.accessFrequency.delete(key);
      this.stats.size = this.cache.size;
      this.persistCache();
    }
    return deleted;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.accessOrder.clear();
    this.accessFrequency.clear();
    this.stats.size = 0;

    if (this.config.persistence) {
      chrome.storage.local.remove(['cacheManager']);
    }
  }

  // Advanced caching strategies
  private updateAccessPatterns(key: string): void {
    const now = Date.now();

    if (this.config.strategies.lru) {
      this.accessOrder.set(key, now);
    }

    if (this.config.strategies.lfu) {
      const currentFreq = this.accessFrequency.get(key) || 0;
      this.accessFrequency.set(key, currentFreq + 1);
    }

    if (this.config.strategies.adaptive) {
      // Adaptive strategy based on access patterns
      this.adaptiveEviction(key);
    }
  }

  private evict(): void {
    let keyToEvict: string | null = null;

    if (this.config.strategies.lfu) {
      // Evict least frequently used
      let minFreq = Infinity;
      for (const [key, freq] of this.accessFrequency.entries()) {
        if (freq < minFreq) {
          minFreq = freq;
          keyToEvict = key;
        }
      }
    } else {
      // Default to LRU
      let oldestAccess = Infinity;
      for (const [key, timestamp] of this.accessOrder.entries()) {
        if (timestamp < oldestAccess) {
          oldestAccess = timestamp;
          keyToEvict = key;
        }
      }
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
      this.accessOrder.delete(keyToEvict);
      this.accessFrequency.delete(keyToEvict);
      this.stats.evictions++;
    }
  }

  private adaptiveEviction(key: string): void {
    // Implement adaptive eviction based on usage patterns
    // This could consider factors like:
    // - Time since last access
    // - Access frequency
    // - Data size
    // - Computational cost to regenerate
    const entry = this.cache.get(key);
    if (!entry) return;

    const timeSinceAccess = Date.now() - (this.accessOrder.get(key) || 0);
    const accessFreq = this.accessFrequency.get(key) || 0;

    // Simple adaptive scoring
    const score = (accessFreq * 1000) / (timeSinceAccess + 1);

    if (score < 0.1 && this.cache.size >= this.config.maxSize) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.accessFrequency.delete(key);
      this.stats.evictions++;
    }
  }

  // Utility methods
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private compressData(data: any): string {
    // Simple compression - in a real implementation,
    // you might use a library like lz-string
    return JSON.stringify(data);
  }

  private decompressData(compressedData: string): any {
    return JSON.parse(compressedData);
  }

  // Persistence
  private async persistCache(): Promise<void> {
    try {
      const cacheData = {
        entries: Array.from(this.cache.entries()),
        accessOrder: Array.from(this.accessOrder.entries()),
        accessFrequency: Array.from(this.accessFrequency.entries()),
        timestamp: Date.now()
      };

      await chrome.storage.local.set({ cacheManager: cacheData });
    } catch (error) {
      console.warn('Failed to persist cache:', error);
    }
  }

  private async loadPersistedCache(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['cacheManager']);
      const cacheData = result.cacheManager;

      if (cacheData && cacheData.entries) {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        // Only load if cache is less than 24 hours old
        if (now - cacheData.timestamp < maxAge) {
          this.cache = new Map(cacheData.entries);
          this.accessOrder = new Map(cacheData.accessOrder);
          this.accessFrequency = new Map(cacheData.accessFrequency);

          // Remove expired entries
          for (const [key, entry] of this.cache.entries()) {
            if (this.isExpired(entry)) {
              this.cache.delete(key);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load persisted cache:', error);
    }
  }

  // Cleanup and maintenance
  private startCleanupInterval(): void {
    // Clean up expired entries every 5 minutes
    setInterval(() => {
      this.cleanupExpired();
    }, 5 * 60 * 1000);
  }

  private cleanupExpired(): void {
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.accessFrequency.delete(key);
    });

    if (keysToDelete.length > 0) {
      this.stats.evictions += keysToDelete.length;
      this.persistCache();
    }
  }

  // Statistics and monitoring
  getStats(): CacheStats {
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
    const memoryUsage = JSON.stringify([...this.cache.entries()]).length;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      size: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100,
      memoryUsage
    };
  }

  // Cache warming
  async warmCache(keys: string[]): Promise<void> {
    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry && !this.isExpired(entry)) {
        this.updateAccessPatterns(key);
      }
    }
  }

  // Cache preloading
  async preloadCache(data: Record<string, any>, ttl?: number): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.set(key, value, ttl);
    }
  }
}

// Specialized cache for API responses
export class ApiCache extends CacheManager {
  constructor() {
    super({
      defaultTtl: 10 * 60 * 1000, // 10 minutes for API responses
      maxSize: 50,
      strategies: {
        lru: true,
        lfu: true,
        adaptive: true
      }
    });
  }

  async getApiResponse(endpoint: string, params: Record<string, any>): Promise<any> {
    const key = this.generateApiKey(endpoint, params);
    return this.get(key);
  }

  async setApiResponse(
    endpoint: string,
    params: Record<string, any>,
    response: any,
    ttl?: number
  ): Promise<void> {
    const key = this.generateApiKey(endpoint, params);
    await this.set(key, response, ttl, { endpoint, params });
  }

  private generateApiKey(endpoint: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((result, key) => {
        result[key] = params[key];
        return result;
      }, {} as Record<string, any>);

    return `api:${endpoint}:${JSON.stringify(sortedParams)}`;
  }
}

// Cache for MCP tool definitions
export class McpToolCache extends CacheManager {
  constructor() {
    super({
      defaultTtl: 30 * 60 * 1000, // 30 minutes for tool definitions
      maxSize: 200,
      strategies: {
        lru: true,
        lfu: false,
        adaptive: false
      }
    });
  }

  async getToolDefinition(serverUrl: string, toolName: string): Promise<any> {
    const key = `mcp:tool:${serverUrl}:${toolName}`;
    return this.get(key);
  }

  async setToolDefinition(
    serverUrl: string,
    toolName: string,
    definition: any
  ): Promise<void> {
    const key = `mcp:tool:${serverUrl}:${toolName}`;
    await this.set(key, definition, undefined, { serverUrl, toolName });
  }

  async getServerTools(serverUrl: string): Promise<McpToolDefinition[]> {
    const key = `mcp:server:${serverUrl}`;
    return this.get(key);
  }

  async setServerTools(serverUrl: string, tools: McpToolDefinition[]): Promise<void> {
    const key = `mcp:server:${serverUrl}`;
    await this.set(key, tools, undefined, { serverUrl });
  }
}

// Content extraction cache
export class ContentExtractionCache extends CacheManager {
  constructor() {
    super({
      defaultTtl: 60 * 60 * 1000, // 1 hour for content extraction
      maxSize: 100,
      compression: true,
      strategies: {
        lru: true,
        lfu: false,
        adaptive: false
      }
    });
  }

  async getExtraction(content: string, types: string[]): Promise<ContentExtractionResult> {
    const key = `extract:${this.hashContent(content)}:${types.sort().join(',')}`;
    return this.get(key);
  }

  async setExtraction(
    content: string,
    types: string[],
    result: ContentExtractionResult
  ): Promise<void> {
    const key = `extract:${this.hashContent(content)}:${types.sort().join(',')}`;
    await this.set(key, result, undefined, { contentLength: content.length, types });
  }

  private hashContent(content: string): string {
    // Simple hash function - in production, use a proper hashing library
    let hash = 0;
    for (let i = 0; i < Math.min(content.length, 100); i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

// Global cache instances
export const apiCache = new ApiCache();
export const mcpToolCache = new McpToolCache();
export const contentExtractionCache = new ContentExtractionCache();

// Cache manager for general use
export const cacheManager = new CacheManager();

// Cache warming utilities
export async function warmCaches(): Promise<void> {
  // Warm API cache with frequently used endpoints
  await apiCache.warmCache([
    'api:config:get',
    'api:tools:list'
  ]);

  // Warm MCP tool cache with common server URLs
  await mcpToolCache.warmCache([
    'mcp:server:common_tools'
  ]);

  console.log('Caches warmed successfully');
}

// Cache performance monitoring
export function getCachePerformanceStats() {
  return {
    apiCache: apiCache.getStats(),
    mcpToolCache: mcpToolCache.getStats(),
    contentExtractionCache: contentExtractionCache.getStats(),
    generalCache: cacheManager.getStats()
  };
}

// Cache maintenance
export async function cleanupCaches(): Promise<void> {
  await Promise.all([
    apiCache.clear(),
    mcpToolCache.clear(),
    contentExtractionCache.clear(),
    cacheManager.clear()
  ]);

  console.log('All caches cleared');
}