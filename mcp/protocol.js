// Minimal MCP protocol helpers for JSON-RPC 2.0 over WebSocket/SSE/HTTP
// This file defines message builders, validation stubs, and version negotiation.

export const MCP_PROTOCOL_VERSION = "0.1.0";

export const JsonRpc = {
  version: "2.0",
};

export function initializeRequest(id, clientInfo, capabilities) {
  return {
    jsonrpc: JsonRpc.version,
    id,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo,
      capabilities,
    },
  };
}

export function listToolsRequest(id) {
  return {
    jsonrpc: JsonRpc.version,
    id,
    method: "tools/list",
    params: {},
  };
}

export function callToolRequest(id, name, argsObj) {
  if (typeof argsObj !== "object" || argsObj === null) {
    throw new Error("callToolRequest() argsObj must be an object");
  }
  return {
    jsonrpc: JsonRpc.version,
    id,
    method: "tools/call",
    params: {
      name,
      arguments: argsObj,
    },
  };
}

export function isJsonRpcResponse(obj) {
  return !!obj && obj.jsonrpc === JsonRpc.version && ("result" in obj || "error" in obj);
}

export function negotiateProtocol(serverProtocolVersion) {
  // Simple negotiation: warn on mismatch, but allow continue
  return {
    client: MCP_PROTOCOL_VERSION,
    server: serverProtocolVersion || "unknown",
    compatible: true,
    note:
      serverProtocolVersion && serverProtocolVersion !== MCP_PROTOCOL_VERSION
        ? `Protocol mismatch client=${MCP_PROTOCOL_VERSION} server=${serverProtocolVersion}`
        : "OK",
  };
}

export function redactHeaders(headers) {
  if (!headers) return headers;
  const redacted = { ...headers };
  for (const key of Object.keys(redacted)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower.endsWith("token") || lower.includes("secret")) {
      redacted[key] = "******";
    }
  }
  return redacted;
}

export function parseSseTextById(sseText, targetId) {
  // Parses a text/event-stream payload and returns the JSON-RPC object that matches targetId
  // Accumulates multi-line data: blocks separated by blank lines.
  const lines = String(sseText || "").split("\n");
  let acc = "";
  for (const line of lines) {
    if (line.startsWith("data:")) {
      acc += line.substring(5).trim();
    } else if (line.trim() === "" && acc) {
      try {
        const parsed = JSON.parse(acc);
        if (parsed && parsed.id === targetId) return parsed;
      } catch (_) {
        // ignore parse error, continue
      }
      acc = "";
    }
  }
  // tail
  if (acc) {
    try {
      const parsed = JSON.parse(acc);
      if (parsed && parsed.id === targetId) return parsed;
    } catch (_) {
      // ignore
    }
  }
  return null;
}