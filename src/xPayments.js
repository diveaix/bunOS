import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { planAgentAction, runAgentAction } from "./agentPlanner.js";
import { refreshExecutionMonitor } from "./executionMonitor.js";
import { ledger } from "./fixtures.js";
import { nextXCommandId } from "./ids.js";
import { createApprovalToken } from "./securityGuards.js";

export function verifyXWebhook({ headers, rawBody = "" }) {
  if (!config.webhookSecret) {
    return { ok: true, mode: "unsigned-demo", signed: false };
  }

  const provided = headers["x-bunos-signature"] || headers["X-bunOS-Signature"];
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
    text: "@bunOS long BTC with 3 USDC at 2x",
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
    headerName: "x-bunos-signature",
    eventIdHeader: "x-event-id",
    replayProtection: "eventId + normalized command idempotency key",
    received: ledger.xWebhooks.length,
    processed: ledger.xWebhooks.filter((event) => ["processed", undefined, null].includes(event.status)).length,
    duplicates: ledger.xWebhooks.filter((event) => event.status === "duplicate").length,
    rejected: ledger.xWebhooks.filter((event) => event.status === "rejected").length,
    sample: {
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-bunos-signature": signature } : {})
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
    agentState: null,
    decision: null,
    narrative: null,
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

  const result = await runAgentAction({
    handle: normalizedActor,
    text,
    defaultSettlementRail: settlementRail || "arc-testnet",
    source,
    postId,
    idempotencyKey: canonicalIdempotencyKey,
    fast: true
  });
  command.agentState = result.agentState || null;
  command.decision = result.decision || null;
  command.narrative = result.narrative || null;
  command.intent = result.planned?.intent || command.intent;
  command.plan = result.planned?.plan || command.plan;
  return completeCommand(command, result);
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
  const core = unwrapAgentResult(result);
  const hasUsefulResult = Boolean(core.payment || core.airdrop || core.proposal || core.action || core.claim || core.markets || core.automation || core.automations);
  command.status = result?.ok === false && !hasUsefulResult ? "rejected" : "completed";
  command.completedAt = new Date().toISOString();
  command.resultRefs = resultRefs(result);
  command.result = summarizeResult(result);
  command.decision = result.decision || command.decision || null;
  command.agentState = result.agentState || command.agentState || null;
  command.narrative = result.narrative || command.narrative || null;
  command.reply = buildXCommandReply(command, result);
  return { ...result, ...core, command };
}

function unwrapAgentResult(result = {}) {
  if (result.result && (result.planned || result.execution || result.decision)) {
    return {
      ...result.result,
      execution: result.execution,
      decision: result.decision,
      agentState: result.agentState
    };
  }
  return result;
}

export function buildXCommandReply(command, result = {}, { publicUrl, approvalUrl } = {}) {
  const core = unwrapAgentResult(result);
  const execution = result.execution || core.execution || null;
  const narrative = result.narrative || core.narrative || command.narrative || null;
  const status = command.result?.status
    || execution?.status
    || core.payment?.status
    || core.proposal?.status
    || core.action?.status
    || core.approval?.status
    || command.status;
  const signer = result.payment?.signer
    || core.payment?.signer
    || core.proposal?.signer
    || core.action?.signer
    || result.signer
    || command.plan?.signer;
  const urlSuffix = [
    approvalUrl ? `Approve: ${approvalUrl}` : "",
    publicUrl ? `Receipt: ${publicUrl}` : ""
  ].filter(Boolean).join(" ");
  const signerLabel = signer?.backendSignerAllowed === false ? "bunOS safety: No backend signer used." : "bunOS safety: signer policy checked.";

  if (core.automation) {
    const every = core.automation.intervalMinutes ? ` every ${core.automation.intervalMinutes}m` : "";
    return `Automation ${core.automation.status}: ${core.automation.name || core.automation.kind}${every}. It will run through policy-gated user-wallet paths. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (Array.isArray(core.automations)) {
    return `Found ${core.automations.length} automation${core.automations.length === 1 ? "" : "s"}. No funds moved. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (narrative?.summary) {
    return `${narrative.summary} ${signerLabel} ${urlSuffix}`.trim();
  }

  if (command.status === "rejected" || result.ok === false) {
    const reason = execution?.reason || result.reason || result.clarification || core.reason || core.error || command.error || command.plan?.reason || "I need a clearer command.";
    return `Could not run this yet: ${reason} ${signerLabel} ${urlSuffix}`.trim();
  }

  if (execution && !core.payment && !core.action && !core.proposal && !core.airdrop) {
    const tx = execution.txHash ? ` Tx: ${execution.txHash}` : "";
    return `Agent ${execution.status || "completed"}: ${execution.reason || "action completed."}${tx} ${signerLabel} ${urlSuffix}`.trim();
  }

  if (core.payment) {
    if (core.payment.status === "claimable") {
      return `Created claimable ${formatAmount(core.payment.amount, core.payment.asset)} for ${core.payment.recipientHandle}. Recipient needs to connect X to claim. ${signerLabel} ${urlSuffix}`.trim();
    }
    if (core.payment.status === "requires_confirmation") {
      return `Payment needs approval: ${formatAmount(core.payment.amount, core.payment.asset)} to ${core.payment.recipientHandle}. ${signerLabel} ${urlSuffix}`.trim();
    }
    return `Payment accepted: ${formatAmount(core.payment.amount, core.payment.asset)} to ${core.payment.recipientHandle} on ${core.payment.settlementRail || "arc-testnet"}. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (core.airdrop) {
    return `Airdrop ${core.airdrop.status}: ${formatAmount(core.airdrop.amountPerRecipient, core.airdrop.asset)} each for up to ${core.airdrop.maxRecipients} recipient(s). ${signerLabel} ${urlSuffix}`.trim();
  }

  if (core.action) {
    const type = core.action.type === "swap" ? "swap" : "bridge";
    const amount = core.action.request?.amount || core.action.request?.amountUsd || core.action.amount || 0;
    const token = core.action.request?.fromToken || core.action.fromToken || "USDC";
    const routeCheck = core.action.simulation?.recommendation ? ` Route check: ${core.action.simulation.recommendation}.` : "";
    return `Created ${type} quote for ${formatAmount(amount, token)}.${routeCheck} User approval/signing is required before execution. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (core.proposal) {
    return `Perps proposal ready: ${core.proposal.side} ${core.proposal.symbol} with ${formatAmount(core.proposal.collateralUsd, "USDC")} at ${core.proposal.leverage}x. User approval/signing is required before execution. ${signerLabel} ${urlSuffix}`.trim();
  }

  if (core.markets) {
    return `Found ${core.markets.length} market${core.markets.length === 1 ? "" : "s"}. Read-only search, no funds moved. ${signerLabel} ${urlSuffix}`.trim();
  }

  return `Command ${status || "completed"}. ${signerLabel} ${urlSuffix}`.trim();
}

function resultRefs(result = {}) {
  const core = unwrapAgentResult(result);
  const execution = result.execution || core.execution || {};
  return {
    paymentId: core.payment?.id || null,
    airdropId: core.airdrop?.id || null,
    automationId: core.automation?.id || null,
    approvalId: core.approval?.id || core.payment?.approvalId || core.airdrop?.approvalId || core.action?.approvalId || core.proposal?.approvalId || execution.ids?.approvalId || null,
    proposalId: core.proposal?.id || execution.ids?.proposalId || null,
    defiActionId: core.action?.id || execution.ids?.actionId || null,
    positionId: execution.ids?.positionId || core.position?.id || null,
    txHash: execution.txHash || core.txHash || result.txHash || null,
    jobId: core.job?.id || core.execution?.jobId || core.proposal?.execution?.jobId || null,
    claimId: core.claim?.paymentId || null
  };
}

export async function refreshXCommandExecution({
  commandId,
  host,
  protocol = "http",
  runWorker = true
} = {}) {
  const command = ledger.xCommands.find((item) => item.id === commandId);
  if (!command) {
    throw new Error("X command not found");
  }

  const target = commandMonitorTarget(command);
  if (!target) {
    return {
      ok: true,
      skipped: true,
      reason: "This X command has no monitorable execution target.",
      command,
      receipt: getXCommandReceipt({ commandId, host, protocol }).receipt
    };
  }

  const refreshed = await refreshExecutionMonitor({
    ...target,
    host,
    protocol,
    runWorker
  });
  command.executionMonitor = refreshed.monitor;
  command.lastExecutionRefreshAt = new Date().toISOString();
  if (refreshed.monitor?.txHash) {
    command.resultRefs = {
      ...(command.resultRefs || {}),
      txHash: refreshed.monitor.txHash
    };
  }
  command.finalReply = buildXCommandFinalReply(command, refreshed.monitor, {
    publicUrl: host ? `${protocol}://${host}/x/commands/${encodeURIComponent(command.id)}` : null
  });

  return {
    ok: true,
    command,
    monitor: refreshed.monitor,
    receipt: getXCommandReceipt({ commandId, host, protocol }).receipt
  };
}

function summarizeResult(result = {}) {
  const core = unwrapAgentResult(result);
  const execution = result.execution || core.execution || {};
  return {
    ok: result.ok !== false,
    kind: execution.tool || (core.payment ? "payment" : core.airdrop ? "airdrop" : core.automation ? "automation" : Array.isArray(core.automations) ? "automation_list" : core.proposal ? "perp_proposal" : core.action ? "defi_action" : core.claim ? "claim" : "action"),
    status: execution.status || core.payment?.status || core.airdrop?.status || core.automation?.status || core.proposal?.status || core.action?.status || core.claim?.status || core.approval?.status || result.status || null,
    idempotentReplay: Boolean(result.idempotentReplay),
    decision: result.decision ? {
      stance: result.decision.stance,
      confidence: result.decision.confidence,
      nextAction: result.decision.nextAction
    } : null,
    resultRefs: resultRefs(result),
    narrative: result.narrative ? {
      mode: result.narrative.mode,
      summary: result.narrative.summary,
      nextAction: result.narrative.nextAction
    } : null
  };
}

function resolveRelated(command) {
  const refs = command.resultRefs || {};
  return {
    payment: refs.paymentId ? ledger.payments.find((item) => item.id === refs.paymentId) || null : null,
    airdrop: refs.airdropId ? ledger.airdrops.find((item) => item.id === refs.airdropId) || null : null,
    automation: refs.automationId ? ledger.automations.find((item) => item.id === refs.automationId) || null : null,
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
    automation: related.automation,
    approval: related.approval,
    action: related.defiAction,
    proposal: related.proposal,
    job: related.job,
    narrative: command.narrative || command.result?.narrative || null
  };
}

function commandMonitorTarget(command) {
  const refs = command.resultRefs || {};
  if (refs.defiActionId) return { kind: "defi_action", id: refs.defiActionId };
  if (refs.paymentId) return { kind: "payment", id: refs.paymentId };
  if (refs.proposalId) return { kind: "perp_proposal", id: refs.proposalId };
  return null;
}

function buildXCommandFinalReply(command, monitor, { publicUrl } = {}) {
  if (!monitor) return null;
  const status = monitor.lifecycle || monitor.status || "unknown";
  const tx = monitor.txHash ? ` Tx: ${monitor.txHash}` : "";
  const reason = monitor.reason ? ` Reason: ${monitor.reason}` : "";
  const receipt = publicUrl ? ` Receipt: ${publicUrl}` : "";
  if (monitor.terminal) {
    return `Final status for ${command.id}: ${status}.${tx}${reason}${receipt}`.trim();
  }
  return `Update for ${command.id}: ${status}. I am still monitoring this action.${tx}${reason}${receipt}`.trim();
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

  const approval = ledger.approvals.find((item) => item.id === approvalId);
  const token = approval ? createApprovalToken({ approval, commandId: command.id }) : null;
  const suffix = token ? `?approvalToken=${encodeURIComponent(token)}` : "";
  return `${protocol}://${host}/x/commands/${encodeURIComponent(command.id)}/approve${suffix}`;
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
