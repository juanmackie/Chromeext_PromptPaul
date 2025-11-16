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

        // Try to send error to background script for tracking
        try {
            chrome.runtime.sendMessage({
                action: 'contentScriptError',
                error: {
                    message: errorMessage,
                    context: context,
                    stack: error.stack,
                    url: window.location.href
                }
            });
        } catch (msgError) {
            console.warn('Failed to send error to background script:', msgError);
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

        // Function to wait for dynamic content to load
        async function waitForContent(timeout = 3000) {
            return new Promise((resolve) => {
                const startTime = Date.now();
                let lastContentLength = 0;
                let stableCount = 0;
                
                const checkContent = () => {
                    const currentContent = document.body?.textContent || '';
                    const currentLength = currentContent.length;
                    
                    // Check if content has stabilized
                    if (Math.abs(currentLength - lastContentLength) < 100) {
                        stableCount++;
                        if (stableCount >= 3) {
                            resolve();
                            return;
                        }
                    } else {
                        stableCount = 0;
                    }
                    
                    lastContentLength = currentLength;
                    
                    // Check timeout
                    if (Date.now() - startTime > timeout) {
                        resolve();
                        return;
                    }
                    
                    // Check again after a delay
                    setTimeout(checkContent, 500);
                };
                
                checkContent();
            });
        }

        // Enhanced content extraction with comprehensive noise filtering
        const extractContent = async () => {
            try {
                // Check if document is accessible
                if (!document || !document.documentElement) {
                    throw new Error('Document not accessible');
                }

                console.log('[Content Script] Starting enhanced content extraction...');
                
                // Wait for dynamic content to load
                await waitForContent(3000);
                
                // Enhanced noise selectors - more targeted and less aggressive
                const noiseSelectors = [
                    // Scripts and technical elements
                    'script', 'style', 'noscript', 'link[rel="stylesheet"]', 'meta', 'title', 'base', 'template',
                    
                    // Analytics and tracking (more specific)
                    '[class*="analytics"]', '[id*="analytics"]', '[class*="tracking"]',
                    '[class*="gtm"]', '[class*="google-analytics"]', '[id*="google-analytics"]',
                    '[class*="facebook-pixel"]', '[class*="twitter-widget"]', '[class*="linkedin-insight"]',
                    '[class*="vitally"]', '[id*="vitally"]', '[class*="intercom"]', '[id*="intercom"]',
                    
                    // Navigation and structure (but keep content areas)
                    'nav:not([role="main"])', 'header:not([role="main"])', 'footer:not([role="main"])', 
                    '.navigation', '.nav', '.navbar:not(.navbar-content)', '.sidebar:not(.content-sidebar)',
                    '.menu', '.breadcrumb', '.breadcrumbs', '.top-bar', '.bottom-bar',
                    
                    // Ads and promotional content
                    '.ads', '.advertisement', '.ad-banner', '.promo', '.promotion',
                    '.sponsored', '.affiliate', '[class*="ad-"]', '[id*="ad-"]',
                    
                    // UI elements and overlays
                    '.popup', '.modal', '.overlay', '.tooltip', '.dropdown',
                    '.cookie-banner', '.cookie-notice', '.gdpr-banner',
                    '.notification', '.alert', '.banner', '.notice',
                    '.warning', '.error-message', '.success-message',
                    
                    // Social and sharing
                    '.social', '.share', '.sharing', '.follow', '.subscribe',
                    '.newsletter', '.signup', '.login', '.register',
                    
                    // Comments and metadata
                    '.comments', '.comment-section', '.metadata', '.tags',
                    '.author-info:not(.article-author)', '.byline', '.published-date',
                    
                    // Related content (but be careful not to remove main content)
                    '.related:not(.related-content)', '.recommended', '.suggestions', '.more-articles',
                    '.trending', '.popular', '.recent',
                    
                    // Forms and inputs
                    '.search-form', '.contact-form', '.newsletter-form',
                    
                    // Skip links and accessibility
                    '.skip-link', '.screen-reader-only', '.sr-only', '.visually-hidden',
                    
                    // Common warning/notice patterns
                    '[class*="warning"]', '[class*="alert"]', '[class*="notice"]',
                    '[class*="banner"]', '[class*="notification"]',
                    '[id*="warning"]', '[id*="alert"]', '[id*="notice"]',
                    
                    // Specific common elements
                    '.back-to-top', '.scroll-to-top', '.page-nav', '.pagination',
                    
                    // Code and technical content (only if not main content)
                    'code:not(.content-code)', 'pre:not(.content-pre)', '.code:not(.content-code)', 
                    '.highlight:not(.content-highlight)', '.syntax:not(.content-syntax)'
                ];

                // Enhanced content selectors - more comprehensive and modern
                const contentSelectors = [
                    // Semantic HTML5 elements
                    'main', 'article', 'section[role="main"]',
                    
                    // Common content classes and IDs
                    '[role="main"]', '.content', '.main-content', '.post-content', '.entry-content', 
                    '.article-content', '.story-body', '.post-body', '.text-content',
                    
                    // Modern CMS and framework selectors
                    '.prose', '.markdown-body', '.rich-text', '.editor-content', '.description',
                    '.blog-content', '.article-body', '.post-text', '.content-body',
                    
                    // Data attributes and test IDs (common in modern apps)
                    '[data-testid="article-content"]', '[data-testid="post-content"]', 
                    '[data-testid="blog-post"]', '[data-testid="content"]',
                    '[data-cy="article"]', '[data-cy="content"]', '[data-qa="content"]',
                    
                    // Claude-specific and AI blog patterns
                    '.prose.prose-lg', '.max-w-4xl', '.article-prose', '.blog-prose',
                    '[class*="prose"]', '[class*="content"]', '[class*="article"]',
                    
                    // Common blog patterns
                    '.post', '.entry', '.blog-post', '.story', '.writing', '.text',
                    
                    // Fallback selectors
                    'div[class*="content"]', 'div[class*="article"]', 'div[class*="post"]',
                    'section[class*="content"]', 'section[class*="article"]'
                ];

                let bestResult = {
                    text: '',
                    score: 0,
                    element: null,
                    method: 'none'
                };

                // Method 1: Try each content selector with scoring
                console.log('[Content Script] Testing content selectors...');
                for (const selector of contentSelectors) {
                    try {
                        const elements = document.querySelectorAll(selector);
                        for (const element of elements) {
                            // Create a working copy and remove noise
                            const workingElement = element.cloneNode(true);
                            noiseSelectors.forEach(noiseSelector => {
                                try {
                                    const noiseElements = workingElement.querySelectorAll(noiseSelector);
                                    noiseElements.forEach(el => el.remove());
                                } catch (e) {
                                    // Continue if selector fails
                                }
                            });
                            
                            const text = workingElement.textContent || workingElement.innerText || '';
                            const score = calculateContentScore(text, element);
                            
                            if (score > bestResult.score) {
                                bestResult = {
                                    text: text.trim(),
                                    score,
                                    element,
                                    method: `selector: ${selector}`
                                };
                                console.log(`[Content Script] New best result: ${selector} (score: ${score})`);
                            }
                        }
                    } catch (error) {
                        console.warn(`[Content Script] Error with selector ${selector}:`, error);
                    }
                }

                // Method 2: Try body with noise filtering
                console.log('[Content Script] Testing body extraction...');
                try {
                    const workingBody = document.body.cloneNode(true);
                    noiseSelectors.forEach(noiseSelector => {
                        try {
                            const noiseElements = workingBody.querySelectorAll(noiseSelector);
                            noiseElements.forEach(el => el.remove());
                        } catch (e) {
                            // Continue if selector fails
                        }
                    });
                    
                    const bodyText = workingBody.textContent || workingBody.innerText || '';
                    const bodyScore = calculateContentScore(bodyText, document.body);
                    
                    if (bodyScore > bestResult.score) {
                        bestResult = {
                            text: bodyText.trim(),
                            score: bodyScore,
                            element: document.body,
                            method: 'body-with-filtering'
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

                console.log('[Content Script] Extraction complete:', {
                    method: bestResult.method,
                    score: bestResult.score,
                    textLength: bestResult.text.length,
                    title: document.title
                });

                return bestResult.text;
                
            } catch (extractionError) {
                throw new Error(`Content extraction failed: ${extractionError.message}`);
            }
        };

try {
            content = await extractContent();
        } catch (contentError) {
            handleError(contentError, {
                action: 'extract_content_call',
                url: window.location.href
            });
            success = false;
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