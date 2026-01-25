// Minimal MCP client over WebSocket transport
// Supports: initialize, tools/list, tools/call with timeouts and basic logging.

import { initializeRequest, listToolsRequest, callToolRequest, negotiateProtocol } from "./protocol.js";
import { WsTransport } from "./transport-websocket.js";

export class McpClient {
  constructor({
    url,
    headers = {},
    clientInfo = { name: "PromptPaul", version: "1.0.0" },
    capabilities = { experimental: {}, elicitation: {} },
    timeouts = { callMs: 20000 },
    backoff = { baseMs: 500, maxMs: 10000, factor: 2, jitter: 0.2 },
    onLog,
  }) {
    this.url = url;
    this.headers = headers;
    this.clientInfo = clientInfo;
    this.capabilities = capabilities;
    this.timeouts = { callMs: timeouts?.callMs ?? 20000 };
    this.transport = new WsTransport({ url, headers, backoff, onLog });
    this.onLog = typeof onLog === "function" ? onLog : () => {};
    this.session = {
      protocolVersion: null,
      capabilities: null,
      initialized: false,
      tools: [],
      createdAt: 0,
      lastUsed: 0,
    };
    this.seq = 0;
  }

  _id() {
    return `mcp-${++this.seq}-${Date.now()}`;
  }

  async ensureConnected() {
    await this.transport.connect();
  }

  async initialize() {
    await this.ensureConnected();
    const id = this._id();
    const req = initializeRequest(id, this.clientInfo, this.capabilities);
    const start = performance.now();
    const resp = await this.transport.sendRequest(req, { timeoutMs: this.timeouts.callMs });
    const latencyMs = Math.round(performance.now() - start);

    if (resp.error) {
      const err = new Error(resp.error?.message || "initialize failed");
      err.code = resp.error?.code;
      err.data = resp.error?.data;
      throw err;
    }
    const result = resp.result || {};
    const negotiation = negotiateProtocol(result.protocolVersion);
    if (!negotiation.compatible) {
      throw new Error(`Incompatible MCP protocol: client=${negotiation.client} server=${negotiation.server}`);
    }

    this.session.protocolVersion = result.protocolVersion || negotiation.server;
    this.session.capabilities = result.capabilities || {};
    this.session.initialized = true;
    this.session.createdAt = Date.now();
    this.session.lastUsed = Date.now();

    this.onLog({
      level: "info",
      type: "client",
      msg: "initialized",
      url: this.url,
      latencyMs,
      protocolVersion: this.session.protocolVersion,
    });

    return { protocolVersion: this.session.protocolVersion, capabilities: this.session.capabilities };
  }

  async listTools() {
    if (!this.session.initialized) await this.initialize();
    const id = this._id();
    const req = listToolsRequest(id);
    const start = performance.now();
    const resp = await this.transport.sendRequest(req, { timeoutMs: this.timeouts.callMs });
    const latencyMs = Math.round(performance.now() - start);

    if (resp.error) {
      const err = new Error(resp.error?.message || "tools/list failed");
      err.code = resp.error?.code;
      err.data = resp.error?.data;
      throw err;
    }
    const tools = Array.isArray(resp.result?.tools) ? resp.result.tools : [];
    this.session.tools = tools;
    this.session.lastUsed = Date.now();

    this.onLog({
      level: "info",
      type: "client",
      msg: "tools/list",
      url: this.url,
      latencyMs,
      count: tools.length,
    });

    return tools;
  }

  async callTool(name, argsObj = {}) {
    if (!this.session.initialized) await this.initialize();
    const id = this._id();
    const req = callToolRequest(id, name, argsObj);
    const start = performance.now();
    const resp = await this.transport.sendRequest(req, { timeoutMs: this.timeouts.callMs });
    const latencyMs = Math.round(performance.now() - start);

    if (resp.error) {
      const err = new Error(resp.error?.message || `tools/call ${name} failed`);
      err.code = resp.error?.code;
      err.data = resp.error?.data;
      throw err;
    }
    this.session.lastUsed = Date.now();

    this.onLog({
      level: "info",
      type: "client",
      msg: "tools/call",
      url: this.url,
      tool: name,
      latencyMs,
    });

    return resp.result;
  }

  getDiscoveredTools() {
    return Array.isArray(this.session.tools) ? this.session.tools : [];
  }

  async close() {
    await this.transport.close();
    this.onLog({ level: "info", type: "client", msg: "closed", url: this.url });
  }
}