/**
 * Memory Manager
 * Adaptive memory cleanup utility with intelligent thresholds
 */

import logger from '../utils/logger.js';

export class MemoryManager {
  constructor() {
    // Track all collections for cleanup
    this.collections = new Map();
    this.memoryHistory = [];
    this.maxHistorySize = 10;

    // Memory pressure indicators
    this.thresholds = {
      low: 25, // Start gentle cleanup at 25 items
      medium: 50, // Aggressive cleanup at 50 items
      high: 100, // Force cleanup at 100 items
      critical: 200, // Emergency cleanup at 200 items
    };

    // Initialize chrome.alarms for service worker-compatible memory cleanup
    this.initializeMemoryCleanupAlarm();
  }

  // Register a collection for monitoring
  register(name, collection) {
    this.collections.set(name, {
      collection,
      type: collection.constructor.name,
      size: () => collection.size || 0,
      clear: () => {
        if (typeof collection.clear === 'function') {
          collection.clear();
        }
      },
      // Track individual collection stats
      stats: {
        lastCleanup: Date.now(),
        cleanupCount: 0,
        maxSize: 0,
        avgSize: 0,
      },
    });
  }

  // Calculate adaptive cleanup threshold based on memory pressure
  calculateThreshold(collectionName, currentSize, collectionStats) {
    const timeSinceLastCleanup = Date.now() - collectionStats.lastCleanup;
    const growthRate =
      (currentSize - collectionStats.avgSize) / Math.max(1, timeSinceLastCleanup / 60000); // items per minute

    // Adaptive threshold based on growth rate and time since cleanup
    let baseThreshold = this.thresholds.medium;

    if (growthRate > 10) {
      // Fast growing
      baseThreshold = this.thresholds.low;
    } else if (growthRate < 1 && timeSinceLastCleanup > 300000) {
      // Slow growing, old
      baseThreshold = this.thresholds.high;
    }

    return Math.min(baseThreshold, Math.max(this.thresholds.low, collectionStats.maxSize * 0.8));
  }

  // Intelligent cleanup with adaptive thresholds
  cleanup() {
    const totalSize = this.getTotalSize();
    const memoryPressure = this.assessMemoryPressure(totalSize);

    logger.info(
      'BackgroundMemoryManager',
      `MemoryManager: Starting cleanup (total: ${totalSize}, pressure: ${memoryPressure})`
    );

    for (const [name, { collection, size, clear, stats }] of this.collections) {
      const currentSize = size();

      // Update stats
      stats.maxSize = Math.max(stats.maxSize, currentSize);
      stats.avgSize = (stats.avgSize * stats.cleanupCount + currentSize) / (stats.cleanupCount + 1);

      // Calculate adaptive threshold
      const threshold = this.calculateThreshold(name, currentSize, stats);

      if (currentSize > threshold) {
        logger.info(
          'BackgroundMemoryManager',
          `MemoryManager: Cleaning up ${name} (${currentSize} items, threshold: ${threshold}, pressure: ${memoryPressure})`
        );

        // Different cleanup strategies based on pressure
        if (memoryPressure === 'critical') {
          // Emergency: clear everything
          clear();
        } else if (memoryPressure === 'high') {
          // Aggressive: clear 75% of items
          this.partialClear(collection, 0.75);
        } else {
          // Normal: clear 50% or keep threshold amount
          this.adaptiveClear(collection, threshold);
        }

        stats.lastCleanup = Date.now();
        stats.cleanupCount++;
      }
    }

    this.updateMemoryHistory(totalSize);
  }

  // Get total size across all collections
  getTotalSize() {
    let total = 0;
    for (const { size } of this.collections.values()) {
      total += size();
    }
    return total;
  }

  // Assess memory pressure level
  assessMemoryPressure(totalSize) {
    if (totalSize > this.thresholds.critical) return 'critical';
    if (totalSize > this.thresholds.high) return 'high';
    if (totalSize > this.thresholds.medium) return 'medium';
    if (totalSize > this.thresholds.low) return 'low';
    return 'normal';
  }

  // Update memory usage history for trend analysis
  updateMemoryHistory(totalSize) {
    this.memoryHistory.push({
      size: totalSize,
      timestamp: Date.now(),
    });

    if (this.memoryHistory.length > this.maxHistorySize) {
      this.memoryHistory.shift();
    }
  }

  // Partial clear for aggressive cleanup
  partialClear(collection, percentage) {
    if (collection instanceof Set) {
      const items = Array.from(collection);
      const keepCount = Math.floor(items.length * (1 - percentage));
      collection.clear();
      items.slice(0, keepCount).forEach(item => collection.add(item));
    } else if (collection instanceof Map) {
      const items = Array.from(collection.entries());
      const keepCount = Math.floor(items.length * (1 - percentage));
      collection.clear();
      items.slice(0, keepCount).forEach(([key, value]) => collection.set(key, value));
    }
  }

  // Adaptive clear to maintain threshold
  adaptiveClear(collection, threshold) {
    const currentSize = collection.size;
    if (currentSize <= threshold) return;

    if (collection instanceof Set) {
      const items = Array.from(collection);
      collection.clear();
      items.slice(-threshold).forEach(item => collection.add(item)); // Keep most recent items
    } else if (collection instanceof Map) {
      const items = Array.from(collection.entries());
      collection.clear();
      items.slice(-threshold).forEach(([key, value]) => collection.set(key, value)); // Keep most recent items
    }
  }

  // Get comprehensive memory report
  getReport() {
    const totalSize = this.getTotalSize();
    const memoryPressure = this.assessMemoryPressure(totalSize);

    const report = {
      totalSize,
      memoryPressure,
      collections: {},
      trends: this.getTrends(),
      thresholds: this.thresholds,
    };

    for (const [name, { type, size, stats }] of this.collections) {
      report.collections[name] = {
        type,
        size: size(),
        maxHistoricalSize: stats.maxSize,
        averageSize: Math.round(stats.avgSize),
        cleanupCount: stats.cleanupCount,
        lastCleanup: new Date(stats.lastCleanup).toISOString(),
      };
    }

    return report;
  }

  // Analyze memory usage trends
  getTrends() {
    if (this.memoryHistory.length < 2) return null;

    const recent = this.memoryHistory.slice(-5);
    const trend = recent[recent.length - 1].size - recent[0].size;
    const timeSpan = recent[recent.length - 1].timestamp - recent[0].timestamp;
    const rate = trend / (timeSpan / 60000); // items per minute

    return {
      direction: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
      rate: Math.round(rate * 100) / 100,
      timeSpan: Math.round(timeSpan / 1000), // seconds
    };
  }

  // Initialize chrome.alarms for service worker-compatible memory cleanup
  initializeMemoryCleanupAlarm() {
    // Clear any existing alarm first
    chrome.alarms.clear('memoryCleanup', () => {
      // Create new periodic alarm for memory cleanup
      chrome.alarms.create('memoryCleanup', {
        delayInMinutes: 5,
        periodInMinutes: 5,
      });
      logger.info('BackgroundMemoryManager', 'MemoryManager: Memory cleanup alarm initialized');
    });

    // Set up alarm listener for memory cleanup
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === 'memoryCleanup') {
        try {
          logger.info('BackgroundMemoryManager', 'MemoryManager: Running scheduled memory cleanup');
          this.cleanup();
        } catch (error) {
          logger.error(
            'BackgroundMemoryManager',
            'MemoryManager: Error during automatic cleanup:',
            error
          );
        }
      }
    });
  }

  // Enhanced cleanup function with memory management
  enhancedCollectionCleanup(collection, collectionName) {
    const originalSize = collection.size;
    collection.clear();
    logger.info(
      'BackgroundMemoryManager',
      `MemoryManager: Cleaned ${collectionName} (${originalSize} items)`
    );
  }
}

// Export singleton instance
export const memoryManager = new MemoryManager();
