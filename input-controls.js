// Enhanced input controls and validation
document.addEventListener('DOMContentLoaded', function() {
    
    // Password toggle functionality
    const apiKeyToggle = document.getElementById('apiKeyToggle');
    const apiKeyInput = document.getElementById('apiKey');
    const apiKeyCopy = document.getElementById('apiKeyCopy');
    
    if (apiKeyToggle && apiKeyInput) {
        apiKeyToggle.addEventListener('click', function() {
            const isPassword = apiKeyInput.type === 'password';
            apiKeyInput.type = isPassword ? 'text' : 'password';
            this.querySelector('.material-symbols-outlined').textContent = 
                isPassword ? 'visibility_off' : 'visibility';
        });
    }
    
    // Copy button functionality
    if (apiKeyCopy && apiKeyInput) {
        apiKeyCopy.addEventListener('click', async function() {
            try {
                await navigator.clipboard.writeText(apiKeyInput.value);
                this.querySelector('.material-symbols-outlined').textContent = 'check';
                setTimeout(() => {
                    this.querySelector('.material-symbols-outlined').textContent = 'content_copy';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });
    }
    
    
    
    // System prompt templates
    const promptTemplate = document.getElementById('promptTemplate');
    const systemPrompt = document.getElementById('systemPrompt');
    
    const templates = {
        general: "You are a helpful, knowledgeable, and friendly AI assistant. Provide clear, accurate, and concise responses while being respectful and professional.",
        code: "You are an expert code reviewer and programming assistant. Analyze code for best practices, potential bugs, security issues, and suggest improvements. Provide clear explanations and examples.",
        summarizer: "You are a professional summarizer. Extract key information and present it in a clear, structured format. Focus on the most important points while maintaining accuracy.",
        analyst: "You are a data analyst and insights expert. Analyze information systematically, identify patterns and trends, and provide actionable insights with supporting evidence.",
        writer: "You are a creative writing assistant. Help with storytelling, character development, plot structure, and writing style. Provide constructive feedback and creative suggestions."
    };
    
    if (promptTemplate && systemPrompt) {
        promptTemplate.addEventListener('change', function() {
            if (this.value && templates[this.value]) {
                systemPrompt.value = templates[this.value];
                updateCharacterCount();
            }
        });
    }
    
    // Character counter for system prompt
    const charCount = document.getElementById('charCount');
    
    function updateCharacterCount() {
        if (charCount && systemPrompt) {
            charCount.textContent = systemPrompt.value.length;
        }
    }
    
    if (systemPrompt) {
        systemPrompt.addEventListener('input', updateCharacterCount);
        updateCharacterCount(); // Initial count
    }
    
    // Validation functions
    function validateURL(url) {
        try {
            new URL(url);
            return url.startsWith('https://');
        } catch {
            return false;
        }
    }
    
    function validateJSON(jsonString) {
        try {
            JSON.parse(jsonString);
            return true;
        } catch {
            return false;
        }
    }
    
    function showError(fieldId, message) {
        const errorElement = document.getElementById(fieldId + 'Error');
        const inputElement = document.getElementById(fieldId);
        
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
        
        if (inputElement) {
            inputElement.classList.add('error');
            inputElement.classList.remove('success');
        }
    }
    
    function clearError(fieldId) {
        const errorElement = document.getElementById(fieldId + 'Error');
        const inputElement = document.getElementById(fieldId);
        
        if (errorElement) {
            errorElement.classList.remove('show');
        }
        
        if (inputElement) {
            inputElement.classList.remove('error');
            inputElement.classList.add('success');
        }
    }
    
    // Real-time validation
    const llmEndpoint = document.getElementById('llmEndpoint');
    if (llmEndpoint) {
        llmEndpoint.addEventListener('blur', function() {
            if (this.value && !validateURL(this.value)) {
                showError('llmEndpoint', 'Please enter a valid HTTPS URL');
            } else if (this.value) {
                clearError('llmEndpoint');
            }
        });
    }
    
    if (apiKeyInput) {
        apiKeyInput.addEventListener('blur', function() {
            if (this.value && this.value.length < 10) {
                showError('apiKey', 'API key seems too short');
            } else if (this.value) {
                clearError('apiKey');
            }
        });
    }
    
    // Update About section with masked API key
    function updateAboutSection() {
        const currentApiKey = document.getElementById('currentApiKey');
        if (currentApiKey && apiKeyInput && apiKeyInput.value) {
            const key = apiKeyInput.value;
            const masked = key.length > 8 ? 
                key.substring(0, 4) + '•'.repeat(key.length - 8) + key.substring(key.length - 4) :
                '•'.repeat(key.length);
            currentApiKey.textContent = masked;
        }
    }
    
    // Listen for API key changes to update About section
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', updateAboutSection);
    }
    
    // Initialize
    updateCharacterCount();
    updateAboutSection();
});

// Export validation functions for use in options.js
window.inputControls = {
    validateURL: function(url) {
        try {
            new URL(url);
            return url.startsWith('https://');
        } catch {
            return false;
        }
    },
    validateJSON: function(jsonString) {
        try {
            JSON.parse(jsonString);
            return true;
        } catch {
            return false;
        }
    },
    showError: function(fieldId, message) {
        const errorElement = document.getElementById(fieldId + 'Error');
        const inputElement = document.getElementById(fieldId);
        
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
        
        if (inputElement) {
            inputElement.classList.add('error');
            inputElement.classList.remove('success');
        }
    },
    clearError: function(fieldId) {
        const errorElement = document.getElementById(fieldId + 'Error');
        const inputElement = document.getElementById(fieldId);
        
        if (errorElement) {
            errorElement.classList.remove('show');
        }
        
        if (inputElement) {
            inputElement.classList.remove('error');
            inputElement.classList.add('success');
        }
    }
};
