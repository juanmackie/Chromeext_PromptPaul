// Enhanced collapsible functionality for sections
document.addEventListener('DOMContentLoaded', () => {
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
    // Extract just the text content excluding icons
    const icon = header.querySelector('.section-icon');
    const collapsibleIcon = header.querySelector('.collapsible-icon');
    let titleText = header.textContent.trim();
    
    // Remove icon text from title if present
    if (icon) {
      titleText = titleText.replace(icon.textContent, '').trim();
    }
    if (collapsibleIcon) {
      titleText = titleText.replace(collapsibleIcon.textContent, '').trim();
    }
    
    return titleText.replace(/\s+/g, '-');
  }

  // Toggle section visibility
  function toggleSection(header, forceState = null) {
    // Find the collapsible content - it's the next sibling of the section-header div
    const sectionHeader = header.parentElement;
    const content = sectionHeader.nextElementSibling;
    const icon = header.querySelector('.collapsible-icon');
    const sectionId = getSectionId(header);

    if (content && content.classList.contains('collapsible-content')) {
      const isExpanded = forceState !== null ? forceState : !content.classList.contains('collapsed');
      const newState = !isExpanded;

      // Update display using CSS classes that match the stylesheet
      if (newState) {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        header.classList.remove('collapsed');
        header.classList.add('expanded');
      } else {
        content.classList.remove('expanded');
        content.classList.add('collapsed');
        header.classList.remove('expanded');
        header.classList.add('collapsed');
      }
      
      // Update icon
      if (icon) {
        icon.textContent = newState ? 'expand_less' : 'expand_more';
      }
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
    const isExpanded = Object.prototype.hasOwnProperty.call(savedStates, sectionId) ? savedStates[sectionId] : true;
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
