import { ChatOrchestrator } from './chat/chat-orchestrator.js';
import { setupThemeToggle } from './themeUtils.js';
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

        // Setup theme toggle with new button structure
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        const darkThemeToggle = document.getElementById('darkThemeToggle');
        if (themeToggleBtn && darkThemeToggle) {
            setupThemeToggle(darkThemeToggle);

            // Add click handler to the button for better UX
            themeToggleBtn.addEventListener('click', () => {
                darkThemeToggle.checked = !darkThemeToggle.checked;
                // Trigger change event to update theme
                darkThemeToggle.dispatchEvent(new Event('change'));
            });
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
            chatArea.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #dc2626;">
                    <h3>Chat System Failed to Initialize</h3>
                    <p>Please refresh the page or check the console for details.</p>
                    <button onclick="location.reload()" style="margin-top: 10px; padding: 8px 16px;">
                        Refresh Page
                    </button>
                </div>
            `;
        }
    }
});

// Export for testing or external use
export { ChatOrchestrator };