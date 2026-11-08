/**
 * @fileoverview Custom instruction editing, search, pinning, and import/export.
 * @module OptionsInstructions
 */
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORTED_RECORDS,
  MAX_INSTRUCTION_CONTENT_CHARS,
  MAX_INSTRUCTION_NAME_CHARS,
  MAX_INSTRUCTION_TAG_CHARS,
} from './OptionsLimits.js';
import { escapeHtml } from '../utils/domSanitizer.js';
import { createUniqueId, hashString } from '../utils/ids.js';

function normalizeInstructionId(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .slice(0, 256)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function parseTags(value) {
  if (Array.isArray(value)) {
    return value
      .slice(0, 64)
      .map((tag) =>
        String(tag || '')
          .trim()
          .slice(0, 40)
      )
      .filter(Boolean);
  }
  return String(value || '')
    .slice(0, MAX_INSTRUCTION_TAG_CHARS)
    .split(/[,;\n|]+/g)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeInstructionTags(value) {
  const seen = new Set();
  const tags = [];
  for (const tag of parseTags(value)) {
    const normalized = tag.replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(normalized.slice(0, 40));
    if (tags.length >= 12) break;
  }
  return tags;
}

export function normalizeInstructionRecord(instruction) {
  if (!instruction || typeof instruction !== 'object') return null;
  const name = String(instruction.name || '').trim();
  const content = String(instruction.content || '').trim();
  if (
    !name ||
    !content ||
    name.length > MAX_INSTRUCTION_NAME_CHARS ||
    content.length > MAX_INSTRUCTION_CONTENT_CHARS
  ) {
    return null;
  }
  const tags = normalizeInstructionTags(instruction.tags || []);
  const allowedModalities = new Set(['text', 'image', 'video', 'audio']);
  const modalities = Array.isArray(instruction.modalities)
    ? [...new Set(instruction.modalities.slice(0, 16).map((value) => String(value).trim()))].filter(
        (value) => allowedModalities.has(value)
      )
    : [];
  const normalizedToolChoice = Array.isArray(instruction.tool_choice)
    ? instruction.tool_choice
        .slice(0, 16)
        .map((value) => String(value).trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 16)
    : typeof instruction.tool_choice === 'string'
      ? instruction.tool_choice.trim().slice(0, 64)
      : '';
  const createdAt =
    typeof instruction.createdAt === 'string' && instruction.createdAt.trim()
      ? instruction.createdAt.trim().slice(0, 128)
      : typeof instruction.lastUpdated === 'string' && instruction.lastUpdated.trim()
        ? instruction.lastUpdated.trim().slice(0, 128)
        : new Date().toISOString();
  const lastUpdated =
    typeof instruction.lastUpdated === 'string' && instruction.lastUpdated.trim()
      ? instruction.lastUpdated.trim().slice(0, 128)
      : createdAt;
  const fallbackId = `inst_${hashString(`${name}\n${content}\n${createdAt}`)}`;
  return {
    id: normalizeInstructionId(instruction.id, fallbackId),
    name,
    content,
    tags,
    tool_choice: normalizedToolChoice || 'none',
    modalities: modalities.length > 0 ? modalities : ['text'],
    createdAt,
    lastUpdated,
  };
}

function formatToolChoiceDisplay(toolChoice) {
  if (!toolChoice) return 'None';
  if (Array.isArray(toolChoice)) {
    if (toolChoice.length === 0 || toolChoice.includes('none')) return 'None';
    if (toolChoice.includes('auto')) return 'Auto';
    return toolChoice.join(', ');
  }
  return String(toolChoice).charAt(0).toUpperCase() + String(toolChoice).slice(1);
}

export function getInstructionSearchTerms(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function matchesInstructionSearch(instruction, queryTerms) {
  if (queryTerms.length === 0) return true;
  const haystack = [
    instruction.name,
    instruction.content,
    formatToolChoiceDisplay(instruction.tool_choice),
    (instruction.tags || []).join(' '),
  ]
    .join(' ')
    .toLowerCase();
  return queryTerms.every((term) => haystack.includes(term));
}

export function setupInstructionHandlers({
  showStatus,
  setChromeStorage,
  showConfirmModal,
  populateToolDropdown,
}) {
  const saveInstructionBtn = document.getElementById('saveInstruction');
  const clearFormBtn = document.getElementById('clearForm');
  const instructionSearchInput = document.getElementById('instructionSearch');
  const instructionsCount = document.getElementById('instructionsCount');

  let currentInstructions = [];
  let currentPinnedQuickActions = new Set();
  let instructionSearchQuery = '';

  function renderTagChips(tags) {
    if (!tags || tags.length === 0) {
      return '<span class="instruction-tag-chip" style="opacity: 0.72;">No tags</span>';
    }
    return tags
      .map((tag) => `<span class="instruction-tag-chip">${escapeHtml(tag)}</span>`)
      .join('');
  }

  function updateInstructionsCount(visibleCount, totalCount) {
    if (!instructionsCount) return;
    instructionsCount.textContent =
      visibleCount === totalCount
        ? `${totalCount} instruction${totalCount === 1 ? '' : 's'}`
        : `${visibleCount} of ${totalCount} instructions`;
  }

  function renderInstructions() {
    const tableBody = document.querySelector('#instructionsTable tbody');
    if (!tableBody) return;

    const queryTerms = getInstructionSearchTerms(instructionSearchQuery);
    const visibleInstructions = currentInstructions
      .filter((instruction) => matchesInstructionSearch(instruction, queryTerms))
      .sort((a, b) => {
        const aPinned = currentPinnedQuickActions.has(a.id);
        const bPinned = currentPinnedQuickActions.has(b.id);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });

    tableBody.innerHTML = '';

    if (visibleInstructions.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `
        <td colspan="6" style="text-align:center;color:var(--ext-muted-foreground);padding:1.5rem;">
          ${currentInstructions.length === 0 ? 'No instructions yet.' : 'No instructions match your search.'}
        </td>
      `;
      tableBody.appendChild(emptyRow);
      updateInstructionsCount(0, currentInstructions.length);
      return;
    }

    visibleInstructions.forEach((instruction) => {
      const row = document.createElement('tr');
      const toolChoiceDisplay = formatToolChoiceDisplay(instruction.tool_choice);
      const tagsHtml = renderTagChips(instruction.tags || []);
      row.innerHTML = `
        <td data-label="Name">${escapeHtml(instruction.name)}</td>
        <td data-label="Tags"><div class="instruction-tags-cell">${tagsHtml}</div></td>
        <td data-label="Content">${escapeHtml(instruction.content)}</td>
        <td data-label="Tool Choice">${escapeHtml(toolChoiceDisplay)}</td>
        <td data-label="Pin"><button class="pin-btn${currentPinnedQuickActions.has(instruction.id) ? ' pinned' : ''}" data-id="${escapeHtml(instruction.id)}" title="${currentPinnedQuickActions.has(instruction.id) ? 'Unpin from Quick Actions' : 'Pin to Quick Actions'}"><span class="material-symbols-outlined">${currentPinnedQuickActions.has(instruction.id) ? 'keep_off' : 'push_pin'}</span></button></td>
        <td data-label="Actions">
          <div class="instruction-actions">
            <button class="edit-btn" data-id="${escapeHtml(instruction.id)}">Edit</button>
            <button class="improve-btn" data-id="${escapeHtml(instruction.id)}">Improve</button>
            <button class="delete-btn" data-id="${escapeHtml(instruction.id)}">Delete</button>
          </div>
        </td>
      `;
      tableBody.appendChild(row);
    });

    updateInstructionsCount(visibleInstructions.length, currentInstructions.length);

    document.querySelectorAll('.pin-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const instructionId = button.dataset.id;
        chrome.storage.local.get(['pinnedQuickActions'], (result) => {
          let pinnedQuickActions = result.pinnedQuickActions || [];
          const isPinned = pinnedQuickActions.includes(instructionId);

          if (isPinned) {
            pinnedQuickActions = pinnedQuickActions.filter((id) => id !== instructionId);
            showStatus('Instruction unpinned from Quick Actions.');
          } else {
            pinnedQuickActions.push(instructionId);
            showStatus('Instruction pinned to Quick Actions.');
          }

          chrome.storage.local.set({ pinnedQuickActions }, () => {
            currentPinnedQuickActions = new Set(pinnedQuickActions);
            renderInstructions();
          });
        });
      });
    });

    document.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const instructionId = e.currentTarget.dataset.id;
        const instruction = currentInstructions.find((item) => item.id === instructionId);
        if (instruction) {
          document.getElementById('instructionName').value = instruction.name;
          document.getElementById('instructionContent').value = instruction.content;
          document.getElementById('instructionTags').value = (instruction.tags || []).join(', ');
          document.getElementById('instructionId').value = instruction.id;

          const toolChoiceInput = document.getElementById('instructionToolChoice');
          if (toolChoiceInput) {
            if (Array.isArray(instruction.tool_choice)) {
              toolChoiceInput.value = instruction.tool_choice.join(', ');
            } else if (instruction.tool_choice) {
              toolChoiceInput.value = instruction.tool_choice;
            } else {
              toolChoiceInput.value = 'none';
            }
          }

          const modalities = instruction.modalities || ['text'];
          document.getElementById('modalityText').checked = modalities.includes('text');
          document.getElementById('modalityImage').checked = modalities.includes('image');
          document.getElementById('modalityVideo').checked = modalities.includes('video');
          document.getElementById('modalityAudio').checked = modalities.includes('audio');
        }
      });
    });

    document.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const instructionId = e.currentTarget.dataset.id;
        if (confirm('Are you sure you want to delete this instruction?')) {
          chrome.storage.local.get(['instructions'], (result) => {
            let instructions = result.instructions || [];
            instructions = instructions.filter((item) => item.id !== instructionId);
            chrome.storage.local.set({ instructions }, () => {
              showStatus('Instruction deleted.');
              refreshInstructions();
              if (document.getElementById('instructionId').value === instructionId) {
                clearForm();
              }
            });
          });
        }
      });
    });

    document.querySelectorAll('.improve-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const instructionId = e.currentTarget.dataset.id;
        const instruction = currentInstructions.find((item) => item.id === instructionId);
        if (instruction) {
          showStatus('Improving instruction...', false, true);
          try {
            // P2-06: route the improvement through the background worker so the
            // request is provider-aware, bounded, and keeps credentials
            // background-owned. API profiles get a working flow; Codex/Hermes
            // receive an explicit capability message. On any failure the editor
            // is left untouched so the original instruction stays intact.
            const response = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { action: 'improveInstruction', prompt: instruction.content },
                resolve
              );
            });
            if (!response || response.success !== true || typeof response.content !== 'string') {
              const message =
                response && response.capability === 'unsupported'
                  ? response.error || 'Improve Instruction is not supported for this profile.'
                  : (response && response.error) || 'Improve request failed.';
              showStatus('Failed to improve instruction: ' + message, true);
              return;
            }

            document.getElementById('instructionName').value = instruction.name;
            document.getElementById('instructionContent').value = response.content.trim();
            document.getElementById('instructionTags').value = (instruction.tags || []).join(', ');
            document.getElementById('instructionId').value = instruction.id;

            showStatus('Instruction improved. Review and save.', false, true);
          } catch (error) {
            console.error('Error improving instruction:', error);
            showStatus('Failed to improve instruction: ' + error.message, true);
          }
        }
      });
    });
  }

  function refreshInstructions() {
    chrome.storage.local.get(['instructions', 'pinnedQuickActions'], (result) => {
      currentInstructions = (result.instructions || [])
        .map(normalizeInstructionRecord)
        .filter(Boolean);
      currentPinnedQuickActions = new Set(result.pinnedQuickActions || []);
      renderInstructions();
    });
  }

  // Save instruction handler
  if (saveInstructionBtn) {
    saveInstructionBtn.addEventListener('click', () => {
      const instructionName = document.getElementById('instructionName').value.trim();
      const instructionContent = document.getElementById('instructionContent').value.trim();
      const instructionTags = document.getElementById('instructionTags').value.trim();
      const instructionId = document.getElementById('instructionId').value;
      const toolChoiceInput = document.getElementById('instructionToolChoice');
      const toolChoiceValue = toolChoiceInput.value.trim();
      const tags = normalizeInstructionTags(instructionTags);

      // Get selected modalities
      const modalities = [];
      if (document.getElementById('modalityText').checked) modalities.push('text');
      if (document.getElementById('modalityImage').checked) modalities.push('image');
      if (document.getElementById('modalityVideo').checked) modalities.push('video');
      if (document.getElementById('modalityAudio').checked) modalities.push('audio');

      if (!instructionName || !instructionContent) {
        showStatus('Instruction name and content are required.', true);
        return;
      }
      if (
        instructionName.length > MAX_INSTRUCTION_NAME_CHARS ||
        instructionContent.length > MAX_INSTRUCTION_CONTENT_CHARS
      ) {
        showStatus(
          `Instruction name must be ${MAX_INSTRUCTION_NAME_CHARS} characters or less and content must be ${MAX_INSTRUCTION_CONTENT_CHARS} characters or less.`,
          true
        );
        return;
      }

      chrome.storage.local.get(['instructions'], (result) => {
        const existingInstructions = (Array.isArray(result.instructions) ? result.instructions : [])
          .map(normalizeInstructionRecord)
          .filter(Boolean)
          .slice(0, MAX_IMPORTED_RECORDS);
        const now = new Date().toISOString();
        const existingInstruction = existingInstructions.find((inst) => inst.id === instructionId);
        const savedInstruction = normalizeInstructionRecord({
          id: instructionId || createUniqueId('inst'),
          name: instructionName,
          content: instructionContent,
          tags,
          tool_choice: toolChoiceValue || 'none',
          modalities,
          createdAt: existingInstruction?.createdAt || now,
          lastUpdated: now,
        });
        if (!savedInstruction) {
          showStatus('Instruction could not be saved.', true);
          return;
        }

        const instructions = instructionId
          ? existingInstructions.map((inst) =>
              inst.id === instructionId ? savedInstruction : inst
            )
          : [...existingInstructions, savedInstruction].slice(0, MAX_IMPORTED_RECORDS);
        setChromeStorage(chrome.storage.local, { instructions })
          .then(() => {
            showStatus(instructionId ? 'Instruction updated.' : 'Instruction added.');
            refreshInstructions();
            resetInstructionForm();
          })
          .catch((error) => {
            showStatus(`Instruction could not be saved: ${error.message}`, true);
          });
      });
    });
  }

  // Clear form handler
  if (clearFormBtn) {
    clearFormBtn.addEventListener('click', clearForm);
  }

  function resetInstructionForm() {
    document.getElementById('instructionName').value = '';
    document.getElementById('instructionContent').value = '';
    document.getElementById('instructionTags').value = '';
    document.getElementById('instructionId').value = '';
    document.getElementById('instructionToolChoice').value = '';

    // Reset modality checkboxes - Text checked by default, others unchecked
    document.getElementById('modalityText').checked = true;
    document.getElementById('modalityImage').checked = false;
    document.getElementById('modalityVideo').checked = false;
    document.getElementById('modalityAudio').checked = false;
  }
  async function clearForm() {
    // Check if form has any content that would be lost
    const name = document.getElementById('instructionName').value;
    const content = document.getElementById('instructionContent').value;
    const hasContent = name.trim() !== '' || content.trim() !== '';

    // Only confirm if there's actual content to clear
    if (hasContent) {
      const confirmed = await showConfirmModal(
        'Clear the form? Unsaved changes will be lost.',
        'Clear Form',
        'Clear'
      );
      if (!confirmed) {
        return; // User cancelled
      }
    }

    resetInstructionForm();

    showStatus('Form cleared.');
  }

  // Export instructions handler
  document.getElementById('exportInstructions').addEventListener('click', () => {
    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const exportData = {
        version: 1, // Versioning for future compatibility
        instructions: instructions,
      };
      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', dataStr);
      downloadAnchorNode.setAttribute('download', 'prompt_paul_instructions.json');
      document.body.appendChild(downloadAnchorNode); // Required for Firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  // Import instructions handler
  document.getElementById('importInstructions').addEventListener('click', () => {
    document.getElementById('importFile').click(); // Trigger the hidden file input
  });

  document.getElementById('importFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      showStatus('Instruction import file is too large.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.instructions)) {
          if (importData.instructions.length > MAX_IMPORTED_RECORDS) {
            showStatus(`Import contains more than ${MAX_IMPORTED_RECORDS} instructions.`, true);
            return;
          }
          // Simple merge strategy: add new instructions, update existing by ID
          chrome.storage.local.get(['instructions'], (result) => {
            const existingInstructions = (
              Array.isArray(result.instructions) ? result.instructions : []
            )
              .map(normalizeInstructionRecord)
              .filter(Boolean)
              .slice(0, MAX_IMPORTED_RECORDS);
            const importedInstructions = importData.instructions
              .map(normalizeInstructionRecord)
              .filter(Boolean);

            importedInstructions.forEach((importedInst) => {
              const existingIndex = existingInstructions.findIndex(
                (inst) => inst.id === importedInst.id
              );
              if (existingIndex > -1) {
                // Update existing instruction
                existingInstructions[existingIndex] = {
                  ...importedInst,
                  createdAt:
                    existingInstructions[existingIndex].createdAt || importedInst.createdAt,
                  lastUpdated: new Date().toISOString(),
                };
              } else {
                // Add new instruction
                existingInstructions.push({
                  ...importedInst,
                  id: importedInst.id || createUniqueId('inst'),
                  createdAt: importedInst.createdAt || new Date().toISOString(),
                  lastUpdated: new Date().toISOString(),
                });
              }
            });

            chrome.storage.local.set(
              { instructions: existingInstructions.slice(0, MAX_IMPORTED_RECORDS) },
              () => {
                showStatus('Instructions imported successfully.');
                refreshInstructions();
              }
            );
          });
        } else {
          showStatus('Invalid import file format.', true);
        }
      } catch (error) {
        console.error('Error importing instructions:', error);
        showStatus('Error reading or parsing import file.', true);
      }
    };
    reader.readAsText(file);
  });

  // Initial load of instructions and tools
  refreshInstructions();
  populateToolDropdown(); // Populate tool dropdown on load

  if (instructionSearchInput) {
    instructionSearchInput.addEventListener('input', (event) => {
      instructionSearchQuery = event.target.value || '';
      renderInstructions();
    });

    instructionSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && instructionSearchInput.value) {
        instructionSearchInput.value = '';
        instructionSearchQuery = '';
        renderInstructions();
        event.preventDefault();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (!isSearchShortcut) return;
    event.preventDefault();
    if (instructionSearchInput) {
      instructionSearchInput.focus();
      instructionSearchInput.select();
    }
  });

  window.setupInstructionHandlers = setupInstructionHandlers;
  window.loadInstructions = refreshInstructions;
}
