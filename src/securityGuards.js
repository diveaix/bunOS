import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { ledger } from "./fixtures.js";
import { nextEventId } from "./ids.js";
import { redactSensitive } from "./redaction.js";
import { recordSecurityEvent, requiredScopesForTool } from "./securityPolicy.js";

const DEFAULT_APPROVAL_TTL_MS = 15 * 60_000;
const DEFAULT_LOCK_TTL_MS = 10 * 60_000;

export function createApprovalToken({ approval, commandId, ttlMs = DEFAULT_APPROVAL_TTL_MS } = {}) {
  if (!approval?.id) throw new Error("Approval is required to create a token");
  const now = Date.now();
  const payload = {
    typ: "bunos_approval",
    approvalId: approval.id,
    handle: approval.handle,
    targetId: approval.targetId,
    commandId: commandId || null,
    nonce: approval.tokenNonce || randomBytes(12).toString("base64url"),
    iat: now,
    exp: now + ttlMs
  };
  approval.tokenNonce = payload.nonce;
  approval.tokenExpiresAt = new Date(payload.exp).toISOString();
  const body = base64url(JSON.stringify(payload));
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifyApprovalToken({ token, approval, commandId } = {}) {
  if (!approval?.id) throw new Error("Approval is required");
  if (!token) {
    const error = new Error("Signed approval token is required");
    error.status = 401;
    throw error;
  }

  const [body, signature] = String(token).split(".");
  if (!body || !signature || !safeEqual(signature, sign(body))) {
    const error = new Error("Invalid approval token");
    error.status = 401;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    const error = new Error("Malformed approval token");
    error.status = 401;
    throw error;
  }

  if (payload.typ !== "bunos_approval"
    || payload.approvalId !== approval.id
    || payload.handle !== approval.handle
    || payload.targetId !== approval.targetId
    || payload.nonce !== approval.tokenNonce
    || (commandId && payload.commandId && payload.commandId !== commandId)) {
    const error = new Error("Approval token does not match this action");
    error.status = 401;
    throw error;
  }

  if (Number(payload.exp || 0) <= Date.now()) {
    const error = new Error("Approval token expired");
    error.status = 401;
    throw error;
  }

  recordSecurityEvent("approval_token_verified", {
    handle: approval.handle,
    approvalId: approval.id,
    targetId: approval.targetId,
    commandId: commandId || payload.commandId || null
  });
  return { ok: true, payload };
}

export function acquireSpendLock({
  handle,
  operation,
  targetId,
  idempotencyKey,
  amount,
  asset,
  ttlMs = DEFAULT_LOCK_TTL_MS
} = {}) {
  const key = stableKey(["spend", normalizeHandle(handle), operation, targetId || idempotencyKey]);
  const now = Date.now();
  const existing = activeLock(key, now);
  if (existing) {
    recordSecurityEvent("spend_lock_replay_rejected", {
      handle: normalizeHandle(handle),
      operation,
      targetId: targetId || null,
      idempotencyKey: idempotencyKey || null,
      lockId: existing.id
    });
    return { ok: false, duplicate: true, lock: existing };
  }

  const lock = {
    id: `lock_${stableKey([key, now, randomBytes(4).toString("hex")]).slice(0, 24)}`,
    key,
    scope: "spend",
    handle: normalizeHandle(handle),
    operation,
    targetId: targetId || null,
    idempotencyKey: idempotencyKey || null,
    amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
    asset: asset || null,
    status: "active",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString()
  };
  ledger.securityLocks ||= [];
  ledger.securityLocks.push(lock);
  recordSecurityEvent("spend_lock_acquired", {
    handle: lock.handle,
    operation,
    targetId: lock.targetId,
    lockId: lock.id,
    amount: lock.amount,
    asset: lock.asset
  });
  return { ok: true, lock };
}

export function completeSpendLock({ lock, status = "completed", result } = {}) {
  if (!lock?.id) return null;
  const stored = (ledger.securityLocks || []).find((item) => item.id === lock.id) || lock;
  stored.status = status;
  stored.completedAt = new Date().toISOString();
  stored.result = summarizeResult(result);
  recordSecurityEvent("spend_lock_completed", {
    handle: stored.handle,
    operation: stored.operation,
    targetId: stored.targetId,
    lockId: stored.id,
    status
  });
  return stored;
}

export function acquireReplayLock({ scope, key, handle, ttlMs = 24 * 60 * 60_000 } = {}) {
  const normalizedKey = stableKey(["replay", scope, normalizeHandle(handle), key]);
  const now = Date.now();
  const existing = activeLock(normalizedKey, now);
  if (existing) {
    recordSecurityEvent("replay_lock_rejected", {
      handle: normalizeHandle(handle),
      scope,
      key,
      lockId: existing.id
    });
    return { ok: false, duplicate: true, lock: existing };
  }
  const lock = {
    id: `replay_${stableKey([normalizedKey, now, randomBytes(4).toString("hex")]).slice(0, 24)}`,
    key: normalizedKey,
    scope: `replay:${scope || "generic"}`,
    handle: normalizeHandle(handle),
    replayKey: key,
    status: "active",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString()
  };
  ledger.securityLocks ||= [];
  ledger.securityLocks.push(lock);
  recordSecurityEvent("replay_lock_acquired", {
    handle: lock.handle,
    scope,
    replayKey: key,
    lockId: lock.id
  });
  return { ok: true, lock };
}

export function enforceMcpRateLimit(tool, context = {}) {
  if (!context.keyId) return { ok: true, skipped: true };
  const required = requiredScopesForTool(tool);
  const bucketScope = rateLimitScope(required[0] || "mcp:tools");
  const windowMs = 60_000;
  const limit = rateLimitForScope(bucketScope);
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = `${context.keyId}:${bucketScope}:${windowStart}`;
  ledger.rateLimits ||= [];
  let bucket = ledger.rateLimits.find((item) => item.id === id);
  if (!bucket) {
    bucket = {
      id,
      keyId: context.keyId,
      handle: normalizeHandle(context.handle),
      scope: bucketScope,
      count: 0,
      limit,
      windowStart: new Date(windowStart).toISOString(),
      windowEndsAt: new Date(windowStart + windowMs).toISOString()
    };
    ledger.rateLimits.push(bucket);
  }
  bucket.count += 1;
  bucket.updatedAt = new Date(now).toISOString();
  if (bucket.count > bucket.limit) {
    recordSecurityEvent("mcp_rate_limited", {
      handle: bucket.handle,
      keyId: context.keyId,
      tool,
      scope: bucketScope,
      count: bucket.count,
      limit: bucket.limit
    });
    const error = new Error(`MCP key rate limit exceeded for ${bucketScope}`);
    error.status = 429;
    throw error;
  }
  return { ok: true, bucket };
}

export function assertNoBackendSignerSpend(result, context = {}) {
  const hits = [];
  scan(result, (path, value) => {
    if (path.endsWith(".backendSignerAllowed") && value === true) hits.push(path);
  });
  if (hits.length) {
    recordSecurityEvent("backend_signer_invariant_failed", {
      handle: context.handle || null,
      tool: context.tool || null,
      paths: hits
    });
    throw new Error("Security invariant failed: backend signer cannot spend user funds");
  }
  return { ok: true };
}

export function assertPublicPayloadSafe(payload, context = {}) {
  const redacted = redactSensitive(payload);
  const leaks = findSecretLeaks(redacted);
  if (leaks.length) {
    recordSecurityEvent("public_payload_secret_leak_blocked", {
      route: context.route || null,
      leaks
    });
    const error = new Error("Public payload contains sensitive material");
    error.status = 500;
    throw error;
  }
  return redacted;
}

export function listSecurityAuditEvents({ handle, type, limit = 100 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const events = (ledger.events || [])
    .filter((event) => (
      (!normalized || event.handle === normalized)
      && (!type || event.type === type)
      && /security|mcp_|approval_token|replay_lock|spend_lock|rate_limited|backend_signer|secret_leak/.test(event.type || "")
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 100);
  return { ok: true, events: redactSensitive(events) };
}

function activeLock(key, now = Date.now()) {
  return (ledger.securityLocks || []).find((lock) => (
    lock.key === key
    && lock.status === "active"
    && new Date(lock.expiresAt || 0).getTime() > now
  )) || null;
}

function base64url(value) {
  return Buffer.from(String(value)).toString("base64url");
}

function sign(body) {
  return createHmac("sha256", approvalSecret()).update(String(body)).digest("base64url");
}

function approvalSecret() {
  return `${config.tokenEncryptionKey}:${config.webhookSecret || "x"}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function stableKey(parts) {
  return createHash("sha256").update(parts.map((part) => String(part || "")).join("|")).digest("hex");
}

function normalizeHandle(handle) {
  const value = String(handle || "").trim().toLowerCase();
  if (!value) return null;
  return value.startsWith("@") ? value : `@${value}`;
}

function summarizeResult(result) {
  if (!result) return null;
  return {
    ok: result.ok !== false,
    status: result.status || result.payment?.status || result.action?.status || result.proposal?.status || result.airdrop?.status || null,
    paymentId: result.payment?.id || null,
    actionId: result.action?.id || null,
    proposalId: result.proposal?.id || null,
    airdropId: result.airdrop?.id || null
  };
}

function rateLimitScope(scope) {
  if (scope === "mcp:read") return "mcp:read";
  if (scope === "mcp:payments") return "mcp:payments";
  if (scope === "mcp:trade") return "mcp:trade";
  if (scope === "mcp:approvals") return "mcp:approvals";
  if (scope === "mcp:automations") return "mcp:automations";
  if (scope === "mcp:wallets") return "mcp:wallets";
  return "mcp:tools";
}

function rateLimitForScope(scope) {
  return {
    "mcp:read": 180,
    "mcp:tools": 120,
    "mcp:wallets": 60,
    "mcp:automations": 60,
    "mcp:approvals": 40,
    "mcp:trade": 30,
    "mcp:payments": 30
  }[scope] || 60;
}

function scan(value, visitor, path = "$", seen = new WeakSet()) {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") {
    visitor(path, value);
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, visitor, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    scan(item, visitor, `${path}.${key}`, seen);
  }
}

function findSecretLeaks(payload) {
  const serialized = JSON.stringify(payload);
  const leaks = [];
  if (/bunos_mcp_[A-Za-z0-9_-]+/.test(serialized)) leaks.push("mcp_api_key");
  if (/KIT_KEY:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/.test(serialized)) leaks.push("appkit_key");
  if (hasPrivateKeyLikeHex(payload)) leaks.push("private_key_like_hex");
  if (/Bearer\s+[A-Za-z0-9._~+/-]+=*/i.test(serialized)) leaks.push("bearer_token");
  return leaks;
}

function hasPrivateKeyLikeHex(value, path = "") {
  if (typeof value === "string") {
    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) return false;
    return !/\.(txHash|transactionHash|blockHash)$/i.test(path);
  }
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item, index) => hasPrivateKeyLikeHex(item, `${path}[${index}]`));
  }
  return Object.entries(value).some(([key, item]) => hasPrivateKeyLikeHex(item, `${path}.${key}`));
}
