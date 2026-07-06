import { ledger } from "./fixtures.js";
import { runJob } from "./jobs.js";
import { getPaymentReceipt } from "./queries.js";
import { getDefiActionReceipt } from "./defiOrchestrator.js";
import { buildExecutionTruth } from "./executionTruth.js";

const FINAL_STATES = new Set(["settled", "failed", "expired", "rejected", "claimable", "claimed", "execution_not_enabled", "user_wallet_signing_required"]);

export async function refreshExecutionMonitor({
  kind,
  id,
  host,
  protocol = "http",
  runWorker = false
} = {}) {
  if (kind === "payment") {
    return refreshPaymentMonitor({ paymentId: id, runWorker });
  }
  if (kind === "defi_action") {
    return refreshDefiMonitor({ actionId: id, host, protocol, runWorker });
  }
  if (kind === "perp_proposal") {
    return refreshPerpMonitor({ proposalId: id, runWorker });
  }
  throw new Error(`Unsupported execution monitor kind: ${kind || "unknown"}`);
}

export function buildExecutionMonitorSnapshot({ kind, id, host, protocol = "http" } = {}) {
  if (kind === "payment") return paymentMonitorSnapshot({ paymentId: id });
  if (kind === "defi_action") return defiMonitorSnapshot({ actionId: id, host, protocol });
  if (kind === "perp_proposal") return perpMonitorSnapshot({ proposalId: id });
  return null;
}

export function executionMonitorFromAgentResult({ result = {}, execution = {}, host, protocol = "http" } = {}) {
  const paymentId = execution.ids?.paymentId || result.payment?.id || null;
  if (paymentId) return buildExecutionMonitorSnapshot({ kind: "payment", id: paymentId, host, protocol });

  const actionId = execution.ids?.actionId || result.action?.id || result.receipt?.action?.id || null;
  if (actionId) return buildExecutionMonitorSnapshot({ kind: "defi_action", id: actionId, host, protocol });

  const proposalId = execution.ids?.proposalId || result.proposal?.id || null;
  if (proposalId) return buildExecutionMonitorSnapshot({ kind: "perp_proposal", id: proposalId, host, protocol });

  return null;
}

async function refreshPaymentMonitor({ paymentId, runWorker }) {
  const payment = ledger.payments.find((item) => item.id === paymentId);
  if (!payment) throw new Error("Payment not found");
  const job = payment.transferJobId ? ledger.jobs.find((item) => item.id === payment.transferJobId) || null : null;
  let worker = null;
  if (runWorker && job?.status === "queued") {
    worker = await runJob({ jobId: job.id });
  }
  return {
    ok: true,
    monitor: paymentMonitorSnapshot({ paymentId, worker }),
    receipt: getPaymentReceipt({ paymentId }).receipt,
    worker
  };
}

async function refreshDefiMonitor({ actionId, host, protocol, runWorker }) {
  const action = ledger.defiActions.find((item) => item.id === actionId);
  if (!action) throw new Error("DeFi action not found");
  let worker = null;
  const executionJob = action.executionJobId ? ledger.jobs.find((item) => item.id === action.executionJobId) || null : null;
  if (runWorker && executionJob?.status === "queued") {
    worker = await runJob({ jobId: executionJob.id });
  }

  const updated = ledger.defiActions.find((item) => item.id === actionId) || action;
  const reconcileJob = updated.reconcileJobId ? ledger.jobs.find((item) => item.id === updated.reconcileJobId) || null : null;
  if (runWorker && updated.status === "submitted" && reconcileJob?.status === "queued" && isJobDue(reconcileJob)) {
    worker = await runJob({ jobId: reconcileJob.id });
  }

  const receipt = getDefiActionReceipt({ actionId, host, protocol }).receipt;
  return {
    ok: true,
    monitor: defiMonitorSnapshot({ actionId, host, protocol }),
    receipt,
    worker
  };
}

async function refreshPerpMonitor({ proposalId, runWorker }) {
  const proposal = ledger.perpProposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error("Perp proposal not found");
  const jobId = proposal.execution?.jobId || proposal.jobId || null;
  const job = jobId ? ledger.jobs.find((item) => item.id === jobId) || null : null;
  let worker = null;
  if (runWorker && job?.status === "queued") {
    worker = await runJob({ jobId: job.id });
  }
  return {
    ok: true,
    monitor: perpMonitorSnapshot({ proposalId, worker }),
    worker
  };
}

function paymentMonitorSnapshot({ paymentId, worker = null }) {
  const payment = ledger.payments.find((item) => item.id === paymentId);
  if (!payment) throw new Error("Payment not found");
  const job = payment.transferJobId ? ledger.jobs.find((item) => item.id === payment.transferJobId) || null : null;
  const status = lifecycleForPayment(payment, job);
  return commonMonitor({
    kind: "payment",
    id: payment.id,
    handle: payment.senderHandle,
    status,
    rawStatus: payment.status,
    amount: payment.amount,
    asset: payment.asset || "USDC",
    route: payment.recipientHandle ? `${payment.amount} ${payment.asset || "USDC"} to ${payment.recipientHandle}` : null,
    txHash: payment.transfer?.txHash || null,
    explorerUrl: payment.transfer?.explorerUrl || null,
    reason: payment.failureReason || payment.transfer?.failureReason || job?.lastError || null,
    nextAction: nextActionForStatus(status, "payment"),
    job,
    worker
  });
}

function defiMonitorSnapshot({ actionId, host, protocol }) {
  const receipt = getDefiActionReceipt({ actionId, host, protocol }).receipt;
  const action = receipt.action;
  const job = receipt.executionJob || null;
  const status = lifecycleForDefi(action, job);
  return commonMonitor({
    kind: "defi_action",
    id: action.id,
    handle: action.handle,
    status,
    rawStatus: action.status,
    actionType: action.type,
    amount: action.request?.amountUsd || action.request?.amount,
    asset: action.request?.fromToken || action.request?.asset,
    route: routeForDefiAction(action),
    txHash: receipt.txHash || action.txHash || action.execution?.txHash || null,
    explorerUrl: receipt.explorerUrl || action.explorerUrl || action.execution?.explorerUrl || null,
    reason: action.failureReason || action.reason || action.execution?.reason || job?.lastError || null,
    nextAction: receipt.nextAction || nextActionForStatus(status, "defi_action"),
    job,
    receiptUrl: receipt.publicUrl || null,
    timeline: receipt.timeline || []
  });
}

function perpMonitorSnapshot({ proposalId, worker = null }) {
  const proposal = ledger.perpProposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error("Perp proposal not found");
  const jobId = proposal.execution?.jobId || proposal.jobId || null;
  const job = jobId ? ledger.jobs.find((item) => item.id === jobId) || null : null;
  const status = lifecycleForPerp(proposal, job);
  return commonMonitor({
    kind: "perp_proposal",
    id: proposal.id,
    handle: proposal.handle,
    status,
    rawStatus: proposal.status,
    actionType: "perp",
    amount: proposal.collateralUsd,
    asset: proposal.symbol,
    route: `${proposal.side || "perp"} ${proposal.symbol || "market"}${proposal.leverage ? ` ${proposal.leverage}x` : ""}`,
    txHash: proposal.txHash || proposal.execution?.txHash || null,
    explorerUrl: proposal.execution?.explorerUrl || null,
    reason: proposal.failureReason || proposal.execution?.reason || job?.lastError || null,
    nextAction: nextActionForStatus(status, "perp_proposal"),
    job,
    worker
  });
}

function commonMonitor({ kind, id, handle, status, rawStatus, actionType, amount, asset, route, txHash, explorerUrl, reason, nextAction, job, worker, receiptUrl, timeline = [] }) {
  const truth = buildExecutionTruth({
    kind,
    status,
    rawStatus,
    actionType,
    amount,
    asset,
    route,
    txHash,
    explorerUrl,
    reason,
    nextAction,
    job,
    receiptUrl,
    handle,
    terminal: FINAL_STATES.has(status)
  });
  return {
    kind,
    id,
    handle,
    lifecycle: status,
    status,
    rawStatus,
    terminal: FINAL_STATES.has(status),
    txHash,
    explorerUrl,
    receiptUrl,
    reason,
    nextAction,
    truth,
    job: job ? publicJob(job) : null,
    worker: worker ? summarizeWorker(worker) : null,
    timeline,
    updatedAt: new Date().toISOString()
  };
}

function routeForDefiAction(action = {}) {
  const request = action.request || {};
  const amount = request.amountUsd || request.amount || "some";
  const fromToken = request.fromToken || request.asset || "USDC";
  if (action.type === "bridge" || (request.fromRail && request.toRail && request.fromRail !== request.toRail)) {
    return `${amount} ${fromToken} from ${humanRail(request.fromRail || request.settlementRail)} to ${humanRail(request.toRail)}`;
  }
  if (request.toToken) return `${amount} ${fromToken} to ${request.toToken} on ${humanRail(request.fromRail || request.settlementRail)}`;
  return null;
}

function humanRail(rail) {
  const value = String(rail || "").toLowerCase();
  if (value === "arc" || value === "arc-testnet") return "Arc";
  if (value === "base" || value === "base-sepolia") return "Base Sepolia";
  return rail || "Arc";
}

function lifecycleForPayment(payment, job) {
  const status = String(payment.status || "").toLowerCase();
  if (status === "settled" || status === "claimed") return "settled";
  if (status === "failed") return "failed";
  if (status === "expired") return "expired";
  if (status === "requires_confirmation") return "needs_user_signature";
  if (status === "claimable") return "claimable";
  if (job?.status === "queued" || status === "queued") return "queued";
  if (job?.status === "running" || payment.providerStatus === "submitted") return "submitted";
  return status || "planned";
}

function lifecycleForDefi(action, job) {
  const status = String(action.status || "").toLowerCase();
  if (status === "settled") return "settled";
  if (status === "failed" || status === "rejected" || status === "quote_unavailable") return "failed";
  if (status === "execution_not_enabled") return "execution_not_enabled";
  if (status === "requires_confirmation") return "needs_user_signature";
  if (status === "submitted") return "submitted";
  if (job?.status === "queued" || status === "confirmed") return "queued";
  if (status === "quoted") return "quoted";
  return status || "planned";
}

function lifecycleForPerp(proposal, job) {
  const status = String(proposal.status || "").toLowerCase();
  if (status === "submitted" || status === "settled") return status;
  if (status === "user_wallet_signing_required") return "needs_user_signature";
  if (status === "execution_not_enabled" || status === "execution_failed") return "failed";
  if (status === "requires_confirmation") return "needs_user_signature";
  if (job?.status === "queued" || status === "confirmed") return "queued";
  return status || "planned";
}

function nextActionForStatus(status, kind) {
  if (status === "queued" || status === "submitted") return "refresh_execution_monitor";
  if (status === "needs_user_signature") return "approve_or_connect_user_wallet";
  if (status === "failed") return `inspect_${kind}_failure`;
  if (status === "settled" || status === "claimable" || status === "expired") return "none";
  if (status === "execution_not_enabled") return "enable_live_execution_or_check_provider";
  return "review";
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    lastError: job.lastError,
    updatedAt: job.updatedAt
  };
}

function summarizeWorker(worker) {
  return {
    ok: worker.ok !== false,
    skipped: Boolean(worker.skipped),
    status: worker.status || worker.result?.status || worker.job?.status || null,
    error: worker.error || null,
    jobId: worker.job?.id || null
  };
}

function isJobDue(job) {
  return !job.runAfter || new Date(job.runAfter).getTime() <= Date.now();
}
