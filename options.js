// ===== Main Options Script - Orchestrates all option management =====

import { loadingManager } from './loadingManager.js';
import { ProfileManager } from './profileManager.js';
import { InstructionManager } from './instructionManager.js';
import { ToolManager } from './toolManager.js';
import { McpManager } from './mcpManager.js';
import { setupThemeToggle } from './themeUtils.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Options page loaded, initializing managers...');

  // Initialize all managers
  const profileManager = new ProfileManager();
  const instructionManager = new InstructionManager();
  const toolManager = new ToolManager();
  const mcpManager = new McpManager();

  // Expose managers globally for HTML onclick handlers
  window.profileManager = profileManager;
  window.instructionManager = instructionManager;
  window.toolManager = toolManager;
  window.mcpManager = mcpManager;

  // Setup all event handlers
  profileManager.setupEventHandlers();
  instructionManager.setupEventHandlers();
  toolManager.setupEventHandlers();
  mcpManager.setupEventHandlers();

  // Initialize data loading
  try {
    // Load all data in parallel
    await Promise.all([
      profileManager.loadProfiles(),
      instructionManager.loadInstructions(),
      toolManager.loadTools(),
      mcpManager.renderServers(),
      mcpManager.renderLogs()
    ]);

    // Check for instruction migration
    await instructionManager.checkAndPromptInstructionMigration();

    // Setup token controls
    setupTokenControls();

    // Load MCP verbose logs setting
    const mcpResult = await new Promise(resolve => {
      chrome.storage.local.get(['mcpVerboseLogs'], resolve);
    });
    
    const verboseToggle = document.getElementById('mcpVerboseLogsToggle');
    if (verboseToggle) {
      verboseToggle.checked = mcpResult.mcpVerboseLogs || false;
    }

    console.log('Options page initialization complete');
  } catch (error) {
    console.error('Error during options page initialization:', error);
    loadingManager.showToast('Error loading options page: ' + error.message, 'error');
  }

  // Setup tab navigation if present
  setupTabNavigation();

  // Setup refresh buttons
  setupRefreshButtons();

  // Setup basic UI controls
  setupBasicUIControls();
});

function setupTokenControls() {
  const tokenInput = document.getElementById('maxTokens');
  const tokenValue = document.getElementById('tokenValue');

  if (!tokenInput || !tokenValue) return;

  function updateTokenDisplay(value) {
    const numValue = Math.max(1, parseInt(value) || 2048);
    tokenValue.textContent = numValue;
    tokenInput.value = numValue;
  }

  tokenInput.addEventListener('input', (e) => {
    updateTokenDisplay(e.target.value);
  });

  tokenInput.addEventListener('blur', (e) => {
    updateTokenDisplay(e.target.value);
  });

  // Initialize with current value
  const currentValue = tokenInput.value || 16000;
  updateTokenDisplay(currentValue);
}

function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  if (tabButtons.length === 0 || tabContents.length === 0) return;

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      
      // Remove active class from all tabs and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      button.classList.add('active');
      const targetContent = document.getElementById(targetTab);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // Activate first tab by default
  if (tabButtons.length > 0) {
    tabButtons[0].click();
  }
}

function setupRefreshButtons() {
  // MCP logs refresh
  const refreshLogsBtn = document.getElementById('refreshMcpLogsBtn');
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', () => {
      window.mcpManager.renderLogs();
    });
  }

  // MCP servers refresh
  const refreshServersBtn = document.getElementById('refreshMcpServersBtn');
  if (refreshServersBtn) {
    refreshServersBtn.addEventListener('click', () => {
      window.mcpManager.renderServers();
    });
  }

  // General refresh button if present
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      try {
        loadingManager.showToast('Refreshing all data...', 'info');
        
        await Promise.all([
          window.profileManager.loadProfiles(),
          window.instructionManager.loadInstructions(),
          window.toolManager.loadTools(),
          window.mcpManager.renderServers(),
          window.mcpManager.renderLogs()
        ]);
        
        loadingManager.showToast('Data refreshed successfully!', 'success');
      } catch (error) {
        console.error('Error refreshing data:', error);
        loadingManager.showToast('Error refreshing data: ' + error.message, 'error');
      }
    });
  }
}

// Additional utility functions that might be needed by HTML

// Legacy function support for any remaining inline handlers
window.showStatus = (message, isError = false) => {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message;
    status.className = `status ${isError ? 'error' : 'success'}`;
    status.style.display = 'block';
  }

  if (isError) {
    loadingManager.showToast(message, 'error');
  } else {
    loadingManager.showToast(message, 'success');
  }

  if (!isError && status) {
    setTimeout(() => {
      status.style.display = 'none';
    }, 2000);
  }
};

function setupBasicUIControls() {
  // Dark Theme Toggle
  const darkThemeToggle = document.getElementById('darkThemeToggle');
  if (darkThemeToggle) {
    setupThemeToggle(darkThemeToggle);
  }

  // Analytics consent toggle (opt-out, default ON)
  const analyticsConsentToggle = document.getElementById('analyticsConsentToggle');
  if (analyticsConsentToggle) {
    // Initialize from storage (default true when missing)
    chrome.storage.local.get(['analyticsConsent'], (res) => {
      const consent = (res && Object.prototype.hasOwnProperty.call(res, 'analyticsConsent')) ? !!res.analyticsConsent : true;
      analyticsConsentToggle.checked = consent;
    });
    // Persist on change
    analyticsConsentToggle.addEventListener('change', () => {
      const checked = !!analyticsConsentToggle.checked;
      chrome.storage.local.set({ analyticsConsent: checked });
      loadingManager.showToast(`Anonymous analytics ${checked ? 'enabled' : 'disabled'}.`, 'success');
    });
  }

  // Streaming Toggle
  const enableStreamingToggle = document.getElementById('enableStreamingToggle');
  if (enableStreamingToggle) {
    // Load streaming setting
    chrome.storage.sync.get({ enableStreaming: false }, (result) => {
      enableStreamingToggle.checked = !!result.enableStreaming;
    });

    // Save streaming setting on change
    enableStreamingToggle.addEventListener('change', () => {
      const isStreamingEnabled = enableStreamingToggle.checked;
      chrome.storage.sync.set({ enableStreaming: isStreamingEnabled }, () => {
        loadingManager.showToast(`Streaming responses ${isStreamingEnabled ? 'enabled' : 'disabled'}.`, 'success');
      });
    });
  }

  // Revert to defaults button
  const revertButton = document.getElementById('revertDefaultsButton');
  if (revertButton) {
    revertButton.addEventListener('click', () => {
      // Get default values
      const defaultEndpoint = 'https://api.mistral.ai/v1/chat/completions';
      const defaultApiKey = 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF';
      const defaultModelName = 'mistral-small-latest';

      // Set default values in the input fields
      document.getElementById('llmEndpoint').value = defaultEndpoint;
      document.getElementById('apiKey').value = defaultApiKey;
      document.getElementById('modelName').value = defaultModelName;
      document.getElementById('maxTokens').value = '16000';
      document.getElementById('tokenValue').textContent = '16000';

      loadingManager.showToast('Settings reverted to defaults. Click "Save Settings" to apply.', 'success');
    });
  }

  // Listen for storage changes to sync streaming
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enableStreaming) {
      const streamingToggle = document.getElementById('enableStreamingToggle');
      if (streamingToggle) {
        streamingToggle.checked = !!changes.enableStreaming.newValue;
      }
    }
  });

  // Setup collapsible sections
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => {
      const content = header.nextElementSibling;
      content.classList.toggle('expanded');
      header.classList.toggle('expanded');
    });
  });

  // MCP verbose logs toggle
  const mcpVerboseLogsToggle = document.getElementById('mcpVerboseLogsToggle');
  if (mcpVerboseLogsToggle) {
    mcpVerboseLogsToggle.addEventListener('change', () => {
      chrome.storage.local.set({ mcpVerboseLogs: !!mcpVerboseLogsToggle.checked });
      loadingManager.showToast(`MCP verbose logs ${mcpVerboseLogsToggle.checked ? 'enabled' : 'disabled'}.`, 'success');
    });
  }

  // Form submit handler
  const optionsForm = document.getElementById('optionsForm');
  if (optionsForm) {
    optionsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Delegate to profile manager's handleSave method
      if (window.profileManager) {
        window.profileManager.handleSave();
      } else {
        console.error('Profile manager not available for form submission');
        loadingManager.showToast('Error: Profile manager not available', 'error');
      }
    });
  }
}

// Export for debugging
window.optionsDebug = {
  profileManager: window.profileManager,
  instructionManager: window.instructionManager,
  toolManager: window.toolManager,
  mcpManager: window.mcpManager
};

console.log('Options.js initialization complete - all modules loaded successfully');