import { config } from "./config.js";
import { openSecret } from "./cryptoBox.js";
import { ledger, users } from "./fixtures.js";
import { normalizeHandle } from "./identity.js";
import { buildXCommandReply } from "./xPayments.js";

const TWEET_ID_PATTERN = /^[0-9]{1,19}$/;

export function getXReplyReadiness({ handle } = {}) {
  const authorMode = config.x.replyAuthor === "actor" ? "actor" : "bot";
  const normalized = handle ? normalizeHandle(handle) : null;
  const user = normalized ? users.get(normalized) : null;
  const configuredScopes = new Set(config.x.scopes || []);
  const actorScopes = new Set(String(user?.xOAuth?.scope || "").split(/\s+/).filter(Boolean));
  const tokenAvailable = authorMode === "bot"
    ? Boolean(config.x.botAccessToken)
    : Boolean(user?.xOAuth?.accessToken);
  const hasTweetWriteScope = authorMode === "bot"
    ? configuredScopes.has("tweet.write")
    : actorScopes.has("tweet.write");

  return {
    ok: true,
    enabled: config.x.replyEnabled,
    authorMode,
    apiBaseUrl: config.x.apiBaseUrl,
    tokenAvailable,
    hasTweetWriteScope,
    ready: Boolean(config.x.replyEnabled && tokenAvailable && hasTweetWriteScope),
    requiredScopes: ["tweet.read", "tweet.write", "users.read"],
    status: config.x.replyEnabled
      ? (tokenAvailable && hasTweetWriteScope ? "ready" : "missing_credentials_or_scope")
      : "disabled",
    message: config.x.replyEnabled
      ? "X replies post to POST /2/tweets with reply.in_reply_to_tweet_id."
      : "Set X_REPLY_ENABLED=1, X_SCOPES with tweet.write, and X_BOT_ACCESS_TOKEN for real bot replies."
  };
}

export async function postXCommandReply({ commandId, publicUrl, force = false, textOverride, deliveryField = "replyDelivery" } = {}) {
  const command = ledger.xCommands.find((item) => item.id === commandId);
  if (!command) {
    throw new Error("X command not found");
  }

  const existingDelivery = command[deliveryField];
  if (existingDelivery?.status === "posted" && !force) {
    return {
      ok: true,
      status: "already_posted",
      skipped: true,
      command,
      delivery: existingDelivery,
      message: "Reply already posted for this command."
    };
  }

  const readiness = getXReplyReadiness({ handle: command.actorHandle });
  const approvalUrl = command.links?.approvalUrl || buildApprovalUrlFromReceiptUrl(command, publicUrl);
  const baseText = textOverride || command.reply || buildXCommandReply(command, command.result || {}, { publicUrl, approvalUrl });
  const text = appendReplyLinks(baseText, { publicUrl, approvalUrl });
  const delivery = {
    status: "not_sent",
    replyAuthor: readiness.authorMode,
    inReplyToTweetId: command.postId,
    text,
    publicUrl: publicUrl || null,
    attemptedAt: new Date().toISOString(),
    provider: "x-api-v2",
    endpoint: `${config.x.apiBaseUrl.replace(/\/+$/, "")}/2/tweets`
  };

  if (!readiness.enabled && !force) {
    command[deliveryField] = {
      ...delivery,
      status: "x_reply_not_enabled",
      readiness
    };
    return {
      ok: false,
      status: "x_reply_not_enabled",
      command,
      readiness,
      message: readiness.message
    };
  }

  if (!readiness.ready) {
    command[deliveryField] = {
      ...delivery,
      status: "x_reply_not_ready",
      readiness
    };
    return {
      ok: false,
      status: "x_reply_not_ready",
      command,
      readiness,
      message: readiness.message
    };
  }

  if (!TWEET_ID_PATTERN.test(String(command.postId || ""))) {
    command[deliveryField] = {
      ...delivery,
      status: "invalid_reply_target",
      error: "X reply posting requires a numeric postId from a real X webhook."
    };
    return {
      ok: false,
      status: "invalid_reply_target",
      command,
      message: command[deliveryField].error
    };
  }

  const accessToken = getReplyAccessToken(command.actorHandle, readiness.authorMode);
  const response = await fetch(delivery.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      text: trimPostText(text),
      reply: {
        in_reply_to_tweet_id: String(command.postId)
      }
    })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    command[deliveryField] = {
      ...delivery,
      status: "failed",
      error: data.detail || data.title || data.error || `X API returned ${response.status}`,
      response: data
    };
    return {
      ok: false,
      status: "failed",
      command,
      delivery: command[deliveryField]
    };
  }

  command[deliveryField] = {
    ...delivery,
    status: "posted",
    tweetId: data.data?.id || null,
    postedText: data.data?.text || trimPostText(text),
    postedAt: new Date().toISOString(),
    response: data
  };

  return {
    ok: true,
    status: "posted",
    command,
    delivery: command[deliveryField]
  };
}

function getReplyAccessToken(handle, authorMode) {
  if (authorMode === "bot") {
    return config.x.botAccessToken;
  }

  const user = users.get(normalizeHandle(handle));
  if (!user?.xOAuth?.accessToken) {
    throw new Error("Actor X OAuth token is not available");
  }
  return openSecret(user.xOAuth.accessToken);
}

function trimPostText(text) {
  const value = String(text || "").trim();
  if (value.length <= 280) return value;
  return `${value.slice(0, 276).trimEnd()}...`;
}

function buildApprovalUrlFromReceiptUrl(command, publicUrl) {
  if (!command.resultRefs?.approvalId || !publicUrl) {
    return null;
  }

  return `${String(publicUrl).replace(/\/+$/, "")}/approve`;
}

function appendReplyLinks(text, { publicUrl, approvalUrl } = {}) {
  const links = [
    approvalUrl && !String(text).includes(approvalUrl) ? `Approve: ${approvalUrl}` : "",
    publicUrl && !String(text).includes(publicUrl) ? `Receipt: ${publicUrl}` : ""
  ].filter(Boolean);

  if (!links.length) {
    return text;
  }

  return `${text} ${links.join(" ")}`.trim();
}
