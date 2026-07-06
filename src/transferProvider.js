import { createHmac, randomUUID, timingSafeEqual, verify } from "node:crypto";
import { circleErrorMessage, getCircleDeveloperClient } from "./circleSdk.js";
import { config } from "./config.js";
import { users } from "./fixtures.js";
import { nextEventId } from "./ids.js";
import { getSettlementRail } from "./settlement.js";

const terminalCircleStates = new Set(["CONFIRMED", "COMPLETE", "COMPLETED", "FAILED", "CANCELLED"]);

export async function submitPaymentTransfer({ payment, force = false }) {
  if (!payment.walletInstruction) {
    return null;
  }

  if (payment.transfer && !force) {
    return payment.transfer || null;
  }

  if (force) {
    payment.transferRetries = Number(payment.transferRetries || 0) + 1;
    payment.transfer = null;
    payment.providerStatus = null;
    payment.providerIdempotencyKey = null;
  }

  const transfer = await submitTransferForConfiguredProvider({ payment });

  payment.transfer = transfer;
  payment.providerStatus = transfer.status;

  if (transfer.status === "settled") {
    payment.status = payment.status === "claimed" ? "claimed" : "settled";
    payment.settledAt ||= new Date().toISOString();
  } else if (transfer.status === "failed") {
    payment.status = "failed";
    payment.failedAt = new Date().toISOString();
    payment.failureReason = transfer.failureReason || "Transfer failed";
  } else {
    payment.status = "submitted";
    payment.submittedAt = new Date().toISOString();
  }

  return transfer;
}

async function submitTransferForConfiguredProvider({ payment }) {
  if (config.transferProvider === "mock") {
    return submitMockCircleTransfer({ payment });
  }

  if (["appkit", "arc-appkit", "circle-app-kit"].includes(config.transferProvider)) {
    throw new Error("TRANSFER_PROVIDER=arc-appkit is disabled for user payments because it uses a backend signer. Use TRANSFER_PROVIDER=circle for user-owned Circle wallet transfers.");
  }

  if (config.transferProvider === "circle") {
    return await submitRealCircleTransfer({ payment });
  }

  throw new Error(`Unsupported transfer provider: ${config.transferProvider}`);
}

export function reconcileCircleNotification({ ledger, notification }) {
  const tx = extractTransaction(notification);
  if (!tx?.id) {
    return {
      ok: false,
      reason: "No transaction id in Circle notification"
    };
  }

  const payment = ledger.payments.find((item) => item.transfer?.providerTransferId === tx.id);
  if (!payment) {
    ledger.events.push({
      id: nextEventId(),
      at: new Date().toISOString(),
      type: "circle_webhook_unmatched",
      providerTransferId: tx.id,
      status: tx.state || tx.status || "unknown"
    });
    return { ok: false, reason: "No matching payment", providerTransferId: tx.id };
  }

  const status = normalizeCircleStatus(tx.state || tx.status);
  payment.providerStatus = status;
  payment.transfer = {
    ...payment.transfer,
    rawStatus: tx.state || tx.status,
    status,
    txHash: tx.txHash || tx.transactionHash || payment.transfer?.txHash,
    updatedAt: new Date().toISOString()
  };

  if (status === "settled") {
    payment.status = payment.status === "claimed" ? "claimed" : "settled";
    payment.settledAt ||= new Date().toISOString();
    settleWalletMovement(payment);
  }

  if (status === "failed") {
    payment.status = "failed";
    payment.failedAt = new Date().toISOString();
    payment.failureReason = tx.errorReason || tx.errorCode || "Circle transfer failed";
  }

  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type: "circle_transfer_reconciled",
    paymentId: payment.id,
    providerTransferId: tx.id,
    status
  });

  return { ok: true, payment };
}

export async function verifyCircleWebhook({ headers, rawBody }) {
  if (config.circle.webhookPublicKeyBase64) {
    const signature = headers["x-circle-signature"];
    if (!signature) {
      throw new Error("Missing Circle webhook signature");
    }

    const publicKey = `-----BEGIN PUBLIC KEY-----\n${config.circle.webhookPublicKeyBase64}\n-----END PUBLIC KEY-----`;
    const valid = verify(
      "sha256",
      Buffer.from(rawBody),
      publicKey,
      Buffer.from(signature, "base64")
    );

    if (!valid) {
      throw new Error("Invalid Circle webhook signature");
    }

    return { ok: true, mode: "ecdsa-public-key" };
  }

  if (config.circle.webhookSecret) {
    const provided = headers["x-circle-signature"] || headers["circle-signature"];
    const expected = `sha256=${createHmac("sha256", config.circle.webhookSecret).update(rawBody).digest("hex")}`;
    if (!safeEqual(provided, expected)) {
      throw new Error("Invalid Circle webhook signature");
    }

    return { ok: true, mode: "hmac-sha256" };
  }

  return { ok: true, mode: "unsigned-demo" };
}

function settleWalletMovement(payment) {
  const sender = users.get(payment.senderHandle);
  const recipient = users.get(payment.recipientHandle);
  const amount = Number(payment.amount || 0);
  const rail = payment.settlementRail || "arc-testnet";

  if (sender && !payment.debited) {
    sender.balances ||= {};
    sender.balances[rail] = round(Number(sender.balances[rail] || 0) - amount);
    sender.balance = totalBalance(sender.balances);
    payment.debited = true;
    payment.senderBalanceAfter = sender.balances[rail];
  }

  if (recipient && recipient.onboarded && !payment.credited) {
    recipient.balances ||= {};
    recipient.balances[rail] = round(Number(recipient.balances[rail] || 0) + amount);
    recipient.balance = totalBalance(recipient.balances);
    payment.credited = true;
    payment.recipientBalanceAfter = recipient.balances[rail];
  }
}

function round(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function totalBalance(balances) {
  return round(Object.values(balances || {}).reduce((sum, value) => sum + Number(value || 0), 0));
}

function submitMockCircleTransfer({ payment }) {
  const txHash = payment.settlement?.txHash;
  return {
    provider: "circle",
    mode: "mock",
    providerTransferId: `circle_tx_${payment.id}`,
    refId: payment.id,
    status: "settled",
    rawStatus: "CONFIRMED",
    txHash,
    submittedAt: new Date().toISOString(),
    settledAt: new Date().toISOString()
  };
}

async function submitRealCircleTransfer({ payment }) {
  if (!config.circle.apiKey || !config.circle.entitySecret) {
    throw new Error("Circle real transfers require CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET");
  }

  const instruction = payment.walletInstruction;
  const rail = getSettlementRail(payment.settlementRail);
  const idempotencyKey = payment.providerIdempotencyKey || randomUUID();
  payment.providerIdempotencyKey = idempotencyKey;

  const input = {
    idempotencyKey,
    destinationAddress: instruction.to,
    amount: [String(payment.amount)],
    fee: {
      type: "level",
      config: {
        feeLevel: "MEDIUM"
      }
    },
    refId: payment.id,
    ...circleTokenInput(rail)
  };

  if (instruction.fromWalletId) {
    input.walletId = instruction.fromWalletId;
  } else {
    input.walletAddress = instruction.from;
    input.blockchain = rail.circleBlockchain;
  }

  let response;
  try {
    response = await getCircleDeveloperClient().createTransaction(input);
  } catch (error) {
    throw new Error(circleErrorMessage(error, "Circle transfer submission failed"));
  }

  const data = response.data || response;
  const transaction = data.transaction || data;
  const rawStatus = transaction.state || transaction.status || "SUBMITTED";

  return {
    provider: "circle",
    mode: "real",
    providerTransferId: transaction.id,
    refId: payment.id,
    status: normalizeCircleStatus(rawStatus),
    rawStatus,
    txHash: transaction.txHash || transaction.transactionHash || null,
    submittedAt: new Date().toISOString()
  };
}

function circleTokenInput(rail) {
  if (config.circle.usdcTokenId) {
    return { tokenId: config.circle.usdcTokenId };
  }

  if (!rail.usdcAddress) {
    throw new Error(`CIRCLE_USDC_TOKEN_ID is required for ${rail.id} because no USDC token address is configured for that rail`);
  }

  return {
    tokenAddress: rail.usdcAddress,
    blockchain: rail.circleBlockchain
  };
}

function normalizeCircleStatus(rawStatus = "") {
  const status = String(rawStatus).toUpperCase();

  if (["CONFIRMED", "COMPLETE", "COMPLETED"].includes(status)) {
    return "settled";
  }

  if (["FAILED", "CANCELLED"].includes(status)) {
    return "failed";
  }

  if (terminalCircleStates.has(status)) {
    return status.toLowerCase();
  }

  return "submitted";
}

function extractTransaction(notification) {
  return notification?.notification?.transaction
    || notification?.notification?.data
    || notification?.data?.transaction
    || notification?.data
    || notification?.transaction
    || notification;
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
