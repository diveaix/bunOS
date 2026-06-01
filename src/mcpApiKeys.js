import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { users } from "./fixtures.js";
import {
  assertMcpToolAuthorized,
  recordSecurityEvent,
  securityTrace
} from "./securityPolicy.js";
import {
  assertNoBackendSignerSpend,
  enforceMcpRateLimit
} from "./securityGuards.js";

const KEY_PREFIX = "bunos_mcp_";

export function listMcpApiKeys(handle) {
  const user = getUser(handle);
  return (user.mcpApiKeys || [])
    .filter((key) => !key.revokedAt)
    .map(redactKey);
}

export function createMcpApiKey({ handle, name = "MCP key", scopes = ["mcp:tools"] }) {
  const user = getUser(handle);
  const secret = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = new Date().toISOString();
  const key = {
    id: `mcpkey_${randomBytes(8).toString("hex")}`,
    name: String(name || "MCP key").trim().slice(0, 80),
    scopes: normalizeScopes(scopes),
    prefix: secret.slice(0, 18),
    last4: secret.slice(-4),
    secretHash: hashSecret(secret),
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null
  };

  user.mcpApiKeys ||= [];
  user.mcpApiKeys.push(key);
  recordSecurityEvent("mcp_api_key_created", {
    handle: user.handle,
    keyId: key.id,
    scopes: key.scopes,
    prefix: key.prefix
  });

  return {
    ok: true,
    apiKey: redactKey(key),
    secret,
    handle: user.handle
  };
}

export function revokeMcpApiKey({ handle, keyId }) {
  const user = getUser(handle);
  const key = (user.mcpApiKeys || []).find((item) => item.id === keyId);
  if (!key || key.revokedAt) {
    return { ok: false, error: "API key not found" };
  }

  key.revokedAt = new Date().toISOString();
  recordSecurityEvent("mcp_api_key_revoked", {
    handle: user.handle,
    keyId: key.id
  });
  return { ok: true, apiKey: redactKey(key) };
}

export function authenticateMcpApiKey(secret) {
  const token = parseBearer(secret);
  if (!token || !token.startsWith(KEY_PREFIX)) {
    return null;
  }

  const expected = Buffer.from(hashSecret(token));
  for (const user of users.values()) {
    for (const key of user.mcpApiKeys || []) {
      if (key.revokedAt || !key.secretHash) continue;
      const actual = Buffer.from(key.secretHash);
      if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
        key.lastUsedAt = new Date().toISOString();
        recordSecurityEvent("mcp_api_key_authenticated", {
          handle: user.handle,
          keyId: key.id,
          scopes: key.scopes || ["mcp:tools"]
        });
        return {
          ok: true,
          handle: user.handle,
          keyId: key.id,
          scopes: key.scopes || ["mcp:tools"]
        };
      }
    }
  }

  return null;
}

export function applyMcpApiKeyContext(tool, args = {}, context = {}) {
  if (!context.handle) {
    return args || {};
  }
  assertMcpToolAuthorized(tool, context);
  enforceMcpRateLimit(tool, context);

  const next = { ...(args || {}) };
  next.handle = context.handle;

  if ("senderHandle" in next || [
    "send_usdc",
    "create_payment_intent",
    "create_social_bounty",
    "create_airdrop",
    "award_airdrop"
  ].includes(tool)) {
    next.senderHandle = context.handle;
  }
  recordSecurityEvent("mcp_tool_authorized", securityTrace({
    handle: context.handle,
    tool,
    context
  }));

  return next;
}

export function assertMcpToolResultSafe(tool, result, context = {}) {
  if (!context.handle) return result;
  assertNoBackendSignerSpend(result, {
    handle: context.handle,
    tool
  });
  return result;
}

function redactKey(key) {
  return {
    id: key.id,
    name: key.name,
    scopes: key.scopes || ["mcp:tools"],
    prefix: key.prefix,
    last4: key.last4,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || null
  };
}

function getUser(handle) {
  const normalized = normalizeHandle(handle);
  const user = users.get(normalized);
  if (!user || !user.onboarded) {
    throw new Error("Connect X and create a wallet before creating MCP API keys.");
  }
  return user;
}

function normalizeHandle(handle) {
  const text = String(handle || "").trim().toLowerCase();
  if (!text) return "";
  return text.startsWith("@") ? text : `@${text}`;
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : String(scopes || "").split(",");
  const clean = values.map((scope) => String(scope).trim()).filter(Boolean);
  return clean.length ? clean : ["mcp:tools"];
}

function hashSecret(secret) {
  return createHash("sha256").update(String(secret)).digest("hex");
}

function parseBearer(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : text;
}
