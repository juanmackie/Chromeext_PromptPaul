// ===== Umami Analytics Module (privacy-first, opt-out) =====

const UMAMI_ENDPOINT = 'https://cloud.umami.is/api/send';
const UMAMI_WEBSITE_ID = 'd1b4d7cb-2e57-44ec-a91f-6692fb365a02';
const ANALYTICS_CONSENT_KEY = 'analyticsConsent';
const ANALYTICS_INSTANCE_KEY = 'analyticsInstance';
const ANALYTICS_ROTATE_AT_KEY = 'analyticsRotateAt';
const ANALYTICS_ROTATE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SAFE_LABEL_REGEX = /^[A-Za-z0-9._:-]{1,64}$/;
const DENYLIST = ['email', 'token', 'key', 'password', 'secret', 'auth', 'cookie', 'session', 'ssid'];

/**
 * Analytics Module - Handles privacy-first analytics tracking using Umami
 * Features:
 * - Opt-out by default (user must explicitly disable)
 * - Rotating instance IDs (30-day rotation)
 * - Privacy-focused data sanitization
 * - No sensitive data collection (no URLs, content, or identifiers)
 */
class Analytics {
  constructor() {
    this.initialized = false;
    this.consentChangeListener = null;
  }

  /**
   * Initialize the analytics module
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Set default consent to true if not present
      await this.setDefaultConsent();

      // Set up storage change listener
      this.setupStorageListener();

      this.initialized = true;
      console.log('Analytics module initialized');
    } catch (error) {
      console.warn('Failed to initialize analytics module:', error);
    }
  }

  /**
   * Set default analytics consent to true (opt-out model)
   */
  async setDefaultConsent() {
    try {
      const existing = await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
      if (!(ANALYTICS_CONSENT_KEY in existing)) {
        await chrome.storage.local.set({ [ANALYTICS_CONSENT_KEY]: true });
      }
    } catch (error) {
      console.warn('Failed to set default analytics consent:', error);
    }
  }

  /**
   * Set up storage change listener for consent changes
   */
  setupStorageListener() {
    this.consentChangeListener = (changes, area) => {
      if (area === 'local' && changes[ANALYTICS_CONSENT_KEY]) {
        console.log('Analytics consent changed:', changes[ANALYTICS_CONSENT_KEY].newValue);
      }
    };

    chrome.storage.onChanged.addListener(this.consentChangeListener);
  }

  /**
   * Generate UUID v4
   */
  uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11)
      .replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
  }

  /**
   * Sanitize labels to prevent privacy issues
   */
  sanitizeLabel(v) {
    if (typeof v !== 'string') return undefined;
    let s = v.trim().toLowerCase();
    if (!s) return undefined;
    // quick deny if looks like an email or has spaces
    if (s.includes('@') || s.includes(' ')) return undefined;
    // denylisted keywords
    for (const k of DENYLIST) {
      if (s.includes(k)) return undefined;
    }
    // enforce charset and length
    if (!SAFE_LABEL_REGEX.test(s)) return undefined;
    return s;
  }

  /**
   * Get environment information (extension version, platform, Chrome version)
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
      console.warn('Failed to get environment info:', error);
      return { extVersion: '0.0.0', platform: 'unknown', chromeMajor: '0' };
    }
  }

  /**
   * Get user consent for analytics
   */
  async getConsent() {
    try {
      const { [ANALYTICS_CONSENT_KEY]: consent } = await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
      // Default ON (opt-out)
      return consent !== false;
    } catch (error) {
      console.warn('Failed to get analytics consent:', error);
      return false;
    }
  }

  /**
   * Get or create rotating instance ID
   */
  async getInstanceId() {
    try {
      const now = Date.now();
      const res = await chrome.storage.local.get([ANALYTICS_INSTANCE_KEY, ANALYTICS_ROTATE_AT_KEY]);
      let instance = res[ANALYTICS_INSTANCE_KEY];
      let rotateAt = res[ANALYTICS_ROTATE_AT_KEY];
      if (!instance || !rotateAt || now >= rotateAt) {
        instance = this.uuidv4();
        rotateAt = now + ANALYTICS_ROTATE_MS;
        await chrome.storage.local.set({ [ANALYTICS_INSTANCE_KEY]: instance, [ANALYTICS_ROTATE_AT_KEY]: rotateAt });
      }
      return instance;
    } catch (error) {
      console.warn('Failed to get instance ID:', error);
      return this.uuidv4(); // Fallback to generated ID
    }
  }

  /**
   * Send event to Umami analytics
   */
  async sendUmamiEvent(name, data) {
    try {
      const consent = await this.getConsent();
      if (!consent) return;

      // Send richer segmentation to Umami so you can filter by instruction/model/tools directly.
      // Umami supports additional fields in the payload object such as event_name and data.
      // We keep name as a stable event category (e.g., "instruction_used") and also include
      // event_name set to the specific instruction for top-level segmentation.
      const payload = {
        type: 'event',
        payload: {
          website: UMAMI_WEBSITE_ID,
          hostname: 'extension',
          url: `/ext/usage/${data?.instruction || 'unknown'}`,
          referrer: '',
          name, // high-level category, e.g., "instruction_used"
          event_name: data?.instruction || name, // specific instruction or fallback to name
          data: {
            ...data,
            // Duplicate key fields at top-level-friendly keys for Umami dashboards
            instruction: data?.instruction || 'unknown',
            model: data?.model || 'unknown',
            tools: Array.isArray(data?.tools) ? data.tools : []
          }
        }
      };
      const body = JSON.stringify(payload);

      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(UMAMI_ENDPOINT, blob);
      } else {
        await fetch(UMAMI_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true
        });
      }
    } catch (e) {
      // never throw
      console.warn('Analytics send failed:', e);
    }
  }

  /**
   * Track extension installation/update event
   */
  async trackInstalled() {
    try {
      const env = await this.getEnvInfo();
      const instance = await this.getInstanceId();
      await this.sendUmamiEvent('installed', { ...env, instance });
    } catch (error) {
      console.warn('Failed to track installation:', error);
    }
  }

  /**
   * Track error events
   */
  async trackErrorEvent(category, code) {
    try {
      const env = await this.getEnvInfo();
      const instance = await this.getInstanceId();
      const cat = this.sanitizeLabel(category) || 'unknown';
      const c = this.sanitizeLabel(code) || 'unknown';
      await this.sendUmamiEvent('error_event', { ...env, instance, category: cat, code: c });
    } catch (error) {
      console.warn('Failed to track error event:', error);
    }
  }

  /**
   * Track instruction usage with model and tools information
   */
  async trackInstructionUsed({ instruction, model, tools }) {
    try {
      const env = await this.getEnvInfo();
      const instance = await this.getInstanceId();
      const instr = this.sanitizeLabel(instruction) || 'unknown';
      const mdl = this.sanitizeLabel(model) || 'unknown';
      const toolsSafe = Array.isArray(tools)
        ? tools.map(t => this.sanitizeLabel(String(t))).filter(Boolean).slice(0, 8)
        : [];
      // Put the instruction and model into the event "name" context via sendUmamiEvent enhancements above
      await this.sendUmamiEvent('instruction_used', {
        ...env,
        instance,
        instruction: instr,
        model: mdl,
        tools: toolsSafe,
        count: 1
      });
    } catch (error) {
      console.warn('Failed to track instruction usage:', error);
    }
  }

  /**
   * Clean up analytics module
   */
  cleanup() {
    if (this.consentChangeListener) {
      chrome.storage.onChanged.removeListener(this.consentChangeListener);
      this.consentChangeListener = null;
    }
    this.initialized = false;
  }
}

// Create and export analytics instance
const analytics = new Analytics();

// Export analytics methods for backward compatibility
export const uuidv4 = () => analytics.uuidv4();
export const sanitizeLabel = (v) => analytics.sanitizeLabel(v);
export const getEnvInfo = () => analytics.getEnvInfo();
export const getConsent = () => analytics.getConsent();
export const getInstanceId = () => analytics.getInstanceId();
export const sendUmamiEvent = (name, data) => analytics.sendUmamiEvent(name, data);
export const trackInstalled = () => analytics.trackInstalled();
export const trackErrorEvent = (category, code) => analytics.trackErrorEvent(category, code);
export const trackInstructionUsed = ({ instruction, model, tools }) => analytics.trackInstructionUsed({ instruction, model, tools });

// Export the analytics instance for advanced usage
export default analytics;