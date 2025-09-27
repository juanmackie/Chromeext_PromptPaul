// ===== Profile Management Module =====

import { loadingManager } from './loadingManager.js';

class ProfileManager {
  constructor() {
    this.currentProfileId = 'default';
  }

  showStatus(message, isError = false, isToast = false) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.className = `status ${isError ? 'error' : 'success'}`;
      status.style.display = 'block';
      
      if (!isError) { // Apply timeout for both success and toast messages, but not errors
        setTimeout(() => {
          status.style.display = 'none';
        }, isToast ? 5000 : 2000);
      }
    } else {
      console.warn('Status element not found in DOM, message:', message);
    }

    // Also show toast notification
    if (isError) {
      loadingManager.showToast(message, 'error');
    } else {
      loadingManager.showToast(message, 'success');
    }
  }

  updateCurrentConfig(endpoint, key, model, timestamp, systemPrompt, profile, maxTokens) {
    const updates = [
      { id: 'currentEndpoint', value: endpoint || 'Not set' },
      { id: 'currentApiKey', value: key ? '••••••••' : 'Not set' },
      { id: 'currentModelName', value: model || 'Not set' },
      { id: 'lastUpdated', value: timestamp || 'Never' },
      { id: 'currentSystemPrompt', value: systemPrompt || 'Not set' },
      { id: 'currentProfile', value: profile || 'default' },
      { id: 'currentMaxTokens', value: maxTokens || '2048' }
    ];

    updates.forEach(({ id, value }) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = value;
      } else {
        console.warn(`Element with id '${id}' not found in DOM`);
      }
    });
  }

  validateInputs(endpoint, key, model) {
    if (!endpoint || !key || !model) {
      this.showStatus('Please fill in all required fields (Endpoint, API Key, and Model).', true);
      return false;
    }

    if (!this.isValidURL(endpoint)) {
      this.showStatus('Please enter a valid API endpoint URL.', true);
      return false;
    }

    return true;
  }

  isValidURL(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  async saveProfile(profileData) {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['profiles'], resolve);
      });

      let profiles = result.profiles || [];
      
      // Find existing profile or create new one
      const existingIndex = profiles.findIndex(p => p.id === profileData.id);
      if (existingIndex >= 0) {
        profiles[existingIndex] = profileData;
      } else {
        profiles.push(profileData);
      }

      // Save profiles
      await new Promise(resolve => {
        chrome.storage.local.set({
          profiles: profiles,
          lastSelectedProfileId: profileData.id
        }, resolve);
      });

      this.showStatus('Profile saved successfully!');
      return true;
    } catch (error) {
      console.error('Error saving profile:', error);
      this.showStatus('Error saving profile: ' + error.message, true);
      return false;
    }
  }

  async loadProfiles() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], resolve);
      });

      let profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';

      // Ensure default profile exists
      const defaultProfile = profiles.find(p => p.id === 'default');
      if (!defaultProfile) {
        const newDefaultProfile = {
          id: 'default',
          name: 'Default Profile',
          llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
          apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
          modelName: 'mistral-small-latest',
          systemPrompt: '',
          maxTokens: 16000,
          createdAt: Date.now(),
          lastUpdated: Date.now()
        };
        profiles.unshift(newDefaultProfile);
        
        // Save the updated profiles with default
        await new Promise(resolve => {
          chrome.storage.local.set({ profiles: profiles }, resolve);
        });
      }

      this.populateProfileDropdown(profiles, lastSelectedProfileId);
      
      const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId) || profiles.find(p => p.id === 'default') || profiles[0];
      if (selectedProfile) {
        this.loadProfileSettings(selectedProfile.id);
      }

      return profiles;
    } catch (error) {
      console.error('Error loading profiles:', error);
      this.showStatus('Error loading profiles: ' + error.message, true);
      return [];
    }
  }

  populateProfileDropdown(profiles, selectedId) {
    const profileSelect = document.getElementById('profileSelect');
    if (!profileSelect) return;

    profileSelect.innerHTML = '';
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'Default Profile';
    profileSelect.appendChild(defaultOption);

    // Add other profiles
    profiles.forEach(profile => {
      if (profile.id !== 'default') {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name || profile.id;
        profileSelect.appendChild(option);
      }
    });

    profileSelect.value = selectedId;
  }

  async loadProfileSettings(profileId) {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['profiles'], resolve);
      });

      const profiles = result.profiles || [];
      const profile = profiles.find(p => p.id === profileId);

      if (profile) {
        // Update form fields
        const endpointInput = document.getElementById('llmEndpoint');
        const keyInput = document.getElementById('apiKey');
        const modelInput = document.getElementById('modelName');
        const systemPromptInput = document.getElementById('systemPrompt');
        const maxTokensInput = document.getElementById('maxTokens');

        if (endpointInput) endpointInput.value = profile.llmEndpoint || '';
        if (keyInput) keyInput.value = profile.apiKey || '';
        if (modelInput) modelInput.value = profile.modelName || '';
        if (systemPromptInput) systemPromptInput.value = profile.systemPrompt || '';
        if (maxTokensInput) maxTokensInput.value = profile.maxTokens || '2048';

        // Update current config display
        this.updateCurrentConfig(
          profile.llmEndpoint,
          profile.apiKey,
          profile.modelName,
          profile.lastUpdated ? new Date(profile.lastUpdated).toLocaleString() : null,
          profile.systemPrompt,
          profile.name || profileId,
          profile.maxTokens
        );

        this.currentProfileId = profileId;
      }
    } catch (error) {
      console.error('Error loading profile settings:', error);
      this.showStatus('Error loading profile settings: ' + error.message, true);
    }
  }

  async createNewProfile(name) {
    const profileId = 'profile_' + Date.now();
    const profileData = {
      id: profileId,
      name: name,
      llmEndpoint: '',
      apiKey: '',
      modelName: '',
      systemPrompt: '',
      maxTokens: 2048,
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };

    const saved = await this.saveProfile(profileData);
    if (saved) {
      await this.loadProfiles();
      return profileId;
    }
    return null;
  }

  async deleteProfile(profileId) {
    if (profileId === 'default') {
      this.showStatus('Cannot delete the default profile.', true);
      return false;
    }

    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['profiles'], resolve);
      });

      let profiles = result.profiles || [];
      profiles = profiles.filter(p => p.id !== profileId);

      await new Promise(resolve => {
        chrome.storage.local.set({
          profiles: profiles,
          lastSelectedProfileId: 'default'
        }, resolve);
      });

      this.showStatus('Profile deleted successfully!');
      await this.loadProfiles();
      return true;
    } catch (error) {
      console.error('Error deleting profile:', error);
      this.showStatus('Error deleting profile: ' + error.message, true);
      return false;
    }
  }

  setupEventHandlers() {
    // Profile selection handler
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
      profileSelect.addEventListener('change', (e) => {
        this.loadProfileSettings(e.target.value);
      });
    }

    // New profile button
    const newProfileBtn = document.getElementById('addProfileButton');
    if (newProfileBtn) {
      newProfileBtn.addEventListener('click', () => {
        const name = prompt('Enter profile name:');
        if (name && name.trim()) {
          this.createNewProfile(name.trim());
        }
      });
    }

    // Delete profile button
    const deleteProfileBtn = document.getElementById('deleteProfileButton');
    if (deleteProfileBtn) {
      deleteProfileBtn.addEventListener('click', () => {
        if (this.currentProfileId === 'default') {
          this.showStatus('Cannot delete the default profile.', true);
          return;
        }
        
        if (confirm(`Are you sure you want to delete this profile?`)) {
          this.deleteProfile(this.currentProfileId);
        }
      });
    }

    // Save button
    const saveBtn = document.getElementById('save');
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleSave();
      });
    }
  }

  async handleSave() {
    const endpoint = document.getElementById('llmEndpoint')?.value.trim();
    const key = document.getElementById('apiKey')?.value.trim();
    const model = document.getElementById('modelName')?.value.trim();
    const systemPrompt = document.getElementById('systemPrompt')?.value.trim();
    const maxTokens = parseInt(document.getElementById('maxTokens')?.value) || 2048;

    if (!this.validateInputs(endpoint, key, model)) {
      return;
    }

    const profileData = {
      id: this.currentProfileId,
      name: this.currentProfileId === 'default' ? 'Default Profile' : 
            document.getElementById('profileSelect')?.selectedOptions[0]?.textContent || this.currentProfileId,
      llmEndpoint: endpoint,
      apiKey: key,
      modelName: model,
      systemPrompt: systemPrompt,
      maxTokens: maxTokens,
      lastUpdated: Date.now()
    };

    await this.saveProfile(profileData);
  }
}

export { ProfileManager };