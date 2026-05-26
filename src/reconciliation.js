import { ledger } from "./fixtures.js";
import { enqueueJob } from "./jobs.js";
import { nextEventId } from "./ids.js";

export function listProviderWork({ status, limit = 50 } = {}) {
  const payments = ledger.payments
    .filter((payment) => (
      payment.walletInstruction
      && (!status || payment.status === status || payment.providerStatus === status)
      && ["queued", "submitted", "failed", "settled", "claimed"].includes(payment.status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50)
    .map((payment) => ({
      id: payment.id,
      status: payment.status,
      providerStatus: payment.providerStatus || null,
      transfer: payment.transfer || null,
      transferJobId: payment.transferJobId || null,
      transferRetries: payment.transferRetries || 0,
      settlementRail: payment.settlementRail,
      amount: payment.amount,
      asset: payment.asset,
      createdAt: payment.createdAt
    }));

  return { ok: true, payments };
}

export async function retryPaymentTransfer({ paymentId }) {
  const payment = ledger.payments.find((item) => item.id === paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  if (!payment.walletInstruction) {
    throw new Error("Payment has no transfer instruction");
  }

  payment.status = "queued";
  payment.providerStatus = "queued";
  payment.queuedAt = new Date().toISOString();
  const job = enqueueJob({
    type: "retry_transfer",
    payload: { paymentId },
    idempotencyKey: `retry_transfer:${paymentId}`
  });
  payment.transferJobId = job.id;

  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type: "transfer_retry_queued",
    paymentId,
    jobId: job.id
  });

  return {
    ok: true,
    payment,
    job
  };
}

export async function retryFailedTransfers({ limit = 20 } = {}) {
  const failed = ledger.payments
    .filter((payment) => payment.status === "failed" && payment.walletInstruction)
    .slice(0, Number(limit) || 20);
  const retried = [];

  for (const payment of failed) {
    retried.push(await retryPaymentTransfer({ paymentId: payment.id }));
  }

  return {
    ok: true,
    retried
  };
}
