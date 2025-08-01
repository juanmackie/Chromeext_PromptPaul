// Registry and data models for MCP servers, configs, and discovery cache

import { McpClient } from "./client.js";
import { redactHeaders } from "./protocol.js";

export class McpRegistry {
  constructor({
    storage = chrome?.storage?.local,
    defaults = {
      timeouts: { callMs: 20000 },
      backoff: { baseMs: 500, maxMs: 10000, factor: 2, jitter: 0.2 },
      policy: { sensitiveRequireConfirm: true },
      clientMeta: { name: "PromptPaul", version: "1.0.0" },
    },
    onLog,
  } = {}) {
    this.storage = storage;
    this.defaults = defaults;
    this.onLog = typeof onLog === "function" ? onLog : () => {};
    this.clients = new Map(); // serverId -> McpClient
    this.state = new Map();   // serverId -> ServerState
  }

  // Data model helpers
  static newServerConfig(partial) {
    const nowId = `srv_${Date.now()}`;
    return {
      id: partial?.id || nowId,
      name: partial?.name || nowId,
      url: partial?.url || "",
      headers: partial?.headers || {},
      enabled: partial?.enabled ?? true,
      allowlisted: partial?.allowlisted ?? false,
      timeouts: partial?.timeouts || { callMs: 20000 },
      backoff: partial?.backoff || { baseMs: 500, maxMs: 10000, factor: 2, jitter: 0.2 },
      policy: partial?.policy || { sensitiveRequireConfirm: true },
      clientMeta: partial?.clientMeta || { name: "PromptPaul", version: "1.0.0" },
    };
  }

  static newServerState(serverId) {
    return {
      serverId,
      status: "idle", // idle | connecting | ready | error
      lastError: undefined,
      capabilities: undefined,
      tools: [],
      lastConnectedAt: undefined,
    };
  }

  async _loadAllConfigs() {
    const key = "mcpServers";
    return new Promise((resolve) => {
      this.storage.get([key], (res) => {
        resolve(res[key] || []);
      });
    });
  }

  async _saveAllConfigs(configs) {
    const key = "mcpServers";
    return new Promise((resolve) => {
      this.storage.set({ [key]: configs }, () => resolve());
    });
  }

  async listServers() {
    const configs = await this._loadAllConfigs();
    return configs;
  }

  async addServer(configPartial) {
    const cfg = McpRegistry.newServerConfig({
      ...this.defaults,
      ...configPartial,
      timeouts: configPartial?.timeouts || this.defaults.timeouts,
      backoff: configPartial?.backoff || this.defaults.backoff,
      policy: configPartial?.policy || this.defaults.policy,
      clientMeta: configPartial?.clientMeta || this.defaults.clientMeta,
    });
    const configs = await this._loadAllConfigs();
    configs.push(cfg);
    await this._saveAllConfigs(configs);
    this.onLog({
      level: "info",
      type: "registry",
      msg: "server added",
      serverId: cfg.id,
      url: cfg.url,
      headers: redactHeaders(cfg.headers),
    });
    return cfg;
  }

  async updateServer(updatedConfig) {
    const configs = await this._loadAllConfigs();
    const idx = configs.findIndex((c) => c.id === updatedConfig.id);
    if (idx === -1) throw new Error(`Server not found: ${updatedConfig.id}`);
    configs[idx] = { ...configs[idx], ...updatedConfig };
    await this._saveAllConfigs(configs);
    this.onLog({
      level: "info",
      type: "registry",
      msg: "server updated",
      serverId: updatedConfig.id,
      url: updatedConfig.url,
      headers: redactHeaders(updatedConfig.headers),
    });
    return configs[idx];
  }

  async removeServer(serverId) {
    const configs = await this._loadAllConfigs();
    const next = configs.filter((c) => c.id !== serverId);
    await this._saveAllConfigs(next);
    await this.disposeClient(serverId);
    this.state.delete(serverId);
    this.onLog({ level: "info", type: "registry", msg: "server removed", serverId });
  }

  // Allowlist enforcement
  _isAllowlisted(cfg) {
    return !!cfg.allowlisted;
  }

  // Lazy client creation
  async getClient(serverId) {
    if (this.clients.has(serverId)) return this.clients.get(serverId);
    const cfg = (await this._loadAllConfigs()).find((c) => c.id === serverId);
    if (!cfg) throw new Error(`Server config not found: ${serverId}`);
    if (!cfg.enabled) throw new Error(`Server disabled: ${serverId}`);
    if (!this._isAllowlisted(cfg)) throw new Error(`Server not allowlisted: ${serverId}`);

    const client = new McpClient({
      url: cfg.url,
      headers: cfg.headers || {},
      clientInfo: cfg.clientMeta,
      capabilities: { experimental: {}, elicitation: {} },
      timeouts: cfg.timeouts,
      backoff: cfg.backoff,
      onLog: (e) => this.onLog({ ...e, serverId }),
    });
    this.clients.set(serverId, client);
    if (!this.state.has(serverId)) this.state.set(serverId, McpRegistry.newServerState(serverId));
    return client;
  }

  async disposeClient(serverId) {
    const existing = this.clients.get(serverId);
    if (existing) {
      try {
        await existing.close();
      } catch (_) {}
      this.clients.delete(serverId);
    }
  }

  // Connectivity test + discovery
  async testConnect(serverId) {
    const st = this.state.get(serverId) || McpRegistry.newServerState(serverId);
    this.state.set(serverId, { ...st, status: "connecting", lastError: undefined });
    try {
      const client = await this.getClient(serverId);
      const initRes = await client.initialize();
      const tools = await client.listTools();
      const updated = {
        ...this.state.get(serverId),
        status: "ready",
        capabilities: initRes,
        tools,
        lastConnectedAt: Date.now(),
      };
      this.state.set(serverId, updated);
      return { ok: true, capabilities: initRes, toolsCount: tools.length };
    } catch (e) {
      const err = String(e?.message || e);
      this.state.set(serverId, { ...st, status: "error", lastError: err });
      return { ok: false, error: err };
    }
  }

  getState(serverId) {
    return this.state.get(serverId) || McpRegistry.newServerState(serverId);
  }

  getDiscoveredTools(serverId) {
    const st = this.getState(serverId);
    return Array.isArray(st.tools) ? st.tools : [];
  }

  // Direct calls
  async listTools(serverId) {
    const client = await this.getClient(serverId);
    const tools = await client.listTools();
    const st = this.getState(serverId);
    this.state.set(serverId, { ...st, tools, status: "ready" });
    return tools;
  }

  async callTool(serverId, name, args) {
    const client = await this.getClient(serverId);
    return await client.callTool(name, args);
  }
}