// virtualScroll.js - Virtual scrolling for chat history performance
export class VirtualScroller {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            itemHeight: options.itemHeight || 50,
            buffer: options.buffer || 5,
            renderItem: options.renderItem || this.defaultRenderItem,
            onScrollEnd: options.onScrollEnd || (() => {}),
            ...options
        };

        this.items = [];
        this.scrollTop = 0;
        this.containerHeight = 0;
        this.visibleItems = [];
        this.firstVisibleIndex = 0;
        this.lastVisibleIndex = 0;

        this.init();
    }

    init() {
        this.container.style.position = 'relative';
        this.container.style.overflowY = 'auto';
        this.container.style.overflowX = 'hidden';

        this.contentWrapper = document.createElement('div');
        this.contentWrapper.style.position = 'relative';
        this.contentWrapper.style.width = '100%';

        this.container.appendChild(this.contentWrapper);

        this.container.addEventListener('scroll', this.onScroll.bind(this));
        this.updateContainerHeight();

        // Observe container size changes
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                this.updateContainerHeight();
                this.render();
            });
            resizeObserver.observe(this.container);
        }
    }

    setItems(items) {
        this.items = items;
        this.updateTotalHeight();
        this.render();
    }

    addItem(item) {
        this.items.push(item);
        this.updateTotalHeight();
        this.render();
    }

    addItems(newItems) {
        this.items.push(...newItems);
        this.updateTotalHeight();
        this.render();
    }

    updateTotalHeight() {
        const totalHeight = this.items.length * this.options.itemHeight;
        this.contentWrapper.style.height = `${totalHeight}px`;
    }

    updateContainerHeight() {
        this.containerHeight = this.container.clientHeight;
        this.visibleItemCount = Math.ceil(this.containerHeight / this.options.itemHeight) + this.options.buffer * 2;
    }

    onScroll() {
        this.scrollTop = this.container.scrollTop;
        this.render();

        // Check if scrolled near bottom for pagination
        const scrollBottom = this.scrollTop + this.containerHeight;
        const totalHeight = this.items.length * this.options.itemHeight;

        if (scrollBottom >= totalHeight - this.options.itemHeight * 3) {
            this.options.onScrollEnd();
        }
    }

    render() {
        const startIndex = Math.max(0, Math.floor(this.scrollTop / this.options.itemHeight) - this.options.buffer);
        const endIndex = Math.min(
            this.items.length - 1,
            startIndex + this.visibleItemCount
        );

        if (startIndex === this.firstVisibleIndex && endIndex === this.lastVisibleIndex) {
            return; // No change needed
        }

        this.firstVisibleIndex = startIndex;
        this.lastVisibleIndex = endIndex;

        // Clear current content
        this.contentWrapper.innerHTML = '';

        // Render visible items
        for (let i = startIndex; i <= endIndex; i++) {
            const item = this.items[i];
            const itemElement = this.options.renderItem(item, i);

            if (itemElement) {
                itemElement.style.position = 'absolute';
                itemElement.style.top = `${i * this.options.itemHeight}px`;
                itemElement.style.width = '100%';
                itemElement.style.height = `${this.options.itemHeight}px`;
                itemElement.dataset.index = i;

                this.contentWrapper.appendChild(itemElement);
            }
        }
    }

    defaultRenderItem(item, index) {
        const div = document.createElement('div');
        div.className = 'virtual-item';
        div.textContent = `Item ${index}: ${JSON.stringify(item)}`;
        return div;
    }

    scrollToIndex(index) {
        const scrollTop = index * this.options.itemHeight;
        this.container.scrollTop = scrollTop;
    }

    scrollToBottom() {
        const scrollTop = (this.items.length * this.options.itemHeight) - this.containerHeight;
        this.container.scrollTop = Math.max(0, scrollTop);
    }

    getVisibleRange() {
        return {
            start: this.firstVisibleIndex,
            end: this.lastVisibleIndex,
            count: this.lastVisibleIndex - this.firstVisibleIndex + 1
        };
    }

    clear() {
        this.items = [];
        this.contentWrapper.innerHTML = '';
        this.updateTotalHeight();
    }

    destroy() {
        if (this.container) {
            this.container.removeEventListener('scroll', this.onScroll);
            this.container.innerHTML = '';
        }
    }
}

// Performance optimized message pagination
export class MessagePaginator {
    constructor(options = {}) {
        this.options = {
            pageSize: options.pageSize || 50,
            maxPagesInMemory: options.maxPagesInMemory || 5,
            onLoadPage: options.onLoadPage || (() => {}),
            ...options
        };

        this.pages = new Map();
        this.currentPage = 0;
        this.totalPages = 0;
        this.totalItems = 0;
        this.loadedPages = new Set();
    }

    async loadPage(pageNumber) {
        if (this.loadedPages.has(pageNumber)) {
            return this.pages.get(pageNumber);
        }

        try {
            const pageData = await this.options.onLoadPage(pageNumber, this.options.pageSize);
            this.pages.set(pageNumber, pageData);
            this.loadedPages.add(pageNumber);

            // Clean up old pages if we have too many in memory
            if (this.loadedPages.size > this.options.maxPagesInMemory) {
                const oldestPage = Math.min(...this.loadedPages);
                this.pages.delete(oldestPage);
                this.loadedPages.delete(oldestPage);
            }

            return pageData;
        } catch (error) {
            console.error(`Failed to load page ${pageNumber}:`, error);
            throw error;
        }
    }

    async getItems(startIndex, count) {
        const startPage = Math.floor(startIndex / this.options.pageSize);
        const endPage = Math.floor((startIndex + count - 1) / this.options.pageSize);

        const allItems = [];

        for (let page = startPage; page <= endPage; page++) {
            const pageData = await this.loadPage(page);
            const pageStartIndex = page * this.options.pageSize;
            const pageEndIndex = Math.min((page + 1) * this.options.pageSize, pageData.items.length);

            const startInPage = Math.max(0, startIndex - pageStartIndex);
            const endInPage = Math.min(pageEndIndex - pageStartIndex, startInPage + count);

            allItems.push(...pageData.items.slice(startInPage, endInPage));
        }

        return allItems;
    }

    setTotalItems(total) {
        this.totalItems = total;
        this.totalPages = Math.ceil(total / this.options.pageSize);
    }

    clear() {
        this.pages.clear();
        this.loadedPages.clear();
        this.currentPage = 0;
    }
}

// Optimized content extraction with caching
export class ContentExtractor {
    constructor() {
        this.cache = new Map();
        this.maxCacheSize = 100;

        // Pre-compile regex patterns for better performance
        this.patterns = {
            url: /(https?:\/\/[^\s]+)/gi,
            email: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi,
            codeBlock: /```[\s\S]*?```/g,
            inlineCode: /`[^`]+`/g,
            mention: /@(\w+)/g,
            hashtag: /#(\w+)/g
        };
    }

    extract(content, types = ['url', 'email', 'codeBlock', 'inlineCode']) {
        const cacheKey = `${content.substring(0, 100)}:${types.join(',')}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const result = {};

        types.forEach(type => {
            if (this.patterns[type]) {
                const matches = content.match(this.patterns[type]);
                result[type] = matches || [];
            }
        });

        // Cache the result
        this.setCache(cacheKey, result);

        return result;
    }

    extractWithContext(content, pattern, contextLength = 50) {
        const matches = [];
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const start = Math.max(0, match.index - contextLength);
            const end = Math.min(content.length, match.index + match[0].length + contextLength);

            matches.push({
                match: match[0],
                context: content.substring(start, end),
                index: match.index,
                groups: match.groups || {}
            });
        }

        return matches;
    }

    setCache(key, value) {
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    clearCache() {
        this.cache.clear();
    }

    // Batch processing for multiple content pieces
    extractBatch(contents, types = ['url', 'email']) {
        return contents.map(content => this.extract(content, types));
    }

    // Memory usage optimization
    getCacheStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            memoryUsage: JSON.stringify([...this.cache.entries()]).length
        };
    }
}