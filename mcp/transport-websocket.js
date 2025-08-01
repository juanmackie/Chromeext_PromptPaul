// WebSocket transport with exponential backoff, timeouts, and redacted logging
// This module provides a simple JSON-RPC message transport over WSS for MCP.

import { redactHeaders } from "./protocol.js";

export class WsTransport {
  constructor({ url, headers = {}, backoff, onLog }) {
    this.url = url;
    this.headers = headers;
    this.onLog = typeof onLog === "function" ? onLog : () => {};
    // Backoff defaults
    this.backoff = {
      baseMs: backoff?.baseMs ?? 500,
      maxMs: backoff?.maxMs ?? 10000,
      factor: backoff?.factor ?? 2,
      jitter: backoff?.jitter ?? 0.2,
    };
    this.ws = null;
    this.isClosing = false;
    this.connectPromise = null;
    this.pending = new Map(); // id -> {resolve,reject,timeoutId}
    this.seq = 0;
    this.pingInterval = null;
  }

  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.connectPromise) return this.connectPromise;

    this.isClosing = false;
    this.connectPromise = this._connectWithBackoff();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async _connectWithBackoff() {
    let attempt = 0;
    const start = Date.now();
    while (!this.isClosing) {
      attempt += 1;
      try {
        await this._openOnce();
        this.onLog({
          level: "info",
          type: "transport",
          msg: "WebSocket connected",
          url: this.url,
          sinceMs: Date.now() - start,
          headers: redactHeaders(this.headers),
        });
        return;
      } catch (err) {
        const delay = this._computeDelay(attempt);
        this.onLog({
          level: "warn",
          type: "transport",
          msg: "WebSocket connect failed; backing off",
          url: this.url,
          attempt,
          delayMs: delay,
          error: String(err?.message || err),
        });
        await this._sleep(delay);
      }
    }
  }

  _computeDelay(attempt) {
    const { baseMs, factor, maxMs, jitter } = this.backoff;
    const exp = Math.min(maxMs, baseMs * Math.pow(factor, attempt - 1));
    const j = exp * jitter;
    const delta = (Math.random() * 2 - 1) * j;
    return Math.max(0, Math.floor(exp + delta));
  }

  _sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  _openOnce() {
    return new Promise((resolve, reject) => {
      try {
        // Chrome extensions support WebSocket in service worker with standard constructor.
        // Custom headers are not directly supported by WebSocket; servers should use token in URL or subprotocols.
        // As a compromise, allow token via query param if provided in headers.Authorization.
        const url = this._buildUrlWithAuth(this.url, this.headers);
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
          this._startPing();
          resolve();
        };
        ws.onmessage = (ev) => this._onMessage(ev);
        ws.onerror = (ev) => {
          this.onLog({
            level: "error",
            type: "transport",
            msg: "WebSocket error",
            url: this.url,
          });
        };
        ws.onclose = (ev) => {
          this._stopPing();
          this.onLog({
            level: "warn",
            type: "transport",
            msg: "WebSocket closed",
            url: this.url,
            code: ev.code,
            reason: ev.reason,
            wasClean: ev.wasClean,
          });
          // Reject all pending
          for (const [id, entry] of this.pending) {
            clearTimeout(entry.timeoutId);
            entry.reject(new Error("Connection closed"));
          }
          this.pending.clear();
          if (!this.isClosing) {
            // schedule reconnect
            this._connectWithBackoff().catch(() => {});
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        // Ping as JSON-RPC notification, servers can ignore.
        const pingMsg = { jsonrpc: "2.0", method: "ping", params: { ts: Date.now() } };
        this.ws.send(JSON.stringify(pingMsg));
      } catch (_) {}
    }, 30000);
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  _buildUrlWithAuth(baseUrl, headers) {
    try {
      const u = new URL(baseUrl);
      // If bearer token exists, add as query param mcp_token for demo compatibility.
      const auth = headers?.Authorization || headers?.authorization;
      if (auth && auth.toLowerCase().startsWith("bearer ")) {
        const token = auth.slice(7);
        u.searchParams.set("mcp_token", token);
      }
      return u.toString();
    } catch {
      return baseUrl;
    }
  }

  async sendRequest(payload, { timeoutMs = 20000 } = {}) {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }
    const id = payload?.id ?? String(++this.seq);
    const toSend = { ...payload, id };
    const wire = JSON.stringify(toSend);

    this.onLog({
      level: "info",
      type: "send",
      url: this.url,
      payload: this._redactPayloadForLog(toSend),
    });

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeoutId });
      try {
        this.ws.send(wire);
      } catch (e) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  _onMessage(ev) {
    let data = ev.data;
    try {
      if (typeof data === "string") {
        const parsed = JSON.parse(data);
        this.onLog({
          level: "info",
          type: "recv",
          url: this.url,
          payload: this._redactPayloadForLog(parsed),
        });

        const id = parsed?.id;
        if (id != null && this.pending.has(id)) {
          const entry = this.pending.get(id);
          clearTimeout(entry.timeoutId);
          this.pending.delete(id);
          if ("error" in parsed) {
            const err = new Error(parsed.error?.message || "RPC error");
            err.code = parsed.error?.code;
            err.data = parsed.error?.data;
            entry.reject(err);
          } else {
            entry.resolve(parsed);
          }
        }
      } else {
        // Binary or other types are ignored for now
        this.onLog({
          level: "warn",
          type: "recv",
          url: this.url,
          note: "Non-text frame ignored",
        });
      }
    } catch (e) {
      this.onLog({
        level: "error",
        type: "transport",
        msg: "Failed to parse incoming message",
        error: String(e?.message || e),
      });
    }
  }

  _redactPayloadForLog(obj) {
    try {
      const s = JSON.stringify(obj);
      // No secrets are expected inside tool arguments by default; keep as-is.
      return JSON.parse(s);
    } catch {
      return obj;
    }
  }

  async close() {
    this.isClosing = true;
    if (this.ws) {
      try {
        this.ws.close(1000, "client close");
      } catch (_) {}
    }
    this._stopPing();
  }
}