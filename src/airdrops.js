import { createApproval } from "./approvals.js";
import { ledger } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { nextAirdropId, nextEventId } from "./ids.js";
import { createPaymentIntent } from "./orchestrator.js";
import { evaluatePolicy } from "./policy.js";
import { selectSettlementRail } from "./settlement.js";
import { circleUserSigner } from "./signerPolicy.js";
import { readIdempotentResult, rememberIdempotentResult } from "./store.js";
import { normalizeAmount } from "./walletAccounts.js";
import { publicUrl } from "./publicUrls.js";

export async function createAirdrop({
  senderHandle,
  recipients = [],
  amount,
  amountPerRecipient,
  asset = "USDC",
  postId,
  rule = "fixed_recipients",
  maxRecipients,
  settlementRail,
  memo = "",
  source = "api",
  idempotencyKey
} = {}) {
  const replay = readIdempotentResult(idempotencyKey);
  if (replay) return { ...replay, idempotentReplay: true };

  const sender = resolveXHandle(senderHandle);
  const rail = selectSettlementRail({ preferred: settlementRail || "arc-testnet" });
  const normalizedRecipients = normalizeRecipients(recipients);
  const perRecipient = normalizeAmount(amountPerRecipient || amount);
  const recipientCap = normalizedRecipients.length || Number(maxRecipients || 0);

  if (asset !== "USDC") {
    return rememberIdempotentResult(idempotencyKey, {
      ok: false,
      status: "unsupported_asset",
      reason: "Airdrops are USDC-only until the Arc token-transfer adapter supports arbitrary assets.",
      nextAction: "use_usdc_or_build_token_airdrop_adapter"
    });
  }

  if (!recipientCap || recipientCap <= 0) {
    throw new Error("Airdrop requires recipients or maxRecipients");
  }

  const totalBudget = normalizeAmount(perRecipient * recipientCap);
  const policy = evaluatePolicy({
    sender,
    amount: totalBudget,
    asset,
    settlementRail: rail.id
  });

  const airdrop = {
    id: nextAirdropId(),
    source,
    senderHandle: sender.handle,
    senderXUserId: sender.xUserId,
    recipients: normalizedRecipients,
    winnerHandles: [],
    amountPerRecipient: perRecipient,
    maxRecipients: recipientCap,
    totalBudget,
    asset,
    postId: postId || null,
    rule: normalizedRecipients.length ? "fixed_recipients" : rule,
    memo,
    settlementRail: rail.id,
    status: "created",
    policy,
    signer: circleUserSigner({
      operation: "airdrop_usdc",
      settlementRail: rail.id,
      requiresUserApproval: policy.requiresConfirmation,
      executionStatus: policy.requiresConfirmation ? "requires_confirmation" : "policy_checked"
    }),
    distributions: [],
    createdAt: new Date().toISOString()
  };
  ledger.airdrops.push(airdrop);
  recordAirdropEvent("airdrop_created", airdrop);

  if (!policy.approved) {
    airdrop.status = "rejected";
    airdrop.reason = policy.reason;
    airdrop.completedAt = new Date().toISOString();
    recordAirdropEvent("airdrop_rejected", airdrop, { reason: policy.reason });
    return rememberIdempotentResult(idempotencyKey, {
      ok: false,
      airdrop,
      policy,
      reason: policy.reason,
      nextAction: "lower_amount_or_update_policy"
    });
  }

  if (policy.requiresConfirmation) {
    const approval = createApproval({
      handle: sender.handle,
      kind: "airdrop",
      targetId: airdrop.id,
      title: `Airdrop ${totalBudget} ${asset}`,
      summary: normalizedRecipients.length
        ? `Airdrop ${perRecipient} ${asset} each to ${normalizedRecipients.length} recipient(s).`
        : `Airdrop ${perRecipient} ${asset} each to the first ${recipientCap} qualifying X participant(s).`,
      risk: totalBudget > 25 ? "high" : "medium",
      metadata: {
        amountPerRecipient: perRecipient,
        maxRecipients: recipientCap,
        totalBudget,
        settlementRail: rail.id,
        postId: airdrop.postId,
        rule: airdrop.rule
      }
    });
    airdrop.approvalId = approval.id;
    airdrop.status = "requires_confirmation";
    airdrop.nextAction = "confirm_action";
    return rememberIdempotentResult(idempotencyKey, { ok: true, airdrop, approval, policy, nextAction: "confirm_action" });
  }

  if (normalizedRecipients.length) {
    return rememberIdempotentResult(idempotencyKey, await distributeAirdrop({
      airdrop,
      recipientHandles: normalizedRecipients,
      source
    }));
  }

  airdrop.status = "watching_replies";
  airdrop.nextAction = "award_airdrop";
  recordAirdropEvent("airdrop_watching_replies", airdrop);
  return rememberIdempotentResult(idempotencyKey, {
    ok: true,
    airdrop,
    policy,
    nextAction: "award_airdrop"
  });
}

export async function confirmAirdrop({ airdropId } = {}) {
  const airdrop = getAirdropById(airdropId);
  if (airdrop.status !== "requires_confirmation") {
    return { ok: true, airdrop, skipped: true };
  }

  airdrop.confirmedAt = new Date().toISOString();
  if (airdrop.recipients.length) {
    return await distributeAirdrop({
      airdrop,
      recipientHandles: airdrop.recipients,
      source: "airdrop_confirmation"
    });
  }

  airdrop.status = "watching_replies";
  airdrop.nextAction = "award_airdrop";
  recordAirdropEvent("airdrop_confirmed", airdrop);
  return { ok: true, airdrop, nextAction: "award_airdrop" };
}

export async function awardAirdrop({
  airdropId,
  winnerHandles = [],
  recipients = []
} = {}) {
  const airdrop = getAirdropById(airdropId);
  if (airdrop.status === "requires_confirmation") {
    throw new Error("Airdrop requires confirmation before recipients can be awarded");
  }
  if (!["watching_replies", "partial", "distributed", "created"].includes(airdrop.status)) {
    throw new Error(`Airdrop cannot award from status: ${airdrop.status}`);
  }

  const handles = normalizeRecipients(winnerHandles.length ? winnerHandles : recipients)
    .filter((handle) => !airdrop.winnerHandles.includes(handle));
  const remaining = Math.max(0, Number(airdrop.maxRecipients || 0) - airdrop.winnerHandles.length);
  const selected = handles.slice(0, remaining);
  if (!selected.length) {
    return { ok: true, airdrop, skipped: true, reason: "No new recipients or airdrop is full" };
  }

  return await distributeAirdrop({
    airdrop,
    recipientHandles: selected,
    source: "airdrop_award"
  });
}

export function listAirdrops({ handle, status, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const airdrops = (ledger.airdrops || [])
    .filter((airdrop) => (
      (!normalized || airdrop.senderHandle === normalized || airdrop.winnerHandles?.includes(normalized))
      && (!status || airdrop.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);

  return { ok: true, airdrops };
}

export function getAirdropReceipt({ airdropId, host, protocol = "http" } = {}) {
  const airdrop = getAirdropById(airdropId);
  const events = ledger.events.filter((event) => event.airdropId === airdrop.id);
  const approval = airdrop.approvalId
    ? ledger.approvals.find((item) => item.id === airdrop.approvalId) || null
    : null;

  return {
    ok: true,
    receipt: {
      airdrop,
      approval,
      payments: airdrop.distributions
        .map((distribution) => ledger.payments.find((payment) => payment.id === distribution.paymentId))
        .filter(Boolean),
      publicUrl: publicUrl(`/airdrops/${airdrop.id}`, { host, protocol }),
      timeline: events
        .map((event) => ({ type: event.type, at: event.at, label: event.type }))
        .filter((item) => item.at)
        .sort((a, b) => new Date(a.at) - new Date(b.at)),
      nextAction: nextActionForAirdrop(airdrop)
    }
  };
}

async function distributeAirdrop({ airdrop, recipientHandles, source }) {
  airdrop.status = "distributing";
  airdrop.distributionStartedAt ||= new Date().toISOString();
  recordAirdropEvent("airdrop_distribution_started", airdrop);

  const payments = [];
  for (const recipientHandle of recipientHandles) {
    const result = await createPaymentIntent({
      senderHandle: airdrop.senderHandle,
      recipientHandle,
      amount: airdrop.amountPerRecipient,
      asset: airdrop.asset,
      settlementRail: airdrop.settlementRail,
      memo: airdrop.memo || `airdrop:${airdrop.id}`,
      source,
      idempotencyKey: `${airdrop.id}:${recipientHandle}`
    });
    const distribution = {
      recipientHandle,
      ok: result.ok !== false,
      paymentId: result.payment?.id || null,
      status: result.payment?.status || result.event?.type || result.status || "unknown",
      reason: result.reason || result.event?.reason || null,
      createdAt: new Date().toISOString()
    };
    airdrop.distributions.push(distribution);
    if (!airdrop.winnerHandles.includes(recipientHandle)) {
      airdrop.winnerHandles.push(recipientHandle);
    }
    payments.push(result.payment || result);
    recordAirdropEvent("airdrop_distribution_created", airdrop, {
      recipientHandle,
      paymentId: distribution.paymentId,
      distributionStatus: distribution.status,
      reason: distribution.reason
    });
  }

  const failed = airdrop.distributions.filter((item) => item.ok === false);
  const full = airdrop.winnerHandles.length >= Number(airdrop.maxRecipients || 0);
  airdrop.status = failed.length ? "partial" : full || airdrop.recipients.length ? "distributed" : "watching_replies";
  airdrop.completedAt = airdrop.status === "distributed" ? new Date().toISOString() : null;
  airdrop.nextAction = nextActionForAirdrop(airdrop);
  recordAirdropEvent("airdrop_distribution_finished", airdrop);

  return {
    ok: failed.length === 0,
    airdrop,
    payments,
    nextAction: airdrop.nextAction
  };
}

function getAirdropById(airdropId) {
  const airdrop = (ledger.airdrops || []).find((item) => item.id === airdropId);
  if (!airdrop) throw new Error("Airdrop not found");
  return airdrop;
}

function normalizeRecipients(recipients = []) {
  const list = Array.isArray(recipients)
    ? recipients
    : String(recipients || "").split(/[,\s]+/);
  return Array.from(new Set(
    list
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .map(normalizeHandle)
  ));
}

function nextActionForAirdrop(airdrop) {
  if (airdrop.status === "requires_confirmation") return "confirm_action";
  if (airdrop.status === "watching_replies") return "award_airdrop";
  if (airdrop.status === "partial") return "review_failed_distributions";
  if (airdrop.status === "distributed") return "track_payment_receipts";
  return "none";
}

function recordAirdropEvent(type, airdrop, extra = {}) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    airdropId: airdrop.id,
    handle: airdrop.senderHandle,
    status: airdrop.status,
    ...extra
  });
}
