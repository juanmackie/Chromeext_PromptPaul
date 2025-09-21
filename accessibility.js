// Initialize accessibility features
document.addEventListener('DOMContentLoaded', function() {
  // Keyboard navigation for collapsible sections
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.click();
      }
    });
  });
});