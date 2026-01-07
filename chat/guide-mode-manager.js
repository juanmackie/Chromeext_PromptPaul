import { apiClient } from '../services/api-client.js';
import logger from '../utils/logger.js';

export class GuideModeManager {
    constructor(orchestrator, conversationManager, messageRenderer, uiManager) {
        this.orchestrator = orchestrator;
        this.conversationManager = conversationManager;
        this.messageRenderer = messageRenderer;
        this.uiManager = uiManager;

        // State
        this.isActive = false;
        this.goal = '';
        this.intervalId = null;
        this.pollingIntervalMs = 45000; // 45 seconds
        this.lastContentHash = null;
        this.countdownValue = 0;
        this.countdownIntervalId = null;

        this.insightHistory = []; // Track recent insights for context
        this.maxHistoryItems = 5;

        // UI Elements
        this.toggleBtn = document.getElementById('guide-mode-toggle-btn');
        this.panel = document.getElementById('guide-mode-panel');
        this.closePanelBtn = document.getElementById('close-guide-panel');
        this.goalInput = document.getElementById('guide-goal');
        this.startBtn = document.getElementById('start-guide-btn');
        this.stopBtn = document.getElementById('stop-guide-btn');
        this.statusIndicator = document.getElementById('guide-status-indicator');
        this.countdownDisplay = document.getElementById('guide-countdown');
        this.collapseBtn = document.getElementById('toggle-collapse-guide');

        this.init();
    }

    async init() {
        await this.loadState();
        this.setupEventListeners();
        this.setupStorageListener();
        this.setupTabListener();

        if (this.isActive) {
            this.resumeGuide();
        }
    }

    async loadState() {
        const result = await chrome.storage.local.get(['guideModeState']);
        if (result.guideModeState) {
            const state = result.guideModeState;
            // Disable auto-resume to prevent unwanted polling on startup
            this.isActive = false; // state.isActive || false;
            this.goal = state.goal || '';
            this.insightHistory = state.insightHistory || [];
            if (this.goalInput instanceof HTMLTextAreaElement || this.goalInput instanceof HTMLInputElement) {
                this.goalInput.value = this.goal;
            }
        }
    }

    async saveState() {
        await chrome.storage.local.set({
            guideModeState: {
                isActive: this.isActive,
                goal: this.goal,
                insightHistory: this.insightHistory
            }
        });
    }

    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.guideModeState) {
                const newState = changes.guideModeState.newValue;
                if (!newState) return;

                // Sync local state
                const wasActive = this.isActive;
                this.isActive = newState.isActive;
                this.goal = newState.goal;
                this.insightHistory = newState.insightHistory;

                // Update UI and timers
                if (this.isActive && !wasActive) {
                    this.resumeGuide(false); // Don't save back to storage
                } else if (!this.isActive && wasActive) {
                    this.stopGuide(false); // Don't save back to storage
                } else if (this.isActive && wasActive) {
                    // Goal or history might have changed
                    if (this.goalInput instanceof HTMLTextAreaElement || this.goalInput instanceof HTMLInputElement) {
                        this.goalInput.value = this.goal;
                    }
                }
            }
        });
    }

    setupTabListener() {
        // Listen for tab changes to trigger immediate poll when active
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            if (this.isActive) {
                console.log('[GuideMode] Tab switched, triggering immediate poll...');
                // Reset countdown for visual feedback
                this.countdownValue = Math.floor(this.pollingIntervalMs / 1000);
                this.updateCountdownDisplay();
                await this.poll();
            }
        });
    }

    setupEventListeners() {
        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', () => this.togglePanel());
        }

        if (this.closePanelBtn) {
            this.closePanelBtn.addEventListener('click', () => this.hidePanel());
        }

        if (this.startBtn) {
            this.startBtn.addEventListener('click', () => this.startGuide());
        }

        if (this.stopBtn) {
            this.stopBtn.addEventListener('click', () => this.stopGuide());
        }

        if (this.collapseBtn) {
            this.collapseBtn.addEventListener('click', () => this.toggleCollapse());
        }
    }

    togglePanel() {
        if (this.panel.style.display === 'none') {
            this.showPanel();
        } else {
            this.hidePanel();
        }
    }

    toggleCollapse() {
        if (!this.panel) return;

        const isCollapsed = this.panel.classList.toggle('collapsed');
        const icon = this.collapseBtn.querySelector('.material-icons');

        if (icon) {
            icon.textContent = isCollapsed ? 'expand_more' : 'expand_less';
        }
    }

    async pollIfActive() {
        if (this.isActive) {
            await this.poll();
        }
    }

    async resumeGuide(save = true) {
        // Update UI
        this.startBtn.style.display = 'none';
        this.stopBtn.style.display = 'inline-block';
        this.statusIndicator.style.display = 'flex';
        if (this.goalInput instanceof HTMLTextAreaElement || this.goalInput instanceof HTMLInputElement) {
            this.goalInput.disabled = true;
            this.goalInput.value = this.goal;
        }

        if (this.toggleBtn) {
            this.toggleBtn.classList.add('active-guide');
        }

        if (save) await this.saveState();

        // Trigger first poll immediately
        await this.poll();

        // Start interval
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.poll(), this.pollingIntervalMs);

        // Start countdown
        this.startCountdown();
    }

    showPanel() {
        this.panel.style.display = 'block';
        this.goalInput.focus();
    }

    hidePanel() {
        this.panel.style.display = 'none';
    }

    async startGuide() {
        let goal = '';
        if (this.goalInput instanceof HTMLTextAreaElement || this.goalInput instanceof HTMLInputElement) {
            goal = this.goalInput.value.trim();
        }
        if (!goal) {
            this.uiManager.showToast('Please enter a goal first.', 'error');
            return;
        }

        this.goal = goal;
        this.isActive = true;

        this.uiManager.showToast('Guide Mode Activated', 'success');
        await this.resumeGuide(true);
    }

    startCountdown() {
        if (this.countdownIntervalId) clearInterval(this.countdownIntervalId);

        this.countdownValue = Math.floor(this.pollingIntervalMs / 1000);
        this.updateCountdownDisplay();

        this.countdownIntervalId = setInterval(() => {
            this.countdownValue--;
            if (this.countdownValue < 0) {
                // The poll() method handles resetting the countdown value
                // but we keep it at 0 until the poll resets it to avoid negative numbers
                this.countdownValue = 0;
            }
            this.updateCountdownDisplay();
        }, 1000);
    }

    updateCountdownDisplay() {
        if (this.countdownDisplay) {
            // Only update if it doesn't say "Restricted" or if we are actively counting down
            const isRestricted = this.countdownDisplay.textContent.toLowerCase().includes('restricted');
            if (this.countdownValue > 0 || !isRestricted) {
                this.countdownDisplay.textContent = `${this.countdownValue}s`;
            }
        }
    }

    stopGuide(save = true) {
        this.isActive = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.countdownIntervalId) {
            clearInterval(this.countdownIntervalId);
            this.countdownIntervalId = null;
        }

        // Update UI
        this.startBtn.style.display = 'inline-block';
        this.stopBtn.style.display = 'none';
        this.statusIndicator.style.display = 'none';
        if (this.goalInput instanceof HTMLTextAreaElement || this.goalInput instanceof HTMLInputElement) {
            this.goalInput.disabled = false;
        }

        if (this.toggleBtn) {
            this.toggleBtn.classList.remove('active-guide');
        }

        if (save) {
            this.saveState();
            this.uiManager.showToast('Guide Mode Stopped', 'info');
        }
    }

    async poll() {
        if (!this.isActive) return;

        // Reset countdown value for the visual update
        this.countdownValue = Math.floor(this.pollingIntervalMs / 1000);
        this.updateCountdownDisplay();

        try {
            // Identify correct context (active tab in current window)
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];

            if (!currentTab) {
                console.warn('[GuideMode] No active tab found for polling.');
                return;
            }

            console.log(`[GuideMode] Polling for context on tab ${currentTab.id} (${currentTab.title})...`);

            let response = await this.orchestrator.sendRuntimeMessage({
                action: 'getTabContent',
                includeImages: true,
                tabId: currentTab.id
            });

            if (!response) {
                console.warn('[GuideMode] No response from background script.');
                return;
            }

            if (!response.success) {
                if (response.error === 'restricted_page' || response.error === 'No tab context available') {
                    console.log('[GuideMode] Page restricted or context missing, attempting screenshot fallback...');
                    if (this.countdownDisplay) {
                        this.countdownDisplay.textContent = 'Restricted: Capturing screen...';
                    }

                    try {
                        const captureResponse = await this.orchestrator.sendRuntimeMessage({
                            action: 'captureTab',
                            windowId: currentTab.windowId,
                            tabId: currentTab.id
                        });

                        if (captureResponse && captureResponse.success) {
                            console.log('[GuideMode] Screenshot capture successful.');
                            // Create a synthetic response object for processing
                            response = {
                                success: true,
                                title: currentTab.title || 'Restricted Page Content',
                                url: currentTab.url || 'Restricted URL',
                                content: '[DOM Restricted - Analysis based on screenshot]',
                                primaryImage: {
                                    base64: captureResponse.dataUrl.split(',')[1],
                                    mimeType: 'image/png',
                                    url: 'capture://visible-tab',
                                    type: 'image'
                                }
                            };
                        } else {
                            console.warn('[GuideMode] Screenshot capture failed:', captureResponse?.error);
                            if (this.countdownDisplay) {
                                this.countdownDisplay.textContent = 'Capture failed';
                                this.countdownDisplay.style.color = 'var(--muted-foreground)';
                            }
                            return;
                        }
                    } catch (captureError) {
                        // Suppress expected errors during transient states (e.g. dragging tabs)
                        if (captureError.message && captureError.message.includes('Tabs cannot be edited')) {
                            console.warn('[GuideMode] Polling skipped: Tab is being dragged or edited.');
                        } else {
                            console.error('[GuideMode] Error during screenshot capture:', captureError);
                        }
                        return;
                    }
                } else {

                    console.warn('[GuideMode] Failed to get context. Response:', response);
                    if (this.countdownDisplay) {
                        this.countdownDisplay.textContent = `Error: ${response.error || 'Unknown error'}`;
                    }
                    return;
                }
            }

            // Normal successful response processing (including screenshot fallback)
            if (this.countdownDisplay) {
                this.countdownDisplay.style.color = ''; // Reset color
            }

            // Basic content hashing to avoid repeating insights for exact same content
            const currentHash = `${response.title}-${response.content?.length}`;
            if (this.lastContentHash === currentHash) {
                console.log('[GuideMode] Content unchanged, skipping insight.');
                return;
            }
            this.lastContentHash = currentHash;

            const historyText = this.insightHistory.length > 0
                ? `\nPREVIOUS INSIGHTS:\n${this.insightHistory.join('\n')}\n`
                : '';

            const systemPrompt = `You are a strategic monitoring agent.
The user is browsing with this GOAL: "${this.goal}".
Your task is to analyze the page content and provide a SHORT, SUMMARIZED INSIGHT (max 2 sentences) that helps them progress toward their goal.
${historyText}
- Synthesize the content; don't just repeat headers.
- Be extremely concise.
- If the content is irrelevant, say "Waiting for relevant content...".
- Suggest what they might do NEXT if appropriate.
- Do not greet.`;

            const userPrompt = `Page: ${response.title}
URL: ${response.url}
Content: ${response.content?.substring(0, 2000)}
${response.primaryImage ? '[Contextual Image Included]' : '[No Images]'}

Provide your goal-aligned summary/insight.`;

            // Call API directly to maintain stateless background polling
            const apiConfig = this.conversationManager.getApiConfig();
            if (!apiConfig) {
                console.warn('[GuideMode] No API config available for background poll.');
                return;
            }

            let insight = '';
            try {
                if (response.primaryImage) {
                    const mediaResponse = await apiClient.makeMediaRequest(apiConfig, response.primaryImage, {
                        prompt: userPrompt,
                        messages: [{ role: 'system', content: systemPrompt }]
                    });
                    insight = mediaResponse?.choices?.[0]?.message?.content || '';
                } else {
                    const textResponse = await apiClient.makeRequest(apiConfig, {
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ]
                    });
                    insight = textResponse?.choices?.[0]?.message?.content || '';
                }
            } catch (apiError) {
                console.error('[GuideMode] API Call failed:', apiError);

                // If we hit a rate limit error (429) that wasn't handled by internal retries
                if (apiError.message && (apiError.message.includes('429') || apiError.message.includes('rate limit'))) {
                    console.warn('[GuideMode] Rate limit detected, pausing polling for a cycle.');
                    // Skip next poll cycle implicitly by not saving state or resetting interval
                    // The standard interval will trigger again later
                }
                return;
            }

            if (insight && !insight.includes('Waiting for relevant content')) {
                // Add to history (maintain sliding window)
                this.insightHistory.push(insight);
                if (this.insightHistory.length > this.maxHistoryItems) {
                    this.insightHistory.shift();
                }
                this.saveState();

                // Add to UI as a special Insight message
                this.messageRenderer.addMessage('Insight', insight);

                // Add to main history so user can follow up, but keep it clean
                this.conversationManager.addToHistory({
                    role: 'assistant',
                    content: `[Guide Mode Summary] ${insight}`
                });
            }

        } catch (e) {
            console.error('[GuideMode] Error in poll:', e);
        }
    }
}
