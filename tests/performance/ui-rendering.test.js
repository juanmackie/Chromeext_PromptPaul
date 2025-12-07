/**
 * Performance Tests - UI Rendering Performance
 * Measures chat UI, message rendering, streaming performance
 */

describe('UI Rendering Performance Tests', () => {
  test('should measure single message rendering time', async () => {
    const start = performance.now();

    // Simulate message rendering (DOM manipulation)
    document.body.innerHTML += '<div class="message assistant">Test message content</div>';

    const end = performance.now();
    const duration = end - start;

    console.log(`Single message render: ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(10);
  }, 1000);

  test('should measure 100 message streaming render performance', async () => {
    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      // Simulate streaming chunk append
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message streaming';
      messageDiv.textContent = `Stream chunk ${i}`;
      document.body.appendChild(messageDiv);

      // Simulate streaming delay
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    const end = performance.now();
    const duration = end - start;
    const avgPerMessage = duration / 100;

    console.log(
      `100 message streaming: ${duration.toFixed(2)}ms (avg ${avgPerMessage.toFixed(2)}ms)`
    );
    expect(avgPerMessage).toBeLessThan(5);
  }, 10000);

  test('should measure theme switch performance', async () => {
    const start = performance.now();

    // Simulate theme class toggle on body
    document.body.classList.toggle('dark-theme');
    document.body.classList.toggle('light-theme');

    // Force reflow
    void document.body.offsetHeight;

    const end = performance.now();
    const duration = end - start;

    console.log(`Theme switch: ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(5);
  });
});
