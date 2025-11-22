import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync } from '../errorHandler.js';
import { storageService } from '../services/storage-service.js';

/**
 * UI Components Manager
 * Handles UI interactions, dropdown population, mobile cards, theme management, and form controls
 * Centralizes all DOM manipulation and UI state management
 */
export class UIComponents {
    constructor(showStatusCallback, loadingManager) {
        this.showStatus = showStatusCallback;
        this.loadingManager = loadingManager;
        
        // Cache DOM elements
        this.elements = {};
        this.initializeElementCache();
    }

    /**
     * Initialize DOM element cache for performance
     */
    initializeElementCache() {
        const elementIds = [
            'profileSelect', 'deleteProfileButton', 'llmEndpoint', 'apiKey', 'modelName', 
            'maxTokens', 'tokenValue', 'systemPrompt', 'saveButton', 'revertDefaultsButton',
            'instructionName', 'instructionContent', 'instructionId', 'instructionToolChoice',
            'modalityText', 'modalityImage', 'modalityVideo', 'modalityAudio',
            'saveInstruction', 'clearForm', 'instructionsTable', 'instructions-cards',
            'toolName', 'toolDescription', 'toolParameters', 'toolEndpointUrl', 'toolHttpMethod',
            'toolId', 'saveTool', 'clearToolForm', 'toolsTable', 'tools-cards',
            'analyticsConsentToggle', 'enableStreamingToggle',
            'migrationPrompt', 'exportInstructions', 'importInstructions', 'importFile',
            'exportTools', 'importTools', 'importToolsFile'
        ];

        elementIds.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    }

    /**
     * Update current configuration display
     * @param {Object} config - Configuration object
     */
    updateCurrentConfigDisplay(config) {
        return wrapAsync(() => {
            const {
                llmEndpoint,
                apiKey,
                modelName,
                timestamp,
                systemPrompt,
                profile,
                maxTokens
            } = config;

            try {
                // Update configuration display elements
                this.updateElementText('currentEndpoint', llmEndpoint || 'Not set');
                this.updateElementText('currentApiKey', apiKey ? '********' + apiKey.slice(-4) : 'Not set');
                this.updateElementText('currentModelName', modelName || 'Not set');
                this.updateElementText('lastUpdated', timestamp || 'Not set');
                this.updateElementText('currentSystemPrompt', systemPrompt || 'Not set');
                this.updateElementText('currentProfile', profile || 'Default');
                
                if (maxTokens !== undefined) {
                    this.updateElementText('currentMaxTokens', maxTokens);
                }

            } catch (domError) {
                throw createError('Failed to update configuration display', {
                    category: ErrorCategory.SYSTEM,
                    severity: ErrorSeverity.MEDIUM,
                    originalError: domError,
                    context: { hasEndpoint: !!llmEndpoint, hasModel: !!modelName }
                });
            }
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to update configuration display',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Update element text content safely
     * @param {string} elementId - Element ID
     * @param {string} text - Text content
     */
    updateElementText(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    }

    /**
     * Populate profile dropdown
     * @param {Array} profiles - Array of profile objects
     * @param {string} selectedProfileId - Currently selected profile ID
     */
    populateProfileDropdown(profiles, selectedProfileId) {
        return wrapAsync(() => {
            const profileSelect = this.elements.profileSelect;
            if (!profileSelect) {
                throw createError('Profile select dropdown not found', {
                    category: ErrorCategory.SYSTEM,
                    severity: ErrorSeverity.MEDIUM,
                    userMessage: 'Profile dropdown not found'
                });
            }

            // Clear existing options
            profileSelect.innerHTML = '';

            // Add "Add New Profile" option
            const addNewOption = document.createElement('option');
            addNewOption.value = 'add_new_profile';
            addNewOption.textContent = '+ Add New Profile...';
            profileSelect.appendChild(addNewOption);
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = 'Default';
            profileSelect.appendChild(defaultOption);

            // Add custom profiles
            if (profiles && profiles.length > 0) {
                profiles.forEach(profile => {
                    if (profile.id === 'default') return; // Skip default if already added
                    const option = document.createElement('option');
                    option.value = profile.id;
                    option.textContent = profile.name;
                    profileSelect.appendChild(option);
                });
            }

            profileSelect.value = selectedProfileId || 'default';
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to populate profile dropdown',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Populate instruction table
     * @param {Array} instructions - Array of instruction objects
     * @param {InstructionManager} instructionManager - Instruction manager instance
     */
    populateInstructionTable(instructions, instructionManager) {
        return wrapAsync(() => {
            const tableBody = document.querySelector('#instructionsTable tbody');
            if (!tableBody) return;

            tableBody.innerHTML = '';

            instructions.forEach(instruction => {
                const row = this.createInstructionTableRow(instruction, instructionManager);
                tableBody.appendChild(row);
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to populate instruction table',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Create instruction table row
     * @param {Object} instruction - Instruction object
     * @param {InstructionManager} instructionManager - Instruction manager instance
     * @returns {HTMLElement} Table row element
     */
    createInstructionTableRow(instruction, instructionManager) {
        const row = document.createElement('tr');
        
        const toolChoiceDisplay = instructionManager.formatToolChoiceDisplay(instruction.tool_choice);
        
        row.innerHTML = `
            <td data-label="Name">${instruction.name}</td>
            <td data-label="Content">${instruction.content}</td>
            <td data-label="Tool Choice">${toolChoiceDisplay}</td>
            <td data-label="Pin">
                <button class="pin-btn" data-id="${instruction.id}" title="Toggle Pin">
                    <span class="material-symbols-outlined">hourglass_empty</span>
                </button>
            </td>
            <td data-label="Actions" class="actions-cell">
                <button class="quick-action-button pinned-action edit-btn" data-id="${instruction.id}" title="Edit instruction">
                    <span class="material-icons">edit</span>
                </button>
                <button class="ext-btn improve-btn" data-id="${instruction.id}">Improve</button>
                <button class="quick-action-button pinned-action delete-btn" data-id="${instruction.id}" title="Delete instruction">
                    <span class="material-icons">delete</span>
                </button>
            </td>
        `;

        // Update pin button state asynchronously
        this.updatePinButtonState(row.querySelector(`.pin-btn[data-id="${instruction.id}"]`), instruction.id);
        
        return row;
    }

    /**
     * Update pin button state
     * @param {HTMLElement} pinButton - Pin button element
     * @param {string} instructionId - Instruction ID
     */
    async updatePinButtonState(pinButton, instructionId) {
        if (!pinButton) return;
        
        const isPinned = await storageService.getLocal(['pinnedQuickActions'])
            .then(result => (result.pinnedQuickActions || []).includes(instructionId));
        
        if (isPinned) {
            pinButton.innerHTML = '<span class="material-symbols-outlined">keep_off</span>';
            pinButton.classList.add('pinned');
            pinButton.title = 'Unpin from Quick Actions';
        } else {
            pinButton.innerHTML = '<span class="material-symbols-outlined">push_pin</span>';
            pinButton.classList.remove('pinned');
            pinButton.title = 'Pin to Quick Actions';
        }
    }

    /**
     * Generate mobile instruction cards
     * @param {Array} instructions - Array of instruction objects
     * @param {InstructionManager} instructionManager - Instruction manager instance
     */
    generateMobileInstructionCards(instructions, instructionManager) {
        return wrapAsync(() => {
            const container = this.elements['instructions-cards'];
            if (!container) return;

            container.innerHTML = '';

            instructions.forEach(instruction => {
                const card = this.createInstructionCard(instruction, instructionManager);
                container.appendChild(card);
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to generate instruction cards',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Create instruction card for mobile view
     * @param {Object} instruction - Instruction object
     * @param {InstructionManager} instructionManager - Instruction manager instance
     * @returns {HTMLElement} Card element
     */
    createInstructionCard(instruction, instructionManager) {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('data-id', instruction.id);
        
        const toolChoiceDisplay = instructionManager.formatToolChoiceDisplay(instruction.tool_choice);
        const modalities = (instruction.modalities || ['text']).join(', ');
        
        card.innerHTML = `
            <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; justify-content: space-between;">
                <div>
                    <h3 style="font-size: 1.1rem; margin: 0 0 8px 0; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${instruction.name}</h3>
                    <p style="font-size: 0.8rem; color: #666; margin: 0; height: 60px; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;">${instruction.content}</p>
                </div>
                <div style="font-size: 0.75rem; color: #555; margin: 10px 0;">
                    <div><strong>Tool:</strong> ${toolChoiceDisplay}</div>
                    <div><strong>Modalities:</strong> ${modalities}</div>
                </div>
                <div style="display: flex; gap: 6px; margin-top: 10px;">
                    <button class="pin-btn" data-id="${instruction.id}">
                        <span class="material-symbols-outlined">push_pin</span>
                    </button>
                    <button class="ext-btn ext-btn-secondary edit-btn" data-id="${instruction.id}">
                        Edit
                    </button>
                    <button class="ext-btn ext-btn-destructive delete-btn" data-id="${instruction.id}">
                        Delete
                    </button>
                </div>
            </div>
        `;

        // Update pin button state
        this.updatePinButtonState(card.querySelector(`.pin-btn[data-id="${instruction.id}"]`), instruction.id);
        
        return card;
    }

    /**
     * Populate tool dropdown
     * @param {Array} tools - Array of tool objects
     */
    populateToolDropdown(tools) {
        return wrapAsync(() => {
            const toolChoiceSelect = this.elements.instructionToolChoice;
            if (!toolChoiceSelect) {
                console.error("instructionToolChoice dropdown not found!");
                return;
            }

            // Clear existing tool options (keep the first two: None and Auto)
            while (toolChoiceSelect.options.length > 2) {
                toolChoiceSelect.remove(toolChoiceSelect.options.length - 1);
            }

            if (tools && tools.length > 0) {
                // Add a separator
                const separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '------ Tools ------';
                toolChoiceSelect.appendChild(separator);

                // Add tools to the dropdown
                tools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.name;
                    option.textContent = tool.name;
                    toolChoiceSelect.appendChild(option);
                });
            }
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to populate tool dropdown',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Populate tool table
     * @param {Array} tools - Array of tool objects
     */
    populateToolTable(tools) {
        return wrapAsync(() => {
            const tableBody = document.querySelector('#toolsTable tbody');
            if (!tableBody) return;

            tableBody.innerHTML = '';

            tools.forEach(tool => {
                const row = this.createToolTableRow(tool);
                tableBody.appendChild(row);
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to populate tool table',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Create tool table row
     * @param {Object} tool - Tool object
     * @returns {HTMLElement} Table row element
     */
    createToolTableRow(tool) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="Name">${tool.name}</td>
            <td data-label="Description">${tool.description}</td>
            <td data-label="Actions">
                <button class="ext-btn ext-btn-secondary edit-tool-btn" data-id="${tool.id}">Edit</button>
                <button class="ext-btn ext-btn-destructive delete-tool-btn" data-id="${tool.id}">Delete</button>
            </td>
        `;
        return row;
    }

    /**
     * Generate mobile tool cards
     * @param {Array} tools - Array of tool objects
     */
    generateMobileToolCards(tools) {
        return wrapAsync(() => {
            const container = this.elements['tools-cards'];
            if (!container) return;

            container.innerHTML = '';

            tools.forEach(tool => {
                const card = this.createToolCard(tool);
                container.appendChild(card);
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to generate tool cards',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Create tool card for mobile view
     * @param {Object} tool - Tool object
     * @returns {HTMLElement} Card element
     */
    createToolCard(tool) {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('data-id', tool.id);
        
        card.innerHTML = `
            <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; justify-content: space-between;">
                <div>
                    <h3 style="font-size: 1.1rem; margin: 0 0 8px 0; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${tool.name}</h3>
                    <p style="font-size: 0.8rem; color: #666; margin: 0; height: 80px; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;">${tool.description}</p>
                </div>
                <div style="font-size: 0.75rem; color: #555; margin: 10px 0;">
                    <div><strong>Endpoint:</strong> ${tool.endpointUrl || 'N/A'}</div>
                    <div><strong>Method:</strong> ${tool.httpMethod || 'Auto'}</div>
                </div>
                <div style="display: flex; gap: 6px; margin-top: 10px;">
                    <button class="ext-btn ext-btn-secondary edit-tool-btn" data-id="${tool.id}">
                        Edit
                    </button>
                    <button class="ext-btn ext-btn-destructive delete-tool-btn" data-id="${tool.id}">
                        Delete
                    </button>
                </div>
            </div>
        `;
        
        return card;
    }

    /**
     * Setup token input controls
     */
    setupTokenControls() {
        return wrapAsync(() => {
            const numberInput = this.elements.maxTokens;
            const tokenValueDisplay = this.elements.tokenValue;
            
            if (!numberInput || !tokenValueDisplay) return;

            // Clamp helper function
            const clamp = (v) => {
                const min = Number(numberInput.min) || 1;
                const max = Number(numberInput.max) || 100000;
                v = Math.round(Number(v) || 0);
                if (v < min) v = min;
                if (v > max) v = max;
                return v;
            };

            const updateFrom = (v) => {
                const val = clamp(v);
                numberInput.value = String(val);
                tokenValueDisplay.textContent = String(val);
            };

            // Initialize display
            updateFrom(numberInput.value || 16000);

            // Add event listeners
            numberInput.addEventListener('input', e => updateFrom(e.target.value));
            numberInput.addEventListener('blur', () => updateFrom(numberInput.value));
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to setup token controls',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Setup theme toggle
     * @param {Function} setupThemeToggle - Theme setup function from themeUtils
     */
    setupThemeToggle(setupThemeToggle) {
        return wrapAsync(() => {
            if (!setupThemeToggle) {
                return;
            }

            // Use the dedicated checkbox on the options page so we can
            // leverage shared themeUtils (chrome.storage + applyDarkTheme)
            const toggleElement = document.getElementById('optionsThemeToggle');

            if (toggleElement && toggleElement instanceof HTMLInputElement) {
                // Delegate all behavior to shared theme toggle wiring
                setupThemeToggle(toggleElement);
            }
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to setup theme toggle',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Setup analytics consent toggle
     */
    setupAnalyticsToggle() {
        return wrapAsync(async () => {
            const analyticsToggle = this.elements.analyticsConsentToggle;
            if (!analyticsToggle) return;

            // Initialize from storage (default true when missing)
            const result = await storageService.getLocal(['analyticsConsent']);
            const consent = Object.prototype.hasOwnProperty.call(result, 'analyticsConsent') ? !!result.analyticsConsent : true;
            analyticsToggle.checked = consent;

            // Persist on change
            analyticsToggle.addEventListener('change', () => {
                const checked = !!analyticsToggle.checked;
                storageService.setLocal({ analyticsConsent: checked });
                this.showStatus(`Anonymous analytics ${checked ? 'enabled' : 'disabled'}.`, false, true);
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to setup analytics toggle',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Setup streaming toggle
     */
    setupStreamingToggle() {
        return wrapAsync(async () => {
            const streamingToggle = this.elements.enableStreamingToggle;
            if (!streamingToggle) return;

            // Load streaming setting
            const result = await storageService.getSync({ enableStreaming: false });
            streamingToggle.checked = !!result.enableStreaming;

            // Save streaming setting on change
            streamingToggle.addEventListener('change', () => {
                const isStreamingEnabled = streamingToggle.checked;
                storageService.setSync({ enableStreaming: isStreamingEnabled });
                this.showStatus(`Streaming responses ${isStreamingEnabled ? 'enabled' : 'disabled'}.`, false, true);
            });

            // Listen for storage changes to sync streaming
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'sync' && changes.enableStreaming && streamingToggle) {
                    streamingToggle.checked = !!changes.enableStreaming.newValue;
                }
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to setup streaming toggle',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Setup collapsible headers
     */
    setupCollapsibleHeaders() {
        return wrapAsync(() => {
            document.querySelectorAll('.collapsible-header').forEach(header => {
                header.addEventListener('click', () => {
                    const content = header.nextElementSibling;
                    if (content) {
                        content.classList.toggle('expanded');
                        header.classList.toggle('expanded');
                    }
                });
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to setup collapsible headers',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Set button loading state
     * @param {HTMLElement} button - Button element
     * @param {boolean} isLoading - Loading state
     */
    setButtonLoading(button, isLoading) {
        if (!button) return;
        
        if (this.loadingManager && this.loadingManager.setButtonLoading) {
            this.loadingManager.setButtonLoading(button, isLoading);
        } else {
            button.disabled = isLoading;
            button.textContent = isLoading ? 'Loading...' : 'Send';
        }
    }

    /**
     * Clear form fields
     * @param {Array} fieldIds - Array of field IDs to clear
     */
    clearFormFields(fieldIds) {
        return wrapAsync(() => {
            fieldIds.forEach(fieldId => {
                const element = this.elements[fieldId];
                if (element) {
                    if (element.type === 'checkbox') {
                        element.checked = false;
                    } else {
                        element.value = '';
                    }
                }
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to clear form fields',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Populate form fields with data
     * @param {Object} data - Data to populate
     * @param {Object} fieldMappings - Field ID to data property mappings
     */
    populateFormFields(data, fieldMappings) {
        return wrapAsync(() => {
            Object.entries(fieldMappings).forEach(([fieldId, dataProperty]) => {
                const element = this.elements[fieldId];
                if (element && data.hasOwnProperty(dataProperty)) {
                    if (element.type === 'checkbox') {
                        element.checked = !!data[dataProperty];
                    } else {
                        element.value = data[dataProperty] || '';
                    }
                }
            });
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to populate form fields',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Show migration prompt
     */
    showMigrationPrompt() {
        const migrationPrompt = this.elements.migrationPrompt;
        if (migrationPrompt) {
            migrationPrompt.style.display = 'block';
        }
    }

    /**
     * Hide migration prompt
     */
    hideMigrationPrompt() {
        const migrationPrompt = this.elements.migrationPrompt;
        if (migrationPrompt) {
            migrationPrompt.style.display = 'none';
        }
    }

    /**
     * Get cached element
     * @param {string} elementId - Element ID
     * @returns {HTMLElement|null} Element or null
     */
    getElement(elementId) {
        return this.elements[elementId] || document.getElementById(elementId);
    }
}