// content_script_unified.js - Consolidated content extraction script
// Includes: Readability, Turndown, YouTube Transcript extraction, and Message Listening

(function() {
    // --- 1. SETUP & UTILS ---

    // Prevent multiple registrations
    if (window.PROMPT_PAUL_LOADED) {
        console.log("PromptPaul: Content script already loaded, skipping registration.");
        return;
    }
    window.PROMPT_PAUL_LOADED = true;

    let turndownService = null;
    if (typeof TurndownService !== 'undefined') {
        turndownService = new TurndownService({
             headingStyle: 'atx',
             codeBlockStyle: 'fenced'
        });
        turndownService.remove(['script', 'style', 'noscript', 'head', 'img', 'picture', 'video', 'audio', 'iframe', 'svg', 'canvas', 'map', 'object', 'embed']);
    }

    // --- 2. STRATEGY: YOUTUBE ---

    async function extractYouTube() {
        try {
            const url = window.location.href;
            if (!url.includes('youtube.com/watch') && !url.includes('youtube.com/live')) {
                return null;
            }

            console.log("PromptPaul: Starting YouTube extraction for", url);

            let playerResponse = null;

            // Method A: Check script tags for ytInitialPlayerResponse
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const text = script.textContent;
                if (text && text.includes('ytInitialPlayerResponse')) {
                    // More flexible regex to handle var/window prefixes and potential minification
                    const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/) ||
                                  text.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?});/);

                    if (match && match[1]) {
                        try {
                            playerResponse = JSON.parse(match[1]);
                            console.log("PromptPaul: Found playerResponse in script tag.");
                            break;
                        } catch (e) {
                            console.warn("PromptPaul: Failed to parse playerResponse JSON", e);
                        }
                    }
                }
            }

            // Method B: Try to find in window (often accessible if injected correctly, though content scripts have restricted window access)
            // As a fallback, try to find ytInitialData which sometimes contains parts of the response
            if (!playerResponse) {
                for (const script of scripts) {
                    const text = script.textContent;
                    if (text && text.includes('ytInitialData')) {
                        const match = text.match(/ytInitialData\s*=\s*({.+?});/) ||
                                      text.match(/var\s+ytInitialData\s*=\s*({.+?});/);
                        if (match && match[1]) {
                             console.log("PromptPaul: Found ytInitialData fallback.");
                             // ytInitialData is different but might help us identify if the page is just taking time to load
                        }
                    }
                }
            }

            if (!playerResponse) {
                console.warn("PromptPaul: ytInitialPlayerResponse not found. Page might be loading or layout changed.");
                return {
                    type: 'youtube-error',
                    title: document.title,
                    siteName: "YouTube",
                    data: "Transcript extraction failed: Could not find video data on page. YouTube might have updated its layout or the page is still loading. Try refreshing or waiting a moment."
                };
            }

            // --- Metadata Extraction ---
            const videoDetails = playerResponse.videoDetails || {};
            const microformat = playerResponse.microformat?.playerMicroformatRenderer || {};

            const metadata = {
                title: videoDetails.title || document.title,
                siteName: "YouTube",
                byline: videoDetails.author || "", // Channel name
                viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount).toLocaleString() : "",
                uploadDate: microformat.publishDate || "",
                description: videoDetails.shortDescription || ""
            };

            // --- Caption Extraction ---
            // Check multiple potential paths for caption tracks
            const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
                             playerResponse?.captions?.captionsRenderer?.captionTracks;

            if (!captions || captions.length === 0) {
                console.warn("PromptPaul: No caption tracks found in playerResponse.");

                // Fallback: If we have no captions but have metadata, still return what we have
                // but mark it as a partial success/error
                return {
                    ...metadata,
                    type: 'youtube-error',
                    data: `## Video: ${metadata.title}\n\n**Note: No transcript available (captions are disabled or not found).**\n\n**Description:**\n${metadata.description || "No description available."}`
                };
            }

            // Pick Best Track (English preference)
            captions.sort((a, b) => {
                const aLang = a.languageCode;
                const bLang = b.languageCode;
                if (aLang === 'en') return -1;
                if (bLang === 'en') return 1;
                return 0;
            });
            const track = captions[0];
            const baseUrl = track.baseUrl;

            // Fetch XML
            const response = await fetch(baseUrl);
            const xmlText = await response.text();

            // Parse XML with Timestamps
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const textNodes = xmlDoc.getElementsByTagName("text");

            let transcriptLines = [];
            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                const text = node.textContent.replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
                const startSec = parseFloat(node.getAttribute('start') || "0");

                // Format: [MM:SS]
                const minutes = Math.floor(startSec / 60);
                const seconds = Math.floor(startSec % 60);
                const timeStr = `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}]`;

                transcriptLines.push(`${timeStr} ${text}`);
            }

            // Structured Formatting
            let formattedContent = `## Video: ${metadata.title}\n`;
            formattedContent += `**Channel:** ${metadata.byline}  \n`;
            if (metadata.uploadDate) formattedContent += `**Published:** ${metadata.uploadDate}  \n`;
            if (metadata.viewCount) formattedContent += `**Views:** ${metadata.viewCount}  \n\n`;

            formattedContent += `### Transcript\n\n${transcriptLines.join('\n')}`;

            return {
                ...metadata,
                type: 'youtube-transcript',
                data: formattedContent
            };

        } catch (e) {
            console.error("PromptPaul: YouTube extraction error:", e);
            return null; // Fallback
        }
    }

    async function extractUniversalVideo() {
        // Fallback for other video sites (Vimeo, Loom, etc.)
        const videoTag = document.querySelector('video');
        if (!videoTag) return null;

        console.log("PromptPaul: Video tag detected, extracting metadata...");

        // Try to get structured data (OpenGraph/JSON-LD)
        const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
        const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.content;
        const ogDescription = document.querySelector('meta[property="og:description"]')?.content;
        const author = document.querySelector('meta[name="author"]')?.content || document.querySelector('[itemprop="author"]')?.textContent;

        const siteName = ogSiteName || window.location.hostname.replace('www.', '');

        return {
            type: 'universal-video',
            title: ogTitle || document.title,
            siteName: siteName,
            byline: author || "",
            excerpt: ogDescription || "",
            data: `## Video found on ${siteName}\n\n**Title:** ${ogTitle || document.title}\n**Description:** ${ogDescription || "No description available."}\n\n*Note: Transcript extraction is only supported for YouTube. This is a metadata-only fallback.*`
        };
    }

    // --- 3. STRATEGY: READABILITY (From Phase 1) ---

    function extractReadability() {
        if (typeof Readability === 'undefined') return null;
        try {
            const documentClone = document.cloneNode(true);
            const reader = new Readability(documentClone);
            const article = reader.parse();
            if (article && article.content) {
                const result = {
                    title: article.title,
                    siteName: article.siteName || "",
                    byline: article.byline || "",
                    excerpt: article.excerpt || "",
                    lang: article.lang || ""
                };

                if (turndownService) {
                    const markdown = turndownService.turndown(article.content);
                    if (markdown.length > 50) {
                        return { ...result, type: 'readability-markdown', data: markdown };
                    }
                }
                if (article.textContent.length > 50) {
                    return { ...result, type: 'readability-text', data: article.textContent.trim() };
                }
            }
        } catch (e) { console.warn("PromptPaul: Readability failed", e); }
        return null;
    }

    // --- 4. STRATEGY: LEGACY FALLBACK ---

    function extractLegacy() {
        // [Existing legacy logic condensed]
        const NOISE = ['script', 'style', 'nav', 'header', 'footer', '.ads', '.comments'];
        const doc = document.cloneNode(true);
        NOISE.forEach(s => doc.querySelectorAll(s).forEach(e => e.remove()));

        let text = "";
        ['main', 'article', '#content'].some(sel => {
            const el = doc.querySelector(sel);
            if (el && el.innerText.trim()) { text = el.innerText.trim(); return true; }
        });

        if (!text && doc.body) text = doc.body.innerText;

        return { type: 'legacy', data: (text || "").replace(/\n{3,}/g, '\n\n').trim(), title: document.title };
    }

    // --- 5. MAIN ROUTER ---

    async function getUnifiedContent() {
        let result = await extractYouTube();
        if (result) return result;

        result = await extractUniversalVideo();
        if (result) return result;

        result = extractReadability();
        if (result) return result;

        return extractLegacy();
    }

    async function captureVideoFrame() {
        const video = document.querySelector('video');
        if (!video) return null;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Limit resolution to avoid massive messages
            const MAX_WIDTH = 1280;
            if (canvas.width > MAX_WIDTH) {
                const scale = MAX_WIDTH / canvas.width;
                const lowResCanvas = document.createElement('canvas');
                lowResCanvas.width = MAX_WIDTH;
                lowResCanvas.height = canvas.height * scale;
                const lowResCtx = lowResCanvas.getContext('2d');
                lowResCtx.drawImage(canvas, 0, 0, lowResCanvas.width, lowResCanvas.height);
                return lowResCanvas.toDataURL('image/jpeg', 0.7);
            }

            return canvas.toDataURL('image/jpeg', 0.8);
        } catch (e) {
            console.warn("PromptPaul: Failed to capture video frame", e);
            return null;
        }
    }

    // --- 6. MESSAGE LISTENER (CRITICAL FIX) ---

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'captureVideoFrames') {
            const video = document.querySelector('video');
            if (!video) {
                sendResponse({ success: false, error: "No video element found" });
                return;
            }

            // Capture initial frame immediately
            captureVideoFrame().then(frame => {
                sendResponse({ success: true, frame: frame });
            }).catch(e => {
                sendResponse({ success: false, error: e.toString() });
            });
            return true;
        }

        if (request.action === 'getTabContent' || request.action === 'getLoadContent') {
            console.log(`PromptPaul Content Script: Received ${request.action} request.`);

            getUnifiedContent().then(result => {
                const response = {
                    success: !!(result && result.data),
                    content: result ? result.data : "",
                    data: result ? result.data : "", // Keep for backward compatibility
                    title: result ? result.title : document.title,
                    siteName: result ? result.siteName : "",
                    byline: result ? result.byline : "",
                    excerpt: result ? result.excerpt : "",
                    lang: result ? result.lang : "",
                    url: window.location.href,
                    error: result ? null : "Extraction failed"
                };
                console.log("PromptPaul Content Script: Sending response:", response.success);
                sendResponse(response);
            }).catch(e => {
                console.error("PromptPaul Content Script: Error in handler:", e);
                sendResponse({ success: false, error: e.toString() });
            });

            return true; // Keep channel open for async response
        }
    });

    console.log("PromptPaul: Unified content script (v2) loaded.");

})();
