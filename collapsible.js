// Collapsible functionality
const collapsible = document.querySelector('.collapsible');
if (collapsible) {
  collapsible.addEventListener('click', function() {
    this.classList.toggle('active');
    const content = this.nextElementSibling;
    if (content.style.maxHeight) {
      content.style.maxHeight = null;
    } else {
      content.style.maxHeight = content.scrollHeight + 'px';
    }
  });
}

// Instruction toggle functionality
const instructionToggles = document.querySelectorAll('.instruction-toggle');
instructionToggles.forEach(toggle => {
  toggle.addEventListener('change', function() {
    const instructionName = this.nextElementSibling.textContent;
    if (this.checked) {
      console.log(`Activated instruction: ${instructionName}`);
      // Add logic to activate instruction in context menu
    } else {
      console.log(`Deactivated instruction: ${instructionName}`);
      // Add logic to deactivate instruction from context menu
    }
  });
});