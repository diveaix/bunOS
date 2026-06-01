import { callMcpTool, mcpTools } from "./mcp.js";
import { applyMcpApiKeyContext, assertMcpToolResultSafe } from "./mcpApiKeys.js";
import { redactSensitive } from "./redaction.js";
import { isMcpToolAllowed } from "./securityPolicy.js";

export async function handleMcpJsonRpc(body, context = {}) {
  const id = body.id ?? null;

  if (body.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: {
          name: "bunOS Social Agent",
          version: "0.1.0"
        },
        capabilities: {
          tools: {}
        }
      }
    };
  }

  if (body.method === "notifications/initialized") {
    return null;
  }

  if (body.method === "ping") {
    return {
      jsonrpc: "2.0",
      id,
      result: {}
    };
  }

  if (body.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: mcpTools.filter((tool) => isMcpToolAllowed(tool.name, context))
      }
    };
  }

  if (body.method === "tools/call") {
    const { name, arguments: args = {} } = body.params || {};
    const result = assertMcpToolResultSafe(
      name,
      await callMcpTool(name, applyMcpApiKeyContext(name, args, context)),
      context
    );

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(redactSensitive(result), null, 2)
          }
        ],
        isError: false
      }
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Unsupported MCP method: ${body.method}`
    }
  };
}

export function toMcpError({ id = null, error }) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error?.message || "MCP tool call failed"
    }
  };
}
