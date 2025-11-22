// content_script_unified.js - Consolidated content extraction script
(async function() {
    // Error handler is not directly imported in content scripts due to scope limitations
    // We'll use a simplified error handling approach here
    let content = "";
    let success = false;
    let errorMessage = "";
 
    const handleError = (error, context = {}) => {
        console.error('Content Script Error:', error, context);
        errorMessage = error.message || 'Unknown content extraction error';

        // Try to send error to background script for tracking when the Chrome runtime is available
        try {
            if (typeof chrome !== 'undefined' &&
                chrome.runtime &&
                typeof chrome.runtime.sendMessage === 'function') {
                chrome.runtime.sendMessage({
                    action: 'contentScriptError',
                    error: {
                        message: errorMessage,
                        context: context,
                        stack: error.stack,
                        url: window.location.href
                    }
                });
            } else {
                // In non-extension or test environments, chrome.runtime may not exist
                console.debug('[Content Script] chrome.runtime.sendMessage is not available in this context; skipping error forwarding');
            }
        } catch (msgError) {
            console.warn('Failed to send error to background script:', msgError);
        }
    };

    // Progressive DOM processing utility for performance optimization
    const ProgressiveDOMProcessor = {
        // Process operations in batches during browser idle time
        async processBatch(operations, batchSize = 5, maxTimePerFrame = 16) {
            const results = [];
            let processedCount = 0;

            return new Promise((resolve) => {
                const processBatch = (deadline) => {
                    const startTime = performance.now();

                    while (processedCount < operations.length &&
                           performance.now() - startTime < maxTimePerFrame &&
                           (deadline === null || deadline.timeRemaining() > 0)) {

                        try {
                            const result = operations[processedCount]();
                            if (result !== null) {
                                results.push(result);
                            }
                            processedCount++;
                        } catch (error) {
                            console.warn('[Content Script] Error in batch operation:', error);
                            processedCount++;
                        }
                    }

                    if (processedCount < operations.length) {
                        // Continue processing in next idle period
                        requestIdleCallback(processBatch);
                    } else {
                        resolve(results);
                    }
                };

                // Start processing
                if (window.requestIdleCallback) {
                    requestIdleCallback(processBatch, { timeout: 2000 });
                } else {
                    // Fallback for browsers without requestIdleCallback
                    setTimeout(() => processBatch(null), 0);
                }
            });
        },

        // Process noise selectors progressively
        async processNoiseSelectors(workingElement, noiseSelectors) {
            const maxNoiseSelectors = 20;
            const limitedNoiseSelectors = noiseSelectors.slice(0, maxNoiseSelectors);

            const noiseOperations = limitedNoiseSelectors.map(noiseSelector => () => {
                if (Date.now() - this.domStartTime > 2000) {
                    console.warn('[Content Script] DOM operation timeout during noise removal, skipping remaining selectors');
                    return null;
                }

                try {
                    const noiseElements = workingElement.querySelectorAll(noiseSelector);
                    const maxNoiseElements = 10;
                    const noiseElementsToRemove = Array.from(noiseElements).slice(0, maxNoiseElements);

                    noiseElementsToRemove.forEach(el => el.remove());
                    return noiseElementsToRemove.length;
                } catch (e) {
                    // Continue if selector fails
                    return 0;
                }
            });

            const results = await this.processBatch(noiseOperations, 3, 12); // Process 3 selectors per frame, max 12ms
            return results.reduce((sum, count) => sum + (count || 0), 0);
        },

        // Reset processing timer
        resetTimer() {
            this.domStartTime = Date.now();
        }
    };

    // Dynamic content detection with throttled MutationObserver
    const DynamicContentDetector = {
        observer: null,
        debounceTimer: null,
        lastContentLength: 0,
        isInitialized: false,

        // Initialize MutationObserver with throttling
        initialize() {
            if (this.isInitialized) return;
            this.isInitialized = true;

            // Defensive checks before initializing
            if (!document || !document.body) {
                console.warn('[Content Script] Dynamic content detector: no body to observe');
                return;
            }

            if (typeof MutationObserver === 'undefined') {
                console.warn('[Content Script] Dynamic content detector: MutationObserver not available');
                return;
            }

            try {
                this.observer = new MutationObserver((mutations) => {
                    this.handleMutations(mutations);
                });

                // Observe document changes with optimized configuration
                this.observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: false,
                    characterData: false
                });

                console.log('[Content Script] Dynamic content detector initialized');
            } catch (error) {
                console.warn('[Content Script] Failed to initialize MutationObserver:', error);
            }
        },

        // Handle mutations with debouncing
        handleMutations(mutations) {
            // Clear existing timer
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            // Debounce mutation handling to avoid excessive processing
            this.debounceTimer = setTimeout(() => {
                this.processMutations(mutations);
            }, 300); // 300ms debounce
        },

        // Process mutations and check if content has significantly changed
        processMutations(mutations) {
            try {
                // Early exit if document/body is missing
                if (!document || !document.body) {
                    console.log('[Content Script] Dynamic content detector: document/body missing during mutation processing');
                    return;
                }

                const currentContentLength = document.body?.textContent?.length || 0;
                const contentChange = Math.abs(currentContentLength - this.lastContentLength);
                const changePercentage = this.lastContentLength > 0 ? (contentChange / this.lastContentLength) * 100 : 0;

                // Only trigger content extraction if significant change occurred
                if (changePercentage > 5 || contentChange > 1000) { // 5% change or 1000+ characters
                    console.log(`[Content Script] Significant content change detected (${changePercentage.toFixed(1)}%, ${contentChange} chars)`);
                    this.lastContentLength = currentContentLength;

                    // Use requestIdleCallback to avoid blocking
                    if (window.requestIdleCallback) {
                        requestIdleCallback(() => {
                            this.handleContentChange();
                        }, { timeout: 5000 });
                    } else {
                        // Fallback
                        setTimeout(() => this.handleContentChange(), 100);
                    }
                } else if (contentChange > 100) {
                    console.log(`[Content Script] Minor content change detected (${contentChange} chars, below threshold)`);
                    this.lastContentLength = currentContentLength;
                }
            } catch (error) {
                console.warn('[Content Script] Error processing mutations:', error);
            }
        },

        // Handle significant content changes
        handleContentChange() {
            try {
                // Check if page is still active and accessible
                if (!document || !document.body) {
                    console.log('[Content Script] Document no longer accessible, skipping content update');
                    return;
                }

                // Avoid processing during heavy DOM operations
                if (window.performance && window.performance.now) {
                    const loadTime = performance.now();
                    if (loadTime < 1000) { // Still loading
                        return;
                    }
                }

                console.log('[Content Script] Processing dynamic content change...');

                // Here you could trigger content re-extraction if needed
                // For now, just log event to monitor performance
                const memoryInfo = window.performance && window.performance.memory;
                if (memoryInfo) {
                    console.log('[Content Script] Memory usage:', {
                        used: Math.round(memoryInfo.usedJSHeapSize / 1024 / 1024) + 'MB',
                        total: Math.round(memoryInfo.totalJSHeapSize / 1024 / 1024) + 'MB',
                        limit: Math.round(memoryInfo.jsHeapSizeLimit / 1024 / 1024) + 'MB'
                    });
                }
            } catch (error) {
                console.warn('[Content Script] Error handling content change:', error);
            }
        },

        // Disconnect observer to prevent memory leaks
        disconnect() {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }

            if (this.observer) {
                try {
                    this.observer.disconnect();
                } catch (e) {
                    console.warn('[Content Script] Error disconnecting observer:', e);
                }
                this.observer = null;
            }

            this.isInitialized = false;
            console.log('[Content Script] Dynamic content detector disconnected');
        },

        // Get observer status
        getStatus() {
            return {
                initialized: this.isInitialized,
                observing: this.observer !== null,
                lastContentLength: this.lastContentLength,
                hasDebounceTimer: this.debounceTimer !== null
            };
        }
    };

    try {
        // Function to calculate content quality score
        function calculateContentScore(text, element) {
            if (!text || text.length < 50) return 0;
            
            let score = 0;
            
            // Length scoring
            if (text.length > 1000) score += 30;
            else if (text.length > 500) score += 20;
            else if (text.length > 200) score += 10;
            
            // Paragraph density (more paragraphs = likely better content)
            const paragraphs = text.split(/\n\s*\n/).length;
            if (paragraphs > 5) score += 20;
            else if (paragraphs > 2) score += 10;
            
            // Sentence structure (multiple sentences = better content)
            const sentences = text.split(/[.!?]+/).length;
            if (sentences > 10) score += 20;
            else if (sentences > 5) score += 10;
            
            // Element-based scoring
            if (element) {
                const tagName = element.tagName.toLowerCase();
                const className = element.className || '';
                const id = element.id || '';
                
                // Prefer semantic content elements
                if (['main', 'article', 'section'].includes(tagName)) score += 25;
                if (['content', 'article', 'post', 'story', 'text'].some(word => className.includes(word))) score += 15;
                if (['content', 'main', 'article', 'post'].some(word => id.includes(word))) score += 15;
                
                // Penalize likely non-content elements
                if (['nav', 'header', 'footer', 'aside', 'sidebar'].includes(tagName)) score -= 20;
                if (['nav', 'menu', 'sidebar', 'footer', 'header'].some(word => className.includes(word))) score -= 15;
                if (['nav', 'menu', 'sidebar', 'footer', 'header'].some(word => id.includes(word))) score -= 15;
            }
            
            // Content quality indicators
            const hasSubstantialWords = text.split(/\s+/).length > 50;
            if (hasSubstantialWords) score += 15;
            
            // Penalize repetitive or low-quality content
            const words = text.toLowerCase().split(/\s+/);
            const uniqueWords = new Set(words);
            const uniqueRatio = uniqueWords.size / words.length;
            if (uniqueRatio < 0.3) score -= 10; // Too repetitive
            
            // Penalize if content is mostly links or buttons
            const linkText = Array.from(element?.querySelectorAll('a') || []).map(a => a.textContent).join(' ');
            if (linkText.length > text.length * 0.5) score -= 15;
            
            return Math.max(0, score);
        }

        // Function to wait for dynamic content to load with enhanced timeout protection
        async function waitForContent(timeout = 10000) {
            return new Promise((resolve) => {
                const startTime = Date.now();
                let lastContentLength = 0;
                let stableCount = 0;
                let checkCount = 0;
                let consecutiveStableChecks = 0;
                const maxChecks = Math.ceil(timeout / 800); // Reduced check frequency
                
                // Adaptive stability detection - require more stability for large content
                const getRequiredStabilityChecks = (contentLength) => {
                    if (contentLength > 10000) return 2; // Large content, less strict
                    if (contentLength > 1000) return 3;  // Medium content
                    return 2; // Small content, quicker to stabilize
                };

                const checkContent = () => {
                    checkCount++;

                    // Safety check to prevent infinite recursion
                    if (checkCount > maxChecks) {
                        console.warn(`[Content Script] waitForContent: Max checks (${maxChecks}) reached after ${Date.now() - startTime}ms, resolving`);
                        resolve();
                        return;
                    }

                    try {
                        const currentContent = document.body?.textContent || '';
                        const currentLength = currentContent.length;
                        const requiredStability = getRequiredStabilityChecks(currentLength);

                        // Check if content has stabilized (adaptive threshold based on content size)
                        const stabilityThreshold = Math.max(50, Math.min(200, currentLength * 0.001));
                        const contentDiff = Math.abs(currentLength - lastContentLength);
                        
                        if (contentDiff < stabilityThreshold) {
                            stableCount++;
                            consecutiveStableChecks++;
                            
                            if (stableCount >= requiredStability && consecutiveStableChecks >= 2) {
                                console.log(`[Content Script] Content stabilized after ${Date.now() - startTime}ms (checks: ${checkCount}, length: ${currentLength})`);
                                resolve();
                                return;
                            }
                        } else {
                            // Content changed significantly, reset stability counters
                            stableCount = 0;
                            consecutiveStableChecks = 0;
                        }

                        lastContentLength = currentLength;

                        // Check timeout
                        const elapsedTime = Date.now() - startTime;
                        if (elapsedTime > timeout) {
                            console.log(`[Content Script] waitForContent timeout after ${elapsedTime}ms (checks: ${checkCount}), resolving with current content`);
                            resolve();
                            return;
                        }

                        // Adaptive check interval - slower checking as we approach timeout
                        let checkInterval = 800;
                        const progress = elapsedTime / timeout;
                        if (progress > 0.7) checkInterval = 1200; // Slower checks in final 30%
                        if (progress > 0.9) checkInterval = 2000; // Very slow in final 10%

                        setTimeout(checkContent, checkInterval);
                    } catch (error) {
                        console.error('[Content Script] Error in waitForContent:', error);
                        resolve();
                    }
                };

                console.log(`[Content Script] Starting waitForContent with ${timeout}ms timeout, max ${maxChecks} checks`);
                checkContent();
            });
        }

        // Enhanced content extraction with comprehensive noise filtering and timeout protection
        const extractContent = async () => {
            const extractionTimeout = 10000; // 10 second timeout for extraction
            const startTime = Date.now();
            // Track when we've already consumed most of our budget so we can fall back to a fast-path
            let nearTimeout = false;

            return new Promise(async (resolve, reject) => {
                try {
                    // Check if document is accessible
                    if (!document || !document.documentElement) {
                        reject(new Error('Document not accessible'));
                        return;
                    }

                    console.log('[Content Script] Starting enhanced content extraction...');

                    // Wait for dynamic content to load (use default 10s timeout)
                    await waitForContent();

                    // Check if we've already spent most of our extraction budget during waitForContent.
                    // Instead of failing hard, mark that we're near timeout so we can use a cheaper fallback.
                    const elapsedAfterWait = Date.now() - startTime;
                    if (elapsedAfterWait > extractionTimeout - 1000) {
                        console.warn('[Content Script] Near extraction timeout after waitForContent, switching to fast-path extraction');
                        nearTimeout = true;
                    }

                    // Optimized noise selectors - reduced to essential high-impact filters only
                    const noiseSelectors = [
                        // Technical elements (highest priority removal)
                        'script', 'style', 'noscript', 'meta', 'template',

                        // Navigation and structure
                        'nav', 'header', 'footer', '.navigation', '.nav', '.menu',

                        // UI overlays and popups
                        '.popup', '.modal', '.overlay', '.tooltip', '.cookie-banner',
                        '.notification', '.alert', '.banner',

                        // Ads and promotional
                        '.ads', '.advertisement', '.ad-banner', '.sponsored',

                        // Social and sharing
                        '.social', '.share', '.sharing', '.newsletter', '.signup',

                        // Comments and metadata
                        '.comments', '.comment-section', '.metadata', '.tags',
                        '.breadcrumb', '.pagination',

                        // Forms
                        '.search-form', '.contact-form',

                        // Accessibility elements
                        '.skip-link', '.screen-reader-only', '.sr-only',

                        // Common patterns (wildcards for catch-all)
                        '[class*="analytics"]', '[class*="tracking"]', '[class*="ad-"]',
                        '[class*="popup"]', '[class*="modal"]', '[class*="banner"]',
                        '[id*="analytics"]', '[id*="tracking"]', '[id*="ad-"]'
                    ];

                    // Optimized content selectors - focus on high-impact, common patterns
                    const contentSelectors = [
                        // Semantic HTML5 elements (highest priority)
                        'main', 'article', '[role="main"]',

                        // Common content classes (most effective)
                        '.content', '.main-content', '.post-content', '.entry-content',
                        '.article-content', '.text-content',

                        // Modern CMS patterns
                        '.prose', '.markdown-body', '.rich-text', '.editor-content',
                        '.blog-content', '.article-body', '.post-text',

                        // Data attributes (modern apps)
                        '[data-testid*="content"]', '[data-testid*="article"]',
                        '[data-cy*="content"]', '[data-qa*="content"]',

                        // Common blog patterns
                        '.post', '.entry', '.blog-post', '.story', '.text',

                        // Essential fallback patterns
                        '[class*="content"]', '[class*="article"]', '[class*="post"]'
                    ];

                    let bestResult = {
                        text: '',
                        score: 0,
                        element: null,
                        method: 'none'
                    };

                    // If we're already close to our timeout budget, use a fast-path fallback that
                    // avoids heavy DOM cloning and selector-based noise removal.
                    if (nearTimeout) {
                        try {
                            const fastText = document.body?.innerText || document.body?.textContent || '';
                            console.log('[Content Script] Using fast-path extraction due to timeout pressure', {
                                textLength: fastText.length
                            });
                            resolve(fastText.trim());
                            return;
                        } catch (fastError) {
                            console.warn('[Content Script] Fast-path extraction failed, falling back to full extraction:', fastError);
                            // Intentionally fall through to the normal extraction logic as a secondary fallback
                        }
                    }

                    // Method 1: Try each content selector with scoring and timeout protection
                    console.log('[Content Script] Testing content selectors...');
                    for (const selector of contentSelectors) {
                        // Check timeout before each selector
                        if (Date.now() - startTime > extractionTimeout - 2000) {
                            console.warn('[Content Script] Timeout approaching during selector testing, breaking');
                            break;
                        }

                        try {
                            const elements = document.querySelectorAll(selector);

                            // Limit number of elements to process per selector to prevent performance issues
                            const maxElementsPerSelector = 5;
                            const elementsToProcess = Array.from(elements).slice(0, maxElementsPerSelector);

                            for (const element of elementsToProcess) {
                                // Check timeout before each element processing
                                if (Date.now() - startTime > extractionTimeout - 1000) {
                                    console.warn('[Content Script] Timeout approaching during element processing, breaking');
                                    break;
                                }

                                try {
                                    // Use progressive DOM processing for better performance
                                    ProgressiveDOMProcessor.resetTimer();
                                    const workingElement = element.cloneNode(true);

                                    // Process noise selectors progressively
                                    const removedElementsCount = await ProgressiveDOMProcessor.processNoiseSelectors(workingElement, noiseSelectors);

                                    const text = workingElement.textContent || workingElement.innerText || '';
                                    const score = calculateContentScore(text, element);

                                    if (score > bestResult.score) {
                                        bestResult = {
                                            text: text.trim(),
                                            score,
                                            element,
                                            method: `selector: ${selector} (removed ${removedElementsCount} elements)`
                                        };
                                        console.log(`[Content Script] New best result: ${selector} (score: ${score})`);
                                    }
                                } catch (elementError) {
                                    console.warn(`[Content Script] Error processing element for selector ${selector}:`, elementError);
                                    continue;
                                }
                            }
                        } catch (error) {
                            console.warn(`[Content Script] Error with selector ${selector}:`, error);
                        }
                    }

                    // Method 2: Try body with noise filtering
                    console.log('[Content Script] Testing body extraction...');
                    try {
                        ProgressiveDOMProcessor.resetTimer();
                        const workingBody = document.body.cloneNode(true);

                        // Use progressive processing for body extraction
                        const removedElementsCount = await ProgressiveDOMProcessor.processNoiseSelectors(workingBody, noiseSelectors);

                        const bodyText = workingBody.textContent || workingBody.innerText || '';
                        const bodyScore = calculateContentScore(bodyText, document.body);

                        if (bodyScore > bestResult.score) {
                            bestResult = {
                                text: bodyText.trim(),
                                score: bodyScore,
                                element: document.body,
                                method: `body-with-filtering (removed ${removedElementsCount} elements)`
                            };
                            console.log(`[Content Script] Body extraction is better (score: ${bodyScore})`);
                        }
                    } catch (error) {
                        console.warn('[Content Script] Error with body extraction:', error);
                    }

                    // Method 3: Try without any noise filtering (for pages with unusual structures)
                    console.log('[Content Script] Testing unfiltered extraction...');
                    try {
                        const rawText = document.body.textContent || document.body.innerText || '';
                        const rawScore = calculateContentScore(rawText, document.body);
                        
                        if (rawScore > bestResult.score) {
                            bestResult = {
                                text: rawText.trim(),
                                score: rawScore,
                                element: document.body,
                                method: 'unfiltered'
                            };
                            console.log(`[Content Script] Unfiltered extraction is best (score: ${rawScore})`);
                        }
                    } catch (error) {
                        console.warn('[Content Script] Error with unfiltered extraction:', error);
                    }

                    // Check timeout before returning - if we've exceeded the budget, return the best effort
                    const finalElapsed = Date.now() - startTime;
                    if (finalElapsed > extractionTimeout) {
                        console.warn('[Content Script] Extraction exceeded timeout, returning best-effort content', {
                            extractionTime: finalElapsed,
                            method: bestResult.method,
                            score: bestResult.score,
                            textLength: bestResult.text ? bestResult.text.length : 0
                        });

                        // Fallback to bestResult, or as a last resort, raw body text
                        let fallbackText = bestResult.text;
                        if (!fallbackText || fallbackText.length === 0) {
                            try {
                                fallbackText = (document.body && (document.body.innerText || document.body.textContent)) || '';
                            } catch (fallbackError) {
                                console.warn('[Content Script] Failed to obtain fallback body text after timeout:', fallbackError);
                                fallbackText = '';
                            }
                        }

                        resolve((fallbackText || '').trim());
                        return;
                    }

                    console.log('[Content Script] Extraction complete:', {
                        method: bestResult.method,
                        score: bestResult.score,
                        textLength: bestResult.text.length,
                        title: document.title,
                        extractionTime: finalElapsed
                    });

                    resolve(bestResult.text);

                } catch (extractionError) {
                    reject(new Error(`Content extraction failed: ${extractionError.message}`));
                }
            });
        };

        try {
            content = await extractContent();
        } catch (contentError) {
            // If enhanced extraction fails (e.g., timeout or heavy DOM issues),
            // log the error but fall back to a lightweight body-text extraction
            // instead of failing hard. This keeps quick actions (like Summarize)
            // working with best-effort content.
            handleError(contentError, {
                action: 'extract_content_call',
                url: window.location.href
            });

            try {
                const fallbackText =
                    (document.body && (document.body.innerText || document.body.textContent)) || '';
                console.warn('[Content Script] Falling back to raw body text after extraction error', {
                    fallbackLength: fallbackText.length,
                    originalError: contentError?.message
                });
                content = fallbackText.trim();
            } catch (fallbackError) {
                console.warn('[Content Script] Fallback body text extraction also failed:', fallbackError);
                // Leave content as empty string; outer logic below will mark this
                // as a successful extraction with "no extractable textual content"
                content = '';
            }
        }
        
        if (content) {
            success = true;
            // Enhanced cleanup and filtering
            content = content
                // Remove JavaScript and technical content patterns
                .replace(/JavaScript Function \([^)]*\).*$/gmi, '')
                .replace(/Additional Code:.*$/gmi, '')
                .replace(/function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}/gmi, '')
                .replace(/var\s+\w+\s*=.*$/gmi, '')
                .replace(/const\s+\w+\s*=.*$/gmi, '')
                .replace(/let\s+\w+\s*=.*$/gmi, '')
                .replace(/\w+\s*:\s*function\s*\([^)]*\)/gmi, '')
                .replace(/\w+\(\s*[^)]*\s*\)\s*;?/gmi, '')
                
                // Remove analytics and tracking mentions
                .replace(/There's a \w+ script for.*$/gmi, '')
                .replace(/.*tracking and analytics.*$/gmi, '')
                .replace(/.*initialized with.*encoded key.*$/gmi, '')
                .replace(/.*Vitally.*script.*$/gmi, '')
                .replace(/.*Intercom.*messenger.*$/gmi, '')
                .replace(/.*CSS styles.*included.*$/gmi, '')
                .replace(/.*modal states.*$/gmi, '')
                
                // Remove common warning/notice text patterns
                .replace(/^(warning|alert|notice|error|info):\s*/gmi, '')
                .replace(/^(please note|important|attention):\s*/gmi, '')
                .replace(/^(cookie|privacy) (notice|policy|warning).*$/gmi, '')
                .replace(/^this (site|website) uses cookies.*$/gmi, '')
                .replace(/^by continuing to use.*$/gmi, '')
                .replace(/^accept (all )?cookies.*$/gmi, '')
                .replace(/^we use cookies.*$/gmi, '')
                .replace(/^this website uses.*cookies.*$/gmi, '')
                
                // Remove common UI text
                .replace(/^(skip to|jump to) (main )?content$/gmi, '')
                .replace(/^(back to top|scroll to top)$/gmi, '')
                .replace(/^(share|follow|subscribe|newsletter)$/gmi, '')
                .replace(/^(related articles?|more articles?|trending|popular)$/gmi, '')
                
                // Remove code-like patterns
                .replace(/\{[^}]*\}/gmi, '') // Remove CSS/JS object notation
                .replace(/\[[^\]]*\]/gmi, '') // Remove array notation
                .replace(/\w+\.\w+\([^)]*\)/gmi, '') // Remove method calls
                .replace(/\/\*.*?\*\//gmi, '') // Remove CSS/JS comments
                .replace(/\/\/.*$/gmi, '') // Remove single-line comments
                
                // Clean up whitespace
                .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
                .replace(/\t+/g, ' ') // Replace tabs with spaces
                .replace(/[ ]{2,}/g, ' ') // Replace multiple spaces with single space
                .replace(/^\s*[\r\n]/gm, '') // Remove empty lines
                .trim();
                
            // Final check - if content is too short or seems like just UI text, mark as empty
            if (content.length < 50 || 
                /^(home|menu|search|login|register|contact|about|privacy|terms)$/i.test(content) ||
                /^(loading|please wait|error|not found|404)$/i.test(content)) {
                content = "";
                errorMessage = "Page appears to contain only navigation or UI elements.";
            }
        } else {
            errorMessage = "Page appears to have no extractable textual content.";
            success = true; // Still successful extraction, just empty content
        }

    } catch (e) {
        handleError(e, {
            action: 'content_extraction',
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: Date.now()
        });
        success = false;
    }
 
    // Initialize dynamic content detection after helpers are defined
    try {
        if (typeof DynamicContentDetector !== 'undefined') {
            DynamicContentDetector.initialize();
        } else {
            console.warn('[Content Script] DynamicContentDetector is not defined, skipping initialization');
        }
    } catch (error) {
        console.warn('[Content Script] Failed to initialize dynamic content detector:', error);
    }
 
    // Set up cleanup on page unload to prevent memory leaks
    try {
        window.addEventListener('beforeunload', () => {
            console.log('[Content Script] Cleaning up before page unload...');
            if (typeof DynamicContentDetector !== 'undefined') {
                DynamicContentDetector.disconnect();
            }
        });
 
        // Also handle visibility change (user switching tabs)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('[Content Script] Page hidden, pausing content detection...');
                if (typeof DynamicContentDetector !== 'undefined') {
                    DynamicContentDetector.disconnect();
                }
            } else {
                console.log('[Content Script] Page visible, restarting content detection...');
                if (typeof DynamicContentDetector !== 'undefined') {
                    DynamicContentDetector.initialize();
                }
            }
        });
    } catch (error) {
        console.warn('[Content Script] Failed to set up cleanup listeners:', error);
    }

    // Return the extraction result
    return {
        success: success,
        data: content,
        error: errorMessage,
        url: window.location.href,
        title: document.title || "",
        timestamp: Date.now()
    };
})();