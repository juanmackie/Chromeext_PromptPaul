// content_script_unified.js - Consolidated content extraction script
// Module-scoped variables for extraction result
let content = "";
let success = false;
let errorMessage = "";

/**
 * Comprehensive list of noise selectors to remove from content extraction
 */
const NOISE_SELECTORS = [
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

/**
 * Priority order for content extraction from cleaned document
 */
const CONTENT_SELECTORS = [
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

/**
 * Warning patterns to remove from extracted text
 */
const WARNING_PATTERNS = [
    /^(warning|alert|notice|error|info):\s*/gmi,
    /^(please note|important|attention):\s*/gmi,
    /^(cookie|privacy) (notice|policy|warning)/gmi,
    /^this (site|website) uses cookies/gmi,
    /^by continuing to use/gmi,
    /^accept (all )?cookies/gmi
];

/**
 * Minimum content length threshold
 */
const MIN_CONTENT_LENGTH = 50;

/**
 * Remove noise elements from a document clone
 * @param {Document} workingDoc - Cloned document to clean
 */
function removeNoiseElements(workingDoc) {
    NOISE_SELECTORS.forEach(selector => {
        try {
            const noiseElements = workingDoc.querySelectorAll(selector);
            noiseElements.forEach(el => el.remove());
        } catch (e) {
            // Ignore selector errors and continue
        }
    });
}

/**
 * Try to extract content using semantic selectors
 * @param {Document} workingDoc - Cleaned document to extract from
 * @returns {string|null} Extracted content or null if not found
 */
function extractWithSemanticSelectors(workingDoc) {
    for (const selector of CONTENT_SELECTORS) {
        try {
            const element = workingDoc.querySelector(selector);
            if (element && element.innerText && element.innerText.trim()) {
                return element.innerText.trim();
            }
        } catch (e) {
            // Continue to next selector if this one fails
        }
    }
    return null;
}

/**
 * Extract content from document body as fallback
 * @param {Document} workingDoc - Document to extract from
 * @returns {string|null} Extracted content or null if not found
 */
function extractFromBody(workingDoc) {
    if (workingDoc.body) {
        const bodyText = workingDoc.body.innerText || workingDoc.body.textContent || "";
        if (bodyText.trim()) {
            return bodyText.trim();
        }
    }
    return null;
}

/**
 * Last resort extraction from original document with basic filtering
 * @returns {string} Extracted and cleaned text
 */
function extractFromOriginalDocument() {
    if (!document.body) {
        return "";
    }
    
    // Create a clone and remove script/style elements
    const bodyClone = document.body.cloneNode(true);
    const technicalElements = bodyClone.querySelectorAll('script, style, noscript, link, meta');
    technicalElements.forEach(el => el.remove());
    
    let text = bodyClone.innerText || bodyClone.textContent || "";
    
    // Remove warning patterns from text
    WARNING_PATTERNS.forEach(pattern => {
        text = text.replace(pattern, '');
    });
    
    return text.trim();
}

/**
 * Clean up extracted content by removing technical patterns and normalizing whitespace
 * @param {string} rawContent - Raw extracted content
 * @returns {string} Cleaned content
 */
function cleanupContent(rawContent) {
    return rawContent
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
}

/**
 * Check if content is valid and meaningful
 * @param {string} contentToValidate - Content to validate
 * @returns {boolean} True if content is valid
 */
function isValidContent(contentToValidate) {
    if (!contentToValidate || contentToValidate.length < MIN_CONTENT_LENGTH) {
        return false;
    }
    
    // Check if content is just navigation or UI text
    if (/^(home|menu|search|login|register|contact|about|privacy|terms)$/i.test(contentToValidate)) {
        return false;
    }
    
    if (/^(loading|please wait|error|not found|404)$/i.test(contentToValidate)) {
        return false;
    }
    
    return true;
}

/**
 * Main content extraction function with comprehensive noise filtering
 * @returns {string} Extracted content
 */
function extractContent() {
    // Create a working copy of the document
    const workingDoc = document.cloneNode(true);
    
    // Remove all noise elements from the working copy
    removeNoiseElements(workingDoc);

    // Try semantic selectors first on cleaned document
    const semanticContent = extractWithSemanticSelectors(workingDoc);
    if (semanticContent) {
        return semanticContent;
    }

    // Fallback to body content from cleaned document
    const bodyContent = extractFromBody(workingDoc);
    if (bodyContent) {
        return bodyContent;
    }

    // Last resort: try original document with basic filtering
    return extractFromOriginalDocument();
}

/**
 * Main execution - Extract content and return result
 * This replaces the IIFE pattern with explicit function calls
 * @returns {Object} Extraction result object
 */
function main() {
    try {
        content = extractContent();
        
        if (content) {
            success = true;
            content = cleanupContent(content);
            
            // Final check - if content is too short or seems like just UI text, mark as empty
            if (!isValidContent(content)) {
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
}

// Execute main and expose result for chrome.scripting.executeScript
// This pattern allows the script to be injected and return a result
const extractionResult = main();
extractionResult;
