// Chat message animations
(function() {
    // Staggered message reveal
    const chatArea = document.getElementById('chat-area');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('message-visible');
            }
        });
    }, { threshold: 0.1 });

    // Magnetic button effect for send button
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
        sendButton.addEventListener('mousemove', (e) => {
            const rect = sendButton.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            
            // Subtle magnetic pull effect
            sendButton.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
        });

        sendButton.addEventListener('mouseleave', () => {
            sendButton.style.transform = '';
        });
    }

    // Voice button pulse animation
    const voiceButton = document.getElementById('voice-toggle-button');
    if (voiceButton) {
        voiceButton.addEventListener('click', () => {
            voiceButton.classList.toggle('voice-active');
        });
    }

    // Expose chat area observer for chat.js
    window.chatMessageObserver = observer;
})();
