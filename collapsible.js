// Enhanced collapsible functionality for sections
document.addEventListener('DOMContentLoaded', function () {
  // Find all collapsible headers
  const collapsibleHeaders = document.querySelectorAll('.collapsible-header');

  // Load saved states from localStorage
  function loadCollapsibleStates() {
    const saved = localStorage.getItem('collapsibleStates');
    return saved ? JSON.parse(saved) : {};
  }

  // Save states to localStorage
  function saveCollapsibleStates(states) {
    localStorage.setItem('collapsibleStates', JSON.stringify(states));
  }

  // Get section identifier from header
  function getSectionId(header) {
    const titleText = header.textContent.trim().toLowerCase();
    return titleText.replace(/\s+/g, '-');
  }

  // Toggle section visibility
  function toggleSection(header, forceState = null) {
    const content = header.parentElement.nextElementSibling;
    const icon = header.querySelector('.collapsible-icon');
    const sectionId = getSectionId(header);

    if (content && content.classList.contains('collapsible-content')) {
      const isExpanded = forceState !== null ? forceState : content.classList.contains('collapsible-collapsed');
      const newState = !isExpanded;

      // Update display
      if (newState) {
        content.classList.remove('collapsible-collapsed');
        content.classList.add('collapsible-expanded');
      } else {
        content.classList.remove('collapsible-expanded');
        content.classList.add('collapsible-collapsed');
      }
      icon.textContent = newState ? 'expand_less' : 'expand_more';
      header.setAttribute('aria-expanded', newState.toString());

      // Save state
      const states = loadCollapsibleStates();
      states[sectionId] = newState;
      saveCollapsibleStates(states);

      return newState;
    }
    return false;
  }

  collapsibleHeaders.forEach(header => {
    const sectionId = getSectionId(header);
    const savedStates = loadCollapsibleStates();

    // Set up accessibility
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.classList.add('collapsible-header');

    // Load saved state or default to expanded
    const isExpanded = savedStates.hasOwnProperty(sectionId) ? savedStates[sectionId] : true;
    toggleSection(header, isExpanded);

    // Click event listener
    header.addEventListener('click', function () {
      toggleSection(this);
    });

    // Keyboard support
    header.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSection(this);
      }
    });

    // Focus styling handled by CSS classes
  });
});
