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

    // --- 2. VIDEO DETECTION ---

    function isVideoSite(url) {
        return /^(https?:\/\/)?(www\.)?(youtube|vimeo|loom|wistia)\.com/.test(url);
    }

    // --- 3. STRATEGY: VIDEO (UNIFIED) ---

    async function extractVideo() {
        const url = window.location.href;

        // YouTube: Full transcript extraction
        if (url.includes('youtube.com/watch') || url.includes('youtube.com/live')) {
            return extractYouTubeTranscript();
        }

        // Universal video: Metadata-only fallback
        return extractVideoMetadata();
    }

    async function extractYouTubeTranscript() {
        try {
            console.log("PromptPaul: Starting YouTube extraction for", window.location.href);

            let playerResponse = null;
            const scripts = document.querySelectorAll('script');

            for (const script of scripts) {
                const text = script.textContent;
                if (text && text.includes('ytInitialPlayerResponse')) {
                    const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/) ||
                                  text.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?});/);

                    if (match && match[1]) {
                        try {
                            playerResponse = JSON.parse(match[1]);
                            break;
                        } catch (e) {
                            console.warn("PromptPaul: Failed to parse playerResponse JSON", e);
                        }
                    }
                }
            }

            if (!playerResponse) {
                console.warn("PromptPaul: ytInitialPlayerResponse not found.");
                return {
                    type: 'youtube-error',
                    title: document.title,
                    siteName: "YouTube",
                    data: "Transcript extraction failed: Could not find video data on page. YouTube might have updated its layout or the page is still loading."
                };
            }

            const videoDetails = playerResponse.videoDetails || {};
            const microformat = playerResponse.microformat?.playerMicroformatRenderer || {};

            const metadata = {
                title: videoDetails.title || document.title,
                siteName: "YouTube",
                byline: videoDetails.author || "",
                viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount).toLocaleString() : "",
                uploadDate: microformat.publishDate || "",
                description: videoDetails.shortDescription || ""
            };

            const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
                             playerResponse?.captions?.captionsRenderer?.captionTracks;

            if (!captions || captions.length === 0) {
                return {
                    ...metadata,
                    type: 'youtube-error',
                    data: `## Video: ${metadata.title}\n\n**Note: No transcript available (captions are disabled or not found).**\n\n**Description:**\n${metadata.description || "No description available."}`
                };
            }

            captions.sort((a, b) => {
                if (a.languageCode === 'en') return -1;
                if (b.languageCode === 'en') return 1;
                return 0;
            });

            const track = captions[0];
            const response = await fetch(track.baseUrl);
            const xmlText = await response.text();

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const textNodes = xmlDoc.getElementsByTagName("text");

            const transcriptLines = [];
            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                const text = node.textContent.replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
                const startSec = parseFloat(node.getAttribute('start') || "0");
                const minutes = Math.floor(startSec / 60);
                const seconds = Math.floor(startSec % 60);
                transcriptLines.push(`[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] ${text}`);
            }

            let formattedContent = `## Video: ${metadata.title}\n**Channel:** ${metadata.byline}  \n`;
            if (metadata.uploadDate) formattedContent += `**Published:** ${metadata.uploadDate}  \n`;
            if (metadata.viewCount) formattedContent += `**Views:** ${metadata.viewCount}  \n\n`;
            formattedContent += `### Transcript\n\n${transcriptLines.join('\n')}`;

            return { ...metadata, type: 'youtube-transcript', data: formattedContent };

        } catch (e) {
            console.error("PromptPaul: YouTube extraction error:", e);
            return null;
        }
    }

    function extractVideoMetadata() {
        const videoTag = document.querySelector('video');
        if (!videoTag) return null;

        console.log("PromptPaul: Video tag detected, extracting metadata...");

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
            data: `## Video found on ${siteName}\n\n**Title:** ${ogTitle || document.title}\n**Description:** ${ogDescription || "No description available."}\n\n*Note: Transcript extraction is only supported for YouTube.*`
        };
    }

    // --- 4. STRATEGY: READABILITY ---

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

    // --- 4a. STRATEGY: FALLBACK (web2md-style) ---

    function extractFallback() {
        if (typeof TurndownService === 'undefined') return null;

        try {
            const clone = document.body.cloneNode(true);

            const NOISE = 'script, style, noscript, nav, header, footer, aside, ' +
                          '.sidebar, .side, .ads, .advertisement, .social, .share, ' +
                          '#header, #footer, #sidebar';
            clone.querySelectorAll(NOISE).forEach(el => el.remove());

            const markdown = turndownService.turndown(clone.innerHTML);

            if (markdown.length > 100) {
                return {
                    type: 'fallback-markdown',
                    title: document.title,
                    siteName: window.location.hostname.replace('www.', ''),
                    data: markdown
                };
            }
        } catch (e) {
            console.warn("PromptPaul: Fallback extraction failed", e);
        }
        return null;
    }

    // --- 5. MAIN ROUTER (TWO-PASS COMPARISON) ---

    async function getUnifiedContent() {
        // 1. Video sites get special handling
        if (isVideoSite(window.location.href)) {
            const videoResult = await extractVideo();
            if (videoResult) return videoResult;
        }

        // 2. Run BOTH extractors for comparison
        const readabilityResult = extractReadability();
        const fallbackResult = extractFallback();

        // 3. Handle edge cases where one fails
        if (!readabilityResult && !fallbackResult) {
            return null;
        }
        if (!readabilityResult) {
            return fallbackResult;
        }
        if (!fallbackResult) {
            return readabilityResult;
        }

        // 4. Compare outputs - if fallback has 2x+ more content, use it (forum pattern)
        const readLen = readabilityResult.data?.length || 0;
        const fallLen = fallbackResult.data?.length || 0;

        if (fallLen > readLen * 2) {
            console.log(`PromptPaul: Using fallback (${fallLen} vs ${readLen} chars) - forum-like content detected`);
            return fallbackResult;
        }

        // 5. Otherwise prefer Readability (cleaner for articles)
        console.log(`PromptPaul: Using Readability (${readLen} vs ${fallLen} chars) - article-like content`);
        return readabilityResult;
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
