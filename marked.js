/**
 * @fileoverview ES Module wrapper for marked.min.js
 *
 * This wrapper makes the marked library available as an ES module
 * for use in service workers and other ES module contexts.
 */

// Import the UMD module - it will set globalThis.marked
import './marked.min.js';

// Re-export marked from the global scope
const marked = globalThis.marked;

export { marked };
export default marked;
