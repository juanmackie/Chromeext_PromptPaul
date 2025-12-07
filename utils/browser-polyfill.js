import './webextension-polyfill.js';

// Make sure we export the browser object that the polyfill attached to globalThis
const browser = globalThis.browser;

export default browser;
