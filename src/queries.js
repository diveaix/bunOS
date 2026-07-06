import { ledger, users } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { toWalletProfile } from "./walletAccounts.js";

export function resolveIdentity({ handle }) {
  const user = resolveXHandle(handle);
  const wallet = toWalletProfile(user);
  const pendingClaims = ledger.claims.filter((claim) => (
    claim.recipientXUserId === user.xUserId && claim.status === "unclaimed"
  ));

  return {
    ok: true,
    identity: {
      handle: user.handle,
      xUserId: user.xUserId,
      xConnected: Boolean(user.xOAuth?.connected),
      onboarded: Boolean(user.onboarded && user.walletAddress),
      wallet,
      pendingClaims: pendingClaims.length
    }
  };
}

export function listPayments({ handle, status, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const payments = ledger.payments
    .filter((payment) => (
      (!normalized || payment.senderHandle === normalized || payment.recipientHandle === normalized)
      && (!status || payment.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50)
    .map(toPaymentSummary);

  return { ok: true, payments };
}

export function getPaymentReceipt({ paymentId }) {
  const payment = ledger.payments.find((item) => item.id === paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  const claim = ledger.claims.find((item) => item.paymentId === paymentId) || null;
  const events = ledger.events.filter((event) => event.paymentId === paymentId);

  return {
    ok: true,
    receipt: {
      payment,
      claim,
      transfer: payment.transfer || null,
      timeline: buildTimeline(payment, claim, events),
      nextAction: nextActionFor(payment, claim)
    }
  };
}

export function listClaims({ handle, status, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const user = normalized ? users.get(normalized) : null;
  const claims = ledger.claims
    .filter((claim) => (
      (!normalized || claim.recipientHandle === normalized || claim.recipientXUserId === user?.xUserId)
      && (!status || claim.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50)
    .map((claim) => ({
      ...claim,
      payment: ledger.payments.find((payment) => payment.id === claim.paymentId) || null
    }));

  return { ok: true, claims };
}

export function getOperations({ limit = 50 } = {}) {
  return {
    ok: true,
    events: ledger.events.slice().reverse().slice(0, Number(limit) || 50),
    jobs: ledger.jobs.slice().reverse().slice(0, Number(limit) || 50),
    xWebhooks: ledger.xWebhooks.slice().reverse().slice(0, Number(limit) || 50),
    circleWebhooks: ledger.circleWebhooks.slice().reverse().slice(0, Number(limit) || 50),
    funding: ledger.funding.slice().reverse().slice(0, Number(limit) || 50),
    bridges: ledger.bridges.slice().reverse().slice(0, Number(limit) || 50),
    defiActions: ledger.defiActions.slice().reverse().slice(0, Number(limit) || 50),
    airdrops: ledger.airdrops.slice().reverse().slice(0, Number(limit) || 50)
  };
}

function toPaymentSummary(payment) {
  return {
    id: payment.id,
    source: payment.source,
    kind: payment.kind || "payment",
    senderHandle: payment.senderHandle,
    recipientHandle: payment.recipientHandle,
    amount: payment.amount,
    asset: payment.asset,
    status: payment.status,
    settlementRail: payment.settlementRail,
    transferStatus: payment.transfer?.status || payment.providerStatus || null,
    transferJobId: payment.transferJobId || null,
    createdAt: payment.createdAt,
    memo: payment.memo || ""
  };
}

function buildTimeline(payment, claim, events) {
  const timeline = [
    {
      type: "created",
      at: payment.createdAt,
      label: "Payment created"
    }
  ];

  if (payment.submittedAt) {
    timeline.push({ type: "submitted", at: payment.submittedAt, label: "Transfer submitted" });
  }

  if (payment.queuedAt) {
    timeline.push({ type: "queued", at: payment.queuedAt, label: "Transfer queued" });
  }

  if (payment.settledAt) {
    timeline.push({ type: "settled", at: payment.settledAt, label: "Transfer settled" });
  }

  if (claim?.claimedAt || payment.claimedAt) {
    timeline.push({ type: "claimed", at: claim?.claimedAt || payment.claimedAt, label: "Claim completed" });
  }

  if (payment.failedAt) {
    timeline.push({ type: "failed", at: payment.failedAt, label: payment.failureReason || "Payment failed" });
  }

  for (const event of events) {
    timeline.push({ type: event.type, at: event.at, label: event.type });
  }

  return timeline
    .filter((item) => item.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function nextActionFor(payment, claim) {
  if (payment.status === "requires_confirmation") {
    return "confirm_payment";
  }

  if (payment.status === "claimable" && claim?.status === "unclaimed") {
    return "recipient_connect_x";
  }

  if (payment.status === "queued") {
    return "run_transfer_worker";
  }

  if (payment.status === "submitted") {
    return "await_circle_webhook";
  }

  if (payment.status === "failed") {
    return "retry_transfer";
  }

  return "none";
}
