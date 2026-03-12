// Bento Grid Scroll Reveal Animation
(function() {
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, observerOptions);

  document.querySelectorAll('[data-bento]').forEach(card => {
    observer.observe(card);
  });

  // Connection status indicator
  const connectionDot = document.getElementById('connectionStatusDot');
  const connectionText = document.getElementById('connectionStatusText');
  
  function updateConnectionStatus(connected) {
    if (connectionDot && connectionText) {
      connectionDot.classList.toggle('connected', connected);
      connectionDot.classList.toggle('disconnected', !connected);
      connectionText.textContent = connected ? 'Connected' : 'Disconnected';
    }
  }

  // Expose for use in options.js
  window.updateConnectionStatus = updateConnectionStatus;
})();
