const {
  ErrorHandler,
  ExtensionError,
  ErrorSeverity,
  ErrorCategory
} = require("../../../errorHandler.js");

describe("ErrorHandler.normalizeError", () => {
  let handler;

  beforeEach(() => {
    handler = new ErrorHandler();
  });

  test("converts generic Error into ExtensionError with expected defaults", () => {
    const original = new Error("Oops");
    const normalized = handler.normalizeError(original);

    expect(normalized).toBeInstanceOf(ExtensionError);
    expect(normalized.message).toBe("Oops");
    expect(normalized.severity).toBe(ErrorSeverity.MEDIUM);
    expect(normalized.category).toBe(ErrorCategory.UNKNOWN);
    expect(normalized.code).toBe("GENERAL_ERROR");
    expect(normalized.originalError).toBe(original);
  });

  test("passes through existing ExtensionError as-is", () => {
    const extError = new ExtensionError("Existing", {
      severity: ErrorSeverity.HIGH,
      category: ErrorCategory.NETWORK,
      code: "CUSTOM_CODE",
      userMessage: "User msg"
    });

    const normalized = handler.normalizeError(extError);

    expect(normalized).toBe(extError);
    expect(normalized.code).toBe("CUSTOM_CODE");
    expect(normalized.category).toBe(ErrorCategory.NETWORK);
    expect(normalized.userMessage).toBe("User msg");
  });

  test("handles string input by wrapping into ExtensionError", () => {
    const normalized = handler.normalizeError("plain string error");

    expect(normalized).toBeInstanceOf(ExtensionError);
    expect(normalized.message).toBe("plain string error");
    expect(normalized.code).toBe("GENERAL_ERROR");
  });

  test("maps fetch-related TypeError into NETWORK_ERROR with retryable=true", () => {
    const fetchError = new TypeError("Failed to fetch");
    const normalized = handler.normalizeError(fetchError);

    expect(normalized).toBeInstanceOf(ExtensionError);
    expect(normalized.category).toBe(ErrorCategory.NETWORK);
    expect(normalized.code).toBe("NETWORK_ERROR");
    expect(normalized.retryable).toBe(true);
    expect(normalized.originalError).toBe(fetchError);
  });

  test("chrome.runtime.lastError is converted into CHROME_API error when present", () => {
    const originalChrome = global.chrome;
    global.chrome = {
      runtime: {
        lastError: { message: "Some runtime error" }
      }
    };

    const normalized = handler.normalizeError(new Error("ignored because lastError"));

    expect(normalized).toBeInstanceOf(ExtensionError);
    expect(normalized.category).toBe(ErrorCategory.CHROME_API);
    expect(normalized.code).toBe("CHROME_RUNTIME_ERROR");
    expect(normalized.message).toBe("Some runtime error");

    global.chrome = originalChrome;
  });
});