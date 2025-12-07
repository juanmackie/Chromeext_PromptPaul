// Enhanced input controls and validation
document.addEventListener('DOMContentLoaded', function () {
  // Simple error handler for non-module context
  const handleError = (error, context = {}) => {
    logger.error('InputControls', 'Input Controls Error:', error, context);

    // Try to show user feedback
    if (typeof window !== 'undefined' && window.loadingManager) {
      window.loadingManager.showToast(
        error.userMessage || error.message || 'An error occurred',
        'error'
      );
    }
  };

  // Simple wrapper for async functions
  const wrapAsync = async (asyncFn, options = {}) => {
    try {
      return await asyncFn();
    } catch (error) {
      handleError(error, options);
      throw error;
    }
  };

  // Simple error creation function
  const createError = (message, options = {}) => {
    const error = new Error(message);
    error.userMessage = options.userMessage || message;
    error.severity = options.severity || 'medium';
    error.category = options.category || 'system';
    error.context = options.context || {};
    return error;
  };

  // Password toggle functionality
  const apiKeyToggle = document.getElementById('apiKeyToggle');
  const apiKeyInput = document.getElementById('apiKey');
  const apiKeyCopy = document.getElementById('apiKeyCopy');

  if (apiKeyToggle && apiKeyInput) {
    apiKeyToggle.addEventListener('click', function () {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      this.querySelector('.material-symbols-outlined').textContent = isPassword
        ? 'visibility_off'
        : 'visibility';
    });
  }

  // Copy button functionality
  if (apiKeyCopy && apiKeyInput) {
    apiKeyCopy.addEventListener('click', async function () {
      await wrapAsync(
        async () => {
          const apiKeyValue = apiKeyInput.value;
          if (!apiKeyValue) {
            throw createError('No API key to copy', {
              category: 'user_input',
              severity: 'low',
              userMessage: 'No API key value to copy',
            });
          }

          await navigator.clipboard.writeText(apiKeyValue);

          // Update UI to show success
          const iconElement = this.querySelector('.material-symbols-outlined');
          if (iconElement) {
            iconElement.textContent = 'check';
            setTimeout(() => {
              iconElement.textContent = 'content_copy';
            }, 2000);
          }
        },
        {
          category: 'system',
          userMessage: 'Failed to copy API key',
          severity: 'low',
        }
      ).catch(async error => {
        handleError(error);

        // Show error state in UI
        const iconElement = this.querySelector('.material-symbols-outlined');
        if (iconElement) {
          iconElement.textContent = 'error';
          setTimeout(() => {
            iconElement.textContent = 'content_copy';
          }, 2000);
        }
      });
    });
  }

  // Token input handling with validation
  const tokenInput = document.getElementById('maxTokens');
  const tokenValue = document.getElementById('tokenValue');

  function syncTokenInputs(value) {
    try {
      if (tokenInput) tokenInput.value = value;
      if (tokenValue) tokenValue.textContent = value;
    } catch (error) {
      handleError(
        createError('Failed to sync token inputs', {
          category: 'SYSTEM',
          severity: 'LOW',
          originalError: error,
          context: { value },
        })
      );
    }
  }

  function validateTokenValue(value) {
    const numValue = parseInt(value, 10);

    if (isNaN(numValue)) {
      throw createError('Token value must be a number', {
        category: 'VALIDATION',
        severity: 'MEDIUM',
        context: { value },
        userMessage: 'Max tokens must be a valid number',
      });
    }

    if (numValue < 1) {
      throw createError('Token value must be at least 1', {
        category: 'VALIDATION',
        severity: 'MEDIUM',
        context: { value },
        userMessage: 'Max tokens must be at least 1',
      });
    }

    if (numValue > 100000) {
      throw createError('Token value cannot exceed 100,000', {
        category: 'VALIDATION',
        severity: 'MEDIUM',
        context: { value },
        userMessage: 'Max tokens cannot exceed 100,000',
      });
    }

    return numValue;
  }

  if (tokenInput) {
    tokenInput.addEventListener('input', function () {
      try {
        const rawValue = this.value;
        if (rawValue === '') {
          syncTokenInputs(16000); // Default value
          return;
        }

        const validatedValue = validateTokenValue(rawValue);
        syncTokenInputs(validatedValue);
      } catch (error) {
        handleError(error).then(() => {
          // Reset to safe default on validation error
          syncTokenInputs(16000);
        });
      }
    });

    // Add error state handling
    tokenInput.addEventListener('invalid', function () {
      handleError(
        createError('Invalid token value', {
          category: 'VALIDATION',
          severity: 'MEDIUM',
          context: { value: this.value },
          userMessage: 'Please enter a valid number between 1 and 100,000',
        })
      );
    });
  }

  // System prompt templates
  const promptTemplate = document.getElementById('promptTemplate');
  const systemPrompt = document.getElementById('systemPrompt');

  const templates = {
    general:
      'You are a helpful, knowledgeable, and friendly AI assistant. Provide clear, accurate, and concise responses while being respectful and professional.',
    code: 'You are an expert code reviewer and programming assistant. Analyze code for best practices, potential bugs, security issues, and suggest improvements. Provide clear explanations and examples.',
    summarizer:
      'You are a professional summarizer. Extract key information and present it in a clear, structured format. Focus on the most important points while maintaining accuracy.',
    analyst:
      'You are a data analyst and insights expert. Analyze information systematically, identify patterns and trends, and provide actionable insights with supporting evidence.',
    writer:
      'You are a creative writing assistant. Help with storytelling, character development, plot structure, and writing style. Provide constructive feedback and creative suggestions.',
  };

  if (promptTemplate && systemPrompt) {
    promptTemplate.addEventListener('change', function () {
      wrapAsync(
        () => {
          if (this.value && templates[this.value]) {
            try {
              systemPrompt.value = templates[this.value];
              updateCharacterCount();
            } catch (error) {
              throw createError('Failed to apply template', {
                category: 'SYSTEM',
                severity: 'LOW',
                originalError: error,
                context: { template: this.value },
                userMessage: 'Failed to apply selected template',
              });
            }
          }
        },
        {
          category: 'USER_INPUT',
          userMessage: 'Failed to change template',
          severity: 'LOW',
        }
      ).catch(async error => {
        handleError(error);
      });
    });
  }

  // Character counter for system prompt
  const charCount = document.getElementById('charCount');

  function updateCharacterCount() {
    try {
      if (charCount && systemPrompt) {
        const count = systemPrompt.value.length;
        charCount.textContent = count;

        // Add visual feedback for length limits
        if (count > 2000) {
          charCount.classList.add('warning');
        } else {
          charCount.classList.remove('warning');
        }
      }
    } catch (error) {
      handleError(
        createError('Failed to update character count', {
          category: 'SYSTEM',
          severity: 'LOW',
          originalError: error,
        })
      );
    }
  }

  if (systemPrompt) {
    systemPrompt.addEventListener('input', function () {
      wrapAsync(() => updateCharacterCount(), {
        category: 'SYSTEM',
        userMessage: 'Failed to update character count',
        severity: 'LOW',
      }).catch(async error => {
        handleError(error);
      });
    });

    // Initialize character count on load
    wrapAsync(() => updateCharacterCount(), {
      category: 'SYSTEM',
      userMessage: 'Failed to initialize character count',
      severity: 'LOW',
    }).catch(async error => {
      await handleError(error);
    });
  }

  // Profile management
  const profileSelect = document.getElementById('profileSelect');
  const deleteProfileButton = document.getElementById('deleteProfileButton');
  const addProfileButton = document.getElementById('addProfileButton');

  if (profileSelect && deleteProfileButton) {
    profileSelect.addEventListener('change', function () {
      wrapAsync(
        () => {
          try {
            deleteProfileButton.disabled = this.value === 'default';
          } catch (error) {
            throw createError('Failed to update delete button state', {
              category: 'SYSTEM',
              severity: 'LOW',
              originalError: error,
              context: { selectedValue: this.value },
            });
          }
        },
        {
          category: 'USER_INPUT',
          userMessage: 'Failed to update profile selection',
          severity: 'LOW',
        }
      ).catch(async error => {
        handleError(error);
      });
    });
  }

  if (addProfileButton) {
    addProfileButton.addEventListener('click', function () {
      wrapAsync(
        async () => {
          const profileName = prompt('Enter a name for the new profile:');
          if (profileName && profileName.trim()) {
            const trimmedName = profileName.trim();

            // Validate profile name
            if (trimmedName.length < 2) {
              throw createError('Profile name must be at least 2 characters', {
                category: 'VALIDATION',
                severity: 'MEDIUM',
                context: { profileName: trimmedName },
                userMessage: 'Profile name must be at least 2 characters long',
              });
            }

            if (trimmedName.length > 50) {
              throw createError('Profile name cannot exceed 50 characters', {
                category: 'VALIDATION',
                severity: 'MEDIUM',
                context: { profileName: trimmedName },
                userMessage: 'Profile name cannot exceed 50 characters',
              });
            }

            // Check for invalid characters
            if (!/^[a-zA-Z0-9\s\-_]+$/.test(trimmedName)) {
              throw createError('Profile name contains invalid characters', {
                category: 'VALIDATION',
                severity: 'MEDIUM',
                context: { profileName: trimmedName },
                userMessage:
                  'Profile name can only contain letters, numbers, spaces, hyphens, and underscores',
              });
            }

            return trimmedName;
          } else {
            throw createError('Profile name cannot be empty', {
              category: 'USER_INPUT',
              severity: 'LOW',
              userMessage: 'Profile name cannot be empty',
            });
          }
        },
        {
          category: 'USER_INPUT',
          userMessage: 'Failed to create new profile',
          severity: 'MEDIUM',
        }
      )
        .then(async profileName => {
          // Add the new profile to the dropdown
          try {
            const option = document.createElement('option');
            option.value = 'profile_' + Date.now();
            option.textContent = profileName;
            profileSelect.add(option);
            profileSelect.value = option.value;

            // Enable delete button for non-default profiles
            if (deleteProfileButton) {
              deleteProfileButton.disabled = false;
            }

            logger.info('InputControls', 'New profile created:', profileName);
          } catch (error) {
            throw createError('Failed to add profile to dropdown', {
              category: 'SYSTEM',
              severity: 'MEDIUM',
              originalError: error,
              context: { profileName },
            });
          }
        })
        .catch(async error => {
          handleError(error);
        });
    });
  }

  if (deleteProfileButton) {
    deleteProfileButton.addEventListener('click', function () {
      const currentProfile = profileSelect?.value;
      if (currentProfile && currentProfile !== 'default') {
        if (
          confirm(
            `Are you sure you want to delete the profile "${currentProfile}"? This action cannot be undone.`
          )
        ) {
          // This would be handled by the main options.js
          logger.info('InputControls', 'Deleting profile:', currentProfile);
        }
      }
    });
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
    llmEndpoint.addEventListener('blur', function () {
      if (this.value && !validateURL(this.value)) {
        showError('llmEndpoint', 'Please enter a valid HTTPS URL');
      } else if (this.value) {
        clearError('llmEndpoint');
      }
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('blur', function () {
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
      const masked =
        key.length > 8
          ? key.substring(0, 4) + '•'.repeat(key.length - 8) + key.substring(key.length - 4)
          : '•'.repeat(key.length);
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
