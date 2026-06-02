import { completeApproval, getApproval } from "./approvals.js";
import { confirmAirdrop } from "./airdrops.js";
import { confirmDefiAction } from "./defiOrchestrator.js";
import { confirmPayment } from "./orchestrator.js";
import { confirmPerpProposal } from "./perpsAgent.js";
import { confirmCopyTradeProposal } from "./socialTradingAgent.js";
import { runJob } from "./jobs.js";
import {
  acquireSpendLock,
  assertNoBackendSignerSpend,
  completeSpendLock
} from "./securityGuards.js";

export async function confirmAction({ approvalId, handle } = {}) {
  const approval = getApproval(approvalId);
  if (handle && approval.handle !== normalizeHandleLocal(handle)) {
    throw new Error("Approval does not belong to this handle");
  }

  if (approval.status === "approved") {
    const result = approval.result || null;
    if (result?.job?.id) {
      result.worker = await runJob({ jobId: result.job.id });
    }
    if (result) result.executionSummary = summarizeApprovalExecution({ approval, result });
    return {
      ok: true,
      approval,
      result,
      skipped: true
    };
  }

  if (approval.status !== "pending") {
    throw new Error(`Approval cannot be confirmed from status: ${approval.status}`);
  }

  const spendLock = acquireSpendLock({
    handle: approval.handle,
    operation: `confirm_${approval.kind}`,
    targetId: approval.targetId,
    idempotencyKey: approval.id
  });
  if (!spendLock.ok) {
    return { ok: true, approval, skipped: true, replayRejected: true, lock: spendLock.lock };
  }

  let result;
  try {
    if (approval.kind === "payment") {
      result = await confirmPayment({ paymentId: approval.targetId });
    } else if (approval.kind === "defi_action") {
      result = await confirmDefiAction({ actionId: approval.targetId, handle: approval.handle });
    } else if (approval.kind === "copy_trade") {
      result = confirmCopyTradeProposal({ proposalId: approval.targetId });
    } else if (approval.kind === "perp_trade") {
      result = confirmPerpProposal({ proposalId: approval.targetId });
    } else if (approval.kind === "airdrop") {
      result = await confirmAirdrop({ airdropId: approval.targetId });
    } else {
      throw new Error(`Unsupported approval kind: ${approval.kind}`);
    }
    if (result?.job?.id) {
      result.worker = await runJob({ jobId: result.job.id });
    }
    result.executionSummary = summarizeApprovalExecution({ approval, result });
    assertNoBackendSignerSpend(result, { handle: approval.handle, tool: `confirm_${approval.kind}` });
    completeSpendLock({ lock: spendLock.lock, status: "completed", result });
  } catch (error) {
    completeSpendLock({ lock: spendLock.lock, status: "failed", result: { ok: false, status: "failed" } });
    throw error;
  }

  const completed = completeApproval({ approvalId, status: "approved", result });
  return { ok: true, approval: completed, result };
}

function normalizeHandleLocal(handle) {
  const value = String(handle || "").trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}

function summarizeApprovalExecution({ approval, result = {} } = {}) {
  const worker = result.worker || {};
  const workerResult = worker.result || {};
  const proposal = workerResult.proposal || result.proposal || {};
  const action = workerResult.action || result.action || {};
  const payment = workerResult.payment || result.payment || {};
  const execution = workerResult.execution
    || proposal.execution
    || action.execution
    || payment.transfer
    || {};
  const job = worker.job || result.job || {};
  const txHash = execution.txHash || proposal.txHash || action.txHash || payment.transfer?.txHash || workerResult.txHash || null;
  const explorerUrl = execution.explorerUrl || action.explorerUrl || payment.transfer?.explorerUrl || workerResult.explorerUrl || null;
  const status = execution.status
    || proposal.status
    || action.status
    || payment.status
    || workerResult.status
    || job.status
    || approval?.status
    || "approved";
  const reason = worker.error
    || workerResult.error
    || workerResult.reason
    || execution.reason
    || action.failureReason
    || proposal.failureReason
    || proposal.execution?.reason
    || job.lastError
    || result.reason
    || null;
  return {
    kind: approval?.kind || null,
    targetId: approval?.targetId || null,
    status,
    txHash,
    explorerUrl,
    reason,
    proposalId: proposal.id || (approval?.kind === "perp_trade" ? approval.targetId : null),
    actionId: action.id || null,
    paymentId: payment.id || null,
    jobStatus: job.status || null,
    attempts: job.attempts || null,
    nextAction: txHash ? "monitor_receipt" : reason ? "inspect_reason" : "check_activity_receipt"
  };
}
