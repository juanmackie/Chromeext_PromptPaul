/**
 * @fileoverview Background-owned ChatGPT subscription authentication for Codex profiles.
 * @module codexAuth
 */

export const CODEX_AUTH_STORAGE_KEY = 'codexAuthByProfile';
export const CODEX_PENDING_LOGIN_STORAGE_KEY = 'codexPendingLoginByProfile';
export const CODEX_AUTH_ISSUER = 'https://auth.openai.com';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
export const CODEX_AUTH_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke';
const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEVICE_AUTH_MAX_AGE_MS = 15 * 60_000;

function storageGet(storage, keys) {
  return new Promise((resolve, reject) => {
    storage.get(keys, (result) => {
      const error = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function storageSet(storage, value) {
  return new Promise((resolve, reject) => {
    storage.set(value, () => {
      const error = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function parseJwtClaims(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch (_) {
    return null;
  }
}

export function extractCodexAccountId(tokens) {
  const tokenClaims = [tokens?.id_token, tokens?.access_token].map(parseJwtClaims).filter(Boolean);
  for (const claims of tokenClaims) {
    const accountId =
      claims.chatgpt_account_id ||
      claims['https://api.openai.com/auth']?.chatgpt_account_id ||
      claims.organizations?.[0]?.id;
    if (accountId) return String(accountId);
  }
  return '';
}

function extractEmail(tokens) {
  const claims = parseJwtClaims(tokens?.id_token) || parseJwtClaims(tokens?.access_token);
  return typeof claims?.email === 'string' ? claims.email : '';
}

function extractPlanType(tokens) {
  const claims = parseJwtClaims(tokens?.id_token) || parseJwtClaims(tokens?.access_token);
  return String(
    claims?.plan_type ||
      claims?.chatgpt_plan_type ||
      claims?.['https://api.openai.com/auth']?.plan_type ||
      ''
  );
}

function normalizeTokenResponse(tokens, previous = {}) {
  const accessToken = String(tokens?.access_token || previous.accessToken || '');
  const refreshToken = String(tokens?.refresh_token || previous.refreshToken || '');
  const expiresIn = Number(tokens?.expires_in);
  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresIn)
      ? Date.now() + Math.max(expiresIn, 60) * 1000
      : Number(previous.expiresAt || 0),
    accountId: extractCodexAccountId(tokens) || String(previous.accountId || ''),
    email: extractEmail(tokens) || String(previous.email || ''),
    planType: extractPlanType(tokens) || String(previous.planType || ''),
  };
}

export function sanitizeCodexAuth(auth) {
  if (!auth?.accessToken) {
    return { connected: false, email: '', accountId: '', planType: '', expiresAt: 0 };
  }
  return {
    connected: true,
    email: auth.email || '',
    accountId: auth.accountId || '',
    planType: auth.planType || '',
    expiresAt: Number(auth.expiresAt || 0),
  };
}

async function postJson(fetchImpl, url, body, signal) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Codex authentication request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function exchangeAuthorizationCode(fetchImpl, authorizationCode, codeVerifier) {
  const response = await fetchImpl(`${CODEX_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: `${CODEX_AUTH_ISSUER}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!response.ok) {
    const error = new Error(`Codex token exchange failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function refreshCodexToken(fetchImpl, auth) {
  const response = await fetchImpl(`${CODEX_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: CODEX_CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    const error = new Error(`Codex token refresh failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return normalizeTokenResponse(await response.json(), auth);
}

export function createCodexAuthManager({
  storage = chrome.storage.local,
  pendingStorage = chrome.storage.session || chrome.storage.local,
  fetchImpl = fetch,
  tabs = chrome.tabs,
} = {}) {
  const refreshPromises = new Map();

  async function readAuthMap() {
    const result = await storageGet(storage, [CODEX_AUTH_STORAGE_KEY]);
    return result[CODEX_AUTH_STORAGE_KEY] || {};
  }

  async function writeAuthMap(authMap) {
    await storageSet(storage, { [CODEX_AUTH_STORAGE_KEY]: authMap });
  }

  async function getStoredAuth(profileId) {
    const authMap = await readAuthMap();
    return authMap[profileId] || null;
  }

  async function getAuthStatus(profileId) {
    try {
      return sanitizeCodexAuth(await getValidAuth(profileId));
    } catch (_) {
      return { connected: false, email: '', accountId: '', planType: '', expiresAt: 0 };
    }
  }

  async function getValidAuth(profileId) {
    const auth = await getStoredAuth(profileId);
    if (!auth?.accessToken || !auth.refreshToken) return null;
    if (Number(auth.expiresAt || 0) > Date.now() + TOKEN_REFRESH_SKEW_MS) return auth;

    if (!refreshPromises.has(profileId)) {
      const refreshPromise = refreshCodexToken(fetchImpl, auth)
        .then(async (refreshed) => {
          const authMap = await readAuthMap();
          authMap[profileId] = refreshed;
          await writeAuthMap(authMap);
          return refreshed;
        })
        .finally(() => {
          refreshPromises.delete(profileId);
        });
      refreshPromises.set(profileId, refreshPromise);
    }
    return refreshPromises.get(profileId);
  }

  async function startLogin(profileId) {
    if (!profileId) throw new Error('A Codex profile is required for sign-in.');
    const device = await postJson(
      fetchImpl,
      `${CODEX_AUTH_ISSUER}/api/accounts/deviceauth/usercode`,
      { client_id: CODEX_CLIENT_ID }
    );
    const pending = {
      profileId,
      deviceAuthId: String(device.device_auth_id || ''),
      userCode: String(device.user_code || device.usercode || ''),
      intervalSeconds: Math.max(Number.parseInt(device.interval, 10) || 5, 1),
      expiresAt: Date.now() + DEVICE_AUTH_MAX_AGE_MS,
    };
    if (!pending.deviceAuthId || !pending.userCode) {
      throw new Error('Codex did not return a valid device sign-in request.');
    }
    await storageSet(pendingStorage, {
      [CODEX_PENDING_LOGIN_STORAGE_KEY]: { [profileId]: pending },
    });
    if (tabs?.create) {
      await new Promise((resolve) =>
        tabs.create({ url: `${CODEX_AUTH_ISSUER}/codex/device` }, resolve)
      );
    }
    return {
      verificationUrl: `${CODEX_AUTH_ISSUER}/codex/device`,
      userCode: pending.userCode,
      intervalSeconds: pending.intervalSeconds,
      expiresAt: pending.expiresAt,
    };
  }

  async function pollLogin(profileId) {
    const pendingResult = await storageGet(pendingStorage, [CODEX_PENDING_LOGIN_STORAGE_KEY]);
    const pending = pendingResult[CODEX_PENDING_LOGIN_STORAGE_KEY]?.[profileId];
    if (!pending || pending.expiresAt <= Date.now()) {
      throw new Error('The Codex sign-in code expired. Start sign-in again.');
    }
    const response = await fetchImpl(`${CODEX_AUTH_ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id: pending.deviceAuthId, user_code: pending.userCode }),
    });
    if (response.status === 403 || response.status === 404) {
      return { pending: true, retryAfterMs: pending.intervalSeconds * 1000 };
    }
    if (!response.ok) {
      throw new Error(`Codex device sign-in failed with HTTP ${response.status}.`);
    }
    const code = await response.json();
    const tokens = normalizeTokenResponse(
      await exchangeAuthorizationCode(fetchImpl, code.authorization_code, code.code_verifier)
    );
    if (!tokens.accessToken || !tokens.refreshToken) {
      throw new Error('Codex sign-in did not return usable credentials.');
    }
    const authMap = await readAuthMap();
    authMap[profileId] = tokens;
    await writeAuthMap(authMap);
    await storageSet(pendingStorage, { [CODEX_PENDING_LOGIN_STORAGE_KEY]: {} });
    return { pending: false, status: sanitizeCodexAuth(tokens) };
  }

  async function logout(profileId) {
    const authMap = await readAuthMap();
    delete authMap[profileId];
    await writeAuthMap(authMap);
    const pendingResult = await storageGet(pendingStorage, [CODEX_PENDING_LOGIN_STORAGE_KEY]);
    const pending = pendingResult[CODEX_PENDING_LOGIN_STORAGE_KEY] || {};
    delete pending[profileId];
    await storageSet(pendingStorage, { [CODEX_PENDING_LOGIN_STORAGE_KEY]: pending });
  }

  return { getValidAuth, getAuthStatus, startLogin, pollLogin, logout };
}
