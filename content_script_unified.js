// content_script_unified.js - Consolidated content extraction script
(function() {
    let content = "";
    let success = false;
    let errorMessage = "";

    try {
        // Enhanced content extraction with comprehensive noise filtering
        const extractContent = () => {
            // Comprehensive list of noise selectors to remove
            const noiseSelectors = [
                // Scripts and technical elements - HIGHEST PRIORITY
                'script', 'style', 'noscript', 'link[rel="stylesheet"]',
                'meta', 'title', 'base', 'template',
                
                // Analytics and tracking
                '[class*="analytics"]', '[id*="analytics"]', '[class*="tracking"]',
                '[class*="gtm"]', '[class*="google"]', '[id*="google"]',
                '[class*="facebook"]', '[class*="twitter"]', '[class*="linkedin"]',
                '[class*="vitally"]', '[id*="vitally"]', '[class*="intercom"]',
                '[id*="intercom"]', '[class*="hotjar"]', '[class*="mixpanel"]',
                
                // Navigation and structure
                'nav', 'header', 'footer', '.navigation', '.nav', '.navbar',
                '.sidebar', '.menu', '.breadcrumb', '.breadcrumbs',
                
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
                '.author-info', '.byline', '.published-date',
                
                // Related content
                '.related', '.recommended', '.suggestions', '.more-articles',
                '.trending', '.popular', '.recent',
                
                // Forms and inputs (unless specifically needed)
                '.search-form', '.contact-form', '.newsletter-form',
                
                // Skip links and accessibility
                '.skip-link', '.screen-reader-only', '.sr-only', '.visually-hidden',
                
                // Common warning/notice patterns
                '[class*="warning"]', '[class*="alert"]', '[class*="notice"]',
                '[class*="banner"]', '[class*="notification"]',
                '[id*="warning"]', '[id*="alert"]', '[id*="notice"]',
                
                // Specific common elements
                '.back-to-top', '.scroll-to-top', '.page-nav', '.pagination',
                
                // Code and technical content
                'code', 'pre', '.code', '.highlight', '.syntax',
                '.code-block', '.code-snippet'
            ];

            // Create a working copy of the document
            const workingDoc = document.cloneNode(true);
            
            // Remove all noise elements from the working copy
            noiseSelectors.forEach(selector => {
                try {
                    const noiseElements = workingDoc.querySelectorAll(selector);
                    noiseElements.forEach(el => el.remove());
                } catch (e) {
                    // Ignore selector errors and continue
                }
            });

            // Priority order for content extraction from cleaned document
            const contentSelectors = [
                'main',
                'article', 
                '[role="main"]',
                '.content',
                '#content',
                '.post-content',
                '.entry-content',
                '.article-content',
                '.page-content',
                '.main-content'
            ];

            // Try semantic selectors first on cleaned document
            for (const selector of contentSelectors) {
                try {
                    const element = workingDoc.querySelector(selector);
                    if (element && element.innerText && element.innerText.trim()) {
                        return element.innerText.trim();
                    }
                } catch (e) {
                    // Continue to next selector if this one fails
                }
            }

            // Fallback to body content from cleaned document
            if (workingDoc.body) {
                const bodyText = workingDoc.body.innerText || workingDoc.body.textContent || "";
                if (bodyText.trim()) {
                    return bodyText.trim();
                }
            }

            // Last resort: try original document with basic filtering
            if (document.body) {
                // Create a clone and remove script/style elements
                const bodyClone = document.body.cloneNode(true);
                
                // Remove script and style elements that might leak into text
                const technicalElements = bodyClone.querySelectorAll('script, style, noscript, link, meta');
                technicalElements.forEach(el => el.remove());
                
                let text = bodyClone.innerText || bodyClone.textContent || "";
                
                // Basic text-level filtering for common warning patterns
                const warningPatterns = [
                    /^(warning|alert|notice|error|info):\s*/gmi,
                    /^(please note|important|attention):\s*/gmi,
                    /^(cookie|privacy) (notice|policy|warning)/gmi,
                    /^this (site|website) uses cookies/gmi,
                    /^by continuing to use/gmi,
                    /^accept (all )?cookies/gmi
                ];
                
                // Remove warning patterns from text
                warningPatterns.forEach(pattern => {
                    text = text.replace(pattern, '');
                });
                
                return text.trim();
            }

            return "";
        };

        content = extractContent();
        
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
        console.error("PromptPaul Extension: content_script_unified.js - Error extracting content:", e);
        errorMessage = "Error during content extraction: " + e.message;
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