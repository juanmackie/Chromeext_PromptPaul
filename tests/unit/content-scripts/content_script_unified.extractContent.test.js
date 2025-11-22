/**
 * Tests for extractContent behavior in content_script_unified.js.
 *
 * The script is an IIFE that:
 *  - Clones the DOM
 *  - Strips a wide range of "noise" selectors
 *  - Extracts main/article/content-like text
 *  - Applies aggressive cleanup and heuristics
 *  - Returns an object: { success, data, error, url, title, timestamp }
 *
 * We load the script into a jsdom-backed window and assert on its returned value.
 */

const fs = require("fs");
const path = require("path");
const { TextEncoder, TextDecoder } = require("util");

// Polyfill global TextEncoder/TextDecoder for environments (like Jest + jsdom)
// where they may not be defined yet. This must run before requiring jsdom.
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}

const { JSDOM } = require("jsdom");

function runContentScriptWith(html) {
  const dom = new JSDOM(html, {
    url: "https://example.com/page",
    runScripts: "outside-only"
  });

  const { window } = dom;
  const scriptPath = path.resolve(__dirname, "../../../content_script_unified.js");
  const scriptSource = fs.readFileSync(scriptPath, "utf8");

  // Provide a minimal chrome.runtime for the script's error reporting path.
  window.chrome = {
    runtime: {
      sendMessage: jest.fn()
    }
  };

  // Execute the content script in the JSDOM context.
  dom.runVMScript(new window.vm.Script(scriptSource));

  return { dom, window };
}

describe("content_script_unified extractContent behavior", () => {
  test("extracts main/article content and filters common noise", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Test Page</title>
          <script>console.log("noise script");</script>
        </head>
        <body>
          <header>Navigation, logo, menu</header>
          <div class="ads">Buy now!</div>
          <main>
            <h1>Important Heading</h1>
            <p>This is the primary article content that should be extracted.</p>
          </main>
          <footer>Footer links</footer>
        </body>
      </html>
    `;

    const { dom } = runContentScriptWith(html);
    const result = dom.window.__EXTRACTION_RESULT__ || dom.window.__PROMPT_PAUL_EXTRACTION__ || dom.window._contentExtractionResult || null;

    // The script returns its result as the IIFE value; JSDOM's runVMScript
    // doesn't automatically expose it, so instead we re-evaluate the IIFE's
    // return inline by requiring the script. To avoid changing production code,
    // we assert via heuristic: the last evaluated expression is the result.
    // For robustness, fall back to evaluating its exported value:
    // we instead directly re-require the module text and eval in this context.
    // Here, we simply assert the object shape by re-running the script body.

    // Fallback: parse from the evaluated script return (captured by wrapping below)
    expect(typeof dom.window).toBe("object");

    // As we cannot rely on internal globals, re-run minimal extraction by re-evaluating script code and capturing its return.
    const wrapped = `(function(){ ${fs.readFileSync(
      path.resolve(__dirname, "../../../content_script_unified.js"),
      "utf8"
    )} })()`;
    const evaluated = dom.window.eval(wrapped);

    expect(evaluated).toBeTruthy();
    expect(evaluated.success).toBe(true);
    expect(typeof evaluated.data).toBe("string");
    expect(evaluated.data).toContain("Important Heading");
    expect(evaluated.data).toContain("primary article content");
    // Ensure obvious noise like "Buy now!" and header/footer nav is filtered out
    expect(evaluated.data).not.toContain("Buy now!");
    expect(evaluated.data).not.toContain("Navigation, logo, menu");
  });

  test("sets error message for pages with only UI/navigation text", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <header>Home | Menu | Login</header>
          <nav>Nav links only</nav>
          <footer>Footer</footer>
        </body>
      </html>
    `;

    const dom = new JSDOM(html, {
      url: "https://example.com/ui-only",
      runScripts: "outside-only"
    });
    const { window } = dom;

    window.chrome = {
      runtime: {
        sendMessage: jest.fn()
      }
    };

    const wrapped = `(function(){ ${fs.readFileSync(
      path.resolve(__dirname, "../../../content_script_unified.js"),
      "utf8"
    )} })()`;
    const evaluated = window.eval(wrapped);

    expect(evaluated).toBeTruthy();
    expect(evaluated.success).toBe(true);
    expect(evaluated.data === "" || evaluated.data.length < 50).toBe(true);
    expect(evaluated.error).toMatch(/no extractable textual content|only navigation or UI elements/i);
  });

  describe("DynamicContentDetector behavior", () => {
    test("DynamicContentDetector is defined in IIFE scope and accessible to lifecycle hooks", () => {
      const html = `
        <!doctype html>
        <html>
          <head><title>Test</title></head>
          <body><main>Content</main></body>
        </html>
      `;

      const { dom } = runContentScriptWith(html);
      
      // Verify that DynamicContentDetector exists in the global scope
      expect(typeof dom.window.DynamicContentDetector).toBe('object');
      expect(typeof dom.window.DynamicContentDetector.initialize).toBe('function');
      expect(typeof dom.window.DynamicContentDetector.disconnect).toBe('function');
    });

    test("DynamicContentDetector gracefully handles missing document.body", () => {
      const html = `
        <!doctype html>
        <html>
          <head><title>Test</title></head>
        </html>
      `;

      const { window } = new JSDOM(html, {
        url: "https://example.com/no-body",
        runScripts: "outside-only"
      });

      window.chrome = {
        runtime: {
          sendMessage: jest.fn()
        }
      };

      // Mock MutationObserver to test defensive checks
      window.MutationObserver = jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        disconnect: jest.fn()
      }));

      const wrapped = `(function(){ ${fs.readFileSync(
        path.resolve(__dirname, "../../../content_script_unified.js"),
        "utf8"
      )} })()`;
      
      // Should not throw error when body is missing
      expect(() => {
        window.eval(wrapped);
      }).not.toThrow();
    });

    test("DynamicContentDetector handles missing MutationObserver gracefully", () => {
      const html = `
        <!doctype html>
        <html>
          <head><title>Test</title></head>
          <body><main>Content</main></body>
        </html>
      `;

      const { window } = new JSDOM(html, {
        url: "https://example.com/no-observer",
        runScripts: "outside-only"
      });

      window.chrome = {
        runtime: {
          sendMessage: jest.fn()
        }
      };

      // Remove MutationObserver to test fallback
      delete window.MutationObserver;

      const wrapped = `(function(){ ${fs.readFileSync(
        path.resolve(__dirname, "../../../content_script_unified.js"),
        "utf8"
      )} )()`;
      
      // Should not throw error when MutationObserver is unavailable
      expect(() => {
        window.eval(wrapped);
      }).not.toThrow();
    });

    test("DynamicContentDetector lifecycle hooks execute without ReferenceError", () => {
      const html = `
        <!doctype html>
        <html>
          <head><title>Test</title></head>
          <body><main>Content</main></body>
        </html>
      `;

      const { window } = new JSDOM(html, {
        url: "https://example.com/lifecycle",
        runScripts: "outside-only"
      });

      window.chrome = {
        runtime: {
          sendMessage: jest.fn()
        }
      };

      // Mock MutationObserver
      window.MutationObserver = jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        disconnect: jest.fn()
      }));

      const wrapped = `(function(){ ${fs.readFileSync(
        path.resolve(__dirname, "../../../content_script_unified.js"),
        "utf8"
      )} )()`;
      
      window.eval(wrapped);

      // Simulate visibility change events
      expect(() => {
        window.document.dispatchEvent(new window.Event('visibilitychange'));
      }).not.toThrow();

      // Simulate beforeunload event
      expect(() => {
        window.document.dispatchEvent(new window.Event('beforeunload'));
      }).not.toThrow();
    });

    test("ProgressiveDOMProcessor is defined and accessible", () => {
      const html = `
        <!doctype html>
        <html>
          <head><title>Test</title></head>
          <body><main>Content</main></body>
        </html>
      `;

      const { dom } = runContentScriptWith(html);
      
      // Verify that ProgressiveDOMProcessor exists in the global scope
      expect(typeof dom.window.ProgressiveDOMProcessor).toBe('object');
      expect(typeof dom.window.ProgressiveDOMProcessor.waitForStableDOM).toBe('function');
      expect(typeof dom.window.ProgressiveDOMProcessor.processWithTimeout).toBe('function');
    });

    test("DynamicContentDetector disconnect method handles missing observer safely", () => {
      const html = `
        <!doctype html>
        <html>
          <head><title>Test</title></head>
          <body><main>Content</main></body>
        </html>
      `;

      const { window } = new JSDOM(html, {
        url: "https://example.com/disconnect-test",
        runScripts: "outside-only"
      });

      window.chrome = {
        runtime: {
          sendMessage: jest.fn()
        }
      };

      // Mock MutationObserver
      const mockDisconnect = jest.fn();
      window.MutationObserver = jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        disconnect: mockDisconnect
      }));

      const wrapped = `(function(){ ${fs.readFileSync(
        path.resolve(__dirname, "../../../content_script_unified.js"),
        "utf8"
      )} )()`;
      
      window.eval(wrapped);

      // Call disconnect directly to test error handling
      expect(() => {
        window.DynamicContentDetector.disconnect();
      }).not.toThrow();
    });
  });
});