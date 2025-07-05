
/**
 * @typedef {object} JsonRpcRequest
 * @property {string} jsonrpc
 * @property {string|number|null} id
 * @property {string} method
 * @property {object} [params]
 */

/**
 * @typedef {object} JsonRpcError
 * @property {number} code
 * @property {string} message
 * @property {any} [data]
 */

/**
 * @typedef {object} JsonRpcResponse
 * @property {string} jsonrpc
 * @property {string|number|null} id
 * @property {any} [result]
 * @property {JsonRpcError} [error]
 */


