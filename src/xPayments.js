import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { planAgentAction } from "./agentPlanner.js";
import { createAirdrop } from "./airdrops.js";
import { quoteDefiRoute, searchPredictionMarkets } from "./defiOrchestrator.js";
import { ledger } from "./fixtures.js";
import { nextXCommandId } from "./ids.js";
import { createPaymentIntent, createSocialBounty } from "./orchestrator.js";
import { proposePerpTrade } from "./perpsAgent.js";

export function verifyXWebhook({ headers, rawBody = "" }) {
  if (!config.webhookSecret) {
    return { ok: true, mode: "unsigned-demo", signed: false };
  }

  const provided = headers["x-arcpay-signature"] || headers["X-ArcPay-Signature"];
  const expected = `sha256=${createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex")}`;

  if (!safeEqual(provided, expected)) {
    throw new Error("Invalid X webhook signature");
  }

  return { ok: true, mode: "hmac-sha256", signed: true };
}

export async function processXWebhookDelivery({ headers = {}, rawBody = "" } = {}) {
  const receivedAt = new Date().toISOString();
  const signature = verifyXWebhook({ headers, rawBody });
  const body = rawBody ? JSON.parse(rawBody) : {};
  const normalized = normalizeXWebhookPayload({
    body,
    headers
  });

  const eventId = normalized.eventId || `x_${createHash("sha256").update(rawBody || receivedAt).digest("hex").slice(0, 16)}`;
  const existing = ledger.xWebhooks.find((event) => event.eventId === eventId && event.status !== "duplicate");
  if (existing) {
    const duplicate = {
      eventId: `${eventId}:duplicate:${Date.now()}`,
      originalEventId: eventId,
      postId: normalized.postId,
      actorHandle: normalized.actorHandle,
      text: normalized.text,
      settlementRail: normalized.settlementRail || null,
      receivedAt,
      status: "duplicate",
      signatureMode: signature.mode,
      source: "x-webhook",
      raw: safeWebhookRaw(body)
    };
    ledger.xWebhooks.push(duplicate);
    return {
      ok: true,
      duplicate: true,
      replayRejected: true,
      eventId,
      originalCommandId: existing.commandId || null,
      webhook: duplicate
    };
  }

  const webhook = {
    eventId,
    postId: normalized.postId,
    actorHandle: normalized.actorHandle,
    text: normalized.text,
    settlementRail: normalized.settlementRail || null,
    receivedAt,
    status: "accepted",
    signatureMode: signature.mode,
    source: "x-webhook",
    raw: safeWebhookRaw(body)
  };
  ledger.xWebhooks.push(webhook);

  try {
    const result = await processXPaymentEvent({
      actorHandle: normalized.actorHandle,
      text: normalized.text,
      postId: normalized.postId,
      eventId,
      settlementRail: normalized.settlementRail,
      source: "x-webhook",
      recordWebhook: false
    });
    webhook.status = "processed";
    webhook.commandId = result.command?.id || null;
    webhook.resultRefs = result.command?.resultRefs || {};
    return {
      ...result,
      webhook,
      signature
    };
  } catch (error) {
    webhook.status = "rejected";
    webhook.error = error.message;
    throw error;
  }
}

export function getXWebhookStatus({ host = "localhost:4317", protocol = "http" } = {}) {
  const endpointUrl = `${protocol}://${host}/api/x/webhook`;
  const samplePayload = {
    eventId: `evt_demo_${Date.now()}`,
    postId: `post_demo_${Date.now()}`,
    actorHandle: "@sara",
    text: "@ArcPay long BTC with 3 USDC at 2x",
    settlementRail: "arc-testnet"
  };
  const rawBody = JSON.stringify(samplePayload);
  const signature = config.webhookSecret
    ? `sha256=${createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex")}`
    : null;

  return {
    ok: true,
    endpointUrl,
    mode: config.webhookSecret ? "hmac-sha256" : "unsigned-demo",
    signed: Boolean(config.webhookSecret),
    headerName: "x-arcpay-signature",
    eventIdHeader: "x-event-id",
    replayProtection: "eventId + normalized command idempotency key",
    received: ledger.xWebhooks.length,
    processed: ledger.xWebhooks.filter((event) => ["processed", undefined, null].includes(event.status)).length,
    duplicates: ledger.xWebhooks.filter((event) => event.status === "duplicate").length,
    rejected: ledger.xWebhooks.filter((event) => event.status === "rejected").length,
    sample: {
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-arcpay-signature": signature } : {})
      },
      body: samplePayload,
      rawBody
    },
    recent: ledger.xWebhooks.slice().reverse().slice(0, 8)
  };
}

export async function processXPaymentEvent({
  actorHandle,
  text,
  postId = "x-post-demo",
  eventId,
  idempotencyKey,
  settlementRail,
  source = "x-webhook",
  recordWebhook = true
}) {
  const normalizedActor = normalizeHandleLocal(actorHandle);
  const canonicalIdempotencyKey = buildXCommandIdempotencyKey({
    eventId,
    idempotencyKey,
    source,
    postId,
    actorHandle: normalizedActor,
    text,
    settlementRail
  });
  const existingCommand = findExistingXCommand({
    idempotencyKey: canonicalIdempotencyKey,
    source,
    postId,
    actorHandle: normalizedActor,
    text,
    settlementRail
  });
  if (existingCommand) {
    existingCommand.replayCount = Number(existingCommand.replayCount || 0) + 1;
    existingCommand.lastReplayAt = new Date().toISOString();
    return {
      ok: true,
      ...replayResult(existingCommand),
      command: existingCommand,
      idempotentReplay: true
    };
  }

  const receivedAt = new Date().toISOString();
  if (recordWebhook) {
    ledger.xWebhooks.push({
      eventId: eventId || null,
      postId,
      actorHandle: normalizedActor,
      text,
      settlementRail: settlementRail || null,
      receivedAt,
      status: "processed",
      signatureMode: source === "x-webhook" ? "direct-call" : "simulator",
      source
    });
  }

  const command = {
    id: nextXCommandId(),
    eventId: eventId || null,
    postId,
    actorHandle: normalizedActor,
    text,
    settlementRail: settlementRail || null,
    source,
    status: "received",
    idempotencyKey: canonicalIdempotencyKey,
    idempotency: {
      eventId: eventId || null,
      key: canonicalIdempotencyKey,
      algorithm: eventId || idempotencyKey ? "explicit-event-or-idempotency-key" : "sha256-normalized-command-v1"
    },
    replayCount: 0,
    receivedAt,
    parsedAt: null,
    plannedAt: null,
    completedAt: null,
    intent: null,
    plan: null,
    resultRefs: {},
    result: null,
    reply: null,
    error: null
  };
  ledger.xCommands.push(command);

  let planned;
  try {
    planned = planAgentAction({
      handle: normalizedActor,
      text,
      defaultSettlementRail: settlementRail || "arc-testnet",
      source
    });
    command.intent = planned.intent;
    command.plan = planned.plan;
    command.status = planned.plan.tool ? "planned" : "clarification_required";
    command.parsedAt = new Date().toISOString();
    command.plannedAt = command.parsedAt;
  } catch (error) {
    command.status = "parse_failed";
    command.error = error.message;
    throw error;
  }

  if (!planned.plan.tool) {
    return completeCommand(command, {
      ok: false,
      clarification: planned.plan.reason,
      plan: planned.plan,
      signer: planned.signer,
      nextAction: "ask_for_clarification"
    });
  }

  let result;
  const args = planned.plan.arguments || {};

  if (planned.plan.tool === "create_social_bounty") {
    result = await createSocialBounty({
      ...args,
      senderHandle: normalizedActor,
      postId,
      settlementRail: settlementRail || args.settlementRail,
      idempotencyKey: canonicalIdempotencyKey,
      source
    });
    return completeCommand(command, result);
  }

  if (planned.plan.tool === "create_airdrop") {
    result = await createAirdrop({
      ...args,
      senderHandle: normalizedActor,
      postId: postId || args.postId,
      settlementRail: settlementRail || args.settlementRail,
      idempotencyKey: canonicalIdempotencyKey,
      source
    });
    return completeCommand(command, result);
  }

  if (planned.plan.tool === "propose_perp_trade") {
    result = proposePerpTrade({
      ...args,
      handle: normalizedActor,
      settlementRail: settlementRail || "arc-testnet",
      postId,
      idempotencyKey: canonicalIdempotencyKey,
      source
    });
    return completeCommand(command, result);
  }

  if (planned.plan.tool === "quote_defi_route") {
    result = await quoteDefiRoute({
      ...args,
      handle: normalizedActor,
      idempotencyKey: canonicalIdempotencyKey,
      source
    });
    return completeCommand(command, result);
  }

  if (planned.plan.tool === "search_prediction_markets") {
    result = await searchPredictionMarkets({
      ...args,
      handle: normalizedActor
    });
    return completeCommand(command, result);
  }

  if (planned.plan.tool === "send_usdc") {
    result = await createPaymentIntent({
      ...args,
      senderHandle: normalizedActor,
      settlementRail: settlementRail || args.settlementRail,
      idempotencyKey: canonicalIdempotencyKey,
      source
    });
    return completeCommand(command, result);
  }

  return completeCommand(command, {
    ok: false,
    error: `Planned X tool is not executable from X loop: ${planned.plan.tool}`,
    plan: planned.plan,
    signer: planned.signer
  });
}

export function normalizeXWebhookPayload({ body = {}, headers = {} } = {}) {
  const eventId = body.eventId
    || body.id
    || body.event_id
    || body.webhook_id
    || body.data?.eventId
    || headers["x-event-id"];
  const tweet = body.tweet_create_events?.[0]
    || body.data?.tweet
    || body.data
    || body.tweet
    || body;
  const authorId = tweet.author_id || tweet.user?.id || body.user?.id;
  const includedUser = (body.includes?.users || []).find((user) => String(user.id) === String(authorId))
    || body.includes?.users?.[0];
  const actorHandle = body.actorHandle
    || body.actor?.username
    || body.user?.username
    || tweet.user?.screen_name
    || tweet.user?.username
    || includedUser?.username;
  const text = body.text
    || tweet.text
    || body.data?.text;
  const postId = body.postId
    || tweet.id
    || tweet.id_str
    || body.data?.id
    || eventId
    || "x-post-demo";

  if (!actorHandle) {
    throw new Error("X webhook is missing actor handle");
  }

  if (!text) {
    throw new Error("X webhook is missing command text");
  }

  return {
    eventId,
    postId,
    actorHandle: normalizeHandleLocal(actorHandle),
    text,
    settlementRail: body.settlementRail || body.settlement_rail || body.data?.settlementRail
  };
}

export function listXCommands({ handle, status, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandleLocal(handle) : null;
  const commands = ledger.xCommands
    .filter((command) => (
      (!normalized || normalizeHandleLocal(command.actorHandle) === normalized)
      && (!status || command.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);

  return { ok: true, commands };
}

export function getXCommandReceipt({ commandId, host, protocol = "http" } = {}) {
  const command = ledger.xCommands.find((item) => item.id === commandId);
  if (!command) {
    throw new Error("X command not found");
  }
  const publicUrl = host ? `${protocol}://${host}/x/commands/${encodeURIComponent(command.id)}` : null;
  const approvalUrl = relatedApprovalUrl(command, { host, protocol });
  const links = {
    receiptUrl: publicUrl,
    approvalUrl
  };
  command.links = {
    ...(command.links || {}),
    ...Object.fromEntries(Object.entries(links).filter(([, value]) => Boolean(value)))
  };

  return {
    ok: true,
    receipt: {
      command,
      related: resolveRelated(command),
      reply: buildXCommandReply(command, replayResult(command), { publicUrl, approvalUrl }),
      publicUrl,
      approvalUrl,
      links
    }
  };
}

function completeCommand(command, result) {
  command.status = result?.ok === false ? "rejected" : "completed";
  command.completedAt = new Date().toISOString();
  command.resultRefs = resultRefs(result);
  command.result = summarizeResult(result);
  command.reply = buildXCommandReply(command, result);
  return { ...result, command };
}

export function buildXCommandReply(command, result = {}, { publicUrl, approvalUrl } = {}) {
  const status = command.result?.status
    || result.execution?.status
    || result.payment?.status
    || result.proposal?.status
    || result.action?.status
    || result.approval?.status
    || command.status;
  const signer = result.payment?.signer
    || result.proposal?.signer
    || result.action?.signer
    || result.signer
    || command.plan?.signer;
  const urlSuffix = [
    approvalUrl ? `Approve: ${approvalUrl}` : "",
    publicUrl ? `Receipt: ${publicUrl}` : ""
  ].filter(Boolean).join(" ");
  const signerLabel = signer?.backendSignerAllowed === false ? "No backend signer used." : "Signer policy checked.";

  if (command.status === "rejected" || result.ok === false) {
    const reason = result.execution?.reason || result.clarification || result.error || command.error || command.plan?.reason || "I need a clearer command.";
    return `Could not run this yet: ${reason} ${signerLabel} ${urlSuffix}`.trim();
  }

  if (result.execution) {
    const tx = result.execution.txHash ? ` Tx: ${result.execution.txHash}` : "";
    return `Agent ${result.execution.status || "completed"}: ${result.execution.reason || "action completed."}${tx} ${signerLabel} ${urlSuffix}`.trim();
  }

  if (result.payment) {
    if (result.payment.status === "claimable") {
      return `Created claimable ${formatAmount(result.payment.amount, result.payment.asset)} for ${result.payment.recipientHandle}. Recipient needs to connect X to claim. ${signerLabel} ${urlSuffix}`.trim();
    }
    if (result.payment.status === "requires_confirmation") {
      return `Payment needs approval: ${formatAmount(result.payment.amount, result.payment.asset)} to ${result.payment.recipientHandle}. ${signerLabel} ${urlSuffix}`.trim();
    }
    return `Payment accepted: ${formatAmount(result.payment.amount, result.payment.asset)} to ${result.payment.recipientHandle} on ${result.payment.settlementRail || "arc-testnet"}. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (result.airdrop) {
    return `Airdrop ${result.airdrop.status}: ${formatAmount(result.airdrop.amountPerRecipient, result.airdrop.asset)} each for up to ${result.airdrop.maxRecipients} recipient(s). ${signerLabel} ${urlSuffix}`.trim();
  }

  if (result.action) {
    const type = result.action.type === "swap" ? "swap" : "bridge";
    return `Created ${type} quote for ${formatAmount(result.action.amount, result.action.fromToken || "USDC")}. User approval/signing is required before execution. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (result.proposal) {
    return `Perps proposal ready: ${result.proposal.side} ${result.proposal.symbol} with ${formatAmount(result.proposal.collateralUsd, "USDC")} at ${result.proposal.leverage}x. User approval/signing is required before execution. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (result.markets) {
    return `Found ${result.markets.length} market${result.markets.length === 1 ? "" : "s"}. Read-only search, no funds moved. ${signerLabel} ${urlSuffix}`.trim();
  }

  return `Command ${status || "completed"}. ${signerLabel} ${urlSuffix}`.trim();
}

function resultRefs(result = {}) {
  return {
    paymentId: result.payment?.id || null,
    airdropId: result.airdrop?.id || null,
    approvalId: result.approval?.id || result.payment?.approvalId || result.airdrop?.approvalId || null,
    proposalId: result.proposal?.id || null,
    defiActionId: result.action?.id || null,
    positionId: result.execution?.ids?.positionId || result.position?.id || null,
    txHash: result.execution?.txHash || result.txHash || null,
    jobId: result.job?.id || result.proposal?.execution?.jobId || null,
    claimId: result.claim?.paymentId || null
  };
}

function summarizeResult(result = {}) {
  return {
    ok: result.ok !== false,
    kind: result.execution?.tool || (result.payment ? "payment" : result.airdrop ? "airdrop" : result.proposal ? "perp_proposal" : result.action ? "defi_action" : result.claim ? "claim" : "action"),
    status: result.execution?.status || result.payment?.status || result.airdrop?.status || result.proposal?.status || result.action?.status || result.claim?.status || result.approval?.status || null,
    idempotentReplay: Boolean(result.idempotentReplay),
    resultRefs: resultRefs(result)
  };
}

function resolveRelated(command) {
  const refs = command.resultRefs || {};
  return {
    payment: refs.paymentId ? ledger.payments.find((item) => item.id === refs.paymentId) || null : null,
    airdrop: refs.airdropId ? ledger.airdrops.find((item) => item.id === refs.airdropId) || null : null,
    approval: refs.approvalId ? ledger.approvals.find((item) => item.id === refs.approvalId) || null : null,
    defiAction: refs.defiActionId ? ledger.defiActions.find((item) => item.id === refs.defiActionId) || null : null,
    proposal: refs.proposalId ? ledger.perpProposals.find((item) => item.id === refs.proposalId) || null : null,
    job: refs.jobId ? ledger.jobs.find((item) => item.id === refs.jobId) || null : null
  };
}

function replayResult(command) {
  const related = resolveRelated(command);
  return {
    ...(command.result || {}),
    payment: related.payment,
    airdrop: related.airdrop,
    approval: related.approval,
    action: related.defiAction,
    proposal: related.proposal,
    job: related.job
  };
}

function findExistingXCommand({
  idempotencyKey,
  source,
  postId,
  actorHandle,
  text,
  settlementRail
} = {}) {
  const exact = ledger.xCommands.find((command) => command.idempotencyKey === idempotencyKey);
  if (exact) return exact;

  const normalizedActor = normalizeHandleLocal(actorHandle);
  const normalizedText = normalizeCommandText(text);
  const normalizedRail = settlementRail || "default";

  return ledger.xCommands.find((command) => (
    command.source === source
    && String(command.postId || "") === String(postId || "")
    && normalizeHandleLocal(command.actorHandle) === normalizedActor
    && normalizeCommandText(command.text) === normalizedText
    && (command.settlementRail || "default") === normalizedRail
  )) || null;
}

function buildXCommandIdempotencyKey({
  eventId,
  idempotencyKey,
  source,
  postId,
  actorHandle,
  text,
  settlementRail
} = {}) {
  if (idempotencyKey) {
    return `xcmd:explicit:${hashText(idempotencyKey)}`;
  }

  if (eventId) {
    return `xcmd:event:${hashText(eventId)}`;
  }

  const payload = [
    source || "x-command",
    postId || "",
    normalizeHandleLocal(actorHandle),
    normalizeCommandText(text),
    settlementRail || "default"
  ].join("|");

  return `xcmd:normalized:${hashText(payload)}`;
}

function relatedApprovalUrl(command, { host, protocol = "http" } = {}) {
  const approvalId = command.resultRefs?.approvalId;
  if (!approvalId || !host) {
    return null;
  }

  return `${protocol}://${host}/x/commands/${encodeURIComponent(command.id)}/approve`;
}

function normalizeCommandText(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hashText(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 32);
}

function normalizeHandleLocal(handle) {
  const value = String(handle || "").trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}

function safeWebhookRaw(body) {
  return {
    eventId: body.eventId || body.id || body.event_id || body.data?.eventId || null,
    postId: body.postId || body.data?.id || body.tweet?.id || null,
    actorHandle: body.actorHandle || body.actor?.username || body.user?.username || null,
    text: body.text || body.data?.text || body.tweet?.text || null
  };
}

function formatAmount(amount, asset = "USDC") {
  return `${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset || "USDC"}`;
}

function safeEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
