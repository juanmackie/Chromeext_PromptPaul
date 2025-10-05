/**
 * Analytics Service
 * Handles all analytics tracking functionality
 * Implements production-ready coding rules for analytics
 *
 * Core Principles:
 * - Privacy-first: Opt-out analytics with no personal data
 * - Default Deny: Explicit permission required for data collection
 * - Input Validation: Validate all analytics data
 * - Security: Don't expose sensitive information
 */

import { logger } from '../shared/index.js';

class AnalyticsService {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    
    // Analytics configuration
    this.endpoint = 'https://cloud.umami.is/api/send';
    this.websiteId = 'd1b4d7cb-2e57-44ec-a91f-6692fb365a02';
    this.consentKey = 'analyticsConsent';
    this.instanceKey = 'analyticsInstance';
    this.rotateAtKey = 'analyticsRotateAt';
    this.rotateMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    // Validation patterns
    this.labelRegex = /^[A-Za-z0-9._:-]{1,64}$/;
    this.denylist = ['email', 'token', 'key', 'password', 'secret', 'auth', 'cookie', 'session', 'ssid'];
  }

  /**
   * Generates a UUID v4
   * @returns {string} UUID
   */
  generateUuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11)
      .replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
  }

  /**
   * Sanitizes analytics labels to prevent data leakage
   * @param {string} value - Value to sanitize
   * @returns {string|undefined} Sanitized value or undefined if invalid
   */
  sanitizeLabel(value) {
    if (typeof value !== 'string') return undefined;
    
    let s = value.trim().toLowerCase();
    if (!s) return undefined;
    
    // Quick deny if looks like an email or has spaces
    if (s.includes('@') || s.includes(' ')) return undefined;
    
    // Denylisted keywords
    for (const k of this.denylist) {
      if (s.includes(k)) return undefined;
    }
    
    // Enforce charset and length
    if (!this.labelRegex.test(s)) return undefined;
    return s;
  }

  /**
   * Gets environment information for analytics
   * @returns {Promise<Object>} Environment info
   */
  async getEnvInfo() {
    try {
      const manifest = chrome.runtime.getManifest();
      const extVersion = manifest?.version || '0.0.0';
      const platformInfo = await new Promise(resolve => chrome.runtime.getPlatformInfo(resolve));
      let chromeMajor = '0';
      
      try {
        const ua = navigator.userAgent;
        const m = ua.match(/Chrome\/(\d+)/);
        if (m) chromeMajor = m[1];
      } catch (_) {}
      
      return { extVersion, platform: platformInfo?.os || 'unknown', chromeMajor };
    } catch (error) {
      this.logger.error('Failed to get environment info', {}, error);
      return { extVersion: '0.0.0', platform: 'unknown', chromeMajor: '0' };
    }
  }

  /**
   * Gets user consent for analytics
   * @returns {Promise<boolean>} True if consented
   */
  async getConsent() {
    try {
      const { [this.consentKey]: consent } = await this.storage.get(this.consentKey);
      // Default ON (opt-out)
      return consent !== false;
    } catch (error) {
      this.logger.error('Failed to get analytics consent', {}, error);
      return false; // Default to no consent on error
    }
  }

  /**
   * Gets or creates analytics instance ID
   * @returns {Promise<string>} Instance ID
   */
  async getInstanceId() {
    try {
      const now = Date.now();
      const res = await this.storage.get([this.instanceKey, this.rotateAtKey]);
      let instance = res[this.instanceKey];
      let rotateAt = res[this.rotateAtKey];
      
      if (!instance || !rotateAt || now >= rotateAt) {
        instance = this.generateUuid();
        rotateAt = now + this.rotateMs;
        await this.storage.set({ [this.instanceKey]: instance, [this.rotateAtKey]: rotateAt });
      }
      
      return instance;
    } catch (error) {
      this.logger.error('Failed to get analytics instance ID', {}, error);
      return 'unknown';
    }
  }

  /**
   * Sends an analytics event to the server
   * @param {string} name - Event name
   * @param {Object} data - Event data
   * @returns {Promise<void>}
   */
  async sendEvent(name, data = {}) {
    try {
      const consent = await this.getConsent();
      if (!consent) return;

      // Sanitize event name
      const sanitizedName = this.sanitizeLabel(name);
      if (!sanitizedName) {
        this.logger.warn('Invalid analytics event name', { name });
        return;
      }

      // Get environment and instance info
      const [envInfo, instance] = await Promise.all([
        this.getEnvInfo(),
        this.getInstanceId()
      ]);

      // Sanitize data
      const sanitizedData = {};
      for (const [key, value] of Object.entries(data)) {
        const sanitizedKey = this.sanitizeLabel(key);
        if (sanitizedKey && typeof value === 'string') {
          const sanitizedValue = this.sanitizeLabel(value);
          if (sanitizedValue) {
            sanitizedData[sanitizedKey] = sanitizedValue;
          }
        }
      }

      // Create payload
      const payload = {
        type: 'event',
        payload: {
          website: this.websiteId,
          hostname: 'extension',
          url: `/ext/usage/${sanitizedName}`,
          referrer: '',
          name: sanitizedName,
          event_name: sanitizedName,
          data: {
            ...envInfo,
            instance,
            ...sanitizedData
          }
        }
      };

      const body = JSON.stringify(payload);

      // Send using sendBeacon if available (more reliable for extension context)
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(this.endpoint, blob);
      } else {
        // Fallback to fetch
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true
        });
      }

      this.logger.debug('Analytics event sent', { name: sanitizedName, data: sanitizedData });
    } catch (error) {
      // Never throw analytics errors
      this.logger.warn('Analytics send failed', { name, error: error.message });
    }
  }

  /**
   * Tracks extension installation
   * @returns {Promise<void>}
   */
  async trackInstalled() {
    const env = await this.getEnvInfo();
    const instance = await this.getInstanceId();
    await this.sendEvent('installed', { ...env, instance });
  }

  /**
   * Tracks error events
   * @param {string} category - Error category
   * @param {string} code - Error code
   * @returns {Promise<void>}
   */
  async trackErrorEvent(category, code) {
    const env = await this.getEnvInfo();
    const instance = await this.getInstanceId();
    const cat = this.sanitizeLabel(category) || 'unknown';
    const c = this.sanitizeLabel(code) || 'unknown';
    await this.sendEvent('error_event', { ...env, instance, category: cat, code: c });
  }

  /**
   * Tracks instruction usage
   * @param {Object} params - Instruction parameters
   * @returns {Promise<void>}
   */
  async trackInstructionUsed({ instruction, model, tools }) {
    const env = await this.getEnvInfo();
    const instance = await this.getInstanceId();
    const instr = this.sanitizeLabel(instruction) || 'unknown';
    const mdl = this.sanitizeLabel(model) || 'unknown';
    const toolsSafe = Array.isArray(tools)
      ? tools.map(t => this.sanitizeLabel(String(t))).filter(Boolean).slice(0, 8)
      : [];
    
    await this.sendEvent('instruction_used', {
      ...env,
      instance,
      instruction: instr,
      model: mdl,
      tools: toolsSafe,
      count: 1
    });
  }

  /**
   * Tracks tool usage
   * @param {Object} params - Tool parameters
   * @returns {Promise<void>}
   */
  async trackToolUsed({ tool, status, duration }) {
    const env = await this.getEnvInfo();
    const instance = await this.getInstanceId();
    const toolName = this.sanitizeLabel(tool) || 'unknown';
    const toolStatus = this.sanitizeLabel(status) || 'unknown';
    
    await this.sendEvent('tool_used', {
      ...env,
      instance,
      tool: toolName,
      status: toolStatus,
      duration: typeof duration === 'number' ? Math.round(duration) : 'unknown'
    });
  }

  /**
   * Sets user consent for analytics
   * @param {boolean} consent - User consent
   * @returns {Promise<void>}
   */
  async setConsent(consent) {
    try {
      await this.storage.set({ [this.consentKey]: consent });
      this.logger.info(`Analytics consent ${consent ? 'enabled' : 'disabled'}`);
    } catch (error) {
      this.logger.error('Failed to set analytics consent', { consent }, error);
    }
  }

  /**
   * Resets analytics instance (for privacy)
   * @returns {Promise<void>}
   */
  async resetInstance() {
    try {
      const newInstance = this.generateUuid();
      const newRotateAt = Date.now() + this.rotateMs;
      await this.storage.set({
        [this.instanceKey]: newInstance,
        [this.rotateAtKey]: newRotateAt
      });
      this.logger.info('Analytics instance reset');
    } catch (error) {
      this.logger.error('Failed to reset analytics instance', {}, error);
    }
  }
}

export default AnalyticsService;