/**
 * Mock implementation for analytics.js
 * Provides comprehensive analytics functionality for testing
 */

const mockAnalytics = {
  // Core tracking functions
  track: jest.fn((event, properties = {}) => {
    console.log(`[Analytics] Track: ${event}`, properties);
    return Promise.resolve({ success: true, event, properties });
  }),

  // Chrome extension specific tracking
  trackInstalled: jest.fn(() => {
    console.log('[Analytics] Track: extension installed');
    return Promise.resolve({ success: true });
  }),

  trackPage: jest.fn((page, properties = {}) => {
    console.log(`[Analytics] Page: ${page}`, properties);
    return Promise.resolve({ success: true, page, properties });
  }),

  identify: jest.fn((userId, traits = {}) => {
    console.log(`[Analytics] Identify: ${userId}`, traits);
    return Promise.resolve({ success: true, userId, traits });
  }),

  // Chrome extension specific tracking
  trackContextMenuClick: jest.fn((menuId, properties = {}) => {
    console.log(`[Analytics] Context Menu Click: ${menuId}`, properties);
    return mockAnalytics.track('context_menu_click', { menuId, ...properties });
  }),

  trackApiCall: jest.fn((endpoint, properties = {}) => {
    console.log(`[Analytics] API Call: ${endpoint}`, properties);
    return mockAnalytics.track('api_call', { endpoint, ...properties });
  }),

  trackError: jest.fn((error, properties = {}) => {
    console.log(`[Analytics] Error: ${error.message || error}`, properties);
    return mockAnalytics.track('error', {
      error: error.message || String(error),
      category: properties.category || 'unknown',
      ...properties,
    });
  }),

  trackMediaProcessing: jest.fn((mediaType, properties = {}) => {
    console.log(`[Analytics] Media Processing: ${mediaType}`, properties);
    return mockAnalytics.track('media_processing', { mediaType, ...properties });
  }),

  trackUserInteraction: jest.fn((action, properties = {}) => {
    console.log(`[Analytics] User Interaction: ${action}`, properties);
    return mockAnalytics.track('user_interaction', { action, ...properties });
  }),

  // Performance tracking
  trackPerformance: jest.fn((metric, value, properties = {}) => {
    console.log(`[Analytics] Performance: ${metric} = ${value}`, properties);
    return mockAnalytics.track('performance', { metric, value, ...properties });
  }),

  // Configuration and setup
  initialize: jest.fn((config = {}) => {
    console.log('[Analytics] Initialize', config);
    mockAnalytics.isInitialized = true;
    return Promise.resolve({ success: true, config });
  }),

  setUserId: jest.fn(userId => {
    console.log(`[Analytics] Set User ID: ${userId}`);
    mockAnalytics.userId = userId;
    return Promise.resolve({ success: true, userId });
  }),

  setUserProperties: jest.fn(properties => {
    console.log('[Analytics] Set User Properties', properties);
    Object.assign(mockAnalytics.userProperties, properties);
    return Promise.resolve({ success: true, properties });
  }),

  reset: jest.fn(() => {
    console.log('[Analytics] Reset');
    mockAnalytics.userId = null;
    mockAnalytics.userProperties = {};
    return Promise.resolve({ success: true });
  }),

  // State management
  isInitialized: false,
  userId: null,
  userProperties: {},

  // Test utilities
  clearMocks: jest.fn(() => {
    jest.clearAllMocks();
    mockAnalytics.isInitialized = false;
    mockAnalytics.userId = null;
    mockAnalytics.userProperties = {};
  }),

  getTrackCalls: jest.fn(() => {
    return mockAnalytics.track.mock.calls.map(call => ({
      event: call[0],
      properties: call[1] || {},
    }));
  }),

  getTotalEvents: jest.fn(() => {
    return mockAnalytics.track.mock.calls.length;
  }),
};

// Default export for compatibility
module.exports = mockAnalytics;
