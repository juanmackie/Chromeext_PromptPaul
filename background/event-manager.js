/**
 * Event Manager
 * Handles event listener lifecycle and message tracking
 */

export class EventManager {
  constructor() {
    // Event listener management for proper cleanup
    this.listeners = new Map();

    // Message tracking for race condition protection
    this.activeMessages = new Map();
    this.messageCounter = 0;

    // Tool execution tracking
    this.activeToolExecutions = new Map();

    // Initialize cleanup alarms
    this.initializeEventListenerCleanupAlarm();
    this.initializeMessageCleanupAlarm();
    this.initializeToolExecutionCleanupAlarm();
  }

  // === Message Tracker Methods ===

  // Generate unique message ID
  generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Register a new message
  registerMessage(request, sender) {
    const messageId = this.generateMessageId();
    const messageInfo = {
      id: messageId,
      action: request.action,
      sender: sender.tab?.id || 'unknown',
      timestamp: Date.now(),
      responseSent: false,
    };

    this.activeMessages.set(messageId, messageInfo);
    return messageId;
  }

  // Mark message as responded
  markMessageResponded(messageId) {
    const messageInfo = this.activeMessages.get(messageId);
    if (messageInfo) {
      messageInfo.responseSent = true;
      messageInfo.responseTimestamp = Date.now();
    }
  }

  // Check if message was responded
  wasMessageResponded(messageId) {
    const messageInfo = this.activeMessages.get(messageId);
    return messageInfo?.responseSent || false;
  }

  // Cleanup old messages (older than 30 seconds)
  cleanupMessages() {
    const now = Date.now();
    const timeout = 30000; // 30 seconds

    for (const [messageId, messageInfo] of this.activeMessages) {
      if (now - messageInfo.timestamp > timeout) {
        this.activeMessages.delete(messageId);
      }
    }
  }

  // Get active message count
  getActiveMessageCount() {
    return this.activeMessages.size;
  }

  // Get detailed message status
  getMessageStatus() {
    const now = Date.now();
    return {
      total: this.activeMessages.size,
      pending: Array.from(this.activeMessages.values()).filter(m => !m.responseSent).length,
      oldest: Math.min(...Array.from(this.activeMessages.values()).map(m => now - m.timestamp)),
    };
  }

  // === Event Listener Manager Methods ===

  // Register an event listener with tracking
  registerListener(eventTarget, eventType, listener, options = {}) {
    const listenerId = `${eventTarget.constructor.name}-${eventType}-${Date.now()}`;

    const trackedListener = {
      id: listenerId,
      original: listener,
      wrapped: (...args) => {
        try {
          return listener(...args);
        } catch (error) {
          logger.error(
            'BackgroundEventManager',
            `EventManager: Error in ${eventType} listener:`,
            error
          );
        }
      },
    };

    eventTarget.addListener(trackedListener.wrapped, options);

    this.listeners.set(listenerId, {
      eventTarget,
      eventType,
      listener: trackedListener.original,
      wrapped: trackedListener.wrapped,
      options,
      registered: Date.now(),
    });

    return listenerId;
  }

  // Remove a specific listener
  removeListener(listenerId) {
    const listenerInfo = this.listeners.get(listenerId);
    if (listenerInfo) {
      try {
        listenerInfo.eventTarget.removeListener(listenerInfo.wrapped);
        this.listeners.delete(listenerId);
        return true;
      } catch (error) {
        logger.error(
          'BackgroundEventManager',
          `EventManager: Error removing listener ${listenerId}:`,
          error
        );
      }
    }
    return false;
  }

  // Clean up old listeners (older than 1 hour)
  cleanupListeners() {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    let cleanedCount = 0;

    for (const [listenerId, listenerInfo] of this.listeners) {
      if (now - listenerInfo.registered > maxAge) {
        if (this.removeListener(listenerId)) {
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      logger.info('BackgroundEventManager', `EventManager: Cleaned ${cleanedCount} old listeners`);
    }
  }

  // Get event listener status report
  getListenerStatus() {
    const listeners = Array.from(this.listeners.entries()).map(([id, info]) => ({
      id,
      target: info.eventTarget.constructor.name,
      event: info.eventType,
      age: Date.now() - info.registered,
    }));

    return {
      total: listeners.length,
      byTarget: listeners.reduce((acc, { target }) => {
        acc[target] = (acc[target] || 0) + 1;
        return acc;
      }, {}),
      oldestAge: Math.max(...listeners.map(l => l.age)),
      listeners,
    };
  }

  // Remove all listeners (for service worker shutdown)
  removeAllListeners() {
    let removedCount = 0;
    for (const [listenerId] of this.listeners) {
      if (this.removeListener(listenerId)) {
        removedCount++;
      }
    }
    return removedCount;
  }

  // === Tool Execution Tracking Methods ===

  // Track tool execution
  trackToolExecution(toolId, toolInfo) {
    this.activeToolExecutions.set(toolId, {
      ...toolInfo,
      startTime: Date.now(),
    });
  }

  // Complete tool execution
  completeToolExecution(toolId, result) {
    const execution = this.activeToolExecutions.get(toolId);
    if (execution) {
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.result = result;
      this.activeToolExecutions.delete(toolId);
    }
  }

  // Clean up stale tool executions
  cleanupToolExecutions() {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes
    let cleanedCount = 0;

    for (const [toolId, execution] of this.activeToolExecutions) {
      if (now - execution.startTime > timeout) {
        logger.warn(
          'BackgroundEventManager',
          `EventManager: Cleaning up stale tool execution: ${toolId}`
        );
        this.activeToolExecutions.delete(toolId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  // Get tool execution status
  getToolExecutionStatus() {
    const executions = Array.from(this.activeToolExecutions.entries()).map(([id, info]) => ({
      id,
      ...info,
      age: Date.now() - info.startTime,
    }));

    return {
      active: executions.length,
      executions,
    };
  }

  // === Alarm Initialization Methods ===

  // Initialize event listener cleanup alarm
  initializeEventListenerCleanupAlarm() {
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === 'eventListenerCleanup') {
        try {
          this.cleanupListeners();
        } catch (error) {
          logger.error(
            'BackgroundEventManager',
            'EventManager: Error during listener cleanup:',
            error
          );
        }
      }
    });

    chrome.alarms.create('eventListenerCleanup', {
      delayInMinutes: 30,
      periodInMinutes: 30,
    });
  }

  // Initialize message cleanup alarm
  initializeMessageCleanupAlarm() {
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === 'messageCleanup') {
        try {
          this.cleanupMessages();
        } catch (error) {
          logger.error(
            'BackgroundEventManager',
            'EventManager: Error during message cleanup:',
            error
          );
        }
      }
    });

    chrome.alarms.create('messageCleanup', {
      delayInMinutes: 1,
      periodInMinutes: 1,
    });
  }

  // Initialize tool execution cleanup alarm
  initializeToolExecutionCleanupAlarm() {
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === 'toolExecutionCleanup') {
        try {
          const cleanedCount = this.cleanupToolExecutions();
          if (cleanedCount > 0) {
            logger.info(
              'BackgroundEventManager',
              `EventManager: Cleaned ${cleanedCount} stale tool executions`
            );
          }
        } catch (error) {
          logger.error(
            'BackgroundEventManager',
            'EventManager: Error during tool execution cleanup:',
            error
          );
        }
      }
    });

    chrome.alarms.create('toolExecutionCleanup', {
      delayInMinutes: 5,
      periodInMinutes: 5,
    });
  }

  // === Comprehensive Report ===

  // Get comprehensive status report
  getReport() {
    return {
      messages: this.getMessageStatus(),
      listeners: this.getListenerStatus(),
      toolExecutions: this.getToolExecutionStatus(),
    };
  }
}

// Export singleton instance
export const eventManager = new EventManager();
