import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync, handleChromeApiCall } from '../errorHandler.js';
import analytics from '../analytics.js';

/**
 * Context Menu Manager
 * Handles creation and management of Chrome extension context menus
 */
export class ContextMenuManager {
    constructor() {
        this.menuItems = [
            // Parent menu for images
            { id: "imageAnalysis", title: "Analyze Image with Prompt Paul", contexts: ["image"] },
            // Quick actions for images
            { id: "analyzeImage", parentId: "imageAnalysis", title: "🔍 General Analysis", contexts: ["image"] },
            { id: "summarizeImage", parentId: "imageAnalysis", title: "📝 Summarize Image", contexts: ["image"] },
            { id: "explainImage", parentId: "imageAnalysis", title: "💡 Explain Image", contexts: ["image"] },
            // Separator for images
            { id: "imageSeparator", parentId: "imageAnalysis", type: "separator", contexts: ["image"] },
            // Parent menu for videos
            { id: "videoAnalysis", title: "Analyze Video with Prompt Paul", contexts: ["video"] },
            { id: "analyzeVideo", parentId: "videoAnalysis", title: "🎥 General Analysis", contexts: ["video"] },
            // Parent menu for audio
            { id: "audioAnalysis", title: "Analyze Audio with Prompt Paul", contexts: ["audio"] },
            { id: "analyzeAudio", parentId: "audioAnalysis", title: "🎵 General Analysis", contexts: ["audio"] }
        ];
    }

    /**
     * Initialize all context menus
     */
    async initializeMenus() {
        await wrapAsync(async () => {
            // Track install/update event once
            try {
                await analytics.trackInstalled();
            } catch (error) {
                await errorHandler.handleError(createError('Failed to track installation', {
                    category: ErrorCategory.ANALYTICS,
                    severity: ErrorSeverity.LOW,
                    originalError: error
                }));
            }

            // Create all menu items with error handling
            for (const item of this.menuItems) {
                try {
                    await handleChromeApiCall((callback) => chrome.contextMenus.create(item, callback));
                } catch (error) {
                    await errorHandler.handleError(createError(`Failed to create context menu: ${item.title}`, {
                        category: ErrorCategory.CHROME_API,
                        severity: ErrorSeverity.MEDIUM,
                        context: { menuItem: item },
                        originalError: error
                    }));
                }
            }

            // Load and add custom instructions for images
            try {
                await this.updateImageCustomInstructions();
            } catch (error) {
                await errorHandler.handleError(createError('Failed to update image custom instructions', {
                    category: ErrorCategory.CONFIGURATION,
                    severity: ErrorSeverity.MEDIUM,
                    originalError: error
                }));
            }
        }, {
            category: ErrorCategory.SYSTEM,
            userMessage: 'Failed to initialize extension context menus'
        });
    }

    /**
     * Handle context menu clicks
     */
    async handleMenuClick(info, tab, mediaProcessor) {
        await wrapAsync(async () => {
            if (!this.isMediaAnalysisMenu(info.menuItemId)) {
                return;
            }

            // Open side panel FIRST (must be in direct response to user gesture)
            try {
                await handleChromeApiCall((callback) => chrome.sidePanel.open({ tabId: tab.id }, callback));
            } catch (error) {
                throw createError('Failed to open side panel', {
                    category: ErrorCategory.CHROME_API,
                    severity: ErrorSeverity.HIGH,
                    retryable: true,
                    originalError: error
                });
            }

            // Get the media URL and determine action type
            const mediaUrl = info.srcUrl;
            if (!mediaUrl) {
                throw createError('No media URL found', {
                    category: ErrorCategory.USER_INPUT,
                    severity: ErrorSeverity.MEDIUM,
                    context: { menuItemId: info.menuItemId }
                });
            }

            const { mediaType, actionType, instructionId } = this.parseMenuAction(info.menuItemId);

            // Show loading message immediately
            try {
                chrome.runtime.sendMessage({
                    action: 'setMediaForAnalysis',
                    mediaData: {
                        type: mediaType,
                        base64: null, // Will be set later
                        url: mediaUrl,
                        mimeType: this.getMimeTypeFromUrl(mediaUrl),
                        loading: true
                    },
                    tabId: tab.id
                });
            } catch (error) {
                console.log('Side panel not ready yet, will send message after image loads');
            }

            // Convert media to base64 for API (async operation)
            const base64Data = await mediaProcessor.fetchMediaAsBase64(mediaUrl);
            const mimeType = this.getMimeTypeFromUrl(mediaUrl);
            console.log('Sending media data:', {
                type: mediaType,
                url: mediaUrl,
                mimeType: mimeType,
                base64Length: base64Data.length
            });

            // Send the actual media data (with retry logic for side panel)
            const sendMediaData = () => {
                try {
                    chrome.runtime.sendMessage({
                        action: 'setMediaForAnalysis',
                        mediaData: {
                            type: mediaType,
                            base64: base64Data,
                            url: mediaUrl,
                            mimeType: mimeType,
                            loading: false,
                            actionType: actionType,
                            instructionId: instructionId
                        },
                        tabId: tab.id
                    });
                } catch (error) {
                    console.log('Retrying message send in 500ms...');
                    setTimeout(sendMediaData, 500);
                }
            };

            // Give side panel time to load if it was just opened
            setTimeout(sendMediaData, 1000);
        }, {
            category: ErrorCategory.TOOL_EXECUTION,
            userMessage: 'Failed to process media for analysis',
            retryable: true
        }).catch(async error => {
            // Handle media fetching errors specifically
            if (error.message.includes('fetchMediaAsBase64') || error.category === ErrorCategory.NETWORK) {
                await errorHandler.handleError(error);

                // Send error message to side panel
                const { mediaType } = this.parseMenuAction(info.menuItemId);
                try {
                    chrome.runtime.sendMessage({
                        action: 'setMediaForAnalysis',
                        mediaData: {
                            type: mediaType || 'unknown',
                            base64: null,
                            url: info.srcUrl,
                            mimeType: this.getMimeTypeFromUrl(info.srcUrl),
                            error: error.userMessage || error.message
                        },
                        tabId: tab.id
                    });
                } catch (messageError) {
                    console.warn('Failed to send error message to side panel:', messageError);
                }
            } else {
                await errorHandler.handleError(error);
            }
        });
    }

    /**
     * Check if menu item is for media analysis
     */
    isMediaAnalysisMenu(menuItemId) {
        return menuItemId === "analyzeImage" ||
               menuItemId === "analyzeVideo" ||
               menuItemId === "analyzeAudio" ||
               menuItemId === "summarizeImage" ||
               menuItemId === "explainImage" ||
               menuItemId.startsWith("imageCustom_");
    }

    /**
     * Parse menu action from menu item ID
     */
    parseMenuAction(menuItemId) {
        let mediaType, actionType, instructionId;

        if (menuItemId.startsWith("imageCustom_")) {
            mediaType = "image";
            actionType = "custom";
            instructionId = menuItemId.replace("imageCustom_", "");
        } else if (menuItemId === "summarizeImage") {
            mediaType = "image";
            actionType = "summarize";
        } else if (menuItemId === "explainImage") {
            mediaType = "image";
            actionType = "explain";
        } else {
            // Default analysis (analyzeImage, analyzeVideo, analyzeAudio)
            mediaType = menuItemId.replace("analyze", "").toLowerCase();
            actionType = "analyze";
        }

        return { mediaType, actionType, instructionId };
    }

    /**
     * Get MIME type from URL
     */
    getMimeTypeFromUrl(url) {
        if (!url) return 'application/octet-stream';

        try {
            const extension = url.split('.').pop()?.toLowerCase();
            const mimeTypes = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'bmp': 'image/bmp',
                'svg': 'image/svg+xml',
                'mp4': 'video/mp4',
                'webm': 'video/webm',
                'ogg': 'video/ogg',
                'mp3': 'audio/mpeg',
                'wav': 'audio/wav',
                'ogg': 'audio/ogg',
                'm4a': 'audio/mp4',
                'aac': 'audio/aac'
            };
            return mimeTypes[extension] || 'application/octet-stream';
        } catch (error) {
            return 'application/octet-stream';
        }
    }

    /**
     * Update image custom instructions in context menu
     */
    async updateImageCustomInstructions() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['imageCustomInstructions'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                const customInstructions = result.imageCustomInstructions || [];

                // Remove existing custom instruction menu items
                chrome.contextMenus.getAll((menuItems) => {
                    menuItems.forEach((item) => {
                        if (item.id && item.id.startsWith("imageCustom_")) {
                            chrome.contextMenus.remove(item.id);
                        }
                    });

                    // Add new custom instruction menu items
                    customInstructions.forEach((instruction, index) => {
                        if (instruction.enabled) {
                            chrome.contextMenus.create({
                                id: `imageCustom_${instruction.id}`,
                                parentId: "imageAnalysis",
                                title: instruction.name,
                                contexts: ["image"]
                            });
                        }
                    });

                    resolve();
                });
            });
        });
    }
}

// Export singleton instance
export const contextMenuManager = new ContextMenuManager();