/**
 * @fileoverview Chat Stream Module - Handles streaming state management
 *
 * Responsibilities:
 * - Streaming UI state management
 * - API call state tracking
 * - Conversation history management (in-memory, per side-panel instance)
 *
 * @module ChatStream
 */

import { renderMarkdown } from '../utils/domSanitizer.js';
import { randomId } from '../utils/ids.js';
import {
  createStreamingMarkdownState,
  renderStreamingMarkdownDelta,
} from '../utils/streamMarkdown.js';

/**
 * Stream state manager - tracks streaming and API call state.
 * Each side panel instance owns its own in-memory state; the window-scoped
 * panel normally survives tab switches, while the bounded run journal restores
 * state if the panel page is closed or reloaded.
 */
const MAX_HISTORY_MESSAGES = 150; // ponytail: bounded cap; upgrade if long-context chats become common

export class StreamStateManager {
  constructor() {
    // Streaming UI state
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.accumulatedStreamedText = '';
    this.activeStreamingToolCall = null;

    // Coalesce token deltas and render Markdown at a bounded cadence.
    this._renderBuffer = '';
    this._renderQueued = false;
    this._lastRenderAt = 0;
    this._renderTimer = null;
    this._markdownState = createStreamingMarkdownState();
    this._chatAreaRef = null;

    // Reasoning ("thinking") stream: rendered into a separate panel above the answer
    this.currentReasoningContentElement = null;
    this._reasoningFinalized = false;
    this.accumulatedReasoningText = '';
    this._reasoningBuffer = '';
    this._reasoningTimer = null;
    this._reasoningQueued = false;
    this._lastReasoningRenderAt = 0;
    this._reasoningMarkdownState = createStreamingMarkdownState();
    this._reasoningStartTime = null;

    // API call state
    this.currentRunId = null;
    this.currentSourceTabId = null;
    this.currentMediaData = null;

    // Orchestrator events carry a monotonic per-run sequence. Buffering them
    // here keeps tool traces and terminal events in event order when runtime
    // message delivery completes out of order.
    this.nextOrchestratorEventSequence = 1;
    this.pendingOrchestratorEvents = new Map();

    this.conversationHistory = [];
    this.conversationId = randomId();
  }

  /**
   * Set a reference to the chat area element for scroll handling.
   * @param {HTMLElement} element
   */
  setChatAreaRef(element) {
    this._chatAreaRef = element;
  }

  /**
   * Whether the chat area is scrolled to (or very near) the bottom. Used to
   * decide if streaming updates should keep the view pinned to the latest
   * tokens. When the user has scrolled up to read earlier output, this returns
   * false so their scroll position is left alone.
   * @returns {boolean}
   */
  _isNearBottom() {
    const el = this._chatAreaRef;
    if (!el) return false;
    // Tolerance covers sub-pixel rounding and the padding-bottom on #chat-area.
    const threshold = 40;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  _scrollToBottom() {
    if (!this._chatAreaRef) return;
    // Streaming layout changes are frequent; smooth scrolling can leave the
    // viewport behind the next delta and make a reader-at-bottom look detached.
    const top = this._chatAreaRef.scrollHeight;
    if (typeof this._chatAreaRef.scrollTo === 'function') {
      this._chatAreaRef.scrollTo({ top, behavior: 'instant' });
    } else {
      this._chatAreaRef.scrollTop = top;
    }
  }

  /**
   * Queue a content delta for batched rendering via requestAnimationFrame.
   * Multiple deltas within a 16ms frame are coalesced into a single DOM write.
   * @param {string} delta
   */
  queueRenderChunk(delta) {
    this._renderBuffer += delta;
    if (this._renderQueued) return;
    this._renderQueued = true;
    const delay = Math.max(0, 100 - (Date.now() - this._lastRenderAt));
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      requestAnimationFrame(() => this._flushRender());
    }, delay);
  }

  _renderMarkdownDelta(el, delta, state, accumulatedText) {
    renderStreamingMarkdownDelta({
      element: el,
      delta,
      state,
      accumulatedText,
      renderMarkdown,
      documentRef: typeof document === 'undefined' ? null : document,
      DOMParserCtor: typeof DOMParser === 'undefined' ? null : DOMParser,
      hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    });
  }

  _flushRender() {
    this._renderQueued = false;
    const el = this.currentStreamingContentElement;
    if (!el || !this._renderBuffer) return;
    const delta = this._renderBuffer;
    this._renderBuffer = '';
    this.accumulatedStreamedText += delta;
    const stick = this._isNearBottom();
    this._renderMarkdownDelta(el, delta, this._markdownState, this.accumulatedStreamedText);
    this._lastRenderAt = Date.now();
    if (stick) this._scrollToBottom();
  }

  /**
   * Queue a reasoning delta for batched rendering into the thinking panel.
   * @param {string} delta
   */
  queueRenderReasoning(delta) {
    this._reasoningFinalized = false;
    this._reasoningBuffer += delta;
    if (this._reasoningQueued) return;
    this._reasoningQueued = true;
    const delay = Math.max(0, 100 - (Date.now() - this._lastReasoningRenderAt));
    this._reasoningTimer = setTimeout(() => {
      this._reasoningTimer = null;
      requestAnimationFrame(() => this._flushReasoningRender());
    }, delay);
  }

  flushPendingReasoning() {
    clearTimeout(this._reasoningTimer);
    this._reasoningTimer = null;
    this._reasoningQueued = false;
    this._flushReasoningRender();
  }

  finalizeReasoning() {
    this.flushPendingReasoning();
    const element = this.currentReasoningContentElement;
    if (!element || this._reasoningFinalized) return;
    const stick = this._isNearBottom();
    element.innerHTML = renderMarkdown(this.accumulatedReasoningText);
    this._reasoningMarkdownState = createStreamingMarkdownState();
    // Rebuild parser state from full text if reasoning resumes after finalization.
    this._reasoningMarkdownState.needsFullRender = true;
    this._reasoningFinalized = true;
    if (stick) this._scrollToBottom();
  }

  _flushReasoningRender() {
    this._reasoningQueued = false;
    const el = this.currentReasoningContentElement;
    if (!el || !this._reasoningBuffer) return;

    const delta = this._reasoningBuffer;
    this._reasoningBuffer = '';
    this.accumulatedReasoningText += delta;
    const stick = this._isNearBottom();
    this._renderMarkdownDelta(
      el,
      delta,
      this._reasoningMarkdownState,
      this.accumulatedReasoningText
    );
    this._lastReasoningRenderAt = Date.now();
    if (stick) this._scrollToBottom();
  }

  /**
   * Set the element that reasoning tokens render into.
   * @param {HTMLElement|null} element
   */
  setReasoningContentElement(element) {
    if (element !== this.currentReasoningContentElement) this._reasoningFinalized = false;
    this.currentReasoningContentElement = element;
  }

  /** @returns {HTMLElement|null} */
  getReasoningContentElement() {
    return this.currentReasoningContentElement;
  }

  /**
   * Record (once) the moment reasoning began, used to compute elapsed time.
   */
  markReasoningStart() {
    if (this._reasoningStartTime == null) {
      this._reasoningStartTime = Date.now();
    }
  }

  /**
   * Elapsed reasoning time in ms, or null if reasoning never started.
   * @returns {number|null}
   */
  getReasoningElapsedMs() {
    return this._reasoningStartTime == null ? null : Date.now() - this._reasoningStartTime;
  }

  /**
   * Reset all streaming state
   */
  resetStreamingState() {
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.accumulatedStreamedText = '';
    this.activeStreamingToolCall = null;
    this._renderBuffer = '';
    clearTimeout(this._renderTimer);
    this._renderTimer = null;
    this._renderQueued = false;
    this._lastRenderAt = 0;
    this._markdownState = createStreamingMarkdownState();
    this.currentReasoningContentElement = null;
    this._reasoningFinalized = false;
    this.accumulatedReasoningText = '';
    this._reasoningBuffer = '';
    clearTimeout(this._reasoningTimer);
    this._reasoningTimer = null;
    this._reasoningQueued = false;
    this._lastReasoningRenderAt = 0;
    this._reasoningMarkdownState = createStreamingMarkdownState();
    this._reasoningStartTime = null;
    this.resetOrchestratorEventOrdering();
  }

  /**
   * Reset all API call state
   */
  resetApiState() {
    this.currentRunId = null;
    this.currentSourceTabId = null;
    this.currentMediaData = null;
  }

  /**
   * Reset all state.
   */
  resetAll() {
    this.resetStreamingState();
    this.resetApiState();
    this.conversationHistory = [];
    this.conversationId = randomId();
  }

  /**
   * Set current streaming message elements
   * @param {HTMLElement} messageDiv - Message container element
   * @param {HTMLElement} contentElement - Content element
   * @param {string} uniqueId - Unique message ID
   */
  setStreamingElements(messageDiv, contentElement, uniqueId) {
    this.currentStreamingMessageDiv = messageDiv;
    this.currentStreamingContentElement = contentElement;
    this.currentStreamingUniqueId = uniqueId;
  }

  /**
   * Create streaming elements and set them in one call.
   * @param {HTMLElement} messageDiv
   * @param {HTMLElement} contentElement
   * @param {string} uniqueId
   */
  initStreamingElements(messageDiv, contentElement, uniqueId) {
    this.setStreamingElements(messageDiv, contentElement, uniqueId);
    this.resetOrchestratorEventOrdering();
    this.clearStreamedText();
    this.appendStreamedText('');
  }

  clearStreamingElements() {
    this.setStreamingElements(null, null, null);
    this.currentReasoningContentElement = null;
    this._reasoningFinalized = false;
    this.accumulatedReasoningText = '';
    this._reasoningBuffer = '';
    clearTimeout(this._reasoningTimer);
    this._reasoningTimer = null;
    this._reasoningQueued = false;
    this._lastReasoningRenderAt = 0;
    this._reasoningMarkdownState = createStreamingMarkdownState();
    this._reasoningStartTime = null;
  }

  /**
   * Reset the per-run orchestrator event ordering buffer.
   */
  resetOrchestratorEventOrdering() {
    this.nextOrchestratorEventSequence = 1;
    this.pendingOrchestratorEvents.clear();
  }

  /**
   * Start event ordering after a bounded journal replay during reconnect.
   * @param {number} sequence - Last sequence already represented by the journal.
   */
  setNextOrchestratorEventSequence(sequence) {
    const next = Number(sequence) + 1;
    if (Number.isInteger(next) && next > 0) {
      this.nextOrchestratorEventSequence = next;
      this.pendingOrchestratorEvents.clear();
    }
  }

  /**
   * Return newly contiguous orchestrator events in sequence order.
   * Events without sequence metadata remain compatible with older senders.
   * A terminal event flushes any remaining buffered events so the UI cannot
   * stay locked when a non-terminal event was lost during panel startup.
   * @param {Object} event - Orchestrator event.
   * @returns {Array<Object>} Events ready for rendering.
   */
  queueOrchestratorEvent(event) {
    const expand = (ordered) =>
      ordered.flatMap((entry) =>
        entry?.type === 'stream_batch' && Array.isArray(entry.events)
          ? entry.events
              .filter((segment) => ['content', 'reasoning'].includes(segment?.type))
              .map((segment) => ({
                type: segment.type,
                data: String(segment.data || ''),
                sequence: entry.sequence,
                timestamp: entry.timestamp,
              }))
          : [entry]
      );
    const sequence = Number(event?.sequence);
    if (!Number.isInteger(sequence) || sequence <= 0) return expand([event]);
    if (
      sequence < this.nextOrchestratorEventSequence ||
      this.pendingOrchestratorEvents.has(sequence)
    ) {
      return [];
    }

    this.pendingOrchestratorEvents.set(sequence, event);
    const ordered = [];
    while (this.pendingOrchestratorEvents.has(this.nextOrchestratorEventSequence)) {
      ordered.push(this.pendingOrchestratorEvents.get(this.nextOrchestratorEventSequence));
      this.pendingOrchestratorEvents.delete(this.nextOrchestratorEventSequence);
      this.nextOrchestratorEventSequence += 1;
    }

    if (ordered.length === 0 && ['complete', 'error', 'aborted'].includes(event.type)) {
      const remaining = Array.from(this.pendingOrchestratorEvents.entries()).sort(
        ([left], [right]) => left - right
      );
      this.pendingOrchestratorEvents.clear();
      for (const [remainingSequence, remainingEvent] of remaining) {
        if (remainingSequence < this.nextOrchestratorEventSequence) continue;
        ordered.push(remainingEvent);
        this.nextOrchestratorEventSequence = remainingSequence + 1;
      }
    }

    return expand(ordered);
  }

  /**
   * Get current streaming message div
   * @returns {HTMLElement|null}
   */
  getCurrentStreamingMessageDiv() {
    return this.currentStreamingMessageDiv;
  }

  /**
   * Get current streaming content element
   * @returns {HTMLElement|null}
   */
  getCurrentStreamingContentElement() {
    return this.currentStreamingContentElement;
  }

  /**
   * Get current streaming unique ID
   * @returns {string|null}
   */
  getCurrentStreamingUniqueId() {
    return this.currentStreamingUniqueId;
  }

  /**
   * Append text to accumulated stream
   * @param {string} text - Text to append
   */
  appendStreamedText(text) {
    this.accumulatedStreamedText += text;
  }

  /**
   * Get accumulated streamed text
   * @returns {string} - Accumulated text
   */
  getStreamedText() {
    return this.accumulatedStreamedText + this._renderBuffer;
  }

  /**
   * Clear accumulated streamed text and reset the render buffer.
   * Call before a continuation turn to prevent stale turn-1 text from surviving.
   */
  clearStreamedText() {
    this.accumulatedStreamedText = '';
    this._renderBuffer = '';
    clearTimeout(this._renderTimer);
    this._renderTimer = null;
    this._renderQueued = false;
    this._lastRenderAt = 0;
    this._markdownState = createStreamingMarkdownState();
  }

  /**
   * Start a new turn within the same streaming bubble: reset accumulated text,
   * render buffer, reasoning state, and tool-call state, but keep the DOM
   * element references so the bubble stays alive for the continuation answer.
   * Call from tool_start to wipe stale turn-1 text before the model's final answer.
   */
  startNewTurn() {
    this.finalizeReasoning();
    this.clearStreamedText();
    this.activeStreamingToolCall = null;
    this.currentReasoningContentElement = null;
    this._reasoningFinalized = false;
    this.accumulatedReasoningText = '';
    this._reasoningBuffer = '';
    clearTimeout(this._reasoningTimer);
    this._reasoningTimer = null;
    this._reasoningQueued = false;
    this._lastReasoningRenderAt = 0;
    this._reasoningMarkdownState = createStreamingMarkdownState();
    this._reasoningStartTime = null;
  }

  /**
   * Set active streaming tool call
   * @param {Object} toolCall - Tool call object
   */
  setActiveToolCall(toolCall) {
    this.activeStreamingToolCall = toolCall;
  }

  /**
   * Get active streaming tool call
   * @returns {Object|null} - Active tool call or null
   */
  getActiveToolCall() {
    return this.activeStreamingToolCall;
  }

  /**
   * Clear active tool call
   */
  clearActiveToolCall() {
    this.activeStreamingToolCall = null;
  }

  /**
   * Set current run ID
   * @param {string} runId - Run ID
   */
  setRunId(runId) {
    this.currentRunId = runId;
  }

  /**
   * Get current run ID
   * @returns {string|null} - Current run ID
   */
  getRunId() {
    return this.currentRunId;
  }

  /**
   * Set current source tab ID
   * @param {number} tabId - Tab ID
   */
  setSourceTabId(tabId) {
    this.currentSourceTabId = tabId;
  }

  /**
   * Get current source tab ID
   * @returns {number|null} - Current source tab ID
   */
  getSourceTabId() {
    return this.currentSourceTabId;
  }

  /**
   * Set current media data.
   * @param {Object} mediaData - Media data object
   */
  setMediaData(mediaData) {
    this.currentMediaData = mediaData;
  }

  /**
   * Get current media data
   * @returns {Object|null} - Current media data
   */
  getMediaData() {
    return this.currentMediaData;
  }

  /**
   * Clear current media data.
   */
  clearMediaData() {
    this.currentMediaData = null;
  }

  /**
   * Add message to conversation history.
   * @param {Object} message - Message object { role, content }
   */
  addMessageToHistory(message) {
    this.conversationHistory.push(message);
    if (this.conversationHistory.length > MAX_HISTORY_MESSAGES) {
      this.conversationHistory.splice(0, this.conversationHistory.length - MAX_HISTORY_MESSAGES);
    }
  }

  /**
   * Get conversation history
   * @returns {Array} - Conversation history
   */
  getConversationHistory() {
    return this.conversationHistory;
  }

  /**
   * Clear conversation history.
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Start a new local conversation and return its opaque identity.
   * @returns {string}
   */
  startNewConversation() {
    this.conversationHistory = [];
    this.conversationId = randomId();
    return this.conversationId;
  }

  /**
   * Return the identity shared by provider switches within this chat.
   * @returns {string}
   */
  getConversationId() {
    return this.conversationId;
  }

  /**
   * Set conversation history.
   * @param {Array} history - Conversation history
   */
  setConversationHistory(history) {
    this.conversationHistory = history;
  }
}
