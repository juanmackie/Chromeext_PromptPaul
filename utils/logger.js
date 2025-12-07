const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Default to ERROR level in production, can be overridden via storage
let currentLogLevel = LOG_LEVELS.ERROR;

const logger = {
  debug: (component, ...args) => {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      console.debug(`[DEBUG][${component}]`, ...args);
    }
  },
  info: (component, ...args) => {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      console.info(`[INFO][${component}]`, ...args);
    }
  },
  warn: (component, ...args) => {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      console.warn(`[WARN][${component}]`, ...args);
    }
  },
  error: (component, ...args) => {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      console.error(`[ERROR][${component}]`, ...args);
    }
    // Also send to errorHandler for critical errors
  },
  setLevel: level => {
    if (typeof level === 'string') {
      currentLogLevel = LOG_LEVELS[level] || LOG_LEVELS.ERROR;
    } else if (typeof level === 'number') {
      currentLogLevel = level;
    }
  },
  getLevel: () => {
    return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLogLevel) || 'ERROR';
  },
};

// Initialize log level from storage
try {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['logLevel'], result => {
      if (result.logLevel) {
        currentLogLevel = LOG_LEVELS[result.logLevel] || LOG_LEVELS.ERROR;
      }
    });
  }
} catch (e) {
  // Chrome storage not available (e.g., during testing)
  console.warn('Logger: Chrome storage not available, using default log level');
}

// Listen for storage changes to update log level
try {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.logLevel) {
        currentLogLevel = LOG_LEVELS[changes.logLevel.newValue] || LOG_LEVELS.ERROR;
      }
    });
  }
} catch (e) {
  // Chrome storage not available (e.g., during testing)
  console.warn('Logger: Chrome storage listener not available');
}

export default logger;
