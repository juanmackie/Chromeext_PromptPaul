// Collapsible functionality for sections
document.addEventListener('DOMContentLoaded', function() {
    // Find all collapsible headers
    const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
    
    collapsibleHeaders.forEach(header => {
        // Add click event listener
        header.addEventListener('click', function() {
            // Find the next sibling that contains collapsible content
            const content = this.parentElement.nextElementSibling;
            const icon = this.querySelector('.collapsible-icon');
            
            if (content && content.classList.contains('collapsible-content')) {
                // Toggle the content visibility
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    icon.textContent = 'expand_less';
                    this.setAttribute('aria-expanded', 'true');
                } else {
                    content.style.display = 'none';
                    icon.textContent = 'expand_more';
                    this.setAttribute('aria-expanded', 'false');
                }
            }
        });
        
        // Set initial state
        header.style.cursor = 'pointer';
        header.setAttribute('aria-expanded', 'true');
        
        // Ensure content is visible by default
        const content = header.parentElement.nextElementSibling;
        if (content && content.classList.contains('collapsible-content')) {
            content.style.display = 'block';
        }
    });
});