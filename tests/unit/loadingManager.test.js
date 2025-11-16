const { JSDOM } = require("jsdom");
const { LoadingManager } = require("../../loadingManager.js");

describe("LoadingManager", () => {
  let dom;
  let document;
  let window;
  let manager;
  let container;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
      url: "https://example.com"
    });
    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;

    manager = new LoadingManager();
    container = document.createElement("div");
    container.id = "container";
    document.body.appendChild(container);
  });

  afterEach(() => {
    dom.window.close();
    delete global.window;
    delete global.document;
  });

  test("showLoading adds overlay and loading class, hideLoading removes them", () => {
    const loaderId = manager.showLoading(container, "Loading test");
    expect(loaderId).toBeTruthy();

    const overlay = container.querySelector(".loading-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay.dataset.loaderId).toBe(loaderId);
    expect(container.classList.contains("loading")).toBe(true);

    manager.hideLoading(loaderId);

    expect(container.querySelector(".loading-overlay")).toBeNull();
    expect(container.classList.contains("loading")).toBe(false);
  });

  test("showError renders error output in target element", () => {
    const error = new Error("Something went wrong");
    const errorEl = manager.showError(container, error, {
      title: "Error Title",
      retry: jest.fn(),
      dismiss: true
    });

    expect(errorEl).not.toBeNull();
    expect(container.querySelector(".error-state")).not.toBeNull();
    expect(container.querySelector(".error-title").textContent).toBe("Error Title");
    expect(container.querySelector(".error-message").textContent).toBe("Something went wrong");
  });

  test("clearAll clears loaders, toasts, errors, and progress bars", () => {
    // Loader
    manager.showLoading(container, "Loading...");
    // Toast
    manager.showToast("Hello", "info", 0);
    // Error
    manager.showError(container, new Error("fail"));
    // Progress
    manager.showProgress(container, 50);

    expect(document.querySelectorAll(".loading-overlay").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".toast").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".error-state").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".progress-bar").length).toBeGreaterThan(0);

    manager.clearAll();

    expect(document.querySelectorAll(".loading-overlay").length).toBe(0);
    expect(document.querySelectorAll(".toast").length).toBe(0);
    expect(document.querySelectorAll(".error-state").length).toBe(0);
    expect(document.querySelectorAll(".progress-bar").length).toBe(0);
  });
});