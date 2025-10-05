/**
 * Dependency Injection Container
 * Implements production-ready coding rules for dependency management
 *
 * Core Principles:
 * - Dependency Injection: Use interfaces, not implementations
 * - Loose Coupling: Depend on abstractions, not implementations
 * - Testability: Design for testability with dependency injection
 * - Single Responsibility: Each service has one clear responsibility
 */

import { logger } from './logger.js';

class DependencyContainer {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
    this.factories = new Map();
    this.interfaces = new Map();
  }

  /**
   * Registers a service interface
   * @param {string} name - Interface name
   * @param {Object} definition - Interface definition with methods
   */
  registerInterface(name, definition) {
    this.interfaces.set(name, definition);
    logger.debug(`Registered interface: ${name}`);
  }

  /**
   * Registers a service implementation
   * @param {string} name - Service name
   * @param {Function} implementation - Service implementation
   * @param {Array} dependencies - Array of dependency names
   * @param {Object} options - Registration options
   */
  register(name, implementation, dependencies = [], options = {}) {
    const serviceInfo = {
      implementation,
      dependencies,
      singleton: options.singleton || false,
      interface: options.interface || null
    };

    this.services.set(name, serviceInfo);
    logger.debug(`Registered service: ${name}`, {
      dependencies,
      singleton: serviceInfo.singleton,
      interface: serviceInfo.interface
    });
  }

  /**
   * Registers a factory function for service creation
   * @param {string} name - Service name
   * @param {Function} factory - Factory function
   */
  registerFactory(name, factory) {
    this.factories.set(name, factory);
    logger.debug(`Registered factory: ${name}`);
  }

  /**
   * Resolves a service instance
   * @param {string} name - Service name
   * @returns {any} Service instance
   */
  resolve(name) {
    // Check if it's a factory
    if (this.factories.has(name)) {
      return this.factories.get(name)(this);
    }

    // Check if service exists
    if (!this.services.has(name)) {
      throw new Error(`Service not registered: ${name}`);
    }

    const serviceInfo = this.services.get(name);

    // Return singleton if already created
    if (serviceInfo.singleton && this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    // Resolve dependencies
    const resolvedDependencies = {};
    for (const dep of serviceInfo.dependencies) {
      resolvedDependencies[dep] = this.resolve(dep);
    }

    // Create service instance
    const instance = new serviceInfo.implementation(resolvedDependencies);

    // Store singleton if applicable
    if (serviceInfo.singleton) {
      this.singletons.set(name, instance);
    }

    // Validate against interface if specified
    if (serviceInfo.interface) {
      this.validateInterface(instance, serviceInfo.interface);
    }

    logger.debug(`Resolved service: ${name}`);
    return instance;
  }

  /**
   * Validates that an instance implements an interface
   * @param {any} instance - Service instance
   * @param {string} interfaceName - Interface name
   */
  validateInterface(instance, interfaceName) {
    const interfaceDef = this.interfaces.get(interfaceName);
    if (!interfaceDef) {
      throw new Error(`Interface not registered: ${interfaceName}`);
    }

    for (const method of interfaceDef.methods) {
      if (typeof instance[method] !== 'function') {
        throw new Error(`Service does not implement interface method: ${method}`);
      }
    }
  }

  /**
   * Creates a proxy that lazily resolves dependencies
   * @param {string} serviceName - Service name
   * @returns {Proxy} Lazy proxy
   */
  lazy(serviceName) {
    return new Proxy({}, {
      get: (target, prop) => {
        const service = this.resolve(serviceName);
        return service[prop];
      }
    });
  }

  /**
   * Checks if a service is registered
   * @param {string} name - Service name
   * @returns {boolean} True if registered
   */
  has(name) {
    return this.services.has(name) || this.factories.has(name);
  }

  /**
   * Clears all registrations (mainly for testing)
   */
  clear() {
    this.services.clear();
    this.singletons.clear();
    this.factories.clear();
    this.interfaces.clear();
    logger.debug('Dependency container cleared');
  }

  /**
   * Gets information about registered services
   * @returns {Object} Service information
   */
  getServiceInfo() {
    const info = {
      services: [],
      singletons: this.singletons.size,
      factories: this.factories.size,
      interfaces: this.interfaces.size
    };

    for (const [name, serviceInfo] of this.services) {
      info.services.push({
        name,
        dependencies: serviceInfo.dependencies,
        singleton: serviceInfo.singleton,
        interface: serviceInfo.interface,
        isInstantiated: serviceInfo.singleton && this.singletons.has(name)
      });
    }

    return info;
  }
}

// Common interfaces for the application
const CommonInterfaces = {
  // API client interface
  ApiClient: {
    methods: ['request', 'streamRequest', 'validateConfig']
  },

  // Storage interface
  Storage: {
    methods: ['get', 'set', 'remove', 'clear']
  },

  // Logger interface
  Logger: {
    methods: ['debug', 'info', 'warn', 'error', 'fatal']
  },

  // Error handler interface
  ErrorHandler: {
    methods: ['createError', 'handleApiError', 'handleNetworkError', 'handleConfigError']
  },

  // Validator interface
  Validator: {
    methods: ['validate', 'validateSchema', 'sanitizeString', 'sanitizeUrl']
  },

  // Message renderer interface
  MessageRenderer: {
    methods: ['renderMessage', 'updateMessage', 'clearMessages']
  },

  // Analytics service interface
  AnalyticsService: {
    methods: ['trackEvent', 'trackError', 'trackUsage']
  },

  // Context menu service interface
  ContextMenuService: {
    methods: ['createMenu', 'updateMenu', 'removeMenu']
  },

  // Tool execution service interface
  ToolExecutionService: {
    methods: ['executeTool', 'getToolDefinition', 'validateToolCall']
  }
};

// Create and configure the container
const container = new DependencyContainer();

// Register common interfaces
for (const [name, definition] of Object.entries(CommonInterfaces)) {
  container.registerInterface(name, definition);
}

// Register shared services as singletons
import { errorHandler } from './error-handler.js';
import { validators } from './validators.js';

container.register('ErrorHandler', () => errorHandler, [], { singleton: true });
container.register('Logger', () => logger, [], { singleton: true });
container.register('Validator', () => validators, [], { singleton: true });

// Browser extension storage service
container.register('Storage', (dependencies) => {
  return {
    async get(keys) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
      });
    },

    async set(items) {
      return new Promise((resolve) => {
        chrome.storage.local.set(items, () => resolve());
      });
    },

    async remove(keys) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keys, () => resolve());
      });
    },

    async clear() {
      return new Promise((resolve) => {
        chrome.storage.local.clear(() => resolve());
      });
    }
  };
}, [], { singleton: true, interface: 'Storage' });

export { container, CommonInterfaces };
export default container;