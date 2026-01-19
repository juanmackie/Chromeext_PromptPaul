// content_script_unified.js - Consolidated content extraction script
(async function () {
  // Singleton guard to prevent multiple instances of listeners, but allow re-extraction
  const isReload = window.__promptPaulContentScriptLoaded;
  window.__promptPaulContentScriptLoaded = true;

  if (isReload) {
    console.debug('[Content Script] Reloaded in this context, skipping listener initialization but running extraction.');
  }

  // Error handler is not directly imported in content scripts due to scope limitations
  // We'll use a simplified error handling approach here
  let content = '';
  let success = false;
  let errorMessage = '';
  let images = [];

  const handleError = (error, context = {}) => {
    console.error('[ContentScript] Content Script Error:', error, context);
    errorMessage = error.message || 'Unknown content extraction error';

    // Try to send error to background script for tracking when the Chrome runtime is available
    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.runtime &&
        typeof chrome.runtime.sendMessage === 'function'
      ) {
        chrome.runtime.sendMessage({
          action: 'contentScriptError',
          error: {
            message: errorMessage,
            context: context,
            stack: error.stack,
            url: window.location.href,
          },
        });
      } else {
        // In non-extension or test environments, chrome.runtime may not exist
        console.debug(
          '[Content Script] chrome.runtime.sendMessage is not available in this context; skipping error forwarding'
        );
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

      return new Promise(resolve => {
        const processBatch = deadline => {
          const startTime = performance.now();

          while (
            processedCount < operations.length &&
            performance.now() - startTime < maxTimePerFrame &&
            (deadline === null || deadline.timeRemaining() > 0)
          ) {
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
          console.warn(
            '[Content Script] DOM operation timeout during noise removal, skipping remaining selectors'
          );
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
    },
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
        // Disconnect if already initialized to clean up existing observers
        if (this.observer) {
          this.disconnect();
        }

        this.observer = new MutationObserver(mutations => {
          this.handleMutations(mutations);
        });

        // Observe document changes with optimized configuration
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
          characterData: false,
        });

        console.debug('[Content Script] Dynamic content detector initialized');
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
          return;
        }

        const currentContentLength = document.body?.textContent?.length || 0;
        const contentChange = Math.abs(currentContentLength - this.lastContentLength);
        const changePercentage =
          this.lastContentLength > 0 ? (contentChange / this.lastContentLength) * 100 : 0;

        // Update lastContentLength immediately to block subsequent mutations in the same burst
        const oldLength = this.lastContentLength;
        this.lastContentLength = currentContentLength;

        // Only trigger content extraction if significant change occurred
        if (changePercentage > 5 || contentChange > 1000) {
          // 5% change or 1000+ characters
          console.log(
            `[Content Script] Significant content change detected (${changePercentage.toFixed(1)}%, ${contentChange} chars)`
          );

          // Use requestIdleCallback to avoid blocking
          if (window.requestIdleCallback) {
            requestIdleCallback(
              () => {
                this.handleContentChange();
              },
              { timeout: 5000 }
            );
          } else {
            // Fallback
            setTimeout(() => this.handleContentChange(), 100);
          }
        } else if (contentChange > 500) {
          // Minor change, log only if substantial but below the trigger threshold
          console.debug(
            `[Content Script] Minor content change detected (${contentChange} chars, below threshold)`
          );
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
          if (loadTime < 1000) {
            // Still loading
            return;
          }
        }

        console.debug('[Content Script] Processing dynamic content change...');

        // Here you could trigger content re-extraction if needed
        // For now, just log event to monitor performance if we are in high-debug mode
        // Removed memory usage log as it's too spammy
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
      console.debug('[Content Script] Dynamic content detector disconnected');
    },

    // Get observer status
    getStatus() {
      return {
        initialized: this.isInitialized,
        observing: this.observer !== null,
        lastContentLength: this.lastContentLength,
        hasDebounceTimer: this.debounceTimer !== null,
      };
    },
  };

  try {
    // Function to extract prominent images from the page
    function extractProminentImages() {
      try {
        const images = Array.from(document.querySelectorAll('img'));
        return images
          .filter(img => {
            const rect = img.getBoundingClientRect();
            // Filter by size (either natural or rendered)
            const isLargeEnough =
              (img.naturalWidth > 150 && img.naturalHeight > 150) ||
              (rect.width > 150 && rect.height > 150);

            // Basic visibility check
            const style = window.getComputedStyle(img);
            const isVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0';

            // Filter out common UI elements/icons
            const src = img.src.toLowerCase();
            const isNotIcon =
              !src.includes('icon') &&
              !src.includes('logo') &&
              !src.includes('avatar') &&
              !src.endsWith('.svg') &&
              !src.startsWith('data:image/svg+xml');

            return isLargeEnough && isVisible && isNotIcon;
          })
          .sort((a, b) => {
            const areaA = (a.naturalWidth || a.width) * (a.naturalHeight || a.height);
            const areaB = (b.naturalWidth || b.width) * (b.naturalHeight || b.height);
            return areaB - areaA;
          })
          .slice(0, 3)
          .map(img => img.src);
      } catch (e) {
        console.warn('[Content Script] Failed to extract prominent images:', e);
        return [];
      }
    }

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
        if (['content', 'article', 'post', 'story', 'text'].some(word => className.includes(word)))
          score += 15;
        if (['content', 'main', 'article', 'post'].some(word => id.includes(word))) score += 15;

        // Penalize likely non-content elements
        if (['nav', 'header', 'footer', 'aside', 'sidebar'].includes(tagName)) score -= 20;
        if (['nav', 'menu', 'sidebar', 'footer', 'header'].some(word => className.includes(word)))
          score -= 15;
        if (['nav', 'menu', 'sidebar', 'footer', 'header'].some(word => id.includes(word)))
          score -= 15;
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
      const linkText = Array.from(element?.querySelectorAll('a') || [])
        .map(a => a.textContent)
        .join(' ');
      if (linkText.length > text.length * 0.5) score -= 15;

      return Math.max(0, score);
    }

    // Function to wait for dynamic content to load with enhanced timeout protection
    async function waitForContent(timeout = 10000) {
      return new Promise(resolve => {
        const startTime = Date.now();
        let lastContentLength = 0;
        let stableCount = 0;
        let checkCount = 0;
        let consecutiveStableChecks = 0;
        const maxChecks = Math.ceil(timeout / 800); // Reduced check frequency

        // Adaptive stability detection - require more stability for large content
        const getRequiredStabilityChecks = contentLength => {
          if (contentLength > 10000) return 2; // Large content, less strict
          if (contentLength > 1000) return 3; // Medium content
          return 2; // Small content, quicker to stabilize
        };

        const checkContent = () => {
          checkCount++;

          // Safety check to prevent infinite recursion
          if (checkCount > maxChecks) {
            console.warn(
              `[Content Script] waitForContent: Max checks (${maxChecks}) reached after ${Date.now() - startTime}ms, resolving`
            );
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
                console.log(
                  `[Content Script] Content stabilized after ${Date.now() - startTime}ms (checks: ${checkCount}, length: ${currentLength})`
                );
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
              console.log(
                `[Content Script] waitForContent timeout after ${elapsedTime}ms (checks: ${checkCount}), resolving with current content`
              );
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

        console.log(
          `[Content Script] Starting waitForContent with ${timeout}ms timeout, max ${maxChecks} checks`
        );
        checkContent();
      });
    }

    /**
     * Check if extraction has exceeded timeout with threshold
     * @param {number} startTime - Start timestamp
     * @param {number} extractionTimeout - Total timeout in ms
     * @param {number} threshold - Threshold in ms before timeout
     * @returns {boolean} True if timeout exceeded
     */
    function isExtractionTimeout(startTime, extractionTimeout, threshold = 0) {
      return Date.now() - startTime > extractionTimeout - threshold;
    }

    /**
     * Perform fast-path extraction using body text
     * @returns {string} Trimmed text content
     */
    function performFastPathExtraction() {
      try {
        const fastText = document.body?.innerText || document.body?.textContent || '';
        console.log('[Content Script] Using fast-path extraction', {
          textLength: fastText.length,
        });
        return fastText.trim();
      } catch (error) {
        console.warn('[Content Script] Fast-path extraction failed:', error);
        return '';
      }
    }

    /**
     * Extract content using CSS selectors
     * @param {Array<string>} contentSelectors - List of selectors to try
     * @param {Array<string>} noiseSelectors - Noise selectors to remove
     * @param {number} startTime - Extraction start time
     * @param {number} extractionTimeout - Total timeout
     * @returns {Object} Best result {text, score, element, method}
     */
    async function extractWithSelectors(contentSelectors, noiseSelectors, startTime, extractionTimeout) {
      let bestResult = { text: '', score: 0, element: null, method: 'none' };
      console.log('[Content Script] Testing content selectors...');
      for (const selector of contentSelectors) {
        if (isExtractionTimeout(startTime, extractionTimeout, 2000)) {
          console.warn('[Content Script] Timeout approaching during selector testing, breaking');
          break;
        }
        try {
          const elements = document.querySelectorAll(selector);
          const elementsToProcess = Array.from(elements).slice(0, 5);
          for (const element of elementsToProcess) {
            if (isExtractionTimeout(startTime, extractionTimeout, 1000)) {
              console.warn('[Content Script] Timeout approaching during element processing, breaking');
              break;
            }
            try {
              ProgressiveDOMProcessor.resetTimer();
              const workingElement = element.cloneNode(true);
              const removedCount = await ProgressiveDOMProcessor.processNoiseSelectors(
                workingElement,
                noiseSelectors
              );
              const text = workingElement.textContent || workingElement.innerText || '';
              const score = calculateContentScore(text, element);
              if (score > bestResult.score) {
                bestResult = {
                  text: text.trim(),
                  score,
                  element,
                  method: `selector: ${selector} (removed ${removedCount} elements)`,
                };
                console.log(`[Content Script] New best result: ${selector} (score: ${score})`);
              }
            } catch (elementError) {
              console.warn(`[Content Script] Error processing element for ${selector}:`, elementError);
            }
          }
        } catch (error) {
          console.warn(`[Content Script] Error with selector ${selector}:`, error);
        }
      }
      return bestResult;
    }

    /**
     * Extract content from document body with noise filtering
     * @param {Array<string>} noiseSelectors - Noise selectors to remove
     * @returns {Object} Result {text, score, element, method}
     */
    async function extractFromBody(noiseSelectors) {
      console.log('[Content Script] Testing body extraction...');
      try {
        ProgressiveDOMProcessor.resetTimer();
        const workingBody = document.body.cloneNode(true);
        const removedCount = await ProgressiveDOMProcessor.processNoiseSelectors(
          workingBody,
          noiseSelectors
        );
        const bodyText = workingBody.textContent || workingBody.innerText || '';
        const bodyScore = calculateContentScore(bodyText, document.body);
        return {
          text: bodyText.trim(),
          score: bodyScore,
          element: document.body,
          method: `body-with-filtering (removed ${removedCount} elements)`,
        };
      } catch (error) {
        console.warn('[Content Script] Error with body extraction:', error);
        return { text: '', score: 0, element: null, method: 'body-failed' };
      }
    }

    /**
     * Extract unfiltered content from document body
     * @returns {Object} Result {text, score, element, method}
     */
    function extractUnfilteredText() {
      console.log('[Content Script] Testing unfiltered extraction...');
      try {
        const rawText = document.body.textContent || document.body.innerText || '';
        const rawScore = calculateContentScore(rawText, document.body);
        return {
          text: rawText.trim(),
          score: rawScore,
          element: document.body,
          method: 'unfiltered',
        };
      } catch (error) {
        console.warn('[Content Script] Error with unfiltered extraction:', error);
        return { text: '', score: 0, element: null, method: 'unfiltered-failed' };
      }
    }

    /**
     * Handle extraction timeout scenario
     * @param {Object} bestResult - Best result so far
     * @param {number} startTime - Start timestamp
     * @param {number} extractionTimeout - Total timeout
     * @returns {string} Fallback text
     */
    function handleExtractionTimeout(bestResult, startTime, extractionTimeout) {
      const finalElapsed = Date.now() - startTime;
      console.warn(
        '[Content Script] Extraction exceeded timeout, returning best-effort content',
        {
          extractionTime: finalElapsed,
          method: bestResult.method,
          score: bestResult.score,
          textLength: bestResult.text ? bestResult.text.length : 0,
        }
      );
      let fallbackText = bestResult.text;
      if (!fallbackText || fallbackText.length === 0) {
        try {
          fallbackText = (document.body?.innerText || document.body?.textContent) || '';
        } catch (fallbackError) {
          console.warn('[Content Script] Failed to obtain fallback text:', fallbackError);
          fallbackText = '';
        }
      }
      return (fallbackText || '').trim();
    }

    /**
     * Determine best extraction result from multiple methods
     * @param {...Object} results - Variable number of result objects
     * @returns {Object} Best result
     */
    function determineBestResult(...results) {
      return results.reduce((best, current) => {
        if (current.score > best.score) {
          return current;
        }
        return best;
      }, { text: '', score: 0, element: null, method: 'none' });
    }

    const extractContent = async () => {
      const extractionTimeout = 10000;
      const startTime = Date.now();
      return new Promise(async (resolve, reject) => {
        try {
          if (!document || !document.documentElement) {
            reject(new Error('Document not accessible'));
            return;
          }
          console.log('[Content Script] Starting enhanced content extraction...');
          await waitForContent();
          if (isExtractionTimeout(startTime, extractionTimeout, 1000)) {
            console.warn('[Content Script] Near timeout, using fast-path extraction');
            resolve(performFastPathExtraction());
            return;
          }
          const noiseSelectors = [
            'script', 'style', 'noscript', 'meta', 'template',
            'nav', 'header', 'footer', '.navigation', '.nav', '.menu',
            '.popup', '.modal', '.overlay', '.tooltip', '.cookie-banner',
            '.notification', '.alert', '.banner', '.ads', '.advertisement',
            '.ad-banner', '.sponsored', '.social', '.share', '.sharing',
            '.newsletter', '.signup', '.comments', '.comment-section',
            '.metadata', '.tags', '.breadcrumb', '.pagination',
            '.search-form', '.contact-form', '.skip-link', '.screen-reader-only',
            '.sr-only', '[class*="analytics"]', '[class*="tracking"]',
            '[class*="ad-"]', '[class*="popup"]', '[class*="modal"]',
            '[class*="banner"]', '[id*="analytics"]', '[id*="tracking"]',
            '[id*="ad-"]',
          ];
          const contentSelectors = [
            'main', 'article', '[role="main"]',
            '.content', '.main-content', '.post-content', '.entry-content',
            '.article-content', '.text-content', '.prose', '.markdown-body',
            '.rich-text', '.editor-content', '.blog-content', '.article-body',
            '.post-text', '[data-testid*="content"]', '[data-testid*="article"]',
            '[data-cy*="content"]', '[data-qa*="content"]', '.post',
            '.entry', '.blog-post', '.story', '.text',
            '[class*="content"]', '[class*="article"]', '[class*="post"]',
          ];
          const selectorResult = await extractWithSelectors(
            contentSelectors,
            noiseSelectors,
            startTime,
            extractionTimeout
          );
          const bodyResult = await extractFromBody(noiseSelectors);
          const unfilteredResult = extractUnfilteredText();
          const bestResult = determineBestResult(
            selectorResult,
            bodyResult,
            unfilteredResult
          );
          if (isExtractionTimeout(startTime, extractionTimeout, 0)) {
            resolve(handleExtractionTimeout(bestResult, startTime, extractionTimeout));
            return;
          }
          const finalElapsed = Date.now() - startTime;
          console.log('[Content Script] Extraction complete:', {
            method: bestResult.method,
            score: bestResult.score,
            textLength: bestResult.text.length,
            title: document.title,
            extractionTime: finalElapsed,
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
        url: window.location.href,
      });

      try {
        const fallbackText =
          (document.body && (document.body.innerText || document.body.textContent)) || '';
        console.warn('[Content Script] Falling back to raw body text after extraction error', {
          fallbackLength: fallbackText.length,
          originalError: contentError?.message,
        });
        content = fallbackText.trim();
      } catch (fallbackError) {
        console.warn('[Content Script] Fallback body text extraction also failed:', fallbackError);
        // Leave content as empty string; outer logic below will mark this
        // as a successful extraction with "no extractable textual content"
        content = '';
      }
    }

    images = extractProminentImages();
    if (content || images.length > 0) {
      success = true;
      if (content) {
        // Enhanced cleanup and filtering
        content = content
          // Remove JavaScript and technical content patterns
          .replace(/JavaScript Function \([^)]*\).*$/gim, '')
          .replace(/Additional Code:.*$/gim, '')
          .replace(/function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}/gim, '')
          .replace(/var\s+\w+\s*=.*$/gim, '')
          .replace(/const\s+\w+\s*=.*$/gim, '')
          .replace(/let\s+\w+\s*=.*$/gim, '')
          .replace(/\w+\s*:\s*function\s*\([^)]*\)/gim, '')
          .replace(/\w+\(\s*[^)]*\s*\)\s*;?/gim, '')

          // Remove analytics and tracking mentions
          .replace(/There's a \w+ script for.*$/gim, '')
          .replace(/.*tracking and analytics.*$/gim, '')
          .replace(/.*initialized with.*encoded key.*$/gim, '')
          .replace(/.*Vitally.*script.*$/gim, '')
          .replace(/.*Intercom.*messenger.*$/gim, '')
          .replace(/.*CSS styles.*included.*$/gim, '')
          .replace(/.*modal states.*$/gim, '')

          // Remove common warning/notice text patterns
          .replace(/^(warning|alert|notice|error|info):\s*/gim, '')
          .replace(/^(please note|important|attention):\s*/gim, '')
          .replace(/^(cookie|privacy) (notice|policy|warning).*$/gim, '')
          .replace(/^this (site|website) uses cookies.*$/gim, '')
          .replace(/^by continuing to use.*$/gim, '')
          .replace(/^accept (all )?cookies.*$/gim, '')
          .replace(/^we use cookies.*$/gim, '')
          .replace(/^this website uses.*cookies.*$/gim, '')

          // Remove common UI text
          .replace(/^(skip to|jump to) (main )?content$/gim, '')
          .replace(/^(back to top|scroll to top)$/gim, '')
          .replace(/^(share|follow|subscribe|newsletter)$/gim, '')
          .replace(/^(related articles?|more articles?|trending|popular)$/gim, '')

          // Remove code-like patterns
          .replace(/\{[^}]*\}/gim, '') // Remove CSS/JS object notation
          .replace(/\[[^\]]*\]/gim, '') // Remove array notation
          .replace(/\w+\.\w+\([^)]*\)/gim, '') // Remove method calls
          .replace(/\/\*.*?\*\//gim, '') // Remove CSS/JS comments
          .replace(/\/\/.*$/gim, '') // Remove single-line comments

          // Clean up whitespace
          .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
          .replace(/\t+/g, ' ') // Replace tabs with spaces
          .replace(/[ ]{2,}/g, ' ') // Replace multiple spaces with single space
          .replace(/^\s*[\r\n]/gm, '') // Remove empty lines
          .trim();

        // Final check - if content is too short or seems like just UI text, mark as empty
        if (
          content.length < 50 ||
          /^(home|menu|search|login|register|contact|about|privacy|terms)$/i.test(content) ||
          /^(loading|please wait|error|not found|404)$/i.test(content)
        ) {
          content = '';
          errorMessage = 'Page appears to contain only navigation or UI elements.';
        }
      } else {
        errorMessage = 'Page appears to have no extractable textual content.';
        success = true; // Still successful extraction, just empty content
      }
    }
  } catch (e) {
    handleError(e, {
      action: 'content_extraction',
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
    });
    success = false;
  }

  // Initialize dynamic content detection after helpers are defined
  try {
    if (!isReload && typeof DynamicContentDetector !== 'undefined') {
      DynamicContentDetector.initialize();
    } else if (!isReload) {
      console.warn(
        '[Content Script] DynamicContentDetector is not defined, skipping initialization'
      );
    }
  } catch (error) {
    console.warn('[Content Script] Failed to initialize dynamic content detector:', error);
  }

  // Set up cleanup on page unload to prevent memory leaks (only once)
  if (!isReload) {
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
          console.debug('[Content Script] Page hidden, pausing content detection...');
          if (typeof DynamicContentDetector !== 'undefined') {
            DynamicContentDetector.disconnect();
          }
        } else {
          console.debug('[Content Script] Page visible, restarting content detection...');
          if (typeof DynamicContentDetector !== 'undefined') {
            DynamicContentDetector.initialize();
          }
        }
      });
    } catch (error) {
      console.warn('[Content Script] Failed to set up cleanup listeners:', error);
    }
  }

  // Return the extraction result
  const result = {
    success: success,
    data: content,
    images: images || [],
    error: errorMessage,
    url: window.location.href,
    title: document.title || '',
    timestamp: Date.now(),
  };

  // Expose internal objects for unit tests if re-initialization flag is set
  if (window.__promptPaulAllowReinitialization) {
    window.DynamicContentDetector = DynamicContentDetector;
    window.ProgressiveDOMProcessor = ProgressiveDOMProcessor;
  }

  return result;
})();
