import { ledger, users } from "./fixtures.js";
import { nextEventId } from "./ids.js";
import { executeArcPerpProposalWithUserWallet, getArcPerpsReadiness } from "./arcPerpsEngine.js";
import { submitDefiActionExecution, syncDefiActionExecutionStatus } from "./defiExecution.js";
import { submitPaymentTransfer } from "./transferProvider.js";
import { userWalletSigningRequired } from "./signerPolicy.js";
import { syncWalletBalances } from "./walletAccounts.js";

const MAX_ATTEMPTS = 5;

export function enqueueJob({ type, payload, runAfter = new Date().toISOString(), idempotencyKey }) {
  const existing = idempotencyKey
    ? ledger.jobs.find((job) => job.idempotencyKey === idempotencyKey && ["queued", "running"].includes(job.status))
    : null;

  if (existing) {
    return existing;
  }

  const job = {
    id: `job_${String(ledger.jobs.length + 1).padStart(4, "0")}`,
    type,
    status: "queued",
    payload,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    runAfter,
    idempotencyKey: idempotencyKey || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null
  };
  ledger.jobs.push(job);

  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type: "job_queued",
    jobId: job.id,
    jobType: job.type,
    paymentId: job.payload?.paymentId || null
  });

  return job;
}

export function listJobs({ status, type, limit = 50 } = {}) {
  const jobs = ledger.jobs
    .filter((job) => (
      (!status || job.status === status)
      && (!type || job.type === type)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);

  return { ok: true, jobs };
}

export async function runDueJobs({ limit = 20 } = {}) {
  const now = Date.now();
  const due = ledger.jobs
    .filter((job) => job.status === "queued" && new Date(job.runAfter).getTime() <= now)
    .slice(0, Number(limit) || 20);
  const results = [];

  for (const job of due) {
    results.push(await runJob({ jobId: job.id }));
  }

  return { ok: true, ran: results };
}

export async function runJob({ jobId }) {
  const job = ledger.jobs.find((item) => item.id === jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  if (job.status === "succeeded") {
    return { ok: true, job, skipped: true };
  }

  job.status = "running";
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
  job.startedAt = new Date().toISOString();

  try {
    const result = await executeJob(job);
    job.status = "succeeded";
    job.result = result;
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    job.lastError = null;
    ledger.events.push({
      id: nextEventId(),
      at: new Date().toISOString(),
      type: "job_succeeded",
      jobId: job.id,
      jobType: job.type,
      paymentId: job.payload?.paymentId || null
    });
    return { ok: true, job, result };
  } catch (error) {
    job.lastError = error.message;
    job.status = job.attempts >= job.maxAttempts ? "failed" : "queued";
    job.runAfter = new Date(Date.now() + backoffMs(job.attempts)).toISOString();
    job.updatedAt = new Date().toISOString();
    ledger.events.push({
      id: nextEventId(),
      at: new Date().toISOString(),
      type: "job_failed",
      jobId: job.id,
      jobType: job.type,
      paymentId: job.payload?.paymentId || null,
      error: error.message,
      status: job.status
    });
    return { ok: false, job, error: error.message };
  }
}

async function executeJob(job) {
  if (job.type === "submit_transfer") {
    return await submitTransferJob(job);
  }

  if (job.type === "retry_transfer") {
    return await submitTransferJob(job, { force: true });
  }

  if (job.type === "expire_claim") {
    return expireClaim(job.payload);
  }

  if (job.type === "refresh_x_token") {
    return { ok: true, skipped: true, reason: "Token refresh provider not enabled in mock mode" };
  }

  if (job.type === "sync_circle_transfer") {
    return { ok: true, skipped: true, reason: "Circle polling is provider-specific; webhook reconciliation is active" };
  }

  if (job.type === "execute_defi_action") {
    return executeDefiActionJob(job.payload);
  }

  if (job.type === "reconcile_defi_action") {
    return reconcileDefiActionJob(job.payload);
  }

  if (job.type === "execute_perp_proposal") {
    return await executePerpProposalJob(job.payload);
  }

  throw new Error(`Unknown job type: ${job.type}`);
}

async function submitTransferJob(job, { force = false } = {}) {
  const payment = ledger.payments.find((item) => item.id === job.payload.paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  const transfer = await submitPaymentTransfer({ payment, force });
  if (payment.status === "settled" || payment.status === "claimed") {
    settleWalletMovementForJob(payment);
  }

  return {
    ok: true,
    paymentId: payment.id,
    status: payment.status,
    transfer
  };
}

function expireClaim({ paymentId }) {
  const claim = ledger.claims.find((item) => item.paymentId === paymentId);
  if (!claim || claim.status !== "unclaimed") {
    return { ok: true, skipped: true };
  }

  if (new Date(claim.expiresAt).getTime() > Date.now()) {
    return { ok: true, skipped: true, reason: "Claim has not expired" };
  }

  claim.status = "expired";
  claim.expiredAt = new Date().toISOString();
  const payment = ledger.payments.find((item) => item.id === paymentId);
  if (payment?.status === "claimable") {
    payment.status = "expired";
  }

  return { ok: true, claim };
}

async function executeDefiActionJob({ actionId }) {
  const action = ledger.defiActions.find((item) => item.id === actionId);
  if (!action) {
    throw new Error("DeFi action not found");
  }

  if (action.status !== "confirmed") {
    return { ok: true, skipped: true, actionId, status: action.status };
  }

  action.signer ||= userWalletSigningRequired({
    operation: action.type,
    settlementRail: action.request?.fromRail,
    reason: "Confirmed DeFi action is waiting for a user-owned signing adapter."
  });
  const execution = await submitDefiActionExecution({ action });
  action.execution = execution;
  action.status = execution.ok ? execution.status : execution.status;
  action.completedAt = new Date().toISOString();
  if (execution.ok && ["submitted", "settled"].includes(action.status)) {
    await syncBalancesForDefiAction(action, "post_execution");
  }
  if (execution.ok && action.status === "submitted") {
    const reconcileJob = enqueueJob({
      type: "reconcile_defi_action",
      payload: { actionId: action.id },
      runAfter: new Date(Date.now() + 15_000).toISOString(),
      idempotencyKey: `reconcile_defi_action:${action.id}:initial`
    });
    action.reconcileJobId = reconcileJob.id;
    action.nextAction = "reconcile_defi_action";
  }

  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type: execution.ok ? "defi_action_execution_submitted" : "defi_action_execution_blocked",
    defiActionId: action.id,
    handle: action.handle,
    protocol: action.protocol,
    actionType: action.type,
    status: action.status,
    reason: execution.reason || null
  });

  return {
    ok: true,
    skipped: !execution.ok,
    actionId,
    status: action.status,
    execution,
    reconcileJobId: action.reconcileJobId || null
  };
}

async function reconcileDefiActionJob({ actionId }) {
  const action = ledger.defiActions.find((item) => item.id === actionId);
  if (!action) {
    throw new Error("DeFi action not found");
  }

  if (!["submitted", "settled", "failed"].includes(action.status)) {
    return { ok: true, skipped: true, actionId, status: action.status };
  }

  if (action.status === "settled" || action.status === "failed") {
    return { ok: true, skipped: true, actionId, status: action.status };
  }

  const execution = await syncDefiActionExecutionStatus({ action });
  action.execution = execution.ok ? execution : { ...action.execution, lastReconcile: execution };
  action.status = execution.ok ? execution.status : action.status;
  action.reconciledAt = new Date().toISOString();
  if (execution.ok && execution.txHash) {
    action.txHash = execution.txHash;
  }
  if (action.status === "settled") {
    action.settledAt = new Date().toISOString();
    action.nextAction = "none";
    await syncBalancesForDefiAction(action, "post_reconcile_settled");
  } else if (action.status === "failed") {
    action.failedAt = new Date().toISOString();
    action.failureReason = execution.submissions?.find((item) => item.errorReason)?.errorReason || "DeFi execution failed";
    action.nextAction = "review_failed_execution";
  } else if (execution.ok) {
    const followup = enqueueJob({
      type: "reconcile_defi_action",
      payload: { actionId: action.id },
      runAfter: new Date(Date.now() + 30_000).toISOString(),
      idempotencyKey: `reconcile_defi_action:${action.id}:${Date.now()}`
    });
    action.reconcileJobId = followup.id;
    action.nextAction = "reconcile_defi_action";
  }

  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type: "defi_action_reconciled",
    defiActionId: action.id,
    handle: action.handle,
    protocol: action.protocol,
    actionType: action.type,
    status: action.status,
    txHash: action.txHash || execution.txHash || null,
    reason: execution.reason || action.failureReason || null
  });

  return {
    ok: true,
    skipped: !execution.ok,
    actionId,
    status: action.status,
    execution
  };
}

async function syncBalancesForDefiAction(action, reason) {
  try {
    const synced = await syncWalletBalances({ handle: action.handle });
    action.balanceSync = {
      ok: true,
      reason,
      syncedAt: new Date().toISOString(),
      rails: synced.synced?.map((item) => ({
        rail: item.rail,
        amount: item.amount
      })) || []
    };
    ledger.events.push({
      id: nextEventId(),
      at: action.balanceSync.syncedAt,
      type: "defi_wallet_balances_synced",
      defiActionId: action.id,
      handle: action.handle,
      actionType: action.type,
      status: action.status,
      reason
    });
    return synced;
  } catch (error) {
    action.balanceSync = {
      ok: false,
      reason,
      syncedAt: new Date().toISOString(),
      error: error.message
    };
    ledger.events.push({
      id: nextEventId(),
      at: action.balanceSync.syncedAt,
      type: "defi_wallet_balance_sync_failed",
      defiActionId: action.id,
      handle: action.handle,
      actionType: action.type,
      status: action.status,
      reason,
      error: error.message
    });
    return null;
  }
}

async function executePerpProposalJob({ proposalId }) {
  const proposal = ledger.perpProposals.find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error("Perp proposal not found");
  }

  if (proposal.status !== "confirmed") {
    return { ok: true, skipped: true, proposalId, status: proposal.status };
  }

  if (proposal.settlementRail !== "arc-testnet") {
    proposal.status = "execution_not_enabled";
    proposal.execution = {
      mode: "skipped",
      reason: `ArcPerps execution only supports arc-testnet, received ${proposal.settlementRail}`
    };
    return { ok: true, skipped: true, proposalId, status: proposal.status };
  }

  const readiness = getArcPerpsReadiness();
  if (!readiness.userWalletExecutionReady) {
    proposal.status = "user_wallet_signing_required";
    proposal.execution = {
      mode: "locked",
      backendSignerAllowed: false,
      reason: readiness.ok
        ? "Perp proposals are ready for Circle user-wallet execution, but ARC_PERPS_EXECUTION_ENABLED is not enabled."
        : `ArcPerps is missing: ${readiness.missing.filter((item) => item !== "ARC_SETTLEMENT_PRIVATE_KEY").join(", ") || "Circle user wallet execution"}`
    };
    proposal.signer ||= userWalletSigningRequired({
      operation: "open_perp_position",
      settlementRail: proposal.settlementRail,
      reason: proposal.execution.reason
    });
    ledger.events.push({
      id: nextEventId(),
      at: new Date().toISOString(),
      type: "perp_proposal_user_wallet_required",
      proposalId: proposal.id,
      handle: proposal.handle,
      reason: proposal.execution.reason
    });

    return { ok: true, skipped: true, proposalId, status: proposal.status, execution: proposal.execution };
  }

  const execution = await executeArcPerpProposalWithUserWallet({ proposal });
  proposal.execution = execution;
  proposal.status = execution.ok ? "submitted" : execution.status || "execution_failed";
  if (execution.positionId) proposal.positionId = execution.positionId;
  if (execution.txHash) proposal.txHash = execution.txHash;
  proposal.executedAt = new Date().toISOString();
  ledger.events.push({
    id: nextEventId(),
    at: proposal.executedAt,
    type: execution.ok ? "perp_position_open_submitted" : "perp_position_open_blocked",
    proposalId: proposal.id,
    handle: proposal.handle,
    positionId: proposal.positionId || null,
    txHash: proposal.txHash || null,
    reason: execution.reason || null
  });

  return { ok: true, skipped: !execution.ok, proposalId, status: proposal.status, execution };
}

function settleWalletMovementForJob(payment) {
  if (payment.debited && payment.credited) {
    return;
  }

  const sender = users.get(payment.senderHandle);
  const recipient = users.get(payment.recipientHandle);
  const amount = Number(payment.amount || 0);
  const rail = payment.settlementRail || "arc-testnet";

  if (sender && !payment.debited) {
    sender.balances ||= {};
    sender.balances[rail] = round(Number(sender.balances[rail] || 0) - amount);
    sender.balance = total(sender.balances);
    payment.debited = true;
    payment.senderBalanceAfter = sender.balances[rail];
  }

  if (recipient && recipient.onboarded && !payment.credited) {
    recipient.balances ||= {};
    recipient.balances[rail] = round(Number(recipient.balances[rail] || 0) + amount);
    recipient.balance = total(recipient.balances);
    payment.credited = true;
    payment.recipientBalanceAfter = recipient.balances[rail];
  }
}

function round(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function total(balances) {
  return round(Object.values(balances || {}).reduce((sum, value) => sum + Number(value || 0), 0));
}

function backoffMs(attempts) {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
}
