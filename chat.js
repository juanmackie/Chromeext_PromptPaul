import { ChatOrchestrator } from './chat/chat-orchestrator.js';
import { applyDarkTheme } from './themeUtils.js';
import { errorHandler, ErrorSeverity, ErrorCategory, createError } from './errorHandler.js';
import { loadingManager } from './loadingManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOMContentLoaded event fired in chat.js");

    try {
        // Expose loading manager globally so chat modules can use it for toasts/loading states
        window.loadingManager = loadingManager;

        // Initialize the Chat Orchestrator
        const chatOrchestrator = new ChatOrchestrator();

        // Initialize the orchestrator (this will setup all modules and event listeners)
        await chatOrchestrator.initialize();

        console.log("Chat: Successfully initialized modular chat system");

                        // Setup theme toggle button (no checkbox)
                        const themeToggleBtn = document.getElementById('theme-toggle-btn');
                        const themeIcon = document.getElementById('theme-icon');
                        
                        // Ensure Material Icons font is loaded (defensive)
                        if (themeIcon && !window.MaterialIconsLoaded) {
                            const link = document.createElement('link');
                            link.rel = 'stylesheet';
                            link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
                            document.head.appendChild(link);
                            window.MaterialIconsLoaded = true;
                        }
                        
                        // Keep the icon in sync whenever the theme changes (e.g. from options page)
                        window.addEventListener('themeChanged', (event) => {
                            const isDark = event?.detail?.isDark;
                            if (typeof isDark === 'boolean' && themeIcon) {
                                themeIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
                            }
                        });
                        
                        if (themeToggleBtn && window.chrome?.storage?.sync) {
                            // Initialize from stored preference, then wire up click handler
                            chrome.storage.sync.get({ darkTheme: false }, (result) => {
                                let isDark = !!result.darkTheme;
                                
                                // Apply initial theme and icon
                                applyDarkTheme(isDark);
                                if (themeIcon) {
                                    themeIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
                                }
                                
                                // Clicking the button toggles the theme and persists it
                                themeToggleBtn.addEventListener('click', () => {
                                    isDark = !isDark;
                                    chrome.storage.sync.set({ darkTheme: isDark });
                                    applyDarkTheme(isDark);
                                    if (themeIcon) {
                                        themeIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
                                    }
                                });
                            });
                        } else if (themeIcon) {
                            // Fallback: initialize icon based on current theme on first load
                            const isDarkTheme =
                                document.body.classList.contains('dark-theme') ||
                                document.documentElement.getAttribute('data-theme') === 'dark';
                            themeIcon.textContent = isDarkTheme ? 'dark_mode' : 'light_mode';
                        }

        // Make orchestrator available globally for debugging and external access
        window.chatOrchestrator = chatOrchestrator;

    } catch (error) {
        console.error("Chat: Failed to initialize modular chat system:", error);
        await errorHandler.handleError(createError('Chat system initialization failed', {
            category: ErrorCategory.SYSTEM,
            severity: ErrorSeverity.CRITICAL,
            originalError: error
        }));

        // Fallback: Show error message to user
        const chatArea = document.getElementById('chat-area');
        if (chatArea) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'chat-error';

            const heading = document.createElement('h3');
            heading.className = 'error-heading';
            heading.textContent = 'Chat System Failed to Initialize';

            const description = document.createElement('p');
            description.className = 'error-description';
            description.textContent = 'Please refresh the page or check the console for details.';

            const refreshButton = document.createElement('button');
            refreshButton.className = 'error-button';
            refreshButton.textContent = 'Refresh Page';
            refreshButton.addEventListener('click', () => location.reload());

            errorDiv.appendChild(heading);
            errorDiv.appendChild(description);
            errorDiv.appendChild(refreshButton);

            chatArea.appendChild(errorDiv);
        }
    }
});

// Export for testing or external use
export { ChatOrchestrator };