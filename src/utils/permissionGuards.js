/**
 * @fileoverview Browser URL restriction guards for tab content access.
 * @module permissionGuards
 */

const RESTRICTED_PROTOCOLS = new Set([
  'about:',
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'devtools:',
  'edge:',
  'file:',
  'moz-extension:',
  'view-source:',
]);

const RESTRICTED_EXTENSION_GALLERY_HOSTS = new Set([
  'chrome.google.com',
  'chromewebstore.google.com',
]);

export function isRestrictedBrowserUrl(url) {
  try {
    const parsed = new URL(url);
    if (RESTRICTED_PROTOCOLS.has(parsed.protocol)) return true;
    return isRestrictedExtensionGalleryUrl(parsed);
  } catch {
    return true;
  }
}

export function toOriginPermissionPattern(url) {
  if (isRestrictedBrowserUrl(url)) return null;
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const portSuffix = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${parsed.hostname}${portSuffix}/*`;
}

export function getCurrentPageSupport(url) {
  if (!url) {
    return {
      available: false,
      blockedReason: 'No active browser page is available right now.',
    };
  }
  if (!toOriginPermissionPattern(url)) {
    return {
      available: false,
      blockedReason:
        'This page is restricted by the browser, so Prompt Paul cannot read or modify it.',
    };
  }
  return { available: true, blockedReason: '' };
}

function isRestrictedExtensionGalleryUrl(parsed) {
  if (!/^https?:$/.test(parsed.protocol) || !RESTRICTED_EXTENSION_GALLERY_HOSTS.has(parsed.hostname)) {
    return false;
  }
  return parsed.hostname === 'chromewebstore.google.com' || parsed.pathname.startsWith('/webstore');
}
