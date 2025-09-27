// ===== Umami Analytics Module (privacy-first, opt-out) =====

const UMAMI_ENDPOINT = 'https://cloud.umami.is/api/send';
const UMAMI_WEBSITE_ID = 'd1b4d7cb-2e57-44ec-a91f-6692fb365a02';
const ANALYTICS_CONSENT_KEY = 'analyticsConsent';
const ANALYTICS_INSTANCE_KEY = 'analyticsInstance';
const ANALYTICS_ROTATE_AT_KEY = 'analyticsRotateAt';
const ANALYTICS_ROTATE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SAFE_LABEL_REGEX = /^[A-Za-z0-9._:-]{1,64}$/;
const DENYLIST = ['email', 'token', 'key', 'password', 'secret', 'auth', 'cookie', 'session', 'ssid'];

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11)
    .replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

function sanitizeLabel(v) {
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

async function getEnvInfo() {
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
}

async function getConsent() {
  const { [ANALYTICS_CONSENT_KEY]: consent } = await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
  // Default ON (opt-out)
  return consent !== false;
}

async function getInstanceId() {
  const now = Date.now();
  const res = await chrome.storage.local.get([ANALYTICS_INSTANCE_KEY, ANALYTICS_ROTATE_AT_KEY]);
  let instance = res[ANALYTICS_INSTANCE_KEY];
  let rotateAt = res[ANALYTICS_ROTATE_AT_KEY];
  if (!instance || !rotateAt || now >= rotateAt) {
    instance = uuidv4();
    rotateAt = now + ANALYTICS_ROTATE_MS;
    await chrome.storage.local.set({ [ANALYTICS_INSTANCE_KEY]: instance, [ANALYTICS_ROTATE_AT_KEY]: rotateAt });
  }
  return instance;
}

async function sendUmamiEvent(name, data) {
  try {
    const consent = await getConsent();
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
        body: body
      });
    }
  } catch (error) {
    console.error('Analytics event failed:', error);
  }
}

async function trackInstalled() {
  const env = await getEnvInfo();
  const instanceId = await getInstanceId();
  await sendUmamiEvent('extension_installed', { ...env, instanceId });
}

async function trackErrorEvent(category, code) {
  const env = await getEnvInfo();
  const instanceId = await getInstanceId();
  await sendUmamiEvent('error_occurred', { ...env, instanceId, category: sanitizeLabel(category), code: sanitizeLabel(code) });
}

async function trackInstructionUsed({ instruction, model, tools }) {
  const env = await getEnvInfo();
  const instanceId = await getInstanceId();
  const sanitizedInstruction = sanitizeLabel(instruction);
  const sanitizedModel = sanitizeLabel(model);
  const sanitizedTools = Array.isArray(tools) ? tools.map(sanitizeLabel).filter(Boolean) : [];
  
  await sendUmamiEvent('instruction_used', {
    ...env,
    instanceId,
    instruction: sanitizedInstruction,
    model: sanitizedModel,
    tools: sanitizedTools
  });
}

// Initialize analytics consent on first install
async function initializeAnalyticsConsent() {
  const existing = await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
  if (!(ANALYTICS_CONSENT_KEY in existing)) {
    await chrome.storage.local.set({ [ANALYTICS_CONSENT_KEY]: true });
  }
}

// Listen for analytics consent changes
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ANALYTICS_CONSENT_KEY]) {
      console.log('Analytics consent changed:', changes[ANALYTICS_CONSENT_KEY].newValue);
    }
  });
}

export {
  trackInstalled,
  trackErrorEvent,
  trackInstructionUsed,
  initializeAnalyticsConsent
};