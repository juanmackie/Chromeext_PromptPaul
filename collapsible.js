document.addEventListener('DOMContentLoaded', () => {
    const collapsibleButtons = document.querySelectorAll('.collapsible-button');

    collapsibleButtons.forEach(button => {
        button.addEventListener('click', () => {
            const content = button.nextElementSibling; // The content is the next sibling element
            if (content) {
                if (content.classList.contains('collapsed')) {
                    content.style.maxHeight = content.scrollHeight + 'px';
                    content.classList.remove('collapsed');
                    content.classList.add('expanded'); // Add expanded class
                    button.querySelector('.material-symbols-outlined').textContent = 'expand_less';
                } else {
                    content.style.maxHeight = '0';
                    content.classList.remove('expanded'); // Remove expanded class
                    content.classList.add('collapsed');
                    button.querySelector('.material-symbols-outlined').textContent = 'expand_more';
                }
            }
        });
    });
});