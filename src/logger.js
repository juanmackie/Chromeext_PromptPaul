// ===== Logger Module - Centralized logging system =====
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

let currentLogLevel = LOG_LEVELS.INFO; // Default to INFO level

// Get stored log level from Chrome storage
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['logLevel'], (result) => {
    if (result.logLevel !== undefined) {
      currentLogLevel = result.logLevel;
    }
  });
}

function setLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    currentLogLevel = LOG_LEVELS[level];
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ logLevel: currentLogLevel });
    }
  }
}

function log(level, ...args) {
  if (LOG_LEVELS[level] <= currentLogLevel) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;

    switch (level) {
      case 'ERROR':
        console.error(prefix, ...args);
        break;
      case 'WARN':
        console.warn(prefix, ...args);
        break;
      case 'INFO':
        console.info(prefix, ...args);
        break;
      case 'DEBUG':
        console.debug(prefix, ...args);
        break;
    }
  }
}

export const logger = {
  error: (...args) => log('ERROR', ...args),
  warn: (...args) => log('WARN', ...args),
  info: (...args) => log('INFO', ...args),
  debug: (...args) => log('DEBUG', ...args),
  setLevel: setLogLevel,
  getLevel: () => currentLogLevel
};