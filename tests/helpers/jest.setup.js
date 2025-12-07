require('@testing-library/jest-dom');

// Basic global DOM defaults suitable for extension UI/unit tests.
if (typeof document !== 'undefined') {
  // Ensure a predictable base DOM structure
  if (!document.body) {
    document.body = document.createElement('body');
  }

  // Reset DOM between tests in a simple, centralized way.
  afterEach(() => {
    document.body.innerHTML = '';
  });
}
