// ===== Instruction Management Module (Options page integration) =====

import { loadingManager } from './loadingManager.js';

class InstructionManager {
  constructor() {
    this.instructions = [];
  }

  showStatus(message, isError = false) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.className = `status ${isError ? 'error' : 'success'}`;
      status.style.display = 'block';
      if (!isError) setTimeout(() => (status.style.display = 'none'), 2000);
    }
    loadingManager.showToast(message, isError ? 'error' : 'success');
  }

  // Load instructions, render UI, and populate tool dropdown
  async loadInstructions() {
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['instructions'], resolve);
      });
      this.instructions = result.instructions || [];
      this.renderTable();
      await this.populateToolDropdown();
      return this.instructions;
    } catch (error) {
      console.error('Error loading instructions:', error);
      this.showStatus('Error loading instructions: ' + error.message, true);
      return [];
    }
  }

  // Populate the tool choice dropdown from saved tools
  async populateToolDropdown() {
    const select = document.getElementById('instructionToolChoice');
    if (!select) return;

    // Keep first two options (None, Auto)
    while (select.options.length > 2) select.remove(select.options.length - 1);

    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['promptPaulTools'], resolve);
      });
      const tools = result.promptPaulTools || [];
      tools.forEach((tool) => {
        const opt = document.createElement('option');
        opt.value = tool.name;
        opt.textContent = tool.name;
        select.appendChild(opt);
      });
    } catch (e) {
      console.error('Error loading tools for dropdown:', e);
    }
  }

  // Render instructions into the table (and mobile cards container if needed)
  renderTable() {
    const tbody = document.querySelector('#instructionsTable tbody');
    const cards = document.getElementById('instructions-cards');
    if (tbody) tbody.innerHTML = '';
    if (cards) cards.innerHTML = '';

    if (!this.instructions || this.instructions.length === 0) {
      if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5">No instructions found. Add your first instruction below.</td>';
        tbody.appendChild(tr);
      }
      return;
    }

    this.instructions.forEach((inst) => {
      // Table row
      if (tbody) {
        const tr = document.createElement('tr');
        const toolChoiceDisplay = this.formatToolChoice(inst.tool_choice);
        tr.innerHTML = `
          <td data-label="Name">${this.escapeHtml(inst.name || '')}</td>
          <td data-label="Content">${this.escapeHtml(inst.content || '')}</td>
          <td data-label="Tool Choice">${toolChoiceDisplay}</td>
          <td data-label="Pin"><button class="pin-btn" data-id="${inst.id}" title="Pin to Quick Actions"><span class="material-symbols-outlined">push_pin</span></button></td>
          <td data-label="Actions">
            <button class="edit-btn" data-id="${inst.id}">Edit</button>
            <button class="delete-btn" data-id="${inst.id}">Delete</button>
          </td>`;
        tbody.appendChild(tr);
        // Update pin icon state async
        setTimeout(() => this.updatePinButton(tr.querySelector('.pin-btn'), inst.id), 0);
      }

      // Mobile card
      if (cards) {
        const card = document.createElement('div');
        card.className = 'mobile-card';
        const toolChoiceDisplay = this.formatToolChoice(inst.tool_choice);
        card.innerHTML = `
          <div class="card-row"><strong>Name:</strong> ${this.escapeHtml(inst.name || '')}</div>
          <div class="card-row"><strong>Content:</strong> ${this.escapeHtml(inst.content || '')}</div>
          <div class="card-row"><strong>Tool Choice:</strong> ${toolChoiceDisplay}</div>
          <div class="card-actions">
            <button class="pin-btn" data-id="${inst.id}" title="Pin to Quick Actions"><span class="material-symbols-outlined">push_pin</span></button>
            <button class="edit-btn" data-id="${inst.id}">Edit</button>
            <button class="delete-btn" data-id="${inst.id}">Delete</button>
          </div>`;
        cards.appendChild(card);
        setTimeout(() => this.updatePinButton(card.querySelector('.pin-btn'), inst.id), 0);
      }
    });
  }

  formatToolChoice(toolChoice) {
    if (!toolChoice) return 'None';
    if (Array.isArray(toolChoice)) {
      if (toolChoice.length === 0 || toolChoice.includes('none')) return 'None';
      if (toolChoice.includes('auto')) return 'Auto';
      return toolChoice.join(', ');
    }
    if (typeof toolChoice === 'string') {
      const v = toolChoice.trim();
      if (!v || v === 'none') return 'None';
      if (v === 'auto') return 'Auto';
      return v;
    }
    return 'None';
  }

  updatePinButton(button, instructionId) {
    if (!button) return;
    chrome.storage.local.get(['pinnedQuickActions'], (result) => {
      const pinnedQuickActions = result.pinnedQuickActions || [];
      const isPinned = pinnedQuickActions.includes(instructionId);
      
      if (isPinned) {
        button.innerHTML = '<span class="material-symbols-outlined">push_pin</span>';
        button.classList.add('pinned');
        button.title = 'Unpin from Quick Actions';
        // Show that it's pinned by rotating the pin
        const icon = button.querySelector('.material-symbols-outlined');
        if (icon) {
          icon.style.transform = 'rotate(45deg)'; // Rotated 45deg to show pinned state
          icon.style.color = '#22c55e'; // Green color to indicate pinned state
        }
      } else {
        button.innerHTML = '<span class="material-symbols-outlined">push_pin</span>';
        button.classList.remove('pinned');
        button.title = 'Pin to Quick Actions';
        const icon = button.querySelector('.material-symbols-outlined');
        if (icon) {
          icon.style.transform = 'rotate(0deg)'; // Normal rotation
          icon.style.color = ''; // Default color
        }
      }
    });
  }

  // Read values from the form
  readForm() {
    const name = document.getElementById('instructionName')?.value.trim() || '';
    const content = document.getElementById('instructionContent')?.value.trim() || '';
    const toolChoice = document.getElementById('instructionToolChoice')?.value || 'none';

    const modalities = [];
    if (document.getElementById('modalityText')?.checked) modalities.push('text');
    if (document.getElementById('modalityImage')?.checked) modalities.push('image');
    if (document.getElementById('modalityVideo')?.checked) modalities.push('video');
    if (document.getElementById('modalityAudio')?.checked) modalities.push('audio');

    const id = document.getElementById('instructionId')?.value || null;

    return { id, name, content, tool_choice: toolChoice, modalities };
  }

  // Write values to the form
  writeForm(inst) {
    document.getElementById('instructionName').value = inst.name || '';
    document.getElementById('instructionContent').value = inst.content || '';
    document.getElementById('instructionId').value = inst.id || '';
    const toolChoice = document.getElementById('instructionToolChoice');
    if (toolChoice) toolChoice.value = Array.isArray(inst.tool_choice) ? (inst.tool_choice[0] || 'none') : (inst.tool_choice || 'none');

    document.getElementById('modalityText').checked = (inst.modalities || ['text']).includes('text');
    document.getElementById('modalityImage').checked = (inst.modalities || []).includes('image');
    document.getElementById('modalityVideo').checked = (inst.modalities || []).includes('video');
    document.getElementById('modalityAudio').checked = (inst.modalities || []).includes('audio');
  }

  clearForm() {
    this.writeForm({ id: '', name: '', content: '', tool_choice: 'none', modalities: ['text'] });
  }

  // Save or update instruction
  async saveInstruction() {
    const { id, name, content, tool_choice, modalities } = this.readForm();
    if (!name || !content) {
      this.showStatus('Please fill in Instruction Name and Content.', true);
      return;
    }

    const newId = id || `inst_${Date.now()}`;

    // Find existing or create new
    const idx = this.instructions.findIndex((i) => i.id === newId);
    const record = { id: newId, name, content, tool_choice, modalities };
    if (idx >= 0) this.instructions[idx] = { ...this.instructions[idx], ...record };
    else this.instructions.push(record);

    await new Promise((resolve) => chrome.storage.local.set({ instructions: this.instructions }, resolve));
    this.showStatus('Instruction saved successfully!');
    this.clearForm();
    this.renderTable();
  }

  // Edit by id
  editInstructionById(id) {
    const inst = this.instructions.find((i) => i.id === id);
    if (!inst) return this.showStatus('Instruction not found.', true);
    this.writeForm(inst);
    document.querySelector('.instruction-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  // Delete by id
  async deleteInstructionById(id) {
    if (!confirm('Are you sure you want to delete this instruction?')) return;
    this.instructions = this.instructions.filter((i) => i.id !== id);
    await new Promise((resolve) => chrome.storage.local.set({ instructions: this.instructions }, resolve));
    this.showStatus('Instruction deleted successfully!');
    this.renderTable();
    const currentId = document.getElementById('instructionId')?.value;
    if (currentId === id) this.clearForm();
  }

  // Pin/unpin quick action
  async togglePin(id, button) {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['pinnedQuickActions'], resolve);
      });
      let pinned = result.pinnedQuickActions || [];
      const isPinned = pinned.includes(id);
      if (isPinned) {
        pinned = pinned.filter((x) => x !== id);
      } else {
        pinned.push(id);
      }
      await new Promise(resolve => {
        chrome.storage.local.set({ pinnedQuickActions: pinned }, resolve);
      });
      // Update the button state immediately
      this.updatePinButton(button, id);
      this.showStatus(isPinned ? 'Instruction unpinned.' : 'Instruction pinned.');
      
      // Also notify the chat UI to update the pinned actions (if it's open)
      try {
        // Send a message to update pinned actions in chat UI
        chrome.runtime.sendMessage({ action: 'updatePinnedActions' });
      } catch (e) {
        // If chat UI is not available, that's fine
      }
    } catch (error) {
      console.error('Error toggling pin:', error);
      this.showStatus('Error toggling pin: ' + error.message, true);
    }
  }

  exportInstructions() {
    try {
      const dataStr = JSON.stringify(this.instructions, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'instructions.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.showStatus('Instructions exported successfully!');
    } catch (e) {
      console.error('Export failed:', e);
      this.showStatus('Error exporting instructions: ' + e.message, true);
    }
  }

  async importInstructionsFromFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error('Invalid file format. Expected an array of instructions.');

      // Normalize imported structure (support both old and new formats)
      const normalized = imported.map((inst) => ({
        id: inst.id || `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: inst.name || inst.title || '',
        content: inst.content || inst.prompt || '',
        tool_choice: Array.isArray(inst.tool_choice) ? inst.tool_choice[0] || 'none' : (inst.tool_choice || 'none'),
        modalities: inst.modalities || (inst.supportsImages ? ['text', 'image'] : ['text'])
      })).filter((i) => i.name && i.content);

      // Merge without duplicates by id
      const existingIds = new Set(this.instructions.map((i) => i.id));
      const toAdd = normalized.filter((i) => !existingIds.has(i.id));
      this.instructions = [...this.instructions, ...toAdd];

      await new Promise((resolve) => chrome.storage.local.set({ instructions: this.instructions }, resolve));
      this.renderTable();
      this.showStatus(`Successfully imported ${toAdd.length} instructions!`);
    } catch (e) {
      console.error('Import failed:', e);
      this.showStatus('Error importing instructions: ' + e.message, true);
    }
  }

  // Migration: show prompt to move from sync to local if applicable
  async checkAndPromptInstructionMigration() {
    try {
      const syncResult = await new Promise((resolve) => chrome.storage.sync.get(['instructions'], resolve));
      const localResult = await new Promise((resolve) => chrome.storage.local.get(['instructions'], resolve));
      const syncInstructions = syncResult.instructions || [];
      const localInstructions = localResult.instructions || [];

      const promptEl = document.getElementById('migrationPrompt');
      const migrateBtn = document.getElementById('migrateInstructionsBtn');
      const dismissBtn = document.getElementById('dismissMigrationBtn');

      if (!promptEl || !migrateBtn || !dismissBtn) return; // Not present on page

      if (syncInstructions.length > 0 && localInstructions.length === 0) {
        promptEl.style.display = 'block';
        migrateBtn.addEventListener('click', async () => {
          await new Promise((resolve) => chrome.storage.local.set({ instructions: syncInstructions }, resolve));
          await new Promise((resolve) => chrome.storage.sync.set({ instructions: [] }, resolve));
          promptEl.style.display = 'none';
          this.instructions = syncInstructions;
          this.renderTable();
          this.showStatus('Instructions migrated to this device only!', false);
        });
        dismissBtn.addEventListener('click', () => {
          promptEl.style.display = 'none';
        });
      }
    } catch (e) {
      console.error('Migration check failed:', e);
    }
  }

  // Wire up page event handlers
  setupEventHandlers() {
    // Save / Clear
    const saveBtn = document.getElementById('saveInstruction');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveInstruction());
    const clearBtn = document.getElementById('clearForm');
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearForm());

    // Export / Import
    const exportBtn = document.getElementById('exportInstructions');
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportInstructions());
    const importBtn = document.getElementById('importInstructions');
    const importFile = document.getElementById('importFile');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', (e) => this.importInstructionsFromFile(e.target.files?.[0] || null));
    }

    // Table and cards action delegation
    const tbody = document.querySelector('#instructionsTable tbody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        if (btn.classList.contains('edit-btn')) this.editInstructionById(id);
        else if (btn.classList.contains('delete-btn')) this.deleteInstructionById(id);
        else if (btn.classList.contains('pin-btn')) this.togglePin(id, btn);
      });
    }

    const cards = document.getElementById('instructions-cards');
    if (cards) {
      cards.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        if (btn.classList.contains('edit-btn')) this.editInstructionById(id);
        else if (btn.classList.contains('delete-btn')) this.deleteInstructionById(id);
        else if (btn.classList.contains('pin-btn')) this.togglePin(id, btn);
      });
    }
  }

  // Utilities
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
}

export { InstructionManager };
