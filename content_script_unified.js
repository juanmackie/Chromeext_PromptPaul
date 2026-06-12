// content_script_unified.js - Consolidated content extraction script
// Includes: Readability, Turndown, YouTube Transcript extraction, and Message Listening

(function () {
  // --- 1. SETUP & UTILS ---

  // Prevent multiple registrations
  if (window.PROMPT_PAUL_LOADED) {
    console.log('PromptPaul: Content script already loaded, skipping registration.');
    return;
  }
  window.PROMPT_PAUL_LOADED = true;

  let turndownService = null;
  if (typeof TurndownService !== 'undefined') {
    turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
    turndownService.remove([
      'script',
      'style',
      'noscript',
      'head',
      'img',
      'picture',
      'video',
      'audio',
      'iframe',
      'svg',
      'canvas',
      'map',
      'object',
      'embed',
    ]);
  }

  // --- 2. VIDEO DETECTION ---

  function isVideoSite(url) {
    return /^(https?:\/\/)?(www\.)?(youtube|vimeo|loom|wistia)\.com/.test(url);
  }

  function isYouTubePage(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      if (host !== 'youtube.com') return false;
      const path = parsed.pathname || '';
      return (
        path.startsWith('/watch') ||
        path.startsWith('/live') ||
        path.startsWith('/shorts') ||
        path.startsWith('/embed')
      );
    } catch {
      return false;
    }
  }

  function getYouTubeVideoId(url = window.location.href) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      if (host !== 'youtube.com') return null;

      const v = parsed.searchParams.get('v');
      if (v) return v;

      const parts = (parsed.pathname || '').split('/').filter(Boolean);
      if (parts.length >= 2 && ['live', 'shorts', 'embed'].includes(parts[0])) {
        return parts[1];
      }
    } catch {
      // ignore and return null
    }
    return null;
  }

  // --- 3. STRATEGY: VIDEO (UNIFIED) ---

  async function extractVideo() {
    const url = window.location.href;

    // YouTube: Full transcript extraction
    if (isYouTubePage(url)) {
      const transcript = await extractYouTubeTranscript();
      if (transcript) return transcript;
      // Keep YouTube-specific fallback output for YouTube pages.
      return createYouTubeFallback(null);
    }

    // Universal video: Metadata-only fallback
    return extractVideoMetadata();
  }

  // --- 3a. YOUTUBE CONFIG HELPERS ---

  function getYtcfg(key) {
    if (typeof window.ytcfg === 'function') return window.ytcfg(key);
    if (window.ytcfg?.data_?.[key] !== undefined) return window.ytcfg.data_[key];
    if (window.ytcfg?.get) return window.ytcfg.get(key);
    return null;
  }

  function extractYtcfgFromScripts() {
    const scripts = document.querySelectorAll('script:not([src])');
    let apiKey = null;
    let contextStr = null;
    for (const script of scripts) {
      const text = script.textContent;
      if (!text) continue;
      if (!apiKey && text.includes('INNERTUBE_API_KEY')) {
        const m = text.match(/INNERTUBE_API_KEY["']?\s*[,=]\s*["']([^"']+)["']/);
        if (m) apiKey = m[1];
      }
      if (!contextStr && text.includes('INNERTUBE_CONTEXT')) {
        const m = text.match(/INNERTUBE_CONTEXT["']?\s*[,=]\s*({.+?});/);
        if (m) try { contextStr = JSON.parse(m[1]); } catch (_) { /* ignore */ }
      }
      if (apiKey && contextStr) break;
    }
    return apiKey && contextStr ? { apiKey, context: contextStr } : null;
  }

  async function fetchPlayerFromInnerTube(videoId) {
    let apiKey = getYtcfg('INNERTUBE_API_KEY');
    let context = getYtcfg('INNERTUBE_CONTEXT');

    if (!apiKey || !context) {
      const fallback = extractYtcfgFromScripts();
      if (fallback) {
        apiKey = fallback.apiKey;
        context = fallback.context;
      } else {
        return null;
      }
    }

    const resp = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, videoId }),
      }
    );
    if (!resp.ok) return null;
    return await resp.json();
  }

  async function getYouTubePlayerResponse() {
    const videoId = getYouTubeVideoId();

    // Fast path: window global (set by YouTube on dynamic nav)
    if (window.ytInitialPlayerResponse) {
      return window.ytInitialPlayerResponse;
    }

    // Fallback order: inline script extraction, then InnerTube API.
    const scriptResult = findPlayerResponseInScripts();
    if (scriptResult) return scriptResult;

    const polled = await pollForPlayerResponse();
    if (polled) return polled;

    const result = videoId ? await fetchPlayerFromInnerTube(videoId) : null;

    return result || null;
  }

  async function pollForPlayerResponse() {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (window.ytInitialPlayerResponse) {
        return window.ytInitialPlayerResponse;
      }
      // After 500ms, also try inline scripts (handles delayed hydration)
      if (i === 5) {
        const scriptResult = findPlayerResponseInScripts();
        if (scriptResult) return scriptResult;
      }
    }
    return null;
  }

  function findPlayerResponseInScripts() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (text && text.includes('ytInitialPlayerResponse')) {
        const match =
          text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/) ||
          text.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match && match[1]) {
          try {
            return JSON.parse(match[1]);
          } catch (e) {
            // continue
          }
        }
      }
    }
    return null;
  }

  async function extractYouTubeTranscript() {
    try {
      console.log('PromptPaul: Starting YouTube extraction for', window.location.href);

      const playerResponse = await getYouTubePlayerResponse();
      const metadata = getYouTubeMetadata(playerResponse);

      const captions =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
        playerResponse?.captions?.captionsRenderer?.captionTracks;

      if (!captions || captions.length === 0) {
        return createYouTubeFallback(metadata);
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
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const textNodes = xmlDoc.getElementsByTagName('text');

      const transcriptLines = [];
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        const text = node.textContent
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .trim();
        const startSec = parseFloat(node.getAttribute('start') || '0');
        const minutes = Math.floor(startSec / 60);
        const seconds = Math.floor(startSec % 60);
        transcriptLines.push(
          `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] ${text}`
        );
      }

      let formattedContent = `## Video: ${metadata.title}\n**Channel:** ${metadata.byline}  \n`;
      if (metadata.uploadDate) formattedContent += `**Published:** ${metadata.uploadDate}  \n`;
      if (metadata.viewCount) formattedContent += `**Views:** ${metadata.viewCount}  \n\n`;
      formattedContent += `### Transcript\n\n${transcriptLines.join('\n')}`;

      return { ...metadata, type: 'youtube-transcript', data: formattedContent };
    } catch (e) {
      console.error('PromptPaul: YouTube extraction error:', e);
      return createYouTubeFallback(null);
    }
  }

  function getYouTubeMetadata(playerResponse) {
    const videoDetails = playerResponse?.videoDetails || {};
    const microformat = playerResponse?.microformat?.playerMicroformatRenderer || {};

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const ogDescription = document.querySelector('meta[property="og:description"]')?.content?.trim();
    const domTitle =
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
      document.querySelector('h1.title yt-formatted-string')?.textContent?.trim() ||
      '';
    const channelDom =
      document.querySelector('#owner #channel-name a')?.textContent?.trim() ||
      document.querySelector('ytd-channel-name a')?.textContent?.trim() ||
      '';
    const authorMeta =
      document.querySelector('meta[name="author"]')?.content?.trim() ||
      document.querySelector('[itemprop="author"]')?.textContent?.trim() ||
      '';
    const cleanedDocumentTitle = (document.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();

    return {
      title: videoDetails.title || ogTitle || domTitle || cleanedDocumentTitle || 'YouTube video',
      siteName: 'YouTube',
      byline: videoDetails.author || channelDom || authorMeta || '',
      viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount).toLocaleString() : '',
      uploadDate: microformat.publishDate || '',
      description: videoDetails.shortDescription || ogDescription || '',
    };
  }

  function createYouTubeFallback(metadataInput) {
    const metadata = metadataInput || getYouTubeMetadata(null);
    return {
      ...metadata,
      type: 'youtube-error',
      data: `## Video: ${metadata.title}\n\n**Note: No transcript available (captions are disabled or not found).**\n\n**Description:**\n${metadata.description || 'No description available.'}`,
    };
  }

  function extractVideoMetadata() {
    const videoTag = document.querySelector('video');
    if (!videoTag) return null;

    console.log('PromptPaul: Video tag detected, extracting metadata...');

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.content;
    const ogDescription = document.querySelector('meta[property="og:description"]')?.content;
    const author =
      document.querySelector('meta[name="author"]')?.content ||
      document.querySelector('[itemprop="author"]')?.textContent;
    const siteName = ogSiteName || window.location.hostname.replace('www.', '');

    return {
      type: 'universal-video',
      title: ogTitle || document.title,
      siteName: siteName,
      byline: author || '',
      excerpt: ogDescription || '',
      data: `## Video found on ${siteName}\n\n**Title:** ${ogTitle || document.title}\n**Description:** ${ogDescription || 'No description available.'}\n\n*Note: Transcript extraction is only supported for YouTube.*`,
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
          siteName: article.siteName || '',
          byline: article.byline || '',
          excerpt: article.excerpt || '',
          lang: article.lang || '',
          canonicalUrl: getCanonicalUrl(),
          publishedTime: getPublishedTime(),
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
    } catch (e) {
      console.warn('PromptPaul: Readability failed', e);
    }
    return null;
  }

  // --- 4a. STRATEGY: FALLBACK (web2md-style) ---

  function extractFallback() {
    if (typeof TurndownService === 'undefined') return null;

    try {
      const clone = document.body.cloneNode(true);

      const NOISE =
        'script, style, noscript, nav, header, footer, aside, ' +
        '.sidebar, .side, .ads, .advertisement, .social, .share, ' +
        '#header, #footer, #sidebar';
      clone.querySelectorAll(NOISE).forEach((el) => el.remove());

      const markdown = turndownService.turndown(clone.innerHTML);

      if (markdown.length > 100) {
        return {
          type: 'fallback-markdown',
          title: document.title,
          siteName: window.location.hostname.replace('www.', ''),
          lang: document.documentElement?.lang || '',
          data: markdown,
        };
      }
    } catch (e) {
      console.warn('PromptPaul: Fallback extraction failed', e);
    }
    return null;
  }

  // --- 4b. PLATFORM DETECTION ---

  function detectPlatform(url) {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname;

    if (
      host === 'youtube.com' &&
      (path.startsWith('/watch') || path.startsWith('/live') || path.startsWith('/shorts') || path.startsWith('/embed'))
    ) {
      return {
        platform: 'youtube',
        label: 'YouTube video',
        title: document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim(),
        channel:
          document.querySelector('#owner #channel-name a')?.textContent?.trim() ||
          document.querySelector('ytd-channel-name a')?.textContent?.trim() ||
          '',
        currentTimeSeconds: getCurrentVideoTime(),
        durationSeconds: getCurrentVideoDuration(),
        chapterTitles: getYouTubeChapterTitles(),
        videoId: getYouTubeVideoId(),
      };
    }
    if (host === 'mail.google.com') {
      return { platform: 'gmail', label: 'Gmail' };
    }
    if (host === 'github.com') {
      return { platform: 'github', label: 'GitHub' };
    }
    if (host === 'docs.google.com') {
      if (path.startsWith('/document/')) return { platform: 'google-docs', label: 'Google Docs' };
      if (path.startsWith('/spreadsheets/')) return { platform: 'google-sheets', label: 'Google Sheets' };
      if (path.startsWith('/presentation/')) return { platform: 'google-slides', label: 'Google Slides' };
    }
    if (host.endsWith('arxiv.org') && (path.startsWith('/abs/') || path.startsWith('/pdf/'))) {
      const arxivId = path.match(/\/(\d+\.\d+)/)?.[1] || '';
      return { platform: 'arxiv', label: 'arXiv paper', arxivId, absUrl: `https://arxiv.org/abs/${arxivId}`, pdfUrl: `https://arxiv.org/pdf/${arxivId}` };
    }
    if (path.endsWith('.pdf')) {
      return { platform: 'pdf', label: 'PDF document' };
    }
    if (host.endsWith('wikipedia.org')) {
      return { platform: 'wikipedia', label: 'Wikipedia article' };
    }
    if (/^(news|n\.news|m\.news)\./i.test(host) || /\.(reuters|apnews|bbc|cnn|nytimes|washingtonpost|wsj|bloomberg|theguardian)\./i.test(host)) {
      return { platform: 'news', label: 'News article' };
    }
    if (/(amazon|ebay|walmart|target|bestbuy|etsy)\./i.test(host)) {
      return { platform: 'shopping', label: 'Shopping page' };
    }
    if (/(booking|airbnb|expedia|tripadvisor|kayak|skyscanner)\./i.test(host)) {
      return { platform: 'travel', label: 'Travel page' };
    }
    return null;
  }

  function getCurrentVideoTime() {
    const video = document.querySelector('video');
    return video && Number.isFinite(video.currentTime) ? Math.floor(video.currentTime) : 0;
  }

  function getCurrentVideoDuration() {
    const video = document.querySelector('video');
    return video && Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
  }

  function getYouTubeChapterTitles() {
    const titles = Array.from(document.querySelectorAll('ytd-macro-markers-list-item-renderer h4, ytd-chapter-renderer h4'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    return titles.slice(0, 12);
  }

  function determineReadStrategy(input) {
    if (input.adapterMatched) return 'adapter';
    if (input.hasCanvas) return 'hybrid';
    if (input.hasVideo || input.hasDenseInteractiveUi) return 'hybrid';
    if (input.textLength < 500 && input.imageCount > 0) return 'vision';
    return 'dom';
  }

  function collectPageSignals(url, platformInfo, bodyText) {
    const text = String(bodyText || '');
    const platform = platformInfo?.platform || null;
    const codeBlockCount = document.querySelectorAll('pre, code').length;
    const tableCount = document.querySelectorAll('table').length;
    const listItemCount = document.querySelectorAll('li').length;
    const headingCount = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
    const paragraphCount = document.querySelectorAll('p').length;
    const linkCount = document.querySelectorAll('a').length;
    const imageCount = document.images.length;
    const hasCanvas = document.querySelectorAll('canvas').length > 2;
    const hasVideo = document.querySelectorAll('video').length > 0;
    const hasDenseInteractiveUi = document.querySelectorAll('[contenteditable]').length > 5;
    const adapterMatched = Boolean(platformInfo);
    const isCodeHeavy =
      platform === 'github' ||
      platform === 'gitlab' ||
      codeBlockCount > 4 ||
      (linkCount > 80 && codeBlockCount > 1) ||
      /(code|docs|developer|api|reference)/i.test(url || '');
    const isTableHeavy = platform === 'google-sheets' || tableCount > 2;
    const isListHeavy = listItemCount > 20 || (listItemCount > 8 && text.length < 5000);
    const isArticleLike =
      platform === 'news' ||
      platform === 'wikipedia' ||
      platform === 'arxiv' ||
      platform === 'pdf' ||
      (text.length > 1200 && headingCount <= 20 && !isCodeHeavy && !isTableHeavy);

    return {
      adapterMatched,
      hasCanvas,
      hasVideo,
      hasDenseInteractiveUi,
      textLength: text.length,
      imageCount,
      platform,
      codeBlockCount,
      tableCount,
      listItemCount,
      headingCount,
      paragraphCount,
      linkCount,
      isCodeHeavy,
      isTableHeavy,
      isListHeavy,
      isArticleLike,
    };
  }

  function normalizeExtractionText(text) {
    return String(text || '')
      .replace(/\u0000/gu, '') // eslint-disable-line no-control-regex
      .replace(/\r\n/gu, '\n')
      .replace(/\n{4,}/gu, '\n\n\n')
      .trim();
  }

  function countPatternMatches(text, pattern) {
    const matches = String(text || '').match(pattern);
    return matches ? matches.length : 0;
  }

  function getCanonicalUrl() {
    return document.querySelector('link[rel="canonical"]')?.href || '';
  }

  function getPublishedTime() {
    return (
      document.querySelector('meta[property="article:published_time"]')?.content?.trim() ||
      document.querySelector('meta[name="article:published_time"]')?.content?.trim() ||
      document.querySelector('meta[name="date"]')?.content?.trim() ||
      document.querySelector('meta[property="og:published_time"]')?.content?.trim() ||
      ''
    );
  }

  function buildExtractionReason(source, signals) {
    if (source === 'readability') {
      if (signals.isArticleLike) return 'Article-like page favored Readability.';
      if (signals.isCodeHeavy || signals.isTableHeavy || signals.isListHeavy) {
        return 'Readability still produced the cleaner narrative text.';
      }
      return 'Readability produced the most coherent text extraction.';
    }

    if (signals.isCodeHeavy) return 'Fallback kept code and link structure on a code-heavy page.';
    if (signals.isTableHeavy) return 'Fallback preserved tables and structured content better.';
    if (signals.isListHeavy) return 'Fallback retained list structure better than Readability.';
    if (signals.isArticleLike) return 'Fallback won despite the page reading like an article.';
    return 'Fallback preserved more usable structure.';
  }

  function scoreExtractionCandidate(candidate, source, signals) {
    const content = normalizeExtractionText(candidate?.data || '');
    if (!content) {
      return {
        source,
        score: Number.NEGATIVE_INFINITY,
        content,
        contentLength: 0,
        reason: 'Empty content',
        candidate,
      };
    }

    const headingCount = countPatternMatches(content, /^#{1,6}\s+/gm);
    const codeFenceCount = countPatternMatches(content, /^```/gm);
    const tableRowCount = countPatternMatches(content, /^\|.*\|$/gm);
    const listCount = countPatternMatches(content, /^\s*(?:[-*+]|\d+\.)\s+/gm);
    const blockquoteCount = countPatternMatches(content, /^\s*>\s+/gm);
    const codeInlineCount = countPatternMatches(content, /`[^`\n]+`/g);
    const lineCount = content.split('\n').length;

    let score = content.length;
    score += headingCount * 180;
    score += codeFenceCount * 260;
    score += tableRowCount * 45;
    score += listCount * 30;
    score += blockquoteCount * 25;
    score += codeInlineCount * 8;
    score += Math.min(lineCount, 200) * 2;

    if (source === 'readability') {
      score += signals.isArticleLike ? 320 : 80;
      score += signals.textLength > 2000 ? 120 : 0;
      score -= signals.isCodeHeavy ? 220 : 0;
      score -= signals.isTableHeavy ? 120 : 0;
      score -= signals.isListHeavy && !signals.isArticleLike ? 60 : 0;
    } else {
      score += signals.isCodeHeavy ? 320 : 0;
      score += signals.isTableHeavy ? 220 : 0;
      score += signals.isListHeavy ? 140 : 0;
      score -= signals.isArticleLike ? 140 : 0;
      score += signals.platform === 'github' ? 120 : 0;
    }

    if (content.length < 120) score -= 500;
    if (content.length < 400) score -= 150;
    if (content.length > 15000) score += 60;

    return {
      source,
      score,
      content,
      contentLength: content.length,
      reason: buildExtractionReason(source, signals),
      candidate,
    };
  }

  function chooseExtractionResult(readabilityResult, fallbackResult, signals) {
    const scored = [];
    if (readabilityResult) scored.push(scoreExtractionCandidate(readabilityResult, 'readability', signals));
    if (fallbackResult) scored.push(scoreExtractionCandidate(fallbackResult, 'fallback', signals));
    scored.sort((a, b) => b.score - a.score || b.contentLength - a.contentLength);
    return scored[0] || null;
  }

  // --- 4c. SCREENSHOT NEED DETECTION ---

  function needsScreenshot() {
    const hasCanvas = document.querySelectorAll('canvas').length > 2;
    const hasVideo = document.querySelectorAll('video').length > 0;
    const hasContentEditable = document.querySelectorAll('[contenteditable]').length > 5;
    const bodyText = document.body?.innerText || '';
    const imageDensity = (bodyText.length > 0) ? (document.images.length / (bodyText.length / 1000)) : 0;
    return hasCanvas || hasVideo || hasContentEditable || imageDensity > 5;
  }

  // --- 5. MAIN ROUTER (TWO-PASS COMPARISON) ---

  async function getUnifiedContent() {
    const url = window.location.href;
    const platformInfo = detectPlatform(url);
    const bodyText = document.body?.innerText || '';
    const pageSignals = collectPageSignals(url, platformInfo, bodyText);
    const readStrategy = determineReadStrategy(pageSignals);
    const requestScreenshot = needsScreenshot();

    let screenshotData = null;
    if (requestScreenshot && typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        const screenshotResp = await chrome.runtime.sendMessage({ action: 'captureScreenshot' });
        if (screenshotResp && screenshotResp.dataUrl) {
          screenshotData = screenshotResp.dataUrl;
        }
      } catch (e) {
        // screenshot capture may fail in some contexts
      }
    }

    // 1. Video sites get special handling
    if (isVideoSite(url)) {
      const videoResult = await extractVideo();
      if (videoResult) {
        return {
          ...videoResult,
          platform: platformInfo?.platform || null,
          platformInfo,
          readStrategy,
          screenshot: screenshotData,
          extractionSource: 'video',
          extractionReason: 'Video pages use transcript or metadata extraction.',
        };
      }
    }

    // 2. Run BOTH extractors for comparison
    const readabilityResult = extractReadability();
    const fallbackResult = extractFallback();
    const chosen = chooseExtractionResult(readabilityResult, fallbackResult, pageSignals);

    // 3. Handle edge cases where one fails
    if (!chosen) {
      return {
        success: false,
        error: 'Extraction failed',
        platform: null,
        platformInfo: null,
        readStrategy,
        screenshot: null,
        extractionSource: null,
      };
    }
    console.log(
      `PromptPaul: Using ${chosen.source} (${chosen.contentLength} chars, score ${chosen.score}) - ${chosen.reason}`
    );
    return {
      ...chosen.candidate,
      platform: platformInfo?.platform || null,
      platformInfo,
      readStrategy,
      screenshot: screenshotData,
      extractionSource: chosen.source,
      extractionReason: chosen.reason,
    };
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
      console.warn('PromptPaul: Failed to capture video frame', e);
      return null;
    }
  }

  // --- 6. MESSAGE LISTENER (CRITICAL FIX) ---

  let _pendingTabContentRequest = false;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureVideoFrames') {
      const video = document.querySelector('video');
      if (!video) {
        sendResponse({ success: false, error: 'No video element found' });
        return;
      }

      // Capture initial frame immediately
      captureVideoFrame()
        .then((frame) => {
          sendResponse({ success: true, frame: frame });
        })
        .catch((e) => {
          sendResponse({ success: false, error: e.toString() });
        });
      return true;
    }

    if (request.action === 'getTabContent' || request.action === 'getLoadContent') {
      if (_pendingTabContentRequest) {
        console.log(`PromptPaul Content Script: Skipping duplicate ${request.action} request.`);
        sendResponse({ success: false, error: 'Content extraction is already running for this tab.' });
        return true;
      }
      _pendingTabContentRequest = true;
      console.log(`PromptPaul Content Script: Received ${request.action} request.`);

      getUnifiedContent()
        .then((result) => {
          _pendingTabContentRequest = false;
          const response = {
            success: !!(result && result.data),
            content: result ? result.data : '',
            data: result ? result.data : '',
            title: result ? result.title : document.title,
            siteName: result ? result.siteName : '',
            byline: result ? result.byline : '',
            excerpt: result ? result.excerpt : '',
            lang: result ? result.lang : '',
            url: window.location.href,
            platform: result ? result.platform || null : null,
            platformInfo: result ? result.platformInfo || null : null,
            readStrategy: result ? result.readStrategy || 'auto' : 'auto',
            screenshot: result ? result.screenshot || null : null,
            extractionSource: result ? result.extractionSource || null : null,
            extractionReason: result ? result.extractionReason || null : null,
            error: result ? null : 'Extraction failed',
          };
          console.log('PromptPaul Content Script: Sending response:', response.success);
          sendResponse(response);
        })
        .catch((e) => {
          _pendingTabContentRequest = false;
          console.error('PromptPaul Content Script: Error in handler:', e);
          sendResponse({ success: false, error: e.toString() });
        });

      return true;
    }
  });

  console.log('PromptPaul: Unified content script (v2) loaded.');
})();
